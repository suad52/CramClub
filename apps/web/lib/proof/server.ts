import "server-only";
import type postgres from "postgres";
import { authConfigured } from "@/lib/auth/auth0";
import { verifiedIdentity } from "@/lib/auth/session";
import { LESSON_JOB_STATUSES, WORKER_HEARTBEAT_SECONDS } from "@/lib/jobs/types";
import { LIBRARY_TIME_ZONE as TZ, MIN_GROUP } from "@/lib/learning/rules";
import { db } from "@/lib/learning/server/db";
import { lastDays, libraryDay } from "@/lib/learning/server/queries";
import { getStorage, sceneAudioKey, storageDriver } from "@/lib/storage";
import { ttlCache } from "./cache";
import { formatInterval } from "./format";
import { type CheckRows, buildIntegrity } from "./integrity";
import type {
  AggregateFacts,
  Auth0Facts,
  CompletedJobFacts,
  Guarantee,
  IntegrityReport,
  JobFacts,
  ProofReport,
  ServiceFacts,
  SignedUrlDemo,
  TigerFacts,
  VerifiedWeek,
  VultrFacts,
} from "./types";
import { describeSignedUrl, unsignedUrl } from "./urls";

/**
 * Builds the /proof report (contract: lib/proof/types.ts) from live facts that are safe to show
 * anyone: the database's own catalog and job stats (timescaledb_information), counts, timings,
 * and two tiny requests to the storage bucket. Nothing here writes, except that signing a URL is
 * a local computation. Each part fails on its own (logged by code, shown as unavailable).
 *
 * The integrity check (integrityCheck) recomputes the last 7 library days from raw rows and lines
 * them up against the continuous aggregates and the XP ledger: see lib/proof/integrity.ts.
 */

type Sql = postgres.Sql;
const TTL_MS = 10_000;
const FETCH_TIMEOUT_MS = 4_000;
/** The demo signed URL's lifetime: long enough to read, too short to be worth copying. */
const SIGNED_URL_TTL_S = 60;

const int = (v: unknown) => Number(v ?? 0);
const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);

async function part<T>(name: string, run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(
      `[proof] ${name}:`,
      (error as { code?: string }).code ?? (error as Error).message,
    );
    return fallback;
  }
}

/* ---- Tiger Data ---- */

interface JobRow {
  job_id: number;
  proc_name: string;
  hypertable_name: string | null;
  schedule: string | null;
  config: Record<string, string> | null;
  last_run_started_at: Date | null;
  last_run_status: string | null;
  duration_ms: number | null;
  next_start: Date | null;
  total_runs: number | null;
  total_failures: number | null;
}

function jobFacts(r: JobRow | undefined): JobFacts | null {
  if (!r) return null;
  const c = r.config ?? {};
  const detail =
    r.proc_name === "policy_compression"
      ? c.compress_after
        ? `moves chunks older than ${formatInterval(c.compress_after)} to the columnstore`
        : null
      : c.start_offset
        ? `refreshes the last ${formatInterval(c.start_offset)}, up to ${formatInterval(c.end_offset)} ago`
        : null;
  return {
    schedule: `every ${formatInterval(r.schedule) ?? "?"}`,
    lastRunAt: iso(r.last_run_started_at),
    lastStatus: r.last_run_status,
    lastDurationMs: r.duration_ms === null ? null : Math.round(Number(r.duration_ms) * 10) / 10,
    nextRunAt: iso(r.next_start),
    runs: int(r.total_runs),
    failures: int(r.total_failures),
    detail,
  };
}

/** Rules the database enforces itself, by the name it knows them under. */
const GUARANTEES: Omit<Guarantee, "present">[] = [
  {
    table: "xp_ledger",
    rule: "Each reward is paid once: one row per learner, reason and activity",
    kind: "unique",
  },
  {
    table: "study_sessions",
    rule: "One running pomodoro per learner, so focus time can never overlap",
    kind: "unique index",
  },
  {
    table: "learning_events",
    rule: "Seen at the desk ≤ camera on ≤ credited focus time, on finished pomodoros only",
    kind: "check",
  },
  {
    table: "table_holds",
    rule: "No two holds on the same table at overlapping times",
    kind: "exclusion",
  },
  { table: "table_holds", rule: "Nobody holds two tables at once", kind: "exclusion" },
  {
    table: "learners",
    rule: "An email is kept only as a 64-character HMAC, never the address",
    kind: "check",
  },
  {
    table: "table_hold_email_invites",
    rule: "Email invites keep the same HMAC, never the address",
    kind: "check",
  },
  { table: "learners", rule: "One learner per Auth0 account", kind: "unique" },
];
const GUARANTEE_NAMES = [
  "xp_ledger_user_id_reason_activity_key_key",
  "study_sessions_one_active",
  "learning_events_presence_check",
  "table_holds_one_per_table",
  "table_holds_one_per_holder",
  "learners_email_hash_check",
  "table_hold_email_invites_email_hash_check",
  "learners_auth0_sub_key",
];

async function guarantees(sql: Sql): Promise<Guarantee[]> {
  const rows = await sql<{ name: string }[]>`
    SELECT conname::text AS name FROM pg_constraint WHERE conname = ANY(${GUARANTEE_NAMES})
    UNION
    SELECT indexname::text FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = ANY(${GUARANTEE_NAMES})`;
  const have = new Set(rows.map((r) => r.name));
  return GUARANTEES.map((g, i) => ({ ...g, present: have.has(GUARANTEE_NAMES[i]!) }));
}

async function verifiedWeeks(sql: Sql): Promise<VerifiedWeek[]> {
  // Zero-filled: every one of the last 6 Monday weeks, whether anyone studied or not.
  const rows = await sql`
    WITH weeks AS (
      SELECT generate_series(date_trunc('week', now() AT TIME ZONE ${TZ}) - interval '5 weeks',
        date_trunc('week', now() AT TIME ZONE ${TZ}), interval '1 week') AS local_week)
    SELECT to_char(w.local_week, 'YYYY-MM-DD') AS week, count(DISTINCT f.user_id)::int AS learners,
      coalesce(sum(f.sessions), 0)::int AS sessions,
      coalesce(sum(f.sessions_with_camera), 0)::int AS with_camera,
      coalesce(sum(f.focus_seconds), 0)::bigint AS focus,
      coalesce(sum(f.seen_seconds), 0)::bigint AS seen
    FROM weeks w
    LEFT JOIN (focus_presence_weekly f JOIN learners l ON l.user_id = f.user_id AND l.leaderboard_opt_in)
      ON f.week = w.local_week AT TIME ZONE ${TZ}
    GROUP BY 1 ORDER BY 1`;
  return rows.map((r) => {
    const n = int(r.learners);
    const show = n === 0 || n >= MIN_GROUP;
    return {
      week: r.week as string,
      learners: show ? n : 0,
      sessions: show ? int(r.sessions) : null,
      sessionsWithCamera: show ? int(r.with_camera) : null,
      focusMinutes: show ? Math.round(int(r.focus) / 60) : null,
      verifiedMinutes: show ? Math.round(int(r.seen) / 60) : null,
    };
  });
}

/** The window's start (library midnight, 6 days before today's), shared by every check. */
const windowStart = (sql: Sql) =>
  sql`SELECT (date_trunc('day', now() AT TIME ZONE ${TZ}) - interval '6 days') AT TIME ZONE ${TZ} AS start`;

type DiffRow = Record<string, unknown> & { day: string; groups: number; drifted: number };

function toDays(rows: readonly DiffRow[], keys: readonly string[]): CheckRows["days"] {
  return rows.map((r) => ({
    day: r.day,
    groups: int(r.groups),
    drifted: int(r.drifted),
    raw: Object.fromEntries(keys.map((k) => [k, int(r[`raw_${k}`])])),
    aggregate: Object.fromEntries(keys.map((k) => [k, int(r[`agg_${k}`])])),
  }));
}

/**
 * Recomputes the last 7 library days from raw rows and compares, group by group (totals are keyed
 * xp, focus and seen in seconds, events and sessions as counts):
 * learning_events → learning_daily (XP, focus seconds, events per learner, day and subject),
 * learning_events → focus_presence_daily (pomodoros, focus and seen seconds per learner and day),
 * and xp_ledger → the XP on learning_events (per learner and day).
 */
export async function integrityCheck(
  sql: Sql,
  nextRefreshAt: string | null = null,
): Promise<IntegrityReport> {
  const t0 = performance.now();
  const [w] = await windowStart(sql);
  const start = w!.start as Date;
  const [daily, presence, ledger, [people]] = await Promise.all([
    sql<DiffRow[]>`
      WITH raw AS (
        SELECT time_bucket(INTERVAL '1 day', e.occurred_at, ${TZ}) AS day, e.user_id,
          coalesce(e.subject_id, '') AS subject, sum(e.xp_delta)::bigint AS xp,
          coalesce(sum(e.duration_seconds) FILTER (WHERE e.event_type = 'study_session_completed'), 0)::bigint AS focus,
          count(*)::bigint AS events
        FROM learning_events e WHERE e.occurred_at >= ${start}
        GROUP BY 1, 2, 3),
      agg AS (
        SELECT d.day, d.user_id, coalesce(d.subject_id, '') AS subject, d.xp::bigint AS xp,
          d.focus_seconds::bigint AS focus, d.events::bigint AS events
        FROM learning_daily d WHERE d.day >= ${start})
      SELECT to_char(coalesce(raw.day, agg.day) AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
        count(*)::int AS groups,
        count(*) FILTER (WHERE raw.xp IS DISTINCT FROM agg.xp
          OR raw.focus IS DISTINCT FROM agg.focus OR raw.events IS DISTINCT FROM agg.events)::int AS drifted,
        coalesce(sum(raw.xp), 0)::bigint AS raw_xp, coalesce(sum(agg.xp), 0)::bigint AS agg_xp,
        coalesce(sum(raw.focus), 0)::bigint AS raw_focus,
        coalesce(sum(agg.focus), 0)::bigint AS agg_focus,
        coalesce(sum(raw.events), 0)::bigint AS raw_events,
        coalesce(sum(agg.events), 0)::bigint AS agg_events
      FROM raw FULL JOIN agg ON raw.day = agg.day AND raw.user_id = agg.user_id
        AND raw.subject = agg.subject
      GROUP BY 1 ORDER BY 1`,
    sql<DiffRow[]>`
      WITH raw AS (
        SELECT time_bucket(INTERVAL '1 day', e.occurred_at, ${TZ}) AS day, e.user_id,
          count(*)::bigint AS sessions, coalesce(sum(e.duration_seconds), 0)::bigint AS focus,
          coalesce(sum(e.seen_seconds), 0)::bigint AS seen
        FROM learning_events e
        WHERE e.event_type = 'study_session_completed' AND e.occurred_at >= ${start}
        GROUP BY 1, 2),
      agg AS (
        SELECT f.day, f.user_id, f.sessions::bigint AS sessions, f.focus_seconds::bigint AS focus,
          f.seen_seconds::bigint AS seen
        FROM focus_presence_daily f WHERE f.day >= ${start})
      SELECT to_char(coalesce(raw.day, agg.day) AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
        count(*)::int AS groups,
        count(*) FILTER (WHERE raw.sessions IS DISTINCT FROM agg.sessions
          OR raw.focus IS DISTINCT FROM agg.focus OR raw.seen IS DISTINCT FROM agg.seen)::int AS drifted,
        coalesce(sum(raw.sessions), 0)::bigint AS raw_sessions,
        coalesce(sum(agg.sessions), 0)::bigint AS agg_sessions,
        coalesce(sum(raw.focus), 0)::bigint AS raw_focus,
        coalesce(sum(agg.focus), 0)::bigint AS agg_focus,
        coalesce(sum(raw.seen), 0)::bigint AS raw_seen,
        coalesce(sum(agg.seen), 0)::bigint AS agg_seen
      FROM raw FULL JOIN agg ON raw.day = agg.day AND raw.user_id = agg.user_id
      GROUP BY 1 ORDER BY 1`,
    sql<DiffRow[]>`
      WITH raw AS (
        SELECT time_bucket(INTERVAL '1 day', x.created_at, ${TZ}) AS day, x.user_id,
          sum(x.xp_delta)::bigint AS xp
        FROM xp_ledger x WHERE x.created_at >= ${start} GROUP BY 1, 2),
      agg AS (
        SELECT time_bucket(INTERVAL '1 day', e.occurred_at, ${TZ}) AS day, e.user_id,
          sum(e.xp_delta)::bigint AS xp
        FROM learning_events e WHERE e.occurred_at >= ${start} GROUP BY 1, 2)
      SELECT to_char(coalesce(raw.day, agg.day) AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
        count(*)::int AS groups,
        count(*) FILTER (WHERE coalesce(raw.xp, 0) <> coalesce(agg.xp, 0))::int AS drifted,
        coalesce(sum(raw.xp), 0)::bigint AS raw_xp, coalesce(sum(agg.xp), 0)::bigint AS agg_xp
      FROM raw FULL JOIN agg ON raw.day = agg.day AND raw.user_id = agg.user_id
      GROUP BY 1 ORDER BY 1`,
    sql`SELECT count(DISTINCT user_id)::int AS n FROM learning_events WHERE occurred_at >= ${start}`,
  ]);
  const learners = int(people?.n);
  const checks: CheckRows[] = [
    {
      id: "daily",
      label: "learning_events recomputed vs the learning_daily continuous aggregate",
      sides: { raw: "Raw events", aggregate: "learning_daily" },
      days: toDays(daily, ["xp", "focus", "events"]),
      learners,
    },
    {
      id: "presence",
      label: "Finished pomodoros recomputed vs the focus_presence_daily continuous aggregate",
      sides: { raw: "Raw events", aggregate: "focus_presence_daily" },
      days: toDays(presence, ["sessions", "focus", "seen"]),
      learners,
    },
    {
      id: "ledger",
      label: "The XP ledger (one row per reward) vs the XP on learning_events",
      sides: { raw: "xp_ledger", aggregate: "learning_events" },
      days: toDays(ledger, ["xp"]),
      learners,
    },
  ];
  return buildIntegrity(lastDays(7, libraryDay()), checks, {
    minGroup: MIN_GROUP,
    queryMs: Math.round(performance.now() - t0),
    nextRefreshAt,
  });
}

export async function tigerFacts(sql: Sql): Promise<TigerFacts> {
  const [hyper, jobs, aggs, events, weeks, rules] = await Promise.all([
    part(
      "hypertable",
      async () => {
        const [h] = await sql`
          SELECT h.num_chunks::int AS chunks,
            (SELECT count(*)::int FROM timescaledb_information.chunks c
              WHERE c.hypertable_name = 'learning_events' AND c.is_compressed) AS compressed,
            (SELECT d.time_interval::text FROM timescaledb_information.dimensions d
              WHERE d.hypertable_name = 'learning_events' AND d.dimension_number = 1) AS chunk_interval
          FROM timescaledb_information.hypertables h WHERE h.hypertable_name = 'learning_events'`;
        if (!h) return null;
        const [settings] = await part(
          "columnstore settings",
          () => sql`SELECT segmentby::text AS segmentby, orderby::text AS orderby
            FROM timescaledb_information.hypertable_columnstore_settings
            WHERE hypertable::text = 'learning_events'`,
          [] as postgres.Row[],
        );
        const [stats] = await part(
          "columnstore stats",
          () => sql`SELECT before_compression_total_bytes::bigint AS before,
              after_compression_total_bytes::bigint AS after
            FROM hypertable_columnstore_stats('learning_events')`,
          [] as postgres.Row[],
        );
        return {
          chunks: int(h.chunks),
          compressed: int(h.compressed),
          chunkInterval: formatInterval(h.chunk_interval as string | null),
          segmentBy: (settings?.segmentby as string) ?? null,
          orderBy: (settings?.orderby as string) ?? null,
          bytesBefore: stats?.before == null ? null : int(stats.before),
          bytesAfter: stats?.after == null ? null : int(stats.after),
        };
      },
      null,
    ),
    part(
      "jobs",
      () => sql<JobRow[]>`
        SELECT j.job_id, j.proc_name::text, j.hypertable_name::text, j.schedule_interval::text AS schedule,
          j.config, s.last_run_started_at, s.last_run_status::text,
          extract(epoch FROM s.last_run_duration) * 1000 AS duration_ms, s.next_start,
          s.total_runs::int, s.total_failures::int
        FROM timescaledb_information.jobs j
        LEFT JOIN timescaledb_information.job_stats s ON s.job_id = j.job_id
        WHERE j.proc_name IN ('policy_compression', 'policy_refresh_continuous_aggregate')`,
      [] as JobRow[],
    ),
    part(
      "aggregates",
      () => sql`
        SELECT view_name::text, hypertable_name::text, materialization_hypertable_name::text,
          materialized_only
        FROM timescaledb_information.continuous_aggregates WHERE view_schema = 'public'
        ORDER BY view_name`,
      [] as postgres.Row[],
    ),
    part(
      "events",
      () => sql`SELECT event_type, count(*)::int AS n FROM learning_events
        WHERE occurred_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC`,
      [] as postgres.Row[],
    ),
    part("verified weeks", () => verifiedWeeks(sql), [] as VerifiedWeek[]),
    part("guarantees", () => guarantees(sql), [] as Guarantee[]),
  ]);
  const byMat = new Map(aggs.map((a) => [a.materialization_hypertable_name as string, a]));
  const aggregates: AggregateFacts[] = aggs.map((a) => {
    const parent = byMat.get(a.hypertable_name as string);
    return {
      name: a.view_name as string,
      builtOn: parent ? (parent.view_name as string) : (a.hypertable_name as string),
      hierarchical: !!parent,
      realTime: !(a.materialized_only as boolean),
      refresh: jobFacts(
        jobs.find(
          (j) =>
            j.proc_name === "policy_refresh_continuous_aggregate" &&
            j.hypertable_name === a.view_name,
        ),
      ),
    };
  });
  const integrity = await part(
    "integrity",
    () =>
      integrityCheck(sql, aggregates.find((a) => a.name === "learning_daily")?.refresh?.nextRunAt),
    null,
  );
  const byType = Object.fromEntries(events.map((r) => [r.event_type as string, int(r.n)]));
  return {
    hypertable: hyper && {
      name: "learning_events",
      chunks: hyper.chunks,
      compressedChunks: hyper.compressed,
      chunkInterval: hyper.chunkInterval,
      segmentBy: hyper.segmentBy,
      orderBy: hyper.orderBy,
      bytesBefore: hyper.bytesBefore,
      bytesAfter: hyper.bytesAfter,
      policy: jobFacts(
        jobs.find(
          (j) => j.proc_name === "policy_compression" && j.hypertable_name === "learning_events",
        ),
      ),
    },
    aggregates,
    events24h: { total: Object.values(byType).reduce((a, b) => a + b, 0), byType },
    integrity,
    verifiedWeeks: weeks,
    guarantees: rules,
  };
}

/* ---- Vultr ---- */

async function status(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      headers: { range: "bytes=0-0" },
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => {});
    return res.status;
  } catch {
    return null;
  }
}

/**
 * Signs a 60-second URL for one stored narration clip and tries it, then tries the same object
 * without the signature. The URL itself never leaves the server: it would be a working link to a
 * student's lesson audio for that minute. Only what it says about itself is reported.
 */
async function signedUrlDemo(
  job: { id: string; scene: number | null; storage: string | null } | null,
): Promise<SignedUrlDemo> {
  const driver = storageDriver();
  if (driver !== "vultr")
    return {
      status: "unavailable",
      reason:
        driver === "local"
          ? "This server keeps files on its own disk (development), so there's nothing to sign. On the Vultr deployment every file is read through a short-lived signed URL."
          : "Object storage is only partly configured on this server.",
    };
  if (!job || job.scene === null || job.storage !== "vultr")
    return {
      status: "unavailable",
      reason: "No finished lesson with narration is stored in the bucket yet.",
    };
  const signed = await getStorage().signedGetUrl(
    sceneAudioKey(job.id, job.scene),
    SIGNED_URL_TTL_S,
  );
  const facts = signed ? describeSignedUrl(signed) : null;
  if (!signed || !facts)
    return { status: "unavailable", reason: "The storage driver didn't sign." };
  const bare = unsignedUrl(signed);
  const [signedStatus, unsignedStatus] = await Promise.all([
    status(signed),
    bare ? status(bare) : Promise.resolve(null),
  ]);
  const at = facts.signedAt ? new Date(facts.signedAt).getTime() : Date.now();
  return {
    status: "signed",
    host: facts.host,
    algorithm: facts.algorithm,
    expiresInSeconds: facts.expiresInSeconds,
    expiresAt: new Date(at + facts.expiresInSeconds * 1000).toISOString(),
    signedStatus,
    unsignedStatus,
  };
}

async function vultrFacts(sql: Sql | null): Promise<VultrFacts> {
  const driver = storageDriver();
  const pingStorage = async () => {
    if (driver === "invalid") return { reachable: null, pingMs: null };
    const t0 = performance.now();
    const reachable = await Promise.race([
      getStorage().ping(),
      new Promise<boolean>((r) => setTimeout(() => r(false), FETCH_TIMEOUT_MS)),
    ]).catch(() => false);
    return { reachable, pingMs: Math.round(performance.now() - t0) };
  };
  const [worker, jobs, last, ping] = await Promise.all([
    sql
      ? part(
          "worker",
          async () => {
            const [r] = await sql`
              SELECT extract(epoch FROM now() - max(seen_at))::float8 AS ago,
                count(*) FILTER (WHERE seen_at > now() - interval '2 minutes')::int AS active
              FROM worker_heartbeats`;
            const ago = r?.ago === null || r?.ago === undefined ? null : Number(r.ago);
            return {
              lastSeenSecondsAgo: ago === null ? null : Math.max(0, Math.round(ago)),
              online: ago !== null && ago <= WORKER_HEARTBEAT_SECONDS * 3,
              activeWorkers: int(r?.active),
            };
          },
          null,
        )
      : null,
    sql
      ? part(
          "jobs",
          async () => {
            const rows = await sql`SELECT status, count(*)::int AS n FROM lesson_jobs GROUP BY 1`;
            const counts: Record<string, number> = Object.fromEntries(
              LESSON_JOB_STATUSES.map((s) => [s, 0]),
            );
            for (const r of rows) counts[r.status as string] = int(r.n);
            return counts;
          },
          null,
        )
      : null,
    sql
      ? part(
          "last job",
          async () => {
            const [r] = await sql`
              SELECT id, created_at, completed_at, attempts, scene_count,
                checkpoint->>'storage' AS storage,
                checkpoint->'research'->>'from' AS research_from,
                jsonb_array_length(coalesce(checkpoint->'research'->'sources', '[]'::jsonb)) AS sources,
                (checkpoint->>'lesson') IS NOT NULL AS has_lesson,
                jsonb_array_length(coalesce(checkpoint->'recorded', '[]'::jsonb)) AS recorded,
                (SELECT min((a->>'scene')::int) FROM jsonb_array_elements(audio) a) AS first_scene
              FROM lesson_jobs WHERE status = 'completed' AND completed_at IS NOT NULL
              ORDER BY completed_at DESC LIMIT 1`;
            if (!r) return null;
            const facts: CompletedJobFacts = {
              completedAt: iso(r.completed_at)!,
              tookSeconds: Math.max(
                0,
                Math.round(
                  (new Date(r.completed_at as Date).getTime() -
                    new Date(r.created_at as Date).getTime()) /
                    1000,
                ),
              ),
              attempts: int(r.attempts),
              research: r.research_from
                ? { from: r.research_from as string, sources: int(r.sources) }
                : null,
              lessonStored: r.has_lesson as boolean,
              narration: {
                recorded: int(r.recorded),
                scenes: r.scene_count === null ? null : int(r.scene_count),
              },
              storage: (r.storage as CompletedJobFacts["storage"]) ?? null,
            };
            return {
              facts,
              ref: {
                id: r.id as string,
                scene: r.first_scene === null ? null : int(r.first_scene),
                storage: (r.storage as string) ?? null,
              },
            };
          },
          null,
        )
      : null,
    pingStorage(),
  ]);
  const signedUrl = await part("signed url", () => signedUrlDemo(last?.ref ?? null), {
    status: "unavailable",
    reason: "Signing failed on this server just now.",
  } as SignedUrlDemo);
  return {
    worker,
    jobs,
    lastCompleted: last?.facts ?? null,
    storage: { driver, ...ping },
    signedUrl,
  };
}

/* ---- Auth0 and the rest ---- */

async function auth0Facts(sql: Sql | null): Promise<Auth0Facts> {
  const counts = sql
    ? await part(
        "auth0 counts",
        async () => {
          const [r] = await sql`SELECT
              (SELECT count(*)::int FROM learners WHERE auth0_sub IS NOT NULL) AS accounts,
              (SELECT count(*)::int FROM study_circles) AS circles,
              (SELECT count(*)::int FROM table_holds WHERE visibility = 'private') AS private_holds,
              (SELECT count(*)::int FROM table_hold_email_invites) AS email_invites`;
          return {
            accounts: int(r?.accounts),
            circles: int(r?.circles),
            privateHolds: int(r?.private_holds),
            emailInvites: int(r?.email_invites),
          };
        },
        null,
      )
    : null;
  return {
    configured: authConfigured(),
    counts,
    ticketsConfigured: !!process.env.GAME_TICKET_SECRET?.trim(),
  };
}

async function serviceFacts(sql: Sql | null): Promise<ServiceFacts> {
  const none: ServiceFacts = {
    narrationClips: null,
    lessonsWritten: null,
    researchSources: null,
    librarianAnswers: null,
  };
  if (!sql) return none;
  return part(
    "services",
    async () => {
      const [r] = await sql`SELECT
          (SELECT coalesce(sum(jsonb_array_length(audio)), 0)::int FROM lesson_jobs
            WHERE status = 'completed') AS clips,
          (SELECT count(*)::int FROM lesson_jobs WHERE status = 'completed') AS lessons,
          (SELECT count(*)::int FROM research_sources)
            + (SELECT coalesce(sum(jsonb_array_length(
                coalesce(checkpoint->'research'->'sources', '[]'::jsonb))), 0)::int
              FROM lesson_jobs WHERE checkpoint->'research'->>'from' = 'tinyfish') AS sources,
          (SELECT count(*)::int FROM librarian_tasks WHERE status = 'completed') AS answers`;
      return {
        narrationClips: int(r?.clips),
        lessonsWritten: int(r?.lessons),
        researchSources: int(r?.sources),
        librarianAnswers: int(r?.answers),
      };
    },
    none,
  );
}

/* ---- The report ---- */

type Shared = Omit<ProofReport, "viewer" | "served" | "cachedForSeconds">;

async function buildShared(): Promise<Shared> {
  const t0 = performance.now();
  const sql = db();
  const [vultr, tiger, auth0, services] = await Promise.all([
    vultrFacts(sql),
    sql ? part("tiger", () => tigerFacts(sql), null) : null,
    auth0Facts(sql),
    serviceFacts(sql),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    buildMs: Math.round(performance.now() - t0),
    vultr,
    tiger,
    auth0,
    services,
  };
}

const shared = ttlCache(TTL_MS, buildShared);

/** The report for this request: the shared facts (cached) plus whether this viewer is signed in. */
export async function proofReport(request: Request): Promise<ProofReport> {
  const [{ value }, identity] = await Promise.all([
    shared(),
    verifiedIdentity(request).catch(() => null),
  ]);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  return {
    ...value,
    cachedForSeconds: TTL_MS / 1000,
    viewer: { signedIn: identity !== null },
    served: { https: proto === "https" || new URL(request.url).protocol === "https:" },
  };
}
