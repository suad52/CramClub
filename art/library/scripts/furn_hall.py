"""
Hall furniture for the Grand Reading Hall (Ref 1, Ref 2, Ref 3).

  build_table_communal(number)  4.0 m oak-topped reading table on a walnut base: moulded thumbnail-and-cove
                                top edge, panelled apron with ovolo beads, corner blocks with paterae and drop
                                finials, twin-column trestle ends tied by a moulded stretcher with keyed
                                through-tenons, two turned intermediate posts under cross-bearers, three brass
                                power grommets and a brass table-number plaque.
  build_chair_reading()         spindle-back library side chair: raked back stiles, curved and arched crest
                                rail, five turned spindles, turned splayed front legs, turned H-stretcher,
                                crowned green leather seat with spaced brass nails over a beaded seat rail.
  build_lamp_desk_brass()       Ref 1's reading lamp: moulded round base, turned stem with knop and collar,
                                a two-light cluster with warm globe bulbs under a tall bronze empire shade
                                (ivory enamel inside, rolled rim), a pull chain on one socket, finial.
  build_lamp_banker_green()     Ref 3's banker's lamp: stepped brass base, curved arm, cased green glass shade
                                (opal white inside) with a lit state, socket, bulb and ball pull chain.
  build_table_set(number)       the table with six chairs (one pulled out), two brass lamps and a few student
                                props (open book, notebook and pencil, closed laptop).

Every builder works at the origin with the floor (or desk) contact at z = 0 and the front facing Blender -Y.
Lamps carry `light_offset` / `light_points` (Blender metres, from the lamp origin) and `light_color` custom
properties so the web build knows where to put the real light; the banker lamp also carries `glow_material`,
`glow_material_lit` and `glow_emission` so the web build can swap its shade to the glowing state with the light.
"""

from __future__ import annotations

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

import lib_core as C
import lib_materials as LM
import lib_render as R
from lib_materials import mat, tex_size

# Palette additions (only this module uses them).
# Cased (opal-lined) green glass for the banker's shade: opaque (no transparency sorting), a deep, slightly
# greyed green under a clear coat, with a pale sheen so grazing edges read lighter, like real cased glass.
# The `_lit` twin is the same glass glowing from the bulb inside; the web build swaps to it with the light.
LM.PALETTE.setdefault("glass_green_cased", dict(base="#1b4630", rough=0.1, emission="#2a7a4a", emit=0.06,
                                                coat=1.0, coat_rough=0.03, sheen=0.6, sheen_tint="#bfe3cc",
                                                sheen_rough=0.35))
LM.PALETTE.setdefault("glass_green_cased_lit", dict(base="#1b4630", rough=0.1, emission="#1f9a4c", emit=1.6,
                                                    coat=1.0, coat_rough=0.03, sheen=0.6, sheen_tint="#bfe3cc",
                                                    sheen_rough=0.35))
# Space-grey anodised aluminium for the laptop (nothing in the palette fits a modern laptop shell).
LM.PALETTE.setdefault("aluminium", dict(base="#8f9399", rough=0.34, metal=1.0, tex="brushed", size=0.3, normal=0.08))

CHAIR_WOOD = "walnut"
CHAIR_LEATHER = "leather_green"
SPUN = {"brass", "brass_aged", "bronze", "chrome"}      # turned metal: lathe marks run round the part

_EXTRA_INPUTS = {"coat": "Coat Weight", "coat_rough": "Coat Roughness", "sheen": "Sheen Weight",
                 "sheen_rough": "Sheen Roughness", "sheen_tint": "Sheen Tint"}


def _mat(key):
    """mat(key), plus the extra Principled inputs (clear coat, sheen) our own palette keys ask for.
    All of them are glTF-exportable (KHR_materials_clearcoat / _sheen)."""
    m = mat(key)
    spec = LM.PALETTE.get(key, {})
    if any(k in spec for k in _EXTRA_INPUTS):
        bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        for k, sock in _EXTRA_INPUTS.items():
            if k in spec and bsdf is not None and sock in bsdf.inputs:
                v = spec[k]
                bsdf.inputs[sock].default_value = LM._hex(v) if isinstance(v, str) else v
    return m


# ---------------------------------------------------------------------------
# Geometry helpers (private: the shared toolkit stays untouched)
# ---------------------------------------------------------------------------

def _xf(ob, M):
    """Transforms mesh data in place (custom normals are space-relative, so they follow)."""
    ob.data.transform(M)
    ob.data.update()
    return ob


def _T(x, y, z):
    return Matrix.Translation((x, y, z))


def _Rx(deg):
    return Matrix.Rotation(math.radians(deg), 4, "X")


def _Ry(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Y")


def _Rz(deg):
    return Matrix.Rotation(math.radians(deg), 4, "Z")


def _align(p0, p1):
    """Matrix taking a part built along +Z from the origin onto the segment p0 -> p1, and its length."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    return Matrix.Translation(p0) @ q.to_matrix().to_4x4(), d.length


def _fillet(pts, r, n=1, min_turn=35.0):
    """Rounds the sharp interior corners (turning more than `min_turn` degrees) of a 2D polyline
    (lathe/sweep profiles); gentle corners are left alone to keep the ring count down. A point may
    carry its own radius as a third value (0 keeps it sharp). n=1 gives a soft chamfer pair."""
    out = [tuple(pts[0][:2])]
    for i in range(1, len(pts) - 1):
        p = Vector(pts[i][:2])
        a = Vector(pts[i - 1][:2])
        b = Vector(pts[i + 1][:2])
        rr = pts[i][2] if len(pts[i]) > 2 else r
        da, db = a - p, b - p
        la, lb = da.length, db.length
        if rr <= 1e-4 or la < 1e-9 or lb < 1e-9:
            out.append((p.x, p.y))
            continue
        da.normalize()
        db.normalize()
        if -da.dot(db) > math.cos(math.radians(min_turn)):   # gentle corner: leave it
            out.append((p.x, p.y))
            continue
        t = min(rr, la * 0.45, lb * 0.45)
        p1, p2 = p + da * t, p + db * t
        for k in range(n + 1):
            s = k / n
            q = p1 * (1 - s) ** 2 + p * 2 * (1 - s) * s + p2 * s * s
            out.append((q.x, q.y))
    out.append(tuple(pts[-1][:2]))
    return out


def _catmull(pts, sub=4):
    P = [Vector(p) for p in pts]
    out = []
    for i in range(len(P) - 1):
        p0 = P[i - 1] if i > 0 else P[i] * 2 - P[i + 1]
        p1, p2 = P[i], P[i + 1]
        p3 = P[i + 2] if i + 2 < len(P) else P[i + 1] * 2 - P[i]
        for k in range(sub):
            t = k / sub
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(P[-1].copy())
    return out


def _bez2(p0, p1, p2, t):
    return p0 * (1 - t) ** 2 + p1 * 2 * (1 - t) * t + p2 * t * t


def _rpoly(corners, radii, d=0.0, seg=4):
    """Ring of a convex CCW polygon with rounded corners, offset inward by `d` (keeps the vertex
    count constant for every `d`, so rings can be bridged into mouldings)."""
    n = len(corners)
    P = [Vector((c[0], c[1])) for c in corners]
    radii = list(radii) if isinstance(radii, (list, tuple)) else [radii] * n
    seg = list(seg) if isinstance(seg, (list, tuple)) else [seg] * n
    out = []
    for i in range(n):
        a, p, b = P[i - 1], P[i], P[(i + 1) % n]
        e1 = (p - a).normalized()
        e2 = (b - p).normalized()
        n1 = Vector((-e1.y, e1.x))
        n2 = Vector((-e2.y, e2.x))
        r = max(radii[i], d + 0.0004)
        denom = e1.dot(n2)
        t = r * (1 - n1.dot(n2)) / denom if abs(denom) > 1e-9 else 0.0
        c = p + n1 * r + e1 * t
        rr = r - d
        a1 = math.atan2(-n1.y, -n1.x)
        a2 = math.atan2(-n2.y, -n2.x)
        while a2 < a1 - 1e-9:
            a2 += math.tau
        for k in range(seg[i] + 1):
            ang = a1 + (a2 - a1) * k / seg[i]
            out.append(Vector((c.x + math.cos(ang) * rr, c.y + math.sin(ang) * rr)))
    return out


def _rect(hw, hh, cx=0.0, cy=0.0):
    return [(cx - hw, cy - hh), (cx + hw, cy - hh), (cx + hw, cy + hh), (cx - hw, cy + hh)]


def _circle(r, n, cx=0.0, cy=0.0):
    return [Vector((cx + r * math.cos(math.tau * k / n), cy + r * math.sin(math.tau * k / n))) for k in range(n)]


def _bridge(bm, A, B, closed=True):
    m = len(A)
    for i in range(m if closed else m - 1):
        j = (i + 1) % m
        try:
            bm.faces.new((A[i], A[j], B[j], B[i]))
        except ValueError:
            pass


def _orient(f, N):
    f.normal_update()
    if f.normal.dot(N) < 0:
        f.normal_flip()


def _bridge_o(bm, A, B, ref, toward=True, axis=None, mi=0):
    """Bridges loops A -> B and points every new face towards (or away from) `ref`, ignoring the
    component along `axis` (open meshes cannot rely on recalc_face_normals)."""
    m = len(A)
    out = []
    for i in range(m):
        j = (i + 1) % m
        try:
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
        except ValueError:
            continue
        c = f.calc_center_median()
        d = (Vector(ref) - c) if toward else (c - Vector(ref))
        if axis is not None:
            ax = Vector(axis).normalized()
            d -= ax * d.dot(ax)
        _orient(f, d)
        f.material_index = mi
        out.append(f)
    return out


def _cap(bm, loops, N, mi=0):
    """Fills a planar region (outer loop first, then hole loops) with triangles facing N."""
    pts = [[v.co.copy() for v in L] for L in loops]
    flat = [v for L in loops for v in L]
    out = []
    for a, b, c in tessellate_polygon(pts):
        try:
            f = bm.faces.new((flat[a], flat[b], flat[c]))
        except ValueError:
            continue
        _orient(f, Vector(N))
        f.material_index = mi
        out.append(f)
    return out


def _ngon(bm, loop, N, mi=0):
    f = bm.faces.new(loop)
    _orient(f, Vector(N))
    f.material_index = mi
    return f


def _finish(bm, name, keys, smooth=40.0, merge=False, recalc=True):
    if merge:
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mats = [_mat(k) for k in keys] if isinstance(keys, (list, tuple)) else (_mat(keys) if keys else None)
    ob = C.mesh_from_bmesh(name, bm, mats)
    C.shade_smooth(ob, smooth)
    return ob


def _loft(name, rings, key=None, closed=True, caps=(True, True), smooth=40.0, merge=False):
    """Bridges a list of rings (same vertex count) into a surface, optionally capped."""
    bm = bmesh.new()
    Rr = [[bm.verts.new(tuple(p)) for p in ring] for ring in rings]
    for A, B in zip(Rr, Rr[1:]):
        _bridge(bm, A, B, closed)
    if closed and caps[0]:
        bm.faces.new(list(reversed(Rr[0])))
    if closed and caps[1]:
        bm.faces.new(Rr[-1])
    return _finish(bm, name, key, smooth, merge)


def _slab(name, corners, radii, profile, seg=4, key=None, caps=(True, True), closed_profile=False, smooth=40.0):
    """A rounded-polygon solid whose edge follows a moulding `profile` [(inset, z), ...] (bottom to top).
    Table tops, lamp bases, plaques, the seat rail. With closed_profile the rings form a ring frame."""
    rings = [[(p.x, p.y, z) for p in _rpoly(corners, radii, d, seg)] for d, z in profile]
    if closed_profile:
        rings.append(rings[0])
        bm = bmesh.new()
        Rr = [[bm.verts.new(tuple(p)) for p in ring] for ring in rings[:-1]]
        Rr.append(Rr[0])
        for A, B in zip(Rr, Rr[1:]):
            _bridge(bm, A, B, True)
        return _finish(bm, name, key, smooth)
    return _loft(name, rings, key, True, caps, smooth)


def _mitre_loft(name, corners, N, profile, key, smooth=40.0):
    """Closed mitred moulding around a planar polygon (CCW seen from normal N).
    profile [(s, h)]: s = offset inward from the edge, h = offset along N. The profile is closed."""
    N = Vector(N)
    P = [Vector(c) for c in corners]
    n = len(P)
    rings = []
    for i in range(n):
        e1 = (P[i] - P[i - 1]).normalized()
        e2 = (P[(i + 1) % n] - P[i]).normalized()
        i1, i2 = N.cross(e1), N.cross(e2)
        m = (i1 + i2) / (1 + i1.dot(i2))
        rings.append([P[i] + m * s + N * h for s, h in profile])
    bm = bmesh.new()
    Rr = [[bm.verts.new(p) for p in ring] for ring in rings]
    for k in range(n):
        _bridge(bm, Rr[k], Rr[(k + 1) % n], True)
    return _finish(bm, name, key, smooth)


def _extrude(name, outline, a0, a1, key, plane="xz", bevel_w=0.0, segs=2):
    """Extrudes a closed 2D outline. plane 'xz': outline (x, z) pushed along Y from a0 to a1;
    plane 'yz': outline (y, z) pushed along X."""
    bm = bmesh.new()

    def v(p, a):
        return (p[0], a, p[1]) if plane == "xz" else (a, p[0], p[1])

    F = [bm.verts.new(v(p, a0)) for p in outline]
    B = [bm.verts.new(v(p, a1)) for p in outline]
    bm.faces.new(F)
    bm.faces.new(list(reversed(B)))
    _bridge(bm, F, B)
    ob = _finish(bm, name, key, 30)
    if bevel_w > 0:
        C.bevel(ob, bevel_w, segs)
    return ob


def _tube(name, path, radius, key, seg=8, caps=(True, True), up=(0, 0, 1)):
    """A round tube along a 3D polyline (parallel-transport frames). radius may be f(t in 0..1)."""
    P = [Vector(p) for p in path]
    n = len(P)
    T = [(P[min(i + 1, n - 1)] - P[max(i - 1, 0)]).normalized() for i in range(n)]
    N = T[0].cross(Vector(up))
    if N.length < 1e-6:
        N = T[0].cross(Vector((1, 0, 0)))
    N.normalize()
    rings = []
    for i in range(n):
        if i > 0:
            N = T[i - 1].rotation_difference(T[i]) @ N
            N = (N - T[i] * N.dot(T[i])).normalized()
        B = T[i].cross(N)
        r = radius(i / (n - 1)) if callable(radius) else radius
        rings.append([P[i] + (N * math.cos(a) + B * math.sin(a)) * r
                      for a in (math.tau * k / seg for k in range(seg))])
    return _loft(name, rings, key, True, caps, 50)


def _turn(name, profile, seg, key, fillet=0.0, n=1, caps=(True, True), smooth=50.0, min_turn=35.0):
    """Turned part along +Z from the origin, with filleted profile and turned-wood (or spun-metal) UVs."""
    explicit = any(len(p) > 2 for p in profile)          # per-point radii are honoured even with fillet=0
    prof = _fillet(profile, fillet, n, min_turn) if (fillet > 0 or explicit) else [tuple(p[:2]) for p in profile]
    ob = C.lathe(name, prof, seg, _mat(key), cap_top=caps[1], cap_bottom=caps[0], smooth_angle=smooth)
    if key in SPUN:
        _uv_spun(ob, tex_size(key), prof)
    else:
        _uv_turned(ob, tex_size(key))
    return ob


def _turn_between(name, p0, p1, prof_frac, seg, key, fillet=0.0):
    """A turned part (profile [(r, t in 0..1)]) running from p0 to p1."""
    M, L = _align(p0, p1)
    ob = _turn(name, [(r, t * L) + tuple(x[2:]) for x in prof_frac for r, t in [x[:2]]], seg, key, fillet)
    return _xf(ob, M)


def _uv_turned(ob, size):
    """UVs for wooden parts turned around local Z: U along the axis (the grain), V around."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    rref = max(0.01, max((math.hypot(v.co.x, v.co.y) for v in me.vertices), default=0.01))
    for poly in me.polygons:
        if abs(poly.normal.z) > 0.92:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uv[li].uv = (co.x / size, co.y / size)
            continue
        cos = [me.vertices[me.loops[li].vertex_index].co for li in poly.loop_indices]
        angs = [math.atan2(c.y, c.x) for c in cos]
        if max(angs) - min(angs) > math.pi:
            angs = [a + math.tau if a < 0 else a for a in angs]
        for li, c, a in zip(poly.loop_indices, cos, angs):
            uv[li].uv = (c.z / size, a * rref / size)
    return ob


def _uv_spun(ob, size, prof):
    """UVs for spun/turned metal: U runs round the part (so the brushed texture reads as fine lathe
    marks, concentric on the flats), V follows the profile's arc length."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    s = [0.0]
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        s.append(s[-1] + math.hypot(r1 - r0, z1 - z0))
    arc = []
    for v in me.vertices:
        r = math.hypot(v.co.x, v.co.y)
        i = min(range(len(prof)), key=lambda k: (prof[k][0] - r) ** 2 + (prof[k][1] - v.co.z) ** 2)
        arc.append(s[i])
    for poly in me.polygons:
        lis = list(poly.loop_indices)
        vids = [me.loops[li].vertex_index for li in lis]
        cos = [me.vertices[i].co for i in vids]
        angs = [math.atan2(c.y, c.x) for c in cos]
        if max(angs) - min(angs) > math.pi:
            angs = [a + math.tau if a < 0 else a for a in angs]
        rr = max(0.004, max(math.hypot(c.x, c.y) for c in cos))
        for li, vi, a in zip(lis, vids, angs):
            uv[li].uv = (a * rr / size, arc[vi] / size)
    return ob


def _lathe_loop(name, loop, seg, keys, band_mats, smooth=50.0):
    """Revolves a CLOSED (r, z) loop into a watertight shell; band k (loop[k] -> loop[k+1]) gets
    material index band_mats[k]. Thin-walled turned shells (lamp shades)."""
    bm = bmesh.new()
    rings = [[bm.verts.new((r * math.cos(math.tau * i / seg), r * math.sin(math.tau * i / seg), z))
              for i in range(seg)] for r, z in loop]
    n = len(loop)
    for k in range(n):
        A, B = rings[k], rings[(k + 1) % n]
        for i in range(seg):
            j = (i + 1) % seg
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            f.material_index = band_mats[k]
    return _finish(bm, name, keys, smooth)


def _uvb(ob, key, grain=None):
    C.uv_box(ob, tex_size(key), grain)
    return ob


def _bx(name, a, b, key, bev=0.0, seg=2, grain=None):
    lo = [min(a[i], b[i]) for i in range(3)]
    hi = [max(a[i], b[i]) for i in range(3)]
    ob = C.box_minmax(name, lo, hi, _mat(key), bev, seg)
    return _uvb(ob, key, grain)


def _boolean(ob, cutters, op="DIFFERENCE"):
    for c in cutters:
        mod = ob.modifiers.new("bool", "BOOLEAN")
        mod.operation = op
        mod.object = c
        try:
            mod.solver = "EXACT"
            mod.material_mode = "INDEX"
        except (TypeError, AttributeError):
            pass
    C.apply_modifiers(ob)
    for c in cutters:
        C.remove(c)
    return ob


def _text(name, body, size, depth, key, center=(0, 0), z0=0.0, resolution=1):
    """Raised lettering: a font curve turned into a mesh, centred on `center`, standing on z0.
    The hidden back faces are dropped."""
    cu = bpy.data.curves.new(name, type="FONT")
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.resolution_u = resolution
    cu.align_x = "CENTER"
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < -0.9], context="FACES")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    me.materials.clear()
    me.materials.append(_mat(key))
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    _xf(ob, _T(center[0] - (min(xs) + max(xs)) / 2, center[1] - (min(ys) + max(ys)) / 2, z0 - min(zs)))
    C.shade_flat(ob)
    _uvb(ob, key)
    return ob


def _copy(ob, name=None):
    o2 = ob.copy()
    o2.data = ob.data.copy()
    if name:
        o2.name = name
    C.link(o2)
    return o2


def _join(parts, name):
    parts = [p for p in parts if p is not None]
    if os.environ.get("OVR_DEBUG_TRIS"):
        agg = {}
        for p in parts:
            k = p.name.split(".")[0]
            agg[k] = agg.get(k, 0) + C.tris(p)
        print("PARTS", name, sorted(agg.items(), key=lambda kv: -kv[1]))
    return C.join(parts, name)


# ---------------------------------------------------------------------------
# Communal reading table
# ---------------------------------------------------------------------------

T_W, T_L, T_H = 1.0, 4.0, 0.76
T_TOP = 0.048
Z_UND = T_H - T_TOP          # underside of the top (0.712)
XF, YF = 0.436, 1.906        # outer face of the apron frame
FR_T = 0.006                 # frame stands proud of the apron board
BOARD_T = 0.022
Z_A0, Z_A1 = 0.61, Z_UND + 0.001
Z_O0, Z_O1 = 0.632, 0.688    # panel openings
BLOCK = 0.05                 # corner blocks
Y_TR = 1.70                  # trestle centre lines
Z_FOOT = 0.115
X_COL = 0.24
Z_RAIL0, Z_RAIL1 = 0.150, 0.262          # trestle lower rail
Z_STR0, Z_STR1, STR_HW = 0.160, 0.252, 0.032   # long stretcher (moulded)
Y_POST = 0.65                # intermediate posts, between the chair places
Z_POST_HEAD = 0.654          # top of the post's head block = underside of its cross-bearer
GROMMET_Y = (-1.3, 0.0, 1.3)
GR_HW, GR_HL = 0.036, 0.078   # grommet flange half sizes


def _table_top():
    prof = []
    for k in range(5):                                   # cove under the edge
        t = math.radians(90 * k / 4)
        prof.append((0.002 + 0.02 * math.cos(t), Z_UND + 0.02 * math.sin(t)))
    prof += [(0.0, Z_UND + 0.0215), (0.0, T_H - 0.0075)]  # quirk + 21 mm edge band
    for k in range(1, 5):                                # thumbnail round-over
        t = math.radians(90 * k / 4)
        prof.append((0.0075 - 0.0075 * math.cos(t), T_H - 0.0075 + 0.0075 * math.sin(t)))
    top = _slab("tt_top", _rect(T_W / 2, T_L / 2), 0.025, prof, 3, "tabletop")
    # pockets under the brass grommet flanges (the flange overlaps the pocket edge by 4 mm all round)
    cut = [_slab("cut", _rect(GR_HW - 0.004, GR_HL - 0.004, 0, y), 0.005, [(0, T_H - 0.012), (0, T_H + 0.01)], 2, "tabletop")
           for y in GROMMET_Y]
    _boolean(top, cut)
    _uvb(top, "tabletop", "y")
    C.weighted_normals(top)
    return top


def _spans(a, b, n, end, mid):
    w = (b - a - 2 * end - (n - 1) * mid) / n
    out, y = [], a + end
    for _ in range(n):
        out.append((y, y + w))
        y += w + mid
    return out


def _apron_frame(kind, s, u0, u1, openings, grain):
    """The 6 mm proud frame of one apron face, built directly as a face with openings (no booleans):
    front face, opening reveals down to the board, and the perimeter edges."""
    def P(u, v, w):
        return Vector((s * w, u, v)) if kind == "long" else Vector((u, s * w, v))

    N = Vector((s, 0, 0)) if kind == "long" else Vector((0, s, 0))
    w_face = XF if kind == "long" else YF
    w_back = w_face - FR_T
    bm = bmesh.new()

    def loop(a, b, v0, v1, w):
        return [bm.verts.new(P(u, v, w)) for u, v in ((a, v0), (b, v0), (b, v1), (a, v1))]

    of, ob_ = loop(u0, u1, Z_A0, Z_A1, w_face), loop(u0, u1, Z_A0, Z_A1, w_back)
    hf = [loop(a, b, Z_O0, Z_O1, w_face) for a, b in openings]
    hb = [loop(a, b, Z_O0, Z_O1, w_back) for a, b in openings]
    _cap(bm, [of] + hf, N)
    _bridge_o(bm, of, ob_, P((u0 + u1) / 2, (Z_A0 + Z_A1) / 2, w_face), toward=False, axis=N)
    for (a, b), A, B in zip(openings, hf, hb):
        _bridge_o(bm, A, B, P((a + b) / 2, (Z_O0 + Z_O1) / 2, w_face), toward=True, axis=N)
    ob = _finish(bm, "ap_frame", "walnut", 30, recalc=False)
    return _uvb(ob, "walnut", grain)


def _apron():
    parts = []
    yb, xb = YF - BLOCK, XF - BLOCK
    xo, yo = XF - FR_T, YF - FR_T                      # board faces
    long_open = _spans(-yb, yb, 6, 0.03, 0.045)
    end_open = [(-xb + 0.03, -0.07), (0.07, xb - 0.03)]
    bead = [(-0.0005, -0.0005)] + [(0.0062 * math.cos(math.radians(a)), 0.0062 * math.sin(math.radians(a)))
                                   for a in (0, 45, 90)]
    for s in (-1, 1):
        # long sides (faces +-X)
        parts.append(_bx("ap_board", (s * (xo - BOARD_T), -yb, Z_A0), (s * xo, yb, Z_A1), "walnut", grain="z"))
        parts.append(_apron_frame("long", s, -yb, yb, long_open, "y"))
        for y0, y1 in long_open:
            if s > 0:
                cs = [(s * xo, y0, Z_O0), (s * xo, y1, Z_O0), (s * xo, y1, Z_O1), (s * xo, y0, Z_O1)]
            else:
                cs = [(s * xo, y1, Z_O0), (s * xo, y0, Z_O0), (s * xo, y0, Z_O1), (s * xo, y1, Z_O1)]
            parts.append(_uvb(_mitre_loft("ap_bead", cs, (s, 0, 0), bead, "walnut"), "walnut", "y"))
        # ends (faces +-Y)
        parts.append(_bx("ap_board", (-xb, s * (yo - BOARD_T), Z_A0), (xb, s * yo, Z_A1), "walnut", grain="z"))
        parts.append(_apron_frame("end", s, -xb, xb, end_open, "x"))
        for x0, x1 in end_open:
            if s < 0:
                cs = [(x0, s * yo, Z_O0), (x1, s * yo, Z_O0), (x1, s * yo, Z_O1), (x0, s * yo, Z_O1)]
            else:
                cs = [(x1, s * yo, Z_O0), (x0, s * yo, Z_O0), (x0, s * yo, Z_O1), (x1, s * yo, Z_O1)]
            parts.append(_uvb(_mitre_loft("ap_bead", cs, (0, s, 0), bead, "walnut"), "walnut", "x"))
    # Cove under the top and an astragal bead along the bottom, mitred round the whole apron.
    per = [(-XF, -YF, Z_UND), (XF, -YF, Z_UND), (XF, YF, Z_UND), (-XF, YF, Z_UND)]
    cove = [(0.0, 0.0006)] + [(-0.012 + 0.012 * math.cos(math.radians(a)), -0.012 + 0.012 * math.sin(math.radians(a)))
                              for a in (0, 22.5, 45, 67.5, 90)]
    cove[-1] = (-0.012, 0.0006)
    parts.append(_uvb(_mitre_loft("ap_cove", per, (0, 0, 1), cove, "walnut"), "walnut", "y"))
    per0 = [(x, y, Z_A0) for x, y, _ in per]
    astr = [(0.0035 + 0.0055 * math.cos(a), 0.0055 * math.sin(a)) for a in (math.tau * k / 10 for k in range(10))]
    parts.append(_uvb(_mitre_loft("ap_astragal", per0, (0, 0, 1), astr, "walnut"), "walnut", "y"))
    # Corner blocks with turned paterae and drop finials.
    patera = _turn("patera", [(0.0158, 0.0), (0.0158, 0.0016), (0.0106, 0.0041), (0.0060, 0.0035), (0.0, 0.0068)],
                   24, "walnut", caps=(False, False), smooth=40)
    drop = _turn("drop", [(0.0, 0.0), (0.0070, 0.0050), (0.0096, 0.0170), (0.0058, 0.0310), (0.0100, 0.0390),
                          (0.0070, 0.0470), (0.0135, 0.0600), (0.0148, 0.0705)], 20, "walnut",
                 caps=(False, False))
    z_mid = (Z_A0 + 0.006 + Z_UND - 0.012) / 2
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(_bx("ap_block", (sx * (XF - BLOCK), sy * (YF - BLOCK), Z_A0), (sx * XF, sy * YF, Z_A1), "walnut", 0.002, 1, grain="z"))
            cx, cy = sx * (XF - BLOCK / 2), sy * (YF - BLOCK / 2)
            p = _copy(patera)
            _xf(p, _T(sx * XF, cy, z_mid) @ _Ry(90 * sx))
            parts.append(p)
            p = _copy(patera)
            _xf(p, _T(cx, sy * YF, z_mid) @ _Rx(-90 * sy))
            parts.append(p)
            d = _copy(drop)
            _xf(d, _T(cx, cy, Z_A0 + 0.0006 - 0.0705))
            parts.append(d)
    C.remove(patera)
    C.remove(drop)
    return parts


COLUMN_PROFILE = [            # (r, z[, fillet]) - only the plinth and capital arrises are eased
    (0.046, 0.0), (0.046, 0.016, 0.0025), (0.0372, 0.0275), (0.0402, 0.0375), (0.0368, 0.0475), (0.033, 0.054),
    (0.033, 0.135), (0.0368, 0.143), (0.033, 0.151), (0.028, 0.162), (0.036, 0.200), (0.0415, 0.245),
    (0.0402, 0.285), (0.033, 0.318), (0.024, 0.350), (0.0312, 0.362), (0.026, 0.374), (0.027, 0.390),
    (0.036, 0.405), (0.044, 0.420, 0.002), (0.044, 0.430),
]
POST_PROFILE = [              # intermediate post shaft between its square foot and head blocks (0.37 m)
    (0.0200, 0.0), (0.0200, 0.006), (0.0162, 0.012), (0.0188, 0.019), (0.0150, 0.027), (0.0205, 0.090),
    (0.0236, 0.150), (0.0218, 0.205), (0.0150, 0.262), (0.0135, 0.280), (0.0172, 0.289), (0.0138, 0.298),
    (0.0150, 0.342), (0.0188, 0.356), (0.0200, 0.364), (0.0200, 0.370),
]


def _trestle(sy):
    yc = sy * Y_TR
    parts = []
    half = [(-0.415, 0.0), (-0.30, 0.0), (-0.292, 0.010), (-0.272, 0.020), (-0.235, 0.027), (-0.16, 0.032), (0.0, 0.034)]
    nose = [(0.415, 0.0), (0.428, 0.005), (0.436, 0.016), (0.438, 0.030), (0.434, 0.045), (0.424, 0.056), (0.408, 0.064),
            (0.385, 0.072), (0.360, 0.085), (0.342, 0.100), (0.330, 0.110), (0.318, 0.115)]
    outline = half + [(-x, z) for x, z in reversed(half[:-1])] + nose[1:] + [(-x, z) for x, z in reversed(nose[1:])]
    shoe = _extrude("tr_shoe", outline, yc - 0.0475, yc + 0.0475, "walnut", "xz", 0.004, 1)
    parts.append(_uvb(shoe, "walnut", "x"))
    # 16 sides, arrises crisp by edge angle; no end caps (they sit hidden on the shoe and under the bearer)
    col = _turn("tr_col", COLUMN_PROFILE, 16, "walnut", smooth=31.0, caps=(False, False))
    for sx in (-1, 1):
        c = _copy(col)
        _xf(c, _T(sx * X_COL, yc, Z_FOOT))
        parts.append(c)
    C.remove(col)
    bear_r = [(0.305, 0.545), (0.322, 0.548), (0.335, 0.556), (0.345, 0.570), (0.360, 0.583), (0.380, 0.592),
              (0.392, 0.597), (0.400, 0.603), (0.400, 0.6125)]
    outline = bear_r + [(-x, z) for x, z in reversed(bear_r)]
    parts.append(_uvb(_extrude("tr_bearer", outline, yc - 0.0425, yc + 0.0425, "walnut", "xz", 0.003, 1), "walnut", "x"))
    parts.append(_bx("tr_cleat", (-0.407, yc - 0.03, 0.6125), (0.407, yc + 0.03, Z_UND + 0.0005), "walnut", grain="x"))
    parts.append(_bx("tr_rail", (-X_COL, yc - 0.0225, Z_RAIL0), (X_COL, yc + 0.0225, Z_RAIL1), "walnut", 0.003, 1, grain="x"))
    # keyed through-tenon of the long stretcher, through the rail and 48 mm proud of it
    parts.append(_bx("tr_tenon", (-0.014, sy * (Y_TR - 0.03), 0.180), (0.014, sy * (Y_TR + 0.0225 + 0.048), 0.232),
                     "walnut", 0.0025, 1, grain="y"))
    yk = Y_TR + 0.0225 + 0.025
    key = [(sy * (yk - 0.0045), 0.152), (sy * (yk + 0.0045), 0.152), (sy * (yk + 0.007), 0.262), (sy * (yk - 0.007), 0.262)]
    if sy < 0:
        key = [key[1], key[0], key[3], key[2]]
    parts.append(_uvb(_extrude("tr_key", key, -0.0085, 0.0085, "walnut_dark", "yz", 0.0015, 1), "walnut_dark", "z"))
    return parts


def _stretcher_and_posts():
    """The long stretcher (chamfered top arrises, rounded lower ones) between the trestle rails, and two
    turned intermediate posts standing on it at the chair gaps, each under a shaped cross-bearer that
    carries the middle of the top. They break the 3.4 m span into three bays."""
    parts = []
    w, z0, z1 = STR_HW, Z_STR0, Z_STR1
    prof = [(-w + 0.004, z0), (-w + 0.0012, z0 + 0.0012), (-w, z0 + 0.004), (-w, z1 - 0.006), (-w + 0.006, z1),
            (w - 0.006, z1), (w, z1 - 0.006), (w, z0 + 0.004), (w - 0.0012, z0 + 0.0012), (w - 0.004, z0)]
    prof = [(u, v - z0) for u, v in prof]
    prof.append(prof[0])
    y_end = Y_TR - 0.0225
    st = C.sweep("tr_stretcher", prof, [(0, -y_end, z0), (0, y_end, z0)], _mat("walnut"), cap=False, smooth_angle=35)
    parts.append(_uvb(st, "walnut", "y"))
    z_foot1 = Z_STR1 + 0.034
    z_head0 = Z_POST_HEAD - 0.040
    sc = (z_head0 - z_foot1) / POST_PROFILE[-1][1]
    shaft = _turn("tr_post", [(r, z * sc) for r, z in POST_PROFILE], 14, "walnut", smooth=31.0, caps=(False, False))
    bear = [(0.408, Z_UND + 0.0005), (0.408, 0.684), (0.392, 0.680), (0.372, 0.672), (0.350, 0.663), (0.318, 0.657),
            (0.280, Z_POST_HEAD)]
    bear_outline = bear + [(-x, z) for x, z in reversed(bear)]
    for sy in (-1, 1):
        y = sy * Y_POST
        parts.append(_bx("tr_postfoot", (-0.026, y - 0.026, Z_STR1), (0.026, y + 0.026, z_foot1), "walnut", 0.003, 1, grain="z"))
        s = _copy(shaft)
        _xf(s, _T(0, y, z_foot1))
        parts.append(s)
        parts.append(_bx("tr_posthead", (-0.027, y - 0.027, z_head0), (0.027, y + 0.027, Z_POST_HEAD), "walnut", 0.003, 1, grain="z"))
        parts.append(_uvb(_extrude("tr_postbearer", bear_outline, y - 0.032, y + 0.032, "walnut", "xz", 0.003, 1), "walnut", "x"))
    C.remove(shaft)
    return parts


def _grommet():
    """Brass power grommet (centre x = y = 0): a 2 mm flange with a rounded edge sitting on the top over a
    pocket, two round socket recesses (pins) and two USB-C slots, all built as bridged loops (no booleans)."""
    Z = T_H
    zt = Z + 0.002
    z_ins = Z + 0.0005            # insert face, 1.5 mm below the flange
    z_fl = Z - 0.0065             # socket recess floor
    bm = bmesh.new()
    up = Vector((0, 0, 1))

    def ring(pts2, z):
        return [bm.verts.new((p[0], p[1], z)) for p in pts2]

    corners = _rect(GR_HW, GR_HL)
    prof = [(0.0, Z), (0.0, Z + 0.0007), (0.0012, Z + 0.0016), (0.0032, zt)]
    rings = [ring(_rpoly(corners, 0.009, d, 4), z) for d, z in prof]
    for A, B in zip(rings, rings[1:]):
        _bridge_o(bm, A, B, (0, 0, Z - 0.05), toward=False)
    sock_y, usb_y = (-0.042, 0.042), (-0.0075, 0.0075)
    socks = [ring(_rpoly(_rect(0.0205, 0.0205, 0, y), 0.006, 0, 3), zt) for y in sock_y]
    usbs = [ring(_rpoly(_rect(0.0044, 0.0016, 0, y), 0.0014, 0, 1), zt) for y in usb_y]
    _cap(bm, [rings[-1]] + socks + usbs, up)
    for y, top in zip(sock_y, socks):
        low = [bm.verts.new((v.co.x, v.co.y, z_ins)) for v in top]
        _bridge_o(bm, top, low, (0, y, zt))                       # brass reveal
        c_in = ring(_circle(0.0172, 32, 0, y), z_ins)
        _cap(bm, [low, c_in], up, 1)                              # insert face
        c_fl = ring(_circle(0.0172, 32, 0, y), z_fl)
        _bridge_o(bm, c_in, c_fl, (0, y, z_ins), mi=1)            # recess wall
        pins = [ring(_circle(0.0022, 8, x, y), z_fl) for x in (-0.0095, 0.0095)]
        _cap(bm, [c_fl] + pins, up, 1)
        for x, p in zip((-0.0095, 0.0095), pins):
            pb = [bm.verts.new((v.co.x, v.co.y, z_fl - 0.004)) for v in p]
            _bridge_o(bm, p, pb, (x, y, z_fl), mi=1)
            _ngon(bm, pb, up, 1)
    for y, top in zip(usb_y, usbs):
        low = [bm.verts.new((v.co.x, v.co.y, Z - 0.003)) for v in top]
        _bridge_o(bm, top, low, (0, y, zt), mi=1)
        _ngon(bm, low, up, 1)
    plate = _finish(bm, "gr_plate", ["brass", "plastic_dark"], 40, recalc=False)
    _uvb(plate, "brass", "y")
    parts = [plate]
    screw = _turn("gr_screw", [(0.0025, 0.0), (0.0020, 0.0009), (0.0, 0.0013)], 12, "brass_aged", caps=(False, False))
    for sy in (-1, 1):
        s = _copy(screw)
        _xf(s, _T(0, sy * 0.0687, zt))
        parts.append(s)
    C.remove(screw)
    return _join(parts, "grommet")


def _plaque(number):
    """Brass table-number plaque with a raised rim and raised dark lettering, on the -Y end apron."""
    hw, hh = 0.045, 0.021
    base = _slab("pl_base", _rect(hw, hh), 0.006, [(0, 0), (0, 0.0016), (0.0007, 0.0026), (0.0017, 0.0031),
                                                   (0.0032, 0.0031), (0.0040, 0.0024)], 3, "brass")
    _uvb(base, "brass", "x")
    C.weighted_normals(base)
    parts = [base,
             _text("pl_t1", "TABLE", 0.0082, 0.0005, "bronze", (0, 0.0105), 0.0023, 1),
             _text("pl_t2", str(number), 0.021, 0.0006, "bronze", (0, -0.0045), 0.0023, 2)]
    screw = _turn("pl_screw", [(0.0026, 0.0), (0.0021, 0.0009), (0.0, 0.0014)], 12, "brass_aged", caps=(False, False))
    for sx in (-1, 1):
        s = _copy(screw)
        _xf(s, _T(sx * 0.0355, 0.0, 0.0022))
        parts.append(s)
    C.remove(screw)
    ob = _join(parts, "plaque")
    return _xf(ob, _T(0, -YF - 0.0003, (Z_A0 + Z_UND) / 2 - 0.002) @ _Rx(90))


def build_table_communal(number=1):
    """The 1.0 x 4.0 x 0.76 m communal reading table (oak top, walnut base), front end at -Y."""
    parts = [_table_top()]
    parts += _apron()
    for sy in (-1, 1):
        parts += _trestle(sy)
    parts += _stretcher_and_posts()
    g = _grommet()
    for y in GROMMET_Y:
        gg = _copy(g)
        _xf(gg, _T(0, y, 0))
        parts.append(gg)
    C.remove(g)
    parts.append(_plaque(number))
    ob = _join(parts, f"Furniture_Table_Communal_{number:02d}")
    return ob


# ---------------------------------------------------------------------------
# Reading chair
# ---------------------------------------------------------------------------

SEAT_CORNERS = [(-0.226, -0.236), (0.0, -0.247), (0.226, -0.236), (0.198, 0.16), (-0.198, 0.16)]
SEAT_RADII = [0.045, 0.6, 0.045, 0.03, 0.03]
SEAT_SEG = [5, 2, 5, 3, 3]
Z_SEAT_RAIL0, Z_LEATHER0 = 0.37, 0.41      # 40 mm beaded seat rail, leather pad on top
Z_NAIL = 0.4183
# back leg / stile centre line (y, z); x runs from 0.200 at the floor to 0.180 from the seat up
STILE_PTS = [(0.222, 0.0), (0.205, 0.15), (0.186, 0.30), (0.175, 0.41), (0.177, 0.50), (0.190, 0.62),
             (0.204, 0.74), (0.216, 0.85), (0.222, 0.905)]
CR_C = 0.45                      # plan curvature of the back rails (y = ymid - c x^2)
CR_ZB, CR_H, CR_ARCH = 0.872, 0.066, 0.012
LR_ZB, LR_H = 0.585, 0.034
FRONT_LEG_PROFILE = [
    (0.0125, 0.0), (0.0140, 0.002), (0.0150, 0.010), (0.0135, 0.016), (0.0120, 0.020), (0.0150, 0.028),
    (0.0158, 0.034), (0.0148, 0.040), (0.0128, 0.045), (0.0140, 0.100), (0.0152, 0.150), (0.0170, 0.180),
    (0.0178, 0.186), (0.0168, 0.193), (0.0150, 0.200), (0.0168, 0.235), (0.0190, 0.268), (0.0186, 0.290),
    (0.0162, 0.305), (0.0145, 0.312), (0.0175, 0.318), (0.0182, 0.326), (0.0175, 0.332), (0.0185, 0.338),
    (0.0185, 0.3505),
]
SPINDLE_PROFILE = [
    (0.0072, 0.0), (0.0072, 0.035), (0.0094, 0.055), (0.0100, 0.070), (0.0084, 0.088), (0.0102, 0.18),
    (0.0116, 0.27), (0.0110, 0.35), (0.0086, 0.48), (0.0071, 0.80), (0.0084, 0.86), (0.0090, 0.885),
    (0.0074, 0.91), (0.0068, 1.0),
]
STRETCHER_PROFILE = [
    (0.0072, 0.0), (0.0072, 0.05), (0.0100, 0.085), (0.0112, 0.105), (0.0094, 0.13), (0.0104, 0.30),
    (0.0118, 0.50), (0.0104, 0.70), (0.0094, 0.87), (0.0112, 0.895), (0.0100, 0.915), (0.0072, 0.95),
    (0.0072, 1.0),
]
# leather pad: (inset from the seat outline, z) - a 14 mm nailed band, a soft roll over the edge,
# then a crown of about 13 mm towards the middle
PAD_PROFILE = [(0.0, Z_LEATHER0), (0.0, 0.4245), (0.0010, 0.4308), (0.0036, 0.4362), (0.0078, 0.4402),
               (0.0135, 0.4430), (0.0210, 0.4448), (0.034, 0.4464), (0.055, 0.4492), (0.080, 0.4528),
               (0.107, 0.4558), (0.134, 0.4580), (0.158, 0.4592)]
PAD_TOP = 0.4596


def _stile_path():
    pts = [Vector((0.0, y, z)) for y, z in STILE_PTS]
    return _catmull(pts, 3)


def _stile_at_z(z):
    path = _stile_path()
    for a, b in zip(path, path[1:]):
        if a.z <= z <= b.z:
            t = (z - a.z) / max(b.z - a.z, 1e-9)
            return a.lerp(b, t)
    return path[-1]


def _stile_x(z):
    return 0.200 - 0.020 * min(1.0, z / 0.41)


def _chair_stile(sx):
    path = _stile_path()
    n = len(path)
    rings = []
    for i, P in enumerate(path):
        a, b = path[max(i - 1, 0)], path[min(i + 1, n - 1)]
        T = (b - a).normalized()
        X = Vector((1, 0, 0))
        N = X.cross(T).normalized()
        depth = 0.034 if P.z < 0.45 else 0.034 - 0.0095 * min(1.0, (P.z - 0.45) / 0.42)
        width = 0.032 if P.z < 0.45 else 0.032 - 0.003 * min(1.0, (P.z - 0.45) / 0.42)
        sec = _rpoly(_rect(width / 2, depth / 2), 0.0085, 0, 2)
        c = Vector((sx * _stile_x(P.z), P.y, P.z))
        ring = [c + X * u + N * v for u, v in sec]
        if i == 0:
            ring = [Vector((p.x, p.y, 0.0)) for p in ring]
        rings.append(ring)
    ob = _loft("ch_stile", rings, CHAIR_WOOD, smooth=50)
    return _uvb(ob, CHAIR_WOOD, "z")


def _curved_rail(name, zb, h, half_t, x_end, ymid, radii, seg, ears=False, arch=0.0):
    sec = _rpoly(_rect(half_t, h / 2, 0, h / 2), radii, 0, seg)
    xs = []
    if ears:
        core = 0.19
        xs += [-(core + 0.025 * math.sin(math.radians(a))) for a in (80, 64, 46, 26)]
        xs += [-core + 2 * core * k / 18 for k in range(19)]
        xs += [core + 0.025 * math.sin(math.radians(a)) for a in (26, 46, 64, 80)]
    else:
        xs = [-x_end + 2 * x_end * k / 14 for k in range(15)]
    rings = []
    for x in xs:
        y = ymid - CR_C * x * x
        Nh = Vector((2 * CR_C * x, 1.0, 0.0)).normalized()
        sc_v = sc_u = 1.0
        if ears and abs(x) > 0.19:
            e = (abs(x) - 0.19) / 0.025
            sc_v = math.sqrt(max(0.0, 1 - e * e))
            sc_u = 0.65 + 0.35 * sc_v
        ring = []
        for u, v in sec:
            vv = h / 2 + (v - h / 2) * sc_v
            lift = arch * max(0.0, 1 - (x / 0.215) ** 2) * (vv / h)
            ring.append(Vector((x, y, zb)) + Nh * (u * sc_u) + Vector((0, 0, vv + lift)))
        rings.append(ring)
    ob = _loft(name, rings, CHAIR_WOOD, smooth=45)
    return _uvb(ob, CHAIR_WOOD, "x")


PAD_CROWN_D = 0.034          # inset where the edge roll ends and the crown begins
_PAD_K = []


def _pad_dense(ring):
    """Adds evenly spaced points along the long straight runs of a seat contour (the same number on
    every contour, fixed from the seat outline), so the crown has no long sliver quads."""
    if not _PAD_K:
        base = _rpoly(SEAT_CORNERS, SEAT_RADII, 0.0, SEAT_SEG)
        _PAD_K.extend(max(0, math.ceil((base[(i + 1) % len(base)] - base[i]).length / 0.05) - 1)
                      for i in range(len(base)))
    out = []
    for i, p in enumerate(ring):
        q = ring[(i + 1) % len(ring)]
        out.append(p)
        for k in range(1, _PAD_K[i] + 1):
            out.append(p.lerp(q, k / (_PAD_K[i] + 1)))
    return out


def _pad_ring(d):
    """Contour of the leather pad at inset d. Up to PAD_CROWN_D it is the seat outline offset inward
    (the nailed band and the roll). Further in, the contours shrink towards the seat centre while
    morphing into a rounded superellipse, so the crown is a smooth cushion and never shows the
    hip-roof creases that plain offset contours (with ever sharper corners) give it."""
    if d <= PAD_CROWN_D + 1e-9:
        return _pad_dense(_rpoly(SEAT_CORNERS, SEAT_RADII, d, SEAT_SEG))
    B = _pad_dense(_rpoly(SEAT_CORNERS, SEAT_RADII, PAD_CROWN_D, SEAT_SEG))
    cx = (min(p.x for p in B) + max(p.x for p in B)) / 2
    cy = (min(p.y for p in B) + max(p.y for p in B)) / 2
    rx = max(abs(p.x - cx) for p in B)
    ry = max(abs(p.y - cy) for p in B)
    s = max(0.12, 1.0 - (d - PAD_CROWN_D) / 0.150)        # shrink factor (1 at the roll)
    w = 1.0 - s
    w = w * w * (3 - 2 * w)                               # smoothstep: outline -> superellipse
    out = []
    for p in B:
        a = math.atan2(p.y - cy, p.x - cx)
        ca, sa = abs(math.cos(a)), abs(math.sin(a))
        re = ((ca / rx) ** 2.6 + (sa / ry) ** 2.6) ** (-1 / 2.6)
        e = Vector((cx + re * math.cos(a), cy + re * math.sin(a)))
        q = p.lerp(e, w)
        out.append(Vector((cx + (q.x - cx) * s, cy + (q.y - cy) * s)))
    return out


def _seat_pad():
    """Leather pad: a low nailed band, a soft roll over the edge and a ~14 mm crown with a slight dish
    where the sitter rests (rear centre)."""
    rings = []
    for d, z in PAD_PROFILE:
        ring = []
        w = min(1.0, max(0.0, (d - 0.03) / 0.07))
        for p in _pad_ring(d):
            dish = 0.0032 * w * math.exp(-((p.y - 0.035) / 0.11) ** 2) * math.exp(-(p.x / 0.17) ** 2)
            ring.append(Vector((p.x, p.y, z - dish)))
        rings.append(ring)
    bm = bmesh.new()
    Rr = [[bm.verts.new(p) for p in ring] for ring in rings]
    for A, B in zip(Rr, Rr[1:]):
        _bridge(bm, A, B, True)
    inner = rings[-1]
    cx = sum(p.x for p in inner) / len(inner)
    cy = sum(p.y for p in inner) / len(inner)
    dish = 0.0032 * math.exp(-((cy - 0.035) / 0.11) ** 2) * math.exp(-(cx / 0.17) ** 2)
    ctr = bm.verts.new((cx, cy, PAD_TOP - dish))
    last = Rr[-1]
    for i in range(len(last)):
        bm.faces.new((last[i], last[(i + 1) % len(last)], ctr))
    seat = _finish(bm, "ch_leather", CHAIR_LEATHER, 40)
    _uvb(seat, CHAIR_LEATHER, "y")      # plain smooth normals: a cushion is not a hard surface
    return seat


def _leather_seat():
    seat = _seat_pad()
    z0 = Z_SEAT_RAIL0
    # 40 mm seat rail: plain face, a fine quirk, then a rounded bead on the lower edge
    rail_prof = [(0.0, Z_LEATHER0 - 0.0002), (0.0, z0 + 0.0155), (0.0013, z0 + 0.0150), (0.0006, z0 + 0.0102),
                 (0.0024, z0 + 0.0046), (0.0058, z0 + 0.0012), (0.0100, z0), (0.0260, z0),
                 (0.0260, Z_LEATHER0 - 0.0002)]
    rail = _slab("ch_seatrail", SEAT_CORNERS, SEAT_RADII, rail_prof, SEAT_SEG, CHAIR_WOOD, closed_profile=True)
    _uvb(rail, CHAIR_WOOD, "x")
    under = _slab("ch_seatboard", SEAT_CORNERS, SEAT_RADII, [(0.025, z0 + 0.024), (0.025, Z_LEATHER0 - 0.0015)], SEAT_SEG, CHAIR_WOOD)
    _uvb(under, CHAIR_WOOD, "x")
    # Brass domed nails along the low band of the leather (front and sides).
    ring = _rpoly(SEAT_CORNERS, SEAT_RADII, 0.0, SEAT_SEG)
    k0 = sum(s + 1 for s in SEAT_SEG[:4])          # first point of the back-left arc
    poly = ring[k0:] + ring[:k0]
    # trim the back edge: keep the open run from the left side round the front to the right side
    i0 = next(i for i, p in enumerate(poly) if p.y < 0.135)
    i1 = len(poly) - 1 - next(i for i, p in enumerate(reversed(poly)) if p.y < 0.135)
    run = poly[i0:i1 + 1]
    seglen = [(b - a).length for a, b in zip(run, run[1:])]
    total = sum(seglen)
    count = 28
    nail = _turn("ch_nail", [(0.0054, 0.0), (0.0047, 0.0015), (0.0029, 0.0028), (0.0, 0.0033)], 10, "brass", caps=(False, False))
    nails = []
    for k in range(count):
        target = (k + 0.5) * total / count
        acc = 0.0
        for j, L in enumerate(seglen):
            if acc + L >= target:
                t = (target - acc) / L
                p = run[j].lerp(run[j + 1], t)
                e = (run[j + 1] - run[j]).normalized()
                out = Vector((e.y, -e.x, 0.0))
                n = _copy(nail)
                q = Vector((0, 0, 1)).rotation_difference(out)
                M = Matrix.Translation((p.x - out.x * 0.0003, p.y - out.y * 0.0003, Z_NAIL)) @ q.to_matrix().to_4x4()
                _xf(n, M)
                nails.append(n)
                break
            acc += L
    C.remove(nail)
    return [seat, rail, under] + nails


def build_chair_reading():
    """Spindle-back library side chair, 0.48 x 0.50 x 0.95 m, seat 0.46 m, sitter faces -Y."""
    parts = _leather_seat()
    for sx in (-1, 1):
        parts.append(_chair_stile(sx))
    stile_top = _stile_at_z(0.905)
    ymid_cr = stile_top.y + CR_C * 0.181 ** 2
    parts.append(_curved_rail("ch_crest", CR_ZB, CR_H, 0.0135, 0.215, ymid_cr, [0.004, 0.004, 0.0115, 0.0115], [1, 1, 3, 3],
                              ears=True, arch=CR_ARCH))
    lr = _stile_at_z(LR_ZB + LR_H / 2)
    ymid_lr = lr.y + CR_C * 0.181 ** 2
    parts.append(_curved_rail("ch_lowrail", LR_ZB, LR_H, 0.011, 0.184, ymid_lr, 0.005, 2))
    for x in (-0.104, -0.052, 0.0, 0.052, 0.104):
        p0 = (x, ymid_lr - CR_C * x * x, LR_ZB + LR_H - 0.008)
        p1 = (x, ymid_cr - CR_C * x * x, CR_ZB + 0.008)
        parts.append(_turn_between("ch_spindle", p0, p1, SPINDLE_PROFILE, 10, CHAIR_WOOD, 0.0012))
    # turned front legs, splayed a little forward and out
    legs_top = []
    for sx in (-1, 1):
        top = Vector((sx * 0.2055, -0.2105, Z_SEAT_RAIL0 + 0.0005))
        bot = Vector((sx * 0.2175, -0.2225, 0.0))
        M, L = _align(bot, top)
        prof = [(r, z * L / 0.3505) for r, z in FRONT_LEG_PROFILE]
        leg = _turn("ch_leg", prof, 14, CHAIR_WOOD, fillet=0.0012)
        _xf(leg, M)
        for v in leg.data.vertices:
            if v.co.z < 0.0012:
                v.co.z = max(0.0, v.co.z) if v.co.z > 0.0008 else 0.0
        parts.append(leg)
        legs_top.append((bot, top))
    # turned H-stretcher
    zs = 0.16
    side_mid = []
    for (bot, top), sx in zip(legs_top, (-1, 1)):
        pf = bot.lerp(top, (zs - bot.z) / (top.z - bot.z))
        st = _stile_at_z(zs)
        pb = Vector((sx * _stile_x(zs), st.y, zs))
        parts.append(_turn_between("ch_stretch", pf, pb, STRETCHER_PROFILE, 10, CHAIR_WOOD, 0.001))
        side_mid.append(pf.lerp(pb, 0.46))
    parts.append(_turn_between("ch_stretch", side_mid[0], side_mid[1], STRETCHER_PROFILE, 10, CHAIR_WOOD, 0.001))
    return _join(parts, "Furniture_Chair_Reading_01")


# ---------------------------------------------------------------------------
# Lamps
# ---------------------------------------------------------------------------

BULB_COLOR = "#ffd59a"
SHADE_T = 0.00275            # wall of the brass lamp's shade
SHADE_RIM = 0.345            # underside of its rolled rim


def _ball_chain(parts, x, y, z_top, z_end, pitch=0.0048, r=0.0016, seg=6):
    """A brass ball pull chain hanging straight down, ending in a turned drop. Returns the drop's top z."""
    ball = C.sphere("chain_ball", r, (0, 0, 0), _mat("brass"), seg, 3)
    z = z_top
    while z > z_end:
        b = _copy(ball)
        _xf(b, _T(x, y, z))
        parts.append(b)
        z -= pitch
    C.remove(ball)
    drop = _turn("chain_pull", [(0.0, 0.0), (0.0040, 0.0030), (0.0056, 0.0090), (0.0048, 0.0160), (0.0026, 0.0220),
                                (0.0016, 0.0265), (0.0, 0.0285)], 10, "brass", caps=(False, False))
    z_drop = z + pitch - r - 0.0285 + 0.0006
    _xf(drop, _T(x, y, z_drop))
    parts.append(drop)
    return z_drop + 0.0285


def _shade_loop():
    """Closed (r, z) section of the reading-lamp shade, and its per-band materials (0 bronze, 1 ivory).

    The OUTER surface is a gently convex truncated cone (empire shade) from a rolled rim (0.305 m across)
    to a small shoulder (0.12 m across) and a flat top with a collar round the stem. The INNER surface is
    generated from it by offsetting each point SHADE_T along its inward normal, so the shell can never
    turn inside out."""
    B0 = Vector((0.1505, SHADE_RIM + 0.0045))          # outer wall meets the rolled rim
    B2 = Vector((0.0615, 0.5245))                     # outer wall meets the shoulder
    d = B2 - B0
    B1 = (B0 + B2) / 2 + Vector((d.y, -d.x)).normalized() * 0.010     # convexity (bulges outward)
    Tn = (B2 - B1).normalized()
    S1 = B2 + Tn * ((0.5345 - B2.y) / Tn.y)            # tangent line meets the top plane
    S2 = Vector((0.0450, 0.5357))
    TOP = Vector((0.0175, 0.5378))                     # where the collar rises
    outer = [_bez2(B0, B1, B2, t) for t in (0.0, 0.26, 0.52, 0.77)] + [B2, _bez2(B2, S1, S2, 0.5), S2, TOP]
    # inward normals (left of the rim -> top direction), mitred so the wall keeps its thickness
    inner = []
    for i, p in enumerate(outer):
        a = outer[max(i - 1, 0)]
        b = outer[min(i + 1, len(outer) - 1)]
        if i == 0:
            tang = (_bez2(B0, B1, B2, 0.01) - B0).normalized()
        elif i == len(outer) - 1:
            tang = (TOP - S2).normalized()
        else:
            tang = (b - a).normalized()
        nrm = Vector((-tang.y, tang.x))
        if 0 < i < len(outer) - 1:
            n1 = Vector((-(p - a).normalized().y, (p - a).normalized().x))
            n2 = Vector((-(b - p).normalized().y, (b - p).normalized().x))
            nrm = (n1 + n2).normalized()
            nrm = nrm / max(0.5, nrm.dot(n1))
        inner.append(p + nrm * SHADE_T)
    inner = [q for i, q in enumerate(inner) if i not in (3, 5)]   # the plain ivory inside needs fewer rings
    z_it = inner[-1].y
    # check: the inner surface lies at least 2 mm inside the outer one at every height
    for q in inner:
        for a, b in zip(outer, outer[1:]):
            if a.y <= q.y <= b.y and b.y > a.y:
                r_out = a.x + (b.x - a.x) * (q.y - a.y) / (b.y - a.y)
                assert q.x < r_out - 0.002, f"shade wall too thin at z={q.y:.4f}: inner {q.x:.4f} outer {r_out:.4f}"
    collar = [Vector((0.0175, 0.5435)), Vector((0.0081, 0.5435)), Vector((0.0081, z_it))]
    # rolled rim: a 5.6 mm bead turned outward round the bottom edge, joining the inner wall back to the outer
    rb = 0.0028
    c = B0 - Vector((math.cos(math.radians(110)), math.sin(math.radians(110)))) * rb
    roll = [c + Vector((math.cos(math.radians(a)), math.sin(math.radians(a)))) * rb for a in (-150, -85, -20, 45)]
    loop = outer + collar + list(reversed(inner)) + roll
    n_out = len(outer) + len(collar)
    # outer + collar + bore: bronze; inner top and inner wall: ivory enamel; rolled rim: bronze
    band = [0] * (n_out - 1) + [1] * len(inner) + [0] * (len(roll) + 1)
    assert len(band) == len(loop)
    return [(p.x, p.y) for p in loop], band


def build_lamp_desk_brass():
    """Ref 1's reading lamp: moulded brass base, turned stem running up through a tall bronze empire shade
    (ivory enamel inside, rolled rim) to a finial, and a two-light cluster whose warm globe bulbs hang
    just inside the rim; a ball pull chain hangs from one socket's switch. About 0.57 m tall."""
    parts = []
    parts.append(_turn("lb_base", [
        (0.0850, 0.0), (0.0858, 0.0058), (0.0790, 0.0115), (0.0690, 0.0205), (0.0632, 0.0262), (0.0632, 0.0300),
        (0.0570, 0.0342), (0.0420, 0.0435), (0.0240, 0.0512), (0.0186, 0.0566), (0.0, 0.0566)], 40, "brass_aged"))
    parts.append(_turn("lb_stem", [
        (0.0160, 0.0560), (0.0105, 0.0690), (0.0180, 0.0900), (0.0180, 0.1010), (0.0094, 0.1250), (0.0090, 0.2050),
        (0.0132, 0.2150), (0.0132, 0.2220), (0.0090, 0.2320), (0.0086, 0.3080), (0.0120, 0.3260), (0.0080, 0.3480),
        (0.0078, 0.5440)], 16, "brass_aged", caps=(False, True)))
    # two-light cluster under the shade
    parts.append(_turn("lb_cluster", [(0.0078, 0.4230), (0.0118, 0.4255), (0.0160, 0.4335), (0.0168, 0.4440),
                                       (0.0120, 0.4530), (0.0080, 0.4570)], 14, "brass_aged", caps=(False, False)))
    socket = _turn("lb_socket", [(0.0100, 0.3925), (0.0118, 0.3955), (0.0118, 0.4140), (0.0098, 0.4190), (0.0058, 0.4205)],
                   12, "brass_aged", caps=(False, True))
    # small globe bulb: a true sphere (r 19 mm) running into its neck, so its outline stays round
    gz, gr = 0.3740, 0.0190
    globe = [(gr * math.cos(math.radians(a)), gz + gr * math.sin(math.radians(a))) for a in (-90, -64, -38, -12, 14, 40)]
    bulb = _turn("lb_bulb", globe + [(0.0098, 0.3905), (0.0088, 0.3932)], 20, "bulb", caps=(False, False))
    lights = []
    for sx in (-1, 1):
        x = sx * 0.054
        arm = [(sx * 0.012, 0, 0.4440), (sx * 0.028, 0, 0.4455), (sx * 0.044, 0, 0.4380), (x, 0, 0.4205)]
        parts.append(_tube("lb_arm", _catmull(arm, 2), 0.0040, "brass_aged", 6, caps=(False, False)))
        for src in (socket, bulb):
            c = _copy(src)
            _xf(c, _T(x, 0, 0))
            parts.append(c)
        lights.append((x, 0.0, 0.372))
    C.remove(socket)
    C.remove(bulb)
    # key switch on the +X socket, pull chain hanging from it in front of the bulb
    sw = C.cylinder("lb_switch", 0.0026, 0.0026, 0.0125, (0.054, -0.0176, 0.4065), _mat("brass_aged"), 10, rot=C.rotx(90))
    parts.append(_uvb(sw, "brass_aged", "y"))
    parts.append(_xf(_turn("lb_switchknob", [(0.0, 0.0), (0.0034, 0.0006), (0.0036, 0.0030), (0.0, 0.0040)], 10, "brass", caps=(False, False)),
                     _T(0.054, -0.0238, 0.4065) @ _Rx(90)))
    drop_top = _ball_chain(parts, 0.054, -0.0262, 0.4030, SHADE_RIM - 0.024, pitch=0.005, seg=5)
    assert SHADE_RIM - 0.030 < drop_top < SHADE_RIM - 0.018, drop_top   # drop hangs 20-30 mm below the rim
    # shade
    loop, band = _shade_loop()
    shade = _lathe_loop("lb_shade", loop, 48, ["bronze", "ivory_paint"], band, 50)
    _uv_turned(shade, tex_size("bronze"))
    parts.append(shade)
    parts.append(_turn("lb_finial", [(0.0145, 0.5435), (0.0150, 0.5462), (0.0112, 0.5492), (0.0064, 0.5512), (0.0050, 0.5532),
                                     (0.0088, 0.5582), (0.0094, 0.5622), (0.0068, 0.5662), (0.0, 0.5682)], 12, "brass", caps=(False, False)))
    ob = _join(parts, "Prop_Lamp_Brass_01")
    ob["light_offset"] = (0.0, 0.0, 0.372)
    ob["light_points"] = [list(p) for p in lights]
    ob["light_color"] = BULB_COLOR
    return ob


def _banker_shade(L=0.26, W=0.068, H=0.064, t=0.0028, nu=30, nv=16, p=6.0):
    """Cased glass shade: green outside, opal white inside, open underneath (local: axis X, rim at z=0)."""
    def f(s):
        return max(0.0, 1 - abs(s) ** p) ** (1 / p)

    def pt(s, a, off):
        fs = f(s)
        flare = 1 + 0.07 * (1 - math.sin(a)) ** 3
        return Vector((s * (L / 2 - off), -(W - off) * math.cos(a) * fs * flare, (H - off) * math.sin(a) * fs))

    ss = [math.sin(math.pi / 2 * (-1 + 2 * i / (nu - 1))) for i in range(nu)]
    aa = [math.pi * j / (nv - 1) for j in range(nv)]
    bm = bmesh.new()
    O = [[bm.verts.new(pt(s, a, 0.0)) for a in aa] for s in ss]
    I = [[bm.verts.new(pt(s, a, t)) for a in aa] for s in ss]
    for i in range(nu - 1):
        for j in range(nv - 1):
            for G, mi in ((O, 0), (I, 1)):
                try:
                    f_ = bm.faces.new((G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1]))
                    f_.material_index = mi
                except ValueError:
                    pass
        for j in (0, nv - 1):
            try:
                bm.faces.new((O[i][j], O[i + 1][j], I[i + 1][j], I[i][j]))
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-7)
    ob = _finish(bm, "bk_shade", ["glass_green_cased", "ivory_paint"], 60)
    _uvb(ob, "glass_green_cased", "x")
    return ob, pt


def build_lamp_banker_green():
    """Ref 3's green-glass banker's lamp: stepped brass base, curved arm, pull chain (about 0.39 m)."""
    parts = []
    base = _slab("bk_base", _rect(0.115, 0.08), 0.042, [
        (0.0, 0.0), (0.0, 0.0055), (0.0012, 0.0085), (0.0035, 0.0102), (0.0065, 0.0108), (0.0072, 0.0122),
        (0.0072, 0.0135), (0.0085, 0.0158), (0.0115, 0.0182), (0.0155, 0.0198), (0.0200, 0.0205), (0.0300, 0.0212)],
        6, "brass")
    _uvb(base, "brass", "x")
    C.weighted_normals(base)
    parts.append(base)
    ys = 0.034
    z0 = 0.0212
    stem = _turn("bk_stem", [(0.014, 0.0), (0.014, 0.0035), (0.0115, 0.0065), (0.0095, 0.010), (0.0125, 0.022), (0.0136, 0.029),
                             (0.0118, 0.037), (0.0080, 0.047), (0.0075, 0.175), (0.0096, 0.180), (0.0096, 0.190),
                             (0.0075, 0.195), (0.0075, 0.236)], 16, "brass", fillet=0.0008, caps=(False, True))
    _xf(stem, _T(0, ys, z0 - 0.0004))
    parts.append(stem)
    # ferrule where the upright becomes the bent arm tube
    parts.append(_xf(_turn("bk_ferrule", [(0.0080, 0.0), (0.0092, 0.0012), (0.0092, 0.0078), (0.0080, 0.0090)], 16, "brass",
                           caps=(False, False)), _T(0, ys, z0 + 0.2275)))
    tilt, y_s, z_s = 8.0, -0.055, 0.30
    Ms = _T(0, y_s, z_s) @ _Rx(tilt)
    shade, pt = _banker_shade()
    _xf(shade, Ms)
    parts.append(shade)
    # saddle band that clips the shade to the arm
    aa = [math.pi * (0.34 + 0.32 * k / 8) for k in range(9)]
    sec_out = [pt(0, a, -0.0018) for a in aa]
    sec_in = [pt(0, a, 0.0) for a in reversed(aa)]
    sec = [Vector((0.0, v.y, v.z)) for v in sec_out + sec_in]
    band = _loft("bk_band", [[v + Vector((x, 0, 0)) for v in sec] for x in (-0.008, 0.008)], "brass")
    _xf(band, Ms)
    parts.append(band)
    top = Ms @ Vector((0, 0, 0.064 + 0.0018))
    post_top = top + Vector((0, 0, 0.011))
    parts.append(C.cylinder("bk_post", 0.0058, 0.0058, 0.013, (top.x, top.y, top.z + 0.0055), _mat("brass"), 16))
    arm = _catmull([(0, ys, z0 + 0.232), (0, ys, z0 + 0.27), (0, ys - 0.004, 0.33), (0, ys - 0.018, 0.362),
                    (0, ys - 0.040, post_top.z + 0.006), (0, post_top.y + 0.004, post_top.z)], 4)
    parts.append(_tube("bk_arm", arm, 0.0072, "brass", 12, caps=(False, False), up=(1, 0, 0)))
    parts.append(_xf(_turn("bk_knob", [(0.0085, 0.0), (0.0092, 0.003), (0.0078, 0.0065), (0.0045, 0.0088), (0.0, 0.0095)], 16, "brass", fillet=0.0008),
                     _T(post_top.x, post_top.y, post_top.z - 0.002)))
    # socket and bulb hanging inside the shade
    sock = _turn("bk_socket", [(0.0110, 0.0), (0.0118, 0.004), (0.0118, 0.020), (0.0105, 0.0235)], 16, "brass_aged", fillet=0.001)
    zt = 0.064 - 0.0028 + 0.001
    _xf(sock, Ms @ _T(0, 0, zt - 0.0235))
    parts.append(sock)
    bulb = _turn("bk_bulb", [(0.0, 0.0), (0.008, 0.0015), (0.015, 0.007), (0.0185, 0.015), (0.0185, 0.022), (0.014, 0.029), (0.008, 0.034)],
                 16, "bulb", caps=(False, False))
    _xf(bulb, Ms @ _T(0, 0, zt - 0.0235 - 0.034))
    parts.append(bulb)
    # ball pull chain and brass drop
    start = Ms @ Vector((0, -0.0122, zt - 0.019))
    _ball_chain(parts, start.x, start.y - 0.001, start.z, 0.226, seg=5)
    ob = _join(parts, "Prop_Lamp_Banker_01")
    lc = Ms @ Vector((0, 0, zt - 0.0235 - 0.017))
    ob["light_offset"] = tuple(round(c, 4) for c in lc)
    ob["light_points"] = [list(ob["light_offset"])]
    ob["light_color"] = BULB_COLOR
    ob["glow_material"] = "glass_green_cased"
    ob["glow_material_lit"] = "glass_green_cased_lit"
    ob["glow_emission"] = LM.PALETTE["glass_green_cased_lit"]["emit"]
    ob["glow_color"] = LM.PALETTE["glass_green_cased_lit"]["emission"]
    return ob


# ---------------------------------------------------------------------------
# Small props for the set
# ---------------------------------------------------------------------------

def _prop_book_open(color=(0.36, 0.07, 0.05, 1.0)):
    """Open hardback, reader at -Y (spine along Y)."""
    parts = []
    cover = _slab("bo_cover", _rect(0.158, 0.118), 0.004, [(0.0, 0.0), (0.0, 0.0024), (0.0006, 0.003)], 2, "book_cloth")
    parts.append(_uvb(cover, "book_cloth", "y"))
    half = [(0.004, 0.003), (0.150, 0.003), (0.1508, 0.0095), (0.1495, 0.0128), (0.1455, 0.0142), (0.110, 0.0156),
            (0.070, 0.0170), (0.040, 0.0181), (0.025, 0.0180), (0.0145, 0.0161), (0.0085, 0.0123), (0.0052, 0.0082)]
    for s in (1, -1):
        out = [(s * x, z) for x, z in half]
        if s < 0:
            out = list(reversed(out))
        pg = _extrude("bo_pages", out, 0.112, -0.112, "paper", "xz")
        C.shade_smooth(pg, 30)
        parts.append(_uvb(pg, "paper", "y"))
    # silk ribbon marker running out over the bottom edge onto the table
    rib = [(0.012, 0.06, 0.0172), (0.016, -0.04, 0.0176), (0.019, -0.105, 0.0164), (0.020, -0.1132, 0.0125),
           (0.021, -0.1148, 0.0075), (0.022, -0.1195, 0.0040), (0.023, -0.1225, 0.0012), (0.025, -0.132, 0.0003),
           (0.027, -0.150, 0.0003)]
    rib = _catmull(rib, 3)
    rings = [[Vector(p) + Vector((-0.0032, 0, 0)), Vector(p) + Vector((0.0032, 0, 0)),
              Vector(p) + Vector((0.0032, 0, 0.0004)), Vector(p) + Vector((-0.0032, 0, 0.0004))] for p in rib]
    parts.append(_uvb(_loft("bo_ribbon", rings, "signage", smooth=60), "signage", "y"))
    ob = _join(parts, "Prop_Book_Open_01")
    ob.color = color
    return ob


def _prop_notebook():
    parts = []
    w, l, t = 0.074, 0.105, 0.012
    z0 = 0.0008
    for z in (z0, z0 + t - 0.0012):
        c = _slab("nb_cover", _rect(w, l), 0.006, [(0.0, z), (0.0, z + 0.0009), (0.0004, z + 0.0012)], 2, "leather_burgundy")
        parts.append(_uvb(c, "leather_burgundy", "y"))
    spine = _bx("nb_spine", (-w, -l + 0.004, z0 + 0.0005), (-w + 0.004, l - 0.004, z0 + t - 0.0005), "leather_burgundy", 0.0018, 2, "y")
    parts.append(spine)
    parts.append(_slab("nb_pages", _rect(w - 0.0025, l - 0.0025, 0.0005), 0.005, [(0.0, z0 + 0.0011), (0.0, z0 + t - 0.0011)], 2, "paper"))
    _uvb(parts[-1], "paper", "y")
    band = _mitre_loft("nb_band", [(0.052, -l - 0.0007, 0.0), (0.052, l + 0.0007, 0.0), (0.052, l + 0.0007, z0 + t + 0.0007),
                                   (0.052, -l - 0.0007, z0 + t + 0.0007)][::-1], (1, 0, 0),
                       [(0.0, -0.003), (0.0, 0.003), (0.0007, 0.003), (0.0007, -0.003)], "plastic_dark")
    parts.append(_uvb(band, "plastic_dark"))
    return _join(parts, "Prop_Notebook_01")


def _prop_pencil():
    L = 0.165
    body = _turn("pc_body", [(0.0036, 0.0), (0.0036, 0.140)], 6, "signage", caps=(True, False), smooth=50)
    wood = _turn("pc_wood", [(0.0034, 0.140), (0.0012, 0.158)], 12, "oak_light", caps=(False, False))
    lead = _turn("pc_lead", [(0.0012, 0.158), (0.0004, 0.163), (0.0, 0.1635)], 8, "iron", caps=(False, False))
    ferrule = _turn("pc_ferrule", [(0.0033, -0.0002), (0.0039, 0.0008), (0.0039, 0.0028), (0.0037, 0.0032), (0.0039, 0.0036),
                                   (0.0039, 0.0062), (0.0037, 0.0066), (0.0039, 0.0070), (0.0039, 0.0092), (0.0033, 0.0102)],
                    16, "brass", caps=(False, False))
    _xf(ferrule, _T(0, 0, -0.0100))
    eraser = _turn("pc_eraser", [(0.0033, -0.0115), (0.0033, -0.0018), (0.0029, -0.0008)], 16, "terracotta", fillet=0.0008)
    _xf(eraser, _T(0, 0, -0.0105))
    ob = _join([body, wood, lead, ferrule, eraser], "Prop_Pencil_01")
    # lie it down along +X on one of its flats
    _xf(ob, _T(0, 0, 0.0036 * math.cos(math.radians(30))) @ _Rx(30) @ _Ry(90) @ _T(0, 0, -L / 2))
    zmin = min(v.co.z for v in ob.data.vertices)
    _xf(ob, _T(0, 0, -zmin))
    return ob


def _prop_laptop():
    hw, hl = 0.152, 0.106
    parts = []
    base = _slab("lt_base", _rect(hw, hl), 0.012, [(0.003, 0.0012), (0.0009, 0.0016), (0.0, 0.0028), (0.0, 0.0077), (0.0005, 0.0081)],
                 4, "aluminium")
    lid = _slab("lt_lid", _rect(hw, hl), 0.012, [(0.0005, 0.0089), (0.0, 0.0093), (0.0, 0.0146), (0.0009, 0.0155), (0.003, 0.0159)],
                4, "aluminium")
    seam = _slab("lt_seam", _rect(hw - 0.0015, hl - 0.0015), 0.0105, [(0.0, 0.0079), (0.0, 0.0091)], 4, "plastic_dark")
    for o in (base, lid):
        _uvb(o, "aluminium", "x")
        C.weighted_normals(o)
    parts += [base, lid, _uvb(seam, "plastic_dark")]
    parts.append(_bx("lt_hinge", (-0.115, hl - 0.004, 0.0062), (0.115, hl + 0.0004, 0.0108), "plastic_dark", 0.0016, 2, "x"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(C.cylinder("lt_foot", 0.0045, 0.0045, 0.0014, (sx * (hw - 0.02), sy * (hl - 0.018), 0.0007), _mat("plastic_dark"), 12))
    return _join(parts, "Prop_Laptop_01")


# ---------------------------------------------------------------------------
# The dressed table
# ---------------------------------------------------------------------------

LAMP_PROPS = ("light_offset", "light_points", "light_color", "glow_material", "glow_material_lit", "glow_emission", "glow_color")


def build_table_set(number=1, col=None):
    """One communal table with six chairs (one pulled out), two brass lamps and student props.
    Returns the root empty; the chairs and lamps are linked duplicates of one mesh each."""
    col = col or C.collection(f"Furniture_TableSet_{number:02d}")
    root = C.empty(f"Furniture_TableSet_{number:02d}", col=col)
    table = build_table_communal(number)
    chair = build_chair_reading()
    lamp = build_lamp_desk_brass()
    objs = [table]
    k = 0
    for side in (-1, 1):
        for y in (-1.3, 0.0, 1.3):
            k += 1
            x, rot = side * 0.62, (90.0 if side < 0 else -90.0)
            if side > 0 and y == -1.3:            # someone just got up
                x, y2, rot = 0.86, -1.235, -90.0 + 17.0
            else:
                y2 = y
            if k == 1:
                c = chair
                c.location = (x, y2, 0.0)
                c.rotation_euler = (0, 0, math.radians(rot))
                c.name = "Furniture_Chair_Reading_01"
            else:
                c = C.instance(chair, f"Furniture_Chair_Reading_{k:02d}", (x, y2, 0.0), math.radians(rot))
            objs.append(c)
    lamp.location = (0, -1.0, T_H + 0.0003)
    lamp.name = "Prop_Lamp_Brass_01"
    objs.append(lamp)
    objs.append(C.instance(lamp, "Prop_Lamp_Brass_02", (0, 1.0, T_H + 0.0003), math.radians(180)))
    for o in objs[1:]:
        if o is not lamp and o.data is lamp.data:
            for key in LAMP_PROPS:
                if key in lamp:
                    o[key] = lamp[key]
    book = _prop_book_open()
    book.location = (-0.27, 0.03, T_H + 0.0003)
    book.rotation_euler = (0, 0, math.radians(-90 + 6))
    note = _prop_notebook()
    note.location = (0.29, -1.36, T_H + 0.0003)
    note.rotation_euler = (0, 0, math.radians(90 - 9))
    pencil = _prop_pencil()
    pencil.location = (0.25, -1.20, T_H + 0.0003)
    pencil.rotation_euler = (0, 0, math.radians(104))
    laptop = _prop_laptop()
    laptop.location = (-0.27, 1.32, T_H + 0.0003)
    laptop.rotation_euler = (0, 0, math.radians(-90 - 4))
    objs += [book, note, pencil, laptop]
    table.location = (0, 0, 0)
    for o in objs:
        C.move_to(o, col)
        o.parent = root
    return root


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _shot(path, target, yaw, pitch, dist, lens=50):
    cam = R.camera(lens=lens)
    y, p = math.radians(yaw), math.radians(pitch)
    t = Vector(target)
    loc = t + Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist
    R.look(cam, loc, t)
    return R.render(path)


def _studio(objs, samples=48, size=(960, 960)):
    scene = bpy.context.scene
    R.engine(scene, "EEVEE", samples, size)
    lo, hi = R.bounds(objs)
    R.studio(scene, ((lo + hi) / 2).to_tuple(), max(0.5, (hi - lo).length / 2))
    return R.camera(lens=50)


def _views(objs, out, name, views=((25, 12), (-35, 22), (160, 10)), lens=50):
    cam = R.camera(lens=lens)
    paths = []
    for i, (yaw, pitch) in enumerate(views):
        R.frame(cam, objs, yaw, pitch)
        paths.append(R.render(os.path.join(out, f"{name}_{i + 1}.png")))
    return paths


def _point(name, loc, energy, radius=0.02, color=(1.0, 0.78, 0.52)):
    li = bpy.data.lights.new(name, "POINT")
    li.energy = energy
    li.shadow_soft_size = radius
    li.color = color
    ob = bpy.data.objects.new(name, li)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    return ob


def _night(scene, world=0.012):
    R.engine(scene, "EEVEE", 48, (960, 960))
    R.world(scene, (0.55, 0.6, 0.7), world)
    floor = bpy.data.meshes.new("NightFloor")
    s = 30
    floor.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("NightFloor", floor)
    scene.collection.objects.link(ob)
    m = bpy.data.materials.new("NightFloorMat")
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.09, 0.06, 0.045, 1)
    bsdf.inputs["Roughness"].default_value = 0.35
    floor.materials.append(m)


def _light_lamps(objs, energy, radius=0.012):
    """Preview only: moves each lamp's bulb faces into a shadowless object (so the bulb glass does not
    shadow its own light), puts a warm point light in every bulb, and switches glowing shades to their
    lit material (what the web build does with `glow_material_lit`)."""
    bpy.context.view_layer.update()
    split = {}
    bulb_mat = _mat("bulb")
    for o in objs:
        if o.type != "MESH" or o.get("light_points") is None:
            continue
        me = o.data
        if me.name not in split:
            if o.get("glow_material_lit"):
                dim, lit = _mat(o["glow_material"]), _mat(o["glow_material_lit"])
                for i, m in enumerate(me.materials):
                    if m == dim:
                        me.materials[i] = lit
            bi = {i for i, m in enumerate(me.materials) if m == bulb_mat}
            bm = bmesh.new()
            bm.from_mesh(me)
            bb = bm.copy()
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in bi], context="FACES")
            bmesh.ops.delete(bb, geom=[f for f in bb.faces if f.material_index not in bi], context="FACES")
            bm.to_mesh(me)
            bm.free()
            bme = bpy.data.meshes.new(me.name + "_bulbs")
            bb.to_mesh(bme)
            bb.free()
            for m in me.materials:
                bme.materials.append(m)
            split[me.name] = bme
        b = bpy.data.objects.new(o.name + "_bulbs", split[me.name])
        bpy.context.scene.collection.objects.link(b)
        b.matrix_world = o.matrix_world.copy()
        b.visible_shadow = False
        pts = list(o["light_points"])
        for p in pts:
            _point(o.name + "_L", o.matrix_world @ Vector(p), energy / len(pts), radius)


def preview(out_dir):
    tri = {}

    # 1. The dressed set: studio views, then lamplight.
    root = build_table_set(7)
    objs = [o for o in root.children]
    for o in objs:
        if o.type == "MESH" and o.data.name not in tri:
            tri[o.data.name] = C.tris(o)
    _studio(objs)
    for i, (yaw, pitch, dist) in enumerate(((32, 24, 5.0), (-58, 30, 4.8), (148, 16, 5.0))):
        _shot(os.path.join(out_dir, f"set_{i + 1}.png"), (0.0, 0.0, 0.42), yaw, pitch, dist, 40)
    _shot(os.path.join(out_dir, "set_side.png"), (0.0, 0.0, 0.45), 90, 3, 6.2, 40)
    _shot(os.path.join(out_dir, "set_seated.png"), (0.0, -0.4, 0.78), -30, 14, 2.3, 32)
    _shot(os.path.join(out_dir, "set_props.png"), (-0.12, 0.62, 0.78), -64, 38, 1.35, 40)
    _shot(os.path.join(out_dir, "set_props2.png"), (0.22, -1.25, 0.77), 70, 40, 0.75, 45)
    for o in list(bpy.data.objects):
        if o.type == "LIGHT" or o.name == "PreviewFloor":
            bpy.data.objects.remove(o, do_unlink=True)
    _night(bpy.context.scene, 0.05)
    _light_lamps(objs, 40.0)
    R.area_light("Window", (-4.0, -2.5, 3.5), (0, 0, 0.7), 140, 3.0, (0.72, 0.82, 1.0))
    _shot(os.path.join(out_dir, "set_lamplit.png"), (0.0, 0.1, 0.8), -24, 16, 3.3, 30)
    _shot(os.path.join(out_dir, "set_lamplit_close.png"), (0.0, -0.9, 0.95), 62, 8, 1.25, 35)

    # 2. The table alone, with joinery close-ups.
    C.reset_scene()
    table = build_table_communal(7)
    tri[table.name] = C.tris(table)
    _studio([table])
    _views([table], out_dir, "table", ((28, 16), (-62, 26), (90, 4)), lens=60)
    _shot(os.path.join(out_dir, "table_corner.png"), (0.40, -1.88, 0.66), -38, 8, 0.55, 50)
    _shot(os.path.join(out_dir, "table_trestle.png"), (0.0, -1.70, 0.30), -14, 8, 1.15, 45)
    _shot(os.path.join(out_dir, "table_tenon.png"), (0.0, -1.745, 0.205), -52, 18, 0.36, 50)
    _shot(os.path.join(out_dir, "table_post.png"), (0.0, -0.65, 0.44), 62, 9, 1.2, 45)
    _shot(os.path.join(out_dir, "table_grommet.png"), (0.0, 0.0, T_H), 24, 44, 0.30, 50)
    _shot(os.path.join(out_dir, "table_grommet_close.png"), (0.0, -0.042, T_H), 30, 52, 0.13, 50)
    _shot(os.path.join(out_dir, "table_plaque.png"), (0.0, -YF, 0.66), -8, 6, 0.30, 50)

    # 3. The chair alone.
    C.reset_scene()
    chair = build_chair_reading()
    tri[chair.name] = C.tris(chair)
    _studio([chair])
    _views([chair], out_dir, "chair", ((32, 12), (-42, 20), (150, 14)))
    _shot(os.path.join(out_dir, "chair_side.png"), (0.0, 0.0, 0.47), 90, 2, 1.9, 50)
    _shot(os.path.join(out_dir, "chair_back.png"), (0.0, 0.2, 0.75), 160, 14, 0.85, 50)
    _shot(os.path.join(out_dir, "chair_seat.png"), (0.12, -0.18, 0.42), 34, 16, 0.55, 50)

    # 4. Lamps: studio views, an elevation and a look underneath, then lit on a desk at night.
    for builder, nm, under, lit, low in (
            (build_lamp_desk_brass, "lamp_brass", ((0, 0, 0.40), 25, -30, 0.72), ((0, -0.05, 0.27), -22, 14, 1.0),
             ((0, 0, 0.33), -22, -7, 0.78)),
            (build_lamp_banker_green, "lamp_banker", ((0, -0.05, 0.29), 20, -28, 0.55), ((0, -0.05, 0.2), -24, 14, 0.8),
             ((0, -0.06, 0.25), -18, -5, 0.62))):
        C.reset_scene()
        lamp = builder()
        tri[lamp.name] = C.tris(lamp)
        _studio([lamp])
        _views([lamp], out_dir, nm, ((20, 10), (-40, 24), (180, 8)))
        _shot(os.path.join(out_dir, f"{nm}_elev.png"), (0, 0, 0.29 if nm == "lamp_brass" else 0.2), 0 if nm == "lamp_brass" else 90, 0,
              1.25 if nm == "lamp_brass" else 0.95, 50)
        _shot(os.path.join(out_dir, f"{nm}_under.png"), *under, 50)
        C.reset_scene()
        lamp = builder()
        desk = _slab("Desk", _rect(0.9, 0.7), 0.02, [(0.0, -0.048), (0.0, 0.0)], 4, "tabletop")
        _uvb(desk, "tabletop", "y")
        lamp.location = (0, 0, 0.0003)
        _night(bpy.context.scene, 0.03)
        _light_lamps([lamp], 22.0)
        R.area_light("Window", (-2.0, -1.6, 1.6), (0, 0, 0.2), 10, 1.5, (0.72, 0.82, 1.0))
        _shot(os.path.join(out_dir, f"{nm}_lit.png"), *lit, 50)
        _shot(os.path.join(out_dir, f"{nm}_lit_low.png"), *low, 50)     # glowing underside from a seated eye

    for k, v in tri.items():
        print(f"TRIS {k}: {v}")
