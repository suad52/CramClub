import { ANCHORS, PLAYER, SEATS, findStandPoint, wrapAngle } from "@ovr/shared";
import {
  isLessonOverlayOpen,
  shouldOfferJoin,
  useBoardLessons,
} from "@/lib/learning-studio/boardLessons";
import { cancelSeat, isOnline, requestSeat, setSeatLostHandler } from "@/lib/net/connection";
import { isSeatTakenByOther, takenSeats } from "@/lib/net/players";
import {
  askToLeave,
  askToSit,
  heldTableId,
  isReservable,
  offerClaim,
  showReserved,
  showToast,
} from "@/lib/tables/client";
import { useWhiteboardStore } from "@/lib/whiteboard/store";
import { exitPointerLock, isPointerLocked, requestPointerLock } from "./pointer";
import { isFocusing, usePomodoro } from "./pomodoro";
import { runtime } from "./runtime";
import { useGameStore } from "./store";

const seatsById = new Map(SEATS.map((s) => [s.id, s]));

/**
 * Shared whiteboards, one per table; the board id is the table id. Every reading table has one,
 * opened from its seats (B). Boards hung on a wall also show their drawing in the room and can be
 * used by walking up to them: their point is where you stand, just in front of the board.
 */
export const WHITEBOARDS = ANCHORS.filter((a) => a.kind === "whiteboard" && a.table).map((a) => {
  const mobile = a.mount === "mobile";
  // A rolling board is used from either side, so its point is the board itself; a wall board's is
  // just in front of it.
  const reach = a.virtual || mobile ? 0 : 0.5;
  return {
    boardId: a.table!,
    x: a.x + Math.sin(a.rot) * reach,
    y: a.virtual || mobile ? 0 : a.y - 0.85,
    z: a.z + Math.cos(a.rot) * reach,
    /** The board in the room, where its live drawing is shown; null when it only opens from seats. */
    wall: a.virtual ? null : { x: a.x, z: a.z, rotationY: a.rot, mobile },
  };
});

/** Lift call points on each floor; using one rides to the other floor. */
export const LIFTS = ANCHORS.filter((a) => a.kind === "lift").map((a) => ({
  id: a.id,
  x: a.x,
  y: a.y,
  z: a.z,
  /** Faces the lift doors. */
  rotationY: a.rot,
  label: a.label,
}));

export function getLift(id: string | null) {
  return id ? LIFTS.find((l) => l.id === id) : undefined;
}

/** Rides the lift: step out on the other floor, facing away from the doors. */
export function rideLift(id: string) {
  const from = getLift(id);
  const to = LIFTS.find((l) => l.id !== id && from && l.y !== from.y);
  if (!to) return;
  runtime.x = to.x - Math.sin(to.rotationY) * 0.4;
  runtime.y = to.y;
  runtime.z = to.z - Math.cos(to.rotationY) * 0.4;
  runtime.vx = 0;
  runtime.vz = 0;
  runtime.facing = wrapAngle(to.rotationY + Math.PI);
  runtime.autoYaw = wrapAngle(to.rotationY);
  useGameStore.getState().setNearbyLift(null);
}

export function isBoardOpen() {
  return useWhiteboardStore.getState().openId !== null;
}

export function openBoard(boardId: string) {
  exitPointerLock();
  runtime.vx = 0;
  runtime.vz = 0;
  useWhiteboardStore.getState().open(boardId);
}

/** B key / button: open the whiteboard of the collaborative table you're sitting at. */
export function openTableBoard() {
  const seat = getSeat(useGameStore.getState().seatId);
  if (seat?.tableId && WHITEBOARDS.some((b) => b.boardId === seat.tableId)) openBoard(seat.tableId);
}

/** Lessons play on the back of the rolling boards, which flip over to show them. */
export const hasLessonFace = (boardId: string | null | undefined): boardId is string =>
  !!boardId && WHITEBOARDS.some((b) => b.boardId === boardId && b.wall?.mobile);

/**
 * The board a lesson goes on: the one you're standing at, or your table's while you're seated.
 * (The HUD works this out the same way from store subscriptions.)
 */
export function lessonBoardId(): string | null {
  const { nearbyBoardId, seatId } = useGameStore.getState();
  const id = nearbyBoardId ?? getSeat(seatId)?.tableId;
  return hasLessonFace(id) ? id : null;
}

/** L key / "Lessons" button: choose a lesson to play on that board. */
export function openLessonPicker() {
  const boardId = lessonBoardId();
  if (!boardId) return;
  runtime.vx = 0;
  runtime.vz = 0;
  useBoardLessons.getState().openPicker(boardId);
}

/** J key / "Join lesson" button: join the lesson on the nearest board that has one. */
export function joinNearbyLesson() {
  const s = useBoardLessons.getState();
  const id = s.inRangeBoardId;
  if (id && s.boards[id] && s.joinedBoardId !== id) s.join(id);
}

/** N key: "Not now" to the lesson you're being offered. */
export function declineNearbyLesson() {
  const s = useBoardLessons.getState();
  if (s.inRangeBoardId && shouldOfferJoin(s, s.inRangeBoardId)) s.decline(s.inRangeBoardId);
}

/** F key / the corner preview: open the joined lesson full screen. */
export function openLessonFullscreen() {
  useBoardLessons.getState().setFullscreen(true);
}

/**
 * Back from full screen to the library (and out of the browser's own full screen too, unless it's
 * the whole page's, which a running pomodoro holds). The mouse is captured again for looking
 * around; that only works from a click or key press, so it's quiet.
 */
export function closeLessonFullscreen() {
  useBoardLessons.getState().setFullscreen(false);
  const full = document.fullscreenElement;
  if (full && full !== document.documentElement) void document.exitFullscreen().catch(() => {});
  requestPointerLock({ quiet: true });
}

export function toggleLessonFullscreen() {
  if (useBoardLessons.getState().fullscreen) closeLessonFullscreen();
  else openLessonFullscreen();
}

export function getSeat(id: string | null) {
  return id ? seatsById.get(id) : undefined;
}

/** Where the camera looks after sitting: down at the desk, so the table timer is in view. */
const SEATED_PITCH = -0.4;

export function sitDown(seatId: string) {
  const seat = seatsById.get(seatId);
  if (!seat) return;
  runtime.vx = 0;
  runtime.vz = 0;
  runtime.sinceSeated = 0;
  runtime.y = seat.y;
  // Swing the camera round behind the seated avatar.
  runtime.autoYaw = wrapAngle(seat.rotationY + Math.PI);
  // ...and tilt it down to the desk, where the table timer sits.
  runtime.autoPitch = SEATED_PITCH;
  useGameStore.getState().setSeat(seat.id);
  useGameStore.getState().setNearbySeat(null);
}

/** The seat we're asking about (one question at a time). */
let askingFor: string | null = null;

export const SEAT_TAKEN_TEXT = "Someone's sitting there.";

/** Whether anyone else is sitting at this table (then you're not the first here). */
function othersAtTable(tableId: string) {
  for (const seatId of takenSeats().keys())
    if (seatsById.get(seatId)?.tableId === tableId) return true;
  return false;
}

/**
 * Sitting down. Seats go through the library room (lib/net), so two people never share one: a
 * seat someone's in says so at once, and otherwise the room is asked and has the last word. At a
 * table someone may hold, the tables server is asked first (lib/tables/client.ts): a private
 * table can say no (then the "reserved" card says whose it is and until when); at a free table
 * nobody else is at, you're the first here, so you sit and are offered to hold it. Alone (no
 * game server), seats away from tables just sit.
 */
export function requestSit(seatId: string) {
  const seat = seatsById.get(seatId);
  if (!seat) return;
  if (isSeatTakenByOther(seatId)) return showToast(SEAT_TAKEN_TEXT);
  const reservable = isReservable(seat.tableId);
  if (!reservable && !isOnline()) return sitDown(seatId);
  if (askingFor) return;
  askingFor = seatId;
  runtime.vx = 0;
  runtime.vz = 0;
  const tableId = seat.tableId;
  // Sat somewhere, walked off or left while we asked: the question's moot.
  const moot = () => {
    const game = useGameStore.getState();
    const away =
      Math.hypot(runtime.x - seat.x, runtime.z - seat.z) > 2 || Math.abs(runtime.y - seat.y) > 0.5;
    return !!game.seatId || game.phase !== "playing" || away;
  };
  const table = reservable ? askToSit(seat.tableId!) : Promise.resolve(null);
  void table
    .then(async (answer) => {
      if (answer && !answer.ok) {
        if (!moot()) showReserved(answer);
        return;
      }
      if (moot()) return;
      const room = await requestSeat(seatId);
      if (moot()) return cancelSeat(seatId);
      if (!room.ok) {
        showToast(room.reason === "taken" ? SEAT_TAKEN_TEXT : "That seat isn't free just now.");
        return;
      }
      sitDown(seatId);
      if (answer?.firstHere && tableId && !othersAtTable(tableId)) offerClaim(tableId);
    })
    .finally(() => {
      askingFor = null;
    });
}

/**
 * Gets you up even mid-pomodoro (which then doesn't count): for when the seat isn't yours to
 * keep (the table went private, or someone else turned out to have it).
 */
export function leaveSeatNow() {
  if (isSeatLocked()) usePomodoro.getState().abandon("left-table");
  standUp({ force: true });
}

// Back online and the seat you sat in meanwhile is someone else's: get up.
setSeatLostHandler(() => {
  showToast(`${SEAT_TAKEN_TEXT} Find another seat nearby.`);
  leaveSeatNow();
});

/** Third person was swapped for the desk view when a pomodoro started; standing up swaps it back. */
let restoreThirdPerson = false;

/**
 * A pomodoro starting: settle into first person, looking down at your desk. From behind, your
 * own shoulders hide the table timer in third person (V still switches back).
 */
export function focusOnDesk() {
  const game = useGameStore.getState();
  const seat = seatsById.get(game.seatId ?? "");
  if (!seat) return;
  if (game.cameraMode === "third-person") {
    restoreThirdPerson = true;
    game.setCameraMode("first-person");
  }
  runtime.autoYaw = wrapAngle(seat.rotationY + Math.PI);
  runtime.autoPitch = SEATED_PITCH;
}

/**
 * A pomodoro can't be split, so while one runs you stay at the table: nothing stands you up
 * except the timer's "Leave table", which abandons the pomodoro first.
 */
export function isSeatLocked() {
  return !!useGameStore.getState().seatId && isFocusing(usePomodoro.getState());
}

const seatLockListeners = new Set<() => void>();

/** The table timer listens here to explain why you didn't stand up. */
export function onSeatLockNudge(listener: () => void) {
  seatLockListeners.add(listener);
  return () => {
    seatLockListeners.delete(listener);
  };
}

/** Something tried to stand you up mid-pomodoro. */
export function nudgeSeatLocked() {
  for (const listener of seatLockListeners) listener();
}

/**
 * The table timer's settings or "Leave the table?" dialog, which need a free mouse (and the
 * table hold's "who can join" choices, which work the same way).
 */
const timerPanels = new Set<string>();

export function setTimerPanelOpen(panel: "settings" | "leave" | "table", open: boolean) {
  if (open) timerPanels.add(panel);
  else timerPanels.delete(panel);
}

export const isTimerPanelOpen = () => timerPanels.size > 0;

/**
 * Gets you up from your seat. Leaving the table you're holding gives it up, so unless `force` is
 * set this asks first and returns false (`then` runs after they've confirmed and left).
 */
export function standUp(opts: { force?: boolean; then?: () => void } = {}): boolean {
  if (isSeatLocked()) {
    nudgeSeatLocked();
    return false;
  }
  const { seatId, setSeat } = useGameStore.getState();
  const seat = seatsById.get(seatId ?? "");
  if (!seat) return false;
  const held = heldTableId();
  if (!opts.force && held && seat.tableId === held) {
    askToLeave(held, opts.then ?? null);
    return false;
  }
  const stand = findStandPoint(seat, PLAYER.radius);
  if (stand) {
    runtime.x = stand.x;
    runtime.y = stand.y;
    runtime.z = stand.z;
  }
  setSeat(null);
  if (restoreThirdPerson) {
    restoreThirdPerson = false;
    useGameStore.getState().setCameraMode("third-person");
  }
  return true;
}

/**
 * "Ask the Librarian" (the HUD button, or E at her desk): her panel over the library, holding the
 * game still like My Progress. The flag goes up before the mouse is let go, so that isn't taken
 * as "pause".
 */
export function openLibrarian() {
  runtime.vx = 0;
  runtime.vz = 0;
  useGameStore.getState().setLibrarianOpen(true);
  exitPointerLock();
}

/**
 * The E key / prompt button: stand up if seated (not mid-pomodoro), otherwise use the whiteboard,
 * lift, librarian's desk or seat nearby.
 */
export function interact() {
  const { seatId, nearbySeatId, nearbyBoardId, nearbyLiftId, nearbyLibrarian } =
    useGameStore.getState();
  if (seatId) standUp();
  else if (nearbyBoardId) openBoard(nearbyBoardId);
  else if (nearbyLiftId) rideLift(nearbyLiftId);
  else if (nearbyLibrarian) openLibrarian();
  else if (nearbySeatId) requestSit(nearbySeatId);
}

/** Whether the mouse was captured when Shift went down (so we re-capture on release). */
let recaptureAfterShift = false;

/**
 * Holding Shift frees the mouse so you can click buttons; letting go captures it again for
 * mouse-look. Without pointer lock (drag-to-look browsers) the cursor is already free.
 */
export function holdFreeCursor(held: boolean) {
  const store = useGameStore.getState();
  if (held) {
    if (store.cursorFree) return;
    recaptureAfterShift = isPointerLocked();
    // Set before releasing the pointer so the unlock isn't mistaken for "pause" (Esc).
    store.setCursorFree(true);
    if (recaptureAfterShift) exitPointerLock();
    return;
  }
  if (!store.cursorFree) return;
  store.setCursorFree(false);
  const s = useGameStore.getState();
  // A panel opened while Shift was held keeps the mouse free; letting go only clears the flag.
  const covered =
    s.menuOpen ||
    s.guideOpen ||
    s.progressOpen ||
    s.librarianOpen ||
    isBoardOpen() ||
    isLessonOverlayOpen() ||
    isTimerPanelOpen();
  if (recaptureAfterShift && !covered) requestPointerLock({ quiet: true });
  recaptureAfterShift = false;
}
