import type { LessonJobStatus } from "@/lib/jobs/types";
import type { Chunk, Lesson } from "@/lib/learning-studio/schema";

/**
 * The AI Librarian's API shapes (app-level, not TinyFish's or Gemini's: lib/librarian/server
 * maps provider output into these). TinyFish does the browsing, Gemini the synthesis, plans and
 * lessons, Tiger Data the learning record.
 *
 * Endpoints (same-origin; the signed learner cookie identifies the student):
 *   GET  /api/librarian/home                      → LibrarianHome
 *   POST /api/librarian/tasks        { message, taskId?, mode? }  → LibrarianTask
 *        (a new request, or the answer to the Librarian's follow-up question when taskId is set)
 *   GET  /api/librarian/tasks/:id                 → LibrarianTask   (poll while `busy`)
 *   POST /api/librarian/tasks/:id/confirm         → LibrarianTask   (starts the research)
 *   POST /api/librarian/tasks/:id/cancel          → LibrarianTask
 *   POST /api/librarian/tasks/:id/retry           → LibrarianTask   (re-runs the failed step)
 *   POST /api/librarian/tasks/:id/plan   { examDate?, minutesPerDay? } → LibrarianTask
 *   POST /api/librarian/tasks/:id/lesson { planItemId? }               → LibrarianTask
 *   POST /api/librarian/resources/:id    { saved: boolean }            → { ok: true }
 *   POST /api/librarian/notes  multipart { files: File[] (1–3 PDF/.txt/.md, ≤15 MB each),
 *                                          message?, outcome, examDate?, minutesPerDay? }
 *                                                → LibrarianTask (type study_from_notes, busy)
 *        Runs on its own, no confirmation: Gemini reads the notes → TinyFish opens the links in
 *        them and searches the web for what they cover thinly → sources are checked → the study
 *        plan and/or interactive lesson (built from the notes AND the sources) per `outcome`.
 *   POST /api/librarian/plan-items/:id   { action: "complete" | "skip" | "reopen" | "reschedule",
 *                                          date?: "YYYY-MM-DD" }       → { ok: true, xp }
 * Errors: { error: { code, message } } with a non-2xx status. 503 `not_configured` names the
 * missing setup (e.g. TINYFISH_API_KEY).
 */

export const TASK_TYPES = [
  "research_topic",
  "find_resources",
  "create_study_plan",
  "explain_weak_topic",
  "research_assignment",
  "study_from_notes",
] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export type TaskStatus =
  | "reading_notes"
  | "awaiting_details"
  | "awaiting_confirmation"
  | "research_queued"
  | "researching"
  | "organizing_results"
  | "generating_plan"
  | "generating_lesson"
  | "completed"
  | "failed"
  | "cancelled";

/** Statuses during which the client should keep polling. */
export const BUSY_STATUSES: readonly TaskStatus[] = [
  "reading_notes",
  "research_queued",
  "researching",
  "organizing_results",
  "generating_plan",
  "generating_lesson",
];

/** Human labels for each status (truthful; no made-up percentages). */
export const STATUS_LABELS: Record<TaskStatus, string> = {
  reading_notes: "Ms. Fenwick is reading your notes",
  awaiting_details: "Needs a detail from you",
  awaiting_confirmation: "Ready to start",
  research_queued: "Starting the research",
  researching: "Ms. Fenwick is researching the web",
  organizing_results: "Checking and organising sources",
  generating_plan: "Ms. Fenwick is writing your study plan",
  generating_lesson: "Ms. Fenwick is building your lesson",
  completed: "Done",
  failed: "Something went wrong",
  cancelled: "Cancelled",
};

/** What to make from uploaded notes. */
export const NOTES_OUTCOMES = ["plan", "lesson", "both"] as const;
export type NotesOutcome = (typeof NOTES_OUTCOMES)[number];

/** Upload limits for notes (checked on both sides). */
export const NOTES_LIMITS = {
  maxFiles: 3,
  maxBytes: 15 * 1024 * 1024,
  extensions: [".pdf", ".txt", ".md"],
} as const;

/** An uploaded file of notes, as the task shows it (the text itself stays on the server). */
export interface NotesFile {
  name: string;
  pages: number;
  chars: number;
}

/** quick = TinyFish Search + Fetch (about a minute). deep = TinyFish Research (5–20 min). */
export type ResearchMode = "quick" | "deep";

/** One thing TinyFish confirmably did (from its responses, never invented). */
export interface ResearchStep {
  at: string;
  kind: "search" | "fetch" | "plan" | "status" | "note" | "error";
  label: string;
  url?: string;
}

export type ResourceType =
  "article" | "video" | "course" | "paper" | "tutorial" | "documentation" | "other";

export interface ResourceCard {
  id: string;
  title: string;
  url: string;
  domain: string;
  resourceType: ResourceType;
  summary: string;
  /** Why it helps this student's goal. */
  relevance: string;
  /** Only when the evidence supports it. */
  difficulty: string | null;
  accessedAt: string;
  saved: boolean;
}

export type PlanItemStatus = "todo" | "done" | "skipped";
export type ActivityType = "read" | "watch" | "lesson" | "practice" | "review" | "quiz";

export interface PlanItem {
  id: string;
  date: string;
  type: ActivityType;
  title: string;
  description: string;
  resourceUrls: string[];
  estimatedMinutes: number;
  completionCriteria: string[];
  status: PlanItemStatus;
}

export interface StudyPlanView {
  id: string;
  title: string;
  goal: string;
  examDate: string | null;
  dailyMinutes: number;
  assumptions: string[];
  days: { date: string; focus: string; objectives: string[]; items: PlanItem[] }[];
}

export interface LibrarianTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  busy: boolean;
  /** The student's request, as they wrote it (follow-up answers appended). */
  request: string;
  topic: string;
  mode: ResearchMode;
  createdAt: string;
  /** The Librarian's latest message: a follow-up question, the plan of action, or a summary. */
  reply: string;
  /** What she still needs to know (awaiting_details). */
  questions: string[];
  /** What she's about to do (awaiting_confirmation). */
  confirmation: string | null;
  steps: ResearchStep[];
  /** Gemini's overview of what the research found (grounded in `resources`). */
  overview: string | null;
  keyConcepts: string[];
  resources: ResourceCard[];
  warnings: string[];
  plan: StudyPlanView | null;
  lesson: Lesson | null;
  /** For the lesson's AI teacher and its source references: page N = source N. */
  lessonChunks: Chunk[];
  /** Page N = source N. Pages from the student's own notes have url "" (not a link). */
  lessonSources: { page: number; title: string; url: string }[];
  /** The notes this request was built from (study_from_notes only, else empty). */
  notes: NotesFile[];
  /** What the student asked to get from their notes (study_from_notes only, else null). */
  outcome: NotesOutcome | null;
  /**
   * The lesson went to the library's cloud worker (lib/jobs) instead of being made in-request:
   * the student can leave and come back. Absent or null for lessons made here.
   */
  cloudLesson?: CloudLessonRef | null;
  error: { code: string; message: string; retryable: boolean } | null;
  /** Who did what, for the UI's attribution line. */
  attribution: { research: string; synthesis: string };
}

/** A lesson the library's cloud worker is making, or made, for a Librarian request. */
export interface CloudLessonRef {
  jobId: string;
  status: LessonJobStatus;
  /** The worker's own progress note, e.g. "Recorded 3 of 6 scenes". */
  progress: string | null;
  /** Scenes (0-based) with stored narration, served by /api/lessons/:jobId/audio/:scene. */
  audio: number[];
}

export type CircleRole = "owner" | "editor" | "viewer";

/** Her opening line for a signed-in student, built only from what's stored for them. */
export interface LibrarianGreeting {
  /** What she says (and speaks): at most 400 characters. */
  text: string;
  /** The request her "Want to pick it up?" means, if any. */
  resume: { taskId: string; topic: string } | null;
}

/** What a signed-in student's own library and Study Circles hold: names and counts only. */
export interface LibrarianShelf {
  /** Sources they saved from her research. */
  saved: number;
  /** Their private collections, most recently changed first (up to 6). */
  collections: { name: string; items: number }[];
  /** Study Circles they're a member of (up to 6, the busiest first). `fresh`: items other members
   * added since their last visit. */
  circles: { name: string; role: CircleRole; items: number; fresh: number }[];
}

export interface LibrarianHome {
  /** Recent requests, newest first (enough to reopen them). */
  recent: { id: string; topic: string; type: TaskType; status: TaskStatus; createdAt: string }[];
  saved: ResourceCard[];
  /** What to do next: the next open plan item, if any. */
  next: { planTitle: string; item: PlanItem; taskId: string } | null;
  /** A one-line, data-grounded nudge from Tiger Data (e.g. the subject with the lowest first-try accuracy). */
  insight: string | null;
  configured: { tinyfish: boolean; gemini: boolean; database: boolean };
  /** Sign-in as she sees it (from the verified Auth0 session): her personal touches need it. */
  account: "signed_in" | "signed_out" | "not_configured";
  /** Signed in: her greeting from what's stored (else null, and she uses her usual hello). */
  greeting: LibrarianGreeting | null;
  /** Signed in: what's on their shelf, for the "From your library" and "From your circles" chips. */
  shelf: LibrarianShelf | null;
}
