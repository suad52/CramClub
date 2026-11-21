import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEATS } from "@ovr/shared";
import { clearRemotes, upsertRemote } from "@/lib/net/players";
import { useTables } from "@/lib/tables/client";
import type { SitResult, TableStatus } from "@/lib/tables/types";
import { SEAT_TAKEN_TEXT, requestSit } from "./actions";
import { runtime } from "./runtime";
import { useGameStore } from "./store";

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

const status = (patch: Partial<TableStatus> = {}): TableStatus => ({
  tableId: "hall-t03",
  held: false,
  visibility: null,
  holderName: null,
  endsAt: null,
  canSit: true,
  mine: false,
  access: "free",
  circleName: null,
  ...patch,
});

/** The server's answer to "can I sit here?", as the route sends it. */
function answer(body: SitResult | object, code = 200) {
  const fetch = vi.fn(async () => Response.json(body, { status: code }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

const tablesStart = useTables.getState();

beforeEach(() => {
  useTables.setState({ ...tablesStart }, true);
  useGameStore.setState({ phase: "playing", seatId: null, nearbySeatId: seat.id });
  runtime.x = seat.x;
  runtime.y = seat.y;
  runtime.z = seat.z;
});
afterEach(() => {
  vi.unstubAllGlobals();
  useGameStore.setState({ seatId: null });
  clearRemotes();
});

/** Someone else in the library, sitting in `seatId`. */
function someoneSitsIn(seatId: string) {
  const s = SEATS.find((x) => x.id === seatId)!;
  upsertRemote(
    "other",
    { name: "Ben", signedIn: true, x: s.x, y: s.y, z: s.z, ry: 0, movement: "sit", seatId },
    0,
  );
}

describe("sitting at a table someone may hold", () => {
  it("asks the server first, and stays standing when a private table says no", async () => {
    const until = new Date(Date.now() + 30 * 60_000).toISOString();
    const refused = status({
      held: true,
      visibility: "private",
      holderName: "Ada",
      endsAt: until,
      canSit: false,
      access: null,
    });
    const fetch = answer(
      {
        ok: false,
        status: refused,
        reason: "private",
        message: "This table is private.",
        error: { code: "table_private", message: "This table is private." },
      },
      403,
    );
    requestSit(seat.id);
    await vi.waitFor(() => expect(useTables.getState().blocked).not.toBeNull());
    expect(fetch).toHaveBeenCalledWith(
      "/api/tables/hall-t03/sit",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
    expect(useGameStore.getState().seatId).toBeNull();
    expect(useTables.getState().blocked).toMatchObject({ reason: "private", status: refused });
  });

  it("sits, and offers the table, when the server says you're the first here", async () => {
    answer({ ok: true, status: status(), firstHere: true });
    requestSit(seat.id);
    await vi.waitFor(() => expect(useGameStore.getState().seatId).toBe(seat.id));
    expect(useTables.getState().offer).toBe("hall-t03");
  });

  it("goes by the last known status when the server can't answer, still refusing a private table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: { code: "server_error" } }, { status: 500 })),
    );
    const refused = status({
      held: true,
      visibility: "private",
      holderName: "Ada",
      endsAt: new Date(Date.now() + 30 * 60_000).toISOString(),
      canSit: false,
      access: null,
    });
    useTables.setState({
      view: {
        tables: [refused],
        mine: null,
        signedIn: true,
        privateAvailable: true,
        serverTime: new Date().toISOString(),
      },
    });
    requestSit(seat.id);
    await vi.waitFor(() => expect(useTables.getState().blocked).not.toBeNull());
    expect(useGameStore.getState().seatId).toBeNull();
  });
});

describe("sitting with other people in the library", () => {
  it("won't sit where someone else is sitting (and doesn't ask anyone)", () => {
    const fetch = answer({ ok: true, status: status(), firstHere: true });
    someoneSitsIn(seat.id);
    requestSit(seat.id);
    expect(fetch).not.toHaveBeenCalled();
    expect(useGameStore.getState().seatId).toBeNull();
    expect(useTables.getState().toast?.text).toBe(SEAT_TAKEN_TEXT);
  });

  it("doesn't offer to hold a table someone else is already sitting at", async () => {
    answer({ ok: true, status: status(), firstHere: true });
    const neighbour = SEATS.find((s) => s.tableId === seat.tableId && s.id !== seat.id)!;
    someoneSitsIn(neighbour.id);
    requestSit(seat.id);
    await vi.waitFor(() => expect(useGameStore.getState().seatId).toBe(seat.id));
    expect(useTables.getState().offer).toBeNull();
  });
});
