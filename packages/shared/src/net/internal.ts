/**
 * Signed server-to-server requests: the game server asking the web app for Ms. Fenwick's chat
 * reply (POST /api/internal/fenwick-chat). Both servers already share GAME_TICKET_SECRET; this
 * signs `ovr-internal.v1.<timestamp>.<raw JSON body>` with it, so a request can't be forged,
 * altered or replayed outside a short window. Browsers never hold the secret.
 *
 * Headers: INTERNAL_SIGNATURE_HEADER (base64url HMAC-SHA256), INTERNAL_TIMESTAMP_HEADER (ms since
 * epoch, decimal). The web app refuses a missing/bad signature or a timestamp more than
 * INTERNAL_MAX_SKEW_MS from its own clock.
 */
import type { ChatLine } from "./protocol";
import { constantTimeEqual, hmac } from "./ticket";

export const INTERNAL_SIGNATURE_HEADER = "x-ovr-signature";
export const INTERNAL_TIMESTAMP_HEADER = "x-ovr-timestamp";
export const INTERNAL_MAX_SKEW_MS = 60_000;
const CONTEXT = "ovr-internal.v1.";

export async function signInternal(
  secret: string,
  timestamp: number,
  body: string,
): Promise<string> {
  return hmac(secret, `${CONTEXT}${timestamp}.${body}`);
}

export type InternalCheck =
  | { ok: true }
  | { ok: false; reason: "missing_secret" | "missing_headers" | "stale" | "bad_signature" };

export async function verifyInternal(
  secret: string | undefined,
  signature: string | null | undefined,
  timestamp: string | null | undefined,
  body: string,
  now: number = Date.now(),
): Promise<InternalCheck> {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (!signature || !timestamp || !/^\d{1,16}$/.test(timestamp))
    return { ok: false, reason: "missing_headers" };
  const ts = Number(timestamp);
  if (Math.abs(now - ts) > INTERNAL_MAX_SKEW_MS) return { ok: false, reason: "stale" };
  const expected = await signInternal(secret, ts, body);
  return constantTimeEqual(expected, signature)
    ? { ok: true }
    : { ok: false, reason: "bad_signature" };
}

/** POST /api/internal/fenwick-chat request body. */
export interface FenwickChatRequest {
  /** First name (ticket name) of the player she's answering. */
  askerName: string;
  /** Recent room chat, oldest first (at most CHAT.FENWICK_CONTEXT_LINES); the asker's
   * unanswered line(s) are last. `fenwick: true` marks her own earlier lines. */
  lines: { name: string; text: string; fenwick: boolean; asker: boolean }[];
  /** Nobody else is in the room. */
  alone: boolean;
}

/**
 * Response: her reply (plain text, at most CHAT.MAX_CHARS), or null when the message doesn't
 * call for one ("brb", "ok", a goodbye). Errors: 401 bad signature, 400 bad body, 503 not
 * configured; the game server treats any error as "stay quiet".
 */
export interface FenwickChatResponse {
  reply: string | null;
}

/** Re-exported for convenience in both servers. */
export type { ChatLine };
