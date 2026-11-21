import { CHAT, type ChatLine, FENWICK_ID, FENWICK_NAME } from "@ovr/shared";
import { cleanRemoteName } from "@/lib/net/players";

/*
 * The library chat's pure pieces (no React, no network): reading lines the server sent, who's
 * typing in words, grouping lines for the panel (components/chat/ChatPanel.tsx), and what a 3D
 * speech bubble over someone's head shows (components/world/ChatBubbles.tsx). The wire contract
 * is packages/shared/src/net/protocol.ts (ChatLine, FENWICK_ID, CHAT).
 */

/** Lines the panel keeps (the room sends its last CHAT.HISTORY when you join). */
export const CHAT_KEEP = 50;
/** The "characters left" counter shows from this many left. */
export const COUNTER_FROM = 30;
/** A speech bubble over someone's head shows their latest line this long. */
export const BUBBLE_MS = 6000;
/** Longest stretch of a line a speech bubble shows (the panel has the whole line). */
export const BUBBLE_CHARS = 90;
/** Lines from the same person closer together than this share one name label. */
export const GROUP_GAP_MS = 2 * 60_000;
/** The typing bubble's dots step this often. */
export const DOT_STEP_MS = 320;

const ZWJ = String.fromCodePoint(0x200d);
/** Letters that draw as nothing (Hangul fillers, the braille blank): read as spaces. */
const BLANK_FILLERS = /[\u115F\u1160\u3164\uFFA0\u2800]/gu;
/** More than 3 combining marks in a row ("Zalgo" text) are cut to 3. */
const MARK_RUN = /(\p{M}{3})\p{M}+/gu;

/**
 * A line's text as it's safe to show: the server already cleaned it (rules.ts cleanChatText), so
 * this only guards against a misbehaving server: invisible format characters (but the emoji
 * joiner), blank fillers, control characters and runs of whitespace go, runs of combining marks
 * are capped, and it's cut to CHAT.MAX_CHARS. Empty when nothing visible is left.
 */
export function cleanChatText(text: unknown, max: number = CHAT.MAX_CHARS): string {
  if (typeof text !== "string") return "";
  let out = text
    .replace(/\p{Cf}/gu, (c) => (c === ZWJ ? c : ""))
    .replace(BLANK_FILLERS, " ")
    .replace(/\s+/gu, " ")
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, "")
    .replace(MARK_RUN, "$1")
    .trim();
  if (/^[\p{M}\s]*$/u.test(out)) return "";
  if (out.length > max) {
    out = out.slice(0, max);
    const last = out.charCodeAt(out.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
    out = out.trimEnd();
  }
  return out;
}

const ID_MAX = 64;
const id = (v: unknown) => (typeof v === "string" && v && v.length <= ID_MAX ? v : null);

/** A ChatLine from the server, checked (null if it isn't one). Her lines always say her name. */
export function parseChatLine(raw: unknown): ChatLine | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const lineId = id(m.id);
  const from = id(m.from);
  const text = cleanChatText(m.text);
  if (!lineId || !from || !text) return null;
  const fenwick = from === FENWICK_ID;
  const line: ChatLine = {
    id: lineId,
    from,
    name: fenwick ? FENWICK_NAME : cleanRemoteName(m.name),
    text,
    at: typeof m.at === "number" && Number.isFinite(m.at) ? m.at : 0,
  };
  const replyTo = fenwick ? id(m.replyTo) : null;
  if (replyTo) line.replyTo = replyTo;
  return line;
}

/** chat_history's lines, checked, oldest first, the newest CHAT_KEEP at most. */
export function parseHistory(raw: unknown): ChatLine[] {
  const list = (raw as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const lines: ChatLine[] = [];
  for (const item of list) {
    const line = parseChatLine(item);
    if (!line || seen.has(line.id)) continue;
    seen.add(line.id);
    lines.push(line);
  }
  return lines.slice(-CHAT_KEEP);
}

const lineNumber = (id: string) => Number(/^c(\d+)$/.exec(id)?.[1] ?? Number.NaN);

/**
 * The room's history after a reconnect, merged into the lines already shown: the ones missing
 * here (said while the link was down) are added, in the room's order, the newest CHAT_KEEP kept.
 * `added` are those new lines.
 */
export function mergeLines(
  lines: readonly ChatLine[],
  history: readonly ChatLine[],
): { lines: ChatLine[]; added: ChatLine[] } {
  const have = new Set(lines.map((l) => l.id));
  const added = history.filter((l) => !have.has(l.id));
  if (added.length === 0) return { lines: [...lines], added };
  const merged = [...lines, ...added].sort(
    (a, b) => a.at - b.at || lineNumber(a.id) - lineNumber(b.id) || 0,
  );
  return { lines: merged.slice(-CHAT_KEEP), added };
}

/** `lines` with `line` added at the end (a repeat of a line already there changes nothing). */
export function appendLine(lines: readonly ChatLine[], line: ChatLine): ChatLine[] | null {
  if (lines.some((l) => l.id === line.id)) return null;
  const next = [...lines, line];
  return next.length > CHAT_KEEP ? next.slice(-CHAT_KEEP) : next;
}

/** The name a line shows: a first name ("Theo"), a guest's whole name ("Guest 4821"), her name. */
export function shortName(name: string) {
  const clean = cleanRemoteName(name);
  if (clean === FENWICK_NAME || /^Guest \d+$/.test(clean)) return clean;
  return clean.split(" ")[0] || clean;
}

/**
 * Who's typing, in words: "Theo is typing…", "2 people are typing…", "Ms. Fenwick is typing…"
 * (and "Ms. Fenwick and Theo are typing…"). Null when nobody is.
 */
export function typingLabel(names: readonly string[], fenwick: boolean): string | null {
  const n = names.length;
  if (fenwick) {
    if (n === 0) return `${FENWICK_NAME} is typing…`;
    const others = n === 1 ? shortName(names[0]!) : `${n} others`;
    return `${FENWICK_NAME} and ${others} are typing…`;
  }
  if (n === 0) return null;
  if (n === 1) return `${shortName(names[0]!)} is typing…`;
  return `${n} people are typing…`;
}

export type ChatKind = "mine" | "fenwick" | "other";

export interface ChatItem {
  line: ChatLine;
  kind: ChatKind;
  /** The first of a run of lines from the same sender: it shows who. */
  head: boolean;
  /** "You", "Ms. Fenwick", or their short name. */
  who: string;
  /** Her lines only: who she's answering ("Theo", or "you"), when the panel can tell. */
  to: string | null;
}

/**
 * The panel's lines, ready to draw: whose they are (yours, hers, someone else's), and which
 * start a new run (a different sender, or a long pause). `nameOf` looks up someone she answered
 * who has no line here (they're still in the room, their line scrolled away).
 */
export function chatItems(
  lines: readonly ChatLine[],
  selfId: string | null,
  nameOf: (sessionId: string) => string | undefined = () => undefined,
): ChatItem[] {
  const names = new Map<string, string>();
  for (const l of lines) if (l.from !== FENWICK_ID) names.set(l.from, l.name);
  let prev: ChatLine | null = null;
  return lines.map((line) => {
    const fenwick = line.from === FENWICK_ID;
    const kind: ChatKind = fenwick ? "fenwick" : selfId && line.from === selfId ? "mine" : "other";
    const sameRun =
      !!prev &&
      prev.from === line.from &&
      line.at - prev.at < GROUP_GAP_MS &&
      (!fenwick || prev.replyTo === line.replyTo);
    prev = line;
    let to: string | null = null;
    if (fenwick && line.replyTo) {
      if (selfId && line.replyTo === selfId) to = "you";
      else {
        const name = names.get(line.replyTo) ?? nameOf(line.replyTo);
        to = name ? shortName(name) : null;
      }
    }
    return {
      line,
      kind,
      head: !sameRun,
      who: kind === "mine" ? "You" : fenwick ? FENWICK_NAME : shortName(line.name),
      to,
    };
  });
}

/** Characters left in a line, or null while there are plenty (the counter stays hidden). */
export function charsLeft(text: string, max: number = CHAT.MAX_CHARS): number | null {
  const left = max - text.length;
  return left <= COUNTER_FROM ? left : null;
}

/** A line cut to fit a speech bubble: whole words where it can, with "…" when it's cut. */
export function bubbleText(text: string, max: number = BUBBLE_CHARS) {
  const clean = cleanChatText(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(" ");
  const words = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${words.replace(/[\s.,;:!?-]+$/u, "")}…`;
}

/**
 * Wraps text into at most `maxLines` lines no wider than `maxWidth` (as `measure` says), breaking
 * between words (a word too long for a line is broken where it has to be). If it doesn't all
 * fit, the last line ends in "…".
 */
export function wrapText(
  measure: (s: string) => number,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.split(" ").filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let i = 0;
  const fits = (s: string) => measure(s) <= maxWidth;
  while (i < words.length && lines.length < maxLines) {
    const word = words[i]!;
    const tryLine = current ? `${current} ${word}` : word;
    if (fits(tryLine)) {
      current = tryLine;
      i += 1;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
      continue;
    }
    // One word wider than the line: as much of it as fits, the rest goes on.
    let n = word.length - 1;
    while (n > 1 && !fits(word.slice(0, n))) n -= 1;
    lines.push(word.slice(0, n));
    words[i] = word.slice(n);
  }
  if (current && lines.length < maxLines) {
    lines.push(current);
    current = "";
  }
  const leftOver = i < words.length || current !== "";
  if (leftOver && lines.length > 0) {
    let last = lines[lines.length - 1]!;
    while (last.length > 1 && !fits(`${last}…`)) last = last.slice(0, -1);
    lines[lines.length - 1] = `${last.trimEnd()}…`;
  }
  return lines;
}

/** What a speech bubble shows right now (per frame: no allocation when nothing changed). */
export interface BubbleSource {
  /** Their latest line, and when it arrived here (performance.now()). */
  text: string;
  at: number;
  /** Typing in the chat right now. */
  typing: boolean;
}

export type BubbleFace =
  { kind: "line"; text: string; key: string } | { kind: "typing"; dot: number; key: string };

const TYPING_KEYS = ["t0", "t1", "t2"] as const;

/**
 * A fresh line (under BUBBLE_MS old) shows as words; otherwise, while they type, the bubble's
 * three dots step along; otherwise nothing. `key` changes only when the picture does, so the
 * bubble is repainted only then.
 */
export function bubbleFace(
  source: BubbleSource | undefined,
  now: number,
  cache?: { face: BubbleFace | null },
): BubbleFace | null {
  if (!source) return null;
  if (source.text && now - source.at < BUBBLE_MS && now >= source.at) {
    const key = `l${source.at}`;
    const hit = cache?.face;
    if (hit?.key === key) return hit;
    const face: BubbleFace = { kind: "line", text: bubbleText(source.text), key };
    if (cache) cache.face = face;
    return face;
  }
  if (source.typing) {
    const dot = Math.floor(now / DOT_STEP_MS) % 3;
    const hit = cache?.face;
    if (hit?.kind === "typing" && hit.dot === dot) return hit;
    const face: BubbleFace = { kind: "typing", dot, key: TYPING_KEYS[dot]! };
    if (cache) cache.face = face;
    return face;
  }
  return null;
}
