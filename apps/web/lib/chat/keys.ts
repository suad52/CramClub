"use client";

import { isBoardOpen, isTimerPanelOpen } from "@/lib/game/actions";
import { useGameStore } from "@/lib/game/store";
import { isLessonOverlayOpen, liveBoard } from "@/lib/learning-studio/boardLessons";

/*
 * The chat and the library's keys. While the chat box has focus its keys are text: the game's
 * key handlers already skip a key typed into a text box (hooks/useKeyboardMovement.ts, the "?"
 * guide), the box stops every key from reaching the rest of the page, and Esc (which the table
 * cards and the timer settings catch first, in the capture phase) is taken here, earlier still,
 * so it only closes the chat. Taking the mouse for the box doesn't open the pause menu either
 * (components/world/CameraRig.tsx asks chatHasFocus()), and letting go of Shift doesn't take the
 * mouse back from it (lib/game/actions.ts holdFreeCursor).
 */

/** The attribute that marks the chat's text box. */
export const CHAT_INPUT_ATTR = "data-chat-input";

export function isChatInput(target: EventTarget | null) {
  return (
    typeof HTMLElement !== "undefined" &&
    target instanceof HTMLElement &&
    target.hasAttribute(CHAT_INPUT_ATTR)
  );
}

/** The cursor is in the chat box right now. */
export function chatHasFocus() {
  return typeof document !== "undefined" && isChatInput(document.activeElement);
}

/** Takes the cursor out of the chat box (back to walking around). */
export function leaveChatInput() {
  const el = typeof document !== "undefined" ? document.activeElement : null;
  if (isChatInput(el)) (el as HTMLElement).blur();
}

/**
 * Whether a key press may open the chat: you're walking around the library (no menu, guide,
 * panel, whiteboard, lesson or timer dialog over it, and no lesson's quick check waiting for its
 * answer: its "press 1–4, then Enter" owns Enter) and the key wasn't aimed at a control or a text
 * box (Enter on a focused button presses that button).
 */
export function mayOpenChat(target: EventTarget | null) {
  const s = useGameStore.getState();
  if (
    !s.ready ||
    s.phase !== "playing" ||
    s.menuOpen ||
    s.guideOpen ||
    s.progressOpen ||
    s.studioOpen ||
    s.librarianOpen ||
    isBoardOpen() ||
    isLessonOverlayOpen() ||
    isTimerPanelOpen() ||
    liveBoard.frame?.showQuestion
  )
    return false;
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return true;
  return (
    target === document.body ||
    target === document.documentElement ||
    target instanceof HTMLCanvasElement ||
    target.hasAttribute("data-look-surface")
  );
}

type EscHandler = () => void;
const GUARD_KEY = "__ovrChatEsc";

/**
 * Esc in the chat box closes the chat and nothing else. Installed once, when the panel's module
 * loads, so it's the first window capture listener (the table cards and the timer settings add
 * theirs later, when they mount). A newer install (hot reload) replaces the older one.
 */
export function installChatEscape(onEscape: EscHandler) {
  if (typeof window === "undefined") return;
  const w = window as unknown as Record<string, ((e: KeyboardEvent) => void) | undefined>;
  const old = w[GUARD_KEY];
  if (old) window.removeEventListener("keydown", old, true);
  const guard = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || e.isComposing || !isChatInput(e.target)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    onEscape();
  };
  w[GUARD_KEY] = guard;
  window.addEventListener("keydown", guard, true);
}
