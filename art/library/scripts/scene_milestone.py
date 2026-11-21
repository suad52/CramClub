"""
Milestone scene: the Grand Reading Hall assembled from the asset modules, with stand-in
neighbouring rooms, sun shafts through the north windows, lit chandeliers and desk lamps.
Renders a set of atmosphere shots for review.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
        --python art/library/scripts/scene_milestone.py -- --out DIR [--shots hero,gallery] \
        [--size 1600x900] [--samples 64] [--engine EEVEE|CYCLES] [--save path.blend] [--no-books]

Everything here is placement and lighting: the models come from arch_shell, arch_windows,
arch_ceiling, arch_gallery, bookcases, furn_hall and light_chandelier. Rooms that aren't
modelled yet (the rotunda, the lounge furniture, the wings) are plain stand-ins.
"""

from __future__ import annotations

import argparse
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import lib_core as C  # noqa: E402
import lib_materials as M  # noqa: E402
import lib_render as R  # noqa: E402
import plan as P  # noqa: E402

T0 = time.time()


def log(msg):
    print(f"[scene {time.time() - T0:6.1f}s] {msg}", flush=True)


# ---------------------------------------------------------------------------
# Floors, roofs and stand-ins
# ---------------------------------------------------------------------------

def _uv_planar(ob, size, origin=(0.0, 0.0)):
    """Top-down planar UVs in metres / size (floors)."""
    me = ob.data
    if not me.uv_layers:
        me.uv_layers.new(name="UVMap")
    uv = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = ob.matrix_world @ me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = ((co.x - origin[0]) / size, (co.y - origin[1]) / size)


def _rect_bl(r):
    """Plan rect -> Blender (x0, y0, x1, y1)."""
    return r["minX"], -r["maxZ"], r["maxX"], -r["minZ"]


def build_floors():
    col = C.collection("Floors", C.collection("ARCHITECTURE"))
    out = []
    b = P.BUILDING
    base = C.box_minmax("Architecture_Floor_Base", (b["minX"], -b["maxZ"], -0.3), (b["maxX"], -b["minZ"], -0.002),
                        M.mat("stone_tiles"), col=col)
    _uv_planar(base, M.tex_size("stone_tiles"))
    out.append(base)
    for room in P.ROOMS:
        key = room.floor
        if room.shape == "polygon":
            cx, cz = room.center
            rr = room.radius / math.cos(math.pi / room.sides) + 0.05
            pts = [(cx + rr * math.cos(math.radians(15 + 30 * k)), -(cz + rr * math.sin(math.radians(15 + 30 * k))))
                   for k in range(room.sides)]
            pts.reverse()  # counter-clockwise in Blender XY
            ob = C.prism(f"Architecture_Floor_{room.id.capitalize()}", pts, -0.2, 0.0, M.mat(key), col=col)
        else:
            x0, y0, x1, y1 = _rect_bl(room.bounds)
            ob = C.box_minmax(f"Architecture_Floor_{room.id.capitalize()}", (x0, y0, -0.2), (x1, y1, 0.0), M.mat(key), col=col)
        _uv_planar(ob, M.tex_size(key))
        out.append(ob)
    return out


def build_roofs():
    """Closed lids over every room so the only daylight comes through windows and the laylight."""
    col = C.collection("Roof", C.collection("ARCHITECTURE"))
    plaster = M.mat("plaster")
    out = []
    lids = {
        "hall": (P.HALL, P.HALL_WALL_TOP, 0.8),
        "lobby": (P.LOBBY, P.LOBBY_CEILING + 0.3, 0.3),
        "quiet": (P.QUIET, P.WING_CEILING + 0.3, 0.8),
        "group": (P.GROUP, P.WING_CEILING + 0.3, 0.8),
        "lounge": (P.LOUNGE, P.LOUNGE_CEILING + 0.4, 0.8),
        "computers": (P.COMPUTERS, P.WING_CEILING + 0.3, 0.8),
        "services": (P.SERVICES, P.WING_CEILING + 0.3, 0.8),
    }
    for rid, (r, top, grow) in lids.items():
        x0, y0, x1, y1 = _rect_bl(r)
        out.append(C.box_minmax(f"Roof_{rid}", (x0 - grow, y0 - grow, top), (x1 + grow, y1 + grow, top + 0.3), plaster, col=col))
    # Plain ceilings for rooms without a modelled one yet.
    for rid, r, h in (("quiet", P.QUIET, P.WING_CEILING), ("group", P.GROUP, P.WING_CEILING),
                      ("lounge", P.LOUNGE, P.LOUNGE_CEILING), ("computers", P.COMPUTERS, P.WING_CEILING),
                      ("services", P.SERVICES, P.WING_CEILING)):
        x0, y0, x1, y1 = _rect_bl(r)
        top = P.LOUNGE_CEILING + 0.4 if rid == "lounge" else P.WING_CEILING + 0.3
        ob = C.box_minmax(f"Architecture_Ceiling_{rid.capitalize()}_Plain", (x0, y0, h), (x1, y1, top), plaster, col=col)
        C.uv_box(ob, M.tex_size("plaster"))
        out.append(ob)
    return out


def build_rotunda_standin():
    """12 limestone wall panels and a flat lid: enough to read through the rotunda arch."""
    col = C.collection("Rotunda_Standin", C.collection("ARCHITECTURE"))
    stone = M.mat("limestone")
    cx, cz = P.ROTUNDA_C
    a = P.ROTUNDA_APOTHEM
    width = 2 * a * math.tan(math.radians(15)) + 0.9
    H = 11.0
    out = []
    aw, ah = P.ROTUNDA["arch"]["width"], P.ROTUNDA["arch"]["apex"]
    for bay in P.ROTUNDA_BAYS:
        ang = bay["angle"]
        rot = -ang  # Blender: web +Z is -Y, so the bay angle flips
        mx = cx + math.cos(ang) * (a + 0.4)
        mz = cz + math.sin(ang) * (a + 0.4)
        pieces = []
        if bay["role"] == "arch":
            side = (width - aw) / 2
            for s in (-1, 1):
                off = s * (aw / 2 + side / 2)
                pieces.append(((off, side), (0, H)))
            pieces.append(((0.0, aw), (ah, H)))
        else:
            pieces.append(((0.0, width), (0, H)))
        for i, ((off, w), (z0, z1)) in enumerate(pieces):
            ob = C.box(f"Rotunda_Wall_{bay['index']:02d}_{i}", (0.8, w, z1 - z0), (0, 0, 0), stone, col=col)
            ob.rotation_euler = (0, 0, rot)
            tang = Vector((-math.sin(ang), -math.cos(ang), 0))  # along the wall, Blender coords
            ob.location = Vector((mx, -mz, (z0 + z1) / 2)) + tang * off
            bpy.context.view_layer.update()
            C.uv_box(ob, M.tex_size("limestone"))
            out.append(ob)
    pts = [(cx + (a + 0.9) / math.cos(math.radians(15)) * math.cos(math.radians(15 + 30 * k)),
            -(cz + (a + 0.9) / math.cos(math.radians(15)) * math.sin(math.radians(15 + 30 * k)))) for k in range(12)]
    pts.reverse()
    out.append(C.prism("Rotunda_Lid", pts, H, H + 0.4, M.mat("plaster"), col=col))
    return out


def build_lift_standin():
    col = C.collection("Lift_Standin", C.collection("ARCHITECTURE"))
    s = P.LIFT["shaft"]
    x0, y0, x1, y1 = _rect_bl(s)
    ob = C.box_minmax("Architecture_LiftShaft", (x0, y0, 0.0), (x1, y1, P.HALL_CEILING), M.mat("limestone"), col=col)
    C.uv_box(ob, M.tex_size("limestone"))
    out = [ob]
    try:
        import arch_windows as AW
        for lvl in (0.0, P.GALLERY_Y):
            d = AW.build_door("elevator", wall_thickness=0.3, name=f"Architecture_Door_Elevator_{int(lvl * 10):02d}")
            C.place(d, P.LIFT["door_x"], lvl, P.LIFT["door_z"], -math.pi / 2)
            out.append(d)
    except Exception as e:  # noqa: BLE001
        log(f"lift doors skipped: {e}")
    return out


def build_runners():
    col = C.collection("Rugs", C.collection("FURNITURE"))
    out = []
    for it in P.ITEMS:
        if it.kind != "rug" or it.zone != "hall":
            continue
        w, d = it.w, it.d
        ob = C.box(f"Prop_Rug_Runner_{it.id.split('-')[-1].upper()}", (w, d, 0.012), (0, 0, 0.006), M.mat("rug_red"), bevel_w=0.004, col=col)
        me = ob.data
        if not me.uv_layers:
            me.uv_layers.new(name="UVMap")
        uv = me.uv_layers.active.data
        size = M.tex_size("rug_red")
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                uv[li].uv = ((co.x + w / 2) / size, (co.y + d / 2) / d)
        C.place(ob, it.x, 0.0, it.z, it.rot)
        out.append(ob)
    return out


def build_ground():
    m = bpy.data.materials.new("Scene_Ground")
    m.use_nodes = True
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (0.16, 0.2, 0.12, 1)
    bsdf.inputs["Roughness"].default_value = 0.95
    ob = C.box_minmax("Scene_Ground", (-200, -200, -0.6), (200, 200, -0.31), m, col=C.collection("EXTERIOR"))
    return [ob]


# ---------------------------------------------------------------------------
# Assembly
# ---------------------------------------------------------------------------

HALL_WALL_IDS = ("hall_n", "hall_s", "hall_w", "hall_e")


def dup_tree(src, name, col):
    """Linked copy of an object hierarchy (children keep their parent-relative transforms)."""
    def rec(o, parent, nm):
        c = o.copy()
        c.name = nm
        col.objects.link(c)
        if parent is not None:
            c.parent = parent
            c.matrix_parent_inverse = o.matrix_parent_inverse.copy()
        for ch in o.children:
            suffix = ch.name[len(src.name):] if ch.name.startswith(src.name) else "_" + ch.name
            rec(ch, c, name + suffix)
        return c
    return rec(src, None, name)


def build(books=True):
    import arch_ceiling
    import arch_gallery
    import arch_shell
    import arch_windows
    import bookcases
    import furn_hall
    import light_chandelier

    C.reset_scene()
    log("shell")
    arch_shell.build_hall_shell()
    for w in P.WALLS:
        if w.id not in HALL_WALL_IDS:
            arch_shell.build_wall(w)

    log("windows and doors")
    cache = {}
    for w in P.WALLS:
        for o in w.openings:
            try:
                ob, h = arch_windows.build_for_opening(o, w, cache=cache)
            except Exception as e:  # noqa: BLE001
                log(f"  opening {o.id} failed: {e}")
                continue
            if ob is not None:
                arch_windows.place_in_wall(ob, w, o, h)

    log("floors, roofs, stand-ins")
    build_floors()
    build_roofs()
    build_rotunda_standin()
    build_lift_standin()
    build_ground()

    log("ceilings")
    arch_ceiling.build_hall_ceiling()
    try:
        arch_ceiling.build_lobby_ceiling()
    except Exception as e:  # noqa: BLE001
        log(f"  lobby ceiling skipped: {e}")

    log("gallery")
    arch_gallery.build_gallery(landing=True)

    log("bookcases" + (" and books" if books else ""))
    bookcases.build_all(seed=1, instance=books)

    log("table sets")
    n = 0
    proto = None
    roots = []
    for it in P.ITEMS:
        if it.kind != "table_communal":
            continue
        n += 1
        if proto is None:
            proto = root = furn_hall.build_table_set(number=n)
        else:  # linked copies: meshes shared, as the web build instances them
            root = dup_tree(proto, f"Furniture_TableSet_{n:02d}", C.collection(f"Furniture_TableSet_{n:02d}"))
        C.place(root, it.x, 0.0, it.z, 0.0 if n % 2 else math.pi)
        roots.append(root)
    # Vary the props (after copying) so the tables don't all look staged the same way.
    for k, root in enumerate(roots, 1):
        drop = {0: ("Laptop",), 1: ("Book_Open",), 2: ("Notebook", "Pencil"), 3: ()}[k % 4]
        for ch in list(root.children_recursive):
            if any(t in ch.name for t in drop):
                bpy.data.objects.remove(ch, do_unlink=True)
    build_runners()

    log("chandeliers")
    for lid in ("chandelier_w", "chandelier_e"):
        light = next(L for L in P.LIGHTS if L["id"] == lid)
        anchor = bpy.data.objects.get(f"Anchor_Ceiling_{lid}")
        top = anchor.location.z if anchor else P.HALL_CEILING
        ax, ay = (anchor.location.x, anchor.location.y) if anchor else (light["x"], -light["z"])
        bottom = 6.0
        ch = light_chandelier.build_chandelier_grand(drop=top - bottom - 2.2, name=f"Light_Chandelier_MainHall_{lid[-1].upper()}")
        ch.location = (ax, ay, bottom)
    return n


# ---------------------------------------------------------------------------
# Lighting
# ---------------------------------------------------------------------------

SUN_DIR = (-0.5, 0.75, -1.0)   # web direction toward the sun: north-west, about 34 degrees up


# Tuned in Cycles (AgX, Medium High Contrast). Day: low sun through the north windows; evening:
# chandeliers and desk lamps under a dark blue sky.
MOODS = {
    "day": dict(exposure=-1.0, haze=0.008,
                light=dict(sun_w=35, sky_w=2.5, laylight_w=2500, chand_w=80, lamp_w=14, fill_w=0.5)),
    "evening": dict(exposure=0.2, haze=0.003,
                    light=dict(chand_w=60, lamp_w=20, fill_w=0.4)),   # light_scene doubles chandeliers at night
}


def light_scene(scene, mood="day", sun_w=35.0, sky_w=2.5, laylight_w=2500.0, chand_w=80.0, lamp_w=14.0, fill_w=0.5):
    import furn_hall

    for ob in list(bpy.data.objects):
        if ob.type == "LIGHT":
            bpy.data.objects.remove(ob, do_unlink=True)
    day = mood == "day"
    # Low sun through the big arched windows: long shafts across the hall and window-shaped pools
    # (with the glazing bars' shadows) on the southern tables and the aisle.
    sun = R.sun("Sun", direction_web=SUN_DIR, strength=sun_w if day else 0.0,
                color=(1.0, 0.88, 0.72), angle_deg=0.8)
    R.sky_world(scene, strength=sky_w if day else 0.035, sun_ob=sun,
                tint=(0.55, 0.7, 0.95) if day else (0.16, 0.22, 0.42))
    # Laylight: cool daylight falling through the glass from the well above it.
    import arch_ceiling
    try:
        x0, y0, x1, y1 = arch_ceiling.laylight_rect()
    except Exception:  # noqa: BLE001
        x0, y0, x1, y1 = -4.8, -1.3, 4.8, 3.3
    sky = bpy.data.lights.new("Laylight_Sky", "AREA")
    sky.shape = "RECTANGLE"
    sky.size, sky.size_y = x1 - x0, y1 - y0
    sky.energy = laylight_w if day else 60
    sky.color = (0.8, 0.88, 1.0)
    ob = bpy.data.objects.new("Laylight_Sky", sky)
    scene.collection.objects.link(ob)
    # Just under the coffer line: the glass itself is mostly opaque (it glows by emission), so the
    # daylight it lets down is this soft area light.
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, P.HALL_CEILING - 0.15)

    # Chandeliers: a ring of soft shadowed lights at the lamp tiers plus a shadowless core.
    for root in [o for o in bpy.data.objects if o.name.startswith("Light_Chandelier_MainHall") and o.parent is None]:
        c = root.location
        for k in range(4):
            a = 2 * math.pi * (k + 0.5) / 4
            R.point_light(f"{root.name}_L{k}", (c.x + 1.75 * math.cos(a), c.y + 1.75 * math.sin(a), c.z + 1.5),
                          chand_w * (1.0 if day else 2.0), (1.0, 0.78, 0.52), 0.15)
        core = R.point_light(f"{root.name}_Core", (c.x, c.y, c.z + 1.2), chand_w * 4 * (1.0 if day else 2.0),
                             (1.0, 0.8, 0.56), 0.9)
        core.data.use_shadow = False
    # Desk lamps: bulbs split into shadowless glow objects, then a soft downward spot per bulb
    # (no shadow maps: two dozen shadowed lamps overflow EEVEE's shadow pool).
    lamps = [o for o in bpy.data.objects if o.type == "MESH" and o.get("light_points") is not None
             and not o.name.endswith("_bulbs")]
    before = {o.name for o in bpy.data.objects if o.type == "LIGHT"}
    furn_hall._light_lamps(lamps, lamp_w * (1.0 if day else 1.4))
    for o in bpy.data.objects:
        if o.type == "LIGHT" and o.name not in before:
            o.data.type = "SPOT"
            o.data.spot_size = math.radians(150)
            o.data.spot_blend = 0.65
            o.data.use_shadow = scene.render.engine == "CYCLES"   # the shade casts the pool
            o.rotation_euler = (0, 0, 0)
    # Stand-in rooms: warm fills so the arches don't open onto black.
    for name, p, e in (("Rotunda_Fill", (23.4, 6.0, -1.0), 1200), ("Lounge_Fill", (-19.0, 4.0, -1.0), 400),
                       ("Lobby_Fill", (0.0, 6.0, 15.0), 600)):
        L = R.point_light(name, C.bl(*p), e * fill_w, (1.0, 0.86, 0.68), 1.5)
        L.data.use_shadow = False
    return sun


def atmosphere(scene, haze=0.004):
    old = bpy.data.objects.get("Haze")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    if haze > 0:
        h = P.HALL
        R.haze(scene, (h["minX"] + 0.05, -h["maxZ"] + 0.05, 0.02), (h["maxX"] - 0.05, -h["minZ"] - 0.05, 12.55),
               density=haze, color=(1.0, 0.96, 0.9))
    ee = scene.eevee
    for attr, val in (("volumetric_tile_size", "4"), ("volumetric_samples", 96), ("volumetric_end", 70.0),
                      ("use_volumetric_shadows", True), ("volumetric_shadow_samples", 32),
                      ("volumetric_ray_depth", 8), ("shadow_ray_count", 2), ("shadow_step_count", 8),
                      ("shadow_pool_size", "2048"), ("shadow_resolution_scale", 1.0)):
        try:
            setattr(ee, attr, val)
        except (AttributeError, TypeError):
            pass


# ---------------------------------------------------------------------------
# Shots (web coordinates: x east, y up, z south)
# ---------------------------------------------------------------------------

SHOTS = {
    # Standing in the south aisle under the gallery edge, looking up the hall to the north windows.
    "hero": dict(loc=(0.0, 1.62, 5.0), at=(0.0, 7.4, -10.0), lens=17),
    # From the north-east gallery, looking down across the tables.
    "gallery": dict(loc=(11.4, 6.25, -8.7), at=(-3.0, 1.8, 2.5), lens=20),
    # Under a chandelier, looking up into the coffers and the laylight.
    "ceiling": dict(loc=(-1.8, 1.4, 2.0), at=(-5.6, 10.6, -1.6), lens=15),
    # Along a table, seated eye height, toward the north bookcases.
    "table": dict(loc=(-1.05, 1.22, 0.2), at=(-2.6, 0.95, -5.4), lens=26),
    # Across the hall to the west: lounge arch, inscription, gallery.
    "west": dict(loc=(9.0, 1.7, -1.0), at=(-14.0, 5.0, -1.0), lens=18),
    # Toward the rotunda arch on the east wall.
    "east": dict(loc=(-7.0, 1.7, 3.2), at=(14.0, 4.8, -1.0), lens=20),
    # Debug: straight down onto the aisle under the middle oculus.
    "down": dict(loc=(2.0, 4.0, 0.4), at=(2.3, 0.0, 0.2), lens=18),
    # From the gallery landing over the lobby arch, the long axis.
    "landing": dict(loc=(0.0, 6.3, 7.6), at=(0.0, 3.2, -9.0), lens=18),
}


def shoot(cam, name, out_dir):
    s = SHOTS[name]
    cam.data.lens = s["lens"]
    R.look(cam, C.bl(*s["loc"]), C.bl(*s["at"]))
    return R.render(os.path.join(out_dir, f"{name}.png"))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--shots", default=",".join(SHOTS))
    ap.add_argument("--size", default="1600x900")
    ap.add_argument("--samples", type=int, default=128)
    ap.add_argument("--engine", default="CYCLES")
    ap.add_argument("--mood", default="day")
    ap.add_argument("--exposure", type=float, default=None)
    ap.add_argument("--save", default="")
    ap.add_argument("--no-books", action="store_true")
    ap.add_argument("--haze", type=float, default=None)
    ap.add_argument("--bloom", type=float, default=0.0)
    ap.add_argument("--load", default="")
    ap.add_argument("--light", default="", help="overrides, e.g. sun_w=4,sky_w=1,laylight_w=1800")
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)

    if a.load:
        bpy.ops.wm.open_mainfile(filepath=a.load)
        log(f"loaded {a.load}")
    else:
        n = build(books=not a.no_books)
        log(f"built ({n} table sets)")
        if a.save:
            os.makedirs(os.path.dirname(a.save), exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=a.save)
            log(f"saved {a.save}")
    scene = bpy.context.scene
    w, h = (int(v) for v in a.size.split("x"))
    R.engine(scene, a.engine, a.samples, (w, h))
    preset = MOODS[a.mood]
    scene.view_settings.exposure = preset["exposure"] if a.exposure is None else a.exposure
    kw = dict(preset["light"])
    kw.update({k: float(v) for k, v in (p.split("=") for p in a.light.split(",") if p)})
    light_scene(scene, a.mood, **kw)
    atmosphere(scene, haze=preset["haze"] if a.haze is None else a.haze)
    if a.bloom > 0:
        try:
            import light_chandelier
            light_chandelier._glare(scene, strength=a.bloom, threshold=4.0, size=5)
        except Exception as e:  # noqa: BLE001
            log(f"no bloom: {e}")
    else:
        try:
            scene.compositing_node_group = None
        except Exception:  # noqa: BLE001
            pass
    cam = R.camera(lens=20)
    for name in [s for s in a.shots.split(",") if s]:
        log(f"render {name}")
        shoot(cam, name, a.out)
    log("done")


if __name__ == "__main__":
    main()
