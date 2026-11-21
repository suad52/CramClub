import "server-only";
import { NextRequest } from "next/server";
import { getAuth0 } from "./auth0";
import { verifiedEmailHash } from "./emailHash";

/** A signed-in person, as the verified Auth0 session says: their stable id and a name to show. */
export interface VerifiedIdentity {
  /** Auth0's user id (`sub`), e.g. "google-oauth2|1098…". */
  sub: string;
  /** A short name from the profile, or null when it only has an email address. */
  name: string | null;
  /**
   * The keyed hash of the account's email (lib/auth/emailHash.ts), only when Auth0 says it's
   * verified; null otherwise (and for sessions from before OVR asked for the email). Never the
   * address itself.
   */
  emailHash?: string | null;
}

/**
 * Who the request is signed in as, from the encrypted Auth0 session cookie (the SDK decrypts it
 * with AUTH0_SECRET; the ID token was verified at sign-in). Null when sign-in isn't set up, nobody
 * is signed in, or the cookie doesn't check out. Nothing the client sends in a body, query or
 * header other than that cookie can change the answer.
 */
export async function verifiedIdentity(request: Request): Promise<VerifiedIdentity | null> {
  const auth0 = getAuth0();
  if (!auth0) return null;
  try {
    // Only the URL and headers (the cookie): a copy with the body would use up the request's.
    const session = await auth0.getSession(
      new NextRequest(request.url, { headers: request.headers }),
    );
    const sub = session?.user?.sub;
    if (typeof sub !== "string" || sub.length < 3 || sub.length > 255) return null;
    return {
      sub,
      name: profileName(session!.user),
      emailHash: verifiedEmailHash(session!.user),
    };
  } catch (error) {
    console.error("[auth] couldn't read the session:", (error as { code?: string }).code ?? error);
    return null;
  }
}

/**
 * A display name from an Auth0 profile: a first name only, because it becomes the learner's name
 * on the public leaderboard (which is opt-out). `given_name`, else the first word of `name`.
 * Never an email address (Auth0 sets `name` to the email for password accounts), and never the
 * nickname, which for those accounts is the email's local part ("jane.doe1987"). Null keeps the
 * "Reader 1a2b" placeholder, which the student can change. At most 32 characters.
 */
export function profileName(user: Record<string, unknown>): string | null {
  const one = (value: unknown) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, 32).trim() : "";
  const given = one(user.given_name);
  if (given && !given.includes("@")) return given;
  const name = one(user.name);
  if (!name || name.includes("@")) return null;
  return name.split(" ")[0] || null;
}
