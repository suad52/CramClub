import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEATS } from "@ovr/shared";
import { useTables } from "@/lib/tables/client";
import type { TableStatus } from "@/lib/tables/types";
import { sitDown } from "./actions";
import { usePomodoro } from "./pomodoro";
import { useGameStore } from "./store";
import { STAND_GRACE_MS, mustLeave, watchTableAccess } from "./tableAccess";

/** The stores persist through localStorage as soon as they're imported (see seatLock.test.ts). */
vi.hoisted(() => {
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, String(value)),
      removeItem: (key: string) => void items.delete(key),
    },
  });
});

const seat = SEATS.find((s) => s.tableId === "hall-t03")!;
const MIN = 60_000;

const status = (patch: Partial<TableStatus> = {}): TableStatus => ({
  tableId: "hall-t03",
  held: true,
  visibility: "public",
  holderName: "Ada",
  endsAt: new Date(Date.now() + 30 * MIN).toISOString(),
  canSit: true,
  mine: false,
  access: "public",
  circleName: null,
  ...patch,
});

function showTable(s: TableStatus) {
  useTables.setState({
    view: {
      tables: [s],
      mine: null,
      signedIn: true,
      privateAvailable: true,
      serverTime: new Date().toISOString(),
    },
  });
}

const tablesStart = useTables.getState();
let stop = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: { code: "offline" } }, { status: 503 })),
  );
  useTables.setState({ ...tablesStart }, true);
  usePomodoro.getState().abandon("left-library");
  useGameStore.setState({ phase: "playing", seatId: null });
  showTable(status());
  sitDown(seat.id);
  stop = watchTableAccess();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  usePomodoro.getState().abandon("left-library");
  useGameStore.setState({ seatId: null });
});

describe("keeping table holds live while you sit", () => {
  it("knows when a hold means you have to go", () => {
    const now = Date.now();
    expect(mustLeave(status(), now)).toBe(false);
    expect(mustLeave(status({ visibility: "private", canSit: false }), now)).toBe(true);
    // A hold that has run out doesn't count.
    expect(
      mustLeave(status({ canSit: false, endsAt: new Date(now - 1000).toISOString() }), now),
    ).toBe(false);
    expect(mustLeave(null, now)).toBe(false);
  });

  it("says so calmly, then stands you up a few seconds later", () => {
    showTable(status({ visibility: "private", canSit: false, access: null }));
    expect(useTables.getState().toast?.text).toMatch(/Ada has made Table 3 private/);
    expect(useGameStore.getState().seatId).toBe(seat.id);
    vi.advanceTimersByTime(STAND_GRACE_MS - 100);
    expect(useGameStore.getState().seatId).toBe(seat.id);
    vi.advanceTimersByTime(200);
    expect(useGameStore.getState().seatId).toBeNull();
  });

  it("lets a running pomodoro go only after the notice (it can't move tables)", () => {
    usePomodoro.getState().startFocus(Date.now());
    showTable(status({ visibility: "private", canSit: false, access: null }));
    expect(useTables.getState().toast?.text).toMatch(/pomodoro stops here/);
    expect(usePomodoro.getState().phase).toBe("focus");
    vi.advanceTimersByTime(STAND_GRACE_MS + 100);
    expect(usePomodoro.getState().phase).toBe("idle");
    expect(usePomodoro.getState().notice).toMatchObject({ kind: "voided", reason: "left-table" });
    expect(useGameStore.getState().seatId).toBeNull();
  });

  it("stays put if you're let in during the notice (an invite came through)", () => {
    showTable(status({ visibility: "private", canSit: false, access: null }));
    showTable(status({ visibility: "private", canSit: true, access: "guest" }));
    vi.advanceTimersByTime(STAND_GRACE_MS * 2);
    expect(useGameStore.getState().seatId).toBe(seat.id);
  });

  it("leaves you alone at a table you may use", () => {
    showTable(status({ visibility: "private", canSit: true, mine: true, access: "holder" }));
    vi.advanceTimersByTime(STAND_GRACE_MS * 2);
    expect(useGameStore.getState().seatId).toBe(seat.id);
    expect(useTables.getState().toast).toBeNull();
  });
});
