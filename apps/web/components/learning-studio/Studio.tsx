"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { DemoLessonFallback } from "@/components/demo/DemoFallbacks";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { SaveLessonButton } from "@/components/my-library/SaveButtons";
import {
  IconBook,
  IconCheck,
  IconChevronDown,
  IconFile,
  IconInfo,
  IconPlay,
  IconTrash,
  IconUpload,
  IconWarning,
} from "@/components/ui/icons";
import {
  BODY_L,
  BTN,
  BTN_SM,
  DISPLAY_L,
  FOCUS,
  INPUT,
  LABEL,
  PAGE,
  PANEL,
  PANEL_MUTED,
  TAG,
  TITLE,
} from "@/components/ui/styles";
import {
  type SavedLesson,
  addLesson,
  deleteLesson,
  loadLessons,
  updateProgress,
} from "@/lib/learning-studio/library";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "@/lib/learning-studio/mockLesson";
import { SAVED_LESSON, SAVED_LESSON_NOTES } from "@/lib/demo/fixtures";
import {
  LENGTHS,
  LEVELS,
  SCENE_COUNT,
  type Lesson,
  type LessonLength,
  type Level,
} from "@/lib/learning-studio/schema";
import { chunkPages } from "@/lib/learning-studio/text";
import { LessonPlayer } from "./LessonPlayer";

const MAX_MB = 15;
/** What happens while a lesson is made, in order (the `stage` state indexes this). */
const STAGES = [
  "Uploading your PDF",
  "Reading the text",
  "Finding the main ideas",
  "Writing the lesson and checking its quiz",
  "Ready to study",
];

type View =
  | { kind: "home" }
  | {
      kind: "player";
      id: string | null;
      lesson: Lesson;
      chunks: SavedLesson["chunks"];
      scene: number;
    };

async function apiError(res: Response) {
  try {
    const data = (await res.json()) as { error?: { message?: string } };
    return data.error?.message ?? `Something went wrong (${res.status}).`;
  } catch {
    return `Something went wrong (${res.status}).`;
  }
}

/* ---- Presentation helpers ---- */

const LEVEL_LABELS: Record<Level, string> = {
  beginner: "Beginner",
  "high-school": "High school",
  university: "University",
  advanced: "Advanced",
};

const LENGTH_NAMES: Record<LessonLength, string> = {
  short: "Short",
  standard: "Standard",
  detailed: "Detailed",
};

function lengthLabel(length: LessonLength) {
  const [min, max] = SCENE_COUNT[length];
  return `${LENGTH_NAMES[length]} · ${min}–${max} scenes`;
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(ms: number) {
  return new Date(ms).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

const SELECT = `${INPUT} cursor-pointer appearance-none pr-10 disabled:cursor-not-allowed disabled:opacity-60`;
const FIELD_INPUT = `${INPUT} disabled:cursor-not-allowed disabled:opacity-60`;
const DELETE_BTN = `inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] border-2 border-transparent text-ink-soft transition-[background-color,border-color,color,translate] duration-150 hover:-translate-y-px hover:border-walnut hover:bg-[#fbe9e5] hover:text-danger active:translate-y-px motion-reduce:transition-none ${FOCUS}`;
/** The little sticker icon at the start of a lesson row. */
const ROW_ICON =
  "grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border-[2.5px] border-walnut text-walnut shadow-[0_3px_0_#1f1a16]";
/** One lesson in "Your lessons": a small cream sticker card. */
const ROW_CARD =
  "flex items-center gap-3 rounded-[20px] border-[3px] border-walnut bg-surface p-3 shadow-[0_4px_0_#1f1a16]";
/** The sample lesson: the same card, dashed, so it reads as "try me" rather than yours. */
const SAMPLE_CARD =
  "flex items-center gap-3 rounded-[20px] border-[3px] border-dashed border-walnut/60 bg-canvas p-3";
/** The "New lesson" ribbon: the shared RIBBON, one size up, as the card's heading. */
const CARD_RIBBON =
  "inline-flex items-center rounded-full border-[2.5px] border-walnut bg-tangerine px-4 py-1 font-display text-[15px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16]";
/** A decorative row of coloured dots, like the one under the title screen's logo. */
function DotRow({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`flex items-center gap-2 ${className}`}>
      <span className="h-3 w-20 rounded-full border-[2.5px] border-walnut bg-tangerine shadow-[0_3px_0_#1f1a16]" />
      <span className="h-3 w-3 rounded-full border-[2.5px] border-walnut bg-sun shadow-[0_3px_0_#1f1a16]" />
      <span className="h-3 w-3 rounded-full border-[2.5px] border-walnut bg-leaf shadow-[0_3px_0_#1f1a16]" />
    </span>
  );
}

/** A chunky progress bar (decorative: the words next to it say the same thing). */
function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`block h-3.5 overflow-hidden rounded-full border-[2.5px] border-walnut bg-canvas ${className}`}
    >
      <span
        className="block h-full rounded-full border-r-[2.5px] border-walnut bg-leaf transition-[width] duration-500 ease-out motion-reduce:transition-none"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </span>
  );
}

/** A native select with the system's input look and a chevron. */
function SelectField({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative mt-1.5 block">
      {children}
      <IconChevronDown
        size={18}
        strokeWidth={2.5}
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-walnut"
      />
    </span>
  );
}

/** One step of the "making your lesson" list: done, happening now, or still to come. */
function StageRow({ label, state }: { label: string; state: "done" | "current" | "todo" }) {
  return (
    <li className="flex items-center gap-3 text-sm leading-5">
      <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center">
        {state === "done" ? (
          <span className="grid h-6 w-6 place-items-center rounded-full border-2 border-walnut bg-leaf text-walnut shadow-[0_2px_0_#1f1a16]">
            <IconCheck size={14} strokeWidth={3} />
          </span>
        ) : state === "current" ? (
          <span className="h-5 w-5 rounded-full border-[3px] border-walnut/20 border-t-tangerine motion-safe:animate-spin" />
        ) : (
          <span className="h-2.5 w-2.5 rounded-full border-2 border-walnut/30 bg-canvas" />
        )}
      </span>
      <span
        className={
          state === "current"
            ? "font-display text-[15px] font-semibold text-walnut"
            : state === "done"
              ? "font-semibold text-walnut"
              : "font-medium text-ink-soft"
        }
      >
        {label}
        {state === "done" && <span className="sr-only"> (done)</span>}
        {state === "current" && <span className="sr-only"> (in progress)</span>}
      </span>
    </li>
  );
}

/** The studio inside the library, as a book: one page (section) at a time, no site header. */
export interface StudioBookProps {
  page: "new" | "lessons";
  /** Tells the book when a lesson is open (it then fills the whole spread). */
  onPlayer?: (open: boolean) => void;
  /** "Give your notes to Ms. Fenwick" opens her panel in the library instead of a new page. */
  onLibrarian?: () => void;
}

export default function Studio({ book }: { book?: StudioBookProps } = {}) {
  const [view, setView] = useState<View>({ kind: "home" });
  const onPlayer = book?.onPlayer;
  const playerOpen = view.kind === "player";
  useEffect(() => {
    onPlayer?.(playerOpen);
  }, [onPlayer, playerOpen]);
  const [lessons, setLessons] = useState<SavedLesson[]>(loadLessons);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [length, setLength] = useState<LessonLength>("short");
  const [level, setLevel] = useState<Level>("high-school");
  const [stage, setStage] = useState(-1);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  /** The judge demo's saved example was opened while this lesson was being made. */
  const sawExample = useRef(false);

  const generate = async () => {
    if (!file) return;
    setError("");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))
      return setError("Choose a PDF file.");
    if (file.size > MAX_MB * 1024 * 1024)
      return setError(`That PDF is over ${MAX_MB} MB. Try a smaller file.`);
    const ctrl = new AbortController();
    abort.current = ctrl;
    sawExample.current = false;
    try {
      setStage(0);
      const form = new FormData();
      form.append("file", file);
      setStage(1);
      const ex = await fetch("/api/learning-studio/extract", {
        method: "POST",
        body: form,
        signal: ctrl.signal,
      });
      if (!ex.ok) throw new Error(await apiError(ex));
      const { pages } = (await ex.json()) as { pages: string[] };
      setStage(2);
      const timer = setTimeout(() => setStage(3), 4000);
      const gen = await fetch("/api/learning-studio/lessons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, length, level, pages }),
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      if (!gen.ok) throw new Error(await apiError(gen));
      const { lesson } = (await gen.json()) as { lesson: Lesson };
      setStage(4);
      const saved = addLesson({ lesson, chunks: chunkPages(pages), sourceName: file.name });
      setLessons(loadLessons());
      // Someone watching the demo's saved example keeps watching; theirs waits in Your lessons.
      if (!sawExample.current)
        setView({ kind: "player", id: saved.id, lesson, chunks: saved.chunks, scene: 0 });
    } catch (err) {
      if ((err as Error).name !== "AbortError") setError((err as Error).message);
    } finally {
      setStage(-1);
      abort.current = null;
    }
  };

  if (view.kind === "player") {
    return (
      <LessonPlayer
        key={view.id ?? "sample"}
        lesson={view.lesson}
        chunks={view.chunks}
        startScene={view.scene}
        onProgress={(scene, completed) => view.id && updateProgress(view.id, scene, completed)}
        onExit={() => {
          setLessons(loadLessons());
          setView({ kind: "home" });
        }}
        exitLabel={book ? "Back to the book" : undefined}
        fill={!!book}
      />
    );
  }

  const busy = stage >= 0;
  const newLesson = (
    <section className={`${PANEL} relative p-5 pt-8 sm:p-8 sm:pt-10`} aria-labelledby="new-lesson">
      <h2 id="new-lesson" className={`${CARD_RIBBON} absolute -top-[18px] left-5 sm:left-7`}>
        New lesson
      </h2>
      <span
        aria-hidden
        className="absolute -top-5 -right-3 grid h-14 w-14 rotate-12 place-items-center rounded-full border-[3px] border-walnut bg-sun font-display text-[15px] font-bold text-walnut shadow-[0_4px_0_#1f1a16] sm:-right-5"
      >
        PDF
      </span>

      <label
        className={`group flex items-center gap-4 rounded-[20px] border-[3px] px-4 py-5 transition-[background-color,border-color,box-shadow,translate] duration-150 ease-out has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-sun has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-walnut motion-reduce:transition-none ${
          file
            ? "border-walnut bg-surface shadow-[0_4px_0_#1f1a16]"
            : "border-dashed border-walnut/45 bg-canvas"
        } ${busy ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:-translate-y-px hover:border-walnut hover:bg-sun/25"}`}
      >
        <span
          aria-hidden
          className={`grid h-12 w-12 shrink-0 -rotate-3 place-items-center rounded-[14px] border-[2.5px] border-walnut text-walnut shadow-[0_3px_0_#1f1a16] ${file ? "bg-leaf" : "bg-sun"}`}
        >
          {file ? (
            <IconFile size={22} strokeWidth={2.25} />
          ) : (
            <IconUpload size={22} strokeWidth={2.25} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[16px] leading-6 font-semibold text-walnut">
            {file ? file.name : "Choose a PDF of your notes"}
          </span>
          <span className="block text-[13px] leading-5 font-medium text-ink-soft">
            {file
              ? formatSize(file.size)
              : `Up to ${MAX_MB} MB. Text-based PDFs work best; scanned pages can't be read.`}
          </span>
        </span>
        {file && !busy && (
          <span className="shrink-0 rounded-full border-2 border-walnut bg-surface px-3 py-0.5 font-display text-[13px] font-semibold text-walnut shadow-[0_2px_0_#1f1a16] group-hover:bg-sun">
            Change
          </span>
        )}
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />
      </label>
      <p className="mt-3 text-[13px] leading-5 font-medium text-ink-soft">
        Want web sources and a study plan too?{" "}
        {book?.onLibrarian ? (
          <button
            type="button"
            onClick={book.onLibrarian}
            className={`rounded-[6px] font-display font-semibold text-walnut underline decoration-tangerine decoration-[2.5px] underline-offset-[4px] transition-colors duration-150 hover:decoration-walnut ${FOCUS}`}
          >
            Give your notes to Ms. Fenwick
          </button>
        ) : (
          <Link
            href="/librarian"
            className={`rounded-[6px] font-display font-semibold text-walnut underline decoration-tangerine decoration-[2.5px] underline-offset-[4px] transition-colors duration-150 hover:decoration-walnut ${FOCUS}`}
          >
            Give your notes to Ms. Fenwick
          </Link>
        )}
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className={LABEL}>
            Title or subject <span className="font-medium text-ink-soft">(optional)</span>
          </span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={100}
            disabled={busy}
            placeholder="For example, Cell biology unit 3"
            className={`${FIELD_INPUT} mt-1.5`}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Length</span>
          <SelectField>
            <select
              value={length}
              onChange={(e) => setLength(e.target.value as LessonLength)}
              disabled={busy}
              className={SELECT}
            >
              {LENGTHS.map((l) => (
                <option key={l} value={l}>
                  {lengthLabel(l)}
                </option>
              ))}
            </select>
          </SelectField>
        </label>
        <label className="block">
          <span className={LABEL}>Level</span>
          <SelectField>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as Level)}
              disabled={busy}
              className={SELECT}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </SelectField>
        </label>
      </div>

      <p
        className={`${PANEL_MUTED} mt-6 flex gap-2.5 px-3.5 py-3 text-[13px] leading-5 font-medium text-ink-soft`}
      >
        <IconInfo size={18} strokeWidth={2.25} className="mt-px text-walnut" />
        <span>
          Lessons are written from your notes and can contain mistakes. Each scene links back to the
          pages it came from, and quiz answers quote your notes where they can, so you can check
          them. Your PDF is read on our server and not stored; lessons are saved in this browser.
        </span>
      </p>

      {error && (
        <p
          role="alert"
          className="mt-5 flex items-start gap-2.5 rounded-[16px] border-[3px] border-walnut bg-[#fbe9e5] px-3.5 py-3 text-sm leading-5 font-semibold text-walnut shadow-[0_3px_0_#1f1a16]"
        >
          <IconWarning size={18} strokeWidth={2.25} className="mt-px text-danger" />
          <span>{error}</span>
        </p>
      )}
      {error && !busy && (
        <DemoLessonFallback
          busy={false}
          failed
          onPlay={() =>
            setView({
              kind: "player",
              id: null,
              lesson: SAVED_LESSON,
              chunks: SAVED_LESSON_NOTES,
              scene: 0,
            })
          }
        />
      )}

      {busy ? (
        <div
          className="mt-6 border-t-2 border-dashed border-walnut/20 pt-5"
          role="status"
          aria-live="polite"
        >
          <p className="font-display text-[17px] font-semibold text-walnut">Making your lesson</p>
          <ProgressBar value={(stage + 0.5) / STAGES.length} className="mt-3" />
          <ol className="mt-4 space-y-2.5">
            {STAGES.map((s, i) => (
              <StageRow
                key={s}
                label={s}
                state={i < stage ? "done" : i === stage ? "current" : "todo"}
              />
            ))}
          </ol>
          <p className="mt-4 text-[13px] leading-5 font-medium text-ink-soft">
            Longer notes can take a minute or two.{" "}
            {book
              ? "You can close the book and keep studying; it keeps going."
              : "Keep this tab open until the lesson is ready."}
          </p>
          <button
            type="button"
            className={`${BTN.secondary} mt-4`}
            onClick={() => abort.current?.abort()}
          >
            Cancel
          </button>
          <DemoLessonFallback
            busy={busy}
            failed={false}
            onPlay={() => {
              sawExample.current = true;
              setView({
                kind: "player",
                id: null,
                lesson: SAVED_LESSON,
                chunks: SAVED_LESSON_NOTES,
                scene: 0,
              });
            }}
          />
        </div>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            disabled={!file}
            onClick={() => void generate()}
            className={BTN.primary}
          >
            Create lesson
          </button>
          {!file && (
            <span className="text-[13px] font-medium text-ink-soft">Choose a PDF to start.</span>
          )}
        </div>
      )}
    </section>
  );
  const yourLessons = (
    <section aria-labelledby="your-lessons" className="lg:pt-6">
      <div className="flex items-center justify-between gap-4">
        <h2 id="your-lessons" className={TITLE}>
          Your lessons
        </h2>
        {lessons.length > 0 && (
          <span className={`${TAG.brass} tabular rotate-2 shadow-[0_2px_0_#1f1a16]`}>
            {lessons.length} saved
          </span>
        )}
      </div>
      <p className="mt-1 text-[13px] leading-5 font-medium text-ink-soft">
        Saved in this browser, with your place in each one.
      </p>

      {lessons.length === 0 && (
        <p
          className={`${PANEL_MUTED} mt-5 border-dashed px-4 py-3.5 text-sm leading-6 font-medium text-ink-soft`}
        >
          No lessons yet. Upload your notes to make your first one, or open the sample below to see
          how a lesson works.
        </p>
      )}

      <ul className="mt-5 space-y-3.5">
        {lessons.map((l) => (
          <li key={l.id} className={ROW_CARD}>
            <span
              aria-hidden
              className={`${ROW_ICON} ${l.progress.completed ? "bg-leaf" : "bg-sun"}`}
            >
              {l.progress.completed ? (
                <IconCheck size={20} strokeWidth={2.75} />
              ) : (
                <IconBook size={20} strokeWidth={2.25} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="line-clamp-2 font-display text-[16px] leading-6 font-semibold break-words text-walnut">
                {l.lesson.title}
              </p>
              <p className="text-[13px] leading-5 font-medium text-ink-soft">
                {l.lesson.subject} · {formatDate(l.createdAt)} ·{" "}
                {l.progress.completed ? (
                  <span className="font-bold text-walnut">Finished</span>
                ) : (
                  <span className="tabular">
                    Scene {l.progress.scene + 1} of {l.lesson.scenes.length}
                  </span>
                )}
              </p>
              <ProgressBar
                value={
                  l.progress.completed ? 1 : l.progress.scene / Math.max(1, l.lesson.scenes.length)
                }
                className="mt-2 max-w-[220px]"
              />
              <div className="mt-2">
                <SaveLessonButton
                  lesson={l.lesson}
                  chunks={l.chunks}
                  sourceName={l.sourceName}
                  progress={l.progress}
                />
              </div>
            </div>
            <button
              type="button"
              className={BTN_SM.secondary}
              onClick={() =>
                setView({
                  kind: "player",
                  id: l.id,
                  lesson: l.lesson,
                  chunks: l.chunks,
                  scene: l.progress.completed ? 0 : l.progress.scene,
                })
              }
            >
              {l.progress.scene > 0 && !l.progress.completed ? "Continue" : "Open"}
            </button>
            <button
              type="button"
              aria-label={`Delete ${l.lesson.title}`}
              title="Delete lesson"
              className={DELETE_BTN}
              onClick={() => {
                if (window.confirm(`Delete "${l.lesson.title}"?`)) {
                  deleteLesson(l.id);
                  setLessons(loadLessons());
                }
              }}
            >
              <IconTrash size={18} />
            </button>
          </li>
        ))}
        <li className={SAMPLE_CARD}>
          <span aria-hidden className={`${ROW_ICON} bg-tangerine`}>
            <IconPlay size={18} strokeWidth={2.25} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 font-display text-[16px] leading-6 font-semibold text-walnut">
              <span className="truncate">{SAMPLE_LESSON.title}</span>
              <span className={`${TAG.brass} -rotate-3`}>Sample</span>
            </p>
            <p className="text-[13px] leading-5 font-medium text-ink-soft">
              See how a lesson works before you upload anything.
            </p>
          </div>
          <button
            type="button"
            className={BTN_SM.secondary}
            onClick={() =>
              setView({
                kind: "player",
                id: null,
                lesson: SAMPLE_LESSON,
                chunks: SAMPLE_NOTES,
                scene: 0,
              })
            }
          >
            Try it
          </button>
        </li>
      </ul>
    </section>
  );
  if (book) return book.page === "new" ? newLesson : yourLessons;
  return (
    <div className="relative min-h-dvh bg-canvas">
      {/* Sits above the page until a keyboard user tabs to it. */}
      <a
        href="#main"
        className={`${BTN_SM.secondary} absolute top-3 left-3 z-10 -translate-y-16 focus-visible:translate-y-0`}
      >
        Skip to content
      </a>

      <SiteHeader current="/learning-studio" />

      <main id="main" className={`${PAGE} pt-10 pb-20 sm:pt-14 sm:pb-24`}>
        <div className="max-w-[720px]">
          <p className="title-pop inline-flex w-fit -rotate-2 items-center gap-2 rounded-full border-[3px] border-walnut bg-sun px-4 py-1.5 font-display text-sm font-semibold text-walnut shadow-[0_4px_0_#1f1a16]">
            <span
              aria-hidden
              className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-tangerine"
            />
            Learning Studio
          </p>
          <h1
            className={`${DISPLAY_L} title-pop mt-4 text-balance`}
            style={{ animationDelay: "80ms" }}
          >
            Turn your notes into a lesson
          </h1>
          <DotRow className="title-pop mt-4" />
          <p className={`${BODY_L} mt-5 max-w-[62ch]`}>
            Upload a PDF of your notes. The studio builds a short narrated lesson with visuals and
            knowledge checks, and Ms. Fenwick answers your questions from the same notes.
          </p>
        </div>

        <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:items-start lg:gap-14">
          {newLesson}

          {yourLessons}
        </div>
      </main>
    </div>
  );
}
