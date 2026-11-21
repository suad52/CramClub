import { z } from "zod";
import { clientKey, createRateLimiter } from "@/lib/ai/http";
import { authConfigured } from "@/lib/auth/auth0";
import { type CurrentUser, currentUser } from "@/lib/auth/currentUser";
import { MAX_EMAIL_LENGTH, normalizeEmail } from "@/lib/auth/emailHash";
import { crossOriginRefused, crossOriginWrite } from "@/lib/auth/sameOrigin";
import { db } from "@/lib/learning/server/db";
import {
  MESSAGES,
  type Outcome,
  type Viewer,
  claimTable,
  createTableInvite,
  inviteByEmail,
  isTableId,
  isTableToken,
  joinTable,
  releaseTable,
  releaseAbandoned,
  heartbeatTable,
  removeEmailInvite,
  sitAt,
  tablesView,
  updateTable,
} from "@/lib/tables/server";

/**
 * The table-holds API (contract in lib/tables/types.ts). Who's asking comes only from the
 * verified Auth0 session, or for public tables the signed anonymous learner cookie
 * (lib/auth/currentUser.ts); lib/tables/server.ts decides who may sit and who may change a hold.
 * The table id in the path only says which table: never who is asking.
 *
 *   GET   /api/tables                    → TablesView
 *   POST  /api/tables/:tableId/sit       → SitResult (200, or 403 table_private / 401
 *         sign_in_required with the SitResult and the usual `error` both in the body)
 *   POST  /api/tables/:tableId/claim     { visibility, circleId? } → TableStatus (201)
 *   PATCH /api/tables/:tableId           { visibility?, circleId? | null } → TableStatus
 *   POST  /api/tables/:tableId/invite    → { link, path, expiresAt } (201)
 *   POST  /api/tables/join               { token } → { tableId, status }
 *   POST  /api/tables/:tableId/release   → { ok: true }
 *   POST  /api/tables/:tableId/email-invites { email } → { invite: { id, masked } } (201, always
 *         the same whether or not anyone has that address)
 *   DELETE /api/tables/:tableId/email-invites/:id → { ok: true }
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

const allowRead = createRateLimiter(240, 60_000);
const allowWrite = createRateLimiter(60, 60_000);
/** Joining takes a token: slow anyone trying lots of them. */
const allowToken = createRateLimiter(20, 10 * 60_000);
/** A public claim can make a new anonymous learner: cap those per address before the database. */
const allowClaimFrom = createRateLimiter(30, 10 * 60_000);
/** Email invites: a holder adds a few, not hundreds (and can't sweep addresses through it). */
const allowEmailInvite = createRateLimiter(30, 10 * 60_000);

const VISIBILITY = z.enum(["public", "private"]);
const Bodies = {
  heartbeat: z.object({ seated: z.boolean() }),
  claim: z.object({ visibility: VISIBILITY, circleId: z.uuid().nullable().optional() }),
  update: z
    .object({ visibility: VISIBILITY.optional(), circleId: z.uuid().nullable().optional() })
    .refine((b) => b.visibility !== undefined || b.circleId !== undefined),
  token: z.object({ token: z.string().refine(isTableToken) }),
  email: z.object({
    email: z
      .string()
      .max(MAX_EMAIL_LENGTH + 64)
      .transform(normalizeEmail)
      .pipe(z.email().max(MAX_EMAIL_LENGTH)),
  }),
};

const BAD = {
  claim: "Choose public or private (and, if you like, one of your Study Circles).",
  update: "Send visibility (public or private), a Study Circle, or null to clear the circle.",
  token: "That table link isn't complete. Copy the whole link and try again.",
  email: "Type the email address they signed up with, like name@example.com.",
};

const HEADERS = { "cache-control": "private, no-store" };

/** The usual `{ error: { code, message } }` body. */
const fail = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status, headers: HEADERS });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });
const reply = (out: Outcome<unknown>) =>
  out.ok ? json(out.body, out.status) : fail(out.code, out.message, out.status);
const bad = (message: string) => fail("bad_request", message, 400);
const limited = () => fail("rate_limited", "That's a lot at once. Try again in a minute.", 429);

/** Bodies are tiny ({ visibility }, { token }): anything bigger is refused unread. */
const MAX_BODY = 8 * 1024;

/** A write's JSON body ({} when there's none). A body must say it's JSON. */
async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY)
    return fail("too_large", "That's too much to send in one go.", 413);
  const text = await request.text().catch(() => "");
  if (!text.trim()) return {};
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? ""))
    return fail("bad_content_type", "Send JSON (content-type: application/json).", 415);
  if (Buffer.byteLength(text, "utf8") > MAX_BODY)
    return fail("too_large", "That's too much to send in one go.", 413);
  try {
    const body: unknown = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return fail("bad_request", "That request isn't valid JSON.", 400);
  }
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";
type Endpoint =
  | { kind: "view" }
  | { kind: "join" }
  | {
      kind: "sit" | "claim" | "invite" | "release" | "heartbeat" | "update" | "emailInvite";
      tableId: string;
    }
  | { kind: "emailUninvite"; tableId: string; inviteId: string };

const TABLE_ACTIONS = new Set(["sit", "claim", "invite", "release", "heartbeat"]);

/** Which endpoint a path is, or a 404 Response. */
function endpoint(method: Method, path: string[]): Endpoint | Response {
  const [head, sub] = path;
  const unknown = fail("not_found", "Unknown endpoint.", 404);
  if (path.length === 0) return method === "GET" ? { kind: "view" } : unknown;
  if (head === "join" && path.length === 1) return method === "POST" ? { kind: "join" } : unknown;
  if (!isTableId(head)) return fail("not_found", "There's no table with that name.", 404);
  if (path.length === 1) return method === "PATCH" ? { kind: "update", tableId: head } : unknown;
  if (path.length === 2 && method === "POST" && sub && TABLE_ACTIONS.has(sub))
    return { kind: sub as "sit" | "claim" | "invite" | "release" | "heartbeat", tableId: head };
  if (sub === "email-invites") {
    if (path.length === 2 && method === "POST") return { kind: "emailInvite", tableId: head };
    const inviteId = path[2];
    if (path.length === 3 && method === "DELETE" && z.uuid().safeParse(inviteId).success)
      return { kind: "emailUninvite", tableId: head, inviteId: inviteId! };
  }
  return unknown;
}

/** This site, for full invite links: APP_BASE_URL, else the request's own origin. */
function siteOrigin(request: Request) {
  const base = process.env.APP_BASE_URL?.trim();
  if (base)
    try {
      return new URL(base).origin;
    } catch {
      // a malformed APP_BASE_URL also stops Auth0 from starting: fall back to the request
    }
  return new URL(request.url).origin;
}

async function handle(method: Method, request: Request, ctx: Ctx) {
  const path = (await ctx.params).path ?? [];
  if (method !== "GET" && crossOriginWrite(request)) return crossOriginRefused();
  const where = endpoint(method, path);
  if (where instanceof Response) return where;
  const sql = db();
  if (!sql)
    return fail(
      "not_configured",
      "Holding tables needs DATABASE_URL (see docs/learning-analytics.md).",
      503,
    );
  const body = method === "GET" ? {} : await readBody(request);
  if (body instanceof Response) return body;

  try {
    // Only a public claim may make an anonymous learner.
    let mayCreate = false;
    if (where.kind === "claim") {
      const b = Bodies.claim.safeParse(body);
      if (!b.success) return bad(BAD.claim);
      mayCreate = b.data.visibility === "public" && !b.data.circleId;
    }
    let me = await currentUser(request);
    const key = me.learnerId ?? `ip:${clientKey(request)}`;
    const allowed =
      where.kind === "join"
        ? allowToken(key)
        : where.kind === "emailInvite"
          ? allowEmailInvite(key)
          : method === "GET"
            ? allowRead(key)
            : allowWrite(key);
    if (!allowed) return limited();
    // A signed-out first claim makes the visitor a learner. Only those new learners count
    // against the per-address cap (signed-in and returning students share school networks), and
    // nothing is written until the request has passed every limit. A returning visitor whose row
    // went missing (displayName null) gets it back.
    if (mayCreate && !me.signedIn && (!me.learnerId || me.displayName === null)) {
      if (!me.learnerId && !allowClaimFrom(clientKey(request))) return limited();
      me = await currentUser(request, { create: true });
    }
    const response = await route(where, me, body, request);
    if (me.setCookie) response.headers.append("Set-Cookie", me.setCookie);
    return response;
  } catch (error) {
    console.error(
      `[tables] ${method} ${path.join("/")}`,
      (error as { code?: string }).code ?? error,
    );
    return fail("server_error", "The tables couldn't be reached just now. Try again.", 500);
  }
}

/** Gives up tables whose holders have left (see releaseAbandoned), at most every 15 s. */
let lastSweep = 0;
async function sweepAbandoned(sql: NonNullable<ReturnType<typeof db>>) {
  if (Date.now() - lastSweep < 15_000) return;
  lastSweep = Date.now();
  await releaseAbandoned(sql);
}

async function route(
  where: Endpoint,
  me: CurrentUser,
  body: Record<string, unknown>,
  request: Request,
): Promise<Response> {
  const sql = db()!;
  await sweepAbandoned(sql);
  const viewer: Viewer = {
    learnerId: me.learnerId,
    signedIn: me.signedIn,
    emailHash: me.signedIn ? (me.emailHash ?? null) : null,
  };
  const privateAvailable = authConfigured();

  switch (where.kind) {
    case "view":
      return json(await tablesView(sql, viewer, privateAvailable));
    case "join": {
      if (!privateAvailable) return fail("auth_not_configured", MESSAGES.privateUnavailable, 503);
      if (!me.signedIn || !me.learnerId)
        return fail("sign_in_required", MESSAGES.joinNeedsSignIn, 401);
      const b = Bodies.token.safeParse(body);
      if (!b.success) return bad(BAD.token);
      return reply(await joinTable(sql, me.learnerId, b.data.token));
    }
    case "sit": {
      const answer = await sitAt(sql, viewer, where.tableId);
      const out = answer.body;
      if (out.ok) return json(out, answer.status);
      const code = out.reason === "private" ? "table_private" : "sign_in_required";
      return json({ ...out, error: { code, message: out.message } }, answer.status);
    }
    case "claim": {
      const b = Bodies.claim.parse(body); // checked in handle
      return reply(await claimTable(sql, viewer, where.tableId, b, privateAvailable));
    }
    case "update": {
      const b = Bodies.update.safeParse(body);
      if (!b.success) return bad(BAD.update);
      return reply(await updateTable(sql, viewer, where.tableId, b.data, privateAvailable));
    }
    case "invite":
      return reply(
        await createTableInvite(sql, viewer, where.tableId, siteOrigin(request), privateAvailable),
      );
    case "release":
      return reply(await releaseTable(sql, viewer, where.tableId));
    case "heartbeat": {
      const b = Bodies.heartbeat.safeParse(body);
      if (!b.success) return bad("Send { seated: true or false }.");
      return reply(await heartbeatTable(sql, viewer, where.tableId, b.data.seated));
    }
    case "emailInvite": {
      const b = Bodies.email.safeParse(body);
      if (!b.success) return bad(BAD.email);
      return reply(await inviteByEmail(sql, viewer, where.tableId, b.data.email, privateAvailable));
    }
    case "emailUninvite":
      return reply(await removeEmailInvite(sql, viewer, where.tableId, where.inviteId));
  }
}

export const GET = (request: Request, ctx: Ctx) => handle("GET", request, ctx);
export const POST = (request: Request, ctx: Ctx) => handle("POST", request, ctx);
export const PATCH = (request: Request, ctx: Ctx) => handle("PATCH", request, ctx);
export const DELETE = (request: Request, ctx: Ctx) => handle("DELETE", request, ctx);
