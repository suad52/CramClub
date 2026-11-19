import "server-only";
import { GoogleGenAI, ThinkingLevel } from "@google/genai";

/**
 * Gemini calls for the AI whiteboard. Server-only: the API key never reaches the browser.
 *
 * - Reading + answering uses a fast multimodal model (free tier available).
 * - Writing the answer "by hand" uses an image-editing model, which needs a Gemini key with
 *   billing enabled. Without it the client falls back to a handwriting font.
 */

// Gemini 4 Hydrogen answered in ~2 s in testing (Nov 2026) while the 3.x Flash models timed out;
// 3.5 Flash-Lite is the automatic backup when the first choice is overloaded.
export const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || "gemini-4-hydrogen";
export const TEXT_FALLBACK_MODEL =
  process.env.GEMINI_TEXT_FALLBACK_MODEL || "gemini-3.5-flash-lite";
export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1";
/** Set AI_HANDWRITING=off to always use the handwriting font (no image model costs). */
export const HANDWRITING_ENABLED = (process.env.AI_HANDWRITING ?? "on").toLowerCase() !== "off";
/** Reading a board should be quick; image generation is slower. */
const SOLVE_TIMEOUT_MS = 25_000;
const HANDWRITE_TIMEOUT_MS = 60_000;

/** Thrown when Gemini doesn't answer in time. Carries status 504 like Google's own timeouts. */
export class AiTimeoutError extends Error {
  readonly status = 504;
  constructor(what: string) {
    super(`${what} took too long`);
    this.name = "AiTimeoutError";
  }
}

/** Rejects with {@link AiTimeoutError} if `promise` doesn't settle within `ms`. */
export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiTimeoutError(what)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Errors worth retrying on another model: overloaded, rate-limited, timed out or unavailable. */
export function isTransient(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  return status === 429 || status === 500 || status === 503 || status === 504;
}

export class AiNotConfiguredError extends Error {
  constructor() {
    super("GEMINI_API_KEY is not set");
    this.name = "AiNotConfiguredError";
  }
}

/** The subset of the SDK this module uses, so tests can pass a fake. */
export interface GeminiLike {
  models: { generateContent: GoogleGenAI["models"]["generateContent"] };
  interactions: { create: (params: never, options?: never) => Promise<unknown> };
}

let client: GoogleGenAI | null = null;
export function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new AiNotConfiguredError();
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

export interface Solution {
  /** False when the model couldn't find a question to answer. */
  readable: boolean;
  /** What the model read on the board. */
  question: string;
  /** Full answer in plain text. */
  answer: string;
  /** The answer broken into short lines to write on the board. */
  lines: string[];
}

const SOLVE_INSTRUCTIONS = `You are a friendly tutor standing at a whiteboard in a study library.
The image is part of a student's whiteboard. Read what they wrote (usually a question, problem or
prompt) and answer it the way a good tutor would write on the board: correct, short and clear.
For calculations, show only the key steps and the result.
Write the answer as short lines: at most 8 lines, each at most 32 characters.
Use only characters someone can write by hand (for example ×, ÷, ², √, π, →, 3/4). No LaTeX,
no markdown, no bullets, no emoji.
If there is nothing you can read or answer, set readable to false and say so briefly in answer.`;

const SOLUTION_SCHEMA = {
  type: "object",
  properties: {
    readable: { type: "boolean" },
    question: { type: "string", description: "Transcription of what is written in the image." },
    answer: { type: "string", description: "The full answer in plain text." },
    lines: {
      type: "array",
      items: { type: "string" },
      description: "The answer as short lines for writing on the whiteboard.",
    },
  },
  required: ["readable", "question", "answer", "lines"],
} as const;

/** Splits text into lines of at most `max` characters, on word boundaries where possible. */
export function wrapLines(lines: readonly string[], max = 34, limit = 10): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    let line = raw.replace(/\s+/g, " ").trim();
    while (line.length > max) {
      const cut = line.lastIndexOf(" ", max);
      const at = cut > max * 0.4 ? cut : max;
      out.push(line.slice(0, at).trim());
      line = line.slice(at).trim();
    }
    if (line) out.push(line);
  }
  return out.slice(0, limit);
}

export function parseSolution(text: string | undefined): Solution {
  const data = JSON.parse(text ?? "") as Partial<Solution>;
  const answer = typeof data.answer === "string" ? data.answer.trim() : "";
  const lines = Array.isArray(data.lines)
    ? data.lines.filter((l): l is string => typeof l === "string")
    : [];
  return {
    readable: data.readable !== false && (lines.length > 0 || answer.length > 0),
    question: typeof data.question === "string" ? data.question.trim() : "",
    answer,
    lines: wrapLines(lines.length > 0 ? lines : [answer]),
  };
}

async function solveWith(model: string, pngBase64: string, ai: GeminiLike): Promise<Solution> {
  const controller = new AbortController();
  try {
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: [
          {
            role: "user",
            parts: [
              { text: SOLVE_INSTRUCTIONS },
              { inlineData: { mimeType: "image/png", data: pngBase64 } },
            ],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseJsonSchema: SOLUTION_SCHEMA,
          temperature: 0.3,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: controller.signal,
        },
      }),
      SOLVE_TIMEOUT_MS,
      "Reading the board",
    );
    return parseSolution(response.text);
  } finally {
    // Stop waiting on Google once we've given up (or finished).
    controller.abort();
  }
}

/**
 * Reads the question in a PNG crop of the board and answers it. If the main model is
 * overloaded, rate-limited or too slow, tries the backup model once.
 */
export async function solveWhiteboard(
  pngBase64: string,
  ai: GeminiLike = getGemini(),
): Promise<Solution> {
  try {
    return await solveWith(TEXT_MODEL, pngBase64, ai);
  } catch (err) {
    if (!isTransient(err) || TEXT_FALLBACK_MODEL === TEXT_MODEL) throw err;
    const status = (err as { status?: number }).status;
    console.warn(
      `[ai] ${TEXT_MODEL} unavailable (${status}); retrying with ${TEXT_FALLBACK_MODEL}`,
    );
    return solveWith(TEXT_FALLBACK_MODEL, pngBase64, ai);
  }
}

export type Placement = "below" | "right" | "above" | "left";

const PLACEMENT_WORDS: Record<Placement, string> = {
  below: "the empty white space in the lower part of the image, below the existing writing",
  right: "the empty white space on the right-hand side of the image, beside the existing writing",
  above: "the empty white space in the upper part of the image, above the existing writing",
  left: "the empty white space on the left-hand side of the image, beside the existing writing",
};

export function handwritingPrompt(
  lines: readonly string[],
  placement: Placement,
  inkHex: string,
): string {
  return `This is part of a student's whiteboard. Write the answer below into ${PLACEMENT_WORDS[placement]}.
Write it by hand so it looks like the same person wrote it: copy the student's handwriting as
closely as you can (letter shapes, slant, size, spacing and stroke thickness) in the same ink colour
(${inkHex}). Write exactly these lines, in this order, one per line:
${lines.map((l) => `"${l}"`).join("\n")}
Rules: keep the background pure white. Do not move, change, redraw or erase anything already
written. No ruled lines, borders, shadows, paper texture, highlights or extra text. Keep the image
framing exactly the same.`;
}

export class HandwritingUnavailableError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HandwritingUnavailableError";
  }
}

/** Asks the image model to write the answer into the blank area; returns a base64 image. */
export async function handwriteAnswer(
  input: {
    pngBase64: string;
    lines: readonly string[];
    placement: Placement;
    inkHex: string;
    aspectRatio: string;
  },
  ai: GeminiLike = getGemini(),
): Promise<{ data: string; mimeType: string }> {
  let result: unknown;
  try {
    result = await withTimeout(
      (ai.interactions.create as (p: unknown, o: unknown) => Promise<unknown>)(
        {
          model: IMAGE_MODEL,
          // The v1 API wants content inside a "user_input" step (bare image parts are v1beta-only).
          input: [
            {
              type: "user_input",
              content: [
                {
                  type: "text",
                  text: handwritingPrompt(input.lines, input.placement, input.inkHex),
                },
                { type: "image", data: input.pngBase64, mime_type: "image/png" },
              ],
            },
          ],
          response_format: { type: "image", aspect_ratio: input.aspectRatio, image_size: "1K" },
          // Don't keep students' boards on Google's side.
          store: false,
        },
        // No automatic retries: a refusal (e.g. free-tier quota of 0) won't change on retry, and
        // retrying only delays the handwriting-font fallback.
        { maxRetries: 0, timeout: HANDWRITE_TIMEOUT_MS },
      ),
      HANDWRITE_TIMEOUT_MS,
      "Writing the answer",
    );
  } catch (err) {
    const status = (err as { status?: number }).status;
    throw new HandwritingUnavailableError(err instanceof Error ? err.message : String(err), status);
  }
  const image = (result as { output_image?: { data?: string; mime_type?: string } }).output_image;
  if (!image?.data) throw new HandwritingUnavailableError("The image model returned no image");
  return { data: image.data, mimeType: image.mime_type ?? "image/png" };
}
