"use client";

import { useEffect, useState } from "react";
import { ZONES } from "@ovr/shared";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { IconUsers } from "@/components/ui/icons";
import { HUD_CHIP, HUD_MUTED } from "@/components/ui/styles";
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
import { useChat } from "@/lib/chat/store";
import { tableNumberOf, useBoardLessons } from "@/lib/learning-studio/boardLessons";
import { useNet } from "@/lib/net/connection";
import { CameraOnChip } from "./ExpressionTracking";

/*
 * The HUD over the 3D library stays minimal: where you are (top left), the menu (top right), and
 * what you can do right here (bottom centre). Everything else lives in the menu sheet (PauseMenu
 * in Overlays.tsx). Its height matters: the pomodoro card sits just under the zone chip (and the
 * "Walking faster" chip) at top-20 / top-[7.25rem], see Pomodoro.tsx. Bottom left: the library
 * chat (components/chat/ChatPanel.tsx), above the first "how to move" hint while that shows; the
 * lesson preview has the bottom-right corner (BoardLessons.tsx).
 */

const zoneById = new Map(ZONES.map((z) => [z.id, z]));

/**
 * A cream sticker with a black outline over the scene (the title screen's chosen menu item): the
 * things you can click right now. It lifts on hover and presses down on click.
 */
const CREAM_STICKER =
  "inline-flex items-center rounded-[16px] border-[3px] border-black/80 bg-surface font-display font-semibold text-walnut shadow-[0_4px_0_rgb(0_0_0/0.55)] transition-[background-color,transform,box-shadow] duration-150 ease-out outline-none hover:-translate-y-px hover:bg-[#fff6dc] focus-visible:ring-4 focus-visible:ring-sun focus-visible:ring-offset-2 focus-visible:ring-offset-walnut active:translate-y-[3px] active:shadow-[0_1px_0_rgb(0_0_0/0.55)] motion-reduce:transition-none";

/** A sun keycap for the cream stickers (the plain keycap is cream too). */
const SUN_KEY = "kbd !bg-sun";

/** Where you are: the zone's name and its one-line description. */
function ZoneChip() {
  const zoneId = useGameStore((s) => s.zoneId);
  const zone = zoneId ? zoneById.get(zoneId) : undefined;
  return (
    <div
      className={`${HUD_CHIP} pointer-events-auto max-w-[calc(100vw-9rem)] sm:max-w-80 px-3.5 py-2`}
    >
      <div aria-live="polite">
        <p
          key={zone?.id}
          className="title-pop flex items-center gap-2 text-[14px] leading-5 font-semibold"
        >
          <span
            aria-hidden
            className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-black/80 bg-leaf"
          />
          <span className="min-w-0 truncate">{zone?.name ?? "The library"}</span>
        </p>
        {zone?.blurb && (
          <p className={`truncate pl-[1.125rem] text-xs leading-4 font-medium ${HUD_MUTED}`}>
            {zone.blurb}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Who's here (top right): "3 here" while you're in a shared library, with how the link is doing
 * when it isn't. Hidden when there's no game server at all (the library is simply solo).
 */
function PresenceChip() {
  const status = useNet((s) => s.status);
  const count = useNet((s) => s.count);
  const name = useNet((s) => s.name);
  if (status === "offline") return null;
  const online = status === "online";
  const label = online
    ? count <= 1
      ? "Just you here"
      : `${count} here`
    : status === "connecting"
      ? "Connecting…"
      : status === "full"
        ? "Library full: exploring solo"
        : "Offline: exploring solo";
  const you = name ? ` Others see you as ${name}.` : "";
  const title = online
    ? count <= 1
      ? `You're the only one in this library right now. Others appear as they come in.${you}`
      : `${count} people in this library, you included.${you}`
    : status === "connecting"
      ? "Joining the library so you can see who else is here."
      : status === "full"
        ? "Every library is full right now. You can keep studying; we'll let you in when there's room."
        : "Can't reach the library server. You can keep studying on your own; we'll keep trying.";
  const dot = online
    ? "bg-leaf"
    : status === "connecting"
      ? "bg-sun animate-pulse"
      : "bg-walnut-muted";
  return (
    <div
      role="status"
      title={title}
      className={`${HUD_CHIP} pointer-events-auto inline-flex h-10 items-center gap-2 px-3 text-[14px] font-semibold`}
    >
      <IconUsers size={18} strokeWidth={2.25} />
      <span className="whitespace-nowrap">
        {label}
        {online && count > 1 && <span className="sr-only"> in this library</span>}
      </span>
      <span
        aria-hidden
        className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 border-black/80 motion-reduce:animate-none ${dot}`}
      />
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
      aria-keyshortcuts="R"
      className={`${HUD_CHIP} pointer-events-auto inline-flex items-center gap-2 py-1 pr-1.5 pl-2.5 text-xs font-semibold transition-[background-color,transform,box-shadow] duration-150 outline-none hover:-translate-y-px hover:bg-walnut/95 focus-visible:ring-4 focus-visible:ring-sun active:translate-y-[3px] active:bg-walnut active:shadow-[0_1px_0_rgb(0_0_0/0.55)] motion-reduce:transition-none`}
    >
      <span
        aria-hidden
        className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-black/80 bg-leaf"
      />
      Walking faster
      <kbd className="kbd kbd-dark !h-5 !min-w-5 !text-[0.68rem]" aria-hidden>
        R
      </kbd>
    </button>
  );
}

/** Top right: the one way into everything else. */
function MenuButton() {
  const setMenuOpen = useGameStore((s) => s.setMenuOpen);
  const menuOpen = useGameStore((s) => s.menuOpen);
  return (
    <button
      type="button"
      onClick={() => {
        exitPointerLock();
        setMenuOpen(true);
      }}
      title="Menu (Esc)"
      aria-haspopup="dialog"
      aria-expanded={menuOpen}
      aria-keyshortcuts="Escape"
      className={`${CREAM_STICKER} pointer-events-auto h-10 gap-2.5 px-3.5 text-[15px]`}
    >
      Menu
      <kbd className={SUN_KEY} aria-hidden>
        Esc
      </kbd>
    </button>
  );
}

const PROMPT_BUTTON = `${CREAM_STICKER} pointer-events-auto gap-2.5 py-1.5 pr-4 pl-1.5 text-[15px] title-pop`;

/** A prompt for something you can do right here: its key, then what it does. */
function Prompt({
  keyLabel,
  onClick,
  children,
}: {
  keyLabel: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} aria-keyshortcuts={keyLabel} className={PROMPT_BUTTON}>
      <kbd className={`${SUN_KEY} !h-7 !min-w-7 !text-[0.85rem]`} aria-hidden>
        {keyLabel}
      </kbd>
      {children}
    </button>
  );
}

/** The plan's seat prompts, in the redesign's words ("Use desk" for the study tables). */
const SEAT_PROMPTS: Record<string, string> = { "Study at table": "Use desk" };

function InteractionPrompt() {
  const seatId = useGameStore((s) => s.seatId);
  // Mid-pomodoro you stay seated; the table timer's "Leave table" is the way out.
  const seatLocked = usePomodoro((s) => !!seatId && isFocusing(s));
  const nearby = useGameStore((s) => s.nearbySeatId);
  const nearbyBoard = useGameStore((s) => s.nearbyBoardId);
  const nearbyLift = useGameStore((s) => s.nearbyLiftId);
  const nearbyLibrarian = useGameStore((s) => s.nearbyLibrarian);
  const seat = getSeat(seatId);
  const seatPrompt = getSeat(nearby)?.prompt;
  const label = seatId
    ? "Stand up"
    : nearbyBoard
      ? "Use whiteboard"
      : nearbyLift
        ? getLift(nearbyLift)?.label
        : nearbyLibrarian
          ? "Speak with the Librarian"
          : seatPrompt && (SEAT_PROMPTS[seatPrompt] ?? seatPrompt);
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
  // Keeps clear of the lesson preview in the bottom-right corner and the open chat in the
  // bottom-left one (a long row wraps upwards).
  const previewShown = useBoardLessons((s) => s.joinedBoardId !== null);
  const chatOpen = useChat((s) => s.open);
  if (!label || lessonOverlay) return null;
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 bottom-10 flex flex-wrap-reverse justify-center gap-2.5 ${chatOpen ? "px-[23rem]" : previewShown ? "px-[21.5rem]" : "px-4"}`}
    >
      {!seatLocked && (
        <Prompt keyLabel="E" onClick={() => interact()}>
          {label}
        </Prompt>
      )}
      {tableBoard && (
        <Prompt keyLabel="B" onClick={() => openTableBoard()}>
          Table whiteboard
        </Prompt>
      )}
      {lessonBoard && (
        <Prompt keyLabel="L" onClick={() => openLessonPicker()}>
          {boardHasLesson ? "Lessons" : "Play a lesson"}
        </Prompt>
      )}
      {lessonBoard && joinable && (
        <Prompt keyLabel="J" onClick={() => joinNearbyLesson()}>
          {joinable === lessonBoard
            ? "Join lesson"
            : `Join Table ${tableNumberOf(joinable)}'s lesson`}
        </Prompt>
      )}
    </div>
  );
}

/** How long the first "how to move" hint stays up once you're walking around. */
const HINT_MS = 6000;
/** A key typed into a text box (the chat, a form) is text, not a move. */
function isTextBox(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

const MOVE_KEYS = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/** How long the hint takes to fade before it makes room for the chat. */
const HINT_FADE_MS = 500;

/**
 * Bottom left, just after you walk in: the three controls you need first, under the chat pill.
 * It fades away after a few seconds or as soon as you start walking, then makes room. The clock
 * waits while the controls guide is open.
 */
function ControlsHint() {
  const guideOpen = useGameStore((s) => s.guideOpen);
  const [gone, setGone] = useState(false);
  const [removed, setRemoved] = useState(false);
  useEffect(() => {
    if (gone || guideOpen) return;
    const timer = setTimeout(() => setGone(true), HINT_MS);
    const onKey = (e: KeyboardEvent) => {
      if (MOVE_KEYS.has(e.code) && !isTextBox(e.target)) setGone(true);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [gone, guideOpen]);
  useEffect(() => {
    if (!gone) return;
    const timer = setTimeout(() => setRemoved(true), HINT_FADE_MS);
    return () => clearTimeout(timer);
  }, [gone]);
  if (removed) return null;
  return (
    <div
      aria-hidden={gone}
      className={`${HUD_CHIP} pointer-events-none hidden items-center gap-4 py-1.5 pr-3.5 pl-1.5 text-xs font-semibold transition-opacity duration-500 motion-reduce:transition-none sm:flex ${gone ? "opacity-0" : "opacity-100"}`}
    >
      <span className="flex items-center gap-2">
        <kbd className="kbd kbd-dark">W A S D</kbd>
        <span className={HUD_MUTED}>Move</span>
      </span>
      <span className="flex items-center gap-2">
        <kbd className="kbd kbd-dark">Mouse</kbd>
        <span className={HUD_MUTED}>Look</span>
      </span>
      <span className="flex items-center gap-2">
        <kbd className="kbd kbd-dark">Shift</kbd>
        <span className={HUD_MUTED}>Free the cursor</span>
      </span>
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
      className="pointer-events-none absolute top-1/2 left-1/2 h-2.5 w-2.5 -translate-1/2 rounded-full border-2 border-black/70 bg-surface/95"
    />
  );
}

export function Hud() {
  const ready = useGameStore((s) => s.ready);
  const phase = useGameStore((s) => s.phase);
  if (!ready || phase !== "playing") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute top-4 left-4 flex flex-col items-start gap-2">
        <ZoneChip />
        <WalkFastChip />
      </div>
      <div className="absolute top-4 right-4 flex items-center gap-2">
        <PresenceChip />
        <CameraOnChip />
        <MenuButton />
      </div>
      <InteractionPrompt />
      <div className="absolute bottom-4 left-4 flex flex-col items-start gap-2">
        <ChatPanel />
        <ControlsHint />
      </div>
      <Crosshair />
    </div>
  );
}
