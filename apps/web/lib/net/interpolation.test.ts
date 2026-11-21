import { describe, expect, it } from "vitest";
import { HOLD_GAP_MS, MOVE_INTERVAL_MS, type NetSample, SnapshotBuffer } from "./interpolation";

const out = (): NetSample => ({ t: 0, x: 0, y: 0, z: 0, ry: 0, speed: 0 });

describe("the interpolation buffer", () => {
  it("has nothing to show until a sample arrives, then holds the only one", () => {
    const b = new SnapshotBuffer();
    const o = out();
    expect(b.sample(100, o)).toBe(false);
    b.push(0, 1, 0, 2, 0.5, 0);
    expect(b.sample(-50, o)).toBe(true);
    expect(o).toMatchObject({ x: 1, z: 2, ry: 0.5 });
    expect(b.sample(500, o)).toBe(true);
    expect(o).toMatchObject({ x: 1, z: 2 });
  });

  it("glides between samples, and holds the newest instead of guessing ahead", () => {
    const b = new SnapshotBuffer();
    const o = out();
    b.push(0, 0, 0, 0, 0, 3);
    b.push(80, 0.24, 0, 0, 0.2, 3.2);
    b.sample(40, o);
    expect(o.x).toBeCloseTo(0.12);
    expect(o.ry).toBeCloseTo(0.1);
    expect(o.speed).toBeCloseTo(3.1);
    b.sample(200, o);
    expect(o.x).toBeCloseTo(0.24);
  });

  it("turns the short way round across ±π", () => {
    const b = new SnapshotBuffer();
    const o = out();
    b.push(0, 0, 0, 0, Math.PI - 0.1, 0);
    b.push(80, 0, 0, 0, -Math.PI + 0.1, 0);
    b.sample(40, o);
    // Halfway through a 0.2 rad turn is ±π, not 0.
    expect(Math.abs(o.ry)).toBeCloseTo(Math.PI);
  });

  it("snaps instead of gliding across a teleport (the lift)", () => {
    const b = new SnapshotBuffer();
    const o = out();
    b.push(0, 10, 0, -8, 0, 0);
    b.push(80, 10.4, 4.6, -8.4, 0, 0);
    expect(b.size).toBe(1);
    b.sample(40, o);
    expect(o).toMatchObject({ x: 10.4, y: 4.6, z: -8.4 });
  });

  it("starts a walk from where they stood after a quiet spell", () => {
    const b = new SnapshotBuffer();
    const o = out();
    b.push(0, 0, 0, 0, 0, 0);
    // Stood still for two seconds (nothing sent), then a step.
    const t = 2000;
    expect(t).toBeGreaterThan(HOLD_GAP_MS);
    b.push(t, 0.3, 0, 0, 0, 3.2);
    // Just before the new move's interval began, they're still where they stood.
    b.sample(t - MOVE_INTERVAL_MS - 1, o);
    expect(o.x).toBe(0);
    b.sample(t - MOVE_INTERVAL_MS / 2, o);
    expect(o.x).toBeCloseTo(0.15);
  });

  it("merges two updates for the same instant", () => {
    const b = new SnapshotBuffer();
    const o = out();
    b.push(10, 1, 0, 0, 0, 0);
    b.push(10, 2, 0, 0, 0, 0);
    expect(b.size).toBe(1);
    b.sample(10, o);
    expect(o.x).toBe(2);
  });

  it("keeps a fixed number of samples and drops the ones the render time has passed", () => {
    const b = new SnapshotBuffer(4);
    for (let i = 0; i < 10; i++) b.push(i * 80, i * 0.25, 0, 0, 0, 3);
    expect(b.size).toBe(4);
    const o = out();
    b.sample(6.5 * 80, o);
    expect(o.x).toBeCloseTo(6.5 * 0.25);
    // Only the segment around the render time (and what's newer) is left.
    expect(b.size).toBe(4);
    b.sample(8.5 * 80, o);
    expect(o.x).toBeCloseTo(8.5 * 0.25);
    expect(b.size).toBe(2);
  });

  it("never allocates while sampling (writes into the given object)", () => {
    const b = new SnapshotBuffer();
    b.push(0, 0, 0, 0, 0, 0);
    b.push(80, 1, 0, 0, 0, 0);
    const o = out();
    const same = o;
    b.sample(40, o);
    expect(o).toBe(same);
    expect(o.t).toBe(40);
  });
});
