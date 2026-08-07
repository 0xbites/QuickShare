'use strict';

/**
 * Operator takedown.
 *
 * Removes a file by uuid, without decrypting anything — decryption is not
 * possible here and is not needed. Acting on metadata alone is the only
 * moderation a zero-knowledge service can perform, and it is enough: an
 * unreachable file is an unreachable file regardless of what it contained.
 *
 * There is intentionally no HTTP route for this. Exposing takedown over the
 * network would need an authentication system the project does not otherwise
 * have; a CLI run by whoever already holds the database credentials adds no new
 * attack surface.
 */
class DeletionService {
  /**
   * @param {object} deps
   * @param {import('../repositories/FileRepository')} deps.fileRepository
   * @param {import('../storage/StorageGateway')} deps.storageGateway
   */
  constructor({ fileRepository, storageGateway }) {
    this.fileRepository = fileRepository;
    this.storageGateway = storageGateway;
  }

  /**
   * Row first, then blob — the same ordering the expiry sweep uses. A failure
   * in between leaves an unreferenced blob for the sweeper, rather than a
   * resolvable row pointing at a deleted file.
   *
   * @param {string} uuid
   * @returns {Promise<boolean>} false when no such file existed
   */
  async takedown(uuid) {
    const storageKey = await this.fileRepository.deleteByUuid(uuid);
    if (!storageKey) return false;

    await this.storageGateway.remove(storageKey);
    return true;
  }
}

module.exports = DeletionService;
