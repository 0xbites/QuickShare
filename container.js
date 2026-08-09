'use strict';

const path = require('node:path');

const env = require('./config/env');
const pool = require('./db/pool');

const PostgresFileRepository = require('./repositories/PostgresFileRepository');
const PostgresReportRepository = require('./repositories/PostgresReportRepository');
const DiskStorageGateway = require('./storage/DiskStorageGateway');
const S3StorageGateway = require('./storage/S3StorageGateway');
const { signRequest } = require('./storage/signV4');
const MemoryRateLimiter = require('./rateLimit/MemoryRateLimiter');

const AdmissionService = require('./services/AdmissionService');
const UploadService = require('./services/UploadService');
const DownloadService = require('./services/DownloadService');
const ExpiryService = require('./services/ExpiryService');
const ReportService = require('./services/ReportService');
const DeletionService = require('./services/DeletionService');

/**
 * Builds the object graph.
 *
 * Extracted from `server.js` so the operator CLI scripts can construct the same
 * services without starting an HTTP listener. This is the only module that
 * names concrete adapters; everything else depends on ports.
 *
 * @returns {Promise<object>}
 */
async function createContainer() {
  // The only place either adapter is named. Services depend on the port, so
  // nothing downstream knows or cares which one is in use.
  const storageGateway =
    env.storageDriver === 's3'
      ? new S3StorageGateway({ ...env.s3, signRequest })
      : new DiskStorageGateway(path.join(__dirname, 'uploads'));

  // Verifies the directory exists, or that the bucket is reachable and the
  // credentials are accepted. Either way, a failure here stops the boot.
  await storageGateway.init();

  const fileRepository = new PostgresFileRepository(pool);
  const reportRepository = new PostgresReportRepository(pool);

  const admissionService = new AdmissionService({
    fileRepository,
    storageCeilingBytes: env.storageCeilingBytes,
  });

  // One limiter per endpoint, so reserving a slot and uploading 100 MB draw on
  // separate budgets. Sharing one would let cheap calls exhaust the allowance
  // for expensive ones and vice versa.
  const limiter = ({ max, windowMs }) =>
    new MemoryRateLimiter({ max, windowMs, maxKeys: env.rateLimitMaxKeys });

  return {
    pool,
    storageGateway,
    fileRepository,
    admissionService,

    uploadService: new UploadService({
      fileRepository,
      storageGateway,
      admissionService,
      retentionHours: env.retentionHours,
    }),
    downloadService: new DownloadService({ fileRepository, storageGateway }),
    expiryService: new ExpiryService({ fileRepository, storageGateway }),
    reportService: new ReportService({ reportRepository, ipHashSecret: env.ipHashSecret }),
    deletionService: new DeletionService({ fileRepository, storageGateway }),

    allocateLimiter: limiter(env.allocateRate),
    uploadLimiter: limiter(env.uploadRate),
    reportLimiter: limiter(env.reportRate),
  };
}

module.exports = createContainer;
