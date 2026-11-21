-- Studying from uploaded notes: a new request type, and the notes' extracted text (one row per
-- file, its pages as a JSON array of strings). The text belongs to the request and its learner, and
-- is deleted with either. The new status `reading_notes` needs no change: status is free text.

ALTER TABLE librarian_tasks DROP CONSTRAINT IF EXISTS librarian_tasks_task_type_check;

ALTER TABLE librarian_tasks ADD CONSTRAINT librarian_tasks_task_type_check CHECK (task_type IN (
  'research_topic', 'find_resources', 'create_study_plan', 'explain_weak_topic',
  'research_assignment', 'study_from_notes'));

CREATE TABLE IF NOT EXISTS librarian_notes (
  id uuid PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES librarian_tasks ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 200),
  position int NOT NULL DEFAULT 0,
  pages jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(pages) = 'array'),
  char_count int NOT NULL DEFAULT 0 CHECK (char_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS librarian_notes_task ON librarian_notes (task_id, position);
