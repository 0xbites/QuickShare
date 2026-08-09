'use strict';

const crypto = require('node:crypto');

/**
 * AWS Signature Version 4 request signing.
 *
 * Isolated from the storage gateway for one reason: a signing mistake produces a
 * bare `403 SignatureDoesNotMatch` with no indication of which of the eight steps
 * was wrong. Keeping the algorithm in its own module with no network access means
 * it can be checked against AWS's published test vectors, where the expected
 * canonical request and signature are known.
 *
 * Written against `node:crypto` and the built-in `fetch` rather than an SDK. The
 * official client would handle this correctly and save the code, but it costs
 * roughly 20 MB and a large transitive tree — and in this project the number of
 * runtime dependencies is itself a security property.
 *
 * This module is generic SigV4. Anything S3-specific — notably the
 * `x-amz-content-sha256` header that S3 requires as a *signed* header — belongs
 * to the caller, which keeps this testable against non-S3 vectors.
 *
 * Reference: AWS "Signature Version 4 signing process".
 */

const ALGORITHM = 'AWS4-HMAC-SHA256';

/** @param {string|Buffer} data @returns {string} lowercase hex */
function sha256Hex(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * @param {Buffer|string} key
 * @param {string} data
 * @returns {Buffer}
 */
function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

/**
 * Percent-encodes one path segment per RFC 3986.
 *
 * `encodeURIComponent` leaves `!'()*` alone, but the specification requires them
 * encoded. Any difference between what is signed and what the server canonicalises
 * invalidates the signature, so this is not cosmetic.
 *
 * @param {string} value
 * @returns {string}
 */
function encodeSegment(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Builds the canonical URI.
 *
 * `URL.pathname` is already percent-encoded, so each segment is decoded before
 * being re-encoded. Encoding directly would double-encode any `%` and produce a
 * canonical request the server does not agree with.
 *
 * @param {string} pathname
 * @returns {string}
 */
function canonicalUri(pathname) {
  if (pathname === '' || pathname === '/') return '/';

  return pathname
    .split('/')
    .map((segment) => encodeSegment(decodeURIComponent(segment)))
    .join('/');
}

/**
 * Builds the canonical query string: parameters sorted by name, then by value.
 *
 * @param {URLSearchParams} searchParams
 * @returns {string}
 */
function canonicalQuery(searchParams) {
  const pairs = [...searchParams.entries()]
    .map(([name, value]) => [encodeSegment(name), encodeSegment(value)])
    .sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));

  return pairs.map(([name, value]) => `${name}=${value}`).join('&');
}

/**
 * Formats a date as the two stamps SigV4 needs.
 *
 * @param {Date} date
 * @returns {{ amzDate: string, dateStamp: string }}
 */
function timestamps(date) {
  // 2015-08-30T12:36:00.000Z -> 20150830T123600Z
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Derives the signing key.
 *
 * Four chained HMACs, each using the previous result as its key. The chain scopes
 * the key to one date, one region and one service, which is what limits the blast
 * radius of a leaked signature to a single day.
 *
 * @param {string} secretAccessKey
 * @param {string} dateStamp
 * @param {string} region
 * @param {string} service
 * @returns {Buffer}
 */
function signingKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

/**
 * Signs a request and returns the headers to send.
 *
 * The returned object includes every header that was passed in, plus `host`,
 * `x-amz-date` and `authorization`. Header names are lowercased, because that is
 * how they are signed and any mismatch breaks the signature.
 *
 * @param {object} request
 * @param {string} request.method            HTTP method, uppercase
 * @param {string} request.url               full request URL
 * @param {Record<string,string>} [request.headers]  headers to include in the signature
 * @param {Buffer|string} [request.body]     request body; empty string if absent
 * @param {string} request.accessKeyId
 * @param {string} request.secretAccessKey
 * @param {string} request.region
 * @param {string} request.service
 * @param {Date} [request.date]              injectable for testing against fixed vectors
 * @returns {Record<string,string>} headers including `authorization`
 */
function signRequest({
  method,
  url,
  headers = {},
  body = '',
  accessKeyId,
  secretAccessKey,
  region,
  service,
  date = new Date(),
}) {
  const target = new URL(url);
  const { amzDate, dateStamp } = timestamps(date);

  // Lowercase every incoming name so a caller passing 'Content-Type' and a
  // caller passing 'content-type' produce the same signature.
  const signed = {};
  for (const [name, value] of Object.entries(headers)) {
    signed[name.toLowerCase()] = String(value);
  }

  // `host` is mandatory in the signature. Include the port only when the URL
  // carries one explicitly, matching how servers canonicalise it.
  signed.host = target.host;
  signed['x-amz-date'] = amzDate;

  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((name) => `${name}:${signed[name].trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const payloadHash = sha256Hex(body);

  const canonicalRequest = [
    method,
    canonicalUri(target.pathname),
    canonicalQuery(target.searchParams),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  const stringToSign = [ALGORITHM, amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  const signature = crypto
    .createHmac('sha256', signingKey(secretAccessKey, dateStamp, region, service))
    .update(stringToSign, 'utf8')
    .digest('hex');

  return {
    ...signed,
    authorization:
      `${ALGORITHM} Credential=${accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

module.exports = { signRequest, sha256Hex };
