import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { generateLesson } from "@/lib/learning-studio/server";
import type { Level } from "@/lib/learning-studio/schema";
import { DAILY_CAPS, LIBRARY_TIME_ZONE as TZ, XP, subjectSlug } from "@/lib/learning/rules";
import { libraryDay } from "@/lib/learning/server/queries";
import type {
  LibrarianHome,
  LibrarianTask,
  PlanItem,
  ResearchMode,
  ResearchStep,
  ResourceCard,
  StudyPlanView,
  TaskStatus,
  TaskType,
} from "../types";
import { BUSY_STATUSES } from "../types";
import {
  LIBRARIAN_MODEL,
  type SourceForModel,
  Understanding,
  draftPlan,
  organize,
  understand,
} from "./gemini";
import {
  TinyFishError,
  cancelResearch,
  fetchPages,
  getResearch,
  search,
  startResearch,
  tinyfishConfigured,
} from "./tinyfish";

/**
 * The Librarian's task lifecycle. A request is understood (Gemini), confirmed by the student,
 * researched (TinyFish), organised (Gemini over what TinyFish returned), and can then become a
 * study plan or a lesson (Gemini, through the Learning Studio's own lesson generator). Long work
 * runs after the response (`defer`); the client polls the task. Every row is scoped to its
 * learner, and every step the UI shows comes from a provider response.
 */

type Sql = postgres.Sql;
export type Defer = (job: () => Promise<void>) => void;
export type Outcome<T> = { status: number; body: T | { error: { code: string; message: string } } };

const fail = (status: number, code: string, message: string): Outcome<never> => ({
  status,
  body: { error: { code, message } },
});

interface Details extends Partial<Understanding> {
  failedStep?: "research" | "plan" | "lesson";
  lastPoll?: number;
  runStatus?: string;
  planItemId?: string | null;
}

const MAX_SOURCES = 8;
/** Pages to try reading: more than we keep, since some sites block automated reading. */
const MAX_FETCH = 10;
/** Quick research that hasn't moved in this long has died (e.g. the server restarted). */
const STALE_MS = 4 * 60_000;
const DEEP_LIMIT_MS = 50 * 60_000;
/** Sites that sell or share answers, and social media: never recommended as study sources. */
const BLOCKED =
  /(^|\.)(chegg|coursehero|studocu|brainly|quizlet|scribd|pinterest|quora|numerade|facebook|instagram|tiktok|twitter|x|linkedin|reddit|threads)\./;
const TRUSTED =
  /(\.edu|\.gov|\.ac\.[a-z]{2}|\.edu\.[a-z]{2}|(^|\.)(khanacademy\.org|openstax\.org|libretexts\.org|britannica\.com|nature\.com|ncbi\.nlm\.nih\.gov|nih\.gov|who\.int|mit\.edu|wikipedia\.org|developer\.mozilla\.org|bbc\.co\.uk|nasa\.gov|ck12\.org|mathsisfun\.com|physicsclassroom\.com|biologydictionary\.net))$/;

/** Models sometimes write "null" or "unknown" where they mean nothing. */
export const realValue = (v: string | null | undefined) =>
  v && !/^(null|none|n\/a|unknown|unspecified|-)?$/i.test(v.trim()) ? v.trim() : null;

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** One URL per page: no fragments, tracking parameters or trailing slashes. */
export function normalizeUrl(url: string) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|ref$)/.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.replace(/^www\./, "");
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

/** Search hits ranked for study: credible sources first, no answer mills, two pages per site at most. */
export function rankHits<T extends { url: string; position: number }>(
  hits: readonly T[],
  max: number,
) {
  const seen = new Set<string>();
  const perSite = new Map<string, number>();
  return hits
    .map((h) => {
      const d = domainOf(h.url);
      return { h, d, score: (TRUSTED.test(d) ? 10 : 0) - h.position * 0.6 };
    })
    .filter(({ d }) => d && !BLOCKED.test(`.${d}`))
    .sort((a, b) => b.score - a.score)
    .filter(({ h, d }) => {
      const key = normalizeUrl(h.url);
      if (seen.has(key) || (perSite.get(d) ?? 0) >= 2) return false;
      seen.add(key);
      perSite.set(d, (perSite.get(d) ?? 0) + 1);
      return true;
    })
    .slice(0, max)
    .map(({ h }) => h);
}

/* ---- Persistence helpers ---- */

async function addStep(sql: Sql, id: string, step: Omit<ResearchStep, "at">) {
  const full: ResearchStep = { at: new Date().toISOString(), ...step };
  await sql`UPDATE librarian_tasks SET steps = steps || ${sql.json([full] as never)}::jsonb, updated_at = now()
    WHERE id = ${id}`;
}

async function setStatus(
  sql: Sql,
  id: string,
  status: TaskStatus,
  extra: Record<string, unknown> = {},
) {
  const fields = { status, ...extra };
  await sql`UPDATE librarian_tasks SET ${sql(fields as Record<string, postgres.ParameterOrJSON<never>>)}, updated_at = now()
    WHERE id = ${id}`;
}

async function cancelled(sql: Sql, id: string) {
  const [r] = await sql`SELECT cancel_requested FROM librarian_tasks WHERE id = ${id}`;
  return !r || (r.cancel_requested as boolean);
}

async function failTask(sql: Sql, id: string, step: Details["failedStep"], err: unknown) {
  const tf = err instanceof TinyFishError ? err : null;
  const code = tf?.code ?? "failed";
  const message =
    tf?.message ??
    (step === "research"
      ? "The research couldn't be finished."
      : step === "plan"
        ? "I couldn't write the plan this time. Your sources are safe."
        : "I couldn't build the lesson this time. Your sources are safe.");
  console.error(`[librarian] ${step} failed:`, err);
  await sql`UPDATE librarian_tasks SET status = 'failed', error_code = ${code}, error_message = ${message},
      details = details || ${sql.json({ failedStep: step })}::jsonb, updated_at = now()
    WHERE id = ${id}`;
}

async function recordEvent(
  sql: Sql | postgres.TransactionSql,
  e: { userId: string; type: string; subject?: string; activityId: string; xp?: number },
) {
  const subjectId = e.subject ? subjectSlug(e.subject) : null;
  if (subjectId && e.subject)
    await sql`INSERT INTO subjects (subject_id, name) VALUES (${subjectId}, ${e.subject.slice(0, 60)})
      ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO learning_events (event_id, user_id, event_type, subject_id, activity_id, xp_delta)
    VALUES (${randomUUID()}, ${e.userId}, ${e.type}, ${subjectId}, ${e.activityId}, ${e.xp ?? 0})`;
}

/* ---- Views ---- */

export async function taskView(
  sql: Sql,
  userId: string,
  id: string,
): Promise<LibrarianTask | null> {
  const [t] = await sql`SELECT * FROM librarian_tasks WHERE id = ${id} AND user_id = ${userId}`;
  if (!t) return null;
  const [sources, plans] = await Promise.all([
    sql`SELECT * FROM research_sources WHERE task_id = ${id} ORDER BY position`,
    sql`SELECT * FROM study_plans WHERE task_id = ${id}`,
  ]);
  let plan: StudyPlanView | null = null;
  if (plans[0]) {
    const p = plans[0];
    const items = await sql`SELECT * FROM study_plan_items WHERE study_plan_id = ${p.id as string}
      ORDER BY scheduled_date, position`;
    const dayInfo = new Map(
      ((p.days as { date: string; focus: string; objectives: string[] }[]) ?? []).map((d) => [
        d.date,
        d,
      ]),
    );
    const byDate = new Map<string, PlanItem[]>();
    for (const it of items) {
      const date = (it.scheduled_date as Date).toISOString().slice(0, 10);
      const list = byDate.get(date) ?? [];
      list.push(planItem(it));
      byDate.set(date, list);
    }
    plan = {
      id: p.id as string,
      title: p.title as string,
      goal: p.goal as string,
      examDate: p.target_date ? (p.target_date as Date).toISOString().slice(0, 10) : null,
      dailyMinutes: p.daily_minutes as number,
      assumptions: p.assumptions as string[],
      days: [...byDate.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, list]) => ({
          date,
          focus: dayInfo.get(date)?.focus ?? "",
          objectives: dayInfo.get(date)?.objectives ?? [],
          items: list,
        })),
    };
  }
  const resources: ResourceCard[] = sources.map(resourceCard);
  const lessonSources =
    (t.lesson_sources as { page: number; title: string; url: string; text?: string }[]) ?? [];
  const status = t.status as TaskStatus;
  return {
    id: t.id as string,
    type: t.task_type as TaskType,
    status,
    busy: BUSY_STATUSES.includes(status),
    request: t.user_request as string,
    topic: t.topic as string,
    mode: t.mode as ResearchMode,
    createdAt: (t.created_at as Date).toISOString(),
    reply: t.reply as string,
    questions: t.questions as string[],
    confirmation: (t.confirmation as string) ?? null,
    steps: t.steps as ResearchStep[],
    overview: (t.overview as string) ?? null,
    keyConcepts: t.key_concepts as string[],
    resources,
    warnings: t.warnings as string[],
    plan,
    lesson: (t.lesson as LibrarianTask["lesson"]) ?? null,
    lessonChunks: lessonSources.map((s) => ({ page: s.page, text: s.text ?? "" })),
    lessonSources: lessonSources.map(({ page, title, url }) => ({ page, title, url })),
    error: t.error_code
      ? {
          code: t.error_code as string,
          message: t.error_message as string,
          retryable: status === "failed" && t.error_code !== "not_configured",
        }
      : null,
    attribution: {
      research: t.mode === "deep" ? "TinyFish Research" : "TinyFish Search + Fetch",
      synthesis: "Gemini",
    },
  };
}

function resourceCard(r: postgres.Row): ResourceCard {
  return {
    id: r.id as string,
    title: r.title as string,
    url: r.url as string,
    domain: r.domain as string,
    resourceType: r.resource_type as ResourceCard["resourceType"],
    summary: r.summary as string,
    relevance: r.relevance_reason as string,
    difficulty: (r.difficulty as string) ?? null,
    accessedAt: (r.accessed_at as Date).toISOString(),
    saved: r.saved as boolean,
  };
}

function planItem(it: postgres.Row): PlanItem {
  return {
    id: it.id as string,
    date: (it.scheduled_date as Date).toISOString().slice(0, 10),
    type: it.activity_type as PlanItem["type"],
    title: it.title as string,
    description: it.description as string,
    resourceUrls: it.resource_urls as string[],
    estimatedMinutes: it.estimated_minutes as number,
    completionCriteria: it.completion_criteria as string[],
    status: it.status as PlanItem["status"],
  };
}

/* ---- Intake ---- */

export async function intake(
  sql: Sql,
  userId: string,
  b: { message: string; taskId?: string; mode?: ResearchMode },
): Promise<Outcome<LibrarianTask>> {
  let id = b.taskId ?? null;
  let request = b.message.trim();
  if (id) {
    const [prev] = await sql`SELECT user_request, status FROM librarian_tasks
      WHERE id = ${id} AND user_id = ${userId}`;
    if (!prev) return fail(404, "not_found", "That conversation isn't there any more.");
    if (prev.status !== "awaiting_details" && prev.status !== "awaiting_confirmation") id = null;
    else request = `${prev.user_request as string}\n${request}`.slice(-4000);
  }
  const u = await understand(request, libraryDay());
  const declined = u.declined;
  const status: TaskStatus = declined
    ? "completed"
    : u.questions.length
      ? "awaiting_details"
      : "awaiting_confirmation";
  const reply = declined ?? (u.questions.length ? u.questions.join(" ") : u.confirmation);
  const fields = {
    task_type: u.taskType,
    status,
    user_request: request,
    topic: u.topic,
    details: sql.json(u as never),
    mode: b.mode ?? "quick",
    reply,
    questions: sql.json(declined ? [] : u.questions),
    confirmation: declined || u.questions.length ? null : u.confirmation,
  };
  if (id)
    await sql`UPDATE librarian_tasks SET ${sql(fields as never)}, updated_at = now() WHERE id = ${id}`;
  else {
    id = randomUUID();
    await sql`INSERT INTO librarian_tasks ${sql({ id, user_id: userId, ...fields } as never)}`;
  }
  return { status: 200, body: (await taskView(sql, userId, id))! };
}

/* ---- Research ---- */

export async function confirm(
  sql: Sql,
  userId: string,
  id: string,
  mode: ResearchMode | undefined,
  defer: Defer,
): Promise<Outcome<LibrarianTask>> {
  if (!tinyfishConfigured())
    return fail(
      503,
      "not_configured",
      "Live research needs TINYFISH_API_KEY (see docs/ai-librarian.md).",
    );
  const [t] = await sql`UPDATE librarian_tasks SET status = 'research_queued', started_at = now(),
      mode = coalesce(${mode ?? null}, mode), cancel_requested = false, error_code = NULL,
      error_message = NULL, updated_at = now()
    WHERE id = ${id} AND user_id = ${userId} AND status = 'awaiting_confirmation'
    RETURNING mode`;
  if (!t) return fail(409, "conflict", "That request isn't waiting to start.");
  defer(() => (t.mode === "deep" ? beginDeep(sql, userId, id) : runQuick(sql, userId, id)));
  return { status: 200, body: (await taskView(sql, userId, id))! };
}

async function details(sql: Sql, id: string) {
  const [t] =
    await sql`SELECT user_request, topic, task_type, details FROM librarian_tasks WHERE id = ${id}`;
  return {
    request: t!.user_request as string,
    topic: t!.topic as string,
    type: t!.task_type as TaskType,
    d: t!.details as Details,
  };
}

/** Quick research: TinyFish searches the web, then reads the most promising pages. */
async function runQuick(sql: Sql, userId: string, id: string) {
  try {
    await setStatus(sql, id, "researching");
    const { d, topic } = await details(sql, id);
    const queries = d.searchQueries?.length ? d.searchQueries : [topic];
    const hits = [];
    for (const q of queries.slice(0, 3)) {
      if (await cancelled(sql, id)) return;
      const found = await search(q);
      hits.push(...found);
      await addStep(sql, id, {
        kind: "search",
        label: `Searched “${q}” · ${found.length} results`,
      });
    }
    const picked = rankHits(hits, MAX_FETCH);
    if (!picked.length)
      throw new TinyFishError("The searches found nothing usable.", "no_sources", 404, true);
    if (await cancelled(sql, id)) return;
    await addStep(sql, id, {
      kind: "note",
      label: `Reading ${picked.length} pages: ${[...new Set(picked.map((h) => domainOf(h.url)))].join(", ")}`,
    });
    const { pages, errors } = await fetchPages(picked.map((h) => h.url));
    for (const p of pages)
      await addStep(sql, id, {
        kind: "fetch",
        label: `Read ${p.title || domainOf(p.finalUrl)}`,
        url: p.finalUrl,
      });
    for (const e of errors.slice(0, 6))
      await addStep(sql, id, {
        kind: "error",
        label: `Couldn't open ${domainOf(e.url)} (${e.error === "bot_blocked" ? "the site blocks automated reading" : e.error}), so only its search snippet is used`,
        url: e.url,
      });
    if (await cancelled(sql, id)) return;
    const read = new Set(pages.map((p) => normalizeUrl(p.url)));
    const sources: SourceForModel[] = pages.map((p) => {
      const hit = picked.find((h) => normalizeUrl(h.url) === normalizeUrl(p.url));
      return {
        title: p.title || hit?.title || domainOf(p.finalUrl),
        url: p.finalUrl,
        domain: domainOf(p.finalUrl),
        text: `${p.description}\n${p.text}`,
      };
    });
    // Pages that wouldn't open still count as found, by their search snippet, clearly marked.
    for (const h of picked)
      if (!read.has(normalizeUrl(h.url)) && h.snippet.length >= 60 && sources.length < MAX_FETCH)
        sources.push({
          title: h.title || domainOf(h.url),
          url: h.url,
          domain: domainOf(h.url),
          text: h.snippet,
          snippetOnly: true,
        });
    await organizeAndSave(sql, userId, id, sources);
  } catch (err) {
    await failTask(sql, id, "research", err);
  }
}

/** Deep research: a TinyFish Research run (minutes). Progress is read when the task is polled. */
async function beginDeep(sql: Sql, userId: string, id: string) {
  try {
    const { request, topic } = await details(sql, id);
    const runId = await startResearch(
      `For a student: ${request}\nFocus: ${topic}. Prefer educational institutions, reputable publishers and official documentation. Return the clearest explanations and learning resources.`,
    );
    await setStatus(sql, id, "researching", { provider_run_id: runId });
    await addStep(sql, id, { kind: "status", label: "TinyFish Research run started" });
  } catch (err) {
    await failTask(sql, id, "research", err);
  }
}

/** Advances a deep run when it's polled (at most every 5 s). */
async function pollDeep(sql: Sql, userId: string, id: string, defer: Defer) {
  const [t] =
    await sql`SELECT provider_run_id, details, steps FROM librarian_tasks WHERE id = ${id}`;
  const d = t?.details as Details;
  if (!t?.provider_run_id || Date.now() - (d.lastPoll ?? 0) < 5000) return;
  await sql`UPDATE librarian_tasks SET details = details || ${sql.json({ lastPoll: Date.now() })}::jsonb WHERE id = ${id}`;
  let run;
  try {
    run = await getResearch(t.provider_run_id as string);
  } catch (err) {
    if (err instanceof TinyFishError && !err.retryable) await failTask(sql, id, "research", err);
    return;
  }
  if (run.status !== d.runStatus) {
    await sql`UPDATE librarian_tasks SET details = details || ${sql.json({ runStatus: run.status })}::jsonb WHERE id = ${id}`;
    await addStep(sql, id, {
      kind: "status",
      label: `TinyFish Research: ${run.status.toLowerCase().replace("_", " ")}`,
    });
  }
  const steps = t.steps as ResearchStep[];
  if (run.plan.length && !steps.some((s) => s.kind === "plan"))
    for (const q of run.plan) await addStep(sql, id, { kind: "plan", label: q });
  if (run.status === "COMPLETED") {
    await setStatus(sql, id, "organizing_results");
    defer(async () => {
      try {
        // Evidence comes with the claims it supports; citations alone are read with TinyFish Fetch.
        let sources: SourceForModel[] = run.evidence
          .filter((e) => e.claims.length)
          .slice(0, MAX_SOURCES)
          .map((e) => ({
            title: e.title || domainOf(e.url),
            url: e.url,
            domain: domainOf(e.url),
            text: e.claims.join("\n"),
          }));
        if (sources.length < 3 && run.citations.length) {
          const { pages } = await fetchPages(
            rankHits(
              run.citations.map((url, i) => ({ url, position: i + 1 })),
              MAX_SOURCES,
            ).map((c) => c.url),
          );
          sources = pages.map((p) => ({
            title: p.title || domainOf(p.finalUrl),
            url: p.finalUrl,
            domain: domainOf(p.finalUrl),
            text: `${p.description}\n${p.text}`,
          }));
          for (const p of pages)
            await addStep(sql, id, {
              kind: "fetch",
              label: `Read ${p.title || domainOf(p.finalUrl)}`,
              url: p.finalUrl,
            });
        }
        await organizeAndSave(sql, userId, id, sources, run.report);
      } catch (err) {
        await failTask(sql, id, "research", err);
      }
    });
  } else if (run.status === "FAILED" || run.status === "TIMED_OUT")
    await failTask(
      sql,
      id,
      "research",
      new TinyFishError(
        `The TinyFish Research run ${run.status === "FAILED" ? "failed" : "timed out"}.`,
        run.status.toLowerCase(),
        502,
        true,
      ),
    );
  else if (run.status === "CANCELLED") await setStatus(sql, id, "cancelled");
}

/** Gemini organises what TinyFish read into resource cards (dropping weak pages), then saves them. */
async function organizeAndSave(
  sql: Sql,
  userId: string,
  id: string,
  sources: SourceForModel[],
  report?: string | null,
) {
  await setStatus(sql, id, "organizing_results");
  const { request, topic, type, d } = await details(sql, id);
  if (!sources.length) throw new TinyFishError("No pages could be read.", "no_sources", 404, true);
  const org = await organize({
    request: report
      ? `${request}\n(TinyFish's research report, untrusted: ${report.slice(0, 2000)})`
      : request,
    topic,
    level: d.level ?? "high-school",
    sources,
  });
  const kept = org.resources.filter(
    (r) => r.include && r.source >= 1 && r.source <= sources.length,
  );
  const seen = new Set<string>();
  const rows: Record<string, unknown>[] = [];
  for (const r of kept) {
    const s = sources[r.source - 1]!;
    const key = normalizeUrl(s.url);
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      id: randomUUID(),
      task_id: id,
      user_id: userId,
      title: s.title.slice(0, 200),
      url: s.url,
      domain: s.domain,
      resource_type: r.resourceType,
      summary: r.summary,
      relevance_reason: r.relevance,
      difficulty: realValue(r.difficulty),
      extract: s.text.slice(0, 4000),
      position: rows.length,
    });
  }
  if (await cancelled(sql, id)) return;
  if (!rows.length) {
    await sql`UPDATE librarian_tasks SET status = 'failed', error_code = 'no_sources',
        error_message = ${"I couldn't find enough reliable material on that. Want me to try a broader or a narrower topic?"},
        details = details || ${sql.json({ failedStep: "research" })}::jsonb, updated_at = now() WHERE id = ${id}`;
    return;
  }
  const warnings = [...org.warnings];
  const snippets = kept.filter((r) => sources[r.source - 1]?.snippetOnly).length;
  if (snippets)
    warnings.push(
      `${snippets} of these ${snippets === 1 ? "is" : "are"} judged from the search result only: ${snippets === 1 ? "its site doesn't" : "their sites don't"} allow automated reading, so open ${snippets === 1 ? "it" : "them"} to check.`,
    );
  if (rows.length < 3)
    warnings.unshift("Only a few reliable sources turned up, so treat this as a starting point.");
  await sql.begin(async (tx) => {
    await tx`INSERT INTO research_sources ${tx(rows as never)} ON CONFLICT (task_id, url) DO NOTHING`;
    await tx`UPDATE librarian_tasks SET overview = ${org.overview}, key_concepts = ${tx.json(org.keyConcepts)},
        warnings = ${tx.json(warnings)}, updated_at = now() WHERE id = ${id}`;
    await recordEvent(tx, {
      userId,
      type: "research_completed",
      subject: d.subject,
      activityId: id,
    });
  });
  const domains = [...new Set(rows.map((r) => r.domain as string))].slice(0, 4).join(", ");
  const wantsPlan = type === "create_study_plan" && (d.examDate || d.minutesPerDay);
  await setStatus(sql, id, "completed", {
    completed_at: new Date(),
    reply: `I found ${rows.length} good ${rows.length === 1 ? "source" : "sources"} (from ${domains}).${wantsPlan ? " Now I'll draft your study plan." : " Want a study plan or an interactive lesson from them?"}`,
  });
  if (wantsPlan) await runPlan(sql, userId, id, {});
}

/* ---- Plans ---- */

export async function requestPlan(
  sql: Sql,
  userId: string,
  id: string,
  b: { examDate?: string; minutesPerDay?: number },
  defer: Defer,
): Promise<Outcome<LibrarianTask>> {
  const [t] =
    await sql`SELECT status FROM librarian_tasks WHERE id = ${id} AND user_id = ${userId}`;
  if (!t) return fail(404, "not_found", "No such request.");
  const [count] = await sql`SELECT count(*)::int AS n FROM research_sources WHERE task_id = ${id}`;
  const n = (count?.n as number) ?? 0;
  if (!n) return fail(409, "conflict", "A plan needs some research first.");
  if (BUSY_STATUSES.includes(t.status as TaskStatus))
    return fail(409, "busy", "I'm still working on that.");
  await sql`UPDATE librarian_tasks SET details = details || ${sql.json({ ...b })}::jsonb WHERE id = ${id}`;
  await setStatus(sql, id, "generating_plan", { error_code: null, error_message: null });
  defer(() => runPlan(sql, userId, id, b));
  return { status: 200, body: (await taskView(sql, userId, id))! };
}

const addDays = (day: string, n: number) =>
  new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 864e5)
    .toISOString()
    .slice(0, 10);

async function runPlan(
  sql: Sql,
  userId: string,
  id: string,
  b: { examDate?: string; minutesPerDay?: number },
) {
  try {
    await setStatus(sql, id, "generating_plan");
    const { request, d } = await details(sql, id);
    const today = libraryDay();
    const exam = b.examDate ?? d.examDate ?? null;
    const end = exam && exam >= today && exam <= addDays(today, 60) ? exam : addDays(today, 6);
    const minutes = b.minutesPerDay ?? d.minutesPerDay ?? 45;
    const sources =
      await sql`SELECT url, title, summary FROM research_sources WHERE task_id = ${id} ORDER BY position`;
    const draft = await draftPlan({
      request,
      today,
      endDate: end,
      minutesPerDay: minutes,
      topics: d.topics ?? [],
      confidentTopics: d.confidentTopics ?? [],
      level: d.level ?? "high-school",
      resources: sources.map((s) => ({
        url: s.url as string,
        title: s.title as string,
        summary: s.summary as string,
      })),
    });
    // Validate: dates inside the plan, only researched URLs, sane workloads.
    const known = new Set(sources.map((s) => s.url as string));
    const warnings: string[] = [];
    const days = draft.days.filter((day) => day.date >= today && day.date <= end);
    if (!days.length) throw new Error("plan has no days in range");
    for (const day of days) {
      const total = day.activities.reduce((s, a) => s + a.estimatedMinutes, 0);
      if (total > minutes * 1.25)
        warnings.push(`${day.date} runs to ${total} min, more than your ${minutes} min a day.`);
    }
    if (await cancelled(sql, id)) return;
    const planId = randomUUID();
    await sql.begin(async (tx) => {
      await tx`DELETE FROM study_plans WHERE task_id = ${id}`;
      await tx`INSERT INTO study_plans ${tx({
        id: planId,
        user_id: userId,
        task_id: id,
        title: draft.title,
        goal: draft.goal,
        start_date: today,
        target_date: exam,
        daily_minutes: minutes,
        assumptions: tx.json(draft.assumptions),
        days: tx.json(days.map(({ date, focus, objectives }) => ({ date, focus, objectives }))),
      } as never)}`;
      const items = days.flatMap((day) =>
        day.activities.map((a, position) => ({
          id: randomUUID(),
          study_plan_id: planId,
          user_id: userId,
          scheduled_date: day.date,
          position,
          activity_type: a.type,
          title: a.title,
          description: a.description,
          estimated_minutes: a.estimatedMinutes,
          completion_criteria: tx.json(a.completionCriteria),
          resource_urls: tx.json(a.resourceUrls.filter((u) => known.has(u))),
        })),
      );
      await tx`INSERT INTO study_plan_items ${tx(items as never)}`;
      await tx`UPDATE librarian_tasks SET warnings = warnings || ${tx.json(warnings)}::jsonb WHERE id = ${id}`;
      await recordEvent(tx, {
        userId,
        type: "study_plan_created",
        subject: d.subject,
        activityId: planId,
      });
    });
    await setStatus(sql, id, "completed", {
      completed_at: new Date(),
      reply: `Your plan is ready: ${days.length} days, about ${minutes} minutes each. Tick things off as you go, and I can turn any lesson item into an interactive lesson.`,
    });
  } catch (err) {
    await failTask(sql, id, "plan", err);
  }
}

/* ---- Lessons ---- */

export async function requestLesson(
  sql: Sql,
  userId: string,
  id: string,
  b: { planItemId?: string },
  defer: Defer,
): Promise<Outcome<LibrarianTask>> {
  const [t] =
    await sql`SELECT status FROM librarian_tasks WHERE id = ${id} AND user_id = ${userId}`;
  if (!t) return fail(404, "not_found", "No such request.");
  if (BUSY_STATUSES.includes(t.status as TaskStatus))
    return fail(409, "busy", "I'm still working on that.");
  const [count] = await sql`SELECT count(*)::int AS n FROM research_sources WHERE task_id = ${id}`;
  const n = (count?.n as number) ?? 0;
  if (!n) return fail(409, "conflict", "A lesson needs some research first.");
  await sql`UPDATE librarian_tasks SET details = details || ${sql.json({ planItemId: b.planItemId ?? null })}::jsonb WHERE id = ${id}`;
  await setStatus(sql, id, "generating_lesson", { error_code: null, error_message: null });
  defer(() => runLesson(sql, userId, id, b.planItemId ?? null));
  return { status: 200, body: (await taskView(sql, userId, id))! };
}

const LEVELS: Level[] = ["beginner", "high-school", "university", "advanced"];

async function runLesson(sql: Sql, userId: string, id: string, planItemId: string | null) {
  try {
    const { topic, d } = await details(sql, id);
    let focus = topic;
    if (planItemId) {
      const [it] =
        await sql`SELECT title FROM study_plan_items WHERE id = ${planItemId} AND user_id = ${userId}`;
      if (it) focus = it.title as string;
    }
    const sources = await sql`SELECT title, url, domain, extract FROM research_sources
      WHERE task_id = ${id} ORDER BY position LIMIT 8`;
    // Each source is one "page" for the Learning Studio generator, so its page references
    // point back to the source that supports each scene.
    const pages = sources.map(
      (s) =>
        `Source: ${s.title as string} (${s.domain as string}) ${s.url as string}\n${(s.extract as string).slice(0, 3500)}`,
    );
    const lesson = await generateLesson({
      title: focus,
      level: LEVELS.includes(d.level as Level) ? (d.level as Level) : "high-school",
      length: planItemId ? "short" : "standard",
      pages,
      model: LIBRARIAN_MODEL,
    });
    if (await cancelled(sql, id)) return;
    const lessonSources = sources.map((s, i) => ({
      page: i + 1,
      title: s.title as string,
      url: s.url as string,
      text: pages[i]!,
    }));
    await setStatus(sql, id, "completed", {
      lesson: sql.json(lesson as never),
      lesson_sources: sql.json(lessonSources),
      reply: `Your lesson “${lesson.title}” is ready: ${lesson.scenes.length} scenes, built from the sources I found.`,
    });
  } catch (err) {
    await failTask(sql, id, "lesson", err);
  }
}

/* ---- Polling, cancel, retry ---- */

/** The task as the client polls it: advances deep runs and fails work that has died. */
export async function pollTask(sql: Sql, userId: string, id: string, defer: Defer) {
  const [t] = await sql`SELECT status, mode, updated_at, started_at FROM librarian_tasks
    WHERE id = ${id} AND user_id = ${userId}`;
  if (!t) return null;
  const status = t.status as TaskStatus;
  if (BUSY_STATUSES.includes(status)) {
    const idle = Date.now() - (t.updated_at as Date).getTime();
    const age = Date.now() - ((t.started_at as Date) ?? (t.updated_at as Date)).getTime();
    const deepResearch = t.mode === "deep" && status === "researching";
    if (deepResearch && age < DEEP_LIMIT_MS) await pollDeep(sql, userId, id, defer);
    else if (deepResearch ? age >= DEEP_LIMIT_MS : idle > STALE_MS)
      await failTask(
        sql,
        id,
        status === "generating_plan"
          ? "plan"
          : status === "generating_lesson"
            ? "lesson"
            : "research",
        new TinyFishError("That took too long and was stopped. Try again?", "timeout", 504, true),
      );
  }
  return taskView(sql, userId, id);
}

export async function cancelTask(sql: Sql, userId: string, id: string) {
  const [t] = await sql`UPDATE librarian_tasks SET cancel_requested = true,
      status = CASE WHEN status IN ('completed', 'failed') THEN status ELSE 'cancelled' END,
      reply = CASE WHEN status IN ('completed', 'failed') THEN reply ELSE 'Stopped. Your request is saved if you want to try again.' END,
      updated_at = now()
    WHERE id = ${id} AND user_id = ${userId} RETURNING provider_run_id`;
  if (!t) return null;
  if (t.provider_run_id) await cancelResearch(t.provider_run_id as string);
  return taskView(sql, userId, id);
}

export async function retryTask(
  sql: Sql,
  userId: string,
  id: string,
  defer: Defer,
): Promise<Outcome<LibrarianTask>> {
  const [t] =
    await sql`SELECT status, details FROM librarian_tasks WHERE id = ${id} AND user_id = ${userId}`;
  if (!t) return fail(404, "not_found", "No such request.");
  if (t.status !== "failed" && t.status !== "cancelled")
    return fail(409, "conflict", "Nothing to retry.");
  const d = t.details as Details;
  if (d.failedStep === "plan") return requestPlan(sql, userId, id, {}, defer);
  if (d.failedStep === "lesson")
    return requestLesson(sql, userId, id, { planItemId: d.planItemId ?? undefined }, defer);
  await sql`DELETE FROM research_sources WHERE task_id = ${id}`;
  await sql`UPDATE librarian_tasks SET status = 'awaiting_confirmation', steps = '[]'::jsonb,
      provider_run_id = NULL, error_code = NULL, error_message = NULL WHERE id = ${id}`;
  return confirm(sql, userId, id, undefined, defer);
}

/* ---- Saving, plan items, home ---- */

export async function saveResource(sql: Sql, userId: string, id: string, saved: boolean) {
  return sql.begin(async (tx) => {
    const [r] = await tx`UPDATE research_sources SET saved = ${saved},
        saved_at = CASE WHEN ${saved} THEN now() ELSE NULL END
      WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
    if (!r) return false;
    if (saved) {
      const first =
        await tx`INSERT INTO xp_ledger (user_id, event_id, reason, activity_key, xp_delta, period_key)
        VALUES (${userId}, ${randomUUID()}, 'resource_saved', ${id}, 0, to_char(now() AT TIME ZONE ${TZ}, 'IYYY-"W"IW'))
        ON CONFLICT DO NOTHING RETURNING ledger_id`;
      if (first.length) await recordEvent(tx, { userId, type: "resource_saved", activityId: id });
    }
    return true;
  });
}

export async function planItemAction(
  sql: Sql,
  userId: string,
  id: string,
  b: { action: "complete" | "skip" | "reopen" | "reschedule"; date?: string },
): Promise<Outcome<{ ok: true; xp: number }>> {
  return sql.begin(async (tx): Promise<Outcome<{ ok: true; xp: number }>> => {
    const [it] =
      await tx`SELECT i.status, p.task_id FROM study_plan_items i JOIN study_plans p ON p.id = i.study_plan_id
      WHERE i.id = ${id} AND i.user_id = ${userId} FOR UPDATE OF i`;
    if (!it) return fail(404, "not_found", "No such plan item.");
    if (b.action === "reschedule") {
      if (!b.date || b.date < addDays(libraryDay(), -1) || b.date > addDays(libraryDay(), 365))
        return fail(400, "bad_request", "Pick a date from today on.");
      await tx`UPDATE study_plan_items SET scheduled_date = ${b.date} WHERE id = ${id}`;
      return { status: 200, body: { ok: true, xp: 0 } };
    }
    if (b.action === "skip" || b.action === "reopen") {
      await tx`UPDATE study_plan_items SET status = ${b.action === "skip" ? "skipped" : "todo"}, completed_at = NULL WHERE id = ${id}`;
      return { status: 200, body: { ok: true, xp: 0 } };
    }
    if (it.status === "done") return { status: 200, body: { ok: true, xp: 0 } };
    await tx`UPDATE study_plan_items SET status = 'done', completed_at = now() WHERE id = ${id}`;
    // XP once per item (the ledger key), within the daily cap.
    const [today] = await tx`SELECT count(*)::int AS n FROM xp_ledger WHERE user_id = ${userId}
      AND reason = 'plan_item' AND xp_delta > 0
      AND created_at >= date_trunc('day', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}`;
    const xp = ((today?.n as number) ?? 0) >= DAILY_CAPS.planItems ? 0 : XP.planItemCompleted;
    const claimed =
      await tx`INSERT INTO xp_ledger (user_id, event_id, reason, activity_key, xp_delta, period_key)
      VALUES (${userId}, ${randomUUID()}, 'plan_item', ${id}, ${xp}, to_char(now() AT TIME ZONE ${TZ}, 'IYYY-"W"IW'))
      ON CONFLICT DO NOTHING RETURNING ledger_id`;
    if (!claimed.length) return { status: 200, body: { ok: true, xp: 0 } };
    const [task] = await tx`SELECT details FROM librarian_tasks WHERE id = ${it.task_id as string}`;
    await recordEvent(tx, {
      userId,
      type: "plan_item_completed",
      subject: (task?.details as Details)?.subject,
      activityId: id,
      xp,
    });
    return { status: 200, body: { ok: true, xp } };
  });
}

export async function home(sql: Sql, userId: string | null): Promise<LibrarianHome> {
  const configured = {
    tinyfish: tinyfishConfigured(),
    gemini: !!process.env.GEMINI_API_KEY,
    database: true,
  };
  if (!userId) return { recent: [], saved: [], next: null, insight: null, configured };
  const [recent, saved, next, weak, week] = await Promise.all([
    sql`SELECT id, topic, task_type, status, created_at FROM librarian_tasks WHERE user_id = ${userId}
      ORDER BY created_at DESC LIMIT 8`,
    sql`SELECT * FROM research_sources WHERE user_id = ${userId} AND saved ORDER BY saved_at DESC LIMIT 20`,
    sql`SELECT i.*, p.title AS plan_title, p.task_id FROM study_plan_items i JOIN study_plans p ON p.id = i.study_plan_id
      WHERE i.user_id = ${userId} AND i.status = 'todo' ORDER BY i.scheduled_date, i.position LIMIT 1`,
    sql`SELECT s.name, sum(p.quizzes_first_try)::float / sum(p.quizzes_answered) AS acc, sum(p.quizzes_answered)::int AS n
      FROM learning_progress p JOIN subjects s USING (subject_id) WHERE p.user_id = ${userId}
      GROUP BY s.name HAVING sum(p.quizzes_answered) >= 3 ORDER BY acc ASC LIMIT 1`,
    sql`SELECT coalesce(sum(focus_seconds), 0)::int AS focus, coalesce(sum(sessions_completed), 0)::int AS sessions
      FROM learning_daily WHERE user_id = ${userId}
        AND day >= date_trunc('week', now() AT TIME ZONE ${TZ}) AT TIME ZONE ${TZ}`,
  ]);
  let insight: string | null = null;
  if (weak[0] && (weak[0].acc as number) < 0.7)
    insight = `You get ${weak[0].name as string} checks right first time ${Math.round((weak[0].acc as number) * 100)}% of the time (${weak[0].n as number} answers). Want me to find practice on it?`;
  else if (week[0] && (week[0].sessions as number) > 0) {
    const m = Math.round((week[0].focus as number) / 60);
    insight = `You've focused ${m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`} this week over ${week[0].sessions as number} pomodoro${week[0].sessions === 1 ? "" : "s"}.`;
  }
  return {
    recent: recent.map((r) => ({
      id: r.id as string,
      topic: r.topic as string,
      type: r.task_type as TaskType,
      status: r.status as TaskStatus,
      createdAt: (r.created_at as Date).toISOString(),
    })),
    saved: saved.map(resourceCard),
    next: next[0]
      ? {
          planTitle: next[0].plan_title as string,
          item: planItem(next[0]),
          taskId: next[0].task_id as string,
        }
      : null,
    insight,
    configured,
  };
}
