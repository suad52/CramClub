/**
 * The avatar option catalog (config v2). Every option id here matches a part in the Blender
 * avatar kit (art/avatars/scripts, exported to apps/web/public/models/avatars/avatar-kit.glb),
 * so this is the single list the creator UI, the 3D runtime and the game server agree on.
 *
 * `flair` places each option on the creator's Minimal (0) ↔ Playful (1) style axis; the
 * randomizer weights its picks by how close an option's flair is to the chosen style.
 */

export interface CatalogOption<Id extends string = string> {
  id: Id;
  label: string;
  /** 0 = minimal / classic, 1 = playful / expressive. */
  flair: number;
}

export interface ColorOption<Id extends string = string> extends CatalogOption<Id> {
  /** Hex colour, e.g. "#c98f6b". */
  color: string;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

export const SKIN_TONES = [
  { id: "porcelain", label: "Porcelain", color: "#f6dcc8", flair: 0.3 },
  { id: "ivory", label: "Ivory", color: "#f1d0b4", flair: 0.3 },
  { id: "peach", label: "Peach", color: "#efc3a0", flair: 0.3 },
  { id: "sand", label: "Sand", color: "#e3b48c", flair: 0.3 },
  { id: "honey", label: "Honey", color: "#d9a27a", flair: 0.3 },
  { id: "golden", label: "Golden", color: "#c98d5e", flair: 0.3 },
  { id: "caramel", label: "Caramel", color: "#b97c55", flair: 0.3 },
  { id: "bronze", label: "Bronze", color: "#9c6640", flair: 0.3 },
  { id: "cocoa", label: "Cocoa", color: "#8a5638", flair: 0.3 },
  { id: "espresso", label: "Espresso", color: "#5e3a26", flair: 0.3 },
] as const satisfies readonly ColorOption[];

export const EYE_COLORS = [
  { id: "brown", label: "Brown", color: "#5a3a28", flair: 0.1 },
  { id: "dark", label: "Dark brown", color: "#3a2418", flair: 0.1 },
  { id: "hazel", label: "Hazel", color: "#7a6a3a", flair: 0.25 },
  { id: "amber", label: "Amber", color: "#a8722a", flair: 0.45 },
  { id: "green", label: "Green", color: "#4f7a4a", flair: 0.4 },
  { id: "blue", label: "Blue", color: "#4a6f9a", flair: 0.35 },
  { id: "grey", label: "Grey", color: "#78838c", flair: 0.35 },
  { id: "violet", label: "Violet", color: "#7a5aa8", flair: 0.95 },
  { id: "teal", label: "Teal", color: "#2f8a86", flair: 0.85 },
] as const satisfies readonly ColorOption[];

export const HAIR_COLORS = [
  { id: "ink", label: "Ink", color: "#231c1a", flair: 0.1 },
  { id: "espresso", label: "Espresso", color: "#3a2519", flair: 0.1 },
  { id: "chestnut", label: "Chestnut", color: "#5b3524", flair: 0.15 },
  { id: "auburn", label: "Auburn", color: "#8c3f26", flair: 0.35 },
  { id: "copper", label: "Copper", color: "#b05a2e", flair: 0.45 },
  { id: "honey", label: "Honey blonde", color: "#c99a55", flair: 0.3 },
  { id: "platinum", label: "Platinum", color: "#e6dcc4", flair: 0.55 },
  { id: "silver", label: "Silver", color: "#c9c4c0", flair: 0.5 },
  { id: "rose", label: "Rose", color: "#d98a9a", flair: 0.9 },
  { id: "lavender", label: "Lavender", color: "#a58fd0", flair: 0.95 },
  { id: "mint", label: "Mint", color: "#7fc4a8", flair: 1 },
  { id: "sky", label: "Sky", color: "#6fa8dc", flair: 1 },
  { id: "cherry", label: "Cherry", color: "#b0303a", flair: 0.9 },
  // v1 id kept so saved v1 avatars migrate cleanly.
  { id: "plum", label: "Plum", color: "#5e3552", flair: 0.7 },
] as const satisfies readonly ColorOption[];

export const LIP_COLORS = [
  { id: "natural", label: "Natural", color: "#b0645a", flair: 0.1 },
  { id: "nude", label: "Nude", color: "#c08070", flair: 0.15 },
  { id: "rosy", label: "Rosy", color: "#c45a62", flair: 0.4 },
  { id: "coral", label: "Coral", color: "#e0705a", flair: 0.6 },
  { id: "berry", label: "Berry", color: "#8a2f4a", flair: 0.75 },
  { id: "plum", label: "Plum", color: "#5e2a4a", flair: 0.85 },
] as const satisfies readonly ColorOption[];

/** One cosy palette shared by every piece of clothing and accessory. */
export const CLOTH_COLORS = [
  { id: "white", label: "Chalk", color: "#f2ede4", flair: 0.05 },
  { id: "cream", label: "Cream", color: "#eadfca", flair: 0.1 },
  { id: "oat", label: "Oat", color: "#cdb89a", flair: 0.1 },
  { id: "charcoal", label: "Charcoal", color: "#3a3a3e", flair: 0.05 },
  { id: "ink", label: "Ink", color: "#22283a", flair: 0.1 },
  { id: "navy", label: "Navy", color: "#3a4a6b", flair: 0.15 },
  { id: "denim", label: "Denim", color: "#4e6a8e", flair: 0.2 },
  { id: "sage", label: "Sage", color: "#8fa58a", flair: 0.3 },
  { id: "moss", label: "Moss", color: "#5e6e3e", flair: 0.35 },
  { id: "teal", label: "Teal", color: "#3f7f7a", flair: 0.5 },
  { id: "sky", label: "Sky", color: "#8fb8dc", flair: 0.6 },
  { id: "plum", label: "Plum", color: "#7a4a6a", flair: 0.55 },
  { id: "rose", label: "Rose", color: "#e0a0a8", flair: 0.7 },
  { id: "rust", label: "Rust", color: "#b5643f", flair: 0.5 },
  { id: "mustard", label: "Mustard", color: "#d1a24a", flair: 0.6 },
  { id: "tomato", label: "Tomato", color: "#d0473a", flair: 0.85 },
  { id: "lilac", label: "Lilac", color: "#b3a0d8", flair: 0.85 },
  { id: "lime", label: "Lime", color: "#a8c84a", flair: 1 },
] as const satisfies readonly ColorOption[];

export const METALS = [
  { id: "gold", label: "Gold", color: "#d4af37", flair: 0.4 },
  { id: "silver", label: "Silver", color: "#c8ccd2", flair: 0.3 },
  { id: "rose_gold", label: "Rose gold", color: "#d79a86", flair: 0.6 },
] as const satisfies readonly ColorOption[];

// ---------------------------------------------------------------------------
// Shapes and styles (each id is a Blender kit part or morph preset)
// ---------------------------------------------------------------------------

export const FACE_SHAPES = [
  { id: "oval", label: "Oval", flair: 0.3 },
  { id: "round", label: "Round", flair: 0.5 },
  { id: "long", label: "Long", flair: 0.3 },
  { id: "heart", label: "Heart", flair: 0.5 },
] as const satisfies readonly CatalogOption[];

export const EYE_STYLES = [
  { id: "round", label: "Round", flair: 0.3 },
  { id: "almond", label: "Almond", flair: 0.2 },
  { id: "sleepy", label: "Sleepy", flair: 0.5 },
  { id: "sparkle", label: "Sparkle", flair: 0.95 },
] as const satisfies readonly CatalogOption[];

export const BROW_STYLES = [
  { id: "soft", label: "Soft", flair: 0.2 },
  { id: "straight", label: "Straight", flair: 0.1 },
  { id: "arched", label: "Arched", flair: 0.5 },
  { id: "bold", label: "Bold", flair: 0.65 },
] as const satisfies readonly CatalogOption[];

export const MOUTH_STYLES = [
  { id: "soft", label: "Soft", flair: 0.1 },
  { id: "smile", label: "Smile", flair: 0.4 },
  { id: "grin", label: "Grin", flair: 0.85 },
  { id: "pout", label: "Pout", flair: 0.7 },
] as const satisfies readonly CatalogOption[];

export const NOSE_STYLES = [
  { id: "button", label: "Button", flair: 0.45 },
  { id: "soft", label: "Soft", flair: 0.2 },
  { id: "pointed", label: "Pointed", flair: 0.5 },
] as const satisfies readonly CatalogOption[];

export const HAIR_STYLES = [
  { id: "crop", label: "Short crop", flair: 0.2 },
  { id: "buzz", label: "Buzz", flair: 0.1 },
  { id: "bob", label: "Bob", flair: 0.35 },
  { id: "long", label: "Long & straight", flair: 0.3 },
  { id: "curly", label: "Curls", flair: 0.55 },
  { id: "bun", label: "Top bun", flair: 0.45 },
  { id: "ponytail", label: "Ponytail", flair: 0.35 },
  { id: "twists", label: "Twists", flair: 0.6 },
  { id: "swept", label: "Swept fringe", flair: 0.5 },
  { id: "spacebuns", label: "Space buns", flair: 0.95 },
] as const satisfies readonly CatalogOption[];

export const TOPS = [
  { id: "tshirt", label: "Tee", flair: 0.2 },
  { id: "hoodie", label: "Hoodie", flair: 0.4 },
  { id: "sweater", label: "Knit sweater", flair: 0.2 },
  { id: "cardigan", label: "Cardigan & tee", flair: 0.4 },
  { id: "jacket", label: "Varsity jacket", flair: 0.8 },
  { id: "shirt", label: "Button-up", flair: 0.1 },
] as const satisfies readonly CatalogOption[];

export const BOTTOMS = [
  { id: "jeans", label: "Jeans", flair: 0.2 },
  { id: "chinos", label: "Chinos", flair: 0.1 },
  { id: "shorts", label: "Shorts", flair: 0.6 },
  { id: "skirt", label: "A-line skirt", flair: 0.6 },
] as const satisfies readonly CatalogOption[];

export const SHOES = [
  { id: "sneakers", label: "Sneakers", flair: 0.4 },
  { id: "boots", label: "Lace-up boots", flair: 0.5 },
  { id: "loafers", label: "Loafers", flair: 0.2 },
] as const satisfies readonly CatalogOption[];

/** Where an accessory sits. Only one accessory per slot. */
export type AccessorySlot = "eyes" | "head" | "hair" | "ears" | "neck" | "back";

export const ACCESSORIES = [
  { id: "glasses_round", label: "Round glasses", slot: "eyes", flair: 0.3 },
  { id: "glasses_square", label: "Square frames", slot: "eyes", flair: 0.2 },
  { id: "headphones", label: "Headphones", slot: "head", flair: 0.6 },
  { id: "beanie", label: "Beanie", slot: "head", flair: 0.5 },
  { id: "cap", label: "Baseball cap", slot: "head", flair: 0.55 },
  { id: "hair_clip", label: "Hair clip", slot: "hair", flair: 0.75 },
  { id: "earrings", label: "Hoops", slot: "ears", flair: 0.6 },
  { id: "necklace", label: "Pendant", slot: "neck", flair: 0.45 },
  { id: "scarf", label: "Scarf", slot: "neck", flair: 0.5 },
  { id: "backpack", label: "Backpack", slot: "back", flair: 0.3 },
] as const satisfies readonly (CatalogOption & { slot: AccessorySlot })[];

export const DETAILS = [
  { id: "freckles", label: "Freckles", flair: 0.5 },
  { id: "blush", label: "Blush", flair: 0.6 },
  { id: "beauty_mark", label: "Beauty mark", flair: 0.4 },
  { id: "stars", label: "Star stickers", flair: 1 },
] as const satisfies readonly CatalogOption[];

export type SkinToneId = (typeof SKIN_TONES)[number]["id"];
export type EyeColorId = (typeof EYE_COLORS)[number]["id"];
export type HairColorId = (typeof HAIR_COLORS)[number]["id"];
export type LipColorId = (typeof LIP_COLORS)[number]["id"];
export type ClothColorId = (typeof CLOTH_COLORS)[number]["id"];
export type MetalId = (typeof METALS)[number]["id"];
export type FaceShapeId = (typeof FACE_SHAPES)[number]["id"];
export type EyeStyleId = (typeof EYE_STYLES)[number]["id"];
export type BrowStyleId = (typeof BROW_STYLES)[number]["id"];
export type MouthStyleId = (typeof MOUTH_STYLES)[number]["id"];
export type NoseStyleId = (typeof NOSE_STYLES)[number]["id"];
export type HairStyleId = (typeof HAIR_STYLES)[number]["id"];
export type TopId = (typeof TOPS)[number]["id"];
export type BottomId = (typeof BOTTOMS)[number]["id"];
export type ShoesId = (typeof SHOES)[number]["id"];
export type AccessoryId = (typeof ACCESSORIES)[number]["id"];
export type DetailId = (typeof DETAILS)[number]["id"];

export const AVATAR_CONFIG_VERSION = 2;

/** A player's avatar: short, validatable ids plus two body sliders. */
export interface AvatarConfig {
  v: typeof AVATAR_CONFIG_VERSION;
  /** -1 = slim … 0 = average … 1 = broad. */
  build: number;
  /** -1 = shortest … 1 = tallest (a gentle ±6% scale). */
  height: number;
  skin: SkinToneId;
  face: FaceShapeId;
  eyes: EyeStyleId;
  eyeColor: EyeColorId;
  brows: BrowStyleId;
  browColor: HairColorId;
  mouth: MouthStyleId;
  lipColor: LipColorId;
  nose: NoseStyleId;
  hair: HairStyleId;
  hairColor: HairColorId;
  /** Hair ties, scrunchies and clips. */
  hairAccent: ClothColorId;
  top: TopId;
  topColor: ClothColorId;
  /** Sleeves, inner tee and patches, where the top has them. */
  topAccent: ClothColorId;
  bottom: BottomId;
  bottomColor: ClothColorId;
  shoes: ShoesId;
  shoesColor: ClothColorId;
  /** At most one per slot, in the order the player added them. */
  accessories: AccessoryId[];
  accessoryColor: ClothColorId;
  metal: MetalId;
  details: DetailId[];
}

export const DEFAULT_AVATAR: AvatarConfig = {
  v: AVATAR_CONFIG_VERSION,
  build: 0,
  height: 0,
  skin: "honey",
  face: "oval",
  eyes: "round",
  eyeColor: "brown",
  brows: "soft",
  browColor: "chestnut",
  mouth: "smile",
  lipColor: "natural",
  nose: "button",
  hair: "bob",
  hairColor: "chestnut",
  hairAccent: "tomato",
  top: "sweater",
  topColor: "sage",
  topAccent: "cream",
  bottom: "jeans",
  bottomColor: "denim",
  shoes: "sneakers",
  shoesColor: "white",
  accessories: ["glasses_round"],
  accessoryColor: "mustard",
  metal: "gold",
  details: [],
};

/** The option list behind each id field, for validation and the creator UI. */
export const AVATAR_FIELDS = {
  skin: SKIN_TONES,
  face: FACE_SHAPES,
  eyes: EYE_STYLES,
  eyeColor: EYE_COLORS,
  brows: BROW_STYLES,
  browColor: HAIR_COLORS,
  mouth: MOUTH_STYLES,
  lipColor: LIP_COLORS,
  nose: NOSE_STYLES,
  hair: HAIR_STYLES,
  hairColor: HAIR_COLORS,
  hairAccent: CLOTH_COLORS,
  top: TOPS,
  topColor: CLOTH_COLORS,
  topAccent: CLOTH_COLORS,
  bottom: BOTTOMS,
  bottomColor: CLOTH_COLORS,
  shoes: SHOES,
  shoesColor: CLOTH_COLORS,
  accessoryColor: CLOTH_COLORS,
  metal: METALS,
} as const satisfies Record<string, readonly CatalogOption[]>;

export type AvatarIdField = keyof typeof AVATAR_FIELDS;

const has = <T extends { id: string }>(options: readonly T[], id: unknown): id is T["id"] =>
  typeof id === "string" && options.some((o) => o.id === id);

export const slotOf = (id: AccessoryId): AccessorySlot =>
  ACCESSORIES.find((a) => a.id === id)?.slot ?? "head";

const isSlider = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n >= -1 && n <= 1;

/** True when `value` is a complete, valid v2 config. */
export function isAvatarConfig(value: unknown): value is AvatarConfig {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.v !== AVATAR_CONFIG_VERSION || !isSlider(v.build) || !isSlider(v.height)) return false;
  for (const [field, options] of Object.entries(AVATAR_FIELDS) as [
    string,
    readonly CatalogOption[],
  ][]) {
    if (!has(options, v[field])) return false;
  }
  if (!Array.isArray(v.accessories) || !Array.isArray(v.details)) return false;
  if (
    !v.accessories.every((a) => has(ACCESSORIES, a)) ||
    !v.details.every((d) => has(DETAILS, d))
  ) {
    return false;
  }
  const slots = (v.accessories as AccessoryId[]).map(slotOf);
  return new Set(slots).size === slots.length && new Set(v.details).size === v.details.length;
}

/** Keeps one accessory per slot (the later one wins) and drops duplicates. */
export function normalizeAccessories(ids: readonly AccessoryId[]): AccessoryId[] {
  const bySlot = new Map<AccessorySlot, AccessoryId>();
  for (const id of ids) {
    bySlot.delete(slotOf(id));
    bySlot.set(slotOf(id), id);
  }
  return [...bySlot.values()];
}

/** v1 ids that were renamed in v2. */
const V1_RENAMES: Record<string, string> = { curls: "curly", glasses: "glasses_round" };

/** Turns a saved v1 config ({ base, hair, hairColor, outfit, outfitColor, accessory }) into v2 fields. */
function fromV1(v: Record<string, unknown>): Record<string, unknown> {
  const rename = (id: unknown) => (typeof id === "string" ? (V1_RENAMES[id] ?? id) : id);
  const accessory = rename(v.accessory);
  return {
    skin: v.base,
    hair: rename(v.hair),
    hairColor: v.hairColor,
    browColor: v.hairColor,
    top: v.outfit,
    topColor: v.outfitColor,
    accessories: accessory && accessory !== "none" ? [accessory] : [],
  };
}

/**
 * Keeps known fields, replaces anything unknown with the default, enforces one accessory per
 * slot and migrates v1 configs. Safe for untrusted input (localStorage, the network).
 */
export function sanitizeAvatarConfig(value: unknown): AvatarConfig {
  let v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  if (v.v !== AVATAR_CONFIG_VERSION && "base" in v) v = fromV1(v);
  const out: Record<string, unknown> = { v: AVATAR_CONFIG_VERSION };
  out.build =
    typeof v.build === "number" && Number.isFinite(v.build)
      ? Math.max(-1, Math.min(1, v.build))
      : 0;
  out.height =
    typeof v.height === "number" && Number.isFinite(v.height)
      ? Math.max(-1, Math.min(1, v.height))
      : 0;
  for (const [field, options] of Object.entries(AVATAR_FIELDS) as [
    string,
    readonly CatalogOption[],
  ][]) {
    out[field] = has(options, v[field]) ? v[field] : DEFAULT_AVATAR[field as AvatarIdField];
  }
  const accessories = Array.isArray(v.accessories)
    ? v.accessories.filter((a) => has(ACCESSORIES, a))
    : DEFAULT_AVATAR.accessories;
  out.accessories = normalizeAccessories(accessories as AccessoryId[]);
  const details = Array.isArray(v.details) ? v.details.filter((d) => has(DETAILS, d)) : [];
  out.details = [...new Set(details as DetailId[])];
  return out as unknown as AvatarConfig;
}

/** Looks up the hex colour for a colour option id. */
export function colorOf<Id extends string>(options: readonly ColorOption<Id>[], id: Id): string {
  const found = options.find((o) => o.id === id);
  if (!found) throw new Error(`Unknown colour option: ${id}`);
  return found.color;
}

/** Label for any option id in a list (falls back to the id). */
export function labelOf(options: readonly CatalogOption[], id: string): string {
  return options.find((o) => o.id === id)?.label ?? id;
}
