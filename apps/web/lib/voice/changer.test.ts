import { describe, expect, it } from "vitest";
import {
  NEUTRAL_STAGES,
  saturationCurve,
  semitonesToRatio,
  stageValues,
  tailSeconds,
} from "./changer";
import {
  DEFAULT_MASK,
  DEFAULT_VOICE_SETTINGS,
  PITCH_RANGE,
  VOICE_PRESETS,
  type VoiceSettings,
  applyPreset,
  clampValue,
  clampVoiceSettings,
  isNeutral,
  matchPreset,
  selectedTile,
  withEnabled,
  withValue,
} from "./settings";

const on = (values: Partial<VoiceSettings>): VoiceSettings => ({
  ...DEFAULT_VOICE_SETTINGS,
  enabled: true,
  preset: "custom",
  ...values,
});

describe("semitonesToRatio", () => {
  it("maps semitones to a rate ratio", () => {
    expect(semitonesToRatio(0)).toBe(1);
    expect(semitonesToRatio(12)).toBeCloseTo(2, 10);
    expect(semitonesToRatio(-12)).toBeCloseTo(0.5, 10);
    expect(semitonesToRatio(7)).toBeCloseTo(1.4983, 4);
  });

  it("stays within an octave and ignores bad input", () => {
    expect(semitonesToRatio(40)).toBeCloseTo(2, 10);
    expect(semitonesToRatio(-40)).toBeCloseTo(0.5, 10);
    expect(semitonesToRatio(Number.NaN)).toBe(1);
  });
});

describe("presets", () => {
  it("has the six tiles, Natural first and neutral", () => {
    expect(VOICE_PRESETS.map((p) => p.id)).toEqual([
      "natural",
      "chipmunk",
      "deep",
      "robot",
      "radio",
      "mystery",
    ]);
    expect(isNeutral(VOICE_PRESETS[0]!.values)).toBe(true);
  });

  it("keeps every preset in range, and every masking preset shifts the pitch", () => {
    for (const p of VOICE_PRESETS) {
      expect(clampVoiceSettings({ ...p.values })).toMatchObject(p.values);
      if (p.id !== "natural") expect(Math.abs(p.values.pitch)).toBeGreaterThanOrEqual(2);
    }
  });

  it("gives every preset distinct values, so matching is unambiguous", () => {
    for (const p of VOICE_PRESETS) expect(matchPreset(p.values)).toBe(p.id);
  });

  it("applies a preset; Natural voice switches the mask off", () => {
    expect(applyPreset("deep")).toMatchObject({ enabled: true, preset: "deep", pitch: -6 });
    expect(applyPreset("natural")).toEqual(DEFAULT_VOICE_SETTINGS);
  });
});

describe("clamping", () => {
  it("clamps each value to its slider", () => {
    expect(clampValue("pitch", 30)).toBe(PITCH_RANGE);
    expect(clampValue("pitch", -30)).toBe(-PITCH_RANGE);
    expect(clampValue("robot", 2)).toBe(1);
    expect(clampValue("echo", -1)).toBe(0);
    expect(clampValue("radio", Number.NaN)).toBe(0);
    expect(clampValue("radio", "0.5")).toBe(0);
  });

  it("repairs stored settings", () => {
    expect(clampVoiceSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(
      clampVoiceSettings({ enabled: "yes", preset: "kazoo", pitch: 99, robot: 0.5, echo: 4 }),
    ).toEqual({ enabled: false, preset: "natural", pitch: 12, robot: 0.5, radio: 0, echo: 1 });
    expect(clampVoiceSettings({ enabled: true, preset: "custom" }).preset).toBe("custom");
  });
});

describe("store transitions", () => {
  it("moving a slider turns the mask on and marks it custom", () => {
    const s = withValue(DEFAULT_VOICE_SETTINGS, "pitch", 3);
    expect(s).toMatchObject({ enabled: true, preset: "custom", pitch: 3 });
    expect(withValue(s, "pitch", 40).pitch).toBe(12);
  });

  it("recognises a preset reached with the sliders", () => {
    const chip = withValue(DEFAULT_VOICE_SETTINGS, "pitch", 7);
    expect(chip.preset).toBe("chipmunk");
    expect(withValue(chip, "pitch", 0).preset).toBe("custom");
  });

  it("switching on with nothing set picks the default mask; off keeps the values", () => {
    expect(withEnabled(DEFAULT_VOICE_SETTINGS, true)).toEqual(applyPreset(DEFAULT_MASK));
    const robot = applyPreset("robot");
    const off = withEnabled(robot, false);
    expect(off).toEqual({ ...robot, enabled: false });
    expect(selectedTile(off)).toBe("natural");
    expect(withEnabled(off, true)).toEqual(robot);
  });
});

describe("stageValues", () => {
  it("is a pass-through when the mask is off, whatever the sliders say", () => {
    expect(stageValues({ ...applyPreset("robot"), enabled: false })).toEqual(NEUTRAL_STAGES);
    expect(stageValues(on({}))).toEqual(NEUTRAL_STAGES);
  });

  it("closes the radio filters to about 300-3000 Hz at full amount", () => {
    const v = stageValues(on({ radio: 1 }));
    expect(v.lowCut).toBeCloseTo(300, 6);
    expect(v.highCut).toBeCloseTo(3000, 6);
    const half = stageValues(on({ radio: 0.5 }));
    expect(half.lowCut).toBeGreaterThan(20);
    expect(half.lowCut).toBeLessThan(300);
  });

  it("mixes the robot by amount and keeps the echo stable", () => {
    const v = stageValues(on({ robot: 1, echo: 1 }));
    expect(v.robotDry).toBe(0);
    expect(v.robotWet).toBeGreaterThan(1);
    expect(v.echoFeedback).toBeLessThan(0.7);
    expect(stageValues(on({ echo: 0 })).echoFeedback).toBe(0);
  });
});

describe("saturationCurve", () => {
  it("does nothing at zero and stays bounded, odd and monotonic", () => {
    expect(saturationCurve(0)).toBeNull();
    const c = saturationCurve(1, 257)!;
    expect(c[0]).toBeCloseTo(-1, 6);
    expect(c[256]).toBeCloseTo(1, 6);
    expect(c[128]).toBeCloseTo(0, 6);
    for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThan(c[i - 1]!);
  });
});

describe("tailSeconds", () => {
  it("is short without echo and longer, but capped, with it", () => {
    expect(tailSeconds(on({}))).toBeLessThan(0.2);
    const t = tailSeconds(on({ echo: 1 }));
    expect(t).toBeGreaterThan(1);
    expect(t).toBeLessThanOrEqual(3);
  });
});
