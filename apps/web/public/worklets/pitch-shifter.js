/* global AudioWorkletProcessor, registerProcessor, sampleRate */

/**
 * Real-time pitch shifter for the voice mask (lib/voice/changer.ts loads it with
 * audioWorklet.addModule). Time-domain, low latency: the input is written into a circular buffer
 * and read back by two heads that drift through it at `ratio` times normal speed. Each head jumps
 * back (or forward) by about one window when it runs out of room; the two sit half a window apart
 * and are crossfaded with complementary raised-cosine gains, so a head is silent at the moment it
 * jumps.
 *
 * When a head jumps it also nudges its landing point (by up to SEARCH_SECONDS) to where its audio
 * best lines up with the other head's, found by normalised cross-correlation. Without that the
 * two heads are out of phase mid-crossfade, which makes the voice warble and pulls the pitch off.
 *
 * Delay stays between ~15 ms and ~60 ms (about 35 ms on average), fine for live voice.
 *
 * Parameter: ratio (k-rate), 0.25..4; 2 is an octave up, 0.5 an octave down. At 1 it fades to
 * the untouched input, so a neutral voice mask is an exact pass-through.
 * Message "dispose" on the port ends the processor.
 */

const WINDOW_SECONDS = 0.035;
/** Half the widest pitch period to line up: 7 ms covers voices down to about 70 Hz. */
const SEARCH_SECONDS = 0.007;
/** How much audio is compared when lining up a jump. */
const MATCH_SECONDS = 0.008;
/** How long the fade between pass-through and shifted takes. */
const BYPASS_FADE_SECONDS = 0.03;

class PitchShifter extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "ratio", defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    this.window = Math.max(256, Math.round(sampleRate * WINDOW_SECONDS));
    this.search = Math.max(16, Math.round(sampleRate * SEARCH_SECONDS));
    this.match = Math.max(32, Math.round(sampleRate * MATCH_SECONDS));
    // The coarse search compares about every 16 kHz sample, then refines around the best one.
    this.stride = Math.max(1, Math.round(sampleRate / 16000));
    // Shortest delay: room for a full comparison even with the most negative nudge.
    this.base = this.match + this.search + 2;
    const longest = this.base + this.window + this.search + 2;
    let size = 1024;
    while (size < longest * 2) size *= 2;
    this.size = size;
    this.mask = size - 1;
    this.buffer = new Float32Array(size);
    this.write = 0;
    this.phase = 0;
    this.offsets = [0, 0];
    this.wet = 0;
    this.wetStep = 1 / Math.max(1, sampleRate * BYPASS_FADE_SECONDS);
    this.alive = true;
    this.port.onmessage = (e) => {
      if (e.data === "dispose") this.alive = false;
    };
  }

  /** Linear interpolation `delay` samples behind the write head. */
  read(delay) {
    const pos = this.write - delay;
    const base = Math.floor(pos);
    const frac = pos - base;
    const a = this.buffer[(base + this.size) & this.mask];
    const b = this.buffer[(base + 1 + this.size) & this.mask];
    return a + (b - a) * frac;
  }

  /** How alike the audio is at two delays: normalised cross-correlation, every `step` samples. */
  similarity(delay, target, step) {
    const { buffer, mask, size, write, match } = this;
    let xy = 0;
    let xx = 0;
    for (let k = 0; k < match; k += step) {
      const a = buffer[(write - delay + k + size) & mask];
      const b = buffer[(write - target + k + size) & mask];
      xy += a * b;
      xx += a * a;
    }
    return xy / Math.sqrt(xx + 1e-9);
  }

  /** Head `h` is restarting at phase `p`: pick the nudge that lines it up with the other head. */
  align(h, p) {
    const other = 1 - h;
    const otherPhase = p < 0.5 ? p + 0.5 : p - 0.5;
    const target = Math.round(this.base + otherPhase * this.window + this.offsets[other]);
    const nominal = Math.round(this.base + p * this.window);
    let bestOffset = 0;
    let best = this.similarity(nominal, target, this.stride);
    for (let off = -this.search; off <= this.search; off += this.stride) {
      const score = this.similarity(nominal + off, target, this.stride);
      if (score > best) {
        best = score;
        bestOffset = off;
      }
    }
    if (this.stride > 1) {
      const from = Math.max(-this.search, bestOffset - this.stride + 1);
      const to = Math.min(this.search, bestOffset + this.stride - 1);
      let fine = this.similarity(nominal + bestOffset, target, 1);
      for (let off = from; off <= to; off++) {
        const score = this.similarity(nominal + off, target, 1);
        if (score > fine) {
          fine = score;
          bestOffset = off;
        }
      }
    }
    this.offsets[h] = bestOffset;
  }

  process(inputs, outputs, parameters) {
    if (!this.alive) return false;
    const output = outputs[0];
    if (!output || output.length === 0) return true;
    const input = inputs[0];
    const channels = input ? input.length : 0;
    const frames = output[0].length;
    const ratio = parameters.ratio[0] ?? 1;
    const target = Math.abs(ratio - 1) > 1e-3 ? 1 : 0;
    // Delay grows by (1 - ratio) each sample: shrinking (reading faster) raises the pitch.
    const step = (1 - ratio) / this.window;
    const out = output[0];

    for (let i = 0; i < frames; i++) {
      let x = 0;
      for (let c = 0; c < channels; c++) x += input[c][i];
      if (channels > 1) x /= channels;
      this.buffer[this.write] = x;

      let y = x;
      if (this.wet > 0 || target > 0) {
        const p1 = this.phase;
        const p2 = p1 < 0.5 ? p1 + 0.5 : p1 - 0.5;
        const g1 = 0.5 - 0.5 * Math.cos(2 * Math.PI * p1);
        const s1 = this.read(this.base + p1 * this.window + this.offsets[0]);
        const s2 = this.read(this.base + p2 * this.window + this.offsets[1]);
        const shifted = s1 * g1 + s2 * (1 - g1);
        if (this.wet < target) this.wet = Math.min(1, this.wet + this.wetStep);
        else if (this.wet > target) this.wet = Math.max(0, this.wet - this.wetStep);
        y = x + (shifted - x) * this.wet;

        // Move on; a head whose phase wraps has just jumped (while silent), so line it up.
        const before = this.phase;
        let wrapped = false;
        this.phase += step;
        if (this.phase >= 1) {
          this.phase -= 1;
          wrapped = true;
        } else if (this.phase < 0) {
          this.phase += 1;
          wrapped = true;
        }
        if (wrapped) this.align(0, this.phase);
        else if (before < 0.5 !== this.phase < 0.5) {
          this.align(1, this.phase < 0.5 ? this.phase + 0.5 : this.phase - 0.5);
        }
      }
      out[i] = y;
      this.write = (this.write + 1) & this.mask;
    }

    for (let c = 1; c < output.length; c++) output[c].set(out);
    return true;
  }
}

try {
  registerProcessor("ovr-pitch-shifter", PitchShifter);
} catch {
  // Already registered in this audio context (the module was added twice).
}
