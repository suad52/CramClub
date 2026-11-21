# OVR Library — asset contract

Everything in the library is modelled by Python scripts in `art/library/scripts/` run in headless
Blender 5.3 (`/Applications/Blender.app/Contents/MacOS/Blender`). This file is the contract every
asset module follows so the pieces fit together.

## Art direction (read this first)

A grand historic university library, cared for and used by students today. It's warm, quiet,
monumental but welcoming. It mixes classical and restrained neo-Gothic detail. The materials are
dark walnut and mahogany, honey oak, warm limestone and ivory plaster, aged brass, blackened
wrought iron, leather and green glass. The space has cool daylight through big arched windows and
warm pools of lamplight. Reference photos (for mood and craft, don't copy a building):
`art/library/reference/ref1.jpg` … `ref5.jpg`.
1 is a stone hall with huge arched windows, a tiered ring chandelier, long tables and brass lamps.
2 is a dark coffered timber ceiling with a gallery on turned balusters and arcaded bookcases.
3 is a domed rotunda with a glass roof, oculi and green lamps.
4 is a carved cornice and painted coffers, an arched window and an iron gallery railing.
5 is a curved multi-tier rotunda with slender columns.

**Quality bar: high detail, clean and sleek. This is not a low-poly game kit.** Every visible edge
is bevelled (0.002–0.012 m). Turned parts (legs, balusters, finials, lamp stems, column shafts)
use `lathe` with real profiles. Mouldings, cornices, handrails and frames use `sweep` with proper
architectural profiles (ogee, cove, bead, fillet, astragal). Furniture shows its construction:
aprons, stretchers, rails, panels, brass hardware. Proportions are believable at avatar scale
(1.7 m person). No z-fighting, no floating parts, no gaps, no inverted normals, no stretched
textures. Use `weighted_normals`/`bevel(..., harden=True)` for crisp shading.

**Browser budget** is generous but real (triangles per asset): chair ≤ 9k, long table ≤ 12k,
desk lamp ≤ 5k, chandelier ≤ 70k, window bay ≤ 20k, coffered ceiling per 5.6 m bay ≤ 25k,
gallery per 5.6 m run ≤ 25k (balusters are instanced), bookcase per metre ≤ 2.5k (without books),
one book variant ≤ 160. Repeated parts (balusters, bulbs, rosettes, books) should be built once
and instanced (`instance(...)`).

## Coordinates

- Metres, Blender Z up. Build each asset **at the origin**, with its **floor contact at z = 0**
  and its **front facing −Y** (−Y in Blender is +Z on the web, the direction `rot` turns).
  Wall-mounted pieces (windows, boards, sconces) are built with the wall's inner face on the
  plane y = 0, and the room on the −Y side.
- The floor plan lives in `art/library/scripts/plan.py`. It uses web coordinates
  (+X east, +Y up, +Z south). Convert with `lib_core.bl(x, y, z)` / `place(ob, x, y, z, rot)`.
- Sizes in `plan.KINDS` (w = local X, d = local Z/depth, h) are collision footprints. Builders
  must fill them: a `table_communal` is 1.0 × 4.0 m × 0.76 m high, with its long axis along the
  front direction (Blender Y).

## Toolkit

- `lib_core`: `box`, `box_minmax`, `cylinder`, `sphere`, `torus`, `lathe`, `sweep`, `prism`,
  `arch_points`, `arched_outline`, `panel_frame`, `bevel`, `weighted_normals`, `shade_smooth`,
  `subdivide`, `join`, `instance`, `empty`, `uv_box`, `uv_grain_auto`, `uv_cylinder`,
  `collection`, `place`, `bl`, `tris`.
- `lib_materials.mat(key)`: the shared palette. **Only use palette keys** (add a new key there
  only if nothing fits, and say so). `tex_size(key)` is the real-world tile size: always UV with
  it (`uv_box(ob, size=tex_size("walnut"), grain="z")`). Wood grain must run along each part's
  length.
- `lib_render.preview_objects(objs, out_dir, name, views, closeups=...)`: studio renders.

## Module shape

Each module (e.g. `furn_hall.py`) exposes:

- `build_<kind>(...) -> bpy object` (or a list/collection), at the origin, joined per material
  where sensible, with a clear name (`Furniture_Table_Communal`, `Light_Chandelier_Grand`, …).
- `preview(out_dir)`, which builds everything in the module, renders it from 3+ angles plus
  close-ups of the details, and prints the triangle count per asset.

Run it: `Blender -b --factory-startup --python-exit-code 1 --python art/library/scripts/run_asset.py -- --module <name> --out <dir>`.
Then look at the PNGs (contact sheet: `python3 art/library/scripts/sheet.py OUT.png 3 480 imgs...`).
Iterate until it looks like it belongs in the reference photos.

## Naming

- Objects follow the brief: `Architecture_Window_Arched_01`, `Furniture_Table_Communal_01`, `Furniture_Chair_Wood_01`, `Shelf_Wall_MainHall_01`, `Light_Chandelier_MainHall_01`, `Prop_Lamp_Brass_01`, …
- Never leave `Cube.037`-style names.

## Furniture registry (plan kinds)

Furniture modules expose `KIND_BUILDERS = {"<plan kind>": builder}`. A builder takes the
`plan.Item` (use its `seed`, `label`, `w`/`d` where relevant) and returns ONE root object (a mesh, or
an empty with children) at the origin, floor at z = 0, front facing −Y, filling the plan.KINDS
footprint (w along X, d along Y). The scene assembly calls it once per distinct (kind, variant) and
places linked copies at each item with `lib_core.place(root, item.x, item.y, item.z, item.rot)`.
Return the same variant for the same seed, so copies can be shared.

- Seating kinds must put the seat surface at `seat_h` and the seat centres at `seats` offsets.
- Wall-mounted kinds (`shape: "none"` with `mount_y`): the item point lies ON the wall's inner face,
  so build with the back on the plane y = 0 and the room on −Y. z = 0 is still the floor, and the
  bottom edge of the board sits at `mount_y`.
- Light-emitting props carry custom props `light_points` (list of local (x, y, z)) and `light_color`,
  as furn_hall's lamps do, so the scene and the web can add real lights there.

## More budgets (triangles)

Sofa ≤ 16k, armchair ≤ 12k, side/coffee table ≤ 6k, floor lamp ≤ 6k, fireplace with fire ≤ 30k,
carrel with lamp ≤ 10k, group table ≤ 10k, task chair ≤ 9k, computer desk with screen and keyboard
≤ 10k, printer station ≤ 8k, info desk ≤ 30k, ring desk ≤ 40k, display cabinet ≤ 18k, vitrine ≤ 12k,
plant ≤ 14k, globe ≤ 10k, sign ≤ 2k, stair flight with balustrade ≤ 60k, rotunda architecture
≤ 450k (dome ≤ 150k), interior dressing per room ≤ 60k, exterior ≤ 200k.

## Rendering lessons

- Single assets: EEVEE studio previews are fine. A whole room with many lights and thousands of
  objects: use Cycles (`lib_render.engine(scene, "CYCLES", 32, size)`). EEVEE hung for 20+
  minutes on the assembled hall.
- When you collect objects by name prefix, filter `o.parent is None`. Children share their parent's
  prefix, and that once spawned thousands of stray lights.
- In Cycles, shadowless lights shine through walls. Keep stand-in fills inside their own room.
