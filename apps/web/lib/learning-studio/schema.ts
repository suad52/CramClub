import { z } from "zod";

/**
 * The AI Learning Studio's lesson format. Gemini returns data in this shape; it is validated here
 * before anything is saved or rendered, and visuals can only name templates from the allowlists
 * below (no AI-written code, HTML or arbitrary asset paths ever reach the page).
 *
 * Knowledge checks carry a `hint` (shown after a wrong first try, before the second) and a
 * `quote` (a few words copied from the source that back the answer, shown after answering).
 * `check` on a question and `quizCheck` on the lesson are written only by the server's quiz
 * self-check (quizCheck.ts); anything the generator claims for them is stripped in parseLesson.
 */

export const LEVELS = ["beginner", "high-school", "university", "advanced"] as const;
export const LENGTHS = ["short", "standard", "detailed"] as const;
export type Level = (typeof LEVELS)[number];
export type LessonLength = (typeof LENGTHS)[number];

/** Scenes per lesson length. */
export const SCENE_COUNT: Record<LessonLength, [number, number]> = {
  short: [3, 4],
  standard: [5, 6],
  detailed: [7, 9],
};

/** Visual kinds and the templates each may use (the first is the default). */
export const VISUAL_TEMPLATES = {
  concept: ["hub", "grid"],
  process: ["flow", "cycle", "timeline"],
  comparison: ["two-column"],
  diagram: ["labeled"],
  equation: ["equation"],
  image: ["description"],
} as const;
export type VisualType = keyof typeof VISUAL_TEMPLATES;
export const VISUAL_TYPES = Object.keys(VISUAL_TEMPLATES) as VisualType[];

const text = (max: number) => z.string().trim().min(1).max(max);

export const StepSchema = z.object({
  label: text(60),
  description: z.string().trim().max(200).optional(),
});

/** One flat object for every visual kind (simpler for Gemini's JSON mode); fields per kind are checked below. */
export const VisualSchema = z
  .object({
    type: z.enum(VISUAL_TYPES as [VisualType, ...VisualType[]]),
    templateId: z.string().max(40).optional(),
    title: z.string().trim().max(80).optional(),
    labels: z.array(text(60)).max(8).optional(),
    steps: z.array(StepSchema).max(8).optional(),
    /** Comparison columns: [left heading, right heading]; rows go in labels as "left | right". */
    columns: z.array(text(40)).length(2).optional(),
    expression: z.string().trim().max(200).optional(),
    explanation: z.string().trim().max(300).optional(),
    altText: z.string().trim().max(300).optional(),
  })
  .transform((v) => {
    const allowed: readonly string[] = VISUAL_TEMPLATES[v.type];
    return { ...v, templateId: allowed.includes(v.templateId ?? "") ? v.templateId! : allowed[0]! };
  })
  .refine(
    (v) =>
      (v.type !== "process" || (v.steps?.length ?? 0) >= 2) &&
      (v.type !== "concept" || (v.labels?.length ?? 0) >= 2) &&
      (v.type !== "diagram" || (v.labels?.length ?? 0) >= 2) &&
      (v.type !== "comparison" ||
        ((v.columns?.length ?? 0) === 2 && (v.labels?.length ?? 0) >= 1)) &&
      (v.type !== "equation" || !!v.expression) &&
      (v.type !== "image" || !!v.altText),
    { message: "visual is missing the fields its type needs" },
  );

/** What the quiz self-check concluded about one multiple-choice question. */
export const QUESTION_CHECKS = ["verified", "fixed", "unsure"] as const;
export type QuestionCheck = (typeof QUESTION_CHECKS)[number];

export const InteractionSchema = z
  .object({
    type: z.enum(["multiple-choice", "reflection"]),
    question: text(240),
    options: z.array(text(140)).min(2).max(5).optional(),
    correctIndex: z.number().int().min(0).max(4).optional(),
    explanation: z.string().trim().max(400).optional(),
    suggestedAnswer: z.string().trim().max(400).optional(),
    /** One sentence that nudges toward the answer without giving it away. */
    hint: z.string().trim().max(200).optional(),
    /** Up to QUOTE_MAX_WORDS words copied word for word from the source, backing the answer. */
    quote: z.string().trim().max(200).optional(),
    /**
     * Where this question's quote comes from, when a lesson mixes the student's notes with web
     * pages (lib/learning-studio/quizCheck.ts labelNotesQuotes). Unset: the lesson's quizCheck.from.
     */
    quoteFrom: z.enum(["notes", "sources"]).optional(),
    /**
     * Set by the self-check only: "verified" (an independent re-answer agreed), "fixed" (re-keyed
     * to the answer the source backs) or "unsure" (kept, flagged, so the lesson still has a check).
     */
    check: z.enum(QUESTION_CHECKS).optional(),
  })
  .refine(
    (q) =>
      q.type !== "multiple-choice" ||
      (q.options !== undefined &&
        q.correctIndex !== undefined &&
        q.correctIndex < q.options.length),
    { message: "a multiple-choice question needs options and a valid correctIndex" },
  );

export const SourceRefSchema = z.object({
  page: z.number().int().min(1),
  excerpt: z.string().trim().max(200).optional(),
});

export const SceneSchema = z.object({
  id: z.string().trim().min(1).max(40),
  title: text(80),
  narration: text(1400),
  visual: VisualSchema,
  interaction: InteractionSchema.nullish(),
  sourceReferences: z.array(SourceRefSchema).max(6),
});

/** The quiz self-check's result for a whole lesson (counts are multiple-choice questions). */
export const QuizCheckSchema = z.object({
  /** True when the second, independent pass ran and its verdicts were applied. */
  checked: z.boolean(),
  /** Multiple-choice questions the generator wrote. */
  questions: z.number().int().min(0),
  verified: z.number().int().min(0),
  fixed: z.number().int().min(0),
  /** Removed: the source didn't back the keyed answer. */
  dropped: z.number().int().min(0),
  /** Flagged but kept, so the lesson still has a knowledge check. */
  unsure: z.number().int().min(0),
  /** What the quotes come from: the student's notes, or web sources (cloud lessons). */
  from: z.enum(["notes", "sources"]),
});
export type QuizCheck = z.infer<typeof QuizCheckSchema>;

export const LessonSchema = z.object({
  title: text(100),
  subject: text(60),
  description: text(400),
  estimatedMinutes: z.number().min(1).max(30),
  difficulty: z.enum(LEVELS),
  learningObjectives: z.array(text(160)).min(1).max(6),
  /** Gaps, contradictions or ambiguity the model found in the notes. */
  warnings: z.array(text(240)).max(5).optional(),
  scenes: z.array(SceneSchema).min(2).max(10),
  /** Absent on lessons made before the self-check existed (or not yet checked). */
  quizCheck: QuizCheckSchema.optional(),
});

export type Visual = z.infer<typeof VisualSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type Scene = z.infer<typeof SceneSchema>;
export type Lesson = z.infer<typeof LessonSchema>;

/** A page-numbered piece of the student's notes, used for grounding and citations. */
export interface Chunk {
  page: number;
  text: string;
}

/**
 * Small, safe repairs before validation, so one over-long quote or one half-filled visual doesn't
 * throw away a whole lesson: quotes are trimmed to fit, and a visual missing the fields its type
 * needs becomes a simpler one built from what it does have (or an illustration of the scene).
 */
export function tidyLessonJson(data: unknown): unknown {
  if (!data || typeof data !== "object") return data;
  const raw = data as { scenes?: unknown };
  if (!Array.isArray(raw.scenes)) return data;
  const clip = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length > max
      ? `${v
          .trim()
          .slice(0, max - 1)
          .trimEnd()}…`
      : v;
  const scenes = raw.scenes.map((scene: unknown) => {
    if (!scene || typeof scene !== "object") return scene;
    const sc = { ...(scene as Record<string, unknown>) };
    if (sc.interaction && typeof sc.interaction === "object") {
      const q = { ...(sc.interaction as Record<string, unknown>) };
      // Optional extras: a malformed one is dropped, not allowed to fail the whole lesson.
      q.hint = typeof q.hint === "string" ? clip(q.hint, 200) : undefined;
      q.quote = typeof q.quote === "string" ? clip(q.quote, 200) : undefined;
      // Only the self-check may set this (parseLesson): whatever the generator claims is ignored.
      delete q.check;
      sc.interaction = q;
    }
    if (Array.isArray(sc.sourceReferences))
      sc.sourceReferences = sc.sourceReferences.map((r: unknown) =>
        r && typeof r === "object"
          ? { ...(r as object), excerpt: clip((r as { excerpt?: unknown }).excerpt, 200) }
          : r,
      );
    if (sc.visual && typeof sc.visual === "object" && !VisualSchema.safeParse(sc.visual).success) {
      const v = sc.visual as Record<string, unknown>;
      const labels = Array.isArray(v.labels) ? v.labels : [];
      const steps = Array.isArray(v.steps) ? v.steps : [];
      const title = typeof v.title === "string" ? v.title : undefined;
      const fallbacks = [
        { type: "process", title, steps },
        { type: "concept", title, labels },
        {
          type: "image",
          title,
          altText: clip(
            (typeof v.altText === "string" && v.altText) ||
              (typeof v.explanation === "string" && v.explanation) ||
              (typeof sc.title === "string" && sc.title) ||
              "An illustration of this scene",
            300,
          ),
        },
      ];
      sc.visual = fallbacks.find((f) => VisualSchema.safeParse(f).success) ?? sc.visual;
    }
    return sc;
  });
  // The lesson-level self-check result is the server's to write, never the generator's.
  const out: Record<string, unknown> = { ...raw, scenes };
  delete out.quizCheck;
  return out;
}

/**
 * Validates AI output and drops anything that can't be trusted: page references outside the
 * document are removed (never invented), scene ids are made unique, and any self-check result
 * the model wrote itself is discarded.
 */
export function parseLesson(data: unknown, totalPages: number): Lesson {
  const lesson = LessonSchema.parse(tidyLessonJson(data));
  // The generator can't vouch for its own quiz: only the self-check (quizCheck.ts) sets these.
  delete lesson.quizCheck;
  const seen = new Set<string>();
  lesson.scenes = lesson.scenes.map((s, i) => {
    let id = s.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || `scene-${i + 1}`;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    const interaction = s.interaction && { ...s.interaction };
    if (interaction) {
      delete interaction.check;
      delete interaction.quoteFrom;
    }
    return {
      ...s,
      id,
      ...(interaction && { interaction }),
      sourceReferences: s.sourceReferences.filter((r) => r.page >= 1 && r.page <= totalPages),
    };
  });
  return lesson;
}
