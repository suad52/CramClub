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
}

/** Messages the server sends to one client. */
export interface ServerMessages {
  seat: { seatId: string };
  seat_denied: { seatId: string; reason: "taken" | "unknown_seat" | "too_far" };
  /** Another player's face params, relayed (not stored in state): { from: sessionId, … }. */
  face: { from: string; params: FacialParams | null };
}

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
