"use client";

import { useId, useState } from "react";
import { LIBRARY_TIME_ZONE } from "@/lib/learning/rules";
import type { Community } from "@/lib/learning/types";
import { type Bar, BarChart, BarList, SERIES } from "./charts";
import { formatDay, formatHour, formatMinutes, formatNumber, formatRange, plural } from "./format";
import { CARD, SectionTitle, Segmented, StateCard } from "./ui";

const HIDDEN = "Too few learners to show";

const TREND = [
  { id: "learners", label: "Learners" },
  { id: "focus", label: "Focus" },
  { id: "lessons", label: "Lessons" },
] as const;

type Trend = (typeof TREND)[number]["id"];

/** Library-wide activity: opted-in learners only, added up, small groups left out. */
export function CommunityView({ c }: { c: Community }) {
  const range = formatRange(c.from, c.to, LIBRARY_TIME_ZONE);
  const enough = c.learners >= c.minGroup;
  return (
    <div className="space-y-6">
      <section className={CARD} aria-label="About these numbers">
        <p className="text-sm">
          <span className="font-bold">{range}</span>
          <span className="text-ink-soft">
            {" "}
            · {plural(c.learners, "learner")} · groups under {c.minGroup} hidden
          </span>
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          Everything here is added up across learners who show on leaderboards. No names, no lesson
          titles, and any group smaller than {c.minGroup} is left out so no one can be picked out.
          Times are library time (Toronto).
        </p>
      </section>
      {enough ? (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            <Subjects c={c} />
            <Hours c={c} />
          </div>
          <Days c={c} />
        </>
      ) : (
        <StateCard title="Not enough learners yet">
          Community trends appear once at least {c.minGroup} learners who show on leaderboards have
          studied in the last 30 days.
        </StateCard>
      )}
    </div>
  );
}

function Subjects({ c }: { c: Community }) {
  const id = useId();
  return (
    <section className={CARD} aria-labelledby={id}>
      <SectionTitle id={id} title="Subjects this week" sub="By how many learners studied each" />
      {c.subjects.length ? (
        <BarList
          color={SERIES.learners}
          items={c.subjects.map((s) => ({
            key: s.name,
            label: s.name,
            value: s.learners,
            detail: `${plural(s.learners, "learner")} · ${plural(s.lessons, "lesson")} · ${plural(s.quizzes, "quiz", "quizzes")}`,
          }))}
        />
      ) : (
        <p className="text-sm text-ink-soft">
          No subject has had {c.minGroup} or more learners this week yet.
        </p>
      )}
    </section>
  );
}

function Hours({ c }: { c: Community }) {
  const id = useId();
  const bars: Bar[] = c.hours.map((h) => ({
    key: String(h.hour),
    label: formatHour(h.hour),
    tick: h.hour % 6 === 0 ? formatHour(h.hour) : "",
    value: h.events,
    detail:
      h.events === null
        ? HIDDEN
        : `${plural(h.events, "activity", "activities")} · ${plural(h.learners ?? 0, "learner")}`,
  }));
  const busiest = c.hours.reduce<(typeof c.hours)[number] | null>(
    (top, h) => ((h.events ?? 0) > (top?.events ?? 0) ? h : top),
    null,
  );
  const summary =
    "Finished pomodoros, lessons and knowledge checks by hour of day over the last 4 weeks" +
    (busiest ? `; busiest at ${formatHour(busiest.hour)}.` : ".");
  return (
    <section className={CARD} aria-labelledby={id}>
      <SectionTitle
        id={id}
        title="When the library is busiest"
        sub="Activities finished, by hour of day · last 4 weeks"
      />
      <BarChart
        bars={bars}
        color={SERIES.learners}
        summary={summary}
        unit="Activities"
        height={160}
      />
      {bars.some((b) => b.value === null) && <HiddenNote />}
    </section>
  );
}

function Days({ c }: { c: Community }) {
  const id = useId();
  const [trend, setTrend] = useState<Trend>("learners");
  const n = c.days.length;
  const pick = (d: Community["days"][number]) =>
    trend === "learners" ? d.learners : trend === "focus" ? d.focusMinutes : d.lessons;
  const bars: Bar[] = c.days.map((d, i) => ({
    key: d.day,
    label: formatDay(d.day, { weekday: "short", month: "short", day: "numeric" }),
    tick: (n - 1 - i) % 7 === 0 ? formatDay(d.day) : "",
    value: pick(d),
    detail:
      d.learners === null
        ? HIDDEN
        : [
            plural(d.learners, "learner"),
            `${formatMinutes(d.focusMinutes ?? 0)} focus`,
            plural(d.lessons ?? 0, "lesson"),
          ].join(" · "),
  }));
  const label = TREND.find((t) => t.id === trend)!.label;
  const total = bars.reduce((sum, b) => sum + (b.value ?? 0), 0);
  const summary =
    trend === "learners"
      ? `Learners per day over the last ${n} days.`
      : `${label} per day over the last ${n} days: ${trend === "focus" ? formatMinutes(total) : formatNumber(total)} in all.`;
  return (
    <section className={CARD} aria-labelledby={id}>
      <SectionTitle
        id={id}
        title="Day by day"
        sub={`${trend === "learners" ? "Learners" : trend === "focus" ? "Focus time" : "Lessons finished"} each day · last 30 days`}
        aside={<Segmented label="Trend shows" options={TREND} value={trend} onChange={setTrend} />}
      />
      <BarChart
        bars={bars}
        color={
          trend === "learners" ? SERIES.learners : trend === "focus" ? SERIES.focus : SERIES.lessons
        }
        summary={summary}
        unit={label}
        scale={trend === "focus" ? "minutes" : "count"}
        emptyNote="No activity in the last 30 days yet"
      />
      {bars.some((b) => b.value === null) && <HiddenNote />}
    </section>
  );
}

function HiddenNote() {
  return (
    <p className="mt-2 flex items-center gap-2 text-xs text-ink-soft">
      <span className="inline-block h-0.5 w-3 rounded-full bg-ink/25" aria-hidden />A short grey
      dash marks a slot with too few learners to show.
    </p>
  );
}
