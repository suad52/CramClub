"use client";

import {
  AVATAR_PRESETS,
  DEFAULT_AVATAR,
  PLAYER,
  SEATS,
  findStandPoint,
  wrapAngle,
} from "@ovr/shared";
import { useProfileStore } from "@/lib/avatar/profile";
import { getSeat, hasLessonFace, requestSit } from "@/lib/game/actions";
import { usePomodoro } from "@/lib/game/pomodoro";
import { runtime } from "@/lib/game/runtime";
import { useGameStore } from "@/lib/game/store";
import { isOnline } from "@/lib/net/connection";
import { isSeatTakenByOther, takenSeats } from "@/lib/net/players";
import { TABLE_IDS, refreshTables, showToast, useTables } from "@/lib/tables/client";
import { buddySeat, keepBuddy, removeBuddy, seatBuddy } from "./buddy";
import { DEMO_BUDDY, DEMO_TIMINGS, buddySeatFor, pickDemoSeat } from "./settings";

/*
 * The judge demo, live (rules in ./settings.ts). startDemo() runs while demo mode is on in the
 * library (components/demo/DemoLayer.tsx starts it) and makes the library ready to show in
 * seconds:
 *
 * - the table timer switches to the demo's quick timings (never saved);
 * - the title screen and the Character Studio are skipped once: you go straight to the camera
 *   and microphone check ("Before you go in", never skipped) as your own character, or a
 *   ready-made one (saved as yours) if you have none yet; sign-in stays in the pause menu and on
 *   the ribbon. The rest waits for you to "Go in" from the check, however long that takes;
 * - you arrive beside a free table instead of at the door. That happens before the library room
 *   is joined (only once you go in), so the room's first sight of you is there (it never lets a
 *   player jump across the hall later: moves are held to walking speed), and once you're in you
 *   sit through the usual sit flow (requestSit: the tables server and the library room both
 *   still have their say), so you're offered to hold the table as the first here;
 * - Theo (demo) sits across from you (./buddy.ts, local only), and follows you to a new table.
 *
 * Everything it changes is undone by the returned stop (the ribbon's "Exit demo" also reloads).
 */

/** A ready-made character for a judge who has none yet (they can restyle it any time). */
const DEMO_NAME = "Alex";
const DEMO_AVATAR = AVATAR_PRESETS.find((p) => p.id === "campus_runner")?.config ?? DEFAULT_AVATAR;

/** How long the tables' statuses get to arrive before a table is picked anyway. */
const TABLES_WAIT_MS = 1500;
/** How long one sit gets (the tables server, then the library room) before the next seat. */
const SIT_WAIT_MS = 8000;
/** The library room only seats you within this of a seat (apps/game-server rules SIT_RANGE_M). */
const SIT_RANGE_M = 2;

const LESSON_TABLES = new Set(TABLE_IDS.filter((t) => hasLessonFace(t)));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(test: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (test()) return true;
    await sleep(150);
  }
  return test();
}

/** Seats other people are in, Theo's excepted (he'll move for you). */
function othersSeats() {
  const taken = new Set<string>();
  for (const [seat, who] of takenSeats()) if (who !== DEMO_BUDDY.id) taken.add(seat);
  return taken;
}

/** Puts you at a seat's side, facing it (only before the room has seen you: see above). */
function arriveAt(seatId: string) {
  const seat = getSeat(seatId);
  const stand = seat && findStandPoint(seat, PLAYER.radius);
  if (!seat || !stand) return false;
  runtime.x = stand.x;
  runtime.y = stand.y;
  runtime.z = stand.z;
  runtime.vx = 0;
  runtime.vz = 0;
  runtime.facing = wrapAngle(Math.atan2(seat.x - stand.x, seat.z - stand.z));
  runtime.autoYaw = wrapAngle(runtime.facing + Math.PI);
  return true;
}

/** Free seats at `tableId` close enough to sit in from where you stand, nearest first. */
function seatsInReach(tableId: string) {
  return SEATS.filter(
    (s) =>
      s.tableId === tableId &&
      !isSeatTakenByOther(s.id) &&
      Math.abs(s.y - runtime.y) < 0.5 &&
      Math.hypot(s.x - runtime.x, s.z - runtime.z) <= SIT_RANGE_M - 0.2,
  ).sort(
    (a, b) =>
      Math.hypot(a.x - runtime.x, a.z - runtime.z) - Math.hypot(b.x - runtime.x, b.z - runtime.z),
  );
}

/** Theo takes the free seat across from yours (if your table has one). */
function seatBuddyAcross(mySeatId: string | null) {
  const mine = getSeat(mySeatId);
  if (!mine?.tableId) return;
  const current = getSeat(buddySeat());
  if (current?.tableId === mine.tableId && keepBuddy()) return;
  const across = buddySeatFor(mine, SEATS, othersSeats());
  if (across) seatBuddy(across.id);
}

export function startDemo(): () => void {
  let stopped = false;
  /**
   * The title was skipped once (after that, "Back" on the camera and microphone check, or "Leave
   * the library", may show it again).
   */
  let entered = false;
  /** The table you were brought to, to sit at once you're in. */
  let target: string | null = null;
  /** Seating was tried once (after that, you choose your own seats). */
  let seatTried = false;
  usePomodoro.getState().setQuickTimings(DEMO_TIMINGS);

  const skipTitle = async () => {
    entered = true;
    const profile = useProfileStore.getState();
    if (profile.savedAt === null) profile.save(DEMO_NAME, DEMO_AVATAR);
    const game = useGameStore.getState();
    // The controls guide would cover the library on a first visit: the ribbon has the basics.
    if (!game.guideSeen) game.setGuideOpen(false);
    if (!useTables.getState().view) await Promise.race([refreshTables(), sleep(TABLES_WAIT_MS)]);
    if (stopped) return;
    // Only before the room has seen you (it holds moves to walking speed after that).
    if (!isOnline()) {
      const pick = pickDemoSeat(SEATS, {
        taken: othersSeats(),
        statuses: useTables.getState().view?.tables,
        preferred: LESSON_TABLES,
      });
      if (pick && arriveAt(pick.seatId)) target = pick.tableId;
    }
    // The camera and microphone check, then in (its "Go in"): autoSeat runs once you're in.
    const now = useGameStore.getState();
    if (now.phase === "title") now.setPhase("setup");
  };

  const autoSeat = async () => {
    if (seatTried) return;
    seatTried = true;
    if (!target) return;
    // The nearest free seat first; if the room or the table says no, the next one in reach.
    const tried = new Set<string>();
    for (let i = 0; i < 3 && !stopped; i++) {
      const game = useGameStore.getState();
      if (game.seatId || game.phase !== "playing") return;
      const seat = seatsInReach(target).find((s) => !tried.has(s.id));
      if (!seat) break;
      tried.add(seat.id);
      // Settled when you're seated, or when a "no" shows (a toast, or the "reserved" card).
      const before = useTables.getState();
      requestSit(seat.id);
      await until(() => {
        const t = useTables.getState();
        return (
          !!useGameStore.getState().seatId ||
          t.toast !== before.toast ||
          t.blocked !== before.blocked
        );
      }, SIT_WAIT_MS);
      if (useGameStore.getState().seatId || useTables.getState().blocked) return;
    }
    const game = useGameStore.getState();
    if (!stopped && !game.seatId && game.phase === "playing")
      showToast("Walk up to any free seat and press E to sit down.");
  };

  const onGame = () => {
    if (stopped) return;
    const game = useGameStore.getState();
    if (game.ready && game.phase === "title" && !entered) void skipTitle();
    else if (game.phase === "playing" && !game.seatId && !seatTried) void autoSeat();
    // Theo sits down just after you, once the sit flow has asked whether you're the first here
    // (he's pretend, so he must never cost you the offer to hold the table).
    if (game.seatId)
      setTimeout(() => !stopped && seatBuddyAcross(useGameStore.getState().seatId), 0);
  };
  const off = useGameStore.subscribe((s, prev) => {
    if (s.ready !== prev.ready || s.phase !== prev.phase || s.seatId !== prev.seatId) onGame();
  });
  onGame();

  // Theo comes back if the room dropped and the list of players was cleared, and moves along
  // if a real student took his seat.
  const keep = setInterval(() => {
    if (keepBuddy()) return;
    removeBuddy();
    seatBuddyAcross(useGameStore.getState().seatId);
  }, 1000);

  return () => {
    stopped = true;
    off();
    clearInterval(keep);
    removeBuddy();
    usePomodoro.getState().setQuickTimings(null);
  };
}
