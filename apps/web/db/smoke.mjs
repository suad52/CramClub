// End-to-end check of the learning pipeline against a running app and its real database:
// sessions, lessons, quizzes, idempotency, the anti-cheat checks and the read views. It makes a
// throwaway learner, backdates its rows where a real wait would be needed, and deletes everything
// it made at the end. Usage: pnpm db:smoke [baseUrl]   (default http://localhost:3100)
import assert from "node:assert/strict";
import postgres from "postgres";
import { loadEnv } from "./env.mjs";

const base = process.argv[2] ?? "http://localhost:3100";
const sql = postgres(loadEnv().DATABASE_URL, { max: 1, onnotice: () => {} });
let cookie = "";
let userId = null;

async function call(method, action, body) {
  const res = await fetch(`${base}/api/learning/${action}`, {
    method,
    headers: { "content-type": "application/json", cookie },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, json: await res.json() };
}
const post = (action, body) => call("POST", action, body);
const get = (action) => call("GET", action);
const step = (name) => console.log(`✓ ${name}`);

try {
  // A new learner comes from the first write.
  assert.equal(
    (await post("profile", { displayName: "Smoke Test", leaderboardOptIn: false })).status,
    200,
  );
  [{ user_id: userId }] = await sql`SELECT user_id FROM learners WHERE display_name = 'Smoke Test'
    ORDER BY created_at DESC LIMIT 1`;
  step("signed learner cookie issued, profile saved");

  // A pomodoro can't be completed early, and a rejected one stays rejected.
  let s = await post("session-start", { plannedMinutes: 25 });
  assert.equal(s.status, 200);
  assert.equal((await post("session-complete", { sessionId: s.json.sessionId })).status, 422);
  step("early completion rejected (server clock)");

  // Starting another closes any running one: sessions never overlap.
  const first = (await post("session-start", { plannedMinutes: 25 })).json.sessionId;
  const second = (await post("session-start", { plannedMinutes: 25 })).json.sessionId;
  const [{ n: active }] = await sql`SELECT count(*)::int AS n FROM study_sessions
    WHERE user_id = ${userId} AND status = 'active'`;
  assert.equal(active, 1);
  const [{ status: firstStatus }] =
    await sql`SELECT status FROM study_sessions WHERE session_id = ${first}`;
  assert.equal(firstStatus, "abandoned");
  step("one running session at a time");

  // After its full length it counts once, for 10 XP and 25 minutes.
  await sql`UPDATE study_sessions SET started_at = now() - interval '25 minutes' WHERE session_id = ${second}`;
  let done = await post("session-complete", { sessionId: second });
  assert.equal(done.status, 200);
  assert.equal(done.json.xp, 10);
  assert.equal(done.json.durationSeconds, 1500);
  assert.equal((await post("session-complete", { sessionId: second })).json.xp, 0);
  step("completed pomodoro: +10 XP once, 25 min credited");

  // Lessons: registered first, not completable instantly, XP once.
  const lesson = {
    lessonId: "l-smoketest0001",
    title: "Smoke test lesson",
    subject: "Smoke Testing",
    sceneCount: 3,
    answerKey: { s1: 2 },
  };
  assert.equal((await post("lesson-complete", { lessonId: lesson.lessonId })).status, 404);
  assert.equal((await post("lesson-start", lesson)).status, 200);
  assert.equal((await post("lesson-start", { ...lesson, answerKey: { s1: 0 } })).json.known, true);
  assert.equal((await post("lesson-complete", { lessonId: lesson.lessonId })).status, 422);
  await sql`UPDATE lessons SET first_started_at = now() - interval '5 minutes'
    WHERE user_id = ${userId} AND lesson_id = ${lesson.lessonId}`;
  assert.equal((await post("lesson-complete", { lessonId: lesson.lessonId })).json.xp, 25);
  assert.equal((await post("lesson-complete", { lessonId: lesson.lessonId })).json.xp, 0);
  step("lesson: must start first, not too fast, +25 XP once, answer key can't be rewritten");

  // Quizzes are graded on the server against the first-registered key, first answer only.
  const q = await post("quiz", { lessonId: lesson.lessonId, quizId: "s1", picked: 2 });
  assert.deepEqual([q.json.correct, q.json.xp], [true, 25]);
  const again = await post("quiz", { lessonId: lesson.lessonId, quizId: "s1", picked: 2 });
  assert.equal(again.json.xp, 0);
  assert.equal(
    (await post("quiz", { lessonId: lesson.lessonId, quizId: "nope", picked: 0 })).status,
    422,
  );
  step("quiz: graded server-side, +10 +15 for first-try right, no XP on resubmit");

  // Bad input never reaches the database.
  assert.equal(
    (await post("quiz", { lessonId: "DROP TABLE", quizId: "s1", picked: 9 })).status,
    400,
  );
  step("invalid payloads rejected by the schema");

  // The ledger and the events agree, and the read views see them straight away.
  const [{ xp }] =
    await sql`SELECT sum(xp_delta)::int AS xp FROM xp_ledger WHERE user_id = ${userId}`;
  assert.equal(xp, 60);
  const dash = (await get("dashboard")).json;
  assert.equal(dash.allTime.xp, 60);
  assert.equal(dash.allTime.focusMinutes, 25);
  assert.equal(dash.allTime.lessons, 1);
  assert.equal(dash.allTime.quizzesCorrect, 1);
  assert.equal(dash.streak.current, 1);
  assert.equal(dash.subjects[0].lessonsCompleted, 1);
  assert.equal(dash.recent.length, 3);
  step(`dashboard from the continuous aggregate: 60 XP (${dash.queryMs} ms)`);

  const board = (await get("leaderboard")).json;
  assert.equal(
    board.rows.some((r) => r.isMe),
    false,
  );
  assert.deepEqual([board.me.rank, board.me.xp, board.me.optedIn], [null, 60, false]);
  assert.equal(JSON.stringify(board).includes(userId), false);
  assert.equal(JSON.stringify(board).includes("Smoke test lesson"), false);
  step("leaderboard: opted-out learner unranked, no ids or lesson titles leak");

  await post("profile", { leaderboardOptIn: true });
  assert.equal(
    (await get("leaderboard")).json.rows.some((r) => r.isMe && r.xp === 60),
    true,
  );
  const community = (await get("community")).json;
  assert.equal(JSON.stringify(community).includes("Smoke test lesson"), false);
  step(`opt back in → ranked; community view aggregated (${community.learners} learners)`);

  // Someone else's cookie can't be forged.
  cookie = `ovr_learner=${userId}.forged`;
  assert.equal((await get("dashboard")).json.allTime.xp, 0);
  step("forged cookie sees nothing");
  console.log("\nall good");
} finally {
  if (userId) {
    await sql`DELETE FROM learning_events WHERE user_id = ${userId}`;
    await sql`DELETE FROM learners WHERE user_id = ${userId}`;
    await sql`DELETE FROM subjects s WHERE subject_id = 'smoke-testing'
      AND NOT EXISTS (SELECT 1 FROM lessons l WHERE l.subject_id = s.subject_id)`;
  }
  await sql.end();
}
