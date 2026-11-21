import { ANCHORS, BUILDING, GALLERY_Y, NET, SEATS } from "@ovr/shared";
import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_CHARS,
  MOVE_BURST_M,
  RateLimiter,
  TicketLedger,
  acceptMove,
  newTracker,
  readAvatar,
  readFace,
  readMove,
  readStatus,
  seatTooFar,
} from "./rules";

const move = (x: number, z: number, y = 0) => ({
  x,
  y,
  z,
  ry: 0,
  movement: "walk" as const,
  speed: 3,
});

/** A tracker already placed at `at` (ms), with the budget it would have after standing still. */
function placed(at = 0) {
  const t = newTracker(at);
  t.placed = true;
  return t;
}

describe("rate limits", () => {
  it("allows a burst, then the steady rate, and drops the rest", () => {
    const limit = new RateLimiter(NET.MOVE_HZ, 4, 0);
    const burst = Array.from({ length: 10 }, () => limit.take(0));
    expect(burst.filter(Boolean)).toHaveLength(4);
    // One second at the contract rate always gets through (the refill has slack).
    let ok = 0;
    for (let i = 1; i <= NET.MOVE_HZ; i++) if (limit.take((i * 1000) / NET.MOVE_HZ)) ok++;
    expect(ok).toBe(NET.MOVE_HZ);
    // Twice the rate for a second loses about half.
    let fast = 0;
    for (let i = 1; i <= NET.MOVE_HZ * 2; i++)
      if (limit.take(1000 + (i * 500) / NET.MOVE_HZ)) fast++;
    expect(fast).toBeLessThan(NET.MOVE_HZ * 1.25 + 4 + 1);
  });
});

describe("moves", () => {
  it("accepts a first placement anywhere on a floor", () => {
    const t = newTracker(0);
    const out = acceptMove({ x: 0, y: 0, z: 6 }, t, move(-12, -9), 0);
    expect(out).toMatchObject({ x: -12, y: 0, z: -9, clamped: false });
    expect(t.placed).toBe(true);
  });

  it("cuts a move short when it beats the speed limit", () => {
    const t = placed(0);
    const out = acceptMove({ x: 0, y: 0, z: 0 }, t, move(20, 0), 10)!;
    expect(out.clamped).toBe(true);
    expect(out.x).toBeCloseTo(MOVE_BURST_M, 5);
    expect(out.z).toBe(0);
    // The budget is spent: right after, almost nothing more is allowed...
    const next = acceptMove(out, t, move(20, 0), 20)!;
    expect(next.x - out.x).toBeLessThan(0.1);
    // ...and it refills at NET.MAX_SPEED.
    const later = acceptMove(next, t, move(20, 0), 270)!;
    expect(later.x - next.x).toBeCloseTo(NET.MAX_SPEED * 0.25, 2);
  });

  it("lets a steady run through untouched", () => {
    const t = placed(0);
    let at = { x: -10, y: 0, z: 0 };
    for (let i = 1; i <= 24; i++) {
      const step = acceptMove(at, t, move(at.x + 5.4 / NET.MOVE_HZ, 0), (i * 1000) / NET.MOVE_HZ)!;
      expect(step.clamped).toBe(false);
      at = step;
    }
    expect(at.x).toBeCloseTo(-10 + 5.4 * 2, 5);
  });

  it("keeps players inside the building and on its floors", () => {
    // Far outside: pulled in to the building's edge, where there's no floor, so dropped.
    expect(acceptMove({ x: 0, y: 0, z: 0 }, newTracker(0), move(-500, 500), 0)).toBeNull();
    // Between the floor's edge and the outer wall: dropped too.
    expect(acceptMove({ x: 13.5, y: 0, z: 0 }, placed(0), move(14.5, 0), 0)).toBeNull();
    // A wild claim from inside is cut to the speed budget, and stays in.
    const out = acceptMove({ x: 0, y: 0, z: 0 }, placed(0), move(-500, 0), 0)!;
    expect(out.x).toBeCloseTo(-MOVE_BURST_M, 5);
    expect(out.x).toBeGreaterThan(BUILDING.minX);
  });

  it("changes floors only at a lift", () => {
    // Under the gallery, claiming to be up on it: kept on the ground floor.
    const t = placed(0);
    expect(acceptMove({ x: 0, y: 0, z: -8.5 }, t, move(0.1, -8.5, GALLERY_Y), 100)!.y).toBe(0);
    // At the lift, the same claim is believed.
    const lift = ANCHORS.find((a) => a.kind === "lift")!;
    const from = { x: lift.x, y: 0, z: lift.z };
    expect(acceptMove(from, placed(0), move(lift.x - 0.4, lift.z, GALLERY_Y), 100)!.y).toBe(
      GALLERY_Y,
    );
  });

  it("never reports a standing player as seated, and wraps the facing", () => {
    const out = acceptMove(
      { x: 0, y: 0, z: 0 },
      placed(0),
      { ...move(0, 0), movement: "sit", ry: 7, speed: 50 },
      100,
    )!;
    expect(out.movement).toBe("idle");
    expect(out.speed).toBe(NET.MAX_SPEED);
    expect(out.ry).toBeCloseTo(7 - 2 * Math.PI, 9);
  });

  it("reads only well-formed moves", () => {
    expect(readMove(move(1, 2))).toEqual(move(1, 2));
    for (const bad of [
      null,
      "move",
      { ...move(1, 2), x: Number.NaN },
      { ...move(1, 2), z: Infinity },
      { ...move(1, 2), y: "0" },
      { ...move(1, 2), movement: "fly" },
      { x: 1, y: 0, z: 0 },
    ])
      expect(readMove(bad)).toBeNull();
  });
});

describe("other messages", () => {
  it("clamps face values to their ranges and copies nothing else", () => {
    expect(
      readFace({
        headYaw: -2,
        headPitch: 0.3,
        headRoll: 5,
        eyeBlinkLeft: -1,
        eyeBlinkRight: 0.5,
        jawOpen: 9,
        smile: 0,
        browRaise: 1,
        landmarks: [1, 2, 3],
      }),
    ).toEqual({
      headYaw: -1,
      headPitch: 0.3,
      headRoll: 1,
      eyeBlinkLeft: 0,
      eyeBlinkRight: 0.5,
      jawOpen: 1,
      smile: 0,
      browRaise: 1,
    });
    expect(readFace(null)).toBeNull();
    expect(readFace({ headYaw: 0 })).toBeUndefined();
    expect(readFace("smile")).toBeUndefined();
  });

  it("accepts only known statuses", () => {
    expect(readStatus({ status: "focused" })).toBe("focused");
    expect(readStatus({ status: "asleep" })).toBeNull();
    expect(readStatus(null)).toBeNull();
  });

  it("sanitises avatars and refuses oversized or broken ones", () => {
    const stored = readAvatar({ avatar: JSON.stringify({ skin: "nope", extra: 1 }) })!;
    const parsed = JSON.parse(stored);
    expect(parsed.extra).toBeUndefined();
    expect(parsed.v).toBeGreaterThan(0);
    expect(readAvatar({ avatar: "{" })).toBeNull();
    expect(readAvatar({ avatar: "[]" })).toBeNull();
    expect(readAvatar({ avatar: " ".repeat(AVATAR_MAX_CHARS + 1) })).toBeNull();
    expect(readAvatar({ avatar: 42 })).toBeNull();
  });

  it("only seats players who are close enough, on the same floor", () => {
    const seat = SEATS[0]!;
    expect(seatTooFar(seat, { x: seat.x + 1.2, y: seat.y, z: seat.z })).toBe(false);
    expect(seatTooFar(seat, { x: seat.x + 2.5, y: seat.y, z: seat.z })).toBe(true);
    expect(seatTooFar(seat, { x: seat.x, y: seat.y + GALLERY_Y, z: seat.z })).toBe(true);
  });
});

describe("TicketLedger", () => {
  it("lets each ticket through once, until it would have expired anyway", () => {
    const ledger = new TicketLedger();
    expect(ledger.claim("a", 1000, 900)).toBe(true);
    expect(ledger.claim("a", 1000, 901)).toBe(false);
    expect(ledger.claim("b", 1000, 901)).toBe(true);
    // Long expired: forgotten at the next prune (a replay then fails verifyTicket's expiry).
    ledger.claim("c", 2000, 1100);
    expect(ledger.size).toBe(1);
  });

  it("refuses new tickets rather than forget live ones when full", () => {
    const ledger = new TicketLedger(2);
    expect(ledger.claim("a", 1000, 900)).toBe(true);
    expect(ledger.claim("b", 1000, 900)).toBe(true);
    expect(ledger.claim("c", 1000, 900)).toBe(false);
    expect(ledger.claim("a", 1000, 900)).toBe(false);
    // Once they expire there's room again.
    expect(ledger.claim("c", 2000, 1000)).toBe(true);
  });
});
