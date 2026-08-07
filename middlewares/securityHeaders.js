'use strict';

/**
 * Response headers that protect the decryption key.
 *
 * The download page holds the key in `location.hash`. Any script running on
 * that page can read it, so the defence is to guarantee that no script from
 * anywhere else can ever load there. `default-src 'self'` is what enforces
 * that, and it is the reason the project self-hosts its assets instead of
 * pulling icons from a CDN — a CDN tag on this page would be a third party with
 * read access to the key.
 *
 * `referrer-policy` is belt and braces: browsers already strip the fragment
 * from `Referer`, but a narrow policy also stops the uuid leaking to any
 * external destination a user navigates to.
 *
 * Written by hand rather than pulling in `helmet`, because at five headers the
 * dependency costs more than it saves.
 *
 * @type {import('express').RequestHandler}
 */
function securityHeaders(req, res, next) {
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      // The decrypted file is handed to the browser as a blob: URL.
      "connect-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  );

  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  next();
}

module.exports = securityHeaders;
