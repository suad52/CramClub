"""
The Grand Reading Hall's U-shaped upper gallery, modelled in place from plan.GALLERY:

  * the gallery floor (oak boards, with honey-oak header boards where the boards change direction
    at the NW / SW corners, and a moulded walnut skirting wherever the floor meets bare wall) and its
    coffered walnut soffit, with a warm LED wash strip tucked behind the fascia's inner edge (it
    lights the bookcases under the gallery, Ref 2 / Ref 4);
  * the deep walnut FASCIA on the front edge: rounded nosing, cyma reversa, dentil course, bed
    mould, a pulvinated ornament_band frieze broken by rosette blocks over every support, an
    astragal, a two-band architrave and a moulded cyma bottom edge (4.6 m down to 4.02 m);
  * the walnut ARCADE under it (Ref 2): fluted columns on Attic bases with carved Corinthian
    capitals (lobed acanthus with curled tips, rounded corner helices), pilaster dosserets and
    segmental arches of one constant rise:span ratio. Every bay wider than 3.5 m is split by a
    hanging pendant (an instanced turned drop with hanging leaves), so the arcade keeps a tight
    2-2.8 m rhythm. Moulded archivolts, keystones, beaded spandrel panels with rosettes;
  * the RAILING: blackened wrought iron (12-sided turned urn balusters at ~0.12 m, stout newel
    posts with aged-brass finials and C-scroll brackets at the columns, lattice-and-scroll panels
    mid-bay with every contact collared or riveted) on a walnut curb, under a walnut ogee handrail,
    continuous and mitred round the corners;
  * the landing over the lobby (plan.STAIRS["landing_railing"]) with the same fascia (returned and
    mitred at its ends), a walnut trimmer + landing nosing over each stair head, scroll consoles
    under the fascia ends and the same railing.

Everything is built in place (Blender coordinates, plan.py web coordinates converted), into
ARCHITECTURE/Balcony (floor, soffit, fascia, frieze, railings) and ARCHITECTURE/Columns
(columns, pendants, arcade). Balusters, posts, brackets, iron panels, pendants and columns are
linked duplicates of one mesh each.

Public API
    build_gallery(landing=True) -> list of objects
    build_landing() -> list of objects
    build_railing(a, b, y=GALLERY_Y, height=RAILING_H) -> list of objects (web (x, z) end points)
    build_arcade_column(height=SPRING) -> one column object at the origin (abacus top at `height`)
    preview(out_dir), preview_column(out_dir), preview_parts(out_dir)
"""

from __future__ import annotations

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

import lib_core as C
import lib_materials as M
import lib_render as R
import plan as P

mat = M.mat
tex = M.tex_size

# ---------------------------------------------------------------------------
# Dimensions (metres, Blender Z up)
# ---------------------------------------------------------------------------

GY = P.GALLERY_Y                 # gallery floor top (4.6)
GU = P.GALLERY_UNDERSIDE         # nominal underside (4.2)
RH = P.RAILING_H                 # handrail top above the floor (1.08)
EAST_WALL = P.HALL["maxX"]       # hall east wall inner face (x = 14)

SPRING = 3.08      # top of the column abacus = arch springing line
RING = 0.112       # archivolt depth (radial)
FB = 4.02          # fascia bottom (moulded edge drops below the 4.2 underside; clears the 4.0 m wall bookcases)
RISE_RATIO = 0.26  # every arch: rise = 0.26 x clear span (one segmental shape throughout)
EXTRADOS_CLEAR = 0.10  # archivolt top stays at least this far below the fascia bottom
SPLIT_CLEAR = 3.5  # a bay with a wider clear span gets a hanging pendant at mid-span
RIB_Z = 4.10       # coffer rib soffit
CEIL_Z = 4.20      # coffer pocket ceiling = slab underside
SP_T = 0.13        # spandrel half thickness
DOS_HW = 0.19      # dosseret half width along the run
DOS_T = 0.16       # dosseret half thickness
CORNER_HW = 0.18   # corner dosseret (square)
COL_REF = 0.175    # reference shaft radius the column proportions were drawn at
COL_R = 0.20       # shaft radius at the foot
PENDANT_GAP = 0.70 # wall-end pendant drop distance from the east wall
EMBED = 0.02       # fascia / mouldings run this far into the wall
BACK_O = -0.20     # fascia beam back face (toward the walls)
FLOOR_O = -0.06    # gallery floor boards stop here (under the curb)

FRIEZE_Z0, FRIEZE_Z1 = 4.170, 4.412
FRIEZE_O = 0.172
ORN_PERIOD = 0.6 * (FRIEZE_Z1 - FRIEZE_Z0) / 0.3   # ornament_band repeat, aspect kept
DENTIL_O0, DENTIL_O1 = 0.198, 0.236
DENTIL_Z0, DENTIL_Z1 = 4.428, 4.484
DENTIL_W, DENTIL_PITCH = 0.044, 0.084

# railing (heights above the gallery floor)
CURB_H = 0.065
BRAIL_TOP = 0.088
CORE_Z0, CORE_Z1 = RH - 0.075, RH - 0.055
BAL_SP = 0.12
PANEL_W = 0.62
PANEL_RING = 0.13
POST_HW = 0.025

# Fascia cross-section (o = outward from the railing line toward the hall void, z absolute).
FASCIA = [
    (FLOOR_O, 4.600), (0.225, 4.600),
    (0.243, 4.597), (0.257, 4.589), (0.266, 4.577), (0.270, 4.563),          # rounded nosing
    (0.268, 4.552), (0.262, 4.545), (0.250, 4.542),                          # quirk + fillet
    (0.244, 4.536), (0.238, 4.526), (0.232, 4.513), (0.224, 4.503),          # cyma reversa
    (0.214, 4.497), (0.208, 4.494), (0.205, 4.488),
    (DENTIL_O0, 4.488), (DENTIL_O0, 4.425),                                   # dentil backing
    (0.195, 4.420), (0.189, 4.416), (0.182, 4.414), (0.178, 4.412),          # bed mould
    (FRIEZE_O, 4.412), (FRIEZE_O, 4.170),                                     # frieze ground
    (0.180, 4.168), (0.186, 4.164), (0.190, 4.158), (0.191, 4.152),          # astragal
    (0.189, 4.147), (0.184, 4.143), (0.186, 4.141),
    (0.186, 4.078), (0.181, 4.074), (0.178, 4.070),                          # upper architrave band
    (0.178, 4.062),                                                           # lower band
    (0.173, 4.055), (0.165, 4.046), (0.158, 4.037), (0.151, 4.029),          # cyma recta bottom edge
    (0.144, 4.024), (0.136, FB),
    (-0.188, FB), (BACK_O, FB + 0.012), (BACK_O, CEIL_Z), (FLOOR_O, CEIL_Z),
]
FASCIA_MAX_O = max(o for o, z in FASCIA)

# Walnut ogee handrail (u across, v up from its underside), sits on the iron core rail.
_HR = [(0.022, 0.0), (0.029, 0.003), (0.033, 0.009), (0.032, 0.015), (0.028, 0.019),
       (0.031, 0.024), (0.036, 0.030), (0.0395, 0.036), (0.0400, 0.042), (0.0385, 0.047),
       (0.034, 0.051), (0.026, 0.0538), (0.013, 0.0549)]
HANDRAIL = [(-u, v) for u, v in reversed(_HR)] + list(_HR)

ARCHIVOLT = [(0.000, -0.003), (0.000, 0.010), (0.006, 0.018), (0.014, 0.019), (0.021, 0.014),
             (0.026, 0.011), (0.074, 0.011), (0.082, 0.018), (0.094, 0.024), (0.106, 0.021),
             (0.112, 0.012), (0.113, -0.003)]
BEAD = [(-0.0075, -0.002), (-0.0062, 0.0058), (0.0, 0.0095), (0.0062, 0.0058), (0.0075, -0.002)]

# Landing nosing + trimmer face over the stair heads (o outward from the landing edge, z absolute).
TRIMMER = [
    (0.000, 4.600), (0.030, 4.600), (0.038, 4.598), (0.0435, 4.592), (0.0458, 4.583),
    (0.0445, 4.573), (0.039, 4.566), (0.031, 4.563),                         # bullnose
    (0.026, 4.560), (0.019, 4.553), (0.013, 4.543), (0.009, 4.532), (0.007, 4.524),  # cove
    (0.003, 4.520), (0.003, 4.140),                                           # trimmer face
    (0.008, 4.136), (0.011, 4.128), (0.010, 4.119), (0.006, 4.112), (0.003, 4.110),  # bead
    (0.003, RIB_Z), (0.000, RIB_Z + 0.004), (-0.030, RIB_Z + 0.004), (-0.030, 4.585), (0.000, 4.585),
]

# Gallery-level skirting (o into the room from the wall face).
SKIRTING = [(-0.010, 0.000), (0.021, 0.000), (0.021, 0.118), (0.019, 0.124), (0.016, 0.128),
            (0.014, 0.134), (0.0135, 0.141), (0.011, 0.149), (0.0075, 0.156), (0.004, 0.160),
            (0.002, 0.166), (0.000, 0.168), (-0.010, 0.168)]
SKIRT_H = 0.168
HEADER_W = 0.16


def _col_balcony():
    return C.collection("Balcony", C.collection("ARCHITECTURE"))


def _col_columns():
    return C.collection("Columns", C.collection("ARCHITECTURE"))


def _b2(p):
    """web (x, z) -> Blender (x, y)."""
    return Vector((p[0], -p[1]))


# ---------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------

def _mesh(name, verts, faces, uvs=None, mats=None, face_mats=None, col=None, recalc=True, smooth=40.0):
    bm = bmesh.new()
    bv = [bm.verts.new(v) for v in verts]
    uvl = bm.loops.layers.uv.new("UVMap")
    for fi, f in enumerate(faces):
        try:
            face = bm.faces.new([bv[i] for i in f])
        except ValueError:
            continue
        if face_mats is not None:
            face.material_index = face_mats[fi]
        if uvs is not None:
            for loop, uv in zip(face.loops, uvs[fi]):
                loop[uvl].uv = uv
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, mats, col=col)
    if smooth:
        C.shade_smooth(ob, smooth)
    else:
        C.shade_flat(ob)
    return ob


def _frame_sweep(name, frames, profile, mats=None, closed_profile=True, closed_path=False, cap=True,
                 size=1.0, col=None, smooth=40.0, recalc=True, edge_mats=None, fill_rings=()):
    """Sweeps profile [(u, v)] through frames [(p, side, up)]: vertex = p + side*u + up*v.
    UVs: U = distance along the path / size (wood grain along the part), V = along the profile."""
    m, n = len(profile), len(frames)
    verts = [p + side * u + up * v for p, side, up in frames for u, v in profile]
    L = [0.0]
    for i in range(1, n):
        L.append(L[-1] + (frames[i][0] - frames[i - 1][0]).length)
    l_close = L[-1] + (frames[0][0] - frames[-1][0]).length
    pl = [0.0]
    for j in range(1, m):
        pl.append(pl[-1] + (Vector(profile[j]) - Vector(profile[j - 1])).length)
    pl_close = pl[-1] + (Vector(profile[0]) - Vector(profile[-1])).length
    faces, uvs, fm = [], [], []
    pe = m if closed_profile else m - 1
    for i in range(n if closed_path else n - 1):
        i2 = (i + 1) % n
        u0, u1 = L[i] / size, (L[i + 1] if i + 1 < n else l_close) / size
        for j in range(pe):
            j2 = (j + 1) % m
            v0, v1 = pl[j] / size, (pl[j + 1] if j + 1 < m else pl_close) / size
            faces.append((i * m + j, i2 * m + j, i2 * m + j2, i * m + j2))
            uvs.append(((u0, v0), (u1, v0), (u1, v1), (u0, v1)))
            fm.append(edge_mats[j] if edge_mats else 0)
    if cap and not closed_path and closed_profile:
        for i, rev in ((0, True), (n - 1, False)):
            f = [i * m + j for j in range(m)]
            uv = [(profile[j][0] / size, profile[j][1] / size) for j in range(m)]
            if rev:
                f, uv = f[::-1], uv[::-1]
            faces.append(tuple(f))
            uvs.append(tuple(uv))
            fm.append(edge_mats[0] if edge_mats else 0)
    for j in fill_rings:
        faces.append(tuple(i * m + j for i in range(n)))
        uvs.append(tuple((verts[i * m + j].x / size, verts[i * m + j].y / size) for i in range(n)))
        fm.append(edge_mats[j] if edge_mats else 0)
    return _mesh(name, verts, faces, uvs, mats, fm, col=col, recalc=recalc, smooth=smooth)


def _hframes(pts, closed=False, side=1.0):
    """Frames for a horizontal polyline [(x, y)]: side = mitred offset toward the path's left
    (side=+1) or right (-1), up = +Z. Profiles are (o, z) with z absolute."""
    pts = [Vector((p[0], p[1])) for p in pts]
    n = len(pts)
    nseg = n if closed else n - 1
    nrm = []
    for i in range(nseg):
        d = (pts[(i + 1) % n] - pts[i]).normalized()
        nrm.append(Vector((-d.y, d.x)) * side)
    frames = []
    for i in range(n):
        if closed:
            na, nb = nrm[i - 1], nrm[i]
        else:
            na, nb = nrm[max(0, i - 1)], nrm[min(i, nseg - 1)]
        mv = (na + nb) / (1.0 + na.dot(nb))
        frames.append((Vector((pts[i].x, pts[i].y, 0.0)), Vector((mv.x, mv.y, 0.0)), Vector((0, 0, 1))))
    return frames


def _vframes(pts, nrm, closed=False, flip=False, scales=None):
    """Frames for a path lying in a plane with normal `nrm`: side = in-plane mitred normal of the
    path (nrm x direction, or its opposite with flip), up = nrm (profiles stand off the plane)."""
    pts = [Vector(p) for p in pts]
    nrm = Vector(nrm).normalized()
    n = len(pts)
    nseg = n if closed else n - 1
    sides = []
    for i in range(nseg):
        d = (pts[(i + 1) % n] - pts[i]).normalized()
        s = nrm.cross(d).normalized()
        sides.append(-s if flip else s)
    frames = []
    for i in range(n):
        if closed:
            sa, sb = sides[i - 1], sides[i]
        else:
            sa, sb = sides[max(0, i - 1)], sides[min(i, nseg - 1)]
        mv = (sa + sb) / max(0.2, 1.0 + sa.dot(sb))
        k = scales[i] if scales else 1.0
        frames.append((pts[i], mv * k, nrm * k))
    return frames


def _place(ob, loc, normal=(0, 0, 1), spin=0.0):
    """Orients an object built facing +Z so it faces `normal`, at `loc` (then join applies it)."""
    q = Vector(normal).normalized().to_track_quat("Z", "Y")
    ob.matrix_world = Matrix.Translation(Vector(loc)) @ q.to_matrix().to_4x4() @ Matrix.Rotation(spin, 4, "Z")
    return ob


def _uv_vertical(ob, size):
    """Wood grain running up turned parts: U = height, V = around (side faces); planar on caps.
    Only for lathe-turned parts (run it before joining them to carved parts)."""
    me = ob.data
    uv = _uvdata(me)
    mw = ob.matrix_world
    c = mw.translation
    for poly in me.polygons:
        nz = abs((mw.to_3x3() @ poly.normal).normalized().z)
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            if nz > 0.8:
                uv[li].uv = (co.x / size, co.y / size)
            else:
                a = math.atan2(co.y - c.y, co.x - c.x)
                r = max(0.03, math.hypot(co.x - c.x, co.y - c.y))
                uv[li].uv = (co.z / size, a * r / size)
    return ob


def _clean(ob, dist=1e-5):
    """Removes degenerate faces/edges a bevel can leave at tight mitres."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.dissolve_degenerate(bm, dist=dist, edges=bm.edges)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def _weld(ob, dist=1e-5):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def _uvdata(me):
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    if me.uv_layers.active is None:
        me.uv_layers.active = me.uv_layers[0]
    me.uv_layers.active.active_render = True
    return me.uv_layers.active.data


def _uv(ob, key, grain):
    return C.uv_box(ob, size=tex(key), grain=grain)


def _rosette(name, radius, depth, petals=8, segs=32, mat_=None, col=None, rings=8):
    """A carved patera: domed boss, groove, and a ring of petals; faces +Z, base at z = 0."""
    prof = [(0.0, 0.92), (0.16, 0.86), (0.24, 0.62), (0.30, 0.44), (0.40, 0.58), (0.62, 0.66),
            (0.84, 0.42), (1.0, 0.0)]
    if rings <= 5:
        prof = [(0.0, 0.95), (0.22, 0.75), (0.34, 0.45), (0.62, 0.66), (1.0, 0.0)]
    bm = bmesh.new()
    rings = []
    for k, (rho, h) in enumerate(prof):
        if k == 0:
            rings.append([bm.verts.new((0, 0, h * depth))])
            continue
        ring = []
        for i in range(segs):
            a = math.tau * i / segs
            pet = abs(math.cos(petals * a / 2))
            if rho > 0.32:
                r = rho * (0.80 + 0.20 * pet ** 0.6)
                hh = h * (0.55 + 0.45 * pet ** 0.8)
            else:
                r, hh = rho, h
            ring.append(bm.verts.new((r * radius * math.cos(a), r * radius * math.sin(a), hh * depth)))
        rings.append(ring)
    c = rings[0][0]
    for i in range(segs):
        bm.faces.new((c, rings[1][i], rings[1][(i + 1) % segs]))
    for a, b in zip(rings[1:], rings[2:]):
        for i in range(segs):
            j = (i + 1) % segs
            bm.faces.new((a[i], b[i], b[j], a[j]))
    ob = C.mesh_from_bmesh(name, bm, mat_, col=col)
    me = ob.data
    if sum(p.normal.z * p.area for p in me.polygons) < 0:
        me.flip_normals()
    C.shade_smooth(ob, 55)
    return ob


def _bezier(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def _spiral_path(center, r0, r1, a0, a1, n):
    """Points of a spiral in a 2D plane (radius r0 -> r1 while the angle goes a0 -> a1)."""
    out = []
    for i in range(n + 1):
        t = i / n
        a = a0 + (a1 - a0) * t
        r = r0 + (r1 - r0) * t ** 0.85
        out.append((center[0] + r * math.cos(a), center[1] + r * math.sin(a)))
    return out


def _rounded_rect(hu, hv, rc, n=2):
    """Closed rounded-rectangle profile (u half-size, v half-size, corner radius)."""
    pts = []
    if n == 0 or rc <= 0:
        return [(hu, -hv), (hu, hv), (-hu, hv), (-hu, -hv)]
    for cu, cv, a0 in ((hu - rc, hv - rc, 0), (-hu + rc, hv - rc, 90), (-hu + rc, -hv + rc, 180), (hu - rc, -hv + rc, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cu + rc * math.cos(a), cv + rc * math.sin(a)))
    return pts


def _box_verts(center, ax, ay, az, hx, hy, hz):
    """8 corners + 6 faces of an oriented box (ax, ay, az orthonormal axes)."""
    v = [center + ax * (i * hx) + ay * (j * hy) + az * (k * hz) for i in (-1, 1) for j in (-1, 1) for k in (-1, 1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return v, f


# ---------------------------------------------------------------------------
# Arcade column: Attic base, fluted shaft with entasis, carved Corinthian capital
# ---------------------------------------------------------------------------

CAPITAL_H = 0.46
BELL = [(0.150, 0.04), (0.152, 0.10), (0.157, 0.18), (0.165, 0.26), (0.175, 0.32), (0.184, 0.355),
        (0.190, 0.372), (0.194, 0.380), (0.194, 0.390)]

# Acanthus leaf rows (t up the leaf), width envelope, and lobing: +1 a lobe tip (pointing up and
# out), -1 an eye notch between lobes. Columns across the leaf (s), denser at the midrib.
LEAF_T = [0.00, 0.09, 0.18, 0.27, 0.36, 0.44, 0.52, 0.60, 0.68, 0.76, 0.84, 0.92, 1.00]
LEAF_W = [0.58, 0.82, 0.98, 0.84, 1.00, 0.99, 0.86, 0.94, 0.90, 0.78, 0.64, 0.40, 0.08]
LEAF_LOBE = [0, 0, 1.0, -1.0, 0.4, 1.0, -1.0, 0.3, 0.8, -0.6, 0.25, 0.0, 0]
LEAF_S = [-1.0, -0.84, -0.64, -0.44, -0.26, -0.11, 0.0, 0.11, 0.26, 0.44, 0.64, 0.84, 1.0]


def _base_profile(radius, k, env):
    """Round plinth + Attic base (lower torus, fillet, scotia, fillet, upper torus, apophyge) whose
    widest point is `env` (the plan's collision radius), heights scaled by k."""
    d = env - radius
    hp = 0.072 * k
    pts = [(env - 0.0015, 0.0), (env, 0.0015), (env, hp - 0.006), (env - 0.0012, hp - 0.0018), (env - 0.0045, hp)]
    az = 0.021 * k
    rc, ar = radius + 0.45 * d, 0.55 * d - 0.0005
    zc = hp + az
    for i in range(8):
        th = math.radians(-78 + 168 * i / 7)
        pts.append((rc + ar * math.cos(th), zc + az * math.sin(th)))
    z = zc + az
    pts += [(radius + 0.30 * d, z + 0.0015 * k), (radius + 0.30 * d, z + 0.006 * k)]
    z += 0.006 * k
    for i in range(1, 7):
        u = i / 6
        pts.append((radius + 0.30 * d - 0.27 * d * math.sin(math.pi * u) ** 0.9 - 0.04 * d * u, z + 0.040 * k * u))
    z += 0.040 * k
    pts += [(radius + 0.24 * d, z + 0.002 * k), (radius + 0.24 * d, z + 0.006 * k)]
    z += 0.006 * k
    az2 = 0.0145 * k
    rc2, ar2 = radius + 0.14 * d, 0.46 * d
    for i in range(8):
        th = math.radians(-90 + 180 * i / 7)
        pts.append((rc2 + ar2 * math.cos(th), z + az2 + az2 * math.sin(th)))
    z += 2 * az2
    pts += [(radius + 0.09 * d, z + 0.002 * k), (radius + 0.035 * d, z + 0.012 * k), (radius + 0.008 * d, z + 0.024 * k),
            (radius, z + 0.034 * k)]
    return pts


def _fluted_shaft(name, z0, z1, r0, r1, nflutes=20, mat_=None):
    L = z1 - z0
    zs = [z0, z0 + 0.012, z0 + 0.060, z0 + L * 0.33, z0 + L * 0.66, z1 - 0.060, z1 - 0.012, z1]

    def rad(z):
        u = (z - z0) / L
        if u <= 0.33:
            return r0
        return r1 + (r0 - r1) * math.cos((u - 0.33) / 0.67 * math.pi / 2)

    def depth_f(z):
        d = min(z - z0, z1 - z)
        if d <= 0.012:
            return 0.0
        if d >= 0.060:
            return 1.0
        return math.sin((d - 0.012) / 0.048 * math.pi / 2)

    pitch = math.tau / nflutes
    fil = 0.24 * pitch
    angs, prof = [], []
    for i in range(nflutes):
        b = i * pitch
        w = pitch - fil
        angs += [b, b + fil, b + fil + w * 0.25, b + fil + w * 0.5, b + fil + w * 0.75]
        prof += [0.0, 0.0, 0.87, 1.0, 0.87]
    m = len(angs)
    verts = []
    for z in zs:
        r, f = rad(z), depth_f(z)
        D = 0.34 * r * (pitch - fil)
        for a, pf in zip(angs, prof):
            rr = r - D * f * pf
            verts.append((rr * math.cos(a), rr * math.sin(a), z))
    faces = []
    for i in range(len(zs) - 1):
        for j in range(m):
            j2 = (j + 1) % m
            faces.append((i * m + j, i * m + j2, (i + 1) * m + j2, (i + 1) * m + j))
    return _mesh(name, verts, faces, None, mat_, recalc=False, smooth=50)


def _bell_r(zt, k):
    def f(z):
        h = (z - zt) / k
        if h <= BELL[0][1]:
            return BELL[0][0] * k
        for (r0, h0), (r1, h1) in zip(BELL, BELL[1:]):
            if h <= h1:
                return (r0 + (r1 - r0) * (h - h0) / (h1 - h0)) * k
        return BELL[-1][0] * k
    return f


def _leaf(name, rb, phi0, z0, H, W, k, mat_, roll=2.5, tc=0.50, sign=1, back_from=4, curl_len=0.75):
    """An acanthus leaf on a turned body of radius rb(z): three pointed lobes a side with eye
    notches between them, a raised midrib between two hollows, edges that sink into the body, and
    an upper part that rolls forward into a real curl (the tip turns down and back under itself).
    sign = -1 hangs the leaf downward (pendant drops). The curled part is a closed shell so its
    underside reads from below. UVs run the grain up the leaf."""
    T, WM, LB, S = LEAF_T, LEAF_W, LEAF_LOBE, LEAF_S
    nt, ns = len(T), len(S)
    thick = 0.0055 * k
    size = tex("walnut")
    cl, offs = [], []
    for t in T:
        if t > tc + 1e-9:
            break
        h = H * t
        off = k * (0.002 + 0.016 * math.sin(math.pi / 2 * min(1.0, t / 0.5)))
        cl.append(Vector((rb(z0 + sign * h) + off, h)))
        offs.append(off)
    ic = len(cl)
    alphas = []
    for i in range(ic):
        d = cl[min(i + 1, ic - 1)] - cl[max(i - 1, 0)]
        alphas.append(math.atan2(d.x, d.y))
    a_c = alphas[-1]
    for i in range(ic, nt):
        u0 = max(0.0, (T[i - 1] - tc) / (1 - tc))
        u1 = (T[i] - tc) / (1 - tc)
        a0 = a_c + roll * u0 ** 1.25
        a1 = a_c + roll * u1 ** 1.25
        am = (a0 + a1) / 2
        ds = H * (T[i] - T[i - 1]) * curl_len * (1 - 0.35 * u1)
        cl.append(cl[-1] + Vector((math.sin(am), math.cos(am))) * ds)
        alphas.append(a1)
        offs.append(offs[-1])
    arc = [0.0]
    for i in range(1, nt):
        arc.append(arc[-1] + (cl[i] - cl[i - 1]).length)
    front, back, uvf, uvb = [], [], [], []
    for i in range(nt):
        c_ = cl[i]
        al = alphas[i]
        N = Vector((math.cos(al), -math.sin(al)))
        Tg = Vector((math.sin(al), math.cos(al)))
        w = W * WM[i]
        lobe = LB[i]
        lower = i < ic
        for s in S:
            a = abs(s)
            prof = (0.0040 * math.exp(-(s / 0.10) ** 2) - 0.0030 * math.exp(-((a - 0.42) / 0.16) ** 2)
                    + 0.004 * (1 - s * s)) * k
            if lower:
                prof -= (offs[i] + 0.003 * k) * a ** 6
            else:
                prof -= 0.005 * k * a ** 2
            if lobe > 0:
                prof += 0.006 * k * lobe * a ** 3
            dh = (0.03 if lobe > 0 else 0.02) * H * lobe * a ** 3
            p2 = c_ + N * prof + Tg * dh
            phi = phi0 + s * w / max(c_.x, 0.05)
            cp, sp = math.cos(phi), math.sin(phi)
            front.append(Vector((p2.x * cp, p2.x * sp, z0 + sign * p2.y)))
            uvf.append((arc[i] / size, s * w / size))
            if i >= back_from:
                pb = p2 - N * (thick * (1 - 0.55 * a ** 4))
                back.append(Vector((pb.x * cp, pb.x * sp, z0 + sign * pb.y)))
                uvb.append((arc[i] / size, s * w / size + 0.05))
    verts = front + back
    uvs_v = uvf + uvb
    boff = len(front)
    F = lambda it, js: it * ns + js
    B = lambda it, js: boff + (it - back_from) * ns + js
    faces = []
    for it in range(nt - 1):
        for js in range(ns - 1):
            faces.append((F(it, js), F(it, js + 1), F(it + 1, js + 1), F(it + 1, js)))
    for it in range(back_from, nt - 1):
        for js in range(ns - 1):
            faces.append((B(it, js), B(it + 1, js), B(it + 1, js + 1), B(it, js + 1)))
        faces.append((F(it, 0), F(it + 1, 0), B(it + 1, 0), B(it, 0)))
        faces.append((F(it, ns - 1), B(it, ns - 1), B(it + 1, ns - 1), F(it + 1, ns - 1)))
    for js in range(ns - 1):
        faces.append((F(nt - 1, js), F(nt - 1, js + 1), B(nt - 1, js + 1), B(nt - 1, js)))
        faces.append((F(back_from, js), B(back_from, js), B(back_from, js + 1), F(back_from, js + 1)))
    uvs = [tuple(uvs_v[x] for x in f) for f in faces]
    ob = _mesh(name, verts, faces, uvs, mat_, recalc=False, smooth=62)
    if sign < 0:
        ob.data.flip_normals()
    return ob


def _volute(name, phi, zt, k, mat_):
    """A corner helix: a ribbon stalk rising from behind the upper diagonal leaf (tangent-matched
    to the spiral) and rolling 1.25 turns into a spiral under the abacus horn, in the diagonal
    plane. Rounded ribbon section, tapering, sampled finely, finished with a turned eye."""
    size = tex("walnut")
    cr, cz = 0.268 * k, zt + 0.335 * k
    a0, a1 = math.radians(188), math.radians(-262)
    spiral = _spiral_path((cr, cz), 0.062 * k, 0.019 * k, a0, a1, 34)
    s0, s1 = Vector(spiral[0]), Vector(spiral[1])
    tdir = (s1 - s0).normalized()
    p0 = Vector((0.150 * k, zt + 0.170 * k))          # starts inside the bell, behind the leaf curl
    stalk = _bezier(p0, p0 + Vector((0.010 * k, 0.060 * k)), s0 - tdir * 0.050 * k, s0, 9)[:-1]
    pts2 = stalk + spiral
    dvec = Vector((math.cos(phi), math.sin(phi), 0))
    pts3 = [dvec * r + Vector((0, 0, z)) for r, z in pts2]
    nrm = Vector((-math.sin(phi), math.cos(phi), 0))
    L = [0.0]
    for a, b in zip(pts3, pts3[1:]):
        L.append(L[-1] + (b - a).length)
    scales = [1.22 - 0.60 * (l / L[-1]) ** 0.75 for l in L]
    prof = _rounded_rect(0.0085 * k, 0.021 * k, 0.0034 * k, 1)
    ob = _frame_sweep(name, _vframes(pts3, nrm, scales=scales), prof, mat_, size=size, smooth=55)
    ep = [(0.0, -0.0175), (0.011, -0.0167), (0.018, -0.0140), (0.0205, -0.010),
          (0.0205, 0.010), (0.018, 0.0140), (0.011, 0.0167), (0.0, 0.0175)]
    eye = C.lathe(name + "_Eye", [(r * k, z * k) for r, z in ep], 14, mat_, smooth_angle=60)
    _place(eye, dvec * cr + Vector((0, 0, cz)), nrm)
    C.apply_transform(eye)
    C.uv_box(eye, size)
    return [ob, eye]


def _inner_helix(name, phi_f, side, zt, k, rb, mat_):
    """One of the two small helices on each face of the bell: a ribbon rising from behind the
    diagonal leaf and curling 1.1 turns toward the face centre, under the fleuron. Drawn in
    (u along the bell, v up) and wrapped onto the bell, standing just proud of it."""
    size = tex("walnut")
    c = (0.034 * k, 0.318 * k)
    spiral = _spiral_path(c, 0.026 * k, 0.008 * k, 0.0, math.radians(400), 18)
    s0 = Vector(spiral[0])
    p0 = Vector((0.092 * k, 0.200 * k))
    stalk = _bezier(p0, p0 + Vector((-0.010 * k, 0.045 * k)), s0 - Vector((0.0, 0.045 * k)), s0, 6)[:-1]
    pts = []
    ns_ = len(stalk)
    for i, (u, v) in enumerate(stalk + spiral):
        z = zt + v
        emerge = min(1.0, i / max(1, ns_ - 1))
        R_ = rb(z) + 0.003 * k - 0.024 * k * (1 - emerge) ** 1.5      # rises out of the bell behind the leaves
        ph = phi_f + side * u / R_
        pts.append(Vector((R_ * math.cos(ph), R_ * math.sin(ph), z)))
    n = len(pts)
    frames = []
    for i in range(n):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        rad = Vector((pts[i].x, pts[i].y, 0)).normalized()
        up = (rad - t * rad.dot(t)).normalized()
        sd = t.cross(up).normalized()
        sc = 1.15 - 0.45 * i / (n - 1)
        frames.append((pts[i], sd * sc, up * sc))
    prof = [(u, v + 0.0072 * k) for u, v in _rounded_rect(0.0048 * k, 0.0075 * k, 0.0024 * k, 1)]
    return _frame_sweep(name, frames, prof, mat_, size=size, smooth=55)


def _abacus(name, z0, z1, k, mat_):
    """Concave-sided Corinthian abacus with chamfered horns and a cavetto/ovolo edge."""
    H, sag, ch = 0.255 * k, 0.034 * k, 0.026 * k
    corners = [(H, -H + ch), (H, H - ch), (H - ch, H), (-H + ch, H), (-H, H - ch), (-H, -H + ch), (-H + ch, -H), (H - ch, -H)]
    outline = []
    for side in range(4):
        a = Vector(corners[side * 2])
        b = Vector(corners[side * 2 + 1])
        mid_n = Vector((math.cos(side * math.pi / 2), math.sin(side * math.pi / 2)))
        for i in range(11):
            t = i / 10
            p = a.lerp(b, t) - mid_n * sag * 4 * t * (1 - t)
            outline.append((p.x, p.y))
    hgt = z1 - z0
    prof = [(-0.08, 0.0), (-0.017, 0.0), (-0.013, 0.16), (-0.005, 0.30), (0.0, 0.34),
            (0.0, 0.46), (0.006, 0.55), (0.0085, 0.70), (0.005, 0.88), (0.0, 1.0), (-0.08, 1.0)]
    prof = [(o * k, z0 + z * hgt) for o, z in prof]
    frames = _hframes(outline, closed=True, side=-1.0)
    return _frame_sweep(name, frames, prof, mat_, closed_path=True, cap=False, size=tex("walnut"),
                        fill_rings=(0, len(prof) - 1), smooth=40)


def build_arcade_column(height=SPRING, radius=COL_R, name="Architecture_Gallery_Column", col=None):
    """One walnut arcade column at the origin, floor at z = 0, abacus top at `height`.
    Round plinth + Attic base kept inside the plan's collision radius, 20-flute shaft with
    entasis, astragal, Corinthian capital (two rows of lobed acanthus with curled tips, rounded
    corner helices, concave abacus with rosette fleurons). Grain follows each part."""
    k = radius / COL_REF
    w = mat("walnut")
    sz = tex("walnut")
    env = P.GALLERY["column_radius"] - 0.002
    parts = []
    bprof = _base_profile(radius, k, env)
    base = C.lathe(name + "_Base", bprof, 32, w, cap_bottom=False, cap_top=False, smooth_angle=48)
    _uv_vertical(base, sz)
    parts.append(base)
    zb = bprof[-1][1]
    zt = height - CAPITAL_H * k
    shaft = _fluted_shaft(name + "_Shaft", zb, zt, radius, radius * 0.86, 20, w)
    _uv_vertical(shaft, sz)
    parts.append(shaft)
    r1 = radius * 0.86
    astr = [(r1 - 0.002, zt - 0.004), (r1 + 0.007 * k, zt), (r1 + 0.012 * k, zt + 0.004 * k), (r1 + 0.015 * k, zt + 0.010 * k),
            (r1 + 0.016 * k, zt + 0.019 * k), (r1 + 0.014 * k, zt + 0.026 * k), (r1 + 0.010 * k, zt + 0.031 * k),
            (r1 + 0.005 * k, zt + 0.035 * k), (r1 + 0.005 * k, zt + 0.042 * k), (r1 - 0.002, zt + 0.045 * k)]
    a_ = C.lathe(name + "_Astragal", astr, 36, w, cap_bottom=False, cap_top=False, smooth_angle=50)
    _uv_vertical(a_, sz)
    parts.append(a_)
    rb = _bell_r(zt, k)
    bell = C.lathe(name + "_Bell", [(r * k, zt + h * k) for r, h in BELL], 32, w, cap_bottom=False, smooth_angle=40)
    _uv_vertical(bell, sz)
    parts.append(bell)
    for i in range(8):     # lower row, between the faces and the diagonals
        phi = math.radians(22.5 + 45 * i)
        parts.append(_leaf(f"{name}_LeafA{i}", rb, phi, zt + 0.030 * k, 0.210 * k, 0.074 * k, k, w, roll=2.35))
    for i in range(8):     # upper row, on the faces and the diagonals
        phi = math.radians(45 * i)
        parts.append(_leaf(f"{name}_LeafB{i}", rb, phi, zt + 0.075 * k, 0.300 * k, 0.070 * k, k, w, roll=2.5))
    for i in range(4):
        parts += _volute(f"{name}_Helix{i}", math.radians(45 + 90 * i), zt, k, w)
        for sd in (1, -1):
            parts.append(_inner_helix(f"{name}_InnerHelix{i}{sd}", math.radians(90 * i), sd, zt, k, rb, w))
    parts.append(_abacus(name + "_Abacus", zt + BELL[-1][1] * k, height, k, w))
    for i in range(4):
        a = math.radians(90 * i)
        d = Vector((math.cos(a), math.sin(a), 0))
        ros = _rosette(f"{name}_Fleuron{i}", 0.036 * k, 0.018 * k, 5, 15, w, rings=5)
        _place(ros, d * (0.255 - 0.034 - 0.006) * k + Vector((0, 0, zt + 0.425 * k)), d)
        C.apply_transform(ros)
        C.uv_box(ros, sz)
        parts.append(ros)
    for p in parts:
        C.apply_transform(p)
    ob = C.join(parts, name)
    if col is not None:
        C.move_to(ob, col)
    return ob


# ---------------------------------------------------------------------------
# Plan layout: the railing line as one polyline, its straight runs, supports
# ---------------------------------------------------------------------------

class _Seg:
    """A straight run of the gallery front: a -> b (Blender 2D), n = outward (toward the void)."""

    def __init__(self, a, b, n, wall_a=False, wall_b=False, corner_a=False, corner_b=False, name="run"):
        self.a, self.b = Vector(a), Vector(b)
        d = self.b - self.a
        self.L = d.length
        self.t = d / self.L
        self.n = Vector(n)
        self.t3 = Vector((self.t.x, self.t.y, 0.0))
        self.n3 = Vector((self.n.x, self.n.y, 0.0))
        self.wall_a, self.wall_b = wall_a, wall_b
        self.corner_a, self.corner_b = corner_a, corner_b
        self.name = name
        self.supports = []

    def p(self, s, o=0.0, z=0.0):
        q = self.a + self.t * s + self.n * o
        return Vector((q.x, q.y, z))

    def p2(self, s, o=0.0):
        return self.a + self.t * s + self.n * o

    @property
    def axis(self):
        return "x" if abs(self.t.x) > abs(self.t.y) else "y"


def _runs_bl():
    return [(r["minX"], -r["maxZ"], r["maxX"], -r["minZ"]) for r in P.GALLERY["runs"].values()]


def _in_rects(p, rects, eps=1e-6):
    return any(x0 - eps <= p.x <= x1 + eps and y0 - eps <= p.y <= y1 + eps for x0, y0, x1, y1 in rects)


def _chain(lines):
    key = lambda v: (round(v.x, 3), round(v.y, 3))
    count = {}
    for a, b in lines:
        for v in (a, b):
            count[key(v)] = count.get(key(v), 0) + 1
    ends = [v for a, b in lines for v in (a, b) if count[key(v)] == 1]
    start = max(ends, key=lambda v: (abs(v.x - EAST_WALL) < 1e-3, v.y)) if ends else lines[0][0]
    path, remaining = [start], list(lines)
    while remaining:
        cur = path[-1]
        for i, (a, b) in enumerate(remaining):
            if key(a) == key(cur):
                path.append(b)
                remaining.pop(i)
                break
            if key(b) == key(cur):
                path.append(a)
                remaining.pop(i)
                break
        else:
            break
    return path


def _at_wall(v):
    return abs(v.x - EAST_WALL) < 1e-3 or abs(v.x - P.HALL["minX"]) < 1e-3


def _hw(kind):
    return CORNER_HW if kind == "corner" else DOS_HW


def _split_bays(supports):
    """Adds a hanging pendant at mid-span of every bay whose clear span exceeds SPLIT_CLEAR."""
    out = [supports[0]]
    for (s1, k1), (s2, k2) in zip(supports, supports[1:]):
        clear = (s2 - _hw(k2)) - (s1 + _hw(k1))
        if clear > SPLIT_CLEAR:
            out.append(((s1 + s2) / 2, "pendant"))
        out.append((s2, k2))
    return out


def _layout():
    lines = [(_b2(r["a"]), _b2(r["b"])) for r in P.GALLERY["railings"]]
    path = _chain(lines)
    runs = _runs_bl()
    d = (path[1] - path[0]).normalized()
    left = Vector((-d.y, d.x))
    mid = (path[0] + path[1]) / 2
    side = -1.0 if _in_rects(mid + left * 0.4, runs) else 1.0
    cols = [_b2(c) for c in P.GALLERY["columns"]]
    names = {(-1, 0): "North", (0, -1): "West", (1, 0): "South", (0, 1): "East"}
    segs = []
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        dd = (b - a).normalized()
        n = Vector((-dd.y, dd.x)) * side
        nm = names.get((round(dd.x), round(dd.y)), f"Run{i}")
        sg = _Seg(a, b, n, wall_a=(i == 0 and _at_wall(a)), wall_b=(i == len(path) - 2 and _at_wall(b)),
                  corner_a=i > 0, corner_b=i < len(path) - 2, name=nm)
        for c in cols:
            v = c - sg.a
            s_ = v.dot(sg.t)
            if abs(v.dot(sg.n)) < 1e-3 and -1e-3 <= s_ <= sg.L + 1e-3:
                corner = (s_ < 1e-3 and sg.corner_a) or (s_ > sg.L - 1e-3 and sg.corner_b)
                sg.supports.append((min(max(s_, 0.0), sg.L), "corner" if corner else "column"))
        if sg.wall_a:
            sg.supports.append((PENDANT_GAP, "pendant"))
        if sg.wall_b:
            sg.supports.append((sg.L - PENDANT_GAP, "pendant"))
        sg.supports.sort()
        sg.supports = _split_bays(sg.supports)
        segs.append(sg)
    return {"path": path, "side": side, "segs": segs, "columns": cols}


def _ext_path(path, segs, amount=EMBED):
    """The polyline with its wall ends pushed `amount` into the wall."""
    pts = [Vector(p) for p in path]
    if segs[0].wall_a:
        pts[0] = pts[0] - segs[0].t * amount
    if segs[-1].wall_b:
        pts[-1] = pts[-1] + segs[-1].t * amount
    return pts


def _face(faces, verts, idx, want):
    a, b, c = (Vector(verts[i]) for i in idx[:3])
    if (b - a).cross(c - a).dot(want) < 0:
        idx = tuple(reversed(idx))
    faces.append(tuple(idx))


# ---------------------------------------------------------------------------
# Arcade: dosserets, segmental arches, archivolts, keystones, beaded spandrels, pendants
# ---------------------------------------------------------------------------

IMPOST = [(-0.004, 0.0), (0.010, 0.0), (0.014, 0.006), (0.014, 0.014), (0.009, 0.020), (0.004, 0.028),
          (0.0, 0.034), (-0.004, 0.034)]


def _bead_rect(name, center, along, nrm, hw, z0, z1, mat_):
    pts = [center + along * (-hw) + Vector((0, 0, z0)), center + along * hw + Vector((0, 0, z0)),
           center + along * hw + Vector((0, 0, z1)), center + along * (-hw) + Vector((0, 0, z1))]
    return _frame_sweep(name, _vframes(pts, nrm, closed=True), BEAD, mat_, closed_path=True, cap=False,
                        size=tex("walnut"), smooth=60)


def _dosseret(seg, s, kind, name, w, z0=SPRING, z1=FB, corner_faces=None):
    c = seg.p(s)
    hw = _hw(kind)
    ht = CORNER_HW if kind == "corner" else DOS_T
    q = [c + seg.t3 * i * hw + seg.n3 * j * ht for i in (-1, 1) for j in (-1, 1)]
    lo = Vector((min(v.x for v in q), min(v.y for v in q), z0))
    hi = Vector((max(v.x for v in q), max(v.y for v in q), z1))
    parts = [C.box_minmax(name, lo, hi, w, bevel_w=0.005)]
    _uv(parts[0], "walnut", "z")
    ring = [(lo.x, lo.y), (hi.x, lo.y), (hi.x, hi.y), (lo.x, hi.y)]
    prof = [(o, z0 + z) for o, z in IMPOST]
    parts.append(_frame_sweep(name + "_Impost", _hframes(ring, closed=True, side=-1.0), prof, w, closed_path=True,
                              cap=False, size=tex("walnut")))
    faces = corner_faces if corner_faces else [(seg.n3, seg.t3), (-seg.n3, seg.t3)]
    for k, (nv, along) in enumerate(faces):
        half = (ht if kind == "corner" else (ht if abs(nv.dot(seg.n3)) > 0.5 else hw))
        ctr = c + nv * (half + 0.0)
        parts.append(_bead_rect(f"{name}_Bead{k}", ctr, along, nv, (hw if abs(nv.dot(seg.n3)) > 0.5 else ht) - 0.05,
                                z0 + 0.095, z1 - 0.075, w))
    return parts


PENDANT_PROF = [(0.0, -0.74), (0.006, -0.738), (0.012, -0.733), (0.019, -0.726), (0.026, -0.717), (0.032, -0.706),
                (0.036, -0.695), (0.039, -0.684), (0.040, -0.676), (0.038, -0.670), (0.034, -0.664),
                (0.040, -0.656), (0.046, -0.646), (0.058, -0.630), (0.070, -0.612), (0.082, -0.592), (0.092, -0.570),
                (0.099, -0.548), (0.104, -0.525), (0.105, -0.502), (0.104, -0.480), (0.100, -0.459), (0.094, -0.440),
                (0.085, -0.423), (0.074, -0.408), (0.066, -0.400), (0.060, -0.394), (0.062, -0.388), (0.066, -0.382),
                (0.074, -0.377), (0.082, -0.372), (0.084, -0.366), (0.084, -0.360), (0.080, -0.355), (0.074, -0.350),
                (0.066, -0.344), (0.060, -0.338), (0.061, -0.330), (0.064, -0.318), (0.074, -0.305), (0.086, -0.290),
                (0.099, -0.271), (0.112, -0.250), (0.124, -0.228), (0.136, -0.205), (0.145, -0.183), (0.152, -0.160),
                (0.157, -0.140), (0.160, -0.120), (0.163, -0.100), (0.164, -0.090), (0.166, -0.070), (0.163, -0.065),
                (0.160, -0.062), (0.150, -0.055)]


def _pendant_mesh():
    """Hanging drop under a dosseret (built once at the origin, run along local X): a moulded
    inverted cap, a turned drop (cushion, reel, urn, acorn finial) and eight hanging acanthus
    leaves curling outward at their tips."""
    w = mat("walnut")
    sz = tex("walnut")
    S = SPRING
    ring = [(-DOS_HW, -DOS_T), (DOS_HW, -DOS_T), (DOS_HW, DOS_T), (-DOS_HW, DOS_T)]
    cp = [(-0.004, S), (0.012, S), (0.0158, S - 0.0035), (0.0172, S - 0.010), (0.0158, S - 0.017), (0.012, S - 0.022),
          (0.0065, S - 0.025), (0.004, S - 0.026), (0.004, S - 0.031), (0.0015, S - 0.035), (-0.0012, S - 0.040),
          (-0.0028, S - 0.046), (-0.0036, S - 0.051), (-0.004, S - 0.055)]
    cap = _frame_sweep("PendantCap", _hframes(ring, closed=True, side=-1.0), cp, w, closed_path=True, cap=False,
                       size=sz, fill_rings=(0, len(cp) - 1), smooth=40)
    prof = [(r * 0.92, S + z) for r, z in PENDANT_PROF]
    drop = C.lathe("PendantDrop", prof, 30, w, cap_bottom=False, smooth_angle=50)
    _uv_vertical(drop, sz)
    parts = [cap, drop]
    rfun = lambda zz: _drop_r(prof, zz)
    for i in range(8):
        parts.append(_leaf(f"PendantLeaf{i}", rfun, math.radians(22.5 + 45 * i), S - 0.066, 0.205, 0.058, 1.0, w,
                           roll=2.1, sign=-1, curl_len=0.66))
    return C.join(parts, "Architecture_Gallery_Pendant")


def _drop_r(prof, z):
    zs = sorted(prof, key=lambda p: p[1])
    if z <= zs[0][1]:
        return zs[0][0]
    for (r0, z0), (r1, z1) in zip(zs, zs[1:]):
        if z <= z1:
            return r0 + (r1 - r0) * (z - z0) / max(1e-6, z1 - z0)
    return zs[-1][0]


def _arch(sa, sb):
    """Segmental arch over the clear span sa..sb: rise = RISE_RATIO x span (clamped so the
    archivolt stays EXTRADOS_CLEAR below the fascia). Returns radius, centre, angles, crown."""
    h = (sb - sa) / 2
    rise = min(RISE_RATIO * (sb - sa), FB - EXTRADOS_CLEAR - RING - SPRING)
    crown = SPRING + rise
    r = (h * h + rise * rise) / (2 * rise)
    cx, cz = (sa + sb) / 2, crown - r
    a0 = math.asin(min(1.0, h / r))
    n = max(12, int(math.ceil(2 * a0 * r / 0.11)))
    th = [-a0 + 2 * a0 * i / n for i in range(n + 1)]
    return r, cx, cz, th, crown


def _bay(seg, sa, sb, name, w):
    r, cx, cz, th, crown = _arch(sa, sb)
    arc = [(cx + r * math.sin(t), cz + r * math.cos(t)) for t in th]
    arc[0], arc[-1] = (sa, SPRING), (sb, SPRING)
    parts = []
    # spandrel + arch ring as one solid (front, back, intrados)
    verts, faces = [], []
    for s_, z_ in arc:
        verts += [seg.p(s_, SP_T, z_), seg.p(s_, SP_T, FB), seg.p(s_, -SP_T, z_), seg.p(s_, -SP_T, FB)]
    for i in range(len(arc) - 1):
        a, b = 4 * i, 4 * (i + 1)
        _face(faces, verts, (a, a + 1, b + 1, b), seg.n3)
        _face(faces, verts, (a + 2, a + 3, b + 3, b + 2), -seg.n3)
        smid = (arc[i][0] + arc[i + 1][0]) / 2
        zmid = (arc[i][1] + arc[i + 1][1]) / 2
        inward = seg.t3 * (cx - smid) + Vector((0, 0, cz - zmid))
        _face(faces, verts, (a, b, b + 2, a + 2), inward)
    sp = _mesh(name + "_Spandrel", verts, faces, None, w, recalc=False, smooth=30)
    _uv(sp, "walnut", seg.axis)
    parts.append(sp)
    # archivolt mouldings, both faces
    for sign, tag in ((1, "F"), (-1, "B")):
        frames = []
        for (s_, z_), t in zip(arc, th):
            radial = seg.t3 * math.sin(t) + Vector((0, 0, math.cos(t)))
            frames.append((seg.p(s_, sign * SP_T, z_), radial, seg.n3 * sign))
        parts.append(_frame_sweep(f"{name}_Archivolt{tag}", frames, ARCHIVOLT, w, size=tex("walnut"), smooth=50))
    # keystone (tapered, slightly proud), with a small patera
    kb, kt, ko, zb = 0.062, 0.095, 0.168, crown - 0.04
    kv = []
    for z_, hw_ in ((zb, kb), (FB, kt)):
        for o in (ko, -ko):
            for ss in (-hw_, hw_):
                kv.append(seg.p(cx + ss, o, z_))
    kf = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    key = _mesh(name + "_Keystone", kv, kf, None, w, recalc=True, smooth=None)
    C.bevel(key, 0.006, 2)
    _uv(key, "walnut", "z")
    parts.append(key)
    for sign in (1, -1):
        ros = _rosette(f"{name}_KeyRosette{sign}", 0.040, 0.015, 6, 12, w, rings=5)
        _place(ros, seg.p(cx, sign * ko, (zb + FB) / 2 + 0.01), seg.n3 * sign)
        parts.append(ros)
    # beaded spandrel panels + rosettes (left and right halves, both faces)
    d = 0.045
    rext = r + RING + 0.002

    def ze(s_):
        q = rext * rext - (s_ - cx) ** 2
        return cz + math.sqrt(q) if q > 0 else SPRING

    top = FB - d
    for half in (0, 1):
        if half == 0:
            s_lo = sa + d
            s_hi = cx - kt - d
        else:
            s_lo = cx + kt + d
            s_hi = sb - d
        steps = 40
        ss = [s_lo + (s_hi - s_lo) * i / steps for i in range(steps + 1)]
        ok = [x for x in ss if top - (ze(x) + d) >= 0.10]
        if len(ok) < 3:
            continue
        lo_, hi_ = ok[0], ok[-1]
        if hi_ - lo_ < 0.18:
            continue
        nseg = max(4, int((hi_ - lo_) / 0.12))
        curve = [(lo_ + (hi_ - lo_) * i / nseg) for i in range(nseg + 1)]
        for sign, tag in ((1, "F"), (-1, "B")):
            o = sign * SP_T
            pts = [seg.p(lo_, o, top), seg.p(hi_, o, top)]
            pts += [seg.p(x, o, ze(x) + d) for x in reversed(curve)]
            parts.append(_frame_sweep(f"{name}_SpBead{half}{tag}", _vframes(pts, seg.n3 * sign, closed=True), BEAD, w,
                                      closed_path=True, cap=False, size=tex("walnut"), smooth=60))
            tall = lo_ if half == 0 else hi_
            far = 1 if half == 0 else -1
            rr = 0.085
            for _ in range(6):
                sc = tall + far * (rr + 0.05)
                avail = top - (ze(sc) + d)
                rr2 = min(0.085, avail / 2 - 0.035)
                if abs(rr2 - rr) < 1e-3:
                    break
                rr = max(0.04, rr2)
            sc = tall + far * (rr + 0.05)
            zc = (top + ze(sc) + d) / 2
            ros = _rosette(f"{name}_SpRosette{half}{tag}", rr, rr * 0.36, 8, 24, w, rings=5)
            _place(ros, seg.p(sc, o, zc), seg.n3 * sign)
            parts.append(ros)
    return parts


CONSOLE_O = (-0.235, 0.330)
CONSOLE_H, CONSOLE_D = 0.585, 0.324   # the wall console's drawn height / projection


def _console(seg, base, dirn, name, w, zt=GY, zb=4.015, o_range=CONSOLE_O, depth=CONSOLE_D):
    """Scroll console with its back on a vertical plane (s = base along the run), projecting along
    dirn x seg.t: a convex upper scroll, concave neck and a small lower curl, with a carved ribbon
    rolled into volutes on its outer face (o_range[1]). Drawn for 0.585 x 0.324 and scaled to
    zt - zb high and `depth` deep."""
    ky, kd = (zt - zb) / CONSOLE_H, depth / CONSOLE_D

    def q(d, h):
        return d * kd, zt - h * ky

    out = [q(0.0, 0.0), q(0.312, 0.0), q(0.322, 0.007), q(0.324, 0.022), q(0.316, 0.031), q(0.302, 0.036)]
    out += [q(d, h) for d, h in _bezier((0.300, 0.040), (0.322, 0.150), (0.205, 0.235), (0.160, 0.295), 10)[1:]]
    out += [q(d, h) for d, h in _bezier((0.160, 0.295), (0.118, 0.355), (0.096, 0.430), (0.106, 0.512), 8)[1:]]
    out += [q(0.110, 0.540), q(0.104, 0.562), q(0.088, 0.578), q(0.064, 0.585), q(0.040, 0.585), q(0.0, 0.585)]
    o0, o1 = o_range
    verts, faces = [], []
    m = len(out)
    for d, z in out:
        verts.append(seg.p(base + dirn * d, o0, z))
        verts.append(seg.p(base + dirn * d, o1, z))
    for i in range(m):
        j = (i + 1) % m
        faces.append((2 * i, 2 * j, 2 * j + 1, 2 * i + 1))
    faces.append(tuple(2 * i for i in range(m)))
    faces.append(tuple(2 * i + 1 for i in reversed(range(m))))
    body = _mesh(name, verts, faces, None, w, recalc=True, smooth=None)
    C.bevel(body, 0.005, 2, 35)
    _uv(body, "walnut", "z")
    parts = [body]
    top_c, bot_c = (0.205, 0.125), (0.066, 0.528)
    top = _spiral_path(top_c, 0.012, 0.088, math.radians(300), math.radians(-160), 30)
    spine = _bezier((0.205 - 0.088 * math.cos(math.radians(20)), 0.155), (0.150, 0.300),
                    (0.075, 0.390), (0.066 - 0.040, 0.528), 9)[1:]
    bot = _spiral_path(bot_c, 0.040, 0.010, math.radians(-180), math.radians(400), 24)[1:]
    pts2 = [q(d, h) for d, h in top + spine + bot]
    pts3 = [seg.p(base + dirn * d, o1, z) for d, z in pts2]
    prof = [(u, v + 0.009) for u, v in _rounded_rect(0.008, 0.011, 0.0035, 2)]
    nrm = seg.n3 if o1 > 0 else -seg.n3
    parts.append(_frame_sweep(f"{name}_Volute", _vframes(pts3, nrm), prof, w, size=tex("walnut"), smooth=50))
    for (dc, hc), rr in ((top_c, 0.020), (bot_c, 0.012)):
        d_, z_ = q(dc, hc)
        eye = C.sphere(f"{name}_Eye", rr * min(kd, ky), seg.p(base + dirn * d_, o1 + 0.006, z_), w, 14, 8)
        C.uv_box(eye, tex("walnut"))
        parts.append(eye)
    return parts


WALL_COVE = [(-0.012, 0.0), (0.072, 0.0), (0.072, -0.008), (0.064, -0.012), (0.050, -0.018), (0.036, -0.027),
             (0.024, -0.040), (0.015, -0.054), (0.010, -0.064), (0.0, -0.070), (-0.012, -0.070)]


def _wall_cove(name, pts, side, w):
    """Small cove moulding where the coffered soffit meets the walls (above the 4.0 m bookcases)."""
    prof = [(o, RIB_Z + z) for o, z in WALL_COVE]
    return _frame_sweep(name, _hframes(pts, side=side), prof, w, size=tex("walnut"), smooth=40)


def _build_arcade(lay, col):
    w = mat("walnut")
    pend = _shared("pendant", _pendant_mesh)
    out = []
    done = set()
    npend = 0
    for seg in lay["segs"]:
        parts = []
        for s_, kind in seg.supports:
            key = tuple(round(v, 3) for v in seg.p2(s_))
            if key in done:
                continue
            done.add(key)
            nm = f"Architecture_Gallery_Arcade_{seg.name}_Dosseret_{len(done):02d}"
            cf = None
            if kind == "corner":
                other = -seg.t3 if s_ > seg.L / 2 else seg.t3
                cf = [(seg.n3, seg.t3), (other, seg.n3)]
            parts += _dosseret(seg, s_, kind, nm, w, corner_faces=cf)
            if kind == "pendant":
                npend += 1
                p = seg.p(s_)
                out.append(_inst(pend, f"Architecture_Gallery_Pendant_{npend:02d}", (p.x, p.y, 0.0),
                                 math.atan2(seg.t.y, seg.t.x), col))
        for (s1, k1), (s2, k2) in zip(seg.supports, seg.supports[1:]):
            parts += _bay(seg, s1 + _hw(k1), s2 - _hw(k2), f"Architecture_Gallery_Arcade_{seg.name}_Bay{s1:05.2f}", w)
        for p_ in parts:
            if p_.data.uv_layers and any(abs(l.uv[0]) > 1e-6 for l in p_.data.uv_layers[0].data[:8]):
                continue
            _uv(p_, "walnut", seg.axis)
        ob = C.join(parts, f"Architecture_Gallery_Arcade_{seg.name}")
        C.move_to(ob, col)
        out.append(ob)
    return out


# ---------------------------------------------------------------------------
# Fascia, frieze, dentils, LED
# ---------------------------------------------------------------------------

FRIEZE_PROF = [(FRIEZE_O - 0.003, FRIEZE_Z0)] + [
    (FRIEZE_O + 0.013 * math.sin(math.pi * i / 10) ** 0.8, FRIEZE_Z0 + (FRIEZE_Z1 - FRIEZE_Z0) * i / 10) for i in range(11)
] + [(FRIEZE_O - 0.003, FRIEZE_Z1)]
BLOCK_HW = 0.20
BLOCK_PROF = [(FRIEZE_O - 0.004, FRIEZE_Z0 + 0.006), (FRIEZE_O + 0.026, FRIEZE_Z0 + 0.006),
              (FRIEZE_O + 0.026, FRIEZE_Z1 - 0.006), (FRIEZE_O - 0.004, FRIEZE_Z1 - 0.006)]


def _frieze_strip(seg, s0, s1, name, side):
    om = mat("ornament_band")
    fr = _hframes([seg.p2(s0), seg.p2(s1)], side=side)
    ob = _frame_sweep(name, fr, FRIEZE_PROF, om, size=1.0, smooth=50)
    period = (s1 - s0) / max(1, round((s1 - s0) / ORN_PERIOD))
    uv = _uvdata(ob.data)
    me = ob.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            s_ = (Vector((co.x, co.y)) - seg.a).dot(seg.t)
            uv[li].uv = ((s1 - s_) / period, min(1.0, max(0.0, (co.z - FRIEZE_Z0) / (FRIEZE_Z1 - FRIEZE_Z0))))
    return ob


def _block_rosette(name, loc, nrm):
    ros = _rosette(name, 0.078, 0.026, 8, 20, mat("walnut"), rings=5)
    return _place(ros, loc, nrm)


def _build_frieze(segs, side, name, col, free_ends=False):
    """Pulvinated ornament_band frieze in panels between walnut rosette blocks over each support."""
    w = mat("walnut")
    parts = []
    done = set()
    zc = (FRIEZE_Z0 + FRIEZE_Z1) / 2
    for si, seg in enumerate(segs):
        blocks = []
        for s_, kind in seg.supports:
            if kind == "corner":
                if s_ > seg.L / 2:
                    blocks.append((seg.L - BLOCK_HW, seg.L + 1.0))
                else:
                    blocks.append((-1.0, BLOCK_HW))
            else:
                blocks.append((s_ - BLOCK_HW, s_ + BLOCK_HW))
        if free_ends:
            blocks += [(-1.0, 0.30), (seg.L - 0.30, seg.L + 1.0)]
        blocks.sort()
        start = -EMBED if seg.wall_a else 0.0
        end = seg.L + EMBED if seg.wall_b else seg.L
        cur = start
        for b0, b1 in blocks + [(end, end + 1)]:
            if b0 - cur > 0.05:
                parts.append(_frieze_strip(seg, cur, b0, f"{name}_Panel{len(parts):02d}", side))
            cur = max(cur, b1)
        for s_, kind in seg.supports + ([(0.15, "end"), (seg.L - 0.15, "end")] if free_ends else []):
            if kind == "corner":
                key = tuple(round(v, 3) for v in seg.p2(s_))
                if key in done:
                    continue
                done.add(key)
                nxt = segs[si + 1]
                path = [seg.p2(seg.L - BLOCK_HW), seg.p2(seg.L), nxt.p2(BLOCK_HW)]
                blk = _frame_sweep(f"{name}_CornerBlock{len(parts)}", _hframes(path, side=side), BLOCK_PROF, w,
                                   size=tex("walnut"), smooth=None)
                C.bevel(blk, 0.004, 2)
                _clean(blk)
                parts.append(blk)
                o = BLOCK_PROF[1][0]
                parts.append(_block_rosette(f"{name}_Rosette{len(parts)}", seg.p(seg.L - 0.015, o, zc), seg.n3))
                parts.append(_block_rosette(f"{name}_Rosette{len(parts)}", nxt.p(0.015, o, zc), nxt.n3))
            else:
                hw_ = BLOCK_HW if kind != "end" else 0.15
                lo = seg.p(s_ - hw_, BLOCK_PROF[0][0], BLOCK_PROF[0][1])
                hi = seg.p(s_ + hw_, BLOCK_PROF[1][0], BLOCK_PROF[2][1])
                blk = C.box_minmax(f"{name}_Block{len(parts)}", Vector(map(min, lo, hi)), Vector(map(max, lo, hi)), w, bevel_w=0.004)
                parts.append(blk)
                parts.append(_block_rosette(f"{name}_Rosette{len(parts)}", seg.p(s_, BLOCK_PROF[1][0], zc), seg.n3))
    for p_ in parts:
        if p_.data.materials and p_.data.materials[0] == w:
            _uv(p_, "walnut", segs[0].axis if len(segs) == 1 else None)
    ob = C.join(parts, name)
    C.move_to(ob, col)
    return ob


def _dentil_mesh(name, placements):
    """Dentil blocks: placements = [(centre, tvec, nvec, half_width)] (centre at the course's
    mid-depth and mid-height; the back face is buried in the fascia)."""
    hd, hz = (DENTIL_O1 - DENTIL_O0) / 2, (DENTIL_Z1 - DENTIL_Z0) / 2
    verts, faces = [], []
    for center, tvec, nvec, hw in placements:
        base = len(verts)
        for i in (-1, 1):
            for j in (-1, 1):
                for k in (-1, 1):
                    verts.append(center + tvec * (i * hw) + nvec * (j * hd) + Vector((0, 0, k * hz)))
        I = lambda i, j, k: base + ((i > 0) * 4 + (j > 0) * 2 + (k > 0))
        _face(faces, verts, (I(-1, 1, -1), I(1, 1, -1), I(1, 1, 1), I(-1, 1, 1)), nvec)
        _face(faces, verts, (I(-1, -1, -1), I(-1, 1, -1), I(-1, 1, 1), I(-1, -1, 1)), -tvec)
        _face(faces, verts, (I(1, -1, -1), I(1, -1, 1), I(1, 1, 1), I(1, 1, -1)), tvec)
        _face(faces, verts, (I(-1, -1, 1), I(-1, 1, 1), I(1, 1, 1), I(1, -1, 1)), Vector((0, 0, 1)))
        _face(faces, verts, (I(-1, -1, -1), I(1, -1, -1), I(1, 1, -1), I(-1, 1, -1)), Vector((0, 0, -1)))
    ob = _mesh(name, verts, faces, None, mat("walnut"), recalc=False, smooth=None)
    _uv(ob, "walnut", None)
    return ob


def _build_dentils(segs, side, name, col, free_ends=False):
    oc = (DENTIL_O0 + DENTIL_O1) / 2
    zc = (DENTIL_Z0 + DENTIL_Z1) / 2
    hd = (DENTIL_O1 - DENTIL_O0) / 2
    pl = []
    for si, seg in enumerate(segs):
        a0 = -oc if seg.corner_a else (0.035 if (seg.wall_a or free_ends) else 0.0)
        a1 = seg.L + oc if seg.corner_b else seg.L - (0.035 if (seg.wall_b or free_ends) else 0.0)
        n = max(1, round((a1 - a0) / DENTIL_PITCH))
        pitch = (a1 - a0) / n
        if seg.corner_b and not seg.corner_a:
            pos = [a1 - k * DENTIL_PITCH for k in range(1, 100000) if a1 - k * DENTIL_PITCH >= a0 + DENTIL_W / 2]
        else:
            pos = [a0 + k * pitch for k in range(1, n)]
            if not seg.corner_a:
                pos = [a0] + pos
            if not seg.corner_b:
                pos = pos + [a1]
        for s_ in pos:
            pl.append((seg.p(s_, oc, zc), seg.t3, seg.n3, DENTIL_W / 2))
        if seg.corner_b:
            nxt = segs[si + 1]
            c = seg.p(seg.L, 0, zc) + seg.n3 * oc + nxt.n3 * oc
            pl.append((c, seg.t3, seg.n3, hd))
    ob = _dentil_mesh(name, pl)
    C.move_to(ob, col)
    return ob


def _led(name, pts, side, col):
    hz0, hz1 = FB + 0.006, FB + 0.036
    housing = [(BACK_O + 0.002, hz0), (BACK_O - 0.024, hz0), (BACK_O - 0.024, hz1), (BACK_O + 0.002, hz1)]
    hs = _frame_sweep(name + "_LEDHousing", _hframes(pts, side=side), housing, mat("walnut"), size=tex("walnut"), smooth=None)
    led_prof = [(BACK_O - 0.0235, hz0 + 0.004), (BACK_O - 0.0270, hz0 + 0.004), (BACK_O - 0.0270, hz1 - 0.004),
                (BACK_O - 0.0235, hz1 - 0.004)]
    led = _frame_sweep(name.replace("Fascia", "LED"), _hframes(pts, side=side), led_prof, mat("led_strip"), size=1.0, smooth=None)
    C.move_to(led, col)
    return hs, led


def _build_fascia(path, segs, side, name, col, free_ends=False):
    w = mat("walnut")
    pts = _ext_path(path, segs)
    fas = _frame_sweep(name, _hframes(pts, side=side), FASCIA, w, size=tex("walnut"), smooth=38)
    hs, led = _led(name, pts, side, col)
    dent = _build_dentils(segs, side, name + "_Dentils", col, free_ends)
    ob = C.join([fas, hs, dent], name)
    C.move_to(ob, col)
    return ob, led


# ---------------------------------------------------------------------------
# Floor, skirting and coffered soffit
# ---------------------------------------------------------------------------

POCKET = [(0.0, 0.0), (0.0, 0.010), (0.010, 0.016), (0.017, 0.028), (0.026, 0.045), (0.040, 0.056),
          (0.050, 0.058), (0.056, 0.100)]
RIB_W = 0.14


def _intervals(b, e0, e1, w=RIB_W):
    cells = []
    for i in range(len(b) - 1):
        lo = b[i] + (e0 if i == 0 else w / 2)
        hi = b[i + 1] - (e1 if i == len(b) - 2 else w / 2)
        cells.append((lo, hi))
    iv, prev = [], b[0]
    for lo, hi in cells:
        if lo > prev + 1e-6:
            iv.append((prev, lo, False))
        iv.append((lo, hi, True))
        prev = hi
    if b[-1] > prev + 1e-6:
        iv.append((prev, b[-1], False))
    return iv


def _soffit(name, xs, ys, ex, ey, axis):
    """Coffered walnut soffit over an axis-aligned rect: ribs at RIB_Z, moulded pockets up to CEIL_Z,
    each with a fielded panel. xs/ys are cell boundaries; ex/ey the edge rib widths (lo, hi)."""
    verts, faces, fm = [], [], []
    down = Vector((0, 0, -1))
    parts = []

    def quad(x0, y0, x1, y1, z, mi):
        b = len(verts)
        verts.extend([Vector((x0, y0, z)), Vector((x1, y0, z)), Vector((x1, y1, z)), Vector((x0, y1, z))])
        _face(faces, verts, (b, b + 1, b + 2, b + 3), down)
        fm.append(mi)

    pocket = [(o, RIB_Z + z) for o, z in POCKET]
    for x0, x1, cx_ in _intervals(xs, *ex):
        for y0, y1, cy_ in _intervals(ys, *ey):
            if not (cx_ and cy_):
                quad(x0, y0, x1, y1, RIB_Z, 0)
                continue
            ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
            pk = _frame_sweep(f"{name}_Pocket", _hframes(ring, closed=True, side=1.0), pocket, mat("walnut"),
                              closed_profile=False, closed_path=True, cap=False, size=tex("walnut"), smooth=40, recalc=False)
            me = pk.data
            ctr = Vector(((x0 + x1) / 2, (y0 + y1) / 2, RIB_Z))
            for poly in me.polygons:
                want = (ctr - poly.center)
                want.z = -0.25 * want.length
                if poly.normal.dot(want) < 0:
                    poly.flip()
            parts.append(pk)
            i = POCKET[-1][0]
            a, b_ = 0.11, 0.175
            zf = CEIL_Z - 0.016
            base = len(verts)
            rim = [(x0 + i, y0 + i), (x1 - i, y0 + i), (x1 - i, y1 - i), (x0 + i, y1 - i)]
            outer = [(x0 + a, y0 + a), (x1 - a, y0 + a), (x1 - a, y1 - a), (x0 + a, y1 - a)]
            inner = [(x0 + b_, y0 + b_), (x1 - b_, y0 + b_), (x1 - b_, y1 - b_), (x0 + b_, y1 - b_)]
            verts.extend([Vector((x, y, CEIL_Z)) for x, y in rim] + [Vector((x, y, CEIL_Z)) for x, y in outer]
                         + [Vector((x, y, zf)) for x, y in inner])
            for k in range(4):
                k2 = (k + 1) % 4
                _face(faces, verts, (base + k, base + k2, base + 4 + k2, base + 4 + k), down)
                fm.append(1)
                _face(faces, verts, (base + 4 + k, base + 4 + k2, base + 8 + k2, base + 8 + k), down)
                fm.append(0)
            _face(faces, verts, (base + 8, base + 9, base + 10, base + 11), down)
            fm.append(0)
    flat = _mesh(name + "_Ribs", verts, faces, None, [mat("walnut"), mat("walnut_dark")], fm, recalc=False, smooth=None)
    parts.append(flat)
    for p_ in parts:
        _uv(p_, "walnut", axis)
    return parts


def _plain_soffit(name, x0, y0, x1, y1, axis="x"):
    verts = [Vector((x0, y0, RIB_Z)), Vector((x1, y0, RIB_Z)), Vector((x1, y1, RIB_Z)), Vector((x0, y1, RIB_Z))]
    faces = []
    _face(faces, verts, (0, 1, 2, 3), Vector((0, 0, -1)))
    ob = _mesh(name, verts, faces, None, mat("walnut"), recalc=False, smooth=None)
    _uv(ob, "walnut", axis)
    return [ob]


def _floor(name, rects, headers=()):
    """Oak boards (rects [(x0, y0, x1, y1, grain_axis)]) at the gallery floor height (plus optional
    walnut inlay rects, same form)."""
    verts, faces, uvs, fm = [], [], [], []
    for mi, items, size in ((0, rects, tex("oak_boards")), (1, headers, tex("walnut"))):
        for x0, y0, x1, y1, axis in items:
            b = len(verts)
            verts.extend([Vector((x0, y0, GY)), Vector((x1, y0, GY)), Vector((x1, y1, GY)), Vector((x0, y1, GY))])
            _face(faces, verts, (b, b + 1, b + 2, b + 3), Vector((0, 0, 1)))
            f = faces[-1]
            uvs.append(tuple(((verts[i].x / size, verts[i].y / size) if axis == "x" else (verts[i].y / size, verts[i].x / size)) for i in f))
            fm.append(mi)
    return _mesh(name, verts, faces, uvs, [mat("oak_boards"), mat("walnut")], fm, recalc=False, smooth=None)


def _header_strip(name, x0, y0, x1, y1, axis):
    """A honey-oak header board laid across the board ends: a bevelled slab 2 mm proud of the floor,
    grain along its length."""
    ob = C.box_minmax(name, (x0, y0, GY - 0.012), (x1, y1, GY + 0.002), mat("oak"), bevel_w=0.002, segments=2)
    _uv(ob, "oak", axis)
    return ob


def _skirting(name, pts, z, w):
    """Moulded walnut skirting along a wall polyline, room on the path's right."""
    prof = [(o, z + v) for o, v in SKIRTING]
    ob = _frame_sweep(name, _hframes(pts, side=-1.0), prof, w, size=tex("walnut"), smooth=40)
    return ob


# ---------------------------------------------------------------------------
# Railing: walnut curb + ogee handrail, iron rails, balusters, posts, brackets, panels
# ---------------------------------------------------------------------------

CURB = [(-0.065, 0.0), (0.065, 0.0), (0.065, 0.040), (0.062, 0.050), (0.055, 0.058), (0.044, 0.063),
        (0.032, 0.065), (-0.032, 0.065), (-0.044, 0.063), (-0.055, 0.058), (-0.062, 0.050), (-0.065, 0.040)]
BRAIL = [(-0.019, 0.062), (0.019, 0.062), (0.019, 0.080), (0.015, 0.086), (0.008, 0.088), (-0.008, 0.088),
         (-0.015, 0.086), (-0.019, 0.080)]

# flat bar (u = in the panel plane, v = depth), 1.2 mm corner radius
BAR_U, BAR_V = 0.0045, 0.0075
_SHARED = {}
_PANEL_DEBUG = []


def _seg_dist(p, q, a, b):
    """Minimum distance between 2D segments pq and ab."""
    def pt_seg(x, u, v):
        d = v - u
        t = max(0.0, min(1.0, (x - u).dot(d) / max(d.length_squared, 1e-12)))
        return (x - (u + d * t)).length
    return min(pt_seg(p, a, b), pt_seg(q, a, b), pt_seg(a, p, q), pt_seg(b, p, q))


def panel_clearances():
    """Smallest centreline distance between each pair of the panel's scrolls / diagonals (bar
    faces touch at 2 x 4.5 mm; anything well under that away from a collar is a clash)."""
    out = []
    items = _PANEL_DEBUG
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            (na, pa), (nb, pb) = items[i], items[j]
            dmin = min(_seg_dist(pa[k], pa[k + 1], pb[m], pb[m + 1]) for k in range(len(pa) - 1) for m in range(len(pb) - 1))
            out.append((na, nb, dmin))
    return out


def _bar(hu=BAR_U, hv=BAR_V):
    return _rounded_rect(hu, hv, 0.0012, 1)


def _shared(key, fn):
    """A mesh built once by fn() (which returns an object) and reused by every instance; the
    builder object itself is removed so only the linked duplicates remain in the scene."""
    me = _SHARED.get(key)
    if me is None or me.name not in bpy.data.meshes:
        ob = fn()
        _uvdata(ob.data)
        me = ob.data
        me.name = ob.name
        bpy.data.objects.remove(ob, do_unlink=True)
        _SHARED[key] = me
    return me


def _inst(me, name, loc, rot_z, col):
    ob = bpy.data.objects.new(name, me)
    ob.location = Vector(loc)
    ob.rotation_euler = (0, 0, rot_z)
    col.objects.link(ob)
    return ob


def _baluster_mesh(height=RH):
    """Turned wrought-iron baluster (12 sides): filleted collars at both ends and below the urn,
    a slender shaft, a swelling urn and a necking collar. One shared mesh, instanced."""
    z0, z1 = BRAIL_TOP - 0.003, (height - 0.075) + 0.003
    L = z1 - z0
    r = 0.0068
    prof = [(0.0112, 0.000), (0.0118, 0.004), (0.0118, 0.010), (0.0106, 0.0145), (0.0080, 0.0180), (r, 0.026),
            (r, 0.286 * L), (0.0080, 0.293 * L), (0.0112, 0.298 * L), (0.0112, 0.310 * L), (0.0080, 0.315 * L),
            (0.0071, 0.322 * L),
            (0.0094, 0.345 * L), (0.0124, 0.372 * L), (0.0148, 0.400 * L), (0.0160, 0.428 * L), (0.0158, 0.450 * L),
            (0.0143, 0.470 * L), (0.0118, 0.487 * L), (0.0089, 0.500 * L), (0.0072, 0.509 * L),
            (0.0098, 0.517 * L), (0.0098, 0.527 * L), (0.0074, 0.533 * L),
            (r, 0.545 * L),
            (r, L - 0.026), (0.0080, L - 0.018), (0.0106, L - 0.0145), (0.0118, L - 0.010), (0.0118, L - 0.004),
            (0.0112, L)]
    ob = C.lathe("Architecture_Gallery_Baluster", [(rr, z0 + z) for rr, z in prof], 12, mat("iron"),
                 cap_top=False, cap_bottom=False, smooth_angle=62)
    _uv_vertical(ob, 0.3)
    return ob


def _sq_lathe(name, prof, mat_):
    """Square-section 'turned' part: a 4-sided lathe (half-widths), axis-aligned."""
    return C.lathe(name, [(hw * math.sqrt(2), z) for hw, z in prof], 4, mat_, rot=C.rotz(45), smooth_angle=30)


def _post_mesh(height=RH):
    iron, brass = mat("iron"), mat("brass_aged")
    cz0, cz1 = height - 0.075, height - 0.055
    parts = [
        C.box("PostShoe", (0.074, 0.074, 0.044), (0, 0, 0.080), iron, bevel_w=0.004),
        C.box("PostShaft", (0.050, 0.050, cz1 - 0.10), (0, 0, (0.10 + cz1) / 2), iron, bevel_w=0.004),
        C.box("PostCollarA", (0.062, 0.062, 0.022), (0, 0, 0.300), iron, bevel_w=0.003),
        C.box("PostCollarB", (0.062, 0.062, 0.022), (0, 0, 0.700), iron, bevel_w=0.003),
        _sq_lathe("PostUrn", [(0.025, 0.40), (0.031, 0.41), (0.036, 0.44), (0.038, 0.48), (0.036, 0.52),
                              (0.031, 0.555), (0.026, 0.57), (0.029, 0.578), (0.029, 0.59), (0.025, 0.60)], iron),
        C.box("PostCap", (0.092, 0.092, 0.110), (0, 0, cz0 - 0.012 + 0.055), iron, bevel_w=0.006),
        _sq_lathe("PostCapTop", [(0.049, cz0 + 0.098), (0.051, cz0 + 0.104), (0.046, cz0 + 0.110), (0.036, cz0 + 0.118),
                                 (0.026, cz0 + 0.124), (0.020, cz0 + 0.128)], iron),
    ]
    zf = cz0 + 0.126
    fin = [(0.019, 0.0), (0.024, 0.004), (0.024, 0.009), (0.019, 0.015), (0.014, 0.022), (0.012, 0.028),
           (0.014, 0.033), (0.018, 0.038), (0.026, 0.048), (0.031, 0.057), (0.0340, 0.067), (0.0350, 0.080),
           (0.0335, 0.091), (0.029, 0.101), (0.022, 0.110), (0.015, 0.117), (0.010, 0.122), (0.007, 0.126),
           (0.0085, 0.131), (0.0085, 0.135), (0.0065, 0.139), (0.004, 0.144), (0.0015, 0.148), (0.0, 0.150)]
    parts.append(C.lathe("PostFinial", [(r, zf + z) for r, z in fin], 24, brass, smooth_angle=55))
    for p_ in parts:
        C.uv_box(p_, 0.3, "z")
    return C.join(parts, "Architecture_Gallery_RailPost")


# ---- wrought-iron scrollwork --------------------------------------------------------------

def _scroll_unit(mid, curl, e, max_turn=14.0, steps=4000):
    """A C-scroll from integrated curvature: a body arc whose two ends roll inward into tight
    volutes. Adaptively sampled (<= max_turn degrees and <= 1/40 of the length per segment).
    Returned with the back of the C at +x, opening toward -x, height 1, min corner at the origin."""
    kap = lambda u: mid + curl * (max(0.0, e - u) / e) ** 2 + curl * (max(0.0, u - (1 - e)) / e) ** 2
    pts, turn = [Vector((0.0, 0.0))], [0.0]
    phi, ds = 0.0, 1.0 / steps
    for i in range(steps):
        phi += kap((i + 0.5) / steps) * ds
        pts.append(pts[-1] + Vector((math.cos(phi), math.sin(phi))) * ds)
        turn.append(phi)
    keep = [0]
    for i in range(1, steps):
        if turn[i] - turn[keep[-1]] >= math.radians(max_turn) or (i - keep[-1]) * ds >= 1 / 40:
            keep.append(i)
    keep.append(steps)
    m = pts[steps // 2]
    ex = (pts[0] + pts[-1]) / 2
    d = m - ex
    a = -math.atan2(d.y, d.x)
    c, s = math.cos(a), math.sin(a)
    out = [Vector((p.x * c - p.y * s, p.x * s + p.y * c)) for p in (pts[i] for i in keep)]
    x0, y0 = min(p.x for p in out), min(p.y for p in out)
    h = max(p.y for p in out) - y0
    return [Vector(((p.x - x0) / h, (p.y - y0) / h)) for p in out]


SCROLL_TALL = (5.0, 70.0, 0.28)    # w/h ~0.62 : standing scrolls and brackets
SCROLL_WIDE = (6.0, 60.0, 0.25)    # w/h ~0.78 : lying scrolls


def _fit_scroll(unit, back, open_, span_c, vertical=True):
    """Maps a unit C (back +x) into the panel's XZ plane. vertical: back at x = back, curl edges at
    x = open_, centred on z = span_c. Otherwise lying: back at z = back, curl edges at z = open_,
    centred on x = span_c. Returns the 2D path (x, z), scale."""
    depth = abs(back - open_)
    s = depth / max(p.x for p in unit)
    sgn = 1.0 if back > open_ else -1.0
    out = []
    for p in unit:
        a = open_ + sgn * p.x * s
        b = span_c + (p.y - 0.5) * s
        out.append(Vector((a, b)) if vertical else Vector((b, a)))
    return out, s


def _flat_sweep(name, pts2, mat_, closed=False, prof=None, scales=None):
    """Flat bar along a path in the XZ plane (pts2 = [(x, z)])."""
    p3 = [Vector((p[0], 0.0, p[1])) for p in pts2]
    return _frame_sweep(name, _vframes(p3, (0, -1, 0), closed=closed, scales=scales), prof or _bar(), mat_,
                        closed_path=closed, size=0.3, smooth=50)


def _knob(name, p2, mat_, r=0.0062, d=0.0082):
    """Rolled eye at a scroll's end: a small flattened knob."""
    return C.sphere(name, 1.0, (p2[0], 0.0, p2[1]), mat_, 10, 6, scale=(r, d, r))


def _collar(name, c1, c2, b1, b2, tdir, mat_, length=0.022, depth=BAR_V + 0.0016):
    """Forged band collar wrapping two touching bars (centrelines c1, c2 in XZ, half-thicknesses
    b1, b2 across the joint, tdir their common tangent)."""
    c1, c2 = Vector((c1[0], c1[1])), Vector((c2[0], c2[1]))
    n = (c2 - c1)
    n = n.normalized() if n.length > 1e-6 else Vector((-tdir[1], tdir[0]))
    span = (c2 - c1).length + b1 + b2 + 0.003
    mid = (c1 + c2) / 2 + n * (b2 - b1) / 2
    t = Vector((tdir[0], tdir[1])).normalized()
    v, f = _box_verts(Vector((mid.x, 0.0, mid.y)), Vector((t.x, 0.0, t.y)), Vector((0, 1, 0)), Vector((n.x, 0.0, n.y)),
                      length / 2, depth, span / 2)
    ob = _mesh(name, v, f, None, mat_, recalc=True, smooth=None)
    C.bevel(ob, 0.0011, 1, 30)
    return ob


def _rivet(name, p2, y_sign, mat_, r=0.0048):
    prof = [(r, 0.0), (r * 0.93, 0.0012), (r * 0.70, 0.0026), (r * 0.36, 0.0034), (0.0, 0.0036)]
    ob = C.lathe(name, prof, 10, mat_, cap_bottom=False, smooth_angle=70)
    _place(ob, (p2[0], y_sign * (BAR_V - 0.0005), p2[1]), (0, y_sign, 0))
    C.apply_transform(ob)
    return ob


def _extreme(pts, key, lo_half):
    """Index of the extreme point (by key) in the first or second half of a path."""
    n = len(pts)
    rng = range(0, n // 2) if lo_half else range(n // 2, n)
    return min(rng, key=lambda i: key(pts[i]))


def _bracket_mesh():
    """C-scroll stiffener beside a newel post (local +x away from the post face at x = 0): both
    curls bear on the post through forged lugs, ends rolled into eyes."""
    iron = mat("iron")
    unit = _scroll_unit(*SCROLL_TALL)
    h = 0.27
    w_ = max(p.x for p in unit) * h
    path, s = _fit_scroll(unit, w_ + BAR_U, BAR_U - 0.0004, BRAIL_TOP + 0.004 + h / 2, vertical=True)
    parts = [_flat_sweep("BracketBar", path, iron)]
    parts += [_knob("BracketEye", path[0], iron), _knob("BracketEye", path[-1], iron)]
    for lo in (True, False):
        i = _extreme(path, lambda p: p.x, lo)
        p = path[i]
        lug, f = _box_verts(Vector((0.004, 0.0, p.y)), Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)),
                            0.0065, BAR_V + 0.0012, 0.011)
        ob = _mesh("BracketLug", lug, f, None, iron, recalc=True, smooth=None)
        C.bevel(ob, 0.0011, 1, 30)
        parts.append(ob)
    for p_ in parts:
        C.uv_box(p_, 0.3, "x")
    return C.join(parts, "Architecture_Gallery_RailBracket")


def _panel_mesh(height=RH, width=PANEL_W):
    """Wrought-iron ornamental panel: frame, central ring with an aged-brass boss, diagonal lattice
    riveted to the ring, four C-scrolls (backs collared to the ring, curls collared to the posts
    and bars, ends rolled into eyes) and rows of small rings collared to the inner bars."""
    iron, brass = mat("iron"), mat("brass_aged")
    zb, zt = BRAIL_TOP - 0.003, height - 0.075 + 0.003
    hw = width / 2
    b0, b1 = BRAIL_TOP + 0.10, height - 0.075 - 0.10
    zm = (b0 + b1) / 2
    PU, BZ = 0.007, 0.006                      # frame post / inner bar half-thickness in the plane
    xp = hw - PU                               # post centreline
    parts = []
    for x in (-xp, xp):
        parts.append(C.box("PanelPost", (2 * PU, 0.016, zt - zb), (x, 0, (zb + zt) / 2), iron, bevel_w=0.0015))
    for z in (b0, b1):
        parts.append(C.box("PanelBar", (2 * xp, 0.014, 2 * BZ), (0, 0, z), iron, bevel_w=0.0015))
    R_ = PANEL_RING
    circ = [(R_ * math.cos(math.tau * i / 48), zm + R_ * math.sin(math.tau * i / 48)) for i in range(48)]
    parts.append(_flat_sweep("PanelRing", circ, iron, closed=True))
    for sign in (1, -1):
        boss = _rosette("PanelBoss", 0.040, 0.018, 8, 24, brass, rings=5)
        _place(boss, (0, 0.0, zm), (0, -sign, 0))
        parts.append(boss)
    parts.append(C.cylinder("PanelBossCore", 0.026, 0.026, 0.016, (0, 0, zm), brass, 24, rot=C.rotx(90)))
    # diagonal lattice: field corners -> the ring, riveted at the ring
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        a = Vector((sx * (xp - PU), (b0 + BZ) if sz < 0 else (b1 - BZ)))
        cvec = Vector((0.0, zm))
        dn = (cvec - a).normalized()
        e = cvec - dn * (R_ + BAR_U - 0.001)
        parts.append(_flat_sweep("PanelDiag", [a - dn * 0.002, e], iron))
        for ys in (1, -1):
            parts.append(_rivet("PanelRivet", cvec - dn * R_, ys, iron))
    # four C-scrolls whose backs bear on the ring and whose curls bear on the posts / bars
    tall = _scroll_unit(*SCROLL_TALL)
    wide = _scroll_unit(*SCROLL_WIDE)
    dbg = [("diag", [Vector((sx * (xp - PU), (b0 + BZ) if sz < 0 else (b1 - BZ))),
                     Vector((0.0, zm)) + (Vector((sx * (xp - PU), (b0 + BZ) if sz < 0 else (b1 - BZ))) - Vector((0.0, zm))).normalized() * R_])
           for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    ring_out = R_ + BAR_U + BAR_U
    specs = [
        ("L", tall, -ring_out, -(xp - PU - BAR_U), zm, True, Vector((-xp, 0)), PU),
        ("R", tall, ring_out, xp - PU - BAR_U, zm, True, Vector((xp, 0)), PU),
        ("B", wide, zm - ring_out, b0 + BZ + BAR_U, 0.0, False, Vector((0, b0)), BZ),
        ("T", wide, zm + ring_out, b1 - BZ - BAR_U, 0.0, False, Vector((0, b1)), BZ),
    ]
    for tag, unit, back, open_, ctr, vert, frame_c, frame_b in specs:
        path, s = _fit_scroll(unit, back, open_, ctr, vertical=vert)
        dbg.append((tag, path))
        parts.append(_flat_sweep(f"PanelScroll{tag}", path, iron))
        parts += [_knob("PanelEye", path[0], iron), _knob("PanelEye", path[-1], iron)]
        ax = 0 if vert else 1          # coordinate measured toward the ring / frame
        sgn = 1.0 if back > open_ else -1.0
        # back contact with the ring
        ib = max(range(len(path)), key=lambda i: sgn * path[i][ax])
        pb = path[ib]
        ring_c = Vector((0.0, zm)) + (pb - Vector((0.0, zm))).normalized() * R_
        tan = (0, 1) if vert else (1, 0)
        parts.append(_collar("PanelCollar", pb, ring_c, BAR_U, BAR_U, tan, iron))
        # curl contacts with the frame (post or inner bar)
        for lo in (True, False):
            i = _extreme(path, lambda p: sgn * p[ax], lo)
            p = path[i]
            fc = Vector((frame_c.x, p.y)) if vert else Vector((p.x, frame_c.y))
            parts.append(_collar("PanelCollar", p, fc, BAR_U, frame_b, tan, iron))
    # small rings in the top and bottom bands, collared to the inner bars
    nr = 4
    pitch = (2 * (xp - PU)) / nr
    rb = (BAR_U - 0.001, BAR_V - 0.001)
    for lo_, hi_, bar_z, top in ((BRAIL_TOP, b0 - BZ, b0, True), (b1 + BZ, height - 0.075, b1, False)):
        rr = (hi_ - lo_) / 2 - rb[0] + 0.001
        zc = (lo_ + hi_) / 2
        for i in range(nr):
            x = -(xp - PU) + pitch * (i + 0.5)
            circ = [(x + rr * math.cos(math.tau * j / 18), zc + rr * math.sin(math.tau * j / 18)) for j in range(18)]
            parts.append(_flat_sweep("PanelRinglet", circ, iron, closed=True, prof=_rounded_rect(rb[0], rb[1], 0.001, 1)))
            pc = Vector((x, zc + rr)) if top else Vector((x, zc - rr))
            parts.append(_collar("PanelCollar", pc, Vector((x, bar_z)), rb[0], BZ, (1, 0), iron, length=0.018))
    for p_ in parts:
        C.uv_box(p_, 0.3, "x")
    _PANEL_DEBUG[:] = dbg
    return C.join(parts, "Architecture_Gallery_RailPanel")


def _rails(name, pts, z, height, col):
    w, iron = mat("walnut"), mat("iron")
    fr = _hframes(pts, side=1.0)
    parts = [
        _frame_sweep(name + "_Curb", fr, [(u, z + v) for u, v in CURB], w, size=tex("walnut"), smooth=40),
        _frame_sweep(name + "_BottomRail", fr, [(u, z + v) for u, v in BRAIL], iron, size=0.3, smooth=40),
        _frame_sweep(name + "_CoreRail", fr, [(-0.019, z + height - 0.075), (0.019, z + height - 0.075),
                                              (0.019, z + height - 0.055), (-0.019, z + height - 0.055)], iron, size=0.3, smooth=None),
        _frame_sweep(name + "_Handrail", fr, [(u, z + height - 0.055 + v) for u, v in HANDRAIL], w, size=tex("walnut"), smooth=40),
    ]
    ob = C.join(parts, name)
    C.move_to(ob, col)
    return ob


def _build_railing_path(name, pts, z, height, post_pts, wall_flags, col):
    """Railing along a polyline (Blender 2D) at floor height z. Posts at post_pts (2D, on the path),
    at both ends (pulled back from a wall) and at every corner; panels mid-bay where a bay >= 3 m."""
    pts = [Vector(p) for p in pts]
    rail_pts = list(pts)
    if wall_flags[0]:
        rail_pts[0] = pts[0] - (pts[1] - pts[0]).normalized() * 0.006
    if wall_flags[1]:
        rail_pts[-1] = pts[-1] + (pts[-1] - pts[-2]).normalized() * 0.006
    out = [_rails(name + "_Rails", rail_pts, z, height, col)]
    bal = _shared(("bal", height), lambda: _baluster_mesh(height))
    post = _shared(("post", height), lambda: _post_mesh(height))
    brk = _shared("bracket", _bracket_mesh)
    pnl = _shared(("panel", height), lambda: _panel_mesh(height))
    brk_w = max(v.co.x for v in brk.vertices) - min(v.co.x for v in brk.vertices)
    counts = {"bal": 0, "post": 0, "brk": 0, "pnl": 0}
    placed_posts = set()

    def put_post(p2):
        key = (round(p2.x, 3), round(p2.y, 3))
        if key in placed_posts:
            return
        placed_posts.add(key)
        counts["post"] += 1
        _inst(post, f"{name}_Post_{counts['post']:02d}", (p2.x, p2.y, z), 0.0, col)

    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        L = (b - a).length
        t = (b - a) / L
        rot = math.atan2(t.y, t.x)
        ss = [0.0 if not (i == 0 and wall_flags[0]) else 0.05,
              L if not (i == len(pts) - 2 and wall_flags[1]) else L - 0.05]
        for q in post_pts:
            v = q - a
            sq = v.dot(t)
            if abs(v.dot(Vector((-t.y, t.x)))) < 1e-3 and 0.3 < sq < L - 0.3:
                ss.append(sq)
        ss = sorted(ss)
        for s_ in ss:
            put_post(a + t * s_)
        for s0, s1 in zip(ss, ss[1:]):
            gap = s1 - s0
            use_brk = gap > 0.8
            if use_brk:
                for sp, sign in ((s0, 1), (s1, -1)):
                    counts["brk"] += 1
                    p2 = a + t * (sp + sign * POST_HW)
                    _inst(brk, f"{name}_Bracket_{counts['brk']:03d}", (p2.x, p2.y, z),
                          rot if sign > 0 else rot + math.pi, col)
            e0 = s0 + POST_HW + (brk_w + 0.045 if use_brk else BAL_SP * 0.8)
            e1 = s1 - POST_HW - (brk_w + 0.045 if use_brk else BAL_SP * 0.8)
            free = [(e0, e1)]
            if gap >= 3.0:
                sc = (s0 + s1) / 2
                counts["pnl"] += 1
                p2 = a + t * sc
                _inst(pnl, f"{name}_Panel_{counts['pnl']:02d}", (p2.x, p2.y, z), rot, col)
                edge = PANEL_W / 2 - 0.007 + BAL_SP
                free = [(e0, sc - edge), (sc + edge, e1)]
            for lo, hi in free:
                if hi < lo - 1e-6:
                    continue
                n = int(round((hi - lo) / BAL_SP)) + 1
                for k in range(n):
                    sb = lo + (hi - lo) * (k / (n - 1) if n > 1 else 0.5)
                    counts["bal"] += 1
                    p2 = a + t * sb
                    _inst(bal, f"{name}_Baluster_{counts['bal']:03d}", (p2.x, p2.y, z), rot, col)
    return out, counts


def build_railing(a, b, y=GY, height=RH, posts=(), wall_ends=(False, False), name="Architecture_Gallery_Railing"):
    """A straight gallery railing from web (x, z) point a to b on a floor at web height y.
    Extra newel posts at web (x, z) points `posts`. Returns the created objects."""
    before = set(bpy.data.objects)
    _build_railing_path(name, [_b2(a), _b2(b)], y, height, [_b2(p) for p in posts], wall_ends, _col_balcony())
    made = [o for o in bpy.data.objects if o not in before]
    _finish(made)
    return made


# ---------------------------------------------------------------------------
# The whole gallery
# ---------------------------------------------------------------------------

def _soffit_strips(lay):
    """Coffer cell boundaries for the three runs (north, west, south), aligned to the arcade
    supports (columns and pendants)."""
    segs = lay["segs"]
    hall = P.HALL
    x0, x1 = hall["minX"], hall["maxX"]
    yN, yS = -hall["minZ"], -hall["maxZ"]      # 10, -8
    north = next(s for s in segs if s.name == "North")
    south = next(s for s in segs if s.name == "South")
    west = next(s for s in segs if s.name == "West")
    ny = north.a.y - BACK_O * 1.0   # north fascia back face (y = 7.6)
    sy = south.a.y + BACK_O        # south back face (y = -5.6)
    wx = west.a.x + BACK_O         # west back face (x = -10.8)
    lx0 = _lift_x0()

    def sup(seg, i):
        return sorted({round(seg.p2(s)[i], 3) for s, kd in seg.supports})

    def subdivide(bounds, target):
        out = [bounds[0]]
        for lo, hi in zip(bounds, bounds[1:]):
            n = max(1, round((hi - lo) / target))
            out += [lo + (hi - lo) * k / n for k in range(1, n + 1)]
        return out

    xn = subdivide([x0] + [x for x in sup(north, 0) if x0 + 1.0 < x < lx0 - 0.5] + [lx0], 1.4)
    xs_ = subdivide([x0] + [x for x in sup(south, 0) if x0 + 1.0 < x < x1 - 1.0] + [x1], 1.4)
    yw = subdivide([sy] + [y for y in sup(west, 1) if sy + 0.5 < y < ny - 0.5] + [ny], 1.2)
    strips = [
        ("North", xn, [ny, (ny + yN) / 2, yN], (0.12, 0.10), (0.08, 0.12), "x"),
        ("South", xs_, [yS, (yS + sy) / 2, sy], (0.12, 0.12), (0.12, 0.08), "x"),
        ("West", [x0, (x0 + wx) / 2, wx], yw, (0.12, 0.08), (0.07, 0.07), "y"),
    ]
    return strips, None, (ny, sy, wx, yN, yS)


def _lift_in_hall():
    """True when plan.LIFT's shaft stands inside the hall (then the gallery floor is notched round it)."""
    sh, h = P.LIFT["shaft"], P.HALL
    return (sh["minX"] < h["maxX"] - 1e-6 and sh["maxX"] > h["minX"] + 1e-6
            and sh["minZ"] < h["maxZ"] - 1e-6 and sh["maxZ"] > h["minZ"] + 1e-6)


def _lift_x0():
    return P.LIFT["shaft"]["minX"] if _lift_in_hall() else P.HALL["maxX"]


LIFT_DOOR_SURROUND = 0.674   # half-width of arch_shell's lift door surround


def _gallery_skirting(lay):
    """Skirting where the gallery floor meets bare wall: round the lift shaft (from its door jamb)
    into the east wall at the north run's end, and the east wall at the south run's end. The
    gallery bookcases and the pilaster bases cover every other wall."""
    hall = P.HALL
    x1 = hall["maxX"]
    lift = P.LIFT["shaft"]
    lx0, ly0 = lift["minX"], -lift["maxZ"]
    door_y = -P.LIFT["door_z"] - P.LIFT["door_width"] / 2
    segs = lay["segs"]
    curb = 0.065
    w = mat("walnut")
    out = []
    ny = segs[0].a.y + curb
    if _lift_in_hall():
        out.append(_skirting("Architecture_Gallery_Skirting_NE", [(lx0, door_y), (lx0, ly0), (x1, ly0), (x1, ny)], GY, w))
    else:
        # The lift opens through the east wall: skirting from its door surround to the run front.
        jamb = -(P.LIFT["door_z"] + LIFT_DOOR_SURROUND)
        if jamb > ny + 0.05:
            out.append(_skirting("Architecture_Gallery_Skirting_NE", [(x1, jamb), (x1, ny)], GY, w))
    bc_end = min(-b["b"][1] for b in P.BOOKCASES if b["id"] == "bc_gallery_s2") + 0.45
    sy = segs[-1].a.y - curb
    out.append(_skirting("Architecture_Gallery_Skirting_SE", [(x1, sy), (x1, bc_end)], GY, w))
    return out


def build_gallery(landing=True):
    """Builds the whole U-shaped gallery in place (and the lobby landing). Returns all objects."""
    before = set(bpy.data.objects)
    balcony, columns = _col_balcony(), _col_columns()
    lay = _layout()
    segs, side, path = lay["segs"], lay["side"], lay["path"]

    # columns (one mesh, instanced) and the arcade (with instanced pendants)
    colsrc = _shared(("column", SPRING), lambda: build_arcade_column(SPRING))
    for i, c in enumerate(lay["columns"]):
        _inst(colsrc, f"Architecture_Gallery_Column_{i + 1:02d}", (c.x, c.y, 0.0), 0.0, columns)
    _build_arcade(lay, columns)

    # fascia, frieze, LED, and the scroll consoles where the fascia meets the east wall
    _build_fascia(path, segs, side, "Architecture_Gallery_Fascia", balcony)
    _build_frieze(segs, side, "Architecture_Gallery_Frieze", balcony)
    cparts = []
    w = mat("walnut")
    if segs[0].wall_a:
        cparts += _console(segs[0], 0.0, 1.0, "Architecture_Gallery_Console_N", w)
    if segs[-1].wall_b:
        cparts += _console(segs[-1], segs[-1].L, -1.0, "Architecture_Gallery_Console_S", w)
    if cparts:
        C.move_to(C.join(cparts, "Architecture_Gallery_Consoles"), balcony)

    # floor (with header boards where the boards turn at the NW / SW corners) and skirting
    strips, extra, (ny, sy, wx, yN, yS) = _soffit_strips(lay)
    x0, x1 = P.HALL["minX"], P.HALL["maxX"]
    lift = P.LIFT["shaft"]
    lx0, ly0 = (lift["minX"], -lift["maxZ"]) if _lift_in_hall() else (x1, yN)
    fl_n = segs[0].a.y + 0.06
    fl_s = segs[-1].a.y - 0.06
    fl_w = segs[1].a.x - 0.06
    north_floor = ([(x0, fl_n, lx0, yN, "x"), (lx0, fl_n, x1, ly0, "x")] if _lift_in_hall()
                   else [(x0, fl_n, x1, yN, "x")])
    floor = _floor("Architecture_Gallery_Floor", [
        *north_floor,
        (x0, yS, x1, fl_s, "x"),
        (x0, fl_s + HEADER_W, fl_w, fl_n - HEADER_W, "y"),
    ])
    hdr = [_header_strip("Architecture_Gallery_Header_NW", x0 - EMBED, fl_n - HEADER_W, fl_w, fl_n, "x"),
           _header_strip("Architecture_Gallery_Header_SW", x0 - EMBED, fl_s, fl_w, fl_s + HEADER_W, "x")]
    sk = _gallery_skirting(lay)
    floor = C.join([floor] + hdr + sk, "Architecture_Gallery_Floor")
    C.move_to(floor, balcony)

    sparts = []
    for nm, xs_, ys_, ex, ey, axis in strips:
        sparts += _soffit(f"Architecture_Gallery_Soffit_{nm}", xs_, ys_, ex, ey, axis)
    if _lift_in_hall():
        sparts += _plain_soffit("Architecture_Gallery_Soffit_Lift", lx0, ny, x1, ly0)
        cove = [(x1, ly0), (lx0, ly0), (lx0, yN), (x0, yN), (x0, yS), (x1, yS)]
    else:
        cove = [(x1, yN), (x0, yN), (x0, yS), (x1, yS)]
    sparts.append(_wall_cove("Architecture_Gallery_Soffit_Cove", cove, 1.0, mat("walnut")))
    soff = C.join(sparts, "Architecture_Gallery_Soffit")
    C.move_to(soff, balcony)

    # railing along the U
    _build_railing_path("Architecture_Gallery_Railing", path, GY, RH, list(lay["columns"]),
                        (segs[0].wall_a, segs[-1].wall_b), balcony)

    if landing:
        build_landing()
    made = [o for o in bpy.data.objects if o not in before]
    _finish(made)
    return made


def _finish(objs):
    """Every mesh gets a render UV layer; shared/instanced meshes are left as they are."""
    seen = set()
    for o in objs:
        if o.type != "MESH" or o.data.name in seen:
            continue
        seen.add(o.data.name)
        _uvdata(o.data)


# ---------------------------------------------------------------------------
# Landing over the lobby
# ---------------------------------------------------------------------------

def _landing_fascia(seg, y0, xq, name):
    """The landing fascia from x = -xq to xq with its mouldings returned 90 deg (mitred) at both
    ends so the return's nosing lands on the stair-head line x = +-(xq + 0.27). Behind the railing
    line the beam is cut square and capped."""
    w = mat("walnut")
    size = tex("walnut")
    prof = list(FASCIA)
    prof.insert(1, (0.0, GY))                                     # o = 0 on the top edge
    ib = next(i for i, (o, z) in enumerate(prof) if o < 0 and abs(z - FB) < 1e-9)
    prof.insert(ib, (0.0, FB))                                    # o = 0 on the bottom edge
    m = len(prof)
    A3, B3 = Vector((xq, y0, 0)), Vector((-xq, y0, 0))
    frames = [(A3, Vector((1, -1, 0)), Vector((0, 0, 1))), (B3, Vector((-1, -1, 0)), Vector((0, 0, 1)))]
    main = _frame_sweep(name + "_Main", frames, prof, w, cap=False, size=size, smooth=38, recalc=False)
    me = main.data
    neg = [j for j, (o, z) in enumerate(prof) if o <= 1e-9]
    for ring, x in ((0, xq), (1, -xq)):
        for j, (o, z) in enumerate(prof):
            if o < -1e-9:
                me.vertices[ring * m + j].co = Vector((x, y0 - o, z))
    me.update()
    # caps over the square-cut back (o <= 0), in profile order (contiguous cyclically)
    start = next(j for j in neg if prof[(j - 1) % m][0] > 1e-9)
    loop = []
    j = start
    while prof[j][0] <= 1e-9:
        loop.append(j)
        j = (j + 1) % m
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    for ring, sgn in ((0, 1), (1, -1)):
        vs = [bm.verts[ring * m + j] for j in loop]
        f = bm.faces.new(vs)
        if f.normal.x * sgn < 0:
            f.normal_flip()
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.y / size, lp.vert.co.z / size)
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    parts = [main]
    # the returns: profile o >= 0, from the mitre back to the landing edge plane y = y0
    rp = [p for p in prof if p[0] >= -1e-9]
    i0 = prof.index((0.0, GY))
    rp = prof[i0:prof.index((0.0, FB)) + 1]
    for sgn, tag in ((1, "E"), (-1, "W")):
        verts, faces, uvs = [], [], []
        S, E = [], []
        for o, z in rp:
            x = sgn * (xq + o)
            if o <= 1e-9:
                verts.append(Vector((x, y0, z)))
                S.append(len(verts) - 1)
                E.append(len(verts) - 1)
            else:
                verts.append(Vector((x, y0 - o, z)))
                S.append(len(verts) - 1)
                verts.append(Vector((x, y0, z)))
                E.append(len(verts) - 1)
        for j in range(len(rp) - 1):
            f = [S[j], S[j + 1], E[j + 1], E[j]]
            f = [v for i, v in enumerate(f) if v not in f[:i]]
            if len(f) >= 3:
                faces.append(tuple(f))
        faces.append(tuple(E))
        for f in faces:
            uvs.append(tuple((verts[v].y / size, verts[v].z / size) for v in f))
        ob = _mesh(f"{name}_Return{tag}", verts, faces, uvs, w, recalc=True, smooth=38)
        parts.append(ob)
    fas = C.join(parts, name)
    _weld(fas)
    C.shade_smooth(fas, 38)
    return fas


def _landing_frieze(seg, y0, xq, name):
    """Frieze for the landing: ornament panels between a centre rosette block and two corner
    blocks that wrap the mitred returns."""
    w = mat("walnut")
    parts = []
    zc = (FRIEZE_Z0 + FRIEZE_Z1) / 2
    L = seg.L
    parts.append(_frieze_strip(seg, BLOCK_HW, L / 2 - BLOCK_HW, f"{name}_Panel00", 1.0))
    parts.append(_frieze_strip(seg, L / 2 + BLOCK_HW, L - BLOCK_HW, f"{name}_Panel01", 1.0))
    up = Vector((0, 0, 1))
    for sgn in (1, -1):
        A = Vector((sgn * xq, y0, 0))
        frames = [(A + Vector((0, -0.002, 0)), Vector((sgn, 0, 0)), up), (A, Vector((sgn, -1, 0)), up),
                  (A + Vector((-sgn * BLOCK_HW, 0, 0)), Vector((0, -1, 0)), up)]
        blk = _frame_sweep(f"{name}_CornerBlock", frames, BLOCK_PROF, w, size=tex("walnut"), smooth=None)
        C.bevel(blk, 0.004, 2)
        _clean(blk)
        _uv(blk, "walnut", None)
        parts.append(blk)
        o = BLOCK_PROF[1][0]
        r = _block_rosette(f"{name}_Rosette", Vector((sgn * (xq + o - 0.205), y0 - o, zc)), Vector((0, -1, 0)))
        parts.append(r)
    s_ = L / 2
    lo = seg.p(s_ - BLOCK_HW, BLOCK_PROF[0][0], BLOCK_PROF[0][1])
    hi = seg.p(s_ + BLOCK_HW, BLOCK_PROF[1][0], BLOCK_PROF[2][1])
    blk = C.box_minmax(f"{name}_Block", Vector(map(min, lo, hi)), Vector(map(max, lo, hi)), w, bevel_w=0.004)
    _uv(blk, "walnut", "x")
    parts.append(blk)
    parts.append(_block_rosette(f"{name}_RosetteC", seg.p(s_, BLOCK_PROF[1][0], zc), seg.n3))
    for p_ in parts:
        if not p_.data.uv_layers:
            _uv(p_, "walnut", "x")
    return C.join(parts, name)


def _landing_dentils(seg, y0, xq, name):
    oc = (DENTIL_O0 + DENTIL_O1) / 2
    zc = (DENTIL_Z0 + DENTIL_Z1) / 2
    hd = (DENTIL_O1 - DENTIL_O0) / 2
    pl = []
    a0, a1 = -oc, seg.L + oc
    n = max(1, round((a1 - a0) / DENTIL_PITCH))
    pitch = (a1 - a0) / n
    for k in range(1, n):
        pl.append((seg.p(a0 + k * pitch, oc, zc), seg.t3, seg.n3, DENTIL_W / 2))
    for sgn in (1, -1):
        c = Vector((sgn * (xq + oc), y0 - oc, zc))
        pl.append((c, Vector((1, 0, 0)), Vector((0, -1, 0)), hd))
        for k in (1, 2):
            yy = y0 - oc + k * pitch
            if yy + DENTIL_W / 2 > y0 - 0.004:
                break
            pl.append((Vector((sgn * (xq + oc), yy, zc)), Vector((0, 1, 0)), Vector((sgn, 0, 0)), DENTIL_W / 2))
    return _dentil_mesh(name, pl)


def build_landing():
    """The gallery-level landing over the lobby: floor, coffered soffit, the fascia (with mitred
    returns), frieze, dentils and LED on its front edge, a walnut trimmer + landing nosing over
    each stair head, scroll consoles under the fascia ends against the stair strings / the
    under-stair closure, skirting, and the same railing (plan.STAIRS['landing_railing'])."""
    before = set(bpy.data.objects)
    balcony = _col_balcony()
    lr = P.STAIRS["landing_railing"]
    ra, rb_ = _b2(lr["b"]), _b2(lr["a"])       # east -> west so the outward side is the lobby (-y)
    y0 = ra.y
    xs = ra.x                                  # stair-head line (inner string), 4.4
    xq = xs - FASCIA_MAX_O                     # fascia mitre so the return's nosing lands on xs
    seg = _Seg(Vector((xq, y0)), Vector((-xq, y0)), Vector((0, -1)), name="Landing")
    seg.supports = [(seg.L / 2, "block")]
    w = mat("walnut")
    fas = _landing_fascia(seg, y0, xq, "Architecture_Gallery_Landing_Fascia")
    pts = [Vector((xq, y0)), Vector((-xq, y0))]
    hs, led = _led("Architecture_Gallery_Landing_Fascia", pts, 1.0, balcony)
    led.name = "Architecture_Gallery_Landing_LED"
    dent = _landing_dentils(seg, y0, xq, "Architecture_Gallery_Landing_Dentils")
    fas = C.join([fas, hs, dent], "Architecture_Gallery_Landing_Fascia")
    C.move_to(fas, balcony)
    fr = _landing_frieze(seg, y0, xq, "Architecture_Gallery_Landing_Frieze")
    C.move_to(fr, balcony)

    L = P.LANDING
    lx0, lx1 = L["minX"], L["maxX"]
    ly0, ly1 = -L["maxZ"], -L["minZ"]          # -11.2, -8.8
    # trimmer + landing nosing over both stair heads (from inside the fascia return to the wall)
    tparts = []
    for x_a, x_b, tag in ((xq, lx1 + EMBED, "E"), (lx0 - EMBED, -xq, "W")):
        tparts.append(_frame_sweep(f"Architecture_Gallery_Landing_Nosing{tag}", _hframes([(x_a, y0), (x_b, y0)], side=-1.0),
                                   TRIMMER, w, size=tex("walnut"), smooth=40))
    # consoles under the fascia ends, backs on the stair-head line
    cseg = _Seg(Vector((xs, y0)), Vector((-xs, y0)), Vector((0, -1)), name="LandingConsole")
    tparts += _console(cseg, 0.0, 1.0, "Architecture_Gallery_Landing_Console_E", w, zt=FB, zb=FB - 0.47,
                       o_range=(-0.10, 0.10), depth=0.27)
    tparts += _console(cseg, cseg.L, -1.0, "Architecture_Gallery_Landing_Console_W", w, zt=FB, zb=FB - 0.47,
                       o_range=(-0.10, 0.10), depth=0.27)
    trim = C.join(tparts, "Architecture_Gallery_Landing_Trim")
    C.move_to(trim, balcony)

    fy = y0 + 0.06
    floor = _floor("Architecture_Gallery_Landing_Floor", [
        (lx0, ly0, -xq, ly1, "x"), (-xq, fy, xq, ly1, "x"), (xq, ly0, lx1, ly1, "x")])
    pass_hw = 1.6
    sk = [_skirting("Architecture_Gallery_Landing_SkirtingW", [(lx0, ly0), (lx0, ly1), (-pass_hw, ly1)], GY, w),
          _skirting("Architecture_Gallery_Landing_SkirtingE", [(pass_hw, ly1), (lx1, ly1), (lx1, ly0)], GY, w)]
    floor = C.join([floor] + sk, "Architecture_Gallery_Landing_Floor")
    C.move_to(floor, balcony)
    sy = y0 - BACK_O
    xs_ = [lx0 + (lx1 - lx0) * k / 8 for k in range(9)]
    sp = _soffit("Architecture_Gallery_Landing_Soffit", xs_, [sy, (sy + ly1) / 2, ly1], (0.12, 0.12), (0.08, 0.12), "x")
    sp += _plain_soffit("Architecture_Gallery_Landing_SoffitW", lx0, ly0, -xq, sy)
    sp += _plain_soffit("Architecture_Gallery_Landing_SoffitE", xq, ly0, lx1, sy)
    sp.append(_wall_cove("Architecture_Gallery_Landing_Cove", [(lx0, ly0), (lx0, ly1), (lx1, ly1), (lx1, ly0)], -1.0, w))
    soff = C.join(sp, "Architecture_Gallery_Landing_Soffit")
    C.move_to(soff, balcony)
    _build_railing_path("Architecture_Gallery_Landing_Railing", [ra, rb_], GY, RH, [(ra + rb_) / 2], (False, False), balcony)
    made = [o for o in bpy.data.objects if o not in before]
    _finish(made)
    return made


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _standins():
    """Preview-only context: hall floor, walls, ground, gallery bookcases and the lobby stairs."""
    objs = []
    hall = P.HALL
    x0, x1, y0, y1 = hall["minX"], hall["maxX"], -hall["maxZ"], -hall["minZ"]
    t, top = 0.8, P.HALL_CEILING
    stone = mat("limestone")
    for nm, lo, hi in (("S", (x0 - t, y0 - t, 0), (x1 + t, y0, top)), ("N", (x0 - t, y1, 0), (x1 + t, y1 + t, top)),
                       ("W", (x0 - t, y0, 0), (x0, y1, top)), ("E", (x1, y0, 0), (x1 + t, y1, top))):
        ob = C.box_minmax(f"Preview_Wall_{nm}", lo, hi, stone)
        C.uv_box(ob, tex("limestone"))
        objs.append(ob)
    ceil = C.box_minmax("Preview_Ceiling", (x0 - t, y0 - t, top), (x1 + t, y1 + t, top + 0.3), mat("coffer_panel"))
    C.uv_box(ceil, tex("coffer_panel"))
    objs.append(ceil)
    fl = C.box_minmax("Preview_Floor", (x0, y0 - 12, -0.1), (x1, y1, 0), mat("parquet_herringbone"))
    C.uv_box(fl, tex("parquet_herringbone"))
    objs.append(fl)
    lb = P.LOBBY
    fl2 = C.box_minmax("Preview_LobbyFloor", (lb["minX"], -lb["maxZ"], -0.1), (lb["maxX"], -lb["minZ"], 0), mat("stone_tiles"))
    C.uv_box(fl2, tex("stone_tiles"))
    for nm, lo, hi in (("LobbyW", (lb["minX"] - 0.3, -lb["maxZ"], 0), (lb["minX"], -lb["minZ"], 8.3)),
                       ("LobbyE", (lb["maxX"], -lb["maxZ"], 0), (lb["maxX"] + 0.3, -lb["minZ"], 8.3))):
        ob = C.box_minmax(f"Preview_{nm}", lo, hi, stone)
        C.uv_box(ob, tex("limestone"))
        objs.append(ob)
    lift = P.LIFT["shaft"]
    objs.append(C.box_minmax("Preview_Lift", (lift["minX"], -lift["maxZ"], 0), (lift["maxX"], -lift["minZ"], 9.0), mat("walnut_dark")))
    # lobby flights (solid stepped masses with a closure under the top) - preview only
    st = P.STAIRS
    for f in st["flights"]:
        b = f["bounds"]
        for i in range(1, st["risers"]):
            ztop = GY - i * st["riser"]
            ya = -(f["top"] + (i - 1) * st["tread"]) - 0.004
            yb = -(f["top"] + i * st["tread"])
            ob = C.box_minmax(f"Preview_Step_{f['id']}_{i:02d}", (b["minX"], yb, 0), (b["maxX"], ya, ztop), mat("stone_tiles"))
            C.uv_box(ob, tex("stone_tiles"))
            objs.append(ob)
    books = mat("book_cloth")
    wd = mat("walnut_dark")
    for bc in P.BOOKCASES:
        if bc["style"] not in ("hall", "gallery"):
            continue
        a, b = _b2(bc["a"]), _b2(bc["b"])
        d = (b - a).normalized()
        rot = bc["rot"]
        fwd = Vector((math.sin(rot), -math.cos(rot)))
        z0 = bc["y"]
        h = bc["height"]
        q = [a, b, a + fwd * bc["depth"], b + fwd * bc["depth"]]
        lo = Vector((min(v.x for v in q), min(v.y for v in q), z0))
        hi = Vector((max(v.x for v in q), max(v.y for v in q), z0 + h))
        objs.append(C.box_minmax(f"Preview_BC_{bc['id']}", lo, hi, wd))
        qi = [a + d * 0.05, b - d * 0.05, a + fwd * (bc["depth"] - 0.04) + d * 0.05, b + fwd * (bc["depth"] - 0.04) - d * 0.05]
        lo2 = Vector((min(v.x for v in qi), min(v.y for v in qi), z0 + 0.12))
        hi2 = Vector((max(v.x for v in qi), max(v.y for v in qi), z0 + h - 0.12))
        bk = C.box_minmax(f"Preview_Books_{bc['id']}", lo2, hi2, books)
        bk.color = (0.55, 0.28, 0.2, 1)
        C.uv_box(bk, 1.0)
        objs.append(bk)
    # a 1.7 m person for scale
    pm = bpy.data.materials.get("Preview_Person") or bpy.data.materials.new("Preview_Person")
    pm.diffuse_color = (0.55, 0.56, 0.6, 1)
    try:
        bs = next(n for n in pm.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bs.inputs["Base Color"].default_value = (0.42, 0.44, 0.5, 1)
    except Exception:
        pass
    for px, py, pz in ((3.4, 6.6, 0.0), (-3.0, 8.7, GY), (2.4, -9.8, GY)):
        body = C.cylinder("Preview_Person", 0.17, 0.19, 1.42, (px, py, pz + 0.71), pm, 24)
        head = C.sphere("Preview_Person_Head", 0.105, (px, py, pz + 1.585), pm, 16, 10)
        objs += [body, head]
    return objs


def _lights(scene):
    """Warm interior: daylight from the high north windows (area lights), two chandeliers, a warm
    floor bounce, and stand-ins for the LED wash under the gallery (EEVEE needs real lights there)."""
    R.world(scene, (0.20, 0.18, 0.16), 0.25)
    hall = P.HALL
    yN, yS = -hall["minZ"], -hall["maxZ"]

    def area(name, loc, rot, size, size_y, energy, color):
        l = bpy.data.lights.new(name, "AREA")
        l.shape = "RECTANGLE"
        l.size, l.size_y = size, size_y
        l.energy = energy
        l.color = color
        o = bpy.data.objects.new(name, l)
        scene.collection.objects.link(o)
        o.location = loc
        o.rotation_euler = rot
        return o

    area("Preview_Windows_N", (0.0, yN - 3.0, 10.5), (math.radians(-40), 0, 0), 24.0, 3.0, 2600, (0.80, 0.87, 1.0))
    area("Preview_Windows_S", (0.0, yS + 3.0, 10.5), (math.radians(40), 0, 0), 24.0, 2.0, 1200, (0.85, 0.9, 1.0))
    for x in (-5.7, 5.7):
        R.point_light(f"Preview_Chandelier_{x}", (x, 1.0, 7.2), 6500, (1.0, 0.72, 0.45), 1.2)
    area("Preview_Bounce", (0, 1.0, 0.6), (math.pi, 0, 0), 24, 12, 2400, (1.0, 0.76, 0.52))
    for y, ang in ((7.75, -140), (-5.75, 140)):
        area(f"Preview_LEDWash_{y}", (1.6, y, 4.0), (math.radians(ang), 0, 0), 24.0, 0.05, 700, (1.0, 0.76, 0.48))
    area("Preview_LEDWash_W", (-10.85, 1.0, 4.0), (0, math.radians(-140), 0), 0.05, 12.0, 350, (1.0, 0.76, 0.48))
    R.point_light("Preview_Lobby", (0.0, -15.0, 6.0), 2200, (1.0, 0.78, 0.55), 0.8)
    R.point_light("Preview_LobbyHigh", (0.0, -12.5, 7.4), 900, (1.0, 0.85, 0.7), 0.5)
    R.point_light("Preview_LobbyLow", (0.0, -14.0, 2.4), 700, (1.0, 0.8, 0.6), 0.6)


def _tri_report(objs):
    seen, unique, rendered = set(), 0, 0
    for o in objs:
        if o.type != "MESH":
            continue
        t = C.tris(o)
        rendered += t
        if o.data.name not in seen:
            seen.add(o.data.name)
            unique += t
    return unique, rendered


def report_tris(objs):
    """Triangle counts per asset group; per-5.6 m-run budget with instanced meshes counted once
    (ASSETS.md: balusters are instanced) and, for reference, everything as rendered."""
    groups = {}
    for o in objs:
        if o.type != "MESH":
            continue
        nm = o.name
        for key in ("Baluster", "Bracket", "Panel", "Post", "Pendant", "Column", "Arcade", "Fascia", "LED", "Frieze",
                    "Soffit", "Floor", "Rails", "Consoles", "Trim"):
            if f"_{key}" in nm:
                g = ("Landing " if "Landing" in nm else "") + key
                groups.setdefault(g, []).append(o)
                break
    total_r = 0
    for g, lst in sorted(groups.items()):
        u, r = _tri_report(lst)
        total_r += r
        print(f"TRIS {g:18s} objects {len(lst):4d}  unique {u:7d}  rendered {r:8d}")
    total_u, _ = _tri_report(objs)
    run_len = sum(s.L for s in _layout()["segs"]) + 8.8
    print(f"TRIS gallery: {run_len:.1f} m of front. unique (instances once) {total_u} -> per 5.6 m run ~{total_u / run_len * 5.6:.0f};"
          f" rendered {total_r} -> per 5.6 m run ~{total_r / run_len * 5.6:.0f}")
    for key in (("column", SPRING), ("bal", RH), ("post", RH), "bracket", ("panel", RH), "pendant"):
        me = _SHARED.get(key)
        if me:
            print(f"TRIS shared mesh {me.name}: {sum(len(p.vertices) - 2 for p in me.polygons)}")
    return total_u, total_r


VIEWS = [
    ("hall_wide", (9.0, -3.2, 1.65), (-6.0, 7.0, 3.9), 18, (960, 640)),
    ("hall_west", (2.5, 0.2, 1.65), (-10.6, 2.0, 3.6), 20, (960, 640)),
    ("scale", (0.0, -1.0, 1.6), (2.4, 7.4, 2.6), 22, (960, 640)),
    ("walkway", (11.6, 8.75, 6.2), (-6.0, 7.9, 5.25), 20, (960, 640)),
    ("railing", (1.45, 8.45, 5.55), (2.8, 7.4, 5.2), 30, (960, 720)),
    ("railing_macro", (3.55, 8.05, 5.62), (4.25, 7.4, 5.3), 42, (960, 720)),
    ("panel", (5.6, 8.62, 5.15), (5.6, 7.4, 5.12), 30, (960, 720)),
    ("panel_detail", (5.38, 7.98, 5.08), (5.7, 7.4, 5.02), 42, (960, 720)),
    ("capital", (-1.55, 5.65, 2.45), (-2.8, 7.35, 3.45), 30, (960, 720)),
    ("capital_macro", (-2.25, 6.42, 2.05), (-2.8, 7.4, 2.84), 50, (960, 720)),
    ("pendant", (1.25, 5.55, 1.75), (0.0, 7.4, 2.85), 30, (960, 720)),
    ("fascia", (0.9, 5.4, 3.75), (-0.6, 7.35, 4.25), 26, (960, 720)),
    ("soffit", (-4.2, 9.3, 1.6), (-2.8, 7.9, 4.0), 18, (960, 720)),
    ("corner", (-6.5, 3.6, 2.2), (-10.6, 7.4, 3.9), 22, (960, 720)),
    ("gallery_corner", (-12.6, 5.2, 6.2), (-12.1, 7.6, 4.6), 26, (960, 720)),
    ("east_end", (10.2, 4.8, 2.4), (13.3, 7.4, 3.6), 24, (960, 720)),
    ("east_walkway", (10.2, -6.6, 6.2), (14.0, -6.9, 4.9), 26, (960, 720)),
    ("lift_end", (9.6, 7.75, 6.15), (13.2, 8.1, 4.75), 24, (960, 720)),
    ("landing", (2.6, -17.5, 1.7), (0.0, -11.2, 4.7), 22, (960, 640)),
    ("landing_end", (-2.2, -13.9, 3.0), (-4.45, -11.3, 4.1), 30, (960, 720)),
    ("landing_return", (-3.3, -12.6, 4.15), (-4.4, -11.35, 4.3), 34, (960, 720)),
    ("landing_top", (-2.6, -9.6, 6.2), (-5.6, -11.3, 4.9), 22, (960, 720)),
]


def preview(out_dir):
    scene = bpy.context.scene
    objs = build_gallery(landing=True)
    report_tris(objs)
    _standins()
    _lights(scene)
    R.engine(scene, "EEVEE", 32, (960, 640))
    scene.view_settings.exposure = -0.35
    shots = os.environ.get("OVR_SHOTS", "")
    cam = R.camera(lens=20)
    for name, loc, tgt, lens, size in VIEWS:
        if shots and name not in shots.split(","):
            continue
        scene.render.resolution_x, scene.render.resolution_y = size
        cam.data.lens = lens
        R.look(cam, loc, tgt)
        R.render(os.path.join(out_dir, f"arch_gallery_{name}.png"))


def preview_column(out_dir):
    ob = build_arcade_column()
    print("TRIS column", C.tris(ob))
    R.preview_objects([ob], out_dir, "column", views=((20, 8),), size=(640, 960), samples=32, lens=50)
    cam = bpy.context.scene.camera
    for nm, loc, tgt, lens in (("capital", (0.62, -1.15, 2.62), (0, 0, 2.82), 50),
                               ("capital_below", (0.40, -0.95, 1.75), (0, 0, 2.78), 50),
                               ("capital_side", (-0.95, -0.55, 2.95), (0, 0, 2.80), 55),
                               ("base", (0.55, -1.0, 0.5), (0, 0, 0.13), 50)):
        cam.data.lens = lens
        R.look(cam, loc, tgt)
        bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 800, 800
        R.render(os.path.join(out_dir, f"column_{nm}.png"))


def preview_parts(out_dir):
    """Studio renders of the iron panel, bracket, baluster + post, and the pendant."""
    pnl = _panel_mesh()
    post = _post_mesh()
    post.location = (0.62, 0, 0)
    brk = _bracket_mesh()
    brk.location = (0.62 + POST_HW, 0, 0)
    bals = []
    for i in range(3):
        b = _baluster_mesh()
        b.location = (0.62 + 0.30 + i * BAL_SP, 0, 0)
        bals.append(b)
    pend = _pendant_mesh()
    pend.location = (2.2, 0, -SPRING + 1.0)
    for o in [pnl, post, brk, pend] + bals:
        print("TRIS", o.name, C.tris(o))
    for na, nb, d in panel_clearances():
        print(f"CLEAR {na:5s} {nb:5s} {d * 1000:6.1f} mm")
    R.preview_objects([pnl], out_dir, "part_panel", views=((0, 0), (28, 10)), size=(900, 1100), samples=32, lens=60,
                      closeups=(("brk", [post, brk] + bals, 18, 6), ("pendant", [pend], 20, -12)))
