import { type LibrarianTask, NOTES_LIMITS, type NotesOutcome } from "./types";

/**
 * Lecture notes a student gives Ms. Fenwick (POST /api/librarian/notes, see types.ts): checking
 * the files against NOTES_LIMITS before they're sent (the server checks again), the form the
 * endpoint reads, and the words the panel uses for them. No React here, so it's easy to test.
 */

/** What the file picker offers: extensions for most browsers, media types for the rest. */
export const NOTES_ACCEPT = ".pdf,.txt,.md,application/pdf,text/plain,text/markdown";

/** The longest note to her that goes with the files (the endpoint takes up to 1000 characters). */
export const NOTES_MESSAGE_MAX = 1000;

/** The notes on their way to her, before they're sent. */
export interface NotesDraft {
  files: File[];
  /** Why files the student just chose weren't added (shown until the next change). */
  problems: string[];
  outcome: NotesOutcome;
  /** "YYYY-MM-DD", or "" for none. */
  examDate: string;
  /** null: not sure (she works it out from the message, or a sensible default). */
  minutesPerDay: number | null;
}

export const EMPTY_NOTES: NotesDraft = {
  files: [],
  problems: [],
  outcome: "both",
  examDate: "",
  minutesPerDay: null,
};

const MB = 1024 * 1024;

/** "840 KB", "2.4 MB", "15 MB". */
export function formatSize(bytes: number) {
  if (bytes < MB) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Number((bytes / MB).toFixed(1))} MB`;
}

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const quoted = (name: string) => `“${name}”`;

/**
 * Adds the files the student chose (or dropped) to those already attached. A file that isn't a
 * PDF, .txt or .md, is empty, is too big, or is already there is left out, and so is anything past
 * the limit; each is said in words in `problems`.
 */
export function addNotesFiles<T extends { name: string; size: number }>(
  current: readonly T[],
  incoming: readonly T[],
) {
  const files = [...current];
  const problems: string[] = [];
  const overflow: T[] = [];
  const extensions: readonly string[] = NOTES_LIMITS.extensions;
  for (const file of incoming) {
    const name = quoted(file.name);
    if (!extensions.includes(extensionOf(file.name))) {
      problems.push(
        `${name} isn't a PDF, .txt or .md file. Save it as a PDF and add that instead.`,
      );
    } else if (file.size === 0) {
      problems.push(`${name} is empty.`);
    } else if (file.size > NOTES_LIMITS.maxBytes) {
      // Rounded up, so a file just over the limit never reads as exactly the limit.
      const size = Math.ceil((file.size / MB) * 10) / 10;
      problems.push(
        `${name} is ${size} MB. Each file can be up to ${formatSize(NOTES_LIMITS.maxBytes)}.`,
      );
    } else if (files.some((f) => f.name === file.name && f.size === file.size)) {
      problems.push(`${name} is already added.`);
    } else if (files.length >= NOTES_LIMITS.maxFiles) {
      overflow.push(file);
    } else {
      files.push(file);
    }
  }
  const [first] = overflow;
  if (first) {
    const left =
      overflow.length === 1 ? `${quoted(first.name)} wasn't` : `${overflow.length} files weren't`;
    problems.push(
      `She reads up to ${NOTES_LIMITS.maxFiles} files at a time, so ${left} added. Remove one to make room.`,
    );
  }
  return { files, problems };
}

/**
 * Why the message can't go with the notes (the endpoint takes up to 1000 characters), or null.
 * It can only be longer when it was written before the notes were added, or spoken: it's never
 * cut short without saying so.
 */
export function notesMessageProblem(message: string) {
  const n = message.trim().length;
  if (n <= NOTES_MESSAGE_MAX) return null;
  const count = (x: number) => x.toLocaleString("en");
  return `Your message is ${count(n)} characters. With notes, keep it to ${count(NOTES_MESSAGE_MAX)} or fewer.`;
}

/** The student's turn in the conversation: "Shared 2 files of notes", then what they wrote. */
export function notesTurn(count: number, message: string) {
  const shared = `Shared ${count} ${count === 1 ? "file" : "files"} of notes`;
  const note = message.trim();
  return note ? `${shared}\n${note}` : shared;
}

/**
 * The student's own message on a notes request, as the server keeps it: without one, it stores
 * "Study from my notes: <file names>", which the "Shared N files" turn already says.
 */
export function notesMessage(request: string, names: readonly string[]) {
  return request === `Study from my notes: ${names.join(", ")}` ? "" : request;
}

/** The choices for what she makes from the notes, in the order they're offered. */
export const OUTCOME_OPTIONS: readonly { id: NotesOutcome; title: string; detail: string }[] = [
  { id: "plan", title: "Study plan", detail: "Day by day, up to your exam" },
  { id: "lesson", title: "Interactive lesson", detail: "Narrated scenes with quick checks" },
  { id: "both", title: "Both", detail: "The plan, then the lesson" },
];

/** What the student asked for, to finish "You asked for …". */
export const OUTCOME_SUMMARY: Record<NotesOutcome, string> = {
  plan: "a study plan",
  lesson: "an interactive lesson",
  both: "a study plan and an interactive lesson",
};

/** The outcome includes a study plan (so an exam date and study time are worth asking for). */
export const includesPlan = (outcome: NotesOutcome) => outcome !== "lesson";

/**
 * A notes request she turned down (the upload wasn't study material): the pipeline always ends
 * with the plan and/or lesson otherwise, so it finished without either. Building one then would
 * study the very file she declined, so the panel doesn't offer it.
 */
export const notesDeclined = (task: Pick<LibrarianTask, "type" | "status" | "plan" | "lesson">) =>
  task.type === "study_from_notes" && task.status === "completed" && !task.plan && !task.lesson;

/**
 * A finished request with nothing to build a plan or lesson from: notes she declined, or a request
 * she answered without researching (from their own library, or something that isn't theirs, or
 * one she declined). Plan and lesson buttons stay hidden; the server would refuse them anyway.
 */
export const nothingToBuildOn = (
  task: Pick<LibrarianTask, "type" | "status" | "plan" | "lesson" | "resources">,
) =>
  notesDeclined(task) ||
  (task.type !== "study_from_notes" &&
    task.status === "completed" &&
    task.resources.length === 0 &&
    !task.plan &&
    !task.lesson);

/** What happens to the notes, said while she works on them (a description, not progress). */
export function notesPipeline(outcome: NotesOutcome | null) {
  const makes =
    outcome === "plan"
      ? "your study plan"
      : outcome === "lesson"
        ? "your lesson"
        : "your study plan and lesson";
  return `Gemini reads your notes first. Then TinyFish opens the links in them and searches the web for what they cover thinly, and Gemini writes ${makes} from both. This usually takes a few minutes. You can close this and come back: it's under Recent requests.`;
}

/** Study time choices (minutes a day; the endpoint takes 10–600). */
export const MINUTES_OPTIONS = [15, 30, 45, 60, 90, 120, 180, 240] as const;

/** "45 min", "1 hour", "1.5 hours". */
export function minutesLabel(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number(hours.toFixed(1))} ${hours === 1 ? "hour" : "hours"}`;
}

/** "1 page", "12 pages". */
export const pagesLabel = (pages: number) => `${pages} ${pages === 1 ? "page" : "pages"}`;

/**
 * The multipart form for POST /api/librarian/notes: "files" once per file, then "message",
 * "outcome", and (only when a plan is included, and only when set) "examDate" and "minutesPerDay".
 */
export function notesForm(draft: NotesDraft, message: string) {
  const form = new FormData();
  for (const file of draft.files) form.append("files", file, file.name);
  // Checked before sending (notesMessageProblem); the cut is only a last guard.
  const note = message.trim().slice(0, NOTES_MESSAGE_MAX);
  if (note) form.append("message", note);
  form.append("outcome", draft.outcome);
  if (includesPlan(draft.outcome)) {
    if (draft.examDate) form.append("examDate", draft.examDate);
    if (draft.minutesPerDay !== null) form.append("minutesPerDay", String(draft.minutesPerDay));
  }
  return form;
}

/**
 * Where a lesson came from, for its card: "from 4 sources", "from your notes", or "from your notes
 * and 4 web sources" (pages from the student's notes have url "").
 */
export function lessonSourcesLine(sources: readonly { url: string }[]) {
  const web = sources.filter((s) => s.url).length;
  const fromNotes = sources.length > web;
  const count = (label: string) => `${web} ${label}${web === 1 ? "" : "s"}`;
  if (!fromNotes) return web ? `from ${count("source")}` : "";
  return web ? `from your notes and ${count("web source")}` : "from your notes";
}
