import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Callbacks, Client, type Room } from "@colyseus/sdk";
import {
  LIBRARY_ROOM_NAME,
  SEATS,
  findStandPoint,
  learnerKey,
  newTicketId,
  signTicket,
} from "@ovr/shared";

/**
 * The browser's side of multiplayer (connection.ts, players.ts, the sit flow in actions.ts)
 * against a real game server, with a second, bare SDK client as "someone else". Opt-in, since it
 * needs the server running and its ticket secret:
 *
 *   pnpm --filter @ovr/game-server dev   # or any port, via GAME_SERVER_PORT
 *   NET_LIVE=1 GAME_SERVER_URL=ws://localhost:2567 GAME_TICKET_SECRET=… \
 *     pnpm --filter @ovr/web exec vitest run lib/net/connection.live.test.ts
 */
const LIVE =
  process.env.NET_LIVE === "1" && !!process.env.GAME_SERVER_URL && !!process.env.GAME_TICKET_SECRET;

vi.hoisted(() => {
  // The stores persist through localStorage, and the connection listens to the page.
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, String(value)),
      removeItem: (key: string) => void items.delete(key),
    },
  });
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" });
  Object.defineProperty(globalThis, "document", { configurable: true, value: doc });
  Object.defineProperty(globalThis, "window", { configurable: true, value: new EventTarget() });
  process.env.NEXT_PUBLIC_GAME_SERVER_URL = process.env.GAME_SERVER_URL ?? "";
});

const secret = process.env.GAME_TICKET_SECRET ?? "";
const url = process.env.GAME_SERVER_URL ?? "";

async function ticketFor(name: string, signedIn: boolean, learner: string) {
  const key = await learnerKey(secret, learner);
  const exp = Math.floor(Date.now() / 1000) + 300;
  const jti = newTicketId();
  return {
    ticket: await signTicket(secret, { key, name, signedIn, exp, jti }),
    name,
    signedIn,
    exp,
  };
}

/** Steps the browser's frame loop for `ms` (sending moves when due). */
async function frames(ms: number, tick: (now: number) => void) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    tick(performance.now());
    await new Promise((r) => setTimeout(r, 16));
  }
}

describe.runIf(LIVE)("multiplayer against a real game server", () => {
  // Imported once the page globals above are in place (and only when the test runs).
  let net: typeof import("./connection");
  let players: typeof import("./players");
  let runtime: (typeof import("@/lib/game/runtime"))["runtime"];
  let useGameStore: (typeof import("@/lib/game/store"))["useGameStore"];
  let actions: typeof import("@/lib/game/actions");
  let useTables: (typeof import("@/lib/tables/client"))["useTables"];
  let tracker: typeof import("@/lib/facial-tracking/tracker");

  const seat = SEATS.find((s) => s.tableId && s.tableId.startsWith("hall"))!;
  const nextSeat = SEATS.find((s) => s.tableId === seat.tableId && s.id !== seat.id)!;
  const stand = findStandPoint(seat)!;

  let other: Room;
  const otherSees = new Map<string, Record<string, unknown>>();
  const otherFaces: { from: string; params: unknown }[] = [];
  let stop = () => {};

  beforeAll(async () => {
    net = await import("./connection");
    players = await import("./players");
    runtime = (await import("@/lib/game/runtime")).runtime;
    useGameStore = (await import("@/lib/game/store")).useGameStore;
    actions = await import("@/lib/game/actions");
    useTables = (await import("@/lib/tables/client")).useTables;
    tracker = await import("@/lib/facial-tracking/tracker");
    // The web app's ticket route, signed as it would be; everything else (the SDK's matchmaking
    // requests) goes to the real server.
    const realFetch = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input) === "/api/net/ticket"
          ? Response.json(await ticketFor("Ada", true, "live-test-ada"))
          : realFetch(input, init),
      ),
    );
    runtime.x = stand.x;
    runtime.y = stand.y;
    runtime.z = stand.z;
    runtime.movement = "idle";
    useGameStore.setState({ phase: "playing", seatId: null });
    stop = net.startMultiplayer();
    await vi.waitFor(() => expect(net.useNet.getState().status).toBe("online"), {
      timeout: 5000,
    });

    const t = await ticketFor("Guest 4821", false, "live-test-guest");
    other = await new Client(url).joinOrCreate(LIBRARY_ROOM_NAME, { ticket: t.ticket });
    for (const type of ["seat", "seat_denied"]) other.onMessage(type, () => {});
    other.onMessage("face", (m: { from: string; params: unknown }) => otherFaces.push(m));
    const cb = Callbacks.get(other as never) as unknown as {
      onAdd: (p: string, f: (v: Record<string, unknown>, k: string) => void) => void;
    };
    cb.onAdd("players", (p, id) => otherSees.set(id, p));
  });

  afterAll(async () => {
    stop();
    await other?.leave();
    vi.unstubAllGlobals();
  });

  it("joins, counts heads and sees the other player with their name", async () => {
    await vi.waitFor(() => expect(net.useNet.getState().count).toBe(2));
    const remote = players.useRemotePlayers.getState().players[other.sessionId];
    expect(remote).toMatchObject({ name: "Guest 4821", signedIn: false, status: "available" });
    const me = otherSees.get(net.useNet.getState().selfId!);
    expect(me).toMatchObject({ name: "Ada", signedIn: true });
    await vi.waitFor(() => expect(String(me?.avatar ?? "")).toContain("{"));
  });

  it("sends your moves when they change, and receives theirs into the buffer", async () => {
    const me = () => otherSees.get(net.useNet.getState().selfId!)!;
    await frames(600, (now) => {
      runtime.x = stand.x + 0.4 * Math.sin(now / 300);
      runtime.movement = "walk";
      runtime.speed = 2;
      net.tickNet(now);
    });
    runtime.x = stand.x;
    runtime.movement = "idle";
    await frames(200, net.tickNet);
    await vi.waitFor(() => expect(Number(me().x)).toBeCloseTo(stand.x, 2));
    expect(me().movement).toBe("idle");

    other.send("move", {
      x: stand.x,
      y: stand.y,
      z: stand.z + 0.8,
      ry: 0,
      movement: "idle",
      speed: 0,
    });
    await vi.waitFor(() =>
      expect(players.remoteLive.get(other.sessionId)?.buffer.latest()?.z).toBeCloseTo(
        stand.z + 0.8,
        2,
      ),
    );
  });

  it("won't let you sit where they sit, and gives you a free seat", async () => {
    other.send("sit", { seatId: seat.id });
    await vi.waitFor(() => expect(players.isSeatTakenByOther(seat.id)).toBe(true));
    actions.requestSit(seat.id);
    expect(useTables.getState().toast?.text).toBe(actions.SEAT_TAKEN_TEXT);
    expect(useGameStore.getState().seatId).toBeNull();

    // A free seat at the same table: the room says yes.
    runtime.x = nextSeat.x;
    runtime.z = nextSeat.z;
    runtime.y = nextSeat.y;
    net.tickNet(performance.now() + 1000);
    const answer = await net.requestSeat(nextSeat.id);
    expect(answer).toEqual({ ok: true, offline: false });
    actions.sitDown(nextSeat.id);
    const me = () => otherSees.get(net.useNet.getState().selfId!)!;
    await vi.waitFor(() => expect(me().seatId).toBe(nextSeat.id));

    // Standing up gives it back.
    actions.standUp();
    await vi.waitFor(() => expect(me().seatId).toBe(""));
  });

  it("relays your face while tracking is on, and stops when it's off", async () => {
    tracker.useTrackingStore.setState({ status: "tracking" });
    tracker.faceState.params = {
      headYaw: 0.1,
      headPitch: 0,
      headRoll: 0,
      eyeBlinkLeft: 0,
      eyeBlinkRight: 0,
      jawOpen: 0.2,
      smile: 0.6,
      browRaise: 0,
    };
    await frames(400, net.tickNet);
    const mine = net.useNet.getState().selfId;
    expect(otherFaces.some((f) => f.from === mine && f.params !== null)).toBe(true);
    // Held still for longer than the server's 3 s quiet limit: it stays on (kept alive).
    await frames(3600, net.tickNet);
    expect(otherSees.get(mine!)?.face).toBe(true);
    tracker.useTrackingStore.setState({ status: "off" });
    tracker.faceState.params = null;
    await frames(400, net.tickNet);
    await vi.waitFor(() => expect(otherSees.get(mine!)?.face).toBe(false));
  }, 10_000);

  it("leaves when stopped", async () => {
    const mine = net.useNet.getState().selfId!;
    stop();
    stop = () => {};
    expect(net.useNet.getState().status).toBe("offline");
    expect(players.useRemotePlayers.getState().players).toEqual({});
    await vi.waitFor(() => expect(other.state.players.has(mine)).toBe(false));
  });
});
