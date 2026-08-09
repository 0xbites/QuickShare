'use strict';

require('dotenv').config();

/**
 * Reads and validates configuration once, at require time.
 *
 * Every value the application needs is resolved here so that no other module
 * reaches into `process.env`. A missing required variable throws immediately
 * rather than surfacing later as a confusing runtime failure.
 */

/** @param {string} name @returns {string} */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** @param {string} name @param {number} fallback @returns {number} */
function integer(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Environment variable ${name} must be a positive integer, got: ${raw}`);
  }
  return value;
}

/**
 * @param {string} name
 * @param {string[]} allowed
 * @param {string} fallback
 * @returns {string}
 */
function oneOf(name, allowed, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;

  if (!allowed.includes(raw)) {
    throw new Error(`Environment variable ${name} must be one of ${allowed.join(', ')}, got: ${raw}`);
  }
  return raw;
}

/**
 * Where blob bytes are kept.
 *
 * `disk` is correct for local development. `s3` is required on any host with an
 * ephemeral filesystem, which includes every free tier worth using — otherwise
 * blobs vanish on restart while their rows survive, and a link resolves to
 * nothing.
 *
 * A typo throws rather than falling back to `disk`, because a silent fallback in
 * production would reintroduce exactly that failure.
 */
const storageDriver = oneOf('STORAGE_DRIVER', ['disk', 's3'], 'disk');

/**
 * Object storage credentials, required only when that driver is selected.
 *
 * Gated so local development needs no Cloudflare account, while a deployment that
 * forgets a credential fails at boot with the same message shape as every other
 * missing variable.
 *
 * @returns {object|null}
 */
function s3Config() {
  if (storageDriver !== 's3') return null;

  return {
    endpoint: required('S3_ENDPOINT'),
    bucket: required('S3_BUCKET'),
    accessKeyId: required('S3_ACCESS_KEY_ID'),
    secretAccessKey: required('S3_SECRET_ACCESS_KEY'),
    // R2 ignores the region but SigV4 requires one in the credential scope.
    region: process.env.S3_REGION || 'auto',
  };
}

/**
 * Express's `trust proxy` setting.
 *
 * Both possible mistakes here are damaging, so it is explicit configuration
 * with a safe default rather than a guess:
 *
 * - unset behind a load balancer, every client shares the balancer's address,
 *   so one busy user exhausts the rate limit for everybody;
 * - set too broadly, a client spoofs `X-Forwarded-For` and bypasses limits.
 *
 * Set `TRUST_PROXY=1` on Render (one proxy in front). Leave it off locally.
 *
 * @returns {boolean|number|string}
 */
function trustProxy() {
  const raw = process.env.TRUST_PROXY;
  if (!raw || raw === 'false' || raw === '0') return false;
  if (raw === 'true') return true;

  const hops = Number(raw);
  return Number.isInteger(hops) && hops > 0 ? hops : raw;
}

/**
 * Secret used to hash reporter IP addresses.
 *
 * Optional. Without it a random value is generated per process, which keeps the
 * addresses out of the database but means hashes stop matching across restarts,
 * so a persistent spammer cannot be recognised after a redeploy.
 *
 * @returns {string}
 */
function ipHashSecret() {
  const configured = process.env.IP_HASH_SECRET;
  if (configured) return configured;

  console.warn('IP_HASH_SECRET is not set; reporter hashes will not survive a restart.');
  return require('node:crypto').randomBytes(32).toString('hex');
}

module.exports = Object.freeze({
  /** Postgres connection string. */
  databaseUrl: required('DATABASE_URL'),

  /** Origin used to build share links. Trailing slash removed so joins are predictable. */
  appBaseUrl: required('APP_BASE_URL').replace(/\/+$/, ''),

  port: integer('PORT', 3000),

  /** How long a share link stays alive. */
  retentionHours: integer('RETENTION_HOURS', 24),

  /** Largest request body accepted on the store endpoint, in bytes. */
  maxUploadBytes: integer('MAX_UPLOAD_BYTES', 100 * 1024 * 1024),

  /** How often expired rows and their blobs are swept. */
  sweepIntervalMs: integer('SWEEP_INTERVAL_MS', 60 * 60 * 1000),

  /** Which storage adapter the composition root builds: 'disk' or 's3'. */
  storageDriver,

  /** Object storage settings, or null when the disk driver is selected. */
  s3: s3Config(),

  trustProxy: trustProxy(),

  ipHashSecret: ipHashSecret(),

  /**
   * Service-wide cap on total stored bytes. Checked against real body lengths,
   * never a size the client claims. This is the control that protects the bill.
   */
  storageCeilingBytes: integer('STORAGE_CEILING_BYTES', 5 * 1024 * 1024 * 1024),

  /** Hard cap on tracked clients per limiter, bounding counter-map memory. */
  rateLimitMaxKeys: integer('RATE_LIMIT_MAX_KEYS', 50_000),

  /** Slot reservation is cheap per call, so this is the flood-control limit. */
  allocateRate: {
    max: integer('ALLOCATE_RATE_MAX', 20),
    windowMs: integer('ALLOCATE_RATE_WINDOW_MS', 60 * 1000),
  },

  /** Uploads cost bandwidth and disk, so this is tighter than allocate. */
  uploadRate: {
    max: integer('UPLOAD_RATE_MAX', 10),
    windowMs: integer('UPLOAD_RATE_WINDOW_MS', 60 * 1000),
  },

  /** Reporting must stay easy, so this only has to stop bulk spam. */
  reportRate: {
    max: integer('REPORT_RATE_MAX', 5),
    windowMs: integer('REPORT_RATE_WINDOW_MS', 60 * 60 * 1000),
  },
});
