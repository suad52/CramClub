"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useIsTouchOnly } from "@/components/ui/DesktopNotice";
import { exitPointerLock, requestPointerLock } from "@/lib/game/pointer";
import { formatClock, isFocusing, remainingMs, usePomodoro } from "@/lib/game/pomodoro";
import { isLessonOverlayOpen, useBoardLessons } from "@/lib/learning-studio/boardLessons";
import { useWhiteboardStore } from "@/lib/whiteboard/store";
import { DEFAULT_SETTINGS, type Quality, useGameStore } from "@/lib/game/store";

function Card({ children, labelledBy }: { children: React.ReactNode; labelledBy: string }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      className="max-h-[calc(100dvh-3rem)] w-full max-w-md overflow-y-auto rounded-3xl bg-cream p-7 text-ink shadow-[0_30px_80px_-20px_rgb(20_12_6/0.6)] ring-1 ring-ink/10"
    >
      {children}
    </div>
  );
}

function PrimaryButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full rounded-full bg-ink px-5 py-3 text-base font-bold text-cream transition hover:bg-wood-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember"
    >
      {children}
    </button>
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
  return (
    <div
      className={`absolute inset-0 z-40 grid place-items-center bg-parchment transition-opacity duration-700 ${ready ? "pointer-events-none opacity-0" : "opacity-100"}`}
      role="status"
      aria-live="polite"
    >
      <div className="text-center">
        <div className="mx-auto mb-5 flex h-14 items-end justify-center gap-1.5" aria-hidden>
          {["#8c3f3a", "#3f5f4a", "#c99a45", "#34466a", "#a5643f"].map((c, i) => (
            <span
              key={c}
              className="w-3 animate-pulse rounded-sm"
              style={{
                background: c,
                height: `${34 + (i % 3) * 9}px`,
                animationDelay: `${i * 140}ms`,
              }}
            />
          ))}
        </div>
        <p className="font-display text-2xl font-semibold">Opening the library…</p>
        <p className="mt-2 text-sm text-ink-soft">Dusting the shelves and lighting the lamps.</p>
      </div>
    </div>
  );
}

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
      <span className="pointer-events-none absolute bottom-24 left-1/2 z-[5] -translate-x-1/2 rounded-full bg-ink/70 px-4 py-2 text-xs font-bold text-cream backdrop-blur">
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
        <span className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-ink/70 px-4 py-2 text-xs font-bold text-cream backdrop-blur">
          Hold the mouse button and drag to look around
        </span>
      ) : (
        <span className="pointer-events-none rounded-full bg-ink/75 px-5 py-2.5 text-sm font-bold text-cream shadow-lg backdrop-blur">
          Click to look around
        </span>
      )}
    </div>
  );
}

const CONTROLS: { keys: string[]; label: string }[] = [
  { keys: ["W", "A", "S", "D"], label: "Walk (arrow keys work too)" },
  { keys: ["Mouse"], label: "Look around" },
  { keys: ["Shift"], label: "Hold to free your mouse (click buttons)" },
  { keys: ["R"], label: "Walk faster on / off" },
  { keys: ["B"], label: "Open your table's whiteboard" },
  { keys: ["L"], label: "Play a lesson on a whiteboard" },
  { keys: ["J", "N"], label: "Join a lesson / not now" },
  { keys: ["F"], label: "Lesson full screen" },
  { keys: ["E"], label: "Sit / stand · ask the librarian at her desk" },
  { keys: ["P"], label: "Start a pomodoro (at a table)" },
  { keys: ["V"], label: "Switch first / third person" },
  { keys: ["Scroll"], label: "Zoom the third-person camera" },
  { keys: ["Esc"], label: "Pause and settings" },
];

export function ControlsGuide() {
  const ready = useGameStore((s) => s.ready);
  const open = useGameStore((s) => s.guideOpen);
  const setOpen = useGameStore((s) => s.setGuideOpen);
  useEffect(() => {
    if (open) exitPointerLock();
  }, [open]);
  if (!ready || !open) return null;
  const close = () => {
    setOpen(false);
    requestPointerLock();
  };
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-ink/35 p-6 backdrop-blur-[2px]">
      <Card labelledBy="guide-title">
        <h2 id="guide-title" className="font-display text-2xl font-semibold">
          Welcome to the library
        </h2>
        <p className="mt-1.5 text-sm text-ink-soft">
          Find a seat, settle in. Here&apos;s how to get around:
        </p>
        <ul className="mt-5 space-y-2">
          {CONTROLS.map((c) => (
            <li key={c.label} className="flex items-center justify-between gap-4">
              <span className="text-[0.95rem]">{c.label}</span>
              <span className="flex shrink-0 gap-1">
                {c.keys.map((k) => (
                  <kbd key={k} className="kbd">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-7">
          <PrimaryButton onClick={close}>Start exploring</PrimaryButton>
        </div>
      </Card>
    </div>
  );
}

const QUALITIES: { id: Quality; label: string }[] = [
  { id: "high", label: "High" },
  { id: "balanced", label: "Balanced" },
  { id: "low", label: "Low" },
];

export function PauseMenu() {
  const open = useGameStore((s) => s.menuOpen);
  const guideOpen = useGameStore((s) => s.guideOpen);
  const progressOpen = useGameStore((s) => s.progressOpen);
  const librarianOpen = useGameStore((s) => s.librarianOpen);
  const setOpen = useGameStore((s) => s.setMenuOpen);
  const setGuideOpen = useGameStore((s) => s.setGuideOpen);
  const settings = useGameStore((s) => s.settings);
  const update = useGameStore((s) => s.updateSettings);
  const cameraMode = useGameStore((s) => s.cameraMode);
  const setCameraMode = useGameStore((s) => s.setCameraMode);
  const openCreator = useGameStore((s) => s.openCreator);
  const focusing = usePomodoro(isFocusing);
  // "Leave" asked "are you sure?" mid-pomodoro; holds the time that was left then.
  const [leaving, setLeaving] = useState<string | null>(null);
  if (leaving !== null && (!open || !focusing)) setLeaving(null);

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

  if (!open || guideOpen || progressOpen || librarianOpen) return null;
  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink/35 p-6 backdrop-blur-[2px]">
      <Card labelledBy="menu-title">
        <h2 id="menu-title" className="font-display text-2xl font-semibold">
          Paused
        </h2>
        <div className="mt-5 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-extrabold">Camera</legend>
            <div className="grid grid-cols-2 gap-2">
              {(["third-person", "first-person"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={cameraMode === m}
                  onClick={() => setCameraMode(m)}
                  className={`rounded-xl px-3 py-2 text-sm font-bold ring-1 transition ${cameraMode === m ? "bg-ink text-cream ring-ink" : "bg-parchment ring-ink/10 hover:ring-ink/30"}`}
                >
                  {m === "third-person" ? "Third person" : "First person"}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-2 flex justify-between text-sm font-extrabold">
              Mouse sensitivity{" "}
              <span className="font-bold text-ink-soft">
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
              className="w-full accent-[var(--color-wood)]"
            />
          </label>
          <label className="flex items-center justify-between text-sm font-extrabold">
            Invert vertical look
            <input
              type="checkbox"
              checked={settings.invertY}
              onChange={(e) => update({ invertY: e.target.checked })}
              className="h-5 w-5 accent-[var(--color-wood)]"
            />
          </label>
          <fieldset>
            <legend className="mb-2 text-sm font-extrabold">Graphics</legend>
            <div className="grid grid-cols-3 gap-2">
              {QUALITIES.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  aria-pressed={settings.quality === q.id}
                  onClick={() => update({ quality: q.id })}
                  className={`rounded-xl px-3 py-2 text-sm font-bold ring-1 transition ${settings.quality === q.id ? "bg-ink text-cream ring-ink" : "bg-parchment ring-ink/10 hover:ring-ink/30"}`}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-ink-soft">Lower this if the library feels choppy.</p>
          </fieldset>
        </div>
        {leaving !== null ? (
          <div role="alert" className="mt-7 rounded-2xl bg-parchment p-4 ring-1 ring-ink/10">
            <p className="font-extrabold">Leave the library mid-pomodoro?</p>
            <p className="mt-1 text-sm text-ink-soft">
              {leaving} left. A pomodoro can&apos;t be split, so this one won&apos;t count.
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 text-sm font-bold">
              <button
                type="button"
                autoFocus
                onClick={() => {
                  setOpen(false);
                  requestPointerLock();
                }}
                className="rounded-full bg-ink px-3 py-2.5 text-cream transition hover:bg-wood-dark focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember"
              >
                Keep focusing
              </button>
              <Link
                href="/"
                onClick={() => usePomodoro.getState().abandon("left-library")}
                className="rounded-full px-3 py-2.5 text-center text-ink-soft ring-1 ring-ink/15 transition hover:bg-ink/5 hover:text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember"
              >
                Leave anyway
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-7 space-y-2">
            <PrimaryButton
              onClick={() => {
                setOpen(false);
                requestPointerLock();
              }}
            >
              Resume
            </PrimaryButton>
            <button
              type="button"
              onClick={focusing ? undefined : () => openCreator("playing")}
              aria-disabled={focusing || undefined}
              title={focusing ? "Available after your pomodoro" : undefined}
              className={`w-full rounded-full bg-parchment px-5 py-2.5 text-sm font-extrabold ring-1 ring-ink/10 transition ${focusing ? "cursor-not-allowed text-ink-soft" : "hover:ring-ink/30"}`}
            >
              Edit character
              {focusing && (
                <span className="block text-xs font-bold">Available after your pomodoro</span>
              )}
            </button>
            <div className="grid grid-cols-3 gap-2 text-sm font-bold">
              <button
                type="button"
                onClick={() => setGuideOpen(true)}
                className="rounded-full px-3 py-2.5 text-ink-soft hover:bg-ink/5 hover:text-ink"
              >
                Controls
              </button>
              <button
                type="button"
                onClick={() => update(DEFAULT_SETTINGS)}
                className="rounded-full px-3 py-2.5 text-ink-soft hover:bg-ink/5 hover:text-ink"
              >
                Reset
              </button>
              <Link
                href="/"
                onClick={(e) => {
                  // Leaving the library mid-pomodoro ends it: ask first.
                  const p = usePomodoro.getState();
                  if (!isFocusing(p)) return;
                  e.preventDefault();
                  setLeaving(formatClock(remainingMs(p, Date.now())));
                }}
                className="rounded-full px-3 py-2.5 text-center text-ink-soft hover:bg-ink/5 hover:text-ink"
              >
                Leave
              </Link>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

/** Phones and tablets get a clear heads-up instead of a confusing, uncontrollable view. */
export function TouchDeviceNotice() {
  const touchOnly = useIsTouchOnly();
  const [dismissed, setDismissed] = useState(false);
  if (!touchOnly || dismissed) return null;
  return (
    <div className="absolute inset-0 z-50 grid place-items-center bg-parchment/95 p-6">
      <Card labelledBy="touch-title">
        <h2 id="touch-title" className="font-display text-2xl font-semibold">
          Best on a computer
        </h2>
        <p className="mt-2 text-ink-soft">
          Walking around the library needs a keyboard and mouse for now. Touch controls aren&apos;t
          supported yet.
        </p>
        <div className="mt-6 space-y-2">
          <Link
            href="/"
            className="block w-full rounded-full bg-ink px-5 py-3 text-center font-bold text-cream"
          >
            Back home
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="w-full rounded-full px-5 py-3 font-bold text-ink-soft"
          >
            Look around anyway
          </button>
        </div>
      </Card>
    </div>
  );
}
