"use client";

import { useId, useState } from "react";
import { asApiError } from "@/components/progress/api";
import { formatDate, formatDay } from "@/components/progress/format";
import { CARD, Tag } from "@/components/progress/ui";
import { MINUTES_LIMITS, localDay, stepMinutes } from "@/lib/librarian/planDetails";
import type { LibrarianTask, PlanItem, ResourceCard, StudyPlanView } from "@/lib/librarian/types";
import {
  ACTIVITY_LABELS,
  BUTTON,
  EYEBROW,
  PRIMARY,
  RESOURCE_LABELS,
  SourceLink,
  TINY_BUTTON,
  domainOf,
} from "./parts";

/** What the Librarian found (overview, key ideas, sources, caveats) and the study plan. */

export const resourceAnchor = (id: string) => `librarian-resource-${id}`;

const LINK =
  "font-bold text-ink underline decoration-ink/30 underline-offset-2 transition hover:decoration-ink focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember";

/* ------------------------------------------------------------------ */
/* Resource cards                                                      */
/* ------------------------------------------------------------------ */

export function ResourceCardView({
  card,
  onSave,
  compact = false,
}: {
  card: ResourceCard;
  /** Saves (true) or unsaves (false) it on the server. */
  onSave: (saved: boolean) => Promise<void>;
  /** A shorter card for the saved list. */
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
      className="flex w-full scroll-mt-4 flex-col rounded-2xl bg-cream p-4 ring-1 ring-ink/10 outline-none focus-visible:ring-2 focus-visible:ring-ember"
    >
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
        <Tag>{RESOURCE_LABELS[card.resourceType]}</Tag>
        <span className="font-bold">{card.domain || domainOf(card.url)}</span>
        {card.difficulty && (
          <>
            <span aria-hidden>·</span>
            <span>{card.difficulty}</span>
          </>
        )}
      </div>
      <h4 id={titleId} className="mt-1.5 font-display text-base leading-snug font-semibold">
        {card.title}
      </h4>
      {!compact && card.summary && <p className="mt-1.5 text-sm text-ink">{card.summary}</p>}
      {!compact && card.relevance && (
        <p className="mt-1.5 text-sm text-ink-soft">
          <span className="font-bold text-ink">Why it&apos;s useful: </span>
          {card.relevance}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-soft">Accessed {formatDate(card.accessedAt)}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <SourceLink href={card.url} className={TINY_BUTTON}>
          Open source <span aria-hidden>↗</span>
        </SourceLink>
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          aria-pressed={card.saved}
          className={`${TINY_BUTTON} ${card.saved ? "bg-ink text-cream ring-ink hover:bg-wood-dark" : ""}`}
        >
          {card.saved ? "Saved ✓" : "Save"}
        </button>
        {error && (
          <span role="alert" className="text-xs font-bold text-red-800">
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
    <section aria-labelledby="librarian-findings" className="space-y-4">
      <div>
        <p className={EYEBROW}>What she found</p>
        <h3 id="librarian-findings" className="font-display text-xl font-semibold">
          {task.topic || "Your research"}
        </h3>
      </div>
      {overview && <p className="text-[0.95rem] leading-relaxed whitespace-pre-line">{overview}</p>}
      {keyConcepts.length > 0 && (
        <div>
          <h4 className="text-sm font-extrabold">Key ideas</h4>
          <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Key ideas">
            {keyConcepts.map((c) => (
              <li
                key={c}
                className="rounded-full bg-cream px-3 py-1 text-sm font-bold ring-1 ring-ink/10"
              >
                {c}
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div role="note" className="rounded-2xl bg-lamp/40 px-4 py-3 text-sm ring-1 ring-lamp">
          <p className="font-extrabold">Worth knowing</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h4 className="text-sm font-extrabold">
          Sources{resources.length > 0 ? ` (${resources.length})` : ""}
        </h4>
        {resources.length > 0 ? (
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {resources.map((r) => (
              <li key={r.id} className="flex">
                <ResourceCardView card={r} onSave={(saved) => onSave(r, saved)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-ink-soft">
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
      className={`${CARD} space-y-4`}
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
        <p className={EYEBROW}>Study plan</p>
        <h3 id={`${uid}-title`} className="font-display text-lg font-semibold">
          A couple of details first
        </h3>
      </div>
      {askDate && (
        <label className="block">
          <span className="text-sm font-extrabold">When is your exam or deadline?</span>
          <span className="block text-xs text-ink-soft">
            Leave it empty if there isn&apos;t one.
          </span>
          <input
            type="date"
            value={date}
            min={today}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1.5 rounded-xl bg-white/70 px-3 py-2 text-sm ring-1 ring-ink/15 focus-visible:outline-3 focus-visible:outline-ember"
          />
        </label>
      )}
      {askMinutes && (
        <div role="group" aria-labelledby={`${uid}-minutes`}>
          <span id={`${uid}-minutes`} className="text-sm font-extrabold">
            How long can you study each day?
          </span>
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              className={`${BUTTON} h-9 w-9 !px-0`}
              onClick={() => setMinutes((m) => stepMinutes(m, -1))}
              disabled={minutes <= MINUTES_LIMITS.min}
              aria-label="Less time"
            >
              −
            </button>
            <output aria-live="polite" className="min-w-20 text-center text-base font-extrabold">
              {minutes} min
            </output>
            <button
              type="button"
              className={`${BUTTON} h-9 w-9 !px-0`}
              onClick={() => setMinutes((m) => stepMinutes(m, 1))}
              disabled={minutes >= MINUTES_LIMITS.max}
              aria-label="More time"
            >
              +
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={PRIMARY} disabled={busy}>
          {busy ? "Asking…" : "Build my plan"}
        </button>
        <button type="button" className={BUTTON} onClick={onCancel} disabled={busy}>
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
  return (
    <section aria-labelledby="librarian-plan" className="space-y-4">
      <div>
        <p className={EYEBROW}>Study plan</p>
        <h3 id="librarian-plan" className="font-display text-xl font-semibold">
          {plan.title}
        </h3>
        {plan.goal && <p className="mt-1 text-sm text-ink-soft">{plan.goal}</p>}
        <p className="mt-1.5 text-xs font-bold text-ink-soft">
          {plan.examDate
            ? `Exam ${formatDay(plan.examDate, { weekday: "short", month: "short", day: "numeric" })} · `
            : ""}
          {plan.dailyMinutes} min a day · {done} of {items.length} done
        </p>
      </div>
      {plan.assumptions.length > 0 && (
        <div className="rounded-2xl bg-cream/70 px-4 py-3 text-sm ring-1 ring-ink/10">
          <p className="font-extrabold">What she assumed</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-ink-soft">
            {plan.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <ol className="space-y-4">
        {plan.days.map((day) => (
          <li key={day.date} className={`${CARD} !p-4`}>
            <h4 className="font-display text-base font-semibold">
              {formatDay(day.date, { weekday: "long", month: "short", day: "numeric" })}
              {day.focus && <span className="font-sans text-sm text-ink-soft"> · {day.focus}</span>}
            </h4>
            {day.objectives.length > 0 && (
              <ul className="mt-1 list-disc pl-5 text-xs text-ink-soft">
                {day.objectives.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            )}
            <ul className="mt-3 space-y-3">
              {day.items.map((item) => (
                <PlanItemRow
                  key={item.id}
                  item={item}
                  resources={resources}
                  busy={pendingItem === item.id}
                  xp={xp[item.id] ?? 0}
                  onItem={onItem}
                  onLesson={onLesson}
                  lessonBusy={lessonBusy}
                />
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlanItemRow({
  item,
  resources,
  busy,
  xp,
  onItem,
  onLesson,
  lessonBusy,
}: {
  item: PlanItem;
  resources: ResourceCard[];
  busy: boolean;
  xp: number;
  onItem: (item: PlanItem, action: ItemAction, date?: string) => void;
  onLesson: (item: PlanItem) => void;
  lessonBusy: boolean;
}) {
  const uid = useId();
  const [moving, setMoving] = useState(false);
  const [date, setDate] = useState(item.date);
  const open = item.status === "todo";
  const lessonish = item.type === "lesson" || item.type === "review";
  return (
    <li
      aria-labelledby={`${uid}-title`}
      className={`rounded-2xl bg-parchment/70 p-3 ring-1 ring-ink/10 ${open ? "" : "opacity-75"}`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Tag>{ACTIVITY_LABELS[item.type]}</Tag>
        <span className="text-xs font-bold text-ink-soft">{item.estimatedMinutes} min</span>
        {item.status !== "todo" && (
          <Tag tone={item.status === "done" ? "demo" : "plain"}>
            {item.status === "done" ? "Done" : "Skipped"}
          </Tag>
        )}
        {xp > 0 && (
          <span
            role="status"
            className="rounded-full bg-lamp px-2 py-0.5 text-[0.7rem] font-extrabold text-ink"
          >
            +{xp} XP
          </span>
        )}
      </div>
      <p
        id={`${uid}-title`}
        className={`mt-1 font-bold ${item.status === "skipped" ? "line-through decoration-ink/40" : ""}`}
      >
        {item.title}
      </p>
      {item.description && <p className="mt-0.5 text-sm text-ink-soft">{item.description}</p>}
      {item.resourceUrls.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-sm" aria-label="Sources">
          {item.resourceUrls.map((url) => {
            const card = resources.find((r) => sameUrl(r.url, url));
            return (
              <li key={url}>
                {card ? (
                  <a
                    href={`#${resourceAnchor(card.id)}`}
                    className={LINK}
                    onClick={(e) => {
                      e.preventDefault();
                      goToCard(card.id);
                    }}
                  >
                    {card.title}
                  </a>
                ) : (
                  <SourceLink href={url} className={LINK}>
                    {domainOf(url)} <span aria-hidden>↗</span>
                  </SourceLink>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {item.completionCriteria.length > 0 && (
        <div className="mt-1.5 text-xs text-ink-soft">
          <span className="font-extrabold text-ink">Done when: </span>
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
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        {open ? (
          <>
            <button
              type="button"
              className={TINY_BUTTON}
              disabled={busy}
              onClick={() => onItem(item, "complete")}
            >
              ✓ Complete
            </button>
            <button
              type="button"
              className={TINY_BUTTON}
              disabled={busy}
              onClick={() => onItem(item, "skip")}
            >
              Skip
            </button>
            <button
              type="button"
              className={TINY_BUTTON}
              disabled={busy}
              aria-expanded={moving}
              onClick={() => setMoving((m) => !m)}
            >
              Reschedule
            </button>
            {lessonish && (
              <button
                type="button"
                className={TINY_BUTTON}
                disabled={busy || lessonBusy}
                onClick={() => onLesson(item)}
              >
                ▶ Start lesson
              </button>
            )}
          </>
        ) : (
          <button
            type="button"
            className={TINY_BUTTON}
            disabled={busy}
            onClick={() => onItem(item, "reopen")}
          >
            Reopen
          </button>
        )}
        {busy && <span className="text-xs text-ink-soft">Saving…</span>}
      </div>
      {moving && open && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!date) return;
            setMoving(false);
            onItem(item, "reschedule", date);
          }}
        >
          <label className="text-xs font-bold">
            Move to{" "}
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="ml-1 rounded-lg bg-white/70 px-2 py-1 text-xs ring-1 ring-ink/15 focus-visible:outline-3 focus-visible:outline-ember"
            />
          </label>
          <button type="submit" className={TINY_BUTTON} disabled={busy || !date}>
            Move
          </button>
          <button type="button" className={TINY_BUTTON} onClick={() => setMoving(false)}>
            Cancel
          </button>
        </form>
      )}
    </li>
  );
}
