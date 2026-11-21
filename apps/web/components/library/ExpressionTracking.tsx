"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FacialParams } from "@ovr/shared";
import {
  IconCamera,
  IconCheck,
  IconClose,
  IconInfo,
  IconRefresh,
  IconWarning,
} from "@/components/ui/icons";
import { BODY, BTN, HUD_BTN, ICON_BTN, PANEL, TAG } from "@/components/ui/styles";
import { FACE_PREVIEW } from "@/components/world/FacePreview";
import { useFaceTracking } from "@/hooks/useFaceTracking";
import { exitPointerLock } from "@/lib/game/pointer";
import { faceState, useTrackingStore } from "@/lib/facial-tracking/tracker";

/** The "camera is live" light: a steady red dot (always next to words that say so). */
export function CameraDot() {
  return (
    <span
      className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-walnut bg-red-500"
      aria-hidden
    />
  );
}

/**
 * A chunky checkbox: the real input goes first, visually hidden with `peer sr-only`, then this box.
 * Put both inside a `relative` label. Also used by the menu sheet's mouse settings.
 */
export function CheckBox() {
  return (
    <span
      aria-hidden
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border-[2.5px] border-walnut bg-white text-transparent shadow-[0_2px_0_#1f1a16] transition-[background-color,color,transform] duration-150 peer-checked:bg-leaf peer-checked:text-walnut peer-focus-visible:ring-4 peer-focus-visible:ring-sun peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-walnut peer-active:translate-y-px motion-reduce:transition-none"
    >
      <IconCheck size={17} strokeWidth={3.25} />
    </span>
  );
}

/**
 * While the camera is on, a small chip next to the HUD's Menu says so, for privacy; clicking it
 * opens (or closes) the tracking panel. With the camera off, tracking starts from the menu's
 * "Camera and face" row instead, so the HUD stays quiet.
 */
export function CameraOnChip() {
  const { active } = useFaceTracking();
  const open = useTrackingStore((s) => s.panelOpen);
  const setOpen = useTrackingStore((s) => s.setPanelOpen);
  if (!active) return null;
  return (
    <button
      type="button"
      onClick={() => {
        exitPointerLock();
        setOpen(!open);
      }}
      aria-expanded={open}
      title="Your camera is on for expression tracking"
      className={`${HUD_BTN} pointer-events-auto h-10 active:bg-walnut`}
    >
      <CameraDot />
      Camera on
      <span className="sr-only">: expression tracking settings</span>
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
    <ul className="grid grid-cols-2 gap-x-5 gap-y-2.5" aria-label="Tracked values">
      {METERS.map(({ key, label, signed }) => {
        const v = values?.[key] ?? 0;
        const left = signed ? 50 + Math.min(0, v) * 50 : 0;
        const width = signed ? Math.abs(v) * 50 : v * 100;
        return (
          <li key={key} className="font-display text-xs leading-4 font-semibold text-ink-soft">
            <span className="flex justify-between gap-2">
              {label}
              <span className="tabular text-walnut">{v.toFixed(2)}</span>
            </span>
            <span className="relative mt-1 block h-3 overflow-hidden rounded-full border-2 border-walnut bg-canvas">
              <span
                className={`absolute top-0 h-full ${signed ? "bg-sun" : "rounded-r-full bg-leaf"}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
              {signed && (
                <span className="absolute top-0 left-1/2 h-full w-0.5 -translate-x-1/2 bg-walnut" />
              )}
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
      className="aspect-[4/3] w-full -scale-x-100 rounded-[18px] border-[3px] border-walnut bg-walnut object-cover shadow-[0_4px_0_#1f1a16]"
    />
  );
}

/**
 * One setting: what it is, a line on what it does, and its checkbox (styled like the menu sheet's).
 * The whole row toggles it; its name is the label alone, the line under it its description.
 */
function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const id = useId();
  return (
    <label className="relative flex min-h-12 cursor-pointer items-center justify-between gap-4 py-2.5">
      <span className="min-w-0">
        <span
          id={`${id}-label`}
          className="block font-display text-[14.5px] leading-5 font-semibold text-walnut"
        >
          {label}
        </span>
        {hint && (
          <span id={`${id}-hint`} className="mt-0.5 block text-[13px] leading-5 text-ink-soft">
            {hint}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby={`${id}-label`}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className="peer sr-only"
      />
      <CheckBox />
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
  const headLook = useTrackingStore((s) => s.headLook);
  const setHeadLook = useTrackingStore((s) => s.setHeadLook);
  const setShowFaceView = useTrackingStore((s) => s.setShowFaceView);
  const [showCamera, setShowCamera] = useState(true);
  const { status, error, calibration, active, start, stop, recalibrate } = useFaceTracking();
  if (!open) return null;

  return (
    <section
      aria-labelledby="tracking-title"
      className={`${PANEL} pointer-events-auto absolute top-18 right-4 z-[15] max-h-[calc(100dvh-5.5rem)] w-[22rem] max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain p-5 text-walnut transition duration-200 ease-out starting:-translate-y-1.5 starting:opacity-0 motion-reduce:transition-none sm:p-6`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="tracking-title"
            className="flex flex-wrap items-center gap-x-2.5 gap-y-1 font-display text-[23px] leading-tight font-bold text-walnut"
          >
            Camera and face
            <span aria-hidden className={`${TAG.brass} -rotate-3 shadow-[0_2px_0_#1f1a16]`}>
              Prototype
            </span>
          </h2>
          <p className="mt-1.5 text-[13px] leading-5 font-medium text-ink-soft">
            Expression tracking is a prototype. Only you see it for now.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className={`${ICON_BTN} -mt-1.5 -mr-2`}
          aria-label="Close"
        >
          <IconClose size={18} />
        </button>
      </header>

      {!active && (
        <div className="mt-5 space-y-4">
          <p className={BODY}>
            Your avatar copies your head movement, blinks, smile, mouth and eyebrows.
          </p>
          <p className="flex gap-2.5 rounded-[16px] border-2 border-walnut/25 bg-canvas px-3 py-2.5 text-[13px] leading-5 font-medium text-walnut">
            <IconInfo size={18} strokeWidth={2.25} className="mt-px text-walnut" />
            <span>
              Your camera is analysed on this device. The video is never uploaded or saved, and the
              camera only turns on when you choose.
            </span>
          </p>
          {error && (
            <p className="flex gap-2.5 rounded-[16px] border-[2.5px] border-danger bg-[#fbe9e5] px-3 py-2.5 text-[13px] leading-5 font-semibold text-danger shadow-[0_3px_0_#a9504a]">
              <IconWarning size={18} strokeWidth={2.25} className="mt-px" />
              <span>{error}</span>
            </p>
          )}
          <button type="button" onClick={() => void start()} className={`${BTN.primary} w-full`}>
            <IconCamera size={18} />
            {error ? "Try again" : "Turn on camera"}
          </button>
        </div>
      )}

      {active && (
        <div className="mt-5 space-y-4">
          <div className="flex items-center gap-2 font-display text-[14.5px] leading-5 font-semibold text-walnut">
            <CameraDot />
            {status === "starting" && "Starting camera and face model…"}
            {status === "calibrating" && "Look at the screen with a relaxed face…"}
            {status === "tracking" && "Tracking your expressions"}
            {status === "no-face" &&
              "Can't see your face. Face the camera with light in front of you."}
          </div>
          {status === "calibrating" && (
            <span className="block h-4 overflow-hidden rounded-full border-[2.5px] border-walnut bg-canvas shadow-[0_2px_0_#1f1a16]">
              <span
                className="block h-full rounded-r-full bg-sun transition-[width] duration-150 motion-reduce:transition-none"
                style={{ width: `${Math.round(calibration * 100)}%` }}
              />
            </span>
          )}
          {showCamera && status !== "starting" && (
            <div>
              <SelfView />
              <p className="mt-2 text-xs leading-4 font-medium text-ink-soft">
                Only you see this preview. The video stays on this device.
              </p>
            </div>
          )}
          {(status === "tracking" || status === "no-face") && <Meters />}
          <div className="divide-y-2 divide-walnut/10 rounded-[18px] border-2 border-walnut/25 bg-canvas px-3.5">
            <Toggle
              label="Show my camera here"
              hint="A small preview in this panel."
              checked={showCamera}
              onChange={setShowCamera}
            />
            <Toggle
              label="Show my avatar's face"
              hint="A close-up of your avatar in the corner of the view."
              checked={showFaceView}
              onChange={setShowFaceView}
            />
            <Toggle
              label="Mirror my movements"
              hint="Your avatar moves like your reflection."
              checked={mirror}
              onChange={setMirror}
            />
            <Toggle
              label="Look around with my head"
              hint="Turning your head turns your view of the library too."
              checked={headLook}
              onChange={setHeadLook}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={recalibrate}
              disabled={status === "starting"}
              className={BTN.secondary}
            >
              <IconRefresh size={16} />
              Recalibrate
            </button>
            <button type="button" onClick={stop} className={BTN.primary}>
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
      className="pointer-events-none absolute z-[6] rounded-[16px] shadow-[0_8px_0_rgb(0_0_0/0.45)] ring-4 ring-black/80"
      style={{ width: size, height: size, right: margin, bottom: margin }}
    >
      <span className="absolute -top-4 left-3 -rotate-2 rounded-full border-[2.5px] border-black/80 bg-tangerine px-2.5 py-0.5 font-display text-xs leading-4 font-semibold text-walnut shadow-[0_2px_0_rgb(0_0_0/0.55)]">
        Your avatar
      </span>
    </div>
  );
}
