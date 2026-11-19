import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCESSORIES,
  AVATAR_PRESETS,
  type AvatarConfig,
  BOTTOMS,
  DEFAULT_AVATAR,
  DETAILS,
  GARMENT_HIDES,
  HAIR_STYLES,
  SHOES,
  TOPS,
  resolveAvatar,
} from "@ovr/shared";
import { CATEGORIES, thumbUrl } from "@/components/creator/categories";
import { KIT_BONES } from "./kitRig";

/**
 * The Blender export and the web catalog are two halves of one contract. These checks read
 * the manifest written by `pnpm avatar:build` and fail if either side renames something.
 */
const PUBLIC = join(__dirname, "..", "..", "public");
const manifest = JSON.parse(
  readFileSync(join(PUBLIC, "models/avatars/kit-manifest.json"), "utf8"),
) as {
  bones: string[];
  parts: { name: string; materials: string[]; morphs: string[]; hidesBody: string[] }[];
};
const parts = new Map(manifest.parts.map((p) => [p.name, p]));

/** One config per option so every part gets resolved at least once. */
function everyLook(): AvatarConfig[] {
  const looks: AvatarConfig[] = [DEFAULT_AVATAR, ...AVATAR_PRESETS.map((p) => p.config)];
  for (const h of HAIR_STYLES) looks.push({ ...DEFAULT_AVATAR, hair: h.id });
  for (const t of TOPS) looks.push({ ...DEFAULT_AVATAR, top: t.id });
  for (const b of BOTTOMS) looks.push({ ...DEFAULT_AVATAR, bottom: b.id });
  for (const s of SHOES) looks.push({ ...DEFAULT_AVATAR, shoes: s.id });
  for (const a of ACCESSORIES) looks.push({ ...DEFAULT_AVATAR, accessories: [a.id] });
  looks.push({ ...DEFAULT_AVATAR, details: DETAILS.map((d) => d.id) });
  for (const c of CATEGORIES)
    for (const s of c.sections)
      if (s.kind === "tiles")
        for (const o of s.options) looks.push({ ...DEFAULT_AVATAR, [s.field]: o.id });
  return looks;
}

describe("avatar kit contract", () => {
  it("exports every bone the runtime poses", () => {
    for (const bone of KIT_BONES) expect(manifest.bones).toContain(bone);
  });

  it("has a mesh for every part a config can show", () => {
    for (const look of everyLook()) {
      for (const name of resolveAvatar(look).visible) expect(parts.has(name), name).toBe(true);
    }
  });

  it("agrees on which skin each garment hides", () => {
    for (const [name, hides] of Object.entries(GARMENT_HIDES)) {
      expect(parts.get(name)?.hidesBody, name).toEqual([...hides]);
    }
  });

  it("colours only materials that exist, and covers every kit material", () => {
    const kitMaterials = new Set(manifest.parts.flatMap((p) => p.materials));
    const colored = Object.keys(resolveAvatar(DEFAULT_AVATAR).materials);
    for (const m of colored) expect(kitMaterials.has(m), m).toBe(true);
    for (const m of kitMaterials) expect(colored, m).toContain(m);
  });

  it("has the morph targets the runtime drives", () => {
    const morphs = (name: string) => parts.get(name)?.morphs ?? [];
    expect(morphs("Head_Base")).toEqual(
      expect.arrayContaining(["Face_Round", "Face_Long", "Face_Heart"]),
    );
    expect(morphs("Mouth_Base")).toEqual(expect.arrayContaining(["Smile", "Jaw_Open", "Frown"]));
    for (const p of manifest.parts) {
      if (p.name.startsWith("Eyes_"))
        expect(p.morphs).toEqual(expect.arrayContaining(["Blink_Left", "Blink_Right"]));
      if (p.name.startsWith("Brows_")) expect(p.morphs).toContain("Brow_Raise");
      if (/^(Body|Top|Bottom|Shoes)_/.test(p.name))
        expect(p.morphs).toEqual(expect.arrayContaining(["Build_Broad", "Build_Slim"]));
    }
  });

  it("has a rendered thumbnail for every picture tile in the studio", () => {
    for (const c of CATEGORIES) {
      for (const s of c.sections) {
        if (s.kind !== "tiles" && s.kind !== "multi") continue;
        for (const o of s.options) {
          const file = join(PUBLIC, thumbUrl(s.thumbs, o.id));
          expect(existsSync(file), file).toBe(true);
        }
      }
    }
  });
});
