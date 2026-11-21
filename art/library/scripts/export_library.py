"""
Exports an assembled library scene (.blend from scene_milestone / scene_library) to a raw GLB for the
web. gltf-transform then instances the shared meshes, joins the rest, compresses with meshopt and
converts textures to WebP (see `pnpm library:pack`).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
        --python art/library/scripts/export_library.py -- --blend scene.blend --out art/library/build/library.raw.glb

Preview-only things never ship: lights, cameras, the haze volume, preview stand-ins and anything
hidden from render. Linked duplicates stay linked, so each shared mesh is written once.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

import bpy

DROP_PREFIXES = ("Haze", "PreviewFloor", "PH_", "Preview_", "Scene_Ground")


def prune(keep_books=True):
    """Removes everything that is not part of the shipped library."""
    removed = 0
    for ob in list(bpy.data.objects):
        drop = (
            ob.type in ("LIGHT", "CAMERA")
            or ob.hide_render
            or ob.name.startswith(DROP_PREFIXES)
            or (not keep_books and ob.users_collection and ob.users_collection[0].name == "Books")
        )
        if drop:
            bpy.data.objects.remove(ob, do_unlink=True)
            removed += 1
    # Book variants are templates (hidden collection): never export them as scene objects.
    col = bpy.data.collections.get("BookVariants")
    if col:
        for ob in list(col.objects):
            bpy.data.objects.remove(ob, do_unlink=True)
    return removed


def _zone_of(x, y, z):
    """Plan zone (Blender name) for a web-space point; walls within 0.9 m count as their room's."""
    import plan as P
    for zn in P.ZONES:
        if zn["yMin"] <= y < zn["yMax"] and any(
            r["minX"] - 0.9 <= x <= r["maxX"] + 0.9 and r["minZ"] - 0.9 <= z <= r["maxZ"] + 0.9 for r in zn["rects"]
        ):
            return zn["blender"]
    return "Zone_Exterior"


def group_by_zone():
    """Parents every top-level object under an identity empty per plan zone. gltf-transform only
    joins and instances siblings, so this keeps each room's meshes separate: the browser can then
    frustum-cull whole rooms instead of drawing one building-wide mesh."""
    from mathutils import Vector
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    empties = {}
    counts = {}
    for ob in [o for o in bpy.data.objects if o.parent is None and o.type in ("MESH", "EMPTY", "CURVE", "FONT")]:
        lo, hi = Vector((1e9, 1e9, 1e9)), Vector((-1e9, -1e9, -1e9))
        for o in [ob, *ob.children_recursive]:
            if o.type != "MESH":
                continue
            for corner in o.bound_box:
                w = o.matrix_world @ Vector(corner)
                lo, hi = Vector(map(min, lo, w)), Vector(map(max, hi, w))
        c = (lo + hi) / 2 if hi.x >= lo.x else ob.matrix_world.translation
        zone = _zone_of(c.x, c.z, -c.y)
        if zone not in empties:
            e = bpy.data.objects.new(zone, None)
            bpy.context.scene.collection.objects.link(e)
            empties[zone] = e
        mw = ob.matrix_world.copy()
        ob.parent = empties[zone]
        ob.matrix_world = mw
        counts[zone] = counts.get(zone, 0) + 1
    return counts


def tag_books():
    """Books carry their cloth colour as an object colour, which glTF can't express. Copy it into a
    custom property (exported as node extras) so pack_books.mjs can make it an instance colour."""
    n = 0
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.users_collection and ob.users_collection[0].name == "Books":
            ob["ovr_color"] = [round(v, 5) for v in ob.color[:3]]
            n += 1
    return n


def census():
    uniq, rendered, n = {}, 0, 0
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        n += 1
        if ob.data.name not in uniq:
            ob.data.calc_loop_triangles()
            uniq[ob.data.name] = len(ob.data.loop_triangles)
        rendered += uniq[ob.data.name]
    return n, len(uniq), rendered, sum(uniq.values())


def export(path):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=False,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=False,
        export_lights=False,
        export_extras=True,   # light_points, board_surface, screen_surface ... reach the web as userData
        export_yup=True,
    )


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--blend", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-books", action="store_true", help="books ship separately as an instancing file")
    a = ap.parse_args(argv)
    t = time.time()
    bpy.ops.wm.open_mainfile(filepath=a.blend)
    removed = prune(keep_books=not a.no_books)
    print(f"[export] tagged {tag_books()} books with their colours")
    print(f"[export] zones: {group_by_zone()}")
    n, nu, rendered, unique = census()
    print(f"[export] pruned {removed}; {n} mesh objects, {nu} unique meshes, "
          f"{rendered / 1e6:.2f}M drawn tris, {unique / 1e6:.2f}M unique tris")
    export(a.out)
    print(f"[export] wrote {a.out} ({os.path.getsize(a.out) / 1e6:.1f} MB) in {time.time() - t:.0f}s")


if __name__ == "__main__":
    main()
