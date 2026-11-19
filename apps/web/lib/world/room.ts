import { ENTRANCE, FURNITURE, ROOM, WINDOWS, type WallSide } from "@ovr/shared";
import { PALETTE } from "./palette";
import { PartList } from "./parts";

const P = PALETTE;
const H = ROOM.height;
const T = ROOM.wallThickness;

interface Opening {
  center: number;
  width: number;
  bottom: number;
  top: number;
}

/** Wall geometry helpers: `along` runs along the wall, `inset` is the distance into the room. */
function wallFrame(side: WallSide) {
  switch (side) {
    case "north":
      return {
        min: ROOM.minX,
        max: ROOM.maxX,
        at: (along: number, inset: number) => [along, ROOM.minZ + inset] as const,
        ry: 0,
      };
    case "south":
      return {
        min: ROOM.minX,
        max: ROOM.maxX,
        at: (along: number, inset: number) => [along, ROOM.maxZ - inset] as const,
        ry: Math.PI,
      };
    case "east":
      return {
        min: ROOM.minZ,
        max: ROOM.maxZ,
        at: (along: number, inset: number) => [ROOM.maxX - inset, along] as const,
        ry: -Math.PI / 2,
      };
    case "west":
      return {
        min: ROOM.minZ,
        max: ROOM.maxZ,
        at: (along: number, inset: number) => [ROOM.minX + inset, along] as const,
        ry: Math.PI / 2,
      };
  }
}

/** Adds a box laid along a wall: `length` along it, `depth` into the room from `inset`. */
function alongWall(
  parts: PartList,
  side: WallSide,
  from: number,
  to: number,
  y0: number,
  y1: number,
  inset: number,
  depth: number,
  color: string,
  material: "solid" | "glass" = "solid",
) {
  const f = wallFrame(side);
  const len = to - from;
  if (len <= 0.001 || y1 - y0 <= 0.001) return;
  const [x, z] = f.at((from + to) / 2, inset + depth / 2);
  const isX = side === "north" || side === "south";
  parts.box(isX ? len : depth, y1 - y0, isX ? depth : len, x, (y0 + y1) / 2, z, color, {
    material,
  });
}

/** Splits [min, max] around openings and calls back for each solid span. */
function spans(
  min: number,
  max: number,
  openings: readonly Opening[],
  cb: (from: number, to: number) => void,
) {
  let cursor = min;
  for (const o of [...openings].sort((a, b) => a.center - b.center)) {
    cb(cursor, o.center - o.width / 2);
    cursor = o.center + o.width / 2;
  }
  cb(cursor, max);
}

function buildWall(parts: PartList, side: WallSide, openings: readonly Opening[]) {
  const f = wallFrame(side);
  // The structural wall sits just outside the interior, extended to cover the corners.
  const min = f.min - T;
  const max = f.max + T;
  spans(min, max, openings, (a, b) => alongWall(parts, side, a, b, 0, H, -T, T, P.plaster));
  for (const o of openings) {
    alongWall(
      parts,
      side,
      o.center - o.width / 2,
      o.center + o.width / 2,
      0,
      o.bottom,
      -T,
      T,
      P.plaster,
    );
    alongWall(
      parts,
      side,
      o.center - o.width / 2,
      o.center + o.width / 2,
      o.top,
      H,
      -T,
      T,
      P.plaster,
    );
  }
  // Wood wainscot, chair rail, baseboard and crown moulding on the interior face.
  const doorways = openings.filter((o) => o.bottom < 1.2);
  spans(f.min, f.max, doorways, (a, b) => {
    alongWall(parts, side, a, b, 0, 1.12, 0, 0.035, P.honey);
    alongWall(parts, side, a, b, 0, 0.15, 0, 0.06, P.plinth);
    alongWall(parts, side, a, b, 1.1, 1.17, 0, 0.07, P.walnut);
  });
  alongWall(parts, side, f.min, f.max, H - 0.18, H, 0, 0.12, P.walnut);
  alongWall(parts, side, f.min, f.max, H - 0.26, H - 0.18, 0, 0.06, P.honey);
}

function buildWindow(parts: PartList, side: WallSide, o: Opening) {
  const h = o.top - o.bottom;
  const left = o.center - o.width / 2;
  const right = o.center + o.width / 2;
  // Jambs, head and a deep interior sill.
  alongWall(parts, side, left - 0.12, left + 0.02, o.bottom, o.top, -T, T + 0.06, P.walnut);
  alongWall(parts, side, right - 0.02, right + 0.12, o.bottom, o.top, -T, T + 0.06, P.walnut);
  alongWall(
    parts,
    side,
    left - 0.12,
    right + 0.12,
    o.top - 0.02,
    o.top + 0.16,
    -T,
    T + 0.06,
    P.walnut,
  );
  alongWall(
    parts,
    side,
    left - 0.18,
    right + 0.18,
    o.bottom - 0.06,
    o.bottom + 0.03,
    -T,
    T + 0.14,
    P.oak,
  );
  // Mullions and transoms in the middle of the wall's thickness.
  const mid = -T / 2 - 0.03;
  for (let i = 1; i < 3; i++) {
    const a = left + (o.width * i) / 3;
    alongWall(parts, side, a - 0.025, a + 0.025, o.bottom, o.top, mid, 0.06, P.walnutDark);
  }
  for (const t of [0.28, 0.5, 0.72]) {
    const y = o.bottom + h * t;
    const thick = t === 0.72 ? 0.07 : 0.04;
    alongWall(parts, side, left, right, y - thick / 2, y + thick / 2, mid, 0.06, P.walnutDark);
  }
  alongWall(parts, side, left, right, o.bottom, o.top, mid + 0.02, 0.01, "#dbe9ef", "glass");
}

function buildDoor(parts: PartList) {
  const { center, width, height } = ENTRANCE;
  const z = ROOM.maxZ + T / 2;
  for (const s of [-1, 1]) {
    const x = center + (s * width) / 4;
    parts.box(width / 2 - 0.03, height - 0.05, 0.08, x, height / 2, z, P.walnut);
    for (const y of [0.85, 2.35]) {
      parts.box(width / 2 - 0.3, y === 0.85 ? 1.1 : 1.3, 0.02, x, y, z - 0.05, P.honey);
    }
    parts.box(width / 2 - 0.36, 1.1, 0.01, x, 2.35, z - 0.062, "#cfe1e8", { material: "glass" });
    parts.cyl(0.018, 0.018, 0.34, center + s * 0.12, 1.15, z - 0.09, P.brass, {
      material: "metal",
      segments: 8,
    });
  }
  // Interior door casing.
  for (const s of [-1, 1])
    parts.box(
      0.16,
      height + 0.16,
      0.08,
      center + s * (width / 2 + 0.08),
      (height + 0.16) / 2,
      ROOM.maxZ - 0.04,
      P.walnut,
    );
  parts.box(width + 0.48, 0.18, 0.1, center, height + 0.09, ROOM.maxZ - 0.05, P.walnut);
}

function buildCeiling(parts: PartList) {
  parts.box(
    ROOM.maxX - ROOM.minX + 2 * T,
    0.3,
    ROOM.maxZ - ROOM.minZ + 2 * T,
    0,
    H + 0.15,
    0,
    P.ceiling,
  );
  // Main beams over the columns, then lighter joists for a coffered look.
  for (const z of [-5, 4.5])
    parts.box(ROOM.maxX - ROOM.minX, 0.45, 0.42, 0, H - 0.225, z, P.walnut);
  for (const x of [-6.2, 6.2])
    parts.box(0.42, 0.45, ROOM.maxZ - ROOM.minZ, x, H - 0.225, 0, P.walnut);
  for (let x = ROOM.minX + 2; x < ROOM.maxX; x += 2) {
    if (Math.abs(Math.abs(x) - 6.2) < 0.5) continue;
    parts.box(0.16, 0.22, ROOM.maxZ - ROOM.minZ, x, H - 0.11, 0, P.honey);
  }
}

export interface LampLight {
  x: number;
  y: number;
  z: number;
  intensity: number;
  distance: number;
  color: string;
}

function pendant(
  parts: PartList,
  lights: LampLight[],
  x: number,
  z: number,
  y: number,
  color: string,
) {
  parts.cyl(0.006, 0.006, H - y, x, (H + y) / 2, z, P.iron, { segments: 5 });
  parts.cyl(0.04, 0.04, 0.06, x, y + 0.03, z, P.brass, { material: "metal", segments: 10 });
  parts.cyl(0.05, 0.25, 0.24, x, y - 0.12, z, color, { segments: 20 });
  parts.cyl(0.23, 0.23, 0.01, x, y - 0.235, z, P.lampGlow, {
    material: "glow",
    intensity: 2.6,
    segments: 20,
  });
  lights.push({ x, y: y - 0.45, z, intensity: 5.5, distance: 7.5, color: "#ffcf8f" });
}

function chandelier(
  parts: PartList,
  lights: LampLight[],
  x: number,
  z: number,
  y: number,
  radius: number,
) {
  // Three straight chains from the ceiling to the ring.
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    parts.cyl(
      0.006,
      0.006,
      H - y,
      x + Math.cos(a) * radius,
      (H + y) / 2,
      z + Math.sin(a) * radius,
      P.iron,
      { segments: 4 },
    );
  }
  parts.torus(radius, 0.025, x, y, z, P.brass, {
    material: "metal",
    rx: Math.PI / 2,
    segments: 40,
  });
  parts.torus(radius * 0.55, 0.02, x, y + 0.25, z, P.brass, {
    material: "metal",
    rx: Math.PI / 2,
    segments: 30,
  });
  parts.sphere(0.08, x, y + 0.1, z, P.brass, { material: "metal" });
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const bx = x + Math.cos(a) * radius;
    const bz = z + Math.sin(a) * radius;
    parts.cyl(0.03, 0.03, 0.08, bx, y + 0.04, bz, P.cream, { segments: 8 });
    parts.sphere(0.045, bx, y + 0.13, bz, P.lampGlow, {
      material: "glow",
      intensity: 3.2,
      scale: [1, 1.3, 1],
      segments: 10,
    });
  }
  lights.push({ x, y: y - 0.2, z, intensity: 14, distance: 13, color: "#ffd59e" });
}

/** The building itself: walls with windows, wainscot, ceiling, door and hanging lights. */
export function buildRoom(): { parts: PartList; lights: LampLight[] } {
  const parts = new PartList();
  const lights: LampLight[] = [];
  const openingsFor = (side: WallSide): Opening[] =>
    WINDOWS.filter((w) => w.wall === side).map((w) => ({
      center: w.center,
      width: w.width,
      bottom: w.sill,
      top: w.top,
    }));

  buildWall(parts, "north", openingsFor("north"));
  buildWall(parts, "east", openingsFor("east"));
  buildWall(parts, "west", []);
  buildWall(parts, "south", [
    { center: ENTRANCE.center, width: ENTRANCE.width, bottom: 0, top: ENTRANCE.height },
  ]);
  for (const w of WINDOWS)
    buildWindow(parts, w.wall, { center: w.center, width: w.width, bottom: w.sill, top: w.top });
  buildDoor(parts);
  buildCeiling(parts);

  // Pendants over the collaborative and reading tables.
  for (const item of FURNITURE) {
    if (item.kind === "collabTable") {
      for (const dz of [-0.65, 0.65]) pendant(parts, lights, item.x, item.z + dz, 2.35, P.sageDeep);
    } else if (item.kind === "roundTable") {
      pendant(parts, lights, item.x, item.z, 2.3, P.mustard);
    } else if (item.kind === "readingTable") {
      for (const dx of [-0.45, 0.45]) pendant(parts, lights, item.x + dx, item.z, 2.35, P.rust);
    }
  }
  chandelier(parts, lights, 0, 5.4, 4.4, 0.85);
  chandelier(parts, lights, -11, -0.9, 4.7, 0.7);
  chandelier(parts, lights, 12.2, 6.5, 4.7, 0.7);
  // Quiet study: soft, low light rather than bright pendants.
  lights.push({ x: 11.25, y: 3.2, z: -7.2, intensity: 4, distance: 9, color: "#ffd8a8" });
  lights.push({ x: 14.6, y: 3.0, z: -6.6, intensity: 3, distance: 8, color: "#ffd8a8" });

  return { parts, lights };
}
