"""Hairstyles for the OVR avatar kit: a scalp cap with a hairline, plus sculpted locks."""

import bmesh
import math
import random
from mathutils import Matrix, Vector

from kit_core import join, mesh_from_bmesh, skin, torus, tube, uv_sphere
from kit_body import HEAD_CENTER

C = HEAD_CENTER
# Skull radii (x, y, z) the hair sits on, a touch larger than the head itself.
RX, RY, RZ = 0.157, 0.149, 0.168


def scalp(phi_deg, elev_deg, scale=1.0, lift=0.0):
    """Point on the hair shell. phi 0 = front, 90 = character's left, 180 = back; elev 90 = top."""
    p, e = math.radians(phi_deg), math.radians(elev_deg)
    return Vector((
        C.x + math.sin(p) * math.cos(e) * RX * scale,
        C.y - math.cos(p) * math.cos(e) * RY * scale,
        C.z + math.sin(e) * RZ * scale + lift,
    ))


def hairline_z(phi_deg, front=0.082, side=0.018, back=-0.085):
    c = math.cos(math.radians(phi_deg))
    return C.z + (side + (front - side) * max(0.0, c) ** 1.3 + (back - side) * max(0.0, -c) ** 1.1)


def shell(name, mat, scale, edge_z, cols=72, rows=22, tuck=0.035):
    """A smooth ellipsoid shell from an edge line edge_z(phi) up to the crown.

    Built as a (phi, elevation) grid so the edge follows the line exactly instead of
    stair-stepping along a UV sphere's rings. The first ring tucks in toward the head,
    which gives the edge a soft rolled look rather than a paper-thin cut.
    """
    bm = bmesh.new()
    rings = []
    for r in range(-1, rows):
        ring = []
        for k in range(cols):
            phi = 360.0 * k / cols
            s = (edge_z(phi) - C.z) / (RZ * scale)
            e0 = math.degrees(math.asin(max(-0.98, min(0.98, s))))
            if r < 0:
                ring.append(bm.verts.new(scalp(phi, e0 - 1.2, scale * (1 - tuck))))
            else:
                t = r / rows
                e = e0 + (90.0 - e0) * (1 - (1 - t) ** 1.25)
                ring.append(bm.verts.new(scalp(phi, e, scale)))
        rings.append(ring)
    top = bm.verts.new(scalp(0, 90, scale))
    for a, b in zip(rings, rings[1:]):
        for k in range(cols):
            bm.faces.new((a[k], a[(k + 1) % cols], b[(k + 1) % cols], b[k]))
    for k in range(cols):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % cols], top))
    bm.normal_update()
    bm.faces.ensure_lookup_table()
    probe = bm.faces[len(bm.faces) // 2]
    if probe.normal.dot(probe.calc_center_median() - C) < 0:
        for f in bm.faces:
            f.normal_flip()
    return mesh_from_bmesh(name, bm, mat)


def cap(mat, scale=1.04, front=0.082, side=0.018, back=-0.085, name="cap"):
    """Hair shell down to a hairline: high at the forehead, above the ears, low at the nape."""
    return shell(name, mat, scale, lambda phi: hairline_z(phi, front, side, back))


def lock(points, r0, r1, mat, wave=0.0, seed=0, name="lock"):
    """A tapered lock of hair through `points` (Vectors), optionally wavy."""
    rnd = random.Random(seed)
    pts = []
    n = len(points)
    for i, p in enumerate(points):
        t = i / max(1, n - 1)
        off = Vector((0, 0, 0))
        if wave and 0 < i < n - 1:
            off = Vector((math.sin(t * math.pi * 3 + seed) * wave, rnd.uniform(-1, 1) * wave * 0.4, 0))
        pts.append(p + off)
    radii = [r0 + (r1 - r0) * (i / max(1, n - 1)) ** 1.2 for i in range(n)]
    return tube(name, pts, radii, mat, resolution=5, segments=10)


def _fall(phi, elev_root, z_end, out=1.12, curl=0.0, steps=5, out_end=None):
    """Path from a root on the crown, over the skull, falling to z_end."""
    pts = [scalp(phi, elev_root, 1.0)]
    for k in range(1, steps):
        t = k / (steps - 1)
        e = elev_root * (1 - t) ** 1.4
        pt = scalp(phi, max(e, -5), out + (0.02 * math.sin(t * math.pi)))
        pts.append(pt)
    end = pts[-1].copy()
    end.z = min(end.z, z_end)
    oe = out_end if out_end is not None else out
    end.x = C.x + (end.x - C.x) * oe / out
    end.y = C.y + (end.y - C.y) * oe / out
    if curl:
        end += Vector((-(end.x - C.x), -(end.y - C.y), 0)).normalized() * curl
    pts[-1] = end
    # Extra point so long locks hang straight below the skull.
    if z_end < pts[-2].z - 0.05:
        mid = pts[-2].lerp(end, 0.5)
        pts.insert(-1, mid)
    return pts


def _fringe(mat, phis, z_end, root_elev=72, out=1.10, r=(0.032, 0.010), seed=0, sweep=0.0):
    locks = []
    for i, phi in enumerate(phis):
        root = scalp(phi * 0.6, root_elev, 1.0)
        mid = scalp(phi + sweep * 0.5, 40, out)
        end = scalp(phi + sweep, 0, out * 0.98)
        end.z = z_end + 0.004 * math.cos(math.radians(phi) * 3)
        locks.append(lock([root, mid, end], r[0], r[1], mat, seed=seed + i, name=f"fr{i}"))
    return locks


# ---------------------------------------------------------------------------
# Styles
# ---------------------------------------------------------------------------

def style_crop(mat, accent):
    parts = [cap(mat, 1.05)]
    rnd = random.Random(3)
    for i, phi in enumerate(range(-150, 151, 25)):
        root = scalp(phi, 78, 1.02)
        mid = scalp(phi * 0.9 + rnd.uniform(-8, 8), 58, 1.10)
        end = scalp(phi * 0.85, 40 if abs(phi) > 60 else 48, 1.08)
        parts.append(lock([root, mid, end], 0.034, 0.012, mat, name=f"c{i}"))
    parts += _fringe(mat, [-45, -22, 0, 22, 45], hairline_z(0) + 0.006, r=(0.03, 0.012), seed=4, sweep=12)
    return parts


def style_buzz(mat, accent):
    return [cap(mat, 1.018, front=0.088, side=0.025, back=-0.075)]


def style_bob(mat, accent):
    parts = [cap(mat, 1.06, side=0.0)]
    for i, phi in enumerate(range(-150, 181, 15)):
        if abs(phi) < 60:
            continue
        parts.append(lock(_fall(phi, 70, C.z - 0.075, out=1.15, curl=0.012), 0.036, 0.022, mat, name=f"b{i}"))
    parts += _fringe(mat, [-52, -34, -17, 0, 17, 34, 52], C.z + 0.072, r=(0.03, 0.016), seed=7)
    return parts


def style_long(mat, accent):
    parts = [cap(mat, 1.06, side=0.0)]
    for i, phi in enumerate(range(-160, 181, 14)):
        if abs(phi) < 62:
            continue
        parts.append(lock(_fall(phi, 72, 1.27 + 0.02 * math.cos(math.radians(phi * 2)), out=1.16, out_end=1.4, steps=7), 0.036, 0.012, mat, wave=0.012, seed=i, name=f"l{i}"))
    # Face-framing pieces swept to the sides of the forehead.
    parts += _fringe(mat, [-40, -20, 20, 40], C.z + 0.068, r=(0.03, 0.012), seed=9, sweep=0)
    return parts


def style_curly(mat, accent):
    """An even, rounded halo of curls (Fibonacci-sphere spacing, so no bald or lumpy patches)."""
    parts = [cap(mat, 1.08)]
    rnd = random.Random(11)
    n = 150
    golden = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n
        elev = math.degrees(math.asin(z))
        phi = math.degrees((i * golden) % math.tau) - 180
        if elev < -30:
            continue
        if abs(phi) < 62 and elev < 40:
            continue  # keep the face clear
        if abs(phi) < 105 and elev < 6:
            continue  # and the ears
        r = rnd.uniform(0.032, 0.044)
        p = scalp(phi, elev, rnd.uniform(1.2, 1.3))
        parts.append(uv_sphere(f"k{i}", r, p, (1, 1, 0.92), 12, 8, mat))
    return parts


def style_bun(mat, accent):
    parts = [cap(mat, 1.035)]
    bun_c = C + Vector((0, 0.045, 0.172))
    parts.append(uv_sphere("bun", 0.064, bun_c, (1, 1, 0.9), 24, 16, mat))
    for k in range(3):
        a = k * math.tau / 3
        pts = [bun_c + Vector((math.cos(a + t) * 0.06, math.sin(a + t) * 0.06, 0.035 - t * 0.02)) for t in (0, 0.7, 1.4, 2.1)]
        parts.append(lock(pts, 0.018, 0.008, mat, name=f"sw{k}"))
    parts.append(torus("tie", 0.05, 0.012, bun_c + Vector((0, -0.002, -0.048)), accent, minor_seg=8, major_seg=24, scale=(1, 1, 1)))
    for i, phi in enumerate((-120, -90, 90, 120, 150, 180, -150)):
        parts.append(lock([scalp(phi, 10, 1.03), scalp(phi * 0.5, 60, 1.07), bun_c + Vector((0, 0, -0.03))], 0.026, 0.014, mat, name=f"pull{i}"))
    return parts


def style_ponytail(mat, accent):
    parts = [cap(mat, 1.04)]
    tie_c = C + Vector((0, 0.150, 0.035))
    parts.append(torus("tie", 0.024, 0.011, tie_c, accent, rot=Matrix.Rotation(math.pi / 2, 3, "X"), minor_seg=8, major_seg=20))
    rnd = random.Random(5)
    for k in range(6):
        dx = rnd.uniform(-0.02, 0.02)
        pts = [tie_c + Vector((dx * 0.3, 0.012, 0)), tie_c + Vector((dx, 0.06, -0.06)), tie_c + Vector((dx * 1.4, 0.07, -0.16)), tie_c + Vector((dx * 1.2, 0.045, -0.27))]
        parts.append(lock(pts, 0.032, 0.008, mat, wave=0.008, seed=k, name=f"tail{k}"))
    for i, phi in enumerate((-140, -100, -70, 70, 100, 140, 180)):
        parts.append(lock([scalp(phi, 18, 1.04), scalp(phi * 0.7 + (180 if abs(phi) > 120 else 0) * 0, 45, 1.08), tie_c], 0.028, 0.016, mat, name=f"p{i}"))
    parts += _fringe(mat, [-30, -10, 10, 30], C.z + 0.078, r=(0.026, 0.01), seed=2, sweep=-8)
    return parts


def style_twists(mat, accent):
    parts = [cap(mat, 1.05)]
    for i, phi in enumerate(range(-165, 181, 15)):
        if abs(phi) < 55:
            continue
        pts = _fall(phi, 30, 1.30 + 0.03 * math.sin(i), out=1.12, steps=6, out_end=1.25)
        n = 14
        # Re-sample the path so the radius can pulse like a twist.
        dense = [pts[0].lerp(pts[-1], 0)]
        for k in range(1, n):
            t = k / (n - 1) * (len(pts) - 1)
            a = int(min(len(pts) - 2, t))
            dense.append(pts[a].lerp(pts[a + 1], t - a))
        radii = [0.016 if k % 2 == 0 else 0.0115 for k in range(n)]
        radii[-1] = 0.009
        parts.append(tube(f"tw{i}", dense, radii, mat, resolution=3, segments=8))
    for i, phi in enumerate((-48, -24, 0, 24, 48)):
        root = scalp(phi, 78, 1.02)
        end = scalp(phi * 1.6, 30, 1.14)
        parts.append(tube(f"top{i}", [root, root.lerp(end, 0.5) + Vector((0, 0, 0.02)), end], [0.016, 0.012, 0.010], mat, segments=8))
    return parts


def style_swept(mat, accent):
    parts = [cap(mat, 1.035, side=0.03)]
    # One big swoop from the right over the top to the left temple.
    for i, k in enumerate(range(-3, 4)):
        root = scalp(-110 + k * 6, 55 + k * 3, 1.03)
        crest = scalp(-35 + k * 8, 86 - abs(k) * 3, 1.22 + 0.01 * (3 - abs(k)))
        front = scalp(30 + k * 6, 52 + k * 2, 1.16)
        end = scalp(62 + k * 4, 22 + k * 3, 1.1)
        parts.append(lock([root, crest, front, end], 0.04, 0.012, mat, seed=i, name=f"sw{i}"))
    for i, phi in enumerate((-150, 150, 180, -120, 120)):
        parts.append(lock(_fall(phi, 60, C.z - 0.02, out=1.07, steps=4), 0.03, 0.016, mat, name=f"bk{i}"))
    return parts


def style_spacebuns(mat, accent):
    parts = [cap(mat, 1.035)]
    for side in (1, -1):
        bun_c = C + Vector((0.106 * side, 0.012, 0.162))
        parts.append(uv_sphere(f"bun{side}", 0.056, bun_c, (1, 1, 0.92), 20, 14, mat))
        parts.append(torus(f"tie{side}", 0.040, 0.010, bun_c + Vector((-0.024 * side, 0, -0.038)), accent, rot=Matrix.Rotation(-0.55 * side, 3, "Y"), minor_seg=8, major_seg=20))
        for k in range(2):
            a = k * math.pi + side
            pts = [bun_c + Vector((math.cos(a + t) * 0.048, math.sin(a + t) * 0.048, 0.03 - t * 0.015)) for t in (0, 0.8, 1.6, 2.4)]
            parts.append(lock(pts, 0.015, 0.007, mat, name=f"bsw{side}{k}"))
    parts += _fringe(mat, [-40, -20, 0, 20, 40], C.z + 0.074, r=(0.028, 0.012), seed=13)
    return parts


STYLES = {
    "crop": style_crop,
    "buzz": style_buzz,
    "bob": style_bob,
    "long": style_long,
    "curly": style_curly,
    "bun": style_bun,
    "ponytail": style_ponytail,
    "twists": style_twists,
    "swept": style_swept,
    "spacebuns": style_spacebuns,
}


def build_hair(style, rig, mat, accent):
    parts = STYLES[style](mat, accent)
    ob = join(parts, f"Hair_{style.capitalize()}")
    skin(ob, rig, rigid="Head")
    return ob
