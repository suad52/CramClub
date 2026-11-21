/**
 * The rolling whiteboard's swinging panel. Putting a lesson on a board turns its panel over on
 * the brass pivots so the lesson shows on the other face. The board is one modelled mesh in the
 * library GLB, so the 3D code has to work out which of its triangles make up the panel (the
 * writing faces, the gilt beads and the walnut frame round them) and which belong to the stand
 * (posts, feet, trays, markers, pins). Kept free of React and three so the tests can run it on
 * the real exported mesh.
 */

/** Measurements from art/library/scripts/furn_boards.py (metres, board-local: y up, z through). */
const SURF_W = 1.36;
const SURF_H = 0.92;
const SURF_Z = 1.36;
const BOARD_T = 0.03;
const FRAME = 0.045;
/** The frame stands proud of both faces by this much in total. */
const FRAME_DEPTH = BOARD_T + 0.024;

export const BOARD_PANEL = {
  /** The writing surface on each face. */
  surfaceWidth: SURF_W,
  surfaceHeight: SURF_H,
  /** Each writing face's distance from the panel's centre plane. */
  face: BOARD_T / 2,
  /** Height of the pivot axis, which runs through the middle of the writing surface. */
  pivotY: SURF_Z,
  /** The panel's outline: the outer edge of its frame. */
  halfWidth: SURF_W / 2 + FRAME,
  bottom: SURF_Z - SURF_H / 2 - FRAME,
  top: SURF_Z + SURF_H / 2 + FRAME,
  halfDepth: FRAME_DEPTH / 2,
  /**
   * How far the panel rises off its pins before it turns. Turning in place would sweep its frame
   * through the marker trays' lips and the markers on them; lifted this much it clears them.
   */
  lift: 0.035,
} as const;

/** How long a flip takes, either way. */
export const FLIP_SECONDS = 1.6;

export interface FlipPose {
  /** Rotation about the board's x axis (radians): 0 upright, π turned over. */
  angle: number;
  /** Height the panel is raised off its pins (metres). */
  lift: number;
}

/** Share of the flip spent lifting at the start (and lowering at the end). */
const LIFT_SHARE = 0.2;

const smoothstep = (x: number) => x * x * (3 - 2 * x);
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * The panel's pose at flip progress `t` (0 upright … 1 turned over): lift, turn at full lift,
 * then settle. Flipping back runs the same curve backwards. Pass `out` to avoid allocating.
 */
export function flipPose(t: number, out: FlipPose = { angle: 0, lift: 0 }): FlipPose {
  const u = Math.min(1, Math.max(0, t));
  if (u < LIFT_SHARE) {
    out.angle = 0;
    out.lift = BOARD_PANEL.lift * smoothstep(u / LIFT_SHARE);
  } else if (u <= 1 - LIFT_SHARE) {
    out.angle = Math.PI * easeInOutCubic((u - LIFT_SHARE) / (1 - 2 * LIFT_SHARE));
    out.lift = BOARD_PANEL.lift;
  } else {
    out.angle = Math.PI;
    out.lift = BOARD_PANEL.lift * smoothstep((1 - u) / LIFT_SHARE);
  }
  return out;
}

/**
 * The flip angle, in [0, π), at which the panel is edge-on to a viewer `up` metres above its
 * turning axis and `out` metres in front of it (along the board's +z). One face is in view below
 * this angle and the other above it, so this is where the faces can change what they show
 * unseen. (It's a quarter turn only for a viewer level with the axis.)
 */
export function edgeOnAngle(up: number, out: number) {
  const a = Math.atan2(out, up);
  return a < 0 ? a + Math.PI : a;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface PanelSplitInput {
  /** The primitive's triangle list. */
  index: ArrayLike<number>;
  vertexCount: number;
  /** Writes vertex `vertex`'s position, in board-local metres, into `out`. */
  position: (vertex: number, out: Vec3Like) => void;
  /** The primitive's material name. */
  material?: string;
}

export interface PanelSplit {
  /** Triangles that swing with the panel. */
  panel: Uint16Array | Uint32Array;
  /** Triangles that stay on the stand. */
  rest: Uint16Array | Uint32Array;
}

/** Slack round the panel's outline (bevels, quantisation). */
const TOLERANCE = 0.003;

/**
 * The brass pivot pins sit on the turning axis, half inside the frame, but they're the stand's:
 * they're round, so they look right staying put. No other brass is near the panel.
 */
const STAYS_ON_STAND = /brass/i;

const insidePanel = (min: Vec3Like, max: Vec3Like) =>
  min.x >= -BOARD_PANEL.halfWidth - TOLERANCE &&
  max.x <= BOARD_PANEL.halfWidth + TOLERANCE &&
  min.y >= BOARD_PANEL.bottom - TOLERANCE &&
  max.y <= BOARD_PANEL.top + TOLERANCE &&
  min.z >= -BOARD_PANEL.halfDepth - TOLERANCE &&
  max.z <= BOARD_PANEL.halfDepth + TOLERANCE;

/**
 * Splits a primitive of the board into the triangles that swing with the panel and the rest.
 * Every part was modelled as its own closed piece (a box, a cylinder), so triangles that share
 * vertices are one part; a part swings when all of it lies inside the panel's outline.
 */
export function splitPanelTriangles({
  index,
  vertexCount,
  position,
  material = "",
}: PanelSplitInput): PanelSplit {
  const triangles = Math.floor(index.length / 3);
  const Index = vertexCount <= 0x10000 ? Uint16Array : Uint32Array;
  if (STAYS_ON_STAND.test(material)) {
    const rest = new Index(triangles * 3);
    for (let i = 0; i < rest.length; i++) rest[i] = index[i]!;
    return { panel: new Index(0), rest };
  }

  // Union-find over the vertices: each set ends up as one part.
  const parent = new Int32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) parent[i] = i;
  const find = (v: number) => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]!]!;
      v = parent[v]!;
    }
    return v;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let t = 0; t < triangles; t++) {
    union(index[t * 3]!, index[t * 3 + 1]!);
    union(index[t * 3]!, index[t * 3 + 2]!);
  }

  // Each part's bounds, kept at its root vertex.
  const lo = new Float64Array(vertexCount * 3).fill(Infinity);
  const hi = new Float64Array(vertexCount * 3).fill(-Infinity);
  const p: Vec3Like = { x: 0, y: 0, z: 0 };
  for (let v = 0; v < vertexCount; v++) {
    position(v, p);
    const o = find(v) * 3;
    lo[o] = Math.min(lo[o]!, p.x);
    lo[o + 1] = Math.min(lo[o + 1]!, p.y);
    lo[o + 2] = Math.min(lo[o + 2]!, p.z);
    hi[o] = Math.max(hi[o]!, p.x);
    hi[o + 1] = Math.max(hi[o + 1]!, p.y);
    hi[o + 2] = Math.max(hi[o + 2]!, p.z);
  }
  const min: Vec3Like = { x: 0, y: 0, z: 0 };
  const max: Vec3Like = { x: 0, y: 0, z: 0 };
  const swings = new Uint8Array(vertexCount);
  for (let v = 0; v < vertexCount; v++) {
    if (parent[v] !== v) continue;
    const o = v * 3;
    min.x = lo[o]!;
    min.y = lo[o + 1]!;
    min.z = lo[o + 2]!;
    max.x = hi[o]!;
    max.y = hi[o + 1]!;
    max.z = hi[o + 2]!;
    swings[v] = insidePanel(min, max) ? 1 : 0;
  }

  let panelCount = 0;
  for (let t = 0; t < triangles; t++) panelCount += swings[find(index[t * 3]!)]!;
  const panel = new Index(panelCount * 3);
  const rest = new Index((triangles - panelCount) * 3);
  let pi = 0;
  let ri = 0;
  for (let t = 0; t < triangles; t++) {
    const swing = swings[find(index[t * 3]!)] === 1;
    const into = swing ? panel : rest;
    const at = swing ? pi : ri;
    for (let k = 0; k < 3; k++) into[at + k] = index[t * 3 + k]!;
    if (swing) pi += 3;
    else ri += 3;
  }
  return { panel, rest };
}
