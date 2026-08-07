'use strict';

const { capacityExhausted } = require('./errors');

/**
 * Decides whether the service has room for more data.
 *
 * Content cannot be inspected, so every control the service has acts on volume
 * and cost. This is the one that protects the bill: without it, uploads run
 * until the disk or the database's free tier fills.
 *
 * Separate from `UploadService` because "is there room" is a policy question
 * that will keep growing — per-client quotas, tiers, soft limits — while
 * "store these bytes" will not.
 */
class AdmissionService {
  /**
   * @param {object} deps
   * @param {import('../repositories/FileRepository')} deps.fileRepository
   * @param {number} deps.storageCeilingBytes service-wide cap on stored bytes
   */
  constructor({ fileRepository, storageCeilingBytes }) {
    this.fileRepository = fileRepository;
    this.storageCeilingBytes = storageCeilingBytes;
  }

  /**
   * Refuses when the service has no room left at all.
   *
   * Used at allocate, where the size is not yet known. The comparison is `>=`
   * rather than `>` on purpose: sitting exactly on the ceiling means full, and
   * handing out a reservation that cannot possibly be filled only wastes the
   * client's time encrypting.
   *
   * @returns {Promise<void>}
   */
  async assertNotFull() {
    if ((await this.fileRepository.totalStoredBytes()) >= this.storageCeilingBytes) {
      throw capacityExhausted();
    }
  }

  /**
   * Refuses when this specific upload would push the total past the ceiling.
   *
   * Used at store, on the real body length. A client-declared size is not used
   * anywhere, because it would simply be lied about.
   *
   * Here `>` is right where `assertNotFull` used `>=`: a file that lands exactly
   * on the ceiling fits, and should be accepted.
   *
   * The check is inherently racy — concurrent uploads can each pass and then
   * collectively overshoot. The overshoot is bounded by the largest accepted
   * upload times the number of simultaneous ones, which is a much cheaper
   * problem than serialising every upload behind a lock.
   *
   * @param {number} additionalBytes
   * @returns {Promise<void>}
   */
  async assertFits(additionalBytes) {
    const stored = await this.fileRepository.totalStoredBytes();

    if (stored + additionalBytes > this.storageCeilingBytes) {
      throw capacityExhausted();
    }
  }
}

module.exports = AdmissionService;
