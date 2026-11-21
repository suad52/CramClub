"""
Windows, oculi and doors for the OVR library (see art/library/ASSETS.md).

Every piece drops into a hole the shell artist cuts from a `plan.Opening`:

  * the wall's INNER face is the plane y = 0, the room is on -Y, the exterior (or the far room)
    is on +Y, and `wall_thickness` is the wall depth (the far face is y = wall_thickness);
  * the opening's bottom-centre is the origin: x = 0 is the opening centre and z = 0 is the
    level its heights are measured from; the hole spans |x| <= width / 2;
  * each module lines the hole's cut faces with its own reveal (stone, plaster, timber or bronze
    linings whose visible face sits 20-30 mm inside the cut and which run 12 mm into the wall),
    so no cut face is ever seen and nothing z-fights with the shell.

Builders (all return ONE root object at the origin; door leaves are child objects whose origins
sit on their hinge axis, or on their centre for the lift's sliding leaves, so the web can swing
or slide them):

  build_window_arched(width, sill_h, spring, apex, wall_thickness)   hall window, limestone + iron
  build_oculus(diameter, wall_thickness)                              round window, iron rose
  build_window_tall(width, sill_h, apex, wall_thickness, finish)      timber arched window
  build_door(kind, width, height, ...)    door_glazed | door_single | door_double | exit | elevator
  build_for_opening(opening, wall)        builds whatever a plan.Opening asks for
  place_in_wall(ob, wall, opening, h)     puts it in the plan wall (web coordinates)
  preview(out_dir)                        studio renders + close-ups, prints triangle counts
"""

from __future__ import annotations

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

import lib_core as C
import lib_materials as M
from lib_core import box, box_minmax, roty, rotx
from lib_materials import mat, tex_size

# Palette keys this module needs and lib_materials.PALETTE lacks (reported to the palette owner;
# setdefault so a later official entry with the same key wins):
#   exit_green / exit_white  the illuminated EXIT sign face and its letters
#   oak_stained              dark fumed oak for the main entrance. The tint multiplies the honey
#                            oak texture (avg sRGB 176/129/80) in linear space; a cool grey-brown
#                            tint cancels its orange and lands on a deep, low-chroma brown (~#3c2819)
#                            that still shows oak's open grain and ray fleck.
#   bronze_satin             brushed statuary bronze for the lift (the flat "bronze" key has no
#                            texture and reads as dark plastic at this size)
PALETTE_ADDITIONS = {
    "exit_green": dict(base="#06592a", rough=0.3, emission="#00a347", emit=1.4),
    "exit_white": dict(base="#f2fff6", rough=0.3, emission="#f0fff4", emit=2.2),
    "oak_stained": dict(base="#3a2818", rough=0.4, tex="oak", size=0.8, normal=0.4, tint="#5c5660"),
    "bronze_satin": dict(base="#6f5234", rough=0.3, metal=1.0, tex="brushed", size=0.3, normal=0.22),
}
for _k, _v in PALETTE_ADDITIONS.items():
    if _k in M.PALETTE and M.PALETTE[_k] != _v:
        print(f"arch_windows: palette key {_k!r} is already defined in lib_materials; using the shared entry")
    M.PALETTE.setdefault(_k, _v)

LINER_E = 0.03        # stone / plaster reveal face, inset from the cut
LINER_EMBED = 0.012   # how far linings run into the wall behind the cut
FONT_SERIF = "/System/Library/Fonts/Supplemental/Times New Roman.ttf"
FONT_SANS = "/System/Library/Fonts/Supplemental/Arial Bold.ttf"


# ---------------------------------------------------------------------------
# Small geometry helpers (private: lib_core is shared and not mine to edit)
# ---------------------------------------------------------------------------

def _arc2(cx, cy, r, a0, a1, n):
    """Points on a 2D arc, angles in degrees, both ends included."""
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)),
             cy + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def _ogee(d0, p0, d1, p1, n=6, kind="recta"):
    """An S-curve between two profile points. 'recta' leaves both ends flat, 'reversa' steep."""
    pts = []
    for k in range(n + 1):
        t = k / n
        e = (1 - math.cos(math.pi * t)) / 2
        if kind == "recta":
            pts.append((d0 + (d1 - d0) * t, p0 + (p1 - p0) * e))
        else:
            pts.append((d0 + (d1 - d0) * e, p0 + (p1 - p0) * t))
    return pts


def _clean(pts, eps=1e-7):
    out = []
    for p in pts:
        p = (float(p[0]), float(p[1]))
        if not out or abs(p[0] - out[-1][0]) > eps or abs(p[1] - out[-1][1]) > eps:
            out.append(p)
    if len(out) > 2 and abs(out[0][0] - out[-1][0]) < eps and abs(out[0][1] - out[-1][1]) < eps:
        out.pop()
    return out


def _sweep(name, profile, path, key, closed_path=False, closed_profile=True, cap=True,
           up=(0, 0, 1), smooth=35.0, uv_size=None):
    """Profile sweep (same frame/mitre maths as lib_core.sweep) that also closes the profile and
    lays UVs out along the path, so wood grain and brushing follow every moulding and curve.

    The profile is [(u, v)]: v runs along `up`, and u points to `path_tangent x up`, i.e. INWARD
    for a loop that runs clockwise when seen from the tip of `up`."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    upv = Vector(up)
    frames = []
    for i in range(n):
        if closed_path:
            d0 = (pts[i] - pts[i - 1]).normalized()
            d1 = (pts[(i + 1) % n] - pts[i]).normalized()
        else:
            d0 = (pts[i] - pts[i - 1]).normalized() if i > 0 else (pts[1] - pts[0]).normalized()
            d1 = (pts[i + 1] - pts[i]).normalized() if i < n - 1 else d0
        t = d0 + d1
        t = t.normalized() if t.length > 1e-6 else d1
        s0 = upv.cross(d0)
        s0 = s0.normalized() if s0.length > 1e-9 else Vector((1, 0, 0))
        s = upv.cross(t)
        s = s.normalized() if s.length > 1e-9 else s0
        mit = 1.0 / max(0.2, s.dot(s0)) if (closed_path or 0 < i < n - 1) else 1.0
        frames.append((s * mit, t.cross(s).normalized()))
    L = [0.0]
    for i in range(1, n):
        L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    Ltot = L[-1] + ((pts[0] - pts[-1]).length if closed_path else 0.0)
    prof = [Vector((u, v)) for u, v in profile]
    m = len(prof)
    P = [0.0]
    for j in range(1, m):
        P.append(P[-1] + (prof[j] - prof[j - 1]).length)
    Ptot = P[-1] + ((prof[0] - prof[-1]).length if closed_profile else 0.0)
    size = uv_size or tex_size(key)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings = [[bm.verts.new(p - s * u + vv * v) for (u, v) in profile] for p, (s, vv) in zip(pts, frames)]
    seg_i = list(range(n - 1)) + ([n - 1] if closed_path else [])
    seg_j = list(range(m - 1)) + ([m - 1] if closed_profile else [])
    for i in seg_i:
        i2 = (i + 1) % n
        u0, u1 = L[i], (L[i + 1] if i + 1 < n else Ltot)
        for j in seg_j:
            j2 = (j + 1) % m
            v0, v1 = P[j], (P[j + 1] if j + 1 < m else Ptot)
            try:
                f = bm.faces.new((rings[i][j], rings[i2][j], rings[i2][j2], rings[i][j2]))
            except ValueError:
                continue
            for lp, (a, b) in zip(f.loops, ((u0, v0), (u1, v0), (u1, v1), (u0, v1))):
                lp[uvl].uv = (a / size, b / size)
    if cap and not closed_path:
        for ring in (rings[0], rings[-1]):
            try:
                f = bm.faces.new(ring)
            except ValueError:
                continue
            for lp, (u, v) in zip(f.loops, profile):
                lp[uvl].uv = (u / size, v / size)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, mat(key))
    C.shade_smooth(ob, smooth)
    return ob


def _extrude(name, outline, axis, a0, a1, key, bevel_w=0.0, segments=2, grain=None):
    """Prism of a closed 2D outline. axis 'y': outline is (x, z); 'x': (y, z); 'z': (x, y)."""
    def P(c, a):
        if axis == "y":
            return (c[0], a, c[1])
        if axis == "x":
            return (a, c[0], c[1])
        return (c[0], c[1], a)
    outline = _clean(outline)
    bm = bmesh.new()
    A = [bm.verts.new(P(c, a0)) for c in outline]
    B = [bm.verts.new(P(c, a1)) for c in outline]
    bm.faces.new(A)
    bm.faces.new(list(reversed(B)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((A[j], A[i], B[i], B[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, mat(key))
    if bevel_w > 0:
        C.bevel(ob, bevel_w, segments)
    else:
        C.shade_flat(ob)
    _uv(ob, key, grain)
    return ob


def _uv(ob, key, grain=None):
    uvs = ob.data.uv_layers
    if len(uvs) and uvs.active is None:
        uvs.active_index = 0
    C.uv_box(ob, tex_size(key), grain)
    return ob


def _box(name, lo, hi, key, bevel_w=0.003, segments=2, grain=None):
    ob = box_minmax(name, lo, hi, mat(key), bevel_w, segments)
    if grain == "auto":
        C.uv_grain_auto(ob, tex_size(key))
    else:
        _uv(ob, key, grain)
    return ob


def _mirror(ob, axis=0, center=0.0, name=None):
    """A mirrored copy (normals fixed). Only for meshes without custom normals (sweeps, prisms)."""
    me = ob.data.copy()
    S = Matrix.Identity(4)
    S[axis][axis] = -1.0
    S[axis][3] = 2.0 * center
    me.transform(S)
    me.flip_normals()
    me.update()
    new = bpy.data.objects.new(name or (ob.name + "_M"), me)
    C.link(new)
    return new


def _rot_y_about(ob, deg, cx, cz):
    """Rotates mesh data about the Y axis through (cx, cz) (right-hand rule: +Z turns toward +X)."""
    T = Matrix.Translation((cx, 0, cz)) @ Matrix.Rotation(math.radians(deg), 4, "Y") @ Matrix.Translation((-cx, 0, -cz))
    ob.data.transform(T)
    ob.data.update()
    return ob


def _bar_profile(w, d, c=0.003):
    """Chamfered rectangle (u across, v depth) centred on the path: glazing bars and rods."""
    hw, hd = w / 2, d / 2
    c = min(c, hw * 0.45, hd * 0.45)
    return [(-hw + c, -hd), (hw - c, -hd), (hw, -hd + c), (hw, hd - c),
            (hw - c, hd), (-hw + c, hd), (-hw, hd - c), (-hw, -hd + c)]


def _tbar_profile(w=0.04, d=0.05, stem=0.026):
    """Steel-window T section: a flange on the glass line, a narrower stem toward the room (+v)."""
    hw, hs, hd = w / 2, stem / 2, d / 2
    fl = -hd + 0.013
    return [(-hw, -hd), (hw, -hd), (hw, fl), (hs, fl), (hs, hd - 0.004), (hs - 0.004, hd),
            (-hs + 0.004, hd), (-hs, hd - 0.004), (-hs, fl), (-hw, fl)]


def _tbar_profile_lean(w=0.04, d=0.05, stem=0.026):
    """The same T section with square stem arrises (8 points): for long bent bars such as the
    oculus rose, where the 10-point section's chamfers cost 25% more triangles for no visible gain."""
    hw, hs, hd = w / 2, stem / 2, d / 2
    fl = -hd + 0.013
    return [(-hw, -hd), (hw, -hd), (hw, fl), (hs, fl), (hs, hd), (-hs, hd), (-hs, fl), (-hw, fl)]


def _tbar(name, length, center, axis, key="iron", w=0.04, d=0.05, stem=0.026, rot=None):
    """Straight T-section bar along local X (axis 'x') or Z ('z') at y = center[1] (glass line);
    `rot` (3x3) turns it in the XZ plane. Flange behind (+Y), stem toward the room (-Y)."""
    cx, cy, cz = center
    fd = 0.013
    if axis == "x":
        fs, ss = (length, fd, w), (length - 0.002, d - fd, stem)
    else:
        fs, ss = (w, fd, length), (stem, d - fd, length - 0.002)
    fl = box(name + "_F", fs, (0, d / 2 - fd / 2, 0), mat(key), 0.0015, 1, rot=rot)
    st = box(name + "_S", ss, (0, -fd / 2, 0), mat(key), 0.0035, 1, rot=rot)
    ob = C.join([fl, st], name)
    ob.data.transform(Matrix.Translation((cx, cy, cz)))
    ob.data.update()
    C.uv_grain_auto(ob, tex_size(key))
    return ob


def _round_profile(r, n=10):
    return [(r * math.cos(math.tau * k / n), r * math.sin(math.tau * k / n)) for k in range(n)]


def _returned(name, profile, x0, x1, y_wall, z, key, ret=0.012, smooth=35.0):
    """A horizontal moulding along a wall (profile u = projection from the wall toward -Y, v = height)
    running from x0 to x1, with both ends returned (mitred) back into the wall."""
    umax = max(u for u, _ in profile)
    path = [(x0 + umax, y_wall + ret, z), (x0 + umax, y_wall, z), (x1 - umax, y_wall, z), (x1 - umax, y_wall + ret, z)]
    return _sweep(name, profile, path, key, up=(0, 0, 1), smooth=smooth)


def _disc_y(name, radius, y0, y1, center_xz, key, segments=48, bevel_w=0.0):
    """A cylinder along Y (faces -Y and +Y)."""
    ob = C.cylinder(name, radius, radius, abs(y1 - y0), (center_xz[0], (y0 + y1) / 2, center_xz[1]),
                    mat(key), segments=segments, rot=rotx(90))
    if bevel_w > 0:
        C.bevel(ob, bevel_w, 2)
    _uv(ob, key)
    return ob


def _lathe_y(name, profile, center, key, segments=32, face=-1, caps=True):
    """Lathe whose axis points along -Y (face=-1, toward the room) or +Y (face=+1). The profile's z
    is the distance off the mounting face."""
    ob = C.lathe(name, profile, segments=segments, mat=mat(key), rot=rotx(90 if face < 0 else -90), center=center,
                 cap_top=caps, cap_bottom=caps)
    _uv(ob, key)
    return ob


def _font(path):
    if path and os.path.exists(path):
        try:
            return bpy.data.fonts.load(path, check_existing=True)
        except RuntimeError:
            return None
    return None


def _text(name, body, size, depth, key, center, face="-y", font=None, spacing=1.0):
    """Extruded lettering standing in the XZ plane, facing -Y (or +Y), bbox-centred on `center`."""
    cu = bpy.data.curves.new(name + "_curve", type="FONT")
    cu.body = body
    cu.size = size
    cu.extrude = depth / 2
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    cu.resolution_u = 2
    cu.space_character = spacing
    f = _font(font)
    if f:
        cu.font = f
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(deps))
    bpy.data.objects.remove(tmp, do_unlink=True)
    bpy.data.curves.remove(cu)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)     # weld caps to sides: closed letters
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    me.transform(Matrix.Rotation(math.radians(90), 4, "X"))
    if face == "+y":
        me.transform(Matrix.Rotation(math.pi, 4, "Z"))
    xs = [v.co.x for v in me.vertices]
    zs = [v.co.z for v in me.vertices]
    ys = [v.co.y for v in me.vertices]
    off = Vector(center) - Vector(((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, (min(zs) + max(zs)) / 2))
    me.transform(Matrix.Translation(off))
    me.name = name
    ob = bpy.data.objects.new(name, me)
    C.link(ob)
    me.materials.clear()
    me.materials.append(mat(key))
    C.shade_flat(ob)
    _uv(ob, key)
    return ob, (max(xs) - min(xs), max(zs) - min(zs))


def _set_pivot(ob, pivot):
    pivot = Vector(pivot)
    ob.data.transform(Matrix.Translation(-pivot))
    ob.data.update()
    ob.location = pivot
    return ob


def _parent(child, root):
    child.parent = root
    child.matrix_parent_inverse = Matrix.Identity(4)
    return child


def _total_tris(root):
    obs = [root] + list(root.children_recursive)
    return sum(C.tris(o) for o in obs if o.type == "MESH")


# ---------------------------------------------------------------------------
# Profiles. (d, p) = (distance outward from the opening edge, projection off the wall) for
# architraves, converted to sweep (u, v) = (-d, p) on clockwise opening paths with up = -Y.
# ---------------------------------------------------------------------------

def _prof_stone_architrave(w=0.30, p=0.10):
    """Two fasciae with a bead step, a cyma reversa and a back band (classical architrave)."""
    sx, sy = w / 0.30, p / 0.10
    pts = [(0.0, -0.002 / sy), (0.0, 0.034), (0.006, 0.040), (0.098, 0.040)]
    pts += _arc2(0.105, 0.040, 0.007, 180, 90, 3)
    pts += [(0.205, 0.047)]
    pts += _ogee(0.205, 0.047, 0.252, 0.084, 7, "reversa")
    pts += [(0.256, 0.084), (0.256, 0.090), (0.262, 0.100), (0.294, 0.100), (0.300, 0.094), (0.300, -0.002 / sy)]
    return [(-d * sx, v * sy) for d, v in _clean(pts)]


def _prof_impost(h=0.24, proj=0.175):
    """Impost block (u = projection, v = height): necking, astragal, ovolo and abacus."""
    sx, sy = proj / 0.175, h / 0.24
    pts = [(0.0, 0.0), (0.112, 0.0), (0.118, 0.006), (0.118, 0.040)]
    pts += _arc2(0.118, 0.052, 0.012, -90, 90, 6)
    pts += [(0.122, 0.070), (0.122, 0.104)]
    pts += _arc2(0.122, 0.150, 0.046, -90, 0, 6)
    pts += [(0.168, 0.158), (0.175, 0.165), (0.175, 0.233), (0.169, 0.240), (0.0, 0.240)]
    return [(u * sx, v * sy) for u, v in _clean(pts)]


def _prof_sill(proj=0.11):
    """Stone sill: rounded nosing, eased under-edge and a cove bed mould (v from the sill level)."""
    pts = [(0.0, 0.020), (proj - 0.018, 0.020)]
    pts += _arc2(proj - 0.018, 0.002, 0.018, 90, 0, 4)
    pts += [(proj, -0.050)]
    pts += _arc2(proj - 0.016, -0.050, 0.016, 0, -90, 3)
    pts += [(0.062, -0.066)]
    pts += _arc2(0.062, -0.118, 0.052, 90, 180, 6)
    pts += [(0.010, -0.126), (0.0, -0.126)]
    return _clean(pts)


def _prof_door_architrave(w=0.15, p=0.034):
    """Timber architrave: staff bead and quirk, a gently rising face, an ogee and a back band."""
    sx, sy = w / 0.15, p / 0.034
    pts = [(0.0, -0.002), (0.0, 0.010)]
    pts += _arc2(0.009, 0.010, 0.009, 180, 90, 4)
    pts += [(0.012, 0.019), (0.0135, 0.0155), (0.018, 0.0155), (0.098, 0.021)]
    pts += _ogee(0.098, 0.021, 0.121, 0.031, 6, "reversa")
    pts += [(0.123, 0.031), (0.123, 0.034), (0.146, 0.034), (0.150, 0.030), (0.150, -0.002)]
    return [(-d * sx, v * sy) for d, v in _clean(pts)]


def _prof_cornice(proj=0.09, h=0.10):
    """Small door-head cornice (u = projection, v = height): ovolo bed mould, corona, cyma recta."""
    sx, sy = proj / 0.09, h / 0.10
    pts = [(0.0, 0.0), (0.024, 0.0)]
    pts += _arc2(0.024, 0.016, 0.016, -90, 0, 4)
    pts += [(0.042, 0.020), (0.042, 0.025), (0.060, 0.027), (0.064, 0.031), (0.064, 0.058),
            (0.066, 0.058), (0.066, 0.064)]
    pts += _ogee(0.066, 0.064, 0.088, 0.092, 6, "recta")
    pts += [(0.090, 0.093), (0.090, 0.100), (0.0, 0.100)]
    return [(u * sx, v * sy) for u, v in _clean(pts)]


def _prof_panel_mould(w=0.018, h=0.012):
    """Sticking / glazing bead around a door panel (u inward from the cell edge, v off the panel)."""
    pts = [(0.0, -0.002), (0.0, h)]
    pts += _ogee(0.002, h, w, 0.0015, 6, "recta")
    pts += [(w + 0.002, 0.0), (w + 0.002, -0.002)]
    return _clean(pts)


def _prof_window_frame(face=0.065, depth=0.08):
    """Slim stepped metal frame section (u inward from the reveal, v toward the room)."""
    hd = depth / 2
    return [(-0.006, -hd), (face - 0.015, -hd), (face - 0.015, -0.012), (face, -0.012), (face, 0.016),
            (face - 0.004, 0.020), (0.032, 0.020), (0.028, 0.026), (0.028, hd), (-0.006, hd)]


def _prof_timber_frame(face=0.07, depth=0.09):
    """Timber window frame with a broad chamfer toward the room."""
    hd = depth / 2
    return [(-0.006, -hd), (face, -hd), (face, hd - 0.022), (face - 0.022, hd), (-0.006, hd)]


# ---------------------------------------------------------------------------
# Arches
# ---------------------------------------------------------------------------

def _arch_circle(hw, spring, apex):
    """Centre height and radius of the head through (+-hw, spring) and (0, apex)."""
    rise = apex - spring
    if rise <= 1e-4:
        return spring, 1e6
    if abs(rise - hw) < 1e-4:
        return spring, hw
    r = (hw * hw + rise * rise) / (2 * rise)
    return apex - r, r


def _arc_span(a, cz, r):
    """Angles (deg) where the circle (0, cz, r) meets the jamb lines x = -a and x = +a, and that z."""
    zm = cz + math.sqrt(max(r * r - a * a, 0.0))
    ang = math.degrees(math.atan2(zm - cz, a))
    return 180.0 - ang, ang, zm


def _arch_path(a, z0, cz, r, y=0.0, steps=36, z_end=None):
    """Clockwise (seen from the room): up the left jamb, over the head, down the right jamb."""
    aL, aR, zm = _arc_span(a, cz, r)
    pts = [(-a, y, z0)]
    for k in range(steps + 1):
        ang = math.radians(aL + (aR - aL) * k / steps)
        pts.append((r * math.cos(ang), y, cz + r * math.sin(ang)))
    pts.append((a, y, z0 if z_end is None else z_end))
    return _dedupe3(pts)


def _arc_only(a, cz, r, y=0.0, steps=36, drop=0.0):
    """Just the head arc, left springing to right springing (optionally dropped `drop` below)."""
    aL, aR, zm = _arc_span(a, cz, r)
    pts = [(-a, y, zm - drop)] if drop > 0 else []
    for k in range(steps + 1):
        ang = math.radians(aL + (aR - aL) * k / steps)
        pts.append((r * math.cos(ang), y, cz + r * math.sin(ang)))
    if drop > 0:
        pts.append((a, y, zm - drop))
    return _dedupe3(pts)


def _dedupe3(pts, eps=1e-6):
    out = []
    for p in pts:
        if not out or (Vector(p) - Vector(out[-1])).length > eps:
            out.append(tuple(p))
    return out


def _arch_outline2(a, z0, cz, r, steps=36):
    """Closed (x, z) outline of an arched opening (for glass and cutters)."""
    return [(p[0], p[2]) for p in _arch_path(a, z0, cz, r, 0.0, steps)]


def _glass_face(name, outline_xz, y, key="glass_window"):
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, z)) for x, z in _clean(outline_xz)]
    bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, mat(key))
    C.shade_flat(ob)
    _uv(ob, key)
    return ob


def _radial_bar(name, cx, cz, theta, r0, r1, w, d, y, key, c=0.0025, tee=False):
    """A straight bar along the ray at `theta` (deg, from +X toward +Z) from radius r0 to r1."""
    th = math.radians(theta)
    rm = (r0 + r1) / 2
    if tee:
        return _tbar(name, r1 - r0, (cx + rm * math.cos(th), y, cz + rm * math.sin(th)), "x", key, w, d, rot=roty(-theta))
    ob = box(name, (r1 - r0, d, w), (cx + rm * math.cos(th), y, cz + rm * math.sin(th)), mat(key),
             bevel_w=c, segments=1, rot=roty(-theta))
    C.uv_grain_auto(ob, tex_size(key))
    return ob


def _arc_steps(r, a0, a1, seg=0.014, max_deg=4.5, cap=150):
    """Segments for an arc so chords stay short (<= `seg`) and turns small (<= `max_deg`)."""
    span = abs(a1 - a0)
    n = max(math.ceil(span / max_deg), math.ceil(math.radians(span) * r / seg))
    return int(max(6, min(n, cap)))


def _arc_bar(name, cx, cz, r, a0, a1, w, d, y, key, steps=None, drop=0.0, closed=False, tee=False, seg=0.014,
            lean=False):
    """A glazing bar bent on a circle (angles in degrees). Steps come from the arc length unless
    given; flat faces stay flat (sharp profile corners), only the segment joints are smoothed."""
    pts = []
    if drop > 0:
        pts.append((cx + r * math.cos(math.radians(a0)), y, cz + r * math.sin(math.radians(a0)) - drop))
    n = steps or _arc_steps(r, a0, a1, seg)
    for k in range(n + (0 if closed else 1)):
        ang = math.radians(a0 + (a1 - a0) * k / n)
        pts.append((cx + r * math.cos(ang), y, cz + r * math.sin(ang)))
    if drop > 0:
        pts.append((cx + r * math.cos(math.radians(a1)), y, cz + r * math.sin(math.radians(a1)) - drop))
    prof = (_tbar_profile_lean(w, d) if lean else _tbar_profile(w, d)) if tee else _bar_profile(w, d, 0.0025)
    return _sweep(name, prof, pts, key, closed_path=closed, up=(0, -1, 0), smooth=28)


def _loft(name, rings, key, cap0=True, cap1=True, closed=True):
    """Skins a list of equal-length 3D rings (cross-sections) into a solid, capping both ends."""
    bm = bmesh.new()
    V = [[bm.verts.new(p) for p in ring] for ring in rings]
    m = len(rings[0])
    seg = range(m) if closed else range(m - 1)
    for a, b in zip(V, V[1:]):
        for j in seg:
            j2 = (j + 1) % m
            try:
                bm.faces.new((a[j], a[j2], b[j2], b[j]))
            except ValueError:
                pass
    for flag, ring in ((cap0, V[0]), (cap1, V[-1])):
        if flag:
            try:
                bm.faces.new(ring)
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return C.mesh_from_bmesh(name, bm, mat(key))


def _rosette(name, center, normal, up, R, h, key, petals=8, seg=32, base=-0.003):
    """A carved rosette (patera): a domed boss in a ring of `petals` scalloped, ridged petals,
    seated on a surface through `center` with outward `normal` (`up` fixes the petal phase)."""
    n = Vector(normal).normalized()
    u = (Vector(up) - n * Vector(up).dot(n)).normalized()
    w = n.cross(u)
    qs = [0.0, 0.13, 0.26, 0.31, 0.43, 0.6, 0.78, 0.92, 1.0]

    def height(q, ph):
        if q <= 0.26:
            return h * (0.55 + 0.45 * math.sqrt(max(0.0, 1 - (q / 0.26) ** 2)))
        t = (q - 0.31) / 0.69
        if t < 0:
            return h * 0.42                        # the groove round the boss
        ridge = 0.62 + 0.38 * math.cos(petals * ph)
        return h * 0.78 * math.sin(math.pi * min(1.0, t) * 0.92 + 0.12) ** 0.8 * ridge

    bm = bmesh.new()
    c = Vector(center)
    tip = bm.verts.new(c + n * height(0.0, 0.0))
    rings = []
    for q in qs[1:]:
        ring = []
        for k in range(seg):
            ph = math.tau * k / seg
            edge = R * (0.8 + 0.2 * abs(math.cos(petals * ph / 2)) ** 0.7)
            rr = q * (edge if q > 0.3 else R)
            ring.append(bm.verts.new(c + (u * math.cos(ph) + w * math.sin(ph)) * rr + n * height(q, ph)))
        rings.append(ring)
    skirt = [bm.verts.new(c + (v.co - c) - n * ((v.co - c).dot(n)) + n * base) for v in rings[-1]]
    rings.append(skirt)
    for k in range(seg):
        bm.faces.new((tip, rings[0][k], rings[0][(k + 1) % seg]))
    for a, b in zip(rings, rings[1:]):
        for k in range(seg):
            k2 = (k + 1) % seg
            bm.faces.new((a[k], b[k], b[k2], a[k2]))
    bm.faces.new(list(reversed(skirt)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, mat(key))
    C.shade_smooth(ob, 50)
    _uv(ob, key)
    return ob


def _keystone(prefix, r_in, r_top, hw_b, hw_t, d_b, d_t, key, center=(0.0, 0.0), angle=90.0, drop=0.03,
              cap=True, panel=True, scrolls=False, rosette=False, lean="s", cap_h=0.075, back=0.002):
    """A carved keystone on the circle of radius r_in about `center` (x, z), pointing at `angle`
    degrees. Its foot hangs `drop` below the intrados and its top is at radius r_top. The flanks
    taper from hw_b to hw_t; the face leans out from d_b to d_t, along an S (console roll, lean="s")
    or straight ("linear"). Options: a moulded cap, a raised face panel, C-scrolls with bosses on
    the flanks and a carved rosette on the panel. Built standing on its foot, then turned."""
    H = r_top - (r_in - drop)
    zc = H - cap_h if cap else H
    parts = []

    def hw(z):
        return hw_b + (hw_t - hw_b) * min(z, zc) / zc

    def d(z):
        f = max(0.0, min(1.0, z / zc))
        s_ = f * f * (3 - 2 * f) if lean == "s" else f
        return d_b + (d_t - d_b) * s_

    def dd(z):          # d'(z)
        f = max(0.0, min(1.0, z / zc))
        return (d_t - d_b) * ((6 * f - 6 * f * f) if lean == "s" else 1.0) / zc

    nz = 16 if lean == "s" else 3
    zs = [zc * k / nz for k in range(nz + 1)] + ([zc + (H - zc) * 0.5, H] if cap else [])
    body = _loft(prefix + "_Key", [[(-hw(z), back, z), (-hw(z), -d(z), z), (hw(z), -d(z), z), (hw(z), back, z)]
                                   for z in zs], key)
    C.bevel(body, 0.005, 3)
    _uv(body, key)
    parts.append(body)
    if panel:
        zp0 = 0.05 * zc + (drop if lean == "s" else 0.0)
        zp1 = zc - (0.055 if cap else 0.045)
        zps = [zp0 + (zp1 - zp0) * k / nz for k in range(nz + 1)]
        ins = 0.032 if hw_b > 0.13 else 0.026
        pan = _loft(prefix + "_KeyPanel", [[(-(hw(z) - ins), -(d(z) - 0.004), z), (-(hw(z) - ins), -(d(z) + 0.011), z),
                                            ((hw(z) - ins), -(d(z) + 0.011), z), ((hw(z) - ins), -(d(z) - 0.004), z)]
                                           for z in zps], key)
        C.bevel(pan, 0.0035, 2)
        _uv(pan, key)
        parts.append(pan)
        if rosette:
            zr = zp0 + (zp1 - zp0) * 0.56
            nrm = Vector((0.0, -1.0, -dd(zr))).normalized()
            rr = min(0.07, hw(zr) - ins - 0.022)
            parts.append(_rosette(prefix + "_KeyRosette", (0.0, -(d(zr) + 0.011), zr), nrm, (0, 0, 1), rr, 0.022, key))
    if cap:
        hwc, dc = hw(zc) - 0.0015, d_t - 0.0015
        prof = [(-0.003, 0.0), (0.006, 0.0), (0.008, 0.004)] + _ogee(0.008, 0.006, 0.026, 0.038, 5, "recta") + \
               [(0.029, 0.041), (0.029, 0.045), (0.032, 0.048), (0.032, cap_h - 0.004), (0.029, cap_h), (-0.003, cap_h)]
        path = [(-hwc, 0.004, zc), (-hwc, -dc, zc), (hwc, -dc, zc), (hwc, 0.004, zc)]
        parts.append(_sweep(prefix + "_KeyCap", _clean(prof), path, key, up=(0, 0, 1), smooth=30))
    if scrolls:
        # C-scroll on each flank: a small curl at the foot, a bead up the leading edge, a big
        # curl under the cap round a boss.  (w, z): w = depth toward the room.
        inset = 0.02
        R0t, R1t, turn_t = 0.042, 0.015, 450.0
        R0b, R1b, turn_b = 0.024, 0.01, 400.0
        zT = zc - 0.066
        zB = 0.036
        wT = d(zT) - inset - R0t
        wB = d(zB) - inset - R0b

        def spiral(wc, zc_, R0, R1, turn, sgn, n):
            return [(wc + R0 * (R1 / R0) ** (k / n) * math.cos(math.radians(sgn * turn * k / n)),
                     zc_ + R0 * (R1 / R0) ** (k / n) * math.sin(math.radians(sgn * turn * k / n))) for k in range(n + 1)]

        bot = spiral(wB, zB, R0b, R1b, turn_b, -1, 26)
        top = spiral(wT, zT, R0t, R1t, turn_t, 1, 38)
        z0c, z1c = bot[0][1], top[0][1]
        conn = [(d(z) - inset, z) for z in (z0c + (z1c - z0c) * k / 10 for k in range(1, 10))]
        curve = list(reversed(bot)) + conn + top
        bead = [(-0.0065, -0.002), (-0.0065, 0.003), (0.0, 0.0082), (0.0065, 0.003), (0.0065, -0.002)]
        for sx in (-1, 1):
            path = [(sx * (hw(z) - 0.0015), -w_, z) for w_, z in curve]
            parts.append(_sweep(f"{prefix}_KeyScroll{sx}", bead, path, key, up=(sx, 0, 0), smooth=40))
            for (wc, zc_, rad) in ((wT, zT, R1t + 0.006), (wB, zB, R1b + 0.004)):
                boss = [(0.0, 0.0), (rad, 0.0), (rad, 0.004), (rad * 0.7, 0.0085), (0.0, 0.0105)]
                ob = C.lathe(f"{prefix}_KeyEye{sx}", boss, segments=12, mat=mat(key), rot=roty(90 * sx),
                             center=(sx * (hw(zc_) - 0.002), -wc, zc_))
                _uv(ob, key)
                parts.append(ob)
    ob = C.join(parts, prefix + "_Keystone")
    ob.data.transform(Matrix.Translation((0, 0, r_in - drop)))
    ob.data.transform(Matrix.Rotation(math.radians(90 - angle), 4, "Y"))
    ob.data.transform(Matrix.Translation((center[0], 0, center[1])))
    ob.data.update()
    return ob


def _stone_surround(prefix, a, z_bot, cz, r, y_stop, W_a=0.30, P_a=0.10, imp_h=0.24, imp_proj=0.175,
                    steps=40, plinth_h=0.0, key_top=None):
    """Interior-face stonework round an arched opening whose reveal face is x = +-a: jamb
    architraves (from z_bot, or from plinth blocks), moulded imposts at the springing, the
    archivolt and a carved console keystone (its top at height `key_top` if given, e.g. to run
    up into an entablature, else 0.12 above the archivolt).

    Each impost wraps the reveal arris as a corner block (it runs 20 mm into the reveal and then
    returns, mitred, into the reveal face); beyond it a plain 20 mm abacus band carries the
    springline on through the reveal and stops, also returned, 50 mm short of the window frame
    (whose front face is at about y_stop)."""
    parts = []
    aL, aR, zm = _arc_span(a, cz, r)
    prof = _prof_stone_architrave(W_a, P_a)
    zj0 = z_bot
    if plinth_h > 0:
        for sx in (-1, 1):
            lo = (min(sx * a, sx * (a + W_a + 0.025)), -(P_a + 0.022), 0.0)
            hi = (max(sx * a, sx * (a + W_a + 0.025)), 0.002, plinth_h)
            parts.append(_box(f"{prefix}_Plinth{sx}", lo, hi, "limestone_plain", 0.006, 2))
        zj0 = plinth_h - 0.003
    zi = zm - imp_h
    parts.append(_sweep(prefix + "_JambL", prof, [(-a, 0, zj0), (-a, 0, zi + 0.003)], "limestone_plain", up=(0, -1, 0)))
    parts.append(_sweep(prefix + "_JambR", prof, [(a, 0, zi + 0.003), (a, 0, zj0)], "limestone_plain", up=(0, -1, 0)))
    iprof = _prof_impost(imp_h, imp_proj)
    umax = max(u for u, _ in iprof)
    E = a + W_a + 0.05
    y_ret = 0.02
    xr = -a - 0.002
    ipath = [(-E + umax, 0.014, zi), (-E + umax, 0.002, zi), (xr, 0.002, zi), (xr, y_ret, zi), (xr - 0.014, y_ret, zi)]
    impL = _sweep(prefix + "_ImpostL", iprof, ipath, "limestone_plain", up=(0, 0, 1))
    # the abacus carried on through the reveal as a shallow band
    hb = imp_h * (0.24 - 0.165) / 0.24
    bp = 0.02
    band = [(-0.003, 0.0), (bp - 0.004, 0.0), (bp, 0.004), (bp, hb - 0.004), (bp - 0.004, hb), (-0.003, hb)]
    y_b1 = y_stop - 0.05 - bp
    bandL = None
    if y_b1 > y_ret + umax + 0.03:
        bandL = _sweep(prefix + "_ImpostBandL", band, [(xr, y_ret + umax - 0.012, zi + imp_h - hb), (xr, y_b1, zi + imp_h - hb),
                                                       (xr - 0.012, y_b1, zi + imp_h - hb)], "limestone_plain", up=(0, 0, 1))
    for ob in (impL, bandL):
        if ob is not None:
            parts += [ob, _mirror(ob, 0, 0.0, ob.name[:-1] + "R")]
    arch = [(-a, 0, zm - 0.003)] + _arc_only(a, cz, r, 0.0, steps) + [(a, 0, zm - 0.003)]
    parts.append(_sweep(prefix + "_Archivolt", prof, _dedupe3(arch), "limestone_plain", up=(0, -1, 0)))
    r_top = (key_top - cz) if key_top is not None else r + W_a + 0.12
    parts.append(_keystone(prefix, r, r_top, 0.17, 0.25, P_a + 0.04, P_a + 0.125, "limestone_plain",
                           center=(0.0, cz), angle=90.0, drop=0.05, cap=True, panel=True, scrolls=True, rosette=True))
    return parts


def _liner(name, a, z0, cz, r, y0, y1, key, steps=40, z_end=None):
    """Reveal lining of an arched opening: its face is the plane/cylinder at x = +-a / radius r."""
    prof = [(0.0, -y0), (0.0, -y1), (-(LINER_E + LINER_EMBED), -y1), (-(LINER_E + LINER_EMBED), -y0)]
    ob = _sweep(name, prof, _arch_path(a, z0, cz, r, 0.0, steps, z_end), key, up=(0, -1, 0), smooth=40)
    _uv(ob, key)
    return ob


# ---------------------------------------------------------------------------
# Windows
# ---------------------------------------------------------------------------

def build_window_arched(width=3.2, sill_h=0.0, spring=2.6, apex=4.2, wall_thickness=0.8,
                        name="Architecture_Window_Arched_01", cols=6, rows=5, keystone_top=None):
    """The hall's monumental arched window: limestone architrave, imposts, keystone, a deep stone
    reveal and sill, and a slim blackened-iron window whose head bars follow the arch.
    `keystone_top` (local height, same datum as sill_h) runs the console keystone up to that level,
    e.g. 30 mm into the hall entablature; by default it stops 0.12 m above the archivolt."""
    T = wall_thickness
    hw = width / 2
    s = sill_h
    cz, r0 = _arch_circle(hw, spring, apex)
    a = hw - LINER_E
    r = r0 - LINER_E
    y_w = T - 0.20                      # glass plane
    parts = []
    # --- reveal, sills ------------------------------------------------------------------------
    parts.append(_liner(name + "_Reveal", a, s - 0.06, cz, r, 0.002, T, "limestone"))
    W_a = 0.34
    E = a + W_a + 0.05
    parts.append(_returned(name + "_Sill", _prof_sill(0.11), -E, E, 0.012, s, "limestone_plain"))
    parts.append(_box(name + "_SillReveal", (-a - 0.005, 0.012, s - 0.07), (a + 0.005, y_w - 0.04, s + 0.02),
                      "limestone_plain", 0.003, 1))
    ext = [(y_w - 0.04, s + 0.012), (T + 0.05, s - 0.012), (T + 0.05, s - 0.05), (T + 0.03, s - 0.05),
           (T + 0.03, s - 0.065), (y_w - 0.04, s - 0.065)]
    parts.append(_extrude(name + "_SillExt", ext, "x", -a - 0.005, a + 0.005, "limestone_plain", 0.003, 1))
    # --- interior stonework -------------------------------------------------------------------
    parts += _stone_surround(name, a, s + 0.017, cz, r, y_w - 0.045, W_a=W_a, P_a=0.11, key_top=keystone_top)
    stone = C.join(parts, name)
    # --- iron window --------------------------------------------------------------------------
    iron = []
    fw = 0.075
    zb = s + 0.015
    frame_path = _arch_path(a, zb, cz, r, y_w, 64)
    iron.append(_sweep(name + "_Frame", _prof_window_frame(fw, 0.08),
                       [(x, y, z) for x, y, z in frame_path], "iron", closed_path=True, up=(0, -1, 0), smooth=40))
    ai = a - fw                     # inner face of the frame
    ri = r - fw
    aL, aR, zm = _arc_span(a, cz, r)
    bw, bd = 0.04, 0.05
    z_in0 = zb + fw
    z_sp = zm
    # spring transom (heavier) and the rectangular grid of T-bars below it
    iron.append(box(name + "_Spring", (2 * ai + 0.02, 0.064, 0.058), (0, y_w, z_sp), mat("iron"), 0.004, 1))
    iron.append(box(name + "_SpringFillet", (2 * ai + 0.02, 0.01, 0.03), (0, y_w - 0.036, z_sp), mat("iron"), 0.003, 1))
    for k in range(1, cols):
        x = -ai + 2 * ai * k / cols
        iron.append(_tbar(f"{name}_Mullion{k}", z_sp - z_in0 + 0.01, (x, y_w, (z_sp + z_in0) / 2 - 0.005), "z", "iron", bw, bd))
    for k in range(1, rows):
        z = z_in0 + (z_sp - 0.029 - z_in0) * k / rows
        iron.append(_tbar(f"{name}_Transom{k}", 2 * ai + 0.02, (0, y_w, z), "x", "iron", bw, bd))
    # head: hub, a concentric ring and radial bars (fan), all on the arch centre
    rh, rm = 0.26 * ri / 1.5, 0.86 * ri / 1.5
    iron.append(_arc_bar(name + "_Hub", 0, cz, rh, 0, 180, bw, bd, y_w, "iron", drop=0.024, tee=True))
    iron.append(_arc_bar(name + "_Ring", 0, cz, rm, 0, 180, bw, bd, y_w, "iron", drop=0.024, tee=True, seg=0.022))
    for th in (30, 60, 90, 120, 150):
        iron.append(_radial_bar(f"{name}_RayIn{th}", 0, cz, th, rh, rm, bw, bd, y_w, "iron", tee=True))
    n_out = 10
    for k in range(1, n_out):
        th = 180.0 * k / n_out
        iron.append(_radial_bar(f"{name}_RayOut{k}", 0, cz, th, rm, ri + 0.012, bw, bd, y_w, "iron", tee=True))
    for ob in iron:
        if not ob.data.uv_layers:
            _uv(ob, "iron")
    iron_ob = C.join(iron, name + "_Iron")
    glass = _glass_face(name + "_Glass", _arch_outline2(a - 0.03, zb + 0.02, cz, r - 0.03, 64), y_w)
    ob = C.join([stone, iron_ob, glass], name)
    return ob


def build_oculus(diameter=2.4, wall_thickness=0.8, name="Architecture_Oculus_01", petals=12):
    """Round window: moulded limestone ring with a capped console keystone (raised panel, carved
    rosette) at the crown, stone reveal, and an iron rose (hub, inner ring, radial spokes and
    round-headed petals, all the same 40 x 50 mm T-section, finely segmented) with glass.
    Bottom of the circle at the origin, centre at z = diameter / 2."""
    T = wall_thickness
    R = diameter / 2
    zc = R
    a = R - LINER_E
    y_w = T - 0.20
    seg = 64
    parts = []
    circ = [(a * math.cos(math.radians(180 - 360 * k / seg)), 0.0, zc + a * math.sin(math.radians(180 - 360 * k / seg)))
            for k in range(seg)]
    lprof = [(0.0, -0.002), (0.0, -T), (-(LINER_E + LINER_EMBED), -T), (-(LINER_E + LINER_EMBED), -0.002)]
    parts.append(_sweep(name + "_Reveal", lprof, circ, "limestone", closed_path=True, up=(0, -1, 0), smooth=40))
    W_a = 0.24 * diameter / 2.4
    P_a = 0.09
    parts.append(_sweep(name + "_Surround", _prof_stone_architrave(W_a, P_a), circ, "limestone_plain",
                        closed_path=True, up=(0, -1, 0), smooth=40))
    # One bold console keystone at the crown (as on the rotunda oculi of Ref 3 and Ref 5); the plain
    # side and foot voussoirs of v1 read as boxes stuck on the ring and are gone.
    parts.append(_keystone(f"{name}_K90", a, a + W_a + 0.13, 0.115, 0.165, P_a + 0.022, P_a + 0.075,
                           "limestone_plain", center=(0.0, zc), angle=90, drop=0.02, cap=True, panel=True,
                           rosette=True, lean="s", cap_h=0.065))
    stone = C.join(parts, name)
    # --- iron rose ---------------------------------------------------------------------------
    iron = []
    fw = 0.06
    ring_f = [(x, y_w, z) for x, _, z in circ]
    iron.append(_sweep(name + "_Frame", _prof_window_frame(fw, 0.08), ring_f, "iron", closed_path=True,
                       up=(0, -1, 0), smooth=40))
    rf = a - fw
    bw, bd = 0.036, 0.05
    rh, rm = 0.2 * rf / 1.11, 0.6 * rf / 1.11
    # curved iron is the same T-section as the spokes, segmented finely enough (<= 12 mm chords on
    # the hub, 150 steps on the ring) that it reads as one bent bar, not a faceted tube
    iron.append(_arc_bar(name + "_Hub", 0, zc, rh, 0, 360, bw, bd, y_w, "iron", None, closed=True, tee=True, seg=0.013,
                         lean=True))
    iron.append(_arc_bar(name + "_Ring", 0, zc, rm, 0, 360, bw, bd, y_w, "iron", 128, closed=True, tee=True, lean=True))
    step = 360.0 / petals
    for k in range(petals):
        th = 90 + step * k
        iron.append(_radial_bar(f"{name}_Spoke{k}", 0, zc, th, rm, rf + 0.01, bw, bd, y_w, "iron", tee=True))
        if k % 2 == 0:
            iron.append(_radial_bar(f"{name}_SpokeIn{k}", 0, zc, th, rh, rm, bw, bd, y_w, "iron", tee=True))
    # round-headed petals between the outer spokes
    half = math.radians(step / 2)
    apex = rm + (rf - rm) * 0.72
    rs = apex / (math.cos(half) + math.sin(half))
    rp, dc = rs * math.sin(half), rs * math.cos(half)
    for k in range(petals):
        am = 90 + step * k + step / 2
        cx, cz_ = dc * math.cos(math.radians(am)), zc + dc * math.sin(math.radians(am))
        iron.append(_arc_bar(f"{name}_Petal{k}", cx, cz_, rp, am - 90, am + 90, bw, bd, y_w, "iron", 40, tee=True, lean=True))
    for ob in iron:
        if not ob.data.uv_layers:
            _uv(ob, "iron")
    iron_ob = C.join(iron, name + "_Iron")
    gl = [(math.cos(math.tau * k / seg) * (a - 0.03), zc + math.sin(math.tau * k / seg) * (a - 0.03)) for k in range(seg)]
    glass = _glass_face(name + "_Glass", gl, y_w)
    return C.join([stone, iron_ob, glass], name)


def build_window_tall(width=1.5, sill_h=0.9, apex=3.5, wall_thickness=0.8, finish="ivory", spring=None,
                      name="Architecture_Window_Tall_01"):
    """Arched timber window for the wings and the lounge: plaster reveal and trim, a timber window
    board and apron, a pair of glazed casements under a fanlight with radial bars, brass fittings.
    `finish` is "ivory" (painted) or "walnut". z = 0 is the floor; the opening spans sill_h..apex."""
    T = wall_thickness
    hw = width / 2
    s = sill_h
    spring = apex - hw if spring is None else spring
    cz, r0 = _arch_circle(hw, spring, apex)
    e = 0.02
    a, r = hw - e, r0 - e
    wood = "ivory_paint" if finish == "ivory" else "walnut"
    y_w = T - 0.20
    parts = []
    lprof = [(0.0, -0.002), (0.0, -T), (-(e + LINER_EMBED), -T), (-(e + LINER_EMBED), -0.002)]
    parts.append(_sweep(name + "_Reveal", lprof, _arch_path(a, s - 0.05, cz, r, 0.0, 32), "plaster", up=(0, -1, 0), smooth=40))
    W_t = 0.10
    trim = _prof_door_architrave(W_t, 0.026)
    zt = s + 0.012
    parts.append(_sweep(name + "_Trim", trim, _arch_path(a, zt, cz, r, 0.0, 36), "plaster", up=(0, -1, 0)))
    plaster = C.join(parts, name + "_Plaster")
    # --- window board and apron -------------------------------------------------------------------
    wparts = []
    E = a + W_t + 0.035
    bt = s + 0.015
    board = [(-E, -0.035), (E, -0.035), (E, 0.01), (a + 0.004, 0.01), (a + 0.004, y_w - 0.045),
             (-a - 0.004, y_w - 0.045), (-a - 0.004, 0.01), (-E, 0.01)]
    wparts.append(_extrude(name + "_Board", board, "z", bt - 0.032, bt, wood, 0.007, 3, grain="x"))
    ap = [(0.0, 0.0), (0.010, 0.0), (0.016, 0.006), (0.016, 0.046)] + _ogee(0.016, 0.046, 0.022, 0.066, 4, "reversa") + \
         [(0.022, 0.072), (0.0, 0.072)]
    wparts.append(_returned(name + "_Apron", _clean(ap), -(a + W_t - 0.01), a + W_t - 0.01, 0.0, bt - 0.032 - 0.069, wood))
    # --- frame, casements, fanlight -----------------------------------------------------------------
    fw = 0.07
    zb = s + 0.012
    wparts.append(_sweep(name + "_Frame", _prof_timber_frame(fw, 0.09), _arch_path(a, zb, cz, r, y_w, 40), wood,
                         closed_path=True, up=(0, -1, 0), smooth=40))
    aL, aR, zm = _arc_span(a, cz, r)
    ai = a - fw
    th = 0.07
    wparts.append(_box(name + "_Transom", (-ai - 0.006, y_w - 0.045, zm - th / 2), (ai + 0.006, y_w + 0.045, zm + th / 2),
                       wood, 0.004, 2, "x"))
    # Casements (and, on tall openings, fixed upper lights over a second transom). Panes are sized
    # from the leaf: 2 across (3 on wide leaves), about 1.45 times as tall as wide.
    cs, cr, cb = 0.055, 0.055, 0.075
    cy0, cy1 = y_w - 0.022, y_w + 0.034
    bar_w, bar_d = 0.022, 0.034
    c0, c1 = zb + fw, zm - th / 2
    tiers = [(c0, c1, True)]
    if c1 - c0 > 2.6:
        zt2 = s + 2.3
        wparts.append(_box(name + "_Transom2", (-ai - 0.006, y_w - 0.045, zt2 - th / 2), (ai + 0.006, y_w + 0.045, zt2 + th / 2),
                           wood, 0.004, 2, "x"))
        tiers = [(c0, zt2 - th / 2, True), (zt2 + th / 2, c1, False)]
    glass_w = ai - 0.002 - 2 * cs
    n_across = 3 if glass_w > 0.62 else 2
    pane_h = glass_w / n_across * 1.45
    for ti, (t0, t1, opening) in enumerate(tiers):
        rows = max(3 if opening else 2, round((t1 - t0 - cb - cr) / pane_h))
        for side in (-1, 1):
            x_out, x_in = side * ai, side * 0.002
            xa, xb = min(x_out, x_in), max(x_out, x_in)
            tg = f"{name}_C{ti}{'L' if side < 0 else 'R'}"
            wparts.append(_box(tg + "_StileO", (xa if side < 0 else xb - cs, cy0, t0), (xa + cs if side < 0 else xb, cy1, t1), wood, 0.003, 2, "z"))
            wparts.append(_box(tg + "_StileI", (xb - cs if side < 0 else xa, cy0, t0), (xb if side < 0 else xa + cs, cy1, t1), wood, 0.003, 2, "z"))
            wparts.append(_box(tg + "_RailB", (xa + cs, cy0, t0), (xb - cs, cy1, t0 + cb), wood, 0.003, 2, "x"))
            wparts.append(_box(tg + "_RailT", (xa + cs, cy0, t1 - cr), (xb - cs, cy1, t1), wood, 0.003, 2, "x"))
            gx0, gx1, gz0, gz1 = xa + cs, xb - cs, t0 + cb, t1 - cr
            for k in range(1, n_across):
                x = gx0 + (gx1 - gx0) * k / n_across
                wparts.append(box(f"{tg}_BarV{k}", (bar_w, bar_d, gz1 - gz0 + 0.01), (x, y_w, (gz0 + gz1) / 2), mat(wood), 0.003, 1))
            for k in range(1, rows):
                z = gz0 + (gz1 - gz0) * k / rows
                wparts.append(box(f"{tg}_BarH{k}", (gx1 - gx0 + 0.01, bar_d, bar_w), ((gx0 + gx1) / 2, y_w, z), mat(wood), 0.003, 1))
    c1 = tiers[0][1]
    ri = r - fw
    rh, rm = 0.13 * ri / 0.66, 0.40 * ri / 0.66
    wparts.append(_arc_bar(name + "_FanHub", 0, cz, rh, 0, 180, bar_w, bar_d, y_w, wood, drop=0.03))
    wparts.append(_arc_bar(name + "_FanRing", 0, cz, rm, 0, 180, bar_w, bar_d, y_w, wood, drop=0.03, seg=0.02))
    for t_ in (45, 90, 135):
        wparts.append(_radial_bar(f"{name}_FanIn{t_}", 0, cz, t_, rh, rm, bar_w, bar_d, y_w, wood))
    for t_ in (30, 60, 90, 120, 150):
        wparts.append(_radial_bar(f"{name}_FanOut{t_}", 0, cz, t_, rm, ri + 0.012, bar_w, bar_d, y_w, wood))
    for ob in wparts:
        if not ob.data.uv_layers:
            C.uv_grain_auto(ob, tex_size(wood))
    timber = C.join(wparts, name + "_Timber")
    # --- brass fittings: cockspur fastener on the meeting stile, a stay on each bottom rail ------------
    br = []
    zh = (c0 + c1) / 2
    yf = cy0
    xf = -0.0295
    br.append(_box(name + "_FastPlate", (xf - 0.011, yf - 0.004, zh - 0.03), (xf + 0.011, yf + 0.001, zh + 0.03), "brass", 0.0012, 1, "z"))
    br.append(_lathe_y(name + "_FastBoss", [(0.0, 0.0), (0.009, 0.0), (0.009, 0.006), (0.006, 0.012), (0.0, 0.012)],
                       (xf, yf - 0.004, zh), "brass", 16))
    handle = [(xf, yf - 0.014, zh), (xf, yf - 0.018, zh - 0.03), (xf + 0.002, yf - 0.020, zh - 0.07), (xf + 0.006, yf - 0.024, zh - 0.10)]
    br.append(_sweep(name + "_FastHandle", _round_profile(0.0055, 8), handle, "brass", up=(1, 0, 0), smooth=60))
    br.append(_box(name + "_FastKeep", (0.004, yf - 0.012, zh - 0.012), (0.026, yf + 0.001, zh + 0.012), "brass", 0.0015, 1))
    for side in (-1, 1):
        xs = side * (ai - 0.16)
        zst = c0 + cb / 2
        br.append(box(f"{name}_Stay{side}", (0.24, 0.006, 0.014), (xs - side * 0.03, yf - 0.003, zst), mat("brass"), 0.0015, 1))
        br.append(_lathe_y(f"{name}_StayPin{side}", [(0.0, 0.0), (0.007, 0.0), (0.007, 0.016), (0.0, 0.016)],
                           (xs + side * 0.07, yf, zst), "brass", 12))
    for ob in br:
        if not ob.data.uv_layers:
            _uv(ob, "brass")
    brass = C.join(br, name + "_Brass")
    ext = [(y_w - 0.04, s + 0.008), (T + 0.045, s - 0.012), (T + 0.045, s - 0.045), (T + 0.03, s - 0.045),
           (T + 0.03, s - 0.06), (y_w - 0.04, s - 0.06)]
    sill = _extrude(name + "_SillExt", ext, "x", -a - 0.004, a + 0.004, "limestone_plain", 0.003, 1)
    glass = _glass_face(name + "_Glass", _arch_outline2(a - 0.03, zb + 0.03, cz, r - 0.03, 40), y_w)
    return C.join([plaster, timber, brass, sill, glass], name)


# ---------------------------------------------------------------------------
# Doors: shared pieces
# ---------------------------------------------------------------------------

DOOR_DEFAULTS = {
    "door_glazed": dict(width=1.8, height=2.7, wall=0.8, faces="both"),
    "door_single": dict(width=1.0, height=2.2, wall=0.3, faces="both"),
    "door_double": dict(width=2.8, height=3.2, wall=0.8, faces="room", apex=4.6),
    "exit": dict(width=1.2, height=2.3, wall=0.8, faces="room"),
    "elevator": dict(width=1.0, height=2.2, wall=0.25, faces="room"),
}


def _rect_path(hw, z0, top, y=0.0, z1=None):
    return [(-hw, y, z0), (-hw, y, top), (hw, y, top), (hw, y, z0 if z1 is None else z1)]


def _lining(name, hw_i, H_i, y0, y1, key, embed=0.012):
    """Jamb + head lining for a rectangular opening (face at x = +-hw_i, z = H_i), y0..y1 deep."""
    prof = [(0.0, -y0), (0.0, -y1), (-(0.02 + embed), -y1), (-(0.02 + embed), -y0)]
    return _sweep(name, prof, _rect_path(hw_i, 0.0, H_i), key, up=(0, -1, 0))


def _stop(name, hw_i, H_i, y0, y1, key, proj=0.014):
    """Door stop bead on the lining, behind the closed leaf (chamfered on the leaf side)."""
    prof = [(-0.002, -y0), (proj - 0.003, -y0), (proj, -y0 - 0.003), (proj, -y1), (-0.002, -y1)]
    return _sweep(name, prof, _rect_path(hw_i, 0.0, H_i), key, up=(0, -1, 0))


def _architrave_set(prefix, hw_i, H_i, key, w=0.15, p=0.034, plinth_h=0.22, head=None):
    """Room-face timber architrave with plinth blocks, plus an optional frieze + cornice head."""
    parts = []
    prof = _prof_door_architrave(w, p)
    z0 = plinth_h - 0.003 if plinth_h > 0 else 0.0
    parts.append(_sweep(prefix + "_Architrave", prof, _rect_path(hw_i, z0, H_i), key, up=(0, -1, 0)))
    if plinth_h > 0:
        for sx in (-1, 1):
            xa, xb = sx * (hw_i - 0.0), sx * (hw_i + w + 0.012)
            parts.append(_box(f"{prefix}_Plinth{sx}", (min(xa, xb), -(p + 0.008), 0.0), (max(xa, xb), 0.002, plinth_h),
                              key, 0.003, 2, "z"))
    if head:
        top = H_i + w
        fh = head.get("frieze", 0.15)
        xw = hw_i + w
        parts.append(_box(prefix + "_Frieze", (-xw, -0.024, top - 0.004), (xw, 0.002, top + fh), key, 0.002, 1, "x"))
        parts.append(_returned(prefix + "_Cornice", _prof_cornice(head.get("proj", 0.085), head.get("h", 0.10)),
                               -(xw + 0.035), xw + 0.035, 0.0, top + fh, key))
    return parts


def _jamb_panels(prefix, hw_i, H_i, y0, y1, key, z0=0.28, z_top_gap=0.14):
    """Applied panel mouldings on a deep reveal's jamb linings and head soffit."""
    parts = []
    if y1 - y0 < 0.18:
        return parts
    prof = _prof_panel_mould(0.02, 0.011)
    z1 = H_i - z_top_gap
    pathL = [(-hw_i, y0, z0), (-hw_i, y0, z1), (-hw_i, y1, z1), (-hw_i, y1, z0)]
    pl = _sweep(prefix + "_JambPanelL", prof, pathL, key, closed_path=True, up=(1, 0, 0))
    parts += [pl, _mirror(pl, 0, 0.0, prefix + "_JambPanelR")]
    x0, x1 = -hw_i + 0.12, hw_i - 0.12
    soffit = [(x1, y0, H_i), (x1, y1, H_i), (x0, y1, H_i), (x0, y0, H_i)]
    parts.append(_sweep(prefix + "_SoffitPanel", prof, soffit, key, closed_path=True, up=(0, 0, -1)))
    return parts


def _frustum(name, x0, x1, z0, z1, inset, y_base, h, direction, key):
    """Raised field of a fielded panel: a flat-topped frustum rising `h` off the plane y_base."""
    bm = bmesh.new()
    yb = y_base - direction * 0.001
    yt = y_base + direction * h
    B = [bm.verts.new(v) for v in ((x0, yb, z0), (x1, yb, z0), (x1, yb, z1), (x0, yb, z1))]
    Tt = [bm.verts.new(v) for v in ((x0 + inset, yt, z0 + inset), (x1 - inset, yt, z0 + inset),
                                     (x1 - inset, yt, z1 - inset), (x0 + inset, yt, z1 - inset))]
    bm.faces.new(B)
    bm.faces.new(list(reversed(Tt)))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((B[j], B[i], Tt[i], Tt[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, mat(key))
    C.shade_smooth(ob, 20)
    _uv(ob, key, "z" if (z1 - z0) > (x1 - x0) else "x")
    return ob


def _prof_bolection(recess, proj=0.03, lap=0.026, foot=0.034):
    """Bolection moulding (u inward from the cell edge, v off the stile face): it laps `lap` onto the
    stile, rises in an ogee to a bead `proj` proud, then drops by a cove into the sunk panel
    `recess` below the stile face."""
    pts = [(-lap, -0.002), (-lap, 0.004)]
    pts += _ogee(-lap, 0.004, -0.013, proj - 0.011, 5, "recta")
    pts += [(-0.012, proj - 0.009)]
    pts += _arc2(-0.004, proj - 0.008, 0.008, 180, 0, 6)[1:]
    pts += [(0.004, proj - 0.012), (0.008, proj - 0.012)]
    rc = 0.018
    pts += _arc2(0.008 + rc, proj - 0.012, rc, 180, 270, 4)[1:]
    pts += [(foot - 0.004, proj - 0.012 - rc - 0.002), (foot, -recess + 0.004), (foot, -recess - 0.002),
            (-0.002, -recess - 0.002), (-0.002, -0.002)]
    return _clean(pts)


def _leaf(prefix, x0, x1, z0, z1, yc, t, key, stile, rails, fields, muntin=0.10, glass_key="glass",
          field_raise=True, bolection=False):
    """A stile-and-rail door leaf with both faces moulded.
    rails: [(za, zb), ...] bottom to top (bottom rail first, top rail last).
    fields[i] fills the gap above rails[i]: ("panel", ncols) or ("glass", ncols, nx, nz) where
    nx/nz are glazing bars per cell. With `bolection`, every cell is framed by a bolection
    moulding standing proud of the stiles and the fields are raised 18 mm with a 40 mm bevelled
    margin (heavy entrance joinery). Returns (timber parts, glass parts)."""
    wood, glass = [], []
    yf, yb = yc - t / 2, yc + t / 2
    wood.append(_box(prefix + "_StileA", (x0, yf, z0), (x0 + stile, yb, z1), key, 0.0025, 2, "z"))
    wood.append(_box(prefix + "_StileB", (x1 - stile, yf, z0), (x1, yb, z1), key, 0.0025, 2, "z"))
    for i, (za, zb) in enumerate(rails):
        wood.append(_box(f"{prefix}_Rail{i}", (x0 + stile, yf, za), (x1 - stile, yb, zb), key, 0.0025, 2, "x"))
    if bolection:
        recess = 0.03
        tp = t - 2 * recess
    else:
        tp = t * 0.36
        recess = (t - tp) / 2
    for i, fdef in enumerate(fields):
        kind, ncols = fdef[0], fdef[1]
        cz0, cz1 = rails[i][1], rails[i + 1][0]
        xs = [x0 + stile, x1 - stile]
        if ncols == 2:
            xm = (x0 + x1) / 2
            wood.append(_box(f"{prefix}_Muntin{i}", (xm - muntin / 2, yf, cz0), (xm + muntin / 2, yb, cz1), key, 0.0025, 2, "z"))
            cells = [(xs[0], xm - muntin / 2), (xm + muntin / 2, xs[1])]
        else:
            cells = [(xs[0], xs[1])]
        for j, (cx0, cx1) in enumerate(cells):
            tag = f"{prefix}_F{i}{j}"
            rect = [(cx0, 0, cz0), (cx0, 0, cz1), (cx1, 0, cz1), (cx1, 0, cz0)]
            if kind == "panel":
                wood.append(_box(tag + "_Board", (cx0 - 0.008, yc - tp / 2, cz0 - 0.008), (cx1 + 0.008, yc + tp / 2, cz1 + 0.008),
                                 key, 0.0, 1, "z" if cz1 - cz0 > cx1 - cx0 else "x"))
                if bolection:
                    mould = _sweep(tag + "_Bolection", _prof_bolection(recess), [(x, yf, z) for x, _, z in rect], key,
                                   closed_path=True, up=(0, -1, 0), smooth=30)
                    m0 = 0.034 + 0.006
                    fh, fw_ = (cz1 - cz0) - 2 * m0, (cx1 - cx0) - 2 * m0
                    ins = min(0.04, 0.3 * min(fh, fw_))
                    fr = _frustum(tag + "_Field", cx0 + m0, cx1 - m0, cz0 + m0, cz1 - m0, ins, yc - tp / 2, 0.018, -1, key) \
                        if min(fh, fw_) > 0.05 else None
                else:
                    mould = _sweep(tag + "_Mould", _prof_panel_mould(0.018, recess - 0.0015),
                                   [(x, yf + recess, z) for x, _, z in rect], key, closed_path=True, up=(0, -1, 0))
                    fr = None
                    if field_raise and (cx1 - cx0) > 0.16 and (cz1 - cz0) > 0.16:
                        fr = _frustum(tag + "_Field", cx0 + 0.03, cx1 - 0.03, cz0 + 0.03, cz1 - 0.03, 0.034,
                                      yc - tp / 2, min(0.008, recess - 0.004), -1, key)
                wood += [mould, _mirror(mould, 1, yc, mould.name + "B")]
                if fr is not None:
                    wood += [fr, _mirror(fr, 1, yc, tag + "_FieldB")]
            else:
                nx, nz = (fdef[2], fdef[3]) if len(fdef) > 3 else (0, 0)
                glass.append(_glass_face(tag + "_Glass", [(cx0 - 0.006, cz0 - 0.006), (cx1 + 0.006, cz0 - 0.006),
                                                          (cx1 + 0.006, cz1 + 0.006), (cx0 - 0.006, cz1 + 0.006)], yc, glass_key))
                if bolection:
                    bead = _sweep(tag + "_Bolection", _prof_bolection(t / 2 - 0.004), [(x, yf, z) for x, _, z in rect], key,
                                  closed_path=True, up=(0, -1, 0), smooth=30)
                    gx0, gx1, gz0, gz1 = cx0 + 0.03, cx1 - 0.03, cz0 + 0.03, cz1 - 0.03
                else:
                    bead = _sweep(tag + "_Bead", _prof_panel_mould(0.016, t / 2 - 0.0045),
                                  [(x, yc, z) for x, _, z in rect], key, closed_path=True, up=(0, -1, 0))
                    gx0, gx1, gz0, gz1 = cx0, cx1, cz0, cz1
                wood += [bead, _mirror(bead, 1, yc, bead.name + "B")]
                for k in range(1, nx + 1):
                    x = gx0 + (gx1 - gx0) * k / (nx + 1)
                    wood.append(box(f"{tag}_BarV{k}", (0.028, t * 0.62, gz1 - gz0 + 0.004), (x, yc, (gz0 + gz1) / 2), mat(key), 0.003, 2))
                for k in range(1, nz + 1):
                    z = gz0 + (gz1 - gz0) * k / (nz + 1)
                    wood.append(box(f"{tag}_BarH{k}", (gx1 - gx0 + 0.004, t * 0.62, 0.028), ((gx0 + gx1) / 2, yc, z), mat(key), 0.003, 2))
    for ob in wood:
        if not ob.data.uv_layers:
            C.uv_grain_auto(ob, tex_size(key))
    return wood, glass


def _hinges(prefix, x_edge, yface, zs, key="brass", side=-1):
    """Butt-hinge knuckles at a leaf's hinge edge, on the face it swings toward."""
    out = []
    for i, z in enumerate(zs):
        prof = [(0.0, z - 0.056), (0.0045, z - 0.056), (0.0085, z - 0.049), (0.0085, z + 0.049),
                (0.0045, z + 0.056), (0.0, z + 0.056)]
        k = C.lathe(f"{prefix}_Hinge{i}", prof, segments=10, mat=mat(key), center=(x_edge, yface + side * 0.0045, 0))
        _uv(k, key, "z")
        out.append(k)
    return out


def _lever(prefix, x, z, yface, face, toward, key="brass"):
    """Lever handle on a rose: `face` -1 room side (-Y) or +1 far side; the grip points along
    `toward` (+1 = +X, -1 = -X)."""
    parts = []
    rose = [(0.0, 0.0), (0.027, 0.0), (0.027, 0.004), (0.025, 0.007), (0.016, 0.011), (0.0115, 0.013),
            (0.0115, 0.02), (0.0, 0.02)]
    parts.append(_lathe_y(prefix + "_Rose", rose, (x, yface, z), key, 28, face))
    f, d = face, toward
    path = [(x, yface + f * 0.012, z), (x, yface + f * 0.042, z), (x + d * 0.006, yface + f * 0.058, z),
            (x + d * 0.022, yface + f * 0.066, z), (x + d * 0.055, yface + f * 0.068, z),
            (x + d * 0.105, yface + f * 0.067, z - 0.002), (x + d * 0.128, yface + f * 0.064, z - 0.006)]
    grip = [(-0.009, -0.006), (0.009, -0.006), (0.0105, -0.004), (0.0105, 0.004), (0.009, 0.006), (-0.009, 0.006),
            (-0.0105, 0.004), (-0.0105, -0.004)]
    parts.append(_sweep(prefix + "_Lever", grip, path, key, up=(0, 0, 1), smooth=50))
    return parts


def _backplate_lever(prefix, x, z_lever, yface, face, toward, key="brass", keyhole=True):
    parts = []
    y_out = yface + face * 0.004
    lo = (x - 0.024, min(yface, y_out), z_lever - 0.15)
    hi = (x + 0.024, max(yface, y_out), z_lever + 0.06)
    parts.append(_box(prefix + "_Backplate", lo, hi, key, 0.0018, 2, "z"))
    parts += _lever(prefix, x, z_lever, y_out, face, toward, key)
    if keyhole:
        kz = z_lever - 0.10
        ya, yb = y_out - face * 0.0005, y_out + face * 0.0006
        parts.append(_disc_y(prefix + "_KeyRound", 0.0045, ya, yb, (x, kz + 0.004), "iron", 16))
        parts.append(_box(prefix + "_KeySlot", (x - 0.002, min(ya, yb), kz - 0.009), (x + 0.002, max(ya, yb), kz + 0.003),
                          "iron", 0.0, 1))
    return parts


def _screw(name, x, z, yface, face, key, r=0.0034):
    """A domed screw head on a plate face (face -1: room side, +1: far side)."""
    return _lathe_y(name, [(r, -0.0004), (r, 0.0002), (r * 0.62, 0.0009), (0.0, 0.0012)],
                    (x, yface, z), key, 8, face, caps=False)


def _plate(name, x0, x1, z0, z1, yface, face, key="brass", th=0.003, grain="x", radius=0.006, screws="edge",
           pitch=0.3):
    """A metal plate (kick plate, push plate, sign) screwed to a leaf face: rounded corners, eased
    front arris, real thickness and domed screw heads (`screws`: "edge" rows along the long edges,
    "corners", "sides" (one at each end) or None)."""
    rr = min(radius, (x1 - x0) / 2 - 1e-3, (z1 - z0) / 2 - 1e-3)
    outl = []
    for cx, cz, a0 in ((x1 - rr, z0 + rr, -90), (x1 - rr, z1 - rr, 0), (x0 + rr, z1 - rr, 90), (x0 + rr, z0 + rr, 180)):
        outl += _arc2(cx, cz, rr, a0, a0 + 90, 4)
    y_in, y_out = yface - face * 0.0005, yface + face * th
    ob = _extrude(name, outl, "y", min(y_in, y_out), max(y_in, y_out), key, min(0.0012, th * 0.4), 1, grain)
    parts = [ob]
    ys = y_out
    m = 0.013
    pts = []
    if screws == "edge":
        n = max(2, round((x1 - x0 - 2 * m) / pitch) + 1)
        for zz in (z0 + m, z1 - m):
            pts += [(x0 + m + (x1 - x0 - 2 * m) * k / (n - 1), zz) for k in range(n)]
    elif screws == "corners":
        pts = [(x0 + m, z0 + m), (x1 - m, z0 + m), (x0 + m, z1 - m), (x1 - m, z1 - m)]
    elif screws == "sides":
        pts = [(x0 + m * 0.9, (z0 + z1) / 2), (x1 - m * 0.9, (z0 + z1) / 2)]
    for k, (x, z) in enumerate(pts):
        parts.append(_screw(f"{name}_Screw{k}", x, z, ys, face, key))
    return C.join(parts, name)


# ---------------------------------------------------------------------------
# Doors
# ---------------------------------------------------------------------------

def _door_glazed(W, H, T, faces, name):
    key = "walnut"
    hw_i, H_i = W / 2 - 0.02, H - 0.02
    t = 0.055
    y_front = 0.07
    yc = y_front + t / 2
    fr = []
    room, far = faces in ("both", "room"), faces in ("both", "far")
    fr.append(_lining(name + "_Lining", hw_i, H_i, 0.001 if not room else 0.002, T - (0.002 if far else 0.001), key))
    fr.append(_stop(name + "_Stop", hw_i, H_i, y_front + t + 0.001, y_front + t + 0.036, key))
    fr += _jamb_panels(name, hw_i, H_i, y_front + t + 0.09, T - 0.07, key)
    arch = _architrave_set(name, hw_i, H_i, key, 0.16, 0.036, 0.22, head={"frieze": 0.15, "proj": 0.085, "h": 0.10})
    if room:
        fr += arch
    if far:
        fr += [_mirror(o, 1, T / 2, o.name + "_Far") for o in arch]
    if not room:
        for o in arch:
            C.remove(o)
    root = C.join(fr, name)
    gap = 0.003
    z0, z1 = 0.008, H_i - gap
    rails = [(z0, 0.25), (0.86, 1.02), (z1 - 0.125, z1)]
    fields = [("panel", 1), ("glass", 1)]
    for side, tag in ((-1, "L"), (1, "R")):
        x_hinge = side * (hw_i - gap)
        x_meet = side * 0.0015
        x0, x1 = min(x_hinge, x_meet), max(x_hinge, x_meet)
        wood, glass = _leaf(f"{name}_Leaf{tag}", x0, x1, z0, z1, yc, t, key, 0.105, rails, fields)
        hw_ = []
        xm = x_meet + side * 0.0525
        for face, yface in ((-1, y_front), (1, y_front + t)):
            hw_.append(_plate(f"{name}_{tag}Push{face}", xm - 0.038, xm + 0.038, 1.02, 1.36, yface, face, "brass", 0.003, "z",
                              radius=0.012, screws="corners"))
            hw_.append(_plate(f"{name}_{tag}Kick{face}", x0 + 0.018, x1 - 0.018, 0.03, 0.23, yface, face, "brass_aged", 0.0025, "x"))
        hw_ += _hinges(f"{name}_{tag}", x_hinge + side * 0.0, y_front, (0.28, 1.25, z1 - 0.3))
        if side > 0:
            hw_.append(_box(f"{name}_Astragal", (-0.012, y_front - 0.009, z0 + 0.01), (0.012, y_front + 0.001, z1 - 0.004), key, 0.003, 2, "z"))
        leaf = C.join(wood + glass + hw_, f"{name}_Leaf{tag}")
        _set_pivot(leaf, (x_hinge, yc, 0.0))
        _parent(leaf, root)
    return root


def _door_single(W, H, T, faces, name, label=""):
    """Panelled walnut door. Openings 1.25 m and wider get a PAIR of leaves (each a slim three-panel
    leaf, levers at the meeting stiles, the sign on the active right leaf) instead of one squat leaf."""
    key = "walnut"
    hw_i, H_i = W / 2 - 0.02, H - 0.02
    t = 0.048
    y_front = 0.05 if T < 0.5 else 0.08
    yc = y_front + t / 2
    room, far = faces in ("both", "room"), faces in ("both", "far")
    fr = [_lining(name + "_Lining", hw_i, H_i, 0.002 if room else 0.001, T - (0.002 if far else 0.001), key),
          _stop(name + "_Stop", hw_i, H_i, y_front + t + 0.001, y_front + t + 0.034, key)]
    fr += _jamb_panels(name, hw_i, H_i, y_front + t + 0.09, T - 0.07, key)
    arch = _architrave_set(name, hw_i, H_i, key, 0.15, 0.034, 0.22)
    if room:
        fr += arch
    if far:
        fr += [_mirror(o, 1, T / 2, o.name + "_Far") for o in arch]
    if not room:
        for o in arch:
            C.remove(o)
    root = C.join(fr, name)
    gap = 0.003
    z0, z1 = 0.008, H_i - gap
    rails = [(z0, 0.25), (0.86, 1.04), (1.50, 1.64), (z1 - 0.12, z1)]
    pair = W >= 1.25
    if pair:
        leaves = [(-1, "L", -(hw_i - gap), -0.0015), (1, "R", hw_i - gap, 0.0015)]
        stile, fields = 0.105, [("panel", 1)] * 3
    else:
        leaves = [(-1, "", -hw_i + gap, hw_i - gap)]
        stile, fields = (0.12 if W < 1.2 else 0.135), [("panel", 2)] * 3
    for side, tag, x_hinge, x_far in leaves:
        x0, x1 = min(x_hinge, x_far), max(x_hinge, x_far)
        lname = f"{name}_Leaf{tag}"
        wood, _ = _leaf(lname, x0, x1, z0, z1, yc, t, key, stile, rails, fields, muntin=0.10)
        hw_ = []
        toward = side                                   # lever grips point back toward the hinge
        xl = x_far + (stile / 2 if x_hinge > x_far else -stile / 2)   # centred on the lock stile
        active = (not pair) or side > 0
        hw_ += _backplate_lever(lname + "_LvF", xl, 1.0, y_front, -1, toward, keyhole=active)
        hw_ += _backplate_lever(lname + "_LvB", xl, 1.0, y_front + t, 1, toward, keyhole=active)
        hw_.append(_plate(lname + "_KickF", x0 + 0.02, x1 - 0.02, 0.03, 0.24, y_front, -1, "brass_aged", 0.0025))
        if far:
            hw_.append(_plate(lname + "_KickB", x0 + 0.02, x1 - 0.02, 0.03, 0.24, y_front + t, 1, "brass_aged", 0.0025))
        hw_ += _hinges(lname, x_hinge, y_front, (0.26, 1.1, z1 - 0.26))
        if pair and side > 0:
            hw_.append(_box(f"{name}_Astragal", (-0.011, y_front - 0.008, z0 + 0.01), (0.011, y_front + 0.001, z1 - 0.004),
                            key, 0.003, 2, "z"))
        if label and active:
            xc = (x0 + x1) / 2 + (side * 0.004 if pair else 0.0)
            max_w = (x1 - x0) - 2 * stile + 0.04
            size = 0.03
            tc = (xc, y_front - 0.0034, 1.57)
            txt, (tw, th) = _text(lname + "_SignText", label, size, 0.0012, "iron", tc, font=FONT_SERIF)
            if tw > max_w - 0.06:
                C.remove(txt)
                size *= (max_w - 0.06) / tw
                txt, (tw, th) = _text(lname + "_SignText", label, size, 0.0012, "iron", tc, font=FONT_SERIF)
            pw = min(max(tw + 0.06, 0.2), max_w)
            hw_.append(_plate(lname + "_Sign", xc - pw / 2, xc + pw / 2, 1.535, 1.605, y_front, -1, "brass", 0.003,
                              radius=0.004, screws="sides"))
            hw_.append(txt)
        leaf = C.join(wood + hw_, lname)
        _set_pivot(leaf, (x_hinge, yc, 0.0))
        _parent(leaf, root)
    return root


def _door_main(W, H, T, faces, name, apex=None):
    """Heavy fumed-oak entrance pair under an arched fanlight, in a limestone surround with a
    console keystone. 95 mm leaves: bolection-moulded fielded panels and glazed lights, a frieze
    panel, a torus lock-rail moulding, long brass pull bars, kick plates, four hinges a leaf."""
    key = "oak_stained"
    hw = W / 2
    apex = apex if apex is not None else H + hw
    cz, r0 = _arch_circle(hw, H, apex)
    a, r = hw - LINER_E, r0 - LINER_E
    y_f = T - 0.25                 # frame centre
    fd, fw = 0.16, 0.10            # frame depth / face
    parts = [_liner(name + "_Reveal", a, 0.0, cz, r, 0.002, T, "limestone", 40)]
    parts += _stone_surround(name, a, 0.0, cz, r, y_f - fd / 2 - 0.004, W_a=0.32, P_a=0.105, imp_h=0.26,
                             imp_proj=0.18, plinth_h=0.38)
    stone = C.join(parts, name + "_Stone")
    wood = []
    fpath = _arch_path(a, 0.0, cz, r, y_f, 48)
    fprof = [(-0.006, -fd / 2), (fw, -fd / 2), (fw, fd / 2 - 0.03), (fw - 0.012, fd / 2 - 0.018),
             (fw - 0.012, fd / 2 - 0.006), (fw - 0.018, fd / 2), (-0.006, fd / 2)]
    wood.append(_sweep(name + "_Frame", fprof, fpath, key, up=(0, -1, 0), smooth=40))
    ai = a - fw
    aL, aR, zm = _arc_span(a, cz, r)
    th = 0.13
    tz0, tz1 = zm - th / 2 - 0.02, zm + th / 2 - 0.02
    wood.append(_box(name + "_Transom", (-ai - 0.006, y_f - fd / 2, tz0), (ai + 0.006, y_f + fd / 2, tz1), key, 0.005, 2, "x"))
    tmp = _clean([(0.0, 0.0), (0.012, 0.0)] + _arc2(0.012, 0.012, 0.012, -90, 0, 4) + [(0.024, 0.026), (0.0, 0.026)])
    wood.append(_returned(name + "_TransomMould", tmp, -ai, ai, y_f - fd / 2, tz1 - 0.026, key, ret=0.004))
    ri = r - fw
    bw, bd = 0.04, 0.07
    rh, rm = 0.30 * ri / 1.27, 0.84 * ri / 1.27
    wood.append(_arc_bar(name + "_FanHub", 0, cz, rh, 0, 180, bw, bd, y_f, key, drop=0.06, seg=0.025))
    wood.append(_arc_bar(name + "_FanRing", 0, cz, rm, 0, 180, bw, bd, y_f, key, drop=0.06, seg=0.04))
    for t_ in (45, 90, 135):
        wood.append(_radial_bar(f"{name}_FanIn{t_}", 0, cz, t_, rh, rm, bw, bd, y_f, key))
    for k in range(1, 8):
        wood.append(_radial_bar(f"{name}_FanOut{k}", 0, cz, 22.5 * k, rm, ri + 0.012, bw, bd, y_f, key))
    for ob in wood:
        if not ob.data.uv_layers:
            C.uv_grain_auto(ob, tex_size(key))
    fan_glass = [(x, z) for x, z in _arch_outline2(a - 0.03, tz1 - 0.01, cz, r - 0.03, 48)]
    fan_glass = [(x, max(z, tz1 - 0.01)) for x, z in fan_glass]
    glass = _glass_face(name + "_FanGlass", fan_glass, y_f, "glass_window")
    thr = _box(name + "_Threshold", (-ai, y_f - fd / 2 - 0.02, 0.0), (ai, y_f + fd / 2 + 0.02, 0.012), "brass_aged", 0.003, 2, "x")
    t = 0.095
    yc = y_f - fd / 2 + 0.018 + t / 2
    gap = 0.003
    z0, z1 = 0.015, tz0 - gap
    rails = [(z0, 0.30), (1.04, 1.26), (z1 - 0.35, z1 - 0.21), (z1 - 0.17, z1)]
    fields = [("panel", 1), ("glass", 1, 1, 2), ("panel", 1)]
    stop = _stop(name + "_Stop", ai, tz0, yc + t / 2 + 0.001, yc + t / 2 + 0.03, key, 0.016)
    root2 = C.join([stone] + wood + [glass, thr, stop], name)
    torus = [(-0.003, 0.0), (0.006, 0.0), (0.009, 0.003), (0.009, 0.010)] + _arc2(0.009, 0.025, 0.015, -90, 90, 10)[1:-1] + \
            [(0.009, 0.040), (0.009, 0.047), (0.006, 0.05), (-0.003, 0.05)]
    for side, tag in ((-1, "L"), (1, "R")):
        x_hinge = side * (ai - gap)
        x_meet = side * 0.0015
        x0, x1 = min(x_hinge, x_meet), max(x_hinge, x_meet)
        lname = f"{name}_Leaf{tag}"
        wood_l, glass_l = _leaf(lname, x0, x1, z0, z1, yc, t, key, 0.17, rails, fields, glass_key="glass_window",
                                bolection=True)
        # torus moulding across the lock rail, returned at both ends, on both faces
        bx0, bx1 = (x0 + 0.012, x1 - 0.032) if side < 0 else (x0 + 0.032, x1 - 0.012)
        lr = _returned(lname + "_LockRail", _clean(torus), bx0, bx1, yc - t / 2, 1.125, key, ret=0.01, smooth=40)
        C.uv_grain_auto(lr, tex_size(key))
        wood_l += [lr, _mirror(lr, 1, yc, lname + "_LockRailB")]
        hwp = []
        xm = x_meet + side * 0.085
        for face, yface in ((-1, yc - t / 2), (1, yc + t / 2)):
            for zz in (0.95, 1.62):
                hwp.append(_disc_y(f"{lname}_Post{face}{zz}", 0.011, yface, yface + face * 0.062, (xm, zz), "brass", 16))
                hwp.append(_lathe_y(f"{lname}_Rose{face}{zz}", [(0.024, -0.001), (0.024, 0.002), (0.02, 0.006),
                                                               (0.014, 0.008), (0.0, 0.008)], (xm, yface, zz), "brass", 20, face,
                                    caps=False))
            bar = C.lathe(f"{lname}_Bar{face}", [(0.0, 0.88), (0.012, 0.882), (0.017, 0.895), (0.017, 1.675), (0.012, 1.688), (0.0, 1.69)],
                          segments=20, mat=mat("brass"), center=(xm, yface + face * 0.068, 0))
            _uv(bar, "brass", "z")
            hwp.append(bar)
            hwp.append(_plate(f"{lname}_Kick{face}", x0 + 0.02, x1 - 0.02, 0.035, 0.27, yface, face, "brass_aged", 0.003,
                              screws="edge" if face < 0 else "corners"))
        hwp += _hinges(lname, x_hinge, yc - t / 2, (0.35, 1.2, 2.05, z1 - 0.35))
        if side > 0:
            hwp.append(_box(f"{name}_Astragal", (-0.016, yc - t / 2 - 0.012, z0 + 0.01), (0.016, yc - t / 2 + 0.001, z1 - 0.004), key, 0.004, 2, "z"))
            ez, ex = 1.36, x_meet + side * 0.045
            hwp.append(_lathe_y(f"{name}_Escutcheon", [(0.0, -0.001), (0.022, -0.001), (0.022, 0.002), (0.018, 0.005), (0.0, 0.006)],
                                (ex, yc - t / 2, ez), "brass", 20))
            hwp.append(_box(f"{name}_Keyhole", (ex - 0.002, yc - t / 2 - 0.0066, ez - 0.012),
                            (ex + 0.002, yc - t / 2 - 0.0055, ez + 0.006), "iron", 0.0, 1))
        leaf = C.join(wood_l + glass_l + hwp, lname)
        _set_pivot(leaf, (x_hinge, yc, 0.0))
        _parent(leaf, root2)
    return root2


def _door_exit(W, H, T, faces, name):
    """Painted fire-exit door that swings OUT (toward +Y, the egress side): the stop and frame
    rebate are on the room face, the hinges on the far face, and the push side (room) carries the
    panic bar, kick plate and a parallel-arm closer whose shoe hangs from the head stop. A green
    illuminated EXIT sign sits over the architrave."""
    key = "ivory_paint"
    hw_i, H_i = W / 2 - 0.02, H - 0.02
    t = 0.05
    y_front = 0.058
    yc = y_front + t / 2
    fr = [_lining(name + "_Lining", hw_i, H_i, 0.002, T - 0.001, key),
          _stop(name + "_Stop", hw_i, H_i, 0.004, y_front - 0.001, key, 0.016)]
    fr += _architrave_set(name, hw_i, H_i, key, 0.13, 0.03, 0.2)
    # illuminated EXIT sign above the architrave
    zs0 = H_i + 0.13 + 0.12
    sw, sh, sd = 0.40, 0.17, 0.05
    sign = [_box(name + "_SignBox", (-sw / 2, -sd, zs0), (sw / 2, 0.002, zs0 + sh), "plastic_light", 0.008, 3)]
    sign.append(_box(name + "_SignFace", (-sw / 2 + 0.014, -sd - 0.0015, zs0 + 0.014), (sw / 2 - 0.014, -sd + 0.004, zs0 + sh - 0.014),
                     "exit_green", 0.0012, 1))
    txt, _ = _text(name + "_SignText", "EXIT", 0.098, 0.0016, "exit_white", (0.0, -sd - 0.0015 - 0.0006, zs0 + sh / 2),
                   font=FONT_SANS, spacing=1.05)
    sign.append(txt)
    gap = 0.003
    x0, x1 = -hw_i + gap, hw_i - gap
    z0, z1 = 0.01, H_i - gap
    # closer shoe under the head stop (frame side of the parallel arm)
    xs0 = x0 + 0.58
    shoe = [_box(name + "_CloserShoe", (xs0, 0.012, H_i - 0.016 - 0.03), (xs0 + 0.075, 0.048, H_i - 0.016), "chrome", 0.004, 2)]
    root = C.join(fr + sign + shoe, name)
    rails = [(z0, 0.26), (0.9, 1.1), (z1 - 0.13, z1)]
    fields = [("panel", 1), ("panel", 1)]
    wood, _ = _leaf(name + "_Leaf", x0, x1, z0, z1, yc, t, key, 0.13, rails, fields)
    hwp = []
    yfc = y_front
    zb = 1.0
    # panic bar: hinge-side bracket, touch bar, latch-side mechanism case
    hb0, lc1 = x0 + 0.09, x1 - 0.05
    hwp.append(_box(name + "_BarBracket", (hb0, yfc - 0.075, zb - 0.035), (hb0 + 0.05, yfc + 0.001, zb + 0.035), "chrome", 0.01, 3))
    hwp.append(_box(name + "_BarCase", (lc1 - 0.19, yfc - 0.078, zb - 0.04), (lc1, yfc + 0.001, zb + 0.04), "chrome", 0.012, 3))
    bar_prof = [(-0.019, -0.016), (0.019, -0.016), (0.022, -0.01), (0.022, 0.012), (0.017, 0.019), (-0.017, 0.019),
                (-0.022, 0.012), (-0.022, -0.01)]
    hwp.append(_sweep(name + "_TouchBar", bar_prof, [(hb0 + 0.03, yfc - 0.052, zb), (lc1 - 0.1, yfc - 0.052, zb)], "chrome",
                      up=(0, -1, 0), smooth=50))
    hwp.append(_box(name + "_BarStrip", (hb0 + 0.06, yfc - 0.0745, zb - 0.006), (lc1 - 0.2, yfc - 0.071, zb + 0.006), "plastic_dark", 0.001, 1))
    hwp.append(_plate(name + "_Kick", x0 + 0.02, x1 - 0.02, 0.03, 0.25, yfc, -1, "chrome", 0.0025))
    hwp += _hinges(name, x0, y_front + t, (0.26, 1.15, z1 - 0.26), "chrome", side=1)
    # parallel-arm closer on the push face: body on the top rail, arm folded under the head stop
    zc_top = z1 - 0.07
    hwp.append(_box(name + "_Closer", (x0 + 0.06, yfc - 0.05, zc_top - 0.058), (x0 + 0.34, yfc + 0.001, zc_top), "chrome", 0.01, 3))
    xsp = x0 + 0.30
    hwp.append(C.cylinder(name + "_CloserSpindle", 0.011, 0.011, 0.016, (xsp, yfc - 0.03, zc_top + 0.006), mat("chrome"), 16))
    za = zc_top + 0.019
    hwp.append(_box(name + "_CloserArm", (xsp - 0.014, yfc - 0.038, za - 0.0045), (xs0 + 0.04, yfc - 0.022, za + 0.0045), "chrome", 0.003, 2))
    hwp.append(C.cylinder(name + "_CloserPivot", 0.012, 0.012, 0.012, (xs0 + 0.04, yfc - 0.03, za + 0.006), mat("chrome"), 16))
    for ob in hwp:
        if not ob.data.uv_layers:
            _uv(ob, "chrome")
    leaf = C.join(wood + hwp, name + "_Leaf")
    _set_pivot(leaf, (x0, yc, 0.0))
    _parent(leaf, root)
    return root


def _door_elevator(W, H, T, faces, name):
    key = "bronze_satin"
    hw_i, H_i = W / 2 - 0.02, H - 0.02
    parts = [_lining(name + "_Lining", hw_i, H_i, 0.002, T - 0.001, key)]
    p = 0.045
    pw = 0.17
    # fluted pilasters
    for sx in (-1, 1):
        x_in, x_out = sx * hw_i, sx * (hw_i + pw)
        xa, xb = min(x_in, x_out), max(x_in, x_out)
        outl = [(xa, 0.002), (xa, -p)]
        nfl, margin, fil = 5, 0.016, 0.007
        fwid = (pw - 2 * margin - (nfl - 1) * fil) / nfl
        x = xa + margin
        outl.append((x, -p))
        for k in range(nfl):
            xa_, xb_ = x, x + fwid
            for q in range(1, 8):
                tq = q / 8
                outl.append((xa_ + (xb_ - xa_) * tq, -p + 0.009 * math.sin(math.pi * tq)))
            outl.append((xb_, -p))
            x = xb_ + (fil if k < nfl - 1 else 0)
            if k < nfl - 1:
                outl.append((x, -p))
        outl += [(xb, -p), (xb, 0.002)]
        parts.append(_extrude(f"{name}_Pilaster{sx}", outl, "z", 0.16, H_i + 0.004, key, 0.0, 1, "z"))
        parts.append(_box(f"{name}_Base{sx}", (xa - 0.012, -(p + 0.014), 0.0), (xb + 0.004, 0.002, 0.16), key, 0.004, 2))
        parts.append(_box(f"{name}_BaseCap{sx}", (xa - 0.006, -(p + 0.008), 0.16), (xb + 0.002, 0.002, 0.18), "brass_aged", 0.003, 2))
    # head: frieze with three reeds, stepped crown
    xw = hw_i + pw + 0.012
    hz0, hz1 = H_i, H_i + 0.27
    parts.append(_box(name + "_Frieze", (-xw, -(p + 0.012), hz0), (xw, 0.002, hz1), key, 0.004, 2, "x"))
    for k, zz in enumerate((hz0 + 0.07, hz0 + 0.135, hz0 + 0.2)):
        parts.append(_sweep(f"{name}_Reed{k}", _round_profile(0.008, 10), [(-xw + 0.03, -(p + 0.012), zz), (xw - 0.03, -(p + 0.012), zz)],
                            "brass_aged", up=(0, -1, 0), smooth=60))
    parts.append(_box(name + "_Crown1", (-xw - 0.012, -(p + 0.026), hz1), (xw + 0.012, 0.002, hz1 + 0.035), key, 0.004, 2, "x"))
    parts.append(_box(name + "_Crown2", (-xw + 0.02, -(p + 0.016), hz1 + 0.035), (xw - 0.02, 0.002, hz1 + 0.06), "brass_aged", 0.003, 2, "x"))
    # floor indicator dial on the crown
    dz = hz1 + 0.06
    rd = 0.235
    semi = [(rd * math.cos(math.pi * k / 32), dz + rd * math.sin(math.pi * k / 32)) for k in range(33)]
    parts.append(_extrude(name + "_DialBody", semi, "y", 0.002, -0.06, key, 0.004, 2))
    face = [(0.19 * math.cos(math.pi * k / 32), dz + 0.012 + 0.178 * math.sin(math.pi * k / 32)) for k in range(33)]
    parts.append(_extrude(name + "_DialFace", face, "y", -0.058, -0.0625, "glass_frosted", 0.0, 1))
    rim = [(0.205 * math.cos(math.pi * k / 32), -0.062, dz + 0.004 + 0.198 * math.sin(math.pi * k / 32)) for k in range(33)]
    parts.append(_sweep(name + "_DialRim", _bar_profile(0.018, 0.012, 0.004), rim, "brass_aged", up=(0, -1, 0), smooth=50))
    parts.append(_box(name + "_DialBase", (-0.215, -0.068, dz - 0.002), (0.215, -0.056, dz + 0.016), key, 0.003, 2))
    for lab, ang in (("G", 150), ("1", 30)):
        cx, czz = 0.125 * math.cos(math.radians(ang)), dz + 0.012 + 0.11 * math.sin(math.radians(ang))
        txt, _ = _text(f"{name}_Dial{lab}", lab, 0.05, 0.002, "bronze", (cx, -0.0637, czz), font=FONT_SERIF)
        parts.append(txt)
    for ang in (60, 90, 120):
        parts.append(_radial_bar(f"{name}_Tick{ang}", 0, dz + 0.012, ang, 0.12, 0.155, 0.004, 0.002, -0.0632, "bronze", 0.0))
    needle = [(0.0, dz + 0.012 - 0.012), (0.008, dz + 0.012), (0.0, dz + 0.012 + 0.092), (-0.008, dz + 0.012)]   # tip short of the numerals
    nd = _extrude(name + "_Needle", needle, "y", -0.0645, -0.068, key, 0.0, 1)
    _rot_y_about(nd, -60, 0.0, dz + 0.012)          # points at G (150 deg)
    parts.append(nd)
    parts.append(_disc_y(name + "_NeedleHub", 0.014, -0.0625, -0.072, (0.0, dz + 0.012), key, 20, 0.002))
    # call panel to the right
    xc = hw_i + pw + 0.012 + 0.13
    zc = 1.1
    parts.append(_box(name + "_CallPlate", (xc - 0.055, -0.008, zc - 0.14), (xc + 0.055, 0.002, zc + 0.14), key, 0.003, 2, "z"))
    for k, (zz, lit) in enumerate(((zc + 0.045, True), (zc - 0.045, False))):
        ring = [(0.0175, 0.0), (0.024, 0.0), (0.024, 0.004), (0.021, 0.0075), (0.0175, 0.0075), (0.0175, 0.0)]
        parts.append(_lathe_y(f"{name}_Bezel{k}", ring, (xc, -0.008, zz), "brass_aged", 24, -1, caps=False))
        parts.append(_disc_y(f"{name}_Button{k}", 0.0165, -0.0166, -0.009, (xc, zz), "bulb_soft" if lit else "glass_frosted", 24, 0.0015))
        tri = [(-0.007, -0.005), (0.007, -0.005), (0.0, 0.007)] if k == 0 else [(-0.007, 0.005), (0.0, -0.007), (0.007, 0.005)]
        parts.append(_extrude(f"{name}_Arrow{k}", [(xc + u, zz + v) for u, v in tri], "y", -0.0163, -0.0178, "bronze", 0.0, 1))
    # threshold with a guide groove
    parts.append(_box(name + "_SillA", (-hw_i, -0.02, 0.0), (hw_i, 0.072, 0.006), key, 0.0015, 1, "x"))
    parts.append(_box(name + "_SillB", (-hw_i, 0.084, 0.0), (hw_i, T - 0.001, 0.006), key, 0.0015, 1, "x"))
    parts.append(_box(name + "_Groove", (-hw_i, 0.071, 0.0), (hw_i, 0.085, 0.003), "iron", 0.0, 1, "x"))
    root = C.join(parts, name)
    # sliding leaves (centre opening)
    t = 0.03
    yc = 0.11
    z0, z1 = 0.008, H_i - 0.004
    for side, tag in ((-1, "L"), (1, "R")):
        xo, xi = side * (hw_i - 0.002), side * 0.001
        x0, x1 = min(xo, xi), max(xo, xi)
        lp = [_box(f"{name}_{tag}Sheet", (x0, yc - t / 2, z0), (x1, yc + t / 2, z1), key, 0.002, 1, "z")]
        yfront = yc - t / 2
        inset = 0.035
        rect = [(x0 + inset, yfront, z0 + inset + 0.05), (x0 + inset, yfront, z1 - inset), (x1 - inset, yfront, z1 - inset),
                (x1 - inset, yfront, z0 + inset + 0.05)]
        bead = [(0.0, -0.001), (0.012, -0.001), (0.012, 0.002)] + _arc2(0.006, 0.002, 0.006, 0, 180, 6)[1:-1] + [(0.0, 0.002)]
        lp.append(_sweep(f"{name}_{tag}Bead", _clean(bead), rect, "brass_aged", closed_path=True, up=(0, -1, 0), smooth=50))
        rib = [(-0.001, 0.006), (-0.001, -0.006)] + _arc2(0.0, 0.0, 0.006, -90, 90, 8)[1:-1]
        for k, zz in enumerate((1.0, 1.035, 1.07)):
            lp.append(_sweep(f"{name}_{tag}Rib{k}", _clean(rib), [(x0 + inset, yfront, zz), (x1 - inset, yfront, zz)], "brass_aged",
                             up=(0, 0, 1), smooth=60))
        xm_, zm_ = (x0 + x1) / 2, 1.62
        for k, (hwz, hwx, dd) in enumerate(((0.21, 0.13, 0.006), (0.15, 0.09, 0.011), (0.075, 0.045, 0.016))):
            loz = [(xm_, zm_ - hwz), (xm_ + hwx, zm_), (xm_, zm_ + hwz), (xm_ - hwx, zm_)]
            lp.append(_extrude(f"{name}_{tag}Lozenge{k}", loz, "y", yfront + 0.001, yfront - dd, "brass_aged" if k != 1 else key, 0.002, 1))
        leaf = C.join(lp, f"{name}_Leaf{tag}")
        _set_pivot(leaf, ((x0 + x1) / 2, yc, 0.0))
        _parent(leaf, root)
    return root


def build_door(kind="door_single", width=None, height=None, wall_thickness=None, label="", faces=None,
               apex=None, name=None):
    """Closed doors. kind: door_glazed | door_single | door_double | exit | elevator.
    width x height is the hole (for door_double, height is the springline under the fanlight and
    `apex` its top). faces: which wall faces get architraves - "both", "room" (-Y), "far" (+Y)."""
    d = DOOR_DEFAULTS[kind]
    W = width or d["width"]
    H = height or d["height"]
    T = wall_thickness or d["wall"]
    faces = faces or d["faces"]
    tag = {"door_glazed": "Glazed", "door_single": "Single", "door_double": "Main", "exit": "Exit", "elevator": "Elevator"}[kind]
    name = name or f"Architecture_Door_{tag}_01"
    if kind == "door_glazed":
        return _door_glazed(W, H, T, faces, name)
    if kind == "door_single":
        return _door_single(W, H, T, faces, name, label)
    if kind == "door_double":
        return _door_main(W, H, T, faces, name, apex if apex is not None else d["apex"])
    if kind == "exit":
        return _door_exit(W, H, T, faces, name)
    return _door_elevator(W, H, T, faces, name)


# ---------------------------------------------------------------------------
# Plan integration
# ---------------------------------------------------------------------------

def _linked_copy(src, name):
    """A linked duplicate of an asset tree (meshes shared, so glTF exports them once)."""
    ob = C.instance(src, name, src.location, src.rotation_euler.z, src.scale)
    for ch in src.children:
        c = C.instance(ch, name + ch.name[len(src.name):], ch.location, ch.rotation_euler.z, ch.scale)
        _parent(c, ob)
    return ob


def build_for_opening(o, wall=None, name=None, cache=None):
    """Builds the asset a plan.Opening asks for. Returns (object, origin_height): put the object's
    origin at the opening centre on the wall's inner face, `origin_height` above the wall's base.
    Arches (kind "arch") are the shell's job and return (None, 0). Pass a dict as `cache` to share
    one mesh between identical openings (24 tall windows become linked copies of one)."""
    T = 0.8
    if wall is not None:
        b = wall.bounds
        T = (b["maxZ"] - b["minZ"]) if wall.axis == "x" else (b["maxX"] - b["minX"])
    nm = name or ("Architecture_" + "".join(w.capitalize() for w in o.id.split("_")))
    if cache is not None:
        hall = wall is not None and wall.room == "hall"
        key = (o.kind, round(o.width, 4), round(o.y0, 4), round(o.y1, 4), round(T, 4), o.passable, hall,
               o.label if o.kind == "door_single" else "")
        if key in cache:
            src, h = cache[key]
            return _linked_copy(src, nm), h
        built = build_for_opening(o, wall, nm)
        if built[0] is not None:
            cache[key] = built
        return built
    if o.kind == "window_arched":
        key_top = None
        if wall is not None and wall.room == "hall":
            import plan as _plan
            key_top = _plan.HALL_CORNICE + 0.025 - o.y0     # console keystone buried 25 mm into the architrave
        return build_window_arched(o.width, 0.0, (o.spring or o.y1 - o.width / 2) - o.y0, o.y1 - o.y0, T, nm,
                                   keystone_top=key_top), o.y0
    if o.kind == "window_tall":
        return build_window_tall(o.width, o.y0, o.y1, T, "ivory", (o.spring or o.y1 - o.width / 2), nm), 0.0
    if o.kind == "oculus":
        return build_oculus(o.width, T, nm), o.y0
    if o.kind == "arch":
        return None, 0.0
    faces = None
    if o.kind == "door_glazed" and wall is not None and wall.room == "hall":
        faces = "far"            # bookcase ends flank these openings on the hall side
    elif o.kind == "door_single" and not o.passable:
        faces = "room"           # the far rooms (washrooms, staff) are not built
    if o.kind == "door_double":
        return build_door(o.kind, o.width, o.spring or o.y1 - o.width / 2, T, faces=faces, apex=o.y1 - o.y0, name=nm), o.y0
    return build_door(o.kind, o.width, o.y1 - o.y0, T, label=o.label if o.kind == "door_single" else "", faces=faces, name=nm), o.y0


def place_in_wall(ob, wall, o, origin_height=0.0, side=None):
    """Positions an asset in a plan wall (web coordinates via lib_core.place). `side` overrides the
    room side for "both" walls ("north"/"south"/"east"/"west")."""
    b = wall.bounds
    inside = side or (wall.inside if wall.inside != "both" else ("east" if wall.axis == "z" else "south"))
    y = wall.y0 + origin_height
    if wall.axis == "x":
        z = b["maxZ"] if inside == "south" else b["minZ"]
        rot = 0.0 if inside == "south" else math.pi
        return C.place(ob, o.at, y, z, rot)
    x = b["maxX"] if inside == "east" else b["minX"]
    rot = math.pi / 2 if inside == "east" else -math.pi / 2
    return C.place(ob, x, y, o.at, rot)


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _preview_wall(name, cutters, x0, x1, z0, z1, T, key):
    """A wall slab y = 0..T with openings cut by prisms of the given (x, z) outlines."""
    wall = box_minmax(name, (x0, 0.0, z0), (x1, T, z1), mat(key))
    cut_objs = [_extrude(name + f"_Cut{i}", outl, "y", -0.3, T + 0.3, key) for i, outl in enumerate(cutters)]
    cut = C.join(cut_objs, name + "_Cutter")
    mod = wall.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = cut
    C.apply_modifiers(wall)
    C.remove(cut)
    _uv(wall, key)
    C.shade_flat(wall)
    return wall


def _rect_outline(hw, z0, z1):
    return [(-hw, z0), (hw, z0), (hw, z1), (-hw, z1)]


def _setup_studio():
    import lib_render as R
    scene = bpy.context.scene
    R.engine(scene, "EEVEE", 48, (960, 960))
    R.world(scene, (0.5, 0.52, 0.56), 0.16)
    try:
        scene.view_settings.look = "AgX - Medium High Contrast"
        scene.view_settings.exposure = -0.35
    except TypeError:
        pass
    R.area_light("Key", (-5.0, -4.2, 5.8), (0.3, 0, 2.0), 1300, 2.2, (1.0, 0.92, 0.82))
    R.area_light("Fill", (5.5, -6.5, 2.4), (0, 0, 1.6), 260, 6.0, (0.85, 0.91, 1.0))
    R.area_light("Bounce", (0.0, -6.0, 0.3), (0, 0, 1.2), 120, 6.0, (1.0, 0.9, 0.8))
    R.area_light("Back", (4.0, 7.0, 4.5), (0, 0.8, 1.6), 900, 3.0, (1.0, 0.94, 0.86))
    sun = bpy.data.lights.new("Sun", "SUN")
    sun.energy = 3.0
    sun.color = (1.0, 0.95, 0.86)
    sun.angle = math.radians(1.2)
    so = bpy.data.objects.new("Sun", sun)
    bpy.context.scene.collection.objects.link(so)
    so.rotation_euler = Vector((-0.35, -1.0, -0.62)).to_track_quat("-Z", "Y").to_euler()
    # sky backdrop behind the walls, a floor inside the room
    me = bpy.data.meshes.new("Sky")
    me.from_pydata([(-40, 14, -6), (40, 14, -6), (40, 14, 30), (-40, 14, 30)], [], [(0, 1, 2, 3)])
    sky = bpy.data.objects.new("Sky", me)
    C.link(sky)
    me.materials.append(mat("sky"))
    fl = box_minmax("Floor", (-30, -30, -0.05), (30, 1.2, 0.0), mat("stone_tiles"))
    _uv(fl, "stone_tiles")
    return scene


def _glass_shadows():
    """Preview only: let sunlight through alpha-blended glass (glTF ignores this setting)."""
    for m in bpy.data.materials:
        if m.name.startswith("M_Glass"):
            try:
                m.use_transparent_shadow = True
            except AttributeError:
                pass


def _shot(path, target, yaw, pitch, dist, lens=45):
    import lib_render as R
    cam = R.camera(lens=lens)
    t = Vector(target)
    y, p = math.radians(yaw), math.radians(pitch)
    loc = t + Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist
    R.look(cam, loc, t)
    return R.render(path)


def _remove_tree(*obs):
    for ob in obs:
        if ob is None:
            continue
        for c in list(ob.children_recursive):
            C.remove(c)
        C.remove(ob)


def preview(out_dir):
    only = set(filter(None, os.environ.get("ARCHWIN_ONLY", "").split(",")))

    def want(k):
        return not only or k in only

    _setup_studio()
    paths, counts = [], {}
    P = lambda n: os.path.join(out_dir, n + ".png")  # noqa: E731

    if want("arched"):
        # as in the hall: sill 7.0, the entablature architrave from 11.60 (stand-in band here), and
        # the console keystone run up 25 mm into it
        s0 = 1.0
        ent = 11.6 - 7.0
        ob = build_window_arched(sill_h=0.0, keystone_top=ent + 0.025)
        ob.location.z = s0
        counts[ob.name] = _total_tris(ob)
        cz, r = _arch_circle(1.6, 2.6, 4.2)
        wall = _preview_wall("PW", [_arch_outline2(1.6, s0, cz + s0, r, 64)], -3.4, 3.4, 0.0, s0 + ent + 0.9, 0.8, "limestone")
        band = [(0.0, 0.0), (0.14, 0.0), (0.14, 0.09), (0.155, 0.105), (0.155, 0.19), (0.17, 0.205), (0.17, 0.30), (0.0, 0.30)]
        ent_ob = _returned("EntablatureStandIn", band, -3.4, 3.4, 0.0, s0 + ent, "limestone_plain")
        _glass_shadows()
        paths.append(_shot(P("window_arched_front"), (0, 0, 3.5), 0, 4, 10.5, 40))
        paths.append(_shot(P("window_arched_34"), (0, 0, 3.4), 38, 10, 9.5, 40))
        paths.append(_shot(P("window_arched_floor"), (0, 0, s0 + 2.4), 10, 26, 8.0, 40))
        paths.append(_shot(P("window_arched_head"), (0, 0, s0 + 4.15), 24, 8, 3.2, 50))
        paths.append(_shot(P("window_arched_keystone"), (0, 0, s0 + 4.35), 38, 12, 1.5, 50))
        paths.append(_shot(P("window_arched_impost"), (-1.75, 0, s0 + 2.45), 35, 12, 1.9, 50))
        paths.append(_shot(P("window_arched_reveal"), (-1.5, 0.3, s0 + 2.6), 60, 5, 2.2, 45))
        paths.append(_shot(P("window_arched_sill"), (-1.4, 0, s0 + 0.05), 40, 22, 1.8, 50))
        paths.append(_shot(P("window_arched_exterior"), (0, 0.8, 3.1), 155, 8, 9.0, 40))
        paths.append(_shot(P("window_arched_ext_impost"), (-1.5, 0.8, s0 + 2.6), 150, 4, 2.0, 45))
        _remove_tree(ob, wall, ent_ob)

    if want("oculus"):
        z0 = 1.4
        ob = build_oculus()
        ob.location.z = z0
        counts[ob.name] = _total_tris(ob)
        _glass_shadows()
        circ = [(1.2 * math.cos(math.tau * k / 64), z0 + 1.2 + 1.2 * math.sin(math.tau * k / 64)) for k in range(64)]
        wall = _preview_wall("PW", [circ], -2.6, 2.6, 0.0, 5.2, 0.8, "limestone")
        paths.append(_shot(P("oculus_front"), (0, 0, z0 + 1.2), 0, 0, 6.2, 45))
        paths.append(_shot(P("oculus_34"), (0, 0, z0 + 1.2), 35, 8, 6.0, 45))
        paths.append(_shot(P("oculus_rose"), (0.35, 0, z0 + 1.55), 18, 6, 2.0, 50))
        paths.append(_shot(P("oculus_hub"), (0.0, 0.6, z0 + 1.2), 10, 3, 0.9, 50))
        paths.append(_shot(P("oculus_key_top"), (0.0, 0, z0 + 2.45), 30, 20, 1.2, 50))
        paths.append(_shot(P("oculus_surround"), (1.4, 0, z0 + 1.2), 60, 10, 1.2, 50))
        _remove_tree(ob, wall)

    if want("tall"):
        for fin in ("ivory", "walnut"):
            ob = build_window_tall(finish=fin, name=f"Architecture_Window_Tall_{fin.capitalize()}")
            counts[ob.name] = _total_tris(ob)
            _glass_shadows()
            cz, r = _arch_circle(0.75, 2.75, 3.5)
            wall = _preview_wall("PW", [_arch_outline2(0.75, 0.9, cz, r, 48)], -1.8, 1.8, 0.0, 4.4, 0.8, "plaster")
            paths.append(_shot(P(f"window_tall_{fin}"), (0, 0, 2.05), 28, 6, 5.6, 40))
            if fin == "ivory":
                paths.append(_shot(P("window_tall_front"), (0, 0, 2.05), 0, 2, 5.8, 40))
            else:
                paths.append(_shot(P("window_tall_detail"), (-0.15, 0, 1.25), 30, 18, 1.5, 50))
            _remove_tree(ob, wall)
        # the plan's other sizes: the lobby (1.6 wide, sill 1.2, apex 5.8) and the lounge (1.8, 0.6, 4.2)
        for tag, (w_, s_, ap_, fin, h_wall, zt, dist) in {"lobby": (1.6, 1.2, 5.8, "ivory", 6.8, 3.3, 9.0),
                                                          "lounge": (1.8, 0.6, 4.2, "walnut", 5.2, 2.35, 7.0)}.items():
            ob = build_window_tall(w_, s_, ap_, 0.8, fin, ap_ - w_ / 2, f"Architecture_Window_Tall_{tag.capitalize()}")
            counts[ob.name] = _total_tris(ob)
            cz, r = _arch_circle(w_ / 2, ap_ - w_ / 2, ap_)
            wall = _preview_wall("PW", [_arch_outline2(w_ / 2, s_, cz, r, 48)], -2.2, 2.2, 0.0, h_wall, 0.8, "plaster")
            _glass_shadows()
            fig = C.cylinder("Figure", 0.17, 0.17, 1.45, (1.45, -0.6, 0.725), mat("plastic_dark"), segments=16)
            head = C.sphere("FigureHead", 0.11, (1.45, -0.6, 1.59), mat("plastic_dark"))
            paths.append(_shot(P(f"window_tall_{tag}"), (0, 0, zt), 10, 3, dist, 40))
            _remove_tree(ob, wall, fig, head)

    doors = [("glazed", "door_glazed", {}, "plaster"), ("single", "door_single", {"label": "Print & Copy Room"}, "plaster"),
             ("main", "door_double", {}, "limestone"), ("exit", "exit", {}, "plaster"), ("elevator", "elevator", {}, "plaster")]
    for key_, kind, kw, wkey in doors:
        if not want(key_):
            continue
        ob = build_door(kind, **kw)
        counts[ob.name] = _total_tris(ob)
        _glass_shadows()
        d = DOOR_DEFAULTS[kind]
        W, H, T = d["width"], d["height"], d["wall"]
        if kind == "door_double":
            cz, r = _arch_circle(W / 2, H, d["apex"])
            outl = _arch_outline2(W / 2, 0.0, cz, r, 48)
            zt = 2.6
        else:
            outl = _rect_outline(W / 2, 0.0, H)
            zt = H * 0.62
        wall = _preview_wall("PW", [outl], -W / 2 - 2.0, W / 2 + 2.0, 0.0, max(H + 1.6, 4.0) + (1.3 if kind == "door_double" else 0), T, wkey)
        span = max(W + 1.2, H + 0.6 + (1.6 if kind == "door_double" else 0))
        paths.append(_shot(P(f"door_{key_}_front"), (0, 0, zt), 0, 4, span * 1.45 + 1.0, 40))
        paths.append(_shot(P(f"door_{key_}_34"), (0, 0, zt), 36, 10, span * 1.45 + 1.0, 40))
        if kind == "door_glazed":
            paths.append(_shot(P("door_glazed_far"), (0, T, zt), 200, 8, span * 1.45 + 1.0, 40))
            paths.append(_shot(P("door_glazed_hardware"), (0.05, 0, 1.15), 30, 10, 1.1, 50))
            _remove_tree(ob, wall)
            # as the plan uses it in the hall: no hall-side architrave, bookcase ends flank the hole
            ob = build_door(kind, faces="far", name="Architecture_Door_Glazed_HallSide")
            wall = _preview_wall("PW", [outl], -W / 2 - 2.0, W / 2 + 2.0, 0.0, 4.4, T, wkey)
            cases = [_box(f"CaseStandIn{sx}", (min(sx * 0.9, sx * 2.0), -0.45, 0.0), (max(sx * 0.9, sx * 2.0), 0.0, 4.0),
                          "walnut_dark", 0.004) for sx in (-1, 1)]
            paths.append(_shot(P("door_glazed_hallside"), (0, 0, 1.5), 26, 6, 5.6, 40))
            _remove_tree(*cases)
        elif kind == "door_single":
            paths.append(_shot(P("door_single_hardware"), (0.25, 0, 1.25), 28, 6, 1.25, 50))
            _remove_tree(ob, wall)
            # the lobby's 1.4 m opening becomes a pair of slim leaves
            ob = build_door(kind, 1.4, 2.4, 0.3, label="Quiet Study", name="Architecture_Door_Single_Pair")
            counts[ob.name] = _total_tris(ob)
            wall = _preview_wall("PW", [_rect_outline(0.7, 0.0, 2.4)], -2.4, 2.4, 0.0, 4.0, 0.3, wkey)
            paths.append(_shot(P("door_single_pair"), (0, 0, 1.4), 10, 4, 5.8, 40))
        elif kind == "door_double":
            paths.append(_shot(P("door_main_fanlight"), (0, 0, 3.8), 22, 14, 3.6, 45))
            paths.append(_shot(P("door_main_panels"), (-0.6, 0, 0.7), 20, 12, 1.4, 50))
            paths.append(_shot(P("door_main_hardware"), (0.05, 0.4, 1.3), 30, 8, 1.6, 50))
            paths.append(_shot(P("door_main_ext"), (0, 0.8, 2.4), 165, 5, 8.0, 40))
        elif kind == "exit":
            paths.append(_shot(P("door_exit_detail"), (0.05, 0, 1.85), 30, 8, 2.4, 45))
            paths.append(_shot(P("door_exit_far"), (0, 0.8, 1.3), 160, 6, 4.0, 40))
        elif kind == "elevator":
            paths.append(_shot(P("door_elevator_dial"), (0.0, 0, 2.6), 20, 6, 1.2, 50))
            paths.append(_shot(P("door_elevator_call"), (0.75, 0, 1.15), 35, 6, 0.9, 50))
        _remove_tree(ob, wall)

    if want("lineup"):
        objs, cutters = [], []
        T = 0.8
        x = -6.6
        for kind, kw, w, gap in (("door_glazed", {}, 1.8, 0.9), ("door_single", {"label": "Reading Room", "wall_thickness": T}, 1.0, 0.75),
                                 ("door_double", {}, 2.8, 1.2), ("exit", {}, 1.2, 0.85), ("elevator", {"wall_thickness": T}, 1.0, 0.9)):
            x += gap + w / 2
            ob = build_door(kind, **kw)
            ob.location.x = x
            d = DOOR_DEFAULTS[kind]
            if kind == "door_double":
                cz, r = _arch_circle(w / 2, d["height"], d["apex"])
                cutters.append([(px + x, pz) for px, pz in _arch_outline2(w / 2, 0.0, cz, r, 48)])
            else:
                cutters.append([(px + x, pz) for px, pz in _rect_outline(w / 2, 0.0, d["height"])])
            objs.append(ob)
            x += w / 2
        wall = _preview_wall("PW", cutters, -7.4, 7.4, 0.0, 5.6, T, "plaster")
        _glass_shadows()
        paths.append(_shot(P("lineup_doors"), (0.0, 0, 2.3), 10, 5, 12.8, 35))
        _remove_tree(wall, *objs)
        a = build_window_arched()
        a.location = (-3.2, 0, 1.0)
        o = build_oculus()
        o.location = (1.3, 0, 2.4)
        t = build_window_tall(finish="walnut")
        t.location.x = 4.6
        cz, r = _arch_circle(1.6, 2.6, 4.2)
        cz2, r2 = _arch_circle(0.75, 2.75, 3.5)
        cut = [[(px - 3.2, pz) for px, pz in _arch_outline2(1.6, 1.0, cz + 1.0, r, 64)],
               [(1.3 + 1.2 * math.cos(math.tau * k / 64), 3.6 + 1.2 * math.sin(math.tau * k / 64)) for k in range(64)],
               [(px + 4.6, pz) for px, pz in _arch_outline2(0.75, 0.9, cz2, r2, 48)]]
        wall = _preview_wall("PW", cut, -6.2, 6.4, 0.0, 6.4, 0.8, "limestone")
        _glass_shadows()
        paths.append(_shot(P("lineup_windows"), (0.1, 0, 3.2), 12, 5, 12.5, 35))
        _remove_tree(wall, a, o, t)

    print("ARCH_WINDOWS_TRIS")
    for k, v in counts.items():
        print(f"  {k}: {v} tris")
    return paths
