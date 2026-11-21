import {
  AiNotConfiguredError,
  HANDWRITING_ENABLED,
  HandwritingUnavailableError,
  type Placement,
  handwriteAnswer,
} from "@/lib/ai/gemini";
import { clientKey, createRateLimiter, errorResponse, pngPayload, readJson } from "@/lib/ai/http";
import { SUPPORTED_RATIOS } from "@/lib/whiteboard/ink";

export const runtime = "nodejs";

// Image generation costs money per call, so this is stricter than the solve route.
const allow = createRateLimiter(10, 60_000);
/**
 * After Google says the key can't use the image model (free tier / no billing), skip the call for
 * a while instead of failing every time. Cleared by restarting the server (e.g. after adding billing).
 */
const NO_BILLING_PAUSE_MS = 10 * 60_000;
let noBillingUntil = 0;
const NO_BILLING_MESSAGE = "Handwritten answers aren't turned on for this server.";
const PLACEMENTS: readonly Placement[] = ["below", "right", "above", "left"];

/**
 * POST { image, lines, placement, inkColor, aspectRatio } → { image: "data:…;base64,…" }
 * The image is the question plus a blank area; the model writes the answer into the blank area.
 */
export async function POST(request: Request) {
  if (!HANDWRITING_ENABLED) {
    return errorResponse(
      "handwriting_unavailable",
      "Handwritten answers are turned off on this server.",
      409,
    );
  }
  if (Date.now() < noBillingUntil) {
    return errorResponse("handwriting_unavailable", NO_BILLING_MESSAGE, 402);
  }
  if (!allow(clientKey(request))) {
    return errorResponse(
      "rate_limited",
      "Too many handwriting requests. Wait a minute and try again.",
      429,
    );
  }
  const body = await readJson(request);
  const image = pngPayload(body?.image);
  const lines = body?.lines;
  const placement = body?.placement as Placement;
  const inkColor = body?.inkColor;
  const aspectRatio = body?.aspectRatio;
  const valid =
    image &&
    Array.isArray(lines) &&
    lines.length > 0 &&
    lines.length <= 10 &&
    lines.every((l) => typeof l === "string" && l.length > 0 && l.length <= 60) &&
    PLACEMENTS.includes(placement) &&
    typeof inkColor === "string" &&
    /^#[0-9a-f]{6}$/i.test(inkColor) &&
    typeof aspectRatio === "string" &&
    (SUPPORTED_RATIOS as readonly string[]).includes(aspectRatio);
  if (!valid) return errorResponse("bad_request", "Missing or invalid handwriting request.", 400);

  try {
    const result = await handwriteAnswer({
      pngBase64: image,
      lines: lines as string[],
      placement,
      inkHex: inkColor,
      aspectRatio,
    });
    return Response.json({ image: `data:${result.mimeType};base64,${result.data}` });
  } catch (err) {
    if (err instanceof AiNotConfiguredError) {
      return errorResponse(
        "not_configured",
        "The AI isn't set up yet. Add GEMINI_API_KEY to apps/web/.env.local.",
        503,
      );
    }
    const status = err instanceof HandwritingUnavailableError ? err.status : undefined;
    console.error(
      "[ai/whiteboard/handwrite]",
      status ?? "",
      err instanceof Error ? err.message : err,
    );
    // The board falls back to a handwriting font, so this is not a hard failure for the user.
    const noBilling =
      status === 403 ||
      /billing|paid|free.?tier|quota/i.test(err instanceof Error ? err.message : "");
    if (noBilling) noBillingUntil = Date.now() + NO_BILLING_PAUSE_MS;
    return errorResponse(
      "handwriting_unavailable",
      noBilling
        ? NO_BILLING_MESSAGE
        : status === 504
          ? "The handwriting took too long this time."
          : "The handwriting didn't work this time.",
      502,
    );
  }
}
