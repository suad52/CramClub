"use client";

import { FOCUS } from "@/components/progress/ui";
import { isFocusing, usePomodoro } from "@/lib/game/pomodoro";
import type { ActivityType, ResourceType, TaskStatus, TaskType } from "@/lib/librarian/types";

/** Small shared pieces of the Librarian's panel. */

export const BUTTON = `inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold text-ink ring-1 ring-ink/15 transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const PRIMARY = `inline-flex items-center justify-center gap-1.5 rounded-full bg-ink px-4 py-2 text-sm font-bold text-cream shadow transition hover:bg-wood-dark disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const TINY_BUTTON = `inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-ink ring-1 ring-ink/15 transition hover:bg-ink/5 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
export const EYEBROW = "text-[0.7rem] font-extrabold tracking-wide text-ember uppercase";

export const TYPE_LABELS: Record<TaskType, string> = {
  research_topic: "Research",
  find_resources: "Finding resources",
  create_study_plan: "Study plan",
  explain_weak_topic: "Explanation",
  research_assignment: "Assignment research",
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

/** Ms. Fenwick: a chibi face with a silver bun, round glasses and a moss cardigan. */
export function Portrait({ className = "h-12 w-12" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`shrink-0 ${className}`} aria-hidden>
      <circle cx="32" cy="32" r="32" fill="#ffd99a" opacity="0.55" />
      <path d="M12 64 Q14 51 32 50 Q50 51 52 64 Z" fill="#3f5f4a" />
      <path d="M27 50.5 L32 57 L37 50.5 Z" fill="#fbf7ef" />
      <circle cx="32" cy="10.5" r="7.5" fill="#cfd2d6" stroke="#a9adb3" strokeWidth="1" />
      <ellipse cx="32" cy="27" rx="19" ry="15.5" fill="#cfd2d6" />
      <circle cx="32" cy="32.5" r="16.5" fill="#c58c5c" />
      <path
        d="M15.6 31 Q16.5 16 32 16 Q47.5 16 48.4 31 Q43 22.5 32 22.5 Q21 22.5 15.6 31 Z"
        fill="#cfd2d6"
      />
      <path d="M22 18.5 Q27 15.5 32 16" stroke="#a9adb3" strokeWidth="1" fill="none" />
      <ellipse cx="25.2" cy="34.2" rx="1.6" ry="1.9" fill="#2d2420" />
      <ellipse cx="38.8" cy="34.2" rx="1.6" ry="1.9" fill="#2d2420" />
      <g fill="#fbf7ef" fillOpacity="0.22" stroke="#c99a45" strokeWidth="1.6">
        <circle cx="25.2" cy="34" r="5.2" />
        <circle cx="38.8" cy="34" r="5.2" />
      </g>
      <path d="M30.4 33.6 Q32 32.6 33.6 33.6" stroke="#c99a45" strokeWidth="1.4" fill="none" />
      <ellipse cx="20.5" cy="40.5" rx="2.6" ry="1.5" fill="#e0806f" opacity="0.5" />
      <ellipse cx="43.5" cy="40.5" rx="2.6" ry="1.5" fill="#e0806f" opacity="0.5" />
      <path
        d="M28.4 42.4 Q32 45.6 35.6 42.4"
        stroke="#2d2420"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/** Idle (sage) or working (a pulsing lamp-amber), with the words for screen readers beside it. */
export function StatusDot({ working }: { working: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
      {working && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-ember opacity-60" />
      )}
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${working ? "bg-ember" : "bg-sage"}`}
      />
    </span>
  );
}

const STATUS_TONES: Partial<Record<TaskStatus, string>> = {
  completed: "bg-sage/20 text-sage-dark",
  failed: "bg-red-100 text-red-800",
  cancelled: "bg-ink/[0.06] text-ink-soft",
  awaiting_details: "bg-lamp/50 text-ink",
  awaiting_confirmation: "bg-lamp/50 text-ink",
};

export function StatusChip({ status, label }: { status: TaskStatus; label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[0.65rem] font-extrabold tracking-wide uppercase ${STATUS_TONES[status] ?? "bg-ember/15 text-ember"}`}
    >
      {label}
    </span>
  );
}

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
    <div
      role="status"
      className="rounded-2xl bg-lamp/40 px-4 py-3.5 text-sm text-ink ring-1 ring-lamp"
    >
      {needsTinyFish && (
        <>
          <p className="font-extrabold">Live research needs a TinyFish API key</p>
          <p className="mt-1 text-ink-soft">
            Ms. Fenwick browses the live web with TinyFish, and this server doesn&apos;t have a key
            yet, so she can&apos;t look anything up (and won&apos;t make results up instead). Add{" "}
            <code className="rounded bg-cream px-1 font-mono text-[0.8rem] text-ink">
              TINYFISH_API_KEY
            </code>{" "}
            to{" "}
            <code className="rounded bg-cream px-1 font-mono text-[0.8rem] text-ink">
              apps/web/.env.local
            </code>{" "}
            (get one at{" "}
            <SourceLink
              href="https://agent.tinyfish.ai/api-keys"
              className="font-bold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
            >
              agent.tinyfish.ai/api-keys
            </SourceLink>
            ), then restart the server.
          </p>
        </>
      )}
      {!gemini && (
        <p className={needsTinyFish ? "mt-2 text-ink-soft" : "text-ink-soft"}>
          <span className="font-extrabold text-ink">Plans and lessons need Gemini.</span> Add{" "}
          <code className="rounded bg-cream px-1 font-mono text-[0.8rem] text-ink">
            GEMINI_API_KEY
          </code>{" "}
          to the same file.
        </p>
      )}
      {other && (
        <p className={needsTinyFish || !gemini ? "mt-2 text-ink-soft" : "text-ink-soft"}>
          <span className="font-extrabold text-ink">Not set up on this server:</span> {other}
        </p>
      )}
    </div>
  );
}
