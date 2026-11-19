"""Quick look renders while working on the kit (not used by the export)."""

import os

import kit_acc
import kit_clothes
import kit_hair
import kit_render


def _cap(s):
    return "".join(w.capitalize() for w in s.split("_"))


def run(scene, parts, out, mode, only=None):
    os.makedirs(out, exist_ok=True)
    cam = kit_render.setup_studio(scene, size=512, samples=32)
    base = {p.name for p in parts if p.name.startswith(("Body_", "Head_", "Mouth_"))}
    base |= {"Eyes_Round", "Brows_Soft", "Nose_Button"}

    if mode == "acc":
        dressed = {n for n in base if n not in ("Body_Torso", "Body_UpperArms", "Body_Forearms")} | {"Top_Sweater"}
        for acc_id in kit_acc.ACCESSORIES:
            if only and acc_id not in only:
                continue
            hair = "Hair_Buzz" if acc_id in ("beanie", "cap") else "Hair_Crop"
            kit_render.only_show(parts, dressed | {hair, kit_acc.object_name(acc_id)})
            view = "back34" if acc_id == "backpack" else ("torso" if acc_id in ("necklace", "scarf") else "head")
            kit_render.frame(cam, view)
            kit_render.render(scene, os.path.join(out, f"acc_{acc_id}.png"))
    elif mode == "outfits":
        bottoms = ["jeans", "chinos", "shorts", "skirt", "jeans", "chinos"]
        shoes = ["sneakers", "boots", "loafers", "sneakers", "boots", "loafers"]
        for t, b, sh in zip(kit_clothes.TOPS, bottoms, shoes):
            hidden = set(kit_clothes.TOP_HIDES[t]) | set(kit_clothes.BOTTOM_HIDES[b]) | set(kit_clothes.SHOE_HIDES[sh])
            vis = {n for n in base if not (n.startswith("Body_") and n[5:] in hidden)}
            vis |= {f"Top_{_cap(t)}", f"Bottom_{_cap(b)}", f"Shoes_{_cap(sh)}", "Hair_Bob"}
            kit_render.only_show(parts, vis)
            for view in ("full", "back"):
                kit_render.frame(cam, view)
                kit_render.render(scene, os.path.join(out, f"outfit_{t}_{b}_{sh}_{view}.png"))
    else:
        for style in kit_hair.STYLES:
            if only and style not in only:
                continue
            kit_render.only_show(parts, base | {f"Hair_{_cap(style)}"})
            for view in ("head", "front", "back34") if only else ("head",):
                kit_render.frame(cam, view if view != "front" else "face")
                kit_render.render(scene, os.path.join(out, f"hair_{style}_{view}.png"))
    print("PREVIEW", out)
