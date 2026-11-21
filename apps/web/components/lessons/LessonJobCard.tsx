"use client";

import { useEffect, useRef, useState } from "react";
import { asApiError } from "@/components/progress/api";
import {
  IconCheck,
  IconGraduationCap,
  IconPlay,
  IconRefresh,
  IconWarning,
} from "@/components/ui/icons";
import { BTN_SM, FOCUS } from "@/components/ui/styles";
import { EDGE_TAG, ERROR_LINE, ITEM_CARD, Spinner, shortDate } from "@/components/my-library/parts";
import {
  JOB_STATUS_LABELS,
  type LessonJobStatus,
  type LessonJobView,
  MAX_JOB_ATTEMPTS,
} from "@/lib/jobs/types";
import { getCloudLesson, retryCloudLesson } from "@/lib/lessons/client";

/** How often a card asks for news while its lesson is being made. */
export const POLL_MS = 3_000;

/** The stages a lesson goes through, in order (the stepper under a busy card). */
const STAGES: { status: LessonJobStatus; label: string }[] = [
  { status: "queued", label: "Queued" },
  { status: "researching", label: "Research" },
  { status: "generating_lesson", label: "Lesson" },
  { status: "generating_audio", label: "Narration" },
  { status: "saving", label: "Saving" },
];

/** Where the files live, in words. */
export function storageLabel(storage: LessonJobView["storage"]) {
  return storage === "vultr" ? "Stored on Vultr Object Storage" : "Stored on this server (dev)";
}

/** A small "where it's stored" sticker. */
export function StorageBadge({ storage }: { storage: LessonJobView["storage"] }) {
  return (
    <span
      title={
        storage === "vultr"
          ? "The narration and lesson are kept in the library's private Vultr bucket"
          : "Development storage: files are kept on the server's disk"
      }
      className="inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-walnut bg-canvas px-2 py-px font-display text-[12px] leading-5 font-semibold text-walnut"
    >
      <svg
        aria-hidden
        viewBox="0 0 24 24"
        width={12}
        height={12}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4.5 4.5 0 0 1-.5 9.5Z" />
      </svg>
      {storageLabel(storage)}
    </span>
  );
}

function Stepper({ status }: { status: LessonJobStatus }) {
  const at = STAGES.findIndex((s) => s.status === status);
  return (
    <ol aria-label="Progress" className="mt-3 flex flex-wrap gap-1.5">
      {STAGES.map((s, i) => {
        const state = i < at ? "done" : i === at ? "current" : "todo";
        return (
          <li
            key={s.status}
            aria-current={state === "current" ? "step" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border-2 px-2.5 py-0.5 font-display text-[12.5px] font-semibold ${
              state === "done"
                ? "border-walnut bg-leaf text-walnut"
                : state === "current"
                  ? "border-walnut bg-sun text-walnut shadow-[0_2px_0_#1f1a16]"
                  : "border-walnut/30 bg-surface text-ink-soft"
            }`}
          >
            {state === "done" && <IconCheck size={13} strokeWidth={2.75} />}
            {state === "current" && <Spinner className="!h-3 !w-3 !border-2" />}
            {s.label}
            <span className="sr-only">
              {state === "done" ? " (done)" : state === "current" ? " (now)" : " (to come)"}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * One cloud lesson in the library: what's happening to it (truthfully, from the worker's own
 * status), with live updates every 3 seconds while it's being made, a retry for a failed one and
 * Open once it's ready. The student can leave at any point: the worker carries on without them.
 */
export function LessonJobCard({
  job,
  onOpen,
  onChange,
}: {
  job: LessonJobView;
  onOpen: (id: string) => void;
  /** The card learned something new (polling or a retry). */
  onChange?: (job: LessonJobView) => void;
}) {
  // A fresher job from the parent (a reload of the list) replaces what the card had.
  const [given, setGiven] = useState(job);
  const [live, setLive] = useState(job);
  if (given !== job) {
    setGiven(job);
    setLive(job);
  }
  const [tick, setTick] = useState(0);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);

  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Polls while the lesson is being made. A hidden tab skips its turn (and tries again later).
  useEffect(() => {
    if (!live.busy) return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      if (document.hidden) {
        setTick((n) => n + 1);
        return;
      }
      getCloudLesson(live.id, ctrl.signal).then(
        (next) => {
          setTrouble(null);
          setLive(next);
          onChangeRef.current?.(next);
        },
        (err: unknown) => {
          if (ctrl.signal.aborted) return;
          setTrouble(asApiError(err).message);
          setTick((n) => n + 1);
        },
      );
    }, POLL_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [live, tick]);

  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      const next = await retryCloudLesson(live.id);
      setLive(next);
      onChangeRef.current?.(next);
    } catch (err) {
      setRetryError(asApiError(err).message);
    } finally {
      setRetrying(false);
    }
  };

  const done = live.status === "completed";
  const failed = live.status === "failed";
  const title = live.title ?? live.topic;
  const tone = done ? "bg-leaf" : failed ? "bg-[#f3c6bf]" : "bg-sun";

  return (
    <article aria-labelledby={`job-${live.id}`} className={ITEM_CARD}>
      <p className={`${EDGE_TAG} absolute -top-3 left-4 -rotate-2 ${tone}`}>
        <IconGraduationCap size={13} strokeWidth={2.5} />
        Cloud lesson
      </p>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3
            id={`job-${live.id}`}
            className="font-display text-[18px] leading-6 font-semibold break-words text-walnut"
          >
            {done ? (
              <button
                type="button"
                onClick={() => onOpen(live.id)}
                className={`rounded-[6px] text-left decoration-tangerine decoration-[2.5px] underline-offset-[4px] hover:underline ${FOCUS}`}
              >
                {title}
              </button>
            ) : (
              title
            )}
          </h3>
          {live.title && live.title !== live.topic && (
            <p className="mt-0.5 text-[13px] font-medium text-ink-soft">Topic: {live.topic}</p>
          )}
        </div>
        <span className="tabular shrink-0 font-display text-[13px] font-medium text-ink-soft">
          {shortDate(done ? live.completedAt : live.createdAt)}
        </span>
      </div>

      <p
        aria-live="polite"
        className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] leading-5 font-semibold text-walnut"
      >
        {live.busy && <Spinner />}
        {failed && <IconWarning size={17} strokeWidth={2.25} className="text-danger" />}
        {done && <IconCheck size={17} strokeWidth={2.75} className="text-forest" />}
        <span>{JOB_STATUS_LABELS[live.status]}</span>
        {live.progress && live.busy && (
          <span className="font-medium text-ink-soft">· {live.progress}</span>
        )}
      </p>

      {live.busy && (
        <>
          <Stepper status={live.status} />
          <p className="mt-2.5 text-[13px] leading-5 font-medium text-ink-soft">
            You can close this page: your lesson is being made in the cloud, and it&apos;ll be here
            when you come back.
          </p>
          {trouble && (
            <p className={`${ERROR_LINE} mt-1.5`} role="status">
              Couldn&apos;t check on it just now ({trouble}). Trying again…
            </p>
          )}
        </>
      )}

      {done && (
        <>
          {live.summary && (
            <p className="mt-2 line-clamp-3 text-[14.5px] leading-6 font-medium text-ink-soft">
              {live.summary}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button type="button" className={BTN_SM.primary} onClick={() => onOpen(live.id)}>
              <IconPlay size={15} strokeWidth={2.25} />
              Open lesson
            </button>
            <span className="tabular text-[13px] font-medium text-ink-soft">
              {live.sceneCount ?? "?"} scenes
              {live.audio.length > 0 && ` · ${live.audio.length} narrated`}
              {live.sources.length > 0 &&
                ` · ${live.sources.length} source${live.sources.length === 1 ? "" : "s"}`}
            </span>
            <StorageBadge storage={live.storage} />
          </div>
        </>
      )}

      {failed && (
        <div className="mt-2">
          <p className="text-[14px] leading-6 font-medium text-ink-soft">
            {live.error?.message ?? "The lesson stopped before it finished."}
          </p>
          <p className="tabular mt-0.5 text-[12.5px] font-medium text-ink-soft">
            Tried {live.attempts} of {MAX_JOB_ATTEMPTS} times. A retry picks up where it stopped, so
            finished parts aren&apos;t made again.
          </p>
          {live.error?.retryable !== false && (
            <button
              type="button"
              className={`${BTN_SM.primary} mt-3`}
              onClick={() => void retry()}
              disabled={retrying}
            >
              {retrying ? <Spinner /> : <IconRefresh size={15} strokeWidth={2.25} />}
              {retrying ? "Retrying…" : "Retry"}
            </button>
          )}
          {retryError && (
            <p role="alert" className={`${ERROR_LINE} mt-2`}>
              {retryError}
            </p>
          )}
        </div>
      )}
    </article>
  );
}
