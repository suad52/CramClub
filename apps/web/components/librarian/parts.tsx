"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { IconChevronRight, IconWarning } from "@/components/ui/icons";
import { BTN, BTN_SM, EYEBROW as UI_EYEBROW, FOCUS as UI_FOCUS } from "@/components/ui/styles";
import { isFocusing, usePomodoro } from "@/lib/game/pomodoro";
import { isMuted, revealedChars, voiceAvailable } from "@/lib/librarian/voice";
import type { ActivityType, ResourceType, TaskStatus, TaskType } from "@/lib/librarian/types";

/**
 * Small shared pieces of the Librarian's panel, in the cartoon look (components/ui/styles.ts;
 * gold standard: components/entry/TitleScreen.tsx).
 */

/** A secondary button (44px). */
export const BUTTON = BTN.secondary;
/** The one main action in view (44px, sun). */
export const PRIMARY = BTN.primary;
/** A small secondary button (36px) for dense rows. */
export const TINY_BUTTON = BTN_SM.secondary;
export const EYEBROW = UI_EYEBROW;

/** An inline text link (to a source, or to a source's entry in the panel): a tangerine underline. */
export const TEXT_LINK = `rounded-[4px] font-semibold text-walnut underline decoration-tangerine decoration-2 underline-offset-[3px] transition-colors duration-150 hover:decoration-walnut ${UI_FOCUS}`;

/** The press-down motion shared by the panel's own sticker controls (they lift on hover). */
const PRESS = `transition-[background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px active:translate-y-[3px] active:shadow-[0_0_0_#1f1a16] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:translate-y-0 motion-reduce:transition-none ${UI_FOCUS}`;

/**
 * A square sticker button beside the message box (attach notes, the mic): 44px, like the input
 * and the Send button next to it. Pass the colours (`bg-…`) and an aria-label.
 */
export const SQUARE_BTN = `inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] border-[3px] border-walnut shadow-[0_4px_0_#1f1a16] disabled:active:shadow-[0_4px_0_#1f1a16] ${PRESS}`;

/** A small leaf-green sticker button (36px), for a "done" action such as completing a task. */
export const LEAF_BTN_SM = `inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[12px] border-2 border-walnut bg-leaf px-3.5 font-display text-[13.5px] font-semibold whitespace-nowrap text-walnut shadow-[0_3px_0_#1f1a16] hover:bg-[#8fbf8a] disabled:hover:bg-leaf disabled:active:shadow-[0_3px_0_#1f1a16] ${PRESS}`;

/**
 * A chunky pressable row (a reply, a way to start, a recent request): a sticker that lifts on
 * hover and presses down on click. Add a ROW_TONE.
 */
export const ROW = `group flex w-full items-center gap-3 rounded-[16px] border-[2.5px] border-walnut text-left text-walnut shadow-[0_3px_0_#1f1a16] transition-[background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_#1f1a16] disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:active:translate-y-0 disabled:active:shadow-[0_3px_0_#1f1a16] motion-reduce:transition-none ${UI_FOCUS}`;
export const ROW_TONE = {
  plain: "bg-surface hover:bg-canvas disabled:hover:bg-surface",
  main: "bg-sun hover:bg-[#f6d98f] disabled:hover:bg-sun",
} as const;

/** A warm "worth knowing" callout (setup notes, caveats): a sun-tinted sticker. */
export const NOTICE =
  "rounded-[18px] border-[2.5px] border-walnut bg-[#fdf1d6] text-walnut shadow-[0_3px_0_#1f1a16]";

/** A round icon badge (a sticker dot holding an icon). Add the size and a `bg-…`. */
export const ICON_BADGE =
  "grid shrink-0 place-items-center rounded-full border-2 border-walnut text-walnut shadow-[0_2px_0_#1f1a16]";

/** A small label on a card's top edge, in a colour of its own (RIBBON is the tangerine one). */
export const EDGE_TAG =
  "inline-flex items-center gap-1 rounded-full border-2 border-walnut px-2.5 py-px font-display text-[12px] font-semibold text-walnut shadow-[0_2px_0_#1f1a16]";

/** A row of coloured sticker dots, like the one under the title screen's logo. */
export function DotRow({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden className={`flex items-center gap-1.5 ${className}`}>
      <span className="h-2.5 w-12 rounded-full border-2 border-walnut bg-tangerine" />
      <span className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-sun" />
      <span className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-leaf" />
    </span>
  );
}

export const TYPE_LABELS: Record<TaskType, string> = {
  research_topic: "Research",
  find_resources: "Finding resources",
  create_study_plan: "Study plan",
  explain_weak_topic: "Explanation",
  research_assignment: "Assignment research",
  study_from_notes: "From your notes",
};

export const RESOURCE_LABELS: Record<ResourceType, string> = {
  article: "Article",
  video: "Video",
  course: "Course",
  paper: "Paper",
  tutorial: "Tutorial",
  documentation: "Docs",
  other: "Page",
};

export const ACTIVITY_LABELS: Record<ActivityType, string> = {
  read: "Read",
  watch: "Watch",
  lesson: "Lesson",
  practice: "Practice",
  review: "Review",
  quiz: "Quiz",
};

/** "khanacademy.org" from a link, or the link itself when it can't be read. */
export function domainOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Only web pages are ever linked (never javascript:, data: or the like from scraped content). */
const isWebLink = (url: string) => /^https?:\/\//i.test(url);

/**
 * A link to a page out on the web, in a new tab. Mid-pomodoro it's switched off with the reason
 * (leaving the tab would break the pomodoro), the same way the HUD treats the Learning Studio.
 */
export function SourceLink({
  href,
  className,
  children,
}: {
  href: string;
  className: string;
  children: React.ReactNode;
}) {
  const focusing = usePomodoro(isFocusing);
  if (!isWebLink(href)) return <span className={className}>{children}</span>;
  if (focusing) {
    return (
      <button
        type="button"
        aria-disabled="true"
        title="Available after your pomodoro"
        className={`${className} cursor-not-allowed opacity-60`}
      >
        {children}
        <span className="sr-only"> (available after your pomodoro)</span>
      </button>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

/**
 * Ms. Fenwick: a chibi face with a silver bun, round glasses and a moss cardigan, as a round
 * sticker (sun behind her, a thick walnut outline).
 */
export function Portrait({ className = "h-12 w-12" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden>
      <circle cx="32" cy="32" r="30.5" fill="#f2cf7e" />
      {/* Her cardigan, cut along the sticker's edge. */}
      <path d="M14.5 57 Q16 51 32 50 Q48 51 49.5 57 A30.5 30.5 0 0 1 14.5 57 Z" fill="#3f5f4a" />
      <path d="M27 50.5 L32 57 L37 50.5 Z" fill="#fbf7ef" />
      <circle cx="32" cy="10.5" r="7.5" fill="#cfd2d6" stroke="#1f1a16" strokeWidth="1.5" />
      <ellipse cx="32" cy="27" rx="19" ry="15.5" fill="#cfd2d6" />
      <circle cx="32" cy="32.5" r="16.5" fill="#c58c5c" />
      <path
        d="M15.6 31 Q16.5 16 32 16 Q47.5 16 48.4 31 Q43 22.5 32 22.5 Q21 22.5 15.6 31 Z"
        fill="#cfd2d6"
      />
      <path d="M22 18.5 Q27 15.5 32 16" stroke="#a9adb3" strokeWidth="1" fill="none" />
      <ellipse cx="25.2" cy="34.2" rx="1.6" ry="1.9" fill="#2d2420" />
      <ellipse cx="38.8" cy="34.2" rx="1.6" ry="1.9" fill="#2d2420" />
      <g fill="#fbf7ef" fillOpacity="0.22" stroke="#1f1a16" strokeWidth="1.8">
        <circle cx="25.2" cy="34" r="5.2" />
        <circle cx="38.8" cy="34" r="5.2" />
      </g>
      <path d="M30.4 33.6 Q32 32.6 33.6 33.6" stroke="#1f1a16" strokeWidth="1.6" fill="none" />
      <ellipse cx="20.5" cy="40.5" rx="2.6" ry="1.5" fill="#e0806f" opacity="0.45" />
      <ellipse cx="43.5" cy="40.5" rx="2.6" ry="1.5" fill="#e0806f" opacity="0.45" />
      <path
        d="M28.4 42.4 Q32 45.6 35.6 42.4"
        stroke="#2d2420"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="32" cy="32" r="30.5" fill="none" stroke="#1f1a16" strokeWidth="3" />
    </svg>
  );
}

/**
 * Idle (a leaf dot) or working (a sun dot), as little outlined stickers. Always shown next to the
 * words for the status, so the colour is never the only signal; it holds still rather than pulsing.
 */
export function StatusDot({ working }: { working: boolean }) {
  return (
    <span
      className={`inline-flex h-2.5 w-2.5 shrink-0 rounded-full border-2 border-walnut ${working ? "bg-sun" : "bg-leaf"}`}
      aria-hidden
    />
  );
}

const STATUS_TONES: Partial<Record<TaskStatus, string>> = {
  completed: "bg-leaf",
  failed: "bg-[#f3c6bf]",
  cancelled: "bg-canvas",
  awaiting_details: "bg-sun",
  awaiting_confirmation: "bg-sun",
};

/** A request's status in words, as a flat coloured pill (the words carry the meaning). */
export function StatusChip({ status, label }: { status: TaskStatus; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border-2 border-walnut px-2.5 py-0.5 font-display text-xs leading-4 font-semibold whitespace-nowrap text-walnut ${STATUS_TONES[status] ?? "bg-surface"}`}
    >
      {label}
    </span>
  );
}

const CODE =
  "rounded-[6px] border-[1.5px] border-walnut/30 bg-surface px-1 py-px font-mono text-[0.8rem] text-walnut";

/**
 * What's missing on this server, said plainly: live research needs TinyFish, plans and lessons
 * need Gemini, and nothing is ever faked in their place.
 */
export function SetupNotice({
  tinyfish,
  gemini,
  message,
}: {
  /** TinyFish (live web research) is set up. */
  tinyfish: boolean;
  /** Gemini (plans, lessons, summaries) is set up. */
  gemini: boolean;
  /** A server's own "not configured" message, when a call came back with one. */
  message: string | null;
}) {
  const needsTinyFish = !tinyfish || /tinyfish/i.test(message ?? "");
  const other = message && !/tinyfish/i.test(message) ? message : null;
  if (!needsTinyFish && gemini && !other) return null;
  return (
    <div role="status" className={`${NOTICE} flex gap-3 px-4 py-3.5 text-sm leading-6`}>
      <span className={`${ICON_BADGE} h-8 w-8 bg-sun`}>
        <IconWarning size={17} strokeWidth={2.25} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {needsTinyFish && (
          <div>
            <p className="font-display text-[15px] font-semibold">
              Live research needs a TinyFish API key
            </p>
            <p className="mt-0.5 text-ink-soft">
              Ms. Fenwick browses the live web with TinyFish, and this server doesn&apos;t have a
              key yet, so she can&apos;t look anything up (and won&apos;t make results up instead).
              Add <code className={CODE}>TINYFISH_API_KEY</code> to{" "}
              <code className={CODE}>apps/web/.env.local</code> (get one at{" "}
              <SourceLink href="https://agent.tinyfish.ai/api-keys" className={TEXT_LINK}>
                agent.tinyfish.ai/api-keys
              </SourceLink>
              ), then restart the server.
            </p>
          </div>
        )}
        {!gemini && (
          <p className="text-ink-soft">
            <span className="font-display font-semibold text-walnut">
              Plans and lessons need Gemini.
            </span>{" "}
            Add <code className={CODE}>GEMINI_API_KEY</code> to the same file.
          </p>
        )}
        {other && (
          <p className="text-ink-soft">
            <span className="font-display font-semibold text-walnut">
              Not set up on this server:
            </span>{" "}
            {other}
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Dialogue (her panel over the library)                               */
/* ------------------------------------------------------------------ */

/** A new line types out at this speed when there's no voice to follow (characters a second). */
const REVEAL_CPS = 45;
/**
 * How long a new line waits for her voice (ms) before it types out on its own: a moment for her
 * to start on it, longer once she has (revealedChars says 0 while the audio is on its way). When
 * she's muted, or the server says there's no voice, it types at once.
 */
const VOICE_START_MS = 450;
const VOICE_WAIT_MS = 2500;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";
function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** The student's system asks for less motion. */
export function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

/**
 * Her newest line, large, appearing in step with her voice: while it's spoken, as far as the
 * audio has got (revealedChars in lib/librarian/voice.ts); with no voice to follow, typed out at
 * REVEAL_CPS. Shown whole when it isn't new (`animate` false), once skipped, and under reduced
 * motion. Key it by the message, so each line starts from the beginning.
 *
 * Only for the eyes (aria-hidden): the panel keeps the whole line in a live region for screen
 * readers, so they get all of it at once. The rest of the line is laid out invisibly, so the
 * text never reflows as it appears.
 */
export function DialogueLine({
  text,
  extra,
  animate,
  skipped,
  onSkip,
}: {
  text: string;
  /** Her follow-up questions that the line doesn't already say, shown once it's all there. */
  extra: readonly string[];
  /** A line that just arrived: it appears as she says it. */
  animate: boolean;
  /** Show the whole line now (a click on it, Space or Enter, or a reply chosen). */
  skipped: boolean;
  onSkip: () => void;
}) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(0);
  const whole = !animate || skipped || reduced;
  const count = whole ? text.length : Math.min(shown, text.length);
  const done = count >= text.length;

  useEffect(() => {
    if (whole) return;
    const start = performance.now();
    let frame = 0;
    let last = 0;
    let voiced = false;
    let typedFrom: number | null = null;
    const tick = (now: number) => {
      const spoken = revealedChars(text);
      const waited = now - start;
      let next: number;
      if (spoken !== null && (spoken > 0 || voiced)) {
        // Her voice is saying this line: as far as it has got.
        voiced = true;
        next = Math.max(last, spoken);
      } else if (voiced) {
        // Her voice finished (or stopped): all of it.
        next = text.length;
      } else if (
        typedFrom === null &&
        (spoken === 0
          ? waited < VOICE_WAIT_MS
          : waited < VOICE_START_MS && !isMuted() && voiceAvailable())
      ) {
        // Her voice is on its way.
        next = 0;
      } else {
        typedFrom ??= now;
        next = Math.max(last, Math.floor(((now - typedFrom) * REVEAL_CPS) / 1000));
      }
      next = Math.min(next, text.length);
      if (next !== last) {
        last = next;
        setShown(next);
      }
      if (next < text.length) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [whole, text]);

  return (
    <div aria-hidden onClick={done ? undefined : onSkip} className={done ? "" : "cursor-pointer"}>
      <p className="relative max-w-[68ch] text-[18px] leading-8 font-semibold whitespace-pre-line text-walnut">
        {/* About to speak: a quiet ellipsis where her words will be. */}
        {count === 0 && !done && <span className="absolute top-0 left-0 text-ink-soft">…</span>}
        {text.slice(0, count)}
        {!done && <span className="invisible">{text.slice(count)}</span>}
      </p>
      {extra.length > 0 && (
        <ul
          className={`mt-2.5 max-w-[68ch] space-y-1 text-base leading-7 font-semibold text-walnut transition-opacity duration-200 motion-reduce:transition-none ${done ? "opacity-100" : "opacity-0"}`}
        >
          {extra.map((q) => (
            <li key={q} className="flex gap-2.5">
              <QuestionDot />
              <span className="min-w-0 flex-1">{q}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The bullet before one of her questions: a small tangerine sticker dot. */
export function QuestionDot() {
  return (
    <span
      aria-hidden
      className="mt-[0.6rem] h-2.5 w-2.5 shrink-0 rounded-full border-2 border-walnut bg-tangerine"
    />
  );
}

/** One of the student's replies under her line; `action` says what it does (the panel's call). */
export interface ReplyOption<A> {
  key: string;
  label: string;
  /** A short line under the label (what it does, or why it's switched off). */
  detail?: string;
  /** The main action in view: its row is sun yellow. */
  primary?: boolean;
  disabled?: boolean;
  action: A;
}

/**
 * The student's replies as a numbered list of chunky rows with sun number badges, picked by click
 * or by the number key (the panel listens for the keys). Two columns when there are more than
 * three, on wider boxes.
 */
export function ReplyOptions<A>({
  options,
  onChoose,
}: {
  options: readonly ReplyOption<A>[];
  onChoose: (option: ReplyOption<A>) => void;
}) {
  if (!options.length) return null;
  return (
    <ol
      aria-label="Your replies"
      className={`mt-4 ${options.length > 3 ? "sm:columns-2 sm:gap-x-4" : "max-w-[44rem]"}`}
    >
      {options.map((o, i) => (
        <li key={o.key} className="break-inside-avoid pb-2.5">
          <button
            type="button"
            disabled={o.disabled}
            aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
            onClick={() => onChoose(o)}
            className={`${ROW} ${o.primary ? ROW_TONE.main : ROW_TONE.plain} min-h-12 py-2 pr-3 pl-2`}
          >
            <span
              aria-hidden
              className={`${ICON_BADGE} tabular h-8 w-8 font-display text-[15px] leading-none font-bold ${o.primary ? "bg-surface" : "bg-sun"}`}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-[15.5px] leading-6 font-semibold">
                {o.label}
              </span>
              {o.detail && (
                <span
                  className={`block text-[13px] leading-5 font-medium ${o.primary ? "text-walnut/75" : "text-ink-soft"}`}
                >
                  {o.detail}
                </span>
              )}
            </span>
            <IconChevronRight
              size={18}
              strokeWidth={2.5}
              className="-translate-x-1 opacity-0 transition-[opacity,translate] duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100 group-disabled:opacity-0 motion-reduce:transition-none"
            />
          </button>
        </li>
      ))}
    </ol>
  );
}
