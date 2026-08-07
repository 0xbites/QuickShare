'use strict';

const { conflict, badRequest } = require('./errors');

/**
 * Upload is two steps, and the order is forced by the cryptography.
 *
 * The uuid is bound into the ciphertext as additional authenticated data, so
 * the browser must know it before it can encrypt anything. The server therefore
 * allocates a slot first and accepts the blob second. There is no single-request
 * form of this that preserves the binding.
 *
 * The service never sees a filename, a content type, or a key. It receives a
 * buffer it cannot interpret and writes it unchanged.
 */
class UploadService {
  /**
   * @param {object} deps
   * @param {import('../repositories/FileRepository')} deps.fileRepository
   * @param {import('../storage/StorageGateway')} deps.storageGateway
   * @param {number} deps.retentionHours
   */
  constructor({ fileRepository, storageGateway, retentionHours }) {
    this.fileRepository = fileRepository;
    this.storageGateway = storageGateway;
    this.retentionHours = retentionHours;
  }

  /**
   * Reserves a uuid and a storage key. Nothing is written to storage yet.
   *
   * @returns {Promise<{ uuid: string, expiresAt: Date }>}
   */
  async allocate() {
    const record = await this.fileRepository.allocate({
      storageKey: this.storageGateway.newKey(),
      retentionHours: this.retentionHours,
    });
    return { uuid: record.uuid, expiresAt: record.expiresAt };
  }

  /**
   * Accepts the encrypted envelope for a previously allocated uuid.
   *
   * The blob is written before the row is marked stored. Ordering it this way
   * means a crash in between leaves an unreferenced blob, which the sweeper
   * later reclaims. The reverse order would leave a resolvable row pointing at
   * nothing, which a user would experience as a broken download.
   *
   * @param {string} uuid
   * @param {Buffer} bytes the raw `iv || ciphertext` envelope
   * @returns {Promise<void>}
   */
  async store(uuid, bytes) {
    if (!bytes || bytes.length === 0) {
      throw badRequest('Request body was empty.');
    }

    const record = await this.fileRepository.findByUuid(uuid);
    if (!record || record.storedAt !== null) {
      throw conflict();
    }

    await this.storageGateway.write(record.storageKey, bytes);

    const stored = await this.fileRepository.markStored(uuid, bytes.length);
    if (!stored) {
      // Lost a race, or the slot expired while the body was in flight. The blob
      // just written is now unreferenced, so remove it rather than leaking it.
      await this.storageGateway.remove(record.storageKey);
      throw conflict();
    }
  }
}

module.exports = UploadService;
