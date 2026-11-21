/** Shapes the learning API returns (GET /api/learning/<view>). Numbers come straight from Tiger Data. */

export type TimelineKind = "all" | "lessons" | "quizzes" | "sessions";

export interface TimelineEntry {
  id: string;
  type: "study_session_completed" | "lesson_completed" | "quiz_completed";
  at: string;
  subject: string | null;
  /** Lesson title: private, only ever returned to its owner. */
  lessonTitle: string | null;
  lessonId: string | null;
  durationSeconds: number | null;
  score: number | null;
  xp: number;
}

export interface DayActivity {
  /** "YYYY-MM-DD", library time. */
  day: string;
  xp: number;
  focusMinutes: number;
  lessons: number;
  quizzes: number;
}

export interface PeriodTotals {
  xp: number;
  focusMinutes: number;
  sessions: number;
  lessons: number;
  quizzes: number;
  quizzesCorrect: number;
  activeDays: number;
}

export interface SubjectProgress {
  subjectId: string;
  name: string;
  /** Lessons in this subject the student has started (the only real denominator there is). */
  lessonsStarted: number;
  lessonsCompleted: number;
  quizzesAnswered: number;
  /** First-try correct ÷ answered: an estimate of mastery, null with no answers yet. */
  masteryEstimate: number | null;
  lastActivityAt: string;
  /** Lessons completed per week, oldest first (last 6 weeks). */
  weeklyCompletions: number[];
}

export interface Dashboard {
  learner: { displayName: string; leaderboardOptIn: boolean };
  allTime: PeriodTotals;
  thisWeek: PeriodTotals;
  lastWeek: PeriodTotals;
  thisMonth: PeriodTotals;
  streak: { current: number; longest: number };
  explored: { subjects: number; lessons: number };
  /** Last 30 days, oldest first, gaps filled with zeros. */
  days: DayActivity[];
  subjects: SubjectProgress[];
  recent: TimelineEntry[];
  continueWith: { lessonId: string; title: string; subject: string } | null;
  weeklyRank: { rank: number; of: number } | null;
  queryMs: number;
}

export interface LeaderboardRow {
  rank: number;
  displayName: string;
  xp: number;
  focusMinutes: number;
  activeDays: number;
  isMe: boolean;
  isDemo: boolean;
}

export interface Leaderboard {
  period: "week" | "month";
  /** ISO start and end of the period. */
  from: string;
  to: string;
  rows: LeaderboardRow[];
  /** Your own standing, even when outside the top rows or opted out (then rank is null). */
  me: { rank: number | null; xp: number; optedIn: boolean } | null;
  participants: number;
  queryMs: number;
}

export interface Community {
  from: string;
  to: string;
  /** Distinct learners in the window (opted-in only). */
  learners: number;
  /** Groups smaller than this are hidden. */
  minGroup: number;
  subjects: { name: string; learners: number; lessons: number; quizzes: number }[];
  /** Community activity by hour of day (0–23, library time); null where too few learners. */
  hours: { hour: number; events: number | null; learners: number | null }[];
  /** Daily community totals, oldest first; null where too few learners. */
  days: {
    day: string;
    learners: number | null;
    focusMinutes: number | null;
    lessons: number | null;
  }[];
  queryMs: number;
}
