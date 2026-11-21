"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { LessonPlayerView } from "@/components/learning-studio/LessonPlayer";
import {
  type ApiError,
  type Resource,
  asApiError,
  getJson,
  postJson,
  useApi,
} from "@/components/progress/api";
import { formatDate, formatTime } from "@/components/progress/format";
import { CARD, FOCUS } from "@/components/progress/ui";
import { lessonKey } from "@/lib/learning/client";
import { addLesson, loadLessons } from "@/lib/learning-studio/library";
import { useLessonPlayback } from "@/lib/learning-studio/useLessonPlayback";
import { mentionsDate, mentionsStudyTime } from "@/lib/librarian/planDetails";
import { librarianPresence } from "@/lib/librarian/presence";
import { type ChatMessage, useLibrarianSession } from "@/lib/librarian/session";
import {
  type LibrarianHome,
  type LibrarianTask,
  type PlanItem,
  type ResearchMode,
  type ResearchStep,
  type ResourceCard,
  STATUS_LABELS,
  type TaskStatus,
} from "@/lib/librarian/types";
import {
  BUTTON,
  EYEBROW,
  PRIMARY,
  Portrait,
  SetupNotice,
  SourceLink,
  StatusChip,
  StatusDot,
  TINY_BUTTON,
  TYPE_LABELS,
  domainOf,
} from "./parts";
import {
  Findings,
  type ItemAction,
  type PlanDetails,
  PlanForm,
  PlanView,
  ResourceCardView,
} from "./Results";

/*
 * The AI Librarian, Ms. Ada Fenwick: a student asks for help with a topic, she asks what she
 * needs to know, says what she's about to do, and (once they say go) TinyFish researches the live
 * web while the panel shows only what it has confirmably done. Then: an overview, key ideas and
 * source cards, a study plan and an interactive lesson (Gemini), with progress kept in Tiger Data.
 *
 * Shown over the 3D library (components/library/LibrarianOverlay.tsx) and on its own page
 * (/librarian). Every call is same-origin; the learner is the httpOnly cookie, never an id we send.
 */

export type LibrarianContext = "library" | "page";

const STARTERS = [
  "Help me study for an upcoming exam",
  "Find resources for a topic",
  "Explain something I'm struggling with",
  "Build a study plan",
  "Research a topic for an assignment",
];

/** Poll every 1.5 s while busy, easing off to every 5 s after the first minute. */
const POLL_FAST_MS = 1500;
const POLL_SLOW_MS = 5000;
const POLL_EASE_AFTER_MS = 60_000;
/** Quick research (and plans, lessons) usually take about a minute; past this, say so. */
const SLOW_AFTER_MS = 3 * 60_000;
/** TinyFish's part of a request: the deep mode's 5–20 minutes are spent here. */
const RESEARCH_STATUSES: readonly TaskStatus[] = [
  "research_queued",
  "researching",
  "organizing_results",
];

const api = (path: string) => `/api/librarian/${path}`;

/** The time now, refreshed every `ms` while `active`. */
function useNow(active: boolean, ms: number) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [active, ms]);
  return now;
}

/** What the student asked for that came back with an error, ready to try again. */
interface Failure {
  message: string;
  key: string;
  job: () => Promise<void>;
}

export function LibrarianPanel({
  context,
  titleId,
  onClose,
}: {
  context: LibrarianContext;
  /** For the dialog's aria-labelledby. */
  titleId?: string;
  /** Over the library: closes the panel. (On its own page the header links back instead.) */
  onClose?: () => void;
}) {
  const uid = useId();
  const headingId = titleId ?? `${uid}-title`;
  const task = useLibrarianSession((s) => s.task);
  const messages = useLibrarianSession((s) => s.messages);
  const busySince = useLibrarianSession((s) => s.busySince);
  const home = useApi<LibrarianHome>(api("home"));

  const [draft, setDraft] = useState("");
  /** The action on its way ("send", "confirm", "item:<id>", …). */
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** A call came back 503 not_configured: the server's own words for what's missing. */
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  /** Polling hit trouble (it keeps trying). */
  const [pollTrouble, setPollTrouble] = useState<string | null>(null);
  const [planFormOpen, setPlanFormOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [xp, setXp] = useState<Record<string, number>>({});
  const lastMessage = useRef<HTMLDivElement>(null);

  const taskId = task?.id ?? null;
  const busy = !!task?.busy;
  const now = useNow(busy, 5000);
  const configured = home.data?.configured;
  const serviceDown = home.error?.code === "not_configured";
  const inConversation = task !== null || messages.length > 0;

  // The librarian in the 3D library: eyes on you while this is open, writing while she works.
  useEffect(() => {
    librarianPresence.open = true;
    return () => {
      librarianPresence.open = false;
      librarianPresence.working = false;
    };
  }, []);
  useEffect(() => {
    librarianPresence.working = busy;
  }, [busy]);

  // Poll while the request is busy: every 1.5 s, then every 5 s after the first minute. Stops as
  // soon as it isn't busy (or this panel closes); a blip keeps trying, a missing request stops.
  useEffect(() => {
    if (!taskId || !busy) return;
    const ctrl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    function schedule(troubled: boolean) {
      const since = useLibrarianSession.getState().busySince ?? Date.now();
      const eased = troubled || Date.now() - since > POLL_EASE_AFTER_MS;
      timer = setTimeout(poll, eased ? POLL_SLOW_MS : POLL_FAST_MS);
    }
    function poll() {
      getJson<LibrarianTask>(api(`tasks/${taskId}`), ctrl.signal).then(
        (next) => {
          if (ctrl.signal.aborted) return;
          setPollTrouble(null);
          useLibrarianSession.getState().receive(next, Date.now());
          if (next.busy) schedule(false);
        },
        (err: unknown) => {
          if (ctrl.signal.aborted) return;
          const e = asApiError(err);
          if (e.code === "not_configured") {
            setSetupMessage(e.message);
            setPollTrouble(e.message);
          } else if (e.status === 404) {
            setPollTrouble("This request isn't on the server any more.");
          } else {
            setPollTrouble(`${e.message} Still trying…`);
            schedule(true);
          }
        },
      );
    }
    schedule(false);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [taskId, busy]);

  // Bring each new message into view.
  useEffect(() => {
    if (messages.length) lastMessage.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  /** Runs one of the student's actions, keeping what failed so it can be tried again. */
  const run = (key: string, job: () => Promise<void>) => {
    setPending(key);
    setFailure(null);
    job().then(
      () => setPending(null),
      (err: unknown) => {
        const e: ApiError = asApiError(err);
        setPending(null);
        if (e.code === "not_configured") setSetupMessage(e.message);
        else setFailure({ message: e.message, key, job });
      },
    );
  };
  const receive = (next: LibrarianTask) => useLibrarianSession.getState().receive(next, Date.now());
  /** Fetches the latest of a request quietly (after a plan item changed, say). */
  const refresh = (id: string) => {
    getJson<LibrarianTask>(api(`tasks/${id}`)).then(receive, () => {});
  };

  const send = (text: string) => {
    const message = text.trim();
    if (!message || pending !== null || serviceDown) return;
    const session = useLibrarianSession.getState();
    const answering = task?.status === "awaiting_details" ? task.id : undefined;
    if (answering) session.say(message);
    else session.start(message);
    setDraft("");
    setPlaying(false);
    setPlanFormOpen(false);
    setPollTrouble(null);
    run("send", async () =>
      receive(
        await postJson<LibrarianTask>(api("tasks"), {
          message,
          ...(answering ? { taskId: answering } : {}),
        }),
      ),
    );
  };

  const taskAction = (
    action: "confirm" | "cancel" | "retry" | "plan" | "lesson",
    body: object = {},
  ) => {
    if (!task) return;
    const id = task.id;
    run(action, async () =>
      receive(await postJson<LibrarianTask>(api(`tasks/${id}/${action}`), body)),
    );
  };

  const openTask = (id: string) => {
    setPlaying(false);
    setPlanFormOpen(false);
    setPollTrouble(null);
    setXp({});
    run(`open:${id}`, async () => {
      const next = await getJson<LibrarianTask>(api(`tasks/${id}`));
      useLibrarianSession.getState().reopen(next, Date.now());
    });
  };

  const backToStart = () => {
    useLibrarianSession.getState().clear();
    setPlaying(false);
    setPlanFormOpen(false);
    setFailure(null);
    setPollTrouble(null);
    setXp({});
    home.reload();
  };

  const saveResource = async (card: ResourceCard, saved: boolean) => {
    await postJson<{ ok: true }>(api(`resources/${card.id}`), { saved });
    const id = useLibrarianSession.getState().task?.id;
    if (id) {
      useLibrarianSession.getState().patch(id, (t) => ({
        ...t,
        resources: t.resources.map((r) => (r.id === card.id ? { ...r, saved } : r)),
      }));
    }
    home.reload();
  };

  const buildPlan = (details: PlanDetails) => {
    setPlanFormOpen(false);
    taskAction("plan", details);
  };
  const askForPlan = () => {
    if (!task) return;
    const askDate = !mentionsDate(task.request);
    const askMinutes = !mentionsStudyTime(task.request);
    if (askDate || askMinutes) setPlanFormOpen(true);
    else buildPlan({});
  };

  const itemAction = (item: PlanItem, action: ItemAction, date?: string) => {
    if (!task) return;
    const id = task.id;
    run(`item:${item.id}`, async () => {
      const out = await postJson<{ ok: true; xp?: number }>(api(`plan-items/${item.id}`), {
        action,
        ...(date ? { date } : {}),
      });
      const status =
        action === "complete"
          ? "done"
          : action === "skip"
            ? "skipped"
            : action === "reopen"
              ? "todo"
              : item.status;
      useLibrarianSession.getState().patch(id, (t) => withItem(t, item.id, { status, date }));
      const earned = typeof out.xp === "number" ? out.xp : 0;
      if (action === "complete" && earned > 0) setXp((x) => ({ ...x, [item.id]: earned }));
      refresh(id);
    });
  };

  const Heading = context === "page" ? "h1" : "h2";
  const working = busy || pending === "send";
  const showLesson = playing && task?.lesson;
  const attribution = task?.attribution ?? { research: "TinyFish", synthesis: "Gemini" };

  return (
    <div className="flex h-full min-h-0 flex-col bg-parchment text-ink">
      <header className="flex shrink-0 items-center gap-3 bg-cream px-4 py-3 sm:px-6">
        <Portrait className="h-12 w-12" />
        <div className="min-w-0 flex-1">
          <p className={EYEBROW}>AI Librarian</p>
          <Heading
            id={headingId}
            className="truncate font-display text-xl leading-tight font-semibold"
          >
            Ms. Ada Fenwick, Librarian
          </Heading>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-bold text-ink-soft">
            <StatusDot working={working} />
            <span aria-live="polite">
              {busy && task
                ? STATUS_LABELS[task.status]
                : pending === "send"
                  ? "Reading your message…"
                  : "Here to help"}
            </span>
          </p>
        </div>
        {inConversation && (
          <button
            type="button"
            onClick={backToStart}
            className={BUTTON}
            title="Back to the start (this request stays under Recent requests)"
          >
            New request
          </button>
        )}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close the Librarian"
            aria-keyshortcuts="Escape"
            title="Close (Esc)"
            className={`-mr-2 flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-bold text-ink-soft transition hover:bg-ink/5 hover:text-ink ${FOCUS}`}
          >
            <span aria-hidden>Close</span>
            <span className="kbd hidden !h-6 !min-w-6 !text-[0.7rem] sm:inline-flex" aria-hidden>
              Esc
            </span>
          </button>
        ) : (
          <Link
            href="/library"
            className={`-mr-2 rounded-full px-3 py-2 text-sm font-bold text-ink-soft transition hover:bg-ink/5 hover:text-ink ${FOCUS}`}
          >
            ← <span className="hidden sm:inline">Back to the</span> library
          </Link>
        )}
      </header>

      {showLesson && task?.lesson ? (
        <LessonPane key={lessonKey(task.lesson)} task={task} onExit={() => setPlaying(false)} />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="mx-auto max-w-3xl space-y-5">
              <SetupNotice
                tinyfish={configured?.tinyfish ?? true}
                gemini={configured?.gemini ?? true}
                message={serviceDown ? (home.error?.message ?? null) : setupMessage}
              />
              {inConversation ? (
                <>
                  <Conversation
                    messages={messages}
                    thinking={pending === "send"}
                    lastRef={lastMessage}
                  />
                  {task && (
                    <TaskBody
                      task={task}
                      pending={pending}
                      tinyfishReady={configured?.tinyfish !== false}
                      slow={
                        !(task.mode === "deep" && RESEARCH_STATUSES.includes(task.status)) &&
                        busySince !== null &&
                        now - busySince > SLOW_AFTER_MS
                      }
                      pollTrouble={pollTrouble}
                      planFormOpen={planFormOpen}
                      xp={xp}
                      onConfirm={(mode) => taskAction("confirm", { mode })}
                      onNotNow={backToStart}
                      onCancel={() => taskAction("cancel")}
                      onRetry={() => taskAction("retry")}
                      onAskPlan={askForPlan}
                      onBuildPlan={buildPlan}
                      onClosePlanForm={() => setPlanFormOpen(false)}
                      onLesson={(planItemId) =>
                        taskAction("lesson", planItemId ? { planItemId } : {})
                      }
                      onPlay={() => setPlaying(true)}
                      onSave={saveResource}
                      onItem={itemAction}
                      onNewRequest={backToStart}
                    />
                  )}
                </>
              ) : (
                <HomeView
                  home={home}
                  disabled={serviceDown || pending !== null}
                  openingId={pending?.startsWith("open:") ? pending.slice(5) : null}
                  onStarter={send}
                  onOpen={openTask}
                  onSave={saveResource}
                />
              )}
              {failure && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-red-200"
                >
                  <span className="min-w-0 flex-1">{failure.message}</span>
                  <button
                    type="button"
                    className={TINY_BUTTON}
                    onClick={() => run(failure.key, failure.job)}
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>
          <Composer
            task={task}
            draft={draft}
            onDraft={setDraft}
            onSend={() => send(draft)}
            disabled={serviceDown || pending !== null}
          />
        </>
      )}

      <footer className="shrink-0 border-t border-ink/10 bg-cream/70 px-4 py-2 text-center text-[0.7rem] font-bold text-ink-soft sm:px-6">
        Research: {attribution.research} · Plans and lessons: {attribution.synthesis} · Progress:
        Tiger Data
      </footer>
    </div>
  );
}

/** A plan item changed here: its new status (and day, when it moved). */
function withItem(
  task: LibrarianTask,
  itemId: string,
  change: { status: PlanItem["status"]; date?: string },
): LibrarianTask {
  if (!task.plan) return task;
  const update = (i: PlanItem) =>
    i.id === itemId
      ? { ...i, status: change.status, ...(change.date ? { date: change.date } : {}) }
      : i;
  return {
    ...task,
    plan: { ...task.plan, days: task.plan.days.map((d) => ({ ...d, items: d.items.map(update) })) },
  };
}

/* ------------------------------------------------------------------ */
/* Conversation                                                        */
/* ------------------------------------------------------------------ */

function Bubble({ message }: { message: ChatMessage }) {
  if (message.from === "student") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-[0.95rem] whitespace-pre-line text-cream">
          <span className="sr-only">You: </span>
          {message.text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-end gap-2">
      <Portrait className="h-8 w-8" />
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-cream px-4 py-2.5 text-[0.95rem] ring-1 ring-ink/10">
        <span className="sr-only">Ms. Fenwick: </span>
        <p className="whitespace-pre-line">{message.text}</p>
        {message.questions.length > 0 && (
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm font-bold">
            {message.questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Conversation({
  messages,
  thinking,
  lastRef,
}: {
  messages: ChatMessage[];
  thinking: boolean;
  lastRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div role="log" aria-live="polite" aria-label="Conversation" className="space-y-3">
      {messages.map((m, i) => (
        <div key={m.id} ref={i === messages.length - 1 ? lastRef : undefined}>
          <Bubble message={m} />
        </div>
      ))}
      {thinking && (
        <div className="flex items-end gap-2" aria-hidden>
          <Portrait className="h-8 w-8" />
          <span className="flex gap-1 rounded-2xl rounded-bl-md bg-cream px-4 py-3.5 ring-1 ring-ink/10">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink-soft"
                style={{ animationDelay: `${i * 160}ms` }}
              />
            ))}
          </span>
        </div>
      )}
    </div>
  );
}

function Composer({
  task,
  draft,
  onDraft,
  onSend,
  disabled,
}: {
  task: LibrarianTask | null;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  disabled: boolean;
}) {
  const inputId = useId();
  // While she's waiting for a go-ahead or working, the request's own controls are the way on.
  if (task && (task.busy || task.status === "awaiting_confirmation")) return null;
  const answering = task?.status === "awaiting_details";
  const label = answering
    ? "Answer Ms. Fenwick"
    : task
      ? "Ask about something new"
      : "Ask Ms. Fenwick for help";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
      className="shrink-0 border-t border-ink/10 bg-cream px-4 py-3 sm:px-6"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          {label}
        </label>
        <input
          id={inputId}
          data-autofocus
          type="text"
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          maxLength={1500}
          autoComplete="off"
          placeholder={
            answering
              ? "Type your answer…"
              : task
                ? "Ask about something new (starts a new request)…"
                : "What are you working on?"
          }
          className={`min-w-0 flex-1 rounded-full bg-white/70 px-4 py-2.5 text-sm ring-1 ring-ink/15 ${FOCUS}`}
        />
        <button type="submit" className={PRIMARY} disabled={disabled || !draft.trim()}>
          Send
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

function HomeView({
  home,
  disabled,
  openingId,
  onStarter,
  onOpen,
  onSave,
}: {
  home: Resource<LibrarianHome>;
  disabled: boolean;
  openingId: string | null;
  onStarter: (text: string) => void;
  onOpen: (id: string) => void;
  onSave: (card: ResourceCard, saved: boolean) => Promise<void>;
}) {
  const data = home.data;
  return (
    <>
      <div className="flex items-end gap-2">
        <Portrait className="h-8 w-8" />
        <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-cream px-4 py-2.5 text-[0.95rem] ring-1 ring-ink/10">
          Hello, I&apos;m Ms. Fenwick. Tell me what you&apos;re studying and I&apos;ll look for good
          sources on the web, then help you turn them into a study plan or a lesson.
        </p>
      </div>
      <div>
        <h3 className="sr-only">Ways to start</h3>
        <ul className="flex flex-wrap gap-2">
          {STARTERS.map((s) => (
            <li key={s}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onStarter(s)}
                className={`rounded-full bg-cream px-3.5 py-2 text-sm font-bold text-ink ring-1 ring-ink/15 transition hover:bg-lamp/40 hover:ring-ink/30 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {home.error && home.error.code !== "not_configured" && !data && (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-900 ring-1 ring-red-200"
        >
          <span className="min-w-0 flex-1">
            Couldn&apos;t load your recent requests. {home.error.message}
          </span>
          <button type="button" className={TINY_BUTTON} onClick={home.reload}>
            Retry
          </button>
        </div>
      )}
      {home.loading && !data && !home.error && (
        <div role="status" className="space-y-2">
          <span className="sr-only">Loading your recent requests</span>
          {[0, 1].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-2xl bg-cream ring-1 ring-ink/5" />
          ))}
        </div>
      )}

      {data?.next && (
        <section aria-label="Next up" className={`${CARD} !p-4`}>
          <p className={EYEBROW}>Next up</p>
          <p className="mt-0.5 font-bold">Next up: {data.next.item.title}</p>
          <p className="text-xs text-ink-soft">
            {data.next.planTitle} · {data.next.item.estimatedMinutes} min
          </p>
          <button
            type="button"
            className={`${TINY_BUTTON} mt-2.5`}
            disabled={disabled}
            onClick={() => onOpen(data.next!.taskId)}
          >
            {openingId === data.next.taskId ? "Opening…" : "Open the plan"}
          </button>
        </section>
      )}
      {data?.insight && (
        <p className="rounded-2xl bg-sage/15 px-4 py-3 text-sm text-ink ring-1 ring-sage/30">
          <span className="font-extrabold">From your progress: </span>
          {data.insight}
        </p>
      )}

      {data && data.recent.length > 0 && (
        <section aria-labelledby="librarian-recent">
          <h3 id="librarian-recent" className="font-display text-lg font-semibold">
            Recent requests
          </h3>
          <ul className="mt-2 space-y-2">
            {data.recent.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onOpen(r.id)}
                  className={`flex w-full items-center gap-3 rounded-2xl bg-cream px-4 py-3 text-left ring-1 ring-ink/10 transition hover:ring-ink/25 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-bold">
                      {r.topic || "Untitled request"}
                    </span>
                    <span className="block text-xs text-ink-soft">
                      {TYPE_LABELS[r.type]} · {formatDate(r.createdAt)}
                    </span>
                  </span>
                  <StatusChip
                    status={r.status}
                    label={openingId === r.id ? "Opening…" : STATUS_LABELS[r.status]}
                  />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.saved.length > 0 && (
        <section aria-labelledby="librarian-saved">
          <h3 id="librarian-saved" className="font-display text-lg font-semibold">
            Saved sources
          </h3>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {data.saved.map((card) => (
              <li key={card.id} className="flex">
                <ResourceCardView card={card} compact onSave={(saved) => onSave(card, saved)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The request on the desk                                             */
/* ------------------------------------------------------------------ */

function TaskBody({
  task,
  pending,
  tinyfishReady,
  slow,
  pollTrouble,
  planFormOpen,
  xp,
  onConfirm,
  onNotNow,
  onCancel,
  onRetry,
  onAskPlan,
  onBuildPlan,
  onClosePlanForm,
  onLesson,
  onPlay,
  onSave,
  onItem,
  onNewRequest,
}: {
  task: LibrarianTask;
  pending: string | null;
  tinyfishReady: boolean;
  slow: boolean;
  pollTrouble: string | null;
  planFormOpen: boolean;
  xp: Record<string, number>;
  onConfirm: (mode: ResearchMode) => void;
  onNotNow: () => void;
  onCancel: () => void;
  onRetry: () => void;
  onAskPlan: () => void;
  onBuildPlan: (details: PlanDetails) => void;
  onClosePlanForm: () => void;
  onLesson: (planItemId?: string) => void;
  onPlay: () => void;
  onSave: (card: ResourceCard, saved: boolean) => Promise<void>;
  onItem: (item: PlanItem, action: ItemAction, date?: string) => void;
  onNewRequest: () => void;
}) {
  const hasFindings = !!task.overview || task.resources.length > 0 || task.warnings.length > 0;
  const actionsOpen = !task.busy && pending === null;
  const lessonReady = task.lesson && task.status !== "generating_lesson";
  return (
    <div className="space-y-5">
      {task.status === "awaiting_confirmation" && (
        <ConfirmCard
          key={task.id}
          task={task}
          busy={pending === "confirm"}
          tinyfishReady={tinyfishReady}
          onConfirm={onConfirm}
          onNotNow={onNotNow}
        />
      )}
      {task.busy && (
        <Activity
          task={task}
          slow={slow}
          trouble={pollTrouble}
          cancelling={pending === "cancel"}
          onCancel={onCancel}
        />
      )}
      {task.status === "failed" && (
        <div role="alert" className={`${CARD} !p-4`}>
          <p className="font-display text-lg font-semibold">{STATUS_LABELS.failed}</p>
          <p className="mt-1 text-sm text-ink-soft">
            {task.error?.message ?? "The request stopped before it finished."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {task.error?.retryable !== false && (
              <button
                type="button"
                className={PRIMARY}
                onClick={onRetry}
                disabled={pending !== null}
              >
                {pending === "retry" ? "Retrying…" : "Retry"}
              </button>
            )}
            <button type="button" className={BUTTON} onClick={onNewRequest}>
              New request
            </button>
          </div>
        </div>
      )}
      {task.status === "cancelled" && (
        <div role="status" className={`${CARD} !p-4`}>
          <p className="font-display text-lg font-semibold">Cancelled</p>
          <p className="mt-1 text-sm text-ink-soft">
            You stopped this request. Anything she&apos;d already found is below.
          </p>
          <button type="button" className={`${BUTTON} mt-3`} onClick={onNewRequest}>
            New request
          </button>
        </div>
      )}

      {hasFindings && <Findings task={task} onSave={onSave} />}

      {task.status === "completed" && (!task.plan || !task.lesson) && (
        <div className="flex flex-wrap gap-2">
          {!task.plan && (
            <button
              type="button"
              className={PRIMARY}
              onClick={onAskPlan}
              disabled={!actionsOpen || planFormOpen}
            >
              {pending === "plan" ? "Asking…" : "Build a study plan"}
            </button>
          )}
          {!task.lesson && (
            <button
              type="button"
              className={task.plan ? PRIMARY : BUTTON}
              onClick={() => onLesson()}
              disabled={!actionsOpen}
            >
              {pending === "lesson" ? "Asking…" : "Create interactive lesson"}
            </button>
          )}
        </div>
      )}
      {planFormOpen && !task.plan && (
        <PlanForm
          askDate={!mentionsDate(task.request)}
          askMinutes={!mentionsStudyTime(task.request)}
          busy={pending === "plan"}
          onSubmit={onBuildPlan}
          onCancel={onClosePlanForm}
        />
      )}

      {lessonReady && task.lesson && (
        <section aria-labelledby="librarian-lesson" className={`${CARD} !p-4`}>
          <p className={EYEBROW}>Interactive lesson</p>
          <h3 id="librarian-lesson" className="font-display text-lg font-semibold">
            {task.lesson.title}
          </h3>
          <p className="text-xs text-ink-soft">
            {task.lesson.scenes.length} scenes
            {task.lessonSources.length > 0
              ? ` · from ${task.lessonSources.length} ${task.lessonSources.length === 1 ? "source" : "sources"}`
              : ""}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className={PRIMARY} onClick={onPlay}>
              ▶ Play lesson
            </button>
            <SaveLessonButton task={task} />
          </div>
        </section>
      )}

      {task.plan && (
        <PlanView
          plan={task.plan}
          resources={task.resources}
          pendingItem={pending?.startsWith("item:") ? pending.slice(5) : null}
          xp={xp}
          onItem={onItem}
          onLesson={(item) => onLesson(item.id)}
          lessonBusy={!actionsOpen}
        />
      )}
    </div>
  );
}

function ConfirmCard({
  task,
  busy,
  tinyfishReady,
  onConfirm,
  onNotNow,
}: {
  task: LibrarianTask;
  busy: boolean;
  tinyfishReady: boolean;
  onConfirm: (mode: ResearchMode) => void;
  onNotNow: () => void;
}) {
  const uid = useId();
  const [mode, setMode] = useState<ResearchMode>(task.mode);
  const options: { id: ResearchMode; title: string; detail: string }[] = [
    { id: "quick", title: "Quick", detail: "About a minute · TinyFish Search + Fetch" },
    {
      id: "deep",
      title: "Deep",
      detail: "5–20 minutes · TinyFish Research · uses paid credits",
    },
  ];
  return (
    <section aria-labelledby={`${uid}-title`} className={`${CARD} !p-4`}>
      <p className={EYEBROW}>Ready when you are</p>
      <h3 id={`${uid}-title`} className="sr-only">
        Start the research?
      </h3>
      <p className="mt-1 text-[0.95rem] whitespace-pre-line">
        {task.confirmation ?? "She's ready to start researching."}
      </p>
      <fieldset className="mt-3">
        <legend className="text-sm font-extrabold">How thorough?</legend>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {options.map((o) => (
            <label
              key={o.id}
              className={`flex cursor-pointer items-start gap-2.5 rounded-xl px-3 py-2.5 ring-1 transition has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ember ${mode === o.id ? "bg-ink/[0.06] ring-ink/40" : "ring-ink/15 hover:ring-ink/30"}`}
            >
              <input
                type="radio"
                name={`${uid}-mode`}
                value={o.id}
                checked={mode === o.id}
                onChange={() => setMode(o.id)}
                className="mt-1 accent-ink"
              />
              <span>
                <span className="block text-sm font-extrabold">{o.title}</span>
                <span className="block text-xs text-ink-soft">{o.detail}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={PRIMARY}
          disabled={busy || !tinyfishReady}
          title={tinyfishReady ? undefined : "Live research needs a TinyFish API key"}
          onClick={() => onConfirm(mode)}
        >
          {busy ? "Starting…" : "Start research"}
        </button>
        <button type="button" className={BUTTON} disabled={busy} onClick={onNotNow}>
          Not now
        </button>
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        &ldquo;Not now&rdquo; keeps it under Recent requests for later.
      </p>
    </section>
  );
}

const STEP_GLYPHS: Record<ResearchStep["kind"], { glyph: string; label: string }> = {
  search: { glyph: "🔎", label: "Searched" },
  fetch: { glyph: "📄", label: "Read" },
  plan: { glyph: "🗺️", label: "Planned" },
  status: { glyph: "•", label: "Status" },
  note: { glyph: "✎", label: "Note" },
  error: { glyph: "⚠️", label: "Problem" },
};

/** What she's doing right now: the status, every step TinyFish confirmably took, and Cancel. */
function Activity({
  task,
  slow,
  trouble,
  cancelling,
  onCancel,
}: {
  task: LibrarianTask;
  slow: boolean;
  trouble: string | null;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const uid = useId();
  const researching = RESEARCH_STATUSES.includes(task.status);
  return (
    <section aria-labelledby={`${uid}-title`} className={`${CARD} !p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusDot working />
        <h3 id={`${uid}-title`} className="min-w-0 flex-1 font-display text-lg font-semibold">
          <span aria-live="polite">{STATUS_LABELS[task.status]}</span>
        </h3>
        {researching && (
          <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[0.65rem] font-extrabold tracking-wide text-ink-soft uppercase">
            {task.mode === "deep" ? "Deep research" : "Quick research"}
          </span>
        )}
      </div>
      {researching && (
        <p className="mt-1 text-xs text-ink-soft">
          {task.mode === "deep"
            ? "Deep research (TinyFish Research) usually takes 5–20 minutes, and can take longer. You can close this and come back: it's under Recent requests."
            : "Quick research (TinyFish Search + Fetch) usually takes about a minute."}
        </p>
      )}
      {task.steps.length > 0 ? (
        <ol
          aria-label="What she's done so far"
          className="mt-3 max-h-64 space-y-1.5 overflow-y-auto pr-1 text-sm"
        >
          {task.steps.map((step, i) => {
            const kind = STEP_GLYPHS[step.kind];
            return (
              <li key={`${step.at}-${i}`} className="flex items-start gap-2">
                <span aria-hidden className="w-5 shrink-0 text-center">
                  {kind.glyph}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{kind.label}: </span>
                  <span className={step.kind === "error" ? "font-bold text-red-800" : ""}>
                    {step.label}
                  </span>
                  {step.url && (
                    <span className="ml-1.5 rounded-full bg-ink/[0.06] px-1.5 py-0.5 text-[0.7rem] font-bold text-ink-soft">
                      {domainOf(step.url)}
                    </span>
                  )}
                </span>
                <time dateTime={step.at} className="shrink-0 text-[0.7rem] text-ink-soft">
                  {formatTime(step.at)}
                </time>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-ink-soft">Nothing back yet.</p>
      )}
      {trouble && (
        <p role="status" className="mt-3 text-xs font-bold text-red-800">
          {trouble}
        </p>
      )}
      {slow && (
        <p role="status" className="mt-3 rounded-xl bg-lamp/40 px-3 py-2 text-sm text-ink">
          This is taking longer than usual. You can keep waiting, or cancel and try again later.
        </p>
      )}
      <button type="button" className={`${BUTTON} mt-3`} onClick={onCancel} disabled={cancelling}>
        {cancelling ? "Cancelling…" : "Cancel"}
      </button>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Lesson                                                              */
/* ------------------------------------------------------------------ */

/** "Save to my Learning Studio": a copy of the lesson in this browser's lesson list. */
function SaveLessonButton({ task }: { task: LibrarianTask }) {
  const lesson = task.lesson!;
  const [saved, setSaved] = useState(() =>
    loadLessons().some((l) => lessonKey(l.lesson) === lessonKey(lesson)),
  );
  if (saved) {
    return (
      <span role="status" className="text-sm font-bold text-sage-dark">
        Saved to your Learning Studio ✓
      </span>
    );
  }
  return (
    <button
      type="button"
      className={BUTTON}
      onClick={() => {
        addLesson({
          lesson,
          chunks: task.lessonChunks,
          sourceName: `Ms. Fenwick's research: ${task.topic || lesson.title}`,
        });
        setSaved(true);
      }}
    >
      Save to my Learning Studio
    </button>
  );
}

/** The lesson in the Learning Studio's own player, with its sources underneath. */
function LessonPane({ task, onExit }: { task: LibrarianTask; onExit: () => void }) {
  const lesson = task.lesson!;
  const playback = useLessonPlayback(lesson);
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-lesson-player>
      <div className="min-h-0 flex-1">
        <LessonPlayerView
          playback={playback}
          chunks={task.lessonChunks}
          onExit={onExit}
          exitLabel="← Back to Ms. Fenwick"
          headerActions={<SaveLessonButton task={task} />}
          fill
        />
      </div>
      {task.lessonSources.length > 0 && (
        <section
          aria-label="Lesson sources"
          className="max-h-28 shrink-0 overflow-y-auto border-t border-ink/10 bg-cream/70 px-4 py-2.5 sm:px-6"
        >
          <h3 className="text-xs font-extrabold">Sources</h3>
          <ol className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {task.lessonSources.map((s) => (
              <li key={s.page}>
                <span className="font-bold text-ink-soft">[{s.page}]</span>{" "}
                <SourceLink
                  href={s.url}
                  className="font-bold text-ink underline decoration-ink/30 underline-offset-2 hover:decoration-ink"
                >
                  {s.title || domainOf(s.url)}
                </SourceLink>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
