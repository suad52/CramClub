"""
Builds the OVR avatar kit in Blender and exports it for the web app.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \\
        --python art/avatars/scripts/build_kit.py -- [--no-thumbs] [--preview DIR --preview-mode hair|outfits|acc --only a,b]

(or `pnpm avatar:build` from the repository root)

Outputs (relative to the repository root):
  art/avatars/build/avatar-kit.raw.glb                every part, skinned to one armature
  apps/web/public/models/avatars/avatar-kit.glb       the same, meshopt-compressed (by `pnpm avatar:build`)
  apps/web/public/models/avatars/kit-manifest.json    parts, materials, morphs, bones, hidden body regions
  apps/web/public/avatars/thumbs/<category>/<id>.webp option thumbnails for the creator
  art/avatars/blender/avatar_kit.blend                the editable Blender file
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import kit_acc  # noqa: E402
import kit_body  # noqa: E402
import kit_clothes  # noqa: E402
import kit_core  # noqa: E402
import kit_hair  # noqa: E402
import kit_render  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
WEB_PUBLIC = os.path.join(ROOT, "apps", "web", "public")
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    if name in ARGS:
        i = ARGS.index(name)
        return ARGS[i + 1] if i + 1 < len(ARGS) and not ARGS[i + 1].startswith("--") else True
    return default


def cap(s):
    return "".join(w.capitalize() for w in s.split("_"))


# Default colours baked into the file. The web app recolours by material name at runtime.
def make_materials():
    m = kit_core.material
    return {
        "skin": m("MAT_Skin", "#d9a27a", 0.6),
        "skin_shade": m("MAT_SkinShade", "#c98f69", 0.6),
        "iris": m("MAT_Iris", "#5a3a28", 0.3),
        "eye_dark": m("MAT_EyeDark", "#1e1714", 0.35),
        "shine": m("MAT_EyeShine", "#ffffff", 0.15),
        "brows": m("MAT_Brows", "#5b3524", 0.8),
        "lip": m("MAT_Lip", "#8a4038", 0.5),
        "mouth_inner": m("MAT_MouthInner", "#4a1f1c", 0.6),
        "freckle": m("MAT_Freckle", "#8a5a3c", 0.7),
        "blush": m("MAT_Blush", "#e58c80", 0.7),
        "sticker": m("MAT_Sticker", "#f2c94c", 0.4),
        "hair": m("MAT_Hair", "#5b3524", 0.62, double_sided=True),
        "hair_accent": m("MAT_HairAccent", "#c0392b", 0.5),
        "top": m("MAT_Top", "#8fa58a", 0.85, double_sided=True),
        "top_accent": m("MAT_TopAccent", "#efe6d4", 0.8, double_sided=True),
        "top_trim": m("MAT_TopTrim", "#7d9278", 0.9),
        "top_inner": m("MAT_TopInner", "#f4efe6", 0.85, double_sided=True),
        "button": m("MAT_Button", "#3a2a20", 0.4),
        "lace": m("MAT_Lace", "#f4efe6", 0.8),
        "bottom": m("MAT_Bottom", "#3b4a63", 0.85, double_sided=True),
        "bottom_trim": m("MAT_BottomTrim", "#334058", 0.9),
        "shoes": m("MAT_Shoes", "#f2ede4", 0.6, double_sided=True),
        "sole": m("MAT_Sole", "#8a5a3c", 0.7),
        "acc": m("MAT_Acc", "#d1a24a", 0.85),
        "acc_dark": m("MAT_AccDark", "#6e4a33", 0.8),
        "acc_accent": m("MAT_AccAccent", "#e58c80", 0.5),
        "metal": m("MAT_Metal", "#d4af37", 0.3, metallic=1.0),
        "frame": m("MAT_Frame", "#3a2a20", 0.4),
    }


EYES = ("round", "almond", "sleepy", "sparkle")
NOSES = ("button", "soft", "pointed")
DETAILS = {"freckles": "Detail_Freckles", "blush": "Detail_Blush", "beauty_mark": "Detail_BeautyMark", "stars": "Detail_Stars"}


def build_all():
    mats = make_materials()
    rig = kit_core.build_rig()
    parts = []
    parts += kit_body.build_body(rig, mats["skin"])
    head = kit_body.build_head(rig, mats["skin"])
    parts.append(head)
    for style in EYES:
        parts.append(kit_body.build_eyes(style, head, rig, mats))
    for style in kit_body.BROW_STYLES:
        parts.append(kit_body.build_brows(style, head, rig, mats["brows"]))
    parts.append(kit_body.build_mouth(head, rig, mats["lip"], mats["mouth_inner"]))
    for style in NOSES:
        parts.append(kit_body.build_nose(style, head, rig, mats["skin_shade"]))
    parts += kit_body.build_details(head, rig, mats)
    for style in kit_hair.STYLES:
        parts.append(kit_hair.build_hair(style, rig, mats["hair"], mats["hair_accent"]))
    body = {p.name: p for p in parts if p.name.startswith("Body_")}
    for builders in (kit_clothes.TOPS, kit_clothes.BOTTOMS, kit_clothes.SHOES):
        for build in builders.values():
            parts.append(build(body, rig, mats))
    for build in kit_acc.ACCESSORIES.values():
        parts.append(build(head, rig, mats))
    kit_core.zero_shape_keys()
    # Anything a builder left behind (helper meshes) would export as a stray node.
    names = {p.name for p in parts}
    for ob in [o for o in bpy.data.objects if o.type == "MESH" and o.name not in names]:
        print("WARNING: removing stray mesh", ob.name)
        bpy.data.objects.remove(ob, do_unlink=True)
    return rig, parts


def hides_table():
    hides = {}
    hides.update({f"Top_{cap(k)}": v for k, v in kit_clothes.TOP_HIDES.items()})
    hides.update({f"Bottom_{cap(k)}": v for k, v in kit_clothes.BOTTOM_HIDES.items()})
    hides.update({f"Shoes_{cap(k)}": v for k, v in kit_clothes.SHOE_HIDES.items()})
    return hides


def manifest(rig, parts):
    hides = hides_table()
    out = []
    for p in parts:
        keys = p.data.shape_keys
        out.append({
            "name": p.name,
            "vertices": len(p.data.vertices),
            "materials": sorted({m.name for m in p.data.materials if m}),
            "morphs": [k.name for k in keys.key_blocks[1:]] if keys else [],
            "hidesBody": hides.get(p.name, []),
        })
    return {
        "version": 1,
        "generator": "art/avatars/scripts/build_kit.py",
        "units": "metres; glTF +Y up; the character faces +Z",
        "bones": [b.name for b in rig.data.bones],
        "parts": out,
    }


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for ob in bpy.data.objects:
        ob.hide_render = False
        ob.hide_viewport = False
        ob.hide_set(False)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_skins=True,
        export_morph=True,
        export_morph_normal=False,
        export_texcoords=False,
        export_animations=False,
        export_yup=True,
        export_apply=False,
        export_cameras=False,
        export_lights=False,
        use_selection=False,
    )


# ---------------------------------------------------------------------------
# Thumbnails: one per option, rendered on the default look with that option swapped in.
# ---------------------------------------------------------------------------

DEFAULT_LOOK = {"Head_Base", "Mouth_Base", "Eyes_Round", "Brows_Soft", "Nose_Button", "Hair_Bob", "Top_Sweater", "Bottom_Jeans", "Shoes_Sneakers"}


def dressed(parts, extra=(), replace=None):
    names = set(DEFAULT_LOOK)
    for prefix, new in (replace or {}).items():
        names = {n for n in names if not n.startswith(prefix)}
        if new:
            names.add(new)
    names |= set(extra)
    covered = set()
    for region_list in (hides_table().get(n) for n in names):
        covered |= set(region_list or [])
    names |= {p.name for p in parts if p.name.startswith("Body_") and p.name[5:] not in covered}
    return names


def set_keys(ob_name, values):
    ob = bpy.data.objects[ob_name]
    for kb in ob.data.shape_keys.key_blocks[1:]:
        kb.value = values.get(kb.name, 0.0)


def thumb_jobs(parts):
    bald = {"Hair_": "Hair_Buzz"}
    jobs = []
    for style in kit_hair.STYLES:
        jobs.append(("hair", style, dressed(parts, replace={"Hair_": f"Hair_{cap(style)}"}), "head", None))
    for style in EYES:
        jobs.append(("eyes", style, dressed(parts, replace={"Eyes_": f"Eyes_{cap(style)}", **bald}), "t_eyes", None))
    for style in kit_body.BROW_STYLES:
        jobs.append(("brows", style, dressed(parts, replace={"Brows_": f"Brows_{cap(style)}", **bald}), "t_brows", None))
    for style in NOSES:
        jobs.append(("nose", style, dressed(parts, replace={"Nose_": f"Nose_{cap(style)}", **bald}), "t_nose", None))
    for style, keys in (("soft", {}), ("smile", {"Smile": 0.7}), ("grin", {"Smile": 0.9, "Jaw_Open": 0.3}), ("pout", {"Frown": 0.45})):
        jobs.append(("mouth", style, dressed(parts, replace=bald), "t_mouth", ("Mouth_Base", keys)))
    for shape, keys in (("oval", {}), ("round", {"Face_Round": 1}), ("long", {"Face_Long": 1}), ("heart", {"Face_Heart": 1})):
        jobs.append(("face", shape, dressed(parts, replace=bald), "face", ("Head_Base", keys)))
    for detail, ob_name in DETAILS.items():
        jobs.append(("details", detail, dressed(parts, extra=[ob_name], replace=bald), "t_details", None))
    for style in kit_clothes.TOPS:
        jobs.append(("top", style, dressed(parts, replace={"Top_": f"Top_{cap(style)}"}), "t_top", None))
    for style in kit_clothes.BOTTOMS:
        jobs.append(("bottom", style, dressed(parts, replace={"Bottom_": f"Bottom_{cap(style)}"}), "t_bottom", None))
    for style in kit_clothes.SHOES:
        jobs.append(("shoes", style, dressed(parts, replace={"Shoes_": f"Shoes_{cap(style)}"}), "t_feet", None))
    for acc_id in kit_acc.ACCESSORIES:
        hair = "Hair_Buzz" if acc_id in ("beanie", "cap") else "Hair_Crop"
        view = {"backpack": "t_back", "necklace": "neck", "scarf": "neck", "earrings": "ear"}.get(acc_id, "head")
        jobs.append(("accessories", acc_id, dressed(parts, extra=[kit_acc.object_name(acc_id)], replace={"Hair_": hair}), view, None))
    return jobs


def render_thumbs(scene, parts, out_dir):
    cam = kit_render.setup_studio(scene, size=224, samples=24)
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.quality = 84
    jobs = thumb_jobs(parts)
    for category, option, visible, view, keys in jobs:
        kit_render.only_show(parts, visible)
        if keys:
            set_keys(*keys)
        kit_render.frame(cam, view)
        path = os.path.join(out_dir, category, f"{option}.webp")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        kit_render.render(scene, path)
        if keys:
            set_keys(keys[0], {})
    print("THUMBS", len(jobs), out_dir)


def main():
    scene = kit_core.reset_scene()
    rig, parts = build_all()

    preview = arg("--preview")
    if preview:
        import kit_preview
        only = arg("--only")
        kit_preview.run(scene, parts, preview, arg("--preview-mode", "hair"), only.split(",") if isinstance(only, str) else None)
        return

    blend = os.path.join(ROOT, "art", "avatars", "blender", "avatar_kit.blend")
    os.makedirs(os.path.dirname(blend), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)

    # Raw export; `pnpm avatar:build` then meshopt-compresses it into apps/web/public.
    glb = os.path.join(ROOT, "art", "avatars", "build", "avatar-kit.raw.glb")
    export_glb(glb)
    with open(os.path.join(WEB_PUBLIC, "models", "avatars", "kit-manifest.json"), "w") as f:
        json.dump(manifest(rig, parts), f, indent=1)
    print("EXPORTED", glb, os.path.getsize(glb), "bytes;", len(parts), "parts")

    if not arg("--no-thumbs"):
        render_thumbs(scene, parts, os.path.join(WEB_PUBLIC, "avatars", "thumbs"))


main()
