"""
Digital and support furniture for the Computers & Printing room and the services corridor (milestone 2).

KIND_BUILDERS (plan.KINDS sizes). Each builder(item) returns ONE joined multi-material mesh at the origin,
floor at z = 0, front (where the person sits or stands) facing Blender -Y:

  desk_computer    1.30 x 0.70 x 0.75 workstation. A honey-oak top (moulded thumbnail edge) with a brass cable
                   grommet (slotted dark cap, the monitor cable dropping into it) and a flush brass power/USB module
                   (two sockets, two USB, pilot light); a slim thin-bezel monitor on an aluminium stand showing a dim
                   catalogue-search UI built from blocks; a full-size keyboard (101 individual caps on a sloped
                   aluminium case), a mouse on a leather pad; a compact PC (brushed front, brass power ring) in an
                   iron cradle under the top; an iron cable tray with a power strip and cable loom under the back
                   edge. item.seed picks the variant:
                     0  walnut frame (tapered legs on brass sabots, aprons, a fielded modesty panel), 24" monitor,
                        PC on the right, a closed book;
                     1  blackened-iron sled frame (end frames, back beam, brass glides), 27" monitor, a mini PC
                        on the desk, a green leather pad, two stacked books;
                     2  walnut frame, 24" monitor, PC on the left, a notepad and pencil.
                   Custom props: screen_surface = [x0, z0, x1, z1] (local; the emissive screen rectangle, its plane
                   at y = screen_surface_y, facing -Y) and front_flipped (see below).
  chair_task       0.60 x 0.60 x 1.00 ergonomic task chair, seat surface at 0.47, sitter facing -Y: dark-bronze
                   five-star base (brass hub ring) on twin-wheel casters, gas lift in a dark shroud, tilt mechanism
                   with tension knob and height lever, a deep crowned cushion with a waterfall front on a moulded
                   walnut seat shell, a curved, lumbar-shaped upholstered back on a moulded walnut shell held by a
                   bronze spine with brass bolts, J-shaped bronze arms with upholstered pads.
                   seed even: cognac leather, odd: green wool with green leather arm pads.
  printer_station  1.20 x 0.65 x 1.20 oak counter cabinet (moulded top, panelled sides, two frame-and-panel doors
                   with brass knobs, an open bay with a shelf of wrapped paper reams, walnut plinth) carrying an
                   ivory multifunction printer/scanner (two paper cassettes, output bay with prints, flatbed with
                   document feeder, tilted control panel with a small screen, keypad and start key), a walnut
                   two-tier letter tray with paper, and a green-and-gilt "Print & Scan" desk sign in a brass frame.
  water_station    0.60 x 0.35 x 1.50 floor-standing bottle-refill station, back on the wall at y = +0.175:
                   brushed-steel tower with rounded front corners, a brass-framed steel bottle niche (brass spout,
                   dark sensor window with status light, LED wash light, brass-rimmed drip tray with a grate filling
                   the niche floor), a manual push button, a
                   louvred chiller grille, brass kick plate and top band, and a green-and-gilt "Water Refill" plate.

Plan note: the plan's computer desks are rotated so that their front faces AWAY from their chairs (desk rot ==
chair rot; carrels and the quiet desks use rot + PI). build_desk_computer therefore looks the item's chair up in
plan.ITEMS and, when it sits behind the desk, turns the mesh 180 degrees (custom prop front_flipped = True, with
screen_surface flipped to match) so the screen faces the student either way.

preview(out_dir) builds everything and renders EEVEE studio views, close-ups and a row of three workstations
with chairs and a 1.7 m figure for scale. Smaller entry points: preview_desk, preview_chair, preview_printer,
preview_water, preview_row.
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
# Screen UI placeholder blocks (dim slate text bars, warm amber accents) and a neutral brushed steel.
LM.PALETTE.setdefault("screen_ui", dict(base="#2f4256", rough=0.25, emission="#7d98b6", emit=0.55))
LM.PALETTE.setdefault("screen_band", dict(base="#22364d", rough=0.25, emission="#3d5d82", emit=0.6))
LM.PALETTE.setdefault("screen_hi", dict(base="#4a3820", rough=0.25, emission="#c79a55", emit=0.55))
LM.PALETTE.setdefault("steel_brushed", dict(base="#a9abad", rough=0.3, metal=1.0, tex="brushed", size=0.3, normal=0.1))

_mat = FH._mat
_T, _Rx, _Ry, _Rz = FH._T, FH._Rx, FH._Ry, FH._Rz
_xf, _bx, _uvb, _turn, _slab, _rect, _rpoly = FH._xf, FH._bx, FH._uvb, FH._turn, FH._slab, FH._rect, FH._rpoly
_copy, _tube, _cap, _finish, _bridge, _circle, _loft = (FH._copy, FH._tube, FH._cap, FH._finish, FH._bridge,
                                                        FH._circle, FH._loft)
_bridge_o, _ngon, _catmull = FH._bridge_o, FH._ngon, FH._catmull
D2R = math.radians
GEORGIA = "/System/Library/Fonts/Supplemental/Georgia.ttf"


# ---------------------------------------------------------------------------
# Geometry helpers
# ---------------------------------------------------------------------------

def _join(parts, name):
    return FH._join([p for p in parts if p is not None], name)


def _clean_slots(ob):
    """Drops empty or unused material slots (the boolean cutters leave one) and remaps the faces."""
    me = ob.data
    used = sorted({p.material_index for p in me.polygons if me.materials[p.material_index] is not None})
    mats = [me.materials[i] for i in used]
    remap = {old: new for new, old in enumerate(used)}
    idx = [remap.get(p.material_index, 0) for p in me.polygons]
    me.materials.clear()
    for m in mats:
        me.materials.append(m)
    for p, i in zip(me.polygons, idx):
        p.material_index = i
    me.update()
    return ob


def _rr(hw, hh, cx=0.0, cy=0.0):
    return [(cx - hw, cy - hh), (cx + hw, cy - hh), (cx + hw, cy + hh), (cx - hw, cy + hh)]


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
    """A board between a0 and a1 along the plane's normal (xz: Y, yz: X, xy: Z), outline `outer` with
    through `holes` (frames, face frames, trims). Closed and manifold."""
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


def _panel(name, hole, a0, a1, key, plane="xz", grain=None, grow=0.002, bevel_w=0.0):
    """A panel filling `hole`, grown `grow` into the surrounding frame (its edges are buried)."""
    return _plate(name, _offset(hole, -grow), [], a0, a1, key, plane, bevel_w, 1, grain)


def _top(name, hw, hl, z1, thick, key, radius=0.012, rr=0.006, grain="x", cx=0.0, cy=0.0, cutters=(), seg=4):
    """A moulded top: eased underside, straight edge band and a thumbnail round-over."""
    z0 = z1 - thick
    u = min(0.006, thick * 0.3)
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


def _pill(name, hw, hh, r, z0, z1, key, ease=0.0, seg=3, cx=0.0, cy=0.0, grain=None, radii=None):
    """Rounded-rectangle slab in XY from z0 to z1 with eased top and bottom arrises."""
    e = min(ease, (z1 - z0) * 0.45)
    prof = [(e, z0), (e * 0.3, z0 + e * 0.45), (0.0, z0 + e), (0.0, z1 - e), (e * 0.3, z1 - e * 0.45), (e, z1)] if e > 0 \
        else [(0.0, z0), (0.0, z1)]
    ob = _slab(name, _rect(hw, hh, cx, cy), radii if radii is not None else r, prof, seg, key)
    return _uvb(ob, key, grain)


def _face_front(ob):
    """Turns a part built in XY (extruded along +Z) to stand up facing -Y: +Z -> -Y, +Y -> +Z."""
    return _xf(ob, _Rx(90))


def _soft(name, X, Y, Z, key, levels=2, smooth=75.0, merge=(False, False)):
    """Upholstery: a box cage with control loops at X/Y/Z (outer values are the faces), Catmull-Clark
    subdivided into a soft cushion whose flat centre keeps the cage's face planes exactly."""
    bm = bmesh.new()
    V = {}
    nx, ny, nz = len(X) - 1, len(Y) - 1, len(Z) - 1

    def v(i, j, k):
        if (i, j, k) not in V:
            V[(i, j, k)] = bm.verts.new((X[i], Y[j], Z[k]))
        return V[(i, j, k)]

    def rim(k):
        return ([v(i, 0, k) for i in range(nx + 1)] + [v(nx, j, k) for j in range(1, ny + 1)]
                + [v(i, ny, k) for i in range(nx - 1, -1, -1)] + [v(0, j, k) for j in range(ny - 1, 0, -1)])

    for k, flip in ((0, True), (nz, False)):
        if merge[0 if k == 0 else 1]:              # a hidden face: one n-gon instead of the grid
            loop = rim(k)
            bm.faces.new(list(reversed(loop)) if flip else loop)
            continue
        for i in range(nx):
            for j in range(ny):
                q = (v(i, j, k), v(i + 1, j, k), v(i + 1, j + 1, k), v(i, j + 1, k))
                bm.faces.new(tuple(reversed(q)) if flip else q)
    for i in range(nx):
        for k in range(nz):
            bm.faces.new((v(i, 0, k), v(i + 1, 0, k), v(i + 1, 0, k + 1), v(i, 0, k + 1)))
            bm.faces.new((v(i, ny, k), v(i, ny, k + 1), v(i + 1, ny, k + 1), v(i + 1, ny, k)))
    for j in range(ny):
        for k in range(nz):
            bm.faces.new((v(0, j, k), v(0, j, k + 1), v(0, j + 1, k + 1), v(0, j + 1, k)))
            bm.faces.new((v(nx, j, k), v(nx, j + 1, k), v(nx, j + 1, k + 1), v(nx, j, k + 1)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, _mat(key))
    if levels:
        C.subdivide(ob, levels)
    C.shade_smooth(ob, smooth)
    return ob


def _deform(ob, f):
    me = ob.data
    for v in me.vertices:
        v.co = Vector(f(v.co.copy()))
    me.update()
    return ob


def _label(name, body, size, depth, key, font=GEORGIA, res=2, spacing=1.0, sides=False):
    """Lettering facing -Y, centred on x = 0, z = 0, its face at y = -depth. sides=True keeps the raised letter
    walls (back on y = 0); by default only the face is kept, standing `depth` proud (a third of the triangles)."""
    cu = bpy.data.curves.new(name, type="FONT")
    try:
        cu.font = bpy.data.fonts.load(font, check_existing=True)
    except (RuntimeError, OSError):
        pass
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.resolution_u = res
    cu.align_x = "CENTER"
    cu.space_character = spacing
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.normal.z < (-0.9 if sides else 0.9)], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    me.materials.clear()
    me.materials.append(_mat(key))
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    _xf(ob, _T(-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -min(zs) if sides else depth - max(zs)))
    _xf(ob, _Rx(90))
    C.shade_flat(ob)
    return _uvb(ob, key)


def _blocks(name, rects, y, keys):
    """Flat placeholder UI: quads (x0, z0, x1, z1, material index) on the plane y, facing -Y."""
    bm = bmesh.new()
    for x0, z0, x1, z1, mi in rects:
        vs = [bm.verts.new((x0, y, z0)), bm.verts.new((x1, y, z0)), bm.verts.new((x1, y, z1)), bm.verts.new((x0, y, z1))]
        f = bm.faces.new(vs)
        FH._orient(f, Vector((0, -1, 0)))
        f.material_index = mi
    ob = _finish(bm, name, keys, 10, recalc=False)
    C.shade_flat(ob)
    return _uvb(ob, keys[0])


def _power_face(name, outline, socks, usbs, sock_hw=0.0185, ins_r=0.0155, pin_dx=0.0085, led=None):
    """Flush brass power module, face up, its 2 mm flange sitting on z = 0 over a pocket: socket recesses
    (dark insert, round well, pin holes), USB-C slots and a pilot light. After furn_hall's grommet."""
    bm = bmesh.new()
    up = Vector((0, 0, 1))

    def ring(pts2, z):
        return [bm.verts.new((p[0], p[1], z)) for p in pts2]

    zt = 0.002
    prof = [(0.0, 0.0), (0.0, 0.0007), (0.0012, 0.0016), (0.0032, zt)]
    rings = [ring(outline(d), z) for d, z in prof]
    for A, B in zip(rings, rings[1:]):
        _bridge_o(bm, A, B, (0, 0, -0.05), toward=False)
    z_ins, z_fl = zt - 0.0015, zt - 0.0085
    socks_l = [ring(_rpoly(_rect(sock_hw, sock_hw, x, y), sock_hw * 0.29, 0, 3), zt) for x, y in socks]
    usbs_l = [ring(_rpoly(_rect(hw, hh, x, y), min(hw, hh) * 0.85, 0, 2), zt) for x, y, hw, hh in usbs]
    leds = [ring(_circle(0.0018, 10, led[0], led[1]), zt)] if led else []
    _cap(bm, [rings[-1]] + socks_l + usbs_l + leds, up)
    for (x, y), top in zip(socks, socks_l):
        low = [bm.verts.new((v.co.x, v.co.y, z_ins)) for v in top]
        _bridge_o(bm, top, low, (x, y, zt))
        c_in = ring(_circle(ins_r, 24, x, y), z_ins)
        _cap(bm, [low, c_in], up, 1)
        c_fl = ring(_circle(ins_r, 24, x, y), z_fl)
        _bridge_o(bm, c_in, c_fl, (x, y, z_ins), mi=1)
        pins = [ring(_circle(0.002, 8, x + dx, y), z_fl) for dx in (-pin_dx, pin_dx)]
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


def _screw(name="screw", r=0.0024, key="brass_aged"):
    return _turn(name, [(r, 0.0), (r * 0.8, r * 0.38), (0.0, r * 0.55)], 10, key, caps=(False, False))


def _knob(name, r=0.012, h=0.024, key="brass"):
    """Turned knob along +Z from its rose (z = 0)."""
    return _turn(name, [(r * 0.75, 0.0), (r * 0.8, 0.0015), (r * 0.42, 0.004), (r * 0.36, h * 0.42), (r * 0.62, h * 0.56),
                        (r * 0.95, h * 0.72), (r, h * 0.84), (r * 0.82, h * 0.96), (r * 0.4, h), (0.0, h)],
                 12, key, caps=(True, False))


def _sheet(name, w, d, z, cx, cy, rot=0.0, t=0.0012, key="paper"):
    s = _bx(name, (-w / 2, -d / 2, 0.0), (w / 2, d / 2, t), key)
    return _xf(s, _T(cx, cy, z) @ _Rz(rot))


def _book(name, w, d, t, key, cx, cy, z, rot=0.0):
    """A closed hardback lying flat: boards and a rounded spine (on -X) round a cream page block."""
    bt = 0.0028
    parts = [_bx(name + "_pages", (-w / 2 + 0.004, -d / 2 + 0.003, bt - 0.0004), (w / 2 - 0.0005, d / 2 - 0.003, t - bt + 0.0004),
                 "book_pages", 0.0, 1, "y")]
    for z0 in (0.0, t - bt):
        parts.append(_bx(name + "_board", (-w / 2 + 0.002, -d / 2, z0), (w / 2 + 0.002, d / 2, z0 + bt), key, 0.0012, 1, "y"))
    sp = _turn(name + "_spine", [(t / 2, 0.0), (t / 2, d)], 12, key, caps=(True, True))
    _xf(sp, _T(-w / 2 + 0.002 + t * 0.12, d / 2, t / 2) @ _Rx(90) @ _Rz(0))
    _deform(sp, lambda co: (min(co.x, -w / 2 + 0.004), co.y, co.z))
    parts.append(sp)
    ob = _join(parts, name)
    return _xf(ob, _T(cx, cy, z) @ _Rz(rot))


# ---------------------------------------------------------------------------
# Computer workstation
# ---------------------------------------------------------------------------

DW, DD, DH = 1.30, 0.70, 0.75
TOP_T = 0.034
Z_UT = DH - TOP_T                 # underside of the top (0.716)
LEG_X, LEG_Y, LEG_HW = 0.595, 0.295, 0.025
GROMMET = (0.30, 0.25)
POWER = (-0.47, 0.255)
MON_Y = 0.07                      # monitor bezel face
MON_Z0 = 0.852                    # bottom edge of the monitor body


def _desk_top():
    gx, gy = GROMMET
    px, py = POWER
    cut1 = C.cylinder("cut_grommet", 0.031, 0.031, 0.1, center=(gx, gy, DH), segments=32)
    cut2 = C.box_minmax("cut_power", (px - 0.081, py - 0.026, DH - 0.016), (px + 0.081, py + 0.026, DH + 0.02))
    top = _top("dc_top", DW / 2, DD / 2, DH, TOP_T, "tabletop", radius=0.012, rr=0.007, cutters=(cut1, cut2))
    return top


def _grommet():
    gx, gy = GROMMET
    loop = [(0.0302, Z_UT + 0.004), (0.0302, DH), (0.0370, DH), (0.0392, DH + 0.0012), (0.0388, DH + 0.0024),
            (0.0360, DH + 0.0031), (0.0300, DH + 0.0031), (0.0272, DH + 0.0022), (0.0272, Z_UT + 0.004)]
    ring = FH._lathe_loop("dc_grommet", loop, 24, ["brass"], [0] * len(loop))
    FH._uv_spun(ring, tex_size("brass"), [(r, z) for r, z in loop])
    # dark cap with a cable notch at the back
    pts = []
    for k in range(36):
        a = math.tau * k / 36
        da = abs(((math.degrees(a) - 90 + 180) % 360) - 180)
        r = 0.0124 if da < 24 else 0.0268
        pts.append((r * math.cos(a), r * math.sin(a)))
    cap = C.prism("dc_gcap", pts, DH + 0.0008, DH + 0.0024, _mat("plastic_dark"))
    _uvb(cap, "plastic_dark")
    ob = _join([ring, cap], "dc_grommet")
    return _xf(ob, _T(gx, gy, 0.0))


def _power_module():
    px, py = POWER
    ob = _power_face("dc_power", lambda d: _rpoly(_rect(0.085, 0.030), 0.008, d, 3), [(-0.050, 0.0), (-0.006, 0.0)],
                     [(0.034, 0.008, 0.0046, 0.0017), (0.034, -0.008, 0.0046, 0.0017)], led=(0.066, 0.0))
    parts = [ob]
    for sx in (-1, 1):
        s = _screw()
        _xf(s, _T(sx * 0.077, 0.0, 0.002))
        parts.append(s)
    ob = _join(parts, "dc_power")
    return _xf(ob, _T(px, py, DH))


def _walnut_frame(variant):
    parts = []
    rings = [[(x, y, z) for x, y in _rect(hw, hw)] for z, hw in ((0.028, 0.0185), (Z_UT, LEG_HW))]
    leg = _loft("dc_leg", rings, "walnut", True, (True, True), 30)
    C.bevel(leg, 0.0025, 2)
    _uvb(leg, "walnut", "z")
    sab = _bx("dc_sabot", (-0.0205, -0.0205, 0.0), (0.0205, 0.0205, 0.030), "brass_aged", 0.0018, 2, "z")
    for sx in (-1, 1):
        for sy in (-1, 1):
            for src in (leg, sab):
                p = _copy(src)
                _xf(p, _T(sx * LEG_X, sy * LEG_Y, 0.0))
                parts.append(p)
    C.remove(leg)
    C.remove(sab)
    ox, oy = LEG_X + LEG_HW - 0.008, LEG_Y + LEG_HW - 0.008          # apron outer faces
    ix, iy = LEG_X - LEG_HW + 0.005, LEG_Y - LEG_HW + 0.005          # ends buried 5 mm in the legs
    for sx in (-1, 1):
        a, b = sorted((sx * ox, sx * (ox - 0.022)))
        parts.append(_bx("dc_apron_s", (a, -iy, 0.626), (b, iy, Z_UT), "walnut", 0.0015, 1, "y"))
    parts.append(_bx("dc_apron_f", (-ix, -oy, 0.662), (ix, -oy + 0.022, Z_UT), "walnut", 0.0015, 1, "x"))
    # back rail and fielded modesty panel
    hole = _rr(ix - 0.045, 0.13, 0.0, 0.47)
    parts.append(_plate("dc_modesty", _rr(ix, (Z_UT - 0.30) / 2, 0.0, (Z_UT + 0.30) / 2), [hole], oy - 0.022, oy,
                        "walnut", "xz", 0.0015, 1, "x"))
    parts.append(_panel("dc_modesty_p", hole, oy - 0.016, oy - 0.006, "walnut", "xz", "x", bevel_w=0.0012))
    # a small bead under the back rail
    return parts


def _iron_frame():
    parts = []
    ex = 0.575
    for sx in (-1, 1):
        x = sx * ex
        parts.append(_bx("dc_foot", (x - 0.016, -0.335, 0.012), (x + 0.016, 0.335, 0.052), "iron", 0.003, 2, "y"))
        parts.append(_bx("dc_toprail", (x - 0.016, -0.32, Z_UT - 0.036), (x + 0.016, 0.32, Z_UT), "iron", 0.003, 2, "y"))
        for sy in (-1, 1):
            parts.append(_bx("dc_post", (x - 0.016, sy * 0.255 - 0.026, 0.05), (x + 0.016, sy * 0.255 + 0.026, Z_UT - 0.034),
                             "iron", 0.003, 2, "z"))
            g = _turn("dc_glide", [(0.016, 0.0), (0.017, 0.002), (0.017, 0.009), (0.012, 0.0125), (0.0, 0.0125)], 16,
                      "brass_aged", fillet=0.001)
            _xf(g, _T(x, sy * 0.30, 0.0))
            parts.append(g)
            for z in (0.032, Z_UT - 0.018):          # brass bolt heads at the joints, both faces
                for side in (-1, 1):
                    b = _turn("dc_bolt", [(0.0055, 0.0), (0.0052, 0.0012), (0.0035, 0.0028), (0.0, 0.0032)], 10, "brass_aged",
                              caps=(False, False))
                    _xf(b, _T(x + side * 0.016, sy * 0.255, z) @ _Ry(90 * side))
                    parts.append(b)
    parts.append(_bx("dc_beam", (-ex + 0.016, 0.235, 0.60), (ex - 0.016, 0.275, Z_UT), "iron", 0.003, 2, "x"))
    parts.append(_bx("dc_beam_f", (-ex + 0.016, -0.30, Z_UT - 0.03), (ex - 0.016, -0.28, Z_UT), "iron", 0.002, 1, "x"))
    return parts


def _cable_tray():
    x0, x1 = -0.40, 0.34
    y0, y1, z0, z1 = 0.12, 0.262, 0.605, 0.69
    t = 0.0022
    prof = [(y0, z1), (y0, z0), (y1, z0), (y1, z1), (y1 - t, z1), (y1 - t, z0 + t), (y0 + t, z0 + t), (y0 + t, z1)]
    parts = [_plate("dc_tray", prof, [], x0, x1, "iron", "yz", 0.0008, 1, "x")]
    for x in (x0 + 0.06, x1 - 0.06):
        parts.append(_bx("dc_hanger", (x - 0.015, y1, z0 + 0.02), (x + 0.015, y1 + 0.003, Z_UT), "iron", 0.0006, 1, "z"))
        parts.append(_bx("dc_hanger_t", (x - 0.015, y1 - 0.03, Z_UT - 0.003), (x + 0.015, y1 + 0.003, Z_UT), "iron", 0.0006, 1, "y"))
    # power strip and a loom of cables lying in the tray
    parts.append(_bx("dc_strip", (-0.33, 0.15, z0 + t), (-0.03, 0.195, z0 + t + 0.038), "plastic_dark", 0.004, 2, "x"))
    parts.append(_bx("dc_strip_sw", (-0.322, 0.147, z0 + 0.016), (-0.306, 0.152, z0 + 0.03), "led_strip", 0.001, 1))
    for k, (yy, zz) in enumerate(((0.215, 0.6115), (0.232, 0.6115), (0.224, 0.6175))):
        path = [(-0.36 + 0.02 * k, yy, zz), (-0.1, yy + 0.004, zz), (0.15, yy - 0.003, zz), (0.27, yy, zz),
                (0.295, GROMMET[1] - 0.006, zz + 0.03), (0.30 - 0.004 * k, GROMMET[1] - 0.004, Z_UT - 0.004)]
        parts.append(_uvb(_tube("dc_cable", _catmull(path, 2), 0.0036, "plastic_dark", seg=6), "plastic_dark"))
    return parts


def _monitor(big):
    """Thin-bezel monitor on an aluminium stand; the screen faces -Y. Returns parts and the screen rect."""
    W, H = (0.614, 0.364) if big else (0.541, 0.322)
    bez, chin = 0.0062, 0.0135
    z0 = MON_Z0 - (0.012 if big else 0.0)
    zc = z0 + H / 2
    yf = MON_Y
    parts = []
    sx0, sx1 = -W / 2 + bez, W / 2 - bez
    sz0, sz1 = z0 + chin, z0 + H - bez
    hole = _rr((sx1 - sx0) / 2, (sz1 - sz0) / 2, 0.0, (sz0 + sz1) / 2)
    outer = _rpoly(_rect(W / 2, H / 2, 0.0, zc), 0.004, 0, 3)
    parts.append(_plate("mon_bezel", outer, [hole], yf, yf + 0.009, "plastic_dark", "xz", 0.0012, 1))
    parts.append(_panel("mon_screen", hole, yf + 0.0016, yf + 0.0075, "screen", "xz"))
    # rear shell: thin edge band and a crowned bulge carrying the stand
    shell = _pill("mon_back", W / 2 - 0.003, H / 2 - 0.003, 0.006, 0.0, 0.010, "plastic_dark", ease=0.003, cy=0.0)
    _xf(shell, _T(0.0, zc, 0.0))
    _face_front(shell)
    _xf(shell, _T(0.0, yf + 0.0185, 0.0))
    parts.append(shell)
    bh = H * 0.62
    bulge = _pill("mon_bulge", W * 0.33, bh / 2, 0.04, 0.0, 0.026, "plastic_dark", ease=0.012, seg=4)
    _xf(bulge, _T(0.0, zc - H * 0.06, 0.0))
    _face_front(bulge)
    _xf(bulge, _T(0.0, yf + 0.0445, 0.0))
    parts.append(bulge)
    # brushed aluminium badge and a pilot light on the chin
    parts.append(_bx("mon_badge", (-0.022, yf - 0.0003, z0 + 0.0045), (0.022, yf + 0.001, z0 + 0.0065), "aluminium", 0.0003, 1, "x"))
    led = _turn("mon_led", [(0.0012, 0.0), (0.0012, 0.0004), (0.0, 0.0006)], 8, "led_strip", caps=(False, False))
    _xf(led, _T(W / 2 - 0.03, yf, z0 + 0.0055) @ _Rx(90))
    parts.append(led)
    # stand: oval-cornered base, a flat neck leaning back a touch, a hinge block into the bulge
    base_y = yf + 0.055
    base = _pill("mon_base", 0.115, 0.085, 0.03, DH, DH + 0.0085, "aluminium", ease=0.003, seg=5, cy=base_y, grain="x")
    parts.append(base)
    parts.append(_pill("mon_foot", 0.110, 0.080, 0.028, DH - 0.0002, DH + 0.0006, "plastic_dark", cy=base_y))
    nz0, nz1 = DH + 0.008, zc + 0.02
    neck = _pill("mon_neck", 0.031, 0.0085, 0.006, nz0, nz1, "aluminium", ease=0.0, seg=3, grain="x")
    _deform(neck, lambda co: (co.x, co.y + (co.z - nz0) * 0.10, co.z))
    _xf(neck, _T(0.0, base_y + 0.035, 0.0))
    parts.append(neck)
    ny_top = base_y + 0.035 + (nz1 - nz0) * 0.10
    # hinge block: from inside the bulge (2.5 mm) back to the neck head
    parts.append(_bx("mon_hinge", (-0.036, yf + 0.042, zc - 0.035), (0.036, ny_top - 0.004, zc + 0.03), "aluminium", 0.006, 2, "x"))
    # dim catalogue search UI: header with crest and title, search field and button, facet list, result rows
    sw, sh = sx1 - sx0, sz1 - sz0

    def r(u0, v0, u1, v1, mi):
        return (sx0 + u0 * sw, sz0 + v0 * sh, sx0 + u1 * sw, sz0 + v1 * sh, mi)

    rects = [r(0.0, 0.905, 1.0, 1.0, 2), r(0.02, 0.92, 0.055, 0.985, 1), r(0.07, 0.945, 0.30, 0.962, 0),
             r(0.80, 0.940, 0.86, 0.965, 0), r(0.88, 0.940, 0.97, 0.965, 0),
             r(0.20, 0.765, 0.79, 0.835, 0), r(0.80, 0.765, 0.88, 0.835, 1), r(0.22, 0.79, 0.42, 0.81, 1)]
    for k in range(6):
        v = 0.68 - k * 0.065
        rects.append(r(0.03, v, 0.11 + 0.035 * ((k * 3) % 4) / 3, v + 0.024, 0))
    rects.append(r(0.03, 0.72, 0.16, 0.745, 1))
    for k in range(4):
        v = 0.56 - k * 0.165
        rects += [r(0.20, v, 0.255, v + 0.13, 1), r(0.28, v + 0.09, 0.62 - 0.05 * (k % 2), v + 0.118, 0),
                  r(0.28, v + 0.05, 0.50 + 0.04 * (k % 3), v + 0.068, 0), r(0.28, v + 0.018, 0.40, v + 0.034, 0),
                  r(0.86, v + 0.085, 0.96, v + 0.115, 1 if k == 0 else 0)]
    rects.append(r(0.20, 0.025, 0.96, 0.032, 0))
    ui = _blocks("mon_ui", rects, yf + 0.0016 - 0.0009, ["screen_ui", "screen_hi", "screen_band"])
    parts.append(ui)
    return parts, (sx0, sz0, sx1, sz1), yf + 0.0016


KB_U = 0.019


def _kb_layout():
    keys = []                                   # (x units, y units from the back, w, h)
    xs = 0.0
    for w in [1, -1, 1, 1, 1, 1, -0.5, 1, 1, 1, 1, -0.5, 1, 1, 1, 1]:
        if w > 0:
            keys.append((xs, 0.0, w, 1))
        xs += abs(w)
    main = [[1] * 13 + [2], [1.5] + [1] * 12 + [1.5], [1.75] + [1] * 11 + [2.25], [2.25] + [1] * 10 + [2.75],
            [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25]]
    for r, row in enumerate(main):
        xs = 0.0
        for w in row:
            keys.append((xs, 1.5 + r, w, 1))
            xs += w
    for c in range(3):
        keys.append((15.5 + c, 0.0, 1, 1))
        keys.append((15.5 + c, 1.5, 1, 1))
        keys.append((15.5 + c, 2.5, 1, 1))
        keys.append((15.5 + c, 5.5, 1, 1))
    keys.append((16.5, 4.5, 1, 1))
    for c in range(4):
        keys.append((19.0 + c, 1.5, 1, 1))
    for r in range(3):
        for c in range(3):
            keys.append((19.0 + c, 2.5 + r, 1, 1))
    keys += [(22.0, 2.5, 1, 2), (22.0, 4.5, 1, 2), (19.0, 5.5, 2, 1), (21.0, 5.5, 1, 1)]
    return keys


def _keyboard(cx, cy):
    u = KB_U
    W, D = 23 * u + 0.016, 6.5 * u + 0.016
    slope = math.tan(D2R(3.2))
    hw, hh = W / 2, D / 2
    case = _pill("kb_case", hw, hh, 0.007, 0.0, 0.0105, "aluminium", ease=0.0018, seg=3, grain="x")
    _deform(case, lambda co: (co.x, co.y, co.z + (co.y + hh) * slope * min(1.0, co.z / 0.006)))
    deck = _pill("kb_deck", hw - 0.006, hh - 0.006, 0.004, 0.006, 0.0108, "plastic_dark")
    _deform(deck, lambda co: (co.x, co.y, co.z + (co.y + hh) * slope))
    bm = bmesh.new()
    gap, inset, kh = 0.0034, 0.0017, 0.0078
    for xu, yu, w, h in _kb_layout():
        x0 = -hw + 0.008 + xu * u + gap / 2
        x1 = -hw + 0.008 + (xu + w) * u - gap / 2
        y1 = hh - 0.008 - yu * u - gap / 2
        y0 = hh - 0.008 - (yu + h) * u + gap / 2
        zb = 0.0106 + ((y0 + y1) / 2 + hh) * slope - 0.0008
        lo = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
        hi = [(x0 + inset, y0 + inset * 1.3), (x1 - inset, y0 + inset * 1.3), (x1 - inset, y1 - inset * 0.7),
              (x0 + inset, y1 - inset * 0.7)]
        B = [bm.verts.new((x, y, zb + (y + hh) * slope - ((y0 + y1) / 2 + hh) * slope)) for x, y in lo]
        Tt = [bm.verts.new((x, y, zb + kh + (y + hh) * slope * 0.4 - ((y0 + y1) / 2 + hh) * slope * 0.4)) for x, y in hi]
        _bridge_o(bm, B, Tt, ((x0 + x1) / 2, (y0 + y1) / 2, zb + kh / 2), toward=False, axis=(0, 0, 1))
        _ngon(bm, Tt, (0, 0, 1))
    keys = _finish(bm, "kb_keys", "plastic_dark", 30, recalc=False)
    C.shade_flat(keys)
    _uvb(keys, "plastic_dark")
    ob = _join([case, deck, keys], "kb")
    return _xf(ob, _T(cx, cy, DH))


def _mouse(cx, cy, z, rot=0.0):
    m = _soft("mouse", [-0.030, -0.021, 0.021, 0.030], [-0.056, -0.038, 0.038, 0.056], [0.0, 0.003, 0.020, 0.033],
              "plastic_dark", 1, merge=(True, False))

    def f(co):
        h = 0.52 + 0.48 * math.exp(-((co.y - 0.012) / 0.05) ** 2)
        z_ = co.z * h if co.z > 0.0035 else co.z
        return (co.x * (0.86 + 0.14 * (co.y + 0.056) / 0.112), co.y, z_)

    _deform(m, f)
    _uvb(m, "plastic_dark")
    zt = 0.033 * (0.52 + 0.48 * math.exp(-((-0.028 - 0.012) / 0.05) ** 2))
    wheel = _turn("mouse_wheel", [(0.0052, -0.002), (0.0056, -0.0012), (0.0056, 0.0012), (0.0052, 0.002)], 14, "aluminium",
                  caps=(True, True))
    _xf(wheel, _T(0.0, -0.028, zt - 0.0025) @ _Ry(90))
    ob = _join([m, wheel], "mouse")
    return _xf(ob, _T(cx, cy, z) @ _Rz(rot))


def _pad(cx, cy, key):
    pad = _pill("pad", 0.12, 0.10, 0.014, DH, DH + 0.004, key, ease=0.0012, seg=3, cx=cx, cy=cy, grain="y")
    stitch = _plate("pad_stitch", _rpoly(_rect(0.112, 0.092, cx, cy), 0.009, 0, 3),
                    [_rpoly(_rect(0.1105, 0.0905, cx, cy), 0.0078, 0, 3)], DH + 0.0039, DH + 0.0042, "brass_aged", "xy")
    return [pad, stitch]


def _pc_tower(side):
    """Compact PC in an iron cradle under the top; side = +1 (right) or -1 (left)."""
    w, d, h = 0.096, 0.30, 0.30
    xc = side * 0.478
    x0, x1 = xc - w / 2, xc + w / 2
    y0, y1 = -0.17, -0.17 + d
    z0, z1 = Z_UT - 0.016 - h, Z_UT - 0.016
    parts = [_bx("pc_body", (x0, y0 + 0.004, z0), (x1, y1, z1), "iron", 0.004, 2, "y")]
    parts.append(_bx("pc_front", (x0 + 0.0015, y0, z0 + 0.0015), (x1 - 0.0015, y0 + 0.006, z1 - 0.0015), "aluminium", 0.0015, 2, "z"))
    parts.append(_bx("pc_grille", (x0 + 0.014, y0 - 0.0006, z0 + 0.03), (x1 - 0.014, y0 + 0.002, z0 + 0.19), "plastic_dark", 0.0008, 1))
    for k in range(9):
        z = z0 + 0.04 + k * 0.017
        parts.append(_bx("pc_slat", (x0 + 0.016, y0 - 0.0012, z), (x1 - 0.016, y0 + 0.001, z + 0.0035), "aluminium", 0.0, 1, "x"))
    ring = _turn("pc_btn", [(0.0, 0.0), (0.0085, 0.0), (0.0092, 0.0008), (0.0092, 0.0022), (0.0072, 0.0026), (0.0060, 0.0026),
                            (0.0060, 0.0018), (0.0, 0.0018)], 20, "brass", caps=(False, False))
    _xf(ring, _T(xc, y0, z1 - 0.032) @ _Rx(90))
    parts.append(ring)
    led = _turn("pc_led", [(0.0060, 0.0), (0.0060, 0.0019), (0.0, 0.0019)], 20, "led_strip", caps=(False, True))
    _xf(led, _T(xc, y0 + 0.0001, z1 - 0.032) @ _Rx(90))
    parts.append(led)
    for k in range(2):
        z = z1 - 0.062 - k * 0.013
        parts.append(_bx("pc_usb", (xc - 0.0065, y0 - 0.0008, z), (xc + 0.0065, y0 + 0.002, z + 0.0048), "plastic_dark", 0.0006, 1))
    # cradle: two iron U-straps with flanges screwed to the underside of the top
    for ys in (y0 + 0.05, y1 - 0.05):
        t = 0.003
        prof = [(x0 - t - 0.028, Z_UT), (x0 - t - 0.028, Z_UT - t), (x0 - t, Z_UT - t), (x0 - t, z0 - t),
                (x1 + t, z0 - t), (x1 + t, Z_UT - t), (x1 + t + 0.028, Z_UT - t), (x1 + t + 0.028, Z_UT),
                (x1, Z_UT), (x1, z0), (x0, z0), (x0, Z_UT)]
        parts.append(_plate("pc_strap", prof, [], ys - 0.016, ys + 0.016, "iron", "xz", 0.0007, 1, "z"))
        for xs in (x0 - t - 0.014, x1 + t + 0.014):
            s = _screw()
            _xf(s, _T(xs, ys, Z_UT - t) @ _Rx(180))
            parts.append(s)
    # power and display cables rising from the back into the tray
    path = [(xc, y1 - 0.01, z1 - 0.05), (xc, y1 + 0.02, z1 - 0.06), (xc * 0.8, 0.20, 0.64), (xc * 0.6, 0.2, 0.612)]
    parts.append(_uvb(_tube("pc_cable", _catmull(path, 4), 0.0036, "plastic_dark", seg=6), "plastic_dark"))
    return parts


def _mini_pc(cx, cy):
    parts = [_pill("mpc_stand", 0.03, 0.075, 0.008, DH, DH + 0.006, "iron", ease=0.0015, cx=cx, cy=cy)]
    body = _pill("mpc_body", 0.0175, 0.085, 0.006, 0.0, 0.17, "aluminium", ease=0.003, seg=3, grain="z")
    _xf(body, _T(cx, cy, DH + 0.004))
    parts.append(body)
    ring = _turn("mpc_btn", [(0.0, 0.0), (0.0045, 0.0), (0.0045, 0.0012), (0.0, 0.0012)], 14, "led_strip", caps=(False, True))
    _xf(ring, _T(cx, cy - 0.085, DH + 0.004 + 0.145) @ _Rx(90))
    parts.append(ring)
    path = [(cx, cy + 0.07, DH + 0.03), (cx - 0.02, cy + 0.10, DH + 0.0036), (GROMMET[0] + 0.01, GROMMET[1] + 0.01, DH + 0.0036),
            (GROMMET[0], GROMMET[1] + 0.017, DH - 0.004)]
    parts.append(_uvb(_tube("mpc_cable", _catmull(path, 4), 0.0032, "plastic_dark", seg=6), "plastic_dark"))
    return parts


def _notepad(cx, cy, rot):
    parts = [_bx("np_back", (-0.075, -0.105, 0.0), (0.075, 0.105, 0.0018), "label_card", 0.0004, 1, "y"),
             _bx("np_paper", (-0.074, -0.104, 0.0018), (0.074, 0.098, 0.009), "paper", 0.0006, 1, "y"),
             _bx("np_binding", (-0.075, 0.098, 0.0018), (0.075, 0.105, 0.0095), "signage", 0.0008, 1, "x")]
    for k in range(9):
        y = 0.07 - k * 0.019
        parts.append(_bx("np_line", (-0.066, y, 0.009), (0.066, y + 0.0007, 0.0092), "screen_ui"))
    pen = _turn("np_pencil", [(0.0035, 0.0), (0.0035, 0.15), (0.0011, 0.166), (0.0, 0.168)], 6, "signage", caps=(True, False))
    _xf(pen, _T(0.095, -0.08, 0.0035) @ _Rz(8) @ _Rx(-90))
    parts.append(pen)
    ob = _join(parts, "notepad")
    return _xf(ob, _T(cx, cy, DH) @ _Rz(rot))


def _desk_flipped(item):
    """True when the plan puts this desk's chair behind its front (see the module docstring)."""
    iid = getattr(item, "id", None)
    if not iid:
        return False
    try:
        import plan as P
    except ImportError:
        return False
    for it in P.ITEMS:
        if it.table == iid and it.kind.startswith("chair"):
            dx, dz = it.x - item.x, it.z - item.z
            lz = dx * math.sin(item.rot) + dz * math.cos(item.rot)      # web local +Z = Blender front (-Y)
            return lz < -0.05
    return False


def build_desk_computer(item=None):
    seed = int(getattr(item, "seed", 0) or 0) if item is not None else 0
    v = seed % 3
    parts = [_desk_top(), _grommet(), _power_module()]
    parts += _iron_frame() if v == 1 else _walnut_frame(v)
    parts += _cable_tray()
    mparts, scr, scr_y = _monitor(big=(v == 1))
    parts += mparts
    # monitor cable: from the back of the bulge, behind the neck, along the desk into the grommet notch
    gx, gy = GROMMET
    path = [(0.03, MON_Y + 0.07, MON_Z0 + 0.06), (0.05, MON_Y + 0.115, MON_Z0 + 0.02), (0.07, MON_Y + 0.15, DH + 0.03),
            (0.10, MON_Y + 0.16, DH + 0.0036), (0.22, gy + 0.012, DH + 0.0036), (gx - 0.006, gy + 0.017, DH + 0.0036),
            (gx, gy + 0.018, DH - 0.006), (gx, gy + 0.018, Z_UT - 0.004)]
    parts.append(_uvb(_tube("dc_mon_cable", _catmull(path, 3), 0.0034, "plastic_dark", seg=6), "plastic_dark"))
    parts.append(_keyboard(-0.04, -0.175))
    pad_key = "leather_green" if v == 1 else "leather_brown"
    parts += _pad(0.335, -0.165, pad_key)
    parts.append(_mouse(0.335, -0.17, DH + 0.0042, D2R(-6)))
    if v == 0:
        parts += _pc_tower(+1)
        parts.append(_book("dc_book", 0.165, 0.235, 0.03, "leather_burgundy", -0.47, 0.03, DH, D2R(-14)))
    elif v == 1:
        parts += _mini_pc(0.47, 0.17)
        parts.append(_book("dc_book1", 0.17, 0.24, 0.032, "leather_green", -0.47, 0.02, DH, D2R(-10)))
        parts.append(_book("dc_book2", 0.15, 0.215, 0.026, "leather_burgundy", -0.465, 0.025, DH + 0.032, D2R(-2)))
    else:
        parts += _pc_tower(-1)
        parts.append(_notepad(-0.43, -0.06, D2R(9)))
    ob = _clean_slots(_join(parts, f"Furniture_Desk_Computer_{v + 1:02d}"))
    x0, z0, x1, z1 = scr
    flipped = _desk_flipped(item)
    if flipped:
        _xf(ob, _Rz(180))
        x0, x1 = -x1, -x0
        scr_y = -scr_y
    ob["screen_surface"] = [round(x0, 4), round(z0, 4), round(x1, 4), round(z1, 4)]
    ob["screen_surface_y"] = round(scr_y, 4)
    ob["front_flipped"] = bool(flipped)
    return ob


# ---------------------------------------------------------------------------
# Task chair
# ---------------------------------------------------------------------------

SEAT_H = 0.47
CH_BASE_R = 0.272
BACK_Y0, BACK_Z0, BACK_TILT, BACK_K = 0.168, 0.556, D2R(8.0), 0.34


def _back_map(x, h, t):
    """Back surface frame: x across, h up the back, t through it (toward +Y). Curved in plan, lumbar
    roll near the bottom, leaning back."""
    lumbar = 0.016 * math.exp(-((h - 0.12) / 0.10) ** 2)
    y = BACK_Y0 + h * math.sin(BACK_TILT) + t - BACK_K * x * x - lumbar
    z = BACK_Z0 + h * math.cos(BACK_TILT)
    return (x, y, z)


def _star_arm():
    """One base arm along +X: a crowned, tapering section that ends in a rounded caster boss."""
    rings = []
    stations = [0.03, 0.06, 0.10, 0.14, 0.18, 0.22, 0.245, 0.262, CH_BASE_R]
    for s in stations:
        t = (s - 0.03) / (CH_BASE_R - 0.03)
        w = 0.056 - 0.020 * t
        h = 0.040 - 0.012 * t
        zt = 0.128 - 0.030 * t
        sec = [(-w / 2, 0.0), (w / 2, 0.0), (w / 2, 0.55 * h), (0.42 * w, 0.85 * h), (0.2 * w, h), (-0.2 * w, h),
               (-0.42 * w, 0.85 * h), (-w / 2, 0.55 * h)]
        rings.append([(s, u, zt - h + v) for u, v in sec])
    last = rings[-1]
    cx = CH_BASE_R
    for k, sc in ((1, 0.78), (2, 0.42)):
        rings.append([(cx + 0.008 * k - 0.001 * k * k, p[1] * sc, p[2] + (1 - sc) * 0.0) for p in last])
    arm = _loft("ct_arm", rings, BASE_KEY, True, (True, True), 40)
    return _uvb(arm, BASE_KEY, "x")


def _caster():
    """Twin-wheel caster under a stem; the wheels roll along local Y."""
    parts = []
    wheel = _turn("cs_wheel", [(0.0, 0.0), (0.0172, 0.0), (0.0228, 0.0022), (0.0236, 0.006), (0.0228, 0.0098), (0.0172, 0.012),
                               (0.0, 0.012)], 10, "plastic_dark", caps=(False, False), smooth=40)
    for sx in (-1, 1):
        w = _copy(wheel)
        _xf(w, _T(sx * 0.0072 + (0.012 if sx > 0 else 0.0), 0.012, 0.0236) @ _Ry(-90))
        parts.append(w)
    C.remove(wheel)
    hub = _turn("cs_hub", [(0.0065, 0.0), (0.0065, 0.0024)], 10, "chrome", caps=(False, False))
    _xf(hub, _T(-0.0012, 0.012, 0.0236) @ _Ry(90))
    parts.append(hub)
    hood = _bx("cs_hood", (-0.006, -0.018, 0.018), (0.006, 0.034, 0.057), "plastic_dark", 0.004, 1, "y")
    parts.append(hood)
    stem = _turn("cs_stem", [(0.0075, 0.0), (0.0075, 0.016)], 8, "chrome", caps=(False, False))
    _xf(stem, _T(0.0, 0.0, 0.056))
    parts.append(stem)
    return _join(parts, "caster")


BASE_KEY = "bronze"


def build_chair_task(item=None):
    seed = int(getattr(item, "seed", 0) or 0) if item is not None else 0
    up = "leather_brown" if seed % 2 == 0 else "fabric_green"
    pad_key = "leather_brown" if seed % 2 == 0 else "leather_green"
    parts = []
    # five-star base
    hub = _turn("ct_hub", [(0.0, 0.074), (0.040, 0.074), (0.047, 0.081), (0.049, 0.112), (0.046, 0.124), (0.036, 0.131),
                           (0.0, 0.131)], 20, BASE_KEY, fillet=0.002)
    parts.append(hub)
    parts.append(_turn("ct_hubring", [(0.0492, 0.104), (0.0502, 0.1055), (0.0502, 0.1095), (0.0492, 0.111)], 20, "brass",
                       caps=(False, False)))
    arm = _star_arm()
    cas = _caster()
    for k in range(5):
        a = 90 + 72 * k + 36
        p = _copy(arm)
        _xf(p, _Rz(a))
        parts.append(p)
        c = _copy(cas)
        ang = D2R(a)
        _xf(c, _T(math.cos(ang) * (CH_BASE_R - 0.012), math.sin(ang) * (CH_BASE_R - 0.012), 0.0) @ _Rz(a + 90 + 25 * (k % 2)))
        parts.append(c)
    C.remove(arm)
    C.remove(cas)
    # gas lift: shroud and chrome piston
    parts.append(_turn("ct_shroud", [(0.030, 0.125), (0.0285, 0.131), (0.0262, 0.138), (0.0262, 0.255), (0.0245, 0.262),
                                     (0.0165, 0.264)], 20, "plastic_dark", fillet=0.0015, caps=(False, True)))
    parts.append(_turn("ct_piston", [(0.0145, 0.258), (0.0145, 0.336)], 16, "chrome", caps=(False, False)))
    # tilt mechanism, tension knob, height lever
    parts.append(_pill("ct_mech", 0.085, 0.115, 0.03, 0.333, 0.383, "iron", ease=0.008, seg=3, cy=0.005))
    kn = _turn("ct_knob", [(0.010, 0.0), (0.024, 0.004), (0.026, 0.012), (0.026, 0.026), (0.022, 0.032), (0.0, 0.034)], 14,
               "plastic_dark", fillet=0.002)
    _xf(kn, _T(0.0, -0.105, 0.355) @ _Rx(90))
    parts.append(kn)
    lever = _tube("ct_lever", [(0.08, 0.02, 0.36), (0.15, 0.025, 0.362), (0.205, 0.04, 0.37)], 0.005, "iron", seg=8)
    parts.append(_uvb(lever, "iron"))
    paddle = _bx("ct_paddle", (-0.022, -0.012, -0.006), (0.022, 0.012, 0.006), "plastic_dark", 0.005, 1)
    _xf(paddle, _T(0.215, 0.044, 0.37) @ _Rz(15))
    parts.append(paddle)
    # seat: moulded walnut shell and a deep crowned cushion with a waterfall front edge
    shell = _pill("ct_seatshell", 0.236, 0.222, 0.07, 0.380, 0.404, "walnut", ease=0.007, seg=4, cy=-0.006, grain="y")
    parts.append(shell)
    cz0 = 0.400
    top = SEAT_H - cz0 - 0.006
    cush = _soft("ct_seat", [-0.248, -0.165, 0.165, 0.248], [-0.238, -0.15, 0.142, 0.226], [0.0, 0.022, 0.042, top], up, 2,
                 merge=(True, False))

    def seat_f(co):
        x, y, z = co
        w = max(0.0, z / top)
        if y < -0.16:                                  # waterfall: the front roll drops away
            z -= (-0.16 - y) * 0.35 * w
        crown = 0.006 * (1 - min(1.0, (x / 0.248) ** 2)) * (1 - min(1.0, ((y + 0.01) / 0.235) ** 2))
        crown -= 0.004 * math.exp(-((y - 0.09) / 0.07) ** 2) * (1 - min(1.0, (x / 0.2) ** 2))   # sitting hollow
        z += crown * w
        return (x, y, z + cz0)

    _deform(cush, seat_f)
    parts.append(_uvb(cush, up, "y"))
    # back: crowned, lumbar-shaped upholstered pad on a moulded walnut shell
    H = 0.44

    def back_f(t_off=0.0, crown=0.0):
        def f(co):
            x, h, t = co
            hh = min(max(h / H, 0.0), 1.0)
            x *= 0.93 + 0.07 * math.sin(math.pi * min(1.0, hh * 1.25) / 2)
            if crown:
                t -= crown * (1 - min(1.0, (x / 0.225) ** 2)) * math.sin(math.pi * hh) * max(0.0, 1 - t / 0.05)
            return _back_map(x, h, t + t_off)
        return f

    pad = _soft("ct_back", [-0.226, -0.15, 0.15, 0.226], [0.0, 0.075, 0.365, H], [0.0, 0.02, 0.040, 0.054], up, 2,
                merge=(False, True))
    _deform(pad, back_f(crown=0.012))
    parts.append(_uvb(pad, up, "z"))
    bsh = _soft("ct_bshell", [-0.214, -0.17, 0.17, 0.214], [0.014, 0.06, 0.38, 0.426], [0.046, 0.052, 0.064, 0.070],
                "walnut", 1, merge=(True, False))
    _deform(bsh, back_f())
    parts.append(_uvb(bsh, "walnut", "z"))
    # bronze spine from the mechanism to the back of the shell
    sp_pts = [(0.0, 0.05, 0.36), (0.0, 0.14, 0.362), (0.0, 0.205, 0.372), (0.0, 0.236, 0.41)]
    for h in (0.0, 0.08, 0.16, 0.22):
        x, y, z = _back_map(0.0, h, 0.0765)
        sp_pts.append((0.0, y, z))
    prof = [(-0.006, -0.030), (0.006, -0.030), (0.0075, -0.027), (0.0075, 0.027), (0.006, 0.030), (-0.006, 0.030),
            (-0.0075, 0.027), (-0.0075, -0.027), (-0.006, -0.030)]
    spine = C.sweep("ct_spine", prof, _catmull(sp_pts, 2), _mat(BASE_KEY), up=(1, 0, 0), smooth_angle=40)
    parts.append(_uvb(spine, BASE_KEY, "z"))
    for h in (0.10, 0.19):
        x, y, z = _back_map(0.0, h, 0.084)
        for sx in (-1, 1):
            s = _screw("ct_bolt", 0.0042, "brass_aged")
            _xf(s, _T(sx * 0.016, y, z) @ _Rx(-90 + math.degrees(BACK_TILT)))
            parts.append(s)
    # J-shaped arms with upholstered pads
    aprof = [(-0.0075, -0.023), (0.0075, -0.023), (0.009, -0.020), (0.009, 0.020), (0.0075, 0.023), (-0.0075, 0.023),
             (-0.009, 0.020), (-0.009, -0.020), (-0.0075, -0.023)]
    for sx in (-1, 1):
        ax = 0.264
        path = [(0.06, 0.0, 0.352), (0.16, 0.0, 0.352), (0.215, 0.0, 0.357), (0.247, 0.0, 0.378), (0.26, 0.0, 0.41),
                (ax, 0.0, 0.45), (ax, 0.0, 0.655)]
        path = [(sx * x, y - 0.015, z) for x, y, z in _catmull(path, 2)]
        a = C.sweep("ct_armpost", aprof, path, _mat(BASE_KEY), up=(0, 1, 0), smooth_angle=40)
        parts.append(_uvb(a, BASE_KEY, "z"))
        parts.append(_bx("ct_armplate", (sx * ax - 0.02, -0.11, 0.652), (sx * ax + 0.02, 0.08, 0.658), "iron", 0.0015, 1, "y"))
        ap = _soft("ct_armpad", [-0.034, -0.022, 0.022, 0.034], [-0.135, -0.105, 0.09, 0.12], [0.0, 0.013, 0.026],
                   pad_key, 1, merge=(True, False))
        _xf(ap, _T(sx * ax, -0.015, 0.6565))
        parts.append(_uvb(ap, pad_key, "y"))
    ob = _clean_slots(_join(parts, f"Furniture_Chair_Task_{seed % 2 + 1:02d}"))
    return ob


# ---------------------------------------------------------------------------
# Printer station
# ---------------------------------------------------------------------------

PW, PD, PH = 1.2, 0.65, 1.2
P_TOP = 0.78
PX = -0.27                       # printer centre x


def _cabinet():
    parts = []
    cx = 0.585
    yf, yb = -0.31, 0.315
    zb, zt = 0.07, 0.75
    parts.append(_bx("pc_plinth", (-cx + 0.025, yf + 0.03, 0.0), (cx - 0.025, yb - 0.01, zb), "walnut", 0.002, 1, "x"))
    parts.append(_bx("pc_bottom", (-cx + 0.02, yf + 0.02, zb), (cx - 0.02, yb - 0.015, 0.10), "oak", 0.0, 1, "x"))
    parts.append(_bx("pc_backb", (-cx + 0.02, yb - 0.015, 0.10), (cx - 0.02, yb, zt), "oak", 0.0, 1, "z"))
    parts.append(_bx("pc_part", (-0.009, yf + 0.02, 0.10), (0.009, yb - 0.015, zt), "oak", 0.0, 1, "z"))
    # panelled sides
    for sx in (-1, 1):
        a0, a1 = (cx - 0.02, cx) if sx > 0 else (-cx + 0.02, -cx)
        hole = _rr(0.215, 0.255, (yf + 0.02 + yb) / 2, (zb + zt) / 2)
        parts.append(_plate("pc_side", _rr((yb - yf - 0.02) / 2, (zt - zb) / 2, (yf + 0.02 + yb) / 2, (zb + zt) / 2), [hole],
                            a0, a1, "oak", "yz", 0.0015, 1, "z"))
        mid = (a0 + a1) / 2
        parts.append(_panel("pc_sidep", hole, mid - 0.004 * sx, mid + 0.004 * sx, "oak", "yz", "z", bevel_w=0.001))
    # face frame with a door opening (left) and an open bay (right)
    oL = _rr(0.2725, 0.31, -0.2875, 0.41)
    oR = _rr(0.2725, 0.31, 0.2875, 0.41)
    parts.append(_plate("pc_face", _rr(cx, (zt - zb) / 2, 0.0, (zb + zt) / 2), [oL, oR], yf, yf + 0.02, "oak", "xz", 0.0015, 1, "x"))
    # inset frame-and-panel doors with brass knobs
    for k, (x0, x1) in enumerate(((-0.558, -0.2895), (-0.2855, -0.017))):
        dz0, dz1 = 0.102, 0.718
        dc = ((x0 + x1) / 2, (dz0 + dz1) / 2)
        dh = _rr((x1 - x0) / 2 - 0.05, (dz1 - dz0) / 2 - 0.06, dc[0], dc[1])
        parts.append(_plate("pc_door", _rr((x1 - x0) / 2, (dz1 - dz0) / 2, dc[0], dc[1]), [dh], yf + 0.004, yf + 0.022,
                            "oak", "xz", 0.0015, 1, "z"))
        parts.append(_panel("pc_doorp", dh, yf + 0.011, yf + 0.018, "oak", "xz", "z", bevel_w=0.0012))
        kn = _knob("pc_knob", 0.011, 0.0185)
        kx = x1 - 0.028 if k == 0 else x0 + 0.028
        _xf(kn, _T(kx, yf + 0.004, 0.60) @ _Rx(90))
        parts.append(kn)
    # open bay: shelf with an oak lipping, wrapped reams of paper
    parts.append(_bx("pc_shelf", (0.009, yf + 0.03, 0.40), (cx - 0.02, yb - 0.015, 0.418), "oak", 0.0, 1, "x"))
    parts.append(_bx("pc_lip", (0.009, yf + 0.024, 0.398), (cx - 0.02, yf + 0.034, 0.422), "oak", 0.0012, 1, "x"))
    rng = random.Random(5)
    for (bx_, z0, n) in ((0.155, 0.10, 4), (0.415, 0.10, 5), (0.155, 0.418, 3), (0.415, 0.418, 2)):
        z = z0
        for i in range(n):
            t = 0.048
            dx, dy, rot = rng.uniform(-0.006, 0.006), rng.uniform(-0.006, 0.006), rng.uniform(-2.5, 2.5)
            ream = _bx("pc_ream", (-0.1055, -0.1485, 0.0), (0.1055, 0.1485, t), "paper", 0.003, 1, "y")
            band = _bx("pc_wrap", (-0.034, -0.1491, 0.0004), (0.034, 0.1491, t - 0.0004), "signage", 0.0, 1, "y")
            r = _join([ream, band], "pc_ream")
            _xf(r, _T(bx_ + dx, -0.03 + dy, z + 0.0003) @ _Rz(rot))
            parts.append(r)
            z += t + 0.0006
    parts.append(_top("pc_top", PW / 2, PD / 2, P_TOP, P_TOP - zt, "tabletop", radius=0.01, rr=0.007))
    return parts


def _printer():
    x0, x1 = PX - 0.26, PX + 0.26
    y0, y1 = -0.24, 0.24
    parts = []
    for fx in (x0 + 0.04, x1 - 0.04):
        for fy in (y0 + 0.04, y1 - 0.04):
            parts.append(_bx("pr_foot", (fx - 0.015, fy - 0.015, P_TOP), (fx + 0.015, fy + 0.015, P_TOP + 0.006), "plastic_dark"))
    z = P_TOP + 0.005
    parts.append(_bx("pr_cass", (x0 + 0.004, y0 + 0.006, z), (x1 - 0.004, y1, z + 0.122), "plastic_light", 0.004, 2, "x"))
    for k in range(2):
        tz0 = z + 0.005 + k * 0.059
        parts.append(_bx("pr_tray", (x0 + 0.002, y0, tz0), (x1 - 0.002, y0 + 0.012, tz0 + 0.055), "plastic_light", 0.003, 2, "x"))
        parts.append(_bx("pr_grip", (PX - 0.06, y0 - 0.0006, tz0 + 0.04), (PX + 0.06, y0 + 0.004, tz0 + 0.048), "plastic_dark", 0.0012, 1))
        parts.append(_bx("pr_level", (x1 - 0.06, y0 - 0.0006, tz0 + 0.02), (x1 - 0.045, y0 + 0.004, tz0 + 0.034), "plastic_dark", 0.0008, 1))
        parts.append(_bx("pr_size", (x0 + 0.03, y0 - 0.0004, tz0 + 0.024), (x0 + 0.06, y0 + 0.004, tz0 + 0.036), "label_card", 0.0006, 1))
    z = P_TOP + 0.127
    parts.append(_bx("pr_body", (x0, y0, z), (x1, y1, z + 0.128), "plastic_light", 0.006, 2, "x"))
    parts.append(_bx("pr_door", (x0 + 0.02, y0 - 0.0012, z + 0.012), (x1 - 0.02, y0 + 0.004, z + 0.116), "plastic_light", 0.0015, 2, "x"))
    for k in range(7):
        vz = z + 0.03 + k * 0.011
        parts.append(_bx("pr_vent", (x1 - 0.0008, -0.10, vz), (x1 + 0.0006, 0.10, vz + 0.0045), "plastic_dark", 0.0, 1, "y"))
    z += 0.128
    # output bay: open front and left, the scanner carried on a right-hand column and the back wall
    parts.append(_bx("pr_column", (x1 - 0.085, y0, z - 0.004), (x1, y1, z + 0.044), "plastic_light", 0.004, 2, "y"))
    parts.append(_bx("pr_bwall", (x0, y1 - 0.045, z - 0.004), (x1 - 0.08, y1, z + 0.044), "plastic_light", 0.003, 2, "x"))
    tray = _bx("pr_out", (x0 + 0.03, y0 + 0.03, z - 0.001), (x1 - 0.09, y1 - 0.046, z + 0.004), "plastic_dark", 0.0015, 1, "x")
    parts.append(tray)
    for k in range(3):
        parts.append(_sheet("pr_print", 0.297, 0.21, z + 0.004 + k * 0.0013, PX - 0.03 + k * 0.003, -0.01 + k * 0.002, D2R(1.5 - k)))
    zs = z + 0.044
    parts.append(_bx("pr_scan", (x0, y0, zs), (x1, y1, zs + 0.06), "plastic_light", 0.005, 2, "x"))
    parts.append(_bx("pr_seam", (x0 - 0.0005, y0 - 0.0005, zs + 0.058), (x1 + 0.0005, y1 + 0.0005, zs + 0.061), "plastic_dark"))
    zl = zs + 0.061
    parts.append(_bx("pr_lid", (x0 + 0.004, y0 + 0.004, zl), (x1 - 0.004, y1 - 0.004, zl + 0.02), "plastic_light", 0.005, 2, "x"))
    feed = _bx("pr_feeder", (x0 + 0.004, y0 + 0.03, zl + 0.012), (x0 + 0.115, y1 - 0.03, P_TOP + PH - P_TOP - 0.0005 + 0.0),
               "plastic_light", 0.012, 3, "y")
    parts.append(feed)
    parts.append(_bx("pr_slot", (x0 + 0.112, -0.16, zl + 0.03), (x0 + 0.1165, 0.16, zl + 0.036), "plastic_dark"))
    parts.append(_bx("pr_intray", (x0 + 0.10, -0.15, zl + 0.040), (x1 - 0.06, 0.15, zl + 0.045), "plastic_light", 0.002, 1, "x"))
    for gy in (-0.112, 0.112):
        parts.append(_bx("pr_guide", (x0 + 0.13, gy - 0.004, zl + 0.045), (x0 + 0.26, gy + 0.004, zl + 0.059), "plastic_dark", 0.0015, 1, "x"))
    for k in range(4):
        parts.append(_sheet("pr_orig", 0.297, 0.21, zl + 0.045 + k * 0.0012, x0 + 0.27 + k * 0.002, 0.0, 0.0))
    # tilted control panel on the scanner front, right half
    pw_, pd_ = 0.115, 0.048
    pn = [_pill("pr_panel", pw_, pd_, 0.008, 0.0, 0.016, "plastic_light", ease=0.003, seg=3)]
    pn.append(_bx("pr_screen", (-pw_ + 0.012, -pd_ + 0.010, 0.0145), (-pw_ + 0.112, pd_ - 0.010, 0.0168), "screen"))
    ui = [(-pw_ + 0.016, pd_ - 0.022, -pw_ + 0.108, pd_ - 0.014, 1), (-pw_ + 0.016, -pd_ + 0.032, -pw_ + 0.05, pd_ - 0.028, 0),
          (-pw_ + 0.056, -pd_ + 0.032, -pw_ + 0.108, pd_ - 0.028, 0), (-pw_ + 0.016, -pd_ + 0.014, -pw_ + 0.108, -pd_ + 0.024, 0)]
    bm = bmesh.new()
    for a, b, c, d, mi in ui:
        f = bm.faces.new([bm.verts.new((a, b, 0.0172)), bm.verts.new((c, b, 0.0172)), bm.verts.new((c, d, 0.0172)),
                          bm.verts.new((a, d, 0.0172))])
        FH._orient(f, Vector((0, 0, 1)))
        f.material_index = mi
    pn.append(C.shade_flat(_finish(bm, "pr_ui", ["screen_ui", "screen_hi"], 10, recalc=False)))
    btn = _turn("pr_btn", [(0.0052, 0.0), (0.0052, 0.002), (0.0040, 0.0032), (0.0, 0.0034)], 8, "plastic_dark", caps=(False, False))
    for r_ in range(3):
        for c_ in range(3):
            b = _copy(btn)
            _xf(b, _T(0.018 + c_ * 0.015, 0.022 - r_ * 0.015, 0.016))
            pn.append(b)
    C.remove(btn)
    st = _turn("pr_start", [(0.0095, 0.0), (0.0095, 0.0025), (0.0080, 0.004), (0.0, 0.0044)], 16, "exit_green", caps=(False, False))
    _xf(st, _T(0.088, -0.012, 0.016))
    pn.append(st)
    panel = _join(pn, "pr_panel")
    _xf(panel, _T(PX + 0.12, y0 - 0.034, zs + 0.016) @ _Rx(32))
    parts.append(panel)
    return parts


def _letter_tray(cx, cy):
    parts = []
    w, d = 0.125, 0.165
    for k, z0 in enumerate((P_TOP, P_TOP + 0.085)):
        parts.append(_bx("lt_base", (cx - w, cy - d, z0), (cx + w, cy + d, z0 + 0.008), "walnut", 0.0015, 1, "y"))
        for sx in (-1, 1):
            a, b = sorted((cx + sx * w, cx + sx * (w - 0.008)))
            parts.append(_bx("lt_side", (a, cy - d, z0 + 0.008), (b, cy + d, z0 + 0.034), "walnut", 0.0015, 1, "y"))
        parts.append(_bx("lt_back", (cx - w + 0.008, cy + d - 0.008, z0 + 0.008), (cx + w - 0.008, cy + d, z0 + 0.04), "walnut", 0.0015, 1, "x"))
        parts.append(_bx("lt_lip", (cx - w + 0.008, cy - d, z0 + 0.008), (cx + w - 0.008, cy - d + 0.006, z0 + 0.016), "walnut", 0.001, 1, "x"))
        for i in range(6 if k == 0 else 3):
            parts.append(_sheet("lt_paper", 0.21, 0.297, z0 + 0.0082 + i * 0.0011, cx + 0.001 * (i % 3), cy - 0.002 + 0.0012 * i,
                                D2R((i % 3 - 1) * 0.7)))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p = _turn("lt_post", [(0.0042, 0.0), (0.0042, 0.077)], 12, "brass", caps=(False, False))
            _xf(p, _T(cx + sx * (w - 0.004), cy + sy * (d - 0.03), P_TOP + 0.008))
            parts.append(p)
    return parts


def _sign(text, w, h, size, icon=None):
    """Green-and-gilt sign plate in a moulded brass frame, facing -Y, centred at x = 0, z = 0, back on y = 0."""
    parts = []
    fw = 0.006
    outer = _rpoly(_rect(w / 2 + fw, h / 2 + fw), 0.004, 0, 3)
    inner = _rpoly(_rect(w / 2, h / 2), 0.0015, 0, 2)
    parts.append(_plate("sg_frame", outer, [inner], -0.0075, 0.0, "brass", "xz", 0.0016, 1, "x"))
    parts.append(_panel("sg_plate", inner, -0.0045, -0.0005, "signage", "xz", grow=0.0015))
    t = _label("sg_text", text, size, 0.0005, "signage_text")
    tx = 0.012 if icon == "drop" else 0.0
    _xf(t, _T(tx, -0.0045, -0.0005))
    parts.append(t)
    if icon == "drop":
        tb = t.dimensions.x
        dx = tx - tb / 2 - 0.018
        pts = []
        for k in range(20):
            a = math.tau * k / 20
            r = 0.0075
            x = r * math.sin(a)
            z = -r * math.cos(a)
            if z > 0:
                x *= max(0.0, 1 - z / (r * 2.4)) ** 0.9 * (1 + 0.25 * (1 - z / r))
                z *= 1.9
            pts.append((dx + x, z - 0.001))
        ic = _plate("sg_drop", pts, [], -0.0044, -0.0051, "signage_text", "xz")
        parts.append(ic)
    return _join(parts, "sign")


def build_printer_station(item=None):
    parts = _cabinet() + _printer() + _letter_tray(0.21, 0.035)
    # desk sign on a brass easel: the framed plate leans back 14 degrees on a strut, its foot in a lipped base
    sign = _sign("Print & Scan", 0.17, 0.052, 0.026)
    _xf(sign, _T(0.0, 0.004, 0.0425) @ _Rx(-14))
    base = _pill("sg_base", 0.08, 0.032, 0.006, 0.0, 0.006, "brass", ease=0.0015, seg=3, cy=0.012)
    lip = _bx("sg_lip", (-0.08, -0.016, 0.006), (0.08, -0.0085, 0.012), "brass", 0.0012, 1, "x")
    strut = _bx("sg_strut", (-0.006, -0.0015, 0.0), (0.006, 0.0015, 0.05), "brass", 0.0006, 1, "z")
    _xf(strut, _T(0.0, 0.03, 0.005) @ _Rx(-22))
    ds = _join([sign, base, lip, strut], "sg_desk")
    _xf(ds, _T(0.455, -0.20, P_TOP))
    parts.append(ds)
    return _clean_slots(_join(parts, "Furniture_Printer_Station_01"))


# ---------------------------------------------------------------------------
# Water refill station
# ---------------------------------------------------------------------------

WS_W, WS_D, WS_H = 0.6, 0.35, 1.5
NICHE = (0.20, 0.93, 1.33)          # half width, bottom, top
NICHE_BACK = -0.055


def build_water_station(item=None):
    hw, hd = WS_W / 2, WS_D / 2
    yf = -hd + 0.008                 # body front, set back so the trims and button stay inside the footprint
    corners = [(-hw, yf), (hw, yf), (hw, hd), (-hw, hd)]
    radii = [0.035, 0.035, 0.003, 0.003]
    parts = []
    # plinth, body, brass band and crowned cap
    pl = _slab("ws_plinth", [(-hw + 0.02, yf + 0.025), (hw - 0.02, yf + 0.025), (hw - 0.02, hd - 0.002), (-hw + 0.02, hd - 0.002)],
               [0.02, 0.02, 0.002, 0.002], [(0.0, 0.0), (0.0, 0.062)], 3, "iron")
    parts.append(_uvb(pl, "iron", "x"))
    body = _slab("ws_body", corners, radii, [(0.002, 0.06), (0.0, 0.062), (0.0, 1.445), (0.0015, 1.447)], 5, "steel_brushed")
    nw, nb, nt = NICHE
    cut = C.box_minmax("ws_cut", (-nw, yf - 0.05, nb), (nw, NICHE_BACK, nt))
    FH._boolean(body, [cut])
    _uvb(body, "steel_brushed", "z")
    C.weighted_normals(body)
    parts.append(body)
    bcorners = [(-hw, yf), (hw, yf), (hw, hd - 0.004), (-hw, hd - 0.004)]
    band = _slab("ws_band", bcorners, radii, [(-0.0025, 1.444), (-0.004, 1.4465), (-0.004, 1.4535), (-0.0025, 1.456)], 5, "brass")
    parts.append(_uvb(band, "brass", "x"))
    cap = _slab("ws_cap", corners, radii, [(0.0, 1.454), (0.0, 1.488), (0.003, 1.495), (0.008, 1.4995), (0.014, 1.5)], 5,
                "steel_brushed")
    parts.append(_uvb(cap, "steel_brushed", "x"))
    # brass kick plate
    parts.append(_bx("ws_kick", (-hw + 0.04, yf - 0.0025, 0.064), (hw - 0.04, yf + 0.001, 0.14), "brass", 0.0012, 1, "x"))
    # niche: brass frame, dark back panel, LED wash light, spout, sensor, drip tray
    fo = _rpoly(_rect(nw + 0.02, (nt - nb) / 2 + 0.02, 0.0, (nb + nt) / 2), 0.012, 0, 3)
    fi = _rpoly(_rect(nw - 0.003, (nt - nb) / 2 - 0.003, 0.0, (nb + nt) / 2), 0.004, 0, 2)
    parts.append(_plate("ws_frame", fo, [fi], yf - 0.005, yf + 0.0015, "brass", "xz", 0.0018, 1, "x"))
    win = _pill("ws_window", 0.045, 0.016, 0.012, 0.0, 0.003, "plastic_dark", ease=0.001, seg=3)
    _xf(win, _T(0.0, nt - 0.055, 0.0))
    _face_front(win)
    _xf(win, _T(0.0, NICHE_BACK + 0.0005, 0.0))
    parts.append(win)
    parts.append(_bx("ws_led", (-nw + 0.02, yf + 0.012, nt - 0.006), (nw - 0.02, yf + 0.022, nt + 0.0005), "led_strip"))
    spout = _turn("ws_spout", [(0.0, 0.0), (0.0058, 0.0), (0.0076, 0.0035), (0.0082, 0.010), (0.0078, 0.030), (0.0105, 0.035),
                               (0.0165, 0.039), (0.0175, 0.046)], 20, "brass", fillet=0.001, caps=(True, True))
    _xf(spout, _T(0.0, -0.105, nt - 0.046 + 0.0005))
    parts.append(spout)
    parts.append(_turn("ws_aerator", [(0.0, -0.0006), (0.0045, -0.0006), (0.0045, 0.0003)], 16, "plastic_dark", caps=(True, False)))
    _xf(parts[-1], _T(0.0, -0.105, nt - 0.046 + 0.0005))
    sens = _turn("ws_sensor", [(0.0, 0.0), (0.0065, 0.0), (0.0065, 0.0008), (0.0045, 0.0014), (0.0, 0.0016)], 14, "glass",
                 caps=(False, False))
    _xf(sens, _T(-0.018, NICHE_BACK - 0.0025, nt - 0.055) @ _Rx(90))
    parts.append(sens)
    st = _turn("ws_status", [(0.0, 0.0), (0.0022, 0.0), (0.0022, 0.0012), (0.0, 0.0016)], 10, "exit_green", caps=(False, False))
    _xf(st, _T(0.02, NICHE_BACK - 0.0025, nt - 0.055) @ _Rx(90))
    parts.append(st)
    # drip tray: brass rim, dark well, grate bars
    tcy = (yf + NICHE_BACK) / 2 - 0.0015
    trim_o = _rpoly(_rect(nw - 0.002, 0.0575, 0.0, tcy), 0.006, 0, 3)
    trim_i = _rpoly(_rect(nw - 0.016, 0.044, 0.0, tcy), 0.004, 0, 3)
    parts.append(_plate("ws_tray", trim_o, [trim_i], nb, nb + 0.016, "brass", "xy", 0.0015, 1, "x"))
    parts.append(_panel("ws_well", trim_i, nb, nb + 0.005, "plastic_dark", "xy", grow=0.002))
    n = 15
    for k in range(n):
        x = -nw + 0.03 + k * (2 * (nw - 0.03)) / (n - 1)
        parts.append(_bx("ws_bar", (x - 0.003, tcy - 0.046, nb + 0.005), (x + 0.003, tcy + 0.046, nb + 0.0125), "steel_brushed",
                         0.0, 1, "y"))
    # manual push button on the right jamb
    pb = _turn("ws_push", [(0.0, 0.0), (0.016, 0.0), (0.0168, 0.0015), (0.0168, 0.004), (0.0125, 0.0055), (0.0115, 0.009),
                           (0.0095, 0.0105), (0.0, 0.011)], 16, "brass", fillet=0.0008, caps=(False, False))
    _xf(pb, _T(nw + 0.052, yf, 1.14) @ _Rx(90))
    parts.append(pb)
    # chiller grille: brass frame, dark backing, louvres
    go = _rpoly(_rect(0.17, 0.12, 0.0, 0.30), 0.008, 0, 3)
    gi = _rpoly(_rect(0.156, 0.106, 0.0, 0.30), 0.003, 0, 2)
    parts.append(_plate("ws_gframe", go, [gi], yf - 0.004, yf + 0.001, "brass", "xz", 0.0012, 1, "x"))
    parts.append(_panel("ws_gback", gi, yf - 0.0005, yf + 0.001, "plastic_dark", "xz", grow=0.0015))
    for k in range(11):
        z = 0.205 + k * 0.019
        lv = _bx("ws_louvre", (-0.156, -0.006, -0.0022), (0.156, 0.006, 0.0022), "steel_brushed", 0.0, 1, "x")
        _xf(lv, _T(0.0, yf - 0.0045, z) @ _Rx(-35))
        parts.append(lv)
    # sign plate over the niche
    sg = _sign("Water Refill", 0.30, 0.056, 0.03, icon="drop")
    _xf(sg, _T(0.0, yf, 1.395))
    parts.append(sg)
    # concealed wall cleat and a filter-service plate on the side
    parts.append(_bx("ws_cleat", (-0.2, hd - 0.012, 1.30), (0.2, hd - 0.002, 1.40), "iron"))
    ob = _clean_slots(_join(parts, "Furniture_Water_Station_01"))
    return ob


KIND_BUILDERS = {
    "desk_computer": build_desk_computer,
    "chair_task": build_chair_task,
    "printer_station": build_printer_station,
    "water_station": build_water_station,
}


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

class _Item:
    def __init__(self, kind, seed=0):
        self.kind, self.seed, self.label, self.w, self.d, self.id = kind, seed, "", None, None, None


def _shot(out_dir, name, target, yaw, pitch, dist, lens=50):
    return FH._shot(os.path.join(out_dir, name + ".png"), target, yaw, pitch, dist, lens)


def _figure():
    """A 1.70 m stand-in figure for scale."""
    prof = [(0.0, 0.0), (0.13, 0.0), (0.14, 0.05), (0.13, 0.80), (0.17, 0.95), (0.20, 1.30), (0.19, 1.40), (0.08, 1.46),
            (0.06, 1.50), (0.09, 1.55), (0.10, 1.62), (0.08, 1.68), (0.0, 1.70)]
    return _turn("Preview_Figure", prof, 24, "plastic_light", fillet=0.02, n=2)


def _report(tri):
    for k, v in tri.items():
        print(f"TRIS {k}: {v}")


def preview_desk(out_dir, tri=None):
    tri = {} if tri is None else tri
    C.reset_scene()
    ob = build_desk_computer(_Item("desk_computer", 0))
    tri[ob.name] = C.tris(ob)
    FH._studio([ob])
    _shot(out_dir, "desk_1", (0, 0, 0.62), 28, 16, 2.9)
    _shot(out_dir, "desk_2", (0, 0, 0.62), -38, 26, 2.9)
    _shot(out_dir, "desk_3", (0, 0, 0.55), 155, 12, 2.9)
    _shot(out_dir, "desk_screen", (0, MON_Y, MON_Z0 + 0.16), 0, 4, 0.95)
    _shot(out_dir, "desk_keyboard", (0.08, -0.17, DH + 0.01), 8, 42, 0.75)
    _shot(out_dir, "desk_grommet", (0.0, 0.25, DH), 165, 38, 0.95)
    _shot(out_dir, "desk_under", (0.35, -0.05, 0.52), 24, -6, 1.25)
    for seed in (1, 2):
        C.reset_scene()
        ob = build_desk_computer(_Item("desk_computer", seed))
        tri[ob.name] = C.tris(ob)
        FH._studio([ob])
        _shot(out_dir, f"desk_v{seed}", (0, 0, 0.62), 26 if seed == 1 else -28, 18, 2.9)
    return tri


def preview_chair(out_dir, tri=None):
    tri = {} if tri is None else tri
    for seed in (0, 1):
        C.reset_scene()
        ob = build_chair_task(_Item("chair_task", seed))
        tri[ob.name] = C.tris(ob)
        FH._studio([ob])
        if seed == 0:
            _shot(out_dir, "chair_1", (0, 0, 0.5), 30, 14, 2.4)
            _shot(out_dir, "chair_2", (0, 0, 0.5), -40, 24, 2.4)
            _shot(out_dir, "chair_3", (0, 0, 0.5), 150, 14, 2.4)
            _shot(out_dir, "chair_side", (0, 0, 0.5), 90, 2, 2.6)
            _shot(out_dir, "chair_base", (0, 0, 0.12), 20, 22, 0.95)
            _shot(out_dir, "chair_back", (0, 0.2, 0.62), 160, 10, 1.1)
        else:
            _shot(out_dir, "chair_v1", (0, 0, 0.5), 30, 14, 2.4)
    return tri


def preview_printer(out_dir, tri=None):
    tri = {} if tri is None else tri
    C.reset_scene()
    ob = build_printer_station()
    tri[ob.name] = C.tris(ob)
    FH._studio([ob])
    _shot(out_dir, "printer_1", (0, 0, 0.6), 28, 14, 3.3)
    _shot(out_dir, "printer_2", (0, 0, 0.6), -36, 24, 3.3)
    _shot(out_dir, "printer_3", (0, 0, 0.6), 150, 12, 3.3)
    _shot(out_dir, "printer_mfp", (PX, -0.1, 1.0), 20, 22, 1.2)
    _shot(out_dir, "printer_panel", (PX + 0.12, -0.27, 1.13), 4, 46, 0.45)
    _shot(out_dir, "printer_sign", (0.42, -0.15, 0.86), -10, 14, 0.75)
    _shot(out_dir, "printer_bay", (0.29, -0.3, 0.4), -12, 6, 1.1)
    return tri


def preview_water(out_dir, tri=None):
    tri = {} if tri is None else tri
    C.reset_scene()
    ob = build_water_station()
    tri[ob.name] = C.tris(ob)
    FH._studio([ob])
    wall = _bx("Preview_Wall", (-1.5, WS_D / 2, 0.0), (1.5, WS_D / 2 + 0.1, 2.6), "plaster")
    _shot(out_dir, "water_1", (0, 0, 0.75), 24, 10, 3.6)
    _shot(out_dir, "water_2", (0, 0, 0.75), -40, 20, 3.6)
    C.remove(wall)
    _shot(out_dir, "water_3", (0, 0, 0.75), 140, 10, 3.6)
    _shot(out_dir, "water_niche", (0, -0.12, 1.15), 14, 12, 0.9)
    _shot(out_dir, "water_sign", (0, -0.17, 1.39), 0, 4, 0.55)
    _shot(out_dir, "water_tray", (0, -0.12, 0.95), 5, 40, 0.55)
    return tri


def preview_row(out_dir, tri=None):
    """Three workstations with chairs against a plaster wall on carpet, a 1.7 m figure for scale."""
    C.reset_scene()
    objs = []
    for i, seed in enumerate((0, 1, 2)):
        d = build_desk_computer(_Item("desk_computer", seed))
        d.location = ((i - 1) * 1.45, 0.0, 0.0)
        ch = build_chair_task(_Item("chair_task", i % 2))
        ch.location = ((i - 1) * 1.45 + 0.04 * (i - 1), -0.72 + 0.04 * (i % 2), 0.0)
        ch.rotation_euler = (0, 0, math.pi + D2R((-8, 5, 12)[i]))
        objs += [d, ch]
    fig = _figure()
    fig.location = (2.3, -1.3, 0.0)
    scene = bpy.context.scene
    R.engine(scene, "EEVEE", 64, (1280, 800))
    R.world(scene, (0.62, 0.66, 0.72), 0.35)
    floor = _bx("Preview_Floor", (-6, -6, -0.01), (6, 6, 0.0), "carpet_tiles")
    wall = _bx("Preview_Wall", (-6, 0.38, 0.0), (6, 0.5, 3.5), "plaster")
    base = _bx("Preview_Skirting", (-6, 0.36, 0.0), (6, 0.38, 0.16), "walnut")
    R.area_light("Window", (-3.5, -2.5, 3.2), (0, 0, 0.8), 450, 3.0, (0.82, 0.88, 1.0))
    R.area_light("Warm", (3.0, -3.0, 2.6), (0, 0, 0.8), 260, 2.0, (1.0, 0.86, 0.68))
    R.area_light("Top", (0.0, -1.5, 3.4), (0, 0, 0.6), 200, 4.0, (1.0, 0.95, 0.88))
    cam = R.camera(lens=35)
    R.look(cam, (2.9, -5.3, 1.8), (0.35, -0.3, 0.75))
    R.render(os.path.join(out_dir, "row_workstations.png"))
    R.look(cam, (-0.4, -1.75, 1.32), (0.15, 0.1, 0.86))
    R.render(os.path.join(out_dir, "row_seated_view.png"))
    del floor, wall, base
    return tri


def preview(out_dir):
    tri = {}
    preview_desk(out_dir, tri)
    preview_chair(out_dir, tri)
    preview_printer(out_dir, tri)
    preview_water(out_dir, tri)
    preview_row(out_dir, tri)
    _report(tri)
