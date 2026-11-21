"use client";

import { useEffect, useRef } from "react";
import { LibrarianPanel } from "@/components/librarian/LibrarianPanel";
import { exitPointerLock, requestPointerLock } from "@/lib/game/pointer";
import { useGameStore } from "@/lib/game/store";
import { trapTab } from "./ProgressOverlay";

/*
 * The AI Librarian as a panel over the library (the HUD's "Ask the Librarian", or E at her desk),
 * opened with openLibrarian() in lib/game/actions.ts. Like My Progress, `librarianOpen` in the game
 * store holds the game still while it's open: no walking, game keys or mouse-look, and the mouse
 * stays free. Opening sources in a new tab is switched off mid-pomodoro (see SourceLink).
 */

/** Closes the panel; from a click it also captures the mouse again for looking around. */
function closeLibrarian(recapture: boolean) {
  const s = useGameStore.getState();
  s.setLibrarianOpen(false);
  // Only possible from a click (Esc doesn't count as one), hence quiet.
  if (recapture && !s.cursorFree) requestPointerLock({ quiet: true });
}

export function LibrarianOverlay() {
  const ready = useGameStore((s) => s.ready);
  const playing = useGameStore((s) => s.phase === "playing");
  const open = useGameStore((s) => s.librarianOpen);
  if (!ready || !playing || !open) return null;
  return <LibrarianDialog />;
}

function LibrarianDialog() {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    exitPointerLock();
    const el = box.current;
    (el?.querySelector<HTMLElement>("[data-autofocus]") ?? el)?.focus();
    // Esc closes the panel; marked handled so the pause menu doesn't open as well (PauseMenu also
    // steps aside while `librarianOpen`). A dialog above this one (the pomodoro's "Leave?")
    // handles its own Esc first, in the capture phase.
    const onKey = (e: KeyboardEvent) => {
      const el = box.current;
      if (e.defaultPrevented || !el) return;
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        closeLibrarian(false);
      } else if (e.key === "Tab") {
        trapTab(el, e);
      }
    };
    // Something else captured the mouse while this is open (the pomodoro's "Leave?" dialog does
    // on "Keep focusing"): let it go again, or the panel couldn't be used.
    const offLock = useGameStore.subscribe((s, prev) => {
      if (s.librarianOpen && s.pointerLocked && !prev.pointerLocked) exitPointerLock();
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
      onMouseDown={(e) => e.target === e.currentTarget && closeLibrarian(true)}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-labelledby="librarian-title"
        tabIndex={-1}
        // Arrow keys scroll the panel here; they don't reach the game's movement keys (which would
        // swallow them). While a lesson plays they're its scene keys, so they pass through.
        onKeyDown={(e) => {
          if (!e.key.startsWith("Arrow")) return;
          if (!(e.target as HTMLElement).closest("[data-lesson-player]")) e.stopPropagation();
        }}
        className="flex h-full max-h-[56rem] w-full max-w-4xl flex-col overflow-hidden rounded-3xl bg-parchment text-ink shadow-[0_30px_80px_-20px_rgb(20_12_6/0.6)] ring-1 ring-ink/10 outline-none"
      >
        <LibrarianPanel
          context="library"
          titleId="librarian-title"
          onClose={() => closeLibrarian(true)}
        />
      </div>
    </div>
  );
}
