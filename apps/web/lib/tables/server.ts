import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { SEATS } from "@ovr/shared";
import type postgres from "postgres";
import { hashEmail, maskEmail } from "@/lib/auth/emailHash";
import { hashInviteToken } from "@/lib/auth/inviteToken";
import { timeLeftText } from "./time";
import {
  EMAIL_INVITES_PER_HOLD,
  HOLD_MINUTES,
  type SitResult,
  type TableEmailInvite,
  type TableInvitation,
  type TableStatus,
  type TableVisibility,
  type TablesView,
} from "./types";

/**
 * Table holds on the server (contract in ./types.ts, tables in db/migrations/0006_table_holds.sql).
 * Every function takes the viewer as the route derived it (the verified Auth0 session, or the
 * signed anonymous cookie for public tables), never an id from the request, and decides access
 * itself:
 *
 * - Free table: anyone may sit, and the first to sit may hold it for HOLD_MINUTES.
 * - Public hold: anyone may sit. Private hold: only the holder, their guests (who followed one of
 *   the holder's invite links for this hold), students whose verified email the holder invited
 *   for this hold (matched by keyed hash, lib/auth/emailHash.ts) and members of the Study Circle
 *   the holder picked (checked live against circle_members, for the viewer and the holder both).
 *   Anything private needs a verified sign-in.
 * - One live hold per table and one per student. The database enforces both (exclusion
 *   constraints), so two claims at the same moment can't both win.
 * - A hold ends at ends_at. Over holds are simply ignored, and deleted a day later.
 *
 * Nobody is ever told a guest list, a learner id or an email: only the holder's first name, the
 * visibility and when the hold ends (and the circle's name, to students it lets in). The holder
 * alone sees their email invites, masked. Inviting an address answers the same whether or not
 * anyone has it, so the form can't be used to find out who has an account.
 */

type Sql = postgres.Sql;

export type Failure = { ok: false; status: number; code: string; message: string };
export type Outcome<T> = { ok: true; status: number; body: T } | Failure;

const ok = <T>(body: T, status = 200): Outcome<T> => ({ ok: true, status, body });
const no = (status: number, code: string, message: string): Failure => ({
  ok: false,
  status,
  code,
  message,
});

/* ---- The tables ---- */

/** Every table a student can hold: the tableIds on the library's seats, in plan order. */
export const TABLE_IDS: readonly string[] = [
  ...new Set(SEATS.map((s) => s.tableId).filter((t): t is string => !!t)),
];
const TABLES = new Set(TABLE_IDS);

export const isTableId = (value: unknown): value is string =>
  typeof value === "string" && TABLES.has(value);

/** How a table is named in messages: "table 3", "gallery desk 2". */
export function tableLabel(tableId: string): string {
  const hall = /^hall-t(\d+)$/.exec(tableId);
  if (hall) return `table ${Number(hall[1])}`;
  const desk = /^gallery-desk-(\d+)$/.exec(tableId);
  if (desk) return `gallery desk ${Number(desk[1])}`;
  return "this table";
}

/** A first name only, for everyone to see ("Reader 1a2b" is "Reader"). Never an email. */
export function firstName(displayName: string | null | undefined): string {
  const first = (displayName ?? "").replace(/\s+/g, " ").trim().split(" ")[0] ?? "";
  if (!first || first.includes("@")) return "Someone";
  return first.slice(0, 32);
}

/* ---- Who may sit ---- */

/** The asking student, as the route derived it. */
export interface Viewer {
  /** Their learner (verified session, or the signed anonymous cookie), or null for nobody yet. */
  learnerId: string | null;
  /** A verified Auth0 sign-in: needed for anything private. */
  signedIn: boolean;
  /** The keyed hash of their verified email (signed in only), for email invites. */
  emailHash?: string | null;
}

/** A live hold as read for one viewer (see `liveHolds`). */
export interface HoldRow {
  id: string;
  table_id: string;
  visibility: TableVisibility;
  ends_at: Date;
  /** The database's clock when this was read. */
  now: Date;
  holder_name: string;
  circle_name: string | null;
  /** The viewer holds it. */
  mine: boolean;
  /** The viewer is on this hold's guest list. */
  guest: boolean;
  /** The viewer and the holder are both members of the hold's circle. */
  in_circle: boolean;
  /** The holder invited the viewer's verified email to this hold. */
  email_invited?: boolean;
  /** The hold's email invites, for its holder only (null for anyone else). */
  email_invites?: TableEmailInvite[] | null;
}

type Access = TableStatus["access"];

/** Why the viewer may sit at a table (null: they may not). The whole access rule. */
export function decideAccess(
  hold: Pick<HoldRow, "visibility" | "mine" | "guest" | "in_circle" | "email_invited"> | null,
  viewer: Viewer,
): Access {
  if (!hold) return "free";
  const me = !!viewer.learnerId;
  if (hold.visibility === "public") return me && hold.mine ? "holder" : "public";
  // Private: a verified sign-in, and then the holder, a guest, an invited email or the circle.
  if (!me || !viewer.signedIn) return null;
  if (hold.mine) return "holder";
  if (hold.guest) return "guest";
  if (hold.email_invited && viewer.emailHash) return "email";
  if (hold.in_circle) return "circle";
  return null;
}

/** What `viewer` may know about a table: never ids, emails or guest lists. */
export function tableStatus(tableId: string, hold: HoldRow | null, viewer: Viewer): TableStatus {
  const access = decideAccess(hold, viewer);
  if (!hold)
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
  const mine = access === "holder";
  const letIn = hold.visibility === "private" && access !== null;
  const status: TableStatus = {
    tableId,
    held: true,
    visibility: hold.visibility,
    holderName: firstName(hold.holder_name),
    endsAt: new Date(hold.ends_at).toISOString(),
    canSit: access !== null,
    mine,
    access,
    circleName: mine || letIn ? (hold.circle_name ?? null) : null,
  };
  if (!mine) return status;
  const emailInvites = (hold.email_invites ?? []).map((i) => ({ id: i.id, masked: i.masked }));
  return { ...status, emailInvites };
}

/**
 * The live holds (not released, not over by the database's clock), read for `viewer`: whether
 * each is theirs, whether they're a guest, whether they and the holder share its circle, and
 * whether it invited their verified email (and, for their own hold, its email invites).
 * `tableId` narrows it to one table.
 */
export async function liveHolds(
  sql: Sql,
  viewer: Viewer,
  tableId: string | null = null,
): Promise<HoldRow[]> {
  const me = viewer.learnerId;
  const email = viewer.signedIn ? (viewer.emailHash ?? null) : null;
  return sql<HoldRow[]>`SELECT h.id, h.table_id, h.visibility, h.ends_at, now() AS now,
      l.display_name AS holder_name, c.name AS circle_name,
      coalesce(h.holder_id = ${me}::uuid, false) AS mine,
      EXISTS (SELECT 1 FROM table_hold_guests g
        WHERE g.hold_id = h.id AND g.learner_id = ${me}::uuid) AS guest,
      (h.circle_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM circle_members m
          WHERE m.circle_id = h.circle_id AND m.learner_id = ${me}::uuid)
        AND EXISTS (SELECT 1 FROM circle_members o
          WHERE o.circle_id = h.circle_id AND o.learner_id = h.holder_id)) AS in_circle,
      EXISTS (SELECT 1 FROM table_hold_email_invites e
        WHERE e.hold_id = h.id AND e.email_hash = ${email}::text) AS email_invited,
      CASE WHEN h.holder_id = ${me}::uuid THEN coalesce(
        (SELECT json_agg(json_build_object('id', e.id, 'masked', e.masked)
            ORDER BY e.created_at, e.id)
          FROM table_hold_email_invites e WHERE e.hold_id = h.id),
        '[]'::json) END AS email_invites
    FROM table_holds h
    JOIN learners l ON l.user_id = h.holder_id
    LEFT JOIN study_circles c ON c.id = h.circle_id
    WHERE h.released_at IS NULL AND h.ends_at > now()
      AND (${tableId}::text IS NULL OR h.table_id = ${tableId}::text)
    ORDER BY h.table_id`;
}

/* ---- Messages ---- */

const left = (hold: Pick<HoldRow, "ends_at" | "now">) => timeLeftText(hold.ends_at, hold.now);

export const MESSAGES = {
  notHolding: "You aren't holding this table right now.",
  holdNeedsSignIn: "Sign in to hold a table.",
  holdUnavailable:
    "Holding tables needs LEARNER_SECRET on this server (see docs/learning-analytics.md).",
  joinNeedsSignIn: "Sign in to join a private table.",
  privateNeedsSignIn: "Sign in to make a table private. You can still hold it as a public table.",
  privateUnavailable:
    "Private tables need sign-in, which isn't set up on this server yet. You can still hold it as a public table.",
  circleNeedsSignIn: "Sign in to let a Study Circle use your table.",
  notInCircle: "There's no circle here that you're a member of.",
  inviteNeedsPrivate:
    "Anyone can sit at a public table, so it doesn't need an invite. Make it private first.",
  linkMissing:
    "This table link doesn't work. It may not have been copied in full. Ask for a new one.",
  linkOver: "That table's time is up, or it was given up, so the link doesn't work any more.",
  sameMoment: "Someone sat down here at the same moment. Pick another table, or try again.",
  emailNeedsPrivate:
    "Anyone can sit at a public table, so it doesn't need an email invite. Make it private first.",
  emailInvalid: "That doesn't look like an email address. Check it and try again.",
  emailInviteGone: "That email invite isn't on your table any more.",
  emailLimit: `This table already has ${EMAIL_INVITES_PER_HOLD} email invites. Remove one to add another.`,
};

function takenMessage(tableId: string, hold: HoldRow) {
  return `${firstName(hold.holder_name)} is holding ${tableLabel(tableId)} for another ${left(hold)}. Try a free table nearby.`;
}

function alreadyHoldingMessage(hold: HoldRow) {
  return `You're already holding ${tableLabel(hold.table_id)} (for another ${left(hold)}). Give it up first if you'd like this one instead.`;
}

/** The 403/401 a private table gives someone it doesn't let in: who has it, and for how long. */
export function privateMessage(hold: HoldRow, signedIn: boolean) {
  const who = `This table is private. ${firstName(hold.holder_name)} has it for another ${left(hold)}`;
  return signedIn
    ? `${who}, so ask them for an invite link or pick a free table.`
    : `${who}. If they invited you, sign in to sit here.`;
}

/* ---- Reads ---- */

/** Every table's status for this viewer, and the one they hold. */
export async function tablesView(
  sql: Sql,
  viewer: Viewer,
  privateAvailable: boolean,
): Promise<TablesView> {
  const holds = await liveHolds(sql, viewer);
  const byTable = new Map(holds.map((h) => [h.table_id, h]));
  const tables = TABLE_IDS.map((id) => tableStatus(id, byTable.get(id) ?? null, viewer));
  const verified = viewer.signedIn && !!viewer.learnerId && !!viewer.emailHash;
  // Private tables someone else holds that invited this student's verified email.
  const invitedTo: TableInvitation[] = verified
    ? holds
        .filter((h) => h.email_invited && !h.mine && h.visibility === "private")
        .map((h) => ({
          tableId: h.table_id,
          holderName: firstName(h.holder_name),
          endsAt: new Date(h.ends_at).toISOString(),
        }))
    : [];
  return {
    tables,
    mine: tables.find((t) => t.mine) ?? null,
    signedIn: viewer.signedIn,
    privateAvailable,
    serverTime: (holds[0]?.now ? new Date(holds[0].now) : new Date()).toISOString(),
    invitedTo,
    emailVerified: verified,
  };
}

/** The answer to "may I sit here?", with the HTTP status the route sends it with. */
export type SitAnswer = { status: 200 | 401 | 403; body: SitResult };

/**
 * May the viewer sit here right now. A free table is yes, and `firstHere` says the UI may offer
 * to hold it (not when they already hold another table: one at a time). Nothing is written.
 */
export async function sitAt(sql: Sql, viewer: Viewer, tableId: string): Promise<SitAnswer> {
  const holds = await liveHolds(sql, viewer);
  const hold = holds.find((h) => h.table_id === tableId) ?? null;
  const status = tableStatus(tableId, hold, viewer);
  if (status.canSit) {
    const holdingAnother = holds.some((h) => h.mine && h.table_id !== tableId);
    return { status: 200, body: { ok: true, status, firstHere: !hold && !holdingAnother } };
  }
  const signedIn = viewer.signedIn && !!viewer.learnerId;
  return {
    status: signedIn ? 403 : 401,
    body: {
      ok: false,
      status,
      reason: signedIn ? "private" : "sign_in_required",
      message: privateMessage(hold!, signedIn),
    },
  };
}

/* ---- Holding a table ---- */

/** The caller's own circle (they must be a member), or a Failure. */
async function ownCircle(sql: Sql, me: string, circleId: string): Promise<Failure | null> {
  const [row] = await sql<{ ok: number }[]>`SELECT 1 AS ok FROM circle_members
    WHERE circle_id = ${circleId} AND learner_id = ${me} FOR SHARE`;
  return row ? null : no(404, "not_found", MESSAGES.notInCircle);
}

/** What going private (or picking a circle) needs first: sign-in set up, and signed in. */
function privateGate(
  viewer: Viewer,
  privateAvailable: boolean,
  wantsPrivate: boolean,
  wantsCircle: boolean,
): Failure | null {
  if (!wantsPrivate && !wantsCircle) return null;
  if (!privateAvailable) return no(503, "auth_not_configured", MESSAGES.privateUnavailable);
  if (!viewer.signedIn)
    return no(
      401,
      "sign_in_required",
      wantsPrivate ? MESSAGES.privateNeedsSignIn : MESSAGES.circleNeedsSignIn,
    );
  return null;
}

/**
 * A claim that lost a race the advisory locks didn't catch: the exclusion constraint refused it
 * (23P01), or two inserts waited on each other's constraint check and Postgres picked this one
 * to undo (40P01).
 */
const lostRace = (error: unknown) => {
  const code = (error as { code?: string })?.code;
  return code === "23P01" || code === "40P01";
};

/** Advisory lock namespaces (the two-key form): claims per table, and per student. */
const LOCK = { table: 7301, student: 7302 } as const;

/**
 * Hold a free table for HOLD_MINUTES (the first sitter). 409 table_taken if someone holds it,
 * 409 already_holding if the viewer holds another. Holding your own table again changes nothing.
 */
export async function claimTable(
  sql: Sql,
  viewer: Viewer,
  tableId: string,
  input: { visibility: TableVisibility; circleId?: string | null },
  privateAvailable: boolean,
): Promise<Outcome<TableStatus>> {
  const me = viewer.learnerId;
  const circleId = input.circleId ?? null;
  const gate = privateGate(viewer, privateAvailable, input.visibility === "private", !!circleId);
  if (gate) return gate;
  // Signed out with no learner: only when the server can't make one (no LEARNER_SECRET).
  if (!me)
    return privateAvailable
      ? no(401, "sign_in_required", MESSAGES.holdNeedsSignIn)
      : no(503, "not_configured", MESSAGES.holdUnavailable);
  try {
    const out = (await sql.begin(async (tx) => {
      // Claims for this table, then by this student, take turns, so the check below sees any
      // claim that won a moment ago. Always in this order, so two claims can't wait on each other.
      await tx`SELECT pg_advisory_xact_lock(${LOCK.table}::int, hashtext(${tableId}))`;
      await tx`SELECT pg_advisory_xact_lock(${LOCK.student}::int, hashtext(${me}))`;
      const holds = await liveHolds(tx, viewer);
      const taken = holds.find((h) => h.table_id === tableId);
      if (taken)
        return taken.mine
          ? ok(tableStatus(tableId, taken, viewer))
          : no(409, "table_taken", takenMessage(tableId, taken));
      const other = holds.find((h) => h.mine);
      if (other) return no(409, "already_holding", alreadyHoldingMessage(other));
      if (circleId) {
        const notMine = await ownCircle(tx, me, circleId);
        if (notMine) return notMine;
      }
      await tx`INSERT INTO table_holds (id, table_id, holder_id, visibility, circle_id, ends_at)
        VALUES (${randomUUID()}, ${tableId}, ${me}, ${input.visibility}, ${circleId},
          now() + make_interval(mins => ${HOLD_MINUTES}::int))`;
      const [mine] = await liveHolds(tx, viewer, tableId);
      return ok(tableStatus(tableId, mine ?? null, viewer), 201);
    })) as Outcome<TableStatus>;
    if (out.ok && out.status === 201) await tidy(sql);
    return out;
  } catch (error) {
    if (!lostRace(error)) throw error;
    // Another claim won the race (the database refused the overlap): say who, as above.
    const holds = await liveHolds(sql, viewer);
    const taken = holds.find((h) => h.table_id === tableId && !h.mine);
    if (taken) return no(409, "table_taken", takenMessage(tableId, taken));
    const other = holds.find((h) => h.mine);
    if (other) return no(409, "already_holding", alreadyHoldingMessage(other));
    return no(409, "table_taken", MESSAGES.sameMoment);
  }
}

/** Best effort: forget holds (and with them guests and links) that ended over a day ago. */
async function tidy(sql: Sql) {
  try {
    await sql`DELETE FROM table_holds
      WHERE ends_at < now() - interval '1 day' OR released_at < now() - interval '1 day'`;
  } catch (error) {
    console.error("[tables] tidy", (error as { code?: string }).code ?? error);
  }
}

/** The viewer's live hold on this table, locked for a change (null: they don't hold it). */
async function myHold(tx: Sql, me: string, tableId: string) {
  const [row] = await tx<
    { id: string; visibility: TableVisibility; circle_id: string | null; ends_at: Date }[]
  >`SELECT id, visibility, circle_id, ends_at FROM table_holds
    WHERE table_id = ${tableId} AND holder_id = ${me}
      AND released_at IS NULL AND ends_at > now()
    FOR UPDATE`;
  return row ?? null;
}

/**
 * The holder switches public/private and picks (a uuid) or clears (null) the Study Circle whose
 * members may sit. Going private, or picking a circle, needs a sign-in and membership of it.
 */
export async function updateTable(
  sql: Sql,
  viewer: Viewer,
  tableId: string,
  patch: { visibility?: TableVisibility; circleId?: string | null },
  privateAvailable: boolean,
): Promise<Outcome<TableStatus>> {
  const me = viewer.learnerId;
  if (!me) return no(404, "not_found", MESSAGES.notHolding);
  const gate = privateGate(
    viewer,
    privateAvailable,
    patch.visibility === "private",
    !!patch.circleId,
  );
  if (gate) return gate;
  return sql.begin(async (tx) => {
    const hold = await myHold(tx, me, tableId);
    if (!hold) return no(404, "not_found", MESSAGES.notHolding);
    if (patch.circleId) {
      const notMine = await ownCircle(tx, me, patch.circleId);
      if (notMine) return notMine;
    }
    const visibility = patch.visibility ?? hold.visibility;
    const circleId = patch.circleId === undefined ? hold.circle_id : patch.circleId;
    await tx`UPDATE table_holds SET visibility = ${visibility}, circle_id = ${circleId}
      WHERE id = ${hold.id}`;
    const [now] = await liveHolds(tx, viewer, tableId);
    return ok(tableStatus(tableId, now ?? null, viewer));
  }) as Promise<Outcome<TableStatus>>;
}

/** The holder gives the table up early. Its invite links and email invites stop at once. */
export async function releaseTable(
  sql: Sql,
  viewer: Viewer,
  tableId: string,
): Promise<Outcome<{ ok: true }>> {
  const me = viewer.learnerId;
  if (!me) return no(404, "not_found", MESSAGES.notHolding);
  return sql.begin(async (tx) => {
    const [gone] = await tx<{ id: string }[]>`UPDATE table_holds SET released_at = now()
      WHERE table_id = ${tableId} AND holder_id = ${me}
        AND released_at IS NULL AND ends_at > now()
      RETURNING id`;
    if (!gone) return no(404, "not_found", MESSAGES.notHolding);
    await tx`DELETE FROM table_hold_invites WHERE hold_id = ${gone.id}`;
    await tx`DELETE FROM table_hold_email_invites WHERE hold_id = ${gone.id}`;
    return ok({ ok: true as const });
  }) as Promise<Outcome<{ ok: true }>>;
}

/* ---- Presence: a hold ends when its holder leaves ---- */

/**
 * How long a holder's page may go quiet before the table is given up for them (closed tab,
 * crash, lost connection). Background tabs only run timers about once a minute, so this leaves
 * room for that: switching tabs while studying never costs anyone their table.
 */
export const PRESENCE_GRACE_S = 150;

/** Releases every hold whose holder's page has stopped checking in. */
export async function releaseAbandoned(sql: Sql) {
  await sql`UPDATE table_holds SET released_at = now()
    WHERE released_at IS NULL AND ends_at > now()
      AND last_seen_at < now() - make_interval(secs => ${PRESENCE_GRACE_S})`;
}

/**
 * The holder's page checking in. Seated at the table: the hold stays theirs. Not seated there
 * any more (however they left): the table is given up, like pressing "Give it up".
 */
export async function heartbeatTable(
  sql: Sql,
  viewer: Viewer,
  tableId: string,
  seated: boolean,
): Promise<Outcome<{ ok: true; held: boolean }>> {
  if (!seated) {
    const out = await releaseTable(sql, viewer, tableId);
    return out.ok ? ok({ ok: true as const, held: false }) : out;
  }
  const me = viewer.learnerId;
  if (!me) return no(404, "not_found", MESSAGES.notHolding);
  const [seen] = await sql<{ id: string }[]>`UPDATE table_holds SET last_seen_at = now()
    WHERE table_id = ${tableId} AND holder_id = ${me}
      AND released_at IS NULL AND ends_at > now()
    RETURNING id`;
  return seen ? ok({ ok: true as const, held: true }) : no(404, "not_found", MESSAGES.notHolding);
}

/* ---- Invite links ---- */

/** Open links, guests and email invites per hold: plenty for a study table. */
export const TABLE_LIMITS = {
  invitesPerHold: 20,
  guestsPerHold: 40,
  emailInvitesPerHold: EMAIL_INVITES_PER_HOLD,
} as const;

/** A new invite: 32 random bytes for the link, and the SHA-256 (hex) the database keeps. */
export function newTableToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/** Whether a string could be a token from newTableToken (checked before hashing user input). */
export const isTableToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

export interface TableInvite {
  link: string;
  path: string;
  expiresAt: string;
}

/**
 * The holder of a private table makes an invite link. It lets a signed-in student onto this
 * hold's guest list, and stops working when the hold ends or is released. `origin` is this
 * site (APP_BASE_URL or the request's), for the full link.
 */
export async function createTableInvite(
  sql: Sql,
  viewer: Viewer,
  tableId: string,
  origin: string,
  privateAvailable: boolean,
): Promise<Outcome<TableInvite>> {
  const me = viewer.learnerId;
  if (!privateAvailable) return no(503, "auth_not_configured", MESSAGES.privateUnavailable);
  if (!me || !viewer.signedIn) return no(401, "sign_in_required", MESSAGES.privateNeedsSignIn);
  return sql.begin(async (tx) => {
    const hold = await myHold(tx, me, tableId);
    if (!hold) return no(404, "not_found", MESSAGES.notHolding);
    if (hold.visibility !== "private") return no(409, "conflict", MESSAGES.inviteNeedsPrivate);
    const [open] = await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM table_hold_invites
      WHERE hold_id = ${hold.id}`;
    if ((open?.n ?? 0) >= TABLE_LIMITS.invitesPerHold)
      return no(
        409,
        "limit_reached",
        `This table already has ${TABLE_LIMITS.invitesPerHold} invite links. Share one of those instead.`,
      );
    const { token, hash } = newTableToken();
    const [row] = await tx<{ expires_at: Date }[]>`INSERT INTO table_hold_invites
        (token_hash, hold_id, created_by, expires_at)
      VALUES (${hash}, ${hold.id}, ${me}, ${hold.ends_at})
      RETURNING expires_at`;
    const path = `/tables/join/${token}`;
    return ok(
      {
        link: `${origin.replace(/\/+$/, "")}${path}`,
        path,
        expiresAt: new Date(row!.expires_at).toISOString(),
      },
      201,
    );
  }) as Promise<Outcome<TableInvite>>;
}

/**
 * A signed-in student follows an invite link: they join that hold's guest list (that hold only,
 * so it ends with it). The holder following their own link changes nothing.
 */
export async function joinTable(
  sql: Sql,
  me: string,
  token: string,
): Promise<Outcome<{ tableId: string; status: TableStatus }>> {
  const viewer: Viewer = { learnerId: me, signedIn: true };
  const hash = hashInviteToken(token);
  return sql.begin(async (tx) => {
    // The hold row is locked: a release at the same moment waits for this (or this sees it), and
    // joins to one hold take turns, so two at once can't both squeeze past the guest cap. (NO KEY
    // UPDATE still lets the guest insert's foreign-key check share the row.)
    const [inv] = await tx<
      { hold_id: string; table_id: string; mine: boolean; live: boolean }[]
    >`SELECT i.hold_id, h.table_id, h.holder_id = ${me} AS mine,
        (i.expires_at > now() AND h.released_at IS NULL AND h.ends_at > now()) AS live
      FROM table_hold_invites i JOIN table_holds h ON h.id = i.hold_id
      WHERE i.token_hash = ${hash}
      FOR NO KEY UPDATE OF h`;
    if (!inv) return no(404, "not_found", MESSAGES.linkMissing);
    if (!inv.live) return no(410, "gone", MESSAGES.linkOver);
    if (!inv.mine) {
      const [guests] = await tx<{ n: number }[]>`SELECT count(*)::int AS n
        FROM table_hold_guests WHERE hold_id = ${inv.hold_id}`;
      const already = await tx`SELECT 1 FROM table_hold_guests
        WHERE hold_id = ${inv.hold_id} AND learner_id = ${me}`;
      if (!already.length && (guests?.n ?? 0) >= TABLE_LIMITS.guestsPerHold)
        return no(
          409,
          "limit_reached",
          `This table already has ${TABLE_LIMITS.guestsPerHold} guests. Ask its holder to make room.`,
        );
      await tx`INSERT INTO table_hold_guests (hold_id, learner_id)
        VALUES (${inv.hold_id}, ${me}) ON CONFLICT DO NOTHING`;
    }
    const [hold] = await liveHolds(tx, viewer, inv.table_id);
    return ok({ tableId: inv.table_id, status: tableStatus(inv.table_id, hold ?? null, viewer) });
  }) as Promise<Outcome<{ tableId: string; status: TableStatus }>>;
}

/* ---- Email invites ---- */

/**
 * The holder of a private table invites someone by the email they signed up with. Only a keyed
 * hash of the address and a masked form ("bi•••@gmail.com", for the holder's list) are stored;
 * whoever signs in with that address, verified, may sit here until this hold ends. Nothing here
 * looks for an account with that address, so the answer (201 and the masked invite) and the work
 * done are the same whether or not one exists. Inviting the same address again returns the same
 * invite. `email` is checked by the route (an address, at most 254 characters).
 */
export async function inviteByEmail(
  sql: Sql,
  viewer: Viewer,
  tableId: string,
  email: string,
  privateAvailable: boolean,
): Promise<Outcome<{ invite: TableEmailInvite }>> {
  const me = viewer.learnerId;
  if (!privateAvailable) return no(503, "auth_not_configured", MESSAGES.privateUnavailable);
  if (!me || !viewer.signedIn) return no(401, "sign_in_required", MESSAGES.privateNeedsSignIn);
  const hash = hashEmail(email);
  if (!hash) return no(400, "bad_request", MESSAGES.emailInvalid);
  const masked = maskEmail(email);
  return sql.begin(async (tx) => {
    // The hold row is locked, so two invites at once can't both squeeze past the cap.
    const hold = await myHold(tx, me, tableId);
    if (!hold) return no(404, "not_found", MESSAGES.notHolding);
    if (hold.visibility !== "private") return no(409, "conflict", MESSAGES.emailNeedsPrivate);
    const [count] = await tx<{ n: number; already: boolean }[]>`SELECT count(*)::int AS n,
        coalesce(bool_or(email_hash = ${hash}), false) AS already
      FROM table_hold_email_invites WHERE hold_id = ${hold.id}`;
    if (!count?.already && (count?.n ?? 0) >= TABLE_LIMITS.emailInvitesPerHold)
      return no(409, "limit_reached", MESSAGES.emailLimit);
    const [row] = await tx<TableEmailInvite[]>`INSERT INTO table_hold_email_invites
        (id, hold_id, email_hash, masked, created_by)
      VALUES (${randomUUID()}, ${hold.id}, ${hash}, ${masked}, ${me})
      ON CONFLICT (hold_id, email_hash) DO UPDATE SET masked = EXCLUDED.masked
      RETURNING id, masked`;
    return ok({ invite: { id: row!.id, masked: row!.masked } }, 201);
  }) as Promise<Outcome<{ invite: TableEmailInvite }>>;
}

/**
 * The holder takes an email invite back. From the next request on, that address can't sit here
 * (unless it's also on the guest list or in the table's circle).
 */
export async function removeEmailInvite(
  sql: Sql,
  viewer: Viewer,
  tableId: string,
  inviteId: string,
): Promise<Outcome<{ ok: true }>> {
  const me = viewer.learnerId;
  if (!me) return no(404, "not_found", MESSAGES.notHolding);
  if (!viewer.signedIn) return no(401, "sign_in_required", MESSAGES.privateNeedsSignIn);
  return sql.begin(async (tx) => {
    const hold = await myHold(tx, me, tableId);
    if (!hold) return no(404, "not_found", MESSAGES.notHolding);
    const [gone] = await tx<{ id: string }[]>`DELETE FROM table_hold_email_invites
      WHERE id = ${inviteId} AND hold_id = ${hold.id} RETURNING id`;
    if (!gone) return no(404, "not_found", MESSAGES.emailInviteGone);
    return ok({ ok: true as const });
  }) as Promise<Outcome<{ ok: true }>>;
}
