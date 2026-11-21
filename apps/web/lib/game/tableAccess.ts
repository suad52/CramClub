import { isFocusing, usePomodoro } from "@/lib/game/pomodoro";
import {
  isReservable,
  refreshTables,
  serverNow,
  showToast,
  statusOf,
  tableName,
  useTables,
} from "@/lib/tables/client";
import { msLeft } from "@/lib/tables/time";
import type { TableStatus } from "@/lib/tables/types";
import { getSeat, leaveSeatNow } from "./actions";
import { useGameStore } from "./store";

/*
 * Table holds, kept live while you sit. With other people in the library, the table you're at
 * can change under you: whoever holds it can make it private. When the tables store says you may
 * no longer sit there, you get a calm word first and stand up a few seconds later (a pomodoro
 * stops then, since it can't move tables). While you sit at a table someone else holds, its
 * status is checked more often than the usual 30 s.
 */

/** Between the notice and standing up. */
export const STAND_GRACE_MS = 4000;
/** How often the table is checked while you sit at one someone else holds. */
export const HELD_REFRESH_MS = 10_000;

/** Whether this status means you have to leave (a running hold you may not sit at). */
export function mustLeave(status: TableStatus | null, now: number) {
  return !!status && status.held && !status.canSit && msLeft(status.endsAt, now) > 0;
}

/** The table you're sitting at, if it's one someone can hold. */
function seatedTable() {
  const tableId = getSeat(useGameStore.getState().seatId)?.tableId;
  return isReservable(tableId) ? tableId : null;
}

/** Watches your table while the library is open; returns the function that stops watching. */
export function watchTableAccess(): () => void {
  /** The hold we've already told you about (and are standing you up from). */
  let noticed: string | null = null;
  let standTimer: ReturnType<typeof setTimeout> | null = null;

  const cancel = () => {
    if (standTimer) clearTimeout(standTimer);
    standTimer = null;
    noticed = null;
  };

  const check = () => {
    const tableId = seatedTable();
    const status = tableId ? statusOf(tableId) : null;
    if (!tableId || !status || !mustLeave(status, serverNow())) return cancel();
    const key = `${tableId}@${status.endsAt}`;
    if (noticed === key) return;
    cancel();
    noticed = key;
    const who = status.holderName ?? "Someone";
    const focusing = isFocusing(usePomodoro.getState());
    showToast(
      `${who} has made ${tableName(tableId)} private, so you'll stand up in a moment.${focusing ? " Your pomodoro stops here; start a fresh one at a free table." : " There are free tables nearby."}`,
    );
    standTimer = setTimeout(() => {
      standTimer = null;
      // Still there, and still not allowed (an invite may have come through meanwhile).
      if (seatedTable() === tableId && mustLeave(statusOf(tableId), serverNow())) leaveSeatNow();
      noticed = null;
    }, STAND_GRACE_MS);
  };

  const offTables = useTables.subscribe((s, prev) => {
    if (s.view !== prev.view) check();
  });
  const offGame = useGameStore.subscribe((s, prev) => {
    if (s.seatId !== prev.seatId) check();
  });
  const poll = setInterval(() => {
    const tableId = seatedTable();
    const status = tableId ? statusOf(tableId) : null;
    const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
    if (status?.held && !status.mine && !hidden) void refreshTables();
  }, HELD_REFRESH_MS);
  check();
  return () => {
    offTables();
    offGame();
    clearInterval(poll);
    cancel();
  };
}
