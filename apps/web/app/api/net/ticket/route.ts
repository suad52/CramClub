import { clientKey, createRateLimiter } from "@/lib/ai/http";
import { type CurrentUser, currentUser } from "@/lib/auth/currentUser";
import { issueTicket } from "@/lib/auth/gameTicket";
import { crossOriginRefused, crossOriginWrite } from "@/lib/auth/sameOrigin";

/**
 * GET /api/net/ticket → { ticket, expiresAt, name, signedIn }: a short-lived signed ticket for
 * joining the game server's library room (lib/auth/gameTicket.ts; contract in
 * packages/shared/src/net/protocol.ts). Who it's for comes only from the verified Auth0 session
 * or the signed anonymous learner cookie (lib/auth/currentUser.ts). A first-time visitor becomes
 * an anonymous learner here (a few per address), so their guest name stays theirs.
 *
 * 503 multiplayer_not_configured without GAME_TICKET_SECRET; 403 from another site (the ticket
 * stands for the visitor); 429 when asked too often.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "private, no-store" };
const fail = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status, headers: HEADERS });

/** A ticket is needed only to join or rejoin: a tab asks a few times a minute at most. */
const allowTicket = createRateLimiter(30, 60_000);
/** New anonymous learners made here, per address (school networks share one). */
const allowNewLearner = createRateLimiter(30, 10 * 60_000);

export async function GET(request: Request) {
  if (crossOriginWrite(request)) return crossOriginRefused();
  const secret = process.env.GAME_TICKET_SECRET?.trim();
  if (!secret)
    return fail(
      "multiplayer_not_configured",
      "Multiplayer isn't set up: GAME_TICKET_SECRET is missing (see docs/multiplayer.md).",
      503,
    );
  try {
    let me: CurrentUser = await currentUser(request);
    if (!allowTicket(me.learnerId ?? `ip:${clientKey(request)}`))
      return fail("rate_limited", "That's a lot at once. Try again in a minute.", 429);
    if (!me.signedIn && !me.learnerId && allowNewLearner(clientKey(request)))
      me = await currentUser(request, { create: true });
    const response = Response.json(await issueTicket(secret, me), { headers: HEADERS });
    if (me.setCookie) response.headers.append("Set-Cookie", me.setCookie);
    return response;
  } catch (error) {
    console.error("[net] ticket", (error as { code?: string }).code ?? error);
    return fail("server_error", "Couldn't get you into the library just now. Try again.", 500);
  }
}
