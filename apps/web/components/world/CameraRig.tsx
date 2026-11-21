"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { MathUtils, type PerspectiveCamera, Vector3 } from "three";
import { CAMERA, PLAYER, isCameraBlocked, wrapAngle } from "@ovr/shared";
import { getSeat, isBoardOpen } from "@/lib/game/actions";
import { registerCanvas } from "@/lib/game/pointer";
import { runtime } from "@/lib/game/runtime";
import { useGameStore } from "@/lib/game/store";
import { isLessonOverlayOpen } from "@/lib/learning-studio/boardLessons";

const forward = new Vector3();
const right = new Vector3();
const pivot = new Vector3();
const probe = new Vector3();
const target = new Vector3();
const orbitPos = new Vector3();
const orbitTarget = new Vector3();
const avatarPos = new Vector3();

const CAMERA_RADIUS = 0.22;
const SHOULDER_OFFSET = 0.3;
const SEATED_DISTANCE = 1.9;
const INTRO_SECONDS = 2.2;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Clear distance from the avatar along a direction, up to `max`. */
function freeRadius(angle: number, max: number) {
  let r = 1.4;
  for (; r < max; r += 0.1) {
    probe.set(runtime.x + Math.sin(angle) * r, runtime.y + 1.5, runtime.z + Math.cos(angle) * r);
    if (isCameraBlocked(probe, CAMERA_RADIUS + 0.15)) return r - 0.2;
  }
  return max;
}

const shotCache = { x: NaN, z: NaN, facing: NaN, angle: 0, radius: 3 };
/**
 * The title-screen shot: a slow sway in front of your character, from whichever three-quarter
 * angle has the most open floor, framed so they stand in the right third beside the menu.
 */
function titleShot(time: number, out: { pos: Vector3; target: Vector3 }) {
  if (
    shotCache.x !== runtime.x ||
    shotCache.z !== runtime.z ||
    shotCache.facing !== runtime.facing
  ) {
    let best = { angle: runtime.facing + 0.5, radius: 0 };
    for (const off of [0.5, 0.75, 0.3, 1.0, -0.5, -0.75]) {
      const radius = Math.min(
        freeRadius(runtime.facing + off - 0.2, 5),
        freeRadius(runtime.facing + off + 0.2, 5),
      );
      if (radius > best.radius + 0.3) best = { angle: runtime.facing + off, radius };
    }
    Object.assign(shotCache, { x: runtime.x, z: runtime.z, facing: runtime.facing, ...best });
  }
  const angle = shotCache.angle + Math.sin(time * 0.09) * 0.16;
  const radius = Math.min(4.3, shotCache.radius);
  avatarPos.set(runtime.x, runtime.y, runtime.z);
  out.pos.set(
    avatarPos.x + Math.sin(angle) * radius,
    runtime.y + 1.3 + Math.sin(time * 0.13) * 0.04,
    avatarPos.z + Math.cos(angle) * radius,
  );
  // Look a little to the avatar's side so they sit right of centre.
  const dx = avatarPos.x - out.pos.x;
  const dz = avatarPos.z - out.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  const side = 0.3 * radius;
  out.target.set(
    avatarPos.x + (dz / len) * side,
    runtime.y + 1.18,
    avatarPos.z - (dx / len) * side,
  );
}

/**
 * Mouse-look plus a third-person follow camera that zooms smoothly into first person.
 * Collision is checked against the shared layout so the camera never ends up inside a shelf.
 * Before you enter, it frames your character for the title screen and swoops in on Enter.
 */
export function CameraRig() {
  const gl = useThree((s) => s.gl);
  const local = useRef({ distance: CAMERA.defaultDistance as number, bob: 0, intro: 0, time: 0 });

  useEffect(() => {
    const el = gl.domElement;
    registerCanvas(el, () => useGameStore.getState().setPointerLockFailed(true));
    let dragging = false;
    // Drag-to-look works everywhere; pointer lock is the nicer default where browsers allow it.
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.button !== 0 || !target) return;
      if (target === el || target.closest("[data-look-surface]")) dragging = true;
    };
    const onUp = () => {
      dragging = false;
    };
    const onMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== el && !dragging) return;
      const { settings, cameraMode, menuOpen, guideOpen, progressOpen, librarianOpen, phase } =
        useGameStore.getState();
      if (
        phase !== "playing" ||
        menuOpen ||
        guideOpen ||
        progressOpen ||
        librarianOpen ||
        isBoardOpen() ||
        isLessonOverlayOpen()
      )
        return;
      const sens = settings.mouseSensitivity / 1000;
      runtime.yaw = wrapAngle(runtime.yaw - e.movementX * sens);
      runtime.pitch -= e.movementY * sens * (settings.invertY ? -1 : 1);
      const fp = cameraMode === "first-person";
      runtime.pitch = MathUtils.clamp(
        runtime.pitch,
        fp ? CAMERA.firstPersonMinPitch : CAMERA.minPitch,
        fp ? CAMERA.firstPersonMaxPitch : CAMERA.maxPitch,
      );
      runtime.autoYaw = null;
      runtime.autoPitch = null;
    };
    const onWheel = (e: WheelEvent) => {
      const s = useGameStore.getState();
      if (
        s.phase !== "playing" ||
        s.cameraMode !== "third-person" ||
        s.menuOpen ||
        s.guideOpen ||
        s.progressOpen ||
        s.librarianOpen ||
        isBoardOpen() ||
        isLessonOverlayOpen()
      )
        return;
      runtime.distance = MathUtils.clamp(
        runtime.distance + e.deltaY * 0.0025,
        CAMERA.minDistance,
        CAMERA.maxDistance,
      );
    };
    const onLockChange = () => {
      const locked = document.pointerLockElement === el;
      const store = useGameStore.getState();
      store.setPointerLocked(locked);
      // Esc releases the pointer: treat that as "pause" (but not when Shift freed the cursor, or
      // when the lesson picker, a full-screen lesson, My Progress or the Librarian took the mouse).
      if (
        !locked &&
        !store.guideOpen &&
        !store.progressOpen &&
        !store.librarianOpen &&
        !store.cursorFree &&
        !isLessonOverlayOpen()
      )
        store.setMenuOpen(true);
      if (locked) store.setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("wheel", onWheel, { passive: true });
    document.addEventListener("pointerlockchange", onLockChange);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("wheel", onWheel);
      document.removeEventListener("pointerlockchange", onLockChange);
      registerCanvas(null);
    };
  }, [gl]);

  useFrame((state, rawDt) => {
    const camera = state.camera as PerspectiveCamera;
    const dt = Math.min(rawDt, 0.05);
    const s = local.current;
    const fp = useGameStore.getState().cameraMode === "first-person";
    runtime.viewBlend = MathUtils.damp(runtime.viewBlend, fp ? 0 : 1, 6, dt);

    // Ease toward an automatic yaw (after sitting) unless the user takes over.
    if (runtime.autoYaw !== null) {
      const diff = wrapAngle(runtime.autoYaw - runtime.yaw);
      runtime.yaw = wrapAngle(runtime.yaw + diff * (1 - Math.exp(-4 * dt)));
      if (Math.abs(diff) < 0.01) runtime.autoYaw = null;
    }
    if (runtime.autoPitch !== null) {
      runtime.pitch = MathUtils.damp(runtime.pitch, runtime.autoPitch, 4, dt);
      if (Math.abs(runtime.autoPitch - runtime.pitch) < 0.005) runtime.autoPitch = null;
    }
    // Leaving first person while looking steeply up: settle into the third-person range.
    if (!fp)
      runtime.pitch = MathUtils.damp(
        runtime.pitch,
        MathUtils.clamp(runtime.pitch, CAMERA.minPitch, CAMERA.maxPitch),
        8,
        dt,
      );

    const view = runtime.viewBlend;
    const moving = runtime.speed > 0.2 && runtime.sitBlend < 0.1;
    s.bob += moving ? dt * runtime.speed * 4.2 : 0;
    const bob = moving ? Math.sin(s.bob) * 0.022 * (1 - view) : 0;
    const eyeY = MathUtils.lerp(PLAYER.eyeHeight, PLAYER.seatedEyeHeight, runtime.sitBlend) + bob;
    const orbitY = MathUtils.lerp(1.5, 1.12, runtime.sitBlend);

    forward.set(
      -Math.sin(runtime.yaw) * Math.cos(runtime.pitch),
      Math.sin(runtime.pitch),
      -Math.cos(runtime.yaw) * Math.cos(runtime.pitch),
    );
    right.set(Math.cos(runtime.yaw), 0, -Math.sin(runtime.yaw));
    pivot.set(runtime.x, runtime.y + MathUtils.lerp(eyeY, orbitY, view), runtime.z);
    // In first person, sit just in front of the face so the near plane never clips the head.
    pivot.addScaledVector(forward, 0.08 * (1 - view));
    // Over-the-shoulder offset, pulled in if a shelf is right beside us.
    // Seated, your own chair's back mustn't push the camera into your head (it hid the desk).
    const chair = getSeat(useGameStore.getState().seatId)?.furnitureId;
    probe.copy(pivot).addScaledVector(right, SHOULDER_OFFSET * view);
    if (!isCameraBlocked(probe, CAMERA_RADIUS, chair)) pivot.copy(probe);

    // Seated, the camera comes in over your shoulder so your desk (and its timer) fills the view.
    const distance = MathUtils.lerp(
      runtime.distance,
      Math.min(runtime.distance, SEATED_DISTANCE),
      runtime.sitBlend,
    );
    const want = distance * view;
    let allowed = want;
    for (let d = 0.1; d <= want; d += 0.08) {
      probe.copy(pivot).addScaledVector(forward, -d);
      if (isCameraBlocked(probe, CAMERA_RADIUS, chair)) {
        allowed = Math.max(0, d - 0.12);
        break;
      }
    }
    // Snap in when something blocks the view, ease back out when it clears.
    s.distance = allowed < s.distance ? allowed : MathUtils.damp(s.distance, allowed, 3.5, dt);
    camera.position.copy(pivot).addScaledVector(forward, -s.distance);
    target.copy(camera.position).add(forward);

    // Title screen / studio: orbit shot. Entering: swoop from the orbit into the follow camera.
    const store = useGameStore.getState();
    s.time += dt;
    if (store.phase === "title" || store.phase === "creator") s.intro = 0;
    else if (store.phase === "entering") {
      s.intro = Math.min(1, s.intro + dt / INTRO_SECONDS);
      if (s.intro >= 1) {
        store.setPhase("playing");
        if (!store.guideSeen) store.setGuideOpen(true);
      }
    } else s.intro = 1;
    let fov = MathUtils.lerp(72, 60, view);
    if (s.intro < 1) {
      titleShot(s.time, { pos: orbitPos, target: orbitTarget });
      const e = easeInOut(s.intro);
      // Arc up and over on the way in rather than cutting straight through the avatar.
      camera.position.lerpVectors(orbitPos, camera.position, e);
      camera.position.y += Math.sin(e * Math.PI) * 0.9;
      target.lerpVectors(orbitTarget, target, e);
      fov = MathUtils.lerp(48, fov, e);
    }
    camera.lookAt(target);

    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  }, -1);

  return null;
}
