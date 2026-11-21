import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Camera and microphone choices, made on the "Before you go in" setup step (components/entry/
 * DeviceSetup.tsx) that every student passes between the title screen and the library, and
 * changeable later from the menu. One source of truth for every part of the app that opens the
 * camera or the microphone:
 *
 *   camera: expression tracking (lib/facial-tracking/tracker.ts), the finger pen
 *           (lib/whiteboard/fingerPen.ts), the face photo (lib/avatar/facePhoto.ts)
 *   mic:    push-to-talk with Ms. Fenwick (components/librarian/PushToTalk.tsx), recording your
 *           voice (components/creator/VoicePanel.tsx)
 *
 * Privacy: only choices and device ids are stored (localStorage, this browser only). Device
 * labels, video and audio never are. The camera is never turned on unless the student said so:
 * `camera: "on"` means they chose it on the setup step (or the menu), and the setup step then
 * starts it for them on later visits, with the preview showing, so they can switch it off before
 * going in.
 *
 * Opening a device: use {@link openMedia}, which asks for the saved device first and falls back to
 * the browser's default when that device is gone (unplugged, or a new computer), forgetting the
 * stale id. A saved id is only a preference, never required.
 */

export type CameraChoice = "on" | "off";
export type MicChoice = "ok" | "skipped";

interface DevicePrefsState {
  /** null until the student has made a choice on the setup step. */
  camera: CameraChoice | null;
  /** null until they tested the microphone ("ok") or chose to skip it ("skipped"). */
  mic: MicChoice | null;
  /** Preferred camera (MediaDeviceInfo.deviceId), or null for the browser's default. */
  cameraId: string | null;
  /** Preferred microphone, or null for the browser's default. */
  micId: string | null;
  /** When they last finished the setup step (ms since epoch), or null if never. */
  setupDoneAt: number | null;
  setCamera: (camera: CameraChoice) => void;
  setMic: (mic: MicChoice) => void;
  setCameraId: (id: string | null) => void;
  setMicId: (id: string | null) => void;
  markSetupDone: () => void;
}

export const useDevicePrefs = create<DevicePrefsState>()(
  persist(
    (set) => ({
      camera: null,
      mic: null,
      cameraId: null,
      micId: null,
      setupDoneAt: null,
      setCamera: (camera) => set({ camera }),
      setMic: (mic) => set({ mic }),
      setCameraId: (cameraId) => set({ cameraId }),
      setMicId: (micId) => set({ micId }),
      markSetupDone: () => set({ setupDoneAt: Date.now() }),
    }),
    {
      name: "ovr.devices",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        camera: s.camera,
        mic: s.mic,
        cameraId: s.cameraId,
        micId: s.micId,
        setupDoneAt: s.setupDoneAt,
      }),
    },
  ),
);

export type MediaKind = "camera" | "mic";

/** Errors that mean "that particular device isn't available", not "permission denied". */
function isMissingDevice(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "OverconstrainedError" || name === "NotFoundError" || name === "NotReadableError";
}

/**
 * getUserMedia for one kind of device, preferring the saved one. `base` holds the caller's own
 * constraints (resolution, echo cancellation…); this adds `deviceId: { exact }` when a device is
 * saved, and if that device can't be opened, tries once more with the browser's default and
 * forgets the saved id. Permission errors (NotAllowedError) are thrown as they are. Must be called
 * from a user action the first time (the browser asks).
 */
export async function openMedia(
  kind: MediaKind,
  base: MediaTrackConstraints = {},
): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("getUserMedia missing"), { name: "NotSupportedError" });
  }
  const prefs = useDevicePrefs.getState();
  const saved = kind === "camera" ? prefs.cameraId : prefs.micId;
  const ask = (track: MediaTrackConstraints) =>
    navigator.mediaDevices.getUserMedia(
      kind === "camera" ? { audio: false, video: track } : { audio: track, video: false },
    );
  if (!saved) return ask(base);
  try {
    return await ask({ ...base, deviceId: { exact: saved } });
  } catch (err) {
    if (!isMissingDevice(err)) throw err;
    if (kind === "camera") prefs.setCameraId(null);
    else prefs.setMicId(null);
    return ask(base);
  }
}
