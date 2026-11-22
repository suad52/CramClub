# A custom domain: cramclub.study (GoDaddy Registry, registered at Porkbun)

Cram Club ran at `https://149-248-61-2.sslip.io` until it got a name of its own: `cramclub.study`,
claimed free with the MLH × GoDaddy Registry promo code (mlh.link/godaddyregistry). The MLH page
hands checkout to a partner registrar, Porkbun, so DNS is managed at porkbun.com. To move to
another name, use it everywhere below. Budget about 20 minutes, most of it waiting for DNS.

Everything the site needs follows from one setting, `SITE_HOST`:

| Derived from `SITE_HOST`                              | Where                                             |
| ----------------------------------------------------- | ------------------------------------------------- |
| The HTTPS certificate (Let's Encrypt)                 | Caddy, `deploy/Caddyfile` (`{$SITE_HOST}`)        |
| `APP_BASE_URL=https://SITE_HOST`                      | web + worker, `deploy/docker-compose.yml`         |
| `ALLOWED_ORIGINS=https://SITE_HOST`                   | game server, `deploy/docker-compose.yml`          |
| `NEXT_PUBLIC_GAME_SERVER_URL=wss://SITE_HOST/game`    | baked into the browser bundle at build time       |
| `REDIRECT_HOSTS`: `www.SITE_HOST` + the sslip.io name | Caddy redirects them to `SITE_HOST` (`deploy.sh`) |

The only things outside this repo are **DNS** and **Auth0's allowed URLs**.

## 1. Register the domain

1. On the MLH page, search the name, click **Get It** and enter the promo code; checkout happens at
   Porkbun. Any registrar works if you buy the name elsewhere.
2. Keep the registrar's own DNS (nameservers) unless you already use another DNS host.

## 2. Point it at the server (A record)

In the registrar's DNS settings (Porkbun: **Domain Management → the domain → DNS**):

1. New Porkbun domains come with parking records pointing at `pixie.porkbun.com`: an **ALIAS** on
   the bare domain, a **CNAME** on `www` and a **CNAME** on `*`. Delete all three (on GoDaddy,
   edit the "Parked" A record on `@` instead), then add:

   | Type  | Host (Name)     | Answer (Value)   | TTL                     |
   | ----- | --------------- | ---------------- | ----------------------- |
   | A     | _(blank)_ / `@` | `149.248.61.2`   | 600 seconds (or lowest) |
   | CNAME | `www`           | `cramclub.study` | 600 seconds (or lowest) |

2. Make sure no other **A**, **ALIAS** or **AAAA** record is left on the bare name (a leftover
   parking record sends some visitors elsewhere, and can make the certificate request fail).
3. `www` is a redirect: Caddy gets it its own certificate and sends `www.cramclub.study/...` to
   `cramclub.study/...`. Without the `www` record the site still works, but Caddy logs failed
   certificate attempts for it.
4. Wait until the name resolves, from your laptop:

   ```bash
   dig +short cramclub.study A                # → 149.248.61.2
   dig +short cramclub.study A @1.1.1.1       # same answer from a public resolver
   dig +short www.cramclub.study A @1.1.1.1   # → cramclub.study. then 149.248.61.2
   ```

   Don't deploy before both say `149.248.61.2`: Caddy asks Let's Encrypt for the certificate as
   soon as it starts with the new name, and a failed attempt backs off for a while.

## 3. Set the host

On your laptop, in this repo, put the bare host name (no `https://`, no path, lower case) in
`deploy/env/site.env` (copy `deploy/env/site.env.example` if the file isn't there):

```bash
SITE_HOST=cramclub.study
```

`deploy.sh` also accepts it from the environment for a one-off (`SITE_HOST=cramclub.study
deploy/deploy.sh …`); the environment wins over the file. An empty value goes back to
`149-248-61-2.sslip.io`.

## 4. Auth0 allowed URLs

Auth0 dashboard → **Applications → Applications →** the Cram Club app → **Settings**. Add the new
URLs next to the existing ones (comma-separated) so sign-in keeps working during the switch:

| Field                     | Add                                    |
| ------------------------- | -------------------------------------- |
| **Allowed Callback URLs** | `https://cramclub.study/auth/callback` |
| **Allowed Logout URLs**   | `https://cramclub.study`               |
| **Allowed Web Origins**   | `https://cramclub.study`               |

Click **Save Changes** at the bottom. The values must match exactly (https, no trailing slash on
the origin). Nothing changes in `deploy/env/web.env`: `APP_BASE_URL` comes from `SITE_HOST`.
`AUTH0_DOMAIN` is your Auth0 tenant's domain and stays the same.

## 5. Object Storage CORS origin

Today the bucket needs **no CORS rule**: narration plays through an `<audio>` element after a 302
to a presigned URL, and the `/proof` signed-URL test runs on the server. Check whether a rule was
added anyway (AWS CLI, with the Object Storage keys in your shell, never in a file in this repo):

```bash
aws s3api get-bucket-cors --bucket "$VULTR_OBJECT_STORAGE_BUCKET" \
  --endpoint-url "$VULTR_OBJECT_STORAGE_ENDPOINT"
```

- `NoSuchCORSConfiguration`: nothing to do.
- A rule that lists `https://149-248-61-2.sslip.io`: add the new origin and put it back:

  ```bash
  cat > /tmp/cors.json <<'JSON'
  {
    "CORSRules": [
      {
        "AllowedOrigins": ["https://cramclub.study", "https://149-248-61-2.sslip.io"],
        "AllowedMethods": ["GET", "HEAD"],
        "AllowedHeaders": ["Range"],
        "ExposeHeaders": ["Content-Length", "Content-Range", "Accept-Ranges"],
        "MaxAgeSeconds": 3600
      }
    ]
  }
  JSON
  aws s3api put-bucket-cors --bucket "$VULTR_OBJECT_STORAGE_BUCKET" \
    --endpoint-url "$VULTR_OBJECT_STORAGE_ENDPOINT" --cors-configuration file:///tmp/cors.json
  ```

  Keep the bucket private either way: CORS only says which pages may read a response, it doesn't
  make anything public.

## 6. Redeploy

```bash
deploy/deploy.sh 149.248.61.2 ~/.ssh/your_key
```

SSH still goes to the IP; the site is served as `https://cramclub.study`. The script copies the
tree, writes `SITE_HOST` to `deploy/.env` on the server and runs `docker compose up -d --build`.
The **web image is rebuilt** (the game server URL is baked into the browser bundle), Caddy gets
the new certificate, and the script waits for `https://cramclub.study/api/health` to say
`"ok":true`.

## 7. Check it

```bash
curl -sS https://cramclub.study/api/health     # {"ok":true,...}
curl -sS https://cramclub.study/game/health    # {"ok":true,...}
```

```bash
curl -sSI https://www.cramclub.study/library | grep -i location          # → https://cramclub.study/library
curl -sSI https://149-248-61-2.sslip.io/library | grep -i location       # → https://cramclub.study/library
```

1. Open `https://cramclub.study/proof`: the ticket replay test passes (this proves the browser can
   reach the game server through `/game` with the new origin).
2. Sign in and sign out (proves the Auth0 URLs).
3. Enter the library in two browsers and see each other.

## After the switch

- **The old address redirects.** `deploy.sh` puts `149-248-61-2.sslip.io` in `REDIRECT_HOSTS`,
  so old links (Devpost, README) land on the same page at the new name. Update them anyway.
- **Guests start fresh on the new name.** The guest cookie belongs to the old host. Signed-in
  students keep everything (it's on their account).
- Once you're happy, remove the old sslip.io URLs from the three Auth0 fields.
- To go back: empty `SITE_HOST` in `deploy/env/site.env` (or set it to `149-248-61-2.sslip.io`)
  and run the same deploy command.
