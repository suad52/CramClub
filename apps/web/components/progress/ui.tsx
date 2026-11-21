"use client";

import {
  IconBook,
  IconCheck,
  IconClock,
  IconGraduationCap,
  IconInfo,
  IconWarning,
} from "@/components/ui/icons";
import { BODY, BTN, BTN_SM, FOCUS as SHARED_FOCUS, PANEL, TAG } from "@/components/ui/styles";
import type { TimelineEntry } from "@/lib/learning/types";
import { type Resource, useOnline } from "./api";
import { entryKind, entryScore, entryTitle, formatSeconds } from "./format";

/**
 * Shared pieces of the progress dashboard: panels, headings, states and timeline rows, in the
 * cartoon look (components/ui/styles.ts; gold standard: the title screen). They keep their old
 * names because the Librarian's panel uses some of them too.
 */

/** The visible focus ring every control here uses. */
export const FOCUS = SHARED_FOCUS;
/** A content panel with standard padding: cream, 3px walnut outline, sticker shadow. */
export const CARD = `${PANEL} relative p-5 sm:p-6`;
/** A secondary action inside content. */
export const SMALL_BUTTON = BTN_SM.secondary;
/** The single main action of a view. */
export const DARK_BUTTON = BTN.primary;
/** A one-line notice (offline, where you stand): a small cream sticker. */
export const NOTE =
  "flex items-start gap-2.5 rounded-[16px] border-2 border-walnut bg-surface px-4 py-3 text-sm leading-5 font-semibold text-walnut shadow-[0_3px_0_#1f1a16]";

/** The little round sticker an icon sits in (walnut outline, flat colour). */
export const ICON_DOT =
  "grid shrink-0 place-items-center rounded-full border-2 border-walnut text-walnut";

/** Where the dashboard is shown: its own page, or over the 3D library. */
export type DashboardContext = "page" | "library";

/** The title screen's decoration: a tangerine bar and two dots (sun, leaf). */
export function DotRow({ className = "" }: { className?: string }) {
  const dot = "rounded-full border-[2.5px] border-walnut shadow-[0_2px_0_#1f1a16]";
  return (
    <span aria-hidden className={`flex items-center gap-1.5 ${className}`}>
      <span className={`${dot} h-3 w-14 bg-tangerine`} />
      <span className={`${dot} h-3 w-3 bg-sun`} />
      <span className={`${dot} h-3 w-3 bg-leaf`} />
    </span>
  );
}

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
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h3 id={id} className="font-display text-[19px] leading-6 font-semibold text-walnut">
          {title}
        </h3>
        {sub && <p className="mt-0.5 text-[13.5px] leading-5 font-medium text-ink-soft">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

/** A chunky segmented control for mutually exclusive choices (Week / Month, XP / Focus). */
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
      className="inline-flex max-w-full shrink-0 gap-1 overflow-x-auto rounded-[16px] border-[2.5px] border-walnut bg-canvas p-1.5 shadow-[0_3px_0_#1f1a16]"
    >
      {options.map((o) => {
        const on = value === o.id;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.id)}
            className={`relative h-8 shrink-0 rounded-[11px] border-2 px-3 font-display text-[13.5px] font-semibold whitespace-nowrap transition-[background-color,color,border-color] duration-150 focus-visible:z-10 motion-reduce:transition-none ${FOCUS} ${on ? "border-walnut bg-sun text-walnut" : "border-transparent text-ink-soft hover:border-walnut/30 hover:bg-surface hover:text-walnut"}`}
          >
            {o.label}
          </button>
        );
      })}
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
    plain: TAG.neutral,
    you: TAG.forest,
    demo: "inline-flex items-center rounded-full border-2 border-dashed border-walnut/55 bg-canvas px-2.5 py-0.5 font-display text-xs font-semibold text-ink-soft",
  };
  return (
    <span title={title} className={`${tones[tone]} shrink-0 leading-4`}>
      {children}
    </span>
  );
}

/** A friendly, centred panel for empty, offline, error and "not set up" states. */
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
  const alert = tone === "alert";
  return (
    <div
      role={alert ? "alert" : live ? "status" : undefined}
      className={`${PANEL} relative mx-auto max-w-xl px-6 py-10 text-center sm:px-10`}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-2.5 rounded-[16px] border-2 border-dashed border-walnut/20"
      />
      <span
        aria-hidden
        className={`title-pop relative mx-auto grid h-14 w-14 -rotate-6 place-items-center rounded-full border-[3px] border-walnut shadow-[0_4px_0_#1f1a16] ${alert ? "bg-[#fbe9e5] text-danger" : "bg-sun text-walnut"}`}
      >
        {alert ? (
          <IconWarning size={26} strokeWidth={2.25} />
        ) : (
          <IconBook size={26} strokeWidth={2.25} />
        )}
      </span>
      <p className="relative mt-5 font-display text-[24px] leading-tight font-bold text-walnut">
        {title}
      </p>
      <DotRow className="relative mt-3 justify-center" />
      {children && (
        <div className={`${BODY} relative mx-auto mt-3 max-w-[46ch] text-balance`}>{children}</div>
      )}
      {action && <div className="relative mt-6 flex flex-wrap justify-center gap-3">{action}</div>}
    </div>
  );
}

/** Placeholder shapes in the layout's own outline while the first numbers load. */
function Loading({ label }: { label: string }) {
  const block =
    "rounded-[24px] border-[3px] border-walnut/15 bg-surface-muted motion-safe:animate-pulse";
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">{label}</span>
      <div className={`${block} h-28`} aria-hidden />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]" aria-hidden>
        <div className={`${block} h-72`} />
        <div className={`${block} h-72`} />
      </div>
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
          <p role="status" className={`${NOTE} mb-5`}>
            <span className={`${ICON_DOT} h-6 w-6 bg-sun`}>
              <IconInfo size={14} strokeWidth={2.5} />
            </span>
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
          <button type="button" onClick={reload} className={BTN.secondary}>
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

/** Each kind of entry gets its own icon and sticker colour; the words beside it say what it is. */
const KIND_ICON: Record<TimelineEntry["type"], typeof IconClock> = {
  study_session_completed: IconClock,
  lesson_completed: IconGraduationCap,
  quiz_completed: IconCheck,
};
const KIND_COLOUR: Record<TimelineEntry["type"], string> = {
  study_session_completed: "bg-leaf",
  lesson_completed: "bg-sun",
  quiz_completed: "bg-tangerine",
};

/** One timeline entry: when, what, which subject, how long or how well, and the XP. */
export function EntryRow({ entry, when }: { entry: TimelineEntry; when: React.ReactNode }) {
  const score = entryScore(entry);
  const meta = [
    entry.subject,
    entry.durationSeconds !== null ? formatSeconds(entry.durationSeconds) : null,
    score,
  ].filter(Boolean);
  const Icon = KIND_ICON[entry.type];
  return (
    <li className="flex items-start gap-4 py-3">
      <span className="tabular w-[4.75rem] shrink-0 pt-0.5 font-display text-[13px] leading-5 font-medium text-ink-soft">
        {when}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[16px] leading-6 font-semibold text-walnut">
          {entryTitle(entry)}
        </p>
        <p className="mt-1 flex items-start gap-2 text-[13px] leading-5 font-medium text-ink-soft">
          <span className={`${ICON_DOT} h-5 w-5 ${KIND_COLOUR[entry.type]}`}>
            <Icon size={12} strokeWidth={2.5} />
          </span>
          <span className="min-w-0">
            {entryKind(entry.type)}
            {meta.length > 0 && ` · ${meta.join(" · ")}`}
          </span>
        </p>
      </div>
      <span
        className={`tabular mt-0.5 shrink-0 rounded-full border-2 px-2.5 py-0.5 font-display text-[13px] leading-4 font-semibold ${entry.xp > 0 ? "border-walnut bg-sun text-walnut shadow-[0_2px_0_#1f1a16]" : "border-walnut/30 bg-canvas text-ink-soft"}`}
        title={entry.xp > 0 ? undefined : "No XP: past the daily cap, or already counted"}
      >
        {entry.xp > 0 ? `+${entry.xp}` : "0"} XP
      </span>
    </li>
  );
}
