import "server-only";
import type postgres from "postgres";
import { db } from "@/lib/learning/server/db";
import { accountLearner, anonymousLearner, cookieLearnerId } from "@/lib/learning/server/identity";
import { authConfigured } from "./auth0";
import { verifiedIdentity } from "./session";
import type { AuthErrorCode } from "./types";

/**
 * The asking user, for route handlers. Identity comes only from the verified Auth0 session (or,
 * signed out, the signed anonymous cookie): never from ids in the URL, body or headers.
 *
 * Private features (personal libraries, Study Circles) start with `requireUser`:
 *
 *   const me = await requireUser(request);
 *   if (me instanceof Response) return me; // 503 auth_not_configured or 401 sign_in_required
 *   await me.sql`SELECT … WHERE owner_id = ${me.learnerId}`;
 *
 * and then check ownership or circle membership for every row they read or change.
 */
export interface CurrentUser {
  /** Null for a signed-out visitor with no learner yet (unless `create`), or without a database. */
  learnerId: string | null;
  signedIn: boolean;
  authSub: string | null;
  displayName: string | null;
  /**
   * Signed in with a verified email: its keyed hash (lib/auth/emailHash.ts), for email invites.
   * Null (or absent) otherwise. Never the address.
   */
  emailHash?: string | null;
  /** Set-Cookie for a new anonymous learner (only with `create`). */
  setCookie?: string;
}

export interface SignedInUser {
  learnerId: string;
  signedIn: true;
  authSub: string;
  displayName: string;
  /** The database, ready to use (requireUser checked it's configured). */
  sql: postgres.Sql;
}

/** Who's asking, signed in or not. On a first sign-in this links the browser's learner. */
export async function currentUser(
  request: Request,
  { create = false }: { create?: boolean } = {},
): Promise<CurrentUser> {
  const sql = db();
  const identity = await verifiedIdentity(request);
  if (identity) {
    if (!sql)
      return {
        learnerId: null,
        signedIn: true,
        authSub: identity.sub,
        displayName: identity.name,
        emailHash: identity.emailHash ?? null,
      };
    const me = await accountLearner(sql, identity, cookieLearnerId(request));
    return {
      learnerId: me.id,
      signedIn: true,
      authSub: identity.sub,
      displayName: me.displayName,
      emailHash: me.emailHash,
    };
  }
  const nobody = {
    learnerId: null,
    signedIn: false,
    authSub: null,
    displayName: null,
    emailHash: null,
  };
  if (!sql || !process.env.LEARNER_SECRET) return nobody;
  const me = await anonymousLearner(sql, request, create);
  if (!me) return nobody;
  return {
    learnerId: me.id,
    signedIn: false,
    authSub: null,
    displayName: me.displayName,
    emailHash: null,
    setCookie: me.setCookie,
  };
}

/** The usual error body, never cached. */
export function authFail(
  code: AuthErrorCode | "not_configured" | "rate_limited" | "server_error",
  message: string,
  status: number,
) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

/**
 * The signed-in user, or the Response to send instead: 503 `auth_not_configured` while Auth0
 * isn't set up, 503 `not_configured` without a database, 401 `sign_in_required` when nobody is
 * signed in (or the session doesn't verify), 500 if the database fails.
 */
export async function requireUser(request: Request): Promise<SignedInUser | Response> {
  if (!authConfigured())
    return authFail(
      "auth_not_configured",
      "Sign-in isn't set up yet, so personal libraries and Study Circles are off (see docs/auth0.md).",
      503,
    );
  const sql = db();
  if (!sql)
    return authFail(
      "not_configured",
      "Personal libraries need DATABASE_URL (see docs/learning-analytics.md).",
      503,
    );
  try {
    const identity = await verifiedIdentity(request);
    if (!identity)
      return authFail("sign_in_required", "Sign in to use your library and Study Circles.", 401);
    const me = await accountLearner(sql, identity, cookieLearnerId(request));
    return {
      learnerId: me.id,
      signedIn: true,
      authSub: identity.sub,
      displayName: me.displayName ?? "Reader",
      sql,
    };
  } catch (error) {
    console.error("[auth] requireUser", error);
    return authFail("server_error", "Couldn't check who you are. Try again.", 500);
  }
}
