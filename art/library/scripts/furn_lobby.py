"""
Entrance hall furniture for the OVR library (milestone 2): the information desk, the floor directory,
hall benches, the coat and umbrella stands, the noticeboards and the paired bins.

KIND_BUILDERS (plan.KINDS sizes; each builder(item) returns ONE joined, multi-material mesh at the origin,
floor at z = 0, front facing Blender -Y):

  desk_info        3.2 x 1.1 x 1.08 reception counter. A bowed (three-facet) walnut front on a moulded
                   plinth: fielded panels in bolection mouldings between fluted pilasters, engaged turned
                   columns at the corners, an architrave band, a frieze with inset brass "INFORMATION"
                   lettering in a moulded tablet (turned paterae on the wings and ends), a cove-and-ovolo
                   cornice and a veined cream marble transaction ledge. Behind it (+Y, the staff side) a
                   walnut work top with a green leather inlay on two drawer pedestals (brass cup pulls),
                   two monitors (a catalogue screen texture) with keyboards and mice, the hall's brass
                   reading lamp (light_points / light_color, desk-local), a stack of returned books. On the
                   public ledge: a brass service bell on a walnut base and a leaflet stand.
  directory_board  1.2 x 0.45 x 2.0 freestanding floor directory: turned walnut posts with finials on
                   trestle feet, a moulded frame with a green crest carrying gilt "LIBRARY DIRECTORY", and
                   a printed ground-floor plan drawn from plan.ROOMS / WALLS / ITEMS (zone colours,
                   labelled rooms, the Upper Gallery overhead, stairs, lift, washrooms, exits, the main
                   entrance and a red "You are here" marker at the board's own position).
  bench_lobby      1.8 x 0.5 x 0.46 hall bench: six turned legs on brass cups, a turned H-stretcher, a
                   beaded apron with paterae on the leg blocks, a thumbnail-moulded seat board and a crowned
                   green leather cushion with piping and brass nailheads (seats at x = +-0.45, 0.45 m).
  coat_stand       0.5 x 1.85 bentwood coat stand: turned walnut pole and finial, four S-curved bentwood
                   legs tied by a ring, six brass double hooks; a grey tweed overcoat and a striped college
                   scarf hang on the hooks of the local +Y side (the plan turns local -Y to the wall).
  umbrella_stand   0.36 x 0.6 spun brass umbrella stand with beaded bands and lion-boss ring handles,
                   holding a black crook-handled umbrella and a green one.
  noticeboard      1.6 x 0.06 x 1.15 wall-mounted (back on y = 0, bottom edge at z = 1.0) walnut-framed cork
                   board with a brass title plate. item.label "events": pinned notices (Events, Study
                   Groups with tear-off tabs, Library Hours, Lost & Found, a book-sale flyer, index cards);
                   "map": a pinned campus map with two notes.
  bins_pair        0.8 x 0.4 x 0.85 pair of dark green powder-coated bins with brass bands, hooded brass dome
                   lids and curved enamel plaques ("RECYCLING" / "WASTE" with icons).

Printed graphics (the directory plan, notices, map, bin plaques, screens, leaflet covers) and the marble are
generated at build time: graphics are drawn as text/shape objects and rendered by Workbench in a private
scene, the marble is procedural numpy noise. Both become packed images (the GLB carries them); nothing is
written into art/library/textures.

preview(out_dir) renders every asset (EEVEE studio views, close-ups, and a 1.7 m stand-in for scale on the desk
and directory) and prints dimensions, bounds, light points and triangle counts; preview_desk / preview_directory /
preview_notice / preview_small(out_dir) render one group (run_asset.py --func ...).
"""

from __future__ import annotations

import math
import os
import tempfile

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

import lib_core as C
import lib_materials as LM
import lib_render as R
import plan as P
from furn_hall import (_bridge, _cap, _catmull, _copy, _extrude, _finish, _join, _light_lamps, _loft, _mat, _mitre_loft,
                       _night, _rect, _rpoly, _shot, _slab, _studio, _T, _turn, _turn_between, _tube, _uv_turned,
                       _uvb, _views, _xf, _Rx, _Ry, _Rz, build_lamp_desk_brass)
from lib_materials import tex_size


# ---------------------------------------------------------------------------
# Palette additions (only this module uses them)
# ---------------------------------------------------------------------------

def _lin3(h):
    return LM._hex(h)[:3]


def _to_srgb(c):
    c = max(0.0, min(1.0, c))
    return c * 12.92 if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055


def _fabric_tint(base_hex):
    """Tint that makes the shared fabric texture render at `base_hex` (fabric_cream renders its base
    through the tint #fffffb, which gives the texture's mean colour)."""
    mean = [b / t for b, t in zip(_lin3("#d8ccb4"), _lin3("#fffffb"))]
    return "#" + "".join(f"{round(_to_srgb(b / m) * 255):02x}" for b, m in zip(_lin3(base_hex), mean))


_ADD = {
    # Polished cream marble (veined image generated at build time, see _marble_image).
    "marble_cream": dict(base="#e6dece", rough=0.12, size=1.6, coat=0.6, coat_rough=0.05),
    # Wool and knit for the coat and the college scarf, coat lining.
    "wool_grey": dict(base="#6d6a65", rough=0.93, tex="fabric", size=0.25, normal=0.6, tint=_fabric_tint("#6d6a65")),
    "wool_burgundy": dict(base="#6b1f2b", rough=0.92, tex="fabric", size=0.2, normal=0.6, tint=_fabric_tint("#6b1f2b")),
    "wool_gold": dict(base="#c1902f", rough=0.9, tex="fabric", size=0.2, normal=0.6, tint=_fabric_tint("#c1902f")),
    "lining_silk": dict(base="#4b1c25", rough=0.42),
    "canopy_black": dict(base="#1c1d22", rough=0.58, tex="fabric", size=0.25, normal=0.35, tint=_fabric_tint("#1c1d22")),
    # Satin powder coat on the bins (a light clear coat keeps the sheen of baked enamel).
    "powdercoat_green": dict(base="#1e3a2c", rough=0.4, coat=0.35, coat_rough=0.3),
    # Plastic map pins.
    "pin_red": dict(base="#b4231c", rough=0.3, coat=0.5, coat_rough=0.1),
    "pin_blue": dict(base="#24489a", rough=0.3, coat=0.5, coat_rough=0.1),
    "pin_yellow": dict(base="#e0ac1f", rough=0.3, coat=0.5, coat_rough=0.1),
    "pin_green": dict(base="#2a7a3e", rough=0.3, coat=0.5, coat_rough=0.1),
    # Printed surfaces: flat paper/enamel colours; the build attaches the generated artwork image.
    "print_directory": dict(base="#efe7d4", rough=0.82),
    "print_notices": dict(base="#efe6d2", rough=0.86),
    "print_campus_map": dict(base="#efe6d2", rough=0.8),
    "print_bins": dict(base="#efe7d6", rough=0.32, coat=0.35, coat_rough=0.12),
    "print_desk": dict(base="#efe6d2", rough=0.6),
    # Monitor screens: the catalogue UI drives both colour and emission (lit from within).
    "screen_catalogue": dict(base="#dfe5ec", rough=0.18, emission="#ffffff", emit=0.7),
}
for _k, _v in _ADD.items():
    LM.PALETTE.setdefault(_k, _v)

WOOD = "walnut"
WOOD_DK = "walnut_dark"
BRASS = "brass"
BRASS_OLD = "brass_aged"

FONT_FILES = {
    "gill": "/System/Library/Fonts/Supplemental/GillSans.ttc",
    "bask": "/System/Library/Fonts/Supplemental/Baskerville.ttc",
    "georgia": "/System/Library/Fonts/Supplemental/Georgia.ttf",
    "georgia_b": "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "georgia_i": "/System/Library/Fonts/Supplemental/Georgia Italic.ttf",
    "type": "/System/Library/Fonts/Supplemental/AmericanTypewriter.ttc",
    "hand": "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf",
    "futura": "/System/Library/Fonts/Supplemental/Futura.ttc",
    "bodoni": "/System/Library/Fonts/Supplemental/Bodoni 72.ttc",
}


def _font(key):
    path = FONT_FILES.get(key)
    if path and os.path.exists(path):
        try:
            return bpy.data.fonts.load(path, check_existing=True)
        except RuntimeError:
            pass
    return None   # Blender's built-in font


# ---------------------------------------------------------------------------
# Small geometry helpers
# ---------------------------------------------------------------------------

def _mslab(name, outline, profile, key, grain=None, caps=(True, True), smooth=35.0):
    """A slab over any simple polygon `outline` [(x, y)] (CCW from above, concave allowed) whose edge follows
    `profile` [(inset, z)] bottom to top; rings are mitred offsets, caps are tessellated."""
    P0 = [Vector(p) for p in outline]
    n = len(P0)
    mit = []
    for i in range(n):
        e1 = (P0[i] - P0[i - 1]).normalized()
        e2 = (P0[(i + 1) % n] - P0[i]).normalized()
        n1, n2 = Vector((-e1.y, e1.x)), Vector((-e2.y, e2.x))
        mit.append((n1 + n2) / (1 + n1.dot(n2)))
    bm = bmesh.new()
    rings = [[bm.verts.new((P0[i].x + mit[i].x * d, P0[i].y + mit[i].y * d, z)) for i in range(n)] for d, z in profile]
    for A, B in zip(rings, rings[1:]):
        _bridge(bm, A, B, True)
    if caps[0]:
        _cap(bm, [rings[0]], (0, 0, -1))
    if caps[1]:
        _cap(bm, [rings[-1]], (0, 0, 1))
    ob = _finish(bm, name, key, smooth)
    return _uvb(ob, key, grain)


def _offset_line(p0, p1, d):
    """The line p0->p1 moved d to its right (seen from above)."""
    p0, p1 = Vector(p0), Vector(p1)
    t = (p1 - p0).normalized()
    n = Vector((t.y, -t.x))
    return p0 + n * d, p1 + n * d


def _intersect(a0, a1, b0, b1):
    a0, a1, b0, b1 = (Vector(v) for v in (a0, a1, b0, b1))
    da, db = a1 - a0, b1 - b0
    den = da.x * db.y - da.y * db.x
    t = ((b0.x - a0.x) * db.y - (b0.y - a0.y) * db.x) / den
    return a0 + da * t


def _offset_poly_open(pts, d):
    """Offsets an open polyline d to its right with mitred joints."""
    out = []
    n = len(pts)
    for i in range(n):
        if i == 0:
            out.append(_offset_line(pts[0], pts[1], d)[0])
        elif i == n - 1:
            out.append(_offset_line(pts[-2], pts[-1], d)[1])
        else:
            a = _offset_line(pts[i - 1], pts[i], d)
            b = _offset_line(pts[i], pts[i + 1], d)
            out.append(_intersect(a[0], a[1], b[0], b[1]))
    return out


def _sweep(name, profile, path, key, closed=False, grain=None, smooth=35.0):
    """lib_core.sweep (profile (u, v): u to the path's right, v up) with real-scale UVs."""
    ob = C.sweep(name, profile, [tuple(p) for p in path], _mat(key), closed_path=closed, smooth_angle=smooth)
    return _uvb(ob, key, grain)


def _frame_M(p0, p1):
    """Matrix of a vertical face running p0 -> p1 in plan, outward to the path's right: local x along the
    face (origin at its midpoint), local -y outward, z up."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    mid = (p0 + p1) / 2
    return Matrix.Translation((mid.x, mid.y, 0)) @ Matrix.Rotation(math.atan2(d.y, d.x), 4, "Z"), d.length


def _ring_pts(n, r, z=0.0, a0=0.0):
    return [(r * math.cos(a0 + math.tau * k / n), r * math.sin(a0 + math.tau * k / n), z) for k in range(n)]


def _text3d(name, body, size, depth, key, font="bask", center=(0.0, 0.0), z0=0.0, spacing=1.0, resolution=2,
            offset=0.0):
    """Raised lettering in the XY plane (reads from +Z), centred on `center`, standing on z0; back faces dropped."""
    cu = bpy.data.curves.new(name, type="FONT")
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.resolution_u = resolution
    cu.align_x = "CENTER"
    cu.space_character = spacing
    cu.offset = offset
    f = _font(font)
    if f is not None:
        cu.font = f
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f_ for f_ in bm.faces if f_.normal.z < -0.9], context="FACES")
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    me.materials.clear()
    me.materials.append(_mat(key))
    xs = [v.co.x for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    _xf(ob, _T(center[0] - (min(xs) + max(xs)) / 2, center[1] - (min(ys) + max(ys)) / 2, z0 - min(zs)))
    C.shade_smooth(ob, 30)
    _uvb(ob, key)
    return ob


def _quad_uv(name, corners, uvs, key, two_sided=False):
    """A single quad (or a grid row) with explicit UVs; corners CCW seen from the front."""
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in corners]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.new("UVMap")
    for lo, t in zip(f.loops, uvs):
        lo[uv].uv = t
    ob = _finish(bm, name, key, 30, recalc=False)
    return ob


def _sheet(name, w, h, uv_rect, key, curl=0.0, nx=6, ny=8, back_key="paper", thick=0.0004, lift=None):
    """A sheet of paper in the XZ plane facing -Y (centred at the origin), with its printed face mapped to
    `uv_rect` (u0, v0, u1, v1) of the artwork, a back face, and an optional bow (`curl`, m) of the free
    lower corners away from the board (toward -Y). `lift(u, v)` adds extra -Y offset per point."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    u0, v0, u1, v1 = uv_rect
    F, B = [], []
    for j in range(ny + 1):
        rowf, rowb = [], []
        for i in range(nx + 1):
            s, t = i / nx, j / ny
            x = -w / 2 + w * s
            z = -h / 2 + h * t
            off = curl * ((1 - t) ** 2) * (0.35 + 0.65 * abs(2 * s - 1) ** 2)
            if lift is not None:
                off += lift(s, t)
            rowf.append(bm.verts.new((x, -off - thick, z)))
            rowb.append(bm.verts.new((x, -off, z)))
        F.append(rowf)
        B.append(rowb)
    for j in range(ny):
        for i in range(nx):
            f = bm.faces.new((F[j][i], F[j][i + 1], F[j + 1][i + 1], F[j + 1][i]))
            f.material_index = 0
            for lo in f.loops:
                vi = None
                for jj in (j, j + 1):
                    for ii in (i, i + 1):
                        if F[jj][ii] is lo.vert:
                            vi = (ii, jj)
                lo[uvl].uv = (u0 + (u1 - u0) * vi[0] / nx, v0 + (v1 - v0) * vi[1] / ny)
            g = bm.faces.new((B[j][i], B[j + 1][i], B[j + 1][i + 1], B[j][i + 1]))
            g.material_index = 1
            for lo in g.loops:
                lo[uvl].uv = (lo.vert.co.x, lo.vert.co.z)
    # paper edge
    ring_f = [F[0][i] for i in range(nx + 1)] + [F[j][nx] for j in range(1, ny + 1)] + \
             [F[ny][i] for i in range(nx - 1, -1, -1)] + [F[j][0] for j in range(ny - 1, 0, -1)]
    ring_b = [B[0][i] for i in range(nx + 1)] + [B[j][nx] for j in range(1, ny + 1)] + \
             [B[ny][i] for i in range(nx - 1, -1, -1)] + [B[j][0] for j in range(ny - 1, 0, -1)]
    for k in range(len(ring_f)):
        k2 = (k + 1) % len(ring_f)
        try:
            f = bm.faces.new((ring_f[k], ring_b[k], ring_b[k2], ring_f[k2]))
            f.material_index = 1
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, [_mat(key), _mat(back_key)])
    C.shade_smooth(ob, 60)
    return ob


# ---------------------------------------------------------------------------
# Generated images: Workbench "print" canvas and procedural marble
# ---------------------------------------------------------------------------

def _hexc(h):
    return LM._hex(h)


def _pack_png(name, path):
    img = bpy.data.images.load(path)
    img.name = name
    img.pack()
    img.filepath_raw = f"//{name}.png"
    return img


class Canvas:
    """A flat drawing in metres (origin bottom-left, x right, y up) rendered by Workbench (flat material
    colours, anti-aliased) into a packed image. Higher `z` draws on top."""

    def __init__(self, name, w, h, ppm, bg="#efe6d2", aa="16"):
        self.name, self.w, self.h = name, w, h
        self.res = (max(16, round(w * ppm)), max(16, round(h * ppm)))
        sc = bpy.data.scenes.new(f"Bake_{name}")
        sc.render.engine = "BLENDER_WORKBENCH"
        sh = sc.display.shading
        sh.light = "FLAT"
        sh.color_type = "MATERIAL"
        try:
            sh.show_specular_highlight = False
        except AttributeError:
            pass
        sc.display.render_aa = aa
        sc.view_settings.view_transform = "Standard"
        sc.view_settings.look = "None"
        sc.view_settings.exposure = 0.0
        sc.view_settings.gamma = 1.0
        sc.render.resolution_x, sc.render.resolution_y = self.res
        sc.render.resolution_percentage = 100
        sc.render.film_transparent = False
        sc.render.image_settings.file_format = "PNG"
        sc.render.image_settings.color_mode = "RGB"
        cam = bpy.data.objects.new(f"BakeCam_{name}", bpy.data.cameras.new(f"BakeCam_{name}"))
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = max(w, h)
        cam.data.clip_start = 0.01
        cam.data.clip_end = 100
        cam.location = (w / 2, h / 2, 20)
        sc.collection.objects.link(cam)
        sc.camera = cam
        self.sc, self.cam = sc, cam
        self.objs, self.mats, self.curves = [cam], {}, []
        self.rect(0, 0, w, h, bg, z=0)

    # -- primitives ------------------------------------------------------------------------------------
    def _m(self, color):
        m = self.mats.get(color)
        if m is None:
            m = bpy.data.materials.new(f"BakeMat_{self.name}_{len(self.mats)}")
            m.diffuse_color = _hexc(color)
            self.mats[color] = m
        return m

    def _link(self, ob):
        self.sc.collection.objects.link(ob)
        self.objs.append(ob)
        return ob

    def mesh(self, verts, faces, color, z):
        me = bpy.data.meshes.new(f"BakeMesh_{self.name}")
        me.from_pydata([(x, y, z * 0.001) for x, y in verts], [], faces)
        me.materials.append(self._m(color))
        return self._link(bpy.data.objects.new(me.name, me))

    def rect(self, x0, y0, x1, y1, color, z=1):
        return self.mesh([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], [(0, 1, 2, 3)], color, z)

    def poly(self, pts, color, z=1, holes=()):
        loops = [[Vector((p[0], p[1], 0)) for p in pts]] + [[Vector((p[0], p[1], 0)) for p in h] for h in holes]
        flat = [(v.x, v.y) for L in loops for v in L]
        tris = tessellate_polygon(loops)
        return self.mesh(flat, [tuple(t) for t in tris], color, z)

    def line(self, p0, p1, width, color, z=2):
        p0, p1 = Vector(p0), Vector(p1)
        d = (p1 - p0)
        if d.length < 1e-9:
            return None
        n = Vector((-d.y, d.x)).normalized() * width / 2
        return self.poly([p0 - n, p1 - n, p1 + n, p0 + n], color, z)

    def polyline(self, pts, width, color, z=2, closed=False):
        pts = list(pts) + ([pts[0]] if closed else [])
        for a, b in zip(pts, pts[1:]):
            self.line(a, b, width, color, z)
        for p in pts[1:-1] if not closed else pts:
            self.circle(p, width / 2, color, z, 12)

    def circle(self, c, r, color, z=2, seg=48):
        return self.poly([(c[0] + r * math.cos(math.tau * k / seg), c[1] + r * math.sin(math.tau * k / seg)) for k in range(seg)], color, z)

    def ring(self, c, r0, r1, color, z=2, seg=48):
        outer = [(c[0] + r1 * math.cos(math.tau * k / seg), c[1] + r1 * math.sin(math.tau * k / seg)) for k in range(seg)]
        inner = [(c[0] + r0 * math.cos(math.tau * k / seg), c[1] + r0 * math.sin(math.tau * k / seg)) for k in range(seg)]
        return self.poly(outer, color, z, holes=[inner])

    def outline_rect(self, x0, y0, x1, y1, width, color, z=2):
        self.rect(x0, y0, x1, y0 + width, color, z)
        self.rect(x0, y1 - width, x1, y1, color, z)
        self.rect(x0, y0, x0 + width, y1, color, z)
        self.rect(x1 - width, y0, x1, y1, color, z)

    def text(self, body, x, y, size, color, font="gill", align="CENTER", valign="CENTER", z=8, rot=0.0,
             bold=0.0, spacing=1.0, maxw=None, line=1.15, italic=False):
        """`size` is the cap height in metres (about 0.7 em)."""
        cu = bpy.data.curves.new(f"BakeTxt_{self.name}", type="FONT")
        cu.body = body
        cu.size = size / 0.7
        cu.align_x = align
        cu.align_y = valign
        cu.space_character = spacing
        cu.space_line = line
        cu.offset = bold * size
        cu.resolution_u = 4
        if italic:
            cu.shear = 0.18
        f = _font(font)
        if f is not None:
            cu.font = f
        cu.materials.append(self._m(color))
        ob = bpy.data.objects.new(cu.name, cu)
        ob.location = (x, y, z * 0.001)
        ob.rotation_euler = (0, 0, rot)
        self._link(ob)
        self.curves.append(cu)
        if maxw is not None:
            wd = self.measure(ob)
            if wd > maxw:
                cu.size *= maxw / wd
        return ob

    def measure(self, ob):
        dg = self.sc.view_layers[0].depsgraph
        dg.update()
        me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
        xs = [v.co.x for v in me.vertices]
        bpy.data.meshes.remove(me)
        return (max(xs) - min(xs)) if xs else 0.0

    # -- output -----------------------------------------------------------------------------------------
    def bake(self, img_name):
        d = tempfile.mkdtemp(prefix="ovr_lobby_")
        path = os.path.join(d, f"{img_name}.png")
        self.sc.render.filepath = path
        bpy.ops.render.render(write_still=True, scene=self.sc.name)
        img = _pack_png(img_name, path)
        os.remove(path)
        os.rmdir(d)
        for ob in self.objs:
            data = ob.data
            bpy.data.objects.remove(ob, do_unlink=True)
            if isinstance(data, bpy.types.Mesh) and data.users == 0:
                bpy.data.meshes.remove(data)
            elif isinstance(data, bpy.types.Camera) and data.users == 0:
                bpy.data.cameras.remove(data)
        for cu in self.curves:
            if cu.users == 0:
                bpy.data.curves.remove(cu)
        for m in self.mats.values():
            if m.users == 0:
                bpy.data.materials.remove(m)
        bpy.data.scenes.remove(self.sc)
        return img


def _attach_image(key, img, emit=False):
    """The palette material for `key`, with `img` wired into Base Color (and Emission Color) once."""
    m = _mat(key)
    nt = m.node_tree
    if any(n.type == "TEX_IMAGE" and n.image == img for n in nt.nodes):
        return m
    for n in [n for n in nt.nodes if n.type == "TEX_IMAGE"]:
        nt.nodes.remove(n)
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    node = nt.nodes.new("ShaderNodeTexImage")
    node.image = img
    node.interpolation = "Cubic"
    node.location = (-600, 300)
    nt.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])
    if emit:
        nt.links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
    m["ovr_generated_image"] = img.name
    return m


def _marble_image(name="TX_Lobby_MarbleCream", n=1024, seed=23):
    """Seamless (periodic) veined cream marble: FFT fractal fields, veins at the zero crossings of a
    stretched field (Botticino / Calacatta-like), fading in and out, with fine secondary veins."""
    img = bpy.data.images.get(name)
    if img is not None:
        return img
    import numpy as np
    rng = np.random.default_rng(seed)
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.fftfreq(n)[None, :]

    def field(beta, stretch=1.0, ang=0.0, kmin=0.0):
        c, s = math.cos(ang), math.sin(ang)
        u = (fx * c + fy * s) * stretch
        v = (-fx * s + fy * c)
        kk = np.sqrt(u * u + v * v)
        kk[0, 0] = 1.0
        spec = (rng.standard_normal((n, n)) + 1j * rng.standard_normal((n, n))) * kk ** (-beta)
        spec[np.sqrt(fx * fx + fy * fy) < kmin] = 0
        spec[0, 0] = 0
        f = np.real(np.fft.ifft2(spec))
        return f / f.std()

    cloud = field(2.6)
    cloud2 = field(1.7)
    v1 = field(2.3, stretch=2.6, ang=0.35, kmin=1.5 / n)
    v2 = field(1.9, stretch=1.8, ang=-0.5, kmin=4.0 / n)
    fade1 = np.clip(0.55 + 0.6 * field(2.4), 0, 1)
    fade2 = np.clip(0.2 + 0.5 * field(2.2), 0, 1)
    w1 = 0.05 + 0.03 * np.tanh(field(2.0))
    vein1 = np.exp(-(v1 / w1) ** 2) * fade1
    halo1 = np.exp(-(v1 / (w1 * 5.0)) ** 2) * fade1
    vein2 = np.exp(-(v2 / 0.035) ** 2) * fade2
    base1 = np.array([0.925, 0.900, 0.846])     # sRGB
    base2 = np.array([0.885, 0.845, 0.770])
    t = np.clip(0.5 + 0.22 * cloud + 0.08 * cloud2, 0, 1)[..., None]
    col = base1 * (1 - t) + base2 * t
    vc1 = np.array([0.56, 0.52, 0.47])
    vc2 = np.array([0.70, 0.64, 0.55])
    hc = np.array([0.80, 0.74, 0.64])
    a = (0.35 * halo1)[..., None]
    col = col * (1 - a) + hc * a
    a = (0.85 * vein1)[..., None]
    col = col * (1 - a) + vc1 * a
    a = (0.55 * vein2)[..., None]
    col = col * (1 - a) + vc2 * a
    rgba = np.ones((n, n, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(col, 0, 1)
    gen = bpy.data.images.new(name + "_gen", n, n, alpha=False)
    gen.pixels.foreach_set(rgba.ravel())
    d = tempfile.mkdtemp(prefix="ovr_lobby_")
    path = os.path.join(d, f"{name}.png")
    gen.filepath_raw = path
    gen.file_format = "PNG"
    gen.save()
    bpy.data.images.remove(gen)
    img = _pack_png(name, path)
    os.remove(path)
    os.rmdir(d)
    return img


def _marble_mat():
    return _attach_image("marble_cream", _marble_image())


# ---------------------------------------------------------------------------
# Shared turned parts and hardware
# ---------------------------------------------------------------------------

def _patera(r=0.016, key=WOOD, seg=20):
    """Turned rosette (centre at the origin, rising along +Z from z = 0)."""
    return _turn("patera", [(r, 0.0), (r, 0.0014), (r * 0.80, 0.0034), (r * 0.62, 0.0030), (r * 0.42, 0.0040),
                            (r * 0.20, 0.0062), (0.0, 0.0068)], seg, key, caps=(False, False), smooth=40)


def _place_on_face(ob, M, x, z, out=0.0):
    """Puts a part built along +Z (facing up) onto a face frame M at (x, z), facing outward (-y local)."""
    return _xf(ob, M @ _T(x, -out, z) @ _Rx(90))


def _nail(r=0.0052, seg=7):
    return _turn("nail", [(r, 0.0), (r * 0.92, r * 0.42), (r * 0.62, r * 0.82), (0.0, r * 0.98)], seg, BRASS_OLD,
                 caps=(False, False), smooth=60)


def _knob(r=0.012, key=BRASS):
    """Turned brass knob along +Z from z = 0 (rose, neck, mushroom head)."""
    return _turn("knob", [(r * 0.9, 0.0), (r * 0.9, 0.002), (r * 0.45, 0.004), (r * 0.38, 0.012), (r * 0.8, 0.016),
                          (r, 0.021), (r * 0.85, 0.026), (r * 0.4, 0.0285), (0.0, 0.029)], 14, key, caps=(False, False))


def _cup_pull(w=0.09, key=BRASS):
    """Brass cup (bin) pull on a backplate, built in XZ facing -Y with its back on y = 0."""
    parts = []
    plate = _slab("cup_plate", _rect(w / 2, 0.019), 0.004, [(0.0, 0.0), (0.0, 0.0015), (0.0015, 0.0025)], 2, key)
    _xf(plate, _Rx(90))
    parts.append(plate)
    # the cup: a half-cylinder shell opening upward
    bm = bmesh.new()
    n = 9
    rings = []
    hw = w / 2 - 0.006
    for k in range(n + 1):
        a = math.pi * k / n
        y = -0.0025 - 0.016 * math.sin(a)
        z = -0.002 - 0.012 * (1 - math.cos(a)) * 0.5 - 0.008 * math.sin(a)
        rings.append((y, z))
    outer = [[bm.verts.new((x, y, z)) for y, z in rings] for x in (-hw, hw)]
    for j in range(n):
        bm.faces.new((outer[0][j], outer[1][j], outer[1][j + 1], outer[0][j + 1]))
    for side, sx in ((outer[0], -1), (outer[1], 1)):
        bm.faces.new(side if sx > 0 else list(reversed(side)))
    ob = _finish(bm, "cup", key, 40)
    _uvb(ob, key, "x")
    parts.append(ob)
    return _join(parts, "cup_pull")


# ---------------------------------------------------------------------------
# bench_lobby
# ---------------------------------------------------------------------------

B_W, B_D = 1.8, 0.5
B_BOARD0, B_BOARD1 = 0.362, 0.388           # thumbnail-moulded seat board
B_APRON0 = 0.282
B_LEGX = (-0.855, 0.0, 0.855)
B_LEGY = 0.205
B_BLOCK = 0.054
B_CUSH_HW, B_CUSH_HH = 0.872, 0.226
BENCH_LEG = [(0.0185, 0.018), (0.0215, 0.022), (0.0250, 0.034), (0.0262, 0.046), (0.0250, 0.058), (0.0200, 0.070),
             (0.0160, 0.078), (0.0172, 0.084), (0.0186, 0.089), (0.0170, 0.095), (0.0186, 0.108), (0.0225, 0.135),
             (0.0248, 0.165), (0.0244, 0.190), (0.0215, 0.212), (0.0165, 0.228), (0.0150, 0.234), (0.0180, 0.240),
             (0.0196, 0.246), (0.0180, 0.252), (0.0170, 0.256), (0.0215, 0.266), (0.0250, 0.276), (0.0262, B_APRON0 + 0.001)]
STRETCH_PROF = [(0.0105, 0.0), (0.0118, 0.08), (0.0125, 0.30), (0.0145, 0.46), (0.0150, 0.5), (0.0145, 0.54),
                (0.0125, 0.70), (0.0118, 0.92), (0.0105, 1.0)]


def build_bench_lobby(item=None):
    """1.8 x 0.5 m hall bench, seat 0.45 m: turned walnut legs, beaded apron, nailed green leather cushion."""
    parts = []
    # seat board with a thumbnail edge over a small cove
    prof = [(0.010, B_BOARD0), (0.006, B_BOARD0 + 0.0015), (0.003, B_BOARD0 + 0.004), (0.0005, B_BOARD0 + 0.008),
            (0.0, B_BOARD0 + 0.012), (0.0, B_BOARD1 - 0.008), (0.0015, B_BOARD1 - 0.0035), (0.0045, B_BOARD1 - 0.001),
            (0.008, B_BOARD1)]
    board = _slab("bn_board", _rect(B_W / 2, B_D / 2), 0.014, prof, 3, WOOD)
    _uvb(board, WOOD, "x")
    parts.append(board)
    # apron rails between the leg blocks (flush with the blocks), astragal along the bottom
    xo, yo = B_LEGX[-1] + B_BLOCK / 2, B_LEGY + B_BLOCK / 2
    t = 0.022
    for sy in (-1, 1):
        for a, b in ((B_LEGX[0], B_LEGX[1]), (B_LEGX[1], B_LEGX[2])):
            parts.append(_bx("bn_apron", (a + B_BLOCK / 2, sy * yo - (t if sy > 0 else 0), B_APRON0),
                             (b - B_BLOCK / 2, sy * yo + (0 if sy > 0 else t), B_BOARD0), WOOD, 0.0015, 1, "x"))
    for sx in (-1, 1):
        parts.append(_bx("bn_apron", (sx * xo - (t if sx > 0 else 0), -B_LEGY + B_BLOCK / 2, B_APRON0),
                         (sx * xo + (0 if sx > 0 else t), B_LEGY - B_BLOCK / 2, B_BOARD0), WOOD, 0.0015, 1, "y"))
    # middle cross rail under the board (ties the middle legs)
    parts.append(_bx("bn_rail", (-0.011, -B_LEGY + B_BLOCK / 2, B_APRON0 + 0.02), (0.011, B_LEGY - B_BLOCK / 2, B_BOARD0),
                     WOOD, 0.0, 1, "y"))
    per = [(-xo, -yo, B_APRON0), (xo, -yo, B_APRON0), (xo, yo, B_APRON0), (-xo, yo, B_APRON0)]
    astr = [(0.0030 + 0.0052 * math.cos(a), 0.0052 * math.sin(a)) for a in (math.tau * k / 10 for k in range(10))]
    parts.append(_uvb(_mitre_loft("bn_astragal", per, (0, 0, 1), astr, WOOD), WOOD, "x"))
    cove = [(0.0, 0.0)] + [(-0.010 + 0.010 * math.cos(math.radians(a)), -0.010 + 0.010 * math.sin(math.radians(a)))
                           for a in (0, 30, 60, 90)]
    cove[-1] = (-0.010, 0.0)
    per_t = [(x, y, B_BOARD0) for x, y, _ in per]
    parts.append(_uvb(_mitre_loft("bn_cove", per_t, (0, 0, 1), cove, WOOD), WOOD, "x"))
    # legs: square blocks under the board, turned below, brass cups at the feet
    pat = _patera(0.0145, seg=12)
    cup = _turn("bn_cup", [(0.0205, 0.0), (0.0212, 0.002), (0.0210, 0.014), (0.0196, 0.019), (0.0186, 0.019)], 12, BRASS_OLD,
                caps=(True, False))
    leg = _turn("bn_leg", BENCH_LEG, 12, WOOD, fillet=0.0012)
    for x in B_LEGX:
        for sy in (-1, 1):
            y = sy * B_LEGY
            parts.append(_bx("bn_block", (x - B_BLOCK / 2, y - B_BLOCK / 2, B_APRON0), (x + B_BLOCK / 2, y + B_BLOCK / 2, B_BOARD0),
                             WOOD, 0.002, 1, "z"))
            lg = _copy(leg)
            _xf(lg, _T(x, y, 0))
            parts.append(lg)
            c = _copy(cup)
            _xf(c, _T(x, y, 0))
            parts.append(c)
            zm = (B_APRON0 + B_BOARD0) / 2 - 0.004
            p = _copy(pat)
            _xf(p, _T(x, y + sy * B_BLOCK / 2, zm) @ _Rx(-90 * sy))
            parts.append(p)
    for o in (pat, cup, leg):
        C.remove(o)
    # turned H-stretcher: three cross stretchers and a long one through their middles
    zs = 0.112
    for x in B_LEGX:
        parts.append(_turn_between("bn_str", (x, -B_LEGY + 0.012, zs), (x, B_LEGY - 0.012, zs), STRETCH_PROF, 12, WOOD, 0.0008))
    for a, b in ((B_LEGX[0], B_LEGX[1]), (B_LEGX[1], B_LEGX[2])):
        parts.append(_turn_between("bn_str", (a + 0.008, 0, zs), (b - 0.008, 0, zs), STRETCH_PROF, 12, WOOD, 0.0008))
    # crowned leather cushion with piping and nailheads
    z0 = B_BOARD1 + 0.0004
    cprof = [(0.0, z0), (0.0, z0 + 0.030), (0.0015, z0 + 0.037), (0.005, z0 + 0.044), (0.011, z0 + 0.050),
             (0.020, z0 + 0.0545), (0.034, z0 + 0.058), (0.060, z0 + 0.0612), (0.110, z0 + 0.0640),
             (0.170, z0 + 0.0662), (0.222, z0 + 0.0672)]
    cush = _slab("bn_cushion", _rect(B_CUSH_HW, B_CUSH_HH), 0.04, cprof, 4, "leather_green")
    _uvb(cush, "leather_green", "x")
    parts.append(cush)
    ring = _rpoly(_rect(B_CUSH_HW, B_CUSH_HH), 0.04, -0.0008, 4)
    zp = z0 + 0.031
    circ = [(0.0042 * math.cos(a), 0.0042 * math.sin(a)) for a in (math.tau * k / 8 for k in range(8))]
    parts.append(_sweep("bn_piping", circ, [(p.x, p.y, zp) for p in reversed(ring)], "leather_green", closed=True, grain="x"))
    # nails along the band, evenly spaced along the perimeter
    pts = [Vector((p.x, p.y)) for p in _rpoly(_rect(B_CUSH_HW, B_CUSH_HH), 0.04, 0.0, 8)]
    per_len = sum((pts[(i + 1) % len(pts)] - pts[i]).length for i in range(len(pts)))
    nn = int(per_len / 0.07)
    nail = _nail(seg=6)
    seglens = [(pts[(i + 1) % len(pts)] - pts[i]).length for i in range(len(pts))]
    for k in range(nn):
        s = per_len * k / nn
        i = 0
        while s > seglens[i]:
            s -= seglens[i]
            i += 1
        a, b = pts[i], pts[(i + 1) % len(pts)]
        p = a.lerp(b, s / seglens[i])
        d = (b - a).normalized()
        out = Vector((d.y, -d.x))
        nl = _copy(nail)
        _xf(nl, _T(p.x, p.y, z0 + 0.012) @ Matrix.Rotation(math.atan2(out.y, out.x), 4, "Z") @ _Ry(90))
        parts.append(nl)
    C.remove(nail)
    ob = _join(parts, "Furniture_Bench_Lobby_01")
    return ob


def _bx(name, a, b, key, bev=0.0, seg=2, grain=None):
    lo = [min(a[i], b[i]) for i in range(3)]
    hi = [max(a[i], b[i]) for i in range(3)]
    ob = C.box_minmax(name, lo, hi, _mat(key), bev, seg)
    return _uvb(ob, key, grain)


# ---------------------------------------------------------------------------
# coat_stand (with a coat and a scarf)
# ---------------------------------------------------------------------------

CS_POLE = [  # (r, z): drop finial, leg hub, shaft with rings, hook collar, finial
    (0.0, 0.300), (0.0080, 0.304), (0.0150, 0.318), (0.0190, 0.338), (0.0165, 0.356), (0.0200, 0.366), (0.0300, 0.392),
    (0.0380, 0.430), (0.0410, 0.470), (0.0400, 0.540), (0.0370, 0.585), (0.0400, 0.598), (0.0400, 0.608),
    (0.0300, 0.622), (0.0255, 0.640), (0.0240, 0.700), (0.0262, 0.712), (0.0262, 0.718), (0.0236, 0.730),
    (0.0225, 1.050), (0.0248, 1.062), (0.0248, 1.068), (0.0222, 1.080), (0.0205, 1.440), (0.0240, 1.470),
    (0.0330, 1.510), (0.0365, 1.528), (0.0365, 1.610), (0.0330, 1.628), (0.0240, 1.650), (0.0185, 1.672),
    (0.0175, 1.735), (0.0215, 1.745), (0.0215, 1.752), (0.0160, 1.760), (0.0190, 1.774), (0.0262, 1.792),
    (0.0285, 1.808), (0.0262, 1.824), (0.0190, 1.838), (0.0090, 1.847), (0.0, 1.850)]
CS_HOOK_Z = 1.548          # where the hook arms leave the collar
CS_HOOK_R = 0.0365


def _cs_leg_path():
    """Bentwood leg in the (r, z) half-plane: out of the hub, an S-curve down to a scrolled toe."""
    ctrl = [(0.030, 0.575), (0.058, 0.566), (0.095, 0.530), (0.135, 0.450), (0.166, 0.340), (0.190, 0.220),
            (0.204, 0.110), (0.210, 0.052), (0.216, 0.027), (0.226, 0.0165), (0.235, 0.021)]
    return _catmull(ctrl, 3)


def _cs_hook():
    """One brass double hook (coat hook below, hat hook above) along +X from the collar, ball ends."""
    parts = []
    low = [(CS_HOOK_R - 0.004, 0, CS_HOOK_Z), (0.060, 0, CS_HOOK_Z - 0.006), (0.095, 0, CS_HOOK_Z - 0.030),
           (0.118, 0, CS_HOOK_Z - 0.068), (0.132, 0, CS_HOOK_Z - 0.088), (0.150, 0, CS_HOOK_Z - 0.090),
           (0.163, 0, CS_HOOK_Z - 0.074), (0.168, 0, CS_HOOK_Z - 0.052)]
    pl = _catmull(low, 2)
    parts.append(_tube("cs_hook", pl, lambda t: 0.0058 - 0.0012 * t, BRASS, 6, caps=(False, False)))
    hi = [(CS_HOOK_R - 0.004, 0, CS_HOOK_Z + 0.016), (0.058, 0, CS_HOOK_Z + 0.030), (0.080, 0, CS_HOOK_Z + 0.062),
          (0.092, 0, CS_HOOK_Z + 0.098)]
    ph = _catmull(hi, 2)
    parts.append(_tube("cs_hook", ph, lambda t: 0.0052 - 0.0010 * t, BRASS, 6, caps=(False, False)))
    for end, r in ((pl[-1], 0.0085), (ph[-1], 0.0080)):
        b = C.sphere("cs_ball", r, end, _mat(BRASS), 8, 5)
        parts.append(_uvb(b, BRASS))
    # rose plate where the arms meet the collar
    rose = _turn("cs_rose", [(0.0, 0.0), (0.016, 0.0), (0.016, 0.002), (0.012, 0.004), (0.0, 0.0045)], 10, BRASS_OLD,
                 caps=(False, False))
    _xf(rose, _T(CS_HOOK_R - 0.0015, 0, CS_HOOK_Z + 0.008) @ _Ry(90))
    parts.append(rose)
    return _join(parts, "cs_hookset")


def _coat(theta):
    """A tweed overcoat hung by its loop from the coat hook at azimuth `theta`: lofted cross-sections
    (collar, slumped shoulders, body, hem flare and folds), lining inside, hanging sleeves."""
    d = Vector((math.cos(theta), math.sin(theta), 0))
    tg = Vector((-math.sin(theta), math.cos(theta), 0))
    H = d * 0.140 + Vector((0, 0, CS_HOOK_Z - 0.086))
    L = 0.82
    # s (depth below the hook), half width a (tangential), half depth b (radial), outward shift c
    S = [(0.000, 0.022, 0.016, 0.000), (0.020, 0.050, 0.034, 0.004), (0.050, 0.110, 0.055, 0.010),
         (0.095, 0.180, 0.070, 0.016), (0.150, 0.215, 0.078, 0.020), (0.240, 0.228, 0.082, 0.022),
         (0.380, 0.232, 0.085, 0.024), (0.520, 0.236, 0.088, 0.026), (0.660, 0.244, 0.092, 0.028),
         (0.780, 0.252, 0.097, 0.030), (L, 0.258, 0.100, 0.032)]
    seg = 32
    outer, inner = [], []
    for s, a, b, c in S:
        amp = 0.010 * min(1.0, max(0.0, (s - 0.12) / 0.6)) ** 1.2
        rowo, rowi = [], []
        for k in range(seg):
            th = math.tau * k / seg
            ca, sa = math.cos(th), math.sin(th)
            # back panel (outward, sa > 0) fuller; front edges tuck toward the pole (sa < 0) and flatten
            bb = b * (1.0 if sa > 0 else 0.72)
            fold = amp * (math.sin(5 * th + 0.7) + 0.5 * math.sin(9 * th + 1.9))
            px, py = a * ca, bb * sa
            nrm = Vector((ca / max(a, 1e-4), sa / max(bb, 1e-4), 0)).normalized()
            q = Vector((px, py, 0)) + nrm * fold
            # shoulders slump: the sides drop below the neck point near the top
            drop = 0.05 * (abs(ca) ** 2) * math.exp(-((s - 0.10) / 0.09) ** 2)
            w = H + tg * q.x + d * (q.y + c) + Vector((0, 0, -s - drop))
            rowo.append(w)
            qi = Vector((px, py, 0)) + nrm * (fold - 0.007)
            rowi.append(H + tg * qi.x + d * (qi.y + c) + Vector((0, 0, -s - drop + 0.002)))
        outer.append(rowo)
        inner.append(rowi)
    bm = bmesh.new()
    O = [[bm.verts.new(p) for p in r] for r in outer]
    I = [[bm.verts.new(p) for p in r] for r in inner]
    for A, B in zip(O, O[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((A[i], A[j], B[j], B[i])).material_index = 0
    for A, B in zip(I, I[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((A[j], A[i], B[i], B[j])).material_index = 1
    for i in range(seg):                         # rolled hem joining the shells
        j = (i + 1) % seg
        bm.faces.new((O[-1][i], O[-1][j], I[-1][j], I[-1][i])).material_index = 0
    bm.faces.new(list(reversed(O[0]))).material_index = 0   # collar top, closed round the loop
    bm.faces.new(I[0]).material_index = 1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # recalc can settle on the inside-out solution for this thin shell: the wool must face away from the
    # coat's hanging axis, the lining toward it
    axis = H + d * 0.02
    votes = 0
    for f in bm.faces:
        if f.material_index == 0 and len(f.verts) == 4:
            c = f.calc_center_median()
            r = Vector((c.x - axis.x, c.y - axis.y, 0))
            votes += 1 if f.normal.dot(r) > 0 else -1
    if votes < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
    body = C.mesh_from_bmesh("cs_coat", bm, [_mat("wool_grey"), _mat("lining_silk")])
    C.shade_smooth(body, 70)
    _uvb(body, "wool_grey", "z")
    parts = [body]
    # turned-down collar band
    crow = []
    for s, a, b, c in ((0.030, 0.085, 0.060, 0.010), (0.058, 0.122, 0.074, 0.014), (0.080, 0.150, 0.080, 0.016)):
        row = []
        for k in range(seg):
            th = math.tau * k / seg
            bb = b * (1.0 if math.sin(th) > 0 else 0.8)
            row.append(H + tg * (a * math.cos(th)) + d * (bb * math.sin(th) + c) + Vector((0, 0, -s)))
        crow.append(row)
    collar = _loft("cs_collar", crow, "wool_grey", True, (False, False), 70)
    _uvb(collar, "wool_grey", "x")
    parts.append(collar)
    # sleeves hanging from the slumped shoulders, a touch forward of the side seams
    for side in (-1, 1):
        top = H + tg * (side * 0.185) + d * 0.004 + Vector((0, 0, -0.165))
        bot = H + tg * (side * 0.205) + d * (-0.012) + Vector((0, 0, -0.700))
        path = [top.lerp(bot, t) + tg * (side * 0.012 * math.sin(math.pi * t)) for t in (0, 0.25, 0.5, 0.75, 1.0)]
        sl = _tube("cs_sleeve", _catmull(path, 3), lambda t: 0.056 - 0.012 * t, "wool_grey", 12, caps=(True, False))
        _uvb(sl, "wool_grey", "z")
        parts.append(sl)
        cuff = _tube("cs_cuff", [bot + Vector((0, 0, 0.03)), bot + Vector((0, 0, 0.008))], 0.039, "lining_silk", 12,
                     caps=(False, True))
        parts.append(cuff)
    return parts


def _scarf(theta):
    """A striped college scarf folded over the coat hook at azimuth `theta`, ends fringed."""
    d = Vector((math.cos(theta), math.sin(theta), 0))
    tg = Vector((-math.sin(theta), math.cos(theta), 0))
    seat = d * 0.141 + Vector((0, 0, CS_HOOK_Z - 0.0905))      # centre of the hook bar at its seat
    # centre line in (tangential, z) relative to the hook seat; the long end hangs on the -t side
    ctrl = [(-0.045, -0.78), (-0.040, -0.50), (-0.030, -0.22), (-0.018, -0.06), (-0.0118, -0.012), (-0.0076, 0.0074),
            (0.0, 0.0108), (0.0076, 0.0074), (0.0118, -0.012), (0.018, -0.06), (0.030, -0.20), (0.038, -0.42), (0.044, -0.60)]
    cl = _catmull(ctrl, 4)
    lens = [0.0]
    for a, b in zip(cl, cl[1:]):
        lens.append(lens[-1] + (b - a).length)
    total = lens[-1]
    bm = bmesh.new()
    rings = []
    th = 0.0055
    ncl = len(cl)
    for k, (p, s) in enumerate(zip(cl, lens)):
        u = s / total
        top = max(0.0, 1 - abs(u - 0.47) / 0.13)            # bunched where it hangs over the hook
        w = 0.094 - 0.058 * top                               # half width (radial), 0.188 m wide open
        ripple = 0.006 * math.sin(s * 23.0) * (1 - top)
        tan2 = (cl[min(k + 1, ncl - 1)] - cl[max(k - 1, 0)]).normalized()
        nrm = tg * (-tan2.y) + Vector((0, 0, tan2.x))           # path normal in the (t, z) plane
        c = seat + tg * p.x + Vector((0, 0, p.y))
        ring = []
        for (rr, tt) in ((-w, -th), (w, -th), (w, th), (-w, th)):
            ring.append(c + d * (rr + 0.012 * math.sin(s * 7.0) * (1 - top)) + nrm * (tt + ripple * (1 if rr > 0 else -1)))
        rings.append(ring)
    V = [[bm.verts.new(p) for p in r] for r in rings]
    stripes = (0.0, 0.11, 0.135, 0.17, 0.195)       # stripe band edges from each end (m)
    for k, (A, B) in enumerate(zip(V, V[1:])):
        sm = (lens[k] + lens[k + 1]) / 2
        e = min(sm, total - sm)
        gold = any(stripes[i] <= e < stripes[i + 1] for i in (1, 3))
        for i in range(4):
            j = (i + 1) % 4
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            f.material_index = 1 if gold else 0
    for ring in (V[0], V[-1]):
        try:
            bm.faces.new(ring)
        except ValueError:
            pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh("cs_scarf", bm, [_mat("wool_burgundy"), _mat("wool_gold")])
    C.shade_smooth(ob, 50)
    _uvb(ob, "wool_burgundy", "z")
    parts = [ob]
    # fringe: tufts along both ends
    for ring, sgn in ((rings[0], -1), (rings[-1], -1)):
        a, b = (ring[0] + ring[3]) / 2, (ring[1] + ring[2]) / 2
        for k in range(9):
            p = a.lerp(b, (k + 0.5) / 9)
            tuft = _tube("cs_fringe", [p + Vector((0, 0, 0.002)), p + Vector((0.002 * math.sin(k), 0.002 * math.cos(k), -0.045))],
                         0.0035, "wool_burgundy", 5, caps=(False, True))
            parts.append(tuft)
    return parts


def build_coat_stand(item=None):
    """Bentwood coat stand (0.5 m across, 1.85 m) with a coat and a scarf on the local +Y side."""
    parts = []
    pole = _turn("cs_pole", CS_POLE, 16, WOOD, fillet=0.0015)
    parts.append(pole)
    path = _cs_leg_path()
    ring_z = 0.300
    ring_r = None
    for a, b in zip(path, path[1:]):
        if a.y >= ring_z >= b.y:
            ring_r = a.x + (b.x - a.x) * (ring_z - a.y) / (b.y - a.y)
    for k in range(4):
        ang = math.radians(45 + 90 * k)
        c, s = math.cos(ang), math.sin(ang)
        p3 = [(p.x * c, p.x * s, p.y) for p in path]
        leg = _tube("cs_leg", p3, lambda t: 0.0165 - 0.004 * t, WOOD, 8, caps=(False, True))
        _uvb(leg, WOOD, "z")
        parts.append(leg)
        foot = C.sphere("cs_glide", 0.011, (0.223 * c, 0.223 * s, 0.006), _mat("plastic_dark"), 8, 5, scale=(1, 1, 0.55))
        parts.append(foot)
    ring = C.torus("cs_ring", ring_r, 0.0075, (0, 0, ring_z), _mat(WOOD), 40, 6)
    parts.append(_uvb(ring, WOOD, "x"))
    hook = _cs_hook()
    for k in range(6):
        h = _copy(hook)
        _xf(h, _Rz(30 + 60 * k))
        parts.append(h)
    C.remove(hook)
    parts += _coat(math.radians(90))
    parts += _scarf(math.radians(330))
    ob = _join(parts, "Furniture_CoatStand_01")
    return ob


# ---------------------------------------------------------------------------
# umbrella_stand (with two umbrellas)
# ---------------------------------------------------------------------------

US_PROFILE = [  # spun brass body (outer), bottom to top
    (0.150, 0.000), (0.152, 0.004), (0.150, 0.010), (0.142, 0.016), (0.140, 0.022), (0.134, 0.030),
    (0.132, 0.042), (0.135, 0.048), (0.136, 0.053), (0.133, 0.059), (0.131, 0.090), (0.134, 0.096),
    (0.134, 0.101), (0.130, 0.107), (0.128, 0.200), (0.127, 0.300), (0.128, 0.420), (0.130, 0.490),
    (0.133, 0.497), (0.133, 0.502), (0.130, 0.508), (0.132, 0.535), (0.136, 0.541), (0.136, 0.546),
    (0.133, 0.552), (0.134, 0.575), (0.140, 0.584), (0.144, 0.592), (0.142, 0.598), (0.136, 0.600),
    (0.128, 0.597), (0.124, 0.588), (0.124, 0.575)]
US_SCALE = 1.15            # the profile is drawn for a 0.30 m stand; the plan footprint is 0.36 m


def _umbrella(length, color, crook=True, seed=0):
    """Closed umbrella along +Z from its tip at the origin: brass ferrule, furled fluted canopy with a strap,
    shaft, and a crook (walnut) or straight leather-wrapped handle."""
    parts = []
    parts.append(_turn("um_ferrule", [(0.0, 0.0), (0.0035, 0.002), (0.0045, 0.012), (0.0052, 0.045), (0.0065, 0.050)],
                       10, BRASS_OLD, caps=(False, True)))
    z0, z1 = 0.048, length * 0.74
    rings = []
    nseg = 32
    for k in range(15):
        t = k / 14
        z = z0 + (z1 - z0) * t
        r = 0.010 + 0.030 * math.sin(math.pi * min(1.0, t * 1.15)) ** 0.8 * (1 - 0.35 * t)
        if t > 0.92:
            r = max(0.007, r * (1 - (t - 0.92) / 0.08 * 0.6))
        ring = []
        for i in range(nseg):
            a = math.tau * i / nseg + 0.35 * t
            flute = 1 + 0.16 * (abs(math.cos(4 * a)) ** 3) - 0.05
            ring.append((r * flute * math.cos(a), r * flute * math.sin(a), z))
        rings.append(ring)
    can = _loft("um_canopy", rings, color, True, (True, True), 45)
    _uvb(can, color, "z")
    parts.append(can)
    zs = z0 + (z1 - z0) * 0.52
    rs = 0.010 + 0.030 * math.sin(math.pi * min(1.0, 0.52 * 1.15)) ** 0.8 * (1 - 0.35 * 0.52)
    strap = C.torus("um_strap", rs * 1.12 + 0.002, 0.0035, (0, 0, 0), _mat(color), 32, 6)
    _xf(strap, _T(0, 0, zs) @ Matrix.Diagonal((1.0, 1.0, 2.2, 1.0)))   # flattened band round the furled canopy
    parts.append(_uvb(strap, color, "x"))
    parts.append(_xf(C.sphere("um_snap", 0.0045, (rs * 1.12 + 0.006, 0, zs), _mat(BRASS), 8, 6), Matrix.Identity(4)))
    parts.append(_turn("um_shaft", [(0.0062, z1 - 0.01), (0.0058, z1 + 0.01), (0.0050, length - 0.12), (0.0068, length - 0.11)],
                       10, "chrome", caps=(False, True)))
    hz = length - 0.11
    if crook:
        parts.append(_turn("um_collar", [(0.0068, hz), (0.0098, hz + 0.004), (0.0098, hz + 0.016), (0.0080, hz + 0.02)],
                           14, BRASS, caps=(False, True)))
        arc = [(0.0, 0.0, hz + 0.018), (0.0, 0.0, hz + 0.075)]
        for k in range(1, 12):
            a = math.pi * k / 11
            arc.append((0.036 - 0.036 * math.cos(a), 0.0, hz + 0.075 + 0.036 * math.sin(a)))
        arc.append((0.074, 0.0, hz + 0.062))
        handle = _tube("um_crook", _catmull(arc, 2), lambda t: 0.0105 - 0.0015 * t, WOOD, 12, caps=(False, True))
        _uvb(handle, WOOD, "z")
        parts.append(handle)
    else:
        parts.append(_turn("um_grip", [(0.0068, hz), (0.011, hz + 0.006), (0.0125, hz + 0.03), (0.0130, hz + 0.09),
                                        (0.0118, hz + 0.105), (0.0, hz + 0.112)], 14, "leather_brown", caps=(False, False)))
    return parts


def build_umbrella_stand(item=None):
    """Spun brass umbrella stand (0.36 m across with its ring handles, 0.6 m) holding two umbrellas."""
    parts = []
    body = _turn("us_body", [(r * US_SCALE, z) for r, z in US_PROFILE], 48, BRASS_OLD, caps=(True, False))
    parts.append(body)
    inner = _turn("us_inner", [(0.124 * US_SCALE, 0.575), (0.1235 * US_SCALE, 0.40), (0.1235 * US_SCALE, 0.05), (0.0, 0.045)],
                  40, "bronze_patina", caps=(False, False))
    parts.append(inner)
    for sx in (-1, 1):
        boss = _turn("us_boss", [(0.0, 0.0), (0.024, 0.0), (0.024, 0.003), (0.020, 0.008), (0.014, 0.012), (0.010, 0.018),
                                 (0.006, 0.021), (0.0, 0.022)], 18, BRASS, caps=(False, False))
        _xf(boss, _T(sx * 0.1478, 0, 0.462) @ _Ry(90 * sx))
        parts.append(boss)
        ring = C.torus("us_ring", 0.030, 0.0046, (0, 0, 0), _mat(BRASS), 28, 8)
        _xf(ring, _T(sx * 0.1665, 0, 0.440) @ _Ry(90))
        parts.append(_uvb(ring, BRASS))
    # umbrellas, tips in the bottom pan, leaning on the rim
    for length, color, crook, tip, lean, az in ((0.93, "canopy_black", True, (0.05, 0.03), 9.5, 180),
                                                (0.86, "fabric_green", False, (-0.04, -0.05), 7.0, -60)):
        ps = _umbrella(length, color, crook)
        M = _T(tip[0], tip[1], 0.047) @ _Rz(az) @ _Ry(lean)
        for p in ps:
            _xf(p, M)
        parts += ps
    return _join(parts, "Prop_UmbrellaStand_01")


# ---------------------------------------------------------------------------
# bins_pair
# ---------------------------------------------------------------------------

BIN_X = 0.2
BIN_BODY = [  # powder-coated steel body, bottom to top (outer)
    (0.172, 0.034), (0.172, 0.046), (0.168, 0.052), (0.166, 0.062), (0.168, 0.300), (0.172, 0.620), (0.173, 0.640)]
BIN_PLAQUE_Z = 0.400


def _bin_labels():
    img = bpy.data.images.get("TX_Lobby_BinLabels")
    if img is not None:
        return img
    cv = Canvas("binlabels", 0.40, 0.14, 2600, bg="#efe8d8")
    green, ink = "#1f4a32", "#1d2a22"
    for i, (word, icon) in enumerate((("RECYCLING", "recycle"), ("WASTE", "waste"))):
        x0 = i * 0.20
        cv.rect(x0, 0, x0 + 0.20, 0.14, "#efe8d8", 1)
        cv.outline_rect(x0 + 0.006, 0.006, x0 + 0.194, 0.134, 0.0025, green, 2)
        cv.text(word, x0 + 0.10, 0.026, 0.0165, ink, "gill", bold=0.06, spacing=1.12)
        cx, cy = x0 + 0.10, 0.085
        if icon == "recycle":
            # three chasing arrows round a triangle
            R0 = 0.032
            for k in range(3):
                a0 = math.radians(90 + 120 * k + 18)
                a1 = math.radians(90 + 120 * (k + 1) - 22)
                pts = [(cx + R0 * math.cos(a0 + (a1 - a0) * t / 8), cy + R0 * math.sin(a0 + (a1 - a0) * t / 8)) for t in range(9)]
                cv.polyline(pts, 0.0085, green, 3)
                tip = Vector((cx + R0 * math.cos(a1 + 0.22), cy + R0 * math.sin(a1 + 0.22)))
                tang = Vector((-math.sin(a1), math.cos(a1)))
                rad = Vector((math.cos(a1), math.sin(a1)))
                base = Vector(pts[-1])
                cv.poly([tip, base + rad * 0.0105, base - rad * 0.0105], green, 3)
        else:
            # a figure dropping litter into a bin
            cv.poly([(cx + 0.006, cy - 0.032), (cx + 0.036, cy - 0.032), (cx + 0.040, cy + 0.004), (cx + 0.002, cy + 0.004)], green, 3)
            cv.rect(cx - 0.001, cy + 0.004, cx + 0.043, cy + 0.010, green, 3)
            cv.circle((cx - 0.030, cy + 0.030), 0.0075, green, 3)
            cv.poly([(cx - 0.037, cy + 0.020), (cx - 0.023, cy + 0.020), (cx - 0.020, cy - 0.006), (cx - 0.034, cy - 0.006)], green, 3)
            cv.line((cx - 0.034, cy - 0.006), (cx - 0.040, cy - 0.034), 0.0058, green, 3)
            cv.line((cx - 0.022, cy - 0.006), (cx - 0.018, cy - 0.034), 0.0058, green, 3)
            cv.line((cx - 0.023, cy + 0.016), (cx - 0.004, cy + 0.020), 0.0050, green, 3)
            cv.rect(cx + 0.008, cy + 0.017, cx + 0.016, cy + 0.025, green, 3)
    return cv.bake("TX_Lobby_BinLabels")


def _bin_r(z):
    """Outer radius of the tapered bin body at height z."""
    for (r0, z0), (r1, z1) in zip(BIN_BODY, BIN_BODY[1:]):
        if z0 <= z <= z1:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return BIN_BODY[-1][0]


def _bin_plaque(cx, u0, u1):
    """Curved enamel plaque on the bin's front (-Y), mapped to u0..u1 of the label image, with a brass bezel.
    It follows the body's taper (a constant radius let the body poke through the plaque's top edge)."""
    r = 0.1685
    half = 0.098 / r                     # angular half width (0.196 m of arc)
    zb, zt = BIN_PLAQUE_Z - 0.0686, BIN_PLAQUE_Z + 0.0686
    nx = 16
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rows = []
    for z in (zb, zt):
        row = []
        for i in range(nx + 1):
            a = -math.pi / 2 - half + 2 * half * i / nx
            rz = _bin_r(z) + 0.0016
            row.append(bm.verts.new((cx + rz * math.cos(a), rz * math.sin(a), z)))
        rows.append(row)
    for i in range(nx):
        f = bm.faces.new((rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]))
        for lo in f.loops:
            ii = rows[0].index(lo.vert) if lo.vert in rows[0] else rows[1].index(lo.vert)
            jj = 0 if lo.vert in rows[0] else 1
            lo[uvl].uv = (u0 + (u1 - u0) * ii / nx, 0.01 + 0.98 * jj)
    ob = _finish(bm, "bin_plaque", "print_bins", 40, recalc=False)
    # bezel: a half-round brass bead round the plaque, following the curve
    path = []
    def at(a, z):
        rr = _bin_r(z) + 0.0004
        return (cx + rr * math.cos(a), rr * math.sin(a), z)
    for i in range(nx + 1):
        path.append(at(-math.pi / 2 - half + 2 * half * i / nx, zb))
    for z in (zb + 0.03, zt - 0.03):
        path.append(at(-math.pi / 2 + half, z))
    for i in range(nx, -1, -1):
        path.append(at(-math.pi / 2 - half + 2 * half * i / nx, zt))
    for z in (zt - 0.03, zb + 0.03):
        path.append(at(-math.pi / 2 - half, z))
    # sweep in the local frame of the cylinder: build per-point frames manually
    bmz = bmesh.new()
    prof = [(math.cos(t) * 0.0032, math.sin(t) * 0.0032) for t in (math.pi * k / 6 for k in range(7))]
    rings = []
    n = len(path)
    for i in range(n):
        p = Vector(path[i])
        nxt, prv = Vector(path[(i + 1) % n]), Vector(path[i - 1])
        tng = (nxt - prv).normalized()
        out = Vector((p.x - cx, p.y, 0)).normalized()
        side = tng.cross(out).normalized()
        rings.append([bmz.verts.new(p + side * u + out * (v - 0.0005)) for u, v in prof])
    for i in range(n):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(len(prof) - 1):
            bmz.faces.new((A[j], B[j], B[j + 1], A[j + 1]))
    bez = _finish(bmz, "bin_bezel", BRASS, 50)
    _uvb(bez, BRASS)
    return [ob, bez]


def build_bins_pair(item=None):
    """Two powder-coated bins (recycling, waste) with brass bands, hooded dome lids and enamel plaques."""
    img = _bin_labels()
    _attach_image("print_bins", img)
    parts = []
    for i, sx in enumerate((-1, 1)):
        x = sx * BIN_X
        body = _turn("bin_body", BIN_BODY, 48, "powdercoat_green", caps=(False, False))
        _xf(body, _T(x, 0, 0))
        parts.append(body)
        foot = _turn("bin_foot", [(0.0, 0.0), (0.184, 0.0), (0.188, 0.004), (0.188, 0.020), (0.184, 0.026), (0.176, 0.030),
                                  (0.172, 0.036)], 48, BRASS_OLD, caps=(False, False))
        _xf(foot, _T(x, 0, 0))
        parts.append(foot)
        for zb in (0.110, 0.600):
            band = _turn("bin_band", [(0.168 if zb < 0.3 else 0.1715, zb - 0.010), (0.1735 if zb < 0.3 else 0.1775, zb - 0.007),
                                      (0.1755 if zb < 0.3 else 0.1795, zb), (0.1735 if zb < 0.3 else 0.1775, zb + 0.007),
                                      (0.168 if zb < 0.3 else 0.1715, zb + 0.010)], 48, BRASS, caps=(False, False))
            _xf(band, _T(x, 0, 0))
            parts.append(band)
        rim = _turn("bin_rim", [(0.173, 0.638), (0.180, 0.642), (0.183, 0.652), (0.180, 0.662), (0.170, 0.666),
                                (0.162, 0.664), (0.160, 0.650)], 48, BRASS, caps=(False, False))
        _xf(rim, _T(x, 0, 0))
        parts.append(rim)
        liner = _turn("bin_liner", [(0.160, 0.650), (0.158, 0.645), (0.0, 0.640)], 32, "plastic_dark", caps=(False, False))
        _xf(liner, _T(x, 0, 0))
        parts.append(liner)
        # hooded dome lid on four brass posts (the gap all round is the opening)
        lid = _turn("bin_lid", [(0.150, 0.722), (0.176, 0.724), (0.186, 0.730), (0.188, 0.738), (0.184, 0.746),
                                (0.172, 0.758), (0.150, 0.776), (0.120, 0.796), (0.085, 0.812), (0.048, 0.823),
                                (0.030, 0.826), (0.026, 0.830), (0.030, 0.836), (0.031, 0.842), (0.022, 0.848),
                                (0.010, 0.850), (0.0, 0.8505)], 48, BRASS, caps=(False, False))
        _xf(lid, _T(x, 0, 0))
        parts.append(lid)
        under = _turn("bin_lid_under", [(0.0, 0.738), (0.150, 0.722)], 32, "powdercoat_green", caps=(False, False))
        _xf(under, _T(x, 0, 0))
        parts.append(under)
        for k in range(4):
            a = math.radians(45 + 90 * k)
            post = _turn("bin_post", [(0.0065, 0.664), (0.0045, 0.672), (0.0042, 0.712), (0.0065, 0.724)], 10, BRASS, caps=(False, False))
            _xf(post, _T(x + 0.168 * math.cos(a), 0.168 * math.sin(a), 0))
            parts.append(post)
        parts += _bin_plaque(x, i * 0.5, i * 0.5 + 0.5)
    return _join(parts, "Prop_Bins_Pair_01")


# ---------------------------------------------------------------------------
# Shared helpers for the panelled pieces (desk, directory, noticeboard)
# ---------------------------------------------------------------------------

LM.PALETTE.setdefault("print_keyboard", dict(base="#232326", rough=0.5))


def _uv_along(ob, key):
    """Real-scale UVs with the grain along each face's run: horizontal on vertical faces, along the longest
    edge on flat ones, so mouldings swept along a path keep their grain along the path."""
    size = tex_size(key)
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        n = poly.normal
        if abs(n.z) < 0.9:
            t = Vector((-n.y, n.x, 0.0))
        else:
            vs = poly.vertices
            t = Vector((0.0, 0.0, 0.0))
            for k in range(len(vs)):
                a, b = me.vertices[vs[k]].co, me.vertices[vs[(k + 1) % len(vs)]].co
                e = Vector((b.x - a.x, b.y - a.y, 0.0))
                if e.length > t.length:
                    t = e
        t = t.normalized() if t.length > 1e-9 else Vector((1.0, 0.0, 0.0))
        b = n.cross(t)
        b = b.normalized() if b.length > 1e-9 else Vector((0.0, 0.0, 1.0))
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (co.dot(t) / size, co.dot(b) / size)
    return ob


def _msweep(name, profile, path, key, closed_path=False, up=(0, 0, 1), smooth=35.0):
    """Sweeps a CLOSED profile polygon [(u, v)] (u to the path's right, v along `up`) along a polyline with
    mitred joints. The result is watertight (capped when the path is open), so its normals face out."""
    pts = [Vector((p[0], p[1], p[2] if len(p) > 2 else 0.0)) for p in path]
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
        side0 = upv.cross(d0).normalized()
        side = upv.cross(t).normalized()
        mit = 1.0 / max(0.2, side.dot(side0))
        vert = t.cross(side).normalized()
        rings.append([bm.verts.new(pts[i] - side * (u * mit) + vert * v) for u, v in profile])
    m = len(profile)
    for k in range(n if closed_path else n - 1):
        A, B = rings[k], rings[(k + 1) % n]
        for j in range(m):
            jj = (j + 1) % m
            bm.faces.new((A[j], B[j], B[jj], A[jj]))
    if not closed_path:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    ob = _finish(bm, name, key, smooth)
    return _uv_along(ob, key)


def _rect_path(hw, hh, cx=0.0, cz=0.0, y=0.0):
    """A rectangle in the XZ plane (CCW seen from -Y) for _msweep(..., up=(0, -1, 0)): u points out of the
    rectangle, v toward the viewer (-Y)."""
    return [(cx - hw, y, cz - hh), (cx + hw, y, cz - hh), (cx + hw, y, cz + hh), (cx - hw, y, cz + hh)]


def _skin(name, pts, z0, z1, key, right=True):
    """A vertical surface along a plan polyline; its face points to the path's right (or left)."""
    bm = bmesh.new()
    lo = [bm.verts.new((p[0], p[1], z0)) for p in pts]
    hi = [bm.verts.new((p[0], p[1], z1)) for p in pts]
    for i in range(len(pts) - 1):
        q = (lo[i], lo[i + 1], hi[i + 1], hi[i])
        bm.faces.new(q if right else tuple(reversed(q)))
    ob = _finish(bm, name, key, 5.0, recalc=False)
    return _uv_along(ob, key)


def _prism_xy(name, section, z0, z1, key, smooth=30.0):
    """Extrudes a closed (x, y) section from z0 to z1, capped."""
    bm = bmesh.new()
    lo = [bm.verts.new((x, y, z0)) for x, y in section]
    hi = [bm.verts.new((x, y, z1)) for x, y in section]
    n = len(section)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(list(reversed(lo)))
    bm.faces.new(hi)
    return _finish(bm, name, key, smooth)


def _fluted_section(hw, depth, flutes, r, pitch, back=0.003, seg=6):
    """Pilaster section in (x, y): flat sides, a front face at y = -depth cut by `flutes` round flutes."""
    pts = [(-hw, back), (-hw, -depth + 0.002), (-hw + 0.002, -depth)]
    for k in range(flutes):
        cx = (k - (flutes - 1) / 2) * pitch
        for s in range(seg + 1):
            a = math.pi * s / seg
            pts.append((cx - r * math.cos(a), -depth + 0.85 * r * math.sin(a)))
    pts += [(hw - 0.002, -depth), (hw, -depth + 0.002), (hw, back)]
    return pts


def _book(w, d, t, cover, seed=0):
    """A hardback lying flat (x = width, y = depth along the spine side -X), floor at z = 0."""
    parts = []
    bt = 0.0025
    parts.append(_bx("bk_board", (-w / 2, -d / 2, 0.0), (w / 2, d / 2, bt), cover, 0.0008, 1, "y"))
    parts.append(_bx("bk_board", (-w / 2, -d / 2, t - bt), (w / 2, d / 2, t), cover, 0.0008, 1, "y"))
    parts.append(_bx("bk_spine", (-w / 2, -d / 2, bt - 0.0002), (-w / 2 + 0.006, d / 2, t - bt + 0.0002), cover, 0.0015, 2, "y"))
    parts.append(_bx("bk_pages", (-w / 2 + 0.004, -d / 2 + 0.003, bt), (w / 2 - 0.003, d / 2 - 0.003, t - bt), "book_pages", 0.0, 1, "y"))
    return _join(parts, "bk_book")


def _pin(key):
    """Push pin head (needle hidden in the cork) along +Z from z = 0."""
    return _turn("pin", [(0.0042, 0.0), (0.0046, 0.0018), (0.0030, 0.0040), (0.0025, 0.0070), (0.0047, 0.0088),
                         (0.0052, 0.0115), (0.0042, 0.0142), (0.0024, 0.0154), (0.0, 0.0157)], 12, key, caps=(True, False))


# ---------------------------------------------------------------------------
# desk_info: the information desk
# ---------------------------------------------------------------------------

D_PATH = [(-1.495, 0.50), (-1.495, -0.29), (-0.76, -0.46), (0.76, -0.46), (1.495, -0.29), (1.495, 0.50)]
D_COL_PUSH = 0.02                   # corner columns stand 3/4 proud of the skin
D_PED = 0.058                       # half width of their pedestals
D_CARC = 0.34                       # carcass depth (outer skin to staff-side skin)
D_FR = 0.018                        # frame and frieze stand proud of the panel field
DZ_PL, DZ_R0, DZ_R1, DZ_AR = 0.13, 0.22, 0.74, 0.82
DZ_FR0, DZ_FR1, DZ_L0, DZ_L1 = 0.85, 0.965, 1.03, 1.08
DZ_WORK = 0.76

D_PLINTH = [(-0.005, 0.0), (0.040, 0.0), (0.040, 0.012), (0.035, 0.016), (0.032, 0.020), (0.032, 0.096), (0.034, 0.099),
            (0.034, 0.105), (0.031, 0.110), (0.028, 0.115), (0.025, 0.120), (0.022, 0.125), (0.020, DZ_PL), (-0.005, DZ_PL)]
D_RAIL_LO = [(-0.005, DZ_PL), (D_FR, DZ_PL), (D_FR, DZ_R0 - 0.004), (D_FR - 0.004, DZ_R0), (-0.005, DZ_R0)]
D_RAIL_HI = [(-0.005, DZ_R1), (D_FR - 0.004, DZ_R1), (D_FR, DZ_R1 + 0.004), (D_FR, DZ_AR), (-0.005, DZ_AR)]
D_ARCHITRAVE = [(-0.005, DZ_AR), (0.026, DZ_AR), (0.026, 0.826), (0.029, 0.829), (0.031, 0.834), (0.031, 0.838),
                (0.029, 0.843), (0.025, 0.847), (0.020, DZ_FR0), (-0.005, DZ_FR0)]
D_FRIEZE = [(-0.005, DZ_FR0), (D_FR, DZ_FR0), (D_FR, DZ_FR1), (-0.005, DZ_FR1)]
D_CORNICE = [(-0.005, DZ_FR1), (0.022, DZ_FR1), (0.022, 0.970), (0.0226, 0.976), (0.0249, 0.981), (0.0286, 0.986),
             (0.0336, 0.989), (0.042, 0.990), (0.044, 0.990), (0.044, 0.994), (0.0495, 0.9947), (0.054, 0.997),
             (0.0569, 1.001), (0.058, 1.008), (0.058, 1.026), (0.056, DZ_L0), (-0.005, DZ_L0)]
D_COLUMN = [(0.050, 0.130), (0.050, 0.138), (0.047, 0.141), (0.048, 0.146), (0.047, 0.152), (0.043, 0.156),
            (0.039, 0.159), (0.038, 0.163), (0.040, 0.167), (0.041, 0.171), (0.039, 0.175), (0.035, 0.178),
            (0.034, 0.190), (0.0335, 0.40), (0.0325, 0.60), (0.031, 0.725), (0.0335, 0.728), (0.0335, 0.735),
            (0.031, 0.738), (0.030, 0.760), (0.032, 0.764), (0.037, 0.771), (0.042, 0.779), (0.045, 0.789),
            (0.046, 0.800)]
D_BOLECTION = [(-0.010, -0.002), (-0.010, 0.005), (-0.006, 0.010), (-0.002, 0.015), (0.003, 0.021), (0.008, 0.0245),
               (0.013, 0.024), (0.016, 0.021), (0.017, 0.018), (0.017, -0.002)]


def _desk_openings(i, L):
    h = L / 2
    if i == 0:
        return [(-h + 0.07, h - 0.075)]
    if i == 4:
        return [(-h + 0.075, h - 0.07)]
    if i in (1, 3):
        return [(-h + 0.075, h - 0.075)]
    return [(-h + 0.075, -0.31), (-0.19, 0.19), (0.31, h - 0.075)]


def _corner_frame(i, push=D_COL_PUSH):
    """Frame at path corner i: origin `push` out from the skin corner along the outward bisector (local -Y)."""
    P0, P1, P2 = (Vector(D_PATH[k]) for k in (i - 1, i, i + 1))
    e1, e2 = (P1 - P0).normalized(), (P2 - P1).normalized()
    n1, n2 = Vector((e1.y, -e1.x)), Vector((e2.y, -e2.x))
    b = (n1 + n2).normalized()
    c = P1 + b * push
    return _T(c.x, c.y, 0) @ _Rz(math.degrees(math.atan2(b.y, b.x)) + 90)


def _screen_image():
    name = "TX_Lobby_Screen"
    img = bpy.data.images.get(name)
    if img is not None:
        return img
    W, H = 0.531, 0.306
    cv = Canvas("screen", W, H, 1700, bg="#f5f2ec")
    green, ink, mute = "#1f3a2c", "#24211e", "#6f6a62"
    cv.rect(0, H - 0.032, W, H, green, 2)
    cv.text("Library Catalogue", 0.016, H - 0.016, 0.0095, "#f1e6c8", "georgia", align="LEFT")
    cv.text("Information Desk  ·  Staff", W - 0.016, H - 0.016, 0.0052, "#cfe0d4", "gill", align="RIGHT")
    cv.rect(0.016, H - 0.064, W - 0.118, H - 0.044, "#ffffff", 2)
    cv.outline_rect(0.016, H - 0.064, W - 0.118, H - 0.044, 0.0008, "#9a958c", 3)
    cv.text("medieval manuscripts", 0.022, H - 0.054, 0.0058, ink, "gill", align="LEFT")
    cv.rect(W - 0.108, H - 0.064, W - 0.016, H - 0.044, "#2f6b4a", 2)
    cv.text("Search", W - 0.062, H - 0.054, 0.0058, "#ffffff", "gill")
    cv.rect(0.016, 0.014, 0.112, H - 0.076, "#ece6da", 2)
    for k, t in enumerate(("Refine", "Books (214)", "Manuscripts (38)", "Maps (12)", "Online (61)", "On shelf now",
                           "Grand Reading Hall", "Reference Rotunda")):
        cv.text(t, 0.022, H - 0.092 - k * 0.022, 0.0058 if k else 0.0068, ink if k == 0 else mute, "gill", align="LEFT")
    rows = (("The Making of Medieval Manuscripts", "Hamel, C. de  ·  1992", "Z105 .H36", "On shelf  ·  Hall bay 12"),
            ("Illuminated Manuscripts", "Backhouse, J.  ·  1979", "ND2900 .B33", "On loan  ·  due 2 Dec"),
            ("The Book of Kells", "Meehan, B.  ·  1994", "ND3359 .K4", "Reference Rotunda"),
            ("Medieval Libraries of Great Britain", "Ker, N. R.  ·  1964", "Z791 .K4", "On shelf  ·  Gallery W"),
            ("Scribes and Scholars", "Reynolds & Wilson  ·  1991", "PA47 .R4", "On shelf  ·  Hall bay 3"))
    for k, (t, a, c, s) in enumerate(rows):
        y = H - 0.088 - k * 0.043
        if k % 2 == 0:
            cv.rect(0.122, y - 0.036, W - 0.016, y + 0.006, "#ffffff", 2)
        cv.rect(0.128, y - 0.030, 0.146, y + 0.0, ["#7a2a22", "#2f4a3a", "#3b4f7a", "#8a6a2f", "#5b2a4a"][k], 3)
        cv.text(t, 0.154, y - 0.004, 0.0062, "#1f3a5c", "georgia", align="LEFT", maxw=0.24)
        cv.text(a, 0.154, y - 0.016, 0.0050, mute, "gill", align="LEFT")
        cv.text(c, 0.154, y - 0.027, 0.0050, ink, "gill", align="LEFT")
        cv.text(s, W - 0.022, y - 0.010, 0.0052, "#2f6b4a" if "shelf" in s else "#8a4a1f", "gill", align="RIGHT")
    return cv.bake(name)


def _keyboard_image():
    name = "TX_Lobby_Keys"
    img = bpy.data.images.get(name)
    if img is not None:
        return img
    W, H = 0.41, 0.118
    cv = Canvas("keys", W, H, 1300, bg="#1e1e21")
    rows = [(0.0105, [1.0] * 13), (0.0175, [1.0] * 13 + [2.0]), (0.0175, [1.5] + [1.0] * 12 + [1.5]),
            (0.0175, [1.8] + [1.0] * 11 + [2.2]), (0.0175, [2.3] + [1.0] * 10 + [2.7]), (0.0175, [1.3] * 3 + [6.4] + [1.3] * 3)]
    y = H - 0.004
    for hgt, keys in rows:
        unit = (W - 0.008) / sum(keys)
        x = 0.004
        for k in keys:
            cv.rect(x + 0.0008, y - hgt + 0.0012, x + k * unit - 0.0008, y - 0.0004, "#3a3a3f", 2)
            cv.rect(x + 0.0018, y - hgt + 0.0026, x + k * unit - 0.0018, y - 0.0014, "#434349", 3)
            x += k * unit
        y -= hgt + 0.0015
    return cv.bake(name)


def _leaflet_image():
    name = "TX_Lobby_Leaflets"
    img = bpy.data.images.get(name)
    if img is not None:
        return img
    cv = Canvas("leaflets", 0.27, 0.18, 2600, bg="#efe6d2")
    # 1: visitor guide (green, gilt crest)
    cv.rect(0.0, 0.0, 0.09, 0.18, "#1f3a2c", 1)
    cv.outline_rect(0.005, 0.005, 0.085, 0.175, 0.0008, "#c99b47", 2)
    cv.circle((0.045, 0.118), 0.016, "#c99b47", 2, 40)
    cv.circle((0.045, 0.118), 0.0135, "#1f3a2c", 3, 40)
    cv.rect(0.037, 0.110, 0.053, 0.126, "#c99b47", 4)
    cv.rect(0.0445, 0.110, 0.0455, 0.126, "#1f3a2c", 5)
    cv.text("WELCOME", 0.045, 0.078, 0.0062, "#f1e6c8", "bask", spacing=1.1)
    cv.text("to the Library", 0.045, 0.066, 0.0045, "#f1e6c8", "georgia_i")
    cv.text("Visitor Guide", 0.045, 0.030, 0.0042, "#c99b47", "gill")
    # 2: borrowing and returns (cream)
    cv.rect(0.09, 0.0, 0.18, 0.18, "#f3ecdc", 1)
    cv.rect(0.09, 0.145, 0.18, 0.18, "#7a2a22", 2)
    cv.text("BORROWING", 0.135, 0.166, 0.0052, "#f3ecdc", "gill", spacing=1.1)
    cv.text("& RETURNS", 0.135, 0.154, 0.0052, "#f3ecdc", "gill", spacing=1.1)
    cv.poly([(0.108, 0.085), (0.135, 0.078), (0.135, 0.125), (0.108, 0.132)], "#2f4a3a", 2)
    cv.poly([(0.135, 0.078), (0.162, 0.085), (0.162, 0.132), (0.135, 0.125)], "#3c5f4a", 2)
    for k in range(4):
        cv.line((0.112, 0.118 - k * 0.008), (0.131, 0.113 - k * 0.008), 0.0008, "#e6dcc4", 3)
        cv.line((0.139, 0.113 - k * 0.008), (0.158, 0.118 - k * 0.008), 0.0008, "#e6dcc4", 3)
    cv.text("Loans  ·  Renewals\nHolds  ·  Fines", 0.135, 0.050, 0.0036, "#3a332c", "gill", line=1.5)
    # 3: events this term (burgundy)
    cv.rect(0.18, 0.0, 0.27, 0.18, "#5e1f22", 1)
    cv.text("EVENTS", 0.225, 0.150, 0.0075, "#f1e6c8", "bask", spacing=1.1)
    cv.text("Autumn Term", 0.225, 0.137, 0.0042, "#e2b96a", "georgia_i")
    for k, t in enumerate(("Author talks", "Archive evenings", "Poetry night", "Study skills")):
        cv.text(t, 0.225, 0.110 - k * 0.014, 0.0036, "#efe2cc", "gill")
    cv.line((0.195, 0.040), (0.255, 0.040), 0.0006, "#e2b96a", 2)
    cv.text("All welcome · free", 0.225, 0.028, 0.0034, "#efe2cc", "gill")
    return cv.bake(name)


def _monitor():
    """A slim desktop monitor (screen toward -Y), base on z = 0."""
    parts = []
    parts.append(_slab("mn_base", _rect(0.105, 0.075, 0, 0.012), 0.03, [(0.0, 0.0), (0.0, 0.006), (0.003, 0.0085),
                                                                      (0.007, 0.0095)], 3, "plastic_dark"))
    parts.append(_bx("mn_neck", (-0.027, 0.034, 0.008), (0.027, 0.048, 0.31), "plastic_dark", 0.004, 2))
    W, Hh, T = 0.545, 0.322, 0.017
    z0 = 0.112
    parts.append(_bx("mn_panel", (-W / 2, 0.012, z0), (W / 2, 0.012 + T, z0 + Hh), "plastic_dark", 0.004, 2))
    parts.append(_bx("mn_hump", (-0.15, 0.026, z0 + 0.06), (0.15, 0.036, z0 + 0.24), "plastic_dark", 0.008, 2))
    bz = 0.0095
    scr = _quad_uv("mn_screen", [(-W / 2 + 0.0065, 0.0118, z0 + bz), (W / 2 - 0.0065, 0.0118, z0 + bz),
                                 (W / 2 - 0.0065, 0.0118, z0 + Hh - 0.0065), (-W / 2 + 0.0065, 0.0118, z0 + Hh - 0.0065)],
                   [(0, 0), (1, 0), (1, 1), (0, 1)], "screen_catalogue")
    parts.append(scr)
    return _join(parts, "mn_monitor")


def _keyboard():
    parts = []
    parts.append(_slab("kb_body", _rect(0.213, 0.064), 0.008, [(0.002, 0.0), (0.0, 0.002), (0.0, 0.009), (0.0025, 0.0118)],
                       3, "plastic_dark"))
    parts.append(_quad_uv("kb_keys", [(-0.205, -0.059, 0.0119), (0.205, -0.059, 0.0119), (0.205, 0.059, 0.0119),
                                      (-0.205, 0.059, 0.0119)], [(0, 0), (1, 0), (1, 1), (0, 1)], "print_keyboard"))
    return _join(parts, "kb_keyboard")


def _mouse():
    m = C.sphere("mouse", 1.0, (0, 0, 0), _mat("plastic_dark"), 16, 10)
    _xf(m, _T(0, 0, 0.0) @ Matrix.Diagonal((0.031, 0.056, 0.019, 1.0)))
    bm = bmesh.new()
    bm.from_mesh(m.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-6], context="VERTS")
    bm.to_mesh(m.data)
    bm.free()
    return _uvb(m, "plastic_dark")


def _bell():
    parts = [_turn("bell_base", [(0.0, 0.0), (0.050, 0.0), (0.052, 0.004), (0.051, 0.011), (0.047, 0.016), (0.041, 0.018),
                                 (0.0, 0.018)], 32, WOOD, caps=(False, False)),
             _turn("bell_dome", [(0.043, 0.0165), (0.0445, 0.020), (0.0445, 0.024), (0.0415, 0.035), (0.035, 0.0465),
                                 (0.025, 0.0535), (0.013, 0.057), (0.0, 0.058)], 32, BRASS, caps=(False, False)),
             _turn("bell_push", [(0.0042, 0.0575), (0.0042, 0.066), (0.0085, 0.0668), (0.009, 0.0705), (0.006, 0.0738),
                                 (0.0, 0.0745)], 16, BRASS_OLD, caps=(False, False))]
    return _join(parts, "bell")


def _leaflet_stand():
    """Walnut leaflet stand on the counter (front -Y): base, lip, a raked back board and three leaflets."""
    _attach_image("print_desk", _leaflet_image())
    parts = [_bx("lf_base", (-0.14, -0.062, 0.0), (0.14, 0.05, 0.012), WOOD, 0.002, 1, "x"),
             _bx("lf_lip", (-0.14, -0.062, 0.011), (0.14, -0.054, 0.042), WOOD, 0.0015, 1, "x")]
    back = _bx("lf_back", (-0.14, 0.0, 0.0), (0.14, 0.008, 0.145), WOOD, 0.0015, 1, "x")
    _xf(back, _T(0, -0.040, 0.0115) @ _Rx(-12))
    parts.append(back)
    rk = math.radians(12)
    for k in range(3):
        h = 0.18
        lf = _sheet("lf_leaflet", 0.085, h, (k / 3 + 0.003, 0.003, (k + 1) / 3 - 0.003, 0.997), "print_desk", 0.0, 2, 3)
        _xf(lf, _T((k - 1) * 0.093, -0.0412 + math.sin(rk) * h / 2, 0.0122 + math.cos(rk) * h / 2) @ _Rx(-12))
        parts.append(lf)
    return _join(parts, "leaflet_stand")


def build_desk_info(item=None):
    """3.2 x 1.1 x 1.08 m information desk: a bowed walnut counter (front -Y) with columns, fielded panels,
    an inscribed frieze and a marble transaction ledge; staff work top, screens and lamp behind (+Y)."""
    parts = []
    _marble_mat()
    n = len(D_PATH)
    # carcass skins, end caps and the swept bands along the bowed front
    parts.append(_skin("dk_skin", D_PATH, 0.0, DZ_L0, WOOD, right=True))
    inner = [tuple(p) for p in _offset_poly_open(D_PATH, -D_CARC)]
    parts.append(_skin("dk_skin_in", inner, 0.0, DZ_L0, WOOD, right=False))
    for k in (0, n - 1):
        bm = bmesh.new()
        a, b = D_PATH[k], inner[k]
        q = [bm.verts.new((a[0], a[1], 0)), bm.verts.new((b[0], b[1], 0)), bm.verts.new((b[0], b[1], DZ_L0)),
             bm.verts.new((a[0], a[1], DZ_L0))]
        f = bm.faces.new(q)
        f.normal_update()
        if f.normal.y < 0:
            f.normal_flip()
        parts.append(_uvb(_finish(bm, "dk_endcap", WOOD, 5.0, recalc=False), WOOD, "z"))
    for nm, prof in (("dk_plinth", D_PLINTH), ("dk_rail", D_RAIL_LO), ("dk_rail", D_RAIL_HI), ("dk_architrave", D_ARCHITRAVE),
                     ("dk_frieze", D_FRIEZE), ("dk_cornice", D_CORNICE)):
        parts.append(_msweep(nm, prof, D_PATH, WOOD, smooth=40))
    parts.append(_msweep("dk_skirting_in", [(0.005, 0.0), (-0.015, 0.0), (-0.015, 0.088), (-0.011, 0.095), (0.005, 0.095)],
                         inner, WOOD))
    # marble transaction ledge, bullnosed, wrapping the U
    ext = [(D_PATH[0][0], 0.512)] + D_PATH[1:-1] + [(D_PATH[-1][0], 0.512)]
    outer = _offset_poly_open(ext, 0.064)
    back = _offset_poly_open(ext, -(D_CARC + 0.025))
    ledge_outline = [(p.x, p.y) for p in outer] + [(p.x, p.y) for p in reversed(back)]
    lp = [(0.009, DZ_L0), (0.004, DZ_L0 + 0.0015), (0.0012, DZ_L0 + 0.005), (0.0, DZ_L0 + 0.010), (0.0, DZ_L1 - 0.012),
          (0.0012, DZ_L1 - 0.006), (0.004, DZ_L1 - 0.002), (0.009, DZ_L1)]
    parts.append(_mslab("dk_ledge", ledge_outline, lp, "marble_cream", smooth=50))
    # panels: stiles between the openings, fielded panels, bolection mouldings, paterae on the friezes
    pat = _patera(0.022)
    panel_prof = [(0.0, -0.002), (0.0, 0.004), (0.024, 0.0105), (0.028, 0.0122), (0.032, 0.0128)]
    for i in range(n - 1):
        M, L = _frame_M(D_PATH[i], D_PATH[i + 1])
        ops = _desk_openings(i, L)
        edges = [-L / 2] + [x for o in ops for x in o] + [L / 2]
        for a, b in zip(edges[0::2], edges[1::2]):
            st = _bx("dk_stile", (a, -D_FR, DZ_R0 - 0.001), (b, 0.0, DZ_R1 + 0.001), WOOD, 0.0012, 1, "z")
            parts.append(_xf(st, M))
        for a, b in ops:
            w, h = b - a, DZ_R1 - DZ_R0
            cx, cz = (a + b) / 2, (DZ_R0 + DZ_R1) / 2
            pn = _slab("dk_panel", _rect(w / 2, h / 2), 0.002, panel_prof, 2, WOOD)
            _xf(pn, _Rx(90))
            _uvb(pn, WOOD, "z")
            parts.append(_xf(pn, M @ _T(cx, 0, cz)))
            bo = _msweep("dk_bolection", D_BOLECTION, _rect_path(w / 2, h / 2, cx, cz), WOOD, True, (0, -1, 0), 40)
            parts.append(_xf(bo, M))
        if i != 2:
            p = _copy(pat)
            parts.append(_place_on_face(p, M, 0.0, (DZ_FR0 + DZ_FR1) / 2, D_FR))
    # fluted pilasters between the centre bays
    M2, L2 = _frame_M(D_PATH[2], D_PATH[3])
    shaft = _prism_xy("dk_flutes", _fluted_section(0.040, 0.026, 3, 0.0075, 0.022), DZ_R0, 0.725, WOOD, 35)
    _uvb(shaft, WOOD, "z")
    for x in (-0.25, 0.25):
        s = _copy(shaft)
        parts.append(_xf(s, M2 @ _T(x, 0, 0)))
        parts.append(_xf(_bx("dk_pil_base", (x - 0.05, -0.031, DZ_PL), (x + 0.05, 0.0, DZ_R0), WOOD, 0.003, 2, "x"), M2))
        parts.append(_xf(_bx("dk_pil_neck", (x - 0.044, -0.028, 0.725), (x + 0.044, 0.0, 0.738), WOOD, 0.0015, 1, "x"), M2))
        parts.append(_xf(_bx("dk_pil_cap", (x - 0.05, -0.031, 0.738), (x + 0.05, 0.0, DZ_AR), WOOD, 0.003, 2, "x"), M2))
    C.remove(shaft)
    # engaged columns at the four corners: moulded pedestal, turned shaft, abacus, frieze block with a patera
    col = _turn("dk_column", D_COLUMN, 24, WOOD, caps=(False, True))
    ped_prof = [(0.0, 0.0), (0.0, 0.108), (-0.003, 0.111), (-0.0045, 0.116), (-0.003, 0.121), (0.0, 0.124), (0.0, DZ_PL)]
    for i in range(1, n - 1):
        Mc = _corner_frame(i)
        ped = _slab("dk_pedestal", _rect(D_PED, D_PED), 0.003, ped_prof, 2, WOOD)
        _uvb(ped, WOOD, "z")
        parts.append(_xf(ped, Mc))
        c = _copy(col)
        parts.append(_xf(c, Mc))
        parts.append(_xf(_bx("dk_abacus", (-0.049, -0.049, 0.800), (0.049, 0.049, DZ_AR), WOOD, 0.0025, 2, "x"), Mc))
        parts.append(_xf(_bx("dk_block", (-0.054, -0.036, DZ_AR), (0.054, 0.030, DZ_FR1), WOOD, 0.003, 2, "x"), Mc))
        p = _copy(pat)
        parts.append(_place_on_face(p, Mc, 0.0, (DZ_AR + DZ_FR1) / 2, 0.036))
    C.remove(col)
    C.remove(pat)
    # inscribed tablet with brass lettering in the centre frieze
    tab = _slab("dk_tablet", _rect(0.355, 0.047), 0.006, [(0.0, -0.002), (0.0, 0.003), (0.003, 0.0055), (0.0065, 0.0065)],
                3, WOOD_DK)
    _xf(tab, _Rx(90))
    _uvb(tab, WOOD_DK, "x")
    zt = (DZ_FR0 + DZ_FR1) / 2
    parts.append(_xf(tab, M2 @ _T(0, -D_FR, zt)))
    bead = _msweep("dk_tablet_bead", [(-0.0017, -0.0004), (-0.0012, 0.0011), (0.0, 0.0017), (0.0012, 0.0011), (0.0017, -0.0004)],
                   _rect_path(0.336, 0.0285, 0, zt, -(D_FR + 0.0065)), BRASS, True, (0, -1, 0), 50)
    parts.append(_xf(bead, M2))
    txt = _text3d("dk_lettering", "INFORMATION", 0.062, 0.0028, BRASS, font="bask", spacing=1.16, resolution=3)
    wdt = txt.dimensions.x
    if wdt > 0.60:
        _xf(txt, Matrix.Diagonal((0.60 / wdt, 0.60 / wdt, 1.0, 1.0)))
    _xf(txt, M2 @ _T(0, -(D_FR + 0.0064), zt) @ _Rx(90))
    parts.append(txt)
    # staff side: moulded work top with a leather inlay on two drawer pedestals
    inner2 = _offset_poly_open(D_PATH, -(D_CARC - 0.012))
    xin = abs(inner2[0].x)
    top_outline = [(-xin, 0.22)] + [(p.x, p.y) for p in inner2[1:-1]] + [(xin, 0.22)]
    wp = [(0.006, DZ_WORK - 0.032), (0.002, DZ_WORK - 0.029), (0.0, DZ_WORK - 0.024), (0.0, DZ_WORK - 0.008),
          (0.002, DZ_WORK - 0.003), (0.006, DZ_WORK)]
    parts.append(_mslab("dk_worktop", top_outline, wp, WOOD, "x"))
    parts.append(_slab("dk_inlay", _rect(0.60, 0.112, 0, 0.065), 0.01,
                       [(0.0, DZ_WORK - 0.001), (0.0, DZ_WORK + 0.0008), (0.0015, DZ_WORK + 0.0013)], 2, "leather_green"))
    _uvb(parts[-1], "leather_green", "x")
    cup = _cup_pull(0.088)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.60, sx * 1.02))
        parts.append(_bx("dk_ped", (x0, -0.12, 0.07), (x1, 0.205, DZ_WORK - 0.0315), WOOD, 0.002, 1, "z"))
        parts.append(_bx("dk_ped_toe", (x0 + 0.015, -0.12, 0.0), (x1 - 0.015, 0.185, 0.071), WOOD_DK, 0.0, 1, "x"))
        for z0, z1 in ((0.085, 0.285), (0.295, 0.495), (0.505, 0.705)):
            parts.append(_bx("dk_drawer", (x0 + 0.012, 0.204, z0), (x1 - 0.012, 0.218, z1), WOOD, 0.003, 2, "x"))
            c = _copy(cup)
            parts.append(_xf(c, _T((x0 + x1) / 2, 0.218, z1 - 0.05) @ _Rz(180)))
    C.remove(cup)
    # screens, keyboards and mice (they face the staff, +Y)
    _attach_image("screen_catalogue", _screen_image(), emit=True)
    _attach_image("print_keyboard", _keyboard_image())
    mon, kb, ms = _monitor(), _keyboard(), _mouse()
    for x, rz in ((-0.36, 186), (0.36, 174)):
        m = _copy(mon)
        parts.append(_xf(m, _T(x, -0.02, DZ_WORK + 0.0012) @ _Rz(rz)))
        k = _copy(kb)
        parts.append(_xf(k, _T(x, 0.115, DZ_WORK + 0.0012) @ _Rz(180 + (rz - 180) * 0.4)))
        mm = _copy(ms)
        parts.append(_xf(mm, _T(x + 0.29, 0.12, DZ_WORK + 0.0012) @ _Rz(8)))
    for o in (mon, kb, ms):
        C.remove(o)
    # the hall's brass reading lamp on the work top (west end), a stack of returned books on the east end
    lamp = build_lamp_desk_brass()
    lights = [list(p) for p in lamp["light_points"]]
    lc = lamp["light_color"]
    light_color = lc if isinstance(lc, str) else list(lc)
    ML = _T(-0.98, 0.075, DZ_WORK + 0.0012) @ _Rz(200)
    _xf(lamp, ML)
    lamp_pts = [list(ML @ Vector(p)) for p in lights]
    parts.append(lamp)
    z = DZ_WORK + 0.0012
    for k, (w, d, t, key, rz) in enumerate(((0.17, 0.245, 0.034, "leather_burgundy", 4), (0.155, 0.23, 0.028, "fabric_green", -6),
                                            (0.16, 0.235, 0.040, "leather_brown", 2), (0.135, 0.205, 0.022, "leather_green", 11))):
        b = _book(w, d, t, key)
        parts.append(_xf(b, _T(0.98, 0.07, z) @ _Rz(rz + 90)))
        z += t
    # on the public ledge: a service bell and the leaflet stand
    bell = _bell()
    parts.append(_xf(bell, _T(0.43, -0.385, DZ_L1)))
    ls = _leaflet_stand()
    parts.append(_xf(ls, _T(-0.43, -0.37, DZ_L1) @ _Rz(-3)))
    ob = _join(parts, "Furniture_Desk_Info_01")
    ob["light_points"] = lamp_pts
    ob["light_color"] = light_color
    return ob


# ---------------------------------------------------------------------------
# directory_board: freestanding floor directory
# ---------------------------------------------------------------------------

DIR_PW, DIR_PH = 0.97, 1.06          # printed panel
DIR_Z0 = 0.66                        # its bottom edge
DIR_POST_X = 0.555
DIR_POST = [(0.044, 0.095), (0.044, 0.125), (0.040, 0.130), (0.034, 0.140), (0.030, 0.160), (0.029, 0.290),
            (0.034, 0.298), (0.034, 0.312), (0.029, 0.320), (0.028, 0.340), (0.028, 1.860), (0.032, 1.868),
            (0.035, 1.874), (0.032, 1.880), (0.026, 1.890), (0.024, 1.898), (0.031, 1.906), (0.037, 1.916),
            (0.037, 1.924), (0.027, 1.934), (0.016, 1.941), (0.014, 1.947), (0.020, 1.957), (0.024, 1.969),
            (0.022, 1.982), (0.015, 1.992), (0.006, 1.998), (0.0, 2.0)]
DIR_ZONE = {"hall": "#d8bd85", "entrance": "#cfc4ab", "quiet": "#a3bc8e", "collab": "#98b5c9", "lounge": "#d6a28c",
            "computers": "#ada4ca", "services": "#c2baa9", "reference": "#d6ac52"}


def _dir_map(cv, x0, y0, x1, y1):
    """The ground-floor plan from plan.py, north up, inside the box (x0, y0)-(x1, y1) of the canvas."""
    X0, X1, Z0, Z1 = -24.6, 32.6, -17.4, 23.2
    s = min((x1 - x0) / (X1 - X0), (y1 - y0) / (Z1 - Z0))
    ox = x0 + ((x1 - x0) - (X1 - X0) * s) / 2
    oy = y0 + ((y1 - y0) - (Z1 - Z0) * s) / 2

    def M(x, z):
        return (ox + (x - X0) * s, oy + (Z1 - z) * s)

    def wrect(b, color, z):
        a, c = M(b["minX"], b["maxZ"]), M(b["maxX"], b["minZ"])
        cv.rect(a[0], a[1], c[0], c[1], color, z)

    wall, ink, gap = "#3d3027", "#211c18", "#ece3cf"
    rc = P.ROTUNDA_C
    Rin = P.ROTUNDA_APOTHEM / math.cos(math.radians(15))
    Rout = (P.ROTUNDA_APOTHEM + P.EXT_WALL) / math.cos(math.radians(15))

    def rpt(r, a):
        return M(rc[0] + r * math.cos(a), rc[1] + r * math.sin(a))

    for room in P.ROOMS:
        col = DIR_ZONE.get(room.zone, "#d8d0c0")
        if room.shape == "polygon":
            cv.poly([rpt(Rin, math.radians(15 + 30 * k)) for k in range(12)], col, 1)
        else:
            wrect(room.bounds, col, 1)
    for name, b in P.GALLERY["runs"].items():
        wrect(b, "#c9ae7c", 2)
    for rail in P.GALLERY["railings"]:
        a, b = Vector(rail["a"]), Vector(rail["b"])
        L = (b - a).length
        for k in range(int(L / 0.9)):
            p0, p1 = a.lerp(b, k * 0.9 / L), a.lerp(b, min(1.0, (k * 0.9 + 0.5) / L))
            cv.line(M(p0.x, p0.y), M(p1.x, p1.y), 0.0012, "#6b5537", 3)
    # stairs (treads, arrows up toward the landing) and the landing overhead
    for fl in P.STAIRS["flights"]:
        b = fl["bounds"]
        wrect(b, "#e3dccb", 2)
        zz = fl["bottom"]
        while zz > fl["top"]:
            cv.line(M(b["minX"], zz), M(b["maxX"], zz), 0.0006, "#8d806d", 3)
            zz -= P.STAIR_TREAD
        xc = (b["minX"] + b["maxX"]) / 2
        cv.line(M(xc, fl["bottom"] - 0.6), M(xc, fl["top"] + 1.2), 0.0012, ink, 4)
        tip, l, r = M(xc, fl["top"] + 0.4), M(xc - 0.45, fl["top"] + 1.4), M(xc + 0.45, fl["top"] + 1.4)
        cv.poly([l, r, tip], ink, 4)
    lb = P.LANDING
    for (ax, az), (bx, bz) in (((lb["minX"], lb["maxZ"]), (lb["maxX"], lb["maxZ"])),):
        L = bx - ax
        for k in range(int(L / 0.8)):
            cv.line(M(ax + k * 0.8, az), M(ax + k * 0.8 + 0.45, az), 0.0010, "#6b5537", 3)
    # furniture silhouettes
    furn = {"table_communal": "#a7835a", "desk_info": "#6e4f33", "table_group_rect": "#93a9b8", "table_group_round": "#93a9b8",
            "desk_computer": "#9a92b8", "carrel": "#8fa47e", "desk_quiet": "#8fa47e", "table_reading_green": "#b8954a",
            "sofa_chesterfield": "#a56a58", "armchair_club": "#a56a58", "fireplace": "#7a5a48", "table_coffee": "#a07a5a",
            "cabinet_display": "#a8894e", "printer_station": "#8c86a6", "table_vitrine": "#b8954a"}
    for it in P.ITEMS:
        col = furn.get(it.kind)
        if col is None or it.y > 1.0:
            continue
        k = P.KINDS[it.kind]
        w, d = it.w or k["w"], it.d or k["d"]
        if k["shape"] == "circle":
            cv.circle(M(it.x, it.z), w / 2 * s, col, 3, 32)
            continue
        cs = [P.local_to_world(it.x, it.z, it.rot, lx, lz) for lx, lz in ((-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2))]
        cv.poly([M(*c) for c in cs], col, 3)
    for it in P.ITEMS:
        if it.kind == "desk_research_ring":
            cv.ring(M(it.x, it.z), 1.35 * s, 1.9 * s, "#8a6a3a", 3, 48)
    # walls with their ground-floor openings
    for w in P.WALLS:
        wrect(w.bounds, wall, 5)
        b = w.bounds
        for o in w.openings:
            if o.y0 > 2.5:
                continue
            if w.axis == "x":
                ob = {"minX": o.at - o.width / 2, "maxX": o.at + o.width / 2, "minZ": b["minZ"] - 0.02, "maxZ": b["maxZ"] + 0.02}
            else:
                ob = {"minX": b["minX"] - 0.02, "maxX": b["maxX"] + 0.02, "minZ": o.at - o.width / 2, "maxZ": o.at + o.width / 2}
            if o.kind in ("window_tall", "window_arched"):
                if w.axis == "x":
                    mz = (b["minZ"] + b["maxZ"]) / 2
                    ob = dict(ob, minZ=mz - 0.12, maxZ=mz + 0.12)
                else:
                    mx = (b["minX"] + b["maxX"]) / 2
                    ob = dict(ob, minX=mx - 0.12, maxX=mx + 0.12)
                wrect(ob, "#b9d0de", 6)
            elif o.kind == "exit":
                wrect(ob, "#2c8a4f", 6)
            elif o.kind == "elevator":
                wrect(ob, "#9c958a", 6)
            else:
                wrect(ob, gap, 6)
    for k in range(12):
        a0, a1 = math.radians(15 + 30 * k), math.radians(45 + 30 * k)
        cv.poly([rpt(Rin, a0), rpt(Rin, a1), rpt(Rout, a1), rpt(Rout, a0)], wall, 5)
    for bay in P.ROTUNDA["bays"]:
        if bay["role"] not in ("arch", "exit"):
            continue
        a = bay["angle"]
        w = P.ROTUNDA["arch"]["width"] if bay["role"] == "arch" else P.ROTUNDA["exit"]["width"]
        t = Vector((-math.sin(a), math.cos(a)))
        r = Vector((math.cos(a), math.sin(a)))
        c = Vector(rc)
        q = [c + r * (P.ROTUNDA_APOTHEM - 0.1) - t * w / 2, c + r * (P.ROTUNDA_APOTHEM - 0.1) + t * w / 2,
             c + r * (P.ROTUNDA_APOTHEM + P.EXT_WALL + 0.1) + t * w / 2, c + r * (P.ROTUNDA_APOTHEM + P.EXT_WALL + 0.1) - t * w / 2]
        cv.poly([M(p.x, p.y) for p in q], "#2c8a4f" if bay["role"] == "exit" else gap, 6)
    sh = P.LIFT["shaft"]
    wrect(sh, "#8f887c", 6)
    # labels
    L1, L2, L3 = 0.0165, 0.0122, 0.0094
    lab = [("Grand Reading Hall", 0.0, -1.0, L1, ink), ("Upper Gallery above", 2.0, -8.75, L3, "#4d3c25"),
           ("Upper Gallery above", 2.0, 6.75, L3, "#4d3c25"), ("Quiet Study", -12.15, 14.4, L1, ink),
           ("Group Study", 12.15, 14.4, L1, ink), ("Entrance Hall", 0.0, 11.9, L2, ink),
           ("Computers & Printing", -5.6, -13.5, L2, ink), ("Services", 8.55, -12.9, L2, ink),
           ("Washrooms  ·  Print Room", 8.55, -14.5, L3, "#3d3530"), ("Reference", 23.4, -5.0, L2, ink),
           ("Rotunda", 23.4, -3.4, L2, ink), ("Research Help", 23.4, 3.1, L3, "#3d3530")]
    for t, x, z, sz, c in lab:
        p = M(x, z)
        cv.text(t, p[0], p[1], sz, c, "gill", z=9)
    p = M(-19.1, -1.0)
    cv.text("Reading\nLounge", p[0], p[1], L2, ink, "gill", z=9, line=1.25)
    p = M(sh["maxX"] + 0.6, (sh["minZ"] + sh["maxZ"]) / 2)
    cv.text("Lift", p[0], p[1], L3, ink, "gill", align="LEFT", z=9)
    for fl in P.STAIRS["flights"]:
        b = fl["bounds"]
        p = M((b["minX"] + b["maxX"]) / 2, (b["minZ"] + b["maxZ"]) / 2 + 1.2)
        cv.text("Stairs up", p[0], p[1], 0.0066, ink, "gill", rot=math.pi / 2, z=9)
    p = M(0.0, 14.6)
    cv.text("Information", p[0], p[1], 0.0058, "#f3ead6", "gill", z=9, maxw=3.0 * s)
    ex = P.WALLS[[w.id for w in P.WALLS].index("north_e")]
    p = M(ex.bounds["maxX"] + 0.6, -13.5)
    cv.text("Exit", p[0], p[1], L3, "#1f6b3c", "gill", align="LEFT", z=9)
    p = M(rc[0] + Rout + 0.6, rc[1])
    cv.text("Exit", p[0], p[1], L3, "#1f6b3c", "gill", align="LEFT", z=9)
    # main entrance arrow
    a, b = M(0.0, 22.6), M(0.0, 20.9)
    cv.line(a, b, 0.0022, ink, 8)
    cv.poly([(b[0] - 0.0065, b[1] - 0.008), (b[0] + 0.0065, b[1] - 0.008), (b[0], b[1] + 0.002)], ink, 8)
    p = M(1.0, 22.3)
    cv.text("Main Entrance", p[0], p[1], L3, ink, "gill", align="LEFT", z=9)
    # you are here (this board's own position)
    me_ = next((it for it in P.ITEMS if it.kind == "directory_board"), None)
    yx, yz = (me_.x, me_.z) if me_ else (-2.5, 16.6)
    p = M(yx, yz)
    cv.circle(p, 0.0105, "#c0261d", 10, 40)
    cv.circle(p, 0.0062, "#ffffff", 11, 40)
    cv.circle(p, 0.0038, "#c0261d", 12, 32)
    cv.text("You are here", p[0] + 0.015, p[1], 0.0125, "#b0201a", "gill", align="LEFT", z=12, bold=0.05)
    # north arrow and scale bar
    nx_, ny_ = x1 - 0.03, y1 - 0.045
    cv.circle((nx_, ny_), 0.019, "#e8dfc9", 7, 40)
    cv.ring((nx_, ny_), 0.0175, 0.019, ink, 8, 40)
    cv.poly([(nx_, ny_ + 0.015), (nx_ - 0.007, ny_ - 0.010), (nx_, ny_ - 0.005)], ink, 9)
    cv.poly([(nx_, ny_ + 0.015), (nx_, ny_ - 0.005), (nx_ + 0.007, ny_ - 0.010)], "#8d806d", 9)
    cv.text("N", nx_, ny_ + 0.027, 0.0085, ink, "gill", z=9)
    sx0, sy0 = x1 - 0.20, y0 + 0.012
    for k in range(2):
        cv.rect(sx0 + k * 5 * s, sy0, sx0 + (k + 1) * 5 * s, sy0 + 0.004, ink if k == 0 else "#efe7d4", 8)
    cv.outline_rect(sx0, sy0, sx0 + 10 * s, sy0 + 0.004, 0.0008, ink, 9)
    for k, t in ((0, "0"), (5, "5"), (10, "10 m")):
        cv.text(t, sx0 + k * s, sy0 + 0.011, 0.0055, ink, "gill", z=9)


def _directory_image():
    name = "TX_Lobby_Directory"
    img = bpy.data.images.get(name)
    if img is not None:
        return img
    W, H = DIR_PW, DIR_PH
    cv = Canvas("directory", W, H, 2100, bg="#ebe1c9")
    ink, green = "#211c18", "#1f3a2c"
    cv.rect(0, H - 0.090, W, H, green, 1)
    cv.line((0.0, H - 0.093), (W, H - 0.093), 0.002, "#c99b47", 2)
    cv.text("GROUND FLOOR", 0.035, H - 0.040, 0.026, "#f1e6c8", "gill", align="LEFT", spacing=1.08)
    cv.text("Entrance level", 0.036, H - 0.072, 0.011, "#d9c79a", "georgia_i", align="LEFT")
    cv.text("Upper Gallery: up the stairs either side of this hall,", W - 0.035, H - 0.036, 0.0105, "#e8dcc0", "gill", align="RIGHT")
    cv.text("or by the lift on the hall's east wall", W - 0.035, H - 0.058, 0.0105, "#e8dcc0", "gill", align="RIGHT")
    _dir_map(cv, 0.025, 0.335, W - 0.025, H - 0.105)
    cv.line((0.035, 0.318), (W - 0.035, 0.318), 0.0015, "#8d806d", 2)
    cv.text("WHERE TO FIND", 0.035, 0.293, 0.0160, ink, "gill", align="LEFT", spacing=1.1)
    entries = (("hall", "Books and reading tables", "Grand Reading Hall"),
               ("hall", "Upper Gallery", "Stairs in this hall, or the lift"),
               ("reference", "Reference and research help", "Reference Rotunda"),
               ("quiet", "Silent study", "Quiet Study, west"),
               ("collab", "Group rooms and whiteboards", "Group Study, east"),
               ("computers", "Computers, printing, copying", "North wing"),
               ("services", "Washrooms, water refill", "Services, north"),
               ("lounge", "Fireside reading", "Reading Lounge, west"),
               ("entrance", "Information, returns, lost property", "Desk ahead of you"),
               ("entrance", "Lockers, coats and umbrellas", "Beside the main door"))
    for k, (zone, what, where) in enumerate(entries):
        col, row = k // 5, k % 5
        x = 0.035 + col * 0.47
        y = 0.246 - row * 0.047
        cv.rect(x, y - 0.015, x + 0.030, y + 0.015, DIR_ZONE[zone], 2)
        cv.outline_rect(x, y - 0.015, x + 0.030, y + 0.015, 0.0010, "#6b5f50", 3)
        cv.text(what, x + 0.040, y + 0.0068, 0.0122, ink, "gill", align="LEFT", maxw=0.40)
        cv.text(where, x + 0.040, y - 0.0128, 0.0100, "#5a4f43", "georgia_i", align="LEFT", maxw=0.40)
    cv.rect(0, 0, W, 0.016, green, 1)
    return cv.bake(name)


def build_directory_board(item=None):
    """1.2 x 0.45 x 2.0 m freestanding directory: turned walnut posts on bracket feet, a moulded frame round
    the printed ground-floor plan, and an arched crest lettered LIBRARY DIRECTORY (face toward -Y)."""
    parts = []
    _attach_image("print_directory", _directory_image())
    post = _turn("dr_post", DIR_POST, 24, WOOD)
    foot_side = [(0.225, 0.0), (0.225, 0.026), (0.215, 0.033), (0.19, 0.040), (0.16, 0.047), (0.13, 0.059), (0.10, 0.078),
                 (0.08, 0.093), (0.07, 0.10)]
    foot = [(-0.225, 0.0), (-0.15, 0.0)] + [(-0.15 + 0.30 * t / 10, 0.022 * math.sin(math.pi * t / 10)) for t in range(1, 10)] + \
           [(0.15, 0.0)] + foot_side + [(-y, z) for y, z in reversed(foot_side)]
    for sx in (-1, 1):
        x = sx * DIR_POST_X
        p = _copy(post)
        parts.append(_xf(p, _T(x, 0, 0)))
        f = _extrude("dr_foot", foot, x - 0.032, x + 0.032, WOOD, plane="yz", bevel_w=0.004, segs=2)
        parts.append(_uvb(f, WOOD, "y"))
    C.remove(post)
    parts.append(_turn_between("dr_stretcher", (-DIR_POST_X + 0.02, 0.0, 0.305), (DIR_POST_X - 0.02, 0.0, 0.305),
                               [(0.014, 0.0), (0.016, 0.06), (0.017, 0.30), (0.020, 0.47), (0.021, 0.5), (0.020, 0.53),
                                (0.017, 0.70), (0.016, 0.94), (0.014, 1.0)], 14, WOOD, 0.001))
    zc = DIR_Z0 + DIR_PH / 2
    prof = [(-0.007, -0.001), (-0.007, 0.004), (-0.004, 0.009), (0.000, 0.013), (0.006, 0.017), (0.014, 0.020),
            (0.024, 0.0215), (0.034, 0.020), (0.041, 0.016), (0.046, 0.010), (0.048, 0.004), (0.048, -0.030), (0.0, -0.030)]
    parts.append(_msweep("dr_frame", prof, _rect_path(DIR_PW / 2, DIR_PH / 2, 0.0, zc), WOOD, True, (0, -1, 0), 40))
    parts.append(_bx("dr_back", (-0.52, 0.0, DIR_Z0 - 0.04), (0.52, 0.032, DIR_Z0 + DIR_PH + 0.04), WOOD, 0.002, 1, "z"))
    parts.append(_quad_uv("dr_print", [(-DIR_PW / 2, -0.0006, DIR_Z0), (DIR_PW / 2, -0.0006, DIR_Z0),
                                       (DIR_PW / 2, -0.0006, DIR_Z0 + DIR_PH), (-DIR_PW / 2, -0.0006, DIR_Z0 + DIR_PH)],
                          [(0, 0), (1, 0), (1, 1), (0, 1)], "print_directory"))
    # arched crest with a green field and gilt lettering, a rounded walnut cap along its arch
    zt = DIR_Z0 + DIR_PH + 0.046
    arch = C.arch_points(1.06, zt + 0.035, 16, 0.0, rise=0.085)
    crest = [(-0.53, zt - 0.002), (0.53, zt - 0.002)] + [(x, z) for x, z in reversed(arch)]
    cr = _extrude("dr_crest", crest, -0.012, 0.032, WOOD, plane="xz", bevel_w=0.002, segs=1)
    parts.append(_uvb(cr, WOOD, "x"))
    parts.append(_tube("dr_crest_cap", [(x, 0.010, z) for x, z in arch], 0.0235, WOOD, 12, caps=(True, True)))
    _uvb(parts[-1], WOOD, "x")
    farch = C.arch_points(0.98, zt + 0.035, 16, 0.0, rise=0.060)
    field = [(-0.49, zt + 0.014), (0.49, zt + 0.014)] + [(x, z) for x, z in reversed(farch)]
    parts.append(_extrude("dr_field", field, -0.0134, -0.0110, "signage", plane="xz"))
    txt = _text3d("dr_title", "LIBRARY DIRECTORY", 0.052, 0.0022, "gilt", font="bask", spacing=1.12, resolution=3)
    wdt = txt.dimensions.x
    if wdt > 0.84:
        _xf(txt, Matrix.Diagonal((0.84 / wdt, 0.84 / wdt, 1.0, 1.0)))
    _xf(txt, _T(0, -0.0133, zt + 0.052) @ _Rx(90))
    parts.append(txt)
    return _join(parts, "Furniture_Directory_Board_01")


# ---------------------------------------------------------------------------
# noticeboard: wall-mounted cork board ("events" or "map")
# ---------------------------------------------------------------------------

NB_CORK_HW, NB_CORK_HH, NB_ZC, NB_CORK_Y = 0.71, 0.485, 1.575, -0.022
NB_FRAME = [(-0.004, -0.001), (-0.004, 0.004), (0.0, 0.009), (0.007, 0.017), (0.016, 0.025), (0.028, 0.031), (0.042, 0.034),
            (0.056, 0.034), (0.068, 0.032), (0.078, 0.027), (0.085, 0.019), (0.089, 0.010), (0.090, 0.003),
            (0.090, -0.0215), (0.0, -0.0215)]


def _notice_events(cv):
    """Atlas of the events board's pinned papers (cells in metres, see NOTICES_EVENTS)."""
    ink, mute, green, red = "#22201d", "#5f584f", "#1f3a2c", "#7a2a22"
    # EVENTS poster (0.30 x 0.42)
    x0, y0, w, h = 0.0, 0.38, 0.30, 0.42
    cv.rect(x0, y0, x0 + w, y0 + h, "#f4eedf", 1)
    cv.rect(x0, y0 + h - 0.085, x0 + w, y0 + h, green, 2)
    cv.text("EVENTS", x0 + w / 2, y0 + h - 0.040, 0.030, "#f1e6c8", "bask", spacing=1.15)
    cv.text("this term at the library", x0 + w / 2, y0 + h - 0.070, 0.0085, "#e2c27a", "georgia_i")
    evs = (("THU", "14 NOV", "Author talk: Writing the City", "Grand Reading Hall · 18:30"),
           ("TUE", "19 NOV", "Archive open evening", "Reference Rotunda · 17:00"),
           ("FRI", "22 NOV", "Poetry by lamplight", "Reading Lounge · 19:00"),
           ("WED", "27 NOV", "Research skills workshop", "Computers & Printing · 14:00"),
           ("MON", "2 DEC", "Exam season study marathon", "All floors · from 08:00"))
    for k, (dw, dt, t, where) in enumerate(evs):
        y = y0 + h - 0.115 - k * 0.058
        cv.rect(x0 + 0.016, y - 0.040, x0 + 0.066, y + 0.010, red, 2)
        cv.text(dw, x0 + 0.041, y - 0.004, 0.0065, "#f3e2c4", "gill")
        cv.text(dt, x0 + 0.041, y - 0.024, 0.0080, "#ffffff", "gill")
        cv.text(t, x0 + 0.076, y - 0.006, 0.0080, ink, "georgia", align="LEFT", maxw=0.21)
        cv.text(where, x0 + 0.076, y - 0.026, 0.0064, mute, "gill", align="LEFT", maxw=0.21)
    cv.text("Free · all welcome · ask at the Information Desk", x0 + w / 2, y0 + 0.016, 0.0058, mute, "gill")
    # STUDY GROUPS (0.21 x 0.297) with tear-off tabs
    x0, y0, w, h = 0.31, 0.50, 0.21, 0.297
    cv.rect(x0, y0, x0 + w, y0 + h, "#fbf8f0", 1)
    cv.text("STUDY", x0 + w / 2, y0 + h - 0.028, 0.019, "#1d3f7a", "gill", spacing=1.1)
    cv.text("GROUPS", x0 + w / 2, y0 + h - 0.055, 0.019, "#1d3f7a", "gill", spacing=1.1)
    cv.text("Join a peer-led group this term", x0 + w / 2, y0 + h - 0.077, 0.0062, mute, "georgia_i")
    for k, t in enumerate(("Calculus I  ·  Mon 16:00", "Organic Chemistry  ·  Tue 18:00", "Essay Writing  ·  Wed 15:00",
                           "Intro to Programming  ·  Thu 17:00", "Statistics  ·  Fri 12:00")):
        cv.text(t, x0 + 0.016, y0 + h - 0.103 - k * 0.019, 0.0064, ink, "gill", align="LEFT", maxw=w - 0.03)
    cv.text("Group Study rooms, east wing", x0 + w / 2, y0 + 0.088, 0.0058, mute, "gill")
    for k in range(7):
        tx = x0 + 0.006 + k * (w - 0.012) / 7
        tw = (w - 0.012) / 7
        if k:
            for j in range(9):
                cv.line((tx, y0 + 0.004 + j * 0.0075), (tx, y0 + 0.008 + j * 0.0075), 0.0005, "#9a948a", 2)
        cv.text("studygroups@library", tx + tw / 2, y0 + 0.038, 0.0034, ink, "gill", rot=math.pi / 2)
    cv.line((x0, y0 + 0.074), (x0 + w, y0 + 0.074), 0.0005, "#9a948a", 2)
    # LIBRARY HOURS card (0.21 x 0.15)
    x0, y0, w, h = 0.53, 0.65, 0.21, 0.15
    cv.rect(x0, y0, x0 + w, y0 + h, "#efe3c4", 1)
    cv.outline_rect(x0 + 0.006, y0 + 0.006, x0 + w - 0.006, y0 + h - 0.006, 0.0012, green, 2)
    cv.text("LIBRARY HOURS", x0 + w / 2, y0 + h - 0.026, 0.0115, green, "gill", spacing=1.08)
    for k, (d, t) in enumerate((("Mon - Thu", "08:00 - 23:00"), ("Friday", "08:00 - 20:00"), ("Saturday", "10:00 - 18:00"),
                                ("Sunday", "12:00 - 22:00"))):
        y = y0 + h - 0.052 - k * 0.018
        cv.text(d, x0 + 0.022, y, 0.0072, ink, "gill", align="LEFT")
        cv.text(t, x0 + w - 0.022, y, 0.0072, ink, "gill", align="RIGHT")
    cv.text("Exam season: open 24 hours", x0 + w / 2, y0 + 0.020, 0.0062, red, "georgia_i")
    # LOST & FOUND (0.21 x 0.21)
    x0, y0, w, h = 0.53, 0.43, 0.21, 0.21
    cv.rect(x0, y0, x0 + w, y0 + h, "#f6f1e4", 1)
    cv.rect(x0, y0 + h - 0.045, x0 + w, y0 + h, "#c9a23a", 2)
    cv.text("LOST & FOUND", x0 + w / 2, y0 + h - 0.024, 0.0125, "#2a2216", "gill", spacing=1.06)
    cv.text("Handed in at the Information Desk:", x0 + 0.014, y0 + h - 0.062, 0.0060, mute, "georgia_i", align="LEFT")
    for k, t in enumerate(("Green umbrella, wooden handle", "Silver fountain pen", "Striped college scarf",
                           "Calculator (grey)", "Library card - M. Okafor", "Reading glasses, tortoiseshell")):
        cv.text("-  " + t, x0 + 0.014, y0 + h - 0.082 - k * 0.0175, 0.0062, ink, "gill", align="LEFT", maxw=w - 0.025)
    cv.text("Ask at the desk with your ID", x0 + w / 2, y0 + 0.012, 0.0056, mute, "gill")
    # BOOK SALE flyer (0.15 x 0.21)
    x0, y0, w, h = 0.75, 0.59, 0.15, 0.21
    cv.rect(x0, y0, x0 + w, y0 + h, "#e7b84a", 1)
    cv.text("BOOK", x0 + w / 2, y0 + h - 0.034, 0.022, "#3a1f12", "bask", spacing=1.1)
    cv.text("SALE", x0 + w / 2, y0 + h - 0.064, 0.022, "#3a1f12", "bask", spacing=1.1)
    for k in range(5):
        bx = x0 + 0.030 + k * 0.019
        cv.rect(bx, y0 + 0.085, bx + 0.015, y0 + 0.085 + 0.030 + (k % 3) * 0.006, ["#7a2a22", "#1f3a2c", "#3b4f7a", "#5b2a4a", "#2a2216"][k], 2)
    cv.rect(x0 + 0.022, y0 + 0.082, x0 + w - 0.022, y0 + 0.086, "#3a1f12", 2)
    cv.text("Sat 23 Nov  ·  10:00", x0 + w / 2, y0 + 0.060, 0.0068, "#3a1f12", "gill")
    cv.text("Entrance Hall", x0 + w / 2, y0 + 0.044, 0.0068, "#3a1f12", "gill")
    cv.text("Paperbacks 1  ·  Hardbacks 2", x0 + w / 2, y0 + 0.022, 0.0052, "#3a1f12", "gill")
    # POETRY NIGHT (0.148 x 0.21)
    x0, y0, w, h = 0.91, 0.59, 0.148, 0.21
    cv.rect(x0, y0, x0 + w, y0 + h, "#1d2440", 1)
    cv.circle((x0 + w * 0.68, y0 + h - 0.060), 0.026, "#efe2b8", 2, 48)
    cv.circle((x0 + w * 0.68 + 0.011, y0 + h - 0.054), 0.024, "#1d2440", 3, 48)
    for k in range(9):
        cv.circle((x0 + 0.012 + (k * 37 % 11) * 0.012, y0 + h - 0.015 - (k * 23 % 7) * 0.012), 0.0012, "#efe2b8", 2, 8)
    cv.text("POETRY", x0 + w / 2, y0 + 0.098, 0.016, "#efe2b8", "bask", spacing=1.1)
    cv.text("NIGHT", x0 + w / 2, y0 + 0.074, 0.016, "#efe2b8", "bask", spacing=1.1)
    cv.text("Readings by lamplight", x0 + w / 2, y0 + 0.050, 0.0058, "#c8c2d8", "georgia_i")
    cv.text("Fri 22 Nov · Reading Lounge", x0 + w / 2, y0 + 0.024, 0.0050, "#c8c2d8", "gill")
    # index cards, handwritten
    for (x0, y0), lines in (((0.75, 0.47), ("Room to share for", "spring term?", "ask for Priya - Hall 3")),
                            ((0.89, 0.47), ("LOST: grey notebook", "(History notes!)", "reward - see desk")),
                            ((0.31, 0.40), ("French tutoring", "all levels", "ask for Amelie")),
                            ((0.62, 0.20), ("Wi-Fi: Library-Guest", "password at the", "Information Desk"))):
        cv.rect(x0, y0, x0 + 0.127, y0 + 0.076, "#fbfaf4", 1)
        cv.line((x0, y0 + 0.058), (x0 + 0.127, y0 + 0.058), 0.0007, "#d06a6a", 2)
        for j in range(3):
            cv.line((x0, y0 + 0.042 - j * 0.0145), (x0 + 0.127, y0 + 0.042 - j * 0.0145), 0.0004, "#9cb4d4", 2)
        for j, t in enumerate(lines):
            cv.text(t, x0 + 0.008, y0 + 0.064 - j * 0.0158 - 0.002, 0.0062, "#1d2a6a", "hand", align="LEFT", maxw=0.112)
    # BOOK CLUB (0.148 x 0.21)
    x0, y0, w, h = 0.45, 0.10, 0.148, 0.21
    cv.rect(x0, y0, x0 + w, y0 + h, "#f2ead8", 1)
    cv.rect(x0 + 0.010, y0 + 0.010, x0 + w - 0.010, y0 + h - 0.010, "#5e1f22", 2)
    cv.rect(x0 + 0.014, y0 + 0.014, x0 + w - 0.014, y0 + h - 0.014, "#f2ead8", 3)
    cv.text("BOOK CLUB", x0 + w / 2, y0 + h - 0.040, 0.0125, "#5e1f22", "bask", spacing=1.08)
    cv.text("This month:", x0 + w / 2, y0 + h - 0.066, 0.0058, mute, "georgia_i")
    cv.text("Middlemarch", x0 + w / 2, y0 + h - 0.086, 0.0098, ink, "georgia_i")
    cv.text("George Eliot", x0 + w / 2, y0 + h - 0.104, 0.0062, mute, "gill")
    cv.text("Thursdays 19:00", x0 + w / 2, y0 + 0.058, 0.0064, ink, "gill")
    cv.text("Reading Lounge", x0 + w / 2, y0 + 0.042, 0.0064, ink, "gill")
    cv.text("tea provided", x0 + w / 2, y0 + 0.025, 0.0054, mute, "georgia_i")


NOTICES_EVENTS = (  # (atlas cell x0, y0, w, h), board centre (x, z), tilt deg, curl m, pins [(u, v)] in 0..1 of the sheet
    ((0.0, 0.38, 0.30, 0.42), (-0.46, 1.66), -1.0, 0.004, ((0.08, 0.95), (0.92, 0.95))),
    ((0.31, 0.50, 0.21, 0.297), (-0.165, 1.75), 1.4, 0.006, ((0.5, 0.95),)),
    ((0.53, 0.65, 0.21, 0.15), (0.10, 1.935), -0.8, 0.0, ((0.08, 0.90), (0.92, 0.90))),
    ((0.53, 0.43, 0.21, 0.21), (0.10, 1.70), 1.2, 0.004, ((0.5, 0.94),)),
    ((0.75, 0.59, 0.15, 0.21), (0.335, 1.82), 2.5, 0.005, ((0.5, 0.94),)),
    ((0.91, 0.59, 0.148, 0.21), (0.545, 1.78), -2.0, 0.003, ((0.12, 0.94), (0.88, 0.94))),
    ((0.75, 0.47, 0.127, 0.076), (0.36, 1.52), -4.0, 0.0, ((0.5, 0.82),)),
    ((0.89, 0.47, 0.127, 0.076), (0.56, 1.50), 3.0, 0.0, ((0.5, 0.82),)),
    ((0.31, 0.40, 0.127, 0.076), (-0.17, 1.43), 5.0, 0.0, ((0.5, 0.82),)),
    ((0.62, 0.20, 0.127, 0.076), (-0.47, 1.33), -3.0, 0.0, ((0.5, 0.82),)),
    ((0.45, 0.10, 0.148, 0.21), (0.11, 1.33), 1.0, 0.003, ((0.5, 0.94),)),
)
NOTICES_EVENTS_ATLAS = (1.20, 0.80)


def _campus_map(cv, x0, y0, w, h):
    """A stylised campus map poster in (x0, y0, w, h)."""
    ink, green, path = "#22201d", "#1f3a2c", "#efe2c2"
    cv.rect(x0, y0, x0 + w, y0 + h, "#eae2cc", 1)
    cv.rect(x0, y0 + h - 0.060, x0 + w, y0 + h, green, 2)
    cv.text("UNIVERSITY CAMPUS", x0 + 0.03, y0 + h - 0.030, 0.024, "#f1e6c8", "bask", align="LEFT", spacing=1.08)
    cv.text("Map & visitor information", x0 + w - 0.03, y0 + h - 0.030, 0.010, "#e2c27a", "georgia_i", align="RIGHT")
    mx0, my0, mx1, my1 = x0 + 0.02, y0 + 0.02, x0 + w * 0.70, y0 + h - 0.075
    cv.rect(mx0, my0, mx1, my1, "#d7dcc0", 2)
    # lawns, river, paths
    for (a, b, c, d) in ((0.05, 0.10, 0.30, 0.42), (0.36, 0.52, 0.62, 0.92), (0.66, 0.08, 0.95, 0.40), (0.06, 0.62, 0.30, 0.95)):
        cv.rect(mx0 + (mx1 - mx0) * a, my0 + (my1 - my0) * b, mx0 + (mx1 - mx0) * c, my0 + (my1 - my0) * d, "#a9c28c", 3)
    rv = [(0.0, 0.18), (0.18, 0.12), (0.40, 0.20), (0.58, 0.10), (0.80, 0.02), (1.0, 0.0)]
    cv.polyline([(mx0 + (mx1 - mx0) * u, my0 + (my1 - my0) * v) for u, v in rv], 0.016, "#8fb3cf", 4)
    for pts in (((0.0, 0.47), (1.0, 0.47)), ((0.33, 0.0), (0.33, 1.0)), ((0.64, 0.47), (0.64, 1.0)), ((0.33, 0.47), (0.64, 0.98))):
        cv.polyline([(mx0 + (mx1 - mx0) * u, my0 + (my1 - my0) * v) for u, v in pts], 0.010, path, 5)
    blds = ((1, "Library", 0.40, 0.56, 0.58, 0.78, "#d9b45a"), (2, "Great Hall", 0.08, 0.54, 0.26, 0.60, "#cdb9a0"),
            (3, "Science Quad", 0.68, 0.56, 0.95, 0.70, "#cdb9a0"), (4, "Chapel", 0.12, 0.74, 0.20, 0.90, "#cdb9a0"),
            (5, "Student Union", 0.37, 0.28, 0.58, 0.42, "#cdb9a0"), (6, "Observatory", 0.80, 0.78, 0.90, 0.92, "#cdb9a0"),
            (7, "Museum", 0.08, 0.26, 0.26, 0.40, "#cdb9a0"), (8, "Sports Centre", 0.70, 0.16, 0.92, 0.34, "#cdb9a0"),
            (9, "Halls of Residence", 0.68, 0.84, 0.76, 0.98, "#cdb9a0"))
    for num, name, a, b, c, d, col in blds:
        p0 = (mx0 + (mx1 - mx0) * a, my0 + (my1 - my0) * b)
        p1 = (mx0 + (mx1 - mx0) * c, my0 + (my1 - my0) * d)
        cv.rect(p0[0], p0[1], p1[0], p1[1], "#6b5a48", 6)
        cv.rect(p0[0] + 0.002, p0[1] + 0.002, p1[0] - 0.002, p1[1] - 0.002, col, 7)
        cc = ((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2)
        cv.circle(cc, 0.0085, "#7a2a22" if num == 1 else ink, 8, 24)
        cv.text(str(num), cc[0], cc[1], 0.0075, "#ffffff", "gill", z=9)
    lib = (mx0 + (mx1 - mx0) * 0.49, my0 + (my1 - my0) * 0.56)
    cv.circle((lib[0], lib[1] - 0.004), 0.008, "#c0261d", 10, 32)
    cv.circle((lib[0], lib[1] - 0.004), 0.0035, "#ffffff", 11, 24)
    cv.text("You are here", lib[0] + 0.012, lib[1] - 0.004, 0.0080, "#b0201a", "gill", align="LEFT", z=11)
    cv.text("Main Gate", mx0 + (mx1 - mx0) * 0.33, my0 + 0.012, 0.0075, ink, "gill", z=9)
    cv.text("River Cam", mx0 + (mx1 - mx0) * 0.80, my0 + (my1 - my0) * 0.07, 0.0068, "#3f6a8a", "georgia_i", z=9)
    nx_, ny_ = mx1 - 0.025, my1 - 0.03
    cv.poly([(nx_, ny_ + 0.016), (nx_ - 0.007, ny_ - 0.008), (nx_ + 0.007, ny_ - 0.008)], ink, 9)
    cv.text("N", nx_, ny_ + 0.026, 0.008, ink, "gill", z=9)
    lx = x0 + w * 0.72
    cv.text("KEY", lx, my1 - 0.012, 0.012, ink, "gill", align="LEFT", spacing=1.1)
    for k, (num, name, *_r) in enumerate(blds):
        y = my1 - 0.040 - k * 0.026
        cv.circle((lx + 0.008, y), 0.0075, "#7a2a22" if num == 1 else ink, 3, 24)
        cv.text(str(num), lx + 0.008, y, 0.0068, "#ffffff", "gill", z=4)
        cv.text(name, lx + 0.022, y, 0.0085, ink, "gill", align="LEFT", maxw=w * 0.25)
    cv.text("Bus stop: Library Road", lx, my0 + 0.030, 0.0068, "#3a332c", "georgia_i", align="LEFT", maxw=w * 0.26)
    cv.text("Visitor parking: Gate 2", lx, my0 + 0.012, 0.0068, "#3a332c", "georgia_i", align="LEFT", maxw=w * 0.26)


def _notice_map(cv):
    _campus_map(cv, 0.0, 0.0, 0.95, 0.66)
    ink, mute = "#22201d", "#5f584f"
    x0, y0, w, h = 0.96, 0.50, 0.21, 0.15
    cv.rect(x0, y0, x0 + w, y0 + h, "#f4eedf", 1)
    cv.rect(x0, y0 + h - 0.040, x0 + w, y0 + h, "#7a2a22", 2)
    cv.text("CAMPUS TOURS", x0 + w / 2, y0 + h - 0.021, 0.0110, "#f3e2c4", "gill", spacing=1.08)
    for k, t in enumerate(("Wednesdays 14:00", "from the Entrance Hall", "about one hour, free")):
        cv.text(t, x0 + w / 2, y0 + h - 0.062 - k * 0.019, 0.0074, ink if k < 2 else mute, "gill")
    x0, y0, w, h = 0.96, 0.25, 0.15, 0.21
    cv.rect(x0, y0, x0 + w, y0 + h, "#fbf8f0", 1)
    cv.text("SHUTTLE BUS", x0 + w / 2, y0 + h - 0.024, 0.0098, "#1d3f7a", "gill", spacing=1.05)
    cv.text("Library Road stop", x0 + w / 2, y0 + h - 0.042, 0.0058, mute, "georgia_i")
    for k, (a, b) in enumerate((("07:45", "every 15 min"), ("10:00", "every 20 min"), ("16:00", "every 15 min"),
                                ("19:00", "every 30 min"), ("23:30", "last bus"))):
        y = y0 + h - 0.068 - k * 0.022
        cv.text(a, x0 + 0.014, y, 0.0068, ink, "gill", align="LEFT")
        cv.text(b, x0 + w - 0.014, y, 0.0058, mute, "gill", align="RIGHT")


NOTICES_MAP = (
    ((0.0, 0.0, 0.95, 0.66), (-0.165, 1.58), 0.0, 0.0, ((0.025, 0.965), (0.975, 0.965), (0.025, 0.035), (0.975, 0.035))),
    ((0.96, 0.50, 0.21, 0.15), (0.50, 1.86), 1.5, 0.0, ((0.5, 0.90),)),
    ((0.96, 0.25, 0.15, 0.21), (0.50, 1.52), -1.8, 0.004, ((0.5, 0.94),)),
)
NOTICES_MAP_ATLAS = (1.20, 0.66)


def _notice_image(variant):
    name = "TX_Lobby_Notices_Map" if variant == "map" else "TX_Lobby_Notices_Events"
    img = bpy.data.images.get(name)
    if img is not None:
        return img
    W, H = NOTICES_MAP_ATLAS if variant == "map" else NOTICES_EVENTS_ATLAS
    cv = Canvas(name, W, H, 2300, bg="#efe6d2")
    (_notice_map if variant == "map" else _notice_events)(cv)
    return cv.bake(name)


def build_noticeboard(item=None):
    """1.6 x 1.15 m walnut-framed cork noticeboard, back on y = 0, bottom edge at z = 1.0 (plan mount_y).
    item.label 'map' carries a pinned campus map; anything else the events notices."""
    variant = "map" if (item is not None and getattr(item, "label", "") == "map") else "events"
    key = "print_campus_map" if variant == "map" else "print_notices"
    _attach_image(key, _notice_image(variant))
    parts = []
    parts.append(_msweep("nb_frame", NB_FRAME, _rect_path(NB_CORK_HW, NB_CORK_HH, 0.0, NB_ZC, NB_CORK_Y), WOOD, True, (0, -1, 0), 40))
    parts.append(_bx("nb_cork", (-NB_CORK_HW - 0.002, NB_CORK_Y, NB_ZC - NB_CORK_HH - 0.002),
                     (NB_CORK_HW + 0.002, -0.002, NB_ZC + NB_CORK_HH + 0.002), "cork", 0.0, 1))
    # brass title plate on the top rail
    zp = NB_ZC + NB_CORK_HH + 0.0445
    plate = _slab("nb_plate", _rect(0.105, 0.0128), 0.003, [(0.0, 0.0), (0.0, 0.0011), (0.0008, 0.0017)], 2, BRASS)
    _xf(plate, _T(0, NB_CORK_Y - 0.033, zp) @ _Rx(90))
    parts.append(plate)
    t = _text3d("nb_plate_txt", "CAMPUS MAP" if variant == "map" else "NOTICES", 0.0185, 0.0005, "iron", font="bask",
                spacing=1.18, resolution=2)
    _xf(t, _T(0, NB_CORK_Y - 0.0347, zp) @ _Rx(90))
    parts.append(t)
    for sx in (-1, 1):
        sc = _turn("nb_screw", [(0.0035, 0.0), (0.0034, 0.0008), (0.0024, 0.0014), (0.0, 0.0016)], 10, BRASS_OLD, caps=(False, False))
        parts.append(_xf(sc, _T(sx * 0.095, NB_CORK_Y - 0.0347, zp) @ _Rx(90)))
    W, H = NOTICES_MAP_ATLAS if variant == "map" else NOTICES_EVENTS_ATLAS
    sheets = NOTICES_MAP if variant == "map" else NOTICES_EVENTS
    pins = [_pin(k) for k in ("pin_red", "pin_blue", "pin_yellow", "pin_green", "brass")]
    for k, ((ax, ay, w, h), (cx, cz), tilt, curl, pp) in enumerate(sheets):
        uv = (ax / W, ay / H, (ax + w) / W, (ay + h) / H)
        nx_, ny_ = (12, 9) if w > 0.5 else (5, 7)
        sh = _sheet("nb_sheet", w, h, uv, key, curl, nx_, ny_)
        yb = NB_CORK_Y - 0.0002 - 0.0005 * (k % 3)
        Ms = _T(cx, yb, cz) @ _Ry(tilt)
        parts.append(_xf(sh, Ms))
        for j, (u, v) in enumerate(pp):
            pn = _copy(pins[(k + j * 2) % (4 if variant == "events" else 5)])
            parts.append(_xf(pn, Ms @ _T(-w / 2 + w * u, -0.0006, -h / 2 + h * v) @ _Rx(90)))
    for p in pins:
        C.remove(p)
    return _join(parts, "Furniture_Noticeboard_Events_01" if variant == "events" else "Furniture_Noticeboard_Map_01")


# ---------------------------------------------------------------------------
# Registry and preview
# ---------------------------------------------------------------------------

KIND_BUILDERS = {
    "desk_info": build_desk_info,
    "directory_board": build_directory_board,
    "bench_lobby": build_bench_lobby,
    "coat_stand": build_coat_stand,
    "umbrella_stand": build_umbrella_stand,
    "noticeboard": build_noticeboard,
    "bins_pair": build_bins_pair,
}

ENGINE = os.environ.get("OVR_LOBBY_ENGINE", "EEVEE")


def _stage(objs, samples=48, size=(960, 960)):
    scene = bpy.context.scene
    R.engine(scene, ENGINE, samples if ENGINE == "EEVEE" else 40, size)
    if ENGINE == "EEVEE":
        try:
            scene.eevee.use_raytracing = False      # screen-space tracing streaks on curved brass in studio shots
        except AttributeError:
            pass
    lo, hi = R.bounds(objs)
    R.studio(scene, ((lo + hi) / 2).to_tuple(), max(0.5, (hi - lo).length / 2))
    return R.camera(lens=50)


def _person(x, y):
    """A 1.7 m stand-in figure for scale checks (preview only)."""
    m = bpy.data.materials.get("PreviewPerson") or bpy.data.materials.new("PreviewPerson")
    m.diffuse_color = (0.25, 0.32, 0.42, 1)
    m.use_nodes = True
    next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.25, 0.32, 0.42, 1)
    body = _turn("person", [(0.05, 0.0), (0.12, 0.02), (0.13, 0.8), (0.17, 1.05), (0.19, 1.38), (0.14, 1.45), (0.06, 1.5),
                            (0.055, 1.54)], 24, "plastic_dark")
    head = C.sphere("person_head", 0.1, (0, 0, 1.6), None, 24, 16)
    ob = _join([body, head], "PreviewPerson")
    ob.data.materials.clear()
    ob.data.materials.append(m)
    ob.location = (x, y, 0)
    return ob


def _render_set(fn, nm, item, views, closes, out_dir, tri, person=None):
    C.reset_scene()
    ob = fn(item)
    tri[ob.name] = C.tris(ob)
    print("DIMS", ob.name, tuple(round(v, 3) for v in ob.dimensions))
    lo = [min(v.co[i] for v in ob.data.vertices) for i in range(3)]
    hi = [max(v.co[i] for v in ob.data.vertices) for i in range(3)]
    print("BOUNDS", ob.name, [round(v, 3) for v in lo], [round(v, 3) for v in hi])
    if ob.get("light_points") is not None:
        print("LIGHTS", ob.name, [[round(c, 3) for c in p] for p in ob["light_points"]], list(ob["light_color"]))
    _stage([ob])
    _views([ob], out_dir, nm, views)
    for cname, tgt, yaw, pitch, dist in closes:
        _shot(os.path.join(out_dir, f"{nm}_{cname}.png"), tgt, yaw, pitch, dist, 50)
    if person is not None:
        pr = _person(*person)
        R.frame(R.camera(lens=50), [ob, pr], 18, 8)
        R.render(os.path.join(out_dir, f"{nm}_scale.png"))
    return ob


def preview_desk(out_dir, tri=None):
    tri = {} if tri is None else tri
    _render_set(build_desk_info, "desk", None, ((0, 8), (-32, 16), (160, 22)),
                [("front", (0.0, -0.48, 0.80), 0, 4, 1.25), ("lettering", (0.0, -0.50, 0.91), 0, 2, 0.75),
                 ("corner", (-0.78, -0.48, 0.70), -35, 10, 1.0), ("staff", (0.0, 0.1, 0.95), 180, 30, 2.0),
                 ("ledge", (0.0, -0.38, 1.12), -20, 28, 1.0)], out_dir, tri, person=(-2.0, -0.3))
    return tri


def preview_directory(out_dir, tri=None):
    tri = {} if tri is None else tri
    _render_set(build_directory_board, "directory", None, ((0, 6), (-35, 12), (150, 10)),
                [("face", (0.0, 0.0, 1.19), 0, 0, 1.5), ("map", (-0.12, 0.0, 1.22), 0, 0, 0.75),
                 ("crest", (0.0, 0.0, 1.82), -20, 8, 0.7), ("foot", (0.555, 0.0, 0.2), 35, 15, 0.8)],
                out_dir, tri, person=(-1.0, -0.4))
    return tri


def preview_notice(out_dir, tri=None):
    tri = {} if tri is None else tri
    for lab in ("events", "map"):
        it = P.Item("preview", "noticeboard", 0, 0, 0, "entrance", label=lab)
        _render_set(build_noticeboard, f"notice_{lab}", it, ((0, 0), (-35, 10)),
                    [("face", (0.0, 0.0, 1.575), 0, 0, 2.25), ("detail", (-0.3, 0.0, 1.70), -15, 6, 0.6),
                     ("plate", (0.0, -0.05, 2.10), 0, 8, 0.45)], out_dir, tri)
    return tri


def preview_small(out_dir, tri=None):
    tri = {} if tri is None else tri
    for fn, nm, views, closes in (
            (build_bench_lobby, "bench", ((28, 14), (-40, 24), (180, 10)),
             [("leg", (0.855, -0.205, 0.2), 25, 10, 0.75), ("cushion", (0.55, -0.2, 0.42), 30, 28, 0.6)]),
            (build_coat_stand, "coat_stand", ((20, 8), (160, 10), (-110, 14)),
             [("hooks", (0.0, 0.0, 1.55), 150, 18, 0.9), ("base", (0.0, 0.0, 0.3), 30, 18, 1.3)]),
            (build_umbrella_stand, "umbrella", ((20, 14), (-60, 26), (150, 10)),
             [("rim", (0.0, 0.0, 0.62), 15, 35, 0.75)]),
            (build_bins_pair, "bins", ((14, 10), (-38, 20), (160, 12)),
             [("label", (0.2, -0.17, 0.41), 6, 4, 0.55), ("lid", (-0.2, 0.0, 0.76), 25, 25, 0.6)])):
        _render_set(fn, nm, None, views, closes, out_dir, tri)
    return tri


def preview(out_dir):
    tri = {}
    preview_desk(out_dir, tri)
    preview_directory(out_dir, tri)
    preview_notice(out_dir, tri)
    preview_small(out_dir, tri)
    for k, v in tri.items():
        print(f"TRIS {k}: {v}")
