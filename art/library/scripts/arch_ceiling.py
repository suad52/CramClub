"""
Grand Reading Hall ceiling (Ref 2, Ref 4): a timber coffered ceiling with a clear beam hierarchy, stepped
gilt-beaded coffers with painted panels (deep teal / oxblood in a checkerboard) and low-relief carved gilt
rosettes, principal beams on the pier lines, and a central LAYLIGHT framed by full-depth trimmer beams,
rising through a coved, ornamented well to a patterned, iron-glazed ceiling light (Ref 3's glass roof,
made rectangular).

Plan-driven and built IN PLACE (Blender coords, the hall is x -14..14, y -8..10):

    build_hall_ceiling()                       -> [objects]   collection ARCHITECTURE/Ceiling
    build_coffered_ceiling(rect, height, ...)  -> [objects]   generic, any rectangular room
    build_lobby_ceiling()                      -> [objects]   the generic one, simpler flat coffers

The hall's coffer system (all derived from plan.HALL / HALL_PIERS / HALL_CEILING):

    principal soffit  z 12.60  principals 0.95 wide on the pier lines, the laylight trimmers, a sunk
                               0.40 m gilt-lined ornament channel in each; they land on the crown of the
                               hall cornice (arch_shell.build_hall_cornice, 11.60-12.60, corona 0.70 m)
    bed mould         12.60 -> 12.84  arris, fascia, gilt astragal, ovolo, cavetto: every bay of coffers is
                               framed by it, so the principals read as deep beams with the secondaries
                               framing in 0.24 m higher
    secondary soffit  z 12.84  continuous ribs (east-west runs pass through, north-south pieces butt in)
    coffer panels     z 13.12  stepped walnut lining: fascia, cyma, gilt bead, soffit step, cove
    laylight glass    z 13.45  in a coved well, glazed 6.6 x 4.7 m (framed opening 7.75 x 5.85 m)

    x: 0.475 margin + 5 bays x (3 coffers x 1.55) + 4 principals x 0.95 + 0.475 margin = 28 m
    y: 0.475 margin + 11 coffers x 1.55 + 0.475 margin = 18 m       -> 1.33 m square coffer openings

The 0.475 m margin and 12.60-12.84 lie behind the shell's cornice: the perimeter bed mould (the inner face of
the wall plate) shows just above the corona, and nothing of this module crosses the cornice. Faces are wound
to face the room (down / into each recess); every seam between separately built parts has a hidden flange
behind it, so no light leaks. Coffer linings and rosettes are linked duplicates (8 lining variants with
different grain offsets, turned at random). The rosette (412 tris, 0.40 m) is a sixteen-petal carved patera
laid exactly over the coffer_panel texture's painted sixteen-petal rosette, so no painted gilt peeks out.
Chandelier coffers (plan.LIGHTS, kind "chandelier" inside the hall) get no rosette: an empty
`Anchor_Ceiling_<light id>` marks the panel centre, the chandelier canopy's ceiling contact
(CHANDELIER_CONTACT_Z).

preview() builds the REAL hall cornice (arch_shell.build_hall_cornice) so every review checks the junction,
and renders the textured palette keys with textures.py's fitted tints / gilt masks (OVR_FITTED=0 to skip).
"""

from __future__ import annotations

import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector

import lib_core as C
import lib_render as R
import plan as P
import lib_materials as LM
from lib_materials import mat, tex_size

# ---------------------------------------------------------------------------
# Hall coffer system
# ---------------------------------------------------------------------------

SOFFIT = P.HALL_CEILING                 # 12.60  principal / trimmer soffit (= the cornice crown)
STEP = 0.24                             # principals sit this much below the secondary soffit
SEC_Z = SOFFIT + STEP                   # 12.84  secondary soffit
RECESS = 0.28                           # secondary soffit -> painted panel
PANEL_Z = SEC_Z + RECESS                # 13.12
CHANDELIER_CONTACT_Z = PANEL_Z
PITCH = 1.55                            # coffer pitch (secondary beam centre to centre)
BAY_COFFERS = 3                         # coffers between two principals
BEAM_W = 0.95                           # principal soffit width
MARGIN = 0.475                          # wall face -> coffer field (= half a principal), under the cornice
HALF_RIB = 0.11                         # half a secondary beam soffit
CHANNEL = 0.40                          # gilt-lined ornament channel in the principal / trimmer soffits
CORNICE_PROJ = 0.70                     # arch_shell's corona projection: hides the margin
LAYLIGHT_Z = 13.45
LAYLIGHT_C = C.bl(0.0, 0.0, -1.0)       # web (0, -1): Blender (0, 1)
LAY_COLS, LAY_ROWS = 5, 5               # coffers taken by the laylight (incl. its trimmers)
TRIM = BEAM_W                           # trimmer beams round the laylight, as wide as the principals
WELL_D = 0.56                           # well inset from the trimmer edge to the glass
ROSETTE_R = 0.20                        # petal tips; covers the coffer_panel texture's painted rosette (r 0.18 m)

# Palette additions (module-local). The laylight is glazed with five tints of glass_laylight. Seen from the
# hall the glass is lit from behind, so each keeps a dark reflective base and carries its colour in the
# emission, kept well below clipping so the panes stay blue and the ironwork shading reads.
_GL = LM.PALETTE["glass_laylight"]
LM.PALETTE.setdefault("glass_laylight_field", dict(_GL, base="#4b5f7a", emission="#a9c5ec", emit=0.80))
LM.PALETTE.setdefault("glass_laylight_cool", dict(_GL, base="#34496a", emission="#7f9fd4", emit=0.78))
LM.PALETTE.setdefault("glass_laylight_pale", dict(_GL, base="#6b6e68", emission="#e8e7da", emit=0.72))
LM.PALETTE.setdefault("glass_laylight_deep", dict(_GL, base="#1c2a46", emission="#3f63a8", emit=0.72, alpha=0.92))
LM.PALETTE.setdefault("glass_laylight_amber", dict(_GL, base="#563a12", emission="#e2a446", emit=0.62, alpha=0.92))
GLASS_KEYS = ["glass_laylight_field", "glass_laylight_cool", "glass_laylight_pale", "glass_laylight_deep",
              "glass_laylight_amber"]
G_FIELD, G_COOL, G_PALE, G_DEEP, G_AMBER = range(5)


def _col():
    return C.collection("Ceiling", C.collection("ARCHITECTURE"))


def _brect(web_rect):
    """plan rect (web) or (minX, maxX, minZ, maxZ) -> Blender (x0, y0, x1, y1)."""
    if isinstance(web_rect, dict):
        x0, x1, z0, z1 = web_rect["minX"], web_rect["maxX"], web_rect["minZ"], web_rect["maxZ"]
    else:
        x0, x1, z0, z1 = web_rect
    return (x0, -z1, x1, -z0)


def _inset(r, d):
    return (r[0] + d, r[1] + d, r[2] - d, r[3] - d)


def _rect_loop(r):
    x0, y0, x1, y1 = r
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def _inside(x, y, r):
    return r[0] < x < r[2] and r[1] < y < r[3]


def _hash01(*k):
    """Deterministic pseudo-random 0..1 from integers (stable across runs)."""
    h = 2166136261
    for v in k:
        h = ((h ^ (int(v) & 0xffffffff)) * 16777619) & 0xffffffff
    h ^= h >> 13
    h = (h * 0x5bd1e995) & 0xffffffff
    h ^= h >> 15
    return (h & 0xffffff) / float(0x1000000)


# ---------------------------------------------------------------------------
# Profile helpers. A profile point is (dx, dy, z, material_index, uv_mode): the loop inset by dx (on its
# north-south running sides) and dy (east-west running sides) at height z. uv_mode None = metric UVs
# (U along the side = grain, V along the profile), "band" = V 0..1 across the run of band segments
# (ornament_band), ("planar", rect) = planar 0..1 over rect (painted panels).
# ---------------------------------------------------------------------------

def pt(d, z, mi=0, uv=None, dy=None):
    return (d, d if dy is None else dy, z, mi, uv)


def arc(cd, cz, rd, rz, a0, a1, n, mi=0, uv=None):
    """Points on an ellipse centred (cd, cz) from angle a0 to a1 (deg, start excluded)."""
    out = []
    for k in range(1, n + 1):
        a = math.radians(a0 + (a1 - a0) * k / n)
        out.append(pt(cd + rd * math.cos(a), cz + rz * math.sin(a), mi, uv))
    return out


def scurve(d0, z0, d1, z1, n, mi=0, uv=None):
    """A cyma: leaves (d0, z0) heading up, swings in to d1 and arrives heading up again."""
    out = []
    for k in range(1, n + 1):
        t = k / n
        out.append(pt(d0 + (d1 - d0) * (1 - math.cos(math.pi * t)) / 2, z0 + (z1 - z0) * t, mi, uv))
    return out


def poly_ring(bm, loop, prof, sizes, cap=None, cap_uv=None, uv_off=(0.0, 0.0)):
    """Sweeps a profile around a rectilinear loop as mitred rings (bed moulds, coffer linings, channels,
    the laylight well). `loop` is [(x, y), ...], counter-clockwise for an outer boundary (insets go
    inward) or clockwise for a hole (insets go outward, into the surrounding region). Faces face the
    room: down, and toward the inset side. `sizes[mi]` is the UV tile size of material index mi; `uv_off`
    shifts the metric UVs (grain variation between instances). `cap` closes the last ring (facing down)
    with that material index; `cap_uv(co) -> (u, v)` sets its UVs (default metric)."""
    uvl = bm.loops.layers.uv.verify()
    pts = []
    for p in prof:
        if pts and all(abs(p[i] - pts[-1][i]) < 1e-7 for i in range(3)):
            continue
        pts.append(p)
    n = len(loop)
    info = []
    for i in range(n):
        a, b, c = Vector(loop[i - 1]), Vector(loop[i]), Vector(loop[(i + 1) % n])
        e0, e1 = (b - a).normalized(), (c - b).normalized()
        info.append((b, Vector((-e0.y, e0.x)), abs(e0.x) > 0.5, Vector((-e1.y, e1.x)), abs(e1.x) > 0.5))

    def ring(p):
        out = []
        for b, n0, x0, n1, x1 in info:
            q = b + n0 * (p[1] if x0 else p[0]) + n1 * (p[1] if x1 else p[0])
            out.append(bm.verts.new((q.x, q.y, p[2])))
        return out
    rings = [ring(p) for p in pts]
    sx, sy = [0.0], [0.0]
    for a, b in zip(pts, pts[1:]):
        sx.append(sx[-1] + math.hypot(b[0] - a[0], b[2] - a[2]))
        sy.append(sy[-1] + math.hypot(b[1] - a[1], b[2] - a[2]))
    band = {}
    k = 1
    while k < len(pts):
        if pts[k][4] == "band":
            j = k
            while j + 1 < len(pts) and pts[j + 1][4] == "band":
                j += 1
            for m in range(k, j + 1):
                band[m] = (k - 1, j)
            k = j + 1
        else:
            k += 1
    for k in range(len(pts) - 1):
        mi, uvm = pts[k + 1][3], pts[k + 1][4]
        size = sizes[mi]
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((rings[k][i], rings[k + 1][i], rings[k + 1][j], rings[k][j]))
            f.material_index = mi
            along_x = info[i][4]
            s = sy if along_x else sx
            for loop_, kk in zip(f.loops, (k, k + 1, k + 1, k)):
                co = loop_.vert.co
                al = co.x if along_x else co.y
                if uvm == "band":
                    k0, k1 = band[k + 1]
                    loop_[uvl].uv = (al / size, (s[kk] - s[k0]) / max(1e-6, s[k1] - s[k0]))
                elif isinstance(uvm, tuple) and uvm[0] == "planar":
                    loop_[uvl].uv = _uv_planar(co, uvm[1])
                else:
                    loop_[uvl].uv = (al / size + uv_off[0], s[kk] / size + uv_off[1])
    if cap is not None:
        f = bm.faces.new(list(reversed(rings[-1])))
        f.material_index = cap
        for loop_ in f.loops:
            co = loop_.vert.co
            loop_[uvl].uv = cap_uv(co) if cap_uv else (co.x / sizes[cap], co.y / sizes[cap])
    return rings


def ring_stack(bm, rect, prof, sizes, cap=None, cap_uv=None, uv_off=(0.0, 0.0)):
    """poly_ring around an axis-aligned rectangle (x0, y0, x1, y1)."""
    return poly_ring(bm, _rect_loop(rect), prof, sizes, cap, cap_uv, uv_off)


def _uv_planar(co, rect):
    x0, y0, x1, y1 = rect
    return ((co.x - x0) / (x1 - x0), (co.y - y0) / (y1 - y0))


def _mirror_tail(half, a, b):
    """The far side of a symmetric channel: `half` ([(d, z, mi, uv)] from the near edge, relative) mirrored
    to end on the edge at b, walked downward. Each segment keeps the material of the segment it mirrors."""
    out = []
    for k in range(len(half) - 2, -1, -1):
        d, z = half[k][0], half[k][2]
        out.append(pt(b - d, z, half[k + 1][3]))
    return out


def _face(bm, verts, normal, mi=0):
    """Quad/ngon wound so its normal agrees with `normal`."""
    f = bm.faces.new(verts)
    f.normal_update()
    if f.normal.dot(Vector(normal)) < 0:
        f.normal_flip()
    f.material_index = mi
    return f


def _obj(name, bm, mats, col=None):
    return C.mesh_from_bmesh(name, bm, [mat(m) for m in mats], col=col)


def _mesh_only(name, bm, mats, finish=None):
    """Builds a mesh datablock (for instancing) through a temporary object."""
    ob = _obj(name, bm, mats)
    if finish:
        finish(ob)
    me = ob.data
    me.name = name
    bpy.data.objects.remove(ob, do_unlink=True)
    return me


def _inst(me, name, loc, col, rot_z=0.0):
    ob = bpy.data.objects.new(name, me)
    ob.location = Vector(loc)
    ob.rotation_euler = (0, 0, rot_z)
    C.link(ob, col)
    return ob


def _lathe_bm(bm, profile, seg, mi=0, phase=0.0, flip=False):
    """Revolves [(r, z), ...] around Z into bm; r == 0 at the first point makes a pole."""
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((r * math.cos(phase + math.tau * i / seg), r * math.sin(phase + math.tau * i / seg), z))
                          for i in range(seg)])
    for a, b in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            if len(a) == 1:
                f = bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                f = bm.faces.new((a[i], b[0], a[j]))
            else:
                f = bm.faces.new((a[i], b[i], b[j], a[j]))
            if flip:
                f.normal_flip()
            f.material_index = mi
    return rings


def _finish_wood(ob):
    C.weighted_normals(ob)
    ob.data.name = ob.name
    return ob


def _finish_smooth(angle):
    def fin(ob):
        C.shade_smooth(ob, angle)
        return ob
    return fin


def _merge_breaks(vals, tol=1e-5):
    out = []
    for v in sorted(vals):
        if not out or v - out[-1] > tol:
            out.append(v)
    return out


def _grid_faces(bm, xs, ys, z, inside, uv_of, mi=0):
    """Down-facing quads on the plane z over every cell of the xs x ys grid whose centre passes
    inside(cx, cy). Welded on one grid, so the soffit has no T-junctions. uv_of(x, y, cx, cy) -> uv."""
    uvl = bm.loops.layers.uv.verify()
    xs, ys = _merge_breaks(xs), _merge_breaks(ys)
    V = {}

    def vert(i, j):
        if (i, j) not in V:
            V[i, j] = bm.verts.new((xs[i], ys[j], z))
        return V[i, j]
    n = 0
    for i in range(len(xs) - 1):
        for j in range(len(ys) - 1):
            cx, cy = (xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2
            if not inside(cx, cy):
                continue
            f = bm.faces.new((vert(i, j), vert(i, j + 1), vert(i + 1, j + 1), vert(i + 1, j)))
            f.material_index = mi
            for loop_ in f.loops:
                co = loop_.vert.co
                loop_[uvl].uv = uv_of(co.x, co.y, cx, cy)
            n += 1
    return n


def _cell_loops(cells, xe, ye):
    """Boundary loops of a union of grid cells {(i, j)} (counter-clockwise outside, clockwise round
    holes), with grid lines xe / ye. Collinear points are dropped."""
    edges = {}
    for i, j in cells:
        for a, b in (((i, j), (i + 1, j)), ((i + 1, j), (i + 1, j + 1)), ((i + 1, j + 1), (i, j + 1)), ((i, j + 1), (i, j))):
            if (b, a) in edges:
                del edges[(b, a)]
            else:
                edges[(a, b)] = True
    nxt = {}
    for a, b in edges:
        assert a not in nxt, "pinched cell region"
        nxt[a] = b
    loops, seen = [], set()
    for start in list(nxt):
        if start in seen:
            continue
        chain, p = [], start
        while p not in seen:
            seen.add(p)
            chain.append(p)
            p = nxt[p]
        pts = [(xe[i], ye[j]) for i, j in chain]
        m = len(pts)
        simp = []
        for k in range(m):
            a, b, c = pts[k - 1], pts[k], pts[(k + 1) % m]
            if abs((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0])) > 1e-9:
                simp.append(b)
        loops.append(simp)
    return loops


# ---------------------------------------------------------------------------
# Rosette (one mesh, instanced on every coffer): a low-relief carved patera of sixteen ogee-tipped petals
# radiating from a small turned button with a bead. The sixteen petals sit exactly over the coffer_panel
# texture's painted sixteen-petal rosette (r 0.18 m on the 1.0 m panel), so none of the painted gilt peeks
# out between them. Mounting plane z = 0, hangs toward -Z. 412 triangles.
# ---------------------------------------------------------------------------

def rosette_bm(R_=ROSETTE_R, scale=1.0, petals=16):
    """Polar height field over 4 vertices per petal (valley, shoulder, tip, shoulder: an ogival tip) with a
    crisp raised petal edge, rounded keels and cut grooves, the roots gathered under a 20-sided turned boss. Built
    facing +Z, then turned to hang. The petals' centre lines lie on angles k * 360 / petals (the painted
    ones)."""
    bm = bmesh.new()
    s = scale * R_ / 0.20
    zt = s ** 0.5                                    # small rosettes keep a little more relief
    n = petals * 4

    def ang(i):                                      # i = 0 (mod 4) a valley, i = 2 a petal tip
        return math.tau * (i - 2) / n
    # (radius, height) per position in the petal: valley, shoulder, tip, shoulder
    rings_spec = [
        [(0.150, -0.0015), (0.187, -0.0015), (0.200, -0.0015), (0.187, -0.0015)],    # outline, tucked
        [(0.147, 0.0032), (0.181, 0.0050), (0.193, 0.0046), (0.181, 0.0050)],        # top of the petal edge
    ]
    rings = [[bm.verts.new((sp[i % 4][0] * s * math.cos(ang(i)), sp[i % 4][0] * s * math.sin(ang(i)), sp[i % 4][1] * zt))
              for i in range(n)] for sp in rings_spec]
    # the petals' crowns: a valley and a rounded keel per petal (2 vertices per petal)
    B2 = [(0.104, 0.0058), (0.127, 0.0176)]
    crown = [bm.verts.new((B2[k % 2][0] * s * math.cos(ang(2 * k)), B2[k % 2][0] * s * math.sin(ang(2 * k)), B2[k % 2][1] * zt))
             for k in range(2 * petals)]
    # the petals' roots, one vertex per valley, under the boss
    cring = [bm.verts.new((0.044 * s * math.cos(ang(4 * k)), 0.044 * s * math.sin(ang(4 * k)), 0.0200 * zt))
             for k in range(petals)]
    up = (0, 0, 1)
    ra, rb = rings
    for i in range(n):
        j = (i + 1) % n
        _face(bm, (ra[i], ra[j], rb[j], rb[i]), up)
    m2 = 2 * petals
    for k in range(petals):
        v = [rb[(4 * k + t) % n] for t in range(5)]
        b0, b1, b2 = crown[2 * k], crown[2 * k + 1], crown[(2 * k + 2) % m2]
        c0, c1 = cring[k], cring[(k + 1) % petals]
        _face(bm, (v[0], v[1], b0), up)
        _face(bm, (b0, v[1], v[2], b1), up)
        _face(bm, (b1, v[2], v[3], b2), up)
        _face(bm, (b2, v[3], v[4]), up)
        _face(bm, (b0, b1, c0), up)
        _face(bm, (c0, b1, c1), up)
        _face(bm, (c1, b1, b2), up)
    sharp = set()
    for i in range(n):                               # the crisp top edge of every petal
        e = bm.edges.get((rb[i], rb[(i + 1) % n]))
        if e:
            sharp.add(e)
    for k in range(petals):                          # and the cut grooves between the petals
        for pair in ((rb[4 * k], crown[2 * k]), (crown[2 * k], cring[k])):
            e = bm.edges.get(pair)
            if e:
                sharp.add(e)
    # boss: a turned button with a bead round its foot, seated over the petal roots
    prof = [(0.048, 0.0165), (0.051, 0.0235), (0.040, 0.0300), (0.022, 0.0352), (0.0, 0.0372)]
    seg = 20
    prev = None
    for r, z in prof:
        if r < 1e-6:
            pole = bm.verts.new((0, 0, z * zt))
            for i in range(seg):
                c = (prev[i].co + prev[(i + 1) % seg].co) / 2
                _face(bm, (prev[i], prev[(i + 1) % seg], pole), (c.x, c.y, 0.05))
            break
        ring = [bm.verts.new((r * s * math.cos(math.tau * i / seg), r * s * math.sin(math.tau * i / seg), z * zt))
                for i in range(seg)]
        if prev is not None:
            for i in range(seg):
                j = (i + 1) % seg
                c = (prev[i].co + ring[j].co) / 2
                _face(bm, (prev[i], prev[j], ring[j], ring[i]), (c.x, c.y, 0.02))
        prev = ring
    for f in bm.faces:
        f.smooth = True
    for e in bm.edges:
        e.smooth = e not in sharp
    bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, "X"), verts=bm.verts)
    bm.normal_update()
    uvl = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for loop in f.loops:
            loop[uvl].uv = (loop.vert.co.x / 0.3, loop.vert.co.y / 0.3)
    return bm


def _lathe_bm_onto(bm, base, profile, seg):
    """Continues a lathe from an existing ring of `seg` verts through [(r, z), ...] (r 0 = pole)."""
    prev = base
    for r, z in profile:
        if r < 1e-6:
            pole = bm.verts.new((0, 0, z))
            for i in range(seg):
                bm.faces.new((prev[i], pole, prev[(i + 1) % seg]))
            return
        ring = [bm.verts.new((r * math.cos(math.tau * i / seg), r * math.sin(math.tau * i / seg), z)) for i in range(seg)]
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((prev[i], ring[i], ring[j], prev[j]))
        prev = ring


# ---------------------------------------------------------------------------
# Consoles (generic rooms with a cove only; the hall's principals bear on the shell cornice instead)
# ---------------------------------------------------------------------------

def console_bm(width=0.60, proj=0.47, height=0.4):
    """Carved console set in a cove under a principal-beam end: the wall face on y = 0, the room toward -Y,
    sitting on the cornice top (z = 0) and carrying the beam soffit (z = height). Side profile: a scroll
    rolled under the soffit, an ogee sweeping down and in, and a rolled foot. Mat 0 frame wood."""
    h = height
    rt, ct = 0.062, Vector((proj - 0.062, h - 0.062))
    rb, cb = 0.044, Vector((0.094, 0.068))
    pts = [(0.0, h), (ct.x, h)]
    for k in range(1, 10):
        a = math.radians(90 - 195 * k / 9)
        pts.append((ct.x + rt * math.cos(a), ct.y + rt * math.sin(a)))
    p0 = Vector(pts[-1])
    p1, p2, p3 = p0 + Vector((-0.05, -0.06)), Vector((0.20, h - 0.24)), Vector((cb.x + rb * math.cos(math.radians(15)),
                                                                               cb.y + rb * math.sin(math.radians(15))))
    for k in range(1, 9):
        t = k / 8
        q = (1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t * t * p2 + t ** 3 * p3
        pts.append((q.x, q.y))
    for k in range(1, 8):
        a = math.radians(15 - 105 * k / 7)
        pts.append((cb.x + rb * math.cos(a), cb.y + rb * math.sin(a)))
    pts += [(0.070, 0.016), (0.064, 0.0), (0.0, 0.0)]
    bm = bmesh.new()
    hw = width / 2
    left = [bm.verts.new((-hw, -d, z)) for d, z in pts]
    right = [bm.verts.new((hw, -d, z)) for d, z in pts]
    n = len(pts)
    poly = [Vector(p) for p in pts]
    area = sum(poly[i].x * poly[(i + 1) % n].y - poly[(i + 1) % n].x * poly[i].y for i in range(n)) / 2
    for i in range(1, n - 2):
        a, b, c, d = left[i], left[i + 1], right[i + 1], right[i]
        e = poly[i + 1] - poly[i]
        nd, nz = (e.y, -e.x) if area > 0 else (-e.y, e.x)
        _face(bm, [a, b, c, d], (0, -nd, nz))
    _face(bm, left, (-1, 0, 0))
    _face(bm, right, (1, 0, 0))
    return bm, (ct, rt, cb, rb, hw)


def console_eyes_bm(spec):
    ct, rt, cb, rb, hw = spec
    bm = bmesh.new()
    for c, r in ((ct, rt * 0.62), (cb, rb * 0.62)):
        for side in (-1, 1):
            prof = [(0, 0.012), (r * 0.55, 0.009), (r * 0.9, 0.006), (r, 0.001), (r, -0.002)]
            rs = _lathe_bm(bm, prof, 16)
            for ring in rs:
                for v in ring:
                    x, y, z = v.co
                    v.co = Vector((side * (hw + z), -c.x + y, c.y + x))
            if side > 0:
                for f in {f for ring in rs for v in ring for f in v.link_faces}:
                    f.normal_flip()
    return bm


def console_mesh(name, frame, proj, height):
    body_bm, spec = console_bm(proj=proj, height=height)
    body = _obj(name, body_bm, [frame])
    C.uv_box(body, tex_size(frame), grain="z")
    C.bevel(body, 0.006, 2, 30)
    eyes = _obj(name + "_Eyes", console_eyes_bm(spec), [frame])
    C.uv_box(eyes, tex_size(frame))
    ob = C.join([body, eyes], name)
    C.weighted_normals(ob)
    me = ob.data
    me.name = name
    bpy.data.objects.remove(ob, do_unlink=True)
    return me


# ---------------------------------------------------------------------------
# Profiles
# ---------------------------------------------------------------------------

def bed_profile(z0, step, style="rich"):
    """The moulded side of every principal / trimmer / wall plate, swept round each bay of coffers: from
    the beam soffit (z0) up to the secondary soffit (z0 + step), projecting into the bay as it rises (a
    bed mould under the ribs). mat 0 frame, 1 accent. Returns (profile, d where the secondary soffit
    starts)."""
    z1 = z0 + step
    r = 0.012
    prof = [pt(-0.014, z0 + 0.003), pt(0, z0)]                                # hidden flange, start
    prof += arc(0, z0 + r, r, r, -90, 0, 4)                                    # arris -> (r, z0 + r)
    if style == "rich":
        prof += [pt(r, z0 + 0.085)]                                            # fascia
        prof += arc(r, z0 + 0.0995, 0.0145, 0.0145, -90, 90, 8, mi=1)         # gilt astragal
        prof += [pt(r, z0 + 0.120)]                                            # fillet
        prof += arc(r, z0 + 0.165, 0.045, 0.045, -90, 0, 6)                   # ovolo
        prof += [pt(r + 0.045, z0 + 0.178)]                                    # fillet
        prof += arc(r + 0.075, z0 + 0.178, 0.030, step - 0.178, 180, 90, 6)   # cavetto into the ribs
        d_b = r + 0.075
    else:
        prof += [pt(r, z1 - 0.07)]
        prof += arc(r, z1 - 0.06, 0.010, 0.010, -90, 90, 6, mi=1)
        prof += arc(r + 0.04, z1 - 0.05, 0.04, 0.05, 180, 90, 5)
        d_b = r + 0.04
    prof += [pt(d_b + 0.012, z1 + 0.003)]                                      # hidden flange behind the ribs
    return prof, d_b


CH_R, CH_BEAD, CH_COVE = 0.006, 0.013, 0.022
CH_DEPTH = 0.066


def channel_half(z0):
    """One side of the sunk ornament channel in a beam soffit, from its edge (d = 0) down into the floor:
    arris, fascia, gilt bead, fillet, cove. Returns points (relative d) ending on the channel floor."""
    prof = [pt(0, z0)]
    prof += arc(0, z0 + CH_R, CH_R, CH_R, -90, 0, 3)
    prof += [pt(CH_R, z0 + 0.012)]
    prof += arc(CH_R, z0 + 0.012 + CH_BEAD, CH_BEAD, CH_BEAD, -90, 90, 8, mi=1)
    prof += [pt(CH_R, z0 + 0.044)]
    prof += arc(CH_R + CH_COVE, z0 + 0.044, CH_COVE, CH_COVE, 180, 90, 5)
    return prof                                                                # ends at (0.028, z0 + 0.066)


CH_FLOOR_IN = CH_R + CH_COVE                                                   # 0.028


def well_profile(z0, top):
    """The laylight well from the trimmer soffit's inner edge up to the glass: arris, fascia, gilt astragal,
    ovolo, a soffit step, then a deep cove carrying the ornament band (it faces down into the hall, so it
    reads from the floor like Ref 3's gilded cove), a gilt bead, the corona soffit, a cyma recta and the
    glass rebate. mat 0 walnut, 1 gilt, 2 ornament band. Returns (profile, cove arc length)."""
    w, h = 0.30, 0.36
    prof = [pt(-0.014, z0 + 0.003), pt(0, z0)]
    prof += arc(0, z0 + 0.014, 0.014, 0.014, -90, 0, 4)
    prof += [pt(0.014, z0 + 0.085)]
    prof += arc(0.014, z0 + 0.0995, 0.0145, 0.0145, -90, 90, 8, mi=1)
    prof += [pt(0.014, z0 + 0.122)]
    prof += arc(0.014, z0 + 0.172, 0.05, 0.05, -90, 0, 6)
    prof += [pt(0.064, z0 + 0.182), pt(0.104, z0 + 0.182)]
    prof += arc(0.104, z0 + 0.190, 0.008, 0.008, -90, 0, 3)
    prof += [pt(0.112, z0 + 0.200)]
    prof += arc(0.112 + w, z0 + 0.200, w, h, 180, 90, 14, mi=2, uv="band")
    zc = z0 + 0.200 + h
    d = 0.112 + w
    prof += arc(d + 0.015, zc, 0.015, 0.015, 180, 360, 8, mi=1)
    prof += [pt(WELL_D - 0.06, zc)]
    prof += [pt(WELL_D - 0.06, zc + 0.05)]
    prof += scurve(WELL_D - 0.06, zc + 0.05, WELL_D, top - 0.06, 7)
    prof += [pt(WELL_D, top + 0.005)]
    L = sum(math.hypot(w * (math.cos(math.radians(180 - 90 * (k + 1) / 40)) - math.cos(math.radians(180 - 90 * k / 40))),
                       h * (math.sin(math.radians(180 - 90 * (k + 1) / 40)) - math.sin(math.radians(180 - 90 * k / 40))))
            for k in range(40))
    return prof, L


def cove_profile(base, height, proj):
    """A plaster cove from the wall face at `base` up to the soffit at `proj`, a gilt bead, then a hidden
    flange under the soffit. Returns (profile, d where the soffit starts)."""
    prof = [pt(-0.03, base), pt(0, base)]
    prof += arc(proj, base, proj, height - base, 180, 90, 12)
    prof += arc(proj + 0.016, height, 0.016, 0.016, 180, 360, 6, mi=1)
    prof += [pt(proj + 0.044, height + 0.003)]
    return prof, proj + 0.032


# ---------------------------------------------------------------------------
# Coffer linings. A tile is ONE coffer's lining only, from the arris of its opening (secondary soffit at
# z = 0) up to the painted panel at z = recess, centred on its origin. The ribs between are continuous
# members built separately, so tiles never meet edge to edge.
# ---------------------------------------------------------------------------

def tile_profile(ox, oy, style="rich", recess=RECESS):
    """Mat indices: 0 frame wood, 1 accent (gilt), 2 panel paint. (ox, oy) is the opening."""
    if style == "rich":
        r = 0.012
        prof = [pt(-0.010, 0.003), pt(0, 0)]                                  # hidden flange
        prof += arc(0, r, r, r, -90, 0, 4)                                     # arris
        prof += [pt(r, 0.042)]                                                 # rib fascia
        prof += scurve(r, 0.042, r + 0.040, 0.092, 5)                          # cyma reversa stepping in
        prof += [pt(r + 0.040, 0.100)]                                         # fillet
        prof += arc(r + 0.040, 0.113, 0.013, 0.013, -90, 90, 6, mi=1)         # gilt bead
        prof += [pt(r + 0.040, 0.150)]                                         # second fascia
        prof += [pt(r + 0.074, 0.150)]                                         # soffit step: a second frame
        prof += arc(r + 0.074, 0.158, 0.008, 0.008, -90, 0, 3)                # its arris
        prof += [pt(r + 0.082, 0.196)]                                         # fascia
        prof += arc(r + 0.152, 0.196, 0.070, recess - 0.012 - 0.196, 180, 90, 5)   # cove into the panel
        inset = r + 0.152
    else:
        r = 0.010
        prof = [pt(-0.010, 0.003), pt(0, 0)]
        prof += arc(0, r, r, r, -90, 0, 3)
        prof += [pt(r, 0.045)]
        prof += scurve(r, 0.045, r + 0.040, 0.100, 5)
        prof += [pt(r + 0.040, 0.108)]
        prof += arc(r + 0.040, 0.118, 0.010, 0.010, -90, 90, 4, mi=1)
        prof += [pt(r + 0.040, recess - 0.012), pt(r + 0.050, recess - 0.012)]
        inset = r + 0.050
    prof += [pt(inset, recess, 0)]                                             # crisp upstand to the panel
    panel = ("planar", (-ox / 2 + inset, -oy / 2 + inset, ox / 2 - inset, oy / 2 - inset))
    return prof, panel


def tile_mesh(name, ox, oy, frame, accent, panel_mat, style="rich", recess=RECESS, uv_off=(0.0, 0.0)):
    bm = bmesh.new()
    prof, panel = tile_profile(ox, oy, style, recess)
    sizes = [tex_size(frame), 1.0, tex_size(panel_mat)]
    ring_stack(bm, (-ox / 2, -oy / 2, ox / 2, oy / 2), prof, sizes, cap=2,
               cap_uv=lambda co: _uv_planar(co, panel[1]), uv_off=uv_off)
    return _mesh_only(name, bm, [frame, accent, panel_mat], _finish_wood)


# ---------------------------------------------------------------------------
# Generic coffered ceiling
# ---------------------------------------------------------------------------

def _layout(rect, coffer, beam_every, margin, beam_width):
    x0, y0, x1, y1 = rect
    W, D = x1 - x0, y1 - y0
    if beam_every:
        k = beam_every
        n_bays = max(1, round((W - 2 * margin + beam_width) / (k * coffer + beam_width)))
        px = (W - 2 * margin - (n_bays - 1) * beam_width) / (n_bays * k)
    else:
        k = n_bays = None
        px = (W - 2 * margin) / max(1, round((W - 2 * margin) / coffer))
    ny = max(1, round((D - 2 * margin) / px))
    py = (D - 2 * margin) / ny
    cols, beams = [], []
    if beam_every:
        for b in range(n_bays):
            xs = x0 + margin + b * (k * px + beam_width)
            cols += [xs + (i + 0.5) * px for i in range(k)]
            if b < n_bays - 1:
                beams.append((xs + k * px, xs + k * px + beam_width))
    else:
        n = round((W - 2 * margin) / px)
        cols = [x0 + margin + (i + 0.5) * px for i in range(n)]
    rows = [y0 + margin + (j + 0.5) * py for j in range(ny)]
    return px, py, cols, rows, beams


class _Bay:
    """A run of coffers between two principals (or the whole room), minus any holes, as grid cells."""

    def __init__(self, cols, rows, px, py, holes):
        self.px, self.py = px, py
        self.x0 = cols[0] - px / 2
        self.y0 = rows[0] - py / 2
        self.nx, self.ny = len(cols), len(rows)
        self.xe = [self.x0 + m * px for m in range(self.nx + 1)]
        self.ye = [self.y0 + n * py for n in range(self.ny + 1)]
        self.cells = {(m, n) for m in range(self.nx) for n in range(self.ny)
                      if not any(_inside(cols[m], rows[n], h) for h in holes)}
        self.centres = {(m, n): (cols[m], rows[n]) for m, n in self.cells}
        self.loops = _cell_loops(self.cells, self.xe, self.ye)

    def has(self, x, y):
        m = math.floor((x - self.x0) / self.px)
        n = math.floor((y - self.y0) / self.py)
        return (m, n) in self.cells

    def inset_has(self, x, y, d):
        """Inside the bay by at least d from its boundary (features are much wider than d)."""
        return all(self.has(x + sx * d, y + sy * d) for sx in (-1, 0, 1) for sy in (-1, 0, 1))


def build_coffered_ceiling(rect, height, coffer=1.4, beam_every=0, *, name="Lobby", style="flat",
                           margin=0.35, beam_width=0.6, step=None, cove=True, cove_base=None, cove_proj=0.26,
                           frame="walnut", panels=("ivory_paint",), accent="gilt", rosettes=False,
                           rosette_scale=1.0, recess=None, holes=(), trim=None, channel=None,
                           cornice_proj=0.0, skip_rosettes=(), consoles=False, col=None, seed=7):
    """A coffered ceiling filling a rectangular room, built in place.

    rect      plan rect (web dict) or (minX, maxX, minZ, maxZ) web.
    height    soffit: the lowest ceiling plane (principal beams, trimmers, margin band).
    coffer    target coffer pitch (m). beam_every: coffers between principal beams running north-south
              (0 = plain grid). The grid is solved so bays, beams and margins fit the room exactly.
    step      how far the secondary ribs sit above the principals (default 0.2 with beams, else 0);
              every bay of coffers is framed by a moulded bed mould rising through it.
    style     "rich" (hall: cyma, gilt bead, stepped second frame, cove) or "flat" (simpler lining).
    cove      True: a plaster/wood cove from the wall up to the soffit and a margin band (rooms without a
              big cornice). False: the margin is left to the wall cornice (the hall: arch_shell's corona
              projects `cornice_proj` and hides it); principal channels stop clear of that cornice.
    panels    one or two palette keys; two alternate in a checkerboard.
    holes     Blender rects (x0, y0, x1, y1) on the coffer grid lines, left open (e.g. a laylight): the
              principals are cut there and a trimmer band `trim` wide (default beam_width, with the
              ornament channel carried round, mitred) frames each; the well inside is the caller's.
    channel   width of the gilt-lined ornament channel sunk in principal / trimmer soffits (rich: 0.40).
    Returns the list of objects (all in `col`, default ARCHITECTURE/Ceiling)."""
    col = col or _col()
    rng = random.Random(seed)
    room = _brect(rect)
    rich = style == "rich"
    step = (0.2 if beam_every else 0.0) if step is None else step
    recess = (RECESS if rich else 0.15) if recess is None else recess
    cove_base = height - 0.3 if cove_base is None else cove_base
    half_rib = HALF_RIB if rich else 0.09
    trim = beam_width if trim is None else trim
    channel = (CHANNEL if (rich and beam_every) else 0.0) if channel is None else channel
    px, py, cols, rows, beams = _layout(room, coffer, beam_every, margin, beam_width)
    z0, z1 = height, height + step
    objs = []
    tag = f"Architecture_Ceiling_{name}"
    sizes = [tex_size(frame), 1.0, tex_size("ornament_band")]
    holes = [tuple(h) for h in holes]
    openings = [_inset(h, trim) for h in holes]

    # Bays of coffers between the principals
    k = beam_every or len(cols)
    bays = [_Bay(cols[i:i + k], rows, px, py, holes) for i in range(0, len(cols), k)]

    def in_any_bay(x, y):
        return any(b.has(x, y) for b in bays)

    # Cove + margin (rooms without a wall cornice)
    s_edge = margin
    if cove:
        bm = bmesh.new()
        cprof, s_edge = cove_profile(cove_base, height, cove_proj)
        ring_stack(bm, room, cprof, [tex_size("plaster"), 1.0, tex_size(frame)])
        cv = _obj(f"{tag}_Cove", bm, ["plaster" if rich else frame, accent], col)
        _finish_wood(cv)
        objs.append(cv)
    soffit_r = _inset(room, s_edge)

    # ---- Beams: principal / trimmer / margin soffit (one welded grid), ornament channels, bed moulds ----
    bm = bmesh.new()
    chan_rects = []
    if beams and channel > 0:
        ys0, ys1 = room[1] + margin, room[3] - margin
        e_wall = max(0.0, cornice_proj - margin) + (beam_width - channel) / 2 if not cove else (beam_width - channel) / 2 + (margin - s_edge)
        e_hole = (trim - channel) / 2
        for bx0, bx1 in beams:
            segs = [(ys0, ys1, e_wall, e_wall)]
            for h in holes:
                if h[0] <= bx0 + 1e-6 and h[2] >= bx1 - 1e-6:
                    nxt = []
                    for a, b, ea, eb in segs:
                        if h[3] <= a or h[1] >= b:
                            nxt.append((a, b, ea, eb))
                            continue
                        if h[1] > a:
                            nxt.append((a, h[1], ea, e_hole))
                        if h[3] < b:
                            nxt.append((h[3], b, e_hole, eb))
                    segs = nxt
            xc = (bx0 + bx1) / 2
            for a, b, ea, eb in segs:
                chan_rects.append((xc - channel / 2, a + ea, xc + channel / 2, b - eb))
    annuli = [(_inset(h, (trim - channel) / 2), _inset(h, (trim + channel) / 2)) for h in holes] if channel > 0 else []

    def in_channel(x, y):
        if any(_inside(x, y, c) for c in chan_rects):
            return True
        return any(_inside(x, y, a) and not _inside(x, y, b) for a, b in annuli)

    def member_uv(x, y, cx, cy):
        size = sizes[0]
        for hi, h in enumerate(holes):
            if _inside(cx, cy, h):
                if cy < h[1] + trim or cy > h[3] - trim:
                    return (x / size + 0.37 * hi + 0.11, y / size + 0.5)
                return (y / size + 0.23 * hi + 0.71, x / size)
        if cove and (cy < room[1] + margin or cy > room[3] - margin):
            return (x / size + 0.5, y / size)
        bi = min(range(len(beams)), key=lambda i: abs((beams[i][0] + beams[i][1]) / 2 - cx)) if beams else 0
        return (y / size + 0.29 * bi + 0.05, x / size + 0.17 * bi)

    if step > 0:
        xs = [soffit_r[0], soffit_r[2]]
        ys = [soffit_r[1], soffit_r[3]]
        for b in bays:
            for lp in b.loops:
                xs += [p[0] for p in lp]
                ys += [p[1] for p in lp]
        for r_ in holes + openings + chan_rects + [q for a in annuli for q in a]:
            xs += [r_[0], r_[2]]
            ys += [r_[1], r_[3]]

        def soffit_in(x, y):
            return (_inside(x, y, soffit_r) and not in_any_bay(x, y) and not in_channel(x, y)
                    and not any(_inside(x, y, o) for o in openings))
        _grid_faces(bm, xs, ys, z0, soffit_in, member_uv, 0)

        # sunk ornament channels with gilt beads (stopped short of walls and trimmers; mitred round holes)
        if channel > 0:
            half = channel_half(z0)
            for cr in chan_rects:
                fl = (cr[0] + CH_FLOOR_IN, cr[2] - CH_FLOOR_IN)
                bw = fl[1] - fl[0]
                ring_stack(bm, cr, [pt(-0.010, z0 + 0.003)] + half, [sizes[0], 1.0, 2 * bw], cap=2,
                           cap_uv=lambda co, fl=fl, bw=bw: (co.y / (2 * bw), (co.x - fl[0]) / (fl[1] - fl[0])))
            for (ha, hb_) in annuli:
                w_ = (hb_[0] - ha[0])
                bw = w_ - 2 * CH_FLOOR_IN
                prof = [pt(-0.010, z0 + 0.003)] + half
                prof += [pt(w_ - CH_FLOOR_IN, z0 + CH_DEPTH, 2, "band")]
                prof += _mirror_tail(half, 0.0, w_)
                prof += [pt(w_ + 0.010, z0 + 0.003)]
                ring_stack(bm, ha, prof, [sizes[0], 1.0, 2 * bw])

        # bed moulds round every bay (and round the notches the holes cut in them)
        bprof, d_b = bed_profile(z0, step, style)
        for b in bays:
            for lp in b.loops:
                poly_ring(bm, lp, bprof, sizes)
        beams_ob = _obj(f"{tag}_Beams", bm, [frame, accent, "ornament_band"], col)
        _finish_wood(beams_ob)
        objs.append(beams_ob)
    else:
        d_b = 0.0
        bm.free()

    # ---- Ribs: the secondary soffit, continuous runs between the coffer openings ----
    hr = half_rib
    ox, oy = px - 2 * hr, py - 2 * hr
    bm = bmesh.new()
    size = sizes[0]
    for bi, b in enumerate(bays):
        ops = [(c[0] - ox / 2, c[1] - oy / 2, c[0] + ox / 2, c[1] + oy / 2) for c in b.centres.values()]
        if step > 0:
            xs, ys = [], []
            for lp in b.loops:
                xs += [p[0] + s * d_b for p in lp for s in (-1, 1)]
                ys += [p[1] + s * d_b for p in lp for s in (-1, 1)]

            def rib_in(x, y, b=b, ops=ops):
                return b.inset_has(x, y, d_b) and not any(_inside(x, y, o) for o in ops)
        else:
            reg = soffit_r
            xs, ys = [reg[0], reg[2]], [reg[1], reg[3]]

            def rib_in(x, y, ops=ops, reg=reg):
                return (_inside(x, y, reg) and not any(_inside(x, y, o) for o in ops)
                        and not in_channel(x, y) and not any(_inside(x, y, o) for o in openings))
            for r_ in chan_rects + openings:
                xs += [r_[0], r_[2]]
                ys += [r_[1], r_[3]]
        for o in ops:
            xs += [o[0], o[2]]
            ys += [o[1], o[3]]
        row_bands = sorted({(round(o[1], 5), round(o[3], 5)) for o in ops})

        def rib_uv(x, y, cx, cy, bi=bi, row_bands=row_bands):
            in_row = next((i for i, (a, c) in enumerate(row_bands) if a < cy < c), None)
            if in_row is None:          # an east-west run: grain along x, through the crossings
                run = sum(1 for a, c in row_bands if c <= cy)
                return (x / size + _hash01(bi, run, 1) * 3.0, y / size + _hash01(bi, run, 2))
            col_i = math.floor((cx - b.x0) / b.px + 0.5)
            return (y / size + _hash01(bi, in_row, col_i, 3) * 3.0, x / size + _hash01(bi, col_i, 4))
        _grid_faces(bm, xs, ys, z1, rib_in, rib_uv, 0)
    ribs = _obj(f"{tag}_Ribs", bm, [frame], col)
    _finish_wood(ribs)
    objs.append(ribs)

    # ---- Coffer linings (8 grain variants, turned at random), checkerboard of panels, rosettes ----
    variants = []
    for pm in panels:
        vs = []
        for v in range(4):
            uo = (rng.random() * 3.0, rng.random() * 2.0)
            vs.append(tile_mesh(f"Ceiling_{name}_Coffer_{pm}_{v + 1}", ox, oy, frame, accent, pm, style, recess, uo))
        variants.append(vs)
    ros = None
    if rosettes:
        ros = _mesh_only(f"Ceiling_{name}_Rosette", rosette_bm(scale=rosette_scale), [accent])
    square = abs(ox - oy) < 1e-6
    n = 0
    for bi, b in enumerate(bays):
        for (m, nn), (x, y) in sorted(b.centres.items(), key=lambda kv: (kv[1][1], kv[1][0])):
            i = cols.index(x)
            j = rows.index(y)
            n += 1
            vs = variants[(i + j) % len(variants)]
            me = vs[int(_hash01(i, j, 11) * len(vs)) % len(vs)]
            turns = int(_hash01(i, j, 12) * 4) % 4 if square else 2 * (int(_hash01(i, j, 12) * 2) % 2)
            objs.append(_inst(me, f"{tag}_Coffer_{n:03d}", (x, y, z1), col, turns * math.pi / 2))
            if ros is not None and not any(abs(x - sx) < px / 2 and abs(y - sy) < py / 2 for sx, sy in skip_rosettes):
                objs.append(_inst(ros, f"{tag}_Rosette_{n:03d}", (x, y, z1 + recess), col, 0.0))   # spines on the painted ones

    # ---- Consoles under the principal ends (cove rooms only) ----
    if consoles and cove and beams:
        cm = console_mesh(f"Ceiling_{name}_Console", frame, margin - 0.005, height - cove_base)
        k_ = 0
        for bx0, bx1 in beams:
            xc = (bx0 + bx1) / 2
            for y, rz in ((room[1], math.pi), (room[3], 0.0)):
                k_ += 1
                objs.append(_inst(cm, f"{tag}_Console_{k_:02d}", (xc, y, cove_base), col, rz))
    return objs


# ---------------------------------------------------------------------------
# Laylight
# ---------------------------------------------------------------------------

def laylight_rect():
    """The laylight's region on the coffer grid lines: 5 coffer columns (the centre bay plus one each side;
    the two principals between are cut and frame into the trimmers) by 5 rows, centred on web (0, -1).
    Blender (x0, y0, x1, y1) = (-4.825, -2.875, 4.825, 4.875)."""
    cx, cy = LAYLIGHT_C.x, LAYLIGHT_C.y
    hx = 2.8 + BEAM_W / 2 + PITCH
    hy = LAY_ROWS / 2 * PITCH
    return (cx - hx, cy - hy, cx + hx, cy + hy)


def laylight_opening():
    """The well's opening in the trimmer soffit (7.75 x 5.85 m)."""
    return _inset(laylight_rect(), TRIM)


def laylight_glass_rect():
    """The glazed area at the top of the well (6.63 x 4.73 m)."""
    return _inset(laylight_opening(), WELL_D)


def _bar(bm, axis, c, a0, a1, prof, mi=0):
    """Extrudes an open-topped bar profile [(across, z), ...] along `axis` ('x' or 'y') from a0 to a1 at
    the across-position c. Ends capped."""
    if axis == "x":
        _bar_seg(bm, (a0, c), (a1, c), prof, mi)
    else:
        _bar_seg(bm, (c, a0), (c, a1), prof, mi)


def _bar_seg(bm, p0, p1, prof, mi=0):
    """Extrudes an open-topped bar profile [(across, z), ...] between two plan points (any direction)."""
    p0, p1 = Vector(p0), Vector(p1)
    t = (p1 - p0)
    if t.length < 1e-5:
        return
    t.normalize()
    nrm = Vector((-t.y, t.x))
    r0 = [bm.verts.new((p0.x + nrm.x * a, p0.y + nrm.y * a, z)) for a, z in prof]
    r1 = [bm.verts.new((p1.x + nrm.x * a, p1.y + nrm.y * a, z)) for a, z in prof]
    ztop = max(z for _, z in prof)
    for i in range(len(prof) - 1):
        ma = (prof[i][0] + prof[i + 1][0]) / 2
        mz = (prof[i][1] + prof[i + 1][1]) / 2
        h = Vector((nrm.x * ma, nrm.y * ma, mz - ztop))
        _face(bm, (r0[i], r0[i + 1], r1[i + 1], r1[i]), h, mi)
    _face(bm, list(reversed(r0)), (-t.x, -t.y, 0), mi)
    _face(bm, r1, (t.x, t.y, 0), mi)


def _ring_bar(bm, cx, cy, rx, ry, prof, n=64, mi=0):
    """Sweeps an open-topped bar profile round an ellipse (the medallion's came)."""
    rings = []
    for i in range(n):
        th = math.tau * i / n
        p = Vector((cx + rx * math.cos(th), cy + ry * math.sin(th)))
        N = Vector((math.cos(th) / rx, math.sin(th) / ry)).normalized()
        rings.append((N, [bm.verts.new((p.x + N.x * a, p.y + N.y * a, z)) for a, z in prof]))
    ztop = max(z for _, z in prof)
    for i in range(n):
        Na, ra = rings[i]
        _, rb = rings[(i + 1) % n]
        for k in range(len(prof) - 1):
            ma = (prof[k][0] + prof[k + 1][0]) / 2
            mz = (prof[k][1] + prof[k + 1][1]) / 2
            _face(bm, (ra[k], ra[k + 1], rb[k + 1], rb[k]), (Na.x * ma, Na.y * ma, mz - ztop), mi)


def _major_prof(top):
    """Bulb-tee glazing bar: flange under the glass, slender web, beaded bulb."""
    pts = [(-0.019, top), (-0.019, top - 0.006), (-0.006, top - 0.010), (-0.006, top - 0.058)]
    for k in range(1, 8):
        a = math.radians(180 + 180 * k / 8)
        pts.append((0.011 * math.cos(a), top - 0.069 + 0.011 * math.sin(a)))
    pts += [(0.006, top - 0.058), (0.006, top - 0.010), (0.019, top - 0.006), (0.019, top)]
    return pts


def _fine_prof(top, depth, w=0.008):
    return [(-w, top), (-w, top - depth + 0.004), (-w / 2, top - depth), (w / 2, top - depth),
            (w, top - depth + 0.004), (w, top)]


def _came_prof(top):
    """Lead-like came for the border quarries."""
    return [(-0.0065, top), (-0.0045, top - 0.014), (0.0045, top - 0.014), (0.0065, top)]


def _clip_ellipse(axis, c, a0, a1, med):
    """Splits a bar line (axis 'x' at y = c, or 'y' at x = c) where it crosses the medallion ellipse."""
    ex, ey, rx, ry = med
    if axis == "x":
        u = (c - ey) / ry
        mid, rad = ex, rx
    else:
        u = (c - ex) / rx
        mid, rad = ey, ry
    if abs(u) >= 1:
        return [(a0, a1)]
    h = rad * math.sqrt(1 - u * u)
    out = []
    if mid - h > a0 + 1e-4:
        out.append((a0, min(a1, mid - h)))
    if mid + h < a1 - 1e-4:
        out.append((max(a0, mid + h), a1))
    return out


def _in_ellipse(x, y, med, s=1.0):
    ex, ey, rx, ry = med
    return ((x - ex) / (rx * s)) ** 2 + ((y - ey) / (ry * s)) ** 2 < 1.0


def build_laylight(opening, col=None, name="Architecture_Ceiling_Hall_Laylight", z0=SOFFIT, top=LAYLIGHT_Z):
    """The laylight inside a trimmer-framed opening (Blender rect): the coved well (_Frame), the patterned
    glass (_Glass) and the ironwork (_Ironwork). Returns the three objects."""
    col = col or _col()
    objs = []
    bm = bmesh.new()
    prof, cove_len = well_profile(z0, top)
    ring_stack(bm, opening, prof, [tex_size("walnut"), 1.0, 2 * cove_len])
    frame = _obj(f"{name}_Frame", bm, ["walnut", "gilt", "ornament_band"], col)
    _finish_wood(frame)
    objs.append(frame)

    G = _inset(opening, WELL_D)                        # glass edge = the rebate face
    CURB, BORDER = 0.045, 0.30
    B0 = _inset(G, CURB)                               # border band outer edge
    F = _inset(G, CURB + BORDER)                       # field
    cx, cy = (G[0] + G[2]) / 2, (G[1] + G[3]) / 2
    med = (cx, cy, 0.98, 0.78)
    zg = top + 0.002
    zm = top - 0.016                                   # the medallion hangs just under the field glass

    # ---- Glass ----
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.verify()

    def quad(pts, mi, z=zg):
        f = _face(bm, [bm.verts.new((x, y, z)) for x, y in pts], (0, 0, -1), mi)
        for loop in f.loops:
            loop[uvl].uv = _uv_planar(loop.vert.co, G)
        return f

    # tucked strip under the curb
    Gt = _inset(G, -0.010)
    for a, b in ((Gt, B0),):
        quad([(a[0], a[1]), (a[2], a[1]), (b[2], b[1]), (b[0], b[1])], G_COOL)
        quad([(a[2], a[1]), (a[2], a[3]), (b[2], b[3]), (b[2], b[1])], G_COOL)
        quad([(a[2], a[3]), (a[0], a[3]), (b[0], b[3]), (b[2], b[3])], G_COOL)
        quad([(a[0], a[3]), (a[0], a[1]), (b[0], b[1]), (b[0], b[3])], G_COOL)

    def quarry(x0, y0, x1, y1, mid_mi, tri_mi):
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        quad([(mx, y0), (x1, my), (mx, y1), (x0, my)], mid_mi)
        quad([(x0, y0), (mx, y0), (x0, my)], tri_mi)
        quad([(mx, y0), (x1, y0), (x1, my)], tri_mi)
        quad([(x1, my), (x1, y1), (mx, y1)], tri_mi)
        quad([(x0, my), (mx, y1), (x0, y1)], tri_mi)

    quarries = []
    nxq = max(1, round((F[2] - F[0]) / BORDER))
    nyq = max(1, round((F[3] - F[1]) / BORDER))
    sxq, syq = (F[2] - F[0]) / nxq, (F[3] - F[1]) / nyq
    for i in range(nxq):
        xa, xb = F[0] + i * sxq, F[0] + (i + 1) * sxq
        quarries += [(xa, B0[1], xb, F[1]), (xa, F[3], xb, B0[3])]
    for j in range(nyq):
        ya, yb = F[1] + j * syq, F[1] + (j + 1) * syq
        quarries += [(B0[0], ya, F[0], yb), (F[2], ya, B0[2], yb)]
    for q in quarries:
        quarry(*q, G_PALE, G_DEEP)
    corners = [(B0[0], B0[1], F[0], F[1]), (F[2], B0[1], B0[2], F[1]), (F[2], F[3], B0[2], B0[3]), (B0[0], F[3], F[0], B0[3])]
    for q in corners:
        quarry(*q, G_AMBER, G_DEEP)

    # field: 5 x 3 bays of 3 x 3 panes; each bay a quiet cross (pale centre, cool corners), toned at random
    NBX, NBY, SUB = 5, 3, 3
    nx, ny = NBX * SUB, NBY * SUB
    fxs = [F[0] + (F[2] - F[0]) * i / nx for i in range(nx + 1)]
    fys = [F[1] + (F[3] - F[1]) * j / ny for j in range(ny + 1)]
    V = {}

    def fv(i, j):
        if (i, j) not in V:
            V[i, j] = bm.verts.new((fxs[i], fys[j], zg))
        return V[i, j]
    for i in range(nx):
        for j in range(ny):
            corners_in = [_in_ellipse(fxs[a], fys[b], med, 0.97) for a in (i, i + 1) for b in (j, j + 1)]
            if all(corners_in):
                continue
            a, b = i % SUB, j % SUB
            if (a, b) == (1, 1):
                mi = G_PALE
            elif a == 1 or b == 1:
                mi = G_FIELD
            else:
                mi = G_COOL
            if mi != G_PALE and _hash01(i, j, 21) < 0.22:
                mi = G_COOL if mi == G_FIELD else G_FIELD
            f = bm.faces.new((fv(i, j), fv(i, j + 1), fv(i + 1, j + 1), fv(i + 1, j)))
            f.material_index = mi
            for loop in f.loops:
                loop[uvl].uv = _uv_planar(loop.vert.co, G)

    # medallion: pale outer ring, deep blue middle, amber heart (just below the field glass)
    ex, ey, rx, ry = med
    NM = 72
    scales = [(0.0, G_AMBER), (0.36, G_DEEP), (0.80, G_PALE), (1.0, None)]
    prev = None
    for s, mi_next in scales:
        ring = [bm.verts.new((ex + rx * s * math.cos(math.tau * i / NM), ey + ry * s * math.sin(math.tau * i / NM), zm))
                for i in range(NM)] if s > 0 else [bm.verts.new((ex, ey, zm))]
        if prev is not None:
            pr, pmi = prev
            for i in range(NM):
                j = (i + 1) % NM
                if len(pr) == 1:
                    f = _face(bm, [pr[0], ring[i], ring[j]], (0, 0, -1), pmi)
                else:
                    f = _face(bm, [pr[i], ring[i], ring[j], pr[j]], (0, 0, -1), pmi)
                for loop in f.loops:
                    loop[uvl].uv = _uv_planar(loop.vert.co, G)
        prev = (ring, mi_next)
    glass = _obj(f"{name}_Glass", bm, GLASS_KEYS, col)
    objs.append(glass)

    # ---- Ironwork ----
    bm = bmesh.new()
    t = top
    # curb in the rebate: soffit + inner face, flange tucked into the walnut
    curb = [pt(-0.008, t - 0.050), pt(0, t - 0.066), pt(CURB - 0.005, t - 0.066)]
    curb += arc(CURB - 0.005, t - 0.061, 0.005, 0.005, -90, 0, 2)
    curb += [pt(CURB, t + 0.001)]
    ring_stack(bm, G, curb, [0.5])
    # border / field divider: a bulb-tee frame mitred round the field
    mp = _major_prof(t - 0.001)
    ring_stack(bm, F, [pt(a, z) for a, z in [(-x, z) for x, z in mp]], [0.5])
    # border: cross bars between quarries and lead came round each diamond
    fine_b = _fine_prof(t - 0.001, 0.030, 0.007)
    came = _came_prof(t - 0.001)
    for i in range(1, nxq):
        x = F[0] + i * sxq
        _bar(bm, "y", x, B0[1], F[1], fine_b)
        _bar(bm, "y", x, F[3], B0[3], fine_b)
    for j in range(1, nyq):
        y = F[1] + j * syq
        _bar(bm, "x", y, B0[0], F[0], fine_b)
        _bar(bm, "x", y, F[2], B0[2], fine_b)
    for x in (F[0], F[2]):
        _bar(bm, "y", x, B0[1], F[1], fine_b)
        _bar(bm, "y", x, F[3], B0[3], fine_b)
    for y in (F[1], F[3]):
        _bar(bm, "x", y, B0[0], F[0], fine_b)
        _bar(bm, "x", y, F[2], B0[2], fine_b)
    for x0, y0, x1, y1 in quarries + corners:
        mx, my = (x0 + x1) / 2, (y0 + y1) / 2
        d = [(mx, y0), (x1, my), (mx, y1), (x0, my)]
        for k in range(4):
            _bar_seg(bm, d[k], d[(k + 1) % 4], came)
    # field: bulb-tee majors between bays, fine bars between panes, all stopping at the medallion ring
    fine_x = _fine_prof(t - 0.001, 0.036)
    fine_y = _fine_prof(t - 0.001, 0.032)
    mp_y = [(a, z + 0.006 if z < t - 0.02 else z) for a, z in mp]
    for i in range(1, nx):
        x = fxs[i]
        major = i % SUB == 0
        for a0, a1 in _clip_ellipse("y", x, F[1], F[3], med):
            _bar(bm, "y", x, a0, a1, mp if major else fine_x)
    for j in range(1, ny):
        y = fys[j]
        major = j % SUB == 0
        for a0, a1 in _clip_ellipse("x", y, F[0], F[2], med):
            _bar(bm, "x", y, a0, a1, mp_y if major else fine_y)
    boss_prof = [(0, t - 0.090), (0.014, t - 0.087), (0.024, t - 0.077), (0.027, t - 0.066), (0.026, t - 0.060)]
    for i in range(SUB, nx, SUB):
        for j in range(SUB, ny, SUB):
            if _in_ellipse(fxs[i], fys[j], med, 1.06):
                continue
            rs = _lathe_bm(bm, boss_prof, 16, flip=True)
            for ring in rs:
                for v in ring:
                    v.co.x += fxs[i]
                    v.co.y += fys[j]
    # medallion came: a bulb ring round it, two fine rings, twelve spokes and twelve short ones
    zt = zm - 0.001
    _ring_bar(bm, ex, ey, rx, ry, [(-a, z) for a, z in _major_prof(t - 0.001)], 96)
    _ring_bar(bm, ex, ey, rx * 0.80, ry * 0.80, _fine_prof(zt, 0.030, 0.009), 72)
    _ring_bar(bm, ex, ey, rx * 0.36, ry * 0.36, _fine_prof(zt, 0.030, 0.009), 48)
    for k in range(24):
        th = math.tau * (k + 0.5) / 24
        s0 = 0.36 if k % 2 == 0 else 0.80
        p0 = (ex + rx * s0 * math.cos(th), ey + ry * s0 * math.sin(th))
        p1 = (ex + rx * 0.99 * math.cos(th), ey + ry * 0.99 * math.sin(th))
        _bar_seg(bm, p0, p1, _fine_prof(zt, 0.026, 0.0065))
    rs = _lathe_bm(bm, [(0, zt - 0.05), (0.022, zt - 0.046), (0.036, zt - 0.032), (0.040, zt - 0.018), (0.038, zt)], 20, flip=True)
    for ring in rs:
        for v in ring:
            v.co.x += ex
            v.co.y += ey
    iron = _obj(f"{name}_Ironwork", bm, ["iron"], col)
    C.uv_box(iron, 0.5)
    C.shade_smooth(iron, 50)
    objs.append(iron)
    return objs


# ---------------------------------------------------------------------------
# Hall and lobby
# ---------------------------------------------------------------------------

def hall_chandeliers():
    hall = _brect(P.HALL)
    out = []
    for L in P.LIGHTS:
        if L["kind"] != "chandelier":
            continue
        p = C.bl(L["x"], L["y"], L["z"])
        if _inside(p.x, p.y, hall):
            out.append((L["id"], p.x, p.y))
    return out


def build_hall_ceiling():
    col = _col()
    lay = laylight_rect()
    room = _brect(P.HALL)
    px, py, cols, rows, beams = _layout(room, PITCH, BAY_COFFERS, MARGIN, BEAM_W)
    assert abs(px - PITCH) < 1e-6 and abs(py - PITCH) < 1e-6, (px, py)
    centres = sorted((a + b) / 2 for a, b in beams)
    assert all(abs(c - p) < 1e-6 for c, p in zip(centres, P.HALL_PIERS[1:-1])), centres
    edges_x = {round(c + s * px / 2, 6) for c in cols for s in (-1, 1)}
    edges_y = {round(r + s * py / 2, 6) for r in rows for s in (-1, 1)}
    assert {round(lay[0], 6), round(lay[2], 6)} <= edges_x and {round(lay[1], 6), round(lay[3], 6)} <= edges_y, lay
    anchors = []
    for lid, x, y in hall_chandeliers():
        cx = min(cols, key=lambda c: abs(c - x))
        cy = min(rows, key=lambda r: abs(r - y))
        assert not _inside(cx, cy, lay), lid
        anchors.append((lid, cx, cy))
    objs = build_coffered_ceiling(P.HALL, SOFFIT, PITCH, BAY_COFFERS, name="Hall", style="rich", margin=MARGIN,
                                  beam_width=BEAM_W, step=STEP, cove=False, frame="walnut",
                                  panels=("coffer_panel", "coffer_red"), accent="gilt", rosettes=True,
                                  holes=[lay], trim=TRIM, channel=CHANNEL, cornice_proj=CORNICE_PROJ,
                                  skip_rosettes=[(x, y) for _, x, y in anchors], consoles=False, col=col)
    objs += build_laylight(laylight_opening(), col)
    for lid, x, y in anchors:
        objs.append(C.empty(f"Anchor_Ceiling_{lid}", (x, y, CHANDELIER_CONTACT_Z), col=col, size=0.3))
    return objs


def build_lobby_ceiling():
    """The entrance hall: the generic ceiling with simpler flat coffers (plaster, green panels, small gilt
    rosettes), a cove to the walls, no principals."""
    return build_coffered_ceiling(P.LOBBY, P.LOBBY_CEILING, coffer=1.4, beam_every=0, name="Lobby", style="flat",
                                  margin=0.34, cove=True, cove_base=P.LOBBY_CEILING - 0.3, cove_proj=0.24,
                                  frame="plaster", panels=("plaster_green",), accent="gilt", rosettes=True,
                                  rosette_scale=0.6)


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _standins(real_cornice=True):
    """Preview-only room shells (walls, floor) and the REAL hall cornice from arch_shell, so every preview
    checks the actual junction (a plain stand-in cornice is used only if arch_shell cannot be built)."""
    objs = []
    for nm, (x0, y0, x1, y1), top in (("Hall", _brect(P.HALL), P.HALL_WALL_TOP),
                                      ("Lobby", _brect(P.LOBBY), P.LOBBY_CEILING + 0.3)):
        t = 0.8
        for side, lo, hi in (("S", (x0 - t, y0 - t, 0), (x1 + t, y0, top)), ("N", (x0 - t, y1, 0), (x1 + t, y1 + t, top)),
                             ("W", (x0 - t, y0, 0), (x0, y1, top)), ("E", (x1, y0, 0), (x1 + t, y1, top))):
            if nm == "Lobby" and side == "N":
                continue
            objs.append(C.box_minmax(f"Preview_Standin_{nm}_Wall_{side}", lo, hi, mat("limestone_plain")))
        objs.append(C.box_minmax(f"Preview_Standin_{nm}_Floor", (x0, y0, -0.1), (x1, y1, 0), mat("parquet_herringbone")))
    built = False
    if real_cornice:
        try:
            import arch_shell
            objs += arch_shell.build_hall_cornice()
            built = True
        except Exception as e:                                   # the shell module is edited in parallel
            print("PREVIEW: arch_shell cornice unavailable, using a stand-in:", e)
    if not built:
        x0, y0, x1, y1 = _brect(P.HALL)
        cz = P.HALL_CORNICE
        bm = bmesh.new()
        prof = [pt(0, cz), pt(0.14, cz), pt(0.14, cz + 0.3), pt(0.19, cz + 0.64), pt(0.31, cz + 0.78),
                pt(0.31, cz + 0.85), pt(0.70, cz + 0.85), pt(0.70, cz + 1.0), pt(0.0, cz + 1.0)]
        ring_stack(bm, (x0, y0, x1, y1), prof, [1.0])
        objs.append(_obj("Preview_Standin_Hall_Cornice", bm, ["limestone_plain"], None))
    return objs


def _lights(scene):
    hall = _brect(P.HALL)
    cx, cy = (hall[0] + hall[2]) / 2, (hall[1] + hall[3]) / 2
    lights = []
    up = bpy.data.lights.new("Preview_Bounce", "AREA")
    up.shape = "RECTANGLE"
    up.size, up.size_y = 24.0, 14.0
    up.energy = 2200
    up.color = (1.0, 0.74, 0.50)
    ob = bpy.data.objects.new("Preview_Bounce", up)
    scene.collection.objects.link(ob)
    ob.location = (cx, cy, 0.9)
    ob.rotation_euler = (math.pi, 0, 0)
    lights.append(ob)
    for lid, x, y in hall_chandeliers():
        lights.append(R.point_light(f"Preview_{lid}", (x, y, 7.4), 3000, (1.0, 0.74, 0.47), 0.9))
    G = laylight_glass_rect()
    sky = bpy.data.lights.new("Preview_Daylight", "AREA")
    sky.shape = "RECTANGLE"
    sky.size, sky.size_y = G[2] - G[0] - 0.2, G[3] - G[1] - 0.2
    sky.energy = 700
    sky.color = (0.80, 0.88, 1.0)
    ob = bpy.data.objects.new("Preview_Daylight", sky)
    scene.collection.objects.link(ob)
    ob.location = ((G[0] + G[2]) / 2, (G[1] + G[3]) / 2, LAYLIGHT_Z - 0.11)
    lights.append(ob)
    lb = _brect(P.LOBBY)
    lights.append(R.point_light("Preview_Lobby_Lantern", ((lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2, 5.8), 900,
                                (1.0, 0.8, 0.58), 0.6))
    up2 = bpy.data.lights.new("Preview_Lobby_Bounce", "AREA")
    up2.shape = "RECTANGLE"
    up2.size, up2.size_y = 10, 9
    up2.energy = 700
    up2.color = (1.0, 0.8, 0.6)
    ob = bpy.data.objects.new("Preview_Lobby_Bounce", up2)
    scene.collection.objects.link(ob)
    ob.location = ((lb[0] + lb[2]) / 2, (lb[1] + lb[3]) / 2, 0.8)
    ob.rotation_euler = (math.pi, 0, 0)
    lights.append(ob)
    return lights


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


def _bay_tris(objs):
    """Rendered triangles per 5.6 m bay (pier to pier): faces of the in-place meshes binned by their
    centroid, instanced coffers / rosettes by their location."""
    piers = P.HALL_PIERS
    out = [0] * (len(piers) - 1)

    def bay_of(x):
        for b in range(len(piers) - 1):
            if x < piers[b + 1] or b == len(piers) - 2:
                return b
    for o in objs:
        if o.type != "MESH":
            continue
        if o.data.users > 1 or "_Coffer_" in o.name or "_Rosette_" in o.name:
            out[bay_of(o.location.x)] += C.tris(o)
        else:
            mw = o.matrix_world
            for p in o.data.polygons:
                out[bay_of((mw @ p.center).x)] += len(p.vertices) - 2
    return out


def _preview_fitted_materials():
    """Preview only: renders the textured palette keys with textures.py's fitted tints and gilt masks
    (textures/palette_fit.json), i.e. as they look once lib_materials adopts that patch. Without it the
    regenerated coffer_panel texture (calibrated for a fitted tint) renders mauve instead of teal. The
    build functions themselves always use lib_materials.mat()."""
    try:
        import textures as T
        patch = T.palette_patch()
    except Exception as e:                                       # textures.py is edited in parallel
        print("PREVIEW: fitted materials unavailable:", e)
        return
    swap = {}
    for key in patch:
        nm = "M_" + "".join(w.capitalize() for w in key.split("_"))
        if bpy.data.materials.get(nm):
            swap[nm] = T.mat_fitted(key)
    for ob in bpy.data.objects:
        if ob.type == "MESH":
            for slot in ob.material_slots:
                if slot.material and slot.material.name in swap:
                    slot.material = swap[slot.material.name]
    for me in bpy.data.meshes:
        for i, m in enumerate(me.materials):
            if m and m.name in swap:
                me.materials[i] = swap[m.name]
    print("PREVIEW: fitted materials", sorted(swap))


def preview(out_dir):
    scene = bpy.context.scene
    hall = build_hall_ceiling()
    lobby = build_lobby_ceiling()
    _standins()
    if os.environ.get("OVR_FITTED", "1") == "1":
        _preview_fitted_materials()
    _lights(scene)
    R.world(scene, (0.30, 0.27, 0.24), 0.08)
    R.engine(scene, "EEVEE", 40, (960, 640))
    scene.view_settings.exposure = 0.0

    lay = [o for o in hall if "Laylight" in o.name]
    coff = [o for o in hall if "Laylight" not in o.name]
    u, r = _tri_report(coff)
    print(f"TRIS hall coffered ceiling (excl. laylight): unique {u}  rendered {r}")
    for key in ("Beams", "Ribs", "Coffer", "Rosette"):
        sub = [o for o in coff if f"_{key}" in o.name]
        if sub:
            u2, r2 = _tri_report(sub)
            print(f"   {key:8s} objects {len(sub):4d}  unique {u2:6d}  rendered {r2:7d}")
    for o in lay:
        print(f"TRIS {o.name}: {C.tris(o)}")
    print(f"TRIS laylight total: {_tri_report(lay)[1]}")
    for b, t in enumerate(_bay_tris(hall)):
        print(f"TRIS bay {b + 1} (x {P.HALL_PIERS[b]:+.1f}..{P.HALL_PIERS[b + 1]:+.1f}): {t}")
    u, r = _tri_report(hall)
    print(f"TRIS hall ceiling total: unique {u}  rendered {r}")
    u, r = _tri_report(lobby)
    print(f"TRIS lobby ceiling: unique {u}  rendered {r}")
    shots = os.environ.get("OVR_SHOTS", "")
    views = [
        ("floor_up", (0.0, -6.7, 1.7), (0.0, 3.6, 12.6), 15, (960, 640)),
        ("gallery", (-12.4, -6.4, 6.2), (3.0, 4.0, 12.5), 17, (960, 640)),
        ("wide_up", (0.0, 1.0, 1.7), (0.0, 1.0001, 12.6), 13.2, (960, 640)),
        ("lay_floor", (-3.0, -6.0, 1.7), (0.0, 1.0, 13.0), 28, (960, 640)),
        ("junction_floor", (2.8, -2.0, 1.7), (2.8, 10.0, 12.4), 40, (960, 640)),
        ("junction_n", (1.6, 6.8, 10.6), (2.8, 10.0, 12.4), 30, (960, 720)),
        ("crossing", (6.0, 6.0, 11.4), (6.6, 6.9, 12.7), 30, (960, 720)),
        ("cross_up", (6.375, 6.425, 11.4), (6.375, 6.4251, 12.9), 35, (720, 720)),
        ("coffer", (6.65, 6.1, 11.75), (5.6, 7.2, 12.95), 34, (960, 720)),
        ("rosette", (5.92, 6.78, 12.38), (5.6, 7.2, 13.12), 50, (720, 720)),
        ("rosette_b", (4.32, 6.84, 12.40), (4.05, 7.2, 13.12), 60, (720, 720)),
        ("beam_side", (5.6, 2.0, 11.6), (8.4, 4.0, 12.6), 28, (960, 720)),
        ("corner", (-12.6, 8.4, 9.8), (-14.0, 10.0, 12.6), 22, (960, 720)),
        ("laylight", (-2.2, -4.2, 10.6), (-3.6, -1.6, 13.0), 26, (960, 720)),
        ("lay_glass", (0.6, 0.2, 9.5), (0.0, 1.0, 13.4), 30, (960, 720)),
        ("lobby", (0.0, -19.4, 1.7), (0.0, -11.5, 8.0), 16, (960, 640)),
    ]
    cam = R.camera(lens=20)
    for name, loc, tgt, lens, size in views:
        if shots and name not in shots.split(","):
            continue
        scene.render.resolution_x, scene.render.resolution_y = size
        cam.data.lens = lens
        R.look(cam, loc, tgt)
        R.render(os.path.join(out_dir, f"arch_ceiling_{name}.png"))
