-- The Living Library's background lesson jobs (lib/jobs/types.ts). The API inserts a row and
-- returns at once. A separate worker process (apps/web/worker, on the Vultr server) claims rows
-- with FOR UPDATE SKIP LOCKED and a lease, researches with TinyFish, writes the lesson with Gemini
-- and records narration with ElevenLabs. Generated files live in object storage under
-- deterministic keys (lib/storage/types.ts), never here: this table keeps keys and metadata only.
-- checkpoint records finished work (research sources, the stored lesson document, recorded
-- scenes) so a retried job resumes instead of paying for the same work twice.
-- Applied by db/migrate.mjs one statement at a time, so keep semicolons out of comments.

CREATE TABLE IF NOT EXISTS lesson_jobs (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  topic text NOT NULL CHECK (char_length(topic) BETWEEN 1 AND 200),
  level text NOT NULL DEFAULT 'high-school'
    CHECK (level IN ('beginner', 'high-school', 'university', 'advanced')),
  length text NOT NULL DEFAULT 'short' CHECK (length IN ('short', 'standard', 'detailed')),
  task_id uuid REFERENCES librarian_tasks ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'researching',
    'generating_lesson', 'generating_audio', 'saving', 'completed', 'failed')),
  progress text CHECK (char_length(progress) <= 300),
  attempts int NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  -- Not claimable before this (retry backoff).
  run_after timestamptz NOT NULL DEFAULT now(),
  -- The claim: which worker holds the job (plus a per-claim token), and until when.
  locked_by text,
  locked_at timestamptz,
  lease_until timestamptz,
  checkpoint jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(checkpoint::text) <= 262144),
  title text,
  summary text,
  scene_count int CHECK (scene_count BETWEEN 0 AND 20),
  audio jsonb NOT NULL DEFAULT '[]'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_message text,
  error_retryable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS lesson_jobs_owner_time ON lesson_jobs (owner_id, created_at DESC);

-- What the worker scans: busy jobs, oldest first.
CREATE INDEX IF NOT EXISTS lesson_jobs_claimable ON lesson_jobs (run_after, created_at)
  WHERE status IN ('queued', 'researching', 'generating_lesson', 'generating_audio', 'saving');

-- A lesson job shared to a Study Circle is a circle_items row of kind lesson whose payload names
-- the job (payload->>'lessonJobId'). Members read it through the API after a membership check.
CREATE INDEX IF NOT EXISTS circle_items_lesson_job ON circle_items ((payload->>'lessonJobId'))
  WHERE kind = 'lesson';

-- One row per worker process, rewritten every WORKER_HEARTBEAT_SECONDS (GET /api/health).
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id text PRIMARY KEY CHECK (char_length(worker_id) BETWEEN 1 AND 200),
  seen_at timestamptz NOT NULL DEFAULT now()
);
