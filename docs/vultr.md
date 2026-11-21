# OVR on Vultr ("The Living Library")

Vultr runs OVR's backend: the website and its API, the multiplayer game server, and a
**background worker** that researches, writes and narrates lessons while the student is away. The
lesson files it makes (narration MP3s and the lesson document) are kept in **Vultr Object
Storage**. Everything runs on one Vultr Cloud Compute server with Docker Compose.

The files are in [`deploy/`](../deploy/README.md). The job and storage contracts are in
`apps/web/lib/jobs/types.ts` and `apps/web/lib/storage/types.ts`.

## Architecture

```
                    Browser (student)
                       │  https://SITE_HOST          wss://SITE_HOST/game
                       ▼
┌─ Vultr Cloud Compute · Ubuntu 24.04 · Docker Compose ───────────────────────────────┐
│                                                                                      │
│  caddy :80/:443   HTTPS with automatic Let's Encrypt certificates                    │
│    ├── /game/*  ──▶  game    :2567   Colyseus: library rooms, live players           │
│    └── /*       ──▶  web     :3100   Next.js: pages, /api/*, Auth0 sign-in           │
│                         │  POST /api/lessons → a row in lesson_jobs (202 + job id)   │
│                         ▼                                                            │
│                      worker          apps/web/worker: claims jobs (FOR UPDATE        │
│                                      SKIP LOCKED), checkpoints every step            │
└──────────────────────────────────────────────────────────────────────────────────────┘
        │ web + worker                       │ worker
        ▼                                    ▼
  Tiger Data Postgres                  TinyFish (research) → Gemini (lesson + quiz)
  users, lessons, lesson_jobs          → ElevenLabs (narration)
  (the queue), worker heartbeat              │
                                             ▼
                                Vultr Object Storage (private bucket)
                                  lessons/<jobId>/lesson.json
                                  lessons/<jobId>/scene-<n>.mp3
                                             ▲
  Browser plays audio: GET /api/lessons/:id/audio/:n → access check → 302 to a
  short-lived signed URL on the bucket
```

- **Restarts:** every container has `restart: unless-stopped`, so a crash or a server reboot
  brings it back. A job interrupted mid-way is handed back (or retried after its lease) and
  resumes from its last checkpoint, so it never re-pays for finished steps.
- **Health:** `GET /api/health` (database, storage, worker heartbeat) and `GET /game/health`.
  Docker health checks call both.
- **Ports:** only 22, 80 and 443 are open (ufw). The app containers are on Compose's private
  network; only Caddy publishes ports.

### Vultr products used

| Product                                         | What for                          | Plan                        | Cost (approx.)                 |
| ----------------------------------------------- | --------------------------------- | --------------------------- | ------------------------------ |
| Cloud Compute (Shared CPU, Regular Performance) | web, game server, worker, Caddy   | 2 vCPU, 4 GB RAM, 80 GB SSD | about $20/month, billed hourly |
| Object Storage                                  | narration MP3s + lesson documents | Standard tier, one bucket   | about $6/month                 |

No GPU: nothing here runs a model on the server (Gemini, ElevenLabs and TinyFish are APIs). The
database stays on Tiger Data. 4 GB of RAM is for `next build`, which runs on the server; the
running apps use far less. (A 2 GB plan works only with the swap file cloud-init adds, and builds
slowly.)

## One-time setup

Steps marked **(you)** need you in a browser or terminal. Dashboard labels can differ slightly as
Vultr updates its site.

### 1. Vultr account and hackathon credit (you)

1. Sign up at <https://www.vultr.com> (use the hackathon's sign-up link if it gave you one: some
   apply the credit automatically) and confirm your email.
2. **Billing**: Vultr asks for a card or PayPal to activate an account, even with credit.
3. Redeem the hackathon's code: **Account → Billing → Gift Code / Coupon** (the box to redeem a
   promo code). The credit shows under your balance. Everything below is billed against it.

### 2. API key (optional)

Not needed: nothing in OVR calls the Vultr API, and this guide uses only the dashboard. If you
want the `vultr-cli` later: **Account → API → Enable API**, copy the key, and under **Access
Control** allow only your own IP. Never put it in `deploy/env/*.env`.

### 3. Object Storage: subscription, bucket, keys (you)

1. **Products → Cloud Storage → Object Storage → Add Object Storage** (or **Deploy + → Object
   Storage**).
2. Tier: **Standard**. Location: pick one near your Tiger Data region, and use the same city for
   the server in step 4 (e.g. **New Jersey**). Label: `ovr-storage`. **Add**.
3. When it shows **Active**, open it. The **Overview** shows the S3 credentials:
   **Hostname** (like `ewr1.vultrobjects.com`), **Access Key**, **Secret Key**.
4. **Buckets → Create Bucket**: a lowercase name, e.g. `ovr-lessons-<something-random>`. Leave it
   private (the default). Nothing needs to be public: the web app hands out signed links after
   checking who's asking.
5. Put them in `deploy/env/web.env` (step 5):
   ```
   VULTR_OBJECT_STORAGE_ENDPOINT=https://ewr1.vultrobjects.com   # https:// + the Hostname
   VULTR_OBJECT_STORAGE_BUCKET=ovr-lessons-...
   VULTR_OBJECT_STORAGE_ACCESS_KEY=...
   VULTR_OBJECT_STORAGE_SECRET_KEY=...
   ```
   To try it from your laptop first, put the same four lines in `apps/web/.env.local` and run
   the app and `pnpm --filter @ovr/web worker` locally: `/api/health` then says `"storage":true`
   and new lessons land in the bucket.

### 4. The server (you)

1. An SSH key for it, on your Mac (skip if you have one you want to use):
   `ssh-keygen -t ed25519 -f ~/.ssh/vultr_ovr -C ovr-vultr`
2. **Deploy + → Deploy New Server**:
   - **Type:** Cloud Compute, **Shared CPU** (Regular Performance).
   - **Location:** the same city as the bucket.
   - **Image:** Ubuntu **24.04 LTS** x64.
   - **Plan:** **2 vCPU / 4 GB** (about $20/month).
   - **SSH Keys → Add New:** paste the contents of `~/.ssh/vultr_ovr.pub`, and select it.
   - **Additional Features:** tick **Cloud-Init User-Data** and paste the whole of
     `deploy/cloud-init.yaml`. Turn **Auto Backups** off (it adds 20%) unless you want them.
   - **Hostname / Label:** `ovr`. **Deploy Now**.
3. When it's **Running**, copy its **IP address**. Give cloud-init about 5 minutes, then check:
   `ssh -i ~/.ssh/vultr_ovr root@IP 'cloud-init status --wait'` → `status: done`.

Your site's address is then `https://IP-WITH-DASHES.sslip.io` (e.g. `203-0-113-7.sslip.io`), a
free name that resolves to the server. With your own domain, add an **A record** to the IP and
put `SITE_HOST=your.domain` in `deploy/env/site.env`.

### 5. Settings (you)

```sh
cp deploy/env/web.env.example deploy/env/web.env
cp deploy/env/game.env.example deploy/env/game.env
```

Fill them in. Most values are the ones in `apps/web/.env.local`: `DATABASE_URL`,
`LEARNER_SECRET`, the `AUTH0_*` four, `GEMINI_API_KEY`, `TINYFISH_API_KEY`, `ELEVENLABS_API_KEY`,
plus the Object Storage lines from step 3. `GAME_TICKET_SECRET` must be the same in both files.
Don't set `APP_BASE_URL`, `ALLOWED_ORIGINS` or `NEXT_PUBLIC_GAME_SERVER_URL`: Compose derives them
from the site address. Both files stay on your machine and the server only (`deploy/env/` is
gitignored).

### 6. Auth0 and the database (you)

- **Auth0** (Applications → your app → Settings): add `https://SITE_HOST/auth/callback` to
  **Allowed Callback URLs**, and `https://SITE_HOST` to **Allowed Logout URLs** and **Allowed Web
  Origins** (comma-separated, keep the localhost ones). Save.
- **Database:** the server uses the same Tiger Data service as development. Apply the migrations
  from your laptop (the containers don't): `pnpm --filter @ovr/web db:migrate`. If you set an IP
  allow-list on the Tiger service, add the server's IP.

### 7. Deploy

```sh
deploy/deploy.sh IP ~/.ssh/vultr_ovr
```

It copies the working tree to the server (no `node_modules`, no `.env*` files, no Blender
sources), builds the three images there, starts everything and waits for
`https://SITE_HOST/api/health`. The first build takes several minutes; later ones reuse the
cache.

## Updating

Run the same command again after any change (code or `deploy/env/*.env`):

```sh
deploy/deploy.sh IP ~/.ssh/vultr_ovr
```

Only changed files are copied, and Compose rebuilds and restarts only what changed. A running
lesson is handed back to the queue and finished by the new worker. New database migrations: run
`db:migrate` from your laptop before deploying. To roll back, check out the previous version
locally and deploy again.

On the server (`ssh -i ~/.ssh/vultr_ovr deploy@IP`, then `cd ~/ovr/deploy`):

```sh
docker compose ps                      # state + health of each container
docker compose logs -f worker          # watch lessons being made
docker compose logs --tail 200 web
docker compose restart worker
docker compose down                    # stop everything (volumes, incl. certificates, are kept)
```

## Testing it

1. `curl https://SITE_HOST/api/health` →
   `{"ok":true,"db":true,"storage":true,"worker":{"lastSeenSecondsAgo":<under 45>}}`.
   `curl https://SITE_HOST/game/health` → `{"ok":true,...}`.
2. Open `https://SITE_HOST`, sign in, enter the library. In a second browser (or a private
   window) enter too: each sees the other (the WebSocket through `/game`).
3. **My Library → Lessons → Make a cloud lesson**, e.g. "modular arithmetic". The card shows each
   step (researching, writing, recording, saving). Close the tab.
4. On the server, `docker compose logs -f worker` shows the job's steps.
5. Come back later: the lesson is **Ready**. Open it and play it: the narration comes from the
   bucket (DevTools → Network: the audio request is redirected to `...vultrobjects.com/...`).
   Opening it again doesn't regenerate anything.
6. The files are in the bucket under `lessons/<jobId>/` (`lesson.json`, `scene-*.mp3`). Any S3
   client with the same keys lists them, e.g. the AWS CLI:
   `aws s3 ls s3://BUCKET/lessons/ --recursive --endpoint-url https://ewr1.vultrobjects.com`
   (or a desktop S3 browser such as Cyberduck).
7. Resilience: start a lesson, then `docker compose restart worker` during it. The job carries on
   from its last finished step.

## When you're done

Billing runs while resources exist, even when a server is stopped. After the hackathon, delete the
server (open it → **Destroy**, the trash icon) and the Object Storage subscription (same, on its
page).

## Troubleshooting

- **No HTTPS / certificate errors:** ports 80 and 443 must reach the server (cloud-init opens them
  in ufw; also check any Vultr Firewall group you attached). `docker compose logs caddy` shows the
  Let's Encrypt attempts. If sslip.io hits a rate limit, use a real domain (or nip.io).
- **`/api/health` says `"db":false`:** `DATABASE_URL` in `deploy/env/web.env`, or the Tiger
  service's IP allow-list.
- **`"storage":false`:** the four `VULTR_OBJECT_STORAGE_*` values (all four, endpoint with
  `https://`), and that the bucket exists.
- **`lastSeenSecondsAgo` is null or large:** `docker compose logs worker`.
- **Signed in but multiplayer stays offline:** `GAME_TICKET_SECRET` must match in both env files;
  `docker compose logs game`.
- **Auth0 "callback URL mismatch":** step 6 (the URL must be exactly `https://SITE_HOST/auth/callback`).
- **Build killed / out of memory:** use the 4 GB plan (`free -h` should also show the 4 GB swap).
