import {
  type FenwickChatResponse,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  verifyInternal,
} from "@ovr/shared";
import { AiNotConfiguredError, getGemini } from "@/lib/ai/gemini";
import { createRateLimiter } from "@/lib/ai/http";
import { parseFenwickChatRequest } from "@/lib/fenwick-chat/reply";
import { type ChatModel, createReplayGuard, fenwickReply } from "@/lib/fenwick-chat/server";

/**
 * POST /api/internal/fenwick-chat → { reply: string | null }: Ms. Fenwick's words when the game
 * server has decided she should answer a player nobody else answered in the library chat
 * (contract: packages/shared/src/net/internal.ts and protocol.ts). Server-to-server only: the
 * game server signs the raw body with GAME_TICKET_SECRET; browsers never hold it, so no client
 * can make her say anything. The game server alone posts her line to the room.
 *
 * The body (at most MAX_BODY_BYTES) is read raw and its signature checked BEFORE it's parsed; a
 * signature is accepted once. Replies come from Gemini (lib/fenwick-chat/server.ts), or a canned
 * in-character line if Gemini fails or is slow; null when the message needs no answer.
 *
 * 401 bad, missing, stale or replayed signature (no details); 413 body too big; 400 bad body;
 * 429 over REPLIES_PER_MINUTE (all game servers together); 503 not_configured without
 * GAME_TICKET_SECRET or GEMINI_API_KEY. The game server treats any error as "stay quiet".
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A real request is a few KB at most (12 lines of ≤ 200 characters). */
const MAX_BODY_BYTES = 16 * 1024;
const HEADERS = { "cache-control": "no-store" };
const fail = (code: string, status: number) =>
  Response.json({ error: { code } }, { status, headers: HEADERS });

const firstUse = createReplayGuard();
/**
 * Her chat replies a minute, in total: the game server caps itself too (30 a minute per
 * process), this guards the Gemini quota her desk and the lessons share against everything else.
 */
const REPLIES_PER_MINUTE = 60;
const allowReply = createRateLimiter(REPLIES_PER_MINUTE, 60_000);

/** The body as text, or null when it's over `max` bytes (stops reading as soon as it is). */
async function readCapped(request: Request, max: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

export async function POST(request: Request) {
  const secret = process.env.GAME_TICKET_SECRET?.trim();
  if (!secret) return fail("not_configured", 503);
  try {
    const raw = await readCapped(request, MAX_BODY_BYTES);
    if (raw === null) return fail("too_large", 413);
    const signature = request.headers.get(INTERNAL_SIGNATURE_HEADER);
    const check = await verifyInternal(
      secret,
      signature,
      request.headers.get(INTERNAL_TIMESTAMP_HEADER),
      raw,
    );
    if (!check.ok || !signature || !firstUse(signature)) return fail("unauthorized", 401);
    if (!allowReply("all")) return fail("rate_limited", 429);

    let ai: ChatModel;
    try {
      ai = getGemini();
    } catch (err) {
      if (err instanceof AiNotConfiguredError) return fail("not_configured", 503);
      throw err;
    }

    const req = parseFenwickChatRequest(raw);
    if (!req) return fail("bad_request", 400);
    const { reply } = await fenwickReply(req, { ai });
    const body: FenwickChatResponse = { reply };
    return Response.json(body, { headers: HEADERS });
  } catch (err) {
    console.error("[fenwick-chat]", (err as Error).name ?? "error");
    return fail("server_error", 500);
  }
}
