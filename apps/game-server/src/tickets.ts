import { type TicketClaims, type TicketFailure, ticketId, verifyTicket } from "@ovr/shared";
import { TicketLedger } from "./rooms/rules";

/**
 * Ticket admission, in one place: the library room's onAuth (joining) and POST /proof/ticket (the
 * /proof page's replay test, server.ts) both go through admitTicket, against the same
 * process-wide ledger, so a ticket works exactly once whichever of them sees it first. A ticket
 * claimed by the replay test can't then be used to join, and the other way round.
 */

/** Every ticket used, process-wide (matchmaking runs here too): each works once. */
export const usedTickets = new TicketLedger();

export type Refusal = `ticket_${TicketFailure}` | "ticket_replayed";

export type Admission = { ok: true; claims: TicketClaims } | { ok: false; reason: Refusal };

/**
 * Checks a ticket's signature and expiry, then claims its id. The claim comes after the await,
 * so two requests racing with one ticket can't both get through.
 */
export async function admitTicket(
  secret: string | undefined,
  ticket: unknown,
  ledger: TicketLedger = usedTickets,
): Promise<Admission> {
  const check = await verifyTicket(secret, ticket);
  if (!check.ok) return { ok: false, reason: `ticket_${check.reason}` };
  if (!ledger.claim(ticketId(ticket as string), check.claims.exp))
    return { ok: false, reason: "ticket_replayed" };
  return { ok: true, claims: check.claims };
}
