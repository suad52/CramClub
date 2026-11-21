"use client";

import { useRef, useState } from "react";
import { LessonPlayer, Question } from "@/components/learning-studio/LessonPlayer";
import { Spinner, TEXT_LINK } from "@/components/my-library/parts";
import { useApi } from "@/components/progress/api";
import {
  IconArrowLeft,
  IconArrowUpRight,
  IconCheck,
  IconGraduationCap,
  IconPlay,
  IconRefresh,
  IconWarning,
} from "@/components/ui/icons";
import { BODY, BTN, DISPLAY_L, HEADING, PAGE, PANEL, RIBBON, TAG } from "@/components/ui/styles";
import type { LessonJobView } from "@/lib/jobs/types";
import type { Lesson } from "@/lib/learning-studio/schema";
import { type CloudLesson, sourceChunks, storedAudio } from "@/lib/lessons/client";
import { AudioPlayer, clock } from "./AudioPlayer";
import { LessonJobCard, StorageBadge } from "./LessonJobCard";

const LEVEL_LABELS: Record<string, string> = {
  beginner: "Beginner",
  "high-school": "High school",
  university: "University",
  advanced: "Advanced",
};

/** Only real web links are shown as links (a source's URL comes from the research). */
function safeHref(url: string) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function Shell({ onExit, children }: { onExit: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas">
      <div className={`${PAGE} pt-6 pb-20`}>
        <button type="button" className={`${BTN.quiet} -ml-3`} onClick={onExit}>
          <IconArrowLeft size={18} strokeWidth={2.5} />
          Back to my library
        </button>
        {children}
      </div>
    </div>
  );
}

/**
 * A cloud lesson from the library (GET /api/lessons/:id, which checks it's yours or shared with a
 * Study Circle you're in): its title, summary, sources, scenes with their stored narration, and
 * the quiz. "Play the lesson" opens the Learning Studio's player on the same stored MP3s, so
 * nothing is synthesized again however often it's reopened. A lesson still being made shows its
 * live status card instead and opens itself when it's ready.
 */
export function CloudLessonView({ id, onExit }: { id: string; onExit: () => void }) {
  const { data, error, loading, reload } = useApi<CloudLesson>(
    `/api/lessons/${encodeURIComponent(id)}`,
  );
  const [playing, setPlaying] = useState<number | null>(null);

  if (!data) {
    if (loading || !error)
      return (
        <Shell onExit={onExit}>
          <p
            role="status"
            className="mt-8 inline-flex -rotate-2 items-center gap-2.5 rounded-full border-[3px] border-walnut bg-surface px-4 py-1.5 font-display text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]"
          >
            <Spinner />
            Opening your lesson…
          </p>
        </Shell>
      );
    return (
      <Shell onExit={onExit}>
        <div
          role="alert"
          className="mt-8 max-w-[560px] rounded-[20px] border-[3px] border-walnut bg-[#fbe9e5] p-5 text-walnut shadow-[0_4px_0_#1f1a16]"
        >
          <p className="flex items-center gap-2 font-display text-[18px] font-semibold">
            <IconWarning size={20} className="text-danger" />
            Couldn&apos;t open the lesson
          </p>
          <p className="mt-1 text-[15px] font-medium">
            {error.status === 404
              ? "That lesson doesn't exist, or it isn't one you can open."
              : error.message}
          </p>
          {error.status !== 404 && (
            <button type="button" className={`${BTN.primary} mt-4`} onClick={reload}>
              <IconRefresh size={18} />
              Try again
            </button>
          )}
        </div>
      </Shell>
    );
  }

  if (data.status !== "completed" || !data.lesson)
    return (
      <Shell onExit={onExit}>
        <div className="mt-8 max-w-[820px]">
          <LessonJobCard
            job={data}
            onOpen={reload}
            onChange={(job) => {
              if (job.status === "completed") reload();
            }}
          />
        </div>
      </Shell>
    );

  const lesson = data.lesson;
  if (playing !== null)
    return (
      <LessonPlayer
        lesson={lesson}
        chunks={sourceChunks(data)}
        audio={storedAudio(data)}
        startScene={playing}
        exitLabel="Back to the lesson"
        onExit={() => setPlaying(null)}
      />
    );

  return (
    <Shell onExit={onExit}>
      <Overview job={data} lesson={lesson} onPlay={(scene) => setPlaying(scene)} />
    </Shell>
  );
}

function Overview({
  job,
  lesson,
  onPlay,
}: {
  job: LessonJobView;
  lesson: Lesson;
  onPlay: (scene: number) => void;
}) {
  const audio = storedAudio(job);
  const durations = new Map(job.audio.map((a) => [a.scene, a.duration]));
  const recorded = job.audio.reduce((n, a) => n + (a.duration ?? 0), 0);
  const quiz = lesson.scenes
    .map((s, i) => ({ scene: s, index: i }))
    .filter((x) => !!x.scene.interaction);
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const quizRefs = useRef<(HTMLLIElement | null)[]>([]);

  return (
    <article className="mt-6">
      <header className="max-w-[860px]">
        <p className={`${RIBBON} -rotate-2 gap-1.5`}>
          <IconGraduationCap size={15} strokeWidth={2.25} />
          Cloud lesson
        </p>
        <h1 className={`${DISPLAY_L} mt-4 text-balance`}>{lesson.title}</h1>
        {job.topic !== lesson.title && (
          <p className="mt-2 font-display text-[15px] font-semibold text-ink-soft">
            Topic: {job.topic}
          </p>
        )}
        <p className="mt-4 text-[17px] leading-7 font-medium text-ink-soft">
          {job.summary ?? lesson.description}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className={TAG.brass}>{LEVEL_LABELS[lesson.difficulty] ?? lesson.difficulty}</span>
          <span className={`${TAG.neutral} tabular`}>
            {lesson.scenes.length} scenes · about {lesson.estimatedMinutes} min
          </span>
          {job.audio.length > 0 && (
            <span className={`${TAG.forest} tabular`}>
              {job.audio.length} narrated{recorded > 0 ? ` · ${clock(recorded)}` : ""}
            </span>
          )}
          <StorageBadge storage={job.storage} />
        </div>
        <div className="mt-6">
          <button type="button" className={BTN.primary} onClick={() => onPlay(0)}>
            <IconPlay size={18} strokeWidth={2.5} />
            Play the lesson
          </button>
        </div>
      </header>

      <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-10">
          {lesson.learningObjectives.length > 0 && (
            <section aria-labelledby="objectives">
              <h2 id="objectives" className={HEADING}>
                What you&apos;ll learn
              </h2>
              <ul className="mt-3 space-y-1.5">
                {lesson.learningObjectives.map((o) => (
                  <li
                    key={o}
                    className="flex items-start gap-2 text-[15px] leading-6 font-medium text-walnut"
                  >
                    <IconCheck size={17} strokeWidth={2.75} className="mt-1 text-forest" />
                    {o}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="scenes">
            <h2 id="scenes" className={HEADING}>
              Scenes
            </h2>
            <ol className="mt-4 space-y-5">
              {lesson.scenes.map((s, i) => (
                <li key={s.id} className={`${PANEL} p-4 sm:p-5`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h3 className="min-w-0 flex-1 font-display text-[17px] leading-6 font-semibold text-walnut">
                      <span className="tabular text-ink-soft">{i + 1}.</span> {s.title}
                    </h3>
                    <button type="button" className={BTN.quiet} onClick={() => onPlay(i)}>
                      <IconPlay size={16} strokeWidth={2.5} />
                      Play from here
                    </button>
                  </div>
                  {audio[i] ? (
                    <AudioPlayer
                      key={audio[i]}
                      src={audio[i]}
                      label={`Narration for scene ${i + 1}: ${s.title}`}
                      knownDuration={durations.get(i) ?? null}
                      className="mt-3"
                    />
                  ) : (
                    <p className="mt-2 text-[13px] font-medium text-ink-soft">
                      No stored narration for this scene: the player reads it in your browser&apos;s
                      voice.
                    </p>
                  )}
                  <details className="group mt-3">
                    <summary
                      className={`${TEXT_LINK} inline-block cursor-pointer text-[14px] marker:content-none`}
                    >
                      <span className="group-open:hidden">Read the narration</span>
                      <span className="hidden group-open:inline">Hide the narration</span>
                    </summary>
                    <p className={`${BODY} mt-2 max-w-[68ch]`}>{s.narration}</p>
                  </details>
                </li>
              ))}
            </ol>
          </section>

          {quiz.length > 0 && (
            <section aria-labelledby="quiz">
              <h2 id="quiz" className={HEADING}>
                Quiz
              </h2>
              <p className={`${BODY} mt-1`}>
                The knowledge checks from the lesson, all in one place.
                {quiz.length > 1 && ` ${Object.keys(answered).length} of ${quiz.length} done.`}
              </p>
              <ol className="mt-6 space-y-8">
                {quiz.map(({ scene, index }, n) => (
                  <li
                    key={scene.id}
                    ref={(el) => {
                      quizRefs.current[n] = el;
                    }}
                    tabIndex={-1}
                    className="rounded-[24px] outline-none"
                  >
                    <p className="mb-3 font-display text-[13.5px] font-semibold text-ink-soft">
                      From scene {index + 1}: {scene.title}
                    </p>
                    <Question
                      q={scene.interaction!}
                      onDone={() => {
                        setAnswered((a) => ({ ...a, [scene.id]: true }));
                        quizRefs.current[n + 1]?.focus();
                      }}
                    />
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>

        <aside aria-labelledby="sources" className="min-w-0">
          <div className={`${PANEL} p-5 lg:sticky lg:top-6`}>
            <h2 id="sources" className={HEADING}>
              Sources
            </h2>
            {job.sources.length === 0 ? (
              <p className={`${BODY} mt-2`}>No web sources were recorded for this lesson.</p>
            ) : (
              <ol className="mt-3 space-y-3">
                {job.sources.map((src, i) => {
                  const href = safeHref(src.url);
                  return (
                    <li key={`${src.url}-${i}`} className="flex gap-2.5 text-[14px] leading-5">
                      <span className="tabular mt-px shrink-0 font-display font-semibold text-ink-soft">
                        [{i + 1}]
                      </span>
                      <span className="min-w-0">
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`${TEXT_LINK} break-words`}
                          >
                            {src.title || new URL(href).hostname}
                            <IconArrowUpRight size={13} className="ml-0.5 inline align-[-1px]" />
                            <span className="sr-only"> (opens in a new tab)</span>
                          </a>
                        ) : (
                          <span className="font-display font-semibold break-words text-walnut">
                            {src.title}
                          </span>
                        )}
                        {href && (
                          <span className="mt-0.5 block truncate text-[12.5px] font-medium text-ink-soft">
                            {new URL(href).hostname}
                          </span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            {lesson.warnings && lesson.warnings.length > 0 && (
              <div className="mt-5 border-t-2 border-dashed border-walnut/15 pt-4">
                <p className="flex items-center gap-2 font-display text-[14px] font-semibold text-walnut">
                  <IconWarning size={16} strokeWidth={2.25} className="text-warning" />
                  Notes on the material
                </p>
                <ul className="mt-1.5 ml-5 list-disc text-[13.5px] leading-5 font-medium text-ink-soft">
                  {lesson.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="mt-5 text-[12.5px] leading-5 font-medium text-ink-soft">
              Made in the cloud by the library. Lessons can contain mistakes, so check the sources.
            </p>
          </div>
        </aside>
      </div>
    </article>
  );
}
