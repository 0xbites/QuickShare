'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const StorageGateway = require('./StorageGateway');

/**
 * Stores blobs as files in a local directory.
 *
 * The only file in the application that touches the filesystem.
 *
 * Note that on an ephemeral host such as a Render free instance this directory
 * does not survive a restart, so blobs can disappear while their rows remain.
 * That is acceptable for a 24-hour transfer tool and is the main reason to move
 * to object storage later.
 */
class DiskStorageGateway extends StorageGateway {
  /** @param {string} directory resolved absolute path */
  constructor(directory) {
    super();
    this.directory = directory;
  }

  /** Creates the storage directory if it does not already exist. */
  async init() {
    await fs.mkdir(this.directory, { recursive: true });
  }

  /** @inheritdoc */
  newKey() {
    return crypto.randomBytes(16).toString('hex');
  }

  /**
   * Resolves a key to a path and refuses anything that escapes the directory.
   * Keys are generated internally, but this stays cheap insurance against a
   * future caller passing user input straight through.
   *
   * @param {string} key
   * @returns {string}
   */
  pathFor(key) {
    const resolved = path.resolve(this.directory, key);
    if (path.dirname(resolved) !== path.resolve(this.directory)) {
      throw new Error('Invalid storage key');
    }
    return resolved;
  }

  /** @inheritdoc */
  async write(key, bytes) {
    await fs.writeFile(this.pathFor(key), bytes);
  }

  /** @inheritdoc */
  async read(key) {
    return fs.readFile(this.pathFor(key));
  }

  /** @inheritdoc */
  async remove(key) {
    await fs.rm(this.pathFor(key), { force: true });
  }
}

module.exports = DiskStorageGateway;
