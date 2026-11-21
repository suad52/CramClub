/**
 * Join tickets (see protocol.ts): `base64url(JSON TicketClaims) + "." + base64url(HMAC-SHA256)`,
 * signed by the web app (GET /api/net/ticket) and checked by the game server in onAuth, both
 * with GAME_TICKET_SECRET.
 *
 * Only Web Crypto (`globalThis.crypto.subtle`) is used, which Node 22, Next's runtimes and
 * browsers all have, so this module is safe in any bundle. It holds no secret: callers pass it in
 * from their own environment, which only the two servers have.
 */
import { NET, type TicketClaims } from "./protocol";

/** Why a ticket was refused. */
export type TicketFailure =
  "missing_secret" | "malformed" | "bad_signature" | "expired" | "invalid_claims";

export type TicketCheck = { ok: true; claims: TicketClaims } | { ok: false; reason: TicketFailure };

/** Longest ticket accepted (a real one is ~200 characters). */
export const MAX_TICKET_LENGTH = 1024;
/** Longest name a ticket may carry (first names are cut to this). */
export const TICKET_NAME_MAX = 32;
/** Learner keys are 22 base64url characters (128 bits of an HMAC); ticket ids are 16. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
/**
 * Characters a name may not carry: control characters, line/paragraph separators and invisible
 * format characters (bidi overrides, zero-width joiners/spaces, BOM), which could make a name
 * render as something else ("Guest 1234" spelled backwards, a blank tag).
 */
export const NAME_UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
/** Clock slack between the two servers when judging how far ahead an expiry may be. */
const SKEW_S = 60;

/* ---- Bytes, without Node's Buffer or the DOM's btoa ---- */

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function toBase64Url(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (b !== undefined) out += ALPHABET[(n >> 6) & 63]!;
    if (c !== undefined) out += ALPHABET[n & 63]!;
  }
  return out;
}

/** Null for anything that isn't unpadded base64url. */
export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let value = 0;
  let bits = 0;
  let j = 0;
  for (const ch of text) {
    value = ((value << 6) | ALPHABET.indexOf(ch)) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[j++] = (value >> bits) & 0xff;
    }
  }
  return out;
}

interface Utf8 {
  TextEncoder: new () => { encode(text: string): Uint8Array };
  TextDecoder: new (
    label: string,
    options: { fatal: boolean },
  ) => {
    decode(bytes: Uint8Array): string;
  };
}
const utf8 = globalThis as unknown as Utf8;
const encode = (text: string) => new utf8.TextEncoder().encode(text);
const decode = (bytes: Uint8Array) => new utf8.TextDecoder("utf-8", { fatal: true }).decode(bytes);

/** Same length and same characters, without stopping at the first difference. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---- HMAC-SHA256 through Web Crypto ---- */

interface HmacSubtle {
  importKey(
    format: "raw",
    keyData: Uint8Array,
    algorithm: { name: "HMAC"; hash: "SHA-256" },
    extractable: boolean,
    keyUsages: string[],
  ): Promise<object>;
  sign(algorithm: "HMAC", key: object, data: Uint8Array): Promise<ArrayBuffer>;
}

function subtle(): HmacSubtle {
  const c = (globalThis as unknown as { crypto?: { subtle?: HmacSubtle } }).crypto;
  if (!c?.subtle) throw new Error("Web Crypto (crypto.subtle) is not available here");
  return c.subtle;
}

const keyCache = new Map<string, Promise<object>>();
function hmacKey(secret: string): Promise<object> {
  let key = keyCache.get(secret);
  if (!key) {
    if (keyCache.size >= 4) keyCache.clear();
    key = subtle().importKey("raw", encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
      "sign",
    ]);
    keyCache.set(secret, key);
  }
  return key;
}

/** base64url(HMAC-SHA256(secret, message)). Callers add their own context prefix (see below). */
export async function hmac(secret: string, message: string): Promise<string> {
  const mac = await subtle().sign("HMAC", await hmacKey(secret), encode(message));
  return toBase64Url(new Uint8Array(mac));
}

// Domain separation: the same secret signs tickets, derives learner keys and signs the game
// server's internal requests to the web app (internal.ts, "ovr-internal.v1.").
const TICKET_CONTEXT = "ovr-ticket.v1.";
const KEY_CONTEXT = "ovr-learner-key:";

/* ---- Claims ---- */

/** A ticket's claims, cleaned, if they have the right shape. */
export function parseTicketClaims(value: unknown): TicketClaims | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.key !== "string" || !KEY_PATTERN.test(v.key)) return null;
  if (typeof v.name !== "string") return null;
  const name = v.name.trim();
  if (!name || name.length > TICKET_NAME_MAX || NAME_UNSAFE.test(name)) return null;
  if (typeof v.signedIn !== "boolean") return null;
  if (typeof v.exp !== "number" || !Number.isInteger(v.exp) || v.exp <= 0) return null;
  const claims: TicketClaims = { key: v.key, name, signedIn: v.signedIn, exp: v.exp };
  if (v.jti !== undefined) {
    if (typeof v.jti !== "string" || !KEY_PATTERN.test(v.jti)) return null;
    claims.jti = v.jti;
  }
  return claims;
}

/** A fresh random ticket id (96 bits, 16 base64url characters). */
export function newTicketId(): string {
  const c = (globalThis as unknown as { crypto?: { getRandomValues?(a: Uint8Array): Uint8Array } })
    .crypto;
  if (!c?.getRandomValues) throw new Error("Web Crypto (crypto.getRandomValues) is not available");
  return toBase64Url(c.getRandomValues(new Uint8Array(12)));
}

/** The part of a ticket that identifies it (its signature), for one-time-use bookkeeping. */
export function ticketId(ticket: string): string {
  return ticket.slice(ticket.lastIndexOf(".") + 1);
}

/**
 * The opaque per-learner key a ticket carries: an HMAC of the learner id, so the raw id never
 * leaves the web app and the game server can't turn it back into one.
 */
export async function learnerKey(secret: string, learnerId: string): Promise<string> {
  return (await hmac(secret, KEY_CONTEXT + learnerId)).slice(0, 22);
}

/** Signs `claims` (call parseTicketClaims-valid claims; a bad shape throws). */
export async function signTicket(secret: string, claims: TicketClaims): Promise<string> {
  if (!secret) throw new Error("GAME_TICKET_SECRET is not set");
  const clean = parseTicketClaims(claims);
  if (!clean) throw new Error("Ticket claims have the wrong shape");
  const payload = toBase64Url(encode(JSON.stringify(clean)));
  return `${payload}.${await hmac(secret, TICKET_CONTEXT + payload)}`;
}

/**
 * Checks a ticket: the signature (compared in constant time), the claims' shape, and the expiry
 * (`exp` must be in the future, and not further ahead than a fresh ticket's lifetime).
 */
export async function verifyTicket(
  secret: string | undefined,
  ticket: unknown,
  nowMs: number = Date.now(),
): Promise<TicketCheck> {
  if (!secret) return { ok: false, reason: "missing_secret" };
  if (typeof ticket !== "string" || ticket.length > MAX_TICKET_LENGTH)
    return { ok: false, reason: "malformed" };
  const parts = ticket.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payload, signature] = parts as [string, string];
  if (!payload || !/^[A-Za-z0-9_-]{43}$/.test(signature)) return { ok: false, reason: "malformed" };
  const expected = await hmac(secret, TICKET_CONTEXT + payload);
  if (!constantTimeEqual(signature, expected)) return { ok: false, reason: "bad_signature" };

  const bytes = fromBase64Url(payload);
  if (!bytes) return { ok: false, reason: "malformed" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(decode(bytes));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const claims = parseTicketClaims(parsed);
  if (!claims) return { ok: false, reason: "invalid_claims" };
  const nowS = Math.floor(nowMs / 1000);
  if (claims.exp <= nowS) return { ok: false, reason: "expired" };
  if (claims.exp > nowS + NET.TICKET_TTL_S + SKEW_S) return { ok: false, reason: "invalid_claims" };
  return { ok: true, claims };
}
