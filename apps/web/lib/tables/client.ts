"use client";

import { useEffect } from "react";
import { create } from "zustand";
import { SEATS } from "@ovr/shared";
import { type ApiError, asApiError, getJson, send } from "@/components/circles/api";
import type { CircleSummary } from "@/lib/circles/types";
import { useGameStore } from "@/lib/game/store";
import { isDemoOn } from "@/lib/demo/mode";
import { holdMinutes, holdNoun, holdText, warnMinutes } from "@/lib/demo/settings";
import { clockOffset, msLeft, shouldWarn } from "./time";
import {
  HOLD_MINUTES,
  type SitResult,
  type TableEmailInvite,
  type TableInvitation,
  type TableStatus,
  type TableVisibility,
  type TablesView,
} from "./types";

/*
 * The library's side of reservable tables (contract: lib/tables/types.ts). One store keeps every
 * table's public status (GET /api/tables every 30 s, when the tab comes back, and after each
 * change), plus what the table cards show: the "you're the first here" offer, the "reserved"
 * card, the 5-minute warning and "time's up". The server decides who may sit; this only asks,
 * and shows its answers. Nothing here holds a learner id, an email or a guest list: the holder's
 * email invites come back from the server masked, and what the holder types goes straight to it.
 * In the judge demo (lib/demo) a new hold asks the server for DEMO_HOLD_MINUTES (it can only ever
 * shorten one) and its "nearly up" notice comes DEMO_WARN_MINUTES before the end.
 */

export const REFRESH_MS = 30_000;
/** While holding a table, the page checks in this often (the server lets go after ~2.5 min quiet). */
export const HEARTBEAT_MS = 20_000;
/** How long the server gets to answer "can I sit here?" before the last known status is used. */
const SIT_TIMEOUT_MS = 4000;
/** Toasts (the 5-minute warning, "it's yours") stay up this long. */
export const TOAST_MS = 8000;
/** The time's-up and reserved cards step aside after this. */
export const CARD_MS = 30_000;

/** Every table a student can hold: the tables the plan's seats belong to. */
export const TABLE_IDS: readonly string[] = [
  ...new Set(SEATS.flatMap((s) => (s.tableId ? [s.tableId] : []))),
];
const TABLE_SET = new Set(TABLE_IDS);

export const isReservable = (tableId: string | null | undefined): tableId is string =>
  !!tableId && TABLE_SET.has(tableId);

/** "Table 3", "Gallery desk 2": what the cards and the 3D sign call a table. */
export function tableName(tableId: string) {
  const n = Number(/(\d+)$/.exec(tableId)?.[1] ?? 0);
  return tableId.startsWith("gallery-desk") ? `Gallery desk ${n}` : `Table ${n}`;
}

/** How long a hold lasts, in words: "1 hour", "90 minutes". */
export const HOLD_TEXT = holdText(HOLD_MINUTES);
/** "Your hour at Table 3", "your 90 minutes at Table 3". */
export const HOLD_NOUN = holdNoun(HOLD_MINUTES);
/** A new hold's length here and now (the judge demo's is short), in words and as a noun. */
export const holdTextNow = () => holdText(holdMinutes(isDemoOn()));
export const holdNounNow = () => holdNoun(holdMinutes(isDemoOn()));
/** How long before the end the holder hears "nearly up" (ms). */
export const warnMsNow = () => warnMinutes(isDemoOn()) * 60_000;

/** "3:42 PM", in the student's own clock. */
export function clockTime(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** A hold's identity, so its warning and time's-up are shown once each. */
export const holdKey = (s: Pick<TableStatus, "tableId" | "endsAt">) => `${s.tableId}@${s.endsAt}`;

/** A table nobody holds (what a hold becomes when its time runs out). */
export function freeStatus(tableId: string): TableStatus {
  return {
    tableId,
    held: false,
    visibility: null,
    holderName: null,
    endsAt: null,
    canSit: true,
    mine: false,
    access: "free",
    circleName: null,
  };
}

export type CirclesList =
  | { status: "idle" | "loading" }
  | { status: "ready"; circles: CircleSummary[] }
  | { status: "error"; message: string };

export interface TableToast {
  id: number;
  text: string;
  at: number;
}

export interface BlockedCard {
  status: TableStatus;
  reason: "private" | "sign_in_required";
  message: string;
  at: number;
}

interface TablesStore {
  view: TablesView | null;
  /** Add to Date.now() for the server's clock. */
  offsetMs: number;
  /** You sat down first here: the claim card offers to hold it. */
  offer: string | null;
  /** You just made this table private: the claim card asks who can join. */
  setup: string | null;
  /** The server said no to sitting here. */
  blocked: BlockedCard | null;
  /** Your hold ran out (shown once, never mid-anything). */
  timeUp: { tableId: string; at: number } | null;
  toast: TableToast | null;
  /** The action in flight ("claim", "visibility", "circle", "invite", "release"). */
  busy: string | null;
  /** What went wrong with the last change, as the server put it. */
  error: string | null;
  /** The invite link made for the current hold, to show again after copying. */
  invite: { key: string; link: string } | null;
  /** The circle picked for the current hold (the status only carries its name). */
  circle: { key: string; id: string | null } | null;
  circles: CirclesList;
  /** Invitations (by email) already put away, by invitationKey. */
  invitesSeen: string[];
  /** The invitation whose "Show me" was pressed (its table name is highlighted). */
  highlighted: string | null;
  /** Leaving the table you hold gives it up: asked first ("then" runs once they've left). */
  leaving: { tableId: string; then: (() => void) | null } | null;
}

export const useTables = create<TablesStore>(() => ({
  view: null,
  offsetMs: 0,
  offer: null,
  setup: null,
  blocked: null,
  timeUp: null,
  toast: null,
  busy: null,
  error: null,
  invite: null,
  circle: null,
  circles: { status: "idle" },
  invitesSeen: [],
  highlighted: null,
  leaving: null,
}));

/** The server's clock, as best we know it. */
export const serverNow = () => Date.now() + useTables.getState().offsetMs;

/** Puts one table's fresh status into the view (and `mine` with it). */
export function mergeStatus(view: TablesView, status: TableStatus): TablesView {
  const tables = view.tables.some((t) => t.tableId === status.tableId)
    ? view.tables.map((t) => (t.tableId === status.tableId ? status : t))
    : [...view.tables, status];
  const mine = status.mine ? status : view.mine?.tableId === status.tableId ? null : view.mine;
  return { ...view, tables, mine };
}

function applyStatus(status: TableStatus) {
  const { view } = useTables.getState();
  if (view) useTables.setState({ view: mergeStatus(view, status) });
}

/** The last known status of a table (null before the first answer). */
export function statusOf(tableId: string): TableStatus | null {
  return useTables.getState().view?.tables.find((t) => t.tableId === tableId) ?? null;
}

function isTablesView(v: unknown): v is TablesView {
  const b = v as Partial<TablesView> | null;
  return !!b && Array.isArray(b.tables) && typeof b.serverTime === "string";
}

let inFlight: Promise<void> | null = null;

/** Asks for every table's status again. Failures are silent: the last view stays. */
export function refreshTables(): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = getJson<unknown>("/api/tables")
    .then((body) => {
      if (!isTablesView(body)) return;
      useTables.setState({ view: body, offsetMs: clockOffset(body.serverTime) });
      checkClock();
    })
    .catch(() => {})
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

const tableUrl = (tableId: string, action?: string) =>
  `/api/tables/${encodeURIComponent(tableId)}${action ? `/${action}` : ""}`;

/**
 * "Can I sit here?" The server's answer, or (offline, or slow to answer) one worked out from the
 * last status we heard: blocked if it said we couldn't sit, otherwise yes, but not as the first
 * here, since a claim would need the server anyway.
 */
export async function askToSit(tableId: string): Promise<SitResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SIT_TIMEOUT_MS);
  try {
    const res = await fetch(tableUrl(tableId, "sit"), {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      signal: ctrl.signal,
    });
    const raw: unknown = await res.json().catch(() => null);
    const body = raw as SitResult | null;
    if (body && typeof body === "object" && "ok" in body && body.status) {
      applyStatus(body.status);
      return body;
    }
    // A refusal in the usual error shape instead: trust the code, and the server's words.
    if (res.status === 403 || res.status === 401) {
      const error = (raw as { error?: { message?: unknown } } | null)?.error;
      return {
        ok: false,
        status: statusOf(tableId) ?? freeStatus(tableId),
        reason: res.status === 401 ? "sign_in_required" : "private",
        message: typeof error?.message === "string" ? error.message : "",
      };
    }
  } catch {
    // Offline or too slow: fall through to the last known status.
  } finally {
    clearTimeout(timer);
  }
  const known = statusOf(tableId);
  if (known && !known.canSit && msLeft(known.endsAt, serverNow()) > 0)
    return { ok: false, status: known, reason: "private", message: "" };
  return { ok: true, status: known ?? freeStatus(tableId), firstHere: false };
}

/* ---- What the cards show ---- */

let toastId = 0;
export function showToast(text: string) {
  toastId += 1;
  useTables.setState({ toast: { id: toastId, text, at: Date.now() } });
}

/**
 * You sat down first at a free table: offer to hold it. One table at a time, so while you hold
 * another, you just sit (and a word says why there's no offer).
 */
export function offerClaim(tableId: string) {
  const mine = useTables.getState().view?.mine;
  if (mine && mine.tableId !== tableId && msLeft(mine.endsAt, serverNow()) > 0) {
    showToast(
      `You're holding ${tableName(mine.tableId)} until ${clockTime(mine.endsAt)}. You can hold one table at a time.`,
    );
    return;
  }
  useTables.setState({ offer: tableId, setup: null, blocked: null, error: null });
}

export function dismissOffer() {
  useTables.setState({ offer: null, setup: null, error: null });
}

/** The server said no: show who has it and until when. */
export function showReserved(result: Extract<SitResult, { ok: false }>) {
  useTables.setState({
    blocked: {
      status: result.status,
      reason: result.reason,
      message: result.message,
      at: Date.now(),
    },
  });
}

export function dismissReserved() {
  useTables.setState({ blocked: null });
}

export function dismissTimeUp() {
  useTables.setState({ timeUp: null });
}

export const clearTableError = () => useTables.setState({ error: null });

/* ---- Changes (the holder's) ---- */

async function run<T>(busy: string, work: () => Promise<T>): Promise<T | null> {
  if (useTables.getState().busy) return null;
  useTables.setState({ busy, error: null });
  try {
    return await work();
  } catch (err) {
    const e = asApiError(err);
    useTables.setState({ error: e.message });
    // Someone else got there first, or the hold ended: show the table as it is now.
    if (e.status === 404 || e.status === 409) void refreshTables();
    return null;
  } finally {
    useTables.setState({ busy: null });
  }
}

/** Hold the table you're sitting at, open or private, for HOLD_MINUTES (the demo: shorter). */
export function claimTable(tableId: string, visibility: TableVisibility) {
  return run("claim", async () => {
    const status = await send<TableStatus>(
      "POST",
      tableUrl(tableId, "claim"),
      isDemoOn() ? { visibility, minutes: holdMinutes(true) } : { visibility },
    );
    applyStatus(status);
    // Claiming a table you already hold changes nothing on the server, so go by its answer.
    const isPrivate = status.visibility === "private";
    useTables.setState({
      offer: null,
      setup: isPrivate ? tableId : null,
      invite: null,
      // A new hold has no circle; one you already held keeps its own (the picker finds it by name).
      circle: status.circleName ? null : { key: holdKey(status), id: null },
    });
    if (!isPrivate) showToast(`${tableName(tableId)} is yours until ${clockTime(status.endsAt)}.`);
    return status;
  });
}

export function setVisibility(tableId: string, visibility: TableVisibility) {
  return run("visibility", async () => {
    const status = await send<TableStatus>("PATCH", tableUrl(tableId), { visibility });
    applyStatus(status);
    return status;
  });
}

/** Let the members of one of your Study Circles sit here (null: nobody but your guests). */
export function setCircle(tableId: string, circleId: string | null) {
  return run("circle", async () => {
    const status = await send<TableStatus>("PATCH", tableUrl(tableId), { circleId });
    applyStatus(status);
    useTables.setState({ circle: { key: holdKey(status), id: circleId } });
    return status;
  });
}

/** A fresh invite link for your private table (valid for this hold only). */
export function makeInvite(tableId: string) {
  return run("invite", async () => {
    const out = await send<{ link: string; path: string; expiresAt: string }>(
      "POST",
      tableUrl(tableId, "invite"),
    );
    const link = out.link || `${window.location.origin}${out.path}`;
    const mine = useTables.getState().view?.mine;
    useTables.setState({
      invite: { key: mine ? holdKey(mine) : tableId, link },
    });
    return link;
  });
}

/** Changes the holder's list of email invites in the view (the server has already agreed). */
function patchEmailInvites(
  tableId: string,
  change: (list: TableEmailInvite[]) => TableEmailInvite[],
) {
  const mine = useTables.getState().view?.mine;
  if (mine?.tableId === tableId)
    applyStatus({ ...mine, emailInvites: change(mine.emailInvites ?? []) });
}

/**
 * Invite someone to your private table by the email they signed up with. The server answers the
 * same whether or not anyone has that address; they'll see it when they sign in with it.
 */
export function inviteByEmail(tableId: string, email: string) {
  return run("email", async () => {
    const { invite } = await send<{ invite: TableEmailInvite }>(
      "POST",
      tableUrl(tableId, "email-invites"),
      { email },
    );
    patchEmailInvites(tableId, (list) =>
      list.some((i) => i.id === invite.id)
        ? list.map((i) => (i.id === invite.id ? invite : i))
        : [...list, invite],
    );
    return invite;
  });
}

/** Take an email invite back: from now on that address can't sit here. */
export function removeEmailInvite(tableId: string, inviteId: string) {
  return run(`email-remove:${inviteId}`, async () => {
    await send<{ ok: true }>(
      "DELETE",
      `${tableUrl(tableId, "email-invites")}/${encodeURIComponent(inviteId)}`,
    );
    patchEmailInvites(tableId, (list) => list.filter((i) => i.id !== inviteId));
    return true;
  });
}

/* ---- Invitations to other people's tables ---- */

/** An invitation's identity (one per hold), so putting it away lasts until a new hold. */
export const invitationKey = (i: Pick<TableInvitation, "tableId" | "endsAt">) =>
  `${i.tableId}@${i.endsAt}`;

/** The first invitation still running that hasn't been put away (null: none to show). */
export function pendingInvitation(
  view: TablesView | null,
  seen: readonly string[],
  now = serverNow(),
): TableInvitation | null {
  return (
    view?.invitedTo?.find((i) => !seen.includes(invitationKey(i)) && msLeft(i.endsAt, now) > 0) ??
    null
  );
}

/** "Show me": highlights the table's name on the invitation (it walks you nowhere). */
export function highlightInvitation(key: string) {
  useTables.setState({ highlighted: key });
}

export function dismissInvitation(key: string) {
  const { invitesSeen, highlighted } = useTables.getState();
  useTables.setState({
    invitesSeen: invitesSeen.includes(key) ? invitesSeen : [...invitesSeen, key].slice(-50),
    highlighted: highlighted === key ? null : highlighted,
  });
}

/** The table you're holding right now, if it hasn't run out. */
export function heldTableId(): string | null {
  const mine = useTables.getState().view?.mine;
  return mine?.mine && mine.endsAt && msLeft(mine.endsAt) > 0 ? mine.tableId : null;
}

/** Leaving the table you hold gives it up, so ask first (once; repeat asks are ignored). */
export function askToLeave(tableId: string, then: (() => void) | null = null) {
  if (useTables.getState().leaving) return;
  useTables.setState({ leaving: { tableId, then } });
}

export function cancelLeave() {
  useTables.setState({ leaving: null });
}

/** Give the table up early: it's open again for anyone. */
export function releaseTable(tableId: string) {
  return run("release", async () => {
    await send<{ ok: true }>("POST", tableUrl(tableId, "release"));
    applyStatus(freeStatus(tableId));
    useTables.setState({ setup: null, invite: null, circle: null, timeUp: null });
    showToast(`You gave up ${tableName(tableId)}. It's open again.`);
    return true;
  });
}

/** The join page: accept an invite link (signed in). */
export function joinTable(token: string) {
  return send<{ tableId: string; status: TableStatus }>("POST", "/api/tables/join", { token });
}

export type { ApiError };

/** Your Study Circles, for "let members of … sit here" (loaded when first asked for). */
export function loadCircles(force = false) {
  const { circles } = useTables.getState();
  if (!force && (circles.status === "loading" || circles.status === "ready")) return;
  useTables.setState({ circles: { status: "loading" } });
  getJson<{ circles: CircleSummary[] }>("/api/circles/mine").then(
    (body) =>
      useTables.setState({
        circles: { status: "ready", circles: Array.isArray(body.circles) ? body.circles : [] },
      }),
    (err: unknown) =>
      useTables.setState({ circles: { status: "error", message: asApiError(err).message } }),
  );
}

/* ---- The clock: the 5-minute warning and time's up ---- */

/** Holds already warned about, and those whose time's-up was shown (once each). */
const warned = new Set<string>();
const ended = new Set<string>();
/** The last hold we saw as ours and still running. */
let lastMine: TableStatus | null = null;

let soon: ReturnType<typeof setTimeout> | null = null;
let lastSoonAt = 0;
/** A refresh shortly after a hold ran out (at most every 10 s, whatever the server says). */
function refreshSoon() {
  if (soon || Date.now() - lastSoonAt < 10_000) return;
  soon = setTimeout(() => {
    soon = null;
    lastSoonAt = Date.now();
    void refreshTables();
  }, 1500);
}

/**
 * Once a second (and after every refresh): warn the holder WARN_MINUTES before the end, say
 * "time's up" once when it ends, and show any other hold that ran out as free. Never stands
 * anyone up or touches a pomodoro.
 */
export function checkClock(now = serverNow()) {
  const s = useTables.getState();
  const wall = Date.now();
  const patch: Partial<TablesStore> = {};
  if (s.toast && wall - s.toast.at > TOAST_MS) patch.toast = null;
  if (s.timeUp && wall - s.timeUp.at > CARD_MS) patch.timeUp = null;
  if (s.blocked && wall - s.blocked.at > CARD_MS) patch.blocked = null;

  const view = s.view;
  if (view) {
    const mine = view.mine;
    const running = (t: TableStatus | null) => !!t && (!t.endsAt || msLeft(t.endsAt, now) > 0);
    let timeUpFor: string | null = null;
    if (mine && running(mine)) {
      lastMine = mine;
      const key = holdKey(mine);
      if (mine.endsAt && shouldWarn(mine.endsAt, now, warnMsNow()) && !warned.has(key)) {
        warned.add(key);
        const left = Math.max(1, Math.ceil(msLeft(mine.endsAt, now) / 60_000));
        toastId += 1;
        patch.toast = {
          id: toastId,
          text: `${left === 1 ? "1 minute" : `${left} minutes`} left at ${tableName(mine.tableId)}. It opens to everyone at ${clockTime(mine.endsAt)}.`,
          at: wall,
        };
      }
    } else {
      // Ours and over, or a hold the server stopped calling ours. Time's up only if the hour
      // really ran out (not when it was given up).
      const gone = mine ?? lastMine;
      if (gone?.endsAt && msLeft(gone.endsAt, now) <= 1000 && !ended.has(holdKey(gone))) {
        ended.add(holdKey(gone));
        timeUpFor = gone.tableId;
      }
      lastMine = null;
    }

    // Holds that ran out are simply over: show those tables as free until the next refresh.
    let expired = false;
    const tables = view.tables.map((t) => {
      if (t.held && !running(t)) {
        expired = true;
        return freeStatus(t.tableId);
      }
      return t;
    });
    if (expired || timeUpFor || (mine && !running(mine))) {
      patch.view = { ...view, tables, mine: running(mine) ? mine : null };
      refreshSoon();
    }
    if (timeUpFor) {
      patch.timeUp = { tableId: timeUpFor, at: wall };
      patch.setup = null;
      patch.invite = null;
      patch.circle = null;
    }
  }
  if (Object.keys(patch).length) useTables.setState(patch);
}

/**
 * Keeps the tables fresh while the library is open: every 30 s, when the tab or window comes
 * back, and a clock each second for the holder's notices.
 */
/** Whether you're sitting at `tableId` right now. */
function seatedAt(tableId: string) {
  const seatId = useGameStore.getState().seatId;
  return !!seatId && SEATS.some((s) => s.id === seatId && s.tableId === tableId);
}

/**
 * "I'm still here": while you hold a table, tells the server you're still seated at it (or gives
 * it up if you're not). If the server says the hold is gone (you were away too long), says so.
 */
async function heartbeat() {
  const held = heldTableId();
  if (!held) return;
  try {
    await send("POST", tableUrl(held, "heartbeat"), { seated: seatedAt(held) });
  } catch (e) {
    if (asApiError(e)?.status === 404) {
      await refreshTables();
      showToast(`You were away too long, so ${tableName(held)} was given up.`);
    }
  }
}

/**
 * Leaving the page (closing the tab, reloading, going elsewhere) gives your table up at once. A
 * keepalive request still goes out while the page unloads; if even that can't, the server lets
 * the table go once the page stops checking in.
 */
function releaseOnUnload() {
  const held = heldTableId();
  if (!held) return;
  try {
    void fetch(tableUrl(held, "release"), {
      method: "POST",
      keepalive: true,
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  } catch {
    // The page is going away; the presence timeout covers this.
  }
}

export function useTablesLive() {
  useEffect(() => {
    const beat = setInterval(() => void heartbeat(), HEARTBEAT_MS);
    window.addEventListener("pagehide", releaseOnUnload);
    return () => {
      clearInterval(beat);
      window.removeEventListener("pagehide", releaseOnUnload);
    };
  }, []);
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "hidden") void refreshTables();
    };
    const onVisible = () => document.visibilityState === "visible" && run();
    run();
    const poll = setInterval(run, REFRESH_MS);
    const clock = setInterval(() => checkClock(), 1000);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(poll);
      clearInterval(clock);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}

/** Error codes worth a special word on the join page. */
export const isSignInError = (e: ApiError | null | undefined) =>
  e?.code === "sign_in_required" || e?.code === "auth_not_configured";
