import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Study Circle invite tokens. The link carries the random token; the database keeps only its
 * SHA-256 (circle_invites.token_hash), so someone who can read the table can't use an invite.
 */
export function newInviteToken() {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/** The stored form of a token. Look invites up by this, never by the raw token. */
export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** Whether a string could be a token from newInviteToken (check before hashing user input). */
export function isInviteToken(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32}$/.test(value);
}
