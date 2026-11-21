"use client";

import { useEffect, useState } from "react";
import { IconBook, IconClose, IconPlay } from "@/components/ui/icons";
import { BTN_SM, PANEL_MUTED, RIBBON, TAG } from "@/components/ui/styles";
import { SourceLink, TEXT_LINK } from "@/components/librarian/parts";
import { SAVED_ANSWER } from "@/lib/demo/fixtures";
import { useDemo } from "@/lib/demo/mode";
import { useGameStore } from "@/lib/game/store";
import { DEMO_FALLBACK_MS } from "@/lib/demo/settings";

/*
 * The judge demo's safety nets (lib/demo/settings.ts): when Ms. Fenwick or a lesson takes longer
 * than DEMO_FALLBACK_MS, or fails, a clearly marked saved example shows instead of a spinner or
 * an error, while the real request carries on. Outside demo mode these render nothing at all.
 */

/** True once `active` has stayed true for `ms` (false again as soon as it stops). */
function useStalled(active: boolean, ms: number) {
  const [stalled, setStalled] = useState(false);
  if (!active && stalled) setStalled(false);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setStalled(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return active && stalled;
}

const SAVED_RIBBON = `${RIBBON} absolute -top-3.5 left-5 -rotate-1`;

/**
 * Ms. Fenwick's saved example answer, for the Librarian's panel. `waiting`: a request is on its
 * way or she's working on one; `failed`: it didn't come through (an error, a setup problem, a
 * failed request). Shown in demo mode only, once she's been working DEMO_FALLBACK_MS or at once on
 * a failure, until it's put away for this request (`requestKey`) or the request finishes.
 * `boardLesson`: she's making a lesson and the panel is over the library, so the saved example
 * lesson can play on your table's board too (closing her panel to show it).
 */
export function DemoLibrarianFallback({
  waiting,
  failed,
  requestKey,
  boardLesson = false,
}: {
  waiting: boolean;
  failed: boolean;
  requestKey: string;
  boardLesson?: boolean;
}) {
  const on = useDemo((d) => d.on);
  const slow = useStalled(on && waiting && !failed, DEMO_FALLBACK_MS);
  const [hiddenFor, setHiddenFor] = useState<string | null>(null);
  if (!on || (!slow && !failed) || hiddenFor === requestKey) return null;
  return (
    <section
      aria-labelledby="demo-saved-answer"
      className={`${PANEL_MUTED} relative border-walnut/40 px-4 pt-6 pb-4 text-walnut`}
    >
      <p className={SAVED_RIBBON}>Saved example</p>
      <button
        type="button"
        onClick={() => setHiddenFor(requestKey)}
        aria-label="Put the saved example away"
        className={`${BTN_SM.quiet} absolute top-1.5 right-1.5 !h-8 !px-2`}
      >
        <IconClose size={16} strokeWidth={2.5} />
      </button>
      <p className="pr-8 text-[13px] leading-5 font-semibold text-ink-soft">
        {failed
          ? "The live answer didn't come through this time. Here's one Ms. Fenwick prepared earlier, so you can see what you get:"
          : "Ms. Fenwick is still working on your live answer (it keeps going). Meanwhile, here's one she prepared earlier:"}
      </p>
      {boardLesson && (
        <button
          type="button"
          className={`${BTN_SM.primary} mt-3`}
          onClick={() =>
            // Loaded on demand: the board's code only matters in the library.
            void import("@/lib/demo/lesson").then((m) => {
              if (m.playSavedLesson()) useGameStore.getState().setLibrarianOpen(false);
            })
          }
        >
          <IconPlay size={16} strokeWidth={2.5} />
          Play the saved example lesson on your board
        </button>
      )}
      <h3 id="demo-saved-answer" className="mt-3 font-display text-[17px] leading-6 font-semibold">
        “{SAVED_ANSWER.request}”
      </h3>
      <p className="mt-1.5 max-w-[72ch] text-[14.5px] leading-6 font-medium">
        {SAVED_ANSWER.overview}
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Key ideas">
        {SAVED_ANSWER.keyConcepts.map((k) => (
          <li key={k} className={TAG.neutral}>
            {k}
          </li>
        ))}
      </ul>
      <ul className="mt-3.5 space-y-2" aria-label="Sources">
        {SAVED_ANSWER.sources.map((src) => (
          <li key={src.url} className="flex items-start gap-2.5 text-[14px] leading-5">
            <span
              aria-hidden
              className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-walnut bg-surface"
            >
              <IconBook size={13} strokeWidth={2.5} />
            </span>
            <span className="min-w-0">
              <SourceLink href={src.url} className={TEXT_LINK}>
                {src.title}
              </SourceLink>
              <span className="text-ink-soft"> · {src.domain}</span>
              <span className="block text-[13px] text-ink-soft">{src.note}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The Learning Studio's saved example lesson: while a lesson's been in the making for
 * DEMO_FALLBACK_MS, or after it failed, "Play the saved example" opens a finished one (marked as
 * such) in the player. Demo mode only.
 */
export function DemoLessonFallback({
  busy,
  failed,
  onPlay,
}: {
  busy: boolean;
  failed: boolean;
  onPlay: () => void;
}) {
  const on = useDemo((d) => d.on);
  const slow = useStalled(on && busy, DEMO_FALLBACK_MS);
  if (!on || (!slow && !failed)) return null;
  return (
    <div className={`${PANEL_MUTED} relative mt-5 border-walnut/40 px-4 pt-6 pb-4 text-walnut`}>
      <p className={SAVED_RIBBON}>Saved example</p>
      <p className="text-[14px] leading-5 font-semibold">
        {failed
          ? "This lesson didn't come through. Here's a finished one prepared earlier, so you can see how a lesson plays:"
          : "Lessons from long notes can take a minute or two (this one keeps going). Meanwhile, try a finished one prepared earlier:"}
      </p>
      <button type="button" onClick={onPlay} className={`${BTN_SM.primary} mt-3`}>
        <IconPlay size={16} strokeWidth={2.5} />
        Play the saved example
      </button>
    </div>
  );
}
