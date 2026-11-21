"use client";

import { useEffect, useRef } from "react";
import { ProgressDashboard } from "@/components/progress/ProgressDashboard";
import { exitPointerLock, requestPointerLock } from "@/lib/game/pointer";
import { useGameStore } from "@/lib/game/store";

/*
 * "My Progress" as a panel over the library rather than a new tab (a running pomodoro doesn't
 * allow new tabs). While it's open, `progressOpen` in the game store holds the game still, the
 * same way the controls guide's `guideOpen` does: no walking, game keys or mouse-look, and the
 * mouse stays free.
 */

/** Opens the panel. The flag goes up before the mouse is let go, so that isn't taken as "pause". */
export function openProgress() {
  useGameStore.getState().setProgressOpen(true);
  exitPointerLock();
}

/** Closes the panel; from a click it also captures the mouse again for looking around. */
function closeProgress(recapture: boolean) {
  const s = useGameStore.getState();
  s.setProgressOpen(false);
  // Only possible from a click (Esc doesn't count as one), hence quiet.
  if (recapture && !s.cursorFree) requestPointerLock({ quiet: true });
}

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside the panel: the HUD's buttons are underneath. */
function trapTab(box: HTMLElement, e: KeyboardEvent) {
  const all = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => el.tabIndex >= 0 && el.getClientRects().length > 0,
  );
  const first = all[0];
  const last = all[all.length - 1];
  const active = document.activeElement;
  const atEdge = e.shiftKey ? active === first : active === last;
  if (!box.contains(active) || active === box || atEdge) {
    e.preventDefault();
    (e.shiftKey ? last : first)?.focus();
  }
}

export function ProgressOverlay() {
  const ready = useGameStore((s) => s.ready);
  const playing = useGameStore((s) => s.phase === "playing");
  const open = useGameStore((s) => s.progressOpen);
  if (!ready || !playing || !open) return null;
  return <ProgressPanel />;
}

function ProgressPanel() {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    exitPointerLock();
    box.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus();
    // Esc closes the panel; marked handled so the pause menu doesn't open as well. A dialog
    // above this one (the pomodoro's "Leave?") handles its own Esc first, in the capture phase.
    const onKey = (e: KeyboardEvent) => {
      const el = box.current;
      if (e.defaultPrevented || !el) return;
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        closeProgress(false);
      } else if (e.key === "Tab") {
        trapTab(el, e);
      }
    };
    // Something else captured the mouse while this is open (the pomodoro's "Leave?" dialog does
    // on "Keep focusing"): let it go again, or the panel couldn't be used.
    const offLock = useGameStore.subscribe((s, prev) => {
      if (s.progressOpen && s.pointerLocked && !prev.pointerLocked) exitPointerLock();
    });
    window.addEventListener("keydown", onKey);
    return () => {
      offLock();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      className="studio-fade-in absolute inset-0 z-[22] grid place-items-center bg-ink/40 p-3 backdrop-blur-[3px] sm:p-6"
      onMouseDown={(e) => e.target === e.currentTarget && closeProgress(true)}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="progress-title"
        tabIndex={-1}
        // Arrow keys scroll the panel and move between tabs here; they don't reach the game's
        // movement keys (which would swallow them).
        onKeyDown={(e) => {
          if (e.key.startsWith("Arrow")) e.stopPropagation();
        }}
        className="flex h-full max-h-[56rem] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-parchment text-ink shadow-[0_30px_80px_-20px_rgb(20_12_6/0.6)] ring-1 ring-ink/10 outline-none"
      >
        <header className="flex shrink-0 items-start gap-3 bg-cream px-4 pt-4 pb-1 sm:px-7 sm:pt-5">
          <div className="min-w-0 flex-1">
            <p className="text-[0.7rem] font-extrabold tracking-wide text-ember uppercase">
              Your study record
            </p>
            <h2 id="progress-title" className="font-display text-2xl font-semibold">
              My Progress
            </h2>
          </div>
          <button
            type="button"
            onClick={() => closeProgress(true)}
            aria-label="Close My Progress"
            aria-keyshortcuts="Escape"
            title="Close (Esc)"
            className="-mt-0.5 -mr-2 flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-ink-soft transition hover:bg-ink/5 hover:text-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember"
          >
            <span className="sm:hidden" aria-hidden>
              Close
            </span>
            <span className="hidden sm:inline" aria-hidden>
              Back to the library
            </span>
            <span className="kbd hidden !h-6 !min-w-6 !text-[0.7rem] sm:inline-flex" aria-hidden>
              Esc
            </span>
          </button>
        </header>
        <ProgressDashboard context="library" />
      </div>
    </div>
  );
}
