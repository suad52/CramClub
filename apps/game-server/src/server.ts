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
import {
  type GameServerConfig,
  configFromEnv,
  originAllowed,
  serverConfig,
  setServerConfig,
} from "./config";
import { createProofLimits, proofTicket } from "./proof";
import { LibraryRoom } from "./rooms/LibraryRoom";

/**
 * Builds the Colyseus server: the public library room, a health check (GET /health) and the
 * /proof page's ticket replay test (POST /proof/ticket, see proof.ts: it checks and claims a
 * ticket exactly as joining does, without making a player). Settings come from the environment
 * (see config.ts) unless given, as the tests do. In production Caddy serves all of this under
 * https://SITE_HOST/game/ (deploy/Caddyfile).
 */
export function createGameServer(config: GameServerConfig = configFromEnv()) {
  setServerConfig(config);
  if (!config.ticketSecret)
    logger.warn("[config] GAME_TICKET_SECRET is not set: nobody will be able to join.");
  if (!config.allowedOrigins)
    logger.warn("[config] ALLOWED_ORIGINS is not set: browsers on any origin may connect.");
  if (!config.webInternalUrl)
    logger.warn("[config] WEB_INTERNAL_URL is not an http(s) URL: Ms. Fenwick won't chat.");

  // Players only ever join by matchmaking (or a known room, or a reconnect): nobody may open
  // rooms of their own, which "create" would allow.
  matchMaker.controller.exposedMethods = ["joinOrCreate", "join", "joinById", "reconnect"];

  // Matchmaking answers CORS for allowed origins only (Colyseus echoes any origin by default).
  matchMaker.controller.getCorsHeaders = (headers: Headers) => {
    const origin = headers.get("origin");
    const ok = origin && originAllowed(origin, config.allowedOrigins);
    return { "Access-Control-Allow-Origin": ok ? origin : "null" };
  };

  const proofLimits = createProofLimits();

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
      proofTicket: createEndpoint("/proof/ticket", { method: "POST" }, async (ctx) => {
        let body: unknown = ctx.body;
        if (typeof body === "string") {
          try {
            body = JSON.parse(body);
          } catch {
            body = null;
          }
        }
        const headers = new Headers(ctx.request?.headers ?? ctx.headers ?? {});
        // serverConfig(), not `config`: the settings in force (the tests swap them).
        const answer = await proofTicket(body, headers, serverConfig(), proofLimits);
        return Response.json(answer.body, {
          status: answer.status,
          headers: { "cache-control": "no-store" },
        });
      }),
    }),
  });
}
