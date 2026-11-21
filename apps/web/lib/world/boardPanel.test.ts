import { fileURLToPath } from "node:url";
import { NodeIO, type Node as GltfNode } from "@gltf-transform/core";
import { ALL_EXTENSIONS, type InstancedMesh as GltfInstancing } from "@gltf-transform/extensions";
import { Matrix4, Quaternion, Vector3 } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { describe, expect, it } from "vitest";
import { ANCHORS } from "@ovr/shared";
import {
  BOARD_PANEL,
  edgeOnAngle,
  flipPose,
  splitPanelTriangles,
  type Vec3Like,
} from "./boardPanel";

/** A closed box as its own part: 8 corners, 12 triangles, starting at vertex `base`. */
function box(base: number, min: Vec3Like, max: Vec3Like) {
  const corners: Vec3Like[] = [];
  for (const x of [min.x, max.x])
    for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) corners.push({ x, y, z });
  const quads = [
    [0, 1, 3, 2],
    [4, 6, 7, 5],
    [0, 4, 5, 1],
    [2, 3, 7, 6],
    [0, 2, 6, 4],
    [1, 5, 7, 3],
  ];
  const index = quads.flatMap(([a, b, c, d]) => [a!, b!, c!, a!, c!, d!].map((i) => i + base));
  return { corners, index };
}

function mesh(parts: { min: Vec3Like; max: Vec3Like }[]) {
  const corners: Vec3Like[] = [];
  const index: number[] = [];
  for (const part of parts) {
    const b = box(corners.length, part.min, part.max);
    corners.push(...b.corners);
    index.push(...b.index);
  }
  return {
    index,
    vertexCount: corners.length,
    position: (v: number, out: Vec3Like) => Object.assign(out, corners[v]),
  };
}

const v = (x: number, y: number, z: number) => ({ x, y, z });
/** Triangles, as [a, b, c] lists, so the tests can compare them. */
const tris = (a: ArrayLike<number>) =>
  Array.from({ length: a.length / 3 }, (_, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]]);

describe("splitting a board primitive into panel and stand", () => {
  const face = { min: v(-0.68, 0.9, -0.015), max: v(0.68, 1.82, 0.015) };
  const stile = { min: v(0.68, 0.855, -0.027), max: v(0.725, 1.865, 0.027) };
  const post = { min: v(0.735, 0.12, -0.025), max: v(0.785, 1.915, 0.025) };
  const tray = { min: v(-0.476, 0.832, 0.027), max: v(0.476, 0.854, 0.097) };

  it("swings the parts inside the panel's outline and keeps the rest on the stand", () => {
    const m = mesh([face, post, stile, tray]);
    const { panel, rest } = splitPanelTriangles({ ...m, material: "M_Walnut" });
    expect(tris(panel)).toEqual([...tris(m.index.slice(0, 36)), ...tris(m.index.slice(72, 108))]);
    expect(tris(rest)).toEqual([...tris(m.index.slice(36, 72)), ...tris(m.index.slice(108))]);
  });

  it("keeps a part that reaches outside the outline whole on the stand", () => {
    // A part that starts on the panel and runs into the post is one piece: it can't swing.
    const straddle = { min: v(0.6, 1.3, -0.02), max: v(0.76, 1.4, 0.02) };
    const { panel, rest } = splitPanelTriangles(mesh([straddle]));
    expect(panel).toHaveLength(0);
    expect(rest).toHaveLength(36);
  });

  it("treats triangles that share vertices as one part", () => {
    const m = mesh([face, post]);
    // Weld a corner of the face to the post: now they're one part, which reaches the floor.
    const welded = m.index.map((i) => (i === 0 ? 8 : i));
    const { panel } = splitPanelTriangles({ ...m, index: welded });
    expect(panel).toHaveLength(0);
  });

  it("leaves brass on the stand even inside the outline", () => {
    const pin = { min: v(0.69, 1.338, -0.022), max: v(0.72, 1.382, 0.022) };
    const { panel, rest } = splitPanelTriangles({ ...mesh([pin, face]), material: "M_BrassAged" });
    expect(panel).toHaveLength(0);
    expect(rest).toHaveLength(72);
  });

  it("uses 16-bit indices for small meshes and 32-bit for big ones", () => {
    const small = splitPanelTriangles(mesh([face]));
    expect(small.panel).toBeInstanceOf(Uint16Array);
    const big = splitPanelTriangles({ ...mesh([face]), vertexCount: 70_000 });
    expect(big.panel).toBeInstanceOf(Uint32Array);
    expect(big.rest).toBeInstanceOf(Uint32Array);
  });
});

/** The rolling whiteboards in the shipped library GLB, mapped into board-local metres. */
async function shippedBoard() {
  await MeshoptDecoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ "meshopt.decoder": MeshoptDecoder });
  const url = new URL("../../public/models/library/library.glb", import.meta.url);
  const doc = await io.read(fileURLToPath(url));
  const triangles = (n: GltfNode) =>
    (n.getMesh()?.listPrimitives() ?? []).reduce(
      (sum, p) => sum + (p.getIndices()?.getCount() ?? 0) / 3,
      0,
    );
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getExtension("EXT_mesh_gpu_instancing") && triangles(n) === 3248);
  if (!node) throw new Error("rolling whiteboard node not found in library.glb");
  const instancing = node.getExtension<GltfInstancing>("EXT_mesh_gpu_instancing")!;
  const el = (name: string) => instancing.getAttribute(name)!.getElement(0, []);
  const [tx, ty, tz] = el("TRANSLATION");
  const instance = new Matrix4().compose(
    new Vector3(tx, ty, tz),
    new Quaternion(...el("ROTATION")),
    new Vector3(...el("SCALE")),
  );
  const anchor = ANCHORS.filter((a) => a.kind === "whiteboard" && a.mount === "mobile").sort(
    (a, b) => Math.hypot(a.x - tx!, a.z - tz!) - Math.hypot(b.x - tx!, b.z - tz!),
  )[0]!;
  const board = new Matrix4().makeRotationY(anchor.rot).setPosition(anchor.x, 0, anchor.z);
  const toLocal = board
    .invert()
    .multiply(new Matrix4().fromArray(node.getWorldMatrix()))
    .multiply(instance);
  return node
    .getMesh()!
    .listPrimitives()
    .map((prim) => {
      const pos = prim.getAttribute("POSITION")!;
      const p = new Vector3();
      const xyz = [0, 0, 0];
      const position = (i: number, out: Vec3Like) => {
        p.fromArray(pos.getElement(i, xyz)).applyMatrix4(toLocal);
        out.x = p.x;
        out.y = p.y;
        out.z = p.z;
      };
      const index = Array.from(prim.getIndices()!.getArray()!);
      const material = prim.getMaterial()?.getName() ?? "";
      const split = splitPanelTriangles({ index, vertexCount: pos.getCount(), position, material });
      const bounds = (tri: ArrayLike<number>) => {
        const min = v(Infinity, Infinity, Infinity);
        const max = v(-Infinity, -Infinity, -Infinity);
        const q = v(0, 0, 0);
        for (let k = 0; k < tri.length; k++) {
          position(tri[k]!, q);
          for (const axis of ["x", "y", "z"] as const) {
            min[axis] = Math.min(min[axis], q[axis]);
            max[axis] = Math.max(max[axis], q[axis]);
          }
        }
        return { min, max };
      };
      return { material, triangles: index.length / 3, split, all: bounds(index), bounds };
    });
}

describe("the shipped rolling whiteboard", async () => {
  const prims = await shippedBoard();
  const share = (p: (typeof prims)[number]) => p.split.panel.length / 3 / p.triangles;
  // Palette materials are merged on export, so tell the parts apart by where they are.
  const face = prims.find((p) => p.triangles === 108 && p.all.max.z <= 0.016)!;
  const gilt = prims.find((p) => p.triangles === 96)!;
  const walnut = prims.find((p) => p.material === "M_Walnut")!;
  const brass = prims.find((p) => p.material === "M_BrassAged")!;
  const small = prims.filter((p) => ![face, gilt, walnut, brass].includes(p));

  it("finds every primitive", () => {
    expect(prims).toHaveLength(8);
    expect([face, gilt, walnut, brass].every(Boolean)).toBe(true);
    expect(small).toHaveLength(4);
  });

  it("swings both writing faces and their gilt beads whole", () => {
    expect(share(face)).toBe(1);
    expect(share(gilt)).toBe(1);
  });

  it("keeps the brass, markers, eraser and wheels on the stand", () => {
    expect(share(brass)).toBe(0);
    for (const p of small) expect(share(p)).toBe(0);
  });

  it("swings exactly the walnut frame round the faces", () => {
    expect(walnut.split.panel.length).toBeGreaterThan(0);
    expect(walnut.split.rest.length).toBeGreaterThan(0);
    const { min, max } = walnut.bounds(walnut.split.panel);
    expect(min.x).toBeCloseTo(-BOARD_PANEL.halfWidth, 2);
    expect(max.x).toBeCloseTo(BOARD_PANEL.halfWidth, 2);
    expect(min.y).toBeCloseTo(BOARD_PANEL.bottom, 2);
    expect(max.y).toBeCloseTo(BOARD_PANEL.top, 2);
    expect(Math.max(-min.z, max.z)).toBeLessThanOrEqual(0.03);
  });

  it("leaves none of the walnut frame behind on the stand", () => {
    // Each edge of the outline is reached by two frame pieces, so the bounds above still pass with
    // a whole stile or rail left behind (welded to a post on re-export, say). Nothing that stays
    // may lie within the panel's outline (with the split's own slack round it).
    const slack = 0.003;
    const rest = walnut.split.rest;
    const within: number[] = [];
    for (let t = 0; t < rest.length; t += 3) {
      const { min, max } = walnut.bounds(rest.subarray(t, t + 3));
      if (
        Math.max(-min.x, max.x) <= BOARD_PANEL.halfWidth + slack &&
        min.y >= BOARD_PANEL.bottom - slack &&
        max.y <= BOARD_PANEL.top + slack &&
        Math.max(-min.z, max.z) <= BOARD_PANEL.halfDepth + slack
      )
        within.push(t / 3);
    }
    expect(within).toEqual([]);
  });

  it("swings nothing below the frame or out past it", () => {
    for (const p of prims) {
      if (p.split.panel.length === 0) continue;
      const { min, max } = p.bounds(p.split.panel);
      expect(min.y).toBeGreaterThanOrEqual(0.85);
      expect(Math.max(-min.x, max.x)).toBeLessThanOrEqual(0.73);
    }
  });
});

/** Cross-sections (y, z) of the stand's parts round the panel, from furn_boards.py. */
const TRAY_TOP = 0.843;
const OBSTACLES = [
  { name: "tray", y: [TRAY_TOP - 0.011, TRAY_TOP + 0.011], z: [0.027, 0.097] },
  { name: "lip", y: [TRAY_TOP + 0.012 - 0.015, TRAY_TOP + 0.012 + 0.015], z: [0.092, 0.102] },
  { name: "marker", y: [TRAY_TOP + 0.02 - 0.009, TRAY_TOP + 0.02 + 0.009], z: [0.053, 0.071] },
  { name: "eraser", y: [TRAY_TOP + 0.026 - 0.015, TRAY_TOP + 0.026 + 0.015], z: [0.0395, 0.0845] },
].flatMap((o) => [o, { ...o, name: `${o.name} (far face)`, z: [-o.z[1]!, -o.z[0]!] }]);

type Point = [y: number, z: number];
const rect = (y: number[], z: number[]): Point[] => [
  [y[0]!, z[0]!],
  [y[1]!, z[0]!],
  [y[1]!, z[1]!],
  [y[0]!, z[1]!],
];

/** Separating-axis test for two convex polygons; touching doesn't count. */
function overlaps(a: Point[], b: Point[]) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [y0, z0] = poly[i]!;
      const [y1, z1] = poly[(i + 1) % poly.length]!;
      const axis: Point = [z0 - z1, y1 - y0];
      const project = (p: Point[]) => p.map(([y, z]) => y * axis[0] + z * axis[1]);
      const pa = project(a);
      const pb = project(b);
      if (Math.max(...pa) <= Math.min(...pb) + 1e-9 || Math.max(...pb) <= Math.min(...pa) + 1e-9) {
        return false;
      }
    }
  }
  return true;
}

describe("flipping the panel", () => {
  it("starts upright and ends turned over, resting on its pins", () => {
    expect(flipPose(0)).toEqual({ angle: 0, lift: 0 });
    expect(flipPose(1)).toEqual({ angle: Math.PI, lift: 0 });
    expect(flipPose(0.5).lift).toBe(BOARD_PANEL.lift);
  });

  it("only ever turns one way", () => {
    let last = -1;
    for (let t = 0; t <= 1; t += 0.0025) {
      const { angle } = flipPose(t);
      expect(angle).toBeGreaterThanOrEqual(last);
      last = angle;
    }
  });

  it("clears the trays, lips, markers and eraser all the way round", () => {
    const panel = rect(
      [BOARD_PANEL.bottom, BOARD_PANEL.top],
      [-BOARD_PANEL.halfDepth, BOARD_PANEL.halfDepth],
    );
    const pivot = BOARD_PANEL.pivotY;
    for (let step = 0; step <= 400; step++) {
      const t = step * 0.0025;
      const { angle, lift } = flipPose(t);
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const posed = panel.map(([y, z]): Point => [
        pivot + lift + (y - pivot) * c - z * s,
        (y - pivot) * s + z * c,
      ]);
      for (const o of OBSTACLES) {
        expect(overlaps(posed, rect(o.y, o.z)), `${o.name} at t = ${t}`).toBe(false);
      }
    }
  });

  it("finds where the panel is edge-on to a viewer, so the faces can change unseen", () => {
    // How squarely the face that starts at +z faces the viewer when turned by `a` (its normal is
    // (0, -sin a, cos a)): positive, it's in view; negative, the other face is.
    const facing = (a: number, up: number, out: number) => -up * Math.sin(a) + out * Math.cos(a);
    const viewers = [
      { up: 0, out: 3 }, // level with the axis: a quarter turn
      { up: 0.75, out: 4.1 }, // the default third-person camera
      { up: 3, out: 2 }, // looking down from close by
      { up: -0.24, out: 1.2 }, // seated, below the axis
      { up: 0.75, out: -4.1 }, // behind the board
      { up: 2, out: 0 }, // straight above
    ];
    expect(edgeOnAngle(0, 3)).toBeCloseTo(Math.PI / 2);
    for (const { up, out } of viewers) {
      const a = edgeOnAngle(up, out);
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(Math.PI);
      expect(facing(a, up, out)).toBeCloseTo(0);
      // Just either side of it, opposite faces are in view.
      expect(Math.sign(facing(a - 0.01, up, out))).toBe(-Math.sign(facing(a + 0.01, up, out)));
    }
    // From above, the panel is edge-on to you before a quarter turn; from below, after it.
    expect(edgeOnAngle(0.75, 4.1)).toBeLessThan(Math.PI / 2);
    expect(edgeOnAngle(-0.24, 1.2)).toBeGreaterThan(Math.PI / 2);
  });

  it("would hit them turning in place, which is why it lifts", () => {
    const panel = rect(
      [BOARD_PANEL.bottom, BOARD_PANEL.top],
      [-BOARD_PANEL.halfDepth, BOARD_PANEL.halfDepth],
    );
    const pivot = BOARD_PANEL.pivotY;
    const hits = [];
    for (let deg = 0; deg <= 180; deg++) {
      const a = (deg * Math.PI) / 180;
      const posed = panel.map(([y, z]): Point => [
        pivot + (y - pivot) * Math.cos(a) - z * Math.sin(a),
        (y - pivot) * Math.sin(a) + z * Math.cos(a),
      ]);
      if (OBSTACLES.some((o) => overlaps(posed, rect(o.y, o.z)))) hits.push(deg);
    }
    expect(hits.length).toBeGreaterThan(0);
  });
});
