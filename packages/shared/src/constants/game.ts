/** Name the Colyseus room is registered under; the client joins by this name. */
export const LIBRARY_ROOM_NAME = "library";

/** Hard cap for a public library room (product requirement: 10–15 users, never more than 15). */
export const MAX_PLAYERS_PER_ROOM = 15;

/** Player movement, in metres and seconds. The server will validate against these in Phase 3. */
export const PLAYER = {
  /** Collision radius of a standing player on the floor plane. */
  radius: 0.32,
  /** Normal walking speed. */
  walkSpeed: 3.2,
  /** Speed with "walk faster" (R) on. Server-side validation must allow this as the maximum. */
  runSpeed: 5.4,
  /** Camera height for first-person while standing. */
  eyeHeight: 1.58,
  /** Camera height for first-person while seated. */
  seatedEyeHeight: 1.16,
  /** How close (metres, centre to centre) a player must be to interact with something. */
  interactRange: 1.45,
} as const;

/** Third-person camera limits. */
export const CAMERA = {
  minDistance: 1.6,
  maxDistance: 7,
  defaultDistance: 3.6,
  /** Third-person pitch limits in radians (negative looks down). */
  minPitch: -1.2,
  maxPitch: 0.45,
  firstPersonMinPitch: -1.45,
  firstPersonMaxPitch: 1.45,
} as const;

/** Largest head rotations (radians) that expression tracking maps onto an avatar. */
export const FACIAL_HEAD_LIMITS = {
  yaw: 0.6,
  pitch: 0.45,
  roll: 0.35,
} as const;
