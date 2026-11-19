/**
 * The contract between an AvatarConfig and the Blender avatar kit (avatar-kit.glb): which
 * parts are visible, which morph targets are set and what colour each material gets.
 * Pure data so the creator, the in-world avatar and tests all resolve a config the same way.
 * Names here are exported by art/avatars/scripts/build_kit.py; do not rename one side alone.
 */
import {
  type AccessoryId,
  type AvatarConfig,
  CLOTH_COLORS,
  EYE_COLORS,
  HAIR_COLORS,
  LIP_COLORS,
  METALS,
  SKIN_TONES,
  colorOf,
} from "./catalog";

/** Body regions the kit splits the skin into (Body_<Region>). */
export const BODY_REGIONS = [
  "Torso",
  "Neck",
  "UpperArms",
  "Forearms",
  "Hands",
  "Thighs",
  "Shins",
  "Feet",
] as const;
export type BodyRegion = (typeof BODY_REGIONS)[number];

/** Skin hidden under each garment (mirrors TOP_HIDES / BOTTOM_HIDES / SHOE_HIDES in kit_clothes.py). */
export const GARMENT_HIDES: Record<string, readonly BodyRegion[]> = {
  Top_Tshirt: ["Torso"],
  Top_Hoodie: ["Torso", "UpperArms", "Forearms"],
  Top_Sweater: ["Torso", "UpperArms", "Forearms"],
  Top_Cardigan: ["Torso", "UpperArms", "Forearms"],
  Top_Jacket: ["Torso", "UpperArms", "Forearms"],
  Top_Shirt: ["Torso", "UpperArms"],
  Bottom_Jeans: ["Thighs", "Shins"],
  Bottom_Chinos: ["Thighs", "Shins"],
  Bottom_Shorts: [],
  Bottom_Skirt: [],
  Shoes_Sneakers: ["Feet"],
  Shoes_Boots: ["Feet"],
  Shoes_Loafers: ["Feet"],
};

const pascal = (id: string) =>
  id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");

export const partName = {
  eyes: (id: string) => `Eyes_${pascal(id)}`,
  brows: (id: string) => `Brows_${pascal(id)}`,
  nose: (id: string) => `Nose_${pascal(id)}`,
  hair: (id: string) => `Hair_${pascal(id)}`,
  top: (id: string) => `Top_${pascal(id)}`,
  bottom: (id: string) => `Bottom_${pascal(id)}`,
  shoes: (id: string) => `Shoes_${pascal(id)}`,
  accessory: (id: string) => `Acc_${pascal(id)}`,
  detail: (id: string) => `Detail_${pascal(id)}`,
};

export const HEAD_PART = "Head_Base";
export const MOUTH_PART = "Mouth_Base";

/** Morph presets for each mouth style (on Mouth_Base); live expressions are added on top. */
export const MOUTH_PRESETS: Record<AvatarConfig["mouth"], Record<string, number>> = {
  soft: {},
  smile: { Smile: 0.7 },
  grin: { Smile: 0.9, Jaw_Open: 0.3 },
  pout: { Frown: 0.45 },
};

export const FACE_MORPHS: Record<AvatarConfig["face"], Record<string, number>> = {
  oval: {},
  round: { Face_Round: 1 },
  long: { Face_Long: 1 },
  heart: { Face_Heart: 1 },
};

/**
 * Hats squash the hair under them: everything above a plane through these two heights
 * (metres above the head centre, at the forehead and at the nape) is clipped away.
 */
export const HAT_HAIR_CLIP: Partial<Record<AccessoryId, { front: number; back: number }>> = {
  beanie: { front: 0.074, back: -0.03 },
  cap: { front: 0.066, back: 0.004 },
};
/** Head centre in kit space (Blender Z-up metres), matching kit_body.HEAD_CENTER. */
export const KIT_HEAD_CENTER_Z = 1.585;

// ---------------------------------------------------------------------------
// Colour helpers
// ---------------------------------------------------------------------------

const toRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: readonly number[]) =>
  "#" +
  rgb
    .map((c) =>
      Math.round(Math.max(0, Math.min(255, c)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("");

/** Linear blend of two hex colours (t = 0 → a, 1 → b). */
export function mixHex(a: string, b: string, t: number): string {
  const [ra, ga, ba] = toRgb(a);
  const [rb, gb, bb] = toRgb(b);
  return toHex([ra + (rb - ra) * t, ga + (gb - ga) * t, ba + (bb - ba) * t]);
}

/** Darkens (amount < 0) or lightens (amount > 0) a hex colour. */
export function shadeHex(hex: string, amount: number): string {
  return amount < 0 ? mixHex(hex, "#000000", -amount) : mixHex(hex, "#ffffff", amount);
}

/** Relative luminance in [0, 1]. */
export function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedAvatar {
  /** Names of the kit meshes to show; everything else is hidden. */
  visible: string[];
  /** Morph weights per mesh name (meshes not listed keep all weights at 0). */
  morphs: Record<string, Record<string, number>>;
  /** Build morphs, applied to every mesh that has them. */
  build: { Build_Broad: number; Build_Slim: number };
  /** Hex colour per kit material name. */
  materials: Record<string, string>;
  /** Uniform scale for the height slider. */
  scale: number;
  /** Set when a hat clips the hair (see HAT_HAIR_CLIP). */
  hairClip: { front: number; back: number } | null;
}

export function resolveAvatar(config: AvatarConfig): ResolvedAvatar {
  const top = partName.top(config.top);
  const bottom = partName.bottom(config.bottom);
  const shoes = partName.shoes(config.shoes);
  const hidden = new Set<BodyRegion>([
    ...(GARMENT_HIDES[top] ?? []),
    ...(GARMENT_HIDES[bottom] ?? []),
    ...(GARMENT_HIDES[shoes] ?? []),
  ]);

  const visible = [
    ...BODY_REGIONS.filter((r) => !hidden.has(r)).map((r) => `Body_${r}`),
    HEAD_PART,
    MOUTH_PART,
    partName.eyes(config.eyes),
    partName.brows(config.brows),
    partName.nose(config.nose),
    partName.hair(config.hair),
    top,
    bottom,
    shoes,
    ...config.accessories.map(partName.accessory),
    ...config.details.map(partName.detail),
  ];

  const skin = colorOf(SKIN_TONES, config.skin);
  const cloth = (id: AvatarConfig["topColor"]) => colorOf(CLOTH_COLORS, id);
  const topColor = cloth(config.topColor);
  const bottomColor = cloth(config.bottomColor);
  const shoesColor = cloth(config.shoesColor);
  const accColor = cloth(config.accessoryColor);
  const hairAccent = cloth(config.hairAccent);
  const lightShoes = luminance(shoesColor) > 0.45;

  const materials: Record<string, string> = {
    MAT_Skin: skin,
    MAT_SkinShade: shadeHex(skin, -0.07),
    MAT_Iris: colorOf(EYE_COLORS, config.eyeColor),
    MAT_EyeDark: "#1e1714",
    MAT_EyeShine: "#ffffff",
    MAT_Brows: shadeHex(colorOf(HAIR_COLORS, config.browColor), -0.08),
    MAT_Lip: mixHex(skin, colorOf(LIP_COLORS, config.lipColor), 0.72),
    MAT_MouthInner: "#4a1f1c",
    MAT_Freckle: mixHex(shadeHex(skin, -0.32), "#6b3a22", 0.35),
    MAT_Blush: mixHex(skin, "#e8707a", 0.5),
    MAT_Sticker: "#f2c94c",
    MAT_Hair: colorOf(HAIR_COLORS, config.hairColor),
    MAT_HairAccent: hairAccent,
    MAT_Top: topColor,
    MAT_TopTrim: shadeHex(topColor, -0.12),
    MAT_TopAccent: cloth(config.topAccent),
    MAT_TopInner: cloth(config.topAccent),
    MAT_Button: mixHex(shadeHex(topColor, -0.55), "#3a2a20", 0.5),
    MAT_Lace: lightShoes ? shadeHex(shoesColor, 0.5) : mixHex(shoesColor, "#f4efe6", 0.85),
    MAT_Bottom: bottomColor,
    MAT_BottomTrim: shadeHex(bottomColor, -0.14),
    MAT_Shoes: shoesColor,
    MAT_Sole: lightShoes ? "#a8714a" : "#efe9df",
    MAT_Acc: accColor,
    MAT_AccDark: shadeHex(accColor, -0.25),
    MAT_AccAccent: hairAccent,
    MAT_Metal: colorOf(METALS, config.metal),
    MAT_Frame: mixHex(accColor, "#241a14", 0.72),
  };

  const hat = config.accessories.find((a) => HAT_HAIR_CLIP[a]);
  return {
    visible,
    morphs: {
      [HEAD_PART]: FACE_MORPHS[config.face],
      [MOUTH_PART]: MOUTH_PRESETS[config.mouth],
    },
    build: { Build_Broad: Math.max(0, config.build), Build_Slim: Math.max(0, -config.build) },
    materials,
    scale: 1 + 0.06 * config.height,
    hairClip: hat ? (HAT_HAIR_CLIP[hat] ?? null) : null,
  };
}
