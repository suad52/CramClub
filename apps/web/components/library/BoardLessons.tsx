"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LessonPlayerView, Question } from "@/components/learning-studio/LessonPlayer";
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

const KBD_SM = "kbd !h-5 !min-w-5 !px-1 !text-[0.65rem]";
const FOCUS = "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember";
const ICON_BTN = `grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink ring-1 ring-ink/15 transition hover:bg-ink/5 ${FOCUS}`;
const HEADER_BTN = `rounded-full px-3 py-2 text-sm font-bold ring-1 transition ${FOCUS}`;
/** Book-spine colours for the lesson list (the loading screen's palette). */
const SPINES = ["#8c3f3a", "#3f5f4a", "#c99a45", "#34466a", "#a5643f"];

const GLYPHS = {
  play: { d: "M8 5.5v13l10.5-6.5z", fill: true },
  pause: { d: "M7 5h3.6v14H7zM13.4 5H17v14h-3.4z", fill: true },
  next: { d: "M6 5.5v13l9.5-6.5zM15.8 5.5h2.6v13h-2.6z", fill: true },
  expand: { d: "M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5", fill: false },
  close: { d: "M6.5 6.5l11 11M17.5 6.5l-11 11", fill: false },
  plus: { d: "M12 5v14M5 12h14", fill: false },
};

function Glyph({ name, className = "h-4 w-4" }: { name: keyof typeof GLYPHS; className?: string }) {
  const g = GLYPHS[name];
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      className={className}
      fill={g.fill ? "currentColor" : "none"}
      stroke={g.fill ? "none" : "currentColor"}
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={g.d} />
    </svg>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
    </span>
  );
}

/**
 * A menu, the controls guide, My Progress, a whiteboard, the picker or the full-screen lesson is
 * over the library: the HUD cards step aside (and their hotkeys with them, so Enter in a menu
 * stays there).
 */
function useCovered() {
  const menu = useGameStore((s) => s.menuOpen || s.guideOpen || s.progressOpen);
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
        <div className="pointer-events-none absolute bottom-4 left-4 z-[12] flex flex-col items-start gap-3">
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
      className="pointer-events-auto rounded-2xl bg-cream/90 p-2 text-ink shadow-[0_18px_40px_-18px_rgb(20_12_6/0.65)] ring-1 ring-ink/10 backdrop-blur transition duration-300 ease-out starting:translate-y-3 starting:opacity-0"
      style={{ width: PREVIEW_W + 16 }}
    >
      <button
        type="button"
        onClick={openLessonFullscreen}
        aria-label="Open the lesson full screen"
        aria-keyshortcuts="F"
        className={`group relative block w-full overflow-hidden rounded-xl bg-[#f4efe4] ring-1 ring-ink/10 ${FOCUS}`}
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
              <span className="block text-[0.65rem] font-extrabold tracking-wide text-ember uppercase">
                {boardName(run.boardId)}
              </span>
              <span className="mt-1 line-clamp-2 block font-display text-lg leading-tight font-semibold">
                {lesson.title}
              </span>
            </span>
          </span>
        )}
        <span className="absolute top-2 left-2 flex items-center gap-1.5 rounded-full bg-ink/80 px-2 py-0.5 text-[0.62rem] font-extrabold tracking-wide text-cream uppercase">
          {status.live && <LiveDot />}
          {status.text}
        </span>
        <span className="absolute inset-0 grid place-items-center bg-ink/0 opacity-0 transition group-hover:bg-ink/30 group-hover:opacity-100 group-focus-visible:bg-ink/30 group-focus-visible:opacity-100">
          <span className="flex items-center gap-2 rounded-full bg-cream px-3 py-1.5 text-sm font-bold text-ink shadow-lg">
            <Glyph name="expand" />
            Full screen
            <span className={KBD_SM}>F</span>
          </span>
        </span>
      </button>

      <div
        className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10"
        role="progressbar"
        aria-label="Lesson progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(overall * 100)}
      >
        <span
          className="block h-full rounded-full bg-wood transition-[width] duration-300"
          style={{ width: `${overall * 100}%` }}
        />
      </div>

      <div className="flex items-center gap-2 px-1 pt-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm leading-tight font-extrabold" title={lesson.title}>
            {lesson.title}
          </p>
          <p className="truncate text-xs leading-tight text-ink-soft">
            {complete ? "Lesson complete" : `Scene ${index + 1} of ${total}`} · Table{" "}
            {tableNumberOf(run.boardId)}
          </p>
        </div>
        {complete ? (
          <button
            type="button"
            onClick={leave}
            className={`rounded-full bg-ink px-3.5 py-1.5 text-xs font-bold text-cream transition hover:bg-wood-dark ${FOCUS}`}
          >
            Done
          </button>
        ) : readOn(playback) ? (
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="Next scene"
            title="Next scene"
            className={ICON_BTN}
          >
            <Glyph name="next" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggle}
            aria-label={playing ? "Pause the lesson" : "Play the lesson"}
            className={ICON_BTN}
          >
            <Glyph name={playing ? "pause" : "play"} />
          </button>
        )}
        <button
          type="button"
          onClick={openLessonFullscreen}
          aria-label="Full screen"
          aria-keyshortcuts="F"
          title="Full screen (F)"
          className={ICON_BTN}
        >
          <Glyph name="expand" />
        </button>
        {!complete && (
          <button
            type="button"
            onClick={leave}
            aria-label="Leave the lesson"
            title="Leave the lesson (it waits on the board)"
            className={ICON_BTN}
          >
            <Glyph name="close" />
          </button>
        )}
      </div>
      {locked && (
        <p className="flex items-center gap-1 px-1 pt-2 text-[0.7rem] font-bold text-ink-soft">
          Hold <span className={KBD_SM}>Shift</span> to click · <span className={KBD_SM}>F</span>{" "}
          full screen
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
      className="pointer-events-auto max-h-[calc(100dvh-24.5rem)] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto rounded-2xl transition duration-300 ease-out starting:translate-y-3 starting:opacity-0"
    >
      <p className="mb-1.5 inline-flex items-center gap-1.5 rounded-full bg-ink/85 px-2.5 py-1 text-[0.68rem] font-bold text-cream shadow backdrop-blur">
        <span className="font-extrabold tracking-wide text-lamp uppercase">Quick check</span>
        {q.type === "multiple-choice"
          ? `· press 1–${q.options?.length ?? 4}, then Enter`
          : "· Enter to go on"}
        {locked && " · hold Shift to click"}
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
      className="absolute inset-0 z-[18] origin-bottom-left bg-parchment outline-none transition duration-[220ms] ease-out starting:scale-30 starting:opacity-0 motion-reduce:transition-none"
    >
      <LessonPlayerView
        playback={playback}
        chunks={run.chunks}
        fill
        keyboardShortcuts={open}
        onExit={closeLessonFullscreen}
        exitLabel="↙ Back to the library"
        headerActions={
          <>
            {canFill && (
              <button
                type="button"
                onClick={toggleFill}
                aria-pressed={filling}
                title={filling ? "Exit full screen" : "Fill the whole screen"}
                className={`${HEADER_BTN} grid place-items-center text-ink ring-ink/15 hover:bg-ink/5`}
              >
                <Glyph name="expand" />
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
              className={`${HEADER_BTN} text-ink ring-ink/15 hover:bg-ink/5`}
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
              className={`${HEADER_BTN} text-ember ring-ember/40 hover:bg-ember/10`}
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
          className="pointer-events-auto w-full max-w-[26rem] rounded-3xl bg-cream/95 p-4 text-ink shadow-[0_24px_60px_-22px_rgb(20_12_6/0.7)] ring-1 ring-ink/10 backdrop-blur transition duration-300 ease-out starting:translate-y-4 starting:opacity-0"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden
              className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-ink text-cream shadow-inner"
            >
              <Glyph name="play" className="ml-0.5 h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.7rem] font-extrabold tracking-wide text-ember uppercase">
                {boardName(offer.boardId)} is playing a lesson
              </p>
              <p className="truncate font-display text-lg leading-snug font-semibold">
                {offer.lesson.title}
              </p>
              <p className="truncate text-xs text-ink-soft">
                {offer.lesson.subject} · {sceneCount(offer.lesson)}
                {offer.sceneIndex > 0 && ` · waiting at scene ${offer.sceneIndex + 1}`}
              </p>
            </div>
          </div>
          <div className="mt-3.5 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => join(offer.boardId)}
              aria-keyshortcuts="J"
              className={`flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-bold text-cream shadow transition hover:bg-wood-dark ${FOCUS}`}
            >
              <span className={KBD_SM}>J</span>
              Join
            </button>
            <button
              type="button"
              onClick={() => decline(offer.boardId)}
              aria-keyshortcuts="N"
              className={`flex items-center justify-center gap-2 rounded-full bg-parchment px-4 py-2.5 text-sm font-bold text-ink ring-1 ring-ink/10 transition hover:ring-ink/30 ${FOCUS}`}
            >
              <span className={KBD_SM}>N</span>
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
      className={`group flex w-full items-center gap-3 rounded-2xl bg-white/55 p-3 text-left ring-1 ring-ink/10 transition hover:bg-white hover:ring-ink/25 focus-visible:bg-white ${FOCUS}`}
    >
      <span
        aria-hidden
        className="h-11 w-3 shrink-0 rounded-[0.3rem] shadow-[inset_-2px_0_0_rgb(0_0_0/0.18)]"
        style={{ background: spine }}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{title}</span>
        <span className="block truncate text-xs text-ink-soft">{meta}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-bold text-cream opacity-80 transition group-hover:opacity-100 group-focus-visible:opacity-100">
        <Glyph name="play" className="h-3 w-3" />
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
      className="studio-fade-in absolute inset-0 z-[25] grid place-items-center bg-ink/40 p-4 backdrop-blur-[3px] sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && close(true)}
    >
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lesson-picker-title"
        aria-describedby="lesson-picker-desc"
        className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-cream text-ink shadow-[0_30px_80px_-20px_rgb(20_12_6/0.6)] ring-1 ring-ink/10 transition duration-300 ease-out starting:translate-y-4 starting:opacity-0"
      >
        <header className="flex items-start gap-3 border-b border-ink/10 px-6 pt-5 pb-4">
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-extrabold tracking-wide text-ember uppercase">
              {boardName(boardId)}
            </p>
            <h2 id="lesson-picker-title" className="font-display text-2xl font-semibold">
              {run ? "Lesson on this board" : "Play a lesson on the board"}
            </h2>
            <p id="lesson-picker-desc" className="mt-1 text-sm text-ink-soft">
              The board flips over and plays it like a video. Anyone nearby can join in.
            </p>
          </div>
          <button
            type="button"
            onClick={() => close(true)}
            aria-label="Close"
            aria-keyshortcuts="Escape"
            className={`-mt-1 -mr-2 grid h-9 w-9 place-items-center rounded-full text-ink-soft transition hover:bg-ink/5 hover:text-ink ${FOCUS}`}
          >
            <Glyph name="close" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {run && (
            <section
              aria-label="Now on the board"
              className="rounded-2xl bg-ink p-4 text-cream shadow-inner"
            >
              <p className="flex items-center gap-2 text-[0.68rem] font-extrabold tracking-wide text-lamp uppercase">
                {joined && <LiveDot />}
                Now on the board
              </p>
              <p className="mt-0.5 truncate font-display text-lg font-semibold">
                {run.lesson.title}
              </p>
              <p className="text-xs text-cream/75">{progress}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {joined ? (
                  <button
                    type="button"
                    data-picker-item
                    onClick={() => {
                      close(false);
                      openLessonFullscreen();
                    }}
                    className={`flex items-center gap-2 rounded-full bg-cream px-4 py-2 text-sm font-bold text-ink transition hover:bg-white ${FOCUS}`}
                  >
                    <Glyph name="expand" />
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
                    className={`flex items-center gap-2 rounded-full bg-cream px-4 py-2 text-sm font-bold text-ink transition hover:bg-white ${FOCUS}`}
                  >
                    <Glyph name="play" className="h-3.5 w-3.5" />
                    Join
                  </button>
                )}
                <button
                  type="button"
                  data-picker-item
                  onClick={() => store.end(boardId)}
                  title="Take the lesson off the board (it flips back)"
                  className={`rounded-full px-4 py-2 text-sm font-bold text-cream ring-1 ring-cream/30 transition hover:bg-cream/10 ${FOCUS}`}
                >
                  End lesson
                </button>
              </div>
            </section>
          )}

          <section aria-labelledby="lesson-picker-list">
            <h3 id="lesson-picker-list" className="text-sm font-extrabold">
              {run ? "Replace with…" : "Your lessons"}
            </h3>
            {lessons.length === 0 && (
              <div className="mt-2 rounded-2xl bg-parchment p-4 text-sm text-ink-soft ring-1 ring-ink/10">
                <p className="font-bold text-ink">No lessons of your own yet</p>
                <p className="mt-1">
                  The AI Learning Studio turns a PDF of your notes into a narrated lesson. Make one
                  and it shows up here. Until then, try the sample.
                </p>
              </div>
            )}
            <ul className="mt-2 space-y-2">
              {lessons.map((l) => (
                <li key={l.id}>
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
              <li>
                <LessonRow
                  title={`Sample: ${SAMPLE_LESSON.title}`}
                  meta={`${SAMPLE_LESSON.subject} · ${sceneCount(SAMPLE_LESSON)} · see how a lesson works`}
                  spine="#6f8f6a"
                  action={action}
                  onChoose={() => choose(SAMPLE_ID, SAMPLE_LESSON, SAMPLE_NOTES)}
                />
              </li>
              <li>
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
                  className={`flex w-full items-center gap-3 rounded-2xl border-2 border-dashed border-ink/15 p-3 text-left transition ${focusing ? "cursor-not-allowed opacity-60" : "hover:border-ink/30 hover:bg-white/40"} ${FOCUS}`}
                >
                  <span
                    aria-hidden
                    className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-parchment text-ink-soft"
                  >
                    <Glyph name="plus" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">Make a new lesson</span>
                    <span className="block text-xs text-ink-soft">
                      {focusing
                        ? "Opens a new tab — available after your pomodoro"
                        : "Opens the AI Learning Studio in a new tab"}
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </section>
        </div>

        <footer className="flex items-center justify-center gap-3 border-t border-ink/10 px-6 py-3 text-xs font-bold text-ink-soft">
          <span className="flex items-center gap-1">
            <span className={KBD_SM}>↑</span>
            <span className={KBD_SM}>↓</span> choose
          </span>
          <span className="flex items-center gap-1">
            <span className={KBD_SM}>Enter</span> play
          </span>
          <span className="flex items-center gap-1">
            <span className={KBD_SM}>Esc</span> close
          </span>
        </footer>
      </div>
    </div>
  );
}
