"use client";

import { useEffect } from "react";
import { IconUsers } from "@/components/ui/icons";
import { HUD_MUTED } from "@/components/ui/styles";
import { CAPTION_MS, useFocusStore } from "@/lib/focus/store";

/*
 * The focus loop's small pieces on the table timer (components/library/Pomodoro.tsx places
 * them): the "seen at desk" meter while you focus with your own face tracking on, the
 * body-doubling line (real people studying near you), and Ms. Fenwick's shush as a caption, so
 * it works muted too. The numbers come from lib/focus/watch.ts through lib/focus/store.ts.
 */

/** A short slide-and-fade in (none with reduced motion), as the timer's toasts do. */
const ENTER =
  "transition duration-200 ease-out starting:-translate-y-1.5 starting:opacity-0 motion-reduce:transition-none";

/**
 * While a pomodoro runs with your face tracking on: a dot (leaf while it sees you at the desk)
 * and how much of this pomodoro it has, with the plain promise of what it uses. Nothing at all
 * with the camera off: that's never held against anyone.
 */
export function FocusMeter() {
  const cameraOn = useFocusStore((s) => s.cameraOn);
  const seenNow = useFocusStore((s) => s.seenNow);
  const percent = useFocusStore((s) => s.percent);
  if (!cameraOn) return null;
  return (
    <div className="mt-2.5 rounded-[12px] border-2 border-black/60 bg-walnut-key/70 px-2.5 py-1.5">
      <p className="flex items-center gap-2 font-display text-[13px] leading-5 font-semibold">
        <span
          aria-hidden
          className={`h-3 w-3 shrink-0 rounded-full border-2 border-black/80 transition-colors duration-300 motion-reduce:transition-none ${seenNow ? "bg-leaf" : "bg-walnut-muted/70"}`}
        />
        <span className="min-w-0 flex-1">
          Seen at desk{" "}
          <span className="tabular text-sun">{percent === null ? "…" : `${percent}%`}</span>
          <span className="sr-only">
            {seenNow ? ", you're at your desk" : ", not seen right now"}
          </span>
        </span>
      </p>
      <p className={`mt-0.5 pl-5 text-[11.5px] leading-4 font-medium ${HUD_MUTED}`}>
        Only on-device face data is used. No video leaves your computer.
      </p>
    </div>
  );
}

/**
 * Body doubling, said plainly: how many real people are studying at your table or near it (or,
 * with nobody yet, why sitting near people helps).
 */
export function StudyingNearby({ className = "" }: { className?: string }) {
  const nearby = useFocusStore((s) => s.nearby);
  return (
    <p
      className={`flex items-start gap-2 text-[12.5px] leading-[1.125rem] font-medium ${HUD_MUTED} ${className}`}
    >
      <IconUsers size={16} strokeWidth={2.25} className="mt-px shrink-0 text-sun" />
      <span>
        {nearby > 0 ? (
          <>
            <span className="font-semibold text-walnut-text">
              {nearby === 1 ? "1 person is" : `${nearby} people are`} studying near you.
            </span>{" "}
            Starting is easier together (body doubling).
          </>
        ) : (
          "Study next to real people and starting feels easier (it's called body doubling)."
        )}
      </span>
    </p>
  );
}

/** Ms. Fenwick's latest shush, as a caption under the timer: a cream speech sticker. */
export function FenwickCaption() {
  const caption = useFocusStore((s) => s.caption);
  useEffect(() => {
    if (!caption) return;
    const t = setTimeout(() => {
      if (useFocusStore.getState().caption === caption) useFocusStore.setState({ caption: null });
    }, CAPTION_MS);
    return () => clearTimeout(t);
  }, [caption]);
  if (!caption) return null;
  return (
    <p
      key={caption.at}
      className={`${ENTER} relative max-w-full rounded-[18px] border-[3px] border-black/80 bg-surface py-2 pr-4 pl-3.5 text-walnut shadow-[0_4px_0_rgb(0_0_0/0.55)]`}
    >
      <span className="block font-display text-[12px] leading-4 font-semibold text-ink-soft">
        Ms. Fenwick
      </span>
      <span className="block text-[14px] leading-5 font-semibold">“{caption.line}”</span>
    </p>
  );
}
