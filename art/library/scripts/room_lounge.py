"""
Reading lounge furniture (plan zone "lounge", Ref 2's warmth): walnut, brass, leather and velvet by
the fire. Every builder works at the origin, floor at z = 0, front facing Blender -Y, and fills its
plan.KINDS footprint; KIND_BUILDERS maps the plan kinds to them (builder(item) -> one root object).

  fireplace          carved limestone chimneypiece (moulded plinth blocks, fluted jambs with scrolled
                     consoles, a frieze with a central tablet, a moulded mantel shelf), cast-iron firebox
                     and fireback, a raised stone hearth, a brass fender, brass-and-iron andirons with a
                     log fire (emissive flame cards, glowing embers, ash), a gilt overmantel mirror and a
                     companion set (poker, shovel, brush, tongs). Carries light_points / light_color.
  sofa_chesterfield  deep-buttoned leather chesterfield: rolled arms and back of one height, diamond
                     tufting with crisp pleats (creases lie on mesh edges) and buttons, fan-pleated scroll
                     fronts, loose piped seat cushions, a velvet throw cushion, turned bun feet.
  armchair_club      seed % 2 == 0: high-back leather chesterfield club chair (buttoned all round);
                     seed % 2 == 1: velvet wingback (buttoned back, plain wings, turned legs on castors).
  table_coffee       walnut coffee table with a tooled leather inset top, turned legs and an undertier;
                     a brass tray with a porcelain tea set and a stack of books.
  table_side         round walnut tripod table; seed % 2 == 0 carries a small brass table lamp
                     (light_points), seed % 2 == 1 a book stack and a cup.
  lamp_floor         brass floor lamp: weighted base, turned stem, silk empire shade (light_points).
  window_seat        built-in panelled walnut window seat, fitted piped cushion, scatter cushions.
  magazine_rack      walnut periodicals rack: three sloped display tiers of magazines with readable
                     mastheads and a newspaper tier.

Architecture is not built here: everything is furniture, placed by the scene with lib_core.place.
"""

from __future__ import annotations

import math
import os
import random

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

import lib_core as C
import lib_materials as LM
import lib_render as R
import furn_hall as FH
from lib_materials import tex_size

# ---------------------------------------------------------------------------
# Palette additions (only this module uses them; reported in the module report)
# ---------------------------------------------------------------------------

_ADDED = {
    # Deep green cotton velvet: fabric_green's weave and tint, a soft pile sheen and a little less roughness.
    "velvet_green": dict(base="#1f3a2c", rough=0.8, tex="fabric", size=0.4, normal=0.3, tint="#22443a",
                         sheen=0.12, sheen_tint="#3d5f50", sheen_rough=0.4),
    # Glazed porcelain for the tea set.
    "porcelain": dict(base="#f1ece2", rough=0.12, coat=0.7, coat_rough=0.04),
    # Fire: three emissive flame layers (outer tongue, body, core), embers, ash and bark. Hues lean to
    # yellow because AgX pulls bright saturated orange towards salmon.
    "fire_outer": dict(base="#1a0904", rough=0.9, emission="#ff5a0a", emit=1.0, double_sided=True),
    "fire_body": dict(base="#1a0c04", rough=0.9, emission="#ff8c1c", emit=1.45, double_sided=True),
    "fire_core": dict(base="#1a1206", rough=0.9, emission="#ffbe48", emit=2.6, double_sided=True),
    "ember_glow": dict(base="#2c0e06", rough=0.85, emission="#ff4a08", emit=0.75),
    "fire_glow": dict(base="#1a0904", rough=0.9, emission="#ff6a10", emit=0.9, alpha=0.38, double_sided=True),
    "ash": dict(base="#4b4642", rough=0.97),
    "log_bark": dict(base="#3b2c22", rough=0.93, tex="cork", size=0.35, normal=1.0, tint="#5e6680"),
    # Antique mirror plate (slightly warm silvering).
    "mirror": dict(base="#d6d1c6", rough=0.035, metal=1.0),
    # Printed covers for the periodicals.
    "print_red": dict(base="#8e2f26", rough=0.32),
    "print_navy": dict(base="#1f2d4a", rough=0.32),
    "print_ochre": dict(base="#c4923a", rough=0.32),
    "print_teal": dict(base="#2c5f5c", rough=0.32),
    "print_cream": dict(base="#e8dfcb", rough=0.35),
    "newsprint": dict(base="#dcd4c2", rough=0.9),
    # Polished black hearth stone (plain: a texture's roughness map would kill the polish).
    "marble_dark": dict(base="#211f1d", rough=0.16, coat=0.5, coat_rough=0.06),
    # Sooted cast iron inside the firebox, and charcoal among the embers.
    "soot_iron": dict(base="#0b0a09", rough=0.95),
    "charcoal": dict(base="#151210", rough=0.92),
    # Burgundy cotton velvet (fabric weave, tinted like velvet_green).
    "velvet_burgundy": dict(base="#5e1f26", rough=0.8, tex="fabric", size=0.4, normal=0.3, tint="#6a2633",
                            sheen=0.12, sheen_tint="#7a3a44", sheen_rough=0.4),
    # Newspaper print: grey text columns and a half-tone photo block.
    "news_grey": dict(base="#7a756d", rough=0.9),
    "news_photo": dict(base="#55524d", rough=0.85),
    # Candle wax, tea, and book cloth for the props.
    "candle_wax": dict(base="#efe6cf", rough=0.42, sheen=0.3, sheen_tint="#fff6e0"),
    "tea": dict(base="#3b1a0b", rough=0.04),
    "cloth_red": dict(base="#6e2a22", rough=0.68),
    "cloth_navy": dict(base="#24304a", rough=0.68),
    "cloth_green": dict(base="#2d4a36", rough=0.68),
    "cloth_ochre": dict(base="#9a7434", rough=0.68),
}
for _k, _v in _ADDED.items():
    LM.PALETTE.setdefault(_k, _v)

_mat = FH._mat
_xf, _T, _Rx, _Ry, _Rz = FH._xf, FH._T, FH._Rx, FH._Ry, FH._Rz
_turn, _slab, _loft, _tube = FH._turn, FH._slab, FH._loft, FH._tube
_rpoly, _rect, _catmull = FH._rpoly, FH._rect, FH._catmull
_bx, _uvb, _copy, _finish = FH._bx, FH._uvb, FH._copy, FH._finish
_extrude, _mitre_loft, _align = FH._extrude, FH._mitre_loft, FH._align

LEATHER_SOFA = "leather_brown"
LEATHER_CLUB = "leather_burgundy"
VELVET = "velvet_green"
WOOD = "walnut"


def _join(parts, name):
    ob = FH._join([p for p in parts if p is not None], name)
    return ob


def _smoothstep(e0, e1, x):
    if e1 == e0:
        return 1.0 if x >= e1 else 0.0
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def _right(d):
    return Vector((d.y, -d.x))


# ---------------------------------------------------------------------------
# Plan paths: a polyline with filleted corners, and its parallel offset
# ---------------------------------------------------------------------------

def _offset_poly(pts, dists):
    """Offsets an open 2D polyline to the right of travel by dists[i] (per segment)."""
    P = [Vector(p) for p in pts]
    lines = []
    for i in range(len(P) - 1):
        d = (P[i + 1] - P[i]).normalized()
        lines.append((P[i] + _right(d) * dists[i], d))
    out = [lines[0][0]]
    for (a0, d0), (a1, d1) in zip(lines, lines[1:]):
        den = d0.x * d1.y - d0.y * d1.x
        t = ((a1.x - a0.x) * d1.y - (a1.y - a0.y) * d1.x) / den
        out.append(a0 + d0 * t)
    out.append(P[-1] + _right(lines[-1][1]) * dists[-1])
    return out


def _fillet_pieces(pts, radii):
    """Pieces of an open polyline with a fillet at each interior corner:
    ("L", a, b) or ("A", centre, r, a0, a1)."""
    P = [Vector(p) for p in pts]
    pieces = []
    cur = P[0]
    for i in range(1, len(P) - 1):
        d0 = (P[i] - P[i - 1]).normalized()
        d1 = (P[i + 1] - P[i]).normalized()
        cross = d0.x * d1.y - d0.y * d1.x
        phi = math.acos(max(-1.0, min(1.0, d0.dot(d1))))
        r = radii[i - 1]
        t = r * math.tan(phi / 2)
        T1, T2 = P[i] - d0 * t, P[i] + d1 * t
        side = _right(d0) if cross < 0 else -_right(d0)
        c = T1 + side * r
        a0 = math.atan2(T1.y - c.y, T1.x - c.x)
        a1 = a0 - phi if cross < 0 else a0 + phi
        pieces.append(("L", cur, T1))
        pieces.append(("A", c, r, a0, a1))
        cur = T2
    pieces.append(("L", cur, P[-1]))
    return pieces


def _piece_len(p):
    return (p[2] - p[1]).length if p[0] == "L" else p[2] * abs(p[4] - p[3])


def _piece_at(p, f):
    if p[0] == "L":
        return p[1].lerp(p[2], f)
    _, c, r, a0, a1 = p
    a = a0 + (a1 - a0) * f
    return Vector((c.x + r * math.cos(a), c.y + r * math.sin(a)))


# ---------------------------------------------------------------------------
# Upholstered body: a closed cross-section swept round a U (arms and back), with deep-buttoned
# diamond tufting on the inner face. The tufted rows are a regular (station x row) grid whose
# quads are split along the pleat lines, so every crease runs exactly along mesh edges.
# ---------------------------------------------------------------------------

class Tuft:
    def __init__(self, dx=0.17, dy=0.20, m=3, amp=0.028, p=0.5, dimple=0.010, rows=(1, 4, 7), visible_from=4,
                 sigma=0.017, top_fade=0.45):
        self.dx, self.dy, self.m, self.amp, self.p = dx, dy, m, amp, p
        self.dimple, self.rows, self.visible_from, self.sigma, self.top_fade = dimple, rows, visible_from, sigma, top_fade


def _tuft_f(ip, jp, T, top_jp):
    """Puff (0 on a pleat, 1 in a diamond's middle) at grid index (ip, jp), jp relative to the
    lowest button row. Above the top button row the diamonds turn into vertical pleats."""
    m = T.m
    if jp > top_jp:
        r = top_jp // m
        return abs(math.sin(math.pi * (ip - m * r) / (2 * m))) ** (2 * T.p)
    u = (ip + jp) / (2 * m)
    v = (ip - jp) / (2 * m)
    return (abs(math.sin(math.pi * u)) * abs(math.sin(math.pi * v))) ** T.p


def _compress(Z, nominal, x0=0.72):
    """Row heights (fractions 0..1 of a zone Z tall) for N rows of nominal pitch: metric while they
    fit, then the remaining rows are gathered smoothly under the roll (short arms of tall chairs)."""
    X = nominal / Z
    if X <= 1.0:
        return lambda x: x
    # phi(x) = x0 + (1 - x0) (1 - e^{-k (x - x0)}) / (1 - e^{-k (X - x0)}), C1 at x0, phi(X) = 1
    lo, hi = 1e-4, 200.0
    for _ in range(60):
        k = (lo + hi) / 2
        d = (1 - x0) * k / (1 - math.exp(-k * (X - x0)))
        if d > 1.0:
            hi = k
        else:
            lo = k
    k = (lo + hi) / 2
    den = 1 - math.exp(-k * (X - x0))

    def phi(x):
        if x <= x0:
            return x
        return x0 + (1 - x0) * (1 - math.exp(-k * (x - x0))) / den
    return lambda x: phi(x * X)


def _button_mesh(key, r=0.0105, h=0.0062, seg=8):
    return _turn("btn", [(r, -0.003), (r * 1.02, h * 0.3), (r * 0.62, h * 0.9), (0.0, h)], seg, key, caps=(False, False))


def _uph_body(name, key, outer_pts, ro, w_ref, ri, station_fn, n_t, ds_nominal, tuft=None, end_fade=0.05,
              tuft_weight=None, buttons=True, btn_key=None):
    """Sweeps a station-dependent closed cross-section round the U `outer_pts` (FL, BL, BR, FR) and
    returns (body, buttons, info).

    station_fn(k, f, s) -> (outer_chain, zone_top, zone_bot, closure, z_bot_nominal): the profile at
    piece k / fraction f as (n, z) pairs, n measured inward from the outer path (n = w_ref on the
    reference inner path). The tufted zone runs from zone_top down to zone_bot in n_t rows."""
    pieces_o = _fillet_pieces(outer_pts, [ro] * (len(outer_pts) - 2))
    inner_pts = _offset_poly(outer_pts, [w_ref] * (len(outer_pts) - 1))
    pieces_i = _fillet_pieces(inner_pts, [ri] * (len(inner_pts) - 2))
    lens = [_piece_len(p) for p in pieces_i]
    L = sum(lens)
    T = tuft or Tuft(amp=0.0)
    ds_t = T.dx / (2 * T.m)
    N = max(2, 2 * round(L / (2 * min(ds_t, ds_nominal))))
    ds = L / N
    dt_nom = T.dy / (2 * T.m)
    bm = bmesh.new()
    rings = []
    meta = []
    cum = [0.0]
    for l_ in lens:
        cum.append(cum[-1] + l_)
    top_jp = T.rows[-1] - T.rows[0]
    j0 = T.rows[0]
    for i in range(N + 1):
        s = i * ds
        k = min(len(lens) - 1, max(0, next((q for q in range(len(lens)) if s <= cum[q + 1] + 1e-9), len(lens) - 1)))
        f = (s - cum[k]) / lens[k] if lens[k] > 0 else 0.0
        O = _piece_at(pieces_o[k], f)
        I = _piece_at(pieces_i[k], f)
        dirv = (I - O) / w_ref
        inward = dirv.normalized()
        outer_chain, ztop, zbot, closure = station_fn(k, f, s)
        Z = ztop[1] - zbot[1]
        rowf = _compress(Z, n_t * dt_nom)
        ip = i - N // 2
        efade = _smoothstep(0.0, end_fade, s) * _smoothstep(0.0, end_fade, L - s)
        wgt = tuft_weight(k, f) if tuft_weight else 1.0
        ring = []
        for n, z in outer_chain:
            p = O + dirv * n
            ring.append(bm.verts.new((p.x, p.y, z)))
        zone_pts = []
        for jj in range(n_t, -1, -1):
            fr = rowf(jj / n_t)
            n = zbot[0] + (ztop[0] - zbot[0]) * fr
            z = zbot[1] + Z * fr
            jp = jj - j0
            h = 0.0
            if T.amp > 0 and wgt > 0:
                fpuff = _tuft_f(ip, jp, T, top_jp)
                if jp > top_jp:
                    fpuff *= 1.0 - (1.0 - T.top_fade) * _smoothstep(top_jp, n_t - j0, jp)
                if jp < 0:
                    fpuff *= _smoothstep(-j0, 0, jp)
                u = (ip + jp) / (2 * T.m)
                v = (ip - jp) / (2 * T.m)
                ur, vr = round(u), round(v)
                jb = T.m * (ur - vr)
                ib = T.m * (ur + vr)
                dim = 0.0
                if 0 <= jb <= top_jp:
                    dsm = (ip - ib) * ds
                    dtm = (jp - jb) * dt_nom
                    dim = math.exp(-(dsm * dsm + dtm * dtm) / (T.sigma ** 2))
                h = (T.amp * fpuff - T.dimple * dim) * efade * wgt
            p = O + dirv * n + inward * h
            v_ = bm.verts.new((p.x, p.y, z))
            ring.append(v_)
            zone_pts.append((jj, p, z, inward, fr))
        for n, z in closure:
            p = O + dirv * n
            ring.append(bm.verts.new((p.x, p.y, z)))
        rings.append(ring)
        meta.append(dict(s=s, k=k, f=f, O=O, I=I, inward=inward, zone=zone_pts, lo=len(outer_chain), wgt=wgt, Z=Z,
                         rowf=rowf, efade=efade))
    lo = meta[0]["lo"]
    M = len(rings[0])
    m2 = 2 * T.m
    for i in range(N):
        A, B = rings[i], rings[i + 1]
        ip = i - N // 2
        for a in range(M):
            b = (a + 1) % M
            za = lo <= a <= lo + n_t
            zb_ = lo <= b <= lo + n_t
            if za and zb_ and T.amp > 0:
                ja = n_t - (a - lo)
                jb = ja - 1
                jpb = jb - j0
                if jpb < top_jp:
                    dv = ((ip - jpb) % m2) / m2
                    du = ((ip + jpb + 1) % m2) / m2
                    dv = min(dv, 1 - dv)
                    du = min(du, 1 - du)
                    # corners: (i, ja)=A[a] (i+1, ja)=B[a] (i+1, jb)=B[b] (i, jb)=A[b]
                    if dv <= du:   # crease on (i, jb)-(i+1, ja)
                        bm.faces.new((A[a], B[a], A[b]))
                        bm.faces.new((B[a], B[b], A[b]))
                    else:          # crease on (i+1, jb)-(i, ja)
                        bm.faces.new((A[a], B[a], B[b]))
                        bm.faces.new((A[a], B[b], A[b]))
                    continue
            bm.faces.new((A[a], B[a], B[b], A[b]))
    for ring in (rings[0], rings[-1]):
        pts = [v.co.copy() for v in ring]
        for a, b, c in tessellate_polygon([pts]):
            try:
                bm.faces.new((ring[a], ring[b], ring[c]))
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    body = C.mesh_from_bmesh(name, bm, _mat(key))
    C.shade_smooth(body, 42)
    C.uv_box(body, tex_size(key))
    # buttons in the dimples
    btns = []
    if buttons and T.amp > 0:
        src = _button_mesh(btn_key or key)
        margin = max(2, round(0.045 / ds))
        for i in range(margin, N + 1 - margin):
            md = meta[i]
            if md["wgt"] < 0.5 or md["efade"] < 0.6:
                continue
            ip = i - N // 2
            for jj, p, z, inward, fr in md["zone"]:
                jp = jj - j0
                if jp < 0 or jp > top_jp or jp % T.m or jj < T.visible_from:
                    continue
                if (ip + jp) % m2 != 0 or (ip - jp) % m2 != 0:
                    continue
                # skip buttons in rows gathered under the roll (short arms)
                fr_lo = md["rowf"](max(0, jj - 1) / n_t)
                if (fr - fr_lo) * md["Z"] < 0.6 * dt_nom:
                    continue
                b = _copy(src)
                q = Vector((0, 0, 1)).rotation_difference(Vector((inward.x, inward.y, 0.0)))
                _xf(b, Matrix.Translation((p.x, p.y, z)) @ q.to_matrix().to_4x4())
                btns.append(b)
        C.remove(src)
    info = dict(meta=meta, N=N, ds=ds, L=L, pieces_o=pieces_o, pieces_i=pieces_i, lo=lo, n_t=n_t)
    return body, btns, info


def _roll_chain(n0, z_top, rc_n, rr, a_end=-12.0, a_step=22.0, belly=0.0, z_base=0.10, welt=True, outer_pts=3):
    """The outer face (with a welt at the base) rising into a roll of radius rr whose centre is at
    (rc_n, z_top - rr + 0.01); ends on the roll's inner side at angle a_end (degrees)."""
    rc_z = z_top - rr
    th0 = math.degrees(math.acos(max(-1.0, min(1.0, (n0 - rc_n) / rr))))   # where the circle meets the outer face
    zt = rc_z - rr * math.sin(math.radians(th0))
    chain = []
    if welt:
        chain += [(n0 + 0.010, z_base), (n0 - 0.001, z_base + 0.003), (n0 - 0.005, z_base + 0.010),
                  (n0 - 0.002, z_base + 0.017), (n0, z_base + 0.022)]
    else:
        chain += [(n0 + 0.004, z_base), (n0, z_base + 0.004)]
    za = chain[-1][1]
    for q in range(1, outer_pts + 1):
        t = q / (outer_pts + 1)
        z = za + (zt - za) * t
        chain.append((n0 - belly * math.sin(math.pi * t), z))
    a = 360.0 - th0
    while a > a_end + 1e-6:
        chain.append((rc_n + rr * math.cos(math.radians(a)), rc_z + rr * math.sin(math.radians(a))))
        a -= a_step
    chain.append((rc_n + rr * math.cos(math.radians(a_end)), rc_z + rr * math.sin(math.radians(a_end))))
    return chain


def _front_panel(name, key, profile, y0, centre, roll_r, depth=0.012, pleats=14, pleat_d=0.0045, nray=56):
    """Fan-pleated scroll front of an arm: the arm's end profile (x, z), inset, standing `depth`
    proud of y0 (towards -Y), with pleats gathered round a button at `centre` on the roll."""
    pts = [Vector(p) for p in profile]
    # resample the outline evenly
    per = sum((pts[(i + 1) % len(pts)] - pts[i]).length for i in range(len(pts)))
    out = []
    step = per / nray
    acc = 0.0
    i = 0
    seglen = [(pts[(k + 1) % len(pts)] - pts[k]).length for k in range(len(pts))]
    for q in range(nray):
        target = q * step
        while acc + seglen[i] < target:
            acc += seglen[i]
            i = (i + 1) % len(pts)
        t = (target - acc) / seglen[i] if seglen[i] > 0 else 0
        out.append(pts[i].lerp(pts[(i + 1) % len(pts)], t))
    c = Vector(centre)
    bm = bmesh.new()
    fr = [0.16, 0.42, 0.68, 0.88, 1.0]
    rings = []
    for f in fr:
        ring = []
        for p in out:
            d = p - c
            ang = math.atan2(d.y, d.x)
            dist = d.length
            q = c + d * f
            in_roll = _smoothstep(roll_r * 1.6, roll_r * 1.05, dist)
            pl = pleat_d * (0.5 - 0.5 * math.cos(pleats * ang)) * math.sin(math.pi * min(1.0, f * 1.05)) ** 0.8 * in_roll
            dome = depth * (1.0 - 0.55 * f ** 3) if f < 1.0 else 0.0
            y = y0 - dome - pl
            ring.append(bm.verts.new((q.x, y, q.y)))
        rings.append(ring)
    ctr = bm.verts.new((c.x, y0 - depth * 1.02, c.y))
    n = len(out)
    for k in range(n):
        j = (k + 1) % n
        bm.faces.new((ctr, rings[0][j], rings[0][k]))
    for A, B in zip(rings, rings[1:]):
        for k in range(n):
            j = (k + 1) % n
            bm.faces.new((A[k], A[j], B[j], B[k]))
    for f_ in bm.faces:
        f_.normal_update()
        if f_.normal.y > 0:
            f_.normal_flip()
    ob = C.mesh_from_bmesh(name, bm, _mat(key))
    C.shade_smooth(ob, 50)
    C.uv_box(ob, tex_size(key))
    return ob


def _box_cushion(name, w, d, h, key, r=0.05, crown=0.014, welt=0.0045, bulge=0.006, seg=3, sag=0.0, front_roll=0.0):
    """Loose boxed cushion (bottom at z = 0) with piped top and bottom edges, a softly bulging border
    and a crowned top made of radially scaled outline rings (no hip-roof creases)."""
    corners = _rect(w / 2, d / 2)
    pr = [(0.012, 0.0), (0.002, 0.005), (-welt, 0.011), (0.0015, 0.019),
          (-bulge, h * 0.5), (0.0015, h - 0.019), (-welt, h - 0.011), (0.002, h - 0.005), (0.012, h)]
    rings = [[Vector((p.x, p.y, z)) for p in _rpoly(corners, r, dd, seg)] for dd, z in pr]
    top = rings[-1]
    cx = sum(p.x for p in top) / len(top)
    cy = sum(p.y for p in top) / len(top)
    tops = []
    for s, c in ((0.93, 0.42), (0.80, 0.78), (0.6, 0.94), (0.36, 1.0), (0.14, 1.0)):
        ring = []
        for p in top:
            x = cx + (p.x - cx) * s
            y = cy + (p.y - cy) * s
            dz = crown * c - sag * math.exp(-((x / (w * 0.3)) ** 2 + ((y + d * 0.08) / (d * 0.35)) ** 2))
            ring.append(Vector((x, y, h + dz)))
        tops.append(ring)
    bots = []
    for s in (0.9, 0.6, 0.25):
        bots.append([Vector((cx + (p.x - cx) * s, cy + (p.y - cy) * s, 0.0)) for p in rings[0]])
    allr = list(reversed(bots)) + rings + tops
    bm = bmesh.new()
    Rr = [[bm.verts.new(p) for p in ring] for ring in allr]
    for A, B in zip(Rr, Rr[1:]):
        FH._bridge(bm, A, B, True)
    bm.faces.new(list(reversed(Rr[0])))
    bm.faces.new(Rr[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, _mat(key))
    C.shade_smooth(ob, 55)
    C.uv_box(ob, tex_size(key))
    return ob


def _pillow(name, w, hgt, t, key, nu=10, pinch=0.10, pipe=0.0048, pipe_key=None):
    """Square scatter cushion lying in the XY plane (centre at origin): pillowed faces meeting in a
    piped seam, corners pulled out into ears."""
    bm = bmesh.new()
    us = [math.sin(math.pi / 2 * (-1 + 2 * i / nu)) for i in range(nu + 1)]

    def P(u, v, sgn):
        x = w / 2 * u * (1 - pinch * (1 - v * v))
        y = hgt / 2 * v * (1 - pinch * (1 - u * u))
        th = t / 2 * (max(0.0, (1 - u * u) * (1 - v * v))) ** 0.42
        return Vector((x, y, sgn * th))

    top = [[None] * (nu + 1) for _ in range(nu + 1)]
    bot = [[None] * (nu + 1) for _ in range(nu + 1)]
    for a, u in enumerate(us):
        for b, v in enumerate(us):
            edge = a in (0, nu) or b in (0, nu)
            top[a][b] = bm.verts.new(P(u, v, 1))
            bot[a][b] = top[a][b] if edge else bm.verts.new(P(u, v, -1))
    for a in range(nu):
        for b in range(nu):
            bm.faces.new((top[a][b], top[a + 1][b], top[a + 1][b + 1], top[a][b + 1]))
            bm.faces.new((bot[a][b + 1], bot[a + 1][b + 1], bot[a + 1][b], bot[a][b]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, _mat(key))
    C.shade_smooth(ob, 70)
    C.uv_box(ob, tex_size(key))
    parts = [ob]
    if pipe > 0:
        loop = [P(us[a], -1, 0) for a in range(nu)] + [P(1, us[b], 0) for b in range(nu)] + \
               [P(us[a], 1, 0) for a in range(nu, 0, -1)] + [P(-1, us[b], 0) for b in range(nu, 0, -1)]
        pts = []
        for k in range(len(loop)):
            pts.append(loop[k])
        pts.append(loop[0])
        pp = _tube(name + "_pipe", pts, pipe, pipe_key or key, 5, caps=(False, False))
        C.uv_box(pp, tex_size(pipe_key or key))
        parts.append(pp)
    return _join(parts, name)


def _bun_foot(name, h=0.10, r=0.052, key=WOOD):
    prof = [(0.0, 0.0), (0.028, 0.0), (0.040 * r / 0.052, h * 0.10), (r, h * 0.34), (r * 0.94, h * 0.56),
            (r * 0.74, h * 0.72), (0.027, h * 0.80), (0.034, h * 0.86), (0.036, h * 0.93), (0.036, h)]
    ob = _turn(name, prof, 16, key)
    return ob


def _nail_row(path, spacing, key="brass", r=0.0058, normal_fn=None, seg=6):
    """Domed upholstery nails along a 3D polyline; each faces normal_fn(point)."""
    src = _turn("nail", [(r, -0.0015), (r * 0.92, 0.0012), (r * 0.62, 0.0030), (0.0, 0.0038)], seg, key, caps=(False, False))
    P = [Vector(p) for p in path]
    segl = [(b - a).length for a, b in zip(P, P[1:])]
    total = sum(segl)
    n = max(1, int(total / spacing))
    out = []
    for q in range(n + 1):
        target = q * total / n
        acc = 0.0
        for j, l_ in enumerate(segl):
            if acc + l_ >= target - 1e-9:
                t = (target - acc) / l_ if l_ > 0 else 0.0
                p = P[j].lerp(P[j + 1], t)
                nrm = normal_fn(p)
                b = _copy(src)
                qrot = Vector((0, 0, 1)).rotation_difference(nrm)
                _xf(b, Matrix.Translation(p) @ qrot.to_matrix().to_4x4())
                out.append(b)
                break
            acc += l_
    C.remove(src)
    return out


# ---------------------------------------------------------------------------
# Chesterfield sofa
# ---------------------------------------------------------------------------

SOFA_W, SOFA_D, SOFA_H = 2.2, 0.95, 0.80
SOFA_ROLL_R = 0.092
SOFA_OVER = 0.024          # roll overhang beyond the outer face
SOFA_ARM_W = 0.20          # arm inner face (at deck level) from the outer face
SOFA_BACK_W = 0.29         # back inner face at deck level (raked back 20 degrees)
DECK_Z = 0.33
Z_BASE = 0.10


def _chesterfield_station(H_fn, arm_w, back_w, roll_r, z_base=Z_BASE, deck_z=DECK_Z, n_top=None, belly=0.004,
                          welt=True, over=SOFA_OVER, flare=0.0, flare_z0=0.6):
    rc_n = roll_r - over

    def fn(k, f, s):
        H = H_fn(k, f, s)
        b = {0: 0.0, 1: _smoothstep(0, 1, f), 2: 1.0, 3: 1.0 - _smoothstep(0, 1, f), 4: 0.0}[k]
        n_bot = arm_w + (back_w - arm_w) * b
        chain = _roll_chain(0.0, H + 0.01, rc_n, roll_r, a_end=-14.0, a_step=22.0, belly=belly, z_base=z_base, welt=welt)
        if flare > 0:      # wings lean outward above the arms (sides only, fading round the back corners)
            fw = 1.0 - b
            chain = [(n - flare * fw * max(0.0, z - flare_z0) ** 1.3, z) for n, z in chain]
        last = chain[-1]
        ztop = (last[0] + 0.001, last[1] - 0.012)
        zbot = (n_bot, deck_z)
        closure = [(n_bot + 0.004, deck_z - 0.02), (n_bot + 0.004, z_base)]
        return chain, ztop, zbot, closure
    return fn


def build_sofa_chesterfield(item=None):
    """Deep-buttoned leather chesterfield, 2.2 x 0.95 x 0.80 m, three seats at x -0.66/0/0.66, seat 0.44."""
    key = LEATHER_SOFA
    hw, hd = SOFA_W / 2 - SOFA_OVER, SOFA_D / 2 - SOFA_OVER
    y_front = -SOFA_D / 2 + 0.018
    outer = [(-hw, y_front), (-hw, hd), (hw, hd), (hw, y_front)]
    H = SOFA_H - 0.01
    station = _chesterfield_station(lambda k, f, s: H, SOFA_ARM_W, SOFA_BACK_W, SOFA_ROLL_R)
    tuft = Tuft(dx=0.185, dy=0.20, m=3, amp=0.026, p=0.5, dimple=0.010, rows=(1, 4, 7), visible_from=4)
    body, btns, info = _uph_body("sofa_body", key, outer, 0.13, SOFA_ARM_W, 0.06, station, 10, 0.03, tuft,
                                 end_fade=0.05)
    parts = [body] + btns
    # fan-pleated scroll fronts on both arms
    rc_n = SOFA_ROLL_R - SOFA_OVER
    for side, md in ((-1, info["meta"][0]), (1, info["meta"][-1])):
        chain, ztop, zbot, closure = station(0 if side < 0 else 4, 0.0 if side < 0 else 1.0, 0)
        prof = chain + [ztop, zbot] + closure[:1]
        # (n, z) -> (x, z) on the arm front, inset 10 mm
        O = md["O"]
        inward = md["inward"]
        poly = [(O.x + inward.x * n, z) for n, z in prof]
        cx = sum(p[0] for p in poly) / len(poly)
        cz = sum(p[1] for p in poly) / len(poly)
        inset = []
        for x, z in poly:
            d = Vector((x - cx, z - cz))
            inset.append((x - d.normalized().x * 0.010 if d.length > 0.02 else x, z - d.normalized().y * 0.010))
        cen = (O.x + inward.x * rc_n, H + 0.01 - SOFA_ROLL_R)
        parts.append(_front_panel("sofa_scroll", key, inset, y_front, cen, SOFA_ROLL_R, depth=0.012))
        b = _button_mesh(key, 0.012, 0.007)
        _xf(b, _T(cen[0], y_front - 0.012, cen[1]) @ _Rx(90))
        parts.append(b)
    # seat deck with an upholstered front rail
    xi = hw - SOFA_ARM_W + 0.006
    y_back = hd - SOFA_BACK_W + 0.01
    rail = [(0.0, Z_BASE), (0.0, Z_BASE + 0.004), (-0.004, Z_BASE + 0.011), (-0.001, Z_BASE + 0.018), (0.0, Z_BASE + 0.024),
            (-0.006, 0.22), (0.0, DECK_Z - 0.03), (0.010, DECK_Z - 0.008), (0.03, DECK_Z)]
    deck = _rail_box("sofa_deck", -xi, xi, y_front + 0.004, y_back, rail, key)
    parts.append(deck)
    # loose seat cushions
    cw = 2 * xi / 3
    cd = (y_back + 0.02) - (y_front - 0.006)
    for q in (-1, 0, 1):
        c = _box_cushion("sofa_cushion", cw + 0.004, cd, SOFA_SEAT_TOP - DECK_Z - 0.010, key, r=0.045, crown=0.012,
                         sag=0.004)
        _xf(c, _T(q * cw, (y_back + 0.02 + y_front - 0.006) / 2, DECK_Z))
        parts.append(c)
    # a velvet throw cushion in the left corner
    pil = _pillow("sofa_throw", 0.44, 0.44, 0.19, VELVET)
    _xf(pil, _T(-xi + 0.25, y_back - 0.15, SOFA_SEAT_TOP + 0.185) @ _Rz(32) @ _Rx(66))
    parts.append(pil)
    # turned bun feet
    for sx in (-1, 1):
        for sy in (-1, 1):
            ft = _bun_foot("sofa_foot", Z_BASE, 0.05)
            _xf(ft, _T(sx * (hw - 0.09), sy * (hd - 0.09) if sy > 0 else y_front + 0.09, 0.0))
            parts.append(ft)
    ob = _join(parts, "Furniture_Sofa_Chesterfield_01")
    return ob


SOFA_SEAT_TOP = 0.445


def _rail_box(name, x0, x1, y0, y1, front_prof, key):
    """Seat deck: a box whose front face follows `front_prof` [(inset, z)] (the upholstered front rail)."""
    bm = bmesh.new()
    L = [bm.verts.new((x0, y0 + d, z)) for d, z in front_prof]
    Rv = [bm.verts.new((x1, y0 + d, z)) for d, z in front_prof]
    back_top_l = bm.verts.new((x0, y1, front_prof[-1][1]))
    back_top_r = bm.verts.new((x1, y1, front_prof[-1][1]))
    back_bot_l = bm.verts.new((x0, y1, front_prof[0][1]))
    back_bot_r = bm.verts.new((x1, y1, front_prof[0][1]))
    for a in range(len(front_prof) - 1):
        bm.faces.new((L[a], Rv[a], Rv[a + 1], L[a + 1]))
    bm.faces.new((L[-1], Rv[-1], back_top_r, back_top_l))
    bm.faces.new((back_top_l, back_top_r, back_bot_r, back_bot_l))
    bm.faces.new((back_bot_l, back_bot_r, Rv[0], L[0]))
    bm.faces.new(L + [back_top_l, back_bot_l])
    bm.faces.new([back_bot_r, back_top_r] + list(reversed(Rv)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, _mat(key))
    C.shade_smooth(ob, 40)
    C.uv_box(ob, tex_size(key))
    return ob



# ---------------------------------------------------------------------------
# Armchairs: a high-back leather chesterfield club chair and a velvet wingback
# ---------------------------------------------------------------------------

CH_W, CH_D, CH_H = 0.95, 0.92, 0.92
CH_SEAT = 0.43


def _side_dist(k, f, info_lens):
    """Distance from the back corner along an arm (pieces 0 and 4), 0 elsewhere."""
    if k == 0:
        return (1 - f) * info_lens[0]
    if k == 4:
        return f * info_lens[4]
    return 0.0


def _lens_of(outer_pts, ro):
    return [_piece_len(p) for p in _fillet_pieces(outer_pts, [ro] * (len(outer_pts) - 2))]


def _arm_fronts(parts, info, station, key, y_front, roll_r, over, H_front, depth=0.012):
    """Fan-pleated scroll fronts and their buttons on both arm ends."""
    rc_n = roll_r - over
    for side, md, k, f in ((-1, info["meta"][0], 0, 0.0), (1, info["meta"][-1], 4, 1.0)):
        chain, ztop, zbot, closure = station(k, f, 0)
        prof = chain + [ztop, zbot] + closure[:1]
        O, inward = md["O"], md["inward"]
        poly = [(O.x + inward.x * n, z) for n, z in prof]
        cx = sum(p[0] for p in poly) / len(poly)
        cz = sum(p[1] for p in poly) / len(poly)
        inset = []
        for x, z in poly:
            d = Vector((x - cx, z - cz))
            dn = d.normalized() if d.length > 1e-6 else Vector((0, 0))
            inset.append((x - dn.x * 0.009, z - dn.y * 0.009))
        cen = (O.x + inward.x * rc_n, H_front + 0.01 - roll_r)
        parts.append(_front_panel("arm_scroll", key, inset, y_front, cen, roll_r, depth=depth))
        b = _button_mesh(key, 0.011, 0.0065)
        _xf(b, _T(cen[0], y_front - depth, cen[1]) @ _Rx(90))
        parts.append(b)


def build_armchair_leather():
    """High-back chesterfield club chair in oxblood leather: back 0.92 m sweeping down to rolled arms
    at 0.70 m, buttoned all round, loose seat cushion, bun feet. Seat 0.43 m."""
    key = LEATHER_CLUB
    over, rr = 0.022, 0.078
    hw, hd = CH_W / 2 - over, CH_D / 2 - over
    y_front = -CH_D / 2 + 0.016
    outer = [(-hw, y_front), (-hw, hd), (hw, hd), (hw, y_front)]
    ro = 0.11
    lens = _lens_of(outer, ro)
    Hb, Ha = CH_H - 0.012, 0.70

    def H_fn(k, f, s):
        d = _side_dist(k, f, lens)
        if k in (1, 2, 3):
            return Hb
        t = _smoothstep(0.03, 0.40, d)
        return Hb + (Ha - Hb) * t
    arm_w, back_w = 0.185, 0.27
    station = _chesterfield_station(H_fn, arm_w, back_w, rr, over=over)
    tuft = Tuft(dx=0.155, dy=0.19, m=3, amp=0.024, p=0.5, dimple=0.0095, rows=(1, 4, 7, 10, 13), visible_from=4,
                sigma=0.016)
    body, btns, info = _uph_body("club_body", key, outer, ro, arm_w, 0.05, station, 15, 0.03, tuft, end_fade=0.045)
    parts = [body] + btns
    _arm_fronts(parts, info, station, key, y_front, rr, over, Ha)
    xi = hw - arm_w + 0.006
    y_back = hd - back_w + 0.01
    rail = [(0.0, Z_BASE), (0.0, Z_BASE + 0.004), (-0.004, Z_BASE + 0.011), (-0.001, Z_BASE + 0.018), (0.0, Z_BASE + 0.024),
            (-0.006, 0.22), (0.0, DECK_Z - 0.03), (0.010, DECK_Z - 0.008), (0.03, DECK_Z)]
    parts.append(_rail_box("club_deck", -xi, xi, y_front + 0.004, y_back, rail, key))
    cd = (y_back + 0.02) - (y_front - 0.006)
    cu = _box_cushion("club_cushion", 2 * xi + 0.004, cd, CH_SEAT + 0.006 - DECK_Z - 0.012, key, r=0.05, crown=0.014, sag=0.005)
    _xf(cu, _T(0, (y_back + 0.02 + y_front - 0.006) / 2, DECK_Z))
    parts.append(cu)
    for sx in (-1, 1):
        for sy in (-1, 1):
            ft = _bun_foot("club_foot", Z_BASE, 0.048)
            _xf(ft, _T(sx * (hw - 0.085), (hd - 0.085) if sy > 0 else y_front + 0.085, 0.0))
            parts.append(ft)
    return _join(parts, "Furniture_Armchair_Club_Leather_01")


def _turned_leg_front(name, h, key=WOOD):
    """Short turned front leg (top block to a brass cup foot), standing on z = 0."""
    prof = [(0.0, 0.0), (0.017, 0.0), (0.019, 0.004), (0.019, 0.022), (0.016, 0.026),   # brass cup (separate mat below)
            ]
    cup = _turn(name + "_cup", [(0.0, 0.0), (0.0175, 0.0), (0.0195, 0.003), (0.0195, 0.024), (0.0168, 0.028), (0.0, 0.028)],
                14, "brass_aged")
    wood = _turn(name + "_turn", [
        (0.0150, 0.026), (0.0150, 0.034), (0.0215, 0.046), (0.0245, 0.066), (0.0215, 0.086), (0.0165, 0.098),
        (0.0160, 0.106), (0.0215, 0.114), (0.0225, 0.122), (0.0185, 0.130), (0.0200, 0.140), (0.0255, 0.150),
        (0.0255, h - 0.003), (0.0, h - 0.003)], 14, key, fillet=0.002)
    return _join([cup, wood], name)


def build_armchair_wingback():
    """Velvet wingback: a buttoned, raked back, wings sweeping down into scrolled arms, a loose piped
    cushion, turned walnut front legs on brass cups and raked back legs. Seat 0.43 m, back 1.0 m."""
    key = VELVET
    over, rr = 0.026, 0.052
    zb = 0.205                          # underside of the upholstered frame (legs below)
    hwf, hwb = CH_W / 2 - over, CH_W / 2 - over - 0.05
    hd = CH_D / 2 - over
    y_front = -CH_D / 2 + 0.02
    outer = [(-hwf, y_front), (-hwb, hd), (hwb, hd), (hwf, y_front)]
    ro = 0.08
    lens = _lens_of(outer, ro)
    Hb, Ha = 1.0, 0.645

    def H_fn(k, f, s):
        if k in (1, 2, 3):
            return Hb
        d = _side_dist(k, f, lens)
        if d <= 0.10:
            return Hb
        if d >= 0.58:
            return Ha
        t = (d - 0.10) / 0.48
        return Ha + (Hb - Ha) * math.sqrt(max(0.0, 1 - t * t))
    arm_w, back_w = 0.135, 0.235

    def wgt(k, f):
        return {0: 0.0, 1: _smoothstep(0.55, 1.0, f), 2: 1.0, 3: 1.0 - _smoothstep(0.0, 0.45, f), 4: 0.0}[k]
    station = _chesterfield_station(H_fn, arm_w, back_w, rr, z_base=zb, belly=0.003, welt=True, over=over, flare=0.32,
                                    flare_z0=0.50)
    tuft = Tuft(dx=0.16, dy=0.22, m=3, amp=0.018, p=0.55, dimple=0.008, rows=(1, 4, 7, 10, 13), visible_from=4, sigma=0.016,
                top_fade=0.25)
    body, btns, info = _uph_body("wing_body", key, outer, ro, arm_w, 0.04, station, 16, 0.03, tuft, end_fade=0.04,
                                 tuft_weight=wgt)
    parts = [body] + btns
    _arm_fronts(parts, info, station, key, y_front, rr, over, Ha, depth=0.010)
    # seat deck and front rail (velvet, piped)
    xi = hwf - arm_w + 0.006
    xib = hwb - arm_w + 0.006
    y_back = hd - back_w + 0.01
    rail = [(0.0, zb), (0.0, zb + 0.004), (-0.004, zb + 0.011), (-0.001, zb + 0.018), (0.0, zb + 0.024),
            (-0.005, 0.27), (0.0, DECK_Z - 0.03), (0.010, DECK_Z - 0.008), (0.03, DECK_Z)]
    parts.append(_rail_box("wing_deck", -xi, xi, y_front + 0.004, y_back, rail, key))
    cd = (y_back + 0.02) - (y_front - 0.006)
    cu = _box_cushion("wing_cushion", 2 * (xi + xib) / 2 + 0.004, cd, CH_SEAT + 0.008 - DECK_Z - 0.012, key, r=0.06, crown=0.022,
                      sag=0.006)
    _xf(cu, _T(0, (y_back + 0.02 + y_front - 0.006) / 2, DECK_Z))
    parts.append(cu)
    # legs: turned fronts on brass cups, square raked backs
    for sx in (-1, 1):
        lg = _turned_leg_front("wing_leg", zb + 0.004)
        _xf(lg, _T(sx * (hwf - 0.07), y_front + 0.075, 0.0))
        parts.append(lg)
        top = Vector((sx * (hwb - 0.06), hd - 0.07, zb + 0.004))
        bot = Vector((sx * (hwb - 0.045), hd - 0.02, 0.0))
        M, L = FH._align(bot, top)
        leg = _slab("wing_backleg", _rect(0.017, 0.017), 0.004,
                    [(0.0035, 0.0), (0.0, 0.004), (0.0, L * 0.5), (-0.003, L)], 2, WOOD)
        _uvb(leg, WOOD, "z")
        _xf(leg, M)
        parts.append(leg)
    return _join(parts, "Furniture_Armchair_Wingback_Velvet_01")


def build_armchair_club(item=None):
    seed = getattr(item, "seed", 0) if item is not None else 0
    return build_armchair_wingback() if seed % 2 else build_armchair_leather()


# ---------------------------------------------------------------------------
# Shared helpers for the case pieces: closed-profile sweeps, returned mouldings, rosettes, text
# ---------------------------------------------------------------------------

def _arcpts(cx, cy, r, a0, a1, n):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def _sweep_c(name, profile, path, key, closed_path=False, up=(0, 0, 1), caps=True, smooth=35.0, grain=None, uv=True):
    """Sweeps a CLOSED profile [(u, v)] along a polyline with mitred corners (C.sweep's frame: for a path
    in the plane normal to `up`, u > 0 is the right of travel and v runs along `up`)."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    upv = Vector(up)
    bm = bmesh.new()
    rings = []
    for i in range(n):
        if closed_path:
            d0 = (pts[i] - pts[i - 1]).normalized()
            d1 = (pts[(i + 1) % n] - pts[i]).normalized()
        else:
            d0 = (pts[i] - pts[i - 1]).normalized() if i > 0 else (pts[1] - pts[0]).normalized()
            d1 = (pts[i + 1] - pts[i]).normalized() if i < n - 1 else d0
        t = d0 + d1
        t = t.normalized() if t.length > 1e-6 else d1
        s0 = upv.cross(d0).normalized()
        s = upv.cross(t).normalized()
        mit = 1.0 / max(0.2, s.dot(s0)) if (closed_path or 0 < i < n - 1) else 1.0
        v = t.cross(s).normalized()
        rings.append([bm.verts.new(pts[i] - s * mit * u + v * vv) for u, vv in profile])
    m = len(profile)
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed_path else [])
    for A, B in pairs:
        for j in range(m):
            k = (j + 1) % m
            try:
                bm.faces.new((A[j], B[j], B[k], A[k]))
            except ValueError:
                pass
    if caps and not closed_path:
        for ring in (rings[0], rings[-1]):
            try:
                bm.faces.new(ring)
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, _mat(key))
    C.shade_smooth(ob, smooth)
    if uv:
        C.uv_box(ob, tex_size(key), grain)
    return ob


def _ret(name, profile, x0, x1, yf, yb, z, key, smooth=35.0):
    """Returned moulding: along the front (y = yf) from x0 to x1, returning back to the ground at y = yb at
    both ends. profile [(u, v)]: u = projection beyond the line (outward), v = height above z."""
    return _sweep_c(name, profile, [(x0, yb, z), (x0, yf, z), (x1, yf, z), (x1, yb, z)], key, smooth=smooth)


def _run(name, profile, x0, x1, y, z, key, smooth=35.0):
    """Straight front moulding from x0 to x1 on the plane y (u = projection towards -Y, v = height)."""
    return _sweep_c(name, profile, [(x0, y, z), (x1, y, z)], key, smooth=smooth, grain="x")


def _rosette(name, R, H, petals, key, spp=4, oval=1.0):
    """Carved patera facing +Z: an outer bead ring, a ring of raised petals and a central boss (built at the
    origin; oval stretches it along Y)."""
    n = petals * spp
    prof = [(1.00, 0.00), (1.00, 0.20), (0.96, 0.34), (0.89, 0.40), (0.83, 0.34), (0.78, 0.44), (0.66, 0.60),
            (0.52, 0.70), (0.40, 0.66), (0.34, 0.60), (0.30, 0.70), (0.22, 0.92), (0.11, 1.0)]
    petal = {5, 6, 7, 8}
    bm = bmesh.new()
    rings = []
    for i, (rr, zz) in enumerate(prof):
        ring = []
        for k in range(n):
            a = math.tau * k / n
            r, z = R * rr, H * zz
            if i in petal:
                m = abs(math.cos(petals * a / 2)) ** 0.7
                r *= 0.93 + 0.07 * m
                z = H * (0.36 + (zz - 0.36) * (0.35 + 0.65 * m))
            ring.append(bm.verts.new((r * math.cos(a), oval * r * math.sin(a), z)))
        rings.append(ring)
    for A, B in zip(rings, rings[1:]):
        _bridge_ring(bm, A, B)
    top = bm.verts.new((0, 0, H * 1.02))
    for k in range(n):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % n], top))
    bm.faces.new(list(reversed(rings[0])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, _mat(key))
    C.shade_smooth(ob, 60)
    C.uv_box(ob, tex_size(key))
    return ob


def _bridge_ring(bm, A, B):
    m = len(A)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((A[i], A[j], B[j], B[i]))


_FONT_CACHE = {}
FONT_SERIF = "/System/Library/Fonts/Supplemental/Georgia.ttf"
FONT_SERIF_B = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
FONT_CASLON = "/System/Library/Fonts/Supplemental/BigCaslon.ttf"
FONT_DIDOT = "/System/Library/Fonts/Supplemental/Didot.ttc"
FONT_FUTURA = "/System/Library/Fonts/Supplemental/Futura.ttc"
FONT_BASK = "/System/Library/Fonts/Supplemental/Baskerville.ttc"


def _font(path):
    if path not in _FONT_CACHE:
        try:
            _FONT_CACHE[path] = bpy.data.fonts.load(path, check_existing=True) if path and os.path.exists(path) else None
        except Exception:  # noqa: BLE001
            _FONT_CACHE[path] = None
    return _FONT_CACHE[path]


def _flat_text(name, body, size, key, font=None, max_w=None, res=1, spacing=1.0):
    """Flat lettering in the XY plane facing +Z, centred on the origin; squeezed to max_w if wider."""
    cu = bpy.data.curves.new(name, type="FONT")
    cu.body = body
    cu.size = size
    cu.resolution_u = res
    cu.space_character = spacing
    cu.align_x = "CENTER"
    f = _font(font)
    if f is not None:
        cu.font = f
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    me.materials.clear()
    me.materials.append(_mat(key))
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    w = max(xs) - min(xs)
    s = min(1.0, max_w / w) if (max_w and w > 0) else 1.0
    _xf(ob, Matrix.Diagonal((s, 1.0, 1.0, 1.0)) @ _T(-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0))
    for p in me.polygons:
        p.use_smooth = False
    C.uv_box(ob, tex_size(key))
    return ob


def _spiral(cx, cz, R, turns, shrink, a0=90.0, n=22, cw=True):
    """Points (x, z) of a volute spiral starting at angle a0 on radius R and winding inward."""
    out = []
    for k in range(n + 1):
        t = k / n
        a = math.radians(a0 + (-1 if cw else 1) * 360.0 * turns * t)
        r = R * (1 - shrink * t)
        out.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    return out


def _tube_r(name, path, r0, r1, key, seg=8, caps=(True, True)):
    return _tube(name, path, lambda t: r0 + (r1 - r0) * t, key, seg, caps)


# ---------------------------------------------------------------------------
# Fireplace: carved limestone chimneypiece, cast-iron firebox, a log fire on andirons, brass fender,
# companion set, log rack, gilt overmantel mirror and a mantel garniture
# ---------------------------------------------------------------------------

FP_W, FP_D, FP_H = 2.6, 0.75, 2.4
FP_WALL = FP_D / 2          # back of the chimneypiece = the wall's inner face
FP_FACE = 0.02              # face of the jambs and the frieze
FP_OHW = 0.60               # half-width of the fire opening
FP_HEARTH = 0.04            # top of the hearth slab
FP_OTOP = 1.00              # soffit of the opening
FP_JHW = 1.16               # outer edge of the jambs and frieze
FP_FRIEZE = 1.32            # top of the frieze (bed moulding above)
FP_SHELF = (1.37, 1.43)     # mantel shelf underside / top
FP_SHELF_Y = -0.12          # front edge of the shelf
FP_PIL_X = 0.93             # pilaster centre lines
FP_PIL_HW = 0.15
FP_CON_HW = 0.085           # console half-width
FP_STONE = "limestone_plain"
FIRE_COLOR = "#ff9a4a"

# Mouldings (u = projection outward, v = height / outward from the face)
_ARCHITRAVE = [(-0.090, -0.003), (-0.090, 0.007), (-0.088, 0.011), (-0.084, 0.013), (-0.080, 0.013), (-0.078, 0.015),
               (-0.074, 0.019), (-0.068, 0.023), (-0.062, 0.025), (-0.056, 0.025), (-0.052, 0.026), (-0.048, 0.029),
               (-0.044, 0.030), (-0.020, 0.028), (-0.018, 0.031), (-0.013, 0.034), (-0.008, 0.034), (-0.004, 0.031),
               (-0.002, 0.027), (0.0, 0.020), (0.0, -0.003)]
_PIL_BASE = ([(-0.022, 0.0), (0.016, 0.0)] + _arcpts(0.010, 0.010, 0.010, -40, 90, 5) +
             [(0.007, 0.0205), (0.004, 0.024), (0.003, 0.028), (0.004, 0.032)] + _arcpts(0.007, 0.040, 0.005, -90, 90, 4) +
             [(0.004, 0.045), (0.004, 0.048), (0.002, 0.050), (0.0005, 0.054), (0.0, 0.060), (-0.022, 0.060)])
_PIL_CAP = ([(-0.022, 0.0), (0.0, 0.0)] + _arcpts(0.002, 0.008, 0.006, -90, 90, 4) +
            [(0.0, 0.016), (0.0, 0.040)] + [(0.022 - 0.022 * math.cos(math.radians(a)), 0.062 - 0.022 * math.sin(math.radians(a)))
                                             for a in (90, 70, 50, 30, 10, 0)][1:] +
            [(0.026, 0.062), (0.026, 0.066), (0.030, 0.068), (0.030, 0.087), (0.028, 0.090), (-0.022, 0.090)])
_BED = [(-0.020, 0.0), (0.0, 0.0), (0.003, 0.003), (0.006, 0.006), (0.006, 0.009), (0.010, 0.012), (0.018, 0.016),
        (0.026, 0.022), (0.032, 0.030), (0.038, 0.038), (0.046, 0.043), (0.052, 0.045), (0.052, 0.050), (-0.020, 0.050)]
_SHELF_EDGE = [(0.020, 0.000), (0.020, 0.004), (0.014, 0.008), (0.009, 0.010), (0.005, 0.014), (0.003, 0.019),
               (0.0, 0.026), (0.0, 0.044), (0.002, 0.051), (0.006, 0.056), (0.012, 0.060)]
_HEARTH_EDGE = [(0.006, 0.0), (0.0, 0.007), (0.0, 0.026), (0.003, 0.033), (0.008, 0.038), (0.014, 0.040)]


def _fp_console(name, sx):
    """Scrolled console over a pilaster: an S-curved bracket (big scroll under the shelf, small one at the
    foot) with spiral volutes on both cheeks."""
    z0, z1 = 0.95, FP_SHELF[0]
    h = z1 - z0
    front = [(0.052, 0.00), (0.066, 0.035), (0.070, 0.080), (0.061, 0.135), (0.046, 0.205), (0.040, 0.300),
             (0.045, 0.420), (0.060, 0.545), (0.080, 0.655), (0.097, 0.755), (0.107, 0.850), (0.110, 0.925)]
    sm = [Vector(p) for p in _catmull(front, 3)]
    outline = [(FP_FACE + 0.004, z0)] + [(FP_FACE - p.x, z0 + p.y * h) for p in sm] + \
              [(FP_FACE - 0.110, z0 + 0.965 * h), (FP_FACE - 0.106, z1), (FP_FACE + 0.004, z1)]
    cx = sx * FP_PIL_X
    body = _extrude(name, outline, cx - FP_CON_HW, cx + FP_CON_HW, FP_STONE, "yz", bevel_w=0.003, segs=2)
    _uvb(body, FP_STONE)
    parts = [body]
    # volutes on both cheeks (top scroll and foot scroll) and a husk drop down the front
    for side in (-1, 1):
        x = cx + side * (FP_CON_HW + 0.0035)
        for (pc, tc, R, turns, a0) in ((0.058, 0.835, 0.046, 1.45, 30.0), (0.040, 0.085, 0.029, 1.3, -60.0)):
            sp = _spiral(FP_FACE - pc, z0 + tc * h, R, turns, 0.78, a0=a0, n=17, cw=True)
            path = [(x, y, z) for y, z in sp]
            parts.append(_tube_r(name + "_vol", path, 0.0062, 0.0034, FP_STONE, 5, (True, True)))
            eye = C.sphere(name + "_eye", 0.0080, (x - side * 0.001, sp[-1][0], sp[-1][1]), _mat(FP_STONE), 8, 4)
            parts.append(eye)
    # a raised scroll band down the middle of the front, between the two scrolls
    band = [Vector((cx, FP_FACE - q.x, z0 + q.y * h)) for q in sm if 0.07 < q.y < 0.92]
    # (u = depth, + into the console; v = across the band)
    prof = [(0.004, -0.019), (-0.002, -0.019), (-0.0045, -0.016), (-0.0045, 0.016), (-0.002, 0.019), (0.004, 0.019)]
    parts.append(_sweep_c(name + "_band", prof, band, FP_STONE, up=(1, 0, 0), smooth=50))
    for o in parts[1:]:
        C.uv_box(o, tex_size(FP_STONE))
    return parts


def _fp_pilaster(name, sx):
    cx = sx * FP_PIL_X
    parts = []
    # plinth block
    parts.append(_bx(name + "_plinth", (cx - 0.17, FP_FACE - 0.05, FP_HEARTH), (cx + 0.17, FP_FACE + 0.003, 0.24), FP_STONE, 0.004))
    parts.append(_ret(name + "_base", _PIL_BASE, cx - FP_PIL_HW, cx + FP_PIL_HW, FP_FACE - 0.03, FP_FACE + 0.003, 0.24, FP_STONE))
    # fluted shaft
    hw, yb, yf = FP_PIL_HW, FP_FACE + 0.005, FP_FACE - 0.03
    pts = [(cx - hw, yb), (cx - hw, yf + 0.003), (cx - hw + 0.003, yf)]
    nfl, land = 5, 0.012
    inner = hw - 0.003
    wf = (2 * inner - (nfl + 1) * land) / nfl
    x = -inner + land
    for _ in range(nfl):
        for j in range(7):
            a = math.pi * j / 6
            pts.append((cx + x + wf / 2 - wf / 2 * math.cos(a), yf + 0.0135 * math.sin(a)))
        x += wf + land
    pts += [(cx + hw - 0.003, yf), (cx + hw, yf + 0.003), (cx + hw, yb)]
    shaft = C.prism(name + "_shaft", pts, 0.27, 0.875, _mat(FP_STONE))
    C.shade_smooth(shaft, 40)
    parts.append(_uvb(shaft, FP_STONE))
    parts.append(_ret(name + "_cap", _PIL_CAP, cx - FP_PIL_HW, cx + FP_PIL_HW, FP_FACE - 0.03, FP_FACE + 0.003, 0.86, FP_STONE))
    parts += _fp_console(name + "_console", sx)
    return parts


def _fp_frieze():
    """Central tablet with a patera and husk swags, a patera on each frieze field, the bed moulding."""
    parts = []
    tz, thw, thh = 1.205, 0.30, 0.09
    tab = _slab("fp_tablet", _rect(thw, thh), 0.004, [(0.0, -0.001), (0.0, 0.007), (0.003, 0.012), (0.008, 0.0165)], 2, FP_STONE)
    _xf(tab, _T(0, FP_FACE, tz) @ _Rx(90))
    parts.append(_uvb(tab, FP_STONE))
    yt = FP_FACE - 0.0165
    pat = _rosette("fp_patera", 0.050, 0.020, 12, FP_STONE, spp=3)
    _xf(pat, _T(0, yt + 0.001, tz + 0.004) @ _Rx(90))
    parts.append(pat)
    for sx in (-1, 1):
        # husk swag from the patera to the tablet's upper corner, with a drop at the end
        pts = []
        a, b = Vector((sx * 0.052, tz + 0.030)), Vector((sx * 0.262, tz + 0.052))
        for k in range(17):
            t = k / 16
            p = a.lerp(b, t)
            sag = 0.085 * math.sin(math.pi * t) ** 1.15
            pts.append((p.x, yt - 0.003, p.y - sag))

        def rad(t):
            return (0.0035 + 0.0055 * math.sin(math.pi * t) ** 0.6) * (0.72 + 0.28 * abs(math.sin(math.pi * 7 * t)))
        parts.append(_tube("fp_swag", pts, rad, FP_STONE, 5))
        drop = [(sx * 0.262, yt - 0.003, tz + 0.052 - 0.004 - 0.012 * k) for k in range(6)]
        parts.append(_tube("fp_drop", drop, lambda t: 0.0045 * (1 - 0.6 * t) * (0.75 + 0.25 * abs(math.sin(math.pi * 3 * t))),
                           FP_STONE, 6))
        ros = _rosette("fp_rose", 0.040, 0.016, 8, FP_STONE, spp=2)
        _xf(ros, _T(sx * 0.575, FP_FACE + 0.001, tz) @ _Rx(90))
        parts.append(ros)
        # bed moulding: the outer returns die into the consoles' outer cheeks
        xo = sx * FP_JHW
        xc = sx * (FP_PIL_X + FP_CON_HW - 0.002)
        if sx < 0:
            path = [(xo, FP_WALL, FP_FRIEZE), (xo, FP_FACE, FP_FRIEZE), (xc, FP_FACE, FP_FRIEZE)]
        else:
            path = [(xc, FP_FACE, FP_FRIEZE), (xo, FP_FACE, FP_FRIEZE), (xo, FP_WALL, FP_FRIEZE)]
        parts.append(_sweep_c("fp_bed", _BED, path, FP_STONE))
    xi = FP_PIL_X - FP_CON_HW + 0.002
    parts.append(_run("fp_bed", _BED, -xi, xi, FP_FACE, FP_FRIEZE, FP_STONE))
    for o in parts:
        C.uv_box(o, tex_size(FP_STONE))
    return parts


def _fp_firebox():
    """Sooted cast-iron lining (splayed cheeks, fireback leaning into the throat, soffit) and a cast
    fireback plate with an arched, beaded border and a central boss."""
    bm = bmesh.new()
    yF, yB = FP_FACE + 0.012, FP_WALL - 0.012
    xF, xB = FP_OHW - 0.005, 0.44
    zb, zm, zs = FP_HEARTH, 0.70, FP_OTOP - 0.005
    yT, zT = 0.235, zs - 0.04

    def xc(y):
        return xF + (xB - xF) * (y - yF) / (yB - yF)
    V = {}
    for s, tag in ((-1, "L"), (1, "R")):
        V[tag] = [bm.verts.new(p) for p in ((s * xF, yF, zb), (s * xB, yB, zb), (s * xB, yB, zm), (s * xc(yT), yT, zT),
                                            (s * xc(yT), yT, zs), (s * xF, yF, zs))]
    L, Rr = V["L"], V["R"]
    faces = [L, list(reversed(Rr)),
             (L[1], Rr[1], Rr[2], L[2]),          # back
             (L[2], Rr[2], Rr[3], L[3]),          # fireback leaning forward
             (L[3], Rr[3], Rr[4], L[4]),          # throat lip
             (L[4], Rr[4], Rr[5], L[5])]          # soffit
    for f in faces:
        bm.faces.new(f)
    # normals point into the firebox
    for f in bm.faces:
        f.normal_update()
        c = f.calc_center_median()
        if f.normal.dot(Vector((0, 0.18, 0.45)) - c) < 0:
            f.normal_flip()
    lining = C.mesh_from_bmesh("fp_lining", bm, _mat("soot_iron"))
    C.shade_flat(lining)
    _uvb(lining, "soot_iron")
    parts = [lining]
    # fireback plate
    hw, z0, spring = 0.30, FP_HEARTH, 0.46
    arch = [(hw * math.cos(math.radians(a)), spring + 0.16 * math.sin(math.radians(a))) for a in range(0, 181, 12)]
    outline = [(-hw, z0), (hw, z0)] + arch
    plate = _extrude("fp_fireback", outline, yB - 0.016, yB - 0.001, "iron", "xz", bevel_w=0.004, segs=2)
    _uvb(plate, "iron")
    parts.append(plate)
    bead = [(-hw + 0.03, yB - 0.016 - 0.003, z0 + 0.02)] + \
           [((hw - 0.03) * math.cos(math.radians(a)), yB - 0.019, spring + 0.13 * math.sin(math.radians(a))) for a in range(180, -1, -10)] + \
           [(hw - 0.03, yB - 0.019, z0 + 0.02)]
    parts.append(_tube("fp_fb_bead", bead, 0.0045, "iron", 6))
    boss = _rosette("fp_fb_boss", 0.075, 0.018, 10, "iron", spp=2)
    _xf(boss, _T(0, yB - 0.016, 0.40) @ _Rx(90))
    parts.append(boss)
    return parts


def _andiron(name, x):
    """Firedog: splayed scroll feet, an iron column with a brass urn finial at the front, and the billet
    bar running back to a rear foot."""
    parts = []
    y0 = FP_FACE - 0.04
    zb = FP_HEARTH
    col = _turn(name + "_col", [(0.0, 0.0), (0.016, 0.0), (0.018, 0.006), (0.014, 0.014), (0.0105, 0.024), (0.0095, 0.17),
                                (0.0125, 0.178), (0.0125, 0.186), (0.0095, 0.194), (0.0095, 0.215)], 12, "iron", fillet=0.0015)
    _xf(col, _T(x, y0, zb + 0.07))
    parts.append(col)
    fin = _turn(name + "_urn", [(0.0, 0.0), (0.012, 0.0), (0.015, 0.004), (0.011, 0.010), (0.013, 0.016), (0.026, 0.040),
                                (0.029, 0.058), (0.024, 0.076), (0.013, 0.086), (0.011, 0.092), (0.016, 0.098), (0.016, 0.104),
                                (0.010, 0.110), (0.013, 0.120), (0.011, 0.128), (0.005, 0.133), (0.0, 0.134)], 12, "brass")
    _xf(fin, _T(x, y0, zb + 0.285))
    parts.append(fin)
    for s in (-1, 1):
        foot = [(x, y0, zb + 0.08), (x + s * 0.020, y0 - 0.002, zb + 0.072), (x + s * 0.048, y0 - 0.010, zb + 0.048),
                (x + s * 0.066, y0 - 0.018, zb + 0.022), (x + s * 0.072, y0 - 0.021, zb + 0.012)]
        parts.append(_tube_r(name + "_leg", _catmull(foot, 3), 0.0085, 0.0065, "iron", 8))
        parts.append(C.sphere(name + "_toe", 0.011, (x + s * 0.073, y0 - 0.022, zb + 0.0105), _mat("iron"), 8, 5, scale=(1, 1, 0.92)))
    sq = [(-0.010, -0.010), (0.010, -0.010), (0.010, 0.010), (-0.010, 0.010)]
    bar = _sweep_c(name + "_bar", sq, [(x, y0, zb + 0.105), (x, FP_WALL - 0.06, zb + 0.105), (x, FP_WALL - 0.06, zb)],
                   "iron", up=(1, 0, 0))
    C.bevel(bar, 0.002, 1)
    parts.append(_uvb(bar, "iron", "y"))
    return parts


def _log(name, L, r, seed, end_key="oak_stained", glow=True):
    """A split-bark log along X (centred at the origin): furrowed bark, sawn ends (end_key), and, in the
    fire, glowing ember patches on its underside."""
    rng = random.Random(seed)
    nseg, nst = 12, 7
    bm = bmesh.new()
    furrow = [rng.uniform(-0.11, 0.08) * (1.0 if k % 2 else 0.6) for k in range(nseg)]
    bow = rng.uniform(-0.012, 0.012)
    rings = []
    for i in range(nst):
        t = i / (nst - 1)
        x = -L / 2 + L * t
        rr = r * (1.0 + 0.05 * math.sin(6.0 * t + seed) - 0.04 * t)
        cy = bow * math.sin(math.pi * t)
        ring = []
        for k in range(nseg):
            a = math.tau * k / nseg
            q = rr * (1 + furrow[k] + rng.uniform(-0.03, 0.03))
            ring.append(bm.verts.new((x + rng.uniform(-0.004, 0.004) * (0 < i < nst - 1), cy + q * math.cos(a), q * math.sin(a))))
        rings.append(ring)
    for A, B in zip(rings, rings[1:]):
        for k in range(nseg):
            j = (k + 1) % nseg
            bm.faces.new((A[k], A[j], B[j], B[k]))
    ends = []
    for ring, sgn in ((rings[0], -1), (rings[-1], 1)):
        c = sum((v.co for v in ring), Vector()) / nseg
        inner = [bm.verts.new(c + (v.co - c) * 0.84 + Vector((sgn * 0.006, 0, 0))) for v in ring]
        for k in range(nseg):
            j = (k + 1) % nseg
            bm.faces.new((ring[k], ring[j], inner[j], inner[k]))
        cen = bm.verts.new(c + Vector((sgn * 0.009, 0, 0)))
        for k in range(nseg):
            f = bm.faces.new((inner[k], inner[(k + 1) % nseg], cen))
            ends.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    end_set = set(ends)
    for f in bm.faces:
        if f in end_set:
            f.material_index = 1
            continue
        f.normal_update()
        if glow and ((f.normal.z < -0.55 and rng.random() < 0.45) or (f.normal.z < 0.0 and rng.random() < 0.10)):
            f.material_index = 2
    keys = ["log_bark", end_key, "ember_glow"]
    ob = C.mesh_from_bmesh(name, bm, [_mat(k) for k in keys])
    C.shade_smooth(ob, 60)
    C.uv_box(ob, 0.3, "x")
    return ob


def _flame(name, keys, tongues, seed, bands=(0.3, 0.62), cup=0.03, n=10, bulge=0.012):
    """An emissive flame layer in the XZ plane (base at z = 0, facing -Y): a row of overlapping tongues
    [(x, width, height, lean)], each a full rounded body low down that tapers on concave flanks into a
    flicked point (S-sway along its height). Each tongue is a strip of (left, centre, right) rows with the
    centre pushed forward for volume; rows below bands[0] / bands[1] / above take keys[0] / [1] / [2],
    so the colour runs from the hot base to the cooler tips."""
    rng = random.Random(seed)
    bm = bmesh.new()
    front = Vector((0, -1, 0))
    for ti, (x0, W, H, lean) in enumerate(tongues):
        wob = rng.uniform(0.0, math.tau)
        sway = rng.uniform(0.10, 0.22)
        flick = rng.choice((-1.0, 1.0)) * rng.uniform(0.06, 0.14)
        dy = 0.0015 * (ti % 2)

        def V(x, z, fwd=0.0):
            return bm.verts.new((x, dy - fwd + cup * ((x / 0.25) ** 2) + 0.006 * math.sin(7 * z + wob), z))
        rows = []
        for k in range(n + 1):
            t = k / n
            g = 0.62 + 0.38 * math.sin(0.5 * math.pi * t / 0.28) if t < 0.28 else ((1 - t) / 0.72) ** 1.35
            hw = W / 2 * g
            xc = x0 + lean * H * t * t + sway * W * math.sin(wob + 5.0 * t) * t ** 1.5 + flick * H * 4 * max(0.0, t - 0.7) ** 2
            if k == n:
                rows.append([V(xc, H)])
            else:
                rows.append([V(xc - hw, H * t), V(xc, H * t, bulge * W * g), V(xc + hw, H * t)])
        for k in range(n):
            tm = (k + 0.5) / n
            mi = 0 if tm < bands[0] else 1 if tm < bands[1] else 2
            A, B = rows[k], rows[k + 1]
            fs = [bm.faces.new((A[0], A[1], B[1], B[0])), bm.faces.new((A[1], A[2], B[2], B[1]))] if len(B) == 3 else \
                 [bm.faces.new((A[0], A[1], B[0])), bm.faces.new((A[1], A[2], B[0]))]
            for f in fs:
                FH._orient(f, front)
                f.material_index = mi
    ob = C.mesh_from_bmesh(name, bm, [_mat(k) for k in keys])
    C.shade_smooth(ob, 80)
    C.uv_box(ob, 0.5)
    return ob


def _fire():
    """The log fire: three logs on the andirons, a bed of embers and charcoal on the ash, and layered flame
    cards (outer tongue, body, white-hot core) licking up between the logs. Returns (wood_parts, fire_parts)."""
    wood, fire = [], []
    zbar = FP_HEARTH + 0.105 + 0.010
    l1 = _log("fp_log1", 0.70, 0.055, 3)
    _xf(l1, _T(0.01, 0.075, zbar + 0.055) @ _Rz(-4))
    l2 = _log("fp_log2", 0.74, 0.062, 7)
    _xf(l2, _T(-0.02, 0.215, zbar + 0.062) @ _Rz(3))
    # top log in the valley between the two
    y3, r3 = 0.150, 0.048
    z3 = zbar + 0.060 + math.sqrt(max(0.0, (0.058 + r3) ** 2 - (0.07) ** 2))
    l3 = _log("fp_log3", 0.60, r3, 11)
    _xf(l3, _T(0.03, y3, z3) @ _Rz(14) @ _Rx(-6))
    wood += [l1, l2, l3]
    # ash bed and embers
    rng = random.Random(5)
    ash = _turn("fp_ash", [(0.0, 0.0), (0.27, 0.0), (0.26, 0.003), (0.22, 0.007), (0.12, 0.010), (0.0, 0.011)], 20, "ash",
                caps=(False, False))
    for v in ash.data.vertices:
        a = math.atan2(v.co.y, v.co.x)
        v.co.x *= 1.0 + 0.10 * math.sin(3 * a + 1.0) + 0.05 * math.sin(7 * a)
        v.co.y *= 1.0 + 0.10 * math.sin(3 * a + 1.0) + 0.05 * math.sin(7 * a)
    _xf(ash, _T(0, 0.17, FP_HEARTH - 0.0005) @ Matrix.Diagonal((1.0, 0.52, 1.0, 1.0)))
    wood.append(ash)
    src = C.sphere("ember", 1.0, (0, 0, 0), _mat("ember_glow"), 6, 4)
    for k in range(26):
        x = rng.uniform(-0.23, 0.23)
        y = rng.uniform(0.09, 0.27)
        s = rng.uniform(0.009, 0.019)
        e = _copy(src)
        for v in e.data.vertices:
            v.co *= Vector((s * rng.uniform(0.9, 1.4), s * rng.uniform(0.8, 1.2), s * rng.uniform(0.45, 0.7)))
            v.co += Vector((rng.uniform(-0.15, 0.15), rng.uniform(-0.15, 0.15), rng.uniform(-0.1, 0.1))) * s
        _xf(e, _T(x, y, FP_HEARTH + 0.006 + s * 0.35) @ _Rz(rng.uniform(0, 180)))
        if rng.random() < 0.45:
            e.data.materials[0] = _mat("charcoal")
            wood.append(e)
        else:
            fire.append(e)
    C.remove(src)
    # flames: clusters of tongues in three nested layers (red-orange tongue, orange body, yellow-white
    # core near the wood), each cluster as two crossed cards for some depth from the side
    clusters = [  # (x, y, z0, yaw, scale, tongues [(x, w, h, lean)])
        (0.0, 0.155, zbar + 0.050, -24.0, 1.0, [(-0.17, 0.17, 0.20, -0.22), (-0.085, 0.20, 0.31, -0.10), (0.0, 0.22, 0.40, 0.04),
                                                (0.09, 0.19, 0.28, 0.16), (0.17, 0.16, 0.18, 0.26), (0.0, 0.50, 0.12, 0.0)]),
        (0.02, 0.150, zbar + 0.050, 30.0, 0.92, [(-0.14, 0.18, 0.22, -0.18), (-0.04, 0.21, 0.35, -0.04), (0.06, 0.19, 0.29, 0.10),
                                                 (0.15, 0.16, 0.16, 0.22)]),
        (-0.02, 0.262, zbar + 0.070, 0.0, 1.0, [(-0.20, 0.17, 0.21, -0.18), (-0.10, 0.20, 0.33, -0.08), (0.0, 0.21, 0.44, 0.0),
                                                (0.11, 0.19, 0.31, 0.10), (0.21, 0.16, 0.19, 0.20), (0.0, 0.52, 0.13, 0.0)]),
    ]
    for ci, (cx, cy, z0, yaw, sc, tongues) in enumerate(clusters):
        for li, (keys, bands, ws, hs, dy) in enumerate(((("fire_glow",) * 3, (0.5, 0.8), 1.28, 1.14, 0.012),
                                                        (("fire_body", "fire_outer", "fire_outer"), (0.24, 0.46), 1.0, 1.0, 0.0),
                                                        (("fire_core", "fire_core", "fire_body"), (0.40, 0.72), 0.68, 0.62, -0.006))):
            tg = [(x * sc, w * sc * ws, h * sc * hs, lean) for x, w, h, lean in tongues]
            f = _flame(f"fp_flame{li}", keys, tg, ci * 10 + li, bands)
            _xf(f, _T(cx, cy, z0) @ _Rz(yaw) @ _T(0, dy, 0))
            fire.append(f)
    return wood, fire


def _fender():
    """Brass fender on the hearth: moulded plinth band, turned balusters, a round top rail, corner posts
    with ball finials. Returns to the chimneypiece face either side of the opening."""
    parts = []
    hw, yf, yb, z0 = 0.72, -0.29, FP_FACE - 0.002, FP_HEARTH
    band = [(-0.026, 0.0), (0.004, 0.0), (0.004, 0.004), (0.0015, 0.007), (0.0015, 0.010), (-0.002, 0.012), (-0.004, 0.016),
            (-0.004, 0.019), (-0.001, 0.022), (0.002, 0.027), (0.002, 0.031), (-0.001, 0.035), (-0.004, 0.036), (-0.004, 0.040),
            (-0.006, 0.043), (-0.010, 0.044), (-0.022, 0.044), (-0.026, 0.042)]
    parts.append(_sweep_c("fender_band", band, [(-hw, yb, z0), (-hw, yf, z0), (hw, yf, z0), (hw, yb, z0)], "brass"))
    c = 0.011
    zr = z0 + 0.128
    circ = [(0.0095 * math.cos(math.tau * k / 12), 0.0095 * math.sin(math.tau * k / 12)) for k in range(12)]
    parts.append(_sweep_c("fender_rail", circ, [(-hw + c, yb, zr), (-hw + c, yf + c, zr), (hw - c, yf + c, zr), (hw - c, yb, zr)],
                          "brass", smooth=50))
    bal = _turn("fender_bal", [(0.0058, 0.0), (0.0036, 0.014), (0.0066, 0.034), (0.0034, 0.060), (0.0052, 0.068),
                               (0.0052, 0.0745)], 6, "brass", caps=(False, False))
    zb0 = z0 + 0.044
    spots = []
    n = 15
    for k in range(1, n):
        spots.append((-hw + c + (2 * (hw - c)) * k / n, yf + c))
    for sx in (-1, 1):
        L = (yb - 0.03) - (yf + c)
        m = 3
        for k in range(1, m + 1):
            spots.append((sx * (hw - c), yf + c + L * k / m))
    for x, y in spots:
        b = _copy(bal)
        _xf(b, _T(x, y, zb0))
        parts.append(b)
    C.remove(bal)
    for sx in (-1, 1):
        post = _turn("fender_post", [(0.0125, 0.0), (0.0125, 0.010), (0.0095, 0.016), (0.0085, 0.070), (0.0115, 0.082),
                                     (0.0118, 0.096), (0.0095, 0.104), (0.0070, 0.110), (0.0050, 0.114), (0.0, 0.114)], 14, "brass",
                     fillet=0.001)
        _xf(post, _T(sx * (hw - c), yf + c, zb0))
        parts.append(post)
        parts.append(C.sphere("fender_ball", 0.0175, (sx * (hw - c), yf + c, zb0 + 0.114 + 0.0155), _mat("brass"), 12, 8))
    for o in parts:
        if not o.data.uv_layers:
            C.uv_box(o, tex_size("brass"))
    return parts


def _tool(name, kind, top_z, bot_z):
    """One fire tool hanging straight down from a ring at top_z (local x = y = 0)."""
    parts = []
    ring = C.torus(name + "_ring", 0.011, 0.0024, (0, 0, top_z - 0.011), _mat("brass"), 12, 5, rot=C.rotx(90))
    parts.append(ring)
    h0 = top_z - 0.022
    handle = _turn(name + "_handle", [(0.0, 0.0), (0.0045, 0.0), (0.0065, 0.006), (0.0085, 0.020), (0.0095, 0.050),
                                      (0.0090, 0.072), (0.0105, 0.080), (0.0118, 0.090), (0.0100, 0.100), (0.0060, 0.106),
                                      (0.0035, 0.110), (0.0, 0.111)], 10, "brass", fillet=0.001)
    _xf(handle, _T(0, 0, h0 - 0.111))
    parts.append(handle)
    zs = h0 - 0.111
    if kind == "tongs":
        for s in (-1, 1):
            pts = [(s * 0.003, 0, zs + 0.002), (s * 0.006, 0, zs - 0.20), (s * 0.014, 0, bot_z + 0.04), (s * 0.010, 0, bot_z + 0.012),
                   (s * 0.004, 0, bot_z)]
            parts.append(_tube_r(name + "_arm", _catmull(pts, 3), 0.0038, 0.003, "iron", 6))
        parts.append(_turn(name + "_pivot", [(0.0, 0.0), (0.0065, 0.0), (0.0065, 0.010), (0.0, 0.010)], 10, "brass"))
        _xf(parts[-1], _T(0, 0, zs - 0.21))
        return parts
    shaft_end = {"poker": bot_z + 0.03, "shovel": bot_z + 0.13, "brush": bot_z + 0.10}[kind]
    parts.append(C.cylinder(name + "_shaft", 0.0046, 0.0046, zs - shaft_end, (0, 0, (zs + shaft_end) / 2), _mat("iron"), 8))
    if kind == "poker":
        parts.append(_tube_r(name + "_tip", [(0, 0, shaft_end + 0.002), (0, 0, bot_z + 0.012), (0, 0, bot_z)], 0.0046, 0.0012, "iron", 8))
        hook = [(0, 0, bot_z + 0.075), (0.012, 0, bot_z + 0.060), (0.026, 0, bot_z + 0.058), (0.034, 0, bot_z + 0.066)]
        parts.append(_tube_r(name + "_hook", _catmull(hook, 3), 0.0042, 0.0022, "iron", 6))
    elif kind == "shovel":
        blade = _extrude(name + "_blade", [(-0.050, bot_z), (0.050, bot_z), (0.052, bot_z + 0.11), (0.012, bot_z + 0.13),
                                           (-0.012, bot_z + 0.13), (-0.052, bot_z + 0.11)], -0.0015, 0.0015, "iron", "xz")
        parts.append(blade)
        for s in (-1, 1):
            parts.append(_bx(name + "_lip", (s * 0.050 - 0.0015, -0.016, bot_z), (s * 0.050 + 0.0015, 0.0015, bot_z + 0.10), "iron"))
        parts.append(_bx(name + "_lipb", (-0.050, -0.016, bot_z - 0.002), (0.050, 0.0015, bot_z + 0.001), "iron"))
    elif kind == "brush":
        parts.append(_turn(name + "_ferrule", [(0.0, 0.0), (0.020, 0.0), (0.024, 0.006), (0.024, 0.030), (0.012, 0.040), (0.0, 0.042)],
                           12, "brass"))
        _xf(parts[-1], _T(0, 0, shaft_end - 0.030))
        parts.append(_turn(name + "_bristle", [(0.0, 0.0), (0.024, 0.0), (0.031, 0.010), (0.030, 0.060), (0.023, 0.072), (0.0, 0.072)],
                           12, "log_bark"))
        _xf(parts[-1], _T(0, 0, bot_z))
    return parts


def _companion_set(x, y):
    """Fire-irons on a stand: domed iron base, column with brass knops and finial, four hook arms, poker,
    shovel, brush and tongs."""
    parts = []
    z0 = FP_HEARTH
    parts.append(_xf(_turn("tools_base", [(0.0, 0.0), (0.085, 0.0), (0.086, 0.006), (0.080, 0.012), (0.062, 0.019), (0.042, 0.025),
                                           (0.024, 0.032), (0.016, 0.040), (0.0, 0.041)], 20, "iron"), _T(x, y, z0)))
    parts.append(_xf(_turn("tools_post", [(0.0095, 0.0), (0.0095, 0.25), (0.0150, 0.258), (0.0160, 0.268), (0.0125, 0.278),
                                           (0.0090, 0.285), (0.0090, 0.60), (0.0, 0.60)], 12, "iron", fillet=0.0015, caps=(True, False)),
                     _T(x, y, z0 + 0.038)))
    parts.append(_xf(_turn("tools_knop", [(0.0, 0.0), (0.012, 0.0), (0.016, 0.010), (0.018, 0.024), (0.014, 0.034), (0.010, 0.040),
                                           (0.0, 0.040)], 14, "brass", fillet=0.001), _T(x, y, z0 + 0.38)))
    zt = z0 + 0.64
    parts.append(_xf(_turn("tools_finial", [(0.0, 0.0), (0.012, 0.0), (0.014, 0.006), (0.010, 0.014), (0.017, 0.030), (0.016, 0.044),
                                             (0.009, 0.054), (0.006, 0.060), (0.0085, 0.064), (0.0, 0.072)], 14, "brass", fillet=0.001),
                     _T(x, y, zt - 0.005)))
    angs = (45.0, 135.0, 225.0, 315.0)
    for a in angs:
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        arm = [Vector((x, y, zt - 0.02)) + d * 0.006, Vector((x, y, zt - 0.022)) + d * 0.030,
               Vector((x, y, zt - 0.018)) + d * 0.046, Vector((x, y, zt - 0.004)) + d * 0.050]
        parts.append(_tube_r("tools_arm", _catmull(arm, 3), 0.0042, 0.0034, "iron", 6))
    for a, kind in zip(angs, ("shovel", "poker", "tongs", "brush")):
        d = Vector((math.cos(math.radians(a)), math.sin(math.radians(a)), 0))
        p = Vector((x, y, 0)) + d * 0.046
        tp = _tool("tool_" + kind, kind, zt - 0.010, z0 + 0.045)
        for o in tp:
            _xf(o, _T(p.x, p.y, 0) @ _Rz(a + 90))
        parts += tp
    for o in parts:
        if not o.data.uv_layers:
            C.uv_box(o, 0.3)
    return parts


def _log_rack(x, y):
    """Wrought-iron log cradle with scrolled tops holding three sawn logs."""
    parts = []
    z0 = FP_HEARTH
    R, cz = 0.118, z0 + 0.185
    for sx in (-1, 1):
        xx = x + sx * 0.12
        hoop = [(xx, y + R * math.cos(math.radians(a)), cz + R * math.sin(math.radians(a))) for a in range(155, 386, 15)]
        parts.append(_tube("rack_hoop", hoop, 0.0075, "iron", 6))
        for sgn, a_end in ((-1, 155), (1, 25)):
            ex = y + R * math.cos(math.radians(a_end))
            ez = cz + R * math.sin(math.radians(a_end))
            sp = _spiral(ex + sgn * 0.022, ez, 0.022, 1.2, 0.7, a0=180.0 if sgn > 0 else 0.0, n=16, cw=(sgn > 0))
            parts.append(_tube_r("rack_scroll", [(xx, py, pz) for py, pz in sp], 0.0072, 0.0045, "iron", 5))
        for sy in (-1, 1):
            leg = [(xx, y + sy * 0.060, cz - R * 0.86), (xx, y + sy * 0.080, z0 + 0.030), (xx, y + sy * 0.088, z0 + 0.008)]
            parts.append(_tube_r("rack_leg", _catmull(leg, 2), 0.0075, 0.0065, "iron", 6))
            parts.append(C.sphere("rack_toe", 0.010, (xx, y + sy * 0.089, z0 + 0.008), _mat("iron"), 8, 5))
    for sy in (-1, 1):
        a = math.radians(-90 + sy * 40)
        yy, zz = y + R * math.cos(a), cz + R * math.sin(a)
        parts.append(C.cylinder("rack_rail", 0.0065, 0.0065, 0.24 + 0.012, (x, yy, zz), _mat("iron"), 8, rot=C.roty(90)))
    # logs: two in the cradle, one in the valley between them
    rl = 0.050
    d = R - 0.0075 - rl
    bz = cz - math.sqrt(max(0.0, d * d - rl * rl))
    for k, (ly, lz, r, sd, rot) in enumerate(((-rl, bz, rl, 21, 3), (rl, bz, rl, 22, -4),
                                             (0.004, bz + math.sqrt((2 * rl) ** 2 - rl * rl) * 0.98, 0.044, 23, 7))):
        lg = _log(f"rack_log{k}", 0.36, r, sd, end_key="oak_light", glow=False)
        _xf(lg, _T(x, y + ly, lz) @ _Rz(rot))
        parts.append(lg)
    for o in parts:
        if not o.data.uv_layers:
            C.uv_box(o, 0.3)
    return parts


def _gilt_mirror():
    """Overmantel mirror: a bold gilt cushion-and-bead frame, bevelled mirror plate, a cartouche crest with
    C-scrolls and an urn finial (top at 2.40 m), rosettes at the top corners."""
    parts = []
    hw, z0, z1 = 0.74, FP_SHELF[1] + 0.002, 2.285
    yw = FP_WALL - 0.002
    prof = [(0.000, 0.000), (0.000, 0.014), (0.002, 0.019), (0.006, 0.021), (0.010, 0.020), (0.012, 0.024), (0.016, 0.036),
            (0.022, 0.047), (0.030, 0.054), (0.038, 0.056), (0.046, 0.054), (0.052, 0.049), (0.056, 0.041), (0.062, 0.035),
            (0.070, 0.033), (0.076, 0.033), (0.078, 0.036), (0.082, 0.038), (0.086, 0.036), (0.088, 0.031), (0.090, 0.024),
            (0.090, 0.012), (0.098, 0.012), (0.098, 0.000)]
    corners = [(-hw, yw, z0), (hw, yw, z0), (hw, yw, z1), (-hw, yw, z1)]
    frame = FH._mitre_loft("mirror_frame", corners, (0, -1, 0), prof, "gilt", 40)
    C.uv_box(frame, 0.5)
    parts.append(frame)
    m = 0.092
    plate = _bx("mirror_plate", (-hw + m, yw - 0.013, z0 + m), (hw - m, yw - 0.006, z1 - m), "mirror")
    parts.append(plate)
    # crest: oval cartouche, C-scrolls, urn finial
    yc = yw - 0.030
    cart = _rosette("crest_cartouche", 0.062, 0.026, 10, "gilt", spp=3, oval=1.3)
    _xf(cart, _T(0, yc + 0.010, z1 + 0.032) @ _Rx(90))
    parts.append(cart)
    for sx in (-1, 1):
        c_pts = [(sx * 0.045, z1 + 0.060), (sx * 0.085, z1 + 0.074), (sx * 0.130, z1 + 0.064), (sx * 0.165, z1 + 0.040),
                 (sx * 0.190, z1 + 0.018)]
        sp = _spiral(sx * 0.178, z1 + 0.026, 0.016, 1.0, 0.6, a0=(-30.0 if sx > 0 else 210.0), n=10, cw=(sx < 0))
        path = [(x, yc, z) for x, z in _catmull(c_pts, 3)] + [(x, yc, z) for x, z in sp[1:]]
        parts.append(_tube_r("crest_scroll", path, 0.0120, 0.0055, "gilt", 7))
        low = [(sx * 0.045, z1 + 0.012), (sx * 0.080, z1 + 0.006), (sx * 0.110, z1 + 0.006)]
        parts.append(_tube_r("crest_leaf", [(x, yc + 0.004, z) for x, z in _catmull(low, 3)], 0.008, 0.003, "gilt", 8))
        ros = _rosette("frame_rose", 0.026, 0.012, 6, "gilt", spp=2)
        _xf(ros, _T(sx * (hw - 0.038), yw - 0.054, z1 - 0.038) @ _Rx(90))
        parts.append(ros)
    urn = _turn("crest_urn", [(0.0, 0.0), (0.010, 0.0), (0.012, 0.004), (0.008, 0.010), (0.014, 0.020), (0.016, 0.030),
                              (0.010, 0.040), (0.006, 0.046), (0.009, 0.052), (0.0, 0.060)], 12, "gilt", fillet=0.001)
    _xf(urn, _T(0, yc + 0.004, 2.40 - 0.060))
    parts.append(urn)
    for o in parts:
        if o.name.startswith(("crest", "frame_rose")):
            C.uv_box(o, 0.5)
    return parts


def _mantel_clock(x, y, z):
    """Walnut bracket clock with a bell top, brass feet and finial, an enamel dial with chapter marks and hands."""
    parts = []
    hw, hd = 0.115, 0.065
    base = _slab("clock_base", _rect(hw + 0.012, hd + 0.010), 0.004,
                 [(0.0, 0.012), (0.0, 0.026), (0.004, 0.030), (0.010, 0.034), (0.012, 0.038)], 3, WOOD)
    parts.append(_uvb(base, WOOD, "x"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(_xf(_turn("clock_foot", [(0.0, 0.0), (0.008, 0.0), (0.011, 0.005), (0.010, 0.010), (0.007, 0.0125), (0.0, 0.0125)],
                                   8, "brass"), _T(sx * (hw - 0.002), sy * (hd - 0.004), 0.0)))
    body = _bx("clock_body", (-hw, -hd, 0.037), (hw, hd, 0.255), WOOD, 0.003, 2, "z")
    parts.append(body)
    top = _slab("clock_top", _rect(hw + 0.008, hd + 0.008), 0.004,
                [(0.0, 0.255), (0.0, 0.262), (0.006, 0.266), (0.010, 0.272), (0.012, 0.276), (0.022, 0.290), (0.040, 0.305),
                 (0.062, 0.318), (0.080, 0.325), (0.085, 0.330)], 3, WOOD)
    parts.append(_uvb(top, WOOD, "x"))
    parts.append(_xf(_turn("clock_finial", [(0.0, 0.0), (0.012, 0.0), (0.014, 0.004), (0.009, 0.010), (0.014, 0.020), (0.012, 0.032),
                                             (0.006, 0.040), (0.0, 0.046)], 12, "brass", fillet=0.001), _T(0, 0, 0.329)))
    zc = 0.150
    yf = -hd
    bez = C.torus("clock_bezel", 0.064, 0.0045, (0, yf - 0.002, zc), _mat("brass"), 24, 5, rot=C.rotx(90))
    parts.append(bez)
    dial = C.cylinder("clock_dial", 0.061, 0.061, 0.003, (0, yf - 0.0005, zc), _mat("porcelain"), 32, rot=C.rotx(90))
    parts.append(dial)
    for k in range(12):
        a = math.tau * k / 12
        L = 0.011 if k % 3 == 0 else 0.007
        r = 0.050
        mk = _bx("clock_mark", (-0.0012 if k % 3 else -0.0018, -0.0004, -L / 2), (0.0012 if k % 3 else 0.0018, 0.0004, L / 2), "label_ink")
        _xf(mk, _T(r * math.sin(a), yf - 0.0025, zc + r * math.cos(a)) @ _Ry(-math.degrees(a)))
        parts.append(mk)
    for L, w, ang in ((0.032, 0.0026, 300.0), (0.046, 0.0018, 60.0)):
        hnd = _bx("clock_hand", (-w / 2, -0.0004, 0.0), (w / 2, 0.0004, L), "label_ink")
        _xf(hnd, _T(0, yf - 0.0032 - (0.0008 if L > 0.04 else 0), zc) @ _Ry(-ang))
        parts.append(hnd)
    parts.append(C.cylinder("clock_boss", 0.0035, 0.0035, 0.003, (0, yf - 0.0045, zc), _mat("brass"), 10, rot=C.rotx(90)))
    for sx in (-1, 1):
        parts.append(_bx("clock_handle", (sx * hw - 0.003, -0.012, 0.215), (sx * hw + 0.003 * sx + (0 if sx > 0 else 0), 0.012, 0.22), "brass"))
    for o in parts:
        _xf(o, _T(x, y, z))
    return parts


def _candlestick(x, y, z):
    parts = []
    stick = _turn("candlestick", [(0.0, 0.0), (0.056, 0.0), (0.057, 0.005), (0.050, 0.010), (0.034, 0.018), (0.020, 0.026),
                                  (0.014, 0.034), (0.020, 0.042), (0.021, 0.050), (0.013, 0.060), (0.0105, 0.090), (0.0125, 0.130),
                                  (0.0175, 0.165), (0.0180, 0.185), (0.0125, 0.200), (0.0115, 0.215), (0.0155, 0.222),
                                  (0.0155, 0.228), (0.0300, 0.233), (0.0310, 0.238), (0.0160, 0.240), (0.0150, 0.262),
                                  (0.0125, 0.262), (0.0125, 0.246), (0.0, 0.246)], 10, "brass")
    parts.append(stick)
    candle = _turn("candle", [(0.0, 0.0), (0.0118, 0.0), (0.0118, 0.170), (0.0105, 0.176), (0.0060, 0.179), (0.0, 0.1795)], 10,
                   "candle_wax")
    _xf(candle, _T(0, 0, 0.247))
    parts.append(candle)
    parts.append(C.cylinder("wick", 0.0011, 0.0009, 0.010, (0, 0, 0.247 + 0.1795 + 0.004), _mat("charcoal"), 6))
    for o in parts:
        _xf(o, _T(x, y, z))
    return parts


def build_fireplace(item=None):
    """Carved limestone chimneypiece 2.6 x 0.75 x 2.4 m (back on the wall at y = +0.375, hearth to the
    front): fluted pilasters with scrolled consoles, a frieze with a swagged tablet, a moulded mantel
    shelf at 1.43 m, a sooted cast-iron firebox with a cast fireback, a log fire on brass-and-iron
    andirons (flames and embers in the child object ..._Fire), a brass fender, a companion set, a log
    rack, a gilt overmantel mirror, a bracket clock and candlesticks. Carries light_points/light_color."""
    parts = []
    hearth = _slab("fp_hearth", _rect(1.24, FP_D / 2), [0.01, 0.01, 0.001, 0.001], _HEARTH_EDGE, 3, "marble_dark")
    C.uv_box(hearth, 1.0)
    parts.append(hearth)
    outline = [(-FP_JHW, FP_HEARTH), (-FP_OHW, FP_HEARTH), (-FP_OHW, FP_OTOP), (FP_OHW, FP_OTOP), (FP_OHW, FP_HEARTH),
               (FP_JHW, FP_HEARTH), (FP_JHW, FP_FRIEZE), (-FP_JHW, FP_FRIEZE)]
    ground = _extrude("fp_ground", outline, FP_FACE, FP_WALL, FP_STONE, "xz", bevel_w=0.004, segs=2)
    parts.append(_uvb(ground, FP_STONE))
    arch = _sweep_c("fp_architrave", _ARCHITRAVE, [(-FP_OHW, FP_FACE, FP_HEARTH), (-FP_OHW, FP_FACE, FP_OTOP),
                                                     (FP_OHW, FP_FACE, FP_OTOP), (FP_OHW, FP_FACE, FP_HEARTH)], FP_STONE, up=(0, -1, 0))
    parts.append(arch)
    for sx in (-1, 1):
        parts += _fp_pilaster(f"fp_pil{'L' if sx < 0 else 'R'}", sx)
    parts += _fp_frieze()
    hd = (FP_WALL - FP_SHELF_Y) / 2
    shelf = _slab("fp_shelf", _rect(FP_W / 2, hd, 0, FP_SHELF_Y + hd), [0.014, 0.014, 0.001, 0.001],
                  [(d, FP_SHELF[0] + z) for d, z in _SHELF_EDGE], 3, FP_STONE)
    parts.append(_uvb(shelf, FP_STONE))
    parts += _fp_firebox()
    for sx in (-1, 1):
        parts += _andiron(f"andiron{'L' if sx < 0 else 'R'}", sx * 0.30)
    wood, fire = _fire()
    parts += wood
    parts += _fender()
    parts += _companion_set(1.00, -0.19)
    parts += _log_rack(-1.00, -0.18)
    parts += _gilt_mirror()
    parts += _mantel_clock(0.0, 0.17, FP_SHELF[1])
    for sx in (-1, 1):
        parts += _candlestick(sx * 0.98, 0.16, FP_SHELF[1])
    ob = _join(parts, "Furniture_Fireplace_01")
    fire_ob = _join(fire, "Furniture_Fireplace_01_Fire")
    fire_ob.parent = ob
    ob["light_points"] = [[0.0, -0.06, 0.42]]
    ob["light_color"] = FIRE_COLOR
    ob["light_kind"] = "fire"
    fire_ob["fire"] = True
    return ob

# ---------------------------------------------------------------------------
# Small props: hardback books, a porcelain tea set, a brass tray
# ---------------------------------------------------------------------------

CLOTHS = ("cloth_red", "cloth_navy", "cloth_green", "cloth_ochre")


def _book(name, L, w, t, key, bands=True):
    """A closed hardback lying flat (bottom at z = 0, length along X, spine on -Y): cloth boards wrapping a
    rounded spine, a page block set in 3 mm at the head, tail and fore-edge, two gilt bands on the spine."""
    b = min(0.0024, t * 0.12)
    rs = t / 2
    ys = -w / 2 + rs
    n = 8
    ri = rs - b
    outer = [(w / 2, 0.0), (ys, 0.0)]
    outer += [(ys - rs * math.sin(math.pi * k / n), rs - rs * math.cos(math.pi * k / n)) for k in range(1, n)]
    outer += [(ys, t), (w / 2, t), (w / 2, t - b)]
    inner = [(ys, t - b)] + [(ys - ri * math.sin(math.pi * k / n), rs + ri * math.cos(math.pi * k / n)) for k in range(1, n)]
    inner += [(ys, b), (w / 2, b)]
    cover = _extrude(name + "_cover", outer + inner, -L / 2, L / 2, key, "yz")
    _uvb(cover, key, "x")
    parts = [cover, _bx(name + "_pages", (-L / 2 + 0.003, ys - 0.3 * ri, b + 0.0003), (L / 2 - 0.003, w / 2 - 0.003, t - b - 0.0003),
                        "book_pages")]
    if bands:
        phis = [math.pi * (0.12 + 0.76 * k / 3) for k in range(4)]
        band = [(ys - (rs + 0.0004) * math.sin(p), rs - (rs + 0.0004) * math.cos(p)) for p in phis] + \
               [(ys - (rs - 0.0008) * math.sin(p), rs - (rs - 0.0008) * math.cos(p)) for p in reversed(phis)]
        for sx in (-1, 1):
            x = sx * (L / 2 - 0.028)
            parts.append(_uvb(_extrude(name + "_band", band, x - 0.0018, x + 0.0018, "gilt", "yz"), "gilt"))
    return _join(parts, name)


def _book_stack(prefix, specs, x, y, z, key_offset=0, bands=True):
    """Books [(L, w, t, yaw)] stacked from z; each lies on the one below. Returns (parts, top z)."""
    parts = []
    for k, (L, w, t, yaw) in enumerate(specs):
        bk = _book(f"{prefix}_book{k}", L, w, t, CLOTHS[(k + key_offset) % len(CLOTHS)], bands)
        _xf(bk, _T(x, y, z) @ _Rz(yaw))
        parts.append(bk)
        z += t
    return parts, z


def _cup_and_saucer(name, seg=12):
    """Porcelain tea cup (thin wall, foot ring, C handle) on its saucer, with tea in it. Saucer on z = 0."""
    parts = [_turn(name + "_saucer", [(0.0, 0.0), (0.030, 0.0), (0.032, 0.0025), (0.046, 0.0075), (0.064, 0.0150),
                                      (0.0700, 0.0185), (0.0690, 0.0200), (0.0600, 0.0165), (0.0440, 0.0105),
                                      (0.0270, 0.0090), (0.0, 0.0090)], seg, "porcelain")]
    z0 = 0.0090
    cup = _turn(name + "_cup", [(0.0, 0.0), (0.0195, 0.0), (0.0200, 0.0060), (0.0300, 0.0150), (0.0410, 0.0380),
                                (0.0450, 0.0600), (0.0435, 0.0606), (0.0405, 0.0420), (0.0330, 0.0250), (0.0220, 0.0150),
                                (0.0, 0.0125)], seg, "porcelain")
    parts.append(_xf(cup, _T(0, 0, z0)))
    parts.append(C.cylinder(name + "_tea", 0.0399, 0.0399, 0.0016, (0, 0, z0 + 0.0455), _mat("tea"), seg))
    h = [(0.040, 0.0, z0 + 0.050), (0.055, 0.0, z0 + 0.053), (0.064, 0.0, z0 + 0.044), (0.060, 0.0, z0 + 0.031),
         (0.047, 0.0, z0 + 0.023), (0.032, 0.0, z0 + 0.022)]
    parts.append(_tube_r(name + "_handle", _catmull(h, 1), 0.0042, 0.0036, "porcelain", 6))
    for o in parts:
        if not o.data.uv_layers:
            C.uv_box(o, 0.3)
    return parts


def _teapot(name):
    """Round porcelain teapot: foot ring, globular body, gallery and domed lid with a knop, swan spout and
    loop handle. Stands on z = 0, spout towards +X."""
    parts = [_turn(name + "_body", [(0.0, 0.0), (0.044, 0.0), (0.046, 0.003), (0.045, 0.008), (0.055, 0.013), (0.068, 0.028),
                                     (0.076, 0.050), (0.075, 0.072), (0.066, 0.095), (0.050, 0.109), (0.040, 0.1135),
                                     (0.040, 0.1170), (0.037, 0.1170), (0.037, 0.1110), (0.0, 0.1110)], 14, "porcelain")]
    parts.append(_turn(name + "_lid", [(0.0, 0.1150), (0.0365, 0.1150), (0.0395, 0.1180), (0.0340, 0.1280), (0.0210, 0.1340),
                                        (0.0085, 0.1370), (0.0120, 0.1440), (0.0105, 0.1515), (0.0, 0.1552)], 14, "porcelain"))
    parts.append(C.torus(name + "_gilt", 0.0393, 0.0011, (0, 0, 0.1186), _mat("gilt"), 16, 3))
    sp = [(0.058, 0.0, 0.034), (0.082, 0.0, 0.044), (0.100, 0.0, 0.064), (0.112, 0.0, 0.087), (0.123, 0.0, 0.101), (0.128, 0.0, 0.104)]
    parts.append(_tube_r(name + "_spout", _catmull(sp, 2), 0.0145, 0.0062, "porcelain", 8, (False, True)))
    hd = [(-0.066, 0.0, 0.092), (-0.092, 0.0, 0.094), (-0.110, 0.0, 0.076), (-0.108, 0.0, 0.050), (-0.091, 0.0, 0.033),
          (-0.068, 0.0, 0.030)]
    parts.append(_tube_r(name + "_handle", _catmull(hd, 2), 0.0068, 0.0058, "porcelain", 6))
    for o in parts:
        if not o.data.uv_layers:
            C.uv_box(o, 0.3)
    return parts


def _tray(name, hw=0.23, hd=0.16):
    """Brass tray: rounded rectangle with a flared wall, a rolled rim and loop handles at the ends (floor at z = 0.0045)."""
    prof = [(0.015, 0.0), (0.004, 0.0015), (0.0, 0.006), (0.0, 0.024), (-0.003, 0.029), (-0.0055, 0.0315), (-0.0045, 0.0340),
            (-0.0015, 0.0335), (0.0015, 0.0295), (0.0030, 0.0100), (0.0060, 0.0055), (0.0120, 0.0045)]
    tray = _slab(name, _rect(hw, hd), 0.035, prof, 2, "brass")
    _uvb(tray, "brass")
    parts = [tray]
    for sx in (-1, 1):
        p = [(sx * (hw - 0.004), -0.055, 0.019), (sx * (hw + 0.020), -0.052, 0.026), (sx * (hw + 0.032), -0.030, 0.030),
             (sx * (hw + 0.034), 0.0, 0.031), (sx * (hw + 0.032), 0.030, 0.030), (sx * (hw + 0.020), 0.052, 0.026),
             (sx * (hw - 0.004), 0.055, 0.019)]
        parts.append(_uvb(_tube(name + "_handle", _catmull(p, 1), 0.0042, "brass", 6), "brass"))
    return parts


# ---------------------------------------------------------------------------
# Coffee table: walnut, tooled leather inset top, turned legs, undertier; tea tray and books
# ---------------------------------------------------------------------------

CT_W, CT_D, CT_H = 1.3, 0.7, 0.45
CT_LX, CT_LY = 0.575, 0.275          # leg centre lines
CT_BLOCK = 0.028                     # half-size of the square pommels


def build_table_coffee(item=None):
    """Walnut coffee table 1.3 x 0.7 x 0.45 m: a moulded top (cove and thumbnail edge) with a gilt-tooled
    green leather inset, beaded aprons, four turned legs on brass cups with square pommels, a notched
    undertier; a brass tray with a porcelain tea set and stacks of cloth-bound books."""
    parts = []
    t_top = 0.034
    z_und = CT_H - t_top
    prof = [(0.020, z_und), (0.010, z_und + 0.001)]
    prof += [(0.010 * math.cos(math.radians(a)), z_und + 0.001 + 0.010 * math.sin(math.radians(a))) for a in (30, 60, 90)]
    prof += [(0.0, CT_H - 0.006)]
    prof += [(0.006 - 0.006 * math.cos(math.radians(a)), CT_H - 0.006 + 0.006 * math.sin(math.radians(a))) for a in (30, 60, 90)]
    top = _slab("ct_top", _rect(CT_W / 2, CT_D / 2), 0.03, prof, 2, WOOD)
    parts.append(_uvb(top, WOOD, "x"))
    # tooled leather inset with a gilt fillet line
    lw, ld = CT_W / 2 - 0.085, CT_D / 2 - 0.085
    leather = _slab("ct_leather", _rect(lw, ld), 0.004, [(0.0, CT_H - 0.0004), (0.0, CT_H + 0.0008), (0.0008, CT_H + 0.0012)], 2,
                    "leather_green")
    parts.append(_uvb(leather, "leather_green"))
    tl = [(-lw + 0.014, -ld + 0.014, CT_H + 0.0012), (lw - 0.014, -ld + 0.014, CT_H + 0.0012), (lw - 0.014, ld - 0.014, CT_H + 0.0012),
          (-lw + 0.014, ld - 0.014, CT_H + 0.0012)]
    tool = FH._mitre_loft("ct_tooling", tl, (0, 0, 1), [(0.0, -0.0002), (0.0022, -0.0002), (0.0022, 0.00025), (0.0, 0.00025)], "gilt")
    parts.append(_uvb(tool, "gilt"))
    # legs: brass cup, turned foot, square shelf block, turned vase, square pommel under the top
    cup = _turn("ct_cup", [(0.0, 0.0), (0.0170, 0.0), (0.0180, 0.004), (0.0180, 0.022), (0.0155, 0.028), (0.0, 0.028)], 10, "brass_aged")
    low = _turn("ct_foot", [(0.0145, 0.026), (0.0205, 0.040), (0.0205, 0.056), (0.0150, 0.072), (0.0200, 0.086)], 12, WOOD)
    up = _turn("ct_turn", [(0.0200, 0.134), (0.0145, 0.150), (0.0172, 0.166), (0.0140, 0.178), (0.0172, 0.212), (0.0212, 0.248),
                           (0.0192, 0.278), (0.0138, 0.296), (0.0172, 0.305), (0.0148, 0.313), (0.0232, 0.332)], 12, WOOD)
    blk_lo = _bx("ct_block", (-0.025, -0.025, 0.084), (0.025, 0.025, 0.136), WOOD, 0.003, 1, "z")
    blk_hi = _bx("ct_pommel", (-CT_BLOCK, -CT_BLOCK, 0.330), (CT_BLOCK, CT_BLOCK, z_und + 0.0005), WOOD, 0.003, 1, "z")
    leg_src = _join([cup, low, up, blk_lo, blk_hi], "ct_leg")
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(_xf(_copy(leg_src), _T(sx * CT_LX, sy * CT_LY, 0.0)))
    C.remove(leg_src)
    # aprons set back 10 mm from the pommel faces, a bead along their lower edges
    za0 = 0.345
    xf, yf = CT_LX + CT_BLOCK - 0.010, CT_LY + CT_BLOCK - 0.010
    xi, yi = CT_LX - CT_BLOCK + 0.001, CT_LY - CT_BLOCK + 0.001
    for sy in (-1, 1):
        parts.append(_bx("ct_apron", (-xi, sy * yf, za0), (xi, sy * (yf - 0.020), z_und + 0.001), WOOD, 0.0015, 1, "x"))
        parts.append(_uvb(_tube("ct_bead", [(-xi, sy * yf, za0 + 0.0045), (xi, sy * yf, za0 + 0.0045)], 0.0045, WOOD, 8), WOOD, "x"))
    for sx in (-1, 1):
        parts.append(_bx("ct_apron", (sx * xf, -yi, za0), (sx * (xf - 0.020), yi, z_und + 0.001), WOOD, 0.0015, 1, "y"))
        parts.append(_uvb(_tube("ct_bead", [(sx * xf, -yi, za0 + 0.0045), (sx * xf, yi, za0 + 0.0045)], 0.0045, WOOD, 8), WOOD, "y"))
    # undertier, notched round the shelf blocks
    a, b, c, d = 0.024, CT_LX, CT_LY, 0.024
    shelf = [(-b + a, -c), (b - a, -c), (b - a, -c + d), (b, -c + d), (b, c - d), (b - a, c - d), (b - a, c), (-b + a, c),
             (-b + a, c - d), (-b, c - d), (-b, -c + d), (-b + a, -c + d)]
    sh = C.prism("ct_shelf", shelf, 0.104, 0.124, _mat(WOOD))
    C.bevel(sh, 0.003, 1)
    parts.append(_uvb(sh, WOOD, "x"))
    # props: tea tray on the right, book stack on the left, two books on the undertier
    zt = CT_H + 0.0012
    tx, ty = 0.27, -0.01
    tray = _tray("ct_tray")
    for o in tray:
        _xf(o, _T(tx, ty, zt) @ _Rz(-4))
    parts += tray
    zf = zt + 0.0045
    pot = _teapot("ct_teapot")
    for o in pot:
        _xf(o, _T(tx + 0.085, ty + 0.045, zf) @ _Rz(198))
    parts += pot
    for k, (cx, cy, yaw) in enumerate(((-0.135, -0.072, 20.0), (-0.130, 0.078, -35.0))):
        cs = _cup_and_saucer(f"ct_cup{k}")
        for o in cs:
            _xf(o, _T(tx + cx, ty + cy, zf) @ _Rz(yaw))
        parts += cs
    bs, _ = _book_stack("ct", [(0.30, 0.23, 0.036, 9.0), (0.27, 0.19, 0.029, -4.0), (0.23, 0.155, 0.024, 13.0)], -0.33, 0.02, zt)
    parts += bs
    bs, _ = _book_stack("ct_low", [(0.33, 0.25, 0.042, -6.0)], 0.22, 0.0, 0.124, key_offset=1, bands=False)
    parts += bs
    return _join(parts, "Furniture_Table_Coffee_01")


# ---------------------------------------------------------------------------
# Lamp shades and lamps
# ---------------------------------------------------------------------------

def _shade(name, r0, r1, z0, z1, seg=40, pleats=0, amp=0.012, bulge=0.004, key="silk_shade", rim_r=0.0035):
    """Empire shade from radius r0 at z0 (bottom) to r1 at z1: an outer fabric skin (knife-pleated when
    pleats > 0), an inner lining, rolled brass rims hiding both edges. Open at both ends."""
    def r_at(t):
        return r0 + (r1 - r0) * t + bulge * math.sin(math.pi * t)
    ts = [0.0, 0.25, 0.5, 0.75, 1.0]
    bm = bmesh.new()
    n_out = 2 * pleats if pleats else seg
    rings = []
    for t in ts:
        z = z0 + (z1 - z0) * t
        r = r_at(t)
        ring = []
        for j in range(n_out):
            a = math.tau * j / n_out
            rr = r * (1 + (amp if j % 2 == 0 else -amp)) if pleats else r
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        rings.append(ring)
    for A, B in zip(rings, rings[1:]):
        FH._bridge_o(bm, A, B, (0, 0, z0), toward=False, axis=(0, 0, 1))
    outer = FH._finish(bm, name + "_skin", key, 25 if pleats else 50, recalc=False)
    C.uv_cylinder(outer, tex_size(key))
    bm = bmesh.new()
    rings = []
    for t in (0.0, 0.5, 1.0):
        z = z0 + (z1 - z0) * t
        r = r_at(t) * (1 - amp) - 0.002
        rings.append([bm.verts.new((r * math.cos(math.tau * j / seg), r * math.sin(math.tau * j / seg), z)) for j in range(seg)])
    for A, B in zip(rings, rings[1:]):
        FH._bridge_o(bm, A, B, (0, 0, z0), toward=True, axis=(0, 0, 1))
    lining = FH._finish(bm, name + "_lining", key, 50, recalc=False)
    C.uv_cylinder(lining, tex_size(key))
    parts = [outer, lining]
    for r, z in ((r0, z0), (r1, z1)):
        parts.append(C.torus(name + "_rim", r - 0.001, rim_r, (0, 0, z), _mat("brass"), seg, 4))
        C.uv_box(parts[-1], tex_size("brass"))
    return parts


def _bulb(name, z_neck, gr=0.022, seg=14):
    gz = z_neck + 0.008 + gr * 0.77
    prof = [(0.0085, z_neck), (0.0105, z_neck + 0.008)] + \
           [(gr * math.cos(math.radians(a)), gz + gr * math.sin(math.radians(a))) for a in (-40, -10, 20, 50, 75)] + [(0.0, gz + gr)]
    return _turn(name, prof, seg, "bulb", caps=(False, False)), gz


def _spider(name, r_ring, z, z_hub, n=3):
    """Shade spider: n thin spokes from the top rim in to a central washer."""
    parts = []
    for k in range(n):
        a = math.tau * k / n + math.pi / 2
        parts.append(_tube(name + "_spoke", [(math.cos(a) * 0.010, math.sin(a) * 0.010, z_hub),
                                             (math.cos(a) * (r_ring - 0.002), math.sin(a) * (r_ring - 0.002), z)],
                           0.0016, "brass", 5))
    parts.append(_turn(name + "_washer", [(0.0, z_hub - 0.002), (0.012, z_hub - 0.002), (0.012, z_hub + 0.002), (0.0, z_hub + 0.002)],
                       12, "brass"))
    for o in parts:
        if not o.data.uv_layers:
            C.uv_box(o, 0.3)
    return parts


def _harp(name, w, z_saddle, z_top, r=0.0026):
    """Lamp harp: a saddle across the socket and two wires bowing up to the spider washer."""
    parts = [_tube(name + "_saddle", [(-w, 0, z_saddle), (w, 0, z_saddle)], 0.0035, "brass", 6)]
    for sx in (-1, 1):
        h = z_top - z_saddle
        p = [(sx * w, 0, z_saddle), (sx * w * 1.30, 0, z_saddle + 0.30 * h), (sx * w * 1.25, 0, z_saddle + 0.62 * h),
             (sx * w * 0.70, 0, z_saddle + 0.90 * h), (sx * 0.006, 0, z_top)]
        parts.append(_tube(name + "_wire", _catmull(p, 3), r, "brass", 5))
    for o in parts:
        C.uv_box(o, 0.3)
    return parts


def _table_lamp(name):
    """Small brass table lamp: domed base, turned stem with a knop, socket and globe bulb, ivory silk
    empire shade on a harp with a finial. 0.43 m tall; returns (parts, light point)."""
    parts = [_turn(name + "_base", [(0.0, 0.0), (0.064, 0.0), (0.066, 0.004), (0.062, 0.010), (0.054, 0.016), (0.040, 0.026),
                                     (0.030, 0.034), (0.024, 0.040), (0.020, 0.048), (0.024, 0.054), (0.024, 0.060), (0.016, 0.066),
                                     (0.0, 0.066)], 24, "brass")]
    parts.append(_turn(name + "_stem", [(0.0105, 0.064), (0.0105, 0.120), (0.0160, 0.128), (0.0200, 0.140), (0.0160, 0.152),
                                         (0.0095, 0.160), (0.0090, 0.248), (0.0130, 0.255), (0.0130, 0.262), (0.0090, 0.268)],
                       14, "brass", caps=(False, True)))
    parts.append(_turn(name + "_socket", [(0.0, 0.268), (0.0125, 0.268), (0.0130, 0.272), (0.0130, 0.298), (0.0110, 0.302),
                                           (0.0065, 0.304), (0.0, 0.304)], 14, "brass_aged"))
    bulb, gz = _bulb(name + "_bulb", 0.303)
    parts.append(bulb)
    z0, z1 = 0.225, 0.395
    parts += _shade(name + "_shade", 0.118, 0.072, z0, z1, seg=32, rim_r=0.003)
    parts += _harp(name + "_harp", 0.030, 0.272, z1 + 0.001)
    parts += _spider(name + "_spider", 0.072, z1, z1 + 0.001)
    parts.append(_turn(name + "_finial", [(0.0, z1 + 0.003), (0.0075, z1 + 0.003), (0.0095, z1 + 0.008), (0.0065, z1 + 0.014),
                                           (0.0090, z1 + 0.021), (0.0060, z1 + 0.028), (0.0, z1 + 0.031)], 12, "brass"))
    return parts, (0.0, 0.0, gz)


# ---------------------------------------------------------------------------
# Side table: round walnut tripod table (dished top, turned column, snake-foot legs)
# ---------------------------------------------------------------------------

ST_H = 0.60
ST_DISH = 0.596


def _tripod_leg():
    up = [(0.030, 0.272), (0.062, 0.258), (0.100, 0.218), (0.138, 0.152), (0.172, 0.088), (0.198, 0.048), (0.222, 0.030),
          (0.236, 0.022)]
    lo = [(0.236, 0.0), (0.196, 0.0), (0.184, 0.012), (0.150, 0.030), (0.110, 0.060), (0.076, 0.100), (0.050, 0.142),
          (0.030, 0.170)]
    outline = [(p.x, p.y) for p in _catmull(up, 3)] + [(p.x, p.y) for p in _catmull(lo, 3)]
    leg = _extrude("st_leg", outline, -0.016, 0.016, WOOD, "yz", bevel_w=0.006, segs=1)
    # UV along the leg's length (it runs diagonally in YZ): project with grain on the dominant axis
    C.uv_grain_auto(leg, tex_size(WOOD))
    return leg


def build_table_side(item=None):
    """Round walnut tripod table, 0.5 m across and 0.6 m high: dished top with a moulded rim, vase-turned
    column with a drop finial, three snake-foot legs. seed % 2 == 0 carries a small brass table lamp with a
    silk shade (light_points); seed % 2 == 1 a book stack and a cup of tea."""
    seed = getattr(item, "seed", 0) if item is not None else 0
    parts = []
    top = _turn("st_top", [(0.0, 0.574), (0.205, 0.574), (0.222, 0.576), (0.236, 0.580), (0.244, 0.585), (0.249, 0.590),
                           (0.250, 0.595), (0.249, 0.599), (0.246, 0.6015), (0.242, 0.602), (0.238, 0.600), (0.235, 0.597),
                           (0.229, ST_DISH), (0.0, ST_DISH)], 40, WOOD)
    parts.append(top)
    parts.append(_turn("st_cleat", [(0.0, 0.556), (0.080, 0.556), (0.085, 0.560), (0.085, 0.570), (0.080, 0.5745), (0.0, 0.5745)],
                       24, WOOD))
    parts.append(_turn("st_column", [(0.0, 0.062), (0.008, 0.064), (0.015, 0.072), (0.022, 0.084), (0.030, 0.096), (0.040, 0.106),
                                      (0.044, 0.120), (0.044, 0.252), (0.040, 0.262), (0.047, 0.272), (0.047, 0.281), (0.037, 0.291),
                                      (0.030, 0.301), (0.036, 0.316), (0.048, 0.344), (0.050, 0.364), (0.044, 0.388), (0.030, 0.410),
                                      (0.022, 0.438), (0.024, 0.458), (0.030, 0.468), (0.030, 0.476), (0.024, 0.484), (0.0215, 0.518),
                                      (0.028, 0.538), (0.034, 0.550), (0.036, 0.557)], 14, WOOD))
    leg = _tripod_leg()
    for k in range(3):
        parts.append(_xf(_copy(leg), _Rz(k * 120.0)))
    C.remove(leg)
    light = None
    if seed % 2 == 0:
        lp, light = _table_lamp("st_lamp")
        for o in lp:
            _xf(o, _T(0.045, 0.06, ST_DISH))
        parts += lp
        light = (light[0] + 0.045, light[1] + 0.06, light[2] + ST_DISH)
        bs, _ = _book_stack("st", [(0.18, 0.125, 0.022, -20.0)], -0.06, -0.10, ST_DISH, key_offset=2)
        parts += bs
    else:
        bs, _ = _book_stack("st", [(0.24, 0.17, 0.032, 12.0), (0.21, 0.15, 0.026, -10.0)], -0.04, 0.06, ST_DISH, key_offset=1)
        parts += bs
        cs = _cup_and_saucer("st_cup")
        for o in cs:
            _xf(o, _T(0.10, -0.12, ST_DISH) @ _Rz(-30))
        parts += cs
    ob = _join(parts, "Furniture_Table_Side_01" if seed % 2 == 0 else "Furniture_Table_Side_02")
    if light:
        ob["light_points"] = [list(light)]
        ob["light_color"] = "#ffcf94"
    return ob


# ---------------------------------------------------------------------------
# Floor lamp: brass standard with a knife-pleated silk empire shade
# ---------------------------------------------------------------------------

def build_lamp_floor(item=None):
    """Brass standard lamp 1.65 m: weighted moulded base, turned stem with urn and knops, socket with a
    pull chain, a harp carrying a knife-pleated ivory silk empire shade (0.43 m across) and a finial.
    Carries light_points / light_color at the bulb."""
    parts = [_turn("fl_base", [(0.0, 0.0), (0.158, 0.0), (0.165, 0.004), (0.165, 0.012), (0.158, 0.018), (0.150, 0.020),
                                (0.140, 0.024), (0.115, 0.036), (0.085, 0.052), (0.060, 0.060), (0.046, 0.064), (0.040, 0.071),
                                (0.044, 0.078), (0.040, 0.084), (0.030, 0.090), (0.024, 0.096), (0.0, 0.096)], 40, "brass_aged")]
    parts.append(_turn("fl_stem", [(0.020, 0.094), (0.026, 0.108), (0.031, 0.126), (0.026, 0.150), (0.016, 0.170), (0.0120, 0.190),
                                    (0.0115, 0.600), (0.0160, 0.610), (0.0205, 0.624), (0.0205, 0.640), (0.0160, 0.652),
                                    (0.0115, 0.662), (0.0110, 1.100), (0.0150, 1.110), (0.0180, 1.124), (0.0150, 1.138),
                                    (0.0105, 1.148), (0.0105, 1.300)], 16, "brass", caps=(False, True)))
    parts.append(_turn("fl_socket", [(0.0, 1.300), (0.0145, 1.300), (0.0150, 1.305), (0.0150, 1.342), (0.0125, 1.347),
                                      (0.0075, 1.349), (0.0, 1.349)], 16, "brass_aged"))
    bulb, gz = _bulb("fl_bulb", 1.348, gr=0.030, seg=16)
    parts.append(bulb)
    sw = C.cylinder("fl_switch", 0.0026, 0.0026, 0.012, (0.0, -0.0205, 1.322), _mat("brass_aged"), 10, rot=C.rotx(90))
    parts.append(_uvb(sw, "brass_aged", "y"))
    FH._ball_chain(parts, 0.0, -0.0270, 1.318, 1.235, pitch=0.005, seg=5)
    z0, z1 = 1.330, 1.600
    parts += _shade("fl_shade", 0.215, 0.124, z0, z1, seg=56, pleats=44, amp=0.011, bulge=0.006, rim_r=0.0042)
    parts += _harp("fl_harp", 0.050, 1.306, z1 + 0.001, r=0.0030)
    parts += _spider("fl_spider", 0.124, z1, z1 + 0.001)
    parts.append(_turn("fl_finial", [(0.0, z1 + 0.003), (0.0100, z1 + 0.003), (0.0125, z1 + 0.009), (0.0085, z1 + 0.016),
                                      (0.0120, z1 + 0.026), (0.0115, z1 + 0.036), (0.0070, z1 + 0.043), (0.0045, z1 + 0.046),
                                      (0.0, z1 + 0.049)], 14, "brass"))
    ob = _join(parts, "Furniture_Lamp_Floor_01")
    ob["light_points"] = [[0.0, 0.0, round(gz, 4)]]
    ob["light_color"] = "#ffcf94"
    return ob


# ---------------------------------------------------------------------------
# Window seat: built-in panelled walnut seat, fitted cushion, scatter cushions
# ---------------------------------------------------------------------------

WS_W, WS_D = 1.8, 0.6
WS_FACE = -0.27            # front face of the panelled frame
WS_BOARD = (0.37, 0.395)   # seat board
_STICKING = [(0.0, -0.016), (0.012, -0.016), (0.012, -0.012), (0.010, -0.006), (0.0065, -0.002), (0.0025, 0.0), (0.0, 0.0)]


def _panelled_face(prefix, w, z0, z1, n, stile=0.075, rail_b=0.055, rail_t=0.055, t=0.020):
    """A frame-and-panel face in local XZ: the frame's face on y = 0 (room on -Y), x from -w/2 to w/2,
    n raised-and-fielded panels with an ovolo sticking round each opening. Returns the parts."""
    parts = [_bx(prefix + "_rail", (-w / 2, 0.0, z0), (w / 2, t, z0 + rail_b), WOOD, 0.0018, 1, "x"),
             _bx(prefix + "_rail", (-w / 2, 0.0, z1 - rail_t), (w / 2, t, z1), WOOD, 0.0018, 1, "x")]
    mun = stile * 0.85
    inner_w = w - 2 * stile - (n - 1) * mun
    pw = inner_w / n
    zo0, zo1 = z0 + rail_b, z1 - rail_t
    xs = [-w / 2 + stile + k * (pw + mun) for k in range(n)]
    for k in range(n + 1):
        if k == 0:
            a, b = -w / 2, -w / 2 + stile
        elif k == n:
            a, b = w / 2 - stile, w / 2
        else:
            a, b = xs[k] - mun, xs[k]
        parts.append(_bx(prefix + "_stile", (a, 0.0, zo0 - 0.001), (b, t, zo1 + 0.001), WOOD, 0.0018, 1, "z"))
    for x0 in xs:
        x1 = x0 + pw
        cx, cz = (x0 + x1) / 2, (zo0 + zo1) / 2
        hw, hh = pw / 2 + 0.008, (zo1 - zo0) / 2 + 0.008
        # fielded panel (built facing +Z, turned to face -Y): back at y = 0.030, margin 16 mm behind the face
        prof = [(0.0, 0.0), (0.0, 0.014), (0.026, 0.014), (0.058, 0.022), (0.060, 0.024)]
        pan = _slab(prefix + "_panel", _rect(hw, hh), 0.001, prof, 1, WOOD)
        _xf(pan, _T(cx, 0.030, cz) @ _Rx(90))
        parts.append(_uvb(pan, WOOD, "z" if hh > hw else "x"))
        corners = [(x0, 0.0, zo0), (x1, 0.0, zo0), (x1, 0.0, zo1), (x0, 0.0, zo1)]
        st = FH._mitre_loft(prefix + "_sticking", corners, (0, -1, 0), _STICKING, WOOD, 35)
        parts.append(_uvb(st, WOOD))
    return parts


def build_window_seat(item=None):
    """Built-in walnut window seat 1.8 x 0.6 m (back against the wall at y = +0.3): moulded plinth, a
    three-panel raised-and-fielded front and panelled ends, a cove under a bullnosed seat board, a fitted
    piped green velvet cushion (top at 0.46 m) and three scatter cushions leaning on the window apron."""
    parts = []
    hw = WS_W / 2
    xe = hw - 0.02                   # end frames' outer faces
    # plinth with a moulded cap, returned along both ends to the wall
    parts.append(_bx("ws_plinth", (-xe - 0.006, WS_FACE - 0.006, 0.0), (xe + 0.006, WS_D / 2, 0.082), WOOD, 0.002, 1, "x"))
    cap = [(-0.010, 0.0), (0.004, 0.0), (0.004, 0.003), (0.0025, 0.006), (0.0, 0.009), (-0.002, 0.012), (-0.003, 0.016),
           (-0.010, 0.016)]
    parts.append(_ret("ws_plinth_cap", cap, -xe - 0.006, xe + 0.006, WS_FACE - 0.006, WS_D / 2, 0.082, WOOD))
    # front and end faces
    z0, z1 = 0.098, WS_BOARD[0]
    for o in _panelled_face("ws_front", 2 * xe, z0, z1, 3):
        parts.append(_xf(o, _T(0, WS_FACE, 0)))
    depth = WS_D / 2 - (WS_FACE + 0.020)
    for sx in (-1, 1):
        face = _panelled_face("ws_end", depth, z0, z1, 1, stile=0.07)
        yc = (WS_FACE + 0.020 + WS_D / 2) / 2
        for o in face:
            _xf(o, _T(sx * xe, yc, 0) @ _Rz(90 if sx > 0 else -90))
        parts += face
    parts.append(_bx("ws_carcass", (-xe + 0.019, WS_FACE + 0.019, 0.05), (xe - 0.019, WS_D / 2, z1), "walnut_dark"))
    # cove under the seat board, returned to the wall
    cove = [(-0.010, 0.0), (0.0, 0.0)] + [(0.016 - 0.016 * math.cos(math.radians(a)), 0.016 * math.sin(math.radians(a)))
                                         for a in (20, 45, 70)] + [(0.016, 0.016), (-0.010, 0.016)]
    parts.append(_ret("ws_cove", cove, -xe, xe, WS_FACE, WS_D / 2, z1 - 0.016, WOOD))
    # seat board with a bullnose front and ends
    bp = [(0.012, WS_BOARD[0]), (0.004, WS_BOARD[0] + 0.002), (0.0, WS_BOARD[0] + 0.009), (0.0, WS_BOARD[0] + 0.016),
          (0.004, WS_BOARD[1] - 0.002), (0.011, WS_BOARD[1])]
    board = _slab("ws_board", _rect(hw, WS_D / 2), [0.012, 0.012, 0.002, 0.002], bp, 3, WOOD)
    parts.append(_uvb(board, WOOD, "x"))
    # fitted cushion: top at seat height 0.46 m
    cz = WS_BOARD[1]
    cu = _box_cushion("ws_cushion", 2 * hw - 0.03, WS_D - 0.035, 0.46 - cz - 0.010, VELVET, r=0.035, crown=0.010, sag=0.0)
    _xf(cu, _T(0, -0.003, cz))
    parts.append(cu)
    # scatter cushions leaning back on the window apron (the window board's apron stands 22 mm proud of the wall)
    for k, (x, key, size, yaw, lean, roll, fwd) in enumerate(((-0.68, "velvet_burgundy", 0.42, 10.0, 24.0, -3.0, 0.0),
                                                               (-0.44, "fabric_cream", 0.36, -8.0, 14.0, 4.0, 0.12),
                                                               (0.70, "velvet_burgundy", 0.42, -12.0, 23.0, 3.0, 0.0))):
        pil = _pillow(f"ws_pillow{k}", size, size, 0.16, key, pipe_key=("fabric_cream" if "velvet" in key else "velvet_burgundy"))
        up = Vector((0, math.sin(math.radians(lean)), math.cos(math.radians(lean))))
        c = Vector((x, 0.265 - 0.08 * math.cos(math.radians(lean)) - fwd, 0.44 + up.z * size * 0.5))
        _xf(pil, _T(*c) @ _Rz(yaw) @ _Rx(90 - lean) @ _Rz(roll))
        parts.append(pil)
    return _join(parts, "Furniture_WindowSeat_01")


# ---------------------------------------------------------------------------
# Magazine rack: walnut periodicals rack with sloped display tiers
# ---------------------------------------------------------------------------

MR_W, MR_D, MR_H = 1.6, 0.45, 1.4
MR_LEAN = 15.0
_TAN = math.tan(math.radians(MR_LEAN))
MR_XI = MR_W / 2 - 0.028           # inner faces of the end standards
MR_TIERS = (0.10, 0.47, 0.76, 1.05)


def _yp(z):
    """Front surface of the leaning display board at height z."""
    return -0.155 + (z - 0.10) * _TAN


MAGS = [  # (masthead, cover key, ink key, font, art key)
    ("ATLAS", "print_navy", "print_cream", FONT_DIDOT, "print_ochre"),
    ("Folio", "print_cream", "print_red", FONT_CASLON, "print_teal"),
    ("MERIDIAN", "print_teal", "print_cream", FONT_FUTURA, "print_cream"),
    ("The Lantern", "print_ochre", "label_ink", FONT_SERIF_B, "print_navy"),
    ("QUARTO", "print_red", "print_cream", FONT_DIDOT, "print_navy"),
    ("ORBIT", "print_cream", "print_navy", FONT_FUTURA, "print_red"),
    ("VERSO", "print_navy", "print_ochre", FONT_BASK, "print_cream"),
    ("Archive", "print_cream", "label_ink", FONT_SERIF_B, "print_ochre"),
    ("CANVAS", "print_red", "print_cream", FONT_FUTURA, "print_ochre"),
    ("SCIENTIA", "print_teal", "print_cream", FONT_DIDOT, "print_ochre"),
    ("Harbour", "print_cream", "print_teal", FONT_CASLON, "print_navy"),
    ("TEMPO", "print_ochre", "print_cream", FONT_FUTURA, "print_red"),
    ("GROVE", "print_navy", "print_cream", FONT_BASK, "print_teal"),
    ("Prism", "print_cream", "print_red", FONT_SERIF_B, "print_teal"),
    ("COMPASS", "print_red", "print_cream", FONT_DIDOT, "print_cream"),
    ("AURORA", "print_teal", "print_cream", FONT_FUTURA, "print_red"),
    ("Ledger", "print_ochre", "label_ink", FONT_CASLON, "print_cream"),
    ("ECHO", "print_navy", "print_cream", FONT_FUTURA, "print_red"),
]
PAPERS = [("The Evening Courier", FONT_BASK), ("The Varsity Gazette", FONT_SERIF_B), ("The Morning Ledger", FONT_CASLON),
          ("The County Chronicle", FONT_BASK)]


def _magazine(name, spec, rng, W=0.21, H=0.275, T=0.005):
    """A magazine lying in local XY (cover facing +Z, bottom edge on y = 0): coloured cover, masthead,
    an art panel and a few cover lines."""
    title, cover_k, ink_k, font, art_k = spec
    parts = [_bx(name + "_cover", (-W / 2, 0.0, 0.0), (W / 2, H, T), cover_k, 0.0008, 1)]
    zf = T + 0.0003
    mh = _flat_text(name + "_mast", title, 0.052 if len(title) <= 6 else 0.040, ink_k, font, max_w=W - 0.03)
    _xf(mh, _T(0, H - 0.040, zf))
    parts.append(mh)
    style = rng.randrange(3)
    if style == 0:          # framed picture panel
        parts.append(_bx(name + "_art", (-W / 2 + 0.018, 0.045, T), (W / 2 - 0.018, H - 0.075, zf), art_k))
    elif style == 1:        # full-bleed lower art band
        parts.append(_bx(name + "_art", (-W / 2 + 0.0005, 0.0, T), (W / 2 - 0.0005, H * 0.55, zf), art_k))
    else:                   # disc emblem
        parts.append(_xf(C.cylinder(name + "_art", 0.058, 0.058, 0.0004, (0, 0, 0), _mat(art_k), 24), _T(0, H * 0.42, zf - 0.0002)))
    ink = "label_ink" if cover_k in ("print_cream", "print_ochre") else "print_cream"
    for k in range(2):      # cover lines
        wl = rng.uniform(0.07, 0.12)
        y = 0.020 + k * 0.011
        parts.append(_bx(name + "_line", (-W / 2 + 0.016, y, T), (-W / 2 + 0.016 + wl, y + 0.0045, zf + 0.0004), ink))
    return parts


def _newspaper(name, title, font, rng, W=0.30, H=0.34, T=0.007):
    """A folded broadsheet lying in local XY (front page facing +Z, fold at y = 0): masthead, rules, a
    headline, a photo and columns of text."""
    parts = [_bx(name + "_sheet", (-W / 2, 0.0, 0.0), (W / 2, H, T), "newsprint", 0.0012, 1)]
    zf = T + 0.0003
    mh = _flat_text(name + "_mast", title, 0.036, "label_ink", font, max_w=W - 0.03)
    _xf(mh, _T(0, H - 0.030, zf))
    parts.append(mh)
    for y in (H - 0.052, H - 0.058):
        parts.append(_bx(name + "_rule", (-W / 2 + 0.012, y, T), (W / 2 - 0.012, y + 0.0012, zf), "label_ink"))
    for k, wl in enumerate((rng.uniform(0.20, 0.26), rng.uniform(0.12, 0.2))):      # two-deck headline
        y = H - 0.074 - k * 0.013
        parts.append(_bx(name + "_head", (-wl / 2, y, T), (wl / 2, y + 0.008, zf), "label_ink"))
    parts.append(_bx(name + "_photo", (-W / 2 + 0.012, H - 0.20, T), (0.02, H - 0.098, zf), "news_photo"))
    col_w = (W - 0.024 - 0.008 * 2) / 3
    for c in range(3):
        x0 = -W / 2 + 0.012 + c * (col_w + 0.008)
        ytop = H - 0.098 if c == 2 else H - 0.208
        y = ytop
        while y > 0.018:
            y1 = max(0.018, y - rng.uniform(0.05, 0.10))
            parts.append(_bx(name + "_col", (x0, y1, T), (x0 + col_w, y, zf - 0.0001), "news_grey"))
            y = y1 - 0.007
    return parts


def build_magazine_rack(item=None):
    """Walnut periodicals rack 1.6 x 0.45 x 1.4 m against a wall (back on y = +0.225): moulded end
    standards with sunk bead panels and a centre divider, a display board leaning back 15 degrees, four
    lipped ledges (newspapers on the lowest, three tiers of magazines above), a plinth and a top cap with
    a brass PERIODICALS plaque."""
    rng = random.Random(42)
    parts = []
    yb = MR_D / 2
    # end standards and the centre divider
    def standard(x0, x1, inset):
        front = [(max(-MR_D / 2, _yp(z) - 0.075 + inset), z) for z in (0.0, 0.10, 0.45, 0.80, 1.15, 1.30)]
        top = [(front[-1][0] + 0.004, 1.345), (front[-1][0] + 0.020, 1.380), (front[-1][0] + 0.048, 1.398), (front[-1][0] + 0.075, MR_H)]
        outline = [(yb, 0.0), (yb, MR_H)] + list(reversed([(p.x, p.y) for p in _catmull(front[-1:] + top, 3)][1:])) + \
                  list(reversed(front))
        ob = _extrude("mr_standard", outline, x0, x1, WOOD, "yz", bevel_w=0.004, segs=1)
        return _uvb(ob, WOOD, "z")
    for sx in (-1, 1):
        parts.append(standard(sx * MR_XI, sx * MR_W / 2, 0.0))
        # sunk-panel bead on the outer face
        x = sx * MR_W / 2
        ya, yb2 = _yp(0.20) - 0.075 + 0.055, yb - 0.045
        pts = [(ya, 0.20), (yb2, 0.20), (yb2, 1.24), (_yp(1.24) - 0.075 + 0.055, 1.24)]
        if sx < 0:
            pts = list(reversed(pts))
        bead = [(-0.0040, 0.0), (-0.0035, 0.0020), (-0.0020, 0.0035), (0.0, 0.0040), (0.0020, 0.0035), (0.0035, 0.0020),
                (0.0040, 0.0), (0.0040, -0.0020), (-0.0040, -0.0020)]
        bd = FH._mitre_loft("mr_bead", [(x, y, z) for y, z in pts], (sx, 0, 0), bead, WOOD, 50)
        parts.append(_uvb(bd, WOOD, "z"))
    parts.append(standard(-0.012, 0.012, 0.004))
    # plinth (recessed kick) and back panel
    parts.append(_bx("mr_plinth", (-MR_XI - 0.001, -0.200, 0.0), (MR_XI + 0.001, yb - 0.01, 0.082), WOOD, 0.002, 1, "x"))
    parts.append(_bx("mr_back", (-MR_XI - 0.001, yb - 0.014, 0.08), (MR_XI + 0.001, yb, 1.37), "walnut_dark", 0.0, 1, "z"))
    # leaning display board
    th = 0.016 / math.cos(math.radians(MR_LEAN))
    zt = 1.37
    board = [(_yp(0.082), 0.082), (_yp(0.082) + th, 0.082), (_yp(zt) + th, zt), (_yp(zt), zt)]
    parts.append(_uvb(_extrude("mr_board", board, -MR_XI - 0.001, MR_XI + 0.001, WOOD, "yz"), WOOD, "z"))
    # ledges with a rounded lip
    for zl in MR_TIERS:
        y0 = _yp(zl)
        yf = y0 - 0.065
        led = [(y0 + 0.004, zl - 0.018), (y0 + 0.004, zl), (yf + 0.012, zl), (yf + 0.012, zl + 0.020), (yf + 0.0105, zl + 0.0235),
               (yf + 0.006, zl + 0.0255), (yf + 0.0015, zl + 0.0235), (yf, zl + 0.020), (yf, zl - 0.014), (yf + 0.004, zl - 0.018)]
        parts.append(_uvb(_extrude("mr_ledge", led, -MR_XI - 0.001, MR_XI + 0.001, WOOD, "yz", bevel_w=0.0015, segs=1), WOOD, "x"))
    # top cap with a moulded front edge, and the brass plaque
    y_cap = _yp(zt) - 0.012
    cap_prof = [(0.010, zt), (0.0, zt + 0.004), (0.0, zt + 0.014), (0.004, zt + 0.020), (0.010, zt + 0.022)]
    cap = _slab("mr_cap", _rect(MR_XI + 0.001, (yb - y_cap) / 2, 0, (yb + y_cap) / 2), 0.002, cap_prof, 1, WOOD)
    parts.append(_uvb(cap, WOOD, "x"))
    # brass PERIODICALS plaque on the leaning board above the top tier (built facing +Z, laid on the board)
    zc = 1.348
    M = _T(0, _yp(zc), zc) @ _Rx(90 - MR_LEAN) @ _T(0, 0, -0.0005)
    pl = _slab("mr_plaque", _rect(0.14, 0.016), 0.003, [(0.0, 0.0), (0.0, 0.0018), (0.0015, 0.0032)], 2, "brass")
    parts.append(_uvb(_xf(pl, M), "brass"))
    txt = _flat_text("mr_plaque_txt", "PERIODICALS", 0.019, "label_ink", FONT_SERIF_B, max_w=0.25, spacing=1.2)
    parts.append(_xf(txt, M @ _T(0, -0.001, 0.0034)))
    # newspapers on the lowest ledge, magazines on the three tiers above
    bays = [(-MR_XI, -0.012), (0.012, MR_XI)]
    tilt = _Rx(90 - MR_LEAN)
    k = 0
    for bi, (bx0, bx1) in enumerate(bays):
        gap = ((bx1 - bx0) - 2 * 0.30) / 3
        for j in range(2):
            title, font = PAPERS[bi * 2 + j]
            x = bx0 + gap + 0.15 + j * (0.30 + gap)
            zl = MR_TIERS[0]
            for o in _newspaper(f"mr_paper{bi}{j}", title, font, rng):
                _xf(o, _T(x, _yp(zl) - 0.0015, zl) @ tilt)
                parts.append(o)
    for ti, zl in enumerate(MR_TIERS[1:]):
        for bi, (bx0, bx1) in enumerate(bays):
            gap = ((bx1 - bx0) - 3 * 0.21) / 4
            for j in range(3):
                spec = MAGS[k % len(MAGS)]
                k += 1
                x = bx0 + gap + 0.105 + j * (0.21 + gap) + rng.uniform(-0.006, 0.006)
                for o in _magazine(f"mr_mag{k}", spec, rng):
                    _xf(o, _T(x, _yp(zl) - 0.0015, zl) @ tilt @ _Rz(rng.uniform(-0.8, 0.8)))
                    parts.append(o)
    return _join(parts, "Furniture_MagazineRack_01")


# ---------------------------------------------------------------------------
# Registry and preview
# ---------------------------------------------------------------------------

KIND_BUILDERS = {
    "fireplace": build_fireplace,
    "sofa_chesterfield": build_sofa_chesterfield,
    "armchair_club": build_armchair_club,
    "table_coffee": build_table_coffee,
    "table_side": build_table_side,
    "lamp_floor": build_lamp_floor,
    "window_seat": build_window_seat,
    "magazine_rack": build_magazine_rack,
}


def _studio(objs, size=(960, 960), samples=48):
    scene = bpy.context.scene
    R.engine(scene, "EEVEE", samples, size)
    lo, hi = R.bounds(objs)
    R.studio(scene, ((lo + hi) / 2).to_tuple(), max(0.5, (hi - lo).length / 2))
    return R.camera(lens=50)


def _shot(path, target, yaw, pitch, dist, lens=50):
    cam = R.camera(lens=lens)
    y, p = math.radians(yaw), math.radians(pitch)
    t = Vector(target)
    loc = t + Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist
    R.look(cam, loc, t)
    return R.render(path)


class _Item:
    def __init__(self, seed=0):
        self.seed, self.label, self.w, self.d = seed, "", None, None


def _place_local(ob, x, y, yaw):
    ob.matrix_world = Matrix.Translation((x, y, 0.0)) @ Matrix.Rotation(math.radians(yaw), 4, "Z")
    for ch in ob.children:
        ch.matrix_parent_inverse = Matrix.Identity(4)
    return ob


def _vignette(out_dir, tri):
    """Cycles vignette: the fire lit in the chimneypiece, a leather club chair and a velvet wingback angled
    to the hearth, a side table with its lamp and a floor lamp, on the Persian rug over oak boards."""
    C.reset_scene()
    scene = bpy.context.scene
    fp = build_fireplace()
    _place_local(fp, 0.0, 0.0, 0.0)
    club = _place_local(build_armchair_club(_Item(0)), -1.62, -1.38, 60.0)
    wing = _place_local(build_armchair_club(_Item(1)), 1.62, -1.38, -60.0)
    side = _place_local(build_table_side(_Item(0)), -2.50, -0.45, 0.0)
    lamp = _place_local(build_lamp_floor(), 2.50, -0.40, 0.0)
    coffee = _place_local(build_table_coffee(), 0.0, -2.35, 0.0)
    # room: oak boards, plaster wall with a walnut skirting, the rug
    me = bpy.data.meshes.new("V_Floor")
    me.from_pydata([(-4.5, -5.5, 0), (4.5, -5.5, 0), (4.5, 0.375, 0), (-4.5, 0.375, 0)], [], [(0, 1, 2, 3)])
    floor = bpy.data.objects.new("V_Floor", me)
    C.link(floor)
    me.materials.append(_mat("oak_boards"))
    C.uv_box(floor, tex_size("oak_boards"), "x")
    wall = C.box_minmax("V_Wall", (-4.5, FP_WALL, 0.0), (4.5, FP_WALL + 0.2, 3.6), _mat("plaster_green"))
    C.uv_box(wall, tex_size("plaster_green"))
    for sx in (-1, 1):
        sk = _bx("V_Skirting", (sx * 1.31, FP_WALL - 0.022, 0.0), (sx * 4.5, FP_WALL, 0.20), "walnut", 0.003, 1, "x")
        sk.name = "V_Skirting"
    rug = C.box_minmax("V_Rug", (-1.9, -3.55, 0.0), (1.9, -0.42, 0.010), _mat("rug_persian"), 0.004, 1)
    uv = rug.data.uv_layers.new(name="UVMap") if not rug.data.uv_layers else rug.data.uv_layers.active
    for poly in rug.data.polygons:
        for li in poly.loop_indices:
            co = rug.data.vertices[rug.data.loops[li].vertex_index].co
            uv.data[li].uv = ((co.x + 1.9) / 3.8, (co.y + 3.55) / 3.13)
    for o in (fp, club, wing, side, lamp, coffee):
        tri[o.name] = tri.get(o.name, C.tris(o) + sum(C.tris(c) for c in o.children))
    R.engine(scene, "CYCLES", 48, (960, 600))
    scene.cycles.max_bounces = 6
    R.world(scene, (0.20, 0.24, 0.32), 0.18)
    # the fire, the lamps, a cool window fill from the left
    for o in (fp, side, lamp):
        for p in o.get("light_points", []):
            loc = o.matrix_world @ Vector(p)
            if o is fp:
                R.point_light("V_Fire", loc, 70.0, (1.0, 0.50, 0.18), 0.2)
            else:
                R.point_light("V_Lamp", loc, 22.0 if o is side else 40.0, (1.0, 0.78, 0.52), 0.03)
    for lt in (R.area_light("V_Window", (-4.2, -2.6, 2.4), (0.0, -1.0, 0.8), 260.0, 2.2, (0.70, 0.80, 1.0)),
               R.area_light("V_Bounce", (0.6, -5.4, 2.8), (0.0, -0.6, 1.0), 60.0, 3.0, (1.0, 0.86, 0.7))):
        lt.visible_glossy = False
    cam = R.camera(lens=27)
    R.look(cam, (0.2, -5.8, 1.58), (-0.08, -0.75, 0.92))
    R.render(os.path.join(out_dir, "vignette.png"))
    cam.data.lens = 45
    R.look(cam, (-0.95, -2.65, 1.05), (0.15, -0.05, 0.62))
    R.render(os.path.join(out_dir, "vignette_fire.png"))


def preview(out_dir, only=None):
    tri = {}
    which = (only or os.environ.get("LOUNGE_ONLY", "all")).split(",")
    every = "all" in which

    def want(k):
        return every or k in which
    if want("sofa"):
        C.reset_scene()
        ob = build_sofa_chesterfield()
        tri[ob.name] = C.tris(ob)
        _studio([ob])
        _shot(os.path.join(out_dir, "sofa_1.png"), (0, 0, 0.42), 28, 16, 3.6, 50)
        _shot(os.path.join(out_dir, "sofa_2.png"), (0, 0, 0.42), -38, 26, 3.6, 50)
        _shot(os.path.join(out_dir, "sofa_3.png"), (0, 0, 0.42), 160, 14, 3.6, 50)
        _shot(os.path.join(out_dir, "sofa_tufting.png"), (-0.3, 0.2, 0.56), 8, 18, 1.3, 50)
        _shot(os.path.join(out_dir, "sofa_arm.png"), (-1.0, -0.45, 0.55), -32, 10, 1.0, 50)
    if want("chairs"):
        for nm, fn in (("club", build_armchair_leather), ("wing", build_armchair_wingback)):
            C.reset_scene()
            ob = fn()
            tri[ob.name] = C.tris(ob)
            _studio([ob])
            _shot(os.path.join(out_dir, f"{nm}_1.png"), (0, 0, 0.46), 30, 14, 2.6, 50)
            _shot(os.path.join(out_dir, f"{nm}_2.png"), (0, 0, 0.46), -40, 24, 2.6, 50)
            _shot(os.path.join(out_dir, f"{nm}_3.png"), (0, 0, 0.46), 145, 12, 2.6, 50)
    if want("fire"):
        C.reset_scene()
        ob = build_fireplace()
        objs = [ob] + list(ob.children)
        tri[ob.name] = sum(C.tris(o) for o in objs)
        _studio(objs)
        _shot(os.path.join(out_dir, "fire_1.png"), (0, 0, 1.15), 22, 10, 5.4, 50)
        _shot(os.path.join(out_dir, "fire_front.png"), (0, 0, 1.2), 0, 2, 5.2, 50)
        _shot(os.path.join(out_dir, "fire_console.png"), (0.93, 0.0, 1.12), 38, 8, 1.05, 50)
        _shot(os.path.join(out_dir, "fire_box.png"), (0, 0.12, 0.38), 14, 12, 1.7, 50)
        _shot(os.path.join(out_dir, "fire_tools.png"), (0.95, -0.15, 0.36), -30, 16, 1.3, 50)
        _shot(os.path.join(out_dir, "fire_mirror.png"), (0, 0.2, 1.95), 18, 6, 2.1, 50)
    if want("coffee"):
        C.reset_scene()
        ob = build_table_coffee()
        tri[ob.name] = C.tris(ob)
        _studio([ob])
        _shot(os.path.join(out_dir, "coffee_1.png"), (0, 0, 0.30), 30, 24, 2.4, 50)
        _shot(os.path.join(out_dir, "coffee_2.png"), (0, 0, 0.30), -140, 18, 2.4, 50)
        _shot(os.path.join(out_dir, "coffee_tea.png"), (0.27, -0.01, 0.50), 20, 34, 0.75, 50)
        _shot(os.path.join(out_dir, "coffee_leg.png"), (-0.56, -0.28, 0.24), 28, 6, 0.75, 50)
    if want("side"):
        for s in (0, 1):
            C.reset_scene()
            ob = build_table_side(_Item(s))
            tri[ob.name] = C.tris(ob)
            _studio([ob])
            _shot(os.path.join(out_dir, f"side{s}_1.png"), (0, 0, 0.5 if s == 0 else 0.34), 28, 16, 2.0 if s == 0 else 1.6, 50)
            _shot(os.path.join(out_dir, f"side{s}_2.png"), (0, 0, 0.5 if s == 0 else 0.34), -120, 22, 2.0 if s == 0 else 1.6, 50)
    if want("lamp"):
        C.reset_scene()
        ob = build_lamp_floor()
        tri[ob.name] = C.tris(ob)
        _studio([ob])
        _shot(os.path.join(out_dir, "lamp_1.png"), (0, 0, 0.84), 25, 8, 3.4, 50)
        _shot(os.path.join(out_dir, "lamp_shade.png"), (0, 0, 1.44), 20, 4, 1.0, 50)
        _shot(os.path.join(out_dir, "lamp_under.png"), (0, 0, 1.36), 30, -30, 0.7, 50)
        _shot(os.path.join(out_dir, "lamp_base.png"), (0, 0, 0.12), 25, 26, 0.75, 50)
    if want("seat"):
        C.reset_scene()
        ob = build_window_seat()
        tri[ob.name] = C.tris(ob)
        _studio([ob])
        _shot(os.path.join(out_dir, "seat_1.png"), (0, 0, 0.36), 26, 16, 3.0, 50)
        _shot(os.path.join(out_dir, "seat_2.png"), (0, 0, 0.36), -50, 26, 3.0, 50)
        _shot(os.path.join(out_dir, "seat_panel.png"), (0.55, -0.27, 0.24), 22, 8, 0.85, 50)
    if want("rack"):
        C.reset_scene()
        ob = build_magazine_rack()
        tri[ob.name] = C.tris(ob)
        _studio([ob])
        _shot(os.path.join(out_dir, "rack_1.png"), (0, 0, 0.72), 22, 14, 3.4, 50)
        _shot(os.path.join(out_dir, "rack_2.png"), (0, 0, 0.72), -42, 10, 3.4, 50)
        _shot(os.path.join(out_dir, "rack_mags.png"), (0.4, -0.05, 0.98), 10, 22, 1.1, 50)
        _shot(os.path.join(out_dir, "rack_papers.png"), (-0.4, -0.15, 0.30), -8, 40, 1.0, 50)
    if want("vignette"):
        _vignette(out_dir, tri)
    for k, v in tri.items():
        print(f"TRIS {k}: {v}")
