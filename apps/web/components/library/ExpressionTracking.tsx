"use client";

import { useEffect, useRef, useState } from "react";
import type { FacialParams } from "@ovr/shared";
import { FACE_PREVIEW } from "@/components/world/FacePreview";
import { useFaceTracking } from "@/hooks/useFaceTracking";
import { exitPointerLock } from "@/lib/game/pointer";
import { faceState, useTrackingStore } from "@/lib/facial-tracking/tracker";

function CameraDot() {
  return (
    <span className="relative flex h-2.5 w-2.5" aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-60" />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
    </span>
  );
}

/** HUD button that opens the tracking panel; shows a live dot while the camera is on. */
export function TrackingButton() {
  const { active } = useFaceTracking();
  const open = useTrackingStore((s) => s.panelOpen);
  const setOpen = useTrackingStore((s) => s.setPanelOpen);
  return (
    <button
      type="button"
      onClick={() => {
        exitPointerLock();
        setOpen(!open);
      }}
      aria-expanded={open}
      title="Expression tracking"
      className="pointer-events-auto flex h-10 items-center gap-2 rounded-full bg-cream/90 px-3.5 text-sm font-bold text-ink shadow-md ring-1 ring-ink/10 backdrop-blur transition hover:bg-cream focus-visible:outline-3 focus-visible:outline-ember"
    >
      {active ? <CameraDot /> : <span aria-hidden>🙂</span>}
      <span className="hidden lg:inline">{active ? "Camera on" : "Face"}</span>
      <span className="sr-only">Expression tracking</span>
    </button>
  );
}

const METERS: { key: keyof FacialParams; label: string; signed?: boolean }[] = [
  { key: "headYaw", label: "Turn", signed: true },
  { key: "headPitch", label: "Nod", signed: true },
  { key: "headRoll", label: "Tilt", signed: true },
  { key: "eyeBlinkLeft", label: "Left blink" },
  { key: "eyeBlinkRight", label: "Right blink" },
  { key: "smile", label: "Smile" },
  { key: "jawOpen", label: "Mouth open" },
  { key: "browRaise", label: "Brows" },
];

/** Live bars for the eight tracked values, refreshed ~15 times a second. */
function Meters() {
  const [values, setValues] = useState<FacialParams | null>(null);
  useEffect(() => {
    const id = setInterval(() => setValues(faceState.params ? { ...faceState.params } : null), 66);
    return () => clearInterval(id);
  }, []);
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5" aria-label="Tracked values">
      {METERS.map(({ key, label, signed }) => {
        const v = values?.[key] ?? 0;
        const left = signed ? 50 + Math.min(0, v) * 50 : 0;
        const width = signed ? Math.abs(v) * 50 : v * 100;
        return (
          <li key={key} className="text-[0.7rem] font-bold text-ink-soft">
            <span className="flex justify-between">
              {label}
              <span className="tabular-nums">{v.toFixed(2)}</span>
            </span>
            <span className="relative mt-0.5 block h-1.5 overflow-hidden rounded-full bg-ink/10">
              {signed && <span className="absolute top-0 left-1/2 h-full w-px bg-ink/25" />}
              <span
                className="absolute top-0 h-full rounded-full bg-sage"
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SelfView() {
  const { getCameraStream, status } = useFaceTracking();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    const stream = getCameraStream();
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [getCameraStream, status]);
  return (
    <video
      ref={video}
      muted
      playsInline
      aria-label="Your camera (stays on this device)"
      className="aspect-[4/3] w-full -scale-x-100 rounded-xl bg-ink/80 object-cover"
    />
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm font-bold">
      {label}
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4.5 w-4.5 accent-[var(--color-wood)]"
      />
    </label>
  );
}

/** The opt-in panel: explains what happens, starts/stops the camera and shows live feedback. */
export function TrackingPanel() {
  const open = useTrackingStore((s) => s.panelOpen);
  const setOpen = useTrackingStore((s) => s.setPanelOpen);
  const mirror = useTrackingStore((s) => s.mirror);
  const setMirror = useTrackingStore((s) => s.setMirror);
  const showFaceView = useTrackingStore((s) => s.showFaceView);
  const setShowFaceView = useTrackingStore((s) => s.setShowFaceView);
  const [showCamera, setShowCamera] = useState(true);
  const { status, error, calibration, active, start, stop, recalibrate } = useFaceTracking();
  if (!open) return null;

  return (
    <section
      aria-labelledby="tracking-title"
      className="pointer-events-auto absolute top-18 right-4 z-[15] w-80 rounded-3xl bg-cream/95 p-5 text-ink shadow-[0_20px_50px_-20px_rgb(20_12_6/0.6)] ring-1 ring-ink/10 backdrop-blur"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 id="tracking-title" className="font-display text-lg leading-tight font-semibold">
            Expression tracking
          </h2>
          <span className="text-[0.68rem] font-extrabold tracking-wide text-ember uppercase">
            Prototype · only you see it for now
          </span>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="-mt-1 -mr-1 rounded-full px-2 py-1 text-lg leading-none text-ink-soft hover:bg-ink/5"
          aria-label="Close"
        >
          ×
        </button>
      </header>

      {!active && (
        <div className="mt-3 space-y-3 text-sm">
          <p className="text-ink-soft">
            Your avatar copies your head movement, blinks, smile, mouth and eyebrows. Your camera is
            analysed on this device and the video is never uploaded or saved.
          </p>
          {error && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-[0.8rem] text-red-800 ring-1 ring-red-200">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void start()}
            className="w-full rounded-full bg-ink px-4 py-2.5 font-bold text-cream transition hover:bg-wood-dark"
          >
            {error ? "Try again" : "Turn on camera"}
          </button>
        </div>
      )}

      {active && (
        <div className="mt-3 space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold">
            <CameraDot />
            {status === "starting" && "Starting camera and face model…"}
            {status === "calibrating" && "Look at the screen with a relaxed face…"}
            {status === "tracking" && "Tracking your expressions"}
            {status === "no-face" &&
              "Can't see your face. Face the camera with light in front of you."}
          </div>
          {status === "calibrating" && (
            <span className="block h-1.5 overflow-hidden rounded-full bg-ink/10">
              <span
                className="block h-full rounded-full bg-ember transition-[width]"
                style={{ width: `${Math.round(calibration * 100)}%` }}
              />
            </span>
          )}
          {showCamera && status !== "starting" && <SelfView />}
          {(status === "tracking" || status === "no-face") && <Meters />}
          <div className="space-y-2 border-t border-ink/10 pt-3">
            <Toggle label="Show my camera here" checked={showCamera} onChange={setShowCamera} />
            <Toggle
              label="Show my avatar's face"
              checked={showFaceView}
              onChange={setShowFaceView}
            />
            <Toggle label="Mirror my movements" checked={mirror} onChange={setMirror} />
          </div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={recalibrate}
              disabled={status === "starting"}
              className="rounded-full bg-parchment px-3 py-2 text-sm font-bold ring-1 ring-ink/10 hover:ring-ink/30 disabled:opacity-50"
            >
              Recalibrate
            </button>
            <button
              type="button"
              onClick={stop}
              className="rounded-full bg-ink px-3 py-2 text-sm font-bold text-cream hover:bg-wood-dark"
            >
              Turn off camera
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** Frame and label drawn over the in-canvas face preview. */
export function FaceViewFrame() {
  const { active } = useFaceTracking();
  const showFaceView = useTrackingStore((s) => s.showFaceView);
  if (!active || !showFaceView) return null;
  const { size, margin } = FACE_PREVIEW;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute z-[6] rounded-2xl ring-4 ring-cream/90 shadow-lg"
      style={{ width: size, height: size, right: margin, bottom: margin }}
    >
      <span className="absolute -top-3 left-3 rounded-full bg-cream px-2 py-0.5 text-[0.68rem] font-extrabold text-ink shadow">
        Your avatar
      </span>
    </div>
  );
}
