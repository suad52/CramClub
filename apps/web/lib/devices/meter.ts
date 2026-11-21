/**
 * A microphone level meter for the setup step's "Test microphone": Web Audio's AnalyserNode
 * reads the raw samples (nothing is recorded, played back or sent anywhere) and the pure helpers
 * below turn them into a 0 … 1 level, bars and "heard you". The helpers are tested next door.
 *
 * It is a peak meter: each read looks at the last ~170 ms of sound (WINDOW_SAMPLES) and takes its
 * loudest short block, so a syllable or a short beep is never missed between two reads, even
 * when the page is busy and reads come late.
 */

/** Quieter than this reads as silence; louder than the ceiling fills the meter. */
export const FLOOR_DB = -60;
export const CEIL_DB = -12;
/** A level at or above this counts as hearing the student (about -41 dB: quiet speech). */
export const HEARD_LEVEL = 0.4;
/** How long the level has to stay up (added over the test) before it says "Sounds good". */
export const HEARD_MS = 180;

/** Root mean square of a block of samples in -1 … 1. */
export function rmsOf(samples: ArrayLike<number>): number {
  const n = samples.length;
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = samples[i]!;
    sum += v * v;
  }
  return Math.sqrt(sum / n);
}

/** How much sound one read looks back over (the AnalyserNode's fftSize: ~170 ms at 48 kHz). */
export const WINDOW_SAMPLES = 8192;
/** The short blocks a read is split into (~10 ms at 48 kHz); the loudest one counts. */
export const BLOCK_SAMPLES = 512;

/** The loudest block's RMS: a short sound anywhere in the window shows at full strength. */
export function peakRms(samples: ArrayLike<number>, block = BLOCK_SAMPLES): number {
  const n = samples.length;
  if (!n) return 0;
  const size = Math.max(1, Math.min(block, n));
  let peak = 0;
  for (let start = 0; start < n; start += size) {
    const end = Math.min(n, start + size);
    let sum = 0;
    for (let i = start; i < end; i++) {
      const v = samples[i]!;
      sum += v * v;
    }
    peak = Math.max(peak, Math.sqrt(sum / (end - start)));
  }
  return peak;
}

/** Loudness on a decibel scale, mapped so FLOOR_DB is 0 and CEIL_DB is 1. */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
}

/** Jumps up at once and falls back gently, so short sounds are still seen on the bars. */
export function smoothLevel(previous: number, next: number, dtMs: number): number {
  if (next >= previous) return next;
  const fall = Math.min(1, Math.max(0, dtMs) / 220);
  return previous + (next - previous) * fall;
}

/**
 * Adds the time since the last read to the time spent loud enough, capped at `capMs` (how much
 * sound one read covers), so a stall can't count for more than the sound it actually heard.
 */
export function nextHeardMs(heardMs: number, level: number, dtMs: number, capMs = 100): number {
  return level >= HEARD_LEVEL ? heardMs + Math.min(Math.max(0, dtMs), capMs) : heardMs;
}

/** How many of `bars` bars to light for a level. */
export function litBars(level: number, bars: number): number {
  return Math.round(Math.min(1, Math.max(0, level)) * bars);
}

export interface LevelMeter {
  /** The current level, 0 … 1, smoothed between calls (for the bars). */
  read: () => number;
  /** The loudest sound in the last read's window, 0 … 1, unsmoothed (for "heard you"). */
  peak: () => number;
  /** How much sound one read covers, in ms. */
  windowMs: number;
  /** Disconnects and closes the audio context. Doesn't stop the stream's tracks. */
  close: () => void;
}

/**
 * A new, running AudioContext, or null where Web Audio is missing. Make it straight from the click
 * that starts the test (before waiting for the microphone): browsers only let a page start audio
 * from a click, and one made later can stay "suspended", reading nothing but silence.
 */
export function newAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Starts measuring a microphone stream, in `ctx` if given (see {@link newAudioContext}; the meter
 * owns it from here and closes it), else a new context. Throws where Web Audio is missing.
 */
export function openLevelMeter(stream: MediaStream, given?: AudioContext | null): LevelMeter {
  const ctx = given ?? newAudioContext();
  if (!ctx) throw Object.assign(new Error("Web Audio missing"), { name: "NotSupportedError" });
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  let source: MediaStreamAudioSourceNode;
  let analyser: AnalyserNode;
  try {
    source = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = WINDOW_SAMPLES;
    analyser.smoothingTimeConstant = 0;
    // Into the analyser only, never the speakers (that would echo).
    source.connect(analyser);
  } catch (err) {
    void ctx.close().catch(() => {});
    throw err;
  }
  const samples = new Float32Array(analyser.fftSize);
  let level = 0;
  let peak = 0;
  let last = performance.now();
  let closed = false;
  return {
    read: () => {
      if (closed) return 0;
      analyser.getFloatTimeDomainData(samples);
      const now = performance.now();
      peak = levelFromRms(peakRms(samples));
      level = smoothLevel(level, peak, now - last);
      last = now;
      return level;
    },
    peak: () => (closed ? 0 : peak),
    windowMs: (analyser.fftSize / ctx.sampleRate) * 1000,
    close: () => {
      if (closed) return;
      closed = true;
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        // Already disconnected.
      }
      void ctx.close().catch(() => {});
    },
  };
}

/** Stops every track of a stream, so the browser's "in use" light goes off. */
export function releaseStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((t) => t.stop());
}
