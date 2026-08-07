'use strict';

const path = require('node:path');
const express = require('express');

const env = require('./config/env');
const pool = require('./db/pool');
const migrate = require('./db/migrate');

const PostgresFileRepository = require('./repositories/PostgresFileRepository');
const DiskStorageGateway = require('./storage/DiskStorageGateway');

const UploadService = require('./services/UploadService');
const DownloadService = require('./services/DownloadService');
const ExpiryService = require('./services/ExpiryService');

const createFilesRouter = require('./routes/files');
const createShowRouter = require('./routes/show');
const createDownloadRouter = require('./routes/download');

const securityHeaders = require('./middlewares/securityHeaders');
const errorHandler = require('./middlewares/errorHandler');

/**
 * Composition root.
 *
 * This is the only file that knows which concrete adapters are in use. Every
 * dependency is constructed here and passed inward, so swapping disk storage
 * for a bucket, or Postgres for something else, is a change to this file and
 * one new adapter — nothing in `services/` moves.
 */

/** @returns {import('express').Express} */
function buildApp({ uploadService, downloadService }) {
  const app = express();

  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.disable('x-powered-by');

  app.use(securityHeaders);

  // Absolute path, so the server behaves identically regardless of the working
  // directory it was started from.
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/', (req, res) => res.render('home'));

  app.use('/api/files', createFilesRouter({ uploadService, maxUploadBytes: env.maxUploadBytes }));

  // Registered before '/files' so the more specific prefix wins outright.
  // Relying on '/files/:uuid' failing to match two path segments would work
  // today and break the moment a multi-segment route is added to the show
  // router.
  app.use('/files/download', createDownloadRouter({ downloadService }));
  app.use('/files', createShowRouter({ downloadService }));

  app.use((req, res) => res.status(404).render('error', { message: 'Page not found.' }));

  // Last, and after every route, or errors bypass it.
  app.use(errorHandler);

  return app;
}

async function start() {
  await migrate();

  const storageGateway = new DiskStorageGateway(path.join(__dirname, 'uploads'));
  await storageGateway.init();

  const fileRepository = new PostgresFileRepository(pool);

  const uploadService = new UploadService({
    fileRepository,
    storageGateway,
    retentionHours: env.retentionHours,
  });
  const downloadService = new DownloadService({ fileRepository, storageGateway });
  const expiryService = new ExpiryService({ fileRepository, storageGateway });

  // Once per process, at startup. Never in the request path: scheduling from
  // middleware is how the previous version accumulated one duplicate job per
  // request served.
  expiryService.start(env.sweepIntervalMs);

  const server = buildApp({ uploadService, downloadService }).listen(env.port, () => {
    console.log(`QuickShare listening on ${env.appBaseUrl} (port ${env.port})`);
  });

  // Finish in-flight requests and hand connections back before exiting, so a
  // deploy does not sever an upload mid-transfer.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      server.close(() => pool.end().then(() => process.exit(0)));
    });
  }
}

// A server that cannot reach its database has nothing useful to offer, so it
// exits rather than booting and failing every request. The previous version
// logged the failure and carried on, which turned one clear startup error into
// a 500 on every route.
start().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
