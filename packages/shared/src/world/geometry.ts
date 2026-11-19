/** Floor-plane geometry helpers. The library is one flat floor, so collision lives on X/Z. */

export interface Vec2 {
  x: number;
  z: number;
}

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** An oriented box footprint: centre, half extents along its local X/Z, rotation about Y. */
export interface BoxCollider {
  kind: "box";
  id: string;
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  rotationY: number;
  /** Height of the obstacle in metres; used to decide whether it blocks the camera. */
  height: number;
}

export interface CircleCollider {
  kind: "circle";
  id: string;
  x: number;
  z: number;
  radius: number;
  height: number;
}

export type Collider = BoxCollider | CircleCollider;

/** World-space unit vector for a Y rotation. Rotation 0 faces +Z; π/2 faces +X. */
export function facingVector(rotationY: number): Vec2 {
  return { x: Math.sin(rotationY), z: Math.cos(rotationY) };
}

/** Converts a local (x, z) offset of an object rotated by `rotationY` into world space. */
export function localToWorld(origin: Vec2, rotationY: number, local: Vec2): Vec2 {
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return {
    x: origin.x + local.x * c + local.z * s,
    z: origin.z - local.x * s + local.z * c,
  };
}

/** Inverse of {@link localToWorld}. */
export function worldToLocal(origin: Vec2, rotationY: number, world: Vec2): Vec2 {
  const dx = world.x - origin.x;
  const dz = world.z - origin.z;
  const c = Math.cos(rotationY);
  const s = Math.sin(rotationY);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

export function rectContains(rect: Rect, p: Vec2): boolean {
  return p.x >= rect.minX && p.x <= rect.maxX && p.z >= rect.minZ && p.z <= rect.maxZ;
}

export function distance2D(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Wraps an angle to (-π, π]. */
export function wrapAngle(angle: number): number {
  let a = angle % (Math.PI * 2);
  if (a <= -Math.PI) a += Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  return a;
}
