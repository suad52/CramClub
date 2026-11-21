import { z } from "zod";
import { createRateLimiter } from "@/lib/ai/http";
import { type SignedInUser, requireUser } from "@/lib/auth/currentUser";
import { crossOriginRefused, crossOriginWrite } from "@/lib/auth/sameOrigin";
import {
  LibraryError,
  addItem,
  createCollection,
  deleteCollection,
  getCollection,
  getItem,
  libraryView,
  listCollections,
  removeItem,
  renameCollection,
  saveLesson,
  savePlan,
  unsaveSource,
  updateItem,
} from "@/lib/library/server";
import { LIBRARY_LIMITS } from "@/lib/library/types";
import {
  CollectionNameBody,
  ItemPatchBody,
  LessonBody,
  NewItemBody,
  PlanBody,
  firstIssue,
} from "@/lib/library/validate";

/**
 * The personal library API (contract in lib/library/types.ts). Every request starts with
 * requireUser: 503 auth_not_configured while Auth0 isn't set up, 401 sign_in_required when
 * nobody is signed in. The owner is always the verified session's learner, and anything that
 * isn't theirs answers 404, the same as something that doesn't exist. Changes must come from
 * this site (lib/auth/sameOrigin.ts) and, when they carry a body, be JSON.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const allowRead = createRateLimiter(240, 60_000);
const allowWrite = createRateLimiter(60, 60_000);
const isId = (v: string | undefined): v is string => !!v && z.uuid().safeParse(v).success;

const HEADERS = { "cache-control": "private, no-store" };

function send(payload: unknown, status = 200) {
  return Response.json(payload, { status, headers: HEADERS });
}

function fail(code: string, message: string, status: number) {
  return send({ error: { code, message } }, status);
}

const notFound = (what = "thing in your library") => fail("not_found", `No such ${what}.`, 404);

/**
 * The JSON body of a write. Writes must say they're JSON (so another site's plain form can't
 * post here) and stay under the size cap.
 */
async function body(request: Request): Promise<{ data: unknown } | Response> {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\b/i.test(type))
    return fail("bad_content_type", "Send JSON (content-type: application/json).", 415);
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > LIBRARY_LIMITS.bodyBytes)
    return fail("too_large", "That's too much to save in one go.", 413);
  const text = await request.text().catch(() => null);
  if (text === null) return fail("bad_request", "That request isn't valid.", 400);
  if (Buffer.byteLength(text, "utf8") > LIBRARY_LIMITS.bodyBytes)
    return fail("too_large", "That's too much to save in one go.", 413);
  try {
    return { data: JSON.parse(text) as unknown };
  } catch {
    return fail("bad_request", "That request isn't valid JSON.", 400);
  }
}

/** Parses a write's body with `schema`, or the Response to send instead. */
async function parse<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: z.infer<T> } | Response> {
  const read = await body(request);
  if (read instanceof Response) return read;
  const result = schema.safeParse(read.data);
  if (!result.success) return fail("bad_request", firstIssue(result.error), 400);
  return { ok: result.data };
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

async function handle(method: Method, request: Request, ctx: Ctx) {
  const { path } = await ctx.params;
  if (method !== "GET" && crossOriginWrite(request)) return crossOriginRefused();
  const me = await requireUser(request);
  if (me instanceof Response) return me;
  const allowed = method === "GET" ? allowRead : allowWrite;
  if (!allowed(me.learnerId)) return fail("rate_limited", "Slow down a little.", 429);
  try {
    return await route(method, request, path, me);
  } catch (error) {
    if (error instanceof LibraryError) return fail(error.code, error.message, error.status);
    console.error(`[library] ${method} /api/me/${path.join("/")}`, error);
    return fail("server_error", "Your library hit a snag. Try again.", 500);
  }
}

async function route(method: Method, request: Request, path: string[], me: SignedInUser) {
  const { sql, learnerId } = me;
  const [head, id, sub, itemId] = path;

  if (head === "library" && path.length === 1 && method === "GET")
    return send(await libraryView(sql, learnerId, me.displayName));

  if (head === "collections" && path.length === 1) {
    if (method === "GET") return send({ collections: await listCollections(sql, learnerId) });
    if (method === "POST") {
      const b = await parse(request, CollectionNameBody);
      if (b instanceof Response) return b;
      return send(await createCollection(sql, learnerId, b.ok.name), 201);
    }
  }

  if (head === "collections" && path.length === 2) {
    if (!isId(id)) return notFound("collection");
    if (method === "GET") {
      const view = await getCollection(sql, learnerId, id);
      return view ? send(view) : notFound("collection");
    }
    if (method === "PATCH") {
      const b = await parse(request, CollectionNameBody);
      if (b instanceof Response) return b;
      const renamed = await renameCollection(sql, learnerId, id, b.ok.name);
      return renamed ? send(renamed) : notFound("collection");
    }
    if (method === "DELETE")
      return (await deleteCollection(sql, learnerId, id))
        ? send({ ok: true })
        : notFound("collection");
  }

  if (head === "collections" && sub === "items" && path.length === 3 && method === "POST") {
    if (!isId(id)) return notFound("collection");
    const b = await parse(request, NewItemBody);
    if (b instanceof Response) return b;
    const saved = await addItem(sql, learnerId, id, b.ok);
    if (!saved) return notFound("collection");
    return send(saved, saved.added ? 201 : 200);
  }

  if (head === "collections" && sub === "items" && path.length === 4) {
    if (!isId(id) || !isId(itemId)) return notFound();
    if (method === "GET") {
      const detail = await getItem(sql, learnerId, id, itemId);
      return detail ? send(detail) : notFound();
    }
    if (method === "PATCH") {
      const b = await parse(request, ItemPatchBody);
      if (b instanceof Response) return b;
      const item = await updateItem(sql, learnerId, id, itemId, b.ok);
      return item ? send({ item }) : notFound();
    }
    if (method === "DELETE")
      return (await removeItem(sql, learnerId, id, itemId)) ? send({ ok: true }) : notFound();
  }

  if (head === "lessons" && path.length === 1 && method === "POST") {
    const b = await parse(request, LessonBody);
    if (b instanceof Response) return b;
    const saved = await saveLesson(sql, learnerId, b.ok);
    return send(saved, saved.added ? 201 : 200);
  }

  if (head === "plans" && path.length === 1 && method === "POST") {
    const b = await parse(request, PlanBody);
    if (b instanceof Response) return b;
    const saved = await savePlan(sql, learnerId, b.ok.planId);
    if (!saved) return notFound("study plan");
    return send(saved, saved.added ? 201 : 200);
  }

  if (head === "saved" && path.length === 2 && method === "DELETE") {
    if (!isId(id)) return notFound("saved source");
    return (await unsaveSource(sql, learnerId, id)) ? send({ ok: true }) : notFound("saved source");
  }

  return fail("not_found", "Unknown endpoint.", 404);
}

export const GET = (request: Request, ctx: Ctx) => handle("GET", request, ctx);
export const POST = (request: Request, ctx: Ctx) => handle("POST", request, ctx);
export const PATCH = (request: Request, ctx: Ctx) => handle("PATCH", request, ctx);
export const DELETE = (request: Request, ctx: Ctx) => handle("DELETE", request, ctx);
