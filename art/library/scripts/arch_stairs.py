"""
The Entrance Hall's two monumental stair flights, modelled IN PLACE (Blender world coordinates,
converted from plan.STAIRS web coordinates) up the lobby's side walls to the gallery landing.

Each flight (25 risers of 0.184 m, goings of 0.296 m, rising north from web z 18.6 to 11.2; the
25th riser is the landing nosing that arch_gallery.build_landing already builds) has:

  * limestone steps: bullnose nosings with a shadow-line quirk under each, risers, a plastered
    soffit inside the closed under-stair, and a wider CURTAIL first step whose D-end wraps round
    the bottom newel. The nosing line lies exactly on the game's ramp (z 18.6, y 0) -> (11.2, 4.6);
  * the open side (x = +-4.4): a moulded walnut closed string (cap moulding, beads and a gilt
    ornament_band frieze that carries the landing fascia's frieze down the rake, a plain lower board
    and a bottom bead), capped by the gallery's walnut curb, and the gallery's raking balustrade:
    the same turned 12-sided iron balusters (instanced), iron bottom and core rails, the walnut ogee
    handrail, and sheared C-scroll brackets at both newels (arch_gallery's profiles and meshes);
  * newels: a turned/carved walnut bottom newel on the curtail (moulded plinth, beaded sunk panels
    with carved paterae, a cornice cap) carrying a brass NEWEL LAMP STANDARD with four scrolled arms
    and five opal globes (`light_points` / `light_color` custom props), and a top newel at the stair
    head that runs down as the under-stair pilaster carrying the landing's scroll console;
  * the under-stair spandrel closed with walnut panelling (applied bolection mouldings, fielded
    panels, a small lay-on cupboard door with brass knob, escutcheon and hinges) on a moulded
    skirting, and a panelled closure facing north under the landing;
  * the wall side (x = +-6): a moulded walnut wall string, a raking walnut dado of fielded panels
    under a kneed dado rail, and a brass wall handrail on cast brackets, returned to the wall on
    rosettes at both ends.

Public API
    build_stairs() -> list of objects (both flights)
    build_flight(side=+1) -> list of objects (east; side=-1 is a mirror of it)
    build_newel_lamp() -> the lamp standard at the origin (shared mesh)
    preview(out_dir)
"""

from __future__ import annotations

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

import arch_gallery as AG
import lib_core as C
import lib_materials as M
import lib_render as R
import plan as P

# Lit opal (milk) glass globes: the same key and spec furn_rotunda registers.
M.PALETTE.setdefault("glass_opal", dict(base="#f4ecdc", rough=0.24, emission="#ffdcae", emit=3.2))

mat = M.mat
tex = M.tex_size

# ---------------------------------------------------------------------------
# Plan data (Blender coordinates: x east, y = -web z (north +), z up)
# ---------------------------------------------------------------------------

ST = P.STAIRS
RISER = ST["riser"]                       # 0.184
TREAD = ST["tread"]                       # 0.296
GY = P.GALLERY_Y                          # 4.6
_FE = next(f for f in ST["flights"] if f["inner_x"] > 0)
Y_BOT = -_FE["bottom"]                    # -18.6  foot of the ramp
Y_TOP = -_FE["top"]                       # -11.2  landing nosing line
X_IN = _FE["inner_x"]                     # 4.4    open side (string face)
X_WALL = P.LOBBY["maxX"]                  # 6.0    lobby wall inner face
TAN = GY / (Y_TOP - Y_BOT)                # = riser / tread
TH = math.atan(TAN)
COS, SIN = math.cos(TH), math.sin(TH)
UPV = Vector((0.0, 0.0, 1.0 / COS))       # vertical "up" for raking sweeps (vertical end cuts)
DIR = Vector((0.0, COS, SIN))             # up the flight
UPP = Vector((0.0, -SIN, COS))            # perpendicular to the pitch


def h(y):
    """Pitch (nosing) line height at Blender y: the game's ramp."""
    return (y - Y_BOT) * TAN


def ynose(k):
    return Y_BOT + k * TREAD


def hk(k):
    return k * RISER


# steps
NOSE_P = 0.032            # nosing projection past the riser face
NOSE_R = 0.021            # bullnose radius (42 mm nosing)
GROOVE_D, GROOVE_H = 0.006, 0.008   # shadow-line quirk under the nosing
TOP_STEP = 24             # steps built here (the 25th riser is the landing trimmer)
Y_TREAD_END = Y_TOP - 0.003   # tread 24 butts the landing trimmer face (3 mm proud of the line)
Y_N = ynose(2) + NOSE_P   # riser-2 line = bottom newel centre
R_CURT = Y_N - ynose(1)   # curtail D radius (nosing)
SOFFIT_D = (Y_N - Y_BOT) * TAN   # soffit below the pitch line (meets the floor at riser 2)

# open side
STRING_T = 0.13
X_S1 = X_IN + STRING_T    # string inner face (step ends)
X_C = X_IN + STRING_T / 2 # balustrade line
C0 = 0.080                # string top (curb base) above the pitch line, vertical
RAIL_TOP = 1.00           # handrail top above the pitch line, vertical
HP = (RAIL_TOP - C0) * COS   # perpendicular height of the rail system above the string top
VM = 0.26                 # moulded zone of the string face (perpendicular depth)
Z_CURT = RISER + 0.001    # string bottom where it rides on the curtail
DS = h(Y_N + R_CURT) - RISER  # string bottom below the pitch line (vertical)
E_B = 0.009               # baluster ends sunk into the raking rails

# newels
NEWEL_HW = 0.11
Y_BN = Y_N + NEWEL_HW     # bottom newel north face (string / rails die in)
TN_X0, TN_X1 = X_IN, X_IN + 0.22
TN_Y0, TN_Y1 = -11.515, -11.295     # top newel shaft (clear of the landing post and nosing)
TN_BLOCK_Y1 = -11.10      # the post widens below the landing soffit (carries the console)
TN_BLOCK_TOP = 4.098      # just under the landing soffit / trimmer (4.10)
Y_TN = TN_Y0              # top newel south face
TN_XC, TN_YC = (TN_X0 + TN_X1) / 2, (TN_Y0 + TN_Y1) / 2

# wall side
WS_T = 0.035
X_WS = X_WALL - WS_T      # wall string face (step ends)
WS_C = 0.17               # wall string top above the pitch line
X_DADO = X_WALL - 0.025   # dado ground face
DADO_TOP = 1.10           # dado rail top above the pitch line
Y_D0, Y_D1 = -18.55, -11.25
DADO_BAYS = 7
KNEE = 0.10
X_R = 5.895               # brass wall rail centre line
R_RAIL = 0.0225
RAIL_C = 0.875            # wall rail centre above the pitch line

# spandrel / closure
Y_SP0 = Y_N + R_CURT + 0.008
SP_BAYS = 6
Y_CLOSE = -11.10          # north closure face under the landing

# mouldings (u, v) ------------------------------------------------------------
# closed string face (u toward the void from the x = 4.4 plane, v perpendicular to the pitch)
STRING_PROF = [
    (-STRING_T, 0.000), (0.000, 0.000),
    (0.006, -0.002), (0.011, -0.006), (0.014, -0.011), (0.0145, -0.017), (0.012, -0.022), (0.008, -0.025),
    (0.008, -0.030), (0.005, -0.033), (0.003, -0.038), (0.0015, -0.044), (0.0005, -0.050), (0.000, -0.056),
    (0.000, -0.064), (0.004, -0.066), (0.0065, -0.070), (0.0065, -0.074), (0.004, -0.078), (0.000, -0.080),
    (0.000, -0.222), (0.004, -0.224), (0.0065, -0.228), (0.0065, -0.232), (0.004, -0.236), (0.000, -0.238),
    (0.000, -VM), (-STRING_T, -VM),
]
FRIEZE_V0, FRIEZE_V1 = -0.081, -0.221
# bead on the string's bottom edge (u = in-plane, + below the edge; v off the face)
BOTTOM_BEAD = [(0.0, -0.001), (0.0, 0.006), (-0.004, 0.011), (-0.010, 0.014), (-0.016, 0.012), (-0.020, 0.007),
               (-0.022, 0.0), (-0.022, -0.001)]
# wall string top arris (u = in-plane, + down from the top edge; v off the string face)
WS_TOP = [(0.000, -0.002), (0.000, 0.006), (0.003, 0.011), (0.008, 0.014), (0.014, 0.014), (0.019, 0.011),
          (0.022, 0.006), (0.024, 0.004), (0.028, 0.003), (0.034, 0.0015), (0.042, 0.0004), (0.048, 0.0),
          (0.048, -0.002)]
# dado rail (u + down from its top edge, v off the wall)
DADO_RAIL = [(0.000, -0.004), (0.000, 0.016), (0.003, 0.022), (0.008, 0.026), (0.013, 0.027), (0.016, 0.029),
             (0.020, 0.034), (0.025, 0.039), (0.031, 0.043), (0.038, 0.045), (0.044, 0.044), (0.049, 0.040),
             (0.052, 0.035), (0.054, 0.032), (0.058, 0.031), (0.061, 0.031), (0.064, 0.029), (0.068, 0.026),
             (0.070, 0.025), (0.070, -0.004)]
# applied bolection panel moulding (u + outward from the panel, v off the ground)
BOLECTION = [(-0.040, 0.000), (-0.040, 0.0025), (-0.034, 0.0045), (-0.028, 0.0078), (-0.022, 0.0108),
             (-0.016, 0.0136), (-0.010, 0.0158), (-0.005, 0.0158), (-0.0015, 0.0136), (0.000, 0.0092),
             (0.000, 0.000)]

COL = None


def _col():
    return C.collection("Stairs", C.collection("ARCHITECTURE"))


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _frames_rake(x, y0, y1, c, side=(1.0, 0.0, 0.0)):
    """Two frames on a raking line (x, y, h(y) + c) with VERTICAL end cuts; the cross-section
    perpendicular to the pitch is the true profile (u along `side`, v perpendicular)."""
    s = Vector(side)
    return [(Vector((x, y0, h(y0) + c)), s, UPV), (Vector((x, y1, h(y1) + c)), s, UPV)]


def _rake_sweep(name, prof, x, y0, y1, c, mat_, side=(1.0, 0.0, 0.0), size=1.0, smooth=40.0):
    return AG._frame_sweep(name, _frames_rake(x, y0, y1, c, side), prof, mat_, size=size, smooth=smooth)


def _vertical_end(frames, idx, down=True):
    """Makes the end cap of a wall-plane (_vframes) sweep vertical: the in-plane side vector of a
    raking end frame becomes vertical, scaled to keep the moulding's perpendicular size."""
    p, side, up = frames[idx]
    s = Vector((0.0, 0.0, -1.0 if side.z < 0 else 1.0))
    k = 1.0 / max(0.2, abs(side.normalized().z))
    frames[idx] = (p, s * k * side.length, up)
    return frames


def _prism_x(name, poly, x0, x1, mat_, caps=True):
    """Extrudes a (y, z) polygon along x from x0 to x1."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in poly]
    b = [bm.verts.new((x1, y, z)) for y, z in poly]
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps:
        bm.faces.new(a)
        bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return C.mesh_from_bmesh(name, bm, mat_)


def _prism_plane(name, poly2, to3, nrm, t0, t1, mat_):
    """Extrudes a 2D polygon (plane coords mapped by to3) along nrm from offset t0 to t1."""
    nrm = Vector(nrm)
    bm = bmesh.new()
    a = [bm.verts.new(to3(p) + nrm * t0) for p in poly2]
    b = [bm.verts.new(to3(p) + nrm * t1) for p in poly2]
    n = len(poly2)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return C.mesh_from_bmesh(name, bm, mat_)


def _uv_rake(ob, size):
    """Wood grain along the pitch on faces that look across x; box mapping elsewhere."""
    me = ob.data
    uv = AG._uvdata(me)
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0:
                uv[li].uv = ((co.y * COS + co.z * SIN) / size, (-co.y * SIN + co.z * COS) / size)
            elif ax == 1:
                uv[li].uv = (co.x / size, co.z / size)
            else:
                uv[li].uv = (co.y / size, co.x / size)
    return ob


def _orient_out(ob, inside):
    """Flips an open shell whose faces mostly point toward `inside`."""
    me = ob.data
    inside = Vector(inside)
    bad = sum(1 for p in me.polygons if p.normal.dot(p.center - inside) < 0)
    if bad > len(me.polygons) / 2:
        me.flip_normals()
    return ob


def _clear_custom_normals(me):
    try:
        if me.has_custom_normals:
            me.normals_split_custom_set([(0.0, 0.0, 0.0)] * len(me.loops))
    except Exception:  # noqa: BLE001
        pass
    for nm in ("custom_normal",):
        a = me.attributes.get(nm)
        if a is not None:
            try:
                me.attributes.remove(a)
            except Exception:  # noqa: BLE001
                pass


def _mirror_copy(ob, name):
    """A real mirrored copy (x -> -x) of a world-space mesh object, with its custom split normals
    mirrored too (so harden/weighted shading survives the flip)."""
    src = ob.data
    lnor = {}
    if src.has_custom_normals:
        cn = src.corner_normals
        for p in src.polygons:
            for li in p.loop_indices:
                lnor[(p.index, src.loops[li].vertex_index)] = Vector(cn[li].vector)
    me = src.copy()
    me.name = name
    me.transform(Matrix.Scale(-1.0, 4, (1.0, 0.0, 0.0)))
    me.flip_normals()
    if lnor:
        new = [(0.0, 0.0, 1.0)] * len(me.loops)
        for p in me.polygons:
            for li in p.loop_indices:
                v = lnor[(p.index, me.loops[li].vertex_index)]
                new[li] = (-v.x, v.y, v.z)
        me.normals_split_custom_set(new)
    o2 = bpy.data.objects.new(name, me)
    for c in ob.users_collection:
        c.objects.link(o2)
    for k in ob.keys():
        o2[k] = ob[k]
    return o2


def _join(parts, name):
    parts = [p for p in parts if p is not None]
    for p in parts:
        AG._uvdata(p.data)
    ob = C.join(parts, name)
    return ob


def _fillet_path(corners, radii, steps=8):
    """Polyline with each interior corner replaced by a tangent arc of the given radius."""
    pts = [Vector(corners[0])]
    for i in range(1, len(corners) - 1):
        p0, p1, p2 = Vector(corners[i - 1]), Vector(corners[i]), Vector(corners[i + 1])
        a, b = (p1 - p0).normalized(), (p2 - p1).normalized()
        th = math.acos(max(-1.0, min(1.0, a.dot(b))))
        r = radii[i]
        if th < 1e-4 or r <= 0:
            pts.append(p1)
            continue
        t = r * math.tan(th / 2)
        t1 = p1 - a * t
        n1 = (b - a * a.dot(b)).normalized()
        cen = t1 + n1 * r
        k = max(2, int(math.ceil(steps * th / (math.pi / 2))))
        for j in range(k + 1):
            ph = th * j / k
            pts.append(cen - n1 * r * math.cos(ph) + a * r * math.sin(ph))
    pts.append(Vector(corners[-1]))
    return pts


def _tube(name, pts, radius, sides, mat_, size=0.3, cap=True):
    """Round bar along a 3D path (rotation-minimising frames)."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
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
    nrm = (ref - tans[0] * ref.dot(tans[0])).normalized()
    frames = []
    for i in range(n):
        if i:
            nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
        frames.append((pts[i], tans[i].cross(nrm), nrm))
    prof = [(radius * math.cos(math.tau * k / sides), radius * math.sin(math.tau * k / sides)) for k in range(sides)]
    return AG._frame_sweep(name, frames, prof, mat_, size=size, smooth=60, cap=cap)


def _inset(poly, d):
    """Offsets a convex 2D polygon inward by d."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sgn = 1.0 if area > 0 else -1.0
    lines = []
    for i in range(n):
        a, b = Vector(poly[i]), Vector(poly[(i + 1) % n])
        t = (b - a).normalized()
        nin = Vector((-t.y, t.x)) * sgn
        lines.append((a + nin * d, t))
    out = []
    for i in range(n):
        (p1, t1), (p2, t2) = lines[i - 1], lines[i]
        den = t1.x * t2.y - t1.y * t2.x
        if abs(den) < 1e-9:
            out.append(p2)
            continue
        s = ((p2.x - p1.x) * t2.y - (p2.y - p1.y) * t2.x) / den
        out.append(p1 + t1 * s)
    return [(p.x, p.y) for p in out]


def _valid_inset(poly, ins):
    """True when an inset polygon keeps the original's orientation and edge directions."""
    def area(q):
        return sum(q[i][0] * q[(i + 1) % len(q)][1] - q[(i + 1) % len(q)][0] * q[i][1] for i in range(len(q)))
    if area(poly) * area(ins) <= 0 or abs(area(ins)) < 1e-4:
        return False
    n = len(poly)
    for i in range(n):
        a = Vector(poly[(i + 1) % n]) - Vector(poly[i])
        b = Vector(ins[(i + 1) % n]) - Vector(ins[i])
        if a.dot(b) <= 0:
            return False
    return True


def _frustum_plane(name, back, front, to3, nrm, t0, t1, mat_):
    """A fielded panel: the back outline at offset t0 rising on sloped margins to a smaller front
    face at t1 (both 2D polygons with matching vertex order)."""
    nrm = Vector(nrm)
    bm = bmesh.new()
    a = [bm.verts.new(to3(p) + nrm * t0) for p in back]
    b = [bm.verts.new(to3(p) + nrm * t1) for p in front]
    n = len(back)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, mat_)
    C.shade_flat(ob)
    return ob


def _band_poly(ya, yb, zlo, ztop, min_h=0.12):
    """Panel polygon between z = zlo and the raking line z = ztop(y) for y in [ya, yb] (clipped
    where it would be shorter than min_h). Ordered bottom edge first, going +y."""
    za, zb = ztop(ya), ztop(yb)
    if max(za, zb) < zlo + min_h:
        return None
    if za < zlo + min_h:
        ya = ya + (yb - ya) * ((zlo + min_h) - za) / (zb - za)
    if zb < zlo + min_h:
        yb = yb - (yb - ya) * ((zlo + min_h) - zb) / (za - zb)
    return [(ya, zlo), (yb, zlo), (yb, ztop(yb)), (ya, ztop(ya))]


def _panel(name, poly2, to3, nrm, w, scale=1.0, raised=True):
    """Applied bolection moulding round a polygon (2D, bottom edge first, ordered so that the
    moulding's outer side faces out) plus a fielded panel inside it."""
    pts3 = [to3(p) for p in poly2]
    prof = [(u * scale, v * scale) for u, v in BOLECTION]
    mould = AG._frame_sweep(name + "_Mould", AG._vframes(pts3, nrm, closed=True), prof, w, closed_path=True,
                            cap=False, size=tex("walnut"), smooth=45)
    parts = [mould]
    if raised:
        ground = _prism_plane(name + "_Panel", _inset(poly2, 0.036 * scale), to3, nrm, -0.001, 0.0035, w)
        C.shade_flat(ground)
        parts.append(ground)
        back = _inset(poly2, 0.078 * scale)
        front = _inset(poly2, 0.100 * scale)
        if _valid_inset(poly2, back) and _valid_inset(poly2, front):
            field = _frustum_plane(name + "_Field", back, front, to3, nrm, 0.002, 0.0105, w)
            parts.append(field)
    for p_ in parts[1:]:
        C.uv_box(p_, tex("walnut"), "z")
    return parts


# ---------------------------------------------------------------------------
# Steps
# ---------------------------------------------------------------------------

def _nosing_pts(yk, zk, n=8):
    """(y, z) points from the top of riser k round the bullnose to the start of tread k."""
    pts = [(yk + NOSE_P, zk - 2 * NOSE_R - GROOVE_H), (yk + NOSE_P + GROOVE_D, zk - 2 * NOSE_R - GROOVE_H),
           (yk + NOSE_P + GROOVE_D, zk - 2 * NOSE_R)]
    cy, cz = yk + NOSE_R, zk - NOSE_R
    for i in range(n + 1):
        a = math.radians(-90 - 180 * i / n)
        pts.append((cy + NOSE_R * math.cos(a), cz + NOSE_R * math.sin(a)))
    return pts


def _flight_body():
    """Steps 2..24 as one limestone mass (sawtooth + soffit) between the strings."""
    poly = [(Y_N, 0.0), (Y_N, hk(1))]
    for k in range(2, TOP_STEP + 1):
        poly += _nosing_pts(ynose(k), hk(k))
        y_next = ynose(k + 1) + NOSE_P if k < TOP_STEP else Y_TREAD_END
        poly.append((y_next, hk(k)))
    poly.append((Y_TREAD_END, h(Y_TREAD_END) - SOFFIT_D))
    ob = _prism_x("Architecture_Stair_Steps", poly, X_S1 - 0.004, X_WS + 0.004, mat("limestone_plain"), caps=True)
    # the ends hide in the strings: drop the two end caps
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if abs(f.normal.x) > 0.99], context="FACES")
    # the soffit (inside the closed under-stair) is plastered
    sof = [f for f in bm.faces if f.normal.z < -0.5 and f.calc_area() > 1.0]
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.materials.append(mat("plaster"))
    for p in ob.data.polygons:
        if p.normal.z < -0.5 and p.area > 1.0:
            p.material_index = 1
    C.shade_smooth(ob, 35)
    C.uv_box(ob, tex("limestone_plain"))
    return ob


def _curtail_step():
    """Step 1: a D-ended curtail wrapping round the bottom newel, then straight to the wall."""
    rr = R_CURT - NOSE_P                      # riser-face radius
    path = [(X_C + rr * math.cos(math.radians(a)), Y_N + rr * math.sin(math.radians(a)))
            for a in [90 + 180 * i / 20 for i in range(21)]]
    path.append((X_WS + 0.004, Y_N - rr))
    z1 = hk(1)
    prof = [(-0.040, z1), (NOSE_P - NOSE_R, z1)]
    for i in range(1, 9):
        a = math.radians(90 - 180 * i / 8)
        prof.append((NOSE_P - NOSE_R + NOSE_R * math.cos(a), z1 - NOSE_R + NOSE_R * math.sin(a)))
    prof += [(-GROOVE_D, z1 - 2 * NOSE_R), (-GROOVE_D, z1 - 2 * NOSE_R - GROOVE_H), (0.0, z1 - 2 * NOSE_R - GROOVE_H),
             (0.0, 0.0)]
    fr = AG._hframes(path, side=-1.0)
    edge = AG._frame_sweep("Architecture_Stair_Curtail_Edge", fr, prof, mat("limestone_plain"), closed_profile=False,
                           cap=False, size=tex("limestone_plain"), smooth=35, recalc=False)
    # tread top: the inner edge of the sweep + the back corners
    inner = [fr[i][0] + fr[i][1] * prof[0][0] for i in range(len(fr))]
    loop = [Vector((p.x, p.y, z1)) for p in inner] + [Vector((X_WS + 0.004, Y_N, z1)), Vector((X_C, Y_N, z1))]
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in loop]
    f = bm.faces.new(vs)
    if f.normal.z < 0:
        f.normal_flip()
    top = C.mesh_from_bmesh("Architecture_Stair_Curtail_Top", bm, mat("limestone_plain"))
    C.shade_flat(top)
    _orient_out(edge, (X_C + 0.6, Y_N - 0.1, 0.05))
    ob = _join([edge, top], "Architecture_Stair_Curtail")
    AG._weld(ob, 1e-5)
    C.shade_smooth(ob, 35)
    C.uv_box(ob, tex("limestone_plain"))
    return ob


# ---------------------------------------------------------------------------
# Open side: closed string, curb, balustrade
# ---------------------------------------------------------------------------

def _zb(y):
    """String bottom edge (vertical): rides on the curtail, then parallel to the pitch."""
    return max(Z_CURT, h(y) - DS)


def _string():
    w = mat("walnut")
    y0, y1 = Y_BN - 0.002, Y_TN + 0.002
    face = _rake_sweep("Architecture_Stair_String_Face", STRING_PROF, X_IN, y0, y1, C0, w, side=(-1.0, 0.0, 0.0),
                       size=tex("walnut"), smooth=40)
    # pulvinated ornament frieze on the face (same ornament_band as the landing fascia's frieze)
    nfr = 12
    fprof = [(0.0004 + 0.0058 * math.sin(math.pi * i / nfr) ** 0.8, FRIEZE_V0 + (FRIEZE_V1 - FRIEZE_V0) * i / nfr)
             for i in range(nfr + 1)]
    fr = AG._frame_sweep("Architecture_Stair_String_Frieze", _frames_rake(X_IN, y0 + 0.002, y1 - 0.002, C0, (-1, 0, 0)),
                         fprof, mat("ornament_band"), closed_profile=False, cap=False, size=1.0, smooth=50, recalc=False)
    _orient_out(fr, (X_IN + 0.3, -14.0, h(-14.0)))
    L = (y1 - y0) / COS
    period = L / max(1, round(L / (2 * (FRIEZE_V0 - FRIEZE_V1))))
    me = fr.data
    uv = AG._uvdata(me)
    p0 = Vector((X_IN, y0, h(y0) + C0))
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            d = co - p0
            s_ = Vector((0, d.y, d.z)).dot(DIR)
            v_ = Vector((0, d.y, d.z)).dot(UPP)
            uv[li].uv = (s_ / period, min(1.0, max(0.0, (FRIEZE_V0 - v_) / (FRIEZE_V0 - FRIEZE_V1))))
    # plain lower board down to the bottom edge
    ztop = lambda y: h(y) + C0 - (VM - 0.002) / COS
    yk = Y_BOT + (Z_CURT + DS) / TAN          # where the bottom edge leaves the curtail
    poly = [(y0, ztop(y0)), (y1, ztop(y1)), (y1, _zb(y1)), (yk, Z_CURT), (y0, Z_CURT)]
    board = _prism_x("Architecture_Stair_String_Board", poly, X_IN, X_S1, w)
    C.bevel(board, 0.002, 1, 40)
    _uv_rake(board, tex("walnut"))
    # bead along the bottom edge (horizontal over the curtail, then raking), vertical end cuts
    bpath = [Vector((X_IN, y0, Z_CURT)), Vector((X_IN, yk, Z_CURT)), Vector((X_IN, y1, _zb(y1)))]
    bfr = AG._vframes(bpath, (-1, 0, 0))
    _vertical_end(bfr, 2)
    bead = AG._frame_sweep("Architecture_Stair_String_Bead", bfr, BOTTOM_BEAD, w, size=tex("walnut"), smooth=50)
    curb = _rake_sweep("Architecture_Stair_Curb", AG.CURB, X_C, y0, y1, C0, w, size=tex("walnut"), smooth=40)
    hand = _rake_sweep("Architecture_Stair_Handrail", [(u, HP - 0.055 + v) for u, v in AG.HANDRAIL], X_C, y0, y1, C0, w,
                       size=tex("walnut"), smooth=40)
    wood = _join([face, board, bead, curb, hand], "Architecture_Stair_String")
    iron = mat("iron")
    brail = _rake_sweep("Architecture_Stair_BottomRail", AG.BRAIL, X_C, y0, y1, C0, iron, size=0.3, smooth=40)
    core = _rake_sweep("Architecture_Stair_CoreRail", [(-0.019, HP - 0.075), (0.019, HP - 0.075), (0.019, HP - 0.055),
                                                       (-0.019, HP - 0.055)], X_C, y0, y1, C0, iron, size=0.3, smooth=None)
    rails = _join([brail, core], "Architecture_Stair_IronRails")
    return [wood, fr, rails]


_SHARED = {}


def _shared(key, fn):
    me = _SHARED.get(key)
    if me is None or me.name not in bpy.data.meshes:
        ob = fn()
        AG._uvdata(ob.data)
        me = ob.data
        me.name = ob.name
        bpy.data.objects.remove(ob, do_unlink=True)
        _SHARED[key] = me
    return me


def _stair_baluster():
    """The gallery's turned iron baluster, lengthened/shortened for the rake (base at z = 0)."""
    L = (HP - 0.075 - AG.BRAIL_TOP) / COS + 2 * E_B
    ob = AG._baluster_mesh(L + 0.157)
    z0 = min(v.co.z for v in ob.data.vertices)
    ob.data.transform(Matrix.Translation((0, 0, -z0)))
    ob.name = "Architecture_Stair_Baluster"
    return ob


def _stair_bracket(uphill):
    """The gallery's C-scroll newel bracket, sheared to the rake. Origin on the newel face at the
    string top line; it runs up (uphill) or down the flight along +-y."""
    ob = AG._bracket_mesh()
    me = ob.data
    dz = AG.BRAIL_TOP / COS - AG.BRAIL_TOP
    for v in me.vertices:
        xl, yl, zl = v.co
        if uphill:
            v.co = Vector((-yl, xl, zl + dz + xl * TAN))
        else:
            v.co = Vector((yl, -xl, zl + dz - xl * TAN))
    _clear_custom_normals(me)
    me.update()
    C.shade_smooth(ob, 40)
    ob.name = "Architecture_Stair_Bracket_" + ("Up" if uphill else "Down")
    return ob


def _balustrade(col):
    """Instanced balusters and brackets for the east flight (+ the matching west instances)."""
    bal = _shared("bal", _stair_baluster)
    bup = _shared("brk_up", lambda: _stair_bracket(True))
    bdn = _shared("brk_dn", lambda: _stair_bracket(False))
    brk_w = max(v.co.y for v in bup.vertices) - min(v.co.y for v in bup.vertices)
    out = []
    for s, tag in ((1, "E"), (-1, "W")):
        out.append(AG._inst(bup, f"Architecture_Stair_{tag}_Bracket_01", (s * X_C, Y_BN, h(Y_BN) + C0), 0.0, col))
        out.append(AG._inst(bdn, f"Architecture_Stair_{tag}_Bracket_02", (s * X_C, Y_TN, h(Y_TN) + C0), 0.0, col))
    ya, yb = Y_BN + brk_w + 0.045, Y_TN - brk_w - 0.045
    n = int(round((yb - ya) / AG.BAL_SP)) + 1
    for s, tag in ((1, "E"), (-1, "W")):
        for k in range(n):
            y = ya + (yb - ya) * k / (n - 1)
            z = h(y) + C0 + AG.BRAIL_TOP / COS - E_B
            out.append(AG._inst(bal, f"Architecture_Stair_{tag}_Baluster_{k + 1:03d}", (s * X_C, y, z), 0.0, col))
    return out, n


# ---------------------------------------------------------------------------
# Newels and the lamp standard
# ---------------------------------------------------------------------------

def _cap_profile(z, hw=NEWEL_HW):
    """Astragal, neck, bed mould, corona and cushion of a newel cap above the shaft top z."""
    return [(hw, z), (hw + 0.004, z + 0.004), (hw + 0.007, z + 0.010), (hw + 0.007, z + 0.018), (hw + 0.004, z + 0.024),
            (hw, z + 0.028), (hw, z + 0.075), (hw + 0.003, z + 0.079), (hw + 0.009, z + 0.086), (hw + 0.016, z + 0.096),
            (hw + 0.024, z + 0.106), (hw + 0.031, z + 0.116), (hw + 0.036, z + 0.126), (hw + 0.040, z + 0.130),
            (hw + 0.042, z + 0.136), (hw + 0.042, z + 0.162), (hw + 0.040, z + 0.168), (hw + 0.035, z + 0.172),
            (hw + 0.029, z + 0.176), (hw + 0.018, z + 0.184), (hw + 0.006, z + 0.192), (hw - 0.006, z + 0.198),
            (hw - 0.010, z + 0.200), (0.0, z + 0.200)]


def _face_decor(name, hw, z_panels, faces, w):
    """Beaded sunk panels (and carved paterae in the upper squares) on the given newel faces."""
    parts = []
    for fn in faces:
        nrm = Vector(fn)
        along = Vector((-nrm.y, nrm.x, 0.0))
        c = nrm * hw
        for z0, z1, ros in z_panels:
            parts.append(AG._bead_rect(f"{name}_Bead", c, along, nrm, hw - 0.038, z0, z1, w))
            if ros:
                r = AG._rosette(f"{name}_Patera", 0.044, 0.016, 8, 24, w, rings=5)
                AG._place(r, c + Vector((0, 0, (z0 + z1) / 2)), nrm)
                C.apply_transform(r)
                C.uv_box(r, tex("walnut"))
                parts.append(r)
    return parts


def build_bottom_newel():
    """Walnut newel on the curtail step: moulded plinth, beaded panels with paterae, cornice cap.
    Origin at the foot (z = 0 on the curtail tread), the flight rising along +y."""
    w = mat("walnut")
    hw = NEWEL_HW
    zs = 1.34
    prof = [(0.145, 0.000), (0.145, 0.095), (0.1435, 0.104), (0.139, 0.112), (0.133, 0.117), (0.127, 0.119),
            (0.124, 0.122), (0.124, 0.128), (0.120, 0.134), (0.115, 0.142), (0.112, 0.150), (0.111, 0.158),
            (hw, 0.165), (hw, zs)] + _cap_profile(zs)
    body = AG._sq_lathe("Architecture_Stair_NewelBottom_Body", prof, w)
    C.bevel(body, 0.0025, 1, 30)
    C.uv_box(body, tex("walnut"), "z")
    deco = _face_decor("Architecture_Stair_NewelBottom", hw, [(0.27, 1.05, False), (1.11, 1.27, True)],
                       [(0, -1, 0), (1, 0, 0), (-1, 0, 0)], w)
    ob = _join([body] + deco, "Architecture_Stair_NewelBottom")
    ob["cap_top"] = zs + 0.200
    return ob


def build_top_newel():
    """Stair-head newel: a post from the floor (a pilaster in the under-stair panelling that carries
    the landing's scroll console) rising past the string to a cornice cap and urn finial.
    Origin at its shaft centre on the floor."""
    w = mat("walnut")
    hw = NEWEL_HW
    yb1 = TN_BLOCK_Y1 - TN_YC
    lower = C.box_minmax("TopNewelBlock", (-hw, -hw, 0.0), (hw, yb1, TN_BLOCK_TOP), w, bevel_w=0.003)
    C.uv_box(lower, tex("walnut"), "z")
    zs = 5.47
    up = AG._sq_lathe("TopNewelShaft", [(hw, TN_BLOCK_TOP - 0.002), (hw, zs)] + _cap_profile(zs), w)
    C.bevel(up, 0.0025, 1, 30)
    C.uv_box(up, tex("walnut"), "z")
    zt = zs + 0.200
    fin = [(0.075, zt), (0.075, zt + 0.010), (0.068, zt + 0.016), (0.050, zt + 0.022), (0.036, zt + 0.030),
           (0.030, zt + 0.040), (0.034, zt + 0.048), (0.034, zt + 0.054), (0.028, zt + 0.060), (0.034, zt + 0.072),
           (0.050, zt + 0.092), (0.062, zt + 0.114), (0.066, zt + 0.136), (0.062, zt + 0.158), (0.050, zt + 0.176),
           (0.034, zt + 0.190), (0.022, zt + 0.198), (0.018, zt + 0.204), (0.022, zt + 0.210), (0.022, zt + 0.216),
           (0.0, zt + 0.218)]
    finial = C.lathe("TopNewelFinial", fin, 28, w, cap_bottom=False, smooth_angle=50)
    AG._uv_vertical(finial, tex("walnut"))
    ball = C.sphere("TopNewelBall", 0.026, (0, 0, zt + 0.240), mat("brass_aged"), 20, 12)
    C.uv_box(ball, 0.3)
    deco = _face_decor("Architecture_Stair_NewelTop", hw, [(4.74, 5.14, False), (5.20, 5.38, True)],
                       [(1, 0, 0), (-1, 0, 0)], w)
    # tall beaded panels on the pilaster (both x faces, so the post can be mirrored) and its north face
    ymid = (yb1 - hw) / 2
    for sx in (1, -1):
        deco.append(AG._bead_rect("TopNewelPilasterBead", Vector((sx * hw, ymid, 0)), Vector((0, 1, 0)), Vector((sx, 0, 0)),
                                  (yb1 + hw) / 2 - 0.065, 0.32, 3.42, w))
    deco.append(AG._bead_rect("TopNewelPilasterBeadN", Vector((0, yb1, 0)), Vector((1, 0, 0)), Vector((0, 1, 0)),
                              hw - 0.05, 0.32, 3.86, w))
    ob = _join([lower, up, finial, ball] + deco, "Architecture_Stair_NewelTop")
    return ob


def _lamp_arm_path(a_deg, rho0=0.030, z0=0.625, rho1=0.190, z1=0.735):
    pts2 = AG._bezier((rho0, z0), (rho1 * 0.70, z0 - 0.012), (rho1 * 1.02, z0 + 0.020), (rho1, z1), 14)
    a = math.radians(a_deg)
    return [Vector((r * math.cos(a), r * math.sin(a), z)) for r, z in pts2]


def _globe(name, rad, neck, zc, segs=24, rings=12):
    """Opal globe: a sphere opening into a short neck at the bottom."""
    a0 = math.asin(neck / rad)
    prof = [(neck, zc - rad * math.cos(a0) - 0.006), (neck, zc - rad * math.cos(a0))]
    for i in range(1, rings + 1):
        t = a0 + (math.pi - a0) * i / rings
        prof.append((rad * math.sin(t), zc - rad * math.cos(t)))
    return C.lathe(name, prof, segs, mat("glass_opal"), cap_bottom=False, smooth_angle=80)


def build_newel_lamp():
    """Brass lamp standard for the bottom newel: turned socle and baluster stem, four scrolled arms
    with opal globes and a larger central globe. Origin = the newel cap top."""
    b = mat("brass_aged")
    prof = [(0.094, 0.000), (0.094, 0.010), (0.090, 0.015), (0.083, 0.019), (0.075, 0.025), (0.069, 0.033),
            (0.066, 0.040), (0.060, 0.044), (0.050, 0.047), (0.040, 0.051), (0.034, 0.057), (0.032, 0.063),
            (0.036, 0.069), (0.040, 0.075), (0.040, 0.083), (0.034, 0.089), (0.026, 0.096), (0.020, 0.106),
            (0.018, 0.120), (0.017, 0.200), (0.019, 0.207), (0.024, 0.214), (0.024, 0.224), (0.019, 0.231),
            (0.017, 0.238), (0.020, 0.262), (0.028, 0.290), (0.034, 0.320), (0.036, 0.345), (0.033, 0.370),
            (0.026, 0.392), (0.019, 0.408), (0.015, 0.420), (0.015, 0.440), (0.020, 0.446), (0.020, 0.454),
            (0.015, 0.460), (0.013, 0.520), (0.013, 0.580), (0.018, 0.588), (0.030, 0.600), (0.036, 0.614),
            (0.036, 0.636), (0.030, 0.650), (0.018, 0.660), (0.013, 0.668), (0.012, 0.740), (0.016, 0.745),
            (0.016, 0.752), (0.012, 0.757), (0.012, 0.830), (0.017, 0.836), (0.022, 0.846), (0.022, 0.856),
            (0.017, 0.864), (0.012, 0.870), (0.012, 0.916), (0.020, 0.922), (0.032, 0.927), (0.042, 0.935),
            (0.048, 0.944), (0.050, 0.952), (0.047, 0.956), (0.041, 0.956), (0.0, 0.958)]
    stem = C.lathe("NewelLampStem", prof, 32, b, cap_bottom=False, smooth_angle=45)
    AG._uv_vertical(stem, 0.3)
    parts = [stem]
    gz = 0.956 + 0.094
    parts.append(_globe("NewelLampGlobeC", 0.100, 0.040, gz, 24, 11))
    lights = [(0.0, 0.0, gz)]
    cup = [(0.008, 0.728), (0.012, 0.733), (0.020, 0.738), (0.030, 0.745), (0.037, 0.752), (0.039, 0.758),
           (0.036, 0.762), (0.030, 0.762), (0.0, 0.763)]
    for k in range(4):
        a = 45 + 90 * k
        path = _lamp_arm_path(a)
        arm = _tube("NewelLampArm", path, 0.0100, 10, b)
        parts.append(arm)
        end = path[-1]
        cu = C.lathe("NewelLampCup", cup, 24, b, cap_bottom=False, smooth_angle=45)
        cu.location = (end.x, end.y, 0.0)
        C.apply_transform(cu)
        AG._uv_vertical(cu, 0.3)
        parts.append(cu)
        # a small scroll curl under each arm, collared to the stem
        a_r = math.radians(a)
        sc = AG._spiral_path((0.085, 0.585), 0.030, 0.008, math.radians(170), math.radians(-200), 18)
        sc = [Vector((r * math.cos(a_r), r * math.sin(a_r), z)) for r, z in sc]
        parts.append(_tube("NewelLampScroll", [Vector((0.016 * math.cos(a_r), 0.016 * math.sin(a_r), 0.586))] + sc,
                           0.0045, 8, b))
        gzc = 0.762 + 0.066
        g = _globe("NewelLampGlobe", 0.072, 0.028, gzc, 20, 10)
        g.location = (end.x, end.y, 0.0)
        C.apply_transform(g)
        parts.append(g)
        lights.append((round(end.x, 4), round(end.y, 4), round(gzc, 4)))
    for p_ in parts:
        AG._uvdata(p_.data)
    ob = _join(parts, "Light_NewelLamp_Stair")
    ob["light_points"] = [list(p) for p in lights]
    ob["light_color"] = "#ffd59a"
    return ob


# ---------------------------------------------------------------------------
# Spandrel panelling, cupboard door, north closure
# ---------------------------------------------------------------------------

def _to3_x(x):
    return lambda p: Vector((x, p[0], p[1]))


def _spandrel():
    w = mat("walnut")
    y0, y1 = Y_SP0, Y_TN + 0.002
    poly = [(y0, 0.0), (y1, 0.0), (y1, _zb(y1) - 0.001), (y0, _zb(y0) - 0.001)]
    ground = _prism_x("Architecture_Stair_Spandrel_Ground", poly, X_IN, X_S1 - 0.002, w)
    _uv_rake(ground, tex("walnut"))
    parts = [ground]
    # skirting from the wall under the landing, round the stair-head post, along the spandrel
    parts.append(AG._skirting("Architecture_Stair_Skirting", [(X_WALL + 0.02, Y_CLOSE), (X_IN, Y_CLOSE), (X_IN, y0)], 0.0, w))
    to3 = _to3_x(X_IN)
    nrm = (-1.0, 0.0, 0.0)
    bw = (y1 - y0) / SP_BAYS
    zlo = 0.30
    ztop = lambda y: _zb(y) - 0.09
    door = None
    for i in range(SP_BAYS):
        ya, yb = y0 + i * bw + 0.05, y0 + (i + 1) * bw - 0.05
        if door is None and ztop(ya) > 2.0:
            door = (ya, yb)
            yc = (ya + yb) / 2
            parts += _cupboard_door(yc, 0.21, 1.80)
            pp = _band_poly(ya, yb, 1.92, ztop)
            if pp:
                parts += _panel(f"Architecture_Stair_Spandrel_P{i}T", pp, to3, nrm, w)
            continue
        if ztop(yb) - zlo > 1.75:
            split = 1.40
            pp = _band_poly(ya, yb, zlo, lambda y: split)
            if pp:
                parts += _panel(f"Architecture_Stair_Spandrel_P{i}L", pp, to3, nrm, w)
            pp = _band_poly(ya, yb, split + 0.12, ztop)
        else:
            pp = _band_poly(ya, yb, zlo, ztop)
        if pp:
            parts += _panel(f"Architecture_Stair_Spandrel_P{i}", pp, to3, nrm, w)
    # north closure under the landing (faces north)
    cx0 = TN_X1
    clo = C.box_minmax("Architecture_Stair_Closure", (cx0, Y_CLOSE - 0.10, 0.0), (X_WALL + 0.01, Y_CLOSE, TN_BLOCK_TOP), w)
    C.uv_box(clo, tex("walnut"), "z")
    parts.append(clo)
    to3n = lambda p: Vector((p[0], Y_CLOSE, p[1]))
    xs = [cx0 + 0.04, (cx0 + X_WALL) / 2 - 0.05, (cx0 + X_WALL) / 2 + 0.05, X_WALL - 0.07]
    for j, (xa, xb) in enumerate(((xs[0], xs[1]), (xs[2], xs[3]))):
        for t, (za, zb_) in enumerate(((0.30, 1.15), (1.27, 3.92))):
            parts += _panel(f"Architecture_Stair_Closure_P{j}{t}", [(xa, za), (xb, za), (xb, zb_), (xa, zb_)], to3n,
                            (0.0, 1.0, 0.0), w)
    return parts, door


def _cupboard_door(yc, z0, z1):
    """Small lay-on walnut cupboard door in the spandrel: two fielded panels, brass knob, keyhole
    escutcheon and two hinge knuckles."""
    w = mat("walnut")
    b = mat("brass_aged")
    hw = 0.39
    t = 0.022
    leaf = C.box_minmax("Architecture_Stair_Door_Leaf", (X_IN - t, yc - hw, z0), (X_IN + 0.001, yc + hw, z1), w, bevel_w=0.004)
    C.uv_box(leaf, tex("walnut"), "z")
    parts = [leaf]
    to3 = _to3_x(X_IN - t)
    nrm = (-1.0, 0.0, 0.0)
    m = 0.085
    zmid = z0 + (z1 - z0) * 0.56
    for nm, za, zb_ in (("L", z0 + m, zmid - m / 2), ("U", zmid + m / 2, z1 - m)):
        parts += _panel(f"Architecture_Stair_Door_P{nm}", [(yc - hw + m, za), (yc + hw - m, za), (yc + hw - m, zb_),
                                                           (yc - hw + m, zb_)], to3, nrm, w, scale=0.75)
    # knob on the downhill (south) stile, escutcheon below it
    ky, kz = yc - hw + 0.055, z0 + (z1 - z0) * 0.50
    rose = C.lathe("DoorRose", [(0.024, 0.0), (0.024, 0.003), (0.019, 0.006), (0.010, 0.008), (0.0, 0.008)], 24, b,
                   cap_bottom=False, rot=C.roty(-90), center=(X_IN - t, ky, kz))
    knob = C.lathe("DoorKnob", [(0.006, 0.0), (0.006, 0.020), (0.010, 0.026), (0.019, 0.034), (0.022, 0.042),
                                (0.020, 0.050), (0.012, 0.055), (0.0, 0.056)], 24, b, cap_bottom=False,
                   rot=C.roty(-90), center=(X_IN - t - 0.006, ky, kz))
    esc = C.lathe("DoorEscutcheon", [(0.013, 0.0), (0.013, 0.002), (0.010, 0.004), (0.0, 0.004)], 20, b, cap_bottom=False,
                  rot=C.roty(-90), center=(X_IN - t, ky, kz - 0.075))
    hole = C.box("DoorKeyhole", (0.0016, 0.004, 0.012), (X_IN - t - 0.0045, ky, kz - 0.076), mat("iron"))
    parts += [rose, knob, esc, hole]
    for hz in (z0 + 0.20, z1 - 0.20):
        kn = C.cylinder("DoorHinge", 0.0075, 0.0075, 0.075, (X_IN - t * 0.55, yc + hw + 0.002, hz), b, 12)
        tip = C.sphere("DoorHingeTip", 0.0078, (X_IN - t * 0.55, yc + hw + 0.002, hz + 0.040), b, 12, 6)
        parts += [kn, tip]
    for p_ in parts[1:]:
        if not p_.data.uv_layers:
            C.uv_box(p_, 0.3)
    return parts


# ---------------------------------------------------------------------------
# Wall side: wall string, dado, brass handrail
# ---------------------------------------------------------------------------

def _wall_string():
    w = mat("walnut")
    yb0 = Y_BOT - 0.06
    poly = [(yb0, 0.0), (yb0, WS_C), (Y_BOT, WS_C), (Y_TOP, h(Y_TOP) + WS_C), (Y_TOP, GY + 0.005),
            (Y_TOP - 0.05, GY + 0.005), (Y_TOP - 0.05, h(Y_TOP - 0.05) - 0.45), (Y_BOT + 0.45 / TAN, 0.0)]
    board = _prism_x("Architecture_Stair_WallString_Board", poly, X_WS, X_WALL + 0.01, w)
    C.bevel(board, 0.002, 1, 40)
    _uv_rake(board, tex("walnut"))
    path = [Vector((X_WS, yb0, WS_C)), Vector((X_WS, Y_BOT, WS_C)), Vector((X_WS, Y_TOP, h(Y_TOP) + WS_C))]
    fr = AG._vframes(path, (-1, 0, 0))
    _vertical_end(fr, 2)
    top = AG._frame_sweep("Architecture_Stair_WallString_Top", fr, WS_TOP, w, size=tex("walnut"), smooth=50)
    return _join([board, top], "Architecture_Stair_WallString")


def _dado():
    w = mat("walnut")
    zt0 = h(Y_D0 + KNEE) + DADO_TOP
    zt1 = h(Y_D1 - KNEE) + DADO_TOP
    rail_pts = [Vector((X_WALL, Y_D0, zt0)), Vector((X_WALL, Y_D0 + KNEE, zt0)), Vector((X_WALL, Y_D1 - KNEE, zt1)),
                Vector((X_WALL, Y_D1, zt1))]
    rail = AG._frame_sweep("Architecture_Stair_DadoRail", AG._vframes(rail_pts, (-1, 0, 0)), DADO_RAIL, w,
                           size=tex("walnut"), smooth=45)
    g = 0.05
    poly = [(Y_D0, h(Y_D0) + WS_C + 0.0005), (Y_D1, h(Y_D1) + WS_C + 0.0005), (Y_D1, zt1 - g), (Y_D1 - KNEE, zt1 - g),
            (Y_D0 + KNEE, zt0 - g), (Y_D0, zt0 - g)]
    ground = _prism_x("Architecture_Stair_Dado_Ground", poly, X_DADO, X_WALL + 0.01, w)
    C.bevel(ground, 0.002, 1, 40)
    _uv_rake(ground, tex("walnut"))
    parts = [rail, ground]
    to3 = _to3_x(X_DADO)
    bw = (Y_D1 - Y_D0) / DADO_BAYS
    stiles = []
    for i in range(DADO_BAYS):
        ya = Y_D0 + i * bw + (0.07 if i == 0 else 0.05)
        yb = Y_D0 + (i + 1) * bw - (0.07 if i == DADO_BAYS - 1 else 0.05)
        zb_ = lambda y: h(y) + WS_C + 0.085
        zt_ = lambda y: h(y) + DADO_TOP - 0.070 - 0.080
        pp = [(ya, zb_(ya)), (yb, zb_(yb)), (yb, zt_(yb)), (ya, zt_(ya))]
        parts += _panel(f"Architecture_Stair_Dado_P{i}", pp, to3, (-1.0, 0.0, 0.0), w)
        if i:
            stiles.append(Y_D0 + i * bw)
    return _join(parts, "Architecture_Stair_Dado"), stiles


def _wall_bracket():
    """Cast brass handrail bracket: wall rose on the dado, a cranked round arm and a turned saddle
    under the rail. Origin on the dado face, room toward -x."""
    b = mat("brass_aged")
    rose = C.lathe("RailBracketRose", [(0.031, 0.0), (0.031, 0.003), (0.028, 0.006), (0.022, 0.009), (0.015, 0.011),
                                       (0.010, 0.0125), (0.0, 0.013)], 24, b, cap_bottom=False, rot=C.roty(-90))
    arm = _tube("RailBracketArm", _fillet_path([(-0.010, 0, 0), (X_R - X_DADO, 0, 0), (X_R - X_DADO, 0, 0.030)],
                                               [0, 0.026, 0], 6), 0.0062, 10, b)
    zr = 0.065 - R_RAIL
    saddle = C.lathe("RailBracketSaddle", [(0.0062, zr - 0.020), (0.0085, zr - 0.012), (0.0115, zr - 0.004),
                                           (0.0125, zr + 0.004), (0.0105, zr + 0.009), (0.0, zr + 0.010)], 20, b,
                     cap_bottom=False, center=(X_R - X_DADO, 0, 0))
    for p_ in (rose, saddle):
        AG._uv_vertical(p_, 0.3)
    return _join([rose, arm, saddle], "Architecture_Stair_RailBracket")


def _wall_rail():
    b = mat("brass_aged")
    zr = lambda y: h(y) + RAIL_C
    yb, yt = ynose(1), Y_TOP
    xe = X_WALL - 0.012
    corners = [(xe, yb - 0.38, zr(yb)), (X_R, yb - 0.38, zr(yb)), (X_R, yb, zr(yb)), (X_R, yt, zr(yt)),
               (X_R, yt + 0.32, zr(yt)), (xe, yt + 0.32, zr(yt))]
    path = _fillet_path(corners, [0, 0.075, 0.30, 0.30, 0.075, 0], 10)
    rail = _tube("Architecture_Stair_WallRail_Tube", path, R_RAIL, 18, b, size=0.3)
    parts = [rail]
    for (x, y, z) in (corners[0], corners[-1]):
        ro = C.lathe("WallRailRose", [(0.042, 0.0), (0.042, 0.004), (0.038, 0.008), (0.031, 0.011), (0.026, 0.013),
                                      (0.026, 0.017), (0.0, 0.018)], 28, b, cap_bottom=False, rot=C.roty(-90),
                     center=(X_WALL, y, z))
        AG._uv_vertical(ro, 0.3)
        parts.append(ro)
    return _join(parts, "Architecture_Stair_WallRail")


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

def build_flight():
    """The east flight's unique (non-instanced) pieces, in place. Returns objects."""
    out = [_flight_body(), _curtail_step()]
    out += _string()
    sp, door = _spandrel()
    out.append(_join(sp, "Architecture_Stair_Spandrel"))
    out.append(_wall_string())
    dado, stiles = _dado()
    out.append(dado)
    out.append(_wall_rail())
    return out, stiles


def build_stairs():
    """Both flights (east built, west mirrored), newels, lamps, balustrades. Returns all objects."""
    before = set(bpy.data.objects)
    col = _col()
    east, stiles = build_flight()
    for ob in east:
        ob.name = ob.name.replace("Architecture_Stair_", "Architecture_Stair_E_")
        ob.data.name = ob.name
        C.move_to(ob, col)
    for ob in east:
        _mirror_copy(ob, ob.name.replace("_E_", "_W_"))
    # instanced parts
    _balustrade(col)
    nb = _shared("newel_bottom", build_bottom_newel)
    nt = _shared("newel_top", build_top_newel)
    lamp_src = build_newel_lamp()
    props = {"light_points": [[float(c) for c in p] for p in lamp_src["light_points"]],
             "light_color": str(lamp_src["light_color"])}
    lamp = lamp_src.data
    lamp.name = "Light_NewelLamp_Stair"
    bpy.data.objects.remove(lamp_src, do_unlink=True)
    brk = _shared("rail_bracket", _wall_bracket)
    cap_top = RISER + 1.34 + 0.200
    for s, tag in ((1, "E"), (-1, "W")):
        AG._inst(nb, f"Architecture_Stair_{tag}_NewelBottom", (s * X_C, Y_N, RISER), 0.0, col)
        AG._inst(nt, f"Architecture_Stair_{tag}_NewelTop", (s * TN_XC, TN_YC, 0.0), 0.0, col)
        lo = AG._inst(lamp, f"Light_NewelLamp_Stair_{tag}", (s * X_C, Y_N, cap_top), 0.0, col)
        for k, v in props.items():
            lo[k] = v
        for i, ys in enumerate(stiles):
            AG._inst(brk, f"Architecture_Stair_{tag}_RailBracket_{i + 1:02d}", (s * X_DADO, ys, h(ys) + RAIL_C - 0.065),
                     0.0 if s > 0 else math.pi, col)
    made = [o for o in bpy.data.objects if o not in before]
    for o in made:
        if o.type == "MESH":
            AG._uvdata(o.data)
        if col not in o.users_collection:
            C.move_to(o, col)
    return made


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _standins():
    """Lobby stand-in: marble floor, limestone walls with the entrance windows and door, the hall's
    south wall with the two arches, a plaster ceiling; a 1.7 m figure for scale."""
    objs = []
    lb = P.LOBBY
    x0, x1, y0, y1 = lb["minX"], lb["maxX"], -lb["maxZ"], -lb["minZ"]
    stone = mat("limestone")
    fl = C.box_minmax("Preview_LobbyFloor", (x0, y0 - 1, -0.1), (x1, y1 + 3, 0.0), mat("marble_checker"))
    C.uv_box(fl, tex("marble_checker"))
    objs.append(fl)

    def wall(nm, lo, hi):
        ob = C.box_minmax(f"Preview_{nm}", lo, hi, stone)
        C.uv_box(ob, tex("limestone"))
        objs.append(ob)

    top = P.LOBBY_CEILING + 0.3
    wall("WallW", (x0 - 0.3, y0 - 0.8, 0), (x0, y1 + 0.8, top))
    wall("WallE", (x1, y0 - 0.8, 0), (x1 + 0.3, y1 + 0.8, top))
    # south wall with the main door (x +-1.4, 0..4.6) and two windows (x +-3.6 +-0.8, 1.2..5.8)
    ys0, ys1 = y0 - 0.8, y0
    for nm, a, b_, z0, z1 in (("S1", x0, -4.4, 0, top), ("S2", -2.8, -1.4, 0, top), ("S3", 1.4, 2.8, 0, top),
                              ("S4", 4.4, x1, 0, top), ("S5", -1.4, 1.4, 4.6, top), ("S6", -4.4, -2.8, 0, 1.2),
                              ("S7", -4.4, -2.8, 5.8, top), ("S8", 2.8, 4.4, 0, 1.2), ("S9", 2.8, 4.4, 5.8, top)):
        wall(nm, (a, ys0, z0), (b_, ys1, z1))
    # hall south wall: arch to the hall (x +-1.8, 0..4.0) and the landing passage (x +-1.6, 4.6..7.5)
    yn0, yn1 = y1, y1 + 0.8
    for nm, a, b_, z0, z1 in (("N1", x0, -1.8, 0, GY), ("N2", 1.8, x1, 0, GY), ("N3", x0, -1.6, GY, top),
                              ("N4", 1.6, x1, GY, top), ("N5", -1.8, 1.8, 4.0, GY), ("N6", -1.6, 1.6, 7.5, top)):
        wall(nm, (a, yn0, z0), (b_, yn1, z1))
    ceil = C.box_minmax("Preview_Ceiling", (x0 - 0.3, y0 - 0.8, P.LOBBY_CEILING), (x1 + 0.3, y1 + 0.8, top), mat("plaster"))
    C.uv_box(ceil, tex("plaster"))
    objs.append(ceil)
    # hall beyond: a dim warm room
    hb = C.box_minmax("Preview_HallBeyond", (-4, yn1 + 6, 0), (4, yn1 + 6.2, 8), mat("walnut_dark"))
    objs.append(hb)
    hf = C.box_minmax("Preview_HallFloor", (-4, yn1, -0.1), (4, yn1 + 6, 0), mat("parquet_herringbone"))
    C.uv_box(hf, tex("parquet_herringbone"))
    objs.append(hf)
    pm = bpy.data.materials.get("Preview_Person") or bpy.data.materials.new("Preview_Person")
    try:
        pm.use_nodes = True
    except AttributeError:
        pass
    try:
        bs = next(n for n in pm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bs.inputs["Base Color"].default_value = (0.20, 0.22, 0.27, 1)
        bs.inputs["Roughness"].default_value = 0.75
    except Exception:  # noqa: BLE001
        pass
    pm.diffuse_color = (0.20, 0.22, 0.27, 1)
    # 1.7 m figures for scale: at the foot of the east flight, half-way up the west one, on the landing
    for px, py, pz in ((3.1, -17.0, 0.0), (-5.0, -14.8, None), (2.6, -10.0, GY)):
        if pz is None:
            k = math.floor((py - Y_BOT) / TREAD)
            pz = hk(k)
        objs.append(C.cylinder("Preview_Person", 0.17, 0.19, 1.42, (px, py, pz + 0.71), pm, 24))
        objs.append(C.sphere("Preview_Person_Head", 0.105, (px, py, pz + 1.585), pm, 16, 10))
    return objs


def _lights(scene):
    sun = R.sun("Preview_Sun", direction_web=(0.45, 0.42, 1.0), strength=3.2, color=(1.0, 0.9, 0.76), angle_deg=1.0)
    R.sky_world(scene, strength=1.2, sun_ob=sun, tint=(0.58, 0.72, 0.95))
    lb = P.LOBBY
    yS = -lb["maxZ"]
    win = bpy.data.lights.new("Preview_Windows", "AREA")
    win.shape = "RECTANGLE"
    win.size, win.size_y = 10.0, 5.0
    win.energy = 650
    win.color = (0.82, 0.88, 1.0)
    o = bpy.data.objects.new("Preview_Windows", win)
    scene.collection.objects.link(o)
    o.location = (0.0, yS + 0.3, 4.2)
    o.rotation_euler = (math.radians(-90), 0, 0)
    lan = R.point_light("Preview_Lantern", (0.0, -15.0, 6.2), 520, (1.0, 0.8, 0.58), 0.35)
    lan.data.use_shadow = True
    hall = R.point_light("Preview_HallGlow", (0.0, -5.0, 3.0), 900, (1.0, 0.76, 0.5), 1.0)
    hall.data.use_shadow = False
    # stand-in fills are not fixtures: keep them out of the camera and out of the polished marble
    for L in (o, lan, hall):
        for attr in ("visible_camera", "visible_glossy"):
            try:
                setattr(L, attr, False)
            except AttributeError:
                pass
    for o in bpy.data.objects:
        if o.type == "MESH" and o.get("light_points") is not None:
            # the bulbs sit inside opaque opal globes: let their light through the lamp itself
            o.visible_shadow = False
            for i, p in enumerate(o["light_points"]):
                L = R.point_light(f"{o.name}_L{i}", o.matrix_world @ Vector(p), 14.0, (1.0, 0.8, 0.55), 0.03)
                L.data.use_shadow = True
                L.visible_camera = False


VIEWS = [
    ("lobby", (0.0, -19.55, 1.65), (0.0, -12.0, 3.3), 15, (960, 640)),
    ("hero", (-1.0, -19.6, 1.65), (4.4, -15.65, 2.45), 21, (960, 640)),
    ("flight_side", (-2.4, -14.6, 2.3), (5.0, -14.9, 2.5), 15, (960, 640)),
    ("landing_down", (5.15, -10.55, 6.25), (5.0, -18.2, 0.6), 18, (960, 640)),
    ("newel", (2.9, -19.8, 1.5), (4.45, -17.9, 1.4), 28, (720, 960)),
    ("closure", (1.6, -9.3, 1.7), (5.0, -11.2, 2.3), 20, (960, 720)),
    ("curtail", (3.55, -19.05, 0.62), (4.42, -17.95, 0.32), 26, (960, 720)),
    ("lamp", (3.55, -19.0, 2.55), (4.465, -17.976, 2.35), 50, (960, 720)),
    ("balustrade", (3.0, -15.7, 2.55), (4.45, -14.2, 3.2), 30, (960, 720)),
    ("nosing", (5.35, -17.85, 1.25), (4.6, -16.75, 0.95), 26, (960, 720)),
    ("wall", (4.85, -16.9, 2.5), (6.0, -15.0, 2.2), 24, (960, 720)),
    ("spandrel", (2.2, -15.6, 1.45), (4.4, -13.6, 1.6), 24, (960, 720)),
    ("top", (2.75, -12.95, 5.45), (4.45, -11.4, 5.05), 28, (960, 720)),
]


def _report(objs):
    flights = {"E": [0, 0], "W": [0, 0]}
    seen = set()
    per = {}
    for o in objs:
        if o.type != "MESH":
            continue
        t = C.tris(o)
        tag = "E" if "_E_" in o.name or o.name.endswith("_E") else ("W" if "_W_" in o.name or o.name.endswith("_W") else None)
        key = o.data.name
        if tag:
            flights[tag][1] += t
            if key not in seen:
                flights[tag][0] += t
        seen.add(key)
        per.setdefault(key, [t, 0])
        per[key][1] += 1
    for k, (t, n) in sorted(per.items()):
        print(f"TRIS {k}: {t} x{n}")
    for tag, (u, r) in flights.items():
        print(f"TRIS flight_{tag}: unique-mesh {u}, rendered {r}")
    return flights


def preview(out_dir):
    scene = bpy.context.scene
    objs = build_stairs()
    _report(objs)
    AG.build_landing()
    _standins()
    _lights(scene)
    R.engine(scene, "CYCLES", int(os.environ.get("OVR_SAMPLES", "32")), (960, 640))
    scene.cycles.max_bounces = 6
    scene.view_settings.exposure = float(os.environ.get("OVR_EXPOSURE", "-0.6"))
    shots = os.environ.get("OVR_SHOTS", "")
    cam = R.camera(lens=20)
    for name, loc, tgt, lens, size in VIEWS:
        if shots and name not in shots.split(","):
            continue
        scene.render.resolution_x, scene.render.resolution_y = size
        cam.data.lens = lens
        R.look(cam, loc, tgt)
        R.render(os.path.join(out_dir, f"arch_stairs_{name}.png"))
