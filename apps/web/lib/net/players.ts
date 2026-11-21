import { create } from "zustand";
import {
  type AvatarConfig,
  type FacialParams,
  type MovementState,
  type NetPlayer,
  STUDY_STATUSES,
  type StudyStatus,
  sanitizeAvatarConfig,
} from "@ovr/shared";
import { SnapshotBuffer } from "./interpolation";
import { sanitizeFace } from "./rate";

/**
 * Everyone else in the room. Two halves:
 * - `useRemotePlayers`, a small React store of who's here and what they look like (name, avatar,
 *   study status), which changes only when someone joins, leaves or changes their look;
 * - `remoteLive`, plain objects the renderer reads every frame (the position buffer, movement,
 *   seat, face), which change a dozen times a second and never re-render anything.
 * Keyed by the server's sessionId. Nothing here is an account id: the server never sends one.
 */

export interface RemoteInfo {
  id: string;
  /** First name, or "Guest 4821". */
  name: string;
  signedIn: boolean;
  avatar: AvatarConfig;
  status: StudyStatus;
}

export interface RemoteLive {
  buffer: SnapshotBuffer;
  movement: MovementState;
  /** Seat id while seated, else "". */
  seatId: string;
  /** Whether they're sending face params (else their avatar idles). */
  faceOn: boolean;
  /** Their latest face params (relayed, not in the state), or null; shown only while faceOn. */
  face: FacialParams | null;
  /** Reused for incoming face params. */
  faceScratch: FacialParams;
}

interface RemotePlayersStore {
  players: Record<string, RemoteInfo>;
}

export const useRemotePlayers = create<RemotePlayersStore>(() => ({ players: {} }));

export const remoteLive = new Map<string, RemoteLive>();

/** Seat id → who sits there (remote players only). */
const seatOwners = new Map<string, string>();

/** Whether someone else is sitting in this seat right now. */
export const isSeatTakenByOther = (seatId: string) => seatOwners.has(seatId);

/** The seats other players are sitting in (for "is anyone at this table?"). */
export const takenSeats = (): ReadonlyMap<string, string> => seatOwners;

const NAME_MAX = 32;
/** A name as the server sent it, safe to draw: no control characters, not too long. */
export function cleanRemoteName(name: unknown) {
  const s = typeof name === "string" ? name : "";
  const clean = s
    .replace(/\s+/g, " ")
    // control, separator and invisible format characters (bidi overrides, zero-widths)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, "")
    .trim()
    .slice(0, NAME_MAX)
    .trim();
  return clean || "Someone";
}

const MOVEMENTS = new Set<MovementState>(["idle", "walk", "run", "sit"]);
const STATUSES = new Set<StudyStatus>(STUDY_STATUSES);

const parsedAvatars = new Map<string, AvatarConfig>();
/** An avatar's JSON as a valid config (cached: everyone's look is parsed once). */
export function parseAvatar(json: unknown): AvatarConfig {
  const key = typeof json === "string" ? json : "";
  const hit = parsedAvatars.get(key);
  if (hit) return hit;
  let raw: unknown = null;
  try {
    raw = key ? JSON.parse(key) : null;
  } catch {
    raw = null;
  }
  const config = sanitizeAvatarConfig(raw);
  if (parsedAvatars.size > 64) parsedAvatars.clear();
  parsedAvatars.set(key, config);
  return config;
}

const num = (v: unknown, fallback = 0) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function setSeat(id: string, live: RemoteLive, seatId: string) {
  if (live.seatId === seatId) return;
  if (live.seatId && seatOwners.get(live.seatId) === id) seatOwners.delete(live.seatId);
  live.seatId = seatId;
  if (seatId) seatOwners.set(seatId, id);
}

/**
 * A player's state changed (or they just appeared): their position goes into the buffer, the
 * rest into `remoteLive`, and their look into the React store only if it changed.
 */
export function upsertRemote(id: string, p: Partial<NetPlayer>, now: number) {
  let live = remoteLive.get(id);
  if (!live) {
    live = {
      buffer: new SnapshotBuffer(),
      movement: "idle",
      seatId: "",
      faceOn: false,
      face: null,
      faceScratch: {
        headYaw: 0,
        headPitch: 0,
        headRoll: 0,
        eyeBlinkLeft: 0,
        eyeBlinkRight: 0,
        jawOpen: 0,
        smile: 0,
        browRaise: 0,
      },
    };
    remoteLive.set(id, live);
  }
  const x = num(p.x);
  const y = num(p.y);
  const z = num(p.z);
  const ry = num(p.ry);
  const speed = Math.max(0, num(p.speed));
  const last = live.buffer.latest();
  if (
    !last ||
    last.x !== x ||
    last.y !== y ||
    last.z !== z ||
    last.ry !== ry ||
    last.speed !== speed
  )
    live.buffer.push(now, x, y, z, ry, speed);
  live.movement = MOVEMENTS.has(p.movement as MovementState)
    ? (p.movement as MovementState)
    : "idle";
  setSeat(id, live, typeof p.seatId === "string" ? p.seatId : "");
  const faceOn = p.face === true;
  if (live.faceOn && !faceOn) live.face = null;
  live.faceOn = faceOn;

  const name = cleanRemoteName(p.name);
  const signedIn = p.signedIn === true;
  const avatar = parseAvatar(p.avatar);
  const status = STATUSES.has(p.status as StudyStatus) ? (p.status as StudyStatus) : "available";
  const prev = useRemotePlayers.getState().players[id];
  if (
    !prev ||
    prev.name !== name ||
    prev.signedIn !== signedIn ||
    prev.avatar !== avatar ||
    prev.status !== status
  ) {
    useRemotePlayers.setState((s) => ({
      players: { ...s.players, [id]: { id, name, signedIn, avatar, status } },
    }));
  }
}

export function removeRemote(id: string) {
  const live = remoteLive.get(id);
  if (live) setSeat(id, live, "");
  remoteLive.delete(id);
  if (!useRemotePlayers.getState().players[id]) return;
  useRemotePlayers.setState((s) => {
    const players = { ...s.players };
    delete players[id];
    return { players };
  });
}

/**
 * Another player's relayed face params. They're shown only while their state says tracking is on
 * (the relay can arrive just before the state patch that says so).
 */
export function setRemoteFace(id: string, params: unknown) {
  const live = remoteLive.get(id);
  if (live) live.face = sanitizeFace(params, live.faceScratch);
}

/** Everyone's gone (left the room, or the connection dropped for good). */
export function clearRemotes() {
  remoteLive.clear();
  seatOwners.clear();
  useRemotePlayers.setState({ players: {} });
}
