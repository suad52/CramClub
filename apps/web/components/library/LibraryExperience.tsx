"use client";

import { Canvas } from "@react-three/fiber";
import Link from "next/link";
import { NeutralToneMapping } from "three";
import { useEffect, useState } from "react";
import { SPAWN_POINTS } from "@ovr/shared";
import { CharacterStudio } from "@/components/creator/CharacterStudio";
import { DeviceSetup, DevicesOverlay } from "@/components/entry/DeviceSetup";
import { TitleScreen } from "@/components/entry/TitleScreen";
import { DemoLayer } from "@/components/demo/DemoLayer";
import { BTN, PANEL, RIBBON } from "@/components/ui/styles";
import { LibraryScene } from "@/components/world/LibraryScene";
import { useProfileStore } from "@/lib/avatar/profile";
import { exitPointerLock } from "@/lib/game/pointer";
import { watchTableAccess } from "@/lib/game/tableAccess";
import { startMultiplayer, useNet } from "@/lib/net/connection";
import * as chatStore from "@/lib/chat/store";
import { remoteLive, useRemotePlayers } from "@/lib/net/players";
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
import { LibrarianOverlay } from "./LibrarianOverlay";
import { StudioBook } from "./StudioBook";
import { ProgressOverlay } from "./ProgressOverlay";
import { TableHoldLayer } from "./TableHold";
import { librarianPresence } from "@/lib/librarian/presence";
import { useFocusStore } from "@/lib/focus/store";
import { focusSession } from "@/lib/focus/session";
import { useDemo } from "@/lib/demo/mode";

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
    <div className="fixed inset-0 grid place-items-center bg-canvas p-6">
      <div className={`${PANEL} title-pop relative max-w-md p-8 pt-9 text-center`}>
        <span
          aria-hidden
          className={`${RIBBON} absolute -top-4 left-1/2 -translate-x-1/2 -rotate-2`}
        >
          Uh oh
        </span>
        <h1 className="font-display text-[28px] leading-tight font-bold text-walnut">{title}</h1>
        <p className="mt-3 font-medium text-ink-soft">{body}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className={BTN.primary}>
            Try again
          </button>
          <Link href="/librarian" className={BTN.secondary}>
            Ask the Librarian instead
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
        // A brand-new character goes on to the camera and microphone check, then in; edits
        // return to where you were.
        useGameStore.getState().setPhase(firstTime ? "setup" : from);
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
  const creatorFrom = useGameStore((s) => s.creatorFrom);
  const sceneReady = useGameStore((s) => s.ready);
  // In the library (walking in, walking around, or restyling from there): others see you, and
  // you them. Not on the title screen or a first visit's character studio. (`ready` is reset on
  // every visit, so a previous visit's phase never connects early.)
  const inLibrary =
    sceneReady &&
    (phase === "entering" ||
      phase === "playing" ||
      (phase === "creator" && creatorFrom === "playing"));

  useEffect(() => {
    if (!inLibrary) return;
    return startMultiplayer();
  }, [inLibrary]);
  // The table you sit at can go private under you: stand up (calmly) when it does.
  useEffect(() => watchTableAccess(), []);

  useEffect(() => {
    // Fresh session state every time someone walks in.
    const spawn = SPAWN_POINTS[Math.floor(Math.random() * SPAWN_POINTS.length)]!;
    resetRuntime(spawn);
    const s = useGameStore.getState();
    s.setReady(false);
    s.setSeat(null);
    s.setNearbySeat(null);
    s.setNearbyBoard(null);
    s.setNearbyLibrarian(false);
    s.setMenuOpen(false);
    // Closed without marking it seen (setGuideOpen(false) does that): the swoop opens it for a
    // first visit (CameraRig).
    useGameStore.setState({ guideOpen: false });
    s.setProgressOpen(false);
    s.setLibrarianOpen(false);
    s.setDevicesOpen(false);
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
        focus: { store: useFocusStore, session: focusSession },
        demo: useDemo,
        librarian: librarianPresence,
        net: { useNet, remoteLive, useRemotePlayers },
        chat: chatStore,
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
        body="Cram Club needs WebGL 2, which this browser or device doesn't support. Try a recent version of Chrome, Edge, Firefox or Safari on a computer."
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
        aria-label="3D view of the Cram Club library"
      >
        <LibraryScene />
      </Canvas>
      <ClickToLook />
      <Hud />
      <BoardLessonsLayer />
      <PomodoroLayer />
      <TableHoldLayer />
      {/* The judge demo's ribbon and controls (nothing unless demo mode is on for this tab). */}
      <DemoLayer />
      <FaceViewFrame />
      <TrackingPanel />
      <WhiteboardPanel />
      <PauseMenu />
      <ProgressOverlay />
      <LibrarianOverlay />
      <StudioBook />
      <ControlsGuide />
      <DevicesOverlay />
      <TitleScreen />
      <DeviceSetup />
      {phase === "creator" && <Studio />}
      <LoadingScreen />
      <TouchDeviceNotice />
    </div>
  );
}
