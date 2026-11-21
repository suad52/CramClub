"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useRef } from "react";
import { useProfileStore } from "@/lib/avatar/profile";
import { useGameStore } from "@/lib/game/store";
import { useBoardLessons } from "@/lib/learning-studio/boardLessons";
import { BoardPanels } from "./BoardPanels";
import { CameraRig } from "./CameraRig";
import { Effects } from "./Effects";
import { LibraryModel } from "./LibraryModel";
import { Dust, Lighting } from "./Lighting";
import { LiveWhiteboards } from "./LiveWhiteboards";
import { LocalPlayer } from "./LocalPlayer";
import { Librarian } from "./Librarian";
import { LibrarianDesk } from "./LibrarianDesk";
import { PomodoroTimer } from "./PomodoroTimer";
import { SeatHighlight } from "./SeatHighlight";
import { Sky } from "./Sky";

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
 * The library pauses (frameloop "never") while the character studio or a full-screen lesson is
 * open. Switching back to "always" doesn't restart R3F's render loop on its own if no other canvas
 * kept it running, so kick it once either closes.
 */
function ResumeAfterStudio() {
  const invalidate = useThree((s) => s.invalidate);
  const phase = useGameStore((s) => s.phase);
  const fullscreen = useBoardLessons((s) => s.fullscreen);
  useEffect(() => {
    if (phase === "creator" || fullscreen) return;
    const t = setTimeout(() => invalidate(), 0);
    return () => clearTimeout(t);
  }, [phase, fullscreen, invalidate]);
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
  const quality = useGameStore((s) => s.settings.quality);
  const avatar = useProfileStore((s) => s.avatar);
  return (
    <>
      {/* Ready only once the building has loaded and drawn a few frames. */}
      <Suspense fallback={null}>
        <LibraryModel quality={quality} />
        {/* Splits the rolling boards' panels out of the model so they can turn over. */}
        <BoardPanels />
        <ReadySignal />
      </Suspense>
      <Sky />
      <LiveWhiteboards />
      <Lighting quality={quality} />
      <Dust quality={quality} />
      <LocalPlayer config={avatar} />
      <CameraRig />
      <SeatHighlight />
      {/* The Pomodoro timer on the table in front of you while you sit. */}
      <PomodoroTimer quality={quality} />
      <LibrarianDesk />
      <Librarian />
      <Effects quality={quality} />
      <ResumeAfterStudio />
      <DevHandle />
    </>
  );
}
