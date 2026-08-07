'use strict';

const createContainer = require('../container');

/**
 * Lists reported files, most reported first.
 *
 *     npm run reports
 *
 * `present` shows whether the file is still stored. A report against a file
 * that has already expired needs no action, and separating those is most of
 * what makes the list usable.
 */
async function main() {
  const services = await createContainer();

  try {
    const summaries = await services.reportService.summarise();

    if (summaries.length === 0) {
      console.log('No abuse reports.');
      return;
    }

    console.table(
      summaries.map((row) => ({
        uuid: row.fileUuid,
        reports: row.reportCount,
        'last reported': row.lastReportedAt.toISOString().replace('T', ' ').slice(0, 16),
        present: row.fileStillPresent ? 'yes' : 'expired',
      })),
    );
    console.log('Remove one with:  npm run takedown -- <uuid>');
  } finally {
    await services.pool.end();
  }
}

main().catch((err) => {
  console.error('Failed to list reports:', err.message);
  process.exit(1);
});
