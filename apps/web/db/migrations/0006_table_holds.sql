-- Table holds: like a library booking, the first student to sit at a free table can hold it for
-- an hour (lib/tables/types.ts HOLD_MINUTES), open to everyone or private. A private table lets
-- in its holder, the guests who followed one of the holder's invite links, and (if the holder
-- picked one) the members of a Study Circle the holder belongs to. The server decides who may sit
-- (lib/tables/server.ts). A hold ends at ends_at, or earlier when released_at is set. Old rows are
-- deleted lazily, so nothing has to run on a timer.
-- Applied by db/migrate.mjs one statement at a time, so keep semicolons out of comments.

-- Lets the exclusion constraints below compare text and uuid columns with = in a GiST index.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Two people can never hold the same table at overlapping times, and nobody can hold two tables
-- at once. The database enforces both, so two claims at the same moment can't both win: the
-- second one fails with an exclusion violation, which the server turns into "someone's there".
CREATE TABLE IF NOT EXISTS table_holds (
  id uuid PRIMARY KEY,
  table_id text NOT NULL CHECK (table_id ~ '^[a-z0-9-]{1,40}$'),
  holder_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
  circle_id uuid REFERENCES study_circles ON DELETE SET NULL,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NOT NULL,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT table_holds_sane_length
    CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '3 hours'),
  CONSTRAINT table_holds_one_per_table EXCLUDE USING gist
    (table_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (released_at IS NULL),
  CONSTRAINT table_holds_one_per_holder EXCLUDE USING gist
    (holder_id WITH =, tstzrange(starts_at, ends_at) WITH &&) WHERE (released_at IS NULL)
);

-- The live holds (every read asks for these).
CREATE INDEX IF NOT EXISTS table_holds_live ON table_holds (ends_at) WHERE released_at IS NULL;

-- Who the holder let in through an invite link, for that one hold only.
CREATE TABLE IF NOT EXISTS table_hold_guests (
  hold_id uuid NOT NULL REFERENCES table_holds ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hold_id, learner_id)
);

CREATE INDEX IF NOT EXISTS table_hold_guests_learner ON table_hold_guests (learner_id);

-- Invite links to a private table. Only the SHA-256 (hex) of the random token is stored, and a
-- link stops working when its hold ends (expires_at is the hold's ends_at) or is released.
CREATE TABLE IF NOT EXISTS table_hold_invites (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  hold_id uuid NOT NULL REFERENCES table_holds ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS table_hold_invites_hold ON table_hold_invites (hold_id);
