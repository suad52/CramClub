-- The AI Librarian: requests, the sources TinyFish found, study plans and their items. Learning
-- activity still goes to the learning_events hypertable (new event types below), so progress,
-- streaks and leaderboards include it.

CREATE TABLE IF NOT EXISTS librarian_tasks (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  task_type text NOT NULL CHECK (task_type IN ('research_topic', 'find_resources',
    'create_study_plan', 'explain_weak_topic', 'research_assignment')),
  status text NOT NULL,
  user_request text NOT NULL CHECK (char_length(user_request) <= 4000),
  topic text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  mode text NOT NULL DEFAULT 'quick' CHECK (mode IN ('quick', 'deep')),
  provider_run_id text,
  reply text NOT NULL DEFAULT '',
  questions jsonb NOT NULL DEFAULT '[]'::jsonb,
  confirmation text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  overview text,
  key_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  lesson jsonb,
  lesson_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_code text,
  error_message text,
  cancel_requested boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS librarian_tasks_user_time ON librarian_tasks (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS research_sources (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES librarian_tasks ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL CHECK (url ~ '^https?://'),
  domain text NOT NULL,
  resource_type text NOT NULL DEFAULT 'other',
  summary text NOT NULL DEFAULT '',
  relevance_reason text NOT NULL DEFAULT '',
  difficulty text,
  extract text NOT NULL DEFAULT '',
  position int NOT NULL DEFAULT 0,
  accessed_at timestamptz NOT NULL DEFAULT now(),
  saved boolean NOT NULL DEFAULT false,
  saved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, url)
);

CREATE INDEX IF NOT EXISTS research_sources_saved ON research_sources (user_id, saved_at DESC) WHERE saved;

CREATE TABLE IF NOT EXISTS study_plans (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES librarian_tasks ON DELETE CASCADE,
  title text NOT NULL,
  goal text NOT NULL,
  start_date date NOT NULL,
  target_date date,
  daily_minutes int NOT NULL CHECK (daily_minutes BETWEEN 10 AND 600),
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  days jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id)
);

CREATE TABLE IF NOT EXISTS study_plan_items (
  id uuid PRIMARY KEY,
  study_plan_id uuid NOT NULL REFERENCES study_plans ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  scheduled_date date NOT NULL,
  position int NOT NULL DEFAULT 0,
  activity_type text NOT NULL CHECK (activity_type IN ('read', 'watch', 'lesson', 'practice',
    'review', 'quiz')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  estimated_minutes int NOT NULL CHECK (estimated_minutes BETWEEN 1 AND 600),
  completion_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  resource_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'done', 'skipped')),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS study_plan_items_plan ON study_plan_items (study_plan_id, scheduled_date, position);

CREATE INDEX IF NOT EXISTS study_plan_items_open ON study_plan_items (user_id, scheduled_date) WHERE status = 'todo';

ALTER TABLE learning_events DROP CONSTRAINT IF EXISTS learning_events_event_type_check;

ALTER TABLE learning_events ADD CONSTRAINT learning_events_event_type_check CHECK (event_type IN (
  'study_session_started', 'study_session_completed', 'lesson_started', 'lesson_completed',
  'quiz_completed', 'research_completed', 'resource_saved', 'study_plan_created',
  'plan_item_completed'));
