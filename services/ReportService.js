'use strict';

const crypto = require('node:crypto');
const { badRequest } = require('./errors');

/** Longest accepted reason. Long enough to be useful, short enough not to be a payload. */
const MAX_REASON_LENGTH = 500;

/**
 * Records abuse reports.
 *
 * The only moderation signal available. Since content cannot be inspected, a
 * report is the sole way the operator learns that something needs removing —
 * this is precisely the capability Firefox Send lacked when Mozilla withdrew it
 * in 2020 over malware distribution.
 *
 * Reporting is unauthenticated on purpose. Requiring an account to report abuse
 * would suppress exactly the reports that matter.
 */
class ReportService {
  /**
   * @param {object} deps
   * @param {import('../repositories/ReportRepository')} deps.reportRepository
   * @param {string} deps.ipHashSecret
   */
  constructor({ reportRepository, ipHashSecret }) {
    this.reportRepository = reportRepository;
    this.ipHashSecret = ipHashSecret;
  }

  /**
   * @param {{ fileUuid: string, reason: unknown, clientKey: string }} input
   * @returns {Promise<void>}
   */
  async record({ fileUuid, reason, clientKey }) {
    if (typeof reason !== 'string' || reason.trim().length === 0) {
      throw badRequest('A reason is required.');
    }

    await this.reportRepository.record({
      fileUuid,
      reason: reason.trim().slice(0, MAX_REASON_LENGTH),
      reporterIpHash: this.hashClient(clientKey),
    });
  }

  /**
   * @param {number} [limit]
   * @returns {Promise<import('../repositories/ReportRepository').ReportSummary[]>}
   */
  summarise(limit = 50) {
    return this.reportRepository.summarise(limit);
  }

  /**
   * Hashes a client identifier before it is stored.
   *
   * Keyed with a secret rather than a bare SHA-256: the space of IP addresses is
   * small enough to enumerate exhaustively, so an unkeyed digest is reversible
   * by brute force and would not be anonymisation at all.
   *
   * @param {string} clientKey
   * @returns {string}
   */
  hashClient(clientKey) {
    return crypto.createHmac('sha256', this.ipHashSecret).update(clientKey).digest('hex');
  }
}

module.exports = ReportService;
