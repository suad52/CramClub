"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { XP_EVENT } from "./client";
import type { Leaderboard, LeaderboardOrder } from "./types";

/**
 * This week's two leaderboards for the boards standing in the library hall: most focus time and
 * most XP. Fetched when the library opens, then every minute, when the tab comes back and soon
 * after you earn XP. A board that can't be fetched shows "offline"; one that was showing keeps
 * its last rows through a blip. Failures are silent.
 */

export type HallBoard =
  | { status: "loading" }
  | { status: "offline" }
  | { status: "ready"; board: Leaderboard; failures: number };

/** Consecutive failed refreshes after which a board stops showing its old rows. */
export const STALE_AFTER = 3;
export const REFRESH_MS = 60_000;
/** After an XP toast: long enough for the server's aggregate to have the new points. */
const AFTER_XP_MS = 2_500;

const ORDERS: readonly LeaderboardOrder[] = ["focus", "xp"];

export const useHallBoards = create<{ boards: Record<LeaderboardOrder, HallBoard> }>(() => ({
  boards: { focus: { status: "loading" }, xp: { status: "loading" } },
}));

/** What a board shows after a fetch: the new rows, or (null) the old ones for a while. */
export function nextHallBoard(prev: HallBoard, fetched: Leaderboard | null): HallBoard {
  if (fetched) return { status: "ready", board: fetched, failures: 0 };
  if (prev.status === "ready" && prev.failures + 1 < STALE_AFTER)
    return { ...prev, failures: prev.failures + 1 };
  return { status: "offline" };
}

function isLeaderboard(v: unknown): v is Leaderboard {
  const b = v as Partial<Leaderboard> | null;
  return !!b && Array.isArray(b.rows) && typeof b.from === "string" && typeof b.to === "string";
}

async function fetchBoard(by: LeaderboardOrder, signal: AbortSignal) {
  try {
    const res = await fetch(`/api/learning/leaderboard?period=week&by=${by}`, {
      cache: "no-store",
      signal,
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    return isLeaderboard(json) ? json : null;
  } catch {
    return null;
  }
}

async function refresh(signal: AbortSignal) {
  const results = await Promise.all(ORDERS.map((by) => fetchBoard(by, signal)));
  if (signal.aborted) return;
  const boards = { ...useHallBoards.getState().boards };
  ORDERS.forEach((by, i) => (boards[by] = nextHallBoard(boards[by], results[i] ?? null)));
  useHallBoards.setState({ boards });
}

/** Keeps both hall boards fresh while mounted. */
export function useHallBoardsLive() {
  useEffect(() => {
    const abort = new AbortController();
    let inFlight = false;
    let soon: ReturnType<typeof setTimeout> | undefined;
    const run = () => {
      if (inFlight || document.visibilityState === "hidden") return;
      inFlight = true;
      void refresh(abort.signal).finally(() => (inFlight = false));
    };
    const onVisible = () => document.visibilityState === "visible" && run();
    const onXp = () => {
      clearTimeout(soon);
      soon = setTimeout(run, AFTER_XP_MS);
    };
    run();
    const timer = setInterval(run, REFRESH_MS);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(XP_EVENT, onXp);
    return () => {
      abort.abort();
      clearInterval(timer);
      clearTimeout(soon);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(XP_EVENT, onXp);
    };
  }, []);
}
