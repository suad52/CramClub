"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { MathUtils, Matrix4, type PerspectiveCamera, Quaternion, Vector3 } from "three";
import { CAMERA, LIBRARIAN, PLAYER, isCameraBlocked, wrapAngle } from "@ovr/shared";
import { chatHasFocus } from "@/lib/chat/keys";
import { getSeat, isBoardOpen } from "@/lib/game/actions";
import { registerCanvas } from "@/lib/game/pointer";
import { runtime } from "@/lib/game/runtime";
import { useGameStore } from "@/lib/game/store";
import { faceState, useTrackingStore } from "@/lib/facial-tracking/tracker";
import { isLessonOverlayOpen } from "@/lib/learning-studio/boardLessons";
import { librarianPresence, prefersReducedMotion } from "@/lib/librarian/presence";

const forward = new Vector3();
const right = new Vector3();
const pivot = new Vector3();
const probe = new Vector3();
const target = new Vector3();
const orbitPos = new Vector3();
const orbitTarget = new Vector3();
const avatarPos = new Vector3();

const CAMERA_RADIUS = 0.22;
/** How far the view turns (radians) when your tracked head is turned as far as it's tracked. */
const HEAD_LOOK = { yaw: 1.1, pitch: 0.55 } as const;
/** Small head movements (and tracking jitter) don't move the view. */
/** After the mouse turns the view, head look stays off this long (ms) after the last movement. */
const MOUSE_PRIORITY_MS = 900;
let mouseLookAt = -Infinity;

const deadZone = (v: number, zone = 0.08) =>
  Math.abs(v) < zone ? 0 : (v - Math.sign(v) * zone) / (1 - zone);
const SHOULDER_OFFSET = 0.3;
const SEATED_DISTANCE = 1.9;
const INTRO_SECONDS = 2.2;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/**
 * The conversation close-up while you talk to the librarian (her panel open): the camera sits
 * across the desk from her at about her eye level and frames her head and shoulders in the top
 * half of the screen, above the dialogue box that covers the bottom ~40%.
 */
const DIALOGUE = {
  /** How far in front of her eyes the camera sits (m), and how much higher than them. */
  distance: 2.1,
  rise: 0.05,
  fov: 36,
  /** Where her eyes sit on screen, in NDC (0 the middle, 1 the top edge): 30% of the way down. */
  eyeY: 0.4,
  /** The glide over to her, and back (s). */
  seconds: 0.6,
  /** Furthest you can be from her (m) for the camera to glide over; from further away it cuts. */
  glideRange: 9,
  /** The most the shot swings toward your side of the desk (radians around her). */
  swing: 0.16,
  /** How high a long glide arcs (m), over your head rather than through it. */
  arc: 0.35,
} as const;

/** Her eyes, eased: what the close-up frames. */
const herEye = new Vector3();
const shotPos = new Vector3();
const shotTarget = new Vector3();
const shotQ = new Quaternion();
const viewQ = new Quaternion();
const lookMatrix = new Matrix4();
/** The close-up's downward tilt (radians), set by dialogueShot. */
let shotPitch = 0;

/** The close-up: across the desk from her eyes, aimed a little below them so her face sits high. */
function dialogueShot(swing: number) {
  shotPos.set(
    herEye.x + Math.sin(swing) * DIALOGUE.distance,
    herEye.y + DIALOGUE.rise,
    herEye.z + Math.cos(swing) * DIALOGUE.distance,
  );
  const dx = herEye.x - shotPos.x;
  const dz = herEye.z - shotPos.z;
  const flat = Math.hypot(dx, dz) || 1;
  const below = Math.atan(DIALOGUE.eyeY * Math.tan(MathUtils.degToRad(DIALOGUE.fov / 2)));
  shotPitch = Math.atan2(herEye.y - shotPos.y, flat) - below;
  shotTarget.set(
    shotPos.x + (dx / flat) * Math.cos(shotPitch),
    shotPos.y + Math.sin(shotPitch),
    shotPos.z + (dz / flat) * Math.cos(shotPitch),
  );
}

/**
 * The close-up's near plane: just short of where the front of her counter first comes into the
 * frame (its top corners), so nobody standing at the counter (you included, in third person)
 * can block her face, and nothing of the desk is cut away.
 */
function dialogueNear(swing: number, aspect: number) {
  const tan = Math.tan(MathUtils.degToRad(DIALOGUE.fov / 2));
  // For the ray through a frame corner, how far it goes toward the desk per metre of depth.
  const toward =
    Math.cos(shotPitch) * Math.cos(swing) +
    Math.sin(-shotPitch) * Math.cos(swing) * tan +
    Math.abs(Math.sin(swing)) * tan * aspect;
  return (shotPos.z - LIBRARIAN.frontZ) / toward - 0.03;
}

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
  const local = useRef({
    distance: CAMERA.defaultDistance as number,
    bob: 0,
    intro: 0,
    time: 0,
    lookYaw: 0,
    /** Head look is paused because the mouse took over (until the head comes back to centre). */
    headPaused: false,
    /** Where the head was when head look resumed after the mouse: that pose counts as "facing
     *  the screen" (so nothing jumps), and it eases back to the real centre over a few seconds. */
    headBaseYaw: 0,
    headBasePitch: 0,
    lookPitch: 0,
    /** The conversation close-up: 0 your own view … 1 the close-up, and how it's getting there. */
    talk: 0,
    talkOpen: false,
    cut: false,
    swing: 0,
    arc: 0,
    /** The camera's own near plane, put back after the close-up. */
    near: Number.NaN,
  });

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
      const {
        settings,
        cameraMode,
        menuOpen,
        guideOpen,
        progressOpen,
        studioOpen,
        librarianOpen,
        phase,
      } = useGameStore.getState();
      if (
        phase !== "playing" ||
        menuOpen ||
        guideOpen ||
        progressOpen ||
        studioOpen ||
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
      if (e.movementX || e.movementY) mouseLookAt = performance.now();
    };
    const onWheel = (e: WheelEvent) => {
      const s = useGameStore.getState();
      if (
        s.phase !== "playing" ||
        s.cameraMode !== "third-person" ||
        s.menuOpen ||
        s.guideOpen ||
        s.progressOpen ||
        s.studioOpen ||
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
      // when the lesson picker, a full-screen lesson, My Progress, the Librarian or the chat box
      // took the mouse).
      if (
        !locked &&
        !store.guideOpen &&
        !store.progressOpen &&
        !store.studioOpen &&
        !store.librarianOpen &&
        !store.cursorFree &&
        !isLessonOverlayOpen() &&
        !chatHasFocus()
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

    // Head look: with face tracking on, turning your real head turns the view (further than your
    // head turns, so your eyes stay on the screen), on top of the mouse. It's a glance: it never
    // changes which way you walk, and it eases back when you face the screen again.
    const game = useGameStore.getState();
    const tracking = useTrackingStore.getState();
    const face = faceState.params;
    const looking =
      !!face &&
      tracking.headLook &&
      game.phase === "playing" &&
      !game.menuOpen &&
      !game.guideOpen &&
      !game.progressOpen &&
      !game.studioOpen &&
      !game.librarianOpen &&
      !isBoardOpen() &&
      !isLessonOverlayOpen();
    // The tracker flips the turn when mirroring the avatar; the view always follows your real head.
    const headYaw = looking ? (tracking.mirror ? -face.headYaw : face.headYaw) : 0;
    const headPitch = looking ? face.headPitch : 0;
    // The mouse wins: the moment it turns the view, the head's current glance is folded into the
    // view (so nothing jumps) and head look pauses. It resumes as soon as the mouse has been still
    // for a moment, wherever the head is: that pose becomes the new centre, which then eases back
    // to the real centre, so the two never fight and head look never stays switched off.
    const mouseActive = performance.now() - mouseLookAt < MOUSE_PRIORITY_MS;
    if (mouseActive && !s.headPaused) {
      runtime.yaw = wrapAngle(runtime.yaw + s.lookYaw);
      runtime.pitch = MathUtils.clamp(
        runtime.pitch + s.lookPitch,
        fp ? CAMERA.firstPersonMinPitch : CAMERA.minPitch,
        fp ? CAMERA.firstPersonMaxPitch : CAMERA.maxPitch,
      );
      s.lookYaw = 0;
      s.lookPitch = 0;
      s.headPaused = true;
    } else if (s.headPaused && !mouseActive) {
      s.headPaused = false;
      s.headBaseYaw = headYaw;
      s.headBasePitch = headPitch;
    }
    const head = !s.headPaused;
    if (head) {
      s.headBaseYaw = MathUtils.damp(s.headBaseYaw, 0, 0.6, dt);
      s.headBasePitch = MathUtils.damp(s.headBasePitch, 0, 0.6, dt);
    }
    s.lookYaw = MathUtils.damp(
      s.lookYaw,
      head ? deadZone(headYaw - s.headBaseYaw) * HEAD_LOOK.yaw : 0,
      10,
      dt,
    );
    s.lookPitch = MathUtils.damp(
      s.lookPitch,
      head ? deadZone(headPitch - s.headBasePitch) * HEAD_LOOK.pitch : 0,
      10,
      dt,
    );
    const yaw = runtime.yaw + s.lookYaw;
    const pitch = MathUtils.clamp(
      runtime.pitch + s.lookPitch,
      fp ? CAMERA.firstPersonMinPitch : CAMERA.minPitch,
      fp ? CAMERA.firstPersonMaxPitch : CAMERA.maxPitch,
    );
    forward.set(
      -Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      -Math.cos(yaw) * Math.cos(pitch),
    );
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
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

    // Title screen / studio / the camera and microphone check before going in: orbit shot.
    // Entering: swoop from the orbit into the follow camera.
    const store = useGameStore.getState();
    s.time += dt;
    if (store.phase === "title" || store.phase === "creator" || store.phase === "setup")
      s.intro = 0;
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

    // Talking to the librarian: glide over to the close-up, and back to your own view after. Your
    // yaw and pitch aren't touched, so the view you come back to is the one you left.
    if (Number.isNaN(s.near)) s.near = Math.min(camera.near, 0.1);
    let near = s.near;
    const talking = store.librarianOpen && store.phase === "playing";
    if (talking !== s.talkOpen) {
      s.talkOpen = talking;
      if (s.talk === 0) {
        const eye = librarianPresence.eye;
        herEye.set(eye.x, eye.y, eye.z);
      }
      // From across the hall (her panel opened from the HUD) it cuts rather than flying over.
      const her = LIBRARIAN.librarian;
      const nearHer =
        Math.abs(runtime.y) < 1.2 &&
        runtime.z > LIBRARIAN.frontZ &&
        Math.hypot(runtime.x - her.x, runtime.z - her.z) < DIALOGUE.glideRange;
      s.cut = !nearHer || prefersReducedMotion();
      if (talking) {
        // Swing a little toward your side of the desk, unless something's in the way there.
        s.swing = MathUtils.clamp(
          Math.atan2(runtime.x - her.x, Math.max(0.5, runtime.z - her.z)) * 0.3,
          -DIALOGUE.swing,
          DIALOGUE.swing,
        );
        dialogueShot(s.swing);
        if (isCameraBlocked(shotPos, CAMERA_RADIUS)) s.swing = 0;
      }
      dialogueShot(s.swing);
      s.arc = Math.min(DIALOGUE.arc, 0.08 * camera.position.distanceTo(shotPos));
    }
    s.talk = s.cut
      ? Number(talking)
      : MathUtils.clamp(s.talk + (talking ? dt : -dt) / DIALOGUE.seconds, 0, 1);
    if (s.talk > 0) {
      // Her eyes, eased: the camera holds steady while she nods and sways.
      const eye = librarianPresence.eye;
      herEye.set(
        MathUtils.damp(herEye.x, eye.x, 1, dt),
        MathUtils.damp(herEye.y, eye.y, 1, dt),
        MathUtils.damp(herEye.z, eye.z, 1, dt),
      );
      dialogueShot(s.swing);
      lookMatrix.lookAt(shotPos, shotTarget, camera.up);
      shotQ.setFromRotationMatrix(lookMatrix);
      viewQ.copy(camera.quaternion);
      const e = easeInOut(s.talk);
      camera.position.lerp(shotPos, e);
      camera.position.y += Math.sin(e * Math.PI) * s.arc;
      camera.quaternion.slerpQuaternions(viewQ, shotQ, e);
      fov = MathUtils.lerp(fov, DIALOGUE.fov, e);
      // The near plane moves out late in the glide, once the camera is passing you.
      near = MathUtils.lerp(
        s.near,
        Math.max(s.near, dialogueNear(s.swing, camera.aspect)),
        MathUtils.smoothstep(e, 0.35, 0.85),
      );
    }

    if (Math.abs(camera.fov - fov) > 0.01 || Math.abs(camera.near - near) > 0.0005) {
      camera.fov = fov;
      camera.near = near;
      camera.updateProjectionMatrix();
    }
  }, -1);

  return null;
}
