'use strict';

const ReportRepository = require('./ReportRepository');

/** Postgres-backed abuse reports. */
class PostgresReportRepository extends ReportRepository {
  /** @param {import('pg').Pool} pool */
  constructor(pool) {
    super();
    this.pool = pool;
  }

  /** @inheritdoc */
  async record({ fileUuid, reason, reporterIpHash }) {
    await this.pool.query(
      `INSERT INTO abuse_reports (file_uuid, reason, reporter_ip_hash)
       VALUES ($1, $2, $3)`,
      [fileUuid, reason, reporterIpHash],
    );
  }

  /** @inheritdoc */
  async summarise(limit) {
    // The LEFT JOIN answers "is this still up?", which is what decides whether
    // an operator needs to act or the file already expired on its own.
    const { rows } = await this.pool.query(
      `SELECT r.file_uuid,
              count(*)          AS report_count,
              max(r.created_at) AS last_reported_at,
              (f.uuid IS NOT NULL) AS file_still_present
         FROM abuse_reports r
         LEFT JOIN files f ON f.uuid = r.file_uuid
        GROUP BY r.file_uuid, f.uuid
        ORDER BY count(*) DESC, max(r.created_at) DESC
        LIMIT $1`,
      [limit],
    );

    return rows.map((row) => ({
      fileUuid: row.file_uuid,
      reportCount: Number(row.report_count),
      lastReportedAt: row.last_reported_at,
      fileStillPresent: row.file_still_present,
    }));
  }
}

module.exports = PostgresReportRepository;
