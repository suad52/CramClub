"use client";

import { ContactShadows, Environment, Lightformer } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { type RefObject, Suspense, useCallback, useEffect, useRef } from "react";
import { type Group, MathUtils, NeutralToneMapping, type PerspectiveCamera } from "three";
import { type AvatarConfig, type FacialParams } from "@ovr/shared";
import {
  Avatar,
  type AvatarMotion,
  type FaceHeadSource,
  neutralFace,
} from "@/components/avatar/Avatar";
import { FRAMINGS, type FramingId } from "./categories";

export type StudioPose = "idle" | "wave" | "sit";
export type StudioExpression = "neutral" | "smile" | "wink" | "surprised" | "sleepy";

/** Camera/turntable state shared between the HTML controls and the 3D scene. */
export interface StudioControls {
  /** Turntable angle (radians, 0 = facing the camera). */
  yaw: number;
  targetYaw: number;
  /** Multiplies the framing distance (scroll to zoom). */
  zoom: number;
  framing: FramingId;
  dragging: boolean;
}

export const createStudioControls = (): StudioControls => ({
  yaw: -0.35,
  targetYaw: 0,
  zoom: 1,
  framing: "full",
  dragging: false,
});

const EXPRESSIONS: Record<StudioExpression, Partial<FacialParams> | null> = {
  neutral: null,
  smile: { smile: 1, browRaise: 0.25 },
  wink: { eyeBlinkLeft: 1, smile: 0.75, headRoll: 0.18 },
  surprised: { browRaise: 1, jawOpen: 0.6, headPitch: 0.1 },
  sleepy: {
    eyeBlinkLeft: 0.65,
    eyeBlinkRight: 0.65,
    headPitch: -0.3,
    headRoll: -0.12,
    jawOpen: 0.08,
  },
};

const SEAT_HEIGHT = 0.46;
const STUDIO_GL = {
  antialias: true,
  alpha: true,
  toneMapping: NeutralToneMapping,
  powerPreference: "high-performance",
} as const;

/** A round cushioned stool for the sitting preview. */
function Stool() {
  return (
    <group position={[0, 0, 0.06]}>
      <mesh position={[0, SEAT_HEIGHT - 0.045, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.2, 0.2, 0.09, 40]} />
        <meshStandardMaterial color="#b5643f" roughness={0.85} />
      </mesh>
      <mesh position={[0, SEAT_HEIGHT - 0.1, 0]} castShadow>
        <cylinderGeometry args={[0.17, 0.17, 0.03, 32]} />
        <meshStandardMaterial color="#6e4a33" roughness={0.6} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        return (
          <mesh
            key={i}
            position={[Math.sin(a) * 0.12, (SEAT_HEIGHT - 0.1) / 2, Math.cos(a) * 0.12]}
            rotation={[Math.cos(a) * 0.08, 0, -Math.sin(a) * 0.08]}
            castShadow
          >
            <cylinderGeometry args={[0.018, 0.014, SEAT_HEIGHT - 0.1, 10]} />
            <meshStandardMaterial color="#6e4a33" roughness={0.6} />
          </mesh>
        );
      })}
    </group>
  );
}

function Podium() {
  return (
    <group>
      <mesh position={[0, -0.045, 0]} receiveShadow>
        <cylinderGeometry args={[1.05, 1.1, 0.09, 72]} />
        <meshStandardMaterial color="#8a5c3b" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[0.9, 72]} />
        <meshStandardMaterial color="#e9dcc4" roughness={0.95} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.74, 0.8, 72]} />
        <meshStandardMaterial color="#29483a" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.83, 0.85, 72]} />
        <meshStandardMaterial color="#b18a50" roughness={0.4} metalness={0.6} />
      </mesh>
    </group>
  );
}

/** Shifts the projection so the avatar sits in the middle of the space between the panels. */
function offsetView(camera: PerspectiveCamera, width: number, height: number, shift: number) {
  if (shift === 0) camera.clearViewOffset();
  else camera.setViewOffset(width, height, shift, 0, width, height);
  camera.updateProjectionMatrix();
}

function stepDirector(
  c: StudioControls,
  cam: { y: number; distance: number },
  turntable: Group | null,
  camera: PerspectiveCamera,
  scale: number,
  dt: number,
) {
  c.yaw = MathUtils.damp(c.yaw, c.targetYaw, c.dragging ? 18 : 6, dt);
  if (turntable) turntable.rotation.y = c.yaw;
  const f = FRAMINGS[c.framing];
  cam.y = MathUtils.damp(cam.y, f.y * scale, 4.5, dt);
  cam.distance = MathUtils.damp(cam.distance, f.distance * c.zoom, 4.5, dt);
  // A touch above eye level, looking slightly down, like a portrait photographer.
  camera.position.set(0, cam.y + cam.distance * 0.09, cam.distance);
  camera.lookAt(0, cam.y, 0);
}

/** Turntable + camera framing, with the avatar centred in the space between the side panels. */
function Director({
  controls,
  scale,
  insets,
  children,
}: {
  controls: RefObject<StudioControls>;
  scale: number;
  insets: { left: number; right: number };
  children: React.ReactNode;
}) {
  const turntable = useRef<Group>(null);
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const cam = useRef({ y: FRAMINGS.full.y, distance: FRAMINGS.full.distance });

  useEffect(
    () => offsetView(camera, size.width, size.height, Math.round((insets.right - insets.left) / 2)),
    [camera, size, insets.left, insets.right],
  );
  useFrame((_, dt) => {
    if (controls.current)
      stepDirector(
        controls.current,
        cam.current,
        turntable.current,
        camera,
        scale,
        Math.min(dt, 0.05),
      );
  });

  return <group ref={turntable}>{children}</group>;
}

function Scene({
  config,
  pose,
  expression,
  controls,
  insets,
  faceHead,
}: {
  config: AvatarConfig;
  pose: StudioPose;
  expression: StudioExpression;
  controls: RefObject<StudioControls>;
  insets: { left: number; right: number };
  faceHead: FaceHeadSource | null;
}) {
  const live = useRef({ sitBlend: 0, pose, face: null as FacialParams | null });
  useEffect(() => {
    const e = EXPRESSIONS[expression];
    live.current.face = e ? { ...neutralFace(), ...e } : null;
    live.current.pose = pose;
  }, [expression, pose]);
  useFrame((_, dt) => {
    const l = live.current;
    l.sitBlend = MathUtils.damp(l.sitBlend, l.pose === "sit" ? 1 : 0, 5, Math.min(dt, 0.05));
  });
  const motion = useCallback(
    (): AvatarMotion => ({
      speed: 0,
      sitBlend: live.current.sitBlend,
      seatHeight: SEAT_HEIGHT,
      face: live.current.face,
      gesture: live.current.pose === "wave" ? "wave" : null,
    }),
    [],
  );
  const scale = 1 + 0.06 * config.height;

  return (
    <>
      <hemisphereLight args={["#fff4e0", "#7a5236", 0.9]} />
      <directionalLight
        position={[2.2, 4.2, 3.2]}
        intensity={2.3}
        color="#ffe9cc"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
        shadow-camera-left={-1.4}
        shadow-camera-right={1.4}
        shadow-camera-top={2.2}
        shadow-camera-bottom={-0.4}
      />
      <directionalLight position={[-3, 2.6, -2.8]} intensity={1.7} color="#ffd29a" />
      <directionalLight position={[-2.5, 1.2, 2.5]} intensity={0.45} color="#cfe0ff" />
      <Environment resolution={128} frames={1}>
        <Lightformer intensity={1.4} color="#fff1dc" position={[0, 3, 3]} scale={[6, 3, 1]} />
        <Lightformer
          intensity={0.8}
          color="#ffcf8f"
          position={[-4, 1.5, -1]}
          rotation-y={Math.PI / 2}
          scale={[4, 3, 1]}
        />
        <Lightformer
          intensity={0.5}
          color="#bcd3ff"
          position={[4, 1.5, 1]}
          rotation-y={-Math.PI / 2}
          scale={[4, 3, 1]}
        />
      </Environment>
      <Director controls={controls} scale={scale} insets={insets}>
        <Suspense fallback={null}>
          <Avatar config={config} motion={motion} faceHead={faceHead} />
        </Suspense>
        <StoolFollow live={live} />
      </Director>
      <Podium />
      <ContactShadows
        position={[0, 0.004, 0]}
        opacity={0.45}
        scale={3}
        blur={2.4}
        far={1.6}
        resolution={512}
        color="#3a2416"
      />
      <DevHandle />
    </>
  );
}

/** Dev-only: exposes the studio renderer on window.__ovr.studio for automated checks. */
function DevHandle() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __ovr?: Record<string, unknown> };
    w.__ovr = { ...w.__ovr, studio: get };
  }, [get]);
  return null;
}

function StoolFollow({ live }: { live: RefObject<{ sitBlend: number }> }) {
  const ref = useRef<Group>(null);
  useFrame(() => {
    const v = live.current?.sitBlend ?? 0;
    if (!ref.current) return;
    ref.current.visible = v > 0.02;
    ref.current.scale.setScalar(MathUtils.lerp(0.7, 1, v));
  });
  return (
    <group ref={ref}>
      <Stool />
    </group>
  );
}

/** The studio's 3D view: a lit podium with the live avatar on a turntable. */
export function StudioCanvas({
  config,
  pose,
  expression,
  controls,
  insets,
  faceHead = null,
}: {
  config: AvatarConfig;
  pose: StudioPose;
  expression: StudioExpression;
  controls: RefObject<StudioControls>;
  insets: { left: number; right: number };
  /** The draft "my real face" head, or null for the chibi head. */
  faceHead?: FaceHeadSource | null;
}) {
  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      gl={STUDIO_GL}
      camera={{ fov: 28, near: 0.05, far: 60, position: [0, 1.2, 4] }}
      onCreated={({ gl }) => {
        gl.localClippingEnabled = true;
      }}
      aria-label="3D preview of your character"
    >
      <Scene
        config={config}
        pose={pose}
        expression={expression}
        controls={controls}
        insets={insets}
        faceHead={faceHead}
      />
    </Canvas>
  );
}
