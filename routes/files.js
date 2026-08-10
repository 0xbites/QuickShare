'use strict';

const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const rateLimit = require('../middlewares/rateLimit');
const validateUuid = require('../middlewares/validateUuid');
const { conflict } = require('../services/errors');

/**
 * The API used by the browser during upload.
 *
 * Mounted at `/api/files`. Every response is JSON — unlike the previous version
 * of this route, which rendered HTML from an endpoint named `/api`.
 *
 * Nothing here ever sees a key, a filename, or a content type. `store` receives
 * a buffer it treats as opaque.
 *
 * @param {object} deps
 * @param {import('../services/UploadService')} deps.uploadService
 * @param {import('../rateLimit/RateLimiter')} deps.allocateLimiter
 * @param {import('../rateLimit/RateLimiter')} deps.uploadLimiter
 * @param {number} deps.maxUploadBytes
 * @returns {import('express').Router}
 */
function createFilesRouter({ uploadService, allocateLimiter, uploadLimiter, maxUploadBytes }) {
  const router = express.Router();

  /**
   * Reserves a uuid. Must happen before the browser encrypts, because the uuid
   * is bound into the ciphertext as additional authenticated data.
   *
   * Rate limited because it is unauthenticated and writes a row per call, which
   * makes it the cheapest way to fill the database. Left open, a single client
   * sustained a rate high enough to be a real problem within an hour.
   */
  router.post(
    '/allocate',
    rateLimit(allocateLimiter),
    asyncHandler(async (req, res) => {
      const { uuid, expiresAt } = await uploadService.allocate();
      res.status(201).json({ uuid, expiresAt });
    }),
  );

  /**
   * Accepts the sealed envelope.
   *
   * `express.raw` keeps the body as a Buffer instead of trying to parse it.
   * The limit is enforced here so an oversized request is rejected while
   * streaming, rather than after it has all been buffered.
   */
  router.put(
    '/:uuid',
    // Before the body parser, so a refused client is rejected without the
    // server reading 100 MB it has already decided to discard.
    rateLimit(uploadLimiter),
    // Also before the body parser, and for the same reason. Without this a
    // malformed uuid reaches Postgres, fails as invalid input syntax, and is
    // reported as a 500 for what is really a bad request.
    validateUuid(conflict),
    express.raw({ type: 'application/octet-stream', limit: maxUploadBytes }),
    asyncHandler(async (req, res) => {
      await uploadService.store(req.params.uuid, req.body);
      res.status(204).end();
    }),
  );

  return router;
}

module.exports = createFilesRouter;
