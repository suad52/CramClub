import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type postgres from "postgres";
import { z } from "zod";
import { hashInviteToken } from "@/lib/auth/inviteToken";
import {
  CIRCLE_LIMITS as LIMITS,
  type CircleDetail,
  type CircleInvite,
  type CircleItem,
  type CircleMember,
  type CircleRole,
  type CircleSummary,
  type InvitePreview,
  type InviteRole,
  type InviteState,
  type ItemKind,
  type ItemPreview,
  type JoinResult,
  type NewInvite,
  type NewItem,
  type ShareSource,
  type ShareableItem,
} from "./types";

/**
 * Study Circles on the server. Every function takes the caller's learner id as derived by
 * requireUser (the verified Auth0 session), never one from the request, and checks membership and
 * role itself before it reads or changes anything:
 *
 * - Not a member: 404, for every action, so a circle id can't be probed.
 * - A member whose role is too low: 403 with a message saying who can, and nothing is written.
 * - Writes run in a transaction that holds the caller's membership row (FOR SHARE), so an owner
 *   demoting or removing someone at the same moment can't race an edit through.
 *
 * Roles: owner (one per circle) manages members, invites and the circle; editors add and remove
 * items; viewers read. Invite links carry 32 random bytes; only their SHA-256 is stored.
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

/* ---- Who may do what ---- */

export type CircleAction =
  "view" | "add_item" | "remove_item" | "invite" | "manage_members" | "delete_circle" | "leave";

const RANK: Record<CircleRole, number> = { viewer: 1, editor: 2, owner: 3 };
const NEEDS: Record<Exclude<CircleAction, "leave">, CircleRole> = {
  view: "viewer",
  add_item: "editor",
  remove_item: "editor",
  invite: "owner",
  manage_members: "owner",
  delete_circle: "owner",
};

/** Whether a member with `role` (null: not a member) may do `action`. The whole role matrix. */
export function can(role: CircleRole | null, action: CircleAction): boolean {
  if (!role) return false;
  if (action === "leave") return role !== "owner";
  return RANK[role] >= RANK[NEEDS[action]];
}

/** What a member hears when their role doesn't allow something. */
export const DENIED: Record<Exclude<CircleAction, "view">, string> = {
  add_item: "Only editors can add to this circle. Ask the owner to make you an editor.",
  remove_item:
    "Only editors can remove things from this circle. Ask the owner to make you an editor.",
  invite: "Only the circle's owner can make invite links. Ask them for one to pass on.",
  manage_members: "Only the circle's owner can change roles or remove members.",
  delete_circle: "Only the circle's owner can delete this circle.",
  leave:
    "You own this circle, so you can't leave it. Make another member the owner first, or delete the circle.",
};

export const NOT_A_MEMBER =
  "There's no circle here that you're a member of. If someone invited you, open their invite link.";

/** The membership check every action starts with, as a pure decision (see `gate`). */
export function decide(
  role: CircleRole | null,
  action: CircleAction,
): { ok: true; role: CircleRole } | Failure {
  if (!role) return no(404, "not_found", NOT_A_MEMBER);
  if (!can(role, action))
    return action === "leave"
      ? no(409, "conflict", DENIED.leave)
      : no(403, "forbidden", DENIED[action as Exclude<CircleAction, "view">]);
  return { ok: true, role };
}

/** The caller's role in a circle, then `decide`. `lock` holds the membership row (in a write). */
async function gate(sql: Sql, me: string, circleId: string, action: CircleAction, lock = false) {
  const [row] = lock
    ? await sql<{ role: CircleRole }[]>`SELECT role FROM circle_members
        WHERE circle_id = ${circleId} AND learner_id = ${me} FOR SHARE`
    : await sql<{ role: CircleRole }[]>`SELECT role FROM circle_members
        WHERE circle_id = ${circleId} AND learner_id = ${me}`;
  return decide(row?.role ?? null, action);
}

/* ---- Member handles and invite tokens ---- */

/**
 * A member's handle within one circle: stable, but not their learner id (which never leaves the
 * server), and different in every circle, so members can't be matched up across circles.
 */
export function memberKey(circleId: string, learnerId: string) {
  return createHash("sha256")
    .update(`ovr-circle-member:${circleId}:${learnerId}`)
    .digest("hex")
    .slice(0, 24);
}

export const isMemberKey = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{24}$/.test(value);

/** A new invite: 32 random bytes for the link, and the SHA-256 (hex) the database keeps. */
export function newCircleToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/** Whether a string could be a token from newCircleToken (checked before hashing user input). */
export const isCircleToken = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

/** Whether an invite can still be used (by the database's clock). */
export function inviteState(
  invite: { expiresAt: Date; uses: number; maxUses: number },
  now: Date,
): InviteState {
  if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
  if (invite.uses >= invite.maxUses) return "used_up";
  return "ok";
}

/**
 * What following an invite does. A member already in the circle keeps their role, whatever the
 * invite offers (no escalation, no demotion) and spends no use, even on an expired link. Someone
 * the owner removed after this link was made can't use it to come back (`removedSince`, from
 * circle_removals).
 */
export function joinDecision(
  current: CircleRole | null,
  invite: { role: InviteRole; expiresAt: Date; uses: number; maxUses: number },
  now: Date,
  removedSince = false,
):
  | { type: "already"; role: CircleRole }
  | { type: "join"; role: InviteRole }
  | { type: "expired" | "used_up" | "removed" } {
  if (current) return { type: "already", role: current };
  if (removedSince) return { type: "removed" };
  const state = inviteState(invite, now);
  return state === "ok" ? { type: "join", role: invite.role } : { type: state };
}

const INVITE_GONE = {
  missing:
    "This invite link doesn't work. It may have been revoked, or not copied in full. Ask for a new one.",
  expired: "This invite link has expired. Ask the circle's owner for a new one.",
  used_up:
    "This invite link has been used as many times as it allows. Ask the circle's owner for a new one.",
  removed:
    "The circle's owner removed you, so links made before then don't work for you. Ask them for a new invite if you'd like to rejoin.",
};

/* ---- Item previews ---- */

const str = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function lessonPreview(lesson: Record<string, unknown>): ItemPreview {
  return {
    type: "lesson",
    description: str(lesson.description, 400),
    minutes: num(lesson.estimatedMinutes),
    objectives: arr(lesson.learningObjectives)
      .map((o) => str(o, 160))
      .filter(Boolean)
      .slice(0, 6),
    scenes: arr(lesson.scenes)
      .map((s) => str(obj(s).title, 80))
      .filter(Boolean)
      .slice(0, 10),
  };
}

function planPreview(plan: Record<string, unknown>): ItemPreview {
  return {
    type: "plan",
    goal: str(plan.goal, 400),
    dailyMinutes: num(plan.dailyMinutes ?? plan.daily_minutes),
    days: arr(plan.days)
      .slice(0, 30)
      .map((d) => {
        const day = obj(d);
        return {
          date: str(day.date, 10),
          focus: str(day.focus, 200),
          items: arr(day.items)
            .map((i) => str(obj(i).title, 120))
            .filter(Boolean)
            .slice(0, 6),
        };
      }),
  };
}

/**
 * The preview for something copied from a personal library, read defensively (it's whatever
 * shape that item's payload has): a note's text, a lesson's objectives and scenes, a plan's days.
 */
export function previewFromPayload(kind: ItemKind, payload: unknown): ItemPreview {
  const p = obj(payload);
  if (kind === "note") {
    const text = [p.text, p.note, p.body].find((v) => typeof v === "string") as string | undefined;
    return text
      ? { type: "note", text: text.trim().slice(0, LIMITS.noteLength) }
      : { type: "none" };
  }
  if (kind === "lesson") {
    const lesson = obj(p.lesson ?? p);
    return Array.isArray(lesson.scenes) ? lessonPreview(lesson) : { type: "none" };
  }
  if (kind === "plan") {
    const plan = obj(p.plan ?? p);
    return Array.isArray(plan.days) ? planPreview(plan) : { type: "none" };
  }
  return { type: "none" };
}

const PreviewSchema: z.ZodType<ItemPreview> = z.union([
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("note"), text: z.string() }),
  z.object({
    type: z.literal("plan"),
    goal: z.string(),
    dailyMinutes: z.number().nullable(),
    days: z.array(z.object({ date: z.string(), focus: z.string(), items: z.array(z.string()) })),
  }),
  z.object({
    type: z.literal("lesson"),
    description: z.string(),
    minutes: z.number().nullable(),
    objectives: z.array(z.string()),
    scenes: z.array(z.string()),
  }),
]);

function readPreview(value: unknown): ItemPreview {
  const parsed = PreviewSchema.safeParse(value);
  return parsed.success ? parsed.data : { type: "none" };
}

/** Under circle_items' 256 KB payload cap, with room for jsonb's own spacing. */
const PAYLOAD_BUDGET = 240_000;

/** `{ preview, data?, copiedFrom? }`, dropping `data` (the full copy) if it wouldn't fit. */
export function itemPayload(
  preview: ItemPreview,
  data?: unknown,
  copiedFrom?: ShareSource,
): Record<string, unknown> {
  const full: Record<string, unknown> = { preview };
  if (copiedFrom) full.copiedFrom = copiedFrom;
  if (data !== undefined) full.data = data;
  if (Buffer.byteLength(JSON.stringify(full)) <= PAYLOAD_BUDGET) return full;
  const lean: Record<string, unknown> = { preview, truncated: true };
  if (copiedFrom) lean.copiedFrom = copiedFrom;
  return lean;
}

/** An https link, cleaned up, or null (no other schemes, no user:password@). */
export function httpsUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
    const out = url.toString();
    return out.length <= 2048 ? out : null;
  } catch {
    return null;
  }
}

/* ---- Circles ---- */

const iso = (d: Date | string) => new Date(d).toISOString();
const count = (rows: { n: number }[]) => rows[0]?.n ?? 0;

export async function createCircle(
  sql: Sql,
  me: string,
  input: { name: string; description: string },
): Promise<Outcome<{ id: string }>> {
  return sql.begin(async (tx) => {
    const n = count(
      await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM study_circles
      WHERE owner_id = ${me}`,
    );
    if (n >= LIMITS.ownedCircles)
      return no(
        409,
        "limit_reached",
        `You can own up to ${LIMITS.ownedCircles} circles. Delete one you don't use to make another.`,
      );
    const id = randomUUID();
    await tx`INSERT INTO study_circles (id, name, description, owner_id)
      VALUES (${id}, ${input.name}, ${input.description}, ${me})`;
    await tx`INSERT INTO circle_members (circle_id, learner_id, role)
      VALUES (${id}, ${me}, 'owner')`;
    return ok({ id }, 201);
  }) as Promise<Outcome<{ id: string }>>;
}

/** The circles you're in, with what's new since you last opened each. */
export async function listCircles(sql: Sql, me: string): Promise<CircleSummary[]> {
  const rows = await sql<
    {
      id: string;
      name: string;
      description: string;
      role: CircleRole;
      last_seen_at: Date;
      updated_at: Date;
      owner_name: string;
      member_count: number;
      item_count: number;
      new_count: number;
    }[]
  >`SELECT c.id, c.name, c.description, m.role, m.last_seen_at, c.updated_at,
      o.display_name AS owner_name,
      (SELECT count(*)::int FROM circle_members x WHERE x.circle_id = c.id) AS member_count,
      (SELECT count(*)::int FROM circle_items i WHERE i.circle_id = c.id) AS item_count,
      (SELECT count(*)::int FROM circle_items i WHERE i.circle_id = c.id
        AND i.created_at > m.last_seen_at AND i.added_by <> ${me}) AS new_count
    FROM circle_members m
    JOIN study_circles c ON c.id = m.circle_id
    JOIN learners o ON o.user_id = c.owner_id
    WHERE m.learner_id = ${me}
    ORDER BY c.updated_at DESC
    LIMIT 100`;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    myRole: r.role,
    ownerName: r.owner_name,
    memberCount: r.member_count,
    itemCount: r.item_count,
    newSinceLastVisit: r.new_count,
    lastSeenAt: iso(r.last_seen_at),
    updatedAt: iso(r.updated_at),
  }));
}

/** A circle, its members and items: members only (404 for anyone else). Doesn't mark the visit. */
export async function getCircle(
  sql: Sql,
  me: string,
  circleId: string,
): Promise<Outcome<CircleDetail>> {
  // The membership check and the read are one query: no row, no circle.
  const [c] = await sql<
    {
      id: string;
      name: string;
      description: string;
      created_at: Date;
      role: CircleRole;
      last_seen_at: Date;
      read_at: Date;
    }[]
  >`SELECT c.id, c.name, c.description, c.created_at, m.role, m.last_seen_at, now() AS read_at
    FROM circle_members m JOIN study_circles c ON c.id = m.circle_id
    WHERE m.circle_id = ${circleId} AND m.learner_id = ${me}`;
  if (!c) return no(404, "not_found", NOT_A_MEMBER);

  const members = await sql<
    { learner_id: string; role: CircleRole; joined_at: Date; display_name: string }[]
  >`SELECT m.learner_id, m.role, m.joined_at, l.display_name
    FROM circle_members m JOIN learners l ON l.user_id = m.learner_id
    WHERE m.circle_id = ${circleId}
    ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, m.joined_at`;

  const items = await sql<
    {
      id: string;
      kind: ItemKind;
      title: string;
      url: string | null;
      summary: string;
      preview: unknown;
      from_library: boolean;
      created_at: Date;
      mine: boolean;
      added_by_name: string;
      is_new: boolean;
    }[]
  >`SELECT i.id, i.kind, i.title, i.url, i.summary, i.payload -> 'preview' AS preview,
      (i.payload ->> 'copiedFrom') IS NOT NULL AS from_library, i.created_at,
      i.added_by = ${me} AS mine, l.display_name AS added_by_name,
      (i.created_at > ${c.last_seen_at} AND i.added_by <> ${me}) AS is_new
    FROM circle_items i JOIN learners l ON l.user_id = i.added_by
    WHERE i.circle_id = ${circleId}
    ORDER BY i.created_at DESC
    LIMIT ${LIMITS.itemsPerCircle}`;

  let invites: CircleInvite[] | null = null;
  if (c.role === "owner") {
    const rows = await sql<
      {
        token_hash: string;
        role: InviteRole;
        created_at: Date;
        expires_at: Date;
        uses: number;
        max_uses: number;
      }[]
    >`SELECT token_hash, role, created_at, expires_at, uses, max_uses FROM circle_invites
      WHERE circle_id = ${circleId} AND expires_at > now() AND uses < max_uses
      ORDER BY created_at DESC`;
    invites = rows.map((r) => ({
      id: r.token_hash,
      role: r.role,
      createdAt: iso(r.created_at),
      expiresAt: iso(r.expires_at),
      uses: r.uses,
      maxUses: r.max_uses,
    }));
  }

  const memberList: CircleMember[] = members.map((m) => ({
    key: memberKey(circleId, m.learner_id),
    displayName: m.display_name,
    role: m.role,
    joinedAt: iso(m.joined_at),
    isMe: m.learner_id === me,
  }));
  const itemList: CircleItem[] = items.map((i) => ({
    id: i.id,
    kind: i.kind,
    title: i.title,
    url: i.url,
    summary: i.summary,
    preview: readPreview(i.preview),
    addedByName: i.added_by_name,
    addedByMe: i.mine,
    fromLibrary: i.from_library,
    createdAt: iso(i.created_at),
    isNew: i.is_new,
  }));
  return ok({
    id: c.id,
    name: c.name,
    description: c.description,
    createdAt: iso(c.created_at),
    myRole: c.role,
    lastSeenAt: iso(c.last_seen_at),
    newSinceLastVisit: itemList.filter((i) => i.isNew).length,
    members: memberList,
    items: itemList,
    invites,
    readAt: iso(c.read_at),
  });
}

/**
 * Marks your visit up to `seenAt` (the `readAt` of what you were shown), so "new since your last
 * visit" counts from there. It only moves forward, and never past the server's clock.
 */
export async function markSeen(
  sql: Sql,
  me: string,
  circleId: string,
  seenAt: Date,
): Promise<Outcome<{ ok: true }>> {
  const rows = await sql`UPDATE circle_members
    SET last_seen_at = GREATEST(last_seen_at, LEAST(now(), ${seenAt}::timestamptz))
    WHERE circle_id = ${circleId} AND learner_id = ${me} RETURNING 1`;
  return rows.length ? ok({ ok: true as const }) : no(404, "not_found", NOT_A_MEMBER);
}

export async function deleteCircle(
  sql: Sql,
  me: string,
  circleId: string,
): Promise<Outcome<{ ok: true }>> {
  return sql.begin(async (tx) => {
    const g = await gate(tx, me, circleId, "delete_circle", true);
    if (!g.ok) return g;
    await tx`DELETE FROM study_circles WHERE id = ${circleId}`;
    return ok({ ok: true as const });
  }) as Promise<Outcome<{ ok: true }>>;
}

export async function leaveCircle(
  sql: Sql,
  me: string,
  circleId: string,
): Promise<Outcome<{ ok: true }>> {
  return sql.begin(async (tx) => {
    const g = await gate(tx, me, circleId, "leave", true);
    if (!g.ok) return g;
    await tx`DELETE FROM circle_members WHERE circle_id = ${circleId} AND learner_id = ${me}`;
    await tx`UPDATE study_circles SET updated_at = now() WHERE id = ${circleId}`;
    return ok({ ok: true as const });
  }) as Promise<Outcome<{ ok: true }>>;
}

/* ---- Invites ---- */

export async function createInvite(
  sql: Sql,
  me: string,
  circleId: string,
  input: { role: InviteRole; days?: number; maxUses?: number },
): Promise<Outcome<NewInvite>> {
  const days = input.days ?? LIMITS.inviteDays.default;
  const maxUses = input.maxUses ?? LIMITS.inviteUses.default;
  return sql.begin(async (tx) => {
    const g = await gate(tx, me, circleId, "invite", true);
    if (!g.ok) return g;
    const n = count(
      await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM circle_invites
      WHERE circle_id = ${circleId} AND expires_at > now() AND uses < max_uses`,
    );
    if (n >= LIMITS.activeInvites)
      return no(
        409,
        "limit_reached",
        `This circle already has ${LIMITS.activeInvites} open invite links. Revoke one to make another.`,
      );
    const { token, hash } = newCircleToken();
    const [row] = await tx<{ created_at: Date; expires_at: Date }[]>`INSERT INTO circle_invites
        (token_hash, circle_id, role, created_by, expires_at, max_uses)
      VALUES (${hash}, ${circleId}, ${input.role}, ${me},
        now() + make_interval(days => ${days}::int), ${maxUses})
      RETURNING created_at, expires_at`;
    return ok(
      {
        id: hash,
        role: input.role,
        createdAt: iso(row!.created_at),
        expiresAt: iso(row!.expires_at),
        uses: 0,
        maxUses,
        token,
        path: `/circles/join/${token}`,
      },
      201,
    );
  }) as Promise<Outcome<NewInvite>>;
}

export async function revokeInvite(
  sql: Sql,
  me: string,
  circleId: string,
  inviteId: string,
): Promise<Outcome<{ ok: true }>> {
  return sql.begin(async (tx) => {
    const g = await gate(tx, me, circleId, "invite", true);
    if (!g.ok) return g;
    const gone = await tx`DELETE FROM circle_invites
      WHERE token_hash = ${inviteId} AND circle_id = ${circleId} RETURNING 1`;
    return gone.length
      ? ok({ ok: true as const })
      : no(404, "not_found", "That invite link is already gone.");
  }) as Promise<Outcome<{ ok: true }>>;
}

/** What an invite link leads to, for the join page (signed in, nothing changes). */
export async function previewInvite(
  sql: Sql,
  me: string,
  token: string,
): Promise<Outcome<InvitePreview>> {
  const [r] = await sql<
    {
      circle_id: string;
      role: InviteRole;
      expires_at: Date;
      uses: number;
      max_uses: number;
      now: Date;
      name: string;
      owner_name: string;
      member_count: number;
      my_role: CircleRole | null;
      removed: boolean;
    }[]
  >`SELECT i.circle_id, i.role, i.expires_at, i.uses, i.max_uses, now() AS now, c.name,
      o.display_name AS owner_name,
      (SELECT count(*)::int FROM circle_members x WHERE x.circle_id = i.circle_id) AS member_count,
      (SELECT x.role FROM circle_members x
        WHERE x.circle_id = i.circle_id AND x.learner_id = ${me}) AS my_role,
      EXISTS (SELECT 1 FROM circle_removals r WHERE r.circle_id = i.circle_id
        AND r.learner_id = ${me} AND r.removed_at >= i.created_at) AS removed
    FROM circle_invites i
    JOIN study_circles c ON c.id = i.circle_id
    JOIN learners o ON o.user_id = c.owner_id
    WHERE i.token_hash = ${hashInviteToken(token)}`;
  if (!r) return no(404, "not_found", INVITE_GONE.missing);
  if (r.my_role)
    return ok({ status: "member", circleId: r.circle_id, circleName: r.name, myRole: r.my_role });
  if (r.removed) return no(403, "forbidden", INVITE_GONE.removed);
  return ok({
    status: inviteState({ expiresAt: r.expires_at, uses: r.uses, maxUses: r.max_uses }, r.now),
    circleName: r.name,
    ownerName: r.owner_name,
    role: r.role,
    memberCount: r.member_count,
    expiresAt: iso(r.expires_at),
  });
}

/**
 * Join through an invite link. Idempotent: someone already in the circle gets their current role
 * back (never the invite's), and no use is spent. The invite row is locked for the transaction,
 * and the use is spent with a guarded UPDATE, so a link can't be used more than `max_uses` times
 * even by joins at the same moment.
 */
export async function joinCircle(
  sql: Sql,
  me: string,
  token: string,
): Promise<Outcome<JoinResult>> {
  const hash = hashInviteToken(token);
  return sql.begin(async (tx) => {
    const [inv] = await tx<
      {
        circle_id: string;
        role: InviteRole;
        expires_at: Date;
        uses: number;
        max_uses: number;
        now: Date;
        removed: boolean;
      }[]
    >`SELECT i.circle_id, i.role, i.expires_at, i.uses, i.max_uses, now() AS now,
        EXISTS (SELECT 1 FROM circle_removals r WHERE r.circle_id = i.circle_id
          AND r.learner_id = ${me} AND r.removed_at >= i.created_at) AS removed
      FROM circle_invites i WHERE i.token_hash = ${hash} FOR UPDATE OF i`;
    if (!inv) return no(404, "not_found", INVITE_GONE.missing);
    const circleId = inv.circle_id;
    const [mine] = await tx<{ role: CircleRole }[]>`SELECT role FROM circle_members
      WHERE circle_id = ${circleId} AND learner_id = ${me}`;
    const decision = joinDecision(
      mine?.role ?? null,
      { role: inv.role, expiresAt: inv.expires_at, uses: inv.uses, maxUses: inv.max_uses },
      inv.now,
      inv.removed === true,
    );
    if (decision.type === "already") return ok({ circleId, role: decision.role, joined: false });
    if (decision.type === "removed") return no(403, "forbidden", INVITE_GONE.removed);
    if (decision.type !== "join") return no(410, "gone", INVITE_GONE[decision.type]);
    const n = count(
      await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM circle_members
      WHERE circle_id = ${circleId}`,
    );
    if (n >= LIMITS.membersPerCircle)
      return no(
        409,
        "limit_reached",
        `This circle is full (${LIMITS.membersPerCircle} members). Ask the owner to make room.`,
      );
    const spent = await tx`UPDATE circle_invites SET uses = uses + 1
      WHERE token_hash = ${hash} AND uses < max_uses AND expires_at > now() RETURNING uses`;
    if (!spent.length) return no(410, "gone", INVITE_GONE.used_up);
    const added = await tx`INSERT INTO circle_members (circle_id, learner_id, role)
      VALUES (${circleId}, ${me}, ${decision.role}) ON CONFLICT DO NOTHING RETURNING role`;
    if (!added.length) {
      // Joined through another link at the same moment: give the use back, keep that role.
      await tx`UPDATE circle_invites SET uses = uses - 1 WHERE token_hash = ${hash}`;
      const [now] = await tx<{ role: CircleRole }[]>`SELECT role FROM circle_members
        WHERE circle_id = ${circleId} AND learner_id = ${me}`;
      return ok({ circleId, role: now!.role, joined: false });
    }
    await tx`UPDATE study_circles SET updated_at = now() WHERE id = ${circleId}`;
    return ok({ circleId, role: decision.role, joined: true });
  }) as Promise<Outcome<JoinResult>>;
}

/* ---- Members ---- */

async function findMember(tx: Sql, circleId: string, key: string) {
  const rows = await tx<{ learner_id: string; role: CircleRole }[]>`SELECT learner_id, role
    FROM circle_members WHERE circle_id = ${circleId} FOR UPDATE`;
  return rows.find((r) => memberKey(circleId, r.learner_id) === key) ?? null;
}

const MEMBER_GONE = "That person isn't in this circle any more.";

/**
 * Owner only: make a member an editor or a viewer, or hand the circle to them ("owner": they
 * become the owner and you become an editor). The owner's own role can't be changed directly.
 */
export async function changeRole(
  sql: Sql,
  me: string,
  circleId: string,
  key: string,
  role: CircleRole,
): Promise<Outcome<{ ok: true }>> {
  return sql.begin(async (tx) => {
    const g = await gate(tx, me, circleId, "manage_members", true);
    if (!g.ok) return g;
    const target = await findMember(tx, circleId, key);
    if (!target) return no(404, "not_found", MEMBER_GONE);
    if (target.learner_id === me)
      return no(
        409,
        "conflict",
        "You're the owner. To step down, make another member the owner and you'll become an editor.",
      );
    if (target.role === role) return ok({ ok: true as const });
    if (role === "owner") {
      // One owner per circle (a unique index): step down first, then hand over.
      await tx`UPDATE circle_members SET role = 'editor'
        WHERE circle_id = ${circleId} AND learner_id = ${me}`;
      await tx`UPDATE circle_members SET role = 'owner'
        WHERE circle_id = ${circleId} AND learner_id = ${target.learner_id}`;
      await tx`UPDATE study_circles SET owner_id = ${target.learner_id}, updated_at = now()
        WHERE id = ${circleId}`;
    } else {
      await tx`UPDATE circle_members SET role = ${role}
        WHERE circle_id = ${circleId} AND learner_id = ${target.learner_id}`;
    }
    return ok({ ok: true as const });
  }) as Promise<Outcome<{ ok: true }>>;
}

/**
 * Owner only: take someone out of the circle (never yourself: you'd leave it ownerless). They
 * can't come back through any invite link made before now, only through one made afterwards.
 */
export async function removeMember(
  sql: Sql,
  me: string,
  circleId: string,
  key: string,
): Promise<Outcome<{ ok: true }>> {
  return sql.begin(async (tx) => {
    const g = await gate(tx, me, circleId, "manage_members", true);
    if (!g.ok) return g;
    const target = await findMember(tx, circleId, key);
    if (!target) return no(404, "not_found", MEMBER_GONE);
    if (target.learner_id === me)
      return no(
        409,
        "conflict",
        "You can't remove yourself: a circle needs its owner. Make another member the owner first, or delete the circle.",
      );
    await tx`DELETE FROM circle_members
      WHERE circle_id = ${circleId} AND learner_id = ${target.learner_id}`;
    // Every invite link made until now stops working for them (joinCircle checks this).
    await tx`INSERT INTO circle_removals (circle_id, learner_id)
      VALUES (${circleId}, ${target.learner_id})
      ON CONFLICT (circle_id, learner_id) DO UPDATE SET removed_at = now()`;
    await tx`UPDATE study_circles SET updated_at = now() WHERE id = ${circleId}`;
    return ok({ ok: true as const });
  }) as Promise<Outcome<{ ok: true }>>;
}

/* ---- Items ---- */

interface ItemRow {
  kind: ItemKind;
  title: string;
  url: string | null;
  summary: string;
  payload: Record<string, unknown>;
}

const NOT_YOURS = "That isn't in your library, so it can't be shared from there.";
const title = (v: unknown, fallback: string) => str(v, LIMITS.titleLength) || fallback;
const summary = (v: unknown) =>
  typeof v === "string" ? v.trim().slice(0, LIMITS.summaryLength) : "";

/**
 * A copy of something the caller owns, ready to add to a circle. Every lookup is by the item's id
 * AND the caller's learner id, so someone else's item is "not in your library" (404), the same as
 * one that doesn't exist.
 */
export async function copyFromLibrary(
  tx: Sql,
  me: string,
  source: ShareSource,
  id: string,
): Promise<ItemRow | Failure> {
  if (source === "collection_item") {
    const [r] = await tx<
      { kind: ItemKind; title: string; url: string | null; summary: string; payload: unknown }[]
    >`SELECT ci.kind, ci.title, ci.url, ci.summary, ci.payload
      FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
      WHERE ci.id = ${id} AND c.owner_id = ${me}`;
    if (!r) return no(404, "not_found", NOT_YOURS);
    return {
      kind: r.kind,
      title: title(r.title, "Shared item"),
      url: r.url ? httpsUrl(r.url) : null,
      summary: summary(r.summary),
      payload: itemPayload(
        previewFromPayload(r.kind, r.payload),
        sharedCopy(r.kind, r.payload),
        source,
      ),
    };
  }
  if (source === "saved_source") {
    const [r] = await tx<
      {
        title: string;
        url: string;
        summary: string;
        domain: string;
        resource_type: string;
        relevance_reason: string;
      }[]
    >`SELECT title, url, summary, domain, resource_type, relevance_reason FROM research_sources
      WHERE id = ${id} AND user_id = ${me} AND saved`;
    if (!r) return no(404, "not_found", NOT_YOURS);
    const url = httpsUrl(r.url);
    if (!url) return no(400, "bad_request", "That link isn't https, so it can't be shared.");
    return {
      kind: "resource",
      title: title(r.title, r.domain),
      url,
      summary: summary(r.summary),
      payload: itemPayload(
        { type: "none" },
        { domain: r.domain, resourceType: r.resource_type, relevance: r.relevance_reason },
        source,
      ),
    };
  }
  if (source === "study_plan") {
    const [p] = await tx<
      {
        title: string;
        goal: string;
        start_date: string;
        target_date: string | null;
        daily_minutes: number;
        days: unknown;
      }[]
    >`SELECT title, goal, start_date::text, target_date::text, daily_minutes, days
      FROM study_plans WHERE id = ${id} AND user_id = ${me}`;
    if (!p) return no(404, "not_found", NOT_YOURS);
    const items = await tx<
      { date: string; type: string; title: string; minutes: number }[]
    >`SELECT scheduled_date::text AS date, activity_type AS type, title,
        estimated_minutes AS minutes
      FROM study_plan_items WHERE study_plan_id = ${id} AND user_id = ${me}
      ORDER BY scheduled_date, position LIMIT 400`;
    const data = {
      goal: p.goal,
      startDate: p.start_date,
      targetDate: p.target_date,
      dailyMinutes: p.daily_minutes,
      days: arr(p.days).map((d) => {
        const day = obj(d);
        return {
          date: str(day.date, 10),
          focus: str(day.focus, 200),
          objectives: arr(day.objectives).map((o) => str(o, 200)),
          items: items
            .filter((i) => i.date === day.date)
            .map(({ type, title, minutes }) => ({ type, title, minutes })),
        };
      }),
    };
    return {
      kind: "plan",
      title: title(p.title, "Study plan"),
      url: null,
      summary: summary(p.goal),
      payload: itemPayload(planPreview(data), data, source),
    };
  }
  // A lesson the Librarian built. Its source list is shared, but pages from the student's own
  // notes are only marked as such (their file names stay private), and the notes text never goes.
  const [t] = await tx<{ lesson: unknown; lesson_sources: unknown }[]>`SELECT lesson,
      lesson_sources FROM librarian_tasks
    WHERE id = ${id} AND user_id = ${me} AND lesson IS NOT NULL`;
  if (!t) return no(404, "not_found", NOT_YOURS);
  const lesson = obj(t.lesson);
  const sources = arr(t.lesson_sources).map((s) => {
    const src = obj(s);
    const url = typeof src.url === "string" ? httpsUrl(src.url) : null;
    return {
      page: num(src.page),
      title: url ? str(src.title, 200) : "The sharer's own notes",
      url: url ?? "",
    };
  });
  return {
    kind: "lesson",
    title: title(lesson.title, "Lesson"),
    url: null,
    summary: summary(lesson.description),
    payload: itemPayload(lessonPreview(lesson), { lesson, sources }, source),
  };
}

/**
 * What of a personal-library item's payload a circle keeps. A saved lesson goes without the text
 * of the notes it was made from (`chunks`), the notes' file name and the sharer's place in it; a
 * saved plan without the id of the sharer's own plan. Notes and links go as they are (the note's
 * text is what's being shared).
 */
export function sharedCopy(kind: ItemKind, payload: unknown): unknown {
  const p = obj(payload);
  if (kind === "lesson")
    return {
      key: p.key,
      subject: p.subject,
      scenes: p.scenes,
      estimatedMinutes: p.estimatedMinutes,
      lesson: p.lesson,
    };
  if (kind === "plan") {
    const copy = { ...p };
    delete copy.planId;
    return copy;
  }
  return payload;
}

function directItem(input: NewItem): ItemRow | Failure {
  if (input.kind === "resource") {
    const url = httpsUrl(input.url);
    if (!url) return no(400, "bad_request", "Links need to start with https://.");
    return {
      kind: "resource",
      title: title(input.title, new URL(url).hostname),
      url,
      summary: summary(input.summary),
      payload: itemPayload({ type: "none" }),
    };
  }
  return {
    kind: "note",
    title: title(input.title, "Note"),
    url: null,
    summary: "",
    payload: itemPayload({ type: "note", text: input.text.trim().slice(0, LIMITS.noteLength) }),
  };
}

/** Editors and the owner: add a link or a note, or copy something from your own library. */
export async function addItem(
  sql: Sql,
  me: string,
  circleId: string,
  input: NewItem | { from: { source: ShareSource; id: string } },
): Promise<Outcome<{ id: string }>> {
  return sql.begin(async (tx) => {
    const g = await gate(tx, me, circleId, "add_item", true);
    if (!g.ok) return g;
    const n = count(
      await tx<{ n: number }[]>`SELECT count(*)::int AS n FROM circle_items
      WHERE circle_id = ${circleId}`,
    );
    if (n >= LIMITS.itemsPerCircle)
      return no(
        409,
        "limit_reached",
        `This circle holds up to ${LIMITS.itemsPerCircle} things. Remove some old ones to add more.`,
      );
    const row =
      "from" in input
        ? await copyFromLibrary(tx, me, input.from.source, input.from.id)
        : directItem(input);
    if ("ok" in row) return row;
    const id = randomUUID();
    await tx`INSERT INTO circle_items (id, circle_id, kind, title, url, summary, payload, added_by)
      VALUES (${id}, ${circleId}, ${row.kind}, ${row.title}, ${row.url}, ${row.summary},
        ${tx.json(row.payload as never)}, ${me})`;
    await tx`UPDATE study_circles SET updated_at = now() WHERE id = ${circleId}`;
    return ok({ id }, 201);
  }) as Promise<Outcome<{ id: string }>>;
}

/** Editors and the owner: take something out of the circle (anyone's, not just your own). */
export async function removeItem(
  sql: Sql,
  me: string,
  circleId: string,
  itemId: string,
): Promise<Outcome<{ ok: true }>> {
  return sql.begin(async (tx) => {
    const g = await gate(tx, me, circleId, "remove_item", true);
    if (!g.ok) return g;
    const gone = await tx`DELETE FROM circle_items
      WHERE id = ${itemId} AND circle_id = ${circleId} RETURNING 1`;
    if (!gone.length) return no(404, "not_found", "That's already gone from the circle.");
    await tx`UPDATE study_circles SET updated_at = now() WHERE id = ${circleId}`;
    return ok({ ok: true as const });
  }) as Promise<Outcome<{ ok: true }>>;
}

/** Things in your own library that can be copied into a circle (yours only, newest first). */
export async function shareable(sql: Sql, me: string): Promise<ShareableItem[]> {
  const [collected, saved, plans, lessons] = await Promise.all([
    sql<{ id: string; kind: ItemKind; title: string; collection: string }[]>`SELECT ci.id,
        ci.kind, ci.title, c.name AS collection
      FROM collection_items ci JOIN collections c ON c.id = ci.collection_id
      WHERE c.owner_id = ${me} ORDER BY ci.created_at DESC LIMIT 60`,
    sql<{ id: string; title: string; domain: string }[]>`SELECT id, title, domain
      FROM research_sources WHERE user_id = ${me} AND saved AND url LIKE 'https://%'
      ORDER BY saved_at DESC NULLS LAST LIMIT 60`,
    sql<{ id: string; title: string }[]>`SELECT id, title FROM study_plans
      WHERE user_id = ${me} ORDER BY created_at DESC LIMIT 30`,
    sql<{ id: string; title: string | null }[]>`SELECT id, lesson ->> 'title' AS title
      FROM librarian_tasks WHERE user_id = ${me} AND lesson IS NOT NULL
      ORDER BY created_at DESC LIMIT 30`,
  ]);
  return [
    ...collected.map((r) => ({
      source: "collection_item" as const,
      id: r.id,
      kind: r.kind,
      title: r.title,
      from: r.collection,
    })),
    ...saved.map((r) => ({
      source: "saved_source" as const,
      id: r.id,
      kind: "resource" as const,
      title: r.title || r.domain,
      from: "Saved from the Librarian",
    })),
    ...plans.map((r) => ({
      source: "study_plan" as const,
      id: r.id,
      kind: "plan" as const,
      title: r.title,
      from: "Your study plans",
    })),
    ...lessons.map((r) => ({
      source: "lesson" as const,
      id: r.id,
      kind: "lesson" as const,
      title: r.title || "Lesson",
      from: "Lessons from the Librarian",
    })),
  ];
}
