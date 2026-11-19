# OVR

A cozy, browser-based 3D university library where students study alongside each other as
avatars, with no camera needed. Built in stages from the
[implementation brief](docs/implementation-brief.md).

**Status:** Phase 0 (foundation) and Phase 1 (3D library prototype) are done, plus an early
opt-in prototype of webcam expression tracking. One player can
enter the library, walk around with WASD, switch between first and third person, and sit at
tables, desks, window seats and sofas. Multiplayer, voice, whiteboards, sharing expressions with
other players and the AI teacher are later phases. See [docs/features.md](docs/features.md).

## Requirements

- Node.js 22.12 or newer (developed on Node 26)
- pnpm 12 (`npm install -g pnpm`; Node 25+ no longer bundles corepack)
- A desktop browser with WebGL 2 (recent Chrome, Edge, Firefox or Safari)

## Getting started

```bash
pnpm install
```

```bash
pnpm dev
```

That starts both apps:

| App         | URL                   | What it is                                   |
| ----------- | --------------------- | -------------------------------------------- |
| Web         | http://localhost:3000 | Landing page and the 3D library (`/library`) |
| Game server | ws://localhost:2567   | Colyseus server; health at `/health`         |

Run either alone with `pnpm dev:web` or `pnpm dev:server`. Everything works without environment
variables except **Ask AI** on the whiteboards. For that, create `apps/web/.env.local` with
`GEMINI_API_KEY=…` (see `.env.example`) and restart. Never commit real keys; `.env*` files are
git-ignored.

## Commands

| Command             | What it does                                                      |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm dev`          | Web app + game server with hot reload                             |
| `pnpm build`        | Production builds of every package                                |
| `pnpm lint`         | ESLint across the monorepo                                        |
| `pnpm typecheck`    | TypeScript in every package                                       |
| `pnpm test`         | Vitest (layout, collision, avatar catalog, server)                |
| `pnpm avatar:build` | Rebuild the avatar kit in Blender (see `docs/avatar-pipeline.md`) |
| `pnpm format`       | Prettier                                                          |
| `pnpm check`        | Format check, lint, typecheck and tests in one go                 |

## Controls

| Input            | Action                                                    |
| ---------------- | --------------------------------------------------------- |
| W A S D / arrows | Walk                                                      |
| Mouse            | Look around (click the view first)                        |
| Hold Shift       | Free your mouse to click buttons (let go to keep looking) |
| R                | Walk faster on / off                                      |
| E                | Sit down / stand up                                       |
| V                | Switch first / third person                               |
| Scroll           | Zoom the third-person camera                              |
| Esc              | Pause menu (camera, sensitivity, graphics)                |
| Face button      | Optional webcam expression tracking (prototype)           |

Every action also has an on-screen button. If a browser refuses pointer lock (some embedded
browsers do), hold the mouse button and drag to look around.

## Repository layout

```text
apps/
  web/            Next.js 16 + React Three Fiber client (landing page, /library)
  game-server/    Colyseus 0.18 real-time server (public library rooms, cap of 15)
packages/
  shared/         Types, constants, avatar catalog, library layout and collision
  config/         Shared ESLint config
art/avatars/      Blender scripts that model and export the avatar kit (+ the .blend)
docs/             Architecture, feature status, avatar pipeline
```

The library's floor plan lives in `packages/shared/src/world/layout.ts`. The browser renders
the scene from it, and the game server will validate movement against the same colliders in
Phase 3.

## Troubleshooting

- **Choppy frame rate:** press Esc and set Graphics to Balanced or Low.
- **"Ignored build scripts" from pnpm:** only `esbuild` and `msgpackr-extract` are allowed to
  run install scripts (`pnpm-workspace.yaml`). Add others there deliberately, not with
  `--dangerously-allow-all-builds`.
- **A dependency is "too new" to install:** pnpm refuses packages published in the last day.
  Pin the previous release rather than adding a `minimumReleaseAgeExclude` entry.

## Next up

The title screen and Character Studio are in. Next: display names above avatars, study zones'
interactions and a fuller settings panel, then multiplayer in Phase 3.
