/**
 * Small sound effects synthesised with WebAudio, so the game ships no audio files for them. Every
 * call is best effort: no audio support, a blocked context or a failed node just means silence.
 */

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;

/** The shared context, created on first use (after a key press or click, so browsers allow it). */
function audio(): AudioContext | null {
  try {
    if (!context) {
      const Ctor =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      context = new Ctor();
    }
    if (context.state === "suspended") void context.resume().catch(() => {});
    return context;
  } catch {
    return null;
  }
}

/** Half a second of white noise, made once and shared by every knock and thud. */
function noiseBuffer(ac: AudioContext) {
  if (!noise) {
    noise = ac.createBuffer(1, Math.round(ac.sampleRate * 0.5), ac.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noise;
}

/** A filtered noise burst with a quick attack (4 ms unless given) and an exponential fade. */
function burst(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  {
    type,
    frequency,
    q,
    gain,
    decay,
    attack = 0.004,
  }: {
    type: BiquadFilterType;
    frequency: number;
    q: number;
    gain: number;
    decay: number;
    attack?: number;
  },
) {
  const src = ac.createBufferSource();
  src.buffer = noiseBuffer(ac);
  const filter = ac.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + attack);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  src.connect(filter).connect(env).connect(out);
  src.start(at);
  src.stop(at + decay + 0.02);
  return src;
}

/** A pitched knock: a sine that drops in pitch as it dies away (the body of the wood). */
function knock(
  ac: AudioContext,
  out: AudioNode,
  at: number,
  { from, to, gain, decay }: { from: number; to: number; gain: number; decay: number },
) {
  const osc = ac.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(from, at);
  osc.frequency.exponentialRampToValueAtTime(to, at + decay);
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  osc.connect(env).connect(out);
  osc.start(at);
  osc.stop(at + decay + 0.02);
  return osc;
}

/**
 * A rolling whiteboard turning over: a soft wooden click as the panel unlatches and lifts
 * (`start`), and a heavier, felt-damped thunk as it settles back onto its pins (`end`).
 * `volume` is 0–1 (the caller fades it with distance).
 */
export function playBoardFlip(phase: "start" | "end", volume: number) {
  if (!(volume > 0)) return;
  const ac = audio();
  if (!ac) return;
  try {
    const at = ac.currentTime + 0.01;
    const out = ac.createGain();
    out.gain.value = Math.min(1, volume) * 0.5;
    out.connect(ac.destination);
    let last: AudioScheduledSourceNode;
    if (phase === "start") {
      burst(ac, out, at, { type: "bandpass", frequency: 2600, q: 1.4, gain: 0.5, decay: 0.03 });
      last = knock(ac, out, at, { from: 620, to: 420, gain: 0.35, decay: 0.07 });
    } else {
      burst(ac, out, at, { type: "lowpass", frequency: 700, q: 0.7, gain: 0.6, decay: 0.12 });
      last = knock(ac, out, at, { from: 150, to: 80, gain: 0.9, decay: 0.22 });
    }
    last.onended = () => out.disconnect();
  } catch {
    // Sound is a nicety; never let it break the game.
  }
}

/* ---- The Pomodoro timer: a little digital desk clock ---- */

/** A fresh output for one sound; the caller disconnects it once its last voice has finished. */
function output(ac: AudioContext, volume: number) {
  const out = ac.createGain();
  out.gain.value = volume;
  out.connect(ac.destination);
  return out;
}

/**
 * Plays electronic beeps (start time in seconds from now, pitch in Hz, length in seconds) through
 * a soft low-pass, like a small piezo speaker in a plastic case.
 */
function beeps(volume: number, notes: { at: number; freq: number; length: number }[]) {
  const ac = audio();
  if (!ac) return;
  try {
    const out = output(ac, volume);
    const tone = ac.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3800;
    tone.connect(out);
    const t0 = ac.currentTime + 0.01;
    let last: OscillatorNode | null = null;
    for (const n of notes) {
      const osc = ac.createOscillator();
      osc.type = "square";
      osc.frequency.value = n.freq;
      const env = ac.createGain();
      const start = t0 + n.at;
      env.gain.setValueAtTime(0, start);
      env.gain.linearRampToValueAtTime(1, start + 0.004);
      env.gain.setValueAtTime(1, start + n.length - 0.006);
      env.gain.linearRampToValueAtTime(0, start + n.length);
      osc.connect(env).connect(tone);
      osc.start(start);
      osc.stop(start + n.length + 0.01);
      last = osc;
    }
    if (last) last.onended = () => out.disconnect();
  } catch {
    // Sound is a nicety; never let it break the game.
  }
}

/** Starting a pomodoro: two quick rising beeps. */
export function playTimerStart() {
  beeps(0.07, [
    { at: 0, freq: 1760, length: 0.07 },
    { at: 0.1, freq: 2350, length: 0.09 },
  ]);
}

/** The optional ticking sound: a faint electronic tick (call once a second). */
export function playTimerTick() {
  beeps(0.025, [{ at: 0, freq: 3100, length: 0.012 }]);
}

/** Time's up: the classic alarm-clock beep-beep-beep-beep, twice. */
export function playTimerAlarm() {
  const notes: { at: number; freq: number; length: number }[] = [];
  for (const group of [0, 0.75])
    for (let i = 0; i < 4; i++) notes.push({ at: group + i * 0.13, freq: 2730, length: 0.08 });
  beeps(0.06, notes);
}
