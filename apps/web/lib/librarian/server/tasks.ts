import "server-only";
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import { isTransient } from "@/lib/ai/gemini";
import { authConfigured } from "@/lib/auth/auth0";
import { labelNotesQuotes } from "@/lib/learning-studio/quizCheck";
import { checkLessonQuiz, generateLesson } from "@/lib/learning-studio/server";
import type { Level } from "@/lib/learning-studio/schema";
import { DAILY_CAPS, LIBRARY_TIME_ZONE as TZ, XP, subjectSlug } from "@/lib/learning/rules";
import { libraryDay } from "@/lib/learning/server/queries";
import {
  enqueueLessonJob,
  getLessonJob,
  loadLesson,
  retryLessonJob,
  workerStatus,
} from "@/lib/jobs/server";
import { BUSY_JOB_STATUSES } from "@/lib/jobs/types";
import { getStorage } from "@/lib/storage";
import type {
  CloudLessonRef,
  LibrarianHome,
  LibrarianTask,
  NotesOutcome,
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
  type LibrarianUser,
  contextForLearner,
  libraryUrls,
  personalHome,
  publicQueries,
} from "./context";
import {
  LIBRARIAN_MODEL,
  type NotesSection,
  type SourceForModel,
  Understanding,
  analyzeNotes,
  draftPlan,
  organize,
  understand,
} from "./gemini";
import {
  type NotesText,
  budgetParts,
  charCount,
  domainOf,
  findLinks,
  listJoin,
  normalizeUrl,
  notesLabel,
  notesParts,
  notesReply,
  pickForGaps,
  readLabel,
} from "./notes";
import { type ResearchHooks, quickResearch, rankHits } from "./research";
import {
  TinyFishError,
  cancelResearch,
  fetchPages,
  getResearch,
  startResearch,
  tinyfishConfigured,
} from "./tinyfish";

export { rankHits };

/**
 * The Librarian's task lifecycle. A request is understood (Gemini), confirmed by the student,
 * researched (TinyFish), organised (Gemini over what TinyFish returned), and can then become a
 * study plan or a lesson (Gemini, through the Learning Studio's own lesson generator and its quiz
 * self-check, checkLessonQuiz). A request can also start from uploaded notes, with no
 * confirmation: Gemini reads them, TinyFish researches what they link to and cover thinly, then
 * the plan and/or lesson follow on their own. Long work runs after the response (`defer`); the
 * client polls the task. Every row is scoped to its
 * learner, and every step the UI shows comes from a provider response. A signed-in student's own
 * saved items and Study Circles reach Gemini only through context.ts (scoped, minimal, read-only).
 */

type Sql = postgres.Sql;
export type Defer = (job: () => Promise<void>) => void;
export type Outcome<T> = { status: number; body: T | { error: { code: string; message: string } } };

const fail = (status: number, code: string, message: string): Outcome<never> => ({
  status,
  body: { error: { code, message } },
});

/** The pipeline's stages for a notes request (where a retry picks up). */
type Stage = "notes" | "research" | "plan" | "lesson";

interface Details extends Partial<Understanding> {
  failedStep?: Stage;
  /** The lesson is with the cloud worker (lib/jobs): its job and what it last reported. */
  cloud?: CloudLessonRef & { planItemId: string | null };
  lastPoll?: number;
  runStatus?: string;
  planItemId?: string | null;
  /* Notes requests only: */
  outcome?: NotesOutcome;
  /** The stage the pipeline last started (a cancelled request resumes there). */
  stage?: Stage;
  /** What Gemini read in the notes. */
  notes?: {
    summary: string;
    outline: NotesSection[];
    keyConcepts: string[];
    gaps: string[];
    links: string[];
  };
  notesWarnings?: string[];
  /** How many activity steps the upload itself added, and how many existed before research. */
  uploadSteps?: number;
  researchFrom?: number;
}

const MAX_SOURCES = 8;
/** Quick research that hasn't moved in this long has died (e.g. the server restarted). */
const STALE_MS = 4 * 60_000;
const DEEP_LIMIT_MS = 50 * 60_000;
/** How much of the notes Gemini reads when working out what they cover. */
const ANALYSIS_BUDGET = 40_000;
/** How much of the notes goes into a lesson (the web sources come after, about 14,000 more). */
const LESSON_NOTES_BUDGET = 30_000;

/** Models sometimes write "null" or "unknown" where they mean nothing. */
export const realValue = (v: string | null | undefined) =>
  v && !/^(null|none|n\/a|unknown|unspecified|-)?$/i.test(v.trim()) ? v.trim() : null;

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

/** Moves running work on to `status`, unless the student has cancelled it (then false). */
async function advance(
  sql: Sql,
  id: string,
  status: TaskStatus,
  extra: Record<string, unknown> = {},
) {
  const fields = { status, ...extra };
  const r =
    await sql`UPDATE librarian_tasks SET ${sql(fields as Record<string, postgres.ParameterOrJSON<never>>)}, updated_at = now()
    WHERE id = ${id} AND NOT cancel_requested RETURNING id`;
  return r.length > 0;
}

async function patchDetails(sql: Sql, id: string, patch: Details) {
  await sql`UPDATE librarian_tasks SET details = details || ${sql.json(patch as never)}::jsonb, updated_at = now()
    WHERE id = ${id}`;
}

/** Drops the activity steps after the first `n` (a retry re-runs them). */
async function keepSteps(sql: Sql, id: string, n: number) {
  await sql`UPDATE librarian_tasks SET steps = (
      SELECT coalesce(jsonb_agg(s.e ORDER BY s.i), '[]'::jsonb)
      FROM jsonb_array_elements(steps) WITH ORDINALITY AS s(e, i) WHERE s.i <= ${n})
    WHERE id = ${id}`;
}

async function loadNotes(sql: Sql, id: string): Promise<NotesText[]> {
  const rows =
    await sql`SELECT file_name, pages FROM librarian_notes WHERE task_id = ${id} ORDER BY position`;
  return rows.map((r) => ({ name: r.file_name as string, pages: r.pages as string[] }));
}

async function failTask(sql: Sql, id: string, step: Details["failedStep"], err: unknown) {
  const tf = err instanceof TinyFishError ? err : null;
  // Gemini overloaded, rate-limited or timing out (both models): say so, it's worth a retry.
  const busy = !tf && isTransient(err);
  const code = tf?.code ?? (busy ? "ai_busy" : "failed");
  const message =
    tf?.message ??
    (busy
      ? "The library is very busy right now, so I couldn't finish. Try again in a minute: nothing is lost."
      : null) ??
    (step === "notes"
      ? "I couldn't read your notes this time. They're saved, so try again?"
      : step === "research"
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
  const [sources, plans, notes] = await Promise.all([
    sql`SELECT * FROM research_sources WHERE task_id = ${id} ORDER BY position`,
    sql`SELECT * FROM study_plans WHERE task_id = ${id}`,
    sql`SELECT file_name, jsonb_array_length(pages)::int AS pages, char_count FROM librarian_notes
      WHERE task_id = ${id} ORDER BY position`,
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
    notes: notes.map((n) => ({
      name: n.file_name as string,
      pages: n.pages as number,
      chars: n.char_count as number,
    })),
    outcome: t.task_type === "study_from_notes" ? ((t.details as Details).outcome ?? null) : null,
    cloudLesson: (() => {
      const c = (t.details as Details).cloud;
      return c ? { jobId: c.jobId, status: c.status, progress: c.progress, audio: c.audio } : null;
    })(),
    error: t.error_code
      ? {
          code: t.error_code as string,
          message: t.error_message as string,
          retryable: status === "failed" && t.error_code !== "not_configured",
        }
      : null,
    attribution: {
      research: t.mode === "deep" ? "deep research" : "quick research",
      synthesis: "the Librarian",
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

const WORD = /[a-z0-9']+/g;
const STOP = new Set(
  "a an and are as at be but by for from i i'll in is it its me my of on or so that the their them they this to we will with you your yours".split(
    " ",
  ),
);
const words = (s: string) =>
  new Set((s.toLowerCase().match(WORD) ?? []).filter((w) => !STOP.has(w)));

/**
 * Her note about their library, then what she'll do next, without saying the same thing twice:
 * a sentence of the second part that mostly repeats the note (by shared words) is dropped.
 */
export function joinReply(note: string | null | undefined, rest: string | null | undefined) {
  const n = note?.trim() ?? "";
  const r = rest?.trim() ?? "";
  if (!n || !r) return n || r;
  const said = words(n);
  const sentences = r.match(/[^.!?]+[.!?]*\s*/g) ?? [r];
  const kept = sentences.filter((s) => {
    const w = words(s);
    if (w.size === 0) return true;
    let shared = 0;
    for (const x of w) if (said.has(x)) shared++;
    return shared / w.size < 0.6;
  });
  return [n, kept.join("").trim()].filter(Boolean).join(" ");
}

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
  const library = await contextForLearner(sql, userId, request);
  const understood = await understand(request, libraryDay(), library);
  // Her searches go to the public web: nothing copied from the student's library goes with them
  // (with every query dropped, the topic or else the subject is searched, if that's clean).
  const queries = publicQueries(understood.searchQueries, library, request);
  const fallback = publicQueries(
    [understood.topic, understood.subject].filter((q) => q.trim().length >= 3),
    library,
    request,
  ).slice(0, 1);
  const u = { ...understood, searchQueries: queries.length ? queries : fallback };
  const declined = u.declined;
  // Answered straight from their own library (or only asked for something that isn't theirs):
  // nothing to research, so she just says it, with no "Shall I begin?".
  const answered = !declined && !u.questions.length && !u.needsResearch && !!u.libraryNote;
  const status: TaskStatus =
    declined || answered
      ? "completed"
      : u.questions.length
        ? "awaiting_details"
        : "awaiting_confirmation";
  // What she says about their own library (or that something isn't available) comes first. It's
  // only words: nothing she says here saves, shares or opens anything.
  const reply =
    declined ??
    (answered
      ? u.libraryNote!
      : joinReply(u.libraryNote, u.questions.length ? u.questions.join(" ") : u.confirmation));
  const fields = {
    task_type: u.taskType,
    status,
    user_request: request,
    topic: u.topic,
    details: sql.json(u as never),
    mode: b.mode ?? "quick",
    reply,
    questions: sql.json(declined ? [] : u.questions),
    confirmation: declined || answered || u.questions.length ? null : u.confirmation,
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

/** TinyFish research for a Librarian request: steps go to its activity list, a cancel stops it. */
const taskHooks = (sql: Sql, id: string): ResearchHooks => ({
  step: (step) => addStep(sql, id, step),
  cancelled: () => cancelled(sql, id),
});

/** Quick research: TinyFish searches the web, then reads the most promising pages. */
async function runQuick(sql: Sql, userId: string, id: string) {
  try {
    await setStatus(sql, id, "researching");
    const { d, topic } = await details(sql, id);
    const sources = await quickResearch(taskHooks(sql, id), {
      queries: d.searchQueries?.length ? d.searchQueries : [topic],
    });
    if (sources) await organizeAndSave(sql, userId, id, sources);
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
    await addStep(sql, id, { kind: "status", label: "Deep research started" });
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
      label: `Deep research: ${run.status.toLowerCase().replace("_", " ")}`,
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
        `The deep research run ${run.status === "FAILED" ? "failed" : "timed out"}.`,
        run.status.toLowerCase(),
        502,
        true,
      ),
    );
  else if (run.status === "CANCELLED") await setStatus(sql, id, "cancelled");
}

/**
 * Gemini organises what TinyFish read into resource cards (dropping weak pages), then saves them.
 * A notes request carries on even with no good web sources (it still has the notes): it returns
 * what was saved for the pipeline to continue, instead of completing the task. Null = stopped.
 */
async function organizeAndSave(
  sql: Sql,
  userId: string,
  id: string,
  sources: SourceForModel[],
  report?: string | null,
): Promise<{ saved: number; domains: string } | null> {
  await setStatus(sql, id, "organizing_results");
  const { request, topic, type, d } = await details(sql, id);
  const fromNotes = type === "study_from_notes";
  if (!sources.length && !fromNotes)
    throw new TinyFishError("No pages could be read.", "no_sources", 404, true);
  const org = sources.length
    ? await organize({
        request: report
          ? `${request}\n(The research report, untrusted: ${report.slice(0, 2000)})`
          : request,
        topic,
        level: d.level ?? "high-school",
        sources,
        notes: fromNotes ? d.notes : undefined,
        library: await contextForLearner(sql, userId, request),
      })
    : { overview: d.notes?.summary ?? "", keyConcepts: [], resources: [], warnings: [] };
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
  if (await cancelled(sql, id)) return null;
  if (!rows.length && !fromNotes) {
    await sql`UPDATE librarian_tasks SET status = 'failed', error_code = 'no_sources',
        error_message = ${"I couldn't find enough reliable material on that. Want me to try a broader or a narrower topic?"},
        details = details || ${sql.json({ failedStep: "research" })}::jsonb, updated_at = now() WHERE id = ${id}`;
    return null;
  }
  const warnings = [...org.warnings];
  const snippets = kept.filter((r) => sources[r.source - 1]?.snippetOnly).length;
  if (snippets)
    warnings.push(
      `${snippets} of these ${snippets === 1 ? "is" : "are"} judged from the search result only: ${snippets === 1 ? "its site doesn't" : "their sites don't"} allow automated reading, so open ${snippets === 1 ? "it" : "them"} to check.`,
    );
  if (!rows.length)
    warnings.unshift(
      "I didn't find reliable web sources for these notes, so what follows is built from your notes alone.",
    );
  else if (rows.length < 3)
    warnings.unshift("Only a few reliable sources turned up, so treat this as a starting point.");
  if (fromNotes) warnings.push(...(d.notesWarnings ?? []));
  // From notes, the notes' own key ideas come first.
  const keyConcepts = fromNotes
    ? [
        ...new Map(
          [...(d.notes?.keyConcepts ?? []), ...org.keyConcepts].map((k) => [k.toLowerCase(), k]),
        ).values(),
      ].slice(0, 8)
    : org.keyConcepts;
  // With no good web sources, a notes request's overview is what Gemini read in the notes.
  const overview = fromNotes && !rows.length ? (d.notes?.summary ?? org.overview) : org.overview;
  await sql.begin(async (tx) => {
    if (rows.length)
      await tx`INSERT INTO research_sources ${tx(rows as never)} ON CONFLICT (task_id, url) DO NOTHING`;
    await tx`UPDATE librarian_tasks SET overview = ${overview}, key_concepts = ${tx.json(keyConcepts)},
        warnings = ${tx.json(warnings)}, updated_at = now() WHERE id = ${id}`;
    if (rows.length)
      await recordEvent(tx, {
        userId,
        type: "research_completed",
        subject: d.subject,
        activityId: id,
      });
  });
  const domains = [...new Set(rows.map((r) => r.domain as string))].slice(0, 4).join(", ");
  if (fromNotes) return { saved: rows.length, domains };
  const wantsPlan = type === "create_study_plan" && (d.examDate || d.minutesPerDay);
  await setStatus(sql, id, "completed", {
    completed_at: new Date(),
    reply: `I found ${rows.length} good ${rows.length === 1 ? "source" : "sources"} (from ${domains}).${wantsPlan ? " Now I'll draft your study plan." : " Want a study plan or an interactive lesson from them?"}`,
  });
  if (wantsPlan) await runPlan(sql, userId, id, {});
  return { saved: rows.length, domains };
}

/* ---- Studying from uploaded notes ---- */

/**
 * A request from uploaded notes (already checked and turned into text by the route). It starts
 * at once, with no confirmation: uploading and choosing the outcome is the go-ahead.
 */
export async function startFromNotes(
  sql: Sql,
  userId: string,
  b: {
    files: NotesText[];
    message?: string;
    outcome: NotesOutcome;
    examDate?: string;
    minutesPerDay?: number;
    /** The upload was over the stored-text cap, so only its start was kept. */
    truncated?: boolean;
  },
  defer: Defer,
): Promise<Outcome<LibrarianTask>> {
  if (!tinyfishConfigured())
    return fail(
      503,
      "not_configured",
      "Studying from notes needs TINYFISH_API_KEY (see docs/ai-librarian.md).",
    );
  if (!process.env.GEMINI_API_KEY)
    return fail(503, "not_configured", "Studying from notes needs GEMINI_API_KEY.");
  const id = randomUUID();
  const names = b.files.map((f) => f.name);
  const at = new Date().toISOString();
  const steps: ResearchStep[] = b.files.map((f) => ({ at, kind: "note", label: readLabel(f) }));
  const notesWarnings: string[] = [];
  if (b.truncated) {
    steps.push({ at, kind: "note", label: "Your notes are long, so only their start is used" });
    notesWarnings.push(
      "Your notes were long, so only about the first 200,000 characters (shared between the files) were used.",
    );
  }
  const d: Details = {
    outcome: b.outcome,
    stage: "notes",
    notesWarnings,
    uploadSteps: steps.length,
    ...(b.examDate && { examDate: b.examDate }),
    ...(b.minutesPerDay && { minutesPerDay: b.minutesPerDay }),
  };
  await sql.begin(async (tx) => {
    await tx`INSERT INTO librarian_tasks ${tx({
      id,
      user_id: userId,
      task_type: "study_from_notes",
      status: "reading_notes",
      user_request: (b.message?.trim() || `Study from my notes: ${names.join(", ")}`).slice(
        0,
        4000,
      ),
      topic: names[0]!.replace(/\.[^.]+$/, "").slice(0, 120),
      details: tx.json(d as never),
      mode: "quick",
      reply: `I'm reading ${listJoin(names)} now.`,
      steps: tx.json(steps as never),
      started_at: new Date(),
    } as never)}`;
    await tx`INSERT INTO librarian_notes ${tx(
      b.files.map((f, position) => ({
        id: randomUUID(),
        task_id: id,
        user_id: userId,
        file_name: f.name,
        position,
        pages: tx.json(f.pages),
        char_count: charCount(f.pages),
      })) as never,
    )}`;
  });
  defer(() => runNotes(sql, userId, id));
  return { status: 200, body: (await taskView(sql, userId, id))! };
}

/**
 * The notes pipeline: Gemini reads the notes → TinyFish opens their links and searches for what
 * they cover thinly → Gemini checks the sources → the plan and/or lesson, per the outcome.
 * `reuseReading` skips straight to the research (a retry after the research failed).
 */
async function runNotes(sql: Sql, userId: string, id: string, reuseReading = false) {
  let stage: Stage = "notes";
  try {
    const { request, ...task } = await details(sql, id);
    let { d, topic } = task;
    if (!reuseReading || !d.notes) {
      if (!(await advance(sql, id, "reading_notes"))) return;
      const files = await loadNotes(sql, id);
      const { parts } = budgetParts(notesParts(files), ANALYSIS_BUDGET);
      const a = await analyzeNotes({
        request,
        files: files.map((f) => f.name),
        parts,
        today: libraryDay(),
      });
      if (await cancelled(sql, id)) return;
      topic = a.topic || topic;
      await addStep(sql, id, {
        kind: "note",
        label: `Read your notes on ${topic}: ${a.outline.length} ${a.outline.length === 1 ? "section" : "sections"}${a.gaps.length ? `, ${a.gaps.length} thin ${a.gaps.length === 1 ? "spot" : "spots"} to look up` : ""}`,
      });
      if (a.declined) {
        await advance(sql, id, "completed", { topic, reply: a.declined, completed_at: new Date() });
        return;
      }
      const links = findLinks(files.flatMap((f) => f.pages).join("\n"));
      d = {
        ...d,
        subject: a.subject,
        level: a.level,
        topics: a.outline.map((s) => s.heading).slice(0, 8),
        confidentTopics: a.confidentTopics,
        examDate: d.examDate ?? a.examDate,
        minutesPerDay: d.minutesPerDay ?? a.minutesPerDay,
        searchQueries: a.searchQueries.length ? a.searchQueries : [topic],
        notes: {
          summary: a.summary,
          outline: a.outline,
          keyConcepts: a.keyConcepts,
          gaps: a.gaps,
          links: links.links,
        },
      };
      await patchDetails(sql, id, d);
      if (links.found)
        await addStep(sql, id, {
          kind: "note",
          label: `Found ${links.found} ${links.found === 1 ? "link" : "links"} in your notes${links.found > links.links.length ? `; I'll open the first ${links.links.length}` : ""}`,
        });
      if (links.blocked)
        await addStep(sql, id, {
          kind: "note",
          label: `Skipped ${links.blocked} ${links.blocked === 1 ? "link" : "links"} to answer-sharing or social sites`,
        });
      await sql`UPDATE librarian_tasks SET topic = ${topic},
          reply = ${notesReply({ topic, outline: a.outline, gaps: a.gaps }, links.links.length)},
          updated_at = now() WHERE id = ${id}`;
    }
    stage = "research";
    const started =
      await sql`UPDATE librarian_tasks SET status = 'researching', details = details ||
        jsonb_build_object('stage', 'research', 'researchFrom', jsonb_array_length(steps)), updated_at = now()
      WHERE id = ${id} AND NOT cancel_requested RETURNING id`;
    if (!started.length) return;
    let sources: SourceForModel[] | null;
    try {
      sources = await quickResearch(taskHooks(sql, id), {
        queries: d.searchQueries?.length ? d.searchQueries : [topic],
        links: d.notes?.links ?? [],
      });
    } catch (err) {
      // Nothing usable on the web isn't fatal here: the notes are still there.
      if (!(err instanceof TinyFishError && err.code === "no_sources")) throw err;
      sources = [];
    }
    if (!sources) return;
    const found = await organizeAndSave(sql, userId, id, sources);
    if (!found) return;
    const lead = found.saved
      ? `I found ${found.saved} good ${found.saved === 1 ? "source" : "sources"} to go with your notes (from ${found.domains}).`
      : "I didn't find reliable web sources on this, so I'll work from your notes alone.";
    const outcome = d.outcome ?? "both";
    if (outcome === "lesson") {
      await patchDetails(sql, id, { stage: "lesson", planItemId: null });
      const go = await advance(sql, id, "generating_lesson", {
        reply: `${lead} Now I'm building your lesson.`,
      });
      if (go) await runLesson(sql, userId, id, null);
    } else {
      await patchDetails(sql, id, { stage: "plan" });
      const go = await advance(sql, id, "generating_plan", {
        reply: `${lead} Now I'm writing your study plan${outcome === "both" ? ", then your lesson" : ""}.`,
      });
      if (go) await runPlan(sql, userId, id, {}, outcome === "both");
    }
  } catch (err) {
    await failTask(sql, id, stage, err);
  }
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
  const n = await materialCount(sql, id);
  if (!n) return fail(409, "conflict", "A plan needs some research first.");
  if (BUSY_STATUSES.includes(t.status as TaskStatus))
    return fail(409, "busy", "I'm still working on that.");
  await sql`UPDATE librarian_tasks SET details = details || ${sql.json({ ...b })}::jsonb WHERE id = ${id}`;
  await setStatus(sql, id, "generating_plan", {
    error_code: null,
    error_message: null,
    cancel_requested: false,
  });
  defer(() => runPlan(sql, userId, id, b));
  return { status: 200, body: (await taskView(sql, userId, id))! };
}

/** What a plan or lesson can be built from: researched sources, plus uploaded notes. */
async function materialCount(sql: Sql, id: string) {
  const [r] = await sql`SELECT
      (SELECT count(*) FROM research_sources WHERE task_id = ${id})::int +
      (SELECT count(*) FROM librarian_notes WHERE task_id = ${id})::int AS n`;
  return (r?.n as number) ?? 0;
}

const addDays = (day: string, n: number) =>
  new Date(Date.UTC(+day.slice(0, 4), +day.slice(5, 7) - 1, +day.slice(8, 10)) + n * 864e5)
    .toISOString()
    .slice(0, 10);

/** Drafts and saves the plan. `thenLesson` (a notes request that asked for both) goes on to the lesson. */
async function runPlan(
  sql: Sql,
  userId: string,
  id: string,
  b: { examDate?: string; minutesPerDay?: number },
  thenLesson = false,
) {
  let lessonNext = false;
  try {
    await setStatus(sql, id, "generating_plan");
    const { request, type, d } = await details(sql, id);
    const today = libraryDay();
    const exam = b.examDate ?? d.examDate ?? null;
    const end = exam && exam >= today && exam <= addDays(today, 60) ? exam : addDays(today, 6);
    const minutes = b.minutesPerDay ?? d.minutesPerDay ?? 45;
    const sources =
      await sql`SELECT url, title, summary FROM research_sources WHERE task_id = ${id} ORDER BY position`;
    const fromNotes = type === "study_from_notes" && d.notes;
    const library = await contextForLearner(sql, userId, request);
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
      notes: fromNotes
        ? { files: (await loadNotes(sql, id)).map((f) => f.name), outline: d.notes!.outline }
        : undefined,
      library,
    });
    // Validate: dates inside the plan, only researched URLs (or the student's own items it was
    // shown, which context.ts already scoped to them), sane workloads.
    const known = new Set([...sources.map((s) => s.url as string), ...libraryUrls(library)]);
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
    const ready = `Your plan is ready: ${days.length} days, about ${minutes} minutes each.`;
    if (thenLesson) {
      await patchDetails(sql, id, { stage: "lesson", planItemId: null });
      lessonNext = await advance(sql, id, "generating_lesson", {
        reply: `${ready} Now I'm building your lesson.`,
      });
    } else
      await setStatus(sql, id, "completed", {
        completed_at: new Date(),
        reply: `${ready} Tick things off as you go, and I can turn any lesson item into an interactive lesson.`,
      });
  } catch (err) {
    await failTask(sql, id, "plan", err);
  }
  if (lessonNext) await runLesson(sql, userId, id, null);
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
  const n = await materialCount(sql, id);
  if (!n) return fail(409, "conflict", "A lesson needs some research first.");
  await sql`UPDATE librarian_tasks SET details = details || ${sql.json({ planItemId: b.planItemId ?? null })}::jsonb WHERE id = ${id}`;
  await setStatus(sql, id, "generating_lesson", {
    error_code: null,
    error_message: null,
    cancel_requested: false,
  });
  // With the cloud worker online the lesson goes to its queue, so the student can leave; without
  // it, it's made here after the response, as before.
  if (!(await queueCloudLesson(sql, userId, id, b.planItemId ?? null)))
    defer(() => runLesson(sql, userId, id, b.planItemId ?? null));
  return { status: 200, body: (await taskView(sql, userId, id))! };
}

/**
 * Hands the lesson to the library's cloud worker (lib/jobs: a separate process on the Vultr
 * server, which builds it from this request's sources, records the narration and stores the
 * files) when a worker is online. A failed cloud lesson for the same plan item is retried, so it
 * resumes from its checkpoint. Lessons from notes stay in-request: they're built from the notes'
 * own pages, which the worker doesn't read. Returns the job id, or null to make it here instead.
 */
async function queueCloudLesson(
  sql: Sql,
  userId: string,
  id: string,
  planItemId: string | null,
): Promise<string | null> {
  let jobId: string | null = null;
  try {
    const { topic, request, type, d } = await details(sql, id);
    if (type !== "study_from_notes" && (await workerStatus(sql)).online) {
      let focus = realValue(topic) ?? request;
      if (planItemId) {
        const [it] =
          await sql`SELECT title FROM study_plan_items WHERE id = ${planItemId} AND user_id = ${userId}`;
        if (it) focus = it.title as string;
      }
      const before = d.cloud?.planItemId === planItemId ? d.cloud.jobId : null;
      const retried = before ? await retryLessonJob(sql, userId, before) : null;
      const out = retried?.ok
        ? retried
        : await enqueueLessonJob(sql, userId, {
            topic: focus.trim().slice(0, 200),
            level: LEVELS.includes(d.level as Level) ? d.level : "high-school",
            length: planItemId ? "short" : "standard",
            taskId: id,
          });
      if (out.ok) {
        jobId = out.body.id;
        await patchDetails(sql, id, {
          cloud: {
            jobId,
            planItemId,
            status: out.body.status,
            progress: out.body.progress,
            audio: [],
          },
        });
      } else console.info(`[librarian] lesson made here, not queued: ${out.code}`);
    }
  } catch (err) {
    console.error("[librarian] queueing the cloud lesson", err);
    jobId = null;
  }
  if (!jobId) await sql`UPDATE librarian_tasks SET details = details - 'cloud' WHERE id = ${id}`;
  return jobId;
}

/**
 * A cloud lesson's news for its request, read when the request is polled: the worker's progress,
 * then the finished lesson (from storage, with its narration's scenes) or the failure.
 */
async function syncCloudLesson(
  sql: Sql,
  userId: string,
  id: string,
  cloud: NonNullable<Details["cloud"]>,
) {
  const job = await getLessonJob(sql, userId, cloud.jobId);
  if (!job) return failTask(sql, id, "lesson", new Error("the cloud lesson job is gone"));
  const v = job.view;
  const next = {
    ...cloud,
    status: v.status,
    progress: v.progress,
    audio: v.audio.map((a) => a.scene),
  };
  if (v.status === "failed") {
    await patchDetails(sql, id, { cloud: next });
    return failTask(sql, id, "lesson", new Error(`cloud lesson failed: ${v.error?.message}`));
  }
  if (v.status !== "completed") {
    if (v.status !== cloud.status || v.progress !== cloud.progress)
      await patchDetails(sql, id, { cloud: next });
    return;
  }
  const lesson = await loadLesson(getStorage(), v.id);
  if (!lesson) return failTask(sql, id, "lesson", new Error("the cloud lesson isn't in storage"));
  // Page N = source N, as the worker numbered them for Gemini.
  const read = job.row.checkpoint?.research?.sources ?? [];
  const lessonSources = read.length
    ? read.map((s, i) => ({
        page: i + 1,
        title: s.title,
        url: s.url,
        text: `Source: ${s.title} (${s.domain}) ${s.url}\n${s.text}`.slice(0, 4000),
      }))
    : v.sources.map((s, i) => ({ page: i + 1, title: s.title, url: s.url, text: s.title }));
  await patchDetails(sql, id, { cloud: next });
  await setStatus(sql, id, "completed", {
    lesson: sql.json(lesson as never),
    lesson_sources: sql.json(lessonSources),
    reply: `Your lesson “${lesson.title}” is ready: ${lesson.scenes.length} scenes, made in the library's cloud${narrated(v.audio.length, lesson.scenes.length)}.`,
  });
}

/** The end of the Librarian's "lesson ready" line: how much of it has recorded narration. */
function narrated(clips: number, scenes: number): string {
  if (!clips) return "";
  if (clips >= scenes) return " with its narration recorded";
  return ` with narration recorded for ${clips} of ${scenes} scenes (your browser reads the rest)`;
}

const LEVELS: Level[] = ["beginner", "high-school", "university", "advanced"];

async function runLesson(sql: Sql, userId: string, id: string, planItemId: string | null) {
  try {
    const { topic, type, d } = await details(sql, id);
    let focus = topic;
    if (planItemId) {
      const [it] =
        await sql`SELECT title FROM study_plan_items WHERE id = ${planItemId} AND user_id = ${userId}`;
      if (it) focus = it.title as string;
    }
    // From notes: the student's own pages come first (in order, within budget), then the best
    // web sources, so the lesson is grounded in their notes plus the research.
    const fromNotes = type === "study_from_notes";
    const notes = fromNotes ? await loadNotes(sql, id) : [];
    const all = notesParts(notes);
    const { parts, sampled } = budgetParts(all, LESSON_NOTES_BUDGET);
    const researched = await sql`SELECT title, url, domain, extract FROM research_sources
      WHERE task_id = ${id} ORDER BY position LIMIT 8`;
    // From notes, the 4 web pages that say most about what the notes cover thinly.
    const gaps = d.notes?.gaps ?? [];
    const sources = fromNotes
      ? pickForGaps(
          researched.map((s) => `${s.title as string} ${s.extract as string}`),
          gaps,
          4,
        ).map((i) => researched[i]!)
      : researched;
    // Each source is one "page" for the Learning Studio generator, so its page references
    // point back to the source that supports each scene. Naming the notes' thin spots (in the
    // web pages' headers, and in the title when it stays short: lesson titles are capped at 100)
    // makes the lesson teach them from the web pages too, instead of only retelling the notes.
    const thin = fromNotes && !planItemId ? listJoin(gaps.slice(0, 3)) : "";
    const notePages = parts.map((p) => `${notesLabel(p)}\n${p.text}`);
    const webPages = sources.map(
      (s) =>
        `${fromNotes ? `Source found on the web for what the notes cover thinly${thin ? ` (${thin})` : ""}` : "Source"}: ${s.title as string} (${s.domain as string}) ${s.url as string}\n${(s.extract as string).slice(0, 3500)}`,
    );
    const pages = [...notePages, ...webPages];
    if (!pages.length) throw new Error("nothing to build a lesson from");
    const first = notePages.length + 1;
    const last = notePages.length + webPages.length;
    const drafted = await generateLesson({
      title: focus,
      guidance:
        fromNotes && webPages.length
          ? `Pages 1–${notePages.length} are the student's notes; pages ${first}–${last} are web sources found for what the notes cover thinly${thin ? ` (${thin})` : ""}. Teach those thin spots from the web pages, and cite them: at least ${Math.min(2, webPages.length)} scenes must list a web page (${first}–${last}) in sourceReferences, alongside the notes pages they build on.`
          : undefined,
      level: LEVELS.includes(d.level as Level) ? (d.level as Level) : "high-school",
      length: planItemId ? "short" : "standard",
      pages,
      model: LIBRARIAN_MODEL,
    });
    if (await cancelled(sql, id)) return;
    // The same quiz self-check as the Learning Studio and cloud lessons: one more call that
    // re-answers the questions from these pages alone; it never throws (the quiz ships as
    // written if it can't run).
    const checked = await checkLessonQuiz(drafted, pages, { from: "sources" });
    // A quote from the student's own notes reads "From your notes", not "From the sources".
    const lesson = fromNotes ? labelNotesQuotes(checked, notePages, webPages.length) : checked;
    if (await cancelled(sql, id)) return;
    const lessonSources = [
      ...parts.map((p, i) => ({ page: i + 1, title: notesLabel(p), url: "", text: notePages[i]! })),
      ...sources.map((s, i) => ({
        page: notePages.length + i + 1,
        title: s.title as string,
        url: s.url as string,
        text: webPages[i]!,
      })),
    ];
    let reply = `Your lesson “${lesson.title}” is ready: ${lesson.scenes.length} scenes, built from the sources I found.`;
    if (fromNotes) {
      const web = sources.length
        ? ` and ${sources.length} web ${sources.length === 1 ? "source" : "sources"}`
        : "";
      const [plan] =
        await sql`SELECT jsonb_array_length(days)::int AS days FROM study_plans WHERE task_id = ${id}`;
      reply =
        plan && d.outcome === "both" && !planItemId
          ? `Your ${plan.days as number}-day study plan and your lesson “${lesson.title}” (${lesson.scenes.length} scenes) are ready, built from your notes${web}.`
          : `Your lesson “${lesson.title}” is ready: ${lesson.scenes.length} scenes, built from your notes${web}.`;
      if (sampled) {
        const pagesOf = (xs: typeof all) => new Set(xs.map((p) => `${p.file}#${p.page}`)).size;
        const note = sql.json([
          `Your notes are long, so the lesson draws on ${pagesOf(parts)} of their ${pagesOf(all)} pages, spread through them.`,
        ]);
        await sql`UPDATE librarian_tasks SET warnings = CASE WHEN warnings @> ${note}::jsonb
            THEN warnings ELSE warnings || ${note}::jsonb END WHERE id = ${id}`;
      }
    }
    await setStatus(sql, id, "completed", {
      lesson: sql.json(lesson as never),
      lesson_sources: sql.json(lessonSources),
      reply,
      ...(fromNotes && { completed_at: new Date() }),
    });
  } catch (err) {
    await failTask(sql, id, "lesson", err);
  }
}

/* ---- Polling, cancel, retry ---- */

/** The task as the client polls it: advances deep runs and fails work that has died. */
export async function pollTask(sql: Sql, userId: string, id: string, defer: Defer) {
  const [t] = await sql`SELECT status, mode, updated_at, started_at, details FROM librarian_tasks
    WHERE id = ${id} AND user_id = ${userId}`;
  if (!t) return null;
  const status = t.status as TaskStatus;
  // A cloud lesson isn't stale while the worker has it: its job says how it's going.
  const cloud = (t.details as Details).cloud;
  if (status === "generating_lesson" && cloud && BUSY_JOB_STATUSES.includes(cloud.status))
    await syncCloudLesson(sql, userId, id, cloud);
  else if (BUSY_STATUSES.includes(status)) {
    const idle = Date.now() - (t.updated_at as Date).getTime();
    const age = Date.now() - ((t.started_at as Date) ?? (t.updated_at as Date)).getTime();
    const deepResearch = t.mode === "deep" && status === "researching";
    if (deepResearch && age < DEEP_LIMIT_MS) await pollDeep(sql, userId, id, defer);
    else if (deepResearch ? age >= DEEP_LIMIT_MS : idle > STALE_MS)
      await failTask(
        sql,
        id,
        status === "reading_notes"
          ? "notes"
          : status === "generating_plan"
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
    await sql`SELECT status, details, task_type FROM librarian_tasks WHERE id = ${id} AND user_id = ${userId}`;
  if (!t) return fail(404, "not_found", "No such request.");
  if (t.status !== "failed" && t.status !== "cancelled")
    return fail(409, "conflict", "Nothing to retry.");
  const d = t.details as Details;
  if (t.task_type === "study_from_notes") return retryNotes(sql, userId, id, d, defer);
  if (d.failedStep === "plan") return requestPlan(sql, userId, id, {}, defer);
  if (d.failedStep === "lesson")
    return requestLesson(sql, userId, id, { planItemId: d.planItemId ?? undefined }, defer);
  await sql`DELETE FROM research_sources WHERE task_id = ${id}`;
  await sql`UPDATE librarian_tasks SET status = 'awaiting_confirmation', steps = '[]'::jsonb,
      provider_run_id = NULL, error_code = NULL, error_message = NULL WHERE id = ${id}`;
  return confirm(sql, userId, id, undefined, defer);
}

/**
 * Picks a failed or cancelled notes request up where it stopped: the reading of the notes, the
 * research, the plan (then the lesson, if both were asked for) or the lesson.
 */
async function retryNotes(
  sql: Sql,
  userId: string,
  id: string,
  d: Details,
  defer: Defer,
): Promise<Outcome<LibrarianTask>> {
  if (!tinyfishConfigured() || !process.env.GEMINI_API_KEY)
    return fail(
      503,
      "not_configured",
      "Studying from notes needs TINYFISH_API_KEY and GEMINI_API_KEY (see docs/ai-librarian.md).",
    );
  let from: Stage = d.failedStep ?? d.stage ?? "notes";
  if (from === "research" && !d.notes) from = "notes";
  await sql`UPDATE librarian_tasks SET cancel_requested = false, error_code = NULL, error_message = NULL,
      details = details - 'failedStep', updated_at = now() WHERE id = ${id}`;
  if (from === "notes" || from === "research") {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM research_sources WHERE task_id = ${id}`;
      await tx`DELETE FROM study_plans WHERE task_id = ${id}`;
      await tx`UPDATE librarian_tasks SET lesson = NULL, lesson_sources = '[]'::jsonb, overview = NULL,
          key_concepts = '[]'::jsonb, warnings = '[]'::jsonb, completed_at = NULL,
          status = ${from === "notes" ? "reading_notes" : "researching"}, started_at = now()
        WHERE id = ${id}`;
    });
    await keepSteps(
      sql,
      id,
      from === "notes" ? (d.uploadSteps ?? 0) : (d.researchFrom ?? d.uploadSteps ?? 0),
    );
    defer(() => runNotes(sql, userId, id, from === "research"));
  } else if (from === "plan") {
    const [have] =
      await sql`SELECT lesson IS NOT NULL AS lesson FROM librarian_tasks WHERE id = ${id}`;
    await setStatus(sql, id, "generating_plan");
    defer(() => runPlan(sql, userId, id, {}, d.outcome === "both" && !have?.lesson));
  } else {
    await setStatus(sql, id, "generating_lesson");
    defer(() => runLesson(sql, userId, id, d.planItemId ?? null));
  }
  return { status: 200, body: (await taskView(sql, userId, id))! };
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

/**
 * The desk when she's opened. `me` is who learnerFor resolved (null for a visitor with no learner
 * yet); only a signed-in student (a verified Auth0 session) gets her personal greeting and shelf.
 */
export async function home(sql: Sql, me: LibrarianUser | null): Promise<LibrarianHome> {
  const configured = {
    tinyfish: tinyfishConfigured(),
    gemini: !!process.env.GEMINI_API_KEY,
    database: true,
  };
  const account: LibrarianHome["account"] = !authConfigured()
    ? "not_configured"
    : me?.signedIn
      ? "signed_in"
      : "signed_out";
  const userId = me?.id ?? null;
  if (!userId)
    return {
      recent: [],
      saved: [],
      next: null,
      insight: null,
      configured,
      account,
      greeting: null,
      shelf: null,
    };
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
  const personal = await personalHome(sql, me, next[0] ? { title: next[0].title as string } : null);
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
    account,
    greeting: personal.greeting,
    shelf: personal.shelf,
  };
}
