import { AiNotConfiguredError, solveWhiteboard } from "@/lib/ai/gemini";
import { clientKey, createRateLimiter, errorResponse, pngPayload, readJson } from "@/lib/ai/http";

export const runtime = "nodejs";

const allow = createRateLimiter(20, 60_000);

/** POST { image: "data:image/png;base64,…" } → { readable, question, answer, lines } */
export async function POST(request: Request) {
  if (!allow(clientKey(request))) {
    return errorResponse(
      "rate_limited",
      "That's a lot of questions at once. Wait a minute and try again.",
      429,
    );
  }
  const body = await readJson(request);
  const image = pngPayload(body?.image);
  if (!image)
    return errorResponse("bad_request", "Send a PNG image of the selected part of the board.", 400);
  try {
    return Response.json(await solveWhiteboard(image));
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return errorResponse(
        "not_configured",
        "The AI isn't set up yet. Add GEMINI_API_KEY to apps/web/.env.local and restart the dev server.",
        503,
      );
    }
    const status = (err as { status?: number }).status;
    if (status === 503 || status === 504) {
      return errorResponse(
        "ai_error",
        "The AI is overloaded right now and took too long. Try again in a moment.",
        504,
      );
    }
    if (status === 429) {
      return errorResponse(
        "rate_limited",
        "The AI is busy (rate limit reached). Try again shortly.",
        429,
      );
    }
    // Never log the image itself.
    console.error("[ai/whiteboard/solve]", err instanceof Error ? err.message : err);
    return errorResponse(
      "ai_error",
      "The AI couldn't answer right now. Try again in a moment.",
      502,
    );
  }
}
