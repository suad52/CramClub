"use client";

import { Environment, Lightformer, Sparkles } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  CanvasTexture,
  type DirectionalLight,
  type InstancedMesh,
  Object3D,
  type PointLight,
  SRGBColorSpace,
} from "three";
import { DESK_LAMPS, LIBRARY_LIGHTS } from "@ovr/shared";
import type { Quality } from "@/lib/game/store";

/**
 * Direction toward the sun, matching the Blender renders (art/library/scripts/scene_milestone.py):
 * low from the north-west, so shafts pour through the hall's big arched windows onto the tables.
 */
export const SUN_DIRECTION = [-0.5, 0.75, -1] as const;

/** Lights the browser draws for real; everything else glows (bulbs, glass) or is a light pool. */
function PlanLights({ quality }: { quality: Quality }) {
  const fire = useRef<PointLight>(null);
  const lights = useMemo(
    () =>
      LIBRARY_LIGHTS.filter((l) =>
        quality === "low" ? l.kind === "chandelier" || l.kind === "fire" : true,
      ),
    [quality],
  );
  useFrame(({ clock }) => {
    const f = fire.current;
    if (!f) return;
    const t = clock.elapsedTime;
    // A slow breathing glow with a quicker flicker on top.
    f.intensity = f.userData.base * (0.85 + Math.sin(t * 1.7) * 0.06 + Math.sin(t * 11.3) * 0.05);
  });
  return (
    <>
      {lights.map((l) => (
        <pointLight
          key={l.id}
          ref={l.kind === "fire" ? fire : undefined}
          userData={{ base: l.intensity }}
          position={[l.x, l.y, l.z]}
          intensity={l.intensity}
          distance={l.distance}
          decay={2}
          color={l.color}
        />
      ))}
    </>
  );
}

function poolTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,214,150,0.9)");
  g.addColorStop(0.35, "rgba(255,196,120,0.45)");
  g.addColorStop(1, "rgba(255,180,100,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Warm pools of light under every desk lamp: one instanced, additive decal on the table tops
 * instead of dozens of real lights.
 */
function LampPools() {
  const mesh = useRef<InstancedMesh>(null);
  const lamps = useMemo(() => [...DESK_LAMPS.hall, ...DESK_LAMPS.green], []);
  const texture = useMemo(() => poolTexture(), []);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const o = new Object3D();
    lamps.forEach((l, i) => {
      o.position.set(l.x, l.y + 0.006, l.z);
      o.rotation.set(-Math.PI / 2, 0, 0);
      o.updateMatrix();
      m.setMatrixAt(i, o.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
  }, [lamps]);
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, lamps.length]} renderOrder={2}>
      <planeGeometry args={[1.1, 1.1]} />
      <meshBasicMaterial
        map={texture}
        transparent
        depthWrite={false}
        blending={AdditiveBlending}
        toneMapped={false}
        opacity={0.55}
      />
    </instancedMesh>
  );
}

export function Lighting({ quality }: { quality: Quality }) {
  const sun = useRef<DirectionalLight>(null);
  const len = Math.hypot(...SUN_DIRECTION);
  const sunPos = SUN_DIRECTION.map((v) => (v / len) * 60) as [number, number, number];
  const mapSize = quality === "high" ? 4096 : quality === "balanced" ? 2048 : 1024;

  useEffect(() => {
    // Shadow map size changes need the old map thrown away.
    const light = sun.current;
    if (!light) return;
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }, [mapSize]);

  return (
    <>
      <hemisphereLight args={["#f6ecdc", "#6b4a32", 0.55]} />
      {/* Aimed at the reading hall; the shadow box covers it and the gallery. */}
      <directionalLight
        ref={sun}
        position={sunPos}
        intensity={4.2}
        color="#ffe2bc"
        castShadow={quality !== "low"}
        shadow-mapSize={[mapSize, mapSize]}
        shadow-bias={-0.0003}
        shadow-normalBias={0.04}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={22}
        shadow-camera-bottom={-22}
        shadow-camera-near={10}
        shadow-camera-far={120}
      />
      <PlanLights quality={quality} />
      <LampPools />
      {/* Soft, local image-based light: the laylight overhead, the north windows, warm bounce. */}
      <Environment resolution={128} frames={1} environmentIntensity={0.5}>
        <Lightformer
          form="rect"
          intensity={2.4}
          color="#dfeaff"
          position={[0, 12.4, -1]}
          rotation-x={Math.PI / 2}
          scale={[9, 5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2.6}
          color="#e8f1ff"
          position={[0, 9, -10.5]}
          scale={[28, 5, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.4}
          color="#ffd9a8"
          position={[0, 7, 0]}
          rotation-x={Math.PI / 2}
          scale={[26, 16, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.6}
          color="#b88a5e"
          position={[0, -1, 0]}
          rotation-x={-Math.PI / 2}
          scale={[40, 30, 1]}
        />
      </Environment>
    </>
  );
}

/** Dust motes drifting in the window light over the reading hall. */
export function Dust({ quality }: { quality: Quality }) {
  if (quality === "low") return null;
  return (
    <>
      <Sparkles
        count={90}
        scale={[24, 6, 10]}
        position={[2, 4.5, 1]}
        size={2.4}
        speed={0.15}
        opacity={0.45}
        color="#fff3d6"
        noise={0.6}
      />
      <Sparkles
        count={30}
        scale={[10, 4, 8]}
        position={[0, 6, -5]}
        size={1.8}
        speed={0.12}
        opacity={0.3}
        color="#fff3d6"
        noise={0.6}
      />
    </>
  );
}
