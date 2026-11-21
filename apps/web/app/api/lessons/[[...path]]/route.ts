import { z } from "zod";
import { clientKey, createRateLimiter, readJson } from "@/lib/ai/http";
import { authFail, currentUser, requireUser } from "@/lib/auth/currentUser";
import { crossOriginRefused, crossOriginWrite } from "@/lib/auth/sameOrigin";
import {
  NewLessonJobSchema,
  enqueueLessonJob,
  getLessonJob,
  listLessonJobs,
  loadLesson,
  retryLessonJob,
  sceneAudio,
} from "@/lib/jobs/server";
import { db } from "@/lib/learning/server/db";
import { parseRange, sceneParam } from "@/lib/lessons/http";
import { getStorage } from "@/lib/storage";

/**
 * The Living Library's cloud lessons (contract in lib/jobs/types.ts). The work itself happens in
 * the worker (a separate process on the Vultr server); these handlers only enqueue, report and
 * hand out the stored files.
 *
 * Identity is the verified Auth0 session (or, for reads, the signed learner cookie the Librarian
 * uses): never an id from the request. Making or retrying a lesson needs a signed-in student;
 * reading one needs its owner or a member of a Study Circle it was shared to, and anything else
 * is a 404 so ids can't be probed. Every POST must come from this site (lib/auth/sameOrigin.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path?: string[] }> };

const allowRead = createRateLimiter(240, 60_000);
/** Audio players ask for byte ranges as they buffer and seek, so reads of audio are roomier. */
const allowAudio = createRateLimiter(600, 60_000);
/** Each lesson costs research, Gemini and ElevenLabs time: a handful per learner per 10 minutes. */
const allowCreate = createRateLimiter(6, 10 * 60_000);
const allowRetry = createRateLimiter(20, 10 * 60_000);
const uuid = z.uuid();

const NO_STORE = { "cache-control": "private, no-store" };
/** How long a signed narration URL stays valid. */
const SIGNED_URL_SECONDS = 300;

function fail(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status, headers: NO_STORE });
}

const notFound = () => fail("not_found", "No such lesson.", 404);

function serverError(where: string, error: unknown) {
  console.error(`[lessons] ${where}`, error);
  return fail("server_error", "The library's cloud hit a snag. Try again.", 500);
}

/** Who's reading: the Auth0 session's learner, else the signed cookie's. Null for nobody. */
async function reader(request: Request) {
  const me = await currentUser(request);
  return me.learnerId;
}

export async function GET(request: Request, { params }: Ctx) {
  const path = (await params).path ?? [];
  const sql = db();
  if (!sql)
    return fail(
      "not_configured",
      "Cloud lessons need DATABASE_URL (see docs/learning-analytics.md).",
      503,
    );
  const audio = path.length === 3 && path[1] === "audio";
  if (!(audio ? allowAudio : allowRead)(clientKey(request)))
    return fail("rate_limited", "Too many requests.", 429);
  try {
    const me = await reader(request);

    // GET /api/lessons: mine, newest first (nothing for a visitor with no learner yet).
    if (path.length === 0) {
      const jobs = me ? await listLessonJobs(sql, me) : [];
      return Response.json({ jobs }, { headers: NO_STORE });
    }

    const [id] = path;
    if (!id || !uuid.safeParse(id).success) return notFound();
    if (!me) return notFound();

    // GET /api/lessons/:id → the job, plus the stored lesson once it's ready.
    if (path.length === 1) {
      const job = await getLessonJob(sql, me, id);
      if (!job) return notFound();
      const lesson = job.view.status === "completed" ? await loadLesson(getStorage(), id) : null;
      return Response.json(lesson ? { ...job.view, lesson } : job.view, { headers: NO_STORE });
    }

    // GET /api/lessons/:id/audio/:scene (scene: 0-based, as in lesson.scenes)
    if (audio) {
      const scene = sceneParam(path[2]);
      const clip = scene === null ? null : await sceneAudio(sql, me, id, scene);
      if (!clip) return fail("not_found", "That scene has no stored narration.", 404);
      return await sendAudio(request, clip.key);
    }
    return fail("not_found", "Unknown endpoint.", 404);
  } catch (error) {
    return serverError(`GET ${path.join("/")}`, error);
  }
}

/**
 * The narration, after the access check: a redirect to a short-lived signed URL on Vultr Object
 * Storage (the bucket is private), or, with the local driver, the bytes themselves with Range
 * support so the player can seek.
 */
async function sendAudio(request: Request, key: string) {
  const storage = getStorage();
  const signed = await storage.signedGetUrl(key, SIGNED_URL_SECONDS);
  if (signed)
    return new Response(null, { status: 302, headers: { location: signed, ...NO_STORE } });
  const bytes = await storage.get(key);
  if (!bytes) return fail("not_found", "That narration is missing from storage.", 404);
  const size = bytes.byteLength;
  const headers = {
    "content-type": "audio/mpeg",
    "accept-ranges": "bytes",
    "cache-control": "private, max-age=300",
  };
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable")
    return new Response(null, {
      status: 416,
      headers: { ...headers, "content-range": `bytes */${size}` },
    });
  if (!range)
    return new Response(bytes as BodyInit, {
      headers: { ...headers, "content-length": String(size) },
    });
  const part = bytes.subarray(range.start, range.end + 1);
  return new Response(part as BodyInit, {
    status: 206,
    headers: {
      ...headers,
      "content-length": String(part.byteLength),
      "content-range": `bytes ${range.start}-${range.end}/${size}`,
    },
  });
}

export async function POST(request: Request, { params }: Ctx) {
  const path = (await params).path ?? [];
  if (crossOriginWrite(request)) return crossOriginRefused();
  const me = await requireUser(request);
  if (me instanceof Response) return me;
  const { sql, learnerId } = me;
  try {
    // POST /api/lessons { topic, level?, length?, taskId? } → 202 (the job checks a taskId is
    // this student's own Librarian request before building from its sources).
    if (path.length === 0) {
      const body = NewLessonJobSchema.safeParse((await readJson(request)) ?? {});
      if (!body.success)
        return fail("bad_request", "Give the lesson a topic of 3 to 200 characters.", 400);
      if (!allowCreate(learnerId))
        return authFail(
          "rate_limited",
          "That's a lot of lessons at once. Try again in a few minutes.",
          429,
        );
      const out = await enqueueLessonJob(sql, learnerId, body.data);
      return out.ok
        ? Response.json(out.body, { status: 202, headers: NO_STORE })
        : fail(out.code, out.message, out.status);
    }

    // POST /api/lessons/:id/retry (owner, failed only)
    const [id, action] = path;
    if (path.length === 2 && action === "retry" && id && uuid.safeParse(id).success) {
      if (!allowRetry(learnerId)) return authFail("rate_limited", "Slow down a little.", 429);
      const out = await retryLessonJob(sql, learnerId, id);
      return out.ok
        ? Response.json(out.body, { status: out.status, headers: NO_STORE })
        : fail(out.code, out.message, out.status);
    }
    return fail("not_found", "Unknown endpoint.", 404);
  } catch (error) {
    return serverError(`POST ${path.join("/")}`, error);
  }
}
