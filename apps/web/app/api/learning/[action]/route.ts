import { clientKey, createRateLimiter, readJson } from "@/lib/ai/http";
import { db } from "@/lib/learning/server/db";
import { learnerFor } from "@/lib/learning/server/identity";
import {
  type Action,
  Bodies,
  type Result,
  abandonSession,
  answerQuiz,
  completeLesson,
  completeSession,
  startLesson,
  startSession,
  updateProfile,
} from "@/lib/learning/server/pipeline";
import { community, dashboard, leaderboard, timeline } from "@/lib/learning/server/queries";
import type { TimelineKind } from "@/lib/learning/types";

/**
 * The learning analytics API (Tiger Data). GET reads the asking learner's record and the
 * aggregate views; POST records validated activity. The learner always comes from the signed
 * cookie, never from the request.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allowRead = createRateLimiter(120, 60_000);
const allowWrite = createRateLimiter(60, 60_000);
const KINDS: TimelineKind[] = ["all", "lessons", "quizzes", "sessions"];

type Ctx = { params: Promise<{ action: string }> };

function fail(code: string, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

function setup() {
  const sql = db();
  return sql && process.env.LEARNER_SECRET ? sql : null;
}

const NOT_CONFIGURED = () =>
  fail(
    "not_configured",
    "Progress tracking needs DATABASE_URL and LEARNER_SECRET (see docs/learning-analytics.md).",
    503,
  );

export async function GET(request: Request, { params }: Ctx) {
  const { action } = await params;
  const sql = setup();
  if (!sql) return NOT_CONFIGURED();
  if (!allowRead(clientKey(request))) return fail("rate_limited", "Too many requests.", 429);
  const url = new URL(request.url);
  try {
    const me = (await learnerFor(sql, request, false))?.id ?? null;
    switch (action) {
      case "dashboard":
        return Response.json(await dashboard(sql, me));
      case "timeline": {
        const kind = url.searchParams.get("kind") as TimelineKind | null;
        const before = url.searchParams.get("before");
        const beforeDate = before ? new Date(before) : null;
        return Response.json(
          await timeline(sql, me, {
            kind: kind && KINDS.includes(kind) ? kind : "all",
            subject: url.searchParams.get("subject")?.slice(0, 60) || null,
            before: beforeDate && !Number.isNaN(beforeDate.getTime()) ? beforeDate : null,
          }),
        );
      }
      case "leaderboard":
        return Response.json(
          await leaderboard(sql, me, url.searchParams.get("period") === "month" ? "month" : "week"),
        );
      case "community":
        return Response.json(await community(sql));
      default:
        return fail("not_found", "Unknown view.", 404);
    }
  } catch (error) {
    console.error("[learning] GET", action, error);
    return fail("server_error", "Couldn't reach the progress database. Try again.", 500);
  }
}

export async function POST(request: Request, { params }: Ctx) {
  const { action } = await params;
  if (!(action in Bodies)) return fail("not_found", "Unknown action.", 404);
  const sql = setup();
  if (!sql) return NOT_CONFIGURED();
  const parsed = Bodies[action as Action].safeParse(await readJson(request));
  if (!parsed.success) return fail("bad_request", "That request isn't valid.", 400);
  try {
    const me = (await learnerFor(sql, request, true))!;
    if (!allowWrite(me.id)) return fail("rate_limited", "Slow down a little.", 429);
    const body = parsed.data as never;
    const handlers: Record<Action, () => Promise<Result>> = {
      profile: () => updateProfile(sql, me.id, body),
      "session-start": () =>
        startSession(sql, me.id, (body as { plannedMinutes: number }).plannedMinutes),
      "session-complete": () =>
        completeSession(sql, me.id, (body as { sessionId: string }).sessionId),
      "session-abandon": () =>
        abandonSession(sql, me.id, (body as { sessionId: string }).sessionId),
      "lesson-start": () => startLesson(sql, me.id, body),
      "lesson-complete": () => completeLesson(sql, me.id, (body as { lessonId: string }).lessonId),
      quiz: () => answerQuiz(sql, me.id, body),
    };
    const result = await handlers[action as Action]();
    const response = Response.json(result.body, { status: result.status });
    if (me.setCookie) response.headers.append("Set-Cookie", me.setCookie);
    return response;
  } catch (error) {
    console.error("[learning] POST", action, error);
    return fail("server_error", "Couldn't save that to the progress database.", 500);
  }
}
