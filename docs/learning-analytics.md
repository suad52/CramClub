# Learning analytics on Tiger Data

Your progress, a weekly leaderboard and community trends, built on real learning activity stored in
Tiger Data (Postgres + TimescaleDB). It rewards **finishing** things, a pomodoro, a lesson or a
knowledge check, and showing up regularly. It never rewards having the app open.

## What students get

- **My Progress** (📈 in the library's top bar, or `/progress`):
  - **Overview:**
    - focus time, lessons, quizzes and first-try accuracy, XP, current and longest streak;
    - a 30-day activity chart;
    - this week vs last week;
    - your weekly rank, and what to continue next.
  - **Subjects:** for each subject, lessons completed out of the lessons you've started. There's no
    invented course total. It also shows a mastery estimate (first-try quiz accuracy, labelled as
    an estimate) and a 6-week trend.
  - **History:** your private timeline of pomodoros, lessons and knowledge checks, filterable by
    type and subject.
  - **Leaderboard:** weekly (or monthly) XP. Ties go to more focus time, then more active days.
    You can opt out.
  - **Community:** subjects studied this week, the library's hour-of-day rhythm and a 30-day trend.
    Only aggregates are shown, and any group of fewer than 3 learners is hidden.
- **A "+25 XP" toast** in the library whenever the server awards XP.

## How XP works

| Verified activity                              | XP  | Daily cap      |
| ---------------------------------------------- | --- | -------------- |
| A completed pomodoro (server-timed)            | 10  | 12 per day     |
| A completed lesson (once per lesson)           | 25  | 10 per day     |
| A knowledge check answered (once per question) | 10  | 40 per day     |
| ...answered right on the first try             | +15 | with the above |

Values live in `apps/web/lib/learning/rules.ts` (`XP`, `DAILY_CAPS`); the UI reads them from there.
Past a cap, the activity still counts, for 0 XP.

**Anti-abuse:**

- The browser never sends XP, durations or scores. It reports what happened, and the server decides:
  - **Pomodoros:** the server stamps the start and end with its own clock. Only the planned length
    counts, never pauses or time away. A pomodoro is refused if it ends early (20 s leeway) or
    reports in more than 30 minutes late.
  - **Overlapping sessions:** impossible. A unique index allows one running session per learner, and
    starting a new one abandons the old.
  - **Lessons** must be registered before they can complete, and can't complete faster than they
    can be played (20 s a scene, at most 3 min).
  - **Knowledge checks** are graded on the server against the answer key registered when the
    lesson first played. That key can't be rewritten later, and only the first answer counts.
- **Idempotency:** every reward is a row in `xp_ledger` with a unique (learner, reason, activity)
  key. A repeated completion finds its row taken and earns nothing. Each write is one transaction
  (event + ledger + progress).
- **Validation:** request bodies are checked with zod. Writes are rate-limited (60 a minute per
  learner).

## Tiger Data: what powers what

| Feature                                                                  | Tiger Data / TimescaleDB piece                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Every validated activity, append-only                                    | `learning_events` **hypertable**, partitioned by `occurred_at` in 7-day chunks, indexed by (user, time) and (type, time)                                                                                                                                                                                    |
| Totals, 30-day chart, streaks, week vs week, subject trends, leaderboard | `learning_daily` **continuous aggregate**: daily per-learner per-subject sums, bucketed with `time_bucket('1 day', …, 'America/Toronto')`. A policy refreshes it every 10 min, and **real-time aggregation** (`materialized_only = false`) folds in the newest events, so a new completion shows instantly. |
| Community hour-of-day rhythm                                             | `time_bucket('1 hour', …)` over the hypertable's last 28 days                                                                                                                                                                                                                                               |
| Long-term history that stays cheap                                       | the **columnstore** policy compresses chunks older than 30 days (segment by user, ordered by time). There is **no retention policy**: a student's history is kept.                                                                                                                                          |

Relational state lives in plain Postgres tables:

- `learners`: the profile and leaderboard opt-in;
- `subjects`, `lessons`: structure and the answer key, never notes or narration;
- `learning_progress`: per-lesson state;
- `study_sessions`;
- `xp_ledger`.

Each API response carries `queryMs`, shown in the UI's footer. Warm queries from Toronto to
us-west-2 take about 70–140 ms, most of it network round trips.

## Privacy

**What's stored:**

- event types, times and subjects;
- lesson titles and answer keys;
- scores and XP.

**What's never stored:** notes, narration, AI conversations, webcam frames or passwords.

**Who sees what:**

- Lesson titles are only returned to their owner.
- Leaderboards show only a display name (your character's name) and totals. User ids never leave
  the server.
- Community views are aggregated, opted-in only, with groups under 3 hidden.

## Identity (until OVR has accounts)

A learner is an anonymous id in a **signed, httpOnly cookie** (`ovr_learner`, HMAC with
`LEARNER_SECRET`). The server derives the user from it on every request and never trusts an id in
a request. A forged or edited cookie is ignored. When accounts arrive, map the account to its
learner id in `lib/learning/server/identity.ts`.

## Setup

1. **Create a Tiger Cloud service** and download its credentials file.
2. **In `apps/web/.env.local`** (never commit it):
   - `DATABASE_URL=` the service's connection URI (`TIMESCALE_SERVICE_URL` in the credentials file);
   - `LEARNER_SECRET=` a long random string (`openssl rand -hex 32`).
3. **Run `pnpm --filter web db:migrate`.** It applies `apps/web/db/migrations/*.sql` once each,
   one statement at a time, because continuous aggregates can't be created in a transaction.
4. **Optional, for development and demos only:**
   - `pnpm --filter web db:seed-demo` adds six learners tagged "Demo ·" with five weeks of history;
   - `pnpm --filter web db:clear-demo` removes them.
5. **Optional check:** `pnpm --filter web db:smoke [baseUrl]` runs the whole pipeline against a
   running app and the real database: sessions, lessons, quizzes, idempotency, rejection rules,
   the read views, privacy and a forged cookie. It cleans up after itself.

Without `DATABASE_URL`/`LEARNER_SECRET`, the API answers 503 `not_configured`, the progress UI says
tracking isn't set up, and the rest of the library works as before.

## For developers

- **Rules (pure, tested):** `apps/web/lib/learning/rules.ts` (`rules.test.ts`).
- **API:** `apps/web/app/api/learning/[action]/route.ts`.
  - `GET dashboard | timeline?kind&subject&before | leaderboard?period | community`
  - `POST profile | session-start | session-complete | session-abandon | lesson-start | lesson-complete | quiz`
- **Writes:** `lib/learning/server/pipeline.ts`.
- **Reads:** `lib/learning/server/queries.ts`.
- **Response types:** `lib/learning/types.ts`.
- **Browser side:** `lib/learning/client.ts`.
  - `trackPomodoros()` mirrors the table timer and is mounted in `components/library/Pomodoro.tsx`.
  - `trackLessonStarted/Completed` are called from `useLessonPlayback`.
  - `trackQuizAnswer` is the `onPick` of the `Question` component.
  - Failures are silent: studying never breaks because the database is unreachable.

**Trap:** never refresh `learning_daily` through today, for example with
`refresh_continuous_aggregate(…, NULL, NULL)`. That moves its watermark past today, and real-time
aggregation then stops seeing new events until tomorrow. Refresh only up to the start of today, as
`db/seed-demo.mjs` does. If it happens, drop and recreate the view from the migration.

**Known limits:**

- **Answer keys:** a lesson's answer key comes from the browser that generated the lesson, so a
  determined user could register a fake key. Daily caps bound what that's worth.
- **Rate limits:** they're per server instance (in memory).
- **Collaborative sessions and group challenges** wait for multiplayer.
