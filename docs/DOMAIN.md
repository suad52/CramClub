# A custom `.club` domain (GoDaddy Registry)

Cram Club runs at `https://149-248-61-2.sslip.io` until it has a name of its own. `.club` is a
GoDaddy Registry top-level domain, and fits a study club. These steps move the site to one, say
`cramclub.club` (use your own name everywhere below). Budget about 20 minutes, most of it waiting
for DNS.

Everything the site needs follows from one setting, `SITE_HOST`:

| Derived from `SITE_HOST`                           | Where                                       |
| -------------------------------------------------- | ------------------------------------------- |
| The HTTPS certificate (Let's Encrypt)              | Caddy, `deploy/Caddyfile` (`{$SITE_HOST}`)  |
| `APP_BASE_URL=https://SITE_HOST`                   | web + worker, `deploy/docker-compose.yml`   |
| `ALLOWED_ORIGINS=https://SITE_HOST`                | game server, `deploy/docker-compose.yml`    |
| `NEXT_PUBLIC_GAME_SERVER_URL=wss://SITE_HOST/game` | baked into the browser bundle at build time |

The only things outside this repo are **DNS** and **Auth0's allowed URLs**.

## 1. Register the domain

1. Buy the name at any registrar that sells `.club` (for example godaddy.com). If Hack Western or
   MLH gave you a GoDaddy Registry promo code, apply it at checkout.
2. Keep the registrar's own DNS (nameservers) unless you already use another DNS host.

## 2. Point it at the server (A record)

In the registrar's DNS settings for the domain (on GoDaddy: **My Products → the domain → DNS**):

1. Find the existing **A** record for **`@`**. New GoDaddy domains have one pointing at a
   "Parked" page: **edit it** rather than adding a second one.

   | Type | Name | Value          | TTL                     |
   | ---- | ---- | -------------- | ----------------------- |
   | A    | `@`  | `149.248.61.2` | 600 seconds (or lowest) |

2. Delete any other **A** or **AAAA** record on `@` (a leftover parking AAAA record would send
   IPv6 visitors elsewhere, and can make the certificate request fail).
3. Don't add `www`: Caddy serves exactly one host, so `www.cramclub.club` would get no
   certificate. (If the registrar offers "forwarding" for `www`, that's fine to use.)
4. Wait until the name resolves, from your laptop:

   ```bash
   dig +short cramclub.club A            # → 149.248.61.2
   dig +short cramclub.club A @1.1.1.1   # same answer from a public resolver
   ```

   Don't deploy before both say `149.248.61.2`: Caddy asks Let's Encrypt for the certificate as
   soon as it starts with the new name, and a failed attempt backs off for a while.

## 3. Set the host

On your laptop, in this repo, put the bare host name (no `https://`, no path, lower case) in
`deploy/env/site.env` (copy `deploy/env/site.env.example` if the file isn't there):

```bash
SITE_HOST=cramclub.club
```

`deploy.sh` also accepts it from the environment for a one-off (`SITE_HOST=cramclub.club
deploy/deploy.sh …`); the environment wins over the file. An empty value goes back to
`149-248-61-2.sslip.io`.

## 4. Auth0 allowed URLs

Auth0 dashboard → **Applications → Applications →** the Cram Club app → **Settings**. Add the new
URLs next to the existing ones (comma-separated) so sign-in keeps working during the switch:

| Field                     | Add                                   |
| ------------------------- | ------------------------------------- |
| **Allowed Callback URLs** | `https://cramclub.club/auth/callback` |
| **Allowed Logout URLs**   | `https://cramclub.club`               |
| **Allowed Web Origins**   | `https://cramclub.club`               |

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
        "AllowedOrigins": ["https://cramclub.club", "https://149-248-61-2.sslip.io"],
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

SSH still goes to the IP; the site is served as `https://cramclub.club`. The script copies the
tree, writes `SITE_HOST` to `deploy/.env` on the server and runs `docker compose up -d --build`.
The **web image is rebuilt** (the game server URL is baked into the browser bundle), Caddy gets
the new certificate, and the script waits for `https://cramclub.club/api/health` to say
`"ok":true`.

## 7. Check it

```bash
curl -sS https://cramclub.club/api/health     # {"ok":true,...}
curl -sS https://cramclub.club/game/health    # {"ok":true,...}
```

1. Open `https://cramclub.club/proof`: the ticket replay test passes (this proves the browser can
   reach the game server through `/game` with the new origin).
2. Sign in and sign out (proves the Auth0 URLs).
3. Enter the library in two browsers and see each other.

## After the switch

- **The old address stops working.** Caddy only serves `SITE_HOST`, so
  `149-248-61-2.sslip.io` gets no certificate any more. Update links (Devpost, README) to the new
  name.
- **Guests start fresh on the new name.** The guest cookie belongs to the old host. Signed-in
  students keep everything (it's on their account).
- Once you're happy, remove the old sslip.io URLs from the three Auth0 fields.
- To go back: empty `SITE_HOST` in `deploy/env/site.env` (or set it to `149-248-61-2.sslip.io`)
  and run the same deploy command.
