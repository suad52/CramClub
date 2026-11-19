import { FURNITURE, PLAYER, SEATS, findStandPoint, wrapAngle } from "@ovr/shared";
import { useWhiteboardStore } from "@/lib/whiteboard/store";
import { exitPointerLock, isPointerLocked, requestPointerLock } from "./pointer";
import { runtime } from "./runtime";
import { useGameStore } from "./store";

const seatsById = new Map(SEATS.map((s) => [s.id, s]));

/** Mobile whiteboards, one per collaborative table; the board id is the table id. */
export const WHITEBOARDS = FURNITURE.filter((f) => f.kind === "whiteboard" && f.tableId).map(
  (f) => ({
    boardId: f.tableId!,
    x: f.x,
    z: f.z,
  }),
);

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

export function getSeat(id: string | null) {
  return id ? seatsById.get(id) : undefined;
}

export function sitDown(seatId: string) {
  const seat = seatsById.get(seatId);
  if (!seat) return;
  runtime.vx = 0;
  runtime.vz = 0;
  runtime.sinceSeated = 0;
  // Swing the camera round behind the seated avatar.
  runtime.autoYaw = wrapAngle(seat.rotationY + Math.PI);
  useGameStore.getState().setSeat(seat.id);
  useGameStore.getState().setNearbySeat(null);
}

export function standUp() {
  const { seatId, setSeat } = useGameStore.getState();
  const seat = seatsById.get(seatId ?? "");
  if (!seat) return;
  const stand = findStandPoint(seat, PLAYER.radius);
  if (stand) {
    runtime.x = stand.x;
    runtime.z = stand.z;
  }
  setSeat(null);
}

/** The E key / prompt button: stand up if seated, otherwise use the whiteboard or seat nearby. */
export function interact() {
  const { seatId, nearbySeatId, nearbyBoardId } = useGameStore.getState();
  if (seatId) standUp();
  else if (nearbyBoardId) openBoard(nearbyBoardId);
  else if (nearbySeatId) sitDown(nearbySeatId);
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
  if (recaptureAfterShift && !s.menuOpen && !s.guideOpen) requestPointerLock({ quiet: true });
  recaptureAfterShift = false;
}
