'use strict';

/**
 * Errors that carry the HTTP status the client should see.
 *
 * Services throw these instead of returning status codes, which keeps them free
 * of HTTP concepts while still letting one error handler translate failures
 * into responses. Anything thrown that is not an `AppError` is by definition
 * unexpected and becomes a 500.
 */
class AppError extends Error {
  /**
   * @param {number} status
   * @param {string} message safe to show a client — never include internals
   * @param {Record<string, string>} [headers] response headers this error implies
   */
  constructor(status, message, headers = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.headers = headers;
  }
}

/** The link is unknown, expired, or was never completed. */
const gone = () => new AppError(410, 'This link has expired or does not exist.');

/** The allocation is unknown, already used, or expired before the upload landed. */
const conflict = () => new AppError(409, 'This upload slot is no longer available.');

/** The request body was missing or malformed. */
const badRequest = (message) => new AppError(400, message);

/**
 * This client is going too fast. Carries `Retry-After` so a well-behaved caller
 * knows when to come back instead of hammering.
 *
 * @param {number} retryAfterSeconds
 */
const tooManyRequests = (retryAfterSeconds) =>
  new AppError(429, 'Too many requests. Please wait a moment and try again.', {
    'Retry-After': String(retryAfterSeconds),
  });

/**
 * The service is full.
 *
 * Deliberately 503 rather than 429: a service-wide capacity limit and a
 * per-client throttle are different conditions, and conflating them hides a
 * real operational problem behind what looks like ordinary throttling.
 */
const capacityExhausted = () =>
  new AppError(503, 'This service is temporarily full. Please try again later.');

module.exports = { AppError, gone, conflict, badRequest, tooManyRequests, capacityExhausted };
