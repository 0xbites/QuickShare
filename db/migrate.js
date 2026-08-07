'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('./pool');

/**
 * Applies `schema.sql`.
 *
 * The schema is written with `IF NOT EXISTS` throughout, so running it on every
 * boot is safe and idempotent. At this size that is simpler and less
 * error-prone than a versioned migration tool; introduce one when a column ever
 * needs to change shape rather than merely appear.
 */
async function migrate() {
  const sql = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = migrate;
