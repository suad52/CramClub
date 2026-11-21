#!/usr/bin/env node
/**
 * Multiplayer latency: how long after one student moves (or changes expression) another student's
 * browser receives it, through the real game server.
 *
 *   node scripts/bench/latency.mjs [--samples 200] [--port 2599] [--json]
 *
 * What it does:
 *   1. Starts apps/game-server (src/index.ts through tsx, as `pnpm dev:server` does but without
 *      watch mode and WITHOUT loading apps/game-server/.env) on a spare port, with a throwaway
 *      GAME_TICKET_SECRET made for this run and passed only in the child's environment. It is
 *      never printed or written anywhere.
 *   2. Signs two join tickets with that secret (signTicket from @ovr/shared, what the web app's
 *      GET /api/net/ticket does) and joins the library room with two @colyseus/sdk clients (the
 *      browser's SDK build) in this process, so both ends share one clock.
 *   3. Moves: client A sends `move` at 10/s (under NET.MOVE_HZ), standing still and only turning,
 *      each turn a unique angle. The server validates it and the change reaches B in the next
 *      state patch (Colyseus' default patchRate, 50 ms). Measured: A's send -> B's state callback.
 *   4. Faces: A sends `face` at 8/s (NET.FACE_HZ), each with a unique `smile` value. The server
 *      clamps it and relays it to everyone else at once (not via the state). Measured: A's send ->
 *      B's "face" message.
 *   5. Leaves both rooms and stops the server (SIGTERM, then SIGKILL after 5 s).
 *
 * Caveat: this is local loopback on one machine, so it measures the server's own handling plus
 * Colyseus' patch interval, not internet round trips. On screen, remote avatars are also drawn
 * NET.INTERP_DELAY_MS in the past on purpose (smooth interpolation), which the script reports
 * separately rather than hiding inside the numbers.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  GAME_DIR,
  gameRequire,
  loadSdk,
  loadShared,
  machine,
  ms,
  packageDir,
  summarize,
} from "./lib.mjs";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
}
const SAMPLES = Math.max(20, Math.min(2000, arg("samples", 200)));
const PORT = arg("port", 2599);
const WARMUP = 10;
const JSON_OUT = process.argv.includes("--json");
const MOVE_INTERVAL_MS = 100;
const FACE_INTERVAL_MS = 125;

const log = (...a) => {
  if (!JSON_OUT) console.log(...a);
};

/* ---- 1. The server ---- */

async function portFree(port) {
  return new Promise((resolve) => {
    const probe = createServer()
      .once("error", () => resolve(false))
      .once("listening", () => probe.close(() => resolve(true)))
      .listen(port);
  });
}

if (!(await portFree(PORT))) {
  console.error(`Port ${PORT} is in use. Pick another with --port.`);
  process.exit(2);
}

const secret = randomBytes(32).toString("hex");
const tsxCli = join(packageDir(gameRequire, "tsx"), "dist/cli.mjs");
let serverLog = "";
const child = spawn(process.execPath, [tsxCli, "src/index.ts"], {
  cwd: GAME_DIR,
  // A minimal environment: nothing inherited but PATH and HOME, so no real secret can leak in.
  env: {
    PATH: process.env.PATH ?? "",
    HOME: process.env.HOME ?? "",
    GAME_SERVER_PORT: String(PORT),
    GAME_TICKET_SECRET: secret,
    ALLOWED_ORIGINS: "http://localhost:3100",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout.on("data", (d) => (serverLog += d));
child.stderr.on("data", (d) => (serverLog += d));

let stopping = null;
function stopServer() {
  stopping ??= new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    const kill = setTimeout(() => child.kill("SIGKILL"), 5000);
    child.once("exit", () => {
      clearTimeout(kill);
      resolve();
    });
    child.kill("SIGTERM");
  });
  return stopping;
}
process.on("SIGINT", () => void stopServer().then(() => process.exit(130)));
const watchdog = setTimeout(async () => {
  console.error("Timed out. Server output:\n" + serverLog.slice(-2000));
  await stopServer();
  process.exit(1);
}, 180_000);
watchdog.unref();

async function waitForHealth() {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    if (child.exitCode !== null)
      throw new Error("the game server exited:\n" + serverLog.slice(-2000));
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await sleep(200);
  }
  throw new Error("the game server didn't answer /health in 30 s:\n" + serverLog.slice(-2000));
}

/* ---- 2-5. Two players ---- */

async function run() {
  const shared = await loadShared();
  const { Client, Callbacks } = await loadSdk();
  const { LIBRARY_ROOM_NAME, NET, learnerKey, newTicketId, signTicket } = shared;

  log(`Starting the game server on :${PORT} (throwaway ticket secret)...`);
  const started = performance.now();
  await waitForHealth();
  const bootMs = performance.now() - started;

  const ticket = async (name, learner) =>
    signTicket(secret, {
      key: await learnerKey(secret, learner),
      name,
      signedIn: false,
      exp: Math.floor(Date.now() / 1000) + 120,
      jti: newTicketId(),
    });
  const url = `ws://127.0.0.1:${PORT}`;
  const roomA = await new Client(url).joinOrCreate(LIBRARY_ROOM_NAME, {
    ticket: await ticket("Bench A", "bench-learner-a"),
  });
  const roomB = await new Client(url).joinById(roomA.roomId, {
    ticket: await ticket("Bench B", "bench-learner-b"),
  });

  /* Moves: B watches A's player in the state. */
  const pendingMoves = new Map();
  const moveLatencies = [];
  let seenA = null;
  const callbacks = Callbacks.get(roomB);
  callbacks.onAdd("players", (player, sessionId) => {
    if (sessionId !== roomA.sessionId) return;
    seenA = player;
    callbacks.onChange(player, () => {
      const k = Math.round((player.ry + 3) * 100);
      const sentAt = pendingMoves.get(k);
      if (sentAt === undefined) return;
      pendingMoves.delete(k);
      moveLatencies.push(performance.now() - sentAt);
    });
  });

  /* Faces: B gets A's relayed params. */
  const pendingFaces = new Map();
  const faceLatencies = [];
  roomB.onMessage("face", (msg) => {
    if (msg?.from !== roomA.sessionId || !msg.params) return;
    const k = Math.round(msg.params.smile * 1000);
    const sentAt = pendingFaces.get(k);
    if (sentAt === undefined) return;
    pendingFaces.delete(k);
    faceLatencies.push(performance.now() - sentAt);
  });
  roomB.onMessage("seat", () => {});
  roomB.onMessage("seat_denied", () => {});
  roomA.onMessage("face", () => {});
  roomA.onMessage("seat", () => {});
  roomA.onMessage("seat_denied", () => {});

  // A's own spawn, as the server placed it; the first move "places" the player there.
  for (let i = 0; i < 50 && !roomA.state?.players?.get?.(roomA.sessionId); i++) await sleep(20);
  const me = roomA.state.players.get(roomA.sessionId);
  const at = { x: me.x, y: me.y, z: me.z };
  for (let i = 0; i < 50 && !seenA; i++) await sleep(20);
  if (!seenA) throw new Error("client B never saw client A join");

  log(`Measuring ${SAMPLES} moves at ${1000 / MOVE_INTERVAL_MS}/s...`);
  const totalMoves = SAMPLES + WARMUP;
  for (let i = 0; i < totalMoves; i++) {
    const k = i % 600; // unique angle among the moves still in flight
    const ry = -3 + k * 0.01;
    if (i === WARMUP) moveLatencies.length = 0;
    pendingMoves.set(k, performance.now());
    roomA.send("move", { ...at, ry, movement: "idle", speed: 0 });
    await sleep(MOVE_INTERVAL_MS);
  }
  await sleep(300);
  const movesLost = Math.max(0, SAMPLES - moveLatencies.length);

  log(`Measuring ${SAMPLES} face messages at ${1000 / FACE_INTERVAL_MS}/s...`);
  const base = {
    headYaw: 0.031,
    headPitch: -0.212,
    headRoll: 0.011,
    eyeBlinkLeft: 0.043,
    eyeBlinkRight: 0.047,
    jawOpen: 0.021,
    browRaise: 0.064,
  };
  const totalFaces = SAMPLES + WARMUP;
  for (let i = 0; i < totalFaces; i++) {
    const k = 1 + (i % 998);
    if (i === WARMUP) faceLatencies.length = 0;
    pendingFaces.set(k, performance.now());
    roomA.send("face", { ...base, smile: k / 1000 });
    await sleep(FACE_INTERVAL_MS);
  }
  await sleep(300);
  const facesLost = Math.max(0, SAMPLES - faceLatencies.length);

  await Promise.allSettled([roomA.leave(), roomB.leave()]);

  const move = summarize(moveLatencies);
  const face = summarize(faceLatencies);
  return {
    measuredAt: new Date().toISOString(),
    machine: machine(),
    setup: {
      transport: "local loopback (127.0.0.1), both clients in one process",
      server: "apps/game-server src/index.ts via tsx (no watch)",
      samples: SAMPLES,
      warmupDiscarded: WARMUP,
      moveSendHz: 1000 / MOVE_INTERVAL_MS,
      faceSendHz: 1000 / FACE_INTERVAL_MS,
      patchRateMs: 50,
      interpDelayMs: NET.INTERP_DELAY_MS,
      serverBootMs: Math.round(bootMs),
    },
    move: { ...move, lost: movesLost },
    face: { ...face, lost: facesLost },
    onScreenMove: {
      p50: move.p50 === null ? null : move.p50 + NET.INTERP_DELAY_MS,
      p95: move.p95 === null ? null : move.p95 + NET.INTERP_DELAY_MS,
    },
  };
}

let exitCode = 0;
try {
  const r = await run();
  if (JSON_OUT) console.log(JSON.stringify(r, null, 2));
  else {
    const row = (label, s) =>
      `${label.padEnd(34)} p50 ${ms(s.p50).padStart(8)}   p95 ${ms(s.p95).padStart(8)}   p99 ${ms(s.p99).padStart(8)}   max ${ms(s.max).padStart(8)}   (n=${s.n}, lost ${s.lost})`;
    console.log("");
    console.log(
      `Machine: ${r.machine.cpu}, ${r.machine.cores} cores, ${r.machine.memoryGB} GB, ${r.machine.os}, Node ${r.machine.node}`,
    );
    console.log(`Transport: ${r.setup.transport}\n`);
    console.log(row("move -> other player's state", r.move));
    console.log(row("face -> other player (relay)", r.face));
    console.log(
      `\nMoves wait for the next state patch (every ${r.setup.patchRateMs} ms), faces are relayed at once.`,
    );
    console.log(
      `On screen, remote avatars are drawn ${r.setup.interpDelayMs} ms in the past on purpose (interpolation): move p50 ${ms(r.onScreenMove.p50)}, p95 ${ms(r.onScreenMove.p95)} from key press to the other screen, before network distance.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  await stopServer();
  clearTimeout(watchdog);
}
process.exit(exitCode);
