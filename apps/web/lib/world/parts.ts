import {
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Matrix4,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Static scenery is built from simple shapes, each tagged with a colour and a material class,
 * then merged into a handful of meshes. One merged mesh per material keeps the whole library
 * to a few draw calls, which matters far more for browser performance than triangle count.
 */
export type MaterialKey = "solid" | "metal" | "glow" | "glass";

export interface Part {
  geometry: BufferGeometry;
  color: Color;
  material: MaterialKey;
}

export interface PartOptions {
  rx?: number;
  ry?: number;
  rz?: number;
  material?: MaterialKey;
  /** Corner radius for boxes (rounded boxes read as softer, more stylized). */
  radius?: number;
  segments?: number;
  /** Multiplies the colour; >1 on "glow" parts feeds the bloom pass. */
  intensity?: number;
  scale?: [number, number, number];
}

const tmpMatrix = new Matrix4();
const tmpQuat = new Quaternion();
const tmpEuler = new Euler();
const tmpPos = new Vector3();
const tmpScale = new Vector3();

export class PartList {
  readonly parts: Part[] = [];

  private push(
    geometry: BufferGeometry,
    x: number,
    y: number,
    z: number,
    color: string | Color,
    o: PartOptions,
  ) {
    tmpEuler.set(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, "YXZ");
    tmpQuat.setFromEuler(tmpEuler);
    tmpPos.set(x, y, z);
    tmpScale.set(...(o.scale ?? [1, 1, 1]));
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale);
    geometry.applyMatrix4(tmpMatrix);
    const c = color instanceof Color ? color.clone() : new Color(color);
    if (o.intensity) c.multiplyScalar(o.intensity);
    this.parts.push({ geometry, color: c, material: o.material ?? "solid" });
    return this;
  }

  /** Box centred on (x, y, z). */
  box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    color: string | Color,
    o: PartOptions = {},
  ) {
    const g =
      o.radius && o.radius > 0
        ? new RoundedBoxGeometry(
            w,
            h,
            d,
            o.segments ?? 2,
            Math.min(o.radius, w / 2, h / 2, d / 2) * 0.999,
          )
        : new BoxGeometry(w, h, d);
    return this.push(g, x, y, z, color, o);
  }

  /** Cylinder (or truncated cone) centred on (x, y, z), axis along local Y. */
  cyl(
    rTop: number,
    rBottom: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: string | Color,
    o: PartOptions = {},
  ) {
    return this.push(new CylinderGeometry(rTop, rBottom, h, o.segments ?? 16), x, y, z, color, o);
  }

  cone(
    r: number,
    h: number,
    x: number,
    y: number,
    z: number,
    color: string | Color,
    o: PartOptions = {},
  ) {
    return this.push(new ConeGeometry(r, h, o.segments ?? 8), x, y, z, color, o);
  }

  sphere(r: number, x: number, y: number, z: number, color: string | Color, o: PartOptions = {}) {
    const s = o.segments ?? 12;
    return this.push(
      new SphereGeometry(r, s, Math.max(6, Math.round(s * 0.75))),
      x,
      y,
      z,
      color,
      o,
    );
  }

  /** Low-poly faceted blob (foliage, rocks). */
  blob(r: number, x: number, y: number, z: number, color: string | Color, o: PartOptions = {}) {
    return this.push(new IcosahedronGeometry(r, o.segments ?? 1), x, y, z, color, o);
  }

  torus(
    r: number,
    tube: number,
    x: number,
    y: number,
    z: number,
    color: string | Color,
    o: PartOptions & { arc?: number } = {},
  ) {
    return this.push(
      new TorusGeometry(r, tube, 8, o.segments ?? 24, o.arc ?? Math.PI * 2),
      x,
      y,
      z,
      color,
      o,
    );
  }

  /** Adds another list's parts, transformed by a position and Y rotation. */
  addTransformed(other: PartList, x: number, y: number, z: number, rotationY: number) {
    tmpQuat.setFromAxisAngle(new Vector3(0, 1, 0), rotationY);
    tmpMatrix.compose(tmpPos.set(x, y, z), tmpQuat, tmpScale.set(1, 1, 1));
    for (const p of other.parts) {
      p.geometry.applyMatrix4(tmpMatrix);
      this.parts.push(p);
    }
    return this;
  }
}

/** Merges parts into one geometry per material, baking colours into a vertex attribute. */
export function mergeParts(parts: readonly Part[]): Map<MaterialKey, BufferGeometry> {
  const buckets = new Map<MaterialKey, BufferGeometry[]>();
  for (const part of parts) {
    const g = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry;
    if (g !== part.geometry) part.geometry.dispose();
    for (const name of Object.keys(g.attributes)) {
      if (name !== "position" && name !== "normal") g.deleteAttribute(name);
    }
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    const count = g.getAttribute("position").count;
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      colors[i * 3] = part.color.r;
      colors[i * 3 + 1] = part.color.g;
      colors[i * 3 + 2] = part.color.b;
    }
    g.setAttribute("color", new Float32BufferAttribute(colors, 3));
    const list = buckets.get(part.material) ?? [];
    list.push(g);
    buckets.set(part.material, list);
  }
  const merged = new Map<MaterialKey, BufferGeometry>();
  for (const [key, list] of buckets) {
    const g = mergeGeometries(list, false);
    if (!g) throw new Error(`Could not merge ${key} geometry`);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    merged.set(key, g);
    for (const piece of list) piece.dispose();
  }
  return merged;
}

/** Slightly varies a colour's lightness so repeated parts don't look copy-pasted. */
export function vary(hex: string, amount: number, t: number): Color {
  const c = new Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  c.setHSL(hsl.h, hsl.s, Math.min(1, Math.max(0, hsl.l + (t - 0.5) * 2 * amount)));
  return c;
}
