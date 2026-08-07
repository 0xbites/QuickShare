'use strict';

const clientKey = require('../rateLimit/clientKey');
const { tooManyRequests } = require('../services/errors');

/**
 * Turns a `RateLimiter` into route middleware.
 *
 * The limiter is injected rather than constructed here, so each endpoint gets
 * its own budget — reserving a slot and uploading 100 MB should not draw on the
 * same allowance — and so tests can supply a fake.
 *
 * Refusal is raised as an error rather than written directly, keeping response
 * formatting in the one middleware that owns it. `errorHandler` applies the
 * `Retry-After` header the error carries.
 *
 * @param {import('../rateLimit/RateLimiter')} limiter
 * @returns {import('express').RequestHandler}
 */
function rateLimit(limiter) {
  return (req, res, next) => {
    const { allowed, retryAfterSeconds } = limiter.consume(clientKey(req));

    if (!allowed) {
      next(tooManyRequests(retryAfterSeconds));
      return;
    }
    next();
  };
}

module.exports = rateLimit;
