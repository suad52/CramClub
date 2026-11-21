"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ZONES } from "@ovr/shared";
import { useIsTouchOnly } from "@/components/ui/DesktopNotice";
import { IconArrowUpRight, IconChevronDown } from "@/components/ui/icons";
import { BODY, BTN, BTN_SM, FOCUS, HUD_CHIP, PANEL, RIBBON, TITLE } from "@/components/ui/styles";
import { useTrackingStore } from "@/lib/facial-tracking/tracker";
import { LOGOUT_HREF, loginHref } from "@/lib/auth/links";
import { useAccount } from "@/lib/auth/useAccount";
import { VoicePanel } from "@/components/creator/VoicePanel";
import { isTimerPanelOpen, openLibrarian, standUp } from "@/lib/game/actions";
import { VOICE_PRESETS, useVoiceSettings } from "@/lib/voice/settings";
import { exitPointerLock, requestPointerLock } from "@/lib/game/pointer";
import { formatClock, isFocusing, remainingMs, usePomodoro } from "@/lib/game/pomodoro";
import { isLessonOverlayOpen, useBoardLessons } from "@/lib/learning-studio/boardLessons";
import { useWhiteboardStore } from "@/lib/whiteboard/store";
import { DEFAULT_SETTINGS, type Quality, useGameStore } from "@/lib/game/store";
import { CameraDot, CheckBox } from "./ExpressionTracking";
import { openProgress, trapTab } from "./ProgressOverlay";

const zoneById = new Map(ZONES.map((z) => [z.id, z]));

/**
 * A centred dialog panel over the library (the controls guide, the touch-device notice): a cream
 * card with a ribbon on its top edge that pops in.
 */
function Card({
  children,
  labelledBy,
  ribbon,
}: {
  children: React.ReactNode;
  labelledBy: string;
  /** A short label on the card's top edge (decorative: the title says the same). */
  ribbon: string;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="title-pop relative w-full max-w-md pt-4"
    >
      <span aria-hidden className={`${RIBBON} absolute top-0.5 left-6 z-[1] -rotate-2`}>
        {ribbon}
      </span>
      <div
        className={`${PANEL} max-h-[calc(100dvh-3rem)] overflow-y-auto p-6 pt-7 text-walnut sm:p-7 sm:pt-8`}
      >
        {children}
      </div>
    </div>
  );
}

/** The title screen's little row of colour: a tangerine bar, then a sun dot and a leaf dot. */
function DotRow({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`flex items-center gap-2 ${className}`}>
      <span className="h-3 w-20 rounded-full border-[2.5px] border-walnut bg-tangerine shadow-[0_3px_0_#1f1a16]" />
      <span className="h-3 w-3 rounded-full border-[2.5px] border-walnut bg-sun shadow-[0_3px_0_#1f1a16]" />
      <span className="h-3 w-3 rounded-full border-[2.5px] border-walnut bg-leaf shadow-[0_3px_0_#1f1a16]" />
    </span>
  );
}

export function LoadingScreen() {
  const ready = useGameStore((s) => s.ready);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setGone(true), 700);
    return () => clearTimeout(t);
  }, [ready]);
  if (gone && ready) return null;
  // The title screen's outlined wordmark on the canvas, a chunky bar with a tangerine block that
  // sweeps while the library loads (the still row of colour dots with reduced motion), and the
  // status in words.
  return (
    <div
      className={`absolute inset-0 z-40 grid place-items-center bg-canvas px-4 transition-opacity duration-700 ${ready ? "pointer-events-none opacity-0" : "opacity-100"}`}
      role="status"
      aria-live="polite"
    >
      <style>{`@keyframes ovr-loading-sweep{from{transform:translateX(-100%)}to{transform:translateX(300%)}}`}</style>
      <div className="flex w-full max-w-xs flex-col items-center text-center">
        <p
          aria-hidden
          className="title-pop font-display text-[88px] leading-none font-bold tracking-tight text-surface [paint-order:stroke_fill] [text-shadow:0_7px_0_#1f1a16] [-webkit-text-stroke:10px_#1f1a16]"
        >
          OVR
        </p>
        <span
          aria-hidden
          className="relative mt-8 block h-5 w-44 overflow-hidden rounded-full border-[3px] border-walnut bg-surface shadow-[0_3px_0_#1f1a16] motion-reduce:hidden"
        >
          <span className="absolute inset-y-0 left-0 w-1/3 rounded-full border-x-[3px] border-walnut bg-tangerine motion-safe:animate-[ovr-loading-sweep_1.6s_ease-in-out_infinite]" />
        </span>
        <DotRow className="mt-8 hidden motion-reduce:flex" />
        <p className="mt-6 font-display text-[19px] leading-6 font-semibold text-walnut">
          Opening the library…
        </p>
        <p className="mt-1 text-[13.5px] leading-5 font-medium text-ink-soft">
          This can take a few seconds the first time.
        </p>
      </div>
    </div>
  );
}

/** A quiet walnut note over the scene (never clickable). */
const LOOK_HINT = `${HUD_CHIP} pointer-events-none px-3.5 py-1.5 text-[13px] font-semibold`;

/**
 * Covers the view while the pointer isn't locked. Clicking locks the pointer for mouse-look;
 * holding the button and dragging also looks around, which is the fallback where a browser
 * refuses pointer lock.
 */
export function ClickToLook() {
  const ready = useGameStore((s) => s.ready);
  const locked = useGameStore((s) => s.pointerLocked);
  const lockFailed = useGameStore((s) => s.pointerLockFailed);
  const cursorFree = useGameStore((s) => s.cursorFree);
  const menuOpen = useGameStore((s) => s.menuOpen);
  const guideOpen = useGameStore((s) => s.guideOpen);
  const progressOpen = useGameStore((s) => s.progressOpen);
  const librarianOpen = useGameStore((s) => s.librarianOpen);
  const boardOpen = useWhiteboardStore((s) => s.openId !== null);
  const lessonOpen = useBoardLessons((s) => s.fullscreen || s.pickerBoardId !== null);
  const phase = useGameStore((s) => s.phase);
  const panelOpen =
    menuOpen || guideOpen || progressOpen || librarianOpen || boardOpen || lessonOpen;
  if (!ready || phase !== "playing" || locked || panelOpen) return null;
  if (cursorFree) {
    // Shift is held: get out of the way so every button can be clicked.
    return (
      <span className={`${LOOK_HINT} absolute bottom-24 left-1/2 z-[5] -translate-x-1/2`}>
        Mouse free · let go of Shift to look around again
      </span>
    );
  }
  return (
    <div
      data-look-surface
      role="button"
      tabIndex={-1}
      onClick={() => requestPointerLock()}
      className={`absolute inset-0 z-[5] flex items-center justify-center ${lockFailed ? "cursor-grab active:cursor-grabbing" : "cursor-pointer"}`}
      aria-label={lockFailed ? "Drag to look around" : "Click to look around"}
    >
      {lockFailed ? (
        <span className={`${LOOK_HINT} absolute bottom-24 left-1/2 -translate-x-1/2`}>
          Hold the mouse button and drag to look around
        </span>
      ) : (
        // A cream sticker that bobs gently (still with reduced motion), like the title screen's card.
        <span className="title-bob pointer-events-none inline-flex items-center gap-2.5 rounded-[18px] border-[3px] border-black/80 bg-surface px-4 py-2 font-display text-[15px] font-semibold text-walnut shadow-[0_4px_0_rgb(0_0_0/0.55)]">
          <span aria-hidden className="h-3 w-3 rounded-full border-2 border-walnut bg-tangerine" />
          Click to look around
        </span>
      )}
    </div>
  );
}

const CONTROLS: { keys: string[]; label: string }[] = [
  { keys: ["W", "A", "S", "D"], label: "Walk (arrow keys work too)" },
  { keys: ["Mouse"], label: "Look around" },
  { keys: ["Shift"], label: "Hold to free the cursor and click buttons" },
  { keys: ["R"], label: "Walk faster, on or off" },
  { keys: ["E"], label: "Use desk or stand up · speak with the Librarian at her desk" },
  { keys: ["B"], label: "Open your table's whiteboard" },
  { keys: ["L"], label: "Play a lesson on a whiteboard" },
  { keys: ["J", "N"], label: "Join a lesson, or not now" },
  { keys: ["F"], label: "Lesson full screen" },
  { keys: ["P"], label: "Start a pomodoro (at a desk)" },
  { keys: ["V"], label: "Switch between first and third person" },
  { keys: ["Scroll"], label: "Zoom the third-person camera" },
  { keys: ["Esc"], label: "Open the menu" },
  { keys: ["?"], label: "Show these controls" },
];

/** Typing somewhere (the Librarian's question box, a form): keys are text, not shortcuts. */
function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || !!el.closest("input, textarea, select"));
}

export function ControlsGuide() {
  const ready = useGameStore((s) => s.ready);
  const open = useGameStore((s) => s.guideOpen);
  const setOpen = useGameStore((s) => s.setGuideOpen);
  useEffect(() => {
    if (open) exitPointerLock();
  }, [open]);

  // "?" shows this guide while walking around or from the menu (the menu's Controls row says so).
  // Shift+/ frees the cursor first (see holdFreeCursor), and an open guide keeps it free.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.repeat || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey)
        return;
      if (isTyping(e.target)) return;
      const s = useGameStore.getState();
      if (
        !s.ready ||
        s.phase !== "playing" ||
        s.guideOpen ||
        s.progressOpen ||
        s.librarianOpen ||
        useWhiteboardStore.getState().openId ||
        isLessonOverlayOpen() ||
        isTimerPanelOpen()
      )
        return;
      e.preventDefault();
      s.setGuideOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!ready || !open) return null;
  const close = () => {
    setOpen(false);
    requestPointerLock();
  };
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-walnut/50 p-4 sm:p-6">
      <Card labelledBy="guide-title" ribbon="Controls">
        <h2 id="guide-title" className={TITLE}>
          Welcome to the library
        </h2>
        <DotRow className="mt-3" />
        <p className={`mt-3 ${BODY}`}>Find a seat and settle in. Here&apos;s how to get around.</p>
        <ul className="mt-5 divide-y-2 divide-walnut/10 rounded-[18px] border-2 border-walnut/25 bg-canvas px-4">
          {CONTROLS.map((c) => (
            <li key={c.label} className="flex items-center gap-4 py-2.5">
              <span className="flex w-[7.25rem] shrink-0 flex-wrap gap-1">
                {c.keys.map((k) => (
                  <kbd key={k} className="kbd">
                    {k}
                  </kbd>
                ))}
              </span>
              <span className="text-sm leading-5 font-semibold text-walnut">{c.label}</span>
            </li>
          ))}
        </ul>
        <button type="button" onClick={close} className={`${BTN.primary} mt-6 w-full`}>
          Start exploring
        </button>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The menu sheet                                                      */
/* ------------------------------------------------------------------ */

const QUALITIES: { id: Quality; label: string }[] = [
  { id: "high", label: "High" },
  { id: "balanced", label: "Balanced" },
  { id: "low", label: "Low" },
];

/** Ribbon colours for the menu's groups (walnut text reads on both). */
const RIBBON_TONES = { tangerine: "bg-tangerine", leaf: "bg-leaf" } as const;

/** A group of menu rows: a cream card with the group's name on a ribbon across its top edge. */
function MenuGroup({
  label,
  tone = "tangerine",
  children,
}: {
  label: string;
  tone?: keyof typeof RIBBON_TONES;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="relative mt-9">
      <h3
        id={id}
        className={`${RIBBON.replace("bg-tangerine", RIBBON_TONES[tone])} absolute -top-3.5 left-5 z-[1] -rotate-1`}
      >
        {label}
      </h3>
      <ul className="rounded-[22px] border-[3px] border-walnut bg-surface px-2 pt-3 pb-1.5 shadow-[0_5px_0_#1f1a16]">
        {children}
      </ul>
    </section>
  );
}

/**
 * One row of the menu: what it is, a line on what it does, and a quiet note on the right (its key,
 * its state, or where it opens). A row that can't be used right now stays focusable and says why.
 */
function MenuRow({
  title,
  description,
  meta,
  onClick,
  unavailable,
  expanded,
  controls,
  children,
}: {
  title: string;
  description: React.ReactNode;
  meta?: React.ReactNode;
  onClick: () => void;
  /** Why it can't be used right now (shown in place of the description). */
  unavailable?: string;
  /** For a row that shows or hides settings under it. */
  expanded?: boolean;
  controls?: string;
  children?: React.ReactNode;
}) {
  const id = useId();
  return (
    <li className="border-t-2 border-walnut/10 py-1 first:border-t-0">
      <button
        type="button"
        onClick={unavailable ? undefined : onClick}
        aria-disabled={unavailable ? true : undefined}
        aria-labelledby={`${id}-title`}
        aria-describedby={meta ? `${id}-desc ${id}-meta` : `${id}-desc`}
        aria-expanded={expanded}
        aria-controls={expanded ? controls : undefined}
        title={unavailable}
        className={`flex w-full items-center gap-4 rounded-[16px] border-2 border-transparent px-3 py-2 text-left transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out motion-reduce:transition-none ${FOCUS} ${unavailable ? "cursor-not-allowed" : "hover:-translate-y-px hover:border-walnut hover:bg-canvas hover:shadow-[0_3px_0_#1f1a16] active:translate-y-px active:shadow-[0_1px_0_#1f1a16]"}`}
      >
        <span className="min-w-0 flex-1">
          <span
            id={`${id}-title`}
            className={`block font-display text-[15.5px] leading-5 font-semibold ${unavailable ? "text-ink-soft" : "text-walnut"}`}
          >
            {title}
          </span>
          <span
            id={`${id}-desc`}
            className="mt-0.5 block text-[13px] leading-5 font-medium text-ink-soft"
          >
            {unavailable ?? description}
          </span>
        </span>
        {meta && (
          <span
            id={`${id}-meta`}
            className="flex shrink-0 items-center gap-1.5 font-display text-[13px] font-semibold whitespace-nowrap text-ink-soft"
          >
            {meta}
          </span>
        )}
      </button>
      {children}
    </li>
  );
}

/**
 * Your account, first in the "You" group: who you're signed in as (and signing out), or signing
 * in to keep your library. Both leave the 3D hall for Auth0 and come back to the title screen, so
 * they wait for a running pomodoro to end. Until Auth0 is set up the row says so.
 */
function AccountRow({ focusing }: { focusing: boolean }) {
  const { status, account } = useAccount();
  const go = (href: string) => {
    exitPointerLock();
    window.location.assign(href);
  };
  if (status === "ready" && account.signedIn)
    return (
      <MenuRow
        title="Account"
        description={`Signed in as ${account.displayName ?? "you"}`}
        meta="Sign out"
        unavailable={focusing ? "Sign out after your pomodoro" : undefined}
        onClick={() => go(LOGOUT_HREF)}
      />
    );
  const unavailable =
    status === "loading"
      ? "Checking sign-in…"
      : status === "error"
        ? "Couldn't check sign-in. Try again later."
        : !account.configured
          ? "Sign-in isn't set up yet. Progress stays in this browser."
          : focusing
            ? "Available after your pomodoro"
            : undefined;
  return (
    <MenuRow
      title="Sign in"
      description="Keep your library and progress on your account"
      unavailable={unavailable}
      onClick={() => go(loginHref("/"))}
    />
  );
}

/** Mouse and graphics settings, shown under their row in the menu. */
function LookSettings({ id }: { id: string }) {
  const settings = useGameStore((s) => s.settings);
  const update = useGameStore((s) => s.updateSettings);
  return (
    <div id={id} className="space-y-5 px-3 pt-2 pb-3">
      <label className="block">
        <span className="mb-1.5 flex items-baseline justify-between font-display text-[14px] font-semibold text-walnut">
          Mouse sensitivity
          <span className="tabular rounded-full border-2 border-walnut bg-sun px-2 text-[12.5px] text-walnut">
            {settings.mouseSensitivity.toFixed(1)}
          </span>
        </span>
        <input
          type="range"
          min={0.6}
          max={5}
          step={0.1}
          value={settings.mouseSensitivity}
          onChange={(e) => update({ mouseSensitivity: Number(e.target.value) })}
          className="studio-range w-full"
        />
      </label>
      <label className="relative flex cursor-pointer items-center justify-between gap-4 font-display text-[14px] font-semibold text-walnut">
        Invert vertical look
        <input
          type="checkbox"
          checked={settings.invertY}
          onChange={(e) => update({ invertY: e.target.checked })}
          className="peer sr-only"
        />
        <CheckBox />
      </label>
      <fieldset>
        <legend className="mb-1.5 font-display text-[14px] font-semibold text-walnut">
          Graphics
        </legend>
        <div className="grid grid-cols-3 gap-1 rounded-[16px] border-[3px] border-walnut bg-canvas p-1">
          {QUALITIES.map((q) => {
            const on = settings.quality === q.id;
            return (
              <button
                key={q.id}
                type="button"
                aria-pressed={on}
                onClick={() => update({ quality: q.id })}
                className={`h-9 rounded-[11px] border-2 font-display text-[13.5px] font-semibold transition-[background-color,color,border-color,transform] duration-150 active:translate-y-px motion-reduce:transition-none ${FOCUS} ${on ? "border-walnut bg-sun text-walnut shadow-[0_2px_0_#1f1a16]" : "border-transparent text-ink-soft hover:bg-surface hover:text-walnut"}`}
              >
                {q.label}
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-xs font-medium text-ink-soft">
          Lower this if the library feels choppy.
        </p>
      </fieldset>
      <button
        type="button"
        onClick={() => update(DEFAULT_SETTINGS)}
        className={`${BTN_SM.quiet} -ml-2.5`}
      >
        Reset to defaults
      </button>
    </div>
  );
}

/**
 * The menu (Esc, or the HUD's Menu): a sheet on the right over a light walnut scrim. The library
 * keeps running behind it. Its rows open the Librarian, the Learning Studio, My progress, the
 * camera panel, the character studio, the view, the controls guide and the mouse and graphics
 * settings. The guide, My progress and the Librarian open over it (it steps aside while they're
 * up, and Esc there comes back here); the camera panel and the character studio close it.
 */
export function PauseMenu() {
  const open = useGameStore((s) => s.menuOpen);
  const guideOpen = useGameStore((s) => s.guideOpen);
  const progressOpen = useGameStore((s) => s.progressOpen);
  const librarianOpen = useGameStore((s) => s.librarianOpen);
  const setOpen = useGameStore((s) => s.setMenuOpen);
  const setGuideOpen = useGameStore((s) => s.setGuideOpen);
  const cameraMode = useGameStore((s) => s.cameraMode);
  const toggleCameraMode = useGameStore((s) => s.toggleCameraMode);
  const openCreator = useGameStore((s) => s.openCreator);
  const zoneId = useGameStore((s) => s.zoneId);
  const quality = useGameStore((s) => s.settings.quality);
  const setTrackingOpen = useTrackingStore((s) => s.setPanelOpen);
  const cameraOn = useTrackingStore((s) => s.status !== "off" && s.status !== "error");
  const focusing = usePomodoro(isFocusing);
  // "Leave" asked "are you sure?" mid-pomodoro; holds the time that was left then.
  const [leaving, setLeaving] = useState<string | null>(null);
  if (leaving !== null && (!open || !focusing)) setLeaving(null);
  const [lookSettingsOpen, setLookSettingsOpen] = useState(false);
  const lookSettingsId = useId();
  const [voiceOpen, setVoiceOpen] = useState(false);
  const voiceId = useId();
  const voice = useVoiceSettings((v) =>
    !v.enabled
      ? "Off"
      : v.preset === "custom"
        ? "Custom"
        : (VOICE_PRESETS.find((p) => p.id === v.preset)?.label ?? "On"),
  );
  const sheet = useRef<HTMLDivElement>(null);
  const shown = open && !guideOpen && !progressOpen && !librarianOpen;

  // Esc toggles the menu when the pointer isn't locked (while locked, the browser's own Esc
  // releases the pointer and CameraRig opens the menu). The lesson picker and full-screen lesson
  // use Esc themselves (and mark it handled), so it never also pauses. A pomodoro's full screen
  // holds Esc (one press doesn't drop out of it), so the browser keeps the mouse: let it go here,
  // which pauses as usual. Holding Esc (how you leave that full screen) repeats the key; only the
  // first press counts, or the menu would flicker open and shut until the browser lets go.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.repeat || e.defaultPrevented) return;
      const s = useGameStore.getState();
      if (
        !s.ready ||
        s.phase !== "playing" ||
        s.guideOpen ||
        s.progressOpen ||
        s.librarianOpen ||
        useWhiteboardStore.getState().openId ||
        isLessonOverlayOpen()
      )
        return;
      if (s.pointerLocked) {
        if (document.fullscreenElement) exitPointerLock();
        return;
      }
      s.setMenuOpen(!s.menuOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // While the sheet is up, focus starts on Resume and Tab stays inside it (the HUD is underneath).
  // A dialog above it (the pomodoro's "Leave?") handles its own Tab first, in the capture phase.
  useEffect(() => {
    if (!shown) return;
    sheet.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      const el = sheet.current;
      if (e.key !== "Tab" || e.defaultPrevented || !el) return;
      trapTab(el, e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shown]);

  if (!shown) return null;

  const resume = () => {
    setOpen(false);
    requestPointerLock();
  };
  const zone = zoneId ? zoneById.get(zoneId) : undefined;
  const firstPerson = cameraMode === "first-person";
  return (
    <div className="absolute inset-0 z-20 flex justify-end">
      <div
        aria-hidden
        onMouseDown={resume}
        className="absolute inset-0 bg-walnut/50 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none"
      />
      <div
        ref={sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby="menu-title"
        aria-describedby="menu-desc"
        className="relative flex h-full w-full flex-col bg-canvas text-walnut transition-transform duration-200 ease-out starting:translate-x-6 motion-reduce:transition-none sm:w-[420px] sm:rounded-l-[30px] sm:border-l-[3px] sm:border-walnut sm:shadow-[-6px_0_0_#1f1a16]"
      >
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 pt-8 pb-6 sm:px-8">
          <p
            aria-hidden
            className="inline-flex -rotate-2 items-center gap-2 rounded-full border-[2.5px] border-walnut bg-sun px-3 py-0.5 font-display text-[13px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16]"
          >
            <span className="h-2 w-2 rounded-full border-2 border-walnut bg-tangerine" />
            Menu
          </p>
          <h2 id="menu-title" className={`${TITLE} mt-3`}>
            <span className="sr-only">Menu: </span>
            {zone?.name ?? "The library"}
          </h2>
          <p id="menu-desc" className="mt-1 text-[13.5px] font-medium text-ink-soft">
            The library keeps running while this is open.
          </p>
          <button
            type="button"
            data-autofocus
            onClick={resume}
            className={`${BTN.primary} mt-6 h-12 w-full text-[17px]`}
          >
            Resume
          </button>

          <MenuGroup label="Learning">
            <MenuRow
              title="The Librarian"
              description="Research a topic, collect sources, plan your study"
              meta={
                <>
                  At her desk
                  <kbd className="kbd">E</kbd>
                </>
              }
              onClick={openLibrarian}
            />
            <MenuRow
              title="Learning Studio"
              description="Turn your notes into a narrated lesson"
              unavailable={focusing ? "Opens a new tab — available after your pomodoro" : undefined}
              meta={
                <>
                  Opens a tab
                  <IconArrowUpRight size={14} />
                </>
              }
              onClick={() => {
                exitPointerLock();
                window.open("/learning-studio", "_blank", "noopener");
              }}
            />
            <MenuRow
              title="My progress"
              description="Focus time, lessons, quizzes and leaderboards"
              onClick={openProgress}
            />
          </MenuGroup>

          <MenuGroup label="You" tone="leaf">
            <AccountRow focusing={focusing} />
            <MenuRow
              title="Camera and face"
              description="Your avatar copies your expressions"
              meta={
                cameraOn ? (
                  <>
                    <CameraDot />
                    On
                  </>
                ) : (
                  "Off"
                )
              }
              onClick={() => {
                // The camera panel sits over the library, not over this sheet.
                setOpen(false);
                setTrackingOpen(true);
              }}
            />
            <MenuRow
              title="Your character"
              description="Change how you look in the library"
              unavailable={focusing ? "Available after your pomodoro" : undefined}
              onClick={() => openCreator("playing")}
            />
            <MenuRow
              title="Your voice"
              description="Mask how you sound to others, and test it"
              meta={
                <>
                  {voice}
                  <IconChevronDown
                    size={16}
                    strokeWidth={2.5}
                    className={`transition-transform duration-150 motion-reduce:transition-none ${voiceOpen ? "rotate-180" : ""}`}
                  />
                </>
              }
              expanded={voiceOpen}
              controls={voiceId}
              onClick={() => setVoiceOpen((v) => !v)}
            >
              {voiceOpen && (
                <div id={voiceId} className="px-1 pt-2 pb-3">
                  <VoicePanel />
                </div>
              )}
            </MenuRow>
            <MenuRow
              title="View"
              description={
                firstPerson
                  ? "First person · switch to third person"
                  : "Third person · switch to first person"
              }
              meta={<kbd className="kbd">V</kbd>}
              onClick={toggleCameraMode}
            />
            <MenuRow
              title="Controls"
              description="Every key, and what it does"
              meta={<kbd className="kbd">?</kbd>}
              onClick={() => setGuideOpen(true)}
            />
            <MenuRow
              title="Mouse and graphics"
              description="Look sensitivity, invert look, graphics quality"
              meta={
                <>
                  {QUALITIES.find((q) => q.id === quality)?.label}
                  <IconChevronDown
                    size={16}
                    strokeWidth={2.5}
                    className={`transition-transform duration-150 motion-reduce:transition-none ${lookSettingsOpen ? "rotate-180" : ""}`}
                  />
                </>
              }
              expanded={lookSettingsOpen}
              controls={lookSettingsId}
              onClick={() => setLookSettingsOpen((v) => !v)}
            >
              {lookSettingsOpen && <LookSettings id={lookSettingsId} />}
            </MenuRow>
          </MenuGroup>
        </div>

        <div className="border-t-2 border-walnut/15 px-6 pt-3 pb-6 sm:px-8">
          {leaving !== null ? (
            <div
              role="alert"
              className="title-pop relative mt-3 rounded-[20px] border-[3px] border-walnut bg-surface p-4 pt-5 shadow-[0_4px_0_#1f1a16]"
            >
              <span aria-hidden className={`${RIBBON} absolute -top-3.5 left-4 -rotate-1`}>
                Pomodoro running
              </span>
              <p className="font-display text-[15.5px] font-semibold text-walnut">
                Leave the library mid-pomodoro?
              </p>
              <p className="mt-1 text-[13px] leading-5 font-medium text-ink-soft">
                <span className="tabular font-bold text-walnut">{leaving}</span> left. A pomodoro
                can&apos;t be split, so this one won&apos;t count.
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" autoFocus onClick={resume} className={BTN.primary}>
                  Keep focusing
                </button>
                <button
                  type="button"
                  onClick={() => {
                    usePomodoro.getState().abandon("left-library");
                    leaveToTitle();
                  }}
                  className={BTN.danger}
                >
                  Leave anyway
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                // Leaving the library mid-pomodoro ends it: ask first.
                const p = usePomodoro.getState();
                if (isFocusing(p)) setLeaving(formatClock(remainingMs(p, Date.now())));
                else leaveToTitle();
              }}
              className={`${BTN.quiet} -ml-3`}
            >
              Leave the library
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** "Leave the library": back to the title screen (the home page), standing up and closing the menu. */
function leaveToTitle() {
  const s = useGameStore.getState();
  // Holding this table? standUp asks first, and comes back here once they've given it up.
  if (s.seatId && !standUp({ then: leaveToTitle })) {
    s.setMenuOpen(false);
    return;
  }
  s.setMenuOpen(false);
  exitPointerLock();
  s.setPhase("title");
}

/** Phones and tablets get a clear heads-up instead of a confusing, uncontrollable view. */
export function TouchDeviceNotice() {
  const touchOnly = useIsTouchOnly();
  const [dismissed, setDismissed] = useState(false);
  if (!touchOnly || dismissed) return null;
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-canvas/95 p-4 sm:p-6">
      <Card labelledBy="touch-title" ribbon="Heads up">
        <h2 id="touch-title" className={TITLE}>
          Best on a computer
        </h2>
        <p className={`mt-2 ${BODY}`}>
          Walking around the library needs a keyboard and mouse for now. Touch controls aren&apos;t
          supported yet.
        </p>
        <div className="mt-6 grid gap-2">
          <Link href="/librarian" className={`${BTN.primary} w-full`}>
            Ask the Librarian instead
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className={`${BTN.quiet} w-full`}
          >
            Look around anyway
          </button>
        </div>
      </Card>
    </div>
  );
}
