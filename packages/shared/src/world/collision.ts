/**
 * Floor-plane collision against the library layout. Pure functions with no rendering
 * dependencies, so the browser (prediction) and the game server (validation) share one source.
 */
import type { Collider, Vec2 } from "./geometry";
import { facingVector, localToWorld, worldToLocal } from "./geometry";
import type { FurnitureItem, Seat } from "./layout";
import { FURNITURE, FURNITURE_SPECS, ROOM } from "./layout";

/** Builds colliders for every solid furniture item plus the four outer walls. */
export function buildColliders(items: readonly FurnitureItem[] = FURNITURE): Collider[] {
  const colliders: Collider[] = [];
  for (const item of items) {
    const spec = FURNITURE_SPECS[item.kind];
    if (spec.shape === "none") continue;
    if (spec.shape === "circle") {
      colliders.push({
        kind: "circle",
        id: item.id,
        x: item.x,
        z: item.z,
        radius: spec.width / 2,
        height: spec.height,
      });
    } else {
      colliders.push({
        kind: "box",
        id: item.id,
        x: item.x,
        z: item.z,
        halfW: (item.width ?? spec.width) / 2,
        halfD: spec.depth / 2,
        rotationY: item.rotationY,
        height: spec.height,
      });
    }
  }
  // Outer walls: thick boxes just outside the interior so nothing can leave the room.
  const t = 2;
  const w = ROOM.maxX - ROOM.minX;
  const d = ROOM.maxZ - ROOM.minZ;
  const cx = (ROOM.minX + ROOM.maxX) / 2;
  const cz = (ROOM.minZ + ROOM.maxZ) / 2;
  const wall = (id: string, x: number, z: number, halfW: number, halfD: number): Collider => ({
    kind: "box",
    id,
    x,
    z,
    halfW,
    halfD,
    rotationY: 0,
    height: ROOM.height,
  });
  colliders.push(
    wall("wall-north", cx, ROOM.minZ - t / 2, w / 2 + t, t / 2),
    wall("wall-south", cx, ROOM.maxZ + t / 2, w / 2 + t, t / 2),
    wall("wall-west", ROOM.minX - t / 2, cz, t / 2, d / 2 + t),
    wall("wall-east", ROOM.maxX + t / 2, cz, t / 2, d / 2 + t),
  );
  return colliders;
}

export const WORLD_COLLIDERS: readonly Collider[] = buildColliders();

/**
 * If a circle at `p` overlaps `c`, returns the nearest position that just touches it.
 * Returns null when there is no overlap.
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
    // Centre is inside the box: leave through the nearest face.
    const penX = c.halfW - Math.abs(local.x);
    const penZ = c.halfD - Math.abs(local.z);
    out =
      penX < penZ
        ? { x: (local.x >= 0 ? 1 : -1) * (c.halfW + radius), z: local.z }
        : { x: local.x, z: (local.z >= 0 ? 1 : -1) * (c.halfD + radius) };
  }
  return localToWorld(c, c.rotationY, out);
}

/** True when a circle at `p` overlaps any collider (with a tiny tolerance). */
export function isBlocked(
  p: Vec2,
  radius: number,
  colliders: readonly Collider[] = WORLD_COLLIDERS,
): boolean {
  const r = radius - 1e-4;
  return colliders.some((c) => pushOut(p, r, c) !== null);
}

/** Pushes a circle out of every collider it overlaps. */
export function resolveCollisions(
  p: Vec2,
  radius: number,
  colliders: readonly Collider[] = WORLD_COLLIDERS,
  iterations = 4,
): Vec2 {
  let pos = { x: p.x, z: p.z };
  for (let i = 0; i < iterations; i++) {
    let moved = false;
    for (const c of colliders) {
      const out = pushOut(pos, radius, c);
      if (out) {
        pos = out;
        moved = true;
      }
    }
    if (!moved) break;
  }
  // Belt and braces: never leave the room, even if colliders disagree.
  pos.x = Math.max(ROOM.minX + radius, Math.min(ROOM.maxX - radius, pos.x));
  pos.z = Math.max(ROOM.minZ + radius, Math.min(ROOM.maxZ - radius, pos.z));
  return pos;
}

/**
 * Moves a circle by `delta`, sliding along obstacles. Long moves are split into short steps
 * so fast or laggy frames cannot tunnel through thin furniture.
 */
export function moveWithCollisions(
  from: Vec2,
  delta: Vec2,
  radius: number,
  colliders: readonly Collider[] = WORLD_COLLIDERS,
): Vec2 {
  const length = Math.hypot(delta.x, delta.z);
  const steps = Math.max(1, Math.ceil(length / (radius * 0.5)));
  let pos = { x: from.x, z: from.z };
  for (let i = 0; i < steps; i++) {
    pos = resolveCollisions(
      { x: pos.x + delta.x / steps, z: pos.z + delta.z / steps },
      radius,
      colliders,
    );
  }
  return pos;
}

/**
 * Whether a camera at `point` would sit inside geometry. Obstacles only block the camera
 * below their height, so the third-person camera can look over tables but not through shelves.
 */
export function isCameraBlocked(
  point: { x: number; y: number; z: number },
  margin: number,
  colliders: readonly Collider[] = WORLD_COLLIDERS,
): boolean {
  if (point.y < margin || point.y > ROOM.height - margin) return true;
  if (
    point.x < ROOM.minX + margin ||
    point.x > ROOM.maxX - margin ||
    point.z < ROOM.minZ + margin ||
    point.z > ROOM.maxZ - margin
  ) {
    return true;
  }
  for (const c of colliders) {
    if (point.y > c.height + margin) continue;
    if (pushOut(point, margin, c)) return true;
  }
  return false;
}

/** Finds a free spot next to a seat to stand up into: behind it first, then in front, then the sides. */
export function findStandPoint(
  seat: Seat,
  radius: number,
  colliders: readonly Collider[] = WORLD_COLLIDERS,
): Vec2 | null {
  const f = facingVector(seat.rotationY);
  const side = { x: f.z, z: -f.x };
  const candidates: Vec2[] = [];
  for (const d of [0.7, 0.85, 1.0]) {
    candidates.push({ x: seat.x - f.x * d, z: seat.z - f.z * d });
    candidates.push({ x: seat.x + f.x * d, z: seat.z + f.z * d });
    candidates.push({ x: seat.x + side.x * d, z: seat.z + side.z * d });
    candidates.push({ x: seat.x - side.x * d, z: seat.z - side.z * d });
  }
  return candidates.find((c) => !isBlocked(c, radius, colliders)) ?? null;
}
