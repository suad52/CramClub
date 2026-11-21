import "server-only";
import type postgres from "postgres";
import { LIBRARY_TIME_ZONE as TZ, MIN_GROUP, streaks } from "../rules";
import type {
  Community,
  Dashboard,
  DayActivity,
  Leaderboard,
  LeaderboardOrder,
  LeaderboardRow,
  PeriodTotals,
  SubjectProgress,
  TimelineEntry,
  TimelineKind,
} from "../types";

/**
 * Read models. Totals, charts, streaks and rankings come from the learning_daily continuous
 * aggregate (Tiger Data keeps it materialised and adds the newest events in real time), so they
 * stay fast however long the event history grows. The timeline and the community's hour-of-day
 * rhythm read the learning_events hypertable directly, scoped by time.
 *
 * Verified focus ("seen at the desk", migration 0010) comes from two more continuous aggregates:
 * focus_presence_daily (per learner per day: the chart, the month, all time, the leaderboards)
 * and focus_presence_weekly, rolled up from the daily one (this week against last week). It is
 * shown beside focus time and never ranked by.
 */

type Sql = postgres.Sql;
const ms = (start: number) => Math.round(performance.now() - start);
const int = (v: unknown) => Number(v ?? 0);

/** "YYYY-MM-DD" in the library's time zone. */
export function libraryDay(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(date);
}

/** The `n` days ending today ("YYYY-MM-DD"), oldest first. */
export function lastDays(n: number, today = libraryDay()) {
  const base = Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 1, +today.slice(8, 10));
  return Array.from({ length: n }, (_, i) =>
    new Date(base - (n - 1 - i) * 864e5).toISOString().slice(0, 10),
  );
}

const EMPTY_TOTALS: PeriodTotals = {
  xp: 0,
  focusMinutes: 0,
  verifiedMinutes: 0,
  sessions: 0,
  lessons: 0,
  quizzes: 0,
  quizzesCorrect: 0,
  activeDays: 0,
};

const TIMELINE_TYPES: Record<TimelineKind, TimelineEntry["type"][]> = {
  all: ["study_session_completed", "lesson_completed", "quiz_completed"],
  lessons: ["lesson_completed"],
  quizzes: ["quiz_completed"],
  sessions: ["study_session_completed"],
};

export async function timeline(
  sql: Sql,
  userId: string | null,
  opts: { kind?: TimelineKind; subject?: string | null; before?: Date | null; limit?: number },
): Promise<{ entries: TimelineEntry[]; next: string | null }> {
  if (!userId) return { entries: [], next: null };
  const limit = Math.min(50, opts.limit ?? 30);
  const rows = await sql`
    SELECT e.event_id, e.event_type, e.occurred_at, s.name AS subject, l.title, e.lesson_id,
      e.duration_seconds, e.seen_seconds, e.score, e.xp_delta
    FROM learning_events e
    LEFT JOIN lessons l ON l.user_id = e.user_id AND l.lesson_id = e.lesson_id
    LEFT JOIN subjects s ON s.subject_id = e.subject_id
    WHERE e.user_id = ${userId}
      AND e.event_type = ANY(${TIMELINE_TYPES[opts.kind ?? "all"]})
      AND (${opts.subject ?? null}::text IS NULL OR e.subject_id = ${opts.subject ?? null})
      AND e.occurred_at < ${opts.before ?? new Date("9999-01-01")}
    ORDER BY e.occurred_at DESC
    LIMIT ${limit + 1}`;
  const entries = rows.slice(0, limit).map((r): TimelineEntry => ({
    id: r.event_id as string,
    type: r.event_type as TimelineEntry["type"],
    at: (r.occurred_at as Date).toISOString(),
    subject: (r.subject as string) ?? null,
    lessonTitle: (r.title as string) ?? null,
    lessonId: (r.lesson_id as string) ?? null,
    durationSeconds: r.duration_seconds === null ? null : int(r.duration_seconds),
    seenSeconds: r.seen_seconds === null ? null : int(r.seen_seconds),
    score: r.score === null ? null : Number(r.score),
    xp: int(r.xp_delta),
  }));
  return {
    entries,
    next: rows.length > limit ? entries[entries.length - 1]!.at : null,
  };
}

/**
 * Everyone with XP in the period, ranked: XP, then focus time, then active days, then who
 * joined first. By "focus" it's everyone with focus time, ranked by it, then XP, then the same.
 * Opted-out learners aren't ranked. Each row also carries its verified ("seen") seconds, which
 * the order never looks at. Rows carry user ids: never send them out.
 */
async function ranking(sql: Sql, period: "week" | "month", by: LeaderboardOrder = "xp") {
  return sql`
    WITH b AS (
      SELECT date_trunc(${period}, now() AT TIME ZONE ${TZ}) AS local_start),
    bounds AS (
      SELECT local_start AT TIME ZONE ${TZ} AS start,
        (local_start + CASE WHEN ${period} = 'month' THEN interval '1 month'
                            ELSE interval '1 week' END) AT TIME ZONE ${TZ} AS stop
      FROM b),
    t AS (
      SELECT d.user_id, sum(d.xp)::int AS xp, sum(d.focus_seconds)::int AS focus,
        count(DISTINCT d.day)::int AS days
      FROM learning_daily d, bounds WHERE d.day >= bounds.start AND d.day < bounds.stop
      GROUP BY d.user_id),
    p AS (
      SELECT f.user_id, sum(f.seen_seconds)::int AS seen
      FROM focus_presence_daily f, bounds WHERE f.day >= bounds.start AND f.day < bounds.stop
      GROUP BY f.user_id)
    SELECT row_number() OVER (
        ORDER BY CASE WHEN ${by} = 'focus' THEN t.focus ELSE t.xp END DESC,
          CASE WHEN ${by} = 'focus' THEN t.xp ELSE t.focus END DESC,
          t.days DESC, l.created_at, l.user_id)::int AS rank,
      l.user_id, l.display_name, l.is_demo, t.xp, t.focus, t.days, coalesce(p.seen, 0) AS seen,
      bounds.start, bounds.stop
    FROM t JOIN learners l USING (user_id) LEFT JOIN p USING (user_id), bounds
    WHERE CASE WHEN ${by} = 'focus' THEN t.focus ELSE t.xp END > 0 AND l.leaderboard_opt_in
    ORDER BY rank`;
}

export async function leaderboard(
  sql: Sql,
  userId: string | null,
  period: "week" | "month",
  by: LeaderboardOrder = "xp",
): Promise<Leaderboard> {
  const t0 = performance.now();
  const [ranked, mine, [bounds]] = await Promise.all([
    ranking(sql, period, by),
    userId
      ? sql`SELECT l.leaderboard_opt_in, coalesce(sum(d.xp), 0)::int AS xp,
            coalesce(sum(d.focus_seconds), 0)::int AS focus,
            (SELECT coalesce(sum(f.seen_seconds), 0)::int FROM focus_presence_daily f
              WHERE f.user_id = l.user_id
                AND f.day >= date_trunc(${period}, now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ})
              AS seen
          FROM learners l LEFT JOIN learning_daily d ON d.user_id = l.user_id
            AND d.day >= date_trunc(${period}, now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}
          WHERE l.user_id = ${userId} GROUP BY l.user_id, l.leaderboard_opt_in`
      : Promise.resolve([]),
    sql`SELECT date_trunc(${period}, now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ} AS start,
      (date_trunc(${period}, now() AT TIME ZONE ${TZ})
        + CASE WHEN ${period} = 'month' THEN interval '1 month' ELSE interval '1 week' END)
        AT TIME ZONE ${TZ} AS stop`,
  ]);
  const toRow = (r: (typeof ranked)[number]): LeaderboardRow => ({
    rank: int(r.rank),
    displayName: r.display_name as string,
    xp: int(r.xp),
    focusMinutes: Math.round(int(r.focus) / 60),
    verifiedMinutes: Math.round(int(r.seen) / 60),
    activeDays: int(r.days),
    isMe: r.user_id === userId,
    isDemo: r.is_demo as boolean,
  });
  const meRow = ranked.find((r) => r.user_id === userId);
  return {
    period,
    by,
    from: (bounds!.start as Date).toISOString(),
    to: (bounds!.stop as Date).toISOString(),
    rows: ranked.slice(0, 25).map(toRow),
    me: mine[0]
      ? {
          rank: meRow ? int(meRow.rank) : null,
          xp: int(mine[0].xp),
          focusMinutes: Math.round(int(mine[0].focus) / 60),
          verifiedMinutes: Math.round(int(mine[0].seen) / 60),
          optedIn: mine[0].leaderboard_opt_in as boolean,
        }
      : null,
    participants: ranked.length,
    queryMs: ms(t0),
  };
}

export async function dashboard(sql: Sql, userId: string | null): Promise<Dashboard> {
  const t0 = performance.now();
  const today = libraryDay();
  const days30 = lastDays(30, today);
  if (!userId) {
    return {
      learner: { displayName: "", leaderboardOptIn: true },
      allTime: EMPTY_TOTALS,
      thisWeek: EMPTY_TOTALS,
      lastWeek: EMPTY_TOTALS,
      thisMonth: EMPTY_TOTALS,
      streak: { current: 0, longest: 0, restDays: [], studyToday: false },
      explored: { subjects: 0, lessons: 0 },
      days: days30.map((day) => ({
        day,
        xp: 0,
        focusMinutes: 0,
        verifiedMinutes: 0,
        lessons: 0,
        quizzes: 0,
      })),
      subjects: [],
      recent: [],
      continueWith: null,
      weeklyRank: null,
      queryMs: ms(t0),
    };
  }
  const [
    learner,
    totals,
    daily,
    active,
    explored,
    subjects,
    weekly,
    recent,
    next,
    ranked,
    seenDays,
    [seenTotals],
    seenWeeks,
  ] = await Promise.all([
    sql`SELECT display_name, leaderboard_opt_in FROM learners WHERE user_id = ${userId}`,
    sql`
        WITH b AS (SELECT
          date_trunc('week', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ} AS wk,
          date_trunc('month', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ} AS mo)
        SELECT p.name, coalesce(sum(d.xp), 0)::int AS xp,
          coalesce(sum(d.focus_seconds), 0)::int AS focus,
          coalesce(sum(d.sessions_completed), 0)::int AS sessions,
          coalesce(sum(d.lessons_completed), 0)::int AS lessons,
          coalesce(sum(d.quizzes_completed), 0)::int AS quizzes,
          coalesce(sum(d.quizzes_correct), 0)::int AS correct,
          count(DISTINCT d.day)::int AS active_days
        FROM b CROSS JOIN (VALUES ('all'), ('week'), ('last'), ('month')) AS p(name)
        LEFT JOIN learning_daily d ON d.user_id = ${userId} AND CASE p.name
          WHEN 'week' THEN d.day >= b.wk
          WHEN 'last' THEN d.day >= b.wk - interval '7 days' AND d.day < b.wk
          WHEN 'month' THEN d.day >= b.mo
          ELSE true END
        GROUP BY p.name`,
    sql`
        SELECT to_char(day AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, sum(xp)::int AS xp,
          (sum(focus_seconds) / 60)::int AS focus, sum(lessons_completed)::int AS lessons,
          sum(quizzes_completed)::int AS quizzes
        FROM learning_daily
        WHERE user_id = ${userId}
          AND day >= (date_trunc('day', now() AT TIME ZONE ${TZ}) - interval '29 days') AT TIME ZONE ${TZ}
        GROUP BY 1`,
    sql`SELECT DISTINCT to_char(day AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day
        FROM learning_daily WHERE user_id = ${userId}`,
    sql`SELECT count(DISTINCT subject_id)::int AS subjects, count(*)::int AS lessons
        FROM lessons WHERE user_id = ${userId}`,
    sql`
        SELECT s.subject_id, s.name, count(*)::int AS started,
          count(*) FILTER (WHERE p.completion_status = 'completed')::int AS completed,
          sum(p.quizzes_answered)::int AS answered, sum(p.quizzes_first_try)::int AS first_try,
          max(p.last_activity_at) AS last
        FROM learning_progress p JOIN subjects s USING (subject_id)
        WHERE p.user_id = ${userId}
        GROUP BY s.subject_id, s.name ORDER BY last DESC`,
    sql`
        SELECT subject_id,
          round(extract(epoch FROM date_trunc('week', now() AT TIME ZONE ${TZ})
            - date_trunc('week', day AT TIME ZONE ${TZ})) / 604800)::int AS weeks_ago,
          sum(lessons_completed)::int AS n
        FROM learning_daily
        WHERE user_id = ${userId} AND subject_id IS NOT NULL
          AND day >= (date_trunc('week', now() AT TIME ZONE ${TZ}) - interval '5 weeks') AT TIME ZONE ${TZ}
        GROUP BY 1, 2`,
    timeline(sql, userId, { limit: 5 }),
    sql`
        SELECT p.lesson_id, l.title, s.name AS subject
        FROM learning_progress p JOIN lessons l USING (user_id, lesson_id)
        JOIN subjects s ON s.subject_id = p.subject_id
        WHERE p.user_id = ${userId} AND p.completion_status = 'in_progress'
        ORDER BY p.last_activity_at DESC LIMIT 1`,
    ranking(sql, "week"),
    // Verified focus per day, last 30 days (focus_presence_daily).
    sql`
        SELECT to_char(day AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, sum(seen_seconds)::int AS seen
        FROM focus_presence_daily
        WHERE user_id = ${userId}
          AND day >= (date_trunc('day', now() AT TIME ZONE ${TZ}) - interval '29 days') AT TIME ZONE ${TZ}
        GROUP BY 1`,
    sql`
        SELECT coalesce(sum(seen_seconds), 0)::int AS all_time,
          coalesce(sum(seen_seconds) FILTER (WHERE
            day >= date_trunc('month', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}), 0)::int AS month
        FROM focus_presence_daily WHERE user_id = ${userId}`,
    // This week and last week, from the weekly aggregate rolled up from the daily one.
    sql`
        SELECT CASE WHEN week >= date_trunc('week', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}
            THEN 'week' ELSE 'last' END AS name, sum(seen_seconds)::int AS seen
        FROM focus_presence_weekly
        WHERE user_id = ${userId}
          AND week >= (date_trunc('week', now() AT TIME ZONE ${TZ}) - interval '7 days') AT TIME ZONE ${TZ}
        GROUP BY 1`,
  ]);

  const byPeriod = new Map(totals.map((r) => [r.name as string, r]));
  const seenBy: Record<string, number> = {
    all: int(seenTotals?.all_time),
    month: int(seenTotals?.month),
    ...Object.fromEntries(seenWeeks.map((r) => [r.name as string, int(r.seen)])),
  };
  const period = (name: string): PeriodTotals => {
    const r = byPeriod.get(name);
    return r
      ? {
          xp: int(r.xp),
          focusMinutes: Math.round(int(r.focus) / 60),
          verifiedMinutes: Math.round((seenBy[name] ?? 0) / 60),
          sessions: int(r.sessions),
          lessons: int(r.lessons),
          quizzes: int(r.quizzes),
          quizzesCorrect: int(r.correct),
          activeDays: int(r.active_days),
        }
      : EMPTY_TOTALS;
  };
  const dayMap = new Map(daily.map((r) => [r.day as string, r]));
  const seenMap = new Map(seenDays.map((r) => [r.day as string, int(r.seen)]));
  const days: DayActivity[] = days30.map((day) => {
    const r = dayMap.get(day);
    return {
      day,
      xp: int(r?.xp),
      focusMinutes: int(r?.focus),
      // Whole minutes, rounded down like focus minutes, so it never shows more than them.
      verifiedMinutes: Math.floor((seenMap.get(day) ?? 0) / 60),
      lessons: int(r?.lessons),
      quizzes: int(r?.quizzes),
    };
  });
  const weeks = new Map<string, number[]>();
  for (const r of weekly) {
    const list = weeks.get(r.subject_id as string) ?? [0, 0, 0, 0, 0, 0];
    const ago = int(r.weeks_ago);
    if (ago >= 0 && ago < 6) list[5 - ago] = (list[5 - ago] ?? 0) + int(r.n);
    weeks.set(r.subject_id as string, list);
  }
  const subjectRows: SubjectProgress[] = subjects.map((r) => ({
    subjectId: r.subject_id as string,
    name: r.name as string,
    lessonsStarted: int(r.started),
    lessonsCompleted: int(r.completed),
    quizzesAnswered: int(r.answered),
    masteryEstimate: int(r.answered) > 0 ? int(r.first_try) / int(r.answered) : null,
    lastActivityAt: (r.last as Date).toISOString(),
    weeklyCompletions: weeks.get(r.subject_id as string) ?? [0, 0, 0, 0, 0, 0],
  }));
  const mine = ranked.find((r) => r.user_id === userId);
  return {
    learner: {
      displayName: (learner[0]?.display_name as string) ?? "",
      leaderboardOptIn: (learner[0]?.leaderboard_opt_in as boolean) ?? true,
    },
    allTime: period("all"),
    thisWeek: period("week"),
    lastWeek: period("last"),
    thisMonth: period("month"),
    streak: streaks(
      active.map((r) => r.day as string),
      today,
    ),
    explored: { subjects: int(explored[0]?.subjects), lessons: int(explored[0]?.lessons) },
    days,
    subjects: subjectRows,
    recent: recent.entries,
    continueWith: next[0]
      ? {
          lessonId: next[0].lesson_id as string,
          title: next[0].title as string,
          subject: next[0].subject as string,
        }
      : null,
    weeklyRank: mine ? { rank: int(mine.rank), of: ranked.length } : null,
    queryMs: ms(t0),
  };
}

/** Community-wide activity: opted-in learners only, aggregated, small groups hidden. */
export async function community(sql: Sql): Promise<Community> {
  const t0 = performance.now();
  const [[span], subjects, hours, days] = await Promise.all([
    sql`SELECT count(DISTINCT d.user_id)::int AS learners,
        (date_trunc('day', now() AT TIME ZONE ${TZ}) - interval '29 days') AT TIME ZONE ${TZ} AS start,
        now() AS stop
      FROM learning_daily d JOIN learners l USING (user_id)
      WHERE l.leaderboard_opt_in
        AND d.day >= (date_trunc('day', now() AT TIME ZONE ${TZ}) - interval '29 days') AT TIME ZONE ${TZ}`,
    sql`SELECT s.name, count(DISTINCT d.user_id)::int AS learners,
        sum(d.lessons_completed)::int AS lessons, sum(d.quizzes_completed)::int AS quizzes
      FROM learning_daily d JOIN learners l USING (user_id) JOIN subjects s USING (subject_id)
      WHERE l.leaderboard_opt_in
        AND d.day >= date_trunc('week', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}
      GROUP BY s.name ORDER BY learners DESC, lessons DESC`,
    sql`SELECT extract(hour FROM time_bucket(interval '1 hour', e.occurred_at, ${TZ})
          AT TIME ZONE ${TZ})::int AS hour,
        count(*)::int AS events, count(DISTINCT e.user_id)::int AS learners
      FROM learning_events e JOIN learners l USING (user_id)
      WHERE l.leaderboard_opt_in AND e.occurred_at >= now() - interval '28 days'
        AND e.event_type IN ('study_session_completed', 'lesson_completed', 'quiz_completed')
      GROUP BY 1`,
    sql`SELECT to_char(d.day AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
        count(DISTINCT d.user_id)::int AS learners, (sum(d.focus_seconds) / 60)::int AS focus,
        sum(d.lessons_completed)::int AS lessons
      FROM learning_daily d JOIN learners l USING (user_id)
      WHERE l.leaderboard_opt_in
        AND d.day >= (date_trunc('day', now() AT TIME ZONE ${TZ}) - interval '29 days') AT TIME ZONE ${TZ}
      GROUP BY 1`,
  ]);
  const big = (n: unknown) => int(n) >= MIN_GROUP;
  const hourMap = new Map(hours.map((r) => [int(r.hour), r]));
  const dayMap = new Map(days.map((r) => [r.day as string, r]));
  return {
    from: (span!.start as Date).toISOString(),
    to: (span!.stop as Date).toISOString(),
    learners: int(span!.learners),
    minGroup: MIN_GROUP,
    subjects: subjects
      .filter((r) => big(r.learners))
      .map((r) => ({
        name: r.name as string,
        learners: int(r.learners),
        lessons: int(r.lessons),
        quizzes: int(r.quizzes),
      })),
    hours: Array.from({ length: 24 }, (_, hour) => {
      const r = hourMap.get(hour);
      const show = r && big(r.learners);
      return {
        hour,
        events: show ? int(r.events) : r ? null : 0,
        learners: show ? int(r.learners) : r ? null : 0,
      };
    }),
    days: lastDays(30).map((day) => {
      const r = dayMap.get(day);
      if (!r) return { day, learners: 0, focusMinutes: 0, lessons: 0 };
      const show = big(r.learners);
      return {
        day,
        learners: show ? int(r.learners) : null,
        focusMinutes: show ? int(r.focus) : null,
        lessons: show ? int(r.lessons) : null,
      };
    }),
    queryMs: ms(t0),
  };
}
