/**
 * Player movement and camera clearance in the library: circle-vs-footprint collision on the
 * floor plane, filtered by height, plus walk surfaces so players climb the stairs to the
 * gallery. Pure functions, shared by the browser (prediction) and the game server (validation).
 */
import { PLAYER } from "../constants";
import type { Vec3 } from "../types";
import type { Vec2 } from "./geometry";
import { facingVector, localToWorld, worldToLocal } from "./geometry";
import {
  BUILDING,
  CEILINGS,
  COLLIDERS,
  type Collider,
  STEP_UP,
  type Seat,
  floorAt,
} from "./library";

/** A standing player's body spans these heights above their feet. Lower obstacles are stepped over. */
export const BODY = { bottom: STEP_UP * 0.5, top: 1.75 } as const;

/** Whether `c` is in the way of a body standing with its feet at height `y`. */
export function blocksBody(c: Collider, y: number): boolean {
  return c.y1 > y + BODY.bottom && c.y0 < y + BODY.top;
}

/**
 * If a circle at `p` overlaps the footprint of `c`, returns the nearest position that just
 * touches it, else null.
 */
export function pushOut(p: Vec2, radius: number, c: Collider): Vec2 | null {
  if (c.kind === "circle") {
    const dx = p.x - c.x;
    const dz = p.z - c.z;
    const dist = Math.hypot(dx, dz);
    const min = c.radius + radius;
    if (dist >= min) return null;
    if (dist < 1e-6) return { x: c.x + min, z: c.z };
    return { x: c.x + (dx / dist) * min, z: c.z + (dz / dist) * min };
  }
  const local = worldToLocal(c, c.rotationY, p);
  const cx = Math.max(-c.halfW, Math.min(c.halfW, local.x));
  const cz = Math.max(-c.halfD, Math.min(c.halfD, local.z));
  const dx = local.x - cx;
  const dz = local.z - cz;
  const dist = Math.hypot(dx, dz);
  if (dist >= radius) return null;
  let out: Vec2;
  if (dist > 1e-6) {
    out = { x: cx + (dx / dist) * radius, z: cz + (dz / dist) * radius };
  } else {
    const penX = c.halfW - Math.abs(local.x);
    const penZ = c.halfD - Math.abs(local.z);
    out =
      penX < penZ
        ? { x: (local.x >= 0 ? 1 : -1) * (c.halfW + radius), z: local.z }
        : { x: local.x, z: (local.z >= 0 ? 1 : -1) * (c.halfD + radius) };
  }
  return localToWorld(c, c.rotationY, out);
}

/** Coarse spatial index so each step only tests nearby colliders. */
const CELL = 4;
const grid = new Map<string, Collider[]>();
function cellKey(ix: number, iz: number) {
  return `${ix},${iz}`;
}
for (const c of COLLIDERS) {
  const r = c.kind === "circle" ? c.radius : Math.hypot(c.halfW, c.halfD);
  for (let ix = Math.floor((c.x - r) / CELL); ix <= Math.floor((c.x + r) / CELL); ix++) {
    for (let iz = Math.floor((c.z - r) / CELL); iz <= Math.floor((c.z + r) / CELL); iz++) {
      const k = cellKey(ix, iz);
      const list = grid.get(k);
      if (list) list.push(c);
      else grid.set(k, [c]);
    }
  }
}

/** Colliders whose footprint might be within `reach` of `p`. */
export function nearbyColliders(p: Vec2, reach = 1): Collider[] {
  const out = new Set<Collider>();
  for (let ix = Math.floor((p.x - reach) / CELL); ix <= Math.floor((p.x + reach) / CELL); ix++) {
    for (let iz = Math.floor((p.z - reach) / CELL); iz <= Math.floor((p.z + reach) / CELL); iz++) {
      for (const c of grid.get(cellKey(ix, iz)) ?? []) out.add(c);
    }
  }
  return [...out];
}

/** True when a player of `radius` with feet at `p.y` would overlap something. */
export function isBlocked(p: Vec3, radius: number = PLAYER.radius): boolean {
  const r = radius - 1e-4;
  return nearbyColliders(p, radius + 0.5).some(
    (c) => blocksBody(c, p.y) && pushOut(p, r, c) !== null,
  );
}

function resolve(p: Vec3, radius: number): Vec3 {
  let pos = { ...p };
  const near = nearbyColliders(p, radius + 1).filter((c) => blocksBody(c, p.y));
  for (let i = 0; i < 4; i++) {
    let moved = false;
    for (const c of near) {
      const out = pushOut(pos, radius, c);
      if (out) {
        pos = { x: out.x, y: pos.y, z: out.z };
        moved = true;
      }
    }
    if (!moved) break;
  }
  pos.x = Math.max(BUILDING.minX + radius, Math.min(BUILDING.maxX - radius, pos.x));
  pos.z = Math.max(BUILDING.minZ + radius, Math.min(BUILDING.maxZ - radius, pos.z));
  return pos;
}

/**
 * Moves a player by `delta` on the floor plane, sliding along obstacles and following the
 * floor up and down stairs. Long moves are split so fast frames can't tunnel through things.
 */
export function movePlayer(from: Vec3, delta: Vec2, radius: number = PLAYER.radius): Vec3 {
  const length = Math.hypot(delta.x, delta.z);
  const steps = Math.max(1, Math.ceil(length / (radius * 0.4)));
  let pos = { ...from };
  for (let i = 0; i < steps; i++) {
    const next = { x: pos.x + delta.x / steps, y: pos.y, z: pos.z + delta.z / steps };
    const floor = floorAt(next, pos.y);
    if (floor === null) continue; // the edge of the world: stay put on this axis
    next.y = floor;
    const resolved = resolve(next, radius);
    const settled = floorAt(resolved, pos.y);
    if (settled === null) continue;
    pos = { x: resolved.x, y: settled, z: resolved.z };
  }
  return pos;
}

/**
 * Whether a camera at `point` would be inside a wall, floor, ceiling or tall furniture.
 * The camera must be inside some room or doorway volume, and obstacles only block it within
 * their height range, so it can look over tables but not through shelves or the gallery floor.
 * `ignoreId` skips one collider: the chair you're sitting in, whose back would otherwise pin a
 * seated player's third-person camera to the back of their head.
 */
export function isCameraBlocked(point: Vec3, margin: number, ignoreId?: string): boolean {
  const inside = CEILINGS.some((r) => {
    if (point.y < r.floorY + margin || point.y > r.ceilingY - margin) return false;
    if (r.circle)
      return Math.hypot(point.x - r.circle.x, point.z - r.circle.z) <= r.circle.radius - margin;
    return (
      point.x >= r.rect.minX + (r.id.startsWith("passage_") ? 0 : margin) &&
      point.x <= r.rect.maxX - (r.id.startsWith("passage_") ? 0 : margin) &&
      point.z >= r.rect.minZ + (r.id.startsWith("passage_") ? 0 : margin) &&
      point.z <= r.rect.maxZ - (r.id.startsWith("passage_") ? 0 : margin)
    );
  });
  if (!inside) return true;
  for (const c of nearbyColliders(point, margin + 0.5)) {
    if (c.id === ignoreId) continue;
    if (point.y < c.y0 - margin || point.y > c.y1 + margin) continue;
    if (pushOut(point, margin, c)) return true;
  }
  return false;
}

/**
 * A free spot next to a seat to stand up into: behind it first, then in front, then the sides,
 * then diagonally behind (for chairs boxed in by a column on one side and a whiteboard on the other).
 */
export function findStandPoint(seat: Seat, radius: number = PLAYER.radius): Vec3 | null {
  const f = facingVector(seat.rotationY);
  const side = { x: f.z, z: -f.x };
  for (const d of [0.7, 0.85, 1.0, 1.15]) {
    for (const c of [
      { x: seat.x - f.x * d, z: seat.z - f.z * d },
      { x: seat.x + f.x * d, z: seat.z + f.z * d },
      { x: seat.x + side.x * d, z: seat.z + side.z * d },
      { x: seat.x - side.x * d, z: seat.z - side.z * d },
      {
        x: seat.x + (side.x - f.x) * d * Math.SQRT1_2,
        z: seat.z + (side.z - f.z) * d * Math.SQRT1_2,
      },
      {
        x: seat.x - (side.x + f.x) * d * Math.SQRT1_2,
        z: seat.z - (side.z + f.z) * d * Math.SQRT1_2,
      },
    ]) {
      const floor = floorAt(c, seat.y);
      if (floor === null || Math.abs(floor - seat.y) > 0.05) continue;
      const p = { x: c.x, y: floor, z: c.z };
      if (!isBlocked(p, radius)) return p;
    }
  }
  return null;
}
