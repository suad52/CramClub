import "server-only";

/** Small helpers shared by the AI routes: JSON errors, image validation and rate limiting. */

export type ErrorCode =
  "bad_request" | "not_configured" | "rate_limited" | "ai_error" | "handwriting_unavailable";

export function errorResponse(code: ErrorCode, message: string, status: number) {
  return Response.json({ error: { code, message } }, { status });
}

const PNG_PREFIX = "data:image/png;base64,";
/** ~3 MB of image data; a 1024 px board crop is far smaller. */
const MAX_BASE64_LENGTH = 4_000_000;

/** Returns the base64 payload of a PNG data URL, or null when it's missing, wrong or too big. */
export function pngPayload(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(PNG_PREFIX)) return null;
  const data = value.slice(PNG_PREFIX.length);
  if (data.length === 0 || data.length > MAX_BASE64_LENGTH || !/^[A-Za-z0-9+/]+=*$/.test(data))
    return null;
  return data;
}

/**
 * Per-client sliding-window limiter kept in memory. Fine for one server process; move it to a
 * shared store (e.g. Redis) when the web app runs on several instances.
 */
export function createRateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()): boolean => {
    const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}

export function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
