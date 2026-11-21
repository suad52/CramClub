"use client";

import { usePathname } from "next/navigation";
import { useEffect, useEffectEvent, useId, useRef, useState, useSyncExternalStore } from "react";
import { LessonPlayerView } from "@/components/learning-studio/LessonPlayer";
import { PushToTalk } from "./PushToTalk";
import {
  type ApiError,
  type Resource,
  asApiError,
  getJson,
  postJson,
  useApi,
} from "@/components/progress/api";
import { formatDate, formatTime } from "@/components/progress/format";
import {
  type IconProps,
  IconArrowRight,
  IconBookmark,
  IconCalendar,
  IconChart,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconClose,
  IconFile,
  IconGraduationCap,
  IconInfo,
  IconList,
  IconPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSend,
  IconUpload,
  IconUser,
  IconUsers,
  IconVolume,
  IconVolumeOff,
  IconWarning,
} from "@/components/ui/icons";
import {
  BTN,
  BTN_SM,
  FOCUS,
  INPUT,
  LABEL,
  PANEL,
  PANEL_MUTED,
  RIBBON,
  TAG,
} from "@/components/ui/styles";
import { loginHref } from "@/lib/auth/links";
import { JOB_STATUS_LABELS } from "@/lib/jobs/types";
import { sceneAudioUrl } from "@/lib/lessons/client";
import { isFocusing, usePomodoro } from "@/lib/game/pomodoro";
import { lessonKey } from "@/lib/learning/client";
import { addLesson, loadLessons } from "@/lib/learning-studio/library";
import { useLessonPlayback } from "@/lib/learning-studio/useLessonPlayback";
import {
  EMPTY_NOTES,
  NOTES_ACCEPT,
  NOTES_MESSAGE_MAX,
  OUTCOME_SUMMARY,
  type NotesDraft,
  addNotesFiles,
  lessonSourcesLine,
  nothingToBuildOn,
  notesForm,
  notesMessageProblem,
  notesPipeline,
  notesTurn,
} from "@/lib/librarian/notes";
import { mentionsDate, mentionsStudyTime } from "@/lib/librarian/planDetails";
import { librarianPresence } from "@/lib/librarian/presence";
import { isMuted, sayAloud, setMuted, stopSpeaking, subscribeMuted } from "@/lib/librarian/voice";
import { type ChatMessage, useLibrarianSession } from "@/lib/librarian/session";
import {
  type LibrarianHome,
  type LibrarianShelf,
  type LibrarianTask,
  type PlanItem,
  type ResearchMode,
  type ResearchStep,
  type ResourceCard,
  STATUS_LABELS,
  type TaskStatus,
} from "@/lib/librarian/types";
import {
  DialogueLine,
  DotRow,
  ICON_BADGE,
  Portrait,
  QuestionDot,
  ROW,
  ROW_TONE,
  type ReplyOption,
  ReplyOptions,
  SetupNotice,
  SourceLink,
  StatusChip,
  StatusDot,
  TEXT_LINK,
  TYPE_LABELS,
  domainOf,
} from "./parts";
import {
  AttachNotesButton,
  NotesDropOverlay,
  NotesTray,
  PICKER_AFTER_POMODORO,
  YourNotes,
  postNotes,
  useNotesDrop,
} from "./NotesUpload";
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
/** Notes run end to end (reading, research, then the plan and/or lesson): a few minutes in all. */
const NOTES_SLOW_AFTER_MS = 8 * 60_000;
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
  /** null when trying the same thing again can't help (the notes go back in the tray instead). */
  job: (() => Promise<void>) | null;
}

/**
 * Her first words (shown, and said aloud once per visit when her voice is set up). A signed-in
 * student gets the server's greeting instead (LibrarianHome.greeting), built from what's stored.
 */
const GREETING =
  "Hello, I'm Ms. Fenwick. Tell me what you're studying and I'll look for good sources on the web, then help you turn them into a study plan or a lesson.";
/** How long her hello waits for the server to say who's here, before she uses her usual one. */
const GREETING_WAIT_MS = 1500;

/** A control in the panel's header (voice, close): a cream sticker button, words beside the icon. */
const HEADER_BTN = `${BTN.secondary} max-sm:px-3`;
/** The same, compact (32px), for the dialogue box's top bar over the library. */
const HEADER_BTN_SM = `inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-[10px] border-2 border-walnut bg-surface px-2 font-display text-[13px] font-semibold whitespace-nowrap text-walnut shadow-[0_2px_0_#1f1a16] transition-[background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px hover:bg-canvas active:translate-y-[2px] active:shadow-[0_0_0_#1f1a16] motion-reduce:transition-none ${FOCUS}`;
/** A reply option for when she asks something the student can't answer yet. */
const UNSURE_ANSWER = "I'm not sure. Use your best judgement.";

/** What a reply in the dialogue does (see `choose` in the panel). */
type Reply =
  | { kind: "send"; text: string }
  | { kind: "pick-notes" }
  | { kind: "send-notes" }
  | { kind: "answer" }
  | { kind: "confirm"; mode: ResearchMode }
  | { kind: "plan" }
  | { kind: "lesson" }
  | { kind: "play" }
  | { kind: "retry" }
  | { kind: "open"; id: string }
  | { kind: "new" };
/** A full-width row in a list (a way to start, a recent request): a chunky cream sticker. */
const LIST_ROW = `${ROW} ${ROW_TONE.plain} px-3.5`;
/** Something went wrong with what the student asked for: said in words, with a way to retry. */
const ALERT =
  "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] border-[2.5px] border-walnut bg-[#fbe9e5] px-4 py-3 text-sm leading-6 font-medium text-walnut shadow-[0_3px_0_#1f1a16]";
/** The alert's warning icon, in a round sticker. */
const ALERT_ICON = `${ICON_BADGE} h-7 w-7 bg-surface text-danger`;
const SUBHEAD = "font-display text-[17px] font-semibold text-walnut";

/** Turns her spoken voice (ElevenLabs) on or off; remembered in this browser. */
function VoiceToggle({ compact = false }: { compact?: boolean }) {
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => false);
  const size = compact ? 16 : 18;
  const stroke = 2.25;
  return (
    <button
      type="button"
      onClick={() => setMuted(!muted)}
      aria-pressed={!muted}
      title={muted ? "Turn her voice on" : "Mute her voice"}
      className={compact ? HEADER_BTN_SM : HEADER_BTN}
    >
      {muted ? (
        <IconVolumeOff size={size} strokeWidth={stroke} />
      ) : (
        <IconVolume size={size} strokeWidth={stroke} />
      )}
      <span className="max-sm:sr-only">{muted ? "Voice off" : "Voice on"}</span>
    </button>
  );
}

export function LibrarianPanel({
  context,
  titleId,
  onClose,
}: {
  context: LibrarianContext;
  /** For the dialog's aria-labelledby. */
  titleId?: string;
  /** Over the library: closes the panel. (On its own page the site header links back instead.) */
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
  /** Lecture notes attached in the composer, not yet sent. */
  const [notes, setNotes] = useState<NotesDraft>(EMPTY_NOTES);
  const lastMessage = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const attachId = `${uid}-attach`;
  const inputId = `${uid}-input`;
  const historyId = `${uid}-history`;

  // Over the library the panel is a dialogue box: her newest line, the student's numbered replies.
  const dialogue = context === "library";
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const lineBox = useRef<HTMLDivElement>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  /** The line the student asked to see whole (a click on it, Space or Enter, or a reply). */
  const [skippedLine, setSkippedLine] = useState<string | null>(null);
  /** Which research the student chose, for its "Starting…". */
  const [confirmMode, setConfirmMode] = useState<ResearchMode | null>(null);
  /** Lines already here when the panel opened appear whole; only new ones appear as she says them. */
  const [seenAtOpen] = useState(
    () => new Set(useLibrarianSession.getState().messages.map((m) => m.id)),
  );
  /** Her greeting appears as she says it, whenever she's opened fresh (see the hello below). */
  const [greetingLive, setGreetingLive] = useState(
    () => useLibrarianSession.getState().messages.length === 0,
  );

  /** Her hello waited long enough for the server (offline, or a slow database). */
  const [greetingWaited, setGreetingWaited] = useState(false);
  const pathname = usePathname();

  const taskId = task?.id ?? null;
  const busy = !!task?.busy;
  const now = useNow(busy, 5000);
  const configured = home.data?.configured;
  /** Her greeting for a signed-in student (from what's stored), else null: her usual hello. */
  const personal = home.data?.greeting ?? null;
  const greetingText = personal?.text ?? GREETING;
  const greetingReady = home.data !== undefined || home.error !== undefined || greetingWaited;
  const serviceDown = home.error?.code === "not_configured";
  const inConversation = task !== null || messages.length > 0;
  const showLesson = playing && task?.lesson;
  /** The message box is there (not while she works, waits for a go-ahead, or a lesson plays). */
  const composerOpen =
    !showLesson && !(task && (task.busy || task.status === "awaiting_confirmation"));
  const canAttach = composerOpen && !serviceDown && pending === null;
  // Mid-pomodoro in the library, the browser's file window would count as leaving the tab (and
  // can void the pomodoro), so the picker waits; dropping files still works.
  const pickerAfterPomodoro = usePomodoro(isFocusing) && context === "library";

  const addNotes = (incoming: File[]) =>
    setNotes((n) => ({ ...n, ...addNotesFiles(n.files, incoming) }));
  const drop = useNotesDrop(canAttach, addNotes);
  const openPicker = () => {
    if (canAttach && !pickerAfterPomodoro) picker.current?.click();
  };

  // The librarian in the 3D library: eyes on you while this is open, writing while she works.
  useEffect(() => {
    librarianPresence.open = true;
    const waited = setTimeout(() => setGreetingWaited(true), GREETING_WAIT_MS);
    return () => {
      clearTimeout(waited);
      librarianPresence.open = false;
      librarianPresence.working = false;
      stopSpeaking();
    };
  }, []);
  // She says hello aloud whenever she's opened with nothing said yet, once she knows who's here
  // (so a signed-in student hears their own greeting). Queued, so a mount that's undone straight
  // away (React's dev double-mount) doesn't use up the greeting.
  const greeted = useRef(false);
  useEffect(() => {
    if (greeted.current || !greetingReady) return;
    if (useLibrarianSession.getState().messages.length > 0) {
      greeted.current = true;
      return;
    }
    const hello = setTimeout(() => {
      greeted.current = true;
      void sayAloud(greetingText);
    }, 120);
    return () => clearTimeout(hello);
  }, [greetingReady, greetingText]);
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

  /**
   * Runs one of the student's actions, keeping what failed so it can be tried again (unless
   * `retry` is false: then the alert just says what went wrong).
   */
  const run = (key: string, job: () => Promise<void>, retry = true) => {
    setPending(key);
    setFailure(null);
    job().then(
      () => setPending(null),
      (err: unknown) => {
        const e: ApiError = asApiError(err);
        setPending(null);
        if (e.code === "not_configured") setSetupMessage(e.message);
        else setFailure({ message: e.message, key, job: retry ? job : null });
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

  /**
   * Gives her the attached notes: a new request that runs on its own (choosing what to make is
   * the go-ahead). If it doesn't go through, the notes and message go back in the composer, so
   * the student can change them and send again.
   */
  const sendNotes = () => {
    if (!notes.files.length || pending !== null || serviceDown) return;
    const tooLong = notesMessageProblem(draft);
    if (tooLong) {
      setNotes((n) => ({ ...n, problems: [tooLong] }));
      return;
    }
    const attached = notes;
    const message = draft.trim();
    const form = notesForm(attached, message);
    useLibrarianSession.getState().start(notesTurn(attached.files.length, message));
    setDraft("");
    setNotes(EMPTY_NOTES);
    setPlaying(false);
    setPlanFormOpen(false);
    setPollTrouble(null);
    setXp({});
    run(
      "notes",
      async () => {
        try {
          receive(await postNotes(form));
        } catch (err) {
          setNotes({ ...attached, problems: [] });
          setDraft((d) => d || message);
          throw err;
        }
      },
      false,
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
    setGreetingLive(false);
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

  /** A chip from their shelf: starts the message for them to finish (or send as it is). */
  const prefill = (text: string) => {
    if (serviceDown) return;
    setDraft(text);
    requestAnimationFrame(() => {
      const box = document.getElementById(inputId);
      if (!(box instanceof HTMLInputElement)) return;
      box.focus();
      box.setSelectionRange(text.length, text.length);
    });
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
  const sending = pending === "send" || pending === "notes";
  const working = busy || sending;
  /** What she's doing with what was just sent ("Reading your message…"), or null. */
  const thinking =
    pending === "send"
      ? "Reading your message…"
      : pending === "notes"
        ? "Uploading your notes…"
        : null;
  const statusLabel = busy && task ? STATUS_LABELS[task.status] : (thinking ?? "Here to help");
  const tinyfishReady = configured?.tinyfish !== false;
  const withNotes = notes.files.length > 0;
  const lessonOn = Boolean(showLesson);

  /* ---- Over the library: her newest line, what it answers, and the student's replies ---- */

  const last = messages.at(-1);
  const herLast = last?.from === "librarian" ? last : null;
  const before = messages.at(-2);
  /** The student's words her line answers (or that she's still reading), shown small above it. */
  const yourLast = herLast ? (before?.from === "student" ? before : null) : (last ?? null);
  /** Everything before that, under "Earlier". */
  const earlier = messages.slice(0, messages.length - (herLast ? 1 : 0) - (yourLast ? 1 : 0));
  const line = !inConversation
    ? greetingReady
      ? {
          id: personal ? "greeting-you" : "greeting",
          text: greetingText,
          extra: [] as string[],
          animate: greetingLive,
        }
      : null
    : herLast
      ? {
          id: herLast.id,
          text: herLast.text,
          extra: herLast.questions.filter((q) => !herLast.text.includes(q)),
          animate: !seenAtOpen.has(herLast.id),
        }
      : null;

  const focusComposer = () => document.getElementById(inputId)?.focus();
  /** "Build a study plan" opened the details form: bring it into view, focus on its first field. */
  const focusPlanForm = () =>
    requestAnimationFrame(() => {
      const form = document.querySelector<HTMLElement>("[data-plan-form]");
      form?.scrollIntoView({ block: "nearest" });
      form?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
    });

  // Plain data (what each reply does is in `choose`, below).
  const options: ReplyOption<Reply>[] = [];
  const blocked = serviceDown || pending !== null;
  if (withNotes && composerOpen) {
    const count = notes.files.length;
    options.push({
      key: "notes",
      label: "Study these notes",
      detail: `${count} ${count === 1 ? "file" : "files"} · she'll make ${OUTCOME_SUMMARY[notes.outcome]}`,
      primary: true,
      disabled: blocked,
      action: { kind: "send-notes" },
    });
  } else if (!inConversation) {
    // Her "Want to pick it up?" (a signed-in student's last request), then the ways to start.
    const resume = personal?.resume;
    if (resume)
      options.push({
        key: "resume",
        label: pending === `open:${resume.taskId}` ? "Opening…" : `Pick up ${resume.topic}`,
        detail: "Opens it where you left off",
        primary: true,
        disabled: blocked,
        action: { kind: "open", id: resume.taskId },
      });
    options.push({
      key: "notes",
      label: "Study from my lecture notes",
      detail: pickerAfterPomodoro
        ? `${PICKER_AFTER_POMODORO}.`
        : "PDF, .txt or .md. She reads them, finds sources, then makes a plan or lesson.",
      disabled: blocked || pickerAfterPomodoro,
      action: { kind: "pick-notes" },
    });
    for (const starter of STARTERS) {
      options.push({
        key: starter,
        label: starter,
        disabled: blocked,
        action: { kind: "send", text: starter },
      });
    }
  } else if (task) {
    const actionsOpen = !task.busy && pending === null;
    const from =
      task.type === "study_from_notes"
        ? "your notes and the sources she found"
        : "the sources she found";
    if (task.status === "awaiting_details") {
      options.push(
        {
          key: "answer",
          label: "Type my answer",
          detail: "In the message box below",
          disabled: serviceDown,
          action: { kind: "answer" },
        },
        {
          key: "unsure",
          label: UNSURE_ANSWER,
          disabled: blocked,
          action: { kind: "send", text: UNSURE_ANSWER },
        },
        {
          key: "other",
          label: "Ask about something else",
          detail: "This request stays under Recent requests",
          disabled: pending !== null,
          action: { kind: "new" },
        },
      );
    }
    if (task.status === "awaiting_confirmation") {
      const noKey = tinyfishReady ? undefined : "Live research isn't set up on this server yet";
      const starting = (mode: ResearchMode) => pending === "confirm" && confirmMode === mode;
      options.push(
        {
          key: "quick",
          label: starting("quick") ? "Starting…" : "Start quick research",
          detail: noKey ?? "About a minute",
          primary: task.mode === "quick",
          disabled: pending !== null || !tinyfishReady,
          action: { kind: "confirm", mode: "quick" },
        },
        {
          key: "deep",
          label: starting("deep") ? "Starting…" : "Start deep research",
          detail: noKey ?? "5–20 minutes · goes much deeper",
          primary: task.mode === "deep",
          disabled: pending !== null || !tinyfishReady,
          action: { kind: "confirm", mode: "deep" },
        },
        {
          key: "not-now",
          label: "Not now",
          detail: "Keeps it under Recent requests for later",
          disabled: pending !== null,
          action: { kind: "new" },
        },
      );
    }
    if (task.status === "completed" && !nothingToBuildOn(task)) {
      if (!task.plan) {
        options.push({
          key: "plan",
          label: pending === "plan" ? "Asking…" : "Build a study plan",
          detail: `Day by day, with ${from}`,
          primary: !task.lesson && !planFormOpen,
          disabled: !actionsOpen || planFormOpen,
          action: { kind: "plan" },
        });
      }
      if (!task.lesson) {
        options.push({
          key: "lesson",
          label: pending === "lesson" ? "Asking…" : "Create interactive lesson",
          detail: `Scenes to play right here, from ${from}`,
          primary: !!task.plan,
          disabled: !actionsOpen,
          action: { kind: "lesson" },
        });
      }
    }
    if (task.lesson && task.status !== "generating_lesson") {
      options.push({
        key: "play",
        label: "Play lesson",
        detail: `${task.lesson.title} · ${task.lesson.scenes.length} scenes`,
        primary: true,
        action: { kind: "play" },
      });
    }
    if (task.status === "failed" && task.error?.retryable !== false) {
      options.push({
        key: "retry",
        label: pending === "retry" ? "Retrying…" : "Retry",
        primary: true,
        disabled: pending !== null,
        action: { kind: "retry" },
      });
    }
    if (task.status === "failed" || task.status === "cancelled") {
      options.push({ key: "new", label: "New request", action: { kind: "new" } });
    }
  }

  /** Focus back into the box (its scroll area, or the dialog while a lesson plays). */
  const refocus = () =>
    (scroller.current ?? root.current?.closest<HTMLElement>('[role="dialog"]'))?.focus({
      preventScroll: true,
    });
  /** Picks a reply: her line shows whole, and focus stays in the box if the reply took it away. */
  const choose = (option: ReplyOption<Reply>) => {
    if (option.disabled) return;
    if (line) setSkippedLine(line.id);
    const action = option.action;
    switch (action.kind) {
      case "send":
        send(action.text);
        break;
      case "pick-notes":
        openPicker();
        break;
      case "send-notes":
        sendNotes();
        break;
      case "answer":
        focusComposer();
        break;
      case "confirm":
        setConfirmMode(action.mode);
        taskAction("confirm", { mode: action.mode });
        break;
      case "plan":
        askForPlan();
        focusPlanForm();
        break;
      case "lesson":
        taskAction("lesson");
        break;
      case "play":
        setPlaying(true);
        break;
      case "retry":
        taskAction("retry");
        break;
      case "open":
        openTask(action.id);
        break;
      case "new":
        backToStart();
        break;
    }
    requestAnimationFrame(() => {
      const active = document.activeElement;
      const kept =
        active instanceof HTMLElement &&
        active !== document.body &&
        active.isConnected &&
        !active.matches(":disabled");
      if (!kept) refocus();
    });
  };

  // Keys in the dialogue box: 1–9 pick a reply, Space or Enter shows her line whole, and typing
  // anywhere else starts a message. Never from a text field (keys there are text), a lesson's
  // player, or a dialog above this one (the pomodoro's "Leave?").
  const onDialogueKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target instanceof HTMLElement ? e.target : null;
    const panel = root.current;
    if (!target || !panel) return;
    const modal = target.closest('[aria-modal="true"]');
    if (modal ? !modal.contains(panel) : target !== document.body) return;
    if (isTextField(target) || target.closest("[data-lesson-player]")) return;
    if (/^[1-9]$/.test(e.key)) {
      const option = options[Number(e.key) - 1];
      if (option) {
        e.preventDefault();
        if (!e.repeat) choose(option);
        return;
      }
    }
    const onControl = !!target.closest(CONTROLS);
    if (e.key === " " || e.key === "Enter") {
      if (!onControl && line) {
        e.preventDefault();
        setSkippedLine(line.id);
      }
      return;
    }
    if (e.key.length === 1 && composerOpen) focusComposer();
  });
  useEffect(() => {
    if (!dialogue || lessonOn) return;
    const onKey = (e: KeyboardEvent) => onDialogueKey(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialogue, lessonOn]);

  // Each new line starts at the top of the box. If the reply that led to it went with the old
  // options, focus goes back to the box (so the keys above keep working).
  const lineKey = line?.id ?? (thinking ? "thinking" : "");
  useEffect(() => {
    if (!dialogue) return;
    const box = scroller.current;
    const at = lineBox.current;
    if (box && at) box.scrollTop = Math.max(0, at.offsetTop - 8);
    if (document.activeElement === document.body) refocus();
  }, [dialogue, lineKey]);

  /* ---- The pieces, arranged per context below ---- */

  // The "Add notes" picker (opened from the composer or "Ways to start").
  const pickerInput = (
    <input
      ref={picker}
      type="file"
      multiple
      accept={NOTES_ACCEPT}
      hidden
      tabIndex={-1}
      aria-hidden
      onChange={(e) => {
        const files = [...(e.target.files ?? [])];
        e.target.value = "";
        if (files.length) addNotes(files);
      }}
    />
  );
  const changeNotes = (change: Partial<NotesDraft>) =>
    setNotes((n) => ({ ...n, ...change, problems: [] }));
  const removeNote = (index: number) =>
    setNotes((n) => ({
      ...n,
      files: n.files.filter((_, i) => i !== index),
      problems: [],
    }));
  const setupNotice = (
    <SetupNotice
      tinyfish={configured?.tinyfish ?? true}
      gemini={configured?.gemini ?? true}
      message={serviceDown ? (home.error?.message ?? null) : setupMessage}
    />
  );
  const taskBody = task && (
    <TaskBody
      task={task}
      dialogue={dialogue}
      pending={pending}
      tinyfishReady={tinyfishReady}
      slow={
        !(task.mode === "deep" && RESEARCH_STATUSES.includes(task.status)) &&
        !(task.status === "generating_lesson" && task.cloudLesson) &&
        busySince !== null &&
        now - busySince > (task.type === "study_from_notes" ? NOTES_SLOW_AFTER_MS : SLOW_AFTER_MS)
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
      onLesson={(planItemId) => taskAction("lesson", planItemId ? { planItemId } : {})}
      onPlay={() => setPlaying(true)}
      onSave={saveResource}
      onItem={itemAction}
      onNewRequest={backToStart}
    />
  );
  const homeView = (
    <HomeView
      home={home}
      greeting={greetingText}
      dialogue={dialogue}
      disabled={blocked}
      returnTo={pathname}
      onPrefill={prefill}
      openingId={pending?.startsWith("open:") ? pending.slice(5) : null}
      onStarter={send}
      onNotes={openPicker}
      notesAfterPomodoro={pickerAfterPomodoro}
      onOpen={openTask}
      onSave={saveResource}
    />
  );
  const failureAlert = failure && (
    <FailureAlert failure={failure} notesAttached={withNotes} onRetry={run} />
  );
  const composer = composerOpen && (
    <Composer
      task={task}
      dialogue={dialogue}
      inputId={inputId}
      draft={draft}
      onDraft={setDraft}
      onSend={() => (withNotes ? sendNotes() : send(draft))}
      disabled={blocked}
      notes={notes}
      onNotes={changeNotes}
      onRemoveNote={removeNote}
      onAttach={openPicker}
      attachAfterPomodoro={pickerAfterPomodoro}
      attachId={attachId}
    />
  );
  const lessonPane =
    showLesson && task?.lesson ? (
      <LessonPane key={lessonKey(task.lesson)} task={task} onExit={() => setPlaying(false)} />
    ) : null;
  const closeButton = (compact: boolean) =>
    onClose && (
      <button
        type="button"
        onClick={onClose}
        aria-label="Close the Librarian"
        aria-keyshortcuts="Escape"
        title="Close (Esc)"
        className={compact ? HEADER_BTN_SM : HEADER_BTN}
      >
        <IconClose size={compact ? 16 : 18} strokeWidth={2.5} className="sm:hidden" />
        <span aria-hidden className="hidden sm:inline">
          Close
        </span>
        <kbd className="kbd hidden sm:inline-flex" aria-hidden>
          Esc
        </kbd>
      </button>
    );

  if (dialogue) {
    return (
      <div ref={root} className="relative flex h-full min-h-0 flex-1 flex-col" {...drop.zone}>
        {pickerInput}
        {/*
         * Her name tab on the box's top edge, over the library: a tilted tangerine ribbon (like the
         * title screen's member card), and beside it what she's doing, on a cream sticker.
         */}
        <div className="absolute bottom-[calc(100%-14px)] left-5 z-10 flex max-w-[calc(100%-2.5rem)] items-center gap-2">
          <div className="title-pop flex shrink-0 -rotate-2 items-center gap-2 rounded-full border-[3px] border-walnut bg-tangerine py-1 pr-4 pl-1 text-walnut shadow-[0_4px_0_#1f1a16]">
            <Portrait className="h-8 w-8" />
            <Heading id={headingId} className="font-display text-[17px] leading-6 font-bold">
              Ms. Fenwick<span className="sr-only">, Librarian</span>
            </Heading>
          </div>
          <span
            className="title-pop flex min-w-0 items-center gap-1.5 rounded-full border-[2.5px] border-walnut bg-surface px-2.5 py-0.5 font-display text-[12.5px] leading-5 font-semibold text-walnut shadow-[0_3px_0_#1f1a16]"
            style={{ animationDelay: "90ms" }}
          >
            <StatusDot working={working} />
            <span aria-live="polite" className="truncate">
              {statusLabel}
            </span>
          </span>
        </div>

        <div
          className={`${PANEL} relative flex min-h-0 flex-1 flex-col overflow-hidden text-walnut`}
        >
          {drop.dragging && <NotesDropOverlay {...drop.overlay} />}
          <div className="flex shrink-0 items-center gap-1.5 px-3 pt-[1.125rem] pb-1 sm:px-4">
            {earlier.length > 0 && !lessonPane && (
              <button
                type="button"
                aria-expanded={historyOpen}
                aria-controls={historyId}
                onClick={() => setHistoryOpen((o) => !o)}
                className={HEADER_BTN_SM}
              >
                <IconChevronDown
                  size={16}
                  strokeWidth={2.5}
                  className={`transition-transform duration-150 motion-reduce:transition-none ${historyOpen ? "rotate-180" : ""}`}
                />
                Earlier
                <span className="tabular">({earlier.length})</span>
              </button>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <VoiceToggle compact />
              {inConversation && (
                <button
                  type="button"
                  onClick={backToStart}
                  className={HEADER_BTN_SM}
                  title="Back to the start (this request stays under Recent requests)"
                >
                  <IconPlus size={16} strokeWidth={2.5} />
                  <span className="max-sm:sr-only">New request</span>
                </button>
              )}
              {closeButton(true)}
            </div>
          </div>

          {lessonPane ?? (
            <>
              <div
                ref={scroller}
                // Focus starts here (and comes back here), so the arrow keys scroll the box and
                // the number keys pick replies; typing anywhere goes to the message box.
                data-autofocus
                tabIndex={-1}
                role="region"
                aria-label="Conversation with Ms. Fenwick"
                className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-1.5 pb-5 outline-none sm:px-7"
              >
                {historyOpen && earlier.length > 0 && <History id={historyId} messages={earlier} />}
                <div ref={lineBox}>
                  {yourLast && (
                    <p className="mb-1.5 line-clamp-2 max-w-[72ch] text-[13px] leading-5 font-medium text-ink-soft">
                      <span className="font-display font-semibold text-walnut">You: </span>
                      {yourLast.text}
                    </p>
                  )}
                  {line ? (
                    <DialogueLine
                      key={line.id}
                      text={line.text}
                      extra={line.extra}
                      animate={line.animate}
                      skipped={skippedLine === line.id}
                      onSkip={() => setSkippedLine(line.id)}
                    />
                  ) : (
                    thinking && (
                      // The name tab's status says this to screen readers.
                      <p aria-hidden className="text-[18px] leading-8 font-semibold text-ink-soft">
                        {thinking}
                      </p>
                    )
                  )}
                </div>
                {/* Her whole line at once for screen readers (the line above appears as she says it). */}
                <p aria-live="polite" className="sr-only">
                  {line ? [line.text, ...line.extra].join(" ") : ""}
                </p>
                <ReplyOptions options={options} onChoose={choose} />
                <div className="mt-6 space-y-5 empty:hidden">
                  {failureAlert}
                  {setupNotice}
                  {composerOpen && (withNotes || notes.problems.length > 0) && (
                    <NotesTray
                      draft={notes}
                      disabled={blocked}
                      returnFocusTo={attachId}
                      onChange={changeNotes}
                      onRemove={removeNote}
                      inline
                    />
                  )}
                  {inConversation ? taskBody : homeView}
                </div>
              </div>
              {composer}
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={root}
      className="relative flex h-full min-h-0 flex-1 flex-col bg-surface text-walnut"
      {...drop.zone}
    >
      {pickerInput}
      {drop.dragging && <NotesDropOverlay {...drop.overlay} />}
      <header className="flex shrink-0 items-center gap-3 border-b-[3px] border-walnut bg-canvas px-4 py-3.5 sm:px-6">
        <Portrait className="h-12 w-12 -rotate-3" />
        <div className="min-w-0 flex-1">
          <Heading
            id={headingId}
            className="truncate font-display text-[22px] leading-tight font-bold text-walnut"
          >
            Ms. Ada Fenwick<span className="sr-only">, Librarian</span>
          </Heading>
          <p className="mt-1 flex min-w-0 items-center gap-1.5 font-display text-[13px] leading-5 font-semibold text-ink-soft">
            <span className="shrink-0 rounded-full border-2 border-walnut bg-tangerine px-2 text-[12px] text-walnut">
              Librarian
            </span>
            <StatusDot working={working} />
            <span aria-live="polite" className="truncate">
              {statusLabel}
            </span>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <VoiceToggle />
          {inConversation && (
            <button
              type="button"
              onClick={backToStart}
              className={`${BTN.secondary} max-sm:px-3`}
              title="Back to the start (this request stays under Recent requests)"
            >
              <IconPlus size={18} strokeWidth={2.5} />
              <span className="max-sm:sr-only">New request</span>
            </button>
          )}
          {closeButton(false)}
        </div>
      </header>

      {lessonPane ?? (
        <>
          <div className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6">
            <div className="mx-auto max-w-[760px] space-y-6">
              {setupNotice}
              {inConversation ? (
                <>
                  <Conversation messages={messages} thinking={thinking} lastRef={lastMessage} />
                  {taskBody}
                </>
              ) : (
                homeView
              )}
              {failureAlert}
            </div>
          </div>
          {composer}
        </>
      )}
    </div>
  );
}

/** Text fields take keys as text; everything else in the box can take the dialogue's keys. */
const NOT_TEXT = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);
function isTextField(el: HTMLElement) {
  if (el.isContentEditable || el.closest("textarea, select")) return true;
  return el instanceof HTMLInputElement && !NOT_TEXT.has(el.type);
}
/** Where Space and Enter already do something (press it), so they don't skip her line. */
const CONTROLS =
  "button, a[href], input, select, textarea, summary, label, [role='button'], [role='radio'], [tabindex]:not([tabindex='-1'])";

/** Earlier turns, compact, above her current line (the "Earlier" toggle in the box's top bar). */
function History({ id, messages }: { id: string; messages: ChatMessage[] }) {
  return (
    <section
      id={id}
      aria-label="Earlier in this conversation"
      className="mb-4 space-y-2 border-b-2 border-dashed border-walnut/20 pt-1 pb-4"
    >
      {messages.map((m) => {
        const extra = m.questions.filter((q) => !m.text.includes(q));
        return (
          <p
            key={m.id}
            className="max-w-[72ch] text-sm leading-6 font-medium whitespace-pre-line text-ink-soft"
          >
            <span className="font-display font-semibold text-walnut">
              {m.from === "student" ? "You" : "Ms. Fenwick"}:{" "}
            </span>
            {m.text}
            {extra.length > 0 && ` ${extra.join(" ")}`}
          </p>
        );
      })}
    </section>
  );
}

/** What the student asked for came back with an error: said in words, with Retry when it helps. */
function FailureAlert({
  failure,
  notesAttached,
  onRetry,
}: {
  failure: Failure;
  /** The notes that didn't go are back in the tray (gone once the student removes them). */
  notesAttached: boolean;
  onRetry: (key: string, job: () => Promise<void>) => void;
}) {
  const { job } = failure;
  return (
    <div role="alert" className={ALERT}>
      <span className={ALERT_ICON}>
        <IconWarning size={16} strokeWidth={2.25} />
      </span>
      <span className="min-w-0 flex-1">
        {failure.message}
        {failure.key === "notes" && notesAttached && (
          <span className="block text-[13px] leading-5 text-ink-soft">
            Your notes are still attached below, so you can change them and send them again.
          </span>
        )}
      </span>
      {job && (
        <button
          type="button"
          className={BTN_SM.secondary}
          onClick={() => onRetry(failure.key, job)}
        >
          <IconRefresh size={16} strokeWidth={2.25} />
          Retry
        </button>
      )}
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

/** One of her turns at the desk: her portrait and name, then what she said in a cream bubble. */
function HerTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <Portrait className="h-10 w-10" />
      <div className="min-w-0 flex-1">
        <p className="font-display text-[14px] leading-5 font-semibold text-walnut">Ms. Fenwick</p>
        <div className="mt-1 w-fit max-w-[62ch] rounded-[18px] rounded-tl-[6px] border-[2.5px] border-walnut bg-canvas px-4 py-2.5 text-[15px] leading-6 font-medium text-walnut shadow-[0_3px_0_#1f1a16]">
          {children}
        </div>
      </div>
    </div>
  );
}

function Bubble({ message }: { message: ChatMessage }) {
  if (message.from === "student") {
    return (
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-[18px] rounded-br-[6px] border-[2.5px] border-walnut bg-sun px-4 py-2.5 text-[15px] leading-6 font-semibold whitespace-pre-line text-walnut shadow-[0_3px_0_#1f1a16]">
          <span className="sr-only">You: </span>
          {message.text}
        </p>
      </div>
    );
  }
  return (
    <HerTurn>
      <p className="whitespace-pre-line">{message.text}</p>
      {message.questions.length > 0 && (
        <ul className="mt-2.5 space-y-1.5 font-semibold">
          {message.questions.map((q) => (
            <li key={q} className="flex gap-2.5">
              <QuestionDot />
              <span className="min-w-0 flex-1">{q}</span>
            </li>
          ))}
        </ul>
      )}
    </HerTurn>
  );
}

function Conversation({
  messages,
  thinking,
  lastRef,
}: {
  messages: ChatMessage[];
  /** What she's doing with what was just sent ("Reading your message…"), or null. */
  thinking: string | null;
  lastRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div role="log" aria-live="polite" aria-label="Conversation" className="space-y-5">
      {messages.map((m, i) => (
        <div key={m.id} ref={i === messages.length - 1 ? lastRef : undefined}>
          <Bubble message={m} />
        </div>
      ))}
      {thinking && (
        <div aria-hidden>
          <HerTurn>
            <p className="text-ink-soft">{thinking}</p>
          </HerTurn>
        </div>
      )}
    </div>
  );
}

/**
 * The message box (shown unless she's working, waiting for a go-ahead, or a lesson plays). With
 * notes attached it becomes their note to her: optional, above it the tray of files and what she
 * should make, and the main action is "Study these notes".
 */
function Composer({
  task,
  dialogue,
  inputId,
  draft,
  onDraft,
  onSend,
  disabled,
  notes,
  onNotes,
  onRemoveNote,
  onAttach,
  attachAfterPomodoro,
  attachId,
}: {
  task: LibrarianTask | null;
  /** Over the library: the notes tray sits in the box's scroll area, and the box takes focus. */
  dialogue: boolean;
  inputId: string;
  draft: string;
  onDraft: (text: string) => void;
  onSend: () => void;
  disabled: boolean;
  notes: NotesDraft;
  onNotes: (change: Partial<NotesDraft>) => void;
  onRemoveNote: (index: number) => void;
  onAttach: () => void;
  attachAfterPomodoro: boolean;
  attachId: string;
}) {
  const count = notes.files.length;
  const withNotes = count > 0;
  const answering = !withNotes && task?.status === "awaiting_details";
  const label = withNotes
    ? "Anything she should know about your notes? (optional)"
    : answering
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
      className={`shrink-0 border-t-2 border-walnut/15 bg-canvas px-4 pt-3 pb-4 ${dialogue ? "sm:px-5" : "sm:px-6"}`}
    >
      <div className={dialogue ? "" : "mx-auto max-w-[760px]"}>
        {!dialogue && (withNotes || notes.problems.length > 0) && (
          <NotesTray
            draft={notes}
            disabled={disabled}
            returnFocusTo={attachId}
            onChange={onNotes}
            onRemove={onRemoveNote}
          />
        )}
        <p aria-live="polite" className="sr-only">
          {withNotes ? `${count} ${count === 1 ? "file" : "files"} of notes ready to share` : ""}
        </p>
        <div className={`flex items-center gap-2 ${withNotes ? "max-sm:flex-wrap" : ""}`}>
          <label htmlFor={inputId} className="sr-only">
            {label}
          </label>
          <input
            id={inputId}
            // Over the library the box itself takes focus, so the number keys pick replies (and
            // typing anywhere in it lands here).
            data-autofocus={dialogue ? undefined : true}
            type="text"
            value={draft}
            onChange={(e) => onDraft(e.target.value)}
            maxLength={withNotes ? NOTES_MESSAGE_MAX : 1500}
            autoComplete="off"
            placeholder={
              withNotes
                ? "Anything she should know? For example, midterm on Friday, weak on recursion"
                : answering
                  ? "Type your answer…"
                  : task
                    ? "Ask about something new (starts a new request)…"
                    : "What are you working on?"
            }
            className={`${INPUT} min-w-0 flex-1`}
          />
          <AttachNotesButton
            id={attachId}
            disabled={disabled}
            afterPomodoro={attachAfterPomodoro}
            onClick={onAttach}
          />
          <PushToTalk
            disabled={disabled}
            onText={(text) => {
              onDraft(text);
              document.getElementById(inputId)?.focus();
            }}
          />
          {withNotes ? (
            <button type="submit" className={`${BTN.primary} max-sm:w-full`} disabled={disabled}>
              <IconSend size={18} strokeWidth={2.25} />
              Study these notes
            </button>
          ) : (
            <button
              type="submit"
              className={`${BTN.primary} max-sm:px-3`}
              disabled={disabled || !draft.trim()}
            >
              <IconSend size={18} strokeWidth={2.25} />
              <span className="max-sm:sr-only">Send</span>
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

function HomeView({
  home,
  greeting,
  dialogue,
  disabled,
  returnTo,
  openingId,
  onStarter,
  onPrefill,
  onNotes,
  notesAfterPomodoro,
  onOpen,
  onSave,
}: {
  home: Resource<LibrarianHome>;
  /** What she says first: her personal greeting for a signed-in student, else her usual hello. */
  greeting: string;
  /** Over the library her greeting and the ways to start are the dialogue's line and replies. */
  dialogue: boolean;
  disabled: boolean;
  /** Where "Sign in" comes back to. */
  returnTo: string;
  openingId: string | null;
  onStarter: (text: string) => void;
  /** Starts a message about something on their shelf, for them to finish. */
  onPrefill: (text: string) => void;
  /** Opens the file picker for lecture notes. */
  onNotes: () => void;
  /** Mid-pomodoro in the library: the picker waits until it's over. */
  notesAfterPomodoro: boolean;
  onOpen: (id: string) => void;
  onSave: (card: ResourceCard, saved: boolean) => Promise<void>;
}) {
  const data = home.data;
  const resume = data?.greeting?.resume ?? null;
  return (
    <>
      {!dialogue && (
        <HerTurn>
          <p>{greeting}</p>
          {resume && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onOpen(resume.taskId)}
              className={`${BTN_SM.primary} mt-2.5 max-w-full`}
            >
              <span className="truncate">
                {openingId === resume.taskId ? "Opening…" : `Pick up ${resume.topic}`}
              </span>
              <IconArrowRight size={16} strokeWidth={2.5} />
            </button>
          )}
        </HerTurn>
      )}
      {!dialogue && (
        <div className="sm:pl-[3.25rem]">
          <h3 className="flex items-center gap-2.5 font-display text-[15px] leading-5 font-semibold text-walnut">
            Ways to start
            <DotRow />
          </h3>
          <ul className="mt-3 space-y-2.5">
            <li>
              <button
                type="button"
                disabled={disabled || notesAfterPomodoro}
                onClick={onNotes}
                className={`${LIST_ROW} min-h-12 py-2.5`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-display text-[15.5px] leading-6 font-semibold">
                    Study from my lecture notes
                  </span>
                  <span className="block text-[13px] leading-5 font-medium text-ink-soft">
                    {notesAfterPomodoro
                      ? `${PICKER_AFTER_POMODORO}.`
                      : "PDF, .txt or .md. She reads them, finds sources, then makes a plan or lesson."}
                  </span>
                </span>
                <span className={`${ICON_BADGE} h-8 w-8 bg-leaf`}>
                  <IconUpload size={16} strokeWidth={2.5} />
                </span>
              </button>
            </li>
            {STARTERS.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onStarter(s)}
                  className={`${LIST_ROW} min-h-12 py-2`}
                >
                  <span className="min-w-0 flex-1 font-display text-[15.5px] leading-6 font-semibold">
                    {s}
                  </span>
                  <span
                    className={`${ICON_BADGE} h-8 w-8 bg-sun transition-transform duration-150 group-hover:translate-x-0.5 group-disabled:translate-x-0 motion-reduce:transition-none`}
                  >
                    <IconArrowRight size={16} strokeWidth={2.75} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {home.error && home.error.code !== "not_configured" && !data && (
        <div role="alert" className={ALERT}>
          <span className={ALERT_ICON}>
            <IconWarning size={16} strokeWidth={2.25} />
          </span>
          <span className="min-w-0 flex-1">
            Couldn&apos;t load your recent requests. {home.error.message}
          </span>
          <button type="button" className={BTN_SM.secondary} onClick={home.reload}>
            <IconRefresh size={16} strokeWidth={2.25} />
            Retry
          </button>
        </div>
      )}
      {home.loading && !data && !home.error && (
        <div role="status" className="space-y-2">
          <span className="sr-only">Loading your recent requests</span>
          {[0, 1].map((i) => (
            <div
              key={i}
              className="h-14 rounded-[16px] border-[2.5px] border-walnut/15 bg-canvas motion-safe:animate-pulse"
            />
          ))}
        </div>
      )}

      {data && (
        <Shelf
          account={data.account}
          shelf={data.shelf}
          disabled={disabled}
          returnTo={returnTo}
          onPrefill={onPrefill}
          className={dialogue ? undefined : "sm:ml-[3.25rem]"}
        />
      )}

      {data?.next && (
        <section
          aria-label="Next up"
          className={`${PANEL} relative mt-2 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 pt-5 pb-3.5`}
        >
          <p className={`${RIBBON} absolute -top-3.5 left-4 -rotate-2 gap-1.5`}>
            <IconCalendar size={15} strokeWidth={2.25} />
            Next up
          </p>
          <div className="min-w-[12rem] flex-1">
            <p className="font-display text-[17px] leading-6 font-semibold text-walnut">
              {data.next.item.title}
            </p>
            <p className="font-display text-[13px] leading-5 font-medium text-ink-soft">
              {data.next.planTitle} ·{" "}
              <span className="tabular">{data.next.item.estimatedMinutes} min</span>
            </p>
          </div>
          <button
            type="button"
            className={BTN.secondary}
            disabled={disabled}
            onClick={() => onOpen(data.next!.taskId)}
          >
            {openingId === data.next.taskId ? "Opening…" : "Open the plan"}
          </button>
        </section>
      )}
      {data?.insight && (
        <div
          className={`${PANEL_MUTED} flex gap-3 px-4 py-3 text-sm leading-6 font-medium text-walnut`}
        >
          <span className={`${ICON_BADGE} h-7 w-7 bg-leaf`}>
            <IconChart size={15} strokeWidth={2.25} />
          </span>
          <p className="min-w-0 flex-1">
            <span className="font-display font-semibold">From your progress: </span>
            {data.insight}
          </p>
        </div>
      )}

      {data && data.recent.length > 0 && (
        <section aria-labelledby="librarian-recent" className="pt-2">
          <h3 id="librarian-recent" className={SUBHEAD}>
            Recent requests
          </h3>
          <ul className="mt-3 space-y-2.5">
            {data.recent.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onOpen(r.id)}
                  className={`${LIST_ROW} flex-wrap gap-y-1.5 py-2.5`}
                >
                  <span className="min-w-[10rem] flex-1">
                    <span className="block truncate font-display text-[15.5px] leading-6 font-semibold">
                      {r.topic || "Untitled request"}
                    </span>
                    <span className="block font-display text-[13px] leading-5 font-medium text-ink-soft">
                      {TYPE_LABELS[r.type]} · {formatDate(r.createdAt)}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <StatusChip
                      status={r.status}
                      label={openingId === r.id ? "Opening…" : STATUS_LABELS[r.status]}
                    />
                    <IconChevronRight size={18} strokeWidth={2.5} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {data && data.saved.length > 0 && (
        <section aria-labelledby="librarian-saved" className="pt-2">
          <h3 id="librarian-saved" className={`${SUBHEAD} flex items-center gap-2`}>
            <span className={`${ICON_BADGE} h-7 w-7 bg-sun`}>
              <IconBookmark size={14} strokeWidth={2.25} fill="currentColor" />
            </span>
            Saved sources
          </h3>
          <ul className="mt-5 space-y-6">
            {data.saved.map((card) => (
              <li key={card.id}>
                <ResourceCardView card={card} compact onSave={(saved) => onSave(card, saved)} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

/** A chip on their shelf: a small sticker that starts a message about it. */
const SHELF_CHIP = `inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border-2 border-walnut px-3 py-1 text-left font-display text-[13.5px] leading-5 font-semibold text-walnut shadow-[0_2px_0_#1f1a16] transition-[background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_0_0_#1f1a16] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 motion-reduce:transition-none ${FOCUS}`;

/** "Calculus" → "Calculus circle" (a name that already says circle stays as it is). */
const circleRef = (name: string) =>
  /\bcircle$/i.test(name.trim()) ? name.trim() : `${name.trim()} circle`;

interface ShelfChip {
  key: string;
  name: string;
  /** "12 items", "4 new". */
  count: string;
  fresh?: boolean;
  /** The message it starts. */
  message: string;
}

/**
 * What she can use from a signed-in student's own library (private) and Study Circles (shared):
 * a chip each, which starts a message about it ("Use my CS135 collection to …"). She only ever
 * sees these through the server, which checks that they're the student's own (or a circle
 * they're in). Signed out (with sign-in set up): a line saying what signing in adds.
 */
function Shelf({
  account,
  shelf,
  disabled,
  returnTo,
  onPrefill,
  className = "",
}: {
  account: LibrarianHome["account"];
  shelf: LibrarianShelf | null;
  disabled: boolean;
  returnTo: string;
  onPrefill: (text: string) => void;
  /** Lines it up with what's around it. */
  className?: string;
}) {
  if (account === "signed_out")
    return (
      <div
        className={`${PANEL_MUTED} flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-sm leading-6 font-medium text-walnut ${className}`}
      >
        <span className={`${ICON_BADGE} h-7 w-7 bg-surface`}>
          <IconUser size={15} strokeWidth={2.25} />
        </span>
        <p className="min-w-[12rem] flex-1">
          Sign in and I can use your saved sources, collections and Study Circles when you ask.
        </p>
        <a href={loginHref(returnTo)} className={BTN_SM.secondary}>
          Sign in
        </a>
      </div>
    );
  if (account !== "signed_in" || !shelf) return null;
  const items = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;
  const library: ShelfChip[] = [
    ...(shelf.saved > 0
      ? [
          {
            key: "saved",
            name: "Saved sources",
            count: `${shelf.saved}`,
            message: "Use my saved sources to ",
          },
        ]
      : []),
    ...shelf.collections
      .filter((c) => c.items > 0)
      .map((c, i) => ({
        key: `c${i}`,
        name: c.name,
        count: items(c.items),
        message: `Use my ${c.name} collection to `,
      })),
  ];
  const circles: ShelfChip[] = shelf.circles
    .filter((c) => c.items > 0)
    .map((c, i) => ({
      key: `s${i}`,
      name: c.name,
      count: c.fresh > 0 ? `${c.fresh} new` : items(c.items),
      fresh: c.fresh > 0,
      message:
        c.fresh > 0
          ? `What has my ${circleRef(c.name)} added since my last visit?`
          : `Use what my ${circleRef(c.name)} shared to `,
    }));
  if (!library.length && !circles.length)
    return (
      <p
        className={`${PANEL_MUTED} flex items-center gap-3 px-4 py-3 text-sm leading-6 font-medium text-walnut ${className}`}
      >
        <span className={`${ICON_BADGE} h-7 w-7 bg-sun`}>
          <IconBookmark size={14} strokeWidth={2.25} />
        </span>
        <span className="min-w-0 flex-1">
          Save sources, or join a Study Circle, and I can use them when you ask.
        </span>
      </p>
    );
  const row = (
    label: string,
    tag: string,
    chips: ShelfChip[],
    tone: string,
    icon: React.ReactNode,
  ) =>
    chips.length > 0 && (
      <div>
        <h4 className="flex flex-wrap items-center gap-2 font-display text-[14px] leading-5 font-semibold text-walnut">
          {label}
          <span className={TAG.neutral}>{tag}</span>
        </h4>
        <ul className="mt-2 flex flex-wrap gap-2">
          {chips.map((c) => (
            <li key={c.key} className="max-w-full">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPrefill(c.message)}
                title={`Start a message: “${c.message.trim()}”`}
                className={`${SHELF_CHIP} ${tone}`}
              >
                {icon}
                <span className="min-w-0 truncate">{c.name}</span>
                <span
                  className={
                    c.fresh
                      ? "shrink-0 rounded-full border-2 border-walnut bg-sun px-1.5 text-[12px] leading-4"
                      : "tabular shrink-0 font-medium"
                  }
                >
                  {c.fresh ? (
                    c.count
                  ) : (
                    <>
                      <span aria-hidden>· </span>
                      {c.count}
                    </>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <section aria-labelledby="librarian-shelf" className={`space-y-3 pt-1 ${className}`}>
      <h3 id="librarian-shelf" className="sr-only">
        What I can use from your shelf
      </h3>
      {row(
        "From your library",
        "Only you",
        library,
        "bg-surface hover:bg-canvas",
        <IconBookmark size={14} strokeWidth={2.25} className="shrink-0" />,
      )}
      {row(
        "From your circles",
        "Shared",
        circles,
        "bg-leaf hover:bg-[#8fbf8a]",
        <IconUsers size={15} strokeWidth={2.25} className="shrink-0" />,
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* The request on the desk                                             */
/* ------------------------------------------------------------------ */

function TaskBody({
  task,
  dialogue,
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
  /** Over the library the main actions are the dialogue's numbered replies, not buttons here. */
  dialogue: boolean;
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
  const lessonFrom = lessonSourcesLine(task.lessonSources);
  return (
    <div className="space-y-6">
      {task.type === "study_from_notes" && <YourNotes notes={task.notes} outcome={task.outcome} />}
      {task.status === "awaiting_confirmation" && !dialogue && (
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
        <div role="alert" className={`${PANEL} p-5`}>
          <p className="flex items-center gap-2.5 font-display text-lg font-semibold text-walnut">
            <span className={`${ICON_BADGE} h-8 w-8 bg-[#f3c6bf] text-danger`}>
              <IconWarning size={17} strokeWidth={2.25} />
            </span>
            {STATUS_LABELS.failed}
          </p>
          <p className="mt-1.5 text-sm leading-6 font-medium text-ink-soft">
            {task.error?.message ?? "The request stopped before it finished."}
          </p>
          {!dialogue && (
            <div className="mt-4 flex flex-wrap gap-2.5">
              {task.error?.retryable !== false && (
                <button
                  type="button"
                  className={BTN.primary}
                  onClick={onRetry}
                  disabled={pending !== null}
                >
                  <IconRefresh size={18} strokeWidth={2.25} />
                  {pending === "retry" ? "Retrying…" : "Retry"}
                </button>
              )}
              <button type="button" className={BTN.secondary} onClick={onNewRequest}>
                New request
              </button>
            </div>
          )}
        </div>
      )}
      {task.status === "cancelled" && (
        <div role="status" className={`${PANEL} p-5`}>
          <p className="font-display text-lg font-semibold text-walnut">Cancelled</p>
          <p className="mt-1 text-sm leading-6 font-medium text-ink-soft">
            You stopped this request. Anything she&apos;d already found is below.
          </p>
          {!dialogue && (
            <button type="button" className={`${BTN.secondary} mt-4`} onClick={onNewRequest}>
              New request
            </button>
          )}
        </div>
      )}

      {hasFindings && <Findings task={task} onSave={onSave} />}

      {!dialogue &&
        task.status === "completed" &&
        (!task.plan || !task.lesson) &&
        !nothingToBuildOn(task) && (
          <div className="flex flex-wrap gap-2.5">
            {!task.plan && (
              <button
                type="button"
                // While the plan's details form is open, its "Build my plan" is the main action.
                className={task.lesson || planFormOpen ? BTN.secondary : BTN.primary}
                onClick={onAskPlan}
                disabled={!actionsOpen || planFormOpen}
              >
                <IconCalendar size={18} strokeWidth={2.25} />
                {pending === "plan" ? "Asking…" : "Build a study plan"}
              </button>
            )}
            {!task.lesson && (
              <button
                type="button"
                className={task.plan ? BTN.primary : BTN.secondary}
                onClick={() => onLesson()}
                disabled={!actionsOpen}
              >
                <IconGraduationCap size={18} strokeWidth={2.25} />
                {pending === "lesson" ? "Asking…" : "Create interactive lesson"}
              </button>
            )}
          </div>
        )}
      {planFormOpen && !task.plan && (
        <div data-plan-form>
          <PlanForm
            askDate={!mentionsDate(task.request)}
            askMinutes={!mentionsStudyTime(task.request)}
            busy={pending === "plan"}
            onSubmit={onBuildPlan}
            onCancel={onClosePlanForm}
          />
        </div>
      )}

      {lessonReady && task.lesson && (
        <section
          aria-labelledby="librarian-lesson"
          className={`${PANEL} relative mt-2 p-5 pt-6 pr-16`}
        >
          <p className={`${RIBBON} absolute -top-3.5 left-5 -rotate-2 gap-1.5`}>
            <IconGraduationCap size={15} strokeWidth={2.25} />
            Interactive lesson
          </p>
          {/* A tilted stamp with the number of scenes (the line under the title says it too). */}
          <span
            aria-hidden
            className="tabular absolute -top-4 -right-3 grid h-16 w-16 rotate-12 place-items-center rounded-full border-[3px] border-walnut bg-sun text-center font-display leading-none font-bold text-walnut shadow-[0_4px_0_#1f1a16]"
          >
            <span>
              <span className="block text-[22px]">{task.lesson.scenes.length}</span>
              <span className="block text-[11px] font-semibold">scenes</span>
            </span>
          </span>
          <h3
            id="librarian-lesson"
            className="font-display text-[22px] leading-tight font-bold text-walnut"
          >
            {task.lesson.title}
          </h3>
          <p className="tabular mt-1 font-display text-[13px] leading-5 font-medium text-ink-soft">
            {task.lesson.scenes.length} scenes
            {lessonFrom ? ` · ${lessonFrom}` : ""}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
            {!dialogue && (
              <button type="button" className={BTN.primary} onClick={onPlay}>
                <IconPlay size={18} strokeWidth={2.25} fill="currentColor" />
                Play lesson
              </button>
            )}
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
    { id: "quick", title: "Quick", detail: "About a minute" },
    {
      id: "deep",
      title: "Deep",
      detail: "5–20 minutes · goes much deeper",
    },
  ];
  return (
    <section aria-labelledby={`${uid}-title`} className={`${PANEL} relative mt-2 p-5 pt-6`}>
      <p className={`${RIBBON} absolute -top-3.5 left-5 -rotate-2 gap-1.5`}>
        <IconSearch size={15} strokeWidth={2.5} />
        Ready when you are
      </p>
      <h3 id={`${uid}-title`} className="sr-only">
        Start the research?
      </h3>
      <p className="max-w-[62ch] text-[15px] leading-6 font-medium whitespace-pre-line text-walnut">
        {task.confirmation ?? "She's ready to start researching."}
      </p>
      <fieldset className="mt-5">
        <legend className={LABEL}>How thorough?</legend>
        <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
          {options.map((o) => (
            <label
              key={o.id}
              className={`flex cursor-pointer items-start gap-3 rounded-[16px] border-[2.5px] px-3.5 py-3 transition-[background-color,border-color,box-shadow] duration-150 has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-sun has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-walnut motion-reduce:transition-none ${mode === o.id ? "border-walnut bg-sun shadow-[0_3px_0_#1f1a16]" : "border-walnut/30 bg-surface hover:border-walnut"}`}
            >
              <input
                type="radio"
                name={`${uid}-mode`}
                value={o.id}
                checked={mode === o.id}
                onChange={() => setMode(o.id)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-walnut outline-none"
              />
              <span>
                <span className="block font-display text-[15px] leading-5 font-semibold text-walnut">
                  {o.title}
                </span>
                <span
                  className={`mt-0.5 block text-[13px] leading-5 font-medium ${mode === o.id ? "text-walnut/75" : "text-ink-soft"}`}
                >
                  {o.detail}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          className={BTN.primary}
          disabled={busy || !tinyfishReady}
          title={tinyfishReady ? undefined : "Live research isn't set up on this server yet"}
          onClick={() => onConfirm(mode)}
        >
          {busy ? "Starting…" : "Start research"}
        </button>
        <button type="button" className={BTN.secondary} disabled={busy} onClick={onNotNow}>
          Not now
        </button>
      </div>
      <p className="mt-3 text-[13px] leading-5 font-medium text-ink-soft">
        &ldquo;Not now&rdquo; keeps it under Recent requests for later.
      </p>
    </section>
  );
}

/** Each kind of step, as an icon (none for a plain status line) and the words for it. */
const STEP_KINDS: Record<
  ResearchStep["kind"],
  { Icon: ((props: IconProps) => React.ReactNode) | null; label: string }
> = {
  search: { Icon: IconSearch, label: "Searched" },
  fetch: { Icon: IconFile, label: "Read" },
  plan: { Icon: IconList, label: "Planned" },
  status: { Icon: null, label: "Status" },
  note: { Icon: IconInfo, label: "Note" },
  error: { Icon: IconWarning, label: "Problem" },
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
  const fromNotes = task.type === "study_from_notes";
  // A lesson the cloud worker is making: its own status, and the student may leave.
  const cloud = task.status === "generating_lesson" ? task.cloudLesson : null;
  return (
    <section aria-labelledby={`${uid}-title`} className={`${PANEL} p-5`}>
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <StatusDot working />
        <h3
          id={`${uid}-title`}
          className="min-w-0 flex-1 font-display text-lg leading-6 font-semibold text-walnut"
        >
          <span aria-live="polite">
            {cloud ? JOB_STATUS_LABELS[cloud.status] : STATUS_LABELS[task.status]}
          </span>
        </h3>
        {cloud && <span className={`${TAG.brass} rotate-2`}>In the cloud</span>}
        {researching && (
          <span className={`${TAG.brass} rotate-2`}>
            {task.mode === "deep" ? "Deep research" : "Quick research"}
          </span>
        )}
      </div>
      {cloud && (
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-5 font-medium text-ink-soft">
          {cloud.progress ? `${cloud.progress}. ` : ""}You can close this page — your lesson is
          being made in the cloud, and it&apos;ll be here when you come back.
        </p>
      )}
      {fromNotes && (task.status === "reading_notes" || researching) ? (
        // The whole run from the upload. A plan or lesson asked for later is just that step.
        <p className="mt-1.5 max-w-[62ch] text-[13px] leading-5 font-medium text-ink-soft">
          {notesPipeline(task.outcome)}
        </p>
      ) : (
        researching && (
          <p className="mt-1.5 max-w-[62ch] text-[13px] leading-5 font-medium text-ink-soft">
            {task.mode === "deep"
              ? "Deep research usually takes 5–20 minutes, and can take longer. You can close this and come back: it's under Recent requests."
              : "Quick research usually takes about a minute."}
          </p>
        )
      )}
      {task.steps.length > 0 ? (
        <ol
          aria-label="What she's done so far"
          className="relative mt-4 max-h-64 space-y-2 overflow-y-auto border-t-2 border-dashed border-walnut/20 pt-3 pr-1 text-sm leading-5 font-medium"
        >
          {task.steps.map((step, i) => {
            const kind = STEP_KINDS[step.kind];
            const error = step.kind === "error";
            return (
              <li key={`${step.at}-${i}`} className="flex items-start gap-2.5">
                <span
                  aria-hidden
                  className={`flex h-5 w-4 shrink-0 items-center justify-center ${error ? "text-danger" : "text-walnut/70"}`}
                >
                  {kind.Icon ? (
                    <kind.Icon size={16} strokeWidth={2.25} />
                  ) : (
                    <span className="h-2 w-2 rounded-full border-[1.5px] border-walnut bg-sun" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="sr-only">{kind.label}: </span>
                  <span className={error ? "font-semibold text-danger" : "text-walnut"}>
                    {step.label}
                  </span>
                  {step.url && (
                    <span className="text-[13px] text-ink-soft"> · {domainOf(step.url)}</span>
                  )}
                </span>
                <time
                  dateTime={step.at}
                  className="tabular shrink-0 font-display text-xs leading-5 font-medium text-ink-soft"
                >
                  {formatTime(step.at)}
                </time>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="mt-4 border-t-2 border-dashed border-walnut/20 pt-3 text-sm font-medium text-ink-soft">
          Nothing back yet.
        </p>
      )}
      {trouble && (
        <p
          role="status"
          className="mt-3 flex items-start gap-2 text-[13px] leading-5 font-semibold text-danger"
        >
          <IconWarning size={16} strokeWidth={2.25} className="mt-0.5" />
          {trouble}
        </p>
      )}
      {slow && (
        <p
          role="status"
          className={`${PANEL_MUTED} mt-3 flex gap-2.5 px-3.5 py-2.5 text-sm leading-6 font-medium text-walnut`}
        >
          <IconClock size={18} strokeWidth={2.25} className="mt-[3px]" />
          This is taking longer than usual. You can keep waiting, or cancel and try again later.
        </p>
      )}
      <button
        type="button"
        className={`${BTN.secondary} mt-4`}
        onClick={onCancel}
        disabled={cancelling}
      >
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
      <span
        role="status"
        className="inline-flex items-center gap-1.5 rounded-full border-2 border-walnut bg-leaf px-3 py-1 font-display text-sm leading-5 font-semibold text-walnut shadow-[0_2px_0_#1f1a16]"
      >
        <IconCheck size={15} strokeWidth={3} />
        Saved to your Learning Studio
      </span>
    );
  }
  return (
    <button
      type="button"
      className={BTN.secondary}
      onClick={() => {
        addLesson({
          lesson,
          chunks: task.lessonChunks,
          sourceName:
            task.type === "study_from_notes"
              ? `Your notes with Ms. Fenwick's research: ${task.topic || lesson.title}`
              : `Ms. Fenwick's research: ${task.topic || lesson.title}`,
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
  // A cloud lesson's narration is already recorded and stored: play it, don't make it again.
  const cloud = task.cloudLesson;
  const playback = useLessonPlayback(lesson, {
    audio:
      cloud?.status === "completed"
        ? Object.fromEntries(cloud.audio.map((s) => [s, sceneAudioUrl(cloud.jobId, s)]))
        : undefined,
  });
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-lesson-player>
      {/* Clips the player's screen-reader-only text, so it can't stretch the page past the window. */}
      <div className="relative min-h-0 flex-1 overflow-clip">
        <LessonPlayerView
          playback={playback}
          chunks={task.lessonChunks}
          onExit={onExit}
          exitLabel="Back to Ms. Fenwick"
          headerActions={<SaveLessonButton task={task} />}
          fill
        />
      </div>
      {task.lessonSources.length > 0 && (
        <section
          aria-label="Lesson sources"
          className="relative max-h-28 shrink-0 overflow-y-auto border-t-2 border-walnut/15 bg-canvas px-4 py-2.5 sm:px-6"
        >
          <h3 className="font-display text-[13px] leading-5 font-semibold text-walnut">Sources</h3>
          <ol className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-[13px] leading-5 font-medium">
            {task.lessonSources.map((s) => (
              <li key={s.page}>
                <span className="tabular font-display font-semibold text-ink-soft">[{s.page}]</span>{" "}
                {s.url ? (
                  <SourceLink href={s.url} className={TEXT_LINK}>
                    {s.title || domainOf(s.url)}
                  </SourceLink>
                ) : (
                  // A page of the student's own notes: named, not linked.
                  <span className="text-walnut">{s.title || "Your notes"}</span>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
