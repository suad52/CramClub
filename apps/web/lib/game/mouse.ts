"use client";

import { useEffect } from "react";
import { chatHasFocus } from "@/lib/chat/keys";
import { isLessonOverlayOpen } from "@/lib/learning-studio/boardLessons";
import { type TimerPanel, isBoardOpen, isTimerPanelOpen, setTimerPanelOpen } from "./actions";
import { exitPointerLock, requestPointerLock } from "./pointer";
import { useGameStore } from "./store";

/*
 * Where the mouse belongs. Walking, it's captured for looking around. Seated at a table it's free
 * the whole time, for the timer, the table's cards and the lesson (drag the view to look around):
 * sitting down lets it go and standing up captures it again (CameraRig), and nothing captures it
 * while you sit (pointer.ts). A card or dialog that has to be clicked frees it while it's up
 * (useFreeMouse), and a walking player gets it captured again when it goes. Holding Shift is only
 * for clicking things you don't have to (the HUD's buttons while walking).
 */

/** Whether something on screen wants the mouse free: a seat, a panel, a card, the chat box, Shift. */
export function mouseWanted(): boolean {
  const s = useGameStore.getState();
  return (
    s.phase !== "playing" ||
    !!s.seatId ||
    s.cursorFree ||
    s.menuOpen ||
    s.guideOpen ||
    s.progressOpen ||
    s.studioOpen ||
    s.librarianOpen ||
    isBoardOpen() ||
    isLessonOverlayOpen() ||
    isTimerPanelOpen() ||
    chatHasFocus()
  );
}

/**
 * Captures the mouse for walking again, unless something on screen still wants it free. Call it
 * from (or right after) a click or key press: browsers only allow capturing the mouse then.
 */
export function recaptureForWalking() {
  if (!mouseWanted()) requestPointerLock({ quiet: true });
}

/**
 * While `active`, a card that has to be clicked is up: the mouse is free for it (as a timer panel,
 * so letting it go isn't taken as pausing), and a walking player gets it back when the card goes.
 */
export function useFreeMouse(panel: TimerPanel, active: boolean) {
  useEffect(() => {
    if (!active) return;
    setTimerPanelOpen(panel, true);
    exitPointerLock();
    return () => {
      setTimerPanelOpen(panel, false);
      recaptureForWalking();
    };
  }, [panel, active]);
}
