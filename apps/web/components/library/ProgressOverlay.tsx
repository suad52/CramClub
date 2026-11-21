"use client";

import { useEffect, useRef } from "react";
import { ProgressDashboard } from "@/components/progress/ProgressDashboard";
import { DotRow } from "@/components/progress/ui";
import { BTN, TITLE } from "@/components/ui/styles";
import { exitPointerLock, requestPointerLock } from "@/lib/game/pointer";
import { useGameStore } from "@/lib/game/store";

/*
 * "My progress" as a panel over the library rather than a new tab (a running pomodoro doesn't
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

/** Keeps Tab inside the panel: the HUD's buttons are underneath. (The Librarian's panel too.) */
export function trapTab(box: HTMLElement, e: KeyboardEvent) {
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
      className="absolute inset-0 z-[22] grid place-items-center bg-walnut/50 p-3 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none sm:p-6"
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
        className="flex h-full max-h-[56rem] w-full max-w-6xl flex-col overflow-hidden rounded-[24px] border-[3px] border-walnut bg-canvas text-walnut shadow-[0_8px_0_#1f1a16] outline-none transition-transform duration-200 ease-out starting:translate-y-1.5 motion-reduce:transition-none"
      >
        <header className="flex shrink-0 items-start gap-4 bg-surface px-5 pt-5 pb-3 sm:px-8 sm:pt-6">
          <div className="min-w-0 flex-1">
            {/* A tilted sun badge, like the title screen's tagline. */}
            <p className="title-pop inline-flex w-fit -rotate-2 items-center gap-2 rounded-full border-[2.5px] border-walnut bg-sun px-3 py-0.5 font-display text-[13px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16]">
              <span
                aria-hidden
                className="h-2 w-2 rounded-full border-2 border-walnut bg-tangerine"
              />
              Your study record
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
              <h2 id="progress-title" className={TITLE}>
                My progress
              </h2>
              <DotRow />
            </div>
          </div>
          <button
            type="button"
            onClick={() => closeProgress(true)}
            aria-label="Back to the library (close my progress)"
            aria-keyshortcuts="Escape"
            title="Close (Esc)"
            className={`${BTN.secondary} -mr-1 sm:pr-2.5`}
          >
            <span className="sm:hidden" aria-hidden>
              Close
            </span>
            <span className="hidden sm:inline" aria-hidden>
              Back to the library
            </span>
            {/* .kbd sets its own display (unlayered CSS beats the `hidden` utility), so the
                wrapper is what hides the key cap on small screens. */}
            <span className="hidden sm:inline-flex" aria-hidden>
              <kbd className="kbd">Esc</kbd>
            </span>
          </button>
        </header>
        <ProgressDashboard context="library" />
      </div>
    </div>
  );
}
