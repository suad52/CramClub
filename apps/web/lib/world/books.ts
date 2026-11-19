import { Color, Euler, Matrix4, Quaternion, Vector3 } from "three";
import { FURNITURE_SPECS, type FurnitureItem, hashString } from "@ovr/shared";
import { createRandom, type Random } from "@/lib/random";
import { SHELF_ROW_BOARDS, WALL_SHELF_BOARDS } from "./furniture";
import { BOOK_COLORS } from "./palette";
import { vary } from "./parts";

export interface BookInstances {
  matrices: Matrix4[];
  colors: Color[];
}

const pos = new Vector3();
const scale = new Vector3();
const quat = new Quaternion();
const euler = new Euler();
const local = new Matrix4();
const itemMatrix = new Matrix4();
const yAxis = new Vector3(0, 1, 0);

/**
 * Fills one shelf board with books, left to right: mostly upright spines, with the odd gap,
 * leaning book or flat stack so the shelves look used rather than generated.
 */
function fillBoard(
  out: BookInstances,
  rand: Random,
  x0: number,
  x1: number,
  boardY: number,
  clearance: number,
  faceZ: number,
  facing: 1 | -1,
  maxDepth: number,
) {
  let x = x0;
  while (x < x1 - 0.03) {
    const roll = rand.next();
    if (roll < 0.05) {
      x += rand.range(0.06, 0.18);
      continue;
    }
    if (roll < 0.09 && x1 - x > 0.3) {
      // Flat stack.
      let y = boardY;
      const len = rand.range(0.2, 0.26);
      const n = rand.int(2, 5);
      for (let i = 0; i < n && y < boardY + clearance - 0.06; i++) {
        const t = rand.range(0.03, 0.05);
        const depth = rand.range(0.14, Math.min(0.2, maxDepth));
        addBook(
          out,
          x + len / 2 + rand.range(-0.01, 0.01),
          y + t / 2,
          faceZ - (facing * depth) / 2,
          len,
          t,
          depth,
          0,
          rand,
        );
        y += t;
      }
      x += len + 0.02;
      continue;
    }
    const thickness = rand.range(0.024, 0.058);
    if (x + thickness > x1) break;
    const height = clearance * rand.range(0.62, 0.9);
    const depth = rand.range(0.14, maxDepth);
    const lean = roll > 0.965 ? rand.range(0.12, 0.28) : 0;
    const lift = lean ? (Math.sin(lean) * thickness) / 2 : 0;
    addBook(
      out,
      x + thickness / 2 + Math.sin(lean) * height * 0.5,
      boardY + height / 2 - lift,
      faceZ - (facing * depth) / 2,
      thickness,
      height,
      depth,
      -lean,
      rand,
    );
    x += thickness + (lean ? Math.sin(lean) * height + 0.01 : rand.range(0.001, 0.004));
  }
}

function addBook(
  out: BookInstances,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  roll: number,
  rand: Random,
) {
  euler.set(0, 0, roll);
  quat.setFromEuler(euler);
  local.compose(pos.set(x, y, z), quat, scale.set(w, h, d));
  out.matrices.push(new Matrix4().multiplyMatrices(itemMatrix, local));
  out.colors.push(vary(rand.pick(BOOK_COLORS), 0.06, rand.next()));
}

/** Generates book instances for every shelf in the layout. */
export function buildBooks(items: readonly FurnitureItem[]): BookInstances {
  const out: BookInstances = { matrices: [], colors: [] };
  for (const item of items) {
    if (item.kind !== "wallShelf" && item.kind !== "shelfRow") continue;
    const spec = FURNITURE_SPECS[item.kind];
    const w = item.width ?? spec.width;
    const rand = createRandom(item.seed ?? hashString(item.id));
    quat.setFromAxisAngle(yAxis, item.rotationY);
    itemMatrix.compose(pos.set(item.x, 0, item.z), quat, scale.set(1, 1, 1));
    const x0 = -w / 2 + 0.06;
    const x1 = w / 2 - 0.06;
    if (item.kind === "wallShelf") {
      const boards = WALL_SHELF_BOARDS;
      for (let i = 0; i < boards.length - 1; i++) {
        const clearance = boards[i + 1]! - boards[i]! - 0.03;
        // Leave the odd upper shelf half empty so the walls breathe.
        const end = i >= 5 && rand.chance(0.4) ? rand.range(x0 + 0.3, x1) : x1;
        fillBoard(out, rand, x0, end, boards[i]!, clearance, spec.depth / 2 - 0.05, 1, 0.24);
      }
    } else {
      const boards = SHELF_ROW_BOARDS;
      for (const side of [1, -1] as const) {
        for (let i = 0; i < boards.length - 1; i++) {
          const clearance = boards[i + 1]! - boards[i]! - 0.03;
          fillBoard(
            out,
            rand,
            x0,
            x1,
            boards[i]!,
            clearance,
            side * (spec.depth / 2 - 0.04),
            side,
            0.2,
          );
        }
      }
    }
  }
  return out;
}
