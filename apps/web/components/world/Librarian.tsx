"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { type Group, MathUtils, type Object3D } from "three";
import {
  type AvatarConfig,
  DEFAULT_AVATAR,
  FACIAL_HEAD_LIMITS,
  type FacialParams,
  LIBRARIAN,
} from "@ovr/shared";
import { Avatar, type AvatarMotion } from "@/components/avatar/Avatar";
import { runtime } from "@/lib/game/runtime";
import { librarianPresence } from "@/lib/librarian/presence";

/*
 * The librarian: a chibi character (the avatar kit with a big head and a small body) standing
 * behind the circulation desk. She's never still: she breathes, shifts her weight, blinks (now
 * and then twice), glances down at her ledger and around the hall, turns to look at you when you
 * come near, and waves when you walk up to the desk. Her panel (lib/librarian/presence.ts) adds
 * the rest: while it's open she keeps her eyes on you from further away, while a request is busy
 * she writes in her ledger, and when a reply arrives she says it.
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
/** Height of her eyes above the floor (m), for aiming her gaze. */
const EYE_HEIGHT = 1.6;
/** She notices you within this distance (m), and greets you within the closer one. */
const NOTICE_RANGE = 6.5;
const GREET_RANGE = 3.4;
const GREET_SECONDS = 1.8;
const GREET_COOLDOWN = 25;

interface Mind {
  t: number;
  blinkIn: number;
  blink: number;
  doubleBlink: boolean;
  /** Where she's looking when nobody's near: yaw/pitch in face units, and when to look elsewhere. */
  idleYaw: number;
  idlePitch: number;
  glanceIn: number;
  greet: number;
  greetCooldown: number;
  near: boolean;
  smile: number;
  brows: number;
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
    greet: 0,
    greetCooldown: 0,
    near: false,
    smile: 0.3,
    brows: 0,
  };
  return { face, motion, mind };
}

export function Librarian() {
  const body = useRef<Group>(null);
  const head = useRef<Object3D | null>(null);
  const state = useRef(newState());
  // The avatar sets its head bone into the ref as it mounts (child effects run first).
  useEffect(() => {
    head.current?.scale.setScalar(HEAD_SCALE);
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const { mind: m, face: f, motion } = state.current;
    m.t += dt;

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
    const dx = runtime.x - LIBRARIAN.librarian.x;
    const dz = runtime.z - LIBRARIAN.librarian.z;
    const dist = Math.hypot(dx, dz);
    const inFront = dz > 0.2 && Math.abs(runtime.y) < 1;
    const near = inFront && dist < NOTICE_RANGE;
    const { open, working, speakUntil } = librarianPresence;
    const talking = performance.now() < speakUntil;
    // With her panel open she keeps her eyes on you from anywhere in front of the desk.
    const watching = near || (open && dz > 0.2);
    // Busy with a request: head down over the ledger (she looks up to say a reply).
    const writing = working && !talking;

    // Idle glances: mostly down at the ledger, sometimes up and around the hall.
    m.glanceIn -= dt;
    if (m.glanceIn <= 0) {
      const ledger = Math.random() < 0.55;
      m.idleYaw = ledger ? rand(-0.25, 0.25) : rand(-0.9, 0.9);
      m.idlePitch = ledger ? rand(-0.75, -0.5) : rand(-0.1, 0.25);
      m.glanceIn = ledger ? rand(3, 6) : rand(1.5, 3.5);
    }

    let yaw = m.idleYaw;
    let pitch = m.idlePitch;
    if (writing) {
      // Eyes on the ledger, following the line she's writing, with a small nod as she writes.
      yaw = 0.14 * Math.sin(m.t * 0.7);
      pitch = -0.72 + 0.08 * Math.sin(m.t * 6.5);
    } else if (watching) {
      // Look at the visitor's face (seated or standing).
      const eye = runtime.y + MathUtils.lerp(1.6, 1.15, runtime.sitBlend);
      yaw = MathUtils.clamp(Math.atan2(dx, dz) / FACIAL_HEAD_LIMITS.yaw, -1, 1);
      pitch = MathUtils.clamp(Math.atan2(eye - EYE_HEIGHT, dist) / FACIAL_HEAD_LIMITS.pitch, -1, 1);
    }
    // Slow, eased head turns, and a little tilt of curiosity when she's looking at you.
    f.headYaw = MathUtils.damp(f.headYaw, yaw, watching && !writing ? 3.5 : 2.2, dt);
    // Quicker while writing, or the nod would be smoothed away.
    f.headPitch = MathUtils.damp(f.headPitch, pitch, writing ? 9 : 2.5, dt);
    f.headRoll = MathUtils.damp(
      f.headRoll,
      watching && !writing ? 0.18 * Math.sin(m.t * 0.6) : 0,
      1.5,
      dt,
    );

    // A wave when you walk up to the desk (not every time you pass by).
    m.greetCooldown = Math.max(0, m.greetCooldown - dt);
    if (inFront && dist < GREET_RANGE && m.greetCooldown === 0) {
      m.greet = GREET_SECONDS;
      m.greetCooldown = GREET_COOLDOWN;
    }
    if (!near) m.greetCooldown = Math.min(m.greetCooldown, 4);
    m.greet = Math.max(0, m.greet - dt);
    motion.gesture = m.greet > 0 ? "wave" : null;

    // Warmer when someone's there: a bigger smile and raised brows as she greets you.
    m.smile = MathUtils.damp(m.smile, watching ? 0.75 : 0.3, 2, dt);
    m.brows = MathUtils.damp(m.brows, m.greet > 0 ? 0.6 : watching ? 0.15 : 0, 4, dt);
    f.smile = m.smile;
    f.browRaise = m.brows;
    // Talking: the jaw opens and closes between 0 and 0.35, in uneven "syllables".
    f.jawOpen = talking
      ? 0.35 * (0.5 - 0.5 * Math.cos(m.t * 15)) * (0.6 + 0.4 * Math.sin(m.t * 2.7))
      : m.greet > 0
        ? 0.12 + 0.08 * Math.sin(m.t * 9)
        : 0;
    m.near = near;

    // Breathing and a slow weight shift, and her shoulders follow her gaze a little.
    const g = body.current;
    if (g) {
      const breath = Math.sin((m.t * Math.PI * 2) / 3.8);
      g.scale.set(BODY_SCALE, BODY_SCALE * (1 + 0.007 * breath), BODY_SCALE);
      g.position.y = 0.002 * breath;
      g.position.x = 0.012 * Math.sin(m.t * 0.23);
      g.rotation.z = 0.012 * Math.sin(m.t * 0.23 + 0.4);
      g.rotation.y = MathUtils.damp(g.rotation.y, f.headYaw * FACIAL_HEAD_LIMITS.yaw * 0.3, 2, dt);
    }
  });

  return (
    <group position={[LIBRARIAN.librarian.x, STEP, LIBRARIAN.librarian.z]}>
      <group ref={body} scale={BODY_SCALE}>
        <Avatar config={LOOK} motion={() => state.current.motion} headRef={head} />
      </group>
    </group>
  );
}
