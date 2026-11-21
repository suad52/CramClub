"""
The OVR library floor plan: the single source of truth for the Blender build (where every wall,
opening, bookcase and piece of furniture goes) and for the web client and game server
(colliders, walk surfaces, seats, zones, anchors and runtime lights).

Pure Python (no bpy), so it runs inside Blender and on its own:

    python3 art/library/scripts/plan.py            # writes packages/shared/src/world/library-plan.json

Coordinates are WEB coordinates in metres: +X east, +Y up, +Z south (the entrance), -Z north.
An item's `rot` (radians about +Y) turns its local front (+Z) toward the direction it faces:
rot 0 faces south (+Z), pi/2 faces east (+X), pi faces north, -pi/2 faces west.
In Blender (Z up, glTF-export convention) a web point (x, y, z) is (x, -z, y) and `rot` is
rotation_euler.z.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import asdict, dataclass, field

PI = math.pi
HALF_PI = PI / 2

# ---------------------------------------------------------------------------
# Key heights and dimensions (metres)
# ---------------------------------------------------------------------------

GALLERY_Y = 4.6           # upper gallery floor
GALLERY_UNDERSIDE = 4.2   # bottom of the gallery slab / fascia
RAILING_H = 1.08          # gallery and stair railings
HALL_CORNICE = 11.6       # bottom of the main cornice band
HALL_CEILING = 12.6       # coffered ceiling soffit
HALL_WALL_TOP = 13.6      # top of the hall walls (roof structure above)
WING_CEILING = 4.4
LOBBY_CEILING = 8.0
LOUNGE_CEILING = 5.8
ROTUNDA_CEILING = 17.0    # crown of the dome (glazed oculus)
EXT_WALL = 0.8            # exterior / structural wall thickness
INT_WALL = 0.3            # partitions
STEP_UP = 0.55            # highest step a player climbs without stairs


def rect(x0, x1, z0, z1):
    return {"minX": round(min(x0, x1), 4), "maxX": round(max(x0, x1), 4), "minZ": round(min(z0, z1), 4), "maxZ": round(max(z0, z1), 4)}


def facing(dx, dz):
    """rot that makes an item's front (+Z) face direction (dx, dz)."""
    return math.atan2(dx, dz)


def local_to_world(x, z, rot, lx, lz):
    c, s = math.cos(rot), math.sin(rot)
    return x + lx * c + lz * s, z - lx * s + lz * c


# ---------------------------------------------------------------------------
# Rooms
# ---------------------------------------------------------------------------

@dataclass
class Room:
    id: str
    name: str
    zone: str
    shape: str               # "rect" | "circle" | "polygon"
    bounds: dict             # rect for every shape (bounding box for circles/polygons)
    floor_y: float
    ceiling_y: float
    floor: str               # floor finish (material id)
    center: tuple | None = None
    radius: float | None = None   # circle: inscribed radius (apothem for the 12-gon)
    sides: int | None = None


HALL = rect(-14, 14, -10, 8)
LOBBY = rect(-6, 6, 8.8, 20)
QUIET = rect(-18, -6.3, 8.8, 20)
GROUP = rect(6.3, 18, 8.8, 20)
LOUNGE = rect(-23.4, -14.8, -6.4, 4.4)
COMPUTERS = rect(-14, 2.8, -16.2, -10.8)
SERVICES = rect(3.1, 14, -16.2, -10.8)
ROTUNDA_C = (23.4, -1.0)
ROTUNDA_APOTHEM = 8.4     # inner face of each of the 12 walls
ROTUNDA_SIDES = 12

ROOMS = [
    Room("hall", "Grand Reading Hall", "hall", "rect", HALL, 0, HALL_CEILING, "parquet_herringbone"),
    Room("lobby", "Entrance Hall", "entrance", "rect", LOBBY, 0, LOBBY_CEILING, "marble_checker"),
    Room("quiet", "Quiet Study", "quiet", "rect", QUIET, 0, WING_CEILING, "carpet_quiet"),
    Room("group", "Group Study", "collab", "rect", GROUP, 0, WING_CEILING, "oak_boards"),
    Room("lounge", "Reading Lounge", "lounge", "rect", LOUNGE, 0, LOUNGE_CEILING, "oak_boards"),
    Room("computers", "Computers & Printing", "computers", "rect", COMPUTERS, 0, WING_CEILING, "carpet_tiles"),
    Room("services", "Services", "services", "rect", SERVICES, 0, WING_CEILING, "stone_tiles"),
    Room(
        "rotunda", "Reference Rotunda", "reference", "polygon",
        rect(ROTUNDA_C[0] - 8.7, ROTUNDA_C[0] + 8.7, ROTUNDA_C[1] - 8.7, ROTUNDA_C[1] + 8.7),
        0, ROTUNDA_CEILING, "parquet_radial", center=ROTUNDA_C, radius=ROTUNDA_APOTHEM, sides=ROTUNDA_SIDES,
    ),
]

# ---------------------------------------------------------------------------
# Walls and openings
# ---------------------------------------------------------------------------

@dataclass
class Opening:
    id: str
    kind: str          # arch | door_double | door_single | door_glazed | window_arched | window_tall | oculus | elevator | exit
    at: float          # centre along the wall's long axis (x for E-W walls, z for N-S walls)
    width: float
    y0: float
    y1: float          # top of the opening (apex for arches)
    passable: bool     # players can walk through
    label: str = ""    # sign text, if any
    spring: float | None = None   # arch springline height (arches/arched windows)


@dataclass
class Wall:
    id: str
    bounds: dict       # axis-aligned box footprint, thickness included
    y0: float
    y1: float
    axis: str          # "x": wall runs east-west; "z": runs north-south
    inside: str        # which face is the room side: "north" | "south" | "east" | "west" | "both"
    room: str          # room id the wall mainly belongs to (finish)
    openings: list = field(default_factory=list)


def arched(id_, at, width, sill, apex, kind="window_arched", passable=False, label=""):
    return Opening(id_, kind, at, width, sill, apex, passable, label, spring=apex - width / 2)


HALL_BAYS = [-11.2, -5.6, 0.0, 5.6, 11.2]         # window / oculus bay centres
HALL_PIERS = [-14.0, -8.4, -2.8, 2.8, 8.4, 14.0]   # pilaster lines

WALLS = [
    # ── Grand Reading Hall ──
    Wall("hall_n", rect(-14.8, 14.8, -10.8, -10), 0, HALL_WALL_TOP, "x", "south", "hall", [
        Opening("door_computers", "door_glazed", -5.6, 1.8, 0, 2.7, True, "Computers & Printing"),
        Opening("door_services", "door_glazed", 5.6, 1.8, 0, 2.7, True, "Washrooms · Services"),
        *[arched(f"window_hall_n{i + 1}", x, 3.2, 7.0, 11.2) for i, x in enumerate(HALL_BAYS)],
    ]),
    Wall("hall_s", rect(-14.8, 14.8, 8, 8.8), 0, HALL_WALL_TOP, "x", "north", "hall", [
        arched("arch_lobby", 0, 3.6, 0, 4.0, "arch", True, "Grand Reading Hall"),
        Opening("door_quiet", "door_glazed", -11.2, 1.8, 0, 2.7, True, "Quiet Study"),
        Opening("door_group", "door_glazed", 11.2, 1.8, 0, 2.7, True, "Group Study"),
        arched("arch_gallery_landing", 0, 3.2, GALLERY_Y, GALLERY_Y + 2.9, "arch", True),
        *[Opening(f"oculus_hall_s{i + 1}", "oculus", x, 2.4, 8.7, 11.1, False) for i, x in enumerate(HALL_BAYS)],
    ]),
    Wall("hall_w", rect(-14.8, -14, -10.8, 8.8), 0, HALL_WALL_TOP, "z", "east", "hall", [
        arched("arch_lounge", -1.0, 3.6, 0, 4.0, "arch", True, "Reading Lounge"),
    ]),
    Wall("hall_e", rect(14, 14.8, -10.8, 8.8), 0, HALL_WALL_TOP, "z", "west", "hall", [
        arched("arch_rotunda", -1.0, 4.4, 0, 8.5, "arch", True, "Reference Rotunda · Research Help"),
        Opening("lift_door_ground", "elevator", -8.6, 1.0, 0, 2.2, False, "Lift"),
        Opening("lift_door_gallery", "elevator", -8.6, 1.0, GALLERY_Y, GALLERY_Y + 2.2, False, "Lift"),
    ]),
    # ── Entrance hall ──
    Wall("lobby_w", rect(-6.3, -6, 8.8, 20), 0, LOBBY_CEILING + 0.3, "z", "east", "lobby", [
        Opening("door_lobby_quiet", "door_single", 10.0, 1.4, 0, 2.4, True, "Quiet Study"),
    ]),
    Wall("lobby_e", rect(6, 6.3, 8.8, 20), 0, LOBBY_CEILING + 0.3, "z", "west", "lobby", [
        Opening("door_lobby_group", "door_single", 10.0, 1.4, 0, 2.4, True, "Group Study"),
    ]),
    Wall("lobby_s", rect(-6.3, 6.3, 20, 20.8), 0, LOBBY_CEILING + 0.3, "x", "north", "lobby", [
        arched("door_main", 0, 2.8, 0, 4.6, "door_double", False, "Main entrance"),
        arched("window_lobby_w", -3.6, 1.6, 1.2, 5.8, "window_tall"),
        arched("window_lobby_e", 3.6, 1.6, 1.2, 5.8, "window_tall"),
    ]),
    # ── Quiet study (west wing) ──
    Wall("quiet_n", rect(-18.8, -14.8, 8, 8.8), 0, WING_CEILING + 0.3, "x", "south", "quiet"),
    Wall("quiet_w", rect(-18.8, -18, 8, 20.8), 0, WING_CEILING + 0.3, "z", "east", "quiet", [
        arched(f"window_quiet_w{i + 1}", z, 1.5, 0.9, 3.5, "window_tall") for i, z in enumerate([11.4, 14.4, 17.4])
    ]),
    Wall("quiet_s", rect(-18.8, -6.3, 20, 20.8), 0, WING_CEILING + 0.3, "x", "north", "quiet", [
        arched(f"window_quiet_s{i + 1}", x, 1.5, 0.9, 3.5, "window_tall") for i, x in enumerate([-15.6, -12.15, -8.7])
    ]),
    # ── Group study (east wing) ──
    Wall("group_n", rect(14.8, 18.8, 8, 8.8), 0, WING_CEILING + 0.3, "x", "south", "group"),
    Wall("group_e", rect(18, 18.8, 8, 20.8), 0, WING_CEILING + 0.3, "z", "west", "group", [
        arched(f"window_group_e{i + 1}", z, 1.5, 0.9, 3.5, "window_tall") for i, z in enumerate([9.9, 14.6])
    ]),
    Wall("group_s", rect(6.3, 18.8, 20, 20.8), 0, WING_CEILING + 0.3, "x", "north", "group", [
        arched(f"window_group_s{i + 1}", x, 1.5, 0.9, 3.5, "window_tall") for i, x in enumerate([8.4, 12.15, 15.9])
    ]),
    # ── Reading lounge (west) ──
    Wall("lounge_n", rect(-24.2, -14.8, -7.2, -6.4), 0, LOUNGE_CEILING + 0.4, "x", "south", "lounge", [
        arched(f"window_lounge_n{i + 1}", x, 1.8, 0.6, 4.2, "window_tall") for i, x in enumerate([-21.2, -17.4])
    ]),
    Wall("lounge_s", rect(-24.2, -14.8, 4.4, 5.2), 0, LOUNGE_CEILING + 0.4, "x", "north", "lounge", [
        arched(f"window_lounge_s{i + 1}", x, 1.8, 0.6, 4.2, "window_tall") for i, x in enumerate([-21.2, -17.4])
    ]),
    Wall("lounge_w", rect(-24.2, -23.4, -7.2, 5.2), 0, LOUNGE_CEILING + 0.4, "z", "east", "lounge"),
    # ── North wing: computers + services ──
    Wall("north_n", rect(-14.8, 14.8, -17, -16.2), 0, WING_CEILING + 0.3, "x", "south", "computers", [
        *[arched(f"window_computers{i + 1}", x, 1.5, 1.0, 3.5, "window_tall") for i, x in enumerate([-12.2, -8.6, -5.0, -1.4])],
        Opening("door_wc_women", "door_single", 4.7, 1.0, 0, 2.2, False, "Washroom · Women"),
        Opening("door_wc_men", "door_single", 6.5, 1.0, 0, 2.2, False, "Washroom · Men"),
        Opening("door_wc_accessible", "door_single", 8.5, 1.2, 0, 2.2, False, "Accessible Washroom"),
        Opening("door_print_room", "door_single", 10.5, 1.0, 0, 2.2, False, "Print & Copy Room"),
        Opening("door_staff", "door_single", 12.5, 1.0, 0, 2.2, False, "Staff Only"),
    ]),
    Wall("north_w", rect(-14.8, -14, -17, -10.8), 0, WING_CEILING + 0.3, "z", "east", "computers", [
        arched("window_computers_w", -13.5, 1.5, 1.0, 3.5, "window_tall"),
    ]),
    Wall("north_e", rect(14, 14.8, -17, -10.8), 0, WING_CEILING + 0.3, "z", "west", "services", [
        Opening("door_exit_north", "exit", -13.5, 1.2, 0, 2.3, False, "Emergency Exit"),
    ]),
    Wall("north_partition", rect(2.8, 3.1, -16.2, -10.8), 0, WING_CEILING, "z", "both", "services", [
        Opening("door_storage", "door_single", -13.5, 1.0, 0, 2.2, False, "Storage"),
    ]),
]

# The rotunda: 12 straight walls around ROTUNDA_C. Bay k faces direction angle k*30 degrees,
# measured from +X (east) toward +Z (south); bay 6 (west) is the arch from the hall.
ROTUNDA_BAYS = []
for k in range(ROTUNDA_SIDES):
    a = math.radians(k * 30)
    cx = ROTUNDA_C[0] + math.cos(a) * ROTUNDA_APOTHEM
    cz = ROTUNDA_C[1] + math.sin(a) * ROTUNDA_APOTHEM
    role = {0: "exit", 6: "arch", 1: "display", 11: "display"}.get(k, "books")
    ROTUNDA_BAYS.append({
        "index": k,
        "angle": a,
        "center": (round(cx, 4), round(cz, 4)),
        "width": round(2 * ROTUNDA_APOTHEM * math.tan(math.radians(15)), 4),
        "role": role,
        "rot": facing(ROTUNDA_C[0] - cx, ROTUNDA_C[1] - cz),   # faces the centre
    })

ROTUNDA = {
    "center": ROTUNDA_C,
    "apothem": ROTUNDA_APOTHEM,
    "sides": ROTUNDA_SIDES,
    "wall": EXT_WALL,
    "ground_tier_top": 5.0,      # bookcase bays + entablature
    "lunette_oculus_y": 8.6,     # centre of the round window in each bay
    "lunette_oculus_d": 2.2,
    "cornice_y": 10.6,
    "dome_spring_y": 11.0,
    "crown_y": ROTUNDA_CEILING,
    "skylight_radius": 3.6,
    "arch": {"width": 4.4, "spring": 6.3, "apex": 8.5},
    "exit": {"width": 1.8, "height": 2.6},
    "bays": ROTUNDA_BAYS,
}

# ---------------------------------------------------------------------------
# Upper gallery, stairs and lift
# ---------------------------------------------------------------------------

GALLERY = {
    "y": GALLERY_Y,
    "underside": GALLERY_UNDERSIDE,
    "runs": {
        "north": rect(-14, 14, -10, -7.4),
        "west": rect(-14, -10.6, -7.4, 5.4),
        "south": rect(-14, 14, 5.4, 8),
    },
    # Front edge of the gallery (railing line) and the arcade columns that carry it.
    "railings": [
        {"id": "railing_n", "a": (-10.6, -7.4), "b": (14, -7.4)},
        {"id": "railing_w", "a": (-10.6, -7.4), "b": (-10.6, 5.4)},
        {"id": "railing_s", "a": (-10.6, 5.4), "b": (14, 5.4)},
    ],
    "columns": [
        *[(x, -7.4) for x in (-10.6, -8.4, -2.8, 2.8, 8.4)],
        *[(x, 5.4) for x in (-10.6, -8.4, -2.8, 2.8, 8.4)],
        (-10.6, -3.13), (-10.6, 1.13),
    ],
    "column_radius": 0.24,
}

LANDING = rect(-6, 6, 8.8, 11.2)            # gallery-level landing over the lobby's north end
LANDING_PASSAGE = rect(-1.6, 1.6, 8, 8.8)   # through the hall's south wall at gallery level
STAIR_TREAD = 0.296
STAIR_RISERS = 25
FLIGHTS = [
    # Two straight flights up the lobby's side walls, rising north to the landing.
    {"id": "flight_w", "bounds": rect(-6, -4.4, 11.2, 18.6), "axis": "z", "top": 11.2, "bottom": 18.6, "inner_x": -4.4},
    {"id": "flight_e", "bounds": rect(4.4, 6, 11.2, 18.6), "axis": "z", "top": 11.2, "bottom": 18.6, "inner_x": 4.4},
]
STAIRS = {
    "risers": STAIR_RISERS,
    "riser": round(GALLERY_Y / STAIR_RISERS, 4),
    "tread": STAIR_TREAD,
    "width": 1.6,
    "flights": FLIGHTS,
    "landing": LANDING,
    "landing_railing": {"a": (-4.4, 11.2), "b": (4.4, 11.2)},
}

# The lift shaft stands outside the hall's east wall (between the hall and the rotunda), so the
# hall stays a clean rectangle; its doors open through the east wall at both levels.
LIFT = {
    "shaft": rect(14.8, 16.4, -9.6, -7.6),
    "door_x": 14.0,
    "door_z": -8.6,
    "door_width": 1.0,
    "levels": [0.0, GALLERY_Y],
}

# ---------------------------------------------------------------------------
# Furniture catalogue: footprint (local X width, local Z depth), height, collision and seats.
# Builders in Blender must match these sizes. Front = local +Z.
# ---------------------------------------------------------------------------

KINDS = {
    # Grand Reading Hall
    "table_communal": {"w": 1.0, "d": 4.0, "h": 0.76, "shape": "box"},
    "chair_reading": {"w": 0.48, "d": 0.5, "h": 0.95, "shape": "box", "seats": [(0, 0)], "seat_h": 0.46},
    "globe_floor": {"w": 0.8, "d": 0.8, "h": 1.25, "shape": "circle"},
    "gallery_desk": {"w": 1.2, "d": 0.6, "h": 0.76, "shape": "box"},
    "catalogue_cabinet": {"w": 1.4, "d": 0.6, "h": 1.15, "shape": "box"},
    # Lobby
    "desk_info": {"w": 3.2, "d": 1.1, "h": 1.08, "shape": "box"},
    "directory_board": {"w": 1.2, "d": 0.45, "h": 2.0, "shape": "box"},
    "bench_lobby": {"w": 1.8, "d": 0.5, "h": 0.46, "shape": "box", "seats": [(-0.45, 0.02), (0.45, 0.02)], "seat_h": 0.45},
    "coat_stand": {"w": 0.5, "d": 0.5, "h": 1.85, "shape": "circle"},
    "umbrella_stand": {"w": 0.36, "d": 0.36, "h": 0.6, "shape": "circle"},
    "noticeboard": {"w": 1.6, "d": 0.06, "h": 1.15, "shape": "none", "mount_y": 1.0},
    # Quiet study
    "carrel": {"w": 1.1, "d": 0.66, "h": 1.35, "shape": "box"},
    "desk_quiet": {"w": 1.6, "d": 0.8, "h": 0.76, "shape": "box"},
    # Group study
    "table_group_rect": {"w": 2.4, "d": 1.2, "h": 0.76, "shape": "box"},
    "table_group_round": {"w": 1.5, "d": 1.5, "h": 0.76, "shape": "circle"},
    "whiteboard_wall": {"w": 2.0, "d": 0.06, "h": 1.25, "shape": "none", "mount_y": 0.85},
    # A rolling double-sided board (furn_boards.py); its writing surface is centred 1.36 m up.
    "whiteboard_mobile": {"w": 1.6, "d": 0.55, "h": 1.95, "shape": "box", "board_y": 1.36},
    "screen_wall": {"w": 1.6, "d": 0.08, "h": 0.92, "shape": "none", "mount_y": 1.35},
    # Computers
    "desk_computer": {"w": 1.3, "d": 0.7, "h": 0.75, "shape": "box"},
    "chair_task": {"w": 0.6, "d": 0.6, "h": 1.0, "shape": "box", "seats": [(0, 0)], "seat_h": 0.47},
    "printer_station": {"w": 1.2, "d": 0.65, "h": 1.2, "shape": "box"},
    # Services
    "water_station": {"w": 0.6, "d": 0.35, "h": 1.5, "shape": "box"},
    "bins_pair": {"w": 0.8, "d": 0.4, "h": 0.85, "shape": "box"},
    # Lounge
    "armchair_club": {"w": 0.95, "d": 0.92, "h": 0.92, "shape": "box", "seats": [(0, 0.06)], "seat_h": 0.43},
    "sofa_chesterfield": {"w": 2.2, "d": 0.95, "h": 0.8, "shape": "box", "seats": [(-0.66, 0.06), (0, 0.06), (0.66, 0.06)], "seat_h": 0.44},
    "table_coffee": {"w": 1.3, "d": 0.7, "h": 0.45, "shape": "box"},
    "table_side": {"w": 0.5, "d": 0.5, "h": 0.6, "shape": "circle"},
    "lamp_floor": {"w": 0.45, "d": 0.45, "h": 1.65, "shape": "circle"},
    "fireplace": {"w": 2.6, "d": 0.75, "h": 2.4, "shape": "box"},
    "window_seat": {"w": 1.8, "d": 0.6, "h": 0.48, "shape": "box", "seats": [(-0.42, 0.04), (0.42, 0.04)], "seat_h": 0.46},
    "magazine_rack": {"w": 1.6, "d": 0.45, "h": 1.4, "shape": "box"},
    "rug": {"w": 1, "d": 1, "h": 0.02, "shape": "none"},
    # Rotunda
    "desk_research_ring": {"w": 3.8, "d": 3.8, "h": 1.08, "shape": "circle"},
    "table_reading_green": {"w": 2.4, "d": 1.0, "h": 0.76, "shape": "box"},
    "table_vitrine": {"w": 1.6, "d": 0.9, "h": 0.95, "shape": "box"},
    "cabinet_display": {"w": 3.6, "d": 0.55, "h": 2.3, "shape": "box"},
    # Everywhere
    "plant_large": {"w": 0.7, "d": 0.7, "h": 1.6, "shape": "circle"},
    "plant_small": {"w": 0.45, "d": 0.45, "h": 0.9, "shape": "circle"},
}


@dataclass
class Item:
    id: str
    kind: str
    x: float
    z: float
    rot: float
    zone: str
    y: float = 0.0                 # floor level it stands on
    w: float | None = None         # size overrides (rugs, window seats)
    d: float | None = None
    table: str | None = None       # chairs: the table they belong to; boards: their table
    label: str = ""
    seed: int = 0


ITEMS: list[Item] = []


def add(*items):
    ITEMS.extend(items)


def chair(id_, x, z, face_x, face_z, zone, table=None, kind="chair_reading", y=0.0):
    add(Item(id_, kind, round(x, 4), round(z, 4), facing(face_x - x, face_z - z), zone, y=y, table=table))


# ── Grand Reading Hall: twelve long tables in two rows either side of the central aisle ──
HALL_TABLE_X = [-9.1, -5.7, -2.3, 2.3, 5.7, 9.1]
HALL_TABLE_Z = [-4.6, 2.6]
HALL_LAMPS = []
n = 0
for tz in HALL_TABLE_Z:
    for tx in HALL_TABLE_X:
        n += 1
        tid = f"hall-t{n:02d}"
        add(Item(tid, "table_communal", tx, tz, 0, "hall", seed=n))
        HALL_LAMPS += [(tx, 0.76, tz - 1.0), (tx, 0.76, tz + 1.0)]
        c = 0
        for side in (-1, 1):
            for dz in (-1.3, 0.0, 1.3):
                c += 1
                chair(f"{tid}-c{c}", tx + side * 0.62, tz + dz, tx, tz + dz, "hall", table=tid)

add(Item("hall-globe", "globe_floor", 0.0, -6.2, 0.5, "hall"))
add(Item("hall-catalogue-n", "catalogue_cabinet", -12.3, -4.8, HALF_PI, "hall"))
add(Item("hall-catalogue-s", "catalogue_cabinet", -12.3, 2.8, HALF_PI, "hall"))
add(Item("hall-runner-w", "rug", -6.2, -1.0, 0, "hall", w=9.0, d=1.6, label="runner_red"))
add(Item("hall-runner-e", "rug", 6.2, -1.0, 0, "hall", w=9.0, d=1.6, label="runner_red"))
add(Item("hall-plant-1", "plant_large", 12.9, -3.9, 0, "hall", seed=1))
add(Item("hall-plant-2", "plant_large", 12.9, 1.9, 0, "hall", seed=2))

# Upper gallery desks along the west railing, looking out over the hall.
for i, gz in enumerate([-4.6, -1.0, 2.6]):
    gid = f"gallery-desk-{i + 1}"
    add(Item(gid, "gallery_desk", -11.02, gz, -HALF_PI, "gallery", y=GALLERY_Y))
    chair(f"{gid}-c1", -11.64, gz, -10.0, gz, "gallery", table=gid, y=GALLERY_Y)

# ── Entrance hall ──
add(Item("lobby-info-desk", "desk_info", 0, 14.6, 0, "entrance"))
add(Item("lobby-directory", "directory_board", -2.5, 16.6, facing(0.3, 1), "entrance"))
add(Item("lobby-bench-w", "bench_lobby", -3.6, 19.55, PI, "entrance"))
add(Item("lobby-bench-e", "bench_lobby", 3.6, 19.55, PI, "entrance"))
add(Item("lobby-coat-1", "coat_stand", 2.25, 19.45, 0, "entrance"))
add(Item("lobby-umbrella", "umbrella_stand", -1.85, 19.62, 0, "entrance"))
add(Item("lobby-notice-w", "noticeboard", -3.9, 8.83, 0, "entrance", label="events"))
add(Item("lobby-notice-e", "noticeboard", 3.9, 8.83, 0, "entrance", label="map"))
add(Item("lobby-plant-w", "plant_large", -5.35, 19.35, 0, "entrance", seed=3))
add(Item("lobby-plant-e", "plant_large", 5.35, 19.35, 0, "entrance", seed=4))

# ── Quiet study: carrels on two walls and a back-to-back island, plus two desks ──
def carrel(id_, x, z, student_rot, zone="quiet"):
    """A carrel and its chair; `student_rot` is the direction the student faces."""
    cr = student_rot + PI                      # carrel front faces the student
    add(Item(id_, "carrel", round(x, 4), round(z, 4), cr, zone))
    fx, fz = local_to_world(x, z, cr, 0, 0.62)
    add(Item(f"{id_}-c1", "chair_reading", round(fx, 4), round(fz, 4), student_rot, zone, table=id_))


for i in range(7):
    carrel(f"quiet-w{i + 1}", -17.67, 9.9 + i * 1.3, -HALF_PI)
for i in range(7):
    carrel(f"quiet-s{i + 1}", -16.1 + i * 1.3, 19.67, 0)
for i in range(5):
    carrel(f"quiet-iw{i + 1}", -12.48, 11.0 + i * 1.3, HALF_PI)    # west half: student sits west, faces east
    carrel(f"quiet-ie{i + 1}", -11.82, 11.0 + i * 1.3, -HALF_PI)   # east half: student sits east, faces west
for i, qz in enumerate([12.0, 16.4]):
    qid = f"quiet-desk-{i + 1}"
    add(Item(qid, "desk_quiet", -8.4, qz, 0, "quiet"))   # knee-hole side faces the chair (south)
    chair(f"{qid}-c1", -8.4, qz + 0.62, -8.4, qz, "quiet", table=qid)
add(Item("quiet-plant", "plant_large", -6.95, 19.35, 0, "quiet", seed=5))

# ── Group study: four tables (their ids are the shared-whiteboard ids), boards and screens ──
GROUP_TABLES = [
    ("collab-table-1", "table_group_rect", 9.4, 12.2, "west"),
    ("collab-table-2", "table_group_round", 14.6, 12.2, "east"),
    ("collab-table-3", "table_group_round", 9.4, 17.0, "west"),
    ("collab-table-4", "table_group_rect", 14.6, 17.0, "east"),
]
WHITEBOARDS = []
for i, (tid, kind, tx, tz, wall) in enumerate(GROUP_TABLES):
    add(Item(tid, kind, tx, tz, 0, "collab", label=f"Table {i + 1}"))
    if kind == "table_group_rect":
        c = 0
        for side in (-1, 1):
            for dx in (-0.6, 0.6):
                c += 1
                chair(f"{tid}-c{c}", tx + dx, tz + side * 0.95, tx + dx, tz, "collab", table=tid)
        for side in (-1, 1):
            c += 1
            chair(f"{tid}-c{c}", tx + side * 1.6, tz, tx, tz, "collab", table=tid)
    else:
        for c in range(5):
            a = PI / 2 + c * 2 * PI / 5
            chair(f"{tid}-c{c + 1}", tx + math.cos(a) * 1.1, tz + math.sin(a) * 1.1, tx, tz, "collab", table=tid)
    bx = 6.3 + 0.03 if wall == "west" else 18 - 0.03
    brot = HALF_PI if wall == "west" else -HALF_PI
    bid = f"whiteboard-{i + 1}"
    add(Item(bid, "whiteboard_wall", bx, tz, brot, "collab", table=tid))
    WHITEBOARDS.append({"id": bid, "table": tid, "x": bx, "z": tz, "rot": brot})
add(Item("group-screen-1", "screen_wall", 10.3, 19.96, PI, "collab"))
add(Item("group-screen-2", "screen_wall", 14.0, 19.96, PI, "collab"))
add(Item("group-plant", "plant_large", 17.35, 9.45, 0, "collab", seed=6))

# ── Computers & printing ──
COMPUTER_DESKS = []
for i in range(10):
    x = -12.9 + i * 1.45
    did = f"pc-n{i + 1}"
    add(Item(did, "desk_computer", x, -15.85, 0, "computers", seed=i % 3))   # front faces its chair (south)
    chair(f"{did}-c1", x, -15.1, x, -15.85, "computers", table=did, kind="chair_task")
    COMPUTER_DESKS.append(did)
for i, x in enumerate([-12.9, -11.45, -10.0, -8.55, -2.75, -1.3, 0.15]):
    did = f"pc-s{i + 1}"
    add(Item(did, "desk_computer", x, -11.15, PI, "computers", seed=(i + 1) % 3))   # faces its chair (north)
    chair(f"{did}-c1", x, -11.9, x, -11.15, "computers", table=did, kind="chair_task")
    COMPUTER_DESKS.append(did)
add(Item("printer-1", "printer_station", 2.15, -13.5, -HALF_PI, "computers"))

# ── Services corridor ──
add(Item("water-refill", "water_station", 8.0, -11.0, PI, "services"))
add(Item("bins-services", "bins_pair", 9.2, -11.03, PI, "services"))
add(Item("services-bench", "bench_lobby", 11.6, -11.1, PI, "services"))
add(Item("services-plant", "plant_large", 13.4, -11.4, 0, "services", seed=9))
add(Item("bins-lobby", "bins_pair", -2.6, 9.05, 0, "entrance"))

# ── Reading lounge ──
LC = (-19.4, -1.0)
add(Item("lounge-fireplace", "fireplace", -23.4 + 0.38, -1.0, HALF_PI, "lounge"))
add(Item("lounge-rug", "rug", LC[0], LC[1], 0, "lounge", w=5.6, d=4.6, label="rug_persian"))
add(Item("lounge-sofa-n", "sofa_chesterfield", -19.6, -3.25, 0, "lounge"))
add(Item("lounge-sofa-s", "sofa_chesterfield", -19.6, 1.25, PI, "lounge"))
add(Item("lounge-coffee", "table_coffee", -19.6, -1.0, 0, "lounge"))
for i, (ax, az) in enumerate([(-16.6, -2.1), (-16.6, 0.1)]):
    add(Item(f"lounge-armchair-{i + 1}", "armchair_club", ax, az, facing(-21.5 - ax, -1.0 - az), "lounge"))
# Reading corners either side of the fireplace: armchair, side table and floor lamp.
for i, (ax, az) in enumerate([(-22.15, -4.35), (-22.15, 2.35)]):
    add(Item(f"lounge-armchair-{i + 3}", "armchair_club", ax, az, facing(-19.4 - ax, -1.0 - az), "lounge"))
add(Item("lounge-side-1", "table_side", -22.95, -3.55, 0, "lounge"))
add(Item("lounge-side-2", "table_side", -22.95, 1.55, 0, "lounge"))
add(Item("lounge-lamp-1", "lamp_floor", -23.0, -5.5, 0, "lounge"))
add(Item("lounge-lamp-2", "lamp_floor", -22.95, 3.3, 0, "lounge"))
for i, x in enumerate([-21.2, -17.4]):
    add(Item(f"lounge-window-seat-n{i + 1}", "window_seat", x, -6.1, 0, "lounge"))
    add(Item(f"lounge-window-seat-s{i + 1}", "window_seat", x, 4.1, PI, "lounge"))
add(Item("lounge-magazines", "magazine_rack", -19.3, -6.175, 0, "lounge"))
add(Item("lounge-plant-1", "plant_large", -23.0, 4.0, 0, "lounge", seed=7))

# ── Reference rotunda ──
RC = ROTUNDA_C
add(Item("rotunda-desk", "desk_research_ring", RC[0], RC[1], HALF_PI, "reference"))
GREEN_LAMPS = []
for i, deg in enumerate([45, 135, 225, 315]):
    a = math.radians(deg)
    tx, tz = RC[0] + math.cos(a) * 4.8, RC[1] + math.sin(a) * 4.8
    rot = facing(RC[0] - tx, RC[1] - tz)
    tid = f"rotunda-t{i + 1}"
    add(Item(tid, "table_reading_green", round(tx, 4), round(tz, 4), rot, "reference"))
    c = 0
    for side in (-1, 1):
        for lx in (-0.6, 0.6):
            c += 1
            px, pz = local_to_world(tx, tz, rot, lx, side * 0.85)
            qx, qz = local_to_world(tx, tz, rot, lx, 0)
            chair(f"{tid}-c{c}", px, pz, qx, qz, "reference", table=tid)
    for lx in (-0.6, 0.6):
        GREEN_LAMPS.append((*local_to_world(tx, tz, rot, lx, 0),))
for i, deg in enumerate([90, 270]):
    a = math.radians(deg)
    tx, tz = RC[0] + math.cos(a) * 4.8, RC[1] + math.sin(a) * 4.8
    add(Item(f"rotunda-vitrine-{i + 1}", "table_vitrine", round(tx, 4), round(tz, 4), facing(RC[0] - tx, RC[1] - tz), "reference"))
add(Item("rotunda-globe", "globe_floor", RC[0] + 3.1, RC[1], -HALF_PI, "reference"))
for bay in ROTUNDA_BAYS:
    if bay["role"] == "display":
        bx, bz = bay["center"]
        ix, iz = local_to_world(bx, bz, bay["rot"], 0, 0.3)
        add(Item(f"rotunda-cabinet-{bay['index']}", "cabinet_display", round(ix, 4), round(iz, 4), bay["rot"], "reference"))

# ---------------------------------------------------------------------------
# Bookcase runs (filled with books by the Blender build). `a`->`b` is the wall line the back
# of the case stands on; the case faces `rot`.
# ---------------------------------------------------------------------------

BOOKCASES = []


def run(id_, a, b, rot, height, y=0.0, style="hall", subject=""):
    BOOKCASES.append({"id": id_, "a": a, "b": b, "rot": rot, "height": height, "y": y, "depth": 0.45, "style": style, "subject": subject})


# Hall, ground floor (under the gallery)
run("bc_hall_n1", (-14, -10), (-6.5, -10), 0, 4.0, subject="Philosophy")
run("bc_hall_n2", (-4.7, -10), (4.7, -10), 0, 4.0, subject="History")
run("bc_hall_n3", (6.5, -10), (14, -10), 0, 4.0, subject="Literature")
run("bc_hall_s1", (-14, 8), (-12.1, 8), PI, 4.0, subject="Languages")
run("bc_hall_s2", (-10.3, 8), (-1.9, 8), PI, 4.0, subject="Sciences")
run("bc_hall_s3", (1.9, 8), (10.3, 8), PI, 4.0, subject="Mathematics")
run("bc_hall_s4", (12.1, 8), (14, 8), PI, 4.0, subject="Computing")
run("bc_hall_w1", (-14, -9.55), (-14, -2.9), HALF_PI, 4.0, subject="Art & Music")
run("bc_hall_w2", (-14, 0.9), (-14, 7.55), HALF_PI, 4.0, subject="Geography")
run("bc_hall_e1", (14, -7.7), (14, -3.4), -HALF_PI, 4.0, subject="Law")
run("bc_hall_e2", (14, 1.4), (14, 7.55), -HALF_PI, 4.0, subject="Economics")
# Hall, gallery level (under the north windows they stop below the sills)
run("bc_gallery_n", (-14, -10), (14, -10), 0, 2.2, y=GALLERY_Y, style="gallery")
run("bc_gallery_w", (-14, -9.55), (-14, 7.55), HALF_PI, 2.9, y=GALLERY_Y, style="gallery")
run("bc_gallery_s1", (-14, 8), (-1.7, 8), PI, 2.9, y=GALLERY_Y, style="gallery")
run("bc_gallery_s2", (1.7, 8), (14, 8), PI, 2.9, y=GALLERY_Y, style="gallery")
# Rotunda bays
for bay in ROTUNDA_BAYS:
    if bay["role"] != "books":
        continue
    bx, bz = bay["center"]
    half = 1.95
    ax, az = local_to_world(bx, bz, bay["rot"], -half, 0)
    cx, cz = local_to_world(bx, bz, bay["rot"], half, 0)
    run(f"bc_rotunda_{bay['index']}", (round(ax, 4), round(az, 4)), (round(cx, 4), round(cz, 4)), bay["rot"], 4.2, style="rotunda")
# Lounge, either side of the arch from the hall
run("bc_lounge_1", (-14.8, -6.4), (-14.8, -3.0), -HALF_PI, 2.7, style="lounge")
run("bc_lounge_2", (-14.8, 1.0), (-14.8, 4.4), -HALF_PI, 2.7, style="lounge")
# Wings (lower cases)
run("bc_quiet_n1", (-18, 8.8), (-12.3, 8.8), 0, 2.1, style="wing", subject="Reserve")
run("bc_quiet_n2", (-10.1, 8.8), (-6.3, 8.8), 0, 2.1, style="wing", subject="Reserve")
run("bc_group_n", (14.8, 8.8), (18, 8.8), 0, 2.1, style="wing")
run("bc_computers_e", (2.8, -16.2), (2.8, -14.4), -HALF_PI, 2.1, style="wing")

# ---------------------------------------------------------------------------
# Lights the browser renders as real lights (everything else is emissive / baked look)
# ---------------------------------------------------------------------------

LIGHTS = [
    {"id": "chandelier_w", "kind": "chandelier", "x": -5.7, "y": 7.2, "z": -1.0, "color": "#ffc98a", "intensity": 60, "distance": 26},
    {"id": "chandelier_e", "kind": "chandelier", "x": 5.7, "y": 7.2, "z": -1.0, "color": "#ffc98a", "intensity": 60, "distance": 26},
    {"id": "lobby_lantern", "kind": "pendant", "x": 0, "y": 6.2, "z": 15.0, "color": "#ffd29a", "intensity": 30, "distance": 16},
    {"id": "rotunda_crown", "kind": "chandelier", "x": RC[0], "y": 7.5, "z": RC[1], "color": "#ffdcae", "intensity": 45, "distance": 20},
    {"id": "lounge_fire", "kind": "fire", "x": -22.6, "y": 0.7, "z": -1.0, "color": "#ff9a4a", "intensity": 12, "distance": 9},
    {"id": "lounge_lamp_1", "kind": "lamp", "x": -23.0, "y": 1.5, "z": -5.5, "color": "#ffcf94", "intensity": 5, "distance": 6},
    {"id": "lounge_lamp_2", "kind": "lamp", "x": -22.95, "y": 1.5, "z": 3.3, "color": "#ffcf94", "intensity": 5, "distance": 6},
    {"id": "quiet_1", "kind": "ceiling", "x": -12.15, "y": 4.1, "z": 11.8, "color": "#ffe4c2", "intensity": 14, "distance": 10},
    {"id": "quiet_2", "kind": "ceiling", "x": -12.15, "y": 4.1, "z": 17.2, "color": "#ffe4c2", "intensity": 14, "distance": 10},
    {"id": "group_1", "kind": "ceiling", "x": 12.0, "y": 4.1, "z": 12.2, "color": "#ffe9cc", "intensity": 16, "distance": 11},
    {"id": "group_2", "kind": "ceiling", "x": 12.0, "y": 4.1, "z": 17.0, "color": "#ffe9cc", "intensity": 16, "distance": 11},
    {"id": "computers_1", "kind": "ceiling", "x": -9.0, "y": 4.1, "z": -13.5, "color": "#f2ecff", "intensity": 14, "distance": 11},
    {"id": "computers_2", "kind": "ceiling", "x": -2.0, "y": 4.1, "z": -13.5, "color": "#f2ecff", "intensity": 14, "distance": 11},
    {"id": "services_1", "kind": "ceiling", "x": 8.5, "y": 4.1, "z": -13.5, "color": "#fff0dc", "intensity": 10, "distance": 10},
]

# ---------------------------------------------------------------------------
# Zones, spawn points and interaction anchors
# ---------------------------------------------------------------------------

ZONES = [
    {"id": "entrance", "name": "Entrance Hall", "blurb": "Welcome to OVR", "blender": "Zone_Entrance", "rects": [LOBBY], "yMin": -1, "yMax": 99},
    {"id": "hall", "name": "Grand Reading Hall", "blurb": "Long tables, warm lamps", "blender": "Zone_MainHall", "rects": [HALL, LANDING_PASSAGE], "yMin": -1, "yMax": 3.0},
    {"id": "gallery", "name": "Upper Gallery", "blurb": "Books with a view", "blender": "Zone_UpperGallery", "rects": [HALL, LANDING, LANDING_PASSAGE], "yMin": 3.0, "yMax": 99},
    {"id": "quiet", "name": "Quiet Study", "blurb": "Heads down, voices low", "blender": "Zone_QuietStudy", "rects": [QUIET], "yMin": -1, "yMax": 99},
    {"id": "collab", "name": "Group Study", "blurb": "Study together, talk freely", "blender": "Zone_GroupStudy", "rects": [GROUP], "yMin": -1, "yMax": 99},
    {"id": "computers", "name": "Computers & Printing", "blurb": "Digital resources", "blender": "Zone_ComputerLab", "rects": [COMPUTERS], "yMin": -1, "yMax": 99},
    {"id": "services", "name": "Services", "blurb": "Washrooms, water, print room", "blender": "Zone_Services", "rects": [SERVICES], "yMin": -1, "yMax": 99},
    {"id": "lounge", "name": "Reading Lounge", "blurb": "Armchairs by the fire", "blender": "Zone_ReadingLounge", "rects": [LOUNGE], "yMin": -1, "yMax": 99},
    {"id": "reference", "name": "Reference Rotunda", "blurb": "Special collections · Research Help", "blender": "Zone_Reference", "rects": [ROOMS[-1].bounds], "yMin": -1, "yMax": 99},
]

SPAWN_POINTS = [
    {"x": x, "y": 0.0, "z": z, "rot": PI}
    for x, z in [(0, 18.0), (-0.9, 18.5), (0.9, 18.5), (-0.9, 17.4), (0.9, 17.4), (0, 16.9)]
]


# ---------------------------------------------------------------------------
# Scope (2026-11-20): the library is just the Grand Reading Hall and its gallery. The other rooms
# stay defined above so they can come back; HALL_ONLY walls the plan down to the hall: every
# doorway out is closed, the bookcases run on across them, and the rotunda arch becomes a tall
# arched window. Players arrive in the hall and reach the gallery by the lift.
# ---------------------------------------------------------------------------

HALL_ONLY = True
HALL_ZONES = ("hall", "gallery")
HALL_WALLS = ("hall_n", "hall_s", "hall_w", "hall_e")

if HALL_ONLY:
    ROOMS = [r for r in ROOMS if r.id == "hall"]
    WALLS = [w for w in WALLS if w.id in HALL_WALLS]
    for _w in WALLS:
        _w.openings = [o for o in _w.openings if o.id.startswith(("window_hall", "oculus_hall", "lift_door"))]
    next(w for w in WALLS if w.id == "hall_e").openings.append(arched("window_hall_e", -1.0, 4.4, 4.8, 11.2))
    ITEMS[:] = [it for it in ITEMS if it.zone in HALL_ZONES]
    # A rolling whiteboard at the aisle end of every study table, facing the table; the central
    # aisle keeps 2 m between the two rows of boards.
    for _t in [it for it in ITEMS if it.kind == "table_communal"]:
        _north = _t.z < -1.0
        add(Item(f"{_t.id}-board", "whiteboard_mobile", _t.x, round(_t.z + (2.3 if _north else -2.3), 4),
                 PI if _north else 0.0, "hall", table=_t.id))
    LIGHTS[:] = [L for L in LIGHTS if L["id"].startswith("chandelier_")]
    for _lst in (WHITEBOARDS, GROUP_TABLES, COMPUTER_DESKS, GREEN_LAMPS):
        _lst[:] = []
    ZONES[:] = [
        {**next(z for z in ZONES if z["id"] == "hall"), "rects": [HALL], "blurb": "Long tables, warm lamps"},
        {**next(z for z in ZONES if z["id"] == "gallery"), "rects": [HALL]},
    ]
    # Arrive in the south aisle, under the gallery's edge, facing the north windows.
    SPAWN_POINTS[:] = [{"x": x, "y": 0.0, "z": z, "rot": PI}
                       for x, z in [(0, 6.3), (-0.8, 6.6), (0.8, 6.6), (-0.8, 5.9), (0.8, 5.9), (0, 5.6)]]
    # The hall's bookcases run on across the closed doorways.
    BOOKCASES[:] = []
    # Runs that meet along a wall leave a 20 cm gap, so each reads as its own press and their
    # returned cornices and panelled ends don't overlap.
    run("bc_hall_n1", (-14, -10), (-4.8, -10), 0, 4.0, subject="Philosophy")
    run("bc_hall_n2", (-4.6, -10), (4.6, -10), 0, 4.0, subject="History")
    run("bc_hall_n3", (4.8, -10), (14, -10), 0, 4.0, subject="Literature")
    run("bc_hall_s1", (-14, 8), (-7.1, 8), PI, 4.0, subject="Languages")
    run("bc_hall_s2", (-6.9, 8), (-0.1, 8), PI, 4.0, subject="Sciences")
    run("bc_hall_s3", (0.1, 8), (6.9, 8), PI, 4.0, subject="Mathematics")
    run("bc_hall_s4", (7.1, 8), (14, 8), PI, 4.0, subject="Computing")
    run("bc_hall_w1", (-14, -9.55), (-14, -1.1), HALF_PI, 4.0, subject="Art & Music")
    run("bc_hall_w2", (-14, -0.9), (-14, 7.55), HALF_PI, 4.0, subject="Geography")
    run("bc_hall_e1", (14, -7.7), (14, -1.1), -HALF_PI, 4.0, subject="Law")
    run("bc_hall_e2", (14, -0.9), (14, 7.55), -HALF_PI, 4.0, subject="Economics")
    run("bc_gallery_n", (-14, -10), (14, -10), 0, 2.2, y=GALLERY_Y, style="gallery")
    run("bc_gallery_w", (-14, -9.55), (-14, 7.55), HALF_PI, 2.9, y=GALLERY_Y, style="gallery")
    run("bc_gallery_s1", (-14, 8), (-0.1, 8), PI, 2.9, y=GALLERY_Y, style="gallery")
    run("bc_gallery_s2", (0.1, 8), (14, 8), PI, 2.9, y=GALLERY_Y, style="gallery")


def anchors():
    out = [] if HALL_ONLY else [
        {"id": "Interact_InfoDesk", "kind": "info_desk", "x": 0, "y": 0, "z": 15.5, "rot": PI, "label": "Information Desk"},
        {"id": "Interact_ResearchHelp", "kind": "research_help", "x": RC[0] - 2.3, "y": 0, "z": RC[1], "rot": HALF_PI, "label": "Research Help"},
    ]
    out += [
        {"id": "Interact_Lift_Ground", "kind": "lift", "x": LIFT["door_x"] - 0.6, "y": 0, "z": LIFT["door_z"], "rot": HALF_PI, "label": "Lift to the gallery", "level": 0},
        {"id": "Interact_Lift_Gallery", "kind": "lift", "x": LIFT["door_x"] - 0.6, "y": GALLERY_Y, "z": LIFT["door_z"], "rot": HALF_PI, "label": "Lift to the ground floor", "level": 1},
    ]
    if not HALL_ONLY:
        out += [
            {"id": "Interact_WaterRefill", "kind": "water", "x": 8.0, "y": 0, "z": -11.6, "rot": PI, "label": "Water refill"},
            {"id": "Interact_Printer", "kind": "printer", "x": 1.4, "y": 0, "z": -13.5, "rot": HALF_PI, "label": "Print & scan"},
        ]
    if HALL_ONLY:
        # Every study table has its rolling whiteboard (walk up and press E, or B from a seat).
        boards = {it.table: it for it in ITEMS if it.kind == "whiteboard_mobile"}
        for i, it in enumerate([t for t in ITEMS if t.kind == "table_communal"]):
            b = boards[it.id]
            out.append({"id": f"Anchor_Whiteboard_{i + 1:02d}", "kind": "whiteboard", "x": b.x, "y": KINDS[b.kind]["board_y"],
                        "z": b.z, "rot": b.rot, "table": it.id, "label": f"Table {i + 1} whiteboard", "mount": "mobile"})
    for i, w in enumerate(WHITEBOARDS):
        out.append({"id": f"Anchor_Whiteboard_{i + 1:02d}", "kind": "whiteboard", "x": w["x"], "y": 0.85, "z": w["z"], "rot": w["rot"], "table": w["table"], "label": f"Table {i + 1} whiteboard"})
    for i, (tid, _, tx, tz, _) in enumerate(GROUP_TABLES):
        out.append({"id": f"Interact_GroupTable_{i + 1:02d}", "kind": "group_table", "x": tx, "y": 0.76, "z": tz, "rot": 0, "table": tid, "label": f"Group table {i + 1}"})
    for i, it in enumerate([it for it in ITEMS if it.kind == "screen_wall"]):
        out.append({"id": f"Anchor_Display_{i + 1:02d}", "kind": "display", "x": it.x, "y": 1.35, "z": it.z, "rot": it.rot, "label": "Shared screen"})
    for i, did in enumerate(COMPUTER_DESKS):
        it = next(t for t in ITEMS if t.id == did)
        out.append({"id": f"Interact_ComputerStation_{i + 1:02d}", "kind": "computer", "x": it.x, "y": 0.75, "z": it.z, "rot": it.rot, "table": did, "label": "Computer"})
    for w in WALLS:
        for o in w.openings:
            if o.kind.startswith("door") or o.kind == "exit":   # lift doors have Interact_Lift_*
                if not o.passable and o.label:
                    x, z = (o.at, (w.bounds["minZ"] + w.bounds["maxZ"]) / 2) if w.axis == "x" else ((w.bounds["minX"] + w.bounds["maxX"]) / 2, o.at)
                    out.append({"id": f"Interact_Door_{o.id}", "kind": "door", "x": x, "y": 0, "z": z, "rot": 0, "label": o.label})
    for bc in BOOKCASES:
        if bc["subject"]:
            (ax, az), (bx, bz) = bc["a"], bc["b"]
            out.append({"id": f"Interact_Bookshelf_{bc['id']}", "kind": "bookshelf", "x": (ax + bx) / 2, "y": bc["y"], "z": (az + bz) / 2, "rot": bc["rot"], "label": bc["subject"]})
    return out


# ---------------------------------------------------------------------------
# Derived data for the web client and game server
# ---------------------------------------------------------------------------

def seats():
    out = []
    by_id = {it.id: it for it in ITEMS}
    prompts = {
        "hall": "Study at table", "gallery": "Sit at the gallery desk", "quiet": "Sit at desk",
        "collab": "Study at table", "computers": "Use computer", "reference": "Sit at table",
        "lounge": "Sit down", "entrance": "Sit on the bench",
    }
    for it in ITEMS:
        spec = KINDS[it.kind]
        if "seats" not in spec:
            continue
        for i, (lx, lz) in enumerate(spec["seats"]):
            x, z = local_to_world(it.x, it.z, it.rot, lx, lz)
            prompt = prompts.get(it.zone, "Sit down")
            if it.kind == "armchair_club":
                prompt = "Sit in the armchair"
            elif it.kind == "sofa_chesterfield":
                prompt = "Sit on the sofa"
            elif it.kind == "window_seat":
                prompt = "Sit by the window"
            out.append({
                "id": it.id if len(spec["seats"]) == 1 else f"{it.id}#{i + 1}",
                "furnitureId": it.id,
                "x": round(x, 4), "y": it.y, "z": round(z, 4),
                "rotationY": round(it.rot, 5),
                "seatHeight": spec["seat_h"],
                "zone": it.zone,
                "tableId": it.table if it.table and it.table in by_id and by_id[it.table].kind != "carrel" else None,
                "prompt": prompt,
            })
    return out


def _box(id_, x0, x1, z0, z1, y0, y1, rot=0.0):
    return {"kind": "box", "id": id_, "x": round((x0 + x1) / 2, 4), "z": round((z0 + z1) / 2, 4),
            "halfW": round(abs(x1 - x0) / 2, 4), "halfD": round(abs(z1 - z0) / 2, 4), "rotationY": rot,
            "y0": round(y0, 4), "y1": round(y1, 4)}


def _wall_colliders(w):
    """Splits a wall into solid boxes around its passable openings (lintels and sills stay)."""
    out = []
    b = w.bounds
    lo, hi = (b["minX"], b["maxX"]) if w.axis == "x" else (b["minZ"], b["maxZ"])
    gaps = [o for o in w.openings if o.passable]
    cuts = sorted({lo, hi, *[max(lo, o.at - o.width / 2) for o in gaps], *[min(hi, o.at + o.width / 2) for o in gaps]})
    n = 0
    for a, c in zip(cuts, cuts[1:]):
        if c - a < 1e-6:
            continue
        mid = (a + c) / 2
        holes = sorted((o.y0, o.y1) for o in gaps if o.at - o.width / 2 <= mid <= o.at + o.width / 2)
        y = w.y0
        solid = []
        for h0, h1 in holes:
            if h0 > y + 1e-6:
                solid.append((y, h0))
            y = max(y, h1)
        if y < w.y1 - 1e-6:
            solid.append((y, w.y1))
        for y0, y1 in solid:
            n += 1
            if w.axis == "x":
                out.append(_box(f"{w.id}#{n}", a, c, b["minZ"], b["maxZ"], y0, y1))
            else:
                out.append(_box(f"{w.id}#{n}", b["minX"], b["maxX"], a, c, y0, y1))
    return out


def colliders():
    out = []
    for w in WALLS:
        out += _wall_colliders(w)
    # Rotunda: the 12 walls (the west bay is open, the arch).
    for bay in ([] if HALL_ONLY else ROTUNDA_BAYS):
        if bay["role"] == "arch":
            continue
        a = bay["angle"]
        mid = ROTUNDA_APOTHEM + EXT_WALL / 2
        x, z = ROTUNDA_C[0] + math.cos(a) * mid, ROTUNDA_C[1] + math.sin(a) * mid
        half = bay["width"] / 2 + 0.35
        out.append({"kind": "box", "id": f"rotunda_wall_{bay['index']}", "x": round(x, 4), "z": round(z, 4),
                    "halfW": round(half, 4), "halfD": EXT_WALL / 2, "rotationY": round(bay["rot"], 5), "y0": 0, "y1": ROTUNDA["dome_spring_y"]})
    # Rotunda arch passage sides (between the hall's east wall and the rotunda's west wall).
    if not HALL_ONLY:
        out.append(_box("rotunda_passage_n", 14, 15.2, -6.0, -3.2, 0, 10))
        out.append(_box("rotunda_passage_s", 14, 15.2, 1.2, 4.0, 0, 10))
    # Lift shaft.
    s = LIFT["shaft"]
    out.append(_box("lift_shaft", s["minX"], s["maxX"], s["minZ"], s["maxZ"], 0, HALL_CEILING))
    # Gallery: slab (blocks the camera), arcade columns, railings.
    for name, r in GALLERY["runs"].items():
        out.append(_box(f"gallery_slab_{name}", r["minX"], r["maxX"], r["minZ"], r["maxZ"], GALLERY_UNDERSIDE, GALLERY_Y))
    if not HALL_ONLY:
        out.append(_box("landing_slab", LANDING["minX"], LANDING["maxX"], LANDING["minZ"], LANDING["maxZ"], GALLERY_UNDERSIDE, GALLERY_Y))
    for i, (x, z) in enumerate(GALLERY["columns"]):
        out.append({"kind": "circle", "id": f"gallery_column_{i + 1}", "x": x, "z": z, "radius": GALLERY["column_radius"], "y0": 0, "y1": GALLERY_UNDERSIDE})
    t = 0.07
    for r in GALLERY["railings"]:
        (ax, az), (bx, bz) = r["a"], r["b"]
        out.append(_box(r["id"], ax - t, bx + t, az - t, bz + t, GALLERY_Y, GALLERY_Y + RAILING_H))
    lr = STAIRS["landing_railing"]
    if not HALL_ONLY:
        out.append(_box("landing_railing", lr["a"][0], lr["b"][0], lr["a"][1] - t, lr["a"][1] + t, GALLERY_Y, GALLERY_Y + RAILING_H))
    for f in ([] if HALL_ONLY else FLIGHTS):
        b = f["bounds"]
        ix = f["inner_x"]
        out.append(_box(f"{f['id']}_balustrade", ix - t, ix + t, b["minZ"], b["maxZ"], 0, GALLERY_Y + RAILING_H))
        # Closed under-stair: ground players can't walk in under the flight from the north.
        out.append(_box(f"{f['id']}_understair", b["minX"], b["maxX"], b["minZ"] - 0.1, b["minZ"] + 0.1, 0, GALLERY_UNDERSIDE))
    # Furniture.
    for it in ITEMS:
        spec = KINDS[it.kind]
        if spec["shape"] == "none":
            continue
        w = it.w or spec["w"]
        d = it.d or spec["d"]
        if spec["shape"] == "circle":
            out.append({"kind": "circle", "id": it.id, "x": it.x, "z": it.z, "radius": w / 2, "y0": it.y, "y1": it.y + spec["h"]})
        else:
            out.append({"kind": "box", "id": it.id, "x": it.x, "z": it.z, "halfW": w / 2, "halfD": d / 2,
                        "rotationY": round(it.rot, 5), "y0": it.y, "y1": it.y + spec["h"]})
    # Bookcases.
    for bc in BOOKCASES:
        (ax, az), (bx, bz) = bc["a"], bc["b"]
        length = math.hypot(bx - ax, bz - az)
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        fx, fz = math.sin(bc["rot"]), math.cos(bc["rot"])
        cx, cz = mx + fx * bc["depth"] / 2, mz + fz * bc["depth"] / 2
        out.append({"kind": "box", "id": bc["id"], "x": round(cx, 4), "z": round(cz, 4), "halfW": round(length / 2, 4),
                    "halfD": bc["depth"] / 2, "rotationY": round(bc["rot"], 5), "y0": bc["y"], "y1": bc["y"] + bc["height"]})
    return out


def surfaces():
    out = []
    for room in ROOMS:
        out.append({"id": f"floor_{room.id}", "kind": "flat", "rect": room.bounds, "y": room.floor_y})
    # Thresholds through walls at ground level, so doorways have a floor.
    for w in WALLS:
        for o in w.openings:
            if o.passable and o.y0 < 0.1:
                b = w.bounds
                r = rect(o.at - o.width / 2, o.at + o.width / 2, b["minZ"], b["maxZ"]) if w.axis == "x" else rect(b["minX"], b["maxX"], o.at - o.width / 2, o.at + o.width / 2)
                out.append({"id": f"threshold_{o.id}", "kind": "flat", "rect": r, "y": 0.0})
    if not HALL_ONLY:
        out.append({"id": "threshold_rotunda_passage", "kind": "flat", "rect": rect(14, 15.2, -3.2, 1.2), "y": 0.0})
    for name, r in GALLERY["runs"].items():
        out.append({"id": f"gallery_{name}", "kind": "flat", "rect": r, "y": GALLERY_Y})
    if not HALL_ONLY:
        out.append({"id": "landing", "kind": "flat", "rect": LANDING, "y": GALLERY_Y})
        out.append({"id": "landing_passage", "kind": "flat", "rect": LANDING_PASSAGE, "y": GALLERY_Y})
    for f in ([] if HALL_ONLY else FLIGHTS):
        # Height rises linearly from 0 at the bottom (south end) to the gallery at the top (north end).
        out.append({"id": f["id"], "kind": "ramp", "rect": f["bounds"], "axis": "z",
                    "from": f["bottom"], "to": f["top"], "y0": 0.0, "y1": GALLERY_Y})
    return out


def ceilings():
    out = []
    for room in ROOMS:
        out.append({"id": room.id, "rect": room.bounds, "floorY": room.floor_y, "ceilingY": room.ceiling_y,
                    **({"circle": {"x": room.center[0], "z": room.center[1], "radius": room.radius}} if room.shape != "rect" else {})})
    # Doorway passages are low "rooms" so the camera can follow you through them.
    for w in WALLS:
        for o in w.openings:
            if o.passable:
                b = w.bounds
                r = rect(o.at - o.width / 2, o.at + o.width / 2, b["minZ"], b["maxZ"]) if w.axis == "x" else rect(b["minX"], b["maxX"], o.at - o.width / 2, o.at + o.width / 2)
                out.append({"id": f"passage_{o.id}", "rect": r, "floorY": o.y0, "ceilingY": o.y1})
    if not HALL_ONLY:
        out.append({"id": "passage_rotunda", "rect": rect(14, 15.2, -3.2, 1.2), "floorY": 0, "ceilingY": 8.3})
    return out


BUILDING = rect(-14.8, 14.8, -10.8, 8.8) if HALL_ONLY else rect(-24.2, 32.6, -17, 20.8)


def web_plan():
    return {
        "version": 1,
        "generator": "art/library/scripts/plan.py",
        "units": "metres; +X east, +Y up, +Z south (entrance)",
        "bounds": BUILDING,
        "galleryY": GALLERY_Y,
        "stepUp": STEP_UP,
        "rooms": [{"id": r.id, "name": r.name, "zone": r.zone, "rect": r.bounds, "floorY": r.floor_y, "ceilingY": r.ceiling_y} for r in ROOMS],
        "zones": ZONES,
        "surfaces": surfaces(),
        "ceilings": ceilings(),
        "colliders": colliders(),
        "seats": seats(),
        "spawnPoints": SPAWN_POINTS,
        "anchors": anchors(),
        "lights": LIGHTS,
        "lamps": {
            "hall": [{"x": x, "y": y, "z": z} for x, y, z in HALL_LAMPS],
            "green": [{"x": round(x, 4), "y": 0.76, "z": round(z, 4)} for x, z in GREEN_LAMPS],
        },
        "items": [{"id": it.id, "kind": it.kind, "x": it.x, "y": it.y, "z": it.z, "rotationY": round(it.rot, 5), "zone": it.zone,
                   **({"tableId": it.table} if it.table else {})} for it in ITEMS],
        "lift": LIFT,
    }


def blender_plan():
    """Everything the Blender build needs, as plain data."""
    return {
        "rooms": [asdict(r) for r in ROOMS],
        "walls": [{**asdict(w), "openings": [asdict(o) for o in w.openings]} for w in WALLS],
        "rotunda": ROTUNDA,
        "gallery": GALLERY,
        "stairs": STAIRS,
        "lift": LIFT,
        "items": [asdict(it) for it in ITEMS],
        "kinds": KINDS,
        "bookcases": BOOKCASES,
        "lights": LIGHTS,
        "hall_lamps": HALL_LAMPS,
        "green_lamps": GREEN_LAMPS,
        "anchors": anchors(),
        "zones": ZONES,
        "seats": seats(),
        "bays": HALL_BAYS,
        "piers": HALL_PIERS,
    }


def write_web_plan(path=None):
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
    path = path or os.path.join(root, "packages", "shared", "src", "world", "library-plan.json")
    with open(path, "w") as f:
        json.dump(web_plan(), f, indent=1)
    return path


if __name__ == "__main__":
    p = write_web_plan()
    data = web_plan()
    print("wrote", p, {k: len(v) for k, v in data.items() if isinstance(v, list)})
