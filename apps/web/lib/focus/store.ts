"use client";

import { create } from "zustand";
import type { PresencePayload } from "./presence";

/**
 * What the focus loop shows on screen (kept up to date by lib/focus/watch.ts, once a second at
 * most): the live "seen at desk" meter on the table timer, how many real people are studying
 * near you, Ms. Fenwick's latest shush as a caption (so it works muted), and the "You showed up"
 * recap of the pomodoro that just rang. Nothing here is persisted.
 */

export interface FocusRecap {
  /** The focusDone notice this belongs to (its `at`). */
  at: number;
  /**
   * The judge demo rang it early (the notice's `preview`): how long it actually ran. Shown as a
   * preview, never counted, no XP. Null for every real pomodoro.
   */
  preview: { seconds: number } | null;
  /** Pomodoros done in this set, this one included, and whether a long break follows. */
  count: number;
  long: boolean;
  /** The pomodoro's length (min). */
  minutes: number;
  /** What was sent with session-complete; undefined when the camera wasn't on. */
  presence: PresencePayload | undefined;
  /** Seen at the desk (%) while the camera was on; null when it wasn't. */
  percent: number | null;
  /** Who studied at your table or nearby (name-tag names, longest-staying first). */
  companions: string[];
  /** XP the server gave: undefined while it's on its way, null if it couldn't say. */
  xp: number | null | undefined;
  /** Picks the card's encouragement (fixed when the pomodoro rang). */
  pick: number;
}

/** How long a shush's caption stays up. */
export const CAPTION_MS = 7000;

export interface FocusCaption {
  line: string;
  /** When she said it (ms since epoch); a new one replaces the old. */
  at: number;
}

interface FocusStore {
  /** During a focus phase: your own face tracking is on (past calibrating). */
  cameraOn: boolean;
  /** …and it sees you at the desk right now. */
  seenNow: boolean;
  /** Seen at the desk so far this pomodoro (%), or null with the camera off. */
  percent: number | null;
  /** Real players seated at your table or near it right now (0 while you aren't seated). */
  nearby: number;
  recap: FocusRecap | null;
  /** The recap card is on screen, so the pomodoro's XP shows there instead of in a toast. */
  recapShown: boolean;
  caption: FocusCaption | null;
}

export const useFocusStore = create<FocusStore>(() => ({
  cameraOn: false,
  seenNow: false,
  percent: null,
  nearby: 0,
  recap: null,
  recapShown: false,
  caption: null,
}));
