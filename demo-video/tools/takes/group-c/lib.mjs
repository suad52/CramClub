import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
// Scratch output (screenshots, report.json) goes under the tools' work dir.
export const HERE = path.join(T.WORK_DIR, "takes", "group-c");
mkdirSync(HERE, { recursive: true });
export const ENCODER = "/Users/suad/Documents/GitHub/OVR/demo-video/tools/bin/encode";
export const CLIPS = "/Users/suad/Documents/GitHub/OVR/demo-video/clips";
export const FRAMES = "/Users/suad/Documents/GitHub/OVR/demo-video/frames";
export const T0 = Date.now();
export const log = (m) =>
  console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}] ${m}`);

/** Silences the browser voice fallback (macOS system TTS is not covered by --mute-audio). */
export const SILENT_TTS = `(() => { if (window.__silentTTS || !window.speechSynthesis) return; window.__silentTTS = true; const s = window.speechSynthesis; const orig = s.speak.bind(s); s.speak = (u) => { try { u.volume = 0; } catch (e) {} return orig(u); }; })();`;
export async function silenceTTS(page) {
  await page.send("Page.addScriptToEvaluateOnNewDocument", { source: SILENT_TTS });
  await page.evaluate(SILENT_TTS + " true");
}

// TAKE_CHROME=demo drives group B's demo Chrome (:9557) instead of "c" (:9558): the review-pass
// re-shoots of 10 and 11 ran there, so the Learning Studio holds the lesson clip 09 played and no
// extra production learner was made on the new cramclub.study origin.
export async function connect() {
  const demo = process.env.TAKE_CHROME === "demo";
  const browser = await T.launchChrome(demo ? "demo" : "c", {
    port: demo ? 9557 : 9558,
    width: 1920,
    height: 1080,
  });
  const page = await browser.page();
  await silenceTTS(page);
  return { browser, page };
}

/** A recorded clip with timed beats (raw frames kept; encode() later). */
export async function clip(page, name, { dry = false } = {}) {
  const beats = [];
  if (dry) {
    const t0 = Date.now();
    let n = 0;
    return {
      name,
      beats,
      get elapsed() {
        return (Date.now() - t0) / 1000;
      },
      async beat(text, snap = true) {
        const t = +((Date.now() - t0) / 1000).toFixed(2);
        beats.push([t, text]);
        log(`${name} ${t.toFixed(2)}s  ${text}`);
        if (snap)
          await page
            .screenshot(path.join(HERE, "dry", `${name}-${String(++n).padStart(2, "0")}.png`))
            .catch(() => {});
      },
      async pause() {},
      async resume() {},
      async stop() {
        return { name, beats, seconds: (Date.now() - t0) / 1000 };
      },
    };
  }
  const rec = await T.startRecording(page, name);
  return {
    name,
    beats,
    rec,
    get elapsed() {
      return rec.elapsed;
    },
    async beat(text) {
      const t = +rec.elapsed.toFixed(2);
      beats.push([t, text]);
      log(`${name} ${t.toFixed(2)}s  ${text}`);
    },
    pause: () => rec.pause(),
    resume: () => rec.resume(),
    async stop() {
      const info = await rec.stop({ encode: false });
      log(`${name} stopped: ${JSON.stringify(info)}`);
      return { name, beats, info };
    },
  };
}

export function encode(result, { keepRaw = false } = {}) {
  const { info, name } = result;
  const out = path.join(CLIPS, `${name}.mp4`);
  const res = execFileSync(
    ENCODER,
    ["encode", info.rawDir, out, "--fps", "30", "--bitrate", "16000000"],
    { encoding: "utf8", maxBuffer: 1 << 20 },
  );
  const enc = JSON.parse(res.trim().split("\n").pop());
  if (!keepRaw) rmSync(info.rawDir, { recursive: true, force: true });
  const p = T.probe(out);
  return { out, enc, probe: p };
}

export function saveReport(key, data) {
  const f = path.join(HERE, "report.json");
  const all = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  all[key] = data;
  writeFileSync(f, JSON.stringify(all, null, 1));
}

/** Holds Shift (frees the cursor), clicks a target, releases Shift (re-locks). */
export async function shiftClick(page, target, opts = {}) {
  await page.keyDown("Shift");
  await T.sleep(350);
  const box = await page.click(target, opts);
  await T.sleep(250);
  await page.keyUp("Shift");
  return box;
}

export async function waitLocked(page, ms = 3000) {
  try {
    await page.waitFor("!!document.pointerLockElement", { timeout: ms, message: "pointer lock" });
    return true;
  } catch {
    return false;
  }
}
