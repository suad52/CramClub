import type { Interaction, Lesson, Scene } from "./schema";

/**
 * Every lesson asks something between its sections: each scene ends with one interaction (a
 * multiple-choice or true-or-false question, or a reflection), so the student is doing, not only
 * listening. The generator is asked for one per scene (server.ts). A scene still without one (the
 * model left it out, the quiz self-check set its question aside as unreliable, or the lesson was
 * made before this rule) gets an open reflection instead: it has no answer key, so it can't teach
 * anything wrong, and it still makes the student put the section into their own words.
 */

/** The open question a scene asks when it has no question of its own. */
export function reflectionFor(scene: Pick<Scene, "title">): Interaction {
  return {
    type: "reflection",
    question: `In your own words: what's the key idea of “${scene.title}”?`,
  };
}

/** The lesson with an interaction at the end of every scene (the same lesson if it had them all). */
export function withEveryCheckpoint(lesson: Lesson): Lesson {
  if (lesson.scenes.every((s) => s.interaction)) return lesson;
  return {
    ...lesson,
    scenes: lesson.scenes.map((s) => (s.interaction ? s : { ...s, interaction: reflectionFor(s) })),
  };
}
