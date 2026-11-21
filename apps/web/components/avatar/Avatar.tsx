"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { type RefObject, useEffect, useMemo, useRef } from "react";
import {
  ClampToEdgeWrapping,
  Color,
  type Material,
  MathUtils,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Object3D,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  TorusGeometry,
  Group,
  VideoTexture,
} from "three";
import {
  type AvatarConfig,
  FACIAL_HEAD_LIMITS,
  type FacialParams,
  KIT_HEAD_CENTER_Z,
  PLAYER,
} from "@ovr/shared";
import {
  type HeadSettings,
  isChibiHeadPart,
  showsFaceHead,
  videoCrop,
} from "@/lib/avatar/facePhoto";
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
import { useProfileStore } from "@/lib/avatar/profile";
import { getCameraStream, useTrackingStore } from "@/lib/facial-tracking/tracker";

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

/** The face meshes the animation drives (the visible eyes, brows and mouth). */
interface FaceParts {
  eyes: Mesh[];
  brows: Mesh[];
  mouth: Mesh[];
}

/** Looked up once per look (a crowd of avatars would otherwise build these lists every frame). */
function faceParts(av: KitAvatar): FaceParts {
  return {
    eyes: visibleMeshes(av, "Eyes_"),
    brows: visibleMeshes(av, "Brows_"),
    mouth: visibleMeshes(av, "Mouth_"),
  };
}

/** Procedural idle / walk / run / sit animation and facial expressions for a kit avatar. */
function animate(av: KitAvatar, m: AvatarMotion, s: AnimState, rawDt: number, parts: FaceParts) {
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
  const { eyes, brows, mouth } = parts;
  setMorph(eyes, "Blink_Left", lerp(blink, f.eyeBlinkLeft, tw));
  setMorph(eyes, "Blink_Right", lerp(blink, f.eyeBlinkRight, tw));
  setMorph(brows, "Brow_Raise", f.browRaise * tw + 0.25 * wv);
  const base = av.resolved.morphs.Mouth_Base ?? {};
  const jaw = lerp(base.Jaw_Open ?? 0, f.jawOpen, tw);
  // The mouth's shape keys add up: a resting smile (or frown) left on while the jaw opens draws
  // its closed lip line across the open mouth. So the more the mouth opens, the more they give
  // way, and an open mouth is just an open mouth.
  const closed = mouthClosedness(jaw);
  const smile = MathUtils.clamp(lerp(base.Smile ?? 0, f.smile, tw) + 0.3 * wv, 0, 1);
  setMorph(mouth, "Smile", smile * closed);
  setMorph(mouth, "Jaw_Open", jaw);
  setMorph(mouth, "Frown", (base.Frown ?? 0) * (1 - tw) * (1 - wv) * closed);

  updateHairClip(av);
}

/** 1 with the mouth closed, easing to 0 once the jaw is about a third open (smoothstep). */
export function mouthClosedness(jawOpen: number) {
  const t = MathUtils.clamp(jawOpen / 0.3, 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

function enableLocalClipping(gl: { localClippingEnabled: boolean }) {
  gl.localClippingEnabled = true;
}

// ---------------------------------------------------------------------------
// "My real face": a cartoon face head in place of the chibi one
// ---------------------------------------------------------------------------

/** What the face head shows. Only the local player and the studio preview pass one. */
export interface FaceHeadSource {
  /** Square JPEG data URL of the player's face. */
  photo: string | null;
  /** Live camera (expression tracking's) to show instead of the photo, or null. */
  stream: MediaStream | null;
  /** Mirror the live camera (expression tracking's mirror setting). */
  mirror: boolean;
}

/** Face disc radius and depth (m, kit scale): a little wider than the chibi head's face. */
const FACE_R = 0.165;
const FACE_DEPTH = 0.075;
/** Where the disc's centre sits relative to the chibi head centre (up, forward). */
const FACE_OFFSET = { y: 0.005, z: 0.035 };
const WALNUT = "#1f1a16";

interface FaceHead {
  group: Group;
  faceMat: MeshStandardMaterial;
  backMat: MeshStandardMaterial;
  dispose: () => void;
}

/** A domed disc with planar 0 … 1 UVs (so a square photo shows as a circle). */
function domeGeometry() {
  const geo = new RingGeometry(0, FACE_R, 72, 14);
  const pos = geo.attributes.position!;
  const normal = geo.attributes.normal!;
  const r2 = FACE_R * FACE_R;
  const d2 = FACE_DEPTH * FACE_DEPTH;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = FACE_DEPTH * Math.sqrt(Math.max(0, 1 - (x * x + y * y) / r2));
    // Just proud of the back shell, so the two never fight at the rim.
    pos.setZ(i, z + 0.002);
    // Ellipsoid normal (x / r², y / r², z / d²), normalised.
    const nx = x / r2;
    const ny = y / r2;
    const nz = Math.max(z, 1e-4) / d2;
    const len = Math.hypot(nx, ny, nz) || 1;
    normal.setXYZ(i, nx / len, ny / len, nz / len);
  }
  return geo;
}

/**
 * Builds the face head, posed for the Head bone at the chibi head's rest position (so once it's
 * parented to the bone it nods, turns and tracks with the head). Hidden until a face is shown.
 */
function createFaceHead(avatar: KitAvatar): FaceHead {
  const faceMat = new MeshStandardMaterial({
    color: "#ffffff",
    roughness: 0.85,
    // A little self-light keeps the photo readable in the library's dim corners.
    emissive: new Color("#ffffff"),
    emissiveIntensity: 0.4,
  });
  const backMat = new MeshStandardMaterial({ color: "#6b4a35", roughness: 0.8 });
  const ringMat = new MeshStandardMaterial({ color: WALNUT, roughness: 0.7 });
  const geometries = [
    domeGeometry(),
    new SphereGeometry(FACE_R, 48, 24, Math.PI, Math.PI).scale(1, 1, FACE_DEPTH / FACE_R),
    new TorusGeometry(FACE_R + 0.002, 0.018, 14, 96),
  ];
  const parts = [
    new Mesh(geometries[0], faceMat),
    new Mesh(geometries[1], backMat),
    new Mesh(geometries[2], ringMat),
  ];
  const group = new Group();
  group.name = "FaceHead";
  for (const m of parts) {
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  // Rest pose in avatar space (facing +Z) → the Head bone's local space.
  const rest = new Matrix4().makeTranslation(0, KIT_HEAD_CENTER_Z + FACE_OFFSET.y, FACE_OFFSET.z);
  new Matrix4()
    .multiplyMatrices(avatar.headRestInverse, rest)
    .decompose(group.position, group.quaternion, group.scale);
  group.visible = false;
  return {
    group,
    faceMat,
    backMat,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of [faceMat, backMat, ringMat] as Material[]) m.dispose();
    },
  };
}

/** Parents the face head to the Head bone; the cleanup takes it off and frees it. */
function attachFaceHead(avatar: KitAvatar, head: FaceHead) {
  avatar.bones.Head.bone.add(head.group);
  return () => {
    head.group.removeFromParent();
    head.dispose();
  };
}

/** Shows the face head (and hides the chibi head's parts) or the other way round. */
function applyHeadMode(avatar: KitAvatar, head: FaceHead, face: boolean) {
  head.group.visible = face;
  if (!face) return;
  for (const [name, meshes] of avatar.parts)
    if (isChibiHeadPart(name)) for (const m of meshes) m.visible = false;
  // The back of the face head takes the hair colour, so it still reads as a head from behind.
  const hair = avatar.resolved.materials.MAT_Hair;
  if (hair) head.backMat.color.set(hair);
}

/** Puts the photo or the live camera on the face; returns a cleanup that frees it. */
function bindFaceTexture(
  head: FaceHead,
  photo: string | null,
  stream: MediaStream | null,
  mirror: boolean,
) {
  let texture: Texture;
  let stop = () => {};
  if (stream) {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play().catch(() => {});
    const vt = new VideoTexture(video);
    const crop = () => {
      const c = videoCrop(video.videoWidth, video.videoHeight, undefined, mirror);
      vt.repeat.set(...c.repeat);
      vt.offset.set(...c.offset);
    };
    crop();
    video.addEventListener("loadedmetadata", crop);
    texture = vt;
    stop = () => {
      video.removeEventListener("loadedmetadata", crop);
      video.pause();
      // The stream belongs to expression tracking: detach from it, never stop it here.
      video.srcObject = null;
    };
  } else if (photo) {
    texture = new TextureLoader().load(photo);
  } else {
    return () => {};
  }
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
  head.faceMat.map = texture;
  head.faceMat.emissiveMap = texture;
  head.faceMat.needsUpdate = true;
  return () => {
    stop();
    if (head.faceMat.map === texture) {
      head.faceMat.map = null;
      head.faceMat.emissiveMap = null;
      head.faceMat.needsUpdate = true;
    }
    texture.dispose();
  };
}

const LIVE_STATUSES = new Set(["calibrating", "tracking", "no-face"]);

/**
 * What a head choice shows right now: the live camera while expression tracking runs (if the
 * player opted in), else the photo; null for the chibi head.
 */
export function useFaceHeadSource(head: HeadSettings): FaceHeadSource | null {
  const status = useTrackingStore((s) => s.status);
  const mirror = useTrackingStore((s) => s.mirror);
  if (head.headMode !== "face") return null;
  const stream = head.liveFace && LIVE_STATUSES.has(status) ? getCameraStream() : null;
  if (!showsFaceHead(head, stream !== null)) return null;
  return { photo: head.facePhoto, stream, mirror };
}

/** The saved player's face head (for the local player's own avatar only). */
export function usePlayerFaceHead(): FaceHeadSource | null {
  const headMode = useProfileStore((s) => s.headMode);
  const facePhoto = useProfileStore((s) => s.facePhoto);
  const liveFace = useProfileStore((s) => s.liveFace);
  return useFaceHeadSource({ headMode, facePhoto, liveFace });
}

export function Avatar({
  config,
  motion,
  headRef,
  faceHead = null,
}: {
  config: AvatarConfig;
  motion: () => AvatarMotion;
  /** Receives the head bone, e.g. to aim a camera at the face. */
  headRef?: RefObject<Object3D | null>;
  /** Swap the chibi head for the player's real face. Leave out for everyone else (NPCs). */
  faceHead?: FaceHeadSource | null;
}) {
  const { scene } = useGLTF(AVATAR_KIT_URL);
  const gl = useThree((s) => s.gl);
  const avatar = useMemo(() => createKitAvatar(scene), [scene]);
  const head = useMemo(() => createFaceHead(avatar), [avatar]);
  useEffect(() => attachFaceHead(avatar, head), [avatar, head]);
  useEffect(() => () => avatar.dispose(), [avatar]);
  // Hats clip the hair with a plane, which needs local clipping on the renderer.
  useEffect(() => enableLocalClipping(gl), [gl]);
  const key = JSON.stringify(config);
  const showFace = faceHead !== null;
  const parts = useRef<FaceParts | null>(null);
  useEffect(() => {
    applyAvatarConfig(avatar, JSON.parse(key) as AvatarConfig);
    applyHeadMode(avatar, head, showFace);
    // Which eyes, brows and mouth show changes only with the look.
    parts.current = faceParts(avatar);
  }, [avatar, head, key, showFace]);
  const photo = faceHead?.photo ?? null;
  const stream = faceHead?.stream ?? null;
  const mirror = faceHead?.mirror ?? false;
  useEffect(() => bindFaceTexture(head, photo, stream, mirror), [head, photo, stream, mirror]);
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
  useFrame((_, dt) => {
    parts.current ??= faceParts(avatar);
    animate(avatar, motion(), state.current, dt, parts.current);
  });
  return <primitive object={avatar.root} />;
}

useGLTF.preload(AVATAR_KIT_URL);
