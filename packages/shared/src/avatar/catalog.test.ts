import { describe, expect, it } from "vitest";
import {
  ACCESSORIES,
  AVATAR_FIELDS,
  DEFAULT_AVATAR,
  HAIR_STYLES,
  isAvatarConfig,
  normalizeAccessories,
  sanitizeAvatarConfig,
  slotOf,
} from "./catalog";
import {
  GARMENT_HIDES,
  HAT_HAIR_CLIP,
  luminance,
  mixHex,
  partName,
  resolveAvatar,
  shadeHex,
} from "./kit";
import { AVATAR_PRESETS, randomAvatar, seededRandom, styleWeight } from "./random";

describe("avatar catalog", () => {
  it("accepts the default avatar and every preset", () => {
    expect(isAvatarConfig(DEFAULT_AVATAR)).toBe(true);
    for (const p of AVATAR_PRESETS) expect(isAvatarConfig(p.config), p.id).toBe(true);
  });

  it("rejects unknown ids, bad sliders, slot clashes and non-objects", () => {
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, hair: "mohawk" })).toBe(false);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, build: 2 })).toBe(false);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, accessories: ["beanie", "cap"] })).toBe(false);
    expect(isAvatarConfig({ ...DEFAULT_AVATAR, details: ["blush", "blush"] })).toBe(false);
    expect(isAvatarConfig(null)).toBe(false);
    expect(isAvatarConfig("bob")).toBe(false);
  });

  it("sanitizes untrusted input field by field", () => {
    const hair = HAIR_STYLES[2].id;
    const clean = sanitizeAvatarConfig({
      v: 2,
      hair,
      top: 42,
      build: 9,
      accessories: ["cap", "nope", "beanie"],
      extra: "x",
    });
    expect(clean).toEqual({ ...DEFAULT_AVATAR, hair, build: 1, accessories: ["beanie"] });
    expect(isAvatarConfig(clean)).toBe(true);
  });

  it("migrates a saved v1 avatar", () => {
    const v1 = {
      base: "cocoa",
      hair: "curls",
      hairColor: "plum",
      outfit: "hoodie",
      outfitColor: "teal",
      accessory: "glasses",
    };
    const v2 = sanitizeAvatarConfig(v1);
    expect(v2).toMatchObject({
      skin: "cocoa",
      hair: "curly",
      hairColor: "plum",
      top: "hoodie",
      topColor: "teal",
      accessories: ["glasses_round"],
    });
    expect(isAvatarConfig(v2)).toBe(true);
    expect(sanitizeAvatarConfig({ ...v1, accessory: "none" }).accessories).toEqual([]);
  });

  it("keeps one accessory per slot, later choices winning", () => {
    expect(normalizeAccessories(["beanie", "glasses_round", "cap"])).toEqual([
      "glasses_round",
      "cap",
    ]);
    expect(new Set(ACCESSORIES.map((a) => slotOf(a.id))).size).toBeGreaterThan(4);
  });

  it("gives every option a flair in [0, 1] and unique ids", () => {
    for (const [field, options] of Object.entries(AVATAR_FIELDS)) {
      const ids = options.map((o) => o.id);
      expect(new Set(ids).size, field).toBe(ids.length);
      for (const o of options) expect(o.flair >= 0 && o.flair <= 1, `${field}.${o.id}`).toBe(true);
    }
  });
});

describe("avatar kit resolution", () => {
  it("shows the chosen parts and hides skin under clothes", () => {
    const r = resolveAvatar(DEFAULT_AVATAR);
    expect(r.visible).toEqual(
      expect.arrayContaining([
        "Head_Base",
        "Hair_Bob",
        "Top_Sweater",
        "Bottom_Jeans",
        "Shoes_Sneakers",
        "Acc_GlassesRound",
      ]),
    );
    expect(r.visible).not.toContain("Body_Torso");
    expect(r.visible).not.toContain("Body_Feet");
    expect(r.visible).toContain("Body_Hands");
    const shorts = resolveAvatar({ ...DEFAULT_AVATAR, bottom: "shorts", top: "tshirt" });
    expect(shorts.visible).toEqual(
      expect.arrayContaining(["Body_Thighs", "Body_Shins", "Body_UpperArms"]),
    );
  });

  it("knows the hidden regions of every garment", () => {
    for (const id of ["tshirt", "hoodie", "sweater", "cardigan", "jacket", "shirt"])
      expect(GARMENT_HIDES[partName.top(id)]).toBeDefined();
    expect(partName.accessory("glasses_round")).toBe("Acc_GlassesRound");
    expect(partName.detail("beauty_mark")).toBe("Detail_BeautyMark");
  });

  it("maps sliders, mouth/face presets and hats", () => {
    const r = resolveAvatar({
      ...DEFAULT_AVATAR,
      build: -0.5,
      height: 1,
      face: "heart",
      mouth: "grin",
      accessories: ["beanie"],
    });
    expect(r.build).toEqual({ Build_Broad: 0, Build_Slim: 0.5 });
    expect(r.scale).toBeCloseTo(1.06);
    expect(r.morphs.Head_Base).toEqual({ Face_Heart: 1 });
    expect(r.morphs.Mouth_Base?.Smile).toBeGreaterThan(0.5);
    expect(r.hairClip).toEqual(HAT_HAIR_CLIP.beanie);
    expect(resolveAvatar(DEFAULT_AVATAR).hairClip).toBeNull();
  });

  it("colours every kit material", () => {
    const m = resolveAvatar(DEFAULT_AVATAR).materials;
    expect(Object.keys(m)).toHaveLength(28);
    for (const hex of Object.values(m)) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("has sane colour helpers", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(shadeHex("#808080", -1)).toBe("#000000");
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(luminance("#000000")).toBe(0);
  });
});

describe("randomizer", () => {
  it("always produces a valid avatar", () => {
    const rnd = seededRandom(7);
    for (let i = 0; i < 300; i++) {
      const style = i / 299;
      const a = randomAvatar(style, rnd);
      expect(isAvatarConfig(a), JSON.stringify(a)).toBe(true);
    }
  });

  it("is reproducible from a seed", () => {
    expect(randomAvatar(0.5, seededRandom(42))).toEqual(randomAvatar(0.5, seededRandom(42)));
  });

  it("leans minimal or playful with the style slider", () => {
    const sample = (style: number) => {
      const rnd = seededRandom(1234);
      let extras = 0;
      let sparkle = 0;
      for (let i = 0; i < 400; i++) {
        const a = randomAvatar(style, rnd);
        extras += a.accessories.length + a.details.length;
        if (a.eyes === "sparkle") sparkle++;
      }
      return { extras, sparkle };
    };
    const minimal = sample(0);
    const playful = sample(1);
    expect(playful.extras).toBeGreaterThan(minimal.extras * 2.5);
    expect(playful.sparkle).toBeGreaterThan(minimal.sparkle * 3);
    expect(styleWeight(0.1, 0.1)).toBeGreaterThan(styleWeight(0.9, 0.1));
  });
});
