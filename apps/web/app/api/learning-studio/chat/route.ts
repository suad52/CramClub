import { clientKey, createRateLimiter, errorResponse, readJson } from "@/lib/ai/http";
import { studioErrorResponse } from "@/lib/learning-studio/routeErrors";
import type { Chunk } from "@/lib/learning-studio/schema";
import { answerQuestion } from "@/lib/learning-studio/server";

export const runtime = "nodejs";
const allow = createRateLimiter(20, 60_000);
const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/** POST { question, lessonTitle, scene, chunks } → { answer, pages } grounded in the given chunks. */
export async function POST(request: Request) {
  if (!allow(clientKey(request)))
    return errorResponse("rate_limited", "Lots of questions at once! Wait a minute.", 429);
  const body = await readJson(request);
  const question = str(body?.question, 500).trim();
  if (!question) return errorResponse("bad_request", "Ask a question.", 400);
  const scene = (body?.scene ?? {}) as Record<string, unknown>;
  const chunks: Chunk[] = (Array.isArray(body?.chunks) ? body.chunks : [])
    .slice(0, 8)
    .filter((c): c is Chunk => typeof c?.page === "number" && typeof c?.text === "string")
    .map((c) => ({ page: Math.floor(c.page), text: c.text.slice(0, 2000) }));
  try {
    return Response.json(
      await answerQuestion({
        question,
        lessonTitle: str(body?.lessonTitle, 100),
        scene: {
          title: str(scene.title, 100),
          narration: str(scene.narration, 1500),
          visual: str(scene.visual, 100),
        },
        chunks,
      }),
    );
  } catch (err) {
    return studioErrorResponse(err, "chat");
  }
}
