import { describe, expect, it, vi } from "vitest";
import { SEATS } from "@ovr/shared";
import {
  interact,
  isSeatLocked,
  isTimerPanelOpen,
  onSeatLockNudge,
  setTimerPanelOpen,
  sitDown,
  standUp,
} from "./actions";
import { usePomodoro } from "./pomodoro";
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

const MIN = 60_000;

describe("staying at the table during a pomodoro", () => {
  it("keeps you seated mid-pomodoro (with a nudge) and lets you go once it's given up", () => {
    const seat = SEATS[0]!;
    sitDown(seat.id);
    usePomodoro.getState().startFocus(1000);
    expect(isSeatLocked()).toBe(true);
    const nudge = vi.fn();
    const off = onSeatLockNudge(nudge);
    standUp();
    interact();
    expect(useGameStore.getState().seatId).toBe(seat.id);
    expect(nudge).toHaveBeenCalledTimes(2);

    usePomodoro.getState().abandon("left-table", 2000);
    expect(isSeatLocked()).toBe(false);
    standUp();
    expect(useGameStore.getState().seatId).toBe(null);
    off();
    standUp();
    expect(nudge).toHaveBeenCalledTimes(2);
  });

  it("doesn't hold you during a break", () => {
    sitDown(SEATS[1]!.id);
    const p = usePomodoro.getState();
    p.startFocus(0);
    p.tick(25 * MIN + 1);
    expect(usePomodoro.getState().phase).toBe("shortBreak");
    expect(isSeatLocked()).toBe(false);
    interact();
    expect(useGameStore.getState().seatId).toBe(null);
  });

  it("knows while the timer's settings or leave dialog holds the mouse", () => {
    expect(isTimerPanelOpen()).toBe(false);
    setTimerPanelOpen("settings", true);
    setTimerPanelOpen("leave", true);
    setTimerPanelOpen("settings", false);
    expect(isTimerPanelOpen()).toBe(true);
    setTimerPanelOpen("leave", false);
    expect(isTimerPanelOpen()).toBe(false);
  });
});
