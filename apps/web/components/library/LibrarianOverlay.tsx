"use client";

import { useEffect, useRef } from "react";
import { LibrarianPanel } from "@/components/librarian/LibrarianPanel";
import { exitPointerLock, requestPointerLock } from "@/lib/game/pointer";
import { useGameStore } from "@/lib/game/store";
import { trapTab } from "./ProgressOverlay";

/*
 * The AI Librarian over the library (the HUD's "Ask the Librarian", or E at her desk), opened with
 * openLibrarian() in lib/game/actions.ts: a dialogue box along the bottom of the screen, with her
 * in the 3D scene above it (the camera frames her while it's open, see CameraRig). Like My
 * Progress, `librarianOpen` in the game store holds the game still while it's open: no walking,
 * game keys or mouse-look, and the mouse stays free. Clicking the scene above doesn't close it
 * (Close and Esc do). While a lesson plays inside, the box grows to (almost) the whole screen.
 * Opening sources in a new tab is switched off mid-pomodoro (see SourceLink).
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
      // No scrim over the scene: she's up there. A soft shade along the bottom settles the box
      // (a full walnut scrim while a lesson plays). A click on the scene keeps focus in the box.
      className="absolute inset-0 z-[22] flex items-end justify-center bg-[linear-gradient(to_top,rgb(31_26_22/0.45),rgb(31_26_22/0.12)_36%,transparent_60%)] px-4 pb-5 transition-[opacity,background-color] duration-200 ease-out starting:opacity-0 motion-reduce:transition-none has-[[data-lesson-player]]:bg-walnut/50 sm:pb-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
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
        // The dialogue box (the panel draws it: a big cream sticker card, with her name tab as a
        // ribbon on its top edge): the lower part of the screen, up to 1040px wide; nearly all of
        // it while a lesson plays inside.
        className="relative flex h-[42dvh] max-h-[460px] min-h-[300px] w-full max-w-[1040px] flex-col text-walnut transition-[opacity,translate,height,max-width] duration-200 ease-out outline-none starting:translate-y-5 starting:opacity-0 motion-reduce:transition-none has-[[data-lesson-player]]:h-[calc(100dvh-5rem)] has-[[data-lesson-player]]:max-h-none has-[[data-lesson-player]]:max-w-[1280px]"
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
