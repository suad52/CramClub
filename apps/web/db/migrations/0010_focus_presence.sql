-- Verified focus: how much of a pomodoro the student's own face tracking saw them at the desk.
-- POST /api/learning/session-complete may carry presence (cameraSeconds, seenSeconds) from the
-- browser. The server clamps both to the session's server-validated length (lib/learning/rules.ts
-- clampPresence) and stores them on the study_session_completed event. NULL means the browser
-- reported nothing (camera off, or an older page). Verified time is an extra honesty signal, never
-- a requirement: nothing ranks by it and nothing is refused without it.
--
-- The database refuses an impossible reading on its own: both values or neither, on completed
-- sessions only, and seen <= camera <= the credited duration. When the server had to clamp what
-- the browser sent it says so in metadata (presence.clamped), a per-reading trust flag.
--
-- Two continuous aggregates read it: focus_presence_daily here (per learner per library day, like
-- learning_daily, which stays as it is) and focus_presence_weekly (0011), a hierarchical
-- continuous aggregate built on the daily one. Both use real-time aggregation, so a pomodoro
-- shows the moment it is recorded.
-- Applied by db/migrate.mjs one statement at a time, so keep semicolons out of comments.

ALTER TABLE learning_events ADD COLUMN IF NOT EXISTS camera_seconds int;

ALTER TABLE learning_events ADD COLUMN IF NOT EXISTS seen_seconds int;

ALTER TABLE learning_events DROP CONSTRAINT IF EXISTS learning_events_presence_check;

ALTER TABLE learning_events ADD CONSTRAINT learning_events_presence_check CHECK (
  (camera_seconds IS NULL AND seen_seconds IS NULL) OR (
    event_type = 'study_session_completed'
    AND duration_seconds IS NOT NULL
    AND camera_seconds IS NOT NULL
    AND seen_seconds IS NOT NULL
    AND seen_seconds BETWEEN 0 AND camera_seconds
    AND camera_seconds <= duration_seconds));

-- Per learner per library day: pomodoros, their credited focus time, and how much of it the
-- student's camera was on for and saw them at the desk.
CREATE MATERIALIZED VIEW IF NOT EXISTS focus_presence_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', occurred_at, 'America/Toronto') AS day,
  user_id,
  count(*) AS sessions,
  count(*) FILTER (WHERE camera_seconds > 0) AS sessions_with_camera,
  coalesce(sum(duration_seconds), 0) AS focus_seconds,
  coalesce(sum(camera_seconds), 0) AS camera_seconds,
  coalesce(sum(seen_seconds), 0) AS seen_seconds
FROM learning_events
WHERE event_type = 'study_session_completed'
GROUP BY 1, 2
WITH DATA;

SELECT add_continuous_aggregate_policy('focus_presence_daily',
  start_offset => INTERVAL '40 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '10 minutes',
  if_not_exists => true);

-- The weekly roll-up on top of this is migration 0011 (focus_presence_weekly).
