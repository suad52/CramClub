"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import { DAILY_CAPS, XP } from "@/lib/learning/rules";
import type { Community, Dashboard, Leaderboard, SubjectProgress } from "@/lib/learning/types";
import { useApi } from "./api";
import { BarChart, SERIES, Sparkline } from "./charts";
import { CommunityView } from "./Community";
import {
  dayHeading,
  delta,
  formatDate,
  formatDay,
  formatMinutes,
  formatMs,
  formatNumber,
  formatPercent,
  formatTime,
  plural,
  ratio,
} from "./format";
import { History } from "./History";
import { LeaderboardPanel } from "./Leaderboard";
import {
  CARD,
  type DashboardContext,
  DARK_BUTTON,
  EntryRow,
  FOCUS,
  Gate,
  SMALL_BUTTON,
  SectionTitle,
  Segmented,
  StateCard,
} from "./ui";

/*
 * "My Progress": the student's own record (focus time, lessons, quizzes, XP, streaks), their
 * subjects and history, the leaderboard and community-wide trends. Shown on its own page and as
 * a panel over the 3D library. Each tab loads when it's first opened and stays loaded.
 */

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "subjects", label: "Subjects" },
  { id: "history", label: "History" },
  { id: "leaderboard", label: "Leaderboard" },
  { id: "community", label: "Community" },
] as const;

export type ProgressTab = (typeof TABS)[number]["id"];

/** Tabs that need the dashboard (the leaderboard only for your name and opt-in). */
const USES_DASHBOARD: readonly ProgressTab[] = ["overview", "subjects", "history", "leaderboard"];

export function ProgressDashboard({
  context,
  initialTab = "overview",
}: {
  context: DashboardContext;
  initialTab?: ProgressTab;
}) {
  const uid = useId();
  const [tab, setTab] = useState<ProgressTab>(initialTab);
  const [visited, setVisited] = useState<ReadonlySet<ProgressTab>>(() => new Set([initialTab]));
  const [period, setPeriod] = useState<"week" | "month">("week");
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const scroller = useRef<HTMLDivElement>(null);

  const dashboard = useApi<Dashboard>(
    USES_DASHBOARD.some((t) => visited.has(t)) ? "/api/learning/dashboard" : null,
  );
  const leaderboard = useApi<Leaderboard>(
    visited.has("leaderboard") ? `/api/learning/leaderboard?period=${period}` : null,
  );
  const community = useApi<Community>(visited.has("community") ? "/api/learning/community" : null);

  const select = (id: ProgressTab, focus = false) => {
    setTab(id);
    if (!visited.has(id)) setVisited(new Set(visited).add(id));
    scroller.current?.scrollTo({ top: 0 });
    if (focus) tabButtons.current[TABS.findIndex((t) => t.id === id)]?.focus();
  };

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const n = TABS.length;
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % n
        : e.key === "ArrowLeft"
          ? (i - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : -1;
    if (to < 0) return;
    e.preventDefault();
    select(TABS[to]!.id, true);
  };

  const queryMs =
    tab === "leaderboard"
      ? leaderboard.data?.queryMs
      : tab === "community"
        ? community.data?.queryMs
        : tab === "history"
          ? undefined
          : dashboard.data?.queryMs;

  const panel = (id: ProgressTab) => {
    switch (id) {
      case "overview":
        return (
          <Gate resource={dashboard} label="Loading your overview">
            {(d) => <Overview d={d} context={context} go={(t) => select(t, true)} />}
          </Gate>
        );
      case "subjects":
        return (
          <Gate resource={dashboard} label="Loading your subjects">
            {(d) => <Subjects subjects={d.subjects} />}
          </Gate>
        );
      case "history":
        return <History subjects={dashboard.data?.subjects} />;
      case "leaderboard":
        return (
          <LeaderboardPanel
            board={leaderboard}
            period={period}
            onPeriod={setPeriod}
            learner={dashboard.data?.learner}
            onSaved={() => {
              leaderboard.reload();
              dashboard.reload();
            }}
          />
        );
      case "community":
        return (
          <Gate resource={community} label="Loading community trends">
            {(c) => <CommunityView c={c} />}
          </Gate>
        );
    }
  };

  const inLibrary = context === "library";
  return (
    <div className={inLibrary ? "flex min-h-0 flex-1 flex-col" : ""}>
      <div
        className={
          inLibrary
            ? "shrink-0 border-b border-ink/10 bg-cream px-3 sm:px-6"
            : "border-b border-ink/10"
        }
      >
        <div
          role="tablist"
          aria-label="My Progress sections"
          className="-mx-1 flex gap-1 overflow-x-auto px-1 py-2"
        >
          {TABS.map((t, i) => {
            const selected = tab === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabButtons.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${uid}-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={visited.has(t.id) ? `${uid}-panel-${t.id}` : undefined}
                tabIndex={selected ? 0 : -1}
                onClick={() => select(t.id)}
                onKeyDown={(e) => onTabKey(e, i)}
                className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition ${FOCUS} ${selected ? "bg-ink text-cream shadow" : "text-ink-soft hover:bg-ink/5 hover:text-ink"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={scroller}
        className={
          inLibrary ? "min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6 sm:py-6" : "py-6 sm:py-8"
        }
      >
        {TABS.map(
          (t) =>
            visited.has(t.id) && (
              <div
                key={t.id}
                role="tabpanel"
                id={`${uid}-panel-${t.id}`}
                aria-labelledby={`${uid}-tab-${t.id}`}
                hidden={tab !== t.id}
                tabIndex={0}
                className={`rounded-3xl ${FOCUS}`}
              >
                <h2 className="sr-only">{t.label}</h2>
                {panel(t.id)}
              </div>
            ),
        )}
      </div>

      <p
        className={`text-xs text-ink-soft ${inLibrary ? "shrink-0 border-t border-ink/10 bg-cream px-4 py-2 sm:px-6" : "mt-4 text-center"}`}
      >
        Powered by Tiger Data
        {queryMs !== undefined && (
          <span className="tabular-nums"> — query {formatMs(queryMs)}</span>
        )}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

function hasRecord(d: Dashboard) {
  const a = d.allTime;
  return a.xp + a.sessions + a.lessons + a.quizzes + a.focusMinutes > 0 || d.recent.length > 0;
}

function Overview({
  d,
  context,
  go,
}: {
  d: Dashboard;
  context: DashboardContext;
  go: (tab: ProgressTab) => void;
}) {
  const [now] = useState(() => new Date());
  if (!hasRecord(d)) {
    return (
      <div className="space-y-6">
        {d.continueWith && <ContinueCard next={d.continueWith} context={context} />}
        <StateCard
          title="Your record starts here"
          action={
            context === "page" ? (
              <>
                <Link href="/library" className={DARK_BUTTON}>
                  Enter the library
                </Link>
                <Link href="/learning-studio" className={SMALL_BUTTON}>
                  Make a lesson
                </Link>
              </>
            ) : undefined
          }
        >
          <p>Finish a pomodoro or a lesson to start your record.</p>
          {context === "library" && (
            <p className="mt-1">
              Sit at a table and press <kbd className="kbd">P</kbd> for a pomodoro, or press{" "}
              <kbd className="kbd">L</kbd> at a whiteboard to play a lesson.
            </p>
          )}
        </StateCard>
        <HowXpWorks />
      </div>
    );
  }
  return (
    <div className="space-y-6">
      {d.continueWith && <ContinueCard next={d.continueWith} context={context} />}
      <StatTiles d={d} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className={CARD} aria-label="Last 30 days">
          <ActivityChart days={d.days} />
        </section>
        <div className="space-y-6">
          <WeekVsWeek d={d} />
          <WeeklyRank d={d} go={go} />
        </div>
      </div>
      <section className={CARD} aria-label="Recent activity">
        <SectionTitle
          title="Recent activity"
          aside={
            <button type="button" onClick={() => go("history")} className={SMALL_BUTTON}>
              All history
            </button>
          }
        />
        {d.recent.length ? (
          <ul className="divide-y divide-ink/10">
            {d.recent.slice(0, 5).map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                when={
                  <>
                    <span className="block">{dayHeading(new Date(e.at), now)}</span>
                    <span className="block font-semibold">{formatTime(e.at)}</span>
                  </>
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-soft">Nothing recent yet.</p>
        )}
      </section>
      <HowXpWorks />
    </div>
  );
}

function ContinueCard({
  next,
  context,
}: {
  next: NonNullable<Dashboard["continueWith"]>;
  context: DashboardContext;
}) {
  return (
    <section
      aria-label="Continue learning"
      className="flex flex-wrap items-center gap-4 rounded-3xl bg-ink p-5 text-cream shadow"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[0.7rem] font-extrabold tracking-wide text-lamp uppercase">
          Pick up where you left off
        </p>
        <p className="mt-0.5 font-display text-xl font-semibold">Continue with {next.title}</p>
        <p className="mt-0.5 text-sm text-cream/75">
          {next.subject} ·{" "}
          {context === "library"
            ? "Walk up to a whiteboard and press L to play it."
            : "It's in your lessons in the Learning Studio."}
        </p>
      </div>
      {context === "page" && (
        <Link
          href="/learning-studio"
          className={`rounded-full bg-cream px-4 py-2 text-sm font-bold text-ink transition hover:bg-white ${FOCUS}`}
        >
          Open the Learning Studio
        </Link>
      )}
    </section>
  );
}

function StatTiles({ d }: { d: Dashboard }) {
  const accuracy = ratio(d.allTime.quizzesCorrect, d.allTime.quizzes);
  const tiles = [
    {
      label: "Focus this week",
      value: formatMinutes(d.thisWeek.focusMinutes),
      sub: `${formatMinutes(d.allTime.focusMinutes)} all-time`,
    },
    {
      label: "XP this week",
      value: formatNumber(d.thisWeek.xp),
      sub: `${formatNumber(d.allTime.xp)} all-time`,
    },
    {
      label: "Lessons completed",
      value: formatNumber(d.allTime.lessons),
      sub: `${formatNumber(d.thisWeek.lessons)} this week`,
    },
    {
      label: "Quizzes completed",
      value: formatNumber(d.allTime.quizzes),
      sub: accuracy === null ? "None answered yet" : `${formatPercent(accuracy)} right first try`,
    },
    {
      label: "Current streak",
      value: plural(d.streak.current, "day"),
      sub: `Longest ${plural(d.streak.longest, "day")}`,
    },
    {
      label: "Explored",
      value: plural(d.explored.subjects, "subject"),
      sub: `${plural(d.explored.lessons, "lesson")} started`,
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="flex flex-col rounded-3xl bg-cream p-4 ring-1 ring-ink/10">
          <dt className="text-xs font-extrabold text-ink-soft">{t.label}</dt>
          <dd className="mt-1 font-display text-2xl leading-tight font-semibold tabular-nums sm:text-3xl">
            {t.value}
          </dd>
          <dd className="mt-auto pt-1 text-xs text-ink-soft">{t.sub}</dd>
        </div>
      ))}
    </dl>
  );
}

function ActivityChart({ days }: { days: Dashboard["days"] }) {
  const [measure, setMeasure] = useState<"xp" | "focus">("xp");
  const n = days.length;
  const value = (day: Dashboard["days"][number]) => (measure === "xp" ? day.xp : day.focusMinutes);
  const bars = days.map((day, i) => ({
    key: day.day,
    label: formatDay(day.day, { weekday: "short", month: "short", day: "numeric" }),
    tick: (n - 1 - i) % 7 === 0 ? formatDay(day.day) : "",
    value: value(day),
    detail: [
      `${formatNumber(day.xp)} XP`,
      `${formatMinutes(day.focusMinutes)} focus`,
      plural(day.lessons, "lesson"),
      plural(day.quizzes, "quiz", "quizzes"),
    ].join(" · "),
  }));
  const total = days.reduce((sum, day) => sum + value(day), 0);
  const best = days.reduce<Dashboard["days"][number] | null>(
    (top, day) => (value(day) > (top ? value(top) : 0) ? day : top),
    null,
  );
  const show = measure === "xp" ? (v: number) => `${formatNumber(v)} XP` : formatMinutes;
  const summary =
    `${measure === "xp" ? "XP" : "Focus time"} per day over the last ${n} days: ${show(total)} in all` +
    (best
      ? `, most on ${formatDay(best.day, { month: "long", day: "numeric" })} (${show(value(best))}).`
      : ".");
  return (
    <>
      <SectionTitle
        title="Last 30 days"
        sub={measure === "xp" ? "XP earned each day" : "Focus time each day"}
        aside={
          <Segmented
            label="Chart shows"
            options={[
              { id: "xp", label: "XP" },
              { id: "focus", label: "Focus minutes" },
            ]}
            value={measure}
            onChange={setMeasure}
          />
        }
      />
      <BarChart
        bars={bars}
        color={measure === "xp" ? SERIES.xp : SERIES.focus}
        summary={summary}
        unit={measure === "xp" ? "XP" : "Focus"}
        scale={measure === "xp" ? "count" : "minutes"}
        emptyNote="Nothing in the last 30 days yet"
      />
    </>
  );
}

function WeekVsWeek({ d }: { d: Dashboard }) {
  const id = useId();
  const rows = [
    { label: "XP", now: d.thisWeek.xp, before: d.lastWeek.xp, show: formatNumber },
    {
      label: "Focus",
      now: d.thisWeek.focusMinutes,
      before: d.lastWeek.focusMinutes,
      show: formatMinutes,
    },
    { label: "Lessons", now: d.thisWeek.lessons, before: d.lastWeek.lessons, show: formatNumber },
    { label: "Quizzes", now: d.thisWeek.quizzes, before: d.lastWeek.quizzes, show: formatNumber },
    {
      label: "Active days",
      now: d.thisWeek.activeDays,
      before: d.lastWeek.activeDays,
      show: formatNumber,
    },
  ];
  return (
    <section className={CARD} aria-labelledby={id}>
      <SectionTitle
        id={id}
        title="Personal best"
        sub="This week so far vs last week · weeks start on Monday"
      />
      <table className="w-full text-sm">
        <thead className="text-xs text-ink-soft">
          <tr>
            <th scope="col" className="pb-1 text-left font-extrabold">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col" className="pb-1 text-right font-extrabold">
              This week
            </th>
            <th scope="col" className="pb-1 text-right font-extrabold">
              Last week
            </th>
            <th scope="col" className="pb-1 text-right font-extrabold">
              Change
            </th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r) => {
            const change = delta(r.now, r.before);
            const amount = r.show(Math.abs(change.diff));
            return (
              <tr key={r.label} className="border-t border-ink/5">
                <th scope="row" className="py-1.5 text-left font-bold">
                  {r.label}
                </th>
                <td className="py-1.5 text-right font-extrabold">{r.show(r.now)}</td>
                <td className="py-1.5 text-right text-ink-soft">{r.show(r.before)}</td>
                <td className="py-1.5 text-right">
                  {change.direction === "same" ? (
                    <span className="text-ink-soft">Same</span>
                  ) : (
                    <span className="inline-flex items-center gap-1 font-bold">
                      <span
                        aria-hidden
                        className={change.direction === "up" ? "text-sage-dark" : "text-ember"}
                      >
                        {change.direction === "up" ? "▲" : "▼"}
                      </span>
                      <span className="sr-only">{change.direction === "up" ? "up" : "down"}</span>
                      {amount}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function WeeklyRank({ d, go }: { d: Dashboard; go: (tab: ProgressTab) => void }) {
  const id = useId();
  const rank = d.weeklyRank;
  return (
    <section className={CARD} aria-labelledby={id}>
      <SectionTitle id={id} title="Weekly rank" />
      {rank ? (
        <p className="text-sm text-ink-soft">
          <span className="font-display text-4xl font-semibold text-ink tabular-nums">
            #{rank.rank}
          </span>{" "}
          of {plural(rank.of, "learner")} this week
        </p>
      ) : d.learner.leaderboardOptIn ? (
        <p className="text-sm text-ink-soft">
          <span className="block font-bold text-ink">Not ranked yet</span>
          Earn some XP this week to join the board.
        </p>
      ) : (
        <p className="text-sm text-ink-soft">
          <span className="block font-bold text-ink">Hidden from leaderboards</span>
          You&apos;ve chosen not to appear. You can change that on the Leaderboard tab.
        </p>
      )}
      <button type="button" onClick={() => go("leaderboard")} className={`mt-4 ${SMALL_BUTTON}`}>
        See the leaderboard
      </button>
    </section>
  );
}

/** The XP rules, straight from the server's own constants. */
function HowXpWorks() {
  const id = useId();
  const rows = [
    {
      what: "Finish a pomodoro",
      xp: `+${XP.sessionCompleted}`,
      cap: `up to ${DAILY_CAPS.sessions} a day`,
    },
    {
      what: "Finish a lesson (every scene, once per lesson)",
      xp: `+${XP.lessonCompleted}`,
      cap: `up to ${DAILY_CAPS.lessons} a day`,
    },
    {
      what: "Answer a knowledge check (once per question)",
      xp: `+${XP.quizCompleted}`,
      cap: `up to ${DAILY_CAPS.quizzes} a day`,
    },
    {
      what: "…and get it right on the first try",
      xp: `+${XP.quizPassed} more`,
      cap: "",
    },
  ];
  return (
    <section className={CARD} aria-labelledby={id}>
      <SectionTitle
        id={id}
        title="How XP works"
        sub="The server checks each activity before it counts."
      />
      <ul className="divide-y divide-ink/10 text-sm">
        {rows.map((r) => (
          <li key={r.what} className="flex flex-wrap items-baseline gap-x-3 py-2">
            <span className="min-w-0 flex-1 font-bold">{r.what}</span>
            {r.cap && <span className="text-xs text-ink-soft">{r.cap}</span>}
            <span className="w-24 text-right font-extrabold tabular-nums">{r.xp} XP</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-ink-soft">
        Past a daily limit, an activity still goes on your record, for 0 XP. Focus time counts a
        pomodoro&apos;s planned length, never time paused or spent away.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

function Subjects({ subjects }: { subjects: SubjectProgress[] }) {
  if (!subjects.length) {
    return (
      <StateCard title="No subjects yet">
        Start a lesson and it&apos;s filed under its subject here, with how far you&apos;ve got.
      </StateCard>
    );
  }
  const sorted = [...subjects].sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {sorted.map((s) => (
        <SubjectCard key={s.subjectId} s={s} />
      ))}
    </ul>
  );
}

function SubjectCard({ s }: { s: SubjectProgress }) {
  const id = useId();
  const share = ratio(s.lessonsCompleted, s.lessonsStarted) ?? 0;
  const weeks = s.weeklyCompletions;
  return (
    <li className={`${CARD} flex flex-col`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={id} className="font-display text-lg leading-tight font-semibold break-words">
            {s.name}
          </h3>
          <p className="mt-0.5 text-xs text-ink-soft">
            Last studied {formatDate(s.lastActivityAt)}
          </p>
        </div>
        <div className="flex flex-col items-end">
          <Sparkline
            values={weeks}
            label={`Lessons completed per week, last ${weeks.length} weeks, oldest first: ${weeks.join(", ")}`}
          />
          <span className="text-[0.65rem] font-bold text-ink-soft" aria-hidden>
            lessons / week
          </span>
        </div>
      </div>
      <p className="mt-4 text-sm text-ink-soft">
        <span className="font-display text-2xl font-semibold text-ink tabular-nums">
          {formatNumber(s.lessonsCompleted)}
        </span>{" "}
        of {plural(s.lessonsStarted, "lesson")} completed
      </p>
      <div
        role="progressbar"
        aria-label="Lessons completed, of the lessons you've started"
        aria-valuemin={0}
        aria-valuemax={s.lessonsStarted}
        aria-valuenow={s.lessonsCompleted}
        className="mt-2 h-2 overflow-hidden rounded-full bg-ink/[0.07]"
      >
        <div className="h-2 rounded-full bg-wood" style={{ width: `${share * 100}%` }} />
      </div>
      <p className="mt-1 text-xs text-ink-soft">of the lessons you&apos;ve started</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-ink/10 pt-3 text-sm">
        <div>
          <dt className="text-xs text-ink-soft">Quizzes answered</dt>
          <dd className="font-extrabold tabular-nums">{formatNumber(s.quizzesAnswered)}</dd>
        </div>
        {s.masteryEstimate !== null && (
          <div>
            <dt className="text-xs text-ink-soft">
              Mastery <span className="block">estimate (first-try quiz accuracy)</span>
            </dt>
            <dd className="font-extrabold tabular-nums">{formatPercent(s.masteryEstimate)}</dd>
          </div>
        )}
      </dl>
    </li>
  );
}
