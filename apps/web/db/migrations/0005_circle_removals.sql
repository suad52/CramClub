-- Study Circle removals. When an owner removes someone, every invite link made before that moment
-- stops letting them back in (lib/circles/server.ts joinCircle). A link the owner makes afterwards
-- still works for them, so re-inviting someone is a deliberate choice. Leaving a circle yourself
-- isn't a removal. Applied by db/migrate.mjs one statement at a time, so keep semicolons out of
-- comments.

CREATE TABLE IF NOT EXISTS circle_removals (
  circle_id uuid NOT NULL REFERENCES study_circles ON DELETE CASCADE,
  learner_id uuid NOT NULL REFERENCES learners ON DELETE CASCADE,
  removed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (circle_id, learner_id)
);
