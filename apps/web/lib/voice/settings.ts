"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

/**
 * Voice mask settings: how the student's voice is changed before other students hear it in voice
 * chat. Everything runs on this device (see ./changer.ts); only these few numbers are saved, in
 * localStorage.
 *
 * The pure helpers at the top (presets, clamping, the transitions the store uses) have no browser
 * dependencies, so they're unit-tested in ./changer.test.ts.
 */

export type VoicePresetId = "natural" | "chipmunk" | "deep" | "robot" | "radio" | "mystery";

/** The four effect amounts the sliders control. */
export interface VoiceValues {
  /** Pitch shift in semitones, -12..+12 (an octave either way). */
  pitch: number;
  /** Ring-modulated "robot" buzz, 0..1. */
  robot: number;
  /** Walkie-talkie band-pass and grit, 0..1. */
  radio: number;
  /** Feedback echo, 0..1. */
  echo: number;
}

export interface VoiceSettings extends VoiceValues {
  /** "Mask my voice": off means other students hear the real voice. */
  enabled: boolean;
  /** The preset the values came from, or "custom" once a slider has moved them. */
  preset: VoicePresetId | "custom";
}

export interface VoicePreset {
  id: VoicePresetId;
  label: string;
  hint: string;
  values: VoiceValues;
}

export const PITCH_RANGE = 12;

export const NEUTRAL_VALUES: VoiceValues = { pitch: 0, robot: 0, radio: 0, echo: 0 };

/**
 * Every preset except Natural shifts the pitch a little as well, because pitch (and the formant
 * shift that comes with it) is what hides a voice best; the other effects add character.
 */
export const VOICE_PRESETS: readonly VoicePreset[] = [
  { id: "natural", label: "Natural voice", hint: "No change", values: NEUTRAL_VALUES },
  {
    id: "chipmunk",
    label: "Chipmunk",
    hint: "High and squeaky",
    values: { pitch: 7, robot: 0, radio: 0, echo: 0 },
  },
  {
    id: "deep",
    label: "Deep",
    hint: "Low and rumbly",
    values: { pitch: -6, robot: 0, radio: 0, echo: 0.1 },
  },
  {
    id: "robot",
    label: "Robot",
    hint: "Buzzy and metal",
    values: { pitch: -2, robot: 0.85, radio: 0, echo: 0.15 },
  },
  {
    id: "radio",
    label: "Radio",
    hint: "Walkie-talkie",
    values: { pitch: -3, robot: 0, radio: 0.9, echo: 0 },
  },
  {
    id: "mystery",
    label: "Mystery",
    hint: "Low with an echo",
    values: { pitch: -5, robot: 0.25, radio: 0.15, echo: 0.4 },
  },
];

/** What "Mask my voice" switches to when the sliders are all at zero. */
export const DEFAULT_MASK: VoicePresetId = "mystery";

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  preset: "natural",
  ...NEUTRAL_VALUES,
};

const VALUE_KEYS = [
  "pitch",
  "robot",
  "radio",
  "echo",
] as const satisfies readonly (keyof VoiceValues)[];
const PRESET_IDS = new Set<string>(VOICE_PRESETS.map((p) => p.id));

function finite(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** One value kept inside its slider's range (pitch -12..+12, the amounts 0..1). */
export function clampValue(key: keyof VoiceValues, v: unknown): number {
  const n = finite(v, 0);
  if (key === "pitch") return Math.min(PITCH_RANGE, Math.max(-PITCH_RANGE, n));
  return Math.min(1, Math.max(0, n));
}

/** Any stored or incoming object turned into valid settings (bad or missing fields use defaults). */
export function clampVoiceSettings(input: unknown): VoiceSettings {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const preset =
    typeof o.preset === "string" && (o.preset === "custom" || PRESET_IDS.has(o.preset))
      ? (o.preset as VoiceSettings["preset"])
      : DEFAULT_VOICE_SETTINGS.preset;
  return {
    enabled: typeof o.enabled === "boolean" ? o.enabled : DEFAULT_VOICE_SETTINGS.enabled,
    preset,
    pitch: clampValue("pitch", o.pitch),
    robot: clampValue("robot", o.robot),
    radio: clampValue("radio", o.radio),
    echo: clampValue("echo", o.echo),
  };
}

export function valuesOf(s: VoiceValues): VoiceValues {
  return { pitch: s.pitch, robot: s.robot, radio: s.radio, echo: s.echo };
}

export function isNeutral(v: VoiceValues): boolean {
  return VALUE_KEYS.every((k) => Math.abs(v[k]) < 1e-3);
}

/** The preset whose values these are, if any. */
export function matchPreset(v: VoiceValues): VoicePresetId | null {
  const hit = VOICE_PRESETS.find((p) =>
    VALUE_KEYS.every((k) => Math.abs(p.values[k] - v[k]) < 1e-3),
  );
  return hit?.id ?? null;
}

export function presetById(id: VoicePresetId): VoicePreset {
  return VOICE_PRESETS.find((p) => p.id === id) ?? VOICE_PRESETS[0]!;
}

/** Picking a preset tile. Natural voice is the same as switching the mask off and clearing it. */
export function applyPreset(id: VoicePresetId): VoiceSettings {
  const p = presetById(id);
  return { enabled: p.id !== "natural", preset: p.id, ...p.values };
}

/** Moving a slider: it turns the mask on (you're designing a voice) and marks it custom. */
export function withValue(s: VoiceSettings, key: keyof VoiceValues, v: number): VoiceSettings {
  const next = { ...valuesOf(s), [key]: clampValue(key, v) };
  const match = matchPreset(next);
  return { ...next, enabled: true, preset: match && match !== "natural" ? match : "custom" };
}

/**
 * The "Mask my voice" switch. Off keeps the values, so on/off is a quick before/after; on with
 * nothing set picks a default mask, so the switch always does something you can hear.
 */
export function withEnabled(s: VoiceSettings, enabled: boolean): VoiceSettings {
  if (!enabled) return { ...s, enabled: false };
  if (isNeutral(s)) return applyPreset(DEFAULT_MASK);
  return { ...s, enabled: true };
}

/** Which preset tile shows as chosen: Natural whenever the mask is off. */
export function selectedTile(s: VoiceSettings): VoicePresetId | "custom" {
  return s.enabled ? s.preset : "natural";
}

/* ---- The store ---- */

interface VoiceStore extends VoiceSettings {
  setPreset: (id: VoicePresetId) => void;
  setValue: (key: keyof VoiceValues, v: number) => void;
  setEnabled: (enabled: boolean) => void;
}

const pick = (s: VoiceSettings): VoiceSettings => ({
  enabled: s.enabled,
  preset: s.preset,
  ...valuesOf(s),
});

export const useVoiceSettings = create<VoiceStore>()(
  persist(
    (set, get) => ({
      ...DEFAULT_VOICE_SETTINGS,
      setPreset: (id) => set(applyPreset(id)),
      setValue: (key, v) => set(withValue(pick(get()), key, v)),
      setEnabled: (enabled) => set(withEnabled(pick(get()), enabled)),
    }),
    {
      name: "ovr.voice-mask",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): VoiceSettings => pick(s),
      merge: (persisted, current) => ({ ...current, ...clampVoiceSettings(persisted) }),
    },
  ),
);

/** The current settings, outside React (for voice chat: pass them to maskStream / update). */
export function getVoiceSettings(): VoiceSettings {
  return pick(useVoiceSettings.getState());
}
