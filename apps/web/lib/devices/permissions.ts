import type { MediaKind } from "./prefs";

/**
 * Can this page use cameras and microphones at all, and what went wrong when one didn't open.
 * The pure parts (mediaSupport, mediaProblem, problemText) are tested next door; the browser
 * parts (currentMediaSupport, permissionState, watchPermission) are thin and never throw.
 */

/** "insecure": not https (or localhost), so the browser hides cameras and microphones. */
export type MediaSupport = "ok" | "insecure" | "unsupported";

export function mediaSupport(env: { secure: boolean; getUserMedia: boolean }): MediaSupport {
  if (!env.secure) return "insecure";
  if (!env.getUserMedia) return "unsupported";
  return "ok";
}

/** This page, right now. Server-side (no window) counts as unsupported. */
export function currentMediaSupport(): MediaSupport {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  return mediaSupport({
    secure: window.isSecureContext !== false,
    getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
  });
}

/** Why a camera or microphone didn't open, in the few cases a student can do something about. */
export type MediaProblem = "denied" | "missing" | "busy" | "unsupported" | "insecure" | "other";

/** Sorts a getUserMedia (or openMedia) error by its DOMException name. */
export function mediaProblem(err: unknown): MediaProblem {
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return "denied";
    case "SecurityError":
      return "insecure";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    case "NotSupportedError":
    case "TypeError":
      return "unsupported";
    default:
      return "other";
  }
}

/** One short, friendly line for each problem (every one of them still lets the student go in). */
export function problemText(problem: MediaProblem, kind: MediaKind): string {
  const thing = kind === "camera" ? "camera" : "microphone";
  switch (problem) {
    case "denied":
      return `Your browser is blocking the ${thing}. Click the ${thing} icon in the address bar, choose Allow, then Try again.`;
    case "missing":
      return kind === "camera"
        ? "No camera found on this computer. You can go in without one."
        : "No microphone found on this computer. You can go in without one.";
    case "busy":
      return `Your ${thing} is busy in another app. Close it there, then Try again.`;
    case "unsupported":
      return `This browser can't share a ${thing} with the page. You can still go in.`;
    case "insecure":
      return `The ${thing} only works on a secure (https) page. You can still go in.`;
    default:
      return `Your ${thing} didn't start. Try again, or go in without it.`;
  }
}

/** The browser's remembered answer for this site: "unknown" where it won't say (Safari, Firefox). */
export type PermissionValue = "granted" | "denied" | "prompt" | "unknown";

const PERMISSION_NAME: Record<MediaKind, string> = { camera: "camera", mic: "microphone" };

async function query(kind: MediaKind): Promise<PermissionStatus | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.permissions?.query) return null;
    return await navigator.permissions.query({
      name: PERMISSION_NAME[kind] as PermissionName,
    });
  } catch {
    return null;
  }
}

function valueOf(status: PermissionStatus | null): PermissionValue {
  const state = status?.state;
  return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
}

export async function permissionState(kind: MediaKind): Promise<PermissionValue> {
  return valueOf(await query(kind));
}

/**
 * Calls `onChange` whenever the student changes this site's camera or microphone permission (in
 * the address bar or the browser's settings), where the browser reports it. Returns the unwatch.
 */
export function watchPermission(
  kind: MediaKind,
  onChange: (value: PermissionValue) => void,
): () => void {
  let stopped = false;
  let status: PermissionStatus | null = null;
  const listener = () => {
    if (!stopped) onChange(valueOf(status));
  };
  void query(kind).then((s) => {
    if (stopped || !s) return;
    status = s;
    s.addEventListener("change", listener);
  });
  return () => {
    stopped = true;
    status?.removeEventListener("change", listener);
  };
}
