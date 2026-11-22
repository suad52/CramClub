// Records a page to an MP4 clip: Page.startScreencast JPEG frames with their browser timestamps
// -> raw frame folder + manifest.json -> bin/encode (Swift/AVFoundation) -> constant-30-fps H.264.
//
//   const rec = await startRecording(page, "03-walk-in");    // frames start flowing
//   ... drive the page ...
//   const info = await rec.stop();    // encodes clips/03-walk-in.mp4, deletes raw frames
//   console.log(info);                // { file, seconds, captured, captureFps, encoded, ... }
//
// Or: await recordClip(page, "00-title", async () => { ...actions... }).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORK_DIR } from "./launch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const CLIPS_DIR = path.resolve(HERE, "..", "clips");
export const FRAMES_DIR = path.resolve(HERE, "..", "frames");
export const ENCODER = path.join(HERE, "bin", "encode");

/** Builds bin/encode from encode.swift if it is missing or older than the source. */
export function ensureEncoder() {
  if (existsSync(ENCODER)) return ENCODER;
  mkdirSync(path.dirname(ENCODER), { recursive: true });
  execFileSync("/usr/bin/swiftc", ["-O", path.join(HERE, "encode.swift"), "-o", ENCODER], {
    stdio: "inherit",
  });
  return ENCODER;
}

/**
 * Starts capturing `page`. Options:
 *   quality   JPEG quality (default 90)
 *   out       output mp4 path (default clips/<name>.mp4)
 *   keepRaw   keep the raw JPEG folder after encoding (default false)
 *   fps       output frame rate (default 30)
 */
export async function startRecording(
  page,
  name,
  { quality = 90, out, keepRaw = false, fps = 30, bitrate = 16_000_000 } = {},
) {
  ensureEncoder();
  const rawDir = path.join(WORK_DIR, "raw", `${name}-${Date.now()}`);
  mkdirSync(rawDir, { recursive: true });
  out ??= path.join(CLIPS_DIR, `${name}.mp4`);
  mkdirSync(path.dirname(out), { recursive: true });

  const frames = [];
  const writes = [];
  let n = 0;
  let stopped = false;
  let paused = false;
  let pausedAt = 0;
  let offset = 0; // seconds spent paused so far
  const startWall = Date.now() / 1000;
  const off = page.on("Page.screencastFrame", (f) => {
    // Ack first so Chrome sends the next frame while we write this one.
    page.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
    if (stopped || paused) return;
    const ts = f.metadata?.timestamp ?? Date.now() / 1000;
    const file = String(++n).padStart(6, "0") + ".jpg";
    frames.push([file, ts - offset]);
    writes.push(writeFile(path.join(rawDir, file), Buffer.from(f.data, "base64")));
  });
  const cast = () =>
    page.send("Page.startScreencast", {
      format: "jpeg",
      quality,
      maxWidth: 1920,
      maxHeight: 1080,
      everyNthFrame: 1,
    });
  await cast();

  return {
    name,
    rawDir,
    out,
    get frameCount() {
      return frames.length;
    },
    /** Seconds of video recorded so far (excluding pauses). */
    get elapsed() {
      return (paused ? pausedAt : Date.now() / 1000) - startWall - offset;
    },
    /** Stops capturing until resume(): the clip cuts straight from the last frame to the next. */
    async pause() {
      if (paused) return;
      paused = true;
      pausedAt = Date.now() / 1000;
      await page.send("Page.stopScreencast").catch(() => {});
    },
    async resume() {
      if (!paused) return;
      offset += Date.now() / 1000 - pausedAt;
      paused = false;
      await cast();
    },
    /** Stops capturing, encodes the MP4 and returns stats. */
    async stop({ encode = true } = {}) {
      const stopWall = paused ? pausedAt : Date.now() / 1000;
      stopped = true;
      await page.send("Page.stopScreencast").catch(() => {});
      off();
      await Promise.all(writes);
      const duration = stopWall - startWall - offset;
      // Browser timestamps -> seconds from the clip start. They share the system clock with
      // Date.now(); if a frame claims to be earlier than the start it's clamped to 0.
      const rel = frames
        .map(([f, ts]) => [f, Math.max(0, +(ts - startWall).toFixed(4))])
        .filter(([, t]) => t <= duration + 0.05);
      writeFileSync(
        path.join(rawDir, "manifest.json"),
        JSON.stringify({ duration, startWall, frames: rel }),
      );
      const span = rel.length > 1 ? rel[rel.length - 1][1] - rel[0][1] : 0;
      const gaps = rel.slice(1).map((f, i) => f[1] - rel[i][1]);
      const maxGap = gaps.length ? Math.max(...gaps) : 0;
      const info = {
        file: out,
        seconds: +duration.toFixed(2),
        captured: rel.length,
        captureFps: span > 0 ? +((rel.length - 1) / span).toFixed(1) : 0,
        maxGapMs: Math.round(maxGap * 1000),
        firstFrameDelayMs: rel.length ? Math.round(rel[0][1] * 1000) : null,
      };
      if (!encode) return { ...info, rawDir };
      const res = execFileSync(
        ENCODER,
        ["encode", rawDir, out, "--fps", String(fps), "--bitrate", String(bitrate)],
        {
          encoding: "utf8",
          maxBuffer: 1 << 20,
        },
      );
      Object.assign(info, { encoded: JSON.parse(res.trim().split("\n").pop()) });
      if (!keepRaw) rmSync(rawDir, { recursive: true, force: true });
      else info.rawDir = rawDir;
      return info;
    },
  };
}

/** Records `name` while `fn()` runs (with optional lead-in / tail holds in ms). */
export async function recordClip(page, name, fn, { lead = 0, tail = 0, ...opts } = {}) {
  const rec = await startRecording(page, name, opts);
  try {
    if (lead) await new Promise((r) => setTimeout(r, lead));
    await fn(rec);
    if (tail) await new Promise((r) => setTimeout(r, tail));
  } catch (e) {
    const info = await rec.stop({ encode: true }).catch(() => null);
    e.message += ` (partial clip: ${info?.file ?? "none"})`;
    throw e;
  }
  return rec.stop();
}

/** Duration / fps / frame count / size / codec of an MP4 (AVFoundation). */
export function probe(file) {
  ensureEncoder();
  return JSON.parse(execFileSync(ENCODER, ["probe", file], { encoding: "utf8" }).trim());
}

/** Saves PNG frames at the given seconds: <prefix>-<t>s.png. Returns the paths. */
export function extractFrames(file, prefix, times) {
  ensureEncoder();
  mkdirSync(path.dirname(prefix), { recursive: true });
  const out = execFileSync(ENCODER, ["frames", file, prefix, times.join(",")], {
    encoding: "utf8",
  });
  return out
    .trim()
    .split("\n")
    .map((l) => l.split(" (")[0]);
}
