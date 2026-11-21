import { describe, expect, it } from "vitest";
import { PLAYER } from "../constants";
import { ANCHORS, GALLERY_Y, SEATS, SPAWN_POINTS, ZONES, floorAt, zoneAt } from "./library";
import type { Vec3 } from "../types";
import { findStandPoint, isBlocked, isCameraBlocked, movePlayer } from "./physics";

/** Walks toward each waypoint in small steps, like a player holding a key. */
function walk(start: Vec3, waypoints: { x: number; z: number }[], speed = 3.2, dt = 1 / 60): Vec3 {
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

const spawn = (): Vec3 => ({ x: SPAWN_POINTS[0]!.x, y: SPAWN_POINTS[0]!.y, z: SPAWN_POINTS[0]!.z });

describe("library plan", () => {
  it("has unique seat ids and seats on real floors", () => {
    expect(new Set(SEATS.map((s) => s.id)).size).toBe(SEATS.length);
    for (const s of SEATS) expect(floorAt(s, s.y + 0.1), s.id).toBeCloseTo(s.y, 3);
  });

  it("spawns players on the floor, somewhere free", () => {
    for (const p of SPAWN_POINTS) {
      expect(floorAt(p, 0)).toBe(0);
      expect(isBlocked(p)).toBe(false);
    }
  });

  it("lets a player stand up from every seat", () => {
    const stuck = SEATS.filter((s) => !findStandPoint(s));
    expect(stuck.map((s) => s.id)).toEqual([]);
  });

  it("is just the reading hall and its gallery", () => {
    expect(ZONES.map((z) => z.id).sort()).toEqual(["gallery", "hall"]);
    expect(zoneAt({ x: 0, z: -1 })?.id).toBe("hall");
    expect(zoneAt({ x: 0, z: -8.5 }, GALLERY_Y)?.id).toBe("gallery");
    expect(zoneAt({ x: 0, z: 15 })).toBeUndefined(); // the old entrance lobby is walled off
  });

  it("puts both lift call points somewhere a player can stand", () => {
    const lifts = ANCHORS.filter((a) => a.kind === "lift");
    expect(lifts.map((a) => a.y).sort()).toEqual([0, GALLERY_Y]);
    for (const a of lifts) {
      expect(floorAt(a, a.y + 0.1), a.id).toBeCloseTo(a.y, 3);
      expect(isBlocked({ x: a.x, y: a.y, z: a.z }), a.id).toBe(false);
    }
  });

  it("gives every reading table a shared whiteboard", () => {
    const tables = new Set(
      SEATS.filter((s) => s.zone === "hall" && s.tableId).map((s) => s.tableId),
    );
    const boards = new Set(ANCHORS.filter((a) => a.kind === "whiteboard").map((a) => a.table));
    expect(tables.size).toBe(12);
    expect([...tables].sort()).toEqual([...boards].sort());
  });
});

describe("moving around", () => {
  it("walks from the arrival point the length of the hall", () => {
    const p = walk(spawn(), [
      { x: 0, z: -1 },
      { x: 12, z: -1 },
      { x: -12, z: -1 },
    ]);
    expect(p.x).toBeCloseTo(-12, 1);
    expect(p.y).toBe(0);
    expect(zoneAt(p, p.y)?.id).toBe("hall");
  });

  it("walks round the gallery from the lift", () => {
    const lift = ANCHORS.find((a) => a.kind === "lift" && a.y === GALLERY_Y)!;
    const p = walk({ x: lift.x, y: lift.y, z: lift.z }, [
      { x: -12.5, z: -8.6 },
      { x: -12.5, z: 6.6 },
      { x: 10, z: 6.6 },
    ]);
    expect(p.y).toBeCloseTo(GALLERY_Y, 2);
    expect(p.x).toBeCloseTo(10, 1);
    expect(zoneAt(p, p.y)?.id).toBe("gallery");
  });

  it("can't leave the hall through the old doorways", () => {
    // South to the old lobby arch, west to the lounge arch, east to the rotunda arch.
    expect(walk(spawn(), [{ x: 0, z: 12 }]).z).toBeLessThan(7.6);
    expect(walk({ x: -9, y: 0, z: -1 }, [{ x: -18, z: -1 }]).x).toBeGreaterThan(-13.6);
    expect(walk({ x: 9, y: 0, z: -1 }, [{ x: 18, z: -1 }]).x).toBeLessThan(13.6);
  });

  it("keeps gallery walkers behind the railing", () => {
    const p = walk({ x: 0, y: GALLERY_Y, z: -8.6 }, [{ x: 0, z: -3 }]);
    expect(p.y).toBeCloseTo(GALLERY_Y, 2);
    expect(p.z).toBeLessThan(-7.4 - PLAYER.radius + 0.05);
  });

  it("walks under the gallery on the ground floor without climbing onto it", () => {
    // Through the bay west of the librarian's desk (which fills the middle one).
    const p = walk({ x: 0, y: 0, z: -1 }, [
      { x: -4.0, z: -1.2 },
      { x: -4.0, z: -8.7 },
      { x: -9, z: -8.7 },
    ]);
    expect(p.y).toBe(0);
    expect(p.x).toBeCloseTo(-9, 1);
  });

  it("can't walk through the librarian's desk", () => {
    const p = walk({ x: 0, y: 0, z: -6.8 }, [{ x: 0, z: -8.8 }]);
    expect(p.z).toBeGreaterThan(-7.45);
  });
});

describe("camera clearance", () => {
  it("is free in open air and blocked inside solid things", () => {
    expect(isCameraBlocked({ x: 0, y: 8, z: -1 }, 0.2)).toBe(false);
    expect(isCameraBlocked({ x: 0, y: 1.2, z: -1 }, 0.2)).toBe(false);
    expect(isCameraBlocked({ x: 0, y: 13.5, z: -1 }, 0.2)).toBe(true); // above the hall ceiling
    expect(isCameraBlocked({ x: 0, y: 4.4, z: -8.5 }, 0.2)).toBe(true); // inside the gallery floor
    expect(isCameraBlocked({ x: 0, y: 2, z: -10.4 }, 0.2)).toBe(true); // inside the north wall
    expect(isCameraBlocked({ x: -1, y: 2, z: -9.8 }, 0.2)).toBe(true); // inside a bookcase
    expect(isCameraBlocked({ x: 0, y: 2, z: 9.5 }, 0.2)).toBe(true); // outside, where the lobby was
    expect(isCameraBlocked({ x: 0, y: 1.6, z: 8.4 }, 0.2)).toBe(true); // in the walled-up arch
  });

  it("can ignore the chair you're sitting in", () => {
    // Just above a hall chair's back, where a seated player's third-person camera starts out.
    const seat = SEATS.find((s) => s.id === "hall-t01-c5")!;
    const camera = { x: seat.x, y: seat.y + 1.12, z: seat.z };
    expect(isCameraBlocked(camera, 0.22)).toBe(true);
    expect(isCameraBlocked(camera, 0.22, seat.furnitureId)).toBe(false);
  });
});
