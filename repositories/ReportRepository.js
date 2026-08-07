'use strict';

/**
 * Port for abuse-report storage.
 *
 * Separate from `FileRepository` because reports outlive the files they concern
 * — removing a file must not erase the record of why it was removed — so the
 * two have genuinely different lifetimes.
 *
 * @typedef {object} ReportSummary
 * @property {string} fileUuid
 * @property {number} reportCount
 * @property {Date}   lastReportedAt
 * @property {boolean} fileStillPresent
 */
class ReportRepository {
  /**
   * @param {{ fileUuid: string, reason: string, reporterIpHash: string }} _report
   * @returns {Promise<void>}
   */
  async record(_report) {
    throw new Error('ReportRepository.record is not implemented');
  }

  /**
   * Reported files, most reported first, for an operator to triage.
   *
   * @param {number} _limit
   * @returns {Promise<ReportSummary[]>}
   */
  async summarise(_limit) {
    throw new Error('ReportRepository.summarise is not implemented');
  }
}

module.exports = ReportRepository;
