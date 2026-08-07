'use strict';

const express = require('express');
const asyncHandler = require('../middlewares/asyncHandler');
const validateUuid = require('../middlewares/validateUuid');
const rateLimit = require('../middlewares/rateLimit');
const clientKey = require('../rateLimit/clientKey');
const { badRequest } = require('../services/errors');

/**
 * Abuse reporting. Mounted at `/api/reports`.
 *
 * Unauthenticated by design — requiring credentials to report abuse would
 * suppress the reports that matter most.
 *
 * Responds `202 Accepted` rather than `201`: the report is recorded, but
 * nothing has been decided about it yet, and a reporter should not be led to
 * think the file has been removed.
 *
 * @param {object} deps
 * @param {import('../services/ReportService')} deps.reportService
 * @param {import('../rateLimit/RateLimiter')} deps.reportLimiter
 * @returns {import('express').Router}
 */
function createReportsRouter({ reportService, reportLimiter }) {
  const router = express.Router();

  router.post(
    '/:uuid',
    rateLimit(reportLimiter),
    // A report for a nonexistent uuid is rejected the same way an unknown file
    // is elsewhere, so the endpoint cannot be used to probe which uuids exist.
    validateUuid(() => badRequest('Unknown file.')),
    express.json({ limit: '4kb' }),
    asyncHandler(async (req, res) => {
      await reportService.record({
        fileUuid: req.params.uuid,
        reason: req.body?.reason,
        clientKey: clientKey(req),
      });

      res.status(202).json({ recorded: true });
    }),
  );

  return router;
}

module.exports = createReportsRouter;
