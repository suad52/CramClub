"""
Finds invisible obstacles: plan colliders (what the game blocks) with no visible geometry inside.
Casts a grid of rays through each collider's volume in an assembled scene and reports colliders
none of whose rays hit a mesh inside the footprint.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
        --python art/library/scripts/check_colliders.py -- --blend art/library/build/library.blend
"""

from __future__ import annotations

import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import plan as P  # noqa: E402

# Colliders that are meant to sit inside other geometry or outside the playable space.
EXPECTED_HIDDEN = ("lift_shaft", "rotunda_passage")


def bl(x, y, z):
    return Vector((x, -z, y))


def covered(c, scene, dg):
    """True if rays across the collider's footprint hit something inside it."""
    y0 = max(c["y0"], 0.0) + 0.15
    y1 = min(c["y1"], c["y0"] + 2.2) - 0.05
    heights = [y0 + (y1 - y0) * t for t in (0.1, 0.5, 0.9)] if y1 > y0 else [y0]
    if c["kind"] == "circle":
        r, cx, cz = c["radius"], c["x"], c["z"]
        dirs = [(math.cos(a), math.sin(a)) for a in (0, math.pi / 3, 2 * math.pi / 3)]
        for h in heights:
            for dx, dz in dirs:
                start = bl(cx - dx * (r + 0.4), h, cz - dz * (r + 0.4))
                d = bl(dx, 0, dz) - bl(0, 0, 0)
                ok, loc, *_ = scene.ray_cast(dg, start, d, distance=2 * r + 0.8)
                if ok and (Vector((loc.x, loc.y)) - Vector((cx, -cz))).length <= r + 0.02:
                    return True
        return False
    cx, cz, hw, hd, rot = c["x"], c["z"], c["halfW"], c["halfD"], c["rotationY"]
    ux = (math.cos(rot), -math.sin(rot))   # local +X in web (x, z)
    uz = (math.sin(rot), math.cos(rot))    # local +Z in web (x, z)
    for h in heights:
        for axis, half, other, ohalf in ((ux, hw, uz, hd), (uz, hd, ux, hw)):
            for t in (-0.6, 0.0, 0.6):
                ox, oz = cx + other[0] * ohalf * t, cz + other[1] * ohalf * t
                start = bl(ox - axis[0] * (half + 0.4), h, oz - axis[1] * (half + 0.4))
                d = bl(axis[0], 0, axis[1]) - bl(0, 0, 0)
                ok, loc, *_ = scene.ray_cast(dg, start, d, distance=2 * half + 0.8)
                if ok:
                    lx, lz = loc.x - cx, -loc.y - cz
                    a = lx * ux[0] + lz * ux[1]
                    b = lx * uz[0] + lz * uz[1]
                    if abs(a) <= hw + 0.03 and abs(b) <= hd + 0.03:
                        return True
    return False


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    blend = argv[argv.index("--blend") + 1]
    bpy.ops.wm.open_mainfile(filepath=blend)
    for ob in list(bpy.data.objects):  # rays must not stop on lights' helpers or the haze
        if ob.name.startswith(("Haze",)) or ob.type in ("LIGHT", "CAMERA"):
            bpy.data.objects.remove(ob, do_unlink=True)
    scene = bpy.context.scene
    dg = bpy.context.evaluated_depsgraph_get()
    invisible = []
    for c in P.colliders():
        if any(c["id"].startswith(p) for p in EXPECTED_HIDDEN):
            continue
        if not covered(c, scene, dg):
            invisible.append(c["id"])
    print(f"[colliders] {len(P.colliders())} checked, {len(invisible)} with nothing visible inside:")
    for cid in invisible:
        print(f"[colliders]   {cid}")


if __name__ == "__main__":
    main()
