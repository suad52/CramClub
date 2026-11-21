import { clientKey, createRateLimiter, errorResponse, readJson } from "@/lib/ai/http";
import { studioErrorResponse } from "@/lib/learning-studio/routeErrors";
import { synthesize } from "@/lib/learning-studio/server";

export const runtime = "nodejs";
const allow = createRateLimiter(30, 60_000);

/** POST { text } → { audio: base64 mp3, alignment } from ElevenLabs; 503 when no key (client uses the browser voice). */
export async function POST(request: Request) {
  if (!process.env.ELEVENLABS_API_KEY)
    return errorResponse("not_configured", "AI narration isn't set up.", 503);
  if (!allow(clientKey(request)))
    return errorResponse("rate_limited", "Too much narration at once.", 429);
  const body = await readJson(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 1500)
    return errorResponse("bad_request", "Send 1–1500 characters of narration.", 400);
  try {
    return Response.json(await synthesize(text));
  } catch (err) {
    return studioErrorResponse(err, "tts");
  }
}
