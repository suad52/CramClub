/**
 * The library room's rules as pure functions, so they're tested without sockets: rate limits,
 * message validation, movement checks, seat distance, and the chat: cleaning a line, and when
 * Ms. Fenwick answers a player nobody else answered ({@link ghostDecision}). LibraryRoom.ts wires
 * them to messages and timers.
 */
import {
  ANCHORS,
  BUILDING,
  CHAT,
  type ChatLine,
  type ClientMessages,
  FENWICK_ID,
  type FacialParams,
  type FenwickChatRequest,
  type MovementState,
  NET,
  SEATS,
  STEP_UP,
  STUDY_STATUSES,
  SURFACES,
  type Seat,
  type StudyStatus,
  type Vec3,
  distance2D,
  rectContains,
  sanitizeAvatarConfig,
  surfaceHeight,
  wrapAngle,
} from "@ovr/shared";

/* ---- Rate limits ---- */

/**
 * A token bucket: `perSecond` on average, with `burst` in a row allowed (network jitter bunches
 * messages up). Refill has 25% slack so a client sending at exactly the contract rate never loses
 * one to timer drift. Over the limit, messages are dropped, not queued.
 */
export class RateLimiter {
  private tokens: number;
  private at: number;
  private readonly refill: number;

  constructor(
    perSecond: number,
    private readonly burst: number,
    now: number = Date.now(),
  ) {
    this.refill = (perSecond * 1.25) / 1000;
    this.tokens = burst;
    this.at = now;
  }

  take(now: number = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + Math.max(0, now - this.at) * this.refill);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/** Per-client message limits (per second, and how many in a row). sit and stand share one. */
export const LIMITS = {
  move: { perSecond: NET.MOVE_HZ, burst: 4 },
  face: { perSecond: NET.FACE_HZ, burst: 3 },
  seat: { perSecond: 2, burst: 3 },
  status: { perSecond: 1, burst: 3 },
  avatar: { perSecond: 0.5, burst: 2 },
  chat: { perSecond: CHAT.PER_SECOND, burst: CHAT.BURST },
  typing: { perSecond: CHAT.TYPING_HZ, burst: 3 },
  /** "chat_pref": a switch flipped by hand. */
  chatPref: { perSecond: 1, burst: 4 },
} as const;

export type LimitName = keyof typeof LIMITS;

export function createLimiters(now: number = Date.now()): Record<LimitName, RateLimiter> {
  const out = {} as Record<LimitName, RateLimiter>;
  for (const [name, l] of Object.entries(LIMITS) as [LimitName, (typeof LIMITS)[LimitName]][])
    out[name] = new RateLimiter(l.perSecond, l.burst, now);
  return out;
}

/* ---- One use per ticket ---- */

/**
 * The tickets already used to join, so each works once: a copied ticket (from a log, a shared
 * screen, a proxy) can't put a second player in under that name, nor hold up seat reservations
 * over and over. Entries are kept until the ticket would have expired anyway. In-process: with
 * several game-server processes this would have to move to a shared store (Redis, say).
 */
export class TicketLedger {
  private used = new Map<string, number>();
  private pruneAt = 0;

  constructor(private readonly max = 100_000) {}

  /** True the first time `id` is seen (and records it until `exp`, in seconds); false after. */
  claim(id: string, exp: number, nowS: number = Math.floor(Date.now() / 1000)): boolean {
    if (nowS >= this.pruneAt || this.used.size >= this.max) {
      for (const [k, until] of this.used) if (until <= nowS) this.used.delete(k);
      this.pruneAt = nowS + 30;
    }
    if (this.used.has(id)) return false;
    // Still full of live tickets: refuse rather than forget one (forgetting re-enables a replay).
    if (this.used.size >= this.max) return false;
    this.used.set(id, exp);
    return true;
  }

  get size() {
    return this.used.size;
  }
}

/* ---- Message shapes ---- */

const MOVEMENTS: readonly MovementState[] = ["idle", "walk", "run", "sit"];
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A "move" with finite numbers and a known movement, or null. */
export function readMove(msg: unknown): ClientMessages["move"] | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  if (![m.x, m.y, m.z, m.ry, m.speed].every(isFiniteNumber)) return null;
  if (typeof m.movement !== "string" || !MOVEMENTS.includes(m.movement as MovementState))
    return null;
  return {
    x: m.x as number,
    y: m.y as number,
    z: m.z as number,
    ry: m.ry as number,
    movement: m.movement as MovementState,
    speed: m.speed as number,
  };
}

const FACE_SIGNED = ["headYaw", "headPitch", "headRoll"] as const;
const FACE_UNIT = [
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "jawOpen",
  "smile",
  "browRaise",
] as const satisfies readonly (keyof FacialParams)[];

/**
 * A "face" message: `null` (tracking off), every FacialParams value clamped to its range (head
 * angles [-1, 1], the rest [0, 1]) with nothing else copied, or `undefined` when it's malformed.
 */
export function readFace(msg: unknown): FacialParams | null | undefined {
  if (msg === null) return null;
  if (!msg || typeof msg !== "object") return undefined;
  const m = msg as Record<string, unknown>;
  const out = {} as FacialParams;
  for (const k of FACE_SIGNED) {
    const v = m[k];
    if (!isFiniteNumber(v)) return undefined;
    out[k] = clamp(v, -1, 1);
  }
  for (const k of FACE_UNIT) {
    const v = m[k];
    if (!isFiniteNumber(v)) return undefined;
    out[k] = clamp(v, 0, 1);
  }
  return out;
}

export function readStatus(msg: unknown): StudyStatus | null {
  const s = (msg as { status?: unknown } | null)?.status;
  return typeof s === "string" && STUDY_STATUSES.includes(s as StudyStatus)
    ? (s as StudyStatus)
    : null;
}

/** Longest avatar JSON accepted (a full config is ~400 characters). */
export const AVATAR_MAX_CHARS = 2048;

/** The avatar JSON to store: parsed, run through sanitizeAvatarConfig, re-serialised. */
export function readAvatar(msg: unknown): string | null {
  const a = (msg as { avatar?: unknown } | null)?.avatar;
  if (typeof a !== "string" || a.length > AVATAR_MAX_CHARS) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(a);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return JSON.stringify(sanitizeAvatarConfig(parsed));
}

const SEATS_BY_ID = new Map(SEATS.map((s) => [s.id, s]));

export function seatById(id: unknown): Seat | undefined {
  return typeof id === "string" ? SEATS_BY_ID.get(id) : undefined;
}

/* ---- Movement ---- */

/** Distance a player may cover in one go after standing still (the speed budget's cap). */
export const MOVE_BURST_M = NET.MAX_SPEED * 0.5;
/** A seat must be at most this far (on the floor plane) from where the player stands. */
export const SIT_RANGE_M = 2;
/** ...and on the same floor. */
const SAME_FLOOR_M = 1;
/** Within this of a lift's call point, a move may change floors. */
const LIFT_REACH_M = 2;
const LIFTS = ANCHORS.filter((a) => a.kind === "lift");

/** The server's view of one player's body, between moves. */
export interface MoveTracker {
  /** Metres the player may still cover now (refills at NET.MAX_SPEED, capped at MOVE_BURST_M). */
  budget: number;
  /** When the budget was last refilled (ms). */
  at: number;
  /** False until the first move after joining, which may place the player anywhere on a floor. */
  placed: boolean;
}

export function newTracker(now: number = Date.now()): MoveTracker {
  return { budget: MOVE_BURST_M, at: now, placed: false };
}

const nearLift = (p: Vec3) => LIFTS.some((l) => distance2D(l, p) <= LIFT_REACH_M);

/**
 * The floor height for a player arriving at (x, z) who claims height `claimedY`, coming from
 * height `fromY`: the walk surface there nearest the claim, among those within a step of where
 * they were (any floor next to a lift, or on a first placement). Null when there's no floor.
 */
export function floorFor(
  x: number,
  z: number,
  claimedY: number,
  fromY: number | null,
): number | null {
  let best: number | null = null;
  for (const s of SURFACES) {
    if (!rectContains(s.rect, { x, z })) continue;
    const h = surfaceHeight(s, { x, z });
    if (fromY !== null && Math.abs(h - fromY) > STEP_UP + 0.05) continue;
    if (best === null || Math.abs(h - claimedY) < Math.abs(best - claimedY)) best = h;
  }
  return best;
}

export interface AcceptedMove {
  x: number;
  y: number;
  z: number;
  ry: number;
  movement: MovementState;
  speed: number;
  /** True when the claimed position was further than the speed budget and was pulled back. */
  clamped: boolean;
}

/**
 * Checks a (standing) player's move from `from`. Positions are kept inside the building and on a
 * walk surface; the distance covered may not beat NET.MAX_SPEED over the time since the last move
 * (beyond a small burst), else the move is cut short along its direction. Floors change only by a
 * step, or at a lift. Returns null to drop the move (no floor there). Updates `tracker`.
 */
export function acceptMove(
  from: Vec3,
  tracker: MoveTracker,
  move: ClientMessages["move"],
  now: number = Date.now(),
): AcceptedMove | null {
  const budget = Math.min(
    MOVE_BURST_M,
    tracker.budget + (NET.MAX_SPEED * Math.max(0, now - tracker.at)) / 1000,
  );
  let x = clamp(move.x, BUILDING.minX, BUILDING.maxX);
  let z = clamp(move.z, BUILDING.minZ, BUILDING.maxZ);
  let clamped = false;
  let used = 0;

  if (tracker.placed) {
    const dist = Math.hypot(x - from.x, z - from.z);
    if (dist > budget) {
      const f = budget / dist;
      x = from.x + (x - from.x) * f;
      z = from.z + (z - from.z) * f;
      clamped = true;
      used = budget;
    } else used = dist;
  }

  const anyFloor = !tracker.placed || (nearLift(from) && nearLift({ x, y: move.y, z }));
  const y = floorFor(x, z, move.y, anyFloor ? null : from.y);
  if (y === null) return null;

  tracker.budget = tracker.placed ? budget - used : MOVE_BURST_M;
  tracker.at = now;
  tracker.placed = true;
  return {
    x,
    y,
    z,
    ry: wrapAngle(move.ry),
    // Seats come only from "sit": a standing player who says "sit" is idle.
    movement: move.movement === "sit" ? "idle" : move.movement,
    speed: clamp(move.speed, 0, NET.MAX_SPEED),
    clamped,
  };
}

/** Whether `seat` is out of reach of a player standing at `at` (too far, or another floor). */
export function seatTooFar(seat: Seat, at: Vec3): boolean {
  return distance2D(seat, at) > SIT_RANGE_M || Math.abs(seat.y - at.y) > SAME_FLOOR_M;
}

/* ---- Chat ---- */

const ZWJ = String.fromCodePoint(0x200d);
const VS16 = String.fromCodePoint(0xfe0f);
/**
 * Invisible format characters (bidi overrides, zero-width spaces, BOM, ...), which could make a
 * line render as something else (as NAME_UNSAFE guards names). The one kept: a zero-width joiner
 * between two emoji (the woman-and-laptop "technologist", family emoji), so emoji sequences
 * survive; a joiner anywhere else goes like the rest.
 */
const FORMAT_CHARS = new RegExp(
  `(?<![\\p{Extended_Pictographic}\\p{Emoji_Modifier}]${VS16}?)${ZWJ}` +
    `|${ZWJ}(?!\\p{Extended_Pictographic})` +
    `|[^\\P{Cf}${ZWJ}]`,
  "gu",
);
/** Control characters left once whitespace became spaces (NUL, DEL, C1 controls, ...). */
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
/** Letters that draw as nothing (Hangul fillers, the braille blank): read as spaces. */
export const BLANK_FILLERS = /[\u115F\u1160\u3164\uFFA0\u2800]/gu;
/** More than 3 combining marks in a row ("Zalgo" text) are cut to 3 (keycap emoji need 2). */
export const MARK_RUN = /(\p{M}{3})\p{M}+/gu;
/** Nothing a reader would see: only spaces and combining marks. */
const NOTHING_VISIBLE = /^[\p{M}\s]*$/u;

/**
 * A chat line as everyone will see it: format characters removed (see FORMAT_CHARS), newlines,
 * tabs, blank fillers and other whitespace turned into single spaces, control characters
 * removed, runs of combining marks capped (MARK_RUN), trimmed, and cut to CHAT.MAX_CHARS (UTF-16
 * units, never splitting a surrogate pair). Null when nothing visible is left, or for anything
 * but a string.
 */
export function cleanChatText(text: unknown): string | null {
  if (typeof text !== "string") return null;
  let out = text
    .replace(FORMAT_CHARS, "")
    .replace(BLANK_FILLERS, " ")
    .replace(/\s+/gu, " ")
    .replace(CONTROL_CHARS, "")
    .replace(MARK_RUN, "$1")
    .replace(/ {2,}/g, " ")
    .trim();
  if (NOTHING_VISIBLE.test(out)) return null;
  if (out.length > CHAT.MAX_CHARS) {
    out = out.slice(0, CHAT.MAX_CHARS);
    const last = out.charCodeAt(out.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) out = out.slice(0, -1);
    out = out.trimEnd();
  }
  return out || null;
}

/** A "chat" message: the cleaned text, and whether Ms. Fenwick may answer it (only `false` says no). */
export function readChat(msg: unknown): { text: string; fenwick: boolean } | null {
  if (!msg || typeof msg !== "object") return null;
  const m = msg as Record<string, unknown>;
  const text = cleanChatText(m.text);
  return text ? { text, fenwick: m.fenwick !== false } : null;
}

/** A "typing" message's `on`, or null when it's malformed. */
export function readTyping(msg: unknown): boolean | null {
  const on = (msg as { on?: unknown } | null)?.on;
  return typeof on === "boolean" ? on : null;
}

/**
 * The web app's answer (FenwickChatResponse) as a line to post: her reply cleaned like any other
 * line, or null when she has nothing to say (`reply: null`) or the body isn't the right shape.
 */
export function readFenwickReply(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  return cleanChatText((body as { reply?: unknown }).reply);
}

/**
 * The room's latest CHAT.FENWICK_CONTEXT_LINES lines (oldest first) as a FenwickChatRequest's
 * `lines`: her own lines flagged `fenwick`, the asker's (by sessionId) flagged `asker`.
 */
export function fenwickContext(
  history: readonly ChatLine[],
  askerId: string,
): FenwickChatRequest["lines"] {
  return history.slice(-CHAT.FENWICK_CONTEXT_LINES).map((line) => ({
    name: line.name,
    text: line.text,
    fenwick: line.from === FENWICK_ID,
    asker: line.from === askerId,
  }));
}

/** Holds the latest CHAT.HISTORY lines, oldest first. */
export function remember(history: ChatLine[], line: ChatLine): void {
  history.push(line);
  if (history.length > CHAT.HISTORY) history.splice(0, history.length - CHAT.HISTORY);
}

/* ---- Ms. Fenwick answers when nobody else does ---- */

/** While someone else is typing (or her last reply to this player is still coming), look again this often. */
export const GHOST_RECHECK_MS = 1000;
/**
 * Her replies a minute across every room in this server process: a cap on what the rooms can ask
 * of the web app (and so of Gemini) together, however many rooms fresh guests open.
 */
export const FENWICK_GLOBAL_PER_MINUTE = 30;
/** "Ms. Fenwick is typing…" goes out only once a reply has taken this long (no flash for "ok"). */
export const FENWICK_TYPING_DELAY_MS = 500;
const MINUTE_MS = 60_000;

const QUESTION_START =
  /^(?:what|what's|whats|how|how's|why|when|where|who|which|can|could|would|should|will|does|do|did|is|are|was|were|any|anyone|anybody|help|explain)\b/iu;

/** A line that asks something: a "?", or it starts like a question ("how do I…", "help"). */
export function asksSomething(text: string): boolean {
  return /[?？]/u.test(text) || QUESTION_START.test(text.trim());
}

/**
 * Whether a new line starts its sender's own wait for an answer. A line that answers someone
 * else isn't waiting for one: it settled another learner's wait (`answeredSomeone`), or came
 * within CHAT.GHOST_MS of another learner's line (`otherLineAt`, a conversation going on). Unless
 * it asks something back (asksSomething): then it waits like any question.
 */
export function waitsForAnswer(
  text: string,
  at: number,
  otherLineAt: number | null,
  answeredSomeone: boolean,
): boolean {
  if (asksSomething(text)) return true;
  if (answeredSomeone) return false;
  return otherLineAt === null || at - otherLineAt >= CHAT.GHOST_MS;
}

/** The earliest time another reply fits in a sliding window of `limit` a minute. */
function windowFree(times: readonly number[], limit: number, now: number): number {
  const recent = times.filter((t) => now - t < MINUTE_MS).sort((a, b) => a - b);
  return recent.length < limit ? -Infinity : recent[recent.length - limit]! + MINUTE_MS;
}

/** Everything the "has this player been ghosted?" rule looks at, for one asker. */
export interface GhostState {
  /** When the asker's latest line was posted (ms). Their wait counts from it. */
  askedAt: number;
  /** The latest line from any other person (another learner; not her), or null. */
  otherLineAt: number | null;
  /** Someone else is in the room (so someone could have answered). */
  othersPresent: boolean;
  /** Someone else is typing right now (maybe the answer). */
  othersTyping: boolean;
  /** When she last took up this learner's lines (asked the web app for a reply), or null. */
  lastForAsker: number | null;
  /** When she took up anyone's lines in this room recently (any order; older ones are ignored). */
  roomRecent: readonly number[];
  /** The same across every room in this process (FENWICK_GLOBAL_PER_MINUTE). */
  globalRecent: readonly number[];
  /** Her reply to this asker is still being written. */
  inFlight: boolean;
}

export type GhostDecision =
  | { action: "wait"; until: number }
  | { action: "answer" }
  | { action: "give_up"; reason: "answered" | "too_late" };

/**
 * Whether Ms. Fenwick should answer a player now (protocol.ts, CHAT):
 *
 * - Someone else posted after the asker's latest line: they were answered, she stays out of it.
 * - Otherwise she waits CHAT.GHOST_MS from that line (CHAT.GHOST_ALONE_MS when nobody else is in
 *   the room), and past her cooldowns: once per CHAT.FENWICK_PLAYER_COOLDOWN_MS per learner
 *   (CHAT.FENWICK_ALONE_COOLDOWN_MS when they're alone), CHAT.FENWICK_ROOM_PER_MINUTE a minute per
 *   room, FENWICK_GLOBAL_PER_MINUTE a minute in this process. If those would push her past
 *   CHAT.GHOST_MAX_MS from the line, she lets it go (an answer that late reads oddly).
 * - When the time is up and someone else is typing, she waits for them, looking again every
 *   GHOST_RECHECK_MS, but answers at CHAT.GHOST_MAX_MS regardless.
 *
 * A newer line from the asker is simply a later `askedAt`: one reply covers a burst.
 */
export function ghostDecision(s: GhostState, now: number): GhostDecision {
  if (s.otherLineAt !== null && s.otherLineAt > s.askedAt)
    return { action: "give_up", reason: "answered" };
  const latest = s.askedAt + CHAT.GHOST_MAX_MS;
  const quiet = s.askedAt + (s.othersPresent ? CHAT.GHOST_MS : CHAT.GHOST_ALONE_MS);
  const cooldown = s.othersPresent
    ? CHAT.FENWICK_PLAYER_COOLDOWN_MS
    : CHAT.FENWICK_ALONE_COOLDOWN_MS;
  const asker = s.lastForAsker === null ? -Infinity : s.lastForAsker + cooldown;
  const room = windowFree(s.roomRecent, CHAT.FENWICK_ROOM_PER_MINUTE, now);
  const all = windowFree(s.globalRecent, FENWICK_GLOBAL_PER_MINUTE, now);
  const ready = Math.max(quiet, asker, room, all);
  if (ready > latest) return { action: "give_up", reason: "too_late" };
  if (now < ready) return { action: "wait", until: ready };
  if (s.inFlight)
    return now + GHOST_RECHECK_MS > latest
      ? { action: "give_up", reason: "too_late" }
      : { action: "wait", until: now + GHOST_RECHECK_MS };
  if (s.othersTyping && now < latest)
    return { action: "wait", until: Math.min(now + GHOST_RECHECK_MS, latest) };
  return { action: "answer" };
}
