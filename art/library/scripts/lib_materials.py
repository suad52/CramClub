"""
The library's material palette. Every asset asks for materials by key (`mat("walnut")`), so the
whole building shares ~40 materials (cheap in the browser, consistent to the eye).

Textures are optional: if art/library/textures/<tex>_color.png (and _rough / _normal) exist they
are used, otherwise the flat colour below. A <tex>_metal.png (gold leaf on coffers, the frieze and
book titles) drives Metallic and keeps the gilt out of the tint / object-colour multiply. Tints are
fitted by textures.py so each key renders at its base colour (textures/palette_fit.json). Texture tiles cover `size` metres, and assets must
UV-map at that scale: `uv_box(ob, size=tex_size("walnut"), grain="z")`.
"""

from __future__ import annotations

import os

import bpy

from lib_core import TEXTURES

# key: base colour (sRGB hex), roughness, metallic, texture id, tile size (m), normal strength, extras
PALETTE = {
    # Woods
    "walnut": dict(base="#4a2d1b", rough=0.38, tex="walnut", size=1.6, normal=0.35),
    "walnut_dark": dict(base="#2e1b11", rough=0.4, tex="walnut", size=1.6, normal=0.35, tint="#a9aebd"),
    "mahogany": dict(base="#5b2416", rough=0.36, tex="mahogany", size=1.6, normal=0.3),
    "oak": dict(base="#a06c3a", rough=0.45, tex="oak", size=0.8, normal=0.3, tint="#d1b599"),
    "oak_light": dict(base="#c49a66", rough=0.5, tex="oak", size=0.8, normal=0.3),
    "oak_stained": dict(base="#3a2818", rough=0.4, tex="oak", size=0.8, normal=0.4, tint="#5c5660"),
    "tabletop": dict(base="#a8743f", rough=0.28, tex="oak_tabletop", size=1.2, normal=0.2),
    # Floors
    "parquet_herringbone": dict(base="#8a5a33", rough=0.32, tex="parquet_herringbone", size=1.6, normal=0.5),
    "parquet_radial": dict(base="#8a5a33", rough=0.32, tex="parquet_herringbone", size=1.6, normal=0.5),
    "oak_boards": dict(base="#94643a", rough=0.4, tex="oak_boards", size=2.0, normal=0.5),
    "marble_checker": dict(base="#d9d2c4", rough=0.18, tex="marble_checker", size=1.2, normal=0.15),
    "stone_tiles": dict(base="#bdb2a0", rough=0.6, tex="stone_tiles", size=1.2, normal=0.6),
    "carpet_quiet": dict(base="#41584a", rough=0.95, tex="carpet", size=1.0, normal=0.4, tint="#607f69"),
    "carpet_tiles": dict(base="#4a5368", rough=0.95, tex="carpet", size=1.0, normal=0.4, tint="#6c7892"),
    # Walls, stone, ceilings
    "limestone": dict(base="#d6c4a3", rough=0.82, tex="limestone_ashlar", size=2.4, normal=0.8),
    "limestone_plain": dict(base="#d9c8a8", rough=0.85, tex="limestone", size=1.5, normal=0.5),
    "plaster": dict(base="#e8dcc5", rough=0.9, tex="plaster", size=2.0, normal=0.3),
    "plaster_green": dict(base="#8f9f86", rough=0.9, tex="plaster", size=2.0, normal=0.3, tint="#9eb9af"),
    "coffer_panel": dict(base="#2c3d3a", rough=0.6, tex="coffer_panel", size=1.4, normal=0.9, tint="#7ba8a5"),
    "coffer_red": dict(base="#5e2420", rough=0.6, tex="coffer_panel", size=1.4, normal=0.9, tint="#f26b65"),
    "ornament_band": dict(base="#7a5a2e", rough=0.5, tex="ornament_band", size=0.6, normal=1.0),
    "gilt": dict(base="#c99b47", rough=0.32, metal=1.0),
    # Metals
    "brass": dict(base="#b58a42", rough=0.26, metal=1.0, tex="brushed", size=0.3, normal=0.15),
    "brass_aged": dict(base="#8c6a36", rough=0.38, metal=1.0, tex="brushed", size=0.3, normal=0.15),
    "bronze": dict(base="#4a3a28", rough=0.42, metal=1.0),
    "bronze_satin": dict(base="#6f5234", rough=0.3, metal=1.0, tex="brushed", size=0.3, normal=0.22),
    "bronze_patina": dict(base="#2a2119", rough=0.5, metal=0.85),
    "aluminium": dict(base="#8f9399", rough=0.34, metal=1.0, tex="brushed", size=0.3, normal=0.08),
    "iron": dict(base="#1b1a19", rough=0.52, metal=0.7),
    "chrome": dict(base="#c8ccd0", rough=0.12, metal=1.0),
    # Glass and light
    "glass": dict(base="#e6eef0", rough=0.04, alpha=0.16, transmission=True),
    "glass_window": dict(base="#cfe0ea", rough=0.03, alpha=0.12, transmission=True),
    "glass_laylight": dict(base="#b9cfe6", rough=0.2, alpha=0.88, emission="#cfe2f8", emit=1.6),
    "glass_laylight_field": dict(base="#4b5f7a", rough=0.2, alpha=0.88, emission="#a9c5ec", emit=0.80),
    "glass_laylight_cool": dict(base="#34496a", rough=0.2, alpha=0.88, emission="#7f9fd4", emit=0.78),
    "glass_laylight_pale": dict(base="#6b6e68", rough=0.2, alpha=0.88, emission="#e8e7da", emit=0.72),
    "glass_laylight_deep": dict(base="#1c2a46", rough=0.2, alpha=0.92, emission="#3f63a8", emit=0.72),
    "glass_laylight_amber": dict(base="#563a12", rough=0.2, alpha=0.92, emission="#e2a446", emit=0.62),
    "glass_green": dict(base="#1d6a3c", rough=0.12, alpha=0.92),
    # Opaque cased green glass (banker's lamp): clear coat + pale sheen; the _lit twin glows.
    "glass_green_cased": dict(base="#1b4630", rough=0.1, emission="#2a7a4a", emit=0.06, coat=1.0, coat_rough=0.03,
                              sheen=0.6, sheen_tint="#bfe3cc", sheen_rough=0.35),
    "glass_green_cased_lit": dict(base="#1b4630", rough=0.1, emission="#1f9a4c", emit=1.6, coat=1.0, coat_rough=0.03,
                                  sheen=0.6, sheen_tint="#bfe3cc", sheen_rough=0.35),
    "glass_frosted": dict(base="#f3efe6", rough=0.35, alpha=0.9, emission="#ffe2b0", emit=1.2),
    "bulb": dict(base="#fff0d0", rough=0.3, emission="#ffd59a", emit=9.0),
    "bulb_soft": dict(base="#fff4e0", rough=0.3, emission="#ffdcae", emit=3.0),
    "led_strip": dict(base="#ffe2b4", rough=0.4, emission="#ffcf8f", emit=5.0),
    "screen": dict(base="#1c2430", rough=0.2, emission="#2b4766", emit=0.6),
    "exit_green": dict(base="#06592a", rough=0.3, emission="#00a347", emit=1.4),
    "exit_white": dict(base="#f2fff6", rough=0.3, emission="#f0fff4", emit=2.2),
    # Soft goods
    "leather_brown": dict(base="#5a3220", rough=0.5, tex="leather", size=0.5, normal=0.5, tint="#f5d2bd"),
    "leather_burgundy": dict(base="#5e1f22", rough=0.48, tex="leather", size=0.5, normal=0.5, tint="#ff8fc6"),
    "leather_green": dict(base="#263f2f", rough=0.48, tex="leather", size=0.5, normal=0.5, tint="#74ffff"),
    "velvet_olive": dict(base="#5b5f36", rough=0.85, tex="fabric", size=0.4, normal=0.4, tint="#6d794f"),
    "fabric_green": dict(base="#2f4a3a", rough=0.9, tex="fabric", size=0.4, normal=0.4, tint="#395f54"),
    "fabric_cream": dict(base="#d8ccb4", rough=0.92, tex="fabric", size=0.4, normal=0.4, tint="#fffffb"),
    "rug_red": dict(base="#7a2a22", rough=0.95, tex="rug_runner", size=1.6, normal=0.5),
    "rug_persian": dict(base="#6e2a24", rough=0.95, tex="rug_persian", size=4.6, normal=0.5),
    "paper": dict(base="#efe6d2", rough=0.85),
    "silk_shade": dict(base="#ead9b8", rough=0.88, emission="#ffd49a", emit=0.55, tex="fabric", size=0.4, normal=0.3,
                       tint="#f4e6cc"),
    "book_pages": dict(base="#d6c8aa", rough=0.88),
    "label_card": dict(base="#bfae8a", rough=0.9),
    "label_ink": dict(base="#2a2420", rough=0.7),
    "felt_green": dict(base="#2f5a3c", rough=0.95),
    "book_cloth": dict(base="#7a3a2a", rough=0.62, tex="book_spines", size=1.0, normal=0.4, object_color=True),
    # Plastics / modern
    "plastic_dark": dict(base="#1c1c1e", rough=0.45),
    "plastic_light": dict(base="#d9d6cf", rough=0.5),
    "whiteboard": dict(base="#f4f4f2", rough=0.18),
    "cork": dict(base="#a87a4e", rough=0.95, tex="cork", size=0.5, normal=0.4),
    "foliage": dict(base="#3f6a35", rough=0.7, double_sided=True),
    "terracotta": dict(base="#a5583a", rough=0.8),
    "sky": dict(base="#a9c6e3", rough=1.0, emission="#bcd5ee", emit=1.0, unlit=True),
    "ivory_paint": dict(base="#e9e0cc", rough=0.6),
    "signage": dict(base="#1f3a2c", rough=0.5),
    "signage_text": dict(base="#e9d9a6", rough=0.4, metal=0.6),
}


def tex_size(key):
    return PALETTE[key].get("size", 1.0)


def _hex(h, a=1.0):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    lin = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return (*lin, a)


def _image(tex, kind):
    for ext in (".png", ".jpg"):
        path = os.path.join(TEXTURES, f"{tex}_{kind}{ext}")
        if os.path.exists(path):
            img = bpy.data.images.load(path, check_existing=True)
            if kind != "color":
                img.colorspace_settings.name = "Non-Color"
            return img
    return None


_EXTRA_INPUTS = {"coat": "Coat Weight", "coat_rough": "Coat Roughness", "sheen": "Sheen Weight",
                 "sheen_rough": "Sheen Roughness", "sheen_tint": "Sheen Tint"}


def mat(key):
    """The shared material for a palette key (created on first use)."""
    name = "M_" + "".join(w.capitalize() for w in key.split("_"))
    m = bpy.data.materials.get(name)
    if m:
        return m
    spec = PALETTE[key]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except AttributeError:
        pass
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    out = next(n for n in nt.nodes if n.type == "OUTPUT_MATERIAL")
    bsdf.inputs["Roughness"].default_value = spec.get("rough", 0.6)
    bsdf.inputs["Metallic"].default_value = spec.get("metal", 0.0)
    base = _hex(spec["base"])
    bsdf.inputs["Base Color"].default_value = base
    m.diffuse_color = base
    tex = spec.get("tex")
    color_img = _image(tex, "color") if tex else None
    metal_img = _image(tex, "metal") if tex else None
    metal_out = None
    if metal_img:
        mn = nt.nodes.new("ShaderNodeTexImage")
        mn.image = metal_img
        mn.location = (-900, 600)
        metal_out = mn.outputs["Color"]
        nt.links.new(metal_out, bsdf.inputs["Metallic"])
        m["ovr_gilt"] = True
    if color_img:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = color_img
        node.location = (-600, 300)
        src = node.outputs["Color"]
        tint = spec.get("tint")
        if tint or spec.get("object_color"):
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs["Factor"].default_value = 1.0
            mix.location = (-300, 300)
            if metal_out is not None:  # gold leaf keeps its own colour
                inv = nt.nodes.new("ShaderNodeMath")
                inv.operation = "SUBTRACT"
                inv.inputs[0].default_value = 1.0
                inv.location = (-500, 550)
                nt.links.new(metal_out, inv.inputs[1])
                nt.links.new(inv.outputs[0], mix.inputs["Factor"])
            nt.links.new(src, mix.inputs["A"])
            if spec.get("object_color"):
                info = nt.nodes.new("ShaderNodeObjectInfo")
                info.location = (-600, 0)
                nt.links.new(info.outputs["Color"], mix.inputs["B"])
            else:
                mix.inputs["B"].default_value = _hex(tint)
            src = mix.outputs["Result"]
        nt.links.new(src, bsdf.inputs["Base Color"])
    elif spec.get("object_color"):
        info = nt.nodes.new("ShaderNodeObjectInfo")
        nt.links.new(info.outputs["Color"], bsdf.inputs["Base Color"])
    rough_img = _image(tex, "rough") if tex else None
    if rough_img:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = rough_img
        node.location = (-600, -50)
        nt.links.new(node.outputs["Color"], bsdf.inputs["Roughness"])
    normal_img = _image(tex, "normal") if tex else None
    if normal_img:
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = normal_img
        node.location = (-800, -350)
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nmap.inputs["Strength"].default_value = spec.get("normal", 0.5)
        nmap.location = (-400, -350)
        nt.links.new(node.outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    if "emission" in spec:
        bsdf.inputs["Emission Color"].default_value = _hex(spec["emission"])
        bsdf.inputs["Emission Strength"].default_value = spec.get("emit", 1.0)
    for field, socket in _EXTRA_INPUTS.items():
        if field in spec:
            val = spec[field]
            bsdf.inputs[socket].default_value = _hex(val) if isinstance(val, str) else val
    if "alpha" in spec:
        bsdf.inputs["Alpha"].default_value = spec["alpha"]
        try:
            m.surface_render_method = "BLENDED"
        except AttributeError:
            m.blend_method = "BLEND"
        m.use_backface_culling = False
    if spec.get("transmission"):
        bsdf.inputs["Transmission Weight"].default_value = 0.0  # keep glTF simple: alpha-blended glass
    if spec.get("double_sided"):
        m.use_backface_culling = False
    else:
        m.use_backface_culling = "alpha" not in spec
    if spec.get("unlit"):
        m["ovr_unlit"] = True
    return m


def all_keys():
    return list(PALETTE)
