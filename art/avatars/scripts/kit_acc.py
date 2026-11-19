"""Accessories for the OVR avatar kit, each attached to the bone it rides on."""

import bmesh
import math
from mathutils import Matrix, Vector

from kit_body import EYE_X, EYE_Z, HEAD_CENTER as C
from kit_core import Surface, align_to_normal, cylinder, join, mesh_from_bmesh, rounded_box, skin, torus, tube, uv_sphere
from kit_hair import RX, RY, RZ, hairline_z, shell


def _ring_points(center, rx, rz, n, normal, start=0.0, end=math.tau):
    """Points of an ellipse facing `normal` (for glasses rims)."""
    rot = align_to_normal(normal)
    pts = []
    for k in range(n):
        a = start + (end - start) * k / n
        pts.append(center + rot @ Vector((math.cos(a) * rx, 0, math.sin(a) * rz)))
    return pts


def glasses_round(head, rig, m):
    surf = Surface(head)
    parts, rims = [], {}
    for s in (1, -1):
        p, n = surf.front(EYE_X * s, EYE_Z)
        c = p + n * 0.022
        rims[s] = c
        parts.append(tube(f"rim{s}", _ring_points(c, 0.029, 0.027, 24, n), [0.0032] * 24, m["frame"], cyclic=True, segments=8))
        temple_start = c + Vector((0.029 * s, 0.002, 0.004))
        parts.append(tube(f"temple{s}", [temple_start, temple_start + Vector((0.025 * s, 0.05, 0.002)), Vector((0.152 * s, 0.03, EYE_Z - 0.006))], [0.0028, 0.0028, 0.0026], m["frame"], segments=6))
    mid = (rims[1] + rims[-1]) / 2 + Vector((0, -0.004, 0.004))
    parts.append(tube("bridge", [rims[1] + Vector((-0.029, 0, 0.004)), mid, rims[-1] + Vector((0.029, 0, 0.004))], [0.0028] * 3, m["frame"], segments=6))
    ob = join(parts, "Acc_GlassesRound")
    return skin(ob, rig, rigid="Head")


def glasses_square(head, rig, m):
    surf = Surface(head)
    parts, rims = [], {}
    for s in (1, -1):
        p, n = surf.front(EYE_X * s, EYE_Z)
        c = p + n * 0.022
        rims[s] = c
        rot = align_to_normal(n)
        w, h, r = 0.032, 0.024, 0.008
        pts = []
        for cx, cz, a0 in ((w - r, h - r, 0), (-w + r, h - r, math.pi / 2), (-w + r, -h + r, math.pi), (w - r, -h + r, 1.5 * math.pi)):
            for k in range(5):
                a = a0 + (math.pi / 2) * k / 4
                pts.append(c + rot @ Vector((cx + math.cos(a) * r, 0, cz + math.sin(a) * r)))
        parts.append(tube(f"rim{s}", pts, [0.0042] * len(pts), m["frame"], cyclic=True, segments=8, resolution=2))
        temple_start = c + Vector((0.032 * s, 0.002, 0.012))
        parts.append(tube(f"temple{s}", [temple_start, temple_start + Vector((0.022 * s, 0.05, 0)), Vector((0.152 * s, 0.03, EYE_Z + 0.002))], [0.0035, 0.0035, 0.003], m["frame"], segments=6))
    mid = (rims[1] + rims[-1]) / 2 + Vector((0, -0.003, 0.012))
    parts.append(tube("bridge", [rims[1] + Vector((-0.032, 0, 0.012)), mid, rims[-1] + Vector((0.032, 0, 0.012))], [0.0035] * 3, m["frame"], segments=6))
    return skin(join(parts, "Acc_GlassesSquare"), rig, rigid="Head")


def headphones(head, rig, m):
    pts = []
    for k in range(13):
        a = math.pi * k / 12
        pts.append(C + Vector((math.cos(a) * 0.178, 0.008, math.sin(a) * 0.205 - 0.005)))
    parts = [tube("band", pts, [0.011] * len(pts), m["acc"], segments=10)]
    for s in (1, -1):
        rot = Matrix.Rotation(math.pi / 2, 3, "Y")
        parts.append(cylinder(f"cup{s}", 0.052, 0.048, 0.032, (0.172 * s, 0.008, C.z - 0.012), m["acc"], segments=28, rot=rot))
        parts.append(torus(f"pad{s}", 0.036, 0.013, (0.156 * s, 0.008, C.z - 0.012), m["acc_dark"], rot=rot, major_seg=24, minor_seg=10))
        parts.append(cylinder(f"cap{s}", 0.03, 0.03, 0.008, (0.19 * s, 0.008, C.z - 0.012), m["metal"], segments=20, rot=rot))
    return skin(join(parts, "Acc_Headphones"), rig, rigid="Head")


def _dome(name, scale, edge_z, mat):
    return shell(name, mat, scale, edge_z, tuck=0.0)


def _ribbed_cuff(name, edge_z, height, inner, outer, ribs, mat, cols=144):
    """A closed knitted band hugging the head from edge_z(phi) up by `height`, with vertical ribs."""
    from kit_hair import scalp
    bm = bmesh.new()

    def elev(phi, z, scale):
        return math.degrees(math.asin(max(-0.98, min(0.98, (z - C.z) / (RZ * scale)))))

    levels = [0.0, 0.15, 0.5, 0.85, 1.0]
    loops = []
    for li, t in enumerate(levels):
        out_ring, in_ring = [], []
        for k in range(cols):
            phi = 360.0 * k / cols
            z = edge_z(phi) + height * t
            round_ = math.sin(math.pi * t) ** 0.5
            rib = 0.5 + 0.5 * math.cos(math.radians(phi) * ribs)
            sc = inner + (outer - inner) * (0.55 + 0.45 * round_) + 0.005 * rib * round_
            out_ring.append(bm.verts.new(scalp(phi, elev(phi, z, sc), sc)))
        loops.append(out_ring)
    inner_top = [bm.verts.new(scalp(360.0 * k / cols, elev(360.0 * k / cols, edge_z(360.0 * k / cols) + height, inner), inner)) for k in range(cols)]
    inner_bot = [bm.verts.new(scalp(360.0 * k / cols, elev(360.0 * k / cols, edge_z(360.0 * k / cols), inner), inner)) for k in range(cols)]
    chain = [inner_bot, *loops, inner_top, inner_bot]
    for ra, rb in zip(chain, chain[1:]):
        for k in range(cols):
            bm.faces.new((ra[k], ra[(k + 1) % cols], rb[(k + 1) % cols], rb[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(name, bm, mat)


def beanie(head, rig, m):
    def cut(phi):
        return hairline_z(phi, front=0.07, side=0.022, back=-0.035) - 0.004
    dome = _dome("dome", 1.085, cut, m["acc"])
    # Slouch: let the crown rise a little so it reads as knit, not a helmet.
    for v in dome.data.vertices:
        lift = max(0.0, v.co.z - (C.z + 0.04))
        v.co.z += lift * 0.22
        v.co.y += lift * 0.12
    cuff = _ribbed_cuff("cuff", cut, 0.046, 1.08, 1.13, 40, m["acc"])
    top = C + Vector((0, 0.012 + (RZ * 1.085 - 0.04) * 0.12, RZ * 1.085 + (RZ * 1.085 - 0.04) * 0.22 + 0.024))
    pom = uv_sphere("pom", 0.036, top, (1, 1, 0.92), 18, 12, m["acc_dark"])
    return skin(join([dome, cuff, pom], "Acc_Beanie"), rig, rigid="Head")


def cap(head, rig, m):
    def cut(phi):
        return hairline_z(phi, front=0.06, side=0.035, back=0.0)
    dome = _dome("crown", 1.13, cut, m["acc"])
    # Curved brim sticking out at the front.
    bm = bmesh.new()
    rows, segs = 4, 18
    grid = []
    for r in range(rows + 1):
        t = r / rows
        ring = []
        for k in range(segs + 1):
            a = math.radians(-70 + 140 * k / segs)
            rad = 1.13 + t * 0.62
            x = math.sin(a) * RX * rad * (1 - 0.25 * t)
            y = -math.cos(a) * RY * rad
            z = C.z + 0.06 - t * 0.012 - 0.01 * (math.sin(a) ** 2) * t
            ring.append(bm.verts.new((x, y, z)))
        grid.append(ring)
    for r in range(rows):
        for k in range(segs):
            bm.faces.new((grid[r][k], grid[r][k + 1], grid[r + 1][k + 1], grid[r + 1][k]))
    brim = mesh_from_bmesh("brim", bm, m["acc_dark"])
    sol = brim.modifiers.new("t", "SOLIDIFY")
    sol.thickness = 0.008
    from kit_core import evaluated_copy, remove
    brim2 = evaluated_copy(brim, "brim2")
    remove(brim)
    button = uv_sphere("btn", 0.012, C + Vector((0, 0, RZ * 1.13)), (1, 1, 0.6), 12, 8, m["acc_dark"])
    return skin(join([dome, brim2, button], "Acc_Cap"), rig, rigid="Head")


def hair_clip(head, rig, m):
    p = C + Vector((0.118, -0.095, 0.098))
    bar = rounded_box("clip", (0.05, 0.012, 0.012), (0, 0, 0), m["acc_accent"], bevel=0.005, rot=Matrix.Rotation(0.5, 3, "Y") @ Matrix.Rotation(-0.5, 3, "Z"))
    bar.data.transform(Matrix.Translation(p))
    gem = uv_sphere("gem", 0.008, p + Vector((0, -0.008, 0)), (1, 0.7, 1), 10, 8, m["metal"])
    return skin(join([bar, gem], "Acc_HairClip"), rig, rigid="Head")


def earrings(head, rig, m):
    parts = []
    for s in (1, -1):
        c = Vector((0.152 * s, 0.006, 1.546))
        parts.append(torus(f"hoop{s}", 0.013, 0.0022, c, m["metal"], rot=Matrix.Rotation(math.pi / 2, 3, "Y"), major_seg=20, minor_seg=6))
    return skin(join(parts, "Acc_Earrings"), rig, rigid="Head")


def necklace(head, rig, m):
    pts = []
    for k in range(28):
        a = math.tau * k / 28
        front = max(0.0, -math.cos(a))
        pts.append(Vector((math.sin(a) * 0.072, -math.cos(a) * 0.066 + 0.012, 1.365 - 0.045 * front ** 2)))
    chain = tube("chain", pts, [0.0022] * 28, m["metal"], cyclic=True, segments=6)
    pendant = uv_sphere("pendant", 0.011, (0, -0.06, 1.31), (1, 0.6, 1.2), 12, 10, m["acc_accent"])
    ob = join([chain, pendant], "Acc_Necklace")
    return skin(ob, rig, allowed=["Neck", "Chest"])


def scarf(head, rig, m):
    pts = []
    for k in range(24):
        a = math.tau * k / 24
        pts.append(Vector((math.sin(a) * 0.088, -math.cos(a) * 0.078 + 0.012, 1.385 - 0.01 * math.cos(a))))
    wrap = tube("wrap", pts, [0.031] * 24, m["acc"], cyclic=True, segments=12)
    tail1 = tube("tail1", [Vector((0.04, -0.08, 1.36)), Vector((0.06, -0.12, 1.24)), Vector((0.055, -0.12, 1.12))], [0.026, 0.024, 0.022], m["acc"], segments=10)
    tail2 = tube("tail2", [Vector((0.02, -0.085, 1.355)), Vector((0.02, -0.115, 1.27)), Vector((0.012, -0.11, 1.19))], [0.024, 0.022, 0.02], m["acc"], segments=10)
    fringe = [cylinder(f"fr{k}", 0.004, 0.003, 0.03, (0.04 + k * 0.01, -0.12, 1.095), m["acc_dark"], segments=6) for k in range(4)]
    ob = join([wrap, tail1, tail2, *fringe], "Acc_Scarf")
    return skin(ob, rig, allowed=["Neck", "Chest", "Spine"])


def backpack(head, rig, m):
    bag = rounded_box("bag", (0.27, 0.13, 0.34), (0, 0.175, 1.13), m["acc"], bevel=0.04)
    pocket = rounded_box("pocket", (0.19, 0.04, 0.13), (0, 0.245, 1.05), m["acc_dark"], bevel=0.02)
    flap = rounded_box("flap", (0.25, 0.04, 0.08), (0, 0.185, 1.29), m["acc_dark"], bevel=0.02)
    straps = []
    for s in (1, -1):
        straps.append(tube(f"strap{s}", [Vector((0.09 * s, 0.13, 1.30)), Vector((0.11 * s, 0.02, 1.37)), Vector((0.12 * s, -0.115, 1.29)), Vector((0.12 * s, -0.12, 1.12)), Vector((0.11 * s, 0.11, 1.0))], [0.012] * 5, m["acc_dark"], segments=6))
    ob = join([bag, pocket, flap, *straps], "Acc_Backpack")
    return skin(ob, rig, allowed=["Chest", "Spine"])


ACCESSORIES = {
    "glasses_round": glasses_round,
    "glasses_square": glasses_square,
    "headphones": headphones,
    "beanie": beanie,
    "cap": cap,
    "hair_clip": hair_clip,
    "earrings": earrings,
    "necklace": necklace,
    "scarf": scarf,
    "backpack": backpack,
}


def object_name(acc_id):
    return "Acc_" + "".join(w.capitalize() for w in acc_id.split("_"))
