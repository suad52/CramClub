import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setTimerPanelOpen } from "./actions";
import { mouseWanted, recaptureForWalking } from "./mouse";
import { registerCanvas, requestPointerLock } from "./pointer";
import { useGameStore } from "./store";

/**
 * Node has no usable localStorage, and the stores persist through it as soon as they're
 * imported, so a Map-backed one goes in first.
 */
vi.hoisted(() => {
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, String(value)),
      removeItem: (key: string) => void items.delete(key),
    },
  });
});

/** Stands in for the browser: a page with the library's canvas, nothing focused or captured. */
function fakePage() {
  const canvas = { requestPointerLock: vi.fn(() => Promise.resolve()) };
  vi.stubGlobal("document", {
    pointerLockElement: null,
    activeElement: null,
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  registerCanvas(canvas as unknown as HTMLCanvasElement);
  return canvas;
}

describe("where the mouse belongs", () => {
  let canvas: ReturnType<typeof fakePage>;

  beforeEach(() => {
    canvas = fakePage();
    useGameStore.setState({ phase: "playing", seatId: null, cursorFree: false, menuOpen: false });
  });
  afterEach(() => {
    registerCanvas(null);
    vi.unstubAllGlobals();
    useGameStore.setState({ seatId: null });
  });

  it("walking with nothing open, it's captured for looking around", () => {
    expect(mouseWanted()).toBe(false);
    recaptureForWalking();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it("seated, it stays free for the table's buttons: nothing captures it", () => {
    useGameStore.setState({ seatId: "hall-t01-c1" });
    expect(mouseWanted()).toBe(true);
    recaptureForWalking();
    // Not even a direct request (a panel closing, the pomodoro's full screen, a lesson starting).
    requestPointerLock({ quiet: true });
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
  });

  it("a card that has to be clicked keeps it free until it goes", () => {
    setTimerPanelOpen("reserved", true);
    recaptureForWalking();
    expect(canvas.requestPointerLock).not.toHaveBeenCalled();
    setTimerPanelOpen("reserved", false);
    recaptureForWalking();
    expect(canvas.requestPointerLock).toHaveBeenCalledTimes(1);
  });

  it("the menu or Shift keeps it free too", () => {
    useGameStore.setState({ menuOpen: true });
    expect(mouseWanted()).toBe(true);
    useGameStore.setState({ menuOpen: false, cursorFree: true });
    expect(mouseWanted()).toBe(true);
  });
});
