"""Body, head and face parts for the OVR avatar kit."""

import bmesh
import bpy
import math
from mathutils import Matrix, Vector

from kit_core import (
    Surface, add_build_keys, align_to_normal, bone_weights, dominant_bone, evaluated_copy, join,
    link, material, mesh_from_bmesh, region_skin, remove, skin, tube, uv_sphere,
    REGION_OF_BONE,  # noqa: F401  (re-exported: garments import it from here)
)

HEAD_CENTER = Vector((0, 0, 1.585))

# Body regions: garments list the regions they cover so hidden skin never pokes through.


def region_of(p):
    return REGION_OF_BONE[dominant_bone(p).split(".")[0]]


# ---------------------------------------------------------------------------
# Body
# ---------------------------------------------------------------------------

def _skin_skeleton():
    """Vertex skeleton + per-vertex radii for the Skin modifier (character's left side)."""
    verts = [
        ((0, 0.005, 0.905), (0.150, 0.112)),   # 0 pelvis (root)
        ((0, 0.0, 1.035), (0.124, 0.092)),     # 1 waist
        ((0, -0.004, 1.20), (0.148, 0.100)),   # 2 chest
        ((0, 0.006, 1.325), (0.160, 0.090)),   # 3 shoulder line
        ((0, 0.012, 1.385), (0.055, 0.052)),   # 4 neck base
        ((0, 0.012, 1.47), (0.050, 0.048)),    # 5 neck top (inside the head)
    ]
    edges = [(0, 1), (1, 2), (2, 3), (3, 4), (4, 5)]
    for side in (1, -1):
        b = len(verts)
        verts += [
            ((0.188 * side, 0.006, 1.322), (0.060, 0.060)),   # shoulder
            ((0.255 * side, 0.010, 1.060), (0.044, 0.044)),   # elbow
            ((0.285 * side, -0.005, 0.812), (0.036, 0.036)),  # wrist
            ((0.292 * side, -0.008, 0.752), (0.040, 0.040)),  # palm
            ((0.297 * side, -0.012, 0.692), (0.031, 0.031)),  # fingertips
            ((0.281 * side, -0.036, 0.770), (0.014, 0.014)),  # thumb
        ]
        edges += [(3, b), (b, b + 1), (b + 1, b + 2), (b + 2, b + 3), (b + 3, b + 4), (b + 2, b + 5)]
        b = len(verts)
        verts += [
            ((0.092 * side, 0.0, 0.860), (0.090, 0.090)),     # hip
            ((0.092 * side, 0.006, 0.470), (0.061, 0.061)),   # knee
            ((0.092 * side, 0.020, 0.095), (0.046, 0.046)),   # ankle
            ((0.092 * side, -0.112, 0.040), (0.042, 0.040)),  # toes
            ((0.092 * side, 0.042, 0.038), (0.040, 0.040)),   # heel
        ]
        edges += [(0, b), (b, b + 1), (b + 1, b + 2), (b + 2, b + 3), (b + 2, b + 4)]
    return verts, edges


def build_body(rig, skin_mat):
    verts, edges = _skin_skeleton()
    me = bpy.data.meshes.new("BodySkeleton")
    me.from_pydata([v for v, _ in verts], edges, [])
    tmp = link(bpy.data.objects.new("BodySkeleton", me))
    mod = tmp.modifiers.new("Skin", "SKIN")
    mod.branch_smoothing = 0.6
    for i, (_, r) in enumerate(verts):
        sv = me.skin_vertices[0].data[i]
        sv.radius = r
        sv.use_root = i == 0
    sub = tmp.modifiers.new("Subsurf", "SUBSURF")
    sub.levels = sub.render_levels = 2
    full = evaluated_copy(tmp, "Body_Full")
    remove(tmp)

    # Remember smooth normals of the whole body so split regions show no seams.
    full.data.update()
    normals = [v.normal.copy() for v in full.data.vertices]

    # Split into regions by the dominant bone of each face.
    by_region = {}
    for poly in full.data.polygons:
        c = Vector((0, 0, 0))
        for vi in poly.vertices:
            c += full.data.vertices[vi].co
        c /= len(poly.vertices)
        by_region.setdefault(region_of(c), []).append(poly.index)

    parts = []
    for region, faces in sorted(by_region.items()):
        bm = bmesh.new()
        index = {}
        src = full.data
        for fi in faces:
            poly = src.polygons[fi]
            vs = []
            for vi in poly.vertices:
                if vi not in index:
                    index[vi] = bm.verts.new(src.vertices[vi].co)
                vs.append(index[vi])
            try:
                bm.faces.new(vs)
            except ValueError:
                pass
        bm.verts.index_update()
        order = sorted(index.items(), key=lambda kv: kv[1].index)
        ob = mesh_from_bmesh(f"Body_{region}", bm, skin_mat)
        ob.data.normals_split_custom_set_from_vertices([normals[vi] for vi, _ in order])
        add_build_keys(ob)
        region_skin(ob, rig, region=region)
        parts.append(ob)
    remove(full)
    return parts


# ---------------------------------------------------------------------------
# Head
# ---------------------------------------------------------------------------

def _head_shape(co, kind=None):
    c = HEAD_CENTER
    x, y, z = co.x, co.y, co.z - c.z
    below = max(0.0, min(1.0, -z / 0.165))   # 0 at eye level → 1 at the chin
    above = max(0.0, min(1.0, z / 0.17))
    # Base stylisation: tapered chin, soft cheeks, slightly flatter face.
    sx = 1 - 0.20 * below ** 1.6
    sy = 1 - 0.10 * below ** 1.6
    if y < 0:
        sy *= 0.97
    if kind == "Face_Round":
        sx *= 1 + 0.075 * math.sin(below * math.pi * 0.9)
        sy *= 1 + 0.03 * below
    elif kind == "Face_Long":
        z -= 0.024 * below
        sx *= 1 - 0.025 * below
    elif kind == "Face_Heart":
        sx *= (1 - 0.10 * below ** 2) * (1 + 0.035 * above)
    return Vector((x * sx, y * sy, c.z + z))


def build_head(rig, skin_mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=32, radius=0.15)
    bmesh.ops.scale(bm, vec=(1.0, 0.94, 1.07), verts=bm.verts)
    bmesh.ops.translate(bm, vec=HEAD_CENTER, verts=bm.verts)
    base = [v.co.copy() for v in bm.verts]
    for v in bm.verts:
        v.co = _head_shape(v.co)
    head = mesh_from_bmesh("Head_Base", bm, skin_mat)

    # Ears join the head mesh (they share its shape keys as rigid passengers).
    ears = [
        uv_sphere(f"Ear{s}", 0.03, (0.146 * s, 0.012, 1.578), (0.42, 0.72, 1.0), 16, 12, skin_mat)
        for s in (1, -1)
    ]
    n_head = len(head.data.vertices)
    head = join([head, *ears], "Head_Base")

    head.shape_key_add(name="Basis", from_mix=False)
    for kind in ("Face_Round", "Face_Long", "Face_Heart"):
        key = head.shape_key_add(name=kind, from_mix=False)
        for i in range(n_head):
            key.data[i].co = _head_shape(base[i], kind)
    skin(head, rig, rigid="Head")
    return head


# ---------------------------------------------------------------------------
# Face parts. Each sits on the head surface (found by ray casting) and is rigid to the Head bone.
# ---------------------------------------------------------------------------

def _place(ob, point, normal, push=0.0):
    rot = align_to_normal(normal)
    ob.data.transform(Matrix.Translation(point + normal * push) @ rot.to_4x4())
    return ob


def _eye_parts(style, mats, side):
    """One eye in local space: centred at the origin, looking down -Y."""
    iris, dark, shine, skin_mat = mats["iris"], mats["eye_dark"], mats["shine"], mats["skin"]
    parts = []
    if style == "round":
        parts.append(uv_sphere("i", 1, (0, 0, 0), (0.023, 0.006, 0.029), 20, 14, iris))
        parts.append(uv_sphere("p", 1, (0, -0.004, -0.002), (0.013, 0.004, 0.017), 16, 10, dark))
        parts.append(uv_sphere("s", 0.0058, (0.007 * side, -0.0085, 0.009), (1, 0.5, 1), 10, 8, shine))
    elif style == "almond":
        parts.append(uv_sphere("i", 1, (0, 0, 0), (0.026, 0.006, 0.022), 20, 14, iris))
        parts.append(uv_sphere("p", 1, (0, -0.004, -0.001), (0.013, 0.004, 0.014), 16, 10, dark))
        parts.append(uv_sphere("s", 0.005, (0.008 * side, -0.0085, 0.007), (1, 0.5, 1), 10, 8, shine))
        # Upper lash line sweeping outwards.
        pts = [(-0.022 * side, -0.006, 0.010), (0, -0.008, 0.022), (0.026 * side, -0.006, 0.016), (0.034 * side, -0.004, 0.022)]
        parts.append(tube("l", pts, [0.0026, 0.0034, 0.003, 0.0012], dark))
    elif style == "sleepy":
        parts.append(uv_sphere("i", 1, (0, 0, 0), (0.024, 0.006, 0.026), 20, 14, iris))
        parts.append(uv_sphere("p", 1, (0, -0.004, -0.004), (0.013, 0.004, 0.014), 16, 10, dark))
        # A skin-coloured lid over the top half, with a soft lash line.
        lid = uv_sphere("lid", 1, (0, -0.0035, 0.007), (0.027, 0.0072, 0.020), 20, 14, skin_mat)
        bm = bmesh.new()
        bm.from_mesh(lid.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < 0.004], context="VERTS")
        bm.to_mesh(lid.data)
        bm.free()
        parts.append(lid)
        pts = [(-0.025, -0.008, 0.004), (0, -0.0095, 0.002), (0.025, -0.008, 0.004)]
        parts.append(tube("l", pts, [0.0018, 0.0026, 0.0018], dark))
    else:  # sparkle
        parts.append(uv_sphere("i", 1, (0, 0, 0), (0.026, 0.006, 0.032), 20, 14, iris))
        parts.append(uv_sphere("p", 1, (0, -0.004, -0.002), (0.015, 0.004, 0.019), 16, 10, dark))
        parts.append(uv_sphere("s", 0.0068, (0.008 * side, -0.0085, 0.011), (1, 0.5, 1), 10, 8, shine))
        parts.append(uv_sphere("s2", 0.0032, (-0.007 * side, -0.0085, -0.010), (1, 0.5, 1), 8, 6, shine))
        for k in range(3):
            a = 0.35 + k * 0.32
            base = Vector((math.cos(a) * 0.024 * side, -0.004, math.sin(a) * 0.028))
            tip = base + Vector((math.cos(a) * 0.012 * side, -0.002, math.sin(a) * 0.010))
            parts.append(tube("lash", [base, (base + tip) / 2, tip], [0.0022, 0.0016, 0.0004], dark))
    return parts


EYE_X = 0.057
EYE_Z = 1.593


def build_eyes(style, head, rig, mats):
    surf = Surface(head)
    objs = []
    centres = {}
    for side in (1, -1):
        point, normal = surf.front(EYE_X * side, EYE_Z)
        centres[side] = point + normal * 0.002
        for part in _eye_parts(style, mats, side):
            _place(part, point, normal, push=0.002)
            objs.append(part)
    ob = join(objs, f"Eyes_{style.capitalize()}")
    ob.shape_key_add(name="Basis", from_mix=False)
    for side, key_name in ((1, "Blink_Left"), (-1, "Blink_Right")):
        key = ob.shape_key_add(name=key_name, from_mix=False)
        c = centres[side]
        for i, v in enumerate(ob.data.vertices):
            if v.co.x * side > 0.01:
                # Squash the eye into a closed, slightly smiling line.
                dz = v.co.z - c.z
                key.data[i].co = Vector((v.co.x, v.co.y + 0.001, c.z - 0.004 + dz * 0.09))
    skin(ob, rig, rigid="Head")
    return ob


BROW_STYLES = {
    # inner→outer heights (relative), radius at inner/middle/outer
    "soft": ([0.000, 0.006, 0.004], [0.0045, 0.0050, 0.0022]),
    "straight": ([0.000, 0.002, 0.001], [0.0055, 0.0055, 0.0030]),
    "arched": ([-0.004, 0.011, 0.002], [0.0045, 0.0048, 0.0018]),
    "bold": ([0.000, 0.005, 0.002], [0.0085, 0.0082, 0.0045]),
}


def build_brows(style, head, rig, brow_mat):
    surf = Surface(head)
    heights, radii = BROW_STYLES[style]
    objs = []
    for side in (1, -1):
        pts = []
        for k, (x, h) in enumerate(zip((0.030, 0.058, 0.088), heights)):
            point, normal = surf.front(x * side, 1.648 + h - (0.004 if k == 2 else 0))
            pts.append(point + normal * 0.005)
        objs.append(tube(f"brow{side}", pts, radii, brow_mat, segments=8))
    ob = join(objs, f"Brows_{style.capitalize()}")
    ob.shape_key_add(name="Basis", from_mix=False)
    key = ob.shape_key_add(name="Brow_Raise", from_mix=False)
    for i, v in enumerate(ob.data.vertices):
        inner = 1 - min(1, abs(v.co.x) / 0.09)
        key.data[i].co = v.co + Vector((0, -0.002, 0.012 + 0.010 * inner))
    skin(ob, rig, rigid="Head")
    return ob


MOUTH_Z = 1.522


def build_mouth(head, rig, lip_mat, inner_mat):
    """Two lips along the resting curve (they meet as one lip line when closed) and a dark inner
    mouth hidden between them. Jaw_Open parts the lips into an oval around the inner mouth, so an
    open mouth never shows the closed lip line across it."""
    surf = Surface(head)
    w = 0.024
    radii = [0.0028, 0.0038, 0.0043, 0.0044, 0.0043, 0.0038, 0.0028]

    def lip(name, dz):
        pts = []
        for k in range(7):
            x = -w + 2 * w * k / 6
            z = MOUTH_Z - 0.009 * (1 - (x / w) ** 2) + dz
            point, normal = surf.front(x, z)
            pts.append(point + normal * 0.0045)
        return tube(name, pts, radii, lip_mat, segments=8)

    upper = lip("lip_upper", 0.0008)
    lower = lip("lip_lower", -0.0008)
    centre, normal = surf.front(0, MOUTH_Z - 0.008)
    inner = uv_sphere("inner", 1, (0, 0, 0), (0.019, 0.004, 0.0016), 20, 12, inner_mat)
    _place(inner, centre, normal, push=0.0025)
    n_upper = len(upper.data.vertices)
    n_lips = n_upper + len(lower.data.vertices)
    ob = join([upper, lower, inner], "Mouth_Base")
    ob.shape_key_add(name="Basis", from_mix=False)
    keys = {name: ob.shape_key_add(name=name, from_mix=False) for name in ("Smile", "Jaw_Open", "Frown")}
    for i, v in enumerate(ob.data.vertices):
        co = v.co
        t = max(-1.0, min(1.0, co.x / w))
        middle = 1 - t * t
        if i < n_lips:
            keys["Smile"].data[i].co = co + Vector((co.x * 0.18, 0, 0.007 * (1 - middle) - 0.004 * middle))
            keys["Frown"].data[i].co = co + Vector((0, 0, 0.016 * middle - 0.003))
            if i < n_upper:  # upper lip rises and flattens: the top of the oval
                keys["Jaw_Open"].data[i].co = co + Vector((co.x * 0.04, 0, 0.0065 * middle + 0.0008))
            else:  # lower lip drops: the bottom of the oval
                keys["Jaw_Open"].data[i].co = co + Vector((co.x * 0.04, 0, -0.012 * middle - 0.0015))
        else:  # the inner mouth fills the opening between the lips
            dz = co.z - centre.z
            keys["Smile"].data[i].co = co
            keys["Jaw_Open"].data[i].co = Vector((co.x * 1.04, co.y - 0.0015, centre.z - 0.0028 + dz * 5.4))
            keys["Frown"].data[i].co = co
    skin(ob, rig, rigid="Head")
    return ob


def build_nose(style, head, rig, mat):
    surf = Surface(head)
    if style == "button":
        point, normal = surf.front(0, 1.553)
        ob = uv_sphere("Nose_Button", 1, (0, 0, 0), (0.017, 0.012, 0.014), 16, 12, mat)
        _place(ob, point, normal, push=0.004)
    elif style == "soft":
        point, normal = surf.front(0, 1.560)
        ob = uv_sphere("Nose_Soft", 1, (0, 0, 0), (0.014, 0.011, 0.024), 16, 12, mat)
        _place(ob, point, normal, push=0.003)
    else:  # pointed
        top, n1 = surf.front(0, 1.585)
        tip, n2 = surf.front(0, 1.552)
        ob = tube("Nose_Pointed", [top + n1 * 0.002, tip + n2 * 0.016, tip + n2 * 0.012 + Vector((0, 0, -0.008))], [0.006, 0.011, 0.007], mat)
    ob.name = ob.data.name = f"Nose_{style.capitalize()}"
    skin(ob, rig, rigid="Head")
    return ob


def _dot(name, surf, x, z, size, mat, push=0.0025):
    point, normal = surf.front(x, z)
    ob = uv_sphere(name, 1, (0, 0, 0), size, 10, 8, mat)
    return _place(ob, point, normal, push)


def build_details(head, rig, mats):
    surf = Surface(head)
    out = []
    freckles = []
    spots = [(0.050, 1.566), (0.064, 1.558), (0.078, 1.566), (0.068, 1.572), (0.088, 1.557), (0.057, 1.551), (0.081, 1.548), (0.020, 1.575)]
    for side in (1, -1):
        for k, (x, z) in enumerate(spots):
            freckles.append(_dot(f"f{side}{k}", surf, x * side, z, (0.0034, 0.0012, 0.0034), mats["freckle"]))
    out.append(join(freckles, "Detail_Freckles"))
    blush = [_dot(f"b{s}", surf, 0.083 * s, 1.552, (0.020, 0.003, 0.011), mats["blush"], 0.0018) for s in (1, -1)]
    out.append(join(blush, "Detail_Blush"))
    mark = _dot("Detail_BeautyMark", surf, 0.046, 1.522, (0.0042, 0.0015, 0.0042), mats["freckle"])
    mark.name = mark.data.name = "Detail_BeautyMark"
    out.append(mark)
    stars = []
    for s, (x, z, r) in ((1, (0.093, 1.566, 0.011)), (-1, (0.082, 1.552, 0.008))):
        point, normal = surf.front(x * s, z)
        bm = bmesh.new()
        ring = []
        for k in range(10):
            a = math.pi / 2 + k * math.pi / 5
            rr = r if k % 2 == 0 else r * 0.45
            ring.append(bm.verts.new((math.cos(a) * rr, 0, math.sin(a) * rr)))
        back = [bm.verts.new((v.co.x, 0.002, v.co.z)) for v in ring]
        bm.faces.new(ring)
        bm.faces.new(list(reversed(back)))
        for k in range(10):
            bm.faces.new((ring[k], ring[(k + 1) % 10], back[(k + 1) % 10], back[k]))
        star = mesh_from_bmesh(f"star{s}", bm, mats["sticker"], smooth=False)
        stars.append(_place(star, point, normal, 0.002))
    out.append(join(stars, "Detail_Stars"))
    for ob in out:
        skin(ob, rig, rigid="Head")
    return out
