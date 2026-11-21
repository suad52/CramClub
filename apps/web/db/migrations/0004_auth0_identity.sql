-- Auth0 accounts, personal libraries and Study Circles.
-- A learner can now belong to an Auth0 account (its verified `sub`). The first time someone signs
-- in, the anonymous learner already on that browser is linked to the account so their progress
-- carries over. A linked learner is only ever used with that account's verified session: the
-- anonymous cookie alone never reaches it again. No email or other profile data is stored
-- (0007 adds a keyed hash of a verified email for table invites, never the address itself).
-- Everything below is owned by learner ids the server derives itself, never ids from a request.
-- Applied by db/migrate.mjs one statement at a time, so keep semicolons out of comments.

ALTER TABLE learners ADD COLUMN IF NOT EXISTS auth0_sub text UNIQUE
  CHECK (char_length(auth0_sub) BETWEEN 3 AND 255);

-- Personal libraries: a learner's private collections of saved things.
CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collections_owner ON collections (owner_id, updated_at DESC);

-- One saved thing: a web resource (https only), a lesson (payload holds its JSON), a study plan
-- or a note (payload holds its text). payload is capped at 256 KB.
CREATE TABLE IF NOT EXISTS collection_items (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('resource', 'lesson', 'plan', 'note')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  url text CHECK (url IS NULL OR (url ~ '^https://' AND char_length(url) <= 2048)),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(payload::text) <= 262144),
  source_task_id uuid REFERENCES librarian_tasks ON DELETE SET NULL,
  added_by uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS collection_items_collection
  ON collection_items (collection_id, created_at DESC);

-- Study Circles: shared collections. Membership and roles live here and are checked on the
-- server before every action (owner manages members, editor adds and edits, viewer reads).
CREATE TABLE IF NOT EXISTS study_circles (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 500),
  owner_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS study_circles_owner ON study_circles (owner_id);

CREATE TABLE IF NOT EXISTS circle_members (
  circle_id uuid NOT NULL REFERENCES study_circles ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, learner_id)
);

CREATE INDEX IF NOT EXISTS circle_members_learner ON circle_members (learner_id, circle_id);

-- Exactly one owner row per circle.
CREATE UNIQUE INDEX IF NOT EXISTS circle_members_one_owner ON circle_members (circle_id)
  WHERE role = 'owner';

-- Invite links. Only the SHA-256 (hex) of the random token is stored, so a database read can't
-- be turned into a working invite (lib/auth/inviteToken.ts makes and hashes tokens).
CREATE TABLE IF NOT EXISTS circle_invites (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  circle_id uuid NOT NULL REFERENCES study_circles ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_by uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  max_uses int NOT NULL DEFAULT 10 CHECK (max_uses BETWEEN 1 AND 100),
  uses int NOT NULL DEFAULT 0 CHECK (uses BETWEEN 0 AND max_uses)
);

CREATE INDEX IF NOT EXISTS circle_invites_circle ON circle_invites (circle_id);

-- A circle's shared items: the same shape as collection_items.
CREATE TABLE IF NOT EXISTS circle_items (
  id uuid PRIMARY KEY,
  circle_id uuid NOT NULL REFERENCES study_circles ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('resource', 'lesson', 'plan', 'note')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  url text CHECK (url IS NULL OR (url ~ '^https://' AND char_length(url) <= 2048)),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(payload::text) <= 262144),
  source_task_id uuid REFERENCES librarian_tasks ON DELETE SET NULL,
  added_by uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS circle_items_circle ON circle_items (circle_id, created_at DESC);
