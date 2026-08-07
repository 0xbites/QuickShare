'use strict';

const RateLimiter = require('./RateLimiter');

/**
 * Sliding-window request limiter holding counters in process memory.
 *
 * ## Why sliding rather than fixed
 *
 * A fixed window lets a client spend its whole quota at 59.9s and again at
 * 60.1s, briefly running at twice the intended rate. This weights the previous
 * window's count by how much of the current window has elapsed, which smooths
 * the boundary for a few lines of arithmetic.
 *
 * ## Why the map is capped
 *
 * The key is derived from the client address, so an unbounded map is a memory
 * leak an attacker controls: spray requests from many addresses and the process
 * grows until it dies. Trading one denial of service for another is no defence,
 * hence the hard entry cap and the periodic sweep.
 *
 * ## Single-process only
 *
 * Counters are not shared. Across N instances the effective limit is N times the
 * configured value. Acceptable on a single free-tier instance; swap in a Redis
 * adapter before scaling out.
 */
class MemoryRateLimiter extends RateLimiter {
  /**
   * @param {object} options
   * @param {number} options.max        requests permitted per window
   * @param {number} options.windowMs   window length in milliseconds
   * @param {number} [options.maxKeys]  hard cap on tracked clients
   */
  constructor({ max, windowMs, maxKeys = 50_000 }) {
    super();
    this.max = max;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;

    /** @type {Map<string, { window: number, count: number, previous: number }>} */
    this.entries = new Map();

    // Sweeping on a timer rather than on every request keeps `consume` O(1).
    // `unref` so a limiter never holds the process open.
    this.sweeper = setInterval(() => this.sweep(), windowMs);
    this.sweeper.unref();
  }

  /** @inheritdoc */
  consume(key) {
    const now = Date.now();
    const currentWindow = Math.floor(now / this.windowMs) * this.windowMs;

    let entry = this.entries.get(key);

    if (!entry) {
      // Map.set on a full map would grow it without bound, so make room first.
      if (this.entries.size >= this.maxKeys) this.evictOldest();
      entry = { window: currentWindow, count: 0, previous: 0 };
      this.entries.set(key, entry);
    } else if (entry.window !== currentWindow) {
      // Carry the last window's count forward only if it was the immediately
      // preceding one. An older entry means the client has been idle, and its
      // count should not be weighted into the present.
      entry.previous = entry.window === currentWindow - this.windowMs ? entry.count : 0;
      entry.window = currentWindow;
      entry.count = 0;
    }

    // Fraction of the current window already elapsed, in [0, 1).
    const elapsed = (now - currentWindow) / this.windowMs;
    const estimated = entry.previous * (1 - elapsed) + entry.count;

    if (estimated >= this.max) {
      return {
        allowed: false,
        retryAfterSeconds: this.retryAfterSeconds(entry, currentWindow, now),
      };
    }

    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  /**
   * When the weighted estimate will next fall below the limit.
   *
   * The obvious answer — the end of the current window — is wrong for a sliding
   * window, because the previous window's count keeps contributing after the
   * boundary. A client that obeyed that value would be refused again on arrival,
   * which makes `Retry-After` worse than useless.
   *
   * Solving `previous × (1 − x) + count < max` for the elapsed fraction `x`
   * gives the honest answer.
   *
   * @param {{ count: number, previous: number }} entry
   * @param {number} currentWindow
   * @param {number} now
   * @returns {number} whole seconds, never less than 1
   */
  retryAfterSeconds(entry, currentWindow, now) {
    let readyAt;

    if (entry.count < this.max && entry.previous > 0) {
      // Decay within this window is enough.
      const fractionNeeded = 1 - (this.max - entry.count) / entry.previous;
      readyAt = currentWindow + this.windowMs * fractionNeeded;
    } else if (entry.count >= this.max) {
      // This window is spent. After the boundary the current count becomes the
      // previous one, so it has to decay too before anything is permitted.
      const fractionNeeded = 1 - this.max / entry.count;
      readyAt = currentWindow + this.windowMs + this.windowMs * fractionNeeded;
    } else {
      readyAt = currentWindow + this.windowMs;
    }

    return Math.max(1, Math.ceil((readyAt - now) / 1000));
  }

  /**
   * Drops entries whose window is old enough that they can no longer influence
   * a decision.
   */
  sweep() {
    const cutoff = Date.now() - this.windowMs * 2;
    for (const [key, entry] of this.entries) {
      if (entry.window < cutoff) this.entries.delete(key);
    }
  }

  /**
   * Removes the least recently updated entries.
   *
   * Map iterates in insertion order, and entries are never re-inserted, so this
   * is an approximation of oldest-first rather than true LRU. Good enough: the
   * cap exists to bound memory, not to be fair. Evicting a batch rather than a
   * single entry avoids paying this cost on every subsequent request.
   */
  evictOldest() {
    const target = Math.max(1, Math.floor(this.maxKeys / 10));
    let removed = 0;
    for (const key of this.entries.keys()) {
      this.entries.delete(key);
      if (++removed >= target) break;
    }
  }
}

module.exports = MemoryRateLimiter;
