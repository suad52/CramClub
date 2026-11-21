import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { ActivityType, ResourceType, TaskStatus, TaskType } from "@/lib/librarian/types";
import type { Chunk, Lesson } from "@/lib/learning-studio/schema";
import {
  DEFAULT_COLLECTIONS,
  type CollectionSummary,
  type CollectionView,
  type ContinueItem,
  type HistoryLesson,
  type ItemDetail,
  type ItemKind,
  LIBRARY_LIMITS as L,
  type LessonProgress,
  type LibraryItem,
  type LibraryView,
  type PlanSnapshotDay,
  type SaveResult,
} from "./types";
import {
  type ItemPatch,
  type NewItem,
  clip,
  domainOf,
  httpsUrl,
  lessonPayload,
  toJson,
} from "./validate";

/**
 * The personal library on Tiger Data: a student's private collections (collections,
 * collection_items from migration 0004) plus views over what they already have (saved Librarian
 * sources, plans, requests, lesson activity).
 *
 * Every function takes `me`, the learner id requireUser derived from the verified Auth0 session,
 * and every read, update and delete names it in the same query that touches the row: another
 * student's id simply matches nothing, so the caller answers 404 and never learns it exists.
 * Rows copied in (a source, a plan) are read the same way, so nobody can save someone else's.
 */

type Q = postgres.Sql | postgres.TransactionSql;
type Row = postgres.Row;

export class LibraryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "LibraryError";
  }
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? ""));
const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const asJson = (v: unknown) => JSON.parse(toJson(v).text) as postgres.JSONValue;

function progressOf(v: unknown, scenes: number): LessonProgress {
  const p = (v ?? {}) as { scene?: unknown; completed?: unknown };
  const scene = Math.min(Math.max(0, Math.trunc(num(p.scene))), Math.max(0, scenes - 1));
  return { scene, completed: p.completed === true };
}

function toCollection(r: Row): CollectionSummary {
  return {
    id: r.id as string,
    name: r.name as string,
    itemCount: Number(r.item_count ?? 0),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

/**
 * An item row as the API shows it. `info` is the payload without its heavy parts (a lesson's
 * scenes and notes, a plan's days); `live` is a plan's current counts, when it still exists.
 */
function toItem(r: Row): LibraryItem {
  const info = (r.info ?? {}) as Record<string, unknown>;
  const kind = r.kind as ItemKind;
  const url = (r.url as string | null) ?? null;
  const live = r.live as { total?: unknown; done?: unknown } | null | undefined;
  const liveTotal = num(live?.total);
  return {
    id: r.id as string,
    collectionId: r.collection_id as string,
    collectionName: str(r.collection_name),
    kind,
    title: r.title as string,
    url,
    summary: str(r.summary),
    domain: kind === "resource" && url ? str(info.domain) || domainOf(url) : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    lesson:
      kind === "lesson"
        ? {
            key: str(info.key),
            subject: str(info.subject),
            scenes: num(info.scenes),
            estimatedMinutes: num(info.estimatedMinutes),
            sourceName: str(info.sourceName),
            progress: progressOf(info.progress, num(info.scenes)),
            hasNotes: info.hasNotes === true,
            notesTrimmed: info.notesTrimmed === true,
          }
        : null,
    plan:
      kind === "plan"
        ? {
            planId: str(info.planId),
            goal: str(info.goal),
            examDate: str(info.examDate) || null,
            dailyMinutes: num(info.dailyMinutes),
            total: liveTotal > 0 ? liveTotal : num(info.total),
            done: liveTotal > 0 ? num(live?.done) : num(info.done),
            live: liveTotal > 0,
          }
        : null,
    note: kind === "note" ? str(info.text) : null,
  };
}

/** One student's writes happen one at a time (collection limits, default collections). */
async function lockOwner(tx: Q, me: string) {
  await tx`SELECT user_id FROM learners WHERE user_id = ${me} FOR UPDATE`;
}

/* ---- Collections ---- */

export async function listCollections(sql: Q, me: string): Promise<CollectionSummary[]> {
  const rows = await sql`SELECT c.id, c.name, c.created_at, c.updated_at,
      (SELECT count(*)::int FROM collection_items i WHERE i.collection_id = c.id) AS item_count
    FROM collections c WHERE c.owner_id = ${me}
    ORDER BY c.updated_at DESC LIMIT ${L.collections}`;
  return rows.map(toCollection);
}

export function createCollection(sql: postgres.Sql, me: string, name: string) {
  return sql.begin(async (tx): Promise<CollectionSummary> => {
    await lockOwner(tx, me);
    const [mine] = await tx`SELECT count(*)::int AS n,
        coalesce(bool_or(lower(name) = lower(${name})), false) AS taken
      FROM collections WHERE owner_id = ${me}`;
    if (mine?.taken)
      throw new LibraryError(409, "duplicate", `You already have a collection called "${name}".`);
    if (Number(mine?.n ?? 0) >= L.collections)
      throw new LibraryError(409, "limit", `You can have up to ${L.collections} collections.`);
    const [row] = await tx`INSERT INTO collections (id, owner_id, name)
      VALUES (${randomUUID()}, ${me}, ${name})
      RETURNING id, name, created_at, updated_at, 0 AS item_count`;
    return toCollection(row!);
  });
}

export async function getCollection(
  sql: Q,
  me: string,
  id: string,
): Promise<CollectionView | null> {
  const [c] = await sql`SELECT c.id, c.name, c.created_at, c.updated_at,
      (SELECT count(*)::int FROM collection_items i WHERE i.collection_id = c.id) AS item_count
    FROM collections c WHERE c.id = ${id} AND c.owner_id = ${me}`;
  if (!c) return null;
  const items = await sql`SELECT i.id, i.collection_id, c.name AS collection_name, i.kind, i.title,
      i.url, i.summary, i.created_at, i.updated_at, (i.payload - 'lesson' - 'chunks' - 'days') AS info,
      CASE WHEN i.kind = 'plan' THEN (
        SELECT jsonb_build_object('total', count(*), 'done', count(*) FILTER (WHERE p.status = 'done'))
        FROM study_plan_items p
        WHERE p.user_id = ${me} AND p.study_plan_id = (i.payload->>'planId')::uuid
      ) END AS live
    FROM collection_items i JOIN collections c ON c.id = i.collection_id
    WHERE i.collection_id = ${id} AND c.owner_id = ${me}
    ORDER BY i.created_at DESC LIMIT ${L.itemsPerCollection}`;
  return { collection: toCollection(c), items: items.map(toItem) };
}

export function renameCollection(sql: postgres.Sql, me: string, id: string, name: string) {
  return sql.begin(async (tx): Promise<CollectionSummary | null> => {
    const [c] = await tx`SELECT id FROM collections WHERE id = ${id} AND owner_id = ${me}
      FOR UPDATE`;
    if (!c) return null;
    const [clash] = await tx`SELECT 1 AS x FROM collections
      WHERE owner_id = ${me} AND id <> ${id} AND lower(name) = lower(${name}) LIMIT 1`;
    if (clash)
      throw new LibraryError(409, "duplicate", `You already have a collection called "${name}".`);
    const [row] = await tx`UPDATE collections SET name = ${name}, updated_at = now()
      WHERE id = ${id} AND owner_id = ${me}
      RETURNING id, name, created_at, updated_at,
        (SELECT count(*)::int FROM collection_items i WHERE i.collection_id = ${id}) AS item_count`;
    return row ? toCollection(row) : null;
  });
}

/** Deletes a collection and everything in it. */
export async function deleteCollection(sql: Q, me: string, id: string) {
  const rows =
    await sql`DELETE FROM collections WHERE id = ${id} AND owner_id = ${me} RETURNING id`;
  return rows.length > 0;
}

/* ---- Items ---- */

/** What an item will be, worked out (and checked) before it's stored. */
interface Draft {
  kind: ItemKind;
  title: string;
  url: string | null;
  summary: string;
  payload: Record<string, unknown>;
  sourceTaskId: string | null;
  /** How to recognise the same thing already in the collection. */
  match: { field: "url" | "key" | "planId"; value: string } | null;
  /** Re-saving a lesson without a place in it keeps the saved place. */
  keepProgress: boolean;
}

async function planSnapshot(q: Q, me: string, planId: string) {
  const [p] = await q`SELECT id, task_id, title, goal, target_date, daily_minutes, days
    FROM study_plans WHERE id = ${planId} AND user_id = ${me}`;
  if (!p) return null;
  const items = await q`SELECT scheduled_date, title, activity_type, estimated_minutes, status
    FROM study_plan_items WHERE study_plan_id = ${planId} AND user_id = ${me}
    ORDER BY scheduled_date, position LIMIT 400`;
  const focus = new Map(
    ((p.days as { date?: string; focus?: string }[] | null) ?? []).map((d) => [
      str(d.date),
      str(d.focus),
    ]),
  );
  const days: PlanSnapshotDay[] = [];
  for (const it of items) {
    const date = day(it.scheduled_date);
    let entry = days.at(-1);
    if (entry?.date !== date) {
      entry = { date, focus: clip(focus.get(date), 160), items: [] };
      days.push(entry);
    }
    entry.items.push({
      title: clip(it.title, 200),
      type: it.activity_type as ActivityType,
      minutes: Number(it.estimated_minutes),
      status: str(it.status),
    });
  }
  const payload: Record<string, unknown> = {
    planId,
    goal: clip(p.goal, 500),
    examDate: p.target_date ? day(p.target_date) : null,
    dailyMinutes: Number(p.daily_minutes),
    total: items.length,
    done: items.filter((i) => i.status === "done").length,
    days,
  };
  if (toJson(payload).bytes > L.payloadBytes) payload.days = [];
  return {
    title: clip(p.title, L.title) || "Study plan",
    summary: clip(p.goal, L.summary),
    taskId: p.task_id as string,
    payload,
  };
}

async function draftFor(q: Q, me: string, input: NewItem): Promise<Draft> {
  if (input.kind === "resource") {
    if (input.sourceId) {
      const [s] = await q`SELECT task_id, title, url, summary, domain, resource_type
        FROM research_sources WHERE id = ${input.sourceId} AND user_id = ${me}`;
      if (!s) throw new LibraryError(404, "not_found", "No such source.");
      const url = httpsUrl(s.url as string);
      if (!url)
        throw new LibraryError(
          422,
          "not_https",
          "Only secure (https) links can go in your library, and this source isn't one.",
        );
      return {
        kind: "resource",
        title: clip(s.title, L.title) || domainOf(url),
        url,
        summary: clip(s.summary, L.summary),
        payload: {
          domain: clip(s.domain, 200) || domainOf(url),
          resourceType: s.resource_type as ResourceType,
        },
        sourceTaskId: s.task_id as string,
        match: { field: "url", value: url },
        keepProgress: false,
      };
    }
    const url = httpsUrl(input.url ?? "");
    if (!url)
      throw new LibraryError(
        422,
        "not_https",
        "Links in your library need a full web address that starts with https://",
      );
    return {
      kind: "resource",
      title: input.title!,
      url,
      summary: input.summary ?? "",
      payload: { domain: domainOf(url) },
      sourceTaskId: null,
      match: { field: "url", value: url },
      keepProgress: false,
    };
  }
  if (input.kind === "lesson") {
    const payload = lessonPayload(input);
    if (!payload)
      throw new LibraryError(413, "too_large", "That lesson is too big to keep in your library.");
    return {
      kind: "lesson",
      title: clip(input.lesson.title, L.title),
      url: null,
      summary: clip(input.lesson.description, L.summary),
      payload: { ...payload },
      sourceTaskId: null,
      match: { field: "key", value: payload.key },
      keepProgress: !input.progress,
    };
  }
  if (input.kind === "plan") {
    const plan = await planSnapshot(q, me, input.planId);
    if (!plan) throw new LibraryError(404, "not_found", "No such study plan.");
    return {
      kind: "plan",
      title: plan.title,
      url: null,
      summary: plan.summary,
      payload: plan.payload,
      sourceTaskId: plan.taskId,
      match: { field: "planId", value: input.planId },
      keepProgress: false,
    };
  }
  return {
    kind: "note",
    title: input.title,
    url: null,
    summary: "",
    payload: { text: input.text },
    sourceTaskId: null,
    match: null,
    keepProgress: false,
  };
}

/**
 * Stores a draft in a collection the caller has already checked is `me`'s (and locked, in the
 * same transaction). The same resource, lesson or plan saved again is refreshed, not doubled.
 */
async function store(
  tx: Q,
  me: string,
  collection: { id: string; name: string },
  d: Draft,
): Promise<SaveResult> {
  const cid = collection.id;
  const result = (row: Row, added: boolean): SaveResult => ({
    item: toItem({ ...row, collection_name: collection.name }),
    added,
    collection,
  });
  const live = d.kind === "plan" ? { total: d.payload.total, done: d.payload.done } : null;
  if (d.match) {
    const [same] = await tx`SELECT id FROM collection_items
      WHERE collection_id = ${cid} AND kind = ${d.kind}
        AND CASE ${d.match.field}::text WHEN 'url' THEN url
          WHEN 'key' THEN payload->>'key' ELSE payload->>'planId' END = ${d.match.value}
      LIMIT 1`;
    if (same && d.kind === "resource") {
      const [row] = await tx`SELECT id, collection_id, kind, title, url, summary, created_at,
          updated_at, (payload - 'lesson' - 'chunks' - 'days') AS info
        FROM collection_items WHERE id = ${same.id as string} AND collection_id = ${cid}`;
      return result(row!, false);
    }
    if (same) {
      // A lesson saved again without a place or without its notes keeps the ones it had.
      const keepNotes = d.kind === "lesson" && d.payload.hasNotes !== true;
      const [row] = await tx`UPDATE collection_items SET title = ${d.title}, summary = ${d.summary},
          payload = ${tx.json(asJson(d.payload))}::jsonb
            || CASE WHEN ${d.keepProgress}::boolean AND payload ? 'progress'
              THEN jsonb_build_object('progress', payload->'progress') ELSE '{}'::jsonb END
            || CASE WHEN ${keepNotes}::boolean AND payload ? 'chunks'
              THEN jsonb_build_object('chunks', payload->'chunks',
                'hasNotes', coalesce(payload->'hasNotes', 'false'::jsonb),
                'notesTrimmed', coalesce(payload->'notesTrimmed', 'false'::jsonb))
              ELSE '{}'::jsonb END,
          updated_at = now()
        WHERE id = ${same.id as string} AND collection_id = ${cid}
        RETURNING id, collection_id, kind, title, url, summary, created_at, updated_at,
          (payload - 'lesson' - 'chunks' - 'days') AS info`;
      await tx`UPDATE collections SET updated_at = now() WHERE id = ${cid} AND owner_id = ${me}`;
      return result({ ...row!, live }, false);
    }
  }
  const [count] = await tx`SELECT count(*)::int AS n FROM collection_items
    WHERE collection_id = ${cid}`;
  if (Number(count?.n ?? 0) >= L.itemsPerCollection)
    throw new LibraryError(
      409,
      "limit",
      `A collection can hold up to ${L.itemsPerCollection} things. Make another one for the rest.`,
    );
  const [row] = await tx`INSERT INTO collection_items
      (id, collection_id, kind, title, url, summary, payload, source_task_id, added_by)
    VALUES (${randomUUID()}, ${cid}, ${d.kind}, ${d.title}, ${d.url}, ${d.summary},
      ${tx.json(asJson(d.payload))}, ${d.sourceTaskId}, ${me})
    RETURNING id, collection_id, kind, title, url, summary, created_at, updated_at,
      (payload - 'lesson' - 'chunks' - 'days') AS info`;
  await tx`UPDATE collections SET updated_at = now() WHERE id = ${cid} AND owner_id = ${me}`;
  return result({ ...row!, live }, true);
}

/** Adds something to one of `me`'s collections. Null when that collection isn't theirs. */
export function addItem(sql: postgres.Sql, me: string, collectionId: string, input: NewItem) {
  return sql.begin(async (tx): Promise<SaveResult | null> => {
    const [c] = await tx`SELECT id, name FROM collections
      WHERE id = ${collectionId} AND owner_id = ${me} FOR UPDATE`;
    if (!c) return null;
    const draft = await draftFor(tx, me, input);
    return store(tx, me, { id: c.id as string, name: c.name as string }, draft);
  });
}

/** `me`'s collection with this name, made if it doesn't exist (caller holds the owner lock). */
async function defaultCollection(tx: Q, me: string, name: string) {
  const [found] = await tx`SELECT id, name FROM collections
    WHERE owner_id = ${me} AND lower(name) = lower(${name}) ORDER BY created_at LIMIT 1`;
  if (found) return { id: found.id as string, name: found.name as string };
  const [n] = await tx`SELECT count(*)::int AS n FROM collections WHERE owner_id = ${me}`;
  if (Number(n?.n ?? 0) >= L.collections)
    throw new LibraryError(
      409,
      "limit",
      `You have ${L.collections} collections already. Delete one to make room for "${name}".`,
    );
  const [made] = await tx`INSERT INTO collections (id, owner_id, name)
    VALUES (${randomUUID()}, ${me}, ${name}) RETURNING id, name`;
  return { id: made!.id as string, name: made!.name as string };
}

/** A Learning Studio lesson into "My lessons" (refreshed if it's there already). */
export function saveLesson(
  sql: postgres.Sql,
  me: string,
  input: Omit<Extract<NewItem, { kind: "lesson" }>, "kind">,
) {
  return sql.begin(async (tx): Promise<SaveResult> => {
    const draft = await draftFor(tx, me, { ...input, kind: "lesson" });
    await lockOwner(tx, me);
    const collection = await defaultCollection(tx, me, DEFAULT_COLLECTIONS.lesson);
    return store(tx, me, collection, draft);
  });
}

/** One of `me`'s study plans into "My study plans". Null when the plan isn't theirs. */
export function savePlan(sql: postgres.Sql, me: string, planId: string) {
  return sql.begin(async (tx): Promise<SaveResult | null> => {
    let draft: Draft;
    try {
      draft = await draftFor(tx, me, { kind: "plan", planId });
    } catch (error) {
      if (error instanceof LibraryError && error.status === 404) return null;
      throw error;
    }
    await lockOwner(tx, me);
    const collection = await defaultCollection(tx, me, DEFAULT_COLLECTIONS.plan);
    return store(tx, me, collection, draft);
  });
}

/** One item with everything it keeps (a lesson's scenes and notes, a plan's days). */
export async function getItem(
  sql: Q,
  me: string,
  collectionId: string,
  itemId: string,
): Promise<ItemDetail | null> {
  const [r] = await sql`SELECT i.id, i.collection_id, c.name AS collection_name, i.kind, i.title,
      i.url, i.summary, i.created_at, i.updated_at, i.payload
    FROM collection_items i JOIN collections c ON c.id = i.collection_id
    WHERE i.id = ${itemId} AND i.collection_id = ${collectionId} AND c.owner_id = ${me}`;
  if (!r) return null;
  const { lesson, chunks, days, ...info } = (r.payload ?? {}) as Record<string, unknown>;
  let live: Row | null = null;
  if (r.kind === "plan" && typeof info.planId === "string") {
    [live = null] = await sql`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE status = 'done')::int AS done
      FROM study_plan_items WHERE study_plan_id = ${info.planId} AND user_id = ${me}`;
  }
  return {
    item: toItem({ ...r, info, live }),
    lesson:
      r.kind === "lesson" && lesson
        ? { lesson: lesson as Lesson, chunks: Array.isArray(chunks) ? (chunks as Chunk[]) : [] }
        : null,
    planDays: r.kind === "plan" && Array.isArray(days) ? (days as PlanSnapshotDay[]) : null,
  };
}

/** Renames or edits an item, or moves a lesson's saved place. Null when it isn't `me`'s. */
export async function updateItem(
  sql: Q,
  me: string,
  collectionId: string,
  itemId: string,
  patch: ItemPatch,
): Promise<LibraryItem | null> {
  const [r] = await sql`UPDATE collection_items i SET
      title = coalesce(${patch.title ?? null}::text, i.title),
      summary = CASE WHEN i.kind IN ('resource', 'plan') AND ${patch.summary !== undefined}::boolean
        THEN ${patch.summary ?? ""}::text ELSE i.summary END,
      payload = CASE
        WHEN i.kind = 'lesson' AND ${patch.progress !== undefined}::boolean
          THEN jsonb_set(i.payload, '{progress}', ${sql.json(patch.progress ?? {})}::jsonb)
        WHEN i.kind = 'note' AND ${patch.text !== undefined}::boolean
          THEN jsonb_set(i.payload, '{text}', to_jsonb(${patch.text ?? ""}::text))
        ELSE i.payload END,
      updated_at = now()
    FROM collections c
    WHERE i.id = ${itemId} AND i.collection_id = ${collectionId}
      AND c.id = i.collection_id AND c.owner_id = ${me}
    RETURNING i.id, i.collection_id, c.name AS collection_name, i.kind, i.title, i.url, i.summary,
      i.created_at, i.updated_at, (i.payload - 'lesson' - 'chunks' - 'days') AS info`;
  return r ? toItem(r) : null;
}

export async function removeItem(sql: Q, me: string, collectionId: string, itemId: string) {
  const rows = await sql`DELETE FROM collection_items i USING collections c
    WHERE i.id = ${itemId} AND i.collection_id = ${collectionId}
      AND c.id = i.collection_id AND c.owner_id = ${me}
    RETURNING i.id`;
  if (rows.length)
    await sql`UPDATE collections SET updated_at = now() WHERE id = ${collectionId} AND owner_id = ${me}`;
  return rows.length > 0;
}

/** Unsaves a source the Librarian found (the same as pressing Saved again in her panel). */
export async function unsaveSource(sql: Q, me: string, sourceId: string) {
  const rows = await sql`UPDATE research_sources SET saved = false, saved_at = NULL
    WHERE id = ${sourceId} AND user_id = ${me} RETURNING id`;
  return rows.length > 0;
}

/* ---- The whole library ---- */

export async function libraryView(sql: Q, me: string, displayName: string): Promise<LibraryView> {
  const [saved, collections, lessons, tasks, lessonEvents, openItems] = await Promise.all([
    sql`SELECT s.id, s.title, s.url, s.domain, s.resource_type, s.summary, s.saved_at, t.topic
      FROM research_sources s JOIN librarian_tasks t ON t.id = s.task_id
      WHERE s.user_id = ${me} AND t.user_id = ${me} AND s.saved
      ORDER BY s.saved_at DESC NULLS LAST LIMIT 100`,
    listCollections(sql, me),
    sql`SELECT i.id, i.collection_id, c.name AS collection_name, i.kind, i.title, i.url,
        i.summary, i.created_at, i.updated_at, (i.payload - 'lesson' - 'chunks' - 'days') AS info
      FROM collection_items i JOIN collections c ON c.id = i.collection_id
      WHERE c.owner_id = ${me} AND i.kind = 'lesson'
      ORDER BY i.updated_at DESC LIMIT 100`,
    sql`SELECT id, topic, task_type, status, created_at FROM librarian_tasks
      WHERE user_id = ${me} ORDER BY created_at DESC LIMIT 10`,
    sql`SELECT e.event_type, e.occurred_at, e.lesson_id, l.title, s.name AS subject
      FROM learning_events e
      LEFT JOIN lessons l ON l.user_id = e.user_id AND l.lesson_id = e.lesson_id
      LEFT JOIN subjects s ON s.subject_id = e.subject_id
      WHERE e.user_id = ${me} AND e.event_type IN ('lesson_started', 'lesson_completed')
        AND e.occurred_at > now() - INTERVAL '180 days'
      ORDER BY e.occurred_at DESC LIMIT 40`,
    sql`SELECT i.id, i.title, i.scheduled_date, i.activity_type, i.estimated_minutes,
        p.title AS plan_title
      FROM study_plan_items i JOIN study_plans p ON p.id = i.study_plan_id
      WHERE i.user_id = ${me} AND p.user_id = ${me} AND i.status = 'todo' AND p.status = 'active'
      ORDER BY i.scheduled_date, i.position LIMIT 3`,
  ]);

  const lessonItems = lessons.map(toItem);
  const seen = new Set<string>();
  const historyLessons: HistoryLesson[] = [];
  for (const e of lessonEvents) {
    const id = str(e.lesson_id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    historyLessons.push({
      lessonId: id,
      title: str(e.title) || "A lesson",
      subject: str(e.subject) || null,
      event: e.event_type === "lesson_completed" ? "completed" : "started",
      at: iso(e.occurred_at),
    });
    if (historyLessons.length >= 8) break;
  }

  const continuing: ContinueItem[] = [
    ...lessonItems
      .filter((i) => i.lesson && !i.lesson.progress.completed && i.lesson.progress.scene > 0)
      .slice(0, 3)
      .map((i): ContinueItem => ({
        kind: "lesson",
        itemId: i.id,
        collectionId: i.collectionId,
        title: i.title,
        scene: i.lesson!.progress.scene,
        scenes: i.lesson!.scenes,
      })),
    ...openItems.map((i): ContinueItem => ({
      kind: "plan_item",
      id: i.id as string,
      title: i.title as string,
      planTitle: i.plan_title as string,
      date: day(i.scheduled_date),
      type: i.activity_type as ActivityType,
      minutes: Number(i.estimated_minutes),
    })),
  ].slice(0, 4);

  const finished = tasks.find((t) => t.status === "completed" && str(t.topic).trim());
  return {
    displayName,
    saved: saved.map((s) => ({
      id: s.id as string,
      title: s.title as string,
      url: s.url as string,
      domain: str(s.domain) || domainOf(s.url as string),
      resourceType: s.resource_type as ResourceType,
      summary: str(s.summary),
      savedAt: s.saved_at ? iso(s.saved_at) : null,
      topic: str(s.topic),
    })),
    collections,
    lessons: lessonItems,
    history: {
      tasks: tasks.map((t) => ({
        id: t.id as string,
        topic: str(t.topic),
        type: t.task_type as TaskType,
        status: t.status as TaskStatus,
        createdAt: iso(t.created_at),
      })),
      lessons: historyLessons,
    },
    continue: continuing,
    lastTopic: finished ? str(finished.topic).trim().slice(0, 120) : null,
  };
}
