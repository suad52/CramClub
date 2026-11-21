import { clientKey, createRateLimiter } from "@/lib/ai/http";
import { authConfigured } from "@/lib/auth/auth0";
import { authFail, currentUser } from "@/lib/auth/currentUser";
import type { AccountInfo } from "@/lib/auth/types";

/**
 * GET /api/account: is sign-in set up, is this browser signed in, and under what name. No ids,
 * tokens or profile data beyond the name. The first call after signing in links the browser's
 * anonymous learner to the account (lib/learning/server/identity.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allow = createRateLimiter(120, 60_000);

function reply(info: AccountInfo) {
  return Response.json(info, { headers: { "cache-control": "private, no-store" } });
}

export async function GET(request: Request) {
  if (!authConfigured()) return reply({ configured: false, signedIn: false, displayName: null });
  if (!allow(clientKey(request))) return authFail("rate_limited", "Too many requests.", 429);
  try {
    const me = await currentUser(request);
    return reply({
      configured: true,
      signedIn: me.signedIn,
      displayName: me.signedIn ? me.displayName : null,
    });
  } catch (error) {
    console.error("[auth] GET /api/account", error);
    return authFail("server_error", "Couldn't check your account. Try again.", 500);
  }
}
