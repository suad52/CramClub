"use client";

import { useEffect } from "react";
import { IconUsers } from "@/components/ui/icons";
import { listNames } from "@/lib/focus/companions";
import { encouragement } from "@/lib/focus/lines";
import { useFocusStore } from "@/lib/focus/store";

/*
 * "You showed up": what the table timer's card says when a pomodoro rings (NoticeBody in
 * components/library/Pomodoro.tsx keeps the card's frame, title and buttons; this is its body).
 * Minutes locked in, how much of it your own face tracking saw you at the desk (only if you had it
 * on), who studied at your table or near it (real players, by their name tags), the XP the server
 * gave, and a handwritten note from Ms. Fenwick. Warm and forgiving: nothing here is ever a scold,
 * and keeping the camera off changes nothing but the missing tile. A judge-demo preview (rung early
 * from the demo controls, lib/demo) says so: how long it really ran, and that it earned nothing.
 */

/** A chunky stat sticker on the cream card. */
const TILE =
  "title-pop flex min-w-0 flex-1 flex-col rounded-[16px] border-2 border-walnut px-3 pt-1.5 pb-2 shadow-[0_3px_0_#1f1a16]";

function Tile({
  value,
  label,
  sub,
  fill = "bg-canvas",
}: {
  value: string;
  label: string;
  sub?: string;
  fill?: string;
}) {
  return (
    <div className={`${TILE} ${fill}`}>
      <span className="tabular font-display text-[24px] leading-8 font-bold text-walnut">
        {value}
      </span>
      <span className="font-display text-[12.5px] leading-4 font-semibold text-walnut/75">
        {label}
      </span>
      {sub && (
        <span className="mt-0.5 text-[11.5px] leading-4 font-medium text-ink-soft">{sub}</span>
      )}
    </div>
  );
}

/** The recap for the pomodoro that rang at `at` (the focusDone notice's time). */
export function ShowedUp({ at, children }: { at: number; children?: React.ReactNode }) {
  const recap = useFocusStore((s) => (s.recap?.at === at ? s.recap : null));
  // While this is up, the pomodoro's XP lands here rather than in a toast.
  useEffect(() => {
    useFocusStore.setState({ recapShown: true });
    return () => useFocusStore.setState({ recapShown: false });
  }, []);

  if (!recap) return <>{children}</>;
  const verified = recap.presence ? Math.floor(recap.presence.seenSeconds / 60) : 0;
  const note = encouragement(
    {
      percent: recap.percent,
      companions: recap.companions.length,
      count: recap.count,
      long: recap.long,
    },
    recap.pick,
  );
  return (
    <>
      {recap.preview && (
        <p className="mt-3.5 rounded-[14px] border-2 border-dashed border-walnut/40 bg-canvas px-3 py-2 text-[13px] leading-5 font-semibold text-walnut">
          Demo preview: rung early from the demo controls, so it isn&apos;t counted and earns no XP.
          A pomodoro that runs to its bell counts for real.
        </p>
      )}
      <div className="mt-3.5 flex gap-2">
        {recap.preview ? (
          <Tile value={`${recap.preview.seconds} s`} label="of a demo pomodoro" />
        ) : (
          <Tile value={`${recap.minutes} min`} label="locked in" />
        )}
        {recap.percent !== null && (
          <Tile
            value={`${recap.percent}%`}
            label="seen at desk"
            sub={recap.preview ? undefined : `${verified} verified min`}
          />
        )}
        {typeof recap.xp === "number" && recap.xp > 0 && (
          <Tile value={`+${recap.xp}`} label="XP earned" fill="bg-sun" />
        )}
      </div>
      {recap.companions.length > 0 && (
        <p className="mt-3 flex items-start gap-2 text-[14px] leading-5 font-semibold text-walnut">
          <span
            aria-hidden
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-walnut bg-leaf"
          >
            <IconUsers size={13} strokeWidth={2.75} />
          </span>
          <span>You studied alongside {listNames(recap.companions)}.</span>
        </p>
      )}
      {/* Her note, in her hand. */}
      <p className="mt-3 -rotate-1 rounded-[14px] border-2 border-dashed border-walnut/30 bg-[#fbf3e2] px-3.5 py-2 text-walnut">
        <span className="block font-[family-name:var(--font-caveat)] text-[1.45rem] leading-7">
          {note}
        </span>
        <span className="block text-right font-display text-[12px] font-semibold text-walnut/70">
          Ms. Fenwick
        </span>
      </p>
      {children && <div className="mt-3">{children}</div>}
    </>
  );
}
