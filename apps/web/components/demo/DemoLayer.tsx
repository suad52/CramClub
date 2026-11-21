"use client";

import { useEffect, useState } from "react";
import { startPomodoro } from "@/components/library/Pomodoro";
import {
  IconArrowUpRight,
  IconBoard,
  IconChevronDown,
  IconClock,
  IconClose,
  IconPlay,
  IconVolume,
} from "@/components/ui/icons";
import { FOCUS, HUD_CHIP, HUD_MUTED } from "@/components/ui/styles";
import { loginHref } from "@/lib/auth/links";
import { useAccount } from "@/lib/auth/useAccount";
import { startDemo } from "@/lib/demo/director";
import {
  type DemoLessonState,
  lessonSlow,
  playReadyLesson,
  playSavedLesson,
  resetDemoLesson,
  startDemoLesson,
  useDemoLesson,
} from "@/lib/demo/lesson";
import { demoFromUrl, leaveDemo, useDemo } from "@/lib/demo/mode";
import {
  DEMO_BUDDY,
  DEMO_HOLD_MINUTES,
  DEMO_TIMINGS,
  DEMO_WARN_MINUTES,
  finishKind,
  secondsUntilReal,
} from "@/lib/demo/settings";
import { shushNow } from "@/lib/focus/watch";
import { getSeat } from "@/lib/game/actions";
import { type PomodoroState, lengthWord, usePomodoro } from "@/lib/game/pomodoro";
import { useGameStore } from "@/lib/game/store";
import { JOB_STATUS_LABELS } from "@/lib/jobs/types";
import {
  heldTableId,
  isReservable,
  offerClaim,
  releaseTable,
  showToast,
  tableName,
  useTables,
} from "@/lib/tables/client";

/*
 * The judge demo on screen (rules: lib/demo/settings.ts; what it sets up: lib/demo/director.ts).
 * Only ever rendered while demo mode is on for this tab, so with it off the library is exactly as
 * it was. A "Demo mode" ribbon sits top centre with "Exit demo" (and "Sign in", to show the
 * account side); under it, the demo controls fold open as two short rows of sticker keys, kept
 * above the table so Theo and the desk clock stay in view:
 *
 * - the table timer: start a 1-minute pomodoro, finish it now (for real in its last seconds, when
 *   the server agrees it ran its length; earlier a marked preview that earns nothing), skip a break;
 * - "Shush me": Ms. Fenwick's drifting-off line on request;
 * - hold or give up your table (the usual table cards, with demo-length holds);
 * - a background lesson (a real cloud lesson; the saved example if it's slow or can't be made);
 * - "How it works" (/proof) in a new tab (not mid-pomodoro: a new tab is leaving this one).
 *
 * A line under the keys says what's going on (and that Theo is pretend). Like the timer's cards it
 * never takes the mouse: with it captured, hold Shift to click.
 */

/** The demo's chunky keys on the walnut sticker. */
const KEY_BASE = `inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-[12px] border-2 border-black/80 px-2 py-1 text-center font-display text-[13px] leading-4 font-semibold shadow-[0_3px_0_rgb(0_0_0/0.55)] transition-[background-color,transform,box-shadow] duration-150 ease-out hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_rgb(0_0_0/0.55)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:translate-y-0 motion-reduce:transition-none ${FOCUS}`;
const KEY = {
  primary: `${KEY_BASE} bg-sun text-walnut hover:bg-[#f6d98f]`,
  secondary: `${KEY_BASE} bg-walnut-key text-walnut-text hover:bg-[#4a423b]`,
} as const;
const CHIP_BTN = `inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[10px] border-2 border-black/80 px-2.5 font-display text-[13px] font-semibold whitespace-nowrap shadow-[0_2px_0_rgb(0_0_0/0.55)] transition-[background-color,transform] duration-150 hover:-translate-y-px active:translate-y-[2px] motion-reduce:transition-none ${FOCUS}`;

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Mounted once in the library: turns ?demo=1 into demo mode, and runs it while it's on. */
export function DemoLayer() {
  const on = useDemo((d) => d.on);
  useEffect(() => {
    demoFromUrl();
  }, []);
  useEffect(() => {
    if (!on) return;
    const stop = startDemo();
    return () => {
      stop();
      resetDemoLesson();
    };
  }, [on]);
  if (!on) return null;
  return <DemoRibbon />;
}

function exitDemo() {
  leaveDemo();
  // A full page load on purpose: a fresh library, exactly as it is outside demo mode.
  window.location.assign(new URL("/", window.location.origin).href);
}

function DemoRibbon() {
  const ready = useGameStore((s) => s.ready);
  const phase = useGameStore((s) => s.phase);
  const panelOpen = useDemo((d) => d.panelOpen);
  // Ms. Fenwick, My Progress, the menu and the guide cover the library: the controls wait.
  const covered = useGameStore(
    (s) => s.librarianOpen || s.progressOpen || s.studioOpen || s.menuOpen || s.guideOpen,
  );
  const { account } = useAccount();
  const playing = ready && phase === "playing";
  if (!ready || phase === "creator") return null;
  return (
    <div className="pointer-events-none absolute top-4 left-1/2 z-[12] flex w-[29rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2">
      <div className={`${HUD_CHIP} pointer-events-auto flex items-center gap-1.5 p-1`}>
        <span className="inline-flex -rotate-2 items-center gap-1.5 rounded-full border-2 border-black/80 bg-sun px-2.5 py-0.5 text-[13px] font-bold whitespace-nowrap text-walnut shadow-[0_2px_0_rgb(0_0_0/0.55)]">
          <span
            aria-hidden
            className="h-2 w-2 rounded-full border-[1.5px] border-walnut bg-tangerine"
          />
          Demo mode
        </span>
        {playing && (
          <button
            type="button"
            aria-expanded={panelOpen}
            aria-controls="demo-controls"
            onClick={() => useDemo.setState({ panelOpen: !panelOpen })}
            className={`${CHIP_BTN} bg-walnut-key text-walnut-text hover:bg-[#4a423b]`}
          >
            Controls
            <IconChevronDown
              size={14}
              strokeWidth={2.75}
              className={`transition-transform duration-150 motion-reduce:transition-none ${panelOpen ? "rotate-180" : ""}`}
            />
          </button>
        )}
        {account?.configured && !account.signedIn && (
          <a
            href={loginHref("/demo")}
            className={`${CHIP_BTN} bg-walnut-key text-walnut-text hover:bg-[#4a423b]`}
          >
            Sign in
          </a>
        )}
        <button
          type="button"
          onClick={exitDemo}
          className={`${CHIP_BTN} bg-cream text-walnut hover:bg-surface`}
        >
          <IconClose size={14} strokeWidth={2.75} />
          Exit demo
        </button>
      </div>
      {playing && panelOpen && !covered && <DemoPanel />}
    </div>
  );
}

/** One key: a short label, with what it does for screen readers and on hover. */
function Key({
  icon,
  label,
  hint,
  onClick,
  primary = false,
  disabled = false,
}: {
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={hint}
        className={primary ? KEY.primary : KEY.secondary}
      >
        <span aria-hidden className="shrink-0">
          {icon}
        </span>
        <span>{label}</span>
        <span className="sr-only">. {hint}</span>
      </button>
    </li>
  );
}

function DemoPanel() {
  const p = usePomodoro();
  const seatId = useGameStore((g) => g.seatId);
  const locked = useGameStore((g) => g.pointerLocked);
  // Re-render when your hold starts or ends.
  useTables((t) => t.view?.mine?.endsAt ?? null);
  const tablesBusy = useTables((t) => t.busy !== null);
  const lesson = useDemoLesson();
  const now = useNow(500);
  const held = heldTableId();
  const tableId = getSeat(seatId)?.tableId ?? null;
  const slow = lessonSlow(lesson, now);
  const showSaved = slow || lesson.kind === "unavailable";

  return (
    <section
      id="demo-controls"
      aria-label="Demo controls"
      className={`${HUD_CHIP} pointer-events-auto w-full bg-walnut/95 p-2.5 transition duration-200 ease-out starting:-translate-y-1.5 starting:opacity-0 motion-reduce:transition-none`}
    >
      <ul className="grid grid-cols-3 gap-1.5">
        <TimerKey p={p} seated={!!seatId} now={now} />
        <Key
          icon={<IconVolume size={15} strokeWidth={2.5} />}
          label="Shush me"
          hint="Ms. Fenwick shushes you as if you'd drifted off: her voice and a caption"
          onClick={() => {
            if (!shushNow())
              showToast("Ms. Fenwick is talking with someone. Try again in a moment.");
          }}
        />
        {held ? (
          <Key
            icon={<IconBoard size={15} strokeWidth={2.5} />}
            label="Give up table"
            hint={`${tableName(held)} opens to everyone again`}
            disabled={tablesBusy}
            onClick={() => void releaseTable(held)}
          />
        ) : (
          <Key
            icon={<IconBoard size={15} strokeWidth={2.5} />}
            label="Hold table"
            hint={`Hold your table for ${DEMO_HOLD_MINUTES} minutes, with a word ${DEMO_WARN_MINUTES} minute before the end`}
            disabled={!isReservable(tableId) || tablesBusy}
            onClick={() => tableId && offerClaim(tableId)}
          />
        )}
        <LessonKey lesson={lesson} />
        {showSaved && (
          <Key
            primary
            icon={<IconPlay size={15} strokeWidth={2.5} />}
            label="Saved example"
            hint="Play a finished lesson prepared earlier on your table's board"
            onClick={() => void playSavedLesson()}
          />
        )}
        {p.phase === "focus" ? (
          // A new tab mid-pomodoro is leaving the tab (it would end the pomodoro), as elsewhere.
          <Key
            icon={<IconArrowUpRight size={15} strokeWidth={2.5} />}
            label="How it works"
            hint="Opens in a new tab after your pomodoro (leaving the tab now would end it)"
            disabled
            onClick={() => {}}
          />
        ) : (
          <li>
            <a
              href="/proof"
              target="_blank"
              rel="noopener"
              title="The live evidence page, in a new tab"
              className={KEY.secondary}
            >
              <IconArrowUpRight size={15} strokeWidth={2.5} aria-hidden />
              How it works
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        )}
      </ul>
      <p className={`mt-2 px-1 text-center text-[12px] leading-4 font-medium ${HUD_MUTED}`}>
        {statusLine(p, lesson, slow, now)}
        {locked && " Hold Shift to click."}
      </p>
    </section>
  );
}

function TimerKey({ p, seated, now }: { p: PomodoroState; seated: boolean; now: number }) {
  if (p.phase === "focus") {
    const kind = finishKind(p, now);
    return (
      <Key
        primary
        icon={<IconClock size={15} strokeWidth={2.5} />}
        label={kind === "real" ? "Finish now" : "Finish (preview)"}
        hint={
          kind === "real"
            ? "Rings it now and it counts: the server checks its own clock"
            : "Rings it now as a preview that earns no XP (it counts for real in its last 10 seconds)"
        }
        onClick={() => {
          const k = finishKind(usePomodoro.getState(), Date.now());
          if (k) usePomodoro.getState().finishNow(k === "preview");
        }}
      />
    );
  }
  if (p.phase === "shortBreak" || p.phase === "longBreak") {
    return (
      <Key
        icon={<IconClock size={15} strokeWidth={2.5} />}
        label="Skip break"
        hint="Straight on to the next pomodoro"
        onClick={() => usePomodoro.getState().skipBreak()}
      />
    );
  }
  return (
    <Key
      primary
      icon={<IconPlay size={15} strokeWidth={2.5} />}
      label="Start pomodoro"
      hint={`A ${lengthWord(DEMO_TIMINGS.focusMinutes)} pomodoro, then a ${lengthWord(DEMO_TIMINGS.shortBreakMinutes)} break`}
      disabled={!seated}
      onClick={() => void startPomodoro()}
    />
  );
}

function LessonKey({ lesson }: { lesson: DemoLessonState }) {
  if (lesson.kind === "ready")
    return (
      <Key
        primary
        icon={<IconPlay size={15} strokeWidth={2.5} />}
        label="Play new lesson"
        hint={`${lesson.lesson.title}, on your table's board`}
        onClick={() => playReadyLesson()}
      />
    );
  const working = lesson.kind === "starting" || lesson.kind === "making";
  return (
    <Key
      icon={<IconBoard size={15} strokeWidth={2.5} />}
      label={working ? "Lesson cooking…" : "Background lesson"}
      hint="A real lesson made on the library's cloud worker while you study (it needs a sign-in)"
      disabled={working}
      onClick={() => void startDemoLesson()}
    />
  );
}

/** What's going on, in a line (the timer first, then the lesson, then who Theo is). */
function statusLine(p: PomodoroState, lesson: DemoLessonState, slow: boolean, now: number) {
  if (p.phase === "focus" && finishKind(p, now) === "preview")
    return `Finishing now is a preview with no XP. It counts for real in ${secondsUntilReal(p, now)} s.`;
  if (lesson.kind === "starting") return "Sending your background lesson to the library's cloud…";
  if (lesson.kind === "making") {
    const status = lesson.job.progress ?? JOB_STATUS_LABELS[lesson.job.status];
    return slow
      ? `Background lesson: ${status}. It takes a few minutes and keeps going; the saved example plays now.`
      : `Background lesson: ${status}.`;
  }
  if (lesson.kind === "unavailable")
    return `Background lesson: ${lesson.message} The saved example plays instead.`;
  if (lesson.kind === "ready") return `Your background lesson is ready: ${lesson.lesson.title}.`;
  return `${DEMO_BUDDY.name} is a pretend study buddy only you can see. A pomodoro is ${DEMO_TIMINGS.focusMinutes} minute here.`;
}
