-- Learning analytics on Tiger Data (TimescaleDB on Postgres).
-- Relational tables hold who, what and current state; the learning_events hypertable is the
-- append-only, timestamped record every analytics query reads (through the learning_daily
-- continuous aggregate where it can). Applied by db/migrate.mjs one statement at a time
-- (continuous aggregates can't be created inside a transaction), so keep semicolons out of
-- comments and strings.

-- A learner is one browser's anonymous identity (a signed cookie) until OVR has accounts.
CREATE TABLE IF NOT EXISTS learners (
  user_id uuid PRIMARY KEY,
  display_name text NOT NULL DEFAULT 'Reader' CHECK (char_length(display_name) BETWEEN 1 AND 32),
  leaderboard_opt_in boolean NOT NULL DEFAULT true,
  is_demo boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subjects (
  subject_id text PRIMARY KEY CHECK (subject_id ~ '^[a-z0-9-]{1,60}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60)
);

-- Lessons are generated in the browser from the student's notes. The server keeps just enough
-- to validate completions and grade knowledge checks: never the notes or the narration.
CREATE TABLE IF NOT EXISTS lessons (
  user_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  lesson_id text NOT NULL CHECK (lesson_id ~ '^[a-z0-9-]{4,64}$'),
  subject_id text NOT NULL REFERENCES subjects,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 100),
  scene_count int NOT NULL CHECK (scene_count BETWEEN 1 AND 20),
  answer_key jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_started_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id)
);

CREATE TABLE IF NOT EXISTS learning_progress (
  user_id uuid NOT NULL,
  lesson_id text NOT NULL,
  subject_id text NOT NULL REFERENCES subjects,
  completion_status text NOT NULL DEFAULT 'in_progress'
    CHECK (completion_status IN ('in_progress', 'completed')),
  completed_count int NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  quizzes_total int NOT NULL DEFAULT 0 CHECK (quizzes_total >= 0),
  quizzes_answered int NOT NULL DEFAULT 0 CHECK (quizzes_answered >= 0),
  quizzes_first_try int NOT NULL DEFAULT 0 CHECK (quizzes_first_try >= 0),
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, lesson_id),
  FOREIGN KEY (user_id, lesson_id) REFERENCES lessons ON DELETE CASCADE
);

-- Focus sessions (the table timer's pomodoros). The server stamps the start and end itself.
CREATE TABLE IF NOT EXISTS study_sessions (
  session_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  session_type text NOT NULL CHECK (session_type IN ('pomodoro')),
  planned_seconds int NOT NULL CHECK (planned_seconds BETWEEN 60 AND 5400),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  duration_seconds int CHECK (duration_seconds >= 0),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'abandoned', 'rejected')),
  validated_at timestamptz
);

-- One running session per learner: nothing can overlap, so focus time can't double count.
CREATE UNIQUE INDEX IF NOT EXISTS study_sessions_one_active
  ON study_sessions (user_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS study_sessions_user_time ON study_sessions (user_id, started_at DESC);

-- The time-series record of validated learning activity.
CREATE TABLE IF NOT EXISTS learning_events (
  event_id uuid NOT NULL,
  user_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN (
    'study_session_started', 'study_session_completed', 'lesson_started', 'lesson_completed',
    'quiz_completed')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  subject_id text,
  topic_id text,
  lesson_id text,
  quiz_id text,
  activity_id text,
  duration_seconds int CHECK (duration_seconds >= 0),
  score numeric(5, 2) CHECK (score BETWEEN 0 AND 100),
  xp_delta int NOT NULL DEFAULT 0 CHECK (xp_delta >= 0),
  group_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (event_id, occurred_at)
);

SELECT create_hypertable('learning_events', by_range('occurred_at', INTERVAL '7 days'),
  if_not_exists => true);

CREATE INDEX IF NOT EXISTS learning_events_user_time ON learning_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS learning_events_type_time
  ON learning_events (event_type, occurred_at DESC);

-- Older weeks move to the columnstore (compressed, still fully queryable). Nothing is ever
-- deleted: a student's learning history is theirs to keep.
ALTER TABLE learning_events SET (
  timescaledb.enable_columnstore = true,
  timescaledb.segmentby = 'user_id',
  timescaledb.orderby = 'occurred_at DESC');

CALL add_columnstore_policy('learning_events', after => INTERVAL '30 days', if_not_exists => true);

-- Every XP change, with why. The unique key is what makes rewards idempotent.
CREATE TABLE IF NOT EXISTS xp_ledger (
  ledger_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  event_id uuid NOT NULL,
  reason text NOT NULL,
  activity_key text NOT NULL,
  xp_delta int NOT NULL CHECK (xp_delta >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  period_key text NOT NULL,
  UNIQUE (user_id, reason, activity_key)
);

CREATE INDEX IF NOT EXISTS xp_ledger_user_time ON xp_ledger (user_id, created_at DESC);

-- Daily totals per learner and subject (library time zone), kept up to date by Tiger Data.
-- Real-time aggregation adds the not-yet-materialised newest events, so dashboards and
-- leaderboards reflect an event the moment it is recorded.
CREATE MATERIALIZED VIEW IF NOT EXISTS learning_daily
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', occurred_at, 'America/Toronto') AS day,
  user_id,
  subject_id,
  count(*) FILTER (WHERE event_type = 'lesson_completed') AS lessons_completed,
  count(*) FILTER (WHERE event_type = 'quiz_completed') AS quizzes_completed,
  count(*) FILTER (WHERE event_type = 'quiz_completed' AND score >= 100) AS quizzes_correct,
  count(*) FILTER (WHERE event_type = 'study_session_completed') AS sessions_completed,
  coalesce(sum(duration_seconds) FILTER (WHERE event_type = 'study_session_completed'), 0)
    AS focus_seconds,
  sum(xp_delta) AS xp,
  count(*) AS events
FROM learning_events
GROUP BY 1, 2, 3
WITH NO DATA;

SELECT add_continuous_aggregate_policy('learning_daily',
  start_offset => INTERVAL '40 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '10 minutes',
  if_not_exists => true);
