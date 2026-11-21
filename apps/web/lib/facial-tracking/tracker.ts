import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { FacialParams } from "@ovr/shared";
import { openMedia, useDevicePrefs } from "@/lib/devices/prefs";
import {
  FaceSmoother,
  type RawFace,
  averageFaces,
  extractRawFace,
  toFacialParams,
} from "./mapping";
import { withQuietInfo } from "./quietInfo";

/**
 * Optional, opt-in expression tracking. The webcam is opened only when the user asks, frames are
 * analysed on this device by MediaPipe Face Landmarker, and only eight smoothed numbers come out.
 * Nothing about the video leaves the browser. The camera is the one the student picked on the
 * "Before you go in" step (lib/devices/prefs.ts), or the browser's default.
 */

export type TrackingStatus = "off" | "starting" | "calibrating" | "tracking" | "no-face" | "error";

/**
 * Self-hosted copy of MediaPipe's face_landmarker.task (float16, v1), so no request leaves our
 * own site. NEXT_PUBLIC_FACE_MODEL_URL can point somewhere else (e.g. a CDN).
 */
const MODEL_URL = process.env.NEXT_PUBLIC_FACE_MODEL_URL || "/models/face_landmarker.task";
/** Copied from node_modules by scripts/copy-assets.mjs. */
const WASM_PATH = "/mediapipe/wasm";
/** About one second of frames to learn the user's resting face. */
const CALIBRATION_FRAMES = 30;
/** After this long without a face, the avatar drifts back to its normal idle animation. */
const LOST_FACE_SECONDS = 1.2;

interface TrackingStore {
  status: TrackingStatus;
  error: string | null;
  /** Calibration progress, 0 … 1. */
  calibration: number;
  /** Persisted preference: mirror the avatar like a mirror image. */
  mirror: boolean;
  /** Persisted preference: show the small "your avatar's face" view. */
  showFaceView: boolean;
  /** Persisted preference: turning your real head turns your in-game view too. */
  headLook: boolean;
  panelOpen: boolean;
  setMirror: (mirror: boolean) => void;
  setShowFaceView: (show: boolean) => void;
  setHeadLook: (on: boolean) => void;
  setPanelOpen: (open: boolean) => void;
}

export const useTrackingStore = create<TrackingStore>()(
  persist(
    (set) => ({
      status: "off",
      error: null,
      calibration: 0,
      mirror: false,
      showFaceView: true,
      headLook: true,
      panelOpen: false,
      setMirror: (mirror) => set({ mirror }),
      setShowFaceView: (showFaceView) => set({ showFaceView }),
      setHeadLook: (headLook) => set({ headLook }),
      setPanelOpen: (panelOpen) => set({ panelOpen }),
    }),
    {
      name: "ovr.expression-tracking",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Tracking itself always starts off; only the preferences persist.
      partialize: (s) => ({ mirror: s.mirror, showFaceView: s.showFaceView, headLook: s.headLook }),
    },
  ),
);

/**
 * Latest smoothed values for the local avatar, read every frame by the renderer. Null when
 * tracking is off or the face has been lost for a moment.
 */
export const faceState: { params: FacialParams | null } = { params: null };

let running = false;
/**
 * Bumped by every start and stop. A start that finds it changed after an await was cancelled (or
 * replaced by a newer start), so it closes what it opened instead of keeping it: a quick on, off,
 * on can never leave a second camera running with its light on.
 */
let session = 0;
let stream: MediaStream | null = null;
let video: HTMLVideoElement | null = null;
let landmarker: FaceLandmarker | null = null;
let frameRequest = 0;
let lastVideoTime = -1;
let lastFaceAt = 0;
let neutral: RawFace | null = null;
let samples: RawFace[] = [];
const smoother = new FaceSmoother();

const setState = (patch: Partial<TrackingStore>) => useTrackingStore.setState(patch);

function describeError(err: unknown): string {
  const name = (err as { name?: string })?.name;
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow the camera for this site in your browser's settings, then try again. Some built-in app browsers never allow cameras; if so, open Cram Club in Chrome, Edge or Safari.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotReadableError":
      return "Your camera is busy in another app. Close it there and try again.";
    case "ModelError":
      return "The face tracking model couldn't load. Check your internet connection and try again.";
    case "Unsupported":
    case "NotSupportedError":
      return "This browser can't share a camera with the page.";
    default:
      return "Expression tracking couldn't start. Your avatar will keep its normal animation.";
  }
}

class NamedError extends Error {
  constructor(name: string, message: string) {
    super(message);
    this.name = name;
  }
}

async function createLandmarker(): Promise<FaceLandmarker> {
  const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO" as const,
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  try {
    return await withQuietInfo(() => FaceLandmarker.createFromOptions(fileset, options("GPU")));
  } catch {
    // Some machines can't use the GPU delegate; the CPU one is slower but works everywhere.
    try {
      return await withQuietInfo(() => FaceLandmarker.createFromOptions(fileset, options("CPU")));
    } catch (err) {
      throw new NamedError("ModelError", String(err));
    }
  }
}

function cleanup() {
  cancelAnimationFrame(frameRequest);
  frameRequest = 0;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (video) {
    video.pause();
    video.srcObject = null;
  }
  video = null;
  landmarker?.close();
  landmarker = null;
  faceState.params = null;
  neutral = null;
  samples = [];
  smoother.reset();
}

/** Starts the camera and tracking. Must be called from a user action (it asks for the camera). */
export async function startTracking() {
  if (running) return;
  running = true;
  const mine = ++session;
  const cancelled = () => mine !== session;
  // What this start opened, so a cancelled one can close exactly that and nothing newer.
  let media: MediaStream | null = null;
  let el: HTMLVideoElement | null = null;
  let lm: FaceLandmarker | null = null;
  const drop = () => {
    media?.getTracks().forEach((t) => t.stop());
    if (el) {
      el.pause();
      el.srcObject = null;
    }
    if (lm !== landmarker) lm?.close();
  };
  setState({ status: "starting", error: null, calibration: 0 });
  try {
    media = await openMedia("camera", {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30 },
    });
    if (cancelled()) return drop();
    // Shared straight away, so a preview can show while the face model loads.
    stream = media;
    el = document.createElement("video");
    el.muted = true;
    el.playsInline = true;
    el.srcObject = media;
    await el.play();
    if (cancelled()) return drop();
    video = el;
    lm = await createLandmarker();
    if (cancelled()) return drop();
    landmarker = lm;
    recalibrate();
    lastVideoTime = -1;
    frameRequest = requestAnimationFrame(step);
  } catch (err) {
    drop();
    if (cancelled()) return;
    running = false;
    cleanup();
    setState({ status: "error", error: describeError(err) });
  }
}

/** Turns the camera off and returns the avatar to its normal animation. */
export function stopTracking() {
  running = false;
  session++;
  cleanup();
  setState({ status: "off", calibration: 0 });
}

/** Tracking is on (starting, calibrating or following a face). */
export const isTrackingActive = (status: TrackingStatus) => status !== "off" && status !== "error";

/**
 * The student turning the camera on themselves, from the world's "Camera and face" panel: starts
 * tracking and, once it is running, remembers "on" for the "Before you go in" step. A start that
 * failed (blocked, no camera) or was switched off meanwhile remembers nothing.
 */
export async function turnCameraOn() {
  await startTracking();
  if (isTrackingActive(useTrackingStore.getState().status)) {
    useDevicePrefs.getState().setCamera("on");
  }
}

/**
 * The student turning the camera off themselves: stops tracking and remembers "off". Stops for
 * any other reason (leaving the library, an error) use {@link stopTracking} and change nothing.
 */
export function turnCameraOff() {
  stopTracking();
  useDevicePrefs.getState().setCamera("off");
}

/** Forgets the resting face and learns it again over the next second. */
export function recalibrate() {
  neutral = null;
  samples = [];
  smoother.reset();
  setState({ status: "calibrating", calibration: 0 });
}

/** The live camera stream, for the optional self-view in the tracking panel. */
export function getCameraStream() {
  return stream;
}

function step() {
  if (!running || !video || !landmarker) return;
  frameRequest = requestAnimationFrame(step);
  // Only analyse new frames; rAF can run faster than the camera.
  if (video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;
  const nowMs = performance.now();
  const now = nowMs / 1000;
  let result;
  try {
    result = landmarker.detectForVideo(video, nowMs);
  } catch {
    return;
  }
  const raw = extractRawFace(
    result.faceBlendshapes[0]?.categories,
    result.facialTransformationMatrixes[0]?.data,
  );
  const { status, mirror } = useTrackingStore.getState();

  if (!raw) {
    if (now - lastFaceAt > LOST_FACE_SECONDS) {
      faceState.params = null;
      if (status === "tracking") setState({ status: "no-face" });
    }
    return;
  }
  lastFaceAt = now;

  if (!neutral) {
    samples.push(raw);
    setState({ calibration: samples.length / CALIBRATION_FRAMES });
    if (samples.length >= CALIBRATION_FRAMES) {
      neutral = averageFaces(samples);
      samples = [];
      setState({ status: "tracking", calibration: 1 });
    }
    return;
  }
  if (status !== "tracking") setState({ status: "tracking" });
  faceState.params = smoother.smooth(toFacialParams(raw, neutral, { mirror }), now);
}

/**
 * Development check: loads the wasm runtime and model and runs one detection on a blank image,
 * without touching the camera. Exposed on window.__ovr in dev builds.
 */
export async function selfTestModel() {
  const t0 = performance.now();
  const lm = await createLandmarker();
  const loadMs = Math.round(performance.now() - t0);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#888";
  ctx.fillRect(0, 0, 128, 128);
  const result = lm.detectForVideo(canvas, performance.now());
  lm.close();
  return { loadMs, facesFound: result.faceBlendshapes.length };
}
