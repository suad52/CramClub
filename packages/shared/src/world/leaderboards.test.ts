import { describe, expect, it } from "vitest";
import { PLAYER } from "../constants";
import type { Vec3 } from "../types";
import { type Vec2, facingVector, localToWorld, worldToLocal } from "./geometry";
import { LEADERBOARDS, LEADERBOARD_COLLIDERS, LEADERBOARD_STAND } from "./leaderboards";
import {
  ANCHORS,
  type BoxCollider,
  COLLIDERS,
  type Collider,
  PLACED_ITEMS,
  SEATS,
  SPAWN_POINTS,
  ZONES,
  floorAt,
  zoneAt,
} from "./library";
import { isBlocked, isCameraBlocked, movePlayer } from "./physics";

/** Walks toward each waypoint in small steps, like a player holding a key. */
function walk(start: Vec3, waypoints: Vec2[], speed = 3.2, dt = 1 / 60): Vec3 {
  let p = start;
  for (const w of waypoints) {
    for (let i = 0; i < 2000; i++) {
      const dx = w.x - p.x;
      const dz = w.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.05) break;
      const s = Math.min(d, speed * dt);
      p = movePlayer(p, { x: (dx / d) * s, z: (dz / d) * s });
    }
  }
  return p;
}

const corners = (b: BoxCollider): Vec2[] =>
  [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz]) => localToWorld(b, b.rotationY, { x: sx! * b.halfW, z: sz! * b.halfD }));

/** Gap between two footprints on the floor plane (0 when they touch or overlap). */
function gap(a: BoxCollider, c: Collider): number {
  if (c.kind === "circle") {
    const l = worldToLocal(a, a.rotationY, c);
    const dx = Math.max(0, Math.abs(l.x) - a.halfW);
    const dz = Math.max(0, Math.abs(l.z) - a.halfD);
    return Math.max(0, Math.hypot(dx, dz) - c.radius);
  }
  // Separating axes: the largest gap along any box's edge normals.
  let best = 0;
  for (const box of [a, c]) {
    const f = facingVector(box.rotationY);
    for (const axis of [f, { x: f.z, z: -f.x }]) {
      const project = (pts: Vec2[]) => pts.map((p) => p.x * axis.x + p.z * axis.z);
      const pa = project(corners(a));
      const pc = project(corners(c));
      const g = Math.max(Math.min(...pc) - Math.max(...pa), Math.min(...pa) - Math.max(...pc));
      best = Math.max(best, g);
    }
  }
  return best;
}

/** Distance from a floor point to a board's footprint. */
function distanceTo(b: BoxCollider, p: Vec2) {
  return gap(b, { kind: "circle", id: "p", x: p.x, z: p.z, radius: 0, y0: 0, y1: 0 });
}

const hall = ZONES.find((z) => z.id === "hall")!.rects[0]!;
const hallMidZ = (hall.minZ + hall.maxZ) / 2;
const board = (kind: "focus" | "xp") => LEADERBOARDS.find((b) => b.kind === kind)!;
const colliderOf = (id: string) => LEADERBOARD_COLLIDERS.find((c) => c.id === id) as BoxCollider;

/** Where to stand to read a board: `d` metres out from its face. */
function standPoint(id: string, d = 1.8): Vec3 {
  const b = LEADERBOARDS.find((x) => x.id === id)!;
  const f = facingVector(b.rotationY);
  return { x: b.x + f.x * d, y: 0, z: b.z + f.z * d };
}

/** The middle of a board's painted face, in world space. */
function faceCentre(id: string): Vec3 {
  const b = LEADERBOARDS.find((x) => x.id === id)!;
  const f = facingVector(b.rotationY);
  const face = LEADERBOARD_STAND.face;
  return { x: b.x + f.x * 0.03, y: face.bottom + face.height / 2, z: b.z + f.z * 0.03 };
}

/** Nothing solid (but the board itself) on the straight line from an eye to the face. */
function canSee(eye: Vec3, id: string) {
  const to = faceCentre(id);
  for (let i = 1; i < 200; i++) {
    const t = i / 200;
    const p = {
      x: eye.x + (to.x - eye.x) * t,
      y: eye.y + (to.y - eye.y) * t,
      z: eye.z + (to.z - eye.z) * t,
    };
    if (isCameraBlocked(p, 0.02, id)) return false;
  }
  return true;
}

describe("hall leaderboards", () => {
  it("stands one on each side wall, halfway down the hall, facing the middle", () => {
    const spawn = SPAWN_POINTS[0]!;
    // Facing north from the arrival point, -X is on your left.
    const left = facingVector(spawn.rotationY + Math.PI / 2);
    expect(left.x).toBeCloseTo(-1, 6);
    const focus = board("focus");
    const xp = board("xp");
    expect(focus.x).toBeLessThan(hall.minX + 2);
    expect(xp.x).toBeGreaterThan(hall.maxX - 2);
    for (const b of [focus, xp]) {
      expect(Math.abs(b.z - hallMidZ), b.id).toBeLessThan(0.25);
      expect(zoneAt(b, 0)?.id, b.id).toBe("hall");
      expect(floorAt(b, 0), b.id).toBe(0);
      const f = facingVector(b.rotationY);
      const toMiddle = { x: -b.x, z: hallMidZ - b.z };
      const len = Math.hypot(toMiddle.x, toMiddle.z);
      expect((f.x * toMiddle.x + f.z * toMiddle.z) / len, b.id).toBeGreaterThan(0.99);
    }
  });

  it("are solid, and clear of every other collider", () => {
    for (const c of LEADERBOARD_COLLIDERS) expect(COLLIDERS).toContain(c);
    for (const b of LEADERBOARD_COLLIDERS as BoxCollider[]) {
      for (const c of COLLIDERS) {
        if (c === b || c.y1 <= b.y0 || c.y0 >= b.y1) continue;
        expect(gap(b, c), `${b.id} vs ${c.id}`).toBeGreaterThan(0.1);
      }
    }
  });

  it("keep well away from seats, furniture and the lift", () => {
    for (const b of LEADERBOARD_COLLIDERS as BoxCollider[]) {
      for (const s of SEATS.filter((s) => s.y < 1)) {
        expect(distanceTo(b, s), `${b.id} vs ${s.id}`).toBeGreaterThan(1.5);
      }
      for (const i of PLACED_ITEMS.filter((i) => i.y < 1 && i.kind !== "rug")) {
        expect(distanceTo(b, i), `${b.id} vs ${i.id}`).toBeGreaterThan(1.2);
      }
      for (const a of ANCHORS.filter((a) => a.y < 1)) {
        expect(distanceTo(b, a), `${b.id} vs ${a.id}`).toBeGreaterThan(1.2);
      }
    }
  });

  it("can be walked up to from the arrival point, but not through", () => {
    const spawn: Vec3 = { x: SPAWN_POINTS[0]!.x, y: 0, z: SPAWN_POINTS[0]!.z };
    for (const b of LEADERBOARDS) {
      const stand = standPoint(b.id);
      expect(isBlocked(stand), b.id).toBe(false);
      const p = walk(spawn, [{ x: 0, z: hallMidZ }, stand]);
      expect(Math.hypot(p.x - stand.x, p.z - stand.z), b.id).toBeLessThan(0.06);
      // Walking on into the board stops at its front edge.
      const f = facingVector(b.rotationY);
      const stopped = walk(p, [{ x: b.x - f.x, z: b.z - f.z }]);
      const reach = LEADERBOARD_STAND.footDepth / 2 + PLAYER.radius - 0.02;
      expect((stopped.x - b.x) * f.x + (stopped.z - b.z) * f.z, b.id).toBeGreaterThan(reach);
      expect(distanceTo(colliderOf(b.id), stopped), b.id).toBeGreaterThan(PLAYER.radius - 0.02);
    }
  });

  it("can be seen from the arrival point and from across the hall", () => {
    const eye = (x: number, z: number): Vec3 => ({ x, y: 1.6, z });
    for (const b of LEADERBOARDS) {
      expect(canSee(eye(SPAWN_POINTS[0]!.x, SPAWN_POINTS[0]!.z), b.id), `${b.id} from spawn`).toBe(
        true,
      );
      expect(canSee(eye(0, hallMidZ), b.id), `${b.id} from the middle`).toBe(true);
      expect(canSee(eye(-b.x * 0.9, hallMidZ), b.id), `${b.id} from the far side`).toBe(true);
      expect(canSee({ ...standPoint(b.id), y: 1.6 }, b.id), `${b.id} up close`).toBe(true);
    }
  });
});
