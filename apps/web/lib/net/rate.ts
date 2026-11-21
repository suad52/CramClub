import type { ClientMessages, FacialParams } from "@ovr/shared";

/**
 * Send-rate limiting for the browser's side of the wire. The server rate-limits every message
 * (protocol.ts), so the client never sends faster than the contract's rates, and only sends what
 * changed: someone standing still sends nothing at all.
 */

/** Lets something through at most `hz` times a second. */
export class RateGate {
  readonly intervalMs: number;
  private last = Number.NEGATIVE_INFINITY;

  constructor(hz: number) {
    this.intervalMs = 1000 / hz;
  }

  /** Whether enough time has passed since the last pass (without passing). */
  open(now: number) {
    return now - this.last >= this.intervalMs;
  }

  /** Passes (and starts the next wait) if it's open. */
  pass(now: number) {
    if (!this.open(now)) return false;
    this.last = now;
    return true;
  }

  /** The next pass is allowed straight away. */
  reset() {
    this.last = Number.NEGATIVE_INFINITY;
  }
}

/**
 * Sends a value at most `hz` times a second, and only when it differs from what was last sent.
 * `offer` is called as often as you like (every frame) and says whether to send the value now.
 * With `keepAliveMs`, a value that isn't null goes out again after that long even unchanged (the
 * server switches a face off once it has been quiet for a few seconds).
 */
export class ChangeSender<T> {
  private readonly gate: RateGate;
  private sent: T | null = null;
  private hasSent = false;
  private sentAt = Number.NEGATIVE_INFINITY;

  constructor(
    hz: number,
    /** Whether `next` is different enough from `prev` to be worth sending. */
    private readonly changed: (prev: T, next: T) => boolean,
    /** Remembers a copy of the value (into the old copy, so the caller may reuse its object). */
    private readonly copy: (value: T, into: T | null) => T,
    private readonly keepAliveMs?: number,
  ) {
    this.gate = new RateGate(hz);
  }

  /** True: send `value` now (it's remembered as sent). */
  offer(now: number, value: T): boolean {
    const due =
      !this.hasSent ||
      this.changed(this.sent as T, value) ||
      (this.keepAliveMs !== undefined && value !== null && now - this.sentAt >= this.keepAliveMs);
    if (!due || !this.gate.pass(now)) return false;
    this.sent = this.copy(value, this.sent);
    this.hasSent = true;
    this.sentAt = now;
    return true;
  }

  /** Forget what was sent (after a reconnect): the next offer goes out whatever it is. */
  reset() {
    this.hasSent = false;
    this.sentAt = Number.NEGATIVE_INFINITY;
    this.gate.reset();
  }
}

export type MoveMessage = ClientMessages["move"];

/** Smaller moves than these aren't worth a message. */
export const MOVE_EPSILON = { position: 0.01, yaw: 0.01, speed: 0.05 } as const;

export function moveChanged(a: MoveMessage, b: MoveMessage) {
  return (
    a.movement !== b.movement ||
    Math.abs(a.x - b.x) > MOVE_EPSILON.position ||
    Math.abs(a.y - b.y) > MOVE_EPSILON.position ||
    Math.abs(a.z - b.z) > MOVE_EPSILON.position ||
    Math.abs(Math.atan2(Math.sin(a.ry - b.ry), Math.cos(a.ry - b.ry))) > MOVE_EPSILON.yaw ||
    Math.abs(a.speed - b.speed) > MOVE_EPSILON.speed
  );
}

export function copyMove(m: MoveMessage, into: MoveMessage | null): MoveMessage {
  const out = into ?? { x: 0, y: 0, z: 0, ry: 0, movement: "idle", speed: 0 };
  out.x = m.x;
  out.y = m.y;
  out.z = m.z;
  out.ry = m.ry;
  out.movement = m.movement;
  out.speed = m.speed;
  return out;
}

const FACE_KEYS = [
  "headYaw",
  "headPitch",
  "headRoll",
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "jawOpen",
  "smile",
  "browRaise",
] as const satisfies readonly (keyof FacialParams)[];

/** Expression changes smaller than this don't show on a chibi face. */
export const FACE_EPSILON = 0.02;

export function faceChanged(a: FacialParams | null, b: FacialParams | null) {
  if (!a || !b) return a !== b;
  for (const key of FACE_KEYS) if (Math.abs(a[key] - b[key]) > FACE_EPSILON) return true;
  return false;
}

export function copyFace(f: FacialParams | null, into: FacialParams | null): FacialParams | null {
  if (!f) return null;
  const out = into ?? { ...f };
  for (const key of FACE_KEYS) out[key] = f[key];
  return out;
}

/**
 * Incoming face params from another player, made safe to use: numbers in range (head angles in
 * -1 … 1, the rest in 0 … 1), written into `into` so a relay at FACE_HZ doesn't allocate.
 */
export function sanitizeFace(v: unknown, into: FacialParams): FacialParams | null {
  if (!v || typeof v !== "object") return null;
  const raw = v as Record<string, unknown>;
  for (const key of FACE_KEYS) {
    const n = typeof raw[key] === "number" && Number.isFinite(raw[key]) ? (raw[key] as number) : 0;
    const head = key === "headYaw" || key === "headPitch" || key === "headRoll";
    into[key] = Math.min(1, Math.max(head ? -1 : 0, n));
  }
  return into;
}
