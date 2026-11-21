import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";
import { type VerifiedIdentity, verifiedIdentity } from "@/lib/auth/session";

/**
 * Who is asking. Two kinds of learner, both rows in `learners`:
 * - Anonymous: an id in a signed, httpOnly cookie. The browser can't read it, change it or claim
 *   someone else's (the signature uses LEARNER_SECRET).
 * - Signed in: the learner linked to a verified Auth0 account (learners.auth0_sub). On the first
 *   sign-in, the browser's anonymous learner is linked to the account, so progress carries over.
 *
 * A linked learner is reachable only through its account's verified session: once an anonymous
 * learner is linked, its cookie alone is treated like no cookie at all (after signing out, the
 * browser gets a fresh anonymous learner). Every request derives the learner here, never from
 * the request body. See docs/auth0.md.
 */
export const LEARNER_COOKIE = "ovr_learner";
const TWO_YEARS = 60 * 60 * 24 * 730;

export interface Learner {
  id: string;
  /** Set-Cookie for a new anonymous learner: send it back with the response. */
  setCookie?: string;
  signedIn: boolean;
  /** The Auth0 user id when signed in. */
  authSub: string | null;
  /** The name on their record, or null for a visitor with no row yet. */
  displayName: string | null;
  /**
   * Signed in with a verified email: its keyed hash (lib/auth/emailHash.ts), as stored on the
   * learner. Null otherwise. Never the address.
   */
  emailHash: string | null;
}

function sign(id: string) {
  const secret = process.env.LEARNER_SECRET;
  if (!secret) throw new Error("LEARNER_SECRET is not set");
  return createHmac("sha256", secret).update(id).digest("base64url");
}

/** The learner id in a cookie value, if its signature checks out. */
export function verifyLearnerCookie(value: string | undefined): string | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  const id = value.slice(0, dot);
  const mac = Buffer.from(value.slice(dot + 1));
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const want = Buffer.from(sign(id));
  return mac.length === want.length && timingSafeEqual(mac, want) ? id : null;
}

export function learnerCookieHeader(id: string) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${LEARNER_COOKIE}=${id}.${sign(id)}; Path=/; Max-Age=${TWO_YEARS}; HttpOnly; SameSite=Lax${secure}`;
}

function readCookie(request: Request, name: string) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

/** The anonymous learner id in the request's cookie, if any (null without LEARNER_SECRET). */
export function cookieLearnerId(request: Request): string | null {
  if (!process.env.LEARNER_SECRET) return null;
  return verifyLearnerCookie(readCookie(request, LEARNER_COOKIE));
}

/** The placeholder names OVR gives new learners ("Reader" or "Reader 1a2b"). */
const DEFAULT_NAME = "^Reader( [0-9a-f]{4})?$";
export const isDefaultName = (name: string) => new RegExp(DEFAULT_NAME).test(name);
const defaultName = (id: string) => `Reader ${id.slice(0, 4)}`;

const isUniqueViolation = (error: unknown) => (error as { code?: string })?.code === "23505";

type Row = { user_id: string; display_name: string; email_hash?: string | null };

/**
 * Keeps learners.email_hash in step with the verified session: the keyed hash of a verified
 * email, or null (unverified, or a session from before OVR asked for the email). Writes only when
 * it changed. Two accounts can't hold the same hash, so the latest verified sign-in takes it.
 * Best effort: a failure is logged (by code) and the request goes on, using this session's own
 * hash, which is what was asked to be stored.
 */
async function syncEmailHash(sql: postgres.Sql, row: Row, want: string | null) {
  if ((row.email_hash ?? null) === want) return want;
  try {
    if (want)
      await sql`UPDATE learners SET email_hash = NULL
        WHERE email_hash = ${want} AND user_id <> ${row.user_id}`;
    await sql`UPDATE learners SET email_hash = ${want}, updated_at = now()
      WHERE user_id = ${row.user_id}`;
  } catch (error) {
    console.error("[auth] couldn't store the email hash:", (error as { code?: string }).code);
  }
  return want;
}

/**
 * The learner for a verified account: the one already linked to it, else the browser's
 * anonymous learner (linked now, if it isn't linked to anyone), else a new one. A placeholder
 * name is replaced by the profile's name. Safe under parallel first requests: auth0_sub is
 * unique, so a race ends with everyone reading the same row.
 */
export async function accountLearner(
  sql: postgres.Sql,
  identity: VerifiedIdentity,
  cookieId: string | null,
): Promise<Learner> {
  const { sub, name } = identity;
  const done = async (row: Row): Promise<Learner> => ({
    id: row.user_id,
    signedIn: true,
    authSub: sub,
    displayName: row.display_name,
    emailHash: await syncEmailHash(sql, row, identity.emailHash ?? null),
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    const [own] = await sql<Row[]>`SELECT user_id, display_name, email_hash FROM learners
      WHERE auth0_sub = ${sub}`;
    if (own) {
      if (name && isDefaultName(own.display_name)) {
        await sql`UPDATE learners SET display_name = ${name}, updated_at = now()
          WHERE user_id = ${own.user_id}`;
        own.display_name = name;
      }
      return done(own);
    }
    if (cookieId) {
      try {
        const [linked] = await sql<Row[]>`UPDATE learners SET auth0_sub = ${sub},
            display_name = CASE WHEN display_name ~ ${DEFAULT_NAME}
              THEN coalesce(${name}::text, display_name) ELSE display_name END,
            updated_at = now()
          WHERE user_id = ${cookieId} AND auth0_sub IS NULL AND NOT is_demo
          RETURNING user_id, display_name, email_hash`;
        if (linked) return done(linked);
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        continue; // a parallel request linked another learner to this account: read it
      }
    }
    const id = randomUUID();
    const [made] = await sql<Row[]>`INSERT INTO learners (user_id, display_name, auth0_sub)
      VALUES (${id}, ${name ?? defaultName(id)}, ${sub})
      ON CONFLICT (auth0_sub) DO NOTHING RETURNING user_id, display_name, email_hash`;
    if (made) return done(made);
  }
  throw new Error("Couldn't find or create the learner for this account");
}

/**
 * The request's anonymous learner. With `create`, a new visitor gets a learner row and a cookie
 * to set (`setCookie`); without it, a new visitor is `null` (reads just show an empty record).
 * A cookie whose learner belongs to an account counts as no cookie.
 */
export async function anonymousLearner(
  sql: postgres.Sql,
  request: Request,
  create: boolean,
): Promise<Learner | null> {
  const id = cookieLearnerId(request);
  if (id) {
    const [row] = await sql<{ linked: boolean; display_name: string }[]>`SELECT
      auth0_sub IS NOT NULL AS linked, display_name FROM learners WHERE user_id = ${id}`;
    if (!row?.linked) {
      // A valid cookie whose row is gone (e.g. a reset database) gets its row back.
      if (!row && create)
        await sql`INSERT INTO learners (user_id, display_name)
          VALUES (${id}, ${defaultName(id)}) ON CONFLICT DO NOTHING`;
      const displayName = row?.display_name ?? (create ? defaultName(id) : null);
      return { id, signedIn: false, authSub: null, displayName, emailHash: null };
    }
  }
  if (!create) return null;
  const fresh = randomUUID();
  await sql`INSERT INTO learners (user_id, display_name) VALUES (${fresh}, ${defaultName(fresh)})`;
  return {
    id: fresh,
    setCookie: learnerCookieHeader(fresh),
    signedIn: false,
    authSub: null,
    displayName: defaultName(fresh),
    emailHash: null,
  };
}

/**
 * The request's learner: the signed-in account's when there's a verified Auth0 session, else the
 * anonymous one (see anonymousLearner for `create`). Every existing endpoint uses this, so they
 * all become per-account as soon as someone signs in.
 */
export async function learnerFor(
  sql: postgres.Sql,
  request: Request,
  create: boolean,
): Promise<Learner | null> {
  const identity = await verifiedIdentity(request);
  if (identity) return accountLearner(sql, identity, cookieLearnerId(request));
  return anonymousLearner(sql, request, create);
}
