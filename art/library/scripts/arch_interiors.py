"""
Room interiors (milestone 2): the interior architecture of every room outside the Grand Reading Hall,
built IN PLACE from plan.py (web coordinates converted with the lib_core convention web (x, y, z) ->
Blender (x, -z, y)). The walls with their holes are arch_shell.build_wall's and the windows / doors are
arch_windows'; this module dresses the room faces and closes each room with its ceiling.

Every room is a counter-clockwise polygon of wall FACES (the plan rect; the lounge's west face is
broken round the chimney breast). Along each face the module collects OBSTACLES from the plan and from
the scene: the window / door / arch dressings already built in the wall (their real extents are
measured from the meshes, so trims, plinth blocks and window boards are respected), bookcase runs,
stair flights and furniture that stands solid against a wall. Every moulding layer (skirting, dado
body, dado rail, picture rail, cornice) is then swept along the free runs of the room: mitred at
internal and external corners, stopped against thick obstacles and RETURNED into the wall where it
stops beside a thin one (window trims, the landing archivolt), so no moulding ever ends in mid-air.

    build_room(room_id)        dress one room ('lobby', 'lounge', 'quiet', 'group', 'computers',
                               'services'); returns its objects (collection ARCHITECTURE/Interiors/...)
    build_interiors()          all six rooms (the scene calls this; it also builds the lobby ceiling)
    build_pendant_light(...)   brass gallery pendant with an opal glass globe on a rod, ceiling rose
                               and canopy; carries light_points / light_color
    preview(out_dir)           walls + windows/doors + floors + context, Cycles room views + close-ups

Room characters
    lobby      limestone dado (plinth, die with bolection-moulded panels, moulded cap) broken forward
               into pedestals under four fluted Roman Doric pilasters on the entrance wall (a simpler
               order than the hall's Corinthian, as a vestibule should have); a full limestone
               entablature (three-fascia architrave, frieze, bed mould, dentils, corona, cyma) under
               arch_ceiling.build_lobby_ceiling()'s cove, broken and returned round the gallery-landing
               arch, which gets a moulded archivolt, plinth blocks and a keystone on the lobby side; the
               lobby side of the hall arch (arch_shell.build_arch_surround); walnut entablature heads
               (frieze + returned cornice) over the side doors. No dado where the stairs run.
    lounge     raised-panel walnut wainscot (1.1 m) with skirting and dado rail, dropping under the
               windows to sit beneath their boards; a chimney breast (3.5 m wide, 0.3 m deep) round the
               plan fireplace up to the ceiling, with an overmantel recess for the fireplace's mirror
               framed in a walnut bolection; walnut picture rail; a deep oak cornice; a beamed oak
               ceiling (three moulded principals across the room, the middle one on the fireplace axis,
               moulded cross ribs between them) over plaster panels; the lounge side of the hall arch.
    quiet      plaster_green walls, ivory painted panelled dado, picture rail, a plaster cornice and a
               shallow coffered ceiling (arch_ceiling.build_coffered_ceiling, flat style) inside a plain
               border; the pendants hang in coffer centres.
    group      oak panelled dado, ivory walls, oak picture rail, plaster cornice, flat ceiling with a
               moulded ceiling panel.
    computers / services   ivory painted panelled dado with a dark oak skirting, plaster cornice, flat
               ceiling with a moulded ceiling panel; a walnut architrave on the computers side of the
               storage door (arch_windows only dresses its services face).
"""

from __future__ import annotations

import math
import os

import bpy
import numpy as np
from mathutils import Vector

import lib_core as C
import lib_materials as LM
import lib_render as R
import plan as P

mat = LM.mat
tex = LM.tex_size

COL_ROOT = "ARCHITECTURE"
COL_INT = "Interiors"
ROOM_IDS = ("lobby", "lounge", "quiet", "group", "computers", "services")
E = -0.012           # mouldings start this far inside the wall (their backs are never seen)
FR = 0.020           # panelled dado: frame (stiles and rails) thickness off the wall
ZUP = Vector((0.0, 0.0, 1.0))

# Furniture kinds that stand solid against a wall: skirtings and dados stop at them.
SOLID_KINDS = {"carrel", "printer_station", "water_station", "magazine_rack", "cabinet_display"}

# Room dressing specs.
SPEC = {
    "lobby": dict(dado="stone", top=0.995, rail=None, cornice="entablature", ceiling="lobby"),
    "lounge": dict(dado="raised", top=1.10, wood="walnut", skirt="walnut", rail=4.45, rail_key="walnut",
                   cornice="lounge", ceiling="beams", panel_w=0.62),
    "quiet": dict(dado="flat", top=0.88, wood="ivory_paint", skirt="ivory_paint", rail=3.70, rail_key="ivory_paint",
                  cornice="wing", ceiling="coffers", wall="plaster_green", panel_w=0.70),
    "group": dict(dado="flat", top=0.80, wood="oak", skirt="oak", rail=3.70, rail_key="oak", cornice="wing",
                  ceiling="flat", panel_w=0.72),
    "computers": dict(dado="flat", top=0.90, wood="ivory_paint", skirt="oak_stained", rail=None, cornice="wing",
                      ceiling="flat", panel_w=0.72),
    "services": dict(dado="flat", top=0.90, wood="ivory_paint", skirt="oak_stained", rail=None, cornice="wing",
                     ceiling="flat", panel_w=0.72),
}

PENDANT_BOTTOM = 3.50          # globe bottom (plan LIGHTS y 4.1 is the light's nominal height)
QUIET_COFFER = dict(coffer=1.42, margin=0.875, recess=0.15)   # 7 x 7 coffers of 1.42 x 1.35, centred


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def _col(sub=None):
    C.collection(COL_ROOT)
    col = C.collection(COL_INT, COL_ROOT)
    return C.collection(f"Interior_{sub.capitalize()}", col) if sub else col


def _arc(cu, cv, r, a0, a1, n, rv=None):
    rv = r if rv is None else rv
    return [(cu + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
             cv + rv * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def _ogee(p0, p1, n=6, kind="recta"):
    """S-curve from p0 to p1 (both ends included). recta: leaves/arrives along v; reversa: along u."""
    (u0, v0), (u1, v1) = p0, p1
    out = []
    for k in range(n + 1):
        t = k / n
        e = (1 - math.cos(math.pi * t)) / 2
        out.append((u0 + (u1 - u0) * e, v0 + (v1 - v0) * t) if kind == "recta" else (u0 + (u1 - u0) * t, v0 + (v1 - v0) * e))
    return out


def _clean(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append((float(p[0]), float(p[1])))
    return out


def _newell(pts):
    n = Vector((0.0, 0.0, 0.0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a[1] - b[1]) * (a[2] + b[2])
        n.y += (a[2] - b[2]) * (a[0] + b[0])
        n.z += (a[0] - b[0]) * (a[1] + b[1])
    return n


def _hex_lin(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


class MB:
    """Mesh builder: explicit vertices, faces oriented against a wanted normal, UVs, material slots."""

    def __init__(self):
        self.co, self.fs, self.uvs, self.ms, self.keys = [], [], [], [], []

    def mi(self, key):
        if key not in self.keys:
            self.keys.append(key)
        return self.keys.index(key)

    def v(self, p):
        self.co.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.co) - 1

    def face(self, idx, uv, mi, want=None):
        idx, uv = list(idx), list(uv)
        if len(set(idx)) < len(idx) or len(idx) < 3:
            return
        if want is not None:
            n = _newell([self.co[i] for i in idx])
            if n.length < 1e-12:
                return
            if n.dot(want) < 0:
                idx.reverse()
                uv.reverse()
        self.fs.append(idx)
        self.uvs.append(uv)
        self.ms.append(mi)

    def build(self, name, col, smooth=35.0):
        if not self.fs:
            return None
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.co, [], self.fs)
        uvl = me.uv_layers.new(name="UVMap")
        uvl.data.foreach_set("uv", [c for f in self.uvs for p in f for c in p])
        me.polygons.foreach_set("material_index", self.ms)
        for k in self.keys:
            me.materials.append(mat(k))
        me.update()
        ob = bpy.data.objects.new(name, me)
        C.link(ob, col)
        C.shade_smooth(ob, smooth)
        return ob


def _sweep(mb, prof, path, up, mis, size, closed=False, cap0=False, cap1=False, u0=0.0):
    """Sweeps an open profile [(u, v)] (traced counter-clockwise round its solid: u = lateral, the
    left of the path seen from `up`, v = along `up`) along a 3D polyline; mitred corners, metric UVs
    (U along the path = grain, V along the profile)."""
    prof = _clean(prof)
    pts = []
    for p in path:
        p = Vector(p)
        if not pts or (p - pts[-1]).length > 1e-6:
            pts.append(p)
    if closed and len(pts) > 2 and (pts[0] - pts[-1]).length < 1e-6:
        pts.pop()
    n = len(pts)
    if n < 2 or len(prof) < 2:
        return
    U = Vector(up).normalized()
    nseg = n if closed else n - 1
    dirs = [(pts[(i + 1) % n] - pts[i]).normalized() for i in range(nseg)]
    lat = [U.cross(d).normalized() for d in dirs]
    rings = []
    for i in range(n):
        if closed:
            a, b = lat[i - 1], lat[i % nseg]
        else:
            a = lat[i - 1] if i > 0 else lat[0]
            b = lat[i] if i < nseg else lat[-1]
        m = a + b
        m = m.normalized() if m.length > 1e-6 else b
        sc = 1.0 / max(0.25, m.dot(b))
        rings.append([mb.v(pts[i] + m * (u * sc) + U * v) for u, v in prof])
    cum = [u0]
    for i in range(nseg):
        cum.append(cum[-1] + (pts[(i + 1) % n] - pts[i]).length)
    pl = [0.0]
    for k in range(len(prof) - 1):
        pl.append(pl[-1] + math.hypot(prof[k + 1][0] - prof[k][0], prof[k + 1][1] - prof[k][1]))
    if isinstance(mis, int):
        mis = [mis] * (len(prof) - 1)
    for i in range(nseg):
        j = (i + 1) % n
        for k in range(len(prof) - 1):
            du, dv = prof[k + 1][0] - prof[k][0], prof[k + 1][1] - prof[k][1]
            want = lat[i] * dv - U * du
            mb.face([rings[i][k], rings[j][k], rings[j][k + 1], rings[i][k + 1]],
                    [(cum[i] / size, pl[k] / size), (cum[i + 1] / size, pl[k] / size),
                     (cum[i + 1] / size, pl[k + 1] / size), (cum[i] / size, pl[k + 1] / size)], mis[k], want)
    if not closed:
        for flag, ring, d, li in ((cap0, rings[0], -dirs[0], lat[0]), (cap1, rings[-1], dirs[-1], lat[-1])):
            if flag:
                uv = [(Vector(mb.co[i]).dot(li) / size, Vector(mb.co[i]).dot(U) / size) for i in ring]
                mb.face(ring, uv, mis[0], d)


def _box(mb, F, s0, s1, d0, d1, z0, z1, mi, size, grain="s", back=False, bottom=False, top=True):
    """Box in a face frame (s along the face, d off the wall, z up)."""
    S, D, Zs = (s0, s1), (d0, d1), (z0, z1)
    v = {(i, j, k): mb.v(F.p(S[i], D[j], Zs[k])) for i in (0, 1) for j in (0, 1) for k in (0, 1)}

    def uv(keys, axes):
        out = []
        for i, j, k in keys:
            c = {"s": S[i], "d": D[j], "z": Zs[k]}
            a, b = axes
            out.append((c[a] / size, c[b] / size))
        return out
    T, N = F.t3, F.n3
    quads = [
        ([(0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)], -T, ("z", "d") if grain == "z" else ("d", "z")),
        ([(1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1)], T, ("z", "d") if grain == "z" else ("d", "z")),
        ([(0, 1, 0), (1, 1, 0), (1, 1, 1), (0, 1, 1)], N, ("z", "s") if grain == "z" else ("s", "z")),
    ]
    if back:
        quads.append(([(0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)], -N, ("s", "z")))
    if top:
        quads.append(([(0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)], ZUP, ("s", "d")))
    if bottom:
        quads.append(([(0, 0, 0), (1, 0, 0), (1, 1, 0), (0, 1, 0)], -ZUP, ("s", "d")))
    for keys, want, axes in quads:
        mb.face([v[k] for k in keys], uv(keys, axes), mi, want)


def _finish(mb_solid, mb_mould, name, col, bevel_w=0.0025):
    """Builds the bevelled block work and the (already moulded) sweeps, joined into one object."""
    objs = []
    s = mb_solid.build(name + "_Blocks", col, 30.0) if mb_solid else None
    if s is not None:
        C.bevel(s, bevel_w, 2, 30.0)
        objs.append(s)
    m = mb_mould.build(name, col, 38.0) if mb_mould else None
    if m is not None:
        objs.append(m)
    if not objs:
        return None
    ob = C.join(objs, name) if len(objs) > 1 else objs[0]
    ob.name = name
    return ob


# ---------------------------------------------------------------------------
# Profiles (u = projection off the wall / lateral, v = height), counter-clockwise round the solid
# ---------------------------------------------------------------------------

def prof_skirting(base=FR, h=0.168, p=0.020):
    b = base
    pts = [(E, 0.0), (b + p, 0.0), (b + p, h - 0.050), (b + p - 0.001, h - 0.046)]
    pts += _ogee((b + p - 0.002, h - 0.042), (b + 0.004, h - 0.006), 6, "recta")
    pts += [(b + 0.002, h - 0.002), (b, h), (E, h)]
    return pts


def prof_cap_rail(base=FR):
    """Dado rail capping a panelled dado: bead, ovolo, rounded nosing (0.065 tall)."""
    b = base
    pts = [(E, 0.0), (b + 0.002, 0.0)]
    pts += _arc(b + 0.002, 0.010, 0.010, -90, 90, 6)
    pts += [(b + 0.004, 0.022)]
    pts += _arc(b + 0.004, 0.050, 0.028, -90, 0, 6)
    pts += [(b + 0.032, 0.054)]
    pts += _arc(b + 0.024, 0.054, 0.008, 0, 90, 3)
    pts += [(b + 0.018, 0.064), (b + 0.016, 0.065), (E, 0.065)]
    return pts


def prof_picture_rail():
    pts = [(E, 0.0), (0.006, 0.0), (0.009, 0.004), (0.011, 0.012)]
    pts += _arc(0.019, 0.016, 0.008, 180, 90, 3)[1:]
    pts += [(0.022, 0.024)]
    pts += _arc(0.019, 0.034, 0.010, -60, 90, 6)[1:]
    pts += [(0.012, 0.044), (0.008, 0.045), (E, 0.045)]
    return pts


def prof_cornice_wing():
    """Plaster cornice for the wings (0.22 tall, 0.215 projection): bead, fascia, ovolo, cavetto."""
    pts = [(E, 0.0), (0.012, 0.0)]
    pts += _arc(0.012, 0.012, 0.012, -90, 90, 6)[1:]
    pts += [(0.016, 0.028), (0.016, 0.052)]
    pts += _arc(0.016, 0.082, 0.030, -90, 0, 6)[1:]
    pts += [(0.050, 0.086), (0.055, 0.090)]
    pts += _arc(0.200, 0.090, 0.145, 180, 90, 10, rv=0.112)[1:]
    pts += [(0.206, 0.204), (0.215, 0.208), (0.215, 0.220), (E, 0.220)]
    return pts


def prof_cornice_lounge():
    """Deep oak cornice for the lounge (0.50 tall, 0.245 projection)."""
    pts = [(E, 0.0), (0.018, 0.0)]
    pts += _arc(0.018, 0.016, 0.016, -90, 90, 6)[1:]
    pts += [(0.022, 0.034), (0.022, 0.118), (0.030, 0.124), (0.034, 0.132)]
    pts += _arc(0.034, 0.172, 0.040, -90, 0, 6)[1:]
    pts += [(0.080, 0.180), (0.080, 0.270)]
    pts += _ogee((0.082, 0.272), (0.128, 0.318), 6, "reversa")
    pts += [(0.136, 0.320), (0.136, 0.358), (0.150, 0.362), (0.200, 0.366), (0.202, 0.370), (0.202, 0.428)]
    pts += _ogee((0.206, 0.432), (0.244, 0.488), 7, "recta")
    pts += [(0.245, 0.500), (E, 0.500)]
    return pts


ENT_H = 0.85                  # lobby entablature 6.85 .. 7.70 (under the lobby ceiling's cove)
ENT_Z = P.LOBBY_CEILING - 0.30 - ENT_H
DENTIL_BAND = (0.585, 0.655, 0.190)   # v0, v1, face d of the band behind the dentils


def prof_entablature():
    pts = [(E, 0.0), (0.120, 0.0), (0.120, 0.082), (0.123, 0.086), (0.128, 0.088), (0.128, 0.160),
           (0.131, 0.164), (0.136, 0.166), (0.136, 0.200)]
    pts += _ogee((0.138, 0.204), (0.168, 0.242), 6, "reversa")
    pts += [(0.170, 0.244), (0.170, 0.258), (0.122, 0.262), (0.120, 0.266), (0.120, 0.520)]
    pts += _arc(0.124, 0.562, 0.040, -90, 0, 6)
    pts += [(0.170, 0.570), (0.170, 0.585), (DENTIL_BAND[2], 0.585), (DENTIL_BAND[2], 0.655), (0.198, 0.660)]
    pts += _arc(0.198, 0.672, 0.012, -90, 0, 3)[1:]
    pts += [(0.330, 0.672), (0.336, 0.676), (0.336, 0.744), (0.342, 0.750)]
    pts += _ogee((0.344, 0.756), (0.370, 0.834), 7, "recta")
    pts += [(0.370, ENT_H), (E, ENT_H)]
    return pts


STONE = "limestone_plain"
DADO_STONE_TOP = 0.995


def prof_dado_stone():
    """Lobby dado in one profile: plinth, torus and cavetto, flush die, moulded cap (0.995 tall)."""
    pts = [(E, 0.0), (0.075, 0.0), (0.075, 0.150), (0.073, 0.156), (0.068, 0.160)]
    pts += _arc(0.058, 0.172, 0.014, -45, 90, 5)[1:]
    pts += [(0.050, 0.186), (0.046, 0.190)]
    pts += _arc(0.046, 0.214, 0.011, -90, -180, 4, rv=0.024)[1:]
    pts += [(0.035, 0.860)]
    pts += _arc(0.050, 0.860, 0.015, 180, 90, 4)[1:]
    pts += [(0.053, 0.875), (0.053, 0.884)]
    pts += _arc(0.053, 0.922, 0.036, -90, 0, 6)[1:]
    pts += [(0.092, 0.926), (0.092, 0.962)]
    pts += _ogee((0.090, 0.966), (0.066, 0.990), 5, "reversa")
    pts += [(0.062, DADO_STONE_TOP), (E, DADO_STONE_TOP)]
    return pts


def prof_bolection(w=0.055, h=0.020):
    """Stone bolection panel frame (lateral u outward from the panel, v off the die)."""
    pts = [(w, -0.004), (w, 0.002)]
    pts += _ogee((w - 0.002, 0.004), (w * 0.55, h - 0.002), 5, "recta")
    pts += [(w * 0.45, h), (w * 0.25, h), (w * 0.12, h * 0.8), (0.004, h * 0.35), (0.0, 0.0), (0.0, -0.004)]
    return pts


def prof_panel_mould():
    """Small ogee mould in the corner between a panel frame and its field (u into the panel)."""
    return [(0.024, -0.013), (0.019, -0.009), (0.014, -0.004), (0.009, 0.001), (0.004, 0.004), (0.0, 0.005), (-0.006, 0.0)]


def prof_architrave(b=0.15, p=0.034):
    """Door architrave (u lateral outward from the opening, v projection): back band ogee, two fasciae."""
    pts = [(b, -0.004), (b, p - 0.010)]
    pts += _ogee((b - 0.002, p - 0.006), (b - 0.034, p), 5, "reversa")
    pts += [(b - 0.050, p), (b - 0.054, p - 0.004), (b - 0.060, p - 0.008), (0.60 * b, p - 0.010),
            (0.56 * b, p - 0.014), (0.012, p - 0.018), (0.0, p - 0.022), (0.0, -0.004)]
    return pts


# ---------------------------------------------------------------------------
# Room faces and obstacles
# ---------------------------------------------------------------------------

def _room(rid):
    return next(r for r in P.ROOMS if r.id == rid)


def _rect_bl(rid):
    b = _room(rid).bounds
    return b["minX"], -b["maxZ"], b["maxX"], -b["minZ"]


class Face:
    """One straight wall face of a room, traversed counter-clockwise (room on the left, Blender XY)."""

    def __init__(self, rid, idx, a, b):
        self.room, self.idx = rid, idx
        self.a = Vector((a[0], a[1], 0.0))
        b3 = Vector((b[0], b[1], 0.0))
        self.L = (b3 - self.a).length
        self.t3 = (b3 - self.a).normalized()
        self.n3 = Vector((-self.t3.y, self.t3.x, 0.0))
        self.obst = []
        self.proj = []            # (s0, s1, d): pedestals the dado breaks forward over

    def p(self, s, d=0.0, z=0.0):
        return self.a + self.t3 * s + self.n3 * d + Vector((0.0, 0.0, z))

    def s_of(self, x, y):
        return (Vector((x, y, 0.0)) - self.a).dot(self.t3)

    def d_of(self, x, y):
        return (Vector((x, y, 0.0)) - self.a).dot(self.n3)

    def rot(self):
        """rotation_euler.z that turns an origin-built wall piece (room on -Y) to face into the room."""
        return math.atan2(self.n3.x, -self.n3.y)


BREAST_D = 0.30
BREAST_HW = 1.75


def _breast():
    it = next(i for i in P.ITEMS if i.kind == "fireplace")
    return it, -it.z          # fireplace item, Blender y of its axis


def _polygon(rid):
    x0, y0, x1, y1 = _rect_bl(rid)
    pts = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    if rid == "lounge":
        _, yc = _breast()
        pts += [(x0, yc + BREAST_HW), (x0 + BREAST_D, yc + BREAST_HW), (x0 + BREAST_D, yc - BREAST_HW), (x0, yc - BREAST_HW)]
    return pts


def room_faces(rid):
    pts = _polygon(rid)
    return [Face(rid, i, pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]


class Ob:
    __slots__ = ("s0", "s1", "z0", "z1", "d", "kind", "oid")

    def __init__(self, s0, s1, z0, z1, d, kind, oid=""):
        self.s0, self.s1, self.z0, self.z1, self.d, self.kind, self.oid = s0, s1, z0, z1, d, kind, oid


def _walls_on(F):
    """Plan walls whose face lies on F (with their thickness)."""
    out = []
    for w in P.WALLS:
        b = w.bounds
        wx0, wx1, wy0, wy1 = b["minX"], b["maxX"], -b["maxZ"], -b["minZ"]
        p0, p1 = F.a, F.p(F.L)
        if (w.axis == "x") != (abs(F.t3.x) > 0.5):
            continue
        if abs(F.t3.x) > 0.5:
            line = F.a.y
            on = abs((wy1 if F.n3.y > 0 else wy0) - line) < 1e-3
            lo, hi = sorted((p0.x, p1.x))
            ov = min(hi, wx1) - max(lo, wx0)
            thick = wy1 - wy0
        else:
            line = F.a.x
            on = abs((wx1 if F.n3.x > 0 else wx0) - line) < 1e-3
            lo, hi = sorted((p0.y, p1.y))
            ov = min(hi, wy1) - max(lo, wy0)
            thick = wx1 - wx0
        if on and ov > 0.05:
            out.append((w, thick))
    return out


def _obj_name(o):
    return "Architecture_" + "".join(w.capitalize() for w in o.id.split("_"))


EXTRA = {}       # opening id -> objects this module built on a room face (surrounds, archivolts)


def _measure(objs, F, s_lo, s_hi, dmin=-0.004, dmax=0.7):
    lo = None
    for ob in objs:
        if ob is None:
            continue
        for o in [ob] + list(ob.children_recursive):
            if o.type != "MESH" or not len(o.data.vertices):
                continue
            n = len(o.data.vertices)
            co = np.empty(n * 3, dtype=np.float64)
            o.data.vertices.foreach_get("co", co)
            co = co.reshape(-1, 3)
            M = np.array(o.matrix_world)
            w = co @ M[:3, :3].T + M[:3, 3]
            rel = w - np.array(F.a)
            s = rel @ np.array(F.t3)
            d = rel @ np.array(F.n3)
            sel = (d > dmin) & (d < dmax) & (s > s_lo) & (s < s_hi)
            if not sel.any():
                continue
            ss, zz, dd = s[sel], w[sel, 2], d[sel]
            box = [ss.min(), ss.max(), zz.min(), zz.max(), dd.max()]
            lo = box if lo is None else [min(lo[0], box[0]), max(lo[1], box[1]), min(lo[2], box[2]), max(lo[3], box[3]),
                                         max(lo[4], box[4])]
    return lo


def _item_footprint(it):
    k = P.KINDS[it.kind]
    w, d = (it.w or k["w"]), (it.d or k["d"])
    if k["shape"] == "circle":
        return [(it.x + w / 2 * math.cos(a), it.z + w / 2 * math.sin(a)) for a in np.linspace(0, math.tau, 12, endpoint=False)]
    return [P.local_to_world(it.x, it.z, it.rot, sx * w / 2, sz * d / 2) for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]


def gather_obstacles(F):
    obs = []
    ceiling = _room(F.room).ceiling_y if F.room in ROOM_IDS else 99.0
    for w, thick in _walls_on(F):
        for o in w.openings:
            if o.y0 >= ceiling - 1e-6:
                continue
            if w.axis == "x":
                sc = F.s_of(o.at, F.a.y)
            else:
                sc = F.s_of(F.a.x, -o.at)
            hw = o.width / 2
            if sc + hw < -0.05 or sc - hw > F.L + 0.05:
                continue
            objs = [bpy.data.objects.get(_obj_name(o))] + EXTRA.get((F.room, o.id), [])
            m = _measure(objs, F, sc - hw - 1.0, sc + hw + 1.0)
            kind = "window" if o.kind.startswith("window") or o.kind == "oculus" else "opening"
            if m is not None:
                obs.append(Ob(m[0], m[1], max(0.0, m[2]), m[3], m[4], kind, o.id))
            else:
                obs.append(Ob(sc - hw - 0.17, sc + hw + 0.17, o.y0 - (0.1 if kind == "window" else 0.0),
                              o.y1 + 0.17, 0.04, kind, o.id))
    for bc in P.BOOKCASES:
        (ax, az), (bx, bz) = bc["a"], bc["b"]
        da, db = F.d_of(ax, -az), F.d_of(bx, -bz)
        if abs(da) > 0.03 or abs(db) > 0.03:
            continue
        sa, sb = sorted((F.s_of(ax, -az), F.s_of(bx, -bz)))
        if sb < 0.01 or sa > F.L - 0.01:
            continue
        obs.append(Ob(sa, sb, bc["y"], bc["y"] + bc["height"], bc["depth"], "case", bc["id"]))
    for it in P.ITEMS:
        if it.kind not in SOLID_KINDS:
            continue
        pts = [(F.s_of(x, -z), F.d_of(x, -z)) for x, z in _item_footprint(it)]
        if min(p[1] for p in pts) > 0.06 or max(p[1] for p in pts) < 0.0:
            continue
        s0, s1 = min(p[0] for p in pts), max(p[0] for p in pts)
        if s1 < 0 or s0 > F.L:
            continue
        obs.append(Ob(s0, s1, it.y, it.y + P.KINDS[it.kind]["h"], max(p[1] for p in pts), "solid", it.id))
    if F.room == "lobby":
        for fl in P.FLIGHTS:
            b = fl["bounds"]
            for xw in (b["minX"], b["maxX"]):
                if abs(F.d_of(xw, -b["minZ"])) < 1e-3 and abs(F.d_of(xw, -b["maxZ"])) < 1e-3:
                    sa, sb = sorted((F.s_of(xw, -b["minZ"]), F.s_of(xw, -b["maxZ"])))
                    obs.append(Ob(sa, sb, 0.0, P.GALLERY_Y + 1.6, 0.6, "stair", fl["id"]))
    return obs


# ---------------------------------------------------------------------------
# Runs: free stretches of a moulding layer round the room, chained across corners
# ---------------------------------------------------------------------------

def _intervals(F, z0, z1, depth, skip=(), clear=0.004, merge_gap=0.35):
    blocks = []
    for o in F.obst:
        if o.kind in skip or o.z1 <= z0 + 1e-4 or o.z0 >= z1 - 1e-4:
            continue
        butt = o.kind in ("case", "solid", "stair") or o.d >= depth - 0.004
        blocks.append([o.s0 - clear, o.s1 + clear, butt, butt, o.kind == "solid"])
    blocks.sort()
    merged = []
    for b in blocks:
        # the joinery carries on in the narrow gaps between pieces of furniture (a row of carrels),
        # butted against each; other close obstacles (trims, plinth blocks) are bridged instead
        gap = 0.08 if (merged and merged[-1][4] and b[4]) else merge_gap
        if merged and b[0] <= merged[-1][1] + gap:
            m = merged[-1]
            if b[1] > m[1]:
                m[1], m[3], m[4] = b[1], b[3], b[4]
            continue
        merged.append(list(b))
    out = []
    cur, st = 0.0, "corner"
    for b0, b1, butt_l, butt_r, _ in merged:
        if b1 <= 0.0:
            cur, st = max(cur, b1), ("butt" if butt_r else "return")
            continue
        out.append([cur, min(b0, F.L), st, "corner" if b0 >= F.L else ("butt" if butt_l else "return")])
        cur, st = b1, ("butt" if butt_r else "return")
    if cur < F.L:
        out.append([cur, F.L, st, "corner"])
    res = []
    for sa, sb, a, b in out:
        if a == "return":
            sa += depth
        if b == "return":
            sb -= depth
        if sb - sa > 0.04:
            res.append((sa, sb, a, b))
    return res


def layer_runs(faces, z0, z1, depth, skip=(), z_path=0.0, use_proj=False, ret=None):
    """Paths for one moulding layer: [(points, closed, cap0, cap1)] with points at height z_path."""
    ret = depth + 0.012 if ret is None else ret
    items = []
    for k, F in enumerate(faces):
        for sa, sb, a, b in _intervals(F, z0, z1, depth, skip):
            items.append((k, sa, sb, a, b))
    if not items:
        return []
    nf = len(faces)

    def connects(p, q):
        return (p[4] == "corner" and q[3] == "corner" and abs(p[2] - faces[p[0]].L) < 1e-6 and q[1] < 1e-6
                and q[0] == (p[0] + 1) % nf)
    breaks = [i for i in range(len(items)) if not connects(items[i - 1], items[i])]
    closed = not breaks
    order = items if closed else items[breaks[0]:] + items[:breaks[0]]
    groups, cur = [], []
    for i, it in enumerate(order):
        if cur and not connects(cur[-1], it):
            groups.append(cur)
            cur = []
        cur.append(it)
    groups.append(cur)
    out = []
    for g in groups:
        pts = []
        for idx, (k, sa, sb, a, b) in enumerate(g):
            F = faces[k]

            def dz(s, side):
                if not use_proj:
                    return 0.0
                for p0, p1, d in F.proj:
                    if (p0 < s < p1) or (side < 0 and abs(s - p1) < 1e-6) or (side > 0 and abs(s - p0) < 1e-6):
                        return d
                return 0.0
            seq = []
            if idx == 0:
                if a == "return":
                    seq.append(F.p(sa, -ret, z_path))
                elif a == "corner" and not closed:
                    seq.append(F.p(sa - 0.012, dz(sa, 1), z_path))
            seq.append(F.p(sa, dz(sa, 1), z_path))
            if use_proj:
                for p0, p1, d in sorted(F.proj):
                    if sa < p0 < sb:
                        seq += [F.p(p0, 0.0, z_path), F.p(p0, d, z_path)]
                    if sa < p1 < sb:
                        seq += [F.p(p1, d, z_path), F.p(p1, 0.0, z_path)]
            seq.append(F.p(sb, dz(sb, -1), z_path))
            if idx == len(g) - 1:
                if b == "return":
                    seq.append(F.p(sb, -ret, z_path))
                elif b == "corner" and not closed:
                    seq.append(F.p(sb + 0.012, dz(sb, -1), z_path))
            pts += seq
        if closed:
            out.append((pts, True, False, False))
        else:
            out.append((pts, False, g[0][3] == "butt", g[-1][4] == "butt"))
    return out


def sweep_layer(mb, faces, prof, key, z0, depth=None, skip=(), mis=None, use_proj=False, size=None):
    h = max(v for _, v in prof)
    depth = max(u for u, _ in prof) if depth is None else depth
    size = size or tex(key)
    for pts, closed, c0, c1 in layer_runs(faces, z0, z0 + h, depth, skip, z_path=z0, use_proj=use_proj):
        _sweep(mb, prof, pts, ZUP, mis if mis is not None else mb.mi(key), size, closed, c0, c1)


# ---------------------------------------------------------------------------
# Panelled dado (wood or paint)
# ---------------------------------------------------------------------------

BOT_RAIL = 0.27
STILE = 0.09


def _field(mb, F, s0, s1, z0, z1, d_base, mi, size, raised):
    """A panel field in an opening of the frame (s0..s1, z0..z1); raised = fielded with a bevel."""
    def P3(s, d, z):
        return mb.v(F.p(s, d, z))
    e = 0.006
    if not raised or min(s1 - s0, z1 - z0) < 0.16:
        q = [P3(s0 - e, d_base, z0 - e), P3(s1 + e, d_base, z0 - e), P3(s1 + e, d_base, z1 + e), P3(s0 - e, d_base, z1 + e)]
        mb.face(q, [(z0 / size, s0 / size), (z0 / size, s1 / size), (z1 / size, s1 / size), (z1 / size, s0 / size)], mi, F.n3)
        return
    ins = 0.065
    lift = 0.010
    o = [(s0 - e, z0 - e), (s1 + e, z0 - e), (s1 + e, z1 + e), (s0 - e, z1 + e)]
    i = [(s0 + ins, z0 + ins), (s1 - ins, z0 + ins), (s1 - ins, z1 - ins), (s0 + ins, z1 - ins)]
    ov = [P3(s, d_base, z) for s, z in o]
    iv = [P3(s, d_base + lift, z) for s, z in i]

    def uv(pts):
        return [(z / size, s / size) for s, z in pts]
    mb.face(iv, uv(i), mi, F.n3)
    for k in range(4):
        j = (k + 1) % 4
        mb.face([ov[k], ov[j], iv[j], iv[k]], uv([o[k], o[j], i[j], i[k]]), mi, F.n3)


def _panel_mould(mb, F, s0, s1, z0, z1, d_face, mi, size):
    """Mitred ogee mould round the inside of a frame opening (lateral u pointing into the panel)."""
    _rect_sweep(mb, F, s0, s1, z0, z1, d_face, prof_panel_mould(), mi, size, inward=True)


def _rect_sweep(mb, F, s0, s1, z0, z1, d_face, prof, mi, size, inward=True, open_bottom=False):
    """Sweep round a rectangle in the face plane at d_face (U = the face normal); `inward` puts the
    profile's lateral u toward the rectangle's centre. open_bottom: a U (left, top, right) standing on z0."""
    corners = [(s0, z0), (s0, z1), (s1, z1), (s1, z0)]
    path = [F.p(s, d_face, z) for s, z in corners]
    U = F.n3
    d0 = (path[1] - path[0]).normalized()
    lat0 = U.cross(d0)
    centre = F.p((s0 + s1) / 2, d_face, (z0 + z1) / 2)
    want_in = (centre - path[0]).dot(lat0) > 0
    if want_in != inward:
        path.reverse()
        corners.reverse()
    if open_bottom:
        # rotate so the open side (the bottom edge) is between the last and first points
        k = next(i for i in range(4) if abs(corners[i][1] - z0) < 1e-9 and abs(corners[(i + 1) % 4][1] - z0) > 1e-9)
        path = path[k:] + path[:k]
        path[0] = path[0] - ZUP * 0.004
        path[-1] = path[-1] - ZUP * 0.004
        _sweep(mb, prof, path, U, mi, size, closed=False)
    else:
        _sweep(mb, prof, path, U, mi, size, closed=True)


def build_panel_dado(faces, spec, mb_solid, mb_mould):
    top = spec["top"]
    key = spec["wood"]
    size = tex(key)
    mi_s, mi_m = mb_solid.mi(key), mb_mould.mi(key)
    raised = spec["dado"] == "raised"
    cap_h = 0.065
    frame_top = top - cap_h + 0.008
    for F in faces:
        for sa, sb, a, b in _intervals(F, 0.05, top, FR, skip=("window",)):
            # sections: full height, or lowered under a window board
            cuts = [(sa, sb, frame_top)]
            for o in sorted(F.obst, key=lambda o: o.s0):
                if o.kind != "window" or o.z0 > top + 0.03 or o.s1 < sa or o.s0 > sb:
                    continue
                lo_top = o.z0 - 0.006
                new = []
                for c0, c1, ht in cuts:
                    w0, w1 = max(c0, o.s0 - 0.004), min(c1, o.s1 + 0.004)
                    if w1 <= w0:
                        new.append((c0, c1, ht))
                        continue
                    if w0 > c0 + 0.03:
                        new.append((c0, w0, ht))
                    new.append((w0, w1, min(ht, lo_top)))
                    if c1 > w1 + 0.03:
                        new.append((w1, c1, ht))
                cuts = new
            for c0, c1, ht in cuts:
                if ht < 0.42:
                    continue
                _panel_section(mb_solid, mb_mould, F, c0, c1, ht, mi_s, mi_m, size, raised, spec.get("panel_w", 0.7),
                               full=ht >= frame_top - 1e-6)


def _panel_section(mbs, mbm, F, s0, s1, ht, mi_s, mi_m, size, raised, target, full=True):
    L = s1 - s0
    if L < 0.10:
        return
    top_rail = 0.10 if full else 0.075
    if L < STILE * 2 + 0.12:
        _box(mbs, F, s0, s1, 0.0, FR, 0.0, ht, mi_s, size, "z")
        return
    n = max(1, round((L - STILE) / (target + STILE)))
    w = (L - (n + 1) * STILE) / n
    z_f0, z_f1 = BOT_RAIL, ht - top_rail
    _box(mbs, F, s0, s1, 0.0, FR, 0.0, z_f0, mi_s, size, "s")
    _box(mbs, F, s0, s1, 0.0, FR, z_f1, ht, mi_s, size, "s")
    for k in range(n + 1):
        x = s0 + k * (w + STILE)
        _box(mbs, F, x, x + STILE, 0.0, FR, z_f0 - 0.001, z_f1 + 0.001, mi_s, size, "z")
    if z_f1 - z_f0 < 0.06:
        return
    for k in range(n):
        x0 = s0 + STILE + k * (w + STILE)
        x1 = x0 + w
        _field(mbm, F, x0, x1, z_f0, z_f1, FR - 0.012, mi_m, size, raised)
        _panel_mould(mbm, F, x0, x1, z_f0, z_f1, FR, mi_m, size)


# ---------------------------------------------------------------------------
# Generic room dressing
# ---------------------------------------------------------------------------

def _dress_panelled(rid, faces, spec, col):
    mbs, mbm = MB(), MB()
    sk = spec["skirt"]
    sweep_layer(mbm, faces, prof_skirting(), sk, 0.0, depth=FR + 0.020)
    build_panel_dado(faces, spec, mbs, mbm)
    sweep_layer(mbm, faces, prof_cap_rail(), spec["wood"], spec["top"] - 0.065, depth=FR + 0.032)
    if spec.get("rail"):
        sweep_layer(mbm, faces, prof_picture_rail(), spec["rail_key"], spec["rail"])
    ceiling = _room(rid).ceiling_y
    if spec["cornice"] == "wing":
        sweep_layer(mbm, faces, prof_cornice_wing(), "plaster", ceiling - 0.22)
    elif spec["cornice"] == "lounge":
        sweep_layer(mbm, faces, prof_cornice_lounge(), "oak", ceiling - 0.50)
    ob = _finish(mbs, mbm, f"Architecture_Interior_{rid.capitalize()}_Joinery", col, 0.002)
    return [ob] if ob else []


def _slab(mb, x0, y0, x1, y1, z, key, t=0.12, grow=0.10, holes=()):
    """Ceiling slab: room rect grown into the walls, bottom face at z (facing down)."""
    size = tex(key)
    mi = mb.mi(key)
    X0, Y0, X1, Y1 = x0 - grow, y0 - grow, x1 + grow, y1 + grow
    if not holes:
        q = [(X0, Y0), (X1, Y0), (X1, Y1), (X0, Y1)]
        bot = [mb.v((x, y, z)) for x, y in q]
        topv = [mb.v((x, y, z + t)) for x, y in q]
        mb.face(bot, [(x / size, y / size) for x, y in q], mi, -ZUP)
        mb.face(topv, [(x / size, y / size) for x, y in q], mi, ZUP)
        for k in range(4):
            j = (k + 1) % 4
            mb.face([bot[k], bot[j], topv[j], topv[k]], [(0, 0), (1, 0), (1, 1), (0, 1)], mi,
                    Vector((q[j][1] - q[k][1], -(q[j][0] - q[k][0]), 0)))
        return
    # one rectangular hole (the coffer field): four border strips
    hx0, hy0, hx1, hy1 = holes[0]
    for a0, b0, a1, b1 in ((X0, Y0, X1, hy0), (X0, hy1, X1, Y1), (X0, hy0, hx0, hy1), (hx1, hy0, X1, hy1)):
        q = [(a0, b0), (a1, b0), (a1, b1), (a0, b1)]
        mb.face([mb.v((x, y, z)) for x, y in q], [(x / size, y / size) for x, y in q], mi, -ZUP)
        mb.face([mb.v((x, y, z + t)) for x, y in q], [(x / size, y / size) for x, y in q], mi, ZUP)


def _ceiling_panel(mb, rid, inset=0.62):
    """Moulded ogee bead framing the ceiling, inset from the walls (flat ceilings)."""
    x0, y0, x1, y1 = _rect_bl(rid)
    z = _room(rid).ceiling_y
    prof = [(-0.026, 0.0), (-0.026, -0.006), (-0.020, -0.013), (-0.012, -0.019), (-0.004, -0.022), (0.004, -0.022),
            (0.010, -0.019), (0.014, -0.014), (0.018, -0.012), (0.022, -0.008), (0.026, -0.004), (0.028, 0.0)]
    path = [(x0 + inset, y0 + inset, z), (x1 - inset, y0 + inset, z), (x1 - inset, y1 - inset, z), (x0 + inset, y1 - inset, z)]
    _sweep(mb, prof, path, ZUP, mb.mi("plaster"), tex("plaster"), closed=True)


def _paint_walls(rid, key):
    """Repaints the plaster wall faces that face into the room (arch_shell finishes them 'plaster')."""
    x0, y0, x1, y1 = _rect_bl(rid)
    top = _room(rid).ceiling_y
    m_new = mat(key)
    m_old = mat("plaster")
    faces = room_faces(rid)
    n = 0
    for ob in bpy.data.objects:
        if ob.type != "MESH" or ob.get("ovr_wall") is None:
            continue
        me = ob.data
        if m_old.name not in [m.name for m in me.materials if m]:
            continue
        old_i = [i for i, m in enumerate(me.materials) if m == m_old]
        mw = ob.matrix_world
        new_i = None
        for poly in me.polygons:
            if poly.material_index not in old_i:
                continue
            c = mw @ poly.center
            nr = (mw.to_3x3() @ poly.normal).normalized()
            if c.z > top + 0.01:
                continue
            for F in faces:
                if abs(F.d_of(c.x, c.y)) < 0.004 and -0.01 < F.s_of(c.x, c.y) < F.L + 0.01 and nr.dot(F.n3) > 0.9:
                    if new_i is None:
                        if m_new.name not in [m.name for m in me.materials if m]:
                            me.materials.append(m_new)
                        new_i = [i for i, m in enumerate(me.materials) if m == m_new][0]
                    poly.material_index = new_i
                    n += 1
                    break
    return n


# ---------------------------------------------------------------------------
# Lobby
# ---------------------------------------------------------------------------

PIL_HW = 0.28        # pilaster shaft half-width
PIL_P = 0.12         # shaft projection off the wall
PIL_BASE_H = 0.205
PIL_CAP_H = 0.335
PED_STEP = 0.15      # pedestal break-forward of the dado
PED_HW = 0.37


def lobby_pilaster_x():
    door = next(o for w in P.WALLS if w.id == "lobby_s" for o in w.openings if o.id == "door_main")
    win = next(o for w in P.WALLS if w.id == "lobby_s" for o in w.openings if o.id == "window_lobby_e")
    # measured clearances: main door surround half-width 1.74, window boards from 2.685 to 4.515
    xa = (1.74 + (win.at - win.width / 2 - 0.115)) / 2
    xb = (win.at + win.width / 2 + 0.115 + P.LOBBY["maxX"]) / 2
    return [-xb, -xa, xa, xb]


def _pilaster_mesh():
    """Fluted Roman Doric pilaster at the origin (wall face on y = 0, room on -Y): Attic base on the
    dado pedestal, fluted shaft (five flutes with rounded stops), astragal, necking, annulets,
    echinus and a moulded abacus; top at the entablature."""
    me = bpy.data.meshes.get("Architecture_Interior_Lobby_Pilaster")
    if me is not None:
        return me
    F = Face("pil", 0, (0.0, 0.0), (-1.0, 0.0))     # s toward -x, room (n) toward -Y
    F.L = 1.0
    mb = MB()
    mi = mb.mi(STONE)
    size = tex(STONE)
    z0 = DADO_STONE_TOP
    z1 = ENT_Z
    hw, p = PIL_HW, PIL_P
    upath = [F.p(-hw, -0.03), F.p(-hw, p), F.p(hw, p), F.p(hw, -0.03)]

    def at(z):
        return [q + ZUP * z for q in upath]
    lat0 = ZUP.cross((upath[1] - upath[0]).normalized())
    if lat0.dot(F.t3) > 0:          # lateral must point away from the shaft (toward -s at s = -hw)
        upath.reverse()
    # Attic base
    base = [(-0.004, 0.0), (0.070, 0.0), (0.070, 0.060)]
    base += _arc(0.048, 0.085, 0.025, -60, 90, 6)[1:]
    base += [(0.044, 0.112), (0.044, 0.116)]
    base += _arc(0.044, 0.140, 0.020, -90, -180, 5, rv=0.024)[1:]
    base += [(0.026, 0.142), (0.030, 0.146)]
    base += _arc(0.024, 0.162, 0.017, -70, 90, 5)[1:]
    base += [(0.010, 0.180), (0.010, 0.186)]
    base += _arc(0.010, 0.205, 0.010, -90, -180, 3, rv=0.019)[1:]
    base = _clean(base + [(-0.004, PIL_BASE_H)])
    _sweep(mb, base, at(z0), ZUP, mi, size)
    # Capital
    cap = [(-0.004, 0.0), (0.0, 0.0)]
    cap += _arc(0.0, 0.017, 0.017, -90, 90, 6)[1:]
    cap += [(0.004, 0.036), (0.004, 0.042), (0.0, 0.046), (0.0, 0.165), (0.008, 0.168), (0.008, 0.178), (0.015, 0.181),
            (0.015, 0.190)]
    cap += _arc(0.015, 0.250, 0.060, -90, -10, 6, rv=0.060)[1:]
    cap += [(0.076, 0.250), (0.080, 0.254), (0.080, 0.300), (0.084, 0.304)]
    cap += _ogee((0.086, 0.308), (0.094, 0.326), 4, "reversa")
    cap += [(0.094, PIL_CAP_H), (-0.004, PIL_CAP_H)]
    _sweep(mb, _clean(cap), at(z1 - PIL_CAP_H), ZUP, mi, size)
    # Fluted shaft: rings of the plan outline lofted up; flute depth fades in and out (rounded stops)
    zs0, zs1 = z0 + PIL_BASE_H - 0.004, z1 - PIL_CAP_H + 0.004
    nfl, fw, fd, edge = 5, 0.080, 0.024, 0.045
    pitch = (2 * hw - 2 * edge - fw) / (nfl - 1)

    def outline(f):
        pts = [(-hw, -0.02), (-hw, p)]
        for k in range(nfl):
            c = -hw + edge + fw / 2 + k * pitch
            for j in range(9):
                a = math.pi * j / 8
                pts.append((c - fw / 2 * math.cos(a), p - fd * f * math.sin(a)))
        pts += [(hw, p), (hw, -0.02)]
        return pts
    stops = [(zs0, 0.0), (zs0 + 0.10, 0.0), (zs0 + 0.125, 0.55), (zs0 + 0.15, 0.88), (zs0 + 0.17, 1.0),
             (zs1 - 0.17, 1.0), (zs1 - 0.15, 0.88), (zs1 - 0.125, 0.55), (zs1 - 0.10, 0.0), (zs1, 0.0)]
    rings = []
    for z, f in stops:
        rings.append([mb.v(F.p(s, d, z)) for s, d in outline(f)])
    ol = outline(1.0)
    acc = [0.0]
    for a, b in zip(ol, ol[1:]):
        acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    for r in range(len(stops) - 1):
        za, zb = stops[r][0], stops[r + 1][0]
        for k in range(len(ol) - 1):
            ds, dd = ol[k + 1][0] - ol[k][0], ol[k + 1][1] - ol[k][1]
            want = F.t3 * dd - F.n3 * ds
            if abs(ds) < 1e-9 and abs(dd) < 1e-9:
                continue
            q = [rings[r][k], rings[r][k + 1], rings[r + 1][k + 1], rings[r + 1][k]]
            mb.face(q, [(acc[k] / size, za / size), (acc[k + 1] / size, za / size), (acc[k + 1] / size, zb / size),
                        (acc[k] / size, zb / size)], mi, want if want.length > 1e-9 else -F.n3)
    ob = mb.build("Architecture_Interior_Lobby_Pilaster", None, 40.0)
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    return me


def _lobby_landing_archivolt(F, col):
    """Lobby side of the gallery-landing arch: moulded archivolt down to plinth blocks, keystone."""
    o = next(o for w in P.WALLS if w.id == "hall_s" for o in w.openings if o.id == "arch_gallery_landing")
    sc = F.s_of(o.at, F.a.y)
    r = o.width / 2
    spring = o.spring
    y0 = o.y0
    mbm, mbs = MB(), MB()
    key = STONE
    size = tex(key)
    b = 0.17
    plinth_h = 0.26
    pts = [(sc - r, y0 + plinth_h - 0.004), (sc - r, spring)]
    n = 40
    for k in range(1, n):
        a = math.pi * (1 - k / n)
        pts.append((sc + r * math.cos(a), spring + r * math.sin(a)))
    pts += [(sc + r, spring), (sc + r, y0 + plinth_h - 0.004)]
    path = [F.p(s, 0.0, z) for s, z in pts]
    lat0 = F.n3.cross((path[1] - path[0]).normalized())
    if lat0.dot(-F.t3) < 0:
        path.reverse()
    _sweep(mbm, prof_architrave(b, 0.062), path, F.n3, mbm.mi(key), size)
    for sx in (-1, 1):
        s_in = sc + sx * (r - 0.004)
        s_out = sc + sx * (r + b + 0.018)
        _box(mbs, F, min(s_in, s_out), max(s_in, s_out), 0.0, 0.080, y0, y0 + plinth_h, mbs.mi(key), size, "z")
    # keystone: tapered block from inside the intrados to the cornice line
    kz0, kz1 = o.y1 - 0.012, P.LOBBY_CEILING - 0.30
    hb, ht, kd = 0.085, 0.120, 0.105
    ring = [(sc - hb, kz0), (sc + hb, kz0), (sc + ht, kz1), (sc - ht, kz1)]
    front = [mbs.v(F.p(s, kd, z)) for s, z in ring]
    backv = [mbs.v(F.p(s, -0.01, z)) for s, z in ring]
    mi = mbs.mi(key)
    mbs.face(front, [(s / size, z / size) for s, z in ring], mi, F.n3)
    for k in range(4):
        j = (k + 1) % 4
        mid = F.p((ring[k][0] + ring[j][0]) / 2, 0, (ring[k][1] + ring[j][1]) / 2) - F.p(sc, 0, (kz0 + kz1) / 2)
        mbs.face([backv[k], backv[j], front[j], front[k]], [(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)], mi, mid)
    # a raised face panel on the keystone
    _rect_sweep(mbm, F, sc - 0.05, sc + 0.05, kz0 + 0.05, kz1 - 0.05, kd, prof_bolection(0.018, 0.008), mbm.mi(key), size,
                inward=False)
    ob = _finish(mbs, mbm, "Architecture_Interior_Lobby_LandingArchivolt", col)
    return ob


def _lobby_door_heads(faces, col):
    """Walnut entablature heads (frieze + returned cornice) over the side doors' lobby architraves."""
    mbs, mbm = MB(), MB()
    key = "walnut"
    size = tex(key)
    for F in faces:
        for o in F.obst:
            if o.kind != "opening" or not o.oid.startswith("door_lobby"):
                continue
            s0, s1, zt = o.s0, o.s1, o.z1
            _box(mbs, F, s0 + 0.004, s1 - 0.004, 0.0, 0.030, zt - 0.004, zt + 0.17, mbs.mi(key), size, "s")
            # carved roundels on the frieze ends
            cprof = [(E, 0.0), (0.034, 0.0), (0.034, 0.012)]
            cprof += _ogee((0.036, 0.014), (0.056, 0.046), 5, "recta")
            cprof += [(0.060, 0.050), (0.062, 0.054), (0.062, 0.084)]
            cprof += _ogee((0.064, 0.088), (0.082, 0.114), 5, "recta")
            cprof += [(0.082, 0.120), (E, 0.120)]
            path = [F.p(s0 - 0.045, -0.095, zt + 0.17), F.p(s0 - 0.045, 0, zt + 0.17), F.p(s1 + 0.045, 0, zt + 0.17),
                    F.p(s1 + 0.045, -0.095, zt + 0.17)]
            _sweep(mbm, cprof, path, ZUP, mbm.mi(key), size)
            _rect_sweep(mbm, F, s0 + 0.10, s1 - 0.10, zt + 0.035, zt + 0.135, 0.030, prof_bolection(0.020, 0.010),
                        mbm.mi(key), size, inward=False)
    return _finish(mbs, mbm, "Architecture_Interior_Lobby_DoorHeads", col, 0.002)


def _build_lobby(col):
    import arch_ceiling
    import arch_shell
    out = []
    faces = room_faces("lobby")
    walls = {w.id: w for w in P.WALLS}
    # lobby side of the hall arch (arch_shell's surround, its own name) and the landing archivolt
    o = next(o for o in walls["hall_s"].openings if o.id == "arch_lobby")
    sur = arch_shell.build_arch_surround(o, walls["hall_s"], side="hi", name="Architecture_ArchSurround_ArchLobby_LobbySide",
                                         col=col)
    EXTRA[("lobby", "arch_lobby")] = [sur]
    out.append(sur)
    Fn = next(F for F in faces if abs(F.t3.x + 1) < 1e-6)
    arv = _lobby_landing_archivolt(Fn, col)
    EXTRA[("lobby", "arch_gallery_landing")] = [arv]
    out.append(arv)
    for F in faces:
        F.obst = gather_obstacles(F)
    # pilasters on the entrance wall, on pedestals of the dado
    Fs = next(F for F in faces if abs(F.t3.x - 1) < 1e-6)
    xs = lobby_pilaster_x()
    Fs.proj = [(Fs.s_of(x, Fs.a.y) - PED_HW, Fs.s_of(x, Fs.a.y) + PED_HW, PED_STEP) for x in xs]
    me = _pilaster_mesh()
    pcol = C.collection("Interior_Lobby_Pilasters", col)
    for k, x in enumerate(xs):
        ob = bpy.data.objects.new(f"Architecture_Interior_Lobby_Pilaster_{k + 1:02d}", me)
        C.link(ob, pcol)
        ob.location = Fs.p(Fs.s_of(x, Fs.a.y), 0.0, 0.0)
        ob.rotation_euler = (0, 0, Fs.rot())
        out.append(ob)
    mbs, mbm = MB(), MB()
    # dado: plinth + die + cap in one profile, stepping round the pedestals
    sweep_layer(mbm, faces, prof_dado_stone(), STONE, 0.0, depth=0.092, skip=("window",), use_proj=True)
    # bolection-moulded panels on the die (between pedestals and openings) and on the pedestal fronts
    for F in faces:
        for sa, sb, a, b in _intervals(F, 0.05, DADO_STONE_TOP, 0.092, skip=("window",)):
            if a == "return":
                sa -= 0.092
            if b == "return":
                sb += 0.092
            bays, cur = [], sa
            for p0, p1, d in sorted(F.proj):
                if p1 <= sa or p0 >= sb:
                    continue
                bays.append((cur, p0))
                cur = p1
            bays.append((cur, sb))
            for c0, c1 in bays:
                L = c1 - c0 - 0.30
                if L < 0.35:
                    continue
                n = max(1, round(L / 1.6))
                gap = 0.20
                w = (L - (n - 1) * gap) / n
                for k in range(n):
                    x0 = c0 + 0.15 + k * (w + gap)
                    _rect_sweep(mbm, F, x0, x0 + w, 0.33, 0.77, 0.035, prof_bolection(), mbm.mi(STONE), tex(STONE), inward=False)
            for p0, p1, d in F.proj:
                if sa <= p0 and p1 <= sb:
                    _rect_sweep(mbm, F, p0 + 0.10, p1 - 0.10, 0.34, 0.76, 0.035 + d, prof_bolection(0.045, 0.016),
                                mbm.mi(STONE), tex(STONE), inward=False)
    # entablature + dentils
    runs = layer_runs(faces, ENT_Z, ENT_Z + ENT_H, 0.37, z_path=ENT_Z)
    eprof = prof_entablature()
    for pts, closed, c0, c1 in runs:
        _sweep(mbm, eprof, pts, ZUP, mbm.mi(STONE), tex(STONE), closed, c0, c1)
    v0, v1, dband = DENTIL_BAND
    pitch, dw, dd = 0.090, 0.056, 0.032
    mi = mbm.mi(STONE)
    for F in faces:
        for sa, sb, a, b in _intervals(F, ENT_Z, ENT_Z + ENT_H, 0.37):
            lo = sa + (0.30 if a == "corner" else 0.02)
            hi = sb - (0.30 if b == "corner" else 0.02)
            n = int((hi - lo) / pitch)
            if n < 1:
                continue
            off = lo + ((hi - lo) - (n * pitch - (pitch - dw))) / 2
            for k in range(n):
                x = off + k * pitch
                _box(mbm, F, x, x + dw, dband - 0.004, dband + dd, ENT_Z + v0 + 0.002, ENT_Z + v1, mi, tex(STONE), "s",
                     bottom=True, top=False)
    ob = _finish(mbs, mbm, "Architecture_Interior_Lobby_Stonework", col)
    out.append(ob)
    heads = _lobby_door_heads(faces, col)
    if heads:
        out.append(heads)
    out += arch_ceiling.build_lobby_ceiling()
    return out


# ---------------------------------------------------------------------------
# Lounge
# ---------------------------------------------------------------------------

FP_HW, FP_H, SHELF_HW, SHELF_TOP, HEARTH_HW = 1.16, 1.32, 1.30, 1.43, 1.245
RECESS_HW, RECESS_TOP = 0.80, 2.48
BREAST_PANEL = (1.22, 2.84, 4.16)     # half-width, bottom, top of the plaster panel over the overmantel


def _breast_faces(faces):
    _, yc = _breast()
    x0 = _rect_bl("lounge")[0]
    front = next(F for F in faces if abs(F.a.x - (x0 + BREAST_D)) < 1e-6 and abs(F.t3.y + 1) < 1e-6)
    return front, front.s_of(x0 + BREAST_D, yc)


def _lounge_breast(faces, col):
    """Plaster chimney breast round the fireplace, floor to ceiling, with the overmantel recess (the
    fireplace's mirror hangs on the wall at its back) in a walnut bolection frame standing on the shelf."""
    front, sc = _breast_faces(faces)
    mbp, mbm = MB(), MB()
    key = "plaster"
    size = tex(key)
    mi = mbp.mi(key)
    top = P.LOUNGE_CEILING + 0.05
    ss = [sc - BREAST_HW, sc - FP_HW + 0.02, sc - RECESS_HW, sc + RECESS_HW, sc + FP_HW - 0.02, sc + BREAST_HW]
    zs = [0.0, FP_H - 0.02, SHELF_TOP, RECESS_TOP, top]
    for i in range(len(ss) - 1):
        for j in range(len(zs) - 1):
            sm, zm = (ss[i] + ss[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if abs(sm - sc) < FP_HW and zm < FP_H:
                continue
            if abs(sm - sc) < RECESS_HW and SHELF_TOP < zm < RECESS_TOP:
                continue
            q = [(ss[i], zs[j]), (ss[i + 1], zs[j]), (ss[i + 1], zs[j + 1]), (ss[i], zs[j + 1])]
            mbp.face([mbp.v(front.p(s, 0.0, z)) for s, z in q], [(s / size, z / size) for s, z in q], mi, front.n3)
    # recess reveals (sides and head); its floor is the mantel shelf, its back the wall
    for s_, want in ((sc - RECESS_HW, front.t3), (sc + RECESS_HW, -front.t3)):
        q = [(s_, 0.0, SHELF_TOP - 0.03), (s_, -BREAST_D - 0.01, SHELF_TOP - 0.03), (s_, -BREAST_D - 0.01, RECESS_TOP),
             (s_, 0.0, RECESS_TOP)]
        mbp.face([mbp.v(front.p(s, d, z)) for s, d, z in q], [(d / size, z / size) for s, d, z in q], mi, want)
    q = [(sc - RECESS_HW, 0.0), (sc + RECESS_HW, 0.0), (sc + RECESS_HW, -BREAST_D - 0.01), (sc - RECESS_HW, -BREAST_D - 0.01)]
    mbp.face([mbp.v(front.p(s, d, RECESS_TOP)) for s, d in q], [(s / size, d / size) for s, d in q], mi, -ZUP)
    # breast sides
    for F in faces:
        if F.L < BREAST_D + 0.01 and abs(F.L - BREAST_D) < 1e-6:
            q = [(0.0, 0.0), (F.L, 0.0), (F.L, top), (0.0, top)]
            mbp.face([mbp.v(F.p(s, 0.0, z)) for s, z in q], [(s / size, z / size) for s, z in q], mi, F.n3)
    # walnut bolection frame round the recess, its feet on the shelf
    bprof = [(0.085, -0.004), (0.085, 0.010)]
    bprof += _ogee((0.083, 0.014), (0.050, 0.044), 6, "recta")
    bprof += [(0.044, 0.048), (0.030, 0.048)]
    bprof += _arc(0.030, 0.036, 0.012, 90, 180, 3)[1:]
    bprof += [(0.010, 0.030), (0.004, 0.018), (-0.004, 0.006), (-0.004, -0.004)]
    _rect_sweep(mbm, front, sc - RECESS_HW, sc + RECESS_HW, SHELF_TOP - 0.004, RECESS_TOP, 0.0, bprof, mbm.mi("walnut"),
                tex("walnut"), inward=False, open_bottom=True)
    # a fielded plaster panel on the upper breast, centred over the overmantel, under the picture rail
    _rect_sweep(mbm, front, sc - BREAST_PANEL[0], sc + BREAST_PANEL[0], BREAST_PANEL[1], BREAST_PANEL[2], 0.0,
                prof_bolection(0.070, 0.024), mbm.mi(key), size, inward=False)
    _rect_sweep(mbm, front, sc - BREAST_PANEL[0] + 0.11, sc + BREAST_PANEL[0] - 0.11, BREAST_PANEL[1] + 0.11,
                BREAST_PANEL[2] - 0.11, 0.0, prof_panel_mould(), mbm.mi(key), size, inward=True)
    p = mbp.build("Architecture_Interior_Lounge_ChimneyBreast", col, 30.0)
    m = mbm.build("Architecture_Interior_Lounge_OvermantelFrame", col, 38.0)
    return C.join([p, m], "Architecture_Interior_Lounge_ChimneyBreast")


def _beam_prof(B, H, flare, ov):
    pts = []
    pts += _arc(-B - flare, -flare, flare, 90, 0, 4)
    pts += [(-B, -H + ov + 0.004)]
    pts += _arc(-B + ov, -H + ov + 0.004, ov, 180, 270, 5)[1:]
    pts += [(-B + ov + 0.006, -H + 0.004 + 0.0), (-B + ov + 0.006, -H)]
    right = [(-u, v) for u, v in reversed(pts)]
    return _clean(pts + right)


def _lounge_ceiling(faces, col):
    """Beamed oak ceiling: plaster ceiling at 5.8, three moulded principals across the room (east-west,
    the middle one on the fireplace axis, landing on the breast), moulded cross ribs between them."""
    x0, y0, x1, y1 = _rect_bl("lounge")
    z = P.LOUNGE_CEILING
    mbw, mbp = MB(), MB()
    _slab(mbp, x0, y0, x1, y1, z, "plaster")
    key = "oak"
    size = tex(key)
    _, yc = _breast()
    beams = [yc + 2.7, yc, yc - 2.7]
    pB, pH = 0.14, 0.38
    main = _beam_prof(pB, pH, 0.040, 0.030)
    rib = _beam_prof(0.065, 0.17, 0.024, 0.018)
    for yb in beams:
        xs = x0 + (BREAST_D if abs(yb - yc) < 1e-6 else 0.0) - 0.02
        _sweep(mbw, main, [(xs, yb, z), (x1 + 0.02, yb, z)], ZUP, mbw.mi(key), size, cap0=False, cap1=False)
    n_ribs = 4
    rx = [x0 + (x1 - x0) * (k + 1) / n_ribs for k in range(n_ribs - 1)]
    edges = [y0] + sorted(beams) + [y1]
    for a, b in zip(edges, edges[1:]):
        ya = a + (pB - 0.02 if a != y0 else -0.02)
        yb = b - (pB - 0.02 if b != y1 else -0.02)
        for x in rx:
            _sweep(mbw, rib, [(x, ya, z), (x, yb, z)], ZUP, mbw.mi(key), size)
    w = mbw.build("Architecture_Interior_Lounge_Beams", col, 40.0)
    p = mbp.build("Architecture_Interior_Lounge_Ceiling", col, 30.0)
    return [p, w]


def _build_lounge(col):
    import arch_shell
    out = []
    faces = room_faces("lounge")
    walls = {w.id: w for w in P.WALLS}
    o = next(o for o in walls["hall_w"].openings if o.id == "arch_lounge")
    sur = arch_shell.build_arch_surround(o, walls["hall_w"], side="lo", name="Architecture_ArchSurround_ArchLounge_LoungeSide",
                                         col=col)
    EXTRA[("lounge", "arch_lounge")] = [sur]
    out.append(sur)
    for F in faces:
        F.obst = gather_obstacles(F)
    front, sc = _breast_faces(faces)
    front.obst += [Ob(sc - FP_HW, sc + FP_HW, 0.0, SHELF_TOP, 0.50, "solid", "lounge-fireplace"),
                   Ob(sc - SHELF_HW, sc + SHELF_HW, FP_H, SHELF_TOP + 0.02, 0.50, "solid", "lounge-fireplace-shelf"),
                   Ob(sc - HEARTH_HW, sc + HEARTH_HW, 0.0, 0.045, 0.75, "solid", "lounge-hearth"),
                   Ob(sc - RECESS_HW - 0.09, sc + RECESS_HW + 0.09, SHELF_TOP, RECESS_TOP + 0.09, 0.05, "opening", "overmantel")]
    out.append(_lounge_breast(faces, col))
    out += _dress_panelled("lounge", faces, SPEC["lounge"], col)
    out += _lounge_ceiling(faces, col)
    return out


# ---------------------------------------------------------------------------
# Wings
# ---------------------------------------------------------------------------

def _quiet_ceiling(col):
    import arch_ceiling
    x0, y0, x1, y1 = _rect_bl("quiet")
    q = QUIET_COFFER
    objs = arch_ceiling.build_coffered_ceiling(P.QUIET, P.WING_CEILING, coffer=q["coffer"], beam_every=0, name="Quiet",
                                               style="flat", margin=q["margin"], cove=False, frame="plaster",
                                               panels=("plaster",), accent="ivory_paint", rosettes=False,
                                               recess=q["recess"], col=col)
    mb = MB()
    m = q["margin"]
    _slab(mb, x0, y0, x1, y1, P.WING_CEILING, "plaster", holes=[(x0 + m, y0 + m, x1 - m, y1 - m)])
    # a bead round the coffer field
    prof = [(-0.03, 0.0), (-0.03, -0.008)] + _arc(-0.012, -0.008, 0.018, 180, 270, 4)[1:] + [(0.0, -0.026), (0.004, -0.02),
                                                                                              (0.006, 0.0)]
    path = [(x0 + m - 0.03, y0 + m - 0.03, P.WING_CEILING), (x1 - m + 0.03, y0 + m - 0.03, P.WING_CEILING),
            (x1 - m + 0.03, y1 - m + 0.03, P.WING_CEILING), (x0 + m - 0.03, y1 - m + 0.03, P.WING_CEILING)]
    _sweep(mb, _clean(prof), path, ZUP, mb.mi("plaster"), tex("plaster"), closed=True)
    objs.append(mb.build("Architecture_Interior_Quiet_CeilingBorder", col, 35.0))
    return objs


def quiet_coffer_centres():
    import arch_ceiling
    x0, y0, x1, y1 = _rect_bl("quiet")
    q = QUIET_COFFER
    px, py, cols, rows, _ = arch_ceiling._layout((x0, y0, x1, y1), q["coffer"], 0, q["margin"], 0.6)
    return px, py, cols, rows


def _flat_ceiling(rid, col):
    x0, y0, x1, y1 = _rect_bl(rid)
    mb = MB()
    _slab(mb, x0, y0, x1, y1, _room(rid).ceiling_y, "plaster")
    _ceiling_panel(mb, rid)
    return [mb.build(f"Architecture_Interior_{rid.capitalize()}_Ceiling", col, 35.0)]


def _storage_door_architrave(faces, col):
    """Computers side of the storage door: walnut architrave with plinth blocks (arch_windows dresses
    only its services face)."""
    w = next(w for w in P.WALLS if w.id == "north_partition")
    o = next(o for o in w.openings if o.id == "door_storage")
    F = next((F for F in faces if abs(F.a.x - w.bounds["minX"]) < 1e-6 and abs(F.t3.y) > 0.5), None)
    if F is None:
        return None
    mbm, mbs = MB(), MB()
    key = "walnut"
    size = tex(key)
    sc = F.s_of(F.a.x, -o.at)
    hw = o.width / 2 - 0.02
    H = o.y1 - 0.02
    path = [F.p(sc - hw, 0.0, 0.218), F.p(sc - hw, 0.0, H), F.p(sc + hw, 0.0, H), F.p(sc + hw, 0.0, 0.218)]
    lat0 = F.n3.cross((path[1] - path[0]).normalized())
    if lat0.dot(-F.t3) < 0:
        path.reverse()
    _sweep(mbm, prof_architrave(), path, F.n3, mbm.mi(key), size)
    for sx in (-1, 1):
        a, b = sc + sx * (hw - 0.002), sc + sx * (hw + 0.162)
        _box(mbs, F, min(a, b), max(a, b), 0.0, 0.042, 0.0, 0.22, mbs.mi(key), size, "z")
    ob = _finish(mbs, mbm, "Architecture_Interior_Computers_StorageArchitrave", col, 0.002)
    EXTRA[("computers", "door_storage")] = [ob]
    return ob


def _build_wing(rid, col):
    out = []
    faces = room_faces(rid)
    if rid == "computers":
        ob = _storage_door_architrave(faces, col)
        if ob:
            out.append(ob)
    for F in faces:
        F.obst = gather_obstacles(F)
    spec = SPEC[rid]
    out += _dress_panelled(rid, faces, spec, col)
    if spec.get("wall"):
        _paint_walls(rid, spec["wall"])
    if spec["ceiling"] == "coffers":
        out += _quiet_ceiling(col)
    else:
        out += _flat_ceiling(rid, col)
    return out


# ---------------------------------------------------------------------------
# Pendant light
# ---------------------------------------------------------------------------

def _lathe_into(mb, prof, seg, key, z_off=0.0, flip=False, size=0.4):
    mi = mb.mi(key)
    rings = []
    for r, z in prof:
        rings.append([mb.v((r * math.cos(math.tau * i / seg), r * math.sin(math.tau * i / seg), z + z_off)) for i in range(seg)])
    acc = [0.0]
    for a, b in zip(prof, prof[1:]):
        acc.append(acc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    for k in range(len(prof) - 1):
        (r0, z0), (r1, z1) = prof[k], prof[k + 1]
        nr, nz = (z1 - z0), -(r1 - r0)       # outward normal of a profile traced bottom -> top
        if flip:
            nr, nz = -nr, -nz
        for i in range(seg):
            j = (i + 1) % seg
            a = math.tau * (i + 0.5) / seg
            want = Vector((math.cos(a) * nr, math.sin(a) * nr, nz))
            mb.face([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]],
                    [(i / seg * 2, acc[k] / size), ((i + 1) / seg * 2, acc[k] / size), ((i + 1) / seg * 2, acc[k + 1] / size),
                     (i / seg * 2, acc[k + 1] / size)], mi, want if want.length > 1e-9 else Vector((0, 0, nz or 1)))
    return rings


def build_pendant_light(drop=0.90, name="Light_Pendant_01", color="#ffe4c2", rose=True):
    """Period pendant: plaster ceiling rose, brass canopy and swivel, a rod, a brass gallery (two
    beaded rings joined by sixteen balusters) holding an opal glass globe. The globe bottom is at
    z = 0 and the ceiling contact at z = drop. The globe is a shadowless child so a light placed at
    light_points (the bulb) lights the room. Returns the root object."""
    mb = MB()
    H = drop
    seg = 32
    # globe (opal): child object
    g = MB()
    gR, gt1 = 0.152, 64.0
    gp = [(gR * math.cos(math.radians(t)), gR + gR * math.sin(math.radians(t)))
          for t in np.linspace(-90.0, gt1, 27)]
    gp[0] = (0.0, 0.0)
    gp += [(0.064, 0.296), (0.068, 0.302), (0.068, 0.312)]
    _lathe_into(g, gp, 56, "glass_frosted")
    # bulb (split off by the scene's lamp lighting, emits)
    _lathe_into(mb, [(0.0, 0.112), (0.020, 0.118), (0.030, 0.136), (0.030, 0.158), (0.022, 0.178), (0.012, 0.190),
                     (0.010, 0.215), (0.0, 0.216)], 16, "bulb")
    # gallery: lower collar, two rings, balusters, cap and cone to the rod
    _lathe_into(mb, [(0.064, 0.292), (0.074, 0.292), (0.078, 0.298), (0.078, 0.306), (0.074, 0.310), (0.072, 0.312)], seg,
                "brass")
    for zr in (0.302, 0.352):
        rr = 0.080
        prof = _arc(rr, zr, 0.0055, -90, 270, 8)
        rings = []
        for r, z in prof:
            rings.append(r)
        _lathe_into(mb, [(rr + 0.0055 * math.cos(math.radians(a)), zr + 0.0055 * math.sin(math.radians(a)))
                         for a in range(-90, 271, 60)], seg, "brass")
    for k in range(12):
        a = math.tau * k / 12
        cx, cy = 0.080 * math.cos(a), 0.080 * math.sin(a)
        bal = [(0.0, 0.306), (0.004, 0.307), (0.0045, 0.314), (0.0035, 0.322), (0.0055, 0.328), (0.0035, 0.336),
               (0.0045, 0.344), (0.004, 0.348), (0.0, 0.349)]
        mi = mb.mi("brass")
        base = len(mb.co)
        rings = _lathe_into(mb, bal, 6, "brass")
        for idx in range(base, len(mb.co)):
            x, y, z = mb.co[idx]
            mb.co[idx] = (x + cx, y + cy, z)
    _lathe_into(mb, [(0.074, 0.356), (0.074, 0.362), (0.060, 0.372), (0.040, 0.384), (0.026, 0.396), (0.020, 0.404),
                     (0.016, 0.412), (0.016, 0.420), (0.012, 0.424)], seg, "brass")
    # knop, rod, swivel ball, canopy
    _lathe_into(mb, [(0.012, 0.420), (0.017, 0.426), (0.019, 0.436), (0.016, 0.446), (0.009, 0.452)], 24, "brass")
    _lathe_into(mb, [(0.0085, 0.450), (0.0085, H - 0.105)], 16, "brass")
    _lathe_into(mb, [(0.0085, H - 0.106), (0.013, H - 0.100), (0.016, H - 0.090), (0.014, H - 0.080), (0.009, H - 0.074),
                     (0.009, H - 0.064)], 24, "brass")
    _lathe_into(mb, [(0.009, H - 0.066), (0.016, H - 0.064), (0.040, H - 0.054), (0.060, H - 0.036), (0.070, H - 0.018),
                     (0.072, H - 0.008), (0.074, H - 0.004), (0.074, H)], seg, "brass")
    if rose:
        rp = [(0.074, H - 0.004), (0.082, H - 0.006), (0.090, H - 0.016), (0.098, H - 0.022), (0.110, H - 0.022),
              (0.118, H - 0.018), (0.124, H - 0.014), (0.136, H - 0.020), (0.150, H - 0.024), (0.168, H - 0.022),
              (0.184, H - 0.014), (0.196, H - 0.012), (0.206, H - 0.016), (0.214, H - 0.014), (0.222, H - 0.008),
              (0.228, H - 0.002), (0.232, H)]
        _lathe_into(mb, rp, 48, "plaster", flip=False)
    root = mb.build(name, None, 50.0)
    globe = g.build(name + "_Globe", None, 60.0)
    globe.parent = root
    globe.visible_shadow = False
    root["light_points"] = [[0.0, 0.0, 0.150]]
    root["light_color"] = _hex_lin(color)
    root["light_kind"] = "pendant"
    return root


def hang_pendants(col):
    """A pendant at every plan.LIGHTS entry of kind 'ceiling' (quiet ones in their coffer centres)."""
    out = []
    protos = {}
    px, py, cols, rows = quiet_coffer_centres()
    q = QUIET_COFFER
    for L in P.LIGHTS:
        if L["kind"] != "ceiling":
            continue
        x, y = L["x"], -L["z"]
        rid = next(r.id for r in P.ROOMS if r.shape == "rect" and r.bounds["minX"] <= L["x"] <= r.bounds["maxX"]
                   and r.bounds["minZ"] <= L["z"] <= r.bounds["maxZ"])
        top = _room(rid).ceiling_y
        if rid == "quiet":
            cx = min(cols, key=lambda c: abs(c - x))
            cy = min(rows, key=lambda c: abs(c - y))
            if abs(cx - x) < 0.25 and abs(cy - y) < 0.25:
                x, y, top = cx, cy, top + q["recess"]
        drop = round(top - PENDANT_BOTTOM, 4)
        key = drop
        name = f"Light_Pendant_{L['id'].capitalize()}"
        if key not in protos:
            ob = build_pendant_light(drop, name, L["color"])
            protos[key] = ob
        else:
            src = protos[key]
            ob = C.instance(src, name)
            for k in ("light_points", "light_kind"):
                ob[k] = src[k]
            gl = C.instance(src.children[0], name + "_Globe")
            gl.parent = ob
            gl.visible_shadow = False
        ob["light_color"] = _hex_lin(L["color"])
        C.move_to(ob, col)
        for ch in ob.children:
            C.move_to(ch, col)
        ob.location = (x, y, PENDANT_BOTTOM)
        out.append(ob)
    return out


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def build_room(room_id):
    """Dresses one room in place; returns its objects (collection ARCHITECTURE/Interiors/Interior_<Room>)."""
    bpy.context.view_layer.update()
    col = _col(room_id)
    if room_id == "lobby":
        objs = _build_lobby(col)
    elif room_id == "lounge":
        objs = _build_lounge(col)
    else:
        objs = _build_wing(room_id, col)
    return [o for o in objs if o is not None]


def build_interiors():
    """Every room outside the hall, plus the pendants. Returns {room_id: [objects]}."""
    out = {}
    for rid in ROOM_IDS:
        out[rid] = build_room(rid)
    out["pendants"] = hang_pendants(_col("pendants"))
    return out


def tri_report(built):
    rep = {}
    for rid, objs in built.items():
        seen, total, inst = set(), 0, 0
        for o in objs:
            for x in [o] + list(o.children_recursive):
                if x.type != "MESH":
                    continue
                if x.data.name in seen:
                    inst += 1
                    continue
                seen.add(x.data.name)
                total += C.tris(x)
        rep[rid] = (total, inst)
        print(f"TRIS {rid}: {total} unique (+{inst} linked instances)")
    return rep


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _context():
    """Preview-only context: every plan wall with its windows and doors, floors, roof lids, the landing,
    stair stand-ins, the lounge fireplace, bookcase stand-ins and the lobby lantern."""
    import arch_shell
    import arch_windows
    import scene_milestone as SM
    for w in P.WALLS:
        arch_shell.build_wall(w)
    cache = {}
    for w in P.WALLS:
        for o in w.openings:
            ob, h = arch_windows.build_for_opening(o, w, cache=cache)
            if ob is not None:
                arch_windows.place_in_wall(ob, w, o, h)
    SM.build_floors()
    col = C.collection("PREVIEW_CONTEXT")
    for r in P.ROOMS:
        if r.shape != "rect":
            continue
        x0, y0, x1, y1 = _rect_bl(r.id)
        top = r.ceiling_y + (0.6 if r.id != "hall" else 1.0)
        C.box_minmax(f"PV_Lid_{r.id}", (x0 - 0.8, y0 - 0.8, top), (x1 + 0.8, y1 + 0.8, top + 0.3), mat("plaster"), col=col)
    try:
        import arch_gallery
        arch_gallery.build_landing()
    except Exception as e:  # noqa: BLE001
        print("landing unavailable", e)
    try:
        import arch_stairs
        arch_stairs.build_stairs()
    except Exception as e:  # noqa: BLE001
        print("stairs unavailable", e)
        for fl in P.FLIGHTS:
            b = fl["bounds"]
            run = (b["maxZ"] - b["minZ"]) / P.STAIR_RISERS
            for k in range(P.STAIR_RISERS):
                za = b["maxZ"] - (k + 1) * run
                C.box_minmax(f"PV_Step_{fl['id']}_{k:02d}", (b["minX"], -(za + run), 0.0),
                             (b["maxX"], -za, (k + 1) * P.GALLERY_Y / P.STAIR_RISERS), mat("walnut"), col=col)
    try:
        import furn_study
        src = None
        for it in P.ITEMS:
            if it.kind != "carrel":
                continue
            if src is None:
                src = furn_study.KIND_BUILDERS["carrel"](it)
                ob = src
            else:
                ob = C.instance(src, f"PV_Carrel_{it.id}", col=col)
            C.place(ob, it.x, it.y, it.z, it.rot)
    except Exception as e:  # noqa: BLE001
        print("carrels unavailable", e)
    try:
        import room_lounge
        it = next(i for i in P.ITEMS if i.kind == "fireplace")
        fp = room_lounge.build_fireplace(it)
        C.place(fp, it.x, it.y, it.z, it.rot)
    except Exception as e:  # noqa: BLE001
        print("fireplace unavailable", e)
    for bc in P.BOOKCASES:
        (ax, az), (bx, bz) = bc["a"], bc["b"]
        if bc["style"] not in ("lounge", "wing"):
            continue
        dep = bc["depth"]
        fx, fz = round(math.sin(bc["rot"]), 6), round(math.cos(bc["rot"]), 6)
        xs = (ax, bx, ax + fx * dep, bx + fx * dep)
        zs = (az, bz, az + fz * dep, bz + fz * dep)
        C.box_minmax(f"PV_{bc['id']}", (min(xs), -max(zs), bc["y"]), (max(xs), -min(zs), bc["y"] + bc["height"]),
                     mat("walnut_dark"), bevel_w=0.01, col=col)
    try:
        import light_chandelier
        lan = next(L for L in P.LIGHTS if L["id"] == "lobby_lantern")
        bottom = lan["y"] - 0.8
        ln = light_chandelier.build_lantern_pendant(drop=P.LOBBY_CEILING - bottom - 1.66, name="Light_Lantern_Lobby")
        ln.location = C.bl(lan["x"], bottom, lan["z"])
    except Exception as e:  # noqa: BLE001
        print("lantern unavailable", e)


SHOTS = {
    "lobby": dict(loc=(0.0, 1.62, 19.5), at=(0.0, 3.4, 9.0), lens=17),
    "lobby_south": dict(loc=(0.0, 1.62, 11.6), at=(0.0, 3.6, 20.0), lens=17),
    "lobby_pilaster": dict(loc=(-0.9, 1.25, 18.0), at=(-2.6, 1.1, 20.0), lens=24),
    "lobby_capital": dict(loc=(-0.4, 4.6, 16.4), at=(-2.21, 6.9, 20.0), lens=30),
    "lobby_landing": dict(loc=(0.0, 3.0, 17.0), at=(0.0, 6.4, 8.8), lens=26),
    "lounge": dict(loc=(-15.4, 1.6, 3.9), at=(-23.2, 1.6, -1.6), lens=17),
    "lounge_breast": dict(loc=(-18.0, 1.55, -1.0), at=(-23.4, 2.2, -1.0), lens=22),
    "lounge_beams": dict(loc=(-15.6, 1.5, -5.6), at=(-21.0, 5.2, 0.4), lens=18),
    "quiet": dict(loc=(-6.9, 1.6, 9.4), at=(-17.0, 1.6, 17.5), lens=17),
    "group": dict(loc=(6.9, 1.6, 9.4), at=(17.0, 1.6, 17.5), lens=17),
    "computers": dict(loc=(2.3, 1.6, -11.2), at=(-12.5, 1.4, -15.6), lens=17),
    "services": dict(loc=(3.7, 1.6, -11.2), at=(13.5, 1.4, -15.6), lens=18),
    "pendant": dict(loc=(13.1, 3.0, 13.4), at=(12.0, 3.85, 12.2), lens=40),
}


def _lights(scene, built):
    import scene_milestone as SM
    R.sun("Sun", direction_web=SM.SUN_DIR, strength=4.0, color=(1.0, 0.9, 0.76), angle_deg=1.0)
    R.sky_world(scene, strength=2.2, tint=(0.58, 0.72, 0.95))
    for o in built.get("pendants", []):
        p = o.matrix_world @ Vector(o["light_points"][0])
        L = R.point_light(f"{o.name}_L", p, 70.0, tuple(o["light_color"]), 0.04)
    fills = {"lobby": (0.0, 7.0, 14.5, 900, 8.0), "lounge": (-19.2, 5.2, -1.0, 260, 4.0), "quiet": (-12.15, 4.0, 14.4, 300, 6.0),
             "group": (12.15, 4.0, 14.4, 160, 5.0), "computers": (-5.6, 4.0, -13.5, 160, 6.0),
             "services": (8.5, 4.0, -13.5, 90, 4.0)}
    for rid, (x, y, z, w, s) in fills.items():
        light = bpy.data.lights.new(f"Fill_{rid}", "AREA")
        light.energy = w
        light.size = s
        light.color = (1.0, 0.9, 0.78)
        ob = bpy.data.objects.new(f"Fill_{rid}", light)
        scene.collection.objects.link(ob)
        ob.location = C.bl(x, y, z)
    it = next(i for i in P.ITEMS if i.kind == "fireplace")
    R.point_light("Fire", C.bl(it.x + 0.25, 0.4, it.z), 160.0, (1.0, 0.55, 0.25), 0.15)
    lan = next(L for L in P.LIGHTS if L["id"] == "lobby_lantern")
    R.point_light("Lantern", C.bl(lan["x"], lan["y"] - 0.1, lan["z"]), 260.0, (1.0, 0.8, 0.55), 0.12)


def preview(out_dir):
    import time
    t0 = time.time()
    _context()
    print(f"context {time.time() - t0:.1f}s")
    built = build_interiors()
    print(f"interiors {time.time() - t0:.1f}s")
    tri_report(built)
    scene = bpy.context.scene
    size = tuple(int(v) for v in os.environ.get("AI_SIZE", "960x600").split("x"))
    R.engine(scene, "CYCLES", int(os.environ.get("AI_SAMPLES", "32")), size)
    scene.cycles.max_bounces = 6
    scene.view_settings.exposure = float(os.environ.get("AI_EXPOSURE", "0.4"))
    _lights(scene, built)
    cam = R.camera(lens=20)
    shots = os.environ.get("AI_SHOTS", ",".join(SHOTS)).split(",")
    for name in shots:
        s = SHOTS[name]
        cam.data.lens = s["lens"]
        R.look(cam, C.bl(*s["loc"]), C.bl(*s["at"]))
        R.render(os.path.join(out_dir, f"{name}.png"))
        print(f"render {name} {time.time() - t0:.1f}s")
