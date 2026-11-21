import "server-only";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type postgres from "postgres";

/**
 * Who is asking. OVR has no accounts yet, so a learner is an anonymous id in a signed, httpOnly
 * cookie: the browser can't read it, change it or claim someone else's (the signature uses
 * LEARNER_SECRET). Every request derives the user id from it, never from the request body.
 * When accounts arrive, map the account to its learner id here.
 */
export const LEARNER_COOKIE = "ovr_learner";
const TWO_YEARS = 60 * 60 * 24 * 730;

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

/**
 * The request's learner. With `create`, a new visitor gets a learner row and a cookie to set
 * (`setCookie`); without it, a new visitor is `null` (reads just show an empty record).
 */
export async function learnerFor(
  sql: postgres.Sql,
  request: Request,
  create: boolean,
): Promise<{ id: string; setCookie?: string } | null> {
  const id = verifyLearnerCookie(readCookie(request, LEARNER_COOKIE));
  if (id) {
    // A valid cookie whose row is gone (e.g. a reset database) gets its row back.
    if (create)
      await sql`INSERT INTO learners (user_id, display_name)
      VALUES (${id}, ${`Reader ${id.slice(0, 4)}`}) ON CONFLICT DO NOTHING`;
    return { id };
  }
  if (!create) return null;
  const fresh = randomUUID();
  await sql`INSERT INTO learners (user_id, display_name) VALUES (${fresh}, ${`Reader ${fresh.slice(0, 4)}`})`;
  return { id: fresh, setCookie: learnerCookieHeader(fresh) };
}
