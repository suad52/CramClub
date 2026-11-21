import { Auth0Client } from "@auth0/nextjs-auth0/server";
import { NextResponse } from "next/server";

/**
 * Auth0 is OVR's sign-in (docs/auth0.md). It is optional: until AUTH0_DOMAIN, AUTH0_CLIENT_ID and
 * AUTH0_CLIENT_SECRET are filled in (with AUTH0_SECRET and APP_BASE_URL), there is no client, the
 * proxy passes every request through and learners stay anonymous (a signed cookie).
 *
 * Server only (the proxy and route handlers). It deliberately doesn't import "server-only", which
 * the proxy bundle can't load, but nothing here may be imported by client code: the client secret
 * is read from the server's environment, at request time, so a dev server picks up new keys
 * without restarting.
 */
const KEYS = [
  "AUTH0_DOMAIN",
  "AUTH0_CLIENT_ID",
  "AUTH0_CLIENT_SECRET",
  "AUTH0_SECRET",
  "APP_BASE_URL",
] as const;

function env(key: (typeof KEYS)[number]) {
  return process.env[key]?.trim() ?? "";
}

/** Whether sign-in is set up: every Auth0 key is present. */
export function authConfigured() {
  return KEYS.every((k) => env(k) !== "");
}

/** The tenant's domain without a scheme or trailing slash (a pasted URL works too). */
export function cleanDomain(domain: string) {
  return domain
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

let cached: { key: string; client: Auth0Client } | null = null;

/** The Auth0 client, or null while sign-in isn't set up. Rebuilt if the keys change. */
export function getAuth0(): Auth0Client | null {
  if (!authConfigured()) return null;
  const key = KEYS.map(env).join("\n");
  if (cached?.key !== key) cached = { key, client: makeClient() };
  return cached.client;
}

function makeClient() {
  return new Auth0Client({
    domain: cleanDomain(env("AUTH0_DOMAIN")),
    clientId: env("AUTH0_CLIENT_ID"),
    clientSecret: env("AUTH0_CLIENT_SECRET"),
    secret: env("AUTH0_SECRET"),
    appBaseUrl: env("APP_BASE_URL"),
    // Least privilege: who you are (sub, name) and your email, which the server only ever turns
    // into a keyed hash when Auth0 says it's verified (lib/auth/emailHash.ts: email invites to
    // private tables). No refresh tokens, and no endpoint that hands an access token to the
    // browser (OVR never calls an API as you). proxy.ts strips any other scope from /auth/login.
    authorizationParameters: { scope: "openid profile email" },
    enableAccessTokenEndpoint: false,
    session: { rolling: true, inactivityDuration: 7 * 86_400, absoluteDuration: 30 * 86_400 },
    onCallback: async (error, ctx) => {
      if (error) {
        // The message can carry text from the request, so only the code is logged or shown.
        console.error("[auth] sign-in callback failed:", error.code);
        return callbackProblem();
      }
      const base = ctx.appBaseUrl ?? env("APP_BASE_URL");
      let target = new URL(ctx.returnTo || "/", base);
      if (target.origin !== new URL(base).origin) target = new URL("/", base);
      return NextResponse.redirect(target);
    },
  });
}

/** A small page in the library's colours for a sign-in that didn't finish (no details echoed). */
function callbackProblem() {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Sign-in didn't finish · Cram Club</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f2ea;color:#1f1a16;font:500 16px/1.5 ui-rounded,"Nunito",system-ui,sans-serif;padding:16px}
main{max-width:420px;background:#fffefa;border:3px solid #1f1a16;border-radius:24px;box-shadow:0 6px 0 #1f1a16;padding:28px}
h1{margin:0 0 8px;font-size:24px}p{margin:0 0 20px;color:#5f6158}
a{display:inline-flex;align-items:center;height:44px;padding:0 20px;margin:0 8px 8px 0;border:3px solid #1f1a16;border-radius:14px;box-shadow:0 4px 0 #1f1a16;color:#1f1a16;font-weight:700;text-decoration:none;background:#fffefa}
a.primary{background:#f2cf7e}a:focus-visible{outline:4px solid #f2cf7e;outline-offset:2px}
</style></head><body><main><h1>Sign-in didn't finish</h1>
<p>Nothing was changed. You can try again, or keep studying without an account.</p>
<a class="primary" href="/auth/login">Try again</a><a href="/">Back to the library</a></main></body></html>`;
  return new NextResponse(html, {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
