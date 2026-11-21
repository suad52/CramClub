import { DESK_LAMPS, PLACED_ITEMS, type PlacedItem, type Rect, type Seat } from "@ovr/shared";

/**
 * Where the Pomodoro timer (a little digital desk clock) stands when someone sits at a table. It
 * goes just in front of them, a little to one side so it's beside their work
 * rather than on it: away from the desk lamp, and clear of the books and laptops the hall's tables
 * are dressed with. Kept free of React and three so the tests can check it against the plan and
 * the shipped model.
 */

/** Half the clock's footprint diagonal (it's about 10 × 4.4 cm): how close it may come to anything. */
export const TIMER_RADIUS = 0.052;

export interface TimerSpot {
  x: number;
  /** The table top under it. */
  y: number;
  z: number;
  /** Which way the clock's display faces (0 = +Z): at the seated player. */
  rotationY: number;
  /** Which way is up for it: the top's normal (tilted on the gallery desks' sloped boards). */
  normal: { x: number; y: number; z: number };
}

/** How far in front of the seat it stands, first choice first: past your book, within reach. */
const REACH = [0.4, 0.42, 0.38];
/** How far to the side, first choice first. */
const SIDEWAYS = [0.2, 0.25, 0.3];
/** Room it keeps from the edge of the top, from a lamp's stem and from anything lying there. */
const EDGE_ROOM = TIMER_RADIUS + 0.005;
const LAMP_ROOM = 0.2;
const PROP_ROOM = TIMER_RADIUS + 0.01;

/**
 * A table top in the table's own frame (x across, z along; +z is a gallery desk's front, where
 * its reader sits): the area the timer may stand on, and the top's height there, which falls
 * toward +z by `fall` per metre.
 */
interface TableTop extends Rect {
  height: number;
  fall: number;
}

/** Gallery desk reading board (furn_study.G_SLOPE): 0.745 m high at the back, 0.700 at the front. */
const SLOPE_FALL = 0.045 / 0.445;
const SLOPE_FRONT = 0.29;

const TOPS: Record<string, TableTop> = {
  // furn_hall.build_table_communal: a flat 1.0 x 4.0 m top at 0.76 m.
  table_communal: { minX: -0.5, maxX: 0.5, minZ: -2, maxZ: 2, height: 0.76, fall: 0 },
  // furn_study.build_gallery_desk: the sloped board between the pen ledge at the back and the
  // book-rest lip along the front edge (its top couldn't hold the clock on the ledge).
  gallery_desk: {
    minX: -0.55,
    maxX: 0.55,
    minZ: -0.155,
    maxZ: 0.26,
    height: 0.7 + SLOPE_FALL * SLOPE_FRONT,
    fall: SLOPE_FALL,
  },
};

/**
 * The student things on every hall table (furn_hall.build_table_set): an open book, a notebook
 * and pencil, a laptop. Footprints in the table's frame, padded for their slight turns.
 */
const TABLE_PROPS = [
  { kind: "book", x: -0.285, z: -0.03, halfX: 0.15, halfZ: 0.17 },
  { kind: "notebook", x: 0.29, z: 1.36, halfX: 0.115, halfZ: 0.09 },
  { kind: "pencil", x: 0.25, z: 1.21, halfX: 0.025, halfZ: 0.09 },
  { kind: "laptop", x: -0.27, z: -1.32, halfX: 0.12, halfZ: 0.16 },
] as const;

/**
 * Each table set leaves one thing out, by its number (scene_library.SM_build_table_sets), and
 * every other set is turned end for end.
 */
const LEFT_OUT: readonly (readonly string[])[] = [["laptop"], ["book"], ["notebook", "pencil"], []];

interface Table {
  item: PlacedItem;
  top: TableTop;
  /** Desk lamps standing on it and the things lying on it, in its own frame. */
  lamps: { x: number; z: number }[];
  props: Rect[];
}

function toLocal(item: PlacedItem, x: number, z: number) {
  const dx = x - item.x;
  const dz = z - item.z;
  const c = Math.cos(item.rotationY);
  const s = Math.sin(item.rotationY);
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

function toWorld(item: PlacedItem, x: number, z: number) {
  const c = Math.cos(item.rotationY);
  const s = Math.sin(item.rotationY);
  return { x: item.x + x * c + z * s, z: item.z - x * s + z * c };
}

/** Distance from a point to a rectangle (0 inside it). */
function rectDistance(r: Rect, x: number, z: number) {
  const dx = Math.max(r.minX - x, 0, x - r.maxX);
  const dz = Math.max(r.minZ - z, 0, z - r.maxZ);
  return Math.hypot(dx, dz);
}

const TABLES = new Map<string, Table>();
let setNumber = 0;
for (const item of PLACED_ITEMS) {
  const top = TOPS[item.kind];
  if (!top) continue;
  const lamps = [...DESK_LAMPS.hall, ...DESK_LAMPS.green]
    .filter((l) => Math.abs(l.y - item.y - top.height) < 0.3)
    .map((l) => toLocal(item, l.x, l.z))
    .filter((l) => rectDistance(top, l.x, l.z) < 0.1);
  const props: Rect[] = [];
  if (item.kind === "table_communal") {
    setNumber += 1;
    const flip = setNumber % 2 === 0 ? -1 : 1;
    const out = LEFT_OUT[setNumber % 4]!;
    for (const p of TABLE_PROPS) {
      if (out.includes(p.kind)) continue;
      const x = p.x * flip;
      const z = p.z * flip;
      props.push({ minX: x - p.halfX, maxX: x + p.halfX, minZ: z - p.halfZ, maxZ: z + p.halfZ });
    }
  }
  TABLES.set(item.id, { item, top, lamps, props });
}

/** How much room the timer would have at (x, z) on the table: negative if it doesn't fit. */
function room(table: Table, x: number, z: number) {
  const { top } = table;
  let free = Math.min(x - top.minX, top.maxX - x, z - top.minZ, top.maxZ - z) - EDGE_ROOM;
  for (const l of table.lamps) free = Math.min(free, Math.hypot(x - l.x, z - l.z) - LAMP_ROOM);
  for (const p of table.props) free = Math.min(free, rectDistance(p, x, z) - PROP_ROOM);
  return free;
}

/** The spot for a seat's timer, or null for a seat that isn't at a table. */
export function timerSpot(seat: Seat): TimerSpot | null {
  const table = seat.tableId ? TABLES.get(seat.tableId) : undefined;
  if (!table) return null;
  const { item, top } = table;
  const s = toLocal(item, seat.x, seat.z);
  // Facing and the seated player's right, in the table's frame.
  const a = seat.rotationY - item.rotationY;
  const fx = Math.sin(a);
  const fz = Math.cos(a);
  const at = (side: number, sideways: number, reach: number) => ({
    x: s.x + fx * reach - fz * side * sideways,
    z: s.z + fz * reach + fx * side * sideways,
  });
  const lampGap = (side: number) => {
    const p = at(side, SIDEWAYS[0]!, REACH[0]!);
    return Math.min(...table.lamps.map((l) => Math.hypot(p.x - l.x, p.z - l.z)));
  };
  // Away from the nearer lamp; with no lamp nearer either side, on the right, where you'd reach.
  const first = lampGap(-1) > lampGap(1) + 0.01 ? -1 : 1;
  let best = at(first, SIDEWAYS[0]!, REACH[0]!);
  let bestRoom = -Infinity;
  search: for (const side of [first, -first]) {
    for (const sideways of SIDEWAYS) {
      for (const reach of REACH) {
        const p = at(side, sideways, reach);
        const free = room(table, p.x, p.z);
        if (free > bestRoom) {
          best = p;
          bestRoom = free;
        }
        if (free >= 0) break search;
      }
    }
  }
  const w = toWorld(item, best.x, best.z);
  // The top's normal leans toward +z where it slopes; turned into the room.
  const len = Math.hypot(1, top.fall);
  return {
    x: w.x,
    y: item.y + top.height - top.fall * best.z,
    z: w.z,
    rotationY: Math.atan2(seat.x - w.x, seat.z - w.z),
    normal: {
      x: (top.fall * Math.sin(item.rotationY)) / len,
      y: 1 / len,
      z: (top.fall * Math.cos(item.rotationY)) / len,
    },
  };
}
