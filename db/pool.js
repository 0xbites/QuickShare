'use strict';

const { Pool } = require('pg');
const env = require('../config/env');

/**
 * The single Postgres connection pool for the process.
 *
 * Hosted providers such as Neon require TLS but present certificates that the
 * default Node trust store rejects, so verification is relaxed for remote
 * hosts. Local development connections are left plain.
 */
const isLocal = /@(localhost|127\.0\.0\.1|\/)/.test(env.databaseUrl);

const pool = new Pool({
  connectionString: env.databaseUrl,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A pool error means an idle client died. Without a listener Node treats it as
// an unhandled error event and exits the process.
pool.on('error', (err) => {
  console.error('Unexpected Postgres pool error:', err.message);
});

module.exports = pool;
