"""
Reference Rotunda furniture for the OVR library (Ref 3: the Labrouste rotunda with its green lamps; Ref 5:
the curved tiers). Milestone 2.

KIND_BUILDERS (plan.KINDS sizes; each builder(item) returns ONE joined, multi-material mesh at the origin,
floor at z = 0, front facing Blender -Y):

  desk_research_ring   3.8 m round Research Help desk (plan rot = pi/2: local -Y faces world EAST, local +Y
                       faces WEST toward the hall arch and Interact_ResearchHelp). A walnut panelled ring wall
                       (moulded plinth, 17 fielded panels between fluted pilasters on plinth blocks, architrave
                       bead, frieze with turned paterae, cove cornice, moulded walnut top). On the public west
                       arc (local +Y): a raised transaction ledge with a green leather inlay and a gilt tooled
                       line, gilt frieze letters "RESEARCH HELP", a brass-framed easel sign "Ask a Librarian",
                       a brass leaflet rack with brochures and a brass service bell. Inside: a lower desk ring
                       on drawer pedestals, two modern monitors with keyboards and a mouse, a book stack, the
                       hall's green banker's lamp (furn_hall.build_lamp_banker_green) and a walnut-and-leather
                       swivel chair. The staff gate on the east (local -Y) is a panelled door leaf under a
                       hinged lifting counter flap (brass flap hinges, door knuckles, keyhole escutcheon).
                       Carries the lamp's light_points / glow_material props (desk-local), so the scene's
                       lamp lighting finds it like any furn_hall lamp.
  table_reading_green  2.4 x 1.0 x 0.76 reader's table: walnut top with a thumbnail-and-cove edge, a green
                       leather inlay with a gilt tooled line, an apron with four drawers (brass knobs), turned
                       and reeded legs on brass cup feet, square stretcher blocks and a turned H-stretcher.
                       The centre line at local x = +-0.6 (the plan's banker's lamps) is clear leather.
  table_vitrine        1.6 x 0.9 x 0.95 display table: the reading table's turned legs, apron and H-stretcher set
                       in under a walnut case (applied bead-and-ogee panels on all four walls, an ogee base
                       moulding) with a glazed lid rising 7.5 degrees to the back (moulded frame, clear display
                       glass, brass hasp, escutcheon lock and three hinge knuckles). Inside on burgundy velvet
                       with a gilt fillet: two open rare books on linen V cradles (vellum pages, sepia text
                       lines, a red rubric, a gilt illuminated initial), a folded map (zig-zag panels, coastlines,
                       graticule), a vellum charter with a red wax seal on a silk ribbon, a brass reading glass
                       and three tent cards. Display bed at z = 0.712, lid top 0.95 at the back.
  cabinet_display      3.6 x 0.55 x 2.3 freestanding display cabinet (back y = +0.275 toward the wall, front -Y):
                       the hall bookcases' rich plinth, a lower chest with four fielded-panel doors (brass knobs,
                       escutcheons) under a thumbnail-moulded waist top, a set-back upper case with four glazed
                       doors (ovolo-stuck frames, astragal glazing bars, 6 lights each) between walnut posts,
                       glazed sides, a deep green baize back, felt floor, glass shelves on brass standards,
                       brackets and post studs, an aluminium LED channel per bay, a frieze with turned paterae,
                       a dentil course and the bookcases' rich cornice. Exhibits: two model globes, an armillary
                       sphere, a brass telescope, four open books on reading stands, three rows of old books,
                       four solander boxes and tent cards. light_points: one per bay under its LED channel
                       (light_color #ffe2b4, light_kind "led_strip").

build_chandelier_rotunda(drop=CR_DROP)
    The rotunda's corona (plan.LIGHTS rotunda_crown), 2.42 m across: a pierced arcade band (12 bays of five
    round-headed arches cut through a patinated bronze plate, gilt reveals, 60 gilt colonnettes) between moulded
    bronze-and-gilt rails with a gilt string bead; twelve tower lanterns (opal glass drum, gilt colonnettes,
    scaled bronze roof, gilt spire) at the bay joints, a gilt acorn drop under each; 24 upright opal globes on
    gilt bobeches; six cast spokes (leaf calyx, under-scroll, socket) to a turned bronze-and-gilt stem with an
    opal uplighter bowl and gilt finial; twelve fine long-link chains from the tower spires to a gilt-ringed
    crown, and one long chain to a gilt ceiling rose.
    Placement: the body's lowest point (the bowl finial) is at z = 0, the globe centres (the light centre) at
    CR_LIGHT_Z = 0.981, the crown's top loop at CR_BODY_H = 2.64 and the rose's top face at CR_BODY_H + drop.
    In the rotunda: root.location = (centre x, centre y, 7.5 - CR_LIGHT_Z) = z 6.519, and the default drop
    CR_DROP = 7.841 puts the rose on the 17.0 m skylight ring (drop = contact_z - 6.519 - 2.64). Returns ONE
    root (rails, stem, bowl, crown joined); bays, towers, drops, globes, spokes, chains and the rose are
    linked-duplicate / parented children. Root props: light_points (six on the globe ring + one in the bowl),
    light_color #ffdcae, ovr_body_height, ovr_drop, ovr_light_z. 59.1k triangles at CR_DROP.

preview(out_dir) renders every asset (EEVEE studio views and close-ups), the chandelier lit, and a Cycles
shot of the ring desk lit by its lamp. Smaller entry points: preview_desk, preview_table, preview_vitrine,
preview_cabinet, preview_chandelier.
"""

from __future__ import annotations

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector, noise

import bookcases as BC
import furn_hall as FH
import lib_core as C
import lib_materials as LM
import lib_render as R
import light_chandelier as LC
from lib_materials import tex_size

TAU = math.tau
D2R = math.radians
FONT_SERIF = "/System/Library/Fonts/Supplemental/Baskerville.ttc"
FONT_ALT = "/System/Library/Fonts/Supplemental/Georgia.ttf"

# ---------------------------------------------------------------------------
# Palette additions (only what the shared palette lacks)
# ---------------------------------------------------------------------------
# Lit opal (milk) glass for the corona's globes, tower lanterns and uplighter bowl: opaque, softly glowing.
LM.PALETTE.setdefault("glass_opal", dict(base="#f4ecdc", rough=0.24, emission="#ffdcae", emit=3.2))
# Burgundy cotton velvet lining the vitrine and the book cradles.
LM.PALETTE.setdefault("velvet_burgundy", dict(base="#3a1418", rough=0.88, tex="fabric", size=0.4, normal=0.45,
                                              tint="#4a161c"))
# Deep green baize lining the display cabinet's back.
LM.PALETTE.setdefault("baize_green", dict(base="#1f3a2c", rough=0.93, tex="fabric", size=0.4, normal=0.35,
                                          tint="#2a5240"))
# Aged vellum / rag paper of the rare books and the charter (warmer and darker than book_pages).
LM.PALETTE.setdefault("vellum", dict(base="#d8c39b", rough=0.8))
# Varnished sea on the model globes (land is label_card parchment).
LM.PALETTE.setdefault("globe_sea", dict(base="#456a68", rough=0.35))
# Faded sepia ink: text lines on the rare books' pages and the manuscript, map outlines.
LM.PALETTE.setdefault("ink_sepia", dict(base="#6b5238", rough=0.8))
# Watercolour wash for the folded map's seas and the model globe's oceans.
LM.PALETTE.setdefault("map_wash", dict(base="#9fb5ab", rough=0.85))
# Red sealing wax.
LM.PALETTE.setdefault("wax_red", dict(base="#7a1616", rough=0.35))
# Clear display glass for the vitrine lid and the cabinet doors. Alpha-blended like "glass", but with a dark base:
# a pale base colour lights up as a milky diffuse film under strong light (that hid the exhibits); a dark one only
# dims the view a little and keeps the clean specular reflections of real glass.
LM.PALETTE.setdefault("glass_display", dict(base="#161b1b", rough=0.03, alpha=0.10, transmission=True))
# The catalogue window on the staff monitors (a pale, gently lit app page on the dark screen key).
LM.PALETTE.setdefault("screen_ui", dict(base="#8f9baa", rough=0.3, emission="#c9d6e6", emit=0.42))
# Deep, low-contrast tooled leather for the reading-table inlays (the shared leather_green's bright tint read
# pale and blotchy, like marble, over a 2.4 m top): darker multiply tint, finer grain, softer normal.
LM.PALETTE.setdefault("leather_green_top", dict(base="#1d3226", rough=0.46, tex="leather", size=0.32, normal=0.32,
                                                tint="#3f8a7c"))
# The shadow-side panels of the folded map (the same wash, a step darker).
LM.PALETTE.setdefault("map_wash_dk", dict(base="#879c92", rough=0.85))

M = FH._mat
_xf, _T, _Rx, _Ry, _Rz = FH._xf, FH._T, FH._Rx, FH._Ry, FH._Rz
_copy, _cap, _turn, _rpoly, _rect = FH._copy, FH._cap, FH._turn, FH._rpoly, FH._rect


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

_KEY_BY_MAT = {}


def _key_of(m):
    if not _KEY_BY_MAT:
        for k in LM.PALETTE:
            _KEY_BY_MAT["M_" + "".join(w.capitalize() for w in k.split("_"))] = k
    return _KEY_BY_MAT.get(m.name) if m else None


def _uvm(ob, grain=None):
    """Box UVs in object space at each face's own material tile size, wood grain along `grain`."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    sizes = [tex_size(_key_of(m)) if _key_of(m) else 1.0 for m in me.materials] or [1.0]
    g = {"x": 0, "y": 1, "z": 2}.get(grain)
    for poly in me.polygons:
        s = sizes[poly.material_index] if poly.material_index < len(sizes) else 1.0
        n = poly.normal
        dom = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != dom]
        if g is not None and g in (a, b) and g != a:
            a, b = b, a
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (co[a] / s, co[b] / s)
    return ob


def _uv_polar(ob, grain="arc", p_ref=None, r_ref=None):
    """UVs for parts of revolution about Z (the ring desk): wood grain runs round the arc on tops and
    faces (grain='arc'), or up the faces (grain='z'); flat radial end faces get (r, z).
    The arc coordinate is u = (phi - p_ref) * r_ref with ONE reference radius per part (its median radius)
    and ONE reference azimuth (the start of the part's arc, found as the end of the largest angular gap,
    so a sector never wraps at +-pi). A per-vertex u = phi * r sheared the texture by a factor phi across
    any radial band (the leather ledge smeared into streaks); this mapping is orthogonal (u along the arc,
    v = r across it) and continuous, stretched only by r_ref / r (a few per cent)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    sizes = [tex_size(_key_of(m)) if _key_of(m) else 1.0 for m in me.materials] or [1.0]
    if p_ref is None:
        phs = sorted(math.atan2(v.co.y, v.co.x) for v in me.vertices if math.hypot(v.co.x, v.co.y) > 1e-6)
        best, p_ref = -1.0, phs[0]
        for a, b in zip(phs, phs[1:] + [phs[0] + TAU]):
            if b - a > best:
                best, p_ref = b - a, b
    if r_ref is None:
        rr = sorted(math.hypot(v.co.x, v.co.y) for v in me.vertices)
        r_ref = rr[len(rr) // 2]
    for poly in me.polygons:
        s = sizes[poly.material_index] if poly.material_index < len(sizes) else 1.0
        lis = list(poly.loop_indices)
        cos = [me.vertices[me.loops[li].vertex_index].co for li in lis]
        cen = poly.center
        pc = math.atan2(cen.y, cen.x)
        pc = p_ref + ((pc - p_ref) % TAU)
        arc = [(pc + ((math.atan2(c.y, c.x) - pc + math.pi) % TAU) - math.pi - p_ref) * r_ref for c in cos]
        rs = [math.hypot(c.x, c.y) for c in cos]
        rad = Vector((cen.x, cen.y, 0.0))
        rad = rad.normalized() if rad.length > 1e-6 else Vector((1, 0, 0))
        tang = Vector((-rad.y, rad.x, 0.0))
        n = poly.normal
        if abs(n.z) > 0.7:
            vals = list(zip(arc, rs))
        elif abs(n.dot(tang)) > 0.7:
            vals = [(c.z, r) if grain == "z" else (r, c.z) for c, r in zip(cos, rs)]
        else:
            vals = [(c.z, a) if grain == "z" else (a, c.z) for a, c in zip(arc, cos)]
        for li, (u, v) in zip(lis, vals):
            uv[li].uv = (u / s, v / s)
    return ob


def _faces_bridge(bm, A, B, closed=True):
    out = []
    m = len(A)
    for i in range(m if closed else m - 1):
        j = (i + 1) % m
        try:
            out.append(bm.faces.new((A[i], A[j], B[j], B[i])))
        except ValueError:
            pass
    return out


def _keys(keys):
    return list(keys) if isinstance(keys, (list, tuple)) else [keys]


def _finish(bm, name, keys, smooth=40.0, recalc=True):
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, [M(k) for k in _keys(keys)])
    C.shade_smooth(ob, smooth)
    return ob


def _rev(name, prof, a0, a1, seg, keys, idx=None, cap_mi=0, grain="arc", smooth=40.0):
    """Solid of revolution of a CLOSED (r, z) section swept about Z from azimuth a0 to a1 (radians), with
    square (flat, radial) end faces unless it is a full turn. idx[k] = material of the span prof[k]->prof[k+1]."""
    full = abs((a1 - a0) - TAU) < 1e-9
    bm = bmesh.new()
    m = len(prof)
    nr = seg if full else seg + 1
    rings = []
    for i in range(nr):
        a = a0 + (a1 - a0) * i / seg
        c, s = math.cos(a), math.sin(a)
        rings.append([bm.verts.new((r * c, r * s, z)) for r, z in prof])
    for i in range(seg):
        A, B = rings[i], rings[(i + 1) % nr]
        for k in range(m):
            k2 = (k + 1) % m
            f = bm.faces.new((A[k], B[k], B[k2], A[k2]))
            f.material_index = idx[k] if idx else 0
    if not full:
        for ring, a, sgn in ((rings[0], a0, -1.0), (rings[-1], a1, 1.0)):
            _cap(bm, [ring], Vector((-math.sin(a), math.cos(a), 0.0)) * sgn, cap_mi)
    ob = _finish(bm, name, keys, smooth)
    return _uv_polar(ob, grain)


def _sector_ring(ri, ro, a0, a1, n):
    """Ring function for _pslab: the outline of an annular sector inset by d (constant vertex count, the
    90-degree corners mitred), counter-clockwise."""
    def f(d):
        pts = []
        Ro, Ri = ro - d, ri + d
        dao, dai = d / Ro, d / Ri
        for i in range(n + 1):
            a = a0 + dao + (a1 - a0 - 2 * dao) * i / n
            pts.append(Vector((Ro * math.cos(a), Ro * math.sin(a))))
        for i in range(n + 1):
            a = a1 - dai - (a1 - a0 - 2 * dai) * i / n
            pts.append(Vector((Ri * math.cos(a), Ri * math.sin(a))))
        return pts
    return f


def _rect_ring(hw, hh, radius=0.004, seg=2, cx=0.0, cy=0.0):
    corners = _rect(hw, hh, cx, cy)
    return lambda d: _rpoly(corners, radius, d, seg)


def _pslab(name, ringf, profile, keys, idx=None, top_mi=0, steps=(), bottom_mi=None, smooth=40.0, strip=False):
    """A solid whose plan outline is ringf(d) (CCW, constant vertex count), with an edge moulding
    `profile` [(d, z), ...] from bottom to top. `steps` [(d, z, mi), ...] subdivide the top face into
    concentric regions: region 0 (material top_mi) runs from the last profile ring to ring d1, then the
    surface steps to z1 (a rebate wall) and region 1 (mi1) runs on to d2, and so on; the last region is
    filled. Inlays (leather, gilt tooling) sit in their rebate as part of the same watertight mesh.
    The bands between rings are quads; strip=True fills the last region of a _sector_ring outline with
    quads across the arc too (no long fan triangles, so polar UVs stay undistorted)."""
    keys = _keys(keys)
    bm = bmesh.new()
    rings = [[bm.verts.new((p.x, p.y, z)) for p in ringf(d)] for d, z in profile]
    for k, (A, B) in enumerate(zip(rings, rings[1:])):
        for f in _faces_bridge(bm, A, B):
            f.material_index = idx[k] if idx else 0
    _cap(bm, [rings[0]], (0, 0, -1), bottom_mi if bottom_mi is not None else (idx[0] if idx else 0))
    prev, zc, mi = rings[-1], profile[-1][1], top_mi
    for d, z, mi2 in steps:
        ring = [bm.verts.new((p.x, p.y, zc)) for p in ringf(d)]
        for f in _faces_bridge(bm, prev, ring):
            f.material_index = mi
        if abs(z - zc) > 1e-7:
            low = [bm.verts.new((p.x, p.y, z)) for p in ringf(d)]
            for f in _faces_bridge(bm, ring, low):
                f.material_index = mi
            ring = low
        prev, zc, mi = ring, z, mi2
    if strip:
        L = len(prev)
        for i in range(L // 2 - 1):
            f = bm.faces.new((prev[i], prev[i + 1], prev[L - 2 - i], prev[L - 1 - i]))
            f.material_index = mi
    else:
        _cap(bm, [prev], (0, 0, 1), mi)
    return _finish(bm, name, keys, smooth)


def _bend(ob, R0, phic=0.0, step=0.03):
    """Wraps a part modelled flat (x along the face, z up, the face plane y = 0, proud parts at y < 0,
    toward the viewer) onto the cylinder r = R0, centred on azimuth phic: phi = phic + x / R0, r = R0 - y.
    Long faces are first cut every `step` metres (bisect) so they follow the curve."""
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    if step:
        xs = [v.co.x for v in bm.verts]
        lo, hi = min(xs), max(xs)
        n = int((hi - lo) / step)
        for k in range(1, n + 1):
            x = lo + (hi - lo) * k / (n + 1)
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-7,
                                   plane_co=(x, 0, 0), plane_no=(1, 0, 0))
    for v in bm.verts:
        x, y, z = v.co
        a = phic + x / R0
        r = R0 - y
        v.co = (r * math.cos(a), r * math.sin(a), z)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob


def _at_polar(ob, r, phi, z=0.0, face="out"):
    """Places a part built at the origin (front -Y) at radius r, azimuth phi, its front facing outward
    ('out') or toward the centre ('in')."""
    th = phi + math.pi / 2 if face == "out" else phi - math.pi / 2
    return _xf(ob, _T(r * math.cos(phi), r * math.sin(phi), z) @ _Rz(math.degrees(th)))


def _text(name, body, size, depth, key, font=FONT_SERIF, spacing=1.0, width=None, resolution=2, bevel=0.0):
    """Raised letters standing in the XZ plane: back face on y = 0 (removed), front at y = -depth, centred
    on x = 0 with the lowest point at z = 0. `width` scales the line uniformly to fit. `bevel`: a single
    chamfer round the front face (so cut letters catch a highlight on their edges)."""
    cu = bpy.data.curves.new(name, type="FONT")
    cu.body = body
    cu.size = size
    cu.extrude = max(depth / 2 - bevel, 0.0)
    if bevel > 0:
        cu.bevel_depth = bevel
        cu.bevel_resolution = 0
    cu.space_character = spacing
    cu.resolution_u = resolution
    cu.align_x = "CENTER"
    for path in (font, FONT_ALT):
        try:
            if path and os.path.exists(path):
                cu.font = bpy.data.fonts.load(path, check_existing=True)
                break
        except RuntimeError:
            continue
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    if depth > 0:
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < (-0.3 if bevel > 0 else -0.9)],
                         context="FACES")
    else:                      # flat (gold-leaf) lettering: one face per glyph, facing +Z
        for f in bm.faces:
            if f.normal.z < 0:
                f.normal_flip()
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    me.materials.clear()
    me.materials.append(M(key))
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    s = 1.0
    if width and (max(xs) - min(xs)) > width:
        s = width / (max(xs) - min(xs))
    _xf(ob, Matrix.Scale(s, 4) @ _T(-(min(xs) + max(xs)) / 2, -min(ys), depth / 2))
    _xf(ob, _Rx(90))
    C.shade_flat(ob)
    _uvm(ob)
    return ob


def _join(parts, name):
    parts = [p for p in parts if p is not None]
    for p in parts:
        if not p.data.uv_layers:
            _uvm(p)
    return C.join(parts, name)


def _lathe(name, prof, seg, key, lobes=None, caps=(True, True), smooth=45.0, wood=None):
    """LC._lathe (supports reeds/flutes via lobes) with turned-wood UVs for wood keys."""
    ob = LC._lathe(name, prof, seg, keys=(key,), lobes=lobes, smooth_angle=smooth, cap_bottom=caps[0],
                   cap_top=caps[1])
    if wood if wood is not None else key not in FH.SPUN and key not in ("gilt", "bronze_patina", "bronze_satin",
                                                                          "glass_opal", "bulb", "iron"):
        FH._uv_turned(ob, tex_size(key))
    return ob


def _bx(name, lo, hi, key, bev=0.0, seg=1, grain=None):
    ob = C.box_minmax(name, lo, hi, M(key), bev, seg)
    return _uvm(ob, grain)


def _knob(name, length=0.033, r=0.013, key="brass", seg=14):
    """A turned brass drawer knob with its rosette, along +Z from the board face."""
    return _turn(name, [(0.0105, 0.0), (0.0105, 0.0022), (0.0058, 0.0060), (0.0050, 0.0110),
                        (r * 0.85, length * 0.62), (r, length * 0.80), (r * 0.82, length * 0.95),
                        (0.0, length)], seg, key, caps=(False, False), smooth=55)


# ---------------------------------------------------------------------------
# Turned and reeded leg (green reading table and vitrine)
# ---------------------------------------------------------------------------

def _turned_leg(z_top, s=1.0, seg=24, reeds=8):
    """A walnut leg standing on a brass cup foot, from the floor to z_top (the underside of its square
    apron block): turned foot, square stretcher block (z 0.135-0.215 at s=1), reeded taper, vase and
    collars. Returns parts; the square blocks are boxes so the stretchers have flat faces to tenon into."""
    parts = []
    cup = _turn("leg_cup", [(0.024 * s, 0.0), (0.0275 * s, 0.002), (0.0285 * s, 0.010), (0.027 * s, 0.040),
                            (0.0295 * s, 0.050), (0.0295 * s, 0.056), (0.0270 * s, 0.060)], 16, "brass",
                caps=(True, False), smooth=40)
    parts.append(cup)
    z_b0, z_b1 = 0.135 * s, 0.215 * s
    foot = [(0.0255 * s, 0.058 * s), (0.0275 * s, 0.064 * s), (0.0318 * s, 0.076 * s), (0.0330 * s, 0.090 * s),
            (0.0300 * s, 0.104 * s), (0.0240 * s, 0.112 * s), (0.0240 * s, 0.120 * s), (0.0290 * s, 0.126 * s),
            (0.0300 * s, z_b0)]
    parts.append(_lathe("leg_foot", foot, 16, "walnut", caps=(False, False), smooth=50))
    bw = 0.032 * s
    parts.append(_bx("leg_block", (-bw, -bw, z_b0), (bw, bw, z_b1), "walnut", 0.003 * s, 1, "z"))
    L = z_top - z_b1
    up = [(0.0300 * s, 0.000), (0.0300 * s, 0.010), (0.0245 * s, 0.020), (0.0265 * s, 0.032), (0.0240 * s, 0.042),
          (0.0250 * s, 0.050), (0.0290 * s, 0.240), (0.0305 * s, 0.252), (0.0340 * s, 0.262),
          (0.0300 * s, 0.272), (0.0330 * s, 0.290), (0.0375 * s, 0.315), (0.0360 * s, 0.338),
          (0.0285 * s, 0.356), (0.0255 * s, 0.366), (0.0300 * s, 0.374), (0.0300 * s, 0.380),
          (0.0340 * s, 0.392), (0.0360 * s, 0.400)]
    k = L / up[-1][1]
    up = [(r, z_b1 + z * k) for r, z in up]
    parts.append(_lathe("leg_upper", up, seg, "walnut", lobes=(reeds, 0.085, z_b1 + 0.048 * k, z_b1 + 0.242 * k),
                        caps=(False, False), smooth=62))
    return parts


# ---------------------------------------------------------------------------
# table_reading_green
# ---------------------------------------------------------------------------

TG_W, TG_D, TG_H = 2.4, 1.0, 0.76
TG_ZU = 0.724                 # underside of the top
TG_AX, TG_AY = 1.12, 0.42     # apron outer faces
TG_LEG = 0.072                # square apron block of each leg
TG_LX, TG_LY = TG_AX - TG_LEG / 2, TG_AY - TG_LEG / 2
TG_AZ0 = 0.640                # bottom of the apron (0.18 m of thigh room over a 0.46 m seat)
TG_STR_Z = 0.175              # stretcher centre line
TG_DRAWER_X = (-0.6, 0.6)


def _edge_profile(zu, h, cove=0.018, thumb=0.008):
    """Table-top edge (d, z) bottom to top: cove under the overhang, quirk, square band, thumbnail."""
    prof = [(0.004 + cove * math.cos(D2R(t)), zu + cove * math.sin(D2R(t))) for t in (0, 30, 60, 90)]
    prof += [(0.0, zu + cove + 0.0005), (0.0, h - thumb)]
    prof += [(thumb - thumb * math.cos(D2R(t)), h - thumb + thumb * math.sin(D2R(t))) for t in (30, 60, 90)]
    return prof


def _apron_rect(hx, hy, z0, z1, t, key="walnut", leg=0.072, ends=True):
    """Apron boards between square leg blocks on a rectangle with outer faces at +-hx, +-hy."""
    parts = []
    lx, ly = hx - leg, hy - leg
    for s in (-1, 1):
        parts.append(_bx("apron_l", (-lx, s * hy - (t if s > 0 else 0), z0), (lx, s * hy + (0 if s > 0 else t), z1), key,
                         0.0015, 1, "x"))
        if ends:
            parts.append(_bx("apron_e", (s * hx - (t if s > 0 else 0), -ly, z0), (s * hx + (0 if s > 0 else t), ly, z1),
                             key, 0.0015, 1, "y"))
    return parts


def _mitre_rect(name, hx, hy, z, profile, key, grain="x"):
    """A mouldings run mitred round a rectangle (outer faces +-hx, +-hy) at height z, profile (s, h):
    s inward, h up (FH._mitre_loft)."""
    per = [(-hx, -hy, z), (hx, -hy, z), (hx, hy, z), (-hx, hy, z)]
    return _uvm(FH._mitre_loft(name, per, (0, 0, 1), profile, key), grain)


COVE_UNDER = [(0.0, 0.0006)] + [(-0.012 + 0.012 * math.cos(D2R(a)), -0.012 + 0.012 * math.sin(D2R(a)))
                                for a in (0, 30, 60, 90)]
COVE_UNDER[-1] = (-0.012, 0.0006)
ASTRAGAL = [(0.0030 + 0.0050 * math.cos(a), 0.0050 * math.sin(a)) for a in (TAU * k / 10 for k in range(10))]


def _table_frame(hx, hy, z_apron0, z_under, legs_z_top, drawers=(), str_z=None, s=1.0, end_patera=True):
    """Shared base of the reading table and the vitrine: four turned legs with square apron blocks,
    aprons (optionally drawers on the long sides), cove under the top, astragal along the apron foot
    and a turned H-stretcher."""
    parts = []
    t = 0.022
    leg = TG_LEG * s
    lx, ly = hx - leg / 2, hy - leg / 2
    parts += _apron_rect(hx, hy, z_apron0, z_under + 0.0005, t, leg=leg)
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(_bx("leg_top", (sx * lx - leg / 2, sy * ly - leg / 2, z_apron0),
                             (sx * lx + leg / 2, sy * ly + leg / 2, z_under + 0.0005), "walnut", 0.002, 1, "z"))
            for p in _turned_leg(z_apron0, s):
                parts.append(_xf(p, _T(sx * lx, sy * ly, 0)))
    parts.append(_mitre_rect("apron_cove", hx, hy, z_under, COVE_UNDER, "walnut"))
    parts.append(_mitre_rect("apron_astragal", hx, hy, z_apron0, ASTRAGAL, "walnut"))
    # drawers in the long aprons (both sides), with turned brass knobs
    zc = (z_apron0 + z_under) / 2 + 0.002
    dh = min(0.036, (z_under - z_apron0) / 2 - 0.008)
    knob = _knob("knob")
    for sy in (-1, 1):
        for x in drawers:
            hw = 0.215
            y0 = sy * hy
            parts.append(_bx("drawer", (x - hw, y0 - 0.004 if sy < 0 else y0, zc - dh),
                             (x + hw, y0 if sy < 0 else y0 + 0.004, zc + dh), "walnut", 0.0016, 1, "x"))
            k = _copy(knob)
            _xf(k, _T(x, sy * (hy + 0.004), zc) @ _Rx(-90 * sy))
            parts.append(k)
    C.remove(knob)
    if end_patera:
        pat = _turn("patera", [(0.0185, 0.0), (0.0185, 0.0018), (0.0125, 0.0046), (0.0070, 0.0040), (0.0, 0.0074)],
                    24, "walnut", caps=(False, False), smooth=40)
        for sx in (-1, 1):
            p = _copy(pat)
            _xf(p, _T(sx * hx, 0, zc) @ _Ry(90 * sx))
            parts.append(p)
        C.remove(pat)
    # turned H-stretcher: end rails between the leg blocks, a long rail between their bulbs
    z = str_z if str_z is not None else TG_STR_Z * s
    y_in = ly - 0.032 * s
    end_prof = [(0.016, 0.0), (0.016, 0.03), (0.0195, 0.040), (0.0150, 0.058), (0.0158, 0.36), (0.0215, 0.42),
                (0.0270, 0.46), (0.0285, 0.5)]
    end_prof = end_prof + [(r, 1.0 - t_) for r, t_ in reversed(end_prof[:-1])]
    for sx in (-1, 1):
        prof = [(r * s, t_) for r, t_ in end_prof]
        st = FH._turn_between("str_end", (sx * lx, -y_in, z), (sx * lx, y_in, z), prof, 16, "walnut")
        parts.append(st)
    x_in = lx - 0.020
    long_prof = [(0.0150, 0.0), (0.0150, 0.02), (0.0185, 0.03), (0.0140, 0.045), (0.0150, 0.47), (0.0200, 0.49),
                 (0.0150, 0.5)]
    long_prof = long_prof + [(r, 1.0 - t_) for r, t_ in reversed(long_prof[:-1])]
    parts.append(FH._turn_between("str_long", (-x_in, 0, z), (x_in, 0, z), [(r * s, t_) for r, t_ in long_prof], 14,
                                  "walnut"))
    return parts


def build_table_reading_green(item=None):
    """The rotunda's 2.4 x 1.0 x 0.76 m reader's table (green leather top), long axis along X."""
    keys = ["walnut", "leather_green_top", "gilt"]
    top = _pslab("tg_top", _rect_ring(TG_W / 2, TG_D / 2, 0.022, 3), _edge_profile(TG_ZU, TG_H), keys,
                 top_mi=0, steps=[(0.075, TG_H - 0.0008, 1), (0.090, TG_H - 0.0008, 2), (0.0932, TG_H - 0.0008, 1)])
    _uvm(top, "x")
    parts = [top]
    parts += _table_frame(TG_AX, TG_AY, TG_AZ0, TG_ZU, TG_AZ0, drawers=TG_DRAWER_X)
    ob = _join(parts, "Furniture_Table_ReadingGreen_01")
    return ob




# ---------------------------------------------------------------------------
# Small shared builders (flat panels, boxes of keys, books)
# ---------------------------------------------------------------------------

def _plain(v):
    """An ID property value as plain Python data (safe to keep after its object is joined away)."""
    if hasattr(v, "to_list"):
        return v.to_list()
    if hasattr(v, "to_dict"):
        return v.to_dict()
    if isinstance(v, (list, tuple)):
        return [_plain(x) for x in v]
    return v


_orient = FH._orient


def _orient_bm(bm, face, N):
    """Consistent winding (recalc), then the whole mesh flipped if `face` does not face N."""
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    face.normal_update()
    if face.normal.dot(Vector(N)) < 0:
        for f in bm.faces:
            f.normal_flip()


# Sticking and fielded panel, (d, y): d inward from the frame opening, y back from the frame face (+Y).
PANEL_PROF = [(0.0, 0.0), (0.0, 0.0018), (0.0032, 0.0026), (0.0058, 0.0048), (0.0074, 0.0078), (0.0078, 0.0112),
              (0.0078, 0.0165), (0.0150, 0.0165), (0.0430, 0.0092), (0.0460, 0.0074)]


def _inset_rect(x0, x1, z0, z1):
    return lambda d: [Vector((x0 + d, z0 + d)), Vector((x1 - d, z0 + d)), Vector((x1 - d, z1 - d)),
                      Vector((x0 + d, z1 - d))]


def _panel_unit(name, w, h, rails, key="walnut", back=None, prof=PANEL_PROF, field=True):
    """A flat stile-and-rail frame in the XZ plane (x -w/2..w/2, z 0..h, frame face on y = 0, the room on -Y):
    full-height stiles, rails between them, a mitred sticking round the opening and a fielded panel recessed
    behind it (or, field=False, an open frame whose `prof` ends at the back). rails = (stile, bottom, top).
    back: thickness, closes the unit into a door leaf with its back face on y = back."""
    st, rb, rt = rails
    W = w / 2
    ring = _inset_rect(-W + st, W - st, rb, h - rt)
    bm = bmesh.new()
    rings = [[bm.verts.new((p.x, y, p.y)) for p in ring(d)] for d, y in prof]
    for A, B in zip(rings, rings[1:]):
        _faces_bridge(bm, A, B)
    if field:
        _cap(bm, [rings[-1]], (0, -1, 0))
    bl, br, tr, tl = rings[0]
    V = lambda x, z: bm.verts.new((x, 0.0, z))   # noqa: E731
    BL, BR, TR, TL = V(-W, 0), V(W, 0), V(W, h), V(-W, h)
    jbl, jbr, jtr, jtl = V(-W + st, 0), V(W - st, 0), V(W - st, h), V(-W + st, h)
    ref = bm.faces.new((BL, jbl, bl, tl, jtl, TL))                 # left stile
    bm.faces.new((jbr, BR, TR, jtr, tr, br))                       # right stile
    bm.faces.new((jbl, jbr, br, bl))                               # bottom rail
    bm.faces.new((tl, tr, jtr, jtl))                               # top rail
    if back is not None:
        outer = [BL, jbl, jbr, BR, TR, jtr, jtl, TL]
        bk = [bm.verts.new((v.co.x, back, v.co.z)) for v in outer]
        _faces_bridge(bm, outer, bk)
        if field:
            bm.faces.new(bk)
        else:                    # open frame: the back is a frame round the profile's last ring (on y = back)
            _cap(bm, [bk, rings[-1]], (0, 1, 0))
    _orient_bm(bm, ref, (0, -1, 0))
    ob = _finish(bm, name, [key], 40, recalc=False)
    return _uv_panel(ob, w, h, st, rb, rt)


def _uv_panel(ob, w, h, st, rb, rt):
    """Panel UVs: rails (and the sticking runs along them) take the grain along X, stiles and the field along Z."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    s = tex_size(_key_of(me.materials[0]) or "walnut")
    for p in me.polygons:
        xs = [me.vertices[i].co.x for i in p.vertices]
        zs = [me.vertices[i].co.z for i in p.vertices]
        c = p.center
        in_rail = abs(c.x) < w / 2 - st - 1e-4 and (c.z < rb - 1e-4 or c.z > h - rt + 1e-4)
        long_x = (max(xs) - min(xs)) > 1.5 * (max(zs) - min(zs)) and (max(xs) - min(xs)) < w - 2 * st - 0.05
        g = 0 if (in_rail or long_x) else 2
        n = p.normal
        dom = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != dom]
        if g in (a, b) and g != a:
            a, b = b, a
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (co[a] / s, co[b] / s)
    return ob


def _quads(name, rects, y, default_key="screen_ui"):
    """Flat rectangles (x0, x1, z0, z1, key) in the plane y, facing -Y (screen graphics, gilt rules)."""
    keys = []
    bm = bmesh.new()
    for x0, x1, z0, z1, key in rects:
        if key not in keys:
            keys.append(key)
        f = bm.faces.new([bm.verts.new(p) for p in ((x0, y, z0), (x1, y, z0), (x1, y, z1), (x0, y, z1))])
        _orient(f, Vector((0, -1, 0)))
        f.material_index = keys.index(key)
    ob = C.mesh_from_bmesh(name, bm, [M(k) for k in keys])
    C.shade_flat(ob)
    return _uvm(ob)


def _keys_mesh(name, rects, z0, z1, key, taper=0.0012):
    """Many small keycaps (x0, x1, y0, y1) in one mesh: a slightly tapered top and four sides each."""
    bm = bmesh.new()
    for x0, x1, y0, y1 in rects:
        lo = [bm.verts.new(p) for p in ((x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0))]
        hi = [bm.verts.new(p) for p in ((x0 + taper, y0 + taper, z1), (x1 - taper, y0 + taper, z1),
                                        (x1 - taper, y1 - taper, z1), (x0 + taper, y1 - taper, z1))]
        bm.faces.new(hi)
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    for f in bm.faces:
        f.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, [M(key)])
    C.shade_flat(ob)
    return _uvm(ob)


def _book_closed(name, L, W, T, key, board=0.0028, over=0.003, bands=0, band_key="gilt"):
    """A closed hardback lying flat: length L along X, width W along Y (spine at +Y), thickness T up Z, on z = 0.
    Boards and spine are one C-section (cover `key`); the text block (book_pages) sits inside the boards'
    overhang. `bands`: raised bands across the spine."""
    sec = [(-W / 2, 0.0), (W / 2 - 0.004, 0.0), (W / 2 - 0.0008, 0.0012), (W / 2, T * 0.25), (W / 2 + 0.0012, T / 2),
           (W / 2, T * 0.75), (W / 2 - 0.0008, T - 0.0012), (W / 2 - 0.004, T), (-W / 2, T),
           (-W / 2, T - board), (W / 2 - board - 0.001, T - board), (W / 2 - board - 0.001, board), (-W / 2, board)]
    cov = BC._extrude_x(name + "_cover", sec, -L / 2, L / 2, key, 40)
    for p in cov.data.polygons:
        p.material_index = 0
    cov.data.materials.clear()
    cov.data.materials.append(M(key))
    parts = [_uvm(cov, "x")]
    pages = _bx(name + "_pages", (-L / 2 + over, -W / 2 + over * 0.6, board), (L / 2 - over, W / 2 - board - 0.001, T - board),
                "book_pages", 0.0, 1, "x")
    parts.append(pages)
    for k in range(bands):
        x = -L / 2 + L * (k + 1) / (bands + 1)
        parts.append(_bx(name + "_band", (x - 0.003, W / 2 - 0.002, 0.0015), (x + 0.003, W / 2 + 0.0022, T - 0.0015),
                         band_key, 0.0, 1, "x"))
    return _join(parts, name)


# ---------------------------------------------------------------------------
# desk_research_ring
# ---------------------------------------------------------------------------

RD_R = 1.90             # outer edge of the counter top (the plan's 3.8 m circle)
RD_FACE = 1.84          # panel frames, frieze
RD_IN = 1.60            # inner (staff-side) face of the counter wall
RD_TOP_IN = 1.555       # inner edge of the counter top
RD_SEG = 96             # segments per full turn of the revolved parts
GATE_PHI = -math.pi / 2  # the staff gate, local -Y (world east)
GATE_HA = D2R(12.5)     # half-angle of the gate opening
PIL_W, PIL_PROJ, PIL_BACK = 0.084, 0.018, 0.025
N_BAYS = 16
Z_PL = 0.135            # plinth top
Z_BEAD = 0.860          # architrave bead (top of the panel zone)
Z_FR0, Z_FR1 = 0.875, 0.950   # frieze
Z_TOP0, Z_TOP1 = 0.995, 1.035  # counter top
Z_LEDGE = 1.080         # raised transaction ledge (public side)
Z_WORK = 0.740          # staff desk surface inside the ring
LEDGE_HA = D2R(36)
LEDGE_RI, LEDGE_RO = 1.645, 1.885
PUBLIC = math.pi / 2    # local +Y, toward the hall arch (world west)


def _rd_angles():
    pil_ha = (PIL_W / 2) / RD_FACE
    p0 = GATE_PHI + GATE_HA + pil_ha
    p1 = GATE_PHI + TAU - GATE_HA - pil_ha
    d = (p1 - p0) / N_BAYS
    return [p0 + k * d for k in range(N_BAYS + 1)], d


def _rd_carcass_section():
    F = RD_FACE
    s = [(RD_IN + 0.06, 0.0)]
    s += [(F + 0.016 + 0.0065 * math.cos(D2R(a)), 0.0065 + 0.0065 * math.sin(D2R(a))) for a in (-60, 0, 60, 100)]
    s += [(F + 0.016, 0.0150), (F + 0.016, 0.100)]                                            # toe bead, plinth face
    s += [(F + 0.0150, 0.1052), (F + 0.0100, 0.1100)]                                         # ovolo
    s += [(F + 0.0060, 0.1138), (F + 0.0048, 0.1215)]                                         # cove
    s += [(F + 0.0048, 0.1312), (F + 0.0030, Z_PL)]                                           # top fillet
    s += [(F - PIL_BACK, Z_PL), (F - PIL_BACK, Z_BEAD), (F, Z_BEAD)]                          # hidden behind panels
    s += [(F + 0.0078 * math.sin(D2R(a)), Z_BEAD + 0.0075 - 0.0075 * math.cos(D2R(a))) for a in (45, 90, 135)]
    s += [(F, Z_FR0), (F, Z_FR1), (F + 0.004, Z_FR1), (F + 0.004, Z_FR1 + 0.004)]            # bead, frieze, fillet
    s += [(F + 0.036 - 0.032 * math.cos(D2R(a)), Z_FR1 + 0.004 + 0.032 * math.sin(D2R(a))) for a in (30, 60, 90)]
    s += [(F + 0.040, Z_FR1 + 0.036), (F + 0.040, Z_TOP0), (RD_IN, Z_TOP0), (RD_IN, 0.100), (RD_IN + 0.06, 0.100)]
    return s


def _rd_top_section():
    a, b = RD_TOP_IN, RD_R
    return [(a + 0.004, Z_TOP0), (b - 0.004, Z_TOP0), (b, Z_TOP0 + 0.004), (b, Z_TOP1 - 0.009),
            (b - 0.0013, Z_TOP1 - 0.0040), (b - 0.0042, Z_TOP1 - 0.0011), (b - 0.0085, Z_TOP1),
            (a + 0.008, Z_TOP1), (a + 0.0023, Z_TOP1 - 0.0023), (a, Z_TOP1 - 0.008), (a, Z_TOP0 + 0.004)]


def _rd_pilaster():
    """One fluted pilaster, flat (x across, the panel-frame plane y = 0, its back buried 25 mm in the carcass),
    from the plinth top to the architrave bead: base block, torus, three stopped flutes, ovolo and abacus."""
    a, b = -PIL_W / 2, PIL_W / 2
    back, face = PIL_BACK, -PIL_PROJ
    parts = []
    gx = 0.007
    zb1 = Z_PL + 0.062
    parts.append(_bx("pil_base", (a - gx, face - gx, Z_PL), (b + gx, back, zb1), "walnut", 0.0025, 1, "x"))

    def path(z):
        return [(a, back, z), (a, face, z), (b, face, z), (b, back, z)]
    parts.append(_uvm(BC._ob("pil_torus", BC._sweep_bm(BC._profile_pilaster_base(), path(zb1)), "walnut", 40), "x"))
    zs0 = zb1 + 0.015
    za0 = Z_BEAD - 0.026
    zc0 = za0 - 0.016
    parts.append(_uvm(BC._ob("pil_ovolo", BC._sweep_bm(BC._profile_pilaster_cap(), path(zc0)), "walnut", 40), "x"))
    parts.append(_bx("pil_abacus", (a - 0.009, face - 0.009, za0), (b + 0.009, back, Z_BEAD), "walnut", 0.0022, 1, "x"))
    parts.append(_uvm(BC._fluted_shaft("pil_shaft", a, b, back, face, zs0, zc0, "walnut", n_arc=5, m_cap=1), "z"))
    return _join(parts, "rd_pilaster")


def _rd_paterae():
    """Turned walnut patera with a gilt boss, standing on +Z from z = 0 (its back)."""
    prof = [(0.0205, 0.0), (0.0200, 0.0024), (0.0150, 0.0052), (0.0095, 0.0045), (0.0075, 0.0062), (0.0040, 0.0088),
            (0.0, 0.0094)]
    idx = [0, 0, 0, 1, 1, 1]
    return LC._lathe("rd_patera", prof, 12, keys=("walnut", "gilt"), idx=idx, smooth_angle=50, cap_bottom=False)


def _rd_swivel_chair():
    """Staff swivel chair: walnut five-star base on brass casters, bronze column, walnut seat pan with a crowned
    green leather cushion, a curved leather-and-walnut back and walnut arm pads. Front -Y, seat top 0.475."""
    parts = []
    parts.append(_lathe("ch_hub", [(0.0, 0.084), (0.040, 0.084), (0.048, 0.094), (0.048, 0.124), (0.036, 0.144),
                                   (0.0, 0.150)], 16, "bronze_satin"))
    size = tex_size("walnut")
    for k in range(5):
        a = TAU * k / 5 + math.pi / 2
        pts = [Vector((0.030, 0, 0.116)), Vector((0.14, 0, 0.104)), Vector((0.235, 0, 0.088)), Vector((0.300, 0, 0.078))]
        leg = LC._tube("ch_leg", pts, lambda t: 0.0155 - 0.004 * t, sides=8, key="walnut", aspect=1.25, uv_size=size)
        tip = _lathe("ch_ferrule", [(0.0, 0.050), (0.0140, 0.050), (0.0150, 0.060), (0.0120, 0.074), (0.0112, 0.088)],
                     10, "brass")
        _xf(tip, _T(0.300, 0, 0))
        wheel = C.cylinder("ch_wheel", 0.025, 0.025, 0.020, (0.300, 0, 0.025), M("plastic_dark"), 10, rot=C.rotx(90))
        hubw = C.cylinder("ch_wheelhub", 0.009, 0.009, 0.023, (0.300, 0, 0.025), M("brass"), 6, rot=C.rotx(90))
        for o in (leg, tip, wheel, hubw):
            if not o.data.uv_layers:
                _uvm(o)
            _xf(o, _Rz(math.degrees(a)))
            parts.append(o)
    parts.append(_lathe("ch_column", [(0.0255, 0.148), (0.0255, 0.290), (0.0295, 0.296), (0.0295, 0.312), (0.0235, 0.318),
                                      (0.0215, 0.362), (0.040, 0.372), (0.052, 0.380), (0.052, 0.386), (0.0, 0.386)], 16,
                        "bronze_satin"))
    parts.append(_bx("ch_mech", (-0.085, -0.10, 0.384), (0.085, 0.09, 0.402), "bronze_satin", 0.003, 1))
    seat = FH._slab("ch_seat", _rect(0.235, 0.225), [0.07, 0.07, 0.11, 0.11],
                    [(0.006, 0.400), (0.0, 0.405), (0.0, 0.419), (0.0035, 0.425), (0.009, 0.428)], 3, "walnut")
    parts.append(_uvm(seat, "y"))
    cush = FH._slab("ch_cushion", _rect(0.222, 0.212), [0.06, 0.06, 0.10, 0.10],
                    [(0.010, 0.427), (0.004, 0.433), (0.004, 0.452), (0.012, 0.466), (0.034, 0.474), (0.090, 0.4765)],
                    3, "leather_green")
    parts.append(_uvm(cush, "y"))
    # back: a leather pad on a walnut shell, both curved round the sitter
    def bent_slab(name, hw, hh, r, prof, key):
        ob = FH._slab(name, _rect(hw, hh), r, prof, 3, key)
        me = ob.data
        bm = bmesh.new()
        bm.from_mesh(me)
        for k in range(1, 7):
            x = -hw + 2 * hw * k / 7
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-7, plane_co=(x, 0, 0),
                                   plane_no=(1, 0, 0))
        bm.to_mesh(me)
        bm.free()
        _uvm(ob, "x")
        _xf(ob, _Rx(90))                      # slab thickness (z) -> toward -Y
        for v in me.vertices:
            v.co.y -= v.co.x * v.co.x / (2 * 0.42)
        return ob
    pad = bent_slab("ch_backpad", 0.200, 0.120, 0.06, [(0.010, 0.0), (0.004, 0.006), (0.0, 0.017), (0.004, 0.030),
                                                       (0.012, 0.037), (0.04, 0.040)], "leather_green")
    shell = bent_slab("ch_backshell", 0.212, 0.132, 0.065, [(0.004, -0.020), (0.0, -0.016), (0.0, -0.002), (0.004, 0.002)],
                      "walnut")
    for o in (pad, shell):
        _xf(o, _T(0, 0.215, 0.735) @ _Rx(-9))
        parts.append(o)
    spine = LC._tube("ch_spine", [Vector((0, 0.06, 0.392)), Vector((0, 0.17, 0.40)), Vector((0, 0.222, 0.46)),
                                  Vector((0, 0.232, 0.70))], 0.008, sides=8, key="bronze_satin", aspect=2.0)
    parts.append(spine)
    for sx in (-1, 1):
        sup = LC._tube("ch_armpost", [Vector((sx * 0.150, 0.03, 0.392)), Vector((sx * 0.225, 0.03, 0.430)),
                                      Vector((sx * 0.235, 0.02, 0.560)), Vector((sx * 0.232, 0.0, 0.636))], 0.010,
                       sides=8, key="bronze_satin")
        parts.append(sup)
        arm = FH._slab("ch_arm", _rect(0.027, 0.135, sx * 0.232, 0.01), 0.025,
                       [(0.004, 0.634), (0.0, 0.639), (0.0, 0.652), (0.004, 0.658), (0.011, 0.660)], 3, "walnut")
        parts.append(_uvm(arm, "y"))
    return _join(parts, "rd_chair")


def _rd_monitor():
    """A slim modern monitor (24 in) on an aluminium stand, screen facing -Y, base on z = 0. The screen shows a
    pale catalogue window (screen_ui) on the dark panel (screen)."""
    parts = []
    base = FH._slab("mon_base", _rect(0.115, 0.085, 0, 0.025), 0.035, [(0.003, 0.0), (0.0, 0.0025), (0.0, 0.006),
                                                                       (0.0025, 0.0085)], 3, "aluminium")
    parts.append(_uvm(base, "y"))
    parts.append(_bx("mon_neck", (-0.032, 0.030, 0.004), (0.032, 0.046, 0.300), "aluminium", 0.003, 1, "z"))
    zc, hw, hh = 0.275, 0.272, 0.162
    parts.append(_bx("mon_bezel", (-hw, -0.004, zc - hh), (hw, 0.010, zc + hh), "plastic_dark", 0.003, 1, "x"))
    parts.append(_bx("mon_back", (-0.13, 0.010, zc - 0.10), (0.13, 0.034, zc + 0.07), "plastic_dark", 0.006, 1, "x"))
    parts.append(_bx("mon_screen", (-hw + 0.008, -0.0046, zc - hh + 0.018), (hw - 0.008, -0.0038, zc + hh - 0.008),
                     "screen", 0.0, 1))
    # the catalogue page: header bar, a result list with its text lines, a side panel
    ui = [(-0.244, 0.244, 0.118, 0.140, "signage"), (-0.236, 0.100, -0.122, 0.104, "screen_ui"),
          (0.112, 0.236, -0.122, 0.104, "screen_ui")]
    for i in range(8):
        z = 0.082 - i * 0.026
        ui.append((-0.222, -0.222 + (0.30 if i % 3 else 0.22), z, z + 0.007, "label_ink"))
        if i < 5:
            ui.append((0.124, 0.124 + (0.09 if i % 2 else 0.07), z - 0.004, z + 0.004, "label_ink"))
    parts.append(_quads("mon_ui", [(x0, x1, zc + z0, zc + z1, k) for x0, x1, z0, z1, k in ui], -0.0049))
    parts.append(_bx("mon_led", (0.235, -0.0052, zc - hh + 0.006), (0.243, -0.0040, zc - hh + 0.010), "led_strip", 0.0, 1))
    return _join(parts, "rd_monitor")


def _rd_keyboard():
    parts = []
    deck = FH._slab("kb_deck", _rect(0.218, 0.066), 0.010, [(0.002, 0.0), (0.0, 0.002), (0.0, 0.009), (0.0015, 0.0115)],
                    2, "aluminium")
    parts.append(_uvm(deck, "x"))
    rects = []
    p, k = 0.0178, 0.0158
    for row, n in enumerate((13, 12, 12, 11)):
        y = 0.034 - row * p
        x0 = -n * p / 2 + (0.004 * row)
        for i in range(n):
            x = x0 + i * p
            rects.append((x, x + k, y - k, y))
    y = 0.034 - 4 * p
    rects.append((-0.050, 0.050, y - k, y))
    for x in (-0.110, -0.090, 0.068, 0.088, 0.108):
        rects.append((x - k / 2, x + k / 2, y - k, y))
    parts.append(_keys_mesh("kb_keys", rects, 0.0114, 0.0150, "plastic_dark"))
    mouse = LC._lathe("kb_mouse", [(0.0, 0.0), (0.026, 0.0), (0.027, 0.007), (0.023, 0.019), (0.014, 0.027), (0.0, 0.030)],
                      12, keys=("plastic_dark",), smooth_angle=70, cap_bottom=False)
    _xf(mouse, _T(0.285, 0.0, 0.0) @ Matrix.Diagonal((0.62, 1.0, 0.85, 1.0)))
    parts.append(_uvm(mouse))
    return _join(parts, "rd_keyboard")


def _rd_bell():
    parts = [_lathe("bell_base", [(0.0, 0.0), (0.041, 0.0), (0.043, 0.004), (0.042, 0.010), (0.037, 0.0135), (0.0, 0.0135)],
                    18, "walnut_dark"),
             _lathe("bell_dome", [(0.0352, 0.0130), (0.0362, 0.0165), (0.0338, 0.0285), (0.0262, 0.0398), (0.0140, 0.0470),
                                  (0.0, 0.0490)], 18, "brass", caps=(False, False)),
             _lathe("bell_plunger", [(0.0026, 0.0485), (0.0026, 0.0600), (0.0068, 0.0618), (0.0074, 0.0655), (0.0050, 0.0682),
                                     (0.0, 0.0690)], 10, "brass", caps=(False, False))]
    return _join(parts, "rd_bell")


def _rd_sign():
    """'Ask a Librarian': a green board with gilt letters in a moulded brass frame, leaning back on a brass easel
    foot. Front -Y, foot on z = 0."""
    parts = []
    parts.append(_bx("sg_foot", (-0.150, -0.032, 0.0), (0.150, 0.030, 0.007), "brass", 0.002, 1, "x"))
    hw, z0, z1 = 0.150, 0.016, 0.152
    t = 0.007
    tilt = _T(0, 0.004, 0.007) @ _Rx(-11)
    board = _bx("sg_board", (-hw + 0.004, -t / 2, z0 + 0.004), (hw - 0.004, t / 2, z1 - 0.004), "signage", 0.0012, 1, "x")
    frame = []
    fw = 0.007
    for lo, hi in (((-hw, -t / 2 - 0.0025, z0), (hw, t / 2 + 0.0015, z0 + fw)),
                   ((-hw, -t / 2 - 0.0025, z1 - fw), (hw, t / 2 + 0.0015, z1)),
                   ((-hw, -t / 2 - 0.0025, z0 + fw), (-hw + fw, t / 2 + 0.0015, z1 - fw)),
                   ((hw - fw, -t / 2 - 0.0025, z0 + fw), (hw, t / 2 + 0.0015, z1 - fw))):
        frame.append(_bx("sg_frame", lo, hi, "brass", 0.0018, 1, "x"))
    txt = _text("sg_text", "Ask a Librarian", 0.042, 0.0, "gilt", width=0.245, spacing=1.04, resolution=1)
    zs = [v.co.z for v in txt.data.vertices]
    _xf(txt, _T(0, -t / 2 - 0.0004, 0.094 - (max(zs) + min(zs)) / 2))
    rule = _quads("sg_rule", [(-0.090, 0.090, 0.052, 0.0535, "gilt"), (-0.090, 0.090, 0.0555, 0.0562, "gilt")],
                  -t / 2 - 0.0004)
    for o in [board, txt, rule] + frame:
        _xf(o, tilt)
        parts.append(o)
    strut = LC._tube("sg_strut", [Vector((0, 0.004, 0.006)), Vector((0, 0.050, 0.006)), Vector((0, 0.030, 0.105))], 0.0028,
                     sides=6, key="brass")
    parts.append(strut)
    return _join(parts, "rd_sign")


def _rd_rack():
    """A brass brochure rack holding a stack of leaflets, leaning back. Front -Y, base on z = 0."""
    parts = [_bx("rk_base", (-0.068, -0.050, 0.0), (0.068, 0.045, 0.005), "brass", 0.0015, 1, "x")]
    lean = _T(0, 0.028, 0.004) @ _Rx(-15)
    back = _bx("rk_back", (-0.064, 0.0, 0.0), (0.064, 0.003, 0.175), "brass", 0.001, 1, "z")
    parts.append(_xf(back, lean))
    for sx in (-1, 1):
        side = _bx("rk_side", (sx * 0.064 - 0.0015, -0.019, 0.0), (sx * 0.064 + 0.0015, 0.002, 0.050), "brass", 0.0006, 1)
        parts.append(_xf(side, lean))
    lip = C.cylinder("rk_lip", 0.0028, 0.0028, 0.132, (0, -0.016, 0.046), M("brass"), 8, rot=C.roty(90))
    parts.append(_xf(_uvm(lip, "x"), lean))
    cols = ("signage", "leather_burgundy", "signage")
    for i, ck in enumerate(cols):
        y0 = -0.0028 * i - 0.0001
        dz = 0.012 * i
        body = _bx("rk_leaflet", (-0.050, y0 - 0.0026, 0.004 + dz * 0.2), (0.050, y0, 0.205 - dz), "paper", 0.0, 1, "z")
        cover = _bx("rk_cover", (-0.050, y0 - 0.0029, 0.150 - dz), (0.050, y0 - 0.0026, 0.192 - dz), ck, 0.0, 1, "x")
        parts += [_xf(body, lean), _xf(cover, lean)]
        if i == 2:
            ttl = _bx("rk_title", (-0.034, y0 - 0.0031, 0.170 - dz), (0.034, y0 - 0.0029, 0.1745 - dz), "gilt", 0.0, 1, "x")
            parts.append(_xf(ttl, lean))
    return _join(parts, "rd_rack")


def _rd_pedestal():
    """Drawer pedestal under the staff desk (0.40 x 0.50 x 0.708): carcass on a recessed plinth, three drawer
    fronts with a cock bead and a turned brass knob. Front -Y, floor z = 0."""
    parts = [_bx("pd_case", (-0.200, -0.240, 0.060), (0.200, 0.250, 0.708), "walnut", 0.003, 1, "z"),
             _bx("pd_plinth", (-0.186, -0.226, 0.0), (0.186, 0.240, 0.0605), "walnut_dark", 0.002, 1, "x")]
    knob = _knob("pd_knob", 0.026, 0.0115, seg=10)
    for z0, z1 in ((0.074, 0.330), (0.338, 0.516), (0.524, 0.696)):
        parts.append(_bx("pd_front", (-0.192, -0.258, z0), (0.192, -0.2395, z1), "walnut", 0.0045, 1, "x"))
        k = _copy(knob)
        _xf(k, _T(0, -0.258, (z0 + z1) / 2 + (0.06 if z1 - z0 > 0.2 else 0.0)) @ _Rx(90))
        parts.append(k)
    C.remove(knob)
    return _join(parts, "rd_pedestal")


def _rd_books():
    parts = []
    specs = ((0.250, 0.175, 0.040, "leather_burgundy", 3, 0.0, 4), (0.235, 0.165, 0.032, "leather_green", 0, 0.040, -7),
             (0.215, 0.150, 0.028, "leather_brown", 2, 0.072, 3))
    for i, (L, W, T, key, bands, z, rot) in enumerate(specs):
        b = _book_closed(f"bk{i}", L, W, T, key, bands=bands)
        _xf(b, _T(0, 0, z) @ _Rz(rot))
        parts.append(b)
    return _join(parts, "rd_books")


FASCIA_HA = D2R(18.6)            # half-angle of the lettered fascia (clear of the paterae at +-20.8 deg)
FASCIA_Z0, FASCIA_Z1 = Z_FR0 + 0.003, Z_FR1 - 0.002
LETTER_CAP = 0.052


def _rd_fascia():
    """The 'RESEARCH HELP' fascia over the public bays: an ebonised (walnut_dark) plaque applied 3.5 mm proud
    of the frieze, framed by a mitred gilt bead, carrying cut gilt letters 5 mm deep with a chamfered face.
    Built flat (x along the frieze, the frieze face y = 0, proud parts toward -Y) and bent onto the ring."""
    hw = RD_FACE * FASCIA_HA
    t = 0.0035
    body = _bx("rd_fascia", (-hw, -t, FASCIA_Z0), (hw, 0.0006, FASCIA_Z1), "walnut_dark", 0.0012, 1, "x")
    bead = [(0.0, 0.0), (0.0, 0.0010), (0.0010, 0.0022), (0.0021, 0.0027), (0.0032, 0.0022), (0.0042, 0.0010),
            (0.0042, 0.0)]
    cs = [(-hw, -t, FASCIA_Z0), (hw, -t, FASCIA_Z0), (hw, -t, FASCIA_Z1), (-hw, -t, FASCIA_Z1)]
    frame = _uvm(FH._mitre_loft("rd_fascia_bead", cs, (0, -1, 0), bead, "gilt"), "x")
    plate = _bend(_join([body, frame], "rd_fascia_plate"), RD_FACE, PUBLIC, 0.03)
    letters = _text("rd_letters", "RESEARCH  HELP", 0.08, 0.005, "gilt", spacing=1.10, resolution=1, bevel=0.0009)
    me = letters.data
    xs = [v.co.x for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    s = min(LETTER_CAP / (max(zs) - min(zs)), (2 * hw - 0.13) / (max(xs) - min(xs)))
    zc = (FASCIA_Z0 + FASCIA_Z1) / 2
    _xf(letters, _T(0, -t + 0.0003, zc) @ Matrix.Diagonal((s, 1.0, s, 1.0)) @ _T(0, 0, -(max(zs) + min(zs)) / 2))
    _bend(letters, RD_FACE, PUBLIC, 0.0)
    return _join([plate, letters], "rd_fascia")


def build_desk_research_ring(item=None):
    """The rotunda's round Research Help desk (3.8 m, counter 1.035 m, ledge 1.08 m). See the module docstring."""
    parts = []
    angles, dphi = _rd_angles()
    a0, a1 = GATE_PHI + GATE_HA, GATE_PHI + TAU - GATE_HA
    seg = max(8, round(RD_SEG * (a1 - a0) / TAU))
    parts.append(_rev("rd_carcass", _rd_carcass_section(), a0, a1, seg, ["walnut"], grain="arc"))
    parts.append(_rev("rd_top", _rd_top_section(), a0, a1, seg, ["walnut"], grain="arc"))

    # pilasters and fielded panel bays, built flat, bent onto the face once and turned round the ring
    pil = _bend(_rd_pilaster(), RD_FACE, 0.0, 0.0)
    for k, phi in enumerate(angles):
        parts.append(_xf(_copy(pil), _Rz(math.degrees(phi))))
    C.remove(pil)
    w = dphi * RD_FACE
    bay = _panel_unit("rd_panel", w, Z_BEAD - Z_PL, (0.072, 0.085, 0.075))
    _xf(bay, _T(0, 0, Z_PL))
    _bend(bay, RD_FACE, 0.0, 0.12)
    for k in range(N_BAYS):
        parts.append(_xf(_copy(bay), _Rz(math.degrees(angles[k] + dphi / 2))))
    C.remove(bay)

    # frieze: over the public bays an ebonised fascia plaque in a gilt bead carries cut gilt letters
    # (5 mm deep, chamfered, ~52 mm caps) so the wayfinding reads in the rotunda's warm, dim light;
    # turned paterae over the other pilasters
    parts.append(_rd_fascia())
    pat = _rd_paterae()
    for phi in angles:
        if abs(phi - PUBLIC) < D2R(16):
            continue
        p = _copy(pat)
        _xf(p, _Rz(math.degrees(phi)) @ _T(RD_FACE, 0, (Z_FR0 + Z_FR1) / 2) @ _Ry(90))
        parts.append(p)
    C.remove(pat)

    # raised transaction ledge on the public arc: moulded walnut on a cove, green leather with a gilt fillet
    lprof = [(0.034, Z_TOP1 - 0.002), (0.034, Z_TOP1 + 0.006), (0.0294, Z_TOP1 + 0.016), (0.017, Z_TOP1 + 0.0233),
             (0.0, Z_TOP1 + 0.026), (0.0, Z_LEDGE - 0.007), (0.0012, Z_LEDGE - 0.0032), (0.0038, Z_LEDGE - 0.0009),
             (0.0075, Z_LEDGE)]
    ledge = _pslab("rd_ledge", _sector_ring(LEDGE_RI, LEDGE_RO, PUBLIC - LEDGE_HA, PUBLIC + LEDGE_HA, 36), lprof,
                   ["walnut", "leather_green", "gilt"], top_mi=0,
                   steps=[(0.028, Z_LEDGE - 0.0006, 1), (0.038, Z_LEDGE - 0.0006, 2), (0.0405, Z_LEDGE - 0.0006, 1)],
                   strip=True)
    parts.append(_uv_polar(ledge, "arc"))

    # the staff gate (local -Y): a hinged lifting flap in the top over a curved panelled half-door
    gap = 0.0035 / RD_FACE                                  # a visible joint all round the lifting flap
    e1, e2 = GATE_PHI - GATE_HA, GATE_PHI + GATE_HA          # e2 is the hinge side
    parts.append(_rev("rd_flap", _rd_top_section(), e1 + gap, e2 - gap, 8, ["walnut"], grain="arc"))
    dw = (2 * GATE_HA - 2 * gap) * RD_FACE
    door = _panel_unit("rd_door", dw, Z_TOP0 - 0.004 - 0.012, (0.070, 0.130, 0.170), back=0.032)
    bead = BC._extrude_x("rd_doorbead", [(0.0, Z_BEAD), (-0.004, Z_BEAD + 0.001), (-0.0068, Z_BEAD + 0.004),
                                         (-0.0078, Z_BEAD + 0.0075), (-0.0068, Z_BEAD + 0.011), (-0.004, Z_BEAD + 0.014),
                                         (0.0, Z_BEAD + 0.015)], -dw / 2, dw / 2, "walnut", 40)
    _uvm(bead, "x")
    _xf(door, _T(0, 0, 0.012))
    door = _join([door, bead], "rd_door")
    parts.append(_bend(door, RD_FACE, GATE_PHI, 0.10))
    esc = _lathe("rd_escutcheon", [(0.0, 0.0), (0.0150, 0.0), (0.0155, 0.0012), (0.0130, 0.0030), (0.0, 0.0034)], 16,
                 "brass", caps=(False, False))
    key = _bx("rd_keyhole", (-0.0024, -0.0024, 0.0034), (0.0024, 0.0024, 0.0037), "iron", 0.0, 1)
    slot = _bx("rd_keyslot", (-0.0011, -0.0085, 0.0034), (0.0011, -0.0010, 0.0037), "iron", 0.0, 1)
    escm = _join([esc, key, slot], "rd_esc")
    pe = e1 + 0.050 / RD_FACE
    _xf(escm, _Rz(math.degrees(pe)) @ _T(RD_FACE, 0, 0.80) @ _Ry(90) @ _Rz(90))
    parts.append(escm)
    kn = _knob("rd_doorknob", 0.030, 0.0125)
    _xf(kn, _Rz(math.degrees(pe)) @ _T(RD_FACE - 0.032, 0, 0.78) @ _Ry(-90))
    parts.append(kn)
    for z in (0.20, 0.76):                     # butt hinges on the inner side of the hinge stile
        rk = RD_FACE - 0.032 - 0.004
        kn_ = _lathe("rd_hinge", [(0.0, 0.0), (0.0040, 0.0), (0.0055, 0.004), (0.0055, 0.071), (0.0040, 0.075), (0.0, 0.0755)],
                     10, "brass")
        _xf(kn_, _Rz(math.degrees(e2)) @ _T(rk, 0, z))
        leaf = _bx("rd_hingeleaf", (RD_FACE - 0.034, -0.030, z + 0.004), (RD_FACE - 0.032, -0.004, z + 0.071), "brass",
                   0.0, 1)
        _xf(leaf, _Rz(math.degrees(e2)))
        leaf2 = _bx("rd_hingeleaf", (rk - 0.026, -0.0018, z + 0.004), (rk - 0.004, 0.0, z + 0.071), "brass", 0.0, 1)
        _xf(leaf2, _Rz(math.degrees(e2)))
        parts += [kn_, leaf, leaf2]
    for r in (1.645, 1.840):                    # flap hinges let into the top across the hinge-side joint
        for sgn in (-1, 1):
            lf = _bx("rd_flaphinge", (r - 0.024, 0.0015 if sgn > 0 else -0.032, Z_TOP1 - 0.0004),
                     (r + 0.024, 0.032 if sgn > 0 else -0.0015, Z_TOP1 + 0.0012), "brass", 0.0006, 1, "x")
            parts.append(_xf(lf, _Rz(math.degrees(e2))))
        kh = C.cylinder("rd_flapknuckle", 0.0032, 0.0032, 0.046, (r, 0, Z_TOP1 + 0.0010), M("brass"), 8, rot=C.roty(90))
        parts.append(_xf(_uvm(kh, "x"), _Rz(math.degrees(e2))))
    # a flush brass ring pull near the flap's free edge (a sunk round plate, the ring lying in it)
    pr = 1.745
    pp = e1 + 0.075 / pr
    plate = _lathe("rd_pullplate", [(0.0, Z_TOP1 - 0.0010), (0.0215, Z_TOP1 - 0.0010), (0.0225, Z_TOP1 + 0.0004),
                                    (0.0205, Z_TOP1 + 0.0009), (0.0, Z_TOP1 + 0.0009)], 20, "brass", caps=(False, False))
    ring = C.torus("rd_pullring", 0.0145, 0.0024, (0, 0, Z_TOP1 + 0.0033), M("brass"), 20, 6)
    lug = _bx("rd_pulllug", (0.0105, -0.0035, Z_TOP1 + 0.0008), (0.0175, 0.0035, Z_TOP1 + 0.0036), "brass", 0.0008, 1)
    pull = _join([plate, _uvm(ring), lug], "rd_pull")
    parts.append(_xf(pull, _T(pr * math.cos(pp), pr * math.sin(pp), 0.0) @ _Rz(math.degrees(pp) + 180)))

    # inside: the staff desk on two drawer pedestals, monitors, keyboards, books, the banker's lamp, the chair
    wprof = [(0.0, Z_WORK - 0.032), (0.0, Z_WORK - 0.008), (0.0012, Z_WORK - 0.0035), (0.0038, Z_WORK - 0.0009),
             (0.0075, Z_WORK)]
    work = _pslab("rd_work", _sector_ring(1.02, RD_IN - 0.0015, D2R(33), D2R(147), 40), wprof,
                  ["walnut", "leather_green", "gilt"], top_mi=0,
                  steps=[(0.045, Z_WORK - 0.0006, 1), (0.053, Z_WORK - 0.0006, 2), (0.0555, Z_WORK - 0.0006, 1)],
                  strip=True)
    parts.append(_uv_polar(work, "arc"))
    ped = _rd_pedestal()
    for phi in (D2R(45), D2R(135)):
        parts.append(_at_polar(_copy(ped), 1.335, phi, 0.0, "in"))
    C.remove(ped)
    mon, kb = _rd_monitor(), _rd_keyboard()
    for phi in (D2R(73), D2R(107)):
        parts.append(_at_polar(_copy(mon), 1.43, phi, Z_WORK, "in"))
        parts.append(_at_polar(_copy(kb), 1.17, phi, Z_WORK, "in"))
    C.remove(mon)
    C.remove(kb)
    parts.append(_at_polar(_rd_books(), 1.36, D2R(128), Z_WORK, "in"))
    # the banker's lamp at the north end of the desk, clear of the easel sign (which stands at +25 deg), so
    # from the arch it is seen beside the leaflet rack and its pool falls on the leather and the monitors
    LAMP_PHI = 49.0
    lamp = FH.build_lamp_banker_green()
    lm = (Matrix.Translation((1.40 * math.cos(D2R(LAMP_PHI)), 1.40 * math.sin(D2R(LAMP_PHI)), Z_WORK))
          @ _Rz(LAMP_PHI - 90))
    lamp_pts = [list(lm @ Vector(tuple(p))) for p in lamp["light_points"]]
    lamp_props = {k: _plain(lamp[k]) for k in FH.LAMP_PROPS if k in lamp}
    _xf(lamp, lm)
    parts.append(lamp)
    parts.append(_at_polar(_rd_swivel_chair(), 0.80, PUBLIC, 0.0, "out"))

    # on the ledge: the service bell, the sign and the leaflet rack
    rl = (LEDGE_RI + LEDGE_RO) / 2 + 0.01
    parts.append(_at_polar(_rd_bell(), rl, PUBLIC - D2R(9), Z_LEDGE, "out"))
    parts.append(_at_polar(_rd_sign(), rl, PUBLIC + D2R(25), Z_LEDGE, "out"))
    parts.append(_at_polar(_rd_rack(), rl, PUBLIC - D2R(26), Z_LEDGE, "out"))

    ob = _join(parts, "Furniture_Desk_ResearchRing_01")
    for k, v in lamp_props.items():
        ob[k] = v
    ob["light_offset"] = [round(c, 4) for c in lamp_pts[0]]
    ob["light_points"] = [[round(c, 4) for c in p] for p in lamp_pts]
    return ob


# ---------------------------------------------------------------------------
# Small display props (vitrine and cabinet): open books, a folded map, a manuscript, instruments
# ---------------------------------------------------------------------------

def _ribbons(name, paths, w, key, closed=False, up=(0, 0, 1)):
    """Flat ribbons (width w) along 3D polylines lying on a surface whose normal is ~+Z: text lines,
    coastlines, ribbon tails. Faces point `up`."""
    bm = bmesh.new()
    U = Vector(up)
    for pts in paths:
        P = [Vector(p) for p in pts]
        n = len(P)
        L, Rr = [], []
        for i in range(n):
            if closed:
                t = P[(i + 1) % n] - P[i - 1]
            else:
                t = P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
            side = U.cross(t)
            side = side.normalized() * (w / 2) if side.length > 1e-9 else Vector((0, w / 2, 0))
            L.append(bm.verts.new(P[i] + side))
            Rr.append(bm.verts.new(P[i] - side))
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            f = bm.faces.new((L[i], Rr[i], Rr[j], L[j]))
            _orient(f, U)
    ob = C.mesh_from_bmesh(name, bm, [M(key)])
    C.shade_flat(ob)
    return _uvm(ob)


def _sheet(name, xs, ys, zf, keyf, keys, smooth=False):
    """A single-sided grid surface facing +Z: vertices (x, y, zf(x, y)), each face's material keyf(cx, cy)
    (an index into keys)."""
    bm = bmesh.new()
    V = [[bm.verts.new((x, y, zf(x, y))) for x in xs] for y in ys]
    for j in range(len(ys) - 1):
        for i in range(len(xs) - 1):
            f = bm.faces.new((V[j][i], V[j][i + 1], V[j + 1][i + 1], V[j + 1][i]))
            _orient(f, Vector((0, 0, 1)))
            f.material_index = keyf((xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2)
    ob = C.mesh_from_bmesh(name, bm, [M(k) for k in keys])
    if smooth:
        C.shade_smooth(ob, 30)
    else:
        C.shade_flat(ob)
    return _uvm(ob)


def _page_top(W, T, board):
    """Top line of an open leaf's text block, x from the gutter (0) to the fore-edge (W): it rises out of
    the gutter, runs nearly flat and rolls down a little at the fore-edge."""
    def f(x):
        u = min(max(x / W, 0.0), 1.0)
        rise = 0.42 + 0.58 * math.sin(min(u / 0.24, 1.0) * math.pi / 2)
        fall = 1.0 - 0.10 * max(0.0, (u - 0.86) / 0.14) ** 2
        return board + T * rise * fall
    return f


def _book_open(name, L, W, T, cover, tilt=9.0, lines=12, initial=True, cradle=True, seed=0):
    """An open rare book, spine along Y at x = 0, each leaf (W wide, L long, text block T thick) rising
    `tilt` degrees from the gutter, resting on a linen-covered V cradle (fabric_cream) on z = 0.
    Pages carry ruled text lines (ink_sepia), a red rubric and, optionally, a gilt illuminated initial."""
    board = 0.0032
    h0 = 0.012 if cradle else 0.0
    us = [0.0, 0.03, 0.07, 0.12, 0.18, 0.24, 0.40, 0.60, 0.80, 0.88, 0.94, 0.98, 1.0]
    parts = []
    rnd = noise.random
    noise.seed_set(seed + 11)
    for sgn in (1, -1):
        f = _page_top(W, T, board)
        top = [(sgn * W * u, f(W * u)) for u in us]
        sec = top + [(sgn * W, board + 0.0004), (0.0, board + 0.0004)]
        if sgn < 0:
            sec = list(reversed(sec))
        leaf = [FH._extrude(name + "_pages", sec, -L / 2, L / 2, "vellum", plane="xz")]
        lo, hi = (min(0.0, sgn * (W + 0.004)), max(0.0, sgn * (W + 0.004)))
        leaf.append(_bx(name + "_board", (lo, -L / 2 - 0.004, 0.0), (hi, L / 2 + 0.004, board), cover, 0.0008, 1, "y"))
        # manuscript text: a narrow block inside real margins (gutter 15 %, fore-edge 20 %, head 11 %, tail
        # 17 %), fine 1.2 mm strokes broken into words, paragraphs of 4-8 lines whose last line runs short,
        # a blank line between paragraphs; the left page opens with a red rubric line
        paths = []
        rub = []
        u_in, u_out = 0.15, 0.80
        y0, y1 = -L / 2 + L * 0.17, L / 2 - L * 0.11
        pitch = (y1 - y0) / max(1, lines - 1)
        para = 3 + int(5 * rnd())
        k = 0
        while k < lines:
            y = y1 - pitch * k
            start = 0.31 if (sgn > 0 and initial and k < 3) else u_in
            last = para == 0
            end = u_in + (u_out - u_in) * (0.30 + 0.45 * rnd()) if last else u_out - 0.012 * rnd()
            u = start
            words = []
            while u < end - 0.02:
                wl = 0.035 + 0.11 * rnd() ** 1.6
                u1_ = min(u + wl, end)
                us_ = (u, (u + u1_) / 2, u1_) if u < 0.25 else (u, u1_)    # words on the page's rise follow it
                words.append([(sgn * W * uu, y, f(W * uu) + 0.0006) for uu in us_])
                u = u1_ + 0.022 + 0.008 * rnd()
            (rub if k == 0 and sgn < 0 else paths).extend(words)
            if last:
                k += 2
                para = 3 + int(5 * rnd())
            else:
                k += 1
                para -= 1
        leaf.append(_ribbons(name + "_text", paths, 0.0012, "ink_sepia"))
        if rub:
            leaf.append(_ribbons(name + "_rubric", rub, 0.0016, "wax_red"))
        if sgn > 0 and initial:
            u0, u1 = 0.15, 0.285
            ya, yb = y1 + 0.004, y1 - 2 * pitch - 0.004
            gx = [W * u for u in (u0, u1)]
            leaf.append(_quads_up(name + "_initial", [(gx[0], gx[1], yb, ya, "gilt")], f, 0.0006))
            leaf.append(_quads_up(name + "_initial_in", [(gx[0] + 0.004, gx[1] - 0.004, yb + 0.004, ya - 0.004,
                                                          "leather_burgundy")], f, 0.0009))
        lf = _join(leaf, name + "_leaf")
        _xf(lf, _T(0, 0, h0) @ _Ry(-tilt * sgn))
        parts.append(lf)
        if cradle:
            t = math.tan(D2R(tilt))
            xe = 0.80 * W * math.cos(D2R(tilt))
            out = [(0.004, 0.0), (xe, 0.0), (xe, h0 + xe * t - 0.0004), (0.004, h0 + 0.004 * t - 0.0004)]
            out = [(sgn * x, z) for x, z in out]
            if sgn < 0:
                out = list(reversed(out))
            parts.append(FH._extrude(name + "_cradle", out, -L * 0.40, L * 0.40, "fabric_cream", plane="xz"))
    sp = C.cylinder(name + "_spine", 0.0062, 0.0062, L + 0.008, (0, 0, h0 - 0.0005), M(cover), 10, rot=C.rotx(90))
    parts.append(_uvm(sp, "y"))
    return _join(parts, name)


def _quads_up(name, rects, zf, off):
    """Flat rectangles (x0, x1, y0, y1, key) lying on the surface z = zf(x) + off, facing +Z."""
    keys = []
    bm = bmesh.new()
    for x0, x1, y0, y1, key in rects:
        if key not in keys:
            keys.append(key)
        vs = [bm.verts.new((x, y, zf(x) + off)) for x, y in ((x0, y0), (x1, y0), (x1, y1), (x0, y1))]
        f = bm.faces.new(vs)
        _orient(f, Vector((0, 0, 1)))
        f.material_index = keys.index(key)
    ob = C.mesh_from_bmesh(name, bm, [M(k) for k in keys])
    C.shade_flat(ob)
    return _uvm(ob)


def _map_folded(name, W=0.30, D=0.22, nx=4, seed=3):
    """A folded antique map lying open: paper margins, a pale wash, four panels folded in a zig-zag (7 mm of
    relief, the panels turned away from the light washed a step darker) and once across; coastlines drawn from
    64-point outlines with two octaves of noise, two rivers, a graticule, a double border with degree ticks,
    all in sepia ink. Centred on the origin, lying on z = 0."""
    b = 0.012
    folds = [W * k / nx for k in range(nx + 1)]
    xs = sorted(set([round(x, 6) for x in folds + [b, W - b]]))
    ys = [0.0, b, D / 2, D - b, D]

    def zf(x, y):
        u = (x / W * nx) % 2.0
        fx = 1.0 - abs(u - 1.0)                       # the outer edges lie on the velvet, crests at W/4, 3W/4
        return 0.0006 + 0.0070 * fx + 0.0012 * (1.0 - abs(2 * y / D - 1.0))

    def keyf(cx, cy):
        if not (b < cx < W - b and b < cy < D - b):
            return 0
        return 2 if int(cx / W * nx) % 2 == 1 else 1      # odd panels slope away from the light

    sheet = _sheet(name + "_sheet", xs, ys, zf, keyf, ["paper", "map_wash", "map_wash_dk"])
    noise.seed_set(seed)
    lift = 0.0006
    coasts = []
    centres = ((0.105, 0.120, 0.058, 72), (0.218, 0.080, 0.034, 48), (0.238, 0.168, 0.019, 32))
    for ci, (cx, cy, r0, n) in enumerate(centres):
        pts = []
        for i in range(n):
            a = TAU * i / n
            q = Vector((math.cos(a), math.sin(a), 0.0))
            rr = r0 * (1.0 + 0.30 * noise.noise(q * 1.6 + Vector((cx * 9, cy * 7, seed + ci)))
                       + 0.10 * noise.noise(q * 5.2 + Vector((cy * 11, cx * 5, seed + 3 + ci))))
            x, y = cx + rr * math.cos(a) * 1.25, cy + rr * math.sin(a)
            pts.append((x, y, zf(x, y) + lift))
        coasts.append(pts)
    ink = [_ribbons(name + "_coast", coasts, 0.0011, "ink_sepia", closed=True)]
    rivers = []
    for (x0, y0, a0, L) in ((0.080, 0.075, 1.35, 0.060), (0.142, 0.150, 2.6, 0.045)):
        pts, x, y, a = [], x0, y0, a0
        for k in range(9):
            pts.append((x, y, zf(x, y) + lift))
            a += 0.55 * noise.noise(Vector((x * 40, y * 40, seed)))
            x += math.cos(a) * L / 8
            y += math.sin(a) * L / 8
        rivers.append(pts)
    ink.append(_ribbons(name + "_river", rivers, 0.0007, "ink_sepia"))
    grid = []
    for gx in (W * 0.25 + 0.01, W * 0.5 + 0.01, W * 0.75 + 0.01):
        grid.append([(gx, y, zf(gx, y) + lift) for y in (b + 0.004, D / 2, D - b - 0.004)])
    for gy in (D * 0.33, D * 0.66):
        grid.append([(x, gy, zf(x, gy) + lift) for x in [b + 0.004] + folds[1:-1] + [W - b - 0.004]])
    ticks = []
    nt = 24
    for i in range(1, nt):
        x = b + (W - 2 * b) * i / nt
        L_ = 0.0035 if i % 3 == 0 else 0.0020
        for y_, d in ((b, 1), (D - b, -1)):
            ticks.append([(x, y_ + d * 0.0004, zf(x, y_) + lift), (x, y_ + d * (0.0004 + L_), zf(x, y_) + lift)])
    for i in range(1, 17):
        y = b + (D - 2 * b) * i / 17
        L_ = 0.0035 if i % 3 == 0 else 0.0020
        for x_, d in ((b, 1), (W - b, -1)):
            ticks.append([(x_ + d * 0.0004, y, zf(x_, y) + lift), (x_ + d * (0.0004 + L_), y, zf(x_, y) + lift)])
    ink.append(_ribbons(name + "_grid", grid + ticks, 0.0006, "ink_sepia"))

    def frame(o):
        x0, x1, y0, y1 = b - o, W - b + o, b - o, D - b + o
        inner = folds[1:-1]                          # vertices on every fold crest and on the cross fold
        loop = ([(x0, y0)] + [(x, y0) for x in inner] + [(x1, y0), (x1, D / 2), (x1, y1)]
                + [(x, y1) for x in reversed(inner)] + [(x0, y1), (x0, D / 2)])
        return [(x, y, zf(x, y) + lift) for x, y in loop]
    ink.append(_ribbons(name + "_border", [frame(0.0), frame(0.0035)], 0.0009, "ink_sepia", closed=True))
    ob = _join([sheet] + ink, name)
    return _xf(ob, _T(-W / 2, -D / 2, 0))


def _manuscript(name, W=0.24, D=0.17, seed=5):
    """A vellum charter: the sheet curls up at both ends, eleven lines of sepia text, a red wax seal on
    a burgundy silk ribbon. Centred on the origin, lying on z = 0."""
    xs = [W * (k / 14.0 - 0.5) for k in range(15)]
    ys = [-D / 2, 0.0, D / 2]
    zf = lambda x, y: 0.0008 + 0.011 * abs(2 * x / W) ** 5  # noqa: E731
    sheet = _sheet(name + "_vellum", xs, ys, zf, lambda cx, cy: 0, ["vellum"], smooth=True)
    noise.seed_set(seed)
    paths = []
    for k in range(11):
        y = D * 0.36 - D * 0.62 * k / 10
        x1 = 0.30 if k != 10 else 0.05
        xx = [W * (-0.32 + (x1 + 0.32) * t) for t in (0.0, 0.5, 1.0)]
        paths.append([(x, y, zf(x, y) + 0.0004) for x in xx])
    parts = [sheet, _ribbons(name + "_text", paths, 0.0021, "ink_sepia")]
    yc = -D * 0.39
    for sx in (-1, 1):
        rib = [(0.0, yc, 0.0013), (sx * 0.012, yc - 0.035, 0.0011), (sx * 0.024, yc - 0.070, 0.0006)]
        parts.append(_ribbons(name + "_ribbon", [rib], 0.009, "leather_burgundy"))
    seal = _lathe(name + "_seal", [(0.0168, 0.0010), (0.0188, 0.0024), (0.0190, 0.0040), (0.0176, 0.0054),
                                    (0.0150, 0.0058), (0.0128, 0.0050), (0.0122, 0.0042), (0.0, 0.0040)], 20, "wax_red",
                  caps=(True, False), smooth=35)
    _xf(seal, _T(0.0, yc, 0.0))
    parts.append(seal)
    return _join(parts, name)


def _magnifier(name):
    """A brass reading glass lying flat: ring and lens centred on the origin, the turned ebonised handle
    along +X. On z = 0."""
    ring = C.torus(name + "_ring", 0.0405, 0.0045, (0, 0, 0.0045), M("brass"), 28, 6)
    lens = C.cylinder(name + "_lens", 0.0385, 0.0385, 0.0036, (0, 0, 0.0045), M("glass"), 28)
    ferrule = _lathe(name + "_ferrule", [(0.0050, 0.0), (0.0060, 0.003), (0.0060, 0.016), (0.0070, 0.020),
                                         (0.0062, 0.024)], 10, "brass", caps=(False, False))
    grip = _lathe(name + "_grip", [(0.0058, 0.0235), (0.0072, 0.040), (0.0074, 0.070), (0.0066, 0.094),
                                   (0.0048, 0.104), (0.0, 0.106)], 10, "walnut_dark", caps=(False, False))
    h = _join([ferrule, grip], name + "_handle")
    _xf(h, _T(0.0405, 0, 0.0072) @ _Ry(90))
    return _join([_uvm(ring), _uvm(lens), h], name)


def _label_card(name, w=0.075, h=0.030, lines=2):
    """A museum tent card on z = 0, its sloping face toward -Y, two lines of caption."""
    a = D2R(68)
    dy = h / math.tan(a)
    sec = [(-dy, 0.0), (0.004, 0.0), (0.0, h)]
    card = FH._extrude(name + "_card", [(y, z) for y, z in sec], -w / 2, w / 2, "label_card", plane="yz")
    nrm = Vector((0, -math.sin(a), math.cos(a)))
    rects = []
    for k in range(lines):
        s0 = 0.55 - 0.25 * k
        p = Vector((0, -dy * (1 - s0), h * s0)) + nrm * 0.0004
        hw = w * (0.36 if k == 0 else 0.26)
        rects.append([p + Vector((-hw, 0, 0)), p + Vector((hw, 0, 0))])
    ink = _ribbons(name + "_ink", rects, 0.0028, "label_ink", up=tuple(nrm))
    return _join([card, ink], name)


def _book_upright(name, L, W, T, key, bands=3):
    """A closed old book standing on its tail, spine facing -Y, thickness along X, on z = 0, x from 0 to T."""
    b = _book_closed(name, L, W, T, key, bands=bands)
    m = Matrix(((0, 0, 1, 0), (0, -1, 0, 0), (1, 0, 0, L / 2), (0, 0, 0, 1)))
    return _xf(b, m)


def _book_row(name, n, seed, keys=("leather_brown", "leather_burgundy", "leather_green", "walnut_dark")):
    """A row of n old books standing side by side from x = 0 along +X, spines at y = -W/2 (toward -Y)."""
    noise.seed_set(seed)
    parts, x = [], 0.0
    for i in range(n):
        r = noise.random()
        L = 0.20 + 0.075 * r
        W = 0.14 + 0.05 * noise.random()
        T = 0.026 + 0.026 * noise.random()
        b = _book_upright(f"{name}{i}", L, W, T, keys[(i * 3 + seed) % len(keys)], bands=3 + i % 2)
        _xf(b, _T(x, -0.08 + W / 2, 0))
        parts.append(b)
        x += T + 0.0015
    ob = _join(parts, name)
    ob["row_length"] = x
    return ob


def _book_on_stand(name, L, W, T, cover, lean=24.0, seed=0):
    """An open book on a walnut reading stand (a sloped board with a moulded lip, a strut behind, a brass
    foot plate), facing -Y, leaning back `lean` degrees from upright. On z = 0."""
    book = _book_open(name + "_book", L, W, T, cover, tilt=11.0, lines=11, initial=(seed % 2 == 0), cradle=False,
                      seed=seed)
    bd = _bx(name + "_board", (-W - 0.012, -L / 2 - 0.010, -0.0105), (W + 0.012, L / 2 + 0.006, -0.0005), "walnut",
             0.002, 1, "x")
    lip = _bx(name + "_lip", (-W - 0.012, -L / 2 - 0.022, -0.0105), (W + 0.012, -L / 2 - 0.010, 0.016), "walnut",
              0.002, 1, "x")
    rot = _Rx(90.0 - lean)
    parts = [_xf(book, rot), _xf(bd, rot), _xf(lip, rot)]
    zmin = min(v.co.z for p in parts[1:] for v in p.data.vertices)
    bt = 0.005
    for p in parts:
        _xf(p, _T(0, 0, bt - zmin))
    P = rot @ Vector((0, L * 0.10, -0.0105)) + Vector((0, 0, bt - zmin))
    strut = _bx(name + "_strut", (-0.011, P.y - 0.002, bt), (0.011, P.y + 0.004, P.z + 0.006), "walnut", 0.0015, 1, "z")
    ys = [v.co.y for p in parts[1:] for v in p.data.vertices]
    foot = _bx(name + "_foot", (-W * 0.6, min(ys) - 0.004, 0.0), (W * 0.6, P.y + 0.012, bt), "brass", 0.0015, 1, "x")
    return _join(parts + [strut, foot], name)


def _globe_model(name, r=0.11, stand_h=0.10, seed=2, res=(32, 16), front_lon=-25.0):
    """A table globe: the same antique world map as the rotunda's floor globe (props_signage's 'globe_map'
    material and its equirectangular UVs: u = longitude, v = latitude), a full brass meridian ring resting in
    the cup of a turned walnut stand, the polar axis tilted 23.5 degrees, `front_lon` facing the viewer (-Y).
    On z = 0."""
    import props_signage as PS                     # its palette additions register at import; map built once
    gm = PS._map_mat("globe_map")
    rm = r + 0.010
    zc = stand_h + rm + 0.0032
    nu, nv = res
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rows = []
    for j in range(1, nv):
        la = -math.pi / 2 + math.pi * j / nv
        rows.append([bm.verts.new((r * math.cos(la) * math.cos(-math.pi + TAU * i / nu),
                                   r * math.cos(la) * math.sin(-math.pi + TAU * i / nu), r * math.sin(la)))
                     for i in range(nu)])
    sp, np_ = bm.verts.new((0, 0, -r)), bm.verts.new((0, 0, r))

    def face(vs, uvs):
        f = bm.faces.new(vs)
        for lp, t in zip(f.loops, uvs):
            lp[uvl].uv = t
        return f
    for j in range(nv - 2):
        a, b_ = rows[j], rows[j + 1]
        for i in range(nu):
            k = (i + 1) % nu
            face((a[i], a[k], b_[k], b_[i]), [(i / nu, (j + 1) / nv), ((i + 1) / nu, (j + 1) / nv),
                                               ((i + 1) / nu, (j + 2) / nv), (i / nu, (j + 2) / nv)])
    for i in range(nu):
        k = (i + 1) % nu
        face((sp, rows[0][k], rows[0][i]), [((i + 0.5) / nu, 0.0), ((i + 1) / nu, 1 / nv), (i / nu, 1 / nv)])
        face((rows[-1][i], rows[-1][k], np_), [(i / nu, (nv - 1) / nv), ((i + 1) / nu, (nv - 1) / nv),
                                               ((i + 0.5) / nu, 1.0)])
    for f in bm.faces:
        f.normal_update()
        if f.normal.dot(f.calc_center_median()) < 0:
            f.normal_flip()
    g = C.mesh_from_bmesh(name + "_sphere", bm, [gm])
    C.shade_smooth(g, 80)
    spin = math.radians(-90.0 - front_lon)
    _xf(g, _T(0, 0, zc) @ _Ry(23.5) @ Matrix.Rotation(spin, 4, "Z"))
    mer = C.torus(name + "_meridian", rm, 0.0032, (0, 0, zc), M("brass"), 32, 4, rot=C.rotx(90))
    axis = C.cylinder(name + "_axis", 0.0024, 0.0024, 2 * rm, (0, 0, 0), M("brass"), 8)
    _xf(axis, _T(0, 0, zc) @ _Ry(23.5))
    stand = _lathe(name + "_stand", [(0.0, 0.0), (0.072, 0.0), (0.074, 0.006), (0.066, 0.014), (0.040, 0.022),
                                     (0.020, 0.030), (0.016, 0.040), (0.024, stand_h * 0.55), (0.016, stand_h * 0.78),
                                     (0.020, stand_h * 0.84), (0.011, stand_h * 0.93), (0.013, stand_h + 0.002),
                                     (0.0, stand_h + 0.002)], 16, "walnut", caps=(True, False))
    return _join([g, _uvm(mer), _uvm(axis), stand], name)


def _armillary(name, r=0.115, stand_h=0.12):
    """An armillary sphere: equator, two colures and a broad ecliptic band in brass round a small gilt earth,
    on a polar axis tilted 23.5 degrees, carried by a turned walnut stand with a brass collar. On z = 0."""
    zc = stand_h + r
    parts = []
    tilt = _Ry(23.5)
    for nm, rot, rr, mi in (("eq", Matrix.Identity(4), r, 0.0030), ("col1", _Rx(90), r, 0.0028),
                            ("col2", _Ry(90), r, 0.0028), ("ecl", _Rx(23.5), r - 0.002, 0.0042)):
        t = C.torus(name + "_" + nm, rr, mi, (0, 0, 0), M("brass"), 26, 4)
        if nm == "ecl":
            _xf(t, Matrix.Diagonal((1.0, 1.0, 2.2, 1.0)))
        _xf(t, rot)
        parts.append(_uvm(t))
    earth = C.sphere(name + "_earth", 0.020, (0, 0, 0), M("gilt"), 14, 8)
    axis = C.cylinder(name + "_axis", 0.0022, 0.0022, 2 * r + 0.05, (0, 0, 0), M("brass"), 8)
    parts += [_uvm(earth), _uvm(axis)]
    for p in parts:
        _xf(p, _T(0, 0, zc) @ tilt)
    stand = _lathe(name + "_stand", [(0.0, 0.0), (0.066, 0.0), (0.068, 0.006), (0.060, 0.013), (0.034, 0.020),
                                     (0.016, 0.030), (0.014, stand_h * 0.45), (0.022, stand_h * 0.62),
                                     (0.012, stand_h * 0.80), (0.0, stand_h * 0.80)], 18, "walnut", caps=(True, False))
    collar = _lathe(name + "_collar", [(0.011, stand_h * 0.79), (0.016, stand_h * 0.82), (0.008, zc - r * 0.98),
                                       (0.0, zc - r * 0.98)], 12, "brass", caps=(True, False))
    return _join(parts + [stand, collar], name)


def _telescope(name):
    """A brass library telescope on a turned walnut pillar with a brass yoke: tube along X, on z = 0."""
    prof = [(0.0, 0.0), (0.0075, 0.0), (0.0080, 0.004), (0.0105, 0.010), (0.0105, 0.030), (0.0140, 0.034),
            (0.0140, 0.050), (0.0160, 0.054), (0.0160, 0.150), (0.0185, 0.156), (0.0185, 0.170), (0.0200, 0.174),
            (0.0200, 0.350), (0.0225, 0.356), (0.0225, 0.372), (0.0250, 0.378), (0.0250, 0.430), (0.0230, 0.434),
            (0.0215, 0.434), (0.0, 0.432)]
    tube = _lathe(name + "_tube", prof, 16, "brass", caps=(False, False))
    _xf(tube, _T(-0.22, 0, 0.255) @ _Ry(90))
    pillar = _lathe(name + "_pillar", [(0.0, 0.0), (0.075, 0.0), (0.077, 0.007), (0.068, 0.015), (0.036, 0.024),
                                       (0.018, 0.036), (0.016, 0.110), (0.024, 0.140), (0.014, 0.180),
                                       (0.0, 0.180)], 18, "walnut", caps=(True, False))
    yoke = LC._tube(name + "_yoke", [Vector((0, -0.024, 0.255)), Vector((0, -0.026, 0.215)), Vector((0, 0.0, 0.180)),
                                     Vector((0, 0.026, 0.215)), Vector((0, 0.024, 0.255))], 0.0035, sides=6, key="brass")
    pivot = C.cylinder(name + "_pivot", 0.0055, 0.0055, 0.060, (0, 0, 0.255), M("brass"), 10, rot=C.rotx(90))
    return _join([tube, pillar, _uvm(yoke), _uvm(pivot)], name)


def _solander(name, w, d, h, key, label=True):
    """A solander (archival) box lying flat: cloth-and-leather body with the lid seam, a gilt-ruled leather
    spine label on the -Y face and a brass catch. On z = 0."""
    parts = [_bx(name + "_tray", (-w / 2, -d / 2, 0.0), (w / 2, d / 2, h * 0.62), key, 0.002, 1, "x"),
             _bx(name + "_lid", (-w / 2 - 0.002, -d / 2 - 0.002, h * 0.62 + 0.0005), (w / 2 + 0.002, d / 2 + 0.002, h),
                 key, 0.0025, 1, "x")]
    if label:
        parts.append(_bx(name + "_label", (-w * 0.22, -d / 2 - 0.0026, h * 0.18), (w * 0.22, -d / 2 - 0.001, h * 0.52),
                         "leather_burgundy" if key != "leather_burgundy" else "leather_green", 0.0, 1, "x"))
        parts.append(_quads(name + "_rule", [(-w * 0.18, w * 0.18, h * 0.40, h * 0.415, "gilt"),
                                              (-w * 0.18, w * 0.18, h * 0.27, h * 0.285, "gilt")], -d / 2 - 0.0028))
    parts.append(_bx(name + "_catch", (-0.010, -d / 2 - 0.0048, h * 0.55), (0.010, -d / 2 - 0.0018, h * 0.80), "brass",
                     0.0008, 1, "x"))
    return _join(parts, name)


# ---------------------------------------------------------------------------
# table_vitrine
# ---------------------------------------------------------------------------

VT_W, VT_D, VT_H = 1.6, 0.9, 0.95
VT_HX, VT_HY = 0.785, 0.435        # case outer faces: the 15 mm base ogee lands exactly on the 1.6 x 0.9 footprint
VT_AX, VT_AY = 0.720, 0.370        # apron outer faces: the stand is set in under the case
VT_AZ0, VT_ZU = 0.640, 0.720       # apron bottom, case underside
VT_T = 0.022                       # case wall thickness
VT_BED = 0.800                     # top of the velvet display bed: the exhibits sit close under the glass
VT_ZF, VT_ZB = 0.860, 0.920        # wall tops at the front and back (6 cm and 12 cm over the bed): the lid rises
                                   # 3.8 deg to the back and its top stays at 0.95
VT_LID_T = 0.026
VT_SLOPE = math.atan2(VT_ZB - VT_ZF, 2 * VT_HY)


def _vt_top(y):
    return VT_ZF + (y + VT_HY) / (2 * VT_HY) * (VT_ZB - VT_ZF)


def _vt_wall(name, lo, hi, grain):
    """A case wall box whose top follows the lid slope."""
    ob = _bx(name, lo, (hi[0], hi[1], VT_ZB), "walnut", 0.0025, 1, grain)
    z0 = lo[2]
    for v in ob.data.vertices:
        t = (v.co.z - z0) / (VT_ZB - z0)
        v.co.z = z0 + t * (_vt_top(v.co.y) - z0)
    ob.data.update()
    return ob


def _vt_lid():
    """The glazed lid: a moulded walnut frame (thumbnail outer edge, ovolo sight edge, a rebate below) with a
    glass pane, built flat, then tilted onto the wall tops."""
    Ls = 2 * VT_HY / math.cos(VT_SLOPE)
    hx, hy = VT_HX + 0.006, Ls / 2 + 0.006
    prof = [(0.0, 0.0), (0.0, 0.013), (0.0016, 0.0195), (0.0052, 0.0240), (0.0100, VT_LID_T),
            (0.0520, VT_LID_T), (0.0548, 0.0245), (0.0568, 0.0205), (0.0575, 0.0160), (0.0575, 0.0120),
            (0.0450, 0.0120), (0.0450, 0.0)]
    frame = FH._slab("vt_lidframe", _rect(hx, hy), 0.008, prof, 2, "walnut", closed_profile=True)
    _uvm(frame, "x")
    glass = _bx("vt_glass", (-hx + 0.0455, -hy + 0.0455, 0.0045), (hx - 0.0455, hy - 0.0455, 0.0110), "glass_display", 0.0, 1)
    hasp = _bx("vt_hasp", (-0.018, -hy - 0.0025, 0.002), (0.018, -hy + 0.010, 0.017), "brass", 0.0012, 1, "x")
    lid = _join([frame, glass, hasp], "vt_lid")
    return _xf(lid, _T(0, 0, (VT_ZF + VT_ZB) / 2) @ Matrix.Rotation(VT_SLOPE, 4, "X"))


def _vt_contents():
    """The exhibits on the velvet bed (z = 0 there): two open rare books on linen cradles, a folded map,
    a sealed vellum charter, a reading glass and tent cards."""
    parts = []
    a = _book_open("vt_bookA", 0.30, 0.215, 0.026, "leather_brown", tilt=8.0, lines=26, initial=True, seed=1)
    parts.append(_xf(a, _T(-0.445, 0.050, 0) @ _Rz(-2)))
    b = _book_open("vt_bookB", 0.235, 0.165, 0.020, "leather_burgundy", tilt=9.0, lines=21, initial=False, seed=4)
    parts.append(_xf(b, _T(0.495, 0.060, 0) @ _Rz(3)))
    mp = _map_folded("vt_map", 0.30, 0.22)
    parts.append(_xf(mp, _T(0.040, 0.140, 0) @ _Rz(4)))
    ms = _manuscript("vt_charter", 0.24, 0.17)
    parts.append(_xf(ms, _T(0.035, -0.150, 0) @ _Rz(-5)))
    mg = _magnifier("vt_glass")
    parts.append(_xf(mg, _T(0.300, -0.230, 0) @ _Rz(152)))
    card = _label_card("vt_card")
    for x, y in ((-0.445, -0.290), (0.495, -0.240), (-0.165, -0.290)):
        parts.append(_xf(_copy(card), _T(x, y, 0)))
    C.remove(card)
    return parts


def build_table_vitrine(item=None):
    """The rotunda's 1.6 x 0.9 x 0.95 m display table (see the module docstring). Front -Y."""
    parts = _table_frame(VT_AX, VT_AY, VT_AZ0, VT_ZU, VT_AZ0, drawers=(), s=1.0)
    hx, hy, t = VT_HX, VT_HY, VT_T
    parts.append(_vt_wall("vt_front", (-hx + t, -hy, VT_ZU), (hx - t, -hy + t, 0), "x"))
    parts.append(_vt_wall("vt_back", (-hx + t, hy - t, VT_ZU), (hx - t, hy, 0), "x"))
    for sx in (-1, 1):
        parts.append(_vt_wall("vt_side", (min(sx * hx, sx * (hx - t)), -hy, VT_ZU),
                              (max(sx * hx, sx * (hx - t)), hy, 0), "y"))
    # applied moulded panels on the four walls (a mitred bead-and-ogee frame, 28 mm in from each edge)
    bead = [(0.0, 0.0), (0.0, 0.0030), (0.0025, 0.0052), (0.0060, 0.0062), (0.0095, 0.0048), (0.0110, 0.0020),
            (0.0110, 0.0)]
    m_, zb_ = 0.030, VT_ZU + 0.034
    for sy in (-1, 1):
        y = sy * hy
        zt = _vt_top(y) - 0.022
        cs = [(-hx + 0.06, y, zb_), (hx - 0.06, y, zb_), (hx - 0.06, y, zt), (-hx + 0.06, y, zt)]
        if sy > 0:
            cs = cs[::-1]
        parts.append(_uvm(FH._mitre_loft("vt_panel", cs, (0, sy, 0), bead, "walnut"), "x"))
    for sx in (-1, 1):
        x = sx * hx
        y0, y1 = -hy + m_ + 0.02, hy - m_ - 0.02
        cs = [(x, y1, zb_), (x, y0, zb_), (x, y0, _vt_top(y0) - 0.022), (x, y1, _vt_top(y1) - 0.022)]
        if sx > 0:
            cs = cs[::-1]
        parts.append(_uvm(FH._mitre_loft("vt_panel", cs, (sx, 0, 0), bead, "walnut"), "y"))
    # case floor and velvet bed
    parts.append(_bx("vt_floor", (-hx + t + 0.0005, -hy + t + 0.0005, VT_ZU), (hx - t - 0.0005, hy - t - 0.0005,
                                                                                VT_BED - 0.012), "walnut", 0.0, 1, "x"))
    parts.append(_bx("vt_bed", (-hx + t + 0.0008, -hy + t + 0.0008, VT_BED - 0.0115), (hx - t - 0.0008, hy - t - 0.0008,
                                                                                        VT_BED), "velvet_burgundy",
                     0.002, 1))
    # base moulding round the foot of the case (an ogee over a fillet)
    ogee = [(0.003, 0.0), (-0.015, 0.0), (-0.015, 0.005), (-0.0135, 0.0085), (-0.0100, 0.0125), (-0.0065, 0.0160),
            (-0.0040, 0.0205), (-0.0030, 0.0250), (0.003, 0.0285)]
    parts.append(_mitre_rect("vt_base", hx, hy, VT_ZU, ogee, "walnut"))
    # a gilt fillet line round the velvet bed's edge, against the walls
    parts.append(_mitre_rect("vt_fillet", hx - t, hy - t, VT_BED - 0.0005,
                             [(0.0, 0.0), (0.006, 0.0), (0.006, 0.0035), (0.0, 0.0035)][::-1], "gilt"))
    parts.append(_vt_lid())
    # lock: an escutcheon with a keyhole on the front wall, under the lid's hasp
    zl = (VT_ZU + VT_ZF) / 2 + 0.018
    esc = _lathe("vt_esc", [(0.0, 0.0), (0.0155, 0.0), (0.0160, 0.0012), (0.0135, 0.0030), (0.0, 0.0034)], 18,
                 "brass", caps=(False, False))
    kh = _bx("vt_keyhole", (-0.0026, -0.0026, 0.0034), (0.0026, 0.0026, 0.0037), "iron", 0.0, 1)
    ks = _bx("vt_keyslot", (-0.0011, -0.0095, 0.0034), (0.0011, -0.0012, 0.0037), "iron", 0.0, 1)
    lock = _join([esc, kh, ks], "vt_lock")
    parts.append(_xf(lock, _T(0, -hy, zl) @ _Rx(90)))
    # hinges: three brass knuckles along the back edge of the lid, leaves on the back wall
    for x in (-0.55, 0.0, 0.55):
        k = C.cylinder("vt_knuckle", 0.0048, 0.0048, 0.060, (x, hy + 0.0015, VT_ZB + 0.004), M("brass"), 10,
                       rot=C.roty(90))
        parts.append(_uvm(k, "x"))
        parts.append(_bx("vt_leaf", (x - 0.028, hy - 0.0002, VT_ZB - 0.030), (x + 0.028, hy + 0.0018, VT_ZB + 0.002),
                         "brass", 0.0006, 1, "x"))
    for p in _vt_contents():
        parts.append(_xf(p, _T(0, 0, VT_BED)))
    return _join(parts, "Furniture_Table_Vitrine_01")


# ---------------------------------------------------------------------------
# cabinet_display
# ---------------------------------------------------------------------------

CB_W, CB_D, CB_H = 3.6, 0.55, 2.3
CB_HX, CB_BACK = 1.80, 0.275
CB_CX = 1.780              # lower chest carcass sides
CB_CF = -0.235             # lower chest carcass front (doors 20 mm proud of it)
CB_PL = 0.173              # plinth top (the hall bookcases' rich plinth profile)
CB_W0, CB_W1 = 0.800, 0.838  # moulded waist top
CB_UX = 1.715              # upper case sides
CB_UF = -0.135             # upper case front (posts' face)
CB_UZ0 = 0.846             # display floor (felt) inside the upper case
CB_FZ0, CB_FZ1 = 2.068, 2.170  # frieze
CB_POSTS = (-1.685, -0.840, 0.0, 0.840, 1.685)
CB_OPEN = ((-1.655, -0.865), (-0.815, -0.025), (0.025, 0.815), (0.865, 1.655))
CB_SHELVES = (1.262, 1.662)
CB_GLASS_T = 0.008

GLAZE_PROF = [(0.0, 0.0), (0.0, 0.0015), (0.0025, 0.0032), (0.0045, 0.0058), (0.0055, 0.0090), (0.0055, 0.0125),
              (0.0055, 0.022)]


def _glazing_bar_sec(off=0.0):
    yc, r = 0.0078, 0.0058
    sec = [(0.021 - off, -0.0042), (0.0105, -0.0042)]
    sec += [(yc - r * math.cos(D2R(a)) - off, r * math.sin(D2R(a))) for a in (-90, -60, -30, 0, 30, 60, 90)]
    sec += [(0.0105, 0.0042), (0.021 - off, 0.0042)]
    return sec


CB_MARGIN = 0.110          # Regency margin lights: vertical bars this far in from each stile's sight edge


def _cb_glazed_door(name, w, h, hz=(), margin=CB_MARGIN):
    """A glazed door leaf in the XZ plane (face y = 0, back y = 0.022, x -w/2..w/2, z 0..h): a moulded open
    frame (ovolo sticking), fine astragal glazing bars and the glass behind. The glazing is the Regency
    'margin light' pattern: two vertical bars `margin` in from the stiles leave a wide central light (0.46 m
    clear, so no exhibit is cut by a bar), and the horizontal bars stand at the heights hz (door-local), which
    the cabinet sets on its glass shelves so each bar hides its shelf's front edge."""
    st, rb, rt = 0.045, 0.062, 0.050
    frame = _panel_unit(name + "_frame", w, h, (st, rb, rt), prof=GLAZE_PROF, field=False, back=0.022)
    parts = [frame]
    x0, x1, z0, z1 = -w / 2 + st, w / 2 - st, rb, h - rt
    for z in hz:
        sec = [(y, z + dz) for y, dz in _glazing_bar_sec()]
        bar = BC._extrude_x(name + "_hbar", sec, x0 - 0.002, x1 + 0.002, "walnut", 40)
        parts.append(_uvm(bar, "x"))
    for x in (x0 + margin, x1 - margin):
        sec = [(y, dz) for y, dz in _glazing_bar_sec(0.0005)]
        bar = BC._extrude_x(name + "_vbar", sec, z0 - 0.002, z1 + 0.002, "walnut", 40)
        _uvm(bar, "x")
        _xf(bar, _T(x, 0, 0) @ _Ry(-90))
        parts.append(bar)
    parts.append(_bx(name + "_glass", (x0 - 0.006, 0.0225, z0 - 0.006), (x1 + 0.006, 0.0225 + 0.004, z1 + 0.006),
                     "glass_display", 0.0, 1))
    return _join(parts, name)


def _cb_dentils(name, path_pts, z0, z1, depth=0.012, w=0.012, pitch=0.029):
    """Dentil blocks along an open polyline (front faces outward, to the path's right with Z up)."""
    bm = bmesh.new()
    P = [Vector(p) for p in path_pts]
    for a, b in zip(P, P[1:]):
        d = b - a
        L = d.length
        t = d.normalized()
        o = Vector((t.y, -t.x, 0.0))          # outward (right of the path)
        n = int(L / pitch)
        start = (L - n * pitch) / 2 + pitch / 2
        for i in range(n):
            c = a + t * (start + i * pitch)
            q = [c - t * w / 2, c + t * w / 2]
            lo = [bm.verts.new(q[0] + Vector((0, 0, z0))), bm.verts.new(q[1] + Vector((0, 0, z0))),
                  bm.verts.new(q[1] + o * depth + Vector((0, 0, z0))), bm.verts.new(q[0] + o * depth + Vector((0, 0, z0)))]
            hi = [bm.verts.new(v.co + Vector((0, 0, z1 - z0))) for v in lo]
            cen = (c + o * (depth / 2)) + Vector((0, 0, (z0 + z1) / 2))
            for fv in ((lo[3], lo[2], lo[1], lo[0]), (lo[1], lo[2], hi[2], hi[1]), (lo[2], lo[3], hi[3], hi[2]),
                       (lo[3], lo[0], hi[0], hi[3])):
                f = bm.faces.new(fv)
                _orient(f, f.calc_center_median() - cen)
    ob = C.mesh_from_bmesh(name, bm, [M("walnut")])
    C.shade_flat(ob)
    return _uvm(ob, "z")


def _cb_display():
    """The exhibits, per bay (bay centres x = -1.26, -0.42, 0.42, 1.26): (object, x, y, level, rotZ). Every hero
    piece (globes, armillary, telescope, open books on stands) sits inside its door's central margin-glazed light
    (+-0.232 m clear of the bars); only book rows and boxes may run behind a bar."""
    lv = (CB_UZ0, CB_SHELVES[0] + CB_GLASS_T / 2, CB_SHELVES[1] + CB_GLASS_T / 2)
    out = []
    globe = _globe_model("cb_globe", 0.105, 0.105, res=(32, 16), front_lon=-25.0)
    out.append((globe, -1.26, 0.08, lv[0], -12))
    arm = _armillary("cb_armillary", 0.105, 0.10)
    out.append((arm, -0.42, 0.08, lv[2], 15))
    tel = _telescope("cb_telescope")
    out.append((tel, 0.42, 0.10, lv[1], -6))
    bk1 = _book_on_stand("cb_standA", 0.30, 0.20, 0.026, "leather_brown", lean=26, seed=0)
    out.append((bk1, 0.42, 0.06, lv[0], 0))
    bk2 = _book_on_stand("cb_standB", 0.22, 0.155, 0.020, "leather_burgundy", lean=24, seed=1)
    out.append((bk2, -0.42, 0.07, lv[1], 4))
    bk3 = _book_on_stand("cb_standC", 0.20, 0.140, 0.018, "leather_green", lean=24, seed=2)
    out.append((bk3, -1.26, 0.08, lv[2], -3))
    row1 = _book_row("cb_rowA", 8, 3)
    out.append((row1, -1.26 - row1["row_length"] / 2, 0.10, lv[1], 0))
    row2 = _book_row("cb_rowB", 7, 6)
    out.append((row2, 0.42 - row2["row_length"] / 2, 0.10, lv[2], 0))
    sol = [_solander("cb_solA", 0.34, 0.26, 0.070, "leather_green"), _solander("cb_solB", 0.32, 0.25, 0.062,
                                                                                   "leather_brown")]
    out.append((sol[0], -0.42, 0.06, lv[0], 2))
    out.append((sol[1], -0.42, 0.065, lv[0] + 0.0705, -3))
    sol2 = [_solander("cb_solC", 0.30, 0.24, 0.085, "leather_burgundy"), _solander("cb_solD", 0.28, 0.23, 0.070,
                                                                                       "leather_green")]
    out.append((sol2[0], 1.26, 0.05, lv[0], 0))
    out.append((sol2[1], 1.26 + 0.004, 0.055, lv[0] + 0.0855, -4))
    gl2 = _globe_model("cb_globe2", 0.080, 0.090, seed=7, res=(28, 14), front_lon=95.0)
    out.append((gl2, 1.26, 0.08, lv[1], 20))
    bk4 = _book_on_stand("cb_standD", 0.22, 0.155, 0.022, "leather_brown", lean=25, seed=4)
    out.append((bk4, 1.26 + 0.05, 0.07, lv[2], -4))
    row3 = _book_row("cb_rowC", 4, 9)
    out.append((row3, 1.26 - 0.345, 0.10, lv[2], 0))
    tel_card = _label_card("cb_card")
    out.append((tel_card, 0.42 + 0.15, -0.06, lv[1], 0))
    c2 = _copy(tel_card)
    out.append((c2, -1.26 + 0.15, -0.06, lv[0], 0))
    return out


def build_cabinet_display(item=None):
    """The rotunda's 3.6 x 0.55 x 2.3 m freestanding display cabinet (see the module docstring). Front -Y, its
    back (y = +0.275) toward the wall. Carries light_points (one per bay, under the LED channels)."""
    parts = []
    # plinth: the hall bookcases' rich plinth (toe bead, cyma reversa) swept round the front and sides
    pf, px = -0.262, 1.792
    path = [(-px, CB_BACK, 0.0), (-px, pf, 0.0), (px, pf, 0.0), (px, CB_BACK, 0.0)]
    parts.append(_uvm(BC._ob("cb_plinth", BC._sweep_bm(BC._profile_plinth_rich(), path), "walnut", 40), "x"))
    # lower chest: carcass and four fielded-panel doors with brass knobs and escutcheons
    parts.append(_bx("cb_carcass", (-CB_CX, CB_CF, CB_PL), (CB_CX, CB_BACK, CB_W0), "walnut", 0.003, 1, "z"))
    gap = 0.004
    dw = (2 * (CB_CX - 0.004) - 3 * gap) / 4
    dz0, dz1 = CB_PL + 0.010, CB_W0 - 0.010
    door = _panel_unit("cb_door", dw, dz1 - dz0, (0.078, 0.090, 0.082), back=0.020)
    knob = _knob("cb_knob", 0.030, 0.0125)
    esc = _join([_lathe("cb_esc", [(0.0, 0.0), (0.0120, 0.0), (0.0125, 0.0010), (0.0105, 0.0026), (0.0, 0.0030)], 14,
                        "brass", caps=(False, False)),
                 _bx("cb_kh", (-0.0020, -0.0020, 0.0030), (0.0020, 0.0020, 0.0033), "iron", 0.0, 1),
                 _bx("cb_ks", (-0.0009, -0.0075, 0.0030), (0.0009, -0.0010, 0.0033), "iron", 0.0, 1)], "cb_escm")
    for k in range(4):
        xc = -CB_CX + 0.004 + dw / 2 + k * (dw + gap)
        parts.append(_xf(_copy(door), _T(xc, CB_CF - 0.020, dz0)))
        # knobs on the meeting stiles of each pair (doors 0|1 and 2|3)
        if k in (0, 2):
            xs = xc + dw / 2 - 0.040
        else:
            xs = xc - dw / 2 + 0.040
        if k in (0, 1, 2, 3):
            parts.append(_xf(_copy(knob), _T(xs, CB_CF - 0.020, dz0 + (dz1 - dz0) * 0.62) @ _Rx(90)))
        if k in (1, 3):
            parts.append(_xf(_copy(esc), _T(xs, CB_CF - 0.020, dz0 + (dz1 - dz0) * 0.53) @ _Rx(90)))
    for o in (door, knob, esc):
        C.remove(o)
    # waist top with a thumbnail edge over a small cove
    waist = _pslab("cb_waist", _rect_ring(CB_HX, CB_BACK, 0.006, 2), _edge_profile(CB_W0, CB_W1, cove=0.010, thumb=0.008),
                   ["walnut"])
    parts.append(_uvm(waist, "x"))
    # upper case: posts, bottom rail, glazed sides, the green-lined back, top board, frieze, cornice, dentils
    for x in CB_POSTS:
        hw = 0.030 if abs(x) > 1.6 else 0.025
        parts.append(_bx("cb_post", (x - hw, CB_UF, CB_W1), (x + hw, CB_UF + 0.050, CB_FZ0), "walnut", 0.0025, 1,
                         "z"))
        if abs(x) > 1.6:
            parts.append(_bx("cb_backpost", (x - hw, CB_BACK - 0.050, CB_W1), (x + hw, CB_BACK, CB_FZ1), "walnut", 0.0025,
                             1, "z"))
    for x0, x1 in CB_OPEN:
        parts.append(_bx("cb_brail", (x0 - 0.001, CB_UF + 0.002, CB_W1), (x1 + 0.001, CB_UF + 0.034, CB_UZ0 + 0.020),
                         "walnut", 0.002, 1, "x"))
    for sx in (-1, 1):
        xo, xi = sx * CB_UX, sx * (CB_UX - 0.024)
        lo, hi = min(xo, xi), max(xo, xi)
        parts.append(_bx("cb_srail", (lo, CB_UF + 0.050, CB_W1), (hi, CB_BACK - 0.050, CB_UZ0 + 0.020), "walnut", 0.002,
                         1, "y"))
        gx = sx * (CB_UX - 0.013)
        parts.append(_bx("cb_sglass", (gx - 0.002, CB_UF + 0.049, CB_UZ0 + 0.019), (gx + 0.002, CB_BACK - 0.049,
                                                                                    CB_FZ0 + 0.001), "glass_display", 0.0, 1))
        # glazing bead inside the side glass
        for y0, y1, z0, z1 in ((CB_UF + 0.050, CB_BACK - 0.050, CB_UZ0 + 0.020, CB_UZ0 + 0.032),
                               (CB_UF + 0.050, CB_BACK - 0.050, CB_FZ0 - 0.012, CB_FZ0)):
            bx0, bx1 = sorted((sx * (CB_UX - 0.0155), sx * (CB_UX - 0.024)))
            parts.append(_bx("cb_sbead", (bx0, y0, z0), (bx1, y1, z1), "walnut", 0.001, 1, "y"))
    parts.append(_bx("cb_lining", (-CB_UX + 0.024, CB_BACK - 0.020, CB_W1), (CB_UX - 0.024, CB_BACK - 0.002, CB_FZ1),
                     "baize_green", 0.0, 1))
    parts.append(_bx("cb_felt", (-CB_UX + 0.0245, CB_UF + 0.035, CB_W1 - 0.0005), (CB_UX - 0.0245, CB_BACK - 0.0205,
                                                                                  CB_UZ0), "felt_green", 0.001, 1))
    parts.append(_bx("cb_ceiling", (-CB_UX, CB_UF + 0.020, CB_FZ1 - 0.022), (CB_UX, CB_BACK, CB_FZ1), "walnut", 0.0, 1,
                     "x"))
    parts.append(_bx("cb_frieze", (-CB_UX, CB_UF, CB_FZ0), (CB_UX, CB_UF + 0.022, CB_FZ1), "walnut", 0.002, 1, "x"))
    for sx in (-1, 1):
        lo, hi = sorted((sx * CB_UX, sx * (CB_UX - 0.022)))
        parts.append(_bx("cb_sfrieze", (lo, CB_UF + 0.022, CB_FZ0), (hi, CB_BACK, CB_FZ1), "walnut", 0.002, 1, "y"))
    cpath = [(-CB_UX, CB_BACK, CB_FZ1), (-CB_UX, CB_UF, CB_FZ1), (CB_UX, CB_UF, CB_FZ1), (CB_UX, CB_BACK, CB_FZ1)]
    corn = BC._sweep_bm(BC._profile_cornice_rich(0.855), cpath)
    parts.append(_uvm(BC._ob("cb_cornice", corn, "walnut", 40), "x"))
    parts.append(_cb_dentils("cb_dentils", [(-CB_UX, CB_BACK - 0.03, 0), (-CB_UX, CB_UF, 0), (CB_UX, CB_UF, 0),
                                            (CB_UX, CB_BACK - 0.03, 0)], CB_FZ1 - 0.022, CB_FZ1 - 0.0005))
    # paterae on the frieze over each post
    pat = _rd_paterae()
    for x in CB_POSTS:
        parts.append(_xf(_copy(pat), _T(x, CB_UF, (CB_FZ0 + CB_FZ1) / 2 - 0.008) @ _Rx(90)))
    C.remove(pat)
    # glazed doors, one per bay, with a brass knob on the closing stile
    dknob = _knob("cb_dknob", 0.024, 0.010, seg=10)
    for k, (x0, x1) in enumerate(CB_OPEN):
        w = x1 - x0 - 0.004
        h = CB_FZ0 - (CB_UZ0 + 0.020) - 0.004
        dz0 = CB_UZ0 + 0.022
        d = _cb_glazed_door(f"cb_gdoor{k}", w, h, hz=[z - dz0 for z in CB_SHELVES])
        parts.append(_xf(d, _T((x0 + x1) / 2, CB_UF + 0.002, dz0)))
        xs = x1 - 0.024 if k % 2 == 0 else x0 + 0.024
        parts.append(_xf(_copy(dknob), _T(xs, CB_UF + 0.002, CB_UZ0 + 0.022 + h * 0.48) @ _Rx(90)))
    C.remove(dknob)
    # glass shelves on brass standards and brackets, LED channels under the ceiling
    std_x = (-CB_UX + 0.034, -0.840, 0.0, 0.840, CB_UX - 0.034)
    for x in std_x:
        parts.append(_bx("cb_standard", (x - 0.008, CB_BACK - 0.0265, CB_UZ0), (x + 0.008, CB_BACK - 0.0198,
                                                                                CB_FZ1 - 0.022), "brass", 0.0008, 1, "z"))
    stud = C.cylinder("cb_stud", 0.0042, 0.0042, 0.016, (0, 0, 0), M("brass"), 8, rot=C.rotx(90))
    _uvm(stud)
    sy0, sy1 = CB_UF + 0.052, CB_BACK - 0.0268
    lpts = []
    for k, (x0, x1) in enumerate(CB_OPEN):
        gx0, gx1 = std_x[k] + 0.0035, std_x[k + 1] - 0.0035
        for z in CB_SHELVES:
            parts.append(_bx("cb_shelf", (gx0, sy0, z - CB_GLASS_T / 2), (gx1, sy1, z + CB_GLASS_T / 2), "glass", 0.0, 1))
            for x in (CB_POSTS[k] + (0.012 if k == 0 else 0.008), CB_POSTS[k + 1] - (0.012 if k == 3 else 0.008)):
                parts.append(_xf(_copy(stud), _T(x, CB_UF + 0.058, z - CB_GLASS_T / 2 - 0.0045)))
        xc = (x0 + x1) / 2
        parts.append(_bx("cb_ledchannel", (x0 + 0.02, CB_UF + 0.040, CB_FZ1 - 0.040), (x1 - 0.02, CB_UF + 0.060,
                                                                                     CB_FZ1 - 0.0215), "aluminium",
                         0.001, 1, "x"))
        parts.append(_bx("cb_led", (x0 + 0.024, CB_UF + 0.043, CB_FZ1 - 0.0412), (x1 - 0.024, CB_UF + 0.057,
                                                                                CB_FZ1 - 0.0398), "led_strip", 0.0, 1))
        lpts.append([round(xc, 4), round(CB_UF + 0.05, 4), round(CB_FZ1 - 0.06, 4)])
    for x in std_x:
        hw = 0.012 if abs(x) > 1.6 else 0.030
        for z in CB_SHELVES:
            parts.append(_bx("cb_bracket", (x - hw, CB_BACK - 0.075, z - CB_GLASS_T / 2 - 0.011),
                             (x + hw, CB_BACK - 0.0266, z - CB_GLASS_T / 2), "brass", 0.001, 1, "y"))
    C.remove(stud)
    for ob, x, y, z, rz in _cb_display():
        parts.append(_xf(ob, _T(x, y, z) @ _Rz(rz)))
    root = _join(parts, "Furniture_Cabinet_Display_01")
    root["light_points"] = lpts
    root["light_color"] = "#ffe2b4"
    root["light_kind"] = "led_strip"
    return root


# ---------------------------------------------------------------------------
# build_chandelier_rotunda
# ---------------------------------------------------------------------------

CR_BAYS = 12
CR_RF = 1.198                 # outer face of the arcade band
CR_RP = 1.192                 # band plate centre (the rails are turned about it)
CR_TP = 0.012                 # plate thickness
CR_Z0, CR_Z1 = 0.700, 0.906   # bottom rail underside, top rail top
CR_ARCH_N = 5
CR_GLOBE_DZ = 0.075           # globe centre above the top rail
CR_LIGHT_Z = CR_Z1 + CR_GLOBE_DZ   # 0.981: the light centre (globe ring)
CR_CROWN_Z = 2.440            # the gathering crown's ring
CR_BODY_H = 2.640             # top of the crown's loop
CR_TOWER_LOOP_Z = CR_Z1 + 0.300
CR_DROP = round(17.0 - (7.5 - CR_LIGHT_Z) - CR_BODY_H, 3)


def _cr_rail(name, sec, segs=96):
    return LC._ring(name, CR_RP, sec, segs, keys=("bronze", "gilt"), smooth_angle=38)


def _cr_rails():
    bot = [(-0.020, 0.706, 0), (-0.012, 0.700, 0), (0.006, 0.700, 1), (0.014, 0.704, 1), (0.019, 0.711, 1),
           (0.019, 0.716, 1), (0.015, 0.723, 0), (0.008, 0.728, 0), (-0.016, 0.728, 0), (-0.020, 0.724, 0)]
    top = [(-0.016, 0.872, 0), (0.008, 0.872, 0), (0.016, 0.877, 1), (0.020, 0.884, 1), (0.026, 0.894, 1),
           (0.027, 0.900, 0), (0.023, 0.906, 0), (-0.023, 0.906, 0), (-0.027, 0.900, 0), (-0.026, 0.894, 1),
           (-0.022, 0.884, 0)]
    mid = [(0.004, 0.8455, 0), (0.0085, 0.8475, 0), (0.0100, 0.8510, 0), (0.0085, 0.8545, 0), (0.004, 0.8565, 0)]
    mid = [(dr, z, 0) for dr, z, _ in mid]
    return [_cr_rail("cr_rail_bot", bot), _cr_rail("cr_rail_top", top),
            LC._ring("cr_bead", CR_RF - 0.004, [(dr - 0.0, z, mi) for dr, z, mi in mid], 96, keys=("gilt",))]


def _cr_arcade_bay(name):
    """One twelfth of the pierced band: a 12 mm patinated bronze plate with five round-headed arches (gilt
    reveals) between the rails, gilt colonnettes on the piers. Built flat and wrapped on the band."""
    bw = TAU * CR_RF / CR_BAYS
    zs, zp, zt = 0.744, 0.796, 0.876
    zb = 0.724
    aw = 0.064
    bm = bmesh.new()
    xs = [-bw / 2 + bw * i / 12 for i in range(13)]
    outer2 = [(x, zb) for x in xs] + [(x, zt) for x in reversed(xs)]
    holes = []
    for k in range(CR_ARCH_N):
        xc = -bw / 2 + bw * (k + 0.5) / CR_ARCH_N
        pts = [(xc - aw / 2, zs), (xc + aw / 2, zs)]
        pts += [(xc + aw / 2 * math.cos(math.pi * i / 8), zp + aw / 2 * math.sin(math.pi * i / 8)) for i in range(9)]
        holes.append(pts)
    loops_f, loops_b = [], []
    for loop in [outer2] + holes:
        loops_f.append([bm.verts.new((x, 0.0, z)) for x, z in loop])
        loops_b.append([bm.verts.new((x, CR_TP, z)) for x, z in loop])
    _cap(bm, loops_f, (0, -1, 0), 0)
    _cap(bm, loops_b, (0, 1, 0), 0)
    for F, B in zip(loops_f[1:], loops_b[1:]):
        for f in FH._bridge_o(bm, F, B, Vector((sum(v.co.x for v in F) / len(F), 0.006, zp)), toward=True,
                              axis=(0, 1, 0), mi=1):
            pass
    plate = C.mesh_from_bmesh(name + "_plate", bm, [M("bronze_patina"), M("gilt")])
    C.shade_flat(plate)
    _uvm(plate)
    col = _lathe(name + "_col", [(0.0066, 0.0), (0.0066, 0.005), (0.0038, 0.011), (0.0036, 0.057), (0.0066, 0.065),
                                 (0.0066, 0.070)], 6, "gilt", caps=(False, True))
    parts = [plate]
    for k in range(CR_ARCH_N):
        x = -bw / 2 + bw * k / CR_ARCH_N
        c = _copy(col)
        _xf(c, _T(x, -0.0026, 0.728))
        parts.append(c)
    C.remove(col)
    ob = _join(parts, name)
    return _bend(ob, CR_RF, 0.0, 0.0)


def _cr_tower(name):
    """A little tower lantern standing on the top rail at a bay joint: moulded gilt base, an opal glass drum
    between four gilt colonnettes, a gilt cornice, a scaled bronze cone roof and a gilt spire whose eye takes
    the chain. Local origin on the rail top."""
    prof = [(0.0, 0.0), (0.040, 0.0), (0.042, 0.005), (0.036, 0.010), (0.034, 0.018), (0.039, 0.024), (0.039, 0.030),
            (0.031, 0.032)]
    base = LC._lathe(name + "_base", prof, 12, keys=("gilt",), smooth_angle=45, cap_top=True)
    glass = LC._lathe(name + "_glass", [(0.027, 0.030), (0.027, 0.122)], 12, keys=("glass_opal",), smooth_angle=60,
                      cap_bottom=False, cap_top=False)
    roof = [(0.0, 0.122), (0.040, 0.122), (0.043, 0.127), (0.043, 0.133), (0.038, 0.137), (0.034, 0.140),
            (0.024, 0.170), (0.014, 0.198), (0.010, 0.205), (0.013, 0.210), (0.006, 0.216), (0.010, 0.232),
            (0.008, 0.250), (0.003, 0.272), (0.0, 0.280)]
    idx = [1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1]
    rf = LC._lathe(name + "_roof", roof, 12, keys=("bronze", "gilt"), idx=idx, smooth_angle=50,
                   lobes=(6, 0.10, 0.140, 0.200))
    cols = []
    for k in range(4):
        a = TAU * (k + 0.5) / 4
        c = C.cylinder(name + "_col", 0.0042, 0.0042, 0.094, (0.031 * math.cos(a), 0.031 * math.sin(a), 0.077),
                       M("gilt"), 6)
        cols.append(_uvm(c))
    eye = C.torus(name + "_eye", 0.0075, 0.0022, (0, 0, CR_TOWER_LOOP_Z - CR_Z1 - 0.012), M("gilt"), 12, 4,
                  rot=C.rotx(90))
    return _join([base, glass, rf, _uvm(eye)] + cols, name)


def _cr_drop(name):
    """A gilt acorn drop hanging under the bottom rail at each tower."""
    prof = [(0.0, 0.0), (0.006, 0.004), (0.014, 0.018), (0.019, 0.036), (0.017, 0.050), (0.010, 0.058),
            (0.014, 0.064), (0.014, 0.070), (0.008, 0.076), (0.010, 0.090), (0.016, 0.098), (0.016, 0.104)]
    return LC._lathe(name, prof, 8, keys=("gilt",), smooth_angle=60, lobes=(4, 0.10, 0.004, 0.050), cap_bottom=False)


def _cr_globe(name):
    """An upright opal globe on a gilt bobeche and socket; local origin on the rail top."""
    bob = [(0.008, 0.0), (0.012, 0.005), (0.011, 0.014), (0.035, 0.020), (0.034, 0.025), (0.015, 0.027),
           (0.020, 0.038), (0.0145, 0.048)]
    b = LC._lathe(name + "_bobeche", bob, 10, keys=("gilt",), smooth_angle=45, cap_bottom=True, cap_top=False,
                  lobes=(5, 0.10, 0.017, 0.026))
    rb = 0.043
    zc = CR_GLOBE_DZ
    # 28 segments round, 12 profile points at even 14-degree steps from the neck to the crown: a true sphere
    # silhouette under the glare (18 x 9 showed facets)
    a0 = -68.0
    angs = [a0 + (90.0 - a0) * k / 11 for k in range(12)]
    gp = [(rb * math.cos(D2R(a)), zc + rb * math.sin(D2R(a))) for a in angs]
    gp[-1] = (0.0, gp[-1][1])
    g = LC._lathe(name + "_glass", gp, 28, keys=("glass_opal",), smooth_angle=80, cap_bottom=False)
    return _join([b, g], name)


def _cr_stem():
    G = ((0.330, 0.364), (0.752, 0.786), (0.818, 0.850), (1.030, 1.150))
    prof = [(0.0, 0.302), (0.024, 0.304), (0.036, 0.322), (0.040, 0.340), (0.034, 0.358), (0.018, 0.372),
            (0.016, 0.520), (0.028, 0.555), (0.036, 0.600), (0.030, 0.640), (0.018, 0.668),
            (0.018, 0.740), (0.040, 0.756), (0.060, 0.772), (0.064, 0.786), (0.052, 0.796), (0.052, 0.818),
            (0.064, 0.828), (0.060, 0.842), (0.040, 0.852), (0.018, 0.866),
            (0.016, 0.920), (0.030, 0.960), (0.040, 0.995), (0.034, 1.028), (0.016, 1.048),
            (0.020, 1.060), (0.012, 1.076), (0.016, 1.096), (0.008, 1.124), (0.0, 1.146)]
    idx = []
    for (r, z), (r2, z2) in zip(prof, prof[1:]):
        zm = (z + z2) / 2
        idx.append(1 if any(a <= zm <= b for a, b in G) else 0)
    stem = LC._lathe("cr_stem", prof, 24, keys=("bronze", "gilt"), idx=idx, smooth_angle=42,
                     lobes=(6, 0.14, 0.525, 0.665), cap_bottom=False)
    rod = LC._lathe("cr_rod", [(0.010, 0.125), (0.010, 0.305)], 10, keys=("bronze",), cap_bottom=False, cap_top=False)
    return [stem, rod]


def _cr_bowl():
    """The opal uplighter bowl under the hub: a thick opal glass dish open at the top, a gilt rim ring and
    a gilt boss and finial underneath (the body's lowest point at z = 0)."""
    sec = [(0.036, 0.122), (0.080, 0.130), (0.130, 0.152), (0.175, 0.190), (0.210, 0.240), (0.232, 0.290),
           (0.240, 0.326), (0.235, 0.329), (0.226, 0.296), (0.204, 0.246), (0.169, 0.197), (0.125, 0.160),
           (0.078, 0.139), (0.036, 0.130)]
    sec = [(0.036 + (r - 0.036) * 0.86, z) for r, z in sec]
    bowl = LC._lathe("cr_bowl", sec, 56, keys=("glass_opal",), closed=True, smooth_angle=50)
    rim = LC._ring("cr_bowlrim", 0.036 + 0.202 * 0.86, [(-0.006, 0.322, 0), (0.002, 0.318, 0), (0.008, 0.322, 0), (0.009, 0.329, 0),
                                         (0.004, 0.335, 0), (-0.004, 0.335, 0), (-0.008, 0.330, 0)], 56,
                   keys=("gilt",))
    boss = [(0.0, 0.0), (0.008, 0.006), (0.016, 0.022), (0.022, 0.044), (0.020, 0.062), (0.012, 0.074),
            (0.016, 0.084), (0.020, 0.094), (0.044, 0.112), (0.052, 0.120), (0.046, 0.128), (0.034, 0.132),
            (0.0, 0.134)]
    fin = LC._lathe("cr_finial", boss, 20, keys=("gilt",), smooth_angle=50, lobes=(8, 0.12, 0.006, 0.070))
    return [bowl, rim, fin]


def _cr_crown():
    """The gathering crown the twelve chains hang from: a gilt ring with twelve eyes, a scaled bronze bell
    with a gilt band, and a top loop for the main chain (top at CR_BODY_H)."""
    z = CR_CROWN_Z
    ring = LC._ring("cr_crownring", 0.110, [(-0.012, z - 0.008, 1), (0.010, z - 0.008, 1), (0.016, z, 1),
                                            (0.012, z + 0.010, 1), (-0.012, z + 0.010, 1)], 36, keys=("bronze", "gilt"))
    bell = [(0.0, z - 0.030), (0.040, z - 0.026), (0.096, z - 0.006), (0.104, z + 0.010), (0.092, z + 0.028),
            (0.070, z + 0.060), (0.046, z + 0.096), (0.030, z + 0.120), (0.034, z + 0.130), (0.034, z + 0.140),
            (0.020, z + 0.150), (0.016, z + 0.168), (0.0, z + 0.172)]
    idx = [0, 0, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1]
    b = LC._lathe("cr_crownbell", bell, 24, keys=("bronze", "gilt"), idx=idx, smooth_angle=45,
                  lobes=(12, 0.08, z + 0.030, z + 0.110))
    loop = C.torus("cr_crownloop", 0.016, 0.0055, (0, 0, CR_BODY_H - 0.0215), M("gilt"), 16, 6, rot=C.rotx(90))
    eyes = []
    for k in range(CR_BAYS):
        a = TAU * (k + 0.5) / CR_BAYS
        e = C.torus("cr_crowneye", 0.0072, 0.0022, (0, 0, 0), M("gilt"), 8, 4, rot=C.rotx(90))
        _xf(e, Matrix.Rotation(a, 4, "Z") @ _T(0.118, 0, z - 0.016) @ Matrix.Rotation(math.pi / 2, 4, "Z"))
        eyes.append(_uvm(e))
    return [ring, b, _uvm(loop)] + eyes


def build_chandelier_rotunda(drop=CR_DROP, name="Light_Chandelier_Rotunda"):
    """The rotunda's 2.4 m corona (see the module docstring). Returns ONE root (the corona's joined rails,
    stem, bowl and crown); towers, globes, arcade bays, drops, spokes and chains are linked duplicates
    parented to it."""
    parts = _cr_rails() + _cr_stem() + _cr_bowl() + _cr_crown()
    root = _join(parts, name)
    bay = _cr_arcade_bay(name + "_Bay")
    LC._ring_of(LC._hide_template(bay), name + "_Bay", CR_BAYS, root)
    tower = _cr_tower(name + "_Tower")
    _xf(tower, _T(CR_RP, 0, CR_Z1 - 0.0005))
    LC._ring_of(LC._hide_template(tower), name + "_Tower", CR_BAYS, root, 0.5)
    drp = _cr_drop(name + "_Drop")
    _xf(drp, _T(CR_RP + 0.001, 0, CR_Z0 - 0.098))
    LC._ring_of(LC._hide_template(drp), name + "_Drop", CR_BAYS, root, 0.5)
    glb = _cr_globe(name + "_Globe")
    _xf(glb, _T(CR_RP, 0, CR_Z1 - 0.0005))
    pl = []
    for k in range(CR_BAYS):
        for off in (-0.25, 0.25):
            pl.append(((0, 0, 0), TAU * (k + off) / CR_BAYS))
    LC._instances(LC._hide_template(glb), name + "_Globe", pl, root)
    # six cast spokes from the hub collar to the band (at alternate bay joints, under the chained towers)
    arm = LC._arm_mesh(name + "_Spoke", (0.058, 0.807), [(0.30, 0.800), (0.66, 0.806), (0.96, 0.818)],
                       (CR_RP - CR_TP / 2 + 0.001, 0.822), 0.0135, 0.0095, sides=10, n=3,
                       scroll=((0.052, 0.789), (0.44, 0.792), -0.046, 0.026), sc_w=0.0062, n_sp=22, sc_n=6)
    LC._instances(LC._hide_template(arm), name + "_Spoke",
                  [((0, 0, 0), TAU * (2 * k + 0.5) / CR_BAYS) for k in range(6)], root)
    # twelve fine chains from the tower spires to the crown
    link = LC._chain_link_mesh(name + "_Link", L=0.150, W=0.036, wire=0.0034, n_end=3, sides=4, key="brass_aged")
    a0 = TAU * 0.5 / CR_BAYS
    p0 = Vector((CR_RP * math.cos(a0), CR_RP * math.sin(a0), CR_TOWER_LOOP_Z - 0.006))
    p1 = Vector((0.118 * math.cos(a0), 0.118 * math.sin(a0), CR_CROWN_Z - 0.022))
    ch = LC._chain(name + "_Chain", p0, p1, link, L=0.150, wire=0.0034)
    C.remove(link)
    _xf(ch, Matrix.Rotation(-a0, 4, "Z"))
    LC._ring_of(LC._hide_template(ch), name + "_Chain", CR_BAYS, root, 0.5)
    # the long chain to the ceiling rose
    z_top = CR_BODY_H + drop
    rose = [(0.0, z_top - 0.150), (0.016, z_top - 0.148), (0.024, z_top - 0.136), (0.040, z_top - 0.128),
            (0.110, z_top - 0.124), (0.120, z_top - 0.114), (0.112, z_top - 0.104), (0.050, z_top - 0.096),
            (0.090, z_top - 0.070), (0.160, z_top - 0.046), (0.220, z_top - 0.026), (0.262, z_top - 0.016),
            (0.272, z_top - 0.006), (0.272, z_top)]
    idx = [1, 1, 0, 1, 1, 1, 0, 0, 0, 0, 1, 1, 1]
    canopy = LC._lathe(name + "_Rose", rose, 32, keys=("bronze", "gilt"), idx=idx, smooth_angle=42,
                       lobes=(16, 0.07, z_top - 0.094, z_top - 0.030))
    reye = C.torus(name + "_RoseEye", 0.014, 0.0055, (0, 0, z_top - 0.162), M("gilt"), 12, 6, rot=C.rotx(90))
    canopy = _join([canopy, _uvm(reye)], name + "_Rose")
    LC._parent([canopy], root)
    big = LC._chain_link_mesh(name + "_MainLink", L=0.260, W=0.062, wire=0.0070, n_end=3, sides=4, key="brass_aged")
    main = LC._chain(name + "_MainChain", (0, 0, CR_BODY_H - 0.030), (0, 0, z_top - 0.168), big, L=0.260, wire=0.0070)
    C.remove(big)
    LC._parent([main], root)
    lp = []
    for k in range(6):
        a = TAU * (2 * k + 0.25) / CR_BAYS
        lp.append([round(CR_RP * math.cos(a), 4), round(CR_RP * math.sin(a), 4), round(CR_LIGHT_Z, 4)])
    lp.append([0.0, 0.0, 0.26])
    root["light_points"] = lp
    root["light_color"] = "#ffdcae"
    root["ovr_body_height"] = CR_BODY_H
    root["ovr_drop"] = drop
    root["ovr_light_z"] = CR_LIGHT_Z
    return root


# ---------------------------------------------------------------------------
# Previews: vitrine, cabinet, chandelier
# ---------------------------------------------------------------------------

def preview_vitrine(out_dir):
    C.reset_scene()
    v = build_table_vitrine()
    _report(v, 12000)
    _studio([v])
    return _shots(out_dir, "vitrine", [
        ("34", (0, 0, 0.55), 30, 22, 3.0, 45), ("front", (0, 0, 0.62), 0, 30, 2.6, 45),
        ("side", (0, 0, 0.5), 90, 6, 2.6, 45), ("top", (0, 0.02, VT_BED), 4, 62, 1.55, 45),
        ("book", (-0.45, 0.03, VT_BED + 0.03), 10, 48, 0.62, 50), ("charter", (0.12, -0.02, VT_BED), -15, 52, 0.62, 50),
        ("lock", (0.0, -0.435, 0.84), 22, 14, 0.55, 50), ("leg", (0.70, -0.36, 0.40), 30, 8, 1.1, 50),
        ("map", (0.04, 0.14, VT_BED), 10, 50, 0.55, 50), ("eye", (0, 0, VT_BED), 0, 42, 1.55, 40)])


def preview_cabinet(out_dir):
    C.reset_scene()
    c = build_cabinet_display()
    _report(c, 18000)
    _studio([c])
    paths = _shots(out_dir, "cabinet", [
        ("front", (0, 0, 1.15), 0, 4, 6.2, 40), ("34", (0, 0, 1.15), 34, 10, 6.4, 40),
        ("cornice", (-1.6, -0.15, 2.12), 30, -12, 1.1, 45), ("bay", (-0.42, 0.0, 1.35), 6, 2, 1.85, 45),
        ("glazing", (0.42, -0.14, 1.70), 18, 6, 0.95, 50), ("chest", (-0.9, -0.25, 0.55), 20, 14, 1.4, 45),
        ("globe", (-1.26, 0.05, 1.05), 8, 6, 1.15, 50)])
    # lit: dim world, LED channels on (each bay's light point), warm key
    _clear_lights()
    scene = bpy.context.scene
    R.world(scene, (0.30, 0.28, 0.26), 0.12)
    for i, p in enumerate(c["light_points"]):
        bpy.context.view_layer.update()
        L = bpy.data.lights.new(f"CabLED{i}", "AREA")
        L.energy = 9.0
        L.size = 0.7
        L.color = (1.0, 0.86, 0.66)
        o = bpy.data.objects.new(f"CabLED{i}", L)
        scene.collection.objects.link(o)
        o.location = Vector(p) + Vector((0, 0.03, 0.015))
    R.area_light("Key", (2.5, -4.0, 2.8), (0, 0, 1.1), 120, 2.5, (1.0, 0.86, 0.70))
    paths += _shots(out_dir, "cabinet_lit", [("front", (0, 0, 1.2), 12, 6, 5.8, 40)])
    return paths


def preview_chandelier(out_dir):
    C.reset_scene()
    root = build_chandelier_rotunda()
    t, u = LC.asset_tris(root)
    print(f"TRIS Light_Chandelier_Rotunda rendered={t} unique={u} drop={CR_DROP} (budget 60000)")
    for k, (n, c) in sorted(LC.tri_split(root).items(), key=lambda kv: -kv[1][0] * kv[1][1])[:14]:
        print(f"   {k:44s} {n:6d} x{c:3d} = {n * c}")
    objs = LC._tree(root)
    body = [o for o in objs if "Chain" not in o.name and "Rose" not in o.name]
    scene = bpy.context.scene
    R.engine(scene, "EEVEE", 48, (960, 960))
    cam = R.camera(lens=50)
    paths = []
    lo, hi = R.bounds(body)
    ctr = (lo + hi) / 2
    R.studio(scene, ctr.to_tuple(), 1.6, floor=False)

    def shot(fname, target, dist, yaw, pitch, lens=50):
        LC._shoot(cam, target, dist, yaw, pitch, lens)
        paths.append(R.render(os.path.join(out_dir, fname)))

    shot("chand_side.png", Vector((0, 0, 1.25)), 7.2, 20, 4, 40)
    shot("chand_below.png", Vector((0, 0, 0.9)), 5.2, 24, -26)
    shot("chand_band.png", Vector((0.25, -1.15, 0.84)), 0.95, 12, -6)
    shot("chand_tower.png", Vector((CR_RP * math.cos(-TAU * 3.5 / 12), CR_RP * math.sin(-TAU * 3.5 / 12), 1.0)),
         0.70, 18, -4)
    shot("chand_bowl.png", Vector((0, 0, 0.45)), 1.6, 15, -10)
    shot("chand_crown.png", Vector((0, 0, 2.48)), 0.9, 20, -8)
    lo2, hi2 = R.bounds(objs)
    shot("chand_full.png", (lo2 + hi2) / 2, 13.5, 18, -3, 35)
    # lit, at night: a point light in every globe and lantern and one in the bowl
    LC._clear_preview_rig()
    R.world(scene, (0.030, 0.026, 0.024), 1.0)
    for i in range(CR_BAYS):
        for off in (-0.25, 0.25):
            a = TAU * (i + off) / CR_BAYS
            LC._point("G", (CR_RP * math.cos(a), CR_RP * math.sin(a), CR_LIGHT_Z), 6, radius=0.04)
        a = TAU * (i + 0.5) / CR_BAYS
        LC._point("T", (CR_RP * math.cos(a), CR_RP * math.sin(a), CR_Z1 + 0.076), 3, radius=0.03)
    LC._point("Bowl", (0, 0, 0.27), 22, radius=0.15)
    LC._glare(scene, 0.45, 1.6, 6)
    shot("chand_lit.png", Vector((0, 0, 1.1)), 6.6, 20, -14)
    shot("chand_lit_below.png", Vector((0, 0, 1.0)), 5.0, 10, -46)
    LC._no_glare(scene)
    return paths


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

KIND_BUILDERS = {
    "desk_research_ring": build_desk_research_ring,
    "table_reading_green": build_table_reading_green,
    "table_vitrine": build_table_vitrine,
    "cabinet_display": build_cabinet_display,
}


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _studio(objs, samples=48, size=(960, 960)):
    scene = bpy.context.scene
    R.engine(scene, "EEVEE", samples, size)
    lo, hi = R.bounds(objs)
    R.studio(scene, ((lo + hi) / 2).to_tuple(), max(0.5, (hi - lo).length / 2))
    return scene


def _shots(out_dir, name, shots):
    return [FH._shot(os.path.join(out_dir, f"{name}_{sn}.png"), t, yaw, pitch, dist, lens)
            for sn, t, yaw, pitch, dist, lens in shots]


def _report(ob, budget):
    n = C.tris(ob) + sum(C.tris(c) for c in ob.children_recursive if c.type == "MESH")
    print(f"TRIS {ob.name}: {n} (budget {budget})")
    return n


def _clear_lights():
    for o in list(bpy.data.objects):
        if o.type == "LIGHT" or o.name.startswith("PreviewFloor"):
            bpy.data.objects.remove(o, do_unlink=True)


def _floor(key="parquet_herringbone", s=12.0):
    me = bpy.data.meshes.new("PreviewFloor_" + key)
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("PreviewFloor_" + key, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(M(key))
    C.uv_box(ob, tex_size(key))
    return ob


def preview_desk(out_dir):
    C.reset_scene()
    d = build_desk_research_ring()
    _report(d, 40000)
    _studio([d])
    paths = _shots(out_dir, "desk", [
        ("public", (0, 0, 0.55), 205, 16, 7.0, 40), ("staff", (0, 0, 0.55), 20, 24, 7.0, 40),
        ("above", (0, 0.2, 0.6), 160, 52, 6.6, 40),
        ("ledge", (-0.05, 1.70, 1.12), 196, 22, 1.25, 40), ("bay", (0.92, 1.58, 0.52), 152, 6, 1.35, 45),
        ("frieze", (0.0, 1.84, 0.93), 180, 4, 1.7, 45), ("gate", (0.0, -1.80, 0.56), -24, 10, 2.1, 40),
        ("inside", (0.0, 1.25, 0.86), 0, 32, 1.6, 30), ("chair", (0.0, 0.85, 0.5), -20, 18, 1.6, 40),
        ("fascia", (0.0, 1.86, 0.91), 186, 6, 1.0, 45), ("pull", (-0.30, -1.72, 1.04), -20, 42, 0.6, 45)])
    # Cycles: the desk at dusk, lit by its banker's lamp, seen from the visitor's arrival point (2.3 m west)
    _clear_lights()
    scene = bpy.context.scene
    R.engine(scene, "CYCLES", 48, (960, 720))
    R.world(scene, (0.32, 0.38, 0.5), 0.05)
    _floor()
    FH._light_lamps([d], 60.0)
    R.area_light("Dome", (0.0, 3.5, 6.0), (0, 0.5, 0.8), 110, 4.0, (0.70, 0.80, 1.0))
    R.area_light("Warm", (-3.0, 4.0, 3.2), (0, 0.8, 0.9), 40, 2.0, (1.0, 0.78, 0.55))
    paths.append(FH._shot(os.path.join(out_dir, "desk_cycles_lamplit.png"), (0.0, 1.0, 0.95), 196, 16, 4.6, 32))
    paths.append(FH._shot(os.path.join(out_dir, "desk_cycles_inside.png"), (0.3, 1.30, 0.88), 8, 26, 1.9, 30))
    return paths


def preview_table(out_dir):
    C.reset_scene()
    t = build_table_reading_green()
    _report(t, 10000)
    objs = [t]
    _studio(objs)
    paths = _shots(out_dir, "table", [
        ("34", (0, 0, 0.42), 32, 22, 3.6, 45), ("side", (0, 0, 0.40), 0, 4, 4.0, 45),
        ("end", (0, 0, 0.40), 90, 8, 2.6, 45), ("corner", (1.0, -0.42, 0.66), 35, 22, 0.75, 50),
        ("leg", (1.08, -0.38, 0.32), 30, 6, 1.0, 50), ("inlay", (-0.95, -0.35, 0.76), 20, 55, 0.55, 50)])
    # with the plan's chairs and banker's lamps, to check the fit
    lamp = FH.build_lamp_banker_green()
    lamp.location = (-0.6, 0, TG_H + 0.0003)
    C.instance(lamp, "lamp2", (0.6, 0, TG_H + 0.0003))
    chair = FH.build_chair_reading()
    for i, (x, y) in enumerate([(-0.6, -0.85), (0.6, -0.85), (-0.6, 0.85), (0.6, 0.85)]):
        c = chair if i == 0 else C.instance(chair, f"chair{i}", (0, 0, 0))
        c.location = (x, y, 0)
        c.rotation_euler = (0, 0, math.pi if y < 0 else 0)
    paths += _shots(out_dir, "table", [("dressed", (0, 0, 0.5), 28, 24, 4.4, 40)])
    return paths


def preview(out_dir):
    paths = []
    for fn in (preview_desk, preview_table, preview_vitrine, preview_cabinet, preview_chandelier):
        paths += fn(out_dir)
    print("PREVIEW_IMAGES", *paths)
    return paths
