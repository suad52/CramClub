"use client";

import { create } from "zustand";
import { CHAT, type ChatLine, FENWICK_ID } from "@ovr/shared";
import { type BubbleSource, appendLine, mergeLines } from "./format";

/*
 * The library chat as this browser knows it. lib/net/connection.ts fills it from the room
 * (ServerMessages.chat, chat_history, fenwick_typing, and each player's `typing` in the state)
 * and sends what the panel (components/chat/ChatPanel.tsx) asks; nothing here is sent or kept
 * anywhere else, and only the "Ms. Fenwick answers if nobody does" switch outlives the page
 * (this browser's localStorage).
 *
 * Two halves, like lib/net/players.ts:
 * - `useChat`, a small React store for the panel: the lines, who's typing, whether she's writing
 *   a reply (and to whom), open/unread, the switch;
 * - `chatLive`, plain objects the 3D speech bubbles read every frame (components/world/
 *   ChatBubbles.tsx): each player's latest line (with when it arrived here, performance.now())
 *   and whether they're typing, and the same for Ms. Fenwick. Nothing re-renders from it.
 */

const FENWICK_KEY = "ovr.chat.fenwick";

function readFenwickPref() {
  try {
    return localStorage.getItem(FENWICK_KEY) !== "0";
  } catch {
    return true;
  }
}

export interface ChatState {
  /** The room's lines, oldest first (at most CHAT_KEEP). */
  lines: ChatLine[];
  /** Others typing right now (sessionIds, in the order they started). */
  typing: string[];
  /** The players Ms. Fenwick is writing a reply to right now (sessionIds). */
  fenwickTyping: string[];
  /** The panel is open (else it's the small "Chat" pill). */
  open: boolean;
  /** Lines from others since the panel was last open. */
  unread: number;
  /** "Ms. Fenwick answers if nobody does" (sent with each line as `fenwick`). Default on. */
  fenwick: boolean;
  /** What's in the box (kept while the panel is closed). */
  draft: string;
  /** Bumped to ask the panel to put the cursor in the box. */
  focusNonce: number;
}

export const useChat = create<ChatState>(() => ({
  lines: [],
  typing: [],
  fenwickTyping: [],
  open: false,
  unread: 0,
  fenwick: typeof window === "undefined" ? true : readFenwickPref(),
  draft: "",
  focusNonce: 0,
}));

const freshSource = (): BubbleSource => ({
  text: "",
  at: Number.NEGATIVE_INFINITY,
  typing: false,
});

export const chatLive = {
  players: new Map<string, BubbleSource>(),
  fenwick: freshSource(),
};

function liveOf(id: string) {
  let live = chatLive.players.get(id);
  if (!live) {
    live = freshSource();
    chatLive.players.set(id, live);
  }
  return live;
}

/** "fenwick_typing" on never followed by off (a lost message): she stops after this long. */
const FENWICK_TYPING_MAX_MS = CHAT.FENWICK_TIMEOUT_MS + 5000;
const fenwickTimers = new Map<string, ReturnType<typeof setTimeout>>();

function syncFenwickLive(list: string[]) {
  chatLive.fenwick.typing = list.length > 0;
}

/** Ms. Fenwick started (on) or stopped (off) writing a reply to `to`. */
export function setFenwickTyping(on: boolean, to: string) {
  const timer = fenwickTimers.get(to);
  if (timer) clearTimeout(timer);
  fenwickTimers.delete(to);
  if (on)
    fenwickTimers.set(
      to,
      setTimeout(() => setFenwickTyping(false, to), FENWICK_TYPING_MAX_MS),
    );
  const list = useChat.getState().fenwickTyping;
  const has = list.includes(to);
  if (on === has) return;
  const next = on ? [...list, to] : list.filter((id) => id !== to);
  syncFenwickLive(next);
  useChat.setState({ fenwickTyping: next });
}

/** Someone else started or stopped typing (from their `typing` in the room's state). */
export function setPlayerTyping(id: string, on: boolean) {
  const live = on ? liveOf(id) : chatLive.players.get(id);
  if (live) live.typing = on;
  const list = useChat.getState().typing;
  const has = list.includes(id);
  if (on === has) return;
  useChat.setState({ typing: on ? [...list, id] : list.filter((x) => x !== id) });
}

/** Someone left the room: they're not typing, and their bubble goes with them. */
export function forgetPlayer(id: string) {
  setPlayerTyping(id, false);
  chatLive.players.delete(id);
}

/**
 * A new line arrived (yours included: the server's echo is your confirmation). Returns whether it
 * was new (a repeat of a line already shown changes nothing).
 */
export function receiveLine(line: ChatLine, selfId: string | null, now = performance.now()) {
  const s = useChat.getState();
  const lines = appendLine(s.lines, line);
  if (!lines) return false;
  const fenwick = line.from === FENWICK_ID;
  const mine = !!selfId && line.from === selfId;
  const patch: Partial<ChatState> = { lines };
  if (!s.open && !mine) patch.unread = Math.min(99, s.unread + 1);
  // Sending a line ends their typing (the state patch that says so is on its way).
  if (!fenwick && s.typing.includes(line.from))
    patch.typing = s.typing.filter((id) => id !== line.from);
  useChat.setState(patch);
  if (fenwick) {
    chatLive.fenwick.text = line.text;
    chatLive.fenwick.at = now;
    if (line.replyTo) setFenwickTyping(false, line.replyTo);
  } else if (!mine) {
    const live = liveOf(line.from);
    live.text = line.text;
    live.at = now;
    live.typing = false;
  }
  return true;
}

/** The room's recent lines, just after joining: they replace what was shown (no unread, no bubbles). */
export function setHistory(lines: ChatLine[]) {
  useChat.setState({ lines });
}

/**
 * The room's recent lines again, after a reconnect: the ones said while the link was down are
 * added (and count as unread from others while the panel is closed). No bubbles, and her
 * replies among them aren't said aloud: they're old news by now.
 */
export function catchUpHistory(history: ChatLine[], selfId: string | null) {
  const s = useChat.getState();
  const { lines, added } = mergeLines(s.lines, history);
  if (added.length === 0) return;
  const fromOthers = added.filter((l) => !selfId || l.from !== selfId).length;
  useChat.setState(
    s.open || fromOthers === 0 ? { lines } : { lines, unread: Math.min(99, s.unread + fromOthers) },
  );
}

/** The link dropped or closed: nobody is typing any more (as far as this browser can tell). */
export function clearChatPresence() {
  for (const timer of fenwickTimers.values()) clearTimeout(timer);
  fenwickTimers.clear();
  chatLive.players.clear();
  chatLive.fenwick.typing = false;
  const s = useChat.getState();
  if (s.typing.length > 0 || s.fenwickTyping.length > 0)
    useChat.setState({ typing: [], fenwickTyping: [] });
}

/** Left the library: the chat starts empty next time (the switch and the draft stay). */
export function resetChat() {
  clearChatPresence();
  chatLive.fenwick = freshSource();
  useChat.setState({ lines: [], unread: 0, open: false });
}

export function setChatOpen(open: boolean) {
  const s = useChat.getState();
  if (s.open === open && (!open || s.unread === 0)) return;
  useChat.setState(open ? { open, unread: 0 } : { open });
}

/** Opens the panel with the cursor in the box (Enter in the library, or the pill). */
export function focusChat() {
  useChat.setState((s) => ({ open: true, unread: 0, focusNonce: s.focusNonce + 1 }));
}

export function setDraft(draft: string) {
  useChat.setState({ draft });
}

/** "Ms. Fenwick answers if nobody does", remembered in this browser. */
export function setFenwickAnswers(on: boolean) {
  useChat.setState({ fenwick: on });
  try {
    localStorage.setItem(FENWICK_KEY, on ? "1" : "0");
  } catch {
    // Private mode or storage blocked: it holds for this visit.
  }
}
