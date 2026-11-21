"""
Architectural shell of the Grand Reading Hall: walls with clean openings, the giant order of
fluted Corinthian pilasters, the perimeter entablature (architrave, frieze, dentils, egg-and-dart,
modillions, coffered corona soffit) with the west-frieze inscription, a belt course on the east
wall, the stone-clad lift shaft in the NE corner (the entablature wraps it), blind arches in the
long west bays, and moulded arch surrounds for the passable arches.

Everything here is PLAN-DRIVEN and built IN PLACE (web coordinates from plan.py, converted with
the lib_core convention web (x, y, z) -> Blender (x, -z, y)). A pilaster is one mesh in a local
wall frame (wall face on y = 0, room on -Y) that is instanced at every pier.

    build_wall(wall, extra_openings=())  any plan Wall (dataclass or dict); generic, every room;
                                         openings with a `depth` are recesses (blind arches)
    build_lift_shaft()                   the lift shaft's two free faces (stone, lift door holes)
    build_pilaster(kind)                 'full' | 'corner' (internal fold) | 'external' (pier corner)
    build_hall_pilasters()               N/S piers, W piers, E arch framing, corners, lift shaft
    build_hall_cornice()                 entablature round the hall (wrapping the shaft) + inscription
    build_arch_surround(opening, wall)   portal or framed surround, panelled reveal, coffered soffit
    blind_openings() / build_blind_arch_surround(o, wall)   the two west-bay blind arches
    build_hall_shell()                   all of the above in ARCHITECTURE/{Walls,Columns,Arches}
    hall_pilaster_positions(), pilaster_spans(), split_bookcase_runs(runs)
                                         layout + plan bookcase runs split round the pilasters
    arc_steps(radius, sweep), arc_angles(...)   the shared arc sampler (holes and surrounds)
    preview(out_dir)                     lit interior renders + close-ups (ARCH_SHOTS=a,b filters)

Opening frames (window joinery, door leaves) belong to other modules: walls only leave clean
holes with stone reveals.
"""

from __future__ import annotations

import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

import lib_core as C
import lib_materials as LM
import plan as P

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COL_ROOT = "ARCHITECTURE"
COL_WALLS = "Walls"
COL_COLUMNS = "Columns"
COL_ARCHES = "Arches"

ROOM_FINISH = {"hall": "limestone"}     # interior face finish by room id; other rooms -> DEFAULT
DEFAULT_FINISH = "plaster"
EXTERIOR_FINISH = "limestone_plain"
CARVED = "limestone_plain"              # mouldings, capitals, bases (smooth dressed stone)

WALL_ARRIS = 0.012                      # bevel on every wall edge (openings, ends, top)

# One arc sampler for wall holes and every surround swept on them: chords <= ARC_CHORD, segment
# counts rounded to a multiple of 4 (so 45/90/135 degrees are always vertices). Surrounds start
# SURROUND_PROUD into the opening so their intrados never coincides with the reveal.
ARC_CHORD = 0.07
SURROUND_PROUD = 0.004

# Giant order (pilasters) on the gallery level: base on the gallery floor, abacus under the
# architrave. Width/projection give ~9.7 diameters of height, a Corinthian proportion.
PIL_W = 0.72
PIL_P = 0.14
PIL_Z0 = P.GALLERY_Y
PIL_H = P.HALL_CORNICE - P.GALLERY_Y    # 7.0
BASE_H = 0.36
BASE_PROJ = 0.135                       # plinth projection beyond the shaft face
CAP_H = 0.80
PIL_Z0_CAP = PIL_H - CAP_H              # capital-local origin in pilaster-local z
BELL_FLARE = 0.085                      # bell offset at the lip (capital-local z 0.68)
ABACUS_Z = 0.703                        # underside of the abacus (capital-local)

# Entablature (1.0 m): architrave 11.60-11.87, frieze 11.87-12.16, cornice 12.16-12.60.
FRIEZE_Z0, FRIEZE_Z1, FRIEZE_D = 11.87, 12.16, 0.15
FRIEZE_REPEAT = 0.6
DENT_D0, DENT_D1, DENT_Z0, DENT_Z1 = 0.19, 0.27, 12.20, 12.29
DENT_FRAC = 0.64                        # dentil width / dentil pitch
OVOLO_D, OVOLO_Z, OVOLO_R = 0.275, 12.37, 0.07
MOD_D0, MOD_D1, MOD_Z0, MOD_Z1 = 0.35, 0.605, 12.375, 12.47
MOD_W = 0.11
SOFFIT_D1 = 0.64                        # corona face
CORONA_PROJ = 0.70
MODILLION_PITCH = 5.6 / 12              # 4 dentils / eggs per modillion

INSCRIPTION = "LEGERE \u00b7 DISCERE \u00b7 CRESCERE"
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Baskerville.ttc",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "C:/Windows/Fonts/georgia.ttf",
]

# East wall belt course (ties the east pilasters to the gallery fascia line).
BELT_Z0, BELT_Z1 = P.GALLERY_UNDERSIDE, P.GALLERY_Y
EAST_FRAME_OFFSET = 3.3                 # pilaster axes either side of the rotunda arch

# Lift shaft (plan.LIFT): stone enclosure walls, lift door holes (the bronze doors and their fluted
# surrounds are arch_windows' "elevator" doors: 1.0 x 2.2, surround half-width 0.674).
LIFT_WALL_T = 0.25
LIFT_DOOR_H = 2.2
LIFT_DOOR_SURROUND = 0.674

# Gallery soffit (arch_gallery): coffer ribs at 4.10 with a 0.07 cove at the walls, so stone under
# the gallery stops at 4.02.
GALLERY_STONE_TOP = 4.02

# Blind arches in the long west bays (echo the north windows: 3.2 wide, apex 11.2).
BLIND_W, BLIND_SILL, BLIND_APEX, BLIND_DEPTH = 3.2, 7.62, 11.2, 0.16

Z = Vector((0, 0, 1))
SQ2 = math.sqrt(2.0)


def _g(o, key, default=None):
    if isinstance(o, dict):
        return o.get(key, default)
    return getattr(o, key, default)


# ---------------------------------------------------------------------------
# Mesh builder: faces from coordinates, per-loop UVs, material slots by palette key
# ---------------------------------------------------------------------------

class _MB:
    def __init__(self):
        self.co = []
        self.faces = []
        self.uvs = []
        self.mat = []
        self.keys = []
        self._lut = {}
        self.part = 0

    def new_part(self):
        self.part += 1

    def mi(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def vid(self, p):
        k = (self.part, round(p[0], 5), round(p[1], 5), round(p[2], 5))
        i = self._lut.get(k)
        if i is None:
            i = len(self.co)
            self.co.append((float(p[0]), float(p[1]), float(p[2])))
            self._lut[k] = i
        return i

    def face(self, pts, uvs=None, mat=0):
        idx, uv = [], []
        for k, p in enumerate(pts):
            i = self.vid(p)
            if idx and idx[-1] == i:
                continue
            idx.append(i)
            uv.append(tuple(uvs[k]) if uvs is not None else (0.0, 0.0))
        while len(idx) > 1 and idx[0] == idx[-1]:
            idx.pop()
            uv.pop()
        if len(idx) < 3 or len(set(idx)) < len(idx):
            return
        self.faces.append(idx)
        self.uvs.append(uv)
        self.mat.append(mat)

    def pface(self, pts, mat, sz, right=None):
        """Face with a planar UV at real scale (U along `right` or the face's horizontal)."""
        n = _newell([tuple(p) for p in pts])
        if n.length < 1e-12:
            return
        n.normalize()
        if right is None:
            right = _right_of(n) if abs(n.z) < 0.7 else Vector((1, 0, 0))
            if right.length < 1e-6:
                right = Vector((1, 0, 0))
        right = Vector(right).normalized()
        up = n.cross(right)
        if up.length < 1e-6:
            up = Vector((0, 0, 1))
        up.normalize()
        self.face([tuple(p) for p in pts], [(Vector(p).dot(right) / sz, Vector(p).dot(up) / sz) for p in pts], mat)

    def build(self, name, col=None, sharp=35.0):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.co, [], self.faces)
        uvl = me.uv_layers.new(name="UVMap")
        uvl.data.foreach_set("uv", [c for f in self.uvs for uv in f for c in uv])
        me.polygons.foreach_set("material_index", self.mat)
        for k in self.keys:
            me.materials.append(LM.mat(k))
        me.update()
        ob = bpy.data.objects.new(name, me)
        C.link(ob, col)
        C.shade_smooth(ob, sharp)
        return ob


def _newell(pts):
    n = Vector((0, 0, 0))
    for a, b in zip(pts, pts[1:] + pts[:1]):
        n.x += (a[1] - b[1]) * (a[2] + b[2])
        n.y += (a[2] - b[2]) * (a[0] + b[0])
        n.z += (a[0] - b[0]) * (a[1] + b[1])
    return n


def _orient(pts, uvs, want):
    if _newell([Vector(p) for p in pts]).dot(Vector(want)) < 0:
        return list(reversed(pts)), (list(reversed(uvs)) if uvs is not None else None)
    return pts, uvs


def _right_of(n):
    return Vector((-n.y, n.x, 0.0))


def _v2(p):
    return Vector((p[0], p[1]))


def arc_steps(radius, sweep, chord=ARC_CHORD, multiple=4, min_n=8):
    """Segment count for an arc of `radius` spanning `sweep` radians: chords <= `chord`, rounded
    up to a multiple of `multiple`. Wall holes and every surround swept on them use this, so their
    vertices coincide (other modules can import it to match)."""
    n = max(min_n, math.ceil(abs(radius * sweep) / chord))
    return int(math.ceil(n / multiple) * multiple)


def arc_angles(radius, a0, a1, chord=ARC_CHORD, full=math.pi, start=math.pi):
    """The sampler's angles (radians) inside [min(a0, a1), max(a0, a1)] for an arc whose full
    sampled span is `full` starting at `start` (a semicircular head: start pi, full pi, angles
    decreasing), plus the exact end angles. Ordered from a0 to a1."""
    n = arc_steps(radius, full, chord)
    lo, hi = min(a0, a1), max(a0, a1)
    angs = {a0, a1}
    for k in range(n + 1):
        a = start - full * k / n
        if lo + 1e-7 < a < hi - 1e-7:
            angs.add(a)
    return sorted(angs, reverse=a0 > a1)


def _offset_path(path, d, closed=False):
    """Mitred offset of a 2D polyline by d along its right-hand normal (dy, -dx)."""
    n = len(path)
    pts = [_v2(p) for p in path]
    out = []
    for i in range(n):
        p = pts[i]
        has_prev = closed or i > 0
        has_next = closed or i < n - 1
        if has_prev:
            t0 = (p - pts[i - 1]).normalized()
            n0 = Vector((t0.y, -t0.x))
        if has_next:
            t1 = (pts[(i + 1) % n] - p).normalized()
            n1 = Vector((t1.y, -t1.x))
        if has_prev and has_next:
            m = n0 + n1
            if m.length < 1e-9:
                m = n0
            m.normalize()
            out.append(p + m * (d / max(0.2, m.dot(n0))))
        elif has_next:
            out.append(p + n1 * d)
        else:
            out.append(p + n0 * d)
    return out


def _path_lengths(pts, closed=False):
    s = [0.0]
    for a, b in zip(pts, pts[1:]):
        s.append(s[-1] + (_v2(b) - _v2(a)).length)
    if closed:
        s.append(s[-1] + (_v2(pts[0]) - _v2(pts[-1])).length)
    return s


def _round_corners(pts, r, seg=2, closed=False, convex_only=True, min_turn=8.0):
    """Rounds polyline corners with quadratic Bezier fillets (left turns = convex for
    right-hand-outward paths). Concave corners stay sharp when convex_only."""
    n = len(pts)
    out = []
    for i in range(n):
        p = _v2(pts[i])
        if not closed and (i == 0 or i == n - 1):
            out.append(p)
            continue
        a, b = _v2(pts[i - 1]), _v2(pts[(i + 1) % n])
        t0, t1 = (p - a), (b - p)
        l0, l1 = t0.length, t1.length
        t0.normalize()
        t1.normalize()
        cross = t0.x * t1.y - t0.y * t1.x
        turn = math.degrees(math.acos(max(-1.0, min(1.0, t0.dot(t1)))))
        if turn < min_turn or (convex_only and cross < 0):
            out.append(p)
            continue
        k = min(r, 0.45 * l0, 0.45 * l1)
        q0, q1 = p - t0 * k, p + t1 * k
        for j in range(seg + 1):
            t = j / seg
            out.append(q0 * (1 - t) ** 2 + p * 2 * t * (1 - t) + q1 * t * t)
    return out


def _arc(cx, cy, r, a0, a1, n):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]


def _bez(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((u ** 3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t ** 3 * p3[0],
                    u ** 3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t ** 3 * p3[1]))
    return out


def _cyma_reversa(p0, p1, n=6):
    """Convex below, concave above: leaves and arrives horizontally."""
    k = 0.55 * (p1[0] - p0[0])
    return _bez(p0, (p0[0] + k, p0[1]), (p1[0] - k, p1[1]), p1, n)


def _cyma_recta(p0, p1, n=6):
    """Concave below, convex above: leaves and arrives vertically (cymatium)."""
    k = 0.55 * (p1[1] - p0[1])
    return _bez(p0, (p0[0], p0[1] + k), (p1[0], p1[1] - k), p1, n)


def _prof(*parts, r=0.0025, seg=1):
    """Concatenates profile pieces (lists of points), drops duplicates, softens sharp corners."""
    pts = []
    for part in parts:
        for p in part:
            if not pts or (abs(pts[-1][0] - p[0]) > 1e-7 or abs(pts[-1][1] - p[1]) > 1e-7):
                pts.append((float(p[0]), float(p[1])))
    if r > 0:
        pts = [tuple(v) for v in _round_corners(pts, r, seg, closed=False, convex_only=False, min_turn=25)]
    return pts


def _smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------
# Generic sweep: a 2D profile (o, h) along a 2D path, mapped to 3D by `to3d(point2d, h)`.
# o = offset along the path's right-hand normal, h = out-of-plane height.
# Trace profiles with the solid on the LEFT (o to the right, h up): faces then face outward.
# ---------------------------------------------------------------------------

def _sweep(mb, path, profile, to3d, closed=False, mat=0, uv_size=1.0, cap0=False, cap1=False,
           u_scale=None, v_mode="profile", flip=False):
    rings = [_offset_path(path, o, closed) for o, h in profile]
    s = _path_lengths(path, closed)
    q = [0.0]
    for a, b in zip(profile, profile[1:]):
        q.append(q[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    n = len(path)
    us = u_scale or uv_size
    segs = n if closed else n - 1
    for j in range(len(profile) - 1):
        h0, h1 = profile[j][1], profile[j + 1][1]
        if v_mode == "profile":
            v0, v1 = q[j] / uv_size, q[j + 1] / uv_size
        else:
            v0, v1 = v_mode(profile[j]), v_mode(profile[j + 1])
        for i in range(segs):
            i2 = (i + 1) % n
            pts = [to3d(rings[j][i], h0), to3d(rings[j][i2], h0), to3d(rings[j + 1][i2], h1), to3d(rings[j + 1][i], h1)]
            uvs = [(s[i] / us, v0), (s[i + 1] / us, v0), (s[i + 1] / us, v1), (s[i] / us, v1)]
            if flip:
                pts, uvs = pts[::-1], uvs[::-1]
            mb.face(pts, uvs, mat)
    if not closed:
        for idx, flag, want_sign in ((0, cap0, -1), (n - 1, cap1, 1)):
            if not flag:
                continue
            pts = [to3d(rings[j][idx], profile[j][1]) for j in range(len(profile))]
            t = (_v2(path[min(idx + 1, n - 1)]) - _v2(path[max(idx - 1, 0)])).normalized() * want_sign
            want = to3d(_v2(path[idx]) + t, 0.0) - to3d(_v2(path[idx]), 0.0)
            uvs = [(o / uv_size, h / uv_size) for o, h in profile]
            pts, uvs = _orient(pts, uvs, want)
            mb.face(pts, uvs, mat)
    return rings


def _cap(mb, ring_pts, h, to3d, want_up, mat=0, uv_size=1.0):
    """Flat cap polygon over a ring (closed along the wall by the polygon itself)."""
    pts = [to3d(p, h) for p in ring_pts]
    uvs = [(p[0] / uv_size, p[1] / uv_size) for p in ring_pts]
    want = to3d(Vector((0, 0)), h + (1 if want_up else -1)) - to3d(Vector((0, 0)), h)
    pts, uvs = _orient(pts, uvs, want)
    mb.face(pts, uvs, mat)


def _plan3d(origin=(0, 0, 0)):
    ox, oy, oz = origin
    return lambda p, h: Vector((p[0] + ox, p[1] + oy, h + oz))


def _all_walls():
    return list(P.WALLS)


def _wall_dims(wall):
    b = _g(wall, "bounds")
    if _g(wall, "axis") == "x":
        return b["minX"], b["maxX"], b["minZ"], b["maxZ"]
    return b["minZ"], b["maxZ"], b["minX"], b["maxX"]


def _trimmed_span(wall, walls=None):
    """Along-wall span after giving shared corners to the east-west (axis 'x') walls."""
    lo, hi, c_lo, c_hi = _wall_dims(wall)
    if _g(wall, "axis") != "z":
        return lo, hi
    b = _g(wall, "bounds")
    for o in walls or _all_walls():
        if o is wall or _g(o, "id") == _g(wall, "id") or _g(o, "axis") != "x":
            continue
        ob = _g(o, "bounds")
        if not (ob["minX"] < b["maxX"] - 1e-6 and ob["maxX"] > b["minX"] + 1e-6):
            continue
        if ob["minZ"] <= lo + 1e-6 < ob["maxZ"]:
            lo = max(lo, ob["maxZ"])
        if ob["minZ"] < hi - 1e-6 <= ob["maxZ"]:
            hi = min(hi, ob["minZ"])
    return lo, hi


def _to_bl(axis, u, c, v):
    return (u, -c, v) if axis == "x" else (c, -u, v)


def _u_axis(axis):
    return Vector((1, 0, 0)) if axis == "x" else Vector((0, -1, 0))


def _c_axis(axis):
    return Vector((0, -1, 0)) if axis == "x" else Vector((1, 0, 0))


def _room_at(px, pz, v):
    for r in P.ROOMS:
        b = _g(r, "bounds")
        if _g(r, "shape") == "rect":
            inside = b["minX"] - 1e-6 <= px <= b["maxX"] + 1e-6 and b["minZ"] - 1e-6 <= pz <= b["maxZ"] + 1e-6
        else:
            cx, cz = _g(r, "center")
            inside = math.hypot(px - cx, pz - cz) <= _g(r, "radius") / math.cos(math.pi / (_g(r, "sides") or 12))
        if inside:
            return r if v <= _g(r, "ceiling_y") + 1e-6 else None
    return None


def _finish_for(room):
    if room is None:
        return EXTERIOR_FINISH
    return ROOM_FINISH.get(_g(room, "id"), DEFAULT_FINISH)


def _hidden_by(wall, px, pz, v, walls):
    for o in walls:
        if _g(o, "id") == _g(wall, "id"):
            continue
        b = _g(o, "bounds")
        if b["minX"] + 1e-6 < px < b["maxX"] - 1e-6 and b["minZ"] + 1e-6 < pz < b["maxZ"] - 1e-6 and v < _g(o, "y1") - 1e-6:
            return True
    return False


def _probe(axis, u, c):
    """(web x, web z) of a wall-local (u, c)."""
    return (u, c) if axis == "x" else (c, u)


def _inner_side(wall):
    inside = _g(wall, "inside")
    if _g(wall, "axis") == "x":
        return "hi" if inside == "south" else "lo"
    return "hi" if inside == "east" else "lo"


def _opening_shape(o, wall_y0):
    """dict(bbox, outline (clockwise (u, v)), closed, fans [(inner, outer) quads], centre, depth,
    side). Curved outlines use the shared arc sampler."""
    at, w, y0, y1 = _g(o, "at"), _g(o, "width"), _g(o, "y0"), _g(o, "y1")
    half = w / 2
    u0, u1 = at - half, at + half
    spring = _g(o, "spring")
    kind = _g(o, "kind")
    extra = dict(depth=_g(o, "depth"), side=_g(o, "side"))
    if kind == "oculus":
        cy = (y0 + y1) / 2
        r = half
        n = arc_steps(r, math.tau)
        ang = [math.pi - math.tau * k / n for k in range(n)]   # clockwise from the left
        inner = [(at + r * math.cos(a), cy + r * math.sin(a)) for a in ang]
        outer = [(at + r * math.cos(a) / max(abs(math.cos(a)), abs(math.sin(a))),
                  cy + r * math.sin(a) / max(abs(math.cos(a)), abs(math.sin(a)))) for a in ang]
        fans = [(inner[k], inner[(k + 1) % n], outer[(k + 1) % n], outer[k]) for k in range(n)]
        return dict(bbox=(at - r, at + r, cy - r, cy + r), outline=inner, closed=True, fans=fans, centre=(at, cy), **extra)
    if spring is not None and spring < y1 - 1e-6:
        rise = y1 - spring
        if abs(rise - half) < 1e-3:
            n = arc_steps(half, math.pi)
            ang = [math.pi - math.pi * k / n for k in range(n + 1)]
            arc = [(at + half * math.cos(a), spring + half * math.sin(a)) for a in ang]
            outer = [(at + half * math.cos(a) / max(abs(math.cos(a)), abs(math.sin(a))),
                      spring + half * math.sin(a) / max(abs(math.cos(a)), abs(math.sin(a)))) for a in ang]
        else:
            rr = (half * half + rise * rise) / (2 * rise)
            n = arc_steps(rr, 2 * math.asin(min(1.0, half / rr)), multiple=2)
            arc = C.arch_points(w, spring, n, at, rise)
            outer = [(x, y1) for x, _ in arc]
        fans = [(arc[k], arc[k + 1], outer[k + 1], outer[k]) for k in range(len(arc) - 1)]
        outline = [(u0, y0)] + arc + [(u1, y0)]
        return dict(bbox=(u0, u1, y0, y1), outline=outline, closed=y0 > wall_y0 + 1e-6, fans=fans, centre=(at, spring), **extra)
    outline = [(u0, y0), (u0, y1), (u1, y1), (u1, y0)]
    return dict(bbox=(u0, u1, y0, y1), outline=outline, closed=y0 > wall_y0 + 1e-6, fans=[], centre=(at, (y0 + y1) / 2), **extra)


def _fix_tjunctions(polys):
    """Inserts every vertex that lies on another polygon's edge into that edge (watertight, planar)."""
    allp = np.array([p for poly in polys for p in poly["pts"]], dtype=np.float64)
    keys = np.round(allp / 1e-5).astype(np.int64)
    _, first = np.unique(keys, axis=0, return_index=True)
    pool = allp[np.sort(first)]
    out = []
    for poly in polys:
        pts, uvs = poly["pts"], poly["uvs"]
        npts, nuvs = [], []
        m = len(pts)
        for k in range(m):
            a, b = np.array(pts[k]), np.array(pts[(k + 1) % m])
            ua, ub = np.array(uvs[k]), np.array(uvs[(k + 1) % m])
            npts.append(tuple(a))
            nuvs.append(tuple(ua))
            d = b - a
            l2 = d.dot(d)
            if l2 < 1e-12:
                continue
            lo, hi = np.minimum(a, b) - 1e-5, np.maximum(a, b) + 1e-5
            cand = pool[np.all((pool >= lo) & (pool <= hi), axis=1)]
            if len(cand) == 0:
                continue
            t = (cand - a) @ d / l2
            proj = a + np.outer(t, d)
            dist = np.linalg.norm(cand - proj, axis=1)
            sel = (t > 1e-6) & (t < 1 - 1e-6) & (dist < 1e-5)
            for ti in sorted(t[sel]):
                npts.append(tuple(a + ti * d))
                nuvs.append(tuple(ua + ti * (ub - ua)))
        out.append(dict(pts=npts, uvs=nuvs, mat=poly["mat"]))
    return out


def _uv_vertical(pts, n, size):
    r = _right_of(n)
    if r.length < 1e-6:
        r = Vector((1, 0, 0))
    r.normalize()
    return [(Vector(p).dot(r) / size, p[2] / size) for p in pts]


def _dissolve_degenerate(ob, dist=1e-5):
    """Removes the zero-area slivers a bevel can leave where T-junction vertices sit on an arris."""
    import bmesh
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for _ in range(4):
        bad = [f for f in bm.faces if f.calc_area() < 1e-9]
        if not bad:
            break
        bmesh.ops.dissolve_degenerate(bm, dist=dist, edges=list({e for f in bad for e in f.edges}))
    bad = [f for f in bm.faces if f.calc_area() < 1e-10]
    if bad:
        bmesh.ops.delete(bm, geom=bad, context="FACES_ONLY")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def build_wall(wall, walls=None, name=None, col=None, finish=None, arris=WALL_ARRIS, extra_openings=()):
    """A solid wall (plan Wall dataclass or dict) with clean openings.

    Face cells are split on a grid around opening bounding boxes; curved heads and oculi are
    filled with radial fans (shared arc sampler) so there are no boolean artefacts. Reveals are
    wall surfaces, mapped with an unrolled UV (courses follow the arch). An opening with a
    `depth` is a RECESS (blind arch / niche) on its `side` (default: the room side): its reveals
    stop at that depth and a back panel closes it. Faces are finished by the room they face
    (ROOM_FINISH, plaster by default, limestone_plain outside), hidden faces against other walls
    are dropped, and every arris gets a small bevel. `extra_openings` adds openings (e.g.
    decorative recesses) that are not in the plan."""
    walls = walls if walls is not None else _all_walls()
    wid = _g(wall, "id")
    axis = _g(wall, "axis")
    y0, y1 = _g(wall, "y0"), _g(wall, "y1")
    lo, hi = _trimmed_span(wall, walls)
    _, _, c_lo, c_hi = _wall_dims(wall)
    thick = c_hi - c_lo
    openings = list(_g(wall, "openings") or []) + list(extra_openings)
    shapes = [_opening_shape(o, y0) for o in openings]
    for s in shapes:
        if s["depth"]:
            s["side"] = s["side"] or _inner_side(wall)
    reveal_finish = finish or ROOM_FINISH.get(_g(wall, "room"), DEFAULT_FINISH)

    def cuts(side):
        return [s for s in shapes if not s["depth"] or s["side"] == side]

    through = [s for s in shapes if not s["depth"]]

    # Grid cuts shared by both faces.
    ucuts = {lo, hi}
    vcuts = {y0, y1}
    for s in shapes:
        b0, b1, v0, v1 = s["bbox"]
        ucuts.update((max(lo, b0), min(hi, b1)))
        vcuts.update((max(y0, v0), min(y1, v1)))
    for r in P.ROOMS:
        b = _g(r, "bounds")
        for u in ((b["minX"], b["maxX"]) if axis == "x" else (b["minZ"], b["maxZ"])):
            if lo < u < hi:
                ucuts.add(u)
        if y0 < _g(r, "ceiling_y") < y1:
            vcuts.add(_g(r, "ceiling_y"))
    for o in walls:
        if _g(o, "id") == wid:
            continue
        b = _g(o, "bounds")
        for u in ((b["minX"], b["maxX"]) if axis == "x" else (b["minZ"], b["maxZ"])):
            if lo < u < hi:
                ucuts.add(u)
        if y0 < _g(o, "y1") < y1:
            vcuts.add(_g(o, "y1"))
    ucuts = sorted(ucuts)
    vcuts = sorted(vcuts)

    def in_bbox(u, v, group):
        for s in group:
            b0, b1, v0, v1 = s["bbox"]
            if b0 - 1e-6 < u < b1 + 1e-6 and v0 - 1e-6 < v < v1 + 1e-6:
                return True
        return False

    polys = []
    uax = _u_axis(axis)

    def add(pts, want, mat_key, uvs=None, size=None):
        size = size or LM.tex_size(mat_key)
        if uvs is None:
            n = Vector(want).normalized()
            if abs(n.z) > 0.7:
                uvs = [(p[0] / size, p[1] / size) for p in pts]
            else:
                uvs = _uv_vertical(pts, n, size)
        pts, uvs = _orient(pts, uvs, want)
        polys.append(dict(pts=[tuple(p) for p in pts], uvs=uvs, mat=mat_key))

    # Both faces.
    for side, c_face, sign in (("lo", c_lo, -1.0), ("hi", c_hi, 1.0)):
        want = _c_axis(axis) * sign
        c_probe = c_face + sign * 0.05
        group = cuts(side)
        for i in range(len(ucuts) - 1):
            ua, ub = ucuts[i], ucuts[i + 1]
            for j in range(len(vcuts) - 1):
                va, vb = vcuts[j], vcuts[j + 1]
                um, vm = (ua + ub) / 2, (va + vb) / 2
                if in_bbox(um, vm, group):
                    continue
                px, pz = _probe(axis, um, c_probe)
                if _hidden_by(wall, px, pz, vm, walls):
                    continue
                key = finish or _finish_for(_room_at(px, pz, vm))
                pts = [_to_bl(axis, ua, c_face, va), _to_bl(axis, ub, c_face, va), _to_bl(axis, ub, c_face, vb), _to_bl(axis, ua, c_face, vb)]
                add(pts, want, key)
        for s in group:
            px, pz = _probe(axis, s["centre"][0], c_probe)
            key = finish or _finish_for(_room_at(px, pz, s["centre"][1]))
            for quad in s["fans"]:
                add([_to_bl(axis, u, c_face, v) for u, v in quad], want, key)

    # Reveals (opening sides): unrolled UVs, V = height along the outline. Recesses stop at their
    # depth and get a back panel.
    rsize = LM.tex_size(reveal_finish)
    for s in shapes:
        outline = s["outline"]
        m = len(outline)
        segs = m if s["closed"] else m - 1
        if s["depth"]:
            if s["side"] == "lo":
                ca, cb = c_lo, c_lo + s["depth"]
            else:
                ca, cb = c_hi - s["depth"], c_hi
        else:
            ca, cb = c_lo, c_hi
        acc = [0.0]
        for k in range(segs):
            a, b = outline[k], outline[(k + 1) % m]
            acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        base_v = outline[0][1]
        for k in range(segs):
            a, b = outline[k], outline[(k + 1) % m]
            du, dv = b[0] - a[0], b[1] - a[1]
            n2 = Vector((dv, -du))          # clockwise traversal -> hole on the right
            want = uax * n2.x + Z * n2.y
            pts = [_to_bl(axis, a[0], ca, a[1]), _to_bl(axis, b[0], ca, b[1]),
                   _to_bl(axis, b[0], cb, b[1]), _to_bl(axis, a[0], cb, a[1])]
            va, vb = (base_v + acc[k]) / rsize, (base_v + acc[k + 1]) / rsize
            uvs = [(ca / rsize, va), (ca / rsize, vb), (cb / rsize, vb), (cb / rsize, va)]
            add(pts, want, reveal_finish, uvs)
        if s["depth"]:
            c_back = cb if s["side"] == "lo" else ca
            want = _c_axis(axis) * (-1.0 if s["side"] == "lo" else 1.0)
            pts = [_to_bl(axis, u, c_back, v) for u, v in outline]
            if not s["closed"]:
                pass                          # outline already runs sill -> arch -> sill
            add(pts, want, reveal_finish)

    # Ends (split where another wall hides them) and top.
    for u_end, sign in ((lo, -1.0), (hi, 1.0)):
        want = uax * sign
        for j in range(len(vcuts) - 1):
            va, vb = vcuts[j], vcuts[j + 1]
            if in_bbox(u_end + 1e-4 * -sign, (va + vb) / 2, through):
                continue
            px, pz = _probe(axis, u_end + sign * 0.05, (c_lo + c_hi) / 2)
            if _hidden_by(wall, px, pz, (va + vb) / 2, walls):
                continue
            pts = [_to_bl(axis, u_end, c_lo, va), _to_bl(axis, u_end, c_hi, va), _to_bl(axis, u_end, c_hi, vb), _to_bl(axis, u_end, c_lo, vb)]
            add(pts, want, EXTERIOR_FINISH)
    for i in range(len(ucuts) - 1):
        ua, ub = ucuts[i], ucuts[i + 1]
        if in_bbox((ua + ub) / 2, y1 - 1e-4, through):
            continue
        pts = [_to_bl(axis, ua, c_lo, y1), _to_bl(axis, ub, c_lo, y1), _to_bl(axis, ub, c_hi, y1), _to_bl(axis, ua, c_hi, y1)]
        add(pts, Z, EXTERIOR_FINISH)

    polys = _fix_tjunctions(polys)
    mb = _MB()
    for p in polys:
        mb.face(p["pts"], p["uvs"], mb.mi(p["mat"]))
    nm = name or f"Architecture_Wall_{wid.title().replace('_', '')}"
    ob = mb.build(nm, col, sharp=30.0)
    if arris > 0:
        C.bevel(ob, arris, 2, 30.0, harden=True)
        _dissolve_degenerate(ob)
    ob["ovr_wall"] = wid
    return ob


# ---------------------------------------------------------------------------
# Lift shaft (plan.LIFT): the shaft is a solid box in the hall corner up to the ceiling; its two
# free faces are stone walls (hall finish) with the lift door holes on the door face.
# ---------------------------------------------------------------------------

def _rect(x0, x1, z0, z1):
    return {"minX": round(min(x0, x1), 4), "maxX": round(max(x0, x1), 4), "minZ": round(min(z0, z1), 4), "maxZ": round(max(z0, z1), 4)}


def lift_walls():
    """The lift shaft's free faces as plan-style Wall dicts (only when the shaft stands in a hall
    corner): [x-face wall (axis 'z'), z-face wall (axis 'x')]."""
    s = P.LIFT["shaft"]
    h = P.HALL
    x0, x1, z0, z1 = s["minX"], s["maxX"], s["minZ"], s["maxZ"]
    on_e, on_w = abs(x1 - h["maxX"]) < 1e-6, abs(x0 - h["minX"]) < 1e-6
    on_n, on_s = abs(z0 - h["minZ"]) < 1e-6, abs(z1 - h["maxZ"]) < 1e-6
    if not ((on_e or on_w) and (on_n or on_s)):
        return []
    t = LIFT_WALL_T
    fx, inside_x = (x0, "west") if on_e else (x1, "east")
    fz, inside_z = (z1, "south") if on_n else (z0, "north")
    wx = dict(id="lift_x", bounds=_rect(fx, fx + (t if on_e else -t), z0, z1), y0=0.0, y1=P.HALL_CEILING,
              axis="z", inside=inside_x, room="hall", openings=[])
    wz = dict(id="lift_z", bounds=_rect(x0, x1, fz, fz + (-t if on_n else t)), y0=0.0, y1=P.HALL_CEILING,
              axis="x", inside=inside_z, room="hall", openings=[])
    door_x, door_z, dw = P.LIFT["door_x"], P.LIFT["door_z"], P.LIFT["door_width"]
    host, at = (wx, door_z) if abs(door_x - fx) < 1e-6 else (wz, door_x)
    for i, lv in enumerate(P.LIFT["levels"]):
        host["openings"].append(dict(id=f"lift_door_{i}", kind="elevator", at=at, width=dw, y0=lv, y1=lv + LIFT_DOOR_H,
                                     passable=True, spring=None))
    return [wx, wz]


def build_lift_shaft(col=None):
    """Stone faces of the lift shaft (hall finish) with the lift door holes (doors: arch_windows)."""
    col = col or _sub(COL_WALLS)
    lw = lift_walls()
    walls = _all_walls() + lw
    return [build_wall(w, walls=walls, name=f"Architecture_LiftShaft_{w['id'][-1].upper()}", col=col) for w in lw]


# ---------------------------------------------------------------------------
# Carving primitives. Each takes a FRAME function F(x, f, z[, w]) that maps carving-local
# coordinates (x across, f forward off the support surface, z up) to 3D, so the same leaf or
# scroll can sit on a flat face, fold round an arris, lie under a modillion or on a keystone.
# ---------------------------------------------------------------------------

# Acanthus lobes per side, stem to tip: (v0, v1, finger tip half-widths). Fingers point up and
# out; between lobes the outline drops to a deep notch (the 'eye').
LEAF_LOBES = {
    "std": [(0.05, 0.30, (0.74, 0.82, 0.88)), (0.35, 0.62, (0.93, 0.99, 1.0, 0.96)), (0.665, 0.82, (0.88, 0.82, 0.74))],
    "small": [(0.06, 0.40, (0.78, 0.86, 0.9)), (0.46, 0.78, (0.97, 1.0, 0.9))],
    "mini": [(0.10, 0.48, (0.84, 0.94)), (0.55, 0.80, (1.0, 0.88))],
    "micro": [(0.12, 0.52, (0.86,)), (0.60, 0.82, (1.0,))],
}
LEAF_COLS = {
    "std": (-1.0, -0.8, -0.56, -0.32, -0.1, 0.0, 0.1, 0.32, 0.56, 0.8, 1.0),
    "small": (-1.0, -0.78, -0.52, -0.28, -0.09, 0.0, 0.09, 0.28, 0.52, 0.78, 1.0),
    "mini": (-1.0, -0.55, -0.12, 0.0, 0.12, 0.55, 1.0),
    "micro": (-1.0, -0.42, 0.0, 0.42, 1.0),
}
EYE_W = 0.50


def _leaf_rows(kind):
    """[(v, half-width fraction, eye factor, finger phase, lobe phase)] rows of an acanthus leaf
    outline: finger phase 0 at the notch between fingers, 0.8 at a finger tip; lobe phase 0..1
    across each lobe."""
    lobes = LEAF_LOBES[kind]
    rows = [(0.0, 0.44, 0.0, 0.5, 0.0)]
    for li, (a, b, tips) in enumerate(lobes):
        if li > 0:
            pb = lobes[li - 1][1]
            rows.append(((pb + a) / 2, EYE_W, 1.0, 0.0, 0.0))
        nf = len(tips)
        st = (b - a) / nf
        for k, wt in enumerate(tips):
            v0 = a + k * st
            win = max(EYE_W + 0.08, wt * 0.76) if k == 0 else wt * 0.89
            teeth = ((0.0, win, 0.6 if k == 0 else 0.2), (0.5, win + 0.7 * (wt - win), 0.0), (0.82, wt, 0.0)) if kind == "micro" else \
                    ((0.0, win, 0.6 if k == 0 else 0.2), (0.42, win + 0.66 * (wt - win), 0.0), (0.8, wt, 0.0), (0.93, wt * 0.96, 0.0))
            for ph, wv, ey in teeth:
                rows.append((v0 + ph * st, wv, ey, ph, (k + ph) / nf))
    b = lobes[-1][1]
    rest = 1.0 - b
    tip = ((0.15, EYE_W * 0.92, 1.0, 0.0), (0.45, 0.62, 0.0, 0.8), (0.75, 0.48, 0.0, 0.3), (1.0, 0.12, 0.0, 0.8)) if kind == "micro" else \
          ((0.12, EYE_W * 0.92, 1.0, 0.0), (0.3, 0.66, 0.0, 0.8), (0.46, 0.6, 0.3, 0.0), (0.6, 0.62, 0.0, 0.8),
           (0.76, 0.5, 0.0, 0.3), (0.9, 0.32, 0.0, 0.6), (1.0, 0.1, 0.0, 0.8))
    for f, wv, ey, ph in tip:
        rows.append((b + f * rest, wv, ey, ph, min(1.0, f)))
    return rows


def _leaf_rel(t, eye, S, ph=0.5, lob=0.5):
    """Relief across the leaf (normal offset): raised midrib in a pair of channels, cupped lobes
    that bulge at their middles, fingers whose tips lift forward more than the notches between
    them, and a pocket at each eye."""
    a = abs(t)
    tip = 0.7 + 0.5 * max(0.0, 1.0 - abs(ph - 0.8) / 0.45)
    bulge = 0.006 * math.sin(math.pi * lob) * _smooth((a - 0.25) / 0.45)
    if a < 0.04:
        rib = 0.0065
    elif a < 0.2:
        rib = -0.0055 * (1 - abs(a - 0.1) / 0.1) - 0.001
    else:
        rib = 0.0
    cup = -0.012 * math.sin(math.pi * min(1.0, max(0.0, (a - 0.14) / 0.78)))
    edge = 0.014 * a ** 3 * tip
    pocket = -0.013 * eye * _smooth((a - 0.2) / 0.5)
    return S * (rib + cup + edge + pocket + bulge)


def _acanthus(mb, mat, F, width, height, kind="std", lean=0.03, curl=0.16, phi_deg=168.0, thick=0.009,
              sink=0.004, billow=1.0, uv_right=None, unfold=False):
    """A carved acanthus leaf: lobed outline with pointed fingers and deep eyes, raised midrib,
    cupped lobes, and a tip that rolls forward and down (undercut). F(x, f, z) maps leaf-local
    across x, forward f (off the support) and up z (from the foot) to 3D. Closed where it lifts
    off the support (back + rims); the attached part has front and rims only. With `unfold`, F
    takes a 4th argument w: 1 for the lower leaf (folded onto the faces of an arris), easing to 0
    for the tip lobe, which then bends out on the diagonal as one piece."""
    mb = getattr(mb, "carve", None) or mb
    rows = _leaf_rows(kind)
    cols = LEAF_COLS[kind]
    S = width / 0.24
    R = curl * height
    hs = max(0.02, height - R)
    phi = math.radians(phi_deg)
    vc = hs / (hs + R * phi)

    def straight(f):
        return -sink + lean * f ** 1.6, hs * f

    def spine(v):
        if v <= vc:
            f_ = v / vc
            d, z = straight(f_)
            d2, z2 = straight(min(1.0, f_ + 1e-3))
            d1, z1 = straight(max(0.0, f_ - 1e-3))
            return d, z, d2 - d1, z2 - z1
        d, z = straight(1.0)
        d1, z1 = straight(1.0 - 1e-3)
        a0 = math.atan2(d - d1, z - z1)
        ph = (v - vc) / (1 - vc) * phi
        return (d + R * (math.cos(a0) - math.cos(a0 + ph)), z + R * (math.sin(a0 + ph) - math.sin(a0)),
                math.sin(a0 + ph), math.cos(a0 + ph))

    front, back, lifted = [], [], []
    F0 = F
    for v, wf, eye, ph, lob in rows:
        if unfold:
            wv = 1.0 - _smooth((v - 0.42) / 0.38)
            F = lambda x, f, z, wv=wv: F0(x, f, z, wv)
        d, z, dd, dz = spine(v)
        ln = math.hypot(dd, dz) or 1.0
        nd, nz = dz / ln, -dd / ln
        hw = width / 2 * wf
        bil = billow * 0.012 * S * math.sin(math.pi * min(1.0, v / max(vc, 1e-3))) ** 0.8
        rf, rb = [], []
        for t in cols:
            rel = _leaf_rel(t, eye, S, ph, lob) + bil
            # fingers at the outline also bend outward a touch (they flare)
            x = t * hw * (1.0 + 0.06 * abs(t) ** 3)
            rf.append(F(x, d + rel * nd, z + rel * nz))
            rb.append(F(x, d + (rel - thick) * nd, z + (rel - thick) * nz))
        front.append(rf)
        back.append(rb)
        lifted.append(d > thick * 1.6 or v > vc * 0.9)
    F = (lambda x, f, z: F0(x, f, z, 1.0)) if unfold else F0
    # Orientation: the front of a straight row must face forward (+f).
    i0 = 1
    d, z, dd, dz = spine(rows[i0][0])
    probe = F(0.0, d + 0.01, z) - F(0.0, d, z)
    mid = len(cols) // 2
    f0 = [front[i0][mid - 1], front[i0][mid], front[i0 + 1][mid], front[i0 + 1][mid - 1]]
    flip = _newell([tuple(p) for p in f0]).dot(probe) < 0
    sz = LM.tex_size(mat)
    mi = mb.mi(mat)
    mb.new_part()
    Rn, Cn = len(front), len(cols)

    def put(f):
        f = list(reversed(f)) if flip else f
        mb.pface(f, mi, sz, right=uv_right)

    for i in range(Rn - 1):
        for j in range(Cn - 1):
            put([front[i][j], front[i][j + 1], front[i + 1][j + 1], front[i + 1][j]])
            if lifted[i] or lifted[i + 1]:
                put([back[i][j], back[i + 1][j], back[i + 1][j + 1], back[i][j + 1]])
        put([front[i][0], front[i + 1][0], back[i + 1][0], back[i][0]])
        put([front[i][-1], back[i][-1], back[i + 1][-1], front[i + 1][-1]])
    for j in range(Cn - 1):
        put([front[0][j], back[0][j], back[0][j + 1], front[0][j + 1]])
        put([front[-1][j], front[-1][j + 1], back[-1][j + 1], back[-1][j]])


def _scroll(mb, mat, F, xc, zc, r0, hand, tail0, bw0=None, depth=None, turns=2.1, q=0.42, n_turn=26, n_tail=10,
            eye=True):
    """A volute / helix: a channelled band that rises from `tail0` (x, z), runs over the top of
    the spiral and rolls in (hand +1 clockwise seen from the front, -1 counter-clockwise) to an
    eye. The band has depth (it projects from the support plane) with raised rims and a channel.
    F(x, d, z, w): d = forward from the support, w = 1 attached to the face (the tail start),
    0 free (the spiral)."""
    mb = getattr(mb, "carve", None) or mb
    bw0 = bw0 or 0.30 * r0
    depth = depth or 0.42 * r0
    path = []
    P3 = (xc, zc + r0 - bw0 / 2)
    P0 = tail0
    P1 = (P0[0], P0[1] + 0.8 * (P3[1] - P0[1]))
    P2 = (xc - hand * 0.95 * r0, P3[1])
    tail = _bez(P0, P1, P2, P3, n_tail)
    for i, p in enumerate(tail[:-1]):
        f = i / n_tail
        path.append((p, 0.62 + 0.38 * f, 0.55 + 0.45 * f, 1.0 - _smooth(f * 1.15)))
    nsp = max(8, int(turns * n_turn))
    for i in range(nsp + 1):
        ph = turns * math.tau * i / nsp
        r = r0 * q ** (ph / math.tau)
        rn = r0 * q ** ((ph + math.tau) / math.tau)
        bw = min(bw0 * (r / r0) ** 0.45, 0.86 * (r - rn))
        th = math.pi / 2 - hand * ph
        rc = r - bw / 2
        path.append(((xc + rc * math.cos(th), zc + rc * math.sin(th)), bw / bw0, max(0.6, (r / r0) ** 0.3), 0.0))
    ring_shape = [(0.5, 0.0), (0.5, 0.7), (0.32, 1.0), (0.0, 0.82), (-0.32, 1.0), (-0.5, 0.7), (-0.5, 0.0)]
    m = len(path)
    rings = []
    for i in range(m):
        p = Vector(path[i][0])
        q0, q1 = Vector(path[max(0, i - 1)][0]), Vector(path[min(m - 1, i + 1)][0])
        tan = (q1 - q0)
        tan = tan.normalized() if tan.length > 1e-9 else Vector((1, 0))
        N = Vector((-tan.y, tan.x)) if hand > 0 else Vector((tan.y, -tan.x))
        bw = bw0 * path[i][1]
        D = depth * path[i][2]
        w = path[i][3]
        rings.append([F(p.x + N.x * e * bw, D * dd, p.y + N.y * e * bw, w) for e, dd in ring_shape])
    mi = mb.mi(mat)
    sz = LM.tex_size(mat)
    mb.new_part()
    # orientation: a front (max depth) face must face forward
    i1 = m // 3
    fwd = F(path[i1][0][0], 1.0, path[i1][0][1], path[i1][3]) - F(path[i1][0][0], 0.0, path[i1][0][1], path[i1][3])
    test = [rings[i1][2], rings[i1 + 1][2], rings[i1 + 1][3], rings[i1][3]]
    flip = _newell([tuple(v) for v in test]).dot(fwd) < 0
    k = len(ring_shape)
    for i in range(m - 1):
        for j in range(k):
            j2 = (j + 1) % k
            f = [rings[i][j], rings[i + 1][j], rings[i + 1][j2], rings[i][j2]]
            mb.pface(list(reversed(f)) if flip else f, mi, sz)
    for ring, sgn in ((rings[0], -1), (rings[-1], 1)):
        c0 = sum(ring, Vector()) / k
        other = rings[1] if sgn < 0 else rings[-2]
        c1 = sum(other, Vector()) / k
        pts, _ = _orient([tuple(v) for v in ring], None, c0 - c1)
        mb.pface([Vector(v) for v in pts], mi, sz)
    if eye:
        c = F(xc, 0.0, zc, 0.0)
        out = F(xc, 1.0, zc, 0.0) - c
        right = F(xc + 1.0, 0.0, zc, 0.0) - c
        re = max(0.006, r0 * q ** turns + 0.25 * bw0)
        _dome(mb, mat, c, out, right, re, depth * 0.95, seg=12, lift=depth * 0.1)


def _dome(mb, mat, centre, out, right, radius, height, seg=12, lift=0.0, rings=3, sink=0.003):
    """A domed boss (volute eye, scroll button), base sunk into its support."""
    mb = getattr(mb, "carve", None) or mb
    out = Vector(out).normalized()
    right = Vector(right).normalized()
    up = out.cross(right).normalized()
    mi = mb.mi(mat)
    sz = LM.tex_size(mat)
    mb.new_part()
    prof = [(1.0, -sink)] + [(math.cos(math.pi / 2 * k / rings), lift + height * math.sin(math.pi / 2 * k / rings)) for k in range(rings)]
    grid = []
    for rr, hh in prof:
        grid.append([centre + right * (radius * rr * math.cos(math.tau * k / seg)) + up * (radius * rr * math.sin(math.tau * k / seg)) + out * hh
                     for k in range(seg)])
    tip = centre + out * (lift + height)
    for i in range(len(grid) - 1):
        for k in range(seg):
            k2 = (k + 1) % seg
            f = [grid[i][k], grid[i][k2], grid[i + 1][k2], grid[i + 1][k]]
            fc = sum(f, Vector()) / 4
            pts, _ = _orient([tuple(p) for p in f], None, fc - (centre - out * radius))
            mb.pface([Vector(p) for p in pts], mi, sz)
    for k in range(seg):
        f = [grid[-1][k], grid[-1][(k + 1) % seg], tip]
        pts, _ = _orient([tuple(p) for p in f], None, out)
        mb.pface([Vector(p) for p in pts], mi, sz)


def _flower(mb, mat, centre, out, right, R, petals=8, inner=5, height=None, res=1, sink=0.003, button=True, button_seg=10):
    """A carved rosette / fleuron: spoon-shaped petals (cupped, pointed, tips lifting) in one or
    two layers round a domed button. Each petal is a raised skin with a skirt down to the base."""
    mb = getattr(mb, "carve", None) or mb
    out = Vector(out).normalized()
    right = Vector(right).normalized()
    up = out.cross(right).normalized()
    H = height if height is not None else 0.32 * R
    mi = mb.mi(mat)
    sz = LM.tex_size(mat)
    nr, na = (4, 5) if res else (3, 3)

    def petal(r0, r1, ang, half, hbase, hgain, cup):
        mb.new_part()
        grid = []
        for i in range(nr + 1):
            u = i / nr
            r = r0 + (r1 - r0) * u
            if u < 0.6:
                wprof = 0.42 + 0.58 * math.sin(math.pi / 2 * u / 0.6)
            else:
                wprof = max(0.0, 1.0 - (u - 0.6) / 0.4) ** 0.75
            hw = half * max(0.06, wprof)
            row = []
            for j in range(na):
                s = -1 + 2 * j / (na - 1)
                a = ang + s * hw
                h = hbase + hgain * (math.sin(math.pi * 0.5 * u) * 0.7 + 0.3 * u ** 3) - cup * (1 - s * s) * math.sin(math.pi * min(1, u * 1.1))
                row.append(centre + right * (r * math.cos(a)) + up * (r * math.sin(a)) + out * h)
            grid.append(row)
        foot = lambda p: p - out * ((p - centre).dot(out) + sink)
        for i in range(nr):
            for j in range(na - 1):
                f = [grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]]
                pts, _ = _orient([tuple(p) for p in f], None, out)
                mb.pface([Vector(p) for p in pts], mi, sz)
        rim = [grid[0][j] for j in range(na)] + [grid[i][-1] for i in range(1, nr + 1)] + \
              [grid[-1][j] for j in range(na - 2, -1, -1)] + [grid[i][0] for i in range(nr - 1, 0, -1)]
        pc = centre + right * ((r0 + r1) / 2 * math.cos(ang)) + up * ((r0 + r1) / 2 * math.sin(ang))
        for k in range(len(rim)):
            a_, b_ = rim[k], rim[(k + 1) % len(rim)]
            f = [a_, b_, foot(b_), foot(a_)]
            fc = sum(f, Vector()) / 4
            pts, _ = _orient([tuple(p) for p in f], None, fc - pc)
            mb.pface([Vector(p) for p in pts], mi, sz)

    for k in range(petals):
        petal(0.16 * R, R, math.tau * k / petals, math.pi / petals * 0.94, 0.18 * H, 0.55 * H, 0.22 * H)
    if inner:
        for k in range(inner):
            petal(0.12 * R, 0.62 * R, math.tau * (k + 0.5) / inner, math.pi / inner * 0.9, 0.45 * H, 0.5 * H, 0.18 * H)
    if button:
        _dome(mb, mat, centre + out * (0.55 * H if inner else 0.3 * H), out, right, 0.2 * R, 0.55 * H, seg=button_seg,
              rings=2 if res else 1)


def _caulicolus(mb, mat, F, x0, z0, x1, z1, rad=0.019):
    """A fluted stalk rising on the support (half-embedded), with a knot and a scalloped calyx cup
    at its top, from which a volute and a helix spring."""
    mi = mb.mi(mat)
    sz = LM.tex_size(mat)
    a = Vector((x1 - x0, z1 - z0))
    L = a.length
    a.normalize()
    perp = Vector((-a.y, a.x))
    n_ang = 11

    def ring(s, rr, flutes=True, fwd=0.0):
        cx, cz = x0 + a.x * s, z0 + a.y * s
        out = []
        for k in range(n_ang):
            al = math.pi * k / (n_ang - 1)
            rk = rr * (0.84 if (flutes and k % 2 == 1) else 1.0)
            out.append(F(cx + perp.x * rk * math.cos(al), rr * 0.35 + fwd + rk * math.sin(al), cz + perp.y * rk * math.cos(al)))
        return out

    mb.new_part()
    rings = [ring(0.0, rad * 0.9), ring(L * 0.5, rad), ring(L * 0.86, rad * 1.04)]
    knot = [ring(L * 0.86, rad * 1.32, False), ring(L * 0.93, rad * 1.36, False), ring(L, rad * 1.18, False)]
    centre_axis = lambda s: F(x0 + a.x * s, 0.0, z0 + a.y * s)
    for grp in (rings, knot):
        for r0_, r1_ in zip(grp, grp[1:]):
            for k in range(n_ang - 1):
                f = [r0_[k], r0_[k + 1], r1_[k + 1], r1_[k]]
                fc = sum(f, Vector()) / 4
                pts, _ = _orient([tuple(p) for p in f], None, fc - centre_axis(L * 0.5) - (fc - centre_axis(L * 0.5)).project(F(x1, 0, z1) - F(x0, 0, z0)))
                mb.pface([Vector(p) for p in pts], mi, sz)
    # calyx: a scalloped cup opening upward from the knot
    mb.new_part()
    lobes = 5
    rim_n = 21
    base = []
    top = []
    for k in range(rim_n):
        al = math.pi * k / (rim_n - 1)
        sc = 1.0 + 0.28 * abs(math.cos(lobes * al / 2)) ** 0.6
        cx, cz = x0 + a.x * L, z0 + a.y * L
        base.append(F(cx + perp.x * rad * 1.1 * math.cos(al), rad * 0.35 + rad * 1.1 * math.sin(al), cz + perp.y * rad * 1.1 * math.cos(al)))
        rr = rad * 2.1 * sc
        top.append(F(cx + perp.x * rr * math.cos(al) + a.x * rad * 1.5, rad * 0.35 + rr * 0.85 * math.sin(al),
                     cz + perp.y * rr * math.cos(al) + a.y * rad * 1.5 + rad * 0.5 * sc))
    cax = F(x0 + a.x * L, 0.0, z0 + a.y * L)
    for k in range(rim_n - 1):
        f = [base[k], base[k + 1], top[k + 1], top[k]]
        fc = sum(f, Vector()) / 4
        pts, _ = _orient([tuple(p) for p in f], None, fc - cax)
        mb.pface([Vector(p) for p in pts], mi, sz)
        pts, _ = _orient([tuple(p) for p in f], None, cax - fc)
        inner_pts = [Vector(p) + (cax - fc).normalized() * 0.0025 for p in pts]
        mb.pface(inner_pts, mi, sz)


# ---------------------------------------------------------------------------
# Pilasters (local frame: wall face y = 0, room on -Y, base at z = 0)
# ---------------------------------------------------------------------------

EXT_LEG = 0.165     # legs of the outward-folded pilaster on the lift shaft corner (clear of the lift door surround)


def _pilaster_outline(kind, leg=None):
    """Plan outline of the shaft face, right-hand normal pointing into the room.
    full: on a flat wall. corner: folded into an internal corner (second wall on x = 0, room +X).
    external: folded round an external corner (pier body at x >= 0, y >= 0)."""
    w, p = PIL_W, PIL_P
    if kind == "full":
        return [(-w / 2, 0.0), (-w / 2, -p), (w / 2, -p), (w / 2, 0.0)]
    if kind == "corner":
        return [(0.0, -w / 2), (p, -w / 2), (p, -p), (w / 2, -p), (w / 2, 0.0)]
    L = leg or EXT_LEG
    return [(0.0, L), (-p, L), (-p, -p), (L, -p), (L, 0.0)]


def _pilaster_back(kind):
    return [Vector((0.0, 0.0))] if kind in ("corner", "external") else []


def _is_concave_end(outline, pt):
    for i in range(1, len(outline) - 1):
        if (_v2(outline[i]) - pt).length < 1e-6:
            a, b, c = _v2(outline[i - 1]), _v2(outline[i]), _v2(outline[i + 1])
            t0, t1 = (b - a).normalized(), (c - b).normalized()
            return t0.x * t1.y - t0.y * t1.x < 0
    return False


def _fluted_outline(outline, rr=0.006):
    """The shaft outline with flutes on every front face; convex arrises (pilaster corners and
    flute edges) get a small round, the flute channels stay crisp."""
    fl_w, fillet, depth, edge = 0.071, 0.022, 0.026, 0.046
    pts = [_v2(outline[0])]
    for i in range(len(outline) - 1):
        fa, fb = _v2(outline[i]), _v2(outline[i + 1])
        L = (fb - fa).length
        if L > PIL_P + 0.02:
            m0 = fillet * 0.6 if _is_concave_end(outline, fa) else edge
            m1 = fillet * 0.6 if _is_concave_end(outline, fb) else edge
            avail = L - m0 - m1
            nfl = max(1, int((avail + fillet) // (fl_w + fillet)))
            used = nfl * fl_w + (nfl - 1) * fillet
            start = m0 + (avail - used) / 2
            t = (fb - fa).normalized()
            nrm = Vector((t.y, -t.x))
            for f in range(nfl):
                s0 = start + f * (fl_w + fillet)
                for k in range(9):
                    ang = math.pi * k / 8
                    pts.append(fa + t * (s0 + fl_w * (1 - math.cos(ang)) / 2) + nrm * (-depth * math.sin(ang)))
        pts.append(fb)
    return [tuple(p) for p in _round_corners(pts, rr, 2, convex_only=True, min_turn=40)]


def _base_profile():
    """Attic base: plinth, lower torus, scotia between fillets, upper torus, apophyge."""
    return _prof(
        [(BASE_PROJ, 0.0), (BASE_PROJ, 0.116), (0.090, 0.116)],
        _arc(0.090, 0.160, 0.044, -90, 90, 8),
        [(0.062, 0.204), (0.062, 0.212)],
        [(0.052, 0.216), (0.043, 0.226), (0.039, 0.242), (0.042, 0.256), (0.054, 0.268)],
        [(0.056, 0.268), (0.056, 0.276), (0.046, 0.278)],
        _arc(0.046, 0.300, 0.022, -90, 90, 6),
        [(0.022, 0.324), (0.022, 0.330)],
        _bez((0.022, 0.330), (0.004, 0.330), (0.0, 0.345), (0.0, BASE_H), 4),
        r=0.003,
    )


def _bell_d(zl):
    """Bell offset (relative to the shaft face) at capital-local height zl."""
    t = max(0.0, min(1.0, (zl - 0.06) / 0.62))
    return BELL_FLARE * t ** 1.7


def _bell_profile():
    n = 12
    bell = [(_bell_d(0.06 + 0.62 * k / n), 0.06 + 0.62 * k / n) for k in range(n + 1)]
    return _prof(
        [(0.0, 0.0), (0.006, 0.0)],
        _arc(0.010, 0.022, 0.022, -90, 90, 8),
        [(0.006, 0.046), (0.006, 0.055), (0.0, 0.058)],
        bell,
        _arc(BELL_FLARE, 0.692, 0.011, -90, 90, 6)[1:],
        [(BELL_FLARE - 0.004, ABACUS_Z), (BELL_FLARE - 0.004, ABACUS_Z + 0.009), (0.0, ABACUS_Z + 0.009)],
        r=0.002,
    )


def _abacus_profile():
    z0 = ABACUS_Z
    return _prof(
        [(0.055, z0), (0.116, z0), (0.116, z0 + 0.008)],
        _arc(0.134, z0 + 0.008, 0.018, 180, 90, 4)[1:],
        [(0.136, z0 + 0.03), (0.136, z0 + 0.036)],
        _arc(0.136, z0 + 0.066, 0.03, -90, 0, 5)[1:],
        [(0.166, CAP_H - 0.015), (0.166, CAP_H), (0.0, CAP_H)],
        r=0.0015,
    )


def _abacus_path(outline):
    """Concave-sided abacus: fronts sag back at their middle, convex corners are clipped (the
    offset mitres of a tiny chamfer give the horns' 45-degree cuts)."""
    pts = []
    for i in range(len(outline) - 1):
        a, b = _v2(outline[i]), _v2(outline[i + 1])
        L = (b - a).length
        t = (b - a).normalized()
        nrm = Vector((t.y, -t.x))
        front = L > PIL_P + 0.02
        sag = (0.02 if L > 0.5 else 0.008) if front else 0.0
        k = 10 if front else 1
        for j in range(k + 1):
            if j == 0 and i > 0:
                continue
            s = L * j / k
            pts.append(a + t * s - nrm * sag * math.sin(math.pi * s / L))
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        p, a, b = pts[i], pts[i - 1], pts[i + 1]
        t0, t1 = (p - a).normalized(), (b - p).normalized()
        if t0.x * t1.y - t0.y * t1.x > 0.5:
            out += [p - t0 * 0.004, p + t1 * 0.004]
        else:
            out.append(p)
    out.append(pts[-1])
    return out


def _outline_features(outline):
    """Segments (with 'front' flags) and interior vertices (convex arrises / concave folds) of a
    pilaster outline, with the fold axes used by the carving frames."""
    segs = []
    for a, b in zip(outline, outline[1:]):
        a, b = _v2(a), _v2(b)
        d = b - a
        L = d.length
        t = d / L
        segs.append(dict(a=a, b=b, L=L, t=t, n=Vector((t.y, -t.x)), front=L > PIL_P + 0.02))
    verts = []
    for i in range(1, len(outline) - 1):
        A, B = segs[i - 1], segs[i]
        cross = A["t"].x * B["t"].y - A["t"].y * B["t"].x
        verts.append(dict(p=_v2(outline[i]), A=A, B=B, convex=cross > 0,
                          td=(A["t"] + B["t"]).normalized(), nd=(A["n"] + B["n"]).normalized()))
    return segs, verts


def _flat_frame(base, t, n):
    def F(x, d, z, w=0.0):
        dd = d + _bell_d(z - PIL_Z0_CAP)
        return Vector((base.x + t.x * x + n.x * dd, base.y + t.y * x + n.y * dd, z))
    return F


def _fold_frame(c, A, B, xw=0.02):
    """Support folded round an arris or into a fold of the bell: x < 0 runs back along the
    incoming face A, x > 0 along the outgoing face B, both measured from the bell's mitred corner;
    offsets d go along each face's own normal (blended across the crease, so a leaf's halves curl
    off their own faces instead of sliding). w blends to the diagonal plane through the corner
    (w = 0, where a volute's spiral stands free)."""
    uA, uB, nA, nB = A["t"], B["t"], A["n"], B["n"]
    td, nd = (uA + uB).normalized(), (nA + nB).normalized()

    def F(x, d, z, w=1.0):
        m = c + (nA + nB) * _bell_d(z - PIL_Z0_CAP)
        lam = _smooth((x + xw) / (2 * xw))
        n = (nA * (1 - lam) + nB * lam).normalized()
        lat = -uA * max(0.0, -x) + uB * max(0.0, x)
        p = (m + lat + n * d) * w + (m + td * x + nd * d) * (1 - w)
        return Vector((p.x, p.y, z))
    return F


def _leaf_on(mb, frame, zfoot, width, height, **kw):
    if kw.get("unfold"):
        _acanthus(mb, CARVED, lambda x, f, z, w=1.0: frame(x, f, zfoot + z, w), width, height, **kw)
    else:
        _acanthus(mb, CARVED, lambda x, f, z: frame(x, f, zfoot + z), width, height, **kw)


def _capital(mb, outline, path, back):
    """Corinthian capital: astragal, flared bell with lip, concave-sided abacus with clipped horns;
    two rows of acanthus (folded round every arris and into every fold), fluted caulicoli with
    calyx cups, corner volutes projecting diagonally under the horns, inner helices meeting under
    a fleuron on each full face."""
    stone = mb.mi(CARVED)
    sz = LM.tex_size(CARVED)
    to3 = _plan3d()
    z0 = PIL_Z0_CAP
    capp = [(o, h + z0) for o, h in _bell_profile()]
    rings = _sweep(mb, path, capp, to3, mat=stone, uv_size=sz)
    _cap(mb, list(rings[0]) + back, capp[0][1], to3, False, stone, sz)
    mb.new_part()
    abp = [(o, h + z0) for o, h in _abacus_profile()]
    _sweep(mb, _abacus_path(outline), abp, to3, mat=stone, uv_size=sz)
    segs, verts = _outline_features(outline)
    for vx in verts:
        c, td, nd = vx["p"], vx["td"], vx["nd"]
        if vx["convex"]:
            if not (vx["A"]["front"] or vx["B"]["front"]):
                continue
            F = _fold_frame(c, vx["A"], vx["B"])
            _leaf_on(mb, F, z0 + 0.10, 0.19, 0.43, kind="small", lean=0.012, curl=0.15, phi_deg=160, sink=0.007, unfold=True)
            _leaf_on(mb, F, z0 + 0.055, 0.22, 0.30, kind="small", lean=0.02, curl=0.16, phi_deg=160, unfold=True)
            hand = 1 if vx["A"]["front"] else -1
            full = (vx["A"] if hand > 0 else vx["B"])["L"] > 0.5
            s_t, z_t = (0.085, z0 + 0.505) if full else (0.05, z0 + 0.47)
            xt = -hand * (s_t + _bell_d(z_t - z0))
            _scroll(mb, CARVED, F, 0.0, z0 + ABACUS_Z - 0.10, 0.10, hand, (xt, z_t), bw0=0.03, depth=0.046,
                    turns=2.0, q=0.42, n_turn=24)
        else:
            F = _fold_frame(c, vx["A"], vx["B"])
            _leaf_on(mb, F, z0 + 0.10, 0.18, 0.44, kind="small", lean=0.012, curl=0.14, sink=0.007, unfold=True)
            _leaf_on(mb, F, z0 + 0.055, 0.21, 0.30, kind="small", lean=0.022, curl=0.16, unfold=True)
    for sg in segs:
        if not sg["front"]:
            continue
        L, t, n = sg["L"], sg["t"], sg["n"]
        c = sg["a"] + t * (L / 2)
        F = _flat_frame(c, t, n)
        ab_front = c + n * (0.15 - (0.02 if L > 0.5 else 0.008))
        if L > 0.5:
            _leaf_on(mb, F, z0 + 0.055, 0.29, 0.32, kind="std", lean=0.03, curl=0.17)
            for sx in (-1, 1):
                _leaf_on(mb, lambda x, d, z, w=0.0, sx=sx: F(x + sx * 0.165, d, z), z0 + 0.10, 0.22, 0.47,
                         kind="std", lean=0.016, curl=0.15, sink=0.007)
                xa = sx * (L / 2 - 0.10)
                xb = sx * (L / 2 - 0.085)
                _caulicolus(mb, CARVED, F, xa, z0 + 0.36, xb, z0 + 0.49, rad=0.018)
                _scroll(mb, CARVED, F, sx * 0.072, z0 + ABACUS_Z - 0.05, 0.044, -sx, (xb, z0 + 0.51),
                        bw0=0.016, depth=0.026, turns=1.8, q=0.45, n_turn=20, n_tail=8)
            _flower(mb, CARVED, Vector((ab_front.x, ab_front.y, z0 + 0.748)), n.to_3d(), t.to_3d(), 0.078,
                    petals=7, inner=5, height=0.05, res=1)
        else:
            a_conv = not _is_concave_end(outline, sg["a"])
            b_conv = not _is_concave_end(outline, sg["b"])
            if a_conv and b_conv:
                _flower(mb, CARVED, Vector((ab_front.x, ab_front.y, z0 + 0.752)), n.to_3d(), t.to_3d(), 0.042,
                        petals=6, inner=0, height=0.026, res=1)


def build_pilaster(kind="full", name=None, col=None, leg=None):
    """One pilaster mesh in its local wall frame (wall face y = 0, room -Y, base z = 0, top at
    PIL_H). kind 'full', 'corner' (folded into an internal corner, second wall on x = 0) or
    'external' (folded round an external corner, legs `leg`)."""
    outline = _pilaster_outline(kind, leg)
    path = _round_corners(outline, 0.006, 2)
    back = _pilaster_back(kind)
    mb = _MB()
    stone, shaft_mat = mb.mi(CARVED), mb.mi("limestone")
    to3 = _plan3d()
    sz = LM.tex_size(CARVED)
    base = _base_profile()
    rings = _sweep(mb, path, base, to3, mat=stone, uv_size=sz)
    _cap(mb, list(rings[-1]) + back, base[-1][1], to3, True, stone, sz)
    fl = _fluted_outline(outline)
    ssz = LM.tex_size("limestone")
    # V runs from the hall floor so the shaft's courses line up with the wall's ashlar courses.
    mb.new_part()
    _sweep(mb, fl, [(0.0, BASE_H), (0.0, PIL_Z0_CAP)], to3, mat=shaft_mat, uv_size=ssz, v_mode=lambda p: (p[1] + PIL_Z0) / ssz)
    mb.new_part()
    _capital(mb, outline, path, back)
    ob = mb.build(name or f"Architecture_Pilaster_{kind.title()}", col, sharp=40.0)
    return ob


# ---------------------------------------------------------------------------
# Hall layout helpers
# ---------------------------------------------------------------------------

def _wall_by_id(wid):
    for w in list(P.WALLS) + lift_walls():
        if _g(w, "id") == wid:
            return w
    raise KeyError(wid)


def _face_frame(wall, side=None):
    """(c_face, R, Out, sgn, thickness) of a wall face; side 'lo'/'hi' (default: the room side)."""
    side = side or _inner_side(wall)
    axis = _g(wall, "axis")
    _, _, c_lo, c_hi = _wall_dims(wall)
    if axis == "x":
        if side == "lo":
            return c_lo, Vector((-1, 0, 0)), Vector((0, 1, 0)), -1, c_hi - c_lo
        return c_hi, Vector((1, 0, 0)), Vector((0, -1, 0)), 1, c_hi - c_lo
    if side == "lo":
        return c_lo, Vector((0, -1, 0)), Vector((-1, 0, 0)), 1, c_hi - c_lo
    return c_hi, Vector((0, 1, 0)), Vector((1, 0, 0)), -1, c_hi - c_lo


def _face_matrix(wall, u, v=0.0, side=None):
    """World matrix of a wall-local frame at along-wall u: +X = R, -Y = room, +Z up."""
    c_face, R, Out, sgn, _ = _face_frame(wall, side)
    o = Vector(_to_bl(_g(wall, "axis"), u, c_face, v))
    m = Matrix.Identity(4)
    m.col[0][:3] = R
    m.col[1][:3] = -Out
    m.col[2][:3] = Z
    m.col[3][:3] = o
    return m


HALL_WALLS = ("hall_n", "hall_s", "hall_w", "hall_e")


def _hall_faces():
    return [_wall_by_id(w) for w in HALL_WALLS] + lift_walls()


def _hall_loop():
    """Inner faces of the hall as a closed Blender-XY loop (clockwise, room on the right), with
    the lift shaft notched out of its corner."""
    h = P.HALL
    corners = [(h["minX"], h["minZ"]), (h["maxX"], h["minZ"]), (h["maxX"], h["maxZ"]), (h["minX"], h["maxZ"])]
    s = P.LIFT["shaft"]
    has_lift = bool(lift_walls())
    out = []
    for i, (cx, cz) in enumerate(corners):
        if has_lift and s["minX"] - 1e-6 <= cx <= s["maxX"] + 1e-6 and s["minZ"] - 1e-6 <= cz <= s["maxZ"] + 1e-6:
            px, pz = corners[i - 1]
            ox = s["minX"] if abs(cx - s["maxX"]) < 1e-6 else s["maxX"]
            oz = s["minZ"] if abs(cz - s["maxZ"]) < 1e-6 else s["maxZ"]
            if abs(pz - cz) < 1e-6:
                out += [(ox, cz), (ox, oz), (cx, oz)]
            else:
                out += [(cx, oz), (ox, oz), (ox, cz)]
        else:
            out.append((cx, cz))
    return [(x, -z) for x, z in out]


def _loop_corner_kinds(loop):
    """'int' (right turn: internal corner of the room) or 'ext' per loop vertex."""
    n = len(loop)
    out = []
    for i in range(n):
        a, b, c = _v2(loop[i - 1]), _v2(loop[i]), _v2(loop[(i + 1) % n])
        t0, t1 = (b - a).normalized(), (c - b).normalized()
        out.append("ext" if t0.x * t1.y - t0.y * t1.x > 0 else "int")
    return out


def _segments(loop):
    out = []
    n = len(loop)
    for i in range(n):
        a, b = Vector(loop[i]), Vector(loop[(i + 1) % n])
        t = (b - a).normalized()
        out.append((a, b, t, Vector((t.y, -t.x)), (b - a).length))
    return out


def _seg_pt(seg, s, d, z):
    a, b, t, n, L = seg
    p = a + t * s + n * d
    return Vector((p.x, p.y, z))


def _wall_for_segment(seg):
    a, b, t, n, L = seg
    mid = (a + b) / 2
    for w in _hall_faces():
        c_face = _face_frame(w)[0]
        bd = _g(w, "bounds")
        if _g(w, "axis") == "x" and abs(t.y) < 1e-6 and abs(-mid.y - c_face) < 1e-4 and bd["minX"] - 1e-4 <= mid.x <= bd["maxX"] + 1e-4:
            return w
        if _g(w, "axis") == "z" and abs(t.x) < 1e-6 and abs(mid.x - c_face) < 1e-4 and bd["minZ"] - 1e-4 <= -mid.y <= bd["maxZ"] + 1e-4:
            return w
    return None


def _u_on(wall, x, z):
    return x if _g(wall, "axis") == "x" else z


def _opening_conflicts(wall, u0, u1, z0, z1):
    """Openings (plus their surround allowance) on `wall` overlapping [u0, u1] x [z0, z1]."""
    out = []
    for o in _g(wall, "openings") or []:
        at, w = _g(o, "at"), _g(o, "width")
        k = _g(o, "kind")
        margin = (LIFT_DOOR_SURROUND - w / 2) if k == "elevator" else (0.30 if k in ("window_arched", "oculus", "window_tall") else 0.12)
        oy1 = _g(o, "y1") + (0.4 if k == "elevator" else 0.3)
        if at - w / 2 - margin < u1 and at + w / 2 + margin > u0 and _g(o, "y0") - 0.3 < z1 and oy1 > z0:
            out.append(_g(o, "id"))
    return out


_LAYOUT_CACHE = {}


def hall_pilaster_positions():
    if "pos" not in _LAYOUT_CACHE:
        _LAYOUT_CACHE["pos"] = _hall_pilaster_positions()
    return list(_LAYOUT_CACHE["pos"])


def _hall_pilaster_positions():
    """[(name, kind, wall_id, u)] for the hall's giant order (u = along-wall web coordinate):
    N and S walls on HALL_PIERS, W wall on the gallery column axes, two framing the rotunda
    arch, folded pilasters in every internal corner and round the lift shaft's free corner
    (unless a leg would run into an opening or the lift door surround)."""
    hb = P.HALL
    out = []
    for wid, tag in (("hall_n", "N"), ("hall_s", "S")):
        piers = [x for x in P.HALL_PIERS if hb["minX"] < x < hb["maxX"]]
        for i, x in enumerate(piers):
            out.append((f"Architecture_Pilaster_{tag}_{i + 1:02d}", "full", wid, x))
    rw = next(r for r in P.GALLERY["railings"] if r["id"] == "railing_w")
    zs = sorted({z for x, z in P.GALLERY["columns"] if abs(x - rw["a"][0]) < 1e-6 and rw["a"][1] + 0.1 < z < rw["b"][1] - 0.1})
    for i, z in enumerate(zs):
        out.append((f"Architecture_Pilaster_W_{i + 1:02d}", "full", "hall_w", z))
    # The east axis: the rotunda arch, or the tall window that replaces it in the hall-only plan.
    arch = next(o for o in _wall_by_id("hall_e").openings if o.id in ("arch_rotunda", "window_hall_e"))
    for i, z in enumerate((arch.at - EAST_FRAME_OFFSET, arch.at + EAST_FRAME_OFFSET)):
        out.append((f"Architecture_Pilaster_E_{i + 1:02d}", "full", "hall_e", z))
    loop = _hall_loop()
    kinds = _loop_corner_kinds(loop)
    segs = _segments(loop)
    n = len(loop)
    names = {"int": 0, "ext": 0}
    for i in range(n):
        w_in, w_out = _wall_for_segment(segs[i - 1]), _wall_for_segment(segs[i])
        if w_in is None or w_out is None:
            continue
        x, y = loop[i]
        zw = -y
        kind = "corner" if kinds[i] == "int" else "external"
        leg = (PIL_W / 2 if kind == "corner" else EXT_LEG) + BASE_PROJ
        # legs run from the corner along each face, into the room direction of travel
        t_in, t_out = segs[i - 1][2], segs[i][2]
        z0, z1 = PIL_Z0, PIL_Z0 + PIL_H
        clash = []
        for w, tdir in ((w_out, t_out), (w_in, -t_in)):
            ua = _u_on(w, x, zw)
            ub = _u_on(w, x + tdir.x * leg, -(y + tdir.y * leg))
            clash += _opening_conflicts(w, min(ua, ub), max(ua, ub), z0, z1)
        tag = {(True, True): "NW", (False, True): "NE", (False, False): "SE", (True, False): "SW"}
        side_tag = tag[(x < (hb["minX"] + hb["maxX"]) / 2, zw < (hb["minZ"] + hb["maxZ"]) / 2)]
        nm = f"Architecture_Pilaster_Corner_{side_tag}" if not _g(w_in, "id").startswith("lift") and not _g(w_out, "id").startswith("lift") \
            else f"Architecture_Pilaster_Lift_{'Corner' if kind == 'external' else 'Junction'}_{names[kinds[i]] + 1:02d}"
        if clash:
            print(f"[arch_shell] no {kind} pilaster at web ({x:.2f}, {zw:.2f}): legs would run into {sorted(set(clash))}")
            continue
        names[kinds[i]] += 1
        out.append((nm, kind, _g(w_out, "id"), _u_on(w_out, x, zw)))
    return out


def _pilaster_footprint(kind, wall, u):
    """World plan polygon (Blender XY) of a pilaster's base footprint, closed along the wall(s)."""
    outline = _pilaster_outline(kind)
    ring = _offset_path(outline, BASE_PROJ) + _pilaster_back(kind)
    M = _face_matrix(wall, u, PIL_Z0)
    return [(M @ Vector((p.x, p.y, 0.0))).to_2d() for p in ring]


def pilaster_spans():
    if "spans" not in _LAYOUT_CACHE:
        _LAYOUT_CACHE["spans"] = _pilaster_spans()
    return {k: list(v) for k, v in _LAYOUT_CACHE["spans"].items()}


def _pilaster_spans():
    """Along-wall footprints of the pilasters, base included, on every face they touch:
    {wall_id: [(u_min, u_max, z_min, projection)]}. Bookcase builders split their runs on these
    (see split_bookcase_runs)."""
    out = {}
    faces = _hall_faces()
    band = 0.05
    for nm, kind, wid, u in hall_pilaster_positions():
        poly = _pilaster_footprint(kind, _wall_by_id(wid), u)
        m = len(poly)
        for w in faces:
            c_face = _face_frame(w)[0]
            axis = _g(w, "axis")
            pc = (lambda p: -p.y) if axis == "x" else (lambda p: p.x)
            pu = (lambda p: p.x) if axis == "x" else (lambda p: -p.y)
            touching = False
            us = []
            for k in range(m):
                a, b = poly[k], poly[(k + 1) % m]
                da, db = pc(a) - c_face, pc(b) - c_face
                if abs(da) < 1e-3 and abs(db) < 1e-3 and (a - b).length > 0.05:
                    touching = True
                # clip the edge to the band |pc - c_face| <= band
                if abs(db - da) < 1e-9:
                    ts = [0.0, 1.0] if abs(da) <= band else []
                else:
                    t0, t1 = sorted(((-band - da) / (db - da), (band - da) / (db - da)))
                    t0, t1 = max(0.0, t0), min(1.0, t1)
                    ts = [t0, t1] if t0 <= t1 else []
                for t in ts:
                    us.append(pu(a + (b - a) * t))
            if not touching or not us:
                continue
            bd = _g(w, "bounds")
            lo_, hi_ = (bd["minX"], bd["maxX"]) if axis == "x" else (bd["minZ"], bd["maxZ"])
            a_, b_ = max(min(us), lo_), min(max(us), hi_)
            if b_ - a_ > 0.05:
                out.setdefault(_g(w, "id"), []).append((round(a_, 4), round(b_, 4), PIL_Z0, PIL_P + BASE_PROJ))
    for v in out.values():
        v.sort()
    return out


def split_bookcase_runs(runs=None, clearance=0.06, min_len=0.45):
    """plan.BOOKCASES runs with every run that stands against a pilaster split around it (the
    pilaster base plus `clearance` each side, for the cases' returned plinth and cornice), so the
    giant order stands full height from the gallery floor with bookcase bays between the piers
    (Ref 1). Pieces shorter than `min_len` are dropped. Other runs are returned unchanged.
    bookcases.py can build from `arch_shell.split_bookcase_runs(plan.BOOKCASES)`."""
    runs = P.BOOKCASES if runs is None else runs
    spans = pilaster_spans()
    out = []
    for bc in runs:
        (ax, az), (bx, bz) = bc["a"], bc["b"]
        y0, y1 = bc.get("y", 0.0), bc.get("y", 0.0) + bc["height"]
        host = None
        for w in _hall_faces():
            c_face = _face_frame(w)[0]
            if _g(w, "axis") == "x" and abs(az - c_face) < 1e-3 and abs(bz - c_face) < 1e-3:
                host, ua, ub = w, ax, bx
            elif _g(w, "axis") == "z" and abs(ax - c_face) < 1e-3 and abs(bx - c_face) < 1e-3:
                host, ua, ub = w, az, bz
        if host is None or y1 <= PIL_Z0 + 0.01 or y0 >= PIL_Z0 + PIL_H:
            out.append(bc)
            continue
        lo_, hi_ = min(ua, ub), max(ua, ub)
        pieces = [(lo_, hi_)]
        for s0, s1, _, _ in spans.get(_g(host, "id"), []):
            c0, c1 = s0 - clearance, s1 + clearance
            nxt = []
            for p0, p1 in pieces:
                if c1 <= p0 or c0 >= p1:
                    nxt.append((p0, p1))
                    continue
                if c0 > p0:
                    nxt.append((p0, c0))
                if c1 < p1:
                    nxt.append((c1, p1))
            pieces = nxt
        pieces = [(p0, p1) for p0, p1 in pieces if p1 - p0 >= min_len]
        if len(pieces) == 1 and abs(pieces[0][0] - lo_) < 1e-6 and abs(pieces[0][1] - hi_) < 1e-6:
            out.append(bc)
            continue
        fwd = ub >= ua
        for k, (p0, p1) in enumerate(pieces if fwd else list(reversed(pieces))):
            a_u, b_u = (p0, p1) if fwd else (p1, p0)
            spec = dict(bc)
            spec["id"] = f"{bc['id']}_{k + 1}"
            if _g(host, "axis") == "x":
                spec["a"], spec["b"] = (round(a_u, 4), az), (round(b_u, 4), bz)
            else:
                spec["a"], spec["b"] = (ax, round(a_u, 4)), (bx, round(b_u, 4))
            out.append(spec)
    return out


def build_hall_pilasters(col=None):
    """The giant order in ARCHITECTURE/Columns: linked duplicates of one mesh per kind."""
    col = col or _sub(COL_COLUMNS)
    src = {}
    objs = []
    for nm, kind, wid, u in hall_pilaster_positions():
        m = _face_matrix(_wall_by_id(wid), u, PIL_Z0)
        if kind not in src:
            ob = build_pilaster(kind, nm, col)
            src[kind] = ob
        else:
            ob = bpy.data.objects.new(nm, src[kind].data)
            C.link(ob, col)
        ob.matrix_world = m
        objs.append(ob)
    return objs


# ---------------------------------------------------------------------------
# Entablature
# ---------------------------------------------------------------------------

def _architrave_profile():
    return _prof(
        [(0.0, 11.60), (0.13, 11.60), (0.13, 11.672)],
        _arc(0.13, 11.684, 0.012, -90, 0, 3)[1:],
        [(0.145, 11.686), (0.145, 11.762)],
        _arc(0.145, 11.769, 0.007, -90, 90, 4)[1:],
        [(0.16, 11.778), (0.16, 11.818)],
        _cyma_reversa((0.16, 11.818), (0.198, 11.856), 6)[1:],
        [(0.202, 11.858), (0.202, FRIEZE_Z0), (FRIEZE_D, FRIEZE_Z0)],
        r=0.002,
    )


def _cornice_profile():
    return _prof(
        [(FRIEZE_D, FRIEZE_Z1)],
        _cyma_reversa((FRIEZE_D, FRIEZE_Z1), (0.186, 12.196), 5)[1:],
        [(DENT_D0, 12.198), (DENT_D0, DENT_Z1), (OVOLO_D, DENT_Z1), (OVOLO_D, OVOLO_Z - OVOLO_R)],
        _arc(OVOLO_D, OVOLO_Z, OVOLO_R, -90, 0, 8)[1:],
        [(MOD_D0, OVOLO_Z + 0.002), (MOD_D0, MOD_Z1), (0.632, MOD_Z1), (0.638, MOD_Z1 + 0.004)],
        [(0.645, 12.478), (0.645, 12.528), (0.652, 12.53), (0.652, 12.535)],
        _cyma_recta((0.652, 12.535), (0.695, 12.588), 7)[1:],
        [(CORONA_PROJ, 12.59), (CORONA_PROJ, P.HALL_CEILING), (0.0, P.HALL_CEILING)],
        r=0.002,
    )


def _sweep_into(mb, mi, path, profile, to3d, want, closed=False, uv_size=1.0, cap0=False, cap1=False):
    """Sweeps into a scratch builder and appends the faces to `mb`, flipped as a whole if their
    area-weighted normal points against `want` (for sweeps whose mapping mirrors the profile)."""
    sub = _MB()
    _sweep(sub, path, profile, to3d, closed=closed, mat=0, uv_size=uv_size, cap0=cap0, cap1=cap1)
    tot = 0.0
    for f in sub.faces:
        tot += _newell([sub.co[i] for i in f]).dot(want)
    flip = tot < 0
    mb.new_part()
    for f, uv in zip(sub.faces, sub.uvs):
        pts = [sub.co[i] for i in f]
        if flip:
            pts, uv = pts[::-1], uv[::-1]
        mb.face(pts, uv, mi)


def _block(mb, mi, seg, s0, s1, d0, d1, z0, z1, sz, top=True, chamfer=0.0, back=False):
    """Axis box in a segment frame (s along, d out, z up), back face omitted unless `back`.
    `chamfer` bevels the front's side and bottom arrises (the top meets the moulding above when
    top=False)."""
    mb.new_part()
    P_ = lambda s, d, z: _seg_pt(seg, s, d, z)
    t3, n3 = seg[2].to_3d(), seg[3].to_3d()
    c = chamfer
    dc = d1 - c
    zt = z1 - (c if top else 0.0)
    faces = [
        ([P_(s0 + c, d1, z0 + c), P_(s1 - c, d1, z0 + c), P_(s1 - c, d1, zt), P_(s0 + c, d1, zt)], n3),
        ([P_(s0, d0, z0), P_(s1, d0, z0), P_(s1, dc, z0), P_(s0, dc, z0)], -Z),
        ([P_(s0, d0, z0), P_(s0, dc, z0), P_(s0, dc, z1), P_(s0, d0, z1)], -t3),
        ([P_(s1, d0, z0), P_(s1, dc, z0), P_(s1, dc, z1), P_(s1, d0, z1)], t3),
    ]
    if c > 0:
        faces += [
            ([P_(s0, dc, z0), P_(s1, dc, z0), P_(s1 - c, d1, z0 + c), P_(s0 + c, d1, z0 + c)], (n3 - Z).normalized()),
            ([P_(s0, dc, z0), P_(s0 + c, d1, z0 + c), P_(s0 + c, d1, zt), P_(s0, dc, zt if top else z1)], (n3 - t3).normalized()),
            ([P_(s1, dc, z0), P_(s1 - c, d1, z0 + c), P_(s1 - c, d1, zt), P_(s1, dc, zt if top else z1)], (n3 + t3).normalized()),
        ]
    if top:
        faces.append(([P_(s0, d0, z1), P_(s1, d0, z1), P_(s1, dc, z1), P_(s0, dc, z1)], Z))
    if back:
        faces.append(([P_(s0, d0, z0), P_(s1, d0, z0), P_(s1, d0, z1), P_(s0, d0, z1)], -n3))
    for pts, want in faces:
        pts, _ = _orient([tuple(p) for p in pts], None, want)
        mb.pface([Vector(p) for p in pts], mi, sz, right=t3 if abs(want.z) < 0.5 else None)


def _ovolo_pt(seg, s, q, h):
    """Point on the cornice ovolo: s along, q arc length from its mid line (up), h off the surface."""
    th = math.radians(-45) + q / OVOLO_R
    return _seg_pt(seg, s, OVOLO_D + (OVOLO_R + h) * math.cos(th), OVOLO_Z + (OVOLO_R + h) * math.sin(th))


def _egg(mb, mi, seg, s, pitch, sz):
    """Egg set in a shell on the ovolo: a half-ellipsoid sunk into the surface, framed by a
    U-shaped raised rim open at the top."""
    a_s, a_q, e_h, sink = 0.29 * pitch, 0.032, 0.021, 0.006
    rings, nseg = 3, 6
    grid = []
    for i in range(rings + 1):
        th = (math.pi / 2) * i / rings
        ring = []
        for k in range(nseg):
            ph = math.tau * k / nseg
            dq = a_q * math.cos(th) * math.sin(ph) * (1.0 if math.sin(ph) > 0 else 0.86)
            ds = a_s * math.cos(th) * math.cos(ph)
            ring.append(_ovolo_pt(seg, s + ds, -0.002 + dq, -sink + (e_h + sink) * math.sin(th)))
        grid.append(ring)
    mb.new_part()
    base = _ovolo_pt(seg, s, -0.002, -0.03)
    tip = grid[-1][0]
    for i in range(rings):
        for k in range(nseg):
            k2 = (k + 1) % nseg
            f = [grid[i][k], grid[i][k2], tip] if i == rings - 1 else [grid[i][k], grid[i][k2], grid[i + 1][k2], grid[i + 1][k]]
            fc = sum(f, Vector()) / len(f)
            pts, _ = _orient([tuple(p) for p in f], None, fc - base)
            mb.pface([Vector(p) for p in pts], mi, sz)
    # shell rim
    rs, rq = a_s + 0.0085, a_q + 0.006
    path = [(s + rs * math.cos(math.radians(a)), -0.002 + rq * math.sin(math.radians(a))) for a in (148, 200, 245, 295, 340, 392)]
    prof = [(-0.0055, -0.003), (-0.003, 0.0045), (0.003, 0.0045), (0.0055, -0.003)]
    th_m = math.radians(-45)
    want = Vector((seg[3].x * math.cos(th_m), seg[3].y * math.cos(th_m), math.sin(th_m)))
    _sweep_into(mb, mi, path, prof, lambda p, h: _ovolo_pt(seg, p[0], p[1], h), want, uv_size=sz)


def _dart(mb, mi, seg, s, sz):
    """Arrow-head dart between two shells, a ridge down its middle."""
    T = _ovolo_pt(seg, s, -0.040, 0.0)
    L_ = _ovolo_pt(seg, s - 0.0075, -0.016, 0.0)
    R_ = _ovolo_pt(seg, s + 0.0075, -0.016, 0.0)
    U = _ovolo_pt(seg, s, 0.03, -0.002)
    M = _ovolo_pt(seg, s, -0.014, 0.009)
    mb.new_part()
    base = _ovolo_pt(seg, s, -0.01, -0.03)
    for f in ([T, R_, M], [T, M, L_], [L_, M, U], [M, R_, U]):
        fc = sum(f, Vector()) / 3
        pts, _ = _orient([tuple(p) for p in f], None, fc - base)
        mb.pface([Vector(p) for p in pts], mi, sz)


def _modillion(mb, mi, seg, s, sz):
    """Scroll console under the corona: a large roll against the band, an S-curved underside and
    a small front roll; an acanthus leaf runs along the underside and curls down at the front,
    scroll bosses on both flanks."""
    a, b, t, n, L = seg
    zt = MOD_Z1
    rb = 0.046
    cb = (MOD_D0 + rb, MOD_Z0 + rb)
    rf = 0.022
    cf = (MOD_D1 - rf, zt - rf)
    a0 = math.radians(300)
    p0 = (cb[0] + rb * math.cos(a0), cb[1] + rb * math.sin(a0))
    p3 = (cf[0], cf[1] - rf)
    under = _bez(p0, (p0[0] + 0.06 * 0.866, p0[1] + 0.06 * 0.5), (p3[0] - 0.07, p3[1]), p3, 8)
    side = _prof(
        [(MOD_D0, zt), (MOD_D0, cb[1])],
        _arc(cb[0], cb[1], rb, 180, 300, 5)[1:],
        under[1:],
        _arc(cf[0], cf[1], rf, 270, 450, 8)[1:],
        r=0.0,
    )
    if abs(side[-1][1] - zt) < 1e-6 and abs(side[-1][0] - cf[0]) < 1e-6:
        pass
    hw = MOD_W / 2
    mb.new_part()
    ring_l = [_seg_pt(seg, s - hw, d, z) for d, z in side]
    ring_r = [_seg_pt(seg, s + hw, d, z) for d, z in side]
    m = len(side)
    t3, n3 = t.to_3d(), n.to_3d()
    for j in range(1, m - 1):          # j = 0 is the back (against the band); the top closes on the soffit
        dd, dz = side[j + 1][0] - side[j][0], side[j + 1][1] - side[j][1]
        want = n3 * dz - Z * dd
        f = [ring_l[j], ring_l[j + 1], ring_r[j + 1], ring_r[j]]
        pts, _ = _orient([tuple(p) for p in f], None, want)
        mb.pface([Vector(p) for p in pts], mi, sz, right=t3)
    for ring, sgn in ((ring_l, -1), (ring_r, 1)):
        pts, _ = _orient([tuple(p) for p in ring], None, t3 * sgn)
        mb.pface([Vector(p) for p in pts], mi, sz, right=n3)
    for sgn in (-1, 1):
        _dome(mb, CARVED, _seg_pt(seg, s + sgn * hw, cb[0], cb[1]), t3 * sgn, n3, 0.033, 0.007, seg=8, rings=1)
        _dome(mb, CARVED, _seg_pt(seg, s + sgn * hw, cf[0], cf[1]), t3 * sgn, n3, 0.015, 0.005, seg=6, rings=1)
    # leaf along the underside (leaf z = arc length from the back roll, f = off the surface)
    upts = [Vector(p) for p in under]
    acc = [0.0]
    for p, q in zip(upts, upts[1:]):
        acc.append(acc[-1] + (q - p).length)

    def F(x, f, z):
        if z <= 0:
            i, u = 0, z / max(1e-9, acc[1])
        elif z >= acc[-1]:
            i, u = len(upts) - 2, 1.0 + (z - acc[-1]) / max(1e-9, acc[-1] - acc[-2])
        else:
            i = max(k for k in range(len(acc) - 1) if acc[k] <= z)
            u = (z - acc[i]) / max(1e-9, acc[i + 1] - acc[i])
        p, q = upts[i], upts[i + 1]
        tg = (q - p).normalized()
        c = p + (q - p) * u
        o = Vector((tg.y, -tg.x))
        return _seg_pt(seg, s + x, c.x + o.x * f, c.y + o.y * f)

    _acanthus(mb, CARVED, F, 0.086, acc[-1] * 0.95, kind="micro", lean=0.004, curl=0.16, phi_deg=150, thick=0.006,
              sink=0.003, billow=0.6, uv_right=t3)


def _coffer(mb, mi, seg, s0, s1, d0, d1, sz, rosette=True):
    """Sunk soffit panel between modillions: a bead frame and a rosette."""
    path = [(s0, d0), (s1, d0), (s1, d1), (s0, d1)]
    prof = [(0.003, -0.002), (0.0, 0.009), (-0.009, 0.011), (-0.015, 0.0)]
    _sweep_into(mb, mi, path, prof, lambda p, h: _seg_pt(seg, p[0], p[1], MOD_Z1 - h), -Z, closed=True, uv_size=sz)
    if rosette:
        R = 0.36 * min(s1 - s0, d1 - d0)
        c = _seg_pt(seg, (s0 + s1) / 2, (d0 + d1) / 2, MOD_Z1)
        _flower(mb, CARVED, c, -Z, seg[2].to_3d(), R, petals=6, inner=0, height=0.32 * R, res=0, button_seg=8)


def _anchors_on_segment(seg):
    """Along-segment positions of full pilaster axes on this segment's wall."""
    w = _wall_for_segment(seg)
    a, b, t, n, L = seg
    out = []
    if w is None:
        return out
    for nm, kind, wid, u in hall_pilaster_positions():
        if kind != "full" or wid != _g(w, "id"):
            continue
        p = Vector(_to_bl(_g(w, "axis"), u, _face_frame(w)[0], 0))
        out.append((p.to_2d() - a).dot(t))
    return sorted(out)


def _enrich_segment(mb, seg, k0, k1, egg_and_dart=True):
    """Dentils, egg-and-dart, modillions and soffit coffers along one wall of the entablature,
    resolved at internal corners (corner block, clear soffit) and external ones (corner dentil,
    a modillion each side of the angle and a corner coffer)."""
    stone = mb.mi(CARVED)
    sz = LM.tex_size(CARVED)
    a, b, t, n, L = seg
    ext0, ext1 = k0 == "ext", k1 == "ext"
    anchors = _anchors_on_segment(seg)
    cm = MOD_D0 - MOD_W / 2
    clear_int = SOFFIT_D1 + 0.04 + MOD_W / 2
    lo_m = -cm if ext0 else clear_int
    hi_m = L + cm if ext1 else L - clear_int
    if ext1:
        base = L + cm
    elif ext0:
        base = -cm
    elif anchors:
        base = anchors[0]
    else:
        base = L / 2
    if ext0 or ext1:
        span = hi_m - lo_m
        pitch = span / max(1, round(span / MODILLION_PITCH))
    elif len(anchors) >= 2:
        gap = anchors[1] - anchors[0]
        pitch = gap / max(1, round(gap / MODILLION_PITCH))
    else:
        pitch = MODILLION_PITCH
    kmin = math.floor((lo_m - base) / pitch) - 1
    kmax = math.ceil((hi_m - base) / pitch) + 1
    mods = [base + k * pitch for k in range(kmin, kmax + 1) if lo_m - 1e-6 <= base + k * pitch <= hi_m + 1e-6]
    pd = pitch / 4
    wd = DENT_FRAC * pd
    gd = pd - wd
    # Dentils (+ corner blocks).
    if not ext0:
        _block(mb, stone, seg, DENT_D0, DENT_D1, DENT_D0, DENT_D1, DENT_Z0, DENT_Z1, sz, top=False, chamfer=0.004)
    if ext1:
        _block(mb, stone, seg, L + DENT_D0, L + DENT_D1, DENT_D0, DENT_D1, DENT_Z0, DENT_Z1, sz, top=False, chamfer=0.004, back=True)
    lo_d = (-DENT_D0 if ext0 else DENT_D1) + gd + wd / 2
    hi_d = (L + DENT_D0 if ext1 else L - DENT_D1) - gd - wd / 2
    kmin = math.floor((lo_d - base) / pd) - 1
    kmax = math.ceil((hi_d - base) / pd) + 1
    dents = [base + k * pd for k in range(kmin, kmax + 1) if lo_d - 1e-6 <= base + k * pd <= hi_d + 1e-6]
    for s in dents:
        _block(mb, stone, seg, s - wd / 2, s + wd / 2, DENT_D0, DENT_D1, DENT_Z0, DENT_Z1, sz, top=False, chamfer=0.004)
    # Egg-and-dart: an egg over every dentil, a dart between.
    if egg_and_dart:
        lo_e = -0.24 if ext0 else 0.37
        hi_e = L + 0.24 if ext1 else L - 0.37
        k0e = math.floor((lo_e - base) / pd) - 1
        k1e = math.ceil((hi_e - base) / pd) + 1
        eggs = [base + k * pd for k in range(k0e, k1e + 1) if lo_e - 1e-6 <= base + k * pd <= hi_e + 1e-6]
        for i, s in enumerate(eggs):
            _egg(mb, stone, seg, s, pd, sz)
            if i + 1 < len(eggs) and abs(eggs[i + 1] - s - pd) < 1e-4:
                _dart(mb, stone, seg, s + pd / 2, sz)
    # Modillions and the coffers between them.
    for s in mods:
        _modillion(mb, stone, seg, s, sz)
    cd0, cd1 = MOD_D0 + 0.012, SOFFIT_D1 - 0.03
    for s0, s1 in zip(mods, mods[1:]):
        _coffer(mb, stone, seg, s0 + MOD_W / 2 + 0.012, s1 - MOD_W / 2 - 0.012, cd0, cd1, sz)
    if ext1:
        _coffer(mb, stone, seg, L + cd0, L + cd1, cd0, cd1, sz)


def build_hall_cornice(col=None, egg_and_dart=True, top=P.HALL_CEILING):
    """Entablature around the whole hall at HALL_CORNICE..top (default HALL_CEILING), mitred at
    every corner and wrapped round the lift shaft (external mitre at its free corner), with
    dentils, egg-and-dart, modillions over the pilaster axes, and a coffered corona soffit with
    rosettes; plus the west inscription. A lower `top` (e.g. 12.2, under a ceiling cove)
    compresses the whole order proportionally (heights by k, projections by (1 + k) / 2)."""
    col = col or _sub(COL_WALLS)
    loop = _hall_loop()
    kinds = _loop_corner_kinds(loop)
    segs = _segments(loop)
    to3 = _plan3d()
    mb = _MB()
    stone = mb.mi(CARVED)
    sz = LM.tex_size(CARVED)
    _sweep(mb, loop, _architrave_profile(), to3, closed=True, mat=stone, uv_size=sz)
    _sweep(mb, loop, _cornice_profile(), to3, closed=True, mat=stone, uv_size=sz)
    # Frieze: ornament band, U every FRIEZE_REPEAT, V across the band; the inscription tablet
    # interrupts it on the west wall.
    band = mb.mi("ornament_band")
    fr = _offset_path(loop, FRIEZE_D, True)
    tablet = _tablet_span()
    s_acc = 0.0
    for i, seg in enumerate(segs):
        p0, p1 = fr[i], fr[(i + 1) % len(fr)]
        L = (p1 - p0).length
        tdir = (p1 - p0).normalized()
        cuts = [0.0, L]
        if tablet and _wall_for_segment(seg) is _wall_by_id("hall_w"):
            sa, sb = tablet
            off = (p0 - seg[0]).dot(tdir)
            cuts = [0.0, sa - off, sb - off, L]
        for k in range(len(cuts) - 1):
            if k == 1 and len(cuts) == 4:
                continue
            ca, cb = cuts[k], cuts[k + 1]
            qa, qb = p0 + tdir * ca, p0 + tdir * cb
            pts = [Vector((qa.x, qa.y, FRIEZE_Z0)), Vector((qb.x, qb.y, FRIEZE_Z0)), Vector((qb.x, qb.y, FRIEZE_Z1)), Vector((qa.x, qa.y, FRIEZE_Z1))]
            u0, u1 = (s_acc + ca) / FRIEZE_REPEAT, (s_acc + cb) / FRIEZE_REPEAT
            mb.face([tuple(p) for p in pts], [(u0, 0), (u1, 0), (u1, 1), (u0, 1)], band)
        s_acc += L
    for i, seg in enumerate(segs):
        _enrich_segment(mb, seg, kinds[i], kinds[(i + 1) % len(segs)], egg_and_dart)
    ob = mb.build("Architecture_Cornice_Hall", col, sharp=35.0)
    objs = [ob]
    k = (top - P.HALL_CORNICE) / (P.HALL_CEILING - P.HALL_CORNICE)
    kd = (1 + k) / 2
    if abs(k - 1) > 1e-4:
        _squash_entablature(ob, k, kd)
    zf = lambda z: P.HALL_CORNICE + (z - P.HALL_CORNICE) * k
    insc = build_inscription(col, z0=zf(FRIEZE_Z0), z1=zf(FRIEZE_Z1), d=FRIEZE_D * kd)
    if insc:
        objs += insc
    return objs


def _squash_entablature(ob, k, kd):
    """Scales an entablature built for HALL_CORNICE..HALL_CEILING: heights about the cornice
    line by k, projections from each wall face of the loop by kd (mitres stay true)."""
    loop = _hall_loop()
    kinds = _loop_corner_kinds(loop)
    segs = _segments(loop)
    co = np.empty(len(ob.data.vertices) * 3)
    ob.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    co[:, 2] = P.HALL_CORNICE + (co[:, 2] - P.HALL_CORNICE) * k
    lim = CORONA_PROJ + 0.01
    xy = co[:, :2].copy()
    new = xy.copy()
    for i, (a, b, t, n, L) in enumerate(segs):
        ext0, ext1 = kinds[i] == "ext", kinds[(i + 1) % len(segs)] == "ext"
        rel = xy - np.array(a)
        s = rel @ np.array(t)
        d = rel @ np.array(n)
        m = (d >= -1e-6) & (d < lim) & (s >= (-lim if ext0 else 0.0) - 1e-6) & (s <= (L + lim if ext1 else L) + 1e-6)
        new[m] += np.outer(d[m] * (kd - 1), np.array(n))
    co[:, :2] = new
    ob.data.vertices.foreach_set("co", co.ravel())
    ob.data.update()


# ---------------------------------------------------------------------------
# Inscription on the west frieze
# ---------------------------------------------------------------------------

def _font():
    fdir = os.path.join(C.LIBRARY_ART, "fonts")
    cands = []
    if os.path.isdir(fdir):
        cands += [os.path.join(fdir, f) for f in sorted(os.listdir(fdir)) if f.lower().endswith((".ttf", ".otf"))]
    cands += FONT_CANDIDATES
    for pth in cands:
        if os.path.exists(pth):
            try:
                return bpy.data.fonts.load(pth, check_existing=True)
            except RuntimeError:
                continue
    return None


def _text_mesh(text, cap_h, depth, spacing=1.18):
    """Raised letters as a mesh in the XY plane (baseline y = 0, centred on x = 0, front +Z,
    back face omitted at z = 0)."""
    font = _font()
    cu = bpy.data.curves.new("InscriptionText", "FONT")
    cu.body = text
    if font:
        cu.font = font
    cu.size = 1.0
    cu.space_character = spacing
    cu.align_x = "CENTER"
    cu.align_y = "BOTTOM_BASELINE"
    cu.resolution_u = 3
    cu.extrude = depth / 2
    cu.bevel_depth = min(0.0012, depth * 0.3)
    cu.bevel_resolution = 0
    cu.fill_mode = "FRONT"
    tmp = bpy.data.objects.new("InscriptionTmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    zs = [v.co.y for v in me.vertices]
    h = max(zs) if zs else 1.0
    s = cap_h / h
    me.transform(Matrix.Diagonal((s, s, 1.0, 1.0)))
    zmin = min(v.co.z for v in me.vertices)
    me.transform(Matrix.Translation((0, 0, -zmin - 0.0008)))
    return me, (font.name if font else "builtin")


def _west_segment():
    return next(sg for sg in _segments(_hall_loop()) if _wall_for_segment(sg) is _wall_by_id("hall_w"))


def _tablet_span():
    """(s0, s1) along the west segment of the hall loop where the inscription tablet sits,
    centred on the lounge arch axis."""
    a, b, t, n, L = _west_segment()
    # Centred on the hall's cross axis (the lounge arch, when there is one).
    at = next((o.at for o in _wall_by_id("hall_w").openings if o.id == "arch_lounge"), -1.0)
    c = Vector((a.x, -at))
    sc = (c - a).dot(t)
    half = 2.95
    return (sc - half, sc + half)


def build_inscription(col=None, text=INSCRIPTION, z0=FRIEZE_Z0, z1=FRIEZE_Z1, d=FRIEZE_D):
    """Gilt raised serif letters on a dark tablet framed by a gilt bead, set in the west frieze
    (the frieze band z0..z1, its face d in front of the wall)."""
    col = col or _sub(COL_WALLS)
    seg = _west_segment()
    a, b, t, n, L = seg
    s0, s1 = _tablet_span()
    zc0, zc1 = z0 + 0.025, z1 - 0.025
    mb = _MB()
    ground = mb.mi("signage")
    gilt = mb.mi("gilt")
    d_face = d + 0.006
    P_ = lambda s, d, z: _seg_pt(seg, s, d, z)
    t3, n3 = t.to_3d(), n.to_3d()
    for pts, want in (
        ([P_(s0, d_face, zc0), P_(s1, d_face, zc0), P_(s1, d_face, zc1), P_(s0, d_face, zc1)], n3),
        ([P_(s0, d, zc0), P_(s1, d, zc0), P_(s1, d_face, zc0), P_(s0, d_face, zc0)], -Z),
        ([P_(s0, d, zc1), P_(s1, d, zc1), P_(s1, d_face, zc1), P_(s0, d_face, zc1)], Z),
        ([P_(s0, d, zc0), P_(s0, d_face, zc0), P_(s0, d_face, zc1), P_(s0, d, zc1)], -t3),
        ([P_(s1, d, zc0), P_(s1, d_face, zc0), P_(s1, d_face, zc1), P_(s1, d, zc1)], t3),
    ):
        pts, _ = _orient([tuple(p) for p in pts], None, want)
        mb.face(pts, [(Vector(p).dot(t3) / 1.0, p[2]) for p in pts], ground)
    # Ground behind the tablet where the ornament band is cut (frieze face), so no gap shows.
    for (za, zb) in ((z0, zc0), (zc1, z1)):
        pts, _ = _orient([tuple(P_(s0, d, za)), tuple(P_(s1, d, za)), tuple(P_(s1, d, zb)), tuple(P_(s0, d, zb))], None, n3)
        mb.face(pts, [(Vector(p).dot(t3), p[2]) for p in pts], ground)
    rect = [(s0 - 0.004, zc0 - 0.004), (s1 + 0.004, zc0 - 0.004), (s1 + 0.004, zc1 + 0.004), (s0 - 0.004, zc1 + 0.004)]
    bead = [(-0.004, -0.0005)] + [(0.009 * (1 - math.cos(math.radians(a_))) - 0.004, 0.009 * math.sin(math.radians(a_))) for a_ in range(30, 180, 30)] + [(0.014, -0.0005)]
    face3 = lambda p, h: _seg_pt(seg, p[0], d + h, p[1])
    _sweep(mb, rect, list(reversed(bead)), face3, closed=True, mat=gilt, uv_size=0.3)
    obj = mb.build("Architecture_Inscription_Tablet_HallW", col, sharp=40.0)
    me, fname = _text_mesh(text, cap_h=0.57 * (z1 - z0), depth=0.009)
    xs = [v.co.x for v in me.vertices]
    width = max(xs) - min(xs)
    sc = (s0 + s1) / 2
    zb = (zc0 + zc1) / 2 - 0.57 * (z1 - z0) / 2
    m = Matrix.Identity(4)
    m.col[0][:3] = t3
    m.col[1][:3] = Z
    m.col[2][:3] = n3
    m.col[3][:3] = _seg_pt(seg, sc, d_face, zb)
    me.transform(m)
    me.materials.append(LM.mat("gilt"))
    letters = bpy.data.objects.new("Architecture_Inscription_Letters_HallW", me)
    C.link(letters, col)
    C.uv_box(letters, 0.3)
    C.shade_smooth(letters, 40)
    letters["ovr_font"] = fname
    letters["ovr_text"] = text
    if width > s1 - s0 - 0.25:
        print(f"[arch_shell] WARNING inscription {width:.2f} m is wider than the tablet")
    return [obj, letters]


# ---------------------------------------------------------------------------
# East wall belt course
# ---------------------------------------------------------------------------

def _belt_profile():
    return _prof(
        [(0.0, BELT_Z0), (0.17, BELT_Z0)],
        _arc(0.17, BELT_Z0 + 0.03, 0.03, -90, 0, 4),
        [(0.205, BELT_Z0 + 0.035), (0.205, BELT_Z0 + 0.25), (0.215, BELT_Z0 + 0.255)],
        _cyma_recta((0.215, BELT_Z0 + 0.255), (0.30, BELT_Z1 - 0.018), 7),
        [(0.305, BELT_Z1 - 0.016), (0.305, BELT_Z1), (0.0, BELT_Z1)],
        r=0.002,
    )


def build_hall_belt(col=None):
    """Moulded belt course on the east wall at the gallery-floor line (the east pilasters stand
    on it); it dies into the gallery slabs and returns at the rotunda arch surround."""
    col = col or _sub(COL_WALLS)
    w = _wall_by_id("hall_e")
    c_face, R, Out, sgn, thick = _face_frame(w)
    arch = next((o for o in w.openings if o.id == "arch_rotunda"), None)
    runs = P.GALLERY["runs"]
    z_n = runs["north"]["maxZ"] + 0.16
    z_s = runs["south"]["minZ"] - 0.16
    pil_half = PIL_W / 2 + BASE_PROJ
    if arch is not None:
        stop_n = arch.at - EAST_FRAME_OFFSET + pil_half + 0.025
        stop_s = arch.at + EAST_FRAME_OFFSET - pil_half - 0.025
    prof = _belt_profile()
    mb = _MB()
    stone = mb.mi(CARVED)
    sz = LM.tex_size(CARVED)
    to3 = _plan3d()

    def pt(zweb):
        return Vector(_to_bl("z", zweb, c_face, 0)).to_2d()

    inward = -Out.to_2d()
    if arch is None:  # no arch to stop at (the hall-only plan has a window above): one unbroken run
        _sweep(mb, [pt(z_n), pt(z_s)], prof, to3, mat=stone, uv_size=sz, cap0=True, cap1=True)
        return mb.build("Architecture_BeltCourse_HallE", col, sharp=35.0)
    for (za, zb), ret_end in (((z_n, stop_n), True), ((stop_s, z_s), False)):
        A, B = pt(za), pt(zb)
        path = [A, B, B + inward * 0.02] if ret_end else [A + inward * 0.02, A, B]
        _sweep(mb, path, prof, to3, mat=stone, uv_size=sz, cap0=ret_end, cap1=not ret_end)
    return mb.build("Architecture_BeltCourse_HallE", col, sharp=35.0)


# ---------------------------------------------------------------------------
# Arch surrounds
# ---------------------------------------------------------------------------

def _arch_env(o, wall, side=None):
    """Space round an arched opening on a wall face: side = clearance from the jambs to the
    bookcases / pilasters beside them (sill to springing), head = the same beside the head,
    ztop = highest z a surround may reach (gallery soffit, openings above, cornice), flank =
    depth of the bookcase runs standing right beside BOTH jambs (None otherwise)."""
    c_face, R, Out, sgn, thick = _face_frame(wall, side)
    axis = _g(wall, "axis")
    at, w, y0, y1 = _g(o, "at"), _g(o, "width"), _g(o, "y0"), _g(o, "y1")
    spring = _g(o, "spring") if _g(o, "spring") is not None else y1
    u0, u1 = at - w / 2, at + w / 2
    room_side = (side or _inner_side(wall)) == _inner_side(wall)
    spans = pilaster_spans().get(_g(wall, "id"), []) if room_side else []

    def beside(za, zb):
        left = right = 9.0
        lc, rc = [], []
        for bc in P.BOOKCASES:
            (ax, az), (bx, bz) = bc["a"], bc["b"]
            if axis == "x":
                if not (abs(az - c_face) < 1e-3 and abs(bz - c_face) < 1e-3):
                    continue
                lo_, hi_ = sorted((ax, bx))
            else:
                if not (abs(ax - c_face) < 1e-3 and abs(bx - c_face) < 1e-3):
                    continue
                lo_, hi_ = sorted((az, bz))
            if bc["y"] >= zb or bc["y"] + bc["height"] <= za:
                continue
            if hi_ <= u0 + 1e-6:
                left = min(left, u0 - hi_)
                if u0 - hi_ < 0.3:
                    lc.append(bc)
            elif lo_ >= u1 - 1e-6:
                right = min(right, lo_ - u1)
                if lo_ - u1 < 0.3:
                    rc.append(bc)
        for a, b, zmin, _ in spans:
            if zb <= zmin:
                continue
            if za >= zmin + BASE_H:
                a, b = a + BASE_PROJ, b - BASE_PROJ
            if b <= u0 + 1e-6:
                left = min(left, u0 - b)
            elif a >= u1 - 1e-6:
                right = min(right, a - u1)
        # a portal only where the cases rise at least to the springing on both sides
        flank = max([bc["depth"] for bc in lc + rc]) if (lc and rc and min(bc["y"] + bc["height"] for bc in lc + rc) >= spring - 1e-6) else None
        return min(left, right), flank

    side_c, flank = beside(y0, spring)
    head_c, _ = beside(spring - 0.4, y1 + 1.0)
    ztop = 99.0
    for run in P.GALLERY["runs"].values():
        on_face = (axis == "x" and (abs(run["minZ"] - c_face) < 1e-3 or abs(run["maxZ"] - c_face) < 1e-3)) or \
                  (axis == "z" and (abs(run["minX"] - c_face) < 1e-3 or abs(run["maxX"] - c_face) < 1e-3))
        lo_, hi_ = (run["minX"], run["maxX"]) if axis == "x" else (run["minZ"], run["maxZ"])
        if on_face and lo_ <= u0 and hi_ >= u1 and P.GALLERY_UNDERSIDE > y1 - 1e-6:
            ztop = min(ztop, GALLERY_STONE_TOP)
    for o2 in _g(wall, "openings") or []:
        if o2 is o:
            continue
        a2, w2 = _g(o2, "at"), _g(o2, "width")
        if a2 + w2 / 2 + 0.3 > u0 and a2 - w2 / 2 - 0.3 < u1 and _g(o2, "y0") >= y1 - 1e-6:
            ztop = min(ztop, _g(o2, "y0") - 0.42)
    if _g(wall, "room") == "hall":
        ztop = min(ztop, P.HALL_CORNICE - 0.05)
    return dict(side=side_c, head=head_c, ztop=ztop, flank=flank, spring=spring)


def _casing_profile(b, H=None, proud=SURROUND_PROUD):
    """Two-fascia architrave with an ogee back band, width b, projection H (traced outer ->
    inner). Its inner edge stands `proud` into the opening and its tail steps back into the wall
    off the reveal plane, so it never shares a plane with the reveal."""
    H = H if H is not None else 0.70 * b
    k = H / (0.70 * b)
    e = -0.013
    return _prof(
        [(b, e), (b, 0.62 * b * k), (0.97 * b, 0.70 * b * k), (0.90 * b, 0.70 * b * k)],
        [(0.84 * b, 0.68 * b * k), (0.78 * b, 0.60 * b * k), (0.73 * b, 0.53 * b * k), (0.70 * b, 0.51 * b * k)],
        [(0.66 * b, 0.50 * b * k), (0.40 * b, 0.47 * b * k), (0.38 * b, 0.40 * b * k), (0.08 * b, 0.37 * b * k)],
        _arc(0.08 * b - proud * 0.5, 0.30 * b * k, 0.07 * b, 90, 180, 3)[1:],
        [(-proud, 0.25 * b * k), (-proud, 0.002), (0.008, e)],
        r=0.0015,
    )


def _impost_profile(h, proj):
    e = -0.006
    return _prof(
        [(e, 0.0), (0.25 * proj, 0.0), (0.25 * proj, 0.12 * h)],
        _arc(0.25 * proj, 0.12 * h + 0.75 * proj * 0.6, 0.75 * proj * 0.6, -90, 0, 4),
        [(0.70 * proj, 0.62 * h), (0.95 * proj, 0.66 * h), (proj, 0.70 * h), (proj, h), (e, h)],
        r=0.0015,
    )


def _outer_band_profile(b2, H):
    """Outer archivolt band (traced outer -> inner): cyma recta edge and a flat fascia."""
    e = -0.013
    return _prof(
        [(b2, e), (b2, 0.22 * H)],
        _cyma_recta((b2, 0.22 * H), (0.74 * b2, H), 6),
        [(0.70 * b2, H), (0.66 * b2, 0.93 * H), (0.0, 0.88 * H), (0.0, e)],
        r=0.0015,
    )


def _box_local(mb, mi, M, x0, x1, ly0, ly1, z0, z1, sz, skip=()):
    """Box in a face frame: x along the wall, ly = local y (negative toward the room), z up."""
    mb.new_part()
    Pp = lambda x, y, z: M @ Vector((x, y, z))
    R = (M.to_3x3() @ Vector((1, 0, 0))).normalized()
    Yl = (M.to_3x3() @ Vector((0, 1, 0))).normalized()
    faces = {
        "front": ([Pp(x0, ly0, z0), Pp(x1, ly0, z0), Pp(x1, ly0, z1), Pp(x0, ly0, z1)], -Yl),
        "back": ([Pp(x0, ly1, z0), Pp(x1, ly1, z0), Pp(x1, ly1, z1), Pp(x0, ly1, z1)], Yl),
        "top": ([Pp(x0, ly0, z1), Pp(x1, ly0, z1), Pp(x1, ly1, z1), Pp(x0, ly1, z1)], Z),
        "bottom": ([Pp(x0, ly0, z0), Pp(x1, ly0, z0), Pp(x1, ly1, z0), Pp(x0, ly1, z0)], -Z),
        "left": ([Pp(x0, ly0, z0), Pp(x0, ly1, z0), Pp(x0, ly1, z1), Pp(x0, ly0, z1)], -R),
        "right": ([Pp(x1, ly0, z0), Pp(x1, ly1, z0), Pp(x1, ly1, z1), Pp(x1, ly0, z1)], R),
    }
    for k, (pts, want) in faces.items():
        if k in skip:
            continue
        pts, _ = _orient([tuple(p) for p in pts], None, want)
        mb.pface([Vector(p) for p in pts], mi, sz, right=R if abs(want.z) < 0.5 else None)


def _keystone(mb, M, y_plane, z_bot, z_top, w_bot, w_top, p_bot, p_top, sz, cap_h=0.05, leaf=True):
    """Keystone at an arch crown, standing on the plane local y = -y_plane: wedge sides widening
    from w_bot (z_bot, it may hang below the intrados) to w_top, a front that sweeps forward from
    p_bot to p_top into a scroll console, a capping moulding of height cap_h, scroll bosses on
    the flanks and an acanthus leaf on the front."""
    stone = mb.mi(CARVED)
    z_c = z_top - cap_h
    nz = 14
    width = lambda z: w_bot + (w_top - w_bot) * (z - z_bot) / max(1e-6, z_top - z_bot)

    def proj(z):
        u = max(0.0, min(1.0, (z - z_bot) / max(1e-6, z_c - z_bot)))
        roll = 0.35 * (p_top - p_bot) * math.sin(math.pi * min(1.0, max(0.0, (u - 0.72) / 0.28)))
        return p_bot + (p_top - p_bot) * u ** 2.0 + roll * (1 if u > 0.72 else 0)

    Pp = lambda x, d, z: M @ Vector((x, -(y_plane + d), z))
    zs = [z_bot + (z_c - z_bot) * i / nz for i in range(nz + 1)]
    rings = [(Pp(-width(z) / 2, 0.0, z), Pp(-width(z) / 2, proj(z), z), Pp(width(z) / 2, proj(z), z), Pp(width(z) / 2, 0.0, z)) for z in zs]
    mb.new_part()
    Rr = (M.to_3x3() @ Vector((1, 0, 0))).normalized()
    Yo = (M.to_3x3() @ Vector((0, -1, 0))).normalized()
    centre = lambda z: Pp(0.0, proj(z) * 0.5, z)
    for i in range(nz):
        a, b_ = rings[i], rings[i + 1]
        for f in ([a[1], a[2], b_[2], b_[1]], [a[0], a[1], b_[1], b_[0]], [a[2], a[3], b_[3], b_[2]], [a[3], a[0], b_[0], b_[3]]):
            fc = sum(f, Vector()) / 4
            zc = (zs[i] + zs[i + 1]) / 2
            pts, _ = _orient([tuple(p) for p in f], None, fc - centre(zc))
            mb.pface([Vector(p) for p in pts], stone, sz, right=Rr)
    pts, _ = _orient([tuple(p) for p in rings[0]], None, -Z)
    mb.pface([Vector(p) for p in pts], stone, sz)
    # capping moulding wrapped round the top
    xc = width(z_c) / 2
    pt = proj(z_c)
    plan3 = lambda p, h: M @ Vector((p[0], p[1], h))
    path = [(-xc, -y_plane), (-xc, -(y_plane + pt)), (xc, -(y_plane + pt)), (xc, -y_plane)]
    cp = _prof([(-0.004, z_c), (0.008, z_c), (0.008, z_c + 0.18 * cap_h)],
               _cyma_reversa((0.008, z_c + 0.18 * cap_h), (0.026, z_c + 0.6 * cap_h), 4)[1:],
               [(0.03, z_c + 0.62 * cap_h), (0.03, z_top), (0.0, z_top)], r=0.0012)
    mb.new_part()
    rings2 = _sweep(mb, path, cp, plan3, mat=stone, uv_size=sz)
    _cap(mb, rings2[-1], cp[-1][1], plan3, True, stone, sz)
    mb.new_part()
    _cap(mb, rings2[0], cp[0][1], plan3, False, stone, sz)
    for xs in (1, -1):
        zb = z_c - 0.32 * (z_c - z_bot)
        rr = max(0.018, min(0.06, 0.42 * proj(zb)))
        _dome(mb, CARVED, Pp(xs * width(zb) / 2, proj(zb) * 0.55, zb), Rr * xs, Yo, rr, 0.008, seg=12, rings=2)
    if leaf:
        hl = (z_c - z_bot) * 0.8
        wl = 0.72 * width(z_bot + hl * 0.5)
        z0l = z_bot + 0.03 * (z_c - z_bot)
        _acanthus(mb, CARVED, lambda x, f, z: Pp(x, proj(z0l + z) + f, z0l + z), wl, hl, kind="small",
                  lean=0.01, curl=0.17, thick=0.008, sink=0.004, uv_right=Rr)


def _roundel(mb, mi, M, xc, zc, rr, sz, y_plane=0.0):
    """Spandrel roundel: a bead-and-fillet ring with a carved patera in the middle."""
    face3 = lambda p, h: M @ Vector((p[0], -(y_plane + h), p[1]))
    n = arc_steps(rr, math.tau)
    path = [(xc + rr * math.cos(math.tau * i / n), zc + rr * math.sin(math.tau * i / n)) for i in range(n)]
    e = -0.008
    ring = _prof([(0.034, e), (0.034, 0.012)], _arc(0.0, 0.012, 0.034, 0, 180, 8)[1:-1],
                 [(-0.034, 0.012), (-0.034, e)], r=0.0)
    mb.new_part()
    _sweep(mb, path, ring, face3, closed=True, mat=mi, uv_size=sz)
    c = M @ Vector((xc, -y_plane, zc))
    out = (M.to_3x3() @ Vector((0, -1, 0))).normalized()
    right = (M.to_3x3() @ Vector((1, 0, 0))).normalized()
    _flower(mb, CARVED, c, out, right, rr * 0.66, petals=8, inner=6, height=0.075 * rr / 0.32, res=1)


def _console(mb, mi, M, xc, z_top, height, d_top, d_bot, width, sz, y_plane=0.0):
    """Scroll console (bracket) on a face under an overhang: an S-curved front from a small roll
    at the foot to a full roll under the top, scroll bosses on both flanks."""
    mb.new_part()
    zb = z_top - height
    side = _prof(
        [(0.0, zb), (d_bot * 0.6, zb)],
        _arc(d_bot * 0.6, zb + d_bot * 0.6, d_bot * 0.6, -90, 60, 5)[1:],
        _bez((d_bot * 0.9, zb + d_bot * 1.1), (d_bot * 0.9 + 0.02, zb + height * 0.45),
             (d_top * 0.75, z_top - height * 0.35), (d_top, z_top - height * 0.12), 7)[1:],
        [(d_top, z_top)],
        r=0.0,
    )
    hw = width / 2
    Pp = lambda x, d, z: M @ Vector((x, -(y_plane + d), z))
    Rr = (M.to_3x3() @ Vector((1, 0, 0))).normalized()
    Out3 = (M.to_3x3() @ Vector((0, -1, 0))).normalized()
    ring_l = [Pp(xc - hw, d, z) for d, z in side]
    ring_r = [Pp(xc + hw, d, z) for d, z in side]
    for j in range(len(side) - 1):
        f = [ring_l[j], ring_l[j + 1], ring_r[j + 1], ring_r[j]]
        dd, dz = side[j + 1][0] - side[j][0], side[j + 1][1] - side[j][1]
        want = Out3 * dz - Z * dd
        pts, _ = _orient([tuple(p) for p in f], None, want)
        mb.pface([Vector(p) for p in pts], mi, sz, right=Rr)
    for ring, s_ in ((ring_l, -1), (ring_r, 1)):
        pts, _ = _orient([tuple(p) for p in ring], None, Rr * s_)
        mb.pface([Vector(p) for p in pts], mi, sz, right=Out3)
    for s_ in (-1, 1):
        for dc, zc, rad in ((d_top * 0.62, z_top - height * 0.2, min(0.06, d_top * 0.42)), (d_bot * 0.6, zb + d_bot * 0.6, d_bot * 0.5)):
            _dome(mb, CARVED, Pp(xc + s_ * hw, dc, zc), Rr * s_, Out3, rad, 0.008, seg=10, rings=2)


_PANEL_BEAD = [(0.004, -0.005), (0.004, 0.006), (-0.004, 0.016), (-0.014, 0.022), (-0.024, 0.016), (-0.032, 0.006),
               (-0.036, 0.0), (-0.036, -0.005)]


def _reveal_panels(mb, M, ri, spring, z_lo, z_hi, y_front, y_back, sz, coffers=True):
    """Moulded panels on the jamb reveals (stacked when tall) and coffers with rosettes along the
    arch soffit (radius ri), between y_front (room side, negative) and y_back."""
    stone = mb.mi(CARVED)
    m = 0.11
    ya, yb = y_front + m, y_back - m
    R3 = M.to_3x3()
    H = z_hi - z_lo
    n_st = max(1, round(H / 2.0))
    rail = 0.16
    ph = (H - 2 * m - (n_st - 1) * rail) / n_st
    for sx in (1, -1):
        to3 = lambda p, h, sx=sx: M @ Vector((sx * (ri - h), p[0], p[1]))
        want = R3 @ Vector((-sx, 0, 0))
        for k in range(n_st):
            z0 = z_lo + m + k * (ph + rail)
            path = [(ya, z0), (yb, z0), (yb, z0 + ph), (ya, z0 + ph)]
            _sweep_into(mb, stone, path, _PANEL_BEAD, to3, want, closed=True, uv_size=sz)
    if not coffers:
        return
    L = math.pi * ri
    n_c = max(3, round(L / 1.0))
    rib = 0.15
    cl = (L - (n_c + 1) * rib) / n_c
    to3 = lambda p, h: M @ Vector(((ri - h) * math.cos(math.pi - p[0] / ri), p[1], spring + (ri - h) * math.sin(math.pi - p[0] / ri)))
    for k in range(n_c):
        s0 = rib + k * (cl + rib)
        s1 = s0 + cl
        th = math.pi - (s0 + s1) / 2 / ri
        want = R3 @ Vector((-math.cos(th), 0, -math.sin(th)))
        ns = max(2, math.ceil(cl / 0.08))
        path = [(s0 + (s1 - s0) * i / ns, ya) for i in range(ns)] + [(s1, ya)] + \
               [(s1 - (s1 - s0) * i / ns, yb) for i in range(ns)] + [(s0, yb)]
        _sweep_into(mb, stone, path, _PANEL_BEAD, to3, want, closed=True, uv_size=sz)
        c = to3(((s0 + s1) / 2, (ya + yb) / 2), -0.002)
        out = R3 @ Vector((-math.cos(th), 0, -math.sin(th)))
        right = R3 @ Vector((0, 1, 0))
        rr = 0.24 * min(cl, yb - ya)
        _flower(mb, CARVED, c, out, right, rr, petals=8, inner=4, height=0.3 * rr, res=1)


def build_arch_surround(opening, wall, side=None, name=None, col=None):
    """Moulded surround for an arched opening on one face of `wall` (default: the room side),
    plus moulded panels in its reveals and coffers with rosettes in its soffit.

    An arch boxed in by bookcases on both sides (the lobby, lounge and gallery-landing arches)
    becomes a PORTAL: a stone frame as deep as the cases (they die into it), its jambs carrying
    the casing, its spandrels filled flush with carved roundels, a scroll keystone (hung below
    the crown under the gallery, rising into a capping cornice elsewhere) and imposts running
    through the whole reveal. Other arches get a casing on the wall face whose width adapts to
    the clearance from bookcases, pilasters, the gallery soffit, openings above and the cornice;
    large ones also get an outer band, scroll consoles under the imposts, a capped scroll
    keystone with an acanthus leaf, spandrel roundels and a moulded tablet. Every arc uses the
    wall's arc sampler and stands SURROUND_PROUD into the opening."""
    col = col or _sub(COL_ARCHES)
    spring = _g(opening, "spring")
    y1 = _g(opening, "y1")
    if spring is None or spring >= y1 - 1e-6:
        raise ValueError(f"{_g(opening, 'id')} has no arched head")
    env = _arch_env(opening, wall, side)
    mb = _MB()
    mb.carve = _MB()
    if env["flank"] is not None and env["side"] < 0.3:
        band = _portal(mb, opening, wall, side, env)
    else:
        band = _framed(mb, opening, wall, side, env)
    nm = name or f"Architecture_ArchSurround_{_g(opening, 'id').title().replace('_', '')}"
    ob = _build_bevelled(mb, nm, col)
    ob["ovr_band"] = round(band, 4)
    return ob


def _build_bevelled(mb, name, col):
    """Builds block work with a 3 mm arris bevel and joins the (unbevelled) carving to it."""
    ob = mb.build(name, col, sharp=35.0)
    C.bevel(ob, 0.003, 1, 50.0, harden=True)
    _dissolve_degenerate(ob)
    if mb.carve.faces:
        cv = mb.carve.build(name + "_Carving", col, sharp=40.0)
        ob = C.join([ob, cv], name)
    return ob


def _portal(mb, opening, wall, side, env):
    c_face, R, Out, sgn, thick = _face_frame(wall, side)
    at, w, y0, y1 = _g(opening, "at"), _g(opening, "width"), _g(opening, "y0"), _g(opening, "y1")
    spring = env["spring"]
    r = w / 2
    pr = SURROUND_PROUD
    ri = r - pr
    D = env["flank"] + 0.04
    b = env["side"] - 0.004
    xo = r + b
    under = env["ztop"] <= GALLERY_STONE_TOP + 1e-6
    cap_h = 0.14
    z_top = env["ztop"] if under else min(env["ztop"] - cap_h, y1 + 0.42)
    stone = mb.mi(CARVED)
    sz = LM.tex_size(CARVED)
    M = _face_matrix(wall, at, 0.0, side)
    R3 = M.to_3x3()
    Pp = lambda x, y, z: M @ Vector((x, y, z))
    Hc = 0.075
    plinth_h = 0.30
    imp_h, imp_proj = 0.13, 0.06
    # --- portal body: jamb inner faces, outer sides, head front (fans), soffit, top ---------
    mb.new_part()
    for sx in (1, -1):
        f = [Pp(sx * ri, -D, y0), Pp(sx * ri, 0.0, y0), Pp(sx * ri, 0.0, spring), Pp(sx * ri, -D, spring)]
        pts, _ = _orient([tuple(p) for p in f], None, R3 @ Vector((-sx, 0, 0)))
        mb.pface([Vector(p) for p in pts], stone, sz)
        f = [Pp(sx * xo, -D, y0), Pp(sx * xo, 0.0, y0), Pp(sx * xo, 0.0, z_top), Pp(sx * xo, -D, z_top)]
        pts, _ = _orient([tuple(p) for p in f], None, R3 @ Vector((sx, 0, 0)))
        mb.pface([Vector(p) for p in pts], stone, sz)
    hz = z_top - spring
    th_c = math.atan2(hz, xo)
    angs = sorted(set(arc_angles(r, 0.0, math.pi)) | {th_c, math.pi - th_c}, reverse=True)
    arc = [(ri * math.cos(a), spring + ri * math.sin(a)) for a in angs]

    def hit(a):
        ca, sa = math.cos(a), math.sin(a)
        t1 = xo / abs(ca) if abs(ca) > 1e-9 else 1e9
        t2 = hz / sa if sa > 1e-9 else 1e9
        t = min(t1, t2)
        return (t * ca, spring + t * sa)

    outer = [hit(a) for a in angs]
    fwd = R3 @ Vector((0, -1, 0))
    for k in range(len(angs) - 1):
        f = [Pp(arc[k][0], -D, arc[k][1]), Pp(arc[k + 1][0], -D, arc[k + 1][1]), Pp(outer[k + 1][0], -D, outer[k + 1][1]), Pp(outer[k][0], -D, outer[k][1])]
        if abs(outer[k][0] - outer[k + 1][0]) > 1e-9 and abs(outer[k][1] - outer[k + 1][1]) > 1e-9:
            corner = (math.copysign(xo, outer[k][0]), spring + hz)
            f = f[:3] + [Pp(corner[0], -D, corner[1])] + f[3:]
        pts, _ = _orient([tuple(p) for p in f], None, fwd)
        mb.pface([Vector(p) for p in pts], stone, sz)
        g = [Pp(arc[k][0], -D, arc[k][1]), Pp(arc[k + 1][0], -D, arc[k + 1][1]), Pp(arc[k + 1][0], 0.0, arc[k + 1][1]), Pp(arc[k][0], 0.0, arc[k][1])]
        am = (angs[k] + angs[k + 1]) / 2
        pts, _ = _orient([tuple(p) for p in g], None, R3 @ Vector((-math.cos(am), 0, -math.sin(am))))
        mb.pface([Vector(p) for p in pts], stone, sz)
    f = [Pp(-xo, -D, z_top), Pp(xo, -D, z_top), Pp(xo, 0.0, z_top), Pp(-xo, 0.0, z_top)]
    pts, _ = _orient([tuple(p) for p in f], None, Z)
    mb.pface([Vector(p) for p in pts], stone, sz)
    # --- casing on the front plane --------------------------------------------------------
    face3 = lambda p, h: M @ Vector((p[0], -(D + h), p[1]))
    prof = _casing_profile(b, Hc)
    mb.new_part()
    for xs in (1, -1):
        pa, pb = (xs * r, y0 + plinth_h), (xs * r, spring - imp_h)
        _sweep(mb, [pa, pb] if xs > 0 else [pb, pa], prof, face3, mat=stone, uv_size=sz)
        x_in, x_out = sorted((xs * ri, xs * xo))
        _box_local(mb, stone, M, x_in, x_out, -(D + Hc + 0.012), -D + 0.01, y0, y0 + plinth_h, sz, skip=("back", "bottom"))
    k_wb, k_wt = 0.21, 0.30
    alpha = math.asin(min(0.95, (k_wt / 2 + 0.01) / r))
    for a0, a1 in ((0.0, math.pi / 2 - alpha), (math.pi / 2 + alpha, math.pi)):
        pts = [(r * math.cos(a), spring + r * math.sin(a)) for a in arc_angles(r, a0, a1)]
        mb.new_part()
        _sweep(mb, pts, prof, face3, mat=stone, uv_size=sz)
    # --- imposts: across the jamb front and through the whole reveal ------------------------
    ip = [(o_, h_ + spring - imp_h) for o_, h_ in _impost_profile(imp_h, imp_proj)]
    plan3 = lambda p, h: M @ Vector((p[0], p[1], h))
    for xs in (1, -1):
        mb.new_part()
        if xs > 0:
            path = [(ri, thick), (ri, -D), (xo, -D)]
        else:
            path = [(-xo, -D), (-ri, -D), (-ri, thick)]
        _sweep(mb, path, ip, plan3, mat=stone, uv_size=sz, cap0=True, cap1=True)
    # --- keystone ----------------------------------------------------------------------------
    crown = spring + ri
    if under:
        _keystone(mb, M, D, crown - 0.20, z_top, k_wb, k_wt, Hc + 0.035, Hc + 0.13, sz, cap_h=0.05)
    else:
        _keystone(mb, M, D, crown - 0.04, z_top, k_wb, k_wt, Hc + 0.02, Hc + 0.09, sz, cap_h=0.05)
        # capping cornice over the portal, returned to the wall
        cp = _prof([(-0.004, z_top), (0.02, z_top), (0.02, z_top + 0.02)],
                   _cyma_reversa((0.02, z_top + 0.02), (0.06, z_top + 0.05), 4)[1:],
                   [(0.065, z_top + 0.052), (0.065, z_top + 0.058), (0.09, z_top + 0.058), (0.09, z_top + 0.10)],
                   _cyma_recta((0.09, z_top + 0.10), (0.125, z_top + cap_h - 0.008), 5)[1:],
                   [(0.128, z_top + cap_h - 0.006), (0.128, z_top + cap_h), (0.0, z_top + cap_h)], r=0.0015)
        xe = xo + 0.05
        path = [(-xe, 0.0), (-xe, -D), (xe, -D), (xe, 0.0)]
        mb.new_part()
        rr_ = _sweep(mb, path, cp, plan3, mat=stone, uv_size=sz)
        _cap(mb, rr_[-1], cp[-1][1], plan3, True, stone, sz)
        for xs in (1, -1):
            f = [Pp(xs * xo, -D, z_top), Pp(xs * xe, -D, z_top), Pp(xs * xe, 0.0, z_top), Pp(xs * xo, 0.0, z_top)]
            pts, _ = _orient([tuple(p) for p in f], None, -Z)
            mb.pface([Vector(p) for p in pts], stone, sz)
    # --- spandrel roundels -------------------------------------------------------------------
    r_out = r + b + 0.03
    best = None
    for k in range(40):
        rr = 0.26 - 0.005 * k
        xc = xo - 0.07 - rr
        zc = z_top - 0.07 - rr
        if math.hypot(xc, zc - spring) >= r_out + rr + 0.035 and zc - rr > spring:
            best = (rr, xc, zc)
            break
    if best:
        rr, xc, zc = best
        for xs in (1, -1):
            _roundel(mb, stone, M, xs * xc, zc, rr, sz, y_plane=D)
    # --- panelled reveal + coffered soffit ----------------------------------------------------
    _reveal_panels(mb, M, ri, spring, y0 + 0.0, spring - imp_h, -D, thick, sz)
    return b


def _framed(mb, opening, wall, side, env):
    c_face, R, Out, sgn, thick = _face_frame(wall, side)
    at, w, y0, y1 = _g(opening, "at"), _g(opening, "width"), _g(opening, "y0"), _g(opening, "y1")
    spring = env["spring"]
    r = w / 2
    ri = r - SURROUND_PROUD
    side_c, head_c = env["side"], env["head"]
    top_c = env["ztop"] - y1
    target = min(0.42, max(0.2, 0.085 * w))
    b = max(0.06, min(target, side_c - 0.006, top_c - 0.006))
    big = w > 4.0 and top_c > 1.2
    b2 = max(0.0, min(0.21, head_c - b - 0.36)) if big else 0.0
    stone = mb.mi(CARVED)
    sz = LM.tex_size(CARVED)
    M = _face_matrix(wall, at, 0.0, side)
    face3 = lambda p, h: M @ Vector((p[0], -h, p[1]))
    plan3 = lambda p, h: M @ Vector((p[0], p[1], h))
    plinth_h = min(0.32, 0.18 + 0.4 * b)
    imp_h = max(0.075, min(0.16, 0.62 * b))
    imp_proj = max(0.04, min(0.09, 0.42 * b)) + 0.7 * b
    Hc = min(0.70 * b, 0.14)
    prof = _casing_profile(b, Hc)
    for xs in (1, -1):
        x = xs * r
        pa, pb = (x, y0 + plinth_h), (x, spring - imp_h)
        mb.new_part()
        _sweep(mb, [pa, pb] if xs > 0 else [pb, pa], prof, face3, mat=stone, uv_size=sz)
        x_in, x_out = sorted((xs * ri, x + xs * b))
        _box_local(mb, stone, M, x_in, x_out, -(Hc + 0.012), 0.0, y0, y0 + plinth_h, sz, skip=("back", "bottom"))
    ext = 0.03 if (big or side_c - b > 0.04) else 0.0
    face_w = b + b2 + ext
    ret = (head_c if big else side_c) - face_w - 0.004 > imp_proj
    ip = [(o_, h_ + spring - imp_h) for o_, h_ in _impost_profile(imp_h, imp_proj)]
    for xs in (1, -1):
        x = xs * r
        xo = x + xs * (face_w if ret else b)
        if xs > 0:
            path = [(x, thick), (x, 0.0), (xo, 0.0)] + ([(xo, 0.02)] if ret else [])
        else:
            path = ([(xo, 0.02)] if ret else []) + [(xo, 0.0), (x, 0.0), (x, thick)]
        mb.new_part()
        _sweep(mb, path, ip, plan3, mat=stone, uv_size=sz, cap0=(xs > 0) or not ret, cap1=(xs < 0) or not ret)
        if big and b2 > 0.05:
            cw = min(0.15, b2 + ext - 0.03)
            _console(mb, stone, M, xs * (r + b + (b2 + ext) / 2), spring - imp_h + 0.6 * imp_h,
                     0.46, 0.62 * imp_proj, 0.055, cw, sz)
    k_w = (0.20 + 0.10 * w) if big else min(0.28, 0.12 + 0.04 * w)
    k_top = min(top_c - 0.006, 1.05 if big else 0.30)
    alpha = math.asin(min(0.95, (k_w / 2 + 0.01) / r))
    oprof = _outer_band_profile(b2 + 0.006, 0.45 * b) if b2 > 0.05 else None
    for a0, a1 in ((0.0, math.pi / 2 - alpha), (math.pi / 2 + alpha, math.pi)):
        for rad, pr in ((r, prof), (r + b - 0.006, oprof)):
            if pr is None:
                continue
            pts = [(rad * math.cos(a), spring + rad * math.sin(a)) for a in arc_angles(rad, a0, a1)]
            mb.new_part()
            _sweep(mb, pts, pr, face3, mat=stone, uv_size=sz)
    z_kt = spring + r + k_top
    _keystone(mb, M, 0.0, spring + ri - 0.03, z_kt, k_w * 0.92, k_w * 1.3, Hc + 0.02, Hc + (0.17 if big else 0.08), sz,
              cap_h=0.08 if big else 0.05)
    if big:
        rr = 0.32
        hr = r + 0.2
        rout = r + b + b2
        x_arch = math.sqrt(max(0.0, rout * rout - hr * hr))
        x_lim = r + head_c
        xr = (x_arch + x_lim) / 2
        if x_lim - x_arch > 2 * rr + 0.2 and math.hypot(xr, hr) > rout + rr + 0.08:
            for xs in (1, -1):
                _roundel(mb, stone, M, xs * xr, spring + hr, rr, sz)
        z_lo = z_kt + 0.07 + 0.28
        z_hi = env["ztop"] - 0.27
        x_hi = r + head_c - 0.42
        if z_hi - z_lo > 0.8 and x_hi > 1.0:
            e = -0.01
            fprof = _prof([(0.11, e), (0.11, 0.012)], _cyma_recta((0.11, 0.012), (0.065, 0.048), 5)[1:],
                          [(0.035, 0.05), (0.03, 0.046)], _arc(0.018, 0.03, 0.016, 60, 180, 4)[1:],
                          [(0.0, 0.026), (0.0, e)], r=0.0015)
            rect = [(-x_hi + 0.11, z_lo + 0.11), (x_hi - 0.11, z_lo + 0.11), (x_hi - 0.11, z_hi - 0.11), (-x_hi + 0.11, z_hi - 0.11)]
            mb.new_part()
            _sweep(mb, rect, fprof, face3, closed=True, mat=stone, uv_size=sz)
    _reveal_panels(mb, M, ri, spring, y0 + plinth_h * 0.0, spring - imp_h, 0.0, thick, sz)
    return b


# ---------------------------------------------------------------------------
# Blind arches in the long west bays
# ---------------------------------------------------------------------------

def blind_openings():
    """Recessed blind arches centred in the hall's long windowless bays (the west wall): dicts
    in the plan Opening shape plus `depth` (recess) for build_wall(extra_openings=...)."""
    w = _wall_by_id("hall_w")
    lo, hi = P.HALL["minZ"], P.HALL["maxZ"]
    stops = [(lo, lo + PIL_W / 2)]
    for nm, kind, wid, u in hall_pilaster_positions():
        if wid == "hall_w" and kind == "full":
            stops.append((u - PIL_W / 2, u + PIL_W / 2))
    stops.append((hi - PIL_W / 2, hi))
    stops.sort()
    out = []
    for (a0, a1), (b0, b1) in zip(stops, stops[1:]):
        if b0 - a1 < 5.0:
            continue
        at = (a1 + b0) / 2
        out.append(dict(id=f"blind_hall_w{len(out) + 1}", kind="blind", at=round(at, 4), width=BLIND_W, y0=BLIND_SILL,
                        y1=BLIND_APEX, passable=False, spring=BLIND_APEX - BLIND_W / 2, depth=BLIND_DEPTH, side=None))
    return out


def build_blind_arch_surround(opening, wall, name=None, col=None):
    """Window-like dressing for a blind arch: casing up the jambs and round the head, imposts
    returning into the recess, a capped scroll keystone with a leaf, a moulded sill on two small
    blocks, and a bead frame inset on the recess back."""
    col = col or _sub(COL_ARCHES)
    c_face, R, Out, sgn, thick = _face_frame(wall)
    at, w, y0, y1 = _g(opening, "at"), _g(opening, "width"), _g(opening, "y0"), _g(opening, "y1")
    spring = _g(opening, "spring")
    depth = _g(opening, "depth")
    r = w / 2
    ri = r - SURROUND_PROUD
    b, Hc = 0.28, 0.10
    mb = _MB()
    mb.carve = _MB()
    stone = mb.mi(CARVED)
    sz = LM.tex_size(CARVED)
    M = _face_matrix(wall, at, 0.0)
    face3 = lambda p, h: M @ Vector((p[0], -h, p[1]))
    plan3 = lambda p, h: M @ Vector((p[0], p[1], h))
    prof = _casing_profile(b, Hc)
    sill_h = 0.09
    imp_h, imp_proj = 0.17, 0.12
    for xs in (1, -1):
        pa, pb = (xs * r, y0 + sill_h), (xs * r, spring - imp_h)
        mb.new_part()
        _sweep(mb, [pa, pb] if xs > 0 else [pb, pa], prof, face3, mat=stone, uv_size=sz)
    k_w = 0.26
    alpha = math.asin((k_w / 2 + 0.01) / r)
    for a0, a1 in ((0.0, math.pi / 2 - alpha), (math.pi / 2 + alpha, math.pi)):
        pts = [(r * math.cos(a), spring + r * math.sin(a)) for a in arc_angles(r, a0, a1)]
        mb.new_part()
        _sweep(mb, pts, prof, face3, mat=stone, uv_size=sz)
    ip = [(o_, h_ + spring - imp_h) for o_, h_ in _impost_profile(imp_h, imp_proj)]
    for xs in (1, -1):
        x = xs * r
        xo = x + xs * (b + 0.03)
        path = [(x, depth), (x, 0.0), (xo, 0.0), (xo, 0.02)] if xs > 0 else [(xo, 0.02), (xo, 0.0), (x, 0.0), (x, depth)]
        mb.new_part()
        _sweep(mb, path, ip, plan3, mat=stone, uv_size=sz, cap0=xs > 0, cap1=xs < 0)
    z_top = min(P.HALL_CORNICE - 0.04, spring + r + 0.42)
    _keystone(mb, M, 0.0, spring + ri - 0.03, z_top, 0.24, 0.32, Hc + 0.02, Hc + 0.11, sz, cap_h=0.07)
    # sill: a moulded shelf across the opening and both casings, returned to the wall
    xe = r + b + 0.06
    sp = _prof([(-0.004, y0 - 0.03), (0.06, y0 - 0.03)], _cyma_reversa((0.06, y0 - 0.03), (0.10, y0 + 0.01), 4)[1:],
               [(0.115, y0 + 0.012), (0.115, y0 + sill_h - 0.01), (0.105, y0 + sill_h), (-0.004, y0 + sill_h)], r=0.0015)
    # the sill runs on the wall face across the recess mouth; its top continues back into the
    # recess as a ledge, and two small blocks carry its ends (clear of the bookcases below)
    mb.new_part()
    _sweep(mb, [(-xe, 0.0), (xe, 0.0)], sp, plan3, mat=stone, uv_size=sz, cap0=True, cap1=True)
    _box_local(mb, stone, M, -ri, ri, 0.0, depth - 0.002, y0, y0 + sill_h, sz, skip=("bottom", "back", "front", "left", "right"))
    for xs in (1, -1):
        xc_ = xs * (r + b * 0.5)
        _box_local(mb, stone, M, xc_ - 0.06, xc_ + 0.06, -0.085, 0.0, y0 - 0.095, y0 - 0.03, sz, skip=("back",))
    # bead frame inset on the recess back
    inset = 0.22
    rb_ = r - inset
    pts = [(rb_, y0 + sill_h + inset * 0.7)] + [(rb_ * math.cos(a), spring + rb_ * math.sin(a)) for a in arc_angles(rb_, 0.0, math.pi)] + \
          [(-rb_, y0 + sill_h + inset * 0.7)]
    back3 = lambda p, h: M @ Vector((p[0], depth - h, p[1]))
    _sweep_into(mb, stone, pts, _PANEL_BEAD, back3, M.to_3x3() @ Vector((0, -1, 0)), closed=True, uv_size=sz)
    nm = name or f"Architecture_BlindArch_{_g(opening, 'id').title().replace('_', '')}"
    return _build_bevelled(mb, nm, col)


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def _sub(name):
    C.collection(COL_ROOT)
    return C.collection(name, COL_ROOT)


HALL_ARCHES = ("arch_lobby", "arch_lounge", "arch_rotunda", "arch_gallery_landing")


def build_hall_shell(cornice_top=P.HALL_CEILING, lift_shaft=True, blind_arches=True):
    """The Grand Reading Hall's shell, in place: the four walls (the west one with its blind
    arches) and the lift shaft's faces (ARCHITECTURE/Walls), the entablature + inscription and
    the east belt course (Walls), the pilasters (Columns, linked duplicates of one mesh per kind)
    and the arch surrounds and blind-arch dressings (Arches). Returns the list of objects."""
    walls_col, cols_col, arch_col = _sub(COL_WALLS), _sub(COL_COLUMNS), _sub(COL_ARCHES)
    blind = blind_openings() if blind_arches else []
    out = []
    for wid in HALL_WALLS:
        out.append(build_wall(_wall_by_id(wid), col=walls_col, extra_openings=blind if wid == "hall_w" else ()))
    if lift_shaft:
        out += build_lift_shaft(walls_col)
    out += build_hall_cornice(walls_col, top=cornice_top)
    out.append(build_hall_belt(walls_col))
    out += build_hall_pilasters(cols_col)
    for wid in HALL_WALLS:
        w = _wall_by_id(wid)
        for o in w.openings:
            if o.id in HALL_ARCHES:
                out.append(build_arch_surround(o, w, col=arch_col))
    for o in blind:
        out.append(build_blind_arch_surround(o, _wall_by_id("hall_w"), col=arch_col))
    return out


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _placeholders():
    """Flat stand-ins (preview only): floor, ceiling, gallery slabs + railings, columns, lift
    doors, bookcase blocks (gallery runs split round the pilasters with split_bookcase_runs).
    Not part of any build_* output."""
    col = C.collection("PREVIEW_PLACEHOLDERS")
    objs = []
    h = P.HALL
    objs.append(C.box_minmax("PH_Floor", (h["minX"] - 30, -h["maxZ"] - 30, -0.05), (h["maxX"] + 30, -h["minZ"] + 30, 0.0), LM.mat("parquet_herringbone"), col=col))
    objs.append(C.box_minmax("PH_Ceiling", (h["minX"], -h["maxZ"], P.HALL_CEILING), (h["maxX"], -h["minZ"], P.HALL_CEILING + 0.1), LM.mat("coffer_panel"), col=col))
    s = P.LIFT["shaft"]
    for nm, r in P.GALLERY["runs"].items():
        rects = [r]
        if lift_walls() and r["minX"] < s["maxX"] and r["maxX"] > s["minX"] and r["minZ"] < s["maxZ"] and r["maxZ"] > s["minZ"]:
            rects = [dict(r, maxX=s["minX"]), dict(r, minX=s["minX"], minZ=s["maxZ"])]
        for k, q in enumerate(rects):
            objs.append(C.box_minmax(f"PH_Gallery_{nm}_{k}", (q["minX"], -q["maxZ"], P.GALLERY_UNDERSIDE + 0.1), (q["maxX"], -q["minZ"], P.GALLERY_Y), LM.mat("walnut"), col=col))
    for rl in P.GALLERY["railings"]:
        (ax, az), (bx, bz) = rl["a"], rl["b"]
        objs.append(C.box_minmax(f"PH_{rl['id']}", (min(ax, bx) - 0.03, -max(az, bz) - 0.03, P.GALLERY_Y), (max(ax, bx) + 0.03, -min(az, bz) + 0.03, P.GALLERY_Y + P.RAILING_H), LM.mat("iron"), col=col))
    for i, (x, z) in enumerate(P.GALLERY["columns"]):
        objs.append(C.cylinder(f"PH_Col_{i}", 0.2, 0.2, P.GALLERY_UNDERSIDE, (x, -z, P.GALLERY_UNDERSIDE / 2), LM.mat("walnut"), segments=24, col=col))
    for w in lift_walls():
        for o in w["openings"]:
            c_face = _face_frame(w)[0]
            a, b_ = o["at"] - o["width"] / 2, o["at"] + o["width"] / 2
            p0 = Vector(_to_bl(w["axis"], a, c_face + 0.05, o["y0"]))
            p1 = Vector(_to_bl(w["axis"], b_, c_face + 0.08, o["y1"]))
            objs.append(C.box_minmax(f"PH_{o['id']}", tuple(map(min, p0, p1)), tuple(map(max, p0, p1)), LM.mat("bronze"), col=col))
    for bc in split_bookcase_runs():
        (ax, az), (bx, bz) = bc["a"], bc["b"]
        if not (-14.5 <= ax <= 14.5 and -10.5 <= az <= 8.5):
            continue
        dep = bc["depth"]
        rot = bc["rot"]
        fx, fz = round(math.sin(rot), 6), round(math.cos(rot), 6)
        xs = (ax, bx, ax + fx * dep, bx + fx * dep)
        zs = (az, bz, az + fz * dep, bz + fz * dep)
        objs.append(C.box_minmax(f"PH_{bc['id']}", (min(xs), -max(zs), bc["y"]), (max(xs), -min(zs), bc["y"] + bc["height"]), LM.mat("walnut_dark"), col=col))
        # a projecting crown so the case reads as joinery
        cx0, cx1 = min(xs) - (0.03 if fx else 0), max(xs) + (0.03 if fx else 0)
        cz0, cz1 = min(zs) - (0.03 if fz else 0), max(zs) + (0.03 if fz else 0)
        objs.append(C.box_minmax(f"PH_{bc['id']}_crown", (cx0 - abs(fx) * 0.0, -cz1, bc["y"] + bc["height"] - 0.12), (cx1, -cz0, bc["y"] + bc["height"]), LM.mat("walnut"), col=col))
    return objs


def _sun_and_world(scene):
    import lib_render as LR
    LR.world(scene, (0.55, 0.62, 0.72), float(os.environ.get("ARCH_WORLD", "0.45")))
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 5.0
    sun.angle = math.radians(1.2)
    sun.color = (1.0, 0.95, 0.86)
    so = bpy.data.objects.new("Sun", sun)
    scene.collection.objects.link(so)
    d = Vector((-0.45, -1.0, -0.62)).normalized()   # from the north-east, travelling south-west
    so.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    for lt in P.LIGHTS:
        if lt["kind"] == "chandelier" and abs(lt["x"]) < 14:
            pl = bpy.data.lights.new(lt["id"], "POINT")
            pl.energy = float(os.environ.get("ARCH_LAMP", "3500"))
            pl.shadow_soft_size = 1.2
            pl.color = (1.0, 0.78, 0.52)
            po = bpy.data.objects.new(lt["id"], pl)
            po.location = C.bl(lt["x"], lt["y"], lt["z"])
            scene.collection.objects.link(po)


def _key_light(loc, tgt, k=22.0):
    """Preview-only raking key light for close-ups (up and to the left of the camera)."""
    import lib_render as LR
    loc, tgt = Vector(loc), Vector(tgt)
    d = tgt - loc
    right = d.cross(Z).normalized()
    pos = loc - right * (0.9 * d.length) + Z * (0.55 * d.length)
    return LR.area_light("PreviewKey", pos, tgt, k * (tgt - pos).length_squared, 0.5 * d.length, (1.0, 0.93, 0.84))


PREVIEW_SHOTS = [
    # name, camera (web), target (web), lens
    ("hall_nw", (0, 1.7, 6), (-12, 7.5, -9.0), 20),
    ("hall_ne_lift", (-3.0, 1.7, 4.0), (12.6, 8.4, -8.6), 22),
    ("hall_gallery_e", (-12.4, 6.3, -8.3), (14, 7.6, 2.0), 20),
    ("hall_west", (7, 3.0, -1), (-14, 8.6, -1), 24),
    ("hall_east_arch", (-7, 1.7, -1), (14, 5.6, -1), 24),
    ("hall_south", (0, 1.7, -6.5), (0, 8.0, 8), 22),
    ("detail_capital", (-2.0, 10.35, -7.9), (-2.8, 11.2, -9.9), 40),
    ("detail_capital_side", (-1.35, 10.75, -9.05), (-2.75, 11.12, -9.85), 50),
    ("detail_capital_floor", (-1.2, 1.7, -1.0), (-2.8, 11.15, -9.9), 110),
    ("detail_capital_gallery", (-4.6, 6.3, -7.6), (-2.8, 11.15, -9.9), 60),
    ("detail_corner_capital", (-12.3, 10.5, -8.3), (-14, 11.2, -10), 42),
    ("detail_lift_corner", (9.6, 10.0, -5.6), (12.0, 11.5, -8.0), 30),
    ("detail_cornice_nw", (-12.0, 10.6, -8.2), (-14, 12.2, -10), 28),
    ("detail_cornice_soffit", (-0.5, 10.6, -8.7), (0.2, 12.45, -9.6), 30),
    ("detail_arch_rotunda", (9.6, 2.2, 0.8), (14, 6.4, -1.0), 24),
    ("detail_arch_rotunda_head", (10.6, 6.2, -1.0), (14, 8.6, -1.0), 30),
    ("detail_arch_rotunda_reveal", (12.6, 1.6, 0.2), (14.6, 6.0, -1.8), 22),
    ("detail_arch_lounge", (-10.4, 1.6, 0.6), (-14, 2.4, -1.0), 28),
    ("detail_arch_lobby_reveal", (1.4, 1.6, 4.6), (-0.2, 2.8, 8.6), 24),
    ("detail_gallery_landing", (2.6, 6.0, 4.4), (0.0, 6.6, 8.0), 26),
    ("detail_intrados_edge", (12.95, 6.1, 0.55), (14.05, 7.3, 1.12), 45),
    ("detail_oculus_edge", (-5.0, 9.1, 6.4), (-5.6, 9.2, 8.0), 34),
    ("detail_inscription", (-10.8, 10.6, -1.0), (-14, 12.05, -1.0), 30),
    ("detail_blind_arch", (-8.6, 8.0, -6.6), (-14, 9.4, -6.6), 26),
    ("detail_gallery_base", (-1.2, 5.7, -8.0), (-2.8, 5.1, -10.0), 30),
    ("detail_lift_gallery", (9.4, 6.1, -6.4), (12.0, 6.4, -8.7), 22),
]


def preview(out_dir):
    import lib_render as LR
    scene = bpy.context.scene
    built = build_hall_shell()
    _placeholders()
    _sun_and_world(scene)
    LR.engine(scene, "EEVEE", int(os.environ.get("ARCH_SAMPLES", "40")), (960, 720))
    scene.view_settings.exposure = float(os.environ.get("ARCH_EXPOSURE", "0.0"))
    cam = LR.camera(lens=22)
    paths = []
    only = os.environ.get("ARCH_SHOTS")
    for nm, loc, tgt, lens in PREVIEW_SHOTS:
        if only and nm not in only.split(","):
            continue
        cam.data.lens = lens
        loc, tgt = C.bl(*loc), C.bl(*tgt)
        LR.look(cam, loc, tgt)
        key = _key_light(loc, tgt) if nm.startswith("detail") and "floor" not in nm else None
        paths.append(LR.render(os.path.join(out_dir, f"arch_shell_{nm}.png")))
        if key:
            bpy.data.objects.remove(key)
    if not only or "building_aerial" in only.split(","):
        ctx = C.collection("PREVIEW_CONTEXT_WALLS")
        for w in P.WALLS:
            if _g(w, "id") not in HALL_WALLS:
                build_wall(w, col=ctx)
        for ob in list(bpy.data.collections["PREVIEW_PLACEHOLDERS"].objects):
            if ob.name != "PH_Floor":
                ob.hide_render = True
        cam.data.lens = 26
        LR.look(cam, Vector((12, -44, 34)), Vector((3, 1, 2)))
        paths.append(LR.render(os.path.join(out_dir, "arch_shell_building_aerial.png")))
    report(built)
    return paths


def report(built):
    seen = set()
    total = unique = 0
    for ob in built:
        n = C.tris(ob)
        inst = ob.data.name in seen
        seen.add(ob.data.name)
        grp = ob.users_collection[0].name if ob.users_collection else "-"
        print(f"TRIS {grp:8s} {ob.name:48s} {n:7d}{'  (instance)' if inst else ''}")
        total += n
        unique += 0 if inst else n
    print(f"TRIS total rendered {total}  (unique mesh data {unique})")
