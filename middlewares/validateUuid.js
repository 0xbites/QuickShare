'use strict';

/**
 * Rejects a malformed `:uuid` before it reaches the database.
 *
 * Without this, a request for `/files/nonsense` reaches Postgres and fails with
 * an invalid-input-syntax error, which surfaces as a 500 for what is really a
 * bad request.
 *
 * The rejection deliberately reuses whichever error the route uses for an
 * unknown record, so a malformed uuid and an unknown one are indistinguishable
 * from outside. That keeps the endpoint from confirming which identifiers
 * exist.
 *
 * @param {() => Error} errorFactory produces the error to throw on a bad uuid
 * @returns {import('express').RequestHandler}
 */
function validateUuid(errorFactory) {
  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  return (req, res, next) => {
    if (!UUID_PATTERN.test(req.params.uuid)) {
      next(errorFactory());
      return;
    }
    next();
  };
}

module.exports = validateUuid;
