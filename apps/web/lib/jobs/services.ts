import "server-only";
import type postgres from "postgres";
import { TEXT_FALLBACK_MODEL } from "@/lib/ai/gemini";
import { checkLessonQuiz, generateLesson, synthesize } from "@/lib/learning-studio/server";
import { quickResearch } from "@/lib/librarian/server/research";
import { getStorage } from "@/lib/storage";
import type { PipelineDeps } from "./pipeline";

/**
 * The real services behind a lesson job: TinyFish (the Librarian's quick research), Gemini (the
 * Learning Studio's lesson generator and its quiz self-check, which fails open) and ElevenLabs
 * (its narration), plus object storage.
 */

/** The model lesson jobs try first (the Librarian's fast default; the generator falls back). */
const LESSON_JOB_MODEL =
  process.env.GEMINI_LESSON_JOB_MODEL || process.env.GEMINI_LIBRARIAN_MODEL || TEXT_FALLBACK_MODEL;

export function liveDeps(sql: postgres.Sql): PipelineDeps {
  return {
    storage: getStorage(),
    research: (topic, hooks) => quickResearch(hooks, { queries: [topic] }),
    async librarianSources(ownerId, taskId) {
      // Only that learner's own request, and only what TinyFish actually read for it.
      const rows = await sql<{ title: string; url: string; domain: string; extract: string }[]>`
        SELECT s.title, s.url, s.domain, s.extract FROM research_sources s
        JOIN librarian_tasks t ON t.id = s.task_id
        WHERE s.task_id = ${taskId} AND t.user_id = ${ownerId} AND s.user_id = ${ownerId}
        ORDER BY s.position LIMIT 8`;
      return rows.map((r) => ({ title: r.title, url: r.url, domain: r.domain, text: r.extract }));
    },
    generateLesson: (o) => generateLesson({ ...o, model: LESSON_JOB_MODEL }),
    // The worker isn't on a request clock, so the check may take a little longer than in the
    // studio (GEMINI_QUIZ_CHECK_MODEL picks its model; it defaults to the quick one).
    checkQuiz: (lesson, pages) =>
      checkLessonQuiz(lesson, pages, { from: "sources", timeoutMs: 60_000 }),
    synthesize: (text) => synthesize(text),
  };
}
