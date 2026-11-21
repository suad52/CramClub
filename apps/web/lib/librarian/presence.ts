import { LIBRARIAN } from "@ovr/shared";

/** Her eyes before she has been drawn: above her spot behind the desk. */
const eye: { x: number; y: number; z: number } = {
  x: LIBRARIAN.librarian.x,
  y: 1.55,
  z: LIBRARIAN.librarian.z,
};

/**
 * What the Librarian's panel tells the librarian in the 3D library, read every frame by
 * components/world/Librarian.tsx (and the camera, components/world/CameraRig.tsx). Plain mutable
 * data (no store): it changes often and nothing re-renders from it.
 *
 * - `open`: her panel is showing, so she keeps her eyes on you.
 * - `working`: a request is busy (researching, writing a plan or a lesson): she writes in her ledger.
 * - `speakUntil`: a `performance.now()` time; until then she mouths a line (there's no voice to
 *   follow: muted, not set up, or it couldn't play).
 * - `speaking` / `mouth`: her ElevenLabs voice is playing, and how loud it is right now (0–1),
 *   which opens her jaw in time with the words.
 * - `eye`: where her eyes are in the world (m), kept up to date by the librarian herself, for the
 *   conversation close-up to frame her face.
 * - `shushUntil`: a `performance.now()` time; until then she turns to look at you from wherever
 *   you are, because she's just shushed you (lib/focus/watch.ts, "Ms. Fenwick keeps you honest")
 *   or just answered you in the library chat (lib/chat/fenwick.ts).
 */
export const librarianPresence = {
  open: false,
  working: false,
  speakUntil: 0,
  speaking: false,
  mouth: 0,
  eye,
  shushUntil: 0,
};

/** The shortest time she mouths a line for when there's no voice. */
export const SPEAK_MS = 1200;

let motionQuery: MediaQueryList | null = null;
/** Whether the viewer asked for less motion (checked each frame, so it follows a settings change). */
export function prefersReducedMotion() {
  if (typeof window === "undefined") return false;
  motionQuery ??= window.matchMedia("(prefers-reduced-motion: reduce)");
  return motionQuery.matches;
}
