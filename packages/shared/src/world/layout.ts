/**
 * The OVR library floor plan. This is data, not rendering: the web client builds the 3D scene
 * from it and the game server will validate movement against the colliders derived from it.
 *
 * Coordinates are metres. +Y is up, -Z is north (the big windows), +Z is south (the entrance),
 * +X is east. An item's `rotationY` turns its local +Z ("front") toward the facing direction.
 */
import type { Rect, Vec2 } from "./geometry";
import { localToWorld } from "./geometry";

export const ROOM = {
  minX: -16,
  maxX: 16,
  minZ: -12,
  maxZ: 12,
  height: 7,
  wallThickness: 0.4,
} as const;

export const ROOM_BOUNDS: Rect = {
  minX: ROOM.minX,
  maxX: ROOM.maxX,
  minZ: ROOM.minZ,
  maxZ: ROOM.maxZ,
};

export type WallSide = "north" | "south" | "east" | "west";

export interface WindowSpec {
  id: string;
  wall: WallSide;
  /** Centre along the wall: X for north/south walls, Z for east/west walls. */
  center: number;
  width: number;
  sill: number;
  top: number;
}

export const WINDOWS: readonly WindowSpec[] = [
  ...[-11, -5.5, 0, 5.5, 11].map((x, i) => ({
    id: `window-north-${i + 1}`,
    wall: "north" as const,
    center: x,
    width: 2.4,
    sill: 1.1,
    top: 5.9,
  })),
  ...[-9.0, -4.2].map((z, i) => ({
    id: `window-east-${i + 1}`,
    wall: "east" as const,
    center: z,
    width: 2.4,
    sill: 1.45,
    top: 5.4,
  })),
];

export const ENTRANCE = { wall: "south" as const, center: 0, width: 2.4, height: 3.4 };

export type ZoneId = "hall" | "collab" | "quiet" | "stacks" | "lounge";

export interface Zone {
  id: ZoneId;
  name: string;
  blurb: string;
  bounds: Rect;
}

export const ZONES: readonly Zone[] = [
  {
    id: "stacks",
    name: "Resource Stacks",
    blurb: "Shelves by subject",
    bounds: { minX: -16, maxX: -6, minZ: -12, maxZ: 12 },
  },
  {
    id: "collab",
    name: "Collaborative Tables",
    blurb: "Study together, talk freely",
    bounds: { minX: -6, maxX: 6, minZ: -12, maxZ: 0.6 },
  },
  {
    id: "hall",
    name: "Main Hall",
    blurb: "Welcome to OVR",
    bounds: { minX: -6, maxX: 6, minZ: 0.6, maxZ: 12 },
  },
  {
    id: "quiet",
    name: "Quiet Study",
    blurb: "Heads down, voices low",
    bounds: { minX: 6, maxX: 16, minZ: -12, maxZ: 0.5 },
  },
  {
    id: "lounge",
    name: "Reading Lounge",
    blurb: "Sofas, a fire, and chat",
    bounds: { minX: 6, maxX: 16, minZ: 0.5, maxZ: 12 },
  },
];

export type FurnitureKind =
  | "wallShelf"
  | "shelfRow"
  | "collabTable"
  | "roundTable"
  | "readingTable"
  | "carrel"
  | "chair"
  | "armchair"
  | "sofa"
  | "windowSeat"
  | "coffeeTable"
  | "plant"
  | "floorLamp"
  | "column"
  | "whiteboard"
  | "circulationDesk"
  | "fireplace"
  | "globe"
  | "rug"
  | "noticeBoard";

export interface FurnitureSpec {
  /** Footprint along local X (diameter for circles). */
  width: number;
  /** Footprint along local Z. */
  depth: number;
  height: number;
  /** Collision shape on the floor plane. "none" = walk-through (rugs, wall-mounted boards). */
  shape: "box" | "circle" | "none";
  /** Local seat positions, if people can sit on it. */
  seats?: readonly Vec2[];
  seatHeight?: number;
}

export const FURNITURE_SPECS: Record<FurnitureKind, FurnitureSpec> = {
  wallShelf: { width: 2, depth: 0.5, height: 3.3, shape: "box" },
  shelfRow: { width: 1.8, depth: 0.9, height: 2.3, shape: "box" },
  collabTable: { width: 2.6, depth: 1.2, height: 0.76, shape: "box" },
  roundTable: { width: 1.6, depth: 1.6, height: 0.76, shape: "circle" },
  readingTable: { width: 1.8, depth: 1.0, height: 0.76, shape: "box" },
  carrel: { width: 1.2, depth: 0.65, height: 1.25, shape: "box" },
  chair: {
    width: 0.48,
    depth: 0.48,
    height: 0.92,
    shape: "box",
    seats: [{ x: 0, z: 0 }],
    seatHeight: 0.46,
  },
  armchair: {
    width: 0.95,
    depth: 0.9,
    height: 0.95,
    shape: "box",
    seats: [{ x: 0, z: 0.06 }],
    seatHeight: 0.42,
  },
  sofa: {
    width: 2.1,
    depth: 0.92,
    height: 0.9,
    shape: "box",
    seats: [
      { x: -0.62, z: 0.06 },
      { x: 0, z: 0.06 },
      { x: 0.62, z: 0.06 },
    ],
    seatHeight: 0.42,
  },
  windowSeat: {
    width: 2.2,
    depth: 0.6,
    height: 0.5,
    shape: "box",
    seats: [
      { x: -0.5, z: 0.02 },
      { x: 0.5, z: 0.02 },
    ],
    seatHeight: 0.46,
  },
  coffeeTable: { width: 1.2, depth: 0.7, height: 0.42, shape: "box" },
  plant: { width: 0.7, depth: 0.7, height: 1.5, shape: "circle" },
  floorLamp: { width: 0.4, depth: 0.4, height: 1.7, shape: "circle" },
  column: { width: 0.64, depth: 0.64, height: ROOM.height, shape: "circle" },
  whiteboard: { width: 1.8, depth: 0.55, height: 1.95, shape: "box" },
  circulationDesk: { width: 3, depth: 0.9, height: 1.05, shape: "box" },
  fireplace: { width: 2.4, depth: 0.7, height: 2.3, shape: "box" },
  globe: { width: 0.8, depth: 0.8, height: 1.25, shape: "circle" },
  rug: { width: 4.6, depth: 3.6, height: 0.02, shape: "none" },
  noticeBoard: { width: 1.7, depth: 0.08, height: 2.4, shape: "none" },
};

export interface FurnitureItem {
  id: string;
  kind: FurnitureKind;
  x: number;
  z: number;
  rotationY: number;
  zone: ZoneId;
  /** Overrides the spec width (shelves come in different lengths). */
  width?: number;
  /** Overrides the spec depth (rugs). */
  depth?: number;
  /** Deterministic seed for decoration (book colours, plant shape). */
  seed?: number;
  /** Chairs at a table point at it; collaborative tables use this as their stable board id. */
  tableId?: string;
  /** Subject shown on resource shelves. */
  subject?: string;
  /** Short text for signs/boards. */
  label?: string;
}

export interface Seat {
  id: string;
  furnitureId: string;
  x: number;
  z: number;
  /** Direction the seated player faces. */
  rotationY: number;
  seatHeight: number;
  zone: ZoneId;
  tableId?: string;
  /** Interaction prompt, e.g. "Study at table". */
  prompt: string;
}

export interface SpawnPoint {
  x: number;
  z: number;
  rotationY: number;
}

const HALF_PI = Math.PI / 2;

// ── Builders ──────────────────────────────────────────────────────────────

function chairsAroundRectTable(
  table: FurnitureItem,
  perSide: number,
  zone: ZoneId,
  sides: "long" | "all" = "long",
): FurnitureItem[] {
  const spec = FURNITURE_SPECS[table.kind];
  const chairs: FurnitureItem[] = [];
  const offset = spec.depth / 2 + 0.45;
  const spacing = Math.min(0.85, spec.width / perSide);
  for (const side of [1, -1] as const) {
    for (let i = 0; i < perSide; i++) {
      const along = (i - (perSide - 1) / 2) * spacing;
      const p = localToWorld(table, table.rotationY, { x: along, z: side * offset });
      chairs.push({
        id: `${table.id}-chair-${side === 1 ? "a" : "b"}${i + 1}`,
        kind: "chair",
        x: p.x,
        z: p.z,
        // Face back toward the table.
        rotationY: table.rotationY + (side === 1 ? Math.PI : 0),
        zone,
        tableId: table.id,
      });
    }
  }
  if (sides === "all") {
    const endOffset = spec.width / 2 + 0.45;
    for (const side of [1, -1] as const) {
      const p = localToWorld(table, table.rotationY, { x: side * endOffset, z: 0 });
      chairs.push({
        id: `${table.id}-chair-end${side === 1 ? "a" : "b"}`,
        kind: "chair",
        x: p.x,
        z: p.z,
        rotationY: table.rotationY + (side === 1 ? -HALF_PI : HALF_PI),
        zone,
        tableId: table.id,
      });
    }
  }
  return chairs;
}

function chairsAroundRoundTable(
  table: FurnitureItem,
  count: number,
  zone: ZoneId,
): FurnitureItem[] {
  const radius = FURNITURE_SPECS.roundTable.width / 2 + 0.38;
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.PI / 4 + (i / count) * Math.PI * 2;
    const x = table.x + Math.sin(angle) * radius;
    const z = table.z + Math.cos(angle) * radius;
    return {
      id: `${table.id}-chair-${i + 1}`,
      kind: "chair" as const,
      x,
      z,
      rotationY: angle + Math.PI,
      zone,
      tableId: table.id,
    };
  });
}

/** A carrel plus the chair in front of it. `rotationY` is the direction the student faces. */
function carrelWithChair(id: string, x: number, z: number, facing: number): FurnitureItem[] {
  // The carrel's local front (+Z) points at the student, i.e. opposite the facing direction.
  const carrel: FurnitureItem = {
    id,
    kind: "carrel",
    x,
    z,
    rotationY: facing + Math.PI,
    zone: "quiet",
  };
  const chairPos = localToWorld(carrel, carrel.rotationY, { x: 0, z: 0.62 });
  return [
    carrel,
    {
      id: `${id}-chair`,
      kind: "chair",
      x: chairPos.x,
      z: chairPos.z,
      rotationY: facing,
      zone: "quiet",
    },
  ];
}

/** A run of shelf units laid end to end along a line. */
function shelfRun(
  prefix: string,
  kind: "wallShelf" | "shelfRow",
  start: Vec2,
  axis: "x" | "z",
  count: number,
  unitWidth: number,
  rotationY: number,
  zone: ZoneId,
  subject?: string,
): FurnitureItem[] {
  return Array.from({ length: count }, (_, i) => {
    const along = (i + 0.5) * unitWidth;
    return {
      id: `${prefix}-${i + 1}`,
      kind,
      x: axis === "x" ? start.x + along : start.x,
      z: axis === "z" ? start.z + along : start.z,
      rotationY,
      zone,
      width: unitWidth,
      seed: hashString(`${prefix}-${i + 1}`),
      subject,
    };
  });
}

/** Small deterministic string hash (FNV-1a) for decoration seeds. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// ── The floor plan ────────────────────────────────────────────────────────

function buildFurniture(): FurnitureItem[] {
  const items: FurnitureItem[] = [];
  const add = (...more: FurnitureItem[]) => items.push(...more);

  // Structure: four timber columns that carry the ceiling beams.
  for (const [x, z] of [
    [-6.2, -5],
    [6.2, -5],
    [-6.2, 4.5],
    [6.2, 4.5],
  ] as const) {
    add({
      id: `column-${x}-${z}`,
      kind: "column",
      x,
      z,
      rotationY: 0,
      zone: x < 0 ? "stacks" : "quiet",
    });
  }

  // ── Resource Stacks (west) ──
  // Floor-to-ceiling-ish shelving along the whole west wall, facing east.
  add(
    ...shelfRun(
      "shelf-west",
      "wallShelf",
      { x: ROOM.minX + 0.25, z: -11 },
      "z",
      11,
      2,
      HALF_PI,
      "stacks",
    ),
  );
  // South wall, west of the entrance, facing north.
  add(
    ...shelfRun(
      "shelf-south-w",
      "wallShelf",
      { x: -15.5, z: ROOM.maxZ - 0.25 },
      "x",
      5,
      2,
      Math.PI,
      "stacks",
    ),
  );
  // Freestanding double-sided rows, north and south of a cross aisle, each with a subject.
  const rows: { x: number; z: number; subject: string }[] = [
    { x: -12.6, z: -9.8, subject: "Mathematics" },
    { x: -9.2, z: -9.8, subject: "Computing" },
    { x: -12.6, z: 0.8, subject: "Sciences" },
    { x: -9.2, z: 0.8, subject: "Humanities" },
  ];
  for (const row of rows) {
    const slug = row.subject.toLowerCase();
    add(
      ...shelfRun(
        `shelf-row-${slug}`,
        "shelfRow",
        { x: row.x, z: row.z },
        "z",
        4,
        1.8,
        HALF_PI,
        "stacks",
        row.subject,
      ),
    );
  }
  add({
    id: "window-seat-stacks",
    kind: "windowSeat",
    x: -11,
    z: ROOM.minZ + 0.3,
    rotationY: 0,
    zone: "stacks",
  });
  add({
    id: "plant-stacks-1",
    kind: "plant",
    x: -14.9,
    z: -11.2,
    rotationY: 0,
    zone: "stacks",
    seed: 11,
  });
  add({
    id: "plant-stacks-2",
    kind: "plant",
    x: -7.0,
    z: -11.2,
    rotationY: 0,
    zone: "stacks",
    seed: 12,
  });

  // ── Collaborative Tables (centre north) ──
  const t1: FurnitureItem = {
    id: "collab-table-1",
    kind: "collabTable",
    x: -3.4,
    z: -7.4,
    rotationY: HALF_PI,
    zone: "collab",
  };
  const t2: FurnitureItem = {
    id: "collab-table-2",
    kind: "collabTable",
    x: 3.4,
    z: -7.4,
    rotationY: HALF_PI,
    zone: "collab",
  };
  const t3: FurnitureItem = {
    id: "collab-table-3",
    kind: "collabTable",
    x: -3.4,
    z: -2.6,
    rotationY: HALF_PI,
    zone: "collab",
  };
  const t4: FurnitureItem = {
    id: "collab-table-4",
    kind: "roundTable",
    x: 3.4,
    z: -2.6,
    rotationY: 0,
    zone: "collab",
  };
  add(t1, t2, t3, t4);
  add(...chairsAroundRectTable(t1, 3, "collab"));
  add(...chairsAroundRectTable(t2, 3, "collab"));
  add(...chairsAroundRectTable(t3, 3, "collab"));
  add(...chairsAroundRoundTable(t4, 4, "collab"));
  // One mobile whiteboard per collaborative table (opened in Phase 5), facing its table.
  add({
    id: "whiteboard-1",
    kind: "whiteboard",
    x: -3.4,
    z: -10.05,
    rotationY: 0,
    zone: "collab",
    tableId: t1.id,
  });
  add({
    id: "whiteboard-2",
    kind: "whiteboard",
    x: 3.4,
    z: -10.05,
    rotationY: 0,
    zone: "collab",
    tableId: t2.id,
  });
  add({
    id: "whiteboard-3",
    kind: "whiteboard",
    x: -3.4,
    z: 0.25,
    rotationY: Math.PI,
    zone: "collab",
    tableId: t3.id,
  });
  add({
    id: "whiteboard-4",
    kind: "whiteboard",
    x: 3.4,
    z: 0.25,
    rotationY: Math.PI,
    zone: "collab",
    tableId: t4.id,
  });
  add({ id: "globe", kind: "globe", x: 0, z: -5, rotationY: 0.4, zone: "collab" });
  for (const [i, x] of [-5.5, 0, 5.5].entries()) {
    add({
      id: `window-seat-collab-${i + 1}`,
      kind: "windowSeat",
      x,
      z: ROOM.minZ + 0.3,
      rotationY: 0,
      zone: "collab",
    });
  }

  // ── Main Hall (centre south, entrance) ──
  add({
    id: "circulation-desk",
    kind: "circulationDesk",
    x: -3.7,
    z: 6.6,
    rotationY: HALF_PI,
    zone: "hall",
  });
  const reading: FurnitureItem = {
    id: "reading-table-1",
    kind: "readingTable",
    x: 3.7,
    z: 5.6,
    rotationY: 0,
    zone: "hall",
  };
  add(reading, ...chairsAroundRectTable(reading, 2, "hall"));
  add({
    id: "hall-runner",
    kind: "rug",
    x: 0,
    z: 4.4,
    rotationY: 0,
    zone: "hall",
    width: 2.1,
    depth: 8.6,
    label: "runner",
  });
  add({
    id: "plant-door-w",
    kind: "plant",
    x: -2.0,
    z: 11.3,
    rotationY: 0,
    zone: "hall",
    seed: 21,
  });
  add({ id: "plant-door-e", kind: "plant", x: 2.0, z: 11.3, rotationY: 0, zone: "hall", seed: 22 });
  add({
    id: "notice-welcome",
    kind: "noticeBoard",
    x: -3.4,
    z: ROOM.maxZ - 0.11,
    rotationY: Math.PI,
    zone: "hall",
    label: "welcome",
  });
  add({
    id: "notice-map",
    kind: "noticeBoard",
    x: 3.4,
    z: ROOM.maxZ - 0.11,
    rotationY: Math.PI,
    zone: "hall",
    label: "map",
  });

  // ── Quiet Study (east, north half) ──
  [-10.2, -7.8, -5.4, -3.0].forEach((z, i) =>
    add(...carrelWithChair(`carrel-wall-${i + 1}`, 15.6, z, HALF_PI)),
  );
  [-8.8, -7.2, -5.6].forEach((z, i) => {
    add(...carrelWithChair(`carrel-island-w${i + 1}`, 10.9, z, HALF_PI));
    add(...carrelWithChair(`carrel-island-e${i + 1}`, 11.6, z, -HALF_PI));
  });
  add({
    id: "window-seat-quiet",
    kind: "windowSeat",
    x: 11,
    z: ROOM.minZ + 0.3,
    rotationY: 0,
    zone: "quiet",
  });
  add({
    id: "plant-quiet-1",
    kind: "plant",
    x: 15.3,
    z: -11.3,
    rotationY: 0,
    zone: "quiet",
    seed: 31,
  });
  add({
    id: "plant-quiet-2",
    kind: "plant",
    x: 7.2,
    z: -1.0,
    rotationY: 0,
    zone: "quiet",
    seed: 32,
  });

  // ── Reading Lounge (east, south half) ──
  add({
    id: "fireplace",
    kind: "fireplace",
    x: ROOM.maxX - 0.35,
    z: 6.5,
    rotationY: -HALF_PI,
    zone: "lounge",
  });
  add({ id: "lounge-rug", kind: "rug", x: 12.0, z: 6.5, rotationY: 0, zone: "lounge" });
  add({ id: "sofa-1", kind: "sofa", x: 9.4, z: 6.5, rotationY: HALF_PI, zone: "lounge" });
  add({ id: "armchair-1", kind: "armchair", x: 12.5, z: 3.9, rotationY: 0.55, zone: "lounge" });
  add({
    id: "armchair-2",
    kind: "armchair",
    x: 12.5,
    z: 9.1,
    rotationY: Math.PI - 0.55,
    zone: "lounge",
  });
  add({
    id: "coffee-table",
    kind: "coffeeTable",
    x: 11.7,
    z: 6.5,
    rotationY: HALF_PI,
    zone: "lounge",
  });
  add({ id: "floor-lamp-1", kind: "floorLamp", x: 9.2, z: 4.75, rotationY: 0, zone: "lounge" });
  add({ id: "floor-lamp-2", kind: "floorLamp", x: 9.2, z: 8.25, rotationY: 0, zone: "lounge" });
  add(
    ...shelfRun(
      "shelf-east-a",
      "wallShelf",
      { x: ROOM.maxX - 0.25, z: 1 },
      "z",
      2,
      2,
      -HALF_PI,
      "lounge",
    ),
  );
  add(
    ...shelfRun(
      "shelf-east-b",
      "wallShelf",
      { x: ROOM.maxX - 0.25, z: 8 },
      "z",
      2,
      2,
      -HALF_PI,
      "lounge",
    ),
  );
  add(
    ...shelfRun(
      "shelf-south-e",
      "wallShelf",
      { x: 5.5, z: ROOM.maxZ - 0.25 },
      "x",
      5,
      2,
      Math.PI,
      "lounge",
    ),
  );
  add({
    id: "plant-lounge-1",
    kind: "plant",
    x: 7.0,
    z: 1.3,
    rotationY: 0,
    zone: "lounge",
    seed: 41,
  });

  return items;
}

const SEAT_PROMPTS: Partial<Record<FurnitureKind, string>> = {
  windowSeat: "Sit by the window",
  sofa: "Sit on the sofa",
  armchair: "Sit in the armchair",
};

function promptForChair(item: FurnitureItem, byId: Map<string, FurnitureItem>): string {
  if (item.zone === "quiet") return "Sit at desk";
  const table = item.tableId ? byId.get(item.tableId) : undefined;
  if (table && table.zone === "collab") return "Study at table";
  if (table) return "Sit at table";
  return "Sit down";
}

function buildSeats(items: readonly FurnitureItem[]): Seat[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seats: Seat[] = [];
  for (const item of items) {
    const spec = FURNITURE_SPECS[item.kind];
    if (!spec.seats || spec.seatHeight === undefined) continue;
    spec.seats.forEach((local, index) => {
      const p = localToWorld(item, item.rotationY, local);
      seats.push({
        id: spec.seats!.length > 1 ? `${item.id}#${index + 1}` : item.id,
        furnitureId: item.id,
        x: p.x,
        z: p.z,
        rotationY: item.rotationY,
        seatHeight: spec.seatHeight!,
        zone: item.zone,
        tableId: item.tableId,
        prompt:
          item.kind === "chair"
            ? promptForChair(item, byId)
            : (SEAT_PROMPTS[item.kind] ?? "Sit down"),
      });
    });
  }
  return seats;
}

export const FURNITURE: readonly FurnitureItem[] = buildFurniture();
export const SEATS: readonly Seat[] = buildSeats(FURNITURE);

/** Safe places to appear, just inside the entrance, facing into the library (north). */
export const SPAWN_POINTS: readonly SpawnPoint[] = [
  { x: 0, z: 8.2, rotationY: Math.PI },
  { x: -0.9, z: 8.7, rotationY: Math.PI },
  { x: 0.9, z: 8.7, rotationY: Math.PI },
  { x: -0.9, z: 7.6, rotationY: Math.PI },
  { x: 0.9, z: 7.6, rotationY: Math.PI },
  { x: 0, z: 7.1, rotationY: Math.PI },
];

export function zoneAt(p: Vec2): Zone | undefined {
  return ZONES.find(
    (z) =>
      p.x >= z.bounds.minX && p.x <= z.bounds.maxX && p.z >= z.bounds.minZ && p.z <= z.bounds.maxZ,
  );
}
