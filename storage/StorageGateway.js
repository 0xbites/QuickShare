'use strict';

/**
 * Port describing blob storage.
 *
 * The application only ever moves opaque bytes, so this interface is
 * deliberately tiny. Everything it handles is ciphertext, which is why no
 * method takes a filename or content type — there are none to pass.
 *
 * Keeping this abstraction lets local disk be swapped for object storage by
 * writing one new adapter and changing one line in the composition root.
 */
class StorageGateway {
  /**
   * Generates an opaque name for a new blob. Never derived from the original
   * filename, and never carries a file extension, because an extension would
   * leak the file type that the encryption is there to hide.
   *
   * @returns {string}
   */
  newKey() {
    throw new Error('StorageGateway.newKey is not implemented');
  }

  /**
   * @param {string} _key
   * @param {Buffer} _bytes
   * @returns {Promise<void>}
   */
  async write(_key, _bytes) {
    throw new Error('StorageGateway.write is not implemented');
  }

  /**
   * @param {string} _key
   * @returns {Promise<Buffer>}
   */
  async read(_key) {
    throw new Error('StorageGateway.read is not implemented');
  }

  /**
   * Removing an absent blob must succeed, so cleanup is safely repeatable.
   *
   * @param {string} _key
   * @returns {Promise<void>}
   */
  async remove(_key) {
    throw new Error('StorageGateway.remove is not implemented');
  }
}

module.exports = StorageGateway;
