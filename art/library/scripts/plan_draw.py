"""
Draws the floor plan (ground floor and gallery level) as PNGs and runs walkability checks.

    python3 art/library/scripts/plan_draw.py OUT_DIR
"""

import math
import os
import sys
from collections import deque

from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import plan  # noqa: E402

S = 34  # pixels per metre
B = plan.BUILDING
PAD = 60
W = int((B["maxX"] - B["minX"]) * S) + 2 * PAD
H = int((B["maxZ"] - B["minZ"]) * S) + 2 * PAD + 70

ZONE_FILL = {
    "hall": "#f3e3c3", "entrance": "#e9e2d6", "quiet": "#dfe8dc", "collab": "#f4dccb", "computers": "#dde3ee",
    "services": "#e6e6e6", "lounge": "#efd6cf", "reference": "#e8ddf0", "gallery": "#f3e3c3",
}


def font(size, bold=False):
    for name in ("/System/Library/Fonts/Supplemental/Georgia Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Georgia.ttf",
                 "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def P(x, z):
    return (PAD + (x - B["minX"]) * S, PAD + 70 + (z - B["minZ"]) * S)


def rect_poly(r):
    return [P(r["minX"], r["minZ"]), P(r["maxX"], r["minZ"]), P(r["maxX"], r["maxZ"]), P(r["minX"], r["maxZ"])]


def obox(x, z, w, d, rot):
    pts = []
    for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        px, pz = plan.local_to_world(x, z, rot, sx * w / 2, sz * d / 2)
        pts.append(P(px, pz))
    return pts


def rotunda_poly(apothem):
    cx, cz = plan.ROTUNDA_C
    R = apothem / math.cos(math.radians(15))
    return [P(cx + R * math.cos(math.radians(15 + 30 * k)), cz + R * math.sin(math.radians(15 + 30 * k))) for k in range(12)]


def draw(level, path):
    img = Image.new("RGB", (W, H), "#fbf7ef")
    d = ImageDraw.Draw(img)
    upper = level == "gallery"
    title = "OVR Library · Upper gallery (+4.6 m)" if upper else "OVR Library · Ground floor"
    d.text((PAD, 20), title, fill="#2d2420", font=font(30, True))

    # Rooms
    for room in plan.ROOMS:
        fill = ZONE_FILL[room.zone]
        if upper:
            fill = "#efeae2"
        if room.shape == "rect":
            d.polygon(rect_poly(room.bounds), fill=fill)
        else:
            d.polygon(rotunda_poly(room.radius), fill=fill)
    if upper:
        for r in plan.GALLERY["runs"].values():
            d.polygon(rect_poly(r), fill=ZONE_FILL["gallery"])
        if not getattr(plan, "HALL_ONLY", False):
            d.polygon(rect_poly(plan.LANDING), fill=ZONE_FILL["gallery"])
            d.polygon(rect_poly(plan.LANDING_PASSAGE), fill=ZONE_FILL["gallery"])
    else:
        # Gallery overhead (dashed outline)
        for r in plan.GALLERY["runs"].values():
            poly = rect_poly(r)
            for a, b in zip(poly, poly[1:] + poly[:1]):
                n = int(math.hypot(b[0] - a[0], b[1] - a[1]) // 10)
                for i in range(0, n, 2):
                    t0, t1 = i / max(n, 1), min(1, (i + 1) / max(n, 1))
                    d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill="#b59a74", width=1)

    # Stairs
    for f in ([] if getattr(plan, "HALL_ONLY", False) else plan.FLIGHTS):
        b = f["bounds"]
        d.polygon(rect_poly(b), fill="#d9c7a8")
        z = b["minZ"]
        while z < b["maxZ"]:
            d.line([P(b["minX"], z), P(b["maxX"], z)], fill="#8a6a48", width=1)
            z += plan.STAIR_TREAD
        mx = (b["minX"] + b["maxX"]) / 2
        d.line([P(mx, b["maxZ"] - 0.4), P(mx, b["minZ"] + 0.4)], fill="#5a3a24", width=3)
        tip = P(mx, b["minZ"] + 0.3)
        d.polygon([tip, (tip[0] - 7, tip[1] + 14), (tip[0] + 7, tip[1] + 14)], fill="#5a3a24")
    if not upper and not getattr(plan, "HALL_ONLY", False):
        d.polygon(rect_poly(plan.LANDING), outline="#b59a74")

    # Walls
    for w in plan.WALLS:
        d.polygon(rect_poly(w.bounds), fill="#4a3a30")
        for o in w.openings:
            visible = (o.y0 < 3 and not upper) or (o.y0 >= 3 and upper and o.kind != "oculus") or (o.kind == "window_arched" and upper)
            if not visible:
                continue
            b = w.bounds
            if w.axis == "x":
                r = plan.rect(o.at - o.width / 2, o.at + o.width / 2, b["minZ"], b["maxZ"])
            else:
                r = plan.rect(b["minX"], b["maxX"], o.at - o.width / 2, o.at + o.width / 2)
            if o.passable:
                d.polygon(rect_poly(r), fill="#fbf7ef")
            elif o.kind.startswith("window") or o.kind == "oculus":
                d.polygon(rect_poly(r), fill="#9cc3e6")
            else:
                d.polygon(rect_poly(r), fill="#c0703a")
    # Rotunda walls
    cx, cz = plan.ROTUNDA_C
    outer, inner = rotunda_poly(plan.ROTUNDA_APOTHEM + plan.EXT_WALL), rotunda_poly(plan.ROTUNDA_APOTHEM)
    for k in ([] if getattr(plan, "HALL_ONLY", False) else range(12)):
        bay = plan.ROTUNDA_BAYS[k]
        # bay k is centred at angle k*30, between polygon vertices k-1 and k (vertices at 15+30k)
        i0, i1 = (k - 1) % 12, k
        poly = [inner[i0], inner[i1], outer[i1], outer[i0]]
        if bay["role"] == "arch":
            continue
        d.polygon(poly, fill="#4a3a30")
        if bay["role"] == "exit":
            m = [((inner[i0][0] + inner[i1][0]) / 2, (inner[i0][1] + inner[i1][1]) / 2)]
            d.ellipse([m[0][0] - 8, m[0][1] - 8, m[0][0] + 8, m[0][1] + 8], fill="#c0703a")
    # Lift
    d.polygon(rect_poly(plan.LIFT["shaft"]), fill="#6c6c74")
    lx, lz = P(13, -9)
    d.text((lx - 12, lz - 8), "LIFT", fill="#ffffff", font=font(12, True))

    # Bookcases
    for bc in plan.BOOKCASES:
        if (bc["y"] > 1) != upper:
            continue
        (ax, az), (bx, bz) = bc["a"], bc["b"]
        length = math.hypot(bx - ax, bz - az)
        mx, mz = (ax + bx) / 2, (az + bz) / 2
        fx, fz = math.sin(bc["rot"]), math.cos(bc["rot"])
        d.polygon(obox(mx + fx * bc["depth"] / 2, mz + fz * bc["depth"] / 2, length, bc["depth"], bc["rot"]), fill="#7a4a2a")

    # Furniture
    for it in plan.ITEMS:
        if (it.y > 1) != upper:
            continue
        spec = plan.KINDS[it.kind]
        w, dd = it.w or spec["w"], it.d or spec["d"]
        col = {"chair_reading": "#a0764e", "chair_task": "#5a6478", "rug": None}.get(it.kind, "#b88a5a")
        if it.kind == "rug":
            d.polygon(obox(it.x, it.z, w, dd, it.rot), outline="#a0402a", fill=None)
            continue
        if it.kind in ("whiteboard_wall", "screen_wall", "noticeboard"):
            col = {"whiteboard_wall": "#2f7fd0", "screen_wall": "#222", "noticeboard": "#3f6f4a"}[it.kind]
            d.polygon(obox(it.x, it.z, w, 0.12, it.rot), fill=col)
            continue
        if spec["shape"] == "circle":
            px, pz = P(it.x, it.z)
            r = w / 2 * S
            d.ellipse([px - r, pz - r, px + r, pz + r], fill=col, outline="#5a3a24")
        else:
            d.polygon(obox(it.x, it.z, w, dd, it.rot), fill=col, outline="#5a3a24")
    # Arcade columns (ground) / railings (upper)
    if not upper:
        for x, z in plan.GALLERY["columns"]:
            px, pz = P(x, z)
            r = plan.GALLERY["column_radius"] * S
            d.ellipse([px - r, pz - r, px + r, pz + r], fill="#4a3a30")
    else:
        for r in plan.GALLERY["railings"]:
            d.line([P(*r["a"]), P(*r["b"])], fill="#1c1c1c", width=4)
        if not getattr(plan, "HALL_ONLY", False):
            lr = plan.STAIRS["landing_railing"]
            d.line([P(*lr["a"]), P(*lr["b"])], fill="#1c1c1c", width=4)
    # Seats
    for s in plan.seats():
        if (s["y"] > 1) != upper:
            continue
        px, pz = P(s["x"], s["z"])
        d.ellipse([px - 3, pz - 3, px + 3, pz + 3], fill="#2d2420")
    # Lights
    for L in plan.LIGHTS:
        if (L["y"] > 6.5) != upper and L["kind"] == "chandelier":
            pass
        px, pz = P(L["x"], L["z"])
        if L["kind"] == "chandelier":
            d.ellipse([px - 16, pz - 16, px + 16, pz + 16], outline="#d39a2a", width=3)
            d.ellipse([px - 5, pz - 5, px + 5, pz + 5], fill="#d39a2a")
    # Spawn points
    if not upper:
        for sp in plan.SPAWN_POINTS:
            px, pz = P(sp["x"], sp["z"])
            d.ellipse([px - 5, pz - 5, px + 5, pz + 5], fill="#3a8a4a")

    # Labels
    labels = {
        "hall": "GRAND READING HALL", "lobby": "ENTRANCE HALL", "quiet": "QUIET STUDY", "group": "GROUP STUDY",
        "lounge": "READING LOUNGE", "computers": "COMPUTERS & PRINTING", "services": "SERVICES", "rotunda": "REFERENCE ROTUNDA",
    }
    offsets = {"hall": (0, -0.95), "lobby": (0, 3.0), "rotunda": (0, -6.2), "quiet": (0, -4.6), "group": (0, -2.4),
               "lounge": (0, -4.6), "computers": (-2.0, 0.0), "services": (0.6, 0.9)}
    for room in plan.ROOMS:
        if upper and room.id != "hall":
            continue
        r = room.bounds
        ox, oz = offsets.get(room.id, (0, 0))
        cx, cz = (r["minX"] + r["maxX"]) / 2 + ox, (r["minZ"] + r["maxZ"]) / 2 + oz
        text = "UPPER GALLERY (U-shaped, around the hall)" if upper else labels[room.id]
        if upper:
            cx, cz = 0, -1
        f = font(17, True)
        tw = d.textlength(text, font=f)
        px, pz = P(cx, cz)
        d.rounded_rectangle([px - tw / 2 - 8, pz - 13, px + tw / 2 + 8, pz + 13], 6, fill="#fbf7efcc")
        d.text((px - tw / 2, pz - 11), text, fill="#2d2420", font=f)

    # Scale bar + north
    sx, sy = PAD, H - 26
    d.line([(sx, sy), (sx + 10 * S, sy)], fill="#2d2420", width=3)
    d.text((sx + 10 * S + 8, sy - 10), "10 m", fill="#2d2420", font=font(16))
    nx, ny = W - PAD - 20, 46
    d.polygon([(nx, ny - 22), (nx - 10, ny + 8), (nx + 10, ny + 8)], fill="#2d2420")
    d.text((nx - 6, ny + 10), "N", fill="#2d2420", font=font(16, True))
    legend = "dots = seats   brown = bookcases   blue = windows   orange = closed doors   dashed = gallery above   gold = chandeliers"
    d.text((PAD + 520, H - 34), legend, fill="#66574c", font=font(15))
    img.save(path)
    return path


# ---------------------------------------------------------------------------
# Checks: every seat and spawn is reachable at its level, nothing overlaps walls.
# ---------------------------------------------------------------------------

def blocked_at(colliders, x, z, y, radius=0.3):
    for c in colliders:
        if not (c["y1"] > y + 0.25 and c["y0"] < y + 1.75):
            continue
        if c["kind"] == "circle":
            if math.hypot(x - c["x"], z - c["z"]) < c["radius"] + radius:
                return True
        else:
            lx, lz = x - c["x"], z - c["z"]
            r = -c["rotationY"]
            cr, sr = math.cos(r), math.sin(r)
            # inverse of local_to_world rotation
            ux = lx * math.cos(c["rotationY"]) - lz * math.sin(c["rotationY"])
            uz = lx * math.sin(c["rotationY"]) + lz * math.cos(c["rotationY"])
            cxp = max(-c["halfW"], min(c["halfW"], ux))
            czp = max(-c["halfD"], min(c["halfD"], uz))
            if math.hypot(ux - cxp, uz - czp) < radius:
                return True
    return False


def surface_y(surfs, x, z, y):
    best = None
    for s in surfs:
        r = s["rect"]
        if not (r["minX"] - 1e-6 <= x <= r["maxX"] + 1e-6 and r["minZ"] - 1e-6 <= z <= r["maxZ"] + 1e-6):
            continue
        if s["kind"] == "flat":
            h = s["y"]
        else:
            t = (z - s["from"]) / (s["to"] - s["from"])
            h = s["y0"] + (s["y1"] - s["y0"]) * max(0.0, min(1.0, t))
        if h <= y + plan.STEP_UP and (best is None or h > best):
            best = h
    return best


def check():
    cols = plan.colliders()
    surfs = plan.surfaces()
    step = 0.2
    start = plan.SPAWN_POINTS[0]
    key = lambda x, z, y: (round(x / step), round(z / step), round(y * 4))
    seen = set()
    # Walk from the spawn; the lift also carries players between floors, so its stops are starts too.
    starts = [(start["x"], start["z"], 0.0)] + [(a["x"], a["z"], a["y"]) for a in plan.anchors() if a["kind"] == "lift"]
    q = deque(starts)
    for st in starts:
        seen.add(key(*st))
    reach = {}
    while q:
        x, z, y = q.popleft()
        reach.setdefault((round(x / step), round(z / step)), set()).add(round(y, 1))
        for dx, dz in ((step, 0), (-step, 0), (0, step), (0, -step)):
            nx, nz = x + dx, z + dz
            ny = surface_y(surfs, nx, nz, y)
            if ny is None or blocked_at(cols, nx, nz, ny):
                continue
            k = key(nx, nz, ny)
            if k in seen:
                continue
            seen.add(k)
            q.append((nx, nz, ny))
    problems = []
    for s in plan.seats():
        # Stand points around the seat, like findStandPoint.
        ok = False
        fx, fz = math.sin(s["rotationY"]), math.cos(s["rotationY"])
        sx, sz = fz, -fx
        for dd in (0.7, 0.85, 1.0):
            r2 = dd * math.sqrt(0.5)
            for px, pz in ((s["x"] - fx * dd, s["z"] - fz * dd), (s["x"] + fx * dd, s["z"] + fz * dd),
                           (s["x"] + sx * dd, s["z"] + sz * dd), (s["x"] - sx * dd, s["z"] - sz * dd),
                           (s["x"] + (sx - fx) * r2, s["z"] + (sz - fz) * r2),
                           (s["x"] - (sx + fx) * r2, s["z"] - (sz + fz) * r2)):
                gx, gz = round(px / step), round(pz / step)
                if any(any(abs(h - s["y"]) < 0.3 for h in reach.get((gx + i, gz + j), ())) for i in (-1, 0, 1) for j in (-1, 0, 1)):
                    if not blocked_at(cols, px, pz, s["y"], radius=0.28):
                        ok = True
                        break
            if ok:
                break
        if not ok:
            problems.append(f"seat {s['id']} has no reachable stand point")
    gallery_cells = sum(1 for v in reach.values() if any(h > 4 for h in v))
    # Furniture overlapping walls / each other (box approx by sampling centres)
    for it in plan.ITEMS:
        spec = plan.KINDS[it.kind]
        if spec["shape"] == "none":
            continue
        others = [c for c in cols if c["id"] != it.id and not c["id"].startswith(("gallery_slab", "landing_slab"))]
        if blocked_at(others, it.x, it.z, it.y, radius=0.05) and it.kind not in ("chair_reading", "chair_task"):
            problems.append(f"{it.id} centre is inside another collider")
    return problems, len(reach), gallery_cells


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "."
    os.makedirs(out, exist_ok=True)
    print(draw("ground", os.path.join(out, "plan_ground.png")))
    print(draw("gallery", os.path.join(out, "plan_gallery.png")))
    problems, cells, gallery = check()
    print("reachable cells", cells, "gallery cells", gallery, "seats", len(plan.seats()))
    for p in problems[:60]:
        print("PROBLEM", p)
    print("problems", len(problems))
