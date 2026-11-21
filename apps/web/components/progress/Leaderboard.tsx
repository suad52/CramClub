"use client";

import { useId, useState } from "react";
import { LIBRARY_TIME_ZONE } from "@/lib/learning/rules";
import type { Dashboard, Leaderboard } from "@/lib/learning/types";
import { type Resource, asApiError, postJson } from "./api";
import { formatMinutes, formatNumber, formatRange, plural } from "./format";
import { CARD, FOCUS, Gate, Segmented, StateCard, Tag } from "./ui";

type Period = Leaderboard["period"];

const PERIODS = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
] as const;

export function LeaderboardPanel({
  board,
  period,
  onPeriod,
  learner,
  onSaved,
}: {
  board: Resource<Leaderboard>;
  period: Period;
  onPeriod: (period: Period) => void;
  /** From the dashboard, when it has loaded: your leaderboard name and choice. */
  learner: Dashboard["learner"] | undefined;
  /** The opt-in changed: refetch what depends on it. */
  onSaved: () => void;
}) {
  const lb = board.data;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Leaderboard period"
          options={PERIODS}
          value={period}
          onChange={onPeriod}
        />
        {lb && (
          <p className="text-sm text-ink-soft">
            <span className="font-bold text-ink">
              {formatRange(lb.from, lb.to, LIBRARY_TIME_ZONE)}
            </span>{" "}
            · {plural(lb.participants, "learner")}
          </p>
        )}
      </div>
      <Gate resource={board} label="Loading the leaderboard">
        {(data) => (
          <>
            <Board lb={data} />
            <OptIn
              key={String(data.me?.optedIn ?? learner?.leaderboardOptIn)}
              optedIn={data.me?.optedIn ?? learner?.leaderboardOptIn ?? true}
              name={data.rows.find((r) => r.isMe)?.displayName ?? learner?.displayName}
              onSaved={onSaved}
            />
          </>
        )}
      </Gate>
    </div>
  );
}

function Board({ lb }: { lb: Leaderboard }) {
  const when = lb.period === "week" ? "this week" : "this month";
  const range = formatRange(lb.from, lb.to, LIBRARY_TIME_ZONE);
  const meShown = lb.rows.some((r) => r.isMe);
  return (
    <div className="space-y-3">
      {lb.rows.length === 0 ? (
        <StateCard title="No one's on the board yet">
          Finish a pomodoro or a lesson {when} to be the first.
        </StateCard>
      ) : (
        <div className={`${CARD} overflow-hidden p-0`}>
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">
              Leaderboard for {range}: ranked by XP, then focus time, then active days
            </caption>
            <colgroup>
              <col className="w-12 sm:w-16" />
              <col />
              <col className="w-16 sm:w-24" />
              <col className="w-[4.5rem] sm:w-24" />
              <col className="w-14 sm:w-24" />
            </colgroup>
            <thead className="bg-parchment/60 text-xs text-ink-soft">
              <tr>
                <th scope="col" className="py-2.5 pl-4 text-left font-extrabold">
                  Rank
                </th>
                <th scope="col" className="px-2 py-2.5 text-left font-extrabold">
                  Name
                </th>
                <th scope="col" className="px-2 py-2.5 text-right font-extrabold">
                  XP
                </th>
                <th scope="col" className="px-2 py-2.5 text-right font-extrabold">
                  Focus
                </th>
                <th scope="col" className="py-2.5 pr-4 pl-2 text-right font-extrabold">
                  <span className="sm:hidden">Days</span>
                  <span className="hidden sm:inline">Active days</span>
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {lb.rows.map((r, i) => (
                <tr
                  key={i}
                  aria-current={r.isMe ? "true" : undefined}
                  className={`border-t border-ink/5 ${r.isMe ? "bg-lamp/40" : ""}`}
                >
                  <td className="py-2.5 pl-4 font-extrabold">
                    <span
                      className={`inline-grid h-7 min-w-7 place-items-center rounded-full px-1 ${r.rank <= 3 ? "bg-wood/15 text-wood-dark" : ""}`}
                    >
                      {r.rank}
                    </span>
                  </td>
                  <th scope="row" className="px-2 py-2.5 text-left font-bold">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{r.displayName}</span>
                      {r.isMe && <Tag tone="you">You</Tag>}
                      {r.isDemo && (
                        <Tag
                          tone="demo"
                          title="A sample learner, so the board isn't empty while the library is new"
                        >
                          Demo
                        </Tag>
                      )}
                    </span>
                  </th>
                  <td className="px-2 py-2.5 text-right font-extrabold">{formatNumber(r.xp)}</td>
                  <td className="px-2 py-2.5 text-right">{formatMinutes(r.focusMinutes)}</td>
                  <td className="py-2.5 pr-4 pl-2 text-right">{r.activeDays}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!meShown && <YourStanding lb={lb} when={when} />}
      <p className="text-xs text-ink-soft">
        Ranked by XP. Ties go to more focus time, then to more active days.
      </p>
    </div>
  );
}

/** Where you stand when you're not among the rows shown. */
function YourStanding({ lb, when }: { lb: Leaderboard; when: string }) {
  const me = lb.me;
  const text = !me
    ? `You'll appear here once you've earned some XP ${when}.`
    : !me.optedIn
      ? `You're hidden from leaderboards. You have ${formatNumber(me.xp)} XP ${when}.`
      : me.rank !== null
        ? `You're #${me.rank} of ${formatNumber(lb.participants)}, with ${formatNumber(me.xp)} XP ${when}.`
        : `You're not on the board yet ${when}. Earn some XP to join it.`;
  return (
    <p className="rounded-2xl bg-lamp/40 px-4 py-3 text-sm font-bold text-ink">
      <span className="sr-only">Your standing: </span>
      {text}
    </p>
  );
}

/** "Show me on leaderboards": saved on the server, then the boards are fetched again. */
function OptIn({
  optedIn,
  name,
  onSaved,
}: {
  optedIn: boolean;
  name: string | undefined;
  onSaved: () => void;
}) {
  const labelId = useId();
  const descId = useId();
  // The choice being saved (or just saved, until the refetched board agrees and remounts this).
  const [want, setWant] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = want ?? optedIn;

  const toggle = () => {
    if (saving) return;
    const next = !on;
    setWant(next);
    setSaving(true);
    setError(null);
    postJson<{ ok: true }>("/api/learning/profile", { leaderboardOptIn: next }).then(
      () => {
        setSaving(false);
        onSaved();
      },
      (err: unknown) => {
        setSaving(false);
        setWant(null);
        setError(asApiError(err).message);
      },
    );
  };

  return (
    <section className={CARD} aria-label="Leaderboard privacy">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={labelId} className="font-bold">
            Show me on leaderboards
          </p>
          <p id={descId} className="mt-0.5 text-xs text-ink-soft">
            {name ? (
              <>
                You appear as <strong className="font-extrabold text-ink">{name}</strong>.{" "}
              </>
            ) : null}
            Only your name and totals (XP, focus time, active days) are shown, never your lesson
            titles. Turning this off also leaves you out of the community charts.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          aria-describedby={descId}
          aria-busy={saving || undefined}
          onClick={toggle}
          className={`relative mt-0.5 h-7 w-12 shrink-0 rounded-full transition ${FOCUS} ${on ? "bg-sage-dark" : "bg-ink/25"} ${saving ? "cursor-wait opacity-70" : ""}`}
        >
          <span
            aria-hidden
            className={`absolute top-1 left-1 h-5 w-5 rounded-full bg-cream shadow transition-transform ${on ? "translate-x-5" : ""}`}
          />
        </button>
      </div>
      <p role="status" className="mt-1 min-h-4 text-xs font-bold text-ink-soft">
        {saving ? "Saving…" : ""}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs font-bold text-ink">
          Couldn&apos;t save that: {error}
        </p>
      )}
    </section>
  );
}
