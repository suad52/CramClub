import "server-only";
import { createHash } from "node:crypto";
import { ThinkingLevel } from "@google/genai";
import { ZodError } from "zod";
import {
  TEXT_FALLBACK_MODEL,
  TEXT_MODEL,
  getGemini,
  isTransient,
  withTimeout,
} from "@/lib/ai/gemini";
import {
  QUIZ_CHECK_JSON_SCHEMA,
  QUOTE_MAX_WORDS,
  applyQuizCheck,
  describeQuizCheck,
  parseVerdicts,
  quizCheckPrompt,
  quizItems,
} from "./quizCheck";
import {
  type Chunk,
  type Lesson,
  type LessonLength,
  type Level,
  type QuizCheck,
  SCENE_COUNT,
  VISUAL_TEMPLATES,
  parseLesson,
} from "./schema";

/**
 * Server side of the AI Learning Studio: PDF text, lesson generation, the quiz self-check (one
 * extra Gemini call per lesson, see quizCheck.ts), the grounded teacher, narration.
 */

export class StudioError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "StudioError";
  }
}

export const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 120;
/** How much of the notes goes into one generation prompt. */
const PROMPT_CHAR_BUDGET = 60_000;

/** Extracts each page's text. Rejects protected, broken or image-only (scanned) PDFs with a clear message. */
export async function extractPdf(data: Uint8Array): Promise<string[]> {
  const { extractText, getDocumentProxy } = await import("unpdf");
  let pages: string[];
  try {
    const pdf = await getDocumentProxy(data);
    if (pdf.numPages > MAX_PAGES)
      throw new StudioError(`That PDF has ${pdf.numPages} pages; the limit is ${MAX_PAGES}.`);
    pages = (await extractText(pdf, { mergePages: false })).text;
  } catch (err) {
    if (err instanceof StudioError) throw err;
    const name = (err as Error).name;
    if (name === "PasswordException")
      throw new StudioError("That PDF is password-protected. Remove the password and try again.");
    throw new StudioError("That file couldn't be read as a PDF. It may be damaged.");
  }
  const chars = pages.reduce((n, p) => n + p.trim().length, 0);
  if (chars < 200 || chars / pages.length < 30) {
    throw new StudioError(
      "This PDF has little or no selectable text. It looks scanned, and reading scans (OCR) isn't supported yet.",
    );
  }
  return pages;
}

/** The notes as page-tagged text, trimmed evenly to fit the prompt budget. */
function notesForPrompt(pages: readonly string[]): string {
  const total = pages.reduce((n, p) => n + p.length, 0);
  const keep = Math.min(1, PROMPT_CHAR_BUDGET / Math.max(1, total));
  return pages
    .map((p, i) => `[page ${i + 1}]\n${p.slice(0, Math.floor(p.length * keep)).trim()}`)
    .filter((p) => p.length > 10)
    .join("\n\n");
}

/** Lessons are long structured outputs: a fast model by default (GEMINI_LESSON_MODEL to override). */
const LESSON_MODEL = process.env.GEMINI_LESSON_MODEL || TEXT_MODEL;

const STEP = {
  type: "object",
  properties: { label: { type: "string" }, description: { type: "string" } },
  required: ["label"],
};
const LESSON_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    subject: { type: "string" },
    description: { type: "string" },
    estimatedMinutes: { type: "number" },
    difficulty: { type: "string", enum: ["beginner", "high-school", "university", "advanced"] },
    learningObjectives: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    scenes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          narration: { type: "string" },
          visual: {
            type: "object",
            properties: {
              type: { type: "string", enum: Object.keys(VISUAL_TEMPLATES) },
              templateId: { type: "string" },
              title: { type: "string" },
              labels: { type: "array", items: { type: "string" } },
              steps: { type: "array", items: STEP },
              columns: { type: "array", items: { type: "string" } },
              expression: { type: "string" },
              explanation: { type: "string" },
              altText: { type: "string" },
            },
            required: ["type", "title"],
          },
          interaction: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["multiple-choice", "reflection"] },
              question: { type: "string" },
              options: { type: "array", items: { type: "string" } },
              correctIndex: { type: "integer" },
              explanation: { type: "string" },
              suggestedAnswer: { type: "string" },
              hint: { type: "string" },
              quote: { type: "string" },
            },
            required: ["type", "question"],
          },
          sourceReferences: {
            type: "array",
            items: {
              type: "object",
              properties: { page: { type: "integer" }, excerpt: { type: "string" } },
              required: ["page"],
            },
          },
        },
        required: ["id", "title", "narration", "visual", "sourceReferences"],
      },
    },
  },
  required: [
    "title",
    "subject",
    "description",
    "estimatedMinutes",
    "difficulty",
    "learningObjectives",
    "scenes",
  ],
};

function lessonPrompt(o: {
  title: string;
  level: Level;
  length: LessonLength;
  pages: readonly string[];
  guidance?: string;
}) {
  const [lo, hi] = SCENE_COUNT[o.length];
  const templates = Object.entries(VISUAL_TEMPLATES)
    .map(([t, ids]) => `${t}: ${ids.join(", ")}`)
    .join("; ");
  return `You are an excellent teacher making a short narrated lesson from a student's own notes.
${o.title ? `The student calls these notes: "${o.title}".` : ""}
Level: ${o.level}. Make ${lo} to ${hi} scenes, each 30–90 seconds of narration (about 70–200 words).

Rules:
- Use the notes as the primary source. Don't add unrelated facts. If you must add background to make
  something understandable, say so in the narration ("beyond your notes, ...").
- Explain clearly at the chosen level, in natural spoken language: no headings, bullet symbols,
  citations or formatting read aloud.
- Order the key concepts logically. First scene introduces the topic; last scene sums up.
- Give each scene ONE visual that genuinely helps, using only these types and templateIds: ${templates}.
  concept needs 2–8 short labels; process needs 2–8 steps (label + optional short description);
  comparison needs two column headings in "columns" and rows in "labels" written "left | right";
  diagram needs 2–8 labels; equation needs "expression" (plain text, no LaTeX); image needs "altText"
  describing an illustration. Keep labels short (under 6 words).
- Include at least one knowledge check: a multiple-choice question (3–4 options, correctIndex 0-based,
  explanation citing the page) on a scene where it fits. You may add one reflection question.
  Each question has exactly one right option that the notes clearly support. Give every
  multiple-choice question a "hint": one short sentence that points toward the right idea without
  giving the answer away (it is shown after a wrong first try). Give every question a "quote": up
  to ${QUOTE_MAX_WORDS} words copied exactly from the notes that back the answer (one unbroken
  stretch, no ellipsis, no changes).
- The narration must make sense without its question: questions appear on screen after the
  narration ends, so don't refer to them ("pick your answer below").
- sourceReferences: the page numbers ([page N] tags) that support the scene, with a short excerpt
  copied from that page. Never invent page numbers. Use only pages that exist.
${o.guidance ? `- ${o.guidance}\n` : ""}- If the notes are ambiguous, contradictory or incomplete, say so briefly in "warnings".
- Scene ids are short slugs like "intro" or "krebs-cycle".

The notes:
${notesForPrompt(o.pages)}`;
}

async function generateJson(
  prompt: string,
  timeoutMs: number,
  first: string = LESSON_MODEL,
): Promise<unknown> {
  const ai = getGemini();
  const call = (model: string) =>
    withTimeout(
      ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: LESSON_JSON_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      timeoutMs,
      "Making the lesson",
    );
  const t0 = Date.now();
  let res;
  let model = first;
  try {
    res = await call(model);
  } catch (err) {
    const backup = model === TEXT_MODEL ? TEXT_FALLBACK_MODEL : TEXT_MODEL;
    if (!isTransient(err) || backup === model) throw err;
    console.info(
      `[learning-studio] ${model} unavailable (${(err as { status?: number }).status}); trying ${backup}`,
    );
    model = backup;
    res = await call(model);
  }
  console.info(
    `[learning-studio] lesson JSON from ${model} in ${Math.round((Date.now() - t0) / 1000)}s`,
  );
  return JSON.parse(res.text ?? "");
}

/** Gemini → validated lesson. Invalid output gets one repair attempt, then a clear error. */
export async function generateLesson(o: {
  title: string;
  level: Level;
  length: LessonLength;
  pages: readonly string[];
  /** One extra rule for the generator (e.g. which pages are web sources and how to use them). */
  guidance?: string;
  /** Try this model first (e.g. a faster one); the usual fallback still applies. */
  model?: string;
}): Promise<Lesson> {
  const prompt = lessonPrompt(o);
  const first = await generateJson(prompt, 90_000, o.model);
  try {
    return parseLesson(first, o.pages.length);
  } catch (err) {
    if (!(err instanceof ZodError)) throw err;
    const problems = err.issues
      .slice(0, 8)
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("\n");
    console.info(
      `[learning-studio] lesson failed validation (${err.issues.length} issues); repairing once\n${problems}`,
    );
    const repaired = await generateJson(
      `${prompt}\n\nYour previous answer didn't match the required format. Fix these problems and answer again:\n${problems}\n\nPrevious answer:\n${JSON.stringify(first).slice(0, 20_000)}`,
      90_000,
      o.model,
    );
    try {
      return parseLesson(repaired, o.pages.length);
    } catch (again) {
      if (again instanceof ZodError)
        console.info(
          `[learning-studio] repair failed too: ${again.issues
            .slice(0, 8)
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; ")}`,
        );
      throw new StudioError(
        "The librarian couldn't build a valid lesson from these notes. Try again, or try a shorter lesson.",
        502,
      );
    }
  }
}

/** The self-check's model (a quick one: it reads the notes and answers a few questions). */
const QUIZ_CHECK_MODEL = process.env.GEMINI_QUIZ_CHECK_MODEL || TEXT_FALLBACK_MODEL;

/**
 * The quiz self-check: ONE batched Gemini call re-answers every multiple-choice question from the
 * source alone (no answer key in the prompt) and the verdicts are applied (quizCheck.ts). Fails
 * open: on any error or timeout the quiz is kept as written, with quizCheck.checked false. Never
 * throws. `pages` are what the lesson was made from (notes, or a cloud lesson's web sources).
 */
export async function checkLessonQuiz(
  lesson: Lesson,
  pages: readonly string[],
  o: { from: QuizCheck["from"]; model?: string; timeoutMs?: number },
): Promise<Lesson> {
  const items = quizItems(lesson);
  if (!items.length) return applyQuizCheck(lesson, null, pages, o.from);
  const model = o.model || QUIZ_CHECK_MODEL;
  const t0 = Date.now();
  let checked: Lesson;
  try {
    const res = await withTimeout(
      getGemini().models.generateContent({
        model,
        contents: [
          { role: "user", parts: [{ text: quizCheckPrompt(items, notesForPrompt(pages)) }] },
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: QUIZ_CHECK_JSON_SCHEMA,
          // Checking, not writing: as repeatable as the model allows (a call that stalls at a low
          // temperature just times out, and the quiz ships as written).
          temperature: 0.1,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      o.timeoutMs ?? 40_000,
      "Checking the quiz",
    );
    const verdicts = parseVerdicts(JSON.parse(res.text ?? ""), items);
    if (!verdicts) throw Object.assign(new Error("no usable verdicts"), { name: "NoVerdicts" });
    checked = applyQuizCheck(lesson, verdicts, pages, o.from);
  } catch (err) {
    // Only the error's kind is logged: never the notes, the quiz or a provider's raw reply.
    console.info(
      `[learning-studio] quiz check skipped (${(err as Error)?.name ?? "error"}); keeping the quiz as written`,
    );
    return applyQuizCheck(lesson, null, pages, o.from);
  }
  console.info(
    `[learning-studio] ${describeQuizCheck(checked.quizCheck)} (${model}, ${Math.round((Date.now() - t0) / 1000)}s)`,
  );
  return checked;
}

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    pages: { type: "array", items: { type: "integer" } },
    fromNotes: { type: "boolean" },
  },
  required: ["answer", "pages", "fromNotes"],
};

/** The AI teacher: answers from the retrieved chunks of the student's notes and the current scene. */
export async function answerQuestion(o: {
  question: string;
  lessonTitle: string;
  scene: { title: string; narration: string; visual: string };
  chunks: Chunk[];
}): Promise<{ answer: string; pages: number[] }> {
  const notes = o.chunks.map((c) => `[page ${c.page}] ${c.text}`).join("\n\n");
  const prompt = `You are Ms. Fenwick, the library's friendly teacher, helping a student with their lesson "${o.lessonTitle}".
They are on the scene "${o.scene.title}" (visual: "${o.scene.visual}"). Its narration:
${o.scene.narration}

Relevant parts of the student's notes:
${notes || "(no matching notes found)"}

Answer the student's question in under 150 words, clearly and kindly. Base it on the notes and
put the pages you used in "pages". If the notes don't cover it, say "Your notes don't cover this"
and give a brief, clearly labelled general explanation (set fromNotes false). Never invent page
numbers. Plain text only, no markdown.

Question: ${o.question}`;
  const ai = getGemini();
  const call = (model: string) =>
    withTimeout(
      ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: ANSWER_SCHEMA,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
      30_000,
      "Answering",
    );
  let res;
  try {
    res = await call(TEXT_MODEL);
  } catch (err) {
    if (!isTransient(err) || TEXT_FALLBACK_MODEL === TEXT_MODEL) throw err;
    res = await call(TEXT_FALLBACK_MODEL);
  }
  const data = JSON.parse(res.text ?? "{}") as { answer?: unknown; pages?: unknown };
  const valid = new Set(o.chunks.map((c) => c.page));
  return {
    answer:
      typeof data.answer === "string"
        ? data.answer.trim().slice(0, 1500)
        : "I couldn't answer that just now.",
    pages: Array.isArray(data.pages)
      ? [...new Set(data.pages.filter((p): p is number => typeof p === "number" && valid.has(p)))]
      : [],
  };
}

const ttsCache = new Map<
  string,
  { audio: string; alignment: { starts: number[]; ends: number[] } | null }
>();
const TTS_CACHE_MAX = 200;

export class TtsNotConfiguredError extends Error {}

/** ElevenLabs narration with character timings, cached by text + voice + model. */
/** ElevenLabs speech (with word timings). `voiceId` overrides the narrator (e.g. the Librarian). */
export async function synthesize(text: string, voiceId?: string) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new TtsNotConfiguredError("ELEVENLABS_API_KEY is not set");
  // Default narrator: "Sarah", a premade voice free plans can use through the API (library voices
  // such as "Rachel" answer 402 paid_plan_required on a free plan).
  const voice = voiceId || process.env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL";
  const model = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  const id = createHash("sha256").update(`${voice}|${model}|${text}`).digest("hex");
  const hit = ttsCache.get(id);
  if (hit) return hit;
  const res = await withTimeout(
    fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/with-timestamps`,
      {
        method: "POST",
        headers: { "xi-api-key": key, "content-type": "application/json" },
        body: JSON.stringify({ text, model_id: model }),
      },
    ),
    45_000,
    "Narration",
  );
  if (!res.ok) throw Object.assign(new Error(`ElevenLabs ${res.status}`), { status: res.status });
  const data = (await res.json()) as {
    audio_base64: string;
    alignment?: {
      character_start_times_seconds: number[];
      character_end_times_seconds: number[];
    } | null;
  };
  const out = {
    audio: data.audio_base64,
    alignment: data.alignment
      ? {
          starts: data.alignment.character_start_times_seconds,
          ends: data.alignment.character_end_times_seconds,
        }
      : null,
  };
  if (ttsCache.size >= TTS_CACHE_MAX) ttsCache.delete(ttsCache.keys().next().value!);
  ttsCache.set(id, out);
  return out;
}
