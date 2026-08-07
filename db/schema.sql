-- Metadata for one uploaded file.
--
-- There is deliberately no filename, MIME type or key column. The name and type
-- are encrypted inside the stored blob, and the key never reaches the server.
-- This table is the schema-level statement of the zero-knowledge property:
-- everything it can hold is something the server is allowed to know.

CREATE TABLE IF NOT EXISTS files (
  id          BIGSERIAL   PRIMARY KEY,

  -- Public handle. The only identifier that ever appears in a share link, and
  -- the value bound into the ciphertext as additional authenticated data.
  uuid        UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),

  -- Opaque name of the blob in the storage backend. Carries no file extension,
  -- because an extension would leak the file type.
  storage_key TEXT        NOT NULL UNIQUE,

  -- Null until the blob is actually stored.
  size_bytes  BIGINT,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Null means allocated but never uploaded. Distinguishing this from a
  -- completed upload is what makes abandoned allocations detectable.
  stored_at   TIMESTAMPTZ,

  expires_at  TIMESTAMPTZ NOT NULL
);

-- Supports the expiry sweep.
CREATE INDEX IF NOT EXISTS files_expires_idx ON files (expires_at);

-- Supports finding abandoned allocations. Partial, because the rows that
-- satisfy it are a small minority.
CREATE INDEX IF NOT EXISTS files_unstored_idx ON files (created_at)
  WHERE stored_at IS NULL;
