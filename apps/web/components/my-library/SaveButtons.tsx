"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { asApiError } from "@/components/progress/api";
import { IconBookmark, IconCheck } from "@/components/ui/icons";
import { BTN_SM, FOCUS } from "@/components/ui/styles";
import { loginHref } from "@/lib/auth/links";
import { saveLesson, savePlan } from "@/lib/library/client";
import type { Chunk, Lesson } from "@/lib/learning-studio/schema";
import type { LessonProgress } from "@/lib/library/types";
import {
  ERROR_LINE,
  IconLock,
  OFF_HINT,
  OFF_SM,
  Spinner,
  TEXT_LINK,
  useLibraryAccess,
} from "./parts";

type State =
  | { state: "idle" }
  | { state: "saving" }
  | { state: "saved"; collection: string; added: boolean }
  | { state: "error"; message: string };

/** The "switched off" look for a save control, with its hint for screen readers too. */
function Off({ label, hint }: { label: string; hint: string }) {
  const uid = useId();
  return (
    <>
      <button
        type="button"
        aria-disabled="true"
        aria-describedby={uid}
        title={hint}
        className={OFF_SM}
      >
        <IconLock size={14} />
        {label}
      </button>
      <span id={uid} className="sr-only">
        {hint}
      </span>
    </>
  );
}

/**
 * "Save plan to my library": keeps a snapshot of a study plan in your private "My study plans"
 * collection (saving again refreshes it). The server checks the plan is yours.
 */
export function SavePlanButton({ planId }: { planId: string }) {
  const access = useLibraryAccess();
  const pathname = usePathname();
  const [s, setS] = useState<State>({ state: "idle" });

  if (access === "off" || access === "error")
    return (
      <Off
        label="Save plan to my library"
        hint={access === "off" ? OFF_HINT : "Couldn't check sign-in. Refresh to try again."}
      />
    );
  if (access === "signed-out")
    return (
      <a href={loginHref(pathname)} className={BTN_SM.secondary}>
        <IconLock size={14} />
        Sign in to save this plan
      </a>
    );

  const save = () => {
    setS({ state: "saving" });
    savePlan(planId).then(
      (r) => setS({ state: "saved", collection: r.collection.name, added: r.added }),
      (err: unknown) => setS({ state: "error", message: asApiError(err).message }),
    );
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <button
        type="button"
        onClick={save}
        disabled={access === "loading" || s.state === "saving"}
        className={BTN_SM.secondary}
      >
        {s.state === "saving" ? (
          <Spinner />
        ) : s.state === "saved" ? (
          <IconCheck size={16} strokeWidth={2.75} />
        ) : (
          <IconBookmark size={16} />
        )}
        {s.state === "saved" ? "Update saved copy" : "Save plan to my library"}
      </button>
      {s.state === "saved" && (
        <span role="status" className="text-[13.5px] font-semibold text-walnut">
          {s.added ? "Saved" : "Updated"} in {s.collection}.{" "}
          <Link href="/my-library?tab=collections" className={TEXT_LINK}>
            Open my library
          </Link>
        </span>
      )}
      {s.state === "error" && (
        <span role="alert" className={ERROR_LINE}>
          {s.message}
        </span>
      )}
    </span>
  );
}

const SMALL_LINK = `inline-flex items-center gap-1.5 rounded-[8px] font-display text-[13px] leading-5 font-semibold text-walnut underline decoration-tangerine decoration-2 underline-offset-[3px] transition-colors duration-150 hover:decoration-walnut disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`;

/**
 * A Learning Studio lesson's "Save to my library": a compact text button for its row. It keeps
 * the lesson, your place in it and the notes text it was made from (as much as fits) in your
 * private "My lessons" collection. Saving again refreshes it.
 */
export function SaveLessonButton({
  lesson,
  chunks,
  sourceName,
  progress,
}: {
  lesson: Lesson;
  chunks: Chunk[];
  sourceName: string;
  progress: LessonProgress;
}) {
  const access = useLibraryAccess();
  const pathname = usePathname();
  const uid = useId();
  const [s, setS] = useState<State>({ state: "idle" });

  if (access === "loading") return null;
  if (access === "off" || access === "error")
    return (
      <>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={uid}
          title={OFF_HINT}
          className={`inline-flex cursor-not-allowed items-center gap-1.5 rounded-[8px] text-left font-display text-[13px] leading-5 font-semibold text-ink-soft ${FOCUS}`}
        >
          <IconLock size={13} />
          Library sign-in isn&apos;t set up
        </button>
        <span id={uid} className="sr-only">
          {OFF_HINT}
        </span>
      </>
    );
  if (access === "signed-out")
    return (
      <a href={loginHref(pathname)} className={SMALL_LINK}>
        <IconLock size={13} />
        Sign in to save to your library
      </a>
    );

  const save = () => {
    setS({ state: "saving" });
    saveLesson({ lesson, chunks, sourceName, progress }).then(
      (r) => setS({ state: "saved", collection: r.collection.name, added: r.added }),
      (err: unknown) => setS({ state: "error", message: asApiError(err).message }),
    );
  };

  if (s.state === "saved")
    return (
      <span role="status" className="inline-flex flex-wrap items-center gap-x-2 text-[13px]">
        <span className="inline-flex items-center gap-1 font-display font-semibold text-walnut">
          <IconCheck size={14} strokeWidth={3} />
          {s.added ? "Saved to" : "Updated in"} {s.collection}
        </span>
        <Link href="/my-library?tab=lessons" className={SMALL_LINK}>
          Open my library
        </Link>
      </span>
    );

  return (
    <span className="inline-flex flex-wrap items-center gap-x-2">
      <button type="button" onClick={save} disabled={s.state === "saving"} className={SMALL_LINK}>
        {s.state === "saving" ? <Spinner className="h-3.5 w-3.5" /> : <IconBookmark size={14} />}
        {s.state === "saving" ? "Saving…" : "Save to my library"}
      </button>
      {s.state === "error" && (
        <span role="alert" className={ERROR_LINE}>
          {s.message}
        </span>
      )}
    </span>
  );
}
