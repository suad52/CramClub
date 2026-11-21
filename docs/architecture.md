# Architecture

## Source brief

OVR follows the "Virtual Library — Implementation Brief": a browser-based multiplayer 3D library
built in seven phases (copied into [implementation-brief.md](implementation-brief.md)). This document records how the code is organized and every decision made
where the brief left room.

## Packages

```text
apps/web            Next.js 16 (App Router) + React 19 + React Three Fiber 9
apps/game-server    Colyseus 0.18 on Node, WebSocket transport
packages/shared     Pure TypeScript shared by both apps, no rendering dependencies
packages/config     ESLint flat config for the Node packages
```

`@ovr/shared` ships TypeScript source. Next compiles it via `transpilePackages`, the server's
dev mode runs it through `tsx`, and the server's production build bundles it with `tsup`.

## One floor plan, two consumers

`packages/shared/src/world/layout.ts` is the single description of the library: room bounds,
windows, zones, every furniture item (kind, position, rotation, stable id), seats and spawn
points. Everything else is derived from it:

- **Colliders** (`collision.ts`): oriented boxes and circles on the floor plane, plus the four
  walls. Movement is a circle sliding against them in sub-steps, so a long frame can't tunnel
  through furniture. The camera uses the same colliders, with obstacle heights, so it can look
  over a table but not through a shelf.
- **Rendering** (`apps/web/lib/world`): each furniture kind has a builder that assembles simple
  shapes.
- **Server validation** (Phase 3) will run the same `moveWithCollisions` against the same data.

The layout tests (`world.test.ts`) prove there is no overlapping furniture, every spawn point is
free, a player can stand up from every seat, and a flood fill from the entrance reaches every
seat. Edit the layout freely; the tests catch a blocked aisle.

Stable ids matter: collaborative tables are `collab-table-1…4` and each owns a whiteboard with
the same `tableId`. Phase 5 can key shared boards on those ids.

## Rendering

- **The world is procedural.** Furniture, walls and trees are built from boxes, cylinders and
  spheres, and canvas-drawn textures cover the floor planks, rugs, signs, notice boards and
  globe. The one download is the avatar kit: a 2 MB meshopt GLB modelled by Blender scripts
  (see [avatar-pipeline.md](avatar-pipeline.md)).
- **Few draw calls.** Static parts are merged into one mesh per material class (solid, metal,
  glow, glass) with colours baked into vertices. The ~10,700 books are a single `InstancedMesh`.
  An avatar shows about 20 of the kit's parts (hidden parts cost nothing). A frame is
  ~210 draw calls, including shadows and post-processing.
- **Lighting:** a low sun casts window-shaped light through real openings in the walls (the
  walls and ceiling cast shadows). There is a hemisphere fill, warm pendant and chandelier
  point lights, a flickering fire, and a small local `Environment` made of light formers, so no
  HDR download is needed.
- **Post-processing:** N8AO ambient occlusion, bloom for lamps and fire, Khronos Neutral tone
  mapping and a vignette. AgX was tried first and washed the fire out to beige. The renderer
  uses the same Neutral curve when the Low quality setting turns post-processing off.

## Client state

- `lib/game/store.ts` (zustand) holds UI-facing state: camera mode, menus, current zone, nearby
  seat, seat, and persisted settings (`localStorage` key `ovr.preferences`).
- `lib/game/runtime.ts` is a plain mutable object for per-frame data (position, velocity,
  facing, camera yaw/pitch, blends). It is kept out of React on purpose: it changes every frame.
  Only derived changes (zone, nearby seat) are pushed into the store.
- Frame order: `LocalPlayer` (priority −2) moves the player, then `CameraRig` (−1) places the
  camera, then everything else renders.

## Input

- Keyboard: physical key codes (`KeyW`…), so WASD stays put on AZERTY and other layouts. Keys
  are released on window blur so none get stuck.
- Mouse look: pointer lock when the browser allows it, otherwise click-and-drag. The embedded
  browser used during development refuses pointer lock, so the fallback is a real need, not
  just insurance.
- Every keyboard action also has an on-screen control (camera toggle, interact prompt, menu).

## Expression tracking (prototype)

```text
webcam ─► MediaPipe Face Landmarker (in the browser, GPU → CPU fallback)
        ─► blendshapes + head matrix
        ─► extractRawFace ─► calibrate against the resting face ─► One Euro smoothing
        ─► faceState.params (8 numbers) ─► Avatar animation (head, eyes, brows, mouth)
```

- `lib/facial-tracking/mapping.ts`: pure, unit-tested maths. Head angles come from the
  column-major facial transformation matrix; the signs are documented on `FacialParams`.
- `lib/facial-tracking/tracker.ts`: camera, model, frame loop, status store. The camera opens
  only from the user's click, and `stopTracking()` stops every track. Leaving the library also
  calls it.
- Nothing loads from a third party. The wasm runtime is copied from `node_modules` into
  `public/mediapipe/` by `scripts/copy-assets.mjs` (part of `dev` and `build`, git-ignored).
  The model (`public/models/face_landmarker.task`, 3.76 MB) is committed. Its source and
  checksum are in `public/models/README.md`. `NEXT_PUBLIC_FACE_MODEL_URL` can move it to a CDN.
- The avatar blends between its idle face and the tracked face, so losing your face relaxes
  smoothly instead of snapping.
- `FacePreview` renders a second, small view of the avatar's face after the main frame using a
  scissor viewport. In Low quality it draws the main view itself, because R3F stops
  auto-rendering when a frame callback has a positive priority.
- For multiplayer, only the eight `FacialParams` values will be sent, about 10×/s and only
  when they change. They are already part of `PlayerSnapshot`.

## AI whiteboard

```text
draw (pointer events) ─► strokes (perfect-freehand) ─► localStorage per table ─► 3D board texture
Ask AI: box ─► PNG crop ─► POST /api/ai/whiteboard/solve ─► Gemini text model ─► {question, answer, lines}
        ─► plan a blank area next to the question at the user's letter size (geometry.ts)
        ─► PNG of question + blank area ─► POST /api/ai/whiteboard/handwrite ─► Gemini image model
        ─► keep only new ink inside the blank area, recoloured to the pen colour (ink.ts) ─► image item
        (no billing / failure ─► lines laid out as pen strokes in EMS Tech, a single-line font,
         then written out stroke by stroke on the board; Caveat text only if that font fails)
```

- The board is a custom canvas, not tldraw. We need to own the stroke data for the AI overlay,
  the 3D texture and the planned Yjs sync, and it avoids tldraw's production licence.
- Model choice (tested Nov 2026): `gemini-4-hydrogen` reads and answers in ~2 s. The 3.x Flash
  models timed out (504) with this key, so they're not the default. `gemini-3.5-flash-lite` is the
  automatic backup on 429/5xx/timeout. Every call has a timeout (25 s to read, 60 s to write), and
  the image call has SDK retries off, because a free-tier refusal never succeeds on retry.
- After a "no billing" refusal, the handwrite route skips the image model for 10 minutes. Restart
  the dev server after turning billing on.
- Answers use the dominant ink colour and pen size of the question, not the selected pen.
- Writing out: `strokeFont.ts` parses the single-line SVG font, measuring the real capital
  height from "H" (the file's declared metrics are wrong) and adding the missing maths symbols.
  It lays text out as strokes with small seeded wobbles. `writer.ts` schedules them (pen-up
  pauses, about 10 line-heights of ink a second, 1.5–9 s in total), and the board animates them
  with a pen tip before committing everything as one undo step. EMS Tech is SIL OFL; the SVG,
  with its credits header, is copied from `hersheytext` by `scripts/copy-assets.mjs`.
- `lib/ai/gemini.ts` is server-only (`server-only` import). It uses `generateContent` with a JSON
  schema to read and answer, and `interactions.create` (with `store: false`) for image editing,
  as Google's current docs show. In API v1, the image and prompt must be wrapped in a
  `user_input` step; bare `image` parts are v1beta-only. Models can be overridden with `GEMINI_TEXT_MODEL` and
  `GEMINI_IMAGE_MODEL`.
- The routes validate input (PNG data URLs only, size caps, strict fields) and rate-limit per
  client in memory (20 solves and 10 handwritings a minute). They never log image data.
- The image model must get an aspect ratio it supports, so the crop is padded (never cropped)
  to the closest one (`chooseAspectRatio`). The model's output is scaled back before the ink is
  extracted, so it lines up with the board exactly.

## Game server

`LibraryRoom` sets `maxClients = 15`. Colyseus locks a full room and `joinOrCreate` opens a new
one; `server.test.ts` proves the 16th seat goes to a second room. Joining takes a signed ticket
from the web app; the room syncs every player, validates movement, owns seats and relays faces.
See [multiplayer.md](multiplayer.md). Colyseus 0.18 is used through `defineServer` /
`defineRoom` / `createRouter`.

## Decisions and assumptions

| Topic            | Decision                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Product name     | Site is branded **OVR** (repo name); "Virtual Library" is the concept                                                          |
| Avatars          | Modelled in Blender by scripts (owner's request), one skinned GLB; parts toggled and recoloured per avatar                     |
| `AvatarConfig`   | v2: ids for every category, two sliders, accessory list (one per slot); v1 saves migrate on load                               |
| Creator flow     | Title screen → Character Studio → swoop in; the library canvas pauses while the studio (its own canvas) is open                |
| Study status ids | `available` / `focused` / `collaborating` / `away`, with the brief's labels for display                                        |
| Movement         | Walk 3.2 m/s; R toggles walking faster (5.4 m/s), which the server must allow; holding Shift frees the mouse (owner's request) |
| Devices          | Desktop only for now (owner's choice); touch devices see a clear notice                                                        |
| Entry            | Guest entry with no sign-in in Phase 1; Supabase auth arrives with profiles                                                    |
| AI provider      | Gemini for the whiteboard (owner's choice); the brief's OpenAI/ElevenLabs plan for the AI teacher is still open                |
| TypeScript       | Pinned to 6.0: TS 7 is out, but typescript-eslint supports < 6.1                                                               |
| ESLint           | 9.x: Next's lint plugins don't support ESLint 10 yet                                                                           |
| pnpm safety      | Kept pnpm's minimum-release-age rule; pinned slightly older vitest / @colyseus/schema rather than exempting them               |
| Shadow map       | `PCFShadowMap` (three r187 removed `PCFSoftShadowMap`)                                                                         |

## Visual references

No reference images came with the brief. If you add some, put them in `docs/visual-references/`
and describe what each one is for. Use them as direction, not something to copy.
