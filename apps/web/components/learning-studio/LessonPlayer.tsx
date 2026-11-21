"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import type { Chunk, Interaction, Lesson, Scene } from "@/lib/learning-studio/schema";
import { topChunks } from "@/lib/learning-studio/text";
import { type LessonPlayback, useLessonPlayback } from "@/lib/learning-studio/useLessonPlayback";
import { VisualRenderer } from "./visuals";
import { trackQuizAnswer } from "@/lib/learning/client";

const BTN =
  "rounded-full px-3 py-2 text-sm font-bold text-ink ring-1 ring-ink/15 transition hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-ember disabled:opacity-40";
const PRIMARY =
  "rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-cream shadow transition hover:bg-wood-dark focus-visible:outline-2 focus-visible:outline-ember";

/** The knowledge check's class sets: full size in the player, `compact` for a small HUD card. */
const QUESTION_STYLES = {
  regular: {
    card: "rounded-2xl p-4",
    text: "",
    note: "text-sm",
    gap: "mt-3",
    smallGap: "mt-2",
    field: "rounded-xl p-3 text-sm",
    rows: 3,
    options: "gap-2 sm:grid-cols-2",
    option: "rounded-xl px-3 py-2 text-sm",
    btn: BTN,
    primary: PRIMARY,
  },
  compact: {
    card: "w-full max-w-sm rounded-xl p-3",
    text: "text-sm",
    note: "text-xs",
    gap: "mt-2",
    smallGap: "mt-1.5",
    field: "rounded-lg p-2 text-xs",
    rows: 2,
    options: "gap-1.5",
    option: "rounded-lg px-2.5 py-1.5 text-xs",
    btn: "rounded-full px-2.5 py-1 text-xs font-bold text-ink ring-1 ring-ink/15 transition hover:bg-ink/5 focus-visible:outline-2 focus-visible:outline-ember disabled:opacity-40",
    primary:
      "rounded-full bg-ink px-4 py-1.5 text-xs font-bold text-cream shadow transition hover:bg-wood-dark focus-visible:outline-2 focus-visible:outline-ember",
  },
};

/**
 * The knowledge check shown once the scene's narration reaches it. `hotkeys` lets it be answered
 * from the keyboard (1–5 pick an option, Enter continues) for when the mouse is busy steering the
 * library camera; the options are then numbered to match. Letter keys are deliberately not used:
 * A, B, D and E already walk, open the whiteboard and sit in the library.
 */
export function Question({
  q,
  onDone,
  onPick,
  hotkeys = false,
  compact = false,
}: {
  q: Interaction;
  onDone: () => void;
  /** An option was picked (the first pick is the answer that counts). */
  onPick?: (index: number) => void;
  hotkeys?: boolean;
  compact?: boolean;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [shown, setShown] = useState(false);
  const s = QUESTION_STYLES[compact ? "compact" : "regular"];

  // A compact card may be too short for the feedback and its Continue button, and it can't be
  // scrolled while the mouse is steering the camera: bring them into view once an answer is in.
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (compact && picked !== null) feedback.current?.scrollIntoView({ block: "nearest" });
  }, [compact, picked]);

  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]"))
        return;
      if (e.key === "Enter") {
        if (q.type === "reflection" || picked !== null) {
          // Also stops a focused button turning this Enter into a second click.
          e.preventDefault();
          onDone();
        }
        return;
      }
      const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
      if (!digit || q.type !== "multiple-choice" || picked !== null) return;
      const i = Number(digit[1]) - 1;
      if (i < q.options!.length) {
        e.preventDefault();
        setPicked(i);
        onPick?.(i);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, q, picked, onDone, onPick]);

  const continueButton = (
    <button
      type="button"
      className={`${s.primary} ${s.gap}`}
      onClick={onDone}
      aria-keyshortcuts={hotkeys ? "Enter" : undefined}
    >
      Continue
    </button>
  );
  if (q.type === "reflection") {
    return (
      <div className={`${s.card} bg-cream shadow ring-1 ring-ink/10`}>
        <p className={`${s.text} font-bold text-ink`}>{q.question}</p>
        <textarea
          className={`${s.gap} ${s.field} w-full bg-white/70 ring-1 ring-ink/15`}
          rows={s.rows}
          placeholder="Jot down your thoughts…"
        />
        {q.suggestedAnswer && (
          <button type="button" className={`${s.btn} ${s.smallGap}`} onClick={() => setShown(true)}>
            Show a suggested answer
          </button>
        )}
        {shown && <p className={`${s.smallGap} ${s.note} text-ink-soft`}>{q.suggestedAnswer}</p>}
        {continueButton}
      </div>
    );
  }
  const correct = picked === q.correctIndex;
  return (
    <fieldset className={`${s.card} bg-cream shadow ring-1 ring-ink/10`}>
      <legend className="sr-only">Knowledge check</legend>
      <p className={`${s.text} font-bold text-ink`}>{q.question}</p>
      <div className={`${s.gap} ${s.options} grid`}>
        {q.options!.map((opt, i) => {
          const state =
            picked === null
              ? ""
              : i === q.correctIndex
                ? "bg-sage/20 ring-sage"
                : i === picked
                  ? "bg-ember/15 ring-ember"
                  : "opacity-60";
          return (
            <button
              key={opt}
              type="button"
              disabled={picked !== null}
              onClick={() => {
                setPicked(i);
                onPick?.(i);
              }}
              className={`${s.option} text-left ring-1 ring-ink/15 transition hover:bg-ink/5 ${state}`}
              aria-pressed={picked === i}
              aria-keyshortcuts={hotkeys ? String(i + 1) : undefined}
            >
              <span className="mr-2 font-bold">
                {hotkeys ? i + 1 : String.fromCharCode(65 + i)}.
              </span>
              {opt}
              {picked !== null && i === q.correctIndex && (
                <span className="sr-only"> (correct answer)</span>
              )}
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div ref={feedback} className={s.gap} role="status">
          <p className={`${s.text} font-bold ${correct ? "text-sage-dark" : "text-ember"}`}>
            {correct ? "Correct!" : "Not quite."}
          </p>
          {q.explanation && <p className={`${s.note} text-ink-soft`}>{q.explanation}</p>}
          {continueButton}
        </div>
      )}
    </fieldset>
  );
}

interface ChatMessage {
  role: "student" | "teacher";
  text: string;
  pages?: number[];
}

/** The AI teacher: answers questions from the student's notes (retrieved chunks) and the current scene. */
function Teacher({ lesson, scene, chunks }: { lesson: Lesson; scene: Scene; chunks: Chunk[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setMessages((m) => [...m, { role: "student", text: question }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/learning-studio/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          question,
          lessonTitle: lesson.title,
          scene: {
            title: scene.title,
            narration: scene.narration,
            visual: scene.visual.title ?? "",
          },
          chunks: topChunks(chunks, `${question} ${scene.title}`, 6),
        }),
      });
      const data = (await res.json()) as {
        answer?: string;
        pages?: number[];
        error?: { message: string };
      };
      setMessages((m) => [
        ...m,
        {
          role: "teacher",
          text: data.answer ?? data.error?.message ?? "Something went wrong.",
          pages: data.pages,
        },
      ]);
    } catch {
      setMessages((m) => [
        ...m,
        { role: "teacher", text: "I couldn't reach the AI just now. Try again in a moment." },
      ]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-2 text-sm text-ink-soft">
            <p>
              Ask about this scene or your notes. Answers come from your notes, with page
              references.
            </p>
            {["Explain that more simply", "Give me another example", "Quiz me on this scene"].map(
              (s) => (
                <button key={s} type="button" className={BTN} onClick={() => void ask(s)}>
                  {s}
                </button>
              ),
            )}
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-xl p-3 text-sm ${m.role === "student" ? "ml-6 bg-ink text-cream" : "mr-6 bg-white/70 text-ink ring-1 ring-ink/10"}`}
          >
            {m.text}
            {m.pages && m.pages.length > 0 && (
              <div className="mt-1 text-xs text-ink-soft">
                From your notes: p. {m.pages.join(", ")}
              </div>
            )}
          </div>
        ))}
        {busy && <p className="text-sm text-ink-soft">Thinking…</p>}
      </div>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="Ask the AI teacher…"
          aria-label="Ask the AI teacher"
          className="min-w-0 flex-1 rounded-full bg-white/70 px-4 py-2 text-sm ring-1 ring-ink/15"
        />
        <button type="submit" className={PRIMARY} disabled={busy}>
          Ask
        </button>
      </form>
    </div>
  );
}

export interface PlayerProps {
  lesson: Lesson;
  chunks: Chunk[];
  startScene?: number;
  onProgress?: (scene: number, completed: boolean) => void;
  onExit: () => void;
}

/** The Learning Studio's player: its own playback, shown full page. */
export function LessonPlayer({ lesson, chunks, startScene = 0, onProgress, onExit }: PlayerProps) {
  const playback = useLessonPlayback(lesson, { startScene, onProgress });
  return <LessonPlayerView playback={playback} chunks={chunks} onExit={onExit} />;
}

/**
 * The full lesson player UI for a playback it doesn't own, so the same lesson can be shown here
 * and elsewhere (a library whiteboard) without restarting. `fill` sizes it to its container (with
 * its own scroll) for use inside an overlay; `keyboardShortcuts` can be turned off when something
 * else owns the keys.
 */
export function LessonPlayerView({
  playback,
  chunks,
  onExit,
  exitLabel = "← Lessons",
  headerActions,
  keyboardShortcuts = true,
  fill = false,
}: {
  playback: LessonPlayback;
  chunks: Chunk[];
  onExit: () => void;
  exitLabel?: string;
  headerActions?: ReactNode;
  keyboardShortcuts?: boolean;
  fill?: boolean;
}) {
  const {
    lesson,
    index,
    scene,
    last,
    started,
    rate,
    setRate,
    volume,
    setVolume,
    captionsOn,
    setCaptionsOn,
    showQuestion,
    completeQuestion,
    narration: n,
    playing,
    complete,
    go,
    toggle,
  } = playback;
  const [panel, setPanel] = useState<"sources" | "teacher" | "transcript" | null>(null);

  useEffect(() => {
    if (!keyboardShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      // Browser and system shortcuts (Cmd+C to copy, Ctrl+R, Alt+arrows) aren't the player's.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      const key = e.key.toLowerCase();
      if (e.code === "Space") {
        e.preventDefault();
        // Holding a toggle key down mustn't flip it back and forth.
        if (!e.repeat) toggle();
      } else if (e.key === "ArrowRight") go(index + 1);
      else if (e.key === "ArrowLeft") go(index - 1);
      else if (e.repeat) return;
      else if (key === "r") n.restart();
      else if (key === "c") setCaptionsOn((c) => !c);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboardShortcuts, toggle, go, index, n, setCaptionsOn]);

  return (
    <div className={`flex flex-col bg-parchment ${fill ? "h-full overflow-y-auto" : "min-h-dvh"}`}>
      <header className="flex flex-wrap items-center gap-3 border-b border-ink/10 px-4 py-3">
        <button type="button" className={BTN} onClick={onExit}>
          {exitLabel}
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-lg font-semibold text-ink">{lesson.title}</h1>
          <p className="truncate text-xs text-ink-soft">
            Scene {index + 1} of {lesson.scenes.length} · {scene.title}
          </p>
        </div>
        {headerActions}
        {(["sources", "transcript", "teacher"] as const).map((p) => (
          <button
            key={p}
            type="button"
            className={`${BTN} ${panel === p ? "bg-ink/10" : ""}`}
            onClick={() => setPanel(panel === p ? null : p)}
            aria-pressed={panel === p}
          >
            {p === "teacher" ? "Ask AI teacher" : p === "sources" ? "Sources" : "Transcript"}
          </button>
        ))}
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
          <section
            aria-label="Lesson visual"
            className="relative flex min-h-[340px] flex-1 items-center justify-center overflow-hidden rounded-3xl bg-cream/60 p-6 shadow-inner ring-1 ring-ink/10"
          >
            <div className="w-full">
              <VisualRenderer visual={scene.visual} progress={started ? n.progress : 0} />
            </div>
            {!started && (
              <button
                type="button"
                onClick={toggle}
                className="absolute inset-0 grid place-items-center bg-parchment/60 backdrop-blur-sm"
              >
                <span className={PRIMARY}>▶ Start the lesson</span>
              </button>
            )}
          </section>

          {captionsOn && (
            <p
              className="min-h-[3.5rem] rounded-2xl bg-ink/85 px-4 py-3 text-center text-base text-cream"
              aria-live="polite"
            >
              {n.caption || (started ? "…" : "Captions appear here as the teacher speaks.")}
            </p>
          )}

          {showQuestion && (
            <Question
              key={scene.id}
              q={scene.interaction!}
              onDone={completeQuestion}
              onPick={(i) => void trackQuizAnswer(lesson, scene, i)}
            />
          )}

          <nav aria-label="Scenes" className="flex gap-1">
            {lesson.scenes.map((s, i) => (
              <button
                key={s.id}
                type="button"
                title={s.title}
                aria-label={`Scene ${i + 1}: ${s.title}`}
                aria-current={i === index ? "step" : undefined}
                onClick={() => go(i)}
                className="h-2 flex-1 overflow-hidden rounded-full bg-ink/15"
              >
                <span
                  className="block h-full bg-wood transition-[width] duration-300"
                  style={{
                    width: `${i < index ? 100 : i === index ? Math.round(n.progress * 100) : 0}%`,
                  }}
                />
              </button>
            ))}
          </nav>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              className={BTN}
              onClick={() => go(index - 1)}
              disabled={index === 0}
              aria-label="Previous scene"
            >
              ⏮
            </button>
            <button
              type="button"
              className={PRIMARY}
              onClick={toggle}
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? "❚❚ Pause" : n.state === "ended" ? "↻ Replay" : "▶ Play"}
            </button>
            <button
              type="button"
              className={BTN}
              onClick={n.restart}
              aria-label="Replay this scene"
            >
              ↺
            </button>
            <button
              type="button"
              className={BTN}
              onClick={() => go(index + 1)}
              disabled={last}
              aria-label="Next scene"
            >
              ⏭
            </button>
            <label className="flex items-center gap-1 text-sm text-ink-soft">
              Speed
              <select
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="rounded-lg bg-white/70 px-2 py-1 ring-1 ring-ink/15"
              >
                {[0.75, 1, 1.25, 1.5].map((r) => (
                  <option key={r} value={r}>
                    {r}×
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-1 text-sm text-ink-soft">
              Volume
              <input
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                className="w-20 accent-wood"
              />
            </label>
            <button
              type="button"
              className={BTN}
              onClick={() => setCaptionsOn((c) => !c)}
              aria-pressed={captionsOn}
            >
              CC
            </button>
          </div>
          {n.state === "ended" && !showQuestion && !last && (
            <div className="text-center">
              <button type="button" className={PRIMARY} onClick={() => go(index + 1)}>
                Next scene →
              </button>
            </div>
          )}
          {complete && (
            <p className="text-center font-bold text-sage-dark">Lesson complete. Nice work!</p>
          )}
          <p className="text-center text-xs text-ink-soft">
            {n.mode === "elevenlabs"
              ? "Narrated by an AI voice."
              : "Narrated by your browser's voice."}{" "}
            AI-made lessons can contain mistakes: check the sources.
          </p>
        </main>

        {panel && (
          <aside
            className="w-full border-t border-ink/10 bg-cream/70 p-4 lg:w-96 lg:border-t-0 lg:border-l"
            aria-label={panel}
          >
            {panel === "teacher" && (
              <div className="h-[60vh] lg:h-[calc(100dvh-6rem)]">
                <Teacher lesson={lesson} scene={scene} chunks={chunks} />
              </div>
            )}
            {panel === "sources" && (
              <div className="space-y-3 text-sm">
                <h2 className="font-display text-lg font-semibold">Where this comes from</h2>
                {scene.sourceReferences.length === 0 && (
                  <p className="text-ink-soft">This scene has no page references.</p>
                )}
                {scene.sourceReferences.map((r, i) => (
                  <div key={i} className="rounded-xl bg-white/70 p-3 ring-1 ring-ink/10">
                    <div className="font-bold">Page {r.page}</div>
                    {r.excerpt && <p className="mt-1 italic text-ink-soft">“{r.excerpt}”</p>}
                    <p className="mt-1 line-clamp-6 text-ink-soft">
                      {chunks.find((c) => c.page === r.page)?.text}
                    </p>
                  </div>
                ))}
                {lesson.warnings && lesson.warnings.length > 0 && (
                  <div className="rounded-xl bg-ember/10 p-3 text-ink">
                    <div className="font-bold">Notes on the material</div>
                    <ul className="ml-4 list-disc">
                      {lesson.warnings.map((w) => (
                        <li key={w}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {panel === "transcript" && (
              <ol className="max-h-[70vh] space-y-3 overflow-y-auto text-sm">
                {lesson.scenes.map((s, i) => (
                  <li key={s.id} className={i === index ? "rounded-xl bg-lamp/40 p-2" : "p-2"}>
                    <button
                      type="button"
                      className="font-bold text-ink hover:underline"
                      onClick={() => go(i)}
                    >
                      {i + 1}. {s.title}
                    </button>
                    <p className="text-ink-soft">{s.narration}</p>
                  </li>
                ))}
              </ol>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
