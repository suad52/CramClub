"use client";

import { useEffect, useRef, useState } from "react";
import { IconCamera, IconCheck, IconRefresh } from "@/components/ui/icons";
import { BTN_SM } from "@/components/ui/styles";
import {
  getCameraStream,
  isTrackingActive,
  recalibrate,
  startTracking,
  stopTracking,
  turnCameraOff,
  turnCameraOn,
  type TrackingStatus,
  useTrackingStore,
} from "@/lib/facial-tracking/tracker";
import { deviceOptions, refreshDevices, selectedOption, useDeviceList } from "@/lib/devices/list";
import {
  currentMediaSupport,
  permissionState,
  problemText,
  watchPermission,
} from "@/lib/devices/permissions";
import { useDevicePrefs } from "@/lib/devices/prefs";
import { CheckCard, DevicePicker, Pill, ProblemNote, Purpose, STAGE } from "./parts";

/**
 * The camera check, on the "Before you go in" step and the menu's Camera and microphone panels:
 * what the camera is for, a mirrored live preview from expression tracking's own stream (so going
 * in with it on keeps the very same camera running, with no second permission prompt), how well
 * it can see you, and a picker when there's more than one camera. The camera is optional.
 *
 * `autoStart`: the student chose "on" before, so start it as the check opens (the preview shows,
 * so they can switch it off before going in).
 */
export function CameraCheck({ autoStart = false }: { autoStart?: boolean }) {
  const status = useTrackingStore((s) => s.status);
  const error = useTrackingStore((s) => s.error);
  const calibration = useTrackingStore((s) => s.calibration);
  const choice = useDevicePrefs((s) => s.camera);
  const cameraId = useDevicePrefs((s) => s.cameraId);
  const devices = useDeviceList((s) => s.devices);
  const [support] = useState(currentMediaSupport);
  const [denied, setDenied] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const active = isTrackingActive(status);

  useEffect(() => {
    if (!autoStart || support !== "ok") return;
    const { status: now } = useTrackingStore.getState();
    if (useDevicePrefs.getState().camera === "on" && !isTrackingActive(now)) void startTracking();
  }, [autoStart, support]);

  // The tracker shares its stream as soon as the camera opens (before the face model has loaded,
  // and without telling anyone), so look for it while tracking is on.
  useEffect(() => {
    if (!active) return;
    const sync = () => setStream(getCameraStream());
    sync();
    const id = setInterval(sync, 200);
    // Names and ids only show up once the page may use a camera.
    void refreshDevices();
    return () => clearInterval(id);
  }, [active]);

  // Blocked? Say how to allow it, and start as soon as they do (where the browser reports it).
  useEffect(() => {
    if (status !== "error") return;
    let live = true;
    void permissionState("camera").then((v) => {
      if (live) setDenied(v === "denied");
    });
    const unwatch = watchPermission("camera", (v) => {
      if (v === "granted") void turnCameraOn();
    });
    return () => {
      live = false;
      unwatch();
    };
  }, [status]);

  const live = active ? stream : null;
  const openId = live?.getVideoTracks()[0]?.getSettings().deviceId ?? null;
  const options = deviceOptions(devices, "camera");
  const picked = selectedOption(devices, "camera", openId, cameraId);
  const pick = (id: string) => {
    useDevicePrefs.getState().setCameraId(id);
    stopTracking();
    void startTracking();
  };

  const problem =
    support !== "ok"
      ? problemText(support, "camera")
      : status === "error"
        ? denied
          ? problemText("denied", "camera")
          : (error ?? problemText("other", "camera"))
        : null;

  const pill = active ? (
    <Pill tone="live">On</Pill>
  ) : status === "error" ? (
    <Pill tone="plain">Not working</Pill>
  ) : choice === "off" ? (
    <Pill tone="muted">Off</Pill>
  ) : (
    <Pill tone="muted">Optional</Pill>
  );

  return (
    <CheckCard
      id="check-camera"
      icon={<IconCamera size={22} strokeWidth={2.5} />}
      title="Camera"
      status={pill}
    >
      <Purpose privacy="The video is analysed on this computer and never leaves it.">
        Your character copies your expressions, and your focus time can show you were at your desk.
      </Purpose>

      <div className={`${STAGE} mt-3 ${active ? "bg-walnut" : "border-dashed bg-canvas"}`}>
        {active ? (
          <>
            <Preview stream={live} />
            <FaceStatus status={status} calibration={calibration} />
          </>
        ) : (
          <div className="grid h-full place-items-center px-6 text-center">
            {problem ? (
              <div aria-live="polite" className="w-full">
                <ProblemNote>{problem}</ProblemNote>
              </div>
            ) : (
              <p
                aria-live="polite"
                className="flex flex-col items-center gap-2 font-display text-[15px] font-semibold text-ink-soft"
              >
                <span
                  aria-hidden
                  className="grid h-12 w-12 place-items-center rounded-full border-[2.5px] border-walnut/40 bg-surface text-walnut/60"
                >
                  <IconCamera size={24} strokeWidth={2.25} />
                </span>
                {choice === "off" ? "Your camera stays off" : "Your camera is off"}
              </p>
            )}
          </div>
        )}
      </div>

      {support === "ok" && (
        <div className="mt-3 flex min-h-9 flex-wrap items-center gap-2">
          {active ? (
            <>
              {options.length > 1 && (
                <DevicePicker label="Camera" options={options} value={picked} onChange={pick} />
              )}
              {(status === "tracking" || status === "no-face") && (
                <button type="button" onClick={recalibrate} className={BTN_SM.quiet}>
                  <IconRefresh size={15} strokeWidth={2.5} />
                  Recalibrate
                </button>
              )}
              <button type="button" onClick={turnCameraOff} className={BTN_SM.secondary}>
                Turn off
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void turnCameraOn()}
                className={BTN_SM.secondary}
              >
                {status === "error" ? (
                  <IconRefresh size={15} strokeWidth={2.5} />
                ) : (
                  <IconCamera size={16} strokeWidth={2.5} />
                )}
                {status === "error" ? "Try again" : "Turn camera on"}
              </button>
              <button
                type="button"
                aria-pressed={choice === "off"}
                onClick={turnCameraOff}
                className={BTN_SM.quiet}
              >
                {choice === "off" && <IconCheck size={15} strokeWidth={3} />}
                Keep it off
              </button>
            </>
          )}
        </div>
      )}
    </CheckCard>
  );
}

/** The live camera, mirrored like a mirror. */
function Preview({ stream }: { stream: MediaStream | null }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = video.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    void el.play().catch(() => {});
    return () => {
      el.srcObject = null;
    };
  }, [stream]);
  return (
    <video
      ref={video}
      muted
      playsInline
      aria-label="Your camera, mirrored (it stays on this computer)"
      className="h-full w-full -scale-x-100 object-cover"
    />
  );
}

/** How well it can see you, on a sticker over the preview (spoken when it changes). */
function FaceStatus({ status, calibration }: { status: TrackingStatus; calibration: number }) {
  const [text, dot] =
    status === "starting"
      ? ["Starting your camera…", "bg-sun"]
      : status === "calibrating"
        ? calibration > 0
          ? ["Learning your face, hold still…", "bg-sun"]
          : ["Look at the screen so it can find your face", "bg-sun"]
        : status === "tracking"
          ? ["Got you", "bg-leaf"]
          : ["Can't see your face, try more light", "bg-tangerine"];
  return (
    <div className="absolute inset-x-2.5 bottom-2.5 flex justify-start">
      <p className="max-w-full rounded-[12px] border-2 border-walnut bg-surface px-2.5 py-1 font-display text-[13px] leading-5 font-semibold text-walnut shadow-[0_2px_0_#1f1a16]">
        <span aria-live="polite" className="flex items-center gap-2">
          <span
            aria-hidden
            className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 border-walnut ${dot}`}
          />
          {text}
        </span>
        {status === "calibrating" && calibration > 0 && (
          <span
            aria-hidden
            className="mt-1 block h-2 w-full overflow-hidden rounded-full border-2 border-walnut bg-canvas"
          >
            <span
              className="block h-full bg-leaf transition-[width] duration-150 motion-reduce:transition-none"
              style={{ width: `${Math.round(Math.min(1, calibration) * 100)}%` }}
            />
          </span>
        )}
      </p>
    </div>
  );
}
