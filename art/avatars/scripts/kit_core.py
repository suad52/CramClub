"""
Core helpers for the OVR avatar kit: scene reset, materials, the shared skeleton, skinning
weights, mesh utilities and the body "build" morph.

Everything here is plain bpy/bmesh so the kit can be rebuilt from scratch in headless Blender:

    blender -b --factory-startup --python art/avatars/scripts/build_kit.py -- --help

Conventions (they are a contract with the web app, see docs/avatar-pipeline.md):
  * metres, Blender Z-up, the character faces -Y (glTF export turns this into +Z forward, Y up)
  * the character's LEFT is +X
  * every skinned part uses the one armature, "Avatar_Rig"
"""

import bmesh
import bpy
import math
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# ---------------------------------------------------------------------------
# Scene
# ---------------------------------------------------------------------------


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    return scene


def link(ob, collection=None):
    (collection or bpy.context.scene.collection).objects.link(ob)
    return ob


def collection(name):
    col = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if col.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(col)
    return col


# ---------------------------------------------------------------------------
# Materials: names are the recolouring contract with the web app.
# ---------------------------------------------------------------------------

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(hex_color, alpha=1.0):
    h = hex_color.lstrip("#")
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    return (srgb_to_linear(r), srgb_to_linear(g), srgb_to_linear(b), alpha)


def material(name, hex_color, roughness=0.75, metallic=0.0, double_sided=False):
    mat = bpy.data.materials.get(name)
    if mat:
        return mat
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except AttributeError:
        pass
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = hex_rgba(hex_color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    mat.diffuse_color = hex_rgba(hex_color)
    # glTF "doubleSided" comes from backface culling being off.
    mat.use_backface_culling = not double_sided
    return mat


# ---------------------------------------------------------------------------
# Skeleton
# ---------------------------------------------------------------------------

# name, head, tail, parent. Heights match the in-game avatar the library was laid out for:
# hips ~0.88 m, shoulders ~1.33 m, eyes ~1.59 m, top of head ~1.74 m.
BONES = [
    ("Root", (0, 0, 0), (0, 0, 0.12), None),
    ("Hips", (0, 0, 0.88), (0, 0, 0.98), "Root"),
    ("Spine", (0, 0, 0.98), (0, 0, 1.16), "Hips"),
    ("Chest", (0, 0, 1.16), (0, 0, 1.37), "Spine"),
    ("Neck", (0, 0, 1.37), (0, 0, 1.46), "Chest"),
    ("Head", (0, 0, 1.46), (0, 0, 1.76), "Neck"),
    ("UpperArm.L", (0.20, 0, 1.33), (0.255, 0.01, 1.06), "Chest"),
    ("LowerArm.L", (0.255, 0.01, 1.06), (0.285, -0.005, 0.81), "UpperArm.L"),
    ("Hand.L", (0.285, -0.005, 0.81), (0.295, -0.01, 0.69), "LowerArm.L"),
    ("UpperLeg.L", (0.092, 0, 0.87), (0.092, 0.005, 0.47), "Hips"),
    ("LowerLeg.L", (0.092, 0.005, 0.47), (0.092, 0.02, 0.085), "UpperLeg.L"),
    ("Foot.L", (0.092, 0.02, 0.085), (0.092, -0.12, 0.03), "LowerLeg.L"),
]


def mirror_name(name):
    return name[:-2] + ".R" if name.endswith(".L") else name


def all_bones():
    out = []
    for name, head, tail, parent in BONES:
        out.append((name, head, tail, parent))
        if name.endswith(".L"):
            out.append((
                mirror_name(name),
                (-head[0], head[1], head[2]),
                (-tail[0], tail[1], tail[2]),
                mirror_name(parent) if parent else None,
            ))
    return out


SEGMENTS = {name: (Vector(h), Vector(t)) for name, h, t, _ in all_bones()}
DEFORM = [n for n in SEGMENTS if n != "Root"]


def build_rig():
    arm = bpy.data.armatures.new("Avatar_Rig")
    ob = link(bpy.data.objects.new("Avatar_Rig", arm))
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    for name, head, tail, parent in all_bones():
        b = arm.edit_bones.new(name)
        b.head, b.tail = head, tail
        b.roll = 0
        if parent:
            b.parent = arm.edit_bones[parent]
            b.use_connect = Vector(arm.edit_bones[parent].tail) == Vector(head)
        b.use_deform = name != "Root"
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


# ---------------------------------------------------------------------------
# Skinning: deterministic distance-based weights. The same function weights the body and every
# garment, so clothes always move exactly like the skin underneath them.
# ---------------------------------------------------------------------------

def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length, t


def _side_ok(bone, p):
    if bone.endswith(".L"):
        return p.x > -0.01
    if bone.endswith(".R"):
        return p.x < 0.01
    return True


def bone_weights(p, allowed=None, top=3, sharpness=4.0):
    cands = []
    for name in (allowed or DEFORM):
        if not _side_ok(name, p):
            continue
        a, b = SEGMENTS[name]
        d, _ = _seg_dist(p, a, b)
        cands.append((name, 1.0 / (d * d + 1e-5) ** (sharpness / 2)))
    cands.sort(key=lambda c: -c[1])
    cands = cands[:top]
    total = sum(w for _, w in cands)
    return [(n, w / total) for n, w in cands if w / total > 0.01]


def skin(ob, rig, allowed=None, rigid=None, sharpness=4.0):
    """Adds vertex groups + an armature modifier and parents the mesh to the rig."""
    groups = {}
    for v in ob.data.vertices:
        p = ob.matrix_world @ v.co
        pairs = [(rigid, 1.0)] if rigid else bone_weights(p, allowed, sharpness=sharpness)
        for name, w in pairs:
            vg = groups.get(name) or ob.vertex_groups.new(name=name)
            groups[name] = vg
            vg.add([v.index], w, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    ob.parent = rig
    return ob


def dominant_bone(p, allowed=None):
    return bone_weights(p, allowed, top=1)[0][0]


# ---------------------------------------------------------------------------
# Region-aware skinning. Pure distance weights let a hanging hand grab the thigh (or a skirt
# hem) beside it, so every vertex first decides which body region it belongs to and may only
# be weighted to that region's bones. Garments also only ever see their own bone families:
# a top never follows the legs, trousers never follow the arms.
# ---------------------------------------------------------------------------

REGION_OF_BONE = {
    "Hips": "Torso", "Spine": "Torso", "Chest": "Torso", "Neck": "Neck", "Head": "Neck",
    "UpperArm": "UpperArms", "LowerArm": "Forearms", "Hand": "Hands",
    "UpperLeg": "Thighs", "LowerLeg": "Shins", "Foot": "Feet",
}
REGION_BONES = {
    "Torso": ["Hips", "Spine", "Chest", "Neck"],
    "Neck": ["Chest", "Neck", "Head"],
    "UpperArms": ["Chest", "UpperArm", "LowerArm"],
    "Forearms": ["UpperArm", "LowerArm", "Hand"],
    "Hands": ["LowerArm", "Hand"],
    "Thighs": ["Hips", "UpperLeg", "LowerLeg"],
    "Shins": ["UpperLeg", "LowerLeg", "Foot"],
    "Feet": ["LowerLeg", "Foot"],
}
GARMENT_BONES = {
    "Top": ["Hips", "Spine", "Chest", "Neck", "UpperArm", "LowerArm", "Hand"],
    "Bottom": ["Hips", "Spine", "UpperLeg", "LowerLeg", "Foot"],
    "Shoes": ["LowerLeg", "Foot"],
}


def expand(families):
    """Bone families ("UpperArm") to bone names ("UpperArm.L", "UpperArm.R")."""
    return [n for n in DEFORM if n.split(".")[0] in families]


# A garment vertex only counts as "arm" when it is actually inside the sleeve, i.e. close to
# the arm bone; otherwise an open cardigan front or a hem beside the hanging hand would ride
# along with the arm.
ARM_REACH = {"UpperArm": 0.095, "LowerArm": 0.088, "Hand": 0.08}


def _garment_region(p, allowed):
    near = []
    for name in allowed:
        if not _side_ok(name, p):
            continue
        reach = ARM_REACH.get(name.split(".")[0])
        d, _ = _seg_dist(p, *SEGMENTS[name])
        if reach is None or d < reach:
            near.append((d, name))
    best = min(near)[1] if near else dominant_bone(p, allowed)
    return REGION_OF_BONE[best.split(".")[0]]


def region_skin(ob, rig, region=None, families=None, sharpness=4.0):
    """Skins `ob` region by region. `region` fixes it for the whole mesh (body parts)."""
    allowed = expand(families) if families else DEFORM
    groups = {}
    for v in ob.data.vertices:
        p = ob.matrix_world @ v.co
        reg = region or _garment_region(p, allowed)
        bones = [b for b in expand(REGION_BONES[reg]) if b in allowed] or allowed
        for name, w in bone_weights(p, bones, sharpness=sharpness):
            vg = groups.get(name) or ob.vertex_groups.new(name=name)
            groups[name] = vg
            vg.add([v.index], w, "REPLACE")
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    ob.parent = rig
    return ob


# ---------------------------------------------------------------------------
# Body build morph: pushes surface points away from (or towards) the nearest bone axis.
# Used for the body AND every garment so clothing follows the body slider.
# ---------------------------------------------------------------------------

BUILD_SCALE = {
    # bone: (broad factor, slim factor) applied to the distance from the bone axis
    "Hips": (1.16, 0.90), "Spine": (1.20, 0.86), "Chest": (1.16, 0.90), "Neck": (1.10, 0.94),
    "UpperArm": (1.18, 0.88), "LowerArm": (1.12, 0.90), "Hand": (1.05, 0.96),
    "UpperLeg": (1.17, 0.88), "LowerLeg": (1.10, 0.92), "Foot": (1.0, 1.0), "Head": (1.0, 1.0),
}


def build_offset(p, kind):
    """Displacement of point p for kind 'broad' or 'slim'."""
    total = Vector((0, 0, 0))
    for name, w in bone_weights(p, top=2):
        a, b = SEGMENTS[name]
        ab = b - a
        t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
        axis_pt = a + ab * t
        radial = p - axis_pt
        key = name.split(".")[0]
        f = BUILD_SCALE.get(key, (1.0, 1.0))[0 if kind == "broad" else 1]
        if key in ("Spine", "Chest", "Hips"):
            # Wider side to side than front to back.
            radial = Vector((radial.x * 1.0, radial.y * 0.75, radial.z * 0.0))
        total += radial * (f - 1.0) * w
    return total


def zero_shape_keys():
    """Blender 5 starts new shape keys at 1.0; the kit (and the exported morph weights) want 0."""
    for ob in bpy.data.objects:
        keys = getattr(ob.data, "shape_keys", None)
        if keys:
            for kb in keys.key_blocks[1:]:
                kb.value = 0.0


def add_build_keys(ob):
    if not ob.data.shape_keys:
        ob.shape_key_add(name="Basis", from_mix=False)
    for kind, key_name in (("broad", "Build_Broad"), ("slim", "Build_Slim")):
        key = ob.shape_key_add(name=key_name, from_mix=False)
        for i, v in enumerate(ob.data.vertices):
            p = ob.matrix_world @ v.co
            key.data[i].co = v.co + build_offset(p, kind)


# ---------------------------------------------------------------------------
# Mesh helpers
# ---------------------------------------------------------------------------

def mesh_from_bmesh(name, bm, mat=None, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    if mat:
        me.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = smooth
    return link(bpy.data.objects.new(name, me))


def evaluated_copy(ob, name):
    """Applies all modifiers by copying the evaluated mesh into a new object."""
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps))
    new = link(bpy.data.objects.new(name, me))
    new.matrix_world = ob.matrix_world
    return new


def remove(ob):
    bpy.data.objects.remove(ob, do_unlink=True)


def join(objects, name):
    objects = [o for o in objects if o]
    if len(objects) == 1:
        objects[0].name = name
        objects[0].data.name = name
        return objects[0]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    with bpy.context.temp_override(active_object=objects[0], selected_editable_objects=objects, selected_objects=objects):
        bpy.ops.object.join()
    ob = objects[0]
    ob.name = name
    ob.data.name = name
    return ob


def apply_transform(ob):
    me = ob.data
    me.transform(ob.matrix_world)
    ob.matrix_world = Matrix.Identity(4)


def shade_smooth(ob):
    for p in ob.data.polygons:
        p.use_smooth = True


def uv_sphere(name, radius, center, scale=(1, 1, 1), segments=24, rings=16, mat=None, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=radius)
    m = Matrix.Diagonal((*scale, 1))
    if rot:
        m = rot.to_4x4() @ m
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
    return mesh_from_bmesh(name, bm, mat)


def cylinder(name, r1, r2, depth, center, mat=None, segments=20, rot=None, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segments, radius1=r1, radius2=r2, depth=depth)
    m = Matrix.Identity(4)
    if rot:
        m = rot.to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
    return mesh_from_bmesh(name, bm, mat)


def torus(name, major, minor, center, mat=None, rot=None, major_seg=32, minor_seg=10, scale=(1, 1, 1), arc=None):
    """Torus in the XY plane (rotate with `rot`). `arc` limits it to a partial ring (radians)."""
    bm = bmesh.new()
    arc_len = arc or math.tau
    closed = arc is None
    n_major = major_seg if closed else major_seg + 1
    rings = []
    for i in range(n_major):
        a = arc_len * i / major_seg - (0 if closed else arc_len / 2)
        ring = []
        for j in range(minor_seg):
            b = math.tau * j / minor_seg
            x = (major + minor * math.cos(b)) * math.cos(a)
            y = (major + minor * math.cos(b)) * math.sin(a)
            z = minor * math.sin(b)
            ring.append(bm.verts.new((x * scale[0], y * scale[1], z * scale[2])))
        rings.append(ring)
    for i in range(n_major if closed else n_major - 1):
        r0, r1 = rings[i], rings[(i + 1) % n_major]
        for j in range(minor_seg):
            bm.faces.new((r0[j], r0[(j + 1) % minor_seg], r1[(j + 1) % minor_seg], r1[j]))
    m = rot.to_4x4() if rot else Matrix.Identity(4)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_from_bmesh(name, bm, mat)


def rounded_box(name, size, center, mat=None, bevel=0.01, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=3, affect="EDGES", profile=0.5)
    m = rot.to_4x4() if rot else Matrix.Identity(4)
    bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector(center)) @ m, verts=bm.verts)
    return mesh_from_bmesh(name, bm, mat)


def tube(name, points, radii, mat=None, resolution=4, caps=True, segments=10, cyclic=False):
    """A tapered tube along points (a curve with bevel), converted to a mesh."""
    cu = bpy.data.curves.new(name + "_curve", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = 1.0
    cu.bevel_resolution = max(1, segments // 4)
    cu.use_fill_caps = caps
    cu.resolution_u = resolution
    sp = cu.splines.new("NURBS")
    sp.points.add(len(points) - 1)
    for p, co, r in zip(sp.points, points, radii):
        p.co = (*co, 1.0)
        p.radius = r
    sp.order_u = min(4, len(points))
    sp.use_cyclic_u = cyclic
    sp.use_endpoint_u = not cyclic
    tmp = link(bpy.data.objects.new(name + "_tmp", cu))
    ob = evaluated_copy(tmp, name)
    remove(tmp)
    bpy.data.curves.remove(cu)
    if mat:
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    shade_smooth(ob)
    return ob


class Surface:
    """Ray-casting helper: find points on a mesh (e.g. where a nose or eye sits on the face)."""

    def __init__(self, ob):
        deps = bpy.context.evaluated_depsgraph_get()
        self.tree = BVHTree.FromObject(ob, deps)
        self.mw = ob.matrix_world

    def front(self, x, z, y_from=-1.0):
        """First hit casting from far in front (-Y) towards +Y at (x, z)."""
        origin = Vector((x, y_from, z))
        hit, normal, _, _ = self.tree.ray_cast(origin, Vector((0, 1, 0)))
        return (hit, normal) if hit else (Vector((x, -0.14, z)), Vector((0, -1, 0)))

    def toward(self, origin, direction):
        hit, normal, _, _ = self.tree.ray_cast(Vector(origin), Vector(direction).normalized())
        return (hit, normal) if hit else (None, None)


def align_to_normal(normal):
    """Rotation turning the local -Y axis to face along `normal`."""
    return Vector((0, -1, 0)).rotation_difference(normal).to_matrix()
