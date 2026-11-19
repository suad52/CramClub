"use client";

import { Environment, Lightformer, Sparkles } from "@react-three/drei";
import { useEffect, useRef } from "react";
import type { DirectionalLight } from "three";
import type { Quality } from "@/lib/game/store";
import type { LampLight } from "@/lib/world/room";

/** Direction toward the sun: low, from the north-east, so light pours in through the big windows. */
export const SUN_DIRECTION = [0.34, 0.6, -1] as const;

export function Lighting({ lamps, quality }: { lamps: readonly LampLight[]; quality: Quality }) {
  const sun = useRef<DirectionalLight>(null);
  const len = Math.hypot(...SUN_DIRECTION);
  const sunPos = SUN_DIRECTION.map((v) => (v / len) * 45) as [number, number, number];
  const mapSize = quality === "high" ? 4096 : quality === "balanced" ? 2048 : 1024;

  useEffect(() => {
    // Shadow map size changes need the old map thrown away.
    const light = sun.current;
    if (!light) return;
    light.shadow.map?.dispose();
    light.shadow.map = null;
  }, [mapSize]);

  // Low quality keeps only the brightest lamps.
  const visibleLamps = quality === "low" ? lamps.filter((l) => l.intensity >= 10) : lamps;

  return (
    <>
      <hemisphereLight args={["#fff1dc", "#7a5a3c", 0.5]} />
      <directionalLight
        ref={sun}
        position={sunPos}
        intensity={5}
        color="#ffe0b0"
        castShadow
        shadow-mapSize={[mapSize, mapSize]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.035}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
        shadow-camera-near={5}
        shadow-camera-far={95}
      />
      {visibleLamps.map((l, i) => (
        <pointLight
          key={i}
          position={[l.x, l.y, l.z]}
          intensity={l.intensity}
          distance={l.distance}
          decay={2}
          color={l.color}
        />
      ))}
      {/* Soft, local image-based light for gentle reflections. No HDR download needed. */}
      <Environment resolution={128} frames={1} environmentIntensity={0.45}>
        <Lightformer
          form="rect"
          intensity={2.2}
          color="#ffe7c2"
          position={[0, 6, 0]}
          rotation-x={Math.PI / 2}
          scale={[30, 20, 1]}
        />
        <Lightformer
          form="rect"
          intensity={3}
          color="#e8f1ff"
          position={[0, 3, -14]}
          scale={[28, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1.2}
          color="#ffd2a0"
          position={[14, 2, 6]}
          rotation-y={-Math.PI / 2}
          scale={[10, 4, 1]}
        />
        <Lightformer
          form="rect"
          intensity={0.6}
          color="#c89a6a"
          position={[0, -2, 0]}
          rotation-x={-Math.PI / 2}
          scale={[30, 20, 1]}
        />
      </Environment>
    </>
  );
}

/** Dust motes drifting in the window light. */
export function Dust({ quality }: { quality: Quality }) {
  if (quality === "low") return null;
  return (
    <>
      <Sparkles
        count={70}
        scale={[30, 4.5, 6]}
        position={[0, 2.6, -8.5]}
        size={2.2}
        speed={0.18}
        opacity={0.5}
        color="#fff3d6"
        noise={0.6}
      />
      <Sparkles
        count={30}
        scale={[8, 3, 10]}
        position={[-11, 2.2, 0]}
        size={1.8}
        speed={0.15}
        opacity={0.35}
        color="#fff3d6"
        noise={0.6}
      />
    </>
  );
}
