import { after } from "next/server";
import { z } from "zod";
import { clientKey, createRateLimiter, readJson } from "@/lib/ai/http";
import { db } from "@/lib/learning/server/db";
import { synthesize } from "@/lib/learning-studio/server";
import { learnerFor } from "@/lib/learning/server/identity";
import {
  type Defer,
  cancelTask,
  confirm,
  home,
  intake,
  planItemAction,
  pollTask,
  requestLesson,
  requestPlan,
  retryTask,
  saveResource,
} from "@/lib/librarian/server/tasks";

/**
 * The AI Librarian API (contract in lib/librarian/types.ts). The learner always comes from the
 * signed cookie; every row is looked up with their id. Long work (research, plans, lessons) runs
 * after the response via `after()`; the client polls the task.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ path: string[] }> };

const allowRead = createRateLimiter(240, 60_000);
const allowWrite = createRateLimiter(30, 60_000);
const uuid = z.uuid();

const Bodies = {
  intake: z.object({
    message: z.string().trim().min(1).max(1500),
    taskId: z.uuid().optional(),
    mode: z.enum(["quick", "deep"]).optional(),
  }),
  confirm: z.object({ mode: z.enum(["quick", "deep"]).optional() }),
  plan: z.object({
    examDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    minutesPerDay: z.number().int().min(10).max(600).optional(),
  }),
  lesson: z.object({ planItemId: z.uuid().optional() }),
  speak: z.object({ text: z.string().trim().min(1).max(400) }),
  resource: z.object({ saved: z.boolean() }),
  item: z.object({
    action: z.enum(["complete", "skip", "reopen", "reschedule"]),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),
};

/**
 * Her voice: ELEVENLABS_LIBRARIAN_VOICE_ID, else a warm, mature British voice from ElevenLabs'
 * premade set. If that voice isn't available to the account, the lesson narrator's voice is used.
 */
const LIBRARIAN_VOICE = process.env.ELEVENLABS_LIBRARIAN_VOICE_ID || "pFZP5JQG7iQjIQuC4Bku";

async function librarianSpeech(text: string) {
  try {
    return await synthesize(text, LIBRARIAN_VOICE);
  } catch (err) {
    const status = (err as { status?: number }).status;
    // Unknown voice, or one the plan can't use (402): fall back to the narrator's voice.
    if (status !== 400 && status !== 402 && status !== 404) throw err;
    return synthesize(text);
  }
}

const MAX_AUDIO_BYTES = 6 * 1024 * 1024;

/**
 * Push-to-talk: a short recording → ElevenLabs Speech to Text (scribe_v2) → the words. The audio is
 * forwarded and not kept.
 */
async function listen(request: Request, sql: NonNullable<ReturnType<typeof setup>>) {
  const me = (await learnerFor(sql, request, true))!;
  if (!allowWrite(me.id)) return fail("rate_limited", "Slow down a little.", 429);
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return fail("not_configured", "Talking to her needs ELEVENLABS_API_KEY.", 503);
  const form = await request.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof Blob) || audio.size < 1000 || audio.size > MAX_AUDIO_BYTES)
    return fail("bad_request", "Send a short recording.", 400);
  const out = new FormData();
  out.append("model_id", "scribe_v2");
  out.append("file", audio, "speech.webm");
  out.append("tag_audio_events", "false");
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body: out,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 || res.status === 403)
      return fail("not_configured", "Your ElevenLabs key needs Speech to Text access.", 503);
    if (!res.ok) {
      console.error("[librarian] speech-to-text", res.status, (await res.text()).slice(0, 200));
      return fail("stt_failed", "She couldn't make that out. Try again?", 502);
    }
    const json = (await res.json()) as { text?: string };
    return Response.json({ text: (json.text ?? "").trim().slice(0, 1500) });
  } catch (error) {
    return serverError("listen", error);
  }
}

function fail(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

const defer: Defer = (job) => after(job);

function setup() {
  const sql = db();
  if (!sql || !process.env.LEARNER_SECRET) return null;
  return sql;
}

const NOT_CONFIGURED = () =>
  fail(
    "not_configured",
    "The Librarian needs DATABASE_URL and LEARNER_SECRET (see docs/ai-librarian.md).",
    503,
  );

function serverError(where: string, error: unknown) {
  console.error(`[librarian] ${where}`, error);
  const ai = /GEMINI|API key|not configured/i.test(String((error as Error)?.message));
  return fail(
    ai ? "not_configured" : "server_error",
    ai ? "The Librarian needs GEMINI_API_KEY to think." : "The Librarian hit a snag. Try again.",
    ai ? 503 : 500,
  );
}

export async function GET(request: Request, { params }: Ctx) {
  const { path } = await params;
  const sql = setup();
  if (!sql) return NOT_CONFIGURED();
  if (!allowRead(clientKey(request))) return fail("rate_limited", "Too many requests.", 429);
  try {
    const me = (await learnerFor(sql, request, false))?.id ?? null;
    if (path[0] === "home" && path.length === 1) return Response.json(await home(sql, me));
    if (path[0] === "tasks" && path.length === 2 && uuid.safeParse(path[1]).success) {
      const task = me ? await pollTask(sql, me, path[1]!, defer) : null;
      return task ? Response.json(task) : fail("not_found", "No such request.", 404);
    }
    return fail("not_found", "Unknown endpoint.", 404);
  } catch (error) {
    return serverError(`GET ${path.join("/")}`, error);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const { path } = await params;
  const sql = setup();
  if (!sql) return NOT_CONFIGURED();
  if (path[0] === "listen" && path.length === 1) return listen(request, sql);
  const body = (await readJson(request)) ?? {};
  try {
    const me = (await learnerFor(sql, request, true))!;
    if (!allowWrite(me.id)) return fail("rate_limited", "Slow down a little.", 429);
    const respond = (status: number, payload: unknown) => {
      const res = Response.json(payload, { status });
      if (me.setCookie) res.headers.append("Set-Cookie", me.setCookie);
      return res;
    };
    const bad = () =>
      respond(400, { error: { code: "bad_request", message: "That request isn't valid." } });
    const [head, id, action] = path;
    const validId = !!id && uuid.safeParse(id).success;

    if (head === "speak" && path.length === 1) {
      const b = Bodies.speak.safeParse(body);
      if (!b.success) return bad();
      if (!process.env.ELEVENLABS_API_KEY)
        return respond(503, {
          error: { code: "not_configured", message: "Her voice needs ELEVENLABS_API_KEY." },
        });
      return respond(200, await librarianSpeech(b.data.text));
    }
    if (head === "tasks" && path.length === 1) {
      const b = Bodies.intake.safeParse(body);
      if (!b.success) return bad();
      const out = await intake(sql, me.id, b.data);
      return respond(out.status, out.body);
    }
    if (head === "tasks" && validId && path.length === 3) {
      if (action === "confirm") {
        const b = Bodies.confirm.safeParse(body);
        if (!b.success) return bad();
        const out = await confirm(sql, me.id, id, b.data.mode, defer);
        return respond(out.status, out.body);
      }
      if (action === "cancel") {
        const task = await cancelTask(sql, me.id, id);
        return task
          ? respond(200, task)
          : respond(404, { error: { code: "not_found", message: "No such request." } });
      }
      if (action === "retry") {
        const out = await retryTask(sql, me.id, id, defer);
        return respond(out.status, out.body);
      }
      if (action === "plan") {
        const b = Bodies.plan.safeParse(body);
        if (!b.success) return bad();
        const out = await requestPlan(sql, me.id, id, b.data, defer);
        return respond(out.status, out.body);
      }
      if (action === "lesson") {
        const b = Bodies.lesson.safeParse(body);
        if (!b.success) return bad();
        const out = await requestLesson(sql, me.id, id, b.data, defer);
        return respond(out.status, out.body);
      }
    }
    if (head === "resources" && validId && path.length === 2) {
      const b = Bodies.resource.safeParse(body);
      if (!b.success) return bad();
      return (await saveResource(sql, me.id, id, b.data.saved))
        ? respond(200, { ok: true })
        : respond(404, { error: { code: "not_found", message: "No such resource." } });
    }
    if (head === "plan-items" && validId && path.length === 2) {
      const b = Bodies.item.safeParse(body);
      if (!b.success) return bad();
      const out = await planItemAction(sql, me.id, id, b.data);
      return respond(out.status, out.body);
    }
    return respond(404, { error: { code: "not_found", message: "Unknown endpoint." } });
  } catch (error) {
    return serverError(`POST ${path.join("/")}`, error);
  }
}
