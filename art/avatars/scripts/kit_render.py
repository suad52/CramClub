"""Studio lighting, camera framings and rendering for previews and option thumbnails."""

import bpy
import math
from mathutils import Vector


def setup_studio(scene, size=256, samples=24):
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    try:
        scene.eevee.taa_render_samples = samples
    except AttributeError:
        pass
    try:
        scene.view_settings.view_transform = "AgX"
    except TypeError:
        scene.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("Studio")
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.55, 0.52, 0.5, 1)
    bg.inputs["Strength"].default_value = 0.55
    scene.world = world

    def area(name, loc, energy, size_, color=(1, 1, 1)):
        light = bpy.data.lights.new(name, "AREA")
        light.energy = energy
        light.size = size_
        light.color = color
        ob = bpy.data.objects.new(name, light)
        scene.collection.objects.link(ob)
        ob.location = loc
        direction = Vector((0, 0, 1.2)) - Vector(loc)
        ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        return ob

    area("Key", (1.4, -2.2, 2.4), 260, 1.6, (1.0, 0.96, 0.9))
    area("Fill", (-1.8, -1.6, 1.4), 110, 2.2, (0.9, 0.95, 1.0))
    area("Rim", (0.2, 2.2, 2.2), 180, 1.4, (1.0, 0.95, 0.88))

    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    return cam


# name: (target point, yaw degrees (0 = front), pitch degrees, distance, lens mm)
FRAMINGS = {
    "full": ((0, 0, 0.92), 18, 4, 4.4, 50),
    "front": ((0, 0, 0.92), 0, 2, 4.4, 50),
    "back": ((0, 0, 0.92), 180, 4, 4.4, 50),
    "head": ((0, 0, 1.6), 24, 4, 1.25, 50),
    "face": ((0, 0, 1.585), 0, 0, 0.95, 50),
    "eyes": ((0, 0, 1.6), 0, 0, 0.62, 50),
    "nose": ((0, 0, 1.56), 38, 2, 0.62, 50),
    "mouth": ((0, 0, 1.535), 12, 0, 0.6, 50),
    "neck": ((0, 0, 1.36), 18, 6, 1.2, 50),
    "ear": ((0, 0, 1.56), 62, 2, 0.75, 50),
    # Tighter framings used for the creator's option thumbnails.
    "t_eyes": ((0, 0, 1.6), 0, 0, 0.44, 50),
    "t_brows": ((0, 0, 1.615), 0, 0, 0.44, 50),
    "t_nose": ((0, -0.08, 1.565), 40, 2, 0.4, 50),
    "t_mouth": ((0, -0.1, 1.53), 10, 2, 0.34, 50),
    "t_details": ((0.02, 0, 1.57), 14, 0, 0.5, 50),
    "t_top": ((0, 0, 1.13), 20, 4, 1.45, 50),
    "t_bottom": ((0, 0, 0.5), 20, 6, 1.7, 50),
    "t_feet": ((0, -0.04, 0.1), 32, 16, 0.85, 50),
    "t_back": ((0, 0, 1.18), 150, 8, 1.75, 50),
    "torso": ((0, 0, 1.12), 20, 4, 2.4, 50),
    "legs": ((0, 0, 0.55), 20, 6, 2.6, 50),
    "feet": ((0, -0.03, 0.08), 35, 18, 1.15, 50),
    "back34": ((0, 0, 1.2), 150, 8, 2.6, 50),
}


def frame(cam, name):
    target, yaw, pitch, dist, lens = FRAMINGS[name]
    t = Vector(target)
    yaw_r, pitch_r = math.radians(yaw), math.radians(pitch)
    # Yaw 0 looks at the character's face from in front (-Y side).
    offset = Vector((math.sin(yaw_r) * math.cos(pitch_r), -math.cos(yaw_r) * math.cos(pitch_r), math.sin(pitch_r))) * dist
    cam.location = t + offset
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


def render(scene, path):
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def only_show(objects, visible_names):
    for ob in objects:
        hidden = ob.name not in visible_names
        ob.hide_render = hidden
        ob.hide_viewport = hidden
