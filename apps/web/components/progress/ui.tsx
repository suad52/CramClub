"use client";

import type { TimelineEntry } from "@/lib/learning/types";
import { type Resource, useOnline } from "./api";
import { entryKind, entryScore, entryTitle, formatSeconds } from "./format";

/** Shared pieces of the progress dashboard: cards, headings, states and timeline rows. */

export const FOCUS =
  "focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember";
export const CARD = "rounded-3xl bg-cream p-5 shadow-sm ring-1 ring-ink/10";
export const SMALL_BUTTON = `inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold ring-1 ring-ink/15 transition hover:bg-ink/5 ${FOCUS}`;
export const DARK_BUTTON = `inline-flex items-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-bold text-cream shadow transition hover:bg-wood-dark ${FOCUS}`;

/** Where the dashboard is shown: its own page, or over the 3D library. */
export type DashboardContext = "page" | "library";

export function SectionTitle({
  id,
  title,
  sub,
  aside,
}: {
  id?: string;
  title: string;
  sub?: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <h3 id={id} className="font-display text-lg leading-tight font-semibold">
          {title}
        </h3>
        {sub && <p className="mt-0.5 text-xs text-ink-soft">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

/** A row of mutually exclusive choices (Week / Month, XP / Focus). */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex shrink-0 rounded-full bg-parchment p-1 ring-1 ring-ink/10"
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full px-3 py-1 text-xs font-extrabold transition ${FOCUS} ${value === o.id ? "bg-ink text-cream shadow" : "text-ink-soft hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tag({
  children,
  tone = "plain",
  title,
}: {
  children: React.ReactNode;
  tone?: "plain" | "you" | "demo";
  title?: string;
}) {
  const tones = {
    plain: "bg-ink/[0.06] text-ink-soft",
    you: "bg-ink text-cream",
    demo: "bg-sage/20 text-sage-dark",
  };
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.65rem] font-extrabold tracking-wide uppercase ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A calm, centred card for empty, offline, error and "not set up" states. */
export function StateCard({
  title,
  children,
  action,
  tone = "calm",
  live = false,
}: {
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  tone?: "calm" | "alert";
  live?: boolean;
}) {
  return (
    <div
      role={tone === "alert" ? "alert" : live ? "status" : undefined}
      className={`${CARD} mx-auto max-w-xl px-6 py-8 text-center`}
    >
      <BookStack />
      <p className="mt-3 font-display text-xl font-semibold">{title}</p>
      {children && <div className="mt-1.5 text-sm text-ink-soft">{children}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

function BookStack() {
  return (
    <span className="mx-auto flex h-9 items-end justify-center gap-1" aria-hidden>
      {["#8c3f3a", "#3f5f4a", "#c99a45", "#34466a"].map((c, i) => (
        <span
          key={c}
          className="w-2.5 rounded-sm"
          style={{ background: c, height: `${22 + (i % 3) * 6}px` }}
        />
      ))}
    </span>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-3xl bg-cream ring-1 ring-ink/5" />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-3xl bg-cream ring-1 ring-ink/5" aria-hidden />
    </div>
  );
}

/**
 * Shows a resource's content once it has loaded, and its loading, error, offline and "no
 * database on this server" states until then.
 */
export function Gate<T>({
  resource,
  label,
  children,
}: {
  resource: Resource<T>;
  /** What's loading, for screen readers ("Loading your overview"). */
  label: string;
  children: (data: T) => React.ReactNode;
}) {
  const online = useOnline();
  const { data, error, reload } = resource;
  if (error?.code === "not_configured") {
    return (
      <StateCard title="Progress tracking isn't set up on this server">
        This copy of OVR has no progress database connected, so nothing is being recorded. Studying,
        pomodoros and lessons all still work as usual.
      </StateCard>
    );
  }
  if (data !== undefined) {
    return (
      <>
        {!online && (
          <p
            role="status"
            className="mb-4 rounded-2xl bg-lamp/40 px-4 py-2.5 text-sm font-bold text-ink"
          >
            You&apos;re offline. This is what had loaded; it&apos;ll refresh when you&apos;re back.
          </p>
        )}
        {children(data)}
      </>
    );
  }
  if (!online) {
    return (
      <StateCard title="You're offline" live>
        Your progress will load as soon as you&apos;re back online.
      </StateCard>
    );
  }
  if (error) {
    return (
      <StateCard
        tone="alert"
        title="Couldn't load your progress"
        action={
          <button type="button" onClick={reload} className={DARK_BUTTON}>
            Try again
          </button>
        }
      >
        {error.message}
      </StateCard>
    );
  }
  return <Loading label={label} />;
}

const KIND_COLOR: Record<TimelineEntry["type"], string> = {
  study_session_completed: "#d64535",
  lesson_completed: "var(--color-wood)",
  quiz_completed: "var(--color-sage)",
};

/** One timeline entry: when, what, which subject, how long or how well, and the XP. */
export function EntryRow({ entry, when }: { entry: TimelineEntry; when: React.ReactNode }) {
  const score = entryScore(entry);
  const meta = [
    entry.subject,
    entry.durationSeconds !== null ? formatSeconds(entry.durationSeconds) : null,
    score,
  ].filter(Boolean);
  return (
    <li className="flex items-start gap-3 py-2.5">
      <span className="w-[4.5rem] shrink-0 pt-0.5 text-xs font-bold text-ink-soft tabular-nums">
        {when}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-[0.7rem] font-extrabold tracking-wide text-ink-soft uppercase">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: KIND_COLOR[entry.type] }}
            aria-hidden
          />
          {entryKind(entry.type)}
        </p>
        <p className="truncate font-bold">{entryTitle(entry)}</p>
        {meta.length > 0 && <p className="text-xs text-ink-soft">{meta.join(" · ")}</p>}
      </div>
      <span
        className={`shrink-0 pt-0.5 text-sm font-extrabold tabular-nums ${entry.xp > 0 ? "text-ink" : "text-ink-soft"}`}
        title={entry.xp > 0 ? undefined : "No XP: past the daily cap, or already counted"}
      >
        {entry.xp > 0 ? `+${entry.xp}` : "0"} XP
      </span>
    </li>
  );
}
