import { type NextRequest, NextResponse } from "next/server";
import { getAuth0 } from "@/lib/auth/auth0";
import { cleanAuthUrl } from "@/lib/auth/links";

/**
 * Next 16's proxy (formerly middleware). With Auth0 set up it mounts the SDK's routes
 * (/auth/login, /auth/logout, /auth/callback, /auth/profile) and keeps the session cookie rolling
 * on page loads. Without the keys it changes nothing, except that /auth/* says sign-in isn't set
 * up. API routes check the session themselves (lib/auth/currentUser.ts), so they're skipped here,
 * as are Next's assets and any file with an extension (models, images, fonts). /auth/login and
 * /auth/logout only ever see the parameters OVR uses (cleanAuthUrl): anything else is redirected
 * away before the SDK can forward it to Auth0.
 */
export async function proxy(request: NextRequest) {
  const auth0 = getAuth0();
  if (auth0) {
    // On APP_BASE_URL (set whenever Auth0 is), as the SDK's own redirects are.
    const { pathname, search } = request.nextUrl;
    const clean = cleanAuthUrl(new URL(pathname + search, process.env.APP_BASE_URL));
    if (clean) return NextResponse.redirect(clean);
    return auth0.middleware(request);
  }
  if (request.nextUrl.pathname.startsWith("/auth/"))
    return new NextResponse(
      "Sign-in isn't set up yet. Add the Auth0 keys to apps/web/.env.local (see docs/auth0.md).",
      { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/|__nextjs|api/|.*\\..*).*)"],
};
