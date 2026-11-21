/**
 * The OVR library as data, generated from the Blender floor plan
 * (art/library/scripts/plan.py -> library-plan.json; run `pnpm library:plan` after editing it).
 * The web client places seats, whiteboards, lights and interactions from this, and the client
 * and game server share its colliders and walk surfaces.
 *
 * Coordinates are metres: +X east, +Y up, +Z south (the entrance), -Z north. Rotations turn an
 * object's local front (+Z): 0 faces south, π/2 east, π north, -π/2 west.
 */
import type { Rect, Vec2 } from "./geometry";
import plan from "./library-plan.json";
import { LEADERBOARD_COLLIDERS } from "./leaderboards";
import { LIBRARIAN_COLLIDERS, REMOVED_PLAN_ITEMS } from "./librarianDesk";

export type ZoneId =
  | "entrance"
  | "hall"
  | "gallery"
  | "quiet"
  | "collab"
  | "computers"
  | "services"
  | "lounge"
  | "reference";

export interface Zone {
  id: ZoneId;
  name: string;
  blurb: string;
  /** Floor-plan rectangles the zone covers. */
  rects: readonly Rect[];
  /** The zone applies to players standing between these heights (the gallery is above 3 m). */
  yMin: number;
  yMax: number;
}

/** Where people can stand: flat floors and stair ramps. */
export type Surface =
  | { id: string; kind: "flat"; rect: Rect; y: number }
  | {
      id: string;
      kind: "ramp";
      rect: Rect;
      axis: "x" | "z";
      /** Coordinate along `axis` where the ramp is at height y0 … and where it reaches y1. */
      from: number;
      to: number;
      y0: number;
      y1: number;
    };

/** A room (or doorway) volume the camera may occupy. */
export interface CeilingRegion {
  id: string;
  rect: Rect;
  floorY: number;
  ceilingY: number;
  /** Round rooms are approximated by their inscribed circle. */
  circle?: { x: number; z: number; radius: number };
}

/** An oriented box footprint that blocks movement between heights y0 and y1. */
export interface BoxCollider {
  kind: "box";
  id: string;
  x: number;
  z: number;
  halfW: number;
  halfD: number;
  rotationY: number;
  y0: number;
  y1: number;
}

export interface CircleCollider {
  kind: "circle";
  id: string;
  x: number;
  z: number;
  radius: number;
  y0: number;
  y1: number;
}

export type Collider = BoxCollider | CircleCollider;

export interface Seat {
  id: string;
  furnitureId: string;
  x: number;
  /** Floor level the seat stands on (0 on the ground floor, 4.6 in the gallery). */
  y: number;
  z: number;
  /** Direction the seated player faces. */
  rotationY: number;
  /** Seat surface height above its floor. */
  seatHeight: number;
  zone: ZoneId;
  /** The table it belongs to (collaborative tables use this as their whiteboard id). */
  tableId: string | null;
  /** Interaction prompt, e.g. "Study at table". */
  prompt: string;
}

export interface SpawnPoint {
  x: number;
  y: number;
  z: number;
  /** Direction the player faces on arrival. */
  rotationY: number;
}

export interface Anchor {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  rot: number;
  label: string;
  table?: string;
  level?: number;
  /** A whiteboard with no board in the room: it opens from the table's seats (B). */
  virtual?: boolean;
  /** Whiteboards: hung on a wall (one face) or a rolling stand (two faces). */
  mount?: "wall" | "mobile";
}

export interface LibraryLight {
  id: string;
  kind: "chandelier" | "pendant" | "fire" | "lamp" | "ceiling";
  x: number;
  y: number;
  z: number;
  color: string;
  intensity: number;
  distance: number;
}

export interface PlacedItem {
  id: string;
  kind: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  zone: ZoneId;
  tableId?: string;
}

const data = plan as unknown as {
  bounds: Rect;
  galleryY: number;
  stepUp: number;
  zones: Zone[];
  surfaces: Surface[];
  ceilings: CeilingRegion[];
  colliders: Collider[];
  seats: Seat[];
  spawnPoints: { x: number; y: number; z: number; rot: number }[];
  anchors: Anchor[];
  lights: LibraryLight[];
  lamps: {
    hall: { x: number; y: number; z: number }[];
    green: { x: number; y: number; z: number }[];
  };
  items: PlacedItem[];
  lift: { shaft: Rect; door_x: number; door_z: number; levels: number[] };
};

/** Bounding box of the whole building. */
export const BUILDING: Rect = data.bounds;
/** Height of the upper gallery floor. */
export const GALLERY_Y = data.galleryY;
/** Highest ledge a player walks up without stairs. */
export const STEP_UP = data.stepUp;

export const ZONES: readonly Zone[] = data.zones;
export const SURFACES: readonly Surface[] = data.surfaces;
export const CEILINGS: readonly CeilingRegion[] = data.ceilings;
/**
 * The plan's colliders plus what's built in code: the librarian's desk area (librarianDesk.ts)
 * and the hall's two leaderboards (leaderboards.ts).
 */
export const COLLIDERS: readonly Collider[] = [
  ...data.colliders.filter((c) => !(REMOVED_PLAN_ITEMS as readonly string[]).includes(c.id)),
  ...LIBRARIAN_COLLIDERS,
  ...LEADERBOARD_COLLIDERS,
];
export const SEATS: readonly Seat[] = data.seats;
export const SPAWN_POINTS: readonly SpawnPoint[] = data.spawnPoints.map((s) => ({
  x: s.x,
  y: s.y,
  z: s.z,
  rotationY: s.rot,
}));
export const ANCHORS: readonly Anchor[] = data.anchors;
export const LIBRARY_LIGHTS: readonly LibraryLight[] = data.lights;
/** Desk lamps on the hall's long tables and the rotunda's green lamps (for light pools). */
export const DESK_LAMPS = data.lamps;
export const PLACED_ITEMS: readonly PlacedItem[] = data.items.filter(
  (i) => !(REMOVED_PLAN_ITEMS as readonly string[]).includes(i.id),
);
export const LIFT = data.lift;

const inRect = (r: Rect, p: Vec2) =>
  p.x >= r.minX && p.x <= r.maxX && p.z >= r.minZ && p.z <= r.maxZ;

/** The zone a player at `p` (standing at height `y`) is in. */
export function zoneAt(p: Vec2, y = 0): Zone | undefined {
  return ZONES.find((z) => y >= z.yMin && y < z.yMax && z.rects.some((r) => inRect(r, p)));
}

/** Height of a surface at (x, z); ramps interpolate along their axis. */
export function surfaceHeight(s: Surface, p: Vec2): number {
  if (s.kind === "flat") return s.y;
  const along = s.axis === "z" ? p.z : p.x;
  const t = Math.max(0, Math.min(1, (along - s.from) / (s.to - s.from)));
  return s.y0 + (s.y1 - s.y0) * t;
}

/**
 * The floor under a player at `p` who is currently at height `y`: the highest walkable surface
 * at most a step above them. Null outside the building.
 */
export function floorAt(p: Vec2, y: number): number | null {
  let best: number | null = null;
  for (const s of SURFACES) {
    if (!inRect(s.rect, p)) continue;
    const h = surfaceHeight(s, p);
    if (h <= y + STEP_UP && (best === null || h > best)) best = h;
  }
  return best;
}
