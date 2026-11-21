/**
 * Where the sign-in and sign-out buttons go. These are the Auth0 SDK's routes, mounted by
 * proxy.ts; they're full page loads (plain links, never next/link, which would try to prefetch
 * them). Safe for client code.
 */

/** A same-site path to come back to, or "/" for anything else. */
export function safeReturnTo(path: string | null | undefined) {
  if (!path || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  return path.slice(0, 512);
}

/** Sign in (or sign up: Auth0's page offers both), then come back to `returnTo`. */
export function loginHref(returnTo?: string | null) {
  const back = safeReturnTo(returnTo);
  return back === "/" ? "/auth/login" : `/auth/login?returnTo=${encodeURIComponent(back)}`;
}

/** Sign out of OVR and Auth0, then land on the home page. */
export const LOGOUT_HREF = "/auth/logout";

/** The only things /auth/login may be asked: where to come back to, and sign-up vs sign-in. */
const SCREEN_HINTS = new Set(["signup", "login"]);

/**
 * /auth/login and /auth/logout with only the parameters OVR itself uses, or null when the URL is
 * already clean. The SDK forwards any other /auth/login parameter to Auth0's /authorize (a
 * crafted link could ask for `scope=… email offline_access`, another `audience`, `prompt=none`…),
 * and passes /auth/logout's `returnTo` on unchecked (Auth0's Allowed Logout URLs is then the only
 * guard), so the proxy redirects to this clean URL first.
 */
export function cleanAuthUrl(url: URL): URL | null {
  // The SDK matches its routes after dropping a trailing slash ("/auth/login/" is sign-in too).
  // Next redirects those before the proxy today; this holds even if that's ever turned off.
  const path = url.pathname.replace(/\/+$/, "");
  const clean = new URL(path || "/", url);
  if (path === "/auth/login") {
    const back = url.searchParams.get("returnTo");
    if (back !== null && safeReturnTo(back) !== "/")
      clean.searchParams.set("returnTo", safeReturnTo(back));
    const hint = url.searchParams.get("screen_hint");
    if (hint !== null && SCREEN_HINTS.has(hint)) clean.searchParams.set("screen_hint", hint);
  } else if (path !== "/auth/logout") return null;
  const same = JSON.stringify([...clean.searchParams]) === JSON.stringify([...url.searchParams]);
  return same ? null : clean;
}
