'use strict';

const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');

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
 * @param {number} deps.maxUploadBytes
 * @returns {import('express').Router}
 */
function createFilesRouter({ uploadService, maxUploadBytes }) {
  const router = express.Router();

  /**
   * Reserves a uuid. Must happen before the browser encrypts, because the uuid
   * is bound into the ciphertext as additional authenticated data.
   */
  router.post(
    '/allocate',
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
    express.raw({ type: 'application/octet-stream', limit: maxUploadBytes }),
    asyncHandler(async (req, res) => {
      await uploadService.store(req.params.uuid, req.body);
      res.status(204).end();
    }),
  );

  return router;
}

module.exports = createFilesRouter;
