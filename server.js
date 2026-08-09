'use strict';

const path = require('node:path');
const express = require('express');

const env = require('./config/env');
const migrate = require('./db/migrate');
const createContainer = require('./container');

const createFilesRouter = require('./routes/files');
const createShowRouter = require('./routes/show');
const createDownloadRouter = require('./routes/download');
const createReportsRouter = require('./routes/reports');

const securityHeaders = require('./middlewares/securityHeaders');
const errorHandler = require('./middlewares/errorHandler');
const asyncHandler = require('./middlewares/asyncHandler');

/**
 * HTTP wiring and startup.
 *
 * The object graph itself lives in `container.js`, so the operator CLI can
 * build the same services without starting a listener.
 *
 * @param {Awaited<ReturnType<typeof createContainer>>} services
 * @returns {import('express').Express}
 */
function buildApp(services) {
  const app = express();

  app.set('views', path.join(__dirname, 'views'));
  app.set('view engine', 'ejs');
  app.disable('x-powered-by');

  // Decides whether `req.ip` is the client or the load balancer, which is what
  // every rate limit is keyed on. Wrong either way is damaging, so it is
  // explicit configuration rather than a guess — see config/env.js.
  app.set('trust proxy', env.trustProxy);

  app.use(securityHeaders);

  /**
   * Deployment health check.
   *
   * Queries the database rather than returning a bare 200, because a process that
   * booted but cannot reach Postgres is not healthy — it would report success
   * while failing every real route. Deliberately not rate limited: a limiter here
   * would let one noisy client make the service look down.
   */
  app.get(
    '/healthz',
    asyncHandler(async (req, res) => {
      await services.pool.query('SELECT 1');
      res.json({ ok: true });
    }),
  );

  // Absolute path, so behaviour does not depend on the working directory.
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/', (req, res) => res.render('home'));

  app.use(
    '/api/files',
    createFilesRouter({
      uploadService: services.uploadService,
      allocateLimiter: services.allocateLimiter,
      uploadLimiter: services.uploadLimiter,
      maxUploadBytes: env.maxUploadBytes,
    }),
  );

  app.use(
    '/api/reports',
    createReportsRouter({
      reportService: services.reportService,
      reportLimiter: services.reportLimiter,
    }),
  );

  // Registered before '/files' so the more specific prefix wins outright.
  // Relying on '/files/:uuid' failing to match two path segments would work
  // today and break the moment a multi-segment route is added to show.
  app.use('/files/download', createDownloadRouter({ downloadService: services.downloadService }));
  app.use('/files', createShowRouter({ downloadService: services.downloadService }));

  app.use((req, res) => res.status(404).render('error', { message: 'Page not found.' }));

  // Last, and after every route, or errors bypass it.
  app.use(errorHandler);

  return app;
}

async function start() {
  await migrate();

  const services = await createContainer();

  // Once per process, at startup. Never in the request path: scheduling from
  // middleware is how the previous version accumulated one duplicate job per
  // request served.
  services.expiryService.start(env.sweepIntervalMs);

  const server = buildApp(services).listen(env.port, () => {
    console.log(`QuickShare listening on ${env.appBaseUrl} (port ${env.port})`);
    console.log(
      `  storage ceiling ${(env.storageCeilingBytes / 1024 ** 3).toFixed(1)} GB` +
        ` · trust proxy ${env.trustProxy}`,
    );
  });

  // Finish in-flight requests and hand connections back before exiting, so a
  // deploy does not sever an upload mid-transfer.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
      server.close(() => services.pool.end().then(() => process.exit(0)));
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

module.exports = { buildApp };
