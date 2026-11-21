// DEVELOPMENT / DEMO ONLY. Adds six clearly labelled demo learners (is_demo = true, names start
// "Demo ·") with five weeks of plausible learning history, so the leaderboard and community charts
// have something to show in a demo. Their rows follow the same rules and XP values as the real
// pipeline. Real learners are never touched, and `--clear` removes every demo row.
// Usage: pnpm db:seed-demo  |  pnpm db:seed-demo --clear
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { loadEnv } from "./env.mjs";

const sql = postgres(loadEnv().DATABASE_URL, { max: 1, onnotice: () => {} });
const XP = { session: 10, lesson: 25, quiz: 10, quizPassed: 15 };
const SUBJECTS = [
  ["biology", "Biology"],
  ["calculus", "Calculus"],
  ["computer-science", "Computer Science"],
  ["chemistry", "Chemistry"],
  ["psychology", "Psychology"],
];
const LEARNERS = [
  ["Demo · Ada", 0.8, ["computer-science", "calculus"]],
  ["Demo · Kwame", 0.65, ["biology", "chemistry"]],
  ["Demo · Mei", 0.75, ["calculus", "chemistry", "biology"]],
  ["Demo · Noor", 0.5, ["psychology", "biology"]],
  ["Demo · Tomás", 0.55, ["computer-science", "psychology"]],
  ["Demo · Priya", 0.4, ["biology", "calculus", "computer-science"]],
];

// A seeded generator, so every seed tells the same story.
let state = 20261120;
const rand = () => (state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = (list) => list[Math.floor(rand() * list.length)];

async function clear() {
  await sql`DELETE FROM learning_events WHERE user_id IN (SELECT user_id FROM learners WHERE is_demo)`;
  const gone = await sql`DELETE FROM learners WHERE is_demo RETURNING user_id`;
  console.log(`removed ${gone.length} demo learners and their history`);
}

try {
  await clear();
  if (process.argv.includes("--clear")) process.exit(0);
  await sql`INSERT INTO subjects ${sql(SUBJECTS.map(([subject_id, name]) => ({ subject_id, name })))}
    ON CONFLICT DO NOTHING`;
  const learners = [],
    lessons = [],
    progress = [],
    sessions = [],
    events = [],
    ledger = [];
  const now = Date.now();
  for (const [name, keenness, subjects] of LEARNERS) {
    const user_id = randomUUID();
    learners.push({
      user_id,
      display_name: name,
      is_demo: true,
      created_at: new Date(now - 40 * 864e5),
    });
    let lessonNo = 0;
    for (let daysAgo = 34; daysAgo >= 0; daysAgo--) {
      if (rand() > keenness) continue;
      // Mostly afternoons and evenings, library time (UTC−5).
      let at =
        now -
        daysAgo * 864e5 -
        ((now / 36e5) % 24) * 36e5 +
        (14 + Math.floor(rand() * 9) + 5) * 36e5;
      if (at > now - 30 * 60e3) at = now - (1 + rand() * 5) * 36e5;
      const period_key = "demo";
      const pomodoros = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < pomodoros; i++) {
        const session_id = randomUUID();
        const event_id = randomUUID();
        const start = new Date(at + i * 30 * 60e3);
        const end = new Date(start.getTime() + 25 * 60e3);
        sessions.push({
          session_id,
          user_id,
          session_type: "pomodoro",
          planned_seconds: 1500,
          started_at: start,
          ended_at: end,
          duration_seconds: 1500,
          status: "completed",
          validated_at: end,
        });
        events.push({
          event_id,
          user_id,
          event_type: "study_session_completed",
          occurred_at: end,
          activity_id: session_id,
          duration_seconds: 1500,
          xp_delta: XP.session,
        });
        ledger.push({
          user_id,
          event_id,
          reason: "session",
          activity_key: session_id,
          xp_delta: XP.session,
          created_at: end,
          period_key,
        });
      }
      if (rand() < 0.55) {
        const subject_id = pick(subjects);
        const lesson_id = `l-demo-${user_id.slice(0, 8)}-${++lessonNo}`;
        const when = new Date(at + pomodoros * 30 * 60e3 + 10 * 60e3);
        const quizzes = 1 + Math.floor(rand() * 3);
        const answer_key = Object.fromEntries(
          Array.from({ length: quizzes }, (_, q) => [`s${q + 2}`, 1]),
        );
        const completed = rand() < 0.8;
        let firstTry = 0;
        lessons.push({
          user_id,
          lesson_id,
          subject_id,
          title: `Demo lesson ${lessonNo}`,
          scene_count: 6,
          answer_key,
          first_started_at: when,
        });
        for (let q = 0; q < quizzes; q++) {
          const correct = rand() < 0.72;
          firstTry += correct ? 1 : 0;
          const event_id = randomUUID();
          const activity_key = `${lesson_id}:s${q + 2}`;
          const qAt = new Date(when.getTime() + (q + 1) * 3 * 60e3);
          const xp = XP.quiz + (correct ? XP.quizPassed : 0);
          events.push({
            event_id,
            user_id,
            event_type: "quiz_completed",
            occurred_at: qAt,
            subject_id,
            lesson_id,
            quiz_id: `s${q + 2}`,
            activity_id: activity_key,
            score: correct ? 100 : 0,
            xp_delta: xp,
          });
          ledger.push({
            user_id,
            event_id,
            reason: "quiz",
            activity_key,
            xp_delta: XP.quiz,
            created_at: qAt,
            period_key,
          });
          if (correct)
            ledger.push({
              user_id,
              event_id,
              reason: "quiz_passed",
              activity_key,
              xp_delta: XP.quizPassed,
              created_at: qAt,
              period_key,
            });
        }
        if (completed) {
          const event_id = randomUUID();
          const done = new Date(when.getTime() + 14 * 60e3);
          events.push({
            event_id,
            user_id,
            event_type: "lesson_completed",
            occurred_at: done,
            subject_id,
            lesson_id,
            activity_id: lesson_id,
            xp_delta: XP.lesson,
          });
          ledger.push({
            user_id,
            event_id,
            reason: "lesson",
            activity_key: lesson_id,
            xp_delta: XP.lesson,
            created_at: done,
            period_key,
          });
        }
        progress.push({
          user_id,
          lesson_id,
          subject_id,
          completion_status: completed ? "completed" : "in_progress",
          completed_count: completed ? 1 : 0,
          quizzes_total: quizzes,
          quizzes_answered: quizzes,
          quizzes_first_try: firstTry,
          last_activity_at: when,
          updated_at: when,
        });
      }
    }
  }
  const full = (rows, cols) =>
    rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
  const EVENT_COLS = [
    "event_id",
    "user_id",
    "event_type",
    "occurred_at",
    "subject_id",
    "lesson_id",
    "quiz_id",
    "activity_id",
    "duration_seconds",
    "score",
    "xp_delta",
  ];
  await sql.begin(async (tx) => {
    await tx`INSERT INTO learners ${tx(learners)}`;
    await tx`INSERT INTO lessons ${tx(lessons.map((l) => ({ ...l, answer_key: tx.json(l.answer_key) })))}`;
    await tx`INSERT INTO learning_progress ${tx(progress)}`;
    await tx`INSERT INTO study_sessions ${tx(sessions)}`;
    for (let i = 0; i < events.length; i += 500)
      await tx`INSERT INTO learning_events ${tx(full(events.slice(i, i + 500), EVENT_COLS))}`;
    for (let i = 0; i < ledger.length; i += 500)
      await tx`INSERT INTO xp_ledger ${tx(ledger.slice(i, i + 500))}`;
  });
  // Backfilled history lands in days the aggregate may already have materialised: refresh them,
  // but only up to the start of today. Materialising today would move the aggregate's watermark
  // past it, and real-time aggregation (which reads raw events after the watermark) would then
  // miss everything recorded later today.
  await sql`CALL refresh_continuous_aggregate('learning_daily', NULL,
    date_trunc('day', now() AT TIME ZONE 'America/Toronto') AT TIME ZONE 'America/Toronto')`;
  console.log(
    `seeded ${learners.length} demo learners: ${events.length} events, ${sessions.length} pomodoros, ${lessons.length} lessons`,
  );
} finally {
  await sql.end();
}
