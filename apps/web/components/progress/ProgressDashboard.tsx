"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";
import {
  IconArrowRight,
  IconBook,
  IconChart,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconFlame,
  IconGraduationCap,
  IconTrophy,
  IconUsers,
} from "@/components/ui/icons";
import { BTN, BTN_SM, PANEL, RIBBON } from "@/components/ui/styles";
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
  streakNote,
  verifiedText,
} from "./format";
import { History } from "./History";
import { LeaderboardPanel } from "./Leaderboard";
import {
  CARD,
  type DashboardContext,
  DotRow,
  EntryRow,
  FOCUS,
  Gate,
  ICON_DOT,
  SMALL_BUTTON,
  SectionTitle,
  Segmented,
  StateCard,
} from "./ui";

/*
 * "My progress": the student's own record (focus time, lessons, quizzes, XP, streaks), their
 * subjects and history, the leaderboard and community-wide trends. Shown on its own page and as
 * a panel over the 3D library. Each tab loads when it's first opened and stays loaded.
 *
 * Two honesty details: focus time seen at the desk ("✓ 40m at desk", only for students who turn
 * on their own face tracking; nothing shows without it, and it never changes XP or rank), and
 * forgiving streaks (one missed day in any 7 is a rest day; the streak tile says when one was
 * used).
 */

const TABS = [
  { id: "overview", label: "Overview", icon: IconChart },
  { id: "subjects", label: "Subjects", icon: IconBook },
  { id: "history", label: "History", icon: IconClock },
  { id: "leaderboard", label: "Leaderboard", icon: IconTrophy },
  { id: "community", label: "Community", icon: IconUsers },
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
            ? "shrink-0 border-b-[3px] border-walnut bg-surface px-3.5 sm:px-6"
            : "border-b-2 border-dashed border-walnut/25"
        }
      >
        {/* Padded so the focus ring and the sticker shadow aren't clipped by the scroll box. */}
        <div
          role="tablist"
          aria-label="My progress sections"
          className={`flex gap-2 overflow-x-auto px-1.5 ${inLibrary ? "py-3" : "-mx-1.5 pt-2 pb-4"}`}
        >
          {TABS.map((t, i) => {
            const selected = tab === t.id;
            const Icon = t.icon;
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
                className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border-2 px-4 font-display text-[15px] font-semibold whitespace-nowrap transition-[background-color,color,border-color,box-shadow,transform] duration-150 ease-out motion-reduce:transition-none ${FOCUS} ${selected ? "-translate-y-px border-walnut bg-sun text-walnut shadow-[0_3px_0_#1f1a16]" : "border-transparent text-ink-soft hover:border-walnut hover:bg-canvas hover:text-walnut active:translate-y-px"}`}
              >
                <Icon size={17} strokeWidth={2.25} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        ref={scroller}
        className={
          inLibrary
            ? "min-h-0 flex-1 overflow-y-auto overscroll-contain bg-canvas px-5 py-6 sm:px-8 sm:py-8"
            : "py-8 sm:py-10"
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
                className={`rounded-[24px] ${FOCUS}`}
              >
                <h2 className="sr-only">{t.label}</h2>
                {panel(t.id)}
              </div>
            ),
        )}
      </div>

      <p
        className={`flex items-center gap-2 font-display text-[13px] leading-5 font-semibold text-ink-soft ${inLibrary ? "shrink-0 border-t-[3px] border-walnut bg-surface px-5 py-2.5 sm:px-8" : "border-t-2 border-dashed border-walnut/25 pt-4"}`}
      >
        <span aria-hidden className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-leaf" />
        Powered by Tiger Data
        {queryMs !== undefined && <span className="tabular"> · query {formatMs(queryMs)}</span>}
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
                {/* One sun action per view: "Continue learning" has it when it's shown. */}
                <Link href="/" className={d.continueWith ? BTN.secondary : BTN.primary}>
                  Enter the library
                </Link>
                <Link href="/learning-studio" className={BTN.secondary}>
                  Make a lesson
                </Link>
              </>
            ) : undefined
          }
        >
          <p>Finish a pomodoro or a lesson to start your record.</p>
          {context === "library" && (
            <p className="mt-2">
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
            <button
              type="button"
              onClick={() => go("history")}
              className={`${BTN_SM.quiet} -my-1 -mr-2.5`}
            >
              All history
              <IconArrowRight size={16} strokeWidth={2.5} />
            </button>
          }
        />
        {d.recent.length ? (
          <ul className="-my-3 divide-y-2 divide-walnut/10">
            {d.recent.slice(0, 5).map((e) => (
              <EntryRow
                key={e.id}
                entry={e}
                when={
                  <>
                    <span className="block font-semibold text-walnut">
                      {dayHeading(new Date(e.at), now)}
                    </span>
                    <span className="block">{formatTime(e.at)}</span>
                  </>
                }
              />
            ))}
          </ul>
        ) : (
          <p className="text-[15px] font-medium text-ink-soft">Nothing recent yet.</p>
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
      className={`${PANEL} relative mt-3 flex flex-wrap items-center gap-x-6 gap-y-5 bg-[#fbf3e2] p-5 pt-7 sm:p-6 sm:pt-8`}
    >
      {/* The member card's dashed inner line, from the title screen. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-2.5 rounded-[16px] border-2 border-dashed border-walnut/25"
      />
      <p className={`${RIBBON} absolute -top-4 left-5`}>Pick up where you left off</p>
      <span
        aria-hidden
        className="title-pop absolute -top-4 -right-3 grid h-12 w-12 rotate-12 place-items-center rounded-full border-[3px] border-walnut bg-sun text-walnut shadow-[0_4px_0_#1f1a16]"
      >
        <IconGraduationCap size={24} strokeWidth={2.25} />
      </span>
      <div className="relative min-w-0 flex-1">
        <p className="font-display text-[24px] leading-tight font-bold text-balance text-walnut sm:text-[28px]">
          Continue with {next.title}
        </p>
        <p className="mt-1.5 text-[15px] leading-6 font-medium text-ink-soft">
          {next.subject} ·{" "}
          {context === "library" ? (
            <>
              Walk up to a whiteboard and press <kbd className="kbd">L</kbd> to play it.
            </>
          ) : (
            "It's in your lessons in the Learning Studio."
          )}
        </p>
      </div>
      {context === "page" && (
        <Link href="/learning-studio" className={`${BTN.primary} relative`}>
          Open the Learning Studio
          <IconArrowRight size={18} strokeWidth={2.5} />
        </Link>
      )}
    </section>
  );
}

function StatTiles({ d }: { d: Dashboard }) {
  const accuracy = ratio(d.allTime.quizzesCorrect, d.allTime.quizzes);
  const today = d.days[d.days.length - 1]?.day ?? "";
  const tiles: {
    label: string;
    value: string;
    sub: string;
    icon: typeof IconClock;
    dot: string;
    /** A small leaf chip under the tile (verified focus), with words for screen readers. */
    chip?: { text: string; label: string } | null;
  }[] = [
    {
      label: "Focus this week",
      value: formatMinutes(d.thisWeek.focusMinutes),
      sub: `${formatMinutes(d.allTime.focusMinutes)} all-time`,
      icon: IconClock,
      dot: "bg-leaf",
      chip: verifiedText(d.thisWeek.verifiedMinutes, "")
        ? {
            text: verifiedText(d.thisWeek.verifiedMinutes)!,
            label: `${formatMinutes(d.thisWeek.verifiedMinutes)} of it seen at your desk`,
          }
        : null,
    },
    {
      label: "XP this week",
      value: formatNumber(d.thisWeek.xp),
      sub: `${formatNumber(d.allTime.xp)} all-time`,
      icon: IconTrophy,
      dot: "bg-sun",
    },
    {
      label: "Lessons completed",
      value: formatNumber(d.allTime.lessons),
      sub: `${formatNumber(d.thisWeek.lessons)} this week`,
      icon: IconGraduationCap,
      dot: "bg-sun",
    },
    {
      label: "Quizzes completed",
      value: formatNumber(d.allTime.quizzes),
      sub: accuracy === null ? "None answered yet" : `${formatPercent(accuracy)} right first try`,
      icon: IconCheck,
      dot: "bg-tangerine",
    },
    {
      label: "Current streak",
      value: plural(d.streak.current, "day"),
      sub: streakNote(d.streak, today),
      icon: IconFlame,
      dot: "bg-tangerine",
    },
    {
      label: "Explored",
      value: plural(d.explored.subjects, "subject"),
      sub: `${plural(d.explored.lessons, "lesson")} started`,
      icon: IconBook,
      dot: "bg-leaf",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-6">
      {tiles.map((t) => {
        const Icon = t.icon;
        return (
          <div
            key={t.label}
            className="relative flex flex-col rounded-[20px] border-[3px] border-walnut bg-surface px-4 py-4 shadow-[0_4px_0_#1f1a16] sm:px-5"
          >
            <dt className="pr-9 font-display text-[13.5px] leading-5 font-semibold text-ink-soft">
              <span className={`${ICON_DOT} absolute top-3 right-3 h-8 w-8 ${t.dot}`}>
                <Icon size={16} strokeWidth={2.5} />
              </span>
              {t.label}
            </dt>
            <dd className="tabular mt-2.5 font-display text-[28px] leading-none font-bold text-walnut sm:text-[32px]">
              {t.value}
            </dd>
            <dd className="mt-auto pt-2 text-[13px] leading-5 font-medium text-ink-soft">
              {t.sub}
            </dd>
            {t.chip && (
              <dd className="mt-2">
                <span className="tabular inline-flex items-center rounded-full border-2 border-walnut bg-forest-tint px-2 py-px font-display text-[12px] leading-4 font-semibold text-sage-dark">
                  <span aria-hidden>{t.chip.text}</span>
                  <span className="sr-only">{t.chip.label}</span>
                </span>
              </dd>
            )}
          </div>
        );
      })}
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
      verifiedText(day.verifiedMinutes),
      plural(day.lessons, "lesson"),
      plural(day.quizzes, "quiz", "quizzes"),
    ]
      .filter(Boolean)
      .join(" · "),
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
  const seen = d.thisWeek.verifiedMinutes + d.lastWeek.verifiedMinutes > 0;
  const rows = [
    { label: "XP", now: d.thisWeek.xp, before: d.lastWeek.xp, show: formatNumber },
    {
      label: "Focus",
      now: d.thisWeek.focusMinutes,
      before: d.lastWeek.focusMinutes,
      show: formatMinutes,
    },
    // Only for students who've used face tracking: nobody else sees a row of zeros.
    ...(seen
      ? [
          {
            label: "✓ At desk",
            now: d.thisWeek.verifiedMinutes,
            before: d.lastWeek.verifiedMinutes,
            show: formatMinutes,
          },
        ]
      : []),
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
        title="This week vs last week"
        sub="This week so far, against all of last week. Weeks start on Monday."
      />
      <table className="w-full text-sm">
        <thead className="font-display text-[13px] text-ink-soft">
          <tr>
            <th scope="col" className="pb-2 text-left font-semibold">
              <span className="sr-only">Measure</span>
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              This week
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              Last week
            </th>
            <th scope="col" className="pb-2 text-right font-semibold">
              Change
            </th>
          </tr>
        </thead>
        <tbody className="tabular">
          {rows.map((r) => {
            const change = delta(r.now, r.before);
            const amount = r.show(Math.abs(change.diff));
            return (
              <tr key={r.label} className="border-t-2 border-walnut/10">
                <th scope="row" className="py-2 text-left font-display font-semibold text-walnut">
                  {r.label}
                </th>
                <td className="py-2 text-right font-display font-bold text-walnut">
                  {r.show(r.now)}
                </td>
                <td className="py-2 text-right font-medium text-ink-soft">{r.show(r.before)}</td>
                <td className="py-2 pl-2 text-right">
                  {change.direction === "same" ? (
                    <span className="font-display font-semibold text-ink-soft">Same</span>
                  ) : (
                    <span
                      className={`inline-flex items-center gap-0.5 rounded-full border-2 py-px pr-2 pl-1 font-display text-[13px] font-semibold ${change.direction === "up" ? "border-walnut bg-leaf text-walnut shadow-[0_2px_0_#1f1a16]" : "border-walnut/30 bg-canvas text-ink-soft"}`}
                    >
                      <IconChevronDown
                        size={14}
                        strokeWidth={2.75}
                        className={change.direction === "up" ? "rotate-180" : ""}
                      />
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
        <p className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[15px] font-medium text-ink-soft">
          {/* A tilted sun stamp, like the title screen's "CC" stamp. */}
          <span className="tabular title-pop inline-grid h-16 min-w-16 -rotate-6 place-items-center rounded-full border-[3px] border-walnut bg-sun px-3 font-display text-[30px] leading-none font-bold text-walnut shadow-[0_4px_0_#1f1a16]">
            #{rank.rank}
          </span>{" "}
          <span>of {plural(rank.of, "learner")} this week</span>
        </p>
      ) : d.learner.leaderboardOptIn ? (
        <p className="text-[15px] leading-6 font-medium text-ink-soft">
          <span className="block font-display text-[17px] font-semibold text-walnut">
            Not ranked yet
          </span>
          Earn some XP this week to join the board.
        </p>
      ) : (
        <p className="text-[15px] leading-6 font-medium text-ink-soft">
          <span className="block font-display text-[17px] font-semibold text-walnut">
            Hidden from leaderboards
          </span>
          You&apos;ve chosen not to appear. You can change that on the Leaderboard tab.
        </p>
      )}
      <button type="button" onClick={() => go("leaderboard")} className={`mt-5 ${SMALL_BUTTON}`}>
        See the leaderboard
        <IconArrowRight size={16} strokeWidth={2.5} />
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
    <section
      aria-labelledby={id}
      className="grid gap-x-12 gap-y-4 rounded-[24px] border-[3px] border-dashed border-walnut/30 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.55fr)]"
    >
      <div>
        <SectionTitle
          id={id}
          title="How XP works"
          sub="The server checks each activity before it counts."
        />
        <p className="max-w-[46ch] text-[13px] leading-5 font-medium text-ink-soft">
          Past a daily limit, an activity still goes on your record, for 0 XP. Focus time counts a
          pomodoro&apos;s planned length, never time paused or spent away.
        </p>
        <p className="mt-2 max-w-[46ch] text-[13px] leading-5 font-medium text-ink-soft">
          Streaks forgive one missed day in any 7: a rest day. If you turn on face tracking at your
          table, a <span className="font-semibold text-sage-dark">✓</span> shows how much of your
          focus time you were seen at your desk, here and on the leaderboards. It&apos;s never
          needed, and it doesn&apos;t change your XP or your rank.
        </p>
        <DotRow className="mt-4" />
      </div>
      <ul className="divide-y-2 divide-walnut/10 text-sm">
        {rows.map((r) => (
          <li key={r.what} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
            <span className="min-w-0 flex-1 font-display text-[15px] font-semibold text-walnut">
              {r.what}
            </span>
            {r.cap && <span className="text-[13px] font-medium text-ink-soft">{r.cap}</span>}
            <span className="flex w-28 justify-end">
              <span className="tabular rounded-full border-2 border-walnut bg-sun px-2.5 py-0.5 font-display text-[13px] leading-4 font-semibold text-walnut shadow-[0_2px_0_#1f1a16]">
                {r.xp} XP
              </span>
            </span>
          </li>
        ))}
      </ul>
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
          <h3
            id={id}
            className="font-display text-[19px] leading-6 font-semibold break-words text-walnut"
          >
            {s.name}
          </h3>
          <p className="mt-0.5 text-[13px] leading-5 font-medium text-ink-soft">
            Last studied {formatDate(s.lastActivityAt)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-0.5">
          <Sparkline
            values={weeks}
            label={`Lessons completed per week, last ${weeks.length} weeks, oldest first: ${weeks.join(", ")}`}
          />
          <span className="font-display text-xs font-semibold text-ink-soft" aria-hidden>
            Lessons a week
          </span>
        </div>
      </div>
      <p className="mt-5 text-[15px] font-medium text-ink-soft">
        <span className="tabular font-display text-[32px] leading-none font-bold text-walnut">
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
        className="mt-3 h-4 overflow-hidden rounded-full border-2 border-walnut bg-canvas"
      >
        <div
          className={`h-full rounded-full bg-leaf ${share > 0 && share < 1 ? "border-r-2 border-walnut" : ""}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <p className="mt-1.5 text-[13px] font-medium text-ink-soft">
        of the lessons you&apos;ve started
      </p>
      <dl className="mt-5 grid grid-cols-2 gap-4 border-t-2 border-dashed border-walnut/20 pt-4 text-sm">
        <div>
          <dt className="font-display text-[13px] leading-5 font-semibold text-ink-soft">
            Quizzes answered
          </dt>
          <dd className="tabular mt-0.5 font-display text-[19px] font-bold text-walnut">
            {formatNumber(s.quizzesAnswered)}
          </dd>
        </div>
        {s.masteryEstimate !== null && (
          <div>
            <dt className="font-display text-[13px] leading-5 font-semibold text-ink-soft">
              Mastery estimate{" "}
              <span className="block font-sans font-medium">First-try quiz accuracy</span>
            </dt>
            <dd className="tabular mt-0.5 font-display text-[19px] font-bold text-walnut">
              {formatPercent(s.masteryEstimate)}
            </dd>
          </div>
        )}
      </dl>
    </li>
  );
}
