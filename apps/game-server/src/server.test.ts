import { request as httpRequest } from "node:http";
import { matchMaker } from "@colyseus/core";
import { Client, type Room } from "@colyseus/sdk";
import {
  DEFAULT_AVATAR,
  LIBRARY_ROOM_NAME,
  MAX_PLAYERS_PER_ROOM,
  NET,
  SEATS,
  type ServerMessages,
  learnerKey,
  newTicketId,
  sanitizeAvatarConfig,
  signTicket,
} from "@ovr/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type GameServerConfig, setServerConfig } from "./config";
import type { LibraryRoom } from "./rooms/LibraryRoom";
import { MOVE_BURST_M } from "./rooms/rules";
import { createGameServer } from "./server";

const SECRET = "test-only-ticket-secret";
const WEB_ORIGIN = "http://localhost:3100";
const CONFIG: GameServerConfig = { ticketSecret: SECRET, allowedOrigins: new Set([WEB_ORIGIN]) };
const port = 25_000 + Math.floor(Math.random() * 5_000);
const base = `http://localhost:${port}`;
const server = createGameServer(CONFIG);
const open: Room[] = [];

beforeAll(async () => {
  await server.listen(port);
});

afterAll(async () => {
  await Promise.allSettled(open.map((r) => r.leave()));
  await server.gracefullyShutdown(false);
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
