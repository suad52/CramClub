"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { IconCamera, IconCheck, IconRefresh, IconTrash } from "@/components/ui/icons";
import { BTN, BTN_SM, FOCUS, PANEL_MUTED, TAG } from "@/components/ui/styles";
import {
  FACE_GUIDE_FRACTION,
  type FaceCamera,
  type HeadSettings,
  closeFaceFinder,
  describeCameraError,
  facePhotoFromFrame,
  grabFrame,
  loadFaceFinder,
  openFaceCamera,
} from "@/lib/avatar/facePhoto";
import { getCameraStream } from "@/lib/facial-tracking/tracker";
import { PICK, PICK_ON, SectionTitle, SelectedMark } from "./ui";

type Phase = "idle" | "starting" | "camera" | "busy" | "error";

/** A big choice tile (chibi head or real face), styled like the studio's option tiles. */
function ChoiceTile({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`relative flex flex-col rounded-[16px] border-[2.5px] p-1.5 text-left ${PICK} ${FOCUS} ${selected ? PICK_ON : "border-walnut/20 bg-surface hover:-translate-y-0.5 hover:border-walnut hover:shadow-[0_3px_0_#1f1a16]"}`}
    >
      <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-[11px] bg-canvas">
        {children}
      </span>
      <span className="block truncate px-1 pt-1.5 pb-0.5 font-display text-[13.5px] leading-4 font-semibold text-walnut">
        {label}
      </span>
      {selected && <SelectedMark className="absolute -top-1.5 -right-1.5" />}
    </button>
  );
}

/** A chunky checkbox drawn after a `peer sr-only` input (the menu sheet's style). */
function CheckBox() {
  return (
    <span
      aria-hidden
      className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border-[2.5px] border-walnut bg-white text-transparent shadow-[0_2px_0_#1f1a16] transition-[background-color,color,transform] duration-150 peer-checked:bg-leaf peer-checked:text-walnut peer-focus-visible:ring-4 peer-focus-visible:ring-sun peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-walnut peer-active:translate-y-px motion-reduce:transition-none"
    >
      <IconCheck size={17} strokeWidth={3.25} />
    </span>
  );
}

/** The photo as the avatar wears it: a circle with a thick walnut outline. */
function RoundPhoto({ src, size }: { src: string; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a local data URL
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      draggable={false}
      className="rounded-full border-[4px] border-walnut bg-canvas object-cover shadow-[0_4px_0_#1f1a16]"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The studio's Head panel: chibi head or "my real face". Taking a photo opens the webcam (only
 * on that click), shows a mirrored preview with a round guide, grabs one frame, closes the
 * camera at once, then finds and crops the face on this device.
 */
export function HeadPanel({
  value,
  onChange,
  chibiThumb,
}: {
  value: HeadSettings;
  onChange: (head: HeadSettings) => void;
  /** Thumbnail of the chibi head (the current hairstyle's render). */
  chibiThumb: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<boolean | null>(null);
  const camera = useRef<FaceCamera | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const alive = useRef(true);
  const id = useId();
  const face = value.headMode === "face";

  const stopCamera = useCallback(() => {
    camera.current?.release();
    camera.current = null;
    if (video.current) video.current.srcObject = null;
  }, []);

  // Leaving the panel (or the studio) always turns the camera off and frees the face model.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopCamera();
      closeFaceFinder();
    };
  }, [stopCamera]);

  // Show the camera in the preview once it's open.
  useEffect(() => {
    const el = video.current;
    const cam = camera.current;
    if (phase !== "camera" || !el || !cam) return;
    el.srcObject = cam.stream;
    void el.play().catch(() => {});
    el.scrollIntoView({ block: "nearest" });
  }, [phase]);

  const start = async () => {
    setError(null);
    setFound(null);
    setPhase("starting");
    try {
      const cam = await openFaceCamera(getCameraStream());
      if (!alive.current) return cam.release();
      camera.current = cam;
      setPhase("camera");
      // Warm the face finder while the player lines up.
      void loadFaceFinder();
    } catch (err) {
      if (!alive.current) return;
      setError(describeCameraError(err));
      setPhase("error");
    }
  };

  const cancel = () => {
    stopCamera();
    setPhase("idle");
  };

  const capture = async () => {
    const el = video.current;
    if (!el) return;
    let frame: HTMLCanvasElement;
    try {
      frame = grabFrame(el);
    } catch {
      return; // No picture yet; the button stays available.
    }
    stopCamera();
    setPhase("busy");
    const result = await facePhotoFromFrame(frame);
    frame.width = frame.height = 0;
    if (!alive.current) return;
    setFound(result.found);
    setPhase("idle");
    onChange({ ...value, headMode: "face", facePhoto: result.photo });
  };

  const choose = (headMode: HeadSettings["headMode"]) => {
    if (headMode === "chibi") cancel();
    onChange({ ...value, headMode });
  };

  const guideInset = `${((1 - FACE_GUIDE_FRACTION) / 2) * 100}%`;

  return (
    <div className="space-y-7">
      <section>
        <SectionTitle aside={face ? "My real face" : "Chibi head"}>Your head</SectionTitle>
        <div role="group" aria-label="Your head" className="grid grid-cols-2 gap-2.5">
          <ChoiceTile label="Chibi head" selected={!face} onSelect={() => choose("chibi")}>
            {/* eslint-disable-next-line @next/next/no-img-element -- local, pre-sized thumbnail */}
            <img
              src={chibiThumb}
              alt=""
              width={224}
              height={224}
              draggable={false}
              className="h-full w-full object-cover"
            />
          </ChoiceTile>
          <ChoiceTile label="My real face" selected={face} onSelect={() => choose("face")}>
            {value.facePhoto ? (
              <RoundPhoto src={value.facePhoto} size={104} />
            ) : (
              <span className="grid h-[104px] w-[104px] place-items-center rounded-full border-[3px] border-dashed border-walnut/40 text-walnut/70">
                <IconCamera size={34} />
              </span>
            )}
          </ChoiceTile>
        </div>
      </section>

      {face && (
        <section aria-labelledby={`${id}-photo`}>
          <SectionTitle aside={value.facePhoto ? "Ready" : "Not taken yet"}>
            <span id={`${id}-photo`}>Your photo</span>
          </SectionTitle>

          {(phase === "camera" || phase === "starting") && (
            <div className="space-y-3">
              <div className="relative aspect-square w-full overflow-hidden rounded-[20px] border-[3px] border-walnut bg-walnut shadow-[0_4px_0_#1f1a16]">
                <video
                  ref={video}
                  muted
                  playsInline
                  aria-label="Your camera, mirrored (stays on this device)"
                  className="h-full w-full -scale-x-100 object-cover"
                />
                {/* Round face guide; everything outside it is dimmed. */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute rounded-full border-[3px] border-dashed border-surface shadow-[0_0_0_999px_rgb(31_26_22/0.5)]"
                  style={{ inset: guideInset }}
                />
                <span className={`${TAG.forest} absolute top-2.5 left-2.5`}>
                  <span aria-hidden className="mr-1.5 h-2 w-2 rounded-full bg-walnut" />
                  Camera on
                </span>
                {phase === "starting" && (
                  <span className="absolute inset-0 grid place-items-center font-display text-[14px] font-semibold text-walnut-text">
                    Starting the camera…
                  </span>
                )}
              </div>
              <p className="text-[13px] leading-5 font-medium text-ink-soft">
                Line your face up with the circle, then take the photo. The camera turns off right
                after.
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void capture()}
                  disabled={phase !== "camera"}
                  className={BTN.primary}
                >
                  <IconCamera size={18} />
                  Take photo
                </button>
                <button type="button" onClick={cancel} className={BTN.secondary}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {phase === "busy" && (
            <div className={`${PANEL_MUTED} grid place-items-center gap-3 px-4 py-8`}>
              <span
                aria-hidden
                className="h-9 w-9 rounded-full border-4 border-walnut/15 border-t-tangerine motion-safe:animate-spin"
              />
              <p role="status" className="font-display text-[14px] font-semibold text-walnut">
                Finding your face…
              </p>
            </div>
          )}

          {(phase === "idle" || phase === "error") && value.facePhoto && (
            <div className="space-y-3">
              <div className="grid place-items-center rounded-[20px] bg-canvas py-5">
                <RoundPhoto src={value.facePhoto} size={168} />
              </div>
              {found === false && (
                <p role="status" className="text-[13px] leading-5 font-medium text-ink-soft">
                  We couldn&apos;t spot a face, so we used the circle. Retake for a closer crop.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void start()} className={BTN_SM.secondary}>
                  <IconRefresh size={16} />
                  Retake
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFound(null);
                    onChange({ ...value, facePhoto: null });
                  }}
                  className={BTN_SM.quiet}
                >
                  <IconTrash size={16} />
                  Remove
                </button>
              </div>
            </div>
          )}

          {(phase === "idle" || phase === "error") && !value.facePhoto && (
            <div className={`${PANEL_MUTED} space-y-3 p-4`}>
              <p className="text-[14px] leading-6 font-medium text-walnut">
                Take a quick photo and your avatar wears your face on a round cartoon head.
              </p>
              <p className="text-[13px] leading-5 text-ink-soft">
                Your camera only turns on when you press the button. The photo stays on this device;
                nothing is uploaded. Until you take one, you keep the chibi head.
              </p>
              <button type="button" onClick={() => void start()} className={BTN.primary}>
                <IconCamera size={18} />
                Take a photo
              </button>
            </div>
          )}

          {phase === "error" && error && (
            <p
              role="alert"
              className="mt-3 rounded-[14px] border-2 border-danger/40 bg-[#fbe9e5] px-3 py-2 text-[13px] leading-5 font-semibold text-danger"
            >
              {error}
            </p>
          )}
        </section>
      )}

      {face && (
        <section>
          <SectionTitle>Live camera</SectionTitle>
          <label className="relative flex min-h-12 cursor-pointer items-center justify-between gap-4 py-1">
            <span className="min-w-0">
              <span
                id={`${id}-live`}
                className="block font-display text-[14.5px] leading-5 font-semibold text-walnut"
              >
                Use my live camera when face tracking is on
              </span>
              <span
                id={`${id}-live-hint`}
                className="mt-0.5 block text-[13px] leading-5 text-ink-soft"
              >
                While expression tracking runs, your head shows your camera live instead of the
                photo. It never leaves this device.
              </span>
            </span>
            <input
              type="checkbox"
              checked={value.liveFace}
              onChange={(e) => onChange({ ...value, liveFace: e.target.checked })}
              aria-labelledby={`${id}-live`}
              aria-describedby={`${id}-live-hint`}
              className="peer sr-only"
            />
            <CheckBox />
          </label>
          <p className="mt-3 text-[13px] leading-5 text-ink-soft">
            With your real face on, the Face, Eyes, Brows, Mouth, Hair and Details choices and
            anything worn on the head are tucked away. They come back with the chibi head.
          </p>
        </section>
      )}
    </div>
  );
}
