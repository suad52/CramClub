#!/usr/bin/env node
/**
 * End-to-end check of the library chat: real sockets, the real game server, the real web app
 * and the real Gemini behind Ms. Fenwick.
 *
 *   node scripts/e2e/chat-fenwick.mjs [--port 2598] [--web http://localhost:3100] [--json]
 *
 * Needs the web dev server already running on --web (`pnpm dev:web`, which reads
 * apps/web/.env.local, so it has GAME_TICKET_SECRET and GEMINI_API_KEY). Run `pnpm install`
 * once: like scripts/bench, this borrows @colyseus/sdk from apps/web and tsx from
 * apps/game-server (../bench/lib.mjs) and has no package.json of its own.
 *
 * What it does:
 *   1. Reads GAME_TICKET_SECRET from apps/web/.env.local into memory (the web app must sign and
 *      check with the same one). It is never printed, logged or written anywhere: it goes only
 *      into the child's environment, and anything echoed from the child is scrubbed of it.
 *   2. Starts apps/game-server (src/index.ts through tsx, no watch, WITHOUT apps/game-server/.env)
 *      on a spare port with a minimal environment: PATH, HOME, GAME_SERVER_PORT, that secret and
 *      WEB_INTERNAL_URL = --web. ALLOWED_ORIGINS stays unset. The running dev servers (:2567,
 *      :3100) are left alone.
 *   3. Joins the library room with @colyseus/sdk clients (the browser's SDK build) in this
 *      process, each with its own learner key and a ticket signed by signTicket from @ovr/shared
 *      (what GET /api/net/ticket does), and runs the scenarios below one room at a time (every
 *      client leaves before the next starts, so each gets a fresh room and fresh cooldowns).
 *   4. Prints a pass/fail table with timings and every reply Ms. Fenwick actually wrote, leaves
 *      every room and stops the server (SIGTERM, then SIGKILL after 5 s). Exit code 1 on a FAIL.
 *
 * Scenarios (times are from the asker's send, measured in this process). "fenwick_typing" on goes
 * out only once her reply has taken FENWICK_TYPING_DELAY_MS (0.5 s), so a quick reply may come
 * with no "on" at all; when "on" comes, "off" follows it:
 *   a  alone, "what's the powerhouse of the cell?": at ~3 s (GHOST_ALONE_MS) her line (from
 *      FENWICK_ID, replyTo = the asker's sessionId), typing on/off around it if it took a moment.
 *   b  two players, A asks, B answers within 5 s: no line or typing to A within 12 s, and none
 *      to B either (B's answer isn't waiting for one) within 12 s of it.
 *   c  two players, A asks, nobody answers: she answers A at ~10 s (GHOST_MS); B sees it too.
 *   d  B types (refreshing) from 8 s to 14 s after A asks: she waits until B stops, then answers.
 *   e  alone, "brb": no line, and no typing flash (the web app says "no reply" at once).
 *   f  the typing flag: on, off, cleared by sending a line, and switched off after
 *      TYPING_IDLE_MS without a refresh, as another player sees it in the state.
 *   g  a late joiner gets chat_history: c's question and her reply, in order.
 *   h  a chat message carrying from/name/replyTo/id is stamped by the server anyway (no
 *      spoofing her or anyone), and 10 lines at once get CHAT.BURST through.
 *   i  POST /api/internal/fenwick-chat with no signature, a wrong one, a stale one: 401. One
 *      correctly signed "brb" (needs no reply, so Gemini isn't called): 200 {reply:null};
 *      the same request again: 401 (each signature works once).
 *
 * Each scenario that reaches her is one Gemini call (a, b maybe, c, d); e and i never reach it.
 * Chat text in this script is harmless study chat.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join as joinPath } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { GAME_DIR, WEB_DIR, gameRequire, loadSdk, loadShared, packageDir } from "../bench/lib.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const PORT = Number(arg("port", "2598"));
const WEB = String(arg("web", "http://localhost:3100")).replace(/\/+$/, "");
const JSON_OUT = process.argv.includes("--json");
const log = (...a) => {
  if (!JSON_OUT) console.log(...a);
};

/* ---- 1. The secret (memory only) ---- */

function readSecret() {
  let text;
  try {
    text = readFileSync(joinPath(WEB_DIR, ".env.local"), "utf8");
  } catch {
    return null;
  }
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?GAME_TICKET_SECRET\s*=\s*(.*)$/.exec(raw);
    if (!m) continue;
    let v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, "");
    return v.trim() || null;
  }
  return null;
}
const SECRET = readSecret();
if (!SECRET) {
  console.error("GAME_TICKET_SECRET isn't set in apps/web/.env.local: nothing to test against.");
  process.exit(2);
}
/** Anything from the child that gets printed goes through this first. */
const scrub = (s) => String(s).split(SECRET).join("<redacted>");

/* ---- 2. The game server ---- */

async function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port);
  });
}

let child = null;
let serverLog = "";
let stopping = null;
function stopServer() {
  stopping ??= new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return resolve();
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    child.kill("SIGTERM");
  });
  return stopping;
}

function startServer() {
  const tsxCli = joinPath(packageDir(gameRequire, "tsx"), "dist/cli.mjs");
  child = spawn(process.execPath, [tsxCli, "src/index.ts"], {
    cwd: GAME_DIR,
    // Nothing inherited but PATH and HOME (no other secret can leak in); no ALLOWED_ORIGINS.
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      GAME_SERVER_PORT: String(PORT),
      GAME_TICKET_SECRET: SECRET,
      WEB_INTERNAL_URL: WEB,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (d) => (serverLog += d));
  child.stderr.on("data", (d) => (serverLog += d));
}

async function waitForHealth() {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (child.exitCode !== null)
      throw new Error("the game server exited:\n" + scrub(serverLog.slice(-2000)));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error("no /health in 30 s:\n" + scrub(serverLog.slice(-2000)));
}

/* ---- 3. Players ---- */

let shared;
let sdk;
const openRooms = new Set();
const runTag = randomBytes(4).toString("hex");
let learnerCount = 0;

/**
 * One SDK client in the room, recording everything it hears with this process's clock:
 * { type: "chat" | "chat_history" | "fenwick_typing" | "typing", at, msg }.
 * "typing" events come from the state: another player's `typing` changed.
 */
class Player {
  constructor(name, room) {
    this.name = name;
    this.room = room;
    this.id = room.sessionId;
    this.events = [];
    this.waiters = new Set();
    this.typingOf = new Map();
  }
  push(type, msg) {
    const event = { type, at: performance.now(), msg };
    this.events.push(event);
    for (const w of [...this.waiters]) if (w.pred(event)) w.done(event);
  }
  /** The first event (since `from`, an index into events) matching `pred`, or null after `ms`. */
  waitFor(pred, ms, from = 0) {
    const hit = this.events.slice(from).find(pred);
    if (hit) return Promise.resolve(hit);
    return new Promise((resolve) => {
      const w = {
        pred,
        done: (e) => {
          clearTimeout(timer);
          this.waiters.delete(w);
          resolve(e);
        },
      };
      const timer = setTimeout(() => {
        this.waiters.delete(w);
        resolve(null);
      }, ms);
      this.waiters.add(w);
    });
  }
  mark() {
    return this.events.length;
  }
  since(from, pred = () => true) {
    return this.events.slice(from).filter(pred);
  }
  send(type, msg) {
    this.room.send(type, msg);
  }
  /** Sends a chat line; returns the send time. */
  say(text, extra = {}) {
    const at = performance.now();
    this.room.send("chat", { text, ...extra });
    return at;
  }
  async leave() {
    openRooms.delete(this.room);
    await this.room.leave().catch(() => {});
  }
}

async function ticket(name) {
  const key = await shared.learnerKey(SECRET, `e2e-${runTag}-${++learnerCount}`);
  return shared.signTicket(SECRET, {
    key,
    name,
    signedIn: true,
    exp: Math.floor(Date.now() / 1000) + 120,
    jti: shared.newTicketId(),
  });
}

async function join(name) {
  const client = new sdk.Client(`ws://127.0.0.1:${PORT}`);
  const room = await client.joinOrCreate(shared.LIBRARY_ROOM_NAME, { ticket: await ticket(name) });
  room.reconnection.maxRetries = 0;
  openRooms.add(room);
  const p = new Player(name, room);
  for (const type of ["chat", "chat_history", "fenwick_typing"])
    room.onMessage(type, (msg) => p.push(type, msg));
  for (const type of ["face", "seat", "seat_denied"]) room.onMessage(type, () => {});
  const callbacks = sdk.Callbacks.get(room);
  callbacks.onAdd("players", (player, sessionId) => {
    if (sessionId === room.sessionId) return;
    p.typingOf.set(sessionId, player.typing === true);
    callbacks.onChange(player, () => {
      const on = player.typing === true;
      if (p.typingOf.get(sessionId) === on) return;
      p.typingOf.set(sessionId, on);
      p.push("typing", { id: sessionId, on });
    });
  });
  return p;
}

/** Everyone leaves; the room closes, so the next scenario gets a fresh one. */
async function leaveAll(...players) {
  await Promise.all(players.map((p) => p.leave()));
  await sleep(400);
}

const isFenwickLine = (to) => (e) =>
  e.type === "chat" &&
  e.msg?.from === shared.FENWICK_ID &&
  (to === undefined || e.msg.replyTo === to);
const isFenTyping = (on, to) => (e) =>
  e.type === "fenwick_typing" && e.msg?.on === on && (to === undefined || e.msg.to === to);
const secs = (ms) => (ms === null || ms === undefined ? "n/a" : `${(ms / 1000).toFixed(2)} s`);

/* ---- 4. Results ---- */

const results = [];
const replies = [];
function record(id, title, status, timing, detail) {
  results.push({ id, title, status, timing, detail });
}
function noteReply(scenario, line, askedAt, arrivedAt) {
  replies.push({
    scenario,
    text: line.text,
    chars: [...line.text].length,
    after: arrivedAt - askedAt,
  });
}

/**
 * Follows her through for `asker` (as `asker` hears it): the first sign of her (typing on, or
 * her line straight away when it came quickly), then, after an "on", the "off" that follows it.
 */
async function followFenwick(asker, from, askedAt, withinMs) {
  const first = await asker.waitFor(
    (e) => isFenTyping(true, asker.id)(e) || isFenwickLine(asker.id)(e),
    withinMs,
    from,
  );
  if (!first) return { first: null, on: null };
  const on = first.type === "fenwick_typing" ? first : null;
  const off = on ? await asker.waitFor(isFenTyping(false, asker.id), 16_000, from) : null;
  if (!on) await sleep(300); // an "on" that comes after her line would be a bug: give it a moment
  const lateOn = !on && asker.since(from, isFenTyping(true, asker.id)).length > 0;
  const line = asker.since(from, isFenwickLine(asker.id))[0] ?? null;
  return {
    first,
    on,
    off,
    line,
    lateOn,
    firstAfter: first.at - askedAt,
    onAfter: on ? on.at - askedAt : null,
    offAfter: off ? off.at - askedAt : null,
  };
}

/** Problems with her typing on/off around a line. */
function typingIssues(r) {
  const issues = [];
  if (r.on && !r.off) issues.push("fenwick_typing on, never off");
  if (r.lateOn) issues.push("fenwick_typing on after her line");
  if (r.off && r.line && r.off.at < r.line.at) issues.push("off came before her line");
  return issues;
}

function checkLine(line, asker) {
  const problems = [];
  if (line.msg.from !== shared.FENWICK_ID) problems.push("from");
  if (line.msg.name !== shared.FENWICK_NAME) problems.push("name");
  if (line.msg.replyTo !== asker.id) problems.push("replyTo");
  if (!/^c\d+$/.test(line.msg.id ?? "")) problems.push("id");
  const n = [...(line.msg.text ?? "")].length;
  if (n < 1 || n > shared.CHAT.MAX_CHARS) problems.push(`length ${n}`);
  if (/\n/.test(line.msg.text)) problems.push("newline");
  return problems;
}

/* (a) alone, a real question */
async function scenarioA() {
  const a = await join("Ada");
  await sleep(300);
  const from = a.mark();
  const askedAt = a.say("what's the powerhouse of the cell?");
  const r = await followFenwick(a, from, askedAt, 6000);
  if (!r.first) {
    record("a", "alone: asks, she answers", "FAIL", "", "nothing from her in 6 s");
    return leaveAll(a);
  }
  const issues = [];
  if (r.firstAfter < 2800 || r.firstAfter > 4500)
    issues.push(`first sign of her at ${secs(r.firstAfter)} (want ~3–3.5 s)`);
  if (r.on && r.onAfter < 3300) issues.push(`typing on at ${secs(r.onAfter)} (want ≥ 3.5 s)`);
  if (!r.line) issues.push("no line from her");
  else {
    issues.push(...checkLine(r.line, a).map((p) => `bad ${p}`));
    noteReply("a", r.line.msg, askedAt, r.line.at);
  }
  issues.push(...typingIssues(r));
  record(
    "a",
    "alone: asks, she answers",
    issues.length ? "FAIL" : "PASS",
    `on ${secs(r.onAfter)}, line ${secs(r.line ? r.line.at - askedAt : null)}, off ${secs(r.offAfter)}`,
    issues.join("; ") || `replyTo = asker's sessionId`,
  );
  await leaveAll(a);
}

/* (b) someone else answers within 5 s */
async function scenarioB() {
  const a = await join("Bea");
  const b = await join("Cal");
  await sleep(300);
  const fromA = a.mark();
  const askedAt = a.say("does anyone know what a mitochondrion does?");
  await sleep(3000);
  const answeredAt = b.say("it makes energy for the cell, ATP!");
  const stray = await a.waitFor(
    (e) => isFenTyping(true, a.id)(e) || isFenwickLine(a.id)(e),
    Math.max(0, askedAt + 12_000 - performance.now()),
    fromA,
  );
  // B's answer isn't a question: it isn't waiting for an answer, so she leaves B alone too.
  const toB = await b.waitFor(
    (e) => isFenTyping(true, b.id)(e) || isFenwickLine(b.id)(e),
    Math.max(0, answeredAt + 12_000 - performance.now()),
    0,
  );
  const bLine = b.since(0, isFenwickLine(b.id))[0];
  if (bLine) noteReply("b (to B's answer!)", bLine.msg, answeredAt, bLine.at);
  const issues = [];
  if (stray) issues.push(`she reached A at ${secs(stray.at - askedAt)}`);
  if (toB) issues.push(`she reached B at ${secs(toB.at - answeredAt)} after B's answer`);
  record(
    "b",
    "B answers in 3 s: she stays out",
    issues.length ? "FAIL" : "PASS",
    `quiet to A for ${secs(performance.now() - askedAt)}`,
    issues.join("; ") || "nothing to A in 12 s, nothing to B in 12 s after B's answer",
  );
  await leaveAll(a, b);
}

/* (c) nobody answers, with someone present; (g) a late joiner then gets the history */
async function scenarioCG() {
  const a = await join("Dev");
  const b = await join("Eli");
  await sleep(300);
  const fromA = a.mark();
  const fromB = b.mark();
  const question = "can someone explain what a derivative is?";
  const askedAt = a.say(question);
  const r = await followFenwick(a, fromA, askedAt, 13_000);
  const issues = [];
  if (!r.first) issues.push("nothing from her in 13 s");
  else {
    if (r.firstAfter < 9800 || r.firstAfter > 11_500)
      issues.push(`first sign of her at ${secs(r.firstAfter)} (want ~10–10.5 s)`);
    if (!r.line) issues.push("no line from her");
    else {
      issues.push(...checkLine(r.line, a).map((p) => `bad ${p}`));
      noteReply("c", r.line.msg, askedAt, r.line.at);
      const seenByB = await b.waitFor(isFenwickLine(a.id), 2000, fromB);
      if (!seenByB) issues.push("B didn't get her line");
      const bOn = b.since(fromB, isFenTyping(true, a.id)).length;
      if (r.on && !bOn) issues.push("B didn't see her typing");
    }
    issues.push(...typingIssues(r));
  }
  record(
    "c",
    "nobody answers (2 in room): she does",
    issues.length ? "FAIL" : "PASS",
    `on ${secs(r.onAfter)}, line ${secs(r.line ? r.line.at - askedAt : null)}, off ${secs(r.offAfter)}`,
    issues.join("; ") ||
      `B saw her line (replyTo A)${r.on ? " and her typing" : "; she was quick: no typing shown"}`,
  );

  // (g)
  const joinAt = performance.now();
  const c = await join("Fox");
  const hist = await c.waitFor((e) => e.type === "chat_history", 3000);
  const gIssues = [];
  let detail = "";
  if (!hist) gIssues.push("no chat_history");
  else {
    const lines = hist.msg?.lines ?? [];
    const qi = lines.findIndex((l) => l.from === a.id && l.text === question);
    const fi = lines.findIndex((l) => l.from === shared.FENWICK_ID && l.replyTo === a.id);
    if (qi < 0) gIssues.push("question missing");
    if (r.line && fi < 0) gIssues.push("her reply missing");
    if (qi >= 0 && fi >= 0 && fi < qi) gIssues.push("out of order");
    if (lines.length > shared.CHAT.HISTORY) gIssues.push(`${lines.length} lines > HISTORY`);
    const live = c.since(0, (e) => e.type === "chat").length;
    detail = `${lines.length} lines, question + her reply in order; ${live} live repeats`;
    if (live) gIssues.push("history lines also arrived as live chat");
  }
  record(
    "g",
    "late joiner gets chat_history",
    gIssues.length ? "FAIL" : "PASS",
    hist ? `${Math.round(hist.at - joinAt)} ms after joinOrCreate began` : "",
    gIssues.join("; ") || detail,
  );
  await leaveAll(a, b, c);
}

/* (d) someone typing at the deadline delays her */
async function scenarioD() {
  const a = await join("Gus");
  const b = await join("Hal");
  await sleep(300);
  const fromA = a.mark();
  const askedAt = a.say("how do I balance a chemical equation?");
  const at = (ms) => sleep(Math.max(0, askedAt + ms - performance.now()));
  await at(8000);
  b.send("typing", { on: true });
  await at(10_000);
  b.send("typing", { on: true });
  await at(12_000);
  b.send("typing", { on: true });
  await at(14_000);
  const stoppedAt = performance.now();
  b.send("typing", { on: false });
  const r = await followFenwick(a, fromA, askedAt, 9000);
  const issues = [];
  const early = r.first && r.first.at < stoppedAt;
  if (!r.first) issues.push("nothing from her by 23 s");
  else {
    if (early) issues.push(`first sign of her at ${secs(r.firstAfter)}, before B stopped typing`);
    if (r.firstAfter > 16_500)
      issues.push(
        `first sign of her at ${secs(r.firstAfter)} (want ≤ 1.5 s after B stops at 14 s)`,
      );
    if (!r.line) issues.push("no line from her");
    else {
      issues.push(...checkLine(r.line, a).map((p) => `bad ${p}`));
      noteReply("d", r.line.msg, askedAt, r.line.at);
    }
    issues.push(...typingIssues(r));
  }
  const aSawB =
    a.since(fromA, (e) => e.type === "typing" && e.msg.id === b.id && e.msg.on).length > 0;
  if (!aSawB) issues.push("A never saw B typing");
  record(
    "d",
    "B typing 8–14 s delays her",
    issues.length ? "FAIL" : "PASS",
    `B stops ${secs(stoppedAt - askedAt)}, on ${secs(r.onAfter)}, line ${secs(r.line ? r.line.at - askedAt : null)}`,
    issues.join("; ") || "waited past 10 s for B, answered once B stopped",
  );
  await leaveAll(a, b);
}

/* (e) "brb" alone: she takes it up, decides it needs no reply */
async function scenarioE() {
  const a = await join("Ivy");
  await sleep(300);
  const from = a.mark();
  const askedAt = a.say("brb");
  await sleep(6000);
  let status = "PASS";
  const issues = [];
  const line = a.since(from, isFenwickLine(a.id))[0];
  const on = a.since(from, isFenTyping(true, a.id))[0];
  const off = a.since(from, isFenTyping(false, a.id))[0];
  if (line) {
    status = "FAIL";
    noteReply("e (brb!)", line.msg, askedAt, line.at);
    issues.push(`she replied anyway: "${line.msg.text}"`);
  }
  if (on) {
    if (status === "PASS") status = "WARN";
    issues.push(`typing flashed at ${secs(on.at - askedAt)}${off ? "" : " and never went off"}`);
  }
  record(
    "e",
    'alone: "brb" gets no reply',
    status,
    `${secs(performance.now() - askedAt)} watched`,
    issues.join("; ") || "no line, no typing flash",
  );
  await leaveAll(a);
}

/* (f) the typing flag */
async function scenarioF() {
  const a = await join("Jo");
  const b = await join("Kit");
  await sleep(300);
  const issues = [];
  const typingOf = (on, from) =>
    b.waitFor((e) => e.type === "typing" && e.msg.id === a.id && e.msg.on === on, 1500, from);
  const timings = [];

  let m = b.mark();
  let t = performance.now();
  a.send("typing", { on: true });
  let e = await typingOf(true, m);
  if (!e) issues.push("on not seen");
  else timings.push(`on ${Math.round(e.at - t)} ms`);

  m = b.mark();
  t = performance.now();
  a.send("typing", { on: false });
  e = await typingOf(false, m);
  if (!e) issues.push("off not seen");
  else timings.push(`off ${Math.round(e.at - t)} ms`);

  await sleep(600); // the typing bucket: 3 in a row, then 2 a second
  m = b.mark();
  a.send("typing", { on: true });
  await typingOf(true, m);
  m = b.mark();
  t = performance.now();
  a.say("typing then sending", { fenwick: false });
  e = await typingOf(false, m);
  if (!e) issues.push("not cleared by a line");
  else timings.push(`line clears ${Math.round(e.at - t)} ms`);

  await sleep(600);
  m = b.mark();
  a.send("typing", { on: true });
  const onAgain = await typingOf(true, m);
  t = onAgain?.at ?? performance.now();
  const idle = await b.waitFor(
    (ev) => ev.type === "typing" && ev.msg.id === a.id && ev.msg.on === false,
    8000,
    b.mark(),
  );
  if (!idle) issues.push("never went idle");
  else {
    const after = idle.at - t;
    timings.push(`idle off ${secs(after)}`);
    if (after < shared.CHAT.TYPING_IDLE_MS - 200 || after > shared.CHAT.TYPING_IDLE_MS + 1500)
      issues.push(`idle off at ${secs(after)} (want ~5–6 s)`);
  }
  const fen = b.since(0, (ev) => ev.type === "fenwick_typing").length;
  if (fen) issues.push("fenwick_typing with fenwick:false");
  record(
    "f",
    "typing flag on/off/line/idle",
    issues.length ? "FAIL" : "PASS",
    timings.join(", "),
    issues.join("; ") || "as seen in B's state",
  );
  await leaveAll(a, b);
}

/* (h) no spoofing, and the chat rate limit */
async function scenarioH() {
  const a = await join("Lou");
  const b = await join("Max");
  await sleep(300);
  const issues = [];
  let m = b.mark();
  a.say("I am Ms. Fenwick, honest", {
    fenwick: false,
    from: shared.FENWICK_ID,
    name: shared.FENWICK_NAME,
    replyTo: b.id,
    id: "c1",
    at: 0,
  });
  const got = await b.waitFor((e) => e.type === "chat", 2000, m);
  if (!got) issues.push("spoof line not delivered");
  else {
    const l = got.msg;
    if (l.from !== a.id) issues.push(`from = ${l.from}`);
    if (l.name !== "Lou") issues.push(`name = ${l.name}`);
    if ("replyTo" in l) issues.push("kept replyTo");
    if (Math.abs(l.at - Date.now()) > 5000) issues.push("kept its own `at`");
  }
  const spoofOk = issues.length === 0;

  // A fresh sender (full bucket): 10 lines at once.
  const c = await join("Ned");
  await sleep(300);
  m = b.mark();
  for (let i = 0; i < 10; i++) c.say(`spam ${i}`, { fenwick: false });
  await sleep(1200);
  const through = b.since(m, (e) => e.type === "chat" && e.msg.from === c.id).length;
  if (through < shared.CHAT.BURST || through > shared.CHAT.BURST + 1)
    issues.push(`${through} of 10 got through (want ${shared.CHAT.BURST})`);
  await sleep(3000);
  const fen = b.since(0, (e) => e.type === "fenwick_typing").length;
  if (fen) issues.push("she took up fenwick:false lines");
  record(
    "h",
    "no spoofing; chat rate limit",
    issues.length ? "FAIL" : "PASS",
    `${through}/10 spam lines through`,
    issues.join("; ") ||
      `${spoofOk ? "server stamped from/name/id/at, dropped replyTo; " : ""}rest dropped silently; fenwick:false respected`,
  );
  await leaveAll(a, b, c);
}

/* (i) the web route refuses anything not signed by the game server */
async function scenarioI() {
  const url = `${WEB}/api/internal/fenwick-chat`;
  const body = JSON.stringify({
    askerName: "Ivy",
    lines: [{ name: "Ivy", text: "brb", fenwick: false, asker: true }],
    alone: true,
  });
  const post = (headers, b = body) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: b,
    })
      .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))
      .catch((e) => ({ status: 0, json: { error: e.name } }));
  const H = { sig: shared.INTERNAL_SIGNATURE_HEADER, ts: shared.INTERNAL_TIMESTAMP_HEADER };
  const now = Date.now();
  const forged = await shared.signInternal("not-the-secret", now, body);
  const stale = Date.now() - 5 * 60_000;
  const t0 = performance.now();
  const cases = [
    ["unsigned", await post({})],
    [
      "random sig",
      await post({ [H.sig]: randomBytes(32).toString("base64url"), [H.ts]: String(now) }),
    ],
    ["wrong secret", await post({ [H.sig]: forged, [H.ts]: String(now) })],
    [
      "stale (5 min)",
      await post({
        [H.sig]: await shared.signInternal(SECRET, stale, body),
        [H.ts]: String(stale),
      }),
    ],
  ];
  const ts = Date.now();
  const good = { [H.sig]: await shared.signInternal(SECRET, ts, body), [H.ts]: String(ts) };
  const signed = await post(good);
  const replay = await post(good);
  const issues = [];
  for (const [label, r] of cases) if (r.status !== 401) issues.push(`${label}: ${r.status}`);
  if (signed.status !== 200 || signed.json?.reply !== null)
    issues.push(`signed brb: ${signed.status} ${JSON.stringify(signed.json)}`);
  if (replay.status !== 401) issues.push(`replay: ${replay.status}`);
  record(
    "i",
    "forged POSTs to the web route",
    issues.length ? "FAIL" : "PASS",
    `${Math.round(performance.now() - t0)} ms for 6 calls`,
    issues.join("; ") || "4 forgeries → 401; signed brb → 200 {reply:null}; replay → 401",
  );
  return cases[0][1].status;
}

/* ---- Run ---- */

async function main() {
  shared = await loadShared();
  sdk = await loadSdk();

  log(`Web app: ${WEB}  (checking the route first)`);
  const routeStatus = await scenarioI();
  if (routeStatus === 0 || routeStatus === 404) {
    console.error(
      `The web app's ${WEB}/api/internal/fenwick-chat isn't reachable (status ${routeStatus}). Is \`pnpm dev:web\` running?`,
    );
    return 1;
  }

  if (!(await portFree(PORT))) {
    console.error(`Port ${PORT} is in use. Pick another with --port.`);
    return 2;
  }
  log(`Starting the game server on :${PORT} (secret from apps/web/.env.local, not shown)...`);
  startServer();
  await waitForHealth();

  const plan = [
    ["f", scenarioF],
    ["h", scenarioH],
    ["e", scenarioE],
    ["a", scenarioA],
    ["b", scenarioB],
    ["c+g", scenarioCG],
    ["d", scenarioD],
  ];
  for (const [id, fn] of plan) {
    log(`  running ${id}...`);
    try {
      await fn();
    } catch (error) {
      record(id, "crashed", "FAIL", "", scrub(error?.stack ?? error));
      for (const r of [...openRooms]) await r.leave().catch(() => {});
      openRooms.clear();
      await sleep(400);
    }
  }
  return 0;
}

const watchdog = setTimeout(async () => {
  console.error("Timed out after 6 min. Server output:\n" + scrub(serverLog.slice(-3000)));
  await stopServer();
  process.exit(1);
}, 360_000);
watchdog.unref();
process.on("SIGINT", () => void stopServer().then(() => process.exit(130)));

let code = 1;
try {
  code = await main();
} catch (error) {
  console.error(scrub(error?.stack ?? error));
} finally {
  for (const r of [...openRooms]) await r.leave().catch(() => {});
  await stopServer();
  clearTimeout(watchdog);
}

results.sort((x, y) => x.id.localeCompare(y.id));
const failed = results.filter((r) => r.status === "FAIL").length;
const serverWarnings = scrub(serverLog)
  .split("\n")
  .filter((l) => /Ms\. Fenwick's reply|chat timer failed|error/i.test(l))
  .slice(-10);

if (JSON_OUT) {
  console.log(JSON.stringify({ results, replies, serverWarnings }, null, 2));
} else if (results.length) {
  const w = (s, n) => String(s).padEnd(n);
  const tw = Math.max(...results.map((r) => r.title.length));
  const mw = Math.max(...results.map((r) => r.timing.length));
  console.log("");
  console.log(`${w("", 4)}${w("result", 7)}${w("scenario", tw + 2)}${w("timing", mw + 2)}detail`);
  for (const r of results)
    console.log(
      `${w(r.id, 4)}${w(r.status, 7)}${w(r.title, tw + 2)}${w(r.timing, mw + 2)}${r.detail}`,
    );
  console.log("");
  if (replies.length) {
    console.log("What Ms. Fenwick wrote:");
    for (const r of replies)
      console.log(`  (${r.scenario}, ${secs(r.after)} after the line, ${r.chars} chars) ${r.text}`);
  }
  if (serverWarnings.length) {
    console.log("\nGame server warnings:");
    for (const l of serverWarnings) console.log(`  ${l}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed (${failed} failed).`);
}
process.exit(code || (failed ? 1 : 0));
