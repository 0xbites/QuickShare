'use strict';

const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const validateUuid = require('../middlewares/validateUuid');
const { gone } = require('../services/errors');

/**
 * The share link's landing page.
 *
 * Mounted at `/files`. This renders a page; it never serves file bytes. That
 * split is what lets the download route stay a plain byte endpoint, and it is
 * why the mount order in `server.js` works.
 *
 * The server cannot know what the file is called, so the page shows only the
 * size and the expiry. The filename appears after the browser decrypts.
 *
 * @param {object} deps
 * @param {import('../services/DownloadService')} deps.downloadService
 * @returns {import('express').Router}
 */
function createShowRouter({ downloadService }) {
  const router = express.Router();

  router.get(
    '/:uuid',
    validateUuid(gone),
    asyncHandler(async (req, res) => {
      const file = await downloadService.resolve(req.params.uuid);
      res.render('download', {
        uuid: file.uuid,
        sizeBytes: file.sizeBytes,
        expiresAt: file.expiresAt,
      });
    }),
  );

  return router;
}

module.exports = createShowRouter;
