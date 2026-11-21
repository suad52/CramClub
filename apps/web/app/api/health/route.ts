import { clientKey, createRateLimiter } from "@/lib/ai/http";
import { workerStatus } from "@/lib/jobs/server";
import { db } from "@/lib/learning/server/db";
import { getStorage } from "@/lib/storage";

/**
 * GET /api/health → { ok, db, storage, worker: { lastSeenSecondsAgo } }, for the Vultr load
 * balancer / uptime check and the "Make a cloud lesson" form. It says only whether each part
 * answers (never hosts, buckets, keys or error text). 200 when the database and storage answer,
 * 503 otherwise; a missing worker doesn't fail the web server's health (lessons wait in the
 * queue), it just shows as lastSeenSecondsAgo: null or a large number.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const allow = createRateLimiter(60, 60_000);
const TIMEOUT_MS = 4_000;

/** Resolves to the check's answer, or false if it throws or takes too long. */
async function probe(check: () => Promise<boolean>): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      check(),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), TIMEOUT_MS);
      }),
    ]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const headers = { "cache-control": "no-store" };
  if (!allow(clientKey(request)))
    return Response.json(
      { error: { code: "rate_limited", message: "Too many requests." } },
      { status: 429, headers },
    );
  const sql = db();
  const [dbOk, storageOk] = await Promise.all([
    sql ? probe(async () => (await sql`SELECT 1 AS ok`).length === 1) : Promise.resolve(false),
    probe(() => getStorage().ping()),
  ]);
  let lastSeenSecondsAgo: number | null = null;
  if (sql && dbOk) {
    try {
      lastSeenSecondsAgo = (await workerStatus(sql)).lastSeenSecondsAgo;
    } catch {
      lastSeenSecondsAgo = null;
    }
  }
  const ok = dbOk && storageOk;
  return Response.json(
    { ok, db: dbOk, storage: storageOk, worker: { lastSeenSecondsAgo } },
    { status: ok ? 200 : 503, headers },
  );
}
