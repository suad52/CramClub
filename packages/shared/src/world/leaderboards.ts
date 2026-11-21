import type { Collider } from "./library";

/**
 * The hall's two leaderboards: freestanding walnut notice boards halfway down the long side
 * walls, one each side of the cross aisle (z = -1, the hall's middle), standing just in front of
 * the bookcases and facing the centre. Looking down the hall from the arrival point, "Most time
 * locked in" is on the left (west, under the gallery) and "Top learners" on the right (east,
 * under the tall window). They sit in the gaps the plan leaves there: between the card
 * catalogues on the west, between the big plants on the east, clear of the tables' end chairs.
 * Built in code (apps/web/components/world/Leaderboards.tsx); layout and collision live here for
 * the renderer and for collision on the client and the game server.
 *
 * Metres, world space. In a board's own frame its face looks along +Z and x runs across it.
 */
export const LEADERBOARD_STAND = {
  /** Across the two posts. */
  width: 1.6,
  /** Floor to the top of the arched crest over the cap rail (the cap itself is at 2.05). */
  height: 2.22,
  /** Front to back across the two feet (centred on the board). */
  footDepth: 0.52,
  /** The painted face: its canvas has the same aspect (1024 × 1344). */
  face: { width: 1.2, height: 1.575, bottom: 0.33 },
} as const;

export type LeaderboardKind = "focus" | "xp";

export interface LeaderboardSpot {
  id: string;
  kind: LeaderboardKind;
  x: number;
  z: number;
  /** Which way the face looks (0 = +Z, π/2 = +X). */
  rotationY: number;
}

export const LEADERBOARDS: readonly LeaderboardSpot[] = [
  { id: "leaderboard_focus", kind: "focus", x: -13.1, z: -1, rotationY: Math.PI / 2 },
  { id: "leaderboard_xp", kind: "xp", x: 13.1, z: -1, rotationY: -Math.PI / 2 },
];

export const LEADERBOARD_COLLIDERS: Collider[] = LEADERBOARDS.map((b) => ({
  kind: "box",
  id: b.id,
  x: b.x,
  z: b.z,
  halfW: LEADERBOARD_STAND.width / 2,
  halfD: LEADERBOARD_STAND.footDepth / 2,
  rotationY: b.rotationY,
  y0: 0,
  y1: LEADERBOARD_STAND.height,
}));
