'use strict';

const FileRepository = require('./FileRepository');

/**
 * Converts a database row into the shape the rest of the application uses.
 * Keeping this in one place means snake_case never escapes this file.
 *
 * @param {object|undefined} row
 * @returns {import('./FileRepository').FileRecord|null}
 */
function toRecord(row) {
  if (!row) return null;
  return {
    uuid: row.uuid,
    storageKey: row.storage_key,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    createdAt: row.created_at,
    storedAt: row.stored_at,
    expiresAt: row.expires_at,
  };
}

/**
 * The only file in the application that contains SQL.
 *
 * Every expiry comparison uses Postgres `now()` rather than a timestamp
 * computed in Node, so all instances share one clock and cannot disagree about
 * whether a link is still alive.
 */
class PostgresFileRepository extends FileRepository {
  /** @param {import('pg').Pool} pool */
  constructor(pool) {
    super();
    this.pool = pool;
  }

  /** @inheritdoc */
  async allocate({ storageKey, retentionHours }) {
    const { rows } = await this.pool.query(
      `INSERT INTO files (storage_key, expires_at)
       VALUES ($1, now() + make_interval(hours => $2))
       RETURNING *`,
      [storageKey, retentionHours],
    );
    return toRecord(rows[0]);
  }

  /** @inheritdoc */
  async markStored(uuid, sizeBytes) {
    // The `stored_at IS NULL` guard makes this a one-shot transition: a second
    // store attempt for the same uuid matches no row and returns null.
    const { rows } = await this.pool.query(
      `UPDATE files
          SET stored_at = now(), size_bytes = $2
        WHERE uuid = $1
          AND stored_at IS NULL
          AND expires_at > now()
        RETURNING *`,
      [uuid, sizeBytes],
    );
    return toRecord(rows[0]);
  }

  /** @inheritdoc */
  async findResolvable(uuid) {
    const { rows } = await this.pool.query(
      `SELECT * FROM files
        WHERE uuid = $1
          AND stored_at IS NOT NULL
          AND expires_at > now()`,
      [uuid],
    );
    return toRecord(rows[0]);
  }

  /** @inheritdoc */
  async findByUuid(uuid) {
    const { rows } = await this.pool.query('SELECT * FROM files WHERE uuid = $1', [uuid]);
    return toRecord(rows[0]);
  }

  /** @inheritdoc */
  async deleteExpired(abandonedAfterMinutes) {
    // Two classes of dead row: links past their expiry, and allocations whose
    // upload never arrived. The grace period must exceed the longest plausible
    // upload so a slow transfer is not swept mid-flight.
    const { rows } = await this.pool.query(
      `DELETE FROM files
        WHERE expires_at <= now()
           OR (stored_at IS NULL
               AND created_at < now() - make_interval(mins => $1))
        RETURNING storage_key`,
      [abandonedAfterMinutes],
    );
    return rows.map((row) => row.storage_key);
  }
}

module.exports = PostgresFileRepository;
