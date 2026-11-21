import { describe, expect, it } from "vitest";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "./mockLesson";
import { VisualSchema, parseLesson } from "./schema";
import {
  captionsFromAlignment,
  chunkPages,
  estimateCaptions,
  splitSentences,
  topChunks,
} from "./text";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("lesson validation", () => {
  it("accepts the sample lesson", () => {
    expect(parseLesson(clone(SAMPLE_LESSON), 4).scenes).toHaveLength(6);
  });

  it("drops page references outside the document instead of trusting them", () => {
    const l = clone(SAMPLE_LESSON);
    l.scenes[0]!.sourceReferences = [{ page: 1 }, { page: 99 }];
    expect(parseLesson(l, 4).scenes[0]!.sourceReferences.map((r) => r.page)).toEqual([1]);
  });

  it("falls back to the default template when the AI names an unknown one", () => {
    const l = clone(SAMPLE_LESSON);
    l.scenes[1]!.visual.templateId = "<script>";
    expect(parseLesson(l, 4).scenes[1]!.visual.templateId).toBe("flow");
  });

  it("rejects a multiple-choice question whose answer isn't one of the options", () => {
    const l = clone(SAMPLE_LESSON);
    l.scenes[4]!.interaction!.correctIndex = 4;
    expect(() => parseLesson(l, 4)).toThrow();
  });

  it("replaces a process visual without steps with one that renders", () => {
    const l = clone(SAMPLE_LESSON);
    l.scenes[1]!.visual.steps = [];
    const visual = parseLesson(l, 4).scenes[1]!.visual;
    expect(visual.type).not.toBe("process");
    expect(VisualSchema.safeParse(visual).success).toBe(true);
  });

  it("still rejects a lesson with no scenes", () => {
    expect(() => parseLesson({ ...clone(SAMPLE_LESSON), scenes: [] }, 4)).toThrow();
  });

  it("discards any self-check result the generator claims for itself", () => {
    const l = clone(SAMPLE_LESSON) as Record<string, unknown> & typeof SAMPLE_LESSON;
    l.quizCheck = {
      checked: true,
      questions: 1,
      verified: 1,
      fixed: 0,
      dropped: 0,
      unsure: 0,
      from: "notes",
    };
    l.scenes[4]!.interaction!.check = "verified";
    const out = parseLesson(l, 4);
    expect(out.quizCheck).toBeUndefined();
    expect(out.scenes[4]!.interaction!.check).toBeUndefined();
    // The generator's hint and quote are kept (the quote is grounded later, by the check).
    expect(out.scenes[4]!.interaction).toMatchObject({
      hint: SAMPLE_LESSON.scenes[4]!.interaction!.hint,
      quote: SAMPLE_LESSON.scenes[4]!.interaction!.quote,
    });
    expect(out.scenes[0]!.interaction).toBeUndefined();
  });

  it("drops a malformed claimed check, hint or quote instead of failing the lesson", () => {
    const l = clone(SAMPLE_LESSON) as unknown as Record<string, unknown> & {
      scenes: Record<string, unknown>[];
    };
    l.quizCheck = { checked: "yes" };
    l.scenes[4]!.interaction = {
      ...(l.scenes[4]!.interaction as object),
      check: "approved",
      hint: 42,
      quote: ["not", "text"],
    };
    const q = parseLesson(l, 4).scenes[4]!.interaction!;
    expect(q.check).toBeUndefined();
    expect(q.hint).toBeUndefined();
    expect(q.quote).toBeUndefined();
    expect(q.correctIndex).toBe(2);
  });

  it("makes scene ids safe and unique", () => {
    const l = clone(SAMPLE_LESSON);
    l.scenes[1]!.id = "Intro!";
    l.scenes[0]!.id = "intro-";
    const ids = parseLesson(l, 4).scenes.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  });
});

describe("notes and captions", () => {
  it("chunks pages and keeps their page numbers", () => {
    const chunks = chunkPages(["a ".repeat(1500), "short page"], 1200);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.at(-1)).toEqual({ page: 2, text: "short page" });
    expect(chunks.every((c) => c.text.length <= 1200)).toBe(true);
  });

  it("finds the relevant part of the notes", () => {
    expect(topChunks(SAMPLE_NOTES, "where is ATP synthase", 1)[0]!.page).toBe(4);
    expect(topChunks(SAMPLE_NOTES, "what happens in the cytoplasm", 1)[0]!.page).toBe(2);
  });

  it("splits narration into sentence captions with rising times", () => {
    const caps = estimateCaptions("First sentence. Second one! Third?");
    expect(caps.map((c) => c.text)).toEqual(["First sentence.", "Second one!", "Third?"]);
    for (let i = 1; i < caps.length; i++) expect(caps[i]!.startMs).toBe(caps[i - 1]!.endMs);
    expect(splitSentences("No final stop")).toEqual(["No final stop"]);
  });

  it("times captions from per-character alignment", () => {
    const text = "Hi there. Bye.";
    const starts = [...text].map((_, i) => i * 0.1);
    const ends = starts.map((s) => s + 0.1);
    const caps = captionsFromAlignment(text, starts, ends);
    expect(caps).toEqual([
      { text: "Hi there.", startMs: 0, endMs: 900 },
      { text: "Bye.", startMs: 1000, endMs: 1400 },
    ]);
  });
});

describe("tidyLessonJson", () => {
  it("trims an over-long hint or quote instead of failing the lesson", async () => {
    const { tidyLessonJson } = await import("./schema");
    const l = clone(SAMPLE_LESSON);
    l.scenes[4]!.interaction!.hint = "h".repeat(260);
    l.scenes[4]!.interaction!.quote = "q ".repeat(150);
    const q = parseLesson(tidyLessonJson(l), 4).scenes[4]!.interaction!;
    expect(q.hint!.length).toBeLessThanOrEqual(200);
    expect(q.quote!.length).toBeLessThanOrEqual(200);
  });

  it("trims long quotes and replaces a half-filled visual instead of failing", async () => {
    const { tidyLessonJson } = await import("./schema");
    const out = tidyLessonJson({
      scenes: [
        {
          title: "Inhibition",
          visual: { type: "comparison", labels: ["Km up | Vmax same"] },
          sourceReferences: [{ page: 1, excerpt: "x".repeat(260) }],
        },
      ],
    }) as { scenes: { visual: unknown; sourceReferences: { excerpt: string }[] }[] };
    const scene = out.scenes[0]!;
    expect(scene.sourceReferences[0]!.excerpt.length).toBeLessThanOrEqual(200);
    expect(VisualSchema.safeParse(scene.visual).success).toBe(true);
  });
});
