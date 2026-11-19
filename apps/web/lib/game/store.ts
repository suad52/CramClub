import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { CameraMode, ZoneId } from "@ovr/shared";

export type Quality = "high" | "balanced" | "low";

/**
 * Where the player is in the session: the title screen over the library, the character
 * studio, the camera swooping in, or walking around.
 */
export type Phase = "title" | "creator" | "entering" | "playing";

export interface Settings {
  /** Radians per pixel of mouse movement, scaled ×1000 for a friendlier slider. */
  mouseSensitivity: number;
  invertY: boolean;
  quality: Quality;
}

interface GameStore {
  /** The scene has rendered its first frames. */
  ready: boolean;
  phase: Phase;
  /** Where to return when the character studio closes. */
  creatorFrom: "title" | "playing";
  cameraMode: CameraMode;
  pointerLocked: boolean;
  /** The browser refused pointer lock (some embedded browsers do); fall back to drag-to-look. */
  pointerLockFailed: boolean;
  /** Shift is held: the mouse cursor is free for clicking UI. */
  cursorFree: boolean;
  /** R toggles walking faster. */
  walkFast: boolean;
  /** Pause/settings menu (opened with Esc). */
  menuOpen: boolean;
  /** Controls guide (shown on first entry). */
  guideOpen: boolean;
  zoneId: ZoneId | null;
  /** Seat the player could sit in right now, if any. */
  nearbySeatId: string | null;
  /** Collaborative table whose whiteboard the player is standing at, if any. */
  nearbyBoardId: string | null;
  /** Seat the player is sitting in, if any. */
  seatId: string | null;
  settings: Settings;
  /** The user has dismissed the controls guide at least once. */
  guideSeen: boolean;

  setReady: (ready: boolean) => void;
  setPhase: (phase: Phase) => void;
  openCreator: (from: "title" | "playing") => void;
  setCameraMode: (mode: CameraMode) => void;
  toggleCameraMode: () => void;
  setPointerLocked: (locked: boolean) => void;
  setPointerLockFailed: (failed: boolean) => void;
  setCursorFree: (free: boolean) => void;
  toggleWalkFast: () => void;
  setMenuOpen: (open: boolean) => void;
  setGuideOpen: (open: boolean) => void;
  setZone: (zone: ZoneId | null) => void;
  setNearbySeat: (seatId: string | null) => void;
  setNearbyBoard: (boardId: string | null) => void;
  setSeat: (seatId: string | null) => void;
  updateSettings: (patch: Partial<Settings>) => void;
}

export const DEFAULT_SETTINGS: Settings = {
  mouseSensitivity: 2.2,
  invertY: false,
  quality: "high",
};

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
      ready: false,
      phase: "title",
      creatorFrom: "title",
      cameraMode: "third-person",
      pointerLocked: false,
      pointerLockFailed: false,
      cursorFree: false,
      walkFast: false,
      menuOpen: false,
      guideOpen: false,
      zoneId: null,
      nearbySeatId: null,
      nearbyBoardId: null,
      seatId: null,
      settings: DEFAULT_SETTINGS,
      guideSeen: false,

      setReady: (ready) => set({ ready }),
      setPhase: (phase) => set({ phase }),
      openCreator: (creatorFrom) => set({ phase: "creator", creatorFrom, menuOpen: false }),
      setCameraMode: (cameraMode) => set({ cameraMode }),
      toggleCameraMode: () =>
        set((s) => ({
          cameraMode: s.cameraMode === "first-person" ? "third-person" : "first-person",
        })),
      setPointerLocked: (pointerLocked) => set({ pointerLocked }),
      setPointerLockFailed: (pointerLockFailed) => set({ pointerLockFailed }),
      setCursorFree: (cursorFree) => set({ cursorFree }),
      toggleWalkFast: () => set((s) => ({ walkFast: !s.walkFast })),
      setMenuOpen: (menuOpen) => set({ menuOpen }),
      setGuideOpen: (guideOpen) =>
        set((s) => ({ guideOpen, guideSeen: s.guideSeen || !guideOpen })),
      setZone: (zoneId) => set({ zoneId }),
      setNearbySeat: (nearbySeatId) => set({ nearbySeatId }),
      setNearbyBoard: (nearbyBoardId) => set({ nearbyBoardId }),
      setSeat: (seatId) => set({ seatId }),
      updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    }),
    {
      name: "ovr.preferences",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // Only durable preferences; live session state always starts fresh.
      partialize: (s) => ({
        cameraMode: s.cameraMode,
        settings: s.settings,
        guideSeen: s.guideSeen,
      }),
    },
  ),
);
