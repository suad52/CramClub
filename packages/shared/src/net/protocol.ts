/**
 * Live multiplayer: the wire contract between the browser (apps/web/lib/net) and the Colyseus game
 * server (apps/game-server, room LIBRARY_ROOM_NAME). The server's schema state mirrors
 * {@link NetPlayer}; clients send only the messages in {@link ClientMessages}.
 *
 * Identity: before joining, the browser asks the web app for a short-lived signed ticket
 * (GET /api/net/ticket, HMAC-SHA256 with GAME_TICKET_SECRET, shared by both apps). The ticket names
 * the player (first name, or a guest name) and carries an opaque per-learner key so one person
 * opening two tabs is recognised; the server verifies it in onAuth and NEVER trusts a name or id
 * sent any other way. Learner ids, emails and Auth0 subs are never put in the shared state.
 *
 * Chat: a room-wide text chat (first names only, never stored after the room closes). The server
 * trims, caps and rate-limits every line and stamps it with the sender's ticket name. When nobody
 * else answers a player within {@link CHAT}.GHOST_MS, Ms. Fenwick (the librarian) may answer
 * them in the chat: the GAME SERVER decides that and asks the web app for her words over a signed
 * internal request (internal.ts → POST /api/internal/fenwick-chat), so no client can ever post as
 * her. Her lines carry `from: FENWICK_ID`.
 *
 * Privacy: avatars are shared as their config; the "my real face" photo is NOT shared (others see
 * the chibi head) unless the player later opts in. Webcam frames are never sent; only the reduced
 * FacialParams (see types/player.ts), and only while the player has face tracking on.
 */

import type { FacialParams, MovementState, StudyStatus } from "../types/player";

/** Join options sent with joinOrCreate(LIBRARY_ROOM_NAME, …). */
export interface JoinOptions {
  ticket: string;
}

/** What a verified ticket says (the server's view; never sent to other clients as-is). */
export interface TicketClaims {
  /** Opaque, stable per learner (HMAC of the learner id); used only server-side. */
  key: string;
  /** Shown above the avatar: first name when signed in, else "Guest 4821"-style. */
  name: string;
  signedIn: boolean;
  /** Expiry, seconds since epoch (tickets live ~5 minutes; only needed to join). */
  exp: number;
  /**
   * Random ticket id, so every ticket is distinct (two tabs asking in the same second included)
   * and the server can accept each one exactly once. The web app always sets it.
   */
  jti?: string;
}

/** One player as everyone else sees them (the schema's fields; keyed by sessionId). */
export interface NetPlayer {
  name: string;
  signedIn: boolean;
  /** AvatarConfig as JSON (validated with sanitizeAvatarConfig on both ends). */
  avatar: string;
  x: number;
  y: number;
  z: number;
  /** Body facing, radians. */
  ry: number;
  movement: MovementState;
  /** Ground speed m/s (drives the walk cycle). */
  speed: number;
  /** Seat id while seated, else "". */
  seatId: string;
  status: StudyStatus;
  /** Whether facial params are being sent (else the avatar idles). */
  face: boolean;
  /**
   * Typing in the library chat right now. Set by the "typing" message; cleared when they send a
   * line, after CHAT.TYPING_IDLE_MS without a refresh, or when they leave.
   */
  typing: boolean;
}

/** The `from` of Ms. Fenwick's chat lines (never a Colyseus sessionId). */
export const FENWICK_ID = "fenwick";
/** Her name as shown in the chat. */
export const FENWICK_NAME = "Ms. Fenwick";

/** One line of the library chat, as everyone in the room sees it. */
export interface ChatLine {
  /** Server-assigned, unique within the room (e.g. "c42"). */
  id: string;
  /** The sender's sessionId, or FENWICK_ID. */
  from: string;
  /** The sender's ticket name, or FENWICK_NAME. */
  name: string;
  /** Trimmed, single-spaced, at most CHAT.MAX_CHARS characters. */
  text: string;
  /** Server time, ms since epoch. */
  at: number;
  /** Ms. Fenwick's lines only: the sessionId of the player she is answering. */
  replyTo?: string;
}

/** Messages a client may send. The server rate-limits and validates every one. */
export interface ClientMessages {
  /** Up to MOVE_HZ per second: where I am now. */
  move: { x: number; y: number; z: number; ry: number; movement: MovementState; speed: number };
  /** Ask for a seat; the server answers with "seat" (ok) or "seat_denied". */
  sit: { seatId: string };
  stand: Record<string, never>;
  /** Up to FACE_HZ per second while face tracking is on; null turns it off. */
  face: FacialParams | null;
  status: { status: StudyStatus };
  /** My avatar changed (Character Studio). */
  avatar: { avatar: string };
  /**
   * A line in the library chat (everyone in the room sees it). `fenwick: false` means the sender
   * turned off "Ms. Fenwick answers if nobody does" (default on). Dropped if empty after cleaning
   * or over the rate limit.
   */
  chat: { text: string; fenwick?: boolean };
  /** I started (true) or stopped (false) typing in the chat. At most CHAT.TYPING_HZ a second. */
  typing: { on: boolean };
  /**
   * I flipped "Ms. Fenwick answers if nobody does". Off also cancels her wait on my latest line
   * (and a reply she's still writing to me isn't posted); later lines carry it as `chat.fenwick`.
   */
  chat_pref: { fenwick: boolean };
  /**
   * "I'm leaving on purpose" (closing the tab, going to sign in): sent just before the socket
   * closes, so the server removes the player at once instead of holding them for a reconnect.
   */
  bye: Record<string, never>;
}

/** Messages the server sends to one client. */
export interface ServerMessages {
  seat: { seatId: string };
  seat_denied: { seatId: string; reason: "taken" | "unknown_seat" | "too_far" };
  /** Another player's face params, relayed (not stored in state): { from: sessionId, … }. */
  face: { from: string; params: FacialParams | null };
  /** A new chat line, to everyone in the room (the sender included: it's their confirmation). */
  chat: ChatLine;
  /**
   * The room's last CHAT.HISTORY lines, oldest first: right after joining, and again after a
   * reconnect (lines said while the connection was down are in it; merge by `id`).
   */
  chat_history: { lines: ChatLine[] };
  /**
   * Ms. Fenwick started (on) or stopped (off) writing a reply to `to` (a sessionId). Everyone in
   * the room gets it, so they all see "Ms. Fenwick is typing…". "on" goes out only once she has
   * been at it a moment (so a quick "no reply" shows nothing), and "off" follows only an "on".
   * "off" without a chat line means she decided the message needed no answer, couldn't be
   * reached, or someone else answered meanwhile.
   */
  fenwick_typing: { on: boolean; to: string };
}

/** Library chat limits and Ms. Fenwick's "nobody answered you" rule. */
export const CHAT = {
  /** Longest line, in characters (after trimming and collapsing whitespace). */
  MAX_CHARS: 200,
  /** Lines the room remembers for people who join later. */
  HISTORY: 30,
  /** Chat lines per player: on average this many a second, with BURST in a row. */
  PER_SECOND: 0.5,
  BURST: 4,
  /** "typing" messages per player per second. */
  TYPING_HZ: 2,
  /** Typing shows for this long after the last "typing: on" (clients refresh it while typing). */
  TYPING_IDLE_MS: 5000,
  /**
   * Ghosting: Ms. Fenwick answers a player when nobody else has sent a chat line since their
   * latest message for this long, if at least one other person is in the room... (A line that
   * answers someone else, without asking anything back, isn't waiting for an answer itself.)
   */
  GHOST_MS: 10_000,
  /** ...or this long when nobody else is in the room (no one could answer). */
  GHOST_ALONE_MS: 3_000,
  /** If someone else is typing when the time is up, she waits for them, but never past this. */
  GHOST_MAX_MS: 20_000,
  /** She answers the same player at most once per this long (when others are in the room)... */
  FENWICK_PLAYER_COOLDOWN_MS: 20_000,
  /** ...or this long when they're alone (a one-to-one conversation with her keeps going)... */
  FENWICK_ALONE_COOLDOWN_MS: 5_000,
  /** ...and at most this many times a minute in one room. */
  FENWICK_ROOM_PER_MINUTE: 6,
  /** How long the game server waits for her words before giving up quietly. */
  FENWICK_TIMEOUT_MS: 15_000,
  /** Chat lines of context sent with each request for her reply (oldest first). */
  FENWICK_CONTEXT_LINES: 12,
} as const;

/** Send rates (per second) and validation limits. */
export const NET = {
  MOVE_HZ: 12,
  FACE_HZ: 8,
  /** Remote players are drawn this far in the past and interpolated between snapshots. */
  INTERP_DELAY_MS: 120,
  /** Largest believable speed between two moves (run speed plus slack for lag). */
  MAX_SPEED: 8,
  /** Ticket lifetime. */
  TICKET_TTL_S: 300,
  /** Reconnect window after a dropped connection. */
  RECONNECT_S: 20,
} as const;
