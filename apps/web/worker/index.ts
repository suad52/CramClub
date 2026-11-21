/**
 * The Living Library's background worker: a separate process (on the Vultr server, next to the
 * web app) that claims lesson jobs from Postgres and runs them (lib/jobs/pipeline.ts), so a
 * student can close the page while TinyFish, Gemini and ElevenLabs work.
 *
 *   pnpm --filter @ovr/web worker        (reads apps/web/.env.local when present)
 *
 * Env: DATABASE_URL (required), the provider keys the pipeline uses, the VULTR_OBJECT_STORAGE_*
 * settings (local disk without them), WORKER_CONCURRENCY (1 or 2, default 1), WORKER_ID (default
 * host-pid). SIGTERM/SIGINT stop claiming, let running jobs reach their next step boundary, hand
 * them back to the queue, and exit. Logs never include env values or provider responses.
 */
import { hostname } from "node:os";
import { setTimeout as sleep } from "node:timers/promises";
import { processClaimedJob } from "@/lib/jobs/pipeline";
import { type ClaimedJob, claimLessonJob, workerBeat } from "@/lib/jobs/server";
import { liveDeps } from "@/lib/jobs/services";
import { WORKER_HEARTBEAT_SECONDS } from "@/lib/jobs/types";
import { db } from "@/lib/learning/server/db";
import { storageDriver } from "@/lib/storage";

const IDLE_POLL_MS = 2_000;
const SHUTDOWN_GRACE_MS = Number(process.env.WORKER_SHUTDOWN_GRACE_MS) || 100_000;

const workerId = (process.env.WORKER_ID || `${hostname().split(".")[0]}-${process.pid}`).slice(
  0,
  120,
);
const concurrency = Math.min(
  2,
  Math.max(1, Math.round(Number(process.env.WORKER_CONCURRENCY)) || 1),
);
const log = (line: string) => console.log(`[worker ${workerId}] ${line}`);

function fatal(message: string): never {
  console.error(`[worker] ${message}`);
  process.exit(1);
}

const sql = db() ?? fatal("DATABASE_URL is not set (apps/web/.env.local or the service's env).");
const driver = storageDriver();
if (driver === "invalid")
  fatal("Vultr Object Storage is partly configured: set all four VULTR_OBJECT_STORAGE_* values.");

const stop = new AbortController();
let beating = true;

async function heartbeat() {
  while (beating) {
    try {
      await workerBeat(sql, workerId);
    } catch (err) {
      log(`heartbeat failed: ${(err as Error).message}`);
    }
    await sleep(WORKER_HEARTBEAT_SECONDS * 1000, undefined, { signal: stop.signal }).catch(
      () => {},
    );
    if (stop.signal.aborted) break;
  }
}

async function slot(n: number) {
  while (!stop.signal.aborted) {
    let job: ClaimedJob | null | undefined;
    try {
      job = await claimLessonJob(sql, workerId);
    } catch (err) {
      log(`slot ${n}: claim failed: ${(err as Error).message}`);
    }
    if (!job) {
      await sleep(job === undefined ? IDLE_POLL_MS * 5 : IDLE_POLL_MS, undefined, {
        signal: stop.signal,
      }).catch(() => {});
      continue;
    }
    const started = Date.now();
    log(`slot ${n}: claimed job ${job.id} (attempt ${job.attempts}, ${job.status})`);
    try {
      const result = await processClaimedJob(sql, job, liveDeps(sql), {
        signal: stop.signal,
        log: (line) => log(`slot ${n}: ${line}`),
      });
      log(`slot ${n}: job ${job.id} ${result} in ${Math.round((Date.now() - started) / 1000)} s`);
    } catch (err) {
      // Couldn't even record the outcome (database down): the lease will expire and it's retried.
      log(`slot ${n}: job ${job.id} outcome not recorded: ${(err as Error).message}`);
    }
  }
}

let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) {
    log(`${signal} again: exiting now`);
    process.exit(1);
  }
  shuttingDown = true;
  log(`${signal}: finishing the current step, then stopping`);
  stop.abort();
  setTimeout(() => {
    log("shutdown took too long: exiting (running jobs will be retried when their lease ends)");
    process.exit(1);
  }, SHUTDOWN_GRACE_MS).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

log(`started: ${concurrency} slot(s), storage ${driver}, polling every ${IDLE_POLL_MS / 1000} s`);
const beat = heartbeat();
await Promise.all(Array.from({ length: concurrency }, (_, i) => slot(i + 1)));
beating = false;
await beat;
await sql.end({ timeout: 5 });
log("stopped");
process.exit(0);
