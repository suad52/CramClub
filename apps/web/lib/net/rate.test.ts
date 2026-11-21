import { describe, expect, it } from "vitest";
import { NET } from "@ovr/shared";
import {
  ChangeSender,
  type MoveMessage,
  RateGate,
  copyFace,
  copyMove,
  faceChanged,
  moveChanged,
  sanitizeFace,
} from "./rate";

const FRAME = 1000 / 60;

/** Calls `offer` every frame for `ms` and returns when it said yes. */
function run(ms: number, offer: (now: number) => boolean, from = 0) {
  const sent: number[] = [];
  for (let now = from; now < from + ms; now += FRAME) if (offer(now)) sent.push(now);
  return sent;
}

const move = (patch: Partial<MoveMessage> = {}): MoveMessage => ({
  x: 0,
  y: 0,
  z: 0,
  ry: 0,
  movement: "idle",
  speed: 0,
  ...patch,
});

describe("the send-rate gate", () => {
  it("never passes faster than its rate, offered every frame", () => {
    const gate = new RateGate(NET.MOVE_HZ);
    const sent = run(5000, (now) => gate.pass(now));
    for (let i = 1; i < sent.length; i++)
      expect(sent[i]! - sent[i - 1]!).toBeGreaterThanOrEqual(1000 / NET.MOVE_HZ);
    // ...and doesn't fall far behind it either (at 60 fps: every 5 or 6 frames).
    expect(sent.length / 5).toBeGreaterThanOrEqual(NET.MOVE_HZ - 2.5);
    expect(sent.length / 5).toBeLessThanOrEqual(NET.MOVE_HZ);
  });

  it("is open straight away, and again after a reset", () => {
    const gate = new RateGate(NET.FACE_HZ);
    expect(gate.pass(0)).toBe(true);
    expect(gate.open(10)).toBe(false);
    expect(gate.pass(10)).toBe(false);
    gate.reset();
    expect(gate.pass(11)).toBe(true);
    expect(gate.pass(11 + 1000 / NET.FACE_HZ)).toBe(true);
  });
});

describe("sending moves", () => {
  it("sends nothing while you stand still, and keeps to MOVE_HZ while you walk", () => {
    const sender = new ChangeSender(NET.MOVE_HZ, moveChanged, copyMove);
    const m = move();
    expect(sender.offer(0, m)).toBe(true);
    expect(run(3000, (now) => sender.offer(now, m), 1)).toEqual([]);
    // Walking at 3.2 m/s for two seconds.
    const walked = run(
      2000,
      (now) => {
        m.x = ((now - 4000) / 1000) * 3.2;
        m.movement = "walk";
        m.speed = 3.2;
        return sender.offer(now, m);
      },
      4000,
    );
    expect(walked.length).toBeGreaterThanOrEqual(2 * (NET.MOVE_HZ - 2.5));
    expect(walked.length).toBeLessThanOrEqual(2 * NET.MOVE_HZ + 1);
    for (let i = 1; i < walked.length; i++)
      expect(walked[i]! - walked[i - 1]!).toBeGreaterThanOrEqual(1000 / NET.MOVE_HZ);
  });

  it("remembers a copy, so a reused object still counts as a change", () => {
    const sender = new ChangeSender(NET.MOVE_HZ, moveChanged, copyMove);
    const m = move();
    sender.offer(0, m);
    m.x = 1;
    expect(sender.offer(200, m)).toBe(true);
    expect(sender.offer(400, m)).toBe(false);
  });

  it("ignores jitter but not stopping, turning or sitting down", () => {
    expect(moveChanged(move(), move({ x: 0.004, ry: 0.004, speed: 0.02 }))).toBe(false);
    expect(moveChanged(move({ movement: "walk" }), move({ movement: "idle" }))).toBe(true);
    expect(moveChanged(move(), move({ ry: 0.2 }))).toBe(true);
    expect(moveChanged(move({ ry: Math.PI - 0.003 }), move({ ry: -Math.PI + 0.003 }))).toBe(false);
    expect(moveChanged(move(), move({ movement: "sit" }))).toBe(true);
  });

  it("sends everything again after a reset (a rejoin)", () => {
    const sender = new ChangeSender(NET.MOVE_HZ, moveChanged, copyMove);
    const m = move();
    sender.offer(0, m);
    expect(sender.offer(500, m)).toBe(false);
    sender.reset();
    expect(sender.offer(501, m)).toBe(true);
  });
});

describe("sending the face", () => {
  const face = (smile = 0) => ({
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    eyeBlinkLeft: 0,
    eyeBlinkRight: 0,
    jawOpen: 0,
    smile,
    browRaise: 0,
  });

  it("keeps to FACE_HZ, and sends one null when tracking stops", () => {
    const sender = new ChangeSender(NET.FACE_HZ, faceChanged, copyFace);
    let smile = 0;
    const sent = run(1000, (now) => {
      smile = (smile + 0.05) % 1;
      return sender.offer(now, face(smile));
    });
    expect(sent.length).toBeLessThanOrEqual(NET.FACE_HZ);
    expect(sent.length).toBeGreaterThanOrEqual(NET.FACE_HZ - 2);
    const off = run(1000, (now) => sender.offer(now, null), 1000);
    expect(off.length).toBe(1);
  });

  it("repeats a still face now and then, so the server doesn't take it for switched off", () => {
    const sender = new ChangeSender(NET.FACE_HZ, faceChanged, copyFace, 1000);
    const still = face(0.4);
    const sent = run(3500, (now) => sender.offer(now, still));
    expect(sent.map((t) => Math.round(t / 1000))).toEqual([0, 1, 2, 3]);
    // Off stays off: nothing repeats a null.
    expect(sender.offer(4000, null)).toBe(true);
    expect(run(3000, (now) => sender.offer(now, null), 4001)).toEqual([]);
  });

  it("makes another player's params safe: in range, finite, written in place", () => {
    const into = face();
    const out = sanitizeFace(
      { headYaw: 4, headPitch: -9, smile: 2, jawOpen: -1, browRaise: Number.NaN, extra: "x" },
      into,
    );
    expect(out).toBe(into);
    expect(out).toMatchObject({ headYaw: 1, headPitch: -1, smile: 1, jawOpen: 0, browRaise: 0 });
    expect(sanitizeFace(null, into)).toBeNull();
    expect(sanitizeFace("smile", into)).toBeNull();
  });
});
