"use client";

import { useId, useState } from "react";
import type { SubjectProgress, TimelineEntry, TimelineKind } from "@/lib/learning/types";
import { type ApiError, asApiError, getJson, useApi } from "./api";
import { dayHeading, formatTime, groupByDay } from "./format";
import { CARD, DARK_BUTTON, EntryRow, FOCUS, Gate, SMALL_BUTTON, StateCard } from "./ui";

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
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div role="group" aria-label="Show" className="flex flex-wrap gap-2">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              aria-pressed={kind === k.id}
              onClick={() => setKind(k.id)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-bold ring-1 transition ${FOCUS} ${kind === k.id ? "bg-ink text-cream ring-ink" : "bg-cream text-ink-soft ring-ink/10 hover:text-ink hover:ring-ink/30"}`}
            >
              {k.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <label htmlFor={selectId} className="text-sm font-bold">
            Subject
          </label>
          <select
            id={selectId}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className={`max-w-[14rem] rounded-xl bg-cream px-3 py-2 text-sm ring-1 ring-ink/15 ${FOCUS}`}
          >
            <option value="">All subjects</option>
            {subjects?.map((s) => (
              <option key={s.subjectId} value={s.subjectId}>
                {s.name}
              </option>
            ))}
          </select>
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
            <div className="space-y-4">
              {groupByDay(entries).map((g) => (
                <section key={g.key} className={CARD} aria-label={dayHeading(g.date, now)}>
                  <h3 className="font-display text-base font-semibold">
                    {dayHeading(g.date, now)}
                  </h3>
                  <ul className="mt-1 divide-y divide-ink/10">
                    {g.entries.map((e) => (
                      <EntryRow key={e.id} entry={e} when={formatTime(e.at)} />
                    ))}
                  </ul>
                </section>
              ))}
              <div className="flex flex-col items-center gap-2 pt-1">
                {next ? (
                  <button
                    type="button"
                    onClick={loadMore}
                    aria-disabled={extra?.loading || undefined}
                    className={DARK_BUTTON}
                  >
                    {extra?.loading ? "Loading…" : "Load more"}
                  </button>
                ) : (
                  <p className="text-xs font-bold text-ink-soft">That&apos;s everything.</p>
                )}
                {extra?.error && (
                  <p role="alert" className="text-sm font-bold text-ink">
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
