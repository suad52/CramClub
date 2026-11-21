"""
Wayfinding signage, plants, the floor globe and small storytelling props for the OVR library.

KIND_BUILDERS (plan kinds; builder(item) -> ONE joined multi-material mesh at the origin, floor at
z = 0, front -Y, filling plan.KINDS):
  plant_large  0.7 x 0.7 x 1.6   three variants by seed: kentia palm in a brass jardiniere, fiddle-leaf
                                 fig in a glazed ceramic planter, rubber plant in a terracotta pot
  plant_small  0.45 x 0.45 x 0.9 snake plant in a cream glazed pot / young fig in terracotta
  globe_floor  0.8 x 0.8 x 1.25  library globe: turned walnut stand, horizon band, brass meridian ring
                                 and a procedurally drawn antique world map (runtime image, packed)

build_signage(): the whole wayfinding system, built IN PLACE from plan data (web coordinates via
lib_core.place) in one design: dark green "signage" boards in wrapped brass frames with gilt
"signage_text" lettering (Baskerville) and pictograms; lit EXIT boxes (exit_green / exit_white).
SIGNS lists every sign for the web: id, kind, text, x, y, z (web, the sign's back-centre or, for
hanging signs, the board centre), rot (web, the direction its front faces), w, h.

PROP_BUILDERS: wall clock, framed antique maps (2 sizes), book stacks (2-6 books), archival
boxes, a reading stand with an open book. builder(seed=0) -> one root object at the origin, front
-Y; wall props have their back on y = 0 and their bottom edge at z = 0.

Run the previews:
  Blender -b --factory-startup --python-exit-code 1 --python run_asset.py -- --module props_signage --out DIR
  (--func preview_assets | preview_signs | preview_inplace for one part)
"""

from __future__ import annotations

import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

import lib_core as C
import lib_materials as M
import plan as P

HALF_PI = math.pi / 2

# ---------------------------------------------------------------------------
# Palette additions (registered at import; reported to the art director)
# ---------------------------------------------------------------------------

PALETTE_ADDITIONS = {
    "foliage_fig": dict(base="#2b5121", rough=0.34, double_sided=True, coat=0.35, coat_rough=0.25),
    "foliage_palm": dict(base="#476f2f", rough=0.5, double_sided=True, sheen=0.3, sheen_tint="#cfe0b0", sheen_rough=0.5),
    "foliage_rubber": dict(base="#203823", rough=0.3, double_sided=True, coat=0.35, coat_rough=0.18),
    "foliage_snake": dict(base="#365a2b", rough=0.38, double_sided=True, coat=0.3, coat_rough=0.2),
    "foliage_sheath": dict(base="#8e4a3a", rough=0.35, double_sided=True),
    "leaf_vein": dict(base="#7f955c", rough=0.5, double_sided=True),
    "page_text": dict(base="#5e564c", rough=0.8),
    "leaf_edge": dict(base="#c6c27a", rough=0.45, double_sided=True),
    "bark_plant": dict(base="#6b5b49", rough=0.85),
    "stem_green": dict(base="#5d6c33", rough=0.6),
    "soil": dict(base="#2a1c13", rough=0.97),
    "ceramic_glazed": dict(base="#1d4646", rough=0.1, coat=1.0, coat_rough=0.04),
    "ceramic_cream": dict(base="#e4dbc7", rough=0.14, coat=1.0, coat_rough=0.05),
    "globe_map": dict(base="#d8c9a0", rough=0.4, coat=0.5, coat_rough=0.12),   # + runtime map image
    "map_print": dict(base="#d8c9a0", rough=0.82),                              # + runtime map image
    "clock_dial": dict(base="#efe6cf", rough=0.55),
    "archive_board": dict(base="#59675b", rough=0.86),
}
for _k, _v in PALETTE_ADDITIONS.items():
    M.PALETTE.setdefault(_k, _v)

mat = M.mat
tex = M.tex_size

FONTS = {
    "serif": ["/System/Library/Fonts/Supplemental/Baskerville.ttc", "/System/Library/Fonts/Supplemental/Georgia.ttf"],
    "sans": ["/System/Library/Fonts/Supplemental/Arial Bold.ttf", "/System/Library/Fonts/Supplemental/GillSans.ttc"],
}

# ---------------------------------------------------------------------------
# Generic helpers
# ---------------------------------------------------------------------------


class MB:
    """Accumulates faces for ONE multi-material mesh (faces carry palette keys)."""

    def __init__(self):
        self.bm = bmesh.new()
        self.keys = []
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def mi(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def v(self, p):
        return self.bm.verts.new(p)

    def face(self, vs, key, uvs=None, smooth=True):
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        f.material_index = self.mi(key)
        f.smooth = smooth
        if uvs:
            for lp, uv in zip(f.loops, uvs):
                lp[self.uv].uv = uv
        return f

    def build(self, name, smooth_angle=50.0, col=None):
        me = bpy.data.meshes.new(name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        ob = bpy.data.objects.new(name, me)
        C.link(ob, col)
        for k in self.keys:
            me.materials.append(mat(k))
        if smooth_angle:
            try:
                me.set_sharp_from_angle(angle=math.radians(smooth_angle))
            except AttributeError:
                pass
        return ob


def _smooth(u):
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def _interp(tab, t):
    for (t0, w0), (t1, w1) in zip(tab, tab[1:]):
        if t <= t1:
            return w0 + (w1 - w0) * _smooth((t - t0) / max(1e-9, t1 - t0))
    return tab[-1][1]


def _frame(d, up=(0, 0, 1)):
    """Orthonormal (side, forward, normal) for a part pointing along d, normal toward `up`."""
    d = Vector(d).normalized()
    up = Vector(up)
    n = up - d * up.dot(d)
    if n.length < 1e-5:
        n = Vector((1, 0, 0)) - d * d.x
    n.normalize()
    return d.cross(n), d, n


def _uv_turned(ob, size):
    """Turned wood: grain (texture U) along Z, V around."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            a = math.atan2(co.y, co.x)
            uv[li].uv = (co.z / size, a * 0.03 / size)
    return ob


def _uv_ring(ob, size):
    """Bent/segmented ring: grain around the ring."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            a = math.atan2(co.y, co.x)
            r = math.hypot(co.x, co.y)
            uv[li].uv = (a * 0.34 / size, (r + co.z) / size)
    return ob


def _uv(ob, key, grain=None):
    if grain == "turned":
        return _uv_turned(ob, tex(key))
    return C.uv_box(ob, tex(key), grain)


def _lathe(name, prof, key, seg=32, center=(0, 0, 0), caps=(True, True), smooth=50.0, grain="turned"):
    ob = C.lathe(name, prof, seg, mat(key), (0, 0, 0), cap_bottom=caps[0], cap_top=caps[1], smooth_angle=smooth)
    _uv(ob, key, grain)
    if Vector(center).length > 0:
        C.transform_mesh(ob, Matrix.Translation(center))
    return ob


def _bx(name, lo, hi, key, bev=0.002, seg=2, grain=None):
    ob = C.box_minmax(name, lo, hi, mat(key), bevel_w=bev, segments=seg)
    _uv(ob, key, grain)
    return ob


def _tube(mb, pts, radii, key, sides=6, cap0=False, cap1=True, uv_size=0.5):
    """A tapered tube along a polyline (stems, petioles, rods) into an MB."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rings = []
    ref = None
    length = 0.0
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        if ref is None:
            ref = Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0))
        nn = (ref - t * ref.dot(t))
        if nn.length < 1e-6:
            nn = Vector((1, 0, 0)) - t * t.x
        nn.normalize()
        ref = nn
        bb = t.cross(nn)
        if i:
            length += (p - pts[i - 1]).length
        ring = []
        for j in range(sides):
            a = math.tau * j / sides
            ring.append((mb.v(p + (nn * math.cos(a) + bb * math.sin(a)) * radii[i]), length))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            k = (j + 1) % sides
            mb.face((a[j][0], a[k][0], b[k][0], b[j][0]), key,
                    [(a[j][1] / uv_size, j / sides), (a[k][1] / uv_size, (j + 1) / sides),
                     (b[k][1] / uv_size, (j + 1) / sides), (b[j][1] / uv_size, j / sides)])
    if cap1:
        mb.face([v for v, _ in rings[-1]], key, smooth=False)
    if cap0:
        mb.face([v for v, _ in reversed(rings[0])], key, smooth=False)


def _join(parts, name):
    ob = C.join([p for p in parts if p is not None], name)
    return ob


def _total_tris(ob):
    n = C.tris(ob) if ob.type == "MESH" else 0
    for ch in ob.children:
        n += _total_tris(ch)
    return n


# ---------------------------------------------------------------------------
# Leaves and plants
# ---------------------------------------------------------------------------

SHAPES = {
    # (t along the leaf, half-width fraction): real outlines, not cards
    "fig": [(0, 0.10), (0.08, 0.34), (0.22, 0.50), (0.36, 0.48), (0.52, 0.70), (0.70, 0.88), (0.84, 0.84),
            (0.93, 0.6), (0.985, 0.22), (1.0, 0.0)],
    "rubber": [(0, 0.10), (0.1, 0.5), (0.3, 0.86), (0.5, 1.0), (0.7, 0.9), (0.86, 0.55), (0.95, 0.2), (1.0, 0.0)],
    "pinna": [(0, 0.35), (0.08, 0.85), (0.25, 1.0), (0.55, 0.8), (0.8, 0.42), (1.0, 0.0)],
    "sword": [(0, 0.62), (0.15, 0.9), (0.5, 1.0), (0.78, 0.8), (0.92, 0.42), (1.0, 0.0)],
}


def leaf(mb, base, d, up, length, width, shape, key, rows=7, cols=5, fold=0.15, droop=0.5, wave=0.0,
         twist=0.0, vein=None, vein_w=0.004, cup=1.0):
    """One leaf blade: a real outline (SHAPES), V-folded or cupped across the midrib, bending down
    (`droop`, radians over the length), wavy margins, optional twist. Normal faces `up`.
    `cup` shapes the cross-section: 1 = a V fold at the midrib, 2 = a rounded dome/dish."""
    side, fwd, nrm = _frame(d, up)
    base = Vector(base)
    tab = SHAPES[shape]
    ts = [0.5 - 0.5 * math.cos(math.pi * i / (rows - 1)) for i in range(rows)]
    cl = []
    y = z = 0.0
    for i, t in enumerate(ts):
        if i:
            dt = t - ts[i - 1]
            am = droop * (t + ts[i - 1]) / 2
            y += length * dt * math.cos(am)
            z -= length * dt * math.sin(am)
        cl.append((y, z, droop * t))
    half = (cols - 1) // 2

    def world(x, ly, lz):
        return base + side * x + fwd * ly + nrm * lz

    grid = []
    for i, t in enumerate(ts[:-1]):
        y, z, a = cl[i]
        hw = width / 2 * _interp(tab, t)
        tw = twist * t
        row = []
        for j in range(cols):
            s = (j - half) / half
            x = s * hw
            lift = fold * abs(s) ** cup * hw + wave * math.sin(t * 9.0 + s * 1.3) * abs(s) * hw
            lx = x * math.cos(tw) - lift * math.sin(tw)
            lift2 = x * math.sin(tw) + lift * math.cos(tw)
            row.append(mb.v(world(lx, y + lift2 * math.sin(a), z + lift2 * math.cos(a))))
        grid.append(row)
    ty, tz, _ = cl[-1]
    tip = mb.v(world(0, ty, tz))
    for i in range(len(grid) - 1):
        for j in range(cols - 1):
            mb.face((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]), key,
                    [(j / (cols - 1), ts[i]), ((j + 1) / (cols - 1), ts[i]), ((j + 1) / (cols - 1), ts[i + 1]),
                     (j / (cols - 1), ts[i + 1])])
    last = grid[-1]
    for j in range(cols - 1):
        mb.face((last[j], last[j + 1], tip), key, [(j / (cols - 1), ts[-2]), ((j + 1) / (cols - 1), ts[-2]), (0.5, 1.0)])
    if vein:
        vr = []
        for i, t in enumerate(ts[:-1]):
            y, z, a = cl[i]
            w = vein_w * (1.0 - 0.75 * t)
            off = 0.0009
            row = (mb.v(world(-w, y + off * math.sin(a), z + off * math.cos(a))),
                   mb.v(world(w, y + off * math.sin(a), z + off * math.cos(a))))
            vr.append(row)
        for i in range(len(vr) - 2):
            mb.face((vr[i][0], vr[i][1], vr[i + 1][1], vr[i + 1][0]), vein)
        tipv = mb.v(world(0, cl[-2][0] + (cl[-1][0] - cl[-2][0]) * 0.6, cl[-2][1] + (cl[-1][1] - cl[-2][1]) * 0.6 + 0.0009))
        mb.face((vr[-2][0], vr[-2][1], tipv), vein)
    return world(0, cl[0][0], cl[0][1])


def _fit_radius(mb, rmax, zmax, z0):
    """Scales foliage verts about the vertical axis so the canopy fills (not exceeds) the square
    footprint of half-size `rmax` (the plan.KINDS w x d)."""
    vs = mb.bm.verts
    r = max((max(abs(v.co.x), abs(v.co.y)) for v in vs), default=0.0)
    zt = max((v.co.z for v in vs), default=0.0)
    sr = min(1.0, rmax / r) if r > 1e-6 else 1.0
    sz = min(1.0, (zmax - z0) / (zt - z0)) if zt > z0 else 1.0
    for v in vs:
        v.co.x *= sr
        v.co.y *= sr
        if v.co.z > z0:
            v.co.z = z0 + (v.co.z - z0) * sz


# Planters: lathe profiles (r, z), bottom to top, ending on the inner wall at soil level.
POT_BRASS = [(0.128, 0.0), (0.150, 0.0), (0.160, 0.006), (0.162, 0.020), (0.154, 0.028), (0.140, 0.036),
             (0.133, 0.050), (0.138, 0.058), (0.152, 0.066), (0.176, 0.082), (0.204, 0.115), (0.226, 0.170),
             (0.236, 0.235), (0.235, 0.290), (0.228, 0.338), (0.219, 0.366), (0.218, 0.376), (0.226, 0.384),
             (0.238, 0.392), (0.249, 0.402), (0.252, 0.412), (0.249, 0.421), (0.240, 0.426), (0.229, 0.424),
             (0.222, 0.414), (0.219, 0.398), (0.214, 0.37)]
POT_GLAZED = [(0.160, 0.0), (0.172, 0.0), (0.180, 0.006), (0.183, 0.020), (0.178, 0.032), (0.176, 0.044),
              (0.182, 0.052), (0.186, 0.064), (0.184, 0.074), (0.186, 0.10), (0.196, 0.18), (0.206, 0.27),
              (0.214, 0.35), (0.218, 0.385), (0.224, 0.392), (0.227, 0.402), (0.224, 0.412), (0.221, 0.418),
              (0.224, 0.44), (0.230, 0.452), (0.234, 0.462), (0.232, 0.471), (0.225, 0.475), (0.214, 0.473),
              (0.209, 0.462), (0.206, 0.44)]
POT_TERRA = [(0.138, 0.014), (0.152, 0.014), (0.158, 0.022), (0.188, 0.288), (0.191, 0.298), (0.212, 0.300),
             (0.220, 0.307), (0.223, 0.36), (0.222, 0.384), (0.216, 0.392), (0.205, 0.391), (0.199, 0.383),
             (0.197, 0.36)]
SAUCER = [(0.150, 0.0), (0.200, 0.0), (0.212, 0.004), (0.216, 0.030), (0.209, 0.033), (0.203, 0.016),
          (0.196, 0.013), (0.150, 0.013)]
POT_CREAM_S = [(0.110, 0.0), (0.122, 0.0), (0.130, 0.006), (0.132, 0.018), (0.128, 0.026), (0.134, 0.04),
               (0.142, 0.12), (0.150, 0.21), (0.152, 0.226), (0.158, 0.236), (0.160, 0.246), (0.156, 0.253),
               (0.147, 0.252), (0.143, 0.24), (0.141, 0.22)]
POT_TERRA_S = [(0.095, 0.010), (0.106, 0.010), (0.112, 0.016), (0.135, 0.19), (0.137, 0.197), (0.152, 0.199),
               (0.158, 0.205), (0.160, 0.245), (0.158, 0.258), (0.151, 0.263), (0.143, 0.262), (0.139, 0.255),
               (0.138, 0.235)]


def _pot(kind):
    """(objects, soil_z, soil_r) for a planter kind."""
    parts = []
    seg = 40
    if kind == "brass":
        prof, key = POT_BRASS, "brass_aged"
    elif kind == "glazed":
        prof, key = POT_GLAZED, "ceramic_glazed"
    elif kind == "terracotta":
        prof, key = POT_TERRA, "terracotta"
        parts.append(_lathe("pot_saucer", SAUCER, "terracotta", seg, caps=(True, False), smooth=40, grain=None))
    elif kind == "cream_s":
        prof, key = POT_CREAM_S, "ceramic_cream"
        seg = 32
    else:
        prof, key = POT_TERRA_S, "terracotta"
        seg = 32
        s = [(r * 0.74, z * 0.74) for r, z in SAUCER]
        parts.append(_lathe("pot_saucer", s, "terracotta", seg, caps=(True, False), smooth=40, grain=None))
    ob = _lathe("pot", prof, key, seg, caps=(True, False), smooth=38, grain=None)
    C.uv_cylinder(ob, tex(key))
    parts.append(ob)
    sr, sz = prof[-1][0] + 0.002, prof[-1][1]
    # soil: a gentle mound meeting the inner wall, with a few pebbles of bark mulch
    soil = _lathe("soil", [(0.0, sz + 0.016), (sr * 0.45, sz + 0.012), (sr * 0.8, sz + 0.005), (sr, sz)], "soil", seg,
                  caps=(False, False), smooth=60, grain=None)
    parts.append(soil)
    if kind == "brass":
        for sx in (-1, 1):
            boss = C.lathe("pot_boss", [(0.0, 0.0), (0.020, 0.0), (0.022, 0.004), (0.018, 0.010), (0.008, 0.015), (0.0, 0.016)],
                           20, mat("brass_aged"), cap_bottom=False, cap_top=False)
            C.transform_mesh(boss, Matrix.Translation((sx * 0.229, 0, 0.318)) @ Matrix.Rotation(sx * HALF_PI, 4, "Y"))
            ring = C.torus("pot_ring", 0.034, 0.0055, (sx * 0.244, 0, 0.29), mat("brass_aged"), 28, 8, rot=C.roty(90))
            for o in (boss, ring):
                C.uv_box(o, tex("brass_aged"))
            parts += [boss, ring]
    return parts, sz + 0.012, sr


def _stem_path(base, top, bend, n=10, rng=None):
    base, top = Vector(base), Vector(top)
    pts = []
    for i in range(n + 1):
        t = i / n
        p = base.lerp(top, t)
        p += Vector(bend) * math.sin(math.pi * t) * 1.0
        pts.append(p)
    return pts


def _plant_fig(mb, soil_z, rng, scale=1.0, stems=3):
    """Fiddle-leaf fig: a clump of slim grey stems with big violin-shaped, wavy, glossy leaves."""
    tops = [(0.05, 0.03, 1.5), (-0.11, -0.06, 1.3), (0.12, -0.1, 1.1)][:stems]
    for k, (tx, ty, tz) in enumerate(tops):
        tz = soil_z + (tz - soil_z) * scale
        base = Vector((tx * 0.25, ty * 0.25, soil_z - 0.02))
        top = Vector((tx, ty, tz - 0.06))
        path = _stem_path(base, top, (0.02 * (k - 1), 0.015, 0), 9)
        radii = [0.012 * scale * (1.0 - 0.6 * i / 9) + 0.004 for i in range(10)]
        _tube(mb, path, radii, "bark_plant", 7)
        nleaf = int((18 if k == 0 else 15) * (0.55 + 0.45 * scale))
        start = 0.34
        for i in range(nleaf):
            u = start + (1 - start) * i / max(1, nleaf - 1)
            seg = min(len(path) - 2, int(u * (len(path) - 1)))
            f = u * (len(path) - 1) - seg
            p = path[seg].lerp(path[seg + 1], f)
            az = i * 2.39996 + k * 1.1 + rng.uniform(-0.25, 0.25)
            el = math.radians(rng.uniform(4, 26) + 28 * u)
            d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
            L = (0.37 - 0.14 * u + rng.uniform(-0.025, 0.025)) * (0.68 + 0.32 * scale)
            pet_end = p + d * 0.03 + Vector((0, 0, 0.012))
            _tube(mb, [p, p + d * 0.016 + Vector((0, 0, 0.008)), pet_end], [0.005, 0.0045, 0.004], "stem_green", 4)
            leaf(mb, pet_end, d + Vector((0, 0, 0.15)), (0, 0, 1), L, L * 0.64, "fig", "foliage_fig", rows=11, cols=7,
                 fold=0.15, cup=1.4, droop=0.42 + rng.uniform(-0.1, 0.15), wave=0.05, twist=rng.uniform(-0.3, 0.3),
                 vein="leaf_vein", vein_w=0.0032)
        # the newest leaves: a small folded pair at the very top
        tipd = (path[-1] - path[-2]).normalized()
        leaf(mb, path[-1], tipd + Vector((0.2, 0, 0)), (1, 0, 0.2), 0.1 * scale + 0.03, 0.05, "fig", "foliage_fig",
             rows=5, cols=3, fold=0.5, droop=0.1)


def _plant_rubber(mb, soil_z, rng, scale=1.0):
    """Rubber plant: upright woody stems, thick glossy elliptic leaves, red sheaths at the tips."""
    tops = [(0.02, 0.04, 1.5), (-0.1, -0.05, 1.26), (0.1, -0.07, 1.04)]
    for k, (tx, ty, tz) in enumerate(tops):
        tz = soil_z + (tz - soil_z) * scale
        base = Vector((tx * 0.3, ty * 0.3, soil_z - 0.02))
        top = Vector((tx, ty, tz - 0.08))
        path = _stem_path(base, top, (0.0, 0.0, 0.0), 8)
        radii = [0.014 * (1.0 - 0.55 * i / 8) + 0.003 for i in range(9)]
        _tube(mb, path, radii, "stem_green" if k else "bark_plant", 7)
        nleaf = int((15 if k == 0 else 12) * (0.6 + 0.4 * scale))
        for i in range(nleaf):
            u = 0.24 + 0.76 * i / max(1, nleaf - 1)
            seg = min(len(path) - 2, int(u * (len(path) - 1)))
            f = u * (len(path) - 1) - seg
            p = path[seg].lerp(path[seg + 1], f)
            az = i * 2.39996 + k * 0.7 + rng.uniform(-0.2, 0.2)
            el = math.radians(rng.uniform(12, 32) + 24 * u)
            d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
            L = (0.32 - 0.1 * u + rng.uniform(-0.015, 0.015)) * (0.75 + 0.25 * scale)
            pe = p + d * 0.04
            _tube(mb, [p, p + d * 0.02, pe], [0.0055, 0.005, 0.0045], "stem_green", 4)
            leaf(mb, pe, d + Vector((0, 0, 0.12)), (0, 0, 1), L, L * 0.53, "rubber", "foliage_rubber", rows=12, cols=7,
                 fold=-0.16, cup=2.0, droop=0.35 + rng.uniform(-0.1, 0.15), twist=rng.uniform(-0.25, 0.25),
                 vein="leaf_vein", vein_w=0.0035)
        # red sheath wrapping the growing tip
        tp = path[-1]
        tdir = (path[-1] - path[-2]).normalized()
        _tube(mb, [tp - tdir * 0.008, tp + tdir * 0.025, tp + tdir * 0.05, tp + tdir * 0.064],
              [0.0062, 0.0056, 0.0034, 0.0004], "foliage_sheath", 6)


def _plant_palm(mb, soil_z, rng, rmax=0.4):
    """Kentia palm: a clump of arching fronds with drooping, folded leaflets."""
    fronds = 10
    for k in range(fronds):
        az = k * 2.39996 + rng.uniform(-0.2, 0.2)
        cx, cy = math.cos(k * 1.7) * 0.035, math.sin(k * 1.7) * 0.035
        origin = Vector((cx, cy, soil_z - 0.02))
        L = rng.uniform(1.15, 1.5) if k > 2 else rng.uniform(1.5, 1.72)
        e0 = math.radians(rng.uniform(76, 88) if k > 2 else rng.uniform(84, 89))
        e1 = math.radians(rng.uniform(-28, -8) if k > 2 else rng.uniform(-5, 10))
        n = 14
        pts = [origin]
        p = origin.copy()
        for i in range(n):
            s = (i + 0.5) / n
            e = e0 + (e1 - e0) * s ** 1.4
            d = Vector((math.cos(az) * math.cos(e), math.sin(az) * math.cos(e), math.sin(e)))
            p = p + d * (L / n)
            pts.append(p)
        radii = [0.008 * (1 - 0.75 * i / n) + 0.0015 for i in range(n + 1)]
        _tube(mb, pts, radii, "stem_green", 5)
        npairs = 16
        for i in range(npairs):
            s = 0.3 + 0.67 * i / (npairs - 1)
            idx = s * n
            a = min(n - 1, int(idx))
            q = pts[a].lerp(pts[a + 1], idx - a)
            t = (pts[a + 1] - pts[a]).normalized()
            horiz = Vector((0, 0, 1)).cross(t)
            if horiz.length < 1e-4:
                horiz = Vector((1, 0, 0))
            horiz.normalize()
            ln = (0.13 + 0.19 * math.sin(math.pi * min(1.0, (s - 0.25) / 0.78)) ** 0.7) * min(1.15, L / 1.25)
            for sd in (-1, 1):
                d = t * math.cos(math.radians(55)) + horiz * sd * math.sin(math.radians(55))
                d = (d - Vector((0, 0, 0.55 + 0.25 * s))).normalized()
                leaf(mb, q, d, (0, 0, 1), ln, ln * 0.13, "pinna", "foliage_palm", rows=5, cols=3, fold=0.55,
                     droop=0.6 + 0.3 * s, twist=0.0)


def _plant_snake(mb, soil_z, rng):
    """Snake plant: stiff upright sword leaves, concave and gently twisted."""
    n = 12
    for k in range(n):
        az = k * 2.39996
        r = 0.02 + 0.06 * ((k * 7) % n) / n
        base = Vector((math.cos(az) * r, math.sin(az) * r, soil_z - 0.02))
        el = math.radians(rng.uniform(74, 88))
        d = Vector((math.cos(az) * math.cos(el), math.sin(az) * math.cos(el), math.sin(el)))
        L = rng.uniform(0.42, 0.62) * (1.0 if k > 2 else 1.08)
        leaf(mb, base, d, (math.cos(az + 1.6), math.sin(az + 1.6), 0), L, rng.uniform(0.05, 0.068), "sword",
             "foliage_snake", rows=8, cols=3, fold=0.45, droop=-0.08 + rng.uniform(-0.05, 0.1),
             twist=rng.uniform(-0.6, 0.6))


PLANT_VARIANTS = {0: ("palm", "brass"), 1: ("fig", "glazed"), 2: ("rubber", "terracotta")}


def plant_variant(seed):
    """plan seeds come in pairs (1,2 hall, 3,4 lobby, ...): pairs match. Hall = palms."""
    return ((int(seed) + 1) // 2 + 2) % 3


def build_plant_large(item=None, seed=None):
    seed = getattr(item, "seed", 0) if seed is None else seed
    v = plant_variant(seed)
    species, potk = PLANT_VARIANTS[v]
    rng = random.Random(1000 + v)
    parts, soil_z, sr = _pot(potk)
    mb = MB()
    if species == "palm":
        _plant_palm(mb, soil_z, rng)
        _fit_radius(mb, 0.345, 1.6, soil_z)
    elif species == "fig":
        _plant_fig(mb, soil_z, rng)
        _fit_radius(mb, 0.345, 1.6, soil_z)
    else:
        _plant_rubber(mb, soil_z, rng)
        _fit_radius(mb, 0.345, 1.6, soil_z)
    fol = mb.build("foliage", 70)
    ob = _join(parts + [fol], f"Prop_Plant_Large_{species.capitalize()}_{v + 1:02d}")
    ob["variant"] = v
    return ob


def build_plant_small(item=None, seed=None):
    seed = getattr(item, "seed", 0) if seed is None else seed
    v = int(seed) % 2
    rng = random.Random(2000 + v)
    mb = MB()
    if v == 0:
        parts, soil_z, sr = _pot("cream_s")
        _plant_snake(mb, soil_z, rng)
        _fit_radius(mb, 0.22, 0.9, soil_z)
        name = "Snake"
    else:
        parts, soil_z, sr = _pot("terra_s")
        _plant_fig(mb, soil_z, rng, scale=0.5, stems=2)
        _fit_radius(mb, 0.22, 0.9, soil_z)
        name = "Fig"
    fol = mb.build("foliage", 70)
    return _join(parts + [fol], f"Prop_Plant_Small_{name}_{v + 1:02d}")


# ---------------------------------------------------------------------------
# Antique world map (runtime image shared by the globe and the framed maps)
# ---------------------------------------------------------------------------

# Simplified coastlines (lon, lat); each continent gets an antique wash colour.
_NA = [(-168, 66), (-162, 70), (-156, 71.3), (-141, 69.6), (-128, 70), (-115, 68.5), (-105, 68), (-95, 71.5),
       (-88, 68.5), (-81, 69), (-82, 66), (-87, 64), (-93, 61), (-94.5, 58.7), (-92, 57), (-85, 55.3), (-82, 52.5),
       (-79.5, 51.5), (-78, 58), (-77, 60.5), (-78, 62.5), (-73, 62), (-70, 60), (-64.5, 60.3), (-61.5, 56),
       (-56, 52), (-59, 48), (-65, 48.5), (-64, 45.5), (-67, 44.5), (-70, 43), (-70.5, 41.6), (-74, 40.5), (-76, 38),
       (-75.5, 35.5), (-78, 33.8), (-81, 31.5), (-80, 27), (-80.5, 25.2), (-82, 26.5), (-83, 29.5), (-85, 29.8),
       (-89, 30.2), (-90, 29), (-94, 29.6), (-97.3, 27.5), (-97.5, 24), (-97.5, 21.5), (-96, 19), (-94.5, 18.2),
       (-91, 18.8), (-90.5, 21), (-87, 21.5), (-87.5, 18.5), (-88.5, 16), (-84, 15.8), (-83.3, 12), (-83.7, 10.8),
       (-81.7, 9), (-79.5, 9.5), (-77.5, 8.5), (-77.6, 7.6), (-80, 7.3), (-82, 8.2), (-85.5, 9.8), (-85.7, 11),
       (-87.5, 13), (-91, 14), (-94, 16), (-96.5, 15.7), (-100, 17), (-105, 19.8), (-105.5, 22.5), (-109.5, 26),
       (-112.5, 29.5), (-114.7, 31.7), (-113.2, 29), (-112.3, 27), (-110, 23.2), (-112.1, 25), (-114.2, 28),
       (-117, 32.5), (-118.5, 34), (-120.6, 34.6), (-122.5, 37.5), (-124, 40.5), (-124.2, 43), (-124, 46.3),
       (-124.7, 48.4), (-123, 49), (-125.5, 50.5), (-128, 52), (-130.5, 54.5), (-133, 57), (-136, 58.5), (-140, 59.8),
       (-146, 60.8), (-150, 59.5), (-152, 58), (-154, 57), (-158, 56), (-162, 55), (-164.5, 54.5), (-160, 56.5),
       (-158, 58.5), (-162, 58.7), (-164, 60.5), (-165.5, 62.5), (-164, 63.3), (-161, 64.4), (-166, 65.5)]
_SA = [(-77.3, 8.3), (-75, 10.8), (-72, 12), (-71.3, 11), (-68, 10.5), (-64, 10.6), (-61.5, 10.5), (-60, 8.5),
       (-57, 6), (-53, 5.5), (-51, 4), (-50, 1.8), (-48.5, -0.5), (-44.5, -2.5), (-41, -2.9), (-38, -4), (-35.2, -5.5),
       (-34.8, -7.5), (-35.2, -9), (-37, -11), (-38.8, -13), (-39, -17.5), (-40.5, -20.5), (-41.5, -22.5), (-44, -23),
       (-47, -24.5), (-48.5, -26.5), (-48.7, -28.5), (-50.5, -31), (-53, -33.8), (-54.5, -34.8), (-57, -34.4),
       (-58.4, -34.5), (-57.3, -36), (-57.6, -38), (-62, -39), (-62.2, -41), (-65, -41), (-64, -42.5), (-65.5, -45),
       (-67.5, -46.5), (-66, -48), (-68.5, -50), (-69, -52), (-68.5, -53.5), (-66.5, -55), (-70, -55.3), (-73, -53.5),
       (-74.5, -51), (-75.5, -47), (-73.5, -44), (-73.7, -41), (-73.5, -37.5), (-72, -34), (-71.5, -31), (-71.3, -28),
       (-70.5, -24), (-70.2, -20), (-70.5, -18.3), (-74, -16.3), (-76.3, -14), (-78, -11), (-79.5, -8), (-81.2, -5.5),
       (-80.3, -3.5), (-80.5, -1), (-80, 1), (-78.8, 1.8), (-77.5, 4), (-77.3, 6.5), (-77.8, 7.4)]
_AF = [(-17, 21), (-16, 24), (-13, 27.5), (-10, 29.5), (-9.8, 31.5), (-6.8, 34), (-5.9, 35.8), (-2, 35.1), (1, 36.5),
       (5, 36.8), (10, 37.2), (11, 35.2), (10.2, 33.8), (11.5, 33), (15.2, 32.3), (19, 30.3), (20, 31.5), (22, 32.9),
       (25, 31.7), (29, 30.9), (32, 31.2), (34.2, 31.3), (32.6, 29.9), (33.5, 27.5), (35.5, 24), (37.3, 21), (38.5, 18),
       (39.7, 15.5), (41.5, 13.5), (43.3, 12.5), (44.5, 10.4), (48, 11.2), (51.2, 11.8), (51, 10.4), (49.5, 6.8),
       (48, 4.5), (46, 2), (43.5, -0.5), (41.5, -1.8), (40, -3.5), (39, -6), (39.5, -8), (40.3, -10.5), (40.6, -14.5),
       (39, -17), (36.5, -18.8), (35.3, -21.5), (35.5, -24), (32.9, -25.9), (32.5, -28.5), (31, -29.8), (28, -33),
       (25.5, -34), (22.5, -34), (20, -34.8), (18.4, -34), (17.8, -31.5), (16.5, -28.6), (15.2, -27), (14.5, -22.5),
       (13, -20), (11.8, -17), (12.3, -13.5), (13.7, -11), (13.2, -8.5), (12.2, -6), (11.8, -3.7), (9.6, -1),
       (9.4, 1.2), (9.8, 3.2), (8.5, 4.5), (6, 4.3), (4.5, 6.3), (2, 6.3), (-1.5, 5), (-4.5, 5.2), (-7.5, 4.4),
       (-9.5, 5.5), (-11.5, 6.9), (-13.3, 8.8), (-15, 10.9), (-16.8, 12.4), (-17.2, 14.7), (-16.5, 16.2),
       (-16.1, 18.5), (-16.5, 19.6)]
_EUAS = [(-9.5, 43.3), (-8.9, 38.7), (-8.8, 37), (-6.3, 36.8), (-5.6, 36.0), (-2.2, 36.7), (-0.5, 38.3), (0.2, 39.2),
         (3.2, 41.9), (3.1, 43.2), (6.5, 43.1), (8.8, 44.4), (10.4, 43.3), (12.3, 41.6), (15.6, 40.1), (15.7, 38.2),
         (16.2, 38.1), (17.1, 39.2), (16.6, 40.5), (18.5, 40.2), (16, 41.6), (13.8, 43.6), (12.3, 45.3), (13.8, 45.6),
         (15.4, 44.1), (17.6, 42.9), (19.5, 41.8), (19.4, 40.3), (21.1, 38.4), (22.6, 36.4), (23.2, 37.9), (24, 38.3),
         (22.8, 40.4), (24.4, 40.9), (26.3, 40.6), (26.6, 40), (26.2, 39.4), (27.2, 37.8), (28.1, 36.7), (30.6, 36.7),
         (32.5, 36.1), (34.5, 36.8), (36, 36.5), (35.9, 35.4), (35.0, 33.1), (34.3, 31.3), (35, 29.5), (36.5, 26.5),
         (38.5, 23.5), (39.2, 21.5), (40.8, 19), (42.6, 16.5), (43.2, 13.3), (45, 12.8), (48.5, 14), (52.2, 15.6),
         (55.5, 17.5), (57.8, 19), (59.8, 22.5), (58.8, 23.6), (56.4, 24.8), (56.3, 26.4), (54.5, 24.2), (51.6, 24.5),
         (51.5, 25.9), (50.2, 26.2), (48.5, 28.4), (47.9, 30), (50.2, 30.2), (51.5, 27.9), (54.8, 26.5), (57.3, 25.8),
         (61.5, 25.2), (66.5, 25.4), (67.4, 24), (68.8, 22.8), (70.5, 20.8), (72.8, 19.2), (73.3, 16), (74.5, 12.9),
         (76.3, 9.5), (77.5, 8.1), (78.3, 8.9), (79.9, 10.3), (79.9, 12.5), (80.2, 15.5), (82.3, 17), (84.5, 19.2),
         (86.9, 20.7), (88, 21.7), (89.8, 21.9), (91.8, 22.3), (92.3, 20.7), (94.2, 18), (94.3, 16), (97.6, 16.5),
         (98.3, 13.5), (98.6, 10), (98.3, 8.4), (100.2, 5.4), (101.3, 2.9), (103.5, 1.3), (104.2, 1.4), (103.4, 4.4),
         (102.5, 6.2), (100.3, 7.3), (99.9, 9.3), (99.2, 10.5), (100.1, 13.4), (100.9, 12.6), (102.6, 12.2),
         (104.3, 10.5), (105.1, 8.6), (106.8, 10.4), (108.9, 11.7), (109.3, 13.4), (108.6, 15.5), (106.6, 17.5),
         (105.7, 18.9), (106.7, 20.7), (108.1, 21.6), (110.5, 21.1), (111.7, 21.6), (113.8, 22.4), (116.5, 22.9),
         (119.5, 25.4), (120.8, 27.8), (121.9, 30.5), (121, 32.2), (120.3, 34.5), (119.2, 35), (120.7, 36.4),
         (122.5, 37), (121, 37.7), (119, 37.4), (118.5, 38.3), (117.8, 39.1), (119.4, 39.6), (121.3, 40.9),
         (121.6, 39.0), (122.3, 39.4), (124.3, 39.9), (125.1, 38.0), (126.6, 37.0), (126.5, 34.6), (128.9, 35.1),
         (129.4, 36.5), (128.4, 38.6), (127.5, 39.8), (129.7, 40.9), (129.9, 42.5), (131.9, 43.0), (133.2, 42.8),
         (135.5, 43.9), (138.2, 46.6), (140.4, 48.9), (140.7, 51.5), (141.4, 53.3), (137.8, 53.9), (135.1, 54.7),
         (137.4, 56.0), (141.5, 59.2), (145.5, 59.4), (149, 59.6), (152.3, 59), (155, 59.3), (156.7, 61.5), (160, 61.5),
         (163.3, 62.5), (160.4, 60), (156.7, 57), (156.2, 51.2), (158.3, 52.9), (162, 54.8), (162.2, 57.8),
         (163.6, 59.9), (166.3, 60.4), (170.3, 60), (172.5, 61), (177.4, 62.5), (179.9, 64.5), (183, 65.5),
         (186, 66), (189.7, 66.3), (187, 67.5), (182, 68.5), (180, 69), (176, 69.8), (170.5, 70.1), (166, 69.6),
         (161, 69.6), (160, 70.8), (152, 70.9), (146, 72.3), (140, 72.5), (137, 71.5), (131.3, 70.8), (128.5, 72.5),
         (129.5, 73), (126, 73.6), (118, 73.6), (113.5, 73.4), (112, 74), (108.2, 73.6), (106.5, 73.2), (104, 77.7),
         (100, 76.5), (98, 76), (92.5, 75.7), (88.3, 75.1), (86.7, 73.7), (80.8, 72.4), (80, 72.6), (72.5, 72.8),
         (69, 72.8), (66.5, 71), (66, 69.5), (61, 69.7), (58, 68.8), (54, 68.5), (50, 68.3), (44, 68.4),
         (43.5, 66.5), (40.5, 64.7), (38, 64.3), (36.5, 64.8), (34.8, 64.3), (34.5, 65.9), (33, 66.7), (38.5, 66.2),
         (41, 67), (40, 68), (35, 69.2), (32, 69.8), (29, 70.1), (25.5, 71.1), (20.6, 70), (16.5, 68.6), (14.5, 67.6),
         (12.5, 65.8), (10.5, 64.4), (8, 63.3), (5, 62), (5, 60.5), (5.7, 58.8), (7, 58), (8.5, 58.2), (10.3, 59.1),
         (11.1, 58.9), (11.8, 58), (12.6, 56.2), (13, 55.4), (14.2, 55.4), (16, 56.2), (16.6, 57.7), (16.6, 58.9),
         (18.6, 59.4), (18, 60.5), (17.3, 61.3), (17.4, 62.4), (19.7, 63.5), (21.5, 64.4), (21.3, 65.4), (24.6, 65.7),
         (25.4, 65.1), (24.5, 64.6), (22.3, 63.2), (21.3, 61.5), (21.6, 60.5), (22.9, 59.9), (25.5, 60.4),
         (28.5, 60.6), (30, 59.9), (28, 59.5), (26.5, 59.4), (23.5, 59.2), (23.5, 58.5), (24.4, 57.8), (24, 57),
         (21.5, 57.4), (21, 56.1), (21.2, 55.2), (19.8, 54.4), (17.5, 54.8), (14.3, 53.9), (12, 54.2), (10.9, 54.4),
         (10.9, 56.4), (10.3, 57.6), (8.6, 57.1), (8.1, 55.5), (8.6, 53.9), (7, 53.6), (5, 53.3), (4, 51.6),
         (2.5, 51.1), (1.6, 50.2), (0.2, 49.7), (-1.3, 49.6), (-1.9, 48.7), (-4.6, 48.5), (-4.4, 47.8), (-2.2, 47.1),
         (-1.2, 46.1), (-1.4, 44.2), (-1.8, 43.4), (-4.5, 43.4), (-8, 43.7)]
_AU = [(113.7, -22), (114.2, -26.3), (115, -29.5), (115.7, -31.7), (115, -33.6), (116.6, -35), (118, -35),
       (121, -33.8), (123.6, -33.9), (126, -32.3), (131, -31.5), (134.2, -32.6), (135.6, -34.8), (137.8, -33),
       (137.5, -35.6), (139.6, -35.9), (140.7, -38.1), (144, -38.3), (146.3, -39.1), (148, -37.8), (150, -37.4),
       (150.9, -34), (153.1, -30.5), (153.5, -28), (153, -25.2), (150.8, -22.6), (149, -20.5), (146.3, -19),
       (145.4, -15.5), (143.6, -14), (142.5, -10.7), (141.6, -12.9), (141.4, -16.4), (140.5, -17.6), (139, -17.3),
       (136.3, -15.5), (135.5, -14.7), (136.8, -12.2), (134, -12), (132.6, -11.5), (131, -12.2), (129.4, -14.9),
       (127.8, -14.3), (125.5, -14.5), (123, -16.4), (121.5, -18.8), (119, -20), (116.7, -20.6)]
_ANT = [(-180, -78), (-170, -77.5), (-160, -78.5), (-150, -77), (-140, -75), (-120, -73.5), (-100, -73), (-80, -72.5),
        (-75, -70), (-68, -67), (-63, -64.5), (-57, -63.3), (-60, -65), (-62, -68), (-62, -72), (-60, -75), (-45, -78),
        (-35, -77), (-20, -73), (-10, -71), (0, -70), (15, -70), (30, -69.5), (40, -68.5), (50, -67), (60, -67.5),
        (70, -68), (80, -66.5), (90, -66.5), (100, -65.5), (110, -66), (120, -66.8), (130, -66), (140, -66.7),
        (150, -68.6), (160, -70), (170, -72), (180, -78), (180, -90), (-180, -90)]
_GREEN = [(-73, 78), (-68, 76), (-58, 75.5), (-55, 72), (-53.5, 69), (-52, 66), (-50, 62), (-43.5, 60), (-41.5, 62.5),
          (-40, 65.2), (-35, 66.2), (-25, 69.5), (-22, 71), (-21.5, 74), (-18.5, 77), (-19, 80), (-12.5, 81.5),
          (-25, 83.3), (-40, 83.5), (-55, 82.5), (-62, 81.5), (-66, 80), (-72, 79)]
_ISLANDS = {
    "na": [[(-80, 73.5), (-72, 71.5), (-68, 70), (-62, 66.5), (-65, 63), (-70, 62.5), (-74, 64.5), (-78, 64.5),
            (-84, 67), (-86, 70), (-90, 73.5)],
           [(-90, 77), (-80, 76.5), (-70, 78), (-62, 82), (-80, 83), (-92, 81)],
           [(-118, 69), (-105, 69), (-101, 71), (-106, 73.5), (-115, 73), (-119, 71)],
           [(-85, 21.9), (-82, 23.1), (-77.5, 22.4), (-74.2, 20.2), (-77.5, 19.9), (-80, 21.7), (-83, 22)],
           [(-74.4, 18.4), (-72.8, 19.9), (-70, 19.7), (-68.4, 18.6), (-71.4, 17.6), (-72.8, 18.1)],
           [(-59.3, 47.6), (-55.4, 46.9), (-52.7, 47.5), (-53.5, 49.3), (-55.6, 51.6), (-57.3, 50.7), (-59.4, 48.5)]],
    "eu": [[(-5.7, 50), (-3, 50.6), (1.4, 51.2), (1.7, 52.7), (0.2, 53.5), (-0.5, 54.5), (-1.6, 55.6), (-2.1, 56.4),
            (-1.8, 57.6), (-3.3, 58.6), (-5, 58.6), (-6.2, 57.5), (-5.6, 56), (-4.9, 54.8), (-3.2, 54.9), (-3.4, 53.5),
            (-4.6, 53.3), (-4.2, 52.3), (-5.3, 51.8), (-3.4, 51.4), (-4.5, 51.2)],
           [(-6, 52.2), (-6.2, 53.5), (-5.8, 55.2), (-7.3, 55.4), (-8.5, 54.3), (-10, 54.2), (-9.8, 53.4),
            (-10.3, 51.9), (-9.6, 51.5), (-8.2, 51.8)],
           [(-22.5, 63.9), (-18, 63.4), (-14.5, 64.3), (-13.6, 65.2), (-14.9, 66.4), (-18, 66.2), (-22.4, 66.4),
            (-24.3, 65.6), (-22, 64.9)]],
    "as": [[(140, 41.5), (141.8, 42.6), (143.3, 42), (145.5, 43.3), (144.5, 44.1), (142, 45.4), (141.5, 43.8),
            (140.4, 43.3)],
           [(130.2, 31.3), (131.4, 31.4), (132, 33.6), (134.5, 33.7), (135.6, 33.5), (136.9, 34.3), (139, 34.6),
            (140.8, 35.7), (140.6, 36.9), (141.2, 38.3), (142, 39.5), (141.4, 41.4), (140, 40.7), (139.9, 39.5),
            (139.5, 38.2), (138.5, 37.4), (137, 37), (136.6, 36), (135.4, 35.6), (133, 35.5), (131.4, 34.4),
            (130.9, 33.9), (129.6, 33.2), (129.8, 32.6)],
           [(142, 46), (143.5, 46.8), (143, 49), (144.5, 49.2), (143.2, 51.8), (143.2, 54.2), (142.5, 54.3),
            (142.2, 51.5), (141.8, 48.8)],
           [(120.1, 23), (120.8, 21.9), (121.9, 24.6), (121.5, 25.3), (120.6, 24.5)],
           [(108.7, 18.5), (110, 18.2), (111, 19.6), (110.4, 20.1), (109, 19.8)],
           [(120, 16.3), (120.6, 14.2), (121.5, 13.8), (124, 12.8), (124.2, 13.9), (122, 14.5), (122.5, 17),
            (122.2, 18.5), (120.6, 18.5)],
           [(122, 7), (123.7, 7.8), (125.5, 9.6), (126.5, 7.4), (125.5, 5.7), (124, 6.2)],
           [(109, 1.5), (109.6, -1), (110.2, -2.9), (114.5, -3.8), (116.5, -2.4), (117.6, 1), (119, 0.9), (117.9, 4.2),
            (119.2, 5.3), (117.1, 7), (115.4, 4.9), (113, 3.2), (111.1, 1.8)],
           [(95.3, 5.6), (97.5, 5.2), (100.4, 2.2), (103.8, -1), (106, -3.2), (106, -5.8), (104.5, -5.9), (102.3, -4),
            (100.5, -1.5), (98.7, 1.7)],
           [(105.2, -6.8), (106, -5.9), (108.3, -6.3), (110.5, -6.9), (112.6, -6.9), (114.6, -7.8), (114.4, -8.7),
            (111, -8.3), (108, -7.8), (106, -7.4)],
           [(119.4, -5.5), (120.4, -5.6), (120.9, -2.6), (122.4, -4.6), (123.2, -4.4), (121.3, -1.9), (123.3, -0.9),
            (121.1, -0.9), (120.8, 1.3), (124.9, 1.6), (120.4, 0.4), (119.6, -0.1), (118.8, -2.6)],
           [(79.8, 9.8), (81, 9), (81.9, 7.5), (81.6, 6.2), (80.1, 6), (79.8, 7.5)]],
    "au": [[(131, -1.3), (134, -0.9), (137.5, -1.5), (141, -2.6), (145, -4.3), (147.6, -6.1), (148, -8),
            (150.8, -10.3), (147.4, -10.1), (146, -8.1), (143.3, -9), (142.6, -9.3), (141, -9.1), (138.9, -8.1),
            (137.7, -5.2), (135, -4.3), (133.3, -4.1), (132, -2.8)],
           [(144.7, -40.7), (148.3, -40.9), (148, -43.2), (146.9, -43.6), (145.3, -42.2)],
           [(172.7, -34.5), (174.6, -36.2), (175.9, -37.4), (178.5, -37.7), (177, -39.6), (176, -41.3), (174.6, -41.3),
            (175.2, -40), (173.8, -39.2), (174.6, -37), (173, -35.3)],
           [(172.6, -40.5), (174.3, -41.7), (173, -43.8), (171.3, -44.4), (170.6, -45.9), (169, -46.6), (166.5, -46),
            (168.4, -44), (171.2, -42.2)]],
    "af": [[(49.3, -12), (50.4, -15.5), (49.8, -17.5), (48.5, -20.5), (47.2, -24.8), (45.2, -25.5), (43.8, -24),
            (43.3, -21.5), (44.3, -19), (44, -16.5), (46.3, -15.7), (48, -13.5)]],
}
_SEAS = [[(27.6, 42.5), (28, 41.6), (29.1, 41.2), (31.3, 41.2), (33.5, 42), (35.2, 42), (38, 41), (41.5, 41.5),
          (41.6, 42.6), (39.9, 43.5), (38, 44.5), (36.5, 45.2), (35, 45), (33.5, 44.5), (32.5, 45.4), (33.6, 46.1),
          (31.7, 46.6), (30.7, 46.5), (29.6, 45.3), (28.7, 44.3), (28, 43.2)],
         [(47, 44.8), (49, 46.5), (51.5, 47), (53, 46.8), (53, 45.2), (51.3, 44.5), (51, 43), (52.8, 41.5), (53.9, 40.6),
          (53, 39.3), (53.9, 37.3), (51.5, 36.8), (49.1, 37.6), (48.9, 38.4), (49.5, 40.2), (48, 42), (47.5, 43)]]
_WASH = {"na": (0.79, 0.81, 0.58), "sa": (0.87, 0.77, 0.52), "af": (0.89, 0.73, 0.48), "eu": (0.88, 0.69, 0.60),
         "as": (0.91, 0.83, 0.55), "au": (0.91, 0.68, 0.49), "ant": (0.94, 0.92, 0.86), "gr": (0.93, 0.91, 0.85)}


def _world_map_image(W=2048, H=1024):
    """Draws the antique map (parchment sea with water-lining, washed continents, sepia coast,
    graticule, equator, tropics) into a packed bpy image. Equirectangular: u = lon, v = lat."""
    img = bpy.data.images.get("OVR_WorldMap")
    if img is not None:
        return img
    import numpy as np
    rng = random.Random(7)

    def wobble(poly):
        out = []
        n = len(poly)
        phase = rng.uniform(0, 6.28)
        for i in range(n):
            a, b = poly[i], poly[(i + 1) % n]
            dl = math.hypot(b[0] - a[0], b[1] - a[1])
            k = max(1, int(dl / 0.8))
            for s in range(k):
                t = s / k
                x = a[0] + (b[0] - a[0]) * t
                y = a[1] + (b[1] - a[1]) * t
                if abs(y) < 89.5 and abs(x) < 179.5:
                    phase += rng.uniform(-0.9, 0.9)
                    x += 0.33 * math.sin(phase) + rng.uniform(-0.12, 0.12)
                    y += 0.33 * math.cos(phase * 1.3) + rng.uniform(-0.12, 0.12)
                out.append((x, y))
        return out

    def fill(mask, poly):
        xs = np.array([(lon + 180.0) / 360.0 * W for lon, lat in poly])
        ys = np.array([(90.0 - lat) / 180.0 * H for lon, lat in poly])
        for shift in ((0.0,) if xs.max() <= W else (0.0, -float(W))):
            x0 = xs + shift
            x1 = np.roll(x0, -1)
            y0, y1 = ys, np.roll(ys, -1)
            r0 = max(0, int(ys.min()))
            r1 = min(H - 1, int(ys.max()) + 1)
            for row in range(r0, r1 + 1):
                py = row + 0.5
                m = ((y0 <= py) & (y1 > py)) | ((y1 <= py) & (y0 > py))
                if not m.any():
                    continue
                xi = np.sort(x0[m] + (py - y0[m]) * (x1[m] - x0[m]) / (y1[m] - y0[m]))
                for a, b in zip(xi[0::2], xi[1::2]):
                    c0, c1 = max(0, int(round(a))), min(W, int(round(b)))
                    if c1 > c0:
                        mask[row, c0:c1] = True

    land = np.zeros((H, W), bool)
    wash = np.zeros((H, W, 3), np.float32)
    groups = [("na", _NA), ("sa", _SA), ("af", _AF), ("eu", _EUAS), ("au", _AU), ("ant", _ANT), ("gr", _GREEN)]
    for key, polys in _ISLANDS.items():
        for p in polys:
            groups.append((key, p))
    lon = (np.arange(W) + 0.5) / W * 360.0 - 180.0
    lat = 90.0 - (np.arange(H) + 0.5) / H * 180.0
    LON, LAT = np.meshgrid(lon, lat)
    euas = None
    for key, poly in groups:
        m = np.zeros((H, W), bool)
        fill(m, wobble(poly) if key != "ant" else poly)
        land |= m
        wash[m] = _WASH[key]
        if poly is _EUAS:
            euas = m
    # Eurasia's wash: Europe rose west of the Urals and the Caucasus, Asia gold beyond
    europe = euas & (LAT > 36) & (LON < 58) & ~((LON > 26) & (LAT < 42.5)) & ~((LON > 40) & (LAT < 47))
    wash[euas & ~europe] = _WASH["as"]
    for p in _SEAS:
        m = np.zeros((H, W), bool)
        fill(m, wobble(p))
        land &= ~m

    def dil(a, k):
        d = a.copy()
        for _ in range(k):
            d = d | np.roll(d, 1, 1) | np.roll(d, -1, 1) | np.vstack([d[1:], d[-1:]]) | np.vstack([d[:1], d[:-1]])
        return d

    # low-frequency parchment noise
    def noise(cells, amp):
        g = np.array([[rng.random() for _ in range(cells * 2 + 1)] for _ in range(cells + 1)], np.float32)
        yi = np.linspace(0, cells, H)
        xi = np.linspace(0, cells * 2, W)
        y0 = np.floor(yi).astype(int).clip(0, cells - 1)
        x0 = np.floor(xi).astype(int).clip(0, cells * 2 - 1)
        fy = (yi - y0)[:, None]
        fx = (xi - x0)[None, :]
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        a = g[y0][:, x0]
        b = g[y0][:, x0 + 1]
        c = g[y0 + 1][:, x0]
        d = g[y0 + 1][:, x0 + 1]
        return ((a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy) * amp

    n = noise(10, 1.0) * 0.6 + noise(40, 1.0) * 0.4
    sea = np.array((0.69, 0.75, 0.66), np.float32)
    img_a = np.empty((H, W, 3), np.float32)
    img_a[:] = sea
    img_a *= (0.92 + 0.12 * n)[..., None]
    # water-lining: fine contour lines echoing the coasts
    prev = land
    for k, alpha in ((4, 0.30), (9, 0.22), (16, 0.14)):
        d = dil(land, k)
        ring = d & ~dil(land, k - 1)
        img_a[ring] = img_a[ring] * (1 - alpha) + np.array((0.36, 0.45, 0.40)) * alpha
        prev = d
    shade = (0.9 + 0.12 * n)[..., None]
    img_a[land] = (wash * shade)[land]
    # inland edge tint (darker wash toward the coast, like a hand-coloured border)
    inner = land & ~(dil(~land, 5))
    edge = land & ~inner
    img_a[edge] *= 0.9
    # graticule every 15 degrees, equator, tropics and polar circles
    lines = np.zeros((H, W), bool)
    for k in range(25):
        c = int(round(k * W / 24)) % W
        lines[:, c] = True
    for k in range(13):
        r = min(H - 1, int(round(k * H / 12)))
        lines[r, :] = True
    img_a[lines] = img_a[lines] * 0.72 + np.array((0.42, 0.30, 0.2)) * 0.28
    eq = H // 2
    img_a[eq - 1:eq + 2, :] = img_a[eq - 1:eq + 2, :] * 0.35 + np.array((0.58, 0.22, 0.15)) * 0.65
    dash = (np.arange(W) // 10) % 2 == 0
    for la in (23.44, -23.44, 66.56, -66.56):
        r = int(round((90 - la) / 180 * H))
        img_a[r, dash] = img_a[r, dash] * 0.4 + np.array((0.6, 0.28, 0.18)) * 0.6
    # sepia coastline
    coast = dil(land, 1) & ~land | (land & dil(~land, 1))
    img_a[coast] = img_a[coast] * 0.25 + np.array((0.30, 0.19, 0.11)) * 0.75
    # age: gentle darkening toward the poles and fine speckle
    age = 1.0 - 0.08 * (np.abs(LAT) / 90.0) ** 2
    img_a *= age[..., None]
    img_a = np.clip(img_a, 0, 1)
    rgba = np.ones((H, W, 4), np.float32)
    rgba[..., :3] = img_a
    rgba = np.flipud(rgba)
    img = bpy.data.images.new("OVR_WorldMap", W, H, alpha=False)
    img.pixels.foreach_set(rgba.ravel())
    img.update()
    img.pack()
    return img


def _map_mat(key):
    m = mat(key)
    if not m.get("ovr_map"):
        nt = m.node_tree
        bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = _world_map_image()
        node.location = (-600, 300)
        nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
        m["ovr_map"] = True
    return m


# ---------------------------------------------------------------------------
# Floor globe
# ---------------------------------------------------------------------------

GLOBE_ZC = 0.925       # globe centre = top of the horizon band
GLOBE_R = 0.27
MER_IN, MER_OUT, MER_T = 0.281, 0.297, 0.009
TILT = 23.44
FRONT_LON = -25.0      # longitude that faces the viewer (-Y): the Atlantic, Europe and Africa


def _globe_sphere(name, S=52, R=26):
    _map_mat("globe_map")
    mb = MB()
    rings = []
    for j in range(1, R):
        la = -math.pi / 2 + math.pi * j / R
        ring = []
        for i in range(S):
            lo = -math.pi + math.tau * i / S
            ring.append(mb.v((GLOBE_R * math.cos(la) * math.cos(lo), GLOBE_R * math.cos(la) * math.sin(lo),
                              GLOBE_R * math.sin(la))))
        rings.append(ring)
    sp = mb.v((0, 0, -GLOBE_R))
    np_ = mb.v((0, 0, GLOBE_R))
    for j in range(R - 2):
        a, b = rings[j], rings[j + 1]
        for i in range(S):
            k = (i + 1) % S
            mb.face((a[i], a[k], b[k], b[i]), "globe_map",
                    [(i / S, (j + 1) / R), ((i + 1) / S, (j + 1) / R), ((i + 1) / S, (j + 2) / R), (i / S, (j + 2) / R)])
    for i in range(S):
        k = (i + 1) % S
        mb.face((sp, rings[0][k], rings[0][i]), "globe_map", [((i + 0.5) / S, 0.0), ((i + 1) / S, 1 / R), (i / S, 1 / R)])
        mb.face((rings[-1][i], rings[-1][k], np_), "globe_map",
                [(i / S, (R - 1) / R), ((i + 1) / S, (R - 1) / R), ((i + 0.5) / S, 1.0)])
    ob = mb.build(name, 0)
    spin = math.radians(-90.0 - FRONT_LON)
    C.transform_mesh(ob, Matrix.Translation((0, 0, GLOBE_ZC)) @ Matrix.Rotation(math.radians(TILT), 4, "Y")
                     @ Matrix.Rotation(spin, 4, "Z"))
    return ob


def build_globe_floor(item=None):
    w = "walnut"
    parts = [_globe_sphere("globe_sphere")]
    zc = GLOBE_ZC
    axis = Matrix.Rotation(math.radians(TILT), 3, "Y") @ Vector((0, 0, 1))
    # brass meridian ring (in the XZ plane, framing the globe from the front), chamfered section
    c = 0.0015
    prof = [(MER_IN + c, -MER_T / 2), (MER_OUT - c, -MER_T / 2), (MER_OUT, -MER_T / 2 + c), (MER_OUT, MER_T / 2 - c),
            (MER_OUT - c, MER_T / 2), (MER_IN + c, MER_T / 2), (MER_IN, MER_T / 2 - c), (MER_IN, -MER_T / 2 + c),
            (MER_IN + c, -MER_T / 2)]
    mer = C.lathe("meridian", prof, 64, mat("brass"), cap_bottom=False, cap_top=False, smooth_angle=30)
    C.transform_mesh(mer, Matrix.Translation((0, 0, zc)) @ Matrix.Rotation(HALF_PI, 4, "X"))
    C.uv_box(mer, tex("brass"))
    parts.append(mer)
    # polar pins and the hour circle at the north pole
    for sgn in (1, -1):
        a0 = axis * sgn * (GLOBE_R - 0.004)
        a1 = axis * sgn * (MER_OUT + 0.0006)
        pin = C.cylinder("pin", 0.004, 0.004, (a1 - a0).length, ((a0 + a1) / 2) + Vector((0, 0, zc)), mat("brass"), 12,
                         rot=Matrix.Rotation(math.radians(TILT), 3, "Y"))
        parts.append(pin)
    hc = axis * (MER_OUT + 0.0004) + Vector((0, 0, zc))
    dial = C.lathe("hour_dial", [(0.0, 0.0), (0.03, 0.0), (0.032, 0.0015), (0.032, 0.003), (0.029, 0.0042),
                                 (0.012, 0.0048), (0.006, 0.0075), (0.006, 0.012), (0.0035, 0.016), (0.0, 0.017)], 28,
                   mat("brass"), cap_bottom=True, cap_top=False, smooth_angle=40)
    C.transform_mesh(dial, Matrix.Translation(hc) @ Matrix.Rotation(math.radians(TILT), 4, "Y"))
    C.uv_box(dial, tex("brass"))
    parts.append(dial)
    # horizon band: walnut ring with moulded edges and a printed paper calendar ring on top
    band = [(0.307, zc - 0.034), (0.372, zc - 0.034), (0.380, zc - 0.028), (0.383, zc - 0.020), (0.378, zc - 0.014),
            (0.383, zc - 0.008), (0.381, zc - 0.002), (0.376, zc), (0.312, zc), (0.307, zc - 0.004), (0.307, zc - 0.034)]
    hb = C.lathe("horizon", band, 72, mat(w), cap_bottom=False, cap_top=False, smooth_angle=35)
    _uv_ring(hb, tex(w))
    parts.append(hb)
    paper = C.lathe("horizon_paper", [(0.37, zc + 0.0006), (0.316, zc + 0.0006)], 72, mat("label_card"), cap_bottom=False,
                    cap_top=False)
    parts.append(paper)
    for r0 in (0.322, 0.36):
        ln = C.lathe("horizon_rule", [(r0 + 0.0012, zc + 0.0009), (r0, zc + 0.0009)], 48, mat("label_ink"),
                     cap_bottom=False, cap_top=False)
        parts.append(ln)
    ticks = []
    for k in range(48):   # calendar ticks between the rules
        a = math.tau * k / 48
        d = Vector((math.cos(a), math.sin(a)))
        nn = Vector((-d.y, d.x)) * 0.0007
        r0, r1 = (0.3235, 0.336) if k % 4 else (0.3235, 0.3465)
        ticks.append([tuple(d * r0 - nn), tuple(d * r1 - nn), tuple(d * r1 + nn), tuple(d * r0 + nn)])
    tk = flat("horizon_ticks", ticks, "label_ink", 0.0, plane="xy", offset=(0, 0, zc + 0.0009))
    parts.append(tk)
    # four turned legs on bun feet
    leg_r = 0.343
    top = zc - 0.034
    lp = [(0.024, 0.052), (0.029, 0.06), (0.029, 0.232), (0.025, 0.238), (0.019, 0.252), (0.024, 0.262), (0.019, 0.272),
          (0.022, 0.40), (0.03, 0.49), (0.026, 0.55), (0.015, 0.612), (0.022, 0.625), (0.016, 0.638), (0.019, 0.77),
          (0.026, 0.84), (0.023, 0.85), (0.031, 0.868), (0.031, top - 0.004), (0.028, top)]
    leg = C.lathe("leg", lp, 14, mat(w), smooth_angle=55)
    _uv_turned(leg, tex(w))
    foot = C.lathe("foot", [(0.0, 0.0), (0.022, 0.0), (0.032, 0.012), (0.035, 0.026), (0.031, 0.042), (0.024, 0.052)],
                   14, mat(w), cap_top=False, smooth_angle=60)
    _uv_turned(foot, tex(w))
    for k in range(4):
        a = math.radians(45 + 90 * k)
        off = Matrix.Translation((leg_r * math.cos(a), leg_r * math.sin(a), 0))
        for src in (leg, foot):
            cp = src.copy()
            cp.data = src.data.copy()
            C.link(cp)
            C.transform_mesh(cp, off)
            parts.append(cp)
    C.remove(leg)
    C.remove(foot)
    # X stretcher: four rails from a central turned hub to the legs' square-turned blocks
    zr = 0.19
    for k in range(4):
        a = math.radians(45 + 90 * k)
        rail = _bx("rail", (0.04, -0.013, zr - 0.02), (leg_r - 0.022, 0.013, zr + 0.02), w, 0.004, 1, "x")
        C.transform_mesh(rail, Matrix.Rotation(a, 4, "Z"))
        parts.append(rail)
    hub = [(0.0, 0.078), (0.012, 0.08), (0.02, 0.092), (0.018, 0.106), (0.03, 0.124), (0.046, 0.14), (0.05, 0.152),
           (0.05, 0.228), (0.044, 0.236), (0.036, 0.242), (0.03, 0.25)]
    parts.append(_lathe("hub", hub, w, 16, caps=(False, True)))
    # central column carrying the meridian in a brass cradle
    cz = zc - MER_OUT - 0.001
    col = [(0.03, 0.25), (0.034, 0.262), (0.025, 0.276), (0.021, 0.30), (0.026, 0.36), (0.031, 0.42), (0.027, 0.47),
           (0.019, 0.50), (0.016, 0.53), (0.022, 0.545), (0.017, 0.556), (0.017, cz - 0.055), (0.024, cz - 0.045)]
    parts.append(_lathe("column", col, w, 16, caps=(False, True)))
    cradle = [(0.024, cz - 0.045), (0.026, cz - 0.04), (0.02, cz - 0.03), (0.014, cz - 0.016), (0.016, cz - 0.006),
              (0.02, cz - 0.002), (0.02, cz), (0.0, cz)]
    cr = C.lathe("cradle", cradle, 16, mat("brass"), cap_bottom=False, cap_top=False)
    C.uv_box(cr, tex("brass"))
    parts.append(cr)
    ob = _join(parts, "Furniture_Globe_Floor_01")
    return ob


# ---------------------------------------------------------------------------
# Signage: text, pictograms, boards
# ---------------------------------------------------------------------------

_FONT_CACHE = {}
_CAP = {}


def _font(kind):
    if kind in _FONT_CACHE:
        return _FONT_CACHE[kind]
    f = None
    for p in FONTS[kind]:
        if os.path.exists(p):
            try:
                f = bpy.data.fonts.load(p, check_existing=True)
                break
            except Exception:  # noqa: BLE001
                f = None
    _FONT_CACHE[kind] = f
    return f


def _text_mesh(body, size, kind="serif", spacing=1.0, res=2, extrude=0.0):
    cu = bpy.data.curves.new("txt", "FONT")
    cu.body = body
    cu.size = size
    f = _font(kind)
    if f is not None:
        cu.font = f
    cu.resolution_u = res
    cu.space_character = spacing
    cu.extrude = extrude
    ob = bpy.data.objects.new("txt", cu)
    scr = bpy.data.scenes.get("OVR_TextScratch") or bpy.data.scenes.new("OVR_TextScratch")
    scr.collection.objects.link(ob)
    try:
        dg = scr.view_layers[0].depsgraph
        dg.update()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    except Exception:  # noqa: BLE001
        bpy.context.scene.collection.objects.link(ob)
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob, do_unlink=True)
    bpy.data.curves.remove(cu)
    return me


def _cap(kind):
    if kind not in _CAP:
        me = _text_mesh("H", 1.0, kind)
        zs = [v.co.y for v in me.vertices]
        _CAP[kind] = max(zs) - min(zs)
        bpy.data.meshes.remove(me)
    return _CAP[kind]


def text(name, body, cap_h, key, center, y, kind="serif", spacing=1.0, res=2, extrude=0.0, align="center"):
    """Lettering in the XZ plane facing -Y: cap height `cap_h`, cap-centred on `center` (x, z),
    front face at `y`. Returns (object, width)."""
    size = cap_h / _cap(kind)
    me = _text_mesh(body, size, kind, spacing, res, extrude)
    xs = [v.co.x for v in me.vertices]
    x0, x1 = min(xs), max(xs)
    width = x1 - x0
    cx, cz = center
    dx = cx - (x0 + x1) / 2 if align == "center" else (cx - x0 if align == "left" else cx - x1)
    # rotate (x, y, z) -> (x, -z, y): the glyphs face -Y, their up is +Z
    me.transform(Matrix.Translation((dx, cz - cap_h / 2, 0)))
    me.transform(Matrix.Rotation(HALF_PI, 4, "X"))
    me.transform(Matrix.Translation((0, y - (extrude if extrude else 0.0), 0)))
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.normal_update()
    if extrude:
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.y > 0.9], context="FACES")
    # Font curves are subdivided evenly, straight stems included: dissolve the collinear outline
    # points and re-fill with a beauty triangulation (the chord error of a 5 deg limit is ~0.1 mm on 8 cm capitals).
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(5.0), verts=bm.verts, edges=bm.edges)
    bmesh.ops.triangulate(bm, faces=bm.faces, quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    me.materials.append(mat(key))
    for p in me.polygons:
        p.use_smooth = False
    return ob, width


def text_width(body, cap_h, kind="serif", spacing=1.0):
    size = cap_h / _cap(kind)
    me = _text_mesh(body, size, kind, spacing)
    xs = [v.co.x for v in me.vertices]
    bpy.data.meshes.remove(me)
    return (max(xs) - min(xs)) if xs else 0.0


# 2D pictogram geometry (unit box ~[-0.5, 0.5] x [0, 1]) --------------------------------------

def _circle(cx, cy, r, n=20):
    return [(cx + r * math.cos(math.tau * i / n), cy + r * math.sin(math.tau * i / n)) for i in range(n)]


def _rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _stroke(pts, w, caps=True):
    """Polyline -> closed outline of width w with mitred joints and rounded ends."""
    pts = [Vector((p[0], p[1])) for p in pts]
    n = len(pts)
    left, right = [], []
    for i in range(n):
        d0 = (pts[i] - pts[i - 1]).normalized() if i > 0 else (pts[1] - pts[0]).normalized()
        d1 = (pts[i + 1] - pts[i]).normalized() if i < n - 1 else d0
        t = (d0 + d1)
        t = t.normalized() if t.length > 1e-6 else d1
        nrm = Vector((-t.y, t.x))
        n0 = Vector((-d0.y, d0.x))
        m = 1.0 / max(0.35, nrm.dot(n0))
        left.append(pts[i] + nrm * w / 2 * m)
        right.append(pts[i] - nrm * w / 2 * m)
    out = list(left)
    if caps:
        d = (pts[-1] - pts[-2]).normalized()
        nn = Vector((-d.y, d.x))
        for k in range(1, 4):
            a = math.pi * k / 4
            out.append(pts[-1] + nn * (w / 2) * math.cos(a) + d * (w / 2) * math.sin(a))
    out += list(reversed(right))
    if caps:
        d = (pts[0] - pts[1]).normalized()
        nn = Vector((-d.y, d.x))
        for k in range(1, 4):
            a = math.pi * k / 4
            out.append(pts[0] + nn * (w / 2) * math.cos(a) + d * (w / 2) * math.sin(a))
    return [(p.x, p.y) for p in out]


def _stroke_ring(pts, w):
    """A closed polyline (first point repeated last) as mitred quads of width w (a ring outline
    filled as one polygon would cover its whole interior)."""
    q = [Vector((p[0], p[1])) for p in pts[:-1]]
    n = len(q)
    L, Rr = [], []
    for i in range(n):
        d0 = (q[i] - q[i - 1]).normalized()
        d1 = (q[(i + 1) % n] - q[i]).normalized()
        t = d0 + d1
        t = t.normalized() if t.length > 1e-6 else d1
        nrm = Vector((-t.y, t.x))
        m = 1.0 / max(0.35, nrm.dot(Vector((-d0.y, d0.x))))
        L.append(q[i] + nrm * w / 2 * m)
        Rr.append(q[i] - nrm * w / 2 * m)
    return [[tuple(L[i]), tuple(L[(i + 1) % n]), tuple(Rr[(i + 1) % n]), tuple(Rr[i])] for i in range(n)]


def _ring_arc(cx, cy, r0, r1, a0, a1, n=24):
    outer = [(cx + r1 * math.cos(a0 + (a1 - a0) * i / n), cy + r1 * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    inner = [(cx + r0 * math.cos(a0 + (a1 - a0) * i / n), cy + r0 * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]
    return outer + list(reversed(inner))


def _rounded_rect_path(x0, x1, y0, y1, r, n=3):
    pts = []
    for cx, cy, a0 in ((x1 - r, y0 + r, -HALF_PI), (x1 - r, y1 - r, 0.0), (x0 + r, y1 - r, HALF_PI), (x0 + r, y0 + r, math.pi)):
        for k in range(n + 1):
            a = a0 + HALF_PI * k / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def _arrow(angle_deg=0.0, cx=0.0, cy=0.5, s=1.0):
    pts = [(-0.5, -0.085), (0.06, -0.085), (0.06, -0.27), (0.5, 0.0), (0.06, 0.27), (0.06, 0.085), (-0.5, 0.085)]
    a = math.radians(angle_deg)
    return [[(cx + s * (x * math.cos(a) - y * math.sin(a)), cy + s * (x * math.sin(a) + y * math.cos(a))) for x, y in pts]]


def picto_man():
    body = [(-0.20, 0.37), (-0.20, 0.64), (-0.17, 0.69), (-0.12, 0.712), (0.12, 0.712), (0.17, 0.69), (0.20, 0.64),
            (0.20, 0.37), (0.152, 0.37), (0.152, 0.60), (0.13, 0.60), (0.13, 0.0), (0.024, 0.0), (0.024, 0.33),
            (-0.024, 0.33), (-0.024, 0.0), (-0.13, 0.0), (-0.13, 0.60), (-0.152, 0.60), (-0.152, 0.37)]
    return [_circle(0, 0.875, 0.092), body]


def picto_woman():
    upper = [(-0.215, 0.45), (-0.215, 0.64), (-0.18, 0.69), (-0.12, 0.712), (0.12, 0.712), (0.18, 0.69), (0.215, 0.64),
             (0.215, 0.45), (0.17, 0.45), (0.17, 0.62), (-0.17, 0.62), (-0.17, 0.45)]
    dress = [(-0.105, 0.63), (0.105, 0.63), (0.215, 0.22), (-0.215, 0.22)]
    return [_circle(0, 0.875, 0.092), upper, dress, _rect(-0.09, -0.03, 0.0, 0.24), _rect(0.03, 0.09, 0.0, 0.24)]


def picto_accessible():
    return [_circle(0.02, 0.885, 0.085),
            _stroke([(0.0, 0.75), (-0.03, 0.47), (0.25, 0.47), (0.33, 0.17), (0.44, 0.17)], 0.085),
            _stroke([(-0.01, 0.645), (0.2, 0.645)], 0.07),
            _ring_arc(-0.06, 0.32, 0.235, 0.3, math.radians(100), math.radians(380), 30)]


def picto_running():
    w = 0.085
    return [_circle(0.12, 0.865, 0.082),
            _stroke([(0.08, 0.72), (-0.05, 0.45)], w + 0.015),
            _stroke([(0.07, 0.68), (0.22, 0.6), (0.31, 0.7)], w),
            _stroke([(0.06, 0.68), (-0.1, 0.63), (-0.19, 0.52)], w),
            _stroke([(-0.05, 0.45), (0.12, 0.33), (0.1, 0.1), (0.19, 0.08)], w),
            _stroke([(-0.05, 0.45), (-0.14, 0.26), (-0.34, 0.22)], w),
            _stroke([(0.42, 0.0), (0.42, 0.96), (0.74, 0.96), (0.74, 0.0)], 0.06, caps=False)]


def picto_lift():
    border = _rounded_rect_path(-0.36, 0.36, 0.0, 1.0, 0.09)
    border.append(border[0])
    return [*_stroke_ring(border, 0.06),
            [(-0.19, 0.56), (0.19, 0.56), (0.0, 0.84)], [(-0.19, 0.44), (0.19, 0.44), (0.0, 0.16)]]


def picto_stairs():
    return [_stroke([(-0.5, 0.06), (-0.24, 0.06), (-0.24, 0.28), (0.02, 0.28), (0.02, 0.5), (0.28, 0.5), (0.28, 0.72),
                     (0.5, 0.72)], 0.07, caps=False),
            *_arrow(40, -0.24, 0.76, 0.36)]


def picto_printer():
    sheet = _stroke([(-0.2, 0.62), (-0.2, 0.95), (0.2, 0.95), (0.2, 0.62)], 0.05, caps=False)
    body = [(-0.42, 0.24), (0.42, 0.24), (0.42, 0.64), (0.36, 0.7), (-0.36, 0.7), (-0.42, 0.64)]
    tray = _stroke([(-0.24, 0.3), (-0.24, 0.04), (0.24, 0.04), (0.24, 0.3)], 0.05, caps=False)
    return [sheet, body, tray]


def picto_book():
    pages = []
    for s in (-1, 1):
        outline = [(s * 0.03, 0.14), (s * 0.18, 0.2), (s * 0.5, 0.17), (s * 0.5, 0.80), (s * 0.3, 0.86), (s * 0.12, 0.84),
                   (s * 0.03, 0.76), (s * 0.03, 0.14)]
        if s < 0:
            outline = list(reversed(outline))
        pages += _stroke_ring(outline, 0.05)
        for k in range(3):
            y = 0.36 + 0.13 * k
            pages.append(_stroke([(s * 0.12, y + 0.02), (s * 0.4, y)], 0.03))
    return pages


def picto_diamond():
    return [[(0, 0.3), (0.2, 0.5), (0, 0.7), (-0.2, 0.5)]]


def flat(name, polys, key, y, plane="xz", offset=(0, 0, 0), up=False):
    """Flat 2D polygons as one mesh: plane "xz" (facing -Y at depth y; each polygon a hair in
    front of the previous so overlaps never z-fight) or "xy" (facing +Z, lying at offset z)."""
    mb = MB()
    ox, oy, oz = offset
    for i, poly in enumerate(polys):
        if plane == "xz":
            yy = y - 0.00008 * i
            vs = [mb.v((ox + px, oy + yy, oz + py)) for px, py in poly]
        else:
            vs = [mb.v((ox + px, oy + py, oz + 0.00008 * i)) for px, py in poly]
        mb.face(vs, key, smooth=False)
    bmesh.ops.triangulate(mb.bm, faces=mb.bm.faces[:], quad_method="BEAUTY", ngon_method="EAR_CLIP")
    for f in mb.bm.faces:
        f.normal_update()
        if (plane == "xz" and f.normal.y > 0) or (plane == "xy" and f.normal.z < 0):
            f.normal_flip()
    return mb.build(name, 0)


def picto(name, polys, h, center, key, y):
    """Flat pictogram (unit-box polygons scaled to height h, box centred at `center` (x, z))
    facing -Y at depth y."""
    cx, cz = center
    return flat(name, [[(cx + px * h, cz + (py - 0.5) * h) for px, py in poly] for poly in polys], key, y)


def _turn_back(ob):
    """Mirrors flat front-facing lettering to the back face of a double-sided board."""
    C.transform_mesh(ob, Matrix.Rotation(math.pi, 4, "Z"))
    return ob


# Boards ----------------------------------------------------------------------------------------

FRAME_W = 0.017


def _frame_profile(t, double=False):
    """Wrapped brass frame: a rounded bead over the board edge (u outward, v toward the viewer
    from the board's front face; for a double board v from its centre plane)."""
    front = [(0.0035, 0.002), (0.0015, 0.0055), (-0.003, 0.0072), (-0.008, 0.0068), (-0.012, 0.0052),
             (-0.0155, 0.0026), (-0.017, 0.0004)]
    if not double:
        return list(reversed([(u, v) for u, v in front])) + [(0.0035, -t)]
    h = t / 2
    f = [(u, v + h) for u, v in front]
    b = [(u, -v - h) for u, v in front]
    return list(reversed(f)) + b


def board(name, w, h, t=0.018, double=False, key="signage", frame_key="brass", rule=True, radius=0.0):
    """A sign board w x h: green panel, wrapped brass frame, fine gilt inner rule. Wall boards
    have their back on y = 0 (front -Y); double boards are centred on y = 0."""
    parts = []
    y0, y1 = (-t / 2, t / 2) if double else (-t, 0.0)
    parts.append(_bx(name + "_Panel", (-w / 2 + 0.002, y0, -h / 2 + 0.002), (w / 2 - 0.002, y1, h / 2 - 0.002), key, 0.0015,
                     1, None))
    path = [(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)]
    if not double:
        path = [(x, -t, z) for x, _, z in path]
    fr = C.sweep(name + "_Frame", _frame_profile(t, double), path, mat(frame_key), closed_path=True, cap=False,
                 up=(0, -1, 0), smooth_angle=40)
    C.uv_box(fr, tex(frame_key))
    parts.append(fr)
    if rule:
        ins = FRAME_W + 0.014
        rw = 0.0028
        rpath = _rounded_rect_path(-w / 2 + ins, w / 2 - ins, -h / 2 + ins, h / 2 - ins, 0.012, 2)
        rpath.append(rpath[0])
        quads = _stroke_ring(rpath, rw)
        for side in ((1,) if not double else (1, -1)):
            ob = flat(name + "_Rule", quads, "signage_text", y0 - 0.0003)
            if side < 0:
                _turn_back(ob)
            parts.append(ob)
    return parts


def _face_y(t, double):
    return (-t / 2 if double else -t) - 0.0004


def _line_width(body, cap):
    parts = [p.strip() for p in body.split("\u00b7")]
    return sum(text_width(p, cap) for p in parts) + (len(parts) - 1) * cap * 1.3


def _text_line(name, body, cap, key, x_left, z, y):
    """One line of lettering from x_left; a " · " becomes a small diamond with even spacing."""
    out = []
    parts = [p.strip() for p in body.split("\u00b7")]
    x = x_left
    for i, ptxt in enumerate(parts):
        if i:
            out.append(picto(f"{name}_Sep", picto_diamond(), cap * 0.55, (x + cap * 0.65, z), key, y))
            x += cap * 1.3
        tob, tw = text(f"{name}_{i}", ptxt, cap, key, (x, z), y, align="left")
        out.append(tob)
        x += tw
    return out


def build_sign_zone(text_s, picto_fn=None, arrow=None, h=0.30, max_w=1.5, min_w=0.9, cap=0.078, name=None):
    """Zone sign: Baskerville name, optional pictogram (left) and arrow (right)."""
    name = name or "Sign_Zone"
    t = 0.018
    yf = _face_y(t, False)
    tw = _line_width(text_s, cap)
    ph = h * 0.52
    pw = ph * {"wc": 1.1, picto_stairs: 1.0}.get(picto_fn, 0.85) if picto_fn else 0.0
    aw = ph * 0.9 if arrow is not None else 0.0
    inner = tw + (pw + 0.06 if pw else 0) + (aw + 0.06 if aw else 0)
    w = min(max_w, max(min_w, inner + 0.2))
    if inner + 0.2 > max_w:   # scale the text down to fit
        k = (max_w - 0.2 - (inner - tw)) / tw
        cap *= k
        tw *= k
        inner = tw + (pw + 0.06 if pw else 0) + (aw + 0.06 if aw else 0)
    parts = board(name, w, h, t)
    x = -inner / 2
    if picto_fn:
        if picto_fn == "wc":
            parts.append(picto(name + "_PicM", picto_man(), ph, (x + ph * 0.25, 0), "signage_text", yf))
            parts.append(picto(name + "_PicW", picto_woman(), ph, (x + ph * 0.8, 0), "signage_text", yf))
            div = picto(name + "_Div", [_rect(-0.006, 0.006, 0.08, 0.92)], ph, (x + ph * 0.525, 0), "signage_text", yf)
            parts.append(div)
        else:
            parts.append(picto(name + "_Pic", picto_fn(), ph, (x + pw / 2, 0), "signage_text", yf))
        x += pw + 0.06
    parts += _text_line(name + "_Text", text_s, cap, "signage_text", x, 0.0, yf)
    x += tw + 0.06
    if arrow is not None:
        parts.append(picto(name + "_Arrow", _arrow(arrow, 0, 0.5, 1.0), aw, (x + aw / 2, 0), "signage_text", yf))
    ob = _join(parts, name)
    ob["sign_w"], ob["sign_h"] = w, h
    return ob


def build_sign_hanging(front, back, w=1.3, h=0.3, drop=0.4, rod_x=0.45, cap=0.075, name=None, ceiling_plate=False):
    """Double-sided board hung on two brass rods (drop = rod length above the board's top edge).
    Board centre at the origin; front text faces -Y, back text faces +Y."""
    name = name or "Sign_Hanging"
    t = 0.024
    parts = board(name, w, h, t, double=True)
    yf = _face_y(t, True)
    for body, back_side in ((front, False), (back, True)):
        c = cap
        tw = text_width(body, c)
        if tw > w - 0.2:
            c *= (w - 0.2) / tw
        tob, _ = text(name + ("_TextB" if back_side else "_TextF"), body, c, "signage_text", (0, 0), yf)
        if back_side:
            _turn_back(tob)
        parts.append(tob)
    top = h / 2
    for sx in (-1, 1):
        x = sx * rod_x
        eye = C.torus(name + "_Eye", 0.012, 0.0035, (x, 0, top + 0.012), mat("brass"), 8, 4, rot=C.rotx(90))
        rod = C.cylinder(name + "_Rod", 0.0042, 0.0042, drop - 0.03, (x, 0, top + 0.024 + (drop - 0.03) / 2), mat("brass"), 6)
        lug = _bx(name + "_Lug", (x - 0.007, -0.0045, top - 0.002), (x + 0.007, 0.0045, top + 0.016), "brass", 0.002, 1)
        collar = C.lathe(name + "_Collar", [(0.0, top + drop - 0.012), (0.009, top + drop - 0.012), (0.012, top + drop - 0.006),
                                            (0.016, top + drop), (0.0, top + drop)], 8, mat("brass"), cap_bottom=False,
                         cap_top=True)
        C.transform_mesh(collar, Matrix.Translation((x, 0, 0)))
        for o in (eye, rod, collar):
            C.uv_box(o, tex("brass"))
        parts += [eye, rod, lug, collar]
        if ceiling_plate:
            pl = C.lathe(name + "_Rose", [(0.0, top + drop - 0.006), (0.03, top + drop - 0.006), (0.034, top + drop - 0.003),
                                          (0.034, top + drop)], 20, mat("brass"), cap_bottom=True, cap_top=False)
            C.transform_mesh(pl, Matrix.Translation((x, 0, 0)))
            parts.append(pl)
    ob = _join(parts, name)
    ob["sign_w"], ob["sign_h"] = w, h
    return ob


def build_sign_plaque(lines, picto_fn=None, w=0.22, h=0.30, name=None):
    """Door plaque: pictogram over one or two lines of text."""
    name = name or "Sign_Plaque"
    t = 0.014
    yf = _face_y(t, False)
    parts = board(name, w, h, t)
    top_in, bot_in = h / 2 - 0.044, -h / 2 + 0.044
    if picto_fn:
        ph = 0.118
        cz = top_in - ph / 2
        if picto_fn == "wc_w":
            parts.append(picto(name + "_Pic", picto_woman(), ph, (0, cz), "signage_text", yf))
        elif picto_fn == "wc_m":
            parts.append(picto(name + "_Pic", picto_man(), ph, (0, cz), "signage_text", yf))
        else:
            parts.append(picto(name + "_Pic", picto_fn(), ph, (0, cz), "signage_text", yf))
        mid = ((cz - ph / 2) + bot_in) / 2
    else:
        mid = 0.0
    cap, lead = 0.0225, 0.038
    zt = mid + lead * (len(lines) - 1) / 2
    for i, ln in enumerate(lines):
        c = cap
        tw = text_width(ln, c)
        if tw > w - 0.072:
            c *= (w - 0.072) / tw
        tob, _ = text(f"{name}_T{i}", ln, c, "signage_text", (0, zt - i * lead), yf)
        parts.append(tob)
    ob = _join(parts, name)
    ob["sign_w"], ob["sign_h"] = w, h
    return ob


def _exit_face(name, w, h, y, arrow, flip=False):
    """The lit green face: running man, EXIT, optional arrow (white)."""
    parts = []
    ph, cap, gap = h * 0.74, h * 0.4, 0.025
    tw = text_width("EXIT", cap, "sans", 1.05)
    aw = ph * 0.8 if arrow is not None else 0.0
    total = ph * 1.2 + gap + tw + (gap + aw if aw else 0)
    k = min(1.0, (w - 0.035) / total)
    ph, cap, gap, tw, aw, total = ph * k, cap * k, gap * k, tw * k, aw * k, total * k
    x = -total / 2
    parts.append(picto(name + "_Run", picto_running(), ph, (x + ph * 0.42, 0), "exit_white", y))
    x += ph * 1.2 + gap
    tob, _ = text(name + "_Exit", "EXIT", cap, "exit_white", (x + tw / 2, 0), y, "sans", 1.05)
    parts.append(tob)
    x += tw + gap
    if arrow is not None:
        parts.append(picto(name + "_Arrow", _arrow(arrow, 0, 0.5, 1.0), aw, (x + aw / 2, 0), "exit_white", y))
    if flip:
        for p_ in parts:
            _turn_back(p_)
    return parts


def build_sign_exit(arrow=None, hanging=False, drop=0.5, back_arrow=None, name=None):
    """Illuminated EXIT box (opal housing, green face, white running man + EXIT + arrow).
    Flush: back on y = 0. Hanging: double-faced, centred, rods + ceiling roses `drop` above."""
    name = name or "Sign_Exit"
    w, h = 0.44, 0.19
    d = 0.05 if not hanging else 0.06
    parts = []
    y0, y1 = (-d / 2, d / 2) if hanging else (-d, 0.0)
    parts.append(_bx(name + "_Box", (-w / 2, y0, -h / 2), (w / 2, y1, h / 2), "plastic_light", 0.008, 3))
    fw, fh = w - 0.03, h - 0.03
    for side in ((1,) if not hanging else (1, -1)):
        yy = y0 if side > 0 else y1
        face = _bx(name + "_Face", (-fw / 2, yy - 0.002 if side > 0 else yy - 0.0002, -fh / 2),
                   (fw / 2, yy + 0.0002 if side > 0 else yy + 0.002, fh / 2), "exit_green", 0.0008, 1)
        parts.append(face)
        ya = yy - 0.0024 if side > 0 else -(yy + 0.0024)
        fp = _exit_face(name + ("_F" if side > 0 else "_B"), fw, fh, ya, arrow if side > 0 else back_arrow, flip=side < 0)
        parts += fp
    if hanging:
        for sx in (-1, 1):
            x = sx * 0.15
            rod = C.cylinder(name + "_Rod", 0.004, 0.004, drop, (x, 0, h / 2 + drop / 2), mat("chrome"), 10)
            rose = C.lathe(name + "_Rose", [(0.0, h / 2 + drop - 0.006), (0.024, h / 2 + drop - 0.006),
                                            (0.027, h / 2 + drop - 0.003), (0.027, h / 2 + drop)], 18, mat("chrome"),
                           cap_bottom=True, cap_top=False)
            C.transform_mesh(rose, Matrix.Translation((x, 0, 0)))
            parts += [rod, rose]
    ob = _join(parts, name)
    ob["sign_w"], ob["sign_h"] = w, h
    ob["light_points"] = [(0.0, -0.06, 0.0)] if not hanging else [(0.0, -0.06, 0.0), (0.0, 0.06, 0.0)]
    ob["light_color"] = "#18c45a"
    return ob


def build_sign_name(name="Sign_Name_OVRLibrary"):
    """The library's name tablet for the landing fascia: OVR LIBRARY in raised gilt Baskerville
    capitals between two open-book crests, on brass standoffs (they run back +Y to the frieze)."""
    t = 0.022
    h = 0.34
    cap = 0.13
    tw = text_width("OVR  LIBRARY", cap, spacing=1.18)
    crest = 0.25
    w = tw + 2 * (crest + 0.17) + 0.18
    parts = board(name, w, h, t)
    yf = _face_y(t, False)
    tob, _ = text(name + "_Text", "OVR  LIBRARY", cap, "signage_text", (0, 0), yf, spacing=1.18, res=2, extrude=0.002)
    parts.append(tob)
    for sx in (-1, 1):
        x = sx * (tw / 2 + 0.17 + crest / 2)
        parts.append(picto(name + "_Crest", picto_book(), crest * 0.95, (x, -0.005), "signage_text", yf))
        parts.append(picto(name + "_Dot", picto_diamond(), 0.07, (sx * (tw / 2 + 0.085), 0), "signage_text", yf))
    for k in range(4):
        x = (-0.375 + 0.25 * k) * (w - 0.3)
        so = C.cylinder(name + "_Standoff", 0.007, 0.007, 0.072, (x, 0.036, 0.0), mat("brass"), 12, rot=C.rotx(90))
        C.uv_box(so, tex("brass"))
        parts.append(so)
    ob = _join(parts, name)
    ob["sign_w"], ob["sign_h"] = w, h
    return ob


def build_sign_tablet(line1, line2, name="Sign_Zone_Rotunda"):
    """Monumental zone tablet over the rotunda arch: name in large capitals, subline below."""
    t = 0.022
    h = 0.68
    c1, c2 = 0.165, 0.078
    tw = max(text_width(line1.upper(), c1, spacing=1.12), text_width(line2, c2))
    w = tw + 0.42
    parts = board(name, w, h, t)
    yf = _face_y(t, False)
    tob, _ = text(name + "_T1", line1.upper(), c1, "signage_text", (0, 0.08), yf, spacing=1.12, res=2)
    parts.append(tob)
    tob, _ = text(name + "_T2", line2, c2, "signage_text", (0, -0.175), yf, res=2)
    parts.append(tob)
    for sx in (-1, 1):
        parts.append(picto(name + "_Dot", picto_diamond(), 0.075, (sx * (text_width(line2, c2) / 2 + 0.085), -0.175),
                           "signage_text", yf))
    parts.append(flat(name + "_Mid", [_rect(-tw * 0.3, tw * 0.3, -0.068, -0.0635)], "signage_text", yf))
    ob = _join(parts, name)
    ob["sign_w"], ob["sign_h"] = w, h
    return ob


def build_sign_lift(sub="", name="Sign_Lift"):
    t = 0.018
    h = 0.30
    yf = _face_y(t, False)
    cap = 0.075
    tw = text_width("Lift", cap)
    sw = text_width(sub, 0.04) if sub else 0.0
    ph = 0.19
    w = ph * 0.75 + 0.07 + max(tw, sw) + 0.2
    parts = board(name, w, h, t)
    x0 = -(ph * 0.75 + 0.07 + max(tw, sw)) / 2
    parts.append(picto(name + "_Pic", picto_lift(), ph, (x0 + ph * 0.375, 0), "signage_text", yf))
    tx = x0 + ph * 0.75 + 0.07
    tob, _ = text(name + "_T", "Lift", cap, "signage_text", (tx, 0.03 if sub else 0), yf, align="left")
    parts.append(tob)
    if sub:
        tob, _ = text(name + "_S", sub, 0.034, "signage_text", (tx, -0.065), yf, align="left")
        parts.append(tob)
    ob = _join(parts, name)
    ob["sign_w"], ob["sign_h"] = w, h
    return ob


def build_sign_quiet(name="Sign_Quiet"):
    t = 0.014
    w, h = 0.36, 0.16
    yf = _face_y(t, False)
    parts = board(name, w, h, t)
    tob, _ = text(name + "_T", "Quiet please", 0.03, "signage_text", (0, 0.012), yf)
    parts.append(tob)
    for sx in (-1, 0, 1):
        parts.append(picto(name + "_Dot", picto_diamond(), 0.03, (sx * 0.035, -0.04), "signage_text", yf))
    ob = _join(parts, name)
    ob["sign_w"], ob["sign_h"] = w, h
    return ob


# ---------------------------------------------------------------------------
# The plan-driven sign list (web coordinates) and the in-place build
# ---------------------------------------------------------------------------

def _wall(wid):
    return next(w for w in P.WALLS if w.id == wid)


def _opening(wid, oid):
    return next(o for o in _wall(wid).openings if o.id == oid)


def _face(wid, side=None):
    """(axis of the face coordinate, face coordinate, rot facing into the room) for a wall side."""
    w = _wall(wid)
    b = w.bounds
    inside = side or (w.inside if w.inside != "both" else ("east" if w.axis == "z" else "south"))
    if w.axis == "x":
        return ("z", b["maxZ"], 0.0) if inside == "south" else ("z", b["minZ"], math.pi)
    return ("x", b["maxX"], HALF_PI) if inside == "east" else ("x", b["minX"], -HALF_PI)


def _on_wall(wid, at, y, side=None):
    axis, c, rot = _face(wid, side)
    return (at, y, c, rot) if axis == "z" else (c, y, at, rot)


def _mid_wall(wid, at, y):
    w = _wall(wid)
    b = w.bounds
    if w.axis == "x":
        return at, y, (b["minZ"] + b["maxZ"]) / 2
    return (b["minX"] + b["maxX"]) / 2, y, at


def _intrados(o, off):
    r = o.width / 2
    spring = o.spring if o.spring is not None else o.y1 - r
    return spring + math.sqrt(max(0.0, r * r - off * off))


DOOR_ARCHITRAVE = 0.15      # arch_windows door_single architrave width
# Centre of the tablet over the rotunda arch: arch_shell frames a moulded tablet field above the
# keystone (frame rails at z 9.9-10.0 and 11.1-11.2, 5 m wide, 5 cm proud); the sign sits centred in it,
# clear of the keystone cap (9.55) and the rails.
ROTUNDA_TABLET_Y = 10.55


def _sign_specs():
    S = []

    def add(id_, kind, text_, x, y, z, rot, **kw):
        S.append(dict(id=id_, kind=kind, text=text_, x=round(x, 4), y=round(y, 4), z=round(z, 4), rot=round(rot, 6), **kw))

    if getattr(P, "HALL_ONLY", False):
        # Just the reading hall: its only wayfinding is the lift (bookcase subjects and table
        # numbers are part of the furniture).
        for lvl, sub in zip(P.LIFT["levels"], ("to the Gallery", "to the Ground Floor")):
            x, y, z, rot = _on_wall("hall_e", P.LIFT["door_z"], lvl + 3.06)
            add(f"sign-lift-{int(round(lvl * 10)):02d}", "lift", "Lift", x, y, z, rot, sub=sub)
        return S
    # The library's name on the landing fascia, read from the main door
    lr = P.STAIRS["landing_railing"]
    add("sign-name", "name", "OVR LIBRARY", 0.0, 4.245, lr["a"][1] + 0.24, 0.0)
    # Hanging zone signs in the crowns of the two arches off the hall
    for wid, oid, front, back in (("hall_s", "arch_lobby", "Grand Reading Hall", "Entrance Hall"),
                                  ("hall_w", "arch_lounge", "Reading Lounge", "Grand Reading Hall")):
        o = _opening(wid, oid)
        h, rod_x = 0.3, 0.42
        yc = 3.36
        x, y, z = _mid_wall(wid, o.at, yc)
        rot = 0.0 if wid == "hall_s" else HALF_PI     # front faces the lobby (south) / the hall (east)
        drop = _intrados(o, rod_x) + 0.02 - (yc + h / 2)
        add(f"sign-zone-{oid}", "hanging", front, x, y, z, rot, back=back, w=1.3, h=h, drop=round(drop, 4), rod_x=rod_x)
    # Rotunda: monumental tablet over the arch (hall face)
    o = _opening("hall_e", "arch_rotunda")
    x, y, z, rot = _on_wall("hall_e", o.at, ROTUNDA_TABLET_Y)
    add("sign-zone-rotunda", "tablet", "Reference Rotunda", x, y, z, rot, sub="Research Help")
    # Zone signs over doors
    for wid, oid, side, yc, pic in (("hall_s", "door_quiet", None, 3.06, None), ("hall_s", "door_group", None, 3.06, None),
                                    ("hall_n", "door_computers", None, 3.06, None),
                                    ("hall_n", "door_services", None, 3.06, "wc"),
                                    ("lobby_w", "door_lobby_quiet", None, 2.86, None),
                                    ("lobby_e", "door_lobby_group", None, 2.86, None)):
        o = _opening(wid, oid)
        x, y, z, rot = _on_wall(wid, o.at, yc, side)
        add(f"sign-zone-{oid}", "zone", o.label, x, y, z, rot, picto=pic, max_w=1.5 if wid.startswith("hall") else 1.2)
    # Lift signs over both lift doors (hall east wall)
    for lvl, sub in zip(P.LIFT["levels"], ("to the Gallery", "to the Ground Floor")):
        x, y, z, rot = _on_wall("hall_e", P.LIFT["door_z"], lvl + 3.06)
        add(f"sign-lift-{int(round(lvl * 10)):02d}", "lift", "Lift", x, y, z, rot, sub=sub)
    # Stairs to the gallery: at the foot of both flights, on the lobby side walls
    for wid in ("lobby_w", "lobby_e"):
        fl = P.FLIGHTS[0]["bottom"]
        x, y, z, rot = _on_wall(wid, fl + 0.36, 2.15)
        add(f"sign-stairs-{wid[-1]}", "stairs", "Stairs to Gallery", x, y, z, rot)
    # Door plaques at 1.5 m on the latch side of every labelled single door
    pics = {"door_wc_women": ("wc_w", ["Women"]), "door_wc_men": ("wc_m", ["Men"]),
            "door_wc_accessible": ("accessible", ["Accessible", "Washroom"]),
            "door_print_room": ("printer", ["Print & Copy", "Room"]), "door_staff": (None, ["Staff", "Only"]),
            "door_storage": (None, ["Storage"])}
    for wid in ("north_n", "north_partition"):
        w = _wall(wid)
        ops = sorted([o for o in w.openings if o.id in pics], key=lambda o: o.at)
        axis, c, rot = _face(wid)
        sgn = 1 if rot == 0.0 else -1       # latch side: local +x -> web +x (rot 0) / web -z (rot pi/2)
        b = w.bounds
        for o in ops:
            edge = o.at + sgn * (o.width / 2 - 0.02 + DOOR_ARCHITRAVE)
            nxt = [p.at - sgn * (p.width / 2 - 0.02 + DOOR_ARCHITRAVE) for p in ops if sgn * (p.at - o.at) > 0]
            limit = (min(nxt) if nxt else (P.SERVICES["maxX"] if wid == "north_n" else P.SERVICES["minZ"])) if sgn > 0 else \
                (max(nxt) if nxt else P.SERVICES["minZ"])
            gap = abs(limit - edge)
            at = edge + sgn * min(0.27, gap / 2)
            x, y, z, r = _on_wall(wid, at, 1.5)
            pic, lines = pics[o.id]
            add(f"sign-plaque-{o.id[5:]}", "plaque", o.label, x, y, z, r, picto=pic, lines=lines)
    # EXIT: over both exits (skipped where the door already carries its own lit sign) and on the routes
    o = _opening("north_e", "door_exit_north")
    x, y, z, rot = _on_wall("north_e", o.at, o.y1 + 0.33)
    add("sign-exit-north", "exit", "EXIT", x, y, z, rot, arrow=None, optional=True)
    bay = P.ROTUNDA["bays"][0]
    bx, bz = bay["center"]
    add("sign-exit-rotunda", "exit", "EXIT", bx, P.ROTUNDA["exit"]["height"] + 0.33, bz, bay["rot"], arrow=None, optional=True)
    o = _opening("hall_n", "door_services")
    x, y, z, rot = _on_wall("hall_n", o.at, 3.47)
    add("sign-exit-route-hall", "exit", "EXIT", x, y, z, rot, arrow=90)
    add("sign-exit-route-services", "exit_hanging", "EXIT", 10.0, 2.62, -13.5, -HALF_PI, arrow=90,
        drop=round(P.WING_CEILING - (2.62 + 0.095), 4))
    # Quiet please
    add("sign-quiet-1", "quiet", "Quiet please", *_on_wall("hall_s", -8.2, 2.52, "south"))
    add("sign-quiet-2", "quiet", "Quiet please", *_on_wall("quiet_s", -10.425, 1.72))
    add("sign-quiet-3", "quiet", "Quiet please", *_on_wall("lobby_w", 14.2, 1.5, "west"))
    return S


SIGNS = _sign_specs()


def _build_spec(s, cache):
    """Builds (or links) the sign mesh for a spec, at the origin."""
    k = s["kind"]
    key = (k, s["text"], s.get("sub"), s.get("back"), s.get("picto"), s.get("arrow"), s.get("drop"), tuple(s.get("lines") or ()))
    nm = "Sign_" + "".join(p.capitalize() for p in s["id"].replace("sign-", "").replace("_", "-").split("-"))
    if key in cache:
        src = cache[key]
        ob = C.instance(src, nm)
        for kk in ("sign_w", "sign_h", "light_points", "light_color"):
            if kk in src:
                ob[kk] = src[kk]
        return ob
    if k == "name":
        ob = build_sign_name(nm)
    elif k == "hanging":
        ob = build_sign_hanging(s["text"], s["back"], s["w"], s["h"], s["drop"], s["rod_x"], name=nm)
    elif k == "tablet":
        ob = build_sign_tablet(s["text"], s["sub"], nm)
    elif k == "zone":
        pic = {"wc": "wc", None: None}.get(s.get("picto"), None)
        ob = build_sign_zone(s["text"], pic, None, max_w=s.get("max_w", 1.5), name=nm)
    elif k == "lift":
        ob = build_sign_lift(s.get("sub", ""), nm)
    elif k == "stairs":
        ob = build_sign_zone(s["text"], picto_stairs, None, h=0.3, max_w=1.1, cap=0.06, name=nm)
    elif k == "plaque":
        pf = {"wc_w": "wc_w", "wc_m": "wc_m", "accessible": picto_accessible, "printer": picto_printer}.get(s.get("picto"))
        ob = build_sign_plaque(s["lines"], pf, name=nm)
    elif k == "exit":
        ob = build_sign_exit(s.get("arrow"), name=nm)
    elif k == "exit_hanging":
        ob = build_sign_exit(s.get("arrow"), hanging=True, drop=s["drop"], back_arrow=None, name=nm)
    elif k == "quiet":
        ob = build_sign_quiet(nm)
    else:
        raise ValueError(k)
    cache[key] = ob
    return ob


def _exit_sign_present(loc, margin=0.45):
    """True when an existing mesh with the exit_green face already sits around `loc` (Blender)."""
    green = bpy.data.materials.get("M_ExitGreen")
    if green is None:
        return False
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.name.startswith("Sign_") or green.name not in [m.name for m in ob.data.materials if m]:
            continue
        idx = [i for i, m in enumerate(ob.data.materials) if m == green]
        mw = ob.matrix_world
        for p in ob.data.polygons:
            if p.material_index in idx:
                c = mw @ p.center
                if (c - loc).length < margin + 0.3:
                    return True
    return False


def build_signage(col=None):
    """Builds every sign in SIGNS in place (Signage collection). Returns the list of roots."""
    col = col or C.collection("Signage", C.collection("PROPS"))
    cache = {}
    out = []
    for s in SIGNS:
        if s.get("optional") and _exit_sign_present(C.bl(s["x"], s["y"], s["z"])):
            s["built"] = False
            continue
        ob = _build_spec(s, cache)
        C.place(ob, s["x"], s["y"], s["z"], s["rot"])
        C.move_to(ob, col)
        ob["sign_id"] = s["id"]
        ob["sign_text"] = s["text"]
        s["w"] = round(float(ob.get("sign_w", s.get("w", 0.0))), 4)
        s["h"] = round(float(ob.get("sign_h", s.get("h", 0.0))), 4)
        s["built"] = True
        out.append(ob)
    _drop_scratch()
    return out


def _drop_scratch():
    scr = bpy.data.scenes.get("OVR_TextScratch")
    if scr is not None and scr != bpy.context.scene:
        bpy.data.scenes.remove(scr)


# ---------------------------------------------------------------------------
# Storytelling props
# ---------------------------------------------------------------------------

def build_clock_wall(seed=0):
    """Round library wall clock: moulded walnut case, ivory dial with chapter ring, Roman
    quarters, spade hands at ten past ten, brass bezel and a domed glass. Back on y = 0, bottom z = 0."""
    R = 0.2
    zc = R + 0.012
    rot = Matrix.Translation((0, 0, zc)) @ Matrix.Rotation(HALF_PI, 4, "X")
    parts = []
    case = [(0.0, 0.0), (0.19, 0.0), (0.205, 0.004), (0.212, 0.014), (0.212, 0.03), (0.207, 0.038), (0.209, 0.044),
            (0.204, 0.051), (0.195, 0.054), (0.188, 0.05), (0.186, 0.043), (0.18, 0.04)]
    cs = C.lathe("clock_case", case, 40, mat("walnut"), cap_bottom=True, cap_top=False, smooth_angle=40)
    C.transform_mesh(cs, rot)
    _uv(cs, "walnut", "x")
    parts.append(cs)
    parts.append(flat("clock_dial", [_circle(0, 0, 0.1815, 48)], "clock_dial", -0.0405, offset=(0, 0, zc)))
    bez = C.torus("clock_bezel", 0.183, 0.0055, (0, 0, 0.0515), mat("brass"), 40, 6)
    C.transform_mesh(bez, rot)
    parts.append(bez)
    yf = -0.0408
    marks = []
    for k in range(60):
        a = math.tau * k / 60
        long_ = k % 5 == 0
        r0, r1 = (0.148, 0.168) if long_ else (0.16, 0.168)
        wd = 0.0042 if long_ else 0.0013
        d = Vector((math.sin(a), math.cos(a)))
        nn = Vector((d.y, -d.x))
        p0, p1 = d * r0, d * r1
        marks.append([tuple(p0 - nn * wd / 2), tuple(p1 - nn * wd / 2), tuple(p1 + nn * wd / 2), tuple(p0 + nn * wd / 2)])
    rings = _stroke_ring(_circle(0, 0, 0.1685, 48) + [(0.1685, 0.0)], 0.002) + _stroke_ring(_circle(0, 0, 0.1471, 48) + [(0.1471, 0.0)], 0.0013)
    parts.append(flat("clock_marks", marks + rings, "label_ink", yf, offset=(0, 0, zc)))
    for num, k in (("XII", 0), ("III", 3), ("VI", 6), ("IX", 9)):
        a = math.tau * k / 12
        tob, _ = text("clock_num", num, 0.024, "label_ink", (0.123 * math.sin(a), zc + 0.123 * math.cos(a)), yf, res=2)
        parts.append(tob)
    tob, _ = text("clock_maker", "OVR", 0.011, "label_ink", (0, zc + 0.06), yf)
    parts.append(tob)

    def hand(length, wbase, deg, y):
        a = math.radians(deg)
        d = Vector((math.sin(a), math.cos(a)))
        nn = Vector((d.y, -d.x))
        pts = [-d * 0.03 - nn * wbase * 0.6, d * length * 0.62 - nn * wbase * 0.5, d * length * 0.7 - nn * wbase * 1.5,
               d * length, d * length * 0.7 + nn * wbase * 1.5, d * length * 0.62 + nn * wbase * 0.5, -d * 0.03 + nn * wbase * 0.6]
        return flat("clock_hand", [[tuple(p) for p in pts]], "label_ink", y, offset=(0, 0, zc))
    parts.append(hand(0.095, 0.0055, 305, yf - 0.003))
    parts.append(hand(0.14, 0.004, 60, yf - 0.005))
    boss = C.cylinder("clock_boss", 0.008, 0.008, 0.009, (0, yf - 0.004, zc), mat("brass"), 16, rot=C.rotx(90))
    parts.append(boss)
    return _join(parts, "Prop_Clock_Wall_01")


def _map_print_uv(ob, lon0, lon1, lat0, lat1, x0, x1, z0, z1):
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            fx = (co.x - x0) / (x1 - x0)
            fz = (co.z - z0) / (z1 - z0)
            uv[li].uv = (((lon0 + (lon1 - lon0) * fx) + 180) / 360, ((lat0 + (lat1 - lat0) * fz) + 90) / 180)


def build_map_framed(size="small", seed=0):
    """Framed antique map (walnut frame, gilt slip, cream mount). small 0.62 x 0.48 shows the
    Atlantic world; large 1.1 x 0.62 the whole world. Back on y = 0, bottom z = 0."""
    _map_mat("map_print")
    W, H = (0.62, 0.48) if size == "small" else (1.1, 0.62)
    fw, fd = 0.042, 0.032
    parts = []
    prof = [(0.0, 0.0), (0.0, 0.026), (-0.004, 0.032), (-0.012, 0.032), (-0.016, 0.028), (-0.022, 0.022), (-0.03, 0.02),
            (-0.036, 0.016), (-0.04, 0.012), (-0.042, 0.006), (-0.042, 0.0)]
    path = [(-W / 2, 0, 0), (W / 2, 0, 0), (W / 2, 0, H), (-W / 2, 0, H)]
    fr = C.sweep("map_frame", prof, path, mat("walnut"), closed_path=True, cap=False, up=(0, -1, 0), smooth_angle=35)
    _uv(fr, "walnut", "x")
    parts.append(fr)
    slip = [(-fw + 0.001, 0.008), (-fw - 0.004, 0.012), (-fw - 0.008, 0.009), (-fw - 0.009, 0.004), (-fw - 0.009, 0.0)]
    sp = C.sweep("map_slip", slip, path, mat("gilt"), closed_path=True, cap=False, up=(0, -1, 0), smooth_angle=50)
    parts.append(sp)
    m = fw + 0.009
    mount = _bx("map_mount", (-W / 2 + m - 0.002, -0.006, m - 0.002), (W / 2 - m + 0.002, 0.0, H - m + 0.002), "paper", 0.0, 1)
    parts.append(mount)
    mi = 0.045 if size == "small" else 0.05
    x0, x1, z0, z1 = -W / 2 + m + mi, W / 2 - m - mi, m + mi, H - m - mi - (0.02 if size != "small" else 0.0)
    pr = C.box_minmax("map_print", (x0, -0.0068, z0), (x1, -0.0061, z1), mat("map_print"))
    if size == "small":
        lon0, lon1 = -105.0, 45.0
        span = (lon1 - lon0) * (z1 - z0) / (x1 - x0) / 2 * 2
        lat0, lat1 = 8.0 - span / 2, 8.0 + span / 2
    else:
        lon0, lon1 = -180.0, 180.0
        span = 360.0 * (z1 - z0) / (x1 - x0)
        lat0, lat1 = 5 - span / 2, 5 + span / 2
    _map_print_uv(pr, lon0, lon1, lat0, lat1, x0, x1, z0, z1)
    parts.append(pr)
    # title on the mount + a fine ink border round the print
    tob, _ = text("map_title", "ORBIS TERRARUM" if size != "small" else "MARE ATLANTICUM", 0.012, "label_ink",
                  (0, (m + mi) / 2 + 0.004), -0.0065, spacing=1.2)
    parts.append(tob)
    bd = _rounded_rect_path(x0 - 0.006, x1 + 0.006, z0 - 0.006, z1 + 0.006, 0.0005, 1)
    bd.append(bd[0])
    parts.append(flat("map_border", _stroke_ring(bd, 0.0016), "label_ink", -0.0062))
    return _join(parts, f"Prop_Map_Framed_{size.capitalize()}_01")


BOOK_KEYS = ("leather_burgundy", "leather_green", "leather_brown", "signage", "oak_stained")


def _book(name, L, Wd, T, key, x, y, z, yaw):
    """A book lying flat: boards, rounded spine (toward -Y), page block, gilt bands. Bottom at z."""
    parts = []
    bt = 0.0028
    over = 0.003
    parts.append(_bx(name + "_B0", (-L / 2, -Wd / 2, 0), (L / 2, Wd / 2, bt), key, 0.0012, 1, "x"))
    parts.append(_bx(name + "_B1", (-L / 2, -Wd / 2, T - bt), (L / 2, Wd / 2, T), key, 0.0012, 1, "x"))
    parts.append(_bx(name + "_Pages", (-L / 2 + over, -Wd / 2 + 0.004, bt), (L / 2 - over, Wd / 2 - over, T - bt),
                     "book_pages", 0.0006, 1, "x"))
    sp = C.cylinder(name + "_Spine", T / 2, T / 2, L, (0, -Wd / 2 + 0.002, T / 2), mat(key), 10, rot=C.roty(90))
    C.transform_mesh(sp, Matrix.Translation((0, -Wd / 2 + 0.002, T / 2)) @ Matrix.Diagonal((1, 0.32, 1, 1))
                     @ Matrix.Translation((0, Wd / 2 - 0.002, -T / 2)))
    _uv(sp, key, "x")
    parts.append(sp)
    for gx in (-L / 2 + 0.03, L / 2 - 0.03):
        g = C.cylinder(name + "_Band", T / 2 + 0.0006, T / 2 + 0.0006, 0.004, (gx, -Wd / 2 + 0.002, T / 2), mat("gilt"), 10,
                       rot=C.roty(90))
        C.transform_mesh(g, Matrix.Translation((0, -Wd / 2 + 0.002, T / 2)) @ Matrix.Diagonal((1, 0.34, 1, 1))
                         @ Matrix.Translation((0, Wd / 2 - 0.002, -T / 2)))
        parts.append(g)
    ob = _join(parts, name)
    C.transform_mesh(ob, Matrix.Translation((x, y, z)) @ Matrix.Rotation(yaw, 4, "Z"))
    return ob


def build_book_stack(seed=0):
    """2-6 books stacked flat, largest at the bottom, spines facing front (-Y)."""
    rng = random.Random(300 + seed)
    n = 2 + seed % 5
    dims = sorted([(rng.uniform(0.18, 0.27), rng.uniform(0.12, 0.19), rng.uniform(0.018, 0.048)) for _ in range(n)],
                  key=lambda d: -d[0] * d[1])
    z = 0.0
    parts = []
    for i, (L, Wd, T) in enumerate(dims):
        parts.append(_book(f"book{i}", L, Wd, T, BOOK_KEYS[(seed + i * 2) % len(BOOK_KEYS)], rng.uniform(-0.01, 0.01),
                           rng.uniform(-0.008, 0.008), z, math.radians(rng.uniform(-7, 7))))
        z += T + 0.0002
    return _join(parts, f"Prop_Book_Stack_{n}_01")


def build_archive_boxes(seed=0):
    """Two or three archival document boxes, lids, brass label holders with handwritten-style
    labels and finger pulls."""
    rng = random.Random(400 + seed)
    n = 2 + seed % 2
    parts = []
    z = 0.0
    L, Wd, H = 0.39, 0.27, 0.125
    for i in range(n):
        ox, oy, yaw = rng.uniform(-0.015, 0.015), rng.uniform(-0.01, 0.01), math.radians(rng.uniform(-4, 4))
        p = []
        p.append(_bx("ab_body", (-L / 2, -Wd / 2, 0), (L / 2, Wd / 2, H - 0.002), "archive_board", 0.002, 1, "x"))
        p.append(_bx("ab_lid", (-L / 2 - 0.003, -Wd / 2 - 0.003, H - 0.035), (L / 2 + 0.003, Wd / 2 + 0.003, H), "archive_board",
                     0.0025, 2, "x"))
        p.append(_bx("ab_holder", (-0.06, -Wd / 2 - 0.0048, 0.025), (0.06, -Wd / 2 - 0.0005, 0.07), "brass", 0.0012, 1, "x"))
        p.append(_bx("ab_label", (-0.052, -Wd / 2 - 0.0052, 0.03), (0.052, -Wd / 2 - 0.0046, 0.065), "paper", 0.0, 1))
        for k in range(2):
            p.append(_bx("ab_ink", (-0.04, -Wd / 2 - 0.0056, 0.054 - k * 0.012), (0.04 - 0.02 * k, -Wd / 2 - 0.0052,
                                                                                      0.0565 - k * 0.012), "label_ink", 0.0, 1))
        pull = C.cylinder("ab_pull", 0.012, 0.012, 0.002, (0.13, -Wd / 2 - 0.0002, 0.05), mat("iron"), 16, rot=C.rotx(90))
        p.append(pull)
        ob = _join(p, f"ab{i}")
        C.transform_mesh(ob, Matrix.Translation((ox, oy, z)) @ Matrix.Rotation(yaw, 4, "Z"))
        parts.append(ob)
        z += H + 0.0003
    return _join(parts, f"Prop_Archive_Boxes_{n}_01")


def build_reading_stand(seed=0):
    """Tabletop walnut reading stand (slope at 28 deg, ledge, strut) holding an open book."""
    parts = []
    w, d = 0.44, 0.3
    ang = math.radians(28)
    # base frame
    parts.append(_bx("rs_rail_f", (-w / 2, -d / 2, 0), (w / 2, -d / 2 + 0.03, 0.022), "walnut", 0.003, 2, "x"))
    parts.append(_bx("rs_rail_b", (-w / 2, d / 2 - 0.03, 0), (w / 2, d / 2, 0.022), "walnut", 0.003, 2, "x"))
    for sx in (-1, 1):
        parts.append(_bx("rs_side", (sx * w / 2 - 0.015, -d / 2 + 0.03, 0), (sx * w / 2 + 0.015, d / 2 - 0.03, 0.022),
                         "walnut", 0.003, 2, "y"))
    # sloped rest (hinged at the front rail top), ledge and strut
    L = 0.31
    rest = _bx("rs_rest", (-w / 2 + 0.01, 0.0, 0.0), (w / 2 - 0.01, L, 0.014), "walnut", 0.003, 2, "y")
    ledge = _bx("rs_ledge", (-w / 2 + 0.02, -0.012, 0.0), (w / 2 - 0.02, 0.008, 0.045), "walnut", 0.003, 2, "x")
    tf = Matrix.Translation((0, -d / 2 + 0.018, 0.022)) @ Matrix.Rotation(ang, 4, "X")
    for o in (rest, ledge):
        C.transform_mesh(o, tf)
        parts.append(o)
    yb = d / 2 - 0.015
    lyb = (yb - (-d / 2 + 0.018)) / math.cos(ang)
    zt = 0.022 + lyb * math.sin(ang) + 0.004
    for sx in (-1, 1):
        parts.append(_bx("rs_post", (sx * 0.15 - 0.012, yb - 0.01, 0.02), (sx * 0.15 + 0.012, yb + 0.01, zt), "walnut", 0.002,
                         1, "z"))
    # open book on the slope: two page blocks curving up from the gutter, boards beneath
    mb = MB()
    BW, BL, PT = 0.15, 0.22, 0.016
    nx, ny = 10, 3
    for s in (-1, 1):
        grid_top, grid_bot = [], []
        for i in range(nx + 1):
            u = i / nx
            x = s * (0.006 + u * BW)
            zt = PT * (0.55 + 0.45 * math.sin(math.pi * min(1, u * 1.1))) + 0.012 * math.sin(math.pi * u) * (1 - u) + 0.004
            rowt, rowb = [], []
            for j in range(ny + 1):
                yv = 0.01 + BL * j / ny
                rowt.append(mb.v((x, yv, 0.0035 + zt)))
                rowb.append(mb.v((x, yv, 0.0035)))
            grid_top.append(rowt)
            grid_bot.append(rowb)
        for i in range(nx):
            for j in range(ny):
                q = (grid_top[i][j], grid_top[i + 1][j], grid_top[i + 1][j + 1], grid_top[i][j + 1])
                if s < 0:
                    q = tuple(reversed(q))
                mb.face(q, "paper", smooth=True)
        for j in range(ny):   # fore-edges, gutter walls and head/tail edges (book_pages)
            q = (grid_bot[-1][j], grid_bot[-1][j + 1], grid_top[-1][j + 1], grid_top[-1][j])
            mb.face(q if s > 0 else tuple(reversed(q)), "book_pages", smooth=False)
            q = (grid_bot[0][j], grid_bot[0][j + 1], grid_top[0][j + 1], grid_top[0][j])
            mb.face(q if s < 0 else tuple(reversed(q)), "book_pages", smooth=False)
        for j, sgn in ((0, 1), (ny, -1)):
            for i in range(nx):
                q = (grid_bot[i][j], grid_bot[i + 1][j], grid_top[i + 1][j], grid_top[i][j])
                mb.face(q if (s * sgn) < 0 else tuple(reversed(q)), "book_pages", smooth=False)
        # set text: a running head, then justified lines in paragraphs (ragged last lines, indents),
        # thin grey strokes that follow the page curl (they read as print, not as stripes)
        trng = random.Random(77 + seed * 3 + (s > 0))

        def ztop(u):
            return PT * (0.55 + 0.45 * math.sin(math.pi * min(1, u * 1.1))) + 0.012 * math.sin(math.pi * u) * (1 - u) + 0.004

        def line(ua, ub, yv, hh, key):
            us = [ua] + [i / nx for i in range(1, nx) if ua < i / nx < ub] + [ub]
            top = [mb.v((s * (0.006 + u * BW), yv + hh, 0.0035 + ztop(u) + 0.0004)) for u in us]
            bot = [mb.v((s * (0.006 + u * BW), yv, 0.0035 + ztop(u) + 0.0004)) for u in us]
            for a in range(len(us) - 1):
                q = (bot[a], bot[a + 1], top[a + 1], top[a])
                mb.face(q if s > 0 else tuple(reversed(q)), key, smooth=True)

        u_in, u_out = (0.16, 0.86) if s > 0 else (0.16, 0.86)
        line(0.36, 0.64, BL - 0.006, 0.0016, "page_text")            # running head
        yv = BL - 0.024
        para = trng.randint(4, 7)
        first = False
        while yv > 0.03:
            ua = u_in + (0.05 if first else 0.0)
            ub = u_out if para > 0 else u_in + trng.uniform(0.25, 0.6)
            line(ua, ub, yv, 0.0011, "page_text")
            first = False
            if para <= 0:
                para = trng.randint(4, 8)
                first = True
            para -= 1
            yv -= 0.0052
        line(0.47, 0.53, 0.016, 0.0013, "page_text")                 # folio
    pages = mb.build("rs_pages", 50)
    cover = _bx("rs_cover", (-BW - 0.012, 0.004, 0.0), (BW + 0.012, BL + 0.016, 0.0035), "leather_burgundy", 0.0012, 1, "x")
    ribbon = _bx("rs_ribbon", (-0.004, -0.06, 0.0), (0.004, 0.012, 0.0006), "signage_text", 0.0, 1)
    C.transform_mesh(ribbon, Matrix.Translation((0.004, 0.012, 0.024)))
    bk = _join([pages, cover, ribbon], "rs_book")
    C.transform_mesh(bk, tf @ Matrix.Translation((0, 0.004, 0.014)))
    parts.append(bk)
    return _join(parts, "Prop_Reading_Stand_01")


PROP_BUILDERS = {
    "clock_wall": build_clock_wall,
    "map_framed_small": lambda seed=0: build_map_framed("small", seed),
    "map_framed_large": lambda seed=0: build_map_framed("large", seed),
    "book_stack": build_book_stack,
    "archive_boxes": build_archive_boxes,
    "reading_stand": build_reading_stand,
}

KIND_BUILDERS = {
    "plant_large": build_plant_large,
    "plant_small": build_plant_small,
    "globe_floor": build_globe_floor,
}


# ---------------------------------------------------------------------------
# Previews
# ---------------------------------------------------------------------------

def _render_one(objs, out_dir, name, views, closeups=(), size=(960, 960), samples=32, lens=50):
    import lib_render as R
    return R.preview_objects(objs, out_dir, name, views, size, samples, lens, closeups)


def preview_assets(out_dir):
    import lib_render as R
    results = {}
    jobs = [("plant_palm", lambda: build_plant_large(seed=1)), ("plant_fig", lambda: build_plant_large(seed=3)),
            ("plant_rubber", lambda: build_plant_large(seed=5)), ("plant_small_snake", lambda: build_plant_small(seed=0)),
            ("plant_small_fig", lambda: build_plant_small(seed=1)), ("globe", build_globe_floor)]
    for nm, fn in jobs:
        C.reset_scene()
        _FONT_CACHE.clear()
        ob = fn()
        results[nm] = C.tris(ob)
        dims = tuple(round(v, 3) for v in ob.dimensions)
        lo, hi = R.bounds([ob])
        print(f"[props_signage] {nm}: {results[nm]} tris, dims {dims}, z {lo.z:.3f}..{hi.z:.3f}")
        # a 1.7 m scale figure (thin column) beside it in the first view
        fig = C.cylinder("scale_ref", 0.12, 0.12, 1.7, (-0.75, 0.3, 0.85), mat("plastic_light"), 16)
        ps = _render_one([ob], out_dir, nm, ((20, 10), (-40, 25)), size=(960, 960), samples=32, lens=50)
        C.remove(fig)
        if nm == "globe":
            import lib_render as R2
            cam = bpy.context.scene.camera
            R2.look(cam, (0.0, -0.95, 1.05), (0, 0, 0.92))
            cam.data.lens = 50
            R2.render(os.path.join(out_dir, "globe_close.png"))
            R2.look(cam, (0.55, -0.6, 0.45), (0.2, -0.2, 0.3))
            R2.render(os.path.join(out_dir, "globe_stand.png"))
        if nm.startswith("plant") and nm != "plant_small_snake":
            import lib_render as R2
            cam = bpy.context.scene.camera
            lo, hi = R2.bounds([ob])
            R2.look(cam, (0.25, -0.75, hi.z - 0.15), (0, 0, hi.z - 0.45))
            cam.data.lens = 45
            R2.render(os.path.join(out_dir, f"{nm}_leaves.png"))
    # props
    C.reset_scene()
    x = 0.0
    objs = []
    for nm, fn in PROP_BUILDERS.items():
        ob = fn(seed=4 if nm == "book_stack" else 1)
        results[nm] = C.tris(ob)
        w = ob.dimensions.x
        ob.location.x = x + w / 2
        x += w + 0.12
        objs.append(ob)
        print(f"[props_signage] {nm}: {results[nm]} tris, dims {tuple(round(v, 3) for v in ob.dimensions)}")
    for ob in objs:
        ob.location.x -= x / 2
    wall = C.box("wall", (x + 1, 0.05, 1.6), (0, 0.025, 0.8), mat("plaster"))
    _render_one(objs, out_dir, "props", ((0, 8), (25, 20)), size=(1400, 700), samples=32, lens=50)
    import lib_render as R2
    cam = bpy.context.scene.camera
    for ob in objs:
        lo, hi = R2.bounds([ob])
        c = (lo + hi) / 2
        r = max((hi - lo).length / 2, 0.15)
        R2.look(cam, c + Vector((0.35 * r, -2.4 * r, 0.8 * r)), c)
        R2.render(os.path.join(out_dir, f"prop_{ob.name}.png"))
    print("[props_signage] TRIS", results)
    return results


def preview_signs(out_dir):
    """A wall of every sign design (front views) + close-ups."""
    import lib_render as R
    C.reset_scene()
    cache = {}
    objs = []
    seen = set()
    for s in SIGNS:
        k = (s["kind"], s["text"], s.get("sub"), s.get("picto"))
        if k in seen:
            continue
        seen.add(k)
        ob = _build_spec(dict(s, drop=0.3) if s["kind"] == "exit_hanging" else dict(s), cache)
        objs.append((s, ob))
    # lay out in rows on a plaster wall at y = 0
    rows = [[], [], [], []]
    for s, ob in objs:
        k = s["kind"]
        r = 0 if k in ("name", "tablet") else 1 if k in ("zone", "hanging") else 2 if k in ("lift", "stairs", "exit", "exit_hanging") else 3
        rows[r].append(ob)
    z = 4.6
    maxw = 0
    for row in rows:
        x = 0.0
        hmax = max((o.get("sign_h", 0.3) for o in row), default=0.3)
        for ob in row:
            w = ob.get("sign_w", ob.dimensions.x)
            ob.location = (x + w / 2, -0.02 if ob.name.startswith(("Sign_ZoneArch", "Sign_ExitRouteServices")) else 0.0,
                           z - hmax / 2)
            x += w + 0.15
        maxw = max(maxw, x)
        for ob in row:
            ob.location.x -= x / 2
        z -= hmax + (0.6 if row is rows[1] else 0.35)
    wall = C.box("wall", (maxw + 1.0, 0.1, 6.0), (0, 0.05 + 0.08, 2.4), mat("plaster"))
    allo = [o for _, o in objs]
    bpy.context.view_layer.update()
    scene = bpy.context.scene
    R.engine(scene, "EEVEE", 32, (1800, 1250))
    lo, hi = R.bounds(allo)
    c = (lo + hi) / 2
    R.studio(scene, c.to_tuple(), 2.5, floor=False)
    cam = R.camera(lens=50)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = max(hi.x - lo.x, (hi.z - lo.z) * 1800 / 1250) * 1.06
    R.look(cam, (c.x, -12, c.z), (c.x, 0, c.z))
    paths = [R.render(os.path.join(out_dir, "signs_sheet.png"))]
    cam.data.type = "PERSP"
    tri = {}
    for s, ob in objs:
        tri[ob.name] = C.tris(ob)
    print("[props_signage] SIGN TRIS", tri)
    R.engine(scene, "EEVEE", 32, (960, 640))
    for ob in allo:
        w, h = float(ob.get("sign_w", 0.5)), float(ob.get("sign_h", 0.3))
        dist = 1.75 * max(w, 1.5 * h) + 0.12
        p = ob.location.copy()
        R.look(cam, p + Vector((0.18 * dist, -dist, 0.08 * dist)), p)
        paths.append(R.render(os.path.join(out_dir, f"sign_{ob.name}.png")))
    return paths


def _bvh(ob):
    deps = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    bm.from_object(ob, deps)
    bm.transform(ob.matrix_world)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def preview_inplace(out_dir):
    """Cycles check of the signs in place: hall shell + plan walls + doors + lift + landing,
    bookcase stand-ins, then every sign; reports intersections with the architecture."""
    import arch_gallery
    import arch_shell
    import arch_windows
    import lib_render as R
    import scene_milestone as SM
    C.reset_scene()
    arch_shell.build_hall_shell()
    for w in P.WALLS:
        if w.id not in SM.HALL_WALL_IDS:
            arch_shell.build_wall(w)
    cache = {}
    for w in P.WALLS:
        for o in w.openings:
            try:
                ob, h = arch_windows.build_for_opening(o, w, cache=cache)
            except Exception as e:  # noqa: BLE001
                print("opening failed", o.id, e)
                continue
            if ob is not None:
                arch_windows.place_in_wall(ob, w, o, h)
    SM.build_floors()
    SM.build_lift_standin()
    try:
        arch_gallery.build_gallery(landing=True)
    except Exception as e:  # noqa: BLE001
        print("gallery failed", e)
        arch_gallery.build_landing()
    for bc in P.BOOKCASES:
        (ax, az), (bx, bz) = bc["a"], bc["b"]
        rot = bc["rot"]
        L = math.hypot(bx - ax, bz - az)
        ob = C.box("BC_" + bc["id"], (L, bc["depth"], bc["height"]), (0, 0, 0), mat("walnut_dark"))
        C.transform_mesh(ob, Matrix.Translation((0, -bc["depth"] / 2, bc["height"] / 2)))
        C.place(ob, (ax + bx) / 2, bc["y"], (az + bz) / 2, rot)
    for it in P.ITEMS:
        if it.kind in KIND_BUILDERS and it.y == 0 and it.kind == "plant_large":
            pass
    arch = [o for o in bpy.data.objects if o.type == "MESH"]
    signs = build_signage()
    # plants + globe in place for context
    kb_cache = {}
    for it in P.ITEMS:
        if it.kind in KIND_BUILDERS:
            key = (it.kind, plant_variant(it.seed) if it.kind == "plant_large" else 0)
            if key not in kb_cache:
                kb_cache[key] = KIND_BUILDERS[it.kind](it)
                ob = kb_cache[key]
            else:
                ob = C.instance(kb_cache[key], kb_cache[key].name + "_i")
            C.place(ob, it.x, it.y, it.z, it.rot)
    # intersection report
    trees = [(o, _bvh(o)) for o in arch if o.name in bpy.data.objects]
    for s in signs:
        ts = _bvh(s)
        hits = []
        for o, t in trees:
            if ts.overlap(t):
                hits.append(o.name)
        print(f"[props_signage] {s.name}: {C.tris(s)} tris, clashes: {hits[:6]}")
    for s in SIGNS:
        if not s.get("built", True):
            print(f"[props_signage] {s['id']} skipped: the door already carries a lit EXIT sign")
    # lights + Cycles
    scene = bpy.context.scene
    R.engine(scene, "CYCLES", 32, (960, 640))
    # The whole building does not fit next to the other artists' renders on the GPU (Metal ran out
    # of memory on the second shot): render this check on the CPU.
    scene.cycles.device = "CPU"
    sun = R.sun("Sun", (0.4, 0.7, -0.6), 3.0)
    R.sky_world(scene, 2.2)
    for nm, loc in (("fill_lobby", (0, 5.5, 14.5)), ("fill_hall_n", (0, 3.6, -8.6)), ("fill_hall_s", (0, 3.6, 6.4)),
                    ("fill_services", (8.5, 3.9, -13.5)), ("fill_hall_e", (12.0, 6.0, -1.0)), ("fill_quiet", (-12, 3.8, 14.5)),
                    ("fill_gallery", (11.0, 7.8, -8.6))):
        R.point_light(nm, C.bl(*loc), 900 if "hall" in nm or "gallery" in nm else 600, (1.0, 0.86, 0.68), 0.5)
    cam = R.camera(lens=28)
    shots = {
        "inplace_lobby_name": ((0.0, 1.62, 19.2), (0.0, 3.6, 9.0), 26),
        "inplace_hall_north_doors": ((5.0, 1.62, -4.6), (5.6, 2.75, -10.0), 30),
        "inplace_services_plaques": ((9.0, 1.62, -12.2), (9.5, 1.4, -16.2), 24),
        "inplace_lift": ((9.5, 1.62, -6.0), (14.0, 3.0, -8.6), 30),
        "inplace_rotunda_arch": ((2.0, 1.62, -1.0), (14.0, 6.5, -1.0), 24),
        "inplace_quiet_door": ((-11.2, 1.62, 3.0), (-11.2, 2.6, 8.0), 30),
        "inplace_exit_north": ((7.0, 1.62, -12.0), (14.0, 2.4, -13.5), 26),
        "inplace_lounge_arch": ((-8.0, 1.62, 1.0), (-14.4, 3.0, -1.0), 30),
    }
    only = [x for x in os.environ.get("OVR_SHOTS", "").split(",") if x]
    paths = []
    for nm, (eye, at, lens) in shots.items():
        if only and nm not in only:
            continue
        cam.data.lens = lens
        R.look(cam, C.bl(*eye), C.bl(*at))
        paths.append(R.render(os.path.join(out_dir, nm + ".png")))
    return paths


def preview(out_dir):
    preview_assets(out_dir)
    preview_signs(out_dir)
    preview_inplace(out_dir)
