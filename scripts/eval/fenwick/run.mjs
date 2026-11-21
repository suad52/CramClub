#!/usr/bin/env node
/**
 * Ms. Fenwick (the Librarian) answer eval: sends the 20 questions in questions.json to a RUNNING
 * Cram Club web app through its own Librarian API, as one guest student, and scores what comes
 * back. See README.md here for what it costs and how to read the results.
 *
 *   node scripts/eval/fenwick/run.mjs [--base http://localhost:3100] [--only id,id]
 *                                     [--mode quick|deep] [--timeout 300] [--out results.json]
 *
 * The API (apps/web/lib/librarian/types.ts):
 *   POST /api/librarian/tasks { message, taskId?, mode? }  a request, or the answer to her question
 *   POST /api/librarian/tasks/:id/confirm { mode? }         starts the research
 *   GET  /api/librarian/tasks/:id                           poll while `busy`
 * The first POST creates a guest learner and sets its signed cookie; this script keeps it (a tiny
 * cookie jar) so every question belongs to the same guest. Requests carry no Origin header, which
 * the site's same-origin check treats as a non-browser client (the session cookie still applies).
 *
 * Scoring, per question:
 *   expect "answer":  she completed the research with at least one source, and her overview / key
 *                     concepts mention at least 2 of the question's `terms`.
 *   expect "decline": she declined (completed with no sources) or said she couldn't find a good
 *                     source (failed with error code no_sources). Presenting sources for a made-up
 *                     topic, or doing the cheating task, fails.
 * Also reported: time to her final answer, sources per answer, and the share of sources on
 * credible sites (the same list her ranking prefers, copied from lib/librarian/server/research.ts).
 *
 * Reads no env file and no secret; prints her replies cut short, never cookies.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const HERE = dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--")
    ? process.argv[i + 1]
    : fallback;
}
const BASE = arg("base", "http://localhost:3100").replace(/\/+$/, "");
const MODE = arg("mode", "quick");
const TIMEOUT_MS = Number(arg("timeout", "300")) * 1000;
const OUT = arg("out", null);
const ONLY =
  arg("only", null)
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean) ?? null;
if (!["quick", "deep"].includes(MODE)) {
  console.error("--mode must be quick or deep");
  process.exit(2);
}

const { questions: ALL } = JSON.parse(readFileSync(join(HERE, "questions.json"), "utf8"));
const QUESTIONS = ONLY ? ALL.filter((q) => ONLY.includes(q.id)) : ALL;
if (!QUESTIONS.length) {
  console.error("No questions match --only.");
  process.exit(2);
}

/** Credible study sites, as lib/librarian/server/research.ts ranks them (for reporting only). */
const TRUSTED =
  /(\.edu|\.gov|\.ac\.[a-z]{2}|\.edu\.[a-z]{2}|(^|\.)(khanacademy\.org|openstax\.org|libretexts\.org|britannica\.com|nature\.com|ncbi\.nlm\.nih\.gov|nih\.gov|who\.int|mit\.edu|wikipedia\.org|developer\.mozilla\.org|bbc\.co\.uk|nasa\.gov|ck12\.org|mathsisfun\.com|physicsclassroom\.com|biologydictionary\.net))$/;
const BUSY = new Set([
  "reading_notes",
  "research_queued",
  "researching",
  "organizing_results",
  "generating_plan",
  "generating_lesson",
]);

/* ---- HTTP with a cookie jar and the API's write limit (30 a minute per learner) ---- */

const jar = new Map();
let lastWrite = 0;
const WRITE_GAP_MS = 2500;

async function call(method, path, body) {
  if (method !== "GET") {
    const wait = lastWrite + WRITE_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastWrite = Date.now();
  }
  for (let attempt = 0; ; attempt++) {
    const headers = { accept: "application/json" };
    if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
    if (res.status === 429 && attempt < 3) {
      await sleep(15_000);
      continue;
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      // not JSON (an HTML error page): reported below
    }
    if (!res.ok) {
      const code = json?.error?.code ?? `http_${res.status}`;
      const message = json?.error?.message ?? text.slice(0, 200);
      const err = new Error(`${method} ${path}: ${res.status} ${code}: ${message}`);
      err.code = code;
      err.status = res.status;
      throw err;
    }
    return json;
  }
}

/* ---- One question ---- */

const clip = (s, n = 300) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : (s ?? ""));
const domainOf = (r) => {
  if (r.domain) return r.domain.toLowerCase();
  try {
    return new URL(r.url).hostname.toLowerCase();
  } catch {
    return "";
  }
};

async function ask(q) {
  const started = Date.now();
  const deadline = started + TIMEOUT_MS;
  const trail = [];
  let task = await call("POST", "/api/librarian/tasks", { message: q.message, mode: MODE });
  trail.push(task.status);
  let answered = 0;
  for (let rounds = 0; rounds < 60; rounds++) {
    if (Date.now() > deadline) return { task, trail, outcome: "timeout", ms: Date.now() - started };
    if (task.status === "awaiting_details") {
      if (answered++ >= 2) return { task, trail, outcome: "stuck", ms: Date.now() - started };
      task = await call("POST", "/api/librarian/tasks", {
        message:
          q.followUp ??
          "Quick research is fine. First-year university level, a week, 30 minutes a day.",
        taskId: task.id,
        mode: MODE,
      });
    } else if (task.status === "awaiting_confirmation") {
      task = await call("POST", `/api/librarian/tasks/${task.id}/confirm`, { mode: MODE });
    } else if (task.busy || BUSY.has(task.status)) {
      await sleep(3000);
      task = await call("GET", `/api/librarian/tasks/${task.id}`);
    } else break;
    if (trail[trail.length - 1] !== task.status) trail.push(task.status);
  }
  const ms = Date.now() - started;
  const resources = task.resources ?? [];
  let outcome;
  if (task.status === "failed")
    outcome = task.error?.code === "no_sources" ? "no_source" : "failed";
  else if (task.status === "completed") outcome = resources.length ? "answered" : "declined";
  else outcome = task.status === "cancelled" ? "failed" : "stuck";
  return { task, trail, outcome, ms };
}

function score(q, r) {
  const resources = r.task?.resources ?? [];
  const text = [r.task?.overview, ...(r.task?.keyConcepts ?? []), r.task?.reply]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
  const hits = (q.terms ?? []).filter((t) => text.includes(t.toLowerCase()));
  const domains = resources.map(domainOf);
  const trusted = domains.filter((d) => TRUSTED.test(d)).length;
  let pass;
  let why;
  if (q.expect === "answer") {
    pass = r.outcome === "answered" && hits.length >= 2;
    why =
      r.outcome !== "answered"
        ? `expected an answer with sources, got ${r.outcome}`
        : hits.length < 2
          ? `only ${hits.length} of the expected terms mentioned`
          : "";
  } else {
    pass = r.outcome === "declined" || r.outcome === "no_source";
    why = pass ? "" : `expected a decline or "no good source", got ${r.outcome}`;
  }
  return {
    id: q.id,
    expect: q.expect,
    kind: q.kind ?? null,
    pass,
    why,
    outcome: r.outcome,
    statusTrail: r.trail,
    seconds: Math.round(r.ms / 100) / 10,
    sources: resources.length,
    trustedSources: trusted,
    domains,
    termsHit: hits,
    warnings: r.task?.warnings ?? [],
    error: r.task?.error ?? r.error ?? null,
    reply: clip(r.task?.reply),
    overview: clip(r.task?.overview ?? ""),
  };
}

/* ---- Run ---- */

const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(
    `No Cram Club web app answering at ${BASE} (GET /api/health). Start it, or pass --base.`,
  );
  process.exit(2);
}

console.log(`Ms. Fenwick eval: ${QUESTIONS.length} questions against ${BASE} (${MODE} research)\n`);
const rows = [];
for (const [i, q] of QUESTIONS.entries()) {
  process.stdout.write(`[${String(i + 1).padStart(2)}/${QUESTIONS.length}] ${q.id.padEnd(26)} `);
  let r;
  try {
    r = await ask(q);
  } catch (error) {
    if (error.code === "not_configured") {
      console.log(`\n\nThe Librarian isn't set up on this server: ${error.message}`);
      process.exit(2);
    }
    r = {
      task: null,
      trail: [],
      outcome: "error",
      ms: 0,
      error: { code: error.code ?? "error", message: error.message },
    };
  }
  const s = score(q, r);
  rows.push(s);
  console.log(
    `${s.pass ? "PASS" : "FAIL"}  ${s.outcome.padEnd(9)} ${String(s.seconds).padStart(6)} s  ${s.sources} sources (${s.trustedSources} credible)${s.why ? `  ${s.why}` : ""}`,
  );
}

const answers = rows.filter((r) => r.expect === "answer");
const declines = rows.filter((r) => r.expect === "decline");
const answeredRows = rows.filter((r) => r.outcome === "answered");
const sourcesTotal = answeredRows.reduce((n, r) => n + r.sources, 0);
const trustedTotal = answeredRows.reduce((n, r) => n + r.trustedSources, 0);
const times = answeredRows.map((r) => r.seconds).sort((a, b) => a - b);
const median = times.length ? times[Math.floor((times.length - 1) / 2)] : null;
const summary = {
  base: BASE,
  mode: MODE,
  ranAt: new Date().toISOString(),
  passed: rows.filter((r) => r.pass).length,
  total: rows.length,
  answerPass: `${answers.filter((r) => r.pass).length}/${answers.length}`,
  declinePass: `${declines.filter((r) => r.pass).length}/${declines.length}`,
  medianSecondsToAnswer: median,
  sourcesPerAnswer: answeredRows.length
    ? Math.round((sourcesTotal / answeredRows.length) * 10) / 10
    : null,
  credibleSourceShare: sourcesTotal ? Math.round((trustedTotal / sourcesTotal) * 100) / 100 : null,
};

console.log(`\nPassed ${summary.passed}/${summary.total}`);
console.log(`  should answer:  ${summary.answerPass}`);
console.log(`  should decline: ${summary.declinePass}`);
console.log(`  median time to an answer: ${median ?? "n/a"} s`);
console.log(
  `  sources per answer: ${summary.sourcesPerAnswer ?? "n/a"}, on credible sites: ${summary.credibleSourceShare === null ? "n/a" : `${Math.round(summary.credibleSourceShare * 100)}%`}`,
);

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ summary, results: rows }, null, 2) + "\n");
  console.log(`\nDetails written to ${OUT}`);
}
process.exit(summary.passed === summary.total ? 0 : 1);
