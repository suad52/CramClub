import { ROOM } from "@ovr/shared";
import { createRandom } from "@/lib/random";
import { PALETTE } from "./palette";
import { PartList, vary } from "./parts";

/** Trees, hedges and hills seen through the windows. Never casts shadows (the sun must get in). */
export function buildOutdoors(): PartList {
  const parts = new PartList();
  const rand = createRandom(4242);

  // A clipped hedge and a stone terrace edge right outside the north and east walls.
  for (let x = ROOM.minX - 1; x <= ROOM.maxX + 1; x += 2.2) {
    parts.box(2.1, 0.9, 1.0, x, 0.45, ROOM.minZ - 2.2, vary(PALETTE.leafDark, 0.04, rand.next()), {
      radius: 0.3,
    });
  }
  for (let z = ROOM.minZ - 1; z <= ROOM.maxZ + 1; z += 2.2) {
    parts.box(1.0, 0.9, 2.1, ROOM.maxX + 2.2, 0.45, z, vary(PALETTE.leafDark, 0.04, rand.next()), {
      radius: 0.3,
    });
  }

  const tree = (x: number, z: number, scale: number) => {
    const kind = rand.next();
    const trunkH = rand.range(1.6, 2.6) * scale;
    parts.cyl(0.14 * scale, 0.2 * scale, trunkH, x, trunkH / 2, z, PALETTE.walnut, { segments: 7 });
    if (kind < 0.35) {
      // Pine: stacked cones.
      for (let i = 0; i < 3; i++) {
        const r = (1.6 - i * 0.4) * scale;
        const h = 2.0 * scale;
        parts.cone(
          r,
          h,
          x,
          trunkH + i * 1.1 * scale + h / 2 - 0.4,
          z,
          vary("#3d6a45", 0.05, rand.next()),
          { segments: 7 },
        );
      }
    } else {
      // Broadleaf: a few faceted blobs, some autumn-tinted for warmth.
      const autumn = rand.chance(0.25);
      const base = autumn
        ? rand.pick(["#c9853f", "#b8663a", "#d3a24a"])
        : rand.pick([PALETTE.leaf, PALETTE.leafLight, "#6a9a52"]);
      for (let i = 0; i < 4; i++) {
        parts.blob(
          rand.range(1.1, 1.7) * scale,
          x + rand.range(-0.9, 0.9) * scale,
          trunkH + rand.range(0.6, 1.8) * scale,
          z + rand.range(-0.9, 0.9) * scale,
          vary(base, 0.06, rand.next()),
          { segments: 0 },
        );
      }
    }
  };

  for (let i = 0; i < 26; i++)
    tree(rand.range(-40, 40), rand.range(-48, -17), rand.range(0.9, 1.5));
  for (let i = 0; i < 18; i++) tree(rand.range(21, 46), rand.range(-30, 30), rand.range(0.9, 1.5));

  // Distant rolling hills.
  for (let i = 0; i < 9; i++) {
    const a = -Math.PI * 0.95 + (i / 8) * Math.PI * 1.1;
    parts.blob(
      rand.range(18, 28),
      Math.sin(a) * 95,
      -6,
      -Math.abs(Math.cos(a)) * 95,
      vary("#8daa72", 0.05, rand.next()),
      {
        segments: 1,
        scale: [1.6, 0.6, 1],
      },
    );
  }
  return parts;
}
