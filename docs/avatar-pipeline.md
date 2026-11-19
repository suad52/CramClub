# Avatar pipeline

Every avatar part is modelled in Blender by Python scripts in `art/avatars/scripts/`, exported
as one skinned GLB and assembled in the browser from a small `AvatarConfig`. This page is the
contract between the two halves. Rename something on one side only and
`apps/web/lib/avatar/kit.test.ts` fails.

```
art/avatars/scripts/*.py ──Blender──► art/avatars/build/avatar-kit.raw.glb
                                     art/avatars/blender/avatar_kit.blend  (editable)
                                     apps/web/public/models/avatars/kit-manifest.json
                                     apps/web/public/avatars/thumbs/<category>/<id>.webp
avatar-kit.raw.glb ──gltf-transform meshopt──► apps/web/public/models/avatars/avatar-kit.glb (~2 MB)
```

## Building

```bash
pnpm avatar:build
```

This needs Blender 5.3. It uses `/Applications/Blender.app` unless `BLENDER` points elsewhere.
A full build takes about 15 seconds: the parts, the `.blend`, the GLB, the manifest and 56
thumbnails. `pnpm avatar:pack` re-runs only the meshopt compression step.

For quick looks while modelling, without exporting anything:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python art/avatars/scripts/build_kit.py -- --preview /tmp/kit --preview-mode hair --only bun,spacebuns
```

`--preview-mode` is `hair`, `outfits` or `acc`.

## Scripts

| File             | What it builds                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------- |
| `kit_core.py`    | Rig, materials, mesh helpers (tubes, rounded boxes, shells), region-aware skinning, build morphs            |
| `kit_body.py`    | Skin-modifier body split into regions, head with face-shape morphs, eyes, brows, mouth, noses, face details |
| `kit_hair.py`    | Ten hairstyles on a smooth parametric scalp shell (hairline follows a curve, so there's no stair-stepping)  |
| `kit_clothes.py` | Tops, bottoms and shoes, "shrink-wrapped" from the body regions they cover, with ribbed hems and trims      |
| `kit_acc.py`     | Glasses, headphones, a knit beanie, a cap, a hair clip, hoops, a pendant, a scarf and a backpack            |
| `kit_render.py`  | Studio lights, camera framings and EEVEE rendering for previews and thumbnails                              |
| `build_kit.py`   | Builds everything, then saves the `.blend` and exports the GLB, manifest and thumbnails                     |

## Conventions

- **Units and axes:** metres. In Blender, Z is up, the character faces −Y and their left is +X.
  In glTF/three.js, Y is up and the character faces +Z.
- **One armature, `Avatar_Rig`:** `Root, Hips, Spine, Chest, Neck, Head` plus `UpperArm`,
  `LowerArm`, `Hand`, `UpperLeg`, `LowerLeg` and `Foot` with `.L`/`.R` suffixes. GLTFLoader
  strips the dot (`UpperArmL`); `kitRig.ts` handles that.
- **Part names** are the visibility switch: `Body_<Region>`, `Head_Base`, `Mouth_Base`,
  `Eyes_<Style>`, `Brows_<Style>`, `Nose_<Style>`, `Hair_<Style>`, `Top_<Style>`,
  `Bottom_<Style>`, `Shoes_<Style>`, `Acc_<Id>` and `Detail_<Id>`. Ids are PascalCased
  (`glasses_round` becomes `Acc_GlassesRound`). A part with several materials exports as a
  group of meshes.
- **Materials** are recoloured by name at runtime. Each avatar clones its own copies. All 28
  names (`MAT_Skin`, `MAT_Hair`, `MAT_Top` and so on) are listed in `make_materials()`, and
  `resolveAvatar()` in `packages/shared/src/avatar/kit.ts` gives each one a colour.
- **Morph targets.** Blender 5 creates new shape keys at 1.0, so the build zeroes them all
  before export.
  - `Build_Broad` / `Build_Slim` are on the body and every garment, computed with the same
    formula so clothes follow the body slider.
  - `Face_Round` / `Face_Long` / `Face_Heart` are on the head.
  - `Blink_Left` / `Blink_Right` are on the eyes, and `Brow_Raise` is on the brows.
  - `Smile` / `Jaw_Open` / `Frown` are on the mouth. The mouth styles are presets of these
    three, and expression tracking adds on top.
- **Hidden skin:** each garment lists the body regions it covers (`TOP_HIDES` etc.). These
  regions are hidden so skin never pokes through. The manifest's `hidesBody` must equal
  `GARMENT_HIDES` in shared.

## Skinning

Weights are computed in the script, so every build gives the same result. Each vertex first
picks a body region, then gets inverse-distance weights from only that region's bones. Two
rules keep limbs from dragging the wrong things:

- **Body parts are fixed to their own region.** A thigh is never weighted to the hand hanging
  beside it.
- **Garments only see their own bone families.** Tops don't follow legs, and bottoms don't
  follow arms. A garment vertex only counts as "arm" when it's inside the sleeve (`ARM_REACH`),
  so an open cardigan front doesn't lift with a waving arm.

Head-mounted parts (face, hair, hats, glasses, earrings) are rigid to `Head`.

## Runtime

- `apps/web/lib/avatar/kitRig.ts` clones the kit per avatar (`SkeletonUtils.clone`, so
  geometry is shared) and records each bone's rest orientation. It also applies a config:
  visibility, colours, morphs and height scale.
- **Hats** clip the hair above a tilted plane through the hat band (`HAT_HAIR_CLIP`). The
  plane follows the head bone every frame, so any hairstyle works under a beanie or cap. This
  needs `renderer.localClippingEnabled`.
- **Poses** are written in the avatar's own axes as `poseBone(name, x, y, z)`, and children
  compose in their parent's rotated frame. The procedural idle, walk, run and sit animation
  carried over unchanged from the old code-built rig.
- The studio and the library use the same `<Avatar>` component, so what you design is
  exactly what walks around.

## Adding an option

1. Model it in the right `kit_*.py` and register it in that file's dict (`STYLES`, `TOPS`,
   `ACCESSORIES` and so on). For garments, add its hidden regions too.
2. Add it to the catalog in `packages/shared/src/avatar/catalog.ts` with a label and a `flair`
   (0 = minimal, 1 = playful). For a garment, also add it to `GARMENT_HIDES`.
3. Run `pnpm avatar:build`, then `pnpm test`. The contract tests catch missing parts,
   thumbnails or materials.
