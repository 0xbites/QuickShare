'use strict';

const { AppError } = require('../services/errors');

/**
 * The single place errors become responses.
 *
 * Only `AppError` messages are shown to clients; anything else is logged and
 * reported as a generic 500, so internal details never leak into a response.
 *
 * Content negotiation matters here because the same failure can arrive from an
 * API call or a page navigation. A `fetch` should receive JSON it can act on; a
 * browser navigating to a dead link should receive a readable page.
 *
 * Must be registered last, and must keep all four parameters — Express
 * identifies error handlers by arity.
 *
 * @type {import('express').ErrorRequestHandler}
 */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const expected = err instanceof AppError;

  // Body parsers signal an oversized request this way.
  const tooLarge = err.type === 'entity.too.large';

  const status = tooLarge ? 413 : expected ? err.status : 500;
  const message = tooLarge
    ? 'That file is larger than this server accepts.'
    : expected
      ? err.message
      : 'Something went wrong.';

  if (!expected && !tooLarge) {
    console.error('Unhandled error:', err);
  }

  if (res.headersSent) return;

  // Some failures imply headers — a 429 is not actionable without Retry-After.
  if (expected) {
    for (const [name, value] of Object.entries(err.headers ?? {})) {
      res.setHeader(name, value);
    }
  }

  if (req.accepts(['html', 'json']) === 'json' || req.path.startsWith('/api/')) {
    res.status(status).json({ error: message });
    return;
  }

  res.status(status).render('error', { message });
}

module.exports = errorHandler;
