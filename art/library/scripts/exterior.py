"""
Exterior: the campus seen through the library's windows (see art/library/ASSETS.md).

`build_exterior()` builds everything IN PLACE around the library from plan.py data (web
coordinates converted with lib_core.bl: Blender x = web x, Blender y = -web z, Blender z = up):

  * ground: a lawn disc (lawn top at GROUND_Z = -0.30), a gravel apron round the podium, the
    stone-paved south terrace + forecourt + main avenue, gravel walks across the quad;
  * the podium (scene_milestone's Architecture_Floor_Base covers plan.BUILDING at floor level):
    a bullnosed stone coping along its open edges and raised lawn beds with kerbs in its yards;
  * the library's own outer walls (plain limestone from arch_shell): a moulded base course, a
    classical cornice that hides the gap under the roof lids, and a coped parapet, on every
    exposed face only (exposure is tested against the taller neighbouring blocks);
  * the entrance forecourt: a landing and two steps down from the main door, pedestals with
    lanterns, lamp standards, benches and low box hedges;
  * ~45 mature trees of four species (English oak, common lime, copper beech, cedar of Lebanon),
    one detailed mesh per species, instanced;
  * a collegiate quad 40-90 m out: four stone ranges (2-4 storeys, mullioned windows with hood
    moulds, string courses, parapets, steep coursed slate roofs, chimneys), a battlemented gate
    tower on the main axis and a copper cupola with clock faces on the north range;
  * a low skyline beyond (distant stone blocks, a dome, spires) and a belt of distant trees;
  * level campus ground out to 300 m that rolls into low hills beyond, with belts of distant
    woodland (a lumpy canopy heightfield, 330-560 m) so the horizon is soft, not a ruled edge;
  * shallow corner pilasters where a lower block meets a taller one flush (lobby/wings,
    hall/north wing): they cover the ends of scene_library's roof lids, which otherwise show
    as dark slots in the taller block's face.

Trees, bays, chimneys and lamp posts are instanced. Run `preview(out)` via run_asset.py.
"""

from __future__ import annotations

import math
import os
import random
import time

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

import lib_core as C
import lib_materials as M
import lib_render as R
import plan as P

# ---------------------------------------------------------------------------
# Palette additions (setdefault: an official entry with the same key wins)
# ---------------------------------------------------------------------------
# Tints multiply the texture in linear space: carpet (cool grey mottle, ~#b2b6c0) becomes a
# soft lawn or pale gravel; oak (honey, ~#b08150) with a cool tint becomes grey-brown bark.
PALETTE_ADDITIONS = {
    "grass": dict(base="#3f5c28", rough=0.93, tex="carpet", size=3.2, normal=0.7, tint="#557a33"),
    "gravel": dict(base="#b9ad95", rough=0.92, tex="carpet", size=0.7, normal=1.0, tint="#fff2c7"),
    "slate": dict(base="#434850", rough=0.6),
    "lead": dict(base="#7b8085", rough=0.45, metal=0.35),
    "copper_verdigris": dict(base="#6f9c8a", rough=0.55, metal=0.25),
    "glass_dark": dict(base="#1c232b", rough=0.07),
    "bark": dict(base="#3e352f", rough=0.9, tex="oak", size=0.9, normal=1.0, tint="#5a6a9a"),
    "bark_beech": dict(base="#5f5e59", rough=0.62, tex="limestone", size=1.2, normal=0.5, tint="#4f5566"),
    "foliage_oak": dict(base="#35512a", rough=0.86, double_sided=True),
    "foliage_lime": dict(base="#45672b", rough=0.86, double_sided=True),
    "foliage_beech": dict(base="#3a1f24", rough=0.86, double_sided=True),
    "foliage_cedar": dict(base="#2a4334", rough=0.86, double_sided=True),
    "foliage_oak_lit": dict(base="#4d6b33", rough=0.8, double_sided=True),
    "foliage_lime_lit": dict(base="#64883a", rough=0.8, double_sided=True),
    "foliage_beech_lit": dict(base="#5a2c2c", rough=0.78, double_sided=True),
    "foliage_cedar_lit": dict(base="#3b5a44", rough=0.8, double_sided=True),
    "foliage_oak_inner": dict(base="#243a1d", rough=0.95, double_sided=True),
    "foliage_lime_inner": dict(base="#2f4a1d", rough=0.95, double_sided=True),
    "foliage_beech_inner": dict(base="#2a151a", rough=0.95, double_sided=True),
    "foliage_woods": dict(base="#2e4128", rough=0.95, double_sided=True),
    "hedge": dict(base="#2c4823", rough=0.82, double_sided=True),
    "stone_far": dict(base="#bcae94", rough=0.9),
    "slate_far": dict(base="#5b5f67", rough=0.8),
    "glass_far": dict(base="#4d5560", rough=0.3),
    "foliage_far": dict(base="#566b4f", rough=0.9, double_sided=True),
}
for _k, _v in PALETTE_ADDITIONS.items():
    M.PALETTE.setdefault(_k, _v)

GROUND_Z = -0.30     # lawn top (Blender z)
GRAVEL_Z = -0.275    # gravel walks top
PAVE_Z = -0.255      # stone paving top (terrace, forecourt, avenue)
PODIUM_Z = -0.002    # top of scene_milestone's Architecture_Floor_Base
B = P.BUILDING
ROT_C = P.ROTUNDA_C
ROT_OUT = P.ROTUNDA_APOTHEM + P.EXT_WALL   # 9.2 outer apothem

T0 = time.time()


def log(msg):
    print(f"[exterior {time.time() - T0:6.1f}s] {msg}", flush=True)


def col(name):
    return C.collection(name, C.collection("EXTERIOR"))


def W(x, z):
    """Web (x, z) -> Blender (x, y)."""
    return (x, -z)


# ---------------------------------------------------------------------------
# Mesh builder
# ---------------------------------------------------------------------------

class MB:
    """A bmesh that collects faces with palette materials (by key) and per-loop UVs."""

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()
        self.keys = []

    def mi(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def face(self, verts, key, uvs=None, smooth=False):
        f = self.bm.faces.new(verts)
        f.material_index = self.mi(key)
        f.smooth = smooth
        if uvs is not None:
            for lp, uv in zip(f.loops, uvs):
                lp[self.uv].uv = uv
        return f

    def poly(self, cos, key, uvs=None, smooth=False):
        return self.face([self.bm.verts.new(c) for c in cos], key, uvs, smooth)

    def box(self, lo, hi, key, size=None, skip=()):
        x0, y0, z0 = lo
        x1, y1, z1 = hi
        s = size or M.tex_size(key)
        quads = {
            "-z": ([(x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)], (0, 1)),
            "+z": ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 1)),
            "-y": ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, 2)),
            "+y": ([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], (0, 2)),
            "-x": ([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], (1, 2)),
            "+x": ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 2)),
        }
        for k, (cos, (a, b)) in quads.items():
            if k in skip:
                continue
            self.poly(cos, key, [(c[a] / s, c[b] / s) for c in cos])

    def obj(self, name, collection=None, smooth_angle=None, merge=False):
        if merge:
            bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=1e-5)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for k in self.keys:
            me.materials.append(M.mat(k))
        ob = bpy.data.objects.new(name, me)
        C.link(ob, collection)
        if smooth_angle is not None:
            try:
                me.set_sharp_from_angle(angle=math.radians(smooth_angle))
            except AttributeError:
                pass
        return ob


def _tube(mb, pts, radii, sides, key, uv_size=1.0, cap_end=True, cap_start=False):
    """A tapered tube along a 3D polyline (branches, iron bars). Outward normals; U along the
    length (grain), V around."""
    n = len(pts)
    pts = [Vector(p) for p in pts]
    tans = []
    for i in range(n):
        if i == 0:
            t = pts[1] - pts[0]
        elif i == n - 1:
            t = pts[-1] - pts[-2]
        else:
            t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
        tans.append(t.normalized())
    ref = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    nrm = tans[0].cross(ref).normalized()
    rings, svals = [], [0.0]
    for i in range(1, n):
        svals.append(svals[-1] + (pts[i] - pts[i - 1]).length)
    for i in range(n):
        if i > 0:
            q = tans[i - 1].rotation_difference(tans[i])
            nrm = q @ nrm
            nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
        b = tans[i].cross(nrm)
        rings.append([mb.bm.verts.new(pts[i] + (nrm * math.cos(math.tau * k / sides) + b * math.sin(math.tau * k / sides)) * radii[i])
                      for k in range(sides)])
    for i in range(n - 1):
        circ = math.tau * (radii[i] + radii[i + 1]) / 2
        for k in range(sides):
            k1 = (k + 1) % sides
            v0, v1 = k / sides * circ / uv_size, (k + 1) / sides * circ / uv_size
            u0, u1 = svals[i] / uv_size, svals[i + 1] / uv_size
            mb.face((rings[i][k], rings[i][k1], rings[i + 1][k1], rings[i + 1][k]), key,
                    [(u0, v0), (u0, v1), (u1, v1), (u1, v0)], smooth=True)
    if cap_end:
        mb.face(rings[-1], key, smooth=False)
    if cap_start:
        mb.face(list(reversed(rings[0])), key, smooth=False)
    return rings


def _hsweep(mb, pts, profile, key, closed=False, size=1.0, caps=True, smooth=True):
    """Sweeps a profile [(o, z), ...] (o = outward offset from the line, z = height, listed bottom
    to top) along a horizontal Blender-XY polyline. Polylines run counter-clockwise round a
    building, so outward is the right-hand side. Mitred corners; U along the run."""
    p2 = [Vector((p[0], p[1])) for p in pts]
    n = len(p2)
    seg = n if closed else n - 1
    nrm = []
    for i in range(seg):
        d = (p2[(i + 1) % n] - p2[i]).normalized()
        nrm.append(Vector((d.y, -d.x)))
    miters = []
    for i in range(n):
        if closed:
            n0, n1 = nrm[i - 1], nrm[i % seg]
        else:
            n0, n1 = nrm[max(i - 1, 0)], nrm[min(i, seg - 1)]
        den = 1.0 + n0.dot(n1)
        miters.append((n0 + n1) / den if den > 1e-6 else n1)
    s = [0.0]
    for i in range(1, n + (1 if closed else 0)):
        s.append(s[-1] + (p2[i % n] - p2[i - 1]).length)
    t = [0.0]
    for a, b in zip(profile, profile[1:]):
        t.append(t[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    rings = [[mb.bm.verts.new((p2[i].x + miters[i].x * o, p2[i].y + miters[i].y * o, z)) for o, z in profile] for i in range(n)]
    m = len(profile)
    for i in range(seg):
        j = (i + 1) % n
        for k in range(m - 1):
            mb.face((rings[i][k], rings[j][k], rings[j][k + 1], rings[i][k + 1]), key,
                    [(s[i] / size, t[k] / size), (s[i + 1] / size, t[k] / size),
                     (s[i + 1] / size, t[k + 1] / size), (s[i] / size, t[k + 1] / size)], smooth=smooth)
    if caps and not closed:
        for ring, d in ((rings[0], p2[0] - p2[1]), (rings[-1], p2[-1] - p2[-2])):
            vs = list(ring)
            nv = Vector((0, 0, 0))
            for a, b in zip(vs, vs[1:] + vs[:1]):
                nv += a.co.cross(b.co)
            if nv.dot(Vector((d.x, d.y, 0))) < 0:
                vs.reverse()
            try:
                mb.face(vs, key, [(v.co.x / size if abs(d.y) > abs(d.x) else v.co.y / size, v.co.z / size) for v in vs])
            except ValueError:
                pass
    return rings


def _arc(cx, cz, r, a0, a1, n):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cz + r * math.sin(math.radians(a0 + (a1 - a0) * i / n)))
            for i in range(n + 1)]


def _scale_prof(prof, s, z0=0.0):
    return [(o * s, z0 + z * s) for o, z in prof]


def _union(name, objs, key, collection, bevel_w=0.0):
    """Boolean union of overlapping slabs into one clean mesh (no coplanar overlaps)."""
    base = objs[0]
    if len(objs) > 1:
        tmp = bpy.data.collections.new(name + "_Ops")
        bpy.context.scene.collection.children.link(tmp)
        for o in objs[1:]:
            for c in list(o.users_collection):
                c.objects.unlink(o)
            tmp.objects.link(o)
        mod = base.modifiers.new("union", "BOOLEAN")
        mod.operation = "UNION"
        mod.operand_type = "COLLECTION"
        mod.collection = tmp
        try:
            mod.solver = "MANIFOLD"
        except TypeError:
            mod.solver = "EXACT"
        C.apply_modifiers(base)
        for o in objs[1:]:
            C.remove(o)
        bpy.data.collections.remove(tmp)
    base.name = base.data.name = name
    C.move_to(base, collection)
    C.set_material(base, M.mat(key))
    if bevel_w:
        C.bevel(base, bevel_w, 2, 40)
    _uvbox(base, M.tex_size(key))
    return base


def _difference(ob, cutters):
    cut = C.join(cutters, ob.name + "_Cutter")
    mod = ob.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cut
    C.apply_modifiers(ob)
    C.remove(cut)
    return ob


_PLACED = set()


def _uvbox(ob, size=1.0, grain=None):
    me = ob.data
    if me.uv_layers and me.uv_layers.active is None:
        me.uv_layers.active_index = 0
    return C.uv_box(ob, size, grain)


def _use(src, name, loc, rot=0.0, scale=None, collection=None):
    """The first use of a source mesh object places the object itself; later uses are linked
    duplicates (no hidden source objects are left in the scene)."""
    if src.as_pointer() not in _PLACED:
        _PLACED.add(src.as_pointer())
        src.name = name
        src.location = Vector(loc)
        src.rotation_euler = (0, 0, rot)
        if scale is not None:
            src.scale = Vector(scale)
        if collection is not None:
            C.move_to(src, collection)
        return src
    return C.instance(src, name, loc, rot, scale or (1, 1, 1), col=collection)


def _obox(mb, c, ex, ey, ez, key, size=1.0):
    """Oriented box: centre c and half-extent vectors (right-handed ex, ey, ez)."""
    c, ex, ey, ez = Vector(c), Vector(ex), Vector(ey), Vector(ez)
    if ex.cross(ey).dot(ez) < 0:
        ez = -ez

    def P_(sx, sy, sz):
        return c + ex * sx + ey * sy + ez * sz
    quads = [[P_(-1, -1, -1), P_(-1, 1, -1), P_(1, 1, -1), P_(1, -1, -1)], [P_(-1, -1, 1), P_(1, -1, 1), P_(1, 1, 1), P_(-1, 1, 1)],
             [P_(-1, -1, -1), P_(1, -1, -1), P_(1, -1, 1), P_(-1, -1, 1)], [P_(1, 1, -1), P_(-1, 1, -1), P_(-1, 1, 1), P_(1, 1, 1)],
             [P_(-1, 1, -1), P_(-1, -1, -1), P_(-1, -1, 1), P_(-1, 1, 1)], [P_(1, -1, -1), P_(1, 1, -1), P_(1, 1, 1), P_(1, -1, 1)]]
    for q in quads:
        nv = (q[1] - q[0]).cross(q[3] - q[0])
        a = 0 if abs(nv.x) < max(abs(nv.y), abs(nv.z)) else 1
        mb.poly(q, key, [((v.y if a else v.x) / size, v.z / size) for v in q])


# ---------------------------------------------------------------------------
# Footprint: blocks of the library (web rects), with wall tops and roof-lid tops
# ---------------------------------------------------------------------------
# Lid tops mirror scene_library.build_roofs (lids sit on/above each room's walls).
BLOCKS = [
    dict(id="hall", r=(-14.8, 14.8, -10.8, 8.8), top=P.HALL_WALL_TOP, lid=P.HALL_WALL_TOP + 0.3, s=1.55, parapet=0.95),
    dict(id="lobby", r=(-6.3, 6.3, 8.8, 20.8), top=P.LOBBY_CEILING + 0.3, lid=P.LOBBY_CEILING + 0.8, s=1.15, parapet=0.75),
    dict(id="quiet", r=(-18.8, -6.3, 8.0, 20.8), top=P.WING_CEILING + 0.3, lid=P.WING_CEILING + 0.8, s=0.9, parapet=0.6),
    dict(id="group", r=(6.3, 18.8, 8.0, 20.8), top=P.WING_CEILING + 0.3, lid=P.WING_CEILING + 0.8, s=0.9, parapet=0.6),
    dict(id="lounge", r=(-24.2, -14.8, -7.2, 5.2), top=P.LOUNGE_CEILING + 0.4, lid=P.LOUNGE_CEILING + 0.9, s=1.0, parapet=0.65),
    dict(id="north", r=(-14.8, 14.8, -17.0, -10.8), top=P.WING_CEILING + 0.3, lid=P.WING_CEILING + 0.8, s=0.9, parapet=0.6),
]
HALL_ONLY = getattr(P, "HALL_ONLY", False)
if HALL_ONLY:  # the library is just the reading hall: no lobby, wings or lounge blocks outside it
    BLOCKS = [b for b in BLOCKS if b["id"] == "hall"]
LIFT_R = (P.LIFT["shaft"]["minX"], P.LIFT["shaft"]["maxX"], P.LIFT["shaft"]["minZ"], P.LIFT["shaft"]["maxZ"])


def _in_rect(x, z, r, m=0.0):
    return r[0] - m < x < r[1] + m and r[2] - m < z < r[3] + m


def _in_rotunda(x, z, m=0.0):
    dx, dz = x - ROT_C[0], z - ROT_C[1]
    for k in range(12):
        a = math.radians(30 * k)
        if dx * math.cos(a) + dz * math.sin(a) > ROT_OUT + m:
            return False
    return True


def _occupied(x, z, height=0.0, exclude=None, rot_m=0.3):
    """Is web (x, z) inside part of the building that stands taller than `height`?"""
    for b in BLOCKS:
        if b is not exclude and b["lid"] > height and _in_rect(x, z, b["r"]):
            return True
    if height < P.HALL_CEILING and _in_rect(x, z, LIFT_R):
        return True
    if HALL_ONLY:  # no rotunda beside the hall: its east face is fully exposed
        return False
    if height < 11.5:
        return _in_rotunda(x, z, rot_m)
    # Above the rotunda's walls only its dome stands: keep cornices clear of it.
    return math.hypot(x - ROT_C[0], z - ROT_C[1]) < ROT_OUT / math.cos(math.radians(15)) + 1.0


def _outer_doors():
    """[(axis, face coordinate, lo, hi)] of ground-level doors in the outer faces."""
    out = []
    for w in P.WALLS:
        if w.inside == "both":
            continue
        b = w.bounds
        for o in w.openings:
            if o.y0 > 0.3 or not (o.kind.startswith("door") or o.kind == "exit"):
                continue
            if w.axis == "x":
                coord = b["maxZ"] if w.inside == "north" else b["minZ"]
            else:
                coord = b["maxX"] if w.inside == "west" else b["minX"]
            out.append((w.axis, coord, o.at - o.width / 2 - 0.05, o.at + o.width / 2 + 0.05))
    return out


def _at_door(x, z, axis):
    for ax, coord, lo, hi in _outer_doors():
        if ax != axis:
            continue
        if axis == "x" and abs(z - coord) < 0.05 and lo <= x <= hi:
            return True
        if axis == "z" and abs(x - coord) < 0.05 and lo <= z <= hi:
            return True
    return False


def _rect_loop_bl(r):
    """CCW (Blender XY) corner loop of a web rect."""
    x0, x1, z0, z1 = r
    return [(x0, -z1), (x1, -z1), (x1, -z0), (x0, -z0)]


def _exposed_runs(r, test, step=0.1):
    """Splits the CCW loop of rect `r` into runs (Blender XY polylines) where test(x, z, nx, nz)
    is True for the points just outside the face. Returns (runs, closed)."""
    loop = _rect_loop_bl(r)
    samples = []   # (point, exposed, is_corner)
    for i in range(4):
        a, b = Vector(loop[i]), Vector(loop[(i + 1) % 4])
        d = b - a
        L = d.length
        d.normalize()
        nrm = Vector((d.y, -d.x))
        k = int(round(L / step))
        for j in range(k):
            p0 = a + d * (j * L / k)
            mid = a + d * ((j + 0.5) * L / k)
            samples.append((p0, test(mid.x, -mid.y, nrm.x, -nrm.y, d), j == 0))
    n = len(samples)
    if all(e for _, e, _ in samples):
        return [[tuple(p) for p, _, c in samples if c]], True
    start = next(i for i in range(n) if not samples[i][1])
    runs, cur = [], None
    for jj in range(1, n + 1):
        i = (start + jj) % n
        p, e, corner = samples[i]
        if e:
            if cur is None:
                cur = [tuple(p)]
            elif corner:
                cur.append(tuple(p))
        else:
            if cur is not None:
                cur.append(tuple(p))
                runs.append(cur)
                cur = None
    if cur is not None:
        cur.append(tuple(samples[start][0]))
        runs.append(cur)
    return [r_ for r_ in runs if len(r_) >= 2 and (Vector(r_[0]) - Vector(r_[-1])).length > 0.05], False


# ---------------------------------------------------------------------------
# Library trim: base course, cornice, parapet
# ---------------------------------------------------------------------------

def _plinth_profile():
    prof = [(0.0, -0.34), (0.13, -0.34), (0.13, 0.19), (0.122, 0.212), (0.105, 0.222), (0.055, 0.29), (0.03, 0.296)]
    prof += _arc(0.03, 0.327, 0.031, -90, 90, 6)[1:]
    prof += [(0.0, 0.358)]
    return prof


def _cornice_profile():
    """Classical cornice, 0 at its base, ~0.57 tall, ~0.46 projection (scaled per block)."""
    p = [(0.0, 0.0), (0.035, 0.0), (0.035, 0.07), (0.05, 0.075)]
    # bed mould: cyma reversa (convex below, concave above)
    for i in range(1, 7):
        t = i / 6
        p.append((0.05 + 0.09 * t, 0.075 + 0.1 * (0.5 - 0.5 * math.cos(math.pi * t)) + 0.02 * math.sin(math.pi * t)))
    p += [(0.14, 0.19), (0.17, 0.2), (0.35, 0.215), (0.365, 0.225), (0.365, 0.37), (0.385, 0.375), (0.385, 0.405)]
    # cymatium: cyma recta (concave below, convex above)
    for i in range(1, 8):
        t = i / 7
        p.append((0.385 + 0.08 * (0.5 - 0.5 * math.cos(math.pi * t)), 0.405 + 0.13 * t))
    p += [(0.465, 0.56), (0.465, 0.575), (0.0, 0.575)]
    return p


def _parapet_profile(h):
    return [(0.0, 0.0), (0.0, h - 0.09), (0.045, h - 0.09), (0.045, h - 0.045), (-0.12, h), (-0.44, h - 0.035),
            (-0.44, h - 0.09), (-0.4, h - 0.09), (-0.4, 0.0)]


def build_library_trim():
    """Base course, cornice and parapet on the library's exposed outer faces (in place)."""
    c = col("Exterior_LibraryTrim")
    mb = MB()
    key = "limestone_plain"
    size = M.tex_size(key)
    plinth = _plinth_profile()

    def ground_test(x, z, nx, nz, d):
        px, pz = x + nx * 0.08, z + nz * 0.08
        if _occupied(px, pz, 0.0, rot_m=0.35):
            return False
        return not _at_door(x, z, "x" if abs(d.x) > abs(d.y) else "z")

    for b in BLOCKS:
        runs, closed = _exposed_runs(b["r"], ground_test)
        for run in runs:
            _hsweep(mb, run, plinth, key, closed=closed, size=size)
        s = b["s"]
        prof = _scale_prof(_cornice_profile(), s)
        hgt = 0.575 * s
        z0 = b["lid"] - hgt
        corn = [(o, z0 + z) for o, z in prof]
        par = [(o, b["lid"] + z) for o, z in _parapet_profile(b["parapet"])]

        def top_test(x, z, nx, nz, d, b=b):
            px, pz = x + nx * 0.25, z + nz * 0.25
            return not _occupied(px, pz, b["lid"] - 0.2, exclude=b)

        runs, closed = _exposed_runs(b["r"], top_test)
        for run in runs:
            _hsweep(mb, run, corn, key, closed=closed, size=size)
            _hsweep(mb, run, par, key, closed=closed, size=size)
        # a fascia band (architrave line) one cornice-height below, on the same runs
        fas = [(0.0, z0 - 0.42 * s), (0.03 * s, z0 - 0.42 * s), (0.03 * s, z0 - 0.26 * s), (0.012 * s, z0 - 0.245 * s), (0.0, z0 - 0.245 * s)]
        for run in runs:
            _hsweep(mb, run, fas, key, closed=closed, size=size)
    ob = mb.obj("Exterior_Library_Trim", c, smooth_angle=40)
    return [ob] + _junction_pilasters(c)


# Where a lower block meets a taller one flush, scene_library's roof lids (0.8 m overhang) end
# exactly in the taller block's outer face, leaving a dark slot at the lower lid's height. A
# shallow pilaster on the taller block's corner covers it (and is the classical way to mark
# the junction). (face axis, outward sign, face coordinate, span lo..hi, top z)
_PILASTERS = [
    ("x", +1, B["maxZ"], (-6.3, -5.3), P.LOBBY_CEILING + 0.8 - 0.575 * 1.15 - 0.42 * 1.15 - 0.06),   # lobby / quiet wing
    ("x", +1, B["maxZ"], (5.3, 6.3), P.LOBBY_CEILING + 0.8 - 0.575 * 1.15 - 0.42 * 1.15 - 0.06),     # lobby / group wing
    ("z", -1, -14.8, (-10.8, -9.85), P.HALL_WALL_TOP + 0.3 - 0.575 * 1.55 - 0.42 * 1.55 - 0.06),   # hall / computers
    ("z", +1, 14.8, (-10.8, -9.85), P.HALL_WALL_TOP + 0.3 - 0.575 * 1.55 - 0.42 * 1.55 - 0.06),    # hall / services
]


if HALL_ONLY:
    _PILASTERS = []  # no lower blocks meet the hall


def _junction_pilasters(c):
    if not _PILASTERS:
        return []
    key = "limestone_plain"
    stone = M.mat(key)
    parts = []
    for axis, sg, coord, (lo, hi), top in _PILASTERS:
        # (offset out of the face, z0, z1, extra width each side): plinth block, shaft, capital
        steps = [(0.07, 0.355, 0.62, 0.035), (0.035, 0.62, top - 0.24, 0.0), (0.055, top - 0.24, top - 0.17, 0.02),
                 (0.08, top - 0.17, top, 0.045)]
        for k, (o, z0, z1, ex) in enumerate(steps):
            a, b = lo - ex, hi + ex
            if axis == "x":
                # face at web z = coord (Blender y = -coord), outward = +web z = -Blender y
                y_out = -coord - sg * o
                lo_v, hi_v = (a, min(y_out, -coord + sg * 0.02), z0), (b, max(y_out, -coord + sg * 0.02), z1)
            else:
                x_out = coord + sg * o
                lo_v, hi_v = (min(x_out, coord - sg * 0.02), -b, z0), (max(x_out, coord - sg * 0.02), -a, z1)
            ob = C.box_minmax(f"pil{k}", lo_v, hi_v, stone, bevel_w=0.008 if k != 1 else 0.005)
            parts.append(ob)
    ob = C.join(parts, "Exterior_Library_Pilasters")
    _uvbox(ob, M.tex_size(key), grain="z")
    C.move_to(ob, c)
    return [ob]


# ---------------------------------------------------------------------------
# Ground, paths, podium
# ---------------------------------------------------------------------------

GROUND_C = (4.0, -2.0)   # Blender xy centre of the lawn disc / skyline rings
FLAT_R = 300.0           # the campus is level out to here; beyond it the country rolls


def _terrain(x, y):
    """Ground height (Blender z) at Blender (x, y): flat campus, low hills beyond FLAT_R."""
    r = math.hypot(x - GROUND_C[0], y - GROUND_C[1])
    t = max(0.0, min(1.0, (r - FLAT_R) / 520.0))
    if t <= 0.0:
        return GROUND_Z
    s = t * t * (3 - 2 * t)
    big = noise.noise(Vector((x * 0.0042, y * 0.0042, 0.5)))
    small = noise.noise(Vector((x * 0.012, y * 0.012, 3.5)))
    return GROUND_Z + s * max(1.5, 9.0 + 12.0 * big + 3.0 * small)


def build_ground():
    """A lawn disc (1.1 km) that is level across the campus and rolls into low hills beyond
    300 m, so the horizon is a soft line of fields, not a ruled edge."""
    c = col("Exterior_Ground")
    mb = MB()
    cx, cy = GROUND_C
    radii = [40.0, 120.0, 220.0, FLAT_R, 360.0, 430.0, 510.0, 600.0, 700.0, 820.0, 950.0, 1100.0]
    n = 160
    s = M.tex_size("grass")
    centre = mb.bm.verts.new((cx, cy, GROUND_Z))
    rings = []
    for r in radii:
        ring = []
        for i in range(n):
            a = math.tau * i / n
            x, y = cx + r * math.cos(a), cy + r * math.sin(a)
            ring.append(mb.bm.verts.new((x, y, _terrain(x, y))))
        rings.append(ring)
    for i in range(n):
        vs = (centre, rings[0][i], rings[0][(i + 1) % n])
        mb.face(vs, "grass", [(v.co.x / s, v.co.y / s) for v in vs], smooth=True)
    for a_, b_ in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            vs = (a_[i], b_[i], b_[j], a_[j])
            mb.face(vs, "grass", [(v.co.x / s, v.co.y / s) for v in vs], smooth=True)
    return [mb.obj("Exterior_Ground_Lawn", c)]


def build_woods():
    """Belts of distant woodland on the rising ground (330-560 m): a lumpy canopy heightfield
    with steep edges and gaps for fields, read as a far treeline behind the skyline."""
    c = col("Exterior_Skyline")
    mb = MB()
    cx, cy = GROUND_C
    na = 520
    radii = [330.0, 333.0, 352.0, 372.0, 395.0, 420.0, 448.0, 478.0, 508.0, 535.0, 556.0, 559.0]
    edge = [0.0] + [1.0] * (len(radii) - 2) + [0.0]
    grid = []
    for r, e in zip(radii, edge):
        row = []
        for i in range(na):
            a = math.tau * i / na
            x, y = cx + r * math.cos(a), cy + r * math.sin(a)
            z0 = _terrain(x, y)
            belt = noise.noise(Vector((math.cos(a) * 2.6, math.sin(a) * 2.6, 7.0)))   # where the woods are
            crown = 0.6 * noise.noise(Vector((x * 0.075, y * 0.075, 1.0))) + 0.4 * noise.noise(Vector((x * 0.16, y * 0.16, 2.0)))
            h = (12.0 + 6.5 * crown) if belt > -0.18 else 0.0
            row.append(mb.bm.verts.new((x, y, z0 - 0.4 + e * h)))
        grid.append(row)
    for ra, rb in zip(grid, grid[1:]):
        for i in range(na):
            j = (i + 1) % na
            if ra[i].co.z - _terrain(ra[i].co.x, ra[i].co.y) < 0.1 and rb[i].co.z - _terrain(rb[i].co.x, rb[i].co.y) < 0.1 \
                    and ra[j].co.z - _terrain(ra[j].co.x, ra[j].co.y) < 0.1 and rb[j].co.z - _terrain(rb[j].co.x, rb[j].co.y) < 0.1:
                continue   # a field gap: nothing above the ground here
            mb.face((ra[i], rb[i], rb[j], ra[j]), "foliage_woods", smooth=True)
    bmesh.ops.delete(mb.bm, geom=[v for v in mb.bm.verts if not v.link_faces], context="VERTS")
    return [mb.obj("Exterior_Skyline_Woods", c, smooth_angle=70)]


def _slab(name, x0, x1, z0, z1, top, depth=0.12):
    """A path slab from web rect (x0..x1, z0..z1) with its top at `top`."""
    return C.box_minmax(name, (min(x0, x1), -max(z0, z1), top - depth), (max(x0, x1), -min(z0, z1), top))


# Quad geometry (web): range front faces
QUAD = dict(south=80.0, north=-60.0, west=-66.0, east=76.0)


def build_paths():
    c = col("Exterior_Paths")
    bx0, bx1, bz0, bz1 = B["minX"], B["maxX"], B["minZ"], B["maxZ"]
    A = 2.4   # gravel apron width
    gravel = [
        _slab("g_apron_n", bx0 - A, bx1 + A, bz0 - A, bz0 + 0.05, GRAVEL_Z),
        _slab("g_apron_s", bx0 - A, bx1 + A, bz1 - 0.05, bz1 + A, GRAVEL_Z),
        _slab("g_apron_w", bx0 - A, bx0 + 0.05, bz0 - A, bz1 + A, GRAVEL_Z),
        _slab("g_apron_e", bx1 - 0.05, bx1 + A, bz0 - A, bz1 + A, GRAVEL_Z),
        # walks in front of the four ranges
        _slab("g_walk_s", QUAD["west"] + 2, QUAD["east"] - 2, QUAD["south"] - 4.2, QUAD["south"] - 1.0, GRAVEL_Z),
        _slab("g_walk_n", QUAD["west"] + 2, QUAD["east"] - 2, QUAD["north"] + 1.0, QUAD["north"] + 4.2, GRAVEL_Z),
        _slab("g_walk_w", QUAD["west"] + 1.0, QUAD["west"] + 4.2, QUAD["north"] + 1.0, QUAD["south"] - 1.0, GRAVEL_Z),
        _slab("g_walk_e", QUAD["east"] - 4.2, QUAD["east"] - 1.0, QUAD["north"] + 1.0, QUAD["south"] - 1.0, GRAVEL_Z),
        # cross walk and spurs from the library to the ranges
        _slab("g_cross", QUAD["west"] + 2, QUAD["east"] - 2, 48.5, 51.5, GRAVEL_Z),
        _slab("g_spur_w", QUAD["west"] + 2, bx0 - A + 0.1, -2.5, 0.5, GRAVEL_Z),
        _slab("g_spur_e", bx1 + A - 0.1, QUAD["east"] - 2, -2.5, 0.5, GRAVEL_Z),
        _slab("g_spur_n", -1.6, 1.6, QUAD["north"] + 2, bz0 - A + 0.1, GRAVEL_Z),
    ]
    g = _union("Exterior_Path_Gravel", gravel, "gravel", c)
    paving = [
        _slab("p_terrace", -18.8, 18.8, bz1 - 0.02, bz1 + 2.6, PAVE_Z, 0.16),
        _slab("p_forecourt", -11.5, 11.5, bz1 + 2.0, 34.0, PAVE_Z, 0.16),
        _slab("p_avenue", -3.0, 3.0, 33.0, QUAD["south"] - 1.0, PAVE_Z, 0.16),
    ]
    p = _union("Exterior_Path_Paving", paving, "stone_tiles", c)
    # kerbs: a dressed limestone edge round the paving
    mb = MB()
    loop = [(-18.8, bz1 + 2.6), (-11.5, bz1 + 2.6), (-11.5, 34.0), (-3.0, 34.0), (-3.0, QUAD["south"] - 1.0),
            (3.0, QUAD["south"] - 1.0), (3.0, 34.0), (11.5, 34.0), (11.5, bz1 + 2.6), (18.8, bz1 + 2.6)]
    pts = [W(x, z) for x, z in loop]
    # The run keeps the paving on its left, so outward (right-hand) is the lawn.
    kerb_out = [(0.0, PAVE_Z - 0.07), (0.14, PAVE_Z - 0.07), (0.14, PAVE_Z + 0.01), (0.128, PAVE_Z + 0.022), (0.0, PAVE_Z + 0.022),
                (0.0, PAVE_Z)]
    _hsweep(mb, pts, kerb_out, "limestone_plain", closed=False, size=M.tex_size("limestone_plain"))
    k = mb.obj("Exterior_Path_Kerb", c, smooth_angle=40)
    return [g, p, k]


def build_podium():
    """Bullnosed coping on the podium's open edges + raised lawn beds in its yards."""
    c = col("Exterior_Podium")
    mb = MB()
    key = "limestone_plain"
    prof = [(0.0, -0.34), (0.32, -0.34), (0.32, -0.038)] + _arc(0.27, -0.038, 0.05, 0, 90, 5)[1:] + [(-0.12, 0.012), (-0.12, -0.0019)]

    def test(x, z, nx, nz, d):
        px, pz = x - nx * 0.05, z - nz * 0.05   # just inside the podium edge
        return not _occupied(px, pz, 0.0, rot_m=0.45)

    runs, closed = _exposed_runs((B["minX"], B["maxX"], B["minZ"], B["maxZ"]), test)
    for run in runs:
        _hsweep(mb, run, prof, key, closed=closed, size=M.tex_size(key))
    out = [mb.obj("Exterior_Podium_Coping", c, smooth_angle=40)]
    # Raised lawn beds (web rects) in the podium yards, each with a kerb.
    # Lawn beds in the yards between the wings (none when the library is just the hall).
    beds = [] if HALL_ONLY else [(-23.2, -15.8, -15.9, -8.4), (-23.4, -19.6, 9.0, 20.0), (20.0, 31.4, 10.6, 19.8),
                                 (16.8, 31.2, -15.9, -12.6)]
    for i, (x0, x1, z0, z1) in enumerate(beds):
        mbb = MB()
        loop = _rect_loop_bl((x0, x1, z0, z1))
        kerb = [(0.0, -0.0019), (0.12, -0.0019), (0.12, 0.13), (0.105, 0.15), (0.0, 0.15), (-0.03, 0.15), (-0.03, 0.08)]
        _hsweep(mbb, loop, kerb, key, closed=True, size=M.tex_size(key))
        lx0, ly0, lx1, ly1 = x0 + 0.03, -z1 + 0.03, x1 - 0.03, -z0 - 0.03
        s = M.tex_size("grass")
        cos = [(lx0, ly0, 0.08), (lx1, ly0, 0.08), (lx1, ly1, 0.08), (lx0, ly1, 0.08)]
        mbb.poly(cos, "grass", [(p[0] / s, p[1] / s) for p in cos])
        out.append(mbb.obj(f"Exterior_Podium_LawnBed_{i + 1:02d}", c, smooth_angle=40))
    return out


# ---------------------------------------------------------------------------
# Hedges
# ---------------------------------------------------------------------------

def _rounded_box(mb, size, rr, cell, key, jitter=0.0, seed=0.0, skip_bottom=True, xf=None):
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    h = Vector((hx, hy, hz))
    inner_h = Vector((max(hx - rr, 0.0), max(hy - rr, 0.0), max(hz - rr, 0.0)))

    def mapv(q):
        inner = Vector((max(-inner_h.x, min(inner_h.x, q.x)), max(-inner_h.y, min(inner_h.y, q.y)), max(-inner_h.z, min(inner_h.z, q.z))))
        d = q - inner
        if d.length < 1e-9:
            return q
        dn = d.normalized()
        p = inner + dn * rr
        if jitter:
            p += dn * jitter * noise.noise(p * 2.6 + Vector((seed, seed * 0.7, 0)))
            p += dn * jitter * 0.5 * noise.noise(p * 7.0 + Vector((0, seed, 3)))
        return p
    # (axis, u axis, v axis) with sign: normal axis a, grid over u, v with u x v = sign * a
    specs = [(0, 1, 2, 1), (0, 2, 1, -1), (1, 2, 0, 1), (1, 0, 2, -1), (2, 0, 1, 1), (2, 1, 0, -1)]
    for a, ua, va, sg in specs:
        if skip_bottom and a == 2 and sg < 0:
            continue
        nu = max(2, int(math.ceil(2 * h[ua] / cell)))
        nv = max(2, int(math.ceil(2 * h[va] / cell)))
        grid = []
        for i in range(nu + 1):
            row = []
            for j in range(nv + 1):
                q = Vector((0, 0, 0))
                q[a] = sg * h[a]
                q[ua] = -h[ua] + 2 * h[ua] * i / nu
                q[va] = -h[va] + 2 * h[va] * j / nv
                p = mapv(q)
                if xf is not None:
                    p = xf @ p
                row.append(mb.bm.verts.new(p))
            grid.append(row)
        for i in range(nu):
            for j in range(nv):
                mb.face((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]), key, smooth=True)


def _hedge(name, a, b, width=0.62, height=0.78, collection=None, seed=1.0, base_z=GROUND_Z):
    """A clipped box hedge from web point a to b (ends rounded), standing on the lawn."""
    pa, pb = Vector(W(*a)), Vector(W(*b))
    d = pb - pa
    L = d.length
    ang = math.atan2(d.y, d.x)
    mb = MB()
    xf = Matrix.Translation(((pa.x + pb.x) / 2, (pa.y + pb.y) / 2, base_z - 0.05 + height / 2)) @ Matrix.Rotation(ang, 4, "Z")
    _rounded_box(mb, (L, width, height + 0.05), 0.16, 0.16, "hedge", jitter=0.035, seed=seed, xf=xf)
    ob = mb.obj(name, collection, merge=True)
    return ob


# ---------------------------------------------------------------------------
# Forecourt: landing, steps, pedestals, lamps, benches, hedges
# ---------------------------------------------------------------------------

def _lamp_post(name="Exterior_LampPost", collection=None, pedestal=False):
    """Cast-iron lamp standard with a tapered square lantern (origin at its foot)."""
    iron, glass = M.mat("iron"), M.mat("glass_frosted")
    parts = []
    if not pedestal:
        parts.append(C.lathe(name + "_Base", [(0.215, 0.0), (0.215, 0.05), (0.195, 0.07), (0.19, 0.27), (0.17, 0.29), (0.15, 0.3),
                                               (0.15, 0.33), (0.125, 0.36), (0.1, 0.44), (0.084, 0.53), (0.08, 0.565), (0.095, 0.58),
                                               (0.095, 0.62), (0.072, 0.64)], 20, iron))
        shaft = C.lathe(name + "_Shaft", [(0.072, 0.64), (0.066, 1.4), (0.056, 2.2), (0.052, 2.7), (0.06, 2.72), (0.06, 2.76),
                                           (0.048, 2.78)], 24, iron, cap_bottom=False)
        for v in shaft.data.vertices:
            if 0.66 < v.co.z < 2.69:
                th = math.atan2(v.co.y, v.co.x)
                v.co.x *= 1 - 0.07 * max(0.0, math.cos(12 * th))
                v.co.y *= 1 - 0.07 * max(0.0, math.cos(12 * th))
        parts.append(shaft)
        parts.append(C.lathe(name + "_Collar", [(0.048, 2.78), (0.075, 2.81), (0.078, 2.85), (0.046, 2.9), (0.046, 3.0),
                                                (0.07, 3.04), (0.1, 3.09), (0.105, 3.13), (0.0, 3.13)], 20, iron))
        arm = C.box(name + "_Arm", (0.64, 0.03, 0.03), (0, 0, 2.96), iron, bevel_w=0.006)
        parts.append(arm)
        for sx in (-1, 1):
            parts.append(C.sphere(name + f"_ArmBall{sx}", 0.032, (sx * 0.335, 0, 2.96), iron, 12, 8))
        z0 = 3.13
    else:
        parts.append(C.lathe(name + "_Base", [(0.16, 0.0), (0.16, 0.04), (0.12, 0.08), (0.07, 0.2), (0.05, 0.36), (0.07, 0.4),
                                               (0.1, 0.44), (0.0, 0.44)], 20, iron))
        z0 = 0.44
    sq = math.sqrt(2)
    rot45 = C.rotz(45)
    parts.append(C.lathe(name + "_LanternFloor", [(0.0, z0), (0.15 * sq, z0), (0.15 * sq, z0 + 0.04), (0.12 * sq, z0 + 0.05)], 4, iron,
                         rot=rot45, smooth_angle=20))
    g0, g1 = z0 + 0.05, z0 + 0.6
    pane = C.lathe(name + "_Glass", [(0.118 * sq, g0), (0.188 * sq, g1)], 4, glass, rot=rot45, cap_top=False, cap_bottom=False, smooth_angle=20)
    parts.append(pane)
    mb = MB()
    for k in range(4):
        a = math.radians(45 + 90 * k)
        p0 = Vector((0.122 * sq * math.cos(a), 0.122 * sq * math.sin(a), g0))
        p1 = Vector((0.192 * sq * math.cos(a), 0.192 * sq * math.sin(a), g1))
        _tube(mb, [p0, p1], [0.014, 0.014], 6, "iron", 0.3)
    # glazing bars mid-height
    for k in range(4):
        a0, a1 = math.radians(45 + 90 * k), math.radians(135 + 90 * k)
        zz = (g0 + g1) / 2
        rr = 0.155 * sq + 0.004
        _tube(mb, [(rr * math.cos(a0), rr * math.sin(a0), zz), (rr * math.cos(a1), rr * math.sin(a1), zz)], [0.008, 0.008], 5, "iron", 0.3)
    parts.append(mb.obj(name + "_Frame"))
    parts.append(C.lathe(name + "_Roof", [(0.0, g1), (0.2 * sq, g1), (0.24 * sq, g1 + 0.03), (0.24 * sq, g1 + 0.055), (0.16 * sq, g1 + 0.12),
                                          (0.07 * sq, g1 + 0.22), (0.035 * sq, g1 + 0.27)], 4, iron, rot=rot45, smooth_angle=20))
    parts.append(C.lathe(name + "_Finial", [(0.04, g1 + 0.26), (0.05, g1 + 0.29), (0.03, g1 + 0.33), (0.038, g1 + 0.37),
                                            (0.012, g1 + 0.43), (0.0, g1 + 0.44)], 16, iron))
    ob = C.join(parts, name)
    _uvbox(ob, 0.3)
    ob["light_points"] = [(0.0, 0.0, (g0 + g1) / 2)]
    ob["light_color"] = (1.0, 0.82, 0.56)
    if collection is not None:
        C.move_to(ob, collection)
    return ob


def _bench(name="Exterior_Bench", collection=None):
    """Park bench, 1.8 m, seat 0.45 m: cast-iron ends + oak slats. Front faces -Y."""
    mb = MB()
    r = 0.019
    for x in (-0.84, 0.0, 0.84):
        end = abs(x) > 0.1
        _tube(mb, [(x, -0.25, 0.0), (x, -0.235, 0.2), (x, -0.22, 0.42 if not end else 0.6)], [r, r * 0.9, r * 0.85], 8, "iron", 0.3)
        _tube(mb, [(x, 0.23, 0.0), (x, 0.2, 0.2), (x, 0.17, 0.4), (x, 0.21, 0.6), (x, 0.27, 0.84)], [r, r, r * 0.9, r * 0.85, r * 0.8], 8, "iron", 0.3)
        _tube(mb, [(x, -0.27, 0.405), (x, 0.0, 0.41), (x, 0.19, 0.405)], [r * 0.85] * 3, 8, "iron", 0.3, cap_start=True)
        _tube(mb, [(x, -0.24, 0.12), (x, 0.0, 0.1), (x, 0.215, 0.12)], [r * 0.7] * 3, 6, "iron", 0.3, cap_start=True)
        if end:
            _tube(mb, [(x, 0.22, 0.62), (x, 0.05, 0.655), (x, -0.16, 0.64), (x, -0.255, 0.62), (x, -0.275, 0.58), (x, -0.25, 0.555)],
                  [0.02, 0.021, 0.021, 0.02, 0.017, 0.014], 8, "iron", 0.3, cap_start=True)
        for y in (-0.25, 0.23):
            mb.box((x - 0.035, y - 0.035, 0.0), (x + 0.035, y + 0.035, 0.018), "iron")
    iron = mb.obj(name + "_Iron", smooth_angle=50)
    slats = []
    for i, y in enumerate((-0.215, -0.13, -0.045, 0.04, 0.125)):
        s = C.box(name + f"_Seat{i}", (1.86, 0.074, 0.032), (0, y, 0.45 - 0.016), M.mat("oak"), bevel_w=0.006)
        slats.append(s)
    ang = math.atan2(0.27 - 0.17, 0.84 - 0.4)
    for i, t in enumerate((0.38, 0.6, 0.82)):
        z = 0.4 + (0.84 - 0.4) * t
        y = 0.17 + (0.27 - 0.17) * t - 0.03
        s = C.box(name + f"_Back{i}", (1.86, 0.03, 0.085), (0, y, z), M.mat("oak"), bevel_w=0.006, rot=C.rotx(-math.degrees(ang)))
        slats.append(s)
    wood = C.join(slats, name + "_Slats")
    _uvbox(wood, M.tex_size("oak"), grain="x")
    ob = C.join([iron, wood], name)
    if collection is not None:
        C.move_to(ob, collection)
    return ob


def build_forecourt():
    c = col("Exterior_Forecourt")
    out = []
    z_front = B["maxZ"]   # 20.8: the lobby's outer face
    stone = M.mat("limestone_plain")
    tiles = M.mat("stone_tiles")
    # Landing at floor level, then two steps down to the terrace paving.
    land = C.box_minmax("Exterior_Entrance_Landing", (-4.4, -(z_front + 1.9), -0.3), (4.4, -z_front, 0.0), tiles, bevel_w=0.012)
    _uvbox(land, M.tex_size("stone_tiles"))
    out.append(land)
    # one intermediate step: landing 0.0 -> step -> terrace paving (two equal risers)
    top = PAVE_Z / 2
    zz0 = z_front + 1.9
    st = C.box_minmax("Exterior_Entrance_Step_1", (-4.4, -(zz0 + 0.42), PAVE_Z - 0.1), (4.4, -zz0 + 0.02, top), stone, bevel_w=0.014)
    _uvbox(st, M.tex_size("limestone_plain"), grain="x")
    out.append(st)
    # Pedestals (cheek blocks) at both ends of the landing, with lanterns on them.
    ped_mb = MB()
    pw, pd = 0.72, 2.5
    base_loop = [(-pw / 2, -pd / 2), (pw / 2, -pd / 2), (pw / 2, pd / 2), (-pw / 2, pd / 2)]
    prof = [(0.0, 0.0), (0.08, 0.0), (0.08, 0.16), (0.04, 0.22), (0.0, 0.24), (0.0, 0.86), (0.02, 0.87), (0.06, 0.9), (0.075, 0.93),
            (0.075, 0.99)]
    _hsweep(ped_mb, base_loop, prof, "limestone_plain", closed=True, size=M.tex_size("limestone_plain"))
    cap = [(-pw / 2 - 0.075, -pd / 2 - 0.075, 0.99), (pw / 2 + 0.075, -pd / 2 - 0.075, 0.99), (pw / 2 + 0.075, pd / 2 + 0.075, 0.99),
           (-pw / 2 - 0.075, pd / 2 + 0.075, 0.99)]
    ped_mb.poly(cap, "limestone_plain", [(p[0], p[1]) for p in cap])
    ped = ped_mb.obj("Exterior_Entrance_Pedestal", c, smooth_angle=40)
    ped.location = (-4.4 - pw / 2 - 0.08, -(z_front + pd / 2), PAVE_Z)
    out.append(ped)
    ped2 = C.instance(ped, "Exterior_Entrance_Pedestal_E", (4.4 + pw / 2 + 0.08, -(z_front + pd / 2), PAVE_Z), col=c)
    out.append(ped2)
    lan = _lamp_post("Exterior_Lantern_Pedestal", c, pedestal=True)
    lan.location = (ped.location.x, ped.location.y + 0.3, PAVE_Z + 0.99)
    out.append(lan)
    out.append(C.instance(lan, "Exterior_Lantern_Pedestal_E", (ped2.location.x, ped2.location.y + 0.3, PAVE_Z + 0.99), col=c))
    # Lamp standards round the forecourt and along the avenue.
    post = _lamp_post("Exterior_LampPost_01", c)
    spots = [(-10.8, 24.6), (10.8, 24.6), (-10.8, 33.3), (10.8, 33.3)] + [(sx * 3.5, zz) for zz in (44.0, 58.0, 72.0) for sx in (-1, 1)]
    for i, (x, z) in enumerate(spots):
        ztop = PAVE_Z if abs(x) < 11.5 and z < 34.1 else GROUND_Z
        out.append(_use(post, f"Exterior_LampPost_{i + 1:02d}", (x, -z, ztop), collection=c))
    # Benches: two on the forecourt facing in, two beside the avenue facing it.
    bench = _bench("Exterior_Bench_01", c)
    seats = [(-10.65, 29.0, math.pi / 2), (10.65, 29.0, -math.pi / 2), (-7.0, 47.55, 0.0), (7.0, 47.55, 0.0)]
    for i, (x, z, rot) in enumerate(seats):
        # rot: Blender rotation about Z; front (-Y) turned to face the paving centre line
        ztop = PAVE_Z if abs(x) < 11.5 and z < 34.1 else GROUND_Z
        out.append(_use(bench, f"Exterior_Bench_{i + 1:02d}", (x, -z, ztop), rot, collection=c))
    # Low box hedges framing the forecourt and the terrace lawns.
    hedges = [((-12.4, 24.6), (-12.4, 33.2)), ((12.4, 24.6), (12.4, 33.2)),
              ((-18.6, 24.4), (-13.4, 24.4)), ((13.4, 24.4), (18.6, 24.4)),
              ((-4.3, 35.2), (-4.3, 46.6)), ((4.3, 35.2), (4.3, 46.6)),
              ((-4.3, 53.4), (-4.3, 64.0)), ((4.3, 53.4), (4.3, 64.0))]
    for i, (a, b) in enumerate(hedges):
        out.append(_hedge(f"Exterior_Hedge_{i + 1:02d}", a, b, collection=c, seed=i * 3.1))
    # a low box hedge inside the west yard's lawn bed (seen from the quiet study's west windows)
    out.append(_hedge("Exterior_Hedge_WestYard", (-22.95, 9.5), (-22.95, 19.5), 0.5, 0.62, c, seed=7.7, base_z=0.08))
    return out


# ---------------------------------------------------------------------------
# Trees
# ---------------------------------------------------------------------------

SPECIES = {
    "oak": dict(trunk_r=0.56, bole=2.7, leader=0.55, height=15.0, crown=(7.6, 7.2, 5.0), crown_z=9.0, crown_base=3.4,
                limbs=6, limb_el=(10, 32), reach=0.62, rise=(-0.2, 0.3), lobe_r=(3.0, 3.8), clumps=150, clump_r=(1.45, 1.95),
                cards=58, card=0.6, wander=0.9, bark="bark", leaf="foliage_oak"),
    "lime": dict(trunk_r=0.42, bole=3.0, leader=0.84, height=19.0, crown=(5.0, 4.8, 7.4), crown_z=11.6, crown_base=3.8,
                 limbs=8, limb_el=(48, 66), reach=0.5, rise=(-0.35, 0.55), lobe_r=(2.6, 3.2), clumps=145, clump_r=(1.3, 1.75),
                 cards=58, card=0.56, wander=0.35, bark="bark", leaf="foliage_lime"),
    "beech": dict(trunk_r=0.5, bole=2.0, leader=0.64, height=16.0, crown=(7.0, 6.8, 6.3), crown_z=9.4, crown_base=2.2,
                  limbs=7, limb_el=(28, 52), reach=0.6, rise=(-0.35, 0.4), lobe_r=(3.0, 3.7), clumps=150, clump_r=(1.4, 1.9),
                  cards=58, card=0.58, wander=0.45, bark="bark_beech", leaf="foliage_beech"),
}


def _rand_unit(rng):
    while True:
        v = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        if 0.05 < v.length <= 1.0:
            return v.normalized()


def _blob(mb, rng, p, R, key, squash=0.82, subdiv=2, seed=0.0):
    res = bmesh.ops.create_icosphere(mb.bm, subdivisions=subdiv, radius=R, matrix=Matrix.Translation(p), calc_uvs=False)
    verts = res["verts"]
    off = Vector((seed * 1.7, seed * 0.3, seed * 2.1))
    for v in verts:
        d = (v.co - p)
        dn = d.normalized()
        k = 1.0 + 0.24 * noise.noise(dn * 1.9 + off) + 0.1 * noise.noise(dn * 4.3 + off) + rng.uniform(-0.07, 0.07)
        v.co = p + Vector((dn.x * R * k, dn.y * R * k, dn.z * R * k * squash))
    faces = {f for v in verts for f in v.link_faces}
    mi = mb.mi(key)
    for f in faces:
        f.material_index = mi
        f.smooth = True


def _cards(mb, rng, p, R, n, size, key, squash=0.82, up_bias=0.25, flat=0.0, shell=(0.5, 1.12), key_lit=None, lit=0.0):
    """Folded leaf-spray cards in a volumetric shell round a clump centre (fuzzy, leafy edges).
    With `key_lit`, a share of the upward-facing cards use the lighter, younger-leaf colour."""
    up = Vector((0, 0, 1))
    mi0 = mb.mi(key)
    mi1 = mb.mi(key_lit) if key_lit else mi0
    for _ in range(n):
        d = _rand_unit(rng)
        d.z += up_bias
        d.normalize()
        if d.z < -0.55 and rng.random() < 0.5:
            continue
        mi = mi1 if (d.z > -0.15 and rng.random() < lit) else mi0
        r = rng.uniform(*shell) ** 0.6
        c = p + Vector((d.x * R, d.y * R, d.z * R * squash)) * r
        nv = d * 0.8 + _rand_unit(rng) * 0.9
        if flat:
            nv = nv.lerp(up, flat)
        nv.normalize()
        a = nv.cross(up if abs(nv.z) < 0.95 else Vector((1, 0, 0))).normalized()
        a = (Matrix.Rotation(rng.uniform(0, math.pi), 3, nv) @ a).normalized()
        b = nv.cross(a).normalized()
        s = size * rng.uniform(0.7, 1.25)
        fold = nv * s * 0.13
        v0 = mb.bm.verts.new(c + a * s * 0.5)
        v1 = mb.bm.verts.new(c + b * s * 0.27 + fold)
        v2 = mb.bm.verts.new(c - a * s * 0.5)
        v3 = mb.bm.verts.new(c - b * s * 0.27 + fold)
        for tri in ((v0, v1, v2), (v0, v2, v3)):
            f = mb.bm.faces.new(tri)
            f.material_index = mi
            f.smooth = True


def _skeleton_nearest(skel, p):
    best, bd = None, 1e9
    for q, r in skel:
        d = (q - p).length
        if d < bd:
            best, bd = (q, r), d
    return best


def _bezier(a, b, c, n):
    return [a * (1 - t) ** 2 + b * 2 * t * (1 - t) + c * t * t for t in (i / n for i in range(n + 1))]


def _tree_broadleaf(species, seed=1):
    S = SPECIES[species]
    rng = random.Random(seed * 7919 + len(species))
    mb = MB()
    bark, leaf = S["bark"], S["leaf"]
    bsz = M.tex_size(bark)
    H = S["height"]
    top = S["leader"] * H
    n = 10
    pts, radii = [], []
    for i in range(n + 1):
        t = i / n
        z = -0.4 + (top + 0.4) * t
        w = S["wander"] * 0.35 * t
        off = Vector((noise.noise(Vector((t * 1.6, seed, 0.3))) * w, noise.noise(Vector((seed, t * 1.6, 1.7))) * w, 0))
        pts.append(Vector((0, 0, z)) + off)
        r = S["trunk_r"] * (1 - 0.8 * t)
        if z < 0.9:
            r *= 1 + 0.6 * ((0.9 - z) / 1.3) ** 1.5
        radii.append(r)
    _tube(mb, pts, radii, 14, bark, bsz)
    skel = [(p, r) for p, r in zip(pts, radii) if p.z > S["bole"] * 0.9]
    # Root flare buttresses
    for k in range(5):
        a = math.tau * k / 5 + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0))
        r0 = S["trunk_r"]
        _tube(mb, [d * r0 * 0.4 + Vector((0, 0, 0.9)), d * r0 * 0.9 + Vector((0, 0, 0.15)), d * r0 * 1.6 + Vector((0, 0, -0.25))],
              [r0 * 0.45, r0 * 0.35, r0 * 0.12], 7, bark, bsz)
    cc = Vector((0, 0, S["crown_z"]))
    rx, ry, rz = S["crown"]
    limb_pts = []
    for j in range(S["limbs"]):
        az = math.tau * j / S["limbs"] + rng.uniform(-0.35, 0.35)
        el = math.radians(rng.uniform(*S["limb_el"]))
        h0 = S["bole"] + (top - S["bole"]) * (0.08 + 0.55 * ((j * 0.618) % 1.0)) * (0.6 if species == "oak" else 1.0)
        i0 = min(range(len(pts)), key=lambda i: abs(pts[i].z - h0))
        start = pts[i0]
        r_start = radii[i0] * 0.62
        d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
        end = cc + Vector((math.cos(az) * rx * S["reach"], math.sin(az) * ry * S["reach"], rz * rng.uniform(*S["rise"])))
        mid = start + d * (end - start).length * 0.5
        path = _bezier(start - d * r_start * 0.6, mid, end, 6)
        rr = [r_start * (1 - 0.82 * (i / 6)) for i in range(7)]
        _tube(mb, path, rr, 9, bark, bsz)
        skel += list(zip(path[2:], rr[2:]))
        limb_pts.append((path, rr))
        # a secondary fork off each limb
        k = 3
        fd = (path[k + 1] - path[k]).normalized()
        side = fd.cross(Vector((0, 0, 1))).normalized() * (1 if j % 2 else -1)
        fend = path[k] + (fd + side * 0.9 + Vector((0, 0, 0.5))).normalized() * (end - start).length * 0.45
        fpath = _bezier(path[k], path[k] + fd * 1.2 + Vector((0, 0, 0.4)), fend, 4)
        frr = [rr[k] * 0.7 * (1 - 0.8 * (i / 4)) for i in range(5)]
        _tube(mb, fpath, frr, 7, bark, bsz)
        skel += list(zip(fpath[1:], frr[1:]))
    # The crown: leafy clumps fill the OUTER SHELL of a lumpy crown envelope (an ellipsoid whose
    # radius is modulated by low-frequency noise, so the silhouette breaks into the big rounded
    # sub-crowns of a mature tree), with the limb-end lobes pushing the envelope out. The
    # underside is kept thinner so the limbs read from below, as in a real parkland tree.
    lobes = [(path[-1] + (path[-1] - path[-3]).normalized() * 0.6, rng.uniform(*S["lobe_r"])) for path, _ in limb_pts]
    lobes.append((pts[-1] + Vector((0, 0, 1.0)), S["lobe_r"][1] * 1.05))
    off = Vector((seed * 3.1, seed * 1.3, len(species)))
    centres = []
    tries = 0
    min_d = S["clump_r"][0] * 0.78
    while len(centres) < S["clumps"] and tries < 9000:
        tries += 1
        if rng.random() < 0.3:
            lc, lr = lobes[rng.randrange(len(lobes))]
            u = _rand_unit(rng)
            p = lc + u * lr * rng.uniform(0.55, 1.0) ** 0.5
        else:
            u = _rand_unit(rng)
            if u.z < -0.25 and rng.random() < 0.55:
                continue
            lump = 1.0 + 0.2 * noise.noise(u * 1.8 + off) + 0.08 * noise.noise(u * 4.1 + off)
            p = cc + Vector((u.x * rx, u.y * ry, u.z * rz)) * (rng.uniform(0.66, 1.0) ** 0.5 * lump)
        if p.z < S["crown_base"] + 0.6:
            continue
        if any((p - q).length < min_d for q in centres):
            continue
        centres.append(p)
    for i, p in enumerate(centres):
        R0 = rng.uniform(*S["clump_r"])
        q, rq = _skeleton_nearest(skel, p)
        dvec = p - q
        if dvec.length > 0.6:
            end = p - dvec.normalized() * R0 * 0.3
            midp = q + dvec * 0.5 + Vector((0, 0, 0.2))
            r0 = min(rq * 0.7, 0.11)
            _tube(mb, [q, midp, end], [r0, r0 * 0.6, r0 * 0.35], 5, bark, bsz)
        _blob(mb, rng, p, R0 * 0.36, leaf + "_inner", seed=i + seed, subdiv=1)
        _cards(mb, rng, p, R0, S["cards"], S["card"], leaf, shell=(0.4, 1.15), key_lit=leaf + "_lit", lit=0.45)
    name = f"Exterior_Tree_{species.capitalize()}"
    ob = mb.obj(name, col("Exterior_Trees_Src"), smooth_angle=60)
    return ob


def _tree_cedar(seed=1):
    """Cedar of Lebanon: a massive trunk and flat, layered tiers of dark foliage."""
    rng = random.Random(seed * 104729)
    mb = MB()
    bark, leaf = "bark", "foliage_cedar"
    bsz = M.tex_size(bark)
    top = 15.5
    pts, radii = [], []
    for i in range(11):
        t = i / 10
        z = -0.4 + (top + 0.4) * t
        off = Vector((noise.noise(Vector((t * 1.3, 4.0, seed))) * 0.4 * t, noise.noise(Vector((seed, t * 1.3, 2.0))) * 0.4 * t, 0))
        pts.append(Vector((0, 0, z)) + off)
        r = 0.7 * (1 - 0.86 * t)
        if z < 0.9:
            r *= 1 + 0.55 * ((0.9 - z) / 1.3) ** 1.5
        radii.append(r)
    _tube(mb, pts, radii, 14, bark, bsz)
    tiers = [(3.8, 9.0, 6), (6.4, 8.8, 5), (9.0, 7.4, 5), (11.5, 5.6, 4), (13.8, 3.6, 3)]
    for ti, (zt, spread, nl) in enumerate(tiers):
        for j in range(nl):
            az = math.tau * j / nl + ti * 0.9 + rng.uniform(-0.3, 0.3)
            i0 = min(range(len(pts)), key=lambda i: abs(pts[i].z - zt))
            start = pts[i0]
            r0 = radii[i0] * 0.55
            L = spread * rng.uniform(0.8, 1.0)
            dirv = Vector((math.cos(az), math.sin(az), 0))
            end = start + dirv * L + Vector((0, 0, rng.uniform(1.0, 2.0)))
            mid = start + dirv * L * 0.45 + Vector((0, 0, 1.2))
            path = _bezier(start, mid, end, 5)
            _tube(mb, path, [r0 * (1 - 0.8 * i / 5) for i in range(6)], 8, bark, bsz)
            # flat plates along the outer part of the limb
            for t in (0.4, 0.6, 0.8, 1.0):
                p = path[int(round(t * 5))] + Vector((0, 0, 0.3))
                side = Vector((-dirv.y, dirv.x, 0)) * rng.uniform(-0.9, 0.9)
                for p2 in (p + side, p - side * 0.7):
                    R0 = rng.uniform(1.3, 1.9) * (0.8 + 0.2 * spread / 8.4)
                    _blob(mb, rng, p2, R0 * 0.8, leaf, squash=0.28, seed=ti * 10 + j + t, subdiv=1)
                    _cards(mb, rng, p2, R0 * 1.05, 34, 0.55, leaf, squash=0.3, up_bias=0.5, flat=0.7, shell=(0.45, 1.1), key_lit=leaf + "_lit", lit=0.4)
    p = pts[-1] + Vector((0, 0, 0.3))
    _blob(mb, rng, p, 1.4, leaf, squash=0.45, seed=99)
    _cards(mb, rng, p, 1.4, 24, 0.55, leaf, squash=0.45, up_bias=0.6, flat=0.6)
    return mb.obj("Exterior_Tree_Cedar", col("Exterior_Trees_Src"), smooth_angle=60)


def _tree_far(seed=1, tall=False):
    """Low-detail distant tree for the skyline belt."""
    rng = random.Random(seed)
    mb = MB()
    # crown envelope (half-extents) and centre height: a broad parkland tree or a tall lime
    rx, rz, cz = (5.2, 4.4, 8.6) if not tall else (3.6, 6.4, 10.6)
    base = cz - rz * 0.8
    _tube(mb, [(0, 0, -0.3), (0, 0, base), (0, 0, cz)], [0.45, 0.3, 0.16], 6, "bark", 1.0)
    for k in range(4):
        a = math.tau * k / 4 + rng.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), math.sin(a), 0.0))
        _tube(mb, [Vector((0, 0, base)), Vector((0, 0, base + 1.2)) + d * rx * 0.3, Vector((0, 0, cz + 0.4)) + d * rx * 0.62],
              [0.2, 0.13, 0.06], 5, "bark", 1.0)
    # sub-crowns round the outer shell of the envelope, a lumpy silhouette, no lollipop sphere
    n = 22 if not tall else 20
    off = Vector((seed * 2.3, seed * 0.7, 1.0))
    for k in range(n):
        u = _rand_unit(rng)
        if u.z < -0.45:
            u.z = -u.z * 0.5
            u.normalize()
        lump = 1.0 + 0.18 * noise.noise(u * 1.6 + off)
        p = Vector((u.x * rx, u.y * rx, u.z * rz)) * 0.62 * lump + Vector((0, 0, cz))
        R = rng.uniform(1.9, 2.6) * (0.85 if tall else 1.0)
        _blob(mb, rng, p, R, "foliage_far", squash=0.85, subdiv=1, seed=k + seed)
    return mb.obj(f"Exterior_Tree_Far_{'Tall' if tall else 'Round'}", col("Exterior_Trees_Src"), smooth_angle=60)


_TREE_MESHES = {}

# (species, web x, web z, scale)
TREES = [
    # north lawns (seen over the north wing from the hall's high windows, and from the computers wing)
    ("oak", -24.0, -34.0, 1.0), ("lime", -7.0, -42.0, 1.0), ("beech", 13.0, -38.0, 0.95), ("oak", 33.0, -31.0, 0.9),
    ("cedar", -45.0, -36.0, 1.0), ("lime", 50.0, -44.0, 1.0), ("lime", -34.0, -24.0, 0.9),
    # west lawns (quiet study west windows, lounge windows)
    ("oak", -41.0, 9.0, 1.05), ("beech", -50.0, 33.0, 0.9), ("cedar", -46.0, -16.0, 0.85), ("lime", -33.0, 30.0, 0.85),
    ("oak", -36.0, 58.0, 0.95),
    # south lawns: the lime avenue on the main axis, specimen trees either side
    ("lime", -8.5, 41.0, 0.92), ("lime", 8.5, 41.0, 0.92), ("lime", -8.5, 56.0, 0.95), ("lime", 8.5, 56.0, 0.95),
    ("lime", -8.5, 70.0, 0.9), ("lime", 8.5, 70.0, 0.9),
    ("beech", -25.0, 40.0, 0.9), ("oak", 29.0, 38.0, 0.95), ("cedar", 42.0, 63.0, 0.95), ("lime", -22.0, 64.0, 0.85),
    ("lime", 23.0, 64.0, 0.85),
    # east lawns (group study east windows)
    ("oak", 47.0, 13.0, 1.0), ("lime", 44.0, -17.0, 0.95), ("beech", 58.0, 35.0, 0.95), ("cedar", 60.0, -14.0, 0.8),
    ("lime", 63.0, 8.0, 0.85),
    # quad corners
    ("oak", -58.0, -52.0, 0.9), ("lime", 68.0, -52.0, 0.95), ("beech", -58.0, 72.0, 0.85), ("oak", 68.0, 72.0, 0.9),
    # podium yards (young trees on the lawn beds)
    ("lime", -19.5, -12.2, 0.42), ("oak", 25.6, 15.4, 0.42), ("lime", 24.0, -14.3, 0.32),
    # front lawns of the wings
    ("beech", -15.5, 30.0, 0.55), ("beech", 15.5, 30.0, 0.55),
]


def build_trees():
    c = col("Exterior_Trees")
    src = {}
    for sp in ("oak", "lime", "beech"):
        src[sp] = _tree_broadleaf(sp, seed=3)
        log(f"  tree {sp}: {C.tris(src[sp])} tris")
    src["cedar"] = _tree_cedar(seed=2)
    log(f"  tree cedar: {C.tris(src['cedar'])} tris")
    for sp, ob in src.items():
        _TREE_MESHES[sp] = ob.data
    out = []
    rng = random.Random(11)
    bed_tops = {} if HALL_ONLY else {(-19.5, -12.2): 0.08, (25.6, 15.4): 0.08, (24.0, -14.3): 0.08}
    for i, (sp, x, z, s) in enumerate(TREES):
        zb = bed_tops.get((x, z), GROUND_Z)
        out.append(_use(src[sp], f"Exterior_Tree_{sp.capitalize()}_{i + 1:02d}", (x, -z, zb), rng.uniform(0, math.tau),
                        (s * rng.uniform(0.95, 1.05),) * 3, collection=c))
    return out, []


# ---------------------------------------------------------------------------
# Collegiate ranges round the quad
# ---------------------------------------------------------------------------

BAY_W = 4.8
WALL_T = 0.5
STOREY_H = [4.2, 3.6, 3.6, 3.3]
WIN = [(1.1, 2.3), (0.85, 2.2), (0.85, 1.9), (0.8, 1.6)]   # (sill above floor, height)
WIN_W = 1.3


def _levels(ns):
    lv = [0.0]
    for k in range(ns):
        lv.append(lv[-1] + STOREY_H[k])
    return lv


def _wall_top(ns):
    return _levels(ns)[-1] + 0.6


_BAYS = {}


def _window_parts(mb, x, sill, h, w=WIN_W, depth=0.24, mull=True):
    """Mullioned and transomed window in a hole (front face y = 0), with sill and hood mould."""
    st = "limestone"
    y0 = depth
    mb.poly([(x - w / 2, y0, sill), (x + w / 2, y0, sill), (x + w / 2, y0, sill + h), (x - w / 2, y0, sill + h)], "glass_dark")
    f = 0.055
    mb.box((x - w / 2, y0 - 0.06, sill), (x - w / 2 + f, y0, sill + h), "ivory_paint")
    mb.box((x + w / 2 - f, y0 - 0.06, sill), (x + w / 2, y0, sill + h), "ivory_paint")
    mb.box((x - w / 2 + f, y0 - 0.06, sill + h - f), (x + w / 2 - f, y0, sill + h), "ivory_paint")
    mb.box((x - w / 2 + f, y0 - 0.06, sill + 0.03), (x + w / 2 - f, y0, sill + 0.03 + f), "ivory_paint")
    if mull:
        mw = 0.11
        mb.box((x - mw / 2, 0.05, sill + 0.03), (x + mw / 2, y0 - 0.06, sill + h), st)
        tz = sill + h * 0.64
        mb.box((x - w / 2, 0.05, tz), (x - mw / 2, y0 - 0.06, tz + 0.1), st)
        mb.box((x + mw / 2, 0.05, tz), (x + w / 2, y0 - 0.06, tz + 0.1), st)
    # sill: weathered, projecting, raised above the hole bottom
    mb.box((x - w / 2 - 0.1, -0.11, sill - 0.09), (x + w / 2 + 0.1, y0 - 0.06, sill + 0.03), st)
    # hood mould (label): top bar + two drops
    head = sill + h
    mb.box((x - w / 2 - 0.15, -0.09, head + 0.1), (x + w / 2 + 0.15, 0.0, head + 0.22), st)
    for sx in (-1, 1):
        xa, xb = sorted((x + sx * (w / 2 + 0.04), x + sx * (w / 2 + 0.15)))
        mb.box((xa, -0.09, head - 0.22), (xb, 0.0, head + 0.1), st)


def _bay_mesh(ns):
    if ns in _BAYS:
        return _BAYS[ns]
    H = _wall_top(ns)
    lv = _levels(ns)
    slab = C.box_minmax(f"Exterior_Bay_{ns}", (-BAY_W / 2, 0.0, -0.6), (BAY_W / 2, WALL_T, H), M.mat("limestone"))
    cutters = []
    for k in range(ns):
        sill, h = WIN[k]
        for xw in (-1.2, 1.2):
            cutters.append(C.box_minmax(f"cut{k}{xw}", (xw - WIN_W / 2, -0.2, lv[k] + sill), (xw + WIN_W / 2, WALL_T + 0.2, lv[k] + sill + h)))
    _difference(slab, cutters)
    _uvbox(slab, M.tex_size("limestone"))
    mb = MB()
    for k in range(ns):
        sill, h = WIN[k]
        for xw in (-1.2, 1.2):
            _window_parts(mb, xw, lv[k] + sill, h)
    parts = mb.obj(f"Exterior_Bay_{ns}_Windows")
    _uvbox(parts, M.tex_size("limestone"))
    ob = C.join([slab, parts], f"Exterior_Bay_{ns}")
    _BAYS[ns] = ob
    return ob


def _range_loops(mb, L, depth, ns, H, gap=0.0):
    """Plinth, string courses, cornice and parapet round a range (local coords, CCW). With `gap`
    the loops stop inside a central tower of half-width > gap (two open runs)."""
    if gap:
        runs = [[(-gap, depth), (-L / 2, depth), (-L / 2, 0.0), (-gap, 0.0)], [(gap, 0.0), (L / 2, 0.0), (L / 2, depth), (gap, depth)]]
        closed = False
    else:
        runs = [[(-L / 2, 0.0), (L / 2, 0.0), (L / 2, depth), (-L / 2, depth)]]
        closed = True
    sz = M.tex_size("limestone")
    lv = _levels(ns)
    ph = 0.85
    profs = [[(0.0, -0.6), (0.11, -0.6), (0.11, 0.55), (0.05, 0.66), (0.0, 0.66)]]
    for z in lv[1:-1]:
        profs.append([(0.0, z - 0.1), (0.05, z - 0.09), (0.09, z - 0.04), (0.09, z + 0.05), (0.07, z + 0.08), (0.0, z + 0.08)])
    profs.append([(0.0, H - 0.42), (0.04, H - 0.4), (0.06, H - 0.33), (0.17, H - 0.17), (0.2, H - 0.16), (0.2, H), (0.0, H)])
    profs.append([(0.0, H), (0.0, H + ph - 0.1), (0.05, H + ph - 0.1), (0.05, H + ph - 0.05), (-0.12, H + ph),
                  (-0.45, H + ph - 0.04), (-0.45, H + ph - 0.1), (-0.4, H + ph - 0.1), (-0.4, H)])
    for run in runs:
        for prof in profs:
            _hsweep(mb, run, prof, "limestone", closed, sz)


def _roof(mb, L_in, depth, H, pitch=50.0, eave_in=0.4):
    t = math.tan(math.radians(pitch))
    hl = depth / 2 - eave_in
    zr = H + 0.1 + hl * t
    n = int(math.ceil(hl / math.cos(math.radians(pitch)) / 0.34))
    lift = 0.032
    sp, cp = math.sin(math.radians(pitch)), math.cos(math.radians(pitch))
    x0, x1 = -L_in / 2, L_in / 2
    for side in (1, -1):
        def pt(s):
            y = eave_in + s * hl if side > 0 else depth - eave_in - s * hl
            return Vector((0.0, y, H + 0.1 + s * hl * t))
        nv = Vector((0, -sp, cp)) if side > 0 else Vector((0, sp, cp))
        for i in range(n):
            p0, p1 = pt(i / n), pt((i + 1) / n)
            p0l = p0 + nv * lift
            quads = [[(x0, p0.y, p0.z), (x1, p0.y, p0.z), (x1, p0l.y, p0l.z), (x0, p0l.y, p0l.z)],
                     [(x0, p0l.y, p0l.z), (x1, p0l.y, p0l.z), (x1, p1.y, p1.z), (x0, p1.y, p1.z)]]
            for q in quads:
                if side < 0:
                    q = q[::-1]
                mb.poly(q, "slate", [(c[0] / 2.0, c[2] / 2.0) for c in q])
    # lead ridge roll
    _tube(mb, [(x0, depth / 2, zr + 0.02), (x1, depth / 2, zr + 0.02)], [0.12, 0.12], 10, "lead", 1.0, cap_end=True, cap_start=True)
    return zr


def _gable_mesh(ns, depth, zr, name):
    """End wall + raised coped gable, outer face on x = 0 (wall x in [-T, 0]), y centred."""
    H = _wall_top(ns)
    T = WALL_T
    mb = MB()
    d2 = depth / 2
    outline = [(-d2 + T, -0.6), (d2 - T, -0.6), (d2 - T, H), (d2, H), (d2, H + 0.6), (0.0, zr + 0.5), (-d2, H + 0.6), (-d2, H), (-d2 + T, H)]
    sz = M.tex_size("limestone")
    outer = [mb.bm.verts.new((0.0, y, z)) for y, z in outline]
    inner = [mb.bm.verts.new((-T, y, z)) for y, z in outline]
    mb.face(outer, "limestone", [(v.co.y / sz, v.co.z / sz) for v in outer])
    mb.face(list(reversed(inner)), "limestone", [(v.co.y / sz, v.co.z / sz) for v in reversed(inner)])
    m = len(outline)
    for i in range(m):
        j = (i + 1) % m
        q = (outer[i], inner[i], inner[j], outer[j])
        mb.face(q, "limestone", [(v.co.x / sz + v.co.y / sz, v.co.z / sz) for v in q])
    # coping along the raked top, kneelers at the eaves, a finial at the apex
    for sgn in (-1, 1):
        a = Vector((0.0, sgn * (d2 + 0.06), H + 0.6))
        b = Vector((0.0, 0.0, zr + 0.5))
        dv = (b - a)
        up = Vector((0, -dv.z, dv.y)).normalized()
        if up.z < 0:
            up = -up
        _obox(mb, (a + b) / 2 + up * 0.09 + Vector((-T / 2, 0, 0)), (T / 2 + 0.07, 0, 0), dv / 2 + dv.normalized() * 0.12, up * 0.09,
              "limestone", sz)
        _obox(mb, (-T / 2, sgn * (d2 - 0.25), H + 0.55), (T / 2 + 0.07, 0, 0), (0, 0.33, 0), (0, 0, 0.3), "limestone", sz)
    # end-wall windows (inset dark panes with surrounds), one per storey, and a gable oculus
    lv = _levels(ns)
    for k in range(ns):
        sill, h = WIN[k]
        z0 = lv[k] + sill
        w = 1.1
        mb.poly([(0.012, -w / 2, z0), (0.012, w / 2, z0), (0.012, w / 2, z0 + h), (0.012, -w / 2, z0 + h)], "glass_dark")
        for (ya, yb, za, zb) in ((-w / 2 - 0.12, -w / 2, z0 - 0.05, z0 + h + 0.12), (w / 2, w / 2 + 0.12, z0 - 0.05, z0 + h + 0.12),
                                 (-w / 2, w / 2, z0 + h, z0 + h + 0.12), (-w / 2 - 0.2, w / 2 + 0.2, z0 - 0.14, z0 - 0.05)):
            mb.box((0.0, ya, za), (0.07, yb, zb), "limestone")
    zc = H + 1.6
    ring = 12
    rr = 0.55
    cen = mb.bm.verts.new((0.012, 0.0, zc))
    vs = [mb.bm.verts.new((0.012, rr * math.cos(math.tau * i / ring), zc + rr * math.sin(math.tau * i / ring))) for i in range(ring)]
    for i in range(ring):
        mb.face((cen, vs[i], vs[(i + 1) % ring]), "glass_dark")
    ob = mb.obj(name, smooth_angle=30)
    fin = C.lathe(name + "_Finial", [(0.3, 0.0), (0.3, 0.25), (0.22, 0.3), (0.2, 0.9), (0.26, 0.98), (0.0, 1.5)], 8,
                  M.mat("limestone"), center=(-T / 2, 0.0, zr + 0.62), smooth_angle=10)
    ob = C.join([ob, fin], name)
    _uvbox(ob, sz)
    return ob


def _chimney(name):
    mb = MB()
    mb.box((-0.5, -1.1, -2.2), (0.5, 1.1, 2.4), "limestone")
    mb.box((-0.62, -1.22, 2.4), (0.62, 1.22, 2.62), "limestone")
    mb.box((-0.56, -1.16, 1.75), (0.56, 1.16, 1.88), "limestone")
    ob = mb.obj(name)
    pots = []
    for y in (-0.7, 0.0, 0.7):
        pots.append(C.lathe(name + "_Pot", [(0.17, 0.0), (0.18, 0.05), (0.14, 0.12), (0.125, 0.48), (0.155, 0.53), (0.155, 0.58),
                                            (0.13, 0.6), (0.0, 0.6)], 12, M.mat("terracotta"), center=(0, y, 2.62)))
    ob = C.join([ob] + pots, name)
    _uvbox(ob, M.tex_size("limestone"))
    return ob


def _cupola(name):
    """Square clock stage + open octagonal belfry + verdigris copper dome (origin at its base)."""
    parts = []
    st = M.mat("limestone")
    cu = M.mat("copper_verdigris")
    mb = MB()
    mb.box((-1.7, -1.7, 0.0), (1.7, 1.7, 3.2), "limestone")
    mb.box((-1.85, -1.85, 3.2), (1.85, 1.85, 3.45), "limestone")
    mb.box((-1.82, -1.82, -0.1), (1.82, 1.82, 0.25), "limestone")
    for sgn in (-1, 1):
        # clock faces front and back
        cen = Vector((0.0, sgn * 1.712, 1.75))
        ring = 24
        vs = [mb.bm.verts.new(cen + Vector((0.95 * math.cos(math.tau * i / ring), 0, 0.95 * math.sin(math.tau * i / ring)))) for i in range(ring)]
        c0 = mb.bm.verts.new(cen)
        for i in range(ring):
            f = (c0, vs[(i + 1) % ring], vs[i]) if sgn > 0 else (c0, vs[i], vs[(i + 1) % ring])
            mb.face(f, "ivory_paint")
        for (a, L, wdt) in ((math.radians(60), 0.55, 0.05), (math.radians(-30), 0.78, 0.035)):
            dv = Vector((math.cos(a), 0, math.sin(a)))
            p0 = cen + Vector((0, sgn * 0.012, 0))
            p1 = p0 + dv * L
            nrm = Vector((-dv.z, 0, dv.x)) * wdt / 2
            q = [p0 - nrm, p1 - nrm * 0.4, p1 + nrm * 0.4, p0 + nrm]
            mb.poly(q[::-1] if sgn > 0 else q, "iron")
        _tube(mb, [cen + Vector((0, sgn * 0.005, 0)) + Vector((0.98 * math.cos(math.tau * i / 24), 0, 0.98 * math.sin(math.tau * i / 24)))
                   for i in range(25)], [0.04] * 25, 6, "gilt", 0.3, cap_end=False)
    parts.append(mb.obj(name + "_Stage", smooth_angle=40))
    # octagonal belfry: core + 8 columns + entablature
    parts.append(C.lathe(name + "_Core", [(0.0, 3.45), (1.05, 3.45), (1.05, 5.6), (0.0, 5.6)], 8, M.mat("glass_dark"), smooth_angle=10))
    parts.append(C.lathe(name + "_Plinth", [(0.0, 3.45), (1.45, 3.45), (1.45, 3.75), (1.38, 3.8), (0.0, 3.8)], 8, st, smooth_angle=10))
    for k in range(8):
        a = math.tau * (k + 0.5) / 8
        p = (1.28 * math.cos(a), 1.28 * math.sin(a), 0)
        parts.append(C.lathe(name + "_Col", [(0.13, 3.8), (0.13, 3.88), (0.1, 3.95), (0.085, 5.3), (0.12, 5.38), (0.14, 5.45), (0.0, 5.45)],
                             12, st, center=p))
    parts.append(C.lathe(name + "_Ent", [(0.0, 5.45), (1.42, 5.45), (1.42, 5.75), (1.55, 5.85), (1.55, 5.95), (0.0, 5.95)], 8, st, smooth_angle=10))
    prof = [(1.42, 5.95)]
    for i in range(1, 13):
        t = i / 12
        r = 1.42 * math.cos(t * math.pi / 2) ** 0.8
        prof.append((r * (1 + 0.12 * math.sin(t * math.pi)), 5.95 + 2.1 * math.sin(t * math.pi / 2) ** 1.1))
    prof[-1] = (0.08, prof[-1][1])
    parts.append(C.lathe(name + "_Dome", prof, 24, cu))
    zt = prof[-1][1]
    parts.append(C.lathe(name + "_Lantern", [(0.12, zt - 0.05), (0.22, zt + 0.05), (0.2, zt + 0.5), (0.26, zt + 0.55), (0.06, zt + 0.85),
                                             (0.08, zt + 1.0), (0.02, zt + 1.6), (0.0, zt + 1.62)], 12, cu))
    ob = C.join(parts, name)
    _uvbox(ob, M.tex_size("limestone"))
    return ob


def _gate_tower(name, depth):
    """Battlemented gate tower (local: centred at x = 0, front face y = -1.8, through the range)."""
    st = M.mat("limestone")
    Ht = 21.0
    hw = 5.2
    yf, yb = -1.8, depth + 1.8
    body = C.box_minmax(name + "_Body", (-hw, yf, -0.6), (hw, yb, Ht), st)
    cutters = []
    arch = [(1.9, -0.7)] + [(1.9 * math.cos(math.pi * i / 16), 4.0 + 1.9 * math.sin(math.pi * i / 16)) for i in range(17)] + [(-1.9, -0.7)]
    cutters.append(_prism_xz(name + "_GateCut", arch, yf - 0.5, yb + 0.5))
    lv = [0.0, 6.6, 11.2, 15.6]
    for k, z0 in enumerate(lv[1:]):
        h = 2.4 if k else 3.2
        w = 1.0 if k else 2.6
        for xw in ((-1.6, 1.6) if k else (0.0,)):
            outline = [(xw + w / 2, z0)] + [(xw + w / 2 * math.cos(math.pi * i / 10), z0 + h + w / 2 * math.sin(math.pi * i / 10)) for i in range(11)] + [(xw - w / 2, z0)]
            for yy in (yf, yb):
                cutters.append(_prism_xz(name + "_WinCut", outline, yy - 0.3, yy + 0.32) if yy == yf else _prism_xz(name + "_WinCut", outline, yy - 0.32, yy + 0.3))
    _difference(body, cutters)
    mb = MB()
    # glass at the back of the window recesses
    for k, z0 in enumerate(lv[1:]):
        h = 2.4 if k else 3.2
        w = 1.0 if k else 2.6
        for xw in ((-1.6, 1.6) if k else (0.0,)):
            outline = [(xw + w / 2, z0)] + [(xw + w / 2 * math.cos(math.pi * i / 10), z0 + h + w / 2 * math.sin(math.pi * i / 10)) for i in range(11)] + [(xw - w / 2, z0)]
            mb.poly([(x, yf + 0.3, z) for x, z in outline], "glass_dark")
            mb.poly([(x, yb - 0.3, z) for x, z in reversed(outline)], "glass_dark")
            if not k:
                for i in range(1, 4):
                    xx = xw - w / 2 + w * i / 4
                    mb.box((xx - 0.05, yf + 0.18, z0), (xx + 0.05, yf + 0.3, z0 + h + (w / 2) * math.sqrt(max(0.0, 1 - ((xx - xw) / (w / 2)) ** 2))), "limestone")
                mb.box((xw - w / 2, yf + 0.18, z0 + h * 0.55), (xw + w / 2, yf + 0.3, z0 + h * 0.55 + 0.1), "limestone")
    # loops: plinth, string courses, parapet with battlements
    loop = [(-hw, yf), (hw, yf), (hw, yb), (-hw, yb)]
    sz = M.tex_size("limestone")
    _hsweep(mb, loop, [(0.0, -0.6), (0.12, -0.6), (0.12, 0.6), (0.05, 0.72), (0.0, 0.72)], "limestone", True, sz)
    for z in (6.2, 10.8, 15.2):
        _hsweep(mb, loop, [(0.0, z - 0.12), (0.06, z - 0.1), (0.11, z - 0.04), (0.11, z + 0.06), (0.08, z + 0.1), (0.0, z + 0.1)], "limestone", True, sz)
    _hsweep(mb, loop, [(0.0, Ht - 0.45), (0.06, Ht - 0.42), (0.22, Ht - 0.2), (0.24, Ht - 0.2), (0.24, Ht), (0.0, Ht)], "limestone", True, sz)
    _hsweep(mb, loop, [(0.0, Ht), (0.0, Ht + 0.95), (0.04, Ht + 0.95), (0.04, Ht + 1.02), (-0.5, Ht + 1.02), (-0.5, Ht + 0.95),
                       (-0.46, Ht + 0.95), (-0.46, Ht)], "limestone", True, sz)
    # merlons
    for (ax, ay), (bx, by) in zip(loop, loop[1:] + loop[:1]):
        L = math.hypot(bx - ax, by - ay)
        n = int(L / 1.5)
        dx, dy = (bx - ax) / L, (by - ay) / L
        nx, ny = dy, -dx
        for i in range(1, n):
            t = (i * L / n)
            if t < 1.6 or t > L - 1.6:
                continue
            cx, cy = ax + dx * t, ay + dy * t
            p = [Vector((cx - dx * 0.38 + nx * 0.04, cy - dy * 0.38 + ny * 0.04)), Vector((cx + dx * 0.38 + nx * 0.04, cy + dy * 0.38 + ny * 0.04)),
                 Vector((cx + dx * 0.38 - nx * 0.5, cy + dy * 0.38 - ny * 0.5)), Vector((cx - dx * 0.38 - nx * 0.5, cy - dy * 0.38 - ny * 0.5))]
            xs, ys = [q.x for q in p], [q.y for q in p]
            mb.box((min(xs), min(ys), Ht + 1.02), (max(xs), max(ys), Ht + 1.75), "limestone")
    parts = [body, mb.obj(name + "_Detail", smooth_angle=40)]
    # octagonal corner turrets
    for sx in (-1, 1):
        for yy in (yf, yb):
            cx, cy = sx * hw, yy
            parts.append(C.lathe(name + "_Turret", [(1.05, -0.6), (1.05, 0.7), (0.92, 0.85), (0.92, Ht + 1.0), (1.12, Ht + 1.25), (1.12, Ht + 2.0),
                                                    (0.95, Ht + 2.1), (0.95, Ht + 2.6), (0.0, Ht + 2.6)], 8, st, center=(cx, cy, 0), smooth_angle=10,
                                 rot=C.rotz(22.5)))
            for k in range(8):
                a = math.radians(22.5 + 45 * k + 22.5)
                parts.append(C.box(name + "_TMerlon", (0.42, 0.3, 0.6), (cx + 0.98 * math.cos(a), cy + 0.98 * math.sin(a), Ht + 2.9), st,
                                   rot=C.rotz(math.degrees(a) + 90)))
    ob = C.join(parts, name)
    _uvbox(ob, sz)
    return ob


def _prism_xz(name, outline, y0, y1):
    """Extrudes an (x, z) outline along Y from y0 to y1 (a boolean cutter)."""
    bm = bmesh.new()
    a = [bm.verts.new((x, y0, z)) for x, z in outline]
    b = [bm.verts.new((x, y1, z)) for x, z in outline]
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return C.mesh_from_bmesh(name, bm)


RANGES = [
    # name, web front-centre (x, z), front faces (dx, dz), bays, storeys, depth, extras
    dict(name="South", c=(0.0, QUAD["south"]), face=(0, -1), nb=25, ns=3, depth=12.0, tower=True),
    dict(name="North", c=(0.0, QUAD["north"]), face=(0, 1), nb=23, ns=3, depth=12.0, cupola=True),
    dict(name="West", c=(QUAD["west"], 8.0), face=(1, 0), nb=23, ns=2, depth=11.0),
    dict(name="East", c=(QUAD["east"], 8.0), face=(-1, 0), nb=23, ns=3, depth=12.0),
]


def build_ranges():
    c = col("Exterior_Ranges")
    out = []
    chim = _chimney("Exterior_Chimney")
    gables = {}
    for spec in RANGES:
        ns, nb, depth = spec["ns"], spec["nb"], spec["depth"]
        bay = _bay_mesh(ns)
        L = nb * BAY_W
        H = _wall_top(ns)
        rot = P.facing(*spec["face"])
        root = C.empty(f"Exterior_Range_{spec['name']}", C.bl(spec["c"][0], GROUND_Z, spec["c"][1]), rot, col=c, size=2.0)
        out.append(root)

        def add(ob):
            ob.parent = root
            return ob
        for i in range(nb):
            x = -L / 2 + BAY_W * (i + 0.5)
            if spec.get("tower") and abs(x) < BAY_W:
                continue
            add(_use(bay, f"Exterior_Range_{spec['name']}_BayF_{i + 1:02d}", (x, 0, 0), 0.0, collection=c))
            add(_use(bay, f"Exterior_Range_{spec['name']}_BayB_{i + 1:02d}", (x, depth, 0), math.pi, collection=c))
        mb = MB()
        _range_loops(mb, L, depth, ns, H, gap=5.0 if spec.get("tower") else 0.0)
        zr = _roof(mb, L - 2 * WALL_T, depth, H)
        body = mb.obj(f"Exterior_Range_{spec['name']}_Body", c, smooth_angle=40)
        add(body)
        gkey = (ns, depth)
        if gkey not in gables:
            gables[gkey] = _gable_mesh(ns, depth, zr, f"Exterior_Gable_{ns}_{int(depth)}")
        gable = gables[gkey]
        add(_use(gable, f"Exterior_Range_{spec['name']}_GableE", (L / 2, depth / 2, 0), 0.0, collection=c))
        add(_use(gable, f"Exterior_Range_{spec['name']}_GableW", (-L / 2, depth / 2, 0), math.pi, collection=c))
        for k, x in enumerate([-L / 2 + BAY_W * (j + 0.5) for j in range(1, nb - 1, 4)]):
            if spec.get("tower") and abs(x) < 7:
                continue
            if spec.get("cupola") and abs(x) < 6:
                continue
            add(_use(chim, f"Exterior_Range_{spec['name']}_Chimney_{k + 1:02d}", (x, depth / 2, zr), 0.0, collection=c))
        if spec.get("tower"):
            t = _gate_tower(f"Exterior_Range_{spec['name']}_GateTower", depth)
            C.move_to(t, c)
            add(t)
        if spec.get("cupola"):
            cp = _cupola(f"Exterior_Range_{spec['name']}_Cupola")
            C.move_to(cp, c)
            cp.location = (0.0, depth / 2, zr - 1.2)
            add(cp)
    bpy.context.view_layer.update()
    return out, []


# ---------------------------------------------------------------------------
# Skyline: distant buildings, a dome, spires, and a belt of trees
# ---------------------------------------------------------------------------

def build_skyline():
    c = col("Exterior_Skyline")
    rng = random.Random(23)
    mb = MB()
    centre = Vector((4.0, -2.0))
    placed = []
    blocks = 0
    for k in range(36):
        a = math.tau * k / 36 + rng.uniform(-0.04, 0.04)
        dist = rng.uniform(205, 290)
        p = centre + Vector((math.cos(a), math.sin(a))) * dist
        w = rng.uniform(26, 48)
        d = rng.uniform(12, 17)
        h = rng.choice([9.5, 12.5, 12.5, 15.5, 18.5])
        # front faces the library
        fwd = (centre - p).normalized()
        side = Vector((fwd.y, -fwd.x))
        corners = [p - side * w / 2, p + side * w / 2, p + side * w / 2 - fwd * d, p - side * w / 2 - fwd * d]
        placed.append((p, w))
        blocks += 1
        nf0 = len(mb.bm.faces)
        zb = GROUND_Z - 0.5
        # walls (4 quads + top hidden under roof)
        for i in range(4):
            a0, a1 = corners[i], corners[(i + 1) % 4]
            mb.poly([(a1.x, a1.y, zb), (a0.x, a0.y, zb), (a0.x, a0.y, h), (a1.x, a1.y, h)], "stone_far")
        # pitched roof along the width
        rise = d / 2 * 1.1
        m0 = (corners[0] + corners[3]) / 2
        m1 = (corners[1] + corners[2]) / 2
        r0 = (m0.x, m0.y, h + rise)
        r1 = (m1.x, m1.y, h + rise)
        cs = [(cc.x, cc.y, h) for cc in corners]
        mb.poly([cs[0], cs[1], r1, r0][::-1], "slate_far")
        mb.poly([cs[2], cs[3], r0, r1][::-1], "slate_far")
        mb.poly([cs[1], cs[2], r1][::-1], "stone_far")
        mb.poly([cs[3], cs[0], r0][::-1], "stone_far")
        # window rows on the face toward the library
        nwin = int(w / 2.6)
        rows = int((h - 1.0) / 3.2)
        for rr_ in range(rows):
            z0 = 1.4 + rr_ * 3.2
            for i in range(nwin):
                t0 = (i + 0.3) / nwin
                t1 = (i + 0.7) / nwin
                q0 = corners[0].lerp(corners[1], t0) + fwd * 0.03
                q1 = corners[0].lerp(corners[1], t1) + fwd * 0.03
                mb.poly([(q0.x, q0.y, z0), (q1.x, q1.y, z0), (q1.x, q1.y, z0 + 1.8), (q0.x, q0.y, z0 + 1.8)][::-1], "glass_far")
        # a chimney now and then
        mb.bm.faces.ensure_lookup_table()
        bc = Vector(((p - fwd * d / 2).x, (p - fwd * d / 2).y, h / 2))
        for fi in range(nf0, len(mb.bm.faces)):
            f = mb.bm.faces[fi]
            f.normal_update()
            if f.normal.dot(f.calc_center_median() - bc) < 0:
                f.normal_flip()
        if k % 3 == 0:
            q = (m0 + m1) / 2
            mb.box((q.x - 0.5, q.y - 0.9, h + rise - 1.0), (q.x + 0.5, q.y + 0.9, h + rise + 2.0), "stone_far")
    sky = mb.obj("Exterior_Skyline_Blocks", c)
    # landmark towers: a domed rotunda, two spires, a pinnacled tower
    parts = []
    marks = [("dome", 150.0, 170.0), ("spire", -190.0, -80.0), ("spire", 200.0, -150.0), ("tower", -140.0, 200.0), ("tower", 210.0, 70.0),
             ("spire", -40.0, -240.0)]
    sf, sl = M.mat("stone_far"), M.mat("slate_far")
    for kind, x, z in marks:
        bx, by = x, -z
        if kind == "dome":
            parts.append(C.lathe("sk_drum", [(0.0, -0.5), (13.0, -0.5), (13.0, 16.0), (11.0, 16.5), (11.0, 22.0), (0.0, 22.0)], 24, sf, center=(bx, by, 0)))
            prof = [(10.6, 22.0)] + [(10.6 * math.cos(t * math.pi / 2), 22.0 + 9.0 * math.sin(t * math.pi / 2)) for t in (i / 10 for i in range(1, 11))]
            prof[-1] = (0.0, prof[-1][1])
            parts.append(C.lathe("sk_dome", prof, 24, sl, center=(bx, by, 0)))
            parts.append(C.lathe("sk_lantern", [(1.6, 30.5), (1.6, 34.0), (0.0, 37.0)], 8, sf, center=(bx, by, 0)))
        elif kind == "spire":
            parts.append(C.box("sk_tower", (7, 7, 26), (bx, by, 12.7), sf))
            parts.append(C.lathe("sk_spire", [(4.6, 25.7), (0.0, 48.0)], 8, sl, center=(bx, by, 0), rot=C.rotz(22.5)))
        else:
            parts.append(C.box("sk_tower", (8, 8, 30), (bx, by, 14.7), sf))
            for sx in (-1, 1):
                for sy in (-1, 1):
                    parts.append(C.lathe("sk_pin", [(0.7, 29.7), (0.0, 35.0)], 8, sf, center=(bx + sx * 3.6, by + sy * 3.6, 0)))
    marks_ob = C.join(parts, "Exterior_Skyline_Landmarks")
    C.move_to(marks_ob, c)
    # belt of distant trees between the blocks
    far = [_tree_far(5, False), _tree_far(9, True)]
    out = [sky, marks_ob]
    for k in range(60):
        a = math.tau * k / 60 + rng.uniform(-0.05, 0.05)
        dist = rng.uniform(118, 145) if k % 2 else rng.uniform(175, 200)
        p = centre + Vector((math.cos(a), math.sin(a))) * dist
        s = rng.uniform(0.85, 1.25)
        out.append(_use(far[k % 2], f"Exterior_Tree_Far_{k + 1:02d}", (p.x, p.y, GROUND_Z), rng.uniform(0, math.tau), (s, s, s), collection=c))
    return out, [], blocks


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def build_exterior():
    """Builds the whole exterior in place. Returns the list of created top-level objects."""
    out = []
    log("ground")
    out += build_ground()
    log("paths")
    out += build_paths()
    log("podium")
    out += build_podium()
    log("library trim")
    out += build_library_trim()
    if not HALL_ONLY:  # the forecourt fronts the entrance lobby's main door
        log("forecourt")
        out += build_forecourt()
    log("trees")
    trees, tree_src = build_trees()
    out += trees
    log("ranges")
    ranges, range_src = build_ranges()
    out += ranges
    log("skyline")
    sky, far_src, _ = build_skyline()
    out += sky
    out += build_woods()
    build_exterior.sources = tree_src + range_src + far_src
    log("exterior done")
    return out


build_exterior.sources = []


def report_tris():
    """Unique (stored) and rendered (instanced) triangles of everything under EXTERIOR."""
    root = bpy.data.collections.get("EXTERIOR")
    if root is None:
        return {}
    seen, unique, rendered = set(), 0, 0
    per = {}
    for ob in root.all_objects:
        if ob.type != "MESH":
            continue
        t = C.tris(ob)
        if ob.data.name not in seen:
            seen.add(ob.data.name)
            unique += t
        if not ob.hide_render:
            rendered += t
        top = ob.users_collection[0].name
        per.setdefault(top, [0, 0])
        per[top][1] += t if not ob.hide_render else 0
    for k, (u, r) in sorted(per.items()):
        print(f"  {k:32s} rendered {r:8d}")
    print(f"EXTERIOR tris: unique {unique}, rendered (with instances) {rendered}")
    return dict(unique=unique, rendered=rendered)


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _library(windows=True):
    """The real library shell (arch_shell walls + arch_windows), floors, roof lids, stand-ins."""
    import arch_shell
    import arch_windows
    import scene_milestone as SM
    for w in P.WALLS:
        try:
            arch_shell.build_wall(w)
        except Exception as e:  # noqa: BLE001
            log(f"  wall {w.id} failed: {e}")
    if windows:
        cache = {}
        for w in P.WALLS:
            for o in w.openings:
                try:
                    ob, h = arch_windows.build_for_opening(o, w, cache=cache)
                except Exception as e:  # noqa: BLE001
                    log(f"  opening {o.id} failed: {e}")
                    continue
                if ob is not None:
                    arch_windows.place_in_wall(ob, w, o, h)
    SM.build_floors()
    try:
        import scene_library
        scene_library.build_roofs()
    except Exception as e:  # noqa: BLE001
        log(f"  roofs via scene_library failed ({e}); using scene_milestone")
        SM.build_roofs()
    if not HALL_ONLY:
        SM.build_rotunda_standin()
    SM.build_lift_standin()


SHOTS = {
    # name: (web loc, web target, lens)
    "aerial": ((95.0, 70.0, 120.0), (2.0, 0.0, 8.0), 24),
    "aerial_nw": ((-105.0, 60.0, -95.0), (4.0, 0.0, 6.0), 24),
    "quiet_west": ((-15.6, 1.6, 14.4), (-40.0, 3.0, 14.0), 22),
    "lounge_north": ((-19.3, 1.6, 0.8), (-19.3, 3.0, -30.0), 22),
    "lobby_south": ((0.0, 1.62, 14.5), (0.0, 3.0, 40.0), 20),
    "group_east": ((10.5, 1.6, 12.2), (40.0, 3.0, 12.0), 22),
    "computers_north": ((-6.8, 1.6, -11.6), (-6.8, 3.0, -40.0), 22),
    "hall_north": ((0.0, 6.3, 5.5), (0.0, 9.6, -14.0), 22),
    "forecourt": ((8.5, 1.7, 33.0), (-0.5, 2.2, 21.0), 26),
    "avenue": ((0.0, 1.7, 24.5), (0.0, 7.0, 80.0), 30),
    "range_close": ((-48.0, 1.8, 14.0), (-66.0, 7.5, 4.0), 30),
    "trim_close": ((-26.0, 1.8, 26.0), (-18.8, 3.4, 20.6), 32),
    "junction": ((-1.5, 1.7, 27.5), (-6.3, 4.6, 20.8), 30),
    "hall_corner": ((-25.0, 1.7, -17.5), (-14.8, 6.0, -10.3), 28),
    "trees_close": ((-27.0, 1.7, 0.0), (-41.0, 7.5, 9.0), 28),
}


def preview(out_dir):
    scene = bpy.context.scene
    want = os.environ.get("EXT_SHOTS", "")
    shots = [s for s in want.split(",") if s] or list(SHOTS)
    lib = os.environ.get("EXT_NO_LIBRARY", "") == ""
    if lib:
        log("library shell")
        _library(windows=True)
    build_exterior()
    report_tris()
    for n in ("Exterior_Tree_Oak", "Exterior_Tree_Lime", "Exterior_Tree_Beech", "Exterior_Tree_Cedar", "Exterior_Tree_Far_Round",
              "Exterior_Tree_Far_Tall", "Exterior_Bay_2", "Exterior_Bay_3", "Exterior_LampPost_01", "Exterior_Lantern_Pedestal",
              "Exterior_Bench_01", "Exterior_Chimney", "Exterior_Gable_3_12", "Exterior_Range_South_GateTower",
              "Exterior_Range_North_Cupola", "Exterior_Library_Trim", "Exterior_Library_Pilasters", "Exterior_Skyline_Blocks",
              "Exterior_Skyline_Landmarks", "Exterior_Skyline_Woods", "Exterior_Ground_Lawn", "Exterior_Path_Gravel",
              "Exterior_Path_Paving", "Exterior_Path_Kerb"):
        me = bpy.data.meshes.get(n)
        if me is not None:
            print(f"  ASSET {n}: {sum(len(p_.vertices) - 2 for p_ in me.polygons)} tris")
    samples = int(os.environ.get("EXT_SAMPLES", "32"))
    size = int(os.environ.get("EXT_SIZE", "960"))
    R.engine(scene, "CYCLES", samples, (size, size * 9 // 16 if size > 700 else size))
    if os.environ.get("EXT_DEVICE", "") == "CPU":   # the GPU is shared with other renders
        scene.cycles.device = "CPU"
    scene.view_settings.exposure = float(os.environ.get("EXT_EXPOSURE", "-1.0"))
    import scene_milestone as SM
    R.sun("Sun", direction_web=SM.SUN_DIR, strength=float(os.environ.get("EXT_SUN", "35")), color=(1.0, 0.9, 0.76), angle_deg=1.0)
    R.sky_world(scene, strength=float(os.environ.get("EXT_SKY", "2.5")), tint=(0.55, 0.7, 0.95))
    scene.cycles.max_bounces = 4
    cam = R.camera(lens=24)
    cam.data.clip_end = 2500
    for name in shots:
        if name == "species":
            continue
        loc, at, lens = SHOTS[name]
        cam.data.lens = lens
        R.look(cam, C.bl(*loc), C.bl(*at))
        log(f"render {name}")
        R.render(os.path.join(out_dir, f"{name}.png"))
    if "species" in shots or not want:
        _species_shot(out_dir)


def _species_shot(out_dir):
    """The four species side by side on an open lawn (away from everything)."""
    c = col("Exterior_SpeciesLineup")
    base = Vector((0.0, -3000.0))
    for i, sp in enumerate(("oak", "lime", "beech", "cedar")):
        ob = bpy.data.objects.new(f"Lineup_{sp}", _TREE_MESHES[sp])
        C.link(ob, c)
        ob.location = (base.x - 30 + 20 * i, base.y, GROUND_Z)
    lawn = C.box_minmax("Lineup_Lawn", (base.x - 200, base.y - 200, GROUND_Z - 0.1), (base.x + 200, base.y + 200, GROUND_Z), M.mat("grass"), col=c)
    _uvbox(lawn, M.tex_size("grass"))
    cam = R.camera(lens=30)
    R.look(cam, (base.x, base.y + 72, 5.0), (base.x, base.y, 8.5))
    log("render species")
    R.render(os.path.join(out_dir, "species.png"))
