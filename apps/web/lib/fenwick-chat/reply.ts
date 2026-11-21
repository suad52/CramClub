import { CHAT, type FenwickChatRequest, TICKET_NAME_MAX } from "@ovr/shared";
import { z } from "zod";

/**
 * Ms. Fenwick answering in the library chat (POST /api/internal/fenwick-chat; contract in
 * packages/shared/src/net/internal.ts): the pure parts. Reading the game server's request,
 * spotting messages that need no answer, cleaning what the model wrote, holding back a reply that
 * parrots what a student typed (echoesStudent), and her canned lines for when she can't be
 * reached (only for something that asked her a question: looksLikeQuestion). No I/O here; the
 * Gemini call is server.ts, the prompt persona.ts.
 *
 * Everything in a request came from students typing in the chat (relayed by the game server), so
 * it's bounded here and treated as untrusted data everywhere after.
 */

/* ---- The request ---- */

type Line = FenwickChatRequest["lines"][number];
const isAskers = (line: Line) => line.asker && !line.fenwick;

const name = z.string().trim().min(1).max(TICKET_NAME_MAX);

const ChatLineSchema = z.object({
  name,
  text: z.string().trim().min(1).max(CHAT.MAX_CHARS),
  fenwick: z.boolean(),
  asker: z.boolean(),
});

/** FenwickChatRequest, bounded: names ≤ TICKET_NAME_MAX, texts ≤ CHAT.MAX_CHARS, ≤ 12 lines. */
export const FenwickChatRequestSchema = z.object({
  askerName: name,
  lines: z
    .array(ChatLineSchema)
    .min(1)
    .max(CHAT.FENWICK_CONTEXT_LINES)
    .refine((lines) => lines.some(isAskers), "There's no line from the asker"),
  alone: z.boolean(),
}) satisfies z.ZodType<FenwickChatRequest>;

/** The raw (already signature-checked) body as a request, or null when it isn't one. */
export function parseFenwickChatRequest(raw: string): FenwickChatRequest | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = FenwickChatRequestSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

/**
 * Indexes of the asker's line(s) she's answering: the run of their lines at the end (the game
 * server puts them last), or their latest line if someone else's slipped in after it.
 */
export function unansweredIndexes(lines: readonly Line[]): number[] {
  const out: number[] = [];
  for (let i = lines.length - 1; i >= 0 && isAskers(lines[i]!); i--) out.unshift(i);
  if (out.length) return out;
  for (let i = lines.length - 1; i >= 0; i--) if (isAskers(lines[i]!)) return [i];
  return [];
}

export const unansweredTexts = (req: FenwickChatRequest) =>
  unansweredIndexes(req.lines).map((i) => req.lines[i]!.text);

/* ---- Messages that don't call for an answer ---- */

// One "word" of a message that needs no reply: acknowledgements, laughter, "brb", goodbyes.
const NO_REPLY_WORD = [
  "o?k+",
  "ok(?:ay|ey)?",
  "kay",
  "lo+l+",
  "lmf?a+o+",
  "rofl",
  "ha(?:ha)+h?",
  "he(?:he)+",
  "xd+",
  "brb",
  "bbl",
  "bbs",
  "afk",
  "gtg",
  "g2g",
  "ttyl",
  "bye+(?: bye+)?",
  "good ?bye",
  "good ?night",
  "gn",
  "nite",
  "night",
  "cya",
  "see (?:ya|you|u)(?: later| soon| tmrw| tomorrow)?",
  "laters?",
  "thanks?(?: (?:you|u|so much|a lot))?",
  "thank (?:you|u)",
  "ty(?:sm|vm)?",
  "thx",
  "np",
  "no problem",
  "no worries",
  "yes",
  "yeah",
  "yea",
  "yep",
  "yup",
  "ya",
  "no",
  "nope",
  "nah",
  "cool",
  "nice",
  "sure",
  "alright",
  "aight",
  "mhm+",
  "hm+",
  "ah+",
  "oh+",
  "oo+f",
  "welp",
  "wow",
  "omg",
  "same",
  "true",
  "bet",
  "done",
  "(?:i'?m )?back",
].join("|");
const NO_REPLY = new RegExp(`^(?:${NO_REPLY_WORD})(?: (?:${NO_REPLY_WORD}))*$`, "u");

/**
 * True when a chat line plainly needs no answer: "ok", "brb", "lol thanks", "bye!", emoji or
 * punctuation only. Anything with a question mark is left to her to judge.
 */
export function needsNoReply(text: string): boolean {
  if (text.includes("?") || text.includes("？")) return false;
  const words = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[^\p{L}\p{N}'\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words === "" || NO_REPLY.test(words);
}

/* ---- What the model wrote ---- */

/** Controls and line/paragraph separators (read as spaces) and invisible formatting (dropped). */
const BREAKS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
const INVISIBLE = /\p{Cf}/gu;
const EMOJI = /\p{Extended_Pictographic}[️\u{1F3FB}-\u{1F3FF}]*/gu;
const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&amp;": "&",
};
const HTML_TAG = /<\/?(?:b|i|u|em|strong|code|pre|p|br|span|div|a|ul|ol|li|h[1-6])\b[^>]*>/gi;

/** Cuts to `max` UTF-16 units, at a word if one is near, ending in "…". */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max - 1);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  const space = cut.lastIndexOf(" ");
  if (space > max * 0.6) cut = cut.slice(0, space);
  return `${cut.replace(/[\s,;:.!?-]+$/u, "")}…`;
}

/**
 * Her reply as one plain chat line: markdown, HTML and invisible characters stripped, whitespace
 * collapsed, at most one emoji, a stray "Ms. Fenwick:" prefix or wrapping quotes removed, and at
 * most CHAT.MAX_CHARS characters. Null when nothing is left.
 */
export function cleanReply(text: string): string | null {
  let s = text.replace(/\r\n?/g, "\n");
  s = s.replace(/```[\w-]*\n?/g, "");
  s = s.replace(/!?\[([^\]\n]*)\]\([^)\n]*\)/g, "$1");
  s = s.replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+•][ \t]+|\d+[.)][ \t]+)/gm, "");
  s = s.replace(/(\*\*|__|~~)(.+?)\1/g, "$2");
  s = s.replace(/(^|[^\w*])\*(?![\s*])([^*\n]+?)\*(?!\w)/g, "$1$2");
  s = s.replace(/(^|[^\w])_(?![\s_])([^_\n]+?)_(?!\w)/g, "$1$2");
  s = s.replace(/`+/g, "").replace(/\*{2,}/g, "");
  s = s.replace(HTML_TAG, "");
  s = s.replace(/&(?:lt|gt|quot|#39|apos|nbsp|amp);/g, (e) => ENTITIES[e] ?? e);
  s = s.replace(BREAKS, " ").replace(INVISIBLE, "");
  let emoji = 0;
  s = s.replace(EMOJI, (e) => (emoji++ === 0 ? e : ""));
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:ms\.?\s*)?fenwick\s*[:：]\s*/i, "");
  const quoted = /^["“](.*)["”]$/u.exec(s);
  if (quoted && !/["“”]/u.test(quoted[1]!)) s = quoted[1]!.trim();
  if (!s || /^(?:null|none|n\/a)$/i.test(s)) return null;
  return capText(s, CHAT.MAX_CHARS);
}

/** She never talks about being a program, or claims to be a person off-screen. */
const OUT_OF_CHARACTER = new RegExp(
  [
    String.raw`\bas an? (?:ai|a\.i\.|(?:large )?language model|llm|chat ?bot|virtual assistant)\b`,
    String.raw`\bi(?:'m| am) (?:just |only |not |not really )?(?:an? )?(?:ai|a\.i\.|(?:large )?language model|llm|chat ?bot|bot|robot|computer program|program|virtual assistant)\b`,
    String.raw`\bi(?:'m| am) (?:a )?(?:real |actual )?human\b`,
    String.raw`\bi(?:'m| am) (?:a )?(?:real|actual) person\b`,
    String.raw`\b(?:chatgpt|openai)\b`,
  ].join("|"),
  "i",
);

/** Thrown when the model's answer can't be used; the caller falls back to a canned line. */
export class UnusableReplyError extends Error {
  constructor(why: string) {
    super(`Unusable chat reply: ${why}`);
    this.name = "UnusableReplyError";
  }
}

/**
 * The model's JSON ({"reply": string | null}) as her chat line, or null for "no answer needed".
 * Throws UnusableReplyError for anything else, or a reply that breaks character.
 */
export function parseModelReply(text: string | undefined): string | null {
  let data: unknown;
  try {
    data = JSON.parse(text ?? "");
  } catch {
    throw new UnusableReplyError("not JSON");
  }
  if (typeof data !== "object" || data === null || !("reply" in data))
    throw new UnusableReplyError("no reply field");
  const { reply } = data as { reply: unknown };
  if (reply === null) return null;
  if (typeof reply !== "string") throw new UnusableReplyError("reply isn't text");
  const clean = cleanReply(reply);
  if (clean && OUT_OF_CHARACTER.test(clean.replace(/’/g, "'")))
    throw new UnusableReplyError("out of character");
  return clean;
}

/* ---- Saying back what a student typed ---- */

/** Lowercased words (letters, digits, apostrophes), for comparing her reply with chat lines. */
function wordsOf(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

/** The longest run of words `a` and `b` share, in order. */
function longestSharedRun(a: readonly string[], b: readonly string[]): number {
  let best = 0;
  let prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++)
      if (a[i - 1] === b[j - 1]) best = Math.max(best, (row[j] = prev[j - 1]! + 1));
    prev = row;
  }
  return best;
}

/** Words in a row from any student's line that make her reply an echo of it. */
export const ECHO_RUN_WORDS = 8;
/** ...or, after a line asked for words back (PARROT), this many in a row. */
export const PARROT_RUN_WORDS = 3;
/** A student asking for words back: "repeat after me", "say back exactly", "how do you spell". */
const PARROT =
  /\b(?:repeat (?:after|back|exactly|this|that|what|it)|recite|spell(?!\s+out)|spelled|spelling|verbatim|word for word|say (?:back|after|exactly|the following|this)|just say|type (?:back|exactly)|write (?:back|exactly))\b/u;
/** Words a request for words back is made of, which her reply may well use too. */
const PARROT_PLAIN = new Set(
  "repeat recite spell spelled spelling verbatim word words exactly after back following just please could would will can you your yours this that these those with have what when where which there their they them then than from into onto about it's its i'm dear thanks thank fenwick librarian".split(
    " ",
  ),
);

/**
 * Whether her reply parrots what a student typed: ECHO_RUN_WORDS words in a row from any
 * student's line, or, from what follows a request for words back ("repeat after me: …", "how do
 * you spell …"), PARROT_RUN_WORDS in a row or any longer word of that sentence (spelled out,
 * "s-l-u-r", too).
 * Such a reply isn't posted (she stays quiet): chat lines are untrusted, and her name in the chat
 * and her voice would carry them. Restating a question in her own words stays well under these.
 */
export function echoesStudent(reply: string, lines: FenwickChatRequest["lines"]): boolean {
  const said = wordsOf(reply);
  const squashed = said.join("").replace(/'/g, "");
  for (const line of lines) {
    if (line.fenwick) continue;
    const words = wordsOf(line.text);
    if (longestSharedRun(said, words) >= ECHO_RUN_WORDS) return true;
    const lower = line.text.normalize("NFKC").toLowerCase().replace(/[‘’]/g, "'");
    const cue = PARROT.exec(lower);
    if (!cue) continue;
    const rest = lower.slice(cue.index + cue[0].length);
    if (longestSharedRun(said, wordsOf(rest)) >= PARROT_RUN_WORDS) return true;
    // Single words only from the sentence the request is in ("spell zorbex? I keep…": zorbex).
    for (const w of wordsOf(rest.split(/[?!.？！。]/u)[0]!))
      if (w.length >= 4 && !PARROT_PLAIN.has(w) && squashed.includes(w.replace(/'/g, "")))
        return true;
  }
  return false;
}

/* ---- When she can't be reached ---- */

/**
 * Her canned lines for when the model errors or is too slow. In character, short, and never
 * repeating anything a student wrote.
 */
export const FALLBACK_LINES = [
  "I'm a bit swamped at the desk, dear. Ask me again in a moment?",
  "Just a moment, dear, I'm up to my elbows in returns. Try me again shortly?",
  "Oh, my reading glasses have wandered off again. Ask me once more in a minute?",
  "Bear with me, dear, the card catalogue is being stubborn. Ask again in a moment?",
] as const;

/** FNV-1a, so the same request always gets the same canned line. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

const QUESTION_START =
  /^(?:what|what's|whats|how|how's|why|when|where|who|which|can|could|would|should|will|does|do|did|is|are|was|were|any|anyone|anybody|help|explain|tell|teach|show|remind|define)\b/u;
const ADDRESSES_HER = /\b(?:fenwick|librarian)\b/u;

/**
 * Whether the asker's unanswered line(s) asked her something: a "?", a line that starts like a
 * question or a request ("how do I…", "explain…", "help"), or one that names her. Only then does
 * a canned "ask me again" line make sense when the model can't be reached.
 */
export function looksLikeQuestion(req: FenwickChatRequest): boolean {
  return unansweredTexts(req).some((text) => {
    const t = text
      .normalize("NFKC")
      .toLowerCase()
      .trim()
      .replace(/^ms\.?\s+/u, "");
    return /[?？]/u.test(t) || QUESTION_START.test(t) || ADDRESSES_HER.test(t);
  });
}

/** A canned line for this request, chosen from FALLBACK_LINES by what was asked. */
export function fallbackLine(req: FenwickChatRequest): string {
  const key = `${req.askerName}\n${unansweredTexts(req).join("\n")}`;
  return FALLBACK_LINES[hash(key) % FALLBACK_LINES.length]!;
}
