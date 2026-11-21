"use client";

import { useId, useState } from "react";
import { AddToCollection } from "@/components/my-library/AddToCollection";
import { SavePlanButton } from "@/components/my-library/SaveButtons";
import { asApiError } from "@/components/progress/api";
import { formatDate, formatDay } from "@/components/progress/format";
import {
  IconArrowUpRight,
  IconBook,
  IconBookmark,
  IconCalendar,
  IconCheck,
  IconInfo,
  IconPlay,
  IconPlus,
  IconRefresh,
} from "@/components/ui/icons";
import {
  BTN,
  BTN_SM,
  FOCUS,
  INPUT,
  LABEL,
  PANEL,
  PANEL_MUTED,
  RIBBON,
  TAG,
} from "@/components/ui/styles";
import { MINUTES_LIMITS, localDay, stepMinutes } from "@/lib/librarian/planDetails";
import type {
  LibrarianTask,
  PlanItem,
  ResourceCard,
  ResourceType,
  StudyPlanView,
} from "@/lib/librarian/types";
import {
  ACTIVITY_LABELS,
  DotRow,
  EDGE_TAG,
  LEAF_BTN_SM,
  NOTICE,
  RESOURCE_LABELS,
  SourceLink,
  TEXT_LINK,
  domainOf,
} from "./parts";

/** What the Librarian found (overview, key ideas, sources, caveats) and the study plan. */

export const resourceAnchor = (id: string) => `librarian-resource-${id}`;

/**
 * A section of her results: a report or a schedule, set apart from the conversation above by a
 * dashed rule, with a ribbon over its big title. Its cards (sources, days) are stickers.
 */
const SECTION = "border-t-[3px] border-dashed border-walnut/20 pt-7";
const SECTION_RIBBON = `${RIBBON} -rotate-2 gap-1.5`;
const SECTION_TITLE = "mt-3 font-display text-[26px] leading-tight font-bold text-walnut";
const SUBHEAD = "font-display text-[17px] font-semibold text-walnut";
/** A plan figure (exam day, minutes a day, done) as a small sticker tile. Add a `bg-…`. */
const STAT =
  "rounded-[16px] border-[2.5px] border-walnut px-3.5 py-2 text-walnut shadow-[0_3px_0_#1f1a16]";

/** Each kind of source gets a ribbon colour of its own (the word on it says what it is). */
const RESOURCE_TONES: Record<ResourceType, string> = {
  article: "bg-sun",
  video: "bg-tangerine",
  course: "bg-leaf",
  paper: "bg-lamp",
  tutorial: "bg-leaf",
  documentation: "bg-sun",
  other: "bg-surface",
};

/** A "minus" in the icon set's style (24px grid, 1.75 stroke, currentColor). */
function IconMinus({
  size = 20,
  strokeWidth = 1.75,
  className = "",
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d="M5 12h14" />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* Sources                                                             */
/* ------------------------------------------------------------------ */

/**
 * One source as a row of a source list: where it's from, its title, a short summary, why it helps
 * this student, and the ways to open or save it.
 */
export function ResourceCardView({
  card,
  onSave,
  compact = false,
}: {
  card: ResourceCard;
  /** Saves (true) or unsaves (false) it on the server. */
  onSave: (saved: boolean) => Promise<void>;
  /** A shorter row for the saved list. */
  compact?: boolean;
}) {
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    onSave(!card.saved).then(
      () => setBusy(false),
      (err: unknown) => {
        setBusy(false);
        setError(asApiError(err).message);
      },
    );
  };
  return (
    <article
      id={compact ? undefined : resourceAnchor(card.id)}
      tabIndex={compact ? undefined : -1}
      aria-labelledby={titleId}
      className="relative scroll-mt-6 rounded-[20px] border-[2.5px] border-walnut bg-surface px-4 pt-5 pb-4 shadow-[0_4px_0_#1f1a16] outline-none focus-visible:ring-4 focus-visible:ring-sun focus-visible:ring-offset-2 focus-visible:ring-offset-walnut"
    >
      <span className={`${EDGE_TAG} absolute -top-3 left-4 ${RESOURCE_TONES[card.resourceType]}`}>
        {RESOURCE_LABELS[card.resourceType]}
      </span>
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-display text-[13px] leading-5 font-medium text-ink-soft">
        <span className="font-semibold text-walnut">{card.domain || domainOf(card.url)}</span>
        {card.difficulty && (
          <>
            <span aria-hidden>·</span>
            <span>{card.difficulty}</span>
          </>
        )}
      </p>
      <h4
        id={titleId}
        className="mt-1 font-display text-[17px] leading-snug font-semibold text-walnut"
      >
        {card.title}
      </h4>
      {!compact && card.summary && (
        <p className="mt-1.5 max-w-[68ch] text-[15px] leading-6 font-medium text-ink-soft">
          {card.summary}
        </p>
      )}
      {!compact && card.relevance && (
        <p className="mt-3 max-w-[68ch] rounded-[14px] border-2 border-dashed border-walnut/30 bg-canvas px-3 py-2 text-sm leading-6 font-medium text-ink-soft">
          <span className="font-display font-semibold text-walnut">Why this helps: </span>
          {card.relevance}
        </p>
      )}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <SourceLink href={card.url} className={BTN_SM.secondary}>
          Open source
          <IconArrowUpRight size={15} strokeWidth={2.25} />
        </SourceLink>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={card.saved}
          className={card.saved ? LEAF_BTN_SM : BTN_SM.quiet}
        >
          <IconBookmark size={16} fill={card.saved ? "currentColor" : "none"} />
          {card.saved ? "Saved" : "Save"}
        </button>
        <AddToCollection item={{ kind: "resource", sourceId: card.id }} what="this source" />
        <span className="ml-auto font-display text-xs font-medium text-ink-soft">
          Accessed {formatDate(card.accessedAt)}
        </span>
        {error && (
          <span role="alert" className="basis-full text-[13px] font-medium text-danger">
            {error}
          </span>
        )}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Findings                                                            */
/* ------------------------------------------------------------------ */

export function Findings({
  task,
  onSave,
}: {
  task: LibrarianTask;
  onSave: (card: ResourceCard, saved: boolean) => Promise<void>;
}) {
  const { overview, keyConcepts, resources, warnings } = task;
  const finished = task.status === "completed";
  return (
    <section aria-labelledby="librarian-findings" className={`${SECTION} space-y-6`}>
      <div>
        <p className={SECTION_RIBBON}>
          <IconBook size={15} strokeWidth={2.25} />
          What she found
        </p>
        <h3 id="librarian-findings" className={SECTION_TITLE}>
          {task.topic || "Your research"}
        </h3>
        <DotRow className="mt-2.5" />
      </div>
      {overview && (
        <p className="max-w-[68ch] text-[15px] leading-7 font-medium whitespace-pre-line text-walnut">
          {overview}
        </p>
      )}
      {keyConcepts.length > 0 && (
        <div>
          <h4 className={SUBHEAD}>Key ideas</h4>
          <ul className="mt-2.5 flex flex-wrap gap-2" aria-label="Key ideas">
            {keyConcepts.map((c) => (
              <li
                key={c}
                className="rounded-full border-2 border-walnut bg-canvas px-3 py-1 font-display text-[13px] leading-5 font-semibold text-walnut shadow-[0_2px_0_#1f1a16] odd:-rotate-1 even:rotate-1"
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div role="note" className={`${NOTICE} flex gap-3 px-4 py-3 text-sm leading-6`}>
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-walnut bg-sun text-walnut">
            <IconInfo size={16} strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-display text-[15px] font-semibold text-walnut">Worth knowing</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 font-medium text-ink-soft marker:text-tangerine">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div>
        <h4 className={`${SUBHEAD} flex items-center gap-2`}>
          Sources
          {resources.length > 0 && (
            <span className="tabular inline-grid h-6 min-w-6 place-items-center rounded-full border-2 border-walnut bg-sun px-1.5 text-[13px] leading-none font-bold">
              {resources.length}
            </span>
          )}
        </h4>
        {resources.length > 0 ? (
          <ul className="mt-5 space-y-6">
            {resources.map((r) => (
              <li key={r.id}>
                <ResourceCardView card={r} onSave={(saved) => onSave(r, saved)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm font-medium text-ink-soft">
            {finished
              ? "She didn't find sources she could stand behind for this one."
              : "No sources yet."}
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Plan: asking for the details                                        */
/* ------------------------------------------------------------------ */

export interface PlanDetails {
  examDate?: string;
  minutesPerDay?: number;
}

const STEPPER = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border-[3px] border-walnut bg-surface text-walnut shadow-[0_4px_0_#1f1a16] transition-[background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px hover:bg-canvas active:translate-y-[3px] active:shadow-[0_1px_0_#1f1a16] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:bg-surface disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0_#1f1a16] motion-reduce:transition-none ${FOCUS}`;

/** Asks for what the request didn't say: the exam date and/or the minutes a day. */
export function PlanForm({
  askDate,
  askMinutes,
  busy,
  onSubmit,
  onCancel,
}: {
  askDate: boolean;
  askMinutes: boolean;
  busy: boolean;
  onSubmit: (details: PlanDetails) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const [today] = useState(localDay);
  const [date, setDate] = useState("");
  const [minutes, setMinutes] = useState<number>(MINUTES_LIMITS.initial);
  return (
    <form
      className={`${PANEL} relative space-y-5 p-5 pt-6`}
      aria-labelledby={`${uid}-title`}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...(askDate && date ? { examDate: date } : {}),
          ...(askMinutes ? { minutesPerDay: minutes } : {}),
        });
      }}
    >
      <div>
        <p className={`${RIBBON} absolute -top-3.5 left-5 -rotate-2 gap-1.5`}>
          <IconCalendar size={15} strokeWidth={2.25} />
          Study plan
        </p>
        <h3 id={`${uid}-title`} className="font-display text-xl font-bold text-walnut">
          A couple of details first
        </h3>
      </div>
      {askDate && (
        <label className="block">
          <span className={LABEL}>When is your exam or deadline?</span>
          <span className="mt-0.5 block text-[13px] font-medium text-ink-soft">
            Leave it empty if there isn&apos;t one.
          </span>
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e) => setDate(e.target.value)}
            className={`${INPUT} tabular mt-2 max-w-[13rem]`}
          />
        </label>
      )}
      {askMinutes && (
        <div role="group" aria-labelledby={`${uid}-minutes`}>
          <span id={`${uid}-minutes`} className={LABEL}>
            How long can you study each day?
          </span>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              className={STEPPER}
              onClick={() => setMinutes((m) => stepMinutes(m, -1))}
              disabled={minutes <= MINUTES_LIMITS.min}
              aria-label="Less time"
            >
              <IconMinus size={18} strokeWidth={2.5} />
            </button>
            <output
              aria-live="polite"
              className="tabular grid h-11 min-w-24 place-items-center rounded-[14px] border-[3px] border-walnut bg-canvas px-3 font-display text-lg font-bold text-walnut"
            >
              {minutes} min
            </output>
            <button
              type="button"
              className={STEPPER}
              onClick={() => setMinutes((m) => stepMinutes(m, 1))}
              disabled={minutes >= MINUTES_LIMITS.max}
              aria-label="More time"
            >
              <IconPlus size={18} strokeWidth={2.5} />
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2.5">
        <button type="submit" className={BTN.primary} disabled={busy}>
          {busy ? "Asking…" : "Build my plan"}
        </button>
        <button type="button" className={BTN.secondary} onClick={onCancel} disabled={busy}>
          Not now
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Plan                                                                */
/* ------------------------------------------------------------------ */

export type ItemAction = "complete" | "skip" | "reopen" | "reschedule";

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "") === b.replace(/\/+$/, "");

/** Scrolls to a source's card in the panel and focuses it. */
function goToCard(id: string) {
  const el = document.getElementById(resourceAnchor(id));
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  el?.focus({ preventScroll: true });
}

/** The plan as a schedule: a row per day (date on the left), its tasks listed beside it. */
export function PlanView({
  plan,
  resources,
  pendingItem,
  xp,
  onItem,
  onLesson,
  lessonBusy,
}: {
  plan: StudyPlanView;
  resources: ResourceCard[];
  /** The item whose action is on its way. */
  pendingItem: string | null;
  /** XP earned by completing items in this visit, by item id. */
  xp: Record<string, number>;
  onItem: (item: PlanItem, action: ItemAction, date?: string) => void;
  onLesson: (item: PlanItem) => void;
  lessonBusy: boolean;
}) {
  const items = plan.days.flatMap((d) => d.items);
  const done = items.filter((i) => i.status === "done").length;
  const share = items.length ? done / items.length : 0;
  return (
    <section aria-labelledby="librarian-plan" className={`${SECTION} space-y-6`}>
      <div>
        <p className={SECTION_RIBBON}>
          <IconCalendar size={15} strokeWidth={2.25} />
          Study plan
        </p>
        <h3 id="librarian-plan" className={SECTION_TITLE}>
          {plan.title}
        </h3>
        {plan.goal && (
          <p className="mt-1.5 max-w-[68ch] text-[15px] leading-6 font-medium text-ink-soft">
            {plan.goal}
          </p>
        )}
        <dl className="mt-4 flex flex-wrap gap-2.5 font-display text-[13px] leading-5">
          {plan.examDate && (
            <div className={`${STAT} bg-sun`}>
              <dt className="font-medium text-walnut/80">Exam</dt>
              <dd className="tabular text-[17px] font-bold">
                {formatDay(plan.examDate, { weekday: "short", month: "short", day: "numeric" })}
              </dd>
            </div>
          )}
          <div className={`${STAT} bg-surface`}>
            <dt className="font-medium text-walnut/80">Each day</dt>
            <dd className="tabular text-[17px] font-bold">{plan.dailyMinutes} min</dd>
          </div>
          <div className={`${STAT} bg-leaf`}>
            <dt className="font-medium text-walnut/80">Done</dt>
            <dd className="tabular text-[17px] font-bold">
              {done} of {items.length}
            </dd>
          </div>
        </dl>
        {/* A chunky progress bar: leaf filling a walnut-outlined track. */}
        <div
          aria-hidden
          className="mt-4 h-4 w-full max-w-xs overflow-hidden rounded-full border-[2.5px] border-walnut bg-canvas shadow-[0_2px_0_#1f1a16]"
        >
          <div
            className={`h-full rounded-full bg-leaf transition-[width] duration-300 ease-out motion-reduce:transition-none ${share > 0 && share < 1 ? "border-r-[2.5px] border-walnut" : ""}`}
            style={{ width: `${share * 100}%` }}
          />
        </div>
        <div className="mt-4">
          <SavePlanButton planId={plan.id} />
        </div>
      </div>
      {plan.assumptions.length > 0 && (
        <div className={`${PANEL_MUTED} px-4 py-3 text-sm leading-6`}>
          <p className="font-display text-[15px] font-semibold text-walnut">What she assumed</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 font-medium text-ink-soft marker:text-tangerine">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <ol className="space-y-4">
        {plan.days.map((day) => {
          const dayMinutes = day.items.reduce((n, i) => n + i.estimatedMinutes, 0);
          const intro = !!day.focus || day.objectives.length > 0;
          return (
            <li
              key={day.date}
              className="grid gap-x-6 gap-y-2 rounded-[20px] border-[2.5px] border-walnut bg-surface p-4 shadow-[0_4px_0_#1f1a16] sm:grid-cols-[7rem_minmax(0,1fr)] sm:p-5"
            >
              <div className="flex items-center gap-3 sm:block">
                <h4 className="flex items-baseline gap-2 font-display sm:block">
                  <span className="text-[13px] font-semibold text-ink-soft sm:block">
                    {formatDay(day.date, { weekday: "long" })}
                  </span>{" "}
                  <span className="tabular text-[22px] leading-tight font-bold text-walnut sm:mt-0.5 sm:block">
                    {formatDay(day.date, { month: "short", day: "numeric" })}
                  </span>
                </h4>
                <p className={`${TAG.neutral} tabular sm:mt-2`}>{dayMinutes} min</p>
              </div>
              <div className="min-w-0">
                {day.focus && <p className={SUBHEAD}>{day.focus}</p>}
                {day.objectives.length > 0 && (
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[13px] leading-5 font-medium text-ink-soft marker:text-tangerine">
                    {day.objectives.map((o) => (
                      <li key={o}>{o}</li>
                    ))}
                  </ul>
                )}
                <ul
                  className={`divide-y-2 divide-dashed divide-walnut/15 ${intro ? "mt-3 border-t-2 border-dashed border-walnut/15" : ""}`}
                >
                  {day.items.map((item) => (
                    <PlanItemRow
                      key={item.id}
                      item={item}
                      resources={resources}
                      busy={pendingItem === item.id}
                      xp={xp[item.id] ?? 0}
                      intro={intro}
                      onItem={onItem}
                      onLesson={onLesson}
                      lessonBusy={lessonBusy}
                    />
                  ))}
                </ul>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** A task's state as a mark beside it (the words "Done" or "Skipped" are in the row too). */
function StatusMark({ status }: { status: PlanItem["status"] }) {
  if (status === "done") {
    return (
      <span
        aria-hidden
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-walnut bg-leaf text-walnut shadow-[0_2px_0_#1f1a16]"
      >
        <IconCheck size={14} strokeWidth={3} />
      </span>
    );
  }
  if (status === "skipped") {
    return (
      <span
        aria-hidden
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-walnut/40 bg-canvas text-ink-soft"
      >
        <IconMinus size={13} strokeWidth={2.75} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="h-6 w-6 shrink-0 rounded-full border-[2.5px] border-walnut bg-surface"
    />
  );
}

const DATE_SM = `tabular h-9 rounded-[12px] border-2 border-walnut bg-white px-2 text-[13px] font-semibold text-walnut shadow-[inset_0_2px_0_rgb(31_26_22/0.08)] outline-none focus-visible:ring-4 focus-visible:ring-sun`;

function PlanItemRow({
  item,
  resources,
  busy,
  xp,
  intro,
  onItem,
  onLesson,
  lessonBusy,
}: {
  item: PlanItem;
  resources: ResourceCard[];
  busy: boolean;
  xp: number;
  /** The day has a focus line above its tasks (the first task then starts below a rule). */
  intro: boolean;
  onItem: (item: PlanItem, action: ItemAction, date?: string) => void;
  onLesson: (item: PlanItem) => void;
  lessonBusy: boolean;
}) {
  const uid = useId();
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(item.date);
  const open = item.status === "todo";
  const lessonish = item.type === "lesson" || item.type === "review";
  // Only web pages are linked; a part of the student's own notes has no url (it's in the text).
  const urls = item.resourceUrls.filter((url) => url.trim());
  return (
    <li
      aria-labelledby={`${uid}-title`}
      className={`flex gap-3 py-3.5 last:pb-0 ${intro ? "" : "first:pt-0"}`}
    >
      <StatusMark status={item.status} />
      <div className="min-w-0 flex-1">
        <p
          id={`${uid}-title`}
          className={`font-display text-[16px] leading-6 font-semibold ${item.status === "skipped" ? "text-ink-soft line-through decoration-ink-soft/50" : "text-walnut"}`}
        >
          {item.title}
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 font-display text-[13px] leading-5 font-medium text-ink-soft">
          <span>{ACTIVITY_LABELS[item.type]}</span>
          <span aria-hidden>·</span>
          <span className="tabular">{item.estimatedMinutes} min</span>
          {item.status !== "todo" && (
            <>
              <span aria-hidden>·</span>
              <span
                className={
                  item.status === "done"
                    ? "rounded-full border-2 border-walnut bg-leaf px-2 text-[12px] font-semibold text-walnut"
                    : ""
                }
              >
                {item.status === "done" ? "Done" : "Skipped"}
              </span>
            </>
          )}
          {xp > 0 && (
            <span role="status" className={`${TAG.brass} tabular title-pop ml-1 -rotate-3`}>
              +{xp} XP
            </span>
          )}
        </p>
        {item.description && (
          <p className="mt-1 text-sm leading-6 font-medium text-ink-soft">{item.description}</p>
        )}
        {urls.length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Sources">
            {urls.map((url) => {
              const card = resources.find((r) => sameUrl(r.url, url));
              return (
                <li key={url}>
                  {card ? (
                    <a
                      href={`#${resourceAnchor(card.id)}`}
                      className={TEXT_LINK}
                      onClick={(e) => {
                        e.preventDefault();
                        goToCard(card.id);
                      }}
                    >
                      {card.title}
                    </a>
                  ) : (
                    <SourceLink
                      href={url}
                      className={`${TEXT_LINK} inline-flex items-center gap-1`}
                    >
                      {domainOf(url)}
                      <IconArrowUpRight size={14} />
                    </SourceLink>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {item.completionCriteria.length > 0 && (
          <div className="mt-1.5 text-[13px] leading-5 font-medium text-ink-soft">
            <span className="font-display font-semibold text-walnut">Done when: </span>
            <ul className="inline">
              {item.completionCriteria.map((c, i) => (
                <li key={c} className="inline">
                  {i > 0 && " · "}
                  {c}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {open ? (
            <>
              <button
                type="button"
                className={LEAF_BTN_SM}
                disabled={busy}
                onClick={() => onItem(item, "complete")}
              >
                <IconCheck size={16} strokeWidth={2.5} />
                Complete
              </button>
              <button
                type="button"
                className={BTN_SM.quiet}
                disabled={busy}
                onClick={() => onItem(item, "skip")}
              >
                Skip
              </button>
              <button
                type="button"
                className={BTN_SM.quiet}
                disabled={busy}
                aria-expanded={moving}
                onClick={() => setMoving((m) => !m)}
              >
                <IconCalendar size={16} />
                Reschedule
              </button>
              {lessonish && (
                <button
                  type="button"
                  className={BTN_SM.quiet}
                  disabled={busy || lessonBusy}
                  onClick={() => onLesson(item)}
                >
                  <IconPlay size={16} />
                  Start lesson
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className={`${BTN_SM.quiet} -ml-2.5`}
              disabled={busy}
              onClick={() => onItem(item, "reopen")}
            >
              <IconRefresh size={16} />
              Reopen
            </button>
          )}
          {busy && (
            <span className="font-display text-[13px] font-medium text-ink-soft">Saving…</span>
          )}
        </div>
        {moving && open && (
          <form
            className="mt-2.5 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!date) return;
              setMoving(false);
              onItem(item, "reschedule", date);
            }}
          >
            <label className="flex items-center gap-2 font-display text-[13px] font-semibold text-walnut">
              Move to
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className={DATE_SM}
              />
            </label>
            <button type="submit" className={BTN_SM.secondary} disabled={busy || !date}>
              Move
            </button>
            <button type="button" className={BTN_SM.quiet} onClick={() => setMoving(false)}>
              Cancel
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
