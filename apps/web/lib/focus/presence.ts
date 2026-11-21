import type { FacialParams } from "@ovr/shared";
import type { TrackingStatus } from "@/lib/facial-tracking/tracker";

/**
 * Verified focus minutes, the pure half: how much of a pomodoro the student's own face tracking
 * was on, and how much of that it actually saw them at the desk, roughly facing the screen. It
 * only ever reads what the on-device tracker already computes (lib/facial-tracking/tracker.ts:
 * its status and the eight smoothed face numbers); no frame, landmark or picture is involved, and
 * nothing here turns a camera on. Face tracking stays strictly the student's own choice.
 *
 * Contract with the server (POST /api/learning/session-complete, sent by trackPomodoros() in
 * lib/learning/client.ts): `presence: { cameraSeconds, seenSeconds }`, whole seconds, with
 * seenSeconds <= cameraSeconds <= the pomodoro's length. It's left out when the camera was never
 * on: then the pomodoro counts as normal focus minutes with 0 verified. Verified minutes are an
 * extra honesty signal, never a requirement.
 *
 * The browser looks once a second (lib/focus/watch.ts) and credits the time since its last look
 * with what it sees now. A gap longer than MAX_STEP_MS (a frozen tab, a sleeping laptop) only
 * counts as MAX_STEP_MS, so time the page wasn't watching is never credited.
 */

/** The camera counts as on once it's past calibrating: tracking a face, or looking for one. */
export function cameraCounts(status: TrackingStatus) {
  return status === "tracking" || status === "no-face";
}

/**
 * How far the head may turn and still count as "facing the screen", as fractions of
 * FACIAL_HEAD_LIMITS (yaw 0.6 rad, pitch 0.45 rad) from the calibrated resting pose: about 30°
 * to either side, about 20° up. Looking down is always fine: that's where the page is.
 */
export const FACING = { yaw: 0.85, up: 0.8 } as const;

/** A face is there and roughly facing the screen (null params: no face, or tracking off). */
export function faceSeen(params: FacialParams | null | undefined) {
  if (!params) return false;
  const { headYaw, headPitch } = params;
  if (!Number.isFinite(headYaw) || !Number.isFinite(headPitch)) return false;
  return Math.abs(headYaw) < FACING.yaw && headPitch < FACING.up;
}

/** The most one look may credit (ms): about two missed looks. */
export const MAX_STEP_MS = 2000;

export interface PresenceTally {
  /** When it last looked (ms since epoch), or null before the first look. */
  lastAt: number | null;
  /** Time credited with the camera on, and with the face seen (ms). */
  cameraMs: number;
  seenMs: number;
  /**
   * Since when the face has been missing or turned away while the camera was on and the
   * pomodoro was being counted (null: seen, camera off, or not counting).
   */
  missingSince: number | null;
  /** What the latest look saw. */
  cameraNow: boolean;
  seenNow: boolean;
}

export function emptyTally(): PresenceTally {
  return {
    lastAt: null,
    cameraMs: 0,
    seenMs: 0,
    missingSince: null,
    cameraNow: false,
    seenNow: false,
  };
}

export interface PresenceLook {
  at: number;
  /**
   * The pomodoro is running with the student in the tab (not paused, not away): only then does
   * time count.
   */
  counting: boolean;
  camera: boolean;
  seen: boolean;
}

/** One look: the time since the last one is credited with what this one sees. */
export function addLook(t: PresenceTally, look: PresenceLook): PresenceTally {
  const step = t.lastAt === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, look.at - t.lastAt));
  const camera = look.counting && look.camera;
  const seen = camera && look.seen;
  return {
    lastAt: Math.max(look.at, t.lastAt ?? look.at),
    cameraMs: t.cameraMs + (camera ? step : 0),
    seenMs: t.seenMs + (seen ? step : 0),
    missingSince: camera && !seen ? (t.missingSince ?? look.at) : null,
    cameraNow: camera,
    seenNow: seen,
  };
}

/** How long the face has been missing or turned away, as of `now` (0 when it hasn't). */
export function missingMs(t: PresenceTally, now: number) {
  return t.missingSince === null ? 0 : Math.max(0, now - t.missingSince);
}

export interface PresencePayload {
  cameraSeconds: number;
  seenSeconds: number;
}

/**
 * What session-complete gets: whole seconds, capped at the pomodoro's length; undefined when the
 * camera was never on (so the server records normal focus minutes and 0 verified).
 */
export function presencePayload(t: PresenceTally, maxSeconds: number): PresencePayload | undefined {
  const cap = Math.max(0, Math.floor(Number.isFinite(maxSeconds) ? maxSeconds : 0));
  const cameraSeconds = Math.min(cap, Math.floor(t.cameraMs / 1000));
  if (!(cameraSeconds > 0)) return undefined;
  const seenSeconds = Math.min(cameraSeconds, Math.floor(t.seenMs / 1000));
  return { cameraSeconds, seenSeconds };
}

/** Seen at the desk, as a whole percentage of the camera-on time (null: the camera wasn't on). */
export function seenPercent(t: Pick<PresenceTally, "cameraMs" | "seenMs">) {
  if (t.cameraMs < 1000) return null;
  return Math.round((100 * Math.min(t.seenMs, t.cameraMs)) / t.cameraMs);
}
