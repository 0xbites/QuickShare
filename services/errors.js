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
   */
  constructor(status, message) {
    super(message);
    this.name = 'AppError';
    this.status = status;
  }
}

/** The link is unknown, expired, or was never completed. */
const gone = () => new AppError(410, 'This link has expired or does not exist.');

/** The allocation is unknown, already used, or expired before the upload landed. */
const conflict = () => new AppError(409, 'This upload slot is no longer available.');

/** The request body was missing or malformed. */
const badRequest = (message) => new AppError(400, message);

module.exports = { AppError, gone, conflict, badRequest };
