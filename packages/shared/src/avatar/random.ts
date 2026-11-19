/**
 * Starter presets and the style-weighted randomizer behind the creator's
 * "Minimal ↔ Playful" slider. Randomizing picks from curated catalog options (never invents
 * meshes) and keeps outfits coordinated: one hero colour, neutrals around it.
 */
import {
  ACCESSORIES,
  type AccessoryId,
  type AvatarConfig,
  AVATAR_CONFIG_VERSION,
  BOTTOMS,
  BROW_STYLES,
  type CatalogOption,
  CLOTH_COLORS,
  type ClothColorId,
  DEFAULT_AVATAR,
  DETAILS,
  EYE_COLORS,
  EYE_STYLES,
  FACE_SHAPES,
  HAIR_COLORS,
  HAIR_STYLES,
  LIP_COLORS,
  METALS,
  MOUTH_STYLES,
  NOSE_STYLES,
  SHOES,
  SKIN_TONES,
  TOPS,
  normalizeAccessories,
  slotOf,
} from "./catalog";

export interface AvatarPreset {
  id: string;
  label: string;
  blurb: string;
  config: AvatarConfig;
}

const preset = (
  id: string,
  label: string,
  blurb: string,
  patch: Partial<AvatarConfig>,
): AvatarPreset => ({
  id,
  label,
  blurb,
  config: { ...DEFAULT_AVATAR, ...patch, v: AVATAR_CONFIG_VERSION },
});

export const AVATAR_PRESETS: readonly AvatarPreset[] = [
  preset("cozy_reader", "Cozy Reader", "Knit sweater, round glasses, a pot of tea nearby.", {}),
  preset("night_owl", "Night Owl", "Hoodie up, headphones on, deadlines handled.", {
    skin: "caramel",
    eyes: "sleepy",
    eyeColor: "dark",
    brows: "straight",
    browColor: "ink",
    mouth: "soft",
    hair: "crop",
    hairColor: "ink",
    top: "hoodie",
    topColor: "ink",
    topAccent: "charcoal",
    bottom: "chinos",
    bottomColor: "charcoal",
    shoes: "sneakers",
    shoesColor: "white",
    accessories: ["headphones"],
    accessoryColor: "teal",
    metal: "silver",
    build: -0.2,
  }),
  preset("campus_runner", "Campus Runner", "Varsity jacket, ponytail, always ten minutes early.", {
    skin: "golden",
    face: "heart",
    eyes: "almond",
    eyeColor: "hazel",
    brows: "arched",
    browColor: "espresso",
    mouth: "grin",
    hair: "ponytail",
    hairColor: "espresso",
    hairAccent: "white",
    top: "jacket",
    topColor: "tomato",
    topAccent: "cream",
    bottom: "shorts",
    bottomColor: "navy",
    shoes: "sneakers",
    shoesColor: "white",
    accessories: ["cap", "backpack"],
    accessoryColor: "navy",
    build: 0.3,
    height: 0.4,
  }),
  preset("studio_artist", "Studio Artist", "Space buns, paint-stained cardigan, big ideas.", {
    skin: "porcelain",
    face: "round",
    eyes: "sparkle",
    eyeColor: "green",
    brows: "soft",
    browColor: "copper",
    mouth: "smile",
    lipColor: "coral",
    hair: "spacebuns",
    hairColor: "copper",
    hairAccent: "lilac",
    top: "cardigan",
    topColor: "mustard",
    topAccent: "white",
    bottom: "skirt",
    bottomColor: "plum",
    shoes: "boots",
    shoesColor: "charcoal",
    accessories: ["earrings", "hair_clip"],
    accessoryColor: "rose",
    metal: "rose_gold",
    details: ["freckles", "blush"],
    height: -0.3,
  }),
  preset("minimal", "Minimal", "Crisp button-up, clean lines, nothing extra.", {
    skin: "cocoa",
    face: "long",
    eyes: "almond",
    eyeColor: "brown",
    brows: "straight",
    browColor: "ink",
    mouth: "soft",
    nose: "soft",
    hair: "buzz",
    hairColor: "ink",
    top: "shirt",
    topColor: "white",
    topAccent: "white",
    bottom: "chinos",
    bottomColor: "oat",
    shoes: "loafers",
    shoesColor: "charcoal",
    accessories: ["glasses_square"],
    accessoryColor: "charcoal",
    metal: "silver",
  }),
  preset("colorful", "Colorful", "Mint twists, a lime tee and star stickers for luck.", {
    skin: "espresso",
    face: "round",
    eyes: "sparkle",
    eyeColor: "teal",
    brows: "bold",
    browColor: "ink",
    mouth: "grin",
    lipColor: "berry",
    nose: "pointed",
    hair: "twists",
    hairColor: "mint",
    hairAccent: "tomato",
    top: "tshirt",
    topColor: "lime",
    topAccent: "lilac",
    bottom: "jeans",
    bottomColor: "lilac",
    shoes: "boots",
    shoesColor: "tomato",
    accessories: ["headphones", "necklace"],
    accessoryColor: "sky",
    metal: "gold",
    details: ["stars"],
    build: 0.1,
  }),
];

// ---------------------------------------------------------------------------
// Randomizer
// ---------------------------------------------------------------------------

/** A seedable PRNG (mulberry32) so a randomized look can be reproduced and tested. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** How strongly an option of `flair` fits the requested `style` (both in [0, 1]). */
export function styleWeight(flair: number, style: number): number {
  const d = flair - style;
  return 0.03 + Math.exp(-(d * d) / (2 * 0.26 * 0.26));
}

function pick<T extends CatalogOption>(
  options: readonly T[],
  style: number,
  rnd: () => number,
  filter?: (o: T) => boolean,
): T {
  const pool = filter ? options.filter(filter) : options;
  const weights = pool.map((o) => styleWeight(o.flair, style));
  let r = rnd() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return pool[i]!;
  }
  return pool[pool.length - 1]!;
}

const NEUTRALS: readonly ClothColorId[] = [
  "white",
  "cream",
  "oat",
  "charcoal",
  "ink",
  "navy",
  "denim",
];
const isNeutral = (o: { id: string }) => (NEUTRALS as readonly string[]).includes(o.id);

/**
 * A coordinated random avatar. `style` 0 = minimal (classic shapes, neutrals, few extras),
 * 1 = playful (bold hair colours, sparkle eyes, stickers, more accessories).
 */
export function randomAvatar(style: number, rnd: () => number = Math.random): AvatarConfig {
  const s = Math.max(0, Math.min(1, style));
  const hairColor = pick(HAIR_COLORS, s, rnd);
  // Brows follow natural hair colours; with fantasy hair they stay a dark natural shade.
  const browColor =
    hairColor.flair > 0.6 ? pick(HAIR_COLORS, 0.1, rnd, (o) => o.flair <= 0.2) : hairColor;

  // Outfit: one hero colour on top (or bottom), the rest leaning neutral; playful looks
  // allow a second bright piece.
  const hero = pick(CLOTH_COLORS, Math.max(s, 0.25), rnd, (o) => !isNeutral(o));
  const secondBright = rnd() < s * 0.7;
  const neutral = () => pick(CLOTH_COLORS, 0.1, rnd, isNeutral).id;
  const heroOnTop = rnd() < 0.75;
  const topColor = heroOnTop ? hero.id : neutral();
  const bottomColor = heroOnTop
    ? secondBright
      ? pick(CLOTH_COLORS, s, rnd, (o) => o.id !== hero.id).id
      : neutral()
    : hero.id;

  // Accessories: roughly 0–1 when minimal, 2–3 when playful, never two in one slot.
  const wanted = Math.round(s * 2.4 + rnd() * 0.9 - 0.2);
  let accessories: AccessoryId[] = [];
  for (let i = 0; i < 8 && accessories.length < wanted; i++) {
    const taken = new Set(accessories.map(slotOf));
    const choice = pick(ACCESSORIES, s, rnd, (a) => !taken.has(a.slot));
    accessories = normalizeAccessories([...accessories, choice.id]);
  }

  const detailCount = Math.floor(rnd() * (0.5 + 2.2 * s));
  const details = new Set<AvatarConfig["details"][number]>();
  for (let i = 0; i < detailCount; i++) details.add(pick(DETAILS, s, rnd).id);

  return {
    v: AVATAR_CONFIG_VERSION,
    build: Math.round((rnd() * 2 - 1) * 0.7 * 100) / 100,
    height: Math.round((rnd() * 2 - 1) * 0.8 * 100) / 100,
    skin: SKIN_TONES[Math.floor(rnd() * SKIN_TONES.length)]!.id,
    face: pick(FACE_SHAPES, s, rnd).id,
    eyes: pick(EYE_STYLES, s, rnd).id,
    eyeColor: pick(EYE_COLORS, s, rnd).id,
    brows: pick(BROW_STYLES, s, rnd).id,
    browColor: browColor.id,
    mouth: pick(MOUTH_STYLES, s, rnd).id,
    lipColor: pick(LIP_COLORS, s, rnd).id,
    nose: pick(NOSE_STYLES, s, rnd).id,
    hair: pick(HAIR_STYLES, s, rnd).id,
    hairColor: hairColor.id,
    hairAccent: pick(CLOTH_COLORS, Math.max(s, 0.5), rnd, (o) => o.id !== hero.id).id,
    top: pick(TOPS, s, rnd).id,
    topColor,
    topAccent:
      rnd() < 0.5 + s * 0.3 ? pick(CLOTH_COLORS, s, rnd, (o) => o.id !== topColor).id : neutral(),
    bottom: pick(BOTTOMS, s, rnd).id,
    bottomColor,
    shoes: pick(SHOES, s, rnd).id,
    shoesColor: rnd() < 0.3 + s * 0.4 ? pick(CLOTH_COLORS, s, rnd).id : neutral(),
    accessories,
    accessoryColor: pick(CLOTH_COLORS, s, rnd, (o) => o.id !== topColor).id,
    metal: pick(METALS, s, rnd).id,
    details: [...details],
  };
}
