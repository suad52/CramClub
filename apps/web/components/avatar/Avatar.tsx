"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import { MathUtils, type Object3D } from "three";
import { type AvatarConfig, FACIAL_HEAD_LIMITS, type FacialParams, PLAYER } from "@ovr/shared";
import {
  AVATAR_KIT_URL,
  type KitAvatar,
  applyAvatarConfig,
  createKitAvatar,
  poseBone,
  setHipsHeight,
  setMorph,
  updateHairClip,
  visibleMeshes,
} from "@/lib/avatar/kitRig";

/** What the avatar is doing, read every frame. Remote players will supply the same shape. */
export interface AvatarMotion {
  /** Ground speed in m/s. */
  speed: number;
  /** 0 standing … 1 seated. */
  sitBlend: number;
  /** Height of the seat surface when seated. */
  seatHeight: number;
  /** Live expression-tracking values (or a creator expression preview), or null for the idle face. */
  face?: FacialParams | null;
  /** A one-off gesture layered over the pose (the creator's preview poses). */
  gesture?: "wave" | null;
}

const FACE_KEYS = [
  "headYaw",
  "headPitch",
  "headRoll",
  "eyeBlinkLeft",
  "eyeBlinkRight",
  "jawOpen",
  "smile",
  "browRaise",
] as const satisfies readonly (keyof FacialParams)[];

export const neutralFace = (): FacialParams => ({
  headYaw: 0,
  headPitch: 0,
  headRoll: 0,
  eyeBlinkLeft: 0,
  eyeBlinkRight: 0,
  jawOpen: 0,
  smile: 0,
  browRaise: 0,
});

interface AnimState {
  t: number;
  phase: number;
  walk: number;
  run: number;
  wave: number;
  blinkIn: number;
  blinkLeft: number;
  /** 0 … 1: how much expression tracking is in control (eases in and out). */
  tracked: number;
  /** Eased copy of the tracked face, so losing the face relaxes rather than snaps. */
  face: FacialParams;
}

const damp = MathUtils.damp;
const lerp = MathUtils.lerp;

/** Procedural idle / walk / run / sit animation and facial expressions for a kit avatar. */
function animate(av: KitAvatar, m: AvatarMotion, s: AnimState, rawDt: number) {
  const dt = Math.min(rawDt, 0.1);
  s.t += dt;
  const standing = 1 - m.sitBlend;
  const walkTarget = standing > 0.5 ? MathUtils.clamp(m.speed / PLAYER.walkSpeed, 0, 1) : 0;
  const runTarget = MathUtils.clamp(
    (m.speed - PLAYER.walkSpeed) / (PLAYER.runSpeed - PLAYER.walkSpeed),
    0,
    1,
  );
  s.walk = damp(s.walk, walkTarget, 9, dt);
  s.run = damp(s.run, runTarget, 6, dt);
  s.wave = damp(s.wave, m.gesture === "wave" ? 1 : 0, 7, dt);
  const stride = lerp(1.25, 1.9, s.run);
  s.phase += (m.speed / stride) * Math.PI * 2 * dt;

  const sw = Math.sin(s.phase);
  const cw = Math.cos(s.phase);
  const w = s.walk;
  const legAmp = lerp(0.5, 0.82, s.run) * w;
  const armAmp = lerp(0.4, 0.75, s.run) * w;
  const kneeAmp = lerp(0.7, 1.3, s.run);
  const idle = 1 - w;
  const breathe = Math.sin(s.t * 1.9);

  // Standing / locomotion pose. Positive X rotation swings a limb backward.
  const stand = {
    hipsY: 0.88 - 0.015 * w + Math.abs(sw) * lerp(0.03, 0.06, s.run) * w,
    hipL: -sw * legAmp,
    hipR: sw * legAmp,
    kneeL: w * (0.06 + Math.max(0, cw) * kneeAmp),
    kneeR: w * (0.06 + Math.max(0, -cw) * kneeAmp),
    shoulderL: sw * armAmp + 0.03 * breathe * idle,
    shoulderR: -sw * armAmp + 0.03 * breathe * idle,
    shoulderZ: 0.02 + 0.05 * s.run,
    elbow: -(0.1 + 0.2 * w + 0.9 * s.run),
    spineX: 0.04 * w + 0.12 * s.run + 0.012 * breathe * idle,
    spineY: sw * 0.07 * w,
    headX: Math.sin(s.t * 0.5) * 0.03 * idle - 0.04 * s.run,
    headY: Math.sin(s.t * 0.33) * 0.14 * idle,
  };
  // Seated pose: thighs forward, shins down, hands resting forward, head tipped to the desk.
  const sit = {
    hipsY: m.seatHeight + 0.09,
    hipL: -1.48,
    hipR: -1.48,
    kneeL: 1.42,
    kneeR: 1.42,
    shoulderL: -0.5 + 0.02 * breathe,
    shoulderR: -0.5 + 0.02 * breathe,
    shoulderZ: 0.06,
    elbow: -0.95,
    spineX: 0.07 + 0.01 * breathe,
    spineY: 0,
    headX: 0.16 + Math.sin(s.t * 0.4) * 0.03,
    headY: Math.sin(s.t * 0.27) * 0.1,
  };
  const b = MathUtils.smootherstep(m.sitBlend, 0, 1);
  const mix = (a: number, c: number) => lerp(a, c, b);

  setHipsHeight(av, mix(stand.hipsY, sit.hipsY));
  poseBone(av, "Hips", 0, -sw * 0.05 * w * (1 - b), 0);
  poseBone(av, "UpperLeg.L", mix(stand.hipL, sit.hipL), 0, 0.02 + 0.05 * b);
  poseBone(av, "UpperLeg.R", mix(stand.hipR, sit.hipR), 0, -0.02 - 0.05 * b);
  poseBone(av, "LowerLeg.L", mix(stand.kneeL, sit.kneeL));
  poseBone(av, "LowerLeg.R", mix(stand.kneeR, sit.kneeR));
  // Feet stay roughly flat on the floor as the knees bend.
  poseBone(av, "Foot.L", -0.35 * mix(stand.kneeL, 0) + mix(0, 0.06));
  poseBone(av, "Foot.R", -0.35 * mix(stand.kneeR, 0) + mix(0, 0.06));

  // Wave (creator preview): right arm up and out, forearm swinging.
  const wv = s.wave;
  const waveSwing = Math.sin(s.t * 8.5) * 0.38;
  poseBone(
    av,
    "UpperArm.L",
    mix(stand.shoulderL, sit.shoulderL),
    0,
    mix(stand.shoulderZ, sit.shoulderZ),
  );
  poseBone(
    av,
    "UpperArm.R",
    lerp(mix(stand.shoulderR, sit.shoulderR), -0.25, wv),
    lerp(0, -0.25, wv),
    lerp(-mix(stand.shoulderZ, sit.shoulderZ), -2.45, wv),
  );
  const elbow = mix(stand.elbow, sit.elbow);
  poseBone(av, "LowerArm.L", elbow);
  poseBone(av, "LowerArm.R", lerp(elbow, -0.15, wv), 0, lerp(0, -0.55 + waveSwing, wv));
  poseBone(av, "Hand.L", 0, 0, 0);
  poseBone(av, "Hand.R", 0, lerp(0, 0.4, wv), 0);

  const spineX = mix(stand.spineX, sit.spineX);
  const spineY = mix(stand.spineY, sit.spineY);
  poseBone(av, "Spine", spineX * 0.6, spineY * 0.6 - 0.05 * wv, 0.03 * wv);
  poseBone(av, "Chest", spineX * 0.4, spineY * 0.4, 0);

  // Expression tracking (or a creator expression) takes over the head and face.
  const live = m.face ?? null;
  s.tracked = damp(s.tracked, live ? 1 : 0, 5, dt);
  for (const key of FACE_KEYS)
    s.face[key] = damp(s.face[key], live ? live[key] : 0, live ? 25 : 6, dt);
  const tw = s.tracked;
  const f = s.face;
  const headX = lerp(mix(stand.headX, sit.headX), -f.headPitch * FACIAL_HEAD_LIMITS.pitch, tw);
  const headY =
    lerp(mix(stand.headY, sit.headY), f.headYaw * FACIAL_HEAD_LIMITS.yaw, tw) + 0.12 * wv;
  const headZ = -f.headRoll * FACIAL_HEAD_LIMITS.roll * tw - 0.08 * wv;
  poseBone(av, "Neck", headX * 0.35, headY * 0.35, headZ * 0.35);
  poseBone(av, "Head", headX * 0.65, headY * 0.65, headZ * 0.65);

  // Blinking: random when idle, the user's own blinks when tracked.
  s.blinkIn -= dt;
  if (s.blinkIn <= 0) {
    s.blinkLeft = 0.13;
    s.blinkIn = 2 + Math.random() * 3.5;
  }
  let blink = 0;
  if (s.blinkLeft > 0) {
    s.blinkLeft -= dt;
    blink = 1;
  }
  const eyes = visibleMeshes(av, "Eyes_");
  setMorph(eyes, "Blink_Left", lerp(blink, f.eyeBlinkLeft, tw));
  setMorph(eyes, "Blink_Right", lerp(blink, f.eyeBlinkRight, tw));
  setMorph(visibleMeshes(av, "Brows_"), "Brow_Raise", f.browRaise * tw + 0.25 * wv);
  const base = av.resolved.morphs.Mouth_Base ?? {};
  const mouth = visibleMeshes(av, "Mouth_");
  setMorph(mouth, "Smile", MathUtils.clamp(lerp(base.Smile ?? 0, f.smile, tw) + 0.3 * wv, 0, 1));
  setMorph(mouth, "Jaw_Open", lerp(base.Jaw_Open ?? 0, f.jawOpen, tw));
  setMorph(mouth, "Frown", (base.Frown ?? 0) * (1 - tw) * (1 - wv));

  updateHairClip(av);
}

function enableLocalClipping(gl: { localClippingEnabled: boolean }) {
  gl.localClippingEnabled = true;
}

export function Avatar({
  config,
  motion,
  headRef,
}: {
  config: AvatarConfig;
  motion: () => AvatarMotion;
  /** Receives the head bone, e.g. to aim a camera at the face. */
  headRef?: RefObject<Object3D | null>;
}) {
  const { scene } = useGLTF(AVATAR_KIT_URL);
  const gl = useThree((s) => s.gl);
  const avatar = useMemo(() => createKitAvatar(scene), [scene]);
  useEffect(() => () => avatar.dispose(), [avatar]);
  // Hats clip the hair with a plane, which needs local clipping on the renderer.
  useEffect(() => enableLocalClipping(gl), [gl]);
  const key = JSON.stringify(config);
  useEffect(() => applyAvatarConfig(avatar, JSON.parse(key) as AvatarConfig), [avatar, key]);
  useEffect(() => {
    if (!headRef) return;
    headRef.current = avatar.bones.Head.bone;
    return () => {
      headRef.current = null;
    };
  }, [headRef, avatar]);
  const state = useRef<AnimState>({
    t: 0,
    phase: 0,
    walk: 0,
    run: 0,
    wave: 0,
    blinkIn: 1.5,
    blinkLeft: 0,
    tracked: 0,
    face: neutralFace(),
  });
  useFrame((_, dt) => animate(avatar, motion(), state.current, dt));
  return <primitive object={avatar.root} />;
}

useGLTF.preload(AVATAR_KIT_URL);
