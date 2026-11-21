import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, type InstancedMesh as GltfInstancing } from "@gltf-transform/extensions";
import { Box3, Matrix4, Quaternion, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";
import { DESK_LAMPS, PLACED_ITEMS, SEATS, type Rect } from "@ovr/shared";
import { TIMER_RADIUS, timerSpot } from "./tableTimer";

/** Table sizes and top heights from art/library/scripts/plan.py KINDS (width across, depth along). */
const KINDS: Record<string, { w: number; d: number; h: number }> = {
  table_communal: { w: 1.0, d: 4.0, h: 0.76 },
  gallery_desk: { w: 1.2, d: 0.6, h: 0.76 },
};

const tables = new Map(PLACED_ITEMS.filter((i) => i.kind in KINDS).map((i) => [i.id, i]));

/** A world point in a table's frame (x across, z along). */
function local(tableId: string, x: number, z: number) {
  const t = tables.get(tableId)!;
  const c = Math.cos(t.rotationY);
  const s = Math.sin(t.rotationY);
  const dx = x - t.x;
  const dz = z - t.z;
  return { x: dx * c - dz * s, z: dx * s + dz * c };
}

const spots = SEATS.map((seat) => ({ seat, spot: timerSpot(seat)! }));
const lamps = [...DESK_LAMPS.hall, ...DESK_LAMPS.green];

describe("timerSpot", () => {
  it("finds a spot for every seat", () => {
    expect(SEATS.length).toBe(75);
    for (const { seat, spot } of spots) {
      expect(seat.tableId, seat.id).not.toBeNull();
      expect(spot, seat.id).toBeTruthy();
    }
  });

  it("stands on its own table's top, at least 6 cm in from the edges", () => {
    for (const { seat, spot } of spots) {
      const kind = KINDS[tables.get(seat.tableId!)!.kind]!;
      const p = local(seat.tableId!, spot.x, spot.z);
      const room = Math.min(kind.w / 2 - Math.abs(p.x), kind.d / 2 - Math.abs(p.z));
      expect(room, seat.id).toBeGreaterThanOrEqual(0.06);
    }
  });

  it("sits on the top: flat tables at 0.76 m, the gallery desks on their sloped reading board", () => {
    for (const { seat, spot } of spots) {
      const table = tables.get(seat.tableId!)!;
      if (table.kind === "table_communal") {
        expect(spot.y, seat.id).toBeCloseTo(table.y + KINDS[table.kind]!.h, 4);
        expect(spot.normal.y, seat.id).toBe(1);
        continue;
      }
      // furn_study.G_SLOPE: the board runs from 0.745 m at the back (z -0.155) down to 0.700 at
      // the front (z 0.29); the book-rest lip takes the last 3 cm.
      const p = local(seat.tableId!, spot.x, spot.z);
      expect(p.z, seat.id).toBeGreaterThan(-0.155 + TIMER_RADIUS);
      expect(p.z, seat.id).toBeLessThan(0.26 - TIMER_RADIUS);
      expect(spot.y, seat.id).toBeCloseTo(table.y + 0.7 + (0.045 / 0.445) * (0.29 - p.z), 4);
      // Leaning toward the reader, as much as the board does.
      const toSeat = Math.hypot(seat.x - spot.x, seat.z - spot.z);
      const lean = ((seat.x - spot.x) * spot.normal.x + (seat.z - spot.z) * spot.normal.z) / toSeat;
      expect(Math.asin(Math.hypot(spot.normal.x, spot.normal.z)), seat.id).toBeCloseTo(
        Math.atan(0.045 / 0.445),
        4,
      );
      expect(lean, seat.id).toBeGreaterThan(0);
    }
  });

  it("keeps at least 20 cm from every desk lamp", () => {
    for (const { seat, spot } of spots) {
      for (const l of lamps) {
        if (Math.abs(l.y - spot.y) > 0.5) continue;
        expect(Math.hypot(l.x - spot.x, l.z - spot.z), seat.id).toBeGreaterThanOrEqual(0.2);
      }
    }
  });

  it("faces the seat, a little in front and to the side of it", () => {
    for (const { seat, spot } of spots) {
      const toSeat = Math.atan2(seat.x - spot.x, seat.z - spot.z);
      const off = Math.atan2(Math.sin(toSeat - spot.rotationY), Math.cos(toSeat - spot.rotationY));
      expect(Math.abs(off), seat.id).toBeLessThan((3 * Math.PI) / 180);
      const fx = Math.sin(seat.rotationY);
      const fz = Math.cos(seat.rotationY);
      const ahead = (spot.x - seat.x) * fx + (spot.z - seat.z) * fz;
      const aside = Math.abs((spot.x - seat.x) * fz - (spot.z - seat.z) * fx);
      expect(ahead, seat.id).toBeGreaterThanOrEqual(0.38 - 1e-9);
      expect(ahead, seat.id).toBeLessThanOrEqual(0.42 + 1e-9);
      expect(aside, seat.id).toBeGreaterThanOrEqual(0.2 - 1e-9);
      expect(aside, seat.id).toBeLessThanOrEqual(0.3 + 1e-9);
    }
  });

  it("goes to the side away from the nearer lamp", () => {
    // The hall tables' end seats have a lamp just inside them: the timer goes on the outside.
    let checked = 0;
    for (const { seat, spot } of spots) {
      const near = lamps
        .filter((l) => Math.abs(l.y - spot.y) < 0.5)
        .map((l) => ({ l, d: Math.hypot(l.x - seat.x, l.z - seat.z) }))
        .sort((a, b) => a.d - b.d);
      if (near.length < 2 || near[1]!.d - near[0]!.d < 0.1) continue;
      expect(Math.sign(spot.z - seat.z), seat.id).toBe(-Math.sign(near[0]!.l.z - seat.z));
      checked += 1;
    }
    expect(checked).toBe(48);
  });

  it("never puts two timers at one table within 25 cm of each other", () => {
    for (const a of spots) {
      for (const b of spots) {
        if (a === b || a.seat.tableId !== b.seat.tableId) continue;
        expect(Math.hypot(a.spot.x - b.spot.x, a.spot.z - b.spot.z), a.seat.id).toBeGreaterThan(
          0.25,
        );
      }
    }
  });

  it("stays clear of the books, notebooks, pencils and laptops on the shipped tables", async () => {
    const props = await shippedTableProps();
    // Book, notebook, pencil and laptop on 12 tables, less what each set leaves out (a laptop,
    // a book, the notebook and pencil, or nothing, in turn).
    expect(props.length).toBe(36);
    let checked = 0;
    for (const { seat, spot } of spots) {
      for (const p of props) {
        if (p.tableId !== seat.tableId) continue;
        const dx = Math.max(p.rect.minX - spot.x, 0, spot.x - p.rect.maxX);
        const dz = Math.max(p.rect.minZ - spot.z, 0, spot.z - p.rect.maxZ);
        expect(Math.hypot(dx, dz), seat.id).toBeGreaterThanOrEqual(TIMER_RADIUS);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(200);
  });
});

/** The small things lying on the hall tables in library.glb, as world-space footprints. */
async function shippedTableProps() {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const url = new URL("../../public/models/library/library.glb", import.meta.url);
  const doc = await io.read(fileURLToPath(url));
  const hall = PLACED_ITEMS.filter((i) => i.kind === "table_communal");
  const found: { tableId: string; rect: Rect }[] = [];
  const corner = new Vector3();
  for (const node of doc.getRoot().listNodes()) {
    const instancing = node.getExtension<GltfInstancing>("EXT_mesh_gpu_instancing");
    const mesh = node.getMesh();
    if (!instancing || !mesh) continue;
    const local = new Box3();
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute("POSITION")!;
      local.union(
        new Box3(
          new Vector3(...pos.getMinNormalized([])),
          new Vector3(...pos.getMaxNormalized([])),
        ),
      );
    }
    const nodeMatrix = new Matrix4().fromArray(node.getWorldMatrix());
    const count = instancing.getAttribute("TRANSLATION")!.getCount();
    for (let i = 0; i < count; i++) {
      const el = (name: string, fallback: number[]) =>
        instancing.getAttribute(name)?.getElement(i, []) ?? fallback;
      const [tx, ty, tz] = el("TRANSLATION", [0, 0, 0]);
      const m = nodeMatrix
        .clone()
        .multiply(
          new Matrix4().compose(
            new Vector3(tx, ty, tz),
            new Quaternion(...el("ROTATION", [0, 0, 0, 1])),
            new Vector3(...el("SCALE", [1, 1, 1])),
          ),
        );
      const world = new Box3();
      for (let k = 0; k < 8; k++) {
        corner.set(
          k & 1 ? local.max.x : local.min.x,
          k & 2 ? local.max.y : local.min.y,
          k & 4 ? local.max.z : local.min.z,
        );
        world.expandByPoint(corner.applyMatrix4(m));
      }
      // Lying on a top (0.76 m) and low: not the tables, chairs or lamps.
      if (world.min.y < 0.755 || world.min.y > 0.78 || world.max.y > 0.9) continue;
      const cx = (world.min.x + world.max.x) / 2;
      const cz = (world.min.z + world.max.z) / 2;
      const table = hall.find((t) => Math.abs(cx - t.x) < 0.5 && Math.abs(cz - t.z) < 2);
      if (!table) continue;
      found.push({
        tableId: table.id,
        rect: { minX: world.min.x, maxX: world.max.x, minZ: world.min.z, maxZ: world.max.z },
      });
    }
  }
  return found;
}
