"""
Rolling whiteboards for the reading hall: one stands at the aisle end of every study table.

A double-sided board in a moulded walnut frame, carried on two walnut posts with splayed feet and
brass castors, a marker tray on each face. Plan kind `whiteboard_mobile` (plan.KINDS): 1.5 m wide,
0.55 m deep, 1.95 m tall, faces -Y and +Y. The web draws each table's live board on both writing
surfaces, described by the custom prop `board_surface` = [x0, z0, x1, z1] (local metres) and
`board_face_y` (distance of each face from the board's centre plane).

    Blender -b --factory-startup --python-exit-code 1 --python art/library/scripts/run_asset.py -- \
        --module furn_boards --out /tmp/boards
"""

from __future__ import annotations

import math
import os

import lib_core as C
import lib_materials as M

# Writing surface (shared with the web: LiveWhiteboards uses the same numbers).
SURF_W, SURF_H = 1.36, 0.92
SURF_Z = 1.36                 # centre height of the writing surface
BOARD_T = 0.03                # board thickness (two faces)
FRAME = 0.045                 # frame width round the surface
POST_X = SURF_W / 2 + FRAME + 0.035
TOP = SURF_Z + SURF_H / 2 + FRAME + 0.05


def _wood(ob, grain="z"):
    C.uv_box(ob, M.tex_size("walnut"), grain=grain)
    return ob


def build_whiteboard_mobile(item=None):
    """One rolling double-sided whiteboard at the origin, floor z = 0, faces -Y and +Y."""
    parts = []
    walnut, brass = M.mat("walnut"), M.mat("brass_aged")
    # The board: a white writing face each side of a thin core.
    parts.append(C.box("wb_face", (SURF_W, BOARD_T, SURF_H), (0, 0, SURF_Z), M.mat("whiteboard"), bevel_w=0.002))
    # Moulded frame: four rails, mitred look via bevels, proud of both faces.
    fw, fd = FRAME, BOARD_T + 0.024
    for sx in (-1, 1):
        parts.append(_wood(C.box("wb_stile", (fw, fd, SURF_H + 2 * fw), (sx * (SURF_W / 2 + fw / 2), 0, SURF_Z),
                                 walnut, bevel_w=0.008, segments=3)))
    for sz in (-1, 1):
        parts.append(_wood(C.box("wb_rail", (SURF_W + 2 * fw, fd, fw), (0, 0, SURF_Z + sz * (SURF_H / 2 + fw / 2)),
                                 walnut, bevel_w=0.008, segments=3), grain="x"))
    # A gilt bead inside the frame on both faces.
    for sy in (-1, 1):
        for sx in (-1, 1):
            parts.append(C.box("wb_bead_v", (0.008, 0.006, SURF_H), (sx * (SURF_W / 2 - 0.004), sy * (BOARD_T / 2 + 0.003), SURF_Z),
                               M.mat("gilt")))
        for sz in (-1, 1):
            parts.append(C.box("wb_bead_h", (SURF_W, 0.006, 0.008), (0, sy * (BOARD_T / 2 + 0.003), SURF_Z + sz * (SURF_H / 2 - 0.004)),
                               M.mat("gilt")))
    # Marker tray under each face, with markers and a felt eraser on the front one.
    tray_z = SURF_Z - SURF_H / 2 - fw - 0.012
    for sy in (-1, 1):
        parts.append(_wood(C.box("wb_tray", (SURF_W * 0.7, 0.07, 0.022), (0, sy * (fd / 2 + 0.035), tray_z), walnut,
                                 bevel_w=0.004), grain="x"))
        parts.append(_wood(C.box("wb_lip", (SURF_W * 0.7, 0.01, 0.03), (0, sy * (fd / 2 + 0.07), tray_z + 0.012), walnut,
                                 bevel_w=0.003), grain="x"))
    for i, (key, x) in enumerate((("plastic_dark", -0.28), ("signage", -0.2), ("leather_burgundy", -0.12))):
        ob = C.cylinder(f"wb_marker_{i}", 0.009, 0.009, 0.13, (x, -(fd / 2 + 0.035), tray_z + 0.02), M.mat(key), segments=12,
                        rot=C.roty(90))
        parts.append(ob)
    parts.append(C.box("wb_eraser", (0.12, 0.045, 0.03), (0.2, -(fd / 2 + 0.035), tray_z + 0.026), M.mat("felt_green"), bevel_w=0.004))
    # Posts with a turned finial and a cross stretcher, on splayed feet with brass castors.
    for sx in (-1, 1):
        x = sx * POST_X
        parts.append(_wood(C.box("wb_post", (0.05, 0.05, TOP - 0.12), (x, 0, 0.12 + (TOP - 0.12) / 2), walnut, bevel_w=0.008)))
        parts.append(C.lathe("wb_finial", [(0.0, 0.0), (0.03, 0.0), (0.03, 0.012), (0.018, 0.03), (0.026, 0.055), (0.0, 0.08)],
                             24, brass, center=(x, 0, TOP)))
        # Brackets pinning the board to the posts (it pivots on these), at mid height.
        parts.append(C.cylinder("wb_pivot", 0.022, 0.022, 0.07, (sx * (POST_X - 0.035), 0, SURF_Z), brass, segments=20,
                                rot=C.roty(90)))
        foot = _wood(C.box("wb_foot", (0.06, 0.55, 0.07), (x, 0, 0.12), walnut, bevel_w=0.01), grain="y")
        parts.append(foot)
        for sy in (-1, 1):
            y = sy * 0.24
            parts.append(C.cylinder("wb_fork", 0.018, 0.018, 0.04, (x, y, 0.065), brass, segments=16))
            parts.append(C.cylinder("wb_wheel", 0.032, 0.032, 0.022, (x, y, 0.034), M.mat("plastic_dark"), segments=20,
                                    rot=C.roty(90)))
    parts.append(_wood(C.box("wb_stretcher", (2 * POST_X, 0.04, 0.05), (0, 0, 0.3), walnut, bevel_w=0.008), grain="x"))
    ob = C.join(parts, "Furniture_Whiteboard_Mobile_01")
    C.shade_smooth(ob, 35)
    ob["board_surface"] = [-SURF_W / 2, SURF_Z - SURF_H / 2, SURF_W / 2, SURF_Z + SURF_H / 2]
    ob["board_face_y"] = BOARD_T / 2
    return ob


KIND_BUILDERS = {"whiteboard_mobile": build_whiteboard_mobile}


def preview(out_dir):
    import lib_render as R
    C.reset_scene()
    ob = build_whiteboard_mobile()
    print("TRIS Furniture_Whiteboard_Mobile_01", C.tris(ob))
    R.preview_objects([ob], out_dir, "whiteboard_mobile", views=((25, 10), (-30, 18), (180, 8)), size=(960, 960),
                      closeups=[("tray", [ob], 20, 25)])
    return sorted(os.path.join(out_dir, f) for f in os.listdir(out_dir) if f.endswith(".png"))
