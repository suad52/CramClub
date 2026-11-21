import { z } from "zod";
import { type Chunk, type Lesson, LessonSchema } from "@/lib/learning-studio/schema";
import { LIBRARY_LIMITS as L, type LessonProgress } from "./types";

/**
 * Checks for everything a student can send the personal library (pure, so the tests and the
 * server share them). Nothing here decides who owns what: that's the server's job, from the
 * verified session.
 */

/** Spaces collapsed and trimmed; control characters (and NUL, which Postgres refuses) removed. */
export function cleanText(value: string) {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();
}

const oneLine = (value: string) => cleanText(value.replace(/\s+/g, " "));

/** A secure web link (https, a real host, no user:password@), normalised; else null. */
export function httpsUrl(value: string): string | null {
  const raw = value.trim();
  if (!raw || raw.length > L.url) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !url.hostname.includes(".")) return null;
    if (url.username || url.password) return null;
    return url.href.length <= L.url ? url.href : null;
  } catch {
    return null;
  }
}

/** "khanacademy.org" from a link. */
export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const line = (max: number) => z.string().transform(oneLine).pipe(z.string().min(1).max(max));
const paragraph = (max: number) => z.string().transform(cleanText).pipe(z.string().max(max));

export const CollectionNameBody = z.object({ name: line(L.collectionName) });

const Progress = z.object({
  scene: z.number().int().min(0).max(19),
  completed: z.boolean(),
});

const ChunkInput = z.object({
  page: z.number().int().min(1).max(100_000),
  text: z.string().max(20_000),
});

const LessonInput = z.object({
  lesson: LessonSchema,
  sourceName: z.string().max(400).optional(),
  chunks: z.array(ChunkInput).max(2000).optional(),
  progress: Progress.optional(),
});

/** POST /api/me/lessons. */
export const LessonBody = LessonInput;

/** POST /api/me/plans. */
export const PlanBody = z.object({ planId: z.uuid() });

/** POST /api/me/collections/:id/items. */
export const NewItemBody = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("resource"),
      sourceId: z.uuid().optional(),
      title: line(L.title).optional(),
      url: z
        .string()
        .max(L.url + 100)
        .optional(),
      summary: paragraph(L.summary).optional(),
    })
    .refine((b) => !!b.sourceId || (!!b.title && !!b.url), {
      message: "A link needs a title and a url (or the id of a source the Librarian found).",
    }),
  LessonInput.extend({ kind: z.literal("lesson") }),
  z.object({ kind: z.literal("plan"), planId: z.uuid() }),
  z.object({
    kind: z.literal("note"),
    title: line(L.title),
    text: paragraph(L.noteText).pipe(z.string().min(1)),
  }),
]);
export type NewItem = z.infer<typeof NewItemBody>;

/** PATCH /api/me/collections/:id/items/:itemId (at least one field). */
export const ItemPatchBody = z
  .object({
    title: line(L.title).optional(),
    summary: paragraph(L.summary).optional(),
    text: paragraph(L.noteText).pipe(z.string().min(1)).optional(),
    progress: Progress.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), {
    message: "Nothing to change.",
  });
export type ItemPatch = z.infer<typeof ItemPatchBody>;

/** The first problem with a request, in words a student can act on. */
export function firstIssue(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) return "That request isn't valid.";
  const field = issue.path.join(".");
  if (field === "lesson" || field.startsWith("lesson."))
    return "That lesson isn't in a shape the library can keep.";
  if (field === "name") return `A collection needs a name of 1 to ${L.collectionName} characters.`;
  if (field === "title") return `A title needs 1 to ${L.title} characters.`;
  if (field === "text")
    return `A note needs some text, up to ${L.noteText.toLocaleString()} characters.`;
  if (field === "summary")
    return `Keep the summary under ${L.summary.toLocaleString()} characters.`;
  if (field === "kind") return "Save a resource, a lesson, a plan or a note.";
  if (issue.message && !issue.message.startsWith("Invalid")) return issue.message;
  return "That request isn't valid.";
}

/**
 * A stable id for a lesson from its content. The same formula as lib/learning/client.ts
 * lessonKey (a client module the server can't import), so a saved lesson and its learning
 * analytics share an id. The tests check the two agree.
 */
export function lessonKey(lesson: Pick<Lesson, "title" | "subject" | "scenes">) {
  const text = [
    lesson.title,
    lesson.subject,
    ...lesson.scenes.map((s) => `${s.id}:${s.title}`),
  ].join("|");
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return `l-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

/** JSON without NUL characters (Postgres can't keep them in jsonb), and its size in bytes. */
export function toJson(value: unknown) {
  const text = JSON.stringify(value, (_k, v: unknown) =>
    typeof v === "string" ? v.replace(/\u0000/g, "") : v,
  );
  return { text, bytes: Buffer.byteLength(text, "utf8") };
}

export interface LessonPayload {
  key: string;
  subject: string;
  scenes: number;
  estimatedMinutes: number;
  sourceName: string;
  progress: LessonProgress;
  hasNotes: boolean;
  notesTrimmed: boolean;
  lesson: Lesson;
  chunks: Chunk[];
}

/**
 * What a saved lesson keeps: the lesson, where it came from, the student's place in it, and as
 * much of the text it was made from as fits (from the start; the rest is left out and flagged).
 * Null when the lesson alone is too big to keep.
 */
export function lessonPayload(input: z.infer<typeof LessonInput>): LessonPayload | null {
  const lesson = input.lesson;
  const scenes = lesson.scenes.length;
  const progress = input.progress
    ? { scene: Math.min(input.progress.scene, scenes - 1), completed: input.progress.completed }
    : { scene: 0, completed: false };
  const all = (input.chunks ?? [])
    .map((c) => ({ page: c.page, text: cleanText(c.text) }))
    .filter((c) => c.text.length > 0);
  const base = {
    key: lessonKey(lesson),
    subject: lesson.subject,
    scenes,
    estimatedMinutes: lesson.estimatedMinutes,
    sourceName: oneLine(input.sourceName ?? "").slice(0, L.sourceName),
    progress,
    lesson,
  };
  const make = (chunks: Chunk[]): LessonPayload => ({
    ...base,
    hasNotes: chunks.length > 0,
    notesTrimmed: chunks.length < all.length,
    chunks,
  });
  if (toJson(make([])).bytes > L.payloadBytes) return null;
  // The most chunks that fit: binary search on how many to keep from the start.
  let lo = 0;
  let hi = all.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (toJson(make(all.slice(0, mid))).bytes <= L.payloadBytes) lo = mid;
    else hi = mid - 1;
  }
  return make(all.slice(0, lo));
}

/** A value clipped to `max` characters (for text copied from the Librarian's own rows). */
export function clip(value: unknown, max: number) {
  return typeof value === "string" ? cleanText(value).slice(0, max) : "";
}
