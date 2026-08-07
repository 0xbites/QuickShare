'use strict';

/**
 * Port describing everything the application needs from metadata storage.
 *
 * Services depend on this class, never on a concrete database. That keeps SQL
 * confined to one adapter and lets the services be exercised against an
 * in-memory fake. Methods throw rather than returning empty defaults, so an
 * incomplete implementation fails loudly instead of silently doing nothing.
 *
 * @typedef {object} FileRecord
 * @property {string}      uuid
 * @property {string}      storageKey
 * @property {number|null} sizeBytes
 * @property {Date}        createdAt
 * @property {Date|null}   storedAt
 * @property {Date}        expiresAt
 */
class FileRepository {
  /**
   * Reserves a uuid before the blob exists, because the uuid is an input to
   * encryption and must therefore be known by the browser first.
   *
   * @param {{ storageKey: string, retentionHours: number }} _input
   * @returns {Promise<FileRecord>}
   */
  async allocate(_input) {
    throw new Error('FileRepository.allocate is not implemented');
  }

  /**
   * Marks an allocation as stored. Must not overwrite an already-stored record,
   * so a replayed upload cannot silently replace someone else's blob.
   *
   * @param {string} _uuid
   * @param {number} _sizeBytes
   * @returns {Promise<FileRecord|null>} null when unknown or already stored
   */
  async markStored(_uuid, _sizeBytes) {
    throw new Error('FileRepository.markStored is not implemented');
  }

  /**
   * Returns a record only if it is stored and unexpired. Expiry is evaluated in
   * the query so a link dies on time whether or not any sweeper has run.
   *
   * @param {string} _uuid
   * @returns {Promise<FileRecord|null>}
   */
  async findResolvable(_uuid) {
    throw new Error('FileRepository.findResolvable is not implemented');
  }

  /**
   * Returns a record regardless of state. Used only when a blob must be located
   * for deletion.
   *
   * @param {string} _uuid
   * @returns {Promise<FileRecord|null>}
   */
  async findByUuid(_uuid) {
    throw new Error('FileRepository.findByUuid is not implemented');
  }

  /**
   * Removes expired records and abandoned allocations, returning their storage
   * keys so the caller can delete the matching blobs.
   *
   * @param {number} _abandonedAfterMinutes
   * @returns {Promise<string[]>}
   */
  async deleteExpired(_abandonedAfterMinutes) {
    throw new Error('FileRepository.deleteExpired is not implemented');
  }

  /**
   * Total bytes currently stored, used to enforce the service-wide ceiling.
   * Counts only completed uploads, since a reservation occupies no space.
   *
   * @returns {Promise<number>}
   */
  async totalStoredBytes() {
    throw new Error('FileRepository.totalStoredBytes is not implemented');
  }

  /**
   * Removes one record outright, whatever its state, and returns its storage
   * key. Used for operator takedown.
   *
   * @param {string} _uuid
   * @returns {Promise<string|null>} null when no such record existed
   */
  async deleteByUuid(_uuid) {
    throw new Error('FileRepository.deleteByUuid is not implemented');
  }
}

module.exports = FileRepository;
