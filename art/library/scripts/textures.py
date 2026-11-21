"""
Procedural PBR textures for the OVR library (seamless, tileable, real-world scale).

Run in headless Blender (numpy inside Blender, images written with bpy as PNG):

    Blender -b --factory-startup --python-exit-code 1 --python art/library/scripts/textures.py [-- walnut oak ...]
    Blender ... --python art/library/scripts/run_asset.py -- --module textures --out <dir>   (generate + previews)

Environment for quick iteration: OVR_TEX="walnut,oak" limits which textures `preview` regenerates,
OVR_TEX_SKIP=1 reuses the PNGs on disk, OVR_TEX_PREVIEW=boards,fitted,checks,closeups picks renders.

For every texture id `<tex>` used by lib_materials.PALETTE this writes, into art/library/textures/:
    <tex>_color.png   sRGB base colour
    <tex>_rough.png   roughness (non-colour, absolute value, replaces the palette constant)
    <tex>_normal.png  OpenGL tangent-space normal (+X right = +U, +Y up = +V), non-colour
    <tex>_metal.png   gilt mask (non-colour, 1 = gold leaf) for coffer_panel, ornament_band and
                      book_spines only. Wire it to Metallic, and use (1 - metal) as the factor of the
                      tint / object-colour multiply so tints never recolour the gold (see mat_fitted).
and palette_fit.json: the measured mean of each texture, and under "changes" the edits
lib_materials.PALETTE needs for these maps (see palette_changes / apply_palette_fit / tint_report).
One tile spans PALETTE[key]["size"] metres (lib_materials.tex_size), so UV at that scale.
Wood textures run their grain along U.

Palette integration (lib_materials.py is not edited from here; its owner applies these):
  * Tile sizes: walnut, walnut_dark and mahogany are drawn for a 1.6 m tile (2048 px, PALETTE_SIZE),
    so a 2.4 m upright repeats at most 1.5 times. Until the palette says 1.6 they render at half
    scale (2.6 mm rings, still plausible walnut).
  * Tints: palette_fit.json "changes" (walnut_dark, oak, oak_light, leather_*, fabric_*, velvet_olive,
    coffer_*, plaster_green, carpet_*): with them every textured key renders within ~1 % of its base.
  * Gilt: wire <tex>_metal.png to Metallic and use (1 - metal) as the factor of the tint /
    object-colour multiply (mat_fitted is the reference). apply_palette_fit() + mat_fitted() is
    exactly what preview() renders.

Colour calibration rule (fit_target): a texture shared by several keys gets the mean of its
untinted key (or, when every key is tinted, the geometric mean the current tints aim at), raised
per channel to the lightest base of any key using it, so every key reaches its base with a tint
<= 1 (tint = base / texture mean). NEUTRAL_TEXTURES (coffer_panel) are generated grey at the
brightest base value and every key tints them. Untinted keys that are also the lightest (walnut,
plaster, mahogany, every single-key texture) are exact with no palette change at all.
DESIGN_TEXTURES (rugs, frieze, marble checker, book atlas) keep their drawn colours.

Wood (wood / wood_phase): a flat-sawn board model. The ring number is the integral across the
board of a smoothed sign function tanh(d / D) (d = distance to the nearest pith-side valley or
ridge, D = depth of the pith), plus the log's taper (~10 rings per metre along the grain), so
rings surface one after another as nested open cathedral arches between straight-grain flanks.

Exceptions:
  * `brushed` has no _color map on purpose: brass / brass_aged carry no tint, so the palette's own
    base colour stays in charge; brushed only supplies roughness + normal detail.
  * `rug_persian`: one tile is the whole rug. UV the rug's top face 0..1 in both axes, U along its
    length. Drawn for the lounge rug (5.6 m along U x 4.6 m along V), including a 5.5 cm warp
    fringe and a 3 cm kilim band at both short ends (U = 0 and U = 1).
  * `ornament_band` is 1024 x 512: U repeats every 0.6 m, V 0..1 spans the band height
    (drawn for a band about 0.3 m tall, egg-and-dart over an anthemion frieze, gilt on dark).
  * `coffer_panel`: one tile is one 1.4 m coffer panel (moulded frame at the tile edge, gilt rosette
    in the centre); UV the panel face 0..1. The painted field and frame are colour-neutral (tints
    colour them); the gilt is a fixed gold.
  * `rug_runner`: U repeats every 1.6 m along the runner, V 0..1 spans its 1.6 m width
    (ornamental borders at V = 0 and V = 1).

book_spines atlas (1024 wide x 2048 tall, `book_cloth`, multiplied by the object colour):
    8 columns x 4 rows of 32 different spine designs. Cell (col c, row r), c = 0..7 left to right,
    r = 0..3 bottom to top, covers U in [c/8, (c+1)/8] and V in [r/4, (r+1)/4] (128 x 512 px).
    Inside a cell U runs across the spine (left edge -> right edge) and V runs up the spine
    (V low = tail/bottom of the book, V high = head/top). Map a book's spine face onto one cell;
    the cell's outer 3 % margin is plain cloth, so slight UV insets are safe. Cloth and leather read
    light grey (they multiply the per-book object colour); lettering, rules and tooling are gold
    (book_spines_metal.png marks them); labels are darker, paper stickers and labels lighter.
    Each cell is drawn for the spine size of the bookcases.py variant that uses it (CELL_MM), so
    the lettering keeps its proportions:
    Row 0: antique calf, 5 raised bands at linspace(0.16, 0.86, 5), each with gilt rules at
           +-0.028 (bookcases reads them), title and volume labels, tooled panels (c 6-7: folios).
    Row 1: cloth bindings: gilt head/tail rules, title, author and imprint, some with panels.
    Row 2: c 0-2 thick reference volumes, c 3-4 folios, c 5-7 half-calf; bands at 0.32 and 0.62.
    Row 3: c 0-3 paperbacks (lettered along the spine), c 4-5 archival boxes (paper label, finger
           hole), c 6-7 library bindings. Cells 0, 1, 3, 4, 6 and 7 carry a paper shelf-mark
           sticker with typed call marks exactly on a = 0.13..0.87, b = 0.066..0.154 of the cell
           (STICKER_BOX; bookcases.py UVs its label cards onto it).
"""

from __future__ import annotations

import json
import math
import os
import sys
import time

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib_core as C  # noqa: E402
import lib_materials as LM  # noqa: E402

TEX_DIR = C.TEXTURES
F32 = np.float32


# ---------------------------------------------------------------------------
# Small numpy toolkit (everything periodic so the tiles are seamless)
# ---------------------------------------------------------------------------

def _freqs(h, w, real=True):
    fy = (np.fft.fftfreq(h) * h)[:, None]
    fx = ((np.fft.rfftfreq(w) if real else np.fft.fftfreq(w)) * w)[None, :]
    return fx, fy


def noise(shape, seed, cu, cv=None, beta=None):
    """Periodic band-limited noise (zero mean, unit std). `cu`/`cv` are the cutoff frequencies in
    cycles per tile along U (columns) and V (rows). beta None = Gaussian low-pass (smooth blobs),
    else a power law 1 / (1 + (f/c)^2)^(beta/2) (fractal, natural)."""
    h, w = shape
    cv = cu if cv is None else cv
    white = np.random.default_rng(seed).standard_normal((h, w)).astype(F32)
    spec = np.fft.rfft2(white)
    fx, fy = _freqs(h, w)
    q = (fx / cu) ** 2 + (fy / cv) ** 2
    filt = np.exp(-q) if beta is None else (1.0 + q) ** (-beta / 2.0)
    out = np.fft.irfft2(spec * filt, s=(h, w)).astype(F32)
    out -= out.mean()
    out /= out.std() + 1e-9
    return out


def pnoise(shape, seed, tile_u, tile_v, cu_m, cv_m=None, beta=None):
    """noise() with cutoffs in cycles per metre (clamped below Nyquist)."""
    h, w = shape
    cv_m = cu_m if cv_m is None else cv_m
    return noise(shape, seed, max(0.5, min(cu_m * tile_u, w * 0.45)), max(0.5, min(cv_m * tile_v, h * 0.45)), beta)


def blur(img, sigma_u, sigma_v=None):
    """Periodic Gaussian blur (sigma in pixels), 2D or 3D arrays."""
    sigma_v = sigma_u if sigma_v is None else sigma_v
    if img.ndim == 3:
        return np.dstack([blur(img[..., i], sigma_u, sigma_v) for i in range(img.shape[2])])
    h, w = img.shape
    fx, fy = _freqs(h, w)
    filt = np.exp(-2 * math.pi ** 2 * ((sigma_u * fx / w) ** 2 + (sigma_v * fy / h) ** 2))
    return np.fft.irfft2(np.fft.rfft2(img) * filt, s=(h, w)).astype(F32)


def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def psin(x):
    """sin clamped at 0 (safe to raise to fractional powers)."""
    return np.maximum(np.sin(x), 0.0)


def lerp(a, b, t):
    return a + (b - a) * t


def grid(h, w):
    """Pixel-centre coordinates u, v in [0, 1) as (1, w) and (h, 1) arrays."""
    u = ((np.arange(w, dtype=F32) + 0.5) / w)[None, :]
    v = ((np.arange(h, dtype=F32) + 0.5) / h)[:, None]
    return u, v


def full(u, v):
    return np.broadcast_to(u, (v.shape[0], u.shape[1])).astype(F32), np.broadcast_to(v, (v.shape[0], u.shape[1])).astype(F32)


def hex_lin(h):
    h = h.lstrip("#")
    c = np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], F32)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4).astype(F32)


def to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055).astype(F32)


def srgb_lin(s):
    s = np.asarray(s, F32)
    return np.where(s <= 0.04045, s / 12.92, ((s + 0.055) / 1.055) ** 2.4).astype(F32)


def lin_hex(c):
    s = to_srgb(np.asarray(c, F32))
    return "#" + "".join(f"{int(round(float(x) * 255)):02x}" for x in s)


def ramp(t, stops):
    """Colour ramp in linear space. stops: [(pos, '#hex'), ...]; t any shape -> (..., 3)."""
    xs = [p for p, _ in stops]
    cs = np.array([hex_lin(c) for _, c in stops])
    return np.stack([np.interp(t, xs, cs[:, i]).astype(F32) for i in range(3)], axis=-1)


def mix(a, b, t):
    """Blends colour arrays (..., 3) with a scalar-field factor."""
    return a + (b - a) * np.asarray(t, F32)[..., None]


def sample(img, x, y):
    """Periodic bilinear sample of img (h, w[, c]) at float pixel coords x (col), y (row)."""
    h, w = img.shape[:2]
    x0 = np.floor(x)
    y0 = np.floor(y)
    fx = (x - x0).astype(F32)
    fy = (y - y0).astype(F32)
    x0 = x0.astype(np.int64) % w
    y0 = y0.astype(np.int64) % h
    x1 = (x0 + 1) % w
    y1 = (y0 + 1) % h
    if img.ndim == 3:
        fx = fx[..., None]
        fy = fy[..., None]
    a = img[y0, x0] * (1 - fx) + img[y0, x1] * fx
    b = img[y1, x0] * (1 - fx) + img[y1, x1] * fx
    return (a * (1 - fy) + b * fy).astype(F32)


def worley(shape, cells_u, cells_v, seed, jitter=0.9):
    """Periodic jittered-grid Worley noise. Returns (F1, F2, cell_id) with distances in units of
    the cell size along U."""
    h, w = shape
    r = np.random.default_rng(seed)
    pts = (0.5 + (r.random((cells_v, cells_u, 2)) - 0.5) * jitter).astype(F32)
    cu_px = w / cells_u
    cv_px = h / cells_v
    U = (np.arange(w, dtype=F32) + 0.5)[None, :] / cu_px
    V = (np.arange(h, dtype=F32) + 0.5)[:, None] / cv_px
    U, V = full(U, V)
    ci = np.floor(U).astype(np.int64)
    cj = np.floor(V).astype(np.int64)
    f1 = np.full((h, w), 1e9, F32)
    f2 = np.full((h, w), 1e9, F32)
    cid = np.zeros((h, w), np.int64)
    asp = cv_px / cu_px
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ni = ci + di
            nj = cj + dj
            p = pts[nj % cells_v, ni % cells_u]
            dx = U - (ni + p[..., 0])
            dy = (V - (nj + p[..., 1])) * asp
            d = np.sqrt(dx * dx + dy * dy)
            ids = (nj % cells_v) * cells_u + (ni % cells_u)
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            cid = np.where(closer, ids, cid)
            f1 = np.where(closer, d, f1)
    return f1, f2, cid


def fit_mean(col, target_lin, weight=None, strength=1.0):
    """White-balances a linear colour field so its (weighted) mean equals target per channel."""
    if target_lin is None:
        return col
    if weight is None:
        m = col.reshape(-1, 3).mean(0)
    else:
        wgt = weight.reshape(-1, 1)
        m = (col.reshape(-1, 3) * wgt).sum(0) / max(float(wgt.sum()), 1e-6)
    gain = (np.asarray(target_lin, F32) / np.maximum(m, 1e-6)) ** strength
    return (col * gain).astype(F32)


def normal_map(height, px_u, px_v=None, gain=1.0):
    """OpenGL tangent normal (encoded 0..1) from a height field in metres; px = metres per pixel."""
    px_v = px_u if px_v is None else px_v
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) / (2 * px_u)
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) / (2 * px_v)
    n = np.dstack([-dx * gain, -dy * gain, np.ones_like(height)]).astype(F32)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def cavity(height, sigma):
    """Positive where the surface is lower than its surroundings (dirt/occlusion mask)."""
    return blur(height, sigma) - height


# ---------------------------------------------------------------------------
# Palette calibration
# ---------------------------------------------------------------------------

# Textures whose palette base is only a flat-colour fallback for a drawn design: never refitted.
DESIGN_TEXTURES = {"ornament_band", "rug_runner", "rug_persian", "marble_checker", "book_spines"}
# Textures generated colour-neutral (grey): every key using them carries a tint.
NEUTRAL_TEXTURES = {"coffer_panel"}
# Tile sizes (m) the textures are drawn for where they differ from today's lib_materials.PALETTE.
PALETTE_SIZE = {"walnut": 1.6, "walnut_dark": 1.6, "mahogany": 1.6}


def _keys_for(tex):
    return [(k, s) for k, s in LM.PALETTE.items() if s.get("tex") == tex and not s.get("object_color")]


def fit_target(tex):
    """Linear mean colour a texture is generated at (see the module docstring for the rule)."""
    ks = _keys_for(tex)
    if not ks or tex in DESIGN_TEXTURES:
        return None
    bases = np.array([hex_lin(s["base"]) for _, s in ks])
    if tex in NEUTRAL_TEXTURES:
        return np.full(3, bases.max(), F32)
    plain = [hex_lin(s["base"]) for _, s in ks if not s.get("tint")]
    if plain:
        m0 = np.exp(np.mean(np.log(np.clip(plain, 1e-4, 1.0)), axis=0))
    else:
        aims = [hex_lin(s["base"]) / np.maximum(hex_lin(s["tint"]), 1e-4) for _, s in ks]
        m0 = np.exp(np.mean(np.log(np.clip(aims, 1e-4, 1.0)), axis=0))
    return np.maximum(m0, bases.max(0)).astype(F32)


def _png_lin(path):
    img = bpy.data.images.load(path, check_existing=True)
    w, h = img.size
    px = np.empty(w * h * 4, F32)
    img.pixels.foreach_get(px)
    a = px.reshape(h, w, 4)[..., :3]
    return a, img


def texture_mean(tex):
    """Linear mean of <tex>_color.png over its tintable (non-gilt) area, or None."""
    path = os.path.join(TEX_DIR, f"{tex}_color.png")
    if not os.path.exists(path):
        return None
    a, _ = _png_lin(path)
    lin = srgb_lin(a)
    mpath = os.path.join(TEX_DIR, f"{tex}_metal.png")
    if os.path.exists(mpath):
        m, _ = _png_lin(mpath)
        wgt = (1.0 - m[..., 0]).reshape(-1, 1)
        return (lin.reshape(-1, 3) * wgt).sum(0) / max(float(wgt.sum()), 1e-6)
    return lin.reshape(-1, 3).mean(0)


_PATCH = None


def palette_patch(refresh=False):
    """{key: tint hex or None} that makes every textured palette key render at its base colour
    with the textures on disk (None = no tint). Only keys whose texture is calibrated appear."""
    global _PATCH
    if _PATCH is not None and not refresh:
        return _PATCH
    out = {}
    means = {}
    for key, spec in LM.PALETTE.items():
        tex = spec.get("tex")
        if not tex or spec.get("object_color") or tex in DESIGN_TEXTURES:
            continue
        if tex not in means:
            means[tex] = texture_mean(tex)
        mean = means[tex]
        if mean is None:
            continue
        t = np.clip(hex_lin(spec["base"]) / np.maximum(mean, 1e-5), 0.0, 1.0)
        out[key] = None if float(t.min()) > 0.985 else lin_hex(t)
    _PATCH = out
    return out


def tint_report():
    """Per textured key: what it renders as with today's palette tint, and with the fitted one."""
    lines = []
    patch = palette_patch(refresh=True)
    for key, spec in LM.PALETTE.items():
        tex = spec.get("tex")
        if key not in patch:
            continue
        mean = texture_mean(tex)
        base = hex_lin(spec["base"])
        now = mean * (hex_lin(spec["tint"]) if spec.get("tint") else 1.0)
        new_t = patch[key]
        fitted = mean * (hex_lin(new_t) if new_t else 1.0)
        err_now = float(np.max(np.abs(now / np.maximum(base, 1e-4) - 1)))
        err_fit = float(np.max(np.abs(fitted / np.maximum(base, 1e-4) - 1)))
        lines.append(f"  {key:18s} tex {tex:16s} mean {lin_hex(mean)} base {spec['base']} | today tint "
                     f"{spec.get('tint') or '-':8s} -> {lin_hex(now)} ({err_now * 100:4.0f}%) | fitted tint "
                     f"{new_t or '-':8s} -> {lin_hex(fitted)} ({err_fit * 100:4.1f}%)")
    return lines


def palette_changes():
    """{key: {field: value}}: the edits lib_materials.PALETTE needs for these textures (tile sizes
    from PALETTE_SIZE, fitted tints from palette_patch; tint None = remove the tint)."""
    out = {}
    patch = palette_patch()
    for key, spec in LM.PALETTE.items():
        ch = {}
        if key in PALETTE_SIZE and abs(spec.get("size", 1.0) - PALETTE_SIZE[key]) > 1e-6:
            ch["size"] = PALETTE_SIZE[key]
        if key in patch and (patch[key] or None) != (spec.get("tint") or None):
            ch["tint"] = patch[key]
        if ch:
            out[key] = ch
    return out


def apply_palette_fit():
    """Applies palette_changes() to lib_materials.PALETTE in memory (what the palette owner should
    write into lib_materials.py). Returns the changes applied."""
    ch = palette_changes()
    for key, c in ch.items():
        for f, val in c.items():
            if val is None:
                LM.PALETTE[key].pop(f, None)
            else:
                LM.PALETTE[key][f] = val
    return ch


def write_palette_fit():
    patch = palette_patch(refresh=True)
    data = {
        "about": "Generated by art/library/scripts/textures.py. 'changes' are the edits lib_materials.PALETTE "
                 "needs for these textures (tile 'size' in metres; 'tint' so the key renders at its base colour, "
                 "null = drop the tint). 'metal' lists textures with a <tex>_metal.png gilt mask: wire it to "
                 "Metallic and use (1 - metal) as the factor of the tint / object-colour multiply so tints never "
                 "recolour the gold (reference implementation: textures.mat_fitted).",
        "changes": palette_changes(),
        "tint": {k: patch[k] for k in sorted(patch)},
        "texture_mean": {t: lin_hex(texture_mean(t)) for t in sorted({LM.PALETTE[k]["tex"] for k in patch})},
        "metal": sorted(t for t in GENERATORS if os.path.exists(os.path.join(TEX_DIR, f"{t}_metal.png"))),
    }
    path = os.path.join(TEX_DIR, "palette_fit.json")
    with open(path, "w") as f:
        json.dump(data, f, indent=2)
    return path


def mat_fitted(key):
    """Reference material: lib_materials.mat(key) plus the fitted tint (palette_patch) and the gilt
    mask (Metallic, and kept out of the tint / object-colour multiply). Named MF_<Key>."""
    name = "MF_" + "".join(w.capitalize() for w in key.split("_"))
    m = bpy.data.materials.get(name)
    if m:
        return m
    spec = dict(LM.PALETTE[key])
    patch = palette_patch()
    if key in patch:
        spec["tint"] = patch[key]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = spec.get("rough", 0.6)
    bsdf.inputs["Metallic"].default_value = spec.get("metal", 0.0)
    base = LM._hex(spec["base"])
    bsdf.inputs["Base Color"].default_value = base
    tex = spec.get("tex")
    color_img = LM._image(tex, "color") if tex else None
    metal_img = LM._image(tex, "metal") if tex else None
    metal_out = None
    if metal_img:
        mn = nt.nodes.new("ShaderNodeTexImage")
        mn.image = metal_img
        mn.location = (-800, 600)
        metal_out = mn.outputs["Color"]
        nt.links.new(metal_out, bsdf.inputs["Metallic"])
    if color_img:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = color_img
        node.location = (-600, 300)
        src = node.outputs["Color"]
        if spec.get("tint") or spec.get("object_color"):
            mix_n = nt.nodes.new("ShaderNodeMix")
            mix_n.data_type = "RGBA"
            mix_n.blend_type = "MULTIPLY"
            mix_n.inputs["Factor"].default_value = 1.0
            if metal_out is not None:
                inv = nt.nodes.new("ShaderNodeMath")
                inv.operation = "SUBTRACT"
                inv.inputs[0].default_value = 1.0
                nt.links.new(metal_out, inv.inputs[1])
                nt.links.new(inv.outputs[0], mix_n.inputs["Factor"])
            nt.links.new(src, mix_n.inputs["A"])
            if spec.get("object_color"):
                info = nt.nodes.new("ShaderNodeObjectInfo")
                nt.links.new(info.outputs["Color"], mix_n.inputs["B"])
            else:
                mix_n.inputs["B"].default_value = LM._hex(spec["tint"])
            src = mix_n.outputs["Result"]
        nt.links.new(src, bsdf.inputs["Base Color"])
    rough_img = LM._image(tex, "rough") if tex else None
    if rough_img:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = rough_img
        nt.links.new(node.outputs["Color"], bsdf.inputs["Roughness"])
    normal_img = LM._image(tex, "normal") if tex else None
    if normal_img:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = normal_img
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = spec.get("normal", 0.5)
        nt.links.new(node.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if "metal" in spec and not metal_img:
        bsdf.inputs["Metallic"].default_value = spec["metal"]
    m.use_backface_culling = not spec.get("double_sided", False)
    return m


# ---------------------------------------------------------------------------
# Wood
# ---------------------------------------------------------------------------

# Tile sizes the wood textures are drawn for. walnut and mahogany cover 1.6 m (2048 px) so a
# 2.4 m upright repeats at most 1.5 times; lib_materials.PALETTE[...]["size"] must say the same
# (see PALETTE_SIZE / palette_fit.json).
WOOD_TILE = {"walnut": 1.6, "mahogany": 1.6, "oak": 0.8}

SPECIES = {
    # ring: mean ring spacing (m), ring_cv: irregularity of ring widths (log-normal, correlated).
    # zone: spacing (m) of the cathedral centres across the board (pith-side valleys and ridges
    # alternate); D: depth to the pith (m) = how soft / wide the arches are, D_sd its log spread
    # and D_c its cutoffs (cycles per metre along / across); taper: rings gained per metre along
    # the grain (the log's taper; it stacks open arches at every zone). Per tile that is rounded
    # to a whole number P of rings, which is also the period of the ring table.
    # wob: ring waviness (rings). Colours: earlywood, latewood, pores, dark
    # mineral streaks, light streaks.
    "walnut": dict(ring=0.0052, ring_cv=0.45, zone=0.52, D=0.05, D_sd=0.12, D_c=(0.7, 3.0), wob=0.6, taper=10.0,
                   early="#7d5636", late="#3e2617", pore="#21140c", streak="#2c1b10", light="#9a6e44",
                   late_frac=0.38, late_k=0.62, pores=2.1, ring_porous=0.25, rough=0.33,
                   figure=0.0, rays=0.0, streaks=1.0, purple=1.0),
    "mahogany": dict(ring=0.0042, ring_cv=0.35, zone=0.8, D=0.16, D_sd=0.04, D_c=(0.6, 2.5), wob=0.45, taper=10.0,
                     early="#8f4127", late="#5c2414", pore="#2e0f06", streak="#4a1b0d", light="#a65334",
                     late_frac=0.3, late_k=0.45, pores=2.2, ring_porous=0.0, rough=0.31,
                     figure=1.0, rays=0.0, streaks=0.6, purple=0.0),
    "oak": dict(ring=0.0068, ring_cv=0.5, zone=0.4, D=0.04, D_sd=0.12, D_c=(1.2, 3.0), wob=0.5, taper=10.0,
                early="#d2a56c", late="#946238", pore="#5a381b", streak="#9a6a3a", light="#ddb67e",
                late_frac=0.42, late_k=0.6, pores=2.0, ring_porous=0.85, rough=0.42,
                figure=0.0, rays=1.0, streaks=0.5, purple=0.0),
}


def _ring_table(R, rng, cv, corr=0.72):
    """Irregular growth rings: R correlated log-normal widths in phase units, summing to R."""
    e = rng.standard_normal(R)
    x = np.empty(R)
    acc = 0.0
    for i in range(R):
        acc = corr * acc + math.sqrt(1 - corr * corr) * e[i]
        x[i] = acc
    wd = np.exp(cv * x)
    wd = wd / wd.sum() * R
    b = np.concatenate([[0.0], np.cumsum(wd)])
    b[-1] = float(R)
    return b, wd


def taper_rings(sp, tile_u):
    return max(4, int(round(sp["taper"] * tile_u)))


def wood_phase(h, w, tile_u, tile_v, sp, seed):
    """Ring-number field of a flat-sawn board, grain along U (rings are its iso-lines).

    Physical model: across the board, the cut alternately approaches and leaves the pith (zones
    every sp['zone'] m). The across-grain ring density is a smoothed sign function
    g = tanh(d / D) of the signed distance d to the nearest zone centre, where D is the depth of
    the pith below the surface there; integrating g across V gives the ring number. Where D
    changes along the grain the rings near a zone centre surface one after another, which draws
    nested cathedral arches. The log's taper adds P rings along the tile (about 10 rings
    per metre: a 3-4 degree grain run-out), which keeps the ring field monotonic along U near the zone centres, so the arches
    stay open instead of closing into 'eyes'. Between zones the grain runs straight. The field is
    periodic in V (the per-column mean of g is removed so the integral closes) and periodic in U
    modulo P rings (the ring table repeats every P rings)."""
    rng = np.random.default_rng(seed + 900)
    sh = (h, w)
    _, v = grid(h, w)
    m = max(1, int(round(tile_v / sp["zone"])))
    # irregular zone spacing: a monotonic periodic warp of V
    ws = v.astype(np.float64)
    for j in (1, 2, 3):
        a = rng.uniform(-0.05, 0.05) / j
        ws = ws + a * np.sin(2 * math.pi * (j * v + rng.random()))
    ph = 2 * math.pi * m * ws
    zd = np.sin(ph) * tile_v / (2 * math.pi * m)                  # ~ signed distance to a centre (m)
    D = sp["D"] * np.exp(sp["D_sd"] * pnoise(sh, seed + 901, tile_u, tile_v, *sp["D_c"], beta=2.4))
    D = np.maximum(D, 0.012)
    g = np.tanh(zd / D)
    g = g - g.mean(axis=0, keepdims=True)
    dv = tile_v / h
    phi = np.cumsum(g, axis=0) * dv / sp["ring"]
    ref = int(np.argmax(np.sin(ph[:, 0])))                         # straight grain mid-flank
    phi = phi - phi[ref:ref + 1, :]
    wob = pnoise(sh, seed + 902, tile_u, tile_v, 1.0, 5.0, beta=2.6)
    wob2 = pnoise(sh, seed + 903, tile_u, tile_v, 3.0, 24.0, beta=2.2)
    u, _ = grid(h, w)
    phi = phi + sp["wob"] * wob + 0.1 * wob2 + taper_rings(sp, tile_u) * u
    return phi.astype(np.float64)


def wood(h, w, tile_u, sp, seed, tile_v=None):
    """A slab of polished wood, grain along U. Returns (colour lin, roughness, height m).
    tile_u / tile_v = metres covered along U / V. Rings come from wood_phase (cathedral arches
    between straight grain); every ring has its own width, latewood share and darkness, a soft
    earlywood -> latewood ramp and a crisp outer boundary. Colour adds narrow mineral and light
    streaks running with the grain, fibre lines, pores (ring-porous species line the earlywood),
    mahogany ribbon stripe and oak ray fleck."""
    tile_v = tile_v or tile_u
    sh = (h, w)
    rng = np.random.default_rng(seed)

    def nz(s, cu, cv=None, beta=None):
        return pnoise(sh, seed + s, tile_u, tile_v, cu, cv, beta)

    phi = wood_phase(h, w, tile_u, tile_v, sp, seed)
    R = taper_rings(sp, tile_u)
    phm = np.mod(phi, R)
    gy, gx = np.gradient(phi)
    gpx = np.hypot(gx, gy)                                        # rings per pixel
    spread = gpx / ((tile_v / h) / sp["ring"])                    # 1 = nominal density
    b, wd = _ring_table(R, rng, sp["ring_cv"])
    k = np.clip(np.searchsorted(b, phm, side="right") - 1, 0, R - 1)
    t = ((phm - b[k]) / wd[k]).astype(F32)
    aa = np.clip(gpx / wd[k] * 1.2, 0.02, 0.6).astype(F32)
    rr = rng.random((3, R)).astype(F32)
    lf = sp["late_frac"] * (0.6 + 0.8 * rr[0][k])
    late = ss(1 - 1.5 * lf, 1 - 0.25 * lf, t) * ss(0.0, aa, 1 - t)     # soft onset, crisp end
    lk = 0.6 + 0.6 * rr[1][k] + 0.25 * nz(14, 1.5, 30.0, beta=2.0)    # each ring varies along the board
    late = late * sp["late_k"] * np.clip(lk, 0.3, 1.5) * (0.55 + 0.45 * ss(0.03, 0.25, spread))
    early_zone = (1 - ss(0.0, 0.28, t)) * ss(0.0, aa, t + 0.02)

    col = mix(np.broadcast_to(hex_lin(sp["early"]), (h, w, 3)), hex_lin(sp["late"]), late)
    # broad heartwood bands along the grain (very long, gentle), narrow mineral / light streaks
    band = nz(4, 0.45, 5.0, beta=2.4)
    col *= (1 + 0.07 * band)[..., None]
    st = nz(5, 0.9, 40.0, beta=2.0)
    col = mix(col, hex_lin(sp["streak"]), ss(1.0, 2.6, st) * 0.2 * sp["streaks"])
    col = mix(col, hex_lin(sp["light"]), ss(1.2, 2.8, -st) * 0.12 * sp["streaks"])
    tone = nz(6, 1.4, 4.0, beta=2.4)
    col *= (1 + 0.035 * tone)[..., None]
    if sp.get("purple"):
        hue = nz(7, 0.8, 10.0, beta=2.2)          # walnut's grey-violet heartwood streaks
        col *= np.dstack([1 - 0.04 * hue, 1 - 0.05 * hue, 1 + 0.03 * hue]) ** sp["purple"]
    fib = nz(8, 14.0, 700.0, beta=1.6)            # fibre lines along the grain
    fib2 = nz(9, 50.0, 1500.0)
    col *= (1 + 0.045 * fib + 0.025 * fib2)[..., None]
    # pores: short dark dashes; ring-porous species line the earlywood with big ones
    pn = nz(10, 500.0, 2400.0)
    pores = ss(sp["pores"], sp["pores"] + 0.8, pn)
    if sp["ring_porous"] > 0:
        pn2 = nz(11, 320.0, 2400.0)
        big = ss(0.9, 1.7, pn2) * early_zone
        pores = np.maximum(pores * (1 - 0.6 * sp["ring_porous"]), big * sp["ring_porous"])
    rough = sp["rough"] + 0.012 * tone - 0.02 * late
    hgt = 1.2e-5 * late + 3e-6 * fib + 1.5e-6 * fib2
    if sp["figure"]:
        # mahogany ribbon stripe: interlocked grain, bands that catch the light differently
        nrib = max(1, int(round(R / 6.0)))                        # whole periods per taper cycle (seamless)
        rib = np.sin(2 * math.pi * (phi * nrib / R + 0.4 * nz(12, 0.6, 3.0, beta=2.4)))
        col *= (1 + 0.07 * sp["figure"] * rib)[..., None]
        rough = rough + 0.025 * sp["figure"] * rib
    if sp["rays"]:
        # oak medullary rays: in flat-sawn oak, thin dark-edged flecks 1-5 mm along the grain,
        # brighter where the cut runs nearer the radius (the flanks of the arches)
        rn = nz(13, 160.0, 1100.0)
        rays = ss(2.1, 2.7, rn) * sp["rays"] * ss(0.4, 0.9, spread)
        col = mix(col, hex_lin(sp["light"]) * 1.05, rays * 0.35)
        rough = rough - 0.04 * rays
        hgt = hgt + 0.8e-5 * rays
    col = mix(col, hex_lin(sp["pore"]), pores * 0.75)
    rough = rough + 0.06 * pores
    hgt = hgt - 4e-5 * pores
    return col.astype(F32), np.clip(rough, 0.05, 1.0).astype(F32), hgt.astype(F32)


def gen_wood(name):
    sp = SPECIES[name]
    n = 2048
    tile = WOOD_TILE[name]
    col, rough, hgt = wood(n, n, tile, sp, seed={"walnut": 11, "mahogany": 23, "oak": 37}[name])
    col = fit_mean(col, fit_target(name))
    return dict(color=col, rough=rough, height=hgt, px=tile / n, relief=1.0)


def gen_oak_tabletop():
    """Glued-up oak top: 6 planks 0.2 m wide across V, grain along U, satin finish."""
    n, tile = 2048, 1.2
    sp = dict(SPECIES["oak"], rough=0.27, ring_porous=0.7, rays=0.6, cath=5.0)
    srcs = [wood(n // 2, n, tile, sp, seed=101 + i, tile_v=0.6) for i in range(3)]
    r = np.random.default_rng(7)
    col = np.zeros((n, n, 3), F32)
    rough = np.zeros((n, n), F32)
    hgt = np.zeros((n, n), F32)
    planks = 6
    edges = np.linspace(0, n, planks + 1).astype(int)
    for p in range(planks):
        a, b = edges[p], edges[p + 1]
        s = srcs[p % 3]
        off_v = int(r.integers(0, n // 2))
        off_u = int(r.integers(0, n))
        rows = (np.arange(b - a) + off_v) % (n // 2)
        if r.random() < 0.5:
            rows = rows[::-1]
        cols = (np.arange(n) + off_u) % n
        tone = 0.92 + 0.16 * r.random()
        warm = 0.97 + 0.06 * r.random()
        col[a:b] = s[0][rows][:, cols] * tone * np.array([warm, 1.0, 2 - warm], F32)
        rough[a:b] = s[1][rows][:, cols] + (r.random() - 0.5) * 0.03
        hgt[a:b] = s[2][rows][:, cols]
    # glue lines: a hairline darker seam and a whisper of a groove
    pv = (np.arange(n, dtype=F32) + 0.5) / n * planks
    d = np.abs(pv - np.round(pv)) * (n / planks)
    seam = (1 - ss(0.0, 1.4, d))[:, None]
    col *= (1 - 0.4 * seam)[..., None]
    hgt -= 2e-5 * seam
    rough += 0.05 * seam
    col = fit_mean(col, fit_target("oak_tabletop"))
    return dict(color=col, rough=np.clip(rough, 0.18, 0.6), height=hgt, px=tile / n, relief=1.0)


def gen_parquet():
    """True herringbone of oak blocks (75 x 377 mm, ratio 5:1; sized so the pattern repeats
    exactly in the 1.6 m tile: 15 x 3 lattice cells), fine bevelled joints, per-block tone."""
    n, tile = 2048, 1.6
    wb = tile / (15 * math.sqrt(2))   # block width  0.0754 m
    lb = tile / (3 * math.sqrt(2))    # block length 0.3771 m
    src_n = 1024
    sp = dict(SPECIES["oak"], rough=0.3, cath=2.5, mean=1.0, late_k=0.55)
    srcs = [wood(src_n, src_n, 0.8, sp, seed=211 + i) for i in range(3)]
    src = [np.dstack([s[0], s[1][..., None], s[2][..., None]]) for s in srcs]
    u, v = grid(n, n)
    U, V = full(u * tile, v * tile)
    c = s_ = 1 / math.sqrt(2)
    bx = c * U - s_ * V
    by = s_ * U + c * V
    a0 = np.floor((bx + by) / (2 * wb)).astype(np.int64)
    b0 = np.floor((by - bx) / (2 * lb)).astype(np.int64)
    S = np.zeros((n, n), F32)
    T = np.zeros((n, n), F32)
    BI = np.zeros((n, n), np.int64)
    for di in range(-3, 3):
        for dj in range(-2, 2):
            i = a0 + di
            j = b0 + dj
            qx = bx - (i * wb - j * lb)
            qy = by - (i * wb + j * lb)
            H = (qx >= 0) & (qx < lb) & (qy >= 0) & (qy < wb)
            Vb = (qx >= -wb) & (qx < 0) & (qy >= 0) & (qy < lb)
            ident = ((i % 15) * 3 + (j % 3)) * 2
            S = np.where(H, qx, np.where(Vb, qy, S))
            T = np.where(H, qy, np.where(Vb, qx + wb, T))
            BI = np.where(H, ident, np.where(Vb, ident + 1, BI))
    nb = 15 * 3 * 2
    r = np.random.default_rng(5)
    off_s = r.random(nb) * 0.8
    off_t = r.random(nb) * 0.8
    which = r.integers(0, 3, nb)
    tone = 0.86 + 0.26 * r.random(nb) ** 1.3
    warm = 0.95 + 0.1 * r.random(nb)
    rough_off = (r.random(nb) - 0.5) * 0.05
    flip = r.random(nb) < 0.5
    ss_ = np.where(flip[BI], lb - S, S)
    sx = (ss_ + off_s[BI]) / 0.8 * src_n
    sy = (T + off_t[BI]) / 0.8 * src_n
    out = np.zeros((n, n, 5), F32)
    for k in range(3):
        m = which[BI] == k
        if m.any():
            out[m] = sample(src[k], sx[m], sy[m])
    col = out[..., :3] * tone[BI][..., None] * np.stack([warm[BI], np.ones_like(S), 2 - warm[BI]], -1)
    rough = out[..., 3] + rough_off[BI]
    hgt = out[..., 4]
    # joints: micro-bevel + hairline gap
    e = np.minimum(np.minimum(S, lb - S), np.minimum(T, wb - T))
    px = tile / n
    gap = 1 - ss(0.0, 0.9 * px, e - 0.25 * px)
    bev = 1 - ss(0.0, 1.6e-3, e)
    hgt = hgt - 3e-4 * bev ** 1.5 - 4e-4 * gap
    col *= (1 - 0.25 * bev - 0.55 * gap)[..., None]
    rough = rough + 0.15 * gap + 0.05 * bev
    col = fit_mean(col, fit_target("parquet_herringbone"))
    return dict(color=col, rough=np.clip(rough, 0.15, 0.8), height=hgt, px=px, relief=1.0)


def gen_oak_boards():
    """Staggered oak floor boards: 14 rows (0.143 m) across V, random butt joints along U."""
    n, tile = 2048, 2.0
    rows = 14
    sp = dict(SPECIES["oak"], rough=0.38, cath=6.5)
    srcs = [wood(n, n, tile, sp, seed=301 + i) for i in range(3)]
    r = np.random.default_rng(11)
    col = np.zeros((n, n, 3), F32)
    rough = np.zeros((n, n), F32)
    hgt = np.zeros((n, n), F32)
    edge = np.zeros((n, n), F32)
    edges = np.round(np.linspace(0, n, rows + 1)).astype(int)
    xs = np.arange(n)
    prev = []
    for k in range(rows):
        a, b = edges[k], edges[k + 1]
        while True:
            m = int(r.integers(1, 3))
            js = np.sort(r.random(m)) * n
            ok = all(abs(((x - y + n / 2) % n) - n / 2) > n * 0.12 for x in js for y in prev)
            gaps = np.diff(np.concatenate([js, [js[0] + n]]))
            if ok and gaps.min() > n * 0.25:
                break
        prev = list(js)
        seg = np.searchsorted(js, xs, side="right") % m
        dj = np.min(np.abs(((xs[None, :] - js[:, None]) + n / 2) % n - n / 2), axis=0)
        for s in range(m):
            cols_ = seg == s
            src = srcs[int(r.integers(0, 3))]
            ou, ov = int(r.integers(0, n)), int(r.integers(0, n))
            rr = (np.arange(a, b) + ov) % n
            cc = (xs[cols_] + ou) % n
            tone = 0.88 + 0.22 * r.random()
            warm = 0.96 + 0.08 * r.random()
            col[a:b][:, cols_] = src[0][rr][:, cc] * tone * np.array([warm, 1, 2 - warm], F32)
            rough[a:b][:, cols_] = src[1][rr][:, cc] + (r.random() - 0.5) * 0.04
            hgt[a:b][:, cols_] = src[2][rr][:, cc]
        dv = np.minimum(np.arange(a, b) - a + 0.5, b - np.arange(a, b) - 0.5)[:, None]
        edge[a:b] = np.minimum(dv, dj[None, :] + 0.5)
    px = tile / n
    gap = 1 - ss(0.3, 1.3, edge)
    bev = 1 - ss(0.0, 2.2, edge)
    col *= (1 - 0.6 * gap - 0.15 * bev)[..., None]
    hgt = hgt - 5e-4 * gap - 2e-4 * bev
    rough = rough + 0.15 * gap
    col = fit_mean(col, fit_target("oak_boards"))
    return dict(color=col, rough=np.clip(rough, 0.15, 0.85), height=hgt, px=px, relief=1.0)


# ---------------------------------------------------------------------------
# Stone, marble, plaster
# ---------------------------------------------------------------------------

def stone_face(h, w, tile_u, tile_v, seed, calm=1.0):
    """Fine dressed limestone surface (no joints). Returns (lightness field ~1, hue field,
    roughness, height m, pits). Feature sizes are in metres, independent of the tile."""
    def nz(s, per_m_u, per_m_v=None, beta=None):
        return pnoise((h, w), seed + s, tile_u, tile_v, per_m_u, per_m_v, beta)
    clouds = nz(1, 1.6, beta=2.6)
    mid = nz(2, 9, beta=2.2)
    fine = nz(3, 260)
    grit = nz(4, 520)
    bed = nz(5, 0.8, 22, beta=2.0)          # faint horizontal bedding
    spk = nz(6, 300)
    spk2 = nz(7, 140)
    hue = nz(8, 1.2, beta=2.6)
    cm = nz(10, 40, beta=1.8)               # centimetre-scale mottling
    light = (1 + calm * (0.06 * clouds + 0.035 * mid) + 0.03 * cm + 0.03 * fine + 0.02 * grit
             + 0.035 * ss(0.8, 2.2, bed) - 0.03 * ss(0.8, 2.2, -bed))
    dark_spk = ss(2.3, 3.1, spk)            # tiny iron/shell flecks
    light_spk = ss(2.1, 3.0, -spk2) * 0.8   # little calcite / shell grains
    light = light * (1 - 0.25 * dark_spk) * (1 + 0.08 * light_spk)
    pits = ss(2.7, 3.5, nz(9, 180))
    rough = 0.8 + 0.03 * fine + 0.025 * clouds + 0.08 * pits
    hgt = 0.7e-4 * fine + 0.35e-4 * grit + 3e-4 * mid + 1.0e-4 * cm - 6e-4 * pits
    return light.astype(F32), hue.astype(F32), rough.astype(F32), hgt.astype(F32), pits


def gen_limestone():
    n, tile = 1024, 1.5
    light, hue, rough, hgt, _ = stone_face(n, n, tile, tile, 400, calm=0.6)
    base = hex_lin("#d9c8a8")
    col = light[..., None] * base * np.dstack([1 + 0.03 * hue, 1 + 0.005 * hue, 1 - 0.04 * hue])
    col = fit_mean(col, fit_target("limestone"))
    return dict(color=col, rough=np.clip(rough, 0.6, 0.98), height=hgt, px=tile / n, relief=1.0)


def gen_limestone_ashlar():
    """Coursed ashlar: 0.6 m courses of 1.2 m blocks in running bond, 6 mm recessed lime joints.
    Every block is cut from a different part of the stone (its own sample of the face, tone,
    warmth, mottling strength, bedding and shell content), with a slightly pillowed face, eased
    and chipped arrises, a little patina along its joints and a light lime mortar."""
    n, tile = 2048, 2.4
    px = tile / n
    sh = (n, n)
    light, hue, rough, hgt, pits = stone_face(n, n, tile, tile, 500, calm=0.5)
    u, v = grid(n, n)
    U, V = full(u * tile, v * tile)
    course = np.floor(V / 0.6).astype(np.int64)            # 0..3
    off = (course % 2) * 0.6
    Us = (U + off) % tile
    bi = np.floor(Us / 1.2).astype(np.int64)                # 0..1
    sx = Us - bi * 1.2
    sy = V - course * 0.6
    block = course * 2 + bi
    nb = 8
    r = np.random.default_rng(12)
    shifts = r.integers(0, n, (nb, 2))
    L2, H2, R2, P2, Q2 = (np.empty_like(light) for _ in range(5))
    bedn = pnoise(sh, 520, tile, tile, 0.6, 30.0, beta=2.0)
    shell = ss(2.2, 3.0, pnoise(sh, 521, tile, tile, 90.0))
    tone = 1 + 0.055 * np.clip(r.standard_normal(nb), -1.6, 1.6)
    warmth = 0.026 * np.clip(r.standard_normal(nb), -1.5, 1.5)
    grey = (r.random(nb) < 0.4) * (0.05 + 0.08 * r.random(nb))     # a few blocks from a greyer bed
    mott = 0.7 + 0.8 * r.random(nb)
    bed_amp = np.where(r.random(nb) < 0.5, 0.0, 0.02 + 0.03 * r.random(nb))
    shell_amp = r.random(nb) ** 2
    tool_ang = (r.random(nb) - 0.5) * 0.6 + math.pi / 2
    for b in range(nb):
        m = block == b
        dy, dx = int(shifts[b, 0]), int(shifts[b, 1])
        L2[m] = 1 + (np.roll(light, (dy, dx), (0, 1))[m] - 1) * mott[b]
        H2[m] = np.roll(hgt, (dy, dx), (0, 1))[m]
        R2[m] = np.roll(rough, (dy, dx), (0, 1))[m]
        P2[m] = np.roll(hue, (dy, dx), (0, 1))[m]
        bed_b = np.roll(bedn, (dy, dx), (0, 1))[m]
        sh_b = np.roll(shell, (dy, dx), (0, 1))[m]
        L2[m] *= (1 + bed_amp[b] * ss(0.6, 2.0, bed_b) - 0.7 * bed_amp[b] * ss(0.8, 2.2, -bed_b)) * (1 + 0.07 * shell_amp[b] * sh_b)
        Q2[m] = sh_b * shell_amp[b]
    e = np.minimum(np.minimum(sx, 1.2 - sx), np.minimum(sy, 0.6 - sy))   # metres to the joint line
    jw = 0.003
    chipn = pnoise(sh, 513, tile, tile, 60.0)
    chip = ss(1.5, 2.3, chipn) * (1 - ss(jw + 0.002, jw + 0.011, e))
    joint = 1 - ss(jw - 0.6 * px, jw + 0.6 * px, e)
    ease = 1 - ss(jw, jw + 0.005, e)                        # rounded arris
    lt = L2 * tone[block]
    # patina: a breath of grime within a few cm of the joints, more under each block's bed
    lt *= 1 - 0.035 * (1 - ss(jw, jw + 0.035, e)) - 0.025 * (1 - ss(0.0, 0.08, sy))
    lt *= 1 + 0.035 * ease * (1 - joint)                     # worn, lighter arris
    pillow = (1 - (2 * sx / 1.2 - 1) ** 8) * (1 - (2 * sy / 0.6 - 1) ** 8)
    ta = tool_ang[block]
    tool = np.sin((sx * np.cos(ta) + sy * np.sin(ta)) * (2 * math.pi / 0.004) + 3 * pnoise(sh, 517, tile, tile, 3.0))
    face_h = H2 + 1.2e-3 * pillow + 4e-5 * tool * (0.6 + 0.4 * pnoise(sh, 518, tile, tile, 2.5, beta=2.0))
    face_h = face_h - 2.2e-3 * ease ** 2 - 2.5e-3 * chip
    mortar_h = -5e-3 + 3e-4 * pnoise(sh, 515, tile, tile, 120.0)
    height = lerp(face_h, mortar_h, joint)
    base = hex_lin("#d8c6a4")
    w = warmth[block]
    col = lt[..., None] * base * np.dstack([1 + 0.03 * P2 + w, 1 + 0.005 * P2, 1 - 0.04 * P2 - 1.2 * w])
    lum = (col * np.array([0.3, 0.55, 0.15], F32)).sum(-1, keepdims=True)
    col = mix(col, np.broadcast_to(lum * np.array([0.97, 1.0, 1.04], F32), col.shape), grey[block])
    col = mix(col, base * 1.07, chip * 0.55)
    col = mix(col, hex_lin("#e6dcc8"), Q2 * 0.25)
    mortar = hex_lin("#cbbfa8") * (0.9 + 0.06 * pnoise(sh, 516, tile, tile, 80.0))[..., None]
    col = mix(col, mortar, joint)
    occl = np.clip(cavity(height, 3.0) * 160, 0, 0.32)
    col *= (1 - occl)[..., None]
    rough = lerp(R2 + 0.03 * (tone[block] - 1), 0.93, joint)
    col = fit_mean(col, fit_target("limestone_ashlar"))
    return dict(color=col, rough=np.clip(rough, 0.55, 0.98), height=height, px=px, relief=1.0)


def gen_stone_tiles():
    """Pale stone floor tiles 0.6 m (2 x 2 in the 1.2 m tile), 3 mm grout, honed, worn."""
    n, tile = 1024, 1.2
    px = tile / n
    light, hue, rough, hgt, _ = stone_face(n, n, tile, tile, 600, calm=0.6)
    u, v = grid(n, n)
    U, V = full(u * tile, v * tile)
    sx, sy = U % 0.6, V % 0.6
    t_id = (np.floor(V / 0.6) * 2 + np.floor(U / 0.6)).astype(np.int64)
    e = np.minimum(np.minimum(sx, 0.6 - sx), np.minimum(sy, 0.6 - sy))
    r = np.random.default_rng(14)
    tone = 0.88 + 0.2 * r.random(4)
    warmth = (r.random(4) - 0.5) * 0.09
    gw = 0.0015
    grout = 1 - ss(gw - 0.6 * px, gw + 0.6 * px, e)
    bev = 1 - ss(gw, gw + 0.0025, e)
    wear = noise((n, n), 601, 2.5 * tile, beta=2.5)
    lt = light * tone[t_id] * (1 + 0.02 * wear)
    base = hex_lin("#c4b8a4")
    col = lt[..., None] * base * np.dstack([1 + 0.03 * hue + warmth[t_id], np.ones_like(hue), 1 - 0.04 * hue - warmth[t_id]])
    g = hex_lin("#a59a88") * (0.9 + 0.05 * noise((n, n), 602, 250 * tile))[..., None]
    col = mix(col, g, grout)
    height = lerp(hgt * 0.6 - 4e-4 * bev ** 2, -2.5e-3, grout)
    rough = lerp(rough - 0.2 - 0.04 * wear, 0.9, grout)
    col = fit_mean(col, fit_target("stone_tiles"))
    return dict(color=col, rough=np.clip(rough, 0.35, 0.95), height=height, px=px, relief=1.0)


def _vor_edge(X, Y, cell, seed, jitter=0.85):
    """Distance (m) to the nearest Voronoi edge of jittered points on a `cell` grid, at arbitrary
    (e.g. warped) coordinates in metres: a crack / fracture network."""
    gx, gy = X / cell, Y / cell
    ix0, iy0 = np.floor(gx).astype(np.int64), np.floor(gy).astype(np.int64)
    N = 4096
    rng = np.random.default_rng(seed)
    jx, jy = rng.random(N).astype(F32), rng.random(N).astype(F32)
    d1 = np.full(X.shape, 1e9, F32)
    d2 = np.full(X.shape, 1e9, F32)
    p1x = np.zeros(X.shape, F32)
    p1y = np.zeros(X.shape, F32)
    p2x = np.zeros(X.shape, F32)
    p2y = np.zeros(X.shape, F32)
    for dj in (-1, 0, 1):
        for di in (-1, 0, 1):
            ix, iy = ix0 + di, iy0 + dj
            h_ = (ix * 73856093 ^ iy * 19349663) % N
            px_ = ix + 0.5 + (jx[h_] - 0.5) * jitter
            py_ = iy + 0.5 + (jy[h_] - 0.5) * jitter
            d = (gx - px_) ** 2 + (gy - py_) ** 2
            c1 = d < d1
            c2 = (~c1) & (d < d2)
            d2 = np.where(c1, d1, np.where(c2, d, d2))
            p2x = np.where(c1, p1x, np.where(c2, px_, p2x))
            p2y = np.where(c1, p1y, np.where(c2, py_, p2y))
            d1 = np.where(c1, d, d1)
            p1x = np.where(c1, px_, p1x)
            p1y = np.where(c1, py_, p1y)
    sep = np.sqrt((p2x - p1x) ** 2 + (p2y - p1y) ** 2) + 1e-6
    return ((d2 - d1) / (2 * sep) * cell).astype(F32)


def _marble_square(size_m, n, seed, dark):
    """One polished marble slab (n x n px over size_m). Veins are iso-lines of a domain-warped
    stripe field (q), so they meander, swell and thin naturally instead of branching like roots.
    Dark = Nero Marquina (bold white calcite veins in sub-parallel sets, a fine white web between
    them, faint ghost veins in a cloudy black ground). Light = Botticino (soft beige veins,
    jagged stylolite seams, fossil fragments in a cloudy cream ground)."""
    sh = (n, n)
    px = size_m / n
    rng = np.random.default_rng(seed)
    u, v = grid(n, n)
    X, Y = full(u * size_m, v * size_m)

    def field(s, ang, amp, wc, det, det_c):
        wx = noise(sh, s, wc, beta=2.6)
        wy = noise(sh, s + 1, wc, beta=2.6)
        q = (X + amp * wx) * math.cos(ang) + (Y + amp * wy) * math.sin(ang)
        q = q + det * noise(sh, s + 2, det_c, beta=1.7)
        gy, gx = np.gradient(q)
        return q, np.maximum(np.hypot(gx, gy) / px, 0.25)

    def vein(q, g, level, w0, s, wc=2.5):
        d = np.abs(q - level) / g
        wv = w0 * (0.18 + 1.25 * ss(-1.3, 1.5, noise(sh, s, wc, beta=2.2)))
        core = np.clip((wv / 2 - d) / px + 0.5, 0, 1)
        return core, d, wv

    def family(q, g, spacing, w0, s, ph):
        f = np.mod(q / spacing + ph, 1.0)
        d = np.abs(f - 0.5) * spacing / g
        wv = w0 * (0.3 + 1.0 * ss(-1.0, 1.5, noise(sh, s, 3.0, beta=2.2)))
        return np.clip((wv / 2 - d) / px + 0.5, 0, 1), d

    def web(s, c, wpx, mask):
        nn = noise(sh, s, c, beta=1.9)
        gy, gx = np.gradient(nn)
        return np.exp(-(np.abs(nn) / (np.hypot(gx, gy) * wpx + 1e-4)) ** 2) * mask

    cl = noise(sh, seed + 10, 2.0, beta=2.8)
    mid = noise(sh, seed + 11, 7.0, beta=2.2)
    grain = noise(sh, seed + 12, 300)
    ang = rng.uniform(0, math.pi)
    q, g = field(seed + 20, ang, 0.06, 2.0, 0.0035, 28)
    lo, hi = np.percentile(q, 6), np.percentile(q, 94)
    rough = 0.065 + 0.01 * cl
    if dark:
        # Nero Marquina: veins are healed fractures. Two or three long main veins (iso-lines of a
        # gently warped plane field, jagged at the mm scale, swelling, pinching and breaking),
        # a warped Voronoi crack network that branches off them, and a hairline web; crisp
        # calcite edges with a thin smoky halo, in a cloudy near-black ground.
        c = ramp(0.5 + 0.28 * cl + 0.1 * mid, [(0, "#070708"), (0.55, "#101011"), (1, "#1c1b1a")])
        gq, gg = field(seed + 30, ang + 0.35, 0.05, 1.6, 0.004, 14)
        gh, _ = family(gq, gg, 0.16, 0.03, seed + 31, rng.random())
        c = mix(c, hex_lin("#262422"), blur(gh, 6) * 0.5)                 # smoky ghost veins
        qm, gm = field(seed + 20, ang, 0.022, 1.8, 0.0006, 45)
        lo_m, hi_m = np.percentile(qm, 8), np.percentile(qm, 92)
        cores = np.zeros(sh, F32)
        dmin = np.full(sh, 9.0, F32)
        for i, f in enumerate(np.sort(rng.uniform(0.15, 0.85, 2 + int(rng.random() < 0.5)))):
            level = lo_m + (hi_m - lo_m) * f
            d = np.abs(qm - level) / gm
            wmod = noise(sh, seed + 40 + i, 3.5, beta=2.0)
            wv = (0.0012 + 0.0042 * ss(-1.2, 1.4, wmod)) * (0.25 + 0.75 * (i == 0)) * ss(-1.6, -0.6, wmod)
            cores = np.maximum(cores, np.clip((wv / 2 - d) / px + 0.5, 0, 1))
            dmin = np.minimum(dmin, d)
        Xw = X + 0.012 * noise(sh, seed + 50, 2.5, beta=2.4) + 0.0008 * noise(sh, seed + 51, 40, beta=1.6)
        Yw = Y + 0.012 * noise(sh, seed + 52, 2.5, beta=2.4) + 0.0008 * noise(sh, seed + 53, 40, beta=1.6)
        ed = _vor_edge(Xw, Yw, 0.075, seed + 54)
        near = np.exp(-(dmin / 0.09) ** 2)
        show = ss(0.35, 1.3, noise(sh, seed + 55, 4.0, beta=2.2) + 1.4 * near)
        wc = 0.00035 + 0.0007 * ss(0.0, 1.5, noise(sh, seed + 56, 6.0, beta=2.0))
        crack = np.clip((wc / 2 - ed) / px + 0.5, 0, 1) * show
        ed2 = _vor_edge(Xw * 1.0 + 0.3, Yw, 0.024, seed + 57)
        hair = np.clip((0.00012 - ed2) / px + 0.5, 0, 1) * ss(0.2, 1.2, noise(sh, seed + 58, 3.0, beta=2.2) + near)
        halo = np.exp(-(dmin / 0.004) ** 2) * (1 - cores)
        c = mix(c, hex_lin("#34312d"), halo * 0.4)
        c = mix(c, hex_lin("#8d8880"), hair * 0.4)
        cv = mix(np.broadcast_to(hex_lin("#eeeae2"), sh + (3,)), hex_lin("#d4cec2"), ss(-1, 1, noise(sh, seed + 65, 18)))
        c = mix(c, cv * 0.92, crack * 0.85)
        c = mix(c, cv, cores)
        lines = np.maximum(cores, crack * 0.8)
    else:
        c = ramp(0.5 + 0.25 * cl + 0.12 * mid, [(0, "#d5c6aa"), (0.5, "#e4d8c1"), (1, "#efe7d6")])
        patches = ss(-0.2, 1.2, noise(sh, seed + 25, 4, beta=2.4))
        c = mix(c, hex_lin("#d2be9b"), patches * 0.28)
        q, g = field(seed + 21, ang, 0.03, 1.6, 0.0015, 28)       # calmer, fewer closed loops
        lo, hi = np.percentile(q, 6), np.percentile(q, 94)
        cores = np.zeros(sh, F32)
        dmin = np.full(sh, 9.0, F32)
        for i, f in enumerate(np.sort(rng.uniform(0.1, 0.9, 4))):
            core, d, _ = vein(q, g, lo + (hi - lo) * f, (0.0016, 0.0009, 0.0022, 0.0012)[i], seed + 40 + i)
            cores = np.maximum(cores, core)
            dmin = np.minimum(dmin, d)
        halo = np.exp(-(dmin / 0.01) ** 2)
        c = mix(c, hex_lin("#cdb998"), halo * 0.3)
        c = mix(c, hex_lin("#a8947a"), cores * 0.6)
        # stylolites: jagged dark seams, Botticino's signature
        q3, g3 = field(seed + 70, ang + rng.uniform(-0.4, 0.4), 0.05, 1.8, 0.0, 10)
        q3 = q3 + 0.0018 * noise(sh, seed + 71, 90, beta=1.0)
        sty, _ = family(q3, g3, 0.21, 0.0007, seed + 72, rng.random())
        sty = sty * ss(-0.2, 0.7, noise(sh, seed + 73, 2.0, beta=2.2))
        c = mix(c, hex_lin("#8a7761"), sty * 0.6)
        wb = web(seed + 63, 6.0, 0.7, ss(0.0, 1.0, noise(sh, seed + 64, 2.5, beta=2.2)))
        c = mix(c, hex_lin("#f6f0e4"), wb * 0.18)
        specks = ss(2.5, 3.3, noise(sh, seed + 26, 240))
        c = mix(c, hex_lin("#b6a183"), specks * 0.45)
        clast = ss(2.0, 2.8, noise(sh, seed + 27, 40, beta=1.6))
        c = mix(c, hex_lin("#f3ecdc"), clast * 0.35)
        lines = np.maximum(cores * 0.6, sty * 0.6)
    c *= (1 + 0.012 * grain)[..., None]
    rough = rough + 0.03 * lines
    hgt = -6e-6 * lines + 1.5e-6 * grain
    return c.astype(F32), rough.astype(F32), hgt.astype(F32)


def gen_marble_checker():
    """2 x 2 polished marble squares (0.6 m): cream Botticino and Nero Marquina, 1 mm joints."""
    n, tile = 2048, 1.2
    px = tile / n
    half = n // 2
    col = np.zeros((n, n, 3), F32)
    rough = np.zeros((n, n), F32)
    hgt = np.zeros((n, n), F32)
    for q, (qi, qj) in enumerate(((0, 0), (1, 0), (0, 1), (1, 1))):
        dark = (qi + qj) % 2 == 1
        c, r_, h_ = _marble_square(0.6, half, 700 + 17 * q, dark)
        ys, xs = slice(qj * half, (qj + 1) * half), slice(qi * half, (qi + 1) * half)
        col[ys, xs] = c
        rough[ys, xs] = r_
        hgt[ys, xs] = h_
    u, v = grid(n, n)
    U, V = full(u * tile, v * tile)
    sx, sy = U % 0.6, V % 0.6
    e = np.minimum(np.minimum(sx, 0.6 - sx), np.minimum(sy, 0.6 - sy))
    gw = 0.0006
    joint = 1 - ss(gw - 0.6 * px, gw + 0.6 * px, e)
    bev = 1 - ss(gw, gw + 0.0012, e)
    col = mix(col, hex_lin("#5e574d"), joint)
    rough = lerp(rough + 0.04 * bev, 0.7, joint)
    hgt = lerp(hgt - 3e-4 * bev ** 2, -1.0e-3, joint)
    return dict(color=col, rough=np.clip(rough, 0.04, 0.9), height=hgt, px=px, relief=1.0)


def gen_plaster():
    """Lime plaster with a soft hand-trowelled finish: overlapping, slightly tilted trowel strokes,
    burnished where the steel passed, fine sand and the odd pinhole."""
    n, tile = 1024, 2.0
    px = tile / n
    r = np.random.default_rng(41)
    H = np.zeros((n, n), F32)
    B = np.zeros((n, n), F32)
    L = np.zeros((n, n), F32)
    for _ in range(420):
        cx, cy = r.random(2) * n
        ln = (0.12 + 0.3 * r.random()) / px
        wd = (0.05 + 0.08 * r.random()) / px
        ang = r.random() * math.pi
        rad = int(max(ln, wd) * 1.3) + 2
        xs = (np.arange(int(cx) - rad, int(cx) + rad) % n)
        ys = (np.arange(int(cy) - rad, int(cy) + rad) % n)
        dx = (np.arange(int(cx) - rad, int(cx) + rad) - cx)[None, :]
        dy = (np.arange(int(cy) - rad, int(cy) + rad) - cy)[:, None]
        a = dx * math.cos(ang) + dy * math.sin(ang)
        b = -dx * math.sin(ang) + dy * math.cos(ang)
        m = np.exp(-(np.abs(a / ln) ** 3 + np.abs(b / wd) ** 3) * 2.2)
        lvl = (r.random() - 0.5) * 2.5e-4
        tilt = (r.random(2) - 0.5) * 2.2e-4
        hs = lvl + tilt[0] * a / ln + tilt[1] * b / wd
        ix = np.ix_(ys, xs)
        H[ix] = lerp(H[ix], hs, m)
        B[ix] = lerp(B[ix], r.random(), m)
        L[ix] = lerp(L[ix], r.random() - 0.5, m)
    sand = noise((n, n), 42, 380)
    sand2 = noise((n, n), 43, 160)
    pin = ss(3.0, 3.6, noise((n, n), 44, 220))
    cl = noise((n, n), 45, 2.5, beta=2.6)
    height = blur(H, 1.0) + 2.5e-5 * sand + 2e-5 * sand2 - 2e-4 * pin
    lt = 1 + 0.02 * L + 0.018 * cl + 0.012 * sand2 - 0.08 * pin
    base = hex_lin("#e8dcc5")
    col = lt[..., None] * base * np.dstack([1 + 0.01 * cl, np.ones_like(cl), 1 - 0.015 * cl])
    rough = 0.88 - 0.12 * B ** 2 + 0.03 * sand + 0.05 * pin
    col = fit_mean(col, fit_target("plaster"))
    return dict(color=col, rough=np.clip(rough, 0.6, 0.98), height=height, px=px, relief=1.0)


# ---------------------------------------------------------------------------
# Drawing helpers (signed distances in metres, anti-aliased coverage)
# ---------------------------------------------------------------------------

def cov(d, px):
    """Coverage of the region d < 0 (anti-aliased over one pixel)."""
    return np.clip(0.5 - d / px, 0.0, 1.0).astype(F32)


def sd_circle(X, Y, cx, cy, r):
    return np.hypot(X - cx, Y - cy) - r


def sd_box(X, Y, cx, cy, hx, hy):
    qx = np.abs(X - cx) - hx
    qy = np.abs(Y - cy) - hy
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0)


def sd_diamond(X, Y, cx, cy, rx, ry):
    return (np.abs(X - cx) / rx + np.abs(Y - cy) / ry - 1) * (rx * ry / math.hypot(rx, ry))


def sd_ellipse(X, Y, cx, cy, rx, ry):
    return (np.hypot((X - cx) / rx, (Y - cy) / ry) - 1) * min(rx, ry)


def sd_rosette(X, Y, cx, cy, r, amp, lobes, phase=0.0):
    dx, dy = X - cx, Y - cy
    return np.hypot(dx, dy) - r * (1 + amp * np.cos(lobes * np.arctan2(dy, dx) + phase))


def sd_petals(X, Y, cx, cy, r, lobes, depth=0.35, phase=0.0, sharp=0.6):
    """Flower with rounded petals and pointed notches (|cos|^sharp profile)."""
    dx, dy = X - cx, Y - cy
    th = np.arctan2(dy, dx) * lobes / 2 + phase
    prof = (1 - depth) + depth * np.abs(np.cos(th)) ** sharp
    return (np.hypot(dx, dy) - r * prof) * 0.9


def sd_leaf(X, Y, cx, cy, ang, length, width, bend=0.0):
    """Lancet leaf from (cx, cy) pointing along ang, slightly curved."""
    ca, sa = math.cos(ang), math.sin(ang)
    a = (X - cx) * ca + (Y - cy) * sa
    b = -(X - cx) * sa + (Y - cy) * ca
    t = np.clip(a / length, 0, 1)
    b = b - bend * length * (t * t - t) * 4 * 0.5
    half = width / 2 * psin(math.pi * t) ** 0.75
    return np.where((a > 0) & (a < length), np.abs(b) - half, np.minimum(np.hypot(a, b), np.hypot(a - length, b)) + 1e-3)


def dome(d, r):
    """Height profile (0..1) of a rounded shape whose signed distance is d, rounding over r."""
    return np.sqrt(np.clip(1 - (1 + np.minimum(d, 0) / r) ** 2, 0, 1)) * (d < 0)


GOLD_STOPS = [(0.0, "#f3d68f"), (0.42, "#dcae58"), (0.72, "#a47731"), (1.0, "#5a3c17")]


def gilt_colour(cav):
    """Gold leaf albedo (metallic base colour) on a carved height field: bright on the crowns,
    deepening to umber in the hollows."""
    return ramp(np.clip(0.42 + cav, 0, 1), GOLD_STOPS)


# ---------------------------------------------------------------------------
# Ceiling coffer and ornament band
# ---------------------------------------------------------------------------

def _petal_layer(R, TH, n_p, r0, r1, width, phase, lift, rise, lobes, px):
    a = TH * n_p / (2 * math.pi) + phase
    f = a - np.round(a)
    lat = R * np.sin(f * 2 * math.pi / n_p)
    t = np.clip((R - r0) / (r1 - r0), 0, 1)
    env = width * psin(math.pi * np.clip(t, 0, 1) ** 0.75) ** 0.55
    env = env * (1 + 0.16 * lobes * np.cos(2 * math.pi * t * 3.0) * t)
    d = np.abs(lat) - env
    inside = (R > r0) & (R < r1)
    m = cov(np.where(inside, d, 1.0), px)
    across = np.sqrt(np.clip(1 - (lat / np.maximum(env, 1e-5)) ** 2, 0, 1))
    vein = np.exp(-(lat / 0.0022) ** 2) * (t > 0.1)
    hh = lift + width * 0.9 * across * (0.35 + 0.65 * psin(math.pi * t) ** 0.7) + rise * t ** 2 - 0.0025 * vein
    return m, hh.astype(F32)


def gen_coffer_panel():
    """One 1.4 m ceiling coffer: moulded frame (fillet, ogee with gilt leaf-and-dart, gilt beaded
    astragal) dropping to a painted field, a fine gilt inner rule with corner fleurons, and a
    carved gilt rosette in the centre. Field and frame are painted in a neutral value-only colour
    (the palette tint makes them teal or red); the gilt is a fixed gold with a metal mask."""
    n, tile = 1024, 1.4
    px = tile / n
    u, v = grid(n, n)
    X, Y = full((u - 0.5) * tile, (v - 0.5) * tile)
    R = np.hypot(X, Y)
    TH = np.arctan2(Y, X)
    s = np.maximum(np.abs(X), np.abs(Y))
    d = 0.70 - s
    side_p = np.where(np.abs(X) > np.abs(Y), Y, X)
    H = np.full((n, n), -0.03, F32)
    gilt = np.zeros((n, n), F32)
    H = np.where(d < 0.012, 0.0, H)
    t = np.clip((d - 0.012) / 0.04, 0, 1)
    og = -0.018 * (0.5 - 0.5 * np.cos(math.pi * t))
    q = ((side_p / 0.05) % 1.0) - 0.5
    leaf_w = 0.44 * psin(math.pi * np.clip(0.15 + t * 0.85, 0, 1)) ** 0.5 * (1 - 0.7 * t ** 1.5)
    leaf = cov(np.abs(q) - leaf_w, 0.02) * (t > 0) * (t < 1)
    dart = cov(np.abs(np.abs(q) - 0.5) - 0.06 * (1 - t), 0.02) * (t > 0.15) * (t < 0.95)
    leaf_h = 0.0045 * np.sqrt(np.clip(1 - (q / np.maximum(leaf_w, 1e-3)) ** 2, 0, 1)) * np.sin(math.pi * t)
    og_h = og + leaf * leaf_h + dart * 0.002 - 0.003 * (1 - leaf) * (1 - dart) * np.sin(math.pi * t)
    H = np.where((d >= 0.012) & (d < 0.052), og_h, H)
    gilt = np.where((d >= 0.012) & (d < 0.052), np.maximum(leaf * 0.95, dart * 0.95), gilt)
    gilt = np.where(d < 0.006, 1.0, gilt)                       # gilt outer fillet edge
    H = np.where((d >= 0.052) & (d < 0.058), -0.018, H)
    bt = np.clip((d - 0.058) / 0.026, 0, 1)
    qb = ((side_p / 0.04) % 1.0) - 0.5
    bead_len = np.where(np.abs(qb) < 0.32, np.sqrt(np.clip(1 - (qb / 0.32) ** 2, 0, 1)),
                        0.55 * np.sqrt(np.clip(1 - ((np.abs(qb) - 0.42) / 0.08) ** 2, 0, 1)))
    bead_h = -0.022 + 0.011 * np.sqrt(np.clip(1 - (2 * bt - 1) ** 2, 0, 1)) * (0.35 + 0.65 * bead_len)
    H = np.where((d >= 0.058) & (d < 0.084), bead_h, H)
    gilt = np.where((d >= 0.052) & (d < 0.084), 1.0, gilt)
    frame = (1 - ss(0.084, 0.092, d)).astype(F32)
    rule = cov(np.abs(s - 0.53) - 0.003, px)
    H = H + rule * 0.0015
    gilt = np.maximum(gilt, rule)
    for sxn in (-1, 1):
        for syn in (-1, 1):
            cx, cy = sxn * 0.46, syn * 0.46
            dd = sd_rosette(X, Y, cx, cy, 0.034, 0.32, 4, math.pi / 4)
            m = cov(dd, px)
            hh = -0.03 + 0.008 * dome(dd, 0.02) + 0.004 * dome(sd_circle(X, Y, cx, cy, 0.01), 0.01)
            H = np.where(m > 0, np.maximum(H, lerp(H, hh, m)), H)
            gilt = np.maximum(gilt, m)
    base = -0.03
    for args in ((16, 0.06, 0.255, 0.045, 0.0, base, 0.006, 1.0),
                 (12, 0.05, 0.19, 0.040, 0.5, base + 0.008, 0.008, 1.0),
                 (8, 0.04, 0.125, 0.036, 0.0, base + 0.018, 0.006, 0.6)):
        m, hh = _petal_layer(R, TH, *args, px=px)
        H = lerp(H, np.maximum(H, hh), m)
        gilt = np.maximum(gilt, m)
    bead_ring = (((TH / (2 * math.pi)) * 24) % 1.0) - 0.5
    br = np.hypot((R - 0.058) / 0.007, bead_ring / 0.38)
    bm = cov((br - 1) * 0.006, px)
    H = lerp(H, np.maximum(H, base + 0.03 + 0.006 * np.sqrt(np.clip(1 - br ** 2, 0, 1))), bm)
    boss = sd_circle(X, Y, 0, 0, 0.048)
    bmask = cov(boss, px)
    seeds = np.cos(TH * 21 + R * 260) * np.cos(R * 520)
    H = lerp(H, base + 0.034 + 0.016 * dome(boss, 0.048) + 0.0012 * seeds * (R < 0.045), bmask)
    gilt = np.clip(np.maximum(gilt, np.maximum(bm, bmask)), 0, 1)
    Hs = blur(H, 0.7)
    cav = cavity(Hs, 6.0) * 60
    # neutral paint: field with soft brush/age variation, frame ground a deeper shade of it
    fv = 0.5 * (1 + 0.07 * noise((n, n), 801, 3, beta=2.5) + 0.025 * noise((n, n), 802, 160))
    paintc = np.dstack([fv, fv, fv]) * (1 - 0.48 * frame)[..., None]
    paintc = fit_mean(paintc, fit_target("coffer_panel"), weight=1 - gilt)
    col = mix(paintc, gilt_colour(cav), gilt)
    col *= (1 - np.clip(cav * 0.5, 0, 0.4) * (1 - gilt))[..., None]
    rough = lerp(lerp(np.full((n, n), 0.68, F32), 0.55, frame), 0.24 + 0.12 * np.clip(cav, 0, 1), gilt)
    return dict(color=col.astype(F32), rough=rough.astype(F32), height=Hs, px=px, relief=0.6, metal=gilt * 0.95)


def gen_ornament_band():
    """Gilt frieze on a dark ground, repeating every 0.6 m along U; V spans the band (0.3 m):
    fillet, bead-and-reel, anthemion (palmettes + lotus on a running scroll), fillet,
    egg-and-dart, top fillet."""
    w, h = 1024, 512
    tile_u, tile_v = 0.6, 0.3
    pu, pv = tile_u / w, tile_v / h
    px = (pu + pv) / 2
    u, v = grid(h, w)
    X, Y = full(u * tile_u, v * tile_v)
    H = np.zeros((h, w), F32)
    G = np.zeros((h, w), F32)

    def put(mask, hh):
        nonlocal H, G
        H = lerp(H, np.maximum(H, hh), mask)
        G = np.maximum(G, mask)

    for y0, y1, hh in ((0.0, 0.012, 0.004), (0.172, 0.184, 0.004), (0.288, 0.3, 0.005)):
        m = cov(np.maximum(y0 - Y, Y - y1), px) if y0 > 0 else cov(Y - y1, px)
        if y1 >= 0.3:
            m = cov(y0 - Y, px)
        put(m, np.full_like(Y, hh))
    q = ((X / 0.03) % 1.0) - 0.5
    yb = (Y - 0.027) / 0.011
    bead = np.hypot(q / 0.34, yb)
    put(cov((bead - 1) * 0.008, px), 0.002 + 0.008 * np.sqrt(np.clip(1 - bead ** 2, 0, 1)))
    for c in (-0.44, 0.44):
        reel = np.hypot((q - c) / 0.05, yb / 0.75)
        put(cov((reel - 1) * 0.005, px), 0.002 + 0.005 * np.sqrt(np.clip(1 - reel ** 2, 0, 1)))
    xp = (X % 0.15) - 0.075
    base_y = 0.062
    dxp, dyp = xp, Y - base_y
    rp = np.hypot(dxp, dyp)
    ap = np.arctan2(dxp, dyp)
    for k in range(-3, 4):
        ang = k * 0.36
        ln = 0.098 - 0.011 * abs(k)
        aa = rp * np.cos(ap - ang)
        bb = rp * np.sin(ap - ang)
        tt = np.clip(aa / ln, 0, 1)
        env = 0.011 * psin(math.pi * tt ** 0.65) ** 0.8 * (aa > 0.004)
        dd = np.where((aa > 0) & (aa < ln), np.abs(bb) - env, 1.0)
        m = cov(dd, px)
        across = np.sqrt(np.clip(1 - (bb / np.maximum(env, 1e-5)) ** 2, 0, 1))
        put(m, 0.002 + 0.006 * across * (0.4 + 0.6 * tt) - 0.0012 * np.exp(-(bb / 0.0012) ** 2))
    cal = sd_ellipse(xp, Y, 0.0, base_y - 0.002, 0.016, 0.009)
    put(cov(cal, px), 0.003 + 0.006 * dome(cal, 0.009))
    for sgn in (-1, 1):
        cx = sgn * 0.024
        rr = np.hypot(xp - cx, Y - (base_y - 0.002))
        ring = np.abs(rr - 0.0085) - 0.0022
        put(cov(ring, px), 0.002 + 0.004 * dome(ring, 0.0022))
        put(cov(rr - 0.0035, px), 0.004 + 0.003 * dome(rr - 0.0035, 0.0035))
    sc = np.abs(Y - (base_y - 0.012 - 0.006 * np.cos(2 * math.pi * (X - 0.075) / 0.15))) - 0.0018
    put(cov(np.where((np.abs(xp) > 0.03), sc, 1.0), px), 0.003)
    xl = (X % 0.15) - np.where((X % 0.15) > 0.075, 0.15, 0.0)
    bud_y = (Y - 0.06) / 0.075
    bud_w = 0.010 * psin(math.pi * np.clip(bud_y, 0, 1) ** 0.8) * (1 - 0.35 * np.clip(bud_y, 0, 1))
    bud = np.where((bud_y > 0) & (bud_y < 1), np.abs(xl) - bud_w, 1.0)
    put(cov(bud, px), 0.003 + 0.007 * np.sqrt(np.clip(1 - (xl / np.maximum(bud_w, 1e-5)) ** 2, 0, 1)) * (0.5 + 0.5 * np.clip(bud_y, 0, 1)))
    for sgn in (-1, 1):
        sx = xl * sgn
        sy = (Y - 0.058) / 0.05
        cx = 0.004 + 0.022 * np.clip(sy, 0, 1) ** 1.6
        sw = 0.0045 * psin(math.pi * np.clip(sy, 0, 1)) ** 0.7
        sep = np.where((sy > 0) & (sy < 1), np.abs(sx - cx) - sw, 1.0)
        put(cov(sep, px), 0.002 + 0.005 * np.sqrt(np.clip(1 - ((sx - cx) / np.maximum(sw, 1e-5)) ** 2, 0, 1)))
    xe = ((X / 0.075) % 1.0) * 0.075 - 0.0375
    cy = 0.236
    ey = (Y - cy)
    rx = 0.0215 * (1 + 0.12 * np.clip(ey / 0.035, -1, 1))
    egg = np.hypot(xe / rx, ey / 0.034)
    shell_o = np.hypot(xe / 0.0315, (ey + 0.004) / 0.044)
    shell = np.where(ey < 0.03, np.maximum((shell_o - 1) * 0.03, (1.12 - egg) * 0.02), 1.0)
    put(cov(shell, px), 0.002 + 0.005 * np.clip(1 - np.abs(shell_o - 1.0) / 0.25, 0, 1))
    put(cov((egg - 1) * 0.02, px), 0.003 + 0.011 * np.sqrt(np.clip(1 - egg ** 2, 0, 1)))
    xd = ((X / 0.075 + 0.5) % 1.0) * 0.075 - 0.0375
    dart_t = (Y - 0.196) / 0.07
    dart_w = np.where(dart_t < 0.28, 0.0075 * (dart_t / 0.28), 0.0022)
    dart = np.where((dart_t > 0) & (dart_t < 1), np.abs(xd) - dart_w, 1.0)
    put(cov(dart, px), 0.002 + 0.005 * np.clip(1 - np.abs(xd) / np.maximum(dart_w, 1e-4), 0, 1))
    Hs = blur(H, 0.6)
    cav = cavity(Hs, 5.0) * 120
    G = np.clip(G, 0, 1)
    ground = ramp(0.5 + 0.2 * noise((h, w), 901, 10, beta=2.4), [(0, "#1a110b"), (1, "#2b1c12")])
    col = mix(ground * (1 - np.clip(cav * 0.5, 0, 0.4))[..., None], gilt_colour(cav), G)
    rough = lerp(np.full((h, w), 0.72, F32), 0.24 + 0.12 * np.clip(cav, 0, 1), G)
    return dict(color=col.astype(F32), rough=rough.astype(F32), height=Hs, px=(pu, pv), relief=0.7, metal=G * 0.95)


# ---------------------------------------------------------------------------
# Metal, leather, fabric, carpet, cork
# ---------------------------------------------------------------------------

def gen_brushed():
    """Brushed metal detail (roughness + normal only; the palette colour stays in charge)."""
    n, tile = 1024, 0.3
    s1 = noise((n, n), 1001, 2, 380)
    s2 = noise((n, n), 1002, 8, 470)
    s3 = noise((n, n), 1003, 1.5, 60, beta=2.0)
    scr = ss(2.7, 3.4, noise((n, n), 1004, 1.2, 480))
    smudge = noise((n, n), 1005, 3, beta=2.6)
    rough = 0.3 + 0.03 * s1 + 0.02 * s2 + 0.012 * s3 + 0.05 * scr + 0.01 * smudge
    hgt = 3e-6 * s1 + 2e-6 * s2 - 4e-6 * scr
    return dict(color=None, rough=np.clip(rough, 0.12, 0.6), height=hgt, px=tile / n, relief=3.0)


def gen_leather():
    """Full-grain leather: pebbled grain, soft creases, aniline mottling, worn glossy crowns."""
    n, tile = 1024, 0.5
    px = tile / n
    f1, f2, cid = worley((n, n), 210, 210, 1101, jitter=0.95)
    pebble = ss(0.0, 0.32, f2 - f1)
    f1b, f2b, _ = worley((n, n), 80, 80, 1102, jitter=0.95)
    big = ss(0.0, 0.25, f2b - f1b)
    cr = noise((n, n), 1103, 6, 14, beta=2.2)
    crease = np.exp(-(cr / 0.12) ** 2) * ss(0.0, 1.0, noise((n, n), 1104, 4, beta=2.0))
    pores = ss(2.6, 3.3, noise((n, n), 1105, 300))
    mott = noise((n, n), 1106, 4, beta=2.6)
    mott2 = noise((n, n), 1107, 18, beta=2.2)
    hgt = 3.2e-5 * pebble + 2.2e-5 * big - 7e-5 * crease - 2e-5 * pores
    wear = np.clip(ss(0.4, 1.0, pebble * big) * (0.6 + 0.4 * ss(-0.5, 1.5, mott)), 0, 1)
    lt = 1 + 0.045 * mott + 0.025 * mott2 + 0.07 * wear - 0.16 * crease - 0.1 * (1 - pebble) - 0.08 * pores
    col = lt[..., None] * np.ones(3, F32) * np.dstack([1 + 0.03 * mott, np.ones_like(mott), 1 - 0.04 * mott])
    col = fit_mean(col, fit_target("leather"))
    rough = 0.52 - 0.1 * wear + 0.08 * crease + 0.05 * (1 - pebble) + 0.04 * mott2
    return dict(color=col, rough=np.clip(rough, 0.3, 0.8), height=hgt, px=px, relief=1.0)


def gen_fabric():
    """Woven upholstery: a 2/2 twill of slubbed, heathered yarns (~1.6 mm pitch)."""
    n, tile = 1024, 0.4
    px = tile / n
    p = 4
    x = np.arange(n)
    i = (x // p)[None, :]
    j = (x // p)[:, None]
    fx = (((x % p) + 0.5) / p)[None, :]
    fy = (((x % p) + 0.5) / p)[:, None]
    warp_top = ((i + j) % 4) < 2
    r = np.random.default_rng(1201)
    nt = n // p
    warp_th = (0.85 + 0.3 * r.random(nt))[i]
    weft_th = (0.85 + 0.3 * r.random(nt))[j]
    slub_w = noise((n, n), 1202, 30, 3)
    slub_f = noise((n, n), 1203, 3, 30)
    wp = psin(math.pi * fx) ** 0.7 * warp_th * (1 + 0.12 * slub_w)
    wf = psin(math.pi * fy) ** 0.7 * weft_th * (1 + 0.12 * slub_f)
    wt = np.broadcast_to(warp_top, (n, n))
    hgt = np.where(wt, 1.0 + 0.6 * wp, 1.0 + 0.6 * wf) + np.where(wt, 0.25 * wf, 0.25 * wp)
    fuzz = noise((n, n), 1204, 400)
    hgt = (hgt * 1.2e-4 + 1e-5 * fuzz).astype(F32)
    warp_c = (0.95 + 0.1 * r.random(nt))[i]
    weft_c = (0.9 + 0.1 * r.random(nt))[j]
    shade = np.where(wt, warp_c * (0.82 + 0.18 * wp), weft_c * (0.78 + 0.18 * wf))
    heather = noise((n, n), 1205, 60, beta=1.5)
    lt = shade * (1 + 0.04 * heather + 0.02 * fuzz) * (1 + 0.03 * noise((n, n), 1206, 3, beta=2.5))
    col = lt[..., None] * np.ones(3, F32)
    col = fit_mean(col, fit_target("fabric"))
    rough = 0.9 - 0.06 * np.where(wt, wp, wf) + 0.03 * fuzz
    return dict(color=col, rough=np.clip(rough, 0.7, 1.0), height=hgt, px=px, relief=1.0)


def gen_carpet():
    """Fine cut-pile carpet in neutral grey (tinted by the palette): tufts, gauge rows,
    gentle pile shading."""
    n, tile = 1024, 1.0
    px = tile / n
    t1 = noise((n, n), 1301, 330)
    t2 = noise((n, n), 1302, 150)
    f1, f2, cid = worley((n, n), 340, 340, 1303, jitter=1.0)
    tuft = 1 - ss(0.0, 0.7, f1)
    rows = 0.5 + 0.5 * np.cos(2 * math.pi * grid(n, n)[1] * 400)
    shade = noise((n, n), 1304, 3, beta=2.6)
    shade2 = noise((n, n), 1305, 12, beta=2.2)
    heather = ss(1.6, 2.6, noise((n, n), 1306, 420)) - ss(1.8, 2.8, noise((n, n), 1307, 420))
    hgt = (4e-4 * (0.5 * tuft + 0.3 * t1 * 0.25 + 0.15 * rows) + 1.2e-4 * t2).astype(F32)
    lt = 1 + 0.05 * t1 + 0.04 * t2 + 0.06 * tuft + 0.035 * shade + 0.02 * shade2 + 0.12 * heather - 0.03 * rows
    col = lt[..., None] * np.ones(3, F32)
    col = fit_mean(col, fit_target("carpet"))
    rough = 0.94 + 0.03 * t1 - 0.02 * tuft
    return dict(color=col.astype(F32), rough=np.clip(rough, 0.8, 1.0), height=hgt, px=px, relief=0.6)


def gen_cork():
    """Agglomerated cork board: granules 1-5 mm in mixed tans, dark specks and pores."""
    n, tile = 1024, 0.5
    px = tile / n
    a1, a2, ida = worley((n, n), 150, 150, 1401, jitter=1.0)
    b1, b2, idb = worley((n, n), 330, 330, 1402, jitter=1.0)
    r = np.random.default_rng(1403)
    pal = np.array([hex_lin(c) for c in ("#c79a68", "#b5854f", "#a3733f", "#d2ac7c", "#8a5c30", "#6a4426")])
    wts = np.array([0.24, 0.24, 0.2, 0.14, 0.12, 0.06])
    pick_a = r.choice(len(pal), size=150 * 150, p=wts)
    pick_b = r.choice(len(pal), size=330 * 330, p=wts)
    big = ss(-0.3, 0.6, noise((n, n), 1404, 40))
    col = mix(pal[pick_b[idb]], pal[pick_a[ida]], big)
    col *= (1 + 0.05 * noise((n, n), 1405, 300))[..., None]
    edge = 1 - ss(0.0, 0.18, np.where(big > 0.5, a2 - a1, b2 - b1))
    pores = ss(2.2, 3.0, noise((n, n), 1406, 160))
    col *= (1 - 0.35 * edge - 0.55 * pores)[..., None]
    hgt = (1.5e-4 * (1 - edge) + 6e-5 * noise((n, n), 1407, 120) - 3e-4 * pores).astype(F32)
    col = fit_mean(col, fit_target("cork"))
    rough = 0.9 + 0.05 * edge + 0.05 * pores
    return dict(color=col.astype(F32), rough=np.clip(rough, 0.8, 1.0), height=hgt, px=px, relief=1.0)


# ---------------------------------------------------------------------------
# Rugs (hand-knotted wool: designs drawn on the knot grid)
# ---------------------------------------------------------------------------

RUG = {
    "madder": "#7a2c22", "madder_d": "#5a1e17", "madder_l": "#97412d", "indigo": "#26314d",
    "indigo_d": "#1a2136", "indigo_l": "#3e5175", "ivory": "#d8c8a2", "camel": "#b08a5a",
    "saffron": "#c99a3e", "sage": "#7d8a62", "salmon": "#c98a6e", "ink": "#2a1a14", "sky": "#7189a3",
    "brown": "#5a3a26", "fringe": "#e2d6b9",
}


class _Knots:
    """Paints a rug design knot by knot: every layer covers whole knots (hard edges that step on
    the knot grid), and every opaque layer erases the dark outline drawing beneath it, so hidden
    outlines never show through (the old ghost-outline bug)."""

    def __init__(self, shape, px, ground):
        self.col = np.broadcast_to(hex_lin(RUG[ground]), shape + (3,)).copy()
        self.outl = np.zeros(shape, F32)
        self.px = px

    def fill(self, sd, colour, mask=None, outline=False, ow=0.65):
        c = (sd < 0).astype(F32)
        if mask is not None:
            c = c * mask
        self.col = mix(self.col, hex_lin(RUG.get(colour, colour)), c)
        self.outl = self.outl * (1 - c)
        if outline:
            o = (np.abs(sd) < ow * self.px).astype(F32)
            if mask is not None:
                o = o * mask
            self.outl = np.maximum(self.outl, o)
        return c

    def line(self, d, half_w, colour, mask=None):
        return self.fill(np.abs(d) - half_w, colour, mask)

    def finish(self, amount=0.85):
        return mix(self.col, hex_lin(RUG["ink"]), np.clip(self.outl, 0, 1) * amount)


def _herati(K, X, Y, mask, cell, vine, leaf_a, leaf_b, rosette, centre, blossom, vine_w=0.0045):
    """Herati allover, drawn dense the way it is knotted: a diamond lattice of sinuous vines; in
    every diamond a rosette framed by four curved lancet leaves ('fish') lying along its sides
    with their tips at the lattice nodes, and four small blossoms toward the nodes. The two
    interleaved sets of diamonds swap the leaf colours, as in the woven pattern."""
    fx = ((X / cell) % 1.0 - 0.5) * cell
    fy = ((Y / cell) % 1.0 - 0.5) * cell
    ax, ay = np.abs(fx), np.abs(fy)
    tt = (ax - ay) / cell                                          # position along a diamond side
    lat = (ax + ay - cell / 2) / math.sqrt(2) + 0.03 * cell * np.sin(2 * math.pi * tt)
    K.line(lat, vine_w / 2, vine, mask)
    gx = ((X / cell + 0.5) % 1.0 - 0.5) * cell                    # the interleaved diamonds
    gy = ((Y / cell + 0.5) % 1.0 - 0.5) * cell
    r2 = 1 / math.sqrt(2)
    L = 0.5 * cell
    for set_i, (px_, py_) in enumerate(((fx, fy), (gx, gy))):
        inside = mask * ((np.abs(px_) + np.abs(py_)) < cell / 2).astype(F32)
        la, lb = (leaf_a, leaf_b) if set_i == 0 else (leaf_b, leaf_a)
        for i, (sx_, sy_) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
            dx, dy = -sx_ * r2, sy_ * r2                           # along the side
            cx = sx_ * cell / 4 - sx_ * r2 * 0.06 * cell - dx * L / 2
            cy = sy_ * cell / 4 - sy_ * r2 * 0.06 * cell - dy * L / 2
            lf = sd_leaf(px_, py_, cx, cy, math.atan2(dy, dx), L, 0.13 * cell, bend=0.18)
            K.fill(lf, la if i % 2 == 0 else lb, inside, outline=True)
        for ang in (0.0, math.pi / 2, math.pi, 1.5 * math.pi):
            bx_, by_ = 0.3 * cell * math.cos(ang), 0.3 * cell * math.sin(ang)
            K.fill(sd_petals(px_, py_, bx_, by_, cell * 0.04, 4, 0.45, math.pi / 4), blossom, inside, outline=True)
        K.fill(sd_petals(px_, py_, 0, 0, cell * 0.12, 8, 0.32), rosette if set_i == 0 else blossom, inside, outline=True)
        K.fill(sd_petals(px_, py_, 0, 0, cell * 0.065, 8, 0.4, math.pi / 8), blossom if set_i == 0 else rosette, inside, outline=True)
        K.fill(sd_circle(px_, py_, 0, 0, cell * 0.025), centre, inside)
    nx_ = ((X / cell) % 1.0 - 0.5) * cell                          # nodes: x on a cell centre line,
    ny_ = ((Y / cell + 0.5) % 1.0 - 0.5) * cell                    # y on a cell edge (and swapped)
    for qx, qy in ((nx_, ny_), (((X / cell + 0.5) % 1.0 - 0.5) * cell, ((Y / cell) % 1.0 - 0.5) * cell)):
        K.fill(sd_circle(qx, qy, 0, 0, cell * 0.03), centre, mask, outline=True)


def _warp(X, Y, seed, amp, per_m, extent):
    """Hand-drawn irregularity: displaces motif coordinates by a smooth field (metres)."""
    h, w = X.shape
    nx = noise((h, w), seed, per_m * extent[0], per_m * extent[1], beta=2.4)
    ny = noise((h, w), seed + 1, per_m * extent[0], per_m * extent[1], beta=2.4)
    return X + amp * nx, Y + amp * ny


def _pile(col, shape, px_u, px_v, seed, knot_soft=1.0, wear=0.05):
    """Wool pile over a drawn design: soften to the knot, slightly muted dyes, per-knot value
    jitter, fibre noise, abrash bands (dye lots changing along the warp) and soft wear.
    Returns col, rough, height."""
    h, w = shape
    col = blur(col, knot_soft)
    lum = (col * np.array([0.3, 0.55, 0.15], F32)).sum(-1, keepdims=True)
    col = col * 0.9 + lum * 0.1
    rng = np.random.default_rng(seed)
    knot = (rng.random(shape).astype(F32) - 0.5)
    fib = noise(shape, seed + 1, w * 0.3, h * 0.3)
    abr = np.tanh(2.5 * noise(shape, seed + 2, 7.0, 0.5))
    hue_ab = np.tanh(2.0 * noise(shape, seed + 3, 4.0, 0.5))
    wr = ss(0.2, 1.8, noise(shape, seed + 4, 2.5, beta=2.6))
    lt = 1 + 0.08 * knot + 0.035 * fib + 0.06 * abr + wear * wr
    col = col * lt[..., None] * np.dstack([1 + 0.03 * hue_ab, np.ones_like(hue_ab), 1 - 0.035 * hue_ab])
    rough = np.clip(0.93 + 0.03 * fib, 0.85, 1.0)
    hgt = blur(knot, 0.6) * 5e-4 + 1.4e-4 * fib - 1.5e-4 * wr
    return col.astype(F32), rough.astype(F32), hgt.astype(F32)


def gen_rug_runner():
    """Deep red runner: madder field with a dense Herati allover (camel vines), indigo main
    border with rosettes and palmettes on a meandering vine at both long edges (V = 0 and V = 1),
    guard stripes. Repeats every 1.6 m along U; knots ~3 mm."""
    n, tile = 1024, 1.6
    px = tile / n
    knot = 2 * px
    u, v = grid(n, n)
    X, Y = full(u * tile, v * tile)
    Xq = (np.floor(X / knot) + 0.5) * knot            # knot grid: every motif steps per knot
    Yq = (np.floor(Y / knot) + 0.5) * knot
    yd = np.minimum(Yq, tile - Yq)
    K = _Knots((n, n), knot, "madder")
    fy0 = 0.33
    field = (yd > fy0).astype(F32)
    Xw, Yw = _warp(Xq, Yq, 1510, 0.003, 1.5, (tile, tile))
    _herati(K, Xw, Yw - tile / 2, field, 0.2, "camel", "sage", "indigo_l", "ivory", "saffron", "salmon", vine_w=0.0045)
    K.fill(yd - 0.012, "indigo_d")                                       # overcast edge
    K.fill(np.abs(yd - 0.032) - 0.02, "ivory")                           # outer guard
    gq = ((Xq / 0.05) % 1.0 - 0.5) * 0.05
    K.fill(sd_diamond(gq, yd - 0.032, 0, 0, 0.016, 0.014), "madder", outline=True)
    K.fill(sd_diamond(gq, yd - 0.032, 0, 0, 0.006, 0.005), "indigo")
    K.fill(np.abs(yd - 0.057) - 0.005, "camel")
    mb = (np.abs(yd - 0.17) < 0.108).astype(F32)
    K.fill(np.abs(yd - 0.17) - 0.108, "indigo")                          # main border ground
    by = yd - 0.17
    period = 0.4
    wav = 0.05 * np.sin(2 * math.pi * Xq / period)
    K.line(by - wav, 0.003, "camel", mb)
    for k in (-1, 1):
        lx = ((Xq / (period / 2) + 0.25) % 1.0 - 0.5) * (period / 2)
        K.fill(sd_leaf(lx, by - wav, 0.0, 0.0, k * math.pi / 2 + 0.4 * k, 0.035, 0.012, 0.4), "sage", mb, outline=True)
    bx = ((Xq / period + 0.25) % 1.0 - 0.5) * period
    bxp = ((Xq / period + 0.75) % 1.0 - 0.5) * period
    K.fill(sd_petals(bx, by - 0.05, 0, 0, 0.042, 8, 0.3), "madder_l", mb, outline=True)
    K.fill(sd_petals(bx, by - 0.05, 0, 0, 0.024, 8, 0.4, math.pi / 8), "ivory", mb, outline=True)
    K.fill(sd_circle(bx, by - 0.05, 0, 0, 0.009), "saffron", mb)
    for kk in range(-2, 3):
        ang = math.pi / 2 + kk * 0.42
        K.fill(sd_leaf(bxp, by + 0.065, 0, 0, ang, 0.075 - 0.008 * abs(kk), 0.026, 0.0),
               "salmon" if kk % 2 == 0 else "ivory", mb, outline=True)
    K.fill(sd_ellipse(bxp, by + 0.06, 0, 0.0, 0.022, 0.016), "madder", mb, outline=True)
    K.fill(np.abs(yd - 0.283) - 0.004, "camel")
    K.fill(np.abs(yd - 0.305) - 0.018, "madder_d")                       # inner guard
    g2 = ((Xq / 0.04) % 1.0 - 0.5) * 0.04
    K.fill(sd_petals(g2, yd - 0.305, 0, 0, 0.011, 4, 0.45), "ivory", outline=True)
    K.fill(np.abs(yd - 0.327) - 0.004, "indigo")
    col = K.finish()
    col, rough, hgt = _pile(col, (n, n), px, px, 1501, knot_soft=1.1)
    hgt = hgt - 2.0e-3 * (1 - ss(0.008, 0.016, yd))
    return dict(color=col, rough=rough, height=hgt, px=px, relief=1.0)


def gen_rug_persian():
    """A complete Persian-style rug (one tile = the whole 5.6 x 4.6 m rug), drawn on the knot grid:
    warp fringe and kilim at the short ends, overcast long edges, guard stripes, an indigo main
    border with rosettes and palmettes on a meandering vine, a madder field with a Herati
    allover pattern, scalloped corner spandrels and a curvilinear lobed medallion with palmette
    pendants. Madder / indigo / ivory with camel, saffron, sage and salmon, abrash, soft pile."""
    n = 2048
    L, W = 5.6, 4.6
    pu, pv = L / n, W / n
    px = (pu + pv) / 2
    u, v = grid(n, n)
    X, Y = full((u - 0.5) * L, (v - 0.5) * W)
    ax, ay = np.abs(X), np.abs(Y)
    FR, KL, OC = 0.055, 0.03, 0.012
    eu = L / 2 - ax
    ev = W / 2 - ay
    ex = eu - FR - KL
    ey = ev - OC
    e = np.minimum(ex, ey)
    side_p = np.where(ex < ey, Y, X)
    K = _Knots((n, n), px, "madder")
    fb = 0.5
    in_field = (e > fb).astype(F32)
    X0, Y0 = X, Y
    X, Y = _warp(X0, Y0, 1620, 0.006, 1.5, (L, W))                     # hand-drawn irregularity
    _herati(K, X, Y, in_field, 0.24, "camel", "sage", "indigo", "ivory", "madder_d", "saffron", vine_w=0.0055)
    # corner spandrels: scalloped quarter-medallions
    fxe, fye = L / 2 - FR - KL - fb, W / 2 - OC - fb
    sr = np.hypot((ax - fxe) / 0.95, (ay - fye) / 0.78)
    st = np.arctan2((ay - fye) / 0.78, (ax - fxe) / 0.95)
    sp_d = (sr - (0.92 + 0.08 * np.abs(np.cos(6 * st)) ** 0.5)) * 0.78
    K.fill(sp_d, "ivory", in_field, outline=True)
    K.fill(sp_d + 0.03, "indigo", in_field, outline=True)
    spm = in_field * (sp_d + 0.04 < 0)
    _herati(K, X, Y, spm, 0.12, "camel", "sage", "salmon", "madder_l", "saffron", "ivory", vine_w=0.0045)
    # central medallion
    rx, ry = 1.05, 0.8
    rho = np.hypot(X / rx, Y / ry)
    th = np.arctan2(Y / ry, X / rx)
    sd_m = (rho - (0.92 + 0.08 * np.abs(np.cos(8 * th)) ** 0.5)) * ry
    for sgn in (-1, 1):                                                 # pendants on the long axis
        stem = np.maximum(np.abs(Y) - 0.012, np.maximum(ax - 1.36, 0.95 - ax))
        K.fill(stem, "ivory", outline=True)
        px_ = X * sgn
        for kk in range(-2, 3):
            ang = kk * 0.38
            K.fill(sd_leaf(px_, Y, 1.22, 0.0, ang, 0.24 - 0.03 * abs(kk), 0.085, 0.0),
                   "indigo" if kk % 2 == 0 else "indigo_l", outline=True)
        K.fill(sd_ellipse(px_, Y, 1.25, 0.0, 0.06, 0.05), "salmon", outline=True)
        K.fill(sd_circle(px_, Y, 1.25, 0.0, 0.022), "saffron")
        lz = sd_diamond(px_, Y, 1.56, 0.0, 0.09, 0.07)
        K.fill(lz, "ivory", outline=True)
        K.fill(sd_diamond(px_, Y, 1.56, 0.0, 0.045, 0.035), "madder", outline=True)
    K.fill(sd_m, "ivory", outline=True)
    K.fill(sd_m + 0.035, "indigo", outline=True)
    ring = (sd_m + 0.045 < 0).astype(F32)
    _herati(K, X, Y, ring, 0.12, "camel", "sage", "salmon", "madder_l", "saffron", "ivory", vine_w=0.0045)
    rho2 = np.hypot(X / (rx * 0.56), Y / (ry * 0.56))
    th2 = np.arctan2(Y / (ry * 0.56), X / (rx * 0.56))
    sd_i = (rho2 - (0.9 + 0.1 * np.abs(np.cos(6 * th2)) ** 0.5)) * ry * 0.56
    K.fill(sd_i, "camel", outline=True)
    K.fill(sd_i + 0.02, "ivory", outline=True)
    inner = (sd_i + 0.03 < 0).astype(F32)
    _herati(K, X, Y, inner, 0.11, "camel", "sage", "salmon", "indigo_l", "saffron", "madder_l", vine_w=0.004)
    R0 = np.hypot(X, Y)
    T0 = np.arctan2(Y, X)
    for i in range(8):                                                   # palmettes round the centre
        ang = i * math.pi / 4
        for kk in (-1, 0, 1):
            K.fill(sd_leaf(X, Y, 0.17 * math.cos(ang), 0.17 * math.sin(ang), ang + kk * 0.35, 0.15 - 0.03 * abs(kk), 0.05),
                   ("madder" if kk == 0 else "madder_l") if i % 2 == 0 else ("indigo" if kk == 0 else "indigo_l"),
                   inner, outline=True)
    sw = np.abs(R0 - (0.3 + 0.025 * np.sin(8 * T0))) - 0.004             # tendril ring
    K.fill(sw, "sage", inner)
    K.fill(sd_petals(X, Y, 0, 0, 0.15, 16, 0.3), "madder", outline=True)
    K.fill(sd_petals(X, Y, 0, 0, 0.1, 8, 0.4, math.pi / 8), "saffron", outline=True)
    K.fill(sd_petals(X, Y, 0, 0, 0.06, 8, 0.4), "indigo", outline=True)
    K.fill(sd_circle(X, Y, 0, 0, 0.022), "ivory")
    # borders, from the pile edge inward
    K.fill(e - 0.012, "indigo_d")
    og = ((e > 0.012) & (e < 0.058)).astype(F32)
    K.fill(np.abs(e - 0.035) - 0.023, "ivory")
    gq = ((side_p / 0.06) % 1.0 - 0.5) * 0.06
    K.fill(sd_diamond(gq, e - 0.035, 0, 0, 0.02, 0.017), "madder", og, outline=True)
    K.fill(sd_diamond(gq, e - 0.035, 0, 0, 0.007, 0.006), "indigo", og)
    K.fill(np.abs(e - 0.063) - 0.005, "camel")
    K.fill(np.abs(e - 0.072) - 0.004, "madder_d")
    mb = ((e > 0.076) & (e < 0.404)).astype(F32)
    K.fill(np.abs(e - 0.24) - 0.164, "indigo")
    by = e - 0.24
    period = 0.46
    wav = 0.07 * np.sin(2 * math.pi * side_p / period)
    K.line(by - wav, 0.0035, "camel", mb)
    lx = ((side_p / (period / 2) + 0.25) % 1.0 - 0.5) * (period / 2)
    for kk in (-1, 1):
        K.fill(sd_leaf(lx, by - wav, 0, 0, kk * (math.pi / 2 + 0.35), 0.05, 0.017, 0.4), "sage", mb, outline=True)
    bx = ((side_p / period + 0.25) % 1.0 - 0.5) * period
    bxp = ((side_p / period + 0.75) % 1.0 - 0.5) * period
    K.fill(sd_petals(bx, by - 0.07, 0, 0, 0.068, 10, 0.28), "madder_l", mb, outline=True)
    K.fill(sd_petals(bx, by - 0.07, 0, 0, 0.042, 10, 0.4, 0.3), "ivory", mb, outline=True)
    K.fill(sd_petals(bx, by - 0.07, 0, 0, 0.02, 5, 0.4), "indigo", mb)
    K.fill(sd_circle(bx, by - 0.07, 0, 0, 0.007), "saffron", mb)
    for kk in range(-2, 3):
        ang = math.pi / 2 + kk * 0.4
        K.fill(sd_leaf(bxp, by + 0.035, 0, 0, ang, 0.1 - 0.012 * abs(kk), 0.034, 0.0),
               "salmon" if kk % 2 == 0 else "ivory", mb, outline=True)
    K.fill(sd_ellipse(bxp, by + 0.04, 0, 0, 0.03, 0.022), "madder", mb, outline=True)
    K.fill(sd_circle(bxp, by + 0.04, 0, 0, 0.009), "saffron", mb)
    corner = ((ex > 0.076) & (ex < 0.404) & (ey > 0.076) & (ey < 0.404)).astype(F32)
    K.fill(sd_box(ex, ey, 0.24, 0.24, 0.164, 0.164), "indigo", corner)
    K.fill(sd_petals(ex, ey, 0.24, 0.24, 0.12, 8, 0.3), "madder_l", corner, outline=True)
    K.fill(sd_petals(ex, ey, 0.24, 0.24, 0.075, 8, 0.4, math.pi / 8), "ivory", corner, outline=True)
    K.fill(sd_petals(ex, ey, 0.24, 0.24, 0.035, 8, 0.4), "indigo", corner)
    K.fill(sd_circle(ex, ey, 0.24, 0.24, 0.012), "saffron", corner)
    K.fill(np.abs(e - 0.408) - 0.004, "ivory")
    ig = ((e > 0.412) & (e < 0.468)).astype(F32)
    K.fill(np.abs(e - 0.44) - 0.028, "madder_d")
    g2 = ((side_p / 0.05) % 1.0 - 0.5) * 0.05
    K.fill(sd_petals(g2, e - 0.44, 0, 0, 0.016, 4, 0.45), "ivory", ig, outline=True)
    K.fill(sd_circle(g2, e - 0.44, 0, 0, 0.005), "madder", ig)
    K.fill(np.abs(e - 0.472) - 0.004, "indigo")
    K.fill(np.abs(e - 0.484) - 0.005, "saffron")
    K.fill(np.abs(e - 0.494) - 0.004, "indigo")
    col = K.finish()
    X, Y = X0, Y0
    col, rough, hgt = _pile(col, (n, n), pu, pv, 1601, knot_soft=0.9, wear=0.06)
    # ends: kilim band, then warp fringe; long edges: overcast wrapping
    kil = ((eu > FR) & (eu < FR + KL)).astype(F32)
    kc = np.broadcast_to(hex_lin(RUG["ivory"]), (n, n, 3)).copy()
    kc = mix(kc, hex_lin(RUG["madder"]), (np.abs(eu - FR - KL * 0.5) < 0.004).astype(F32))
    kc = mix(kc, hex_lin(RUG["indigo"]), (np.abs(eu - FR - KL * 0.22) < 0.002).astype(F32))
    kc *= (1 + 0.05 * np.sin(Y / 0.0045 * 2 * math.pi) * 0.5)[..., None]
    col = mix(col, kc, kil)
    fr = (eu < FR).astype(F32)
    strands = noise((n, n), 1611, 2.0, n * 0.45)
    fcol = hex_lin(RUG["fringe"]) * (0.86 + 0.08 * strands + 0.06 * ss(0.0, FR, eu))[..., None]
    col = mix(col, fcol, fr)
    oc = ((ev < OC) & (eu > FR)).astype(F32)
    wrap = 0.85 + 0.15 * np.sin((X + Y) / 0.006 * 2 * math.pi)
    col = mix(col, hex_lin(RUG["indigo_d"]) * wrap[..., None], oc)
    rough = lerp(rough, 0.85, np.maximum(kil, fr))
    hgt = hgt * (1 - np.maximum(kil, fr)) - 2.5e-3 * kil - 3.5e-3 * fr + 6e-4 * strands * fr - 1.5e-3 * oc
    return dict(color=col, rough=rough, height=hgt, px=(pu, pv), relief=1.0)


# ---------------------------------------------------------------------------
# Book spine atlas
# ---------------------------------------------------------------------------

BOOK_W, BOOK_H = 1024, 2048
# Spine (thickness, height) in mm each cell is drawn for (bookcases.VARIANTS / SHAPES).
CELL_MM = {
    0: [(40, 250)] * 6 + [(50, 360)] * 2,
    1: [(32, 235)] * 8,
    2: [(72, 280)] * 3 + [(46, 360)] * 2 + [(36, 240)] * 3,
    3: [(20, 180)] * 4 + [(105, 262)] * 2 + [(30, 245)] * 2,
}
GILT_BOOK = "#f2dca2"     # pale gold leaf (also the metallic F0 once the metal mask is wired)
FONT_FILES = {
    "serif": ["/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
              "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"],
    "caslon": ["/System/Library/Fonts/Supplemental/BigCaslon.ttf",
               "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"],
    "roman": ["/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
              "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"],
    "sans": ["/System/Library/Fonts/Supplemental/Futura.ttc", "/System/Library/Fonts/Supplemental/GillSans.ttc"],
    "mono": ["/System/Library/Fonts/Supplemental/Courier New Bold.ttf"],
}
_FONTS = {}
_TEXT = {}


def _font(kind):
    if kind in _FONTS:
        return _FONTS[kind]
    f = None
    for p in FONT_FILES.get(kind, []):
        if os.path.exists(p):
            try:
                f = bpy.data.fonts.load(p, check_existing=True)
                break
            except RuntimeError:
                f = None
    if f is None:
        f = bpy.data.fonts.load("<builtin>", check_existing=True)
    _FONTS[kind] = f
    return f


def _text_tris(text, kind):
    """Triangles (N, 3, 2) of `text` set in a font, in font units (baseline y = 0), plus the
    font's cap height."""
    key = (text, kind)
    if key in _TEXT:
        return _TEXT[key]
    font = _font(kind)
    cu = bpy.data.curves.new("TexTxt", type="FONT")
    cu.body = text
    cu.font = font
    cu.size = 1.0
    ob = bpy.data.objects.new("TexTxt", cu)
    bpy.context.scene.collection.objects.link(ob)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(deps))
    bpy.data.objects.remove(ob)
    bpy.data.curves.remove(cu)
    me.calc_loop_triangles()
    co = np.array([vv.co[:2] for vv in me.vertices], np.float64).reshape(-1, 2)
    tri = np.array([lt.vertices[:] for lt in me.loop_triangles], np.int64).reshape(-1, 3)
    bpy.data.meshes.remove(me)
    tris = co[tri] if len(tri) else np.zeros((0, 3, 2))
    _TEXT[key] = tris
    return tris


def _cap(kind):
    t = _text_tris("H", kind)
    return float(t[..., 1].max() - t[..., 1].min()) if len(t) else 0.7


def _raster(tris, h, w, ss_=4):
    """Anti-aliased coverage of triangles given in pixel coordinates (x = column, y = row)."""
    acc = np.zeros((h * ss_, w * ss_), bool)
    if len(tris) == 0:
        return np.zeros((h, w), F32)
    T = np.asarray(tris, np.float64) * ss_
    mn = np.floor(T.min(axis=1)).astype(int)
    mx = np.ceil(T.max(axis=1)).astype(int)
    for t, (x0, y0), (x1, y1) in zip(T, mn, mx):
        x0, y0 = max(x0, 0), max(y0, 0)
        x1, y1 = min(x1, w * ss_), min(y1, h * ss_)
        if x0 >= x1 or y0 >= y1:
            continue
        (ax_, ay_), (bx_, by_), (cx_, cy_) = t
        area = (bx_ - ax_) * (cy_ - ay_) - (by_ - ay_) * (cx_ - ax_)
        if abs(area) < 1e-9:
            continue
        xs = np.arange(x0, x1) + 0.5
        ys = (np.arange(y0, y1) + 0.5)[:, None]
        e0 = (bx_ - ax_) * (ys - ay_) - (by_ - ay_) * (xs - ax_)
        e1 = (cx_ - bx_) * (ys - by_) - (cy_ - by_) * (xs - bx_)
        e2 = (ax_ - cx_) * (ys - cy_) - (ay_ - cy_) * (xs - cx_)
        if area > 0:
            ins = (e0 >= 0) & (e1 >= 0) & (e2 >= 0)
        else:
            ins = (e0 <= 0) & (e1 <= 0) & (e2 <= 0)
        acc[y0:y1, x0:x1] |= ins
    return acc.reshape(h, ss_, w, ss_).mean(axis=(1, 3)).astype(F32)


class _Spine:
    """One atlas cell: coordinates in millimetres on the real spine (x across from the left edge,
    y up from the tail), layers that the atlas composes: G gilt, LB dark label, PP paper / light,
    INK dark print, BL blind (pressed, no gilt), plus height and roughness."""

    def __init__(self, row, col):
        self.row, self.col = row, col
        self.cw, self.ch = BOOK_W // 8, BOOK_H // 4
        self.T, self.Hm = CELL_MM[row][col]
        self.mu = self.T / self.cw
        self.mv = self.Hm / self.ch
        self.pxm = 0.5 * (self.mu + self.mv)
        a = ((np.arange(self.cw, dtype=F32) + 0.5) / self.cw)[None, :]
        b = ((np.arange(self.ch, dtype=F32) + 0.5) / self.ch)[:, None]
        self.a, self.b = full(a, b)
        self.x = self.a * self.T
        self.y = self.b * self.Hm
        z = lambda: np.zeros((self.ch, self.cw), F32)  # noqa: E731
        self.G, self.LB, self.PP, self.INK, self.BL, self.WH = z(), z(), z(), z(), z(), z()
        self.Hh = z()

    def _l(self, name):
        return getattr(self, name)

    def add(self, name, m):
        setattr(self, name, np.maximum(self._l(name), np.clip(m, 0, 1)))

    def hline(self, y_frac, w_mm=0.9, x0=0.05, x1=0.95, layer="G"):
        d = np.abs(self.y - y_frac * self.Hm) - w_mm / 2
        m = cov(d, self.mv) * cov(np.maximum(x0 * self.T - self.x, self.x - x1 * self.T), self.mu)
        self.add(layer, m)
        return m

    def box(self, y0, y1, x0=0.12, x1=0.88, layer="LB", r_mm=0.6):
        d = sd_box(self.x, self.y, (x0 + x1) / 2 * self.T, (y0 + y1) / 2 * self.Hm,
                   (x1 - x0) / 2 * self.T - r_mm, (y1 - y0) / 2 * self.Hm - r_mm) - r_mm
        m = cov(d, self.pxm)
        self.add(layer, m)
        return d

    def frame(self, d, w_mm=0.6, inset=0.9, layer="G"):
        self.add(layer, cov(np.abs(d + inset) - w_mm / 2, self.pxm))

    def text(self, s, y_frac, cap_mm, kind="serif", layer="G", max_w=0.78, x_frac=0.5, vertical=False, track=1.0):
        tris = _text_tris(s, kind)
        if not len(tris):
            return
        cap = _cap(kind)
        sc = cap_mm / cap
        xs, ys = tris[..., 0], tris[..., 1]
        cx = 0.5 * (xs.min() + xs.max())
        width = (xs.max() - xs.min()) * sc
        avail = max_w * (self.Hm if vertical else self.T)
        squeeze = min(1.0, avail / max(width, 1e-6)) * track
        if squeeze < 0.62:                       # too long even condensed: shrink the type instead
            sc *= squeeze / 0.62
            squeeze = 0.62
        if not vertical:
            px_x = (x_frac * self.T + (xs - cx) * sc * squeeze) / self.mu
            px_y = (y_frac * self.Hm + (ys - cap / 2) * sc) / self.mv
        else:                                    # runs head -> tail, letter tops toward the front board
            px_x = (x_frac * self.T + (ys - cap / 2) * sc) / self.mu
            px_y = (y_frac * self.Hm - (xs - cx) * sc * squeeze) / self.mv
        m = _raster(np.stack([px_x, px_y], -1), self.ch, self.cw)
        self.add(layer, m)
        return m

    def tool(self, kind, y_frac, size_mm, x_frac=0.5, layer="G"):
        """Finishing tools: fleuron, lozenge, star, sprig, dot rows, oval medallion."""
        cx, cy = x_frac * self.T, y_frac * self.Hm
        X, Y = self.x, self.y
        p = self.pxm
        r = size_mm / 2
        if kind == "fleuron":
            for k in range(4):
                ang = k * math.pi / 2 + math.pi / 4
                self.add(layer, cov(sd_leaf(X, Y, cx, cy, ang, r, r * 0.55), p))
            self.add(layer, cov(sd_circle(X, Y, cx, cy, r * 0.22), p))
        elif kind == "lozenge":
            d = sd_diamond(X, Y, cx, cy, r * 0.8, r * 1.3)
            self.add(layer, cov(np.abs(d) - 0.25, p))
            self.add(layer, cov(sd_circle(X, Y, cx, cy, r * 0.25), p))
        elif kind == "star":
            self.add(layer, cov(sd_petals(X, Y, cx, cy, r, 8, 0.55, 0.0, 0.8), p))
        elif kind == "sprig":
            self.add(layer, cov(np.maximum(np.abs(X - cx) - 0.25, np.abs(Y - cy) - r), p))
            for k in (-1, 1):
                for j, f in enumerate((-0.5, 0.0, 0.5)):
                    self.add(layer, cov(sd_leaf(X, Y, cx, cy + f * r, math.pi / 2 - k * 1.0, r * 0.55, r * 0.3), p))
        elif kind == "dots":
            n = max(3, int(self.T * 0.8 / (size_mm * 1.6)))
            for i in range(n):
                xx = self.T * (0.1 + 0.8 * (i + 0.5) / n)
                self.add(layer, cov(sd_circle(X, Y, xx, cy, size_mm * 0.3), p))
        elif kind == "oval":
            d = sd_ellipse(X, Y, cx, cy, r * 0.7, r * 1.2)
            self.add(layer, cov(np.abs(d) - 0.3, p))
            self.add(layer, cov(sd_petals(X, Y, cx, cy, r * 0.42, 6, 0.5), p))
        elif kind == "corners":
            for sx_ in (-1, 1):
                for sy_ in (-1, 1):
                    self.add(layer, cov(sd_circle(X, Y, cx + sx_ * self.T * 0.3, cy + sy_ * r, 0.55), p))

    def band(self, y_frac, w_mm=4.0, h_m=1.1e-3):
        """A raised band (cord under the leather) with its shading."""
        d = (self.y - y_frac * self.Hm) / (w_mm / 2)
        self.Hh += h_m * np.sqrt(np.clip(1 - d * d, 0, 1))


TITLES = ["HISTORIA", "ANNALES", "LEXICON", "OPERA", "CODEX", "ELEMENTA", "PRINCIPIA", "ODES", "ESSAYS",
          "LETTERS", "SERMONS", "POEMS", "TRAVELS", "MEMOIRS", "VOYAGES", "ANATOMY", "BOTANY", "ASTRONOMY",
          "CHEMISTRY", "GAZETTEER", "ATLAS", "CHRONICLE", "DIALOGUES", "TREATISE", "PHYSICA", "ETHICS",
          "RHETORIC", "GEOMETRIA", "HERBAL", "SATIRES", "FABLES", "ORATIONS"]
SUBTITLES = ["NATURALIS", "ROMANA", "ANGLIAE", "SACRA", "MUNDI", "VETERUM", "OF ROME", "OF THE SEAS",
             "SELECTED", "COLLECTED", "MORALIA", "CIVILIS"]
AUTHORS = ["ASHFORD", "MERRIL", "CALLOWAY", "WREN", "HALDANE", "PEMBERTON", "VOSS", "AUBREY", "LINDQVIST",
           "MARLOWE", "STRAND", "DUVAL", "KEMP", "ORLOV", "BRANDT", "FENWICK"]
ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]


def _design_calf(S, r, c):
    """Row 0: antique calf, raised bands with gilt rules at +-0.028 (bookcases reads them)."""
    nb = 5            # every calf cell: bookcases.py detects the count from the gilt rules
    pos = np.linspace(0.16, 0.86, nb)
    for p in pos:
        S.band(p, 4.2)
        for o in (-0.028, 0.028):
            S.hline(p + o, 0.85, 0.04, 0.96)
    S.hline(0.045, 0.7, 0.04, 0.96)
    S.hline(0.955, 0.7, 0.04, 0.96)
    if c % 2 == 0:
        S.tool("dots", 0.035, 1.1)
        S.tool("dots", 0.965, 1.1)
    panels = [(pos[i] + 0.034, pos[i + 1] - 0.034) for i in range(nb - 1)]
    tools = ["fleuron", "lozenge", "star", "sprig", "oval", "fleuron", "star", "lozenge"]
    title = TITLES[(c * 3) % len(TITLES)]
    sub = SUBTITLES[c % len(SUBTITLES)]
    lab = panels[-1]
    label_dark = c not in (2,)
    if label_dark:
        d = S.box(lab[0] + 0.006, lab[1] - 0.006, 0.08, 0.92, "LB", 0.5)
        S.frame(d, 0.45, 0.9)
    mid = 0.5 * (lab[0] + lab[1])
    lines = [title, sub] if c % 3 != 1 else [title]
    capmm = 3.2 if c < 6 else 4.2
    for i, s in enumerate(lines):
        S.text(s, mid + (0.5 * (len(lines) - 1) - i) * (capmm * 1.65 / S.Hm), capmm * (1 if i == 0 else 0.82),
               "serif" if c % 2 == 0 else "roman", max_w=0.78)
    vol = panels[-2]
    vm = 0.5 * (vol[0] + vol[1])
    if c in (1, 3, 5, 7):
        d = S.box(vm - 0.022, vm + 0.022, 0.2, 0.8, "LB", 0.5)
        S.frame(d, 0.4, 0.8)
        S.text(ROMAN[(c * 2 + 1) % 12], vm, 3.2, "roman", max_w=0.5)
    else:
        S.text("VOL. " + ROMAN[c % 12], vm, 2.6, "serif", max_w=0.7)
    for i, (p0, p1) in enumerate(panels[:-2]):
        pm = 0.5 * (p0 + p1)
        size = min((p1 - p0) * S.Hm * 0.55, S.T * 0.42)
        S.tool(tools[(c + i) % len(tools)], pm, size)
        if c % 3 == 0:
            S.tool("corners", pm, size * 0.9)
    if c >= 6:
        S.text(["MDCCLXXIV", "LONDINI"][c - 6], 0.1, 2.4, "roman", max_w=0.8)


def _design_cloth(S, r, c):
    """Row 1: publisher's cloth: head and tail rules, title, author, imprint."""
    style = c % 4
    if style == 0:
        for f in (0.93, 0.945):
            S.hline(f, 0.6)
        for f in (0.055, 0.07):
            S.hline(f, 0.6)
    elif style == 1:
        S.hline(0.94, 1.6)
        S.hline(0.955, 0.5)
        S.hline(0.06, 1.6)
        S.hline(0.045, 0.5)
    elif style == 2:
        S.tool("dots", 0.94, 1.0)
        S.hline(0.925, 0.5)
        S.tool("dots", 0.06, 1.0)
        S.hline(0.075, 0.5)
    else:
        for f in (0.92, 0.935, 0.95, 0.05, 0.065, 0.08):
            S.hline(f, 0.45, layer="BL")
    title = TITLES[(c * 5 + 7) % len(TITLES)]
    author = AUTHORS[(c * 3 + 1) % len(AUTHORS)]
    ty = 0.79 + 0.02 * (c % 3)
    if c in (2, 5):
        d = S.box(ty - 0.065, ty + 0.065, 0.1, 0.9, "LB", 0.6)
        S.frame(d, 0.45, 1.0)
    words = [title] if c % 2 else [title, SUBTITLES[(c + 4) % len(SUBTITLES)]]
    if c == 7:
        words = ["THE", title, "OF", "THE NORTH"]
    capmm = 3.3 if len(words) < 3 else 2.4
    step = capmm * 1.7 / S.Hm
    for i, s in enumerate(words):
        S.text(s, ty + (0.5 * (len(words) - 1) - i) * step, capmm * (1 if len(s) > 3 else 0.75),
               ["serif", "caslon", "roman"][c % 3], max_w=0.8)
    S.hline(ty - 0.5 * len(words) * step - 0.03, 0.4, 0.35, 0.65)
    S.text(author, 0.56 - 0.03 * (c % 2), 2.4, "serif", max_w=0.8)
    if c % 4 == 3:
        for k in range(5):
            S.tool("sprig" if k % 2 else "fleuron", 0.33 + 0.035 * k, 3.6)
    elif c % 4 == 1:
        S.tool("oval", 0.36, 6.5)
    S.text(["OXFORD", "LONDON", "EDINBURGH", "BOSTON", "CAMBRIDGE", "PARIS", "LEIPZIG", "DUBLIN"][c], 0.1, 1.9,
           "roman", max_w=0.78)


def _design_panels(S, r, c):
    """Row 2: bands at 0.32 and 0.62 (bookcases models them): c 0-2 thick reference volumes,
    c 3-4 folios, c 5-7 half-calf with tooled panels."""
    for p in (0.32, 0.62):
        S.band(p, 4.6)
        for o in (-0.012, 0.012):
            S.hline(p + o, 0.8, 0.05, 0.95)
    S.hline(0.05, 0.8, 0.05, 0.95)
    S.hline(0.95, 0.8, 0.05, 0.95)
    panels = [(0.065, 0.305), (0.335, 0.605), (0.635, 0.935)]
    if c <= 2:
        d = S.box(0.70, 0.86, 0.1, 0.9, "LB", 0.8)
        S.frame(d, 0.5, 1.1)
        S.text(["CYCLOPAEDIA", "DICTIONARY", "LEXICON"][c], 0.805, 4.2, "serif", max_w=0.84)
        S.text(["OF ARTS", "OF ENGLISH", "GRAECUM"][c], 0.755, 3.0, "roman", max_w=0.84)
        S.text(ROMAN[c + 3], 0.5, 9.0, "roman", max_w=0.5)
        S.hline(0.43, 0.6, 0.3, 0.7)
        S.hline(0.57, 0.6, 0.3, 0.7)
        S.text(["MAR - NEP", "ABA - CUR", "THE - ZEU"][c], 0.2, 3.0, "serif", max_w=0.8)
        S.tool("dots", 0.27, 1.6)
        S.tool("dots", 0.13, 1.6)
    elif c <= 4:
        for (p0, p1) in panels:
            dd = sd_box(S.x, S.y, S.T / 2, (p0 + p1) / 2 * S.Hm, S.T * 0.38, (p1 - p0) / 2 * S.Hm - 4)
            S.add("G", cov(np.abs(dd) - 0.35, S.pxm))
        S.box(0.43, 0.5, 0.12, 0.88, "LB", 0.6)
        S.text(["ATLAS", "HERBAL"][c - 3], 0.465, 3.8, "serif", max_w=0.8)
        S.tool("oval", 0.2, 14.0)
        S.tool("lozenge", 0.78, 14.0)
        S.tool("fleuron", 0.55, 7.0)
    else:
        for i, (p0, p1) in enumerate(panels):
            dd = sd_box(S.x, S.y, S.T / 2, (p0 + p1) / 2 * S.Hm, S.T * 0.36, (p1 - p0) / 2 * S.Hm - 3.5)
            S.add("G", cov(np.abs(dd) - 0.3, S.pxm))
            if c == 5:
                pat = (np.cos(S.x / 2.2 * math.pi) * np.cos(S.y / 2.2 * math.pi)) > 0.86
                S.add("G", pat * cov(dd + 1.6, S.pxm) * 0.9)
            elif c == 6 and i != 1:
                S.tool("sprig", (p0 + p1) / 2, 18.0)
            elif i != 1:
                S.tool("star", (p0 + p1) / 2, 9.0)
                S.tool("corners", (p0 + p1) / 2, 30.0)
        d = S.box(0.43, 0.51, 0.08, 0.92, "LB", 0.5)
        S.frame(d, 0.4, 0.8)
        S.text(TITLES[(c * 7) % len(TITLES)], 0.47, 3.0, "serif", max_w=0.8)


STICKER_BOX = (0.13, 0.87, 0.066, 0.154)   # cell-relative (a0, a1, b0, b1); bookcases.py UVs its cards here
STICKER_CELLS = (0, 1, 3, 4, 6, 7)        # row-3 cells that carry a shelf-mark sticker
CALL_MARKS = {0: ["PS", "3545"], 1: ["QC", "921"], 3: ["PR", "99.E7"], 4: ["MSS", "A-14"],
              6: ["QA", "76.9", ".C55"], 7: ["PR", "4034", ".P7"]}


def _sticker(S, lines):
    """Library shelf-mark sticker: paper label exactly on STICKER_BOX with typed call marks."""
    a0, a1, b0, b1 = STICKER_BOX
    S.box(b0, b1, a0, a1, "PP", 0.5)
    hmm = (b1 - b0) * S.Hm
    n = len(lines)
    cap = min(hmm / (n * 1.75 + 0.6), (a1 - a0) * S.T / 3.2, 4.6)
    for i, txt in enumerate(lines):
        y = 0.5 * (b0 + b1) + (0.5 * (n - 1) - i) * cap * 1.7 / S.Hm
        S.text(txt, y, cap, "mono", "INK", max_w=(a1 - a0) * 0.86)


def _design_modern(S, r, c):
    """Row 3: c 0-3 paperbacks, c 4-5 archival boxes, c 6-7 library bindings. Cells in
    STICKER_CELLS carry a shelf-mark sticker on STICKER_BOX (bookcases.py reuses it for labels)."""
    if c <= 3:
        title = ["A SHORT HISTORY OF LIGHT", "THE QUIET ROOM", "NOTES ON CLOUDS", "SELECTED ESSAYS"][c]
        author = AUTHORS[c + 8]
        if c % 2 == 0:
            S.box(0.84, 0.97, 0.03, 0.97, "PP", 0.0)
            S.text(title, 0.52, 5.0, "sans", "INK", max_w=0.56, vertical=True)
            S.text(author, 0.9, 3.2, "sans", "INK", max_w=0.11, vertical=True)
        else:
            S.text(title, 0.62, 5.0, "serif" if c == 1 else "sans", "WH", max_w=0.5, vertical=True)
            S.text(author, 0.33, 3.0, "sans", "WH", max_w=0.12, vertical=True)
            S.hline(0.88, 0.8, 0.15, 0.85, "WH")
        ly = 0.2 if c in STICKER_CELLS else 0.065
        logo = sd_ellipse(S.x, S.y, S.T / 2, ly * S.Hm, S.T * 0.28, 3.2)
        S.add("PP" if c % 2 == 0 else "WH", cov(logo, S.pxm))
        S.add("INK", cov(sd_petals(S.x, S.y, S.T / 2, ly * S.Hm, 2.0, 5, 0.5), S.pxm) * (c % 2 == 0))
    elif c <= 5:
        d = S.box(0.62, 0.86, 0.14, 0.86, "PP", 1.5)
        S.frame(d, 0.9, 1.6, "INK")
        lines = [["MSS. 14", "CORRESPONDENCE", "1871 - 1902"], ["BOX 7", "MAPS & PLANS", "1820 - 1866"]][c - 4]
        for i, s_ in enumerate(lines):
            S.text(s_, 0.81 - i * 0.065, 5.0 if i == 0 else 3.6, "mono", "INK", max_w=0.66)
        ring = sd_circle(S.x, S.y, S.T / 2, 0.3 * S.Hm, 12.0)
        S.add("INK", cov(np.abs(ring) - 1.2, S.pxm))
        hole = cov(sd_circle(S.x, S.y, S.T / 2, 0.3 * S.Hm, 10.5), S.pxm)
        S.add("LB", hole)
        S.Hh -= 2e-3 * hole
        if c == 5:
            S.box(0.08, 0.13, 0.3, 0.7, "PP", 0.5)
            S.text("B-07", 0.105, 3.6, "mono", "INK", max_w=0.36)
    else:
        S.hline(0.93, 0.7)
        S.hline(0.22, 0.7)
        S.text(TITLES[(c * 11) % len(TITLES)], 0.78, 3.2, "serif", max_w=0.84)
        S.text(SUBTITLES[(c * 5) % len(SUBTITLES)], 0.74, 2.5, "serif", max_w=0.84)
        S.text(AUTHORS[c + 2], 0.55, 2.4, "serif", max_w=0.84)
    if c in STICKER_CELLS:
        _sticker(S, CALL_MARKS[c])


def gen_book_spines():
    """8 x 4 atlas of 32 spine designs (see the module docstring); cloth / leather light grey so
    the per-book object colour multiplies, gilt in pale gold with a metal mask."""
    W, Hh = BOOK_W, BOOK_H
    cw, ch = W // 8, Hh // 4
    L = np.zeros((Hh, W), F32)
    gilt = np.zeros((Hh, W), F32)
    rough = np.zeros((Hh, W), F32)
    hgt = np.zeros((Hh, W), F32)
    ink = np.zeros((Hh, W), F32)
    paper = np.zeros((Hh, W), F32)
    weave = noise((Hh, W), 1701, 420, 840)
    weave2 = noise((Hh, W), 1704, 300, 300)
    mott = noise((Hh, W), 1702, 24, 48, beta=2.2)
    grainn = noise((Hh, W), 1703, 200, 400, beta=1.2)
    r = np.random.default_rng(1703)
    designers = {0: _design_calf, 1: _design_cloth, 2: _design_panels, 3: _design_modern}
    for row in range(4):
        for c in range(8):
            S = _Spine(row, c)
            designers[row](S, r, c)
            ys = slice(row * ch, (row + 1) * ch)
            xs = slice(c * cw, (c + 1) * cw)
            leather = row in (0, 2)
            base_l = 0.72 if leather else 0.8
            if row == 3 and c in (4, 5):
                base_l = 0.78
            tex = (0.018 * grainn[ys, xs] + 0.014 * mott[ys, xs]) if leather else (0.014 * weave[ys, xs] + 0.01 * weave2[ys, xs] + 0.012 * mott[ys, xs])
            Lc = base_l * (1 + tex)
            Lc *= 0.86 + 0.14 * psin(math.pi * S.a) ** 0.5            # rounded spine darkens at the joints
            margin = (np.minimum(np.minimum(S.a, 1 - S.a), np.minimum(S.b, 1 - S.b)) > 0.03).astype(F32)
            G = S.G * margin
            LB = S.LB * margin
            PP = S.PP * margin
            INK = S.INK * margin
            WH = S.WH * margin
            BL = S.BL * margin
            Lc = lerp(Lc, Lc * 0.42, LB)
            Lc = lerp(Lc, 0.95 + 0.02 * weave2[ys, xs], PP)
            Lc = lerp(Lc, 0.97, WH)
            Lc = lerp(Lc, 0.12, INK)
            Lc = Lc * (1 - 0.12 * BL)
            # band shading: highlight on top of each band, shadow under it
            gy = np.gradient(S.Hh, axis=0) / (S.mv * 1e-3)
            Lc = Lc * (1 + 0.6 * np.clip(gy, -0.25, 0.25))
            wear = (1 - ss(0.0, 0.04, S.b)) + (1 - ss(0.96, 1.0, 1 - S.b))
            Lc = Lc * (1 + 0.06 * wear)
            rr = np.full_like(Lc, 0.45 if leather else 0.68)
            rr = lerp(rr, 0.42, LB)
            rr = lerp(rr, 0.55, PP)
            rr = lerp(rr, 0.35, np.maximum(INK, WH))
            rr = lerp(rr, 0.26, G)
            H_ = S.Hh + 1.2e-4 * LB + 6e-5 * PP - 8e-5 * G - 7e-5 * BL + (1.5e-5 * grainn[ys, xs] if leather else 1.2e-5 * weave[ys, xs])
            L[ys, xs] = Lc
            gilt[ys, xs] = G
            rough[ys, xs] = rr
            hgt[ys, xs] = H_
            ink[ys, xs] = INK
            paper[ys, xs] = PP
    lin = srgb_lin(np.clip(L, 0, 1))
    col = np.dstack([lin, lin * 0.99, lin * 0.975])
    gold = hex_lin(GILT_BOOK) * (0.92 + 0.08 * noise((Hh, W), 1705, 300))[..., None]
    col = mix(col, gold, gilt)
    px = (0.04 / cw, 0.25 / ch)
    return dict(color=col.astype(F32), rough=rough, height=blur(hgt, 0.4), px=px, relief=1.0, metal=gilt)


# ---------------------------------------------------------------------------
# Registry, writer, CLI
# ---------------------------------------------------------------------------

GENERATORS = {
    "walnut": lambda: gen_wood("walnut"),
    "mahogany": lambda: gen_wood("mahogany"),
    "oak": lambda: gen_wood("oak"),
    "oak_tabletop": gen_oak_tabletop,
    "parquet_herringbone": gen_parquet,
    "oak_boards": gen_oak_boards,
    "marble_checker": gen_marble_checker,
    "stone_tiles": gen_stone_tiles,
    "carpet": gen_carpet,
    "limestone_ashlar": gen_limestone_ashlar,
    "limestone": gen_limestone,
    "plaster": gen_plaster,
    "coffer_panel": gen_coffer_panel,
    "ornament_band": gen_ornament_band,
    "brushed": gen_brushed,
    "leather": gen_leather,
    "fabric": gen_fabric,
    "cork": gen_cork,
    "rug_runner": gen_rug_runner,
    "rug_persian": gen_rug_persian,
    "book_spines": gen_book_spines,
}


def save_png(path, arr, colorspace="sRGB"):
    arr = np.asarray(arr, F32)
    if arr.ndim == 2:
        arr = np.repeat(arr[..., None], 3, axis=2)
    h, w = arr.shape[:2]
    rgba = np.ones((h, w, 4), F32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    name = os.path.basename(path)
    old = bpy.data.images.get(name)
    if old:
        bpy.data.images.remove(old)
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)
    return path


def write(tex, res):
    os.makedirs(TEX_DIR, exist_ok=True)
    for kind in ("color", "rough", "normal", "metal"):     # never leave a stale map loaded
        old = bpy.data.images.get(f"{tex}_{kind}.png")
        if old:
            bpy.data.images.remove(old)
    paths = []
    if res.get("color") is not None:
        paths.append(save_png(os.path.join(TEX_DIR, f"{tex}_color.png"), to_srgb(res["color"]), "sRGB"))
    paths.append(save_png(os.path.join(TEX_DIR, f"{tex}_rough.png"), np.clip(res["rough"], 0, 1), "Non-Color"))
    px = res["px"]
    pu, pv = px if isinstance(px, tuple) else (px, px)
    nm = normal_map(res["height"], pu, pv, res.get("relief", 1.0))
    paths.append(save_png(os.path.join(TEX_DIR, f"{tex}_normal.png"), nm, "Non-Color"))
    mpath = os.path.join(TEX_DIR, f"{tex}_metal.png")
    if res.get("metal") is not None:
        paths.append(save_png(mpath, np.clip(res["metal"], 0, 1), "Non-Color"))
    elif os.path.exists(mpath):
        os.remove(mpath)
    return paths


def used_texture_ids():
    return sorted({s["tex"] for s in LM.PALETTE.values() if s.get("tex")})


def build_textures(_out=None, names=None):
    """Generates (and writes) the textures; `names` limits which (default: all). Writes
    palette_fit.json afterwards."""
    names = names or list(GENERATORS)
    done = []
    for tex in names:
        t0 = time.time()
        res = GENERATORS[tex]()
        write(tex, res)
        if res.get("color") is not None:
            m = res["color"].reshape(-1, 3).mean(0)
            print(f"TEX {tex:20s} {res['rough'].shape[1]}x{res['rough'].shape[0]}  mean {lin_hex(m)}  "
                  f"rough {float(res['rough'].mean()):.2f}  {time.time() - t0:.1f}s")
        else:
            print(f"TEX {tex:20s} (no colour)  rough {float(res['rough'].mean()):.2f}  {time.time() - t0:.1f}s")
        done.append(tex)
    missing = [t for t in used_texture_ids() if t not in GENERATORS]
    if missing:
        print("TEX missing generators:", missing)
    print("TEX palette fit:", write_palette_fit())
    return done


def seam_report():
    """Edge-to-edge pixel difference vs the interior for every colour map (1.0 = invisible)."""
    out = []
    for tex in GENERATORS:
        p = os.path.join(TEX_DIR, f"{tex}_color.png")
        if not os.path.exists(p):
            continue
        a, img = _png_lin(p)
        h, w = a.shape[:2]
        sx = np.abs(a[:, 0] - a[:, -1]).mean() / (np.abs(np.diff(a, axis=1)).mean() + 1e-6)
        sy = np.abs(a[0] - a[-1]).mean() / (np.abs(np.diff(a, axis=0)).mean() + 1e-6)
        out.append(f"  {tex:20s} {w}x{h} seam/interior U {sx:.2f}  V {sy:.2f}")
    return out


# ---------------------------------------------------------------------------
# Preview: swatch boards, tiled checks and in-context close-ups
# ---------------------------------------------------------------------------

def _mat_flat(name, rgb, rough=0.6):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(nd for nd in m.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    return m


def _light(col, name, loc, target, energy, size=1.0, color=(1, 1, 1), kind="AREA", angle=None):
    from mathutils import Vector
    light = bpy.data.lights.new(name, kind)
    light.energy = energy
    light.color = color
    if kind == "AREA":
        light.size = size
    if kind == "SUN" and angle is not None:
        light.angle = math.radians(angle)
    if kind == "POINT":
        light.shadow_soft_size = size
    ob = bpy.data.objects.new(name, light)
    col.objects.link(ob)
    ob.location = Vector(loc)
    ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    return ob


def _label(text, loc, size, col, mat):
    cu = bpy.data.curves.new("lbl_" + text, type="FONT")
    cu.body = text
    cu.size = size
    cu.align_x = "CENTER"
    cu.align_y = "CENTER"
    tmp = bpy.data.objects.new("lbl_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(deps))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    me.materials.append(mat)
    ob = bpy.data.objects.new("Label_" + text, me)
    col.objects.link(ob)
    ob.location = loc
    return ob


def _plane(name, x0, x1, y0, y1, z, mat, uvf, col, normal_up=True):
    """Flat quad in the XY plane, UV from uvf(x, y) -> (u, v)."""
    import bmesh
    bm = bmesh.new()
    vs = [bm.verts.new((x0, y0, z)), bm.verts.new((x1, y0, z)), bm.verts.new((x1, y1, z)), bm.verts.new((x0, y1, z))]
    f = bm.faces.new(vs if normal_up else list(reversed(vs)))
    uvl = bm.loops.layers.uv.new("UVMap")
    for lp in f.loops:
        lp[uvl].uv = uvf(lp.vert.co.x, lp.vert.co.y)
    return C.mesh_from_bmesh(name, bm, mat, col=col)


def _quad(name, corners, uvs, mat, col):
    import bmesh
    bm = bmesh.new()
    vs = [bm.verts.new(c) for c in corners]
    f = bm.faces.new(vs)
    uvl = bm.loops.layers.uv.new("UVMap")
    for lp, uv in zip(f.loops, uvs):
        lp[uvl].uv = uv
    return C.mesh_from_bmesh(name, bm, mat, col=col)


def build_swatch(key, location=(0, 0, 0), size=0.34, col=None, rot=-28.0, M=None):
    """A bevelled cube of a palette material, UV'd at real-world scale (grain along X)."""
    M = M or LM.mat
    ob = C.box(f"Swatch_{key}", (size, size, size), (0, 0, size / 2), M(key), bevel_w=size * 0.08, segments=4, col=col)
    C.uv_box(ob, size=LM.tex_size(key), grain="x")
    ob.location = location
    ob.rotation_euler = (0, 0, math.radians(rot))
    return ob


def _board_lights(colx, name, w, h):
    cx, cy = w / 2, h / 2
    _light(colx, f"{name}_Key", (cx - 2.5, cy - 3.0, 3.8), (cx, cy, 0), 320, 2.5, (1.0, 0.95, 0.88))
    _light(colx, f"{name}_Fill", (cx + 3.5, cy - 2.0, 2.2), (cx, cy, 0), 90, 3.0, (0.86, 0.92, 1.0))
    _light(colx, f"{name}_Rim", (cx + 0.5, cy + 3.5, 2.6), (cx, cy, 0.2), 200, 2.5, (1.0, 0.93, 0.82))


def build_swatch_board(keys, name, cols=7, M=None):
    """Rows of swatch cubes with name labels on a dark board. Returns (collection, objects)."""
    M = M or mat_fitted
    colx = C.collection(name)
    objs = []
    rows = (len(keys) + cols - 1) // cols
    dx, dy = 0.62, 1.0
    lab = _mat_flat("PreviewLabel", (0.75, 0.72, 0.66), 0.5)
    for i, key in enumerate(keys):
        r, c = divmod(i, cols)
        x = c * dx
        y = (rows - 1 - r) * dy
        objs.append(build_swatch(key, (x, y, 0), col=colx, M=M))
        objs.append(_label(key, (x, y - 0.33, 0.001), 0.056, colx, lab))
    w, h = (cols - 1) * dx, (rows - 1) * dy
    floor = _mat_flat("PreviewBoard", (0.045, 0.042, 0.04), 0.7)
    _plane(f"{name}_Floor", -3, w + 3, -3, h + 3, 0, floor, lambda x, y: (0, 0), colx)
    _board_lights(colx, name, w, h)
    return colx, objs


FITTED_KEYS = ["walnut", "walnut_dark", "oak", "oak_light", "coffer_panel", "coffer_red",
               "leather_brown", "leather_burgundy", "leather_green", "velvet_olive", "fabric_green", "fabric_cream",
               "carpet_quiet", "carpet_tiles", "plaster_green", "ornament_band"]


def build_fitted_board(keys=FITTED_KEYS, cols=8):
    """Shared-texture keys three ways: today's lib_materials.mat with today's palette (back; build
    those materials before apply_palette_fit), with the fitted palette and the gilt mask wired
    (middle), and a flat chip of the palette base colour (front) to judge against."""
    colx = C.collection("Board_Fitted")
    lab = _mat_flat("PreviewLabel", (0.75, 0.72, 0.66), 0.5)
    dx = 0.62
    groups = (len(keys) + cols - 1) // cols
    for i, key in enumerate(keys):
        g, c = divmod(i, cols)
        x = c * dx
        y0 = (groups - 1 - g) * 1.55
        build_swatch(key, (x, y0 + 0.75, 0), size=0.3, col=colx).name = f"Today_{key}"
        build_swatch(key, (x, y0 + 0.3, 0), size=0.3, col=colx, M=mat_fitted).name = f"Fitted_{key}"
        chip = C.box(f"Chip_{key}", (0.3, 0.1, 0.012), (x, y0 - 0.05, 0.006),
                     _mat_flat("Chip_" + key, tuple(float(cc) for cc in hex_lin(LM.PALETTE[key]["base"])), 0.6), col=colx)
        chip.rotation_euler = (0, 0, 0)
        _label(key, (x, y0 - 0.17, 0.001), 0.05, colx, lab)
    w, h = (cols - 1) * dx, groups * 1.55
    _plane("Fitted_Floor", -3, w + 3, -3, h + 3, 0, _mat_flat("PreviewBoard", (0.045, 0.042, 0.04), 0.7),
           lambda x, y: (0, 0), colx)
    _board_lights(colx, "Fitted", w, h - 0.6)
    return colx, (w, h)


def _only(coll):
    for c in bpy.data.collections:
        c.hide_render = c is not coll
    return coll


def _cam(loc, target, lens=50, ortho=None):
    from mathutils import Vector
    cam = bpy.data.objects.get("PreviewCam")
    if cam is None:
        cam = bpy.data.objects.new("PreviewCam", bpy.data.cameras.new("PreviewCam"))
        bpy.context.scene.collection.objects.link(cam)
    cam.data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        cam.data.ortho_scale = ortho
    cam.data.lens = lens
    cam.data.clip_start = 0.02
    cam.data.clip_end = 200
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def _render(out_dir, name, size=(960, 960), samples=48):
    import lib_render as R
    R.engine(bpy.context.scene, "EEVEE", samples, size)
    path = os.path.join(out_dir, name + ".png")
    t0 = time.time()
    R.render(path)
    print(f"RENDER {name} {time.time() - t0:.1f}s")
    return path


TILE_CHECKS = [
    ("walnut", "tile", 3), ("mahogany", "tile", 3), ("oak", "tile", 3), ("tabletop", "tile", 3),
    ("parquet_herringbone", "tile", 3), ("oak_boards", "tile", 3), ("marble_checker", "tile", 3),
    ("stone_tiles", "tile", 3), ("limestone", "tile", 3), ("limestone_plain", "tile", 3),
    ("plaster", "tile", 3), ("coffer_panel", "tile", 3), ("carpet_quiet", "tile", 3),
    ("leather_brown", "tile", 3), ("fabric_green", "tile", 3), ("cork", "tile", 3),
    ("ornament_band", "band", 3), ("rug_red", "runner", 3), ("rug_persian", "rug", 1),
]


def build_tile_check(key, layout, reps):
    """A flat panel showing `reps` x `reps` repeats (top-down), with a raking sun."""
    colx = C.collection(f"Check_{key}")
    m = mat_fitted(key)
    size = LM.tex_size(key)
    if layout == "band":
        w, h = size * reps, 0.3 * reps
        _plane(f"Check_{key}", 0, w, 0, h, 0, m, lambda x, y: (x / size, y / 0.3), colx)
    elif layout == "runner":
        w, h = size * reps, size
        _plane(f"Check_{key}", 0, w, 0, h, 0, m, lambda x, y: (x / size, y / size), colx)
    elif layout == "rug":
        w, h = 5.6, 4.6
        _plane(f"Check_{key}", 0, w, 0, h, 0, m, lambda x, y: (x / w, y / h), colx)
    else:
        w = h = size * reps
        _plane(f"Check_{key}", 0, w, 0, h, 0, m, lambda x, y: (x / size, y / size), colx)
    _light(colx, f"Check_{key}_Sun", (-1, -0.4, 0.62), (0, 0, 0), 3.2, kind="SUN", color=(1.0, 0.95, 0.88), angle=8)
    _light(colx, f"Check_{key}_Sun2", (1, 0.6, 1.4), (0, 0, 0), 0.9, kind="SUN", color=(0.88, 0.93, 1.0), angle=30)
    return colx, (w, h)


BOOK_RGB = [(0.30, 0.04, 0.035), (0.035, 0.05, 0.14), (0.04, 0.12, 0.06), (0.42, 0.25, 0.11),
            (0.025, 0.022, 0.02), (0.45, 0.30, 0.05), (0.20, 0.03, 0.06), (0.05, 0.16, 0.16),
            (0.30, 0.30, 0.28), (0.16, 0.07, 0.03), (0.55, 0.42, 0.24), (0.08, 0.08, 0.20)]


def _shelf_books(colx, x0, z0, width, seed, M, cells=None):
    """A run of books on a shelf, each spine UV'd into one atlas cell at the cell's own spine size."""
    r = np.random.default_rng(seed)
    cloth = M("book_cloth")
    x = x0
    objs = []
    i = 0
    cells = cells or [(c, rw) for rw in range(4) for c in range(8)]
    while x < x0 + width - 0.03:
        cell = cells[i % len(cells)] if cells else (int(r.integers(0, 8)), int(r.integers(0, 4)))
        T, Hm = CELL_MM[cell[1]][cell[0]]
        bw, bh = T / 1000 * (0.95 + 0.1 * r.random()), Hm / 1000
        if bh > 0.3:
            bh *= 0.82
        bd = 0.16 + 0.05 * r.random()
        ob = C.box(f"Book_{seed}_{i}", (bw, bd, bh), (0, 0, bh / 2), cloth, bevel_w=0.0015, segments=2, col=colx)
        me = ob.data
        uv = me.uv_layers.new(name="UVMap").data
        for poly in me.polygons:
            for li in poly.loop_indices:
                co = me.vertices[me.loops[li].vertex_index].co
                if poly.normal.y < -0.5:
                    a = min(max((co.x + bw / 2) / bw, 0), 1)
                    b = min(max(co.z / bh, 0), 1)
                    uv[li].uv = ((cell[0] + a) / 8, (cell[1] + b) / 4)
                else:
                    uv[li].uv = ((cell[0] + 0.015) / 8, (cell[1] + 0.5) / 4)
        ob.color = (*BOOK_RGB[int(r.integers(0, len(BOOK_RGB)))], 1)
        ob.location = (x + bw / 2, -bd / 2 + 0.02, z0)
        objs.append(ob)
        x += bw + 0.0015
        i += 1
    return objs


def build_closeups(M=None, tag=""):
    """Context vignettes. M is the material function (lib_materials.mat or mat_fitted)."""
    M = M or LM.mat
    sets = {}
    sfx = tag

    def coll(name):
        return C.collection(name + sfx)

    # Room corner: parquet + runner, ashlar wall with an ornament band, plaster above.
    colx = coll("Vig_Room")
    _plane("Room_Floor" + sfx, -4, 4, -4, 4, 0, M("parquet_herringbone"), lambda x, y: (x / 1.6, y / 1.6), colx)
    _plane("Room_Runner" + sfx, -0.8, 0.8, -4, 3.0, 0.006, M("rug_red"), lambda x, y: (y / 1.6, (x + 0.8) / 1.6), colx)
    _quad("Room_Wall" + sfx, [(-4, 3.0, 0), (4, 3.0, 0), (4, 3.0, 3.6), (-4, 3.0, 3.6)],
          [(-4 / 2.4, 0), (4 / 2.4, 0), (4 / 2.4, 3.6 / 2.4), (-4 / 2.4, 3.6 / 2.4)], M("limestone"), colx)
    _quad("Room_Band" + sfx, [(-4, 2.99, 3.6), (4, 2.99, 3.6), (4, 2.99, 3.9), (-4, 2.99, 3.9)],
          [(-4 / 0.6, 0), (4 / 0.6, 0), (4 / 0.6, 1), (-4 / 0.6, 1)], M("ornament_band"), colx)
    _quad("Room_Plaster" + sfx, [(-4, 3.0, 3.9), (4, 3.0, 3.9), (4, 3.0, 6), (-4, 3.0, 6)],
          [(-2, 1.95), (2, 1.95), (2, 3), (-2, 3)], M("plaster"), colx)
    _quad("Room_SideWall" + sfx, [(-2.6, -4, 0), (-2.6, 3.0, 0), (-2.6, 3.0, 3.6), (-2.6, -4, 3.6)],
          [(-4 / 2.4, 0), (3 / 2.4, 0), (3 / 2.4, 1.5), (-4 / 2.4, 1.5)], M("limestone"), colx)
    _light(colx, "Room_Sun" + sfx, (4, -1.2, 2.2), (0, 1, 0), 3.0, kind="SUN", color=(1.0, 0.88, 0.74), angle=2)
    _light(colx, "Room_Fill" + sfx, (1.5, -3, 3.2), (0, 1.5, 1.0), 120, 3.0, (0.85, 0.9, 1.0))
    sets["closeup_room"] = (colx, (1.4, -3.4, 1.6), (-0.4, 2.4, 2.0), 26, (1280, 800))
    # Polished woods: planks of every wood key, raking warm light.
    colx = coll("Vig_Woods")
    keys = ["walnut", "walnut_dark", "mahogany", "oak", "oak_light", "tabletop"]
    for i, key in enumerate(keys):
        ob = C.box(f"Plank_{key}{sfx}", (0.9, 0.13, 0.035), (0, 0, 0.0175), M(key), bevel_w=0.004, segments=3, col=colx)
        C.uv_box(ob, size=LM.tex_size(key), grain="x")
        ob.location = (0, i * 0.15, 0)
    _plane("Woods_Floor" + sfx, -3, 3, -3, 3, 0, _mat_flat("PreviewBoard2", (0.05, 0.045, 0.04), 0.8), lambda x, y: (0, 0), colx)
    _light(colx, "Woods_Key" + sfx, (-1.4, 1.4, 1.3), (0, 0.35, 0), 45, 0.6, (1.0, 0.9, 0.75))
    _light(colx, "Woods_Fill" + sfx, (0.8, -1.2, 1.4), (0, 0.35, 0), 25, 2.0, (0.9, 0.93, 1.0))
    sets["closeup_woods"] = (colx, (0.55, -0.55, 0.42), (0.0, 0.42, 0.0), 45, (1280, 800))
    # Books on a walnut shelf: every atlas cell once, at its own spine size.
    colx = coll("Vig_Books")
    shelf = C.box("Shelf" + sfx, (1.6, 0.3, 0.025), (0.0, -0.12, -0.0125), M("walnut"), bevel_w=0.003, col=colx)
    C.uv_box(shelf, size=LM.tex_size("walnut"), grain="x")
    back = C.box("ShelfBack" + sfx, (1.6, 0.02, 0.42), (0.0, 0.04, 0.21), M("walnut_dark"), bevel_w=0.002, col=colx)
    C.uv_box(back, size=LM.tex_size("walnut_dark"), grain="z")
    cells = [(c, rw) for rw in (0, 1, 2, 3) for c in range(8)]
    _shelf_books(colx, -0.78, 0.0, 1.56, 5, M, cells)
    _light(colx, "Books_Key" + sfx, (-0.7, -1.3, 0.8), (0, 0, 0.12), 30, 0.8, (1.0, 0.88, 0.72))
    _light(colx, "Books_Fill" + sfx, (0.9, -1.0, 0.4), (0, 0, 0.12), 8, 1.5, (0.85, 0.9, 1.0))
    _light(colx, "Books_Lamp" + sfx, (0.1, -0.35, 0.45), (0, 0, 0.15), 6, 0.1, (1.0, 0.82, 0.6), kind="POINT")
    sets["closeup_books"] = (colx, (-0.32, -0.62, 0.17), (-0.32, 0, 0.14), 50, (1280, 720))
    sets["closeup_books_b"] = (colx, (0.38, -0.62, 0.17), (0.38, 0, 0.14), 50, (1280, 720))
    # Coffered soffit seen from below, with the frieze, coffer_panel and coffer_red side by side.
    colx = coll("Vig_Coffer")
    _plane("Coffer_Ceil" + sfx, -2.1, 0.7, -2.1, 2.1, 3.0, M("coffer_panel"),
           lambda x, y: ((x + 2.1) / 1.4, (y + 2.1) / 1.4), colx, normal_up=False)
    _plane("Coffer_CeilR" + sfx, 0.7, 2.1, -2.1, 2.1, 3.0, M("coffer_red"),
           lambda x, y: ((x + 2.1) / 1.4, (y + 2.1) / 1.4), colx, normal_up=False)
    _quad("Coffer_Band" + sfx, [(-2.1, 2.1, 2.7), (2.1, 2.1, 2.7), (2.1, 2.1, 3.0), (-2.1, 2.1, 3.0)],
          [(0, 0), (4.2 / 0.6, 0), (4.2 / 0.6, 1), (0, 1)], M("ornament_band"), colx)
    _light(colx, "Coffer_Low" + sfx, (-2.5, -1.5, 1.6), (0, 0, 3), 260, 1.5, (1.0, 0.86, 0.66))
    _light(colx, "Coffer_Fill" + sfx, (2.0, -2.0, 0.5), (0, 0, 3), 60, 3.0, (0.85, 0.9, 1.0))
    _light(colx, "Coffer_Pt" + sfx, (0.3, 0.2, 1.6), (0, 0, 3), 120, 0.05, (1.0, 0.82, 0.6), kind="POINT")
    sets["closeup_coffer"] = (colx, (0.4, -1.6, 1.0), (0.4, 0.5, 3.0), 30, (1280, 800))
    # Marble floor, polished, with a bright window reflection.
    colx = coll("Vig_Marble")
    _plane("Marble_Floor" + sfx, -3, 3, -3, 3, 0, M("marble_checker"), lambda x, y: (x / 1.2, y / 1.2), colx)
    _light(colx, "Marble_Win" + sfx, (0.0, 4.5, 1.8), (0, 0, 0.5), 260, 1.2, (0.9, 0.95, 1.0))
    _light(colx, "Marble_Fill" + sfx, (-2, -2, 2.5), (0, 0, 0), 120, 3.0, (1.0, 0.92, 0.82))
    sets["closeup_marble"] = (colx, (0.3, -2.2, 1.4), (0.0, 0.9, 0.0), 40, (1280, 800))
    # The lounge rug laid on the herringbone floor, at standing eye height.
    colx = coll("Vig_Rug")
    _plane("Rug_Floor" + sfx, -5, 5, -5, 5, 0, M("parquet_herringbone"), lambda x, y: (x / 1.6, y / 1.6), colx)
    _plane("Rug_Persian" + sfx, -2.8, 2.8, -2.3, 2.3, 0.008, M("rug_persian"),
           lambda x, y: ((x + 2.8) / 5.6, (y + 2.3) / 4.6), colx)
    _light(colx, "Rug_Sun" + sfx, (-3, 2, 2.6), (0, 0, 0), 2.6, kind="SUN", color=(1.0, 0.9, 0.78), angle=3)
    _light(colx, "Rug_Fill" + sfx, (2.5, -3, 3.0), (0, 0, 0), 160, 4.0, (0.85, 0.9, 1.0))
    sets["closeup_rug"] = (colx, (1.2, -4.6, 1.65), (0.0, 0.2, 0.0), 32, (1280, 800))
    sets["closeup_rug_near"] = (colx, (-0.2, -1.1, 1.0), (0.3, 0.6, 0.0), 35, (1280, 800))
    # Ashlar under raking light, with a plain limestone pilaster and the frieze.
    colx = coll("Vig_Stone")
    _quad("Stone_Wall" + sfx, [(-2, 0, 0), (2, 0, 0), (2, 0, 3.0), (-2, 0, 3.0)],
          [(-2 / 2.4, 0), (2 / 2.4, 0), (2 / 2.4, 3 / 2.4), (-2 / 2.4, 3 / 2.4)], M("limestone"), colx)
    pil = C.box("Stone_Pilaster" + sfx, (0.5, 0.12, 3.0), (0.6, -0.06, 1.5), M("limestone_plain"), bevel_w=0.004, col=colx)
    C.uv_box(pil, size=LM.tex_size("limestone_plain"))
    _quad("Stone_Band" + sfx, [(-2, -0.125, 2.7), (2, -0.125, 2.7), (2, -0.125, 3.0), (-2, -0.125, 3.0)],
          [(-2 / 0.6, 0), (2 / 0.6, 0), (2 / 0.6, 1), (-2 / 0.6, 1)], M("ornament_band"), colx)
    _plane("Stone_Floor" + sfx, -3, 3, -3, 0, 0, M("stone_tiles"), lambda x, y: (x / 1.2, y / 1.2), colx)
    _light(colx, "Stone_Sun" + sfx, (-3, -0.9, 2.4), (0, 0, 1.4), 3.2, kind="SUN", color=(1.0, 0.9, 0.76), angle=1.5)
    _light(colx, "Stone_Fill" + sfx, (1.5, -3.0, 1.6), (0, 0, 1.4), 60, 3.0, (0.82, 0.88, 1.0))
    sets["closeup_stone"] = (colx, (-0.5, -3.0, 1.5), (0.1, 0, 1.95), 26, (1280, 800))
    # Room-scale checks (the art director's set): 6 m of walnut panelling with mahogany rails,
    # a 12 x 8 m ashlar wall over the marble floor, floors at eye height, a long table top.
    colx = coll("Vig_WalnutWall")
    for i in range(6):
        st = C.box(f"WW_stile{i}{sfx}", (0.06, 0.04, 2.4), (-3 + i * 1.2, 0, 1.2), M("walnut"), bevel_w=0.004, col=colx)
        C.uv_box(st, size=LM.tex_size("walnut"), grain="z")
        pn = C.box(f"WW_panel{i}{sfx}", (1.14, 0.02, 2.3), (-2.4 + i * 1.2, 0.02, 1.2), M("walnut"), bevel_w=0.003, col=colx)
        C.uv_box(pn, size=LM.tex_size("walnut"), grain="z")
    for zz in (0.05, 2.35):
        rl = C.box(f"WW_rail{zz}{sfx}", (7.2, 0.06, 0.1), (0.0, -0.01, zz), M("mahogany"), bevel_w=0.004, col=colx)
        C.uv_box(rl, size=LM.tex_size("mahogany"), grain="x")
    _plane("WW_floor" + sfx, -6, 6, -6, 2, 0, M("oak_boards"), lambda x, y: (x / 2.0, y / 2.0), colx)
    _light(colx, "WW_key" + sfx, (-3, -3, 3), (0, 0, 1.2), 600, 3.0, (1.0, 0.88, 0.72))
    _light(colx, "WW_fill" + sfx, (3, -3, 2), (0, 0, 1.2), 200, 4.0, (0.85, 0.9, 1.0))
    sets["wall_walnut"] = (colx, (0.8, -4.5, 1.6), (0.0, 0.0, 1.25), 32, (1280, 800))
    sets["wall_walnut_near"] = (colx, (-0.9, -1.3, 1.5), (-1.2, 0.0, 1.35), 40, (1280, 800))
    colx = coll("Vig_Ashlar")
    _quad("AW_wall" + sfx, [(-6, 0, 0), (6, 0, 0), (6, 0, 8), (-6, 0, 8)],
          [(-6 / 2.4, 0), (6 / 2.4, 0), (6 / 2.4, 8 / 2.4), (-6 / 2.4, 8 / 2.4)], M("limestone"), colx)
    _plane("AW_floor" + sfx, -6, 6, -10, 0, 0, M("marble_checker"), lambda x, y: (x / 1.2, y / 1.2), colx)
    _light(colx, "AW_sun" + sfx, (-3, -2, 2.5), (0, 0, 0), 3.0, kind="SUN", color=(1.0, 0.9, 0.78), angle=2)
    _light(colx, "AW_fill" + sfx, (2, -6, 4), (0, 0, 3), 900, 8.0, (0.85, 0.9, 1.0))
    sets["wall_ashlar"] = (colx, (1.0, -9.0, 1.7), (0.0, 0.0, 3.2), 28, (1280, 800))
    colx = coll("Vig_Floors")
    _plane("FE_floor" + sfx, -6, 0, -2, 14, 0, M("parquet_herringbone"), lambda x, y: (x / 1.6, y / 1.6), colx)
    _plane("FE_floor2" + sfx, 0, 6, -2, 14, 0, M("oak_boards"), lambda x, y: (y / 2.0, x / 2.0), colx)
    _light(colx, "FE_sun" + sfx, (-2, 6, 1.2), (0, 0, 0), 3.0, kind="SUN", color=(1.0, 0.9, 0.78), angle=3)
    _light(colx, "FE_fill" + sfx, (0, -3, 4), (0, 4, 0), 300, 6.0, (0.85, 0.9, 1.0))
    sets["floor_eye"] = (colx, (0.0, -1.5, 1.7), (0.0, 6.0, 0.0), 30, (1280, 800))
    colx = coll("Vig_Table")
    top = C.box("TT_top" + sfx, (1.0, 4.0, 0.05), (0, 0, 0.735), M("tabletop"), bevel_w=0.006, segments=3, col=colx)
    C.uv_box(top, size=LM.tex_size("tabletop"), grain="y")
    _plane("TT_floor" + sfx, -5, 5, -5, 8, 0, M("parquet_herringbone"), lambda x, y: (x / 1.6, y / 1.6), colx)
    _light(colx, "TT_lamp" + sfx, (0.2, 0.6, 1.45), (0, 0.6, 0.76), 60, 0.4, (1.0, 0.82, 0.6))
    _light(colx, "TT_lamp2" + sfx, (-0.2, -1.0, 1.45), (0, -1.0, 0.76), 60, 0.4, (1.0, 0.82, 0.6))
    _light(colx, "TT_fill" + sfx, (3, -4, 3), (0, 0, 0.7), 200, 5.0, (0.85, 0.9, 1.0))
    sets["tabletop_eye"] = (colx, (0.35, -3.2, 1.65), (0.0, 0.6, 0.74), 35, (1280, 800))
    return sets


def preview(out_dir):
    """Regenerates the textures, applies the fitted palette in memory (apply_palette_fit) and
    renders with mat_fitted (fitted tints + gilt metal mask): swatch boards of every palette key,
    the shared-texture calibration board (today vs fitted vs base chip), tiled checks and
    in-context close-ups at room scale."""
    if os.environ.get("OVR_TEX_SKIP") != "1":
        only = [t for t in os.environ.get("OVR_TEX", "").split(",") if t]
        build_textures(names=only or None)
    else:
        write_palette_fit()
    which = os.environ.get("OVR_TEX_PREVIEW", "boards,fitted,checks,closeups").split(",")
    only_sets = [s for s in os.environ.get("OVR_TEX_SETS", "").split(",") if s]
    print("TINTS (today's palette vs fitted tints, error = worst channel vs base):")
    for line in tint_report():
        print(line)
    if "fitted" in which:
        for key in FITTED_KEYS:          # today's materials, built before the palette changes
            LM.mat(key)
    print("PALETTE CHANGES applied for the preview:", json.dumps(apply_palette_fit()))
    scene = bpy.context.scene
    import lib_render as R
    R.world(scene, (0.32, 0.31, 0.3), 0.25)
    paths = []
    if "boards" in which:
        keys = LM.all_keys()
        per = 21
        for bi in range(0, len(keys), per):
            k = bi // per + 1
            colx, objs = build_swatch_board(keys[bi:bi + per], f"Board_{k}")
            _only(colx)
            rows = (len(keys[bi:bi + per]) + 6) // 7
            cx, cy = 6 * 0.62 / 2, (rows - 1) * 1.0 / 2
            _cam((cx, cy - 4.0, 5.5), (cx, cy - 0.2, 0.0), lens=50)
            paths.append(_render(out_dir, f"swatches_{k}", (1280, 960)))
            for o in objs:
                if o.type == "MESH" and o.name.startswith("Swatch_"):
                    print(f"TRIS {o.name}: {C.tris(o)}")
    if "fitted" in which:
        colx, (w, h) = build_fitted_board()
        _only(colx)
        _cam((w / 2, h / 2 - 5.2, 5.6), (w / 2, h / 2 - 0.5, 0.0), lens=40)
        paths.append(_render(out_dir, "swatches_fitted", (1400, 900)))
    if "checks" in which:
        for key, layout, reps in TILE_CHECKS:
            if only_sets and key not in only_sets:
                continue
            colx, (w, h) = build_tile_check(key, layout, reps)
            _only(colx)
            asp = w / h
            size = (960, int(round(960 / asp))) if asp >= 1 else (int(round(960 * asp)), 960)
            _cam((w / 2, h / 2, 10), (w / 2, h / 2, 0), ortho=max(w, h))
            paths.append(_render(out_dir, f"tiled_{key}", size, samples=24))
    if "closeups" in which:
        sets = build_closeups(mat_fitted)
        for name, (colx, loc, tgt, lens, size) in sets.items():
            if only_sets and name not in only_sets:
                continue
            _only(colx)
            _cam(loc, tgt, lens=lens)
            paths.append(_render(out_dir, name, size))
    print("SEAMS (edge difference / interior difference, ~1 = seamless):")
    for line in seam_report():
        print(line)
    print("PREVIEW_IMAGES", " ".join(paths))
    return paths


def _cli():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    names = [a for a in args if not a.startswith("-")] or None
    build_textures(names=names)


if __name__ == "__main__":
    _cli()
