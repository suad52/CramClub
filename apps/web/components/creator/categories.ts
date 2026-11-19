import {
  ACCESSORIES,
  type AvatarIdField,
  BOTTOMS,
  BROW_STYLES,
  type CatalogOption,
  CLOTH_COLORS,
  type ColorOption,
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
} from "@ovr/shared";

/** Where the studio camera looks for a category: height of interest and distance. */
export interface Framing {
  y: number;
  distance: number;
}

export const FRAMINGS = {
  // Targets sit a little low so the avatar clears the preview toolbar at the bottom.
  full: { y: 0.64, distance: 5.6 },
  face: { y: 1.56, distance: 1.1 },
  head: { y: 1.44, distance: 1.95 },
  torso: { y: 1.04, distance: 2.7 },
  legs: { y: 0.4, distance: 3.1 },
  feet: { y: 0.06, distance: 1.9 },
} satisfies Record<string, Framing>;

export type FramingId = keyof typeof FRAMINGS;

/** One block of controls inside a category panel. */
export type Section =
  | {
      kind: "tiles";
      title: string;
      field: AvatarIdField;
      options: readonly CatalogOption[];
      thumbs: string;
    }
  | {
      kind: "multi";
      title: string;
      field: "accessories" | "details";
      options: readonly CatalogOption[];
      thumbs: string;
      hint?: string;
    }
  | { kind: "swatches"; title: string; field: AvatarIdField; options: readonly ColorOption[] }
  | { kind: "slider"; title: string; field: "build" | "height"; left: string; right: string }
  | { kind: "presets" };

export type IconId =
  | "spark"
  | "body"
  | "skin"
  | "face"
  | "eye"
  | "brow"
  | "mouth"
  | "hair"
  | "top"
  | "bottom"
  | "shoe"
  | "glasses"
  | "star";

export interface Category {
  id: string;
  label: string;
  blurb: string;
  icon: IconId;
  framing: FramingId;
  sections: Section[];
}

export const CATEGORIES: Category[] = [
  {
    id: "presets",
    label: "Presets",
    blurb: "Start from a ready-made look, then make it yours.",
    icon: "spark",
    framing: "full",
    sections: [{ kind: "presets" }],
  },
  {
    id: "body",
    label: "Body",
    blurb: "Silhouette and height. Clothes follow every shape.",
    icon: "body",
    framing: "full",
    sections: [
      { kind: "slider", title: "Build", field: "build", left: "Slim", right: "Broad" },
      { kind: "slider", title: "Height", field: "height", left: "Shorter", right: "Taller" },
    ],
  },
  {
    id: "skin",
    label: "Skin",
    blurb: "Pick a tone; lips, blush and freckles adjust to match.",
    icon: "skin",
    framing: "head",
    sections: [{ kind: "swatches", title: "Skin tone", field: "skin", options: SKIN_TONES }],
  },
  {
    id: "face",
    label: "Face",
    blurb: "Face shape and nose.",
    icon: "face",
    framing: "face",
    sections: [
      { kind: "tiles", title: "Face shape", field: "face", options: FACE_SHAPES, thumbs: "face" },
      { kind: "tiles", title: "Nose", field: "nose", options: NOSE_STYLES, thumbs: "nose" },
    ],
  },
  {
    id: "eyes",
    label: "Eyes",
    blurb: "Eye shape and colour. They still blink and follow your face.",
    icon: "eye",
    framing: "face",
    sections: [
      { kind: "tiles", title: "Eye style", field: "eyes", options: EYE_STYLES, thumbs: "eyes" },
      { kind: "swatches", title: "Eye colour", field: "eyeColor", options: EYE_COLORS },
    ],
  },
  {
    id: "brows",
    label: "Brows",
    blurb: "Brows do a lot of the talking when expression tracking is on.",
    icon: "brow",
    framing: "face",
    sections: [
      { kind: "tiles", title: "Brow style", field: "brows", options: BROW_STYLES, thumbs: "brows" },
      { kind: "swatches", title: "Brow colour", field: "browColor", options: HAIR_COLORS },
    ],
  },
  {
    id: "mouth",
    label: "Mouth",
    blurb: "Your resting expression and lip colour.",
    icon: "mouth",
    framing: "face",
    sections: [
      {
        kind: "tiles",
        title: "Resting mouth",
        field: "mouth",
        options: MOUTH_STYLES,
        thumbs: "mouth",
      },
      { kind: "swatches", title: "Lip colour", field: "lipColor", options: LIP_COLORS },
    ],
  },
  {
    id: "hair",
    label: "Hair",
    blurb: "Ten styles, natural and not-so-natural colours.",
    icon: "hair",
    framing: "head",
    sections: [
      { kind: "tiles", title: "Hairstyle", field: "hair", options: HAIR_STYLES, thumbs: "hair" },
      { kind: "swatches", title: "Hair colour", field: "hairColor", options: HAIR_COLORS },
      { kind: "swatches", title: "Ties & scrunchies", field: "hairAccent", options: CLOTH_COLORS },
    ],
  },
  {
    id: "top",
    label: "Top",
    blurb: "Layers for long study sessions.",
    icon: "top",
    framing: "torso",
    sections: [
      { kind: "tiles", title: "Top", field: "top", options: TOPS, thumbs: "top" },
      { kind: "swatches", title: "Main colour", field: "topColor", options: CLOTH_COLORS },
      {
        kind: "swatches",
        title: "Accent (sleeves, inner tee)",
        field: "topAccent",
        options: CLOTH_COLORS,
      },
    ],
  },
  {
    id: "bottom",
    label: "Bottom",
    blurb: "Jeans, chinos, shorts or a skirt.",
    icon: "bottom",
    framing: "legs",
    sections: [
      { kind: "tiles", title: "Bottom", field: "bottom", options: BOTTOMS, thumbs: "bottom" },
      { kind: "swatches", title: "Colour", field: "bottomColor", options: CLOTH_COLORS },
    ],
  },
  {
    id: "shoes",
    label: "Shoes",
    blurb: "Soles switch to gum or cream to suit the colour.",
    icon: "shoe",
    framing: "feet",
    sections: [
      { kind: "tiles", title: "Shoes", field: "shoes", options: SHOES, thumbs: "shoes" },
      { kind: "swatches", title: "Colour", field: "shoesColor", options: CLOTH_COLORS },
    ],
  },
  {
    id: "accessories",
    label: "Extras",
    blurb: "Mix and match: one per spot (eyes, head, hair, ears, neck, back).",
    icon: "glasses",
    framing: "head",
    sections: [
      {
        kind: "multi",
        title: "Accessories",
        field: "accessories",
        options: ACCESSORIES,
        thumbs: "accessories",
        hint: "Hats tuck your hair in underneath.",
      },
      {
        kind: "swatches",
        title: "Accessory colour",
        field: "accessoryColor",
        options: CLOTH_COLORS,
      },
      { kind: "swatches", title: "Metal", field: "metal", options: METALS },
    ],
  },
  {
    id: "details",
    label: "Details",
    blurb: "Little finishing touches.",
    icon: "star",
    framing: "face",
    sections: [
      {
        kind: "multi",
        title: "Face details",
        field: "details",
        options: DETAILS,
        thumbs: "details",
      },
    ],
  },
];

export const thumbUrl = (folder: string, id: string) => `/avatars/thumbs/${folder}/${id}.webp`;
