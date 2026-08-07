'use strict';

/**
 * Reclaims storage for links that are already dead.
 *
 * This job is an optimisation, not a correctness mechanism. Expiry is enforced
 * by `findResolvable` on every read, so a link is unusable the instant it
 * expires whether or not this has run. If it never runs, the service still
 * behaves correctly and merely wastes disk.
 *
 * That distinction is deliberate. The previous implementation made deletion the
 * only thing standing between an expired link and a working download, and
 * silently failed.
 */
class ExpiryService {
  /**
   * @param {object} deps
   * @param {import('../repositories/FileRepository')} deps.fileRepository
   * @param {import('../storage/StorageGateway')} deps.storageGateway
   * @param {number} [deps.abandonedAfterMinutes] grace period for allocations
   *   whose upload never arrived; must exceed the longest plausible upload so a
   *   slow transfer is not swept while still in flight
   */
  constructor({ fileRepository, storageGateway, abandonedAfterMinutes = 60 }) {
    this.fileRepository = fileRepository;
    this.storageGateway = storageGateway;
    this.abandonedAfterMinutes = abandonedAfterMinutes;
  }

  /**
   * Deletes dead rows, then their blobs.
   *
   * Rows go first so a failure part way through leaves unreferenced blobs
   * rather than resolvable rows pointing at deleted files. Blob removal is
   * per-key and tolerant: one failure must not abandon the rest of the batch.
   *
   * @returns {Promise<number>} how many records were removed
   */
  async purge() {
    const storageKeys = await this.fileRepository.deleteExpired(this.abandonedAfterMinutes);

    for (const key of storageKeys) {
      try {
        await this.storageGateway.remove(key);
      } catch (err) {
        console.error(`Failed to remove blob ${key}:`, err.message);
      }
    }

    return storageKeys.length;
  }

  /**
   * Runs the purge on a fixed interval, once per process.
   *
   * Registered at startup rather than in the request path. Installing it as
   * middleware would schedule a fresh job on every request, which is how the
   * previous version ended up with one duplicate job per request served.
   *
   * @param {number} intervalMs
   * @returns {NodeJS.Timeout}
   */
  start(intervalMs) {
    const run = () => {
      this.purge().catch((err) => console.error('Expiry sweep failed:', err.message));
    };

    run();
    const timer = setInterval(run, intervalMs);
    timer.unref();
    return timer;
  }
}

module.exports = ExpiryService;
