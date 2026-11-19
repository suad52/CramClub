"use client";

import { ZONES } from "@ovr/shared";
import { WHITEBOARDS, getSeat, interact, openTableBoard } from "@/lib/game/actions";
import { exitPointerLock } from "@/lib/game/pointer";
import { useGameStore } from "@/lib/game/store";
import { TrackingButton } from "./ExpressionTracking";

const zoneById = new Map(ZONES.map((z) => [z.id, z]));

function IconButton({
  label,
  shortcut,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={shortcut ? `${label} (${shortcut})` : label}
      className="pointer-events-auto flex h-10 items-center gap-2 rounded-full bg-cream/90 px-3.5 text-sm font-bold text-ink shadow-md ring-1 ring-ink/10 backdrop-blur transition hover:bg-cream focus-visible:outline-3 focus-visible:outline-ember"
    >
      {children}
      <span className="sr-only">{label}</span>
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
  const nearby = useGameStore((s) => s.nearbySeatId);
  const nearbyBoard = useGameStore((s) => s.nearbyBoardId);
  const seat = getSeat(seatId);
  const label = seatId ? "Stand up" : nearbyBoard ? "Use whiteboard" : getSeat(nearby)?.prompt;
  const tableBoard = seat?.tableId && WHITEBOARDS.some((b) => b.boardId === seat.tableId);
  if (!label) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-10 flex justify-center gap-3">
      <button type="button" onClick={() => interact()} className={PROMPT_BUTTON}>
        <span className="kbd">E</span>
        {label}
      </button>
      {tableBoard && (
        <button type="button" onClick={() => openTableBoard()} className={PROMPT_BUTTON}>
          <span className="kbd">B</span>
          Table whiteboard
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
  if (!ready || phase !== "playing") return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <div className="absolute top-4 left-4 flex flex-col items-start gap-2">
        <ZoneBadge />
        <WalkFastChip />
      </div>
      <div className="absolute top-4 right-4 flex gap-2">
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
