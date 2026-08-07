'use strict';

/**
 * Wraps an async route handler so a rejected promise reaches Express.
 *
 * Express 4 does not await handlers, so a promise that rejects is an unhandled
 * rejection: the client's request hangs until it times out and nothing is
 * logged. Wrapping every async handler in this converts that into a normal
 * `next(err)` and therefore a real response.
 *
 * Express 5 handles this natively; this wrapper can be deleted on upgrade.
 *
 * @param {(req: import('express').Request, res: import('express').Response) => Promise<unknown>} handler
 * @returns {import('express').RequestHandler}
 */
function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

module.exports = asyncHandler;
