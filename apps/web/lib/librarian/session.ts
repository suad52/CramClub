"use client";

import { create } from "zustand";
import { notesMessage, notesTurn } from "./notes";
import type { LibrarianTask } from "./types";
import { sayAloud } from "./voice";

/**
 * The conversation with the Librarian in this browser tab: the request on the desk and what's
 * been said about it. Kept outside the panel so closing and reopening her panel over the library
 * picks up where it left off (the server keeps the request itself; this keeps the chat).
 */

export interface ChatMessage {
  id: string;
  from: "student" | "librarian";
  text: string;
  /** What she still needs to know, with a follow-up question. */
  questions: string[];
}

interface LibrarianSession {
  task: LibrarianTask | null;
  messages: ChatMessage[];
  /** When this tab first saw the request busy (ms), for "this is taking longer than usual". */
  busySince: number | null;
  /** A new request: a fresh conversation that starts with the student's message. */
  start: (text: string) => void;
  /** The student answered her question about the request on the desk. */
  say: (text: string) => void;
  /** The server's latest on the request: kept, plus her reply when it's new. */
  receive: (task: LibrarianTask, now: number) => void;
  /** Reopens an earlier request: the request and her latest reply, as the server keeps them. */
  reopen: (task: LibrarianTask, now: number) => void;
  /** A local change to the request on the desk (a saved source, a finished plan item). */
  patch: (id: string, change: (task: LibrarianTask) => LibrarianTask) => void;
  /** Back to the start (the request stays on the server, under Recent requests). */
  clear: () => void;
}

let seq = 0;
const message = (from: ChatMessage["from"], text: string, questions: string[] = []) => ({
  id: `m${++seq}`,
  from,
  text,
  questions,
});

const replyOf = (task: LibrarianTask) =>
  message("librarian", task.reply, task.status === "awaiting_details" ? task.questions : []);

/**
 * She says a reply that just arrived: aloud in her voice (cutting off the line before it), with
 * its text revealed as she says it (voice.ts revealedChars); with no voice, she mouths it.
 */
function speak(text: string) {
  void sayAloud(text);
}

export const useLibrarianSession = create<LibrarianSession>()((set) => ({
  task: null,
  messages: [],
  busySince: null,
  start: (text) => set({ task: null, messages: [message("student", text)], busySince: null }),
  say: (text) => set((s) => ({ messages: [...s.messages, message("student", text)] })),
  receive: (task, now) =>
    set((s) => {
      const same = s.task?.id === task.id;
      const last = s.messages.at(-1);
      const lastReply = s.messages.findLast((m) => m.from === "librarian")?.text;
      // New when the student spoke last (even if she repeats herself), or when it's changed.
      const fresh = !!task.reply.trim() && (last?.from !== "librarian" || task.reply !== lastReply);
      if (fresh) speak(task.reply);
      return {
        task,
        messages: fresh ? [...s.messages, replyOf(task)] : s.messages,
        busySince: task.busy ? (same && s.task?.busy && s.busySince) || now : null,
      };
    }),
  reopen: (task, now) => {
    // Notes requests open the way they were sent: "Shared 2 files of notes", then the message.
    const asked =
      task.type === "study_from_notes"
        ? notesTurn(
            task.notes.length,
            notesMessage(
              task.request,
              task.notes.map((n) => n.name),
            ),
          )
        : task.request;
    const messages = [message("student", asked)];
    if (task.reply.trim()) {
      messages.push(replyOf(task));
      speak(task.reply);
    }
    set({ task, messages, busySince: task.busy ? now : null });
  },
  patch: (id, change) => set((s) => (s.task?.id === id ? { task: change(s.task) } : {})),
  clear: () => set({ task: null, messages: [], busySince: null }),
}));
