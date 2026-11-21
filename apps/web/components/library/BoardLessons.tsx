"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LessonPlayerView, Question } from "@/components/learning-studio/LessonPlayer";
import {
  IconArrowUpRight,
  IconBoard,
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconPause,
  IconPlay,
  IconPlus,
  type IconProps,
} from "@/components/ui/icons";
import {
  BODY,
  BTN,
  DIVIDER,
  EYEBROW,
  FOCUS,
  HUD_CHIP,
  ICON_BTN,
  PANEL,
  PANEL_MUTED,
  RIBBON,
  TAG,
  TITLE,
} from "@/components/ui/styles";
import { closeLessonFullscreen, openLessonFullscreen } from "@/lib/game/actions";
import { exitPointerLock, requestPointerLock } from "@/lib/game/pointer";
import { isFocusing, usePomodoro } from "@/lib/game/pomodoro";
import { useGameStore } from "@/lib/game/store";
import {
  BOARD_SCREEN,
  type BoardLesson,
  boardName,
  boardScreens,
  publishLiveFrame,
  shouldOfferJoin,
  tableNumberOf,
  useBoardLessons,
} from "@/lib/learning-studio/boardLessons";
import { type SavedLesson, loadLessons, updateProgress } from "@/lib/learning-studio/library";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "@/lib/learning-studio/mockLesson";
import type { Chunk, Lesson } from "@/lib/learning-studio/schema";
import { type LessonPlayback, useLessonPlayback } from "@/lib/learning-studio/useLessonPlayback";
import { useWhiteboardStore } from "@/lib/whiteboard/store";
import { FLIP_SECONDS } from "@/lib/world/boardPanel";
import { trackQuizAnswer } from "@/lib/learning/client";

/** How long the 3D board takes to flip over; the join offer waits for it. */
const FLIP_MS = FLIP_SECONDS * 1000;
/** Like a video, the board moves on to the next scene by itself after this pause. */
const NEXT_SCENE_MS = 2000;
/** `sourceId` of the built-in sample (saved lessons use their own id). */
const SAMPLE_ID = "sample";
/** The corner preview, at the board screen's aspect ratio. */
const PREVIEW_W = 300;
const PREVIEW_H = Math.round((PREVIEW_W * BOARD_SCREEN.height) / BOARD_SCREEN.width);

/** Small keycaps: on the light surfaces, and on the dark walnut HUD over the library. */
const KBD_SM = "kbd !h-5 !min-w-5 !px-1 !text-[0.68rem]";
const KBD_DARK_SM = "kbd kbd-dark !h-5 !min-w-5 !px-1 !text-[0.68rem]";
/** A walnut sticker floating over the 3D library (the corner player, the join offer). */
const HUD_PANEL =
  "rounded-[22px] border-[3px] border-black/80 bg-walnut/95 text-walnut-text shadow-[0_6px_0_rgb(0_0_0/0.55)]";
/** Buttons on the walnut HUD: chunky keys with a black outline that press down when clicked. */
const HUD_KEY = `inline-flex shrink-0 items-center justify-center gap-2 border-black/80 font-display font-semibold whitespace-nowrap shadow-[0_3px_0_rgb(0_0_0/0.55)] transition-[background-color,transform,box-shadow] duration-150 ease-out hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_rgb(0_0_0/0.55)] motion-reduce:transition-none ${FOCUS}`;
/** A 40px icon-only control on the walnut HUD (always pass an aria-label). */
const HUD_ICON_BTN = `${HUD_KEY} h-10 w-10 rounded-[12px] border-2 bg-walnut-key text-walnut-text hover:bg-[#4a423b]`;
/** The main action on the walnut HUD: a sun key, so it reads first. */
const HUD_PRIMARY = `${HUD_KEY} h-10 rounded-[14px] border-[3px] bg-sun px-4 text-[14px] text-walnut hover:bg-[#f6d98f]`;
const HUD_SECONDARY = `${HUD_KEY} h-10 rounded-[14px] border-[3px] bg-walnut-key px-4 text-[14px] text-walnut-text hover:bg-[#4a423b]`;
/** Book-spine colours for the lesson list: the cartoon palette's flat brights. */
const SPINES = ["#e07a3f", "#7fb27a", "#f2cf7e", "#8fb3d9", "#d98a7a"];

/** Drawn like the shared icon set (24px grid, currentColor, hidden from readers), a bit bolder. */
function LineIcon({
  d,
  size = 20,
  className = "",
}: { d: string } & Pick<IconProps, "size" | "className">) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      <path d={d} />
    </svg>
  );
}

/** Make bigger: full screen. */
const IconExpand = (p: Pick<IconProps, "size" | "className">) => (
  <LineIcon
    {...p}
    d="M4.75 9.25v-4.5h4.5M14.75 4.75h4.5v4.5M19.25 14.75v4.5h-4.5M9.25 19.25h-4.5v-4.5"
  />
);
/** Make smaller: leave full screen. */
const IconCollapse = (p: Pick<IconProps, "size" | "className">) => (
  <LineIcon
    {...p}
    d="M9.25 4.75v4.5h-4.5M19.25 9.25h-4.5v-4.5M14.75 19.25v-4.5h4.5M4.75 14.75h4.5v4.5"
  />
);

/** "Live": a steady tangerine marker (no pulsing). */
function LiveDot() {
  return (
    <span
      className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-walnut bg-tangerine"
      aria-hidden
    />
  );
}

/**
 * A menu, the controls guide, My Progress, the Librarian, a whiteboard, the picker or the
 * full-screen lesson is over the library: the HUD cards step aside (and their hotkeys with them,
 * so Enter in a menu stays there).
 */
function useCovered() {
  const menu = useGameStore((s) => s.menuOpen || s.guideOpen || s.progressOpen || s.librarianOpen);
  const board = useWhiteboardStore((s) => s.openId !== null);
  const lesson = useBoardLessons((s) => s.fullscreen || s.pickerBoardId !== null);
  return menu || board || lesson;
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab inside a modal `box`: from its last control (or from outside it, or the box itself)
 * Tab wraps to its first, and Shift+Tab from its first wraps to its last.
 */
function trapTab(box: HTMLElement, e: KeyboardEvent) {
  const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = all[0];
  const last = all[all.length - 1];
  const active = document.activeElement;
  const atEdge = e.shiftKey ? active === first : active === last;
  if (!box.contains(active) || active === box || atEdge) {
    e.preventDefault();
    (e.shiftKey ? last : first)?.focus();
  }
}

const sceneCount = (lesson: Lesson) =>
  `${lesson.scenes.length} scene${lesson.scenes.length === 1 ? "" : "s"}`;

/** The scene's narration is over and the next scene comes next (no question to answer first). */
const sceneDone = (p: LessonPlayback) =>
  p.narration.state === "ended" && !p.showQuestion && !p.last;

/** No voice at all: the scene was shown as text, and the reader moves on when they're ready. */
const readOn = (p: LessonPlayback) => p.narration.mode === "text" && sceneDone(p);

/**
 * Lessons on the library's rolling whiteboards, everything on the screen side: the lesson picker
 * (L), the join offer (J / N), the lesson director that plays the joined lesson, its corner
 * preview, the knowledge-check card and the full-screen player. The board itself (flip and
 * lesson face) is drawn in the 3D scene from the same store.
 */
export function BoardLessonsLayer() {
  const ready = useGameStore((s) => s.ready);
  const playing = useGameStore((s) => s.phase === "playing");
  if (!ready) return null;
  return (
    <>
      {/* Kept through a trip to the character studio, so a joined lesson pauses, not restarts. */}
      <LessonDirector />
      {playing && (
        <>
          <JoinCard />
          <LessonPicker />
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Director: one playback for the joined lesson, shown three ways      */
/* ------------------------------------------------------------------ */

function LessonDirector() {
  const run = useBoardLessons((s) => (s.joinedBoardId ? s.boards[s.joinedBoardId] : undefined));
  if (!run) return null;
  // A new run on the board (Replace with…) is a new lesson: start a fresh playback.
  return <JoinedLesson key={`${run.boardId}:${run.startedAt}`} run={run} />;
}

/**
 * Plays the joined lesson. The board, the corner preview and the full-screen player are all views
 * of this one playback, so switching between them never restarts anything. Narration stops when
 * this unmounts (leaving, the lesson ending, or leaving the library).
 */
function JoinedLesson({ run }: { run: BoardLesson }) {
  const { boardId, sourceId } = run;
  const fullscreen = useBoardLessons((s) => s.fullscreen);
  // The character studio is open over the library (the lesson pauses behind it; see below).
  const away = useGameStore((s) => s.phase !== "playing");
  const covered = useCovered();
  const onProgress = useCallback(
    (scene: number, completed: boolean) => {
      useBoardLessons.getState().setProgress(boardId, scene, completed);
      // A saved lesson also remembers where you got to in the Learning Studio.
      if (sourceId !== SAMPLE_ID) updateProgress(sourceId, scene, completed);
    },
    [boardId, sourceId],
  );
  // Joining is always a click or key press, so the voice is allowed to start straight away.
  const playback = useLessonPlayback(run.lesson, {
    startScene: run.completed ? 0 : run.sceneIndex,
    autoStart: true,
    onProgress,
  });
  const { index, narration, showQuestion, complete, playing, go } = playback;
  const { play, pause } = narration;

  // Rejoining a finished lesson replays it from the start, so the board's run isn't finished any
  // more (otherwise leaving partway through would take it off the board).
  const [replaying] = useState(run.completed);
  useEffect(() => {
    if (replaying) useBoardLessons.getState().setProgress(boardId, 0, false);
  }, [replaying, boardId]);

  // The 3D board reads this every frame to draw the live scene.
  useEffect(() => {
    publishLiveFrame({
      boardId,
      index,
      progress: narration.progress,
      caption: narration.caption,
      state: narration.state,
      showQuestion,
      complete,
    });
  }, [
    boardId,
    index,
    narration.progress,
    narration.caption,
    narration.state,
    showQuestion,
    complete,
  ]);
  useEffect(() => () => publishLiveFrame(null), []);

  // Like a video, a lesson that has finished a scene keeps going when it moves to another one
  // (by itself below, or from the scene buttons). The playback already does this mid-scene.
  const sceneIndex = useRef(index);
  const lastState = useRef(narration.state);
  useEffect(() => {
    if (sceneIndex.current === index) return;
    sceneIndex.current = index;
    if (lastState.current === "ended") void play();
  }, [index, play]);
  // Declared after the effect above so it still sees the previous scene's state on a change.
  useEffect(() => {
    lastState.current = narration.state;
  }, [narration.state]);

  // With no voice at all the narration is text to read, so the reader moves on when they're ready.
  const between = sceneDone(playback) && narration.mode !== "text" && !away;
  useEffect(() => {
    if (!between) return;
    const t = setTimeout(() => go(index + 1), NEXT_SCENE_MS);
    return () => clearTimeout(t);
  }, [between, go, index]);

  // The studio covers the library completely: the lesson pauses behind it and carries on after
  // (if it was playing), with its scene, speed, volume and answers just as they were.
  const wasAway = useRef(away);
  const resume = useRef(false);
  useEffect(() => {
    if (wasAway.current === away) return;
    wasAway.current = away;
    if (away) {
      resume.current = playing;
      if (playing) pause();
    } else if (resume.current) {
      resume.current = false;
      void play();
    }
  }, [away, playing, pause, play]);

  // Once opened, the full-screen player stays mounted (hidden while you're back at the board), so
  // its AI teacher chat, a half-typed question and the open side panel survive the round trip.
  const [opened, setOpened] = useState(fullscreen);
  if (fullscreen && !opened) setOpened(true);

  return (
    <>
      {opened && <FullscreenLesson run={run} playback={playback} open={fullscreen && !away} />}
      {!fullscreen && !away && (
        <div className="pointer-events-none absolute right-4 bottom-4 z-[12] flex flex-col items-end gap-3">
          {showQuestion && !covered && <QuestionCard playback={playback} />}
          <MiniPreview run={run} playback={playback} upNext={between} />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Corner preview                                                      */
/* ------------------------------------------------------------------ */

function statusOf(p: LessonPlayback, upNext: boolean) {
  if (p.complete) return { live: false, text: "Finished" };
  if (p.showQuestion) return { live: false, text: "Quick check" };
  if (p.narration.state === "loading") return { live: true, text: "Loading" };
  if (p.playing) return { live: true, text: "Live" };
  if (upNext) return { live: false, text: "Up next" };
  if (readOn(p)) return { live: false, text: "Reading" };
  return { live: false, text: "Paused" };
}

/**
 * The bottom-left mini player: a live copy of the board's lesson face (mirrored from the 3D
 * board's own canvas, so it always matches), with play/pause, full screen and leave.
 */
function MiniPreview({
  run,
  playback,
  upNext,
}: {
  run: BoardLesson;
  playback: LessonPlayback;
  upNext: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hasScreen, setHasScreen] = useState(false);
  const locked = useGameStore((s) => s.pointerLocked);
  const { lesson, index, narration, complete, playing, toggle, go } = playback;

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(PREVIEW_W * dpr);
    el.height = Math.round(PREVIEW_H * dpr);
    ctx.imageSmoothingQuality = "high";
    let source: HTMLCanvasElement | null = null;
    let painted = -1;
    let drawn = false;
    let frame = 0;
    const tick = () => {
      const screen = boardScreens.get(run.boardId);
      // Only copy when the board has actually repainted.
      if (screen && screen.paints > 0 && (screen.canvas !== source || screen.paints !== painted)) {
        ctx.drawImage(screen.canvas, 0, 0, el.width, el.height);
        source = screen.canvas;
        painted = screen.paints;
      }
      const has = !!screen && screen.paints > 0;
      if (has !== drawn) {
        drawn = has;
        setHasScreen(has);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [run.boardId]);

  const status = statusOf(playback, upNext);
  const total = lesson.scenes.length;
  const overall = complete ? 1 : (index + narration.progress) / total;
  const leave = () => useBoardLessons.getState().leave();
  return (
    <section
      aria-label={`Lesson on ${boardName(run.boardId)}`}
      className={`${HUD_PANEL} pointer-events-auto p-2 transition duration-300 ease-out starting:translate-y-3 starting:opacity-0 motion-reduce:transition-none`}
      // The screen at its own size, plus the card's padding and its 3px outline.
      style={{ width: PREVIEW_W + 22 }}
    >
      <button
        type="button"
        onClick={openLessonFullscreen}
        aria-label="Open the lesson full screen"
        aria-keyshortcuts="F"
        // walnut-text is the board face's paper colour, so the title card matches the board.
        className={`group relative block w-full overflow-hidden rounded-[14px] bg-walnut-text ring-2 ring-black/80 ${FOCUS}`}
        style={{ height: PREVIEW_H }}
      >
        <canvas
          ref={canvas}
          aria-hidden
          className="block h-full w-full"
          style={{ width: PREVIEW_W, height: PREVIEW_H }}
        />
        {!hasScreen && (
          // Until the board's screen exists (it's still flipping into view, say), a title card.
          <span className="absolute inset-0 grid place-items-center p-5 text-center">
            <span>
              <span className="block font-display text-xs font-semibold text-ink-soft">
                {boardName(run.boardId)}
              </span>
              <span className="mt-1 line-clamp-2 block font-display text-lg leading-tight font-bold text-walnut">
                {lesson.title}
              </span>
            </span>
          </span>
        )}
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full border-2 border-black/80 bg-walnut px-2.5 py-0.5 font-display text-xs font-semibold text-walnut-text shadow-[0_2px_0_rgb(0_0_0/0.55)]">
          {status.live && <LiveDot />}
          {status.text}
        </span>
        <span className="absolute inset-0 grid place-items-center bg-walnut/0 opacity-0 transition duration-150 group-hover:bg-walnut/35 group-hover:opacity-100 group-focus-visible:bg-walnut/35 group-focus-visible:opacity-100 motion-reduce:transition-none">
          <span className="flex items-center gap-2 rounded-[12px] border-2 border-walnut bg-surface px-3 py-1.5 font-display text-[13.5px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16]">
            <IconExpand size={16} />
            Full screen
            <span className={KBD_SM}>F</span>
          </span>
        </span>
      </button>

      <div
        className="mx-1 mt-2.5 h-3.5 overflow-hidden rounded-full border-2 border-black/80 bg-walnut-key shadow-[inset_0_2px_0_rgb(0_0_0/0.35)]"
        role="progressbar"
        aria-label="Lesson progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(overall * 100)}
      >
        <span
          className={`block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${complete ? "bg-leaf" : "bg-sun"}`}
          style={{ width: `${overall * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-1.5 pt-2 pb-0.5 pl-1">
        <div className="min-w-0 flex-1">
          <p
            className="truncate font-display text-[15px] leading-5 font-semibold"
            title={lesson.title}
          >
            {lesson.title}
          </p>
          <p className="tabular truncate font-display text-xs leading-4 font-medium text-walnut-muted">
            {complete ? "Lesson complete" : `Scene ${index + 1} of ${total}`} · Table{" "}
            {tableNumberOf(run.boardId)}
          </p>
        </div>
        {complete ? (
          <button type="button" onClick={leave} className={HUD_PRIMARY}>
            Done
          </button>
        ) : readOn(playback) ? (
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next scene"
            title="Next scene"
            className={HUD_ICON_BTN}
          >
            <IconChevronRight />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause the lesson" : "Play the lesson"}
            className={HUD_ICON_BTN}
          >
            {playing ? <IconPause /> : <IconPlay />}
          </button>
        )}
        <button
          type="button"
          onClick={openLessonFullscreen}
          aria-label="Full screen"
          aria-keyshortcuts="F"
          title="Full screen (F)"
          className={HUD_ICON_BTN}
        >
          <IconExpand />
        </button>
        {!complete && (
          <button
            type="button"
            onClick={leave}
            aria-label="Leave the lesson"
            title="Leave the lesson (it waits on the board)"
            className={HUD_ICON_BTN}
          >
            <IconClose />
          </button>
        )}
      </div>
      {locked && (
        <p className="flex flex-wrap items-center gap-1 px-1 pt-2 pb-1 font-display text-xs font-medium text-walnut-muted">
          Hold <kbd className={KBD_DARK_SM}>Shift</kbd> to click ·{" "}
          <kbd className={KBD_DARK_SM}>F</kbd> full screen
        </p>
      )}
    </section>
  );
}

/** The knowledge check as a small HUD card, answerable with 1–4 while the mouse steers. */
function QuestionCard({ playback }: { playback: LessonPlayback }) {
  const locked = useGameStore((s) => s.pointerLocked);
  const q = playback.scene.interaction;
  if (!q) return null;
  return (
    <section
      aria-label="Knowledge check"
      className="pointer-events-auto max-h-[calc(100dvh-24.5rem)] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[20px] pb-1.5 transition duration-300 ease-out starting:translate-y-3 starting:opacity-0 motion-reduce:transition-none"
    >
      <p
        className={`${HUD_CHIP} mb-2 inline-flex flex-wrap items-center gap-x-1.5 py-1 pr-2.5 pl-1 text-xs`}
      >
        <span className="rounded-full border-2 border-black/80 bg-sun px-2 py-px font-semibold text-walnut">
          Quick check
        </span>
        <span className="text-walnut-muted">
          {q.type === "multiple-choice"
            ? `· press 1–${q.options?.length ?? 4}, then Enter`
            : "· Enter to go on"}
          {locked && " · hold Shift to click"}
        </span>
      </p>
      <Question
        key={playback.scene.id}
        q={q}
        onDone={playback.completeQuestion}
        onPick={(i) => void trackQuizAnswer(playback.lesson, playback.scene, i)}
        hotkeys
        compact
      />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Full screen                                                         */
/* ------------------------------------------------------------------ */

/**
 * The full lesson player over the library, driven by the same playback as the board. It grows
 * out of the corner preview; Esc, F or "Back to the library" shrink it back there. Closed, it's
 * only hidden, so everything in it is as you left it when it opens again.
 */
function FullscreenLesson({
  run,
  playback,
  open,
}: {
  run: BoardLesson;
  playback: LessonPlayback;
  open: boolean;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const [canFill] = useState(() => document.fullscreenEnabled);
  const [filling, setFilling] = useState(false);

  // Listens for as long as the player exists, so it also hears the browser's full screen end as
  // the player closes.
  useEffect(() => {
    const el = overlay.current;
    const onChange = () => setFilling(!!el && document.fullscreenElement === el);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    const el = overlay.current;
    if (!open || !el) return;
    exitPointerLock();
    el.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Escape" && !e.isComposing) {
        // Back to the library (in the browser's own full screen, the browser takes the first Esc;
        // during an IME composition, Esc cancels that). Marked handled so the pause menu doesn't
        // open as well.
        e.preventDefault();
        closeLessonFullscreen();
      } else if (e.key === "Tab") {
        // The HUD's buttons are underneath: Tab must not reach them (they'd open menus over this).
        trapTab(el, e);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (document.fullscreenElement === el) void document.exitFullscreen().catch(() => {});
    };
  }, [open]);

  // Only ever undoes its own full screen: the whole page's may be a running pomodoro's, and the
  // lesson then fills the screen on top of it.
  const toggleFill = () => {
    if (filling) void document.exitFullscreen().catch(() => {});
    else void overlay.current?.requestFullscreen().catch(() => {});
  };
  const { leave, end } = useBoardLessons.getState();
  return (
    <div
      ref={overlay}
      role="dialog"
      aria-modal="true"
      aria-label={`${run.lesson.title}, full screen`}
      tabIndex={-1}
      hidden={!open}
      className="absolute inset-0 z-[18] origin-bottom-right bg-canvas outline-none transition duration-200 ease-out starting:scale-[0.97] starting:opacity-0 motion-reduce:transition-none"
    >
      <LessonPlayerView
        playback={playback}
        chunks={run.chunks}
        fill
        keyboardShortcuts={open}
        onExit={closeLessonFullscreen}
        exitLabel="Back to the library"
        headerActions={
          <>
            {canFill && (
              <button
                type="button"
                onClick={toggleFill}
                aria-pressed={filling}
                title={filling ? "Exit full screen" : "Fill the whole screen"}
                className={ICON_BTN}
              >
                {filling ? <IconCollapse /> : <IconExpand />}
                <span className="sr-only">
                  {filling ? "Exit full screen" : "Fill the whole screen"}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                closeLessonFullscreen();
                leave();
              }}
              title="The lesson waits on the board; join again any time with J"
              className={BTN.secondary}
            >
              Leave lesson
            </button>
            <button
              type="button"
              onClick={() => {
                closeLessonFullscreen();
                end(run.boardId);
              }}
              title="Take the lesson off the board (it flips back)"
              className={BTN.danger}
            >
              End lesson
            </button>
          </>
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Join offer                                                          */
/* ------------------------------------------------------------------ */

/** Whether the run that started at `startedAt` has finished flipping the board over. */
function useLanded(startedAt: number | undefined) {
  const [landed, setLanded] = useState<number | null>(null);
  useEffect(() => {
    if (startedAt === undefined) return;
    const t = setTimeout(() => setLanded(startedAt), Math.max(0, startedAt + FLIP_MS - Date.now()));
    return () => clearTimeout(t);
  }, [startedAt]);
  return startedAt !== undefined && landed === startedAt;
}

/** "Table 3's board is playing a lesson: Join (J) / Not now (N)", as the board lands. */
function JoinCard() {
  const offer = useBoardLessons((s) =>
    s.inRangeBoardId && shouldOfferJoin(s, s.inRangeBoardId)
      ? s.boards[s.inRangeBoardId]
      : undefined,
  );
  const covered = useCovered();
  const landed = useLanded(offer?.startedAt);
  const visible = landed && !covered;
  const { join, decline } = useBoardLessons.getState();
  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-36 z-[12] flex justify-center px-4"
    >
      {offer && visible && (
        <div
          key={`${offer.boardId}:${offer.startedAt}`}
          className={`${HUD_PANEL} pointer-events-auto w-full max-w-[26rem] p-4 transition duration-300 ease-out starting:translate-y-4 starting:opacity-0 motion-reduce:transition-none`}
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="grid h-12 w-12 shrink-0 -rotate-6 place-items-center rounded-[14px] border-2 border-black/80 bg-sun text-walnut shadow-[0_3px_0_rgb(0_0_0/0.55)]"
            >
              <IconBoard size={24} strokeWidth={2.25} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[13.5px] leading-5 font-medium text-walnut-muted">
                {boardName(offer.boardId)} is playing a lesson
              </p>
              <p className="truncate font-display text-[19px] leading-snug font-bold">
                {offer.lesson.title}
              </p>
              <p className="tabular truncate text-xs leading-5 font-medium text-walnut-muted">
                {offer.lesson.subject} · {sceneCount(offer.lesson)}
                {offer.sceneIndex > 0 && ` · waiting at scene ${offer.sceneIndex + 1}`}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => join(offer.boardId)}
              aria-keyshortcuts="J"
              className={HUD_PRIMARY}
            >
              <span className={KBD_SM}>J</span>
              Join
            </button>
            <button
              type="button"
              onClick={() => decline(offer.boardId)}
              aria-keyshortcuts="N"
              className={HUD_SECONDARY}
            >
              <span className={KBD_DARK_SM}>N</span>
              Not now
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lesson picker                                                       */
/* ------------------------------------------------------------------ */

function LessonPicker() {
  const boardId = useBoardLessons((s) => s.pickerBoardId);
  if (!boardId) return null;
  return <PickerDialog key={boardId} boardId={boardId} />;
}

const newestFirst = () => loadLessons().sort((a, b) => b.createdAt - a.createdAt);

function spineColor(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPINES[h % SPINES.length]!;
}

/** One row of the picker's list (full width, divided by dashed walnut lines). */
const ROW = `-mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-[14px] px-2 py-2.5 text-left transition-colors duration-150 ${FOCUS}`;

function LessonRow({
  title,
  meta,
  spine,
  action,
  onChoose,
}: {
  title: string;
  meta: string;
  spine: string;
  action: string;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      data-picker-item
      onClick={onChoose}
      className={`${ROW} group hover:bg-canvas active:bg-canvas`}
    >
      {/* A chunky book spine, outlined like a sticker, with a band near the top. */}
      <span aria-hidden className="flex h-12 w-7 shrink-0 justify-center">
        <span
          className="flex h-12 w-4 flex-col rounded-[5px] border-2 border-walnut pt-2 shadow-[0_2px_0_#1f1a16]"
          style={{ background: spine }}
        >
          <span className="h-1.5 border-y-2 border-walnut" />
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-display text-[15px] leading-5 font-semibold text-walnut">
          {title}
        </span>
        <span className="mt-0.5 block truncate text-[13px] leading-5 font-medium text-ink-soft">
          {meta}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 rounded-[12px] border-2 border-walnut bg-surface px-2.5 py-1 font-display text-[13.5px] font-semibold text-walnut shadow-[0_2px_0_#1f1a16] transition-colors duration-150 group-hover:bg-sun group-focus-visible:bg-sun group-active:translate-y-[2px] group-active:shadow-none">
        <IconPlay size={14} strokeWidth={2.5} />
        {action}
      </span>
    </button>
  );
}

/** Choose what plays on the board: your Learning Studio lessons or the sample. */
function PickerDialog({ boardId }: { boardId: string }) {
  const run = useBoardLessons((s) => s.boards[boardId]);
  const joined = useBoardLessons((s) => s.joinedBoardId === boardId);
  const [lessons, setLessons] = useState<SavedLesson[]>(newestFirst);
  // The Learning Studio opens in a new tab, which a running pomodoro doesn't allow.
  const focusing = usePomodoro(isFocusing);
  const dialog = useRef<HTMLDivElement>(null);

  const close = useCallback((recapture: boolean) => {
    useBoardLessons.getState().openPicker(null);
    // Back to looking around; only possible from a click or key press, hence quiet.
    if (recapture) requestPointerLock({ quiet: true });
  }, []);

  useEffect(() => {
    exitPointerLock();
    dialog.current?.querySelector<HTMLElement>("[data-picker-item]")?.focus();
    // Lessons are made in the Learning Studio's own tab: pick them up on coming back.
    const refresh = () => setLessons(newestFirst());
    const onKey = (e: KeyboardEvent) => {
      const box = dialog.current;
      if (!box) return;
      // Held down, Tab repeats: every press must stay inside.
      if (e.key === "Tab") {
        trapTab(box, e);
        return;
      }
      if (e.repeat) return;
      if (e.key === "Escape" || e.code === "KeyL") {
        e.preventDefault();
        close(false);
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const items = [...box.querySelectorAll<HTMLElement>("[data-picker-item]")];
        const at = items.indexOf(document.activeElement as HTMLElement);
        const step = e.key === "ArrowDown" ? 1 : -1;
        const to = at < 0 ? 0 : (at + step + items.length) % items.length;
        e.preventDefault();
        items[to]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [close]);

  const store = useBoardLessons.getState();
  const choose = (sourceId: string, lesson: Lesson, chunks: Chunk[]) => {
    store.start(boardId, { sourceId, lesson, chunks });
    // Look up and watch the board flip over.
    requestPointerLock({ quiet: true });
  };
  const action = run ? "Replace" : "Play";
  const progress = run
    ? joined
      ? `You're watching · scene ${run.sceneIndex + 1} of ${run.lesson.scenes.length}`
      : run.completed
        ? "Finished"
        : run.sceneIndex > 0
          ? `Waiting at scene ${run.sceneIndex + 1} of ${run.lesson.scenes.length}`
          : "Waiting for someone to join"
    : "";

  return (
    <div
      className="absolute inset-0 z-[25] grid place-items-center bg-walnut/50 p-4 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && close(true)}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-picker-title"
        aria-describedby="lesson-picker-desc"
        className={`${PANEL} title-pop relative flex max-h-full w-full max-w-lg flex-col text-walnut`}
      >
        {/* The board's name as a ribbon on the card's top edge. */}
        <p className={`${RIBBON} absolute -top-3.5 left-6 z-[1]`}>{boardName(boardId)}</p>
        <header
          className={`flex items-start gap-3 border-b-2 border-dashed ${DIVIDER} px-6 pt-7 pb-5`}
        >
          <div className="min-w-0 flex-1">
            <h2 id="lesson-picker-title" className={TITLE}>
              {run ? "Lesson on this board" : "Play a lesson on the board"}
            </h2>
            <p id="lesson-picker-desc" className={`mt-2 ${BODY}`}>
              The board flips over and plays it like a video. Anyone nearby can join in.
            </p>
          </div>
          <button
            type="button"
            onClick={() => close(true)}
            aria-label="Close"
            aria-keyshortcuts="Escape"
            className={`${ICON_BTN} -mt-1.5 -mr-2`}
          >
            <IconClose />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          {run && (
            <section aria-label="Now on the board" className={`${PANEL_MUTED} p-4`}>
              <p className={`${TAG.brass} gap-1.5`}>
                {joined && <LiveDot />}
                Now on the board
              </p>
              <p className="mt-2 truncate font-display text-[19px] leading-snug font-bold text-walnut">
                {run.lesson.title}
              </p>
              <p className="tabular text-[13px] leading-5 font-medium text-ink-soft">{progress}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {joined ? (
                  <button
                    type="button"
                    data-picker-item
                    onClick={() => {
                      close(false);
                      openLessonFullscreen();
                    }}
                    className={BTN.primary}
                  >
                    <IconExpand size={18} />
                    Watch full screen
                  </button>
                ) : (
                  <button
                    type="button"
                    data-picker-item
                    onClick={() => {
                      store.join(boardId);
                      requestPointerLock({ quiet: true });
                    }}
                    className={BTN.primary}
                  >
                    <IconPlay size={18} />
                    Join
                  </button>
                )}
                <button
                  type="button"
                  data-picker-item
                  onClick={() => store.end(boardId)}
                  title="Take the lesson off the board (it flips back)"
                  className={BTN.danger}
                >
                  End lesson
                </button>
              </div>
            </section>
          )}

          <section aria-labelledby="lesson-picker-list">
            <h3 id="lesson-picker-list" className={EYEBROW}>
              {run ? "Replace with…" : "Your lessons"}
            </h3>
            {lessons.length === 0 && (
              <div className={`mt-2 ${PANEL_MUTED} p-4 text-[13px] leading-5 text-ink-soft`}>
                <p className="font-display text-[15px] font-semibold text-walnut">
                  No lessons of your own yet
                </p>
                <p className="mt-1">
                  The AI Learning Studio turns a PDF of your notes into a narrated lesson. Make one
                  and it shows up here. Until then, try the sample.
                </p>
              </div>
            )}
            <ul className={`mt-2 border-t-2 border-dashed ${DIVIDER}`}>
              {lessons.map((l) => (
                <li key={l.id} className={`border-b-2 border-dashed ${DIVIDER} py-1`}>
                  <LessonRow
                    title={l.lesson.title}
                    meta={`${l.lesson.subject} · ${sceneCount(l.lesson)} · ${new Date(
                      l.createdAt,
                    ).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
                    spine={spineColor(l.id)}
                    action={action}
                    onChoose={() => choose(l.id, l.lesson, l.chunks)}
                  />
                </li>
              ))}
              <li className={`border-b-2 border-dashed ${DIVIDER} py-1`}>
                <LessonRow
                  title={`Sample: ${SAMPLE_LESSON.title}`}
                  meta={`${SAMPLE_LESSON.subject} · ${sceneCount(SAMPLE_LESSON)} · see how a lesson works`}
                  spine="#7fb27a"
                  action={action}
                  onChoose={() => choose(SAMPLE_ID, SAMPLE_LESSON, SAMPLE_NOTES)}
                />
              </li>
              <li className="py-1">
                <button
                  type="button"
                  data-picker-item
                  onClick={
                    focusing
                      ? undefined
                      : () => window.open("/learning-studio", "_blank", "noopener")
                  }
                  aria-disabled={focusing || undefined}
                  title={focusing ? "Opens a new tab — available after your pomodoro" : undefined}
                  className={`${ROW} ${focusing ? "cursor-not-allowed" : "hover:bg-canvas active:bg-canvas"}`}
                >
                  <span aria-hidden className="grid h-12 w-7 shrink-0 place-items-center">
                    <span className="grid h-7 w-7 place-items-center rounded-full border-2 border-dashed border-walnut/50 text-walnut">
                      <IconPlus size={16} strokeWidth={2.5} />
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block font-display text-[15px] leading-5 font-semibold ${focusing ? "text-ink-soft" : "text-walnut"}`}
                    >
                      Make a new lesson
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-5 font-medium text-ink-soft">
                      {focusing
                        ? "Opens a new tab — available after your pomodoro"
                        : "Opens the AI Learning Studio in a new tab"}
                    </span>
                  </span>
                  {!focusing && <IconArrowUpRight size={16} className="mr-2.5 text-ink-soft" />}
                </button>
              </li>
            </ul>
          </section>
        </div>

        <footer
          className={`flex items-center justify-center gap-5 border-t-2 border-dashed ${DIVIDER} px-6 py-3 font-display text-xs font-medium text-ink-soft`}
        >
          <span className="flex items-center gap-1.5">
            <kbd className={KBD_SM}>
              <IconChevronDown size={12} className="rotate-180" />
              <span className="sr-only">Up arrow</span>
            </kbd>
            <kbd className={KBD_SM}>
              <IconChevronDown size={12} />
              <span className="sr-only">Down arrow</span>
            </kbd>
            choose
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className={KBD_SM}>Enter</kbd> play
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className={KBD_SM}>Esc</kbd> close
          </span>
        </footer>
      </div>
    </div>
  );
}
