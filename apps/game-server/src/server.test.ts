import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIBRARY_ROOM_NAME, MAX_PLAYERS_PER_ROOM } from "@ovr/shared";
import { createGameServer } from "./server";

const port = 25_000 + Math.floor(Math.random() * 5_000);
const base = `http://localhost:${port}`;
const server = createGameServer();

beforeAll(async () => {
  await server.listen(port);
});

afterAll(async () => {
  await server.gracefullyShutdown(false);
});

async function reserveSeat(): Promise<{ roomId: string; sessionId: string }> {
  const res = await fetch(`${base}/matchmake/joinOrCreate/${LIBRARY_ROOM_NAME}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as { roomId: string; sessionId: string };
}

describe("game server", () => {
  it("answers the health check", async () => {
    const res = await fetch(`${base}/health`);
    expect(await res.json()).toMatchObject({ ok: true, maxPlayersPerRoom: MAX_PLAYERS_PER_ROOM });
  });

  it("never puts more than 15 people in one library room", async () => {
    const seats = [];
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM + 1; i++) seats.push(await reserveSeat());
    const first = seats[0]!.roomId;
    expect(seats.slice(0, MAX_PLAYERS_PER_ROOM).every((s) => s.roomId === first)).toBe(true);
    // The 16th person is matched into a new room instead.
    expect(seats[MAX_PLAYERS_PER_ROOM]!.roomId).not.toBe(first);
  });
});
