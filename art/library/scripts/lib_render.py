"""
Rendering helpers for asset previews and atmosphere shots.

Asset modules implement `preview(out_dir)` and use `preview_objects(...)` to render a few
angles of what they built on a neutral, warm studio set. Run any module with:

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
        --python art/library/scripts/run_asset.py -- --module table_set --out /tmp/prev

then make a contact sheet with `python3 art/library/scripts/sheet.py OUT.png COLS TILE imgs...`.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Vector


def engine(scene, kind="EEVEE", samples=48, size=(1280, 960), transparent=False):
    scene.render.engine = "CYCLES" if kind == "CYCLES" else "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = transparent
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    try:
        scene.view_settings.view_transform = "AgX"
        scene.view_settings.look = "AgX - Medium High Contrast"
    except TypeError:
        scene.view_settings.view_transform = "Standard"
    if kind == "CYCLES":
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            scene.cycles.device = "GPU"
        except Exception:
            pass
    else:
        ee = scene.eevee
        for attr, val in (("taa_render_samples", samples), ("use_raytracing", True), ("use_shadows", True),
                          ("fast_gi_method", "GLOBAL_ILLUMINATION"), ("use_fast_gi", True)):
            try:
                setattr(ee, attr, val)
            except (AttributeError, TypeError):
                pass
        try:
            ee.ray_tracing_options.resolution_scale = "2"
        except Exception:
            pass
    return scene


def world(scene, color=(0.62, 0.58, 0.52), strength=0.6):
    w = bpy.data.worlds.get("PreviewWorld") or bpy.data.worlds.new("PreviewWorld")
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*color, 1)
    bg.inputs["Strength"].default_value = strength
    scene.world = w
    return w


def area_light(name, loc, target, energy, size, color=(1, 1, 1)):
    light = bpy.data.lights.new(name, "AREA")
    light.energy = energy
    light.size = size
    light.color = color
    ob = bpy.data.objects.new(name, light)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return ob


def studio(scene, center=(0, 0, 0.8), radius=2.0, floor=True, floor_color=(0.52, 0.42, 0.33)):
    """Three-point warm studio sized to the subject, with a soft floor."""
    world(scene, (0.6, 0.56, 0.5), 0.45)
    c = Vector(center)
    r = max(radius, 0.4)
    area_light("Key", c + Vector((1.6, -2.2, 2.0)) * r, c, 220 * r * r, 1.4 * r, (1.0, 0.95, 0.88))
    area_light("Fill", c + Vector((-2.2, -1.4, 1.0)) * r, c, 80 * r * r, 2.0 * r, (0.88, 0.93, 1.0))
    area_light("Rim", c + Vector((0.4, 2.4, 2.2)) * r, c, 140 * r * r, 1.4 * r, (1.0, 0.92, 0.8))
    if floor:
        me = bpy.data.meshes.new("PreviewFloor")
        s = 40 * r
        me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
        ob = bpy.data.objects.new("PreviewFloor", me)
        bpy.context.scene.collection.objects.link(ob)
        m = bpy.data.materials.new("PreviewFloorMat")
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*floor_color, 1)
        bsdf.inputs["Roughness"].default_value = 0.8
        me.materials.append(m)


def camera(name="Camera", lens=50):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cam = bpy.data.objects.new(name, bpy.data.cameras.new(name))
        bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_start = 0.02
    cam.data.clip_end = 400
    bpy.context.scene.camera = cam
    return cam


def look(cam, location, target):
    cam.location = Vector(location)
    cam.rotation_euler = (Vector(target) - Vector(location)).to_track_quat("-Z", "Y").to_euler()


def bounds(objects):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objects:
        if ob.type not in ("MESH", "CURVE", "FONT"):
            continue
        for corner in ob.bound_box:
            w = ob.matrix_world @ Vector(corner)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return lo, hi


def frame(cam, objects, yaw=30, pitch=12, margin=1.15):
    """Points the camera at the objects from (yaw, pitch) degrees; yaw 0 = from the front (-Y)."""
    lo, hi = bounds(objects)
    c = (lo + hi) / 2
    radius = (hi - lo).length / 2 * margin
    fov = 2 * math.atan(18 / cam.data.lens)  # 36 mm sensor width, conservative
    dist = radius / math.sin(fov / 2)
    y, p = math.radians(yaw), math.radians(pitch)
    loc = c + Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist
    look(cam, loc, c)
    return c, radius


def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def preview_objects(objects, out_dir, name, views=((25, 12), (-35, 22), (180, 10)), size=(960, 960), samples=48, lens=50, closeups=()):
    """Studio renders of `objects` from several (yaw, pitch) views (+ optional closeups:
    [(name, objects_subset, yaw, pitch)]). Returns the PNG paths."""
    import os
    scene = bpy.context.scene
    engine(scene, "EEVEE", samples, size)
    lo, hi = bounds(objects)
    studio(scene, ((lo + hi) / 2).to_tuple(), max(0.5, (hi - lo).length / 2))
    cam = camera(lens=lens)
    paths = []
    for i, (yaw, pitch) in enumerate(views):
        frame(cam, objects, yaw, pitch)
        paths.append(render(os.path.join(out_dir, f"{name}_{i + 1}.png")))
    for cname, sub, yaw, pitch in closeups:
        frame(cam, sub, yaw, pitch, margin=1.05)
        paths.append(render(os.path.join(out_dir, f"{name}_{cname}.png")))
    return paths


# ---------------------------------------------------------------------------
# Atmosphere shots of the assembled library
# ---------------------------------------------------------------------------

def sun(name="Sun", direction_web=(0.34, 0.6, -1.0), strength=4.5, color=(1.0, 0.93, 0.82), angle_deg=1.5):
    """A sun shining FROM `direction_web` (web coords: +x east, +y up, -z north)."""
    light = bpy.data.lights.new(name, "SUN")
    light.energy = strength
    light.color = color
    light.angle = math.radians(angle_deg)
    ob = bpy.data.objects.new(name, light)
    bpy.context.scene.collection.objects.link(ob)
    dx, dy, dz = direction_web
    to_sun = Vector((dx, -dz, dy)).normalized()  # Blender coords
    ob.rotation_euler = (-to_sun).to_track_quat("-Z", "Y").to_euler()
    return ob


def sky_world(scene, strength=0.9, sun_ob=None, tint=(0.62, 0.74, 0.92)):
    """Soft daylight sky (gradient), bright enough to read through the windows."""
    w = bpy.data.worlds.get("SkyWorld") or bpy.data.worlds.new("SkyWorld")
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputWorld")
    bg = nt.nodes.new("ShaderNodeBackground")
    grad = nt.nodes.new("ShaderNodeTexGradient")
    coord = nt.nodes.new("ShaderNodeTexCoord")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    nt.links.new(coord.outputs["Generated"], sep.inputs[0])
    nt.links.new(sep.outputs["Z"], ramp.inputs["Fac"])
    ramp.color_ramp.elements[0].color = (0.85, 0.83, 0.8, 1)
    ramp.color_ramp.elements[1].color = (*tint, 1)
    nt.links.new(ramp.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = strength
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])
    scene.world = w
    return w


def haze(scene, bounds_lo, bounds_hi, density=0.006, color=(1.0, 0.95, 0.88)):
    """A volume box filling the room so sunbeams through the windows read as light shafts."""
    lo, hi = Vector(bounds_lo), Vector(bounds_hi)
    me = bpy.data.meshes.new("Haze")
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=hi - lo, verts=bm.verts)
    bmesh.ops.translate(bm, vec=(lo + hi) / 2, verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Haze", me)
    scene.collection.objects.link(ob)
    m = bpy.data.materials.new("HazeMat")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    vol = nt.nodes.new("ShaderNodeVolumePrincipled")
    vol.inputs["Density"].default_value = density
    vol.inputs["Color"].default_value = (*color, 1)
    nt.links.new(vol.outputs["Volume"], out.inputs["Volume"])
    me.materials.append(m)
    ob.visible_shadow = False
    return ob


def point_light(name, location, energy, color=(1.0, 0.82, 0.6), radius=0.1):
    light = bpy.data.lights.new(name, "POINT")
    light.energy = energy
    light.color = color
    light.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, light)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(location)
    return ob
