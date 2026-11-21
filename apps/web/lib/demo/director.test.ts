import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEATS } from "@ovr/shared";
import { requestSit } from "@/lib/game/actions";
import { useGameStore } from "@/lib/game/store";
import { startDemo } from "./director";

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

// The sit flow and the tables server are their own tests (lib/game/sitFlow.test.ts): here only
// when the demo asks to sit matters. Theo stays out of it, and nothing goes over the network.
vi.mock("@/lib/game/actions", async (original) => ({
  ...(await original<typeof import("@/lib/game/actions")>()),
  requestSit: vi.fn(),
}));
vi.mock("@/lib/tables/client", async (original) => ({
  ...(await original<typeof import("@/lib/tables/client")>()),
  refreshTables: vi.fn(async () => {}),
  showToast: vi.fn(),
}));
vi.mock("@/lib/net/connection", async (original) => ({
  ...(await original<typeof import("@/lib/net/connection")>()),
  isOnline: () => false,
}));
vi.mock("./buddy", () => ({
  buddySeat: () => null,
  keepBuddy: () => true,
  removeBuddy: vi.fn(),
  seatBuddy: vi.fn(),
}));

const sit = vi.mocked(requestSit);
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  sit.mockClear();
  useGameStore.setState({ ready: true, phase: "title", seatId: null, guideSeen: true });
});
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe("the demo and the camera and microphone check", () => {
  it("skips the title to the check, never past it, and waits however long it takes", async () => {
    stop = startDemo();
    await vi.advanceTimersByTimeAsync(0);
    expect(useGameStore.getState().phase).toBe("setup");
    // A student taking their time over the camera: nothing moves on by itself.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(useGameStore.getState().phase).toBe("setup");
    expect(sit).not.toHaveBeenCalled();
  });

  it("sits you at the table you were brought to once you're in", async () => {
    stop = startDemo();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    useGameStore.getState().setPhase("entering");
    await vi.advanceTimersByTimeAsync(0);
    expect(sit).not.toHaveBeenCalled();
    useGameStore.getState().setPhase("playing");
    await vi.advanceTimersByTimeAsync(0);
    expect(sit).toHaveBeenCalledTimes(1);
    const seat = SEATS.find((s) => s.id === sit.mock.calls[0]![0]);
    expect(seat?.tableId).toBeTruthy();
  });

  it("lets Back on the check go to the title, and doesn't push you in again", async () => {
    stop = startDemo();
    await vi.advanceTimersByTimeAsync(0);
    expect(useGameStore.getState().phase).toBe("setup");
    useGameStore.getState().setPhase("title");
    await vi.advanceTimersByTimeAsync(5000);
    expect(useGameStore.getState().phase).toBe("title");
    // In again from the title: the check, then the seat, as the first time.
    useGameStore.getState().setPhase("setup");
    useGameStore.getState().setPhase("entering");
    useGameStore.getState().setPhase("playing");
    await vi.advanceTimersByTimeAsync(0);
    expect(sit).toHaveBeenCalledTimes(1);
  });
});
