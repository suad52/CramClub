"use client";

import { type PresencePayload, type PresenceTally, emptyTally, presencePayload } from "./presence";
import { useFocusStore } from "./store";

/*
 * Where the focus loop meets learning analytics, kept tiny so lib/learning/client.ts can import
 * it without the multiplayer link or the Librarian's voice: lib/focus/watch.ts writes this
 * pomodoro's presence tally here, and trackPomodoros() reads it when the pomodoro rings and hands
 * back the XP session-complete returned.
 */

/** This pomodoro's tally (reset when a pomodoro starts; kept after it ends until the next one). */
export const focusSession: { tally: PresenceTally } = { tally: emptyTally() };

/**
 * The presence to send with session-complete for the pomodoro that just rang, capped at its
 * length (`maxSeconds`), or undefined when the camera wasn't on.
 */
export function focusPresence(maxSeconds: number): PresencePayload | undefined {
  return presencePayload(focusSession.tally, maxSeconds);
}

/**
 * session-complete answered with the pomodoro's XP (null: it couldn't say). It goes on the "You
 * showed up" card for that pomodoro (rung at `at`); returns false if that card isn't on screen,
 * so the caller announces the XP in a toast instead.
 */
export function showSessionXp(at: number, xp: number | null) {
  const { recap, recapShown } = useFocusStore.getState();
  if (!recap || recap.at !== at) return false;
  useFocusStore.setState({ recap: { ...recap, xp } });
  return recapShown;
}
