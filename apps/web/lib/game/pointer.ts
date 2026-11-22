import { useGameStore } from "./store";

/**
 * Pointer lock for mouse-look. The canvas registers itself here so HTML overlays (the
 * "click to look around" layer, the Resume button) can lock the pointer from their own clicks,
 * which browsers require to be a direct user gesture. When a browser refuses pointer lock,
 * the camera falls back to click-and-drag looking (see CameraRig).
 */
let canvas: HTMLCanvasElement | null = null;
let onFailure: (() => void) | null = null;

export function registerCanvas(el: HTMLCanvasElement | null, failed?: () => void) {
  canvas = el;
  onFailure = failed ?? null;
}

/**
 * Asks the browser to capture the mouse. With `quiet`, a refusal isn't reported as "this browser
 * can't lock the pointer"; used when re-capturing after Shift, which can legitimately be refused
 * because the key release came too long after the last user gesture.
 */
export function requestPointerLock({ quiet = false }: { quiet?: boolean } = {}) {
  if (!canvas || document.pointerLockElement === canvas) return;
  // Seated, the mouse is the table's: it stays free (lib/game/mouse.ts).
  if (useGameStore.getState().seatId) return;
  let reported = false;
  const fail = () => {
    if (reported || quiet) return;
    reported = true;
    onFailure?.();
  };
  // Older browsers only signal failure with an event, newer ones also reject a promise.
  document.addEventListener("pointerlockerror", fail, { once: true });
  setTimeout(() => document.removeEventListener("pointerlockerror", fail), 2000);
  try {
    const result = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    result?.catch(fail);
  } catch {
    fail();
  }
}

export function exitPointerLock() {
  if (document.pointerLockElement) document.exitPointerLock();
}

export function isPointerLocked() {
  return !!canvas && document.pointerLockElement === canvas;
}
