"use client";

import { useId, useState } from "react";
import { IconChevronDown, IconWarning } from "@/components/ui/icons";
import { BTN, FOCUS, LABEL, PANEL } from "@/components/ui/styles";
import type { SubjectProgress, TimelineEntry, TimelineKind } from "@/lib/learning/types";
import { type ApiError, asApiError, getJson, useApi } from "./api";
import { dayHeading, formatTime, groupByDay } from "./format";
import { DotRow, EntryRow, Gate, SMALL_BUTTON, Segmented, StateCard } from "./ui";

interface TimelinePage {
  entries: TimelineEntry[];
  next: string | null;
}

/** Older pages, continuing from one particular first page of one particular filter. */
interface MorePages {
  base: string;
  root: TimelinePage;
  pages: TimelinePage[];
  loading: boolean;
  error?: ApiError;
}

const KINDS: readonly { id: TimelineKind; label: string; noun: string }[] = [
  { id: "all", label: "All", noun: "activity" },
  { id: "lessons", label: "Lessons", noun: "lessons" },
  { id: "quizzes", label: "Quizzes", noun: "quizzes" },
  { id: "sessions", label: "Study sessions", noun: "study sessions" },
];

/** Everything you've done, newest first, by day: filter by kind and subject, load older pages. */
export function History({ subjects }: { subjects: SubjectProgress[] | undefined }) {
  const selectId = useId();
  const [kind, setKind] = useState<TimelineKind>("all");
  const [subject, setSubject] = useState("");
  const [now] = useState(() => new Date());
  const [more, setMore] = useState<MorePages | null>(null);

  const params = new URLSearchParams({ kind });
  if (subject) params.set("subject", subject);
  const base = `/api/learning/timeline?${params}`;
  const first = useApi<TimelinePage>(base);

  // Older pages only count while they continue the first page on screen (a new filter, or a
  // reload that brought newer entries, starts over).
  const extra = more && more.base === base && more.root === first.data ? more : null;
  const pages = first.data ? [first.data, ...(extra?.pages ?? [])] : [];
  const seen = new Set<string>();
  const entries = pages
    .flatMap((p) => p.entries)
    .filter((e) => !seen.has(e.id) && !!seen.add(e.id));
  const next = pages.length ? pages[pages.length - 1]!.next : null;

  const loadMore = () => {
    const root = first.data;
    if (!next || !root || extra?.loading) return;
    setMore({ base, root, pages: extra?.pages ?? [], loading: true });
    const same = (m: MorePages | null): m is MorePages => m?.base === base && m.root === root;
    getJson<TimelinePage>(`${base}&before=${encodeURIComponent(next)}`).then(
      (page) => setMore((m) => (same(m) ? { ...m, pages: [...m.pages, page], loading: false } : m)),
      (err: unknown) =>
        setMore((m) => (same(m) ? { ...m, loading: false, error: asApiError(err) } : m)),
    );
  };

  const filtered = kind !== "all" || subject !== "";
  const subjectName = subjects?.find((s) => s.subjectId === subject)?.name;
  const noun = KINDS.find((k) => k.id === kind)!.noun;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <Segmented label="Show" options={KINDS} value={kind} onChange={setKind} />
        <div className="flex items-center gap-2.5 sm:ml-auto">
          <label htmlFor={selectId} className={LABEL}>
            Subject
          </label>
          <span className="relative flex">
            <select
              id={selectId}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className={`h-11 max-w-[14rem] cursor-pointer appearance-none truncate rounded-[14px] border-[2.5px] border-walnut bg-surface pr-10 pl-3.5 font-display text-[14.5px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16] transition-colors duration-150 hover:bg-canvas motion-reduce:transition-none ${FOCUS}`}
            >
              <option value="">All subjects</option>
              {subjects?.map((s) => (
                <option key={s.subjectId} value={s.subjectId}>
                  {s.name}
                </option>
              ))}
            </select>
            <IconChevronDown
              size={17}
              strokeWidth={2.75}
              className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-walnut"
            />
          </span>
        </div>
      </div>

      <Gate resource={first} label="Loading your history">
        {() =>
          entries.length === 0 ? (
            filtered ? (
              <StateCard
                title="Nothing matches"
                action={
                  <button
                    type="button"
                    onClick={() => {
                      setKind("all");
                      setSubject("");
                    }}
                    className={SMALL_BUTTON}
                  >
                    Show everything
                  </button>
                }
              >
                No {noun}
                {subjectName ? ` in ${subjectName}` : ""} on your record yet.
              </StateCard>
            ) : (
              <StateCard title="Nothing here yet">
                Finish a pomodoro or a lesson to start your record.
              </StateCard>
            )
          ) : (
            <div className="space-y-5">
              <div className={`${PANEL} divide-y-2 divide-dashed divide-walnut/20`}>
                {groupByDay(entries).map((g) => (
                  <section
                    key={g.key}
                    className="px-5 pt-5 pb-1 sm:px-6"
                    aria-label={dayHeading(g.date, now)}
                  >
                    {/* Each day is a little cream sticker label. */}
                    <h3 className="inline-flex items-center rounded-full border-2 border-walnut bg-canvas px-3 py-0.5 font-display text-[13.5px] leading-5 font-semibold text-walnut shadow-[0_2px_0_#1f1a16]">
                      {dayHeading(g.date, now)}
                    </h3>
                    <ul className="mt-1 divide-y-2 divide-walnut/10">
                      {g.entries.map((e) => (
                        <EntryRow key={e.id} entry={e} when={formatTime(e.at)} />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              <div className="flex flex-col items-center gap-2">
                {next ? (
                  <button
                    type="button"
                    onClick={loadMore}
                    aria-disabled={extra?.loading || undefined}
                    className={`${BTN.secondary} aria-disabled:cursor-wait aria-disabled:opacity-60`}
                  >
                    {extra?.loading ? "Loading…" : "Load more"}
                  </button>
                ) : (
                  <p className="flex items-center gap-3 font-display text-[13.5px] font-semibold text-ink-soft">
                    <DotRow />
                    That&apos;s everything.
                  </p>
                )}
                {extra?.error && (
                  <p
                    role="alert"
                    className="flex items-start gap-2 text-sm leading-5 font-semibold text-walnut"
                  >
                    <IconWarning size={18} strokeWidth={2.25} className="text-danger" />
                    Couldn&apos;t load more: {extra.error.message}
                  </p>
                )}
              </div>
            </div>
          )
        }
      </Gate>
    </div>
  );
}
