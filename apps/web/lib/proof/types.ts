/**
 * GET /api/proof → ProofReport: the live facts behind the /proof page ("How it works", for the
 * sponsor judges). Read-only and public, so it carries no secrets, no user ids or emails, no
 * hostnames of workers, no bucket names or keys, and no lesson topics: only counts, timings,
 * states and the database's own catalog. Small groups are hidden (null) like the community
 * charts (rules.ts MIN_GROUP). Every number is real; a part that can't be read is null, which the
 * page shows as "unavailable", never as a guess. Built by lib/proof/server.ts, cached a few
 * seconds per server process (the viewer's signed-in yes/no is added per request).
 */

export interface ProofReport {
  generatedAt: string;
  /** How long the shared part of this report is reused for (s). */
  cachedForSeconds: number;
  /** How long building it took (ms), cache misses only. */
  buildMs: number;
  viewer: { signedIn: boolean };
  /** How this request reached the web app: over HTTPS (Caddy's X-Forwarded-Proto in production). */
  served: { https: boolean };
  vultr: VultrFacts;
  tiger: TigerFacts | null;
  auth0: Auth0Facts;
  services: ServiceFacts;
}

/* ---- Vultr ---- */

export interface VultrFacts {
  worker: {
    lastSeenSecondsAgo: number | null;
    online: boolean;
    /** Worker processes that checked in during the last 2 minutes. */
    activeWorkers: number;
  } | null;
  /** lesson_jobs rows by status (every status listed, zero-filled). */
  jobs: Record<string, number> | null;
  lastCompleted: CompletedJobFacts | null;
  storage: {
    driver: "vultr" | "local" | "invalid";
    /** The bucket (or folder) answered a ping; null when not tried. */
    reachable: boolean | null;
    pingMs: number | null;
  };
  signedUrl: SignedUrlDemo;
}

export interface CompletedJobFacts {
  completedAt: string;
  /** From queued to done (s). */
  tookSeconds: number;
  attempts: number;
  /** What the job's checkpoint recorded, step by step. */
  research: { from: string; sources: number } | null;
  lessonStored: boolean;
  narration: { recorded: number; scenes: number | null };
  storage: "vultr" | "local" | null;
}

export type SignedUrlDemo =
  | {
      status: "signed";
      /** The storage host the URL points at (the region endpoint, never the bucket or key). */
      host: string;
      algorithm: string;
      expiresInSeconds: number;
      expiresAt: string;
      /** HTTP status of a 1-byte GET with the signed URL (expect 200/206). */
      signedStatus: number | null;
      /** HTTP status of the same GET without a signature (expect 403: the bucket is private). */
      unsignedStatus: number | null;
    }
  | { status: "unavailable"; reason: string };

/* ---- Tiger Data ---- */

export interface TigerFacts {
  hypertable: {
    name: string;
    chunks: number;
    compressedChunks: number;
    chunkInterval: string | null;
    segmentBy: string | null;
    orderBy: string | null;
    /** Columnstore sizes over the compressed chunks, when there are any. */
    bytesBefore: number | null;
    bytesAfter: number | null;
    policy: JobFacts | null;
  } | null;
  aggregates: AggregateFacts[];
  /** Events recorded in the last 24 hours, by type. */
  events24h: { total: number; byType: Record<string, number> };
  integrity: IntegrityReport | null;
  /** Library-wide verified focus per week (focus_presence_weekly), oldest first. */
  verifiedWeeks: VerifiedWeek[];
  /** Rules the database itself enforces, read from its catalog. */
  guarantees: Guarantee[];
}

export interface JobFacts {
  /** e.g. "every 10 minutes". */
  schedule: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  lastDurationMs: number | null;
  nextRunAt: string | null;
  runs: number;
  failures: number;
  /** Policy settings worth showing ("after 30 days", "last 40 days"). */
  detail: string | null;
}

export interface AggregateFacts {
  name: string;
  /** What it's built on: the hypertable, or another continuous aggregate (hierarchical). */
  builtOn: string;
  hierarchical: boolean;
  realTime: boolean;
  refresh: JobFacts | null;
}

export interface VerifiedWeek {
  /** Monday, "YYYY-MM-DD" (library time). */
  week: string;
  learners: number;
  /** Null when fewer than MIN_GROUP learners (so no one can be singled out). */
  sessions: number | null;
  sessionsWithCamera: number | null;
  focusMinutes: number | null;
  verifiedMinutes: number | null;
}

export interface Guarantee {
  table: string;
  rule: string;
  /** How Postgres enforces it ("unique", "check", "exclusion", "unique index"). */
  kind: string;
  present: boolean;
}

/** One measure, recomputed from raw rows against an aggregate. */
export interface IntegrityCheck {
  id: "daily" | "presence" | "ledger";
  /** What is compared with what, for people. */
  label: string;
  /** Names for the two sides (the recomputed one first). */
  sides: { raw: string; aggregate: string };
  /** Rows (learner × day groups) compared, and how many disagree. */
  groups: number;
  drifted: number;
  /**
   * Window totals from each side (xp; focus and seen in seconds; events, sessions); null when too
   * few learners to show.
   */
  raw: Record<string, number> | null;
  aggregate: Record<string, number> | null;
  ok: boolean;
}

export interface IntegrityDay {
  day: string;
  groups: number;
  drifted: number;
}

export interface IntegrityReport {
  /** The window checked: the last 7 library days, today included ("YYYY-MM-DD"). */
  from: string;
  to: string;
  checks: IntegrityCheck[];
  /** Per day, every check together (zero-filled: a quiet day is a day with 0 groups). */
  days: IntegrityDay[];
  ok: boolean;
  queryMs: number;
  /** When the daily aggregate's refresh job runs next (drift, if any, is fixed by then). */
  nextRefreshAt: string | null;
}

/* ---- Auth0 ---- */

export interface Auth0Facts {
  configured: boolean;
  /** Learners linked to an Auth0 account, Study Circles, private table holds, email invites. */
  counts: {
    accounts: number;
    circles: number;
    privateHolds: number;
    emailInvites: number;
  } | null;
  /** Multiplayer join tickets can be issued here (GAME_TICKET_SECRET is set). */
  ticketsConfigured: boolean;
}

/* ---- The other services ---- */

export interface ServiceFacts {
  /** Narration clips stored for finished lessons (ElevenLabs). */
  narrationClips: number | null;
  /** Background lessons written and finished (Gemini). */
  lessonsWritten: number | null;
  /** Sources found for the Librarian's research and for lessons (TinyFish). */
  researchSources: number | null;
  /** Librarian requests completed. */
  librarianAnswers: number | null;
}
