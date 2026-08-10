# QuickShare

Ephemeral file sharing where the server cannot read the files it stores.
Live at **[quickshare-har5.onrender.com](https://quickshare-har5.onrender.com)**.

Files are encrypted in the sender's browser before upload. The key is placed in the URL fragment — the
part after `#` — which browsers never transmit and strip from `Referer`. The server receives ciphertext
and a byte count, and has no code path that could log a key, because none ever arrives.

This is zero knowledge of **content**, not of everything. The service still knows that a file exists, how
large it is, when it arrived, and which addresses uploaded and downloaded it. It is also unrelated to
zero-knowledge *proofs*, which is a different subject that shares the name.

| | |
|---|---|
| ![Sending a file](.github/screenshots/share.png) | ![Receiving a file](.github/screenshots/receive.png) |

## Where the guarantee stops

The server cannot read your file, but it does serve the JavaScript that can. A compromised or malicious
host could ship a modified page that copies the key out of the fragment.

That converts *"the operator will not read my files"* into *"the operator will not serve malicious
JavaScript"*. Weaker — but a meaningfully different kind of weaker. Reading a file server-side leaves no
trace; serving backdoored code is a deliberate act, delivered to every visitor, and visible to anyone who
looks at the page source. Every web-delivered end-to-end encrypted product has this property.

It is also why there is no client framework and no third-party script on any page: on the download page,
bundle size is a security property, because every line of JavaScript there can read `location.hash`.

## How it works

1. The browser asks the server to reserve a uuid. This has to happen first, because the uuid is bound
   into the ciphertext.
2. The browser generates a 256-bit AES-GCM key, builds a small header holding the original filename and
   MIME type, and encrypts header and file together. The uuid is passed as additional authenticated data,
   so a blob served under a different uuid fails its tag check instead of decrypting into something
   unexpected.
3. The ciphertext is uploaded. The share link is assembled **in the browser** — the server never sees it,
   because it contains the key.
4. The recipient's browser reads the key from the fragment, clears it from the address bar, fetches the
   ciphertext, and decrypts. The original filename is recovered from inside the envelope, which is why no
   `Content-Disposition` header is ever sent.

Stored bytes are `IV ‖ ciphertext ‖ tag`. Links expire after 24 hours, enforced as a predicate on every
lookup rather than by a cleanup job — so a link is dead the moment it expires, whether or not anything
has run.

## Running it

Requires Node 20+ and PostgreSQL 13+ (`gen_random_uuid()` sets that floor). There is no build step.

```sh
npm ci
cp .env.example .env      # then fill in DATABASE_URL
npm run serve
```

The schema is applied automatically at boot and is idempotent, so there is no migration step. The default
storage driver writes blobs to `uploads/` on local disk, which is fine for development.

Two operator commands, neither of which decrypts anything:

```sh
npm run reports              # abuse reports, most-reported first
npm run takedown -- <uuid>   # remove a file and its metadata
```

## Architecture

Server-rendered Express with no client framework, four runtime dependencies (`express`, `ejs`, `dotenv`,
`pg`), and no bundler — the JavaScript served is the JavaScript in this repository.

```
routes/         HTTP only, no business logic
services/       what the application does
repositories/   port + Postgres adapter        metadata
storage/        port + disk and S3 adapters    blobs
rateLimit/      port + in-memory adapter
container.js    the only file that names concrete adapters
```

Services depend on interfaces, never on `pg` or `fs`, so swapping either store is one new adapter class
and one line in the composition root. That claim was tested rather than asserted: moving blobs from local
disk to S3-compatible object storage for deployment touched no service, route, or view.

Metadata lives in Postgres and holds no filename, MIME type, or key — the schema is the enforcement. The
public `uuid` and the internal `storage_key` are deliberately different values, so the object store cannot
correlate a blob with a share link.

## Configuration

Every setting is an environment variable, documented in `.env.example`. `DATABASE_URL` is the only one
without a usable default.

Two worth knowing before deploying behind a proxy or load balancer:

- **`TRUST_PROXY`** decides whether `req.ip` is the client or the balancer, which every rate limit keys
  on. Unset behind a proxy, every visitor shares one bucket. Set too broadly, clients forge
  `X-Forwarded-For` and bypass limits. Set it to the number of proxies actually in front.
- **`STORAGE_DRIVER`** must be `s3` on any host with an ephemeral filesystem. On local disk, blobs vanish
  on restart while their metadata survives, so links resolve to nothing.

## Limitations

Stated rather than discovered later.

- **No malware scanning, and none is possible.** The server holds ciphertext and no key, so it cannot
  inspect what it stores. Abuse reporting and takedown are the only moderation available, and endpoint
  antivirus still applies because files are decrypted on the recipient's machine.
- **Metadata leaks.** Ciphertext length approximates plaintext length. Upload and download addresses and
  timings can link a sender to a recipient.
- **Rate limits are per process.** Counters live in memory and are not shared, so the effective ceiling is
  the configured value multiplied by however many instances are running. Treat a configured limit as a
  floor on what gets through, not a ceiling.
- **Whole objects are buffered in memory** on both the upload and download paths, which is what caps the
  practical file size on a small instance. Streaming is the fix and is not done.
- **No owner tokens.** A sender cannot revoke a link before it expires; only the operator can.

## License

ISC.
