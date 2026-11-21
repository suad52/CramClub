/**
 * The library room's rules as pure functions, so they're tested without sockets: rate limits,
 * message validation, movement checks and seat distance. LibraryRoom.ts wires them to messages.
 */
import {
  ANCHORS,
  BUILDING,
  type ClientMessages,
  type FacialParams,
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
