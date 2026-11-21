"use client";

import { Canvas } from "@react-three/fiber";
import Link from "next/link";
import { NeutralToneMapping } from "three";
import { useEffect, useState } from "react";
import { SPAWN_POINTS } from "@ovr/shared";
import { CharacterStudio } from "@/components/creator/CharacterStudio";
import { TitleScreen } from "@/components/entry/TitleScreen";
import { LibraryScene } from "@/components/world/LibraryScene";
import { useProfileStore } from "@/lib/avatar/profile";
import { exitPointerLock } from "@/lib/game/pointer";
import { usePomodoro } from "@/lib/game/pomodoro";
import { resetRuntime, runtime } from "@/lib/game/runtime";
import {
  faceState,
  selfTestModel,
  stopTracking,
  useTrackingStore,
} from "@/lib/facial-tracking/tracker";
import { useGameStore } from "@/lib/game/store";
import { publishLiveFrame, useBoardLessons } from "@/lib/learning-studio/boardLessons";
import { WhiteboardPanel } from "@/components/whiteboard/WhiteboardPanel";
import { useWhiteboardStore } from "@/lib/whiteboard/store";
import { BoardLessonsLayer } from "./BoardLessons";
import { FaceViewFrame, TrackingPanel } from "./ExpressionTracking";
import { Hud } from "./Hud";
import {
  ClickToLook,
  ControlsGuide,
  LoadingScreen,
  PauseMenu,
  TouchDeviceNotice,
} from "./Overlays";
import { PomodoroLayer } from "./Pomodoro";
import { ProgressOverlay } from "./ProgressOverlay";

// Stable reference: R3F re-applies renderer props whenever this object changes identity.
// Neutral tone mapping keeps the stylized palette true; post-processing uses the same curve.
const GL_PROPS = {
  antialias: false,
  powerPreference: "high-performance",
  stencil: false,
  toneMapping: NeutralToneMapping,
} as const;

function hasWebGL2() {
  try {
    return !!document.createElement("canvas").getContext("webgl2");
  } catch {
    return false;
  }
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="fixed inset-0 grid place-items-center bg-parchment p-6">
      <div className="max-w-md rounded-3xl border border-ink/10 bg-cream p-8 text-center shadow-xl">
        <h1 className="font-display text-2xl font-semibold">{title}</h1>
        <p className="mt-3 text-ink-soft">{body}</p>
        <div className="mt-6 flex justify-center gap-3">
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-cream hover:bg-wood-dark"
          >
            Try again
          </button>
          <Link
            href="/"
            className="rounded-full px-5 py-2.5 text-sm font-bold text-ink-soft hover:bg-ink/5"
          >
            Back home
          </Link>
        </div>
      </div>
    </div>
  );
}

/** Opens the character studio over the library and routes Save / Cancel. */
function Studio() {
  const from = useGameStore((s) => s.creatorFrom);
  const profile = useProfileStore.getState();
  const firstTime = profile.savedAt === null;
  useEffect(() => exitPointerLock(), []);
  return (
    <CharacterStudio
      initialConfig={profile.avatar}
      initialName={profile.displayName}
      firstTime={firstTime}
      onCancel={() => useGameStore.getState().setPhase(from)}
      onSave={(name, config) => {
        useProfileStore.getState().save(name, config);
        // A brand-new character walks straight in; edits return to where you were.
        useGameStore.getState().setPhase(firstTime ? "entering" : from);
      }}
    />
  );
}

/** The whole in-library experience: the 3D canvas plus the HTML HUD and overlays on top. */
export default function LibraryExperience() {
  const [supported] = useState(hasWebGL2);
  const [contextLost, setContextLost] = useState(false);
  const quality = useGameStore((s) => s.settings.quality);
  const phase = useGameStore((s) => s.phase);
  const lessonFullscreen = useBoardLessons((s) => s.fullscreen);

  useEffect(() => {
    // Fresh session state every time someone walks in.
    const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)]!;
    resetRuntime(spawn);
    const s = useGameStore.getState();
    s.setReady(false);
    s.setSeat(null);
    s.setNearbySeat(null);
    s.setNearbyBoard(null);
    s.setMenuOpen(false);
    s.setGuideOpen(false);
    s.setProgressOpen(false);
    // Every visit starts on the title screen; the controls guide opens after entering.
    s.setPhase("title");
    if (process.env.NODE_ENV !== "production") {
      // Dev-only handle for debugging and automated checks in the browser console.
      (window as unknown as { __ovr?: unknown }).__ovr = {
        runtime,
        store: useGameStore,
        tracking: { faceState, store: useTrackingStore, selfTestModel },
        whiteboard: useWhiteboardStore,
        boardLessons: useBoardLessons,
        pomodoro: usePomodoro,
      };
    }
    return () => {
      useGameStore.getState().setReady(false);
      // Leaving the library always turns the camera off, closes any board and takes every lesson
      // off the boards. It also ends a running pomodoro: it doesn't count.
      usePomodoro.getState().abandon("left-library");
      stopTracking();
      useWhiteboardStore.getState().close();
      useBoardLessons.getState().reset();
      publishLiveFrame(null);
    };
  }, []);

  if (!supported) {
    return (
      <ErrorCard
        title="Your browser can't open the library"
        body="OVR needs WebGL 2, which this browser or device doesn't support. Try a recent version of Chrome, Edge, Firefox or Safari on a computer."
      />
    );
  }
  if (contextLost) {
    return (
      <ErrorCard
        title="The 3D view stopped"
        body="Your graphics driver reset the library's 3D view. This can happen when a computer is low on memory. Reloading usually fixes it."
      />
    );
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#2a1f19] select-none">
      <Canvas
        shadows="percentage"
        dpr={quality === "high" ? [1, 2] : quality === "balanced" ? [1, 1.5] : 1}
        gl={GL_PROPS}
        camera={{ fov: 60, near: 0.05, far: 500, position: [0, 1.6, 11] }}
        // The studio and a full-screen lesson cover the library completely; pause it behind them.
        frameloop={phase === "creator" || lessonFullscreen ? "never" : "always"}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener("webglcontextlost", (e) => {
            e.preventDefault();
            setContextLost(true);
          });
        }}
        aria-label="3D view of the OVR library"
      >
        <LibraryScene />
      </Canvas>
      <ClickToLook />
      <Hud />
      <BoardLessonsLayer />
      <PomodoroLayer />
      <FaceViewFrame />
      <TrackingPanel />
      <WhiteboardPanel />
      <PauseMenu />
      <ProgressOverlay />
      <ControlsGuide />
      <TitleScreen />
      {phase === "creator" && <Studio />}
      <LoadingScreen />
      <TouchDeviceNotice />
    </div>
  );
}
