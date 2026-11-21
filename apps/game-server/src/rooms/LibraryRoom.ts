import {
  type AuthContext,
  type Client,
  CloseCode,
  type Delayed,
  ErrorCode,
  Room,
  ServerError,
  logger,
} from "@colyseus/core";
import {
  CHAT,
  type ChatLine,
  type ClientMessages,
  FENWICK_ID,
  FENWICK_NAME,
  type FacialParams,
  type FenwickChatRequest,
  INTERNAL_SIGNATURE_HEADER,
  INTERNAL_TIMESTAMP_HEADER,
  MAX_PLAYERS_PER_ROOM,
  NET,
  SPAWN_POINTS,
  type ServerMessages,
  type TicketClaims,
  findStandPoint,
  signInternal,
} from "@ovr/shared";
import { originAllowed, serverConfig } from "../config";
import { admitTicket } from "../tickets";
import { LibraryState, Player } from "./LibraryState";
import {
  type GhostState,
  type LimitName,
  type MoveTracker,
  type RateLimiter,
  FENWICK_TYPING_DELAY_MS,
  acceptMove,
  createLimiters,
  fenwickContext,
  ghostDecision,
  newTracker,
  readAvatar,
  readChat,
  readFace,
  readFenwickReply,
  readMove,
  readStatus,
  readTyping,
  remember,
  seatById,
  seatTooFar,
  waitsForAnswer,
} from "./rules";

type LibraryClient = Client<{ auth: TicketClaims; messages: ServerMessages }>;

/** What the server keeps about each session beyond the shared state (survives a reconnect). */
interface Session {
  key: string;
  limits: Record<LimitName, RateLimiter>;
  tracker: MoveTracker;
  /** When the last face message came in (ms), to switch a silent face off. */
  faceAt: number;
  /** When the last "typing: on" came in (ms), to switch a stale typing indicator off. */
  typingAt: number;
  /** Their socket broke the WebSocket protocol (an oversized or malformed frame). */
  brokeProtocol: boolean;
  /** They said "bye" (leaving the page on purpose): no reconnect hold when the socket closes. */
  leaving: boolean;
  /** "Ms. Fenwick answers if nobody does", as their latest line or chat_pref said (default on). */
  fenwick: boolean;
}

/** A player's latest chat line that nobody has answered yet (the ghost rule is watching it). */
interface Unanswered {
  /** When their latest line was posted (ms). */
  askedAt: number;
  /** Their learner key and ticket name. */
  key: string;
  name: string;
  /** The next look at it. */
  timer: Delayed | null;
}

/** One learner may have this many tabs in the same room (each is its own player). */
export const MAX_SESSIONS_PER_KEY = 3;
/** A face that sends nothing for this long is switched off for everyone. */
const FACE_IDLE_MS = 3000;
/** The Colyseus-level flood guard: more messages than this in a second disconnects the client. */
const MAX_MESSAGES_PER_SECOND = 60;
/** The web app's route that writes Ms. Fenwick's chat replies (internal.ts). */
export const FENWICK_CHAT_PATH = "/api/internal/fenwick-chat";
/**
 * When she took up anyone's lines, the last minute, in every room of this process
 * (rules.ts FENWICK_GLOBAL_PER_MINUTE): rooms are cheap to fill with fresh guests, Gemini isn't.
 */
const fenwickGlobalRecent: number[] = [];

/**
 * One public library (contract: packages/shared/src/net/protocol.ts). Matchmaking
 * (`joinOrCreate`) fills a room until it holds {@link MAX_PLAYERS_PER_ROOM} people, then opens
 * another; Colyseus locks a full room itself.
 *
 * - Joining needs a ticket from the web app (GET /api/net/ticket), checked in the static onAuth
 *   during matchmaking, so a bad ticket never reserves a seat, and each ticket works once
 *   (src/tickets.ts, the same ledger the /proof page's replay test uses). The ticket's name is the
 *   only name a player can have.
 * - Every message is rate-limited per client (extras are dropped) and validated: moves stay on
 *   the library's floors at believable speeds, seats are exclusive and must be within reach,
 *   avatars go through sanitizeAvatarConfig, face values are clamped and relayed to the others
 *   without being stored.
 * - A dropped connection keeps its player (and seat) for NET.RECONNECT_S.
 *
 * Chat: each line is cleaned (rules.ts cleanChatText), rate-limited, given an id ("c42") and the
 * sender's ticket name, broadcast to everyone (the sender's confirmation included) and kept in
 * memory, the last CHAT.HISTORY lines only, which a joining player gets as "chat_history". Lines
 * are never written anywhere and go when the room closes; they're never logged. "typing" sets
 * Player.typing, which goes off when they send a line, after CHAT.TYPING_IDLE_MS without a
 * refresh, when their connection drops, or when they leave.
 *
 * Ms. Fenwick: after a player's line (unless it said `fenwick: false`, or it answers someone else
 * without asking anything back: rules.ts waitsForAnswer), rules.ts ghostDecision watches it on
 * this.clock: if nobody else posts within CHAT.GHOST_MS (GHOST_ALONE_MS when they're alone;
 * longer while someone else is typing, up to GHOST_MAX_MS), she answers, within her cooldowns
 * (per learner, per room, and FENWICK_GLOBAL_PER_MINUTE across the process). "chat_pref" off
 * cancels a wait. Only this room ever posts as her (`from: FENWICK_ID`): it sends a signed
 * FenwickChatRequest (internal.ts) to the web app's FENWICK_CHAT_PATH on WEB_INTERNAL_URL and
 * posts her reply to everyone with `replyTo` (the asker's browser speaks it). Nothing is posted
 * when she has no reply, the web app fails or takes longer than CHAT.FENWICK_TIMEOUT_MS, someone
 * else answered meanwhile, or the asker switched her off meanwhile; then her per-learner and
 * per-room cooldowns are given back (the process-wide count isn't). "fenwick_typing" on goes out
 * only once the request has taken FENWICK_TYPING_DELAY_MS, and off follows it. Requests run
 * alongside each other, one per asker at most. An asker who leaves before she starts is dropped;
 * a reply already being written is still posted unless the room is empty. A reconnecting player
 * gets "chat_history" again (lines broadcast while they were away never reached them). No
 * GAME_TICKET_SECRET or WEB_INTERNAL_URL: she stays quiet. Logs carry only status codes and
 * error names.
 */
export class LibraryRoom extends Room<{ state: LibraryState; client: LibraryClient }> {
  override maxClients = MAX_PLAYERS_PER_ROOM;
  override maxMessagesPerSecond = MAX_MESSAGES_PER_SECOND;
  override state = new LibraryState();

  private sessions = new Map<string, Session>();
  /** seatId → sessionId of whoever sits there. */
  private seats = new Map<string, string>();
  private spawnIndex = 0;

  /** The latest CHAT.HISTORY lines, oldest first. */
  private chat: ChatLine[] = [];
  private chatCount = 0;
  /** Learner key → when they last posted (ms): "did someone else answer?". */
  private lastLineByKey = new Map<string, number>();
  /** sessionId → their unanswered line, while the ghost rule watches it. */
  private unanswered = new Map<string, Unanswered>();
  /** Learner key → when Ms. Fenwick last took up their lines (her per-player cooldown). */
  private fenwickByKey = new Map<string, number>();
  /** When she took up anyone's lines here, the last minute (her per-room limit). */
  private fenwickRecent: number[] = [];
  /** sessionIds whose reply she is writing now (one at a time each). */
  private fenwickWriting = new Set<string>();
  private disposed = false;

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
    const admission = await admitTicket(config.ticketSecret, ticket);
    if (!admission.ok) {
      if (admission.reason === "ticket_missing_secret")
        logger.error("[library] GAME_TICKET_SECRET is not set: refusing every join");
      throw new ServerError(ErrorCode.AUTH_FAILED, admission.reason);
    }
    return admission.claims;
  }

  override onCreate(): void {
    this.onMessage("move", (client, msg) => this.onMove(client, msg));
    this.onMessage("sit", (client, msg) => this.onSit(client, msg));
    this.onMessage("stand", (client) => this.onStand(client));
    this.onMessage("face", (client, msg) => this.onFace(client, msg));
    this.onMessage("status", (client, msg) => this.onStatus(client, msg));
    this.onMessage("avatar", (client, msg) => this.onAvatar(client, msg));
    this.onMessage("chat", (client, msg) => this.onChat(client, msg));
    this.onMessage("typing", (client, msg) => this.onTyping(client, msg));
    this.onMessage("chat_pref", (client, msg) => this.onChatPref(client, msg));
    this.onMessage("bye", (client) => {
      const session = this.sessions.get(client.sessionId);
      if (session) session.leaving = true;
    });
    this.clock.setInterval(() => {
      this.switchOffSilentFaces();
      this.switchOffIdleTyping();
    }, 1000);
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
      typingAt: 0,
      brokeProtocol: false,
      leaving: false,
      fenwick: true,
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
        typing: false,
      }),
    );
    // Queued by Colyseus until the client has the full state, then delivered.
    client.send("chat_history", { lines: [...this.chat] });
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
    const player = this.state.players.get(client.sessionId);
    if (player) player.typing = false;
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
    // Broadcasts skip a dropped client: what was said meanwhile (her reply included) comes now.
    client.send("chat_history", { lines: [...this.chat] });
    logger.info(`[library ${this.roomId}] ${client.sessionId} reconnected`);
  }

  override onLeave(client: LibraryClient): void {
    const player = this.state.players.get(client.sessionId);
    if (player?.seatId) this.seats.delete(player.seatId);
    this.state.players.delete(client.sessionId);
    this.sessions.delete(client.sessionId);
    this.forgetUnanswered(client.sessionId);
    // Someone now alone needn't wait for an answer nobody is left to give.
    for (const sessionId of [...this.unanswered.keys()]) this.lookAgain(sessionId);
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
    this.disposed = true;
    for (const sessionId of [...this.unanswered.keys()]) this.forgetUnanswered(sessionId);
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

  private onChat(client: LibraryClient, msg: unknown) {
    const ok = this.admit(client, "chat");
    const chat = readChat(msg);
    if (!ok || !chat) return;
    const { session, player } = ok;
    const now = Date.now();
    const line: ChatLine = {
      id: `c${++this.chatCount}`,
      from: client.sessionId,
      name: client.auth?.name ?? player.name,
      text: chat.text,
      at: now,
    };
    // Is this line an answer to someone? (Read before it counts as the sender's latest.)
    const otherLineAt = this.latestLineExcept(session.key);
    let answeredSomeone = false;
    for (const waiting of this.unanswered.values())
      if (waiting.key !== session.key) answeredSomeone = true;
    session.fenwick = chat.fenwick;
    remember(this.chat, line);
    this.noteLine(session.key, now);
    player.typing = false;
    this.broadcast("chat", line);

    // Anyone else waiting on an answer has had one (ghostDecision gives up on them)...
    for (const [sessionId, waiting] of this.unanswered)
      if (waiting.key !== session.key) this.lookAgain(sessionId);
    // ...and this line starts (or restarts) the sender's own wait, unless it's itself an answer.
    if (
      chat.fenwick &&
      this.fenwickConfigured() &&
      waitsForAnswer(chat.text, now, otherLineAt, answeredSomeone)
    ) {
      this.forgetUnanswered(client.sessionId);
      this.unanswered.set(client.sessionId, {
        askedAt: now,
        key: session.key,
        name: line.name,
        timer: null,
      });
      this.lookAgain(client.sessionId);
    } else this.forgetUnanswered(client.sessionId);
  }

  private onTyping(client: LibraryClient, msg: unknown) {
    const ok = this.admit(client, "typing");
    const on = readTyping(msg);
    if (!ok || on === null) return;
    ok.player.typing = on;
    if (on) ok.session.typingAt = Date.now();
  }

  /** "Ms. Fenwick answers if nobody does" flipped: off cancels her wait on their latest line. */
  private onChatPref(client: LibraryClient, msg: unknown) {
    const ok = this.admit(client, "chatPref");
    const fenwick = (msg as { fenwick?: unknown } | null)?.fenwick;
    if (!ok || typeof fenwick !== "boolean") return;
    ok.session.fenwick = fenwick;
    if (!fenwick) this.forgetUnanswered(client.sessionId);
  }

  /* ---- Chat: Ms. Fenwick answers when nobody else does ---- */

  private fenwickConfigured() {
    const config = serverConfig();
    return !!config.ticketSecret && !!config.webInternalUrl;
  }

  /** Remembers when a learner last posted (dropping entries too old to matter to anyone). */
  private noteLine(key: string, at: number) {
    this.lastLineByKey.set(key, at);
    if (this.lastLineByKey.size > 2 * MAX_PLAYERS_PER_ROOM)
      for (const [k, t] of this.lastLineByKey)
        if (at - t > 2 * CHAT.GHOST_MAX_MS) this.lastLineByKey.delete(k);
  }

  /** The latest line from any learner but `key` (ms), or null. */
  private latestLineExcept(key: string): number | null {
    let latest: number | null = null;
    for (const [k, at] of this.lastLineByKey)
      if (k !== key && (latest === null || at > latest)) latest = at;
    return latest;
  }

  private forgetUnanswered(sessionId: string) {
    this.unanswered.get(sessionId)?.timer?.clear();
    this.unanswered.delete(sessionId);
  }

  /** What the ghost rule needs to know about one waiting player, right now. */
  private ghostState(sessionId: string, waiting: Unanswered): GhostState {
    const otherLineAt = this.latestLineExcept(waiting.key);
    let othersPresent = false;
    let othersTyping = false;
    for (const [id, session] of this.sessions) {
      if (session.key === waiting.key) continue;
      othersPresent = true;
      if (this.state.players.get(id)?.typing) othersTyping = true;
    }
    return {
      askedAt: waiting.askedAt,
      otherLineAt,
      othersPresent,
      othersTyping,
      lastForAsker: this.fenwickByKey.get(waiting.key) ?? null,
      roomRecent: this.fenwickRecent,
      globalRecent: fenwickGlobalRecent,
      inFlight: this.fenwickWriting.has(sessionId),
    };
  }

  /** Applies ghostDecision to a waiting player: look again later, answer them, or let it go. */
  private lookAgain(sessionId: string) {
    const waiting = this.unanswered.get(sessionId);
    if (!waiting) return;
    waiting.timer?.clear();
    waiting.timer = null;
    const now = Date.now();
    const state = this.ghostState(sessionId, waiting);
    const decision = ghostDecision(state, now);
    if (decision.action === "wait") {
      // A timer that throws would stop the whole server: never let one.
      waiting.timer = this.clock.setTimeout(
        () => {
          try {
            this.lookAgain(sessionId);
          } catch (error) {
            logger.error(`[library ${this.roomId}] chat timer failed: ${errorName(error)}`);
          }
        },
        Math.max(20, decision.until - now),
      );
      return;
    }
    this.unanswered.delete(sessionId);
    if (decision.action === "answer")
      this.answer(sessionId, waiting, !state.othersPresent).catch((error: unknown) =>
        logger.error(`[library ${this.roomId}] Ms. Fenwick's reply failed: ${errorName(error)}`),
      );
  }

  /**
   * Asks the web app for her reply to `sessionId` and posts it. Runs alongside the room (and
   * other replies). "fenwick_typing" goes on once it has taken FENWICK_TYPING_DELAY_MS, and off at
   * the end (whatever happens) if it went on. Nothing posted: her cooldowns are given back.
   */
  private async answer(sessionId: string, waiting: Unanswered, alone: boolean) {
    const config = serverConfig();
    const secret = config.ticketSecret;
    const base = config.webInternalUrl;
    if (!secret || !base) return;
    const now = Date.now();
    const before = this.fenwickByKey.get(waiting.key);
    this.fenwickByKey.set(waiting.key, now);
    this.fenwickRecent = this.fenwickRecent.filter((t) => now - t < 60_000);
    this.fenwickRecent.push(now);
    trimWindow(fenwickGlobalRecent, now);
    fenwickGlobalRecent.push(now);
    this.fenwickWriting.add(sessionId);
    let shown = false;
    const show = this.clock.setTimeout(() => {
      if (!this.fenwickWriting.has(sessionId) || this.disposed) return;
      shown = true;
      try {
        this.broadcast("fenwick_typing", { on: true, to: sessionId });
      } catch (error) {
        logger.error(`[library ${this.roomId}] chat timer failed: ${errorName(error)}`);
      }
    }, FENWICK_TYPING_DELAY_MS);

    let reply: string | null = null;
    try {
      const request: FenwickChatRequest = {
        askerName: waiting.name,
        lines: fenwickContext(this.chat, sessionId),
        alone,
      };
      const body = JSON.stringify(request);
      const timestamp = Date.now();
      const res = await fetch(`${base}${FENWICK_CHAT_PATH}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [INTERNAL_SIGNATURE_HEADER]: await signInternal(secret, timestamp, body),
          [INTERNAL_TIMESTAMP_HEADER]: String(timestamp),
        },
        body,
        signal: AbortSignal.timeout(CHAT.FENWICK_TIMEOUT_MS),
      });
      if (res.ok) reply = readFenwickReply(await res.json());
      else {
        logger.warn(`[library ${this.roomId}] Ms. Fenwick's reply: HTTP ${res.status}`);
        await res.body?.cancel();
      }
    } catch (error) {
      logger.warn(`[library ${this.roomId}] Ms. Fenwick's reply: ${errorName(error)}`);
    } finally {
      this.fenwickWriting.delete(sessionId);
      show.clear();
    }

    // Someone else answered while she was writing, or the asker switched her off: not needed.
    if (reply && (this.answeredSince(waiting) || this.sessions.get(sessionId)?.fenwick === false))
      reply = null;
    // Still post if the asker left meanwhile (others may read it), but not to an empty room.
    const room = !this.disposed && this.state.players.size > 0;
    if (reply && room) {
      const line: ChatLine = {
        id: `c${++this.chatCount}`,
        from: FENWICK_ID,
        name: FENWICK_NAME,
        text: reply,
        at: Date.now(),
        replyTo: sessionId,
      };
      remember(this.chat, line);
      this.broadcast("chat", line);
    } else {
      // Nothing said: her per-learner and per-room cooldowns weren't used (the process-wide
      // count, the cost guard, stays).
      if (this.fenwickByKey.get(waiting.key) === now) {
        if (before === undefined) this.fenwickByKey.delete(waiting.key);
        else this.fenwickByKey.set(waiting.key, before);
      }
      const i = this.fenwickRecent.indexOf(now);
      if (i >= 0) this.fenwickRecent.splice(i, 1);
    }
    if (shown && room) this.broadcast("fenwick_typing", { on: false, to: sessionId });
  }

  /** Another learner has posted since `waiting`'s line. */
  private answeredSince(waiting: Unanswered) {
    const other = this.latestLineExcept(waiting.key);
    return other !== null && other > waiting.askedAt;
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

  /** Typing that hasn't been refreshed for CHAT.TYPING_IDLE_MS goes off (a closed tab, say). */
  private switchOffIdleTyping() {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      const player = this.state.players.get(sessionId);
      if (player?.typing && now - session.typingAt > CHAT.TYPING_IDLE_MS) player.typing = false;
    }
  }
}

/** Drops times more than a minute before `now` from a sliding window, in place. */
function trimWindow(times: number[], now: number) {
  let stale = 0;
  while (stale < times.length && now - times[stale]! >= 60_000) stale++;
  if (stale) times.splice(0, stale);
}

/** An error's name ("TimeoutError", "TypeError"), never its message (which may quote text). */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
