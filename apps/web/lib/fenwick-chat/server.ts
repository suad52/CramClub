import "server-only";
import {
  type GenerateContentResponse,
  type GoogleGenAI,
  HarmBlockThreshold,
  HarmCategory,
  type SafetySetting,
  ThinkingLevel,
} from "@google/genai";
import { CHAT, type FenwickChatRequest, INTERNAL_MAX_SKEW_MS } from "@ovr/shared";
import {
  TEXT_FALLBACK_MODEL,
  TEXT_MODEL,
  getGemini,
  isTransient,
  withTimeout,
} from "@/lib/ai/gemini";
import { buildFenwickChatPrompt } from "./persona";
import {
  echoesStudent,
  fallbackLine,
  looksLikeQuestion,
  needsNoReply,
  parseModelReply,
  unansweredTexts,
} from "./reply";

/**
 * Ms. Fenwick's words for the library chat (POST /api/internal/fenwick-chat): one quick Gemini
 * call in JSON mode, {"reply": string | null}, with her persona (persona.ts) and the chat as
 * untrusted data. Messages that plainly need no answer ("ok", "brb", emoji) never reach the
 * model. Gemini's safety filters are set tighter than its defaults (SAFETY_SETTINGS: a blocked
 * reply means she says nothing), and a reply that parrots a student's line (reply.ts echoesStudent) is held back too:
 * her line goes to the whole room under her name, and the asker hears it in her voice. If Gemini
 * errors, is overloaded or too slow, she answers a question with a canned in-character line
 * (reply.ts), and anything else with nothing, all within FENWICK_CHAT_BUDGET_MS, under the game
 * server's CHAT.FENWICK_TIMEOUT_MS. Chat text is never logged.
 */

/** Her desk's model (GEMINI_LIBRARIAN_MODEL, as lib/librarian/server/gemini.ts), fast by default. */
export const FENWICK_CHAT_MODEL = process.env.GEMINI_LIBRARIAN_MODEL || TEXT_FALLBACK_MODEL;
/** Everything, retries included, finishes within this (the game server gives up at 15 s). */
export const FENWICK_CHAT_BUDGET_MS = Math.min(11_000, CHAT.FENWICK_TIMEOUT_MS - 3_000);
/** The first model gets this long before the backup model is tried with what's left. */
const FIRST_TRY_MS = 7_000;
/** Not worth starting another try with less than this left. */
const MIN_TRY_MS = 250;

/** The part of the SDK used here, so tests can pass a stub. */
export interface ChatModel {
  models: { generateContent: GoogleGenAI["models"]["generateContent"] };
}

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: ["string", "null"],
      description:
        "Your chat line: 1–2 short sentences, plain text, at most 160 characters. null when the message doesn't call for an answer.",
    },
  },
  required: ["reply"],
};

/**
 * Hate and sexual content: blocked at the least sign (LOW). Harassment and dangerous content at
 * MEDIUM: at LOW, Gemini flagged most of her harmless study answers as harassment ("A derivative
 * measures…, Sam") in a live check on 2026-11-21, and she would have said nothing to them.
 */
export const SAFETY_SETTINGS: SafetySetting[] = [
  [HarmCategory.HARM_CATEGORY_HATE_SPEECH, HarmBlockThreshold.BLOCK_LOW_AND_ABOVE],
  [HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, HarmBlockThreshold.BLOCK_LOW_AND_ABOVE],
  [HarmCategory.HARM_CATEGORY_HARASSMENT, HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE],
  [HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE],
].map(([category, threshold]) => ({
  category: category as HarmCategory,
  threshold: threshold as HarmBlockThreshold,
}));

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"]);

/** Gemini's filters stopped the request or the reply (no text comes back then). */
function blocked(res: Partial<GenerateContentResponse>): boolean {
  if (res.promptFeedback?.blockReason) return true;
  const finish = res.candidates?.[0]?.finishReason;
  return !!finish && BLOCKED.has(String(finish));
}

async function ask(ai: ChatModel, model: string, req: FenwickChatRequest, ms: number) {
  const { system, prompt } = buildFenwickChatPrompt(req);
  const controller = new AbortController();
  try {
    const res = await withTimeout(
      ai.models.generateContent({
        model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: REPLY_SCHEMA,
          temperature: 0.7,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          safetySettings: SAFETY_SETTINGS,
          abortSignal: controller.signal,
        },
      }),
      ms,
      "Ms. Fenwick's chat reply",
    );
    if (!res.text && blocked(res)) return { reply: null, held: true };
    return { reply: parseModelReply(res.text), held: false };
  } finally {
    controller.abort(); // stop waiting on Google once we've given up (or finished)
  }
}

export interface FenwickReply {
  reply: string | null;
  /**
   * model: Gemini's words (or its null); skipped: nothing to answer; held: Gemini's filters
   * blocked it, or it parroted a student (null); fallback: a canned line, or null for something
   * that asked her nothing.
   */
  source: "model" | "skipped" | "held" | "fallback";
}

export interface FenwickReplyOptions {
  ai?: ChatModel;
  budgetMs?: number;
  firstTryMs?: number;
  now?: () => number;
}

/**
 * Her reply to `req`, or null when it needs none. Never throws for model trouble: a transient
 * failure (overloaded, rate-limited, timed out) tries the backup model with the time left, and
 * anything still failing gets a canned line if the asker asked her something (null otherwise).
 * A reply Gemini's filters blocked, or one that parrots a student's line, is null. `ai` defaults
 * to the configured Gemini client (which throws AiNotConfiguredError without GEMINI_API_KEY).
 */
export async function fenwickReply(
  req: FenwickChatRequest,
  {
    ai,
    budgetMs = FENWICK_CHAT_BUDGET_MS,
    firstTryMs = FIRST_TRY_MS,
    now = Date.now,
  }: FenwickReplyOptions = {},
): Promise<FenwickReply> {
  const texts = unansweredTexts(req);
  if (texts.length === 0 || texts.every(needsNoReply)) return { reply: null, source: "skipped" };
  const client = ai ?? getGemini();
  const deadline = now() + budgetMs;
  const models =
    FENWICK_CHAT_MODEL === TEXT_MODEL ? [FENWICK_CHAT_MODEL] : [FENWICK_CHAT_MODEL, TEXT_MODEL];
  // One model only: give it a second try rather than none.
  if (models.length === 1) models.push(FENWICK_CHAT_MODEL);
  let why = "no time";
  for (let i = 0; i < models.length; i++) {
    const left = deadline - now();
    if (left < MIN_TRY_MS) break;
    const ms = i === models.length - 1 ? left : Math.min(firstTryMs, left);
    try {
      const { reply, held } = await ask(client, models[i]!, req, ms);
      if (held || (reply && echoesStudent(reply, req.lines))) {
        console.warn(`[fenwick-chat] held back a reply (${held ? "blocked" : "echo"})`);
        return { reply: null, source: "held" };
      }
      return { reply, source: "model" };
    } catch (err) {
      const status = (err as { status?: number }).status;
      why = status ? `${models[i]} ${status}` : `${models[i]} ${(err as Error).name}`;
      if (!isTransient(err)) break;
    }
  }
  if (!looksLikeQuestion(req)) {
    console.warn(`[fenwick-chat] staying quiet (${why})`);
    return { reply: null, source: "fallback" };
  }
  console.warn(`[fenwick-chat] answering with a canned line (${why})`);
  return { reply: fallbackLine(req), source: "fallback" };
}

/**
 * Remembers signatures it has accepted, so a captured request can't be replayed while its
 * timestamp is still fresh (INTERNAL_MAX_SKEW_MS either side). In memory, per server process.
 */
export function createReplayGuard(windowMs = 2 * INTERNAL_MAX_SKEW_MS) {
  const seen = new Map<string, number>();
  return (signature: string, at = Date.now()): boolean => {
    for (const [sig, until] of seen) if (until <= at) seen.delete(sig);
    if (seen.has(signature)) return false;
    seen.set(signature, at + windowMs);
    return true;
  };
}
