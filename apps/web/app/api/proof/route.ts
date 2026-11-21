import { clientKey, createRateLimiter } from "@/lib/ai/http";
import { proofReport } from "@/lib/proof/server";

/**
 * GET /api/proof → ProofReport (lib/proof/types.ts): the live, read-only facts behind the /proof
 * page for sponsor judges. Public and safe to show anyone: counts, timings, states and the
 * database's own catalog, never secrets, user ids, emails, worker hostnames, bucket names or
 * keys. The shared part is rebuilt at most every few seconds per server process
 * (lib/proof/server.ts); whether the viewer is signed in is answered per request (yes or no), so
 * the response is private to the browser and kept only briefly.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A judge reloading, or the page's own refresh button: never more than this. */
const allow = createRateLimiter(30, 60_000);

export async function GET(request: Request) {
  if (!allow(clientKey(request)))
    return Response.json(
      { error: { code: "rate_limited", message: "That's a lot of refreshing. Try in a minute." } },
      { status: 429, headers: { "cache-control": "no-store" } },
    );
  try {
    return Response.json(await proofReport(request), {
      headers: { "cache-control": "private, max-age=5" },
    });
  } catch (error) {
    console.error("[proof]", (error as { code?: string }).code ?? (error as Error).message);
    return Response.json(
      { error: { code: "server_error", message: "Couldn't put the report together just now." } },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
