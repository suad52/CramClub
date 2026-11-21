"use client";

import { Callbacks, Client, type Room } from "@colyseus/sdk";
import { create } from "zustand";
import {
  type ClientMessages,
  FENWICK_ID,
  type FacialParams,
  type JoinOptions,
  LIBRARY_ROOM_NAME,
  NET,
  type NetPlayer,
  type ServerMessages,
  type StudyStatus,
} from "@ovr/shared";
import { useProfileStore } from "@/lib/avatar/profile";
import { fenwickAnsweredMe } from "@/lib/chat/fenwick";
import { cleanChatText, parseChatLine, parseHistory } from "@/lib/chat/format";
import { LineBucket, TypingSignal } from "@/lib/chat/pacing";
import {
  catchUpHistory,
  clearChatPresence,
  forgetPlayer,
  receiveLine,
  resetChat,
  setFenwickTyping,
  setHistory,
  setPlayerTyping,
} from "@/lib/chat/store";
import { faceState, useTrackingStore } from "@/lib/facial-tracking/tracker";
import { isFocusing, usePomodoro } from "@/lib/game/pomodoro";
import { runtime } from "@/lib/game/runtime";
import { useGameStore } from "@/lib/game/store";
import {
  clearRemotes,
  isSeatTakenByOther,
  removeRemote,
  setRemoteFace,
  upsertRemote,
} from "./players";
import {
  ChangeSender,
  type MoveMessage,
  copyFace,
  copyMove,
  faceChanged,
  moveChanged,
} from "./rate";

/*
 * The browser's live link to the library room (contract: packages/shared/src/net/protocol.ts).
 *
 * startMultiplayer() (the library experience calls it once you're in the library, not on the
 * title screen) asks the web app for a short-lived ticket (GET /api/net/ticket), joins the room
 * with it, and keeps the link up: the SDK rides out
 * short drops on its own (same session, within NET.RECONNECT_S); if the room is lost for good,
 * this rejoins with a fresh ticket, backing off up to 30 s. Without a game server configured it
 * stays "offline" and the library is simply solo.
 *
 * Every frame tickNet() sends where you are (at most NET.MOVE_HZ, only when it changed) and your
 * face while tracking is on (NET.FACE_HZ). Your avatar and study status go when they change.
 * Seats go through the server: requestSeat() asks for one and waits for "seat" or "seat_denied".
 *
 * The library chat (lib/chat/store.ts holds it, components/chat/ChatPanel.tsx shows it): lines
 * ("chat", and "chat_history" right after joining, which replaces the list, and again after a
 * reconnect, which only adds what was said meanwhile), who's typing (each player's `typing` in
 * the state) and Ms. Fenwick writing a reply ("fenwick_typing") go into the chat store;
 * sendChat() sends a line (never faster than the server's limit: lib/chat/pacing.ts LineBucket),
 * noteChatTyping() / stopChatTyping() say whether you're typing (TypingSignal), and
 * sendFenwickPref() tells the room when you flip "Ms. Fenwick answers if nobody does". Only the
 * game server posts her lines (`from: FENWICK_ID`); when one answers you (`replyTo` is your
 * sessionId), this browser alone says it aloud (lib/chat/fenwick.ts).
 */

export type NetStatus = "offline" | "connecting" | "online" | "full" | "error";

interface NetStore {
  status: NetStatus;
  /** People in the room, you included (0 when not online). */
  count: number;
  /** Your sessionId in the room, or null. */
  selfId: string | null;
  /** The name the ticket gave you (what everyone else sees above your head). */
  name: string | null;
}

export const useNet = create<NetStore>(() => ({
  status: "offline",
  count: 0,
  selfId: null,
  name: null,
}));

const TICKET_URL = "/api/net/ticket";
const SERVER_URL = process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "";
/** How long the room gets to answer a seat request before we sit anyway (it's probably down). */
const SEAT_TIMEOUT_MS = 3000;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 30_000;
/** A full library is worth checking again now and then, not every second. */
const FULL_RETRY_MS = 20_000;

export interface Ticket {
  ticket: string;
  expiresAt: number | string;
  name: string;
  signedIn: boolean;
}

/** Backoff before the n-th retry (1-based): 1 s, 2 s, 4 s … 30 s, ±20% so tabs don't sync up. */
export function retryDelay(attempt: number, random = Math.random) {
  const base = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(base * (0.8 + 0.4 * random()));
}

type LibraryRoom = Room<unknown, { players?: unknown }>;

let users = 0;
/** Bumped on stop: anything from an older run is ignored. */
let generation = 0;
let room: LibraryRoom | null = null;
let client: Client | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let attempt = 0;
/** Who this tab joined as (from its ticket), to notice a sign-in or sign-out in any tab. */
let joinedAs: { signedIn: boolean; name: string } | null = null;
let unsubscribers: (() => void)[] = [];

/** The seat the room last said "seat" to (before the state patch that shows it). */
let grantedSeat: string | null = null;
/** You, as the room's state has you (it may lag a patch behind, or miss a dropped message). */
const self = { seatId: "", status: "available" as StudyStatus };
/** When what the room has for you first stopped matching what you're doing (0: it matches). */
let mismatchSince = 0;
/** A mismatch this old is put right (a message was dropped by a rate limit, say). */
const RECONCILE_MS = 1500;
interface PendingSeat {
  seatId: string;
  resolve: (answer: SeatAnswer) => void;
  timer: ReturnType<typeof setTimeout>;
}
let pendingSeat: PendingSeat | null = null;

export type SeatAnswer =
  { ok: true; offline: boolean } | { ok: false; reason: ServerMessages["seat_denied"]["reason"] };

const setStatus = (status: NetStatus) => {
  if (useNet.getState().status !== status) useNet.setState({ status });
};

function send<K extends keyof ClientMessages>(type: K, payload: ClientMessages[K]) {
  if (!room || useNet.getState().status !== "online") return false;
  try {
    room.send(type, payload);
    return true;
  } catch {
    return false;
  }
}

/* ---- What we send ---- */

const moveSender = new ChangeSender<MoveMessage>(NET.MOVE_HZ, moveChanged, copyMove);
/** A still face is repeated every second: the server switches off a face quiet for 3 s. */
const FACE_KEEPALIVE_MS = 1000;
const faceSender = new ChangeSender<FacialParams | null>(
  NET.FACE_HZ,
  faceChanged,
  copyFace,
  FACE_KEEPALIVE_MS,
);
const move: MoveMessage = { x: 0, y: 0, z: 0, ry: 0, movement: "idle", speed: 0 };
const LIVE_TRACKING = new Set(["calibrating", "tracking", "no-face"]);

function readMove() {
  move.x = runtime.x;
  move.y = runtime.y;
  move.z = runtime.z;
  move.ry = runtime.facing;
  move.movement = runtime.movement;
  move.speed = runtime.movement === "idle" || runtime.movement === "sit" ? 0 : runtime.speed;
  return move;
}

/** Called every frame by the scene: sends what changed, when it's due. */
export function tickNet(now: number) {
  if (!room || useNet.getState().status !== "online") return;
  const m = readMove();
  if (moveSender.offer(now, m)) send("move", m);
  const tracking = LIVE_TRACKING.has(useTrackingStore.getState().status);
  const f = tracking ? faceState.params : null;
  if (faceSender.offer(now, f)) send("face", f);
  reconcile(now);
}

/**
 * Puts right what the room has for you if it stays wrong: a seat you left (or never got), or a
 * study status, whose message a rate limit dropped.
 */
function reconcile(now: number) {
  const local = useGameStore.getState().seatId ?? "";
  const seatOff = !pendingSeat && local !== self.seatId && grantedSeat !== local;
  const statusOff = sentStatus !== null && self.status !== localStatus();
  if (!seatOff && !statusOff) {
    mismatchSince = 0;
    return;
  }
  if (!mismatchSince) mismatchSince = now;
  if (now - mismatchSince < RECONCILE_MS) return;
  mismatchSince = now;
  if (seatOff && !local) send("stand", {});
  else if (seatOff) syncSeat();
  if (statusOff) sendStatus(true);
}

let sentAvatar = "";
function sendAvatar(force = false) {
  const json = JSON.stringify(useProfileStore.getState().avatar);
  if (!force && json === sentAvatar) return;
  if (send("avatar", { avatar: json })) sentAvatar = json;
}

/**
 * Your study status, as others see it: locked in during a pomodoro, away while the tab is hidden
 * or you're in the character studio, otherwise open to talk.
 */
export function localStatus(): StudyStatus {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return "away";
  if (useGameStore.getState().phase === "creator") return "away";
  return isFocusing(usePomodoro.getState()) ? "focused" : "available";
}

let sentStatus: StudyStatus | null = null;
function sendStatus(force = false) {
  const status = localStatus();
  if (!force && status === sentStatus) return;
  if (send("status", { status })) sentStatus = status;
}

/** Everything about you, after joining (or rejoining). */
function sendAll() {
  moveSender.reset();
  faceSender.reset();
  sendAvatar(true);
  sendStatus(true);
  tickNet(performance.now());
}

/* ---- Chat ---- */

const typingSignal = new TypingSignal((on) => send("typing", { on }));
const lineBucket = new LineBucket();

export type ChatSend = "sent" | "empty" | "offline" | "slow";

/**
 * Sends a line to everyone in the room (it shows once the server echoes it back). `fenwick:
 * false` when you've switched off "Ms. Fenwick answers if nobody does".
 */
export function sendChat(text: string, fenwick: boolean): ChatSend {
  const clean = cleanChatText(text);
  if (!clean) return "empty";
  if (!room || useNet.getState().status !== "online") return "offline";
  const now = performance.now();
  if (!lineBucket.take(now)) return "slow";
  if (!send("chat", { text: clean, fenwick })) return "offline";
  typingSignal.stop(now);
  return "sent";
}

/** The chat box changed: tells the room you're typing (or not, once it's empty), when due. */
export function noteChatTyping(text: string) {
  typingSignal.input(text, performance.now());
}

/** You left the chat box (or sent the line): you're not typing any more. */
export function stopChatTyping() {
  typingSignal.stop(performance.now());
}

/**
 * "Ms. Fenwick answers if nobody does" flipped: off cancels her wait on your latest line (and a
 * reply she's still writing to you). Offline, nothing to cancel; your next line carries it.
 */
export function sendFenwickPref(on: boolean) {
  send("chat_pref", { fenwick: on });
}

/** Everyone's `typing`, read again from the state (after a reconnect). */
function readTyping(r: LibraryRoom) {
  const players = (r.state as { players?: { forEach?: unknown } } | undefined)?.players;
  if (!players || typeof players.forEach !== "function") return;
  (players.forEach as (cb: (p: NetPlayer, id: string) => void) => void)((p, id) => {
    if (id !== r.sessionId) setPlayerTyping(id, p.typing === true);
  });
}

/* ---- Seats ---- */

function settleSeat(seatId: string, answer: SeatAnswer) {
  if (!pendingSeat || pendingSeat.seatId !== seatId) return;
  const { resolve, timer } = pendingSeat;
  clearTimeout(timer);
  pendingSeat = null;
  resolve(answer);
}

/**
 * Ask the room for a seat. `ok` once the room says "seat" (or, offline, straight away: alone
 * there's no one to clash with); `ok: false` when someone's in it (we can see them, or the server
 * says so) or the server refuses.
 */
export function requestSeat(seatId: string): Promise<SeatAnswer> {
  if (isSeatTakenByOther(seatId)) return Promise.resolve({ ok: false, reason: "taken" });
  if (!room || useNet.getState().status !== "online")
    return Promise.resolve({ ok: true, offline: true });
  // One question at a time: an older one is dropped.
  if (pendingSeat) settleSeat(pendingSeat.seatId, { ok: false, reason: "unknown_seat" });
  return new Promise<SeatAnswer>((resolve) => {
    const timer = setTimeout(
      () => settleSeat(seatId, { ok: true, offline: true }),
      SEAT_TIMEOUT_MS,
    );
    pendingSeat = { seatId, resolve, timer };
    // The server checks you're near the seat: make sure it knows where you are.
    const m = readMove();
    if (moveSender.offer(performance.now(), m)) send("move", m);
    if (!send("sit", { seatId })) settleSeat(seatId, { ok: true, offline: true });
  });
}

export const isOnline = () => !!room && useNet.getState().status === "online";

/** A seat the room gave us that we didn't sit in after all (walked off meanwhile): give it back. */
export function cancelSeat(seatId: string) {
  const ours = grantedSeat === seatId || self.seatId === seatId;
  if (ours && useGameStore.getState().seatId !== seatId) releaseSeat();
}

/** You stood up (however it happened): give the seat back. */
function releaseSeat() {
  if (!grantedSeat && !self.seatId) return;
  grantedSeat = null;
  send("stand", {});
}

/** Called when a seat you're already in turns out to be someone else's. */
let onSeatLost: (seatId: string) => void = () => {};
export function setSeatLostHandler(handler: (seatId: string) => void) {
  onSeatLost = handler;
}

/**
 * After (re)joining while seated (you sat down while the link was down): claim that seat now. If
 * someone else got it meanwhile, you get up.
 */
function syncSeat() {
  const seatId = useGameStore.getState().seatId;
  if (!seatId || self.seatId === seatId || pendingSeat) return;
  void requestSeat(seatId).then((answer) => {
    if (useGameStore.getState().seatId !== seatId) {
      // Stood up while we asked: give it straight back.
      if (answer.ok && !answer.offline) releaseSeat();
      return;
    }
    if (!answer.ok && answer.reason === "taken") onSeatLost(seatId);
  });
}

/* ---- The room ---- */

function updateCount() {
  const players = (room?.state as { players?: { size?: number } } | undefined)?.players;
  const count = useNet.getState().status === "online" ? (players?.size ?? 1) : 0;
  if (useNet.getState().count !== count) useNet.setState({ count });
}

function attach(r: LibraryRoom, gen: number) {
  room = r;
  grantedSeat = null;
  self.seatId = "";
  self.status = "available";
  mismatchSince = 0;
  useNet.setState({ selfId: r.sessionId });
  // Our own drop/rejoin logic does the long waits; the SDK covers short drops within the
  // server's reconnection window.
  r.reconnection.maxRetries = 8;
  r.reconnection.maxDelay = 4000;

  r.onMessage("seat", (msg: ServerMessages["seat"]) => {
    if (typeof msg?.seatId !== "string") return;
    grantedSeat = msg.seatId;
    settleSeat(msg.seatId, { ok: true, offline: false });
  });
  r.onMessage("seat_denied", (msg: ServerMessages["seat_denied"]) => {
    if (typeof msg?.seatId !== "string") return;
    settleSeat(msg.seatId, { ok: false, reason: msg.reason ?? "taken" });
  });
  r.onMessage("face", (msg: ServerMessages["face"]) => {
    if (typeof msg?.from === "string" && msg.from !== r.sessionId)
      setRemoteFace(msg.from, msg.params);
  });
  r.onMessage("chat", (msg: ServerMessages["chat"]) => {
    if (room !== r) return;
    const line = parseChatLine(msg);
    if (!line || !receiveLine(line, r.sessionId)) return;
    if (line.from === FENWICK_ID && line.replyTo === r.sessionId) fenwickAnsweredMe(line);
  });
  // Right after joining it replaces the list; after a reconnect it fills in what was missed.
  let rejoined = false;
  r.onMessage("chat_history", (msg: ServerMessages["chat_history"]) => {
    if (room !== r) return;
    if (rejoined) catchUpHistory(parseHistory(msg), r.sessionId);
    else setHistory(parseHistory(msg));
  });
  r.onMessage("fenwick_typing", (msg: ServerMessages["fenwick_typing"]) => {
    if (room !== r || typeof msg?.to !== "string" || !msg.to) return;
    setFenwickTyping(msg.on === true, msg.to);
  });

  const callbacks = Callbacks.get(r as never) as unknown as {
    onAdd: (prop: string, cb: (value: NetPlayer, key: string) => void) => () => void;
    onRemove: (prop: string, cb: (value: NetPlayer, key: string) => void) => () => void;
    onChange: (instance: NetPlayer, cb: () => void) => () => void;
  };
  callbacks.onAdd("players", (player, sessionId) => {
    updateCount();
    if (sessionId === r.sessionId) {
      const read = () => {
        self.seatId = typeof player.seatId === "string" ? player.seatId : "";
        self.status = player.status;
        // The state now shows the seat the room granted; until then that answer stands in.
        if (grantedSeat && self.seatId === grantedSeat) grantedSeat = null;
      };
      read();
      callbacks.onChange(player, () => room === r && read());
      return;
    }
    upsertRemote(sessionId, player, performance.now());
    setPlayerTyping(sessionId, player.typing === true);
    callbacks.onChange(player, () => {
      if (room !== r) return;
      upsertRemote(sessionId, player, performance.now());
      setPlayerTyping(sessionId, player.typing === true);
    });
  });
  callbacks.onRemove("players", (_player, sessionId) => {
    updateCount();
    removeRemote(sessionId);
    forgetPlayer(sessionId);
  });

  r.onDrop(() => {
    if (gen !== generation) return;
    setStatus("connecting");
    updateCount();
    // Nobody's typing can be seen meanwhile; the room forgets yours.
    clearChatPresence();
    typingSignal.reset();
  });
  r.onReconnect(() => {
    if (gen !== generation) return;
    rejoined = true;
    setStatus("online");
    updateCount();
    sendAll();
    syncSeat();
    readTyping(r);
  });
  r.onLeave(() => {
    if (room === r) detach();
    // Lost for good (the server restarted, or the reconnection window passed): join again.
    if (gen === generation) scheduleRetry(gen, "error");
  });
  r.onError((code, message) => {
    console.warn("[net] room error", code, message);
  });

  setStatus("online");
  attempt = 0;
  updateCount();
  sendAll();
  syncSeat();
}

function detach() {
  room = null;
  grantedSeat = null;
  if (pendingSeat) settleSeat(pendingSeat.seatId, { ok: true, offline: true });
  clearRemotes();
  clearChatPresence();
  typingSignal.reset();
  useNet.setState({ selfId: null, count: 0 });
}

function scheduleRetry(gen: number, status: NetStatus) {
  if (gen !== generation) return;
  setStatus(status);
  if (retryTimer) clearTimeout(retryTimer);
  attempt += 1;
  const delay =
    status === "full" ? Math.max(FULL_RETRY_MS, retryDelay(attempt)) : retryDelay(attempt);
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void connect(gen);
  }, delay);
}

async function fetchTicket(): Promise<Ticket | "not_configured"> {
  const res = await fetch(TICKET_URL, { cache: "no-store", credentials: "same-origin" });
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
    if (body?.error?.code === "multiplayer_not_configured") return "not_configured";
    throw new Error("ticket service unavailable");
  }
  if (!res.ok) throw new Error(`ticket ${res.status}`);
  const body = (await res.json()) as Partial<Ticket> | null;
  if (!body || typeof body.ticket !== "string" || !body.ticket)
    throw new Error("ticket missing from response");
  return {
    ticket: body.ticket,
    expiresAt: body.expiresAt ?? 0,
    name: typeof body.name === "string" ? body.name : "",
    signedIn: body.signedIn === true,
  };
}

/** Whether a failed join means every library room is full. */
function isFull(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\bfull\b|locked/i.test(message);
}

async function connect(gen: number) {
  if (gen !== generation || room) return;
  if (!SERVER_URL) return setStatus("offline");
  setStatus("connecting");
  let ticket: Ticket | "not_configured";
  try {
    ticket = await fetchTicket();
  } catch {
    return scheduleRetry(gen, "error");
  }
  if (gen !== generation) return;
  if (ticket === "not_configured") return setStatus("offline");
  useNet.setState({ name: ticket.name || null });
  joinedAs = { signedIn: ticket.signedIn, name: ticket.name };
  try {
    client ??= new Client(SERVER_URL);
    const options: JoinOptions = { ticket: ticket.ticket };
    const joined = (await client.joinOrCreate(LIBRARY_ROOM_NAME, options)) as LibraryRoom;
    if (gen !== generation) {
      void joined.leave();
      return;
    }
    attach(joined, gen);
  } catch (error) {
    if (gen !== generation) return;
    scheduleRetry(gen, isFull(error) ? "full" : "error");
  }
}

/** If this tab's player was joined as someone else (guest vs signed in), rejoin as who you are now. */
async function rejoinIfAccountChanged() {
  const was = joinedAs;
  if (!room || !was) return;
  try {
    const res = await fetch("/api/account", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return;
    const now = (await res.json()) as { signedIn?: boolean; displayName?: string | null };
    if (!!now.signedIn === was.signedIn) return;
  } catch {
    return;
  }
  if (joinedAs !== was || !room) return;
  const r = room;
  detach();
  try {
    r.send("bye", {});
  } catch {
    // already closing
  }
  void r.leave();
  attempt = 0;
  void connect(generation);
}

/** Retry now rather than at the end of the backoff (the network or the tab came back). */
function retrySoon() {
  if (room || !retryTimer || users === 0) return;
  clearTimeout(retryTimer);
  retryTimer = null;
  void connect(generation);
}

function watchLocalState() {
  const offProfile = useProfileStore.subscribe((s, prev) => {
    if (s.avatar !== prev.avatar) sendAvatar();
  });
  const offPomodoro = usePomodoro.subscribe((s, prev) => {
    if (s.phase !== prev.phase) sendStatus();
  });
  const offGame = useGameStore.subscribe((s, prev) => {
    if (prev.seatId && s.seatId !== prev.seatId) releaseSeat();
    if (s.phase !== prev.phase) sendStatus();
  });
  const onVisibility = () => {
    sendStatus();
    if (document.visibilityState === "visible") retrySoon();
  };
  const onOnline = () => retrySoon();
  // Leaving the page (closing it, or going to sign in): say "bye" first so the server drops you
  // at once instead of holding your player for a reconnect, then leave.
  const onPageHide = () => {
    if (!room) return;
    try {
      room.send("bye", {});
    } catch {
      // The socket is already going; the reconnect hold covers it.
    }
    void room.leave();
  };
  // Signed in (or out) in another tab, or came back from the sign-in page in this one: if who
  // you are changed, rejoin as the new you, so the old guest doesn't stay in the room.
  const onFocusCheck = () => {
    if (document.visibilityState === "visible") void rejoinIfAccountChanged();
  };
  window.addEventListener("focus", onFocusCheck);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("online", onOnline);
  window.addEventListener("pagehide", onPageHide);
  return [
    offProfile,
    offPomodoro,
    offGame,
    () => document.removeEventListener("visibilitychange", onVisibility),
    () => window.removeEventListener("online", onOnline),
    () => window.removeEventListener("pagehide", onPageHide),
    () => window.removeEventListener("focus", onFocusCheck),
  ];
}

/** Joins the library room and keeps the link up; the returned function leaves. */
export function startMultiplayer(): () => void {
  users += 1;
  if (users === 1) {
    generation += 1;
    attempt = 0;
    unsubscribers = watchLocalState();
    void connect(generation);
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    users -= 1;
    if (users > 0) return;
    generation += 1;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
    for (const off of unsubscribers) off();
    unsubscribers = [];
    const r = room;
    detach();
    if (r) void r.leave();
    sentAvatar = "";
    sentStatus = null;
    resetChat();
    useNet.setState({ status: "offline", count: 0, selfId: null });
  };
}
