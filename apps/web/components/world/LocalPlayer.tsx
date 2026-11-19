"use client";

import { useFrame } from "@react-three/fiber";
import { Suspense, useCallback, useRef } from "react";
import { type Group, MathUtils, type Object3D } from "three";
import {
  type AvatarConfig,
  PLAYER,
  SEATS,
  distance2D,
  moveWithCollisions,
  wrapAngle,
  zoneAt,
} from "@ovr/shared";
import { Avatar, type AvatarMotion } from "@/components/avatar/Avatar";
import { useKeyboardMovement } from "@/hooks/useKeyboardMovement";
import {
  WHITEBOARDS,
  getSeat,
  holdFreeCursor,
  interact,
  isBoardOpen,
  openTableBoard,
  standUp,
} from "@/lib/game/actions";
import { runtime } from "@/lib/game/runtime";
import { useGameStore } from "@/lib/game/store";
import { faceState, useTrackingStore } from "@/lib/facial-tracking/tracker";
import { FacePreview } from "./FacePreview";

const ACCELERATION = 12;

function dampAngle(current: number, target: number, lambda: number, dt: number) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

/** The player's own avatar: reads input, moves with collisions, and keeps the HUD informed. */
export function LocalPlayer({ config }: { config: AvatarConfig }) {
  const group = useRef<Group>(null);
  const head = useRef<Object3D>(null);
  const trackingOn = useTrackingStore((s) => s.status !== "off" && s.status !== "error");
  const showFaceView = useTrackingStore((s) => s.showFaceView);
  const quality = useGameStore((s) => s.settings.quality);
  const toggleCamera = useGameStore((s) => s.toggleCameraMode);
  // Game keys do nothing while a menu, the guide or a whiteboard is open.
  const playing = () => {
    const s = useGameStore.getState();
    return s.phase === "playing" && !s.menuOpen && !s.guideOpen && !isBoardOpen();
  };
  const keys = useKeyboardMovement({
    onInteract: () => playing() && interact(),
    onToggleCamera: () => playing() && toggleCamera(),
    onToggleWalkFast: () => playing() && useGameStore.getState().toggleWalkFast(),
    onOpenBoard: () => playing() && openTableBoard(),
    onFreeCursor: (held) => (isBoardOpen() ? undefined : holdFreeCursor(held)),
  });
  const seatHeight = useRef(0.46);
  const motion = useCallback(
    (): AvatarMotion => ({
      speed: runtime.speed,
      sitBlend: runtime.sitBlend,
      seatHeight: seatHeight.current,
      face: faceState.params,
    }),
    [],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const store = useGameStore.getState();
    const paused = store.phase !== "playing" || store.menuOpen || store.guideOpen || isBoardOpen();
    const k = keys.current;
    const fwd = paused ? 0 : Number(k.forward) - Number(k.back);
    const strafe = paused ? 0 : Number(k.right) - Number(k.left);
    runtime.sinceSeated += dt;

    // Pressing a movement key while seated stands you up (after a short grace period).
    if (store.seatId && (fwd || strafe) && runtime.sinceSeated > 0.45) standUp();
    const seat = getSeat(useGameStore.getState().seatId);

    if (seat) {
      seatHeight.current = seat.seatHeight;
      runtime.x = MathUtils.damp(runtime.x, seat.x, 10, dt);
      runtime.z = MathUtils.damp(runtime.z, seat.z, 10, dt);
      runtime.facing = dampAngle(runtime.facing, seat.rotationY, 10, dt);
      runtime.vx = runtime.vz = 0;
      runtime.speed = 0;
      runtime.movement = "sit";
      runtime.sitBlend = MathUtils.damp(runtime.sitBlend, 1, 7, dt);
    } else {
      // Camera-relative movement: forward is where the camera looks.
      const sinY = Math.sin(runtime.yaw);
      const cosY = Math.cos(runtime.yaw);
      let dx = -sinY * fwd + cosY * strafe;
      let dz = -cosY * fwd - sinY * strafe;
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        dx /= len;
        dz /= len;
      }
      const speed = store.walkFast ? PLAYER.runSpeed : PLAYER.walkSpeed;
      runtime.vx = MathUtils.damp(runtime.vx, dx * speed, ACCELERATION, dt);
      runtime.vz = MathUtils.damp(runtime.vz, dz * speed, ACCELERATION, dt);
      const next = moveWithCollisions(
        { x: runtime.x, z: runtime.z },
        { x: runtime.vx * dt, z: runtime.vz * dt },
        PLAYER.radius,
      );
      // Measure real displacement so walking into a wall doesn't animate as running.
      const moved = Math.hypot(next.x - runtime.x, next.z - runtime.z) / Math.max(dt, 1e-4);
      runtime.x = next.x;
      runtime.z = next.z;
      runtime.speed = MathUtils.damp(runtime.speed, len > 0 ? Math.min(moved, speed) : 0, 14, dt);
      runtime.movement =
        runtime.speed < 0.15 ? "idle" : runtime.speed > PLAYER.walkSpeed + 0.4 ? "run" : "walk";
      runtime.sitBlend = MathUtils.damp(runtime.sitBlend, 0, 9, dt);

      const firstPerson = runtime.viewBlend < 0.5;
      if (firstPerson) runtime.facing = dampAngle(runtime.facing, runtime.yaw + Math.PI, 16, dt);
      else if (len > 0) runtime.facing = dampAngle(runtime.facing, Math.atan2(dx, dz), 11, dt);
    }

    if (group.current) {
      group.current.position.set(runtime.x, 0, runtime.z);
      group.current.rotation.y = runtime.facing;
      // Hide the body once the camera is (nearly) inside the head.
      // (Always shown on the title screen and during the swoop in.)
      group.current.visible = runtime.viewBlend > 0.3 || store.phase !== "playing";
    }

    // Derived state for the HUD, pushed only on change.
    const zone = zoneAt(runtime)?.id ?? null;
    if (zone !== store.zoneId) store.setZone(zone);
    let nearby: string | null = null;
    let nearbyBoard: string | null = null;
    if (!store.seatId) {
      let best: number = PLAYER.interactRange;
      for (const s of SEATS) {
        const d = distance2D(s, runtime);
        if (d < best) {
          best = d;
          nearby = s.id;
        }
      }
      // A whiteboard wins if you're closer to it than to any chair.
      for (const b of WHITEBOARDS) {
        const d = distance2D(b, runtime) - 0.35;
        if (d < best) {
          best = d;
          nearbyBoard = b.boardId;
          nearby = null;
        }
      }
    }
    if (nearby !== store.nearbySeatId) store.setNearbySeat(nearby);
    if (nearbyBoard !== store.nearbyBoardId) store.setNearbyBoard(nearbyBoard);
  }, -2);

  return (
    <>
      <group ref={group}>
        <Suspense fallback={null}>
          <Avatar config={config} motion={motion} headRef={head} />
        </Suspense>
      </group>
      {trackingOn && showFaceView && (
        <FacePreview head={head} body={group} renderMain={quality === "low"} />
      )}
    </>
  );
}
