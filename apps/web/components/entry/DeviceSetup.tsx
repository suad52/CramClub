"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { CameraCheck } from "@/components/devices/CameraCheck";
import { MicCheck } from "@/components/devices/MicCheck";
import { trapTab } from "@/components/library/ProgressOverlay";
import { IconArrowLeft, IconArrowRight, IconCheck } from "@/components/ui/icons";
import { BTN } from "@/components/ui/styles";
import { watchDevices } from "@/lib/devices/list";
import { stopMicTest } from "@/lib/devices/micTest";
import { useDevicePrefs } from "@/lib/devices/prefs";
import { useDemo } from "@/lib/demo/mode";
import { isTrackingActive, stopTracking, useTrackingStore } from "@/lib/facial-tracking/tracker";
import { requestPointerLock } from "@/lib/game/pointer";
import { useGameStore } from "@/lib/game/store";

/**
 * "Before you go in": the camera and microphone check every student passes between the title
 * screen (or a first visit's Character Studio) and the library, like a video call's pre-join
 * screen, drawn over the library's orbit shot. Both are optional and nothing here ever stops
 * anyone going in. Remembered choices make it one key press: Enter goes in, Esc goes back.
 *
 * Going in with the camera on keeps expression tracking running into the world (the same camera,
 * no second prompt); with it off, it is stopped. The microphone test always lets the microphone
 * go first. In the world, the menu's "Camera and microphone" opens the same checks as an overlay
 * ({@link DevicesOverlay}) with Done instead of Go in.
 */
export function DeviceSetup() {
  const ready = useGameStore((s) => s.ready);
  const phase = useGameStore((s) => s.phase);
  // Stays up (fading) while the camera swoops in after Go in, but only if it was showing.
  const [shown, setShown] = useState(false);
  if (phase === "setup" && !shown) setShown(true);
  if (phase !== "setup" && phase !== "entering" && shown) setShown(false);
  if (!ready || !shown) return null;
  return <SetupScreen leaving={phase !== "setup"} />;
}

/**
 * Go in: let the microphone go, keep the camera only if it's on, and swoop into the library, in
 * first person. Go in is a click or Enter, a user gesture, so the mouse is captured right here:
 * the student can walk and look around the moment the swoop lands, with no "Click to look
 * around" first. Mouse-look waits for "playing" (CameraRig), so the swoop itself isn't steered.
 * If the browser refuses, the click-to-look sticker shows as before (quiet: no drag-look switch).
 */
function goIn() {
  stopMicTest();
  if (!isTrackingActive(useTrackingStore.getState().status)) stopTracking();
  useDevicePrefs.getState().markSetupDone();
  const game = useGameStore.getState();
  // Every visit starts looking out of your own eyes (V still switches to third person).
  game.setCameraMode("first-person");
  game.setPhase("entering");
  requestPointerLock({ quiet: true });
}

/** Back to the title screen, with the camera and microphone off (the choices are kept). */
function backToTitle() {
  stopMicTest();
  stopTracking();
  useGameStore.getState().setPhase("title");
}

function SetupScreen({ leaving }: { leaving: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  // Read once: a camera chosen "on" before starts by itself as the step opens.
  const [autoStart] = useState(() => useDevicePrefs.getState().camera === "on");
  // The demo's "Demo mode" ribbon sits where the "Quick check" sticker does.
  const demo = useDemo((d) => d.on);
  useDialogKeys(box, !leaving, goIn, backToTitle);

  return (
    <div
      className={`absolute inset-0 z-30 font-display transition-opacity duration-500 motion-reduce:transition-none ${leaving ? "pointer-events-none opacity-0" : "opacity-100"}`}
    >
      {/* Darker at the edges so the cards read over the scene, as on the title screen. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_45%,rgb(28_18_12/0.35)_20%,rgb(28_18_12/0.78)_100%)]"
      />
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
        aria-describedby="setup-desc"
        className="relative flex h-full w-full flex-col items-center overflow-y-auto px-8 py-[clamp(1rem,4vh,2.5rem)] outline-none"
      >
        <div className="my-auto flex w-full max-w-[66rem] flex-col">
          <header className="title-pop text-center" style={{ animationDelay: "40ms" }}>
            <p
              aria-hidden={demo || undefined}
              className={`${demo ? "invisible" : ""} inline-flex -rotate-2 items-center gap-2 rounded-full border-[3px] border-walnut bg-lamp px-4 py-1 text-[14px] font-semibold text-walnut shadow-[0_4px_0_#1f1a16]`}
            >
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-tangerine"
              />
              Quick check
            </p>
            <h1
              id="setup-title"
              className="mt-3 text-[clamp(2.4rem,4.6vw,3.6rem)] leading-[1] font-bold tracking-tight text-cream [paint-order:stroke_fill] [text-shadow:0_6px_0_#1f1a16] [-webkit-text-stroke:8px_#1f1a16]"
            >
              Before you go in
            </h1>
            <p
              id="setup-desc"
              className="mx-auto mt-3 max-w-xl font-sans text-[16px] leading-snug font-semibold text-cream/90 [text-shadow:0_2px_0_#1f1a16]"
            >
              Like before a video call: check your camera and microphone. Both are optional.
            </p>
          </header>

          <Checks autoStart={autoStart} className="mt-[clamp(1rem,3vh,1.75rem)]" />

          <footer
            className="title-pop mt-[clamp(1rem,3vh,1.75rem)] flex items-center gap-4"
            style={{ animationDelay: "260ms" }}
          >
            <button type="button" onClick={backToTitle} className={BTN.secondary}>
              <IconArrowLeft size={17} strokeWidth={2.75} />
              Back
              <kbd className="kbd ml-0.5" aria-hidden>
                Esc
              </kbd>
            </button>
            <p className="min-w-0 flex-1 text-center font-sans text-[14px] leading-5 font-semibold text-cream/85 [text-shadow:0_2px_0_#1f1a16]">
              Change these any time from the menu (Esc):{" "}
              <span className="text-lamp">Camera and microphone</span>
            </p>
            <button type="button" onClick={goIn} className={`${BTN.primary} h-12 px-6 text-[17px]`}>
              Go in
              <IconArrowRight size={18} strokeWidth={2.75} />
              <kbd className="kbd ml-0.5" aria-hidden>
                Enter
              </kbd>
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}

/** The two checks side by side (the device lists stay current while they're up). */
function Checks({ autoStart, className = "" }: { autoStart: boolean; className?: string }) {
  useEffect(() => watchDevices(), []);
  return (
    <div className={`grid grid-cols-1 gap-6 md:grid-cols-2 ${className}`}>
      <Pop delay={120}>
        <CameraCheck autoStart={autoStart} />
      </Pop>
      <Pop delay={190}>
        <MicCheck />
      </Pop>
    </div>
  );
}

function Pop({ delay, children }: { delay: number; children: ReactNode }) {
  return (
    <div
      className="title-pop flex min-w-0 flex-col *:flex-1"
      style={{ animationDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/**
 * Enter does the main action and Esc the way back (unless a control has the key: a button, a
 * picker), Tab stays inside, and the dialog takes focus as it opens. A held key's repeats are
 * ignored, so the Enter that opened this step can't also go straight through it.
 */
function useDialogKeys(
  box: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onEnter: () => void,
  onEscape: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    box.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.key === "Tab") {
        if (box.current) trapTab(box.current, e);
        return;
      }
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (e.key === "Escape") {
        e.preventDefault();
        onEscape();
      } else if (e.key === "Enter") {
        if (t?.closest("button, a, select, input, textarea")) return;
        e.preventDefault();
        onEnter();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [box, enabled, onEnter, onEscape]);
}

/** Done in the world's overlay: let the microphone go and show the menu again. */
function closeDevices() {
  stopMicTest();
  useGameStore.getState().setDevicesOpen(false);
}

/**
 * The menu's "Camera and microphone": the same two checks over the library, with Done (Enter or
 * Esc) back to the menu, which waits underneath. The camera stays as the student leaves it.
 */
export function DevicesOverlay() {
  const open = useGameStore((s) => s.devicesOpen);
  const playing = useGameStore((s) => s.phase === "playing");
  useEffect(() => {
    if (open && !playing) closeDevices();
  }, [open, playing]);
  if (!open || !playing) return null;
  return <DevicesDialog />;
}

function DevicesDialog() {
  const box = useRef<HTMLDivElement>(null);
  useDialogKeys(box, true, closeDevices, closeDevices);
  return (
    <div className="absolute inset-0 z-30 font-display">
      <div
        aria-hidden
        onMouseDown={closeDevices}
        className="absolute inset-0 bg-walnut/60 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none"
      />
      <div className="pointer-events-none relative flex h-full w-full flex-col items-center overflow-y-auto px-8 py-[clamp(1rem,4vh,2.5rem)]">
        <div
          ref={box}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="devices-title"
          aria-describedby="devices-desc"
          className="title-pop pointer-events-auto my-auto flex w-full max-w-[66rem] flex-col outline-none"
        >
          <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
            <div>
              <h2
                id="devices-title"
                className="text-[clamp(2rem,3.6vw,2.75rem)] leading-[1] font-bold tracking-tight text-cream [paint-order:stroke_fill] [text-shadow:0_5px_0_#1f1a16] [-webkit-text-stroke:7px_#1f1a16]"
              >
                Camera and microphone
              </h2>
              <p
                id="devices-desc"
                className="mt-2 font-sans text-[15px] font-semibold text-cream/90 [text-shadow:0_2px_0_#1f1a16]"
              >
                Switch the camera on or off, test your microphone, or pick another one.
              </p>
            </div>
            <button
              type="button"
              onClick={closeDevices}
              className={`${BTN.primary} h-12 px-6 text-[17px]`}
            >
              <IconCheck size={18} strokeWidth={3} />
              Done
            </button>
          </header>
          <Checks autoStart={false} className="mt-5" />
        </div>
      </div>
    </div>
  );
}
