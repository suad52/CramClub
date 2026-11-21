import { describe, expect, it } from "vitest";
import { lessonKey as clientLessonKey } from "@/lib/learning/client";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "@/lib/learning-studio/mockLesson";
import { LIBRARY_LIMITS } from "./types";
import {
  CollectionNameBody,
  ItemPatchBody,
  LessonBody,
  NewItemBody,
  PlanBody,
  cleanText,
  firstIssue,
  httpsUrl,
  lessonKey,
  lessonPayload,
  toJson,
} from "./validate";

describe("httpsUrl", () => {
  it("keeps secure web links, normalised", () => {
    expect(httpsUrl("  https://Docs.Racket-Lang.org/guide/lists.html ")).toBe(
      "https://docs.racket-lang.org/guide/lists.html",
    );
  });

  it.each([
    "http://example.edu/page",
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://example.edu/file",
    "https://user:pass@example.edu/",
    "https://localhost/admin",
    "example.edu/no-scheme",
    "",
    `https://example.edu/${"a".repeat(LIBRARY_LIMITS.url)}`,
  ])("refuses %s", (url) => {
    expect(httpsUrl(url)).toBeNull();
  });
});

describe("collection names", () => {
  it("collapses spaces and trims", () => {
    expect(CollectionNameBody.parse({ name: "  CS 135 \n  midterm " }).name).toBe("CS 135 midterm");
  });

  it("needs 1 to 80 characters", () => {
    expect(CollectionNameBody.safeParse({ name: "   " }).success).toBe(false);
    expect(CollectionNameBody.safeParse({ name: "x".repeat(81) }).success).toBe(false);
    const r = CollectionNameBody.safeParse({ name: "" });
    expect(r.success || firstIssue(r.error)).toMatch(/1 to 80/);
  });

  it("ignores an owner smuggled into the body", () => {
    const parsed = CollectionNameBody.parse({ name: "Mine", owner_id: "someone-else" });
    expect(parsed).toEqual({ name: "Mine" });
  });
});

describe("new items", () => {
  it("takes a Librarian source by id, or a link with a title", () => {
    expect(
      NewItemBody.safeParse({ kind: "resource", sourceId: "0b6f7a52-3d6c-4a8e-9a1e-2f4b5c6d7e8f" })
        .success,
    ).toBe(true);
    expect(
      NewItemBody.safeParse({ kind: "resource", title: "Lists", url: "https://x.edu" }).success,
    ).toBe(true);
    expect(NewItemBody.safeParse({ kind: "resource", url: "https://x.edu" }).success).toBe(false);
    expect(NewItemBody.safeParse({ kind: "resource", sourceId: "not-a-uuid" }).success).toBe(false);
  });

  it("needs a note's text and keeps it under the cap", () => {
    expect(NewItemBody.safeParse({ kind: "note", title: "Tips", text: "  " }).success).toBe(false);
    expect(
      NewItemBody.safeParse({
        kind: "note",
        title: "Tips",
        text: "x".repeat(LIBRARY_LIMITS.noteText + 1),
      }).success,
    ).toBe(false);
    const ok = NewItemBody.parse({ kind: "note", title: "Tips", text: "Use\u0000 accumulators" });
    expect(ok).toMatchObject({ kind: "note", text: "Use accumulators" });
  });

  it("refuses unknown kinds and over-long titles", () => {
    expect(NewItemBody.safeParse({ kind: "folder", title: "x" }).success).toBe(false);
    expect(
      NewItemBody.safeParse({ kind: "note", title: "x".repeat(201), text: "hi" }).success,
    ).toBe(false);
  });

  it("checks lessons against the Learning Studio's lesson schema", () => {
    expect(NewItemBody.safeParse({ kind: "lesson", lesson: SAMPLE_LESSON }).success).toBe(true);
    const broken = { ...SAMPLE_LESSON, scenes: [] };
    const r = LessonBody.safeParse({ lesson: broken });
    expect(r.success).toBe(false);
    if (!r.success) expect(firstIssue(r.error)).toMatch(/lesson/);
    const hostile = {
      ...SAMPLE_LESSON,
      scenes: SAMPLE_LESSON.scenes.map((s) => ({ ...s, visual: { type: "script", code: "x" } })),
    };
    expect(LessonBody.safeParse({ lesson: hostile }).success).toBe(false);
  });

  it("needs a real plan id", () => {
    expect(PlanBody.safeParse({ planId: "1" }).success).toBe(false);
  });
});

describe("item edits", () => {
  it("need something to change, within bounds", () => {
    expect(ItemPatchBody.safeParse({}).success).toBe(false);
    expect(ItemPatchBody.safeParse({ progress: { scene: 2, completed: false } }).success).toBe(
      true,
    );
    expect(ItemPatchBody.safeParse({ progress: { scene: -1, completed: false } }).success).toBe(
      false,
    );
    expect(ItemPatchBody.safeParse({ progress: { scene: 1.5, completed: true } }).success).toBe(
      false,
    );
  });
});

describe("lessons", () => {
  it("share their id with learning analytics", () => {
    expect(lessonKey(SAMPLE_LESSON)).toBe(clientLessonKey(SAMPLE_LESSON));
  });

  it("keep the notes they were made from, and the student's place", () => {
    const p = lessonPayload({
      lesson: SAMPLE_LESSON,
      chunks: SAMPLE_NOTES,
      sourceName: "  biology\nnotes.pdf ",
      progress: { scene: 2, completed: false },
    })!;
    expect(p.key).toBe(lessonKey(SAMPLE_LESSON));
    expect(p.sourceName).toBe("biology notes.pdf");
    expect(p.chunks).toHaveLength(SAMPLE_NOTES.length);
    expect(p).toMatchObject({ hasNotes: true, notesTrimmed: false, progress: { scene: 2 } });
  });

  it("clamp a place past the last scene", () => {
    const p = lessonPayload({ lesson: SAMPLE_LESSON, progress: { scene: 19, completed: false } })!;
    expect(p.progress.scene).toBe(SAMPLE_LESSON.scenes.length - 1);
    expect(p.hasNotes).toBe(false);
  });

  it("drop notes from the end to fit, and say so", () => {
    const chunks = Array.from({ length: 120 }, (_, i) => ({
      page: i + 1,
      text: `Page ${i + 1}. ${"lorem ipsum ".repeat(200)}`,
    }));
    const p = lessonPayload({ lesson: SAMPLE_LESSON, chunks })!;
    expect(p.notesTrimmed).toBe(true);
    expect(p.chunks.length).toBeGreaterThan(0);
    expect(p.chunks.length).toBeLessThan(chunks.length);
    expect(p.chunks[0]!.page).toBe(1);
    expect(toJson(p).bytes).toBeLessThanOrEqual(LIBRARY_LIMITS.payloadBytes);
  });
});

describe("text", () => {
  it("strips control characters Postgres can't keep", () => {
    expect(cleanText("a\u0000b\u0007c\n d")).toBe("abc\n d");
    expect(toJson({ t: "x\u0000y" }).text).toBe('{"t":"xy"}');
  });
});
