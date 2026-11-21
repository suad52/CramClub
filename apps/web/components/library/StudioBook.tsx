"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { IconClose } from "@/components/ui/icons";
import { FOCUS } from "@/components/ui/styles";
import { exitPointerLock } from "@/lib/game/pointer";
import { openLibrarian } from "@/lib/game/actions";
import { useGameStore } from "@/lib/game/store";
import { trapTab } from "./ProgressOverlay";

/*
 * The Learning Studio inside the library, as an open book (the menu's "Learning Studio"), instead
 * of a new browser tab. Each studio section is a page, reached by the ribbon tabs on the book's
 * edge; an open lesson fills the whole spread. `studioOpen` holds the game still like My Progress
 * (no walking, game keys or mouse-look). Once opened, the book stays mounted (hidden) so a lesson
 * being made, or the form, survives closing it. Esc or Close shuts it (back to the menu).
 */

// Lessons live in this browser (localStorage) and narration uses browser audio: client only.
const Studio = dynamic(() => import("@/components/learning-studio/Studio"), { ssr: false });

type Page = "new" | "lessons";

/** From the book to Ms. Fenwick's panel, in the library (no new page). */
function toLibrarian() {
  useGameStore.getState().setStudioOpen(false);
  openLibrarian();
}
const PAGES: { id: Page; label: string; blurb: string }[] = [
  { id: "new", label: "New lesson", blurb: "Upload your notes and make a narrated lesson" },
  { id: "lessons", label: "Your lessons", blurb: "Pick up where you left off" },
];

export function StudioBook() {
  const ready = useGameStore((s) => s.ready);
  const playing = useGameStore((s) => s.phase === "playing");
  const opened = useGameStore((s) => s.studioOpened);
  if (!ready || !playing || !opened) return null;
  return <Book />;
}

function Book() {
  const open = useGameStore((s) => s.studioOpen);
  const [page, setPage] = useState<Page>("new");
  const [turn, setTurn] = useState(0);
  const [lessonOpen, setLessonOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    exitPointerLock();
    box.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      const el = box.current;
      if (e.defaultPrevented || !el) return;
      if (e.key === "Escape" && !e.isComposing) {
        e.preventDefault();
        useGameStore.getState().setStudioOpen(false);
      } else if (e.key === "Tab") trapTab(el, e);
    };
    const offLock = useGameStore.subscribe((s, prev) => {
      if (s.studioOpen && s.pointerLocked && !prev.pointerLocked) exitPointerLock();
    });
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      offLock();
    };
  }, [open]);

  const go = (p: Page) => {
    if (p === page) return;
    setPage(p);
    setTurn((t) => t + 1);
  };
  const pageNo = PAGES.findIndex((p) => p.id === page) + 1;

  return (
    <div
      className={`absolute inset-0 z-40 grid place-items-center bg-walnut/60 p-4 ${open ? "" : "hidden"}`}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div
        ref={box}
        role="dialog"
        aria-modal="true"
        aria-label="Learning Studio"
        tabIndex={-1}
        className="book-open relative mr-[112px] h-[min(90vh,860px)] w-[min(calc(96vw-128px),1200px)] outline-none"
      >
        {/* Ribbon tabs on the book's right edge, one per page */}
        <nav
          aria-label="Pages"
          className="absolute top-16 -right-3 z-10 flex translate-x-full flex-col gap-2"
        >
          {PAGES.map((p, i) => {
            const active = !lessonOpen && p.id === page;
            return (
              <button
                key={p.id}
                type="button"
                aria-current={active ? "page" : undefined}
                disabled={lessonOpen}
                onClick={() => go(p.id)}
                className={`rounded-r-[12px] border-[3px] border-l-0 border-walnut px-3 py-2 text-left font-display text-[13px] font-semibold text-walnut shadow-[3px_3px_0_#1f1a16] transition-transform duration-150 motion-reduce:transition-none disabled:opacity-50 ${FOCUS} ${active ? "translate-x-1.5 bg-sun" : i === 0 ? "bg-[#e9b9a0] hover:translate-x-1" : "bg-[#b7cf9f] hover:translate-x-1"}`}
              >
                {p.label}
              </button>
            );
          })}
        </nav>

        {/* Cover and spine */}
        <div className="relative grid h-full grid-cols-2 rounded-[26px] border-[4px] border-walnut bg-[#7a4a2a] p-3 shadow-[0_12px_0_#1f1a16]">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-3 left-1/2 z-10 w-8 -translate-x-1/2 bg-[linear-gradient(90deg,transparent,rgb(31_26_22/0.28)_45%,rgb(31_26_22/0.38)_50%,rgb(31_26_22/0.28)_55%,transparent)]"
          />

          {lessonOpen ? null : (
            <section className="relative flex min-h-0 flex-col rounded-l-[16px] border-[3px] border-r-0 border-walnut bg-cream p-8 pr-10">
              <p className="inline-flex w-fit -rotate-2 items-center gap-2 rounded-full border-[3px] border-walnut bg-sun px-4 py-1 font-display text-sm font-semibold text-walnut shadow-[0_3px_0_#1f1a16]">
                Learning Studio
              </p>
              <h2 className="mt-4 font-display text-[clamp(1.8rem,3vw,2.6rem)] leading-tight font-bold text-walnut">
                Turn your notes into a lesson
              </h2>
              <p className="mt-3 max-w-[44ch] text-[15px] leading-6 text-ink-soft">
                Upload a PDF of your notes. The studio builds a short narrated lesson with visuals
                and knowledge checks, and Ms. Fenwick answers your questions from the same notes.
              </p>
              <h3 className="mt-8 font-display text-[13px] font-semibold tracking-wide text-walnut/70 uppercase">
                Contents
              </h3>
              <ol className="mt-2 flex flex-col">
                {PAGES.map((p, i) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => go(p.id)}
                      className={`flex w-full items-baseline gap-2 rounded-[10px] px-2 py-2 text-left hover:bg-sun/40 ${FOCUS}`}
                    >
                      <span className="font-display text-[16px] font-semibold text-walnut">
                        {p.label}
                      </span>
                      <span
                        aria-hidden
                        className="mx-1 flex-1 translate-y-[-3px] border-b-2 border-dotted border-walnut/30"
                      />
                      <span className="font-display text-[15px] text-walnut tabular-nums">
                        {i + 1}
                      </span>
                    </button>
                    <p className="px-2 text-[13px] text-ink-soft">{p.blurb}</p>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                onClick={() => useGameStore.getState().setStudioOpen(false)}
                className={`mt-auto inline-flex w-fit items-center gap-2 rounded-[12px] border-[3px] border-walnut bg-surface px-3 py-1.5 font-display text-[14px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16] active:translate-y-px ${FOCUS}`}
              >
                <IconClose size={16} />
                Close the book
                <kbd className="kbd">Esc</kbd>
              </button>
            </section>
          )}

          <section
            className={`relative flex min-h-0 flex-col overflow-hidden border-[3px] border-walnut bg-cream ${lessonOpen ? "col-span-2 rounded-[16px]" : "rounded-r-[16px] border-l-0"}`}
          >
            {/* The studio stays mounted across page turns (a lesson being made keeps going). */}
            <div className="min-h-0 flex-1 overflow-y-auto p-6 pl-10">
              <Studio book={{ page, onPlayer: setLessonOpen, onLibrarian: toLibrarian }} />
            </div>
            {turn > 0 && !lessonOpen && (
              <span
                key={turn}
                aria-hidden
                className="page-turn pointer-events-none absolute inset-0 origin-left bg-cream"
              />
            )}
            {!lessonOpen && (
              <p className="pointer-events-none py-2 text-center font-display text-[13px] text-walnut/60">
                {pageNo}
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
