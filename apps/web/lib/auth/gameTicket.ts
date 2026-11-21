import "server-only";
import { randomUUID } from "node:crypto";
import {
  NET,
  TICKET_NAME_MAX,
  type TicketClaims,
  learnerKey,
  newTicketId,
  signTicket,
} from "@ovr/shared";
import type { CurrentUser } from "./currentUser";

/**
 * Join tickets for the game server (contract: packages/shared/src/net/protocol.ts; format and
 * signing: packages/shared/src/net/ticket.ts, shared with the game server so both agree).
 *
 * The ticket names the player and carries `key`, an HMAC of the learner id under
 * GAME_TICKET_SECRET: stable per learner (two tabs are recognised as one person) without the id
 * itself, an email or an Auth0 sub ever leaving this server. Names are first names only for
 * signed-in students (as on the leaderboards) and "Guest 4821" for everyone else, the number
 * fixed per learner.
 */

export interface IssuedTicket {
  ticket: string;
  /** When the ticket stops working for joining (ISO 8601). */
  expiresAt: string;
  name: string;
  signedIn: boolean;
}

/** Control, separator and invisible format characters (bidi overrides, zero-widths), removed. */
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** A signed-in student's first name ("Reader" when they've only an email or a placeholder). */
export function firstNameOf(displayName: string | null | undefined): string {
  const first = (displayName ?? "").replace(/\s+/g, " ").replace(UNSAFE, "").trim().split(" ")[0];
  if (!first || first.includes("@")) return "Reader";
  let out = ""; // whole characters, at most TICKET_NAME_MAX UTF-16 units
  for (const ch of first) {
    if (out.length + ch.length > TICKET_NAME_MAX) break;
    out += ch;
  }
  return out || "Reader";
}

/** "Guest 1000" … "Guest 9999", fixed by the learner's key (so by the learner). */
export function guestName(key: string): string {
  let n = 0;
  for (const ch of key.slice(0, 8)) n = (n * 64 + ch.charCodeAt(0)) % 9000;
  return `Guest ${1000 + n}`;
}

/**
 * The ticket for `me`. Signed-out visitors without a learner (no database, or one we chose not to
 * create) get a one-off key and guest name: they can still join, just not recognised next time.
 */
export async function issueTicket(
  secret: string,
  me: Pick<CurrentUser, "learnerId" | "signedIn" | "authSub" | "displayName">,
  nowMs: number = Date.now(),
): Promise<IssuedTicket> {
  const id = me.learnerId
    ? `learner:${me.learnerId}`
    : me.signedIn && me.authSub
      ? `auth0:${me.authSub}`
      : `once:${randomUUID()}`;
  const key = await learnerKey(secret, id);
  const signedIn = me.signedIn;
  const name = signedIn ? firstNameOf(me.displayName) : guestName(key);
  const exp = Math.floor(nowMs / 1000) + NET.TICKET_TTL_S;
  const claims: TicketClaims = { key, name, signedIn, exp, jti: newTicketId() };
  return {
    ticket: await signTicket(secret, claims),
    expiresAt: new Date(exp * 1000).toISOString(),
    name,
    signedIn,
  };
}
