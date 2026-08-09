'use strict';

const crypto = require('node:crypto');
const StorageGateway = require('./StorageGateway');

/**
 * Stores blobs in an S3-compatible object store.
 *
 * Named `S3` rather than `R2` because the wire protocol is what matters: the same
 * adapter works against Cloudflare R2, Backblaze B2 and Supabase Storage. Only
 * the endpoint and region differ.
 *
 * ## Why this exists
 *
 * `DiskStorageGateway` keeps blobs on the local filesystem, which does not
 * survive a restart on an ephemeral host. Rows live in Postgres and outlast the
 * container, so a deployed service would resolve a link and then fail to produce
 * the file. Object storage is what makes a share link mean something for its full
 * 24 hours.
 *
 * ## What the store learns
 *
 * Ciphertext and its length. No filename, no MIME type, no key — those are inside
 * the envelope. Adding a third party to the system therefore does not weaken the
 * zero-knowledge property; it widens the set of parties holding bytes nobody can
 * read.
 *
 * ## Signing
 *
 * `signRequest` is injected rather than required directly, so tests can substitute
 * a stub and the gateway can be exercised without credentials.
 */
class S3StorageGateway extends StorageGateway {
  /**
   * @param {object} options
   * @param {string} options.endpoint    e.g. https://ACCOUNT.r2.cloudflarestorage.com
   * @param {string} options.bucket
   * @param {string} options.accessKeyId
   * @param {string} options.secretAccessKey
   * @param {string} options.region      'auto' for R2
   * @param {Function} options.signRequest
   */
  constructor({ endpoint, bucket, accessKeyId, secretAccessKey, region, signRequest }) {
    super();
    // Trailing slash removed so URL joins are predictable, matching how
    // APP_BASE_URL is normalised in config/env.js.
    this.endpoint = endpoint.replace(/\/+$/, '');
    this.bucket = bucket;
    this.accessKeyId = accessKeyId;
    this.secretAccessKey = secretAccessKey;
    this.region = region;
    this.signRequest = signRequest;
  }

  /**
   * Confirms the bucket is reachable and the credentials are accepted.
   *
   * Called once at startup from the composition root. Failing here rather than on
   * a user's first upload matches how an unreachable database behaves: the process
   * exits with a clear message instead of booting and breaking every request.
   *
   * @returns {Promise<void>}
   */
  async init() {
    const response = await this.send('HEAD', '');

    if (!response.ok) {
      throw new Error(
        `Object storage is not reachable: ${response.status} ${response.statusText}. ` +
          'Check S3_ENDPOINT, S3_BUCKET and the credentials.',
      );
    }
  }

  /** @inheritdoc */
  newKey() {
    return crypto.randomBytes(16).toString('hex');
  }

  /** @inheritdoc */
  async write(key, bytes) {
    const response = await this.send('PUT', key, bytes);

    if (!response.ok) {
      throw new Error(`Failed to store blob: ${response.status} ${await this.describe(response)}`);
    }
  }

  /** @inheritdoc */
  async read(key) {
    const response = await this.send('GET', key);

    if (!response.ok) {
      throw new Error(`Failed to read blob: ${response.status} ${await this.describe(response)}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * @inheritdoc
   *
   * A 404 counts as success. The port requires removal of an absent blob to
   * succeed so cleanup is repeatable, and the expiry sweeper relies on that: it
   * deletes rows first, then blobs, so a retried sweep necessarily asks for keys
   * that are already gone.
   */
  async remove(key) {
    const response = await this.send('DELETE', key);

    if (!response.ok && response.status !== 404) {
      throw new Error(`Failed to remove blob: ${response.status} ${await this.describe(response)}`);
    }
  }

  /**
   * Signs and performs one request.
   *
   * `x-amz-content-sha256` is added here rather than in the signer because it is
   * an S3 requirement, not part of SigV4 itself. S3 rejects a request whose body
   * digest is absent or does not match, so it is computed from the exact bytes
   * being sent.
   *
   * @param {'GET'|'PUT'|'DELETE'|'HEAD'} method
   * @param {string} key  empty string addresses the bucket itself
   * @param {Buffer} [body]
   * @returns {Promise<Response>}
   */
  send(method, key, body) {
    const url = key ? `${this.endpoint}/${this.bucket}/${key}` : `${this.endpoint}/${this.bucket}`;
    const payload = body ?? '';

    const headers = this.signRequest({
      method,
      url,
      headers: {
        'x-amz-content-sha256': crypto.createHash('sha256').update(payload).digest('hex'),
        ...(body ? { 'content-length': String(body.length) } : {}),
      },
      body: payload,
      accessKeyId: this.accessKeyId,
      secretAccessKey: this.secretAccessKey,
      region: this.region,
      service: 's3',
    });

    // `host` is signed but must not be set on a fetch request — undici rejects it
    // as a forbidden header and computes it from the URL anyway.
    delete headers.host;

    return fetch(url, { method, headers, body: body ?? undefined });
  }

  /**
   * Extracts something useful from an error response.
   *
   * S3 reports failures as an XML document, and the `<Message>` inside it is far
   * more diagnostic than the status code alone — particularly for signature
   * mismatches, where the code is always 403.
   *
   * @param {Response} response
   * @returns {Promise<string>}
   */
  async describe(response) {
    try {
      const text = await response.text();
      const message = /<Message>([^<]+)<\/Message>/.exec(text);
      return message ? message[1] : response.statusText;
    } catch {
      return response.statusText;
    }
  }
}

module.exports = S3StorageGateway;
