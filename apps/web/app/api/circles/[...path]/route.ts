import { z } from "zod";
import { createRateLimiter } from "@/lib/ai/http";
import { type SignedInUser, requireUser } from "@/lib/auth/currentUser";
import { crossOriginRefused, crossOriginWrite } from "@/lib/auth/sameOrigin";
import {
  type Outcome,
  addItem,
  changeRole,
  createCircle,
  createInvite,
  deleteCircle,
  getCircle,
  isCircleToken,
  isMemberKey,
  joinCircle,
  leaveCircle,
  listCircles,
  markSeen,
  previewInvite,
  removeItem,
  removeMember,
  revokeInvite,
  shareable,
} from "@/lib/circles/server";
import {
  CIRCLE_LIMITS as LIMITS,
  CIRCLE_ROLES,
  INVITE_ROLES,
  SHARE_SOURCES,
} from "@/lib/circles/types";

/**
 * The Study Circles API (contract in lib/circles/types.ts). Every endpoint needs a verified Auth0
 * session (requireUser: 503 auth_not_configured until the keys are set, 401 sign_in_required when
 * signed out), and lib/circles/server.ts checks membership and role before every read or change.
 * Ids in the path only say which circle or item: never who is asking.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const allowRead = createRateLimiter(240, 60_000);
const allowWrite = createRateLimiter(40, 60_000);
/** Joining and previewing take a token: slow anyone trying lots of them. */
const allowToken = createRateLimiter(20, 10 * 60_000);

const uuid = z.uuid();
const isId = (v: string | undefined): v is string => !!v && uuid.safeParse(v).success;
const isHash = (v: string | undefined): v is string => !!v && /^[0-9a-f]{64}$/.test(v);

const Bodies = {
  create: z.object({
    name: z.string().trim().min(1).max(LIMITS.nameLength),
    description: z.string().trim().max(LIMITS.descriptionLength).optional(),
  }),
  token: z.object({ token: z.string().refine(isCircleToken) }),
  seen: z.object({ seenAt: z.iso.datetime() }),
  invite: z.object({
    role: z.enum(INVITE_ROLES),
    days: z.number().int().min(LIMITS.inviteDays.min).max(LIMITS.inviteDays.max).optional(),
    maxUses: z.number().int().min(LIMITS.inviteUses.min).max(LIMITS.inviteUses.max).optional(),
  }),
  role: z.object({ role: z.enum(CIRCLE_ROLES) }),
  item: z.union([
    z.object({ from: z.object({ source: z.enum(SHARE_SOURCES), id: z.uuid() }) }),
    z.object({
      kind: z.literal("resource"),
      title: z.string().trim().min(1).max(LIMITS.titleLength),
      url: z.string().trim().min(1).max(2048),
      summary: z.string().trim().max(LIMITS.summaryLength).optional(),
    }),
    z.object({
      kind: z.literal("note"),
      title: z.string().trim().min(1).max(LIMITS.titleLength),
      text: z.string().trim().min(1).max(LIMITS.noteLength),
    }),
  ]),
};

const BAD = {
  create: `Give the circle a name (up to ${LIMITS.nameLength} characters) and, if you like, a description (up to ${LIMITS.descriptionLength}).`,
  token: "That invite link isn't complete. Copy the whole link and try again.",
  seen: "That request isn't valid.",
  invite: `Choose editor or viewer, ${LIMITS.inviteDays.min} to ${LIMITS.inviteDays.max} days, and ${LIMITS.inviteUses.min} to ${LIMITS.inviteUses.max} uses.`,
  role: "Choose owner, editor or viewer.",
  item: `Give it a title (up to ${LIMITS.titleLength} characters) and a link, or a note of up to ${LIMITS.noteLength.toLocaleString("en")} characters.`,
};

const HEADERS = { "cache-control": "private, no-store" };

/** The usual `{ error: { code, message } }` body (lib/auth/types.ts lists the auth codes). */
const fail = (code: string, message: string, status: number) =>
  Response.json({ error: { code, message } }, { status, headers: HEADERS });
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: HEADERS });
const reply = (out: Outcome<unknown>) =>
  out.ok ? json(out.body, out.status) : fail(out.code, out.message, out.status);
const bad = (message: string) => fail("bad_request", message, 400);
const unknown = () => fail("not_found", "Unknown endpoint.", 404);

/** Bodies are small JSON objects (an invite, a note): anything bigger is refused unread. */
const MAX_BODY = 64 * 1024;

/**
 * A write's JSON body ({} when there's none, e.g. leave). A body must say it's JSON, so a plain
 * form on another site can't post one even where cookies would still be sent.
 */
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

async function handle(method: "GET" | "POST" | "PATCH" | "DELETE", request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  if (method !== "GET" && crossOriginWrite(request)) return crossOriginRefused();
  const me = await requireUser(request);
  if (me instanceof Response) return me;
  const tokenRoute = method === "POST" && (path.join("/") === "join" || path[0] === "invites");
  const allowed = tokenRoute
    ? allowToken(me.learnerId)
    : method === "GET"
      ? allowRead(me.learnerId)
      : allowWrite(me.learnerId);
  if (!allowed) return fail("rate_limited", "That's a lot at once. Try again in a minute.", 429);
  const body = method === "POST" || method === "PATCH" ? await readBody(request) : {};
  if (body instanceof Response) return body;
  try {
    return await route(method, path, me, body);
  } catch (error) {
    console.error(
      `[circles] ${method} ${path[0] ?? ""}`,
      (error as { code?: string }).code ?? error,
    );
    return fail("server_error", "The circle couldn't be reached just now. Try again.", 500);
  }
}

async function route(
  method: string,
  path: string[],
  me: SignedInUser,
  body: Record<string, unknown>,
): Promise<Response> {
  const { sql, learnerId } = me;
  const [head, sub, target] = path;
  const n = path.length;

  // Collection-level endpoints.
  if (head === "mine" && n === 1 && method === "GET")
    return json({ circles: await listCircles(sql, learnerId) });
  if (head === "shareable" && n === 1 && method === "GET")
    return json({ items: await shareable(sql, learnerId) });
  if (head === "create" && n === 1 && method === "POST") {
    const b = Bodies.create.safeParse(body);
    if (!b.success) return bad(BAD.create);
    return reply(
      await createCircle(sql, learnerId, {
        name: b.data.name,
        description: b.data.description ?? "",
      }),
    );
  }
  if (head === "invites" && sub === "preview" && n === 2 && method === "POST") {
    const b = Bodies.token.safeParse(body);
    if (!b.success) return bad(BAD.token);
    return reply(await previewInvite(sql, learnerId, b.data.token));
  }
  if (head === "join" && n === 1 && method === "POST") {
    const b = Bodies.token.safeParse(body);
    if (!b.success) return bad(BAD.token);
    return reply(await joinCircle(sql, learnerId, b.data.token));
  }

  // One circle.
  if (!isId(head)) return unknown();
  const id = head;
  if (n === 1) {
    if (method === "GET") return reply(await getCircle(sql, learnerId, id));
    if (method === "DELETE") return reply(await deleteCircle(sql, learnerId, id));
    return unknown();
  }
  if (sub === "seen" && n === 2 && method === "POST") {
    const b = Bodies.seen.safeParse(body);
    if (!b.success) return bad(BAD.seen);
    return reply(await markSeen(sql, learnerId, id, new Date(b.data.seenAt)));
  }
  if (sub === "leave" && n === 2 && method === "POST")
    return reply(await leaveCircle(sql, learnerId, id));
  if (sub === "invites") {
    if (n === 2 && method === "POST") {
      const b = Bodies.invite.safeParse(body);
      if (!b.success) return bad(BAD.invite);
      return reply(await createInvite(sql, learnerId, id, b.data));
    }
    if (n === 3 && method === "DELETE" && isHash(target))
      return reply(await revokeInvite(sql, learnerId, id, target));
  }
  if (sub === "members" && n === 3 && isMemberKey(target)) {
    if (method === "PATCH") {
      const b = Bodies.role.safeParse(body);
      if (!b.success) return bad(BAD.role);
      return reply(await changeRole(sql, learnerId, id, target, b.data.role));
    }
    if (method === "DELETE") return reply(await removeMember(sql, learnerId, id, target));
  }
  if (sub === "items") {
    if (n === 2 && method === "POST") {
      const b = Bodies.item.safeParse(body);
      if (!b.success) return bad(BAD.item);
      return reply(await addItem(sql, learnerId, id, b.data));
    }
    if (n === 3 && method === "DELETE" && isId(target))
      return reply(await removeItem(sql, learnerId, id, target));
  }
  return unknown();
}

export const GET = (request: Request, ctx: Ctx) => handle("GET", request, ctx);
export const POST = (request: Request, ctx: Ctx) => handle("POST", request, ctx);
export const PATCH = (request: Request, ctx: Ctx) => handle("PATCH", request, ctx);
export const DELETE = (request: Request, ctx: Ctx) => handle("DELETE", request, ctx);
