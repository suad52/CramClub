import { wrapAngle } from "@ovr/shared";
import type { QuickTimings } from "@/lib/game/pomodoro";
import { SESSION_EARLY_GRACE_S } from "@/lib/learning/rules";
import { HOLD_MINUTES, type TableStatus, WARN_MINUTES } from "@/lib/tables/types";

/**
 * The judge demo, the pure half (lib/demo/mode.ts keeps it on or off for one browser tab;
 * components/demo/ shows it). Demo mode only ever makes things quicker or easier to show: the
 * same server paths and checks run, nothing is counted that wouldn't be, and nothing it makes up
 * goes over the network.
 *
 * - Timings: a 1-minute pomodoro (the server takes whole minutes, at least 1), a 15-second short
 *   break, a 30-second long break after every 2.
 * - Table holds: DEMO_HOLD_MINUTES (the tables API's optional `minutes`, which can only ever
 *   shorten a hold), with the "nearly up" notice DEMO_WARN_MINUTES before the end.
 * - "Finish this pomodoro now" rings it for real only once the server would agree it ran its
 *   length (finishKind); before that it's a marked preview that earns nothing.
 * - Theo (demo): a local-only study buddy across your table (lib/demo/buddy.ts).
 * - Ms. Fenwick or a lesson taking longer than DEMO_FALLBACK_MS (or failing): a clearly marked
 *   saved example instead of a spinner (lib/demo/fixtures.ts).
 */

/** The table timer in demo mode. focusMinutes stays a whole number: session-start needs one. */
export const DEMO_TIMINGS: QuickTimings = {
  focusMinutes: 1,
  shortBreakMinutes: 0.25,
  longBreakMinutes: 0.5,
  longBreakEvery: 2,
};

/** How long a table hold lasts in demo mode, and when its "nearly up" notice comes. */
export const DEMO_HOLD_MINUTES = 3;
export const DEMO_WARN_MINUTES = 1;

/** Ms. Fenwick or a lesson this slow (ms) gets a saved example beside it. */
export const DEMO_FALLBACK_MS = 25_000;

/** In a 1-minute pomodoro, someone near you this long counts as studying alongside you. */
export const DEMO_COMPANION_MIN_MS = 20_000;

/**
 * "Finish this pomodoro now" counts for real only with this little left (well inside the server's
 * own early grace, SESSION_EARLY_GRACE_S, so its clock agrees); earlier it's a preview.
 */
export const DEMO_REAL_FINISH_MS = 10_000;

/** The local-only study buddy. The id can never be a server sessionId (those have no colon). */
export const DEMO_BUDDY = { id: "demo:theo", name: "Theo (demo)" } as const;

/** What the demo's background lesson is about (the saved example is the same topic). */
export const DEMO_LESSON_TOPIC = "Cellular respiration: how cells turn glucose into ATP";

/** `?demo=1` turns demo mode on, `?demo=0` off; null when the URL doesn't say. */
export function demoFlagFrom(search: string): boolean | null {
  const v = new URLSearchParams(search).get("demo")?.trim().toLowerCase();
  if (v === undefined) return null;
  if (v === "1" || v === "true" || v === "on" || v === "") return true;
  if (v === "0" || v === "false" || v === "off") return false;
  return null;
}

/** A table hold's length: the demo's short one, or the usual HOLD_MINUTES. */
export const holdMinutes = (demo: boolean) => (demo ? DEMO_HOLD_MINUTES : HOLD_MINUTES);
/** When the holder hears "nearly up" (minutes before the end). */
export const warnMinutes = (demo: boolean) => (demo ? DEMO_WARN_MINUTES : WARN_MINUTES);

/** "1 hour", "2 hours", "90 minutes", "3 minutes", "1 minute". */
export function holdText(minutes: number) {
  if (minutes % 60 === 0) return minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/** "Your hour at Table 3", "your 3 minutes at Table 3". */
export const holdNoun = (minutes: number) => (minutes === 60 ? "hour" : holdText(minutes));

/**
 * What "Finish this pomodoro now" does right now: ring it for real (the server will agree it ran
 * its length), ring a marked preview (too early: no XP, not counted), or nothing (no pomodoro).
 */
export function finishKind(
  p: { phase: string; endsAt: number | null; pausedRemaining: number | null },
  now: number,
): "real" | "preview" | null {
  if (p.phase !== "focus" || p.endsAt === null) return null;
  const left = p.pausedRemaining ?? p.endsAt - now;
  return left <= DEMO_REAL_FINISH_MS ? "real" : "preview";
}

/** Seconds until the finish would count for real (0 once it would). */
export function secondsUntilReal(p: { endsAt: number | null }, now: number) {
  if (p.endsAt === null) return 0;
  return Math.max(0, Math.ceil((p.endsAt - now - DEMO_REAL_FINISH_MS) / 1000));
}

/** Kept in step with the server's grace (tested): a real finish must never be refused. */
export const REAL_FINISH_IS_SAFE = DEMO_REAL_FINISH_MS < SESSION_EARLY_GRACE_S * 1000;

/** The parts of a seat (packages/shared Seat) this needs. */
export interface SeatSpot {
  id: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  tableId: string | null;
}

/**
 * Where Theo sits: at your table, in a free seat, preferring the side facing you (the closest
 * across), then the nearest beside you. Null when the table has no free seat (or you have none).
 */
export function buddySeatFor(
  mine: SeatSpot | null | undefined,
  seats: readonly SeatSpot[],
  taken: ReadonlySet<string>,
): SeatSpot | null {
  if (!mine?.tableId) return null;
  let best: SeatSpot | null = null;
  let bestScore = Infinity;
  for (const s of seats) {
    if (s.tableId !== mine.tableId || s.id === mine.id || taken.has(s.id)) continue;
    const across = Math.abs(wrapAngle(s.rotationY - mine.rotationY)) > Math.PI / 2;
    const score = (across ? 0 : 100) + Math.hypot(s.x - mine.x, s.z - mine.z);
    if (score < bestScore) {
      best = s;
      bestScore = score;
    }
  }
  return best;
}

export interface DemoSeatPick {
  tableId: string;
  seatId: string;
  /** Theo's seat across the table (null if there's none free). */
  buddySeatId: string | null;
}

/**
 * The table the demo seats you at: one nobody's sitting at (so you're the first here and are
 * offered to hold it), that nobody holds, with room for Theo across from you. Tables in
 * `preferred` (those with a rolling board, where lessons play) come first, then plan order.
 * `skip` holds tables already tried. Null when no table fits.
 */
export function pickDemoSeat(
  seats: readonly SeatSpot[],
  opts: {
    /** Seats other people are in. */
    taken: ReadonlySet<string>;
    /** The tables API's statuses, if known (unknown tables count as free). */
    statuses?: readonly TableStatus[] | null;
    preferred?: ReadonlySet<string>;
    skip?: ReadonlySet<string>;
  },
): DemoSeatPick | null {
  const byTable = new Map<string, SeatSpot[]>();
  for (const s of seats) {
    if (!s.tableId) continue;
    const list = byTable.get(s.tableId) ?? [];
    list.push(s);
    byTable.set(s.tableId, list);
  }
  const status = new Map((opts.statuses ?? []).map((t) => [t.tableId, t]));
  let best: { pick: DemoSeatPick; rank: number } | null = null;
  let order = 0;
  for (const [tableId, list] of byTable) {
    order += 1;
    if (list.length < 2 || opts.skip?.has(tableId)) continue;
    if (list.some((s) => opts.taken.has(s.id))) continue;
    const st = status.get(tableId);
    if (st && (st.held || !st.canSit)) continue;
    const mine = list[0]!;
    const buddy = buddySeatFor(mine, list, opts.taken);
    if (!buddy) continue;
    const rank = (opts.preferred?.has(tableId) ? 0 : 1000) + order;
    if (!best || rank < best.rank)
      best = { pick: { tableId, seatId: mine.id, buddySeatId: buddy.id }, rank };
  }
  return best?.pick ?? null;
}

/** Whether something that started at `since` (ms) has been going long enough for the fallback. */
export function fallbackDue(since: number | null, now: number, ms = DEMO_FALLBACK_MS) {
  return since !== null && now - since >= ms;
}
