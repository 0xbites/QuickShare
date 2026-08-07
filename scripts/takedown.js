'use strict';

const createContainer = require('../container');

/**
 * Removes a file by uuid.
 *
 *     npm run takedown -- <uuid>
 *
 * No decryption is involved, and none is possible. Acting on metadata alone is
 * the only moderation available to a zero-knowledge service, and it is enough:
 * an unreachable file is unreachable whatever it contained.
 *
 * Deliberately a CLI and not an HTTP route. Exposing takedown over the network
 * would require an authentication system the project does not otherwise need;
 * running it as whoever already holds the database credentials adds no new
 * attack surface.
 */
async function main() {
  const uuid = process.argv[2];

  if (!uuid) {
    console.error('Usage: npm run takedown -- <uuid>');
    process.exit(2);
  }

  const services = await createContainer();

  try {
    const removed = await services.deletionService.takedown(uuid);
    console.log(removed ? `Removed ${uuid}` : `No such file: ${uuid}`);
    process.exitCode = removed ? 0 : 1;
  } finally {
    await services.pool.end();
  }
}

main().catch((err) => {
  console.error('Takedown failed:', err.message);
  process.exit(1);
});
