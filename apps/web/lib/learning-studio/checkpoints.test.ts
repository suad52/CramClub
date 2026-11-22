import { describe, expect, it } from "vitest";
import { reflectionFor, withEveryCheckpoint } from "./checkpoints";
import { SAMPLE_LESSON } from "./mockLesson";
import { LessonSchema } from "./schema";

describe("every section asks something", () => {
  it("gives each scene without a question an open reflection, and keeps the questions it has", () => {
    const out = withEveryCheckpoint(SAMPLE_LESSON);
    expect(out.scenes).toHaveLength(SAMPLE_LESSON.scenes.length);
    out.scenes.forEach((scene, i) => {
      const before = SAMPLE_LESSON.scenes[i]!.interaction;
      expect(scene.interaction).toBeTruthy();
      if (before) expect(scene.interaction).toBe(before);
      else expect(scene.interaction).toEqual(reflectionFor(scene));
    });
  });

  it("a reflection has no answer key to get wrong, and still makes a valid lesson", () => {
    const q = reflectionFor({ title: "The electron transport chain" });
    expect(q).toMatchObject({ type: "reflection" });
    expect(q.question).toContain("The electron transport chain");
    expect(q.correctIndex).toBeUndefined();
    expect(q.options).toBeUndefined();
    // The longest scene title still fits the question's limit.
    const long = { ...SAMPLE_LESSON.scenes[0]!, title: "x".repeat(80), interaction: null };
    expect(() =>
      LessonSchema.parse(withEveryCheckpoint({ ...SAMPLE_LESSON, scenes: [long, long] })),
    ).not.toThrow();
  });

  it("leaves a lesson that already asks something everywhere exactly as it was", () => {
    const full = withEveryCheckpoint(SAMPLE_LESSON);
    expect(withEveryCheckpoint(full)).toBe(full);
  });
});
