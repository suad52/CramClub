import type { MovementState, SpawnPoint } from "@ovr/shared";
import { CAMERA } from "@ovr/shared";

/**
 * Per-frame player and camera data for the local player. Deliberately outside React: it changes
 * every frame, and only a few derived values (zone, nearby seat) are pushed into the store.
 */
export const runtime = {
  x: 0,
  /** Feet height: 0 on the ground floor, 4.6 in the gallery, in between on the stairs. */
  y: 0,
  z: 0,
  /** Velocity on the floor plane (m/s). */
  vx: 0,
  vz: 0,
  /** Direction the avatar faces (radians, 0 = +Z). */
  facing: Math.PI,
  /** Camera yaw/pitch (radians). Yaw 0 looks toward -Z (north). */
  yaw: 0,
  pitch: -0.18,
  /** User-chosen third-person distance. */
  distance: CAMERA.defaultDistance as number,
  /** 1 = third person, 0 = first person; eased between for a smooth zoom. */
  viewBlend: 1,
  movement: "idle" as MovementState,
  speed: 0,
  /** 0 standing … 1 seated, eased. */
  sitBlend: 0,
  /** Camera yaw to ease toward (e.g. after sitting down); cleared by mouse movement. */
  autoYaw: null as number | null,
  /** Camera pitch to ease toward (looking down at the desk after sitting); cleared by mouse movement. */
  autoPitch: null as number | null,
  /** Seconds since the player last sat down (guards against instant stand-up). */
  sinceSeated: 0,
};

export function resetRuntime(spawn: SpawnPoint) {
  runtime.x = spawn.x;
  runtime.y = spawn.y;
  runtime.z = spawn.z;
  runtime.vx = 0;
  runtime.vz = 0;
  runtime.facing = spawn.rotationY;
  // Camera looks the same way the avatar faces: forward = (-sin yaw, -cos yaw).
  runtime.yaw = spawn.rotationY + Math.PI;
  runtime.pitch = -0.18;
  runtime.movement = "idle";
  runtime.speed = 0;
  runtime.sitBlend = 0;
  runtime.autoYaw = null;
  runtime.autoPitch = null;
  runtime.sinceSeated = 0;
}
