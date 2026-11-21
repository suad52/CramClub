import { PITCH_RANGE, type VoiceSettings, clampVoiceSettings } from "./settings";

/**
 * The voice mask's Web Audio chain, all on this device:
 *
 *   input → pitch shifter (AudioWorklet, public/worklets/pitch-shifter.js)
 *         → robot (ring modulation by a ~50 Hz sine, mixed in by amount)
 *         → radio (high-pass and low-pass closing in to ~300-3000 Hz, a presence bump and light
 *           tanh saturation, all scaled by amount)
 *         → echo (a feedback delay with a darker repeat, by amount) → output
 *
 * Neutral settings (or the mask switched off) make every stage a pass-through, so one chain can
 * stay connected and be switched live with `update`.
 *
 * The pure helpers (semitone ratio, per-stage values, the echo tail) are unit-tested in
 * ./changer.test.ts; the rest needs a browser.
 */

const WORKLET_URL = "/worklets/pitch-shifter.js";
const PROCESSOR = "ovr-pitch-shifter";

/** Ring modulator frequency: low enough to buzz rather than ring (a classic robot voice). */
export const ROBOT_HZ = 50;
/** Echo repeat time (s). */
export const ECHO_SECONDS = 0.24;
/** Where the radio's filters sit with radio at 0 (wide open) and at 1 (walkie-talkie). */
const RADIO_LOW = { open: 20, closed: 300 };
const RADIO_HIGH = { open: 20000, closed: 3000 };
/** Sine ring modulation halves the average power; this brings the wet signal back up. */
const RING_MAKEUP = Math.SQRT2;
/** Drive of the radio's saturation at full amount ("light": speech stays clear). */
const RADIO_DRIVE = 2.5;
/** Parameter glide (s), so slider moves don't click. */
const GLIDE = 0.02;

/** Semitones to a playback-rate ratio (+12 → 2, -12 → 0.5), kept within an octave. */
export function semitonesToRatio(semitones: number): number {
  const st = Number.isFinite(semitones) ? semitones : 0;
  return 2 ** (Math.min(PITCH_RANGE, Math.max(-PITCH_RANGE, st)) / 12);
}

/** Geometric blend, so filter sweeps feel even across the range. */
function sweep(from: number, to: number, t: number): number {
  return from * (to / from) ** t;
}

/** Every number the chain needs, from the settings. */
export interface StageValues {
  ratio: number;
  robotDry: number;
  robotWet: number;
  lowCut: number;
  highCut: number;
  /** Presence bump at ~1.7 kHz (dB). */
  presence: number;
  /** Saturation amount 0..1 (0 = no waveshaping at all). */
  drive: number;
  radioGain: number;
  echoWet: number;
  echoFeedback: number;
}

export const NEUTRAL_STAGES: StageValues = {
  ratio: 1,
  robotDry: 1,
  robotWet: 0,
  lowCut: RADIO_LOW.open,
  highCut: RADIO_HIGH.open,
  presence: 0,
  drive: 0,
  radioGain: 1,
  echoWet: 0,
  echoFeedback: 0,
};

export function stageValues(settings: VoiceSettings): StageValues {
  const s = clampVoiceSettings(settings);
  if (!s.enabled) return NEUTRAL_STAGES;
  return {
    ratio: semitonesToRatio(s.pitch),
    robotDry: 1 - s.robot,
    robotWet: s.robot * RING_MAKEUP,
    lowCut: sweep(RADIO_LOW.open, RADIO_LOW.closed, s.radio),
    highCut: sweep(RADIO_HIGH.open, RADIO_HIGH.closed, s.radio),
    presence: 6 * s.radio,
    drive: s.radio,
    // Band-limiting takes energy away; a little make-up keeps the level about even.
    radioGain: 1 + 0.5 * s.radio,
    echoWet: 0.6 * s.echo,
    echoFeedback: s.echo > 0 ? 0.2 + 0.4 * s.echo : 0,
  };
}

/**
 * The waveshaper curve for the radio's grit: a blend of a straight line and tanh, by `drive`.
 * Null at 0, so the shaper does nothing at all.
 */
export function saturationCurve(drive: number, points = 1024): Float32Array<ArrayBuffer> | null {
  const d = Math.min(1, Math.max(0, Number.isFinite(drive) ? drive : 0));
  if (d < 1e-3) return null;
  const curve = new Float32Array(points);
  const norm = Math.tanh(RADIO_DRIVE);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = (1 - d) * x + (d * Math.tanh(RADIO_DRIVE * x)) / norm;
  }
  return curve;
}

/** How long sound keeps coming after the input stops (s): the echo dying away to -40 dB. */
export function tailSeconds(settings: VoiceSettings): number {
  const { echoFeedback, echoWet } = stageValues(settings);
  if (echoWet <= 0 || echoFeedback <= 0) return 0.1;
  const repeats = Math.log(0.01) / Math.log(echoFeedback);
  return Math.min(3, ECHO_SECONDS * (repeats + 1) + 0.1);
}

/* ---- Web Audio ---- */

const modules = new WeakMap<BaseAudioContext, Promise<boolean>>();

/** Adds the pitch shifter's worklet to a context once. Resolves false if it can't load. */
export function loadPitchShifter(ctx: BaseAudioContext): Promise<boolean> {
  let ready = modules.get(ctx);
  if (!ready) {
    ready = ctx.audioWorklet
      ? ctx.audioWorklet.addModule(WORKLET_URL).then(
          () => true,
          () => false,
        )
      : Promise.resolve(false);
    modules.set(ctx, ready);
  }
  return ready;
}

export interface VoiceChanger {
  /** Connect this to wherever the masked voice should go. */
  output: AudioNode;
  /** Applies new settings (glides, so it's safe while sound is playing). */
  update: (settings: VoiceSettings) => void;
  /** Stops the chain and disconnects everything it made (not the input node itself). */
  dispose: () => void;
  /** False if the browser couldn't load the pitch shifter (the other effects still work). */
  pitchShift: boolean;
}

/**
 * Builds the chain after `input` in `ctx` (a live AudioContext or an OfflineAudioContext). Async
 * because the pitch shifter's worklet module has to load first (once per context).
 */
export async function createVoiceChanger(
  ctx: BaseAudioContext,
  input: AudioNode,
  settings: VoiceSettings,
): Promise<VoiceChanger> {
  const hasWorklet = await loadPitchShifter(ctx);
  let ratio: AudioParam | null = null;
  let worklet: AudioWorkletNode | null = null;
  if (hasWorklet) {
    try {
      worklet = new AudioWorkletNode(ctx, PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      ratio = worklet.parameters.get("ratio") ?? null;
    } catch {
      worklet = null;
    }
  }
  const pitch: AudioNode = worklet ?? ctx.createGain();

  // Robot: dry + (input × sine) by amount.
  const robotIn = ctx.createGain();
  const robotDry = ctx.createGain();
  const ringVca = ctx.createGain();
  ringVca.gain.value = 0;
  const robotWet = ctx.createGain();
  const robotOut = ctx.createGain();
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = ROBOT_HZ;

  // Radio: two high-passes, a presence peak, two low-passes, saturation, make-up gain.
  const filter = (type: BiquadFilterType, frequency: number) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = Math.SQRT1_2;
    return f;
  };
  const hp1 = filter("highpass", RADIO_LOW.open);
  const hp2 = filter("highpass", RADIO_LOW.open);
  const peak = filter("peaking", 1700);
  peak.Q.value = 1;
  peak.gain.value = 0;
  const lp1 = filter("lowpass", RADIO_HIGH.open);
  const lp2 = filter("lowpass", RADIO_HIGH.open);
  const shaper = ctx.createWaveShaper();
  shaper.oversample = "2x";
  const radioGain = ctx.createGain();

  // Echo: dry straight through, plus a feedback delay whose repeats get darker.
  const echoIn = ctx.createGain();
  const delay = ctx.createDelay(1);
  delay.delayTime.value = ECHO_SECONDS;
  const tone = filter("lowpass", 3200);
  const feedback = ctx.createGain();
  feedback.gain.value = 0;
  const echoWet = ctx.createGain();
  echoWet.gain.value = 0;
  const output = ctx.createGain();

  input.connect(pitch);
  pitch.connect(robotIn);
  robotIn.connect(robotDry).connect(robotOut);
  robotIn.connect(ringVca).connect(robotWet).connect(robotOut);
  lfo.connect(ringVca.gain);
  robotOut.connect(hp1).connect(hp2).connect(peak).connect(lp1).connect(lp2);
  lp2.connect(shaper).connect(radioGain).connect(echoIn);
  echoIn.connect(output);
  echoIn.connect(delay).connect(tone).connect(feedback).connect(delay);
  tone.connect(echoWet).connect(output);
  lfo.start();

  const nodes: AudioNode[] = [
    pitch,
    robotIn,
    robotDry,
    ringVca,
    robotWet,
    robotOut,
    lfo,
    hp1,
    hp2,
    peak,
    lp1,
    lp2,
    shaper,
    radioGain,
    echoIn,
    delay,
    tone,
    feedback,
    echoWet,
    output,
  ];

  let lastDrive = -1;
  const glide = (param: AudioParam, value: number, now: number) => {
    param.cancelScheduledValues(now);
    param.setTargetAtTime(value, now, GLIDE);
  };

  const update = (next: VoiceSettings) => {
    const v = stageValues(next);
    const now = ctx.currentTime;
    if (ratio) {
      ratio.cancelScheduledValues(now);
      ratio.setValueAtTime(v.ratio, now);
    }
    glide(robotDry.gain, v.robotDry, now);
    glide(robotWet.gain, v.robotWet, now);
    for (const f of [hp1, hp2]) glide(f.frequency, v.lowCut, now);
    for (const f of [lp1, lp2]) glide(f.frequency, v.highCut, now);
    glide(peak.gain, v.presence, now);
    glide(radioGain.gain, v.radioGain, now);
    glide(echoWet.gain, v.echoWet, now);
    glide(feedback.gain, v.echoFeedback, now);
    // Rebuilding the curve is cheap, but only do it when the amount really changed.
    if (Math.abs(v.drive - lastDrive) > 1e-3) {
      shaper.curve = saturationCurve(v.drive);
      lastDrive = v.drive;
    }
  };

  // Start exactly at the given settings (no glide from the defaults).
  const first = stageValues(settings);
  ratio?.setValueAtTime(first.ratio, ctx.currentTime);
  robotDry.gain.value = first.robotDry;
  robotWet.gain.value = first.robotWet;
  for (const f of [hp1, hp2]) f.frequency.value = first.lowCut;
  for (const f of [lp1, lp2]) f.frequency.value = first.highCut;
  peak.gain.value = first.presence;
  radioGain.gain.value = first.radioGain;
  echoWet.gain.value = first.echoWet;
  feedback.gain.value = first.echoFeedback;
  shaper.curve = saturationCurve(first.drive);
  lastDrive = first.drive;

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try {
      lfo.stop();
    } catch {
      // Already stopped.
    }
    try {
      input.disconnect(pitch);
    } catch {
      // Input was already disconnected elsewhere.
    }
    for (const n of nodes) n.disconnect();
    worklet?.port.postMessage("dispose");
  };

  return { output, update, dispose, pitchShift: ratio !== null };
}

export interface MaskedStream {
  /** The masked voice, ready to send to voice chat. */
  stream: MediaStream;
  update: (settings: VoiceSettings) => void;
  /**
   * Stops the masked stream and closes its audio context. The input stream's tracks belong to the
   * caller: stop those yourself when the microphone isn't needed.
   */
  dispose: () => void;
}

/**
 * Masks a microphone stream for voice chat: returns a new stream with the masked voice. Keep the
 * settings in sync with `update` (e.g. subscribe to useVoiceSettings).
 */
export async function maskStream(
  stream: MediaStream,
  settings: VoiceSettings,
): Promise<MaskedStream> {
  const ctx = new AudioContext({ latencyHint: "interactive" });
  try {
    const source = ctx.createMediaStreamSource(stream);
    const changer = await createVoiceChanger(ctx, source, settings);
    const destination = ctx.createMediaStreamDestination();
    changer.output.connect(destination);
    if (ctx.state === "suspended") await ctx.resume().catch(() => undefined);
    return {
      stream: destination.stream,
      update: changer.update,
      dispose: () => {
        changer.dispose();
        source.disconnect();
        for (const t of destination.stream.getTracks()) t.stop();
        void ctx.close().catch(() => undefined);
      },
    };
  } catch (err) {
    void ctx.close().catch(() => undefined);
    throw err;
  }
}
