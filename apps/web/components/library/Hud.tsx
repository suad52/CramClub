"use client";

import { ZONES } from "@ovr/shared";
import {
  WHITEBOARDS,
  getLift,
  getSeat,
  hasLessonFace,
  interact,
  joinNearbyLesson,
  openLessonPicker,
  openTableBoard,
} from "@/lib/game/actions";
import { exitPointerLock } from "@/lib/game/pointer";
import { isFocusing, usePomodoro } from "@/lib/game/pomodoro";
import { useGameStore } from "@/lib/game/store";
import { tableNumberOf, useBoardLessons } from "@/lib/learning-studio/boardLessons";
import { TrackingButton } from "./ExpressionTracking";
import { openProgress } from "./ProgressOverlay";

const zoneById = new Map(ZONES.map((z) => [z.id, z]));

function IconButton({
  label,
  shortcut,
  unavailable,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  /** Why it can't be used right now; it stays focusable so the reason can be read. */
  unavailable?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={unavailable ? undefined : onClick}
      aria-disabled={unavailable ? true : undefined}
      title={unavailable ?? (shortcut ? `${label} (${shortcut})` : label)}
      className={`pointer-events-auto flex h-10 items-center gap-2 rounded-full bg-cream/90 px-3.5 text-sm font-bold text-ink shadow-md ring-1 ring-ink/10 backdrop-blur transition focus-visible:outline-3 focus-visible:outline-ember ${unavailable ? "cursor-not-allowed opacity-60" : "hover:bg-cream"}`}
    >
      {children}
      <span className="sr-only">{unavailable ? `${label}. ${unavailable}` : label}</span>
      {shortcut && <span className="kbd !h-6 !min-w-6 !text-[0.7rem]">{shortcut}</span>}
    </button>
  );
}

function ZoneBadge() {
  const zoneId = useGameStore((s) => s.zoneId);
  const zone = zoneId ? zoneById.get(zoneId) : undefined;
  return (
    <div className="pointer-events-auto flex items-center gap-3 rounded-2xl bg-cream/90 py-2 pr-4 pl-3 shadow-md ring-1 ring-ink/10 backdrop-blur">
      <span className="font-display text-xl font-semibold tracking-tight">OVR</span>
      <span className="h-6 w-px bg-ink/15" aria-hidden />
      <div className="min-w-36" aria-live="polite">
        <p key={zone?.id} className="text-sm leading-tight font-extrabold ">
          {zone?.name ?? "The library"}
        </p>
        <p className="text-xs leading-tight text-ink-soft">{zone?.blurb ?? ""}</p>
      </div>
      <span
        className="ml-1 rounded-full bg-ember/15 px-2 py-0.5 text-[0.68rem] font-extrabold tracking-wide text-ember uppercase"
        title="You're exploring on your own for now. Studying with other people arrives in a later update."
      >
        Solo preview
      </span>
    </div>
  );
}

/** Shows while "walk faster" is on, and doubles as the off switch. */
function WalkFastChip() {
  const on = useGameStore((s) => s.walkFast);
  const toggle = useGameStore((s) => s.toggleWalkFast);
  if (!on) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      title="Walking faster (R to switch off)"
      className="pointer-events-auto flex items-center gap-2 rounded-full bg-cream/90 py-1 pr-1.5 pl-3 text-xs font-extrabold text-ink shadow-md ring-1 ring-ink/10 backdrop-blur hover:bg-cream"
    >
      Walking faster
      <span className="kbd !h-5 !min-w-5 !text-[0.65rem]">R</span>
    </button>
  );
}

const PROMPT_BUTTON =
  "pointer-events-auto flex items-center gap-3 rounded-full bg-ink/85 py-2.5 pr-5 pl-2.5 text-[0.95rem] font-bold text-cream shadow-lg backdrop-blur transition hover:bg-ink";

function InteractionPrompt() {
  const seatId = useGameStore((s) => s.seatId);
  // Mid-pomodoro you stay seated; the table timer's "Leave table" is the way out.
  const seatLocked = usePomodoro((s) => !!seatId && isFocusing(s));
  const nearby = useGameStore((s) => s.nearbySeatId);
  const nearbyBoard = useGameStore((s) => s.nearbyBoardId);
  const nearbyLift = useGameStore((s) => s.nearbyLiftId);
  const seat = getSeat(seatId);
  const label = seatId
    ? "Stand up"
    : nearbyBoard
      ? "Use whiteboard"
      : nearbyLift
        ? getLift(nearbyLift)?.label
        : getSeat(nearby)?.prompt;
  const tableBoard =
    seat?.tableId && WHITEBOARDS.some((b) => b.boardId === seat.tableId) ? seat.tableId : null;
  // The board L puts a lesson on (see lessonBoardId), and a nearby lesson you could join.
  const atBoard = nearbyBoard ?? tableBoard;
  const lessonBoard = hasLessonFace(atBoard) ? atBoard : null;
  const boardHasLesson = useBoardLessons((s) => !!lessonBoard && !!s.boards[lessonBoard]);
  // Joining later, after "Not now" (until then the join card offers it).
  const joinable = useBoardLessons((s) => {
    const id = s.inRangeBoardId;
    const run = id ? s.boards[id] : undefined;
    return run && s.joinedBoardId !== id && s.declined[run.boardId] === run.startedAt ? id : null;
  });
  const lessonOverlay = useBoardLessons((s) => s.fullscreen || s.pickerBoardId !== null);
  // Keeps clear of the lesson preview in the bottom-left corner (a long row wraps upwards).
  const previewShown = useBoardLessons((s) => s.joinedBoardId !== null);
  if (!label || lessonOverlay) return null;
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-10 flex flex-wrap-reverse justify-center gap-3 ${previewShown ? "px-[21.5rem]" : ""}`}
    >
      {!seatLocked && (
        <button type="button" onClick={() => interact()} className={PROMPT_BUTTON}>
          <span className="kbd">E</span>
          {label}
        </button>
      )}
      {tableBoard && (
        <button type="button" onClick={() => openTableBoard()} className={PROMPT_BUTTON}>
          <span className="kbd">B</span>
          Table whiteboard
        </button>
      )}
      {lessonBoard && (
        <button type="button" onClick={() => openLessonPicker()} className={PROMPT_BUTTON}>
          <span className="kbd">L</span>
          {boardHasLesson ? "Lessons" : "Play a lesson"}
        </button>
      )}
      {lessonBoard && joinable && (
        <button type="button" onClick={() => joinNearbyLesson()} className={PROMPT_BUTTON}>
          <span className="kbd">J</span>
          {joinable === lessonBoard
            ? "Join lesson"
            : `Join Table ${tableNumberOf(joinable)}'s lesson`}
        </button>
      )}
    </div>
  );
}

function Crosshair() {
  const fp = useGameStore((s) => s.cameraMode === "first-person");
  const locked = useGameStore((s) => s.pointerLocked);
  if (!fp || !locked) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-1/2 left-1/2 h-1.5 w-1.5 -translate-1/2 rounded-full bg-cream/90 shadow-[0_0_0_1.5px_rgb(45_36_32/0.5)]"
    />
  );
}

export function Hud() {
  const ready = useGameStore((s) => s.ready);
  const cameraMode = useGameStore((s) => s.cameraMode);
  const toggleCamera = useGameStore((s) => s.toggleCameraMode);
  const setGuideOpen = useGameStore((s) => s.setGuideOpen);
  const setMenuOpen = useGameStore((s) => s.setMenuOpen);
  const phase = useGameStore((s) => s.phase);
  const focusing = usePomodoro(isFocusing);
  if (!ready || phase !== "playing") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute top-4 left-4 flex flex-col items-start gap-2">
        <ZoneBadge />
        <WalkFastChip />
      </div>
      <div className="absolute top-4 right-4 flex gap-2">
        <IconButton
          label="AI Learning Studio: turn your notes into a lesson (opens in a new tab)"
          unavailable={focusing ? "Opens a new tab — available after your pomodoro" : undefined}
          onClick={() => {
            exitPointerLock();
            window.open("/learning-studio", "_blank", "noopener");
          }}
        >
          <span aria-hidden>🎓</span>
          <span className="hidden lg:inline">Learning Studio</span>
        </IconButton>
        <IconButton
          label="My Progress: your focus time, lessons, quizzes and leaderboards"
          onClick={openProgress}
        >
          <span aria-hidden>📈</span>
          <span className="hidden lg:inline">My Progress</span>
        </IconButton>
        <TrackingButton />
        <IconButton
          label={
            cameraMode === "first-person" ? "Switch to third person" : "Switch to first person"
          }
          shortcut="V"
          onClick={toggleCamera}
        >
          <span aria-hidden>{cameraMode === "first-person" ? "👁" : "🧍"}</span>
          <span className="hidden lg:inline">
            {cameraMode === "first-person" ? "First person" : "Third person"}
          </span>
        </IconButton>
        <IconButton label="Controls" onClick={() => setGuideOpen(true)}>
          <span aria-hidden>?</span>
        </IconButton>
        <IconButton
          label="Menu"
          shortcut="Esc"
          onClick={() => {
            exitPointerLock();
            setMenuOpen(true);
          }}
        >
          <span aria-hidden>☰</span>
        </IconButton>
      </div>
      <InteractionPrompt />
      <Crosshair />
    </div>
  );
}
