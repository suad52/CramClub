"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { useProfileStore } from "@/lib/avatar/profile";
import { useGameStore } from "@/lib/game/store";
import { CameraRig } from "./CameraRig";
import { Decor } from "./Decor";
import { Effects } from "./Effects";
import { Dust, Lighting } from "./Lighting";
import { LocalPlayer } from "./LocalPlayer";
import { SeatHighlight } from "./SeatHighlight";
import { StaticWorld, useBuiltWorld } from "./StaticWorld";

/** Flags the scene as ready after a few rendered frames (shaders compiled, first shadows drawn). */
function ReadySignal() {
  const frames = useRef(0);
  useFrame(() => {
    frames.current += 1;
    if (frames.current === 4) useGameStore.getState().setReady(true);
  });
  return null;
}

/**
 * The library pauses (frameloop "never") while the character studio is open. Switching back to
 * "always" doesn't restart R3F's render loop on its own if no other canvas kept it running, so
 * kick it once the phase changes.
 */
function ResumeAfterStudio() {
  const invalidate = useThree((s) => s.invalidate);
  const phase = useGameStore((s) => s.phase);
  useEffect(() => {
    if (phase === "creator") return;
    const t = setTimeout(() => invalidate(), 0);
    return () => clearTimeout(t);
  }, [phase, invalidate]);
  return null;
}

/** Dev-only: exposes the renderer and scene on window.__ovr for debugging draw calls etc. */
function DevHandle() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const w = window as unknown as { __ovr?: Record<string, unknown> };
    w.__ovr = { ...w.__ovr, three: get };
  }, [get]);
  return null;
}

export function LibraryScene() {
  const world = useBuiltWorld();
  const quality = useGameStore((s) => s.settings.quality);
  const avatar = useProfileStore((s) => s.avatar);
  return (
    <>
      <StaticWorld world={world} />
      <Decor />
      <Lighting lamps={world.lights} quality={quality} />
      <Dust quality={quality} />
      <LocalPlayer config={avatar} />
      <CameraRig />
      <SeatHighlight />
      <Effects quality={quality} />
      <ReadySignal />
      <ResumeAfterStudio />
      <DevHandle />
    </>
  );
}
