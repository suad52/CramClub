"use client";

import { useId, useState } from "react";
import { IconInfo, IconWarning } from "@/components/ui/icons";
import { PANEL, RIBBON } from "@/components/ui/styles";
import { LIBRARY_TIME_ZONE } from "@/lib/learning/rules";
import type { Dashboard, Leaderboard } from "@/lib/learning/types";
import { type Resource, asApiError, postJson } from "./api";
import { formatMinutes, formatNumber, formatRange, plural } from "./format";
import { CARD, FOCUS, Gate, ICON_DOT, NOTE, Segmented, StateCard, Tag } from "./ui";

type Period = Leaderboard["period"];

/** Medal stickers for the top three: sun, cream, tangerine (the number is always shown). */
const MEDAL: Record<number, string> = { 1: "bg-sun", 2: "bg-canvas", 3: "bg-tangerine" };

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
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <Segmented
          label="Leaderboard period"
          options={PERIODS}
          value={period}
          onChange={onPeriod}
        />
        {lb && (
          <p className="tabular text-sm font-medium text-ink-soft">
            <span className="font-display font-semibold text-walnut">
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
    <div className="space-y-4">
      {lb.rows.length === 0 ? (
        <StateCard title="No one's on the board yet">
          Finish a pomodoro or a lesson {when} to be the first.
        </StateCard>
      ) : (
        <div className={`${PANEL} overflow-hidden`}>
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">
              Leaderboard for {range}: ranked by XP, then focus time, then active days
            </caption>
            <colgroup>
              <col className="w-12 sm:w-16" />
              <col />
              <col className="w-16 sm:w-24" />
              <col className="w-[4.5rem] sm:w-24" />
              <col className="w-14 sm:w-28" />
            </colgroup>
            <thead className="border-b-[3px] border-walnut bg-sun font-display text-[13.5px] text-walnut">
              <tr>
                <th scope="col" className="py-3 pl-4 text-left font-semibold sm:pl-6">
                  Rank
                </th>
                <th scope="col" className="px-2 py-3 text-left font-semibold">
                  Name
                </th>
                <th scope="col" className="px-2 py-3 text-right font-semibold">
                  XP
                </th>
                <th scope="col" className="px-2 py-3 text-right font-semibold">
                  Focus
                </th>
                <th scope="col" className="py-3 pr-4 pl-2 text-right font-semibold sm:pr-6">
                  <span className="sm:hidden">Days</span>
                  <span className="hidden sm:inline">Active days</span>
                </th>
              </tr>
            </thead>
            <tbody className="tabular divide-y-2 divide-walnut/10 text-walnut">
              {lb.rows.map((r, i) => (
                <tr
                  key={i}
                  aria-current={r.isMe ? "true" : undefined}
                  className={r.isMe ? "bg-sun/25" : ""}
                >
                  <td
                    className={`py-2.5 pl-4 sm:pl-6 ${r.isMe ? "shadow-[inset_5px_0_0_var(--color-tangerine)]" : ""}`}
                  >
                    {MEDAL[r.rank] ? (
                      <span
                        className={`${ICON_DOT} h-8 w-8 font-display text-[15px] font-bold shadow-[0_2px_0_#1f1a16] ${MEDAL[r.rank]}`}
                      >
                        {r.rank}
                      </span>
                    ) : (
                      <span
                        className={`inline-block min-w-8 text-center font-display text-[15px] font-semibold ${r.isMe ? "text-walnut" : "text-ink-soft"}`}
                      >
                        {r.rank}
                      </span>
                    )}
                  </td>
                  <th scope="row" className="px-2 py-2.5 text-left font-display font-semibold">
                    {/* On a narrow screen the tag drops under the name instead of squeezing it. */}
                    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
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
                  <td className="px-2 py-2.5 text-right font-display font-bold">
                    {formatNumber(r.xp)}
                  </td>
                  <td className="px-2 py-2.5 text-right font-medium text-ink-soft">
                    {formatMinutes(r.focusMinutes)}
                  </td>
                  <td className="py-2.5 pr-4 pl-2 text-right font-medium text-ink-soft sm:pr-6">
                    {r.activeDays}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!meShown && <YourStanding lb={lb} when={when} />}
      <p className="text-[13px] leading-5 font-medium text-ink-soft">
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
    <p className={NOTE}>
      <span className={`${ICON_DOT} h-6 w-6 bg-sun`}>
        <IconInfo size={14} strokeWidth={2.5} />
      </span>
      <span>
        <span className="sr-only">Your standing: </span>
        {text}
      </span>
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
    <section className={`${CARD} mt-3 pt-7 sm:pt-8`} aria-label="Leaderboard privacy">
      <span aria-hidden className={`${RIBBON} absolute -top-4 left-5`}>
        Privacy
      </span>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id={labelId} className="font-display text-[17px] leading-6 font-semibold text-walnut">
            Show me on leaderboards
          </p>
          <p
            id={descId}
            className="mt-1 max-w-[60ch] text-[13.5px] leading-5 font-medium text-ink-soft"
          >
            {name ? (
              <>
                You appear as <strong className="font-bold text-walnut">{name}</strong>.{" "}
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
          className={`group -mt-1.5 -mr-1.5 grid h-11 w-16 shrink-0 place-items-center rounded-[14px] ${FOCUS} ${saving ? "cursor-wait opacity-70" : "cursor-pointer"}`}
        >
          {/* The track and its thumb: a chunky sticker switch that keeps its familiar shape. */}
          <span
            aria-hidden
            className={`relative h-7 w-12 rounded-full border-[2.5px] border-walnut shadow-[0_3px_0_#1f1a16] transition-colors duration-150 motion-reduce:transition-none ${on ? "bg-leaf group-hover:bg-[#8fc08a]" : "bg-walnut/15 group-hover:bg-walnut/25"}`}
          >
            <span
              className={`absolute top-[2px] left-[2px] h-[19px] w-[19px] rounded-full border-2 border-walnut bg-surface transition-transform duration-150 motion-reduce:transition-none ${on ? "translate-x-5" : ""}`}
            />
          </span>
        </button>
      </div>
      <p
        role="status"
        className="mt-1 min-h-5 font-display text-[13px] leading-5 font-semibold text-ink-soft"
      >
        {saving ? "Saving…" : ""}
      </p>
      {error && (
        <p
          role="alert"
          className="mt-1 flex items-start gap-2 text-[13px] leading-5 font-semibold text-walnut"
        >
          <IconWarning size={16} strokeWidth={2.25} className="mt-0.5 text-danger" />
          Couldn&apos;t save that: {error}
        </p>
      )}
    </section>
  );
}
