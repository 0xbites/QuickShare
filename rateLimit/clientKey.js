'use strict';

/**
 * Derives the rate-limit key for a request.
 *
 * ## Why IPv6 is truncated
 *
 * A residential IPv6 allocation is usually a /64 or larger, so an entire subnet
 * belongs to one customer. Keying on the full address would let a single client
 * rotate through billions of addresses and never hit a limit. Truncating to the
 * first four hextets applies the limit to the subscriber rather than to an
 * address they can mint at will.
 *
 * IPv4 has no equivalent problem — an address is scarce — so it is used whole.
 *
 * ## `req.ip` is only trustworthy if trust proxy is configured
 *
 * Behind a load balancer, `req.ip` is the balancer unless Express is told to
 * trust `X-Forwarded-For`. Left unset, every client shares one bucket and the
 * first busy user locks out everyone. See `TRUST_PROXY` in `config/env.js`.
 *
 * @param {import('express').Request} req
 * @returns {string}
 */
function clientKey(req) {
  const address = req.ip || req.socket.remoteAddress || 'unknown';

  // Express reports IPv4-mapped IPv6 addresses as '::ffff:1.2.3.4'.
  const unmapped = address.startsWith('::ffff:') ? address.slice(7) : address;

  if (!unmapped.includes(':')) return unmapped;

  return `${unmapped.split(':').slice(0, 4).join(':')}::/64`;
}

module.exports = clientKey;
