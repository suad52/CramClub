"""
Bookcases and books for the OVR library (BOOKS_AND_SHELVES).

Bookcase runs are plan-driven and built IN PLACE from `plan.BOOKCASES` specs
({id, a, b, rot, height, y, depth, style, subject}): the back of the case stands on the wall
line a->b (web coordinates) and its front faces `rot`. Construction, front to back:

  * a 173 mm moulded plinth ("hall", "gallery", "rotunda"): toe bead at the floor, plain face,
    then a base moulding (fillet, cyma reversa, top fillet). Its face stands 18 mm (the bead
    22 mm) proud of the pilaster base blocks, which sit on the top fillet behind a 2 mm reveal, so
    the plinth is the most projecting member at floor level. It returns round free ends and
    mitres at inside corners. "lounge"/"wing" cases keep a plain plinth and cap.
  * end panels and uprights every ~0.95 m. Rich uprights are faced with pilasters: base block and
    torus seated on the plinth moulding, a shaft with three STOPPED flutes (rounded ends, 50 mm
    short of the base and capital), capital ovolo and abacus. "lounge"/"wing" uprights are plain
    oak with rounded arrises.
  * fixed shelves every ~0.35 m (the bottom bay is taller for folios and archive boxes): a 26 mm
    board with a 44 mm front banding (rounded arris, cock-bead line).
  * a darker tongue-and-groove back.
  * arched bay heads (hall/rotunda, Ref 2), an architrave bead, a frieze and a crown cornice
    swept along the front (fillet, astragal, cove, corona, cyma recta), mitred at the corners.
  * labels, after Ref 2: a moulded subject board (dark painted field, gilt slip, gilt Roman
    capitals of the run's `subject`, like "MATHS") centred in the frieze, and a small dark press
    plaque with the bay's gilt Roman numeral over each bay the board leaves free. Each bay's shelf banding at eye level
    carries a small brass card holder whose aged-ivory card (`label_card`) is inked with the
    bay's shelf-mark range ("D 101-180", from the subject's class letters); free panelled ends
    carry a larger card with the run's class letters.

Inside corners between runs (e.g. the hall's NW corner) are detected from the plan: equal-height
runs get true inside mitres on the plinth, bead and cornice; a shorter run's cornice dies square
into its taller neighbour. The dead corner behind the butting run is closed (corner stile filling
the re-entrant angle from plinth to cornice, floor board, back boards to the floor, lid carried
over the corner).

Books: 61 variant meshes (<= 160 triangles each, see VARIANTS) of six shapes - cloth hardcover
(rounded spine, joint grooves, board overhang, concave fore-edge), leather with raised bands, tall
folio, slim paperback, thick reference volume, archival box - plus a brass bookend. Each variant
UVs its spine into ONE cell of the 8 x 4 `book_spines` atlas; textures.py paints every cell for
one spine size (its CELL_MM, which equals SHAPES[shape] T x H here). Variants come in up to two
THICKNESS CLASSES around that design size (0.86 x or 1.16 x) and the UVs keep the lettering's
proportions: a thin class shows the art 7 % condensed with 3.6 % cropped at each side (almost all
of it the cell's plain 3 % margin); a thick class shows it at true scale with the extra spine
width on the plain margin (the spine arc has a vertex exactly where the art ends). Instances
scale thickness with height (+-5 %), so on every book the spine art is within -12 % / +5 % of
its painted aspect. The modelled raised bands sit on
the painted ones (their count is read from the atlas). Covers and edges sample the cell's plain
margin. Books use mat("book_cloth") (object colour x atlas, with the atlas's gilt kept out of the
colour multiply and made metallic, per textures.py); page edges use "book_pages".

    case_objs, slots = build_bookcase_run(spec)
    records = fill_slots(slots, seed=1)          # [(variant, world_matrix, (r, g, b)), ...]
    instance_books(records)                       # Blender linked duplicates (renders)
    export_books_bin(records, "books.bin")        # web instancing data
    export_book_variants_glb("book_variants.glb") # the variant meshes, in VARIANTS order
"""

from __future__ import annotations

import math
import os
import random
import struct
import zlib

import bmesh
import bpy
from mathutils import Matrix, Vector

import lib_core as C
import lib_materials as LM
import lib_render as R
from lib_materials import mat, tex_size

ROOT_COL = "BOOKS_AND_SHELVES"

# Aged page edges: a touch darker and duller than "paper" so book tops do not glare.
LM.PALETTE.setdefault("book_pages", dict(base="#d6c8aa", rough=0.88))
# Aged ivory label cards (matt, a step darker than "paper" so they never read as white stickers)
# and the typewriter ink of the shelf marks inked on them.
LM.PALETTE.setdefault("label_card", dict(base="#bfae8a", rough=0.9))
LM.PALETTE.setdefault("label_ink", dict(base="#2a2420", rough=0.7))

# ---------------------------------------------------------------------------
# Case dimensions (metres). Local run frame: X along the run (0 .. L), back on y = 0, front
# toward -Y, floor of the run at z = 0.
# ---------------------------------------------------------------------------

BACK_T = 0.018      # back boarding
D_UP = 0.43         # front face of uprights and frieze
D_PIL = 0.448       # pilaster shaft face
D_SHELF = 0.418     # shelf banding face
SHELF_T = 0.026
BAND_H = 0.044
BAND_D = 0.02
UP_T = 0.04         # intermediate upright
END_T = 0.05        # end panel
BEAD_H = 0.02       # architrave bead under the frieze
PIL_BASE_PROJ = 0.008   # pilaster base block / torus beyond the shaft face

STYLES = {
    "hall": dict(wood="walnut", back="walnut_dark", rich=True, pilaster=0.07, frieze=0.15, crown=1.0,
                 bay=0.95, bottom=0.42, plaque=(0.17, 0.076), arches=True),
    "rotunda": dict(wood="walnut", back="walnut_dark", rich=True, pilaster=0.07, frieze=0.15, crown=1.0,
                    bay=0.95, bottom=0.42, plaque=(0.17, 0.076), arches=True),
    "gallery": dict(wood="walnut", back="walnut_dark", rich=True, pilaster=0.062, frieze=0.115, crown=0.82,
                    bay=0.95, bottom=0.40, plaque=(0.15, 0.062), arches=False),
    "lounge": dict(wood="oak", back="walnut", rich=False, pilaster=0.0, frieze=0.075, crown=1.0,
                   bay=0.9, bottom=0.40, plaque=None, arches=False),
    "wing": dict(wood="oak", back="walnut", rich=False, pilaster=0.0, frieze=0.07, crown=0.9,
                 bay=0.9, bottom=0.40, plaque=None, arches=False),
}

# Library of Congress-style class letters for the shelf marks on the bay cards (by run subject).
CLASS_MARKS = {
    "philosophy": "B", "history": "D", "literature": "PR", "languages": "PA", "sciences": "Q",
    "mathematics": "QA", "computing": "QA76", "art & music": "N", "geography": "G", "law": "K",
    "economics": "HB", "reserve": "RES",
}
GENERIC_MARKS = ("AC", "AE", "BL", "BR", "CB", "DA", "DC", "E", "F", "GN", "HM", "JC", "LB", "ML", "NA",
                 "PN", "PQ", "QH", "RA", "S", "TA", "Z")
ROMAN = ("I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII", "XIII", "XIV", "XV",
         "XVI", "XVII", "XVIII", "XIX", "XX", "XXI", "XXII", "XXIII", "XXIV", "XXV", "XXVI", "XXVII",
         "XXVIII", "XXIX", "XXX")

# Plinth geometry per construction: face line (depth from the wall), top of the plinth moulding,
# top of the bottom shelf, bottom of the uprights.
PLINTH_RICH = dict(face=0.474, top=0.173, zb=0.178, up0=0.10)
PLINTH_SIMPLE = dict(face=0.44, top=0.16, zb=0.16, up0=0.12)


def _crc(*parts):
    return zlib.crc32("|".join(str(p) for p in parts).encode())


def _deg(d):
    return math.radians(d)


# ---------------------------------------------------------------------------
# Low-level mesh helpers (closed-profile sweeps, extrusions, mitre cuts)
# ---------------------------------------------------------------------------

def _sweep_bm(profile, path, up=(0, 0, 1)):
    """Closed 2D profile [(u, v)] swept along a polyline (u = outward, to the path's right when
    looking along it with `up`, v = up). Corners are mitred, ends capped. Returns a bmesh."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    upv = Vector(up)
    frames = []
    for i in range(n):
        d0 = (pts[i] - pts[i - 1]).normalized() if i > 0 else (pts[1] - pts[0]).normalized()
        d1 = (pts[i + 1] - pts[i]).normalized() if i < n - 1 else d0
        t = d0 + d1
        t = t.normalized() if t.length > 1e-6 else d1
        s0 = upv.cross(d0).normalized()
        s = upv.cross(t).normalized()
        miter = 1.0 / max(0.2, s.dot(s0))
        vert = t.cross(s).normalized()
        frames.append((s * miter, vert))
    bm = bmesh.new()
    rings = [[bm.verts.new(p - s * u + vv * v) for (u, v) in profile] for p, (s, vv) in zip(pts, frames)]
    m = len(profile)
    for a, c in zip(rings, rings[1:]):
        for j in range(m):
            k = (j + 1) % m
            bm.faces.new((a[j], c[j], c[k], a[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def _bisect_keep(bm, co, no):
    """Cuts the mesh with a plane, keeps the side `no` points to and caps the cut."""
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-7, plane_co=Vector(co), plane_no=Vector(no).normalized(),
                           clear_inner=True)
    edges = [e for e in bm.edges if e.is_boundary]
    if edges:
        bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)


def _ob(name, bm, key, smooth=35.0):
    ob = C.mesh_from_bmesh(name, bm, mat(key))
    C.shade_smooth(ob, smooth)
    return ob


def _extrude_x(name, yz, x0, x1, key, smooth=35.0):
    """Closed profile in the YZ plane extruded along X from x0 to x1 (bandings, rails)."""
    bm = bmesh.new()
    a = [bm.verts.new((x0, y, z)) for y, z in yz]
    b = [bm.verts.new((x1, y, z)) for y, z in yz]
    m = len(yz)
    for j in range(m):
        k = (j + 1) % m
        bm.faces.new((a[j], a[k], b[k], b[j]))
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _ob(name, bm, key, smooth)


def _bbox(name, lo, hi, key, bw=0.003, seg=1):
    """Bevelled box. One bevel segment with hardened normals reads as a rounded arris at these
    sizes for a third of the triangles of two segments."""
    return C.box_minmax(name, lo, hi, mat(key), bevel_w=bw, segments=seg)


def _uv(ob, key, grain, rng):
    """World-scale box UVs with the grain along `grain`, plus a random offset so repeated parts
    never show the same figure."""
    C.uv_box(ob, size=tex_size(key), grain=grain)
    _uv_jitter(ob, rng)
    return ob


def _uv_jitter(ob, rng):
    du, dv = rng.random() * 7.0, rng.random() * 7.0
    for d in ob.data.uv_layers.active.data:
        d.uv = (d.uv[0] + du, d.uv[1] + dv)


def _uv_frame(ob, key, cx, cz, w, h, rng):
    """UVs for a mitred frame in the XZ plane: grain along X on the top and bottom members and
    along Z on the stiles (each face is classified by which member its centre lies in)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    size = tex_size(key)
    for p in me.polygons:
        c = p.center
        stile = (w / 2 - abs(c.x - cx)) < (h / 2 - abs(c.z - cz))
        n = p.normal
        dom = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != dom]
        g = 2 if stile else 0
        if g in (a, b) and g != a:
            a, b = b, a
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (co[a] / size, co[b] / size)
    _uv_jitter(ob, rng)
    return ob


# ---------------------------------------------------------------------------
# Moulding profiles (u = projection beyond the line, v = height; closed polygons)
# ---------------------------------------------------------------------------

def _scale(pts, s):
    return [(u * s, v * s) for u, v in pts]


def _profile_cornice_rich(s=1.0):
    P = [(-0.012, 0.0), (0.004, 0.0), (0.004, 0.006)]
    for d in (-60, -25, 0, 25, 60):                         # astragal
        P.append((0.004 + 0.007 * math.cos(_deg(d)), 0.013 + 0.007 * math.sin(_deg(d))))
    P += [(0.004, 0.020), (0.007, 0.020), (0.007, 0.024)]   # fillet
    for d in (15, 30, 45, 60, 75, 90):                      # cove
        P.append((0.047 - 0.040 * math.cos(_deg(d)), 0.024 + 0.040 * math.sin(_deg(d))))
    P += [(0.051, 0.064), (0.051, 0.069), (0.064, 0.069), (0.064, 0.104), (0.061, 0.104), (0.061, 0.109)]
    u0, v0, w, h = 0.061, 0.109, 0.036, 0.034                # cyma recta
    for d in (30, 60, 90):
        P.append((u0 + w / 2 * math.sin(_deg(d)), v0 + h / 2 - h / 2 * math.cos(_deg(d))))
    for d in (30, 60, 90):
        P.append((u0 + w - w / 2 * math.cos(_deg(d)), v0 + h / 2 + h / 2 * math.sin(_deg(d))))
    P += [(0.100, 0.143), (0.100, 0.152), (-0.012, 0.152)]
    return _scale(P, s)


def _profile_cornice_simple(s=1.0):
    P = [(-0.012, 0.0), (0.003, 0.0), (0.003, 0.006)]
    for d in (15, 35, 55, 75, 90):
        P.append((0.033 - 0.030 * math.cos(_deg(d)), 0.006 + 0.030 * math.sin(_deg(d))))
    P += [(0.036, 0.036), (0.036, 0.044), (0.0345, 0.0475), (0.031, 0.049), (-0.012, 0.049)]
    return _scale(P, s)


def _profile_plinth_rich():
    """The rich plinth in one closed profile (u beyond the plinth face line, v up):
    toe bead at the floor, plain face, then the base moulding - a step-back fillet, a cyma
    reversa (ovolo below, cove above) and a top fillet with an eased arris. The top runs back
    behind the bottom shelf's front so the shelf front stands 5 mm clear of the ledge."""
    P = [(-0.062, 0.0), (-0.002, 0.0)]
    for d in (-55, -20, 15, 50, 80):                         # toe bead, r 6.5 mm, 4.5 mm proud
        P.append((-0.002 + 0.0065 * math.cos(_deg(d)), 0.0065 + 0.0065 * math.sin(_deg(d))))
    P += [(-0.0015, 0.0135), (0.0, 0.0150)]                  # quirk above the bead
    P += [(0.0, 0.124), (-0.002, 0.124), (-0.002, 0.128)]   # face, step-back fillet
    ru, rv = 0.007, 0.017                                    # cyma reversa, 14 mm back over 34 mm
    for d in (25, 50, 70, 90):                               # ovolo (convex)
        P.append((-0.002 - ru + ru * math.cos(_deg(d)), 0.128 + rv * math.sin(_deg(d))))
    for d in (-115, -140, -160, -180):                       # cove (concave)
        P.append((-0.009 + ru * math.cos(_deg(d)), 0.162 + rv * math.sin(_deg(d))))
    # Top fillet with a small eased arris that ends 0.8 mm in front of the pilaster base blocks
    # (face at u = -0.018): the blocks sit ON the moulding behind a 2 mm fillet reveal.
    P += [(-0.016, 0.1712), (-0.0164, 0.1725), (-0.0172, 0.173), (-0.062, 0.173)]
    return P


def _profile_plinth_cap_simple():
    return [(-0.02, 0.0), (0.004, 0.0), (0.004, 0.034), (0.0025, 0.0385), (-0.0015, 0.04), (-0.02, 0.04)]


def _profile_bead():
    P = [(-0.012, 0.0), (0.0035, 0.0)]
    for d in (-50, -15, 15, 50):
        P.append((0.0035 + 0.0055 * math.cos(_deg(d)), 0.0065 + 0.0055 * math.sin(_deg(d))))
    P += [(0.0035, 0.012), (0.006, 0.012), (0.006, BEAD_H), (-0.012, BEAD_H)]
    return P


def _profile_pilaster_base():
    return [(-0.004, 0.0), (0.006, 0.0), (0.0075, 0.002), (0.008, 0.005), (0.0068, 0.0085), (0.004, 0.0105),
            (0.003, 0.011), (0.003, 0.015), (-0.004, 0.015)]


def _profile_pilaster_cap():
    P = [(-0.004, 0.0), (0.002, 0.0), (0.002, 0.003)]
    for d in (30, 60, 90):
        P.append((0.002 + 0.006 * math.sin(_deg(d)), 0.012 - 0.009 * math.cos(_deg(d))))
    P += [(0.008, 0.016), (-0.004, 0.016)]
    return P


def _profile_arch_bead():
    return [(-0.004, 0.0), (0.004, 0.0), (0.0065, 0.0025), (0.0075, 0.006), (0.0065, 0.0095), (0.004, 0.012),
            (-0.004, 0.012)]


# Open profiles for panel_frame (u outward from the path line, v toward the viewer).
BOARD_FRAME = [(-0.008, 0.004), (-0.008, 0.0062), (-0.0062, 0.0088), (-0.0025, 0.0106), (0.0025, 0.0106),
               (0.0065, 0.0084), (0.0088, 0.0046), (0.010, 0.0)]
BOARD_SLIP = [(-0.0021, 0.004), (-0.0015, 0.0053), (0.0, 0.0061), (0.0015, 0.0053), (0.0021, 0.004)]


# ---------------------------------------------------------------------------
# Run frames and inside-corner detection
# ---------------------------------------------------------------------------

def run_frame(spec):
    """(matrix, length): the Blender world matrix of a run's local frame (x along the run from its
    left end as seen from the front, back on y = 0, front toward -Y, z up from the run's floor)."""
    (ax, az), (bx, bz) = spec["a"], spec["b"]
    y = spec.get("y", 0.0)
    rot = spec["rot"]
    A, B = C.bl(ax, y, az), C.bl(bx, y, bz)
    ux = Vector((math.cos(rot), math.sin(rot), 0.0))
    sa, sb = A.dot(ux), B.dot(ux)
    origin = A if sa <= sb else B
    off = (B - A) - ux * (B - A).dot(ux)
    if off.length > 0.02:
        print(f"[bookcases] warning: {spec['id']} wall line is not perpendicular to rot ({off.length:.3f} m off)")
    return Matrix.Translation(origin) @ Matrix.Rotation(rot, 4, "Z"), abs(sb - sa)


def _plane_s(ux, origin, q_origin, fq):
    """Returns s(d): the along-run coordinate where the plane at distance d in front of q's wall
    crosses this run's axis."""
    c0 = (origin - q_origin).dot(fq)
    c1 = ux.dot(fq)
    return lambda d: (d - c0) / c1


def end_conditions(spec, others):
    """For each end (0 = local x 0, 1 = local x L): free, or an inside corner with another run.
    kind "A": this end butts against the other run's front; kind "B": the other run's end butts
    against our front at this end (we get a dead corner)."""
    M, L = run_frame(spec)
    O = M.translation.copy()
    rot = spec["rot"]
    ux = Vector((math.cos(rot), math.sin(rot), 0.0))
    f = Vector((math.sin(rot), -math.cos(rot), 0.0))
    E = [O, O + ux * L]
    ends = [{"kind": "free"}, {"kind": "free"}]
    for q in others:
        if q["id"] == spec["id"] or abs(q.get("y", 0.0) - spec.get("y", 0.0)) > 0.05:
            continue
        Mq, Lq = run_frame(q)
        Oq = Mq.translation.copy()
        uq = Vector((math.cos(q["rot"]), math.sin(q["rot"]), 0.0))
        fq = Vector((math.sin(q["rot"]), -math.cos(q["rot"]), 0.0))
        if abs(ux.dot(uq)) > 0.1:
            continue
        for k in (0, 1):
            body = ux if k == 0 else -ux
            dist, along = (E[k] - Oq).dot(fq), (E[k] - Oq).dot(uq)
            if abs(dist - q["depth"]) < 0.03 and -0.03 < along < Lq + 0.03 and body.dot(fq) > 0.5:
                ends[k] = {"kind": "A", "h": q["height"], "depth": q["depth"], "s": _plane_s(ux, O, Oq, fq), "q": q["id"]}
                continue
            for kq in (0, 1):
                eq = Oq + uq * (Lq * kq)
                bodyq = uq if kq == 0 else -uq
                dist, along = (eq - O).dot(f), (eq - O).dot(ux)
                if abs(dist - spec["depth"]) < 0.03 and abs(along - (0.0 if k == 0 else L)) < 0.05 and bodyq.dot(f) > 0.5:
                    ends[k] = {"kind": "B", "h": q["height"], "depth": q["depth"], "s": _plane_s(ux, O, Oq, fq), "q": q["id"]}
    return ends


def _plan_runs():
    try:
        import plan
        return plan.BOOKCASES
    except Exception:
        return []


# ---------------------------------------------------------------------------
# Mouldings along the run with end conditions
# ---------------------------------------------------------------------------

def _moulding(name, profile, ld, z0, L, conds, key):
    """Sweeps `profile` along the front line at depth `ld` (z = z0). conds per end:
    ("return",) wraps round the end to the wall, ("mitre", s) is an inside mitre at s,
    ("square", s) stops square at s."""
    off = ld - D_UP
    margin = 0.25
    pts = []
    c0, c1 = conds
    if c0[0] == "return":
        pts += [(-off, 0.0), (-off, -ld)]
    elif c0[0] == "mitre":
        pts += [(c0[1] - margin, -ld)]
    else:
        pts += [(c0[1], -ld)]
    if c1[0] == "return":
        pts += [(L + off, -ld), (L + off, 0.0)]
    elif c1[0] == "mitre":
        pts += [(c1[1] + margin, -ld)]
    else:
        pts += [(c1[1], -ld)]
    bm = _sweep_bm(profile, [(x, y, z0) for x, y in pts])
    if c0[0] == "mitre":
        _bisect_keep(bm, (c0[1], -ld, z0), (1, 1, 0))
    if c1[0] == "mitre":
        _bisect_keep(bm, (c1[1], -ld, z0), (-1, 1, 0))
    return _ob(name, bm, key)


# ---------------------------------------------------------------------------
# Labels: inked card holders, press plaques and the gilt subject board
# ---------------------------------------------------------------------------

ATLAS_COLS, ATLAS_ROWS = 8, 4


def _card_holder(name, w, h, lip=0.004, depth=0.0028, text=None):
    """A brass card frame facing -Y with its back on y = 0, centred on x = z = 0, holding an aged
    ivory card recessed 1 mm behind the lip's face, inked with `text` (a shelf mark) in a
    typewriter face. Returns (brass_ob, card_ob, ink_ob or None)."""
    bm = bmesh.new()
    hw, hh = w / 2, h / 2
    iw, ih = hw - lip, hh - lip
    ob_ = [(-hw, -hh), (hw, -hh), (hw, hh), (-hw, hh)]
    ib_ = [(-iw, -ih), (iw, -ih), (iw, ih), (-iw, ih)]
    y_card = -(depth - 0.001)
    ob_back = [bm.verts.new((x, 0.0, z)) for x, z in ob_]
    ob_front = [bm.verts.new((x * 0.985, -depth, z * 0.96)) for x, z in ob_]
    ib_front = [bm.verts.new((x, -depth, z)) for x, z in ib_]
    ib_back = [bm.verts.new((x, y_card + 0.0001, z)) for x, z in ib_]
    outer, inner = [], []
    for i in range(4):
        j = (i + 1) % 4
        outer.append(bm.faces.new((ob_back[i], ob_back[j], ob_front[j], ob_front[i])))
        outer.append(bm.faces.new((ob_front[i], ob_front[j], ib_front[j], ib_front[i])))
        inner.append(bm.faces.new((ib_front[i], ib_front[j], ib_back[j], ib_back[i])))
    # The back is open (it sits on the joinery). Outer and front faces look away from the plate's
    # centre line; the window's reveals look toward it.
    bm.normal_update()
    ref = Vector((0, 0.002, 0))
    for fc in outer:
        if fc.normal.dot(fc.calc_center_median() - ref) < 0:
            fc.normal_flip()
    for fc in inner:
        c = fc.calc_center_median()
        if fc.normal.dot(Vector((c.x, 0.0, c.z))) > 0:
            fc.normal_flip()
    brass = _ob(name, bm, "brass_aged", 40)
    C.uv_box(brass, size=tex_size("brass_aged"))
    # The card: a thin board behind the window (its back on the joinery, its face 1 mm in).
    card = _bbox(name + "_Card", (-iw - 0.001, y_card, -ih - 0.001), (iw + 0.001, -0.0002, ih + 0.001), "label_card", 0.0)
    C.uv_box(card, size=0.2)
    ink = None
    if text:
        ink, tw, th = _text_mesh(name + "_Ink", text, "label_ink", spacing=1.0, font=_mono_font())
        s = min(0.42 * 2 * ih / th, 0.84 * 2 * iw / tw)
        ink.data.transform(Matrix.Translation((0.0, y_card - 0.00025, 0.0)) @ Matrix.Diagonal((s, s, s, 1.0)))
        C.uv_box(ink, size=0.2)
    return brass, card, ink


SERIF_FONTS = (
    "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
    "/Library/Fonts/Times New Roman.ttf",
    "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "C:/Windows/Fonts/times.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
)
MONO_FONTS = (
    "/System/Library/Fonts/Supplemental/Courier New Bold.ttf",
    "/System/Library/Fonts/Supplemental/Courier New.ttf",
    "C:/Windows/Fonts/courbd.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf",
)


def _load_font(paths):
    for p in paths:
        if os.path.exists(p):
            try:
                return bpy.data.fonts.load(p, check_existing=True)
            except Exception:
                continue
    return None


def _serif_font():
    """A classical serif for the gilt lettering (falls back to Blender's built-in font)."""
    return _load_font(SERIF_FONTS)


def _mono_font():
    """A typewriter face for the inked shelf marks."""
    return _load_font(MONO_FONTS)


def _text_mesh(name, text, key, spacing=1.14, font=None):
    """Flat lettering in the XZ plane facing -Y, centred on its own bounding box (size 1)."""
    cu = bpy.data.curves.new(name, type="FONT")
    cu.body = text
    font = font or _serif_font()
    if font is not None:
        cu.font = font
    cu.size = 1.0
    cu.resolution_u = 1
    cu.space_character = spacing
    cu.align_x = "CENTER"
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    me.name = name
    me.transform(Matrix.Rotation(math.pi / 2, 4, "X"))
    xs = [v.co.x for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    me.transform(Matrix.Translation((-(min(xs) + max(xs)) / 2, 0.0, -(min(zs) + max(zs)) / 2)))
    for p in me.polygons:
        if p.normal.y > 0:
            p.flip()
    me.materials.clear()
    me.materials.append(mat(key))
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    C.shade_flat(ob)
    return ob, max(xs) - min(xs), max(zs) - min(zs)


def _plaque(prefix, text, xc, zc, H, face_y, max_w, wood, parts, rng, framed=True, width=None, cap=0.40):
    """A painted plaque in the frieze, after Ref 2: a dark field standing 4 mm proud of the frieze
    face (plane y = face_y), a gilt slip and gilt Roman capitals, centred at (xc, zc).
    framed=True adds a moulded walnut frame (the subject board); `width` fixes the width (press
    plaques), otherwise it follows the text up to `max_w`. Returns the plaque width."""
    txt, tw, th = _text_mesh(prefix + "_Text", text.upper(), "gilt")
    pad = 0.062 if framed else 0.03
    s = cap * H / max(th, 1e-6)
    W = width if width is not None else min(max_w, tw * s + 2 * pad)
    if tw * s > W - 2 * pad:
        s = (W - 2 * pad) / tw
    field_v = 0.004
    txt.data.transform(Matrix.Translation((xc, face_y - field_v - 0.0004, zc - 0.002 * H / 0.116))
                       @ Matrix.Diagonal((s, s, s, 1.0)))
    C.uv_box(txt, size=0.3)
    parts["gilt"].append(txt)
    inset = 0.004 if framed else 0.0
    fld = _bbox(prefix + "_Field", (xc - W / 2 + inset, face_y - field_v, zc - H / 2 + inset),
                (xc + W / 2 - inset, face_y + 0.001, zc + H / 2 - inset), "signage", 0.0008, 1)
    C.uv_box(fld, size=0.5)
    parts["paint"].append(fld)
    if framed:
        fr = C.panel_frame(prefix + "_Frame", W - 0.02, H - 0.02, BOARD_FRAME, mat(wood))
        C.transform_mesh(fr, Matrix.Translation((xc, face_y, zc)))
        parts["wood"].append(_uv_frame(fr, wood, xc, zc, W, H, rng))
    slip_in = 0.044 if framed else 0.016
    sl = C.panel_frame(prefix + "_Slip", W - slip_in, H - slip_in, BOARD_SLIP, mat("gilt"))
    C.transform_mesh(sl, Matrix.Translation((xc, face_y, zc)))
    C.uv_box(sl, size=0.3)
    parts["gilt"].append(sl)
    return W


def _shelf_marks(spec, n):
    """(per-bay shelf-mark ranges, whole-run range) for a run's `n` bays: the subject's class
    letters and rising class numbers, deterministic per run."""
    subj = (spec.get("subject") or "").strip().lower()
    rng = random.Random(_crc("marks", spec["id"]))
    cls = CLASS_MARKS.get(subj) or GENERIC_MARKS[_crc(spec["id"]) % len(GENERIC_MARKS)]
    if cls == "QA76":
        cls, a, step = "QA", 76, (0.5, 1.2)
    else:
        a, step = rng.choice((1, 1, 5, 10, 21, 101, 140)), (12, 90)
    out = []
    for _ in range(n):
        if isinstance(a, float) or step[0] < 1:
            b = round(a + rng.uniform(*step), 1)
            out.append(f"{cls} {a:g}-{b:g}")
            a = round(b + 0.1, 1)
        else:
            b = a + rng.randint(int(step[0]), int(step[1]))
            out.append(f"{cls} {a}-{b}")
            a = b + 1
    first = out[0].split(" ", 1)[1].split("-")[0] if out else "1"
    last = out[-1].split("-")[-1] if out else "99"
    return out, f"{cls} {first}-{last}"


def _place(ob, matrix):
    C.transform_mesh(ob, matrix)
    return ob


# ---------------------------------------------------------------------------
# The bookcase run
# ---------------------------------------------------------------------------

def _shelf_levels(zb, z_t, bottom_pitch):
    span = z_t - zb
    rest = span - bottom_pitch
    n = max(1, round(rest / 0.345))
    pitch = rest / n
    return [zb] + [zb + bottom_pitch + i * pitch for i in range(n)]


def _uprights(s_lo, s_hi, bay):
    n = max(1, round((s_hi - s_lo) / bay))
    total = 2 * END_T + (n - 1) * UP_T
    w = (s_hi - s_lo - total) / n
    ups = [(s_lo, s_lo + END_T, "end0")]
    x = s_lo + END_T
    for _ in range(n - 1):
        x += w
        ups.append((x, x + UP_T, "mid"))
        x += UP_T
    ups.append((s_hi - END_T, s_hi, "end1"))
    return ups


def _fluted_shaft(name, a, b, back, face, z0, z1, key, flutes=3, stop=0.05, depth_k=0.6, n_arc=6, m_cap=2,
                  ch=0.0015):
    """A pilaster shaft (x a..b, y back..face, z z0..z1) with `flutes` STOPPED flutes on its front:
    elliptical grooves (depth depth_k * r) that end `stop` short of the shaft ends in rounded,
    spoon-shaped stops (quarter ellipsoids), flanked by fillets, with eased (chamfered) arrises.
    Built as one closed manifold: the face plane is split into a lower and an upper polygon (each
    following the flute ends) and quads between the flutes, sharing every rim vertex with the
    grooves, so there are no cracks, folds or inverted faces."""
    inner = (b - a) - 2 * ch
    r = inner / (2 * (1.0 + flutes + 0.36 * (flutes - 1)))
    fil = 0.72 * r
    edge = r
    zA, zB = z0 + stop + r, z1 - stop - r
    bm = bmesh.new()
    ZS = (z0, zA, zB, z1)
    outline = [(a, back), (a, face + ch), (a + ch, face), (b - ch, face), (b, face + ch), (b, back)]
    col = [[bm.verts.new((x, y, z)) for z in ZS] for (x, y) in outline]
    F = bm.faces.new
    for i in (0, 1, 3, 4, 5):
        j = (i + 1) % 6
        for s in range(3):
            F((col[i][s], col[j][s], col[j][s + 1], col[i][s + 1]))
    F([col[i][0] for i in range(6)])
    F([col[i][3] for i in range(6)])
    th = [math.pi * j / (n_arc - 1) for j in range(n_arc)]

    def ring(xc, z, cphi=1.0, dz=0.0):
        return [bm.verts.new((xc - r * math.cos(t) * cphi, face + depth_k * r * math.sin(t) * cphi, z + dz)) for t in th]

    def cap(xc, base, zc, sgn):
        rings = [base]
        for m in range(1, m_cap):
            phi = (math.pi / 2) * m / m_cap
            rings.append(ring(xc, zc, math.cos(phi), sgn * r * math.sin(phi)))
        apex = bm.verts.new((xc, face, zc + sgn * r))
        for ra, rb in zip(rings, rings[1:]):
            for j in range(n_arc - 1):
                F((ra[j], ra[j + 1], rb[j + 1], rb[j]))
        for j in range(n_arc - 1):
            F((rings[-1][j], rings[-1][j + 1], apex))
        # Rim in the face plane: from the theta = 0 side (x - r) round the stop to x + r.
        return [rg[0] for rg in rings] + [apex] + [rg[-1] for rg in reversed(rings)]

    fl = []
    for i in range(flutes):
        xc = a + ch + edge + r + i * (2 * r + fil)
        rA, rB = ring(xc, zA), ring(xc, zB)
        for j in range(n_arc - 1):
            F((rA[j], rA[j + 1], rB[j + 1], rB[j]))
        fl.append((rA, rB, cap(xc, rA, zA, -1), cap(xc, rB, zB, +1)))
    lower = [col[2][0], col[3][0], col[3][1]]
    for rA, rB, rimA, rimB in reversed(fl):
        lower += list(reversed(rimA))
    lower.append(col[2][1])
    F(lower)
    upper = [col[2][3], col[2][2]]
    for rA, rB, rimA, rimB in fl:
        upper += rimB
    upper += [col[3][2], col[3][3]]
    F(upper)
    F((col[2][1], fl[0][0][0], fl[0][1][0], col[2][2]))
    for (rA0, rB0, _, _), (rA1, rB1, _, _) in zip(fl, fl[1:]):
        F((rA0[-1], rA1[0], rB1[0], rB0[-1]))
    F((fl[-1][0][-1], col[3][1], col[3][2], fl[-1][1][-1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _ob(name, bm, key, 40)


def _pilaster(prefix, x0, x1, zbase, z_t, st, flush, parts, rng, ext=0.0):
    """Fluted pilaster faced on an upright between x0 and x1, its base block seated on the plinth
    moulding at `zbase`. flush: None, "left" or "right" (an end pilaster whose outer face is flush
    with the case end; `ext` pushes that face a little further out, to lap a corner stile)."""
    w = st["pilaster"]
    if flush == "left":
        a, b = x0 - ext, x0 + w
    elif flush == "right":
        a, b = x1 - w, x1 + ext
    else:
        xc = (x0 + x1) / 2
        a, b = xc - w / 2, xc + w / 2
    back = -(D_UP - 0.005)
    face = -D_PIL
    gx = PIL_BASE_PROJ
    ga = a if flush == "left" else a - gx
    gb = b if flush == "right" else b + gx
    wood = st["wood"]
    # Base block and torus.
    zb1 = zbase + 0.07
    blk = _bbox(prefix + "_Base", (ga, face - gx, zbase - 0.001), (gb, back, zb1), wood, 0.0025)
    parts["wood"].append(_uv(blk, wood, "x", rng))

    def ring_path(z):
        p = []
        if flush != "left":
            p.append((a, back, z))
        p += [(a, face, z), (b, face, z)]
        if flush != "right":
            p.append((b, back, z))
        return p
    prof_b = _profile_pilaster_base()
    tor = _ob(prefix + "_Torus", _sweep_bm(prof_b, ring_path(zb1)), wood, 40)
    parts["wood"].append(_uv(tor, wood, "x", rng))
    zs0 = zb1 + max(v for _, v in prof_b)
    # Capital: ovolo and abacus.
    za0 = z_t - 0.035
    prof_c = _profile_pilaster_cap()
    zc0 = za0 - max(v for _, v in prof_c)
    cap = _ob(prefix + "_Ovolo", _sweep_bm(prof_c, ring_path(zc0)), wood, 40)
    parts["wood"].append(_uv(cap, wood, "x", rng))
    ga2 = a if flush == "left" else a - 0.009
    gb2 = b if flush == "right" else b + 0.009
    aba = _bbox(prefix + "_Abacus", (ga2, face - 0.009, za0), (gb2, back, z_t), wood, 0.0025)
    parts["wood"].append(_uv(aba, wood, "x", rng))
    # Shaft with three stopped flutes.
    shaft = _fluted_shaft(prefix + "_Shaft", a, b, back, face, zs0, zc0, wood)
    parts["wood"].append(_uv(shaft, wood, "z", rng))


def _arch_head(prefix, x0, x1, z_t, st, parts, rng):
    """A shallow segmental arch (spandrel board) heading a bay, with a bead on its soffit edge,
    like the arcaded presses of Ref 2."""
    wood = st["wood"]
    w = x1 - x0
    rise = min(0.16, w * 0.17)
    z_spring = z_t - BEAD_H - rise - 0.035
    top = z_t - BEAD_H + 0.002
    pts = C.arch_points(w, z_spring, steps=12, center_x=(x0 + x1) / 2, rise=rise)
    outline = [(x1, top), (x0, top)] + [(x, z) for x, z in pts]
    # Spandrel board in the XZ plane between y = -(D_UP - 0.024) and -(D_UP - 0.006).
    bm = bmesh.new()
    yb, yf = -(D_UP - 0.024), -(D_UP - 0.006)
    fr = [bm.verts.new((x, yf, z)) for x, z in outline]
    bk = [bm.verts.new((x, yb, z)) for x, z in outline]
    m = len(outline)
    for j in range(m):
        k = (j + 1) % m
        bm.faces.new((fr[j], fr[k], bk[k], bk[j]))
    bm.faces.new(fr)
    bm.faces.new(list(reversed(bk)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    sp = _ob(prefix + "_Spandrel", bm, wood, 30)
    parts["wood"].append(_uv(sp, wood, "x", rng))
    # Bead along the soffit, in the plane of the board face (path in XZ, up = -Y so u is inward).
    path = [(x, yf + 0.0005, z) for x, z in pts]
    bead = _ob(prefix + "_ArchBead", _sweep_bm(_profile_arch_bead(), path, up=(0, -1, 0)), wood, 40)
    parts["wood"].append(_uv(bead, wood, "x", rng))
    # Keystone.
    xc = (x0 + x1) / 2
    zk = z_spring + rise
    ks = _bbox(prefix + "_Key", (xc - 0.022, yf - 0.012, zk - 0.03), (xc + 0.022, yf + 0.004, top - 0.002), wood, 0.0025)
    parts["wood"].append(_uv(ks, wood, "z", rng))
    return z_spring


def _back_boards(name, L, z0, z1, key, board=0.135):
    """Tongue-and-groove back: a front surface with V-grooves (only the visible face)."""
    n = max(1, round(L / board))
    bw = L / n
    xs = []
    for i in range(n + 1):
        xb = i * bw
        if 0 < i < n:
            xs += [(xb - 0.0028, -BACK_T), (xb, -BACK_T + 0.003), (xb + 0.0028, -BACK_T)]
        else:
            xs.append((xb, -BACK_T))
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in xs]
    hi = [bm.verts.new((x, y, z1)) for x, y in xs]
    for i in range(len(xs) - 1):
        bm.faces.new((lo[i], lo[i + 1], hi[i + 1], hi[i]))
    bm.normal_update()
    for fc in bm.faces:
        if fc.normal.y > 0:
            fc.normal_flip()
    ob = C.mesh_from_bmesh(name, bm, mat(key))
    C.shade_smooth(ob, 30)
    return ob


def build_bookcase_run(spec, neighbours=None, seed=0):
    """Builds one plan bookcase run in place. Returns (objects, slots).

    objects: [root empty, then the _Wood, _Back, _Brass, _Labels (cards), _LabelInk, _Plaque
    (painted fields) and _Gilt meshes] (missing parts omitted); meshes are in the run's local
    frame, parented to the root which carries the world placement (run_frame).

    slots: one dict per shelf bay: start/end (m along the run, local x), y (shelf top above the
    run floor), depth (usable, from the shelf front to the back boards), clear_height, front
    (local y of the shelf front, negative), matrix (Blender world matrix of the local frame),
    plus run, bay, shelf, style, bottom (True for the tall bottom bay) and arched (True for the
    top bay behind an arch head)."""
    st = STYLES.get(spec.get("style", "hall"), STYLES["hall"])
    frame, L = run_frame(spec)
    H = spec["height"]
    others = _plan_runs() if neighbours is None else neighbours
    ends = end_conditions(spec, others)
    rng = random.Random(_crc(spec["id"], seed))
    wood, back = st["wood"], st["back"]
    rich = st["rich"]
    PL = PLINTH_RICH if rich else PLINTH_SIMPLE
    dpl, zb, up0 = PL["face"], PL["zb"], PL["up0"]
    parts = {"wood": [], "back": [], "brass": [], "paper": [], "ink": [], "paint": [], "gilt": []}
    rid = spec["id"]

    crown = _profile_cornice_rich(st["crown"]) if rich else _profile_cornice_simple(st["crown"])
    cornice_h = max(v for _, v in crown)
    z_cor = H - cornice_h
    z_t = z_cor - st["frieze"]
    bead_h = BEAD_H if rich else 0.0

    # --- end conditions -> moulding ends, bay limits ------------------------------------
    def conds_for(ld, crown_part):
        out = []
        for k in (0, 1):
            e = ends[k]
            s_end = 0.0 if k == 0 else L
            if e["kind"] == "free":
                out.append(("return",))
                continue
            same = abs(e["h"] - H) < 0.03
            if not crown_part or same:
                out.append(("mitre", e["s"](ld)))
            elif e["kind"] == "A":
                out.append(("return",) if H > e["h"] else ("square", s_end))
            else:  # B
                out.append(("square", e["s"](e["depth"])) if e["h"] > H else ("square", s_end))
        return out

    s_lo = ends[0]["s"](ends[0]["depth"]) if ends[0]["kind"] == "B" else 0.0
    s_hi = ends[1]["s"](ends[1]["depth"]) if ends[1]["kind"] == "B" else L
    ups = _uprights(s_lo, s_hi, st["bay"])
    levels = _shelf_levels(zb, z_t, st["bottom"])
    marks, run_mark = _shelf_marks(spec, len(ups) - 1)

    # --- plinth --------------------------------------------------------------------------
    pc = conds_for(dpl, False)
    if rich:
        pl = _moulding(f"{rid}_Plinth", _profile_plinth_rich(), dpl, 0.0, L, pc, wood)
        parts["wood"].append(_uv(pl, wood, "x", rng))
    else:
        ph = PL["top"] - 0.04
        prof_pl = [(-0.03, 0.0), (0.0, 0.0), (0.0, ph), (-0.03, ph)]
        pl = _moulding(f"{rid}_Plinth", prof_pl, dpl, 0.0, L, pc, wood)
        parts["wood"].append(_uv(pl, wood, "x", rng))
        cap = _moulding(f"{rid}_PlinthCap", _profile_plinth_cap_simple(), dpl, ph, L, pc, wood)
        parts["wood"].append(_uv(cap, wood, "x", rng))

    # --- uprights, end panels ------------------------------------------------------------
    for i, (x0, x1, kind) in enumerate(ups):
        if kind == "mid":
            ob = _bbox(f"{rid}_Upright_{i:02d}", (x0, -D_UP, up0), (x1, -BACK_T, z_t), wood,
                       0.003 if rich else 0.006, 1 if rich else 2)
        else:
            k = 0 if kind == "end0" else 1
            at_case_end = ends[k]["kind"] != "B"
            z_hi = z_cor if at_case_end else z_t
            y_back = 0.0 if at_case_end else -BACK_T
            z_lo = 0.0 if at_case_end else up0
            # An end butting a neighbour's front comes forward to the pilaster face.
            y_front = -(D_PIL - 0.001) if (ends[k]["kind"] == "A" and rich) else -D_UP
            ob = _bbox(f"{rid}_End_{i:02d}", (x0, y_front, z_lo), (x1, y_back, z_hi), wood,
                       0.003 if rich else 0.006, 1 if rich else 2)
        parts["wood"].append(_uv(ob, wood, "z", rng))

    # Dead corners (kind B): close the cavity behind the butting run.
    for k in (0, 1):
        e = ends[k]
        if e["kind"] != "B":
            continue
        xw0, xw1 = (0.0, END_T) if k == 0 else (L - END_T, L)
        ob = _bbox(f"{rid}_DeadEnd_{k}", (xw0, -D_UP, 0.0), (xw1, 0.0, z_cor), wood, 0.002)
        parts["wood"].append(_uv(ob, wood, "z", rng))
        dx0, dx1 = (END_T, s_lo) if k == 0 else (s_hi, L - END_T)
        ob = _bbox(f"{rid}_DeadFloor_{k}", (dx0, -D_UP, 0.0), (dx1, -BACK_T, 0.018), wood, 0.0)
        parts["wood"].append(_uv(ob, wood, "x", rng))
        # Corner stile: fills the re-entrant angle between the neighbour's end pilaster and ours
        # (the old 2 mm seam into the cavity), from the plinth to the cornice.
        xa_, xb_ = sorted((e["s"](D_UP - 0.004), e["s"](D_PIL + 0.0012)))
        ob = _bbox(f"{rid}_CornerStile_{k}", (xa_, -(D_PIL + 0.0012), PL["top"] - 0.002), (xb_, -(D_UP - 0.004), z_cor),
                   wood, 0.0012)
        parts["wood"].append(_uv(ob, wood, "z", rng))
        if e["h"] < H - 0.03:   # neighbour is lower: face the dead corner above it
            xa, xb = (END_T, s_lo) if k == 0 else (s_hi, L - END_T)
            fp = _bbox(f"{rid}_DeadFace_{k}", (xa, -D_UP, e["h"]), (xb, -(D_UP - 0.02), z_t), wood, 0.002)
            parts["wood"].append(_uv(fp, wood, "z", rng))

    # Panelled ends (free ends only): applied stiles and rails.
    for k in (0, 1):
        if ends[k]["kind"] != "free":
            continue
        sgn = -1 if k == 0 else 1
        xf = 0.0 if k == 0 else L
        t = 0.012
        xa, xb = (xf - t, xf) if k == 0 else (xf, xf + t)
        mw = 0.06
        zr0, zr1 = zb + 0.02, z_t - 0.04
        zmid = min(1.05, zb + (zr1 - zb) * 0.3)
        members = [
            ((xa, -D_UP + 0.012, zr0), (xb, -D_UP + 0.012 + mw, zr1)),
            ((xa, -0.012 - mw, zr0), (xb, -0.012, zr1)),
            ((xa, -D_UP + 0.012 + mw, zr0), (xb, -0.012 - mw, zr0 + mw)),
            ((xa, -D_UP + 0.012 + mw, zmid - mw / 2), (xb, -0.012 - mw, zmid + mw / 2)),
            ((xa, -D_UP + 0.012 + mw, zr1 - mw), (xb, -0.012 - mw, zr1)),
        ]
        for j, (lo, hi) in enumerate(members):
            ob = _bbox(f"{rid}_EndFrame_{k}_{j}", lo, hi, wood, 0.003)
            parts["wood"].append(_uv(ob, wood, "z" if j < 2 else "y", rng))
        # Raised fields inside the frame.
        for j, (za, zb_) in enumerate(((zr0 + mw, zmid - mw / 2), (zmid + mw / 2, zr1 - mw))):
            fa, fb = (xf - 0.008, xf) if k == 0 else (xf, xf + 0.008)
            ob = _bbox(f"{rid}_EndField_{k}_{j}", (fa, -D_UP + 0.012 + mw + 0.02, za + 0.02),
                       (fb, -0.012 - mw - 0.02, zb_ - 0.02), wood, 0.003)
            parts["wood"].append(_uv(ob, wood, "z", rng))
        if rich and spec.get("subject"):
            br, cd, ink = _card_holder(f"{rid}_RangeCard_{k}", 0.13, 0.046, lip=0.005, depth=0.003,
                                       text=run_mark.split(" ")[0])
            mtx = Matrix.Translation((xf + sgn * t, -D_UP / 2, 1.45)) @ Matrix.Rotation(_deg(-90 * sgn), 4, "Z")
            parts["brass"].append(_place(br, mtx))
            parts["paper"].append(_place(cd, mtx))
            parts["ink"].append(_place(ink, mtx))

    # --- back boards, top, frieze, bead, cornice ------------------------------------------
    parts["back"].append(_uv(_back_boards(f"{rid}_Back", L, 0.0, z_t + 0.01, back), back, "z", rng))
    xa = END_T if ends[0]["kind"] != "B" else 0.0
    xb = L - END_T if ends[1]["kind"] != "B" else L
    top = _bbox(f"{rid}_TopBoard", (xa, -(D_UP - 0.02), z_t), (xb, -BACK_T, z_t + 0.022), wood, 0.0)
    parts["wood"].append(_uv(top, wood, "x", rng))
    # The lid: carried over an inside corner (kind A, equal heights) to meet the other run's lid.
    lx = [0.0, L]
    for k in (0, 1):
        e = ends[k]
        if e["kind"] == "A" and abs(e["h"] - H) < 0.03:
            lx[k] = e["s"](D_UP - 0.012)
    lid = _bbox(f"{rid}_Lid", (min(lx), -(D_UP - 0.012), H - 0.02), (max(lx), 0.0, H - 0.001), wood, 0.0)
    parts["wood"].append(_uv(lid, wood, "x", rng))
    fr = _bbox(f"{rid}_Frieze", (xa, -D_UP, z_t), (xb, -(D_UP - 0.02), z_cor), wood, 0.0)
    parts["wood"].append(_uv(fr, wood, "x", rng))
    cc = conds_for(D_UP, True)
    if rich:
        bd = _moulding(f"{rid}_Bead", _profile_bead(), D_UP, z_t - BEAD_H, L, cc, wood)
        parts["wood"].append(_uv(bd, wood, "x", rng))
    cor = _moulding(f"{rid}_Cornice", crown, D_UP, z_cor, L, cc, wood)
    parts["wood"].append(_uv(cor, wood, "x", rng))

    # --- subject board in the frieze -------------------------------------------------------
    board = None
    if rich and spec.get("subject"):
        bh = st["frieze"] - 0.034
        xc = (s_lo + s_hi) / 2
        nb = len(ups) - 1
        max_w = min(0.62, (ups[1][0] - ups[0][1]) * 0.9) if nb % 2 else min(0.62, 2 * (st["bay"] - 0.2))
        bw = _plaque(f"{rid}_Board", spec["subject"], xc, (z_t + z_cor) / 2, bh, -D_UP, max_w, wood, parts, rng)
        board = (xc - bw / 2 - 0.05, xc + bw / 2 + 0.05)

    # --- bays: shelves, pilasters, arches, labels ----------------------------------------
    slots = []
    label_shelf = min(range(1, len(levels)), key=lambda i: abs(levels[i] - 1.25)) if len(levels) > 1 else 0
    for bi in range(len(ups) - 1):
        x0, x1 = ups[bi][1], ups[bi + 1][0]
        for k, z in enumerate(levels):
            if k == 0:
                ob = _bbox(f"{rid}_B{bi}_Shelf0", (x0 - 0.006, -(D_UP - 0.01), z - SHELF_T), (x1 + 0.006, -BACK_T, z), wood, 0.0)
                parts["wood"].append(_uv(ob, wood, "x", rng))
            else:
                ob = _bbox(f"{rid}_B{bi}_Shelf{k}", (x0 - 0.006, -(D_SHELF - BAND_D), z - SHELF_T), (x1 + 0.006, -BACK_T, z), wood, 0.0)
                parts["wood"].append(_uv(ob, wood, "x", rng))
                zb_ = z - BAND_H
                zm = zb_ + BAND_H * 0.42
                yf, yb = -D_SHELF, -(D_SHELF - BAND_D)
                yz = [(yb, zb_), (yf + 0.002, zb_), (yf, zb_ + 0.002), (yf, zm - 0.002), (yf + 0.0016, zm), (yf, zm + 0.002),
                      (yf, z - 0.004), (yf + 0.0012, z - 0.0012), (yf + 0.004, z), (yb, z)]
                band = _extrude_x(f"{rid}_B{bi}_Band{k}", yz, x0, x1, wood, 40)
                parts["wood"].append(_uv(band, wood, "x", rng))
                if rich and k == label_shelf:
                    br, cd, ink = _card_holder(f"{rid}_B{bi}_ShelfLabel", 0.07, 0.024, lip=0.0035, depth=0.0024,
                                               text=marks[bi])
                    mtx = Matrix.Translation(((x0 + x1) / 2, yf, zb_ + BAND_H / 2))
                    parts["brass"].append(_place(br, mtx))
                    parts["paper"].append(_place(cd, mtx))
                    parts["ink"].append(_place(ink, mtx))
            nxt = levels[k + 1] - BAND_H if k + 1 < len(levels) else z_t - bead_h
            slots.append({
                "run": rid, "bay": bi, "shelf": k, "style": spec.get("style", "hall"),
                "start": x0, "end": x1, "y": z, "front": -D_SHELF if k else -(D_UP - 0.01),
                "depth": (D_SHELF if k else D_UP - 0.01) - BACK_T,
                "clear_height": nxt - z, "bottom": k == 0, "arched": False, "matrix": frame.copy(),
            })
        if rich and st.get("arches"):
            zsp = _arch_head(f"{rid}_B{bi}", x0, x1, z_t, st, parts, rng)
            top_slot = slots[-1]
            # Books in the arched top bay stand behind the spandrel board (whose back is at
            # -(D_UP - 0.024)) and stay a little above the springing, hidden at the haunches.
            top_slot["front"] = -(D_UP - 0.025)
            top_slot["depth"] = (D_UP - 0.025) - BACK_T
            top_slot["clear_height"] = min(top_slot["clear_height"], zsp + 0.06 - top_slot["y"])
            top_slot["arched"] = True
        if rich and st.get("plaque"):
            # Press plaque: the bay's Roman numeral in gilt on a dark field (bays the subject
            # board covers go without).
            xm = (x0 + x1) / 2
            lw, lh = st["plaque"]
            if board is None or not (board[0] < xm + lw / 2 and xm - lw / 2 < board[1]):
                _plaque(f"{rid}_B{bi}_Press", ROMAN[bi % len(ROMAN)], xm, (z_t + z_cor) / 2, lh, -D_UP, lw, wood,
                        parts, rng, framed=False, width=lw, cap=0.54)
    if rich and st["pilaster"] > 0:
        for i, (x0, x1, kind) in enumerate(ups):
            flush = {"end0": "left", "end1": "right"}.get(kind)
            k = {"end0": 0, "end1": 1}.get(kind)
            ext = 0.0025 if (k is not None and ends[k]["kind"] == "B") else 0.0
            _pilaster(f"{rid}_Pil{i:02d}", x0, x1, PL["top"], z_t, st, flush, parts, rng, ext)

    # --- join per material, place, collect ------------------------------------------------
    col = C.collection("Shelves", C.collection(ROOT_COL))
    style_name = spec.get("style", "hall").capitalize()
    root = C.empty(f"Shelf_{style_name}_{rid}", col=col, size=0.5)
    root.matrix_world = frame
    out = [root]
    for key, suffix in (("wood", "Wood"), ("back", "Back"), ("brass", "Brass"), ("paper", "Labels"),
                        ("ink", "LabelInk"), ("paint", "Plaque"), ("gilt", "Gilt")):
        if not parts[key]:
            continue
        ob = C.join(parts[key], f"Shelf_{style_name}_{rid}_{suffix}")
        C.move_to(ob, col)
        ob.parent = root
        ob.matrix_parent_inverse = Matrix.Identity(4)
        ob.matrix_basis = Matrix.Identity(4)
        out.append(ob)
    root["ovr_kind"] = "bookcase"
    root["ovr_length"] = L
    root["ovr_slots"] = len(slots)
    return out, slots


# ---------------------------------------------------------------------------
# Book variants
# ---------------------------------------------------------------------------

ATLAS_INSET = 0.01             # fraction of a cell kept clear at its edges (the outer 3 % is plain cloth)
PATCH = (0.004, 0.024, 0.30, 0.70)  # cell-relative (u0, u1, v0, v1) of plain cloth for covers/edges

# Construction per shape: base size (H, D, nominal T) in metres, spine bulge, joint grooves,
# spine arc resolution. Raised bands come from the atlas row (see _bands_for). Each variant
# overrides T with its thickness class.
SHAPES = {
    "cloth": dict(H=0.235, D=0.160, T=0.032, bulge=0.0045, groove=True, arc=9),
    "library": dict(H=0.245, D=0.170, T=0.030, bulge=0.0022, groove=True, arc=7),
    "leather": dict(H=0.250, D=0.170, T=0.040, bulge=0.0060, groove=False, arc=5),
    "halfcalf": dict(H=0.240, D=0.165, T=0.036, bulge=0.0055, groove=False, arc=7),
    "folio": dict(H=0.360, D=0.265, T=0.046, bulge=0.0045, groove=True, arc=7),
    "folio_banded": dict(H=0.360, D=0.265, T=0.050, bulge=0.0060, groove=False, arc=5),
    "paperback": dict(H=0.180, D=0.112, T=0.020),
    "reference": dict(H=0.280, D=0.210, T=0.072, bulge=0.0095, groove=True, arc=7),
    "archival": dict(H=0.262, D=0.320, T=0.105),
    "bookend": dict(H=0.175, D=0.13, T=0.004),
}
# Fill categories -> the shapes that serve them.
CATEGORY = {"cloth": "cloth", "library": "cloth", "leather": "leather", "halfcalf": "leather",
            "folio": "folio", "folio_banded": "folio", "paperback": "paperback", "reference": "reference",
            "archival": "archival", "bookend": "bookend"}


THIN, THICK = 0.86, 1.16      # thickness classes relative to the atlas cell's design thickness


def _variant_list():
    """(name, shape, atlas cell (col, row), thickness) per variant; the index is the variant id.
    Atlas rows (textures.py, V bottom to top): 0 antique calf with raised bands, 1 cloth with gilt
    rules and a title block, 2 reference volumes / folios / half-calf panels, 3 paperbacks,
    archival boxes and library bindings. Every cell is painted for its shape's nominal T x H
    (textures.CELL_MM); a cell gets a THIN + design class or a design + THICK class (alternating
    by column, so neighbouring designs differ in thickness too), or the design class alone."""
    V = []

    def add(base, shape, cell, classes):
        Td = SHAPES[shape]["T"]
        for k in classes:
            tag = {THIN: "t", 1.0: "m", THICK: "k"}[k]
            V.append((f"{base}_{tag}", shape, cell, round(Td * k, 4)))

    pair = lambda c: (THIN, 1.0) if c % 2 == 0 else (1.0, THICK)   # noqa: E731
    for c in range(6):
        add(f"leather_{c}", "leather", (c, 0), pair(c))
    add("folio_banded_0", "folio_banded", (6, 0), (THIN, 1.0))
    add("folio_banded_1", "folio_banded", (7, 0), (1.0,))
    for c in range(8):
        add(f"cloth_{c}", "cloth", (c, 1), pair(c))
    add("reference_0", "reference", (0, 2), (THIN, 1.0))
    add("reference_1", "reference", (1, 2), (1.0,))
    add("reference_2", "reference", (2, 2), (1.0, THICK))
    add("folio_0", "folio", (3, 2), (THIN, 1.0))
    add("folio_1", "folio", (4, 2), (1.0, THICK))
    for c in range(5, 8):
        add(f"halfcalf_{c - 5}", "halfcalf", (c, 2), pair(c + 1))
    for c in range(4):
        add(f"paperback_{c}", "paperback", (c, 3), pair(c))
    add("archival_0", "archival", (4, 3), (THIN, 1.0))
    add("archival_1", "archival", (5, 3), (1.0,))
    add("library_0", "library", (6, 3), (THIN, 1.0))
    add("library_1", "library", (7, 3), (1.0, THICK))
    V.append(("bookend", "bookend", None, 0.004))
    return V


VARIANTS = _variant_list()
BOOKEND = len(VARIANTS) - 1
SHAPE_VARIANTS = {}
for _i, (_n, _s, _c, _t) in enumerate(VARIANTS):
    SHAPE_VARIANTS.setdefault(CATEGORY[_s], []).append(_i)
VDIMS = [(SHAPES[s]["H"], SHAPES[s]["D"], t) for (_n, s, _c, t) in VARIANTS]


def _art_scale(v):
    """(f, g) of a variant: f = its thickness over the cell's design thickness, g = the share of
    the cell's width its spine shows (sqrt(f) for thin books - 7 % condensed, the plain margin
    cropped - and f for thick ones, whose extra width runs onto the plain margin)."""
    _n, shape, cell, T = VARIANTS[v]
    if cell is None:
        return 1.0, 1.0
    f = T / SHAPES[shape]["T"]
    return f, (math.sqrt(f) if f < 1.0 else f)


def art_aspect(v, scale):
    """How much an instance's spine art is widened (> 1) or condensed (< 1) relative to the
    painted cell, for a record's (sx, sy, sz) scale."""
    f, g = _art_scale(v)
    return f / g * scale[0] / scale[2]


_ATLAS_BANDS = None


def _atlas_bands():
    """Raised-band positions (fraction of spine height) of the row-0 atlas cells. textures.py
    paints 4 or 5 bands at linspace(0.16, 0.86, n), each between gilt rules at +-0.028; the count
    is read from the atlas by testing both layouts on the interior rules (window maximum against
    the cell's median), so the modelled bands always sit on the painted ones."""
    global _ATLAS_BANDS
    if _ATLAS_BANDS is not None:
        return _ATLAS_BANDS
    out = {}
    path = os.path.join(C.TEXTURES, "book_spines_color.png")
    if os.path.exists(path):
        import numpy as np
        img = bpy.data.images.load(path, check_existing=True)
        w, h = img.size
        px = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        lum = px.reshape(h, w, 4)[..., :3].mean(axis=2)     # row 0 = bottom (V = 0)
        cw, chh = w // ATLAS_COLS, h // ATLAS_ROWS
        win = max(2, int(round(chh * 0.006)))
        for c in range(ATLAS_COLS):
            prof = lum[0:chh, c * cw + int(cw * 0.2):c * cw + int(cw * 0.8)].mean(axis=1)
            med = float(np.median(prof))

            def peak(p):
                i = int(round(p * chh - 0.5))
                return float(prof[max(0, i - win):min(chh, i + win + 1)].max()) - med
            score = {}
            for nb in (4, 5):
                pos = np.linspace(0.16, 0.86, nb)
                score[nb] = float(np.mean([peak(p + o) for p in pos[1:-1] for o in (-0.028, 0.028)]))
            nb = max(score, key=score.get)
            out[c] = tuple(float(x) for x in np.linspace(0.16, 0.86, nb))
    _ATLAS_BANDS = out
    return out


def _bands_for(cell):
    if cell is None:
        return ()
    c, r = cell
    if r == 0:
        nb = 5 if c % 2 == 0 else 4      # textures.py's layout, used when the atlas is missing
        return _atlas_bands().get(c, tuple(0.16 + 0.7 * i / (nb - 1) for i in range(nb)))
    if r == 2:
        return (0.32, 0.62)   # the panel divisions of the half-leather designs
    return ()


def _cell_rect(cell):
    c, r = cell
    cw, ch = 1.0 / ATLAS_COLS, 1.0 / ATLAS_ROWS
    u0, v0 = c * cw, r * ch
    return u0 + cw * ATLAS_INSET, v0 + ch * ATLAS_INSET, cw * (1 - 2 * ATLAS_INSET), ch * (1 - 2 * ATLAS_INSET)


def _assign_book_uvs(me, cell, hx, H, is_spine, g=1.0):
    """Spine faces -> the cell (u across the spine, v up it): u = 0.5 + 0.5 g x / hx, clamped to
    the cell's plain margin; other cloth faces -> the plain patch of the cell; paper faces -> a
    simple planar map."""
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    u0, v0, cw, ch = _cell_rect(cell) if cell else (0, 0, 1, 1)
    pu0, pu1, pv0, pv1 = PATCH
    for p in me.polygons:
        spine = p.material_index == 0 and cell is not None and is_spine(p)
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if spine:
                u = min(0.995, max(0.005, 0.5 + 0.5 * g * co.x / hx))
                v = min(1.0, max(0.0, co.z / H))
                uv[li].uv = (u0 + u * cw, v0 + v * ch)
            elif p.material_index == 0 and cell is not None:
                a = (co.y * 3.0 + co.z * 2.0) % 1.0 if abs(p.normal.x) > 0.5 else (co.x * 3.0 + co.y * 2.0) % 1.0
                b = (co.z * 2.5) % 1.0 if abs(p.normal.x) > 0.5 else (co.y * 2.5) % 1.0
                uv[li].uv = (u0 + (pu0 + (pu1 - pu0) * a) * cw, v0 + (pv0 + (pv1 - pv0) * b) * ch)
            else:
                uv[li].uv = (co.y * 2 + co.x * 2, co.z * 2)


def _arc_ts(n, k=None):
    """Spine arc samples t in [-1, 1]; for a thick class the inner pair nearest +-k moves to
    exactly +-k, where the painted art ends (u = 0 / 1)."""
    ts = [-1 + 2 * i / (n - 1) for i in range(n)]
    if k is not None and k < 0.999:
        inner = [i for i in range(1, n - 1) if abs(ts[i]) > 1e-9]
        j = min(inner, key=lambda i: abs(abs(ts[i]) - k))
        ts[j] = math.copysign(k, ts[j])
        ts[n - 1 - j] = -ts[j]
    return ts


def _book_cased(name, sh, cell):
    """Case-bound book: covers (boards + rounded spine, joint grooves) and a text block with a
    concave fore-edge; optional raised bands. Spine apex at y = 0, fore-edge toward +Y.
    sh["f"], sh["g"]: the thickness class and the spine's share of the atlas cell (_art_scale)."""
    H, D, T = sh["H"], sh["D"], sh["T"]
    f, g = sh.get("f", 1.0), sh.get("g", 1.0)
    groove, arc_n = sh["groove"], sh["arc"]
    bulge = sh["bulge"] * min(1.3, max(0.7, T / sh["T0"]))
    bands = _bands_for(cell)
    hx = T / 2
    bt, ov, concave = 0.0028, 0.003, 0.0022
    chain = [(-hx, D)]
    if groove:
        chain += [(-hx, bulge + 0.005), (-hx + 0.0013, bulge + 0.0024)]
        ax = hx - 0.0004
    else:
        ax = hx
    arc = []
    for t in _arc_ts(arc_n, hx / (f * ax) if f > 1.001 else None):
        arc.append((t * ax, bulge * t * t))
    chain += arc
    if groove:
        chain += [(hx - 0.0013, bulge + 0.0024), (hx, bulge + 0.005)]
    chain.append((hx, D))
    yi = bulge + 0.006
    ring = chain + [(hx - bt, D), (hx - bt, yi), (-hx + bt, yi), (-hx + bt, D)]

    bm = bmesh.new()
    lo = [bm.verts.new((x, y, 0.0)) for x, y in ring]
    hi = [bm.verts.new((x, y, H)) for x, y in ring]
    body = []
    n = len(ring)
    for j in range(n):
        k = (j + 1) % n
        body.append(bm.faces.new((lo[j], lo[k], hi[k], hi[j])))
    body.append(bm.faces.new(lo))
    body.append(bm.faces.new(list(reversed(hi))))
    bmesh.ops.recalc_face_normals(bm, faces=body)
    # Text block with a concave fore-edge.
    xl, xr = -hx + bt, hx - bt
    yb, yf = yi, D - ov
    outline = [(xl, yb), (xr, yb), (xr, yf), (0.0, yf - concave), (xl, yf)]
    plo = [bm.verts.new((x, y, ov)) for x, y in outline]
    phi = [bm.verts.new((x, y, H - ov)) for x, y in outline]
    pages = []
    for j in range(5):
        k = (j + 1) % 5
        pages.append(bm.faces.new((plo[j], plo[k], phi[k], phi[j])))
    pages.append(bm.faces.new(plo))
    pages.append(bm.faces.new(list(reversed(phi))))
    bmesh.ops.recalc_face_normals(bm, faces=pages)
    for fc in pages:
        fc.material_index = 1
    # Raised bands: shallow ridges sitting on the spine arc.
    for zc in bands:
        z = zc * H
        hb = 0.0055 if H < 0.3 else 0.0065
        rise = 0.0016
        lo_r, pk_r, hi_r = [], [], []
        for i, (x, y) in enumerate(arc):
            a0 = arc[max(0, i - 1)]
            a1 = arc[min(len(arc) - 1, i + 1)]
            tx, ty = a1[0] - a0[0], a1[1] - a0[1]
            ln = math.hypot(tx, ty)
            nx, ny = ty / ln, -tx / ln
            rr = rise * (0.45 if i in (0, len(arc) - 1) else 1.0)
            lo_r.append(bm.verts.new((x, y, z - hb)))
            pk_r.append(bm.verts.new((x + nx * rr, y + ny * rr, z)))
            hi_r.append(bm.verts.new((x, y, z + hb)))
        bf = []
        for i in range(len(arc) - 1):
            bf.append(bm.faces.new((lo_r[i], lo_r[i + 1], pk_r[i + 1], pk_r[i])))
            bf.append(bm.faces.new((pk_r[i], pk_r[i + 1], hi_r[i + 1], hi_r[i])))
        bf.append(bm.faces.new((lo_r[0], pk_r[0], hi_r[0])))
        bf.append(bm.faces.new((lo_r[-1], hi_r[-1], pk_r[-1])))
        ref = Vector((0.0, yi + 0.01, z))
        for fc in bf:
            fc.normal_update()
            if fc.normal.dot(fc.calc_center_median() - ref) < 0:
                fc.normal_flip()
    ob = C.mesh_from_bmesh(name, bm, [mat("book_cloth"), mat("book_pages")])
    C.shade_smooth(ob, 42)
    lim = bulge + 0.0045
    _assign_book_uvs(ob.data, cell, hx, H, lambda p: p.center.y < lim and abs(p.normal.z) < 0.5, g)
    return ob


def _book_paperback(name, sh, cell):
    """Perfect-bound paperback with softly rounded spine corners. For a thick class the flat of
    the spine ends exactly where the painted art does (x = +-hx / f)."""
    H, D, T = sh["H"], sh["D"], sh["T"]
    f, g = sh.get("f", 1.0), sh.get("g", 1.0)
    hx = T / 2
    rc = hx * (1 - 1 / f) if f > 1.001 else 0.0016
    e = rc * 0.31
    ring = [(-hx, D), (-hx, rc), (-hx + e, e), (-hx + rc, 0.0), (hx - rc, 0.0),
            (hx - e, e), (hx, rc), (hx, D)]
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, 0.0)) for x, y in ring]
    hi = [bm.verts.new((x, y, H)) for x, y in ring]
    n = len(ring)
    for j in range(n):
        k = (j + 1) % n
        fc = bm.faces.new((lo[j], lo[k], hi[k], hi[j]))
        if j == n - 1:
            fc.material_index = 1
    for fc in (bm.faces.new(lo), bm.faces.new(list(reversed(hi)))):
        fc.material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, [mat("book_cloth"), mat("book_pages")])
    C.shade_smooth(ob, 40)
    _assign_book_uvs(ob.data, cell, hx, H, lambda p: p.center.y < rc + 0.0004, g)
    return ob


def _book_archival(name, sh, cell):
    H, D, T = sh["H"], sh["D"], sh["T"]
    hx = T / 2
    lidh = 0.042
    base = C.box_minmax(name + "_b", (-hx, 0.0015, 0.0), (hx, D, H - 0.0015), mat("book_cloth"), bevel_w=0.0015, segments=1)
    lid = C.box_minmax(name + "_l", (-hx - 0.0012, 0.0, H - lidh), (hx + 0.0012, D + 0.0012, H), mat("book_cloth"),
                       bevel_w=0.0015, segments=1)
    ob = C.join([base, lid], name)
    ob.data.materials.append(mat("book_pages"))
    _assign_book_uvs(ob.data, cell, hx + 0.0012, H, lambda p: p.normal.y < -0.7 and p.center.y < 0.003,
                     sh.get("g", 1.0))
    return ob


def _bookend(name, sh):
    H = sh["H"]
    y0, y1 = 0.004, 0.124
    r = (y1 - y0) / 2
    zc = H - r
    outline = [(y0, 0.0), (y1, 0.0)]
    for i in range(1, 12):
        a = math.pi * i / 12
        outline.append(((y0 + y1) / 2 + r * math.cos(a), zc + r * math.sin(a)))
    bm = bmesh.new()
    t = 0.0035
    a = [bm.verts.new((-t / 2, y, z)) for y, z in outline]
    b = [bm.verts.new((t / 2, y, z)) for y, z in outline]
    m = len(outline)
    for j in range(m):
        k = (j + 1) % m
        bm.faces.new((a[j], a[k], b[k], b[j]))
    bm.faces.new(a)
    bm.faces.new(list(reversed(b)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    plate = C.mesh_from_bmesh(name + "_u", bm, mat("brass_aged"))
    C.shade_smooth(plate, 40)
    foot = C.box_minmax(name + "_f", (t / 2 - 0.0005, y0 + 0.004, 0.0), (0.095, y1 - 0.004, 0.0016), mat("brass_aged"))
    ob = C.join([plate, foot], name)
    C.uv_box(ob, size=tex_size("brass_aged"))
    return ob


def _wire_spine_gilt():
    """Wires textures/book_spines_metal.png (1 = gold leaf) into mat("book_cloth") as textures.py
    asks: it drives Metallic, and (1 - metal) is the factor of the object-colour multiply, so a
    book's colour never tints its gilt titles and rules. Does nothing if the mask is missing or the
    shared material already uses it."""
    m = mat("book_cloth")
    img = LM._image("book_spines", "metal")
    nt = m.node_tree
    if img is None or m.get("ovr_gilt") or any(n.type == "TEX_IMAGE" and n.image == img for n in nt.nodes):
        return False
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    mt = nt.nodes.new("ShaderNodeTexImage")
    mt.image = img
    mt.location = (-800, 600)
    nt.links.new(mt.outputs["Color"], bsdf.inputs["Metallic"])
    mix = next((n for n in nt.nodes if n.type == "MIX" and getattr(n, "blend_type", "") == "MULTIPLY"), None)
    if mix is not None:
        inv = nt.nodes.new("ShaderNodeMath")
        inv.operation = "SUBTRACT"
        inv.inputs[0].default_value = 1.0
        inv.location = (-450, 600)
        nt.links.new(mt.outputs["Color"], inv.inputs[1])
        nt.links.new(inv.outputs[0], mix.inputs["Factor"])
    m["ovr_gilt"] = True
    return True


def build_book_variants():
    """The book variant meshes (index = variant id), at the origin, spine facing -Y, standing
    on z = 0, thickness along X. Kept in the hidden BOOKS_AND_SHELVES/BookVariants collection."""
    _wire_spine_gilt()
    objs = []
    col = C.collection("BookVariants", C.collection(ROOT_COL))
    col.hide_render = True
    col.hide_viewport = True
    for i, (vname, shape, cell, T) in enumerate(VARIANTS):
        name = f"Book_{i:02d}_{vname}"
        ob = bpy.data.objects.get(name)
        if ob is None:
            f, g = _art_scale(i)
            sh = dict(SHAPES[shape], T=T, T0=SHAPES[shape]["T"], f=f, g=g)
            if shape in ("cloth", "library", "leather", "halfcalf", "folio", "folio_banded", "reference"):
                ob = _book_cased(name, sh, cell)
            elif shape == "paperback":
                ob = _book_paperback(name, sh, cell)
            elif shape == "archival":
                ob = _book_archival(name, sh, cell)
            else:
                ob = _bookend("Prop_Bookend_Brass", sh)
                ob.name = name
            ob.data.name = name
            C.move_to(ob, col)
            ob["ovr_variant"] = i
        objs.append(ob)
    return objs


# ---------------------------------------------------------------------------
# Filling the shelves
# ---------------------------------------------------------------------------

def _srgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


BOOK_COLOURS = {   # muted library cloth and leather (sRGB)
    "oxblood": ("#4d1a1c", 9), "maroon": ("#5e1d27", 9), "faded_red": ("#8f4636", 6), "rust": ("#7a3b24", 4),
    "forest": ("#233f2e", 8), "bottle": ("#1d3a33", 4), "olive": ("#55522f", 4), "navy": ("#1e2a44", 8),
    "slate": ("#3c4a5a", 4), "teal": ("#2c4a4b", 3), "tan": ("#a37a51", 7), "ochre": ("#98733a", 4),
    "sand": ("#b9a37a", 3), "cream": ("#d3c5a5", 3), "chocolate": ("#3f2a1c", 8), "black": ("#1b1915", 6),
    "grey": ("#6f6c64", 3), "plum": ("#47232f", 3), "mustard": ("#86693a", 2),
}
# Archival boxes are board, not cloth: buff, grey and brown boards (one per shelf, slightly varied).
ARCHIVAL_COLOURS = ("#b39a76", "#a0927a", "#7d6a52", "#56605a", "#8b877e")
_COLOUR_KEYS = list(BOOK_COLOURS)
_COLOUR_W = [BOOK_COLOURS[k][1] for k in _COLOUR_KEYS]

# Related hues for matched sets (re-bound volumes of one series drift within a family).
COLOUR_FAMILIES = {
    "reds": ("oxblood", "maroon", "faded_red", "rust"),
    "blues": ("navy", "slate", "teal"),
    "greens": ("forest", "bottle", "olive"),
    "browns": ("tan", "ochre", "sand", "mustard"),
    "darks": ("chocolate", "black", "plum"),
    "pale": ("cream", "sand", "grey"),
}
FAMILY_W = {"reds": 9, "blues": 6, "greens": 6, "browns": 4, "darks": 5, "pale": 2}
SET_P = {"hall": 0.55, "rotunda": 0.6, "gallery": 0.6, "lounge": 0.3, "wing": 0.5}

SHAPE_WEIGHTS = {
    "hall": {"cloth": 46, "leather": 20, "reference": 9, "paperback": 12, "folio": 3, "archival": 1},
    "rotunda": {"cloth": 38, "leather": 30, "reference": 10, "paperback": 6, "folio": 4, "archival": 1},
    "gallery": {"cloth": 34, "leather": 40, "reference": 8, "paperback": 4, "folio": 4, "archival": 2},
    "lounge": {"cloth": 44, "leather": 8, "reference": 8, "paperback": 32, "folio": 2, "archival": 0},
    "wing": {"cloth": 42, "leather": 8, "reference": 14, "paperback": 14, "folio": 2, "archival": 12},
}
BOTTOM_WEIGHTS = {"cloth": 22, "leather": 10, "reference": 18, "paperback": 2, "folio": 32, "archival": 16}

# Height scale ranges per category. Thickness follows height (sx = sz * 0.95..1.05), so the spine
# art keeps its aspect; the variants' thickness classes give the thin/fat variety.
SIZE = {
    "cloth": (0.84, 1.18),
    "leather": (0.86, 1.16),
    "reference": (0.92, 1.1),
    "paperback": (0.94, 1.12),
    "folio": (0.88, 1.06),
    "archival": (0.98, 1.02),
}
ASPECT_JITTER = 0.05


def _jitter_colour(rgb, rng, amount=1.0):
    import colorsys
    r, g, b = (c / 255 for c in rgb)
    h, s, v = colorsys.rgb_to_hsv(r, g, b)
    h = (h + rng.uniform(-0.012, 0.012) * amount) % 1.0
    s = min(1.0, max(0.0, s * (1 + rng.uniform(-0.15, 0.12) * amount)))
    v = min(1.0, max(0.03, v * (1 + rng.uniform(-0.16, 0.14) * amount)))
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    return (round(r * 255), round(g * 255), round(b * 255))


def _pick_colour(rng):
    return _srgb(BOOK_COLOURS[rng.choices(_COLOUR_KEYS, _COLOUR_W)[0]][0])


def _pick_shape(rng, weights, ch):
    keys = [k for k, w in weights.items() if w > 0 and SHAPES[k]["H"] * SIZE[k][0] <= ch - 0.008]
    if not keys:
        return None
    return rng.choices(keys, [weights[k] for k in keys])[0]


def _make_book(rng, shape, ch, depth, variant=None, hs=None):
    v = variant if variant is not None else rng.choice(SHAPE_VARIANTS[shape])
    H, D, T = VDIMS[v]
    h0, h1 = SIZE[CATEGORY[VARIANTS[v][1]]]
    sz = hs if hs is not None else rng.uniform(h0, h1)
    sz = min(sz, (ch - 0.008) / H)
    if sz < h0 * 0.9:
        return None
    sx = sz * rng.uniform(1 - ASPECT_JITTER, 1 + ASPECT_JITTER)
    sy = min(rng.uniform(0.94, 1.06), (depth - 0.012) / D)
    return {"v": v, "s": (sx, sy, sz), "w": T * sx, "h": H * sz, "d": D * sy, "shape": CATEGORY[VARIANTS[v][1]]}


def _upright(b, x, inset, z, rgb, rng, rotz=None):
    rz = rotz if rotz is not None else rng.uniform(-0.35, 0.35)
    M = (Matrix.Translation((x + b["w"] / 2, inset, z)) @ Matrix.Rotation(_deg(rz), 4, "Z")
         @ Matrix.Diagonal((*b["s"], 1.0)))
    return (b["v"], M, rgb)


def _lying(b, x0, z0, inset, rgb, rng):
    sx, sy, sz = b["s"]
    rz = Matrix.Rotation(_deg(rng.uniform(-3.5, 3.5)), 4, "Z")
    if rng.random() < 0.5:
        Rm = Matrix.Rotation(math.pi / 2, 4, "Y")      # head toward +X
        t = Vector((x0, inset, z0 + b["w"] / 2))
    else:
        Rm = Matrix.Rotation(-math.pi / 2, 4, "Y")     # head toward -X
        t = Vector((x0 + b["h"], inset, z0 + b["w"] / 2))
    piv = Vector((x0 + b["h"] / 2, inset, 0))
    M = (Matrix.Translation(piv) @ rz @ Matrix.Translation(-piv) @ Matrix.Translation(t) @ Rm
         @ Matrix.Diagonal((sx, sy, sz, 1.0)))
    return (b["v"], M, rgb)


def _leaning(b, xb, z, inset, phi, rgb):
    """A book leaning left against its neighbour, resting on its bottom-left edge at xb."""
    sx, sy, sz = b["s"]
    hw = b["w"] / 2
    a = _deg(phi)
    t = Vector((xb + hw * math.cos(a), inset, z + hw * math.sin(a)))
    M = Matrix.Translation(t) @ Matrix.Rotation(-a, 4, "Y") @ Matrix.Diagonal((sx, sy, sz, 1.0))
    return (b["v"], M, rgb)


def _make_set(rng, avoid):
    """A matched set (a series in related bindings): 2-3 bindings, each a variant and a hue from
    one colour family; secondary bindings stand for re-bound volumes."""
    fams = [f for f in FAMILY_W if f not in avoid] or list(FAMILY_W)
    fam = rng.choices(fams, [FAMILY_W[f] for f in fams])[0]
    hues = list(COLOUR_FAMILIES[fam])
    rng.shuffle(hues)
    hues = [_srgb(BOOK_COLOURS[h][0]) for h in hues[:rng.choice((2, 2, 3))]]
    cat = rng.choices(["cloth", "leather", "reference"], [5, 4, 1])[0]
    pool = SHAPE_VARIANTS[cat]
    bindings = []
    for i, hue in enumerate(hues):
        v = rng.choice(pool)
        twins = [x for x in pool if VARIANTS[x][2] == VARIANTS[v][2] and x != v]
        bindings.append((v, hue, twins))
    h0, h1 = SIZE[cat]
    return {"family": fam, "cat": cat, "bindings": bindings, "hs": rng.uniform(h0 + 0.03, h1 - 0.05),
            "share": rng.uniform(0.3, 0.5)}


class _Shelf:
    """Fills one shelf slot left to right (local run frame)."""

    def __init__(self, slot, rng, weights):
        self.slot, self.rng = slot, rng
        self.start, self.end = slot["start"] + 0.003, slot["end"] - 0.003
        self.ch, self.depth, self.z, self.front = slot["clear_height"], slot["depth"], slot["y"], slot["front"]
        self.weights = BOTTOM_WEIGHTS if slot["bottom"] else weights
        self.out = []       # (variant, local matrix, rgb)
        self.tops = []      # (x0, x1, top z) of upright books, for books laid on top
        self.x = self.start
        self.last = None    # last upright book: (x_right, height)
        self.force = None   # a group must follow a bookend that holds books on its right
        self.board = _srgb(rng.choice(ARCHIVAL_COLOURS))   # this shelf's archival-box board

    def _stand(self, b, rgb, inset, tight):
        if b["shape"] == "archival":
            rgb = _jitter_colour(self.board, self.rng, 0.3)
        self.out.append(_upright(b, self.x, inset, self.z, rgb, self.rng))
        self.tops.append((self.x, self.x + b["w"], self.z + b["h"]))
        self.last = (self.x + b["w"], b["h"])
        self.x += b["w"] + tight * self.rng.uniform(0.5, 1.6)

    def fill(self, limit):
        """Regular filling up to `limit`: series, mixed runs, stacks, leaning books, bookends, gaps."""
        rng = self.rng
        guard = 0
        while limit - self.x > 0.012 and guard < 200:
            guard += 1
            r = rng.random()
            room = limit - self.x
            if self.force:
                kind, self.force = self.force, None
            elif r < 0.30:
                kind = "series"
            elif r < 0.78:
                kind = "mixed"
            elif r < 0.845:
                kind = "stack"
            elif r < 0.905:
                kind = "lean"
            elif r < 0.935:
                kind = "bookend"
            else:
                kind = "gap"
            if kind in ("series", "mixed"):
                if not self._group(kind, limit):
                    break
            elif kind == "stack":
                self._stack(room)
            elif kind == "lean":
                self._lean(room)
            elif kind == "bookend":
                if not self._bookend(room, limit):
                    break
            else:
                self.x += rng.uniform(0.006, 0.035) if rng.random() < 0.8 else rng.uniform(0.05, 0.12)
                self.last = None

    def _group(self, kind, limit):
        rng = self.rng
        books = []
        if kind == "series":
            shape = _pick_shape(rng, self.weights, self.ch)
            if shape is None:
                return False
            v = rng.choice(SHAPE_VARIANTS[shape])
            twins = [x for x in SHAPE_VARIANTS[shape] if VARIANTS[x][2] == VARIANTS[v][2] and x != v]
            h0, h1 = SIZE[shape]
            hs = rng.uniform(h0, h1)
            rgb = _jitter_colour(_pick_colour(rng), rng, 0.6)
            for _ in range(rng.randint(3, 11)):
                vv = rng.choice(twins) if (twins and rng.random() < 0.18) else v
                b = _make_book(rng, shape, self.ch, self.depth, vv, hs * rng.uniform(0.996, 1.004))
                if b:
                    books.append((b, _jitter_colour(rgb, rng, 0.3)))
            tight = 0.0005
        else:
            for _ in range(rng.randint(2, 9)):
                shape = _pick_shape(rng, self.weights, self.ch)
                if shape is None:
                    break
                b = _make_book(rng, shape, self.ch, self.depth)
                if b:
                    books.append((b, _jitter_colour(_pick_colour(rng), rng)))
            tight = 0.0009
        if not books:
            return False
        inset = self.front + rng.uniform(0.004, 0.022)
        gx0 = self.x
        placed = 0
        for b, rgb in books:
            if self.x + b["w"] > limit:
                break
            ins = inset + (rng.uniform(-0.0015, 0.0015) if kind != "mixed" else rng.uniform(-0.004, 0.006))
            if b["shape"] == "paperback":
                ins = self.front + rng.uniform(0.003, 0.009)
            self._stand(b, rgb, ins, tight)
            placed += 1
        if placed == 0:
            return False
        self.x += rng.uniform(0.0005, 0.004)
        self._lay_on_top(gx0, placed)
        return True

    def _lay_on_top(self, gx0, placed):
        """Now and then a book lies flat across the tops of a group."""
        rng = self.rng
        span = self.x - gx0
        if placed >= 5 and rng.random() < 0.13:
            shape = rng.choice(["cloth", "cloth", "paperback", "leather"])
            b = _make_book(rng, shape, 1.0, self.depth)
            if b and b["h"] < span - 0.01:
                xs = gx0 + rng.uniform(0.0, span - b["h"])
                rest = max((t[2] for t in self.tops if t[1] > xs and t[0] < xs + b["h"]), default=self.z)
                if rest + b["w"] < self.z + self.ch - 0.006:
                    self.out.append(_lying(b, xs, rest, self.front + rng.uniform(0.0, 0.02),
                                           _jitter_colour(_pick_colour(rng), rng), rng))

    def _stack(self, room):
        rng = self.rng
        books = []
        for _ in range(rng.randint(2, 5)):
            b = _make_book(rng, rng.choice(["cloth", "cloth", "leather", "paperback", "reference"]), 1.0, self.depth)
            if b:
                books.append(b)
        books.sort(key=lambda b: -b["h"])
        height = sum(b["w"] for b in books)
        width = max((b["h"] for b in books), default=0) + 0.006
        if not books or width > room or height > self.ch - 0.012:
            self.x += min(room, rng.uniform(0.01, 0.03))
            return
        zz = self.z
        cx = self.x + width / 2
        for b in books:
            xs = cx - b["h"] / 2 + rng.uniform(-0.006, 0.006)
            self.out.append(_lying(b, xs, zz, self.front + rng.uniform(0.004, 0.02), _jitter_colour(_pick_colour(rng), rng), rng))
            zz += b["w"]
        self.x += width + rng.uniform(0.003, 0.012)
        self.last = None

    def _lean(self, room):
        rng = self.rng
        if self.last is None or room < 0.09:
            self.x += min(room, rng.uniform(0.005, 0.02))
            return
        shape = _pick_shape(rng, {"cloth": 5, "leather": 2, "paperback": 2}, min(self.ch, self.last[1] + 0.002))
        b = _make_book(rng, shape, min(self.ch, self.last[1]), self.depth) if shape else None
        if b is None:
            self.x += 0.01
            return
        phi = rng.uniform(9, 24)
        need = b["h"] * math.sin(_deg(phi)) + b["w"] * math.cos(_deg(phi))
        if need > room:
            self.x += min(room, 0.01)
            return
        xb = self.last[0] + 0.0005 + b["h"] * math.sin(_deg(phi))
        self.out.append(_leaning(b, xb, self.z, self.front + rng.uniform(0.006, 0.02), phi, _jitter_colour(_pick_colour(rng), rng)))
        self.x = self.last[0] + need + rng.uniform(0.03, 0.10)
        self.last = None

    def _bookend(self, room, limit):
        rng = self.rng
        if room < 0.15 or self.ch < 0.19:
            self.x += min(room, 0.01)
            return True
        ins = self.front + 0.012
        if self.last is not None and rng.random() < 0.6:
            # Holding the group on its left: plate against the last book, foot under it, then open shelf.
            xp = self.x + 0.0025
            M = Matrix.Translation((xp, ins + 0.128, self.z)) @ Matrix.Rotation(math.pi, 4, "Z")
            self.out.append((BOOKEND, M, (170, 140, 90)))
            self.x = xp + 0.004 + rng.uniform(0.07, 0.18)
        else:
            # Open shelf, then a bookend holding the next group on its right.
            self.x += rng.uniform(0.05, 0.15)
            if limit - self.x < 0.12:
                return False
            self.out.append((BOOKEND, Matrix.Translation((self.x, ins, self.z)), (170, 140, 90)))
            self.x += 0.0045
            self.force = "mixed" if rng.random() < 0.5 else "series"
        self.last = None
        return True

    def place_set(self, spec, width):
        """A run of a matched set across `width`: mostly the primary binding with runs of
        re-bound volumes (secondary bindings, related hue, slightly different height), 1-3 odd
        volumes and one missing volume."""
        rng = self.rng
        limit = min(self.end, self.x + width)
        inset = self.front + rng.uniform(0.004, 0.016)
        hs = spec["hs"] * (1 + rng.uniform(-0.025, 0.025))     # per-shelf height offset of the series
        odd_at = set(rng.sample(range(2, 30), rng.randint(1, 3)))
        gap_at = rng.randint(3, 12)
        cur, left = 0, rng.randint(4, 9)
        i = 0
        while limit - self.x > 0.01 and i < 80:
            if i == gap_at:
                self.x += rng.uniform(0.018, 0.04)
                self.last = None
                i += 1
                continue
            if i in odd_at:
                shape = _pick_shape(rng, self.weights, self.ch)
                b = _make_book(rng, shape, self.ch, self.depth) if shape else None
                rgb = _jitter_colour(_pick_colour(rng), rng)
                ins = inset + rng.uniform(-0.002, 0.006)
            else:
                if left <= 0:
                    nb = len(spec["bindings"])
                    cur = 0 if cur != 0 or nb == 1 else rng.randrange(1, nb)
                    left = rng.randint(4, 10) if cur == 0 else rng.randint(2, 5)
                v, hue, twins = spec["bindings"][cur]
                if twins and rng.random() < 0.15:
                    v = rng.choice(twins)
                b = _make_book(rng, spec["cat"], self.ch, self.depth, v, hs * rng.uniform(0.996, 1.004))
                rgb = _jitter_colour(hue, rng, 0.32)
                ins = inset + rng.uniform(-0.0015, 0.0015)
                left -= 1
            i += 1
            if b is None:
                continue
            if self.x + b["w"] > limit:
                break
            self._stand(b, rgb, ins, 0.0004)
        self.x += rng.uniform(0.002, 0.01)


def _vbounds(v):
    """Local bounding box (lo, hi) of a variant mesh."""
    _n, shape, _c, T = VARIANTS[v]
    H, D = SHAPES[shape]["H"], SHAPES[shape]["D"]
    if shape == "bookend":
        return (-0.002, 0.004, 0.0), (0.095, 0.124, H)
    if shape == "archival":
        return (-T / 2 - 0.0012, 0.0, 0.0), (T / 2 + 0.0012, D + 0.0012, H)
    return (-T / 2, -0.002, 0.0), (T / 2, D, H)


def _clamp_to_slot(recs, slot):
    """Keeps every record inside its bay: nudges books that graze an upright (rotation jitter,
    leaning books) back inside, keeps them off the back boards, drops anything that cannot fit."""
    s0, s1 = slot["start"] + 0.0005, slot["end"] - 0.0005
    top = slot["y"] + slot["clear_height"] + 0.0005
    out = []
    for v, M, rgb in recs:
        lo, hi = _vbounds(v)
        pts = [M @ Vector((x, y, z)) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]
        x0, x1 = min(p.x for p in pts), max(p.x for p in pts)
        y0, y1 = min(p.y for p in pts), max(p.y for p in pts)
        if x1 - x0 > s1 - s0 or max(p.z for p in pts) > top:
            continue
        dx = s0 - x0 if x0 < s0 else (s1 - x1 if x1 > s1 else 0.0)
        # Off the back boards; and never proud of the shelf front (a book askew on a stack would
        # otherwise poke past the banding, or into the spandrel of an arched top bay).
        dy = (-BACK_T - 0.0005) - y1 if y1 > -BACK_T - 0.0005 else 0.0
        if not dy and y0 < slot["front"]:
            dy = min(slot["front"] - y0, (-BACK_T - 0.0005) - y1)
        if dx or dy:
            M = Matrix.Translation((dx, dy, 0.0)) @ M
        out.append((v, M, rgb))
    return out


def _fill_shelf(slot, rng, set_spec, weights):
    sh = _Shelf(slot, rng, weights)
    width = sh.end - sh.start
    if set_spec:
        w = set_spec["share"] * width
        pos = rng.random()
        if pos < 0.3:
            sh.place_set(set_spec, w)
        elif pos < 0.6:
            sh.fill(sh.end - w)
            sh.x = max(sh.x, sh.end - w)
            sh.place_set(set_spec, w)
        else:
            sh.fill(sh.start + rng.uniform(0.15, 0.55) * (width - w))
            sh.place_set(set_spec, w)
    sh.fill(sh.end)
    return _clamp_to_slot(sh.out, slot)


def fill_slots(slots, seed=1):
    """Fills shelf slots with books, deterministically for a given seed. Returns instance records
    [(variant_index, world_matrix (Blender), (r, g, b) sRGB 0-255)].

    Matched sets are planned per bay: at most one block per 4 shelves, each 1-3 consecutive
    shelves, never on the bottom or arched top shelf, covering 30-50 % of a shelf, in a colour
    family not used by the neighbouring bay."""
    records = []
    by_run = {}
    for s in slots:
        by_run.setdefault(s["run"], {}).setdefault(s["bay"], []).append(s)
    for run, bays in by_run.items():
        prev = set()
        for bi in sorted(bays):
            shelves = sorted(bays[bi], key=lambda s: s["shelf"])
            trng = random.Random(_crc(seed, "sets", run, bi))
            style = shelves[0].get("style", "hall")
            p = SET_P.get(style, 0.5)
            elig = [s["shelf"] for s in shelves if not s["bottom"] and not s.get("arched")]
            plan_ = {}
            used = set()
            for _ in range(max(1, len(elig) // 4)):
                if not elig or trng.random() >= p:
                    continue
                n = trng.choice((1, 2, 2, 3))
                cand = [i for i in range(len(elig) - n + 1)
                        if all(elig[i + j] + d not in plan_ for j in range(n) for d in (-1, 0, 1))]
                if not cand:
                    continue
                i0 = trng.choice(cand)
                spec = _make_set(trng, prev | used)
                used.add(spec["family"])
                for j in range(n):
                    plan_[elig[i0 + j]] = spec
            prev = used
            weights = SHAPE_WEIGHTS.get(style, SHAPE_WEIGHTS["hall"])
            for s in shelves:
                rng = random.Random(_crc(seed, run, bi, s["shelf"]))
                for v, M, rgb in _fill_shelf(s, rng, plan_.get(s["shelf"]), weights):
                    records.append((v, s["matrix"] @ M, rgb))
    return records


# ---------------------------------------------------------------------------
# Blender instances and the web export
# ---------------------------------------------------------------------------

def _lin(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def instance_books(records, variants=None):
    """Linked duplicates of the variant meshes with their object colour set, collected under
    BOOKS_AND_SHELVES/Books. Returns the objects."""
    variants = variants or build_book_variants()
    col = C.collection("Books", C.collection(ROOT_COL))
    out = []
    for i, (v, M, rgb) in enumerate(records):
        src = variants[v]
        ob = bpy.data.objects.new(f"Book_{i:05d}" if v != BOOKEND else f"Prop_Bookend_{i:05d}", src.data)
        ob.matrix_world = M
        ob.color = (_lin(rgb[0]), _lin(rgb[1]), _lin(rgb[2]), 1.0)
        col.objects.link(ob)
        out.append(ob)
    return out


BIN_VERSION = 2


def export_books_bin(records, path):
    """Writes book instances for the web client (little-endian).

    Header (12 bytes):
        char[4]  magic    "OVRB"
        uint16   version  2 (v2: 62 variants in thickness classes; v1 had 33)
        uint16   variants number of variant meshes (len(VARIANTS); ids index book_variants.glb)
        uint32   count    number of records
    Record (44 bytes), `count` times:
        uint8    variant
        uint8    r, g, b  sRGB colour (multiply the book_spines atlas by it)
        float32  x, y, z  position, WEB coordinates (+X east, +Y up, +Z south)
        float32  qx, qy, qz, qw  rotation quaternion in web space
        float32  sx, sy, sz      scale along the variant mesh's own (web/glTF) axes
    The variant meshes are exported Y-up by glTF, so a Blender vector (x, y, z) is (x, z, -y) on
    the web: position = (bx, bz, -by), quaternion (w, x, y, z)_web = (w, bx, bz, -by), and scale
    (sx, sy, sz)_web = (bsx, bsz, bsy). Books keep sx/sz (thickness/height) within 5 %, so the
    spine art keeps its painted proportions (see art_aspect)."""
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(struct.pack("<4sHHI", b"OVRB", BIN_VERSION, len(VARIANTS), len(records)))
        for v, M, rgb in records:
            loc, q, s = M.decompose()
            fh.write(struct.pack("<4B3f4f3f", v, *rgb, loc.x, loc.z, -loc.y, q.x, q.z, -q.y, q.w, s.x, s.z, s.y))
    return path


def export_book_variants_glb(path):
    """Exports the variant meshes (names Book_NN_*, NN = variant id) as one GLB."""
    objs = build_book_variants()
    col = objs[0].users_collection[0]
    was = col.hide_viewport
    col.hide_viewport = False
    vl = bpy.context.view_layer
    for ob in vl.objects:
        ob.select_set(False)
    for ob in objs:
        ob.select_set(True)
    vl.objects.active = objs[0]
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    try:   # meshes and material slots only: the web loads the palette textures itself
        bpy.ops.export_scene.gltf(export_image_format="NONE", **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    col.hide_viewport = was
    return path


def build_all(seed=1, instance=True, bin_path=None):
    """Convenience for the full build: every plan.BOOKCASES run, filled. Returns (cases, records)."""
    import plan
    cases, records = [], []
    specs = plan.BOOKCASES
    try:  # bays between the hall's giant-order pilasters (Ref 1), so the order stands full height
        import arch_shell
        specs = arch_shell.split_bookcase_runs(plan.BOOKCASES)
    except Exception as e:  # noqa: BLE001
        print(f"bookcases: building unsplit runs ({e})")
    for spec in specs:
        objs, slots = build_bookcase_run(spec, specs, seed)
        cases.append(objs)
        records += fill_slots(slots, _crc(seed, spec["id"]))
    if instance:
        instance_books(records)
    if bin_path:
        export_books_bin(records, bin_path)
    return cases, records


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _preview_atlas(path):
    """A stand-in 8x4 spine atlas (only used when textures/book_spines_color.png is missing)."""
    import numpy as np
    W, Hh = 1024, 1024
    cw, chh = W // ATLAS_COLS, Hh // ATLAS_ROWS
    img = np.zeros((Hh, W, 3), dtype=np.float32)
    rng = random.Random(11)
    for r in range(ATLAS_ROWS):
        for c in range(ATLAS_COLS):
            base = rng.uniform(0.74, 0.86)
            cell = np.full((chh, cw, 3), base, dtype=np.float32)
            ty = int(chh * rng.uniform(0.66, 0.78))
            th = int(chh * rng.uniform(0.09, 0.15))
            cell[ty - th:ty, 10:cw - 10] *= 0.5
            y0 = Hh - (r + 1) * chh
            img[y0:y0 + chh, c * cw:(c + 1) * cw] = cell[::-1]
    im = bpy.data.images.new("PreviewSpines", W, Hh, alpha=False)
    rgba = np.ones((Hh, W, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(img, 0, 1)
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    return im


def _hook_preview_atlas(out_dir):
    m = mat("book_cloth")
    nt = m.node_tree
    if any(n.type == "TEX_IMAGE" for n in nt.nodes):
        return False
    im = _preview_atlas(os.path.join(out_dir, "preview_spine_atlas.png"))
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = im
    info = next((n for n in nt.nodes if n.type == "OBJECT_INFO"), None) or nt.nodes.new("ShaderNodeObjectInfo")
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    mix.blend_type = "MULTIPLY"
    mix.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mix.inputs["A"])
    nt.links.new(info.outputs["Color"], mix.inputs["B"])
    nt.links.new(mix.outputs["Result"], bsdf.inputs["Base Color"])
    return True


def _set_stage(center_x=0.0, width=30.0):
    scene = bpy.context.scene
    R.engine(scene, "EEVEE", 48, (960, 960))
    try:
        scene.eevee.ray_tracing_options.resolution_scale = "1"
        scene.eevee.shadow_ray_count = 4      # 1 ray leaves speckle in the deep shelf interiors
        scene.eevee.shadow_step_count = 16
    except Exception:
        pass
    R.world(scene, (0.5, 0.47, 0.42), 0.22)
    floor = C.box_minmax("Stage_Floor", (center_x - width / 2, -12, -0.05), (center_x + width / 2, 2, 0.0),
                         mat("parquet_herringbone"))
    C.uv_box(floor, tex_size("parquet_herringbone"))
    wall = C.box_minmax("Stage_Wall", (center_x - width / 2, 0.001, -0.05), (center_x + width / 2, 0.4, 8.0),
                        mat("plaster_green"))
    C.uv_box(wall, tex_size("plaster_green"))
    return scene


def _rig(cx, cz, w, energy=1.0):
    """Warm key from the upper left (lamplight), cool soft fill from the right (window light)."""
    warm, cool = (1.0, 0.84, 0.64), (0.82, 0.88, 1.0)
    lights = [
        R.area_light(f"Key_{cx:.0f}", (cx - 0.9 * w - 1.5, -5.0, cz + 3.2), (cx, 0.0, cz), 650 * energy, 2.5, warm),
        R.area_light(f"Fill_{cx:.0f}", (cx + 0.9 * w + 2.0, -5.5, cz + 0.6), (cx, 0.0, cz), 220 * energy, 4.0, cool),
        R.area_light(f"Bounce_{cx:.0f}", (cx, -3.0, 0.15), (cx, 0.0, cz + 0.5), 60 * energy, 4.0, (1.0, 0.8, 0.6)),
    ]
    for ob in lights:
        ob.data.use_custom_distance = True
        ob.data.cutoff_distance = 9.0
    return lights


PREVIEW_SPECS = {
    "hall": {"id": "prev_hall", "a": (-2.0, 0.0), "b": (2.0, 0.0), "rot": 0.0, "height": 4.0, "y": 0.0,
             "depth": 0.45, "style": "hall", "subject": "History"},
    "gallery": {"id": "prev_gallery", "a": (8.4, 0.0), "b": (10.6, 0.0), "rot": 0.0, "height": 2.2, "y": 0.0,
                "depth": 0.45, "style": "gallery", "subject": ""},
    # Inside corner: two hall runs meeting at (17, 0) (checks the mitres and the closed dead corner).
    "corner_n": {"id": "prev_corner_n", "a": (17.0, 0.0), "b": (19.4, 0.0), "rot": 0.0, "height": 4.0, "y": 0.0,
                 "depth": 0.45, "style": "hall", "subject": "Law"},
    "corner_w": {"id": "prev_corner_w", "a": (17.0, 0.45), "b": (17.0, 2.6), "rot": math.pi / 2, "height": 4.0, "y": 0.0,
                 "depth": 0.45, "style": "hall", "subject": ""},
    "lounge": {"id": "prev_lounge", "a": (-10.3, 0.0), "b": (-7.7, 0.0), "rot": 0.0, "height": 2.7, "y": 0.0,
               "depth": 0.45, "style": "lounge", "subject": ""},
}


def preview(out_dir):
    _hook_preview_atlas(out_dir)
    variants = build_book_variants()
    P = PREVIEW_SPECS
    specs = [P["hall"], P["gallery"], P["corner_n"], P["corner_w"], P["lounge"]]
    corner = (P["corner_n"], P["corner_w"])
    tri_report = {}
    all_records = []
    for sp in specs:
        objs, slots = build_bookcase_run(sp, list(corner) if sp in corner else [], seed=3)
        meshes = [o for o in objs if o.type == "MESH"]
        t = sum(C.tris(o) for o in meshes)
        L = run_frame(sp)[1]
        tri_report[sp["id"]] = (t, t / L)
        recs = fill_slots(slots, seed=_crc(5, sp["id"]))
        all_records += recs
        print(f"[bookcases] {sp['id']}: {L:.2f} m, {len(slots)} slots, {len(recs)} books, {t} tris ({t / L:.0f}/m)")
    instance_books(all_records, variants)
    export_books_bin(all_records, os.path.join(out_dir, "preview_books.bin"))
    for i, ob in enumerate(variants):
        print(f"[bookcases] variant {i:02d} {ob.name}: {C.tris(ob)} tris")
    asp = [art_aspect(v, M.decompose()[2]) for v, M, _ in all_records if v != BOOKEND]
    print(f"[bookcases] spine art aspect over {len(asp)} books: {min(asp):.3f} .. {max(asp):.3f}")
    print(f"[bookcases] raised bands read from the atlas: {_atlas_bands()}")

    # Variant line-up: four stepped rows, spaced by each book's thickness.
    lx = 27.0
    rows = [list(range(i, min(i + 16, len(variants)))) for i in range(0, len(variants), 16)]
    for row, ids in enumerate(rows):
        y0 = -0.5 - (len(rows) - 1 - row) * 0.42
        zr = 0.55 + row * 0.42
        wsum = sum(VDIMS[i][2] for i in ids) + 0.035 * (len(ids) - 1)
        x = lx - wsum / 2
        for i in ids:
            T = VDIMS[i][2]
            ob = bpy.data.objects.new(f"Lineup_{i:02d}", variants[i].data)
            ob.location = (x + T / 2, y0 - 0.08, zr)
            ob.rotation_euler = (0, 0, _deg(-12))
            rgb = _pick_colour(random.Random(i * 7 + 3))
            ob.color = (_lin(rgb[0]), _lin(rgb[1]), _lin(rgb[2]), 1)
            bpy.context.scene.collection.objects.link(ob)
            x += T + 0.035
        step = C.box_minmax(f"Lineup_Step_{row}", (lx - 0.85, y0 - 0.2, 0.0), (lx + 0.85, y0 + 0.2, zr),
                            mat("walnut"), bevel_w=0.004)
        C.uv_box(step, tex_size("walnut"), grain="x")

    _set_stage(10.0, 52.0)
    _rig(0.0, 2.0, 2.0)
    _rig(9.5, 1.1, 1.1, 0.55)
    _rig(18.0, 2.0, 1.5)
    _rig(-9.0, 1.35, 1.3, 0.7)
    _rig(lx, 1.0, 0.8, 0.9)
    cam = R.camera(lens=40)
    paths = []

    def shot(name, loc, target, lens=40):
        cam.data.lens = lens
        R.look(cam, loc, target)
        paths.append(R.render(os.path.join(out_dir, f"bookcases_{name}.png")))

    shot("hall_front", (0.0, -6.9, 2.05), (0.0, 0.0, 2.0), 40)
    shot("hall_angle", (-3.6, -4.6, 1.7), (0.2, -0.2, 2.0), 32)
    shot("hall_eyelevel", (0.25, -1.25, 1.55), (-0.2, -0.3, 1.35), 35)
    shot("hall_frieze", (0.25, -1.45, 3.25), (0.25, -0.43, 3.74), 40)
    shot("hall_label", (0.66, -0.74, 1.33), (0.49, -0.42, 1.255), 50)
    shot("hall_plinth", (1.55, -1.25, 0.62), (0.95, -0.4, 0.22), 35)
    shot("corner", (20.0, -3.0, 2.0), (17.6, 0.4, 2.3), 30)
    shot("corner_base", (18.1, -1.0, 0.75), (17.45, -0.42, 0.3), 32)
    shot("corner_top", (18.6, -1.6, 3.2), (17.25, -0.2, 3.75), 30)
    shot("gallery", (10.9, -3.3, 1.45), (9.5, 0.0, 1.05), 38)
    shot("lounge", (-7.0, -3.6, 1.5), (-9.0, 0.0, 1.3), 38)
    shot("variants", (lx, -3.9, 2.0), (lx, -1.05, 1.25), 46)
    # Grazing light along the hall run for the stopped flutes (a low, hard light from the left).
    for ob in list(bpy.data.objects):
        if ob.type == "LIGHT" and ob.name.endswith("_0"):
            ob.data.energy *= 0.35
    g = R.area_light("Graze", (-1.5, -0.6, 1.6), (0.0, -0.452, 1.45), 70, 0.08, (1.0, 0.88, 0.72))
    g.data.use_custom_distance = True
    g.data.cutoff_distance = 9.0
    shot("pilaster_graze", (0.34, -0.92, 1.62), (0.0, -0.45, 1.45), 55)
    shot("pilaster_stops", (0.42, -0.82, 0.52), (0.0, -0.45, 0.32), 50)
    export_book_variants_glb(os.path.join(out_dir, "preview_book_variants.glb"))
    for k, (t, per_m) in tri_report.items():
        print(f"[bookcases] TRIS {k}: {t} ({per_m:.0f} per metre)")
    return paths


def smoke(out_dir):
    """Quick build without renders: variant triangle counts, then every plan.BOOKCASES run with
    its triangles per metre and book count (for budget checks)."""
    variants = build_book_variants()
    worst = max(C.tris(o) for o in variants)
    print(f"[bookcases] {len(variants)} variants, max {worst} tris")
    runs = _plan_runs()
    for sp in runs:
        objs, slots = build_bookcase_run(sp, runs)
        t = sum(C.tris(o) for o in objs if o.type == "MESH")
        L = run_frame(sp)[1]
        recs = fill_slots(slots, _crc(1, sp["id"]))
        print(f"[bookcases] {sp['id']:18s} {sp['style']:8s} L={L:5.2f} H={sp['height']:.1f} "
              f"tris={t:6d} ({t / L:5.0f}/m) books={len(recs)}")
