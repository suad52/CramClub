"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  type SavedLesson,
  addLesson,
  deleteLesson,
  loadLessons,
  updateProgress,
} from "@/lib/learning-studio/library";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "@/lib/learning-studio/mockLesson";
import {
  LENGTHS,
  LEVELS,
  type Lesson,
  type LessonLength,
  type Level,
} from "@/lib/learning-studio/schema";
import { chunkPages } from "@/lib/learning-studio/text";
import { LessonPlayer } from "./LessonPlayer";

const MAX_MB = 15;
const STAGES = [
  "Uploading document",
  "Extracting text",
  "Understanding the material",
  "Building the lesson",
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

export default function Studio() {
  const [view, setView] = useState<View>({ kind: "home" });
  const [lessons, setLessons] = useState<SavedLesson[]>(loadLessons);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [length, setLength] = useState<LessonLength>("short");
  const [level, setLevel] = useState<Level>("high-school");
  const [stage, setStage] = useState(-1);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);

  const generate = async () => {
    if (!file) return;
    setError("");
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf"))
      return setError("Choose a PDF file.");
    if (file.size > MAX_MB * 1024 * 1024)
      return setError(`That PDF is over ${MAX_MB} MB. Try a smaller file.`);
    const ctrl = new AbortController();
    abort.current = ctrl;
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
      />
    );
  }

  const busy = stage >= 0;
  return (
    <div className="min-h-dvh bg-parchment">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <Link href="/" className="font-display text-2xl font-semibold tracking-tight">
          OVR
        </Link>
        <Link
          href="/library"
          className="rounded-full px-4 py-2 text-sm font-bold text-ink-soft hover:bg-ink/5 hover:text-ink"
        >
          Enter Library →
        </Link>
      </header>
      <main className="mx-auto max-w-5xl px-6 pb-20">
        <p className="mb-2 text-sm font-bold tracking-[0.18em] text-wood uppercase">
          AI Learning Studio
        </p>
        <h1 className="font-display text-4xl font-semibold tracking-tight sm:text-5xl">
          Turn your notes into a lesson.
        </h1>
        <p className="mt-3 max-w-2xl text-lg text-ink-soft">
          Upload a PDF of your notes and get a short narrated lesson with visuals, questions and an
          AI teacher who answers from your notes.
        </p>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_1fr]">
          <section
            className="rounded-3xl bg-cream p-6 shadow ring-1 ring-ink/10"
            aria-labelledby="new-lesson"
          >
            <h2 id="new-lesson" className="font-display text-xl font-semibold">
              New lesson
            </h2>
            <label className="mt-4 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-wood/40 bg-white/50 px-4 py-8 text-center hover:bg-white/80">
              <span className="font-bold">{file ? file.name : "Choose a PDF"}</span>
              <span className="text-sm text-ink-soft">
                {file
                  ? `${(file.size / 1024 / 1024).toFixed(1)} MB`
                  : `Up to ${MAX_MB} MB, text-based (not scanned)`}
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
            </label>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-sm font-bold sm:col-span-3">
                Title or subject (optional)
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={100}
                  disabled={busy}
                  className="mt-1 w-full rounded-xl bg-white/70 px-3 py-2 font-normal ring-1 ring-ink/15"
                />
              </label>
              <label className="text-sm font-bold">
                Length
                <select
                  value={length}
                  onChange={(e) => setLength(e.target.value as LessonLength)}
                  disabled={busy}
                  className="mt-1 w-full rounded-xl bg-white/70 px-3 py-2 font-normal ring-1 ring-ink/15"
                >
                  {LENGTHS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm font-bold sm:col-span-2">
                Level
                <select
                  value={level}
                  onChange={(e) => setLevel(e.target.value as Level)}
                  disabled={busy}
                  className="mt-1 w-full rounded-xl bg-white/70 px-3 py-2 font-normal ring-1 ring-ink/15"
                >
                  {LEVELS.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
            </div>
            <p className="mt-4 text-xs text-ink-soft">
              The lesson is generated by AI from your notes and may contain mistakes. Each scene
              links back to the pages it came from so you can check it. Your PDF is read on our
              server and not stored; lessons are saved in this browser.
            </p>
            {error && (
              <p
                role="alert"
                className="mt-3 rounded-xl bg-ember/15 px-3 py-2 text-sm font-bold text-ink"
              >
                {error}
              </p>
            )}
            {busy ? (
              <div className="mt-4" role="status" aria-live="polite">
                <ol className="space-y-1 text-sm">
                  {STAGES.map((s, i) => (
                    <li
                      key={s}
                      className={
                        i < stage
                          ? "text-sage-dark"
                          : i === stage
                            ? "font-bold text-ink"
                            : "text-ink-soft/60"
                      }
                    >
                      {i < stage ? "✓" : i === stage ? "…" : "·"} {s}
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  className="mt-3 rounded-full px-4 py-2 text-sm font-bold ring-1 ring-ink/15 hover:bg-ink/5"
                  onClick={() => abort.current?.abort()}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={!file}
                onClick={() => void generate()}
                className="mt-4 rounded-full bg-ink px-6 py-3 font-bold text-cream shadow hover:bg-wood-dark disabled:opacity-40"
              >
                Create lesson
              </button>
            )}
          </section>

          <section aria-labelledby="your-lessons">
            <h2 id="your-lessons" className="font-display text-xl font-semibold">
              Your lessons
            </h2>
            <ul className="mt-4 space-y-3">
              {lessons.map((l) => (
                <li
                  key={l.id}
                  className="flex items-center gap-3 rounded-2xl bg-cream p-4 shadow ring-1 ring-ink/10"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-bold">{l.lesson.title}</div>
                    <div className="text-xs text-ink-soft">
                      {l.lesson.subject} · {new Date(l.createdAt).toLocaleDateString()} ·{" "}
                      {l.progress.completed
                        ? "Finished"
                        : `Scene ${l.progress.scene + 1} of ${l.lesson.scenes.length}`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-cream hover:bg-wood-dark"
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
                    className="rounded-full px-3 py-2 text-sm text-ink-soft ring-1 ring-ink/15 hover:bg-ember/15"
                    onClick={() => {
                      if (window.confirm(`Delete "${l.lesson.title}"?`)) {
                        deleteLesson(l.id);
                        setLessons(loadLessons());
                      }
                    }}
                  >
                    Delete
                  </button>
                </li>
              ))}
              <li className="flex items-center gap-3 rounded-2xl bg-white/50 p-4 ring-1 ring-ink/10">
                <div className="min-w-0 flex-1">
                  <div className="font-bold">{SAMPLE_LESSON.title} (sample)</div>
                  <div className="text-xs text-ink-soft">
                    See how a lesson works before you upload anything.
                  </div>
                </div>
                <button
                  type="button"
                  className="rounded-full px-4 py-2 text-sm font-bold ring-1 ring-ink/15 hover:bg-ink/5"
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
        </div>
      </main>
    </div>
  );
}
