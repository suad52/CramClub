import "server-only";
import { AiNotConfiguredError } from "@/lib/ai/gemini";
import { errorResponse } from "@/lib/ai/http";
import { StudioError, TtsNotConfiguredError } from "./server";

/** Maps provider/validation errors to friendly JSON responses. Never logs note contents. */
export function studioErrorResponse(err: unknown, where: string) {
  if (err instanceof StudioError) return errorResponse("bad_request", err.message, err.status);
  if (err instanceof AiNotConfiguredError) {
    return errorResponse(
      "not_configured",
      "The AI isn't set up yet. Add GEMINI_API_KEY to apps/web/.env.local and restart the dev server.",
      503,
    );
  }
  if (err instanceof TtsNotConfiguredError)
    return errorResponse(
      "not_configured",
      "AI narration isn't set up (no ELEVENLABS_API_KEY).",
      503,
    );
  const status = (err as { status?: number }).status;
  if (status === 429)
    return errorResponse("rate_limited", "The AI is busy right now. Try again in a minute.", 429);
  if (status === 503)
    return errorResponse("ai_error", "The AI is overloaded right now. Try again in a minute.", 503);
  if (status === 504)
    return errorResponse("ai_error", "The AI took too long. Try again in a moment.", 504);
  console.error(`[learning-studio/${where}]`, err instanceof Error ? err.message : "error");
  return errorResponse("ai_error", "Something went wrong on our side. Try again in a moment.", 502);
}
