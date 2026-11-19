import { logger } from "@colyseus/core";
import { createGameServer } from "./server";

// GAME_SERVER_PORT locally; hosts such as Railway inject PORT.
const port = Number(process.env.GAME_SERVER_PORT ?? process.env.PORT ?? 2567);

const server = createGameServer();
await server.listen(port);
logger.info(
  `OVR game server listening on ws://localhost:${port} (health: http://localhost:${port}/health)`,
);
