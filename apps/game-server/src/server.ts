import {
  createEndpoint,
  createRouter,
  defineRoom,
  defineServer,
  logger,
  matchMaker,
} from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { LIBRARY_ROOM_NAME, MAX_PLAYERS_PER_ROOM } from "@ovr/shared";
import { type GameServerConfig, configFromEnv, originAllowed, setServerConfig } from "./config";
import { LibraryRoom } from "./rooms/LibraryRoom";

/**
 * Builds the Colyseus server: the public library room plus a health check. Settings come from
 * the environment (see config.ts) unless given, as the tests do.
 */
export function createGameServer(config: GameServerConfig = configFromEnv()) {
  setServerConfig(config);
  if (!config.ticketSecret)
    logger.warn("[config] GAME_TICKET_SECRET is not set: nobody will be able to join.");
  if (!config.allowedOrigins)
    logger.warn("[config] ALLOWED_ORIGINS is not set: browsers on any origin may connect.");

  // Players only ever join by matchmaking (or a known room, or a reconnect): nobody may open
  // rooms of their own, which "create" would allow.
  matchMaker.controller.exposedMethods = ["joinOrCreate", "join", "joinById", "reconnect"];

  // Matchmaking answers CORS for allowed origins only (Colyseus echoes any origin by default).
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get("origin");
    const ok = origin && originAllowed(origin, config.allowedOrigins);
    return { "Access-Control-Allow-Origin": ok ? origin : "null" };
  };

  return defineServer({
    transport: new WebSocketTransport({
      // Refuse a browser's WebSocket from another site before the handshake.
      beforeUpgrade: (request) =>
        originAllowed(request.headers.get("origin"), config.allowedOrigins)
          ? undefined
          : new Response(null, { status: 403 }),
    }),
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
