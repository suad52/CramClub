-- focus_presence_weekly: verified focus per learner per Monday week (library time), a
-- hierarchical continuous aggregate rolled up from focus_presence_daily (0010), not from raw
-- events.
--
-- Its refresh policy only ever materialises weeks that ended at least 7 days ago. The current
-- week, which is still filling up, stays above the aggregate's watermark, so real-time
-- aggregation answers it from focus_presence_daily (itself real-time over learning_events) and a
-- pomodoro shows the moment it is recorded. A first version (in 0010 as first applied) was
-- created WITH DATA and refreshed up to a day back, which materialised the unfinished week and
-- moved the watermark past it: this week's newest pomodoros were then missing until the week
-- ended. It is rebuilt here, empty, and fills in from the policy.
-- Applied by db/migrate.mjs one statement at a time, so keep semicolons out of comments.

DROP MATERIALIZED VIEW IF EXISTS focus_presence_weekly;

CREATE MATERIALIZED VIEW IF NOT EXISTS focus_presence_weekly
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 week', day, 'America/Toronto') AS week,
  user_id,
  sum(sessions) AS sessions,
  sum(sessions_with_camera) AS sessions_with_camera,
  sum(focus_seconds) AS focus_seconds,
  sum(camera_seconds) AS camera_seconds,
  sum(seen_seconds) AS seen_seconds,
  count(*) AS active_days
FROM focus_presence_daily
GROUP BY 1, 2
WITH NO DATA;

SELECT add_continuous_aggregate_policy('focus_presence_weekly',
  start_offset => INTERVAL '12 weeks',
  end_offset => INTERVAL '7 days',
  schedule_interval => INTERVAL '30 minutes',
  if_not_exists => true);
