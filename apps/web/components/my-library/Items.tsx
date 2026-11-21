"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { RESOURCE_LABELS, SourceLink } from "@/components/librarian/parts";
import { asApiError } from "@/components/progress/api";
import { IconArrowUpRight, IconCalendar, IconPlay, IconTrash } from "@/components/ui/icons";
import { BTN_SM, INPUT } from "@/components/ui/styles";
import { getItem, updateItem } from "@/lib/library/client";
import {
  LIBRARY_LIMITS,
  type LibraryItem,
  type PlanSnapshotDay,
  type SavedSource,
} from "@/lib/library/types";
import { AddToCollection } from "./AddToCollection";
import {
  EDGE_TAG,
  ERROR_LINE,
  ITEM_CARD,
  KIND_LABELS,
  KIND_TONES,
  PrivateBadge,
  ProgressBar,
  Spinner,
  TEXT_LINK,
  shortDate,
} from "./parts";

/** One saved thing in your library, as a sticker card: what it is, and what you can do with it. */

const META =
  "flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-display text-[13px] leading-5 font-medium text-ink-soft";
const TITLE = "mt-1 font-display text-[17px] leading-snug font-semibold break-words text-walnut";
const BODY = "mt-1.5 max-w-[68ch] text-[15px] leading-6 font-medium text-ink-soft";
const REMOVE = `${BTN_SM.quiet} text-ink-soft hover:text-danger`;

/** The card's top edge: its kind on the left, "Private" on the right. */
function Edge({ label, tone }: { label: string; tone: string }) {
  return (
    <>
      <span className={`${EDGE_TAG} absolute -top-3 left-4 ${tone}`}>{label}</span>
      <PrivateBadge className="absolute -top-3 right-4 shadow-[0_2px_0_#1f1a16]" />
    </>
  );
}

/** A remove button that says what it's doing while it does it. */
function RemoveButton({ label, onRemove }: { label: string; onRemove: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className={REMOVE}
        disabled={busy}
        aria-label={label}
        onClick={() => {
          setBusy(true);
          setError(null);
          onRemove().then(
            () => setBusy(false),
            (err: unknown) => {
              setBusy(false);
              setError(asApiError(err).message);
            },
          );
        }}
      >
        {busy ? <Spinner /> : <IconTrash size={16} />}
        <span aria-hidden>{busy ? "Removing…" : "Remove"}</span>
      </button>
      {error && (
        <span role="alert" className={`basis-full ${ERROR_LINE}`}>
          {error}
        </span>
      )}
    </>
  );
}

/** A source the Librarian found that you saved. */
export function SavedSourceCard({
  source,
  onRemove,
}: {
  source: SavedSource;
  onRemove: () => Promise<unknown>;
}) {
  const titleId = useId();
  return (
    <article aria-labelledby={titleId} className={ITEM_CARD}>
      <Edge label={RESOURCE_LABELS[source.resourceType] ?? "Page"} tone="bg-sun" />
      <p className={META}>
        <span className="font-semibold text-walnut">{source.domain}</span>
        {source.savedAt && (
          <>
            <span aria-hidden>·</span>
            <span>Saved {shortDate(source.savedAt)}</span>
          </>
        )}
      </p>
      <h3 id={titleId} className={TITLE}>
        {source.title}
      </h3>
      {source.summary && <p className={`${BODY} line-clamp-3`}>{source.summary}</p>}
      {source.topic && (
        <p className="mt-1.5 text-[13px] leading-5 font-medium text-ink-soft">
          From your request about <span className="font-semibold text-walnut">{source.topic}</span>
        </p>
      )}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <SourceLink href={source.url} className={BTN_SM.secondary}>
          Open source
          <IconArrowUpRight size={15} strokeWidth={2.25} />
        </SourceLink>
        <AddToCollection item={{ kind: "resource", sourceId: source.id }} what="this source" />
        <RemoveButton label={`Remove ${source.title} from Saved`} onRemove={onRemove} />
      </div>
    </article>
  );
}

/** A plan's saved days, loaded when asked for. */
function PlanDays({ item }: { item: LibraryItem }) {
  const [days, setDays] = useState<PlanSnapshotDay[] | null>(null);
  const [state, setState] = useState<"closed" | "loading" | "open" | "error">("closed");
  const [error, setError] = useState("");
  const uid = useId();
  const toggle = () => {
    if (state === "open") return setState("closed");
    if (days) return setState("open");
    setState("loading");
    getItem(item.collectionId, item.id).then(
      (d) => {
        setDays(d.planDays ?? []);
        setState("open");
      },
      (err: unknown) => {
        setError(asApiError(err).message);
        setState("error");
      },
    );
  };
  return (
    <div className="basis-full">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={state === "open"}
        aria-controls={uid}
        className={`${BTN_SM.quiet} -ml-2.5`}
      >
        {state === "loading" ? <Spinner /> : <IconCalendar size={16} />}
        {state === "open" ? "Hide the days" : "Show the days"}
      </button>
      {state === "error" && (
        <p role="alert" className={ERROR_LINE}>
          {error}
        </p>
      )}
      {state === "open" && days && (
        <ol id={uid} className="mt-2 space-y-2.5">
          {days.length === 0 && (
            <li className="text-[14px] font-medium text-ink-soft">This copy has no days saved.</li>
          )}
          {days.map((d) => (
            <li
              key={d.date}
              className="rounded-[14px] border-2 border-walnut/25 bg-canvas px-3 py-2 text-[14px]"
            >
              <p className="font-display font-semibold text-walnut">
                <span className="tabular">{shortDate(`${d.date}T12:00:00`)}</span>
                {d.focus && <span className="font-medium text-ink-soft"> · {d.focus}</span>}
              </p>
              <ul className="mt-1 space-y-0.5 font-medium text-ink-soft">
                {d.items.map((it, i) => (
                  <li key={`${it.title}-${i}`} className="flex gap-2">
                    <span
                      aria-hidden
                      className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full border-2 border-walnut ${it.status === "done" ? "bg-leaf" : "bg-surface"}`}
                    />
                    <span
                      className={
                        it.status === "skipped" ? "line-through decoration-ink-soft/50" : ""
                      }
                    >
                      {it.title} <span className="tabular">({it.minutes} min)</span>
                      {it.status === "done" && <span className="sr-only"> (done)</span>}
                      {it.status === "skipped" && <span className="sr-only"> (skipped)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** A note's text, editable in place. */
function NoteBody({ item, onChanged }: { item: LibraryItem; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  if (!editing)
    return (
      <>
        <p className={`${BODY} line-clamp-6 whitespace-pre-line text-walnut`}>{item.note}</p>
        <div className="mt-2">
          <button
            type="button"
            className={`${BTN_SM.quiet} -ml-2.5`}
            onClick={() => {
              setText(item.note ?? "");
              setEditing(true);
            }}
          >
            Edit note
          </button>
        </div>
      </>
    );
  return (
    <form
      className="mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return setError("A note needs some text.");
        setBusy(true);
        setError(null);
        updateItem(item.collectionId, item.id, { text }).then(
          () => {
            setBusy(false);
            setEditing(false);
            onChanged();
          },
          (err: unknown) => {
            setBusy(false);
            setError(asApiError(err).message);
          },
        );
      }}
    >
      <label htmlFor={uid} className="sr-only">
        Note text
      </label>
      <textarea
        id={uid}
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={LIBRARY_LIMITS.noteText}
        rows={5}
        className={`${INPUT} h-auto py-2.5 leading-6`}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="submit" className={BTN_SM.primary} disabled={busy}>
          {busy && <Spinner />}
          Save note
        </button>
        <button
          type="button"
          className={BTN_SM.quiet}
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
        {error && (
          <span role="alert" className={ERROR_LINE}>
            {error}
          </span>
        )}
      </div>
    </form>
  );
}

/** Any item in a collection (or the Lessons tab, which also says which collection it's in). */
export function ItemCard({
  item,
  showCollection = false,
  onPlay,
  onRemove,
  onChanged,
}: {
  item: LibraryItem;
  showCollection?: boolean;
  onPlay: (item: LibraryItem) => void;
  onRemove: () => Promise<unknown>;
  onChanged: () => void;
}) {
  const titleId = useId();
  const lesson = item.lesson;
  const plan = item.plan;
  const lessonShare = lesson
    ? lesson.progress.completed
      ? 1
      : lesson.progress.scene / Math.max(1, lesson.scenes)
    : 0;
  return (
    <article aria-labelledby={titleId} className={ITEM_CARD}>
      <Edge label={KIND_LABELS[item.kind]} tone={KIND_TONES[item.kind]} />
      <p className={META}>
        {item.kind === "resource" && (
          <span className="font-semibold text-walnut">{item.domain}</span>
        )}
        {lesson && (
          <>
            <span className="font-semibold text-walnut">{lesson.subject}</span>
            <span aria-hidden>·</span>
            <span className="tabular">{lesson.scenes} scenes</span>
            <span aria-hidden>·</span>
            <span className="tabular">about {Math.round(lesson.estimatedMinutes)} min</span>
          </>
        )}
        {plan && (
          <>
            {plan.examDate && (
              <span className="font-semibold text-walnut">
                Exam {shortDate(`${plan.examDate}T12:00:00`)}
              </span>
            )}
            {plan.examDate && <span aria-hidden>·</span>}
            <span className="tabular">{plan.dailyMinutes} min a day</span>
          </>
        )}
        {(item.kind === "note" || showCollection) && (
          <>
            {item.kind !== "note" && <span aria-hidden>·</span>}
            <span>
              {showCollection ? `In ${item.collectionName}` : `Added ${shortDate(item.createdAt)}`}
            </span>
          </>
        )}
      </p>
      <h3 id={titleId} className={TITLE}>
        {item.title}
      </h3>

      {item.kind === "resource" && item.summary && (
        <p className={`${BODY} line-clamp-3`}>{item.summary}</p>
      )}

      {lesson && (
        <div className="mt-2">
          <p className="text-[13px] leading-5 font-medium text-ink-soft">
            {lesson.progress.completed ? (
              <span className="font-bold text-walnut">Finished</span>
            ) : lesson.progress.scene > 0 ? (
              <span className="tabular">
                Up to scene {lesson.progress.scene + 1} of {lesson.scenes}
              </span>
            ) : (
              "Not started here yet"
            )}
            {lesson.sourceName && <> · From {lesson.sourceName}</>}
          </p>
          <ProgressBar value={lessonShare} className="mt-2 max-w-[260px]" />
          {lesson.notesTrimmed && (
            <p className="mt-2 text-[13px] leading-5 font-medium text-ink-soft">
              Only the first part of the notes fitted, so the AI teacher answers from that part.
            </p>
          )}
        </div>
      )}

      {plan && (
        <div className="mt-2">
          {plan.goal && <p className={`${BODY} mt-0 line-clamp-2`}>{plan.goal}</p>}
          <p className="mt-1.5 text-[13px] leading-5 font-medium text-ink-soft">
            <span className="tabular font-semibold text-walnut">
              {plan.done} of {plan.total} done
            </span>
            {plan.live ? " · up to date with the Librarian" : " · as it was when you saved it"}
          </p>
          <ProgressBar
            value={plan.total ? plan.done / plan.total : 0}
            className="mt-2 max-w-[260px]"
          />
        </div>
      )}

      {item.kind === "note" && <NoteBody item={item} onChanged={onChanged} />}

      <div
        className={`flex flex-wrap items-center gap-2 ${item.kind === "note" ? "mt-1 -ml-2.5" : "mt-3.5"}`}
      >
        {item.kind === "resource" && item.url && (
          <SourceLink href={item.url} className={BTN_SM.secondary}>
            Open link
            <IconArrowUpRight size={15} strokeWidth={2.25} />
          </SourceLink>
        )}
        {lesson && (
          <button type="button" className={BTN_SM.primary} onClick={() => onPlay(item)}>
            <IconPlay size={15} strokeWidth={2.25} />
            {lesson.progress.scene > 0 && !lesson.progress.completed ? "Continue" : "Open lesson"}
          </button>
        )}
        {plan && (
          <Link href="/librarian" className={`${TEXT_LINK} mr-1 text-[14px]`}>
            Work on it with the Librarian
          </Link>
        )}
        <RemoveButton label={`Remove ${item.title}`} onRemove={onRemove} />
        {plan && <PlanDays item={item} />}
      </div>
    </article>
  );
}

/** The skeleton of a card, while a list loads. */
export function CardSkeleton() {
  return (
    <div
      aria-hidden
      className="h-[132px] animate-pulse rounded-[20px] border-[2.5px] border-walnut/15 bg-surface motion-reduce:animate-none"
    />
  );
}
