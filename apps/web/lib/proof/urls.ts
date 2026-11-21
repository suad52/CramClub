/**
 * URL helpers for the /proof page, pure so they're tested on their own.
 *
 * gameHttpUrl: the game server's HTTP address for a path, from the same NEXT_PUBLIC_GAME_SERVER_URL
 * the library's connection uses (lib/net/connection.ts). In production that's
 * wss://SITE_HOST/game, which Caddy routes to the game container with /game stripped
 * (deploy/Caddyfile), so the page's replay test goes through the very path a joining browser does.
 *
 * describeSignedUrl: what a presigned storage URL says about itself (algorithm, lifetime, host),
 * leaving out everything that could be reused: the credential, the signature, the bucket and key.
 */

/** "wss://h/game" + "/proof/ticket" → "https://h/game/proof/ticket". Null when not configured. */
export function gameHttpUrl(serverUrl: string | undefined | null, path: string): string | null {
  const raw = serverUrl?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const protocol =
    url.protocol === "wss:" || url.protocol === "https:"
      ? "https:"
      : url.protocol === "ws:" || url.protocol === "http:"
        ? "http:"
        : null;
  if (!protocol) return null;
  const prefix = url.pathname.replace(/\/+$/, "");
  const tail = path.startsWith("/") ? path : `/${path}`;
  return `${protocol}//${url.host}${prefix}${tail}`;
}

export interface SignedUrlFacts {
  host: string;
  algorithm: string;
  expiresInSeconds: number;
  /** When it was signed (ISO), from X-Amz-Date. */
  signedAt: string | null;
}

/** "20261121T183000Z" → ISO, or null. */
function amzDate(value: string | null) {
  const m = value && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(value);
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z` : null;
}

/** The harmless facts of an S3-style presigned URL, or null if it isn't one. */
export function describeSignedUrl(signed: string): SignedUrlFacts | null {
  let url: URL;
  try {
    url = new URL(signed);
  } catch {
    return null;
  }
  const algorithm = url.searchParams.get("X-Amz-Algorithm");
  const expires = Number(url.searchParams.get("X-Amz-Expires"));
  if (!algorithm || !url.searchParams.get("X-Amz-Signature") || !(expires > 0)) return null;
  return {
    host: url.host,
    algorithm,
    expiresInSeconds: expires,
    signedAt: amzDate(url.searchParams.get("X-Amz-Date")),
  };
}

/** The same object's address without any signature (path-style: endpoint/bucket/key). */
export function unsignedUrl(signed: string): string | null {
  try {
    const url = new URL(signed);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}
