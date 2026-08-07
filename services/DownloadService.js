'use strict';

const { gone } = require('./errors');

/**
 * Serves the two halves of a download: the landing page's data, and the bytes.
 *
 * Both go through `findResolvable`, so expiry is enforced on every request
 * rather than trusted to a cleanup job. A link stops working the moment it
 * expires even if nothing has swept the row.
 *
 * What comes back from storage is ciphertext. This service cannot decrypt it
 * and does not try.
 */
class DownloadService {
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
   * Metadata for the landing page. Only the size is returned, because the size
   * is the only thing about the file the server actually knows.
   *
   * @param {string} uuid
   * @returns {Promise<{ uuid: string, sizeBytes: number, expiresAt: Date }>}
   */
  async resolve(uuid) {
    const record = await this.fileRepository.findResolvable(uuid);
    if (!record) throw gone();

    return { uuid: record.uuid, sizeBytes: record.sizeBytes, expiresAt: record.expiresAt };
  }

  /**
   * The encrypted envelope itself.
   *
   * @param {string} uuid
   * @returns {Promise<Buffer>}
   */
  async readEnvelope(uuid) {
    const record = await this.fileRepository.findResolvable(uuid);
    if (!record) throw gone();

    try {
      return await this.storageGateway.read(record.storageKey);
    } catch {
      // The row survived but the blob did not — the expected outcome of a
      // restart on an ephemeral filesystem. To the user this is a dead link,
      // which is exactly what it is.
      throw gone();
    }
  }
}

module.exports = DownloadService;
