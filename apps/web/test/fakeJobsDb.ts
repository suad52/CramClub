import type postgres from "postgres";
import type { JobCheckpoint, JobRow } from "@/lib/jobs/server";
import type { LessonJobStatus } from "@/lib/jobs/types";

/**
 * A stand-in for Postgres that runs lib/jobs/server.ts's statements (dispatched on their
 * `/* jobs:… *\/` tags) the way the real SQL does: claims skip leased jobs and jobs not yet due,
 * leases expire on a fake clock, and fenced writes only land with the current claim token. The
 * same rules run against the real database in jobs.db.test.ts (opt-in).
 */

type Row = Omit<JobRow, "created_at" | "completed_at"> & {
  run_after: number;
  locked_by: string | null;
  locked_at: number | null;
  lease_until: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

interface Json {
  __json: unknown;
}
const unwrap = (v: unknown) =>
  v && typeof v === "object" && "__json" in v ? (v as Json).__json : v;
const DONE: LessonJobStatus[] = ["completed", "failed"];

export function fakeJobsDb() {
  let clock = Date.parse("2026-11-21T12:00:00Z");
  const learners = new Set<string>();
  const tasks = new Map<string, { owner: string; sources: number }>();
  /** job id → learner ids of the circle members it was shared with. */
  const shares = new Map<string, Set<string>>();
  const jobs = new Map<string, Row>();
  const beats = new Map<string, number>();
  const log: string[] = [];

  const out = (r: Row) => ({
    ...r,
    checkpoint: structuredClone(r.checkpoint),
    created_at: new Date(r.created_at),
    completed_at: r.completed_at ? new Date(r.completed_at) : null,
  });
  const fenced = (id: unknown, token: unknown) => {
    const r = jobs.get(id as string);
    return r && r.locked_by === token && !DONE.includes(r.status) ? r : null;
  };
  const busy = (r: Row) => !DONE.includes(r.status);

  function run(tag: string, v: unknown[]): unknown[] {
    log.push(tag);
    switch (tag) {
      case "jobs:lock-owner":
        return learners.has(v[0] as string) ? [{ user_id: v[0] }] : [];
      case "jobs:find-active": {
        const [owner, topic, level, length, task] = v;
        const hit = [...jobs.values()]
          .filter(
            (r) =>
              r.owner_id === owner &&
              busy(r) &&
              r.topic.toLowerCase() === (topic as string).toLowerCase() &&
              r.level === level &&
              r.length === length &&
              r.task_id === (task ?? null),
          )
          .sort((a, b) => b.created_at - a.created_at);
        return hit.slice(0, 1).map(out);
      }
      case "jobs:counts": {
        const mine = [...jobs.values()].filter((r) => r.owner_id === v[0]);
        return [
          {
            active: mine.filter(busy).length,
            today: mine.filter((r) => r.created_at > clock - 86_400_000).length,
          },
        ];
      }
      case "jobs:task-sources": {
        const [owner, task, owner2] = v;
        const t = tasks.get(task as string);
        if (!t || t.owner !== owner2) return [];
        return [{ sources: t.owner === owner ? t.sources : 0 }];
      }
      case "jobs:insert": {
        const [id, owner, topic, level, length, task] = v as string[];
        const row: Row = {
          id: id!,
          owner_id: owner!,
          topic: topic!,
          level: level!,
          length: length!,
          task_id: task ?? null,
          status: "queued",
          progress: null,
          attempts: 0,
          run_after: clock,
          locked_by: null,
          locked_at: null,
          lease_until: null,
          checkpoint: {},
          title: null,
          summary: null,
          scene_count: null,
          audio: [],
          sources: [],
          error_message: null,
          error_retryable: false,
          created_at: clock++,
          updated_at: clock,
          completed_at: null,
        };
        jobs.set(row.id, row);
        return [out(row)];
      }
      case "jobs:list":
        return [...jobs.values()]
          .filter((r) => r.owner_id === v[0])
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, v[1] as number)
          .map(out);
      case "jobs:readable": {
        const [viewer, id] = v as string[];
        const r = jobs.get(id!);
        if (!r) return [];
        const ok = r.owner_id === viewer || !!shares.get(r.id)?.has(viewer!);
        return ok ? [{ ...out(r), is_owner: r.owner_id === viewer }] : [];
      }
      case "jobs:retry": {
        const r = jobs.get(v[0] as string);
        if (!r || r.owner_id !== v[1] || r.status !== "failed") return [];
        Object.assign(r, {
          status: "queued",
          attempts: 0,
          run_after: clock,
          progress: null,
          error_message: null,
          error_retryable: false,
          locked_by: null,
          locked_at: null,
          lease_until: null,
        });
        return [out(r)];
      }
      case "jobs:owned-status": {
        const r = jobs.get(v[0] as string);
        return r && r.owner_id === v[1] ? [{ status: r.status }] : [];
      }
      case "jobs:reap":
        for (const r of jobs.values())
          if (
            busy(r) &&
            r.lease_until !== null &&
            r.lease_until < clock &&
            r.attempts >= (v[0] as number)
          )
            Object.assign(r, {
              status: "failed",
              progress: null,
              locked_by: null,
              locked_at: null,
              lease_until: null,
              error_retryable: true,
              error_message: "The library's worker stopped while making this lesson.",
            });
        return [];
      case "jobs:claim": {
        const [token, lease, max] = v as [string, number, number];
        const next = [...jobs.values()]
          .filter(
            (r) =>
              busy(r) &&
              r.run_after <= clock &&
              (r.lease_until === null || r.lease_until < clock) &&
              r.attempts < max,
          )
          .sort((a, b) => a.run_after - b.run_after || a.created_at - b.created_at)[0];
        if (!next) return [];
        Object.assign(next, {
          attempts: next.attempts + 1,
          locked_by: token,
          locked_at: clock,
          lease_until: clock + lease * 1000,
        });
        return [out(next)];
      }
      case "jobs:extend": {
        const r = fenced(v[1], v[2]);
        if (!r) return [];
        r.lease_until = clock + (v[0] as number) * 1000;
        return [{ id: r.id }];
      }
      case "jobs:update": {
        const [
          status,
          progress,
          checkpoint,
          title,
          summary,
          sceneCount,
          sources,
          lease,
          id,
          token,
        ] = v;
        const r = fenced(id, token);
        if (!r) return [];
        if (status !== null) r.status = status as LessonJobStatus;
        if (progress !== null) r.progress = progress as string;
        r.checkpoint = { ...r.checkpoint, ...(unwrap(checkpoint) as JobCheckpoint) };
        if (title !== null) r.title = title as string;
        if (summary !== null) r.summary = summary as string;
        if (sceneCount !== null) r.scene_count = sceneCount as number;
        if (sources !== null) r.sources = unwrap(sources) as Row["sources"];
        r.lease_until = clock + (lease as number) * 1000;
        r.updated_at = clock;
        return [{ id: r.id }];
      }
      case "jobs:complete": {
        const [progress, audio, recorded, id, token] = v;
        const r = fenced(id, token);
        if (!r) return [];
        Object.assign(r, {
          status: "completed",
          progress,
          audio: unwrap(audio),
          checkpoint: { ...r.checkpoint, ...(unwrap(recorded) as JobCheckpoint) },
          error_message: null,
          error_retryable: false,
          completed_at: clock,
          locked_by: null,
          locked_at: null,
          lease_until: null,
        });
        return [{ id: r.id }];
      }
      case "jobs:fail": {
        const [status, progress, delay, message, retryable, id, token] = v;
        const r = fenced(id, token);
        if (!r) return [];
        Object.assign(r, {
          status,
          progress,
          run_after: clock + (delay as number) * 1000,
          error_message: message,
          error_retryable: retryable,
          locked_by: null,
          locked_at: null,
          lease_until: null,
        });
        return [{ id: r.id }];
      }
      case "jobs:release": {
        const r = fenced(v[0], v[1]);
        if (!r) return [];
        Object.assign(r, {
          status: "queued",
          attempts: Math.max(r.attempts - 1, 0),
          progress: "The worker restarted.",
          run_after: clock,
          locked_by: null,
          locked_at: null,
          lease_until: null,
        });
        return [{ id: r.id }];
      }
      case "worker:beat":
        beats.set(v[0] as string, clock);
        return [];
      case "worker:last-seen": {
        const last = Math.max(...beats.values());
        return [{ ago: beats.size ? (clock - last) / 1000 : null }];
      }
      default:
        throw new Error(`fake db: no handler for ${tag}`);
    }
  }

  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const name = /\/\* ([\w:-]+) \*\//.exec(strings.join("?"))?.[1];
    if (!name) throw new Error(`fake db: untagged query: ${strings.join("?").slice(0, 80)}`);
    return Promise.resolve(run(name, values));
  };
  const sql = Object.assign(tag, {
    json: (value: unknown): Json => ({ __json: value }),
    begin: async (fn: (tx: unknown) => unknown) => fn(sql),
  });

  return {
    sql: sql as unknown as postgres.Sql,
    jobs,
    learners,
    tasks,
    shares,
    log,
    beats,
    now: () => clock,
    advance(seconds: number) {
      clock += seconds * 1000;
    },
  };
}
