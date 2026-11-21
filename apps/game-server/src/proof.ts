import { MAX_TICKET_LENGTH } from "@ovr/shared";
import { type GameServerConfig, originAllowed } from "./config";
import { type Refusal, admitTicket } from "./tickets";

/**
 * POST /proof/ticket { ticket } → { accepted: true } | { accepted: false, reason }: the /proof
 * page's live replay test (apps/web/app/proof). It runs a ticket through admitTicket, exactly as
 * joining the library does, without making a player or touching a room: the first use of a fresh
 * ticket is accepted and claims it, a second use is refused with "ticket_replayed". Nothing about
 * the ticket (its name or key) is echoed back.
 *
 * Same Origin rule as the room's WebSocket (403 for browsers on other sites), a JSON body of at
 * most MAX_TICKET_LENGTH characters' ticket (400 otherwise), and rate limits per client address
 * (X-Forwarded-For's first hop, which Caddy sets in production) and for everyone together (429),
 * so it can't be used to hammer the ledger.
 */

/** Uses per client address per minute: a judge pressing "Run again" a few times. */
export const PROOF_PER_CLIENT = 10;
/** Uses per minute, all clients together. */
export const PROOF_GLOBAL = 120;
const WINDOW_MS = 60_000;

/** A sliding-window counter per key, with the number of keys it remembers bounded. */
export class WindowLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  take(key: string, now: number = Date.now()): boolean {
    if (this.hits.size >= this.maxKeys && !this.hits.has(key)) this.prune(now);
    if (this.hits.size >= this.maxKeys && !this.hits.has(key)) return false;
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  private prune(now: number) {
    for (const [k, list] of this.hits)
      if (list.every((t) => now - t >= this.windowMs)) this.hits.delete(k);
  }
}

export interface ProofLimits {
  perClient: WindowLimiter;
  global: WindowLimiter;
}

export const createProofLimits = (): ProofLimits => ({
  perClient: new WindowLimiter(PROOF_PER_CLIENT, WINDOW_MS),
  global: new WindowLimiter(PROOF_GLOBAL, WINDOW_MS),
});

export type ProofAnswer =
  | { status: 200; body: { accepted: true } | { accepted: false; reason: Refusal } }
  | { status: 400 | 403 | 429; body: { error: string } };

/** The client's address as the proxy saw it (first hop), or "direct". */
export function clientAddress(headers: Headers): string {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "direct";
}

export async function proofTicket(
  body: unknown,
  headers: Headers,
  config: GameServerConfig,
  limits: ProofLimits,
  now: number = Date.now(),
): Promise<ProofAnswer> {
  if (!originAllowed(headers.get("origin"), config.allowedOrigins))
    return { status: 403, body: { error: "origin_not_allowed" } };
  if (!limits.perClient.take(clientAddress(headers), now) || !limits.global.take("all", now))
    return { status: 429, body: { error: "rate_limited" } };
  const ticket = (body as { ticket?: unknown } | null)?.ticket;
  if (typeof ticket !== "string" || ticket.length === 0 || ticket.length > MAX_TICKET_LENGTH)
    return { status: 400, body: { error: "ticket_missing" } };
  const admission = await admitTicket(config.ticketSecret, ticket);
  return {
    status: 200,
    body: admission.ok ? { accepted: true } : { accepted: false, reason: admission.reason },
  };
}
