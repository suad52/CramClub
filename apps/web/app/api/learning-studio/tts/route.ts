import { clientKey, createRateLimiter, errorResponse, readJson } from "@/lib/ai/http";
import { studioErrorResponse } from "@/lib/learning-studio/routeErrors";
import { synthesize } from "@/lib/learning-studio/server";

export const runtime = "nodejs";
const allow = createRateLimiter(30, 60_000);

/** POST { text } → { audio: base64 mp3, alignment } from ElevenLabs; 503 when no key (client uses the browser voice). */
export async function POST(request: Request) {
  if (!process.env.ELEVENLABS_API_KEY)
    return errorResponse("not_configured", "Narration isn't set up.", 503);
  if (!allow(clientKey(request)))
    return errorResponse("rate_limited", "Too much narration at once.", 429);
  const body = await readJson(request);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text || text.length > 1500)
    return errorResponse("bad_request", "Send 1–1500 characters of narration.", 400);
  try {
    return Response.json(await synthesize(text));
  } catch (err) {
    // The voice account refused (out of credits, or the key is no longer valid): answer 503 so
    // the player stops asking for this page's visit and reads with the browser's voice instead.
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 402) {
      console.warn(`[learning-studio/tts] narration voice refused (${status})`);
      return errorResponse("not_configured", "The narration voice isn't available right now.", 503);
    }
    return studioErrorResponse(err, "tts");
  }
}
