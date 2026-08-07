'use strict';

const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const validateUuid = require('../middlewares/validateUuid');
const { gone } = require('../services/errors');

/**
 * Serves the sealed envelope.
 *
 * Mounted at `/files/download`. Returns `iv || ciphertext || tag` as opaque
 * bytes for the browser to decrypt; the server has no key and does nothing to
 * the buffer.
 *
 * `application/octet-stream` with no `Content-Disposition`, because the real
 * filename is inside the ciphertext. The browser recovers it after decrypting
 * and applies it when saving.
 *
 * @param {object} deps
 * @param {import('../services/DownloadService')} deps.downloadService
 * @returns {import('express').Router}
 */
function createDownloadRouter({ downloadService }) {
  const router = express.Router();

  router.get(
    '/:uuid',
    validateUuid(gone),
    asyncHandler(async (req, res) => {
      const envelope = await downloadService.readEnvelope(req.params.uuid);

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Length', envelope.length);
      // Ciphertext is unique per upload and the link is short-lived; caching it
      // anywhere in between serves no purpose.
      res.setHeader('Cache-Control', 'no-store');
      res.send(envelope);
    }),
  );

  return router;
}

module.exports = createDownloadRouter;
