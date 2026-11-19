"""Tops, bottoms and shoes for the OVR avatar kit.

Garments are grown from the body itself: the covered body regions are copied, pushed outward
along their normals, trimmed (hems, sleeve lengths) and finished with ribbed bands. They are
skinned with the same distance weights and carry the same Build morphs as the body, so they
move and resize exactly like the skin underneath.
"""

import bmesh
import bpy
import math
from mathutils import Matrix, Vector

from kit_core import (
    SEGMENTS, Surface, add_build_keys, align_to_normal, cylinder, join, mesh_from_bmesh,
    GARMENT_BONES, region_skin, remove, rounded_box, skin, tube, uv_sphere,
)
from kit_body import region_of


def bone_t(p, bone):
    a, b = SEGMENTS[bone]
    ab = b - a
    return max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))


def limb_t(p, kind):
    """Position along a limb bone (0 at the joint nearest the body), mirrored automatically."""
    side = "L" if p.x >= 0 else "R"
    return bone_t(p, f"{kind}.{side}")


def gather(body, regions, keep, offset, name, mat_for=None, mats=None):
    """Copies the faces of `regions` that pass `keep(center, region)`, pushed out by `offset(p)`."""
    bm = bmesh.new()
    lay = bm.faces.layers.int.new("region")
    names = sorted(regions)
    for ri, region in enumerate(names):
        src = body[f"Body_{region}"].data
        vmap = {}
        for poly in src.polygons:
            c = Vector((0, 0, 0))
            for vi in poly.vertices:
                c += src.vertices[vi].co
            c /= len(poly.vertices)
            if not keep(c, region):
                continue
            vs = []
            for vi in poly.vertices:
                if vi not in vmap:
                    vmap[vi] = bm.verts.new(src.vertices[vi].co)
                vs.append(vmap[vi])
            try:
                f = bm.faces.new(vs)
                f[lay] = ri
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    for v in bm.verts:
        v.co = v.co + v.normal * offset(v.co)
    if mat_for and mats:
        for f in bm.faces:
            c = f.calc_center_median()
            f.material_index = mat_for(c, names[f[lay]])
    ob = mesh_from_bmesh(name, bm, None)
    for m in mats or []:
        ob.data.materials.append(m)
    return ob


def boundary_loops(ob):
    """Ordered loops of boundary vertices (hems, cuffs, collars)."""
    me = ob.data
    edge_count = {}
    for p in me.polygons:
        for e in p.edge_keys:
            edge_count[e] = edge_count.get(e, 0) + 1
    adj = {}
    for (a, b), n in edge_count.items():
        if n == 1:
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
    loops, seen = [], set()
    for start in adj:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [n for n in adj[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            loop.append(cur)
            seen.add(cur)
        if len(loop) > 5:
            loops.append([me.vertices[i].co.copy() for i in loop])
    return loops


def band(points, radius, mat, name, push=0.004):
    """A closed ribbed band around a loop (hem, cuff, collar)."""
    c = sum(points, Vector((0, 0, 0))) / len(points)
    pts = []
    step = max(1, len(points) // 28)
    for p in points[::step]:
        out = p - c
        out.z = 0 if abs(out.z) < abs(out.x) + abs(out.y) else out.z
        pts.append(p + (out.normalized() * push if out.length > 1e-6 else Vector()))
    return tube(name, pts, [radius] * len(pts), mat, resolution=3, segments=8, cyclic=True)


def finish(ob, rig, extra=(), bands=None):
    parts = [ob, *extra]
    if bands:
        parts += bands
    out = join(parts, ob.name)
    add_build_keys(out)
    region_skin(out, rig, families=GARMENT_BONES[out.name.split("_")[0]])
    return out


def loops_where(ob, test):
    return [l for l in boundary_loops(ob) if test(sum(l, Vector()) / len(l))]


# ---------------------------------------------------------------------------
# Tops
# ---------------------------------------------------------------------------

def _torso_keep(hem=0.86, neck=1.372):
    """Torso up to the neckline; below the leg junction the hem also wraps the tops of the
    thighs, so the hem edge is one clean ring around the hips instead of zigzagging."""
    def keep(c, region):
        if region == "Torso":
            return hem <= c.z <= neck
        if region == "Thighs":
            return c.z >= hem
        return True
    return keep


def _sleeve(region_lengths):
    """keep() for arm regions: UpperArms/Forearms kept up to a fraction along the bone."""
    def keep(c, region):
        if region == "UpperArms":
            return limb_t(c, "UpperArm") <= region_lengths.get("UpperArms", 1.0)
        if region == "Forearms":
            return limb_t(c, "LowerArm") <= region_lengths.get("Forearms", 1.0)
        return True
    return keep


def _both(*fns):
    return lambda c, r: all(f(c, r) for f in fns)


def _top_offset(torso, arms):
    def offset(p):
        return torso if region_of(p) in ("Torso", "Neck") else arms
    return offset


def top_tshirt(body, rig, m):
    keep = _both(_torso_keep(0.885), _sleeve({"UpperArms": 0.58}))
    ob = gather(body, {"Torso", "Thighs", "UpperArms"}, keep, _top_offset(0.011, 0.013), "Top_Tshirt", mats=[m["top"]])
    bands = [band(l, 0.0075, m["top_trim"], f"b{i}") for i, l in enumerate(boundary_loops(ob))]
    return finish(ob, rig, bands=bands)


def top_hoodie(body, rig, m):
    keep = _both(_torso_keep(0.865), _sleeve({"Forearms": 0.93}))
    ob = gather(body, {"Torso", "Thighs", "UpperArms", "Forearms"}, keep, _top_offset(0.027, 0.02), "Top_Hoodie", mats=[m["top"]])
    bands = [band(l, 0.012, m["top_trim"], f"b{i}") for i, l in enumerate(boundary_loops(ob)) if (sum(l, Vector()) / len(l)).z < 1.3]
    extra = []
    hood = uv_sphere("hood", 0.115, (0, 0.085, 1.43), (1.32, 0.78, 0.66), 28, 18, m["top"])
    bm = bmesh.new()
    bm.from_mesh(hood.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < 0.035], context="VERTS")
    bm.to_mesh(hood.data)
    bm.free()
    extra.append(hood)
    extra.append(band([Vector((math.cos(a) * 0.105, -math.sin(a) * 0.075 + 0.02, 1.405 + 0.012 * math.sin(a))) for a in [k * math.tau / 24 for k in range(24)]], 0.017, m["top"], "hoodring"))
    surf = Surface(ob)
    pt, n = surf.front(0, 0.985)
    pocket = rounded_box("pocket", (0.21, 0.014, 0.10), (0, 0, 0), m["top_trim"], bevel=0.012)
    pocket.data.transform(Matrix.Translation(pt + n * 0.006) @ align_to_normal(n).to_4x4())
    extra.append(pocket)
    for s in (1, -1):
        p1, n1 = surf.front(0.03 * s, 1.355)
        extra.append(tube(f"string{s}", [p1 + n1 * 0.01, p1 + n1 * 0.016 + Vector((0, 0, -0.05)), p1 + n1 * 0.016 + Vector((0.004 * s, 0, -0.095))], [0.0035, 0.0035, 0.004], m["lace"]))
    return finish(ob, rig, extra, bands)


def top_sweater(body, rig, m):
    keep = _both(_torso_keep(0.875), _sleeve({"Forearms": 0.94}))
    ob = gather(body, {"Torso", "Thighs", "UpperArms", "Forearms"}, keep, _top_offset(0.019, 0.016), "Top_Sweater", mats=[m["top"]])
    bands = [band(l, 0.013 if (sum(l, Vector()) / len(l)).z > 1.3 else 0.011, m["top_trim"], f"b{i}") for i, l in enumerate(boundary_loops(ob))]
    return finish(ob, rig, bands=bands)


def top_cardigan(body, rig, m):
    tee = gather(body, {"Torso", "Thighs"}, _torso_keep(0.885, 1.36), lambda p: 0.009, "tee", mats=[m["top_inner"]])
    tee_bands = [band(l, 0.006, m["top_inner"], f"tb{i}") for i, l in enumerate(boundary_loops(tee)) if (sum(l, Vector()) / len(l)).z > 1.3]

    def open_front(c, region):
        return not (region == "Torso" and c.y < -0.03 and abs(c.x) < 0.035 + max(0, 1.3 - c.z) * 0.03)

    keep = _both(_torso_keep(0.87, 1.372), _sleeve({"Forearms": 0.9}), open_front)
    ob = gather(body, {"Torso", "Thighs", "UpperArms", "Forearms"}, keep, _top_offset(0.021, 0.017), "Top_Cardigan", mats=[m["top"]])
    bands = [band(l, 0.009, m["top_trim"], f"b{i}") for i, l in enumerate(boundary_loops(ob))]
    surf = Surface(ob)
    buttons = []
    for k in range(4):
        z = 1.22 - k * 0.085
        p, n = surf.front(0.045, z)
        if p is not None:
            b = cylinder(f"btn{k}", 0.008, 0.008, 0.004, (0, 0, 0), m["button"], segments=12)
            b.data.transform(Matrix.Translation(p + n * 0.006) @ (align_to_normal(n) @ Matrix.Rotation(math.pi / 2, 3, "X")).to_4x4())
            buttons.append(b)
    return finish(ob, rig, [tee, *tee_bands, *buttons], bands)


def top_jacket(body, rig, m):
    keep = _both(_torso_keep(0.88), _sleeve({"Forearms": 0.92}))

    def mat_for(c, region):
        return 1 if region in ("UpperArms", "Forearms") else 0

    ob = gather(body, {"Torso", "Thighs", "UpperArms", "Forearms"}, keep, _top_offset(0.03, 0.022), "Top_Jacket", mat_for=mat_for, mats=[m["top"], m["top_accent"]])
    bands = []
    for i, l in enumerate(boundary_loops(ob)):
        bands.append(band(l, 0.013, m["top_trim"], f"b{i}"))
        bands.append(band([p + Vector((0, 0, 0.014 if (sum(l, Vector()) / len(l)).z < 1.3 else -0.014)) for p in l], 0.005, m["top_accent"], f"s{i}", push=0.012))
    surf = Surface(ob)
    p, n = surf.front(0.075, 1.22)
    patch = rounded_box("patch", (0.05, 0.008, 0.06), (0, 0, 0), m["top_accent"], bevel=0.006)
    patch.data.transform(Matrix.Translation(p + n * 0.004) @ align_to_normal(n).to_4x4())
    snaps = []
    for k in range(5):
        p, n = surf.front(0.0, 1.30 - k * 0.09)
        b = cylinder(f"snap{k}", 0.006, 0.006, 0.004, (0, 0, 0), m["button"], segments=10)
        b.data.transform(Matrix.Translation(p + n * 0.004) @ (align_to_normal(n) @ Matrix.Rotation(math.pi / 2, 3, "X")).to_4x4())
        snaps.append(b)
    return finish(ob, rig, [patch, *snaps], bands)


def top_shirt(body, rig, m):
    keep = _both(_torso_keep(0.885, 1.365), _sleeve({"Forearms": 0.45}))
    ob = gather(body, {"Torso", "Thighs", "UpperArms", "Forearms"}, keep, _top_offset(0.013, 0.014), "Top_Shirt", mats=[m["top"]])
    bands = [band(l, 0.010 if (sum(l, Vector()) / len(l)).z < 1.2 and abs((sum(l, Vector()) / len(l)).x) > 0.15 else 0.006, m["top"], f"b{i}") for i, l in enumerate(boundary_loops(ob))]
    surf = Surface(ob)
    extra = []
    for s in (1, -1):
        p, n = surf.front(0.03 * s, 1.345)
        flap = rounded_box(f"collar{s}", (0.055, 0.008, 0.035), (0, 0, 0), m["top_trim"], bevel=0.004)
        flap.data.transform(Matrix.Translation(p + n * 0.012 + Vector((0.01 * s, 0, 0))) @ (align_to_normal(n) @ Matrix.Rotation(-0.55 * s, 3, "Y")).to_4x4())
        extra.append(flap)
    for k in range(5):
        p, n = surf.front(0.0, 1.30 - k * 0.085)
        b = cylinder(f"btn{k}", 0.006, 0.006, 0.003, (0, 0, 0), m["button"], segments=10)
        b.data.transform(Matrix.Translation(p + n * 0.003) @ (align_to_normal(n) @ Matrix.Rotation(math.pi / 2, 3, "X")).to_4x4())
        extra.append(b)
    p, n = surf.front(0, 1.12)
    placket = rounded_box("placket", (0.03, 0.004, 0.42), (0, 0, 0), m["top"], bevel=0.0015)
    placket.data.transform(Matrix.Translation(p + n * 0.0015) @ align_to_normal(n).to_4x4())
    extra.append(placket)
    return finish(ob, rig, extra, bands)


TOPS = {
    "tshirt": top_tshirt,
    "hoodie": top_hoodie,
    "sweater": top_sweater,
    "cardigan": top_cardigan,
    "jacket": top_jacket,
    "shirt": top_shirt,
}

# Body regions each top covers completely (hidden so skin never pokes through).
TOP_HIDES = {
    "tshirt": ["Torso"],
    "hoodie": ["Torso", "UpperArms", "Forearms"],
    "sweater": ["Torso", "UpperArms", "Forearms"],
    "cardigan": ["Torso", "UpperArms", "Forearms"],
    "jacket": ["Torso", "UpperArms", "Forearms"],
    "shirt": ["Torso", "UpperArms"],
}


# ---------------------------------------------------------------------------
# Bottoms
# ---------------------------------------------------------------------------

def _pants(body, rig, m, name, cut_z, offset_fn, waist=1.0):
    def keep(c, region):
        if region == "Torso":
            return c.z <= waist
        return c.z >= cut_z
    ob = gather(body, {"Torso", "Thighs", "Shins"}, keep, offset_fn, name, mats=[m["bottom"]])
    bands = []
    for i, l in enumerate(boundary_loops(ob)):
        cz = (sum(l, Vector()) / len(l)).z
        bands.append(band(l, 0.012 if cz > 0.9 else 0.009, m["bottom_trim"], f"b{i}"))
    return ob, bands


def bottom_jeans(body, rig, m):
    ob, bands = _pants(body, rig, m, "Bottom_Jeans", 0.105, lambda p: 0.016 if region_of(p) == "Torso" else 0.014)
    extra = []
    surf = Surface(ob)
    for s in (1, -1):
        p, n = surf.toward((0.075 * s, 0.4, 0.93), (0, -1, 0))
        if p is not None:
            pk = rounded_box(f"bp{s}", (0.07, 0.006, 0.07), (0, 0, 0), m["bottom_trim"], bevel=0.006)
            pk.data.transform(Matrix.Translation(p - n * -0.003) @ align_to_normal(n).to_4x4())
            extra.append(pk)
    p, n = surf.front(0.0, 0.985)
    extra.append(cylinder("rivet", 0.007, 0.007, 0.004, p + n * 0.004, m["button"], segments=10, rot=align_to_normal(n) @ Matrix.Rotation(math.pi / 2, 3, "X")))
    return finish(ob, rig, extra, bands)


def bottom_chinos(body, rig, m):
    def offset(p):
        if region_of(p) == "Torso":
            return 0.018
        return 0.016 + max(0.0, 0.45 - p.z) * 0.06
    ob, bands = _pants(body, rig, m, "Bottom_Chinos", 0.11, offset)
    return finish(ob, rig, bands=bands)


def bottom_shorts(body, rig, m):
    ob, bands = _pants(body, rig, m, "Bottom_Shorts", 0.60, lambda p: 0.017 + max(0.0, 0.75 - p.z) * 0.08)
    return finish(ob, rig, bands=bands)


def bottom_skirt(body, rig, m):
    rows, segs = 12, 32
    bm = bmesh.new()
    grid = []
    for r in range(rows + 1):
        t = r / rows
        z = 0.995 - t * 0.43
        rx = 0.138 + t * 0.085 + 0.012 * t * t
        ry = 0.108 + t * 0.07
        ring = []
        for s in range(segs):
            a = math.tau * s / segs
            wave = 0.006 * t * math.sin(a * 6)
            ring.append(bm.verts.new((math.sin(a) * (rx + wave), -math.cos(a) * (ry + wave) + 0.008, z)))
        grid.append(ring)
    for r in range(rows):
        for s in range(segs):
            bm.faces.new((grid[r][s], grid[r][(s + 1) % segs], grid[r + 1][(s + 1) % segs], grid[r + 1][s]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_from_bmesh("Bottom_Skirt", bm, m["bottom"])
    waist = [Vector((math.sin(a) * 0.141, -math.cos(a) * 0.111 + 0.008, 0.995)) for a in [k * math.tau / 32 for k in range(32)]]
    bands = [band(waist, 0.012, m["bottom_trim"], "waist", push=0.002)]
    # Short liner over the hips so nothing shows under the skirt.
    liner, liner_bands = _pants(body, rig, m, "liner", 0.74, lambda p: 0.012)
    for b in liner_bands:  # hidden under the skirt; don't leave them lying around
        remove(b)
    return finish(ob, rig, [liner], bands)


BOTTOMS = {"jeans": bottom_jeans, "chinos": bottom_chinos, "shorts": bottom_shorts, "skirt": bottom_skirt}
BOTTOM_HIDES = {"jeans": ["Thighs", "Shins"], "chinos": ["Thighs", "Shins"], "shorts": [], "skirt": []}


# ---------------------------------------------------------------------------
# Shoes
# ---------------------------------------------------------------------------

def _shoe_upper(body, m, top_z, offset, name):
    def keep(c, region):
        return c.z <= top_z
    return gather(body, {"Feet", "Shins"}, keep, lambda p: offset, name, mats=[m["shoes"]])


def _soles(m, height, extra_len=0.0):
    soles = []
    for s in (1, -1):
        soles.append(rounded_box(f"sole{s}", (0.104, 0.215 + extra_len, height), (0.092 * s, -0.036, height / 2 - 0.004), m["sole"], bevel=min(0.012, height / 2.2)))
    return soles


def shoes_sneakers(body, rig, m):
    up = _shoe_upper(body, m, 0.13, 0.012, "Shoes_Sneakers")
    extra = _soles(m, 0.03)
    for s in (1, -1):
        for k in range(3):
            y = -0.035 - k * 0.025
            extra.append(cylinder(f"lace{s}{k}", 0.004, 0.004, 0.05, (0.092 * s, y, 0.098 - k * 0.012), m["lace"], segments=6, rot=Matrix.Rotation(math.pi / 2, 3, "Y")))
        extra.append(uv_sphere(f"toe{s}", 0.043, (0.092 * s, -0.115, 0.042), (1.05, 0.9, 0.62), 16, 10, m["sole"]))
    bands = [band(l, 0.009, m["sole"], f"b{i}") for i, l in enumerate(boundary_loops(up))]
    return finish(up, rig, extra, bands)


def shoes_boots(body, rig, m):
    up = _shoe_upper(body, m, 0.27, 0.015, "Shoes_Boots")
    extra = _soles(m, 0.038, 0.01)
    bands = [band(l, 0.013, m["shoes"], f"b{i}") for i, l in enumerate(boundary_loops(up))]
    for s in (1, -1):
        for k in range(4):
            extra.append(uv_sphere(f"eye{s}{k}", 0.004, (0.092 * s + 0.0, -0.058, 0.13 + k * 0.035), (1, 1, 1), 8, 6, m["button"]))
    return finish(up, rig, extra, bands)


def shoes_loafers(body, rig, m):
    up = _shoe_upper(body, m, 0.078, 0.011, "Shoes_Loafers")
    extra = _soles(m, 0.022)
    for s in (1, -1):
        extra.append(rounded_box(f"strap{s}", (0.07, 0.016, 0.01), (0.092 * s, -0.06, 0.082), m["sole"], bevel=0.004))
    bands = [band(l, 0.007, m["shoes"], f"b{i}") for i, l in enumerate(boundary_loops(up))]
    return finish(up, rig, extra, bands)


SHOES = {"sneakers": shoes_sneakers, "boots": shoes_boots, "loafers": shoes_loafers}
SHOE_HIDES = {"sneakers": ["Feet"], "boots": ["Feet"], "loafers": ["Feet"]}
