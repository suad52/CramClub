import "server-only";
import { createHmac, hkdfSync } from "node:crypto";

/**
 * Email invites without keeping email addresses (docs/auth0.md). OVR asks Auth0 for the `email`
 * scope, and when the ID token says `email_verified: true` the learner gets a keyed hash of that
 * address (learners.email_hash). A private table's holder can invite by typing an address: the
 * invite stores the same hash and a masked form for the holder's own list ("bi•••@gmail.com").
 * Matching the two is the whole feature, so the address itself never reaches the database or a
 * log.
 *
 * The hash is HMAC-SHA256 with a server key, not a plain SHA-256: without the key, a copy of the
 * database can't be checked against a list of known addresses. The key is EMAIL_HASH_SECRET, or
 * one derived from AUTH0_SECRET when that isn't set, read at request time. Changing the key in use
 * forgets existing email invites (learners' hashes refresh on their next request).
 */

/** The longest address OVR takes (the SMTP path limit). */
export const MAX_EMAIL_LENGTH = 254;

/**
 * How addresses are compared: ASCII spaces trimmed and ASCII letters lowercased ("  Bi@Gmail.COM"
 * is "bi@gmail.com"). Only ASCII, on purpose: String.prototype.toLowerCase also folds some other
 * characters INTO ASCII (the Kelvin sign "\u212A" becomes "k"), so a verified "\u212Aate@x.com"
 * would otherwise hash like "kate@x.com" and open Kate's invites. Typed invites are ASCII anyway
 * (the route checks the address), so any other character simply never matches one.
 */
export function normalizeEmail(email: string): string {
  return email
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "")
    .replace(/[A-Z]+/g, (s) => s.toLowerCase());
}

/** The shortest EMAIL_HASH_SECRET used (`openssl rand -hex 32` is 64); a shorter one is ignored. */
export const MIN_EMAIL_HASH_SECRET = 32;
let warnedShort = false;

/** The HMAC key, or null when neither secret is set (then nothing can be hashed). */
function hashKey(): Buffer | null {
  const own = process.env.EMAIL_HASH_SECRET?.trim();
  if (own && own.length >= MIN_EMAIL_HASH_SECRET) return Buffer.from(own, "utf8");
  if (own && !warnedShort) {
    // A short key could be guessed, and then every stored hash checked against known addresses.
    warnedShort = true;
    console.warn(
      `[auth] EMAIL_HASH_SECRET is shorter than ${MIN_EMAIL_HASH_SECRET} characters, so it's ignored (using one derived from AUTH0_SECRET).`,
    );
  }
  const auth = process.env.AUTH0_SECRET?.trim();
  if (!auth) return null;
  return Buffer.from(hkdfSync("sha256", auth, "ovr", "ovr email hash v1", 32));
}

/**
 * The stored form of an address: HMAC-SHA256 (64 hex characters) of its normalized form. Null
 * without a key, or for something that can't be an address (empty, no "@", too long).
 */
export function hashEmail(email: string): string | null {
  const clean = normalizeEmail(email);
  if (!clean || clean.length > MAX_EMAIL_LENGTH || !clean.includes("@")) return null;
  const key = hashKey();
  return key ? createHmac("sha256", key).update(clean, "utf8").digest("hex") : null;
}

/**
 * The hash of a session's email, only when the ID token says it's verified (`email_verified`
 * exactly true). Unverified, missing (a session from before OVR asked for it) or malformed: null.
 */
export function verifiedEmailHash(user: Record<string, unknown>): string | null {
  if (user.email_verified !== true || typeof user.email !== "string") return null;
  return hashEmail(user.email);
}

/**
 * "bi•••@gmail.com": enough for a holder to tell their invites apart, computed from what they
 * typed. The first two characters of the name (one, for a name that short) and the domain.
 */
export function maskEmail(email: string): string {
  const clean = normalizeEmail(email);
  const at = clean.lastIndexOf("@");
  const name = [...(at > 0 ? clean.slice(0, at) : clean)];
  const domain = at > 0 ? clean.slice(at + 1) : "";
  return `${name.slice(0, name.length > 2 ? 2 : 1).join("")}•••@${domain}`;
}
