import { clientKey, createRateLimiter, errorResponse, readJson } from "@/lib/ai/http";
import { studioErrorResponse } from "@/lib/learning-studio/routeErrors";
import { LENGTHS, LEVELS, type LessonLength, type Level } from "@/lib/learning-studio/schema";
import { generateLesson } from "@/lib/learning-studio/server";

export const runtime = "nodejs";
export const maxDuration = 300;
const allow = createRateLimiter(4, 60_000);

/** POST { pages: string[], title?, level, length } → { lesson } (validated). */
export async function POST(request: Request) {
  if (!allow(clientKey(request)))
    return errorResponse(
      "rate_limited",
      "You're making lessons quickly! Wait a minute and try again.",
      429,
    );
  const body = await readJson(request);
  const pages = body?.pages;
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.length > 120 ||
    !pages.every((p) => typeof p === "string")
  ) {
    return errorResponse("bad_request", "Send the extracted pages of your notes.", 400);
  }
  const text = (pages as string[]).join("").length;
  if (text > 2_000_000)
    return errorResponse(
      "bad_request",
      "Those notes are too long for one lesson. Try a shorter PDF.",
      400,
    );
  const level = LEVELS.includes(body?.level as Level) ? (body!.level as Level) : "high-school";
  const length = LENGTHS.includes(body?.length as LessonLength)
    ? (body!.length as LessonLength)
    : "short";
  const title = typeof body?.title === "string" ? body.title.slice(0, 100) : "";
  try {
    return Response.json({
      lesson: await generateLesson({ title, level, length, pages: pages as string[] }),
    });
  } catch (err) {
    return studioErrorResponse(err, "lessons");
  }
}
