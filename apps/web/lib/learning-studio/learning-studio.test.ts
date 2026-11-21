import { describe, expect, it } from "vitest";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "./mockLesson";
import { parseLesson } from "./schema";
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

  it("rejects a process visual without steps", () => {
    const l = clone(SAMPLE_LESSON);
    l.scenes[1]!.visual.steps = [];
    expect(() => parseLesson(l, 4)).toThrow();
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
