import { FURNITURE_SPECS, type FurnitureItem, hashString } from "@ovr/shared";
import { createRandom, type Random } from "@/lib/random";
import { BOOK_COLORS, PALETTE } from "./palette";
import { PartList, vary } from "./parts";

/**
 * Builders for every furniture kind in the layout. Each returns parts in the item's local space:
 * origin on the floor at the centre of its footprint, front facing +Z.
 */

const P = PALETTE;

function chairFabric(item: FurnitureItem): string {
  switch (item.zone) {
    case "collab":
      return P.teal;
    case "quiet":
      return P.mustard;
    case "hall":
      return P.rust;
    default:
      return P.sage;
  }
}

/** Green-shaded banker's lamp, the classic library desk lamp. */
function bankersLamp(parts: PartList, x: number, y: number, z: number, rotY = 0) {
  const lamp = new PartList();
  lamp.box(0.2, 0.025, 0.12, 0, 0.0125, 0, P.brass, { material: "metal", radius: 0.008 });
  lamp.cyl(0.009, 0.009, 0.26, 0, 0.15, -0.02, P.brass, { material: "metal", segments: 8 });
  lamp.cyl(0.062, 0.062, 0.3, 0, 0.29, 0.02, P.forest, {
    rz: Math.PI / 2,
    segments: 16,
    scale: [1, 1, 0.75],
  });
  lamp.box(0.27, 0.012, 0.07, 0, 0.245, 0.02, P.lampGlow, { material: "glow", intensity: 2.4 });
  parts.addTransformed(lamp, x, y, z, rotY);
}

/** A few stacked books, notebooks or a mug on a tabletop. */
function tableClutter(
  parts: PartList,
  rand: Random,
  topY: number,
  halfW: number,
  halfD: number,
  count: number,
) {
  for (let i = 0; i < count; i++) {
    const x = rand.range(-halfW + 0.2, halfW - 0.2);
    const z = rand.range(-halfD + 0.15, halfD - 0.15);
    const kind = rand.next();
    const rot = rand.range(-0.6, 0.6);
    if (kind < 0.45) {
      let y = topY;
      const n = rand.int(1, 3);
      for (let b = 0; b < n; b++) {
        const h = rand.range(0.025, 0.045);
        parts.box(
          rand.range(0.17, 0.24),
          h,
          rand.range(0.12, 0.16),
          x,
          y + h / 2,
          z,
          vary(rand.pick(BOOK_COLORS), 0.05, rand.next()),
          {
            ry: rot + rand.range(-0.15, 0.15),
            radius: 0.004,
            segments: 1,
          },
        );
        y += h;
      }
    } else if (kind < 0.8) {
      parts.box(0.21, 0.008, 0.28, x, topY + 0.004, z, P.paper, { ry: rot });
      parts.box(0.006, 0.006, 0.14, x + 0.06, topY + 0.011, z, P.mustard, { ry: rot + 0.4 });
    } else {
      parts.cyl(0.04, 0.036, 0.09, x, topY + 0.045, z, rand.pick([P.cream, P.sageDeep, P.rust]), {
        segments: 12,
      });
      parts.cyl(0.034, 0.034, 0.004, x, topY + 0.088, z, P.walnutDark, { segments: 12 });
    }
  }
}

function wallShelf(item: FurnitureItem, parts: PartList) {
  const spec = FURNITURE_SPECS.wallShelf;
  const w = item.width ?? spec.width;
  const d = spec.depth;
  const h = spec.height;
  parts.box(w, 0.12, d, 0, 0.06, 0, P.plinth);
  parts.box(w - 0.02, h - 0.12, 0.03, 0, 0.12 + (h - 0.12) / 2, -d / 2 + 0.015, P.walnutDark);
  for (const s of [-1, 1]) parts.box(0.05, h, d, s * (w / 2 - 0.025), h / 2, 0, P.walnut);
  parts.box(w + 0.04, 0.09, d + 0.05, 0, h - 0.045, 0.01, P.walnut, { radius: 0.01, segments: 1 });
  parts.box(w + 0.08, 0.03, d + 0.08, 0, h - 0.11, 0.02, P.walnutDark);
  for (const y of WALL_SHELF_BOARDS)
    parts.box(w - 0.1, 0.03, d - 0.05, 0, y - 0.015, 0.005, P.walnut);
}

function shelfRow(item: FurnitureItem, parts: PartList) {
  const spec = FURNITURE_SPECS.shelfRow;
  const w = item.width ?? spec.width;
  const d = spec.depth;
  const h = spec.height;
  parts.box(w, 0.1, d, 0, 0.05, 0, P.plinth);
  parts.box(w - 0.04, h - 0.1, 0.03, 0, 0.1 + (h - 0.1) / 2, 0, P.walnutDark);
  for (const s of [-1, 1]) parts.box(0.05, h, d, s * (w / 2 - 0.025), h / 2, 0, P.walnut);
  parts.box(w + 0.04, 0.06, d + 0.04, 0, h - 0.03, 0, P.walnut, { radius: 0.01, segments: 1 });
  for (const y of SHELF_ROW_BOARDS) {
    for (const s of [-1, 1])
      parts.box(w - 0.1, 0.03, d / 2 - 0.04, 0, y - 0.015, s * (d / 4), P.walnut);
  }
}

function collabTable(item: FurnitureItem, parts: PartList, rand: Random) {
  const isReading = item.kind === "readingTable";
  const spec = FURNITURE_SPECS[item.kind];
  const w = spec.width;
  const d = spec.depth;
  parts.box(w, 0.06, d, 0, 0.73, 0, P.oak, { radius: 0.025 });
  parts.box(w - 0.2, 0.08, d - 0.2, 0, 0.66, 0, P.honey);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      parts.box(0.08, 0.66, 0.08, sx * (w / 2 - 0.12), 0.33, sz * (d / 2 - 0.12), P.walnut);
    }
  }
  const lampX = isReading ? 0.45 : 0.62;
  bankersLamp(parts, -lampX, 0.76, 0);
  bankersLamp(parts, lampX, 0.76, 0, Math.PI);
  tableClutter(parts, rand, 0.76, w / 2, d / 2, isReading ? 2 : 4);
}

function roundTable(_item: FurnitureItem, parts: PartList, rand: Random) {
  parts.cyl(0.8, 0.8, 0.06, 0, 0.73, 0, P.oak, { segments: 40 });
  parts.cyl(0.75, 0.75, 0.04, 0, 0.68, 0, P.honey, { segments: 40 });
  parts.cyl(0.07, 0.1, 0.64, 0, 0.34, 0, P.walnut, { segments: 14 });
  parts.cyl(0.32, 0.38, 0.05, 0, 0.025, 0, P.walnutDark, { segments: 24 });
  bankersLamp(parts, 0, 0.76, 0, 0.6);
  tableClutter(parts, rand, 0.76, 0.5, 0.5, 3);
}

function carrel(_item: FurnitureItem, parts: PartList, rand: Random) {
  parts.box(1.2, 0.04, 0.65, 0, 0.74, 0, P.oak, { radius: 0.012, segments: 1 });
  for (const s of [-1, 1]) {
    parts.box(0.04, 0.72, 0.62, s * 0.58, 0.36, -0.01, P.honey);
    parts.box(0.03, 0.5, 0.42, s * 0.585, 1.0, -0.11, P.walnut);
  }
  parts.box(1.2, 0.52, 0.04, 0, 1.0, -0.305, P.walnut);
  parts.box(1.06, 0.36, 0.012, 0, 1.0, -0.28, P.sageDeep);
  parts.box(0.12, 0.09, 0.004, rand.range(-0.35, -0.1), 1.05, -0.272, P.paper, {
    rz: rand.range(-0.1, 0.1),
  });
  parts.box(0.1, 0.12, 0.004, rand.range(0.05, 0.3), 0.98, -0.272, P.cream, {
    rz: rand.range(-0.1, 0.1),
  });
  // Articulated desk lamp.
  const lx = rand.chance(0.5) ? 0.42 : -0.42;
  parts.cyl(0.06, 0.07, 0.02, lx, 0.77, -0.17, P.iron, { segments: 14 });
  parts.cyl(0.008, 0.008, 0.34, lx, 0.93, -0.12, P.brass, {
    material: "metal",
    rx: 0.35,
    segments: 6,
  });
  parts.cyl(0.03, 0.075, 0.1, lx, 1.08, 0.0, P.iron, { rx: 0.5, segments: 14 });
  parts.cyl(0.07, 0.07, 0.006, lx, 1.04, 0.04, P.lampGlow, {
    material: "glow",
    rx: 0.5,
    intensity: 2.2,
    segments: 14,
  });
  tableClutter(parts, rand, 0.76, 0.45, 0.25, 2);
}

function chair(item: FurnitureItem, parts: PartList) {
  const fabric = chairFabric(item);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.box(0.035, 0.42, 0.035, sx * 0.19, 0.21, sz * 0.18, P.walnut);
    parts.box(0.035, 0.48, 0.035, sx * 0.19, 0.66, -0.2, P.walnut);
  }
  parts.box(0.46, 0.045, 0.44, 0, 0.42, 0, P.oak, { radius: 0.015, segments: 1 });
  parts.box(0.41, 0.035, 0.39, 0, 0.455, 0.01, fabric, { radius: 0.015, segments: 2 });
  parts.box(0.42, 0.17, 0.03, 0, 0.8, -0.205, P.oak, { radius: 0.012, segments: 1, rx: -0.06 });
  parts.box(0.4, 0.035, 0.02, 0, 0.6, -0.2, P.walnut);
}

function armchair(item: FurnitureItem, parts: PartList) {
  const fabric = (item.seed ?? hashString(item.id)) % 2 === 0 ? P.rust : P.mustard;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1])
      parts.cyl(0.025, 0.018, 0.12, sx * 0.38, 0.06, sz * 0.33, P.walnutDark, { segments: 8 });
    parts.box(0.17, 0.32, 0.8, sx * 0.39, 0.48, 0.02, fabric, { radius: 0.07 });
  }
  parts.box(0.95, 0.24, 0.85, 0, 0.24, 0, fabric, { radius: 0.06 });
  parts.box(0.62, 0.1, 0.64, 0, 0.39, 0.07, vary(fabric, 0.05, 0.8), { radius: 0.045 });
  parts.box(0.92, 0.56, 0.2, 0, 0.64, -0.33, fabric, { radius: 0.08, rx: -0.12 });
  parts.box(0.36, 0.3, 0.1, 0.12, 0.6, -0.17, P.cream, { radius: 0.05, rx: -0.25, rz: 0.12 });
}

function sofa(_item: FurnitureItem, parts: PartList) {
  const fabric = P.tealDeep;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1])
      parts.cyl(0.025, 0.018, 0.12, sx * 0.98, 0.06, sz * 0.36, P.walnutDark, { segments: 8 });
    parts.box(0.2, 0.36, 0.86, sx * 0.95, 0.48, 0.02, fabric, { radius: 0.08 });
  }
  parts.box(2.1, 0.24, 0.88, 0, 0.24, 0, fabric, { radius: 0.06 });
  for (let i = -1; i <= 1; i++) {
    parts.box(0.6, 0.1, 0.66, i * 0.62, 0.39, 0.08, vary(fabric, 0.04, 0.7), { radius: 0.045 });
    parts.box(0.6, 0.42, 0.18, i * 0.62, 0.66, -0.3, vary(fabric, 0.03, 0.6), {
      radius: 0.07,
      rx: -0.14,
    });
  }
  parts.box(2.06, 0.3, 0.16, 0, 0.62, -0.39, fabric, { radius: 0.06 });
  parts.box(0.36, 0.32, 0.11, -0.66, 0.64, -0.14, P.mustard, { radius: 0.05, rx: -0.3, rz: -0.15 });
  parts.box(0.34, 0.3, 0.1, 0.7, 0.62, -0.15, P.rose, { radius: 0.05, rx: -0.3, rz: 0.12 });
}

function windowSeat(item: FurnitureItem, parts: PartList) {
  const rand = createRandom(hashString(item.id));
  parts.box(2.2, 0.38, 0.6, 0, 0.19, 0, P.walnut);
  for (const x of [-0.72, 0, 0.72]) parts.box(0.6, 0.24, 0.01, x, 0.19, 0.3, P.honey);
  parts.box(2.14, 0.08, 0.56, 0, 0.42, 0, P.cream, { radius: 0.035 });
  parts.box(0.42, 0.34, 0.12, -0.78, 0.6, -0.19, rand.pick([P.rose, P.sage, P.mustard]), {
    radius: 0.06,
    rx: -0.25,
  });
  parts.box(0.4, 0.32, 0.12, 0.8, 0.6, -0.19, rand.pick([P.teal, P.rust, P.cream]), {
    radius: 0.06,
    rx: -0.25,
  });
}

function coffeeTable(_item: FurnitureItem, parts: PartList, rand: Random) {
  parts.box(1.2, 0.05, 0.7, 0, 0.4, 0, P.walnut, { radius: 0.02 });
  parts.box(1.08, 0.02, 0.58, 0, 0.12, 0, P.walnutDark);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) parts.box(0.05, 0.38, 0.05, sx * 0.54, 0.19, sz * 0.29, P.walnutDark);
  tableClutter(parts, rand, 0.425, 0.6, 0.35, 3);
  // A few books on the lower shelf.
  for (let i = 0; i < 3; i++)
    parts.box(0.24, 0.04, 0.17, -0.25 + i * 0.02, 0.15 + i * 0.04, 0, rand.pick(BOOK_COLORS), {
      ry: rand.range(-0.2, 0.2),
    });
}

function plant(item: FurnitureItem, parts: PartList) {
  const rand = createRandom(item.seed ?? hashString(item.id));
  parts.cyl(0.22, 0.17, 0.36, 0, 0.18, 0, P.terracotta, { segments: 16 });
  parts.cyl(0.235, 0.235, 0.05, 0, 0.36, 0, vary(P.terracotta, 0.04, 0.7), { segments: 16 });
  parts.cyl(0.2, 0.2, 0.02, 0, 0.37, 0, P.soil, { segments: 16 });
  const type = (item.seed ?? 0) % 3;
  const leaf = () => vary(rand.pick([P.leaf, P.leafLight, P.leafDark]), 0.04, rand.next());
  if (type === 0) {
    for (let i = 0; i < 7; i++) {
      const a = rand.range(0, Math.PI * 2);
      const r = rand.range(0, 0.16);
      parts.blob(
        rand.range(0.16, 0.26),
        Math.cos(a) * r,
        rand.range(0.55, 1.15),
        Math.sin(a) * r,
        leaf(),
        { segments: 1 },
      );
    }
  } else if (type === 1) {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rand.range(-0.2, 0.2);
      const h = rand.range(0.6, 1.0);
      parts.cone(0.055, h, Math.cos(a) * 0.07, 0.38 + h / 2, Math.sin(a) * 0.07, leaf(), {
        rx: Math.sin(a) * 0.18,
        rz: -Math.cos(a) * 0.18,
        segments: 5,
        scale: [1, 1, 0.45],
      });
    }
  } else {
    parts.cyl(0.025, 0.035, 0.8, 0, 0.75, 0, P.walnut, { segments: 6 });
    for (let i = 0; i < 9; i++) {
      const a = rand.range(0, Math.PI * 2);
      const r = rand.range(0.05, 0.22);
      parts.blob(
        rand.range(0.1, 0.16),
        Math.cos(a) * r,
        rand.range(0.95, 1.45),
        Math.sin(a) * r,
        leaf(),
        {
          segments: 0,
          scale: [1, 0.55, 1],
          ry: a,
        },
      );
    }
  }
}

function floorLamp(_item: FurnitureItem, parts: PartList) {
  parts.cyl(0.16, 0.18, 0.03, 0, 0.015, 0, P.iron, { segments: 20 });
  parts.cyl(0.014, 0.014, 1.42, 0, 0.74, 0, P.brass, { material: "metal", segments: 8 });
  parts.cyl(0.16, 0.25, 0.3, 0, 1.56, 0, P.cream, { segments: 22 });
  parts.cyl(0.21, 0.24, 0.015, 0, 1.415, 0, P.lampGlow, {
    material: "glow",
    intensity: 2.2,
    segments: 22,
  });
  parts.sphere(0.05, 0, 1.47, 0, P.lampGlow, { material: "glow", intensity: 3 });
}

function column(_item: FurnitureItem, parts: PartList) {
  parts.box(0.78, 0.36, 0.78, 0, 0.18, 0, P.stone);
  parts.box(0.7, 0.08, 0.7, 0, 0.4, 0, P.stoneDark);
  parts.cyl(0.27, 0.3, 6.0, 0, 3.44, 0, P.honey, { segments: 20 });
  parts.cyl(0.31, 0.31, 0.06, 0, 1.2, 0, P.brass, { material: "metal", segments: 20 });
  parts.box(0.66, 0.28, 0.66, 0, 6.58, 0, P.walnut);
  parts.box(0.8, 0.12, 0.8, 0, 6.78, 0, P.walnutDark);
}

function whiteboard(_item: FurnitureItem, parts: PartList) {
  for (const s of [-1, 1]) {
    parts.box(0.06, 0.04, 0.55, s * 0.8, 0.05, 0, P.aluminium, { material: "metal" });
    for (const z of [-0.24, 0.24]) parts.sphere(0.025, s * 0.8, 0.025, z, P.iron, { segments: 8 });
    parts.box(0.04, 1.88, 0.04, s * 0.8, 1.0, 0, P.aluminium, { material: "metal" });
  }
  parts.box(1.66, 1.08, 0.04, 0, 1.35, 0, P.aluminium, { material: "metal" });
  parts.box(1.58, 1.0, 0.01, 0, 1.35, 0.02, P.whiteboard);
  parts.box(1.3, 0.025, 0.08, 0, 0.8, 0.05, P.aluminium, { material: "metal" });
  for (const [i, c] of ["#2f6fb3", "#c0392b", "#2d2420"].entries()) {
    parts.cyl(0.009, 0.009, 0.12, -0.3 + i * 0.16, 0.825, 0.06, c, {
      rz: Math.PI / 2,
      segments: 6,
    });
  }
}

function circulationDesk(_item: FurnitureItem, parts: PartList, rand: Random) {
  parts.box(3.0, 1.0, 0.06, 0, 0.5, 0.42, P.walnut);
  for (const x of [-1.0, 0, 1.0]) parts.box(0.8, 0.62, 0.02, x, 0.5, 0.455, P.honey);
  parts.box(3.12, 0.05, 0.42, 0, 1.05, 0.26, P.oak, { radius: 0.015, segments: 1 });
  parts.box(3.0, 0.04, 0.6, 0, 0.75, -0.12, P.honey);
  for (const s of [-1, 1]) parts.box(0.06, 1.0, 0.9, s * 1.5, 0.5, 0, P.walnut);
  parts.box(3.0, 0.1, 0.9, 0, 0.05, 0, P.plinth);
  // Service bell, lamp and books on the counter.
  parts.cyl(0.05, 0.05, 0.012, 0.9, 1.081, 0.25, P.walnutDark, { segments: 16 });
  parts.sphere(0.045, 0.9, 1.088, 0.25, P.brass, {
    material: "metal",
    segments: 14,
    scale: [1, 0.8, 1],
  });
  bankersLamp(parts, -1.05, 1.075, 0.2);
  tableClutter(parts, rand, 1.075, 1.3, 0.12, 2);
  tableClutter(parts, rand, 0.77, 1.3, 0.2, 3);
}

function fireplace(_item: FurnitureItem, parts: PartList) {
  for (const s of [-1, 1]) parts.box(0.45, 1.3, 0.62, s * 0.975, 0.65, 0, P.stone);
  parts.box(2.4, 0.42, 0.62, 0, 1.51, 0, P.stone);
  parts.box(2.62, 0.08, 0.76, 0, 1.76, 0.05, P.walnut, { radius: 0.015, segments: 1 });
  parts.box(2.0, 0.56, 0.42, 0, 2.08, -0.09, P.stone);
  parts.box(1.52, 1.3, 0.04, 0, 0.65, -0.28, "#2a211c");
  parts.box(1.52, 0.04, 0.56, 0, 0.02, 0, P.stoneDark);
  parts.box(2.7, 0.06, 0.5, 0, 0.03, 0.55, P.stoneDark);
  for (const [i, x] of [-0.18, 0.18].entries()) {
    parts.cyl(0.065, 0.065, 0.62, x * 0.2, 0.1 + i * 0.06, 0.02, P.walnutDark, {
      rz: Math.PI / 2,
      ry: i ? 0.5 : -0.4,
      segments: 8,
    });
  }
  // Mantel: candles, a little clock, books and a trailing plant.
  for (const x of [-1.05, -0.9]) {
    parts.cyl(0.025, 0.025, 0.2, x, 1.9, 0.08, P.cream, { segments: 10 });
    parts.sphere(0.016, x, 2.02, 0.08, P.lampGlow, {
      material: "glow",
      intensity: 3,
      scale: [1, 1.6, 1],
      segments: 8,
    });
  }
  parts.box(0.18, 0.22, 0.08, 0.15, 1.91, 0.05, P.walnutDark, { radius: 0.03 });
  parts.cyl(0.06, 0.06, 0.01, 0.15, 1.93, 0.095, P.paper, { rx: Math.PI / 2, segments: 16 });
  for (let i = 0; i < 4; i++)
    parts.box(
      0.04,
      0.2 + (i % 2) * 0.03,
      0.15,
      0.6 + i * 0.045,
      1.9 + (i % 2) * 0.015,
      0.05,
      BOOK_COLORS[i * 3]!,
    );
  parts.cyl(0.07, 0.06, 0.1, 1.05, 1.85, 0.08, P.terracotta, { segments: 12 });
  for (let i = 0; i < 4; i++)
    parts.blob(0.07, 1.05 + (i - 1.5) * 0.04, 1.93 - i * 0.07, 0.12 + i * 0.03, P.leaf, {
      segments: 0,
    });
}

function globeStand(_item: FurnitureItem, parts: PartList) {
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    // Legs lean outward from the tabletop ring to the floor.
    parts.box(0.045, 0.52, 0.045, Math.sin(a) * 0.24, 0.25, Math.cos(a) * 0.24, P.walnut, {
      rx: Math.cos(a) * 0.18,
      rz: -Math.sin(a) * 0.18,
    });
  }
  parts.cyl(0.3, 0.3, 0.04, 0, 0.5, 0, P.walnut, { segments: 24 });
  parts.cyl(0.04, 0.05, 0.16, 0, 0.58, 0, P.walnutDark, { segments: 10 });
  parts.torus(0.36, 0.012, 0, 0.95, 0, P.brass, { material: "metal", rz: 0.4, segments: 32 });
}

/** Board heights (top surface of each board) for wall shelves; books sit on these. */
export const WALL_SHELF_BOARDS = [0.14, 0.58, 1.02, 1.46, 1.9, 2.34, 2.78, 3.2] as const;
/** Board heights for freestanding double-sided rows. */
export const SHELF_ROW_BOARDS = [0.12, 0.55, 0.98, 1.41, 1.84, 2.27] as const;

/** Builds the static parts for one layout item in its local space. Returns null for kinds drawn elsewhere. */
export function buildFurnitureParts(item: FurnitureItem): PartList | null {
  const parts = new PartList();
  const rand = createRandom(item.seed ?? hashString(item.id));
  switch (item.kind) {
    case "wallShelf":
      wallShelf(item, parts);
      break;
    case "shelfRow":
      shelfRow(item, parts);
      break;
    case "collabTable":
    case "readingTable":
      collabTable(item, parts, rand);
      break;
    case "roundTable":
      roundTable(item, parts, rand);
      break;
    case "carrel":
      carrel(item, parts, rand);
      break;
    case "chair":
      chair(item, parts);
      break;
    case "armchair":
      armchair(item, parts);
      break;
    case "sofa":
      sofa(item, parts);
      break;
    case "windowSeat":
      windowSeat(item, parts);
      break;
    case "coffeeTable":
      coffeeTable(item, parts, rand);
      break;
    case "plant":
      plant(item, parts);
      break;
    case "floorLamp":
      floorLamp(item, parts);
      break;
    case "column":
      column(item, parts);
      break;
    case "whiteboard":
      whiteboard(item, parts);
      break;
    case "circulationDesk":
      circulationDesk(item, parts, rand);
      break;
    case "fireplace":
      fireplace(item, parts);
      break;
    case "globe":
      globeStand(item, parts);
      break;
    case "rug":
    case "noticeBoard":
      return null;
  }
  return parts;
}
