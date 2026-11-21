import { create } from "zustand";
import { refreshDevices } from "./list";
import {
  type LevelMeter,
  HEARD_MS,
  newAudioContext,
  nextHeardMs,
  openLevelMeter,
  releaseStream,
} from "./meter";
import { type MediaProblem, mediaProblem } from "./permissions";
import { openMedia, useDevicePrefs } from "./prefs";

/**
 * "Test microphone" on the setup step (and the menu's Camera and microphone panels): opens the
 * microphone, shows a live level and says "Sounds good" once it hears the student, then lets the
 * microphone go. Only one test runs at a time, and it always ends: after MIC_TEST_MS, on Stop, on
 * Go in, Back or Done, or when its panel closes (stopMicTest). Nothing is recorded or sent.
 */

/** The longest a test keeps the microphone open. */
export const MIC_TEST_MS = 10_000;
/** How often the level is read (a timer, not animation frames, which a busy 3D page slows down). */
const READ_MS = 50;

export type MicTestStatus = "idle" | "opening" | "listening" | "done" | "error";

interface MicTestState {
  status: MicTestStatus;
  /** Live level, 0 … 1 (0 when not listening). */
  level: number;
  /** The level stayed up long enough during this test. */
  heard: boolean;
  problem: MediaProblem | null;
  /** The microphone this test opened, for the picker. */
  deviceId: string | null;
}

export const useMicTest = create<MicTestState>(() => ({
  status: "idle",
  level: 0,
  heard: false,
  problem: null,
  deviceId: null,
}));

let current: { end: () => void } | null = null;

/** Ends the running test, if any, and releases the microphone. Safe to call any time. */
export function stopMicTest() {
  current?.end();
}

/** True while a test holds (or is opening) the microphone. */
export function isMicTestRunning() {
  return current !== null;
}

/** Starts a test (ending any earlier one). Call from a click: the browser may ask first. */
export async function startMicTest(): Promise<void> {
  stopMicTest();
  let over = false;
  let stream: MediaStream | null = null;
  // Made here, inside the click, before waiting for the microphone: an AudioContext made later
  // may never be allowed to run, and would hear only silence.
  let ctx: AudioContext | null = newAudioContext();
  let meter: LevelMeter | null = null;
  let ticker: ReturnType<typeof setInterval> | undefined = undefined;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  const closeAudio = () => {
    if (meter) meter.close();
    else void ctx?.close().catch(() => {});
    meter = null;
    ctx = null;
  };
  const session = {
    end: () => {
      if (over) return;
      over = true;
      clearInterval(ticker);
      clearTimeout(timer);
      closeAudio();
      releaseStream(stream);
      stream = null;
      if (current === session) current = null;
      const was = useMicTest.getState().status;
      useMicTest.setState({ status: was === "opening" ? "idle" : "done", level: 0 });
    },
  };
  current = session;
  useMicTest.setState({ status: "opening", level: 0, heard: false, problem: null });

  try {
    stream = await openMedia("mic", {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  } catch (err) {
    if (over) return;
    over = true;
    closeAudio();
    if (current === session) current = null;
    useMicTest.setState({ status: "error", problem: mediaProblem(err), level: 0 });
    return;
  }
  // Stopped (Go in, Back, Stop…) while the browser was still opening it.
  if (over) {
    releaseStream(stream);
    stream = null;
    return;
  }
  try {
    meter = openLevelMeter(stream, ctx);
  } catch (err) {
    ctx = null; // openLevelMeter closed it
    session.end();
    useMicTest.setState({ status: "error", problem: mediaProblem(err) });
    return;
  }
  const track = stream.getAudioTracks()[0];
  useMicTest.setState({ status: "listening", deviceId: track?.getSettings().deviceId ?? null });
  // Names and ids only show up once the page may use a microphone.
  void refreshDevices();
  // The microphone was unplugged (or taken away) mid-test.
  track?.addEventListener("ended", session.end);
  timer = setTimeout(session.end, MIC_TEST_MS);

  let heardMs = 0;
  let last = performance.now();
  ticker = setInterval(() => {
    if (over || !meter) return;
    const now = performance.now();
    const level = meter.read();
    // A read sees the last ~170 ms of sound, so a late one (a busy page) still counts that much.
    heardMs = nextHeardMs(heardMs, meter.peak(), now - last, meter.windowMs);
    last = now;
    if (heardMs >= HEARD_MS && !useMicTest.getState().heard) {
      useMicTest.setState({ heard: true });
      useDevicePrefs.getState().setMic("ok");
    }
    useMicTest.setState({ level });
  }, READ_MS);
}

/** Back to "not tested" (a panel opening fresh), ending any test first. */
export function resetMicTest() {
  stopMicTest();
  useMicTest.setState({ status: "idle", level: 0, heard: false, problem: null, deviceId: null });
}
