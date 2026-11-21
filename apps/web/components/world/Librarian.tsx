"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Euler, type Group, MathUtils, type Object3D, Quaternion, Vector3 } from "three";
import {
  type AvatarConfig,
  DEFAULT_AVATAR,
  FACIAL_HEAD_LIMITS,
  type FacialParams,
  LIBRARIAN,
} from "@ovr/shared";
import { Avatar, type AvatarMotion } from "@/components/avatar/Avatar";
import { AVATAR_KIT_URL } from "@/lib/avatar/kitRig";
import { runtime } from "@/lib/game/runtime";
import { librarianPresence, prefersReducedMotion } from "@/lib/librarian/presence";

/*
 * The librarian: a chibi character (the avatar kit with a big head and a small body) standing
 * behind the circulation desk. She's never still: she breathes, shifts her weight, blinks (now
 * and then twice), glances down at her ledger and around the hall, turns to look at you when you
 * come near, and waves when you walk up to the desk. Her panel (lib/librarian/presence.ts) adds
 * the rest: while it's open she keeps eye contact with the camera (the conversation close-up),
 * waving hello as it opens; while a request is busy she writes in her ledger, looking up now and
 * then; and while she talks she nods, tilts her head, sways and now and then gestures with a hand,
 * following the loudness of her voice. When she shushes you mid-pomodoro (lib/focus/watch.ts sets
 * `shushUntil`), or answers you in the library chat (lib/chat/fenwick.ts sets it too), she turns
 * her head toward you, wherever you're sitting.
 */

const LOOK: AvatarConfig = {
  ...DEFAULT_AVATAR,
  height: -0.6,
  skin: "caramel",
  eyes: "round",
  eyeColor: "brown",
  brows: "soft",
  browColor: "silver",
  mouth: "smile",
  hair: "bun",
  hairColor: "silver",
  hairAccent: "moss",
  top: "cardigan",
  topColor: "moss",
  topAccent: "cream",
  bottom: "skirt",
  bottomColor: "charcoal",
  shoes: "loafers",
  shoesColor: "ink",
  accessories: ["glasses_round"],
  accessoryColor: "mustard",
  metal: "gold",
};

/** Chibi proportions: a smaller body with a big head. */
const BODY_SCALE = 0.9;
/** She stands on a low step behind the counter (librarians' desks often have one). */
const STEP = 0.12;
const HEAD_SCALE = 1.4;
/** Her eyes sit this far above the head bone, in the kit's metres (eyes 1.59 m, head bone 1.46 m). */
const EYES_ABOVE_HEAD_BONE = 0.13;
/** Her shoulders turn with her head by this much of its turn. */
const BODY_FOLLOW = 0.3;
/** She notices you within this distance (m), and greets you within the closer one. */
const NOTICE_RANGE = 6.5;
const GREET_RANGE = 3.4;
const GREET_SECONDS = 1.8;
const GREET_COOLDOWN = 25;
/** She waves hello as her panel opens unless she waved within this long (s). */
const WAVE_AGAIN_AFTER = 6;
/** A nod: a kick to the head's pitch (face units a second) on a springy return. */
const NOD_KICK = 1.7;
const NOD_SPRING = 55;
const NOD_DAMP = 11;

/** The arm bones a talking gesture moves (GLTF names: the loader strips the "." of "UpperArm.R"). */
const ARM_BONES = ["UpperArmR", "LowerArmR", "UpperArmL", "LowerArmL"] as const;
type ArmName = (typeof ARM_BONES)[number];

interface Gesture {
  side: "L" | "R";
  t: number;
  /** How long it lasts (s) and how big it is (0–1). */
  length: number;
  size: number;
}

interface Mind {
  t: number;
  blinkIn: number;
  blink: number;
  doubleBlink: boolean;
  /** Where she's looking when nobody's near: yaw/pitch in face units, and when to look elsewhere. */
  idleYaw: number;
  idlePitch: number;
  glanceIn: number;
  /** Her head's eased yaw/pitch/roll, before the talking motion is added. */
  yaw: number;
  pitch: number;
  roll: number;
  greet: number;
  greetCooldown: number;
  sinceWave: number;
  wasOpen: boolean;
  near: boolean;
  smile: number;
  brows: number;
  /** Her voice's loudness, eased fast and slow (a rise of the fast one over the slow is a stress). */
  voiceFast: number;
  voiceSlow: number;
  /** How animated she is (0 quiet … 1 in full flow), eased. */
  energy: number;
  nod: number;
  nodVel: number;
  nodIn: number;
  tilt: number;
  tiltTarget: number;
  /** A stressed word just now (1), fading: her brows lift with it. */
  stress: number;
  /** While she writes with her panel open: glancing up at you, and when next. */
  lookUp: number;
  lookUpIn: number;
  gesture: Gesture | null;
  gestureIn: number;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Her face, the motion the avatar reads each frame, and what's on her mind. */
function newState() {
  const face: FacialParams = {
    headYaw: 0,
    headPitch: 0,
    headRoll: 0,
    eyeBlinkLeft: 0,
    eyeBlinkRight: 0,
    jawOpen: 0,
    smile: 0.3,
    browRaise: 0,
  };
  const motion: AvatarMotion = { speed: 0, sitBlend: 0, seatHeight: 0, face, gesture: null };
  const mind: Mind = {
    t: 0,
    blinkIn: 1.2,
    blink: 0,
    doubleBlink: false,
    idleYaw: 0,
    idlePitch: -0.5,
    glanceIn: 2,
    yaw: 0,
    pitch: -0.5,
    roll: 0,
    greet: 0,
    greetCooldown: 0,
    sinceWave: 99,
    wasOpen: false,
    near: false,
    smile: 0.3,
    brows: 0,
    voiceFast: 0,
    voiceSlow: 0,
    energy: 0,
    nod: 0,
    nodVel: 0,
    nodIn: 0,
    tilt: 0,
    tiltTarget: 0,
    stress: 0,
    lookUp: 0,
    lookUpIn: 3,
    gesture: null,
    gestureIn: 2,
  };
  return { face, motion, mind };
}

/** Head yaw (face units) that turns her face toward a point `dx`/`dz` away, her shoulders helping. */
const aimYaw = (dx: number, dz: number) =>
  MathUtils.clamp(Math.atan2(dx, dz) / (FACIAL_HEAD_LIMITS.yaw * (1 + BODY_FOLLOW)), -1, 1);
const aimPitch = (dy: number, flat: number) =>
  MathUtils.clamp(Math.atan2(dy, flat) / FACIAL_HEAD_LIMITS.pitch, -1, 1);

interface ArmBone {
  bone: Object3D;
  /** The parent's rest orientation in model space, inverted and not: turns model axes into the bone's. */
  pre: Quaternion;
  preInverse: Quaternion;
  /** What this layer last left on the bone, to tell whether the avatar posed it again since. */
  wrote: Quaternion;
}

/** Orientation of `o` in the space of its ancestor `top` (inclusive). */
function modelQuaternion(o: Object3D, top: Object3D) {
  const q = new Quaternion();
  for (let n: Object3D | null = o; n; n = n.parent) {
    q.premultiply(n.quaternion);
    if (n === top) break;
  }
  return q;
}

/** Her arm bones, with their rest frames from the (never posed) kit. */
function findArms(head: Object3D, kit: Object3D) {
  let root: Object3D | null = head;
  while (root && root.name !== "Avatar") root = root.parent;
  if (!root) return null;
  const arms = {} as Record<ArmName, ArmBone>;
  for (const name of ARM_BONES) {
    const bone = root.getObjectByName(name);
    const rest = kit.getObjectByName(name);
    if (!bone || !rest?.parent) return null;
    const parent = modelQuaternion(rest.parent, kit);
    arms[name] = {
      bone,
      pre: parent.clone().invert(),
      preInverse: parent,
      wrote: new Quaternion(Number.NaN, 0, 0, 0),
    };
  }
  return arms;
}

const euler = new Euler();
const delta = new Quaternion();
const turn = new Quaternion();
/**
 * Adds a turn in model axes (as the avatar's own poses are written: negative X swings an arm
 * forward or bends the elbow) on top of the pose the avatar gave the bone this frame.
 */
function bend(arm: ArmBone, x: number, z: number) {
  // Not posed again since we last bent it (the avatar's frame didn't run): don't pile turns up.
  if (arm.bone.quaternion.equals(arm.wrote)) return;
  delta.setFromEuler(euler.set(x, 0, z));
  turn.copy(arm.pre).multiply(delta).multiply(arm.preInverse);
  arm.bone.quaternion.premultiply(turn);
  arm.wrote.copy(arm.bone.quaternion);
}

/**
 * Runs a callback each frame after the avatar has posed itself: rendered after the Avatar, its
 * frame callback is registered (and so called) after the avatar's.
 */
function AfterPose({ run }: { run: () => void }) {
  useFrame(run);
  return null;
}

const headPos = new Vector3();
const headScale = new Vector3();

export function Librarian() {
  const body = useRef<Group>(null);
  const head = useRef<Object3D | null>(null);
  const state = useRef(newState());
  const arms = useRef<Record<ArmName, ArmBone> | null>(null);
  const { scene: kit } = useGLTF(AVATAR_KIT_URL);
  // The avatar sets its head bone into the ref as it mounts (child effects run first).
  useEffect(() => {
    head.current?.scale.setScalar(HEAD_SCALE);
  }, []);

  useFrame((three, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const { mind: m, face: f, motion } = state.current;
    m.t += dt;
    const calm = prefersReducedMotion() ? 0.4 : 1;

    // Blinks every few seconds, now and then a quick double blink.
    m.blinkIn -= dt;
    if (m.blinkIn <= 0) {
      m.blink = 0.14;
      m.doubleBlink = Math.random() < 0.2;
      m.blinkIn = rand(2.2, 5.5);
    }
    if (m.blink > 0) {
      m.blink -= dt;
      if (m.blink <= 0 && m.doubleBlink) {
        m.doubleBlink = false;
        m.blink = 0.24;
      }
    }
    // A blink closes fast and opens a little slower; the second half of a double blink waits a beat.
    const closed = m.blink > 0.1 ? 0 : m.blink > 0 ? Math.sin((m.blink / 0.1) * Math.PI) : 0;
    f.eyeBlinkLeft = closed;
    f.eyeBlinkRight = closed;

    // Is someone there? (The local player; remote players can join this later.)
    const eye = librarianPresence.eye;
    const dx = runtime.x - LIBRARIAN.librarian.x;
    const dz = runtime.z - LIBRARIAN.librarian.z;
    const dist = Math.hypot(dx, dz);
    const inFront = dz > 0.2 && Math.abs(runtime.y) < 1;
    const near = inFront && dist < NOTICE_RANGE;
    const { open, working, speakUntil, speaking, shushUntil } = librarianPresence;
    const talking = performance.now() < speakUntil || speaking;
    // She's just shushed you (mid-pomodoro) or answered you in the chat: she turns to you
    // wherever you're sitting.
    const shushing = performance.now() < shushUntil;
    // With her panel open she keeps her eyes on you from anywhere in front of the desk.
    const watching = near || (open && dz > 0.2) || shushing;
    // Busy with a request: head down over the ledger (she looks up to say a reply).
    const writing = working && !talking;
    // Writing with her panel open, she looks up at you now and then.
    if (open && writing) {
      m.lookUpIn -= dt;
      if (m.lookUpIn <= 0) {
        m.lookUp = rand(1, 1.8);
        m.lookUpIn = rand(4.5, 8);
      }
    }
    m.lookUp = Math.max(0, m.lookUp - dt);
    const ledger = writing && m.lookUp === 0;

    // Idle glances: mostly down at the ledger, sometimes up and around the hall.
    m.glanceIn -= dt;
    if (m.glanceIn <= 0) {
      const down = Math.random() < 0.55;
      m.idleYaw = down ? rand(-0.25, 0.25) : rand(-0.9, 0.9);
      m.idlePitch = down ? rand(-0.75, -0.5) : rand(-0.1, 0.25);
      m.glanceIn = down ? rand(3, 6) : rand(1.5, 3.5);
    }

    let yaw = m.idleYaw;
    let pitch = m.idlePitch;
    const cam = three.camera.position;
    const engaged = !ledger && (open || watching);
    if (ledger) {
      // Eyes on the ledger, following the line she's writing, with a small nod as she writes.
      yaw = 0.14 * Math.sin(m.t * 0.7);
      pitch = -0.72 + 0.08 * Math.sin(m.t * 6.5);
    } else if (open && cam.z - eye.z > 0.2) {
      // In conversation: eye contact with the camera (it frames her face from across the desk).
      yaw = aimYaw(cam.x - eye.x, cam.z - eye.z);
      pitch = aimPitch(cam.y - eye.y, Math.hypot(cam.x - eye.x, cam.z - eye.z));
    } else if (watching) {
      // Look at the visitor's face (seated or standing).
      const face = runtime.y + MathUtils.lerp(1.6, 1.15, runtime.sitBlend);
      yaw = aimYaw(runtime.x - eye.x, runtime.z - eye.z);
      pitch = aimPitch(face - eye.y, dist);
    }
    // Slow, eased head turns, and a little tilt of curiosity when she's looking at you.
    m.yaw = MathUtils.damp(m.yaw, yaw, engaged ? 3.5 : 2.2, dt);
    // Quicker while writing, or the nod would be smoothed away.
    m.pitch = MathUtils.damp(m.pitch, pitch, ledger ? 9 : 2.5, dt);
    m.roll = MathUtils.damp(m.roll, engaged ? 0.18 * Math.sin(m.t * 0.6) : 0, 1.5, dt);

    // Talking: how animated she is follows her voice (or the mouthing, with no voice).
    const level = speaking
      ? librarianPresence.mouth
      : talking
        ? 0.45 + 0.25 * Math.sin(m.t * 7)
        : 0;
    m.voiceFast = MathUtils.damp(m.voiceFast, level, 14, dt);
    m.voiceSlow = MathUtils.damp(m.voiceSlow, level, 2.5, dt);
    m.energy = MathUtils.damp(m.energy, talking ? Math.min(1, 0.45 + m.voiceSlow) : 0, 3, dt);
    // A stressed word (her voice rising) gets a small nod and a lift of the brows, with a fresh
    // tilt of the head; mouthing with no voice, she nods now and then.
    m.nodIn -= dt;
    const stressed = speaking ? m.voiceFast - m.voiceSlow > 0.16 : Math.random() < dt * 1.2;
    if (talking && m.nodIn <= 0 && stressed) {
      m.nodVel -= NOD_KICK * rand(0.7, 1.1);
      m.tiltTarget = rand(-0.3, 0.3);
      m.stress = 1;
      m.nodIn = rand(0.55, 1.3);
    }
    m.nodVel += (-NOD_SPRING * m.nod - NOD_DAMP * m.nodVel) * dt;
    m.nod += m.nodVel * dt;
    m.tilt = MathUtils.damp(m.tilt, talking ? m.tiltTarget : 0, 2, dt);
    m.stress = Math.max(0, m.stress - dt * 2);
    const e = m.energy * calm;
    f.headYaw = m.yaw + e * 0.06 * Math.sin(m.t * 1.15 + 0.7);
    f.headPitch = m.pitch + calm * m.nod + e * 0.035 * Math.sin(m.t * 2.3);
    f.headRoll = m.roll + e * (0.1 * Math.sin(m.t * 0.75) + m.tilt);

    // A wave when you walk up to the desk (not every time you pass by), and as her panel opens.
    m.greetCooldown = Math.max(0, m.greetCooldown - dt);
    m.sinceWave += dt;
    const opened = open && !m.wasOpen;
    m.wasOpen = open;
    if (
      (inFront && dist < GREET_RANGE && m.greetCooldown === 0) ||
      (opened && m.sinceWave > WAVE_AGAIN_AFTER)
    ) {
      m.greet = GREET_SECONDS;
      m.greetCooldown = GREET_COOLDOWN;
      m.sinceWave = 0;
    }
    if (!near) m.greetCooldown = Math.min(m.greetCooldown, 4);
    m.greet = Math.max(0, m.greet - dt);
    motion.gesture = m.greet > 0 ? "wave" : null;

    // Now and then while she talks, a hand comes up to make a point (not mid-wave).
    m.gestureIn -= dt;
    if (!m.gesture && talking && m.greet === 0 && m.gestureIn <= 0 && m.energy > 0.3) {
      m.gesture = {
        side: Math.random() < 0.6 ? "R" : "L",
        t: 0,
        length: rand(1.4, 2.2),
        size: rand(0.75, 1) * (calm < 1 ? 0.5 : 1),
      };
      m.gestureIn = rand(3.5, 7) / calm;
    }
    if (m.gesture) {
      m.gesture.t += dt;
      if (m.gesture.t >= m.gesture.length) m.gesture = null;
    }

    // Warmer when someone's there: a bigger smile and raised brows as she greets you.
    m.smile = MathUtils.damp(m.smile, engaged || watching ? (talking ? 0.62 : 0.75) : 0.3, 2, dt);
    m.brows = MathUtils.damp(
      m.brows,
      m.greet > 0 ? 0.6 : watching || open ? 0.15 + 0.4 * m.stress * calm : 0,
      4,
      dt,
    );
    f.smile = m.smile;
    f.browRaise = m.brows;
    // Talking: the jaw opens and closes between 0 and 0.35, in uneven "syllables".
    // With her ElevenLabs voice playing, the jaw follows its loudness; otherwise it mimes.
    f.jawOpen = speaking
      ? MathUtils.damp(f.jawOpen, 0.04 + 0.42 * librarianPresence.mouth, 18, dt)
      : talking
        ? 0.35 * (0.5 - 0.5 * Math.cos(m.t * 15)) * (0.6 + 0.4 * Math.sin(m.t * 2.7))
        : m.greet > 0
          ? 0.12 + 0.08 * Math.sin(m.t * 9)
          : 0;
    m.near = near;

    // Breathing and a slow weight shift, and her shoulders follow her gaze a little. Talking, she
    // leans in and sways a touch with her words.
    const g = body.current;
    if (g) {
      const breath = Math.sin((m.t * Math.PI * 2) / 3.8);
      g.scale.set(BODY_SCALE, BODY_SCALE * (1 + 0.007 * breath), BODY_SCALE);
      g.position.y = 0.002 * breath + 0.004 * m.voiceFast * calm;
      g.position.x = 0.012 * Math.sin(m.t * 0.23);
      g.rotation.x = MathUtils.damp(
        g.rotation.x,
        (talking ? 0.03 : open ? 0.012 : 0) * calm,
        2,
        dt,
      );
      g.rotation.z = 0.012 * Math.sin(m.t * 0.23 + 0.4) + e * 0.012 * Math.sin(m.t * 1.6);
      g.rotation.y = MathUtils.damp(
        g.rotation.y,
        m.yaw * FACIAL_HEAD_LIMITS.yaw * BODY_FOLLOW,
        2,
        dt,
      );
    }

    // Where her eyes are now, for the conversation close-up.
    const h = head.current;
    if (h) {
      h.getWorldPosition(headPos);
      h.getWorldScale(headScale);
      eye.x = headPos.x;
      eye.y = headPos.y + EYES_ABOVE_HEAD_BONE * headScale.y;
      eye.z = headPos.z;
    }
  });

  /** The talking gesture, layered on the pose the avatar has just given her arms. */
  const gesturePose = () => {
    const { mind: m } = state.current;
    const gesture = m.gesture;
    const h = head.current;
    if (!gesture || !h) return;
    arms.current ??= findArms(h, kit);
    const a = arms.current;
    if (!a) return;
    // Up in under half a second, held while she makes the point, then down again.
    const env =
      MathUtils.smoothstep(gesture.t, 0, 0.45) *
      (1 - MathUtils.smoothstep(gesture.t, gesture.length - 0.55, gesture.length)) *
      gesture.size;
    // The forearm beats a little with her voice.
    const beat = MathUtils.clamp(m.voiceFast - 0.3, -0.3, 0.6);
    const right = gesture.side === "R";
    // The upper arm comes forward and a little out; the elbow bends to bring the hand up.
    bend(a[right ? "UpperArmR" : "UpperArmL"], -0.62 * env, (right ? -0.18 : 0.18) * env);
    bend(a[right ? "LowerArmR" : "LowerArmL"], -(1.2 + 0.25 * beat) * env, 0);
  };

  return (
    <group position={[LIBRARIAN.librarian.x, STEP, LIBRARIAN.librarian.z]}>
      <group ref={body} scale={BODY_SCALE}>
        <Avatar config={LOOK} motion={() => state.current.motion} headRef={head} />
        <AfterPose run={gesturePose} />
      </group>
    </group>
  );
}
