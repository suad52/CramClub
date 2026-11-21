import type { Collider } from "./library";

/**
 * The librarian's area: a small circulation desk in the alcove under the north gallery, between
 * its two middle columns, straight down the central aisle from where players arrive. It's built
 * in code (apps/web/components/world/LibrarianDesk.tsx), not in the Blender plan, so its layout
 * lives here for both the renderer and collision (client and game server).
 *
 * Metres, world space. Everything faces +Z (south, toward the spawn).
 */
export const LIBRARIAN = {
  x: 0,
  /** The front (customer side) of the counter. */
  frontZ: -7.45,
  width: 3,
  /** The tall counter at the front, then the lower work surface behind it. */
  counterDepth: 0.36,
  counterHeight: 1.1,
  workDepth: 0.54,
  workHeight: 0.76,
  /** Where the librarian stands, behind the work surface. */
  librarian: { x: 0, z: -8.6 },
  /** The librarian's chair, pushed aside while she stands. */
  chair: { x: 1.05, z: -8.95, rotationY: -0.55 },
  catalogue: { x: -1.75, z: -9.3, width: 0.86, depth: 0.45, height: 1.2 },
  cart: { x: 1.8, z: -8.9, width: 0.8, depth: 0.4, height: 0.95 },
  /** The hanging sign's centre (it hangs from the gallery's underside at 4.2 m). */
  sign: { z: -7.6, y: 2.08, width: 1.7, height: 0.46 },
} as const;

const L = LIBRARIAN;
const deskDepth = L.counterDepth + L.workDepth;

/** Things in the Blender model the desk area replaced: hidden at load, colliders dropped. */
export const REMOVED_MODEL_OBJECTS = ["Furniture_Globe_Floor_01"] as const;
export const REMOVED_PLAN_ITEMS = ["hall-globe"] as const;
/**
 * Where removed objects stood. The model's export joined some of their parts (the globe's
 * horizon ring) into shared meshes, so triangles wholly inside these cylinders are dropped too.
 */
export const REMOVED_MODEL_REGIONS = [{ x: 0, z: -6.2, radius: 0.62, y0: 0.02, y1: 1.4 }] as const;

export const LIBRARIAN_COLLIDERS: Collider[] = [
  {
    kind: "box",
    id: "librarian_desk",
    x: L.x,
    z: L.frontZ - deskDepth / 2,
    halfW: L.width / 2,
    halfD: deskDepth / 2,
    rotationY: 0,
    y0: 0,
    y1: L.counterHeight,
  },
  { kind: "circle", id: "librarian_chair", x: L.chair.x, z: L.chair.z, radius: 0.28, y0: 0, y1: 1 },
  {
    kind: "circle",
    id: "librarian",
    x: L.librarian.x,
    z: L.librarian.z,
    radius: 0.25,
    y0: 0,
    y1: 1.6,
  },
  {
    kind: "box",
    id: "librarian_catalogue",
    x: L.catalogue.x,
    z: L.catalogue.z,
    halfW: L.catalogue.width / 2,
    halfD: L.catalogue.depth / 2,
    rotationY: 0,
    y0: 0,
    y1: L.catalogue.height,
  },
  {
    kind: "box",
    id: "librarian_cart",
    x: L.cart.x,
    z: L.cart.z,
    halfW: L.cart.width / 2,
    halfD: L.cart.depth / 2,
    rotationY: 0,
    y0: 0,
    y1: L.cart.height,
  },
];
