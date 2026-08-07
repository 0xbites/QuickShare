/**
 * Envelope encryption. The only place in the project that handles key material.
 *
 * Runs in the browser. It is also plain ES module code with no DOM access, so
 * it loads unchanged in Node for testing — WebCrypto is on `globalThis.crypto`
 * in Node 18 and later.
 *
 * The layout of a sealed envelope:
 *
 *     +------------+---------------------------------------+----------+
 *     |     IV     |              ciphertext               |   tag    |
 *     |  12 bytes  |          2 + L + N bytes              | 16 bytes |
 *     +------------+---------------------------------------+----------+
 *
 * and the plaintext that gets encrypted:
 *
 *     +-------------+------------------+------------------+
 *     |  headerLen  |      header      |       body       |
 *     |   2 bytes   |     L bytes      |     N bytes      |
 *     +-------------+------------------+------------------+
 *
 * The header is JSON holding the original filename and MIME type. Encrypting it
 * alongside the body is the reason the server never learns either — a name like
 * `q3-layoffs-final.xlsx` can reveal as much as the contents.
 */

/** AES-GCM standard nonce length. 96 bits is the size the algorithm is optimised for. */
export const IV_BYTES = 12;

/** AES-GCM authentication tag length, appended to the ciphertext by WebCrypto. */
export const TAG_BYTES = 16;

/** Bytes reserved for the big-endian header length prefix. */
const HEADER_LEN_BYTES = 2;

const ALGORITHM = 'AES-GCM';
const KEY_BITS = 256;

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/**
 * Generates a fresh 256-bit key.
 *
 * One key per file, used exactly once. That single property removes most of the
 * ways AES-GCM is normally misused: nonce reuse becomes impossible, and the
 * limits on how much data a key may protect are never approached.
 *
 * @returns {Promise<CryptoKey>}
 */
export function generateKey() {
  return crypto.subtle.generateKey({ name: ALGORITHM, length: KEY_BITS }, true, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Serialises a key for the URL fragment.
 *
 * base64url rather than base64: the standard alphabet's `+` and `/` are not
 * safe in a URL, and `=` padding is noise.
 *
 * @param {CryptoKey} key
 * @returns {Promise<string>}
 */
export async function exportKey(key) {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key));
  return base64UrlEncode(raw);
}

/**
 * @param {string} encoded base64url as produced by `exportKey`
 * @returns {Promise<CryptoKey>}
 */
export function importKey(encoded) {
  return crypto.subtle.importKey(
    'raw',
    base64UrlDecode(encoded),
    { name: ALGORITHM },
    true,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Encrypts a file into a single envelope.
 *
 * The uuid is passed as `additionalData`: authenticated but not encrypted, and
 * costing no extra bytes. It binds the ciphertext to its link, so a blob served
 * under a different uuid fails its tag check instead of decrypting into
 * something unexpected.
 *
 * @param {File|Blob} file  the file to seal; `name` and `type` are read if present
 * @param {string} uuid     the allocated identifier, used as additional authenticated data
 * @param {CryptoKey} key
 * @returns {Promise<Uint8Array>} `iv || ciphertext || tag`
 */
export async function seal(file, uuid, key) {
  const header = utf8Encoder.encode(
    JSON.stringify({ name: file.name || 'download', type: file.type || 'application/octet-stream' }),
  );
  if (header.length > 0xffff) {
    throw new Error('File name is too long to encode.');
  }

  const body = new Uint8Array(await file.arrayBuffer());

  const plaintext = new Uint8Array(HEADER_LEN_BYTES + header.length + body.length);
  new DataView(plaintext.buffer).setUint16(0, header.length, false); // false = big-endian
  plaintext.set(header, HEADER_LEN_BYTES);
  plaintext.set(body, HEADER_LEN_BYTES + header.length);

  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: ALGORITHM, iv, additionalData: utf8Encoder.encode(uuid) },
      key,
      plaintext,
    ),
  );

  const envelope = new Uint8Array(iv.length + ciphertext.length);
  envelope.set(iv, 0);
  envelope.set(ciphertext, iv.length);
  return envelope;
}

/**
 * Reverses `seal`.
 *
 * Throws if the tag check fails, which covers a wrong key, a wrong uuid, and
 * any modification of the stored bytes. There is no path that returns partial
 * or unverified plaintext: it either returns the original file or it throws.
 *
 * @param {Uint8Array} envelope `iv || ciphertext || tag`
 * @param {string} uuid         must match the value used when sealing
 * @param {CryptoKey} key
 * @returns {Promise<{ name: string, type: string, bytes: Uint8Array }>}
 */
export async function open(envelope, uuid, key) {
  if (envelope.length < IV_BYTES + TAG_BYTES) {
    throw new Error('Envelope is too short to be valid.');
  }

  const iv = envelope.subarray(0, IV_BYTES);
  const ciphertext = envelope.subarray(IV_BYTES);

  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: ALGORITHM, iv, additionalData: utf8Encoder.encode(uuid) },
      key,
      ciphertext,
    ),
  );

  const headerLength = new DataView(
    plaintext.buffer,
    plaintext.byteOffset,
    plaintext.byteLength,
  ).getUint16(0, false);

  const headerEnd = HEADER_LEN_BYTES + headerLength;
  if (headerEnd > plaintext.length) {
    throw new Error('Envelope header is malformed.');
  }

  const header = JSON.parse(utf8Decoder.decode(plaintext.subarray(HEADER_LEN_BYTES, headerEnd)));

  return {
    name: header.name,
    type: header.type,
    bytes: plaintext.subarray(headerEnd),
  };
}

/**
 * @param {Uint8Array} bytes
 * @returns {string}
 */
function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * @param {string} encoded
 * @returns {Uint8Array}
 */
function base64UrlDecode(encoded) {
  const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
