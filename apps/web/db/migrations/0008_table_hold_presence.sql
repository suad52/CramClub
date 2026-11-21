-- Table holds end when their holder leaves, however they leave. While a student holds a table,
-- their page checks in every ~20 s (POST /api/tables/:id/heartbeat); a hold whose page has been
-- quiet for PRESENCE_GRACE_S (closed tab, crash, lost connection) is released by the server
-- (lib/tables/server.ts releaseAbandoned). Closing or reloading the page also releases it at once.
ALTER TABLE table_holds ADD COLUMN IF NOT EXISTS last_seen_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX IF NOT EXISTS table_holds_presence ON table_holds (last_seen_at)
  WHERE released_at IS NULL;
