import {
  type AuthContext,
  type Client,
  CloseCode,
  ErrorCode,
  Room,
  ServerError,
  logger,
} from "@colyseus/core";
import {
  type ClientMessages,
  type FacialParams,
  MAX_PLAYERS_PER_ROOM,
  NET,
  SPAWN_POINTS,
  type ServerMessages,
  type TicketClaims,
  findStandPoint,
  ticketId,
  verifyTicket,
} from "@ovr/shared";
import { originAllowed, serverConfig } from "../config";
import { LibraryState, Player } from "./LibraryState";
import {
  type LimitName,
  type MoveTracker,
  type RateLimiter,
  TicketLedger,
  acceptMove,
  createLimiters,
  newTracker,
  readAvatar,
  readFace,
  readMove,
  readStatus,
  seatById,
  seatTooFar,
} from "./rules";

type LibraryClient = Client<{ auth: TicketClaims; messages: ServerMessages }>;

/** What the server keeps about each session beyond the shared state (survives a reconnect). */
interface Session {
  key: string;
  limits: Record<LimitName, RateLimiter>;
  tracker: MoveTracker;
  /** When the last face message came in (ms), to switch a silent face off. */
  faceAt: number;
  /** Their socket broke the WebSocket protocol (an oversized or malformed frame). */
  brokeProtocol: boolean;
  /** They said "bye" (leaving the page on purpose): no reconnect hold when the socket closes. */
  leaving: boolean;
}

/** One learner may have this many tabs in the same room (each is its own player). */
export const MAX_SESSIONS_PER_KEY = 3;
/** A face that sends nothing for this long is switched off for everyone. */
const FACE_IDLE_MS = 3000;
/** The Colyseus-level flood guard: more messages than this in a second disconnects the client. */
const MAX_MESSAGES_PER_SECOND = 60;
/** Every ticket used to join, process-wide (matchmaking runs here too): each works once. */
const usedTickets = new TicketLedger();

/**
 * One public library (contract: packages/shared/src/net/protocol.ts). Matchmaking
 * (`joinOrCreate`) fills a room until it holds {@link MAX_PLAYERS_PER_ROOM} people, then opens
 * another; Colyseus locks a full room itself.
 *
 * - Joining needs a ticket from the web app (GET /api/net/ticket), checked in the static onAuth
 *   during matchmaking, so a bad ticket never reserves a seat, and each ticket works once. The
 *   ticket's name is the only name a player can have.
 * - Every message is rate-limited per client (extras are dropped) and validated: moves stay on
 *   the library's floors at believable speeds, seats are exclusive and must be within reach,
 *   avatars go through sanitizeAvatarConfig, face values are clamped and relayed to the others
 *   without being stored.
 * - A dropped connection keeps its player (and seat) for NET.RECONNECT_S.
 */
export class LibraryRoom extends Room<{ state: LibraryState; client: LibraryClient }> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  override state = new LibraryState();

  private sessions = new Map<string, Session>();
  /** seatId → sessionId of whoever sits there. */
  private seats = new Map<string, string>();
  private spawnIndex = 0;

  /**
   * Runs at matchmaking, before a seat is reserved. Refuses browsers on other origins, then
   * anything but a valid, unexpired ticket; the claims become `client.auth`.
   */
  static override async onAuth(
    _token: string,
    options: unknown,
    context: AuthContext,
  ): Promise<TicketClaims> {
    const config = serverConfig();
    if (!originAllowed(context.headers.get("origin"), config.allowedOrigins))
      throw new ServerError(ErrorCode.AUTH_FAILED, "origin_not_allowed");
    const ticket = (options as { ticket?: unknown } | null)?.ticket;
    const check = await verifyTicket(config.ticketSecret, ticket);
    if (!check.ok) {
      if (check.reason === "missing_secret")
        logger.error("[library] GAME_TICKET_SECRET is not set: refusing every join");
      throw new ServerError(ErrorCode.AUTH_FAILED, `ticket_${check.reason}`);
    }
    // After the await above, so two joins racing with one ticket can't both get through.
    if (!usedTickets.claim(ticketId(ticket as string), check.claims.exp))
      throw new ServerError(ErrorCode.AUTH_FAILED, "ticket_replayed");
    return check.claims;
  }

  override onCreate(): void {
    this.onMessage("move", (client, msg) => this.onMove(client, msg));
    this.onMessage("sit", (client, msg) => this.onSit(client, msg));
    this.onMessage("stand", (client) => this.onStand(client));
    this.onMessage("face", (client, msg) => this.onFace(client, msg));
    this.onMessage("status", (client, msg) => this.onStatus(client, msg));
    this.onMessage("avatar", (client, msg) => this.onAvatar(client, msg));
    this.onMessage("bye", (client) => {
      const session = this.sessions.get(client.sessionId);
      if (session) session.leaving = true;
    });
    this.clock.setInterval(() => this.switchOffSilentFaces(), 1000);
    logger.info(`[library ${this.roomId}] created`);
  }

  override onJoin(client: LibraryClient): void {
    const claims = client.auth;
    if (!claims) throw new ServerError(ErrorCode.AUTH_FAILED, "ticket_missing");
    let sameKey = 0;
    for (const s of this.sessions.values()) if (s.key === claims.key) sameKey++;
    if (sameKey >= MAX_SESSIONS_PER_KEY)
      throw new ServerError(ErrorCode.AUTH_FAILED, "too_many_sessions");

    const now = Date.now();
    this.sessions.set(client.sessionId, {
      key: claims.key,
      limits: createLimiters(now),
      tracker: newTracker(now),
      faceAt: 0,
      brokeProtocol: false,
      leaving: false,
    });
    this.watchSocket(client);
    const spawn = SPAWN_POINTS[this.spawnIndex++ % SPAWN_POINTS.length]!;
    this.state.players.set(
      client.sessionId,
      new Player({
        name: claims.name,
        signedIn: claims.signedIn,
        avatar: "",
        x: spawn.x,
        y: spawn.y,
        z: spawn.z,
        ry: spawn.rotationY,
        movement: "idle",
        speed: 0,
        seatId: "",
        status: "available",
        face: false,
      }),
    );
    logger.info(
      `[library ${this.roomId}] ${client.sessionId} joined (${this.clients.length}/${this.maxClients})`,
    );
  }

  /**
   * An unexpected disconnect: hold the player (and their seat) for a while. Not for a client the
   * server threw out (flooding or an unknown message type: WITH_ERROR) or whose socket broke the
   * protocol (a frame over the 4 KB limit, say), who goes at once rather than coming straight
   * back to do it again.
   */
  override onDrop(client: LibraryClient, code?: number): void {
    this.setFace(client.sessionId, null);
    const session = this.sessions.get(client.sessionId);
    // Thrown out, broke the protocol, or said "bye" (left on purpose, e.g. to sign in): gone at once.
    if (code === CloseCode.WITH_ERROR || session?.brokeProtocol || session?.leaving) return;
    this.allowReconnection(client, NET.RECONNECT_S).catch(() => {
      // never fully joined, or the room is closing: onLeave tidies up
    });
  }

  /**
   * The `ws` socket emits "error" only for protocol violations by the client (socket-level
   * errors such as a reset don't reach it), then closes as 1006, which alone looks like a dropped
   * connection: remember it, so onDrop can tell.
   */
  private watchSocket(client: LibraryClient) {
    const ref = client.ref as unknown as { once?(event: "error", listener: () => void): void };
    ref.once?.("error", () => {
      const session = this.sessions.get(client.sessionId);
      if (session) session.brokeProtocol = true;
    });
  }

  override onReconnect(client: LibraryClient): void {
    this.watchSocket(client);
    logger.info(`[library ${this.roomId}] ${client.sessionId} reconnected`);
  }

  override onLeave(client: LibraryClient): void {
    const player = this.state.players.get(client.sessionId);
    if (player?.seatId) this.seats.delete(player.seatId);
    this.state.players.delete(client.sessionId);
    this.sessions.delete(client.sessionId);
    logger.info(
      `[library ${this.roomId}] ${client.sessionId} left (${this.clients.length}/${this.maxClients})`,
    );
  }

  /**
   * A message type the room doesn't know: Colyseus disconnects the sender (WITH_ERROR, so onDrop
   * doesn't hold their place). Logged here without the type, which is the sender's own text.
   */
  override onUnhandledMessage(client: LibraryClient): void {
    logger.info(
      `[library ${this.roomId}] ${client.sessionId} sent an unknown message: disconnected`,
    );
  }

  override onDispose(): void {
    logger.info(`[library ${this.roomId}] disposed`);
  }

  /* ---- Messages ---- */

  /** The client's player and session, if this message is within its rate limit. */
  private admit(client: LibraryClient, limit: LimitName) {
    const session = this.sessions.get(client.sessionId);
    const player = this.state.players.get(client.sessionId);
    if (!session || !player || !session.limits[limit].take()) return null;
    return { session, player };
  }

  private onMove(client: LibraryClient, msg: unknown) {
    const ok = this.admit(client, "move");
    if (!ok) return;
    const { session, player } = ok;
    if (player.seatId) return; // seated players stay put until they "stand"
    const move = readMove(msg);
    if (!move) return;
    const next = acceptMove(player, session.tracker, move);
    if (!next) return;
    player.x = next.x;
    player.y = next.y;
    player.z = next.z;
    player.ry = next.ry;
    player.movement = next.movement;
    player.speed = next.speed;
  }

  private onSit(client: LibraryClient, msg: unknown) {
    const ok = this.admit(client, "seat");
    if (!ok) return;
    const { player } = ok;
    const seatId = (msg as ClientMessages["sit"] | null)?.seatId;
    const seat = seatById(seatId);
    const deny = (reason: ServerMessages["seat_denied"]["reason"]) =>
      client.send("seat_denied", { seatId: typeof seatId === "string" ? seatId : "", reason });
    if (!seat) return deny("unknown_seat");
    if (player.seatId === seat.id) return client.send("seat", { seatId: seat.id });
    const holder = this.seats.get(seat.id);
    if (holder && holder !== client.sessionId) return deny("taken");
    if (seatTooFar(seat, player)) return deny("too_far");

    if (player.seatId) this.seats.delete(player.seatId);
    this.seats.set(seat.id, client.sessionId);
    player.seatId = seat.id;
    player.x = seat.x;
    player.y = seat.y;
    player.z = seat.z;
    player.ry = seat.rotationY;
    player.movement = "sit";
    player.speed = 0;
    client.send("seat", { seatId: seat.id });
  }

  private onStand(client: LibraryClient) {
    const ok = this.admit(client, "seat");
    if (!ok || !ok.player.seatId) return;
    const { session, player } = ok;
    const seat = seatById(player.seatId);
    this.seats.delete(player.seatId);
    player.seatId = "";
    player.movement = "idle";
    player.speed = 0;
    // Where the client stands up too (the same function, the same colliders).
    const stand = seat ? findStandPoint(seat) : null;
    if (stand) {
      player.x = stand.x;
      player.y = stand.y;
      player.z = stand.z;
    }
    session.tracker.at = Date.now();
  }

  private onFace(client: LibraryClient, msg: unknown) {
    const ok = this.admit(client, "face");
    if (!ok) return;
    const params = readFace(msg);
    if (params === undefined) return;
    ok.session.faceAt = Date.now();
    this.setFace(client.sessionId, params);
  }

  private onStatus(client: LibraryClient, msg: unknown) {
    const ok = this.admit(client, "status");
    const status = readStatus(msg);
    if (ok && status) ok.player.status = status;
  }

  private onAvatar(client: LibraryClient, msg: unknown) {
    const ok = this.admit(client, "avatar");
    const avatar = readAvatar(msg);
    if (ok && avatar) ok.player.avatar = avatar;
  }

  /* ---- Faces ---- */

  /** Relays face params (or null: off) to everyone but their owner; never stored in state. */
  private setFace(sessionId: string, params: FacialParams | null) {
    const player = this.state.players.get(sessionId);
    if (!player) return;
    if (params === null && !player.face) return;
    player.face = params !== null;
    const except = this.clients.getById(sessionId);
    this.broadcast("face", { from: sessionId, params }, except ? { except } : undefined);
  }

  private switchOffSilentFaces() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      if (now - session.faceAt > FACE_IDLE_MS) this.setFace(sessionId, null);
    }
  }
}
