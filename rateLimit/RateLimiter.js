'use strict';

/**
 * Port describing a per-client request limiter.
 *
 * Kept behind an interface because the in-memory implementation is correct only
 * for a single process. Moving to Redis when the deployment grows past one
 * instance is a new adapter and one line in the composition root.
 *
 * @typedef {object} RateLimitResult
 * @property {boolean} allowed
 * @property {number}  retryAfterSeconds whole seconds until the caller may retry
 */
class RateLimiter {
  /**
   * Records one request against `key` and reports whether it is permitted.
   *
   * Implementations must not throw for an unknown key — the first request from
   * a client is the common case, not an error.
   *
   * @param {string} _key
   * @returns {RateLimitResult}
   */
  consume(_key) {
    throw new Error('RateLimiter.consume is not implemented');
  }
}

module.exports = RateLimiter;
