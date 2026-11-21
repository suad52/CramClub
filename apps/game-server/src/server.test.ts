import { type IncomingHttpHeaders, createServer, request as httpRequest } from "node:http";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  CHAT,
  type ChatLine,
  DEFAULT_AVATAR,
  FENWICK_ID,
  FENWICK_NAME,
  type FenwickChatRequest,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  LIBRARY_ROOM_NAME,
  MAX_PLAYERS_PER_ROOM,
  NET,
  SEATS,
  type ServerMessages,
  learnerKey,
  newTicketId,
  sanitizeAvatarConfig,
  signTicket,
  verifyInternal,
} from "@ovr/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type GameServerConfig, setServerConfig } from "./config";
import { FENWICK_CHAT_PATH, type LibraryRoom } from "./rooms/LibraryRoom";
import { FENWICK_TYPING_DELAY_MS, MOVE_BURST_M } from "./rooms/rules";
import { createGameServer } from "./server";

const SECRET = "test-only-ticket-secret";
const WEB_ORIGIN = "http://localhost:3100";
const port = 25_000 + Math.floor(Math.random() * 5_000);
const base = `http://localhost:${port}`;
/** A stand-in for the web app's Ms. Fenwick route (see fakeWeb below). */
const webPort = 30_000 + Math.floor(Math.random() * 5_000);
const CONFIG: GameServerConfig = {
  ticketSecret: SECRET,
  allowedOrigins: new Set([WEB_ORIGIN]),
  webInternalUrl: `http://127.0.0.1:${webPort}`,
};
const server = createGameServer(CONFIG);
const open: Room[] = [];

/**
 * The web app's POST /api/internal/fenwick-chat, as far as the game server can tell: it checks
 * the signature as the real one does, then answers by the asker's name: "Nell" gets no reply
 * (`reply: null`), "Errol" a 503, anyone else "Hello <name>!" with extra spaces to clean. A line
 * starting "thanks" gets no reply either, and the SLOW names wait SLOW_MS before answering.
 */
const SLOW = new Set(["Sloane", "Dora", "Pia"]);
const SLOW_MS = 1500;
interface FenwickCall {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingHttpHeaders;
  request: FenwickChatRequest;
  verified: boolean;
}
const fenwickCalls: FenwickCall[] = [];
const callsFor = (name: string) => fenwickCalls.filter((c) => c.request.askerName === name);
const fakeWeb = createServer((req, res) => {
  let body = "";
  req.setEncoding("utf8");
  req.on("data", (chunk: string) => (body += chunk));
  req.on("end", async () => {
    const header = (name: string) => req.headers[name] as string | undefined;
    const check = await verifyInternal(
      SECRET,
      header(INTERNAL_SIGNATURE_HEADER),
      header(INTERNAL_TIMESTAMP_HEADER),
      body,
    );
    const request = JSON.parse(body) as FenwickChatRequest;
    fenwickCalls.push({
      method: req.method,
      url: req.url,
      headers: req.headers,
      request,
      verified: check.ok,
    });
    if (!check.ok) return res.writeHead(401).end();
    if (request.askerName === "Errol") return res.writeHead(503).end();
    if (SLOW.has(request.askerName)) await sleep(SLOW_MS);
    const last = request.lines.at(-1)?.text ?? "";
    const none = request.askerName === "Nell" || /^thanks/i.test(last);
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ reply: none ? null : `  Hello   ${request.askerName}!  ` }));
  });
});

beforeAll(async () => {
  await server.listen(port);
  await new Promise<void>((resolve) => fakeWeb.listen(webPort, "127.0.0.1", resolve));
});

afterAll(async () => {
  await Promise.allSettled(open.map((r) => r.leave()));
  await server.gracefullyShutdown(false);
  await new Promise((resolve) => fakeWeb.close(resolve));
});

let learners = 0;
async function ticket(
  name: string,
  { learner = `learner-${++learners}`, secret = SECRET, expIn = 120 } = {},
) {
  const key = await learnerKey(SECRET, learner);
  const exp = Math.floor(Date.now() / 1000) + expIn;
  return signTicket(secret, { key, name, signedIn: true, exp, jti: newTicketId() });
}

/** Joins the library (a given room, or by matchmaking) as a fresh learner named `name`. */
async function join(name: string, roomId?: string, opts?: Parameters<typeof ticket>[1]) {
  const client = new Client(`ws://localhost:${port}`);
  const options = { ticket: await ticket(name, opts) };
  const room = roomId
    ? await client.joinById(roomId, options)
    : await client.joinOrCreate(LIBRARY_ROOM_NAME, options);
  room.reconnection.minUptime = 0;
  open.push(room);
  return room;
}

/** Records every message of `type` the room receives. */
function inbox<K extends keyof ServerMessages>(room: Room, type: K): ServerMessages[K][] {
  const got: ServerMessages[K][] = [];
  room.onMessage(type, (m: ServerMessages[K]) => got.push(m));
  return got;
}

async function until(check: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 15));
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PlayerView = { name: string; x: number; y: number; z: number; seatId: string } & Record<
  string,
  unknown
>;
const playerIn = (room: Room, sessionId: string) =>
  (room.state as { players?: Map<string, PlayerView> } | undefined)?.players?.get(sessionId);

const SEAT = SEATS[0]!;
const nearSeat = { x: SEAT.x + 0.8, y: SEAT.y, z: SEAT.z, ry: 0, movement: "idle", speed: 0 };

describe("game server", () => {
  it("answers the health check", async () => {
    const res = await fetch(`${base}/health`);
    expect(await res.json()).toMatchObject({ ok: true, maxPlayersPerRoom: MAX_PLAYERS_PER_ROOM });
  });

  it("refuses to join without a valid ticket", async () => {
    const client = new Client(`ws://localhost:${port}`);
    const good = await ticket("Ada");
    const [payload, sig] = good.split(".") as [string, string];
    const other = (await ticket("Mallory")).split(".")[0];
    for (const bad of [
      undefined,
      "nonsense",
      `${other}.${sig}`, // a different name under Ada's signature
      `${payload}.${sig.slice(0, -2)}xx`,
      await ticket("Ada", { secret: "another-secret" }),
      await ticket("Ada", { expIn: -5 }),
    ])
      await expect(client.joinOrCreate(LIBRARY_ROOM_NAME, { ticket: bad })).rejects.toThrow(
        /ticket_/,
      );
  });

  it("accepts each ticket once", async () => {
    const once = await ticket("Ada");
    const ada = await new Client(`ws://localhost:${port}`).joinOrCreate(LIBRARY_ROOM_NAME, {
      ticket: once,
    });
    open.push(ada);
    await ada.leave();
    const client = new Client(`ws://localhost:${port}`);
    await expect(client.joinOrCreate(LIBRARY_ROOM_NAME, { ticket: once })).rejects.toThrow(
      /ticket_replayed/,
    );
    // Two joins racing with one ticket: exactly one gets in.
    const twice = await ticket("Bo");
    const results = await Promise.allSettled([
      client.joinOrCreate(LIBRARY_ROOM_NAME, { ticket: twice }),
      client.joinOrCreate(LIBRARY_ROOM_NAME, { ticket: twice }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    for (const r of results) if (r.status === "fulfilled") await r.value.leave();
  });

  it("refuses everyone while the ticket secret is missing", async () => {
    setServerConfig({ ...CONFIG, ticketSecret: undefined });
    try {
      const client = new Client(`ws://localhost:${port}`);
      await expect(
        client.joinOrCreate(LIBRARY_ROOM_NAME, { ticket: await ticket("Ada") }),
      ).rejects.toThrow(/ticket_missing_secret/);
    } finally {
      setServerConfig(CONFIG);
    }
  });

  it("refuses browsers on other origins", async () => {
    const res = await fetch(`${base}/matchmake/joinOrCreate/${LIBRARY_ROOM_NAME}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ ticket: await ticket("Ada") }),
    });
    expect(res.ok).toBe(false);
    expect(await res.text()).toMatch(/origin_not_allowed/);

    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${base}/`, {
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          origin: "https://evil.example",
        },
      });
      req.on("response", (r) => resolve(r.statusCode ?? 0));
      req.on("upgrade", () => resolve(101));
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("shows players to each other with their ticket names", async () => {
    const ada = await join("Ada");
    const bo = await join("Bo", ada.roomId);
    await until(() => !!playerIn(ada, bo.sessionId) && !!playerIn(bo, ada.sessionId));
    expect(playerIn(ada, bo.sessionId)).toMatchObject({ name: "Bo", signedIn: true, seatId: "" });
    expect(playerIn(bo, ada.sessionId)).toMatchObject({ name: "Ada", movement: "idle" });
    // Nothing but the NetPlayer fields: no ticket key, no ids.
    const fields = (playerIn(bo, ada.sessionId) as unknown as { toJSON(): object }).toJSON();
    expect(Object.keys(fields).sort()).toEqual(
      [
        "avatar",
        "face",
        "movement",
        "name",
        "ry",
        "seatId",
        "signedIn",
        "speed",
        "status",
        "typing",
        "x",
        "y",
        "z",
      ].sort(),
    );
    await Promise.all([ada.leave(), bo.leave()]);
  });

  it("gives each seat to one person: first come, freed by standing or leaving", async () => {
    const ada = await join("Ada");
    const bo = await join("Bo", ada.roomId);
    const adaSeat = inbox(ada, "seat");
    const boSeat = inbox(bo, "seat");
    const boDenied = inbox(bo, "seat_denied");
    ada.send("move", nearSeat);
    bo.send("move", { ...nearSeat, z: SEAT.z + 0.5 });
    await sleep(100);

    ada.send("sit", { seatId: SEAT.id });
    await until(() => adaSeat.length === 1);
    expect(adaSeat[0]).toEqual({ seatId: SEAT.id });
    await until(() => playerIn(bo, ada.sessionId)?.seatId === SEAT.id);
    const sitting = playerIn(bo, ada.sessionId)!;
    expect(sitting.movement).toBe("sit");
    expect(sitting.x).toBeCloseTo(SEAT.x, 4);
    expect(sitting.z).toBeCloseTo(SEAT.z, 4);

    bo.send("sit", { seatId: SEAT.id });
    await until(() => boDenied.length === 1);
    expect(boDenied[0]).toEqual({ seatId: SEAT.id, reason: "taken" });

    ada.send("stand", {});
    await until(() => playerIn(bo, ada.sessionId)?.seatId === "");
    bo.send("sit", { seatId: SEAT.id });
    await until(() => boSeat.length === 1);

    // Bo leaving frees it again.
    await bo.leave();
    await until(() => !playerIn(ada, bo.sessionId));
    ada.send("move", nearSeat);
    await sleep(50);
    ada.send("sit", { seatId: SEAT.id });
    await until(() => adaSeat.length === 2);
    await ada.leave();
  });

  it("denies unknown seats and seats out of reach", async () => {
    const ada = await join("Ada");
    const denied = inbox(ada, "seat_denied");
    ada.send("move", { x: 0, y: 0, z: 0, ry: 0, movement: "idle", speed: 0 });
    await sleep(50);
    ada.send("sit", { seatId: "no-such-seat" });
    const far = SEATS.find((s) => Math.hypot(s.x, s.z) > 5 && s.y === 0)!;
    ada.send("sit", { seatId: far.id });
    await until(() => denied.length === 2);
    expect(denied).toEqual([
      { seatId: "no-such-seat", reason: "unknown_seat" },
      { seatId: far.id, reason: "too_far" },
    ]);
    await ada.leave();
  });

  it("drops messages over the rate limit", async () => {
    const ada = await join("Ada");
    const bo = await join("Bo", ada.roomId);
    // status allows 3 in a row: the 4th and later in this burst are dropped.
    for (const status of ["focused", "collaborating", "away", "available", "available"])
      ada.send("status", { status });
    await sleep(300);
    expect(playerIn(bo, ada.sessionId)?.status).toBe("away");
    await Promise.all([ada.leave(), bo.leave()]);
  });

  it("pulls back moves faster than the speed limit", async () => {
    const ada = await join("Ada");
    const bo = await join("Bo", ada.roomId);
    ada.send("move", { x: 0, y: 0, z: 0, ry: 0, movement: "idle", speed: 0 }); // placement
    ada.send("move", { x: 12, y: 0, z: 0, ry: 7, movement: "run", speed: 99 });
    await until(() => (playerIn(bo, ada.sessionId)?.x ?? 0) > 0);
    const seen = playerIn(bo, ada.sessionId)!;
    expect(seen.x).toBeLessThanOrEqual(MOVE_BURST_M + 0.1);
    expect(seen.speed).toBe(NET.MAX_SPEED);
    expect(seen.ry as number).toBeCloseTo(7 - 2 * Math.PI, 5);
    // Junk is ignored.
    ada.send("move", { x: Number.NaN, y: 0, z: 0, ry: 0, movement: "idle", speed: 0 });
    ada.send("move", { x: 1, y: 0, z: 0, ry: 0, movement: "fly", speed: 0 });
    await sleep(150);
    expect(playerIn(bo, ada.sessionId)!.x).toBe(seen.x);
    await Promise.all([ada.leave(), bo.leave()]);
  });

  it("relays faces to everyone but the sender, clamped, and checks avatars", async () => {
    const ada = await join("Ada");
    const bo = await join("Bo", ada.roomId);
    const adaFaces = inbox(ada, "face");
    const boFaces = inbox(bo, "face");
    ada.send("face", {
      headYaw: 3,
      headPitch: -0.5,
      headRoll: -9,
      eyeBlinkLeft: 2,
      eyeBlinkRight: -1,
      jawOpen: 0.25,
      smile: 0.5,
      browRaise: 1,
      extra: "dropped",
    });
    await until(() => boFaces.length === 1);
    expect(boFaces[0]).toEqual({
      from: ada.sessionId,
      params: {
        headYaw: 1,
        headPitch: -0.5,
        headRoll: -1,
        eyeBlinkLeft: 1,
        eyeBlinkRight: 0,
        jawOpen: 0.25,
        smile: 0.5,
        browRaise: 1,
      },
    });
    await until(() => playerIn(bo, ada.sessionId)?.face === true);
    ada.send("face", null);
    await until(() => boFaces.length === 2);
    expect(boFaces[1]).toEqual({ from: ada.sessionId, params: null });
    expect(adaFaces).toEqual([]);

    const avatar = { ...DEFAULT_AVATAR, hair: "not-a-hairstyle", junk: "x".repeat(50) };
    ada.send("avatar", { avatar: JSON.stringify(avatar) });
    await until(() => playerIn(bo, ada.sessionId)?.avatar !== "");
    expect(playerIn(bo, ada.sessionId)!.avatar).toBe(JSON.stringify(sanitizeAvatarConfig(avatar)));
    // Over AVATAR_MAX_CHARS (but under the socket's 4 KB frame limit): ignored.
    ada.send("avatar", { avatar: JSON.stringify({ ...avatar, junk: "x".repeat(2500) }) });
    await sleep(150);
    expect(playerIn(bo, ada.sessionId)!.avatar).toBe(JSON.stringify(sanitizeAvatarConfig(avatar)));
    await Promise.all([ada.leave(), bo.leave()]);
  });

  it("keeps a dropped player (and their seat) while they reconnect", async () => {
    const ada = await join("Ada");
    const bo = await join("Bo", ada.roomId);
    const seated = inbox(ada, "seat");
    ada.send("move", nearSeat);
    await sleep(50);
    ada.send("sit", { seatId: SEAT.id });
    await until(() => seated.length === 1);

    let reconnected = false;
    ada.onReconnect(() => (reconnected = true));
    const room = matchMaker.getLocalRoomById(ada.roomId) as LibraryRoom;
    // Cut Ada's socket as a network drop would: the server holds her player and seat.
    (room.clients.getById(ada.sessionId)!.ref as unknown as { terminate(): void }).terminate();
    await sleep(100);
    expect(playerIn(bo, ada.sessionId)).toMatchObject({ name: "Ada", seatId: SEAT.id });
    await until(() => reconnected, NET.RECONNECT_S * 1000);
    expect(playerIn(bo, ada.sessionId)).toMatchObject({ name: "Ada", seatId: SEAT.id });
    await Promise.all([ada.leave(), bo.leave()]);
  });

  it("lets one learner open a few tabs, each its own player", async () => {
    const first = await join("Ada", undefined, { learner: "tabby" });
    const roomId = first.roomId;
    await join("Ada", roomId, { learner: "tabby" });
    await join("Ada", roomId, { learner: "tabby" });
    await expect(join("Ada", roomId, { learner: "tabby" })).rejects.toThrow(/too_many_sessions/);
    await until(() => (first.state as { players: Map<string, unknown> }).players.size === 3);
  });

  it("throws out a flooding client at once, without holding its place", async () => {
    const ada = await join("Ada");
    const bo = await join("Bo", ada.roomId);
    const mallory = await join("Mallory", ada.roomId);
    ada.send("move", nearSeat);
    await sleep(50);
    ada.send("sit", { seatId: SEAT.id });
    await until(() => playerIn(bo, ada.sessionId)?.seatId === SEAT.id);
    // Over the room's 60 messages a second: disconnected, and gone for everyone (seat freed).
    for (let i = 0; i < 80; i++) ada.send("status", { status: "available" });
    await until(() => !playerIn(bo, ada.sessionId), 3000);
    // An unknown message type is thrown out the same way.
    mallory.send("teleport", { x: 0, y: 0, z: 0 });
    await until(() => !playerIn(bo, mallory.sessionId), 3000);
    // So is a frame over the socket's 4 KB limit (which closes as a plain 1006 drop).
    const eve = await join("Eve", ada.roomId);
    await until(() => !!playerIn(bo, eve.sessionId));
    eve.send("avatar", { avatar: "x".repeat(6000) });
    await until(() => !playerIn(bo, eve.sessionId), 3000);
    const boSeat = inbox(bo, "seat");
    bo.send("move", nearSeat);
    await sleep(50);
    bo.send("sit", { seatId: SEAT.id });
    await until(() => boSeat.length === 1);
    await bo.leave();
  });

  it("lets nobody open rooms of their own", async () => {
    const res = await fetch(`${base}/matchmake/create/${LIBRARY_ROOM_NAME}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB_ORIGIN },
      body: JSON.stringify({ ticket: await ticket("Ada") }),
    });
    expect(res.ok).toBe(false);
  });

  it("never puts more than 15 people in one library room", async () => {
    // Seat reservations over HTTP, as the SDK makes before it connects.
    const reserve = async (path: string) => {
      const res = await fetch(`${base}/matchmake/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: WEB_ORIGIN },
        body: JSON.stringify({ ticket: await ticket("Reader") }),
      });
      return {
        ok: res.ok,
        roomId: res.ok ? ((await res.json()) as { roomId: string }).roomId : "",
      };
    };
    // A fresh, empty room (opened by the server: players can't "create").
    const first = { ok: true, roomId: (await matchMaker.createRoom(LIBRARY_ROOM_NAME, {})).roomId };
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++)
      expect(await reserve(`joinById/${first.roomId}`)).toEqual(first);
    // A 16th can't get in, and matchmaking sends them to another room instead.
    expect((await reserve(`joinById/${first.roomId}`)).ok).toBe(false);
    const next = await reserve(`joinOrCreate/${LIBRARY_ROOM_NAME}`);
    expect(next.ok).toBe(true);
    expect(next.roomId).not.toBe(first.roomId);
  });
});

/** A new, empty library room (opened by the server, as players can't "create"). */
const freshRoom = async () => (await matchMaker.createRoom(LIBRARY_ROOM_NAME, {})).roomId;

describe("the library chat", () => {
  it("shows every line to everyone, cleaned, named and rate-limited, and catches newcomers up", async () => {
    const roomId = await freshRoom();
    const ada = await join("Ada", roomId);
    const adaHistory = inbox(ada, "chat_history");
    const bo = await join("Bo", roomId);
    const adaChat = inbox(ada, "chat");
    const boChat = inbox(bo, "chat");
    await until(() => adaHistory.length === 1);
    expect(adaHistory[0]).toEqual({ lines: [] });

    const quiet = { fenwick: false };
    ada.send("chat", { text: "  hello \n   there  ", ...quiet });
    ada.send("chat", { text: "   ", ...quiet }); // nothing left once cleaned: dropped
    ada.send("chat", { text: "x".repeat(300), ...quiet });
    ada.send("chat", { text: "four", ...quiet });
    ada.send("chat", { text: "five, one over the burst", ...quiet }); // CHAT.BURST in a row: dropped
    await until(() => boChat.length === 3);
    await sleep(150);
    expect(boChat.map((l) => l.text)).toEqual(["hello there", "x".repeat(CHAT.MAX_CHARS), "four"]);
    expect(adaChat).toEqual(boChat); // the sender's confirmation
    for (const line of boChat) {
      expect(line).toMatchObject({ from: ada.sessionId, name: "Ada" });
      expect(line.id).toMatch(/^c\d+$/);
      expect(line.replyTo).toBeUndefined();
      expect(Math.abs(line.at - Date.now())).toBeLessThan(5000);
    }
    expect(new Set(boChat.map((l) => l.id)).size).toBe(3);

    // Typing shows for everyone, and sending a line ends it.
    bo.send("typing", { on: true });
    await until(() => playerIn(ada, bo.sessionId)?.typing === true);
    bo.send("chat", { text: "hi Ada", ...quiet });
    await until(() => playerIn(ada, bo.sessionId)?.typing === false);
    expect(adaChat.at(-1)).toMatchObject({ from: bo.sessionId, name: "Bo", text: "hi Ada" });
    bo.send("typing", { on: true });
    await until(() => playerIn(ada, bo.sessionId)?.typing === true);
    bo.send("typing", { on: false });
    await until(() => playerIn(ada, bo.sessionId)?.typing === false);

    // Someone joining later gets the room's lines so far.
    const cy = await join("Cy", roomId);
    const cyHistory = inbox(cy, "chat_history");
    await until(() => cyHistory.length === 1);
    expect(cyHistory[0]!.lines).toEqual(boChat);
    await Promise.all([ada.leave(), bo.leave(), cy.leave()]);
  });

  it("turns typing off when it goes stale or the connection drops", async () => {
    const roomId = await freshRoom();
    const ada = await join("Ada", roomId);
    const bo = await join("Bo", roomId);
    const cy = await join("Cy", roomId);
    bo.send("typing", { on: true });
    const since = Date.now();
    cy.send("typing", { on: true });
    await until(
      () =>
        playerIn(ada, bo.sessionId)?.typing === true &&
        playerIn(ada, cy.sessionId)?.typing === true,
    );
    // Bo's connection drops: he's held for a reconnect, but not as typing.
    const room = matchMaker.getLocalRoomById(roomId) as LibraryRoom;
    (room.clients.getById(bo.sessionId)!.ref as unknown as { terminate(): void }).terminate();
    await until(() => playerIn(ada, bo.sessionId)?.typing === false);
    expect(playerIn(ada, bo.sessionId)).toBeDefined();
    // Cy never refreshes it: off after CHAT.TYPING_IDLE_MS.
    expect(playerIn(ada, cy.sessionId)?.typing).toBe(true);
    await until(() => playerIn(ada, cy.sessionId)?.typing === false, CHAT.TYPING_IDLE_MS + 2000);
    expect(Date.now() - since).toBeGreaterThanOrEqual(CHAT.TYPING_IDLE_MS);
    await Promise.allSettled([ada.leave(), bo.leave(), cy.leave()]);
  }, 15_000);

  it("has Ms. Fenwick answer whoever nobody answers, and only them", async () => {
    const asks = (room: Room) => ({
      chat: inbox(room, "chat"),
      typing: inbox(room, "fenwick_typing"),
    });

    // Fiona, alone (her second tab doesn't count), asks twice: one reply covers both, after
    // GHOST_ALONE_MS, seen by everyone in the room.
    const fiona = async () => {
      const roomId = await freshRoom();
      const room = await join("Fiona", roomId, { learner: "fiona" });
      const tab = await join("Fiona", roomId, { learner: "fiona" });
      const mine = asks(room);
      const other = asks(tab);
      room.send("chat", { text: "how do I stay focused?" });
      await sleep(500);
      const askedAt = Date.now();
      room.send("chat", { text: "any tips?" });
      await until(
        () => mine.chat.length === 3 && other.chat.length === 3,
        CHAT.GHOST_ALONE_MS + 2000,
      );
      expect(Date.now() - askedAt).toBeGreaterThanOrEqual(CHAT.GHOST_ALONE_MS - 50);
      // Her words came back at once: no "typing" flash before them.
      await sleep(FENWICK_TYPING_DELAY_MS + 200);
      expect(mine.typing).toEqual([]);
      expect(other.typing).toEqual([]);
      const reply = mine.chat[2]!;
      expect(reply).toMatchObject({
        from: FENWICK_ID,
        name: FENWICK_NAME,
        text: "Hello Fiona!",
        replyTo: room.sessionId,
      });
      expect(reply.id).toMatch(/^c\d+$/);
      expect(other.chat).toEqual(mine.chat);

      const calls = callsFor("Fiona");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ method: "POST", url: FENWICK_CHAT_PATH, verified: true });
      expect(calls[0]!.headers["content-type"]).toBe("application/json");
      expect(calls[0]!.request).toEqual({
        askerName: "Fiona",
        alone: true,
        lines: [
          { name: "Fiona", text: "how do I stay focused?", fenwick: false, asker: true },
          { name: "Fiona", text: "any tips?", fenwick: false, asker: true },
        ],
      });
      // Her line is in the room's history too.
      const late = await join("Gwen", roomId);
      const history = inbox(late, "chat_history");
      await until(() => history.length === 1);
      expect(history[0]!.lines.at(-1)).toEqual(reply);
      await Promise.all([room.leave(), tab.leave(), late.leave()]);
    };

    // Nothing to say ("brb"), or the web app failing at once: no line, and no "typing" flash.
    const noReply = async (name: string) => {
      const room = await join(name, await freshRoom());
      const { chat, typing } = asks(room);
      room.send("chat", { text: "brb" });
      await until(() => callsFor(name).length === 1, CHAT.GHOST_ALONE_MS + 2000);
      await sleep(FENWICK_TYPING_DELAY_MS + 300);
      expect(typing).toEqual([]);
      expect(chat.map((l: ChatLine) => l.from)).toEqual([room.sessionId]);
      expect(callsFor(name)).toHaveLength(1);
      await room.leave();
    };

    // A reply that takes a while: "typing" on after FENWICK_TYPING_DELAY_MS, her line, then off.
    const slow = async () => {
      const room = await join("Sloane", await freshRoom());
      const { chat, typing } = asks(room);
      room.send("chat", { text: "what's a good break length?" });
      await until(() => callsFor("Sloane").length === 1, CHAT.GHOST_ALONE_MS + 2000);
      const startedAt = Date.now();
      await until(() => typing.length === 1, 2000);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(FENWICK_TYPING_DELAY_MS - 100);
      expect(typing[0]).toEqual({ on: true, to: room.sessionId });
      await until(() => typing.length === 2, SLOW_MS + 1000);
      expect(typing[1]).toEqual({ on: false, to: room.sessionId });
      expect(chat.at(-1)).toMatchObject({ from: FENWICK_ID, text: "Hello Sloane!" });
      await room.leave();
    };

    // Someone else answers while her reply is being written: it isn't posted.
    const answeredMeanwhile = async () => {
      const roomId = await freshRoom();
      const dora = await join("Dora", roomId);
      const { chat, typing } = asks(dora);
      dora.send("chat", { text: "where are the chemistry books?" });
      await until(() => callsFor("Dora").length === 1, CHAT.GHOST_ALONE_MS + 2000);
      const eli = await join("Eli", roomId);
      eli.send("chat", { text: "second floor, by the windows", fenwick: false });
      await until(() => typing.length === 2, SLOW_MS + 1500);
      expect(typing.map((t) => t.on)).toEqual([true, false]);
      await sleep(100);
      expect(chat.map((l: ChatLine) => l.from)).toEqual([dora.sessionId, eli.sessionId]);
      await Promise.all([dora.leave(), eli.leave()]);
    };

    // The switch flipped off: her wait on that line is cancelled, and a reply already being
    // written isn't posted.
    const switchedOff = async () => {
      const quill = await join("Quill", await freshRoom());
      const quillSaw = asks(quill);
      quill.send("chat", { text: "testing 123" });
      await sleep(500);
      quill.send("chat_pref", { fenwick: false });
      const pia = await join("Pia", await freshRoom());
      const piaSaw = asks(pia);
      pia.send("chat", { text: "how long is a pomodoro?" });
      await until(() => callsFor("Pia").length === 1, CHAT.GHOST_ALONE_MS + 2000);
      pia.send("chat_pref", { fenwick: false });
      await sleep(SLOW_MS + 500);
      expect(callsFor("Quill")).toEqual([]);
      expect(quillSaw.typing).toEqual([]);
      expect(piaSaw.chat.map((l: ChatLine) => l.from)).toEqual([pia.sessionId]);
      expect(piaSaw.typing.map((t) => t.on)).toEqual([true, false]);
      await Promise.all([quill.leave(), pia.leave()]);
    };

    // A reply that needed no answer ("thanks") doesn't use up her cooldown: the next question,
    // a moment later, gets its answer after just GHOST_ALONE_MS.
    const thanksThenQuestion = async () => {
      const tess = await join("Tess", await freshRoom());
      const { chat } = asks(tess);
      tess.send("chat", { text: "thanks so much" });
      await until(() => callsFor("Tess").length === 1, CHAT.GHOST_ALONE_MS + 2000);
      await sleep(1000);
      const askedAt = Date.now();
      tess.send("chat", { text: "and what about integrals?" });
      await until(() => chat.some((l) => l.from === FENWICK_ID), CHAT.GHOST_ALONE_MS + 3000);
      expect(Date.now() - askedAt).toBeLessThan(CHAT.GHOST_ALONE_MS + 700);
      expect(callsFor("Tess")).toHaveLength(2);
      await tess.leave();
    };

    // Cal answers Ava (no question back): Cal's line isn't waiting for an answer, so she doesn't
    // reply to Cal, even once Ava has gone and Cal is alone.
    const answerIsNoQuestion = async () => {
      const roomId = await freshRoom();
      const ava = await join("Ava", roomId);
      const cal = await join("Cal", roomId);
      const calSaw = asks(cal);
      ava.send("chat", { text: "what's the powerhouse of the cell?" });
      await sleep(300);
      cal.send("chat", { text: "mitochondria" });
      await sleep(200);
      await ava.leave();
      await sleep(CHAT.GHOST_ALONE_MS + 1000);
      expect(calSaw.typing).toEqual([]);
      expect(callsFor("Cal")).toEqual([]);
      expect(callsFor("Ava")).toEqual([]);
      await cal.leave();
    };

    // "fenwick: false": she stays out of it.
    const optedOut = async () => {
      const room = await join("Quinn", await freshRoom());
      const { typing } = asks(room);
      room.send("chat", { text: "just thinking out loud", fenwick: false });
      await sleep(CHAT.GHOST_ALONE_MS + 1000);
      expect(typing).toEqual([]);
      expect(callsFor("Quinn")).toEqual([]);
      await room.leave();
    };

    // Someone else answered: she stays out of it, even once Gus is alone.
    const answered = async () => {
      const roomId = await freshRoom();
      const gus = await join("Gus", roomId);
      const hal = await join("Hal", roomId);
      asks(hal);
      const { typing } = asks(gus);
      gus.send("chat", { text: "which floor is the quiet one?" });
      await sleep(200);
      hal.send("chat", { text: "upstairs!", fenwick: false });
      await sleep(100);
      await hal.leave();
      await sleep(CHAT.GHOST_ALONE_MS + 1000);
      expect(typing).toEqual([]);
      expect(callsFor("Gus")).toEqual([]);
      await gus.leave();
    };

    // With someone else there she gives them GHOST_MS; once they leave, Jo is alone and past
    // GHOST_ALONE_MS, so she answers straight away.
    const leftAlone = async () => {
      const roomId = await freshRoom();
      const jo = await join("Jo", roomId);
      const kim = await join("Kim", roomId);
      asks(kim);
      const { chat } = asks(jo);
      jo.send("chat", { text: "is anyone here?" });
      await sleep(CHAT.GHOST_ALONE_MS + 1000);
      expect(callsFor("Jo")).toEqual([]);
      await kim.leave();
      await until(() => chat.some((l) => l.from === FENWICK_ID), 2000);
      expect(chat.at(-1)).toMatchObject({ replyTo: jo.sessionId, text: "Hello Jo!" });
      expect(callsFor("Jo").map((c) => c.request.alone)).toEqual([true]);
      await jo.leave();
    };

    await Promise.all([
      fiona(),
      noReply("Nell"),
      noReply("Errol"),
      slow(),
      answeredMeanwhile(),
      switchedOff(),
      thanksThenQuestion(),
      answerIsNoQuestion(),
      optedOut(),
      answered(),
      leftAlone(),
    ]);
    expect(fenwickCalls.every((c) => c.verified)).toBe(true);
  }, 20_000);

  it("catches a reconnecting player up on what was said while they were away", async () => {
    const roomId = await freshRoom();
    const ada = await join("Ada", roomId);
    const bo = await join("Bo", roomId);
    const boChat = inbox(bo, "chat");
    const boHistory = inbox(bo, "chat_history");
    await until(() => boHistory.length === 1);
    let reconnected = false;
    bo.onReconnect(() => (reconnected = true));
    // A slow first retry, so the line below lands while Bo is away.
    bo.reconnection.minDelay = 800;
    bo.reconnection.delay = 800;
    const room = matchMaker.getLocalRoomById(roomId) as LibraryRoom;
    (room.clients.getById(bo.sessionId)!.ref as unknown as { terminate(): void }).terminate();
    await until(() => !room.clients.getById(bo.sessionId));
    ada.send("chat", { text: "back in five, save my seat", fenwick: false });
    await until(() => room.state.players.size === 2 && reconnected, NET.RECONNECT_S * 1000);
    await until(() => boHistory.length === 2);
    expect(boChat.map((l) => l.text)).not.toContain("back in five, save my seat");
    expect(boHistory[1]!.lines.map((l) => l.text)).toEqual(["back in five, save my seat"]);
    await Promise.all([ada.leave(), bo.leave()]);
  });
});

describe("the /proof page's ticket replay test", () => {
  const prove = (body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/proof/ticket`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: WEB_ORIGIN, ...headers },
      body: JSON.stringify(body),
    });

  it("accepts a fresh ticket once, then refuses it as a replay", async () => {
    const once = await ticket("Ada");
    const first = await prove({ ticket: once });
    expect(first.status).toBe(200);
    expect(first.headers.get("access-control-allow-origin")).toBe(WEB_ORIGIN);
    expect(await first.json()).toEqual({ accepted: true });
    const second = await prove({ ticket: once });
    expect(await second.json()).toEqual({ accepted: false, reason: "ticket_replayed" });
  });

  it("shares one ledger with joining: a proved ticket can't join, a used one can't be proved", async () => {
    const proved = await ticket("Ada");
    expect(await (await prove({ ticket: proved })).json()).toEqual({ accepted: true });
    await expect(
      new Client(`ws://localhost:${port}`).joinOrCreate(LIBRARY_ROOM_NAME, { ticket: proved }),
    ).rejects.toThrow(/ticket_replayed/);

    const joined = await ticket("Bo");
    const room = await new Client(`ws://localhost:${port}`).joinOrCreate(LIBRARY_ROOM_NAME, {
      ticket: joined,
    });
    open.push(room);
    expect(await (await prove({ ticket: joined })).json()).toEqual({
      accepted: false,
      reason: "ticket_replayed",
    });
    await room.leave();
  });

  it("refuses forged tickets, other sites and bad bodies, and never echoes the ticket", async () => {
    const forged = await ticket("Ada", { secret: "another-secret" });
    const res = await prove({ ticket: forged });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ accepted: false, reason: "ticket_bad_signature" });
    expect(text).not.toContain("Ada");
    expect(
      (await prove({ ticket: await ticket("Ada") }, { origin: "https://evil.example" })).status,
    ).toBe(403);
    expect((await prove({ nope: true }, { "x-forwarded-for": "198.51.100.7" })).status).toBe(400);
  });

  it("rate-limits each client address", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push((await prove({}, { "x-forwarded-for": "203.0.113.9" })).status);
    expect(statuses.slice(0, 10).every((s) => s === 400)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // Someone else isn't held up by it.
    expect((await prove({}, { "x-forwarded-for": "203.0.113.10" })).status).toBe(400);
  });
});
