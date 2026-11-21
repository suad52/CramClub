"use client";

import { useEffect, useRef } from "react";

export interface MovementKeys {
  forward: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
}

export interface KeyActions {
  onInteract?: () => void;
  onToggleCamera?: () => void;
  onToggleWalkFast?: () => void;
  onOpenBoard?: () => void;
  /** L: choose a lesson to play on the whiteboard. */
  onLessons?: () => void;
  /** J / N: join, or say "not now" to, the lesson playing on a nearby whiteboard. */
  onJoinLesson?: () => void;
  onDeclineLesson?: () => void;
  /** F: the joined lesson full screen, and back. */
  onLessonFullscreen?: () => void;
  /** P: start a pomodoro on the table timer. */
  onStartPomodoro?: () => void;
  /** Shift pressed (true) or released (false): frees the mouse cursor while held. */
  onFreeCursor?: (held: boolean) => void;
}

const MOVE_CODES: Record<string, keyof MovementKeys> = {
  KeyW: "forward",
  ArrowUp: "forward",
  KeyS: "back",
  ArrowDown: "back",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};

const isShift = (code: string) => code === "ShiftLeft" || code === "ShiftRight";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Tracks WASD / arrow keys in a ref (no re-renders) and fires one-shot actions for E, V, R, B, the
 * whiteboard lesson keys (L, J, N, F) and P (the table timer), plus press/release for Shift. Uses
 * physical key codes so WASD stays in the same place on AZERTY and other layouts.
 */
export function useKeyboardMovement(actions: KeyActions) {
  const keys = useRef<MovementKeys>({ forward: false, back: false, left: false, right: false });
  const actionsRef = useRef(actions);
  useEffect(() => {
    actionsRef.current = actions;
  });

  useEffect(() => {
    let shiftHeld = false;
    const down = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const move = MOVE_CODES[e.code];
      if (move) {
        keys.current[move] = true;
        if (e.code.startsWith("Arrow")) e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (isShift(e.code)) {
        if (!shiftHeld) actionsRef.current.onFreeCursor?.(true);
        shiftHeld = true;
        return;
      }
      // Browser shortcuts (Cmd+F, Ctrl+L, …) aren't game keys.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.code === "KeyE") {
        // E can open a panel whose text box takes focus mid-keypress: don't let the "e" land in it.
        e.preventDefault();
        actionsRef.current.onInteract?.();
      } else if (e.code === "KeyV") actionsRef.current.onToggleCamera?.();
      else if (e.code === "KeyR") actionsRef.current.onToggleWalkFast?.();
      else if (e.code === "KeyB") actionsRef.current.onOpenBoard?.();
      else if (e.code === "KeyL") actionsRef.current.onLessons?.();
      else if (e.code === "KeyJ") actionsRef.current.onJoinLesson?.();
      else if (e.code === "KeyN") actionsRef.current.onDeclineLesson?.();
      else if (e.code === "KeyF") actionsRef.current.onLessonFullscreen?.();
      else if (e.code === "KeyP") actionsRef.current.onStartPomodoro?.();
    };
    const up = (e: KeyboardEvent) => {
      const move = MOVE_CODES[e.code];
      if (move) keys.current[move] = false;
      // Only let go once neither Shift key is still down.
      if (isShift(e.code) && shiftHeld && !e.shiftKey) {
        shiftHeld = false;
        actionsRef.current.onFreeCursor?.(false);
      }
    };
    // Releasing keys while the window is unfocused would otherwise leave them "held".
    const release = () => {
      for (const k of Object.keys(keys.current) as (keyof MovementKeys)[]) keys.current[k] = false;
      if (shiftHeld) {
        shiftHeld = false;
        actionsRef.current.onFreeCursor?.(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", release);
    document.addEventListener("visibilitychange", release);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", release);
      document.removeEventListener("visibilitychange", release);
    };
  }, []);

  return keys;
}
