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
});
