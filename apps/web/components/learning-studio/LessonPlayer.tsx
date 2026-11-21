"use client";

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconFile,
  IconGraduationCap,
  IconList,
  IconPause,
  IconPlay,
  IconRefresh,
  IconSend,
  IconWarning,
} from "@/components/ui/icons";
import {
  BODY,
  BTN,
  BTN_SM,
  DIVIDER,
  FOCUS,
  ICON_BTN,
  INPUT,
  PANEL,
  RIBBON,
  TAG,
} from "@/components/ui/styles";
import { quizCheckNote } from "@/lib/learning-studio/quizCheck";
import type { Chunk, Interaction, Lesson, QuizCheck, Scene } from "@/lib/learning-studio/schema";
import { topChunks } from "@/lib/learning-studio/text";
import { type LessonPlayback, useLessonPlayback } from "@/lib/learning-studio/useLessonPlayback";
import { VisualRenderer } from "./visuals";
import { trackQuizAnswer } from "@/lib/learning/client";

/** A 40px icon-only control in the player's transport row (always pass an aria-label). */
const CONTROL_BTN = ICON_BTN;

/**
 * An on/off toggle (the side panels, captions): a chunky key that stays pressed in, leaf
 * coloured, while it's on.
 */
const TOGGLE = `inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-[12px] border-2 border-walnut px-3.5 font-display text-[13.5px] font-semibold whitespace-nowrap text-walnut transition-[background-color,transform,box-shadow] duration-150 ease-out motion-reduce:transition-none ${FOCUS}`;
const TOGGLE_ON = "translate-y-[2px] bg-leaf shadow-[0_1px_0_#1f1a16]";
const TOGGLE_OFF =
  "bg-surface shadow-[0_3px_0_#1f1a16] hover:-translate-y-px hover:bg-canvas active:translate-y-[2px] active:shadow-[0_1px_0_#1f1a16]";

/** Dashed walnut lines between stacked items. */
const DIVIDE_Y = "divide-walnut/15";

/** A small keycap for the shortcut hints. */
const KBD_SM = "kbd !h-5 !min-w-5 !px-1 !text-[0.68rem]";

/** A flat coral for a wrong answer (walnut text on it keeps AA contrast). */
const WRONG_FILL = "bg-[#f0b3a6]";
/** A light sun callout for quoted or suggested text. */
const CALLOUT = "rounded-[14px] border-2 border-walnut bg-sun/35 px-3.5 py-2.5 text-walnut";

/** Chunky option buttons that lift on hover and press down on click, until answered. */
const OPTION_PRESS =
  "hover:-translate-y-px active:translate-y-[3px] active:shadow-[0_1px_0_#1f1a16]";
const HUD_OPTION_PRESS =
  "hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_rgb(0_0_0/0.55)]";
/** Small keys on the walnut HUD card. */
const HUD_SMALL = `inline-flex h-8 items-center gap-1.5 rounded-[10px] border-2 border-black/80 px-3 font-display text-[13px] font-semibold shadow-[0_2px_0_rgb(0_0_0/0.55)] transition-[background-color,transform,box-shadow] duration-150 active:translate-y-[2px] active:shadow-none motion-reduce:transition-none ${FOCUS}`;

/**
 * The knowledge check's class sets: a cream card in the player, and `compact`, a small walnut
 * sticker for the HUD over the library (where it's answered with the number keys).
 */
const QUESTION_STYLES = {
  regular: {
    card: `${PANEL} relative min-w-0 p-5 pt-7 sm:p-6 sm:pt-8`,
    /** The card's type, as a ribbon on its top edge. */
    eyebrow: `${RIBBON} absolute -top-3.5 left-5`,
    text: "font-display text-[19px] leading-7 font-semibold text-walnut",
    /** The feedback line's type, without a colour: `good` / `bad` give it one. */
    feedbackText:
      "w-fit -rotate-1 rounded-full border-2 border-walnut px-3 py-0.5 font-display text-[17px] leading-7 font-semibold text-walnut shadow-[0_3px_0_#1f1a16]",
    note: BODY,
    answer: `${CALLOUT} text-[15px] leading-6 font-medium`,
    gap: "mt-4",
    smallGap: "mt-3",
    field:
      "w-full resize-y rounded-[14px] border-[3px] border-walnut bg-white p-3 text-[15px] leading-6 font-medium text-walnut shadow-[inset_0_3px_0_rgb(31_26_22/0.08)] outline-none placeholder:text-ink-soft focus-visible:ring-4 focus-visible:ring-sun",
    rows: 3,
    options: "gap-3 sm:grid-cols-2",
    option: `flex w-full items-start gap-3 rounded-[16px] border-[3px] px-3.5 py-3 text-left text-[15px] leading-6 font-semibold transition-[background-color,color,transform,box-shadow] duration-150 ease-out disabled:cursor-default motion-reduce:transition-none ${FOCUS}`,
    idle: `border-walnut bg-surface text-walnut shadow-[0_4px_0_#1f1a16] hover:bg-canvas ${OPTION_PRESS}`,
    right: "border-walnut bg-leaf text-walnut shadow-[0_4px_0_#1f1a16]",
    wrong: `border-walnut ${WRONG_FILL} text-walnut shadow-[0_4px_0_#1f1a16]`,
    rest: "border-walnut/30 bg-surface text-ink-soft",
    marker:
      "mt-px grid size-7 shrink-0 place-items-center rounded-full border-2 border-walnut bg-sun font-display text-[13px] font-bold text-walnut tabular",
    tag: "font-display text-[13px] font-semibold",
    tagRight: "",
    tagWrong: "",
    good: "bg-leaf",
    bad: WRONG_FILL,
    btn: BTN_SM.secondary,
    primary: BTN.primary,
    badge: `${TAG.forest} mt-3 gap-1 shadow-[0_2px_0_#1f1a16]`,
  },
  compact: {
    card: "w-full min-w-0 max-w-sm rounded-[20px] border-[3px] border-black/80 bg-walnut/95 p-3.5 text-walnut-text shadow-[0_5px_0_rgb(0_0_0/0.55)]",
    eyebrow: null,
    text: "font-display text-[15px] leading-5 font-semibold text-walnut-text",
    feedbackText:
      "w-fit rounded-full border-2 border-black/80 px-2.5 py-px font-display text-sm leading-5 font-semibold text-walnut shadow-[0_2px_0_rgb(0_0_0/0.55)]",
    note: "text-xs leading-5 font-medium text-walnut-muted",
    answer:
      "rounded-[12px] border-2 border-black/80 bg-walnut-key px-2.5 py-1.5 text-xs leading-5 font-medium text-walnut-text",
    gap: "mt-2.5",
    smallGap: "mt-2",
    field:
      "w-full resize-none rounded-[12px] border-2 border-black/80 bg-surface p-2 text-[13px] leading-5 font-medium text-walnut outline-none placeholder:text-ink-soft focus-visible:ring-4 focus-visible:ring-sun",
    rows: 2,
    options: "gap-2",
    option: `flex w-full items-start gap-2.5 rounded-[14px] border-2 px-2.5 py-2 text-left text-[13px] leading-5 font-semibold transition-[background-color,color,transform,box-shadow] duration-150 ease-out disabled:cursor-default motion-reduce:transition-none ${FOCUS}`,
    idle: `border-black/80 bg-walnut-key text-walnut-text shadow-[0_3px_0_rgb(0_0_0/0.55)] hover:bg-[#4a423b] ${HUD_OPTION_PRESS}`,
    right: "border-black/80 bg-leaf text-walnut shadow-[0_3px_0_rgb(0_0_0/0.55)]",
    wrong: `border-black/80 ${WRONG_FILL} text-walnut shadow-[0_3px_0_rgb(0_0_0/0.55)]`,
    rest: "border-walnut-key-edge/50 text-walnut-muted",
    marker: "kbd kbd-dark mt-px !h-5 !min-w-5 !px-1 !text-[0.68rem]",
    tag: "font-display text-xs font-semibold",
    tagRight: "",
    tagWrong: "",
    good: "bg-leaf",
    bad: WRONG_FILL,
    btn: `${HUD_SMALL} bg-walnut-key text-walnut-text hover:bg-[#4a423b]`,
    primary: `${HUD_SMALL} bg-sun text-walnut hover:bg-[#f6d98f]`,
    badge:
      "mt-1.5 inline-flex items-center gap-1 rounded-full border-2 border-black/80 bg-leaf px-2 py-px font-display text-[11px] leading-4 font-semibold text-walnut",
  },
};

/** Where a question's quote comes from, as the student reads it. */
const QUOTE_LABEL: Record<QuizCheck["from"], string> = {
  notes: "From your notes:",
  sources: "From the sources:",
};

/**
 * The knowledge check shown once the scene's narration reaches it. `hotkeys` lets it be answered
 * from the keyboard (1–5 pick an option, Enter continues) for when the mouse is busy steering the
 * library camera; the options are then numbered to match. Letter keys are deliberately not used:
 * A, B, D and E already walk, open the whiteboard and sit in the library.
 *
 * A wrong first pick shows the question's hint and allows one more try before the answer is
 * revealed (Enter, or "Show the answer", reveals it at once). Only the first pick is reported
 * through `onPick`: first-try correctness is what counts for mastery. After the answer is shown,
 * the question's quote (words from the notes or sources, grounded on the server) backs it up.
 * A question the self-check confirmed wears a "Double-checked by Ms. Fenwick" badge; one it
 * couldn't confirm says so once answered.
 */
export function Question({
  q,
  onDone,
  onPick,
  hotkeys = false,
  compact = false,
  quoteFrom = "notes",
}: {
  q: Interaction;
  onDone: () => void;
  /** The first option picked (the answer that counts). Not called again for the second try. */
  onPick?: (index: number) => void;
  hotkeys?: boolean;
  compact?: boolean;
  /** What the lesson was made from, for the quote's label (lesson.quizCheck?.from). */
  quoteFrom?: QuizCheck["from"];
}) {
  /** Options picked, in order: at most two (a wrong first try, then one more). */
  const [picks, setPicks] = useState<number[]>([]);
  const [gaveUp, setGaveUp] = useState(false);
  const [shown, setShown] = useState(false);
  const s = QUESTION_STYLES[compact ? "compact" : "regular"];
  const solved = picks.includes(q.correctIndex ?? -1);
  const revealed = solved || picks.length >= 2 || gaveUp;
  const retrying = picks.length === 1 && !revealed;

  const choose = useCallback(
    (i: number) => {
      setPicks((p) => (p.includes(i) || p.length >= 2 ? p : [...p, i]));
      if (picks.length === 0) onPick?.(i);
    },
    [picks.length, onPick],
  );

  // A compact card may be too short for the feedback and its Continue button, and it can't be
  // scrolled while the mouse is steering the camera: bring them into view once an answer is in.
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (compact && picks.length > 0) feedback.current?.scrollIntoView({ block: "nearest" });
  }, [compact, picks.length, revealed]);

  useEffect(() => {
    if (!hotkeys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement)?.closest?.("input, textarea, select, [contenteditable]"))
        return;
      if (e.key === "Enter") {
        if (q.type === "reflection" || revealed) {
          // Also stops a focused button turning this Enter into a second click.
          e.preventDefault();
          onDone();
        } else if (retrying) {
          e.preventDefault();
          setGaveUp(true);
        }
        return;
      }
      const digit = /^(?:Digit|Numpad)([1-5])$/.exec(e.code);
      if (!digit || q.type !== "multiple-choice" || revealed) return;
      const i = Number(digit[1]) - 1;
      if (i < q.options!.length && !picks.includes(i)) {
        e.preventDefault();
        choose(i);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hotkeys, q, picks, revealed, retrying, choose, onDone]);

  const continueButton = (
    <button
      type="button"
      className={`${s.primary} ${s.gap}`}
      onClick={onDone}
      aria-keyshortcuts={hotkeys ? "Enter" : undefined}
    >
      Continue
      <IconArrowRight size={compact ? 14 : 16} />
    </button>
  );
  const quote = q.quote && (
    <p className={`${s.smallGap} ${s.answer}`}>
      <span className="font-display font-semibold">{QUOTE_LABEL[quoteFrom]}</span> “{q.quote}”
    </p>
  );
  const badge = (q.check === "verified" || q.check === "fixed") && (
    <p className={s.badge}>
      <IconCheck size={compact ? 12 : 14} strokeWidth={3} />
      Double-checked by Ms. Fenwick
    </p>
  );
  if (q.type === "reflection") {
    return (
      <div className={s.card}>
        {s.eyebrow && (
          <p aria-hidden className={`${s.eyebrow} mb-1.5`}>
            Reflection
          </p>
        )}
        <p className={s.text}>{q.question}</p>
        <textarea
          className={`${s.gap} ${s.field}`}
          rows={s.rows}
          placeholder="Jot down your thoughts…"
        />
        {q.suggestedAnswer && (
          <button type="button" className={`${s.btn} ${s.smallGap}`} onClick={() => setShown(true)}>
            Show a suggested answer
          </button>
        )}
        {shown && <p className={`${s.smallGap} ${s.answer}`}>{q.suggestedAnswer}</p>}
        {shown && quote}
        <div>{continueButton}</div>
      </div>
    );
  }
  const where = quoteFrom === "sources" ? "the sources" : "your notes";
  return (
    <fieldset className={s.card}>
      <legend className="sr-only">Knowledge check</legend>
      {s.eyebrow && (
        <p aria-hidden className={`${s.eyebrow} mb-1.5`}>
          Knowledge check
        </p>
      )}
      <p className={s.text}>{q.question}</p>
      {badge}
      <div className={`${s.gap} ${s.options} grid`}>
        {q.options!.map((opt, i) => {
          const isRight = revealed && i === q.correctIndex;
          const isWrong = picks.includes(i) && i !== q.correctIndex;
          const state = isRight ? s.right : isWrong ? s.wrong : revealed ? s.rest : s.idle;
          return (
            <button
              key={opt}
              type="button"
              disabled={revealed || picks.includes(i)}
              onClick={() => choose(i)}
              className={`${s.option} ${state}`}
              aria-pressed={picks.includes(i)}
              aria-keyshortcuts={hotkeys ? String(i + 1) : undefined}
            >
              <span className={s.marker}>
                {hotkeys ? i + 1 : String.fromCharCode(65 + i)}
                <span className="sr-only">.</span>
              </span>
              <span className="min-w-0 flex-1">{opt}</span>
              {/* State in words and an icon, never colour alone. */}
              {isRight && (
                <span
                  aria-hidden
                  className={`flex shrink-0 items-center gap-1 self-center ${s.tag}`}
                >
                  <IconCheck size={16} className={s.tagRight} />
                  Correct
                </span>
              )}
              {isWrong && (
                <span
                  aria-hidden
                  className={`flex shrink-0 items-center gap-1 self-center ${s.tag}`}
                >
                  <IconClose size={16} className={s.tagWrong} />
                  {i === picks[0] ? "Your answer" : "Second try"}
                </span>
              )}
              {isRight && <span className="sr-only"> (correct answer)</span>}
              {isWrong && <span className="sr-only"> (not this one)</span>}
            </button>
          );
        })}
      </div>
      {picks.length > 0 && (
        <div ref={feedback} className={s.gap} role="status">
          {retrying ? (
            <>
              <p className={`flex items-center gap-1.5 ${s.feedbackText} ${s.bad}`}>
                <IconClose size={18} />
                Not quite. One more try.
              </p>
              <p className={`mt-1 ${s.note}`}>
                {q.hint ? (
                  <>
                    <span className="font-display font-semibold">Hint:</span> {q.hint}
                  </>
                ) : (
                  "Have another look at the options that are left."
                )}
              </p>
              <button
                type="button"
                className={`${s.btn} ${s.smallGap}`}
                onClick={() => setGaveUp(true)}
                aria-keyshortcuts={hotkeys ? "Enter" : undefined}
              >
                Show the answer
              </button>
            </>
          ) : (
            <>
              <p
                className={`flex items-center gap-1.5 ${s.feedbackText} ${solved ? s.good : s.bad}`}
              >
                {solved ? <IconCheck size={18} /> : <IconClose size={18} />}
                {solved
                  ? picks.length === 1
                    ? "Correct."
                    : "Got it on the second try."
                  : "Not quite."}
              </p>
              {q.explanation && <p className={`mt-1 ${s.note}`}>{q.explanation}</p>}
              {quote}
              {q.check === "unsure" && (
                <p className={`${s.smallGap} flex items-start gap-1.5 ${s.note}`}>
                  <IconWarning size={14} strokeWidth={2.25} className="mt-1 shrink-0" />
                  Ms. Fenwick couldn&apos;t confirm this answer in {where}, so check it there.
                </p>
              )}
              {continueButton}
            </>
          )}
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
        { role: "teacher", text: "I couldn't answer just now. Try again in a moment." },
      ]);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1" aria-live="polite">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className={BODY}>
              Ask about this scene or your notes. Answers come from your notes, with page
              references.
            </p>
            <div className="flex flex-wrap gap-2">
              {["Explain that more simply", "Give me another example", "Quiz me on this scene"].map(
                (s) => (
                  <button
                    key={s}
                    type="button"
                    className={BTN_SM.secondary}
                    onClick={() => void ask(s)}
                  >
                    {s}
                  </button>
                ),
              )}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded-[16px] border-2 border-walnut px-3.5 py-2.5 text-[15px] leading-6 font-medium text-walnut ${m.role === "student" ? "ml-8 rounded-br-[6px] bg-sun/45" : "mr-4 rounded-bl-[6px] bg-surface shadow-[0_3px_0_#1f1a16]"}`}
          >
            {m.text}
            {m.pages && m.pages.length > 0 && (
              <div className="mt-1.5 flex items-center gap-1.5 font-display text-[13px] font-medium text-ink-soft">
                <IconFile size={14} strokeWidth={2.25} />
                <span className="tabular">From your notes: p. {m.pages.join(", ")}</span>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <p className="flex items-center gap-2 font-display text-[13.5px] font-medium text-ink-soft">
            {/* Three bouncing dots (still with reduced motion). */}
            <span aria-hidden className="flex items-center gap-1">
              {[0, 150, 300].map((delay) => (
                <span
                  key={delay}
                  className="h-2 w-2 rounded-full border-[1.5px] border-walnut bg-sun motion-safe:animate-bounce"
                  style={{ animationDelay: `${delay}ms` }}
                />
              ))}
            </span>
            Thinking…
          </p>
        )}
      </div>
      <form
        className={`mt-3 flex gap-2 border-t-2 border-dashed ${DIVIDER} pt-3`}
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          maxLength={500}
          placeholder="Ask Ms. Fenwick…"
          aria-label="Ask Ms. Fenwick about this lesson"
          className={`${INPUT} min-w-0 flex-1`}
        />
        <button type="submit" className={BTN.secondary} disabled={busy}>
          <IconSend size={16} />
          Ask
        </button>
      </form>
    </div>
  );
}

/** A side panel's icon on a little tilted sun sticker. */
function PanelBadge({ Icon }: { Icon: (typeof SIDE_PANELS)[keyof typeof SIDE_PANELS]["Icon"] }) {
  return (
    <span
      aria-hidden
      className="grid h-9 w-9 shrink-0 -rotate-6 place-items-center rounded-[12px] border-2 border-walnut bg-sun text-walnut shadow-[0_3px_0_#1f1a16]"
    >
      <Icon size={18} strokeWidth={2.25} />
    </span>
  );
}

export interface PlayerProps {
  lesson: Lesson;
  chunks: Chunk[];
  startScene?: number;
  onProgress?: (scene: number, completed: boolean) => void;
  onExit: () => void;
  /** Stored narration by scene index (a cloud lesson's MP3s), played instead of new speech. */
  audio?: Readonly<Record<number, string>>;
  exitLabel?: string;
  /** Size to the container (the in-library book) instead of the full page. */
  fill?: boolean;
}

/** The Learning Studio's player: its own playback, shown full page (or filling a container). */
export function LessonPlayer({
  lesson,
  chunks,
  startScene = 0,
  onProgress,
  onExit,
  audio,
  exitLabel,
  fill,
}: PlayerProps) {
  const playback = useLessonPlayback(lesson, { startScene, onProgress, audio });
  return (
    <LessonPlayerView
      playback={playback}
      chunks={chunks}
      onExit={onExit}
      exitLabel={exitLabel}
      fill={fill}
    />
  );
}

const SIDE_PANELS = {
  sources: { label: "Sources", heading: "Where this comes from", Icon: IconFile },
  transcript: { label: "Transcript", heading: "Transcript", Icon: IconList },
  teacher: { label: "Ask Ms. Fenwick", heading: "Ask Ms. Fenwick", Icon: IconGraduationCap },
} as const;

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
  exitLabel = "All lessons",
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

  // Callers may still pass a label with an arrow glyph in front; the icon draws the arrow now.
  const exitText = exitLabel.replace(/^[←↙↖⬅]\s*/u, "");
  const ended = n.state === "ended";
  // Once a scene's narration has ended, "Next scene" (or the question) is the main action.
  const nextUp = ended && !showQuestion && !last;
  const total = lesson.scenes.length;
  const quizNote = quizCheckNote(lesson.quizCheck);

  return (
    <div className={`flex flex-col bg-canvas ${fill ? "h-full overflow-y-auto" : "min-h-dvh"}`}>
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-3 border-b-[3px] border-walnut bg-surface px-4 py-3 sm:px-6">
        <button type="button" className={`${BTN.quiet} -ml-2`} onClick={onExit}>
          <IconArrowLeft size={18} strokeWidth={2.5} />
          {exitText}
        </button>
        <div className="min-w-0 flex-1 sm:border-l-[3px] sm:border-walnut/15 sm:pl-4">
          <h1 className="truncate font-display text-[22px] leading-7 font-bold text-walnut">
            {lesson.title}
          </h1>
          <p className="truncate font-display text-[13.5px] leading-5 font-medium text-ink-soft">
            <span className="tabular">
              Scene {index + 1} of {total}
            </span>{" "}
            · {scene.title}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerActions}
          {headerActions && (
            <span
              aria-hidden
              className="mx-1 hidden h-7 w-[3px] rounded-full bg-walnut/15 sm:block"
            />
          )}
          {(["sources", "transcript", "teacher"] as const).map((p) => {
            const { label, Icon } = SIDE_PANELS[p];
            return (
              <button
                key={p}
                type="button"
                className={`${TOGGLE} ${panel === p ? TOGGLE_ON : TOGGLE_OFF}`}
                onClick={() => setPanel(panel === p ? null : p)}
                aria-pressed={panel === p}
              >
                <Icon size={16} strokeWidth={2.25} />
                {label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <main className="flex min-w-0 flex-1 flex-col p-4 sm:p-6 lg:px-8">
          <div className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-4">
            {/* The stage: the scene's visual, with the narration's captions under it, and the
                scene number as a ribbon on its top edge. */}
            <div className="relative mt-2 flex flex-1 flex-col">
              <p aria-hidden className={`${RIBBON} tabular absolute -top-3.5 left-6 z-[2]`}>
                Scene {index + 1}
              </p>
              <div className={`${PANEL} flex flex-1 flex-col overflow-hidden`}>
                <section
                  aria-label="Lesson visual"
                  className="relative flex min-h-[340px] flex-1 items-center justify-center p-6 sm:p-10"
                >
                  <div className="w-full">
                    <VisualRenderer visual={scene.visual} progress={started ? n.progress : 0} />
                  </div>
                  {!started && (
                    <button
                      type="button"
                      onClick={toggle}
                      className="group absolute inset-0 grid place-items-center bg-canvas/85 outline-none focus-visible:ring-4 focus-visible:ring-sun focus-visible:ring-inset"
                    >
                      <span
                        className={`${BTN.primary} title-pop pointer-events-none group-hover:-translate-y-0.5 group-hover:bg-[#f6d98f] group-active:translate-y-[3px] group-active:shadow-[0_1px_0_#1f1a16]`}
                      >
                        <IconPlay size={18} strokeWidth={2.5} />
                        Start the lesson
                      </span>
                    </button>
                  )}
                </section>

                {captionsOn && (
                  <div className={`border-t-2 border-dashed ${DIVIDER} px-5 py-4 sm:px-8`}>
                    <p
                      className={`mx-auto min-h-[3.5rem] max-w-[68ch] text-center text-[17px] leading-7 font-semibold ${n.caption ? "text-walnut" : "text-ink-soft"}`}
                      aria-live="polite"
                    >
                      {n.caption || (started ? "…" : "Captions appear here as the teacher speaks.")}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {showQuestion && (
              <Question
                key={scene.id}
                q={scene.interaction!}
                onDone={completeQuestion}
                onPick={(i) => void trackQuizAnswer(lesson, scene, i)}
                quoteFrom={lesson.quizCheck?.from}
              />
            )}

            <nav aria-label="Scenes" className="flex gap-1.5">
              {lesson.scenes.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  title={s.title}
                  aria-label={`Scene ${i + 1}: ${s.title}`}
                  aria-current={i === index ? "step" : undefined}
                  onClick={() => go(i)}
                  className={`group flex h-7 flex-1 items-center rounded-full ${FOCUS}`}
                >
                  <span
                    className={`block h-3.5 w-full overflow-hidden rounded-full border-2 border-walnut transition-[background-color,transform] duration-150 group-hover:-translate-y-px group-hover:bg-sun/40 motion-reduce:transition-none ${i === index ? "bg-canvas shadow-[0_2px_0_#1f1a16]" : "bg-surface"}`}
                  >
                    <span
                      className={`block h-full rounded-full transition-[width] duration-300 motion-reduce:transition-none ${i < index ? "bg-leaf" : "bg-sun"}`}
                      style={{
                        width: `${i < index ? 100 : i === index ? Math.round(n.progress * 100) : 0}%`,
                      }}
                    />
                  </span>
                </button>
              ))}
            </nav>

            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={CONTROL_BTN}
                  onClick={() => go(index - 1)}
                  disabled={index === 0}
                  aria-label="Previous scene"
                  title="Previous scene"
                >
                  <IconChevronLeft />
                </button>
                <button
                  type="button"
                  className={`${ended ? BTN.secondary : BTN.primary} min-w-[7.5rem]`}
                  onClick={toggle}
                  aria-label={playing ? "Pause" : ended ? "Replay" : "Play"}
                >
                  {playing ? (
                    <>
                      <IconPause size={18} />
                      Pause
                    </>
                  ) : ended ? (
                    <>
                      <IconRefresh size={18} />
                      Replay
                    </>
                  ) : (
                    <>
                      <IconPlay size={18} />
                      Play
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className={CONTROL_BTN}
                  onClick={n.restart}
                  aria-label="Replay this scene"
                  title="Replay this scene"
                >
                  <IconRefresh />
                </button>
                <button
                  type="button"
                  className={CONTROL_BTN}
                  onClick={() => go(index + 1)}
                  disabled={last}
                  aria-label="Next scene"
                  title="Next scene"
                >
                  <IconChevronRight />
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                <label className="flex items-center gap-2 font-display text-[13.5px] font-semibold text-ink-soft">
                  Speed
                  <select
                    value={rate}
                    onChange={(e) => setRate(Number(e.target.value))}
                    className={`tabular h-10 rounded-[12px] border-2 border-walnut bg-surface px-2 font-display text-[13.5px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16] ${FOCUS}`}
                  >
                    {[0.75, 1, 1.25, 1.5].map((r) => (
                      <option key={r} value={r}>
                        {r}×
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 font-display text-[13.5px] font-semibold text-ink-soft">
                  Volume
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.1}
                    value={volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                    className="w-24 cursor-pointer rounded-full accent-tangerine outline-none focus-visible:ring-4 focus-visible:ring-sun focus-visible:ring-offset-2 focus-visible:ring-offset-walnut"
                  />
                </label>
                <button
                  type="button"
                  className={`${TOGGLE} ${captionsOn ? TOGGLE_ON : TOGGLE_OFF}`}
                  onClick={() => setCaptionsOn((c) => !c)}
                  aria-pressed={captionsOn}
                >
                  Captions
                </button>
              </div>
            </div>

            {nextUp && (
              <div className="title-pop text-center">
                <button type="button" className={BTN.primary} onClick={() => go(index + 1)}>
                  Next scene
                  <IconArrowRight size={18} strokeWidth={2.5} />
                </button>
              </div>
            )}
            {complete && (
              <p className="title-pop flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-[15px] text-walnut">
                {/* A tilted leaf stamp, like the title screen's stickers. */}
                <span className="inline-flex -rotate-2 items-center gap-1.5 rounded-full border-[3px] border-walnut bg-leaf px-3.5 py-1 font-display text-[16px] font-semibold shadow-[0_4px_0_#1f1a16]">
                  <IconCheck size={18} strokeWidth={2.75} />
                  Lesson complete.
                </span>{" "}
                <span className="font-medium text-ink-soft">
                  Choose any scene above to go over it again.
                </span>
              </p>
            )}

            <div className="mt-auto flex flex-col items-center gap-2 pt-2 text-center text-xs leading-5 font-medium text-ink-soft">
              {keyboardShortcuts && (
                <p className="hidden flex-wrap items-center justify-center gap-x-4 gap-y-1 font-display sm:flex">
                  <span className="flex items-center gap-1.5">
                    <kbd className={KBD_SM}>Space</kbd> play or pause
                  </span>
                  <span className="flex items-center gap-1.5">
                    <kbd className={KBD_SM}>
                      <IconChevronLeft size={12} />
                      <span className="sr-only">Left arrow</span>
                    </kbd>
                    <kbd className={KBD_SM}>
                      <IconChevronRight size={12} />
                      <span className="sr-only">Right arrow</span>
                    </kbd>
                    scenes
                  </span>
                  <span className="flex items-center gap-1.5">
                    <kbd className={KBD_SM}>R</kbd> replay the scene
                  </span>
                  <span className="flex items-center gap-1.5">
                    <kbd className={KBD_SM}>C</kbd> captions
                  </span>
                </p>
              )}
              <p>
                {n.mode === "elevenlabs"
                  ? "Narrated by Ms. Fenwick."
                  : n.mode === "text"
                    ? "No voice is available, so the narration is shown as text."
                    : "Narrated by your browser's voice."}{" "}
                {quizNote && `${quizNote} `}
                Lessons can contain mistakes: check the sources.
              </p>
            </div>
          </div>
        </main>

        {panel && (
          <aside
            className="w-full border-t-[3px] border-walnut bg-surface lg:w-[384px] lg:shrink-0 lg:border-t-0 lg:border-l-[3px]"
            aria-label={panel}
          >
            <div className="px-5 pt-5 pb-6">
              <h2 className="mb-4 flex items-center gap-2.5 font-display text-[20px] leading-7 font-bold text-walnut">
                <PanelBadge Icon={SIDE_PANELS[panel].Icon} />
                {SIDE_PANELS[panel].heading}
              </h2>
              {panel === "teacher" && (
                <div className="h-[60vh] lg:h-[calc(100dvh-10rem)]">
                  <Teacher lesson={lesson} scene={scene} chunks={chunks} />
                </div>
              )}
              {panel === "sources" && (
                <div className="text-[15px] leading-6">
                  {scene.sourceReferences.length === 0 && (
                    <p className="font-medium text-ink-soft">This scene has no page references.</p>
                  )}
                  <div className={`divide-y-2 divide-dashed ${DIVIDE_Y}`}>
                    {scene.sourceReferences.map((r, i) => (
                      <div key={i} className="py-4 first:pt-0">
                        <p className={`${TAG.neutral} gap-1.5 shadow-[0_2px_0_#1f1a16]`}>
                          <IconFile size={14} strokeWidth={2.25} />
                          <span className="tabular">Page {r.page}</span>
                        </p>
                        {r.excerpt && (
                          <p className={`mt-2.5 ${CALLOUT} font-medium`}>“{r.excerpt}”</p>
                        )}
                        <p className="mt-2 line-clamp-6 text-[14px] leading-6 font-medium text-ink-soft">
                          {chunks.find((c) => c.page === r.page)?.text}
                        </p>
                      </div>
                    ))}
                  </div>
                  {lesson.warnings && lesson.warnings.length > 0 && (
                    <div className="mt-4 rounded-[16px] border-2 border-walnut bg-canvas p-3.5 text-walnut">
                      <div className="flex items-center gap-2 font-display font-semibold">
                        <IconWarning size={18} strokeWidth={2.25} className="text-warning" />
                        Notes on the material
                      </div>
                      <ul className="mt-1.5 ml-5 list-disc text-[14px] leading-6 font-medium text-ink-soft">
                        {lesson.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              {panel === "transcript" && (
                <ol className="max-h-[70vh] space-y-1 overflow-y-auto">
                  {lesson.scenes.map((s, i) => (
                    <li
                      key={s.id}
                      className={`rounded-[16px] border-2 px-3 py-2.5 ${i === index ? "border-walnut bg-canvas shadow-[0_3px_0_#1f1a16]" : "border-transparent"}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <button
                          type="button"
                          className={`rounded-[6px] text-left font-display text-[15.5px] leading-6 font-semibold text-walnut decoration-walnut/40 decoration-2 underline-offset-4 hover:underline ${FOCUS}`}
                          onClick={() => go(i)}
                        >
                          {i + 1}. {s.title}
                        </button>
                        {i === index && (
                          <span className={`${TAG.brass} mt-0.5 -rotate-3`}>Now</span>
                        )}
                      </div>
                      <p className="mt-1 text-[14px] leading-6 font-medium text-ink-soft">
                        {s.narration}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
