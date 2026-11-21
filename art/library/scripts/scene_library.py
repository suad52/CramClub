"""
The whole library, assembled from every asset module: the scene the web GLB is exported from,
and the source of the atmosphere renders.

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
        --python art/library/scripts/scene_library.py -- --save art/library/build/library.blend \
        [--out DIR --shots hall,rotunda,...] [--mood day|evening] [--size 1600x900] [--samples 96]

Then `pnpm library:export && pnpm library:pack` ships it to the web.

Architecture modules build in place from plan.py. Furniture modules register builders for the
plan's item kinds (KIND_BUILDERS, see ASSETS.md); each distinct (kind, variant) is built once and
placed as linked copies, so the GLB stores one mesh per variant and the web instances it.
Missing modules are skipped with a note, so the scene still builds while rooms are in progress.
"""

from __future__ import annotations

import argparse
import importlib
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
import scene_milestone as SM  # noqa: E402

T0 = time.time()


def log(msg):
    print(f"[library {time.time() - T0:6.1f}s] {msg}", flush=True)


SKIP = {m for m in os.environ.get("OVR_SKIP_MODULES", "").split(",") if m}


def module(name):
    if name in SKIP:
        return None
    try:
        return importlib.import_module(name)
    except Exception as e:  # noqa: BLE001
        log(f"  module {name} unavailable: {e}")
        return None


def call(mod, names, *args, **kw):
    """Calls the first function in `names` that `mod` has (module APIs differ a little)."""
    if mod is None:
        return None
    for n in names:
        fn = getattr(mod, n, None)
        if callable(fn):
            log(f"  {mod.__name__}.{n}()")
            try:
                return fn(*args, **kw)
            except Exception as e:  # noqa: BLE001
                log(f"  {mod.__name__}.{n} failed: {e!r}")
                import traceback
                traceback.print_exc()
                return None
    log(f"  {mod.__name__}: none of {names}")
    return None


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------

FURNITURE_MODULES = ("furn_rotunda", "furn_lobby", "furn_study", "furn_digital", "room_lounge", "props_signage", "furn_boards")
# Kinds placed by dedicated code below (hall table sets bring their own chairs and lamps).
SPECIAL_KINDS = {"table_communal"}


def build_roofs():
    """Lids over every room above its ceiling, so daylight only enters through windows/laylight."""
    col = C.collection("Roof", C.collection("ARCHITECTURE"))
    plaster = M.mat("plaster")
    lids = {
        "hall": (P.HALL, P.HALL_WALL_TOP),
        "lobby": (P.LOBBY, P.LOBBY_CEILING + 0.5),
        "quiet": (P.QUIET, P.WING_CEILING + 0.5),
        "group": (P.GROUP, P.WING_CEILING + 0.5),
        "lounge": (P.LOUNGE, P.LOUNGE_CEILING + 0.6),
        "computers": (P.COMPUTERS, P.WING_CEILING + 0.5),
        "services": (P.SERVICES, P.WING_CEILING + 0.5),
    }
    rooms = {r.id for r in P.ROOMS}
    for rid, (r, top) in lids.items():
        if rid not in rooms:
            continue
        x0, y0, x1, y1 = SM._rect_bl(r)
        # 2 cm short of the wall's outer face, so a lower lid never ends coplanar with a taller
        # neighbour's wall (that z-fought as a dark slot from outside).
        g = 0.78
        C.box_minmax(f"Roof_{rid}", (x0 - g, y0 - g, top), (x1 + g, y1 + g, top + 0.3), plaster, col=col)


# ---------------------------------------------------------------------------
# Placeholders: furniture whose modeller hasn't delivered yet still shows up, filling its plan
# footprint, so nothing in the game is an invisible obstacle. Real builders replace them.
# ---------------------------------------------------------------------------

def _p_box(parts, size, center, key, bevel=0.01):
    ob = C.box(f"ph_{len(parts)}", size, center, M.mat(key), bevel_w=bevel)
    C.uv_box(ob, M.tex_size(key))
    parts.append(ob)


def _p_cyl(parts, r, h, center, key, r2=None, seg=32):
    ob = C.cylinder(f"ph_{len(parts)}", r, r if r2 is None else r2, h, center, M.mat(key), segments=seg)
    C.uv_box(ob, M.tex_size(key))
    parts.append(ob)


def placeholder(item):
    """A tidy stand-in for `item` that fills its plan footprint (front -Y, floor z = 0)."""
    k = P.KINDS[item.kind]
    w, d, h = k["w"], k["d"], k["h"]
    kind = item.kind
    parts = []
    if kind == "rug":
        rw, rd = item.w or w, item.d or d
        ob = C.box("ph_rug", (rw, rd, 0.012), (0, 0, 0.006), M.mat("rug_persian" if rd > 2 else "rug_red"), bevel_w=0.004)
        me = ob.data
        me.uv_layers.new(name="UVMap")
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                me.uv_layers.active.data[li].uv = (co.x / rw + 0.5, co.y / rd + 0.5)
        parts.append(ob)
    elif k["shape"] == "none":  # wall-mounted board: back on the wall plane y = 0
        y0 = k.get("mount_y", 1.0)
        face = {"whiteboard_wall": "whiteboard", "screen_wall": "screen", "noticeboard": "cork"}.get(kind, "cork")
        _p_box(parts, (w, d, h), (0, -d / 2, y0 + h / 2), "walnut")
        _p_box(parts, (w - 0.08, 0.01, h - 0.08), (0, -d - 0.004, y0 + h / 2), face, bevel=0.002)
    elif "seats" in k:  # chairs, sofas, benches, window seats
        sh = k["seat_h"]
        soft = {"sofa_chesterfield": "leather_brown", "armchair_club": "leather_burgundy",
                "window_seat": "fabric_green", "chair_task": "fabric_green"}.get(kind, "leather_green")
        _p_box(parts, (w, d, sh - 0.08), (0, 0, (sh - 0.08) / 2), "walnut")
        _p_box(parts, (w - 0.04, d - 0.06, 0.1), (0, -0.02, sh - 0.05), soft, bevel=0.03)
        if h > sh + 0.15:  # a back on the +Y side (the sitter faces -Y)
            _p_box(parts, (w, 0.16, h - sh), (0, d / 2 - 0.08, sh + (h - sh) / 2), soft, bevel=0.03)
        if kind in ("sofa_chesterfield", "armchair_club"):
            for sx in (-1, 1):
                _p_box(parts, (0.16, d, h * 0.72), (sx * (w / 2 - 0.08), 0, h * 0.36), soft, bevel=0.04)
    elif k["shape"] == "circle":
        r = w / 2
        if kind.startswith("plant"):
            _p_cyl(parts, r * 0.45, h * 0.3, (0, 0, h * 0.15), "terracotta", r2=r * 0.55)
            parts.append(C.sphere("ph_leaves", r * 0.9, (0, 0, h * 0.62), M.mat("foliage"), scale=(1, 1, 0.9)))
        elif kind == "globe_floor":
            _p_cyl(parts, 0.04, h * 0.55, (0, 0, h * 0.275), "walnut")
            _p_cyl(parts, r * 0.6, 0.05, (0, 0, 0.025), "walnut")
            parts.append(C.sphere("ph_globe", r * 0.55, (0, 0, h - r * 0.55), M.mat("parchment" if "parchment" in M.PALETTE else "paper")))
        elif kind == "desk_research_ring":
            prof = [(r - 0.55, 0.0), (r, 0.0), (r, h), (r - 0.55, h)]
            parts.append(C.lathe("ph_ring", prof, 64, M.mat("walnut")))
            parts.append(C.lathe("ph_ring_top", [(r - 0.6, h), (r + 0.03, h), (r + 0.03, h + 0.04), (r - 0.6, h + 0.04)], 64, M.mat("leather_green")))
        else:  # round tables, side tables, lamps, stands
            top = "tabletop" if kind.startswith("table") else "brass_aged"
            _p_cyl(parts, r, 0.04, (0, 0, h - 0.02), top, seg=48)
            _p_cyl(parts, 0.05, h - 0.04, (0, 0, (h - 0.04) / 2), "walnut")
            _p_cyl(parts, r * 0.55, 0.04, (0, 0, 0.02), "walnut")
    elif kind == "carrel":  # a desk with side and back screens; the student sits on the -Y side
        _p_box(parts, (w, d, 0.04), (0, 0, 0.74), "tabletop", bevel=0.006)
        for sx in (-1, 1):
            _p_box(parts, (0.035, d, h), (sx * (w / 2 - 0.0175), 0, h / 2), "walnut")
        _p_box(parts, (w, 0.035, h - 0.76), (0, d / 2 - 0.0175, 0.76 + (h - 0.76) / 2), "fabric_green")
        _p_box(parts, (w - 0.07, 0.2, 0.025), (0, d / 2 - 0.12, 1.12), "walnut")
    elif h <= 0.85:  # tables and desks: a top on four legs
        top = "felt_green" if kind == "table_reading_green" else "tabletop"
        _p_box(parts, (w, d, 0.045), (0, 0, h - 0.0225), top, bevel=0.008)
        for sx in (-1, 1):
            for sy in (-1, 1):
                _p_box(parts, (0.06, 0.06, h - 0.045), (sx * (w / 2 - 0.06), sy * (d / 2 - 0.06), (h - 0.045) / 2), "walnut")
        _p_box(parts, (w - 0.1, d - 0.1, 0.09), (0, 0, h - 0.09), "walnut")
    else:  # cabinets, carrels, desks with hutches, fireplace, racks, stations
        body = {"fireplace": "limestone_plain", "water_station": "chrome", "printer_station": "oak",
                "bins_pair": "iron"}.get(kind, "walnut")
        _p_box(parts, (w, d, 0.1), (0, 0, 0.05), body)
        _p_box(parts, (w - 0.04, d - 0.04, h - 0.16), (0, 0, 0.1 + (h - 0.16) / 2), body)
        _p_box(parts, (w + 0.04, d + 0.04, 0.06), (0, 0, h - 0.03), body)
        if kind in ("cabinet_display", "table_vitrine"):
            _p_box(parts, (w - 0.12, 0.01, h - 0.3), (0, -d / 2 - 0.006, h / 2 + 0.05), "glass", bevel=0.0)
        if kind == "fireplace":
            _p_box(parts, (w * 0.5, 0.05, h * 0.42), (0, -d / 2 - 0.02, h * 0.21 + 0.1), "iron", bevel=0.0)
    ob = C.join(parts, f"Placeholder_{kind}")
    ob["ovr_placeholder"] = True
    return ob


def build_stairs_placeholder():
    """Plain stone flights on the plan's stair ramps (until arch_stairs delivers), so players
    never walk up invisible steps: solid steps on the nosing line, a walnut handrail on posts."""
    col = C.collection("Stairs_Standin", C.collection("ARCHITECTURE"))
    st = P.STAIRS
    n, riser, tread = st["risers"], st["riser"], st["tread"]
    for fl in st["flights"]:
        b = fl["bounds"]
        parts = []
        for i in range(n):
            z_hi = fl["bottom"] - i * tread              # south edge of step i (web z)
            z_lo = max(fl["top"], z_hi - tread)
            top = (i + 1) * riser
            ob = C.box(f"step_{i}", (b["maxX"] - b["minX"], z_hi - z_lo, top),
                       ((b["minX"] + b["maxX"]) / 2, -(z_lo + z_hi) / 2, top / 2), M.mat("limestone_plain"), bevel_w=0.006)
            C.uv_box(ob, M.tex_size("limestone_plain"))
            parts.append(ob)
        x = fl["inner_x"] + (0.06 if fl["inner_x"] < 0 else -0.06)
        length = math.hypot(fl["bottom"] - fl["top"], n * riser)
        pitch = math.atan2(n * riser, fl["bottom"] - fl["top"])
        rail = C.box("rail", (0.07, length, 0.06), (0, 0, 0), M.mat("walnut"), bevel_w=0.01)
        rail.rotation_euler = (pitch, 0, 0)
        rail.location = (x, -(fl["top"] + fl["bottom"]) / 2, (n * riser) / 2 + 0.95)
        parts.append(rail)
        for k in range(9):
            zz = fl["bottom"] - (k + 0.5) * (fl["bottom"] - fl["top"]) / 9
            floor_y = (fl["bottom"] - zz) / tread * riser
            post = C.box("post", (0.045, 0.045, 0.95), (x, -zz, floor_y + 0.475), M.mat("iron"))
            parts.append(post)
        C.move_to(C.join(parts, f"Architecture_Stairs_Placeholder_{fl['id']}"), col)


def place_furniture():
    """Every plan item whose kind a furniture module registered, as linked copies per variant."""
    registry = {}
    for name in FURNITURE_MODULES:
        mod = module(name)
        kb = getattr(mod, "KIND_BUILDERS", None) if mod else None
        if kb:
            registry.update(kb)
            log(f"  {name}: {sorted(kb)}")
    import furn_hall
    registry.setdefault("chair_reading", lambda item: furn_hall.build_chair_reading())
    study = sys.modules.get("furn_study")
    if study is not None and hasattr(study, "K_PULL"):
        study.K_PULL = 0.0  # the card catalogue's pulled drawer would stick out past its collider
    protos, placed, missing = {}, 0, {}
    col = C.collection("FURNITURE_PLAN")
    hall_tables = {it.id for it in P.ITEMS if it.kind == "table_communal"}
    for it in P.ITEMS:
        if (it.kind in SPECIAL_KINDS or (it.kind == "chair_reading" and it.table in hall_tables)
                or (it.kind == "rug" and it.zone == "hall")):
            continue
        builder = registry.get(it.kind)
        if builder is None:
            missing[it.kind] = missing.get(it.kind, 0) + 1
            builder = placeholder
        key = (it.kind, it.seed, it.label)
        if key not in protos:
            try:
                protos[key] = builder(it)
            except Exception as e:  # noqa: BLE001
                log(f"  builder {it.kind} failed for {it.id}: {e!r}")
                protos[key] = None
            if protos[key] is not None:
                C.move_to(protos[key], col) if protos[key].users_collection else None
                root = protos[key]
            else:
                continue
        else:
            if protos[key] is None:
                continue
            root = SM.dup_tree(protos[key], f"{protos[key].name}_{it.id}", col)
        C.place(root, it.x, it.y, it.z, it.rot)
        placed += 1
    log(f"  placed {placed} items; placeholders (no builder yet) for {missing}")


def place_desk_lamps():
    import furn_hall
    if not P.GREEN_LAMPS:
        return
    proto = furn_hall.build_lamp_banker_green()
    col = C.collection("FURNITURE_PLAN")
    for i, (x, z) in enumerate(P.GREEN_LAMPS):
        lamp = proto if i == 0 else SM.dup_tree(proto, f"Prop_Lamp_Banker_{i + 1:02d}", col)
        # On the reading table's centre line, facing the nearest chair side.
        C.place(lamp, x, 0.76, z, 0.0)


def hang_lights():
    import light_chandelier
    for lid in ("chandelier_w", "chandelier_e"):
        light = next(L for L in P.LIGHTS if L["id"] == lid)
        anchor = bpy.data.objects.get(f"Anchor_Ceiling_{lid}")
        top = anchor.location.z if anchor else P.HALL_CEILING
        ax, ay = (anchor.location.x, anchor.location.y) if anchor else (light["x"], -light["z"])
        ch = light_chandelier.build_chandelier_grand(drop=top - 6.0 - 2.2, name=f"Light_Chandelier_MainHall_{lid[-1].upper()}")
        ch.location = (ax, ay, 6.0)
    lantern = next((L for L in P.LIGHTS if L["id"] == "lobby_lantern"), None)
    if lantern:
        bottom = lantern["y"] - 0.8
        ln = light_chandelier.build_lantern_pendant(drop=P.LOBBY_CEILING - bottom - 1.66, name="Light_Lantern_Lobby")
        ln.location = C.bl(lantern["x"], bottom, lantern["z"])
    crown = next((L for L in P.LIGHTS if L["id"] == "rotunda_crown"), None)
    if crown is None:
        return
    rot = module("furn_rotunda")
    anchor = bpy.data.objects.get("Anchor_Ceiling_rotunda_crown")
    if rot is not None and hasattr(rot, "build_chandelier_rotunda"):
        top = anchor.location.z if anchor else P.ROTUNDA_CEILING
        bottom = crown["y"] - 1.0
        ch = call(rot, ["build_chandelier_rotunda"], drop=max(1.0, top - bottom - 2.0))
        if ch is not None:
            ch.location = C.bl(crown["x"], bottom, crown["z"])


def build(books=True):
    import arch_ceiling
    import arch_gallery
    import arch_shell
    import arch_windows
    import bookcases

    C.reset_scene()
    log("walls")
    arch_shell.build_hall_shell()
    for w in P.WALLS:
        if w.id not in SM.HALL_WALL_IDS:
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

    hall_only = getattr(P, "HALL_ONLY", False)
    rotunda = None if hall_only else module("arch_rotunda")
    interiors = None if hall_only else module("arch_interiors")
    log("floors and roofs")
    SM.build_floors()
    if rotunda is not None:  # it lays its own radial floor
        old = bpy.data.objects.get("Architecture_Floor_Rotunda")
        if old:
            bpy.data.objects.remove(old, do_unlink=True)
    build_roofs()

    log("hall ceiling and gallery")
    arch_ceiling.build_hall_ceiling()
    arch_gallery.build_gallery(landing=not hall_only)

    if not hall_only:  # the rooms beyond the hall (walled off while the library is just the hall)
        log("rotunda")
        if call(rotunda, ["build_rotunda", "build_all", "build"]) is None:
            SM.build_rotunda_standin()
        log("stairs")
        if call(module("arch_stairs"), ["build_stairs", "build_all", "build"]) is None:
            build_stairs_placeholder()
        log("room interiors")
        if call(interiors, ["build_interiors", "build_all"]) is None:
            arch_ceiling.build_lobby_ceiling()

    log("bookcases" + (" and books" if books else ""))
    bookcases.build_all(seed=1, instance=books)

    log("hall table sets")
    SM_build_table_sets()
    SM.build_runners()
    log("plan furniture")
    place_furniture()
    place_desk_lamps()
    log("lights")
    hang_lights()
    log("signage")
    call(module("props_signage"), ["build_signage"])
    log("exterior")
    if call(module("exterior"), ["build_exterior"]) is None:
        SM.build_ground()


def SM_build_table_sets():
    """The hall's 12 dressed tables (chairs, lamps, props), linked copies of one set."""
    import furn_hall
    proto, roots, n = None, [], 0
    for it in P.ITEMS:
        if it.kind != "table_communal":
            continue
        n += 1
        if proto is None:
            proto = root = furn_hall.build_table_set(number=n)
            # The set pulls one chair out at an angle; in the game a chair must stand where the
            # plan's seat and collider are, so push it back in.
            for ch in proto.children:
                if abs(ch.location.x - 0.86) < 0.02 and abs(ch.location.y + 1.235) < 0.02:
                    ch.location = (0.62, -1.3, 0.0)
                    ch.rotation_euler = (0.0, 0.0, math.radians(-90.0))
        else:
            root = SM.dup_tree(proto, f"Furniture_TableSet_{n:02d}", C.collection(f"Furniture_TableSet_{n:02d}"))
        C.place(root, it.x, 0.0, it.z, 0.0 if n % 2 else math.pi)
        roots.append(root)
    for k, root in enumerate(roots, 1):
        drop = {0: ("Laptop",), 1: ("Book_Open",), 2: ("Notebook", "Pencil"), 3: ()}[k % 4]
        for ch in list(root.children_recursive):
            if any(t in ch.name for t in drop):
                bpy.data.objects.remove(ch, do_unlink=True)


# ---------------------------------------------------------------------------
# Lighting: every light_points prop becomes a real light; chandeliers get a soft rig
# ---------------------------------------------------------------------------

def light_props(scene, energy_by_kind=None, day=True):
    """Real lights at every object's `light_points` (lamps, pendants, the fire, newel lamps...)."""
    import furn_hall
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and o.get("light_points") is not None
              and not o.name.endswith("_bulbs")]
    before = {o.name for o in bpy.data.objects if o.type == "LIGHT"}
    furn_hall._light_lamps(meshes, 18.0 if day else 30.0)
    # Empties / roots that carry light points (fixtures built as hierarchies).
    for o in bpy.data.objects:
        if o.type == "MESH" or o.get("light_points") is None:
            continue
        color = tuple(o.get("light_color", (1.0, 0.8, 0.55)))[:3]
        for i, p in enumerate(o["light_points"]):
            name = o.name.lower()
            w = 120 if "fire" in name else 40 if ("pendant" in name or "newel" in name) else 18
            R.point_light(f"{o.name}_L{i}", o.matrix_world @ Vector(p), w * (1.0 if day else 1.6), color, 0.05)
    n = sum(1 for o in bpy.data.objects if o.type == "LIGHT" and o.name not in before)
    log(f"  {n} prop lights")


def light_building(scene, mood="day", sun_w=35.0, sky_w=2.5, laylight_w=2500.0, chand_w=80.0):
    for ob in list(bpy.data.objects):
        if ob.type == "LIGHT":
            bpy.data.objects.remove(ob, do_unlink=True)
    day = mood == "day"
    SM.light_scene(scene, mood, sun_w=sun_w, sky_w=sky_w, laylight_w=laylight_w, chand_w=chand_w,
                   lamp_w=0.0, fill_w=0.0)
    # Chandelier rig for the rotunda corona, like the hall's.
    for root in [o for o in bpy.data.objects if o.parent is None and "rotunda" in o.name.lower()
                 and o.name.startswith("Light_Chandelier")]:
        c = root.location
        core = R.point_light(f"{root.name}_Core", (c.x, c.y, c.z + 0.8), chand_w * 3 * (1 if day else 2), (1, 0.82, 0.6), 0.8)
        core.data.use_shadow = False
    light_props(scene, day=day)


SHOTS = dict(SM.SHOTS)
SHOTS.update({
    "lobby": dict(loc=(0.0, 1.62, 19.4), at=(0.0, 3.6, 9.0), lens=18),
    "stairs": dict(loc=(3.0, 1.6, 17.5), at=(-5.2, 3.2, 12.0), lens=20),
    "rotunda": dict(loc=(15.6, 1.7, -1.0), at=(31.0, 6.5, -1.0), lens=17),
    "dome": dict(loc=(21.0, 1.4, 1.5), at=(23.4, 17.0, -1.2), lens=14),
    "lounge": dict(loc=(-15.6, 1.6, 3.6), at=(-23.2, 1.3, -1.0), lens=20),
    "quiet": dict(loc=(-7.0, 1.6, 9.6), at=(-17.5, 1.2, 18.0), lens=20),
    "group": dict(loc=(7.0, 1.6, 9.6), at=(17.0, 1.2, 17.0), lens=20),
    "computers": dict(loc=(2.2, 1.6, -11.3), at=(-12.5, 1.0, -15.0), lens=20),
})


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="")
    ap.add_argument("--shots", default="")
    ap.add_argument("--size", default="1600x900")
    ap.add_argument("--samples", type=int, default=96)
    ap.add_argument("--mood", default="day")
    ap.add_argument("--exposure", type=float, default=None)
    ap.add_argument("--haze", type=float, default=None)
    ap.add_argument("--save", default="")
    ap.add_argument("--load", default="")
    ap.add_argument("--no-books", action="store_true")
    a = ap.parse_args(argv)

    if a.load:
        bpy.ops.wm.open_mainfile(filepath=a.load)
        log(f"loaded {a.load}")
    else:
        build(books=not a.no_books)
        log("built")
        if a.save:
            os.makedirs(os.path.dirname(os.path.abspath(a.save)), exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(a.save))
            log(f"saved {a.save}")
    if not a.shots:
        return
    os.makedirs(a.out, exist_ok=True)
    scene = bpy.context.scene
    w, h = (int(v) for v in a.size.split("x"))
    R.engine(scene, "CYCLES", a.samples, (w, h))
    preset = SM.MOODS[a.mood]
    scene.view_settings.exposure = preset["exposure"] if a.exposure is None else a.exposure
    light_building(scene, a.mood, **{k: v for k, v in preset["light"].items() if k in ("sun_w", "sky_w", "laylight_w", "chand_w")})
    SM.atmosphere(scene, haze=preset["haze"] if a.haze is None else a.haze)
    cam = R.camera(lens=20)
    for name in a.shots.split(","):
        s = SHOTS[name]
        cam.data.lens = s["lens"]
        R.look(cam, C.bl(*s["loc"]), C.bl(*s["at"]))
        log(f"render {name}")
        R.render(os.path.join(a.out, f"{name}.png"))
    log("done")


if __name__ == "__main__":
    main()
