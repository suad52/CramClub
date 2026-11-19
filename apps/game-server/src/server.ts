import { createEndpoint, createRouter, defineRoom, defineServer } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LIBRARY_ROOM_NAME, MAX_PLAYERS_PER_ROOM } from "@ovr/shared";
import { LibraryRoom } from "./rooms/LibraryRoom";

/** Builds the Colyseus server: the public library room plus a health check. */
export function createGameServer() {
  return defineServer({
    transport: new WebSocketTransport(),
    greet: false,
    rooms: {
      [LIBRARY_ROOM_NAME]: defineRoom(LibraryRoom),
    },
    routes: createRouter({
      health: createEndpoint("/health", { method: "GET" }, async (ctx) =>
        ctx.json({ ok: true, room: LIBRARY_ROOM_NAME, maxPlayersPerRoom: MAX_PLAYERS_PER_ROOM }),
      ),
    }),
  });
}
