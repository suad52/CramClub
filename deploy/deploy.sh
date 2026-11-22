#!/usr/bin/env bash
#
# Deploy (or update) OVR on the Vultr server: copy this working tree there over SSH, then rebuild
# and restart the containers. Safe to run again and again; only what changed is copied, and
# Compose recreates only the containers whose image or settings changed.
#
#   deploy/deploy.sh <server-ip-or-host> [path/to/ssh-key]
#
# Needs deploy/env/web.env and deploy/env/game.env (from the .example files). Optional:
#   SITE_HOST=your.domain in the environment, or in deploy/env/site.env (the environment wins);
#     default: <server-ip-with-dashes>.sslip.io, e.g. 149-248-61-2.sslip.io for 149.248.61.2.
#     Changing it needs the Auth0 URLs updated too (docs/DOMAIN.md).
#   DEPLOY_USER=deploy   the SSH user cloud-init.yaml creates
#   DEPLOY_DIR=/home/deploy/ovr
set -euo pipefail

SERVER="${1:-}"
KEY="${2:-${DEPLOY_SSH_KEY:-}}"
if [[ -z "$SERVER" ]]; then
  echo "usage: deploy/deploy.sh <server-ip-or-host> [path/to/ssh-key]" >&2
  exit 2
fi
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/$DEPLOY_USER/ovr}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for f in web game; do
  if [[ ! -s "$ROOT/deploy/env/$f.env" ]]; then
    echo "Missing deploy/env/$f.env: cp deploy/env/$f.env.example deploy/env/$f.env and fill it in." >&2
    exit 1
  fi
done

# Public host name: $SITE_HOST, else deploy/env/site.env, else <ip-with-dashes>.sslip.io.
if [[ -z "${SITE_HOST:-}" && -f "$ROOT/deploy/env/site.env" ]]; then
  SITE_HOST="$(sed -n 's/^SITE_HOST=//p' "$ROOT/deploy/env/site.env" | tail -n 1 | tr -d '[:space:]"')"
fi
if [[ -z "${SITE_HOST:-}" ]]; then
  if [[ "$SERVER" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    SITE_HOST="${SERVER//./-}.sslip.io"
  else
    SITE_HOST="$SERVER"
  fi
fi
if [[ ! "$SITE_HOST" =~ ^[A-Za-z0-9.-]+$ ]]; then
  echo "SITE_HOST must be a bare host name (no https://, no path): $SITE_HOST" >&2
  exit 1
fi

# Hosts Caddy redirects to SITE_HOST (space-separated, never empty): the www. twin of SITE_HOST,
# and the server's <ip-with-dashes>.sslip.io name when SITE_HOST is a real domain, so links to the
# old address keep working. Give www. a DNS record too (an A record, or a CNAME to SITE_HOST).
if [[ "$SITE_HOST" == www.* ]]; then
  REDIRECT_HOSTS="${SITE_HOST#www.}"
else
  REDIRECT_HOSTS="www.$SITE_HOST"
fi
if [[ "$SERVER" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SSLIP_HOST="${SERVER//./-}.sslip.io"
  if [[ "$SITE_HOST" != "$SSLIP_HOST" ]]; then REDIRECT_HOSTS+=" $SSLIP_HOST"; fi
fi

SSH=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
if [[ -n "$KEY" ]]; then SSH+=(-i "$KEY" -o IdentitiesOnly=yes); fi
REMOTE="$DEPLOY_USER@$SERVER"
# rsync -e takes one string and honours single quotes (not backslashes) around arguments.
RSH=""
for arg in "${SSH[@]}"; do RSH+="'$arg' "; done

echo "==> Deploying to $REMOTE:$DEPLOY_DIR as https://$SITE_HOST (redirects from: $REDIRECT_HOSTS)"
"${SSH[@]}" "$REMOTE" "mkdir -p '$DEPLOY_DIR'"

# The working tree (uncommitted changes included), minus dependencies, build output, local
# secrets/data, Auth0 MCP state and the Blender sources. deploy/env/*.env IS copied: that is how the server gets
# its settings. --delete removes files deleted here; excluded paths on the server are kept.
rsync -az --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.data/' \
  --exclude '.next/' \
  --exclude 'dist/' \
  --exclude 'coverage/' \
  --exclude '*.tsbuildinfo' \
  --exclude '.DS_Store' \
  --exclude '.auth0-mcp-*' \
  --exclude '/art/' \
  --exclude '/plan_*.png' \
  -e "$RSH" \
  "$ROOT/" "$REMOTE:$DEPLOY_DIR/"

# deploy/.env is what Compose reads for SITE_HOST and REDIRECT_HOSTS (so `docker compose ...`
# works by hand there). ssh joins its arguments into one command line for the remote shell, so
# each one is %q-quoted to arrive whole (REDIRECT_HOSTS contains spaces).
"${SSH[@]}" "$REMOTE" "bash -s -- $(printf '%q ' "$DEPLOY_DIR" "$SITE_HOST" "$REDIRECT_HOSTS")" <<'REMOTE_SCRIPT'
set -euo pipefail
cd "$1/deploy"
chmod 700 env && chmod 600 env/*.env
printf 'SITE_HOST=%s\nREDIRECT_HOSTS="%s"\n' "$2" "$3" > .env
chmod 600 .env
docker compose up -d --build --remove-orphans
docker image prune -f > /dev/null
docker compose ps
REMOTE_SCRIPT

echo "==> Waiting for https://$SITE_HOST/api/health (the first certificate can take a minute)"
for _ in $(seq 1 30); do
  body="$(curl -sS --max-time 10 "https://$SITE_HOST/api/health" 2>/dev/null || true)"
  if [[ "$body" == "{"* ]]; then
    echo "$body"
    if [[ "$body" == *'"ok":true'* ]]; then
      echo "==> Live: https://$SITE_HOST"
      exit 0
    fi
    echo "The site answers but reports a problem (above). Logs on the server:" >&2
    break
  fi
  sleep 5
done
echo "  ssh $REMOTE 'cd $DEPLOY_DIR/deploy && docker compose ps && docker compose logs --tail 100'" >&2
exit 1
