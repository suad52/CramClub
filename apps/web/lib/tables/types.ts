/**
 * Reservable tables: the contract between the server (lib/tables/server.ts, app/api/tables) and
 * the library UI. Like a real library, the first student to sit at a free table can hold it for a
 * set time, open to everyone or private. The SERVER decides who may sit; the browser only asks.
 *
 * Identity: the verified learner (lib/auth/currentUser.ts). A PUBLIC hold works for anyone
 * (signed in or not). A PRIVATE hold, and joining someone's private table, need an Auth0 sign-in.
 *
 * Endpoints (same-origin; JSON bodies need `content-type: application/json`):
 *   GET  /api/tables                     → TablesView   (every table's public status + mine)
 *   POST /api/tables/:tableId/sit        → SitResult    (ask to sit: the server says yes/no)
 *   POST /api/tables/:tableId/claim  { visibility, circleId?, minutes? } → TableStatus  (first
 *        sitter only; holds it for HOLD_MINUTES, or `minutes` when sent: a whole number from
 *        MIN_HOLD_MINUTES up to HOLD_MINUTES, never longer (the judge demo, lib/demo, asks for a
 *        short hold); 409 if someone already holds it)
 *   PATCH /api/tables/:tableId       { visibility?, circleId? | null } → TableStatus   (holder)
 *   POST /api/tables/:tableId/invite → { link, path, expiresAt }  (holder of a private table)
 *   POST /api/tables/join { token }  → { tableId, status: TableStatus }  (signed in; adds you
 *        to the guest list for that hold only)
 *   POST /api/tables/:tableId/release → { ok: true }  (holder gives it up early)
 *   POST /api/tables/:tableId/email-invites { email } → 201 { invite: TableEmailInvite }  (holder
 *        of a private table, signed in; the same answer whether or not anyone has that email,
 *        so it can't be used to find out who has an account)
 *   DELETE /api/tables/:tableId/email-invites/:id → { ok: true }  (holder)
 * The holder's list of email invites comes with their own TableStatus (`emailInvites`).
 * Errors: { error: { code, message } } — 401 sign_in_required, 403 table_private (with who/until
 * in the message), 404 not_found, 409 table_taken, 503 auth_not_configured (private only).
 */

/** How long a hold lasts, like a library booking. */
export const HOLD_MINUTES = 60;
/** The shortest hold a claim may ask for (`minutes`; only ever shorter than HOLD_MINUTES). */
export const MIN_HOLD_MINUTES = 1;
/** When the holder gets a "time's nearly up" notice. */
export const WARN_MINUTES = 5;

/**
 * The hold length a claim gets: HOLD_MINUTES, or the shorter whole number of minutes it asked
 * for. Anything else (longer, fractional, not a number) can never lengthen a hold.
 */
export function holdMinutesFor(asked: unknown): number {
  if (typeof asked !== "number" || !Number.isFinite(asked)) return HOLD_MINUTES;
  return Math.min(HOLD_MINUTES, Math.max(MIN_HOLD_MINUTES, Math.floor(asked)));
}
/** Email invites one hold can have. */
export const EMAIL_INVITES_PER_HOLD = 20;

export type TableVisibility = "public" | "private";

/** What anyone can know about a table (no ids, emails or guest lists). */
export interface TableStatus {
  tableId: string;
  /** Free: nobody holds it. */
  held: boolean;
  visibility: TableVisibility | null;
  /** First name of whoever holds it, or null when free. */
  holderName: string | null;
  /** ISO time the hold ends, or null when free. */
  endsAt: string | null;
  /** Whether the CURRENT student may sit here right now. */
  canSit: boolean;
  /** Whether the current student holds it. */
  mine: boolean;
  /**
   * For a private table the current student may use: why ("holder", "guest" by invite link,
   * "email" by an invite to their verified email, "circle").
   */
  access: "holder" | "guest" | "email" | "circle" | "public" | "free" | null;
  /** Name of the Study Circle whose members may sit (private tables, shown to allowed students). */
  circleName: string | null;
  /** The holder's own email invites (only in the holder's status: never anyone else's). */
  emailInvites?: TableEmailInvite[];
}

/** One email invite, as its holder sees it: never the address, only a masked form of it. */
export interface TableEmailInvite {
  id: string;
  /** "bi•••@gmail.com", from what the holder typed. */
  masked: string;
}

/** A private table that invited the current student's verified email (for a notice). */
export interface TableInvitation {
  tableId: string;
  /** The holder's first name. */
  holderName: string;
  /** ISO time the hold ends. */
  endsAt: string;
}

export interface TablesView {
  tables: TableStatus[];
  /** The table the current student holds, if any (one at a time). */
  mine: TableStatus | null;
  signedIn: boolean;
  /** Whether private tables are possible (Auth0 configured). */
  privateAvailable: boolean;
  serverTime: string;
  /** Live private tables whose holders invited the current student's verified email. */
  invitedTo?: TableInvitation[];
  /** Signed in with an email Auth0 says is verified (so email invites can reach them). */
  emailVerified?: boolean;
}

/** The answer to "can I sit here?". */
export type SitResult =
  | { ok: true; status: TableStatus; firstHere: boolean }
  | { ok: false; status: TableStatus; reason: "private" | "sign_in_required"; message: string };
