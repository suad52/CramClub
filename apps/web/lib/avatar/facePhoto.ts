import type { FaceLandmarker } from "@mediapipe/tasks-vision";

/**
 * "My real face": the player's avatar head can be the chibi head or a cartoon disc showing a
 * photo of their face (or their live camera while expression tracking runs).
 *
 * Privacy: the camera only opens from a click in the Character Studio and closes right after
 * the photo is taken; the face is found on this device by MediaPipe (self-hosted model) and the
 * small JPEG is kept in this browser's saved profile. Nothing is uploaded.
 *
 * The top half of this file is pure (tested); the bottom half needs a browser.
 */

export type HeadMode = "chibi" | "face";

export interface HeadSettings {
  headMode: HeadMode;
  /** A small square JPEG of the player's face (data URL), or null before a photo is taken. */
  facePhoto: string | null;
  /** Show the live camera instead of the photo while expression tracking is on. */
  liveFace: boolean;
}

export const DEFAULT_HEAD: HeadSettings = { headMode: "chibi", facePhoto: null, liveFace: false };

/** Side of the stored photo, in pixels. */
export const FACE_PHOTO_SIZE = 256;
/** Upper bound on a stored photo's data URL (a 256px JPEG is ~15-40 KB). */
export const FACE_PHOTO_MAX_LENGTH = 300_000;
/** Diameter of the round face guide, as a fraction of the (square) camera preview. */
export const FACE_GUIDE_FRACTION = 0.72;
/** How much of the frame's central square the live camera head shows (smaller = closer). */
export const LIVE_FACE_ZOOM = 0.8;

const PHOTO_PREFIX = "data:image/jpeg;base64,";

export function isFacePhoto(v: unknown): v is string {
  return (
    typeof v === "string" &&
    v.startsWith(PHOTO_PREFIX) &&
    v.length > PHOTO_PREFIX.length + 32 &&
    v.length <= FACE_PHOTO_MAX_LENGTH &&
    /^[A-Za-z0-9+/]+=*$/.test(v.slice(PHOTO_PREFIX.length))
  );
}

/** Head settings from untrusted input (an old or hand-edited save): always valid. */
export function sanitizeHead(v: unknown): HeadSettings {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof HeadSettings, unknown>>;
  return {
    headMode: o.headMode === "face" ? "face" : "chibi",
    facePhoto: isFacePhoto(o.facePhoto) ? o.facePhoto : null,
    liveFace: o.liveFace === true,
  };
}

export const sameHead = (a: HeadSettings, b: HeadSettings) =>
  a.headMode === b.headMode && a.facePhoto === b.facePhoto && a.liveFace === b.liveFace;

/** Whether the avatar should wear the face head (it needs a photo, or live video to show). */
export function showsFaceHead(head: HeadSettings, hasLiveVideo = false): boolean {
  return head.headMode === "face" && (head.facePhoto !== null || (head.liveFace && hasLiveVideo));
}

/**
 * Kit parts that belong to the chibi head and are hidden under the face head: the head itself
 * (with its ears), the face features, hair, face details and anything worn on the head, eyes or
 * ears. The neck and neck/back accessories (scarf, pendant, backpack) stay.
 */
const HEAD_PART_PREFIXES = ["Head_", "Mouth_", "Eyes_", "Brows_", "Nose_", "Hair_", "Detail_"];
const HEAD_ACCESSORIES = new Set([
  "Acc_GlassesRound",
  "Acc_GlassesSquare",
  "Acc_Headphones",
  "Acc_Beanie",
  "Acc_Cap",
  "Acc_HairClip",
  "Acc_Earrings",
]);
export function isChibiHeadPart(name: string): boolean {
  return HEAD_ACCESSORIES.has(name) || HEAD_PART_PREFIXES.some((p) => name.startsWith(p));
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
/** A square crop in pixels. */
export interface Square {
  x: number;
  y: number;
  size: number;
}

/** Pixel bounding box of normalised (0 … 1) landmarks, or null if there are none. */
export function landmarkBox(
  points: readonly { x: number; y: number }[],
  frameWidth: number,
  frameHeight: number,
): Box | null {
  if (!points.length) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  const box = {
    x: x0 * frameWidth,
    y: y0 * frameHeight,
    width: (x1 - x0) * frameWidth,
    height: (y1 - y0) * frameHeight,
  };
  return box.width > 1 && box.height > 1 ? box : null;
}

/** Keeps a square of the given centre and size inside the frame (shrinking it if it must). */
function clampSquare(cx: number, cy: number, size: number, frameW: number, frameH: number) {
  const side = Math.max(1, Math.min(size, frameW, frameH));
  const x = Math.min(Math.max(cx - side / 2, 0), frameW - side);
  const y = Math.min(Math.max(cy - side / 2, 0), frameH - side);
  return { x: Math.round(x), y: Math.round(y), size: Math.round(side) };
}

/**
 * A square around a detected face with room for the hair and chin. Face landmarks stop at the
 * forehead, so the square is nudged up a little.
 */
export function faceCrop(face: Box, frameW: number, frameH: number, margin = 1.7): Square {
  const size = Math.max(face.width, face.height) * margin;
  const cx = face.x + face.width / 2;
  const cy = face.y + face.height / 2 - face.height * 0.1;
  return clampSquare(cx, cy, size, frameW, frameH);
}

/** The square around the preview's round guide (used when no face is found). */
export function guideCrop(frameW: number, frameH: number, fraction = FACE_GUIDE_FRACTION): Square {
  return clampSquare(frameW / 2, frameH / 2, Math.min(frameW, frameH) * fraction, frameW, frameH);
}

/**
 * Texture repeat/offset that shows the central square of a video frame (zoomed in by `zoom`),
 * optionally mirrored, on a mesh with 0 … 1 UVs.
 */
export function videoCrop(width: number, height: number, zoom = LIVE_FACE_ZOOM, mirror = false) {
  const side = Math.min(width, height) * zoom;
  const rx = width > 0 ? side / width : 1;
  const ry = height > 0 ? side / height : 1;
  return {
    repeat: [mirror ? -rx : rx, ry] as [number, number],
    offset: [mirror ? (1 + rx) / 2 : (1 - rx) / 2, (1 - ry) / 2] as [number, number],
  };
}

// ---------------------------------------------------------------------------
// Browser-only: camera and capture
// ---------------------------------------------------------------------------

const MODEL_URL = process.env.NEXT_PUBLIC_FACE_MODEL_URL || "/models/face_landmarker.task";
const WASM_PATH = "/mediapipe/wasm";

let finder: Promise<FaceLandmarker | null> | null = null;

/** Loads Face Landmarker in IMAGE mode (cached until closeFaceFinder). Null if it can't load. */
export function loadFaceFinder(): Promise<FaceLandmarker | null> {
  finder ??= (async () => {
    try {
      const { FaceLandmarker, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_PATH);
      const options = (delegate: "GPU" | "CPU") => ({
        baseOptions: { modelAssetPath: MODEL_URL, delegate },
        runningMode: "IMAGE" as const,
        numFaces: 1,
      });
      try {
        return await FaceLandmarker.createFromOptions(fileset, options("GPU"));
      } catch {
        return await FaceLandmarker.createFromOptions(fileset, options("CPU"));
      }
    } catch {
      return null;
    }
  })();
  return finder;
}

/** Frees the face finder's model and GPU memory. */
export function closeFaceFinder() {
  const f = finder;
  finder = null;
  void f?.then((lm) => lm?.close()).catch(() => {});
}

export interface FaceCamera {
  stream: MediaStream;
  /** Stops the camera, unless it belongs to expression tracking (that keeps running). */
  release: () => void;
}

/**
 * Opens the webcam for a photo. Call only from a click. Reuses expression tracking's camera
 * when it's already on, so the browser doesn't open a second one.
 */
export async function openFaceCamera(shared: MediaStream | null): Promise<FaceCamera> {
  if (shared && shared.getVideoTracks().some((t) => t.readyState === "live"))
    return { stream: shared, release: () => {} };
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Unsupported");
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
  });
  return { stream, release: () => stream.getTracks().forEach((t) => t.stop()) };
}

/** A plain-language reason the camera couldn't open. */
export function describeCameraError(err: unknown): string {
  switch ((err as { name?: string })?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Camera access was blocked. Allow the camera for this site in your browser's settings, then try again.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No camera was found on this device.";
    case "NotReadableError":
      return "Your camera is busy in another app. Close it there and try again.";
    default:
      return "The camera couldn't start in this browser.";
  }
}

/**
 * Runs MediaPipe without its "INFO: Created TensorFlow Lite XNNPACK delegate" line, which the
 * WASM prints through console.error on the first detection (Next's dev overlay flags it).
 */
function quietly<T>(fn: () => T): T {
  const error = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("INFO:")) return;
    error(...args);
  };
  try {
    return fn();
  } finally {
    console.error = error;
  }
}

/** Copies the camera's current frame (so the camera can be closed straight away). */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) throw new Error("The camera has no picture yet");
  const frame = document.createElement("canvas");
  frame.width = w;
  frame.height = h;
  frame.getContext("2d")!.drawImage(video, 0, 0, w, h);
  return frame;
}

/**
 * Finds the face in a grabbed frame and returns a square JPEG of it, mirrored like the preview.
 * Falls back to the round guide when no face is found.
 */
export async function facePhotoFromFrame(
  frame: HTMLCanvasElement,
): Promise<{ photo: string; found: boolean }> {
  const { width: w, height: h } = frame;
  let crop: Square | null = null;
  const lm = await loadFaceFinder();
  if (lm) {
    try {
      const box = landmarkBox(quietly(() => lm.detect(frame)).faceLandmarks[0] ?? [], w, h);
      if (box) crop = faceCrop(box, w, h);
    } catch {
      // Detection failed: use the guide.
    }
  }
  const found = crop !== null;
  crop ??= guideCrop(w, h);

  const out = document.createElement("canvas");
  out.width = out.height = FACE_PHOTO_SIZE;
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(FACE_PHOTO_SIZE, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(
    frame,
    crop.x,
    crop.y,
    crop.size,
    crop.size,
    0,
    0,
    FACE_PHOTO_SIZE,
    FACE_PHOTO_SIZE,
  );
  return { photo: out.toDataURL("image/jpeg", 0.86), found };
}
