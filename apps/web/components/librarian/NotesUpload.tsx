"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ApiError } from "@/components/progress/api";
import {
  IconChevronDown,
  IconClose,
  IconFile,
  IconUpload,
  IconWarning,
} from "@/components/ui/icons";
import { ICON_BTN, INPUT, LABEL, PANEL_MUTED, RIBBON } from "@/components/ui/styles";
import {
  MINUTES_OPTIONS,
  type NotesDraft,
  OUTCOME_OPTIONS,
  OUTCOME_SUMMARY,
  formatSize,
  includesPlan,
  minutesLabel,
  pagesLabel,
} from "@/lib/librarian/notes";
import { localDay } from "@/lib/librarian/planDetails";
import {
  type LibrarianTask,
  NOTES_LIMITS,
  type NotesFile,
  type NotesOutcome,
} from "@/lib/librarian/types";
import { ICON_BADGE, SQUARE_BTN } from "./parts";

/*
 * Lecture notes for Ms. Fenwick: the "Add notes" button beside the mic, the tray that lists the
 * files with what she should make from them, the drop overlay, and the request's "Your notes"
 * block. Gemini reads the notes on the server; TinyFish then looks up what they cover thinly.
 */

/** Sends the notes (multipart; the fields are in lib/librarian/notes.ts and types.ts). */
export async function postNotes(form: FormData): Promise<LibrarianTask> {
  let res: Response;
  try {
    res = await fetch("/api/librarian/notes", {
      method: "POST",
      body: form,
      cache: "no-store",
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "network", "Couldn't reach the library's server.");
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (body as { error?: { code?: unknown; message?: unknown } } | null)?.error;
    const tooLarge = res.status === 413;
    throw new ApiError(
      res.status,
      typeof error?.code === "string" ? error.code : tooLarge ? "too_large" : "http_error",
      typeof error?.message === "string"
        ? error.message
        : tooLarge
          ? `Those files are too big to send. Each can be up to ${formatSize(NOTES_LIMITS.maxBytes)}.`
          : `The server couldn't answer (${res.status}).`,
    );
  }
  if (body === null || typeof body !== "object")
    throw new ApiError(res.status, "bad_response", "The server sent something unexpected.");
  return body as LibrarianTask;
}

/** The same square sticker as the mic beside it (44px). */
const ATTACH_BTN = `${SQUARE_BTN} bg-surface text-walnut hover:bg-canvas disabled:hover:bg-surface aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:translate-y-0 aria-disabled:hover:bg-surface aria-disabled:active:translate-y-0 aria-disabled:active:shadow-[0_4px_0_#1f1a16]`;

/**
 * Why the file picker is switched off mid-pomodoro in the library: the browser's file window
 * takes focus from the tab, which the pomodoro counts as leaving it (see SourceLink).
 */
export const PICKER_AFTER_POMODORO =
  "Available after your pomodoro: choosing files counts as leaving the tab";

/** "Add notes": opens the file picker (the hidden input lives in the panel). */
export function AttachNotesButton({
  id,
  disabled,
  afterPomodoro,
  onClick,
}: {
  id: string;
  disabled: boolean;
  /** Mid-pomodoro: stays focusable, says why it does nothing (like SourceLink). */
  afterPomodoro: boolean;
  onClick: () => void;
}) {
  return (
    <button
      id={id}
      type="button"
      onClick={afterPomodoro ? undefined : onClick}
      disabled={disabled}
      aria-disabled={afterPomodoro || undefined}
      aria-label={
        afterPomodoro ? "Add notes (available after your pomodoro)" : "Add notes (PDF, .txt or .md)"
      }
      title={afterPomodoro ? PICKER_AFTER_POMODORO : "Add lecture notes"}
      className={ATTACH_BTN}
    >
      <IconUpload size={19} strokeWidth={2.25} />
    </button>
  );
}

const hasFiles = (e: React.DragEvent) => e.dataTransfer.types.includes("Files");

/**
 * A file dropped next to the panel (on the library behind it, or the page around it) would
 * otherwise replace the page with the file, losing the library and the conversation. While the
 * panel is open, such drops do nothing (the panel's own handlers run first and mark theirs).
 */
function useStrayDropGuard() {
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (e.defaultPrevented || !e.dataTransfer?.types.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);
}

/**
 * Drag-and-drop of files onto the panel. `zone` goes on the panel (it also stops a stray drop
 * from opening the file in place of the library); `overlay` on the overlay shown while dragging.
 */
export function useNotesDrop(enabled: boolean, onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  useStrayDropGuard();
  const over = (e: React.DragEvent) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = enabled ? "copy" : "none";
  };
  return {
    dragging: dragging && enabled,
    zone: {
      onDragEnter: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        if (enabled) setDragging(true);
      },
      onDragOver: over,
      // Only reached when the overlay isn't up (adding was switched off mid-drag): nothing is
      // added, and the overlay mustn't come back later on its own.
      onDrop: (e: React.DragEvent) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDragging(false);
      },
    },
    overlay: {
      onDragOver: over,
      // The overlay's contents ignore the pointer, so this only fires on leaving the panel.
      onDragLeave: (e: React.DragEvent) => {
        if (e.target === e.currentTarget) setDragging(false);
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        const files = [...e.dataTransfer.files];
        if (files.length) onFiles(files);
      },
    },
  };
}

/** Shown over the whole panel while files are dragged over it. */
export function NotesDropOverlay(handlers: ReturnType<typeof useNotesDrop>["overlay"]) {
  return (
    <div
      {...handlers}
      aria-hidden
      className="absolute inset-0 z-30 grid place-items-center bg-surface/95 p-4 sm:p-6"
    >
      <div className="pointer-events-none flex h-full w-full flex-col items-center justify-center gap-3 rounded-[22px] border-[3px] border-dashed border-walnut bg-[#fdf1d6] px-6 text-center">
        <span
          className={`${ICON_BADGE} title-bob h-14 w-14 -rotate-6 border-[3px] bg-sun shadow-[0_4px_0_#1f1a16]`}
        >
          <IconUpload size={26} strokeWidth={2.25} />
        </span>
        <p className="font-display text-xl font-bold text-walnut">Drop your notes to add them</p>
        <p className="text-[13px] leading-5 font-medium text-ink-soft">
          PDF, .txt or .md · up to {NOTES_LIMITS.maxFiles} files,{" "}
          {formatSize(NOTES_LIMITS.maxBytes)} each
        </p>
      </div>
    </div>
  );
}

/**
 * The notes on their way to her, above the message box: each file (with a remove button), why any
 * weren't added, what she should make, and for a plan, the exam date and study time. Over the
 * library it sits in the dialogue box's scroll area instead (`inline`: no scroll of its own).
 */
export function NotesTray({
  draft,
  disabled,
  returnFocusTo,
  onChange,
  onRemove,
  inline = false,
}: {
  draft: NotesDraft;
  disabled: boolean;
  /** Where focus goes when the last file is removed (the "Add notes" button's id). */
  returnFocusTo: string;
  onChange: (change: Partial<NotesDraft>) => void;
  onRemove: (index: number) => void;
  /** Inside a scroll area already (the dialogue box): no height limit or scroll of its own. */
  inline?: boolean;
}) {
  const uid = useId();
  const [today] = useState(localDay);
  const list = useRef<HTMLUListElement>(null);
  const { files, problems, outcome } = draft;

  // A removed file's button goes with it: focus the next file's, or "Add notes" after the last.
  const remove = (index: number) => {
    onRemove(index);
    requestAnimationFrame(() => {
      const buttons = list.current?.querySelectorAll<HTMLButtonElement>("[data-notes-remove]");
      const next = buttons?.[Math.min(index, buttons.length - 1)];
      (next ?? document.getElementById(returnFocusTo))?.focus();
    });
  };

  return (
    <section
      aria-labelledby={`${uid}-title`}
      className={`rounded-[20px] border-[2.5px] border-walnut bg-canvas p-3 shadow-[0_4px_0_#1f1a16] sm:p-4 ${inline ? "" : "mb-4 max-h-[min(28rem,46dvh)] overflow-y-auto"}`}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id={`${uid}-title`} className={`${RIBBON} -rotate-1 gap-1.5`}>
          <IconFile size={15} strokeWidth={2.25} />
          Your notes
        </h3>
        {files.length > 0 && (
          <span className="tabular font-display text-xs font-semibold text-ink-soft">
            {files.length} of {NOTES_LIMITS.maxFiles}
          </span>
        )}
      </div>

      {files.length > 0 && (
        <ul ref={list} className="mt-3 space-y-2">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.size}-${file.lastModified}`}
              className="flex items-center gap-3 rounded-[14px] border-2 border-walnut bg-surface py-1.5 pr-1.5 pl-2"
            >
              <span
                aria-hidden
                className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] border-2 border-walnut bg-sun text-walnut"
              >
                <IconFile size={17} strokeWidth={2.25} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-display text-sm leading-5 font-semibold text-walnut">
                  {file.name}
                </span>
                <span className="tabular block text-xs leading-4 text-ink-soft">
                  {formatSize(file.size)}
                </span>
              </span>
              <button
                type="button"
                data-notes-remove
                className={ICON_BTN}
                aria-label={`Remove ${file.name}`}
                title="Remove"
                disabled={disabled}
                onClick={() => remove(i)}
              >
                <IconClose size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {problems.length > 0 && (
        <ul role="alert" className="mt-2 space-y-1 text-[13px] leading-5 font-medium text-danger">
          {problems.map((p) => (
            <li key={p} className="flex items-start gap-2">
              <IconWarning size={16} className="mt-0.5" />
              <span className="min-w-0 flex-1">{p}</span>
            </li>
          ))}
        </ul>
      )}
      {files.length === 0 && (
        <p className="mt-1.5 text-[13px] leading-5 text-ink-soft">
          Add a PDF, .txt or .md file of your notes: up to {NOTES_LIMITS.maxFiles} files,{" "}
          {formatSize(NOTES_LIMITS.maxBytes)} each.
        </p>
      )}

      {files.length > 0 && (
        <>
          <fieldset className="mt-3.5" disabled={disabled}>
            <legend className={LABEL}>What should she make?</legend>
            {/* Three across at every width: on a phone, the radio sits above its words. */}
            <div className="mt-2 grid grid-cols-3 gap-2">
              {OUTCOME_OPTIONS.map((o) => {
                const checked = outcome === o.id;
                return (
                  <label
                    key={o.id}
                    className={`flex min-h-10 cursor-pointer flex-col items-center gap-1 rounded-[14px] border-[2.5px] px-2 py-2 text-center transition-[background-color,border-color,box-shadow] duration-150 has-[:disabled]:cursor-not-allowed has-[:focus-visible]:ring-4 has-[:focus-visible]:ring-sun has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-walnut motion-reduce:transition-none sm:flex-row sm:items-start sm:gap-2.5 sm:px-3 sm:text-left ${checked ? "border-walnut bg-sun shadow-[0_3px_0_#1f1a16]" : "border-walnut/30 bg-surface hover:border-walnut"}`}
                  >
                    <input
                      type="radio"
                      name={`${uid}-outcome`}
                      value={o.id}
                      checked={checked}
                      onChange={() => onChange({ outcome: o.id })}
                      className="h-4 w-4 shrink-0 accent-walnut outline-none sm:mt-0.5"
                    />
                    <span className="min-w-0">
                      <span className="block font-display text-sm leading-5 font-semibold text-walnut">
                        {o.title}
                      </span>
                      <span
                        className={`mt-0.5 block text-xs leading-4 font-medium max-sm:hidden ${checked ? "text-walnut/75" : "text-ink-soft"}`}
                      >
                        {o.detail}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {includesPlan(outcome) && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <label className="block min-w-0">
                <span className={LABEL}>
                  Exam date <span className="font-medium text-ink-soft">(optional)</span>
                </span>
                <input
                  type="date"
                  value={draft.examDate}
                  min={today}
                  disabled={disabled}
                  onChange={(e) => onChange({ examDate: e.target.value })}
                  className={`${INPUT} tabular mt-1.5 disabled:opacity-60`}
                />
              </label>
              <label className="block min-w-0">
                <span className={LABEL}>
                  Time a day <span className="font-medium text-ink-soft">(optional)</span>
                </span>
                <span className="relative mt-1.5 block">
                  <select
                    value={draft.minutesPerDay ?? ""}
                    disabled={disabled}
                    onChange={(e) =>
                      onChange({ minutesPerDay: e.target.value ? Number(e.target.value) : null })
                    }
                    className={`${INPUT} appearance-none pr-10 disabled:opacity-60`}
                  >
                    <option value="">Not sure</option>
                    {MINUTES_OPTIONS.map((m) => (
                      <option key={m} value={m}>
                        {minutesLabel(m)}
                      </option>
                    ))}
                  </select>
                  <IconChevronDown
                    size={18}
                    strokeWidth={2.25}
                    className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-walnut"
                  />
                </span>
              </label>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** The request's notes, as the server read them, and what the student asked for. */
export function YourNotes({
  notes,
  outcome,
}: {
  notes: NotesFile[];
  outcome: NotesOutcome | null;
}) {
  const uid = useId();
  return (
    <section
      aria-labelledby={`${uid}-title`}
      className={`${PANEL_MUTED} relative mt-3.5 px-4 pt-5 pb-3.5`}
    >
      <h3 id={`${uid}-title`} className={`${RIBBON} absolute -top-3.5 left-4 -rotate-1 gap-1.5`}>
        <IconFile size={15} strokeWidth={2.25} />
        Your notes
      </h3>
      {notes.length > 0 && (
        <ul className="space-y-0.5">
          {notes.map((n, i) => (
            <li
              key={`${n.name}-${i}`}
              className="flex min-w-0 items-baseline gap-1.5 text-[15px] leading-6 text-walnut"
            >
              <span className="min-w-0 truncate font-display font-semibold">{n.name}</span>
              <span aria-hidden className="text-ink-soft">
                ·
              </span>
              <span className="tabular shrink-0 text-[13px] text-ink-soft">
                {pagesLabel(n.pages)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {outcome && (
        <p className="mt-1.5 text-[13px] leading-5 text-ink-soft">
          You asked for {OUTCOME_SUMMARY[outcome]}.
        </p>
      )}
    </section>
  );
}
