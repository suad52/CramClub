import { describe, expect, it } from "vitest";
import { PLAYER } from "../constants";
import type { BoxCollider, Collider, Vec2 } from "./geometry";
import { localToWorld, worldToLocal } from "./geometry";
import {
  WORLD_COLLIDERS,
  findStandPoint,
  isBlocked,
  isCameraBlocked,
  moveWithCollisions,
  pushOut,
} from "./collision";
import { FURNITURE, ROOM, SEATS, SPAWN_POINTS, ZONES, zoneAt } from "./layout";

const furnitureColliders = WORLD_COLLIDERS.filter((c) => !c.id.startsWith("wall-"));

function corners(b: BoxCollider): Vec2[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sz]) => localToWorld(b, b.rotationY, { x: sx! * b.halfW, z: sz! * b.halfD }));
}

/** Separating-axis overlap test with a small tolerance so touching edges don't count. */
function overlaps(a: Collider, b: Collider, tolerance = 0.005): boolean {
  if (a.kind === "circle" && b.kind === "circle") {
    return Math.hypot(a.x - b.x, a.z - b.z) < a.radius + b.radius - tolerance;
  }
  if (a.kind === "circle") return pushOut(a, a.radius - tolerance, b) !== null;
  if (b.kind === "circle") return pushOut(b, b.radius - tolerance, a) !== null;
  const ca = corners(a);
  const cb = corners(b);
  for (const box of [a, b]) {
    for (const axisAngle of [box.rotationY, box.rotationY + Math.PI / 2]) {
      const ax = { x: Math.cos(axisAngle), z: -Math.sin(axisAngle) };
      const project = (pts: Vec2[]) => pts.map((p) => p.x * ax.x + p.z * ax.z);
      const pa = project(ca);
      const pb = project(cb);
      if (
        Math.max(...pa) - tolerance <= Math.min(...pb) ||
        Math.max(...pb) - tolerance <= Math.min(...pa)
      ) {
        return false;
      }
    }
  }
  return true;
}

describe("geometry", () => {
  it("round-trips local and world coordinates", () => {
    const origin = { x: 3, z: -2 };
    const local = { x: 1.25, z: -0.5 };
    const back = worldToLocal(origin, 0.7, localToWorld(origin, 0.7, local));
    expect(back.x).toBeCloseTo(local.x);
    expect(back.z).toBeCloseTo(local.z);
  });
});

describe("library layout", () => {
  it("gives every item a unique id", () => {
    const ids = FURNITURE.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps all furniture inside the room", () => {
    for (const c of furnitureColliders) {
      const pts = c.kind === "box" ? corners(c) : [{ x: c.x, z: c.z }];
      const r = c.kind === "circle" ? c.radius : 0;
      for (const p of pts) {
        expect(p.x - r, c.id).toBeGreaterThanOrEqual(ROOM.minX - 0.01);
        expect(p.x + r, c.id).toBeLessThanOrEqual(ROOM.maxX + 0.01);
        expect(p.z - r, c.id).toBeGreaterThanOrEqual(ROOM.minZ - 0.01);
        expect(p.z + r, c.id).toBeLessThanOrEqual(ROOM.maxZ + 0.01);
      }
    }
  });

  it("has no overlapping furniture", () => {
    const clashes: string[] = [];
    for (let i = 0; i < furnitureColliders.length; i++) {
      for (let j = i + 1; j < furnitureColliders.length; j++) {
        const a = furnitureColliders[i]!;
        const b = furnitureColliders[j]!;
        if (overlaps(a, b)) clashes.push(`${a.id} × ${b.id}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it("covers the whole floor with zones", () => {
    for (let x = ROOM.minX + 0.05; x < ROOM.maxX; x += 0.5) {
      for (let z = ROOM.minZ + 0.05; z < ROOM.maxZ; z += 0.5) {
        expect(zoneAt({ x, z }), `${x},${z}`).toBeDefined();
      }
    }
    expect(new Set(ZONES.map((z) => z.id)).size).toBe(ZONES.length);
  });

  it("has free spawn points in the main hall", () => {
    expect(SPAWN_POINTS.length).toBeGreaterThanOrEqual(5);
    for (const s of SPAWN_POINTS) {
      expect(isBlocked(s, PLAYER.radius)).toBe(false);
      expect(zoneAt(s)?.id).toBe("hall");
    }
  });

  it("lets a player stand up from every seat", () => {
    expect(SEATS.length).toBeGreaterThan(30);
    for (const seat of SEATS) {
      expect(findStandPoint(seat, PLAYER.radius), seat.id).not.toBeNull();
    }
  });

  it("can walk from the entrance to every seat", () => {
    // Flood-fill a 10 cm grid of positions a player fits into, starting at the first spawn.
    const step = 0.1;
    const cols = Math.round((ROOM.maxX - ROOM.minX) / step);
    const rows = Math.round((ROOM.maxZ - ROOM.minZ) / step);
    const toCell = (p: Vec2) =>
      [Math.round((p.x - ROOM.minX) / step), Math.round((p.z - ROOM.minZ) / step)] as const;
    const free = (cx: number, cz: number) =>
      !isBlocked({ x: ROOM.minX + cx * step, z: ROOM.minZ + cz * step }, PLAYER.radius);
    const seen = new Uint8Array(cols * rows);
    const [sx, sz] = toCell(SPAWN_POINTS[0]!);
    const queue: number[] = [sz * cols + sx];
    seen[queue[0]!] = 1;
    while (queue.length) {
      const idx = queue.pop()!;
      const cx = idx % cols;
      const cz = Math.floor(idx / cols);
      for (const [nx, nz] of [
        [cx + 1, cz],
        [cx - 1, cz],
        [cx, cz + 1],
        [cx, cz - 1],
      ] as const) {
        if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
        const n = nz * cols + nx;
        if (seen[n] || !free(nx, nz)) continue;
        seen[n] = 1;
        queue.push(n);
      }
    }
    const unreachable = SEATS.filter((seat) => {
      const stand = findStandPoint(seat, PLAYER.radius);
      if (!stand) return true;
      const [cx, cz] = toCell(stand);
      // Allow the stand point to sit within one cell of the reached region.
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (seen[(cz + dz) * cols + (cx + dx)]) return false;
        }
      }
      return true;
    }).map((s) => s.id);
    expect(unreachable).toEqual([]);
  });

  it("gives every collaborative table seat a table id", () => {
    const collabSeats = SEATS.filter((s) => s.prompt === "Study at table");
    expect(collabSeats.length).toBeGreaterThanOrEqual(16);
    for (const s of collabSeats) expect(s.tableId).toMatch(/^collab-table-/);
  });
});

describe("collision", () => {
  it("never lets a player walk through the outer wall", () => {
    const end = moveWithCollisions({ x: 0, z: 9.8 }, { x: 0, z: 100 }, PLAYER.radius);
    expect(end.z).toBeLessThanOrEqual(ROOM.maxZ - PLAYER.radius + 1e-6);
  });

  it("stops at a table instead of passing through it", () => {
    // collab-table-1 is centred at (-3.4, -7.4), 1.2 m across in X.
    const end = moveWithCollisions({ x: -1.5, z: -7.4 }, { x: -4, z: 0 }, PLAYER.radius);
    expect(end.x).toBeGreaterThan(-3.4);
  });

  it("slides along a wall when moving diagonally into it", () => {
    const end = moveWithCollisions({ x: 0, z: 9.8 }, { x: 0.5, z: 5 }, PLAYER.radius);
    expect(end.x).toBeGreaterThan(0.4);
  });

  it("blocks the camera inside shelves but not above tables", () => {
    const shelf = FURNITURE.find((f) => f.kind === "shelfRow")!;
    expect(isCameraBlocked({ x: shelf.x, y: 1.5, z: shelf.z }, 0.2)).toBe(true);
    const table = FURNITURE.find((f) => f.id === "collab-table-1")!;
    expect(isCameraBlocked({ x: table.x, y: 1.6, z: table.z }, 0.2)).toBe(false);
    expect(isCameraBlocked({ x: 0, y: ROOM.height + 1, z: 0 }, 0.2)).toBe(true);
  });
});
