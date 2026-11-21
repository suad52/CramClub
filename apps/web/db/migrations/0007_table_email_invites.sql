-- Email invites to private tables. The holder of a private table can invite someone by the email
-- they signed up with. No email address is stored anywhere: a learner gets email_hash, a keyed
-- HMAC-SHA256 (hex) of their trimmed, lowercased address, only while Auth0 says it's verified,
-- and an invite keeps the same hash of what the holder typed plus a masked form for the holder's
-- own list (for example bi•••@gmail.com). lib/auth/emailHash.ts makes both. An invite belongs to
-- one hold, so it ends with that hold (lib/tables/server.ts decides who may sit).
-- Applied by db/migrate.mjs one statement at a time, so keep semicolons out of comments.

-- One account per verified address (the latest verified sign-in takes it, see identity.ts).
ALTER TABLE learners ADD COLUMN IF NOT EXISTS email_hash text UNIQUE
  CHECK (email_hash ~ '^[0-9a-f]{64}$');

CREATE TABLE IF NOT EXISTS table_hold_email_invites (
  id uuid PRIMARY KEY,
  hold_id uuid NOT NULL REFERENCES table_holds ON DELETE CASCADE,
  email_hash text NOT NULL CHECK (email_hash ~ '^[0-9a-f]{64}$'),
  masked text NOT NULL CHECK (char_length(masked) BETWEEN 4 AND 300),
  created_by uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hold_id, email_hash)
);

-- "Which live holds invited me?" (every table read asks, for the signed-in student's hash).
CREATE INDEX IF NOT EXISTS table_hold_email_invites_email
  ON table_hold_email_invites (email_hash);
