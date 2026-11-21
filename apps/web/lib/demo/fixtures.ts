import type { Chunk, Lesson } from "@/lib/learning-studio/schema";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "@/lib/learning-studio/mockLesson";

/*
 * The judge demo's saved examples: what it shows, clearly marked as saved, when Ms. Fenwick or a
 * lesson takes longer than DEMO_FALLBACK_MS or fails (lib/demo/settings.ts). Both are static and
 * hand-written ahead of time, never presented as made for the request in front of the judge.
 */

/** A finished lesson: the built-in cellular-respiration sample, titled as a saved example. */
export const SAVED_LESSON: Lesson = {
  ...SAMPLE_LESSON,
  title: `Saved example: ${SAMPLE_LESSON.title}`,
};
export const SAVED_LESSON_NOTES: Chunk[] = SAMPLE_NOTES;
/** Its sourceId on a board (the built-in sample's own, so no saved-lesson progress is written). */
export const SAVED_LESSON_SOURCE = "sample";

export interface SavedSource {
  title: string;
  url: string;
  domain: string;
  /** What it's good for, in a line. */
  note: string;
}

/** One prepared research answer from Ms. Fenwick, on the same topic as the saved lesson. */
export const SAVED_ANSWER = {
  request: "Help me understand cellular respiration for my biology test",
  overview:
    "Cellular respiration is how a cell releases the energy stored in glucose and captures it as ATP. It runs in three stages: glycolysis in the cytoplasm splits glucose into two pyruvate (a net 2 ATP), the Krebs cycle in the mitochondria loads the carriers NADH and FADH2, and the electron transport chain uses them to pump protons so ATP synthase can make most of the ATP. Oxygen is the final electron acceptor, which is why the whole process needs it.",
  keyConcepts: [
    "Glycolysis: net 2 ATP, no oxygen needed",
    "Krebs cycle: loads NADH and FADH2",
    "Electron transport chain: most of the ATP",
    "Oxygen as the final electron acceptor",
  ],
  sources: [
    {
      title: "Cellular respiration",
      url: "https://en.wikipedia.org/wiki/Cellular_respiration",
      domain: "en.wikipedia.org",
      note: "The whole process on one page, with the overall equation.",
    },
    {
      title: "Glycolysis",
      url: "https://en.wikipedia.org/wiki/Glycolysis",
      domain: "en.wikipedia.org",
      note: "Step by step through the first stage and its ATP balance.",
    },
    {
      title: "Electron transport chain",
      url: "https://en.wikipedia.org/wiki/Electron_transport_chain",
      domain: "en.wikipedia.org",
      note: "How the proton gradient drives ATP synthase.",
    },
  ] satisfies SavedSource[],
} as const;
