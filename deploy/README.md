# deploy/: OVR on one Vultr server

Docker Compose for a single Vultr Cloud Compute instance (Ubuntu 24.04). The full guide, with the
architecture, the Vultr dashboard steps and a test plan, is [docs/vultr.md](../docs/vultr.md).

```
caddy :80/:443 ─┬─ /game/* ─▶ game   :2567  (Colyseus; /game is stripped)
                └─ /*      ─▶ web    :3100  (Next.js, next start)
                              worker        (pnpm run worker: lesson jobs → Vultr Object Storage)
```

| File                 | What it is                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Dockerfile.web`     | base → deps (`pnpm install --frozen-lockfile`, cached) → build (`next build`, `NEXT_PUBLIC_*` as build args) → `web` (`next start -p 3100`, user `node`) |
| `Dockerfile.worker`  | `FROM` the built web image (Compose passes it as the `web` build context), runs the `worker` script                                                      |
| `Dockerfile.game`    | installs + `tsup`-builds `apps/game-server`, runs `node dist/index.js` on 2567                                                                           |
| `docker-compose.yml` | the four services, health checks (`/api/health`, `/health`), `restart: unless-stopped`, volumes for certificates and local storage                       |
| `Caddyfile`          | one site block `{$SITE_HOST}`, automatic HTTPS (Let's Encrypt)                                                                                           |
| `cloud-init.yaml`    | first boot: Docker + Compose, `deploy` user with your SSH key, ufw 22/80/443, 4 GB swap                                                                  |
| `deploy.sh`          | rsync the working tree over SSH, `docker compose up -d --build`, wait for health                                                                         |
| `env/*.env.example`  | templates for `env/web.env` (web + worker), `env/game.env`, optional `env/site.env`                                                                      |

`/.dockerignore` keeps env files, `node_modules` and build output out of every image.

## Settings

- `env/web.env` and `env/game.env`: copy from the `.example` files. Gitignored; `deploy.sh`
  copies them to the server (mode 600). Secrets are run-time only, never build args.
- `SITE_HOST` (a domain, or `<ip-with-dashes>.sslip.io` by default): `deploy.sh` writes it to
  `deploy/.env` on the server, and Compose derives from it `APP_BASE_URL=https://SITE_HOST`,
  the game server's `ALLOWED_ORIGINS`, and the build arg
  `NEXT_PUBLIC_GAME_SERVER_URL=wss://SITE_HOST/game`. `NEXT_PUBLIC_*` values are inlined by
  `next build`, so changing one means a rebuild (which `deploy.sh` does).
- The Colyseus client keeps the URL's path as a prefix (`/game/matchmake/...`,
  `/game/<processId>/<roomId>`); Caddy's `handle_path /game/*` strips it, so the game server
  serves at its root as in development.

## Deploy and update

```sh
deploy/deploy.sh <server-ip> ~/.ssh/vultr_ovr     # first time and every update
```

Idempotent: only changed files are copied, Compose rebuilds and recreates only what changed, and
the Let's Encrypt certificate is kept in the `caddy_data` volume. Database migrations are not run
by the containers: `pnpm --filter @ovr/web db:migrate` from your laptop first.

## On the server

```sh
ssh -i ~/.ssh/vultr_ovr deploy@<server-ip>
cd ~/ovr/deploy
docker compose ps                 # health of each container
docker compose logs -f worker
docker compose restart web
```

## Checked locally

Docker isn't installed on the development Mac, so the images haven't been built here. What was
checked: both YAML files parse; the Dockerfiles' steps were replayed outside Docker on a copy of
the repo with only what `/.dockerignore` lets through (filtered `pnpm install --frozen-lockfile`,
`next build` with no `.env.local` and the `NEXT_PUBLIC_*` build args, `next start` on the built
output, the game server's `tsup` build and `/health`, and `pnpm run worker` stopping cleanly on
SIGTERM); the Colyseus SDK's path-prefix handling was read in its source. Run
`docker compose config` on the server (or any machine with Docker) to validate the Compose file
itself.
