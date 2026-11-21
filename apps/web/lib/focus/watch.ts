"use client";

import { SEATS } from "@ovr/shared";
import { useProfileStore } from "@/lib/avatar/profile";
import { faceState, useTrackingStore } from "@/lib/facial-tracking/tracker";
import { type PomodoroState, isFocusing, usePomodoro } from "@/lib/game/pomodoro";
import { useGameStore } from "@/lib/game/store";
import { isDemoOn } from "@/lib/demo/mode";
import { DEMO_COMPANION_MIN_MS } from "@/lib/demo/settings";
import { librarianPresence } from "@/lib/librarian/presence";
import { isSpeaking, sayAloud } from "@/lib/librarian/voice";
import { useNet } from "@/lib/net/connection";
import { remoteLive, useRemotePlayers } from "@/lib/net/players";
import {
  type CompanionLog,
  type SeatSpot,
  addCompanionTime,
  companionNames,
  neighboursOf,
} from "./companions";
import { shushLine, studentFirstName } from "./lines";
import {
  MAX_STEP_MS,
  addLook,
  cameraCounts,
  emptyTally,
  faceSeen,
  missingMs,
  presencePayload,
  seenPercent,
} from "./presence";
import { focusSession } from "./session";
import {
  type ShushContext,
  type ShushReason,
  afterShush,
  freshLimiter,
  mayShush,
  rearm,
  shouldShushDrift,
} from "./shush";
import { useFocusStore } from "./store";

/*
 * The focus loop, live (the rules are pure, next door: presence.ts, shush.ts, companions.ts,
 * lines.ts). startFocusWatch() (PomodoroLayer starts it while you're in the library) looks once a
 * second:
 *
 * - while a pomodoro's focus phase runs with you in the tab, it tallies how long your own face
 *   tracking was on and saw you at the desk (only reading tracker.ts's status and smoothed head
 *   pose; it never starts the camera), for the timer's meter and for session-complete
 *   (session.ts focusPresence(), sent by trackPomodoros() in lib/learning/client.ts);
 * - it notes which real players sit at your table or near it (lib/net/players.ts), for the "You
 *   showed up" card and the timer's body-doubling line;
 * - it lets Ms. Fenwick shush you when you drift off (or come back from a near miss), by first
 *   name, in her voice (voice.ts sayAloud, which respects mute) with the line as a caption, and
 *   she turns her head toward you (librarianPresence.shushUntil, read by Librarian.tsx).
 *
 * When a pomodoro rings it writes the recap the "You showed up" card shows (store.ts); the XP
 * arrives later from session-complete (session.ts showSessionXp()).
 *
 * The judge demo (lib/demo) only shortens things: its 1-minute pomodoro counts someone nearby
 * after DEMO_COMPANION_MIN_MS, and its "Make Ms. Fenwick shush me" is shushNow() (her line and
 * head turn on request, outside her limits, which it leaves as they were).
 */

const LOOK_MS = 1000;
/** How long she keeps looking your way after a shush. */
const LOOK_AT_YOU_MS = 4500;

const seatsById = new Map<string, SeatSpot>(SEATS.map((s) => [s.id, s]));
const seatOf = (id: string | null | undefined) => (id ? seatsById.get(id) : undefined);

let limiter = freshLimiter();
let companions: CompanionLog = new Map();
let lastLine: string | null = null;

/** Real players in the room with the seat they're in (if any). */
function others() {
  const players = useRemotePlayers.getState().players;
  return [...remoteLive].map(([id, live]) => ({
    id,
    name: players[id]?.name ?? "Someone",
    seat: seatOf(live.seatId),
  }));
}

/** She's talking with someone (her panel), or already saying something. */
function librarianBusy() {
  const game = useGameStore.getState();
  return (
    game.librarianOpen ||
    game.phase !== "playing" ||
    librarianPresence.open ||
    isSpeaking() ||
    performance.now() < librarianPresence.speakUntil
  );
}

function context(p: PomodoroState): ShushContext {
  return { focusing: isFocusing(p), enabled: p.settings.fenwickShush, busy: librarianBusy() };
}

/** Ms. Fenwick shushes you: out loud (or mouthed, when muted), with the line as a caption. */
function shush(reason: ShushReason, now: number) {
  limiter = afterShush(limiter, now, reason);
  say(reason, now);
}

function say(reason: ShushReason, now: number) {
  const name = studentFirstName(useNet.getState().name, useProfileStore.getState().displayName);
  const line = shushLine(reason, name, Math.random(), lastLine);
  lastLine = line;
  librarianPresence.shushUntil = performance.now() + LOOK_AT_YOU_MS;
  useFocusStore.setState({ caption: { line, at: now } });
  void sayAloud(line);
}

/**
 * The judge demo's "Make Ms. Fenwick shush me": her drifting-off line now, in her voice (muted
 * mouths it) with the caption and her head turned your way. Not counted against her limits.
 * False when she's busy talking with someone (her panel is open, or she's mid-line).
 */
export function shushNow(): boolean {
  if (librarianBusy()) return false;
  say("drifted", Date.now());
  return true;
}

/** Sets only what changed (it's read by React and by the desk clock every frame). */
function publish(patch: {
  cameraOn: boolean;
  seenNow: boolean;
  percent: number | null;
  nearby: number;
}) {
  const s = useFocusStore.getState();
  if (
    s.cameraOn !== patch.cameraOn ||
    s.seenNow !== patch.seenNow ||
    s.percent !== patch.percent ||
    s.nearby !== patch.nearby
  )
    useFocusStore.setState(patch);
}

function look() {
  const now = Date.now();
  const p = usePomodoro.getState();
  const focusing = isFocusing(p);
  const camera = cameraCounts(useTrackingStore.getState().status);
  const seen = camera && faceSeen(faceState.params);
  const near = neighboursOf(seatOf(useGameStore.getState().seatId), others());
  if (focusing) {
    const counting =
      p.awaySince === null &&
      p.pausedRemaining === null &&
      typeof document !== "undefined" &&
      !document.hidden;
    const last = focusSession.tally.lastAt;
    const step = last === null ? 0 : Math.min(MAX_STEP_MS, Math.max(0, now - last));
    const tally = addLook(focusSession.tally, { at: now, counting, camera, seen });
    focusSession.tally = tally;
    if (counting) companions = addCompanionTime(companions, near, step);
    if (tally.seenNow) limiter = rearm(limiter);
    if (shouldShushDrift(limiter, missingMs(tally, now), now, context(p))) shush("drifted", now);
  }
  publish({
    cameraOn: focusing && camera,
    seenNow: focusing && seen,
    percent: focusing ? seenPercent(focusSession.tally) : null,
    nearby: near.length,
  });
}

/** A pomodoro rang: the recap for the "You showed up" card. */
function recap(s: PomodoroState, prev: PomodoroState) {
  const notice = s.notice;
  if (notice?.kind !== "focusDone") return;
  const lengthMs =
    prev.startedAt !== null && prev.endsAt !== null
      ? prev.endsAt - prev.startedAt
      : prev.settings.focusMinutes * 60_000;
  const presence = presencePayload(focusSession.tally, lengthMs / 1000);
  const ranMs = prev.startedAt !== null ? notice.at - prev.startedAt : lengthMs;
  useFocusStore.setState({
    recap: {
      at: notice.at,
      preview: notice.preview ? { seconds: Math.max(0, Math.round(ranMs / 1000)) } : null,
      count: notice.count,
      long: notice.breakPhase === "longBreak",
      minutes: Math.max(1, Math.round(lengthMs / 60_000)),
      presence,
      percent: presence ? Math.round((100 * presence.seenSeconds) / presence.cameraSeconds) : null,
      companions: companionNames(companions, isDemoOn() ? DEMO_COMPANION_MIN_MS : undefined),
      xp: undefined,
      pick: Math.random(),
    },
  });
}

/**
 * Starts watching (once a second) and listening to the table timer. Returns the stop. Call it
 * once while the library is open (PomodoroLayer does).
 */
export function startFocusWatch() {
  const clock = setInterval(look, LOOK_MS);
  const off = usePomodoro.subscribe((s, prev) => {
    if (isFocusing(s) && !isFocusing(prev)) {
      // A fresh pomodoro: a fresh tally, and she starts with a clean slate.
      focusSession.tally = addLook(emptyTally(), {
        at: Date.now(),
        counting: false,
        camera: false,
        seen: false,
      });
      limiter = freshLimiter();
      companions = new Map();
      useFocusStore.setState({ recap: null });
    }
    if (s.notice === prev.notice || !s.notice) return;
    if (s.notice.kind === "warned" && isFocusing(s)) {
      // Back in the tab just in time.
      const now = Date.now();
      if (mayShush(limiter, now, context(s))) shush("back", now);
    } else if (s.notice.kind === "focusDone" && isFocusing(prev)) {
      recap(s, prev);
    }
  });
  return () => {
    clearInterval(clock);
    off();
    librarianPresence.shushUntil = 0;
    useFocusStore.setState({
      cameraOn: false,
      seenNow: false,
      percent: null,
      nearby: 0,
      caption: null,
    });
  };
}
