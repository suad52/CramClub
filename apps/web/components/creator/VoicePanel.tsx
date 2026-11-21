"use client";

import { type ReactNode, useEffect, useId, useState, useSyncExternalStore } from "react";
import {
  IconCheck,
  IconInfo,
  IconMic,
  IconPlay,
  IconRefresh,
  IconStop,
  IconWarning,
} from "@/components/ui/icons";
import { BTN, BTN_SM, FOCUS, RIBBON } from "@/components/ui/styles";
import { openMedia } from "@/lib/devices/prefs";
import { type VoiceChanger, createVoiceChanger, tailSeconds } from "@/lib/voice/changer";
import {
  PITCH_RANGE,
  VOICE_PRESETS,
  type VoicePresetId,
  type VoiceValues,
  getVoiceSettings,
  presetById,
  selectedTile,
  useVoiceSettings,
} from "@/lib/voice/settings";
import { RANGE, RANGE_TRACK, SectionTitle } from "./ui";

/**
 * Voice mask settings for the Character Studio: a "Mask my voice" switch, preset tiles, sliders
 * and a tester that records up to five seconds and plays it back as-is or masked. The microphone
 * opens only when "Record a test" is clicked and closes as soon as the recording ends; the clip
 * never leaves this device.
 */
export function VoicePanel() {
  const enabled = useVoiceSettings((s) => s.enabled);
  const preset = useVoiceSettings((s) => s.preset);
  const pitch = useVoiceSettings((s) => s.pitch);
  const robot = useVoiceSettings((s) => s.robot);
  const radio = useVoiceSettings((s) => s.radio);
  const echo = useVoiceSettings((s) => s.echo);
  const setPreset = useVoiceSettings((s) => s.setPreset);
  const setValue = useVoiceSettings((s) => s.setValue);
  const setEnabled = useVoiceSettings((s) => s.setEnabled);

  const tile = selectedTile({ enabled, preset, pitch, robot, radio, echo });
  const styleName = tile === "custom" ? "Custom" : presetById(tile).label;

  return (
    <div className="space-y-7">
      <MaskSwitch enabled={enabled} onChange={setEnabled} />

      <section>
        <SectionTitle aside={styleName}>Voice style</SectionTitle>
        <div className="grid grid-cols-3 gap-2.5" role="group" aria-label="Voice style">
          {VOICE_PRESETS.map((p) => (
            <PresetTile
              key={p.id}
              id={p.id}
              label={p.label}
              hint={p.hint}
              selected={tile === p.id}
              onSelect={() => setPreset(p.id)}
            />
          ))}
        </div>
      </section>

      <section>
        <SectionTitle aside={enabled ? styleName : "Mask off"}>Fine-tune</SectionTitle>
        {!enabled && (
          <p className="-mt-1 mb-3 text-[13px] leading-5 font-medium text-ink-soft">
            Moving a slider turns the mask on.
          </p>
        )}
        <div className="space-y-4">
          <EffectSlider
            name="pitch"
            label="Pitch"
            value={pitch}
            min={-PITCH_RANGE}
            max={PITCH_RANGE}
            step={1}
            left="Lower"
            right="Higher"
            onChange={setValue}
          />
          <EffectSlider
            name="robot"
            label="Robot"
            value={robot}
            left="None"
            right="Full robot"
            onChange={setValue}
          />
          <EffectSlider
            name="radio"
            label="Radio"
            value={radio}
            left="Clear"
            right="Walkie-talkie"
            onChange={setValue}
          />
          <EffectSlider
            name="echo"
            label="Echo"
            value={echo}
            left="Dry"
            right="Big hall"
            onChange={setValue}
          />
        </div>
      </section>

      <VoiceTester enabled={enabled} />

      <p className="flex gap-2.5 rounded-[16px] border-2 border-walnut/20 bg-canvas p-3 text-[13px] leading-5 font-medium text-ink-soft">
        <IconInfo size={18} className="mt-px text-walnut" />
        <span>
          Others will hear the masked voice in voice chat. The Librarian still hears your real voice
          so she can understand you.
        </span>
      </p>
    </div>
  );
}

/* ---- Switch, tiles and sliders ---- */

function MaskSwitch({ enabled, onChange }: { enabled: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 rounded-[20px] border-[2.5px] border-walnut bg-surface p-3 shadow-[0_3px_0_#1f1a16]">
      <span
        aria-hidden
        className={`grid h-11 w-11 shrink-0 -rotate-6 place-items-center rounded-[14px] border-[2.5px] border-walnut text-walnut shadow-[0_2px_0_#1f1a16] transition-colors duration-150 motion-reduce:transition-none ${enabled ? "bg-sun" : "bg-canvas"}`}
      >
        <IconMic size={22} strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1">
        <p id={`${id}-label`} className="font-display text-[15.5px] leading-5 font-semibold">
          Mask my voice
        </p>
        <p id={`${id}-desc`} className="text-[12.5px] leading-4 font-medium text-ink-soft">
          {enabled ? "Others hear the masked voice" : "Others hear your real voice"}
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-desc`}
        onClick={() => onChange(!enabled)}
        className={`relative inline-flex h-9 w-[68px] shrink-0 items-center rounded-full border-[2.5px] border-walnut shadow-[0_3px_0_#1f1a16] transition-colors duration-150 active:translate-y-px active:shadow-[0_1px_0_#1f1a16] motion-reduce:transition-none ${FOCUS} ${enabled ? "bg-leaf" : "bg-surface-muted"}`}
      >
        <span
          aria-hidden
          className={`absolute font-display text-[11.5px] font-bold text-walnut ${enabled ? "left-2.5" : "right-2"}`}
        >
          {enabled ? "On" : "Off"}
        </span>
        <span
          aria-hidden
          className={`absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-full border-[2.5px] border-walnut shadow-[0_2px_0_#1f1a16] transition-[left,background-color] duration-150 ease-out motion-reduce:transition-none ${enabled ? "left-[35px] bg-sun" : "left-[3px] bg-surface"}`}
        />
      </button>
    </div>
  );
}

/** Lift on hover, press on click, sun yellow when chosen (the same feel as the studio's tiles). */
const PICK =
  "transition-[background-color,border-color,box-shadow,translate] duration-150 ease-out active:translate-y-px active:shadow-[0_1px_0_#1f1a16] motion-reduce:transition-none";
const PICK_ON = "-translate-y-0.5 border-walnut bg-sun shadow-[0_4px_0_#1f1a16]";

function PresetTile({
  id,
  label,
  hint,
  selected,
  onSelect,
}: {
  id: VoicePresetId;
  label: string;
  hint: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`relative flex flex-col items-center gap-1.5 rounded-[16px] border-[2.5px] px-1 pt-2.5 pb-2 text-center ${PICK} ${FOCUS} ${selected ? PICK_ON : "border-walnut/20 bg-surface hover:-translate-y-0.5 hover:border-walnut hover:shadow-[0_3px_0_#1f1a16]"}`}
    >
      <span
        aria-hidden
        className={`grid h-10 w-10 place-items-center rounded-[12px] border-2 border-walnut text-walnut ${selected ? "bg-surface" : "bg-canvas"}`}
      >
        <PresetGlyph id={id} />
      </span>
      <span className="font-display text-[13px] leading-4 font-semibold text-walnut">{label}</span>
      <span
        className={`text-[11.5px] leading-[14px] font-medium ${selected ? "text-walnut/80" : "text-ink-soft"}`}
      >
        {hint}
      </span>
      {selected && (
        <span
          aria-hidden
          className="absolute -top-1.5 -right-1.5 grid h-6 w-6 rotate-6 place-items-center rounded-full border-2 border-walnut bg-leaf text-walnut shadow-[0_2px_0_#1f1a16]"
        >
          <IconCheck size={13} strokeWidth={3.25} />
        </span>
      )}
    </button>
  );
}

/** A little picture of each voice, drawn like the shared line icons (24px grid, currentColor). */
function PresetGlyph({ id }: { id: VoicePresetId }) {
  const paths: Record<VoicePresetId, ReactNode> = {
    natural: <path d="M3 12c1.5-4 3.5-4 5 0s3.5 4 5 0 3.5-4 5 0 2 2.7 3 2" />,
    chipmunk: (
      <path d="M2.5 12c.9-2.6 1.9-2.6 2.8 0s1.9 2.6 2.8 0 1.9-2.6 2.8 0 1.9 2.6 2.8 0 1.9-2.6 2.8 0 1.9 2.6 2.8 0 .9-1.3 1.3-1.3" />
    ),
    deep: <path d="M2.5 12c2.4-7 7.1-7 9.5 0s7.1 7 9.5 0" />,
    robot: <path d="M2.75 15h3V8.75h4.5V15h3.5V8.75h4.5V15h3" />,
    radio: (
      <>
        <rect x="3.5" y="9" width="17" height="11" rx="2.25" />
        <path d="M7 9l9.5-5M7 13h4M7 16.5h4" />
        <circle cx="15.75" cy="14.5" r="2.25" />
      </>
    ),
    mystery: (
      <>
        <path d="M3 9.25c3-1.25 6-.9 9 .9 3-1.8 6-2.15 9-.9-.15 4.4-2.4 6.75-5.1 6.75-1.75 0-3-1.1-3.9-2.6-.9 1.5-2.15 2.6-3.9 2.6-2.7 0-4.95-2.35-5.1-6.75z" />
        <path d="M6.75 11.75h2.5M14.75 11.75h2.5" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      width={22}
      height={22}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden
    >
      {paths[id]}
    </svg>
  );
}

function pitchText(p: number): string {
  const n = Math.round(p);
  if (n === 0) return "No shift";
  const unit = Math.abs(n) === 1 ? "semitone" : "semitones";
  return `${n > 0 ? "+" : "−"}${Math.abs(n)} ${unit}`;
}

function pitchSpoken(p: number): string {
  const n = Math.round(p);
  if (n === 0) return "No shift";
  const unit = Math.abs(n) === 1 ? "semitone" : "semitones";
  return `${Math.abs(n)} ${unit} ${n > 0 ? "higher" : "lower"}`;
}

function amountText(a: number): string {
  const n = Math.round(a * 100);
  return n === 0 ? "Off" : `${n}%`;
}

function EffectSlider({
  name,
  label,
  value,
  min = 0,
  max = 1,
  step = 0.05,
  left,
  right,
  onChange,
}: {
  name: keyof VoiceValues;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  left: string;
  right: string;
  onChange: (key: keyof VoiceValues, v: number) => void;
}) {
  const id = useId();
  const isPitch = name === "pitch";
  const shown = isPitch ? pitchText(value) : amountText(value);
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={id} className="font-display text-[14px] leading-5 font-semibold">
          {label}
        </label>
        <span
          aria-hidden
          className="tabular rounded-full border-2 border-walnut/20 bg-canvas px-2.5 py-0.5 font-display text-[12.5px] leading-4 font-semibold text-ink-soft"
        >
          {shown}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={isPitch ? pitchSpoken(value) : shown}
        onChange={(e) => onChange(name, Number(e.target.value))}
        className={`${RANGE} ${RANGE_TRACK} mt-1`}
      />
      <div
        aria-hidden
        className="mt-0.5 flex justify-between font-display text-xs font-medium text-ink-soft"
      >
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

/* ---- The tester ---- */

/** Longest test recording (s). */
const MAX_SECONDS = 5;
/** Below this loudest RMS the clip was probably silence (mic muted or wrong input). */
const QUIET_RMS = 0.015;

type Phase = "idle" | "starting" | "recording" | "processing" | "ready";
type Problem = "blocked" | "no-mic" | "busy" | "unsupported" | "failed" | "playback";
type Playing = "original" | "masked" | null;

interface TesterState {
  phase: Phase;
  problem: Problem | null;
  secondsLeft: number;
  playing: Playing;
  quiet: boolean;
  /** The masked playback had no pitch shift (the worklet couldn't load). */
  noPitch: boolean;
}

const INITIAL: TesterState = {
  phase: "idle",
  problem: null,
  secondsLeft: MAX_SECONDS,
  playing: null,
  quiet: false,
  noPitch: false,
};

const PROBLEM_TEXT: Record<Problem, string> = {
  blocked:
    "Microphone access is blocked. Allow the microphone for this site in your browser's settings, then try again.",
  "no-mic": "No microphone was found. Plug one in or switch it on, then try again.",
  busy: "Your microphone is busy in another app. Close it there and try again.",
  unsupported:
    "This browser can't record from a microphone here. Try Chrome, Edge, Firefox or Safari.",
  failed: "That recording didn't work. Try again.",
  playback: "The masked voice couldn't play. Try again.",
};

function problemOf(err: unknown): Problem {
  switch ((err as { name?: string } | null)?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "blocked";
    case "NotFoundError":
    case "OverconstrainedError":
      return "no-mic";
    case "NotReadableError":
    case "AbortError":
      return "busy";
    case "NotSupportedError":
      return "unsupported";
    default:
      return "failed";
  }
}

function pickMimeType(): string | undefined {
  const types = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
  return types.find((t) => MediaRecorder.isTypeSupported?.(t));
}

interface Recording {
  stream: MediaStream;
  recorder: MediaRecorder;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  startedAt: number;
  timer: number;
  raf: number;
  peak: number;
  shown: number;
}

interface Playback {
  source: AudioBufferSourceNode;
  changer: VoiceChanger | null;
  unsubscribe: (() => void) | null;
  timer: number;
}

/**
 * The tester's audio, outside React: one AudioContext (made on the first click), the mic only
 * while recording, the clip as an AudioBuffer in memory. The level meter and countdown bar are
 * drawn straight onto their elements each frame instead of re-rendering.
 */
class TesterEngine {
  private state = INITIAL;
  private listeners = new Set<() => void>();
  private ctx: AudioContext | null = null;
  private clip: AudioBuffer | null = null;
  private rec: Recording | null = null;
  private play: Playback | null = null;
  private meter: HTMLElement | null = null;
  private progress: HTMLElement | null = null;
  /** Bumped by teardown and each new recording, so late async steps know to stop. */
  private session = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<TesterState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  attachMeter = (el: HTMLElement | null) => {
    this.meter = el;
  };

  attachProgress = (el: HTMLElement | null) => {
    this.progress = el;
  };

  private context(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext({ latencyHint: "interactive" });
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => undefined);
    return this.ctx;
  }

  record = async () => {
    const { phase } = this.state;
    if (phase === "starting" || phase === "recording" || phase === "processing") return;
    this.stopPlayback();
    this.clip = null;
    const session = ++this.session;
    this.set({ phase: "starting", problem: null, quiet: false, secondsLeft: MAX_SECONDS });

    if (
      typeof window === "undefined" ||
      !window.isSecureContext ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      this.set({ phase: "idle", problem: "unsupported" });
      return;
    }

    // Made inside the click, so the browser lets it play sound later.
    const ctx = this.context();
    let stream: MediaStream;
    try {
      // The microphone picked on the "Before you go in" step, or the default one.
      stream = await openMedia("mic", {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      });
    } catch (err) {
      if (session === this.session) this.set({ phase: "idle", problem: problemOf(err) });
      return;
    }
    if (session !== this.session) {
      for (const t of stream.getTracks()) t.stop();
      return;
    }

    let recorder: MediaRecorder;
    try {
      const mimeType = pickMimeType();
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      for (const t of stream.getTracks()) t.stop();
      this.set({ phase: "idle", problem: "unsupported" });
      return;
    }

    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      const peak = this.rec?.peak ?? 0;
      this.releaseMic();
      void this.finish(session, chunks, recorder.mimeType, peak);
    };

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const rec: Recording = {
      stream,
      recorder,
      source,
      analyser,
      startedAt: performance.now(),
      timer: window.setTimeout(this.stopRecording, MAX_SECONDS * 1000),
      raf: 0,
      peak: 0,
      shown: 0,
    };
    this.rec = rec;
    recorder.start();
    this.set({ phase: "recording" });

    const data = new Float32Array(analyser.fftSize);
    const tick = () => {
      if (this.rec !== rec) return;
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      const rms = Math.sqrt(sum / data.length);
      rec.peak = Math.max(rec.peak, rms);
      // -60 dB → empty, about -6 dB → full; the bar falls back gently.
      const level = Math.min(1, Math.max(0, (20 * Math.log10(rms + 1e-8) + 60) / 54));
      rec.shown = Math.max(level, rec.shown - 0.035);
      if (this.meter) this.meter.style.clipPath = `inset(0 ${(1 - rec.shown) * 100}% 0 0)`;
      const elapsed = (performance.now() - rec.startedAt) / 1000;
      if (this.progress) {
        this.progress.style.transform = `scaleX(${Math.max(0, 1 - elapsed / MAX_SECONDS)})`;
      }
      const left = Math.max(1, Math.ceil(MAX_SECONDS - elapsed));
      if (left !== this.state.secondsLeft) this.set({ secondsLeft: left });
      rec.raf = requestAnimationFrame(tick);
    };
    rec.raf = requestAnimationFrame(tick);
  };

  stopRecording = () => {
    const rec = this.rec;
    if (!rec) return;
    window.clearTimeout(rec.timer);
    cancelAnimationFrame(rec.raf);
    if (rec.recorder.state === "inactive") {
      // The recorder already ended by itself without handing over a clip.
      this.releaseMic();
      this.set({ phase: "idle", problem: "failed" });
      return;
    }
    this.set({ phase: "processing" });
    rec.recorder.stop();
    // The mic goes off now, not when the clip has finished saving.
    for (const t of rec.stream.getTracks()) t.stop();
  };

  /** Microphone off and its nodes gone. */
  private releaseMic() {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    window.clearTimeout(rec.timer);
    cancelAnimationFrame(rec.raf);
    for (const t of rec.stream.getTracks()) t.stop();
    rec.source.disconnect();
    rec.analyser.disconnect();
  }

  private async finish(session: number, chunks: Blob[], type: string, peak: number) {
    if (session !== this.session) return;
    try {
      const blob = new Blob(chunks, type ? { type } : undefined);
      if (blob.size === 0) throw new Error("empty recording");
      const ctx = this.context();
      const clip = await ctx.decodeAudioData(await blob.arrayBuffer());
      if (session !== this.session) return;
      this.clip = clip;
      this.set({ phase: "ready", quiet: peak < QUIET_RMS });
    } catch {
      if (session === this.session) this.set({ phase: "idle", problem: "failed" });
    }
  }

  togglePlay = async (kind: "original" | "masked") => {
    const clip = this.clip;
    if (!clip) return;
    const wasPlaying = this.state.playing;
    this.stopPlayback();
    if (wasPlaying === kind) return;

    const ctx = this.context();
    const source = ctx.createBufferSource();
    source.buffer = clip;
    const playback: Playback = { source, changer: null, unsubscribe: null, timer: 0 };
    this.play = playback;
    this.set({ playing: kind, problem: null });

    if (kind === "masked") {
      let changer: VoiceChanger;
      try {
        changer = await createVoiceChanger(ctx, source, getVoiceSettings());
      } catch {
        if (this.play === playback) {
          this.play = null;
          this.set({ playing: null, problem: "playback" });
        }
        return;
      }
      if (this.play !== playback) {
        changer.dispose();
        return;
      }
      playback.changer = changer;
      changer.output.connect(ctx.destination);
      // Slider changes are heard straight away, even mid-playback.
      playback.unsubscribe = useVoiceSettings.subscribe((s) => changer.update(s));
      if (this.state.noPitch !== !changer.pitchShift) this.set({ noPitch: !changer.pitchShift });
    } else {
      source.connect(ctx.destination);
    }

    source.onended = () => {
      if (this.play !== playback) return;
      // Let the echo ring out before tidying up.
      const tail = kind === "masked" ? tailSeconds(getVoiceSettings()) : 0;
      playback.timer = window.setTimeout(() => {
        if (this.play === playback) this.stopPlayback();
      }, tail * 1000);
    };
    source.start();
  };

  private stopPlayback() {
    const p = this.play;
    if (!p) return;
    this.play = null;
    window.clearTimeout(p.timer);
    p.unsubscribe?.();
    p.source.onended = null;
    try {
      p.source.stop();
    } catch {
      // Never started or already ended.
    }
    p.source.disconnect();
    p.changer?.dispose();
    if (this.state.playing) this.set({ playing: null });
  }

  dismissProblem = () => {
    if (this.state.problem) this.set({ problem: null });
  };

  /** Everything off (mic, sound, context). The engine can be used again afterwards. */
  teardown = () => {
    this.session++;
    this.stopPlayback();
    const rec = this.rec;
    if (rec) {
      rec.recorder.onstop = null;
      if (rec.recorder.state !== "inactive") rec.recorder.stop();
      this.releaseMic();
    }
    this.clip = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx && ctx.state !== "closed") void ctx.close().catch(() => undefined);
    this.state = INITIAL;
    for (const fn of this.listeners) fn();
  };
}

function statusText(s: TesterState): string {
  if (s.problem) return "";
  if (s.playing === "original") return "Playing your real voice";
  if (s.playing === "masked") return "Playing your masked voice";
  switch (s.phase) {
    case "starting":
      return "Waiting for the microphone. Allow it if your browser asks.";
    case "recording":
      return "Recording. Speak now.";
    case "processing":
      return "Getting your clip ready";
    case "ready":
      return "Your test clip is ready";
    default:
      return "";
  }
}

function VoiceTester({ enabled }: { enabled: boolean }) {
  const [engine] = useState(() => new TesterEngine());
  const s = useSyncExternalStore(engine.subscribe, engine.getSnapshot, engine.getSnapshot);
  const id = useId();

  useEffect(() => () => engine.teardown(), [engine]);

  const busy = s.phase === "starting" || s.phase === "processing";

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="relative rounded-[20px] border-[2.5px] border-walnut bg-canvas px-4 pt-6 pb-4 shadow-[0_3px_0_#1f1a16]"
    >
      <span aria-hidden className={`${RIBBON} absolute -top-3.5 left-4`}>
        Tester
      </span>
      <h3 id={`${id}-title`} className="font-display text-[15.5px] leading-5 font-semibold">
        Hear how you sound
      </h3>
      <p className="mt-1 text-[13px] leading-5 font-medium text-ink-soft">
        Record up to {MAX_SECONDS} seconds, then compare your real voice with the masked one.
      </p>

      <p className="sr-only" role="status" aria-live="polite">
        {statusText(s)}
      </p>

      {s.problem && (
        <div
          role="alert"
          className="mt-3.5 flex gap-2.5 rounded-[14px] border-[2.5px] border-walnut bg-[#fbe9e5] p-3 text-[13px] leading-5 font-semibold text-walnut"
        >
          <IconWarning size={18} strokeWidth={2.25} className="mt-px text-danger" />
          <span className="min-w-0 flex-1">{PROBLEM_TEXT[s.problem]}</span>
          <button
            type="button"
            onClick={() => engine.dismissProblem()}
            className={`-m-1 h-7 shrink-0 self-start rounded-[9px] px-1.5 font-display text-xs font-semibold text-walnut underline-offset-2 hover:underline ${FOCUS}`}
          >
            Dismiss
          </button>
        </div>
      )}

      {s.phase === "recording" ? (
        <div className="mt-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border-2 border-walnut bg-surface px-2.5 py-0.5 font-display text-xs font-semibold text-walnut">
              <span
                aria-hidden
                className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-danger motion-safe:animate-pulse"
              />
              Recording
            </span>
            <span className="tabular font-display text-[13px] font-semibold text-walnut">
              {s.secondsLeft} {s.secondsLeft === 1 ? "second" : "seconds"} left
            </span>
          </div>
          {/* Live level, drawn by the engine each frame. */}
          <div
            aria-hidden
            className="relative mt-2.5 h-6 overflow-hidden rounded-full border-[2.5px] border-walnut bg-surface"
          >
            <div
              ref={(el) => engine.attachMeter(el)}
              className="absolute inset-0 bg-[linear-gradient(90deg,var(--color-leaf),var(--color-sun)_65%,var(--color-tangerine))]"
              style={{ clipPath: "inset(0 100% 0 0)" }}
            />
            <div className="absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_11px,rgb(31_26_22/0.18)_11px_13px)]" />
          </div>
          <div aria-hidden className="mt-2 h-2 overflow-hidden rounded-full bg-walnut/15">
            <div
              ref={(el) => engine.attachProgress(el)}
              className="h-full origin-left rounded-full bg-walnut"
            />
          </div>
          <p className="mt-2.5 text-[13px] leading-5 font-medium text-ink-soft">
            Say something like &ldquo;Meet me by the big window.&rdquo;
          </p>
          <button
            type="button"
            onClick={() => engine.stopRecording()}
            className={`${BTN.secondary} mt-3 w-full`}
          >
            <IconStop size={18} strokeWidth={2.25} />
            Stop recording
          </button>
        </div>
      ) : s.phase === "ready" ? (
        <div className="mt-3.5">
          {s.quiet && (
            <p className="mb-3 flex gap-2 text-[13px] leading-5 font-semibold text-walnut">
              <IconWarning size={17} strokeWidth={2.25} className="mt-0.5 text-warning" />
              That was very quiet. Check your microphone isn&rsquo;t muted, then record again.
            </p>
          )}
          {!enabled && (
            <p className="mb-3 text-[13px] leading-5 font-medium text-ink-soft">
              Your mask is off, so both will sound the same. Pick a voice style above.
            </p>
          )}
          <div className="grid gap-2.5">
            <button
              type="button"
              onClick={() => void engine.togglePlay("original")}
              className={`${BTN.secondary} w-full`}
            >
              {s.playing === "original" ? (
                <>
                  <IconStop size={18} strokeWidth={2.25} />
                  Stop<span className="sr-only"> playing my voice</span>
                </>
              ) : (
                <>
                  <IconPlay size={18} strokeWidth={2.25} />
                  Play my voice
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => void engine.togglePlay("masked")}
              className={`${BTN.primary} w-full`}
            >
              {s.playing === "masked" ? (
                <>
                  <IconStop size={18} strokeWidth={2.25} />
                  Stop<span className="sr-only"> playing masked</span>
                </>
              ) : (
                <>
                  <IconPlay size={18} strokeWidth={2.25} />
                  Play masked
                </>
              )}
            </button>
          </div>
          {s.noPitch && (
            <p className="mt-2.5 text-[12.5px] leading-[18px] font-medium text-ink-soft">
              This browser couldn&rsquo;t load the pitch effect, so only the other effects play.
            </p>
          )}
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <p className="text-[12.5px] leading-[18px] font-medium text-ink-soft">
              Change a slider, then play it again.
            </p>
            <button type="button" onClick={() => void engine.record()} className={BTN_SM.quiet}>
              <IconRefresh size={16} strokeWidth={2.25} />
              Record again
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3.5">
          <button
            type="button"
            onClick={() => void engine.record()}
            disabled={busy}
            className={`${BTN.primary} w-full`}
          >
            {busy ? (
              <span
                aria-hidden
                className="h-4 w-4 rounded-full border-[2.5px] border-walnut/25 border-t-walnut motion-safe:animate-spin"
              />
            ) : (
              <IconMic size={18} strokeWidth={2.25} />
            )}
            {s.phase === "starting"
              ? "Waiting for your mic…"
              : s.phase === "processing"
                ? "Getting it ready…"
                : s.problem
                  ? "Try again"
                  : "Record a test"}
          </button>
          <p className="mt-2 text-[12.5px] leading-[18px] font-medium text-ink-soft">
            Your microphone is on only while recording. The clip stays on this device.
          </p>
        </div>
      )}
    </section>
  );
}
