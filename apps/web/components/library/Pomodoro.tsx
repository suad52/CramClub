"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  IconCheck,
  IconClock,
  IconClose,
  IconInfo,
  IconPlus,
  IconSettings,
} from "@/components/ui/icons";
import {
  BODY,
  BTN,
  FOCUS,
  HUD_CHIP,
  HUD_MUTED,
  INPUT,
  PANEL,
  RIBBON,
  TITLE,
} from "@/components/ui/styles";
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
 * The table timer's side of the screen (the rules are in lib/game/pomodoro.ts; the walnut desk
 * clock on the table is drawn in the 3D scene from the same store). Browsers can't stop anyone
 * switching tabs, so instead leaving is noticed and costs the pomodoro, and the page does what it
 * can to keep you here: full screen, asking before it closes, and a nudge in the tab title.
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

const TITLE_RUNNING = "Come back: your pomodoro is running";
const TITLE_WAITING = "Come back: your pomodoro is waiting";
const TITLE_LOST = "Your pomodoro didn't count";

/*
 * The timer floats over the library as a walnut sticker (the HUD's look, and the screen-side
 * companion of the walnut desk clock): a black outline, a hard shadow, chunky Fredoka digits and
 * sun yellow for the one highlight. News worth stopping for (a pomodoro done, a break over) pops up
 * as a cream card in the middle; the "Leave?" dialog is the light panel over a walnut scrim.
 */
const W_BASE = `inline-flex shrink-0 items-center justify-center gap-2 border-black/80 font-display font-semibold whitespace-nowrap shadow-[0_3px_0_rgb(0_0_0/0.55)] transition-[background-color,color,transform,box-shadow] duration-150 ease-out hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_rgb(0_0_0/0.55)] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:translate-y-0 disabled:active:translate-y-0 disabled:active:shadow-[0_3px_0_rgb(0_0_0/0.55)] motion-reduce:transition-none ${FOCUS}`;
/** Buttons on the walnut card (40px tall): a sun key for the main action, walnut keys else. */
const W_BTN = {
  primary: `${W_BASE} h-10 rounded-[14px] border-[3px] bg-sun px-4 text-[14px] text-walnut hover:bg-[#f6d98f]`,
  secondary: `${W_BASE} h-10 rounded-[14px] border-[3px] bg-walnut-key px-3.5 text-[13.5px] text-walnut-text hover:bg-[#4a423b]`,
} as const;
const W_ICON = `${W_BASE} h-10 w-10 rounded-[12px] border-2 bg-walnut-key text-walnut-text hover:bg-[#4a423b]`;
/** The walnut card itself: a chunky sticker, readable over any part of the hall. */
const CARD =
  "pointer-events-auto rounded-[22px] border-[3px] border-black/80 bg-walnut/95 text-walnut-text shadow-[0_6px_0_rgb(0_0_0/0.55)]";
/** A small dark keycap, for P and Shift. */
const KEY = "kbd kbd-dark !h-5 !min-w-5 !px-1 !text-[0.68rem]";
/** The same keycap on the light cards. */
const KEY_LIGHT = "kbd !h-5 !min-w-5 !px-1 !text-[0.68rem]";
/** A flat coral for "it didn't count" (walnut text on it keeps AA contrast). */
const WRONG_FILL = "bg-[#f0b3a6]";
/** A short slide-and-fade in (none with reduced motion). */
const ENTER =
  "transition duration-200 ease-out starting:-translate-y-1.5 starting:opacity-0 motion-reduce:transition-none";
const DIVIDE = "border-dashed border-walnut-text/20";
/** A round sun badge for the clock mark (tilted, like the title screen's stickers). */
const CLOCK_BADGE =
  "grid h-9 w-9 shrink-0 -rotate-6 place-items-center rounded-full border-2 border-black/80 text-walnut shadow-[0_3px_0_rgb(0_0_0/0.55)]";

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

/** Pomodoros finished in this set, as the dots show them. */
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
      className={W_ICON}
    >
      <IconSettings size={18} strokeWidth={2.25} />
    </button>
  );
  const hint = locked && (
    <p
      className={`mt-3 flex items-center justify-center gap-1.5 font-display text-xs font-medium ${HUD_MUTED}`}
    >
      Hold <kbd className={KEY}>Shift</kbd> to use the buttons
    </p>
  );

  if (settingsOpen) {
    return (
      <section aria-label="Table timer" className={`${CARD} w-[24rem] max-w-full p-5`}>
        <TimerSettings onDone={closeSettings} />
      </section>
    );
  }

  if (!compact && seated && s.phase === "idle") {
    return (
      <section aria-label="Table timer" className={`${CARD} ${ENTER} w-[24rem] max-w-full p-5`}>
        <header className="flex items-center gap-3">
          <ClockMark />
          <div className="min-w-0 flex-1">
            <p className="font-display text-[17px] leading-5 font-bold">Table timer</p>
            <p className={`text-xs leading-4 font-semibold ${HUD_MUTED}`}>The Pomodoro method</p>
          </div>
          <span className="-mr-1">{gear}</span>
        </header>
        <div className="mt-4 flex items-end gap-4">
          <p
            role="timer"
            className="tabular shrink-0 font-display text-[56px] leading-[0.85] font-bold tracking-[-0.01em] text-sun [text-shadow:0_4px_0_rgb(0_0_0/0.55)]"
          >
            {clockOf(s, now)}
          </p>
          <p className={`text-[13px] leading-5 font-medium ${HUD_MUTED}`}>
            of focus, then a {s.settings.shortBreakMinutes}-minute break. Stay at the table and in
            this tab until it rings.
          </p>
        </div>
        <TaskInput />
        <SetRow s={s} now={now} />
        <div className={`mt-4 grid grid-cols-[1fr_auto] gap-2 border-t-2 pt-4 ${DIVIDE}`}>
          <button
            type="button"
            onClick={() => startPomodoro()}
            aria-keyshortcuts="P"
            className={W_BTN.primary}
          >
            <kbd className={KEY} aria-hidden>
              P
            </kbd>
            Start focus
          </button>
          <button type="button" onClick={onLeave} className={W_BTN.secondary}>
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
      className={`${CARD} ${ENTER} w-[24rem] max-w-full px-4 pt-4 pb-3.5`}
    >
      <div className="flex items-center gap-3">
        <ClockMark onBreak={onBreak} />
        <div className="min-w-0 flex-1">
          <p className={`font-display text-xs leading-4 font-semibold ${HUD_MUTED}`}>{label}</p>
          <p className="mt-0.5 truncate font-display text-[15px] leading-5 font-semibold">
            {onBreak
              ? "Stand up, stretch, look away from the screen"
              : s.task || (focusing ? "Focus time" : "Ready when you are")}
          </p>
        </div>
        <p
          role="timer"
          className={`tabular shrink-0 font-display text-[32px] leading-none font-bold tracking-[-0.01em] [text-shadow:0_3px_0_rgb(0_0_0/0.55)] ${onBreak ? "text-leaf" : "text-sun"}`}
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
          className="mt-3 h-3.5 overflow-hidden rounded-full border-2 border-black/80 bg-walnut-key shadow-[inset_0_2px_0_rgb(0_0_0/0.35)]"
        >
          <div
            className={`h-full rounded-full transition-[width] duration-300 ease-linear motion-reduce:transition-none ${onBreak ? "bg-leaf" : "bg-sun"}`}
            style={{ width: `${progress * 100}%` }}
          />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SetRow s={s} now={now} inline />
        <span className="ml-auto flex items-center gap-1.5">
          {s.phase === "idle" && seated && (
            <button
              type="button"
              onClick={() => startPomodoro()}
              aria-keyshortcuts="P"
              className={W_BTN.primary}
            >
              <kbd className={KEY} aria-hidden>
                P
              </kbd>
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
              className={W_BTN.secondary}
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
              className={W_ICON}
            >
              <LineIcon d="M4.75 9.25v-4.5h4.5M14.75 4.75h4.5v4.5M19.25 14.75v4.5h-4.5M9.25 19.25h-4.5v-4.5" />
            </button>
          )}
          {gear}
          {seated && (
            <button
              type="button"
              onClick={onLeave}
              title={focusing ? "Ends this pomodoro early (it won't count)" : undefined}
              className={W_BTN.secondary}
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
    <label className="mt-5 block">
      <span className="mb-1.5 block font-display text-[14px] leading-5 font-semibold">
        What are you working on?
      </span>
      <input
        value={task}
        maxLength={80}
        placeholder="Name one task"
        onChange={(e) => setTask(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" && e.key !== "Escape") return;
          // Marked handled so Esc doesn't also open the pause menu.
          e.preventDefault();
          e.currentTarget.blur();
        }}
        className={INPUT}
      />
    </label>
  );
}

/**
 * The set as dots, like the desk clock's (filled = done, ringed = the one running now), and
 * today's tally.
 */
function SetRow({ s, now, inline = false }: { s: PomodoroState; now: number; inline?: boolean }) {
  const every = s.settings.longBreakEvery;
  const done = doneInSet(s);
  const today = todayCount(s, now);
  return (
    <div className={`flex items-center gap-2.5 ${inline ? "" : "mt-4"}`}>
      <span
        role="img"
        aria-label={`${done} of ${every} pomodoros done in this set; a long break after ${every}`}
        className="flex items-center gap-1.5"
      >
        {Array.from({ length: every }, (_, i) => (
          <span
            key={i}
            className={`h-3.5 w-3.5 rounded-full border-2 ${
              i < done
                ? "border-black/80 bg-sun shadow-[0_2px_0_rgb(0_0_0/0.55)]"
                : i === done && isFocusing(s)
                  ? "border-sun bg-sun/20"
                  : "border-walnut-muted/60"
            }`}
          />
        ))}
      </span>
      <span className={`tabular font-display text-xs font-semibold ${HUD_MUTED}`}>
        {today} done today
      </span>
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
    // With the pause menu, My Progress or the Librarian open over them, Esc is theirs.
    const onKey = (e: KeyboardEvent) => {
      const game = useGameStore.getState();
      if (e.key !== "Escape" || game.menuOpen || game.progressOpen || game.librarianOpen) return;
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
        <h2 className="flex-1 font-display text-[22px] leading-tight font-bold">Timer settings</h2>
        <button type="button" onClick={onDone} className={W_BTN.primary}>
          Done
        </button>
      </header>
      <div className="mt-4 space-y-1.5">
        <Stepper setting="focusMinutes" label="Pomodoro" format={minutes} fixed={focusing} />
        <Stepper setting="shortBreakMinutes" label="Short break" format={minutes} />
        <Stepper setting="longBreakMinutes" label="Long break" format={minutes} />
        <Stepper
          setting="longBreakEvery"
          label="Long break every"
          format={(n) => `${n} pomodoros`}
        />
      </div>
      <div className={`mt-4 space-y-0.5 border-t-2 pt-3 ${DIVIDE}`}>
        <Toggle
          label="Strict"
          hint={`Leaving this tab for more than ${AWAY_GRACE_MS / 1000} seconds ends the pomodoro, and it won't count. Off: the timer waits while you're away.`}
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
        <p
          className={`mt-3 flex gap-2.5 rounded-[14px] border-2 border-black/60 bg-walnut-key/70 px-3 py-2.5 text-xs leading-[1.125rem] font-medium ${HUD_MUTED}`}
        >
          <IconInfo size={16} strokeWidth={2.25} className="mt-px text-sun" />
          <span>
            The pomodoro&apos;s length and Strict stay as they are until it ends: a pomodoro keeps
            the rules it started with.
          </span>
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
  const button = `${W_ICON} disabled:hover:bg-walnut-key`;
  return (
    <div role="group" aria-label={label} className="flex items-center justify-between gap-3">
      <span className={`font-display text-[15px] font-semibold ${fixed ? HUD_MUTED : ""}`}>
        {label}
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-label={`${label}: less`}
          disabled={fixed || value <= min}
          onClick={() => change(-step)}
          className={button}
        >
          <LineIcon d="M5 12h14" size={16} strokeWidth={2.5} />
        </button>
        <output
          aria-live="polite"
          className="tabular w-24 text-center font-display text-[15px] font-bold text-sun"
        >
          {format(value)}
        </output>
        <button
          type="button"
          aria-label={`${label}: more`}
          disabled={fixed || value >= max}
          onClick={() => change(step)}
          className={button}
        >
          <IconPlus size={16} strokeWidth={2.5} />
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
      className={`-mx-2 flex w-[calc(100%+1rem)] items-start gap-3 rounded-[14px] px-2 py-2 text-left transition-colors duration-150 hover:bg-walnut-key/60 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent motion-reduce:transition-none ${FOCUS}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[15px] leading-5 font-semibold">{label}</span>
        <span className={`mt-0.5 block text-xs leading-[1.125rem] font-medium ${HUD_MUTED}`}>
          {hint}
        </span>
      </span>
      {/* A chunky switch: leaf when on, with a cream knob. */}
      <span
        aria-hidden
        className={`mt-0.5 flex h-7 w-11 shrink-0 items-center rounded-full border-2 border-black/80 p-0.5 shadow-[0_2px_0_rgb(0_0_0/0.55)] transition-colors duration-150 motion-reduce:transition-none ${checked ? "bg-leaf" : "bg-walnut-key"}`}
      >
        <span
          className={`h-5 w-5 rounded-full border-2 border-black/80 bg-surface transition-transform duration-150 motion-reduce:transition-none ${checked ? "translate-x-4" : ""}`}
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
      className="absolute inset-0 z-[24] grid place-items-center bg-walnut/50 p-4 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && keep()}
    >
      <div
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-desc"
        className={`${PANEL} title-pop relative w-full max-w-sm p-6 text-walnut sm:p-7`}
      >
        {/* A tilted clock sticker on the corner, like the title screen's badge. */}
        <span
          aria-hidden
          className="absolute -top-4 -right-3 grid h-12 w-12 rotate-12 place-items-center rounded-full border-[3px] border-walnut bg-sun text-walnut shadow-[0_4px_0_#1f1a16]"
        >
          <IconClock size={22} strokeWidth={2.5} />
        </span>
        <h2 id="leave-title" className={`${TITLE} pr-6`}>
          {from === "table" ? "Leave the table?" : "Leave the library?"}
        </h2>
        <p id="leave-desc" className={`mt-3 ${BODY}`}>
          <strong className="tabular inline-flex rounded-full border-2 border-walnut bg-sun px-2 font-display font-semibold text-walnut">
            {clockOf(s, now)} left.
          </strong>{" "}
          A pomodoro can&apos;t be split, so this one won&apos;t count.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button type="button" onClick={keep} className={BTN.primary}>
            Keep focusing
          </button>
          <button type="button" onClick={leave} className={BTN.danger}>
            Leave anyway
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
    return `You were away for ${formatAway(n.awayMs)}. Stay with it: after ${grace} s away, a pomodoro won't count.`;
  if (n.kind === "paused")
    return `Welcome back. Your pomodoro waited ${formatAway(n.awayMs)} for you.`;
  return "Pomodoro ended early, so it won't count. Start a fresh one whenever you're ready.";
}

/** A word in passing, in the HUD's walnut. */
const TOAST = `${HUD_CHIP} ${ENTER} max-w-full px-4 py-2.5 text-[13px] leading-5 font-medium`;

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
    <div role="status" className="flex w-[24rem] max-w-full flex-col items-start gap-2">
      {toast && (
        <p key={toast.at} className={TOAST}>
          {toastText(toast)}
        </p>
      )}
      {seatLockAt !== null && (
        <p key={seatLockAt} className={TOAST}>
          You&apos;re mid-pomodoro, so stay at the table until it rings.{" "}
          <span className={HUD_MUTED}>
            <span className="font-semibold text-walnut-text">Leave table</span> ends it early, and
            it won&apos;t count.
          </span>
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
        className={BTN.primary}
      >
        <kbd className={KEY} aria-hidden>
          P
        </kbd>
        {text}
      </button>
    ) : null;

  if (notice.kind === "voided") {
    eyebrow = "Pomodoro ended early";
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
          <p className="mt-2 text-[13px] leading-5">
            Rather have it wait for you? Turn off Strict in the timer settings.
          </p>
        )}
      </>
    );
    actions = (
      <>
        {startButton("Start a new pomodoro")}
        <button type="button" onClick={dismiss} className={BTN.secondary}>
          {seated ? "Not now" : "Got it"}
        </button>
      </>
    );
  } else if (notice.kind === "focusDone") {
    const long = notice.breakPhase === "longBreak";
    eyebrow = long ? "Set complete" : "Time for a break";
    title = `Pomodoro ${notice.count} done`;
    body = long ? (
      <p>
        That&apos;s {longBreakEvery} in a row. Take a {longBreakMinutes}-minute long break: walk
        around, get some water, rest your eyes.
      </p>
    ) : (
      <p>
        Take a {shortBreakMinutes}-minute break. Stand up, stretch and look away from the screen.
      </p>
    );
    actions = (
      <>
        <button type="button" onClick={dismiss} className={BTN.primary}>
          Enjoy the break
        </button>
        <button
          type="button"
          onClick={() => {
            s.skipBreak();
            dismiss();
          }}
          className={BTN.secondary}
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
      <p>Pick up where you left off. The next pomodoro starts when you say so.</p>
    ) : (
      <p>Sit at a table to start the next pomodoro.</p>
    );
    actions = (
      <>
        {startButton("Start focus")}
        <button type="button" onClick={dismiss} className={BTN.secondary}>
          {seated ? "Not yet" : "Got it"}
        </button>
      </>
    );
  }

  const voided = notice.kind === "voided";
  // A sticker stamp on the corner: a tick for a pomodoro done, the clock for a break over, a cross
  // when it didn't count (the words say it too).
  const Stamp = voided ? IconClose : notice.kind === "focusDone" ? IconCheck : IconClock;
  const stampFill = voided ? WRONG_FILL : notice.kind === "focusDone" ? "bg-leaf" : "bg-sun";
  return (
    <section
      role={voided ? "alert" : "status"}
      aria-labelledby="pomodoro-notice-title"
      className={`${PANEL} title-pop pointer-events-auto relative w-[26rem] max-w-full p-6 pt-8 text-walnut`}
    >
      <p
        className={`absolute -top-4 left-6 ${voided ? RIBBON.replace("bg-tangerine", WRONG_FILL) : RIBBON}`}
      >
        {eyebrow}
      </p>
      <span
        aria-hidden
        className={`absolute -top-5 -right-4 grid h-14 w-14 rotate-12 place-items-center rounded-full border-[3px] border-walnut text-walnut shadow-[0_4px_0_#1f1a16] ${stampFill}`}
      >
        <Stamp size={26} strokeWidth={2.75} />
      </span>
      <h2
        id="pomodoro-notice-title"
        className="pr-8 font-display text-[26px] leading-tight font-bold text-walnut"
      >
        {title}
      </h2>
      <div className={`mt-2.5 ${BODY}`}>{body}</div>
      <div className="mt-6 flex flex-wrap gap-2.5 [&>*]:flex-1">{actions}</div>
      {locked && (
        <p className="mt-4 flex items-center justify-center gap-1.5 font-display text-xs font-medium text-ink-soft">
          Hold <kbd className={KEY_LIGHT}>Shift</kbd> to use the buttons
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

/**
 * The timer's mark: a clock that shakes when a phase rings, like the one on the table (it stays
 * still with reduced motion).
 */
function ClockMark({ onBreak = false }: { onBreak?: boolean }) {
  const box = useRef<HTMLSpanElement>(null);
  const rings = usePomodoro((s) => s.rings);
  const seen = useRef(rings);
  useEffect(() => {
    if (rings === seen.current) return;
    seen.current = rings;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    box.current?.animate(
      [0, -16, 13, -10, 7, -4, 2, 0].map((deg) => ({ transform: `rotate(${deg}deg)` })),
      { duration: 900, easing: "ease-out" },
    );
  }, [rings]);
  return (
    <span ref={box} aria-hidden className={`${CLOCK_BADGE} ${onBreak ? "bg-leaf" : "bg-sun"}`}>
      <IconClock size={20} strokeWidth={2.5} />
    </span>
  );
}

/**
 * A line icon for the few the shared set doesn't have (minus, full screen), drawn the same way:
 * 24px grid, 1.75 stroke, currentColor.
 */
function LineIcon({
  d,
  size = 18,
  strokeWidth = 2.25,
}: {
  d: string;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}
