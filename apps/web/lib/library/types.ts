import type { ActivityType, ResourceType, TaskStatus, TaskType } from "@/lib/librarian/types";
import type { Chunk, Lesson } from "@/lib/learning-studio/schema";

/**
 * A signed-in student's private library: the shapes the API sends and the browser reads. Nothing
 * here is secret, and nothing carries an owner id: the server always takes the owner from the
 * verified Auth0 session (lib/auth/currentUser.ts requireUser), never from the request.
 *
 * Endpoints (same-origin; JSON bodies need `content-type: application/json`):
 *   GET    /api/me/library                           → LibraryView
 *   GET    /api/me/collections                       → { collections: CollectionSummary[] }
 *   POST   /api/me/collections        { name }       → CollectionSummary (201)
 *   GET    /api/me/collections/:id                   → CollectionView
 *   PATCH  /api/me/collections/:id    { name }       → CollectionSummary
 *   DELETE /api/me/collections/:id                   → { ok: true }   (its items go with it)
 *   POST   /api/me/collections/:id/items  NewItem    → SaveResult (201 when added, 200 when it
 *                                                      was already there)
 *   GET    /api/me/collections/:id/items/:itemId     → ItemDetail
 *   PATCH  /api/me/collections/:id/items/:itemId  { title?, summary?, text?, progress? }
 *                                                    → { item: LibraryItem }
 *   DELETE /api/me/collections/:id/items/:itemId     → { ok: true }
 *   POST   /api/me/lessons   { lesson, sourceName?, chunks?, progress? }
 *                                                    → SaveResult (into "My lessons")
 *   POST   /api/me/plans     { planId }              → SaveResult (into "My study plans")
 *   DELETE /api/me/saved/:sourceId                   → { ok: true }   (unsaves a Librarian source)
 *
 * NewItem is one of:
 *   { kind: "resource", sourceId }                   a source the Librarian found for you
 *   { kind: "resource", title, url, summary? }       any https link
 *   { kind: "lesson", lesson, sourceName?, chunks?, progress? }
 *   { kind: "plan", planId }                         one of your study plans (a snapshot)
 *   { kind: "note", title, text }
 *
 * Errors: { error: { code, message } }. 503 auth_not_configured (sign-in isn't set up), 503
 * not_configured (no database), 401 sign_in_required, 400 bad_request, 404 not_found (also for
 * anything that isn't yours, so ids can't be probed), 409 duplicate or limit, 413 too_large,
 * 415 bad_content_type, 422 not_https, 429 rate_limited.
 */

export const ITEM_KINDS = ["resource", "lesson", "plan", "note"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const LIBRARY_LIMITS = {
  collectionName: 80,
  title: 200,
  summary: 2000,
  url: 2048,
  noteText: 20_000,
  sourceName: 200,
  collections: 100,
  itemsPerCollection: 500,
  /** The JSON a saved item may keep (the database allows 256 KB; jsonb's text form is wordier). */
  payloadBytes: 200_000,
  /** The largest request body the library reads. */
  bodyBytes: 600_000,
} as const;

/** Where saves without a chosen collection go (made the first time they're needed). */
export const DEFAULT_COLLECTIONS = { lesson: "My lessons", plan: "My study plans" } as const;

export interface CollectionSummary {
  id: string;
  name: string;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LessonProgress {
  /** The scene to start from (0-based). */
  scene: number;
  completed: boolean;
}

/** What a list shows about a saved lesson (the lesson itself comes with ItemDetail). */
export interface LessonInfo {
  key: string;
  subject: string;
  scenes: number;
  estimatedMinutes: number;
  sourceName: string;
  progress: LessonProgress;
  /** Whether the text it was made from is saved too (the AI teacher answers from it). */
  hasNotes: boolean;
  /** Some of that text was left out to fit. */
  notesTrimmed: boolean;
}

/** A saved study plan: a snapshot, with live counts while the plan still exists. */
export interface PlanInfo {
  planId: string;
  goal: string;
  examDate: string | null;
  dailyMinutes: number;
  total: number;
  done: number;
  /** The plan is still in the Librarian (false once it's been deleted there). */
  live: boolean;
}

export interface LibraryItem {
  id: string;
  collectionId: string;
  collectionName: string;
  kind: ItemKind;
  title: string;
  /** https only; resources have one. */
  url: string | null;
  summary: string;
  /** For resources: the site it's on. */
  domain: string | null;
  createdAt: string;
  updatedAt: string;
  lesson: LessonInfo | null;
  plan: PlanInfo | null;
  /** A note's text. */
  note: string | null;
}

export interface CollectionView {
  collection: CollectionSummary;
  items: LibraryItem[];
}

export interface PlanSnapshotDay {
  date: string;
  focus: string;
  items: { title: string; type: ActivityType; minutes: number; status: string }[];
}

export interface ItemDetail {
  item: LibraryItem;
  /** A lesson's content, ready for the player. */
  lesson: { lesson: Lesson; chunks: Chunk[] } | null;
  /** A plan's days, as they were when it was saved. */
  planDays: PlanSnapshotDay[] | null;
}

export interface SaveResult {
  item: LibraryItem;
  /** False when it was already in the collection (it's been refreshed instead). */
  added: boolean;
  collection: { id: string; name: string };
}

/** A source the Librarian found that you pressed Save on. */
export interface SavedSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  resourceType: ResourceType;
  summary: string;
  savedAt: string | null;
  /** What you'd asked her, for "From your request about …". */
  topic: string;
}

export interface HistoryTask {
  id: string;
  topic: string;
  type: TaskType;
  status: TaskStatus;
  createdAt: string;
}

export interface HistoryLesson {
  lessonId: string;
  title: string;
  subject: string | null;
  event: "started" | "completed";
  at: string;
}

export type ContinueItem =
  | {
      kind: "plan_item";
      id: string;
      title: string;
      planTitle: string;
      date: string;
      type: ActivityType;
      minutes: number;
    }
  | {
      kind: "lesson";
      itemId: string;
      collectionId: string;
      title: string;
      scene: number;
      scenes: number;
    };

export interface LibraryView {
  displayName: string;
  saved: SavedSource[];
  collections: CollectionSummary[];
  lessons: LibraryItem[];
  history: { tasks: HistoryTask[]; lessons: HistoryLesson[] };
  /** Unfinished things, most relevant first: open plan items and lessons left partway. */
  continue: ContinueItem[];
  /** The topic of your latest finished request, for a "welcome back" that's actually true. */
  lastTopic: string | null;
}
