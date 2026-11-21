"""
Study furniture for the quiet study, the group study rooms, the hall and its gallery (milestone 2).

KIND_BUILDERS (plan.KINDS sizes). Each builder(item) returns ONE joined multi-material mesh at the origin,
floor at z = 0, front (where the person sits or stands) facing Blender -Y:

  carrel             1.10 x 0.66 x 1.35 study carrel. Two walnut gables (frame-and-panel, an S-curved top that
                     sweeps down to the knee, an arched cut between the feet) with recessed green acoustic fabric
                     panels above the desk and recessed walnut panels below; an oak work top with a moulded edge
                     and a brass cable grommet (notched lid); a front apron with a pencil drawer and brass knob; a
                     framed back panel (fabric pinboard between desk and shelf); a hutch shelf with a moulded cap
                     and a row of books with a brass bookend; under the shelf an integrated green cased-glass
                     trough lamp (brass saddles, drop rods, rosettes, a tubular lamp) that carries light_points and
                     the banker lamp's glow-material props; a brass power strip (two sockets, USB-C, USB-A and an
                     amber pilot light) on the back rail. item.seed picks the student's things on the desk:
                     0 closed book + pen pot, 1 open laptop + pen pot, 2 open book + notebook + pencil,
                     3 stack of books + pen pot.
  desk_quiet         1.60 x 0.80 x 0.76 twin-pedestal writing desk: moulded walnut top with a green leather
                     inlay and a gilt tooled line, three graduated cock-beaded drawers per pedestal and a frieze
                     drawer over the knee-hole, brass bail pulls and escutcheon, panelled sides and back, moulded
                     plinths.
  table_group_rect   2.40 x 1.20 x 0.76 oak group table on four turned legs with a beaded apron and turned end
                     stretchers; two flush brass power/USB modules (furn_hall's grommet) on the centre line, a
                     cable tray under the top and an oak-clad cable riser to a brass floor box.
  table_group_round  1.50 diameter x 0.76 oak pedestal table: turned column on four out-swept feet with brass
                     cups, a cross bearer, a flush round brass power/USB module at the centre; the cable runs down
                     the column to a brass floor box.
  whiteboard_wall    2.00 x 0.06 x 1.25 (back on y = 0, bottom edge at 0.85): moulded walnut frame, white
                     writing surface, a walnut marker tray with four markers and a felt eraser, brass corner
                     rosettes. Custom prop board_surface = [x0, z0, x1, z1] (local, the drawable white rectangle,
                     its plane at y = board_surface_y).
  screen_wall        1.60 x 0.08 x 0.92 (back on y = 0, bottom edge at 1.35): slim display, thin bezel, aluminium
                     edge, wall bracket, pilot light. Custom prop screen_surface = [x0, z0, x1, z1] (plane at
                     y = screen_surface_y), dim "screen" material.
  gallery_desk       1.20 x 0.60 x 0.76 walnut gallery reading desk: turned legs on brass cups, turned
                     H-stretcher, apron with a drawer, a gently sloped reading top (leather inlay, gilt line) with a
                     moulded book-rest lip and a level pen ledge with a groove at the back.
  catalogue_cabinet  1.40 x 0.60 x 1.15 card catalogue: walnut case (panelled sides, moulded base and cornice) on
                     a stand with turned legs and an H-stretcher; 40 honey-oak card drawers in a face frame, each
                     with a brass label holder (inked card), a brass ring pull on a rosette and a rod nut; one
                     drawer pulled out to show its index cards, tabbed guide cards and brass rod.

preview(out_dir) builds everything and renders studio views and close-ups (EEVEE) plus Cycles room vignettes;
smaller entry points: preview_carrel, preview_desks, preview_tables, preview_boards, preview_catalogue,
preview_rooms (pass them as --func to run_asset.py).
"""

from __future__ import annotations

import math
import os
import random

import bmesh
import bpy
from mathutils import Vector

import furn_hall as FH
import lib_core as C
import lib_materials as LM
import lib_render as R
from lib_materials import tex_size

# ---------------------------------------------------------------------------
# Palette additions (only what the shared palette lacks)
# ---------------------------------------------------------------------------
# Whiteboard marker caps (the black one uses plastic_dark) and a navy book cloth for desk props.
LM.PALETTE.setdefault("marker_red", dict(base="#a32420", rough=0.32))
LM.PALETTE.setdefault("marker_blue", dict(base="#1d3f93", rough=0.32))
LM.PALETTE.setdefault("cloth_navy", dict(base="#1f2a44", rough=0.62))

_mat = FH._mat
_T, _Rx, _Ry, _Rz = FH._T, FH._Rx, FH._Ry, FH._Rz
_xf, _bx, _uvb, _turn, _slab, _rect, _rpoly = FH._xf, FH._bx, FH._uvb, FH._turn, FH._slab, FH._rect, FH._rpoly
_copy, _extrude, _mitre_loft, _tube, _catmull = FH._copy, FH._extrude, FH._mitre_loft, FH._tube, FH._catmull
_cap, _finish, _bridge, _bridge_o, _ngon, _circle, _loft = (FH._cap, FH._finish, FH._bridge, FH._bridge_o, FH._ngon,
                                                           FH._circle, FH._loft)
BULB_COLOR = FH.BULB_COLOR
D2R = math.radians


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _join(parts, name):
    return FH._join([p for p in parts if p is not None], name)


def _offset(pts, d):
    """Mitred inward offset of a closed CCW 2D polygon (negative d grows it)."""
    P = [Vector(p[:2]) for p in pts]
    n = len(P)
    out = []
    for i in range(n):
        e1 = (P[i] - P[i - 1]).normalized()
        e2 = (P[(i + 1) % n] - P[i]).normalized()
        n1, n2 = Vector((-e1.y, e1.x)), Vector((-e2.y, e2.x))
        m = (n1 + n2) / (1 + n1.dot(n2))
        out.append(P[i] + m * d)
    return out


def _plate(name, outer, holes, a0, a1, key, plane="xz", bevel_w=0.0, segs=1, grain=None):
    """A board between a0 and a1 along the plane's normal (xz: Y, yz: X, xy: Z), outline `outer`
    (2D, CCW) with through `holes`: frames, stiles-and-rails, face frames. Closed and manifold."""
    def V(p, a):
        if plane == "xz":
            return (p[0], a, p[1])
        if plane == "yz":
            return (a, p[0], p[1])
        return (p[0], p[1], a)

    ax = {"xz": Vector((0, 1, 0)), "yz": Vector((1, 0, 0)), "xy": Vector((0, 0, 1))}[plane]
    s = 1.0 if a1 > a0 else -1.0
    bm = bmesh.new()
    F = [bm.verts.new(V(p, a0)) for p in outer]
    B = [bm.verts.new(V(p, a1)) for p in outer]
    HF = [[bm.verts.new(V(p, a0)) for p in h] for h in holes]
    HB = [[bm.verts.new(V(p, a1)) for p in h] for h in holes]
    _cap(bm, [F] + HF, -ax * s)
    _cap(bm, [B] + HB, ax * s)
    for A, Bb in [(F, B)] + list(zip(HF, HB)):
        _bridge(bm, A, Bb)
    ob = _finish(bm, name, key, 30, recalc=True)
    if bevel_w > 0:
        C.bevel(ob, bevel_w, segs)
    return _uvb(ob, key, grain)


def _panel(name, hole, a0, a1, key, grain=None, grow=0.002, bevel_w=0.0):
    """A panel filling `hole`, grown `grow` into the surrounding frame (its edges are buried)."""
    return _plate(name, _offset(hole, -grow), [], a0, a1, key, _panel.plane, bevel_w, 1, grain)


_panel.plane = "xz"


def _panel_in(name, hole, a0, a1, key, plane, grain=None, bevel_w=0.0):
    _panel.plane = plane
    return _panel(name, hole, a0, a1, key, grain, bevel_w=bevel_w)


def _rr(hw, hh, cx=0.0, cy=0.0):
    return [(cx - hw, cy - hh), (cx + hw, cy - hh), (cx + hw, cy + hh), (cx - hw, cy + hh)]


def _top(name, hw, hl, z1, thick, key, radius=0.012, rr=0.008, grain="x", cy=0.0, cx=0.0, cutters=(), seg=4):
    """A moulded top: eased underside, straight edge band and a thumbnail round-over."""
    z0 = z1 - thick
    u = min(0.008, thick * 0.3)
    prof = [(u, z0), (u * 0.35, z0 + u * 0.4), (0.0, z0 + u), (0.0, z1 - rr)]
    for k in range(1, 5):
        t = D2R(22.5 * k)
        prof.append((rr - rr * math.cos(t), z1 - rr + rr * math.sin(t)))
    ob = _slab(name, _rect(hw, hl, cx, cy), radius, prof, seg, key)
    if cutters:
        FH._boolean(ob, list(cutters))
    _uvb(ob, key, grain)
    C.weighted_normals(ob)
    return ob


def _leg(name, profile, hw, zb0, zb1, key, seg=16, cup=None, fillet=0.0015, cup_seg=20):
    """Turned leg: lathe profile from z = 0 (or the top of a brass cup) up to zb0, under a square block
    (hw) that takes the apron. cup = (r, h): a brass cup foot."""
    parts = []
    if cup:
        r, h = cup
        parts.append(_turn(name + "_cup", [(r - 0.003, 0.0), (r, 0.0015), (r + 0.0012, 0.004), (r + 0.0012, h - 0.004),
                                             (r + 0.003, h - 0.0015), (r + 0.003, h), (r - 0.004, h)],
                           cup_seg, "brass_aged", caps=(True, True)))
    t = _turn(name + "_turn", profile, seg, key, fillet=fillet, caps=(not cup, False), smooth=40)
    parts.append(t)
    parts.append(_bx(name + "_block", (-hw, -hw, zb0), (hw, hw, zb1), key, 0.003, 2, "z"))
    return _join(parts, name)


def _knob(name, r=0.011, h=0.022, key="brass"):
    """Turned brass knob along +Z from its rose (z = 0)."""
    return _turn(name, [(r * 0.75, 0.0), (r * 0.8, 0.0015), (r * 0.42, 0.004), (r * 0.36, h * 0.42), (r * 0.62, h * 0.56),
                        (r * 0.95, h * 0.72), (r, h * 0.84), (r * 0.82, h * 0.96), (r * 0.4, h), (0.0, h)],
                 12, key, caps=(True, False))


def _bail_pull(w=0.076):
    """Brass bail pull facing -Y, centred at the origin on the y = 0 face: a moulded back plate, two
    turned bosses and a hanging D bail."""
    parts = []
    plate = _slab("bp_plate", _rect(w / 2, 0.0135), 0.009, [(0.0, 0.0), (0.0, 0.0012), (0.0012, 0.0024), (0.0035, 0.003)],
                  2, "brass")
    _xf(plate, _Rx(90))
    parts.append(_uvb(plate, "brass", "x"))
    xb = w / 2 - 0.011
    boss = _turn("bp_boss", [(0.0048, 0.0), (0.0042, 0.003), (0.0030, 0.006), (0.0040, 0.0085), (0.0036, 0.0115),
                             (0.0018, 0.0128), (0.0, 0.013)], 8, "brass", caps=(False, False))
    for sx in (-1, 1):
        b = _copy(boss)
        _xf(b, _T(sx * xb, -0.003, 0.004) @ _Rx(90))
        parts.append(b)
    C.remove(boss)
    pts = []
    n = 8
    for k in range(n + 1):
        a = math.pi * k / n
        pts.append((xb * math.cos(a), -0.0145 + 0.0035 * math.sin(a), 0.004 - 0.026 * math.sin(a) ** 0.85))
    pts = [(xb + 0.0002, -0.0125, 0.0042)] + pts + [(-xb - 0.0002, -0.0125, 0.0042)]
    parts.append(_tube("bp_bail", pts, 0.0026, "brass", 6))
    return _join(parts, "bail_pull")


def _escutcheon():
    plate = _turn("esc", [(0.0, 0.0), (0.0115, 0.0), (0.0118, 0.0008), (0.0095, 0.0022), (0.0, 0.0024)], 14, "brass",
                  caps=(False, False))
    _xf(plate, _Rx(90))
    hole = _plate("esc_hole", [(-0.0018, -0.006), (0.0018, -0.006), (0.0018, 0.0), (0.0032, 0.0028), (0.0, 0.0048),
                               (-0.0032, 0.0028), (-0.0018, 0.0)], [], -0.0026, -0.0022, "iron", "xz")
    return _join([plate, hole], "escutcheon")


def _power_face(name, outline, socks, usbs, flange=True, depth=0.012, sock_hw=0.0205, ins_r=0.0172, pin_dx=0.0095,
                led=None):
    """A brass power module, face up (+Z). outline(d) -> ring of 2D points offset inward by d.
    flange=True: flush module, a 2 mm flange sitting on a surface at z = 0 over a pocket; else a surface-
    mounted housing (face at z = 0, back open at -depth). socks [(x, y)], usbs [(x, y, hw, hh)].
    After furn_hall's grommet: socket recesses with a dark insert, round well and pin holes, USB slots."""
    bm = bmesh.new()
    up = Vector((0, 0, 1))

    def ring(pts2, z):
        return [bm.verts.new((p[0], p[1], z)) for p in pts2]

    if flange:
        zt = 0.002
        prof = [(0.0, 0.0), (0.0, 0.0007), (0.0012, 0.0016), (0.0032, zt)]
    else:
        zt = 0.0
        prof = [(0.0, -depth), (0.0, -0.0024), (0.0007, -0.0008), (0.0024, 0.0)]
    rings = [ring(outline(d), z) for d, z in prof]
    for A, B in zip(rings, rings[1:]):
        _bridge_o(bm, A, B, (0, 0, -0.05), toward=False)
    z_ins, z_fl = zt - 0.0015, zt - 0.0085
    socks_l = [ring(_rpoly(_rect(sock_hw, sock_hw, x, y), sock_hw * 0.29, 0, 3), zt) for x, y in socks]
    usbs_l = [ring(_rpoly(_rect(hw, hh, x, y), min(hw, hh) * 0.85, 0, 2), zt) for x, y, hw, hh in usbs]
    leds = []
    if led:
        leds = [ring(_circle(0.0018, 10, led[0], led[1]), zt)]
    _cap(bm, [rings[-1]] + socks_l + usbs_l + leds, up)
    for (x, y), top in zip(socks, socks_l):
        low = [bm.verts.new((v.co.x, v.co.y, z_ins)) for v in top]
        _bridge_o(bm, top, low, (x, y, zt))
        c_in = ring(_circle(ins_r, 28, x, y), z_ins)
        _cap(bm, [low, c_in], up, 1)
        c_fl = ring(_circle(ins_r, 28, x, y), z_fl)
        _bridge_o(bm, c_in, c_fl, (x, y, z_ins), mi=1)
        pins = [ring(_circle(0.0021, 8, x + dx, y), z_fl) for dx in (-pin_dx, pin_dx)]
        _cap(bm, [c_fl] + pins, up, 1)
        for dx, p in zip((-pin_dx, pin_dx), pins):
            pb = [bm.verts.new((v.co.x, v.co.y, z_fl - 0.004)) for v in p]
            _bridge_o(bm, p, pb, (x + dx, y, z_fl), mi=1)
            _ngon(bm, pb, up, 1)
    for (x, y, hw, hh), top in zip(usbs, usbs_l):
        low = [bm.verts.new((v.co.x, v.co.y, zt - 0.0035)) for v in top]
        _bridge_o(bm, top, low, (x, y, zt), mi=1)
        _ngon(bm, low, up, 1)
    for top in leds:
        low = [bm.verts.new((v.co.x, v.co.y, zt + 0.0006)) for v in top]
        _bridge_o(bm, top, low, (led[0], led[1], zt - 0.01), toward=False, mi=2)
        _ngon(bm, low, up, 2)
    ob = _finish(bm, name, ["brass", "plastic_dark", "led_strip"], 40, recalc=False)
    return _uvb(ob, "brass", "x")


def _round_module(r=0.066):
    """Flush round power/USB module for the round table, face up, sitting on z = 0."""
    ob = _power_face("rm_face", lambda d: _circle(r - d, 48), [(-0.0255, 0.0), (0.0255, 0.0)],
                     [(0.0, 0.041, 0.0046, 0.0017), (0.0, -0.041, 0.0046, 0.0017)], True, sock_hw=0.0182, ins_r=0.0152,
                     pin_dx=0.0084)
    screw = _turn("rm_screw", [(0.0024, 0.0), (0.0019, 0.0009), (0.0, 0.0013)], 10, "brass_aged", caps=(False, False))
    parts = [ob]
    for a in (45, 135, 225, 315):
        s = _copy(screw)
        _xf(s, _T(0.0545 * math.cos(D2R(a)), 0.0545 * math.sin(a and D2R(a)), 0.002))
        parts.append(s)
    C.remove(screw)
    return _join(parts, "round_module")


# ---------------------------------------------------------------------------
# Small props (desk dressing)
# ---------------------------------------------------------------------------

BOOK_KEYS = ("leather_burgundy", "leather_green", "cloth_navy", "leather_brown", "signage")


def _book(name, T, H, D, key, bands=True, n=4):
    """A closed cased hardback standing on z = 0: thickness along X, spine (rounded, with two gilt bands)
    facing -Y, boards overhanging a cream page block."""
    t = 0.0022
    b = min(0.006, T * 0.22)
    y0, y1 = -D / 2, D / 2
    outer = [(-T / 2, y1), (-T / 2, y0 + b)]
    outer += [(-T / 2 * math.cos(math.pi * k / n), y0 + b - b * math.sin(math.pi * k / n)) for k in range(1, n)]
    outer += [(T / 2, y0 + b), (T / 2, y1)]
    inner = [(T / 2 - t, y1), (T / 2 - t, y0 + b)]
    inner += [((T / 2 - t) * math.cos(math.pi * k / n), y0 + b - (b - t) * math.sin(math.pi * k / n)) for k in range(n - 1, 0, -1)]
    inner += [(-T / 2 + t, y0 + b), (-T / 2 + t, y1)]
    loop = outer + inner
    bm = bmesh.new()
    A = [bm.verts.new((x, y, 0.0)) for x, y in loop]
    B = [bm.verts.new((x, y, H)) for x, y in loop]
    bm.faces.new(A)
    bm.faces.new(list(reversed(B)))
    _bridge(bm, A, B)
    shell = _finish(bm, name + "_case", key, 40)
    _uvb(shell, key, "z")
    parts = [shell]
    parts.append(_bx(name + "_pages", (-T / 2 + t - 0.0002, y0 + b * 0.6, 0.0028), (T / 2 - t + 0.0002, y1 - 0.0028, H - 0.0028),
                     "book_pages", 0.0, 1, "y"))
    if bands:
        for zb in (H * 0.13, H * 0.80):
            arc = [(-T / 2 * 1.02 * math.cos(math.pi * k / n), y0 + b - (b + 0.0004) * math.sin(math.pi * k / n)) for k in range(n + 1)]
            arc = [(-T / 2 - 0.0003, y0 + b + 0.002)] + arc + [(T / 2 + 0.0003, y0 + b + 0.002)]
            inn = [(x * 0.92, y + 0.0012) for x, y in reversed(arc)]
            parts.append(_plate(name + "_band", arc + inn, [], zb, zb + 0.0035, "gilt", "xy"))
    return _join(parts, name)


def _pen_pot(name="pot"):
    parts = [_turn(name + "_cup", [(0.032, 0.0), (0.0335, 0.0015), (0.0335, 0.094), (0.0332, 0.0975), (0.031, 0.0985),
                                   (0.0298, 0.096), (0.0298, 0.008), (0.0, 0.008)], 20, "leather_brown",
                   caps=(True, False))]
    parts.append(_turn(name + "_band", [(0.0337, 0.084), (0.0342, 0.0855), (0.0342, 0.0905), (0.0337, 0.092)], 20, "brass",
                       caps=(False, False)))
    tips = [((0.008, 0.006), 9, 0.17, "signage"), ((-0.010, 0.004), -7, 0.165, "plastic_dark"),
            ((0.0, -0.011), 5, 0.18, "marker_red"), ((-0.004, 0.012), -12, 0.155, "signage")]
    for (x, y), lean, L, key in tips:
        body = _turn(name + "_pen", [(0.0036, 0.0), (0.0036, L - 0.02)], 6, key, caps=(True, False), smooth=50)
        tip = _turn(name + "_tip", [(0.0034, L - 0.02), (0.0010, L - 0.003), (0.0, L)], 6,
                    "oak_light" if key == "signage" else "brass", caps=(False, False))
        pen = _join([body, tip], name + "_pencil")
        _xf(pen, _T(x, y, 0.009) @ _Ry(lean) @ _Rx(lean * 0.4))
        parts.append(pen)
    return _join(parts, name)


def _laptop_open(name="laptop"):
    """An open laptop (lid at 108 degrees), the dim screen facing -Y."""
    hw, hl = 0.152, 0.106
    parts = []
    base = _slab(name + "_base", _rect(hw, hl), 0.011, [(0.003, 0.0012), (0.0009, 0.0016), (0.0, 0.0028), (0.0, 0.0072),
                                                        (0.0006, 0.0080)], 4, "aluminium")
    _uvb(base, "aluminium", "x")
    parts.append(base)
    kb = _slab(name + "_keys", _rect(0.122, 0.048, 0, 0.032), 0.004, [(0.0, 0.0076), (0.0, 0.0083)], 2, "plastic_dark")
    parts.append(_uvb(kb, "plastic_dark"))
    pad = _slab(name + "_pad", _rect(0.05, 0.032, 0, -0.06), 0.004, [(0.0, 0.0076), (0.0, 0.0082)], 2, "aluminium")
    parts.append(_uvb(pad, "aluminium", "x"))
    lid = _slab(name + "_lid", _rect(hw, hl), 0.011, [(0.0006, 0.0), (0.0, 0.0006), (0.0, 0.0050), (0.0009, 0.0058)], 4,
                "aluminium")
    _uvb(lid, "aluminium", "x")
    glass = _slab(name + "_glass", _rect(hw - 0.004, hl - 0.004), 0.008, [(0.0, -0.0003), (0.0, 0.0002)], 2, "plastic_dark")
    disp = _slab(name + "_disp", _rect(hw - 0.011, hl - 0.016, 0, 0.004), 0.002, [(0.0, -0.0006), (0.0, -0.0001)], 1, "screen")
    lidm = _join([lid, glass, disp], name + "_lidm")
    # built lying face-down on the base, hinge along the back edge (y = +hl), then opened
    _xf(lidm, _T(0, hl - 0.002, 0.0088) @ _Rx(-108) @ _T(0, -hl, 0.0006))
    parts.append(lidm)
    parts.append(_bx(name + "_hinge", (-0.11, hl - 0.006, 0.004), (0.11, hl + 0.002, 0.0115), "plastic_dark", 0.0025, 2, "x"))
    return _join(parts, name)


# ---------------------------------------------------------------------------
# Carrel
# ---------------------------------------------------------------------------

CW, CD, CH = 1.10, 0.66, 1.35
CGT = 0.032                    # gable thickness
CXO = CW / 2                   # gable outer face
CXI = CXO - CGT                # gable inner face
C_DESK = 0.75                  # work surface
C_SHELF = 1.10                 # underside of the hutch shelf
C_SHELF_T = 0.022
C_SHELF_Y = (0.10, 0.300)
C_BACK_Y = (0.300, 0.326)      # framed back panel (front, back)
C_CAP_Z = 1.32
C_LAMP_Y = 0.170
GROMMET_XY = (-0.415, 0.232)


def _gable_outline(sharp=False):
    """Carrel gable in (y, z), CCW: arched cut between the feet, tall at the back, an S-curve sweeping
    down to the front at 1.02 m with a rounded nose."""
    pts = [(-CD / 2, 0.0)]
    a0, a1, rise, n = -0.235, 0.235, 0.04, 6
    if not sharp:
        pts += [(a0 + (a1 - a0) * k / n, rise * math.sin(math.pi * k / n)) for k in range(n + 1)]
    pts += [(CD / 2, 0.0), (CD / 2, CH)]
    ys1, ys0, zf = 0.06, -0.30, 1.02
    n = 10
    pts += [(ys1 + (ys0 - ys1) * k / n, zf + (CH - zf) * (1 + math.cos(math.pi * k / n)) / 2) for k in range(n + 1)]
    r = 0.03
    if sharp:
        pts.append((-CD / 2, zf))
    else:
        pts += [(-CD / 2 + r - r * math.sin(D2R(a)), zf - r + r * math.cos(D2R(a))) for a in (22.5, 45, 67.5, 90)]
    return pts


def _carrel_gable(sx):
    border = 0.05
    up_src = [(-CD / 2, 0.745), (CD / 2, 0.745)] + _gable_outline(sharp=True)[2:-1] + [(-CD / 2, 1.02)]
    upper = _offset(up_src, border)
    lower = _rr(CD / 2 - border, (0.66 - 0.112) / 2, 0.0, (0.66 + 0.112) / 2)
    xa, xb = (CXI, CXO) if sx > 0 else (-CXO, -CXI)
    parts = [_plate("cg_frame", _gable_outline(), [upper, lower], xa, xb, "walnut", "yz", 0.004, 2, "z")]
    rec = 0.006
    parts.append(_panel_in("cg_fabric", upper, xa + rec, xb - rec, "fabric_green", "yz"))
    parts.append(_panel_in("cg_lower", lower, xa + rec, xb - rec, "walnut", "yz", "z"))
    # a fine walnut bead round the fabric (pinned into the frame reveal), both faces
    bead = [(0.0, -0.0004), (0.0, 0.0016), (0.0018, 0.0034), (0.0032, 0.0018), (0.0032, -0.0004)]
    for xf, nx in ((xa + rec, -1), (xb - rec, 1)):
        corners = [(xf, y, z) for y, z in _offset(upper, -0.0005)]
        if nx < 0:
            corners = list(reversed(corners))
        ring = _mitre_loft("cg_bead", [Vector(c) for c in corners], (nx, 0, 0), [(s, h) for s, h in bead], "walnut")
        parts.append(_uvb(ring, "walnut", "z"))
    return parts


def _carrel_back():
    y0, y1 = C_BACK_Y
    holes = [_rr(0.47, (0.655 - 0.13) / 2, 0, (0.655 + 0.13) / 2),
             _rr(0.47, (1.072 - 0.80) / 2, 0, (1.072 + 0.80) / 2),
             _rr(0.47, (1.268 - 1.15) / 2, 0, (1.268 + 1.15) / 2)]
    parts = [_plate("cb_frame", _rr(CXI + 0.002, (C_CAP_Z - 0.08) / 2, 0, (C_CAP_Z + 0.08) / 2), holes, y0, y1, "walnut", "xz",
                    0.003, 2, "x")]
    rec = 0.006
    _panel.plane = "xz"
    parts.append(_panel("cb_low", holes[0], y0 + rec, y1 - rec, "walnut", "z"))
    parts.append(_panel("cb_fabric", holes[1], y0 + rec, y1 - rec, "fabric_green"))
    parts.append(_panel("cb_up", holes[2], y0 + rec, y1 - rec, "walnut", "x"))
    bead = [(0.0, -0.0004), (0.0, 0.0016), (0.0018, 0.0034), (0.0032, 0.0018), (0.0032, -0.0004)]
    corners = [Vector((x, y0 + rec, z)) for x, z in _offset(holes[1], -0.0005)]
    parts.append(_uvb(_mitre_loft("cb_bead", corners, (0, -1, 0), bead, "walnut"), "walnut", "x"))
    # moulded cap over the back panel, between the gables
    cap = [(0.0, 0.0), (0.040, 0.0), (0.0405, 0.0035), (0.0425, 0.006), (0.044, 0.012), (0.044, 0.018), (0.0425, 0.0235),
           (0.0375, 0.0278), (0.030, 0.030), (0.0, 0.030)]
    cap = [(u, v) for u, v in cap]
    cp = C.sweep("cb_cap", cap + [cap[0]], [(-CXI - 0.002, CD / 2, C_CAP_Z), (CXI + 0.002, CD / 2, C_CAP_Z)], _mat("walnut"),
                 cap=True, smooth_angle=35)
    parts.append(_uvb(cp, "walnut", "x"))
    return parts


def _carrel_desk():
    parts = []
    gx, gy = GROMMET_XY
    cut = C.cylinder("cut", 0.0262, 0.0262, 0.1, (gx, gy, C_DESK), _mat("tabletop"), 24)
    yf = -CD / 2 + 0.005
    top = _top("cd_top", CXI + 0.003, (C_BACK_Y[0] - yf) / 2, C_DESK, 0.030, "tabletop", radius=0.006, rr=0.007,
               cy=(C_BACK_Y[0] + yf) / 2, cutters=[cut])
    parts.append(top)
    # brass cable grommet with a notched lid
    loop = [(0.0255, C_DESK - 0.028), (0.0255, C_DESK - 0.0003), (0.0334, C_DESK - 0.0003), (0.0340, C_DESK + 0.0006),
            (0.0336, C_DESK + 0.0016), (0.0322, C_DESK + 0.0023), (0.0245, C_DESK + 0.0023), (0.0240, C_DESK + 0.0016),
            (0.0240, C_DESK - 0.028)]
    band = [0] * len(loop)
    g = FH._lathe_loop("cd_grommet", loop, 24, ["brass"], band, 40)
    _xf(g, _T(gx, gy, 0))
    parts.append(_uvb(g, "brass", "y"))
    lid = [(0.0236 * math.cos(a), 0.0236 * math.sin(a)) for a in (D2R(-62 + 304 * k / 26) for k in range(27))]
    lid += [(0.009, 0.0236 * math.sin(D2R(62)) - 0.0005), (0.009 * math.cos(D2R(45)), 0.004), (0.0, 0.0)]
    lid = [(0.0236 * math.cos(D2R(-62 + 304 * k / 26)), 0.0236 * math.sin(D2R(-62 + 304 * k / 26))) for k in range(27)]
    notch = [(0.0236 * math.cos(D2R(62)) - 0.0005, 0.0236 * math.sin(D2R(62))), (0.0085, 0.0)]
    lid_o = lid + [(0.0236 * math.cos(D2R(62)) - 0.0, 0.0236 * math.sin(D2R(62)))]
    lid_o = [(0.0236 * math.cos(D2R(a)), 0.0236 * math.sin(D2R(a))) for a in [62 + 296 * k / 28 for k in range(29)]]
    lid_o += [(0.0095, -0.0095), (0.0095, 0.0095)]
    lp = C.prism("cd_lid", [(gx + x, gy + y) for x, y in lid_o], C_DESK - 0.0012, C_DESK + 0.0012, _mat("plastic_dark"))
    del notch
    parts.append(_uvb(lp, "plastic_dark"))
    # front apron with a pencil drawer
    parts.append(_bx("cd_apron", (-CXI - 0.002, -0.300, 0.645), (CXI + 0.002, -0.282, C_DESK - 0.030), "walnut", 0.002, 1, "x"))
    parts.append(_bx("cd_drawer", (-0.21, -0.306, 0.652), (0.21, -0.300, 0.713), "walnut", 0.002, 2, "x"))
    kn = _knob("cd_knob", 0.0105, 0.021)
    parts.append(_xf(kn, _T(0, -0.306, 0.6825) @ _Rx(90)))
    # hutch shelf
    sy0, sy1 = C_SHELF_Y
    parts.append(_top("cd_shelf", CXI + 0.003, (sy1 - sy0) / 2, C_SHELF + C_SHELF_T, C_SHELF_T, "walnut", radius=0.004,
                      rr=0.006, cy=(sy0 + sy1) / 2))
    # power strip on the back rail, standing on the desk
    strip = _power_face("cd_strip", lambda d: _rpoly(_rect(0.118, 0.0225), 0.006, d, 3),
                        [(-0.072, 0.0), (-0.027, 0.0)], [(0.020, 0.0, 0.0044, 0.0016), (0.040, 0.0, 0.0044, 0.0016),
                                                         (0.064, 0.0, 0.0068, 0.0030)],
                        flange=False, depth=0.014, sock_hw=0.0178, ins_r=0.0148, pin_dx=0.0082, led=(0.098, 0.0))
    _xf(strip, _T(0.215, C_BACK_Y[0] - 0.014, C_DESK + 0.0235) @ _Rx(90))
    parts.append(strip)
    return parts


def _carrel_lamp():
    """Green cased-glass trough lamp hung under the hutch shelf. Returns (parts, light points)."""
    L, W, H = 0.34, 0.046, 0.044
    z_rim = C_SHELF - 0.024 - H
    Ms = _T(0, C_LAMP_Y, z_rim)
    shade, pt = FH._banker_shade(L=L, W=W, H=H, t=0.0026, nu=18, nv=10)
    _xf(shade, Ms)
    parts = [shade]
    aa = [math.pi * (0.30 + 0.40 * k / 8) for k in range(9)]
    rosette = _turn("cl_rose", [(0.0, -0.0045), (0.0115, -0.0045), (0.0122, -0.0035), (0.0110, -0.0012), (0.0060, 0.0)],
                    12, "brass", caps=(False, True))
    _xf(rosette, _Rx(180))
    for xb in (-0.105, 0.105):
        rings = []
        for x in (xb - 0.0065, xb + 0.0065):
            s = x / (L / 2)
            sec = [pt(s, a, -0.0018) for a in aa] + [pt(s, a, 0.0) for a in reversed(aa)]
            rings.append([Ms @ Vector((x, v.y, v.z)) for v in sec])
        band = _loft("cl_band", rings, "brass")
        parts.append(_uvb(band, "brass", "x"))
        z_top = (Ms @ pt(xb / (L / 2), math.pi / 2, -0.0018)).z
        parts.append(_xf(_turn("cl_collar", [(0.0058, 0.0), (0.0058, 0.004), (0.0045, 0.006)], 14, "brass", caps=(False, False)),
                         _T(xb, C_LAMP_Y, z_top - 0.0008)))
        parts.append(C.cylinder("cl_rod", 0.0032, 0.0032, C_SHELF - z_top - 0.004, (xb, C_LAMP_Y, (C_SHELF + z_top) / 2),
                                _mat("brass"), 12))
        r = _copy(rosette)
        _xf(r, _T(xb, C_LAMP_Y, C_SHELF))
        parts.append(r)
    C.remove(rosette)
    # tubular lamp with two sockets, inside the shade
    zc = z_rim + 0.021
    tube = _turn("cl_tube", [(0.0, 0.0), (0.0062, 0.0012), (0.0098, 0.0048), (0.0108, 0.010), (0.0108, 0.236), (0.0098, 0.2412),
                             (0.0062, 0.2448), (0.0, 0.246)], 12, "bulb", caps=(False, False))
    _xf(tube, _T(-0.123, C_LAMP_Y, zc) @ _Ry(90))
    parts.append(tube)
    for sx in (-1, 1):
        sk = _turn("cl_sock", [(0.0118, 0.0), (0.0124, 0.002), (0.0124, 0.013), (0.0110, 0.016), (0.0, 0.016)], 12, "brass_aged",
                   caps=(True, False))
        _xf(sk, _T(sx * 0.121, C_LAMP_Y, zc) @ _Ry(90 * sx))
        parts.append(sk)
    # small brass toggle on the +X end of the shade
    tip = Ms @ pt(0.985, math.pi / 2 * 0.98, -0.0005)
    parts.append(_xf(_turn("cl_switch", [(0.0042, 0.0), (0.0036, 0.004), (0.0026, 0.007), (0.0012, 0.013), (0.0, 0.0135)], 10, "brass",
                           caps=(False, False)), _T(tip.x - 0.004, tip.y, tip.z - 0.004) @ _Ry(70)))
    lights = [(-0.07, C_LAMP_Y, zc), (0.07, C_LAMP_Y, zc)]
    return parts, lights


def _carrel_books(rng):
    """Books on the hutch shelf, spines to the student: a row standing against the left gable and held by
    an L-shaped brass bookend (its foot under the last three books), and two books lying flat at the right."""
    parts = []
    z = C_SHELF + C_SHELF_T
    yb = C_SHELF_Y[0] + 0.012
    x = -CXI + 0.0015
    spec = [(rng.uniform(0.022, 0.040), rng.uniform(0.150, 0.186), rng.uniform(0.118, 0.150), BOOK_KEYS[rng.randrange(len(BOOK_KEYS))])
            for _ in range(7)]
    foot_t = 0.003
    x_end = x + sum(T + 0.0008 for T, _H, _D, _k in spec)
    x_foot = x_end - sum(T + 0.0008 for T, _H, _D, _k in spec[-3:])        # the foot runs under the last three books
    for i, (T, H, D, key) in enumerate(spec):
        b = _book(f"cs_book{i}", T, H, D, key)
        zb = z + (foot_t if x >= x_foot - 1e-6 else 0.0)
        _xf(b, _T(x + T / 2, yb + D / 2 + rng.uniform(-0.004, 0.006), zb) @ _Rz(rng.uniform(-0.8, 0.8)))
        x += T + 0.0008
        parts.append(b)
    end = _plate("cs_bookend", [(x_foot - x_end, 0.0), (0.004, 0.0), (0.004, 0.145), (0.0, 0.145), (0.0, foot_t),
                                (x_foot - x_end, foot_t)], [], -0.055, 0.055, "brass_aged", "xz", 0.001, 1)
    _xf(end, _T(x_end, yb + 0.07, z))
    parts.append(end)
    xr = 0.27
    zz = z
    for i, (T, H, D) in enumerate(((0.034, 0.232, 0.162), (0.026, 0.205, 0.148))):
        key = BOOK_KEYS[(i + 2) % len(BOOK_KEYS)]
        b = _book(f"cs_flat{i}", T, H, D, key)
        _xf(b, _T(xr + H / 2 * 0.0 + 0.01 * i, yb + D / 2 + 0.004, zz + T / 2) @ _Rz(rng.uniform(-2.5, 2.5)) @ _Ry(90) @ _T(0, 0, -H / 2))
        zz += T
        parts.append(b)
    return parts


def _carrel_props(variant, rng):
    parts = []
    z = C_DESK + 0.0003
    if variant in (0, 1, 3):
        pot = _pen_pot("cp_pot")
        _xf(pot, _T(-0.33, 0.20, z))
        parts.append(pot)
    if variant == 0:
        b = _book("cp_book", 0.032, 0.235, 0.165, "leather_burgundy")
        _xf(b, _T(0.06, -0.08, z + 0.016) @ _Rz(-8) @ _Ry(90))
        parts.append(b)
    elif variant == 1:
        lt = _laptop_open("cp_laptop")
        _xf(lt, _T(0.0, -0.08, z) @ _Rz(3))
        parts.append(lt)
    elif variant == 2:
        ob = FH._prop_book_open()
        for i, m in enumerate(ob.data.materials):
            if m == _mat("book_cloth"):
                ob.data.materials[i] = _mat("cloth_navy")
        _xf(ob, _T(-0.05, -0.10, z) @ _Rz(4))
        parts.append(ob)
        nb = FH._prop_notebook()
        _xf(nb, _T(0.33, -0.05, z) @ _Rz(-14))
        parts.append(nb)
        pc = FH._prop_pencil()
        _xf(pc, _T(0.23, -0.20, z) @ _Rz(38))
        parts.append(pc)
    elif variant == 3:
        zz = z
        for i, (T, H, D, key, rot) in enumerate(((0.040, 0.245, 0.172, "cloth_navy", -4), (0.028, 0.225, 0.16, "leather_green", 7),
                                                  (0.022, 0.20, 0.14, "leather_burgundy", -11))):
            b = _book(f"cp_stack{i}", T, H, D, key)
            _xf(b, _T(0.20, -0.02, zz + T / 2) @ _Rz(rot) @ _Ry(90))
            zz += T
            parts.append(b)
    return parts


def build_carrel(item=None):
    """The 1.1 x 0.66 x 1.35 study carrel (front -Y, where the student sits). item.seed picks the props."""
    seed = int(getattr(item, "seed", 0) or 0) if item is not None else 0
    rng = random.Random(seed * 7919 + 17)
    parts = []
    for sx in (-1, 1):
        parts += _carrel_gable(sx)
    parts += _carrel_back()
    parts += _carrel_desk()
    lamp, lights = _carrel_lamp()
    parts += lamp
    parts += _carrel_books(rng)
    parts += _carrel_props(seed % 4, rng)
    ob = _join(parts, f"Furniture_Carrel_{seed:02d}")
    ob["light_points"] = [list(p) for p in lights]
    ob["light_offset"] = tuple(lights[0])
    ob["light_color"] = BULB_COLOR
    ob["glow_material"] = "glass_green_cased"
    ob["glow_material_lit"] = "glass_green_cased_lit"
    ob["glow_emission"] = LM.PALETTE["glass_green_cased_lit"]["emit"]
    ob["glow_color"] = LM.PALETTE["glass_green_cased_lit"]["emission"]
    return ob


# ---------------------------------------------------------------------------
# Quiet-study pedestal desk
# ---------------------------------------------------------------------------

QW, QD, QH = 1.60, 0.80, 0.76
Q_TOP0 = 0.7245
Q_PLINTH = 0.09
Q_FRONT = (-0.38, -0.36)
Q_BACK = (0.36, 0.38)
Q_PED = (0.36, 0.78)          # pedestal x range (mirrored)
Q_KNEE = 0.615
Q_DRAWERS = [(0.550, 0.700), (0.352, 0.532), (0.119, 0.334)]
Q_FRIEZE = (0.630, 0.700)


def build_desk_quiet(item=None):
    """Twin-pedestal writing desk, knee-hole to the front (-Y)."""
    parts = []
    z1 = QH - 0.0008
    parts.append(_top("dq_top", QW / 2, QD / 2, z1, z1 - Q_TOP0, "walnut", radius=0.012, rr=0.009))
    # leather writing inlay with a gilt tooled line
    lw, ll, lc = 0.672, 0.292, -0.012
    parts.append(_uvb(_slab("dq_leather", _rect(lw, ll, 0, lc), 0.004, [(0.0, z1 - 0.0004), (0.0, z1 + 0.0004),
                                                                          (0.0006, z1 + 0.0007)], 2, "leather_green"), "leather_green"))
    gl = [Vector((x, y, z1 + 0.0007)) for x, y in _rect(lw - 0.016, ll - 0.016, 0, lc)]
    parts.append(_uvb(_mitre_loft("dq_gilt", gl, (0, 0, 1), [(0.0, -0.0002), (0.0016, -0.0002), (0.0016, 0.00028), (0.0, 0.00028)],
                                  "gilt"), "gilt"))
    # plinths
    for sx in (-1, 1):
        cx = sx * (Q_PED[0] + Q_PED[1]) / 2
        prof = [(0.0, 0.0), (0.0, 0.058), (0.0006, 0.064), (0.0022, 0.0705), (0.0045, 0.0765), (0.0068, 0.082), (0.008, 0.086),
                (0.008, Q_PLINTH)]
        pl = _slab("dq_plinth", _rect((Q_PED[1] - Q_PED[0]) / 2 + 0.008, QD / 2 - 0.012 + 0.0, cx, 0.0), 0.004, prof, 2, "walnut")
        parts.append(_uvb(pl, "walnut", "x"))
    # front face frame: one board round both pedestals and the frieze, the knee-hole notched out
    a, b = Q_PED
    outline = [(-b, Q_PLINTH), (-a, Q_PLINTH), (-a, Q_KNEE), (a, Q_KNEE), (a, Q_PLINTH), (b, Q_PLINTH), (b, Q_TOP0), (-b, Q_TOP0)]
    holes = []
    xi0, xi1 = a + 0.03, b - 0.03
    for sx in (-1, 1):
        for z0, z1_ in Q_DRAWERS:
            holes.append(_rr((xi1 - xi0) / 2, (z1_ - z0) / 2, sx * (xi0 + xi1) / 2, (z0 + z1_) / 2))
    fz0, fz1 = Q_FRIEZE
    holes.append(_rr(0.33, (fz1 - fz0) / 2, 0, (fz0 + fz1) / 2))
    parts.append(_plate("dq_front", outline, holes, Q_FRONT[0], Q_FRONT[1], "walnut", "xz", 0.0025, 2, "x"))
    # cock beads round every drawer opening, drawer fronts recessed 1.5 mm behind the frame
    bead = [(-0.0012, -0.0004), (-0.0012, 0.0018), (-0.0004, 0.0030), (0.0008, 0.0030), (0.0016, 0.0018), (0.0016, -0.0004)]
    pull = _bail_pull()
    knob = _knob("dq_fknob", 0.010, 0.02)
    esc = _escutcheon()
    for h in holes:
        (x0, z0), (x1, _), (_, z1_), _ = h
        g = 0.0016
        parts.append(_bx("dq_drawer", (x0 + g, Q_FRONT[0] + 0.0015, z0 + g), (x1 - g, Q_FRONT[0] + 0.020, z1_ - g), "walnut", 0.0018, 2, "x"))
        cs = [Vector((x, Q_FRONT[0], z)) for x, z in h]
        parts.append(_uvb(_mitre_loft("dq_bead", cs, (0, -1, 0), bead, "walnut"), "walnut", "x"))
        cx, cz = (x0 + x1) / 2, (z0 + z1_) / 2
        yf = Q_FRONT[0] + 0.0015
        if x1 - x0 > 0.5:                                          # frieze drawer: two knobs and an escutcheon
            for sx in (-1, 1):
                k = _copy(knob)
                _xf(k, _T(cx + sx * 0.19, yf, cz) @ _Rx(90))
                parts.append(k)
            e = _copy(esc)
            _xf(e, _T(cx, yf, cz))
            parts.append(e)
        else:
            p = _copy(pull)
            _xf(p, _T(cx, yf, cz + (z1_ - z0) * 0.12))
            parts.append(p)
            if z1_ > 0.69:
                e = _copy(esc)
                _xf(e, _T(cx, yf, z1_ - 0.028))
                parts.append(e)
    for o in (pull, knob, esc):
        C.remove(o)
    # pedestal sides (inner faces show in the knee-hole), panelled
    for sx in (-1, 1):
        for xa, xb in ((a, a + 0.02), (b - 0.02, b)):
            x0, x1 = (xa, xb) if sx > 0 else (-xb, -xa)
            hole = _rr(0.30, (Q_TOP0 - 0.06 - Q_PLINTH - 0.06) / 2, 0.0, (Q_TOP0 - 0.06 + Q_PLINTH + 0.06) / 2)
            parts.append(_plate("dq_side", _rr((Q_BACK[0] - Q_FRONT[1]) / 2, (Q_TOP0 - Q_PLINTH) / 2, (Q_BACK[0] + Q_FRONT[1]) / 2,
                                                (Q_TOP0 + Q_PLINTH) / 2), [hole], x0, x1, "walnut", "yz", 0.0025, 2, "z"))
            _panel.plane = "yz"
            parts.append(_panel("dq_sidep", hole, x0 + 0.005, x1 - 0.005, "walnut", "z"))
    # back: three fielded panels (pedestal, modesty, pedestal)
    bh = [_rr((b - a - 0.10) / 2, (Q_TOP0 - Q_PLINTH - 0.12) / 2, sx * (a + b) / 2, (Q_TOP0 + Q_PLINTH) / 2) for sx in (-1, 1)]
    bh.append(_rr(a - 0.05, (Q_KNEE - 0.06 - Q_PLINTH - 0.06) / 2, 0, (Q_KNEE - 0.06 + Q_PLINTH + 0.06) / 2))
    parts.append(_plate("dq_back", _rr(b, (Q_TOP0 - Q_PLINTH) / 2, 0, (Q_TOP0 + Q_PLINTH) / 2), bh, Q_BACK[0], Q_BACK[1], "walnut",
                        "xz", 0.0025, 2, "x"))
    _panel.plane = "xz"
    for h in bh:
        parts.append(_panel("dq_backp", h, Q_BACK[0] + 0.005, Q_BACK[1] - 0.005, "walnut", "z"))
    # knee-hole ceiling under the frieze drawer
    parts.append(_bx("dq_kneetop", (-a - 0.002, Q_FRONT[1], Q_KNEE - 0.016), (a + 0.002, Q_BACK[0], Q_KNEE), "walnut", 0.0, 1, "x"))
    return _join(parts, "Furniture_Desk_Quiet_01")


# ---------------------------------------------------------------------------
# Group tables
# ---------------------------------------------------------------------------

GT_H = 0.76
GT_TOP = 0.045
GLEG_PROFILE = [               # sturdy turned leg (0.585 m from the brass cup to the square block)
    (0.0315, 0.0), (0.0335, 0.004), (0.0405, 0.016), (0.0410, 0.024), (0.0355, 0.034), (0.0320, 0.046), (0.0335, 0.062),
    (0.0390, 0.110), (0.0420, 0.170), (0.0410, 0.230), (0.0365, 0.300), (0.0300, 0.370), (0.0278, 0.405), (0.0330, 0.418),
    (0.0352, 0.428), (0.0310, 0.440), (0.0300, 0.452), (0.0345, 0.466), (0.0360, 0.480), (0.0330, 0.492), (0.0340, 0.520),
    (0.0390, 0.548), (0.0425, 0.565),
]


def _group_leg():
    zb0 = 0.585
    prof = [(r, z + 0.022) for r, z in GLEG_PROFILE]
    prof[-1] = (0.0425, zb0)
    return _leg("gt_leg", prof, 0.0425, zb0, GT_H - GT_TOP + 0.0005, "oak", seg=18, cup=(0.032, 0.026))


def build_table_group_rect(item=None):
    """2.4 x 1.2 oak group table: turned legs, beaded apron, end stretchers, two flush power modules,
    cable tray and an oak-clad riser to a brass floor box."""
    W, Dp = 2.4, 1.2
    parts = []
    mods_x = (-0.6, 0.6)
    cutters = [_slab("cut", _rect(FH.GR_HL - 0.004, FH.GR_HW - 0.004, x, 0.0), 0.005,
                     [(0, GT_H - 0.012), (0, GT_H + 0.01)], 2, "tabletop") for x in mods_x]
    parts.append(_top("gr_top", W / 2, Dp / 2, GT_H, GT_TOP, "tabletop", radius=0.03, rr=0.010, cutters=cutters))
    g = FH._grommet()
    for x in mods_x:
        gg = _copy(g)
        _xf(gg, _T(x, 0, 0) @ _Rz(90))
        parts.append(gg)
    C.remove(g)
    lx, ly = W / 2 - 0.10, Dp / 2 - 0.10
    leg = _group_leg()
    for sx in (-1, 1):
        for sy in (-1, 1):
            l = _copy(leg)
            _xf(l, _T(sx * lx, sy * ly, 0))
            parts.append(l)
    C.remove(leg)
    za0, za1 = 0.600, GT_H - GT_TOP + 0.0005
    hw = 0.0425
    inset = 0.012
    # aprons (long and short), set back from the leg faces, with an astragal along the bottom
    for sy in (-1, 1):
        y = sy * (ly + hw - inset)
        parts.append(_bx("gr_apron", (-lx, y - 0.011, za0), (lx, y + 0.011, za1), "oak", 0.002, 1, "x"))
    for sx in (-1, 1):
        x = sx * (lx + hw - inset)
        parts.append(_bx("gr_apron", (x - 0.011, -ly, za0), (x + 0.011, ly, za1), "oak", 0.002, 1, "y"))
    astr = [(0.0035 + 0.0045 * math.cos(a), 0.0045 * math.sin(a)) for a in (math.tau * k / 10 for k in range(10))]
    for sy in (-1, 1):
        y = sy * (ly + hw - inset + 0.011)
        path = [Vector((-lx + hw, y, za0 + 0.004)), Vector((lx - hw, y, za0 + 0.004))]
        prof = [(u - 0.0035, v) for u, v in astr]
        ob = C.sweep("gr_astr", prof + [prof[0]], path, _mat("oak"), cap=True)
        if sy < 0:
            pass
        parts.append(_uvb(ob, "oak", "x"))
    # turned end stretchers, low
    for sx in (-1, 1):
        parts.append(FH._turn_between("gr_str", (sx * lx, -ly + 0.02, 0.15), (sx * lx, ly - 0.02, 0.15),
                                      [(r * 1.85, t) for r, t in FH.STRETCHER_PROFILE], 14, "oak"))
    # cable tray under the top, the riser and the floor box
    tray = [(-0.07, 0.0), (-0.07, 0.062), (-0.064, 0.062), (-0.064, 0.006), (0.064, 0.006), (0.064, 0.062), (0.07, 0.062), (0.07, 0.0)]
    tr = C.sweep("gr_tray", [(-u, v) for u, v in tray] + [(-tray[0][0], tray[0][1])],
                 [(-0.78, 0.0, 0.625), (0.78, 0.0, 0.625)], _mat("iron"), cap=True)
    parts.append(_uvb(tr, "iron", "x"))
    for x in (-0.6, 0.6):
        parts.append(_bx("gr_trayhang", (x - 0.012, -0.072, 0.625), (x + 0.012, 0.072, za1), "iron", 0.001, 1, "y"))
    parts.append(_bx("gr_riser", (-0.036, -0.026, 0.012), (0.036, 0.026, 0.626), "oak", 0.003, 2, "z"))
    for z in (0.10, 0.52):
        parts.append(_bx("gr_riserband", (-0.0385, -0.0285, z), (0.0385, 0.0285, z + 0.016), "brass_aged", 0.0012, 1, "z"))
    fb = _slab("gr_floorbox", _rect(0.075, 0.055), 0.012, [(0.0, 0.0), (0.0, 0.006), (0.003, 0.011), (0.008, 0.013)], 3, "brass_aged")
    parts.append(_uvb(fb, "brass_aged", "x"))
    return _join(parts, "Furniture_Table_GroupRect_01")


ROUND_COLUMN = [
    (0.098, 0.150), (0.106, 0.160), (0.108, 0.172), (0.102, 0.184), (0.090, 0.192), (0.084, 0.204), (0.088, 0.230),
    (0.096, 0.270), (0.098, 0.310), (0.092, 0.360), (0.078, 0.420), (0.066, 0.470), (0.060, 0.505), (0.072, 0.516),
    (0.076, 0.528), (0.068, 0.540), (0.064, 0.552), (0.070, 0.575), (0.084, 0.600), (0.100, 0.622), (0.108, 0.640),
    (0.112, 0.650), (0.112, 0.665),
]


def build_table_group_round(item=None):
    """1.5 m round oak pedestal table with a flush power module at the centre."""
    R0 = 0.75
    parts = []
    z1, z0 = GT_H, GT_H - GT_TOP
    rp = 0.0625
    prof = [(0.0, z0), (R0 - 0.010, z0), (R0 - 0.0035, z0 + 0.0032), (R0, z0 + 0.010), (R0, z1 - 0.010)]
    for k in range(1, 5):
        t = D2R(22.5 * k)
        prof.append((R0 - 0.010 + 0.010 * math.cos(t), z1 - 0.010 + 0.010 * math.sin(t)))
    prof += [(rp, z1), (rp, z1 - 0.012), (0.0, z1 - 0.012)]
    top = C.lathe("grr_top", prof, 96, _mat("tabletop"), cap_top=False, cap_bottom=False, smooth_angle=40)
    _uvb(top, "tabletop", "x")
    C.weighted_normals(top)
    parts.append(top)
    parts.append(_xf(_round_module(rp + 0.004), _T(0, 0, z1)))
    # cross bearer (one piece, shaped ends) and the column
    hw, L = 0.036, 0.36
    end = [(L, -hw), (L + 0.012, -hw * 0.7), (L + 0.018, 0.0), (L + 0.012, hw * 0.7), (L, hw)]
    arm = lambda R_: [R_(p) for p in end]  # noqa: E731
    outline = []
    for k in range(4):
        rot = lambda p, k=k: (p[0] * math.cos(k * math.pi / 2 + math.pi / 4) - p[1] * math.sin(k * math.pi / 2 + math.pi / 4),  # noqa: E731
                              p[0] * math.sin(k * math.pi / 2 + math.pi / 4) + p[1] * math.cos(k * math.pi / 2 + math.pi / 4))
        outline += arm(rot)
        c = (hw, hw)
        outline.append(rot((hw / math.cos(0) * 1.0, hw)) if False else rot((hw, hw)))
    # tidy outline: [arm end points ..., inner corner] per arm (CCW)
    br = C.prism("grr_bearer", outline, 0.665, z0 + 0.0005, _mat("oak"), bevel_w=0.003)
    parts.append(_uvb(br, "oak", "x"))
    col = _turn("grr_column", ROUND_COLUMN, 32, "oak", fillet=0.002, caps=(False, True))
    parts.append(col)
    hub = _turn("grr_hub", [(0.112, 0.020), (0.112, 0.138), (0.106, 0.146), (0.098, 0.150)], 32, "oak", fillet=0.002, caps=(True, False))
    parts.append(hub)
    # four out-swept feet on brass cups
    top_curve = [(0.085, 0.150), (0.140, 0.146), (0.200, 0.132), (0.260, 0.108), (0.320, 0.083), (0.380, 0.064), (0.430, 0.054),
                 (0.470, 0.050), (0.500, 0.052), (0.522, 0.058), (0.536, 0.050), (0.540, 0.040), (0.536, 0.030)]
    bottom = [(0.530, 0.026), (0.470, 0.026), (0.430, 0.030), (0.360, 0.044), (0.260, 0.054), (0.160, 0.050), (0.085, 0.040)]
    foot_outline = list(reversed(top_curve)) + list(reversed(bottom))
    foot_outline = [(x, z) for x, z in reversed(foot_outline)]
    # CCW in (x, z): bottom from hub out, toe, top back to the hub
    ccw = list(reversed(bottom)) + list(reversed(top_curve))
    ccw = bottom[::-1] if False else ccw
    foot = _extrude("grr_foot", [(x, z) for x, z in ccw], -0.034, 0.034, "oak", "xz", 0.004, 2)
    _uvb(foot, "oak", "x")
    cup = _turn("grr_cup", [(0.020, 0.0), (0.023, 0.002), (0.024, 0.008), (0.026, 0.020), (0.026, 0.026), (0.0, 0.026)], 20,
                "brass_aged", fillet=0.001)
    for k in range(4):
        a = k * 90 + 45
        f = _copy(foot)
        _xf(f, _Rz(a))
        parts.append(_uvb(f, "oak", None))
        cp = _copy(cup)
        _xf(cp, _Rz(a) @ _T(0.50, 0, 0))
        parts.append(cp)
    C.remove(foot)
    C.remove(cup)
    # cable down the column to a floor box between two feet
    fb = _slab("grr_floorbox", _rect(0.06, 0.045), 0.012, [(0.0, 0.0), (0.0, 0.006), (0.003, 0.011), (0.008, 0.013)], 3, "brass_aged")
    _xf(fb, _T(0.0, 0.34, 0))
    parts.append(_uvb(fb, "brass_aged", "x"))
    cab = _catmull([(0.0, 0.10, 0.06), (0.0, 0.13, 0.03), (0.0, 0.17, 0.008), (0.0, 0.25, 0.006), (0.0, 0.30, 0.008),
                    (0.0, 0.32, 0.012)], 3)
    parts.append(_uvb(_tube("grr_cable", cab, 0.0055, "plastic_dark", 8), "plastic_dark"))
    parts.append(_xf(_turn("grr_gland", [(0.010, 0.0), (0.010, 0.012), (0.0075, 0.016)], 12, "brass_aged", caps=(False, False)),
                     _T(0, 0.098, 0.066) @ _Rx(-62)))
    return _join(parts, "Furniture_Table_GroupRound_01")


# ---------------------------------------------------------------------------
# Whiteboard and wall screen (wall-mounted: back on y = 0, room on -Y)
# ---------------------------------------------------------------------------

WB_W, WB_H, WB_Z0 = 2.0, 1.25, 0.85
WB_RAIL = 0.045
WB_SURF_Y = -0.012


def _marker(name, cap_key, L=0.122, r=0.0086):
    body = _turn(name + "_body", [(r * 0.7, 0.0), (r, 0.004), (r, L - 0.034), (r * 0.92, L - 0.031)], 16, "plastic_light",
                 caps=(True, False))
    cap = _turn(name + "_cap", [(r * 1.07, L - 0.036), (r * 1.1, L - 0.034), (r * 1.1, L - 0.004), (r * 0.8, L), (0.0, L)], 16,
                cap_key, caps=(True, False))
    band = _turn(name + "_band", [(r * 1.004, 0.028), (r * 1.004, 0.046)], 16, cap_key, caps=(False, False))
    clip = _bx(name + "_clip", (-0.0016, -r * 1.1 - 0.0022, L - 0.030), (0.0016, -r * 1.05, L - 0.006), cap_key, 0.0008, 1, "z")
    ob = _join([body, cap, band, clip], name)
    return ob


def build_whiteboard_wall(item=None):
    W, H, z0 = WB_W, WB_H, WB_Z0
    parts = []
    x_in, z_in0, z_in1 = W / 2 - WB_RAIL, z0 + WB_RAIL, z0 + H - WB_RAIL
    prof = [(0.010, 0.0), (0.045, 0.0), (0.045, 0.018), (0.0435, 0.0245), (0.038, 0.0288), (0.029, 0.0308), (0.017, 0.0308),
            (0.010, 0.0285), (0.0045, 0.0242), (0.0015, 0.021), (0.0, 0.0175), (0.0, 0.0125), (0.010, 0.0125)]
    path = [(-x_in, 0, z_in0), (x_in, 0, z_in0), (x_in, 0, z_in1), (-x_in, 0, z_in1)]
    fr = C.sweep("wb_frame", prof + [prof[0]], path, _mat("walnut"), closed_path=True, up=(0, -1, 0), smooth_angle=35)
    parts.append(_uvb(fr, "walnut", "x"))
    # writing surface (8 mm board, its edge under the frame's rebate) and a dark backing ring behind the frame
    parts.append(_bx("wb_board", (-x_in - 0.009, WB_SURF_Y, z_in0 - 0.009), (x_in + 0.009, -0.003, z_in1 + 0.009), "whiteboard"))
    # marker tray on the bottom rail
    tp = [(0.0, 0.0), (0.0, 0.034), (0.003, 0.034), (0.006, 0.010), (0.034, 0.008), (0.036, 0.009), (0.040, 0.016), (0.042, 0.024),
          (0.045, 0.027), (0.048, 0.025), (0.050, 0.018), (0.049, 0.006), (0.045, 0.0)]
    tx = 0.72
    tray = C.sweep("wb_tray", [(u, v) for u, v in tp] + [tp[0]], [(-tx, -0.0305, z0 + 0.006), (tx, -0.0305, z0 + 0.006)], _mat("walnut"),
                   cap=True, smooth_angle=35)
    parts.append(_uvb(tray, "walnut", "x"))
    # the tray's sweep: profile u = toward the room (-Y), v = up; its floor is at z0 + 0.016
    zt = z0 + 0.006 + 0.010
    for sx in (-1, 1):
        endcap = _plate("wb_trayend", [(-0.0305, z0 + 0.004), (-0.0305 - 0.052, z0 + 0.004), (-0.0305 - 0.052, z0 + 0.0345),
                                       (-0.0305, z0 + 0.044)], [], sx * tx, sx * (tx + 0.004), "brass_aged", "yz", 0.001, 1)
        parts.append(endcap)
    keys = ("plastic_dark", "marker_blue", "marker_red", "signage")
    xs = (-0.36, -0.26, -0.17, 0.27)
    for i, (key, x) in enumerate(zip(keys, xs)):
        m = _marker(f"wb_marker{i}", key)
        _xf(m, _T(x, -0.0305 - 0.025 + (0.003 if i % 2 else -0.001), zt + 0.0086) @ _Rz(180 if i % 2 else 0) @ _Ry(90)
            @ _Rz(30 * i) @ _T(0, 0, -0.061))
        parts.append(m)
    er = _slab("wb_eraser", _rect(0.062, 0.021), 0.010, [(0.0, 0.0), (0.0, 0.007), (0.001, 0.0085), (0.0015, 0.010)], 3, "felt_green")
    et = _slab("wb_eraser_top", _rect(0.062, 0.021), 0.010, [(0.0, 0.010), (0.0, 0.016), (0.0015, 0.022), (0.005, 0.0265),
                                                                (0.010, 0.028)], 3, "oak_light")
    eraser = _join([_uvb(er, "felt_green"), _uvb(et, "oak_light", "x")], "wb_eraser")
    _xf(eraser, _T(0.46, -0.0305 - 0.026, zt) @ _Rz(-4))
    parts.append(eraser)
    # brass rosettes over the fixings
    ros = _turn("wb_rose", [(0.0, 0.0), (0.0075, 0.0), (0.0078, 0.0008), (0.0062, 0.0020), (0.0028, 0.0028), (0.0, 0.0030)], 16,
                "brass_aged", caps=(False, False))
    for sx in (-1, 1):
        for zz in (z0 + 0.0225, z0 + H - 0.0225):
            if zz < z0 + 0.1:
                continue
            r = _copy(ros)
            _xf(r, _T(sx * (W / 2 - 0.0225), -0.0306, zz) @ _Rx(90))
            parts.append(r)
    C.remove(ros)
    ob = _join(parts, "Furniture_Whiteboard_Wall_01")
    ob["board_surface"] = [round(-x_in, 4), round(z_in0, 4), round(x_in, 4), round(z_in1, 4)]
    ob["board_surface_y"] = WB_SURF_Y
    return ob


SC_W, SC_H, SC_Z0, SC_D = 1.60, 0.92, 1.35, 0.08
SC_BEZEL = 0.009


def build_screen_wall(item=None):
    W, H, z0 = SC_W, SC_H, SC_Z0
    parts = []
    yf, yb = -SC_D, -SC_D + 0.030
    zc = z0 + H / 2
    hole = _rr(W / 2 - SC_BEZEL, H / 2 - SC_BEZEL, 0, zc)
    body = _plate("sc_body", _rpoly(_rect(W / 2, H / 2, 0, zc), 0.004, 0, 2), [hole], yf, yb, "plastic_dark", "xz", 0.0025, 2)
    parts.append(body)
    _panel.plane = "xz"
    parts.append(_panel("sc_screen", hole, yf + 0.0006, yb - 0.004, "screen"))
    # brushed edge band round the panel, set back from the bezel face
    band = _plate("sc_band", _rpoly(_rect(W / 2 + 0.0008, H / 2 + 0.0008, 0, zc), 0.0048, 0, 2),
                  [_rpoly(_rect(W / 2 - 0.004, H / 2 - 0.004, 0, zc), 0.002, 0, 2)], yf + 0.007, yb - 0.003, "aluminium", "xz", 0.001, 1, "x")
    parts.append(band)
    # rear housing, wall plate and two bracket arms
    parts.append(_bx("sc_house", (-0.42, yb - 0.001, zc - 0.25), (0.42, yb + 0.012, zc + 0.25), "plastic_dark", 0.006, 2, "x"))
    parts.append(_bx("sc_wallplate", (-0.30, -0.007, zc - 0.17), (0.30, 0.0, zc + 0.17), "iron", 0.002, 1, "x"))
    for sx in (-1, 1):
        parts.append(_bx("sc_arm", (sx * 0.20 - 0.018, -0.0071, zc - 0.20), (sx * 0.20 + 0.018, yb + 0.0125, zc + 0.20), "iron", 0.002, 1, "z"))
    # pilot light and a small brushed badge on the bottom bezel
    parts.append(_bx("sc_badge", (-0.028, yf - 0.0003, z0 + 0.0032), (0.028, yf + 0.001, z0 + 0.0052), "aluminium", 0.0003, 1, "x"))
    parts.append(_xf(_turn("sc_led", [(0.0012, 0.0), (0.0012, 0.0004), (0.0, 0.0006)], 8, "led_strip", caps=(False, False)),
                     _T(0.70, yf, z0 + 0.0045) @ _Rx(90)))
    ob = _join(parts, "Furniture_Screen_Wall_01")
    ob["screen_surface"] = [round(-W / 2 + SC_BEZEL, 4), round(z0 + SC_BEZEL, 4), round(W / 2 - SC_BEZEL, 4), round(z0 + H - SC_BEZEL, 4)]
    ob["screen_surface_y"] = round(yf + 0.0006, 4)
    return ob


# ---------------------------------------------------------------------------
# Gallery reading desk
# ---------------------------------------------------------------------------

GD_W, GD_D = 1.2, 0.6
GLEG = [(0.0170, 0.0), (0.0175, 0.006), (0.0200, 0.014), (0.0205, 0.022), (0.0172, 0.030), (0.0150, 0.040), (0.0160, 0.070),
        (0.0185, 0.150), (0.0212, 0.250), (0.0198, 0.320), (0.0165, 0.385), (0.0145, 0.410), (0.0182, 0.424), (0.0196, 0.436),
        (0.0168, 0.448), (0.0170, 0.470), (0.0215, 0.494), (0.0250, 0.508)]
G_SLOPE = (-0.29, 0.700, 0.155, 0.745)      # slope surface: (y_front, z_front, y_back, z_back)


def build_gallery_desk(item=None):
    W, D = GD_W, GD_D
    parts = []
    hw = 0.025
    lx, ly = W / 2 - 0.03 - hw, D / 2 - 0.03 - hw
    zb0, zb1 = 0.53, 0.655
    prof = [(r, z + 0.022) for r, z in GLEG]
    prof[-1] = (hw, zb0)
    leg = _leg("gd_leg", prof, hw, zb0, zb1, "walnut", 16, cup=(0.0175, 0.024))
    for sx in (-1, 1):
        for sy in (-1, 1):
            l = _copy(leg)
            _xf(l, _T(sx * lx, sy * ly, 0))
            parts.append(l)
    C.remove(leg)
    # aprons: the front one framed round a drawer
    xo, yo = lx + hw - 0.008, ly + hw - 0.008
    dr = _rr(0.25, 0.042, 0, (zb0 + zb1) / 2 - 0.002)
    parts.append(_plate("gd_apron_f", _rr(lx, (zb1 - zb0 - 0.01) / 2, 0, (zb0 + 0.01 + zb1) / 2), [dr], -yo, -yo + 0.02, "walnut", "xz", 0.002, 1, "x"))
    parts.append(_bx("gd_drawer", (-0.25 + 0.0015, -yo + 0.0012, dr[0][1] + 0.0015), (0.25 - 0.0015, -yo + 0.019, dr[2][1] - 0.0015),
                     "walnut", 0.0018, 2, "x"))
    bead = [(-0.0012, -0.0004), (-0.0012, 0.0018), (-0.0004, 0.0030), (0.0008, 0.0030), (0.0016, 0.0018), (0.0016, -0.0004)]
    parts.append(_uvb(_mitre_loft("gd_bead", [Vector((x, -yo, z)) for x, z in dr], (0, -1, 0), bead, "walnut"), "walnut", "x"))
    for sx in (-1, 1):
        k = _knob("gd_knob", 0.0095, 0.019)
        _xf(k, _T(sx * 0.12, -yo + 0.0012, (dr[0][1] + dr[2][1]) / 2) @ _Rx(90))
        parts.append(k)
    parts.append(_bx("gd_apron_b", (-lx, yo - 0.02, zb0 + 0.01), (lx, yo, zb1), "walnut", 0.002, 1, "x"))
    for sx in (-1, 1):
        parts.append(_bx("gd_apron_s", (sx * xo - 0.01, -ly, zb0 + 0.01), (sx * xo + 0.01, ly, zb1), "walnut", 0.002, 1, "y"))
    astr = [(0.003 * math.cos(a), 0.0035 + 0.0035 * math.sin(a)) for a in (math.tau * k / 10 for k in range(10))]
    per = [(-xo, -yo, zb0 + 0.010), (xo, -yo, zb0 + 0.010), (xo, yo, zb0 + 0.010), (-xo, yo, zb0 + 0.010)]
    parts.append(_uvb(_mitre_loft("gd_astr", per, (0, 0, 1), [(s - 0.003, h - 0.0035) for s, h in astr], "walnut"), "walnut", "x"))
    # turned H-stretcher
    zs = 0.13
    sp = [(r * 1.55, t) for r, t in FH.STRETCHER_PROFILE]
    for sx in (-1, 1):
        parts.append(FH._turn_between("gd_str", (sx * lx, -ly + 0.016, zs), (sx * lx, ly - 0.016, zs), sp, 12, "walnut"))
    parts.append(FH._turn_between("gd_strx", (-lx + 0.014, 0, zs), (lx - 0.014, 0, zs), sp, 12, "walnut"))
    # sloped body: wedge cheeks, front fascia and back rail on the aprons
    yf, zf, yb_, zb_ = G_SLOPE
    s = (zb_ - zf) / (yb_ - yf)
    th = 0.02
    under = lambda y: zf + s * (y - yf) - th / math.cos(math.atan(s))  # noqa: E731
    zl0 = 0.728
    cheek = [(-ly - hw, zb1), (ly + hw, zb1), (ly + hw, zl0), (yb_, zl0), (-ly - hw, under(-ly - hw))]
    for sx in (-1, 1):
        x0, x1 = (lx + hw - 0.022, lx + hw) if sx > 0 else (-lx - hw, -lx - hw + 0.022)
        parts.append(_plate("gd_cheek", cheek, [], x0, x1, "walnut", "yz", 0.002, 1, "y"))
    parts.append(_bx("gd_fascia", (-lx - hw + 0.02, -ly - hw, zb1), (lx + hw - 0.02, -ly - hw + 0.02, under(-ly - hw + 0.02) - 0.0005),
                     "walnut", 0.0015, 1, "x"))
    parts.append(_bx("gd_backrail", (-lx - hw + 0.02, ly + hw - 0.02, zb1), (lx + hw - 0.02, ly + hw, zl0), "walnut", 0.0015, 1, "x"))
    # the sloped reading board (moulded edge), with a leather inlay, gilt line and a book-rest lip
    ang = math.degrees(math.atan(s))
    Lr = (yb_ - yf) / math.cos(math.atan(s))
    Ms = _T(0, (yf + yb_) / 2, (zf + zb_) / 2) @ _Rx(ang)
    xb = W / 2 - 0.005
    board = _top("gd_slope", xb, Lr / 2, 0.0, th, "walnut", radius=0.006, rr=0.007)
    _xf(board, Ms)
    parts.append(_uvb(board, "walnut", "x"))
    lw, ll, lc = xb - 0.07, Lr / 2 - 0.075, 0.018
    inl = _slab("gd_leather", _rect(lw, ll, 0, lc), 0.004, [(0.0, -0.0004), (0.0, 0.0004), (0.0006, 0.0007)], 2, "leather_green")
    _xf(inl, Ms)
    parts.append(_uvb(inl, "leather_green"))
    gl = [Ms @ Vector((x, y, 0.0007)) for x, y in _rect(lw - 0.014, ll - 0.014, 0, lc)]
    nrm = (Ms.to_3x3() @ Vector((0, 0, 1))).normalized()
    parts.append(_uvb(_mitre_loft("gd_gilt", gl, nrm, [(0.0, -0.0002), (0.0016, -0.0002), (0.0016, 0.00028), (0.0, 0.00028)], "gilt"), "gilt"))
    lip = [(-Lr / 2 + 0.012, -0.001), (-Lr / 2 + 0.030, -0.001), (-Lr / 2 + 0.030, 0.010), (-Lr / 2 + 0.027, 0.016),
           (-Lr / 2 + 0.021, 0.0195), (-Lr / 2 + 0.015, 0.018), (-Lr / 2 + 0.012, 0.012)]
    lp = _extrude("gd_lip", lip, xb - 0.045, -(xb - 0.045), "walnut", "yz", 0.0015, 1)
    _xf(lp, Ms)
    parts.append(_uvb(lp, "walnut", "x"))
    for sx in (-1, 1):
        cap = _turn("gd_lipcap", [(0.0, 0.0), (0.0082, 0.0), (0.0085, 0.0012), (0.0060, 0.0028), (0.0, 0.0034)], 14, "brass",
                    caps=(False, False))
        _xf(cap, Ms @ _T(sx * (xb - 0.045), -Lr / 2 + 0.021, 0.008) @ _Ry(90 * sx))
        parts.append(cap)
    # level pen ledge at the back with a groove
    ledge = [(yb_, zl0), (D / 2, zl0), (D / 2, 0.752), (D / 2 - 0.004, 0.7585), (D / 2 - 0.010, 0.76), (0.236, 0.76)]
    gc, gr = 0.212, 0.022
    ledge += [(gc + gr * math.cos(a), 0.7605 - 0.0065 * math.sin(a)) for a in (D2R(t) for t in (20, 55, 90, 125, 160))]
    ledge += [(0.170, 0.76), (yb_ + 0.008, 0.76), (yb_ + 0.003, 0.7585), (yb_, 0.754)]
    lg = _extrude("gd_ledge", ledge, -xb, xb, "walnut", "yz", 0.0015, 1)
    parts.append(_uvb(lg, "walnut", "x"))
    return _join(parts, "Furniture_Desk_Gallery_01")


# ---------------------------------------------------------------------------
# Card catalogue
# ---------------------------------------------------------------------------

K_W, K_D, K_H = 1.4, 0.6, 1.15
K_STAND = 0.40
K_X = 0.672                 # case outer faces
K_YF, K_YB = -0.272, 0.285
K_Z0, K_Z1 = 0.44, 1.085    # case body
K_COLS, K_ROWS = 8, 5
K_DIV = 0.012
K_GRID = (-0.634, 0.634, 0.468, 1.052)
K_OPEN = (2, 5)             # (row from the top, column) of the drawer pulled out
K_PULL = 0.20
KLEG = [(0.0185, 0.0), (0.0200, 0.006), (0.0232, 0.016), (0.0236, 0.024), (0.0200, 0.034), (0.0182, 0.046), (0.0205, 0.090),
        (0.0236, 0.140), (0.0225, 0.185), (0.0185, 0.222), (0.0170, 0.240), (0.0215, 0.252), (0.0228, 0.262), (0.0195, 0.274),
        (0.0215, 0.286), (0.0250, 0.296), (0.0275, 0.302)]


def _cells():
    x0, x1, z0, z1 = K_GRID
    w = (x1 - x0 - (K_COLS - 1) * K_DIV) / K_COLS
    h = (z1 - z0 - (K_ROWS - 1) * K_DIV) / K_ROWS
    out = []
    for r in range(K_ROWS):
        for c in range(K_COLS):
            cx = x0 + w / 2 + c * (w + K_DIV)
            cz = z1 - h / 2 - r * (h + K_DIV)
            out.append((r, c, cx, cz))
    return out, w, h


def _quad_y(name, x0, z0, x1, z1, y, key):
    """A single quad in the XZ plane at y, facing -Y (labels and ink lines that are only seen from the front)."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z)) for x, z in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
    bm.faces.new(vs)
    ob = _finish(bm, name, key, 30, recalc=False)
    return _uvb(ob, key, "x")


def _front_shell(name, hw, hh, depth, ch, key):
    """A drawer front seen only from the front: a chamfered face (ch) and its four sides back to `depth`
    (+Y); the back stays open inside the carcase. 18 triangles."""
    bm = bmesh.new()
    rings = []
    for y, d in ((depth, 0.0), (ch, 0.0), (0.0, ch)):
        rings.append([bm.verts.new((x, y, z)) for x, z in _rr(hw - d, hh - d)])
    for A, B in zip(rings, rings[1:]):
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((A[i], A[j], B[j], B[i]))
    bm.faces.new(rings[-1])
    bm.normal_update()
    for f in bm.faces:
        if f.normal.y > 0.5 or (f.calc_center_median() - Vector((0, depth / 2, 0))).dot(f.normal) < 0:
            f.normal_flip()
    ob = _finish(bm, name, key, 30, recalc=False)
    _uvb(ob, key, "x")
    C.weighted_normals(ob)
    return ob


def _card_drawer_front(w, h):
    """One drawer front at the origin (face at y = 0, toward -Y): oak front, brass label holder with an inked
    card, ring pull on a rosette and the rod nut."""
    g = 0.0015
    parts = [_front_shell("kd_front", w / 2 - g, h / 2 - g, 0.018, 0.0026, "oak")]
    lw, lh, lz = 0.027, 0.0135, 0.026
    fr = [Vector((x, -0.0001, z)) for x, z in _rr(lw, lh, 0, lz)]
    parts.append(_uvb(_mitre_loft("kd_holder", fr, (0, -1, 0), [(0.0, 0.0), (0.0042, 0.0), (0.0042, 0.0011), (0.0012, 0.0016),
                                                                  (0.0, 0.0012)], "brass"), "brass", "x"))
    parts.append(_quad_y("kd_card", -lw + 0.003, lz - lh + 0.003, lw - 0.003, lz + lh - 0.003, -0.0004, "label_card"))
    for dz, ww in ((0.004, 0.017), (-0.0035, 0.011)):
        parts.append(_quad_y("kd_ink", -ww, lz + dz - 0.0011, ww, lz + dz + 0.0011, -0.0006, "label_ink"))
    pz = 0.004
    ros = _turn("kd_rose", [(0.0, 0.0), (0.0078, 0.0), (0.0080, 0.0009), (0.0055, 0.0026), (0.0, 0.0036)], 8,
                "brass", caps=(False, False))
    parts.append(_xf(ros, _T(0, 0, pz) @ _Rx(90)))
    ring = C.torus("kd_ring", 0.0102, 0.0019, (0, -0.0036, pz - 0.0102), _mat("brass"), 12, 4, rot=C.rotx(90))
    parts.append(_uvb(ring, "brass", "x"))
    nut = _turn("kd_nut", [(0.0045, 0.0), (0.0045, 0.0018), (0.0, 0.0030)], 6, "brass_aged", caps=(False, False))
    parts.append(_xf(nut, _T(0, 0, -h / 2 + 0.017) @ _Rx(90)))
    return _join(parts, "kd")


def _open_drawer(w, h):
    """The pulled-out drawer's box with index cards, tabbed guides and the brass rod (front face at y = 0)."""
    parts = []
    g = 0.0015
    L = 0.42
    iw = w - 2 * g - 0.004
    zb = -h / 2 + 0.006
    zt = h / 2 - 0.020
    for sx in (-1, 1):
        parts.append(_bx("ko_side", (sx * iw / 2 - 0.003, 0.018, zb), (sx * iw / 2 + 0.003, L, zt), "oak_light", 0.0012, 1, "y"))
    parts.append(_bx("ko_bottom", (-iw / 2 + 0.003, 0.018, zb), (iw / 2 - 0.003, L, zb + 0.005), "oak_light", 0.0, 1, "y"))
    parts.append(_bx("ko_back", (-iw / 2 + 0.003, L - 0.008, zb), (iw / 2 - 0.003, L, zt - 0.006), "oak_light", 0.0012, 1, "x"))
    cw = iw / 2 - 0.0045
    rng = random.Random(5)
    y = 0.040
    k = 0
    z0 = zb + 0.005
    while y < L - 0.05:
        guide = k % 9 == 0
        ch = 0.076 if not guide else 0.082
        lean = rng.uniform(-9, -4) if y < L - 0.12 else rng.uniform(-22, -14)
        key = "label_card" if guide else "paper"
        if guide:
            tx = (-1 + (k // 9 % 3)) * 0.035
            outline = [(-cw, 0), (cw, 0), (cw, 0.074), (tx + 0.02, 0.074), (tx + 0.016, ch), (tx - 0.016, ch), (tx - 0.02, 0.074),
                       (-cw, 0.074)]
            c = _plate("ko_guide", outline, [], -0.00045, 0.00045, key, "xz")
        else:
            c = _bx("ko_card", (-cw, -0.0002, 0.0), (cw, 0.0002, ch), key)
        _xf(c, _T(0, y, z0) @ _Rx(lean))
        parts.append(c)
        y += 0.0062 + rng.uniform(-0.001, 0.0015)
        k += 1
    rod = C.cylinder("ko_rod", 0.0021, 0.0021, L - 0.01, (0, L / 2 + 0.002, -h / 2 + 0.017), _mat("brass_aged"), 10, rot=C.rotx(90))
    parts.append(_uvb(rod, "brass_aged", "y"))
    return parts


def build_catalogue_cabinet(item=None):
    parts = []
    # stand: turned legs on brass cups, aprons, H-stretcher
    hw = 0.0275
    lx = K_X - hw
    lyf, lyb = K_YF + hw, K_YB - hw
    zb0 = 0.322
    prof = [(r, z + 0.02) for r, z in KLEG]
    prof[-1] = (hw, zb0)
    leg = _leg("kc_leg", prof, hw, zb0, K_STAND, "walnut", 12, cup=(0.019, 0.022), cup_seg=12)
    for sx in (-1, 1):
        for y in (lyf, lyb):
            l = _copy(leg)
            _xf(l, _T(sx * lx, y, 0))
            parts.append(l)
    C.remove(leg)
    za0 = 0.33
    parts.append(_bx("kc_apron", (-lx, K_YF + 0.006, za0), (lx, K_YF + 0.026, K_STAND), "walnut", 0.002, 1, "x"))
    parts.append(_bx("kc_apron", (-lx, K_YB - 0.026, za0), (lx, K_YB - 0.006, K_STAND), "walnut", 0.002, 1, "x"))
    for sx in (-1, 1):
        parts.append(_bx("kc_apron", (sx * (K_X - 0.006) - 0.01, lyf, za0), (sx * (K_X - 0.006) + 0.01, lyb, K_STAND), "walnut", 0.002, 1, "y"))
    astr = [(0.003 * math.cos(a), 0.0035 + 0.0035 * math.sin(a)) for a in (math.tau * k / 10 for k in range(10))]
    per = [(-K_X + 0.006, K_YF + 0.006, za0), (K_X - 0.006, K_YF + 0.006, za0), (K_X - 0.006, K_YB - 0.006, za0),
           (-K_X + 0.006, K_YB - 0.006, za0)]
    parts.append(_uvb(_mitre_loft("kc_astr", per, (0, 0, 1), [(s - 0.003, h - 0.0035) for s, h in astr], "walnut"), "walnut", "x"))
    sp = [(r * 1.7, t) for r, t in FH.STRETCHER_PROFILE]
    for sx in (-1, 1):
        parts.append(FH._turn_between("kc_str", (sx * lx, lyf + 0.017, 0.11), (sx * lx, lyb - 0.017, 0.11), sp, 10, "walnut"))
    parts.append(FH._turn_between("kc_strx", (-lx + 0.016, (lyf + lyb) / 2, 0.11), (lx - 0.016, (lyf + lyb) / 2, 0.11), sp, 10, "walnut"))
    # moulded base under the case
    bprof = [(-0.012, K_STAND), (-0.012, K_STAND + 0.014), (-0.0105, K_STAND + 0.019), (-0.0075, K_STAND + 0.024), (-0.004, K_STAND + 0.030),
             (-0.0015, K_STAND + 0.036), (0.0, K_STAND + 0.040)]
    base = _slab("kc_base", _rect(K_X, (K_YB - K_YF) / 2, 0, (K_YB + K_YF) / 2), 0.004, [(d, z) for d, z in bprof], 2, "walnut")
    parts.append(_uvb(base, "walnut", "x"))
    # case: panelled sides, plain back, a face frame with the 8 x 5 drawer grid
    for sx in (-1, 1):
        x0, x1 = (K_X - 0.025, K_X) if sx > 0 else (-K_X, -K_X + 0.025)
        hole = _rr((K_YB - K_YF) / 2 - 0.065, (K_Z1 - K_Z0) / 2 - 0.065, (K_YB + K_YF) / 2 + 0.01, (K_Z0 + K_Z1) / 2)
        parts.append(_plate("kc_side", _rr((K_YB - K_YF - 0.02) / 2, (K_Z1 - K_Z0) / 2, (K_YB + K_YF + 0.02) / 2, (K_Z0 + K_Z1) / 2),
                            [hole], x0, x1, "walnut", "yz", 0.002, 1, "z"))
        _panel.plane = "yz"
        parts.append(_panel("kc_sidep", hole, x0 + 0.005, x1 - 0.005, "walnut", "z"))
    parts.append(_bx("kc_back", (-K_X + 0.02, K_YB - 0.02, K_Z0), (K_X - 0.02, K_YB, K_Z1), "walnut", 0.0, 1, "z"))
    cells, w, h = _cells()
    holes = [_rr(w / 2, h / 2, cx, cz) for _r, _c, cx, cz in cells]
    yf0, yf1 = K_YF, K_YF + 0.02
    parts.append(_plate("kc_face", _rr(K_X, (K_Z1 - K_Z0) / 2, 0, (K_Z0 + K_Z1) / 2), holes, yf0, yf1, "walnut", "xz", 0.0, 1, "x"))
    # dark cavity lining behind the pulled drawer, and a back stop behind the others
    front = _card_drawer_front(w, h)
    opened = None
    for r, c, cx, cz in cells:
        if (r, c) == K_OPEN:
            opened = (cx, cz)
            continue
        d = _copy(front)
        _xf(d, _T(cx, yf0 + 0.0015, cz))
        parts.append(d)
    cx, cz = opened
    d = _copy(front)
    _xf(d, _T(cx, yf0 + 0.0015 - K_PULL, cz))
    parts.append(d)
    for p in _open_drawer(w, h):
        _xf(p, _T(cx, yf0 + 0.0015 - K_PULL, cz))
        parts.append(p)
    C.remove(front)
    lin = _plate("kc_cavity", _rr(w / 2 + 0.002, h / 2 + 0.002, cx, cz), [], yf1 - 0.001, K_YB - 0.03, "walnut_dark", "xz")
    for poly in lin.data.polygons:
        poly.flip()
    lin.data.update()
    parts.append(lin)
    # cornice and top
    cprof = [(0.0, 0.0), (0.0, 0.006), (0.0035, 0.0075), (0.0035, 0.010), (0.0075, 0.012), (0.012, 0.016), (0.016, 0.022),
             (0.019, 0.029), (0.021, 0.033), (0.024, 0.033), (0.024, 0.036), (0.0, 0.036)]
    path = [(K_X, K_YB, K_Z1), (K_X, K_YF, K_Z1), (-K_X, K_YF, K_Z1), (-K_X, K_YB, K_Z1)]
    cor = C.sweep("kc_cornice", [(-u, v) for u, v in cprof] + [(0.0, 0.0)], path, _mat("walnut"), cap=True, smooth_angle=35)
    parts.append(_uvb(cor, "walnut", "x"))
    parts.append(_bx("kc_lid", (-K_X + 0.01, K_YF + 0.01, K_Z1), (K_X - 0.01, K_YB - 0.002, K_Z1 + 0.036), "walnut", 0.0, 1, "x"))
    parts.append(_top("kc_top", K_W / 2, (K_D - 0.01) / 2, K_H, K_H - K_Z1 - 0.036, "walnut", radius=0.008, rr=0.008,
                      cy=-0.005))
    return _join(parts, "Furniture_Catalogue_Cabinet_01")


KIND_BUILDERS = {
    "carrel": build_carrel,
    "desk_quiet": build_desk_quiet,
    "table_group_rect": build_table_group_rect,
    "table_group_round": build_table_group_round,
    "whiteboard_wall": build_whiteboard_wall,
    "screen_wall": build_screen_wall,
    "gallery_desk": build_gallery_desk,
    "catalogue_cabinet": build_catalogue_cabinet,
}


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

class _Item:
    def __init__(self, kind, seed=0):
        self.kind, self.seed, self.label, self.w, self.d = kind, seed, "", None, None


def _studio(objs, size=(960, 960)):
    return FH._studio(objs, 48, size)


def _shot(out_dir, name, target, yaw, pitch, dist, lens=50):
    return FH._shot(os.path.join(out_dir, name + ".png"), target, yaw, pitch, dist, lens)


def _report(tri):
    for k, v in tri.items():
        print(f"TRIS {k}: {v}")


def _wall(y=0.0, w=4.0, h=3.0, key="plaster"):
    wall = _bx("Preview_Wall", (-w / 2, y, 0.0), (w / 2, y + 0.2, h), key)
    return wall


def preview_carrel(out_dir):
    tri = {}
    C.reset_scene()
    ob = build_carrel(_Item("carrel", 0))
    tri[ob.name] = C.tris(ob)
    _studio([ob])
    _shot(out_dir, "carrel_1", (0, 0, 0.68), 28, 14, 3.4)
    _shot(out_dir, "carrel_2", (0, 0, 0.68), -40, 22, 3.4)
    _shot(out_dir, "carrel_3", (0, 0, 0.68), 145, 12, 3.4)
    _shot(out_dir, "carrel_side", (0, 0, 0.68), 90, 2, 3.6)
    _shot(out_dir, "carrel_desk", (0.0, 0.05, 0.95), -14, 30, 1.25)
    _shot(out_dir, "carrel_lamp", (0.0, C_LAMP_Y, 1.06), 18, -14, 0.62)
    _shot(out_dir, "carrel_strip", (0.215, C_BACK_Y[0], C_DESK + 0.025), -12, 22, 0.34)
    _shot(out_dir, "carrel_grommet", (GROMMET_XY[0], GROMMET_XY[1], C_DESK), 20, 48, 0.22)
    _shot(out_dir, "carrel_shelf", (-0.2, 0.2, 1.2), 22, 8, 0.85)
    for seed in (1, 2, 3):
        C.reset_scene()
        ob = build_carrel(_Item("carrel", seed))
        tri[ob.name] = C.tris(ob)
        _studio([ob])
        _shot(out_dir, f"carrel_v{seed}", (0.0, 0.0, 0.88), -18, 34, 1.7)
    # lamplight at night with a reading chair pulled in
    C.reset_scene()
    ob = build_carrel(_Item("carrel", 1))
    chair = FH.build_chair_reading()
    chair.location = (0.0, -0.62, 0.0)
    chair.rotation_euler = (0, 0, math.pi)
    FH._night(bpy.context.scene, 0.04)
    FH._light_lamps([ob], 18.0)
    R.area_light("Window", (-2.5, -2.0, 2.4), (0, 0, 0.9), 40, 2.0, (0.72, 0.82, 1.0))
    _shot(out_dir, "carrel_lit", (0.0, -0.05, 0.95), -24, 14, 2.4, 40)
    _shot(out_dir, "carrel_lit_close", (0.0, 0.1, 0.95), 10, 22, 1.1, 40)
    _report(tri)


def preview_desks(out_dir):
    tri = {}
    for fn, nm, tgt, dist in ((build_desk_quiet, "desk_quiet", (0, 0, 0.42), 3.4), (build_gallery_desk, "gallery_desk", (0, 0, 0.42), 2.7)):
        C.reset_scene()
        ob = fn()
        tri[ob.name] = C.tris(ob)
        _studio([ob])
        _shot(out_dir, nm + "_1", tgt, 28, 16, dist)
        _shot(out_dir, nm + "_2", tgt, -40, 26, dist)
        _shot(out_dir, nm + "_3", tgt, 150, 14, dist)
        _shot(out_dir, nm + "_side", tgt, 90, 2, dist)
        if nm == "desk_quiet":
            _shot(out_dir, nm + "_pulls", (0.57, -0.38, 0.55), -22, 10, 0.75)
            _shot(out_dir, nm + "_top", (0.3, -0.1, 0.76), 20, 42, 0.9)
        else:
            _shot(out_dir, nm + "_slope", (0.25, -0.05, 0.72), 30, 26, 0.9)
            _shot(out_dir, nm + "_leg", (0.545, -0.245, 0.3), -30, 6, 1.0)
    _report(tri)


def preview_tables(out_dir):
    tri = {}
    for fn, nm, dist in ((build_table_group_rect, "table_rect", 4.6), (build_table_group_round, "table_round", 3.4)):
        C.reset_scene()
        ob = fn()
        tri[ob.name] = C.tris(ob)
        _studio([ob])
        _shot(out_dir, nm + "_1", (0, 0, 0.38), 28, 18, dist)
        _shot(out_dir, nm + "_2", (0, 0, 0.38), -50, 30, dist)
        _shot(out_dir, nm + "_low", (0, 0, 0.38), 20, 2, dist)
        if nm == "table_rect":
            _shot(out_dir, nm + "_module", (0.6, 0.0, GT_H), 24, 46, 0.32)
            _shot(out_dir, nm + "_under", (0.0, 0.0, 0.45), 15, -8, 1.6)
            _shot(out_dir, nm + "_leg", (1.1, -0.5, 0.35), -32, 6, 1.0)
        else:
            _shot(out_dir, nm + "_module", (0.0, 0.0, GT_H), 24, 50, 0.3)
            _shot(out_dir, nm + "_base", (0.0, 0.0, 0.25), 25, 10, 1.6)
    _report(tri)


def preview_boards(out_dir):
    tri = {}
    C.reset_scene()
    wb = build_whiteboard_wall()
    tri[wb.name] = C.tris(wb)
    sc = build_screen_wall()
    tri[sc.name] = C.tris(sc)
    sc.location = (2.4, 0, 0)
    wall = _wall(0.0, 7.0, 3.0)
    wall.location.x = 1.2
    _studio([wb, sc])
    _shot(out_dir, "boards_1", (1.2, 0, 1.55), -12, 6, 5.2)
    _shot(out_dir, "whiteboard_1", (0, 0, 1.47), -20, 8, 2.9)
    _shot(out_dir, "whiteboard_tray", (-0.2, -0.04, WB_Z0 + 0.02), -28, 32, 0.6)
    _shot(out_dir, "whiteboard_corner", (-0.98, -0.02, WB_Z0 + WB_H - 0.03), -38, 20, 0.32)
    _shot(out_dir, "screen_1", (2.4, 0, SC_Z0 + SC_H / 2), -24, -6, 2.4)
    _shot(out_dir, "screen_side", (2.4 + 0.8, -0.04, SC_Z0 + 0.1), -78, -10, 0.6)
    _report(tri)


def preview_catalogue(out_dir):
    tri = {}
    C.reset_scene()
    ob = build_catalogue_cabinet()
    tri[ob.name] = C.tris(ob)
    _studio([ob])
    _shot(out_dir, "catalogue_1", (0, 0, 0.6), 26, 14, 3.4)
    _shot(out_dir, "catalogue_2", (0, 0, 0.6), -42, 24, 3.4)
    _shot(out_dir, "catalogue_3", (0, 0, 0.6), 150, 12, 3.4)
    _shot(out_dir, "catalogue_side", (0, 0, 0.6), 90, 2, 3.4)
    cells, w, h = _cells()
    cx, cz = next((cx, cz) for r, c, cx, cz in cells if (r, c) == K_OPEN)
    _shot(out_dir, "catalogue_drawer", (cx, K_YF - 0.2, cz + 0.02), -24, 34, 0.75)
    _shot(out_dir, "catalogue_fronts", (-0.3, K_YF, 0.86), -16, 8, 0.6)
    _shot(out_dir, "catalogue_pull", (-0.40, K_YF, 0.92), -20, 10, 0.24)
    _report(tri)


def preview_rooms(out_dir):
    """Cycles vignettes: a quiet-study corner and a group-study table with its board."""
    import plan as P  # noqa: F401
    C.reset_scene()
    scene = bpy.context.scene
    R.engine(scene, "CYCLES", 32, (1280, 800))
    R.world(scene, (0.55, 0.6, 0.7), 0.25)
    floor = _bx("Preview_Floor", (-4, -4, -0.02), (4, 4, 0.0), "carpet_quiet")
    _uvb(floor, "carpet_quiet")
    _wall(1.0, 8.0, 3.2, "plaster")
    side = _bx("Preview_WallSide", (-3.1, -4.0, 0.0), (-2.9, 1.0, 3.2), "plaster")
    del side
    chair = FH.build_chair_reading()
    chair.location = (-3.6, -3.6, 0.0)
    objs = []
    for i, seed in enumerate((0, 1, 2)):
        c = build_carrel(_Item("carrel", seed))
        c.location = (-2.2 + i * 1.3, 1.0 - CD / 2, 0)
        objs.append(c)
        ch = C.instance(chair, f"Preview_Chair_{i}", (c.location.x, c.location.y - 0.62, 0), math.pi)
        del ch
    dq = build_desk_quiet()
    dq.location = (2.0, -1.4, 0)
    C.instance(chair, "Preview_Chair_dq", (2.0, -2.02, 0), math.pi)
    lamp = FH.build_lamp_banker_green()
    lamp.location = (2.45, -1.25, QH)
    FH._light_lamps(objs + [lamp], 16.0)
    R.area_light("Window", (-1.0, -5.0, 2.8), (0, 0, 0.8), 260, 3.0, (0.85, 0.9, 1.0))
    sun = R.sun("Sun", (0.4, 0.5, 1.0), 2.0)
    del sun
    cam = R.camera(lens=28)
    R.look(cam, (2.6, -4.4, 1.62), (-0.6, 0.4, 0.85))
    R.render(os.path.join(out_dir, "room_quiet.png"))
    # group corner
    C.reset_scene()
    scene = bpy.context.scene
    R.engine(scene, "CYCLES", 32, (1280, 800))
    R.world(scene, (0.55, 0.6, 0.7), 0.3)
    floor = _bx("Preview_Floor", (-5, -5, -0.02), (5, 5, 0.0), "oak_boards")
    _uvb(floor, "oak_boards", "x")
    _wall(1.0, 9.0, 3.4, "plaster_green")
    t = build_table_group_rect()
    t.location = (-1.4, -0.6, 0)
    tr = build_table_group_round()
    tr.location = (1.9, -0.9, 0)
    wb = build_whiteboard_wall()
    wb.location = (-1.4, 1.0, 0)
    sc = build_screen_wall()
    sc.location = (1.9, 1.0, 0)
    chair = FH.build_chair_reading()
    chair.location = (-6, -6, 0)
    for k, (dx, dy, rot) in enumerate(((-0.6, -0.95, math.pi), (0.6, -0.95, math.pi), (-0.6, 0.95, 0), (0.6, 0.95, 0),
                                       (-1.6, 0, math.pi / 2), (1.6, 0, -math.pi / 2))):
        C.instance(chair, f"Preview_GChair_{k}", (-1.4 + dx, -0.6 + dy, 0), rot)
    for c in range(5):
        a = math.pi / 2 + c * 2 * math.pi / 5
        x, y = 1.9 + math.cos(a) * 1.1, -0.9 + math.sin(a) * 1.1
        C.instance(chair, f"Preview_RChair_{c}", (x, y, 0), math.atan2(-(1.9 - x), (-0.9 - y)) + math.pi)
    R.area_light("Window", (0.0, -5.0, 3.0), (0, 0, 0.8), 320, 3.5, (0.9, 0.93, 1.0))
    R.area_light("Ceiling", (0.0, -0.5, 3.3), (0, -0.5, 0), 180, 4.0, (1.0, 0.85, 0.66))
    cam = R.camera(lens=26)
    R.look(cam, (0.3, -5.4, 1.75), (0.2, 0.2, 0.95))
    R.render(os.path.join(out_dir, "room_group.png"))


def preview(out_dir):
    preview_carrel(out_dir)
    preview_desks(out_dir)
    preview_tables(out_dir)
    preview_boards(out_dir)
    preview_catalogue(out_dir)
    preview_rooms(out_dir)
