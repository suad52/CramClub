"use client";

import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { getCameraStream } from "@/lib/facial-tracking/tracker";

/**
 * Drawing on the whiteboard with your finger: MediaPipe's hand tracker follows your index
 * fingertip in the webcam. Point with one finger (index out, middle finger folded) to draw;
 * open your hand or hold up two fingers to move without drawing. Everything runs in the
 * browser; no video leaves the device. The camera only starts when the student turns this on.
 */

const MODEL_URL =
  process.env.NEXT_PUBLIC_HAND_MODEL_URL ||
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";
const WASM_PATH = "/mediapipe/wasm";

/** The part of the camera picture that maps to the whole board (so you don't reach to the edges). */
const REACH = { x0: 0.18, x1: 0.82, y0: 0.15, y1: 0.75 };
/** Smoothing for the fingertip (0..1, higher follows faster). */
const FOLLOW = 0.45;

export interface FingerSample {
  /** Fingertip on the board, 0..1 from the left / top. */
  x: number;
  y: number;
  /** Pointing (index out, middle folded): the pen is on the board. */
  drawing: boolean;
}

type Pt = { x: number; y: number };
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Index finger out and middle finger folded: the "marker" pose. */
export function isPointing(hand: readonly Pt[]) {
  const [wrist, , , , , , indexPip, , indexTip, , middlePip, , middleTip] = hand;
  if (!wrist || !indexPip || !indexTip || !middlePip || !middleTip) return false;
  const indexOut = dist(indexTip, wrist) > dist(indexPip, wrist) * 1.15;
  const middleIn = dist(middleTip, wrist) < dist(middlePip, wrist) * 1.05;
  return indexOut && middleIn;
}

/** Camera fingertip (selfie view, so mirrored) → board position, clamped to the board. */
export function toBoard(tip: { x: number; y: number }) {
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return {
    x: clamp((1 - tip.x - REACH.x0) / (REACH.x1 - REACH.x0)),
    y: clamp((tip.y - REACH.y0) / (REACH.y1 - REACH.y0)),
  };
}

let landmarker: HandLandmarker | null = null;

async function createLandmarker() {
  const { HandLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO" as const,
    numHands: 1,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    return await HandLandmarker.createFromOptions(fileset, options("CPU"));
  }
}

/**
 * Starts following the student's hand; calls `onSample` every frame with a hand in view (and
 * `null` when the hand leaves). Reuses the face tracker's camera when it's already on. Returns a
 * stop function. Must be started from a user action (the browser asks for the camera).
 */
export async function startFingerPen(
  onSample: (s: FingerSample | null) => void,
): Promise<{ stop: () => void; video: HTMLVideoElement }> {
  const shared = getCameraStream();
  const stream =
    shared ??
    (await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
    }));
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  landmarker ??= await createLandmarker();
  let running = true;
  let frame = 0;
  let lastTime = -1;
  let smooth: { x: number; y: number } | null = null;
  const step = () => {
    if (!running) return;
    frame = requestAnimationFrame(step);
    if (video.readyState < 2 || video.currentTime === lastTime || !landmarker) return;
    lastTime = video.currentTime;
    const hand = landmarker.detectForVideo(video, performance.now()).landmarks[0];
    if (!hand?.[8]) {
      smooth = null;
      onSample(null);
      return;
    }
    const p = toBoard(hand[8]);
    smooth = smooth
      ? { x: smooth.x + (p.x - smooth.x) * FOLLOW, y: smooth.y + (p.y - smooth.y) * FOLLOW }
      : p;
    onSample({ ...smooth, drawing: isPointing(hand) });
  };
  frame = requestAnimationFrame(step);
  return {
    video,
    stop: () => {
      running = false;
      cancelAnimationFrame(frame);
      video.srcObject = null;
      // Leave the face tracker's camera running; only stop a camera this opened.
      if (!shared) for (const t of stream.getTracks()) t.stop();
    },
  };
}
