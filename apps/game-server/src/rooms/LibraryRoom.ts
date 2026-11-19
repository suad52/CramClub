import { type Client, Room, logger } from "@colyseus/core";
import { MAX_PLAYERS_PER_ROOM } from "@ovr/shared";

/**
 * One public library. Matchmaking (`joinOrCreate`) fills an existing room until it holds
 * {@link MAX_PLAYERS_PER_ROOM} people, then opens a new one; Colyseus locks a full room itself.
 *
 * Phase 0 foundation: the room accepts connections and enforces the cap. The synchronized
 * player schema, movement validation and reconnection arrive in Phase 3.
 */
export class LibraryRoom extends Room {
  override maxClients = MAX_PLAYERS_PER_ROOM;

  override onCreate(): void {
    logger.info(`[library ${this.roomId}] created`);
  }

  override onJoin(client: Client): void {
    logger.info(
      `[library ${this.roomId}] ${client.sessionId} joined (${this.clients.length}/${this.maxClients})`,
    );
  }

  override onLeave(client: Client): void {
    logger.info(
      `[library ${this.roomId}] ${client.sessionId} left (${this.clients.length}/${this.maxClients})`,
    );
  }

  override onDispose(): void {
    logger.info(`[library ${this.roomId}] disposed`);
  }
}
