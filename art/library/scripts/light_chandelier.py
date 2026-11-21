"""
Hero light fixtures for the OVR library (Ref 1): the grand tiered ring chandelier of the main hall,
a two-arm brass wall sconce and the hexagonal brass-and-glass hall lantern of the entrance lobby.

Placement conventions (read before placing):

  build_chandelier_grand(drop=4.0)
      The BODY hangs with its lowest point (the tip of the pendant finial) at z = 0 and its top
      (the crown's loop) at z = BODY_H (2.2 m). The ceiling canopy's top face (the ceiling contact)
      is at z = BODY_H + drop. Place it by its bottom: root.location.z = height of the finial tip.
      For a ceiling contact at height Hc and a body bottom at Hb, use drop = Hc - Hb - BODY_H.
      In the Grand Reading Hall the contact is arch_ceiling.CHANDELIER_CONTACT_Z (13.12, the coffer
      panel), so a bottom at 6.1 m gives drop = 4.82 (the triangle budget is checked at that drop).
      Like Ref 1 (NYPL Rose Room), the tiers step inward going DOWN: the widest ring (2.6 m, 40
      lamps) is the crowning tier at the top, then a 24-lamp ring, a 12-lamp ring and a lamp bowl
      (8) above the pendant finial - 84 lamps. Every lamp is a 114 mm opal globe hanging in a gilt
      petal cup tucked right under its ring (Ref 1's lamps), not an upright candle.
      Structure is 3-fold: 6 main arms to the crowning ring, 3 each to tiers B and C, 3 crown
      brackets and 3 chains (each arm a tapered cast bronze rod with an under-volute, a gilt boss,
      a gilt leaf calyx at the stem and a gilt socket at the ring).
      Triangles (rendered, instances counted): 68,776 at drop 4.0, 69,352 at the hall drop 4.82.

  build_sconce_wall()
      Wall plane y = 0 (room on -Y). z = 0 is the centre of the backplate: place it at the
      mounting height (typically 2.0-2.2 m).

  build_lantern_pendant(drop=1.2)
      Lantern body's lowest point (finial tip) at z = 0; the ceiling rose's top at
      z = LANTERN_H + drop.

Each builder returns ONE root object named after the asset; every other part is parented to it
(repeated parts - lamps, arms, frieze and soffit bays, chain runs - are linked duplicates sharing one
mesh). Move/rotate the root to place the whole fixture. `flatten(root)` bakes it into one joined,
per-material mesh if a caller prefers that over instances.

The chandelier's cast bands are real pierced plates: each bay's tracery (mouchettes, vesicas) is drawn
as a 2D distance field, the openings are traced with marching squares, triangulated with holes and
extruded to an 8-12 mm thick plate that is fused into the rails (see _Web / _plate). The plates are
parcel-gilt: a near-black patinated bronze skin (palette key bronze_patina, added here) with gilt
reveals round every opening, so the tracery reads as gold on dark like Ref 1's bands. Their skins
carry custom split normals (the true ring/cone normal), so a bay shades as one smooth curve.
"""

from __future__ import annotations

import math

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.geometry import tessellate_polygon

import lib_core as C
from lib_materials import PALETTE, mat, tex_size

TAU = math.tau

BODY_H = 2.2          # chandelier body height (finial tip to crown loop)
CHAND_R = 1.30        # outer radius of the crowning ring (2.6 m diameter)
LANTERN_H = 1.66      # lantern body height (finial tip to top loop)
HALL_DROP = 4.82      # drop that hangs the body bottom at 6.1 m under the hall's coffer panel (13.12)

# Patinated (near-black) cast bronze for the pierced bands: the parcel-gilt tracery reads as gold on dark (Ref 1).
PALETTE.setdefault("bronze_patina", dict(base="#2a2119", rough=0.5, metal=0.85))
# Pleated silk candle shade: glows like lit fabric (emission fakes the light through the silk).
PALETTE.setdefault("silk_shade", dict(base="#ead9b8", rough=0.88, emission="#ffd49a", emit=0.55,
                                      tex="fabric", size=0.4, normal=0.3, tint="#f4e6cc"))


# ---------------------------------------------------------------------------
# Private geometry helpers
# ---------------------------------------------------------------------------

def _mats(keys):
    return [mat(k) for k in keys]


def _lathe(name, profile, segments=32, keys=("brass_aged",), idx=None, lobes=None, smooth_angle=40.0,
           closed=False, cap_bottom=True, cap_top=True, phase=0.0, lobe_w=None):
    """Revolves [(r, z), ...] around Z. `idx[i]` is the material index of span i (profile[i] ->
    profile[i+1]). `lobes=(n, amount, z0, z1)` flutes/gadroons the surface between z0 and z1 (keep
    `segments` a multiple of n); `lobe_w` (one weight per profile point) replaces the z window.
    `closed=True` revolves a closed section (ring mouldings: profile counter-clockwise in (r, z)).
    UVs: U runs around (spun-metal grain), V along the profile, at the first material's tile size."""
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    prof = list(profile)
    lw = list(lobe_w) if lobe_w else None
    if closed and (Vector(prof[0]) - Vector(prof[-1])).length > 1e-7:
        prof.append(prof[0])
        if lw:
            lw.append(lw[0])
    rings = []
    for k, (r, z) in enumerate(prof):
        ring = []
        for i in range(segments):
            a = TAU * i / segments + phase
            rr = max(r, 0.0)
            if lobes:
                n, amt, z0, z1 = lobes
                if lw is not None:
                    w = lw[k]
                else:
                    w = math.sin(math.pi * (z - z0) / (z1 - z0)) if z0 < z < z1 else 0.0
                rr *= 1.0 + amt * w * (0.5 + 0.5 * math.cos(n * (a - phase)))
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z)))
        rings.append(ring)
    vs = [0.0]
    for p, q in zip(prof, prof[1:]):
        vs.append(vs[-1] + math.hypot(q[0] - p[0], q[1] - p[1]))
    size = tex_size(keys[0])
    for s, (a, c) in enumerate(zip(rings, rings[1:])):
        mi = idx[s] if idx else 0
        rad = max(prof[s][0], prof[s + 1][0], 0.01)
        for i in range(segments):
            j = (i + 1) % segments
            try:
                f = bm.faces.new((a[i], a[j], c[j], c[i]))
            except ValueError:
                continue
            f.material_index = mi
            u0 = TAU * rad * i / segments / size
            u1 = TAU * rad * (i + 1) / segments / size
            for loop, (uu, vv) in zip(f.loops, ((u0, vs[s]), (u1, vs[s]), (u1, vs[s + 1]), (u0, vs[s + 1]))):
                loop[uvl].uv = (uu, vv / size)
    if not closed:
        caps = []
        if cap_bottom and prof[0][0] > 1e-5:
            caps.append((list(reversed(rings[0])), idx[0] if idx else 0))
        if cap_top and prof[-1][0] > 1e-5:
            caps.append((rings[-1], idx[-1] if idx else 0))
        for verts, mi in caps:
            f = bm.faces.new(verts)
            f.material_index = mi
            for loop in f.loops:
                loop[uvl].uv = (loop.vert.co.x / size, loop.vert.co.y / size)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, _mats(keys))
    C.shade_smooth(ob, smooth_angle)
    return ob


def _join(objects, name):
    """lib_core.join, after giving any part without UVs (tori, spheres) a world box projection at
    its material's tile size, so nothing in the joined mesh has collapsed UVs."""
    for o in objects:
        if o is not None and o.type == "MESH" and not o.data.uv_layers:
            key = next((k for k in ("brass", "brass_aged") if o.data.materials and
                        o.data.materials[0] == mat(k)), None)
            C.uv_box(o, size=tex_size(key) if key else 0.3)
    return C.join(objects, name)


def _frames(pts, closed, normal):
    n = len(pts)
    T = []
    for i in range(n):
        if closed:
            d = pts[(i + 1) % n] - pts[i - 1]
        else:
            d = pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]
        T.append(d.normalized())
    out = []
    if normal is not None:
        pn = Vector(normal).normalized()
        for t in T:
            N = pn.cross(t)
            if N.length < 1e-8:
                N = Vector((1, 0, 0))
            N.normalize()
            out.append((t, N, t.cross(N)))
        return out
    t0 = T[0]
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    N = (ref - t0 * ref.dot(t0)).normalized()
    for t in T:
        N = (N - t * N.dot(t))
        N = N.normalized() if N.length > 1e-8 else N
        out.append((t, N, t.cross(N)))
    return out


def _tube(name, pts, radius, sides=8, key="brass_aged", normal=None, aspect=1.0, closed=False, caps=True,
          section="round", smooth_angle=55.0, uv_size=None):
    """A tube along a polyline. `radius` is a float or a function of t in [0, 1]. With `normal`
    (a plane normal for planar paths) the section is oriented in that plane: the in-plane
    half-size is `radius`, the out-of-plane half-size `radius * aspect`. section: round|rect.
    `caps` is a bool or (start, end): leave a cap off where the end is buried in another part."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    rad = radius if callable(radius) else (lambda t, r=radius: r)
    L = [0.0]
    for i in range(1, n):
        L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    total = max(L[-1], 1e-9)
    frames = _frames(pts, closed, normal)
    if section == "rect":
        offs = [(1, 1), (-1, 1), (-1, -1), (1, -1)]
    else:
        offs = [(math.cos(TAU * k / sides), math.sin(TAU * k / sides)) for k in range(sides)]
    m = len(offs)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    size = uv_size or tex_size("brass")
    rings = []
    for i, p in enumerate(pts):
        t, N, B = frames[i]
        r = rad(L[i] / total)
        rings.append([bm.verts.new(p + N * (cx * r) + B * (cy * r * aspect)) for cx, cy in offs])
    pairs = list(range(n - 1)) + ([n - 1] if closed else [])
    perim = TAU * max(rad(0.5), 0.003)
    for i in pairs:
        a, c = rings[i], rings[(i + 1) % n]
        u0, u1 = L[i] / size, (L[i] + (pts[(i + 1) % n] - pts[i]).length) / size
        for k in range(m):
            kk = (k + 1) % m
            try:
                f = bm.faces.new((a[k], a[kk], c[kk], c[k]))
            except ValueError:
                continue
            v0, v1 = perim * k / m / size, perim * (k + 1) / m / size
            for loop, uv in zip(f.loops, ((u0, v0), (u0, v1), (u1, v1), (u1, v0))):
                loop[uvl].uv = uv
    cs, ce = (caps, caps) if isinstance(caps, bool) else caps
    if not closed:
        for ring, rev, want in ((rings[0], True, cs), (rings[-1], False, ce)):
            if not want:
                continue
            try:
                bm.faces.new(list(reversed(ring)) if rev else ring)
            except ValueError:
                pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    ob = C.mesh_from_bmesh(name, bm, mat(key))
    C.shade_smooth(ob, smooth_angle)
    return ob


def _catmull(points, n=8):
    """Samples a Catmull-Rom spline through `points` (2D or 3D), `n` samples per span."""
    P = [Vector(p) for p in points]
    P = [P[0] + (P[0] - P[1])] + P + [P[-1] + (P[-1] - P[-2])]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for s in range(n):
            t = s / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2])
    return out


def _bezier(p0, p1, p2, p3, n=10, include_start=True):
    p0, p1, p2, p3 = (Vector(p) for p in (p0, p1, p2, p3))
    out = []
    for i in range(0 if include_start else 1, n + 1):
        t = i / n
        s = 1 - t
        out.append(p0 * s ** 3 + p1 * 3 * s * s * t + p2 * 3 * s * t * t + p3 * t ** 3)
    return out


def _spiral(center, r_out, a0, turns, shrink, direction=1, n=16, bias=1.45):
    """Volute: from the outer point (angle a0, radius r_out) winding inward `turns` times.
    `shrink` is the inner/outer radius ratio; direction +1 = counter-clockwise. `bias` > 1 spends
    more of the n samples on the long outer turn, fewer on the tight eye."""
    c = Vector(center)
    k = -math.log(shrink) / (turns * TAU)
    out = []
    for i in range(n + 1):
        s = (i / n) ** bias
        th = a0 + direction * s * turns * TAU
        r = r_out * math.exp(-k * s * turns * TAU)
        out.append(c + Vector((math.cos(th), math.sin(th))) * r)
    return out


def _c_scroll(start, end, bulge, r_curl, turns=1.0, shrink=0.3, n=10, n_sp=24, curl_dir=1):
    """A C-scroll in 2D: a curve from `start` bowing by `bulge` (perpendicular offset) to `end`,
    ending in a volute that keeps turning the same way."""
    s, e = Vector(start), Vector(end)
    d = e - s
    perp = Vector((-d.y, d.x)).normalized() * bulge
    body = _bezier(s, s + d * 0.15 + perp, s + d * 0.75 + perp, e, n)
    t = (body[-1] - body[-2]).normalized()
    nrm = Vector((-t.y, t.x)) * curl_dir
    cen = e + nrm * r_curl
    a0 = math.atan2(e.y - cen.y, e.x - cen.x)
    sp = _spiral(cen, r_curl, a0, turns, shrink, curl_dir, n_sp)
    return body + sp[1:]


def _plane_pts(pts2, phi=0.0, y=0.0):
    """Maps 2D (rho, z) points into the vertical radial plane at azimuth phi."""
    c, s = math.cos(phi), math.sin(phi)
    return [Vector((p[0] * c - y * s, p[0] * s + y * c, p[1])) for p in pts2]


def _orient(pos, direction):
    """Matrix that moves a part built along +Z at the origin to `pos`, pointing along `direction`."""
    q = Vector((0, 0, 1)).rotation_difference(Vector(direction).normalized())
    return Matrix.Translation(Vector(pos)) @ q.to_matrix().to_4x4()


def _box(name, size, center, key, bevel_w=0.003, rot=None):
    ob = C.box(name, size, center, mat(key), bevel_w=bevel_w, rot=rot)
    C.uv_box(ob, size=tex_size(key) if key in ("brass", "brass_aged") else 1.0, grain=None)
    return ob


def _weld(ob, dist=1e-6):
    """Merges coincident vertices (e.g. the seam of a closed sweep profile)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=dist)
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return ob


def _parent(children, root):
    for ch in children:
        if ch is None or ch is root:
            continue
        ch.parent = root
        ch.matrix_parent_inverse = Matrix.Identity(4)
    return root


def _hide_template(ob):
    """Template meshes are only held by their instances: unlink the template object itself."""
    me = ob.data
    bpy.data.objects.remove(ob, do_unlink=True)
    return me


def _instances(me, name, placements, root):
    """Creates linked-duplicate objects of mesh `me` for [(loc, rot_z), ...], parented to root."""
    out = []
    for i, (loc, rz) in enumerate(placements):
        ob = bpy.data.objects.new(f"{name}_{i + 1:02d}", me)
        C.link(ob)
        ob.location = Vector(loc)
        ob.rotation_euler = (0, 0, rz)
        out.append(ob)
    _parent(out, root)
    return out


def _ring_of(me, name, n, root, offset=0.0):
    return _instances(me, name, [((0, 0, 0), TAU * (i + offset) / n) for i in range(n)], root)


def flatten(root, name=None):
    """Bakes a fixture (root + parented instances) into one joined mesh (materials kept)."""
    parts = [root] + [c for c in root.children_recursive if c.type == "MESH"]
    copies = []
    for p in parts:
        ob = bpy.data.objects.new(p.name + "_flat", p.data.copy())
        C.link(ob)
        ob.matrix_world = p.matrix_world.copy()
        copies.append(ob)
    return _join(copies, name or (root.name + "_Flat"))


def asset_tris(root):
    """Rendered triangles (instances counted every time) and unique-mesh triangles."""
    parts = [root] + [c for c in root.children_recursive if c.type == "MESH"]
    total = sum(C.tris(p) for p in parts)
    uniq = {}
    for p in parts:
        uniq[p.data.name] = C.tris(p)
    return total, sum(uniq.values())


def tri_split(root):
    """{mesh name: (tris per instance, instances)} for budget reports."""
    out = {}
    for p in [root] + [c for c in root.children_recursive if c.type == "MESH"]:
        t, n = out.get(p.data.name, (C.tris(p), 0))
        out[p.data.name] = (t, n + 1)
    return out


# ---------------------------------------------------------------------------
# Pierced cast plates: a bay's tracery is a 2D distance field (metal < 0 < opening); the openings
# are traced with marching squares, simplified, triangulated with holes and extruded.
# ---------------------------------------------------------------------------

class _Web:
    """A bay of pierced plate over [u0, u1] x [v0, v1] (metres). Everything starts as metal;
    cut_stroke / cut_disk open tapered slots and roundels; boss() records a gilt boss."""

    def __init__(self, u0, u1, v0, v1, h=0.0007):
        self.h = h
        self.u = np.arange(u0, u1 + 0.5 * h, h)
        self.v = np.arange(v0, v1 + 0.5 * h, h)
        self.U, self.V = np.meshgrid(self.u, self.v)
        self.F = np.full(self.U.shape, -1.0)
        self.bosses = []

    def _cut(self, f):
        np.maximum(self.F, f, out=self.F)

    def cut_stroke(self, pts, w0, w1=None):
        """Opens a slot along a polyline, width w0 at the start tapering to w1 (round ends)."""
        w1 = w0 if w1 is None else w1
        P = [(float(p[0]), float(p[1])) for p in pts]
        L = [0.0]
        for a, b in zip(P, P[1:]):
            L.append(L[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
        tot = max(L[-1], 1e-9)
        best = np.full(self.U.shape, 1.0)
        for k, (a, b) in enumerate(zip(P, P[1:])):
            dx, dy = b[0] - a[0], b[1] - a[1]
            ll = dx * dx + dy * dy
            if ll < 1e-14:
                continue
            t = np.clip(((self.U - a[0]) * dx + (self.V - a[1]) * dy) / ll, 0.0, 1.0)
            d = np.hypot(self.U - (a[0] + t * dx), self.V - (a[1] + t * dy))
            s = (L[k] + t * math.sqrt(ll)) / tot
            np.minimum(best, d - 0.5 * (w0 + (w1 - w0) * s), out=best)
        self._cut(-best)

    def cut_disk(self, c, r):
        self._cut(r - np.hypot(self.U - c[0], self.V - c[1]))

    def boss(self, c, r):
        self.bosses.append((float(c[0]), float(c[1]), r))


def _poly_area(poly):
    s = 0.0
    for (x0, y0), (x1, y1) in zip(poly, poly[1:] + poly[:1]):
        s += x0 * y1 - x1 * y0
    return s / 2


def _rdp(pts, eps):
    if len(pts) < 3:
        return list(pts)
    a, b = Vector(pts[0]), Vector(pts[-1])
    ab = b - a
    L = ab.length
    best, bi = -1.0, 0
    for i in range(1, len(pts) - 1):
        p = Vector(pts[i])
        d = abs(ab.x * (a.y - p.y) - ab.y * (a.x - p.x)) / L if L > 1e-12 else (p - a).length
        if d > best:
            best, bi = d, i
    if best > eps:
        return _rdp(pts[:bi + 1], eps)[:-1] + _rdp(pts[bi:], eps)
    return [pts[0], pts[-1]]


def _rdp_closed(poly, eps):
    p0 = Vector(poly[0])
    k = max(range(len(poly)), key=lambda i: (Vector(poly[i]) - p0).length)
    return _rdp(poly[:k + 1], eps)[:-1] + _rdp(poly[k:] + [poly[0]], eps)[:-1]


def _trace(web, eps=0.0008, min_area=8e-6):
    """Marching squares on web.F: returns the openings as counter-clockwise polygons."""
    F = web.F.copy()
    F[0, :] = F[-1, :] = -1.0
    F[:, 0] = F[:, -1] = -1.0
    ins = F > 0
    case = (ins[:-1, :-1].astype(np.uint8) | (ins[:-1, 1:].astype(np.uint8) << 1)
            | (ins[1:, 1:].astype(np.uint8) << 2) | (ins[1:, :-1].astype(np.uint8) << 3))
    ii, jj = np.nonzero((case != 0) & (case != 15))
    u, v, h = web.u, web.v, web.h
    pts, adj = {}, {}

    def ep(key):
        if key not in pts:
            kind, i, j = key
            if kind == "h":
                f0, f1 = F[i, j], F[i, j + 1]
                pts[key] = (u[j] + f0 / (f0 - f1) * h, v[i])
            else:
                f0, f1 = F[i, j], F[i + 1, j]
                pts[key] = (u[j], v[i] + f0 / (f0 - f1) * h)

    def seg(a, b):
        ep(a)
        ep(b)
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)

    for i, j in zip(ii.tolist(), jj.tolist()):
        c = int(case[i, j])
        B, R, T, L = ("h", i, j), ("v", i, j + 1), ("h", i + 1, j), ("v", i, j)
        if c in (1, 14):
            seg(L, B)
        elif c in (2, 13):
            seg(B, R)
        elif c in (3, 12):
            seg(L, R)
        elif c in (4, 11):
            seg(R, T)
        elif c in (6, 9):
            seg(B, T)
        elif c in (7, 8):
            seg(L, T)
        else:                                   # saddles: decide by the cell centre
            centre = F[i:i + 2, j:j + 2].mean() > 0
            if (c == 5) == centre:
                seg(B, R)
                seg(L, T)
            else:
                seg(L, B)
                seg(R, T)
    loops, seen = [], set()
    for start in adj:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nb = adj[cur]
            nxt = nb[0] if nb[0] != prev else (nb[1] if len(nb) > 1 else None)
            if nxt is None or nxt == start or nxt in seen:
                break
            loop.append(nxt)
            seen.add(nxt)
            prev, cur = cur, nxt
        poly = [pts[k] for k in loop]
        if len(poly) < 4 or abs(_poly_area(poly)) < min_area:
            continue
        poly = _rdp_closed(poly, eps)
        if _poly_area(poly) < 0:
            poly.reverse()
        loops.append(poly)
    return loops


def _rect_loop(u0, u1, v0, v1, nu=6):
    """Counter-clockwise rectangle with `nu` divisions along u (so a wrapped plate follows its curve)."""
    bot = [(u0 + (u1 - u0) * i / nu, v0) for i in range(nu + 1)]
    top = [(u1 - (u1 - u0) * i / nu, v1) for i in range(nu + 1)]
    return bot + top


def _plate(name, loops, t, mapper, key="bronze", uv_size=0.3, outer_wall=None, back=True, wall_key=None):
    """Solid plate from planar loops (loops[0] the outer boundary, the rest openings; all CCW in
    (u, v)). mapper(u, v, w) -> Vector places it in 3D; the face at w = +t/2 is the front. Walls line
    every opening; `outer_wall(p, q)` returns True for boundary edges that need a wall too (exposed
    edges - the rest are buried in rails or shared with the neighbouring bay). `wall_key` gives the
    walls their own material (parcel gilding: gilt reveals round every opening).
    The 2D triangulation is beautified (no slivers) and the faces get custom split normals: the
    plate's true surface normal on both skins (so a bay wrapped on a ring shades as one smooth
    curve, not a flat facet) and normals smoothed around each opening's wall."""
    flat = [p for loop in loops for p in loop]
    tri = tessellate_polygon([[(p[0], p[1], 0.0) for p in loop] for loop in loops])
    # beautify the 2D triangulation (constrained: boundary and opening edges stay)
    b2 = bmesh.new()
    vv = [b2.verts.new((p[0], p[1], 0.0)) for p in flat]
    for a, b, c in tri:
        (ax, ay), (bx, by), (cx, cy) = flat[a], flat[b], flat[c]
        if (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0:
            b, c = c, b
        try:
            b2.faces.new((vv[a], vv[b], vv[c]))
        except ValueError:
            pass
    inner = [e for e in b2.edges if len(e.link_faces) == 2]
    bmesh.ops.beautify_fill(b2, faces=list(b2.faces), edges=inner)
    b2.verts.index_update()
    tri = []
    for f in b2.faces:
        ids = [v.index for v in f.verts]
        (ax, ay), (bx, by), (cx, cy) = (flat[i] for i in ids)
        if (bx - ax) * (cy - ay) - (by - ay) * (cx - ax) < 0:
            ids = [ids[0], ids[2], ids[1]]
        tri.append(ids)
    b2.free()
    cu = sum(p[0] for p in loops[0]) / len(loops[0])
    cv = sum(p[1] for p in loops[0]) / len(loops[0])
    o = mapper(cu, cv, 0.0)
    du, dv, dw = (mapper(cu + 1e-3, cv, 0.0) - o), (mapper(cu, cv + 1e-3, 0.0) - o), (mapper(cu, cv, 1e-3) - o)
    flip = du.cross(dv).dot(dw) < 0
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    Fv = [bm.verts.new(mapper(p[0], p[1], t / 2)) for p in flat]
    Bv = [bm.verts.new(mapper(p[0], p[1], -t / 2)) for p in flat]
    nflat = len(flat)
    skin_n = [(mapper(p[0], p[1], 1e-3) - mapper(p[0], p[1], -1e-3)).normalized() for p in flat]
    kinds = []                                  # per face: ("skin", sign) or ("wall", loop id)

    def face(vs, uvs, kind):
        if flip:
            vs, uvs = vs[::-1], uvs[::-1]
        try:
            f = bm.faces.new(vs)
        except ValueError:
            return
        kinds.append(kind)
        if wall_key and kind[0] == "wall":
            f.material_index = 1
        for lp, uv in zip(f.loops, uvs):
            lp[uvl].uv = uv

    def puv(i):
        return (flat[i][0] / uv_size, flat[i][1] / uv_size)
    for a, b, c in tri:
        face([Fv[a], Fv[b], Fv[c]], [puv(a), puv(b), puv(c)], ("skin", 1))
        if back:
            face([Bv[c], Bv[b], Bv[a]], [puv(c), puv(b), puv(a)], ("skin", -1))
    off = 0
    for li, loop in enumerate(loops):
        n = len(loop)
        s = 0.0
        for k in range(n):
            i, j = off + k, off + (k + 1) % n
            seg = math.hypot(flat[j][0] - flat[i][0], flat[j][1] - flat[i][1])
            uvs = [(s / uv_size, t / uv_size), ((s + seg) / uv_size, t / uv_size), ((s + seg) / uv_size, 0.0),
                   (s / uv_size, 0.0)]
            if li > 0:
                face([Fv[i], Fv[j], Bv[j], Bv[i]], uvs, ("wall", li))
            elif outer_wall is not None and outer_wall(flat[i], flat[j]):
                face([Bv[i], Bv[j], Fv[j], Fv[i]], uvs[::-1], ("wall", li))
            s += seg
        off += n
    ob = C.mesh_from_bmesh(name, bm, _mats((key, wall_key) if wall_key else (key,)))
    C.shade_smooth(ob, 50)
    _plate_normals(ob, kinds, skin_n, nflat)
    return ob


def _plate_normals(ob, kinds, skin_n, nflat, wall_smooth=45.0):
    me = ob.data
    pn = [p.normal.copy() for p in me.polygons]
    # wall vertex normals: average the walls meeting at a vertex unless they turn sharply
    acc = {}
    for p, kind in zip(me.polygons, kinds):
        if kind[0] == "wall":
            for vi in p.vertices:
                acc.setdefault(vi, []).append(p.index)
    cos_lim = math.cos(math.radians(wall_smooth))
    out = []
    for p, kind in zip(me.polygons, kinds):
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index
            if kind[0] == "skin":
                out.append(skin_n[vi % nflat] * kind[1])
            else:
                n = Vector((0, 0, 0))
                for q in acc[vi]:
                    if pn[q].dot(pn[p.index]) >= cos_lim:
                        n += pn[q]
                out.append(n.normalized() if n.length > 1e-9 else pn[p.index])
    me.normals_split_custom_set(out)


def _boss_profile(r, h=0.9):
    return [(r, 0.0), (r * 0.78, 0.62 * r * h), (0.0, r * h)]


def _domes(name, bosses, mapper, t, segs=10, key="gilt"):
    """Gilt bosses (domes) sitting on the plate's front face, sunk 0.8 mm into it."""
    out = []
    for u, v, r in bosses:
        d = _lathe(name, _boss_profile(r), segs, keys=(key,), cap_bottom=False, smooth_angle=80)
        p = mapper(u, v, t / 2 - 0.0008)
        nrm = mapper(u, v, t / 2 + 0.01) - mapper(u, v, t / 2)
        d.data.transform(_orient(p, nrm))
        out.append(d)
    return out


def _pierced_bay(name, web, outer, t, mapper, eps=0.0010, key="bronze_patina", wall_key="gilt", boss_segs=10,
                 outer_wall=None):
    holes = _trace(web, eps)
    plate = _plate(name + "_plate", [outer] + holes, t, mapper, key=key, outer_wall=outer_wall, wall_key=wall_key)
    return _join([plate] + _domes(name + "_boss", web.bosses, mapper, t, boss_segs), name)


def _band_mapper(R, z0):
    def m(u, v, w):
        th = u / R
        r = R + w
        return Vector((r * math.cos(th), r * math.sin(th), z0 + v))
    return m


def _cone_mapper(ri, zi, ro, zo, r_mid):
    """Soffit dish: v runs from the inner edge (ri, zi) to the outer edge (ro, zo); +w is the
    underside (the face seen from the floor)."""
    L = math.hypot(ro - ri, zo - zi)
    sr, sz = (ro - ri) / L, (zo - zi) / L
    nr, nz = sz, -sr                     # perpendicular to the slant ...
    if nz > 0:                           # ... pointing down
        nr, nz = -nr, -nz

    def m(u, v, w):
        r = ri + sr * v + nr * w
        z = zi + sz * v + nz * w
        th = u / r_mid
        return Vector((r * math.cos(th), r * math.sin(th), z))
    return m, L


# ---------------------------------------------------------------------------
# Rings, lamps, chains (shared by the fixtures)
# ---------------------------------------------------------------------------

def _ring(name, R, pts, segs, keys=("bronze", "gilt"), smooth_angle=38, lobes=None, lobe_w=None):
    """A closed moulding section [(dr, z, mat_index), ...] (counter-clockwise in (r, z)) revolved
    at radius R. Each point's index is the material of the span that starts at it."""
    prof = [(R + dr, z) for dr, z, _ in pts]
    idx = [mi for _, _, mi in pts]
    return _lathe(name, prof, segs, keys=keys, idx=idx, closed=True, smooth_angle=smooth_angle,
                  lobes=lobes, lobe_w=lobe_w)


def _half_round(cx, cz, r, steps, mi=0):
    """Underside of a lamp ring: inner -> bottom -> outer (counter-clockwise)."""
    out = []
    for i in range(steps + 1):
        a = math.pi + math.pi * i / steps
        out.append((cx + r * math.cos(a), cz + r * math.sin(a), mi))
    return out


LAMP_RB = 0.057          # globe radius (114 mm opal globe)
LAMP_ZC = -0.090         # globe centre below the attach point
LAMP_COLLAR = 0.0135     # collar radius at the attach point (buried in the ring's lamp rail)


def _lamp_globe_mesh(name, rb=LAMP_RB, zc=LAMP_ZC, bulb_segs=16, cup_segs=14, petals=7):
    """Pendant globe lamp, attach point (top of the collar) at the origin, hanging down -Z: an opal
    globe held in a cast gilt petal cup whose lobed, rolled lip hugs the glass (the petal tips dip
    lower than the notches), on a short brass neck. The globe's crown inside the cup is not built."""
    angs = (-90, -70, -50, -30, -10, 10, 32)
    bp = [(rb * math.cos(math.radians(a)), zc + rb * math.sin(math.radians(a))) for a in angs]
    bp[0] = (0.0, bp[0][1])
    bulb = _lathe(name + "_Bulb", bp, bulb_segs, keys=("bulb",), cap_top=False, smooth_angle=85)
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")

    def ring_pts(s):
        ph = math.radians(10.0 + 16.0 * s)
        lip = (rb * math.cos(ph), zc + rb * math.sin(ph))
        return [
            (lip[0] - 0.0004, lip[1]),                          # contact (just inside the glass)
            (lip[0] + 0.0030, lip[1] + 0.0022),                 # rolled lip
            (0.0475 + 0.0038 * (1 - s), zc + 0.041 + 0.003 * s),  # petal belly (tips proud)
            (0.0305 + 0.0022 * (1 - s), zc + 0.061),            # shoulder
            (0.0110, -0.0150),                                  # neck
            (LAMP_COLLAR, 0.0),                                 # collar (buried)
        ]
    rings = []
    for i in range(cup_segs):
        a = TAU * i / cup_segs
        s = 0.5 - 0.5 * math.cos(petals * a)
        rings.append([(r, z, a) for r, z in ring_pts(s)])
    nprof = len(rings[0])
    V = [[bm.verts.new((r * math.cos(a), r * math.sin(a), z)) for r, z, a in col] for col in rings]
    size = tex_size("brass")
    for i in range(cup_segs):
        j = (i + 1) % cup_segs
        for k in range(nprof - 1):
            f = bm.faces.new((V[i][k], V[j][k], V[j][k + 1], V[i][k + 1]))
            f.material_index = 0 if k < 4 else 1
            for lp, (ii, kk) in zip(f.loops, ((i, k), (j, k), (j, k + 1), (i, k + 1))):
                lp[uvl].uv = (0.05 * ii / size, 0.02 * kk / size)
    cup = C.mesh_from_bmesh(name + "_Cup", bm, _mats(("gilt", "brass_aged")))
    C.shade_smooth(cup, 48)
    return _join([cup, bulb], name)


def _chain_link_mesh(name, L=0.13, W=0.072, wire=0.0088, n_end=4, sides=4, key="bronze"):
    """One oval link (stadium) in the XZ plane, long axis Z, centred at the origin."""
    a = (W - 2 * wire) / 2
    h = (L - W) / 2
    pts = []
    for i in range(n_end + 1):
        th = math.pi * i / n_end
        pts.append(Vector((a * math.cos(th), 0, h + a * math.sin(th))))
    for i in range(n_end + 1):
        th = math.pi + math.pi * i / n_end
        pts.append(Vector((a * math.cos(th), 0, -h + a * math.sin(th))))
    return _tube(name, pts, wire, sides=sides, key=key, normal=(0, 1, 0), closed=True, smooth_angle=89)


def _chain(name, p0, p1, link_src, L=0.13, wire=0.0088):
    """A run of interlocking links from p0 to p1, joined into one mesh."""
    p0, p1 = Vector(p0), Vector(p1)
    d = p1 - p0
    length = d.length
    pitch = L - 2 * wire * 1.05
    n = max(3, int(round((length - L) / pitch)) + 1)
    if n % 2 == 0:
        n += 1                      # odd: first and last links both turn across their eyes
    pitch = (length - L) / (n - 1)
    axis = d.normalized()
    q = Vector((0, 0, 1)).rotation_difference(axis).to_matrix().to_4x4()
    links = []
    for i in range(n):
        ob = bpy.data.objects.new(f"{name}_l{i}", link_src.data)
        C.link(ob)
        roll = Matrix.Rotation(math.pi / 2 * ((i + 1) % 2), 4, "Z")
        ob.matrix_world = Matrix.Translation(p0 + axis * (L / 2 + i * pitch)) @ q @ roll
        links.append(ob)
    return _join(links, name)


def _flame_finial_mesh(name, s=1.0, key="gilt", segs=12, cap=False):
    prof = [(0.0102 * s, 0.0), (0.0116 * s, 0.006 * s), (0.0062 * s, 0.017 * s), (0.0132 * s, 0.036 * s),
            (0.0108 * s, 0.055 * s), (0.0046 * s, 0.070 * s), (0.0, 0.080 * s)]
    if cap:
        prof = [(0.0, 0.0)] + prof
    return _lathe(name, prof, segs, keys=(key,), smooth_angle=60, cap_bottom=False)


def _flame_bulb(name, h=0.046, r=0.0125, segs=16):
    """Candelabra flame-tip bulb standing on z = 0 (its base sits in the candle sleeve)."""
    prof = [(0.0068, 0.0), (0.0072, 0.006), (r * 0.92, h * 0.25), (r, h * 0.42), (r * 0.82, h * 0.62),
            (r * 0.45, h * 0.84), (r * 0.12, h * 0.97), (0.0, h)]
    return _lathe(name, prof, segs, keys=("bulb",), smooth_angle=80, cap_bottom=False)


def _candle(name, h=0.085, r=0.0105, segs=16):
    """Candle sleeve (ivory, with a drip lip) + flame bulb, standing on z = 0 (base buried in its cup)."""
    prof = [(r, 0.0), (r, h - 0.006), (r + 0.0012, h - 0.003), (r * 0.9, h), (0.0068, h)]
    sleeve = _lathe(name + "_sleeve", prof, segs, keys=("ivory_paint",), smooth_angle=50, cap_bottom=False,
                    cap_top=False)
    bulb = _flame_bulb(name + "_bulb", segs=segs)
    bulb.data.transform(Matrix.Translation((0, 0, h - 0.004)))
    return _join([sleeve, bulb], name)


def _calyx(name, pos, direction, r, length=0.032, flare=2.1, leaves=4, segs=8, key="gilt"):
    """A cast leaf collar (calyx) wrapping a rod at `pos`, opening along `direction`."""
    prof = [(r + 0.0006, -0.004), (r * 1.3 + 0.002, 0.008), (r * flare, length * 0.70), (r * (flare - 0.5), length)]
    ob = _lathe(name, prof, segs, keys=(key,), smooth_angle=60, cap_bottom=False, cap_top=False,
                lobes=(leaves, 0.30, -1, 1), lobe_w=[0.0, 0.4, 1.0, 1.0])
    ob.data.transform(_orient(pos, direction))
    return ob


def _socket(name, pos, direction, r, length=0.034, segs=8, key="gilt"):
    """A turned socket where a rod lands in a ring: `pos` is the rod end, the socket runs back along it."""
    prof = [(r + 0.0006, -length), (r + 0.0045, -length * 0.55), (r + 0.0072, -0.004)]
    ob = _lathe(name, prof, segs, keys=(key,), smooth_angle=50, cap_bottom=False, cap_top=False)
    ob.data.transform(_orient(pos, direction))
    return ob


def _lens_boss(name, eye, r=0.0105, segs=10):
    """A two-sided gilt boss in a volute's eye (scroll plane XZ, axis Y)."""
    ob = _lathe(name, [(0.0, -r), (r * 0.82, -r * 0.62), (r * 0.88, r * 0.30), (0.0, r)],
                segs, keys=("gilt",), smooth_angle=70)
    ob.data.transform(Matrix.Translation((eye.x, 0, eye.y)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    return ob


# ---------------------------------------------------------------------------
# Grand chandelier
# ---------------------------------------------------------------------------

RA, RB, RC = 1.215, 0.88, 0.55                      # band planes / lamp-ring radii
ZA_RING, ZB_RING, ZC_RING = 1.578, 1.105, 0.705      # lamp-ring centres
RH_A, RH_B, RH_C = 0.022, 0.019, 0.018              # lamp-rail half-round radii
ZA_BAND = (1.625, 1.845)
ZB_BAND = (1.1335, 1.2025)
ZC_BAND = (0.726, 0.790)
N_A, N_B, N_C, N_BOWL = 40, 24, 12, 8               # lamps per tier
N_FRIEZE = 32                                       # pierced bays in the crowning frieze
N_SOFFIT = 18                                       # pierced bays in the crowning ring's soffit
N_PICKET = 20
N_ARM_A, N_ARM_B, N_ARM_C, N_SPOKE = 6, 3, 3, 3
BOWL_LAMP_R = 0.365
T_FRIEZE, T_SOFFIT, T_BAND_B = 0.012, 0.008, 0.010
SOF_RO, SOF_ZO = RA - 0.015, 1.600                  # soffit outer edge (buried in the lamp rail)
SOF_RI = RA - 0.300                                 # soffit inner edge (gilt rim bead)
SOF_ZI = SOF_ZO + (SOF_RO - SOF_RI) * math.tan(math.radians(12))


def _lamp_attach_z(z_ring, rh, R, segs):
    """Collar top just inside the lamp rail's half-round (hidden even where the polygonal rail sags
    inward between its vertices), so the cup tucks right under the ring."""
    sag = R * (1.0 - math.cos(math.pi / segs))
    return z_ring - math.sqrt(rh * rh - (LAMP_COLLAR + sag) ** 2) + 0.0006


SEG_A, SEG_B, SEG_C = 64, 40, 36                    # rail segments per tier


def _rails():
    a_bot = _half_round(0.002, ZA_RING, RH_A, 5) + [
        (0.0255, 1.598, 1), (0.0310, 1.6065, 1), (0.0255, 1.615, 0), (0.0120, 1.625, 0), (-0.0200, 1.625, 0),
    ]
    a_top = [
        (-0.016, 1.845, 0), (0.010, 1.845, 1), (0.016, 1.851, 0), (0.026, 1.866, 0), (0.046, 1.878, 0),
        (0.060, 1.881, 0), (0.060, 1.900, 0), (-0.016, 1.900, 0),
    ]
    # gilt bead (astragal) on the crown moulding's top edge
    nose = [(0.052, 1.8795, 1), (0.071, 1.8785, 1), (0.0815, 1.8915, 1), (0.0720, 1.9045, 1), (0.052, 1.9030, 1)]
    b_bot = _half_round(0.0, ZB_RING, RH_B, 5) + [(0.0240, 1.1230, 1), (0.0120, 1.1335, 0), (-0.0170, 1.1335, 0)]
    b_top = [
        (-0.012, 1.2025, 0), (0.010, 1.2025, 1), (0.015, 1.2090, 0), (0.030, 1.2220, 0), (0.044, 1.2300, 1),
        (0.040, 1.2400, 0), (-0.012, 1.2400, 0),
    ]
    c_bot = _half_round(0.0, ZC_RING, RH_C, 5) + [(0.0210, 0.7190, 1), (0.0120, 0.7260, 0), (-0.0170, 0.7260, 0)]
    c_top = [
        (-0.012, 0.7900, 0), (0.009, 0.7900, 1), (0.014, 0.7970, 0), (0.030, 0.8080, 1), (0.026, 0.8180, 0),
        (-0.012, 0.8180, 0),
    ]
    rim = [(-0.010, SOF_ZI - 0.004, 1), (0.004, SOF_ZI - 0.0075, 1), (0.012, SOF_ZI - 0.002, 1),
           (0.006, SOF_ZI + 0.006, 1), (-0.008, SOF_ZI + 0.006, 1)]
    return [
        _ring("railA_bot", RA, a_bot, SEG_A), _ring("railA_top", RA, a_top, SEG_A),
        _ring("railA_nose", RA, nose, SEG_A),
        _ring("railB_bot", RB, b_bot, SEG_B), _ring("railB_top", RB, b_top, SEG_B),
        _ring("railC_bot", RC, c_bot, SEG_C), _ring("railC_top", RC, c_top, SEG_C),
        _ring("soffit_rim", SOF_RI, rim, 40),
    ]


def _frieze_A_mesh(name):
    """One bay of the crowning ring's pierced cast frieze (Ref 1's dark ornate band): a pair of
    mouchettes (curved daggers) leaning into a vesica, gilt bosses on the foot, the head and the
    stile. 12 mm plate, fused 5 mm into both rails."""
    P = TAU * RA / N_FRIEZE
    z0, z1 = ZA_BAND
    H = z1 - z0
    W = _Web(-P / 2, P / 2, -0.006, H + 0.006)
    f = P / 0.2386
    for sx in (1, -1):
        W.cut_stroke([(sx * x * f, y) for x, y in _catmull(
            [(0.046, 0.150), (0.058, 0.118), (0.052, 0.084), (0.030, 0.058)], 4)], 0.036, 0.0045)
    W.cut_stroke([(0, 0.088), (0, 0.130)], 0.003, 0.024)
    W.cut_stroke([(0, 0.130), (0, 0.172)], 0.024, 0.003)
    W.boss((0, 0.040), 0.0105)
    outer = _rect_loop(-P / 2, P / 2, -0.005, H + 0.005, 6)
    return _pierced_bay(name, W, outer, T_FRIEZE, _band_mapper(RA, z0))


def _soffit_A_mesh(name):
    """One bay of the pierced soffit dish under the crowning ring: a swirling mouchette and a
    roundel per bay, so from the floor the ring reads as a dark rose-window band (Ref 1)."""
    mapper, Ls = _cone_mapper(SOF_RI, SOF_ZI, SOF_RO, SOF_ZO, (SOF_RI + SOF_RO) / 2)
    Pm = TAU * (SOF_RI + SOF_RO) / 2 / N_SOFFIT
    W = _Web(-Pm / 2, Pm / 2, -0.004, Ls + 0.010)
    f = Pm / 0.2774
    X = lambda pts: [(x * f, y) for x, y in pts]
    W.cut_stroke(X(_catmull([(0.030, 0.208), (0.000, 0.168), (-0.034, 0.112), (-0.052, 0.050)], 4)), 0.042, 0.004)
    W.cut_disk(X([(0.070, 0.080)])[0], 0.0145)
    W.boss(X([(-0.068, 0.222)])[0], 0.0095)
    outer = _rect_loop(-Pm / 2, Pm / 2, 0.0, Ls + 0.006, 6)
    return _pierced_bay(name, W, outer, T_SOFFIT, mapper)


def _band_B_mesh(name):
    """One repeat of tier B's band: two crossing waves leave a vesica opening (smooth, sampled on a
    0.7 mm grid), with a gilt boss on every crossing."""
    P = TAU * RB / N_B
    z0, z1 = ZB_BAND
    H = z1 - z0
    W = _Web(-P / 2, P / 2, -0.006, H + 0.006)
    yc = H / 2
    xs = [-0.084 + 0.168 * i / 12 for i in range(13)]
    half = [0.5 * 0.036 * math.cos(math.pi * x / 0.168) for x in xs]
    for a, b, wa, wb in zip(xs, xs[1:], half, half[1:]):
        W.cut_stroke([(a, yc), (b, yc)], max(0.003, 2 * wa), max(0.003, 2 * wb))
    W.boss((P / 2, yc), 0.0105)
    outer = _rect_loop(-P / 2, P / 2, -0.0045, H + 0.0045, 6)
    return _pierced_bay(name, W, outer, T_BAND_B, _band_mapper(RB, z0))


def _picket_C_mesh(name):
    z0, z1 = ZC_BAND
    prof = [(0.0044, z0 - 0.002), (0.0031, z0 + 0.011), (0.0060, z0 + 0.032), (0.0031, z0 + 0.053),
            (0.0044, z1 + 0.002)]
    ob = _lathe(name, prof, 10, keys=("gilt",), smooth_angle=55, cap_bottom=False, cap_top=False)
    ob.data.transform(Matrix.Translation((RC, 0, 0)))
    return ob


def _stem():
    G = (0.626, 0.692), (0.946, 1.008), (1.328, 1.410), (1.944, 1.984), (2.136, 2.168)
    prof = [
        (0.034, 0.590),
        (0.050, 0.628), (0.064, 0.645), (0.060, 0.676), (0.030, 0.700),                       # collar C
        (0.030, 0.716), (0.050, 0.760), (0.057, 0.810), (0.048, 0.872), (0.029, 0.928),       # fluted vase
        (0.048, 0.948), (0.068, 0.968), (0.066, 0.996), (0.030, 1.020),                       # collar B
        (0.030, 1.040), (0.056, 1.110), (0.082, 1.190), (0.082, 1.246), (0.060, 1.290), (0.040, 1.314),  # baluster
        (0.054, 1.330), (0.082, 1.350), (0.082, 1.384), (0.054, 1.406), (0.034, 1.418),       # collar A
        (0.046, 1.466), (0.058, 1.524), (0.046, 1.590), (0.028, 1.636),                       # knop
        (0.028, 1.900),                                                                       # rod
        (0.052, 1.916), (0.104, 1.948), (0.110, 1.964), (0.100, 1.979), (0.044, 1.994),       # crown dish
        (0.058, 2.034), (0.064, 2.078), (0.050, 2.118), (0.030, 2.138),                       # urn
        (0.032, 2.152), (0.0, 2.167),
    ]
    idx = []
    for (r, z), (r2, z2) in zip(prof, prof[1:]):
        zm = (z + z2) / 2
        idx.append(1 if any(a <= zm <= b for a, b in G) else 0)
    stem = _lathe("stem", prof, 36, keys=("brass_aged", "gilt"), idx=idx, smooth_angle=42,
                  lobes=(6, 0.13, 0.730, 0.915), cap_bottom=False)
    loop = C.torus("stem_loop", 0.020, 0.0062, (0, 0, BODY_H - 0.0262), mat("brass_aged"), 20, 8, rot=C.rotx(90))
    return [stem, loop]


def _bowl_and_finial():
    bowl = [
        (0.036, 0.300), (0.062, 0.312), (0.110, 0.338), (0.165, 0.380), (0.215, 0.430), (0.255, 0.482),
        (0.285, 0.528), (0.310, 0.556), (0.345, 0.570), (0.385, 0.578), (0.400, 0.588), (0.402, 0.600),
        (0.392, 0.610), (0.360, 0.612), (0.200, 0.604), (0.090, 0.596), (0.034, 0.594),
    ]
    idx = [0] * (len(bowl) - 1)
    for i in (9, 10, 11):
        idx[i] = 1
    b = _lathe("bowl", bowl, 48, keys=("brass_aged", "gilt"), idx=idx, smooth_angle=48,
               lobes=(12, 0.16, 0.305, 0.560), cap_bottom=False, cap_top=False)
    fin = [
        (0.0, 0.0), (0.012, 0.010), (0.030, 0.034), (0.048, 0.068), (0.058, 0.104), (0.052, 0.136),
        (0.034, 0.156), (0.026, 0.164), (0.044, 0.176), (0.044, 0.188), (0.024, 0.200), (0.036, 0.226),
        (0.042, 0.250), (0.026, 0.280), (0.034, 0.293), (0.040, 0.306),
    ]
    idx = [1] * 6 + [0] * 4 + [1] * 3 + [0] * 2
    f = _lathe("finial", fin, 32, keys=("bronze", "gilt"), idx=idx, smooth_angle=45,
               lobes=(8, 0.13, 0.008, 0.150), cap_top=False)
    return [b, f]


def _crown_ring():
    R = 0.30
    sec = [(-0.012, 2.006, 0), (0.000, 2.000, 0), (0.012, 2.006, 0), (0.012, 2.017, 0), (0.005, 2.026, 1),
           (-0.005, 2.026, 1), (-0.012, 2.017, 0)]
    return _ring("crown_ring", R, sec, 40, keys=("brass_aged", "gilt"))


def _arm_mesh(name, p_stem, ctrl, p_ring, r0, r1, sides=10, n=3, scroll=None, sc_w=0.0078, n_sp=24, sc_n=6,
              calyx_at=0.024, key="bronze"):
    """A tapered cast arm in the radial plane (azimuth 0) from a stem collar to a ring: a gilt leaf
    calyx where it leaves the collar, a turned gilt socket where it lands, and an optional
    under-scroll ((start, end, bulge, r_curl) in (rho, z)) ending in a gilt boss."""
    pts2 = _catmull([p_stem] + ctrl + [p_ring], n)
    pts3 = _plane_pts(pts2)
    rad = lambda t: r0 + (r1 - r0) * t
    arm = _tube(name + "_main", pts3, rad, sides=sides, key=key, normal=(0, 1, 0), aspect=0.88, smooth_angle=60,
                caps=False)
    parts = [arm]
    # calyx at the collar surface
    L = 0.0
    for a, b in zip(pts3, pts3[1:]):
        L += (b - a).length
        if L >= calyx_at:
            parts.append(_calyx(name + "_calyx", a, b - a, r0 * 0.98))
            break
    parts.append(_socket(name + "_socket", pts3[-1], pts3[-1] - pts3[-2], r1))
    if scroll:
        st, en, bulge, rc = scroll
        sc = _c_scroll(st, en, bulge, rc, turns=1.1, shrink=0.28, n=sc_n, n_sp=n_sp, curl_dir=-1)
        parts.append(_tube(name + "_scroll", _plane_pts(sc), lambda t: sc_w * (1 - 0.42 * t), key=key,
                           normal=(0, 1, 0), aspect=1.25, section="rect", smooth_angle=60, caps=(False, False)))
        parts.append(_lens_boss(name + "_eye", sc[-1], rc * 0.28 + 0.0022))
    return _join(parts, name)


def _spoke_mesh(name):
    """A crown bracket: a tapering C-scroll from the crown dish out to the crowning ring, with a gilt
    leaf at the dish, an under-scroll ending in a boss and a socket on the ring."""
    p = [(0.098, 1.972), (0.20, 1.987), (0.30, 1.989), (0.60, 1.978), (0.93, 1.946), (RA - 0.010, 1.902)]
    return _arm_mesh(name, p[0], p[1:-1], p[-1], 0.0110, 0.0078, sides=10, n=2,
                     scroll=((0.094, 1.955), (0.46, 1.962), -0.052, 0.026), sc_w=0.0068, n_sp=22, sc_n=7,
                     calyx_at=0.012)


def build_chandelier_grand(drop=4.0, name="Light_Chandelier_Grand", n_chains=3):
    """The main hall's tiered ring chandelier (Ref 1), 2.6 m across. The body's lowest point (the
    finial tip) is at z = 0 and its top (the crown loop) at z = BODY_H (2.2 m); the ceiling canopy's
    top face is at z = BODY_H + drop. Returns the root object; every part is parented to it."""
    parts = _rails() + _stem() + _bowl_and_finial() + [_crown_ring()]
    # chain lugs on the crowning ring
    lug = C.torus("lug", 0.022, 0.0072, (RA - 0.004, 0, 1.900 + 0.027), mat("brass_aged"), 12, 6, rot=C.rotx(90))
    lug_b = _lathe("lug_b", [(0.021, 1.898), (0.023, 1.904), (0.012, 1.912), (0.0, 1.913)], 10,
                   keys=("brass_aged",), smooth_angle=50, cap_bottom=False)
    lug_b.data.transform(Matrix.Translation((RA - 0.004, 0, 0)))
    lug_m = _join([lug, lug_b], "lug_one")
    for k in range(n_chains):
        o = bpy.data.objects.new("lug_k", lug_m.data)
        C.link(o)
        o.matrix_world = Matrix.Rotation(TAU * k / n_chains + math.pi / 2, 4, "Z")
        parts.append(o)
    C.remove(lug_m)
    root = _join(parts, name)

    # lamps: crowning ring (40), tier B (24), tier C (12), bowl (8)
    lamp_me = _hide_template(_lamp_globe_mesh(name + "_Lamp"))
    pl = []
    bowl_z = 0.578
    for n_l, R, z, off in ((N_A, RA + 0.002, _lamp_attach_z(ZA_RING, RH_A, RA, SEG_A), 0.5),
                           (N_B, RB, _lamp_attach_z(ZB_RING, RH_B, RB, SEG_B), 0.5),
                           (N_C, RC, _lamp_attach_z(ZC_RING, RH_C, RC, SEG_C), 0.5),
                           (N_BOWL, BOWL_LAMP_R, bowl_z, 0.0)):
        for i in range(n_l):
            a = TAU * (i + off) / n_l
            pl.append((Vector((R * math.cos(a), R * math.sin(a), z)), a))
    _instances(lamp_me, name + "_Lamp", pl, root)

    # pierced bands: crowning frieze, its soffit, tier B's vesica band, tier C's gallery
    _ring_of(_hide_template(_frieze_A_mesh(name + "_FriezeA")), name + "_FriezeA", N_FRIEZE, root)
    _ring_of(_hide_template(_soffit_A_mesh(name + "_SoffitA")), name + "_SoffitA", N_SOFFIT, root, 0.5)
    _ring_of(_hide_template(_band_B_mesh(name + "_BandB")), name + "_BandB", N_B, root)
    _ring_of(_hide_template(_picket_C_mesh(name + "_PicketC")), name + "_PicketC", N_PICKET, root, 0.25)

    # cast arms from the stem collars to each ring, and the crown brackets
    armA = _arm_mesh(name + "_ArmA", (0.080, 1.366), [(0.26, 1.346), (0.56, 1.376), (0.90, 1.462)],
                     (RA - 0.018, 1.572), 0.0165, 0.0110, sides=12, n=3,
                     scroll=((0.070, 1.352), (0.50, 1.354), -0.085, 0.040), sc_w=0.0080, n_sp=24)
    _ring_of(_hide_template(armA), name + "_ArmA", N_ARM_A, root)
    armB = _arm_mesh(name + "_ArmB", (0.066, 0.980), [(0.24, 0.966), (0.50, 0.996), (0.72, 1.056)],
                     (RB - 0.016, 1.100), 0.0135, 0.0092, sides=10, n=3,
                     scroll=((0.058, 0.969), (0.40, 0.972), -0.062, 0.032), sc_w=0.0070, n_sp=24)
    _ring_of(_hide_template(armB), name + "_ArmB", N_ARM_B, root, 0.125)
    armC = _arm_mesh(name + "_ArmC", (0.062, 0.657), [(0.20, 0.648), (0.40, 0.668)], (RC - 0.015, 0.700),
                     0.0100, 0.0072, sides=10, n=3,
                     scroll=((0.055, 0.646), (0.30, 0.658), -0.020, 0.020), sc_w=0.0060, n_sp=24, sc_n=6)
    _ring_of(_hide_template(armC), name + "_ArmC", N_ARM_C, root, 0.25)
    _ring_of(_hide_template(_spoke_mesh(name + "_Spoke")), name + "_Spoke", N_SPOKE, root, 0.25)
    fl = _flame_finial_mesh(name + "_CrownFlame", 1.0)
    fl.data.transform(Matrix.Translation((0.30, 0, 2.018)))
    _ring_of(_hide_template(fl), name + "_CrownFlame", 6, root, 0.0)

    # ceiling canopy, chains
    z_top = BODY_H + drop
    can = [
        (0.0, z_top - 0.330), (0.030, z_top - 0.326), (0.040, z_top - 0.306),
        (0.120, z_top - 0.300), (0.128, z_top - 0.290), (0.120, z_top - 0.282), (0.042, z_top - 0.270),
        (0.036, z_top - 0.226), (0.070, z_top - 0.196), (0.150, z_top - 0.150), (0.215, z_top - 0.098),
        (0.262, z_top - 0.046), (0.300, z_top - 0.020), (0.300, z_top),
    ]
    idx = [0] * (len(can) - 1)
    for i in (2, 3, 4, 5, 11, 12):
        idx[i] = 1
    canopy = _lathe(name + "_Canopy", can, 24, keys=("bronze", "gilt"), idx=idx, smooth_angle=42,
                    lobes=(8, 0.09, z_top - 0.19, z_top - 0.05))
    eyes = []
    for k in range(n_chains):
        a = TAU * k / n_chains + math.pi / 2
        e = C.torus("ceye", 0.016, 0.0055, (0, 0, 0), mat("brass_aged"), 12, 6, rot=C.rotx(90))
        e.data.transform(Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0.105, 0, z_top - 0.318)))
        eyes.append(e)
    canopy = _join([canopy] + eyes, name + "_Canopy")
    _parent([canopy], root)
    link = _chain_link_mesh(name + "_ChainLink", L=0.40, W=0.105, wire=0.0100, n_end=3, sides=6)
    chain = _chain(name + "_Chain", (RA - 0.004, 0, 1.917), (0.105, 0, z_top - 0.323), link, L=0.40, wire=0.0100)
    C.remove(link)
    _instances(_hide_template(chain), name + "_Chain",
               [((0, 0, 0), TAU * k / n_chains + math.pi / 2) for k in range(n_chains)], root)
    root["ovr_body_height"] = BODY_H
    root["ovr_drop"] = drop
    return root


# ---------------------------------------------------------------------------
# Wall sconce
# ---------------------------------------------------------------------------

def _shade_pleated(name, r_top=0.030, r_bot=0.058, h=0.085, pleats=36, depth=0.0025):
    """Small knife-pleated silk candle shade with brass trim rings, base at z = 0, top at h. Each pleat
    is a true sawtooth (outer fold, long face, inner fold, short return), 3 verts per pleat, on both
    the outer and inner skin, so the folds stay crisp."""
    t = 0.0012
    rows = [(0.0, r_bot), (0.40 * h, r_bot * 0.905 + (r_top - r_bot) * 0.0), (0.92 * h, r_top * 1.07), (h, r_top)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    n = pleats * 3
    ang, dep = [], []
    for k in range(pleats):
        for frac, d in ((0.0, 1.0), (0.55, 0.45), (0.90, 0.0)):
            ang.append(TAU * (k + frac) / pleats)
            dep.append(d)
    outer = [[bm.verts.new(((r + depth * dep[i]) * math.cos(ang[i]), (r + depth * dep[i]) * math.sin(ang[i]), z))
              for i in range(n)] for z, r in rows]
    inner = [[bm.verts.new(((r - t + depth * dep[i]) * math.cos(ang[i]), (r - t + depth * dep[i]) * math.sin(ang[i]),
                            z + (0.0012 if z == 0 else (-0.0012 if z == h else 0))))
              for i in range(n)] for z, r in rows]
    rings = outer + list(reversed(inner))             # closed section: out-bottom .. out-top, in-top .. in-bottom
    size = tex_size("silk_shade")
    for a in range(len(rings)):
        A, B = rings[a], rings[(a + 1) % len(rings)]
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            for lp, (ii, aa) in zip(f.loops, ((i, a), (j, a), (j, a + 1), (i, a + 1))):
                lp[uvl].uv = (TAU * r_bot * ii / n / size, 0.03 * aa / size)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    shade = C.mesh_from_bmesh(name + "_silk", bm, mat("silk_shade"))
    C.shade_smooth(shade, 30)
    trims = [_ring(name + "_trimB", r_bot + depth, [(-0.0044, -0.0004, 0), (0.0016, -0.0004, 0), (0.0021, 0.0016, 0),
                                                    (0.0016, 0.0034, 0), (-0.0042, 0.0034, 0)], 54, keys=("brass",)),
             _ring(name + "_trimT", r_top + depth, [(-0.0040, h - 0.0030, 0), (0.0014, h - 0.0030, 0),
                                                    (0.0019, h - 0.0012, 0), (0.0014, h + 0.0006, 0),
                                                    (-0.0040, h + 0.0006, 0)], 36, keys=("brass",))]
    # wire carrier: three spokes from the top ring down to the clip that rides on the bulb tip
    for k in range(3):
        a = TAU * k / 3
        p0 = Vector(((r_top - 0.001) * math.cos(a), (r_top - 0.001) * math.sin(a), h - 0.001))
        p1 = Vector((0.004 * math.cos(a), 0.004 * math.sin(a), h - 0.016))
        trims.append(_tube(name + "_wire", [p0, p1], 0.0010, sides=6, key="brass", smooth_angle=80))
    clip = _lathe(name + "_clip", [(0.0, h - 0.020), (0.0050, h - 0.019), (0.0056, h - 0.015), (0.0040, h - 0.012),
                                   (0.0, h - 0.0115)], 12, keys=("brass",), smooth_angle=60)
    return _join([shade] + trims + [clip], name)


def _oval_plate(name, a=0.068, b=0.160, segs=80):
    """Moulded oval cartouche backplate in the wall plane: each profile step is an ellipse with BOTH
    semi-axes inset by the same amount (not a scaled disc), so the moulding keeps its width all the
    way round. Back face on y = 0, front toward -Y."""
    prof = [(0.000, 0.000), (0.000, 0.0040), (0.0018, 0.0085), (0.0048, 0.0105), (0.0080, 0.0090),
            (0.0098, 0.0066), (0.0140, 0.0060), (0.0300, 0.0062), (0.0360, 0.0080), (0.0410, 0.0130),
            (0.0470, 0.0170), (0.0560, 0.0190), (0.0620, 0.0195)]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    rings = []
    for d, hgt in prof:
        rings.append([bm.verts.new(((a - d) * math.cos(TAU * i / segs), -hgt, (b - d) * math.sin(TAU * i / segs)))
                      for i in range(segs)])
    size = tex_size("brass_aged")
    for A, B in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs
            f = bm.faces.new((A[i], A[j], B[j], B[i]))
            for lp in f.loops:
                lp[uvl].uv = (lp.vert.co.x / size, lp.vert.co.z / size)
    caps = [bm.faces.new(list(reversed(rings[-1]))), bm.faces.new(rings[0])]   # front field + back (wall side)
    for f in caps:
        for lp in f.loops:
            lp[uvl].uv = (lp.vert.co.x / size, lp.vert.co.z / size)
    bmesh.ops.triangulate(bm, faces=caps)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = C.mesh_from_bmesh(name, bm, mat("brass_aged"))
    C.shade_smooth(ob, 40)
    return ob


def build_sconce_wall(name="Light_Sconce_Wall"):
    """Two-arm cast brass candle sconce with pleated silk shades. The backplate's back face is on
    the wall plane y = 0 (room toward -Y); z = 0 is the centre of the backplate."""
    parts = [_oval_plate("plate")]
    # central body: turned, reeded baluster standing proud of the plate
    yb = -0.072
    body = [
        (0.0, -0.150), (0.004, -0.147), (0.010, -0.138), (0.016, -0.124), (0.019, -0.110), (0.017, -0.098),
        (0.012, -0.090), (0.019, -0.084), (0.022, -0.078), (0.019, -0.072), (0.012, -0.066), (0.014, -0.058),
        (0.026, -0.046), (0.030, -0.036), (0.030, -0.010), (0.026, -0.002), (0.014, 0.006), (0.010, 0.016),
        (0.016, 0.030), (0.021, 0.048), (0.019, 0.064), (0.011, 0.074), (0.014, 0.080), (0.014, 0.086),
        (0.006, 0.090), (0.0, 0.091),
    ]
    idx = [1] * 7 + [0] * 4 + [0] * 3 + [1] * 2 + [0] * 3 + [0] * 3 + [1] * 3
    bo = _lathe("body", body, 48, keys=("brass", "gilt"), idx=idx[:len(body) - 1], smooth_angle=45,
                lobes=(8, 0.085, 0.010, 0.070))
    bo.data.transform(Matrix.Translation((0, yb, 0)))
    parts.append(bo)
    fin = _flame_finial_mesh("sc_flame", 0.9, key="gilt", segs=16)
    fin.data.transform(Matrix.Translation((0, yb, 0.0855)))
    parts.append(fin)
    # horizontal neck from the plate boss into the body
    neck = _lathe("neck", [(0.016, 0.017), (0.016, 0.022), (0.011, 0.028), (0.010, 0.050),
                           (0.0135, 0.054), (0.0, 0.056)], 24, keys=("brass",), smooth_angle=50, cap_bottom=False)
    neck.data.transform(Matrix.Translation((0, 0, -0.022)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
    parts.append(neck)
    # two arms (mirrored), each a cast S-scroll with an under-volute, ending in a candle cup
    hub = Vector((0.0, yb, -0.022))
    for side in (1, -1):
        cup = Vector((side * 0.205, -0.140, 0.040))
        d = Vector((cup.x - hub.x, cup.y - hub.y, 0))
        dist = d.length
        d.normalize()
        Z = Vector((0, 0, 1))

        def P3(s, z, d=d):
            return hub + d * s + Z * z
        s_pts = _catmull([(0.012, 0.0), (0.060, -0.036), (0.120, -0.056), (0.172, -0.030), (dist - 0.006, 0.022),
                          (dist, cup.z - hub.z - 0.004)], 4)
        pn = d.cross(Z)
        arm = _tube("arm", [P3(p.x, p.y) for p in s_pts], lambda t: 0.0092 - 0.0030 * t, sides=12, key="brass",
                    normal=pn, aspect=0.85, smooth_angle=60, caps=False)
        parts.append(arm)
        sc = _c_scroll((0.030, -0.030), (0.112, -0.056), -0.030, 0.020, turns=1.1, shrink=0.3, n=10, n_sp=24, curl_dir=-1)
        parts.append(_tube("ascroll", [P3(p.x, p.y) for p in sc], lambda t: 0.0050 * (1 - 0.4 * t), key="brass",
                           normal=pn, aspect=1.2, section="rect", smooth_angle=60, caps=(False, False)))
        eye = P3(sc[-1].x, sc[-1].y)
        parts.append(C.sphere("aeye", 0.0062, eye, mat("gilt"), 16, 10))
        # leaf collar where the arm leaves the body
        q_dir = (P3(s_pts[2].x, s_pts[2].y) - P3(s_pts[0].x, s_pts[0].y))
        parts.append(_calyx("acollar", P3(s_pts[1].x, s_pts[1].y) - q_dir.normalized() * 0.006, q_dir, 0.0090,
                            length=0.020, flare=1.75, leaves=6, segs=24))
        # bobeche (drip pan), candle cup, candle, shade
        bob = _lathe("bobeche", [(0.0, 0.0), (0.010, -0.004), (0.020, -0.006), (0.034, -0.002), (0.040, 0.004),
                                 (0.041, 0.008), (0.036, 0.008), (0.030, 0.004), (0.016, 0.004), (0.0, 0.004)], 32,
                     keys=("brass",), smooth_angle=50)
        cupm = _lathe("ccup", [(0.011, 0.004), (0.010, 0.010), (0.015, 0.020), (0.0165, 0.030),
                               (0.0150, 0.033), (0.0118, 0.033), (0.0118, 0.026), (0.0, 0.026)], 32,
                      keys=("gilt",), smooth_angle=50, cap_bottom=False)
        cand = _candle("candle", h=0.075, r=0.0105, segs=16)
        cand.data.transform(Matrix.Translation((0, 0, 0.026)))
        shade = _shade_pleated("shade")
        shade.data.transform(Matrix.Translation((0, 0, 0.070)))
        for o in (bob, cupm, cand, shade):
            o.data.transform(Matrix.Translation(cup))
            parts.append(o)
    root = _join(parts, name)
    return root


# ---------------------------------------------------------------------------
# Hexagonal hall lantern
# ---------------------------------------------------------------------------

LR = 0.40                      # corner radius of the glazed body (0.80 m across corners)
LZ_GLASS = (0.405, 1.155)
L_CORNICE_TOP = 1.236          # top face of the hexagonal cornice
L_CREST_AP = 0.3870            # crest plane (apothem), standing on the cornice's outer fillet


def _hex_lathe(name, prof, keys, idx=None, closed=False):
    """Hexagonal 'lathe' (6 flat faces, corners on +X etc.) - flat faces, crisp corners."""
    return _lathe(name, prof, 6, keys=keys, idx=idx, closed=closed, smooth_angle=35)


def _lantern_crest(ap):
    """Cresting for one face: a pair of C-scrolls and a gilt bud standing ON the cornice top at the
    apothem `ap` (outboard of the roof, which starts at apothem 0.381), with small gilt feet."""
    parts = []
    sc0 = _c_scroll((0.010, 0.006), (0.105, 0.036), 0.040, 0.022, turns=1.05, shrink=0.3, n=16, n_sp=24, curl_dir=-1)
    zmin = min(p.y for p in sc0) - 0.0045
    lift = L_CORNICE_TOP - 0.0005 - zmin
    for sx in (-1, 1):
        sc = [Vector((sx * p.x, p.y + lift)) for p in sc0]
        parts.append(_tube("crest", [(p.x, ap, p.y) for p in sc], lambda t: 0.0045 * (1 - 0.35 * t), key="brass",
                           normal=(0, 1, 0), aspect=1.4, section="rect", smooth_angle=60, caps=(True, False)))
        e = sc[-1]
        parts.append(C.sphere("ceye", 0.0058, (e.x, ap, e.y), mat("gilt"), 16, 10))
        low = min(sc, key=lambda p: p.y)
        foot = _lathe("cfoot", [(0.0, L_CORNICE_TOP + 0.0042), (0.0060, L_CORNICE_TOP + 0.0036),
                                (0.0085, L_CORNICE_TOP + 0.0012), (0.0085, L_CORNICE_TOP - 0.0004)], 16,
                      keys=("gilt",), smooth_angle=60, cap_bottom=False)
        foot.data.transform(Matrix.Translation((low.x, ap, 0)))
        parts.append(foot)
    bud = _flame_finial_mesh("cbud", 1.05, key="gilt", segs=16)
    bud.data.transform(Matrix.Translation((0, ap, L_CORNICE_TOP - 0.0005)))
    parts.append(bud)
    return parts


def _lantern_face_mesh(name):
    """One glazed face (centred on azimuth -90 deg, i.e. the front, -Y): glass pane, arched glazing
    frame with pierced spandrels, a bottom glazing bar and the cornice cresting. Instanced six times."""
    ap = LR * math.cos(math.pi / 6)            # apothem
    side = LR                                  # side length of a regular hexagon
    w = side - 0.036                           # clear width between posts
    z0, z1 = LZ_GLASS
    parts = []
    gw, gz0, gz1, gy = (w + 0.024) / 2, z0 - 0.005, z1 + 0.005, ap - 0.013
    gme = bpy.data.meshes.new("pane")
    gme.from_pydata([(-gw, gy, gz0), (gw, gy, gz0), (gw, gy, gz1), (-gw, gy, gz1)], [], [(0, 1, 2, 3)])
    glass = bpy.data.objects.new("pane", gme)
    C.link(glass)
    gme.materials.append(mat("glass_window"))
    C.uv_box(glass, 1.0)
    parts.append(glass)
    # arch: springing at zs, semicircular head
    zs = z1 - 0.030 - w / 2
    arch = C.arch_points(w - 0.010, zs, 28)
    frame_prof = [(-0.006, 0.0), (0.006, 0.0), (0.006, 0.004), (0.004, 0.007), (-0.004, 0.007), (-0.006, 0.004),
                  (-0.006, 0.0)]
    pts = [(x, ap - 0.0085, z) for x, z in arch]
    pts = [(pts[0][0], ap - 0.0085, z0 + 0.015)] + pts + [(pts[-1][0], ap - 0.0085, z0 + 0.015)]
    fr = C.sweep("archframe", frame_prof, pts, mat("brass"), up=(0, 1, 0), smooth_angle=50)
    _weld(fr)
    parts.append(fr)
    # spandrel plates above the arch (brass sheet, 3 mm)
    outline = [(-w / 2 - 0.004, z1 + 0.004), (-w / 2 - 0.004, zs)]
    outline += [(x, z) for x, z in C.arch_points(w - 0.010 + 0.008, zs, 28)]
    outline += [(w / 2 + 0.004, zs), (w / 2 + 0.004, z1 + 0.004)]
    bm = bmesh.new()
    front = [bm.verts.new((x, ap - 0.0105, z)) for x, z in outline]
    back = [bm.verts.new((x, ap - 0.0075, z)) for x, z in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    sp = C.mesh_from_bmesh("spandrel", bm, mat("brass_aged"))
    C.shade_smooth(sp, 30)
    C.uv_box(sp, tex_size("brass_aged"))
    parts.append(sp)
    # spandrel ornament: a gilt rosette in each spandrel
    for sx in (-1, 1):
        ro = _lathe("ros", [(0.0, -0.002), (0.012, -0.002), (0.013, 0.002), (0.009, 0.006), (0.004, 0.008), (0.0, 0.0085)],
                    24, keys=("gilt",), smooth_angle=60, lobes=(8, 0.25, -0.001, 0.0075))
        ro.data.transform(Matrix.Translation((sx * (w / 2 - 0.030), ap - 0.0078, z1 - 0.034)) @ Matrix.Rotation(-math.pi / 2, 4, "X"))
        parts.append(ro)
    # bottom glazing bar
    parts.append(_box("gbar", (w + 0.006, 0.012, 0.014), (0, ap - 0.010, z0 + 0.008), "brass", bevel_w=0.002))
    # cresting on the cornice
    parts += _lantern_crest(L_CREST_AP)
    return _join(parts, name)


def _lantern_post_mesh(name):
    z0, z1 = LZ_GLASS
    prof = [(0.0, z0 - 0.004), (0.020, z0 - 0.004), (0.020, z0 + 0.006), (0.015, z0 + 0.012), (0.012, z0 + 0.030),
            (0.0105, z0 + 0.25), (0.0115, z0 + 0.36), (0.0150, z0 + 0.372), (0.0150, z0 + 0.384), (0.0115, z0 + 0.396),
            (0.0105, z1 - 0.050), (0.0130, z1 - 0.030), (0.0170, z1 - 0.014), (0.0200, z1 - 0.006), (0.0200, z1 + 0.004),
            (0.0, z1 + 0.004)]
    idx = [0] * (len(prof) - 1)
    for i in (6, 7, 8):
        idx[i] = 1
    ob = _lathe(name, prof, 16, keys=("brass", "gilt"), idx=idx, smooth_angle=45)
    ob.data.transform(Matrix.Translation((LR - 0.004, 0, 0)))
    return ob


def build_lantern_pendant(drop=1.2, name="Light_Lantern_Hall"):
    """Large hexagonal brass-and-glass hall lantern (entrance lobby). The lantern's lowest point (the
    finial tip) is at z = 0, its top loop at z = LANTERN_H (1.66 m) and the ceiling rose's top at
    z = LANTERN_H + drop. Returns the root object; parts are parented to it."""
    parts = []
    # pendant finial under the base
    fin = [(0.0, 0.0), (0.006, 0.006), (0.016, 0.022), (0.028, 0.046), (0.036, 0.070), (0.036, 0.090), (0.028, 0.106),
           (0.018, 0.114), (0.024, 0.120), (0.032, 0.126), (0.032, 0.134), (0.022, 0.140), (0.018, 0.150),
           (0.026, 0.162), (0.0, 0.162)]
    parts.append(_lathe("lfin", fin, 32, keys=("gilt", "brass"), idx=[0] * 7 + [1] * 7, smooth_angle=45,
                        lobes=(8, 0.14, 0.008, 0.104)))
    # hexagonal tapered base pan + bottom frame moulding
    base = [(0.0, 0.158), (0.060, 0.158), (0.080, 0.170), (0.150, 0.215), (0.250, 0.272), (0.330, 0.318),
            (0.380, 0.344), (0.408, 0.352), (0.416, 0.362), (0.416, 0.374), (0.404, 0.380), (0.404, 0.392),
            (0.418, 0.396), (0.418, 0.405), (0.0, 0.405)]
    idx = [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 0]
    parts.append(_hex_lathe("lbase", base, ("brass_aged", "gilt"), idx))
    # top frame / cornice moulding
    top = [(0.0, 1.150), (0.410, 1.150), (0.418, 1.156), (0.418, 1.168), (0.430, 1.176), (0.448, 1.190),
           (0.458, 1.204), (0.462, 1.216), (0.462, 1.228), (0.452, L_CORNICE_TOP), (0.0, L_CORNICE_TOP)]
    parts.append(_hex_lathe("ltop", top, ("brass_aged", "gilt"), [0, 1, 1, 0, 0, 0, 0, 1, 1, 0]))
    # ogee roof, hexagonal, with a collar, ball and loop on top
    roof = [(0.440, L_CORNICE_TOP), (0.430, 1.248), (0.400, 1.262), (0.330, 1.300), (0.250, 1.340), (0.180, 1.384),
            (0.130, 1.428), (0.100, 1.466), (0.085, 1.498), (0.080, 1.520), (0.066, 1.528), (0.0, 1.528)]
    parts.append(_lathe("lroof", roof, 6, keys=("brass_aged",), cap_bottom=False, smooth_angle=35))
    top_turn = [(0.0, 1.526), (0.050, 1.526), (0.052, 1.534), (0.040, 1.542), (0.030, 1.550), (0.038, 1.566),
                (0.046, 1.584), (0.044, 1.600), (0.034, 1.612), (0.018, 1.620), (0.016, 1.630), (0.0, 1.632)]
    parts.append(_lathe("ltopturn", top_turn, 32, keys=("gilt", "brass"), idx=[1, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
                        smooth_angle=45))
    parts.append(C.torus("lloop", 0.020, 0.0062, (0, 0, LANTERN_H - 0.0262), mat("brass"), 24, 8, rot=C.rotx(90)))
    # candle cluster inside: a turned stem, a six-arm ring and seven candles at mid-height
    zr = 0.690
    st = [(0.0, 0.400), (0.045, 0.400), (0.045, 0.410), (0.022, 0.424), (0.015, 0.450), (0.015, zr - 0.090),
          (0.026, zr - 0.068), (0.032, zr - 0.036), (0.027, zr - 0.014), (0.036, zr - 0.004), (0.036, zr + 0.008),
          (0.0, zr + 0.012)]
    parts.append(_lathe("lstem", st, 24, keys=("brass", "gilt"), idx=[0] * 6 + [1] * 5, smooth_angle=45,
                        lobes=(8, 0.15, zr - 0.07, zr - 0.012)))
    rr = 0.165
    parts.append(C.torus("lring", rr, 0.0070, (0, 0, zr), mat("brass"), 48, 8))
    for k in range(6):
        a = TAU * k / 6 + math.pi / 6
        p0 = Vector((0.030 * math.cos(a), 0.030 * math.sin(a), zr + 0.002))
        p1 = Vector((rr * math.cos(a), rr * math.sin(a), zr))
        parts.append(_tube("lspoke", _catmull([p0, (p0 + p1) / 2 + Vector((0, 0, -0.016)), p1], 4), 0.0052, sides=8,
                           key="brass", caps=False))
    cand_src = _candle("lcand", h=0.13, r=0.0125, segs=16)
    cup_src = _lathe("lccup", [(0.0, 0.0), (0.013, 0.0), (0.012, 0.007), (0.019, 0.018), (0.020, 0.027),
                               (0.0150, 0.029), (0.0, 0.029)], 20, keys=("gilt",), smooth_angle=50)
    for k in range(7):
        if k < 6:
            a = TAU * k / 6 + math.pi / 6
            loc = Vector((rr * math.cos(a), rr * math.sin(a), zr + 0.005))
        else:
            loc = Vector((0, 0, zr + 0.010))
        cu = bpy.data.objects.new("lc", cup_src.data)
        C.link(cu)
        cu.location = loc
        if k == 6:
            ca = _candle("lca_tall", h=0.19, r=0.0135, segs=16)
        else:
            ca = bpy.data.objects.new("lca", cand_src.data)
            C.link(ca)
        ca.location = loc + Vector((0, 0, 0.024))
        parts += [cu, ca]
    C.remove(cand_src)
    C.remove(cup_src)
    root = _join(parts, name)
    face_me = _hide_template(_lantern_face_mesh(name + "_Face"))
    _instances(face_me, name + "_Face", [((0, 0, 0), TAU * k / 6) for k in range(6)], root)
    post_me = _hide_template(_lantern_post_mesh(name + "_Post"))
    _instances(post_me, name + "_Post", [((0, 0, 0), TAU * k / 6) for k in range(6)], root)
    cf = _flame_finial_mesh(name + "_CornerFlame", 1.2, key="gilt", segs=16)
    cf.data.transform(Matrix.Translation((0.452, 0, L_CORNICE_TOP - 0.002)))
    _instances(_hide_template(cf), name + "_CornerFlame", [((0, 0, 0), TAU * k / 6) for k in range(6)], root)
    dr = _lathe(name + "_Drop", [(0.0, -0.050), (0.006, -0.046), (0.014, -0.032), (0.016, -0.020), (0.011, -0.008),
                                  (0.008, -0.002), (0.012, 0.004), (0.0, 0.006)], 16, keys=("gilt",), smooth_angle=60)
    dr.data.transform(Matrix.Translation((0.385, 0, 0.346)))
    _instances(_hide_template(dr), name + "_Drop", [((0, 0, 0), TAU * k / 6) for k in range(6)], root)
    # suspension: one chain to a ceiling rose
    z_top = LANTERN_H + drop
    rose = [(0.0, z_top - 0.150), (0.016, z_top - 0.150), (0.024, z_top - 0.140), (0.022, z_top - 0.128),
            (0.030, z_top - 0.118), (0.060, z_top - 0.100), (0.110, z_top - 0.070), (0.140, z_top - 0.044),
            (0.156, z_top - 0.026), (0.170, z_top - 0.018), (0.176, z_top - 0.008), (0.176, z_top), (0.0, z_top)]
    rs = _lathe(name + "_Rose", rose, 48, keys=("brass_aged", "gilt"), idx=[1, 1, 1, 0, 0, 0, 0, 0, 1, 1, 1, 0],
                smooth_angle=42, lobes=(12, 0.08, z_top - 0.110, z_top - 0.030))
    hook = C.torus("rhook", 0.016, 0.0055, (0, 0, z_top - 0.162), mat("brass"), 16, 8, rot=C.rotx(90))
    rs = _join([rs, hook], name + "_Rose")
    _parent([rs], root)
    link = _chain_link_mesh(name + "_ChainLink", L=0.10, W=0.056, wire=0.0072, n_end=5, sides=6)
    ch = _chain(name + "_Chain", (0, 0, LANTERN_H - 0.0322), (0, 0, z_top - 0.1705), link, L=0.10, wire=0.0072)
    C.remove(link)
    _parent([ch], root)
    root["ovr_body_height"] = LANTERN_H
    root["ovr_drop"] = drop
    return root


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def _clear_preview_rig():
    for ob in list(bpy.data.objects):
        if ob.type == "LIGHT" or ob.name.startswith(("PreviewFloor", "PreviewWall")):
            bpy.data.objects.remove(ob, do_unlink=True)


def _glare(scene, strength=0.5, threshold=1.0, size=7):
    try:
        ng = bpy.data.node_groups.new("PreviewComp", "CompositorNodeTree")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        rl = ng.nodes.new("CompositorNodeRLayers")
        gl = ng.nodes.new("CompositorNodeGlare")
        out = ng.nodes.new("NodeGroupOutput")
        for nm, val in (("Type", "Bloom"), ("Quality", "High"), ("Threshold", threshold), ("Strength", strength),
                        ("Size", size)):
            try:
                gl.inputs[nm].default_value = val
            except Exception:
                pass
        ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
        ng.links.new(gl.outputs["Image"], out.inputs[0])
        scene.compositing_node_group = ng
    except Exception as e:  # compositor API differs: render without bloom
        print("glare unavailable:", e)


def _no_glare(scene):
    try:
        scene.compositing_node_group = None
    except Exception:
        pass


def _shoot(cam, target, dist, yaw, pitch, lens=50):
    import lib_render as R
    cam.data.lens = lens
    y, p = math.radians(yaw), math.radians(pitch)
    t = Vector(target)
    R.look(cam, t + Vector((math.sin(y) * math.cos(p), -math.cos(y) * math.cos(p), math.sin(p))) * dist, t)


def _point(name, loc, energy, radius=0.04, color=(1.0, 0.80, 0.55), shadow=False):
    L = bpy.data.lights.new(name, "POINT")
    L.energy = energy
    L.shadow_soft_size = radius
    L.color = color
    try:
        L.use_shadow = shadow
    except AttributeError:
        pass
    ob = bpy.data.objects.new(name, L)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = Vector(loc)
    return ob


def _tree(root):
    return [root] + list(root.children_recursive)


def _set_visible(objs, vis):
    for o in objs:
        o.hide_render = not vis
        o.hide_viewport = not vis


def _wall(y=0.0006, size=6.0, color=(0.80, 0.72, 0.60)):
    me = bpy.data.meshes.new("PreviewWall")
    s = size / 2
    me.from_pydata([(-s, y, -s), (s, y, -s), (s, y, s), (-s, y, s)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("PreviewWall", me)
    bpy.context.scene.collection.objects.link(ob)
    m = bpy.data.materials.new("PreviewWallMat")
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = 0.9
    me.materials.append(m)
    return ob


def _report(root, label):
    t, u = asset_tris(root)
    print(f"TRIS {label} rendered={t} unique={u}")
    for k, (n, c) in sorted(tri_split(root).items(), key=lambda kv: -kv[1][0] * kv[1][1]):
        print(f"   {k:44s} {n:6d} x{c:3d} = {n * c}")
    return t


def _lit_rig():
    """Warm fills at the lamp rings (just outside each ring, at bulb height) plus a soft core light,
    standing in for the glow of the 82 globes; the cast bands stay dark where the lamps can't reach."""
    for i in range(10):
        a = TAU * (i + 0.5) / 10
        _point("LA", (1.32 * math.cos(a), 1.32 * math.sin(a), 1.49), 5, radius=0.08)
    for i in range(6):
        a = TAU * (i + 0.5) / 6
        _point("LB", (0.95 * math.cos(a), 0.95 * math.sin(a), 1.00), 3.5, radius=0.08)
        _point("LC", (0.60 * math.cos(a), 0.60 * math.sin(a), 0.60), 2, radius=0.06)
    _point("Core", (0, 0, 1.02), 4, radius=0.25)


def preview(out_dir, which=("chandelier", "sconce", "lantern")):
    import os
    import lib_render as R
    scene = bpy.context.scene
    R.engine(scene, "EEVEE", 48, (960, 960))
    cam = R.camera(lens=50)
    paths = []

    def shot(fname):
        paths.append(R.render(os.path.join(out_dir, fname)))

    if "chandelier" in which:
        for d in (4.0, HALL_DROP):
            r0 = build_chandelier_grand(d, name=f"Probe_{d}")
            print(f"TRIS_AT_DROP drop={d} rendered={asset_tris(r0)[0]}")
            for o in _tree(r0):
                if o.type == "MESH":
                    me = o.data
                    bpy.data.objects.remove(o, do_unlink=True)
                    if me.users == 0:
                        bpy.data.meshes.remove(me)
                else:
                    bpy.data.objects.remove(o, do_unlink=True)
        root = build_chandelier_grand(4.0)
        objs = _tree(root)
        _report(root, "Light_Chandelier_Grand")
        body = [o for o in objs if "Chain" not in o.name and "Canopy" not in o.name]
        lo, hi = R.bounds(body)
        ctr = (lo + hi) / 2
        R.studio(scene, ctr.to_tuple(), 1.7, floor=False)
        _shoot(cam, ctr, 6.3, 24, -14)
        shot("chandelier_studio_below.png")
        _shoot(cam, ctr, 6.3, -32, 4)
        shot("chandelier_studio_side.png")
        _shoot(cam, Vector((0.62, -0.95, 1.52)), 1.30, 22, -16)
        shot("chandelier_close_ring.png")
        _shoot(cam, Vector((0.10, -0.70, 1.02)), 1.15, 8, -12)
        shot("chandelier_close_tierBC.png")
        _shoot(cam, Vector((0.05, -0.05, 0.42)), 1.30, 18, -12)
        shot("chandelier_close_finial.png")
        _shoot(cam, Vector((0.25, -0.35, 1.98)), 1.25, 28, 24)
        shot("chandelier_close_crown.png")
        _shoot(cam, Vector((RA * math.cos(-1.38), RA * math.sin(-1.38), 1.52)), 0.42, 62, -14)
        shot("chandelier_lamp_macro.png")
        lo2, hi2 = R.bounds(objs)
        _shoot(cam, (lo2 + hi2) / 2, 12.0, 18, -6)
        shot("chandelier_full.png")
        _clear_preview_rig()
        R.world(scene, (0.030, 0.026, 0.024), 1.0)
        _lit_rig()
        _glare(scene, 0.45, 1.6, 6)
        _shoot(cam, ctr, 6.3, 20, -16)
        shot("chandelier_lit.png")
        _shoot(cam, Vector((0, 0, 1.15)), 4.4, 10, -48)
        shot("chandelier_lit_from_below.png")
        _shoot(cam, Vector((0, 0, 1.1)), 9.0, 20, -38, 35)
        shot("chandelier_lit_floor_view.png")
        _shoot(cam, Vector((0, 0, 1.18)), 5.4, 8, -30, 62)          # framed like the Ref 1 crop
        shot("chandelier_lit_ref1_view.png")
        _no_glare(scene)
        _clear_preview_rig()
        _set_visible(objs, False)

    if "sconce" in which:
        sc = build_sconce_wall()
        print(f"TRIS Light_Sconce_Wall rendered={C.tris(sc)}")
        R.world(scene, (0.6, 0.56, 0.5), 0.4)
        R.studio(scene, (0, -0.1, 0.0), 0.45, floor=False)
        _wall()
        _shoot(cam, Vector((0, -0.08, 0.02)), 1.35, 28, 6)
        shot("sconce_front.png")
        _shoot(cam, Vector((0, -0.08, 0.02)), 1.30, 62, -18)
        shot("sconce_side_below.png")
        _shoot(cam, Vector((0.17, -0.12, 0.06)), 0.55, 20, 12)
        shot("sconce_close.png")
        _shoot(cam, Vector((0.20, -0.14, 0.12)), 0.35, 30, 25)
        shot("sconce_shade_top.png")
        _clear_preview_rig()
        _set_visible([sc], False)

    if "lantern" in which:
        ln = build_lantern_pendant(1.2)
        objs = _tree(ln)
        _report(ln, "Light_Lantern_Hall")
        body = [o for o in objs if "Chain" not in o.name and "Rose" not in o.name]
        lo, hi = R.bounds(body)
        ctr = (lo + hi) / 2
        R.studio(scene, ctr.to_tuple(), 1.0, floor=False)
        _shoot(cam, ctr, 3.9, 22, -8)
        shot("lantern_studio.png")
        lo2, hi2 = R.bounds(objs)
        _shoot(cam, (lo2 + hi2) / 2, 5.6, -30, -14)
        shot("lantern_full.png")
        _shoot(cam, Vector((0.0, -0.32, 1.20)), 1.05, 12, 4)
        shot("lantern_close_crown.png")
        _shoot(cam, Vector((0.0, -0.38, 1.27)), 0.38, 25, 8)
        shot("lantern_crest.png")
        _clear_preview_rig()
        R.world(scene, (0.030, 0.026, 0.024), 1.0)
        inner = _point("LL", (0, 0, 0.86), 14, radius=0.10)
        inner.data.specular_factor = 0.0      # no hot-spot reflection in the glazing
        R.world(scene, (0.050, 0.044, 0.040), 1.0)
        _glare(scene, 0.45, 1.2, 7)
        _shoot(cam, ctr, 3.9, 22, -8)
        shot("lantern_lit.png")
        _no_glare(scene)
        _clear_preview_rig()
        _set_visible(objs, False)

    print("PREVIEW_IMAGES", *paths)
    return paths
