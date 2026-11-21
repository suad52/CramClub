"use client";

import { useFrame } from "@react-three/fiber";
import { Suspense, useCallback, useRef } from "react";
import { type Group, MathUtils, type Object3D } from "three";
import {
  type AvatarConfig,
  LIBRARIAN,
  PLAYER,
  SEATS,
  distance2D,
  movePlayer,
  wrapAngle,
  zoneAt,
} from "@ovr/shared";
import { Avatar, type AvatarMotion, usePlayerFaceHead } from "@/components/avatar/Avatar";
import { startPomodoro } from "@/components/library/Pomodoro";
import { useKeyboardMovement } from "@/hooks/useKeyboardMovement";
import {
  LIFTS,
  WHITEBOARDS,
  declineNearbyLesson,
  getSeat,
  holdFreeCursor,
  interact,
  isBoardOpen,
  isSeatLocked,
  isTimerPanelOpen,
  joinNearbyLesson,
  nudgeSeatLocked,
  openLessonPicker,
  openTableBoard,
  standUp,
  toggleLessonFullscreen,
} from "@/lib/game/actions";
import { runtime } from "@/lib/game/runtime";
import {
  JOIN_RANGE,
  isLessonOverlayOpen,
  useBoardLessons,
} from "@/lib/learning-studio/boardLessons";
import { useGameStore } from "@/lib/game/store";
import { isSeatTakenByOther } from "@/lib/net/players";
import { faceState, useTrackingStore } from "@/lib/facial-tracking/tracker";
import { FacePreview } from "./FacePreview";

const ACCELERATION = 12;
/** Seats, boards and lifts more than this far above or below your feet are on another floor. */
const SAME_FLOOR = 1.2;
/** How far out from the librarian's counter you can stand and still ask her something (m). */
const DESK_REACH = 2.6;

function dampAngle(current: number, target: number, lambda: number, dt: number) {
  return current + wrapAngle(target - current) * (1 - Math.exp(-lambda * dt));
}

/** The player's own avatar: reads input, moves with collisions, and keeps the HUD informed. */
export function LocalPlayer({ config }: { config: AvatarConfig }) {
  const group = useRef<Group>(null);
  const head = useRef<Object3D>(null);
  // Chibi head or the player's real face (Character Studio → Head).
  const faceHead = usePlayerFaceHead();
  const trackingOn = useTrackingStore((s) => s.status !== "off" && s.status !== "error");
  const showFaceView = useTrackingStore((s) => s.showFaceView);
  // Only in the library itself: the "Before you go in" step and the menu's Camera and microphone
  // panels have their own live preview.
  const inLibrary = useGameStore((s) => s.phase === "playing" && !s.devicesOpen);
  const quality = useGameStore((s) => s.settings.quality);
  const toggleCamera = useGameStore((s) => s.toggleCameraMode);
  // Game keys do nothing while a menu, the guide, My Progress, the Librarian, a whiteboard, the
  // table timer's settings or dialog, or a lesson overlay is open.
  const covered = () => {
    const s = useGameStore.getState();
    return (
      s.phase !== "playing" ||
      s.menuOpen ||
      s.guideOpen ||
      s.progressOpen ||
      s.studioOpen ||
      s.librarianOpen ||
      isBoardOpen() ||
      isTimerPanelOpen()
    );
  };
  const playing = () => !covered() && !isLessonOverlayOpen();
  const keys = useKeyboardMovement({
    onInteract: () => playing() && interact(),
    onToggleCamera: () => playing() && toggleCamera(),
    onToggleWalkFast: () => playing() && useGameStore.getState().toggleWalkFast(),
    onOpenBoard: () => playing() && openTableBoard(),
    onLessons: () => playing() && openLessonPicker(),
    onJoinLesson: () => playing() && joinNearbyLesson(),
    onDeclineLesson: () => playing() && declineNearbyLesson(),
    onStartPomodoro: () => playing() && startPomodoro(),
    // F also works inside the full-screen lesson, where it goes back to the library.
    onLessonFullscreen: () =>
      !covered() && useBoardLessons.getState().pickerBoardId === null && toggleLessonFullscreen(),
    // Pressing Shift over a panel does nothing; letting go still clears the "mouse free" state.
    onFreeCursor: (held) =>
      held && (isBoardOpen() || isLessonOverlayOpen()) ? undefined : holdFreeCursor(held),
  });
  const seatHeight = useRef(0.46);
  /** This press of a movement key already explained why you can't get up (mid-pomodoro). */
  const nudged = useRef(false);
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
    const paused =
      store.phase !== "playing" ||
      store.menuOpen ||
      store.guideOpen ||
      store.progressOpen ||
      store.studioOpen ||
      store.librarianOpen ||
      isBoardOpen() ||
      isLessonOverlayOpen() ||
      isTimerPanelOpen();
    const k = keys.current;
    const fwd = paused ? 0 : Number(k.forward) - Number(k.back);
    const strafe = paused ? 0 : Number(k.right) - Number(k.left);
    runtime.sinceSeated += dt;

    // Pressing a movement key while seated stands you up (after a short grace period). Mid-pomodoro
    // it can't: the table timer says why, once per press rather than every frame it's held.
    const moving = fwd !== 0 || strafe !== 0;
    if (store.seatId && moving && runtime.sinceSeated > 0.45) {
      if (!isSeatLocked()) standUp();
      else if (!nudged.current) nudgeSeatLocked();
      nudged.current = true;
    } else if (!moving) nudged.current = false;
    const seat = getSeat(useGameStore.getState().seatId);

    if (seat) {
      seatHeight.current = seat.seatHeight;
      runtime.x = MathUtils.damp(runtime.x, seat.x, 10, dt);
      runtime.y = seat.y;
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
      // Collides with walls and furniture, and follows the floor up and down the stairs.
      const next = movePlayer(
        { x: runtime.x, y: runtime.y, z: runtime.z },
        { x: runtime.vx * dt, z: runtime.vz * dt },
        PLAYER.radius,
      );
      // Measure real displacement so walking into a wall doesn't animate as running.
      const moved = Math.hypot(next.x - runtime.x, next.z - runtime.z) / Math.max(dt, 1e-4);
      runtime.x = next.x;
      runtime.y = next.y;
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
      group.current.position.set(runtime.x, runtime.y, runtime.z);
      group.current.rotation.y = runtime.facing;
      // Hide the body once the camera is (nearly) inside the head.
      // (Always shown on the title screen and during the swoop in.)
      group.current.visible = runtime.viewBlend > 0.3 || store.phase !== "playing";
    }

    // Derived state for the HUD, pushed only on change.
    const zone = zoneAt(runtime, runtime.y)?.id ?? null;
    if (zone !== store.zoneId) store.setZone(zone);
    let nearby: string | null = null;
    let nearbyBoard: string | null = null;
    let nearbyLift: string | null = null;
    let nearbyLibrarian = false;
    if (!store.seatId) {
      let best: number = PLAYER.interactRange;
      for (const s of SEATS) {
        // Someone else is sitting there: it's not on offer.
        if (Math.abs(s.y - runtime.y) > SAME_FLOOR || isSeatTakenByOther(s.id)) continue;
        const d = distance2D(s, runtime);
        if (d < best) {
          best = d;
          nearby = s.id;
        }
      }
      // A whiteboard wins if you're closer to it than to any chair.
      for (const b of WHITEBOARDS) {
        if (!b.wall || Math.abs(b.y - runtime.y) > SAME_FLOOR) continue;
        const d = distance2D(b, runtime) - 0.35;
        if (d < best) {
          best = d;
          nearbyBoard = b.boardId;
          nearby = null;
        }
      }
      // The lift call button wins over a nearby chair, like a whiteboard.
      for (const l of LIFTS) {
        if (Math.abs(l.y - runtime.y) > SAME_FLOOR) continue;
        const d = distance2D(l, runtime) - 0.2;
        if (d < best) {
          best = d;
          nearbyLift = l.id;
          nearby = null;
          nearbyBoard = null;
        }
      }
      // The librarian's desk: anywhere along the front of the counter, out to DESK_REACH, on the
      // ground floor. It wins unless a chair, board or lift is nearer than the counter is.
      const deskGap = runtime.z - LIBRARIAN.frontZ;
      const atDesk =
        Math.abs(runtime.y) < SAME_FLOOR &&
        deskGap > 0 &&
        deskGap < DESK_REACH &&
        Math.abs(runtime.x - LIBRARIAN.x) <= LIBRARIAN.width / 2;
      const nothingElse = !nearby && !nearbyBoard && !nearbyLift;
      if (atDesk && (nothingElse || deskGap - PLAYER.radius < best)) {
        nearbyLibrarian = true;
        nearby = null;
        nearbyBoard = null;
        nearbyLift = null;
      }
    }
    if (nearby !== store.nearbySeatId) store.setNearbySeat(nearby);
    if (nearbyLibrarian !== store.nearbyLibrarian) store.setNearbyLibrarian(nearbyLibrarian);
    if (nearbyBoard !== store.nearbyBoardId) store.setNearbyBoard(nearbyBoard);
    if (nearbyLift !== store.nearbyLiftId) store.setNearbyLift(nearbyLift);

    // The nearest board playing a lesson within joining range (seated too), for the join offer.
    const lessons = useBoardLessons.getState();
    let lessonBoard: string | null = null;
    let lessonBest: number = JOIN_RANGE;
    for (const b of WHITEBOARDS) {
      if (!lessons.boards[b.boardId] || Math.abs(b.y - runtime.y) > SAME_FLOOR) continue;
      const d = distance2D(b, runtime);
      if (d < lessonBest) {
        lessonBest = d;
        lessonBoard = b.boardId;
      }
    }
    lessons.setInRange(lessonBoard);
  }, -2);

  return (
    <>
      <group ref={group}>
        <Suspense fallback={null}>
          <Avatar config={config} motion={motion} headRef={head} faceHead={faceHead} />
        </Suspense>
      </group>
      {trackingOn && showFaceView && inLibrary && (
        <FacePreview head={head} body={group} renderMain={quality === "low"} />
      )}
    </>
  );
}
