"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { focusOnDesk, onSeatLockNudge, setTimerPanelOpen, standUp } from "@/lib/game/actions";
import { exitPointerLock, requestPointerLock } from "@/lib/game/pointer";
import {
  AWAY_GRACE_MS,
  BLIP_MS,
  POMODORO_LIMITS,
  type PomodoroNotice,
  type PomodoroSettings,
  type PomodoroState,
  type PresenceLog,
  clampSetting,
  formatClock,
  isFocusing,
  missedAwaySince,
  phaseProgress,
  remainingMs,
  todayCount,
  usePomodoro,
} from "@/lib/game/pomodoro";
import { playTimerAlarm, playTimerStart, playTimerTick } from "@/lib/game/sfx";
import { useGameStore } from "@/lib/game/store";
import { useProfileStore } from "@/lib/avatar/profile";
import { saveProfile, trackPomodoros } from "@/lib/learning/client";
import { XpToast } from "./XpToast";

/*
 * The table timer's side of the screen (the rules are in lib/game/pomodoro.ts; the tomato on the
 * table is drawn in the 3D scene from the same store). Browsers can't stop anyone switching tabs,
 * so instead leaving is noticed and costs the pomodoro, and the page does what it can to keep you
 * here: full screen, asking before it closes, and a nudge in the tab title.
 */

/**
 * A phase that ran out this long before anyone noticed (the library was closed) rings silently.
 * Generous, since a background tab's timers can run a minute late.
 */
const LATE_RING_MS = 3 * 60_000;
/** The "you're mid-pomodoro" toast shows at most this often. */
const SEAT_TOAST_MS = 2500;
const TOAST_MS = 5000;
/** "Pomodoro done" and "Break's over" step aside after this; the timer card keeps the news. */
const CARD_MS = 30_000;

const TITLE_RUNNING = "🍅 Come back — your pomodoro is running";
const TITLE_WAITING = "🍅 Come back — your pomodoro is waiting";
const TITLE_LOST = "🍅 Pomodoro lost";

const TOMATO = "#d64535";
const FOCUS_RING =
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember";
const KBD_SM = "kbd !h-5 !min-w-5 !px-1 !text-[0.65rem]";
const CARD =
  "pointer-events-auto rounded-3xl bg-cream/90 text-ink shadow-[0_20px_50px_-24px_rgb(20_12_6/0.65)] ring-1 ring-ink/10 backdrop-blur";
const PRIMARY = `flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-cream shadow transition hover:bg-wood-dark ${FOCUS_RING}`;
const PLAIN = `flex items-center justify-center gap-2 rounded-full bg-parchment px-4 py-2.5 text-sm font-bold ring-1 ring-ink/10 transition hover:ring-ink/30 ${FOCUS_RING}`;
const SECONDARY = `${PLAIN} text-ink`;
const SMALL_BASE = `flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-extrabold transition ${FOCUS_RING}`;
const SMALL = `${SMALL_BASE} ring-1 ring-ink/15 hover:bg-ink/5`;
const SMALL_DARK = `${SMALL_BASE} bg-ink text-cream shadow hover:bg-wood-dark`;
const ICON = `grid h-8 w-8 shrink-0 place-items-center rounded-full ring-1 ring-ink/15 transition hover:bg-ink/5 ${FOCUS_RING}`;

/* ------------------------------------------------------------------ */
/* Full screen and the pause menu                                      */
/* ------------------------------------------------------------------ */

/** Until when the mouse being let go is our own full-screen switch, not the player pausing. */
let hushUntil = 0;
/** We put the page in full screen for this pomodoro, so we take it out again at the end. */
let screenLocked = false;

function hushPause(ms = 1500) {
  hushUntil = Math.max(hushUntil, Date.now() + ms);
}

type KeyboardLock = { lock?: (codes?: string[]) => Promise<void>; unlock?: () => void };
const keyboardLock = () => (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;

/** Captures the mouse again for looking around, unless Shift is holding it free. */
function recapture() {
  if (!useGameStore.getState().cursorFree) requestPointerLock({ quiet: true });
}

/**
 * Settles in for a pomodoro: full screen (with Esc held where the browser allows it, so a single
 * press doesn't drop out; holding it still does), then the mouse captured again, since the switch
 * can release it. Must run inside the click or key press that started the pomodoro.
 */
function settleIn(fullScreen: boolean) {
  if (!fullScreen || !document.fullscreenEnabled || document.fullscreenElement) return recapture();
  hushPause(2500);
  document.documentElement
    .requestFullscreen({ navigationUI: "hide" })
    .then(() => {
      screenLocked = true;
      hushPause();
      // It may have ended while the browser was switching.
      if (!isFocusing(usePomodoro.getState())) return releaseScreen();
      keyboardLock()
        ?.lock?.(["Escape"])
        ?.catch(() => {});
      recapture();
    })
    .catch(recapture);
}

/** Out of the pomodoro's full screen, if we put the page there and it still is. */
function releaseScreen() {
  if (!screenLocked) return;
  screenLocked = false;
  keyboardLock()?.unlock?.();
  if (document.fullscreenElement === document.documentElement) {
    hushPause();
    void document.exitFullscreen().catch(() => {});
  }
}

/**
 * Starts a pomodoro at your table (the button or P). Call it straight from the click or key press:
 * browsers only allow full screen and capturing the mouse during one.
 */
export function startPomodoro() {
  const pomodoro = usePomodoro.getState();
  if (!useGameStore.getState().seatId || pomodoro.phase !== "idle") return false;
  pomodoro.startFocus();
  focusOnDesk();
  playTimerStart();
  settleIn(pomodoro.settings.screenLock);
  return true;
}

/* ------------------------------------------------------------------ */
/* Back: leaving the library without unloading the page                */
/* ------------------------------------------------------------------ */

/** Marks the history entry that catches Back during a pomodoro. */
const BACK_GUARD = "ovrPomodoroBackGuard";
/** The page is on its Back guard entry. */
let onBackGuard = false;

const isBackGuard = (state: unknown) =>
  (state as Record<string, unknown> | null)?.[BACK_GUARD] === true;

/** Puts the guard on top of this page's history entry (unless it's there, or nothing's behind). */
function armBackGuard() {
  if (onBackGuard || history.length < 2) return;
  // Next.js's own state comes along, so its router takes the extra entry for this same page.
  history.pushState({ ...history.state, [BACK_GUARD]: true }, "", location.href);
  onBackGuard = true;
}

/** Goes where a caught Back was going: past the guard and the entry under it. */
function backPastGuard() {
  history.go(onBackGuard ? -2 : -1);
}

/**
 * Back (the button, Cmd+[, a mouse's back button, a trackpad swipe) leaves the library without
 * unloading the page, so "Leave site?" never asks. So while a pomodoro runs, a copy of this page's
 * history entry sits on top: Back only steps down onto the one under it, `onBack` asks, and the
 * guard goes straight back on. A guard left over from an earlier pomodoro is stepped past, so Back
 * still takes one press.
 */
function useBackGuard(onBack: () => void) {
  useEffect(() => {
    const here = location.pathname;
    onBackGuard = isBackGuard(history.state);
    const sync = (focusing: boolean) => {
      if (focusing) armBackGuard();
      // Chrome's two-finger swipe back starts as a sideways overscroll; none while focusing.
      const overscroll = focusing ? "none" : "";
      document.documentElement.style.overscrollBehaviorX = overscroll;
      document.body.style.overscrollBehaviorX = overscroll;
    };
    const onPop = (e: PopStateEvent) => {
      const wasOnGuard = onBackGuard;
      onBackGuard = isBackGuard(e.state);
      // Only a step back off the guard, onto this page: a jump further back can't be caught.
      if (!wasOnGuard || onBackGuard || location.pathname !== here) return;
      if (!isFocusing(usePomodoro.getState())) return history.back();
      armBackGuard();
      onBack();
    };
    sync(isFocusing(usePomodoro.getState()));
    const offPhase = usePomodoro.subscribe((s, prev) => {
      if (isFocusing(s) !== isFocusing(prev)) sync(isFocusing(s));
    });
    window.addEventListener("popstate", onPop);
    return () => {
      offPhase();
      window.removeEventListener("popstate", onPop);
      sync(false);
    };
  }, [onBack]);
}

/* ------------------------------------------------------------------ */
/* Director: the clock, leaving the tab, sounds                        */
/* ------------------------------------------------------------------ */

/**
 * Runs the clock and holds you in the tab while a pomodoro runs: notices you leaving and coming
 * back, asks before the page closes, nudges from the tab title while you're away, keeps our own
 * full-screen switches from pausing the game, and plays the timer's sounds.
 */
function PomodoroDirector() {
  useEffect(() => {
    /** What the page has seen of you; a leave is reported once it's clearly more than a blip. */
    const presence: PresenceLog = {
      leftAt: null,
      reported: false,
      checkedAt: Date.now(),
      askedAt: -Infinity,
    };
    let unlockedAt = 0;
    /** When letting go of the mouse last opened the pause menu. */
    let autoPausedAt = -Infinity;
    let savedTitle: string | null = null;

    const awayNow = () => document.hidden || !document.hasFocus();
    /**
     * Leaving the tab lets go of the mouse, which pauses the game; mid-pomodoro you come back to
     * the timer (and what it has to say) instead of a pause menu over it.
     */
    const unpauseForTimer = (now: number) => {
      const game = useGameStore.getState();
      if (game.menuOpen && now - autoPausedAt < 1000) game.setMenuOpen(false);
    };

    const nudgeTitle = (text: string | null) => {
      if (text === null) {
        if (savedTitle !== null) document.title = savedTitle;
        savedTitle = null;
        return;
      }
      savedTitle ??= document.title;
      if (document.title !== text) document.title = text;
    };

    /** Tells the timer you've been away since `at` (no earlier than the pomodoro began). */
    const report = (at: number) => {
      const p = usePomodoro.getState();
      presence.leftAt ??= at;
      presence.reported = true;
      p.away(Math.max(at, p.startedAt ?? at));
    };

    const watch = (now: number) => {
      const p = usePomodoro.getState();
      if (!awayNow()) {
        presence.leftAt = null;
        if (presence.reported) {
          presence.reported = false;
          p.back(now);
        }
      } else if (now >= hushUntil) {
        if (presence.leftAt === null && isFocusing(p)) unpauseForTimer(now);
        presence.leftAt ??= now;
        if (!presence.reported && isFocusing(p) && now - presence.leftAt >= BLIP_MS)
          report(presence.leftAt);
      }
      const s = usePomodoro.getState();
      nudgeTitle(
        !presence.reported
          ? null
          : isFocusing(s)
            ? s.settings.strict
              ? TITLE_RUNNING
              : TITLE_WAITING
            : s.notice?.kind === "voided"
              ? TITLE_LOST
              : null,
      );
    };

    // A leave the page saw start (or slept through) is reported before the clock moves on, so a
    // pomodoro the computer slept through doesn't ring as done. Coming back is only noticed after
    // the clock has moved on: strict time away counts up to the bell, so one that rang while you
    // were briefly away comes back as rung, not as "you were away too long".
    const loop = () => {
      const now = Date.now();
      if (isFocusing(usePomodoro.getState())) {
        const since = missedAwaySince(presence, now);
        if (since !== null) report(since);
      }
      presence.checkedAt = now;
      const before = usePomodoro.getState();
      const late =
        before.pausedRemaining === null &&
        before.endsAt !== null &&
        now - before.endsAt > LATE_RING_MS;
      before.tick(now);
      // The bell rings for every phase that ends, even if you've stood up for your break.
      if (usePomodoro.getState().rings !== before.rings && !late) playTimerAlarm();
      watch(now);
    };
    const clock = setInterval(loop, 250);
    const ticking = setInterval(() => {
      const s = usePomodoro.getState();
      if (isFocusing(s) && s.settings.ticking && s.pausedRemaining === null && !document.hidden)
        playTimerTick();
    }, 1000);

    const onPresence = () => loop();
    const onPageHide = () => {
      if (isFocusing(usePomodoro.getState()) && !presence.reported) report(Date.now());
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isFocusing(usePomodoro.getState())) return;
      // The browser asks "Leave site?" (it shows its own wording).
      presence.askedAt = Date.now();
      e.preventDefault();
      e.returnValue = "";
    };
    const onFullscreenChange = () => {
      // Left full screen some other way (holding Esc): nothing to undo at the end.
      if (!document.fullscreenElement && screenLocked) {
        screenLocked = false;
        keyboardLock()?.unlock?.();
      }
    };

    // CameraRig pauses whenever the mouse is let go: not when our own full-screen switch did it,
    // nor (see unpauseForTimer) when leaving the tab mid-pomodoro did.
    const offMenu = useGameStore.subscribe((s, prev) => {
      const now = Date.now();
      if (prev.pointerLocked && !s.pointerLocked) unlockedAt = now;
      if (!s.menuOpen || prev.menuOpen || now - unlockedAt > 100) return;
      autoPausedAt = now;
      if (now < hushUntil || (isFocusing(usePomodoro.getState()) && awayNow()))
        s.setMenuOpen(false);
    });
    const offPhase = usePomodoro.subscribe((s, prev) => {
      if (isFocusing(prev) && !isFocusing(s)) releaseScreen();
    });

    document.addEventListener("visibilitychange", onPresence);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("blur", onPresence);
    window.addEventListener("focus", onPresence);
    window.addEventListener("pageshow", onPresence);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      clearInterval(clock);
      clearInterval(ticking);
      offMenu();
      offPhase();
      document.removeEventListener("visibilitychange", onPresence);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("blur", onPresence);
      window.removeEventListener("focus", onPresence);
      window.removeEventListener("pageshow", onPresence);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      releaseScreen();
      nudgeTitle(null);
    };
  }, []);
  return null;
}

/* ------------------------------------------------------------------ */
/* Layer                                                               */
/* ------------------------------------------------------------------ */

/**
 * Sends this player's pomodoros to learning analytics (the server validates and scores them) and
 * keeps their leaderboard name in step with their character's name.
 */
function LearningTracker() {
  const displayName = useProfileStore((s) => s.displayName);
  useEffect(() => trackPomodoros(), []);
  useEffect(() => {
    if (displayName) void saveProfile({ displayName });
  }, [displayName]);
  return null;
}

/**
 * The table timer on screen: the timer card (top centre, under the HUD's top row), its toasts,
 * the centred notices and the "Leave the table?" / "Leave the library?" dialog. Mounted outside
 * the 3D canvas.
 */
export function PomodoroLayer() {
  const ready = useGameStore((s) => s.ready);
  const playing = useGameStore((s) => s.phase === "playing");
  const walkFast = useGameStore((s) => s.walkFast);
  const focusing = usePomodoro(isFocusing);
  const cardNotice = usePomodoro((s) => noticeView(s.notice) === "card");
  const [leaving, setLeaving] = useState<LeaveFrom | null>(null);
  const closeLeave = useCallback(() => setLeaving(null), []);
  // The dialog only means something mid-pomodoro (it may ring while the dialog is up).
  if (leaving !== null && !focusing) setLeaving(null);

  const leaveTable = () => {
    if (isFocusing(usePomodoro.getState())) setLeaving("table");
    else standUp();
  };
  const askLeaveLibrary = useCallback(() => {
    // The dialog wants the mouse; letting it go here isn't the player pausing.
    hushPause();
    exitPointerLock();
    setLeaving("library");
  }, []);
  useBackGuard(askLeaveLibrary);

  return (
    <>
      <PomodoroDirector />
      <LearningTracker />
      <XpToast />
      {ready && playing && (
        <>
          {/* Top left, under the zone name (and the "Walking faster" chip): the middle of the view
              is your desk, where the 3D timer sits. */}
          <div
            className={`pointer-events-none absolute left-4 z-[11] flex w-[24rem] max-w-[calc(100%-2rem)] flex-col gap-2 ${walkFast ? "top-[7.25rem]" : "top-20"}`}
          >
            <TimerCard compact={cardNotice} onLeave={leaveTable} />
            <Toasts />
          </div>
          <NoticeCard />
          {leaving !== null && <LeaveDialog from={leaving} onClose={closeLeave} />}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Timer card                                                          */
/* ------------------------------------------------------------------ */

/** The current time, refreshed every `ms` (the store keeps timestamps, so clocks poll). */
function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function useFullscreen() {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  return full;
}

/**
 * Time left, never more than the running phase's own length (the clock can lag the store by a
 * frame). Its own, not the settings': a break's length can change while it runs.
 */
function clockOf(s: PomodoroState, now: number) {
  const left = remainingMs(s, now);
  if (s.startedAt === null || s.endsAt === null) return formatClock(left);
  return formatClock(Math.min(left, s.endsAt - s.startedAt));
}

/** Pomodoros finished in this set, as the tomatoes show them. */
function doneInSet(s: Pick<PomodoroState, "phase" | "inSet" | "settings">) {
  const every = s.settings.longBreakEvery;
  // A long break is the set complete; inSet only goes back to 0 when it ends. Lowering the
  // interval mid-set can leave more done than the set holds: the next one then ends the set.
  return s.phase === "longBreak" ? every : Math.min(s.inSet, every - 1);
}

function TimerCard({ compact, onLeave }: { compact: boolean; onLeave: () => void }) {
  const s = usePomodoro();
  const seated = useGameStore((g) => !!g.seatId);
  const locked = useGameStore((g) => g.pointerLocked);
  const now = useNow();
  const full = useFullscreen();
  const [canFill] = useState(() => document.fullscreenEnabled);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const hidden = !seated && s.phase === "idle";
  // Clicking back into the view to look around puts the settings away, as does the card going
  // (a break ending after you stood up); open, they'd keep holding the keys and the mouse.
  const [wasLocked, setWasLocked] = useState(locked);
  if (locked !== wasLocked) {
    setWasLocked(locked);
    if (locked) setSettingsOpen(false);
  }
  if (hidden && settingsOpen) setSettingsOpen(false);
  useEffect(() => {
    if (!settingsOpen) return;
    setTimerPanelOpen("settings", true);
    return () => setTimerPanelOpen("settings", false);
  }, [settingsOpen]);

  if (hidden) return null;

  const focusing = isFocusing(s);
  const onBreak = s.phase === "shortBreak" || s.phase === "longBreak";
  const done = doneInSet(s);
  const label =
    s.phase === "shortBreak"
      ? "Short break"
      : s.phase === "longBreak"
        ? "Long break"
        : `${focusing ? "Focus" : "Ready"} · pomodoro ${done + 1} of ${s.settings.longBreakEvery}`;
  const openSettings = () => {
    exitPointerLock();
    setSettingsOpen(true);
  };
  const gear = (
    <button
      type="button"
      onClick={openSettings}
      aria-label="Timer settings"
      aria-expanded={settingsOpen}
      title="Timer settings"
      className={ICON}
    >
      <GearIcon />
    </button>
  );
  const hint = locked && (
    <p className="mt-2 flex items-center justify-center gap-1 text-[0.7rem] font-bold text-ink-soft">
      Hold <span className={KBD_SM}>Shift</span> to click
    </p>
  );

  if (settingsOpen) {
    return (
      <section aria-label="Table timer" className={`${CARD} w-[24rem] max-w-full p-4`}>
        <TimerSettings onDone={closeSettings} />
      </section>
    );
  }

  if (!compact && seated && s.phase === "idle") {
    return (
      <section
        aria-label="Table timer"
        className={`${CARD} w-[24rem] max-w-full p-4 transition duration-300 ease-out starting:-translate-y-2 starting:opacity-0`}
      >
        <header className="flex items-center gap-3">
          <TomatoMark className="h-9 w-9 shrink-0" shake />
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-extrabold tracking-wide text-[#c23b2c] uppercase">
              Table timer
            </p>
            <p className="text-xs font-bold text-ink-soft">The Pomodoro method</p>
          </div>
          {gear}
        </header>
        <div className="mt-3 flex items-end gap-3">
          <p role="timer" className="font-display text-5xl leading-none font-semibold tabular-nums">
            {clockOf(s, now)}
          </p>
          <p className="pb-0.5 text-xs leading-snug text-ink-soft">
            of focus, then a {s.settings.shortBreakMinutes}-minute break. Stay at the table and in
            this tab until it rings.
          </p>
        </div>
        <TaskInput />
        <SetRow s={s} now={now} />
        <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
          <button
            type="button"
            onClick={() => startPomodoro()}
            aria-keyshortcuts="P"
            className={PRIMARY}
          >
            <span className={KBD_SM}>P</span>
            Start focus
          </button>
          <button type="button" onClick={onLeave} className={SECONDARY}>
            Leave table
          </button>
        </div>
        {hint}
      </section>
    );
  }

  const progress = phaseProgress(s, now);
  return (
    <section
      aria-label="Table timer"
      className={`${CARD} w-[24rem] max-w-full px-4 pt-3 pb-3.5 transition duration-300 ease-out starting:-translate-y-2 starting:opacity-0`}
    >
      <div className="flex items-center gap-3">
        <TomatoMark className="h-8 w-8 shrink-0" shake />
        <div className="min-w-0 flex-1">
          <p
            className={`text-[0.68rem] font-extrabold tracking-wide uppercase ${onBreak ? "text-sage-dark" : "text-[#c23b2c]"}`}
          >
            {label}
          </p>
          <p className="truncate text-sm font-bold">
            {onBreak
              ? "Stand up, stretch, look away from the screen"
              : s.task || (focusing ? "Focus time" : "Ready when you are")}
          </p>
        </div>
        <p
          role="timer"
          className="font-display text-[2rem] leading-none font-semibold tabular-nums"
        >
          {clockOf(s, now)}
        </p>
      </div>
      {s.phase !== "idle" && (
        <div
          role="progressbar"
          aria-label={`${label} progress`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}
          className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-ink/10"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ease-linear ${onBreak ? "bg-sage" : "bg-[#d64535]"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <SetRow s={s} now={now} inline />
        <span className="ml-auto flex items-center gap-2">
          {s.phase === "idle" && seated && (
            <button
              type="button"
              onClick={() => startPomodoro()}
              aria-keyshortcuts="P"
              className={SMALL_DARK}
            >
              <span className={KBD_SM}>P</span>
              Start
            </button>
          )}
          {onBreak && (
            <button
              type="button"
              onClick={() => {
                const p = usePomodoro.getState();
                p.skipBreak();
                // Skipping is its own answer; no "break's over" card for it.
                p.dismissNotice();
              }}
              className={SMALL}
            >
              Skip break
            </button>
          )}
          {focusing && seated && s.settings.screenLock && canFill && !full && (
            <button
              type="button"
              onClick={() => settleIn(true)}
              aria-label="Back to full screen"
              title="Back to full screen"
              className={ICON}
            >
              <ExpandIcon />
            </button>
          )}
          {gear}
          {seated && (
            <button
              type="button"
              onClick={onLeave}
              title={focusing ? "Ends this pomodoro early (it won't count)" : undefined}
              className={SMALL}
            >
              Leave table
            </button>
          )}
        </span>
      </div>
      {hint}
    </section>
  );
}

/** Step 1 of the method: name the task. Fixed once the pomodoro starts. */
function TaskInput() {
  const task = usePomodoro((s) => s.task);
  const setTask = usePomodoro((s) => s.setTask);
  return (
    <label className="mt-3 block">
      <span className="sr-only">What are you working on?</span>
      <input
        value={task}
        maxLength={80}
        placeholder="What are you working on?"
        onChange={(e) => setTask(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== "Escape") return;
          // Marked handled so Esc doesn't also open the pause menu.
          e.preventDefault();
          e.currentTarget.blur();
        }}
        className="w-full rounded-xl bg-parchment px-3 py-2 text-sm font-bold text-ink ring-1 ring-ink/10 outline-none placeholder:font-semibold placeholder:text-ink-soft/70 focus:ring-2 focus:ring-ember"
      />
    </label>
  );
}

/** The set as tomatoes (filled = done) and today's tally. */
function SetRow({ s, now, inline = false }: { s: PomodoroState; now: number; inline?: boolean }) {
  const every = s.settings.longBreakEvery;
  const done = doneInSet(s);
  const today = todayCount(s, now);
  return (
    <div className={`flex items-center gap-2 ${inline ? "" : "mt-3"}`}>
      <span
        role="img"
        aria-label={`${done} of ${every} pomodoros done in this set; a long break after ${every}`}
        className="flex items-center gap-0.5"
      >
        {Array.from({ length: every }, (_, i) => (
          <TomatoMark
            key={i}
            empty={i >= done}
            className={`h-4 w-4 ${i === done && isFocusing(s) ? "animate-pulse" : ""}`}
          />
        ))}
      </span>
      <span className="text-xs font-bold text-ink-soft">{today} today</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

function TimerSettings({ onDone }: { onDone: () => void }) {
  const settings = usePomodoro((s) => s.settings);
  const focusing = usePomodoro(isFocusing);
  const update = (change: Partial<PomodoroSettings>) =>
    usePomodoro.getState().updateSettings(change);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    // Esc closes the settings (not the game: marked handled before the pause menu hears it).
    // With the pause menu or My Progress open over them, Esc is theirs.
    const onKey = (e: KeyboardEvent) => {
      const game = useGameStore.getState();
      if (e.key !== "Escape" || game.menuOpen || game.progressOpen) return;
      e.preventDefault();
      onDone();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDone]);

  const minutes = (n: number) => `${n} min`;
  return (
    <div ref={panel}>
      <header className="flex items-center gap-3">
        <TomatoMark className="h-7 w-7 shrink-0" />
        <h2 className="flex-1 font-display text-lg font-semibold">Timer settings</h2>
        <button type="button" onClick={onDone} className={SMALL_DARK}>
          Done
        </button>
      </header>
      <div className="mt-3 space-y-1.5">
        <Stepper setting="focusMinutes" label="Pomodoro" format={minutes} fixed={focusing} />
        <Stepper setting="shortBreakMinutes" label="Short break" format={minutes} />
        <Stepper setting="longBreakMinutes" label="Long break" format={minutes} />
        <Stepper
          setting="longBreakEvery"
          label="Long break every"
          format={(n) => `${n} pomodoros`}
        />
      </div>
      <div className="mt-3 space-y-0.5 border-t border-ink/10 pt-2">
        <Toggle
          label="Strict"
          hint={`Leaving the tab for more than ${AWAY_GRACE_MS / 1000} s voids the pomodoro. Off: the timer waits while you're away.`}
          checked={settings.strict}
          fixed={focusing}
          onChange={(strict) => update({ strict })}
        />
        <Toggle
          label="Ticking sound"
          hint="A soft tick each second while you focus."
          checked={settings.ticking}
          onChange={(ticking) => update({ ticking })}
        />
        <Toggle
          label="Full screen"
          hint="Go full screen while a pomodoro runs, so nothing else is in sight."
          checked={settings.screenLock}
          onChange={(screenLock) => update({ screenLock })}
        />
      </div>
      {focusing && (
        <p className="mt-2 rounded-xl bg-parchment px-3 py-2 text-xs text-ink-soft">
          The pomodoro&apos;s length and Strict stay as they are until it ends: a pomodoro keeps the
          rules it started with.
        </p>
      )}
    </div>
  );
}

function Stepper({
  setting,
  label,
  format,
  fixed = false,
}: {
  setting: keyof typeof POMODORO_LIMITS;
  label: string;
  format: (n: number) => string;
  fixed?: boolean;
}) {
  const value = usePomodoro((s) => s.settings[setting]);
  const [min, max, step] = POMODORO_LIMITS[setting];
  const change = (delta: number) => {
    const next: Partial<PomodoroSettings> = {};
    next[setting] = clampSetting(setting, value + delta);
    usePomodoro.getState().updateSettings(next);
  };
  const button = `grid h-7 w-7 place-items-center rounded-full text-base leading-none font-extrabold ring-1 ring-ink/15 transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent ${FOCUS_RING}`;
  return (
    <div role="group" aria-label={label} className="flex items-center justify-between gap-3">
      <span className={`text-sm font-extrabold ${fixed ? "text-ink-soft" : ""}`}>{label}</span>
      <span className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={`${label}: less`}
          disabled={fixed || value <= min}
          onClick={() => change(-step)}
          className={button}
        >
          −
        </button>
        <output aria-live="polite" className="w-24 text-center text-sm font-bold tabular-nums">
          {format(value)}
        </output>
        <button
          type="button"
          aria-label={`${label}: more`}
          disabled={fixed || value >= max}
          onClick={() => change(step)}
          className={button}
        >
          +
        </button>
      </span>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  fixed = false,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  fixed?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={fixed}
      onClick={() => onChange(!checked)}
      className={`flex w-full items-start gap-3 rounded-xl px-2 py-1.5 text-left transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent ${FOCUS_RING}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold">{label}</span>
        <span className="block text-xs leading-snug text-ink-soft">{hint}</span>
      </span>
      <span
        aria-hidden
        className={`mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition ${checked ? "bg-sage" : "bg-ink/20"}`}
      >
        <span
          className={`h-4 w-4 rounded-full bg-cream shadow transition ${checked ? "translate-x-4" : ""}`}
        />
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Leaving the table or the library                                    */
/* ------------------------------------------------------------------ */

type LeaveFrom = "table" | "library";

/** Keeps Tab on the dialog's own buttons (the HUD's are underneath). */
function trapTab(box: HTMLElement, e: KeyboardEvent) {
  const all = [...box.querySelectorAll<HTMLElement>("button")];
  if (all.length === 0) return;
  const at = all.indexOf(document.activeElement as HTMLElement);
  const to = e.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : (at + 1) % all.length;
  e.preventDefault();
  all[to]?.focus();
}

/**
 * "Leave the table?" (the card's Leave table, the one way out of your seat) or "Leave the
 * library?" (Back) mid-pomodoro. Either costs the pomodoro.
 */
function LeaveDialog({ from, onClose }: { from: LeaveFrom; onClose: () => void }) {
  const s = usePomodoro();
  const now = useNow();
  const box = useRef<HTMLDivElement>(null);

  const keep = () => {
    onClose();
    recapture();
  };
  const leave = () => {
    usePomodoro.getState().abandon(from === "table" ? "left-table" : "left-library");
    onClose();
    if (from === "library") return backPastGuard();
    standUp();
    recapture();
  };

  useEffect(() => {
    setTimerPanelOpen("leave", true);
    box.current?.querySelector<HTMLElement>("button")?.focus();
    // Capture phase, so Esc is handled before the pause menu hears it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "Tab" && box.current) {
        trapTab(box.current, e);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      setTimerPanelOpen("leave", false);
    };
  }, [onClose]);

  return (
    <div
      className="studio-fade-in absolute inset-0 z-[24] grid place-items-center bg-ink/40 p-4 backdrop-blur-[3px]"
      onMouseDown={(e) => e.target === e.currentTarget && keep()}
    >
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-desc"
        className="w-full max-w-sm rounded-3xl bg-cream p-6 text-ink shadow-[0_30px_80px_-20px_rgb(20_12_6/0.6)] ring-1 ring-ink/10 transition duration-300 ease-out starting:translate-y-3 starting:opacity-0"
      >
        <TomatoMark className="h-10 w-10" />
        <h2 id="leave-title" className="mt-3 font-display text-2xl font-semibold">
          {from === "table" ? "Leave the table?" : "Leave the library?"}
        </h2>
        <p id="leave-desc" className="mt-2 text-[0.95rem] text-ink-soft">
          <strong className="font-extrabold text-ink tabular-nums">{clockOf(s, now)} left.</strong>{" "}
          In the Pomodoro method a pomodoro can&apos;t be split — this one won&apos;t count.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button type="button" onClick={keep} className={PRIMARY}>
            Keep focusing
          </button>
          <button type="button" onClick={leave} className={`${PLAIN} text-[#b5352b]`}>
            Leave &amp; void
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Notices                                                             */
/* ------------------------------------------------------------------ */

/**
 * How each notice is shown: news that needs an answer gets a centred card; a word in passing gets
 * a toast. Leaving the table was confirmed already, and a skipped break is its own answer.
 */
function noticeView(n: PomodoroNotice | null): "card" | "toast" | null {
  if (!n) return null;
  if (n.kind === "warned" || n.kind === "paused") return "toast";
  if (n.kind === "voided") return n.reason === "left-table" ? "toast" : "card";
  if (n.kind === "breakDone" && n.skipped) return null;
  return "card";
}

/** "6 s", "1m 23s". */
function formatAway(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  return s % 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s / 60}m`;
}

/**
 * A strict pomodoro usually goes void the moment the grace runs out, while you're still away; the
 * full time is only known when it went void as you came back.
 */
function leftTabText(awayMs: number) {
  const grace = AWAY_GRACE_MS / 1000;
  return awayMs > AWAY_GRACE_MS + 1500
    ? `You left the tab for ${formatAway(awayMs)} (the limit is ${grace} s).`
    : `You left the tab for more than ${grace} seconds.`;
}

function toastText(n: PomodoroNotice) {
  const grace = AWAY_GRACE_MS / 1000;
  if (n.kind === "warned")
    return `You left for ${formatAway(n.awayMs)} — stay with it. Over ${grace} s and a pomodoro won't count.`;
  if (n.kind === "paused")
    return `Welcome back — your pomodoro waited ${formatAway(n.awayMs)} for you.`;
  return "Pomodoro ended early — it won't count. Start a fresh one whenever you're ready.";
}

/** Small messages under the timer card: a notice in passing, and "you're mid-pomodoro". */
function Toasts() {
  const notice = usePomodoro((s) => s.notice);
  const toast = noticeView(notice) === "toast" ? notice : null;
  const seatLockAt = useSeatLockToast();

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      const p = usePomodoro.getState();
      if (p.notice === toast) p.dismissNotice();
    }, TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div role="status" className="flex w-[24rem] max-w-full flex-col items-center gap-2">
      {toast && (
        <p
          key={toast.at}
          className="rounded-2xl bg-ink/90 px-4 py-2.5 text-center text-sm font-bold text-cream shadow-xl backdrop-blur transition duration-300 ease-out starting:-translate-y-2 starting:opacity-0"
        >
          {toastText(toast)}
        </p>
      )}
      {seatLockAt !== null && (
        <p
          key={seatLockAt}
          className="rounded-2xl bg-ink/90 px-4 py-2.5 text-center text-sm font-bold text-cream shadow-xl backdrop-blur transition duration-300 ease-out starting:-translate-y-2 starting:opacity-0"
        >
          You&apos;re mid-pomodoro 🍅 Stay put until it rings —{" "}
          <span className="text-lamp">Leave table</span> ends it early, and it won&apos;t count.
        </p>
      )}
    </div>
  );
}

/** When the "you're mid-pomodoro" toast last appeared (null: not showing). */
function useSeatLockToast() {
  const [shownAt, setShownAt] = useState<number | null>(null);
  useEffect(
    () =>
      onSeatLockNudge(() => {
        const now = Date.now();
        setShownAt((at) => (at !== null && now - at < SEAT_TOAST_MS ? at : now));
      }),
    [],
  );
  useEffect(() => {
    if (shownAt === null) return;
    const t = setTimeout(() => setShownAt(null), SEAT_TOAST_MS + 500);
    return () => clearTimeout(t);
  }, [shownAt]);
  return shownAt;
}

/** The centred card: a pomodoro that didn't count, a pomodoro done, a break over. */
function NoticeCard() {
  const notice = usePomodoro((s) => s.notice);
  const card = noticeView(notice) === "card" ? notice : null;

  useEffect(() => {
    if (!card || card.kind === "voided") return;
    const t = setTimeout(() => {
      const p = usePomodoro.getState();
      if (p.notice === card) p.dismissNotice();
    }, CARD_MS);
    return () => clearTimeout(t);
  }, [card]);

  if (!card) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[16] grid place-items-center p-4">
      <NoticeBody key={card.at} notice={card} />
    </div>
  );
}

function NoticeBody({ notice }: { notice: PomodoroNotice }) {
  const s = usePomodoro();
  const seated = useGameStore((g) => !!g.seatId);
  const locked = useGameStore((g) => g.pointerLocked);
  const dismiss = s.dismissNotice;
  const { shortBreakMinutes, longBreakMinutes, longBreakEvery } = s.settings;

  let eyebrow: string;
  let title: string;
  let body: React.ReactNode;
  let actions: React.ReactNode;
  const startButton = (text: string) =>
    seated ? (
      <button
        type="button"
        onClick={() => startPomodoro()}
        aria-keyshortcuts="P"
        className={PRIMARY}
      >
        <span className={KBD_SM}>P</span>
        {text}
      </button>
    ) : null;

  if (notice.kind === "voided") {
    eyebrow = "Pomodoro void";
    title = "That pomodoro didn't count";
    body = (
      <>
        <p>
          {notice.reason === "left-tab"
            ? leftTabText(notice.awayMs)
            : notice.reason === "left-library"
              ? "You left the library before it rang."
              : "You left the table before it rang."}
        </p>
        <p className="mt-2">
          A pomodoro can&apos;t be paused or split: if it&apos;s interrupted, it doesn&apos;t count.
          Start a fresh one when you&apos;re ready.
        </p>
        {notice.reason === "left-tab" && (
          <p className="mt-2 text-xs">
            Rather have it wait for you? Turn off Strict in the timer settings.
          </p>
        )}
      </>
    );
    actions = (
      <>
        {startButton("Start a new pomodoro")}
        <button type="button" onClick={dismiss} className={SECONDARY}>
          {seated ? "Not now" : "Got it"}
        </button>
      </>
    );
  } else if (notice.kind === "focusDone") {
    const long = notice.breakPhase === "longBreak";
    eyebrow = long ? "Set complete" : "Ding!";
    title = `Pomodoro ${notice.count} done 🍅`;
    body = long ? (
      <p>
        That&apos;s {longBreakEvery} in a row. Take a {longBreakMinutes}-minute long break — walk
        around, get some water, rest your eyes.
      </p>
    ) : (
      <p>
        Time for a {shortBreakMinutes}-minute break — stand up, stretch, look away from the screen.
      </p>
    );
    actions = (
      <>
        <button type="button" onClick={dismiss} className={PRIMARY}>
          Enjoy the break
        </button>
        <button
          type="button"
          onClick={() => {
            s.skipBreak();
            dismiss();
          }}
          className={SECONDARY}
        >
          Skip break
        </button>
      </>
    );
  } else {
    eyebrow = "Break's over";
    const next = doneInSet(s) + 1;
    title = next === 1 ? "Ready for a fresh set?" : `Ready for pomodoro ${next}?`;
    body = seated ? (
      <p>Pick up where you left off — the next pomodoro starts when you say so.</p>
    ) : (
      <p>Sit at a table to start the next pomodoro.</p>
    );
    actions = (
      <>
        {startButton("Start focus")}
        <button type="button" onClick={dismiss} className={SECONDARY}>
          {seated ? "Not yet" : "Got it"}
        </button>
      </>
    );
  }

  return (
    <section
      role={notice.kind === "voided" ? "alert" : "status"}
      aria-labelledby="pomodoro-notice-title"
      className={`${CARD} w-[26rem] max-w-full p-6 transition duration-300 ease-out starting:scale-95 starting:opacity-0`}
    >
      <div className="flex items-center gap-3">
        <TomatoMark
          className={`h-11 w-11 shrink-0 ${notice.kind === "voided" ? "opacity-45 grayscale-[0.6]" : ""}`}
        />
        <div className="min-w-0">
          <p
            className={`text-[0.7rem] font-extrabold tracking-wide uppercase ${notice.kind === "breakDone" ? "text-sage-dark" : "text-[#c23b2c]"}`}
          >
            {eyebrow}
          </p>
          <h2
            id="pomodoro-notice-title"
            className="font-display text-xl leading-tight font-semibold"
          >
            {title}
          </h2>
        </div>
      </div>
      <div className="mt-3 text-[0.95rem] leading-snug text-ink-soft">{body}</div>
      <div className="mt-5 flex flex-wrap gap-2 [&>*]:flex-1">{actions}</div>
      {locked && (
        <p className="mt-3 flex items-center justify-center gap-1 text-[0.7rem] font-bold text-ink-soft">
          Hold <span className={KBD_SM}>Shift</span> to click
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/**
 * The Pomodoro symbol: a tomato kitchen timer. `empty` is an outline (a pomodoro still to do).
 * With `shake`, it shakes when a phase rings, like the one on the table.
 */
function TomatoMark({
  className,
  empty = false,
  shake = false,
}: {
  className?: string;
  empty?: boolean;
  shake?: boolean;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const rings = usePomodoro((s) => s.rings);
  const seen = useRef(rings);
  useEffect(() => {
    if (rings === seen.current) return;
    seen.current = rings;
    if (!shake || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    svg.current?.animate(
      [0, -16, 13, -10, 7, -4, 2, 0].map((deg) => ({ transform: `rotate(${deg}deg)` })),
      { duration: 900, easing: "ease-out" },
    );
  }, [rings, shake]);
  return (
    <svg ref={svg} viewBox="0 0 32 32" aria-hidden className={className}>
      <path
        d="M16 8.6c-6.9 0-12 4.3-12 10.1C4 24.6 9.4 28.6 16 28.6s12-4 12-9.9C28 12.9 22.9 8.6 16 8.6z"
        fill={empty ? "none" : TOMATO}
        stroke={empty ? TOMATO : "#a8322a"}
        strokeOpacity={empty ? 0.55 : 1}
        strokeWidth={empty ? 2 : 0.8}
      />
      {!empty && (
        <ellipse
          cx="10.6"
          cy="15.2"
          rx="3"
          ry="1.7"
          fill="#fff"
          opacity="0.38"
          transform="rotate(-28 10.6 15.2)"
        />
      )}
      <path
        d="M16 6.8l.94 1.95 4-.15-3.42 1.05 1.54 1.85L16 10.2l-3.06 1.3 1.54-1.85-3.43-1.05 4.01.15z"
        className={empty ? "fill-sage/50" : "fill-sage-dark"}
      />
      <path
        d="M16 8.4c.1-1.6.6-2.9 1.7-3.9"
        fill="none"
        className={empty ? "stroke-sage/50" : "stroke-sage-dark"}
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor">
      <circle cx="12" cy="12" r="7.6" strokeWidth="3" strokeDasharray="2.99 2.98" />
      <circle cx="12" cy="12" r="5.7" strokeWidth="2" />
      <circle cx="12" cy="12" r="1.9" strokeWidth="2" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </svg>
  );
}
