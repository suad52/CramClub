#!/usr/bin/env node
/**
 * End-to-end check of the "Before you go in" camera and microphone step
 * (apps/web/components/entry/DeviceSetup.tsx) in a real browser, with FAKE devices only.
 *
 *   node scripts/e2e/device-setup.mjs [--web http://localhost:3100] [--chrome <path>]
 *                                     [--size 1280x800] [--shots <dir>] [--only a,b,c]
 *
 * Needs the web dev server already running on --web (`pnpm dev:web`) and Google Chrome. No new
 * dependencies: it drives Chrome over the DevTools protocol with Node's own WebSocket (Node 22+).
 *
 * What it does:
 *   - Starts its own headless Chrome with a fresh, throwaway profile and Chrome's fake camera and
 *     microphone (--use-fake-device-for-media-stream: a test pattern and a beep). The real camera
 *     and microphone are never touched. Permission prompts are auto-accepted
 *     (--use-fake-ui-for-media-stream), except in the "denied" browser, where the site's camera
 *     and microphone are blocked with Browser.setPermission instead.
 *   - Blocks every request that could create or change a learner, so nothing is written
 *     anywhere: all of {web}/api/* (the ticket, /api/learning/profile, tables, the librarian…),
 *     the game server's socket (:2567, so the library room is never joined) and ElevenLabs.
 *   - Seeds a saved character in localStorage (lib/avatar/profile.ts keeps it there), so the
 *     title screen offers "Enter the Library", and wraps getUserMedia and AudioContext before the
 *     page loads to count every camera and microphone stream and audio context it opens.
 *   - Leaves Chrome's GPU on (headless Chrome on a Mac draws with Metal): in software (SwiftShader)
 *     the face tracker and the 3D library starve the page, and every step takes minutes.
 *
 * Scenarios (PASS/FAIL each; the exit code is 1 if any fails):
 *   a  Enter on the title opens the step: dialog up, no HUD, no pointer lock, not in the world.
 *   b  "Turn camera on": the mirrored preview plays a live camera track.
 *   c  "Test microphone": the level meter rises and says "Sounds good" (the fake beep); "Stop"
 *      leaves no live microphone track and no open audio context.
 *   d  "Go in" (the Enter key) with the camera on, mid microphone test: the HUD's Chat button
 *      appears, the camera stream is still live, it wasn't opened a second time, no microphone is
 *      left live, and localStorage "ovr.devices" says camera "on".
 *   h  In the world: Esc opens the menu, "Camera and microphone" opens both panels with Done;
 *      Done goes back to the menu.
 *   e  Reload, Enter: the camera starts by itself (saved "on"), and the Enter key goes in.
 *   f  Reload, Enter, "Turn off", "Keep it off", "Go in": no live camera track, camera "off".
 *   i  /demo: the step appears by itself; after "Go in" the demo still seats you at a table.
 *   g  A browser that blocks the camera and microphone: the help line ("Click the camera icon in
 *      the address bar…") and "Try again" show for both, and "Go in" still works.
 *   x  No console errors (Next's dev overlay counts them as "Issues") while the camera runs.
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const WEB = String(arg("web", "http://localhost:3100")).replace(/\/+$/, "");
const CHROME = arg(
  "chrome",
  process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
);
const [W, H] = String(arg("size", "1280x800")).split("x").map(Number);
const SHOTS = arg("shots", null);
const ONLY = arg("only", null)?.split(",");
const wants = (id) => !ONLY || ONLY.includes(id);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

if (typeof WebSocket !== "function") {
  console.error("Needs Node 22 or newer (for its built-in WebSocket).");
  process.exit(2);
}
try {
  await fetch(WEB, { method: "HEAD" });
} catch {
  console.error(`The web app isn't running on ${WEB} (start it with \`pnpm dev:web\`).`);
  process.exit(2);
}

/* ---- Results ---- */

const results = [];
function report(id, name, pass, detail) {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${id}  ${name}${detail ? `  (${detail})` : ""}`);
}

/* ---- A headless Chrome, driven over the DevTools protocol ---- */

async function freePort() {
  return new Promise((resolve) => {
    const s = createServer().listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** Everything that could create or change a learner, or join the library room. */
const BLOCKED = [
  `${WEB}/api/*`,
  "*://localhost:2567/*",
  "*://127.0.0.1:2567/*",
  "ws://localhost:2567*",
  "ws://127.0.0.1:2567*",
  "*elevenlabs*",
];

/** Runs before any page script: a saved character, and a record of every stream and context. */
const INIT = `(() => {
  try {
    if (!localStorage.getItem("ovr.profile"))
      localStorage.setItem("ovr.profile", JSON.stringify({ state: { displayName: "E2E Tester", savedAt: 1700000000000 }, version: 3 }));
    if (!localStorage.getItem("ovr.preferences"))
      localStorage.setItem("ovr.preferences", JSON.stringify({ state: { guideSeen: true }, version: 1 }));
  } catch {}
  const rec = (window.__e2e = { gum: [], contexts: [] });
  const md = navigator.mediaDevices;
  if (md && md.getUserMedia) {
    const gum = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => {
      const r = { video: !!(c && c.video), audio: !!(c && c.audio), stream: null, error: null };
      rec.gum.push(r);
      try { r.stream = await gum(c); return r.stream; } catch (e) { r.error = e && e.name; throw e; }
    };
  }
  const AC = window.AudioContext;
  if (AC) window.AudioContext = class extends AC {
    constructor(...a) { super(...a); rec.contexts.push(this); }
  };
})();`;

async function launch({ fakeUi }) {
  const profile = mkdtempSync(join(tmpdir(), "ovr-e2e-devices-"));
  const port = await freePort();
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${W},${H}`,
      "--ignore-gpu-blocklist",
      "--mute-audio",
      "--use-fake-device-for-media-stream",
      ...(fakeUi ? ["--use-fake-ui-for-media-stream"] : []),
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let version = null;
  for (let i = 0; i < 75 && !version; i++) {
    await sleep(200);
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    } catch {
      // Not up yet.
    }
  }
  if (!version) throw new Error(`Chrome didn't start (${CHROME})`);
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  let nextId = 0;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (event) => {
    const m = JSON.parse(String(event.data));
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
      else p.resolve(m.result);
    } else if (m.method) for (const fn of listeners) fn(m);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject, method });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error(`timeout: ${method}`));
      }, 60_000);
    });
  const { targetInfos } = await send("Target.getTargets");
  const target = targetInfos.find((t) => t.type === "page");
  const { sessionId } = await send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  });
  const page = (method, params) => send(method, params, sessionId);
  // Chrome itself sometimes opens a page of its own in a fresh profile (chrome://settings/help),
  // which hides this one and stops its rendering: close it and come back to the front.
  listeners.push((m) => {
    const info = m.method === "Target.targetCreated" ? m.params.targetInfo : null;
    if (!info || info.type !== "page" || info.targetId === target.targetId) return;
    void send("Target.closeTarget", { targetId: info.targetId })
      .then(() => page("Page.bringToFront"))
      .catch(() => {});
  });
  await send("Target.setDiscoverTargets", { discover: true });

  // Console errors and uncaught exceptions (blocked requests are expected, and skipped).
  const errors = [];
  const inflight = new Map();
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Network.requestWillBeSent")
      inflight.set(m.params.requestId, m.params.request.url);
    else if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed")
      inflight.delete(m.params.requestId);
  });
  // A "Leave site?" or other dialog would stall a navigation: accept it.
  listeners.push((m) => {
    if (m.sessionId === sessionId && m.method === "Page.javascriptDialogOpening")
      void page("Page.handleJavaScriptDialog", { accept: true }).catch(() => {});
  });
  listeners.push((m) => {
    if (m.sessionId !== sessionId) return;
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") {
      const text = m.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      errors.push(text.slice(0, 300));
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails;
      errors.push(`exception: ${(d.exception?.description ?? d.text ?? "").slice(0, 300)}`);
    }
  });

  await page("Network.enable");
  await page("Network.setBlockedURLs", { urls: BLOCKED });
  await page("Page.enable");
  await page("Runtime.enable");
  await page("Emulation.setDeviceMetricsOverride", {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page("Page.addScriptToEvaluateOnNewDocument", { source: INIT });

  async function ev(expression) {
    const r = await page("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }
  async function waitFor(expression, ms = 15_000, every = 250) {
    const end = Date.now() + ms;
    for (;;) {
      let v;
      try {
        v = await ev(expression);
      } catch {
        v = null;
      }
      if (v) return v;
      if (Date.now() > end) return v;
      await sleep(every);
    }
  }
  async function key(name, code, vk) {
    for (const type of ["keyDown", "keyUp"])
      await page("Input.dispatchKeyEvent", {
        type,
        key: name,
        code,
        windowsVirtualKeyCode: vk,
        nativeVirtualKeyCode: vk,
      });
  }
  const enter = () => key("Enter", "Enter", 13);
  const escape = () => key("Escape", "Escape", 27);
  /** A real mouse click (a user gesture) on the visible button whose text starts with `text`. */
  async function click(text, within = "body") {
    const at = await ev(`(() => {
      const root = document.querySelector(${JSON.stringify(within)});
      const el = root && [...root.querySelectorAll("button")].find(
        (b) => b.textContent.trim().startsWith(${JSON.stringify(text)}) && b.getClientRects().length && !b.disabled);
      if (!el) return null;
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    })()`);
    if (!at) throw new Error(`no "${text}" button`);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
      await page("Input.dispatchMouseEvent", {
        type,
        x: at[0],
        y: at[1],
        button: "left",
        clickCount: type === "mouseMoved" ? 0 : 1,
      });
  }
  async function shot(name) {
    if (!SHOTS) return;
    const r = await page("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.data, "base64"));
  }
  async function open(path) {
    await page("Page.bringToFront");
    await page("Page.navigate", { url: `${WEB}${path}` });
    const ok = await waitFor(`!!window.__ovr?.store?.getState().ready`, 90_000, 500);
    if (!ok) {
      const seen = await ev(
        `(async () => JSON.stringify({ href: location.href, vis: document.visibilityState, focus: document.hasFocus(), raf: await Promise.race([new Promise((r) => requestAnimationFrame(() => r(true))), new Promise((r) => setTimeout(() => r(false), 1000))]), three: !!window.__ovr?.three, canvas: document.querySelectorAll("canvas").length, phase: window.__ovr?.store?.getState().phase, text: document.body?.innerText.slice(0, 60) }))()`,
      ).catch((e) => String(e));
      const tabs = (await send("Target.getTargets")).targetInfos.map((t) => `${t.type}:${t.url}`);
      throw new Error(
        `${path}: the library never got ready ${seen} tabs=${tabs.join(",")} errors: ${errors.slice(-5).join(" || ")} pending: ${[...inflight.values()].slice(0, 12).join(" ")}`,
      );
    }
    await sleep(800);
  }
  async function close() {
    try {
      ws.close();
    } catch {
      // Already closed.
    }
    chrome.kill("SIGTERM");
    await sleep(600);
    rmSync(profile, { recursive: true, force: true });
  }
  return { page, ev, waitFor, enter, escape, click, shot, open, close, errors, send };
}

/* ---- Page probes ---- */

const STATE = `(() => {
  const g = window.__e2e.gum;
  const live = (kind) => g.flatMap((r) => (r.stream ? r.stream.getTracks() : []))
    .filter((t) => t.kind === kind && t.readyState === "live").length;
  const s = __ovr.store.getState();
  const dialog = document.querySelector('[aria-labelledby="setup-title"]');
  return {
    phase: s.phase,
    seatId: s.seatId,
    menuOpen: s.menuOpen,
    devicesOpen: s.devicesOpen,
    camera: __ovr.tracking.store.getState().status,
    videoCalls: g.filter((r) => r.video).length,
    audioCalls: g.filter((r) => r.audio).length,
    liveVideo: live("video"),
    liveAudio: live("audio"),
    openContexts: window.__e2e.contexts.filter((c) => c.state !== "closed").length,
    setup: !!dialog && dialog.getClientRects().length > 0,
    hud: !!document.querySelector('button[title="Menu (Esc)"]'),
    chat: !!document.querySelector('button[aria-keyshortcuts="Enter"][title^="Chat"]'),
    pointerLock: !!document.pointerLockElement,
    prefs: JSON.parse(localStorage.getItem("ovr.devices") || "null")?.state ?? null,
  };
})()`;

const PREVIEW = `(() => {
  const v = document.querySelector('[aria-labelledby="setup-title"] video, [aria-labelledby="devices-title"] video');
  if (!v || !v.srcObject) return null;
  const t = v.srcObject.getVideoTracks()[0];
  return { live: t?.readyState === "live", playing: !v.paused && v.readyState >= 2, w: v.videoWidth,
    mirrored: [getComputedStyle(v).transform, getComputedStyle(v).scale].some((x) => x && x !== "none") };
})()`;

const METER = `Number(document.querySelector('[role="meter"][aria-label="Microphone level"]')?.getAttribute("aria-valuenow") ?? -1)`;
const LIVE_TEXT = `[...document.querySelectorAll("[aria-live]")].map((e) => e.textContent.trim()).filter(Boolean).join(" | ")`;

/** The small "Your avatar" face view the HUD draws in the corner while tracking. */
const FACE_VIEW = `[...document.querySelectorAll("span")].some((e) => e.textContent === "Your avatar")`;

/** Fits the window: nothing scrolls, and the footer sits inside it. */
const FIT = `(() => {
  const d = document.querySelector('[aria-labelledby="setup-title"]');
  if (!d) return null;
  const f = d.querySelector("footer")?.getBoundingClientRect();
  const cards = [...d.querySelectorAll("section")].map((s) => s.getBoundingClientRect());
  return { scrolls: d.scrollHeight > d.clientHeight + 1 || document.documentElement.scrollWidth > innerWidth,
    footerInside: !!f && f.bottom <= innerHeight, cardsAboveFooter: !!f && cards.every((c) => c.bottom <= f.top) };
})()`;

async function playingWithin(b, ms) {
  return b.waitFor(`__ovr.store.getState().phase === "playing"`, ms, 500);
}

/* ---- The scenarios ---- */

async function mainBrowser() {
  const b = await launch({ fakeUi: true });
  try {
    await b.open("/");
    let s = await b.ev(STATE);
    if (s.phase !== "title") throw new Error(`expected the title screen, got ${s.phase}`);

    // a
    await b.enter();
    await b.waitFor(
      `__ovr.store.getState().phase === "setup" && !!document.querySelector('[aria-labelledby="setup-title"]')`,
    );
    await sleep(700);
    s = await b.ev(STATE);
    const fit = await b.ev(FIT);
    report(
      "a",
      "Enter on the title opens the setup step (no HUD, no pointer lock)",
      s.phase === "setup" && s.setup && !s.hud && !s.pointerLock && s.liveVideo === 0,
      `phase=${s.phase} dialog=${s.setup} hud=${s.hud} lock=${s.pointerLock} fit=${JSON.stringify(fit)}`,
    );
    report(
      "a2",
      `Fits ${W}x${H} with no scroll`,
      !!fit && !fit.scrolls && fit.footerInside && fit.cardsAboveFooter,
      JSON.stringify(fit),
    );
    await b.shot("1-setup-idle");

    // b
    await b.click("Turn camera on");
    const preview = await b.waitFor(
      `(() => { const p = ${PREVIEW}; return p && p.live && p.playing && p.w > 0 ? p : null; })()`,
      20_000,
    );
    s = await b.ev(STATE);
    await sleep(1500);
    const faceDuringSetup = await b.ev(FACE_VIEW);
    report(
      "b2",
      "No avatar face view behind the setup step",
      !faceDuringSetup,
      `faceView=${faceDuringSetup}`,
    );
    report(
      "b",
      "Turn camera on: mirrored live preview",
      !!preview && preview.mirrored && s.liveVideo === 1 && s.videoCalls === 1,
      `preview=${JSON.stringify(preview)} liveVideo=${s.liveVideo} calls=${s.videoCalls}`,
    );

    // c
    await b.click("Test microphone");
    // The test listens for 10 s at most: watch the bars until it says "Sounds good".
    let peak = 0;
    let heard = false;
    const until = Date.now() + 9000;
    while (Date.now() < until && !heard) {
      peak = Math.max(peak, await b.ev(METER));
      heard = peak > 0 && (await b.ev(LIVE_TEXT)).includes("Sounds good");
      if (!heard) await sleep(100);
    }
    await b.shot("2-camera-and-mic");
    const stillListening = await b.ev(
      `[...document.querySelectorAll("#check-mic-title ~ * button, section button")].some((e) => e.textContent.trim() === "Stop")`,
    );
    if (stillListening) await b.click("Stop");
    await sleep(400);
    s = await b.ev(STATE);
    report(
      "c",
      "Mic test: the meter rises on the fake beep, then Stop releases the mic",
      peak > 0 && heard && s.liveAudio === 0 && s.openContexts === 0 && s.prefs?.mic === "ok",
      `peakBars=${peak} soundsGood=${heard} liveAudio=${s.liveAudio} openAudioContexts=${s.openContexts} mic=${s.prefs?.mic}`,
    );

    // x (camera running on the setup step)
    await b.waitFor(`__ovr.tracking.store.getState().status !== "starting"`, 20_000);
    await sleep(1500);
    const camErrors = [...b.errors];

    // d: a second test running, then the Enter key (nothing focused) goes in.
    await b.click("Test again");
    await b.waitFor(`window.__e2e.gum.filter((r) => r.audio).length === 2`, 5000);
    await sleep(500);
    await b.ev(`document.activeElement?.blur()`);
    await b.enter();
    await sleep(300);
    const right = await b.ev(STATE);
    const played = await playingWithin(b, 90_000);
    await b.waitFor(`!!document.querySelector('button[title^="Chat"]')`, 10_000);
    s = await b.ev(STATE);
    report(
      "d",
      "Go in with the camera on: in the world, same camera still live, mic released",
      right.phase === "entering" &&
        right.liveAudio === 0 &&
        right.openContexts === 0 &&
        !!played &&
        s.chat &&
        s.liveVideo === 1 &&
        s.videoCalls === 1 &&
        s.liveAudio === 0 &&
        s.prefs?.camera === "on" &&
        typeof s.prefs?.setupDoneAt === "number",
      `afterEnter=${right.phase} chat=${s.chat} liveVideo=${s.liveVideo} videoCalls=${s.videoCalls} liveAudio=${right.liveAudio}/${s.liveAudio} contexts=${right.openContexts} prefs=${JSON.stringify(s.prefs)}`,
    );
    const faceView = await b.ev(FACE_VIEW);
    report("d2", "The avatar face view shows once in the world", faceView, `faceView=${faceView}`);

    // h
    if (wants("h")) {
      await b.ev(`__ovr.store.getState().setGuideOpen(false)`);
      await b.ev(`document.activeElement?.blur()`);
      await b.escape();
      const menu = await b.waitFor(`__ovr.store.getState().menuOpen`, 5000);
      await sleep(500);
      await b.click("Camera and microphone");
      const panels = await b.waitFor(
        `(() => { const d = document.querySelector('[aria-labelledby="devices-title"]'); if (!d) return null;
          const t = d.textContent; return t.includes("Camera") && t.includes("Microphone") && [...d.querySelectorAll("button")].some((b) => b.textContent.trim().startsWith("Done")); })()`,
        5000,
      );
      await sleep(600);
      await b.shot("3-world-overlay");
      const faceUnderOverlay = await b.ev(FACE_VIEW);
      await b.click("Done");
      await sleep(500);
      s = await b.ev(STATE);
      report(
        "h",
        "In the world: Esc, menu, Camera and microphone, Done",
        !!menu &&
          !!panels &&
          !s.devicesOpen &&
          s.menuOpen &&
          s.liveVideo === 1 &&
          !faceUnderOverlay,
        `menu=${!!menu} panels=${!!panels} afterDone devicesOpen=${s.devicesOpen} menuOpen=${s.menuOpen} faceViewUnderOverlay=${faceUnderOverlay}`,
      );
    }

    // e
    await b.open("/");
    await b.enter();
    await b.waitFor(`__ovr.store.getState().phase === "setup"`);
    const auto = await b.waitFor(
      `(() => { const p = ${PREVIEW}; return p && p.live ? p : null; })()`,
      20_000,
    );
    s = await b.ev(STATE);
    const stillSetup = s.phase === "setup";
    await b.ev(`document.activeElement?.blur()`);
    await b.enter();
    const inE = await b.waitFor(
      `["entering", "playing"].includes(__ovr.store.getState().phase)`,
      5000,
    );
    report(
      "e",
      "Reload: the saved camera starts by itself, Enter goes in",
      !!auto && stillSetup && !!inE && s.videoCalls === 1,
      `autoStarted=${!!auto} stayedOnSetup=${stillSetup} wentIn=${!!inE} videoCalls=${s.videoCalls}`,
    );

    // f
    await b.open("/");
    await b.enter();
    await b.waitFor(`__ovr.store.getState().phase === "setup"`);
    await b.waitFor(`(() => { const p = ${PREVIEW}; return p && p.live; })()`, 20_000);
    await b.click("Turn off");
    await sleep(300);
    await b.click("Keep it off");
    await sleep(300);
    await b.click("Go in");
    await sleep(800);
    s = await b.ev(STATE);
    report(
      "f",
      "Keep it off, Go in: no live camera",
      ["entering", "playing"].includes(s.phase) && s.liveVideo === 0 && s.prefs?.camera === "off",
      `phase=${s.phase} liveVideo=${s.liveVideo} camera=${s.prefs?.camera}`,
    );

    // i
    if (wants("i")) {
      await b.page("Page.navigate", { url: `${WEB}/demo` });
      const onSetup = await b.waitFor(
        `window.__ovr?.store?.getState().phase === "setup" && !!document.querySelector('[aria-labelledby="setup-title"]')`,
        90_000,
        500,
      );
      await sleep(1500);
      await b.shot("4-demo-setup");
      const before = await b.ev(STATE);
      await b.click("Go in");
      await playingWithin(b, 90_000);
      const seated = await b.waitFor(`!!__ovr.store.getState().seatId`, 25_000, 500);
      s = await b.ev(STATE);
      report(
        "i",
        "/demo: the setup step shows, and after Go in the demo still seats you",
        !!onSetup && before.seatId === null && !!seated,
        `setupShown=${!!onSetup} phase=${s.phase} seat=${s.seatId}`,
      );
    }

    // x
    const issues = camErrors.filter(
      (e) => !/ERR_BLOCKED_BY_CLIENT|Failed to load resource/.test(e),
    );
    report(
      "x",
      "No console errors on the setup step with the camera on",
      issues.length === 0,
      issues.length ? issues.slice(0, 3).join(" || ") : "none",
    );
  } finally {
    await b.close();
  }
}

async function deniedBrowser() {
  const b = await launch({ fakeUi: false });
  try {
    const origin = new URL(WEB).origin;
    for (const name of ["camera", "microphone"])
      await b.send("Browser.setPermission", {
        permission: { name },
        setting: "denied",
        origin,
      });
    await b.open("/");
    await b.enter();
    await b.waitFor(`__ovr.store.getState().phase === "setup"`);
    await sleep(500);
    await b.click("Turn camera on");
    const camHelp = await b.waitFor(
      `(() => { const t = document.querySelector("#check-camera-title")?.closest("section")?.textContent ?? "";
        return t.includes("Click the camera icon in the address bar") && t.includes("Try again"); })()`,
      10_000,
    );
    await b.click("Test microphone");
    const micHelp = await b.waitFor(
      `(() => { const t = document.querySelector("#check-mic-title")?.closest("section")?.textContent ?? "";
        return t.includes("Click the microphone icon in the address bar") && t.includes("Try again"); })()`,
      10_000,
    );
    await b.shot("5-denied");
    await b.click("Go in");
    const inG = await b.waitFor(
      `["entering", "playing"].includes(__ovr.store.getState().phase)`,
      5000,
    );
    const s = await b.ev(STATE);
    report(
      "g",
      "Blocked camera and mic: help + Try again, Go in still works",
      !!camHelp && !!micHelp && !!inG && s.liveVideo === 0 && s.liveAudio === 0,
      `cameraHelp=${!!camHelp} micHelp=${!!micHelp} wentIn=${!!inG}`,
    );
  } finally {
    await b.close();
  }
}

const started = Date.now();
try {
  await mainBrowser();
} catch (err) {
  report("!", "main browser run", false, String(err?.message ?? err));
}
if (wants("g")) {
  try {
    await deniedBrowser();
  } catch (err) {
    report("g", "denied browser run", false, String(err?.message ?? err));
  }
}
const failed = results.filter((r) => !r.pass);
console.log(
  `\n${results.length - failed.length}/${results.length} passed in ${Math.round((Date.now() - started) / 1000)} s` +
    (SHOTS ? `; screenshots in ${SHOTS}` : ""),
);
process.exit(failed.length ? 1 : 0);
