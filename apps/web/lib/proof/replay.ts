/**
 * The /proof page's live "replay a join ticket" test, run from the judge's own browser:
 *
 *   1. GET /api/net/ticket: the web app verifies who is asking (the Auth0 session, or the signed
 *      guest cookie) and signs a fresh single-use ticket, exactly as when entering the library.
 *   2. POST <game server>/proof/ticket with it: the game server checks the signature and expiry
 *      and claims the ticket's id in the same ledger joining uses. Expect "accepted".
 *   3. The same POST again. Expect "refused" with ticket_replayed.
 *
 * The game server's address comes from NEXT_PUBLIC_GAME_SERVER_URL (lib/proof/urls.ts), so in
 * production the requests go through Caddy's /game route like a real join. No player is made and
 * the ticket is never shown. `fetch` is passed in so this is tested without a network.
 */

export type TicketUse =
  | { kind: "answer"; accepted: true }
  | { kind: "answer"; accepted: false; reason: string }
  | { kind: "error"; status: number | null; code: string };

export type ReplayResult =
  | { status: "no_ticket"; code: string; message: string }
  | { status: "no_game_server" }
  | {
      status: "ran";
      /** When the ticket would have stopped working anyway (ISO). */
      expiresAt: string;
      signedIn: boolean;
      first: TicketUse;
      second: TicketUse;
      /** 1st accepted, 2nd refused as a replay. */
      passed: boolean;
    };

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function spendTicket(fetchFn: Fetch, url: string, ticket: string): Promise<TicketUse> {
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticket }),
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    return { kind: "error", status: null, code: "unreachable" };
  }
  const body = (await res.json().catch(() => null)) as {
    accepted?: unknown;
    reason?: unknown;
    error?: unknown;
  } | null;
  if (res.ok && body?.accepted === true) return { kind: "answer", accepted: true };
  if (res.ok && body?.accepted === false)
    return {
      kind: "answer",
      accepted: false,
      reason: typeof body.reason === "string" ? body.reason : "refused",
    };
  return {
    kind: "error",
    status: res.status,
    code: typeof body?.error === "string" ? body.error : "bad_response",
  };
}

export async function runReplayTest(
  fetchFn: Fetch,
  proofUrl: string | null,
  ticketUrl = "/api/net/ticket",
): Promise<ReplayResult> {
  if (!proofUrl) return { status: "no_game_server" };
  let issued: { ticket?: unknown; expiresAt?: unknown; signedIn?: unknown } | null = null;
  let failure = { code: "unreachable", message: "Couldn't reach the web app for a ticket." };
  try {
    const res = await fetchFn(ticketUrl, { cache: "no-store", credentials: "same-origin" });
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (res.ok) issued = body;
    else {
      const error = body?.error as { code?: unknown; message?: unknown } | undefined;
      failure = {
        code: typeof error?.code === "string" ? error.code : `http_${res.status}`,
        message: typeof error?.message === "string" ? error.message : "No ticket was issued.",
      };
    }
  } catch {
    // failure stays "unreachable"
  }
  if (!issued || typeof issued.ticket !== "string") return { status: "no_ticket", ...failure };
  const first = await spendTicket(fetchFn, proofUrl, issued.ticket);
  const second = await spendTicket(fetchFn, proofUrl, issued.ticket);
  return {
    status: "ran",
    expiresAt: typeof issued.expiresAt === "string" ? issued.expiresAt : "",
    signedIn: issued.signedIn === true,
    first,
    second,
    passed:
      first.kind === "answer" &&
      first.accepted &&
      second.kind === "answer" &&
      !second.accepted &&
      second.reason === "ticket_replayed",
  };
}
