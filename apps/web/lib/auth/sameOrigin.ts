import "server-only";

/**
 * CSRF protection for every endpoint that a cookie authenticates (the Auth0 session or the
 * anonymous learner cookie). Both cookies are SameSite=Lax, so another *site* can't send them on
 * a POST at all; this also stops another *origin* on the same site (another port on localhost, a
 * sibling subdomain) and older browsers that ignore SameSite.
 *
 * Browsers send `Origin` on every POST, PATCH and DELETE (fetch and form posts alike) and
 * `Sec-Fetch-Site` where supported. A change is refused when either says it came from elsewhere.
 * A request with neither header isn't a browser on another site (curl, a server, a test): it
 * passes this check and still needs a valid session.
 */
export function crossOriginWrite(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") return true;
  const origin = request.headers.get("origin");
  if (!origin) return site === "same-site";
  let from: string;
  try {
    from = new URL(origin).host;
  } catch {
    return true; // "null" (a sandboxed frame, a privacy redirect) or garbage
  }
  if (!from) return true;
  return !allowedHosts(request).has(from);
}

/**
 * This server's own host as the browser addressed it (the Host header, or a proxy's
 * X-Forwarded-Host: a page on another site can't set either), as Next saw it (request.url, which
 * next dev reports as localhost even when the browser used 127.0.0.1), and APP_BASE_URL's.
 */
function allowedHosts(request: Request) {
  const hosts = new Set<string>();
  for (const header of ["host", "x-forwarded-host"]) {
    const value = request.headers.get(header)?.split(",")[0]?.trim().toLowerCase();
    if (value) hosts.add(value);
  }
  try {
    hosts.add(new URL(request.url).host);
  } catch {
    // a relative URL can't happen in a route handler; nothing to add
  }
  const base = process.env.APP_BASE_URL?.trim();
  if (base)
    try {
      hosts.add(new URL(base).host);
    } catch {
      // a malformed APP_BASE_URL also stops Auth0 from starting; nothing to add
    }
  return hosts;
}

/** The answer to a change sent from another site. */
export function crossOriginRefused() {
  return Response.json(
    { error: { code: "forbidden", message: "Changes have to come from this site." } },
    { status: 403, headers: { "cache-control": "no-store" } },
  );
}
