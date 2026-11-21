import { z } from "zod";

/**
 * The AI Learning Studio's lesson format. Gemini returns data in this shape; it is validated here
 * before anything is saved or rendered, and visuals can only name templates from the allowlists
 * below (no AI-written code, HTML or arbitrary asset paths ever reach the page).
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

export const InteractionSchema = z
  .object({
    type: z.enum(["multiple-choice", "reflection"]),
    question: text(240),
    options: z.array(text(140)).min(2).max(5).optional(),
    correctIndex: z.number().int().min(0).max(4).optional(),
    explanation: z.string().trim().max(400).optional(),
    suggestedAnswer: z.string().trim().max(400).optional(),
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
 * Validates AI output and drops anything that can't be trusted: page references outside the
 * document are removed (never invented), scene ids are made unique.
 */
export function parseLesson(data: unknown, totalPages: number): Lesson {
  const lesson = LessonSchema.parse(data);
  const seen = new Set<string>();
  lesson.scenes = lesson.scenes.map((s, i) => {
    let id = s.id.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || `scene-${i + 1}`;
    if (seen.has(id)) id = `${id}-${i + 1}`;
    seen.add(id);
    return {
      ...s,
      id,
      sourceReferences: s.sourceReferences.filter((r) => r.page >= 1 && r.page <= totalPages),
    };
  });
  return lesson;
}
