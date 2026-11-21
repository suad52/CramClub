"""
Reference Rotunda architecture (Ref 3: a domed rotunda with a glass roof and oculi; Ref 5: a
curved, multi-tier rotunda with slender columns), in the Grand Reading Hall's limestone / walnut /
gilt language.

Everything is built IN PLACE from plan data (plan.ROTUNDA, ROTUNDA_BAYS, ROTUNDA_C, LIFT, HALL;
web coordinates converted with the lib_core convention web (x, y, z) -> Blender (x, -z, y)) into
the collection ARCHITECTURE/Rotunda. Bay k faces the direction k * 30 deg from web +X toward web +Z;
its wall is straight, 4.50 m wide at the inner face (apothem 8.4) and 0.8 m thick outward.

    build_rotunda() -> [objects]      the whole rotunda (scene_library calls this)
    column_points()                   the 12 ground-tier column axes (for colliders, see below)
    preview(out_dir)                  Cycles renders of the rotunda with its real bookcases

Elevation (metres above the rotunda floor):

    0.00 - 4.30   GROUND TIER. Twelve slender walnut Corinthian columns (arch_gallery's arcade
                  column, r 0.17, abacus 4.30) stand 0.85 m in front of the polygon corners on the
                  corner bisectors, clear of the bookcase plinths. Each book bay is a framed niche:
                  folded walnut responds on the corner wall strips, the bookcase (bookcases.py,
                  plan bc_rotunda_<k>), a walnut frieze board and a panelled walnut soffit. The two
                  display bays get a moulded walnut panel with a green fabric field over their
                  cabinets; the exit bay gets a limestone door surround (pilaster jambs, returned
                  cornice hood above the EXIT sign) round arch_windows' exit door.
    4.30 - 5.00   GROUND ENTABLATURE (walnut) on the column line: two-fascia architrave with a bead,
                  ornament_band frieze, bed mould, dentils, ovolo, corona and cyma. At bay 6 the
                  two corner columns move onto the passage jamb lines (their shafts 5 mm outside the
                  jamb planes) and the entablature returns there back to the walls, so it frames the
                  arch instead of crossing it.
    5.00 - 10.40  UPPER TIER (limestone): a moulded podium course on the entablature ledge, folded
                  limestone pilaster strips continuing the column lines (base + capital), and in
                  every bay but 6 a blind arch recess 0.10 deep with a pale green plaster field
                  (Ref 5's lunettes), a moulded casing and a scroll keystone, an oculus (arch_windows
                  build_oculus, d 2.2, centre 8.6) and a gilt-lettered tablet with the name of a
                  great library city (Ref 3). Bay 6 carries the rotunda face of the hall arch: a
                  moulded archivolt (dying into the neighbouring pilaster strips), a keystone and an
                  inscribed tablet.
    10.40 - 11.00 FASCIA + CORNICE: the hall cornice (arch_shell: cyma, dentils (no egg-and-dart: budget),
                  modillions, coffered corona soffit) remapped to 10.60 - 11.00 over a two-fascia band.
    11.00 - 17.00 DOME: a twelve-gore cloister vault (horizontal sections are 12-gons) with four
                  rings of diminishing coffers, two per gore (stepped limestone frames with gilt
                  beads, teal / oxblood painted panels in a checkerboard, arch_ceiling rosettes in
                  gilt), twelve groin ribs on the corner lines (gilt beads, ornament_band face),
                  a top band that blends the 12-gon into a circle, and a moulded gilt ring round
                  the skylight opening (r 3.6 at 17.0) with an ornament_band well.
    17.45 - 18.13 SKYLIGHT: a shallow glass cap on an iron curb with 24 radial T-ribs, four ring
                  bars and a turned iron hub whose flat bottom is the chandelier anchor
                  (empty "Anchor_Ceiling_rotunda_crown", at the ring centre, z 17.0).
    EXTERIOR      the wall drum to 12.6, a lead roof ring and a lead outer dome up to the skylight
                  curb; closed to the sky except through the glass. Kept clear of the lift shaft.
    FLOOR         radial marquetry: a marble medallion, a sixteen-point compass star in light and
                  dark woods on a walnut field, a cream/verde marble ring, three rings of radial
                  oak boards with walnut bands, an oak stringing and a walnut border along the walls,
                  and a marble threshold through the hall arch (x 14.0 - 14.95).

Bay 6 (the arch to the hall): only x 14.8 - 15.0 of the wall is built here (the hall's east wall,
x 14 - 14.8, is arch_shell's, with the 4.4 x 8.5 hole and the hall-side surround); the slice's hole
uses arch_shell.arc_steps, so its reveal continues the hall's exactly. Bays 5 and 7 are clipped
at the hall wall's back face (x 14.8).

Repeated pieces are linked duplicates (columns, oculi, recess trims, plain walls, coffers,
rosettes, gores, ribs, iron ribs).
"""

from __future__ import annotations

import math
import os
import random
import time

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

import arch_ceiling as ACE
import arch_gallery as AG
import arch_shell as AS
import arch_windows as AW
import lib_core as C
import lib_materials as LM
import lib_render as R
import plan as P

# Palette keys this module needs and lib_materials lacks (setdefault: a later official entry wins).
PALETTE_ADDITIONS = {
    "marble_cream": dict(base="#e3dacb", rough=0.16),     # polished cream marble (floor medallion, ring, threshold)
    "marble_verde": dict(base="#1f3a30", rough=0.18),     # verde antico inlay bands
    "lead_roof": dict(base="#5c6266", rough=0.55, metal=0.3),  # exterior lead roof of the dome
}
for _k, _v in PALETTE_ADDITIONS.items():
    LM.PALETTE.setdefault(_k, _v)

mat = LM.mat
tex = LM.tex_size
Z = Vector((0.0, 0.0, 1.0))
CARVED = AS.CARVED

# ---------------------------------------------------------------------------
# Plan-derived dimensions
# ---------------------------------------------------------------------------

RC = P.ROTUNDA["center"]                    # web (x, z)
O = Vector((RC[0], -RC[1], 0.0))            # Blender centre on the floor
AP = P.ROTUNDA["apothem"]                   # 8.4 inner face
WT = P.ROTUNDA["wall"]                      # 0.8
NS = P.ROTUNDA["sides"]                     # 12
T15 = math.tan(math.pi / NS)
C15 = math.cos(math.pi / NS)
HW = AP * T15                               # 2.2508 half bay at the inner face
HWO = (AP + WT) * T15                       # half bay at the outer face
RCORN = AP / C15                            # inner corner radius
GT = P.ROTUNDA["ground_tier_top"]           # 5.0
OC_Y = P.ROTUNDA["lunette_oculus_y"]        # 8.6
OC_D = P.ROTUNDA["lunette_oculus_d"]        # 2.2
CORNICE_Y = P.ROTUNDA["cornice_y"]          # 10.6
SPRING_Y = P.ROTUNDA["dome_spring_y"]       # 11.0
CROWN_Y = P.ROTUNDA["crown_y"]              # 17.0
SKY_R = P.ROTUNDA["skylight_radius"]        # 3.6
ARCH_W = P.ROTUNDA["arch"]["width"]         # 4.4
ARCH_SPRING = P.ROTUNDA["arch"]["spring"]   # 6.3
ARCH_APEX = P.ROTUNDA["arch"]["apex"]       # 8.5
EXIT_W = P.ROTUNDA["exit"]["width"]
EXIT_H = P.ROTUNDA["exit"]["height"]
ROLES = {b["index"]: b["role"] for b in P.ROTUNDA_BAYS}
HALL_BACK = P.HALL["maxX"] + P.EXT_WALL     # 14.8: back face of the hall's east wall
SLICE_D = (RC[0] - AP) - HALL_BACK          # 0.2: the part of bay 6 built here
WALL_TOP = 12.6                             # drum top (exterior)

# Ground tier
COL_R = 0.17
COL_D = 0.85                                # column axis inset from the inner corner (bisector)
LOOP_D = COL_D * C15                        # column line distance from the wall faces
ABACUS_Z = 4.30
FR0, FR1, FR_D = 4.49, 4.71, 0.155          # ground frieze
DENT_D0, DENT_D1, DENT_Z0, DENT_Z1 = 0.195, 0.232, 4.752, 4.80
RESP_LEG, RESP_P = 0.29, 0.035              # walnut responds on the corner strips
COL_TRIS, OCULUS_TRIS = 7800, 6600          # decimation targets for the 12 columns / 11 oculi (budget)
TRIM_TRIS, CORNICE_KEEP = 3200, 0.64        # recess trim target; share of the cornice kept (budget)

# Upper tier
PLINTH_TOP = 5.30
STRIP_LEG, STRIP_P = 0.30, 0.08
FASCIA_Z = 10.40
REC_HW, REC_SPRING, REC_D = 1.75, 8.35, 0.10
REC_N = 48                                  # arc steps of the blind arch (wall hole and casing share them)
TAB_Z = 6.55
FIELD = "plaster_green"
NAMES = {0: "ALEXANDRIA", 1: "PERGAMON", 2: "NINEVEH", 3: "BOLOGNA", 4: "SALAMANCA", 5: "OXFORD",
         7: "PADUA", 8: "LEIDEN", 9: "PRAGUE", 10: "VIENNA", 11: "DUBLIN"}
MOTTO = "QVAERE ET INVENIES"
FONT = next((f for f in ("/System/Library/Fonts/Supplemental/Baskerville.ttc",
                         "/System/Library/Fonts/Supplemental/Georgia.ttf", AW.FONT_SERIF) if os.path.exists(f)), None)

# Dome
FRAME = "limestone_plain"
DOME_A0 = 8.1                               # gore-centre apothem at the springing (behind the corona)
RING_RO, RING_Z = 3.95, 16.9                # where the dome surface meets the skylight ring
_MC = (DOME_A0 ** 2 - RING_RO ** 2 - (RING_Z - SPRING_Y) ** 2) / (2 * (DOME_A0 - RING_RO))
_MR = DOME_A0 - _MC                         # meridian circle (centre radius _MC at the springing)
S_END = _MR * math.atan2(RING_Z - SPRING_Y, RING_RO - _MC)
S_BASE = 0.42                               # plain band above the cornice
BLEND = 0.85                                # top band where the 12-gon turns into a circle
S_B0 = S_END - BLEND
N_ROWS, N_SIDE = 4, 4
COFFER_RECESS = 0.22
CURB_Z = 17.45                              # skylight curb top (glass seat)
GLASS_R0, GLASS_Z0, GLASS_RISE = 3.78, 17.49, 0.64
OUT_OFF = 0.5                               # outer dome offset from the inner meridian
OUT_R0 = 8.30                               # outer dome skirt radius


def _hw_d(s):
    return _mer(s)[0] * T15


def _mer(s):
    ph = s / _MR
    return _MC + _MR * math.cos(ph), SPRING_Y + _MR * math.sin(ph), ph


G_F = 0.20 / (DOME_A0 * T15)                # groin margin as a fraction of the gore half-width
M_F = 0.09 / (DOME_A0 * T15)                # mid rib half-width fraction


def _blend_w(s):
    if s <= S_B0:
        return 1.0
    t = min(1.0, (s - S_B0) / (S_END - S_B0))
    return 1.0 - t * t * (3 - 2 * t)


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------

def theta(k):
    """Blender angle of bay k's outward normal."""
    return -math.radians(360.0 / NS * k)


def rhat(k):
    t = theta(k)
    return Vector((math.cos(t), math.sin(t), 0.0))


def that(k):
    t = theta(k)
    return Vector((math.sin(t), -math.cos(t), 0.0))


def bay_matrix(k):
    """Bay-local frame: origin on the inner face centre at the floor, x along the wall (toward bay
    k + 1), y outward (into the wall, room on -y), z up."""
    return Matrix.Translation(O + rhat(k) * AP) @ Matrix.Rotation(theta(k) - math.pi / 2, 4, "Z")


BM0 = Matrix.Translation((AP, 0.0, 0.0)) @ Matrix.Rotation(-math.pi / 2, 4, "Z")   # bay 0 frame, relative to O


def corner_dir(c):
    a = theta(c) - math.pi / NS
    return Vector((math.cos(a), math.sin(a), 0.0))


def corner_pt(c, inset=0.0):
    """Inner corner between bay c and bay c + 1 (moved `inset` toward the centre)."""
    return O + corner_dir(c) * (RCORN - inset)


def arch_column(c):
    """The column at corner 5 (5/6) or 6 (6/7): on bay 5's / 7's column line, its shaft 5 mm
    outside the passage jamb plane."""
    b = 5 if c == 5 else 7
    y = -(RC[1] + ARCH_W / 2) - (COL_R + 0.005) if c == 5 else -(RC[1] - ARCH_W / 2) + (COL_R + 0.005)
    r = rhat(b)
    x = O.x + ((AP - LOOP_D) - (y - O.y) * r.y) / r.x
    return Vector((x, y, 0.0))


def column_points():
    """[(corner index, Blender position, rotation)] of the 12 ground-tier columns. Web positions
    for plan colliders: (p.x, -p.y), radius 0.24 (the column base)."""
    out = []
    for c in range(NS):
        if c in (5, 6):
            out.append((c, arch_column(c), theta(5 if c == 5 else 7)))
        else:
            out.append((c, corner_pt(c, COL_D), theta(c) - math.pi / NS))
    return out


def _col(name="Rotunda"):
    return C.collection(name, C.collection("ARCHITECTURE"))


def _xy(v):
    return Vector((v.x, v.y))


# ---------------------------------------------------------------------------
# Small mesh helpers (on arch_shell's _MB builder)
# ---------------------------------------------------------------------------

def _tess(mb, outer, holes, to3d, want, mi, sz):
    """Planar polygon with holes, triangulated, mapped to 3D, wound toward `want`."""
    polys = [[Vector((x, y, 0.0)) for x, y in outer]] + [[Vector((x, y, 0.0)) for x, y in h] for h in holes]
    flat = [p for poly in polys for p in poly]
    for tri in tessellate_polygon(polys):
        pts = [to3d(flat[i].x, flat[i].y) for i in tri]
        pts, _ = AS._orient([tuple(p) for p in pts], None, want)
        mb.pface([Vector(p) for p in pts], mi, sz)


def _ring(mb, loop, y0, y1, L3, R3, centre, mi, sz, closed=True):
    """Reveal faces along a face-plane loop (x, z) from local y0 to y1, facing `centre`."""
    n = len(loop)
    for i in range(n if closed else n - 1):
        p0, p1 = loop[i], loop[(i + 1) % n]
        if math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-7:
            continue
        f = [L3(p0[0], y0, p0[1]), L3(p1[0], y0, p1[1]), L3(p1[0], y1, p1[1]), L3(p0[0], y1, p0[1])]
        mx, mz = (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2
        want = R3 @ Vector((centre[0] - mx, 0.0, centre[1] - mz))
        pts, _ = AS._orient([tuple(p) for p in f], None, want)
        mb.pface([Vector(p) for p in pts], mi, sz)


def _arch_outline(hw, z0, spring, n=None):
    n = n or AS.arc_steps(hw, math.pi)
    pts = [(hw, z0)]
    pts += [(hw * math.cos(math.pi * i / n), spring + hw * math.sin(math.pi * i / n)) for i in range(n + 1)]
    pts.append((-hw, z0))
    return pts


def _circle(r, zc, seg=64):
    """Same sampling and phase as arch_windows.build_oculus (so its liner sits true)."""
    return [(r * math.cos(math.radians(180 - 360 * k / seg)), zc + r * math.sin(math.radians(180 - 360 * k / seg)))
            for k in range(seg)]


def _lathe(mb, pts, segmats, mis, seg, uvf, outward_left=True, phase=0.0):
    """Revolves (r, z) points around Blender Z (relative coords). segmats[j] = palette key of
    segment j; faces face the LEFT of the profile direction (or the right)."""
    for j in range(len(pts) - 1):
        (r0, z0), (r1, z1) = pts[j], pts[j + 1]
        dr, dz = r1 - r0, z1 - z0
        nl = (-dz, dr) if outward_left else (dz, -dr)
        key = segmats[j]
        mb.new_part()
        for i in range(seg):
            a0, a1 = phase + math.tau * i / seg, phase + math.tau * (i + 1) / seg
            am = (a0 + a1) / 2
            q = [Vector((r0 * math.cos(a0), r0 * math.sin(a0), z0)), Vector((r0 * math.cos(a1), r0 * math.sin(a1), z0)),
                 Vector((r1 * math.cos(a1), r1 * math.sin(a1), z1)), Vector((r1 * math.cos(a0), r1 * math.sin(a0), z1))]
            uvs = [uvf(key, a0, r0, z0, j, 0), uvf(key, a1, r0, z0, j, 0), uvf(key, a1, r1, z1, j, 1), uvf(key, a0, r1, z1, j, 1)]
            want = Vector((nl[0] * math.cos(am), nl[0] * math.sin(am), nl[1]))
            q2, uv2 = AS._orient([tuple(p) for p in q], uvs, want)
            mb.face(q2, uv2, mis[key])


def _set_world(ob, M):
    ob.matrix_world = M
    return ob


def _ccw(poly):
    a = sum(p.x * q.y - q.x * p.y for p, q in zip(poly, poly[1:] + poly[:1]))
    return poly if a > 0 else list(reversed(poly))


def _link_copy(src, name, M, col):
    ob = bpy.data.objects.new(name, src.data)
    col.objects.link(ob)
    ob.matrix_world = M
    return ob


def _rot_about_O(k):
    return Matrix.Translation(O) @ Matrix.Rotation(theta(k), 4, "Z")


def _decimate(ob, target, sharp_deg=40.0):
    """Collapse-decimates a (linked-to-scene) mesh to about `target` triangles, keeping its
    materials and UVs, then re-marks sharp edges. Used on the instanced milestone-1 parts (arcade
    column, oculus) so twelve / eleven copies fit the rotunda budget."""
    n = C.tris(ob)
    if n <= target:
        return ob
    md = ob.modifiers.new("Decimate", "DECIMATE")
    md.decimate_type = "COLLAPSE"
    md.ratio = target / n
    md.use_collapse_triangulate = False
    bpy.context.view_layer.update()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    ob.modifiers.remove(md)
    old = ob.data
    ob.data = me
    me.name = old.name
    bpy.data.meshes.remove(old)
    for p in me.polygons:
        p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(sharp_deg))
    return ob


# ---------------------------------------------------------------------------
# Walls
# ---------------------------------------------------------------------------

def _clip_x(k, y):
    base = O + rhat(k) * (AP + y)
    return (HALL_BACK - base.x) / that(k).x


def _mitre_clip(k, s):
    r, t = rhat(k), that(k)
    y = (HALL_BACK - O.x - AP * r.x - s * HW * t.x) / (r.x + s * T15 * t.x)
    return s * (HW + y * T15), y


def _wall_mesh(k, M, name, col):
    R3 = M.to_3x3()
    L3 = lambda x, y, z: M @ Vector((x, y, z))
    mb = AS._MB()
    ash, fld, pl = mb.mi("limestone"), mb.mi(FIELD), mb.mi("limestone_plain")
    s_ash, s_fld, s_pl = tex("limestone"), tex(FIELD), tex("limestone_plain")
    inward, outward = R3 @ Vector((0, -1, 0)), R3 @ Vector((0, 1, 0))
    xl_out, xr_out = -HWO, HWO
    top = [(-HW, 0.0), (HW, 0.0), (HWO, WT), (-HWO, WT)]
    if k == 5:
        xc = _clip_x(5, WT)
        xm, ym = _mitre_clip(5, 1)
        xr_out = xc
        top = [(-HW, 0.0), (HW, 0.0), (xm, ym), (xc, WT), (-HWO, WT)]
    elif k == 7:
        xc = _clip_x(7, WT)
        xm, ym = _mitre_clip(7, -1)
        xl_out = xc
        top = [(-HW, 0.0), (HW, 0.0), (HWO, WT), (xc, WT), (xm, ym)]
    dw = EXIT_W / 2

    def outline(xl, xr):
        if k == 0:
            return [(xl, 0.0), (-dw, 0.0), (-dw, EXIT_H), (dw, EXIT_H), (dw, 0.0), (xr, 0.0), (xr, WALL_TOP), (xl, WALL_TOP)]
        return [(xl, 0.0), (xr, 0.0), (xr, WALL_TOP), (xl, WALL_TOP)]

    rec = _arch_outline(REC_HW, PLINTH_TOP, REC_SPRING, REC_N)
    circ = _circle(OC_D / 2, OC_Y)
    mb.new_part()
    _tess(mb, outline(-HW, HW), [rec], lambda x, z: L3(x, 0.0, z), inward, ash, s_ash)
    mb.new_part()
    _tess(mb, rec, [circ], lambda x, z: L3(x, REC_D, z), inward, fld, s_fld)
    mb.new_part()
    _ring(mb, rec, 0.0, REC_D, L3, R3, (0.0, 7.2), pl, s_pl)
    mb.new_part()
    _ring(mb, circ, REC_D, WT, L3, R3, (0.0, OC_Y), pl, s_pl)
    if k == 0:
        mb.new_part()
        _ring(mb, [(-dw, 0.0), (-dw, EXIT_H), (dw, EXIT_H), (dw, 0.0)], 0.0, WT, L3, R3, (0.0, EXIT_H / 2), pl, s_pl, closed=False)
    mb.new_part()
    _tess(mb, outline(xl_out, xr_out), [circ], lambda x, z: L3(x, WT, z), outward, pl, s_pl)
    mb.new_part()
    _tess(mb, top, [], lambda x, y: L3(x, y, WALL_TOP), Z, pl, s_pl)
    return mb.build(name, col, sharp=35.0)


def _arch_wall(col):
    """Bay 6: the 0.2 m slice x 14.8 - 15.0 with the arch hole (arch_shell's arc sampler)."""
    M = bay_matrix(6)
    R3 = M.to_3x3()
    L3 = lambda x, y, z: M @ Vector((x, y, z))
    mb = AS._MB()
    ash = mb.mi("limestone")
    pl = mb.mi("limestone_plain")
    aw = ARCH_W / 2
    n = AS.arc_steps(aw, math.pi)
    notch = [(-aw, 0.0), (-aw, ARCH_SPRING)]
    notch += [(aw * math.cos(math.pi - math.pi * i / n), ARCH_SPRING + aw * math.sin(math.pi - math.pi * i / n)) for i in range(1, n)]
    notch += [(aw, ARCH_SPRING), (aw, 0.0)]
    outer = [(-HW, 0.0)] + notch + [(HW, 0.0), (HW, WALL_TOP), (-HW, WALL_TOP)]
    mb.new_part()
    _tess(mb, outer, [], lambda x, z: L3(x, 0.0, z), R3 @ Vector((0, -1, 0)), ash, tex("limestone"))
    mb.new_part()
    _ring(mb, notch, 0.0, SLICE_D, L3, R3, (0.0, 4.0), ash, tex("limestone"), closed=False)
    hb = HW + SLICE_D * T15
    mb.new_part()
    _tess(mb, [(-HW, 0.0), (HW, 0.0), (hb, SLICE_D), (-hb, SLICE_D)], [], lambda x, y: L3(x, y, WALL_TOP), Z, pl, tex("limestone_plain"))
    ob = mb.build("Architecture_Rotunda_Wall_06", col, sharp=35.0)
    C.bevel(ob, 0.008, 1, 50.0, harden=True)
    return ob


def build_walls(col):
    out = []
    plain = [k for k in range(NS) if k not in (0, 5, 6, 7)]
    src = _wall_mesh(1, BM0, f"Architecture_Rotunda_Wall_{plain[0]:02d}", col)
    for i, k in enumerate(plain):
        ob = src if i == 0 else _link_copy(src, f"Architecture_Rotunda_Wall_{k:02d}", _rot_about_O(k), col)
        ob.matrix_world = _rot_about_O(k)
        out.append(ob)
    for k in (0, 5, 7):
        out.append(_wall_mesh(k, bay_matrix(k), f"Architecture_Rotunda_Wall_{k:02d}", col))
    out.append(_arch_wall(col))
    return out


# ---------------------------------------------------------------------------
# Ground tier: columns, entablature, responds, bay dressing
# ---------------------------------------------------------------------------

def build_columns(col):
    out = []
    src = AG.build_arcade_column(height=ABACUS_Z, radius=COL_R, name="Architecture_Rotunda_Column_01")
    C.move_to(src, col)
    _decimate(src, COL_TRIS)
    for i, (c, p, ang) in enumerate(column_points()):
        if i == 0:
            ob = src
            ob.location, ob.rotation_euler = p, (0, 0, ang)
        else:
            ob = C.instance(src, f"Architecture_Rotunda_Column_{i + 1:02d}", p, ang, col=col)
        out.append(ob)
    return out


def _ent_path(wall_ext=0.0):
    a7, a5 = arch_column(6), arch_column(5)
    foot7 = a7 + rhat(7) * (LOOP_D + wall_ext)
    foot5 = a5 + rhat(5) * (LOOP_D + wall_ext)
    cols = [corner_pt(c, COL_D) for c in (7, 8, 9, 10, 11, 0, 1, 2, 3, 4)]
    return [_xy(v) for v in [foot7, a7] + cols + [a5, foot5]]


def _ent_profiles():
    A0 = ABACUS_Z
    lower = AS._prof(
        [(-0.06, A0), (0.135, A0), (0.135, A0 + 0.068)],
        [(0.147, A0 + 0.072), (0.147, A0 + 0.142)],
        AS._arc(0.147, A0 + 0.149, 0.007, -90, 90, 4)[1:],
        [(0.152, A0 + 0.158), (0.152, A0 + 0.165)],
        AS._cyma_reversa((0.152, A0 + 0.165), (0.178, A0 + 0.184), 5)[1:],
        [(0.180, A0 + 0.186), (0.180, FR0), (FR_D, FR0)],
        r=0.0015)
    upper = AS._prof(
        [(FR_D, FR1)],
        AS._cyma_reversa((FR_D, FR1), (0.192, FR1 + 0.034), 5)[1:],
        [(DENT_D0, FR1 + 0.036), (DENT_D0, DENT_Z1), (0.238, DENT_Z1)],
        AS._arc(0.238, DENT_Z1 + 0.038, 0.038, -90, 0, 6)[1:],
        [(0.280, 4.842), (0.375, 4.842), (0.378, 4.846), (0.378, 4.915), (0.383, 4.918)],
        AS._cyma_recta((0.383, 4.918), (0.418, 4.986), 6)[1:],
        [(0.422, 4.99), (0.422, GT), (-0.06, GT)],
        r=0.0015)
    return lower, upper


def _segs(path):
    out = []
    for a, b in zip(path, path[1:]):
        a, b = Vector(a), Vector(b)
        t = (b - a).normalized()
        out.append((a, b, t, Vector((t.y, -t.x)), (b - a).length))
    return out


def build_entablature(col):
    mb = AS._MB()
    w = mb.mi("walnut")
    band = mb.mi("ornament_band")
    st = mb.mi("limestone_plain")
    sz = tex("walnut")
    path = _ent_path(0.04)
    lower, upper = _ent_profiles()
    to3 = AS._plan3d()
    mb.new_part()
    AS._sweep(mb, path, lower, to3, closed=False, mat=w, uv_size=sz)
    mb.new_part()
    AS._sweep(mb, path, upper, to3, closed=False, mat=w, uv_size=sz)
    # Frieze: ornament band, U every `period`, V across the band.
    fr = AS._offset_path(path, FR_D)
    period = 0.6 * (FR1 - FR0) / 0.3
    s_acc = 0.0
    mb.new_part()
    for qa, qb in zip(fr, fr[1:]):
        Lf = (qb - qa).length
        pts = [(qa.x, qa.y, FR0), (qb.x, qb.y, FR0), (qb.x, qb.y, FR1), (qa.x, qa.y, FR1)]
        mb.face(pts, [(s_acc / period, 0), ((s_acc + Lf) / period, 0), ((s_acc + Lf) / period, 1), (s_acc / period, 1)], band)
        s_acc += Lf
    # Dentils (corner blocks at the convex returns over the arch columns).
    segs = _segs(path)
    kinds = [None]
    for i in range(1, len(path) - 1):
        t0, t1 = segs[i - 1][2], segs[i][2]
        kinds.append("ext" if t0.x * t1.y - t0.y * t1.x > 0 else "int")
    kinds.append(None)
    pd, wd = 0.075, 0.046
    margin = {None: 0.10, "int": 0.30, "ext": DENT_D1 + 0.03}
    for i, seg in enumerate(segs):
        L = seg[4]
        lo, hi = margin[kinds[i]], L - margin[kinds[i + 1]]
        if kinds[i + 1] == "ext":
            AS._block(mb, w, seg, L + DENT_D0, L + DENT_D1, DENT_D0, DENT_D1, DENT_Z0, DENT_Z1, sz, top=False, chamfer=0.003)
        if hi - lo < wd:
            continue
        n = int((hi - lo) / pd)
        s0 = (lo + hi) / 2 - n * pd / 2
        for j in range(n + 1):
            s = s0 + j * pd
            AS._block(mb, w, seg, s - wd / 2, s + wd / 2, DENT_D0, DENT_D1, DENT_Z0, DENT_Z1, sz, top=False, chamfer=0.003)
    # Niche soffit (walnut) and the ledge on top (stone), from the walls to the entablature back.
    pb = AS._offset_path(_ent_path(0.0), -0.06)
    walls = [_xy(corner_pt(c)) for c in (7, 8, 9, 10, 11, 0, 1, 2, 3, 4)]
    poly = [pb[0]] + walls + [pb[-1]] + list(reversed(pb[1:-1]))
    poly = [(p.x, p.y) for p in poly]
    mb.new_part()
    _tess(mb, poly, [], lambda x, y: Vector((x, y, ABACUS_Z)), -Z, w, sz)
    mb.new_part()
    _tess(mb, poly, [], lambda x, y: Vector((x, y, GT)), Z, st, tex("limestone_plain"))
    return [mb.build("Architecture_Rotunda_Entablature_Ground", col, sharp=35.0)]


def _respond_poly(c, rp, leg):
    K = corner_pt(c)
    has_a, has_b = c != 6, c != 5
    Ma, Mb = bay_matrix(c), bay_matrix((c + 1) % NS)
    pts = []
    if has_a:
        pts += [Ma @ Vector((HW - leg, 0, 0)), Ma @ Vector((HW - leg, -rp, 0))]
    else:
        pts += [K, Mb @ Vector((-HW, -rp, 0))]
    if has_a and has_b:
        pts.append(O + corner_dir(c) * (RCORN - rp / C15))
    if has_b:
        pts += [Mb @ Vector((-(HW - leg), -rp, 0)), Mb @ Vector((-(HW - leg), 0, 0))]
    else:
        pts += [Ma @ Vector((HW, -rp, 0)), K]
    if has_a and has_b:
        pts.append(K)
    return [_xy(p) for p in pts]


def build_responds(col):
    parts = []
    for c in range(NS):
        base = C.prism(f"Architecture_Rotunda_RespondBase_{c:02d}", _ccw(_respond_poly(c, RESP_P + 0.016, RESP_LEG + 0.016)),
                       0.0, 0.19, mat("walnut"), bevel_w=0.004)
        body = C.prism(f"Architecture_Rotunda_Respond_{c:02d}", _ccw(_respond_poly(c, RESP_P, RESP_LEG)),
                       0.19, ABACUS_Z, mat("walnut"), bevel_w=0.004)
        for ob in (base, body):
            C.uv_box(ob, tex("walnut"), grain="z")
        parts += [base, body]
    ob = C.join(parts, "Architecture_Rotunda_Responds")
    C.move_to(ob, col)
    return [ob]


_FRAME_PROF = [(0.035, 0.0), (0.035, 0.012), (0.02, 0.024), (0.0, 0.034), (-0.02, 0.03), (-0.035, 0.016),
               (-0.045, 0.012), (-0.05, 0.0)]
_TAB_PROF = [(0.03, 0.0), (0.03, 0.01), (0.018, 0.022), (0.0, 0.03), (-0.018, 0.026), (-0.032, 0.014),
             (-0.045, 0.012), (-0.05, 0.0)]


def _drop_back(ob):
    """Removes the back faces (+y, against the tablet) of -y facing lettering: never seen."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.y > 0.9], context="FACES")
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def _local(ob, M):
    ob.data.transform(M)
    ob.data.update()
    return ob


def build_bay_dressing(col):
    """Walnut frieze boards, display-bay panels, the exit surround and skirting, and the exit door."""
    parts = []
    for k in range(NS):
        if k == 6:
            continue
        M = bay_matrix(k)
        b = AW._box(f"Architecture_Rotunda_FriezeBoard_{k:02d}", (-(HW - RESP_LEG), -0.025, 4.16), (HW - RESP_LEG, 0.0, ABACUS_Z),
                    "walnut", 0.003, 1, "x")
        parts.append(_local(b, M))
        if ROLES[k] == "display":
            fr = C.panel_frame(f"Architecture_Rotunda_DisplayFrame_{k:02d}", 3.56, 1.58, _FRAME_PROF, mat("walnut"))
            C.uv_grain_auto(fr, tex("walnut"))
            parts.append(_local(fr, M @ Matrix.Translation((0, 0, 3.32))))
            fld = AW._box(f"Architecture_Rotunda_DisplayField_{k:02d}", (-1.74, -0.01, 2.53), (1.74, 0.0, 4.11), "fabric_green", 0.0, 1)
            parts.append(_local(fld, M))
        if ROLES[k] == "exit":
            for sx in (-1, 1):
                x0, x1 = sorted((sx * 1.04, sx * 1.30))
                j = AW._box(f"Architecture_Rotunda_ExitJamb_{sx}", (x0, -0.07, 0.0), (x1, 0.0, 3.10), "limestone_plain", 0.006, 2, "z")
                parts.append(_local(j, M))
                x0, x1 = sorted((sx * 1.30, sx * (HW - RESP_LEG)))
                sk = AW._box(f"Architecture_Rotunda_Skirting_{sx}", (x0, -0.022, 0.0), (x1, 0.0, 0.18), "walnut", 0.004, 2, "x")
                parts.append(_local(sk, M))
            hood = AW._returned("Architecture_Rotunda_ExitHood", AW._prof_cornice(0.16, 0.24), -1.42, 1.42, 0.0, 3.10, "limestone_plain")
            parts.append(_local(hood, M))
    for ob in parts:
        if not ob.data.uv_layers:
            C.uv_box(ob, 1.0)
    ob = C.join(parts, "Architecture_Rotunda_BayDressing")
    C.move_to(ob, col)
    door = AW.build_door("exit", width=EXIT_W, height=EXIT_H, wall_thickness=WT, label="Emergency Exit",
                         name="Architecture_Rotunda_Door_Exit")
    door.matrix_world = bay_matrix(0)
    for o in [door] + list(door.children_recursive):
        C.move_to(o, col)
    return [ob, door]


# ---------------------------------------------------------------------------
# Upper tier
# ---------------------------------------------------------------------------

def _strip_front(c):
    """Front path (wall -> front -> wall, clockwise) and plan polygon of the pilaster strip at corner c."""
    K = corner_pt(c)
    has_a, has_b = c != 6, c != 5
    Ma, Mb = bay_matrix(c), bay_matrix((c + 1) % NS)
    front = []
    if has_a:
        front += [Ma @ Vector((HW - STRIP_LEG, 0, 0)), Ma @ Vector((HW - STRIP_LEG, -STRIP_P, 0))]
    else:
        front += [K, Mb @ Vector((-HW, -STRIP_P, 0))]
    if has_a and has_b:
        front.append(O + corner_dir(c) * (RCORN - STRIP_P / C15))
    if has_b:
        front += [Mb @ Vector((-(HW - STRIP_LEG), -STRIP_P, 0)), Mb @ Vector((-(HW - STRIP_LEG), 0, 0))]
    else:
        front += [Ma @ Vector((HW, -STRIP_P, 0)), K]
    poly = front + ([K] if has_a and has_b else [])
    return [_xy(p) for p in front], [_xy(p) for p in poly]


def _strip_base_prof():
    z0 = PLINTH_TOP
    return AS._prof([(0.0, z0), (0.036, z0), (0.036, z0 + 0.045), (0.030, z0 + 0.05)],
                    AS._arc(0.016, z0 + 0.07, 0.02, -45, 90, 5)[1:],
                    [(0.006, z0 + 0.092), (0.006, z0 + 0.10), (0.003, z0 + 0.12), (0.0005, z0 + 0.14), (0.0, z0 + 0.15)], r=0.0)


def _strip_cap_prof():
    z1 = FASCIA_Z
    return AS._prof([(0.0, z1 - 0.28), (0.004, z1 - 0.27)],
                    AS._arc(0.010, z1 - 0.255, 0.012, -90, 90, 4)[1:],
                    [(0.004, z1 - 0.235), (0.008, z1 - 0.18), (0.02, z1 - 0.13), (0.038, z1 - 0.10), (0.05, z1 - 0.085),
                     (0.056, z1 - 0.08), (0.056, z1), (0.0, z1)], r=0.0015)


def build_upper_tier(col):
    out = []
    mb = AS._MB()
    stone = mb.mi(CARVED)
    sz = tex(CARVED)
    to3 = AS._plan3d()
    # Podium course on the entablature ledge, bay 7 round to bay 5.
    path = [_xy(corner_pt(c)) for c in (6, 7, 8, 9, 10, 11, 0, 1, 2, 3, 4, 5)]
    prof = AS._prof([(0.0, GT), (0.14, GT), (0.14, 5.20)], AS._cyma_reversa((0.14, 5.20), (0.112, 5.27), 5)[1:],
                    [(0.11, 5.275), (0.11, PLINTH_TOP), (0.0, PLINTH_TOP)], r=0.0015)
    mb.new_part()
    AS._sweep(mb, path, prof, to3, closed=False, mat=stone, uv_size=sz, cap0=True, cap1=True)
    # Pilaster strips: base and capital mouldings swept round each strip front.
    bp, cp = _strip_base_prof(), _strip_cap_prof()
    strips = []
    for c in range(NS):
        front, poly = _strip_front(c)
        mb.new_part()
        AS._sweep(mb, front, bp, to3, closed=False, mat=stone, uv_size=sz)
        mb.new_part()
        AS._sweep(mb, front, cp, to3, closed=False, mat=stone, uv_size=sz)
        s = C.prism(f"Architecture_Rotunda_Strip_{c:02d}", _ccw(poly), PLINTH_TOP, FASCIA_Z, mat(CARVED), bevel_w=0.005)
        C.uv_box(s, sz, grain="z")
        strips.append(s)
    ob = mb.build("Architecture_Rotunda_UpperMouldings", col, sharp=35.0)
    st = C.join(strips, "Architecture_Rotunda_Strips")
    C.move_to(st, col)
    out += [ob, st]
    # Recess trim (casing + keystone + tablet frame and field), one mesh instanced in every bay but 6.
    mb = AS._MB()
    stone = mb.mi(CARVED)
    sign = mb.mi("signage")
    face3 = lambda p, h: BM0 @ Vector((p[0], -h, p[1]))
    mb.new_part()
    AS._sweep(mb, _arch_outline(REC_HW, PLINTH_TOP, REC_SPRING, REC_N), AS._casing_profile(0.17, 0.065), face3, closed=False,
              mat=stone, uv_size=sz, cap0=True, cap1=True)
    AS._keystone(mb, BM0, 0.0, REC_SPRING + REC_HW - 0.05, FASCIA_Z, 0.20, 0.27, 0.08, 0.135, sz, cap_h=0.045)
    trim = mb.build("Architecture_Rotunda_RecessTrim_01", col, sharp=35.0)
    fr = C.panel_frame("Architecture_Rotunda_TabletFrame", 2.5, 0.46, _TAB_PROF, mat(CARVED))
    C.uv_box(fr, sz)
    _local(fr, BM0 @ Matrix.Translation((0, REC_D, TAB_Z)))
    fld = AW._box("Architecture_Rotunda_TabletField", (-1.205, REC_D - 0.012, TAB_Z - 0.185), (1.205, REC_D, TAB_Z + 0.185), "signage", 0.0, 1)
    _local(fld, BM0)
    trim = C.join([trim, fr, fld], "Architecture_Rotunda_RecessTrim_01")
    C.move_to(trim, col)
    _decimate(trim, TRIM_TRIS, 35.0)
    bays = [k for k in range(NS) if k != 6]
    for i, k in enumerate(bays):
        ob = trim if i == 0 else _link_copy(trim, f"Architecture_Rotunda_RecessTrim_{i + 1:02d}", _rot_about_O(k), col)
        ob.matrix_world = _rot_about_O(k)
        out.append(ob)
    # Bay 6: rotunda face of the hall arch.
    M6 = bay_matrix(6)
    mb = AS._MB()
    stone = mb.mi(CARVED)
    r, b = ARCH_W / 2, 0.20
    a0 = math.acos(min(1.0, (HW - 0.004) / (r + b)))
    n = AS.arc_steps(r, math.pi)
    angs = [a0 + (math.pi - 2 * a0) * i / n for i in range(n + 1)]
    mb.new_part()
    AS._sweep(mb, [(r * math.cos(a), ARCH_SPRING + r * math.sin(a)) for a in angs], AS._casing_profile(b, 0.075),
              lambda p, h: M6 @ Vector((p[0], -h, p[1])), closed=False, mat=stone, uv_size=sz, cap0=True, cap1=True)
    AS._keystone(mb, M6, 0.0, ARCH_APEX - 0.04, 9.30, 0.24, 0.32, 0.09, 0.18, sz, cap_h=0.05)
    arch_trim = mb.build("Architecture_Rotunda_ArchSurround", col, sharp=35.0)
    fr = C.panel_frame("Architecture_Rotunda_MottoFrame", 3.1, 0.62, _TAB_PROF, mat(CARVED))
    C.uv_box(fr, sz)
    _local(fr, M6 @ Matrix.Translation((0, 0, 9.80)))
    fld = AW._box("Architecture_Rotunda_MottoField", (-1.505, -0.012, 9.80 - 0.265), (1.505, 0.0, 9.80 + 0.265), "signage", 0.0, 1)
    _local(fld, M6)
    out.append(C.join([arch_trim, fr, fld], "Architecture_Rotunda_ArchSurround"))
    C.move_to(out[-1], col)
    # Gilt lettering.
    letters = []
    for k, name in NAMES.items():
        t, _ = AW._text(f"Architecture_Rotunda_Name_{k:02d}", name, 0.215, 0.006, "gilt", (0.0, REC_D - 0.012 - 0.003, TAB_Z),
                        face="-y", font=FONT, spacing=1.12)
        letters.append(_local(_drop_back(t), bay_matrix(k)))
    t, _ = AW._text("Architecture_Rotunda_Motto", MOTTO, 0.22, 0.006, "gilt", (0.0, -0.015, 9.80), face="-y", font=FONT, spacing=1.12)
    letters.append(_local(_drop_back(t), M6))
    ins = C.join(letters, "Architecture_Rotunda_Inscriptions")
    C.move_to(ins, col)
    out.append(ins)
    # Oculi.
    oc = AW.build_oculus(diameter=OC_D, wall_thickness=WT - REC_D, name="Architecture_Rotunda_Oculus_01")
    C.move_to(oc, col)
    _decimate(oc, OCULUS_TRIS)
    for i, k in enumerate(bays):
        M = bay_matrix(k) @ Matrix.Translation((0, REC_D, OC_Y - OC_D / 2))
        ob = oc if i == 0 else _link_copy(oc, f"Architecture_Rotunda_Oculus_{i + 1:02d}", M, col)
        ob.matrix_world = M
        out.append(ob)
    return out


def build_cornice(col):
    """Fascia band 10.40 - 10.60 and the hall cornice remapped to 10.60 - 11.00, round all 12 bays."""
    loop = [_xy(corner_pt(c)) for c in range(NS)]
    mb = AS._MB()
    stone = mb.mi(CARVED)
    sz = tex(CARVED)
    fprof = AS._prof([(0.0, FASCIA_Z), (0.16, FASCIA_Z), (0.16, FASCIA_Z + 0.065)],
                     AS._arc(0.16, FASCIA_Z + 0.072, 0.007, -90, 90, 4)[1:],
                     [(0.166, FASCIA_Z + 0.08), (0.166, FASCIA_Z + 0.145)],
                     AS._cyma_reversa((0.166, FASCIA_Z + 0.145), (0.19, FASCIA_Z + 0.185), 5)[1:],
                     [(0.192, FASCIA_Z + 0.188), (0.192, CORNICE_Y), (AS.FRIEZE_D, CORNICE_Y)], r=0.0015)
    AS._sweep(mb, loop, fprof, AS._plan3d(), closed=True, mat=stone, uv_size=sz)
    fascia = mb.build("Architecture_Rotunda_Fascia", col, sharp=35.0)
    mb = AS._MB()
    stone = mb.mi(CARVED)
    AS._sweep(mb, loop, AS._cornice_profile(), AS._plan3d(), closed=True, mat=stone, uv_size=sz)
    segs = AS._segments(loop)
    kinds = AS._loop_corner_kinds(loop)
    for i, seg in enumerate(segs):
        AS._enrich_segment(mb, seg, kinds[i], kinds[(i + 1) % len(segs)], False)   # no egg-and-dart (budget)
    ob = mb.build("Architecture_Rotunda_Cornice", col, sharp=35.0)
    kz = (SPRING_Y - CORNICE_Y) / (P.HALL_CEILING - AS.FRIEZE_Z1)
    for v in ob.data.vertices:
        v.co.z = CORNICE_Y + (v.co.z - AS.FRIEZE_Z1) * kz
    ob.data.update()
    _decimate(ob, int(C.tris(ob) * CORNICE_KEEP), 35.0)
    return [fascia, ob]


# ---------------------------------------------------------------------------
# Dome
# ---------------------------------------------------------------------------

def dome_pt(u, s, h=0.0):
    """Canonical gore 0 (relative to O, bay direction +X); u in [-1, 1] across (+1 toward bay 1)."""
    a, z, ph = _mer(s)
    w = _blend_w(s)
    al = -(w * math.atan(u * T15) + (1 - w) * u * math.pi / NS)
    rho = a / math.cos(al) ** w
    p = Vector((rho * math.cos(al), rho * math.sin(al), z))
    if h:
        p += h * Vector((math.cos(ph), 0.0, math.sin(ph)))
    return p


def _coffer_P(x, s, h):
    a, z, ph = _mer(s)
    return Vector((a + h * math.cos(ph), -x, z + h * math.sin(ph)))


def dome_rows():
    rows, s = [], S_BASE
    for _ in range(N_ROWS):
        h = 1.6
        for _ in range(12):
            h = (1 - G_F - M_F) * _hw_d(s + h / 2)
        band = 0.10 * _hw_d(s + h)
        rows.append((s, s + h, band))
        s += h + band
    f = (S_B0 - S_BASE) / (s - S_BASE)
    out, s = [], S_BASE
    for s0, s1, band in rows:
        h = (s1 - s0) * f
        out.append((s, s + h))
        s += h + band * f
    return out


def _coffer(name, s0, s1, ul, ur, prof, panel_key, col):
    N = N_SIDE
    ss = [s0 + (s1 - s0) * j / N for j in range(N + 1)]
    outline = [(ul * _hw_d(s), s) for s in ss] + [(ur * _hw_d(s), s) for s in reversed(ss)]
    rings = [AS._offset_path(outline, p[0], closed=True) for p in prof]
    xc = sum(p[0] for p in outline) / len(outline)
    room = _coffer_P(xc, (s0 + s1) / 2, -1.5)
    mb = AS._MB()
    mis = [mb.mi(FRAME), mb.mi("gilt"), mb.mi(panel_key)]
    sz = tex(FRAME)
    q = [0.0]
    for a, b in zip(prof, prof[1:]):
        q.append(q[-1] + math.hypot(b[0] - a[0], b[2] - a[2]))
    n = len(outline)
    for j in range(len(prof) - 1):
        A, B = rings[j], rings[j + 1]
        hA, hB = prof[j][2], prof[j + 1][2]
        mi = prof[j + 1][3] if prof[j][3] == prof[j + 1][3] else 0
        u = 0.0
        for e in range(n):
            e2 = (e + 1) % n
            pts = [_coffer_P(A[e].x, A[e].y, hA), _coffer_P(A[e2].x, A[e2].y, hA), _coffer_P(B[e2].x, B[e2].y, hB),
                   _coffer_P(B[e].x, B[e].y, hB)]
            L = (A[e2] - A[e]).length
            uvs = [(u / sz, q[j] / sz), ((u + L) / sz, q[j] / sz), ((u + L) / sz, q[j + 1] / sz), (u / sz, q[j + 1] / sz)]
            u += L
            fc = sum(pts, Vector()) / 4
            pts, uvs = AS._orient([tuple(p) for p in pts], uvs, room - fc)
            mb.face(pts, uvs, mis[mi])
    # Painted panel: rows of quads across, UV 0..1 over the trapezoid.
    Cr = rings[-1]
    hC = prof[-1][2]
    left = Cr[0:N + 1]
    right = list(reversed(Cr[N + 1:2 * N + 2]))
    sb, stp = left[0].y, left[-1].y
    vv = lambda s: (s - sb) / (stp - sb)
    for j in range(N):
        pts = [_coffer_P(left[j].x, left[j].y, hC), _coffer_P(right[j].x, right[j].y, hC),
               _coffer_P(right[j + 1].x, right[j + 1].y, hC), _coffer_P(left[j + 1].x, left[j + 1].y, hC)]
        uvs = [(0.0, vv(left[j].y)), (1.0, vv(right[j].y)), (1.0, vv(right[j + 1].y)), (0.0, vv(left[j + 1].y))]
        fc = sum(pts, Vector()) / 4
        pts, uvs = AS._orient([tuple(p) for p in pts], uvs, room - fc)
        mb.face(pts, uvs, mis[2])
    ob = mb.build(name, col, sharp=40.0)
    wp = ((right[0].x - left[0].x) + (right[-1].x - left[-1].x)) / 2
    hp = stp - sb
    xm = (left[0].x + left[-1].x + right[0].x + right[-1].x) / 4
    return ob, (xm, (sb + stp) / 2, hC), abs(wp), hp


def _rosette_matrix(x, s, h):
    p = _coffer_P(x, s, h)
    ph = _mer(s)[2]
    X = Vector((0.0, -1.0, 0.0))
    Zl = Vector((math.cos(ph), 0.0, math.sin(ph)))
    Y = Zl.cross(X)
    return Matrix(((X.x, Y.x, Zl.x, p.x), (X.y, Y.y, Zl.y, p.y), (X.z, Y.z, Zl.z, p.z), (0, 0, 0, 1)))


def _gore_surface(rows, col):
    mb = AS._MB()
    st = mb.mi(FRAME)
    sz = tex(FRAME)
    ucols = sorted({round(v, 6) for v in [-1, -(1 - G_F), -M_F, M_F, 1 - G_F, 1] + [-1 + 2 * i / 12 for i in range(13)]})
    holes = [(-(1 - G_F), -M_F), (M_F, 1 - G_F)]
    iv = []

    def add(sa, sb, nseg, row):
        for j in range(nseg):
            iv.append((sa + (sb - sa) * j / nseg, sa + (sb - sa) * (j + 1) / nseg, row))

    add(0.0, S_BASE, 2, False)
    for i, (s0, s1) in enumerate(rows):
        add(s0, s1, N_SIDE, True)
        add(s1, rows[i + 1][0] if i + 1 < len(rows) else S_B0, 1, False)
    add(S_B0, S_END, 8, False)
    axis = Vector((0.0, 0.0, 9.0))
    for sa, sb, row in iv:
        for ua, ub in zip(ucols, ucols[1:]):
            um = (ua + ub) / 2
            if row and any(h0 < um < h1 for h0, h1 in holes):
                continue
            pts = [dome_pt(ua, sa), dome_pt(ub, sa), dome_pt(ub, sb), dome_pt(ua, sb)]
            fc = sum(pts, Vector()) / 4
            pts, _ = AS._orient([tuple(p) for p in pts], None, axis - fc)
            mb.pface([Vector(p) for p in pts], st, sz)
    for ua, ub in zip(ucols, ucols[1:]):      # skirt into the cornice top
        pts = [dome_pt(ua, 0.0), dome_pt(ub, 0.0), dome_pt(ub, 0.0) - Z * 0.05, dome_pt(ua, 0.0) - Z * 0.05]
        pts, _ = AS._orient([tuple(p) for p in pts], None, Vector((-1, 0, 0)))
        mb.pface([Vector(p) for p in pts], st, sz)
    return mb.build("Architecture_Rotunda_Dome_Gore_00", col, sharp=30.0)


def _rib(col):
    """Groin rib between gore 0 and gore 1 (canonical): gilt beads and an ornament_band face, the
    edges seated on the two gore surfaces, tapering with the gores."""
    half = [(-0.165, -0.03), (-0.165, 0.0), (-0.155, 0.010), (-0.140, 0.014)]
    mats = ["S", "S", "S"]
    for a in (150, 120, 90, 60, 30, 0):
        half.append((-0.128 + 0.012 * math.cos(math.radians(a)), 0.014 + 0.012 * math.sin(math.radians(a))))
        mats.append("G")
    half += [(-0.108, 0.020), (-0.102, 0.034), (-0.095, 0.046), (-0.085, 0.052)]
    mats += ["S", "S", "S", "S"]
    prof = half + [(-u, h) for u, h in reversed(half)]
    smats = mats + ["O"] + list(reversed(mats))
    cdir = Vector((math.cos(-math.pi / NS), math.sin(-math.pi / NS), 0.0))
    bdir = Vector((-cdir.y, cdir.x, 0.0))
    mb = AS._MB()
    mis = {"S": mb.mi(FRAME), "G": mb.mi("gilt"), "O": mb.mi("ornament_band")}
    sz = tex(FRAME)
    ns = 40
    ss = [-0.05 + (S_END + 0.09) * i / ns for i in range(ns + 1)]
    frames = []
    for s in ss:
        _, _, ph = _mer(s)
        w = _blend_w(s)
        G = dome_pt(1.0, s)
        n_out = (math.cos(ph) * (C15 ** w) * cdir + math.sin(ph) * Z).normalized()
        cd = math.cos(ph) ** 2 * math.cos(math.radians(30 * w)) + math.sin(ph) ** 2
        lift = 0.165 * math.tan(math.acos(max(-1.0, min(1.0, cd))) / 2)
        wsc = _hw_d(s) / _hw_d(0.0)
        frames.append([G + bdir * (u * wsc) - n_out * (h + lift) for u, h in prof])
    qacc = [0.0]
    for a, b in zip(prof, prof[1:]):
        qacc.append(qacc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    ucum = [0.0]
    for i in range(1, len(ss)):
        fw = 0.17 * _hw_d(ss[i]) / _hw_d(0.0)
        ucum.append(ucum[-1] + (frames[i][len(half)] - frames[i - 1][len(half)]).length / (2 * fw))
    lacc = [0.0]
    for i in range(1, len(ss)):
        lacc.append(lacc[-1] + (frames[i][0] - frames[i - 1][0]).length)
    axis = Vector((0.0, 0.0, 9.0))
    for i in range(len(ss) - 1):
        for j in range(len(prof) - 1):
            key = smats[j]
            pts = [frames[i][j], frames[i + 1][j], frames[i + 1][j + 1], frames[i][j + 1]]
            if key == "O":
                uvs = [(ucum[i], 0.0), (ucum[i + 1], 0.0), (ucum[i + 1], 1.0), (ucum[i], 1.0)]
            else:
                uvs = [(lacc[i] / sz, qacc[j] / sz), (lacc[i + 1] / sz, qacc[j] / sz), (lacc[i + 1] / sz, qacc[j + 1] / sz),
                       (lacc[i] / sz, qacc[j + 1] / sz)]
            fc = sum(pts, Vector()) / 4
            nrm = AS._newell([tuple(p) for p in pts])
            pts, uvs = AS._orient([tuple(p) for p in pts], uvs, axis - fc)
            mb.face(pts, uvs, mis[key])
    return mb.build("Architecture_Rotunda_Dome_Rib_00", col, sharp=40.0)


_RING = [
    ((4.30, 16.74), "S"), ((4.04, 16.775), "G"),
]


def _ring_profile():
    pts = [(4.30, 16.74), (4.04, 16.775)]
    mats = ["S"]
    for a in (-30, -60, -90, -120, -150, -180):
        pts.append((4.0 + 0.03 * math.cos(math.radians(a)), 16.775 + 0.03 * math.sin(math.radians(a))))
        mats.append("G")
    pts += [(3.955, 16.79), (3.94, 16.82), (3.915, 16.85), (3.88, 16.87), (3.84, 16.878), (3.74, 16.878)]
    mats += ["S"] * 6
    for a in (-112.5, -135, -157.5, -180):
        pts.append((3.74 + 0.042 * math.cos(math.radians(a)), 16.92 + 0.042 * math.sin(math.radians(a))))
        mats.append("G")
    pts += [(3.69, 16.93), (3.69, 16.95), (3.605, 16.96), (3.60, 16.975), (SKY_R, CROWN_Y), (SKY_R, CURB_Z - 0.03),
            (SKY_R, CURB_Z), (3.98, CURB_Z), (3.98, 17.10)]
    mats += ["S", "S", "S", "S", "S", "O", "S", "S", "S"]
    return pts, mats


def build_dome(col):
    out = []
    rows = dome_rows()
    prof = ACE.tile_profile(1.0, 1.0, "rich", recess=COFFER_RECESS)[0]
    prof = [(p[0], p[1], p[2], p[3]) for p in prof]
    gore = _gore_surface(rows, col)
    rib = _rib(col)
    srcs = []
    for i, (s0, s1) in enumerate(rows):
        for side in (1, -1):
            ul, ur = (M_F, 1 - G_F) if side > 0 else (-(1 - G_F), -M_F)
            key = "coffer_panel" if (i + (1 if side > 0 else 0)) % 2 == 0 else "coffer_red"
            ob, (xm, sm, hC), wp, hp = _coffer(f"Architecture_Rotunda_Dome_Coffer_R{i + 1}{'E' if side > 0 else 'W'}_00",
                                               s0, s1, ul, ur, prof, key, col)
            bm = ACE.rosette_bm(R_=0.205 * max(wp, hp), petals=8)
            ro = C.mesh_from_bmesh(f"Architecture_Rotunda_Dome_Rosette_R{i + 1}{'E' if side > 0 else 'W'}_00", bm, [mat("gilt")], col=col)
            srcs.append((ob, ro, _rosette_matrix(xm, sm, hC - 0.001)))
    for k in range(NS):
        Mk = _rot_about_O(k)
        for src in (gore, rib):
            ob = src if k == 0 else _link_copy(src, src.name[:-2] + f"{k:02d}", Mk, col)
            ob.matrix_world = Mk
            out.append(ob)
        for cof, ros, Mr in srcs:
            for src, M in ((cof, Mk), (ros, Mk @ Mr)):
                ob = src if k == 0 else _link_copy(src, src.name[:-2] + f"{k:02d}", M, col)
                ob.matrix_world = M
                out.append(ob)
    # Skylight ring.
    pts, mats = _ring_profile()
    mb = AS._MB()
    mis = {"S": mb.mi(FRAME), "G": mb.mi("gilt"), "O": mb.mi("ornament_band")}
    period = math.tau * SKY_R / 27
    qacc = [0.0]
    for a, b in zip(pts, pts[1:]):
        qacc.append(qacc[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))

    def uvf(key, a, r, z, j, end):
        if key == "O":
            return (a * SKY_R / period, (z - CROWN_Y) / (CURB_Z - 0.03 - CROWN_Y))
        return (a * r / 1.5, qacc[j + end] / 1.5)

    _lathe(mb, pts, mats, mis, 96, uvf, outward_left=False)
    ring = mb.build("Architecture_Rotunda_Dome_Ring", col, sharp=40.0)
    ring.location = O
    out.append(ring)
    return out


def _glass_z(r):
    rg = (GLASS_R0 ** 2 + GLASS_RISE ** 2) / (2 * GLASS_RISE)
    return GLASS_Z0 + math.sqrt(rg * rg - r * r) - math.sqrt(rg * rg - GLASS_R0 ** 2)


def build_skylight(col):
    out = []
    # Glass cap.
    mb = AS._MB()
    gl = {"G": mb.mi("glass_window")}
    gpts = [(GLASS_R0 * (1 - i / 10), _glass_z(GLASS_R0 * (1 - i / 10))) for i in range(11)]
    _lathe(mb, gpts[:-1] + [(0.0005, gpts[-1][1])], ["G"] * 10, gl, 96, lambda *a: (a[1] / math.tau, a[2] / 4), outward_left=True)
    g = mb.build("Architecture_Rotunda_Skylight_Glass", col, sharp=80.0)
    g.location = O
    out.append(g)
    # Iron curb ring and hub pendant (lathes).
    mb = AS._MB()
    mi = {"I": mb.mi("iron"), "A": mb.mi("brass_aged")}
    curb = [(3.56, CURB_Z), (3.82, CURB_Z), (3.82, GLASS_Z0), (3.56, GLASS_Z0), (3.56, CURB_Z)]
    _lathe(mb, curb, ["I"] * 4, mi, 96, lambda key, a, r, z, j, e: (a * r / 0.3, z / 0.3), outward_left=False)
    apex = _glass_z(0.0)
    hub = [(0.0, CROWN_Y), (0.10, CROWN_Y), (0.115, CROWN_Y + 0.015), (0.115, CROWN_Y + 0.045), (0.085, CROWN_Y + 0.06),
           (0.06, CROWN_Y + 0.10), (0.05, CROWN_Y + 0.16), (0.058, CROWN_Y + 0.18), (0.058, CROWN_Y + 0.20),
           (0.045, CROWN_Y + 0.22), (0.042, apex - 0.42), (0.06, apex - 0.36), (0.075, apex - 0.30), (0.07, apex - 0.24),
           (0.055, apex - 0.20), (0.07, apex - 0.17), (0.07, apex - 0.15), (0.12, apex - 0.10), (0.20, apex - 0.085),
           (0.21, apex - 0.075), (0.21, apex - 0.012), (0.0, apex - 0.008)]
    hm = ["I", "A", "A", "A", "I", "I", "A", "A", "I", "I", "I", "I", "I", "I", "A", "A", "I", "I", "I", "I", "I"]
    _lathe(mb, hub, hm, mi, 32, lambda key, a, r, z, j, e: (a * max(r, 0.02) / 0.3, z / 0.3), outward_left=False)
    lo = mb.build("Architecture_Rotunda_Skylight_Curb", col, sharp=40.0)
    lo.location = O
    out.append(lo)
    # T-section glazing bars: 24 radial ribs (instanced) and 4 ring bars, under the glass.
    T = [(-0.028, 0.0), (0.028, 0.0), (0.028, -0.008), (0.007, -0.010), (0.007, -0.056), (0.011, -0.060), (0.011, -0.068),
         (-0.011, -0.068), (-0.011, -0.060), (-0.007, -0.056), (-0.007, -0.010), (-0.028, -0.008), (-0.028, 0.0)]
    rr = [3.80 - (3.80 - 0.16) * i / 14 for i in range(15)]
    path = [(r, 0.0, _glass_z(r) - 0.004) for r in rr]
    rad = C.sweep("Architecture_Rotunda_Skylight_Rib_00", T, path, mat("iron"), up=(0, 0, 1))
    C.uv_box(rad, 0.3)
    for k in range(24):
        M = Matrix.Translation(O) @ Matrix.Rotation(math.tau * k / 24 + math.pi / 24, 4, "Z")
        ob = rad if k == 0 else _link_copy(rad, f"Architecture_Rotunda_Skylight_Rib_{k:02d}", M, col)
        ob.matrix_world = M
        C.move_to(ob, col) if k == 0 else None
        out.append(ob)
    rings = []
    for i, r in enumerate((3.05, 2.30, 1.55, 0.85)):
        pth = [(r * math.cos(math.tau * j / 96), r * math.sin(math.tau * j / 96), _glass_z(r) - 0.014) for j in range(96)]
        ob = C.sweep(f"Architecture_Rotunda_Skylight_RingBar_{i}", T, pth, mat("iron"), closed_path=True, up=(0, 0, 1))
        rings.append(ob)
    rb = C.join(rings, "Architecture_Rotunda_Skylight_RingBars")
    C.uv_box(rb, 0.3)
    rb.location = O
    C.move_to(rb, col)
    out.append(rb)
    C.empty("Anchor_Ceiling_rotunda_crown", O + Vector((0, 0, CROWN_Y)), col=col, kind="SINGLE_ARROW")
    return out


def build_exterior(col):
    out = []
    mb = AS._MB()
    lead = mb.mi("lead_roof")
    poly = [(corner_pt(c) - O).to_2d() for c in range(NS)]
    circ = [(OUT_R0 * math.cos(math.tau * i / 96), OUT_R0 * math.sin(math.tau * i / 96)) for i in range(96)]
    _tess(mb, [(p.x, p.y) for p in poly], [circ], lambda x, y: Vector((x, y, WALL_TOP)), Z, lead, tex("lead_roof"))
    ro = _MR + OUT_OFF
    zc = SPRING_Y + math.sqrt(ro * ro - (OUT_R0 - _MC) ** 2)
    ph0 = math.atan2(zc - SPRING_Y, OUT_R0 - _MC)
    ph1 = math.asin((CURB_Z - 0.005 - SPRING_Y) / ro)
    pts = [(OUT_R0, WALL_TOP - 0.01), (OUT_R0, zc)]
    pts += [(_MC + ro * math.cos(ph0 + (ph1 - ph0) * i / 16), SPRING_Y + ro * math.sin(ph0 + (ph1 - ph0) * i / 16)) for i in range(1, 17)]
    _lathe(mb, pts, ["L"] * (len(pts) - 1), {"L": lead}, 96, lambda key, a, r, z, j, e: (a * r / 2.0, z / 2.0), outward_left=False)
    ob = mb.build("Architecture_Rotunda_Exterior_Roof", col, sharp=30.0)
    ob.location = O
    out.append(ob)
    return out


# ---------------------------------------------------------------------------
# Floor
# ---------------------------------------------------------------------------

def build_floor(col):
    rng = random.Random(1201)
    mb = AS._MB()
    o2 = O.to_2d()

    def uv_dir(d, size, jitter=True):
        d = Vector(d).normalized()
        pp = Vector((-d.y, d.x))
        ou, ov = (rng.random() * 4, rng.random() * 4) if jitter else (0.0, 0.0)
        return lambda p: ((p - o2).dot(d) / size + ou, (p - o2).dot(pp) / size + ov)

    def put(poly, key, uvf, tess=False):
        m = mb.mi(key)
        poly = [Vector(p) for p in poly]
        if tess:
            flat = [Vector((p.x, p.y, 0)) for p in poly]
            tris = tessellate_polygon([flat])
            faces = [[poly[i] for i in t] for t in tris]
        else:
            faces = [poly]
        for f in faces:
            pts = [(p.x, p.y, 0.0) for p in f]
            uvs = [uvf(p) for p in f]
            pts, uvs = AS._orient(pts, uvs, Z)
            mb.face(pts, uvs, m)

    pol = lambda r, a: o2 + Vector((r * math.cos(a), r * math.sin(a)))
    planar = lambda size: (lambda p: (p.x / size, p.y / size))

    def annulus(r0, r1, key, n=192, size=1.0):
        for i in range(n):
            a0, a1 = math.tau * i / n, math.tau * (i + 1) / n
            put([pol(r0, a0), pol(r1, a0), pol(r1, a1), pol(r0, a1)], key, planar(size))

    # Medallion + a layered sixteen-point compass star: the four cardinal points (on the arch / exit
    # axis) lie over the four intercardinals, which lie over eight short points; each point is a
    # kite split along its axis into a light and a dark half, on a dark walnut field. The layering
    # is resolved exactly in polar strips (breakpoints on the 192-gon of the rings and at every
    # edge crossing), so the inlay is one flat, non-overlapping sheet.
    RV, RF = 0.58, 3.30
    NR, NM = 192, 32
    put([pol(0.50, math.tau * i / NM) for i in range(NM)], "marble_cream", planar(tex("marble_cream")), tess=True)
    annulus(0.50, RV, "marble_verde", n=NM)
    kites = [(math.radians(90 * i), RF - 0.035, math.radians(45), 0.98, "oak_light", "mahogany") for i in range(4)]
    kites += [(math.radians(45 + 90 * i), 2.85, math.radians(45), 0.80, "oak", "walnut") for i in range(4)]
    kites += [(math.radians(22.5 + 45 * i), 2.45, math.radians(22.5), 0.72, "oak_light", "oak") for i in range(8)]

    def gon_r(r, n, a):
        k = math.floor(a / (math.tau / n))
        return r * math.cos(math.pi / n) / math.cos(a - math.tau * (k + 0.5) / n)

    def kite_r(kt, a):
        b, R, w, rv = kt[:4]
        d = math.remainder(a - b, math.tau)
        if abs(d) > w + 1e-9:
            return None
        sy = rv * math.sin(w) * (1.0 if d >= 0 else -1.0)
        sx = rv * math.cos(w)
        ex, ey = R - sx, -sy
        ux, uy = math.cos(d), math.sin(d)
        return (sx * ey - sy * ex) / (ux * ey - uy * ex)

    def bands(a):
        """[(owner, r0, r1)] outward from the medallion; owner -1 is the walnut field."""
        out, cur = [], gon_r(RV, NM, a)
        for i, kt in enumerate(kites):
            r = kite_r(kt, a)
            if r is not None and r > cur + 1e-7:
                out.append((i, cur, r))
                cur = r
        out.append((-1, cur, gon_r(RF, NR, a)))
        return out

    def owners(a):
        return tuple(o for o, r0, r1 in bands(a) if r1 - r0 > 1e-6)

    brk = [math.tau * i / NR for i in range(NR + 1)]
    for i in range(NR):
        a0 = brk[i]
        prev = owners(a0 + 1e-7)
        for j in range(1, 61):
            a1 = brk[i] + (brk[i + 1] - brk[i]) * j / 60
            cur = owners(a1 - 1e-7)
            if cur != prev:
                lo, hi = a1 - (brk[i + 1] - brk[i]) / 60, a1
                for _ in range(48):
                    mid = (lo + hi) / 2
                    if owners(mid) == prev:
                        lo = mid
                    else:
                        hi = mid
                brk.append((lo + hi) / 2)
                prev = cur
    brk = sorted(set(round(x, 12) for x in brk))
    uvs = {}

    def band_at(o, a):
        for oo, r0, r1 in bands(a):
            if oo == o:
                return r0, r1
        lo = gon_r(RV, NM, a)
        for i, kt in enumerate(kites[:o] if o >= 0 else kites):
            r = kite_r(kt, a)
            if r is not None:
                lo = max(lo, r)
        return lo, lo

    for a0, a1 in zip(brk, brk[1:]):
        if a1 - a0 < 1e-9:
            continue
        am = (a0 + a1) / 2
        for o in owners(am):
            (l0, h0), (l1, h1) = band_at(o, a0), band_at(o, a1)
            pts = [pol(l0, a0)] + ([pol(h0, a0)] if h0 - l0 > 1e-7 else []) + [pol(h1, a1)] + ([pol(l1, a1)] if h1 - l1 > 1e-7 else [])
            if len(pts) < 3:
                continue
            if o < 0:
                key, uvf = "walnut_dark", planar(tex("walnut_dark"))
            else:
                b = kites[o][0]
                half = 4 if math.remainder(am - b, math.tau) < 0 else 5
                key = kites[o][half]
                if (o, half) not in uvs:
                    uvs[(o, half)] = uv_dir((math.cos(b), math.sin(b)), tex(key))
                uvf = uvs[(o, half)]
            put(pts, key, uvf)
    annulus(RF, RF + 0.06, "marble_verde", n=NR)
    annulus(RF + 0.06, RF + 0.38, "marble_cream", n=NR, size=tex("marble_cream"))
    annulus(RF + 0.38, RF + 0.44, "marble_verde", n=NR)

    corners = [(corner_pt(c) - O).to_2d() for c in range(NS)]

    def r_gon(a, ap):
        best = min(range(NS), key=lambda k: abs(math.remainder(a - theta(k), math.tau)))
        return ap / math.cos(math.remainder(a - theta(best), math.tau))

    def boards(r0, r1, key, gon=None):
        n = max(24, round(math.tau * r0 / 0.15))
        for i in range(n):
            a0, a1 = math.tau * i / n, math.tau * (i + 1) / n
            if gon is None:
                outer = [pol(r1, a1), pol(r1, a0)]
            else:
                outer = [pol(r_gon(a1, gon), a1)]
                for c in range(NS):
                    ca = theta(c) - math.pi / NS
                    if 0 < math.remainder(ca - a0, math.tau) < a1 - a0:
                        outer.append(pol(gon / C15, ca))
                outer.append(pol(r_gon(a0, gon), a0))
            am = (a0 + a1) / 2
            put([pol(r0, a0), pol(r0, a1)] + outer, key, uv_dir((math.cos(am), math.sin(am)), tex(key)))

    boards(RF + 0.44, 4.94, "oak")
    annulus(4.94, 5.02, "walnut", size=tex("walnut"))
    boards(5.02, 6.50, "oak")
    annulus(6.50, 6.58, "walnut", size=tex("walnut"))
    boards(6.58, None, "oak", gon=7.62)

    def gon_band(a0, a1, key):
        for k in range(NS):
            c0, c1 = (k - 1) % NS, k
            p = [o2 + (corners[c0]) * (a0 / AP), o2 + corners[c1] * (a0 / AP), o2 + corners[c1] * (a1 / AP), o2 + corners[c0] * (a1 / AP)]
            put(p, key, uv_dir(that(k).to_2d(), tex(key)))

    gon_band(7.62, 7.70, "oak_light")
    for a0, a1 in ((7.70, 7.95), (7.95, 8.20), (8.20, 8.45)):
        gon_band(a0, a1, "walnut")
    # Marble threshold through the hall arch.
    x1 = O.x - 8.45
    y0, y1 = -(RC[1] + ARCH_W / 2), -(RC[1] - ARCH_W / 2)
    put([(P.HALL["maxX"], y0), (x1, y0), (x1, y1), (P.HALL["maxX"], y1)], "marble_cream", planar(tex("marble_cream")))
    ob = mb.build("Architecture_Rotunda_Floor", col, sharp=10.0)
    for p in ob.data.polygons:
        p.use_smooth = False
    base = C.prism("Architecture_Rotunda_Floor_Base", _ccw([o2 + c * (8.5 / AP) for c in corners]), -0.2, -0.003, mat("stone_tiles"), col=col)
    return [ob, base]


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def build_rotunda():
    """The whole Reference Rotunda architecture, in place. Returns the objects."""
    col = _col()
    out = []
    steps = (("walls", build_walls), ("columns", build_columns), ("entablature", build_entablature),
             ("responds", build_responds), ("dressing", build_bay_dressing), ("upper", build_upper_tier),
             ("cornice", build_cornice), ("dome", build_dome), ("skylight", build_skylight),
             ("exterior", build_exterior), ("floor", build_floor))
    for name, fn in steps:
        t = time.time()
        out += fn(col)
        print(f"arch_rotunda: {name} {time.time() - t:.1f}s")
    return out


build = build_rotunda


def _tris(ob):
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons) if ob.type == "MESH" else 0
    return n + sum(_tris(ch) for ch in ob.children)


GROUPS = [("walls", "Wall_"), ("columns", "Column_"), ("ground entablature", "Entablature"), ("responds", "Responds"),
          ("bay dressing + exit door", ("BayDressing", "Door_")), ("upper tier mouldings + strips", ("UpperMouldings", "Strips")),
          ("recess trims", "RecessTrim"), ("arch surround", "ArchSurround"), ("inscriptions", "Inscriptions"),
          ("oculi", "Oculus"), ("fascia + cornice", ("Fascia", "Cornice")), ("dome gores", "Dome_Gore"),
          ("dome ribs", "Dome_Rib"), ("dome coffers", "Dome_Coffer"), ("dome rosettes", "Dome_Rosette"),
          ("skylight ring", "Dome_Ring"), ("skylight glass + iron", "Skylight_"), ("exterior", "Exterior"),
          ("floor", "Floor")]


def report(objs):
    roots = [o for o in objs if o.parent is None]
    total, dome = 0, 0
    print("arch_rotunda triangles:")
    for label, pre in GROUPS:
        pres = pre if isinstance(pre, tuple) else (pre,)
        n = sum(_tris(o) for o in roots if any(o.name.startswith("Architecture_Rotunda_" + p) for p in pres))
        total += n
        if label.startswith(("dome", "skylight")):
            dome += n
        print(f"  {label:32s} {n:8d}")
    print(f"  {'TOTAL (budget 450k)':32s} {total:8d}")
    print(f"  {'dome + skylight (budget 150k)':32s} {dome:8d}")
    return total, dome


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _hall_context():
    col = C.collection("Hall_Context")
    out = []
    try:
        w = next(w for w in P.WALLS if w.id == "hall_e")
        out.append(AS.build_wall(w, col=col))
        o = next(o for o in w.openings if o.id == "arch_rotunda")
        out.append(AS.build_arch_surround(o, w, col=col))
    except Exception as e:  # noqa: BLE001
        print("arch_rotunda: hall context failed:", repr(e))
    pl = mat("plaster")
    out.append(C.box_minmax("Ctx_HallFloor", (4.0, -8.0, -0.2), (14.0, 10.0, 0.0), mat("parquet_herringbone"), col=col))
    C.uv_box(out[-1], tex("parquet_herringbone"))
    out.append(C.box_minmax("Ctx_HallCeiling", (4.0, -8.8, 12.6), (14.8, 10.8, 12.9), pl, col=col))
    out.append(C.box_minmax("Ctx_HallWest", (3.6, -8.8, 0.0), (4.0, 10.8, 12.6), pl, col=col))
    out.append(C.box_minmax("Ctx_HallNorth", (4.0, 10.0, 0.0), (14.0, 10.8, 12.6), mat("limestone"), col=col))
    out.append(C.box_minmax("Ctx_HallSouth", (4.0, -8.8, 0.0), (14.0, -8.0, 12.6), mat("limestone"), col=col))
    out.append(C.box_minmax("Ctx_Ground", (-40, -40, -0.32), (80, 40, -0.2), mat("stone_tiles"), col=col))
    return out


def _standins():
    col = C.collection("Standins")
    out = []
    for it in P.ITEMS:
        if it.zone != "reference":
            continue
        k = P.KINDS[it.kind]
        w, d, h = it.w or k["w"], it.d or k["d"], k["h"]
        nm = f"Standin_{it.id}"
        if it.kind == "desk_research_ring":
            ob = C.lathe(nm, [(1.25, 0.0), (1.9, 0.0), (1.9, 1.0), (1.95, 1.04), (1.95, 1.08), (1.2, 1.08), (1.2, 0.0)], 96,
                         mat("walnut"), col=col)
        elif it.kind == "globe_floor":
            ob = C.join([C.cylinder(nm + "_s", 0.05, 0.05, 0.8, (0, 0, 0.4), mat("walnut"), col=col),
                         C.sphere(nm + "_g", 0.35, (0, 0, 0.95), mat("oak_light"), col=col)], nm)
        elif it.kind == "chair_reading":
            ob = C.join([C.box(nm + "_s", (w, d, 0.05), (0, 0, 0.44), mat("walnut"), col=col),
                         C.box(nm + "_b", (w, 0.05, 0.5), (0, d / 2, 0.7), mat("walnut"), col=col)], nm)
        elif it.kind in ("table_reading_green", "table_vitrine"):
            parts = [C.box(nm + "_t", (w, d, 0.05), (0, 0, h - 0.025), mat("leather_green" if "reading" in it.kind else "glass"), col=col),
                     C.box(nm + "_a", (w - 0.08, d - 0.08, h - 0.05), (0, 0, (h - 0.05) / 2), mat("walnut"), col=col)]
            ob = C.join(parts, nm)
        else:
            ob = C.box(nm, (w, d, h), (0, 0, h / 2), mat("walnut"), col=col)
        C.place(ob, it.x, it.y, it.z, it.rot)
        out.append(ob)
    return out


def _books():
    import bookcases
    specs = [b for b in P.BOOKCASES if b["id"].startswith("bc_rotunda_")]
    records = []
    for spec in specs:
        objs, slots = bookcases.build_bookcase_run(spec, specs, 1)
        if os.environ.get("ROT_BOOKS", "1") != "0":
            records += bookcases.fill_slots(slots, bookcases._crc(1, spec["id"]))
    if records:
        bookcases.instance_books(records)


SHOTS = {
    "arch_east": dict(loc=(15.25, 1.7, -1.0), at=(31.0, 7.2, -1.0), lens=16),
    "dome": dict(loc=(21.6, 1.5, 0.8), at=(23.4, 17.0, -1.0), lens=14),
    "bookbay": dict(loc=(24.6, 1.75, 1.6), at=(23.4, 2.7, 7.4), lens=20),
    "capital": None,
    "oculus": dict(loc=(23.4, 6.2, 2.4), at=(23.4, 8.5, 7.4), lens=30),
    "skylight": dict(loc=(23.55, 2.0, -0.95), at=(23.4, 17.6, -1.0), lens=24),
    "arch_west": dict(loc=(30.6, 1.7, -1.0), at=(15.0, 6.0, -1.0), lens=17),
    "floor": dict(loc=(23.4, 11.0, 2.6), at=(23.4, 0.0, -0.4), lens=17),     # last: hides the stand-ins
}


def preview(out_dir):
    scene = bpy.context.scene
    t0 = time.time()
    objs = build_rotunda()
    report(objs)
    _hall_context()
    stand = _standins()
    _books()
    print(f"arch_rotunda: scene built in {time.time() - t0:.1f}s")
    day = os.environ.get("ROT_MOOD", "day") == "day"
    sun = R.sun("Sun", direction_web=(-0.42, 1.35, 0.5), strength=float(os.environ.get("ROT_SUN", "28")) if day else 0.0,
                color=(1.0, 0.92, 0.8), angle_deg=1.0)
    R.sky_world(scene, strength=float(os.environ.get("ROT_SKY", "2.2")) if day else 0.04, sun_ob=sun,
                tint=(0.55, 0.7, 0.95) if day else (0.16, 0.22, 0.42))
    ch = R.point_light("Chandelier_Standin", C.bl(RC[0], 7.4, RC[1]), 2600 if day else 4000, (1.0, 0.8, 0.58), 1.0)
    for i, deg in enumerate((45, 135, 225, 315)):
        a = math.radians(deg)
        R.point_light(f"LampPool_{i}", C.bl(RC[0] + math.cos(a) * 4.8, 1.25, RC[1] + math.sin(a) * 4.8), 70, (1.0, 0.82, 0.6), 0.15)
    R.area_light("HallFill", (9.0, 1.0, 9.0), (14.0, 1.0, 3.0), 1800, 5.0, (1.0, 0.88, 0.72))
    size = tuple(int(v) for v in os.environ.get("ROT_SIZE", "960x720").split("x"))
    R.engine(scene, "CYCLES", int(os.environ.get("ROT_SAMPLES", "32")), size)
    if os.environ.get("ROT_DEVICE"):
        scene.cycles.device = os.environ["ROT_DEVICE"]
    scene.view_settings.exposure = float(os.environ.get("ROT_EXPOSURE", "-0.3"))
    scene.cycles.max_bounces = 6
    cam = R.camera(lens=20)
    want = [s for s in os.environ.get("ROT_SHOTS", ",".join(SHOTS)).split(",") if s]
    cpos = next(p for c, p, a in column_points() if c == 2)
    inward = (O - cpos)
    inward.z = 0
    inward.normalize()
    for name in want:
        t = time.time()
        if name == "capital":
            cam.data.lens = 40
            R.look(cam, cpos + inward * 1.9 + Vector((0.5, 0.0, 3.55)), cpos + Vector((0, 0, 4.05)))
        else:
            s = SHOTS[name]
            cam.data.lens = s["lens"]
            R.look(cam, C.bl(*s["loc"]), C.bl(*s["at"]))
        hide = name == "floor"
        for ob in stand:
            ob.hide_render = hide
        R.render(os.path.join(out_dir, f"{name}.png"))
        print(f"arch_rotunda: shot {name} {time.time() - t:.1f}s")
    print(f"arch_rotunda: preview done in {time.time() - t0:.1f}s")
