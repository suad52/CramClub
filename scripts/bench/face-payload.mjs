#!/usr/bin/env node
/**
 * Face tracking on the wire: exactly how many bytes the browser sends when a student turns face
 * tracking on, compared with what a webcam video stream would cost.
 *
 *   node scripts/bench/face-payload.mjs          (add --json for machine-readable output)
 *
 * What is exact and what is an estimate:
 *   - EXACT: the application payload. Each "face" message is built by the real browser SDK
 *     (@colyseus/sdk's Room.send, from apps/web's node_modules) around the eight FacialParams
 *     numbers, with the frame captured instead of sent. The relay the server sends to every other
 *     player is built by the server's own encoder (@colyseus/core's getMessageBytes).
 *   - EXACT: the send rate rules. Synthetic face traces are fed through the client's real
 *     ChangeSender (apps/web/lib/net/rate.ts: at most NET.FACE_HZ a second, only when a value moved
 *     more than FACE_EPSILON, plus the keep-alive from lib/net/connection.ts).
 *   - SYNTHETIC: the face traces themselves (seeded, so every run prints the same numbers).
 *   - ESTIMATE: transport overhead per message (WebSocket frame, TLS 1.3 record, TCP/IPv4 with
 *     timestamps; Ethernet and ACKs left out).
 *   - ASSUMPTION (cited): webcam video bitrates from Zoom's published bandwidth requirements for
 *     1:1 calls: 600 kbps "high quality", 1.2 Mbps 720p HD (support.zoom.com, "Zoom system
 *     requirements: Windows, macOS, Linux"; the figures change over time, check before quoting).
 *
 * No network, no camera, no secrets: everything happens in this process.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import {
  ROOT,
  gameRequire,
  importFile,
  loadSdk,
  loadShared,
  packageDir,
  tsImport,
} from "./lib.mjs";

const JSON_OUT = process.argv.includes("--json");

const { NET } = await loadShared();
const { ChangeSender, faceChanged, copyFace, FACE_EPSILON } = await tsImport(
  join(ROOT, "apps/web/lib/net/rate.ts"),
);
const { Room } = await loadSdk();

// The keep-alive is a module constant in connection.ts (which needs a browser to import): read it
// from the source so this script can't drift from the client.
const connectionSrc = readFileSync(join(ROOT, "apps/web/lib/net/connection.ts"), "utf8");
const keepAliveMatch = connectionSrc.match(/FACE_KEEPALIVE_MS\s*=\s*([\d_]+)/);
if (!keepAliveMatch) throw new Error("FACE_KEEPALIVE_MS not found in lib/net/connection.ts");
const FACE_KEEPALIVE_MS = Number(keepAliveMatch[1].replaceAll("_", ""));

/* ---- The client's frames, built by the real SDK ---- */

const captured = [];
const room = new Room("library");
room.connection = { isOpen: true, send: (data) => captured.push(data.byteLength) };
function clientFrameBytes(params) {
  captured.length = 0;
  room.send("face", params);
  return captured[0];
}

/* ---- The server's relay to each other player, built by the server's encoder ---- */

const coreDir = packageDir(gameRequire, "@colyseus/core");
const { getMessageBytes } = await importFile(join(coreDir, "build/Protocol.mjs"));
const coreRequire = createRequire(join(coreDir, "package.json"));
const { Protocol } = await importFile(
  join(packageDir(coreRequire, "@colyseus/shared-types"), "build/index.mjs"),
);
// Colyseus session ids are 9-character nanoids (@colyseus/core utils generateId).
const SESSION_ID = "aB3dE6gH9";
const relayFrameBytes = (params) =>
  getMessageBytes.raw(Protocol.ROOM_DATA, "face", { from: SESSION_ID, params }).byteLength;

/* ---- Transport overhead (estimates) ---- */

const wsClientHeader = (n) => (n < 126 ? 2 : 4) + 4; // client frames are masked (4-byte key)
const wsServerHeader = (n) => (n < 126 ? 2 : 4);
const TLS13_RECORD = 5 + 1 + 16; // header + inner content type + AEAD tag (wss:// in production)
const TCP_IPV4 = 20 + 20 + 12; // IPv4 + TCP + timestamps option, one segment per message
const wireClient = (n) => n + wsClientHeader(n) + TLS13_RECORD + TCP_IPV4;
const wireServer = (n) => n + wsServerHeader(n) + TLS13_RECORD + TCP_IPV4;

/* ---- Synthetic face traces (seeded) ---- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const TAU = Math.PI * 2;

/**
 * A face at time t (s), with the full double precision the One Euro filter produces.
 * - still: sitting very still; only sub-threshold jitter.
 * - reading: looking down at notes, slow head drift, a blink every 3-5 s.
 * - animated: talking and turning the head (the busiest realistic case).
 */
function traceFor(kind, seed = 7) {
  const rnd = mulberry32(seed);
  let nextBlink = 2 + rnd() * 2;
  const jitter = () => (rnd() - 0.5) * 0.008;
  return (t) => {
    const blinking = t >= nextBlink && t < nextBlink + 0.15;
    if (t >= nextBlink + 0.15) nextBlink = t + 3 + rnd() * 2;
    const blink = blinking ? 0.85 + jitter() : 0.04 + jitter();
    if (kind === "still")
      return {
        headYaw: 0.031 + jitter(),
        headPitch: -0.212 + jitter(),
        headRoll: 0.011 + jitter(),
        eyeBlinkLeft: 0.043 + jitter(),
        eyeBlinkRight: 0.047 + jitter(),
        jawOpen: 0.021 + jitter(),
        smile: 0.118 + jitter(),
        browRaise: 0.064 + jitter(),
      };
    if (kind === "reading")
      return {
        headYaw: 0.06 * Math.sin(TAU * 0.05 * t) + jitter(),
        headPitch: -0.3 + 0.04 * Math.sin(TAU * 0.03 * t) + jitter(),
        headRoll: 0.02 * Math.sin(TAU * 0.04 * t) + jitter(),
        eyeBlinkLeft: blink,
        eyeBlinkRight: blink + jitter(),
        jawOpen: 0.02 + Math.abs(jitter()),
        smile: 0.1 + jitter(),
        browRaise: 0.05 + Math.abs(jitter()),
      };
    const talking = Math.sin(TAU * 0.07 * t) > -0.2;
    return {
      headYaw: clamp(0.28 * Math.sin(TAU * 0.15 * t) + jitter(), -1, 1),
      headPitch: clamp(-0.1 + 0.12 * Math.sin(TAU * 0.11 * t) + jitter(), -1, 1),
      headRoll: clamp(0.08 * Math.sin(TAU * 0.09 * t) + jitter(), -1, 1),
      eyeBlinkLeft: blink,
      eyeBlinkRight: blink + jitter(),
      jawOpen: talking ? 0.05 + 0.3 * Math.abs(Math.sin(TAU * 3.5 * t)) : 0.03 + Math.abs(jitter()),
      smile: 0.2 + 0.15 * Math.sin(TAU * 0.05 * t) + jitter(),
      browRaise: 0.08 + 0.1 * Math.max(0, Math.sin(TAU * 0.2 * t)) + Math.abs(jitter()),
    };
  };
}

/** Feeds a 60 fps trace through the client's real ChangeSender and the real SDK encoder. */
function simulate(kind, seconds = 120) {
  const face = traceFor(kind);
  const sender = new ChangeSender(NET.FACE_HZ, faceChanged, copyFace, FACE_KEEPALIVE_MS);
  let messages = 0;
  let payload = 0;
  let wire = 0;
  let relayPayload = 0;
  let relayWire = 0;
  let maxFrame = 0;
  for (let frame = 0; frame < seconds * 60; frame++) {
    const now = (frame * 1000) / 60;
    const value = face(now / 1000);
    if (!sender.offer(now, value)) continue;
    const bytes = clientFrameBytes(value);
    const relay = relayFrameBytes(value);
    messages++;
    payload += bytes;
    wire += wireClient(bytes);
    relayPayload += relay;
    relayWire += wireServer(relay);
    maxFrame = Math.max(maxFrame, bytes);
  }
  return {
    scenario: kind,
    seconds,
    messagesPerSecond: messages / seconds,
    payloadBytesPerSecond: payload / seconds,
    wireBytesPerSecond: wire / seconds,
    relayPayloadBytesPerSecondPerViewer: relayPayload / seconds,
    relayWireBytesPerSecondPerViewer: relayWire / seconds,
    maxFrameBytes: maxFrame,
  };
}

/* ---- Run ---- */

const sample = traceFor("animated")(12.34);
const clientBytes = clientFrameBytes(sample);
const relayBytes = relayFrameBytes(sample);
const offBytes = clientFrameBytes(null);
const worst = {
  messagesPerSecond: NET.FACE_HZ,
  payloadBytesPerSecond: clientBytes * NET.FACE_HZ,
  wireBytesPerSecond: wireClient(clientBytes) * NET.FACE_HZ,
};
const VIDEO = [
  { label: "Zoom 1:1 'high quality' video", bitsPerSecond: 600_000 },
  { label: "Zoom 1:1 720p HD video", bitsPerSecond: 1_200_000 },
];
const scenarios = ["still", "reading", "animated"].map((k) => {
  const s = simulate(k);
  return { ...s, times720pVideoWire: VIDEO[1].bitsPerSecond / (s.wireBytesPerSecond * 8) };
});
const kbps = (bytesPerSecond) => (bytesPerSecond * 8) / 1000;
const POMODORO_S = 25 * 60;

const result = {
  measuredAt: new Date().toISOString(),
  rules: {
    faceHz: NET.FACE_HZ,
    faceEpsilon: FACE_EPSILON,
    keepAliveMs: FACE_KEEPALIVE_MS,
    values: Object.keys(sample).length,
  },
  frame: {
    clientBytes,
    clientWireBytesEstimate: wireClient(clientBytes),
    relayBytesPerViewer: relayBytes,
    trackingOffBytes: offBytes,
  },
  worstCase: {
    ...worst,
    kbpsPayload: kbps(worst.payloadBytesPerSecond),
    kbpsWire: kbps(worst.wireBytesPerSecond),
  },
  scenarios,
  video: VIDEO.map((v) => ({
    ...v,
    timesWorstCaseWire: v.bitsPerSecond / (worst.wireBytesPerSecond * 8),
    timesWorstCasePayload: v.bitsPerSecond / (worst.payloadBytesPerSecond * 8),
  })),
  perPomodoroWorstCaseKB: (worst.payloadBytesPerSecond * POMODORO_S) / 1000,
  perPomodoro720pVideoMB: ((VIDEO[1].bitsPerSecond / 8) * POMODORO_S) / 1e6,
};

if (JSON_OUT) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const f1 = (n) => n.toFixed(1);
  console.log("Face tracking network cost (one student, browser -> game server)\n");
  console.log(
    `What is sent: ${result.rules.values} numbers (FacialParams), at most ${NET.FACE_HZ}/s, only when one moved by more than ${FACE_EPSILON}, plus a keep-alive every ${FACE_KEEPALIVE_MS} ms. Never video, never landmarks.\n`,
  );
  console.log(`One "face" message, built by @colyseus/sdk Room.send: ${clientBytes} bytes`);
  console.log(
    `  estimated on the wire (WebSocket + TLS 1.3 + TCP/IPv4): ${wireClient(clientBytes)} bytes`,
  );
  console.log(`Relay to each other player (server encoder): ${relayBytes} bytes`);
  console.log(`Turning tracking off: one ${offBytes}-byte message\n`);
  console.log(
    "Scenario      msgs/s   payload kbit/s   wire kbit/s (est.)   relay kbit/s per viewer   720p video is",
  );
  for (const s of scenarios)
    console.log(
      `${s.scenario.padEnd(12)}  ${f1(s.messagesPerSecond).padStart(6)}   ${f1(kbps(s.payloadBytesPerSecond)).padStart(14)}   ${f1(kbps(s.wireBytesPerSecond)).padStart(18)}   ${f1(kbps(s.relayWireBytesPerSecondPerViewer)).padStart(23)}   ${`${Math.round(s.times720pVideoWire)}x`.padStart(13)}`,
    );
  console.log(
    `worst case    ${f1(worst.messagesPerSecond).padStart(6)}   ${f1(result.worstCase.kbpsPayload).padStart(14)}   ${f1(result.worstCase.kbpsWire).padStart(18)}   ${"".padStart(23)}   ${`${Math.round(result.video[1].timesWorstCaseWire)}x`.padStart(13)}`,
  );
  console.log(
    "\nCompared with sending webcam video instead (assumption: Zoom's published 1:1 bitrates):",
  );
  for (const v of result.video)
    console.log(
      `  ${v.label}, ${v.bitsPerSecond / 1000} kbit/s: ${Math.round(v.timesWorstCaseWire)}x the worst-case face stream on the wire (${Math.round(v.timesWorstCasePayload)}x by payload)`,
    );
  console.log(
    `\nA whole 25-minute pomodoro at the worst case: ${Math.round(result.perPomodoroWorstCaseKB)} KB of face numbers, vs about ${Math.round(result.perPomodoro720pVideoMB)} MB of 720p video.`,
  );
}
