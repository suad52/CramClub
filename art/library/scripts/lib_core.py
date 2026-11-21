"""
Shared Blender toolkit for the OVR library build: scene/collection helpers, the web<->Blender
coordinate bridge, mesh primitives for detailed architecture and furniture (bevelled boxes,
lathes, profile sweeps, arches), UVs, shading and instancing.

Conventions (see art/library/ASSETS.md):
  * Blender units are metres, Z up. An asset is built at the origin with its floor at z = 0
    and its FRONT facing Blender -Y (which is web +Z after glTF export).
  * Web coordinates (plan.py) map to Blender as (x, y, z)_web -> (x, -z, y); web rotationY is
    Blender rotation_euler.z.
"""

from __future__ import annotations

import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

SCRIPTS = os.path.dirname(os.path.abspath(__file__))
LIBRARY_ART = os.path.dirname(SCRIPTS)
ROOT = os.path.abspath(os.path.join(LIBRARY_ART, "..", ".."))
TEXTURES = os.path.join(LIBRARY_ART, "textures")


# ---------------------------------------------------------------------------
# Scene and collections
# ---------------------------------------------------------------------------

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    return scene


def collection(name, parent=None):
    """Get or create a collection (nested under `parent`, a name or collection)."""
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        par = bpy.data.collections.get(parent) if isinstance(parent, str) else parent
        (par.children if par else bpy.context.scene.collection.children).link(col)
    return col


def link(ob, col=None):
    if isinstance(col, str):
        col = collection(col)
    (col or bpy.context.scene.collection).objects.link(ob)
    return ob


def move_to(ob, col):
    if isinstance(col, str):
        col = collection(col)
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    col.objects.link(ob)
    return ob


# ---------------------------------------------------------------------------
# Web <-> Blender
# ---------------------------------------------------------------------------

def bl(x, y, z):
    """Web point (x east, y up, z south) -> Blender Vector."""
    return Vector((x, -z, y))


def place(ob, x, y, z, rot=0.0):
    """Puts an origin-built asset at a web position and rotation."""
    ob.location = bl(x, y, z)
    ob.rotation_euler = (0, 0, rot)
    return ob


# ---------------------------------------------------------------------------
# Mesh basics
# ---------------------------------------------------------------------------

def mesh_from_bmesh(name, bm, mats=None, smooth=False, col=None):
    """Creates an object from a bmesh. `mats` is a material or list; faces keep material_index."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    link(ob, col)
    if mats is not None:
        for m in (mats if isinstance(mats, (list, tuple)) else [mats]):
            me.materials.append(m)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    return ob


def remove(ob):
    me = ob.data if ob.type == "MESH" else None
    bpy.data.objects.remove(ob, do_unlink=True)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


def apply_modifiers(ob):
    """Bakes the modifier stack into the mesh (keeps the object)."""
    deps = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(deps)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=deps)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def transform_mesh(ob, matrix):
    ob.data.transform(matrix)
    ob.data.update()
    return ob


def apply_transform(ob):
    ob.data.transform(ob.matrix_basis)
    ob.matrix_basis = Matrix.Identity(4)
    return ob


def join(objects, name):
    """Joins objects (with transforms applied) into one mesh object named `name`."""
    objects = [o for o in objects if o is not None]
    if not objects:
        return None
    for o in objects:
        if o.type != "MESH":
            raise TypeError(f"join: {o.name} is not a mesh")
        if o.data.users > 1:
            o.data = o.data.copy()
        apply_transform(o)
    if len(objects) == 1:
        objects[0].name = name
        objects[0].data.name = name
        return objects[0]
    target = objects[0]
    with bpy.context.temp_override(active_object=target, selected_editable_objects=objects, selected_objects=objects):
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def set_material(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)
    return ob


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------------------
# Shading
# ---------------------------------------------------------------------------

def shade_smooth(ob, angle_deg=35.0):
    """Smooth shading with sharp edges above `angle_deg` (clean hard-surface look)."""
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    try:
        me.set_sharp_from_angle(angle=math.radians(angle_deg))
    except AttributeError:
        pass
    return ob


def shade_flat(ob):
    for p in ob.data.polygons:
        p.use_smooth = False
    return ob


def weighted_normals(ob, keep_sharp=True):
    """WeightedNormal modifier (applied): crisp bevels without shading artefacts."""
    shade_smooth(ob, 30)
    mod = ob.modifiers.new("wn", "WEIGHTED_NORMAL")
    mod.keep_sharp = keep_sharp
    mod.weight = 50
    apply_modifiers(ob)
    return ob


def bevel(ob, width=0.006, segments=2, angle_deg=30.0, harden=True):
    """Rounds every edge sharper than `angle_deg` (applied), then cleans the shading."""
    mod = ob.modifiers.new("bevel", "BEVEL")
    mod.width = width
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = math.radians(angle_deg)
    mod.harden_normals = harden
    mod.miter_outer = "MITER_ARC"
    shade_smooth(ob, 30)
    apply_modifiers(ob)
    return ob


def subdivide(ob, levels=1):
    mod = ob.modifiers.new("subsurf", "SUBSURF")
    mod.levels = levels
    mod.render_levels = levels
    apply_modifiers(ob)
    return ob


# ---------------------------------------------------------------------------
# Primitives (all return mesh objects at world position, materials assigned)
# ---------------------------------------------------------------------------

def box(name, size, center=(0, 0, 0), mat=None, bevel_w=0.0, segments=2, rot=None, col=None):
    """Axis-aligned box of `size` (x, y, z) centred at `center`, optionally bevelled."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if rot is not None:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    ob = mesh_from_bmesh(name, bm, mat, col=col)
    if bevel_w > 0:
        bevel(ob, bevel_w, segments)
    else:
        shade_flat(ob)
    return ob


def box_minmax(name, lo, hi, mat=None, bevel_w=0.0, segments=2, col=None):
    lo, hi = Vector(lo), Vector(hi)
    return box(name, hi - lo, (lo + hi) / 2, mat, bevel_w, segments, col=col)


def cylinder(name, r1, r2, depth, center=(0, 0, 0), mat=None, segments=32, rot=None, cap=True, col=None, smooth=True):
    """Cylinder/cone along Z (before `rot`), centred at `center`."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segments, radius1=r1, radius2=r2, depth=depth)
    if rot is not None:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    ob = mesh_from_bmesh(name, bm, mat, col=col)
    if smooth:
        shade_smooth(ob, 40)
    return ob


def sphere(name, radius, center=(0, 0, 0), mat=None, segments=24, rings=16, scale=(1, 1, 1), col=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    ob = mesh_from_bmesh(name, bm, mat, smooth=True, col=col)
    return ob


def torus(name, major, minor, center=(0, 0, 0), mat=None, major_seg=48, minor_seg=12, rot=None, col=None):
    bm = bmesh.new()
    rings = []
    for i in range(major_seg):
        a = math.tau * i / major_seg
        ring = []
        for j in range(minor_seg):
            b = math.tau * j / minor_seg
            r = major + minor * math.cos(b)
            ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b))))
        rings.append(ring)
    for i in range(major_seg):
        a, c = rings[i], rings[(i + 1) % major_seg]
        for j in range(minor_seg):
            bm.faces.new((a[j], c[j], c[(j + 1) % minor_seg], a[(j + 1) % minor_seg]))
    if rot is not None:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(name, bm, mat, smooth=True, col=col)


def lathe(name, profile, segments=32, mat=None, center=(0, 0, 0), rot=None, cap_top=True, cap_bottom=True, col=None, smooth_angle=50.0):
    """Revolves a profile [(radius, z), ...] (bottom to top) around Z.
    Perfect for turned legs, balusters, finials, lamp bases, column shafts and bulbs."""
    bm = bmesh.new()
    rings = []
    for r, z in profile:
        ring = []
        for i in range(segments):
            a = math.tau * i / segments
            ring.append(bm.verts.new((max(r, 0.0) * math.cos(a), max(r, 0.0) * math.sin(a), z)))
        rings.append(ring)
    for a, c in zip(rings, rings[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            try:
                bm.faces.new((a[i], a[j], c[j], c[i]))
            except ValueError:
                pass
    if cap_bottom and profile[0][0] > 1e-5:
        bm.faces.new(list(reversed(rings[0])))
    if cap_top and profile[-1][0] > 1e-5:
        bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if rot is not None:
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    ob = mesh_from_bmesh(name, bm, mat, col=col)
    shade_smooth(ob, smooth_angle)
    return ob


def sweep(name, profile, path, mat=None, closed_path=False, cap=True, col=None, up=(0, 0, 1), smooth_angle=35.0):
    """Extrudes a 2D profile [(u, v), ...] along a 3D polyline `path` (mouldings, rails, frames).

    The profile's u axis points to the path's left (when looking along the path, up = `up`),
    v points up. Corners are mitred so cornices and frames meet cleanly."""
    pts = [Vector(p) for p in path]
    n = len(pts)
    upv = Vector(up)
    frames = []
    for i in range(n):
        if closed_path:
            prev_p, next_p = pts[i - 1], pts[(i + 1) % n]
            d0 = (pts[i] - prev_p).normalized()
            d1 = (next_p - pts[i]).normalized()
        else:
            d0 = (pts[i] - pts[i - 1]).normalized() if i > 0 else (pts[1] - pts[0]).normalized()
            d1 = (pts[i + 1] - pts[i]).normalized() if i < n - 1 else d0
        tangent = (d0 + d1)
        tangent = tangent.normalized() if tangent.length > 1e-6 else d1
        side0 = upv.cross(d0).normalized() if upv.cross(d0).length > 1e-6 else Vector((1, 0, 0))
        side = upv.cross(tangent).normalized() if upv.cross(tangent).length > 1e-6 else side0
        # Mitre: scale the side offset so the profile keeps its width at corners.
        miter = 1.0 / max(0.2, side.dot(side0)) if (closed_path or 0 < i < n - 1) else 1.0
        vert = tangent.cross(side).normalized()
        frames.append((side * miter, vert))
    bm = bmesh.new()
    rings = []
    for p, (side, vert) in zip(pts, frames):
        rings.append([bm.verts.new(p - side * u + vert * v) for u, v in profile])
    m = len(profile)
    pairs = list(zip(rings, rings[1:])) + ([(rings[-1], rings[0])] if closed_path else [])
    for a, c in pairs:
        for j in range(m - 1):
            try:
                bm.faces.new((a[j], c[j], c[j + 1], a[j + 1]))
            except ValueError:
                pass
    if cap and not closed_path:
        for ring in (rings[0], rings[-1]):
            try:
                bm.faces.new(ring)
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_from_bmesh(name, bm, mat, col=col)
    shade_smooth(ob, smooth_angle)
    return ob


def prism(name, outline, z0, z1, mat=None, col=None, bevel_w=0.0):
    """Extrudes a closed 2D outline [(x, y), ...] (counter-clockwise) from z0 to z1."""
    bm = bmesh.new()
    bot = [bm.verts.new((x, y, z0)) for x, y in outline]
    top = [bm.verts.new((x, y, z1)) for x, y in outline]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_from_bmesh(name, bm, mat, col=col)
    if bevel_w > 0:
        bevel(ob, bevel_w, 2)
    else:
        shade_flat(ob)
    return ob


def arch_points(width, spring, steps=24, center_x=0.0, rise=None):
    """Points along a round (or segmental, with `rise`) arch from left springing to right."""
    half = width / 2
    if rise is None or abs(rise - half) < 1e-6:
        return [(center_x - half * math.cos(math.pi * i / steps), spring + half * math.sin(math.pi * i / steps)) for i in range(steps + 1)]
    # Segmental arch through (+-half, spring) with apex at spring + rise.
    r = (half * half + rise * rise) / (2 * rise)
    cy = spring + rise - r
    a0 = math.asin(half / r)
    return [(center_x + r * math.sin(-a0 + 2 * a0 * i / steps), cy + r * math.cos(-a0 + 2 * a0 * i / steps)) for i in range(steps + 1)]


def arched_outline(width, sill, spring, steps=24, center_x=0.0):
    """Closed outline (x, z) of a round-headed opening: sill, jambs and the arch."""
    pts = [(center_x + width / 2, sill)]
    pts += list(reversed(arch_points(width, spring, steps, center_x)))
    pts.append((center_x - width / 2, sill))
    return pts


def panel_frame(name, w, h, profile, mat=None, col=None):
    """A mitred rectangular frame of `profile` (in the XZ plane, front facing -Y), centred at origin.
    Use for raised panels, picture frames, door panels."""
    path = [(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)]
    return sweep(name, profile, path, mat, closed_path=True, up=(0, -1, 0), col=col)


# ---------------------------------------------------------------------------
# UVs: textures are authored at real-world scale (1 UV unit = `size` metres).
# ---------------------------------------------------------------------------

def uv_box(ob, size=1.0, grain=None):
    """Box-projects UVs in world space. `grain` ("x", "y", "z" or None) makes the texture's U axis
    follow that world axis wherever possible (wood grain along a leg, a rail, a plank)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    mw = ob.matrix_world
    axes = {"x": 0, "y": 1, "z": 2}
    g = axes.get(grain) if grain else None
    for poly in me.polygons:
        n = (mw.to_3x3() @ poly.normal).normalized()
        dom = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != dom]
        if g is not None and g in (a, b) and g != a:
            a, b = b, a
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (co[a] / size, co[b] / size)
    return ob


def uv_grain_auto(ob, size=1.0):
    """Wood UVs: grain follows the object's longest dimension."""
    dims = ob.dimensions
    axis = "xyz"[max(range(3), key=lambda i: dims[i])]
    return uv_box(ob, size, grain=axis)


def uv_cylinder(ob, size=1.0):
    """Cylindrical projection around Z (columns, turned parts): U around, V up."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    mw = ob.matrix_world
    c = ob.matrix_world.translation
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            a = math.atan2(co.y - c.y, co.x - c.x)
            r = max(0.02, math.hypot(co.x - c.x, co.y - c.y))
            uv[li].uv = (a * r / size, co.z / size)
    return ob


# ---------------------------------------------------------------------------
# Instancing and empties
# ---------------------------------------------------------------------------

def instance(src, name, location=(0, 0, 0), rot_z=0.0, scale=(1, 1, 1), col=None):
    """A linked duplicate (shares the mesh) - cheap repeats of chairs, lamps, balusters."""
    ob = bpy.data.objects.new(name, src.data)
    ob.location = Vector(location)
    ob.rotation_euler = (0, 0, rot_z)
    ob.scale = Vector(scale)
    link(ob, col)
    return ob


def empty(name, location=(0, 0, 0), rot_z=0.0, col=None, size=0.25, kind="PLAIN_AXES"):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_type = kind
    ob.empty_display_size = size
    ob.location = Vector(location)
    ob.rotation_euler = (0, 0, rot_z)
    link(ob, col)
    return ob


def rotz(deg):
    return Matrix.Rotation(math.radians(deg), 3, "Z")


def rotx(deg):
    return Matrix.Rotation(math.radians(deg), 3, "X")


def roty(deg):
    return Matrix.Rotation(math.radians(deg), 3, "Y")
