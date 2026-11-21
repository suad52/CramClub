import { generateSessionCookie } from "@auth0/nextjs-auth0/testing";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashInviteToken } from "@/lib/auth/inviteToken";
import {
  type CircleAction,
  DENIED,
  NOT_A_MEMBER,
  addItem,
  can,
  changeRole,
  createInvite,
  deleteCircle,
  getCircle,
  httpsUrl,
  inviteState,
  isCircleToken,
  isMemberKey,
  itemPayload,
  joinCircle,
  joinDecision,
  leaveCircle,
  markSeen,
  memberKey,
  previewFromPayload,
  previewInvite,
  removeItem,
  removeMember,
  revokeInvite,
  sharedCopy,
} from "./server";
import type { CircleRole } from "./types";

/** The database the route's requireUser sees (see the route tests at the end). */
const dbBox = vi.hoisted(() => ({ sql: null as unknown }));
vi.mock("@/lib/learning/server/db", () => ({ db: () => dbBox.sql }));

const CIRCLE = "11111111-1111-4111-8111-111111111111";
const OTHER_CIRCLE = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";
const OWNER = "0a000000-0000-4000-8000-000000000001";
const EDITOR = "0b000000-0000-4000-8000-000000000002";
const VIEWER = "0c000000-0000-4000-8000-000000000003";
const STRANGER = "0d000000-0000-4000-8000-000000000004";
const ROLES: Record<string, CircleRole> = {
  [OWNER]: "owner",
  [EDITOR]: "editor",
  [VIEWER]: "viewer",
};
const WHO = { owner: OWNER, editor: EDITOR, viewer: VIEWER, stranger: STRANGER } as const;

type Call = { text: string; values: unknown[] };
type Answer = (text: string, values: unknown[]) => unknown[] | undefined;

/**
 * A stand-in for postgres.js: records every query and answers membership lookups from `roles`
 * (the circle_members table for CIRCLE), then `extra`, then harmless defaults. `begin` runs the
 * callback with the same tag, so a test sees everything a transaction would have sent.
 */
function world(roles: Record<string, CircleRole> = ROLES, extra?: Answer) {
  const calls: Call[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    const answer = (): unknown[] => {
      const custom = extra?.(text, values);
      if (custom) return custom;
      if (text.startsWith("SELECT role FROM circle_members")) {
        const role = values[0] === CIRCLE ? roles[values[1] as string] : undefined;
        return role ? [{ role }] : [];
      }
      if (text.startsWith("SELECT learner_id, role FROM circle_members"))
        return Object.entries(roles).map(([learner_id, role]) => ({ learner_id, role }));
      if (text.startsWith("SELECT count(*)::int AS n")) return [{ n: 0 }];
      if (text.includes("RETURNING created_at, expires_at"))
        return [{ created_at: new Date(), expires_at: new Date(Date.now() + 7 * 86_400_000) }];
      if (text.includes("RETURNING")) return [{ ok: 1 }];
      return [];
    };
    return Promise.resolve(answer());
  };
  tag.begin = (fn: (tx: unknown) => unknown) => Promise.resolve(fn(tag));
  tag.json = (v: unknown) => v;
  return {
    sql: tag as unknown as postgres.Sql,
    calls,
    writes: () => calls.filter((c) => /^(INSERT|UPDATE|DELETE)/.test(c.text)),
  };
}

const note = { kind: "note" as const, title: "Week 3 summary", text: "Recursion on lists." };

/* ---- The role matrix ---- */

describe("can", () => {
  const matrix: Record<CircleAction, Record<CircleRole | "none", boolean>> = {
    view: { owner: true, editor: true, viewer: true, none: false },
    add_item: { owner: true, editor: true, viewer: false, none: false },
    remove_item: { owner: true, editor: true, viewer: false, none: false },
    invite: { owner: true, editor: false, viewer: false, none: false },
    manage_members: { owner: true, editor: false, viewer: false, none: false },
    delete_circle: { owner: true, editor: false, viewer: false, none: false },
    leave: { owner: false, editor: true, viewer: true, none: false },
  };
  for (const [action, row] of Object.entries(matrix))
    for (const [role, allowed] of Object.entries(row))
      it(`${role} ${allowed ? "may" : "may not"} ${action}`, () => {
        expect(can(role === "none" ? null : (role as CircleRole), action as CircleAction)).toBe(
          allowed,
        );
      });
});

/** Each action, run as each kind of caller: the status they get, and whether anything was written. */
const ACTIONS: Record<string, (sql: postgres.Sql, me: string) => Promise<{ status: number }>> = {
  "add an item": (sql, me) => addItem(sql, me, CIRCLE, note),
  "remove an item": (sql, me) => removeItem(sql, me, CIRCLE, ITEM),
  "make an invite": (sql, me) => createInvite(sql, me, CIRCLE, { role: "viewer" }),
  "revoke an invite": (sql, me) => revokeInvite(sql, me, CIRCLE, "f".repeat(64)),
  "change a role": (sql, me) => changeRole(sql, me, CIRCLE, memberKey(CIRCLE, VIEWER), "editor"),
  "remove a member": (sql, me) => removeMember(sql, me, CIRCLE, memberKey(CIRCLE, VIEWER)),
  "delete the circle": (sql, me) => deleteCircle(sql, me, CIRCLE),
  "leave the circle": (sql, me) => leaveCircle(sql, me, CIRCLE),
};

const EXPECTED: Record<string, Record<keyof typeof WHO, number>> = {
  "add an item": { owner: 201, editor: 201, viewer: 403, stranger: 404 },
  "remove an item": { owner: 200, editor: 200, viewer: 403, stranger: 404 },
  "make an invite": { owner: 201, editor: 403, viewer: 403, stranger: 404 },
  "revoke an invite": { owner: 200, editor: 403, viewer: 403, stranger: 404 },
  "change a role": { owner: 200, editor: 403, viewer: 403, stranger: 404 },
  "remove a member": { owner: 200, editor: 403, viewer: 403, stranger: 404 },
  "delete the circle": { owner: 200, editor: 403, viewer: 403, stranger: 404 },
  "leave the circle": { owner: 409, editor: 200, viewer: 200, stranger: 404 },
};

describe("every action checks membership and role on the server", () => {
  for (const [action, run] of Object.entries(ACTIONS))
    for (const [who, me] of Object.entries(WHO)) {
      const want = EXPECTED[action]![who as keyof typeof WHO];
      it(`${who}: ${action} → ${want}`, async () => {
        const db = world();
        const out = await run(db.sql, me);
        expect(out.status).toBe(want);
        if (want >= 400)
          expect(db.writes()).toEqual([]); // refused: nothing written
        else expect(db.writes().length).toBeGreaterThan(0);
        // The role was read from circle_members with the caller's own id, under a row lock.
        const gate = db.calls[0]!;
        expect(gate.text).toMatch(/^SELECT role FROM circle_members .* FOR SHARE$/);
        expect(gate.values).toEqual([CIRCLE, me]);
      });
    }

  it("tells a viewer who can add, and how to get there", async () => {
    const out = await addItem(world().sql, VIEWER, CIRCLE, note);
    expect(out).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    expect(!out.ok && out.message).toBe(
      "Only editors can add to this circle. Ask the owner to make you an editor.",
    );
  });

  it("tells an editor that members are the owner's to manage", async () => {
    const out = await removeMember(world().sql, EDITOR, CIRCLE, memberKey(CIRCLE, VIEWER));
    expect(!out.ok && out.message).toBe(DENIED.manage_members);
  });

  it("answers a non-member 404 without saying whether the circle exists", async () => {
    const db = world();
    const out = await getCircle(db.sql, STRANGER, CIRCLE);
    expect(out).toMatchObject({ ok: false, status: 404, message: NOT_A_MEMBER });
    expect(db.calls).toHaveLength(1); // nothing else about the circle was read
    expect(db.calls[0]!.text).toContain("m.learner_id = $");
    expect(db.calls[0]!.values).toEqual([CIRCLE, STRANGER]);
  });

  it("is 404 for a member of a different circle", async () => {
    const out = await addItem(world().sql, OWNER, OTHER_CIRCLE, note);
    expect(out.status).toBe(404);
  });

  it("only marks a visit for a member", async () => {
    const db = world(ROLES, (t, v) =>
      t.startsWith("UPDATE circle_members SET last_seen_at")
        ? ROLES[v[2] as string]
          ? [{}]
          : []
        : undefined,
    );
    expect((await markSeen(db.sql, STRANGER, CIRCLE, new Date())).status).toBe(404);
    expect((await markSeen(db.sql, VIEWER, CIRCLE, new Date())).status).toBe(200);
    // Never past the server's clock, never backwards.
    expect(db.calls[0]!.text).toContain("GREATEST(last_seen_at, LEAST(now(), $::timestamptz))");
  });
});

describe("owners and members", () => {
  it("the owner can't remove themselves or change their own role", async () => {
    const self = memberKey(CIRCLE, OWNER);
    const db = world();
    expect((await removeMember(db.sql, OWNER, CIRCLE, self)).status).toBe(409);
    expect((await changeRole(db.sql, OWNER, CIRCLE, self, "viewer")).status).toBe(409);
    expect(db.writes()).toEqual([]);
  });

  it("handing over a circle demotes the owner before promoting, keeping one owner", async () => {
    const db = world();
    const out = await changeRole(db.sql, OWNER, CIRCLE, memberKey(CIRCLE, EDITOR), "owner");
    expect(out.status).toBe(200);
    const [demote, promote, record] = db.writes();
    expect(demote!.text).toContain("SET role = 'editor'");
    expect(demote!.values).toContain(OWNER);
    expect(promote!.text).toContain("SET role = 'owner'");
    expect(promote!.values).toContain(EDITOR);
    expect(record!.text).toContain("UPDATE study_circles SET owner_id");
  });

  it("removing someone records it, so links made before then stop working for them", async () => {
    const db = world();
    expect((await removeMember(db.sql, OWNER, CIRCLE, memberKey(CIRCLE, VIEWER))).status).toBe(200);
    const record = db.writes().find((c) => c.text.startsWith("INSERT INTO circle_removals"))!;
    expect(record.values).toEqual([CIRCLE, VIEWER]);
    expect(record.text).toContain("DO UPDATE SET removed_at = now()"); // removed again: from now
  });

  it("leaving on your own isn't a removal", async () => {
    const db = world();
    expect((await leaveCircle(db.sql, VIEWER, CIRCLE)).status).toBe(200);
    expect(db.writes().some((c) => c.text.includes("circle_removals"))).toBe(false);
  });

  it("an unknown member handle is 404", async () => {
    const out = await removeMember(world().sql, OWNER, CIRCLE, "0".repeat(24));
    expect(out.status).toBe(404);
  });

  it("member handles hide learner ids and differ between circles", () => {
    const key = memberKey(CIRCLE, VIEWER);
    expect(isMemberKey(key)).toBe(true);
    expect(key).not.toContain(VIEWER.slice(0, 8));
    expect(memberKey(OTHER_CIRCLE, VIEWER)).not.toBe(key);
    expect(isMemberKey(VIEWER)).toBe(false);
  });
});

/* ---- Invites ---- */

const DAY = 86_400_000;
const NOW = new Date("2026-11-21T12:00:00Z");

describe("inviteState and joinDecision", () => {
  const invite = (over: Partial<{ expiresAt: Date; uses: number; maxUses: number }> = {}) => ({
    role: "editor" as const,
    expiresAt: new Date(NOW.getTime() + DAY),
    uses: 0,
    maxUses: 3,
    ...over,
  });

  it("expires at the expiry time and runs out at max uses", () => {
    expect(inviteState(invite(), NOW)).toBe("ok");
    expect(inviteState(invite({ expiresAt: NOW }), NOW)).toBe("expired");
    expect(inviteState(invite({ uses: 3 }), NOW)).toBe("used_up");
    expect(inviteState(invite({ uses: 2 }), NOW)).toBe("ok");
  });

  it("never changes an existing member's role, up or down", () => {
    expect(joinDecision("viewer", invite(), NOW)).toEqual({ type: "already", role: "viewer" });
    expect(joinDecision("owner", invite(), NOW)).toEqual({ type: "already", role: "owner" });
    expect(joinDecision("editor", { ...invite(), role: "viewer" }, NOW)).toEqual({
      type: "already",
      role: "editor",
    });
    // Idempotent even once the link has expired.
    expect(joinDecision("viewer", invite({ expiresAt: NOW }), NOW).type).toBe("already");
  });

  it("refuses someone removed after the link was made, but never touches a current member", () => {
    expect(joinDecision(null, invite(), NOW, true)).toEqual({ type: "removed" });
    expect(joinDecision("viewer", invite(), NOW, true)).toEqual({
      type: "already",
      role: "viewer",
    });
  });

  it("joins a newcomer with the invite's role, while it's valid", () => {
    expect(joinDecision(null, invite(), NOW)).toEqual({ type: "join", role: "editor" });
    expect(joinDecision(null, invite({ uses: 3 }), NOW)).toEqual({ type: "used_up" });
    expect(joinDecision(null, invite({ expiresAt: new Date(0) }), NOW)).toEqual({
      type: "expired",
    });
  });
});

/**
 * A database holding one invite and CIRCLE's members, that really counts uses and adds members,
 * for the join flow (the guarded UPDATE is evaluated the way Postgres would).
 */
function inviteWorld(
  invite: { role: CircleRole; expiresAt: Date; maxUses: number; uses?: number },
  { race = false } = {},
) {
  const token = "A".repeat(43);
  const hash = hashInviteToken(token);
  const state = {
    uses: invite.uses ?? 0,
    members: { ...ROLES } as Record<string, CircleRole>,
    /** Learners the owner removed after this invite was made. */
    removedSinceInvite: [] as string[],
  };
  const db = world(state.members, (t, v) => {
    if (t.includes("FROM circle_invites i WHERE i.token_hash = $ FOR UPDATE OF i")) {
      const [who, asked] = v as [string, string];
      expect(t).toContain("r.removed_at >= i.created_at");
      return asked === hash
        ? [
            {
              circle_id: CIRCLE,
              role: invite.role,
              expires_at: invite.expiresAt,
              uses: state.uses,
              max_uses: invite.maxUses,
              now: NOW,
              removed: state.removedSinceInvite.includes(who),
            },
          ]
        : [];
    }
    if (t.startsWith("SELECT count(*)::int AS n FROM circle_members"))
      return [{ n: Object.keys(state.members).length }];
    if (t.startsWith("UPDATE circle_invites SET uses = uses + 1")) {
      expect(t).toContain("uses < max_uses AND expires_at > now()");
      if (race || state.uses >= invite.maxUses || invite.expiresAt <= NOW) return [];
      state.uses += 1;
      return [{ uses: state.uses }];
    }
    if (t.startsWith("INSERT INTO circle_members")) {
      const [, who, role] = v as [string, string, CircleRole];
      if (state.members[who]) return [];
      state.members[who] = role;
      return [{ role }];
    }
    return undefined;
  });
  return { ...db, token, state };
}

describe("joinCircle", () => {
  const future = new Date(NOW.getTime() + 7 * DAY);
  const newcomers = [
    "1e000000-0000-4000-8000-000000000001",
    "1e000000-0000-4000-8000-000000000002",
    "1e000000-0000-4000-8000-000000000003",
  ];

  it("adds a newcomer with the invite's role and spends one use", async () => {
    const w = inviteWorld({ role: "editor", expiresAt: future, maxUses: 5 });
    const out = await joinCircle(w.sql, STRANGER, w.token);
    expect(out).toMatchObject({
      ok: true,
      body: { circleId: CIRCLE, role: "editor", joined: true },
    });
    expect(w.state.uses).toBe(1);
    expect(w.state.members[STRANGER]).toBe("editor");
  });

  it("can't be used beyond its max uses", async () => {
    const w = inviteWorld({ role: "viewer", expiresAt: future, maxUses: 2 });
    const results = [];
    for (const who of newcomers) results.push(await joinCircle(w.sql, who, w.token));
    expect(results.map((r) => r.status)).toEqual([200, 200, 410]);
    expect(w.state.uses).toBe(2);
    expect(w.state.members[newcomers[2]!]).toBeUndefined();
  });

  it("is refused once expired, and nothing is written", async () => {
    const w = inviteWorld({ role: "editor", expiresAt: new Date(NOW.getTime() - 1), maxUses: 5 });
    const out = await joinCircle(w.sql, STRANGER, w.token);
    expect(out).toMatchObject({ ok: false, status: 410, code: "gone" });
    expect(w.writes()).toEqual([]);
  });

  it("re-joining is idempotent and never escalates the role", async () => {
    const w = inviteWorld({ role: "editor", expiresAt: future, maxUses: 1 });
    const out = await joinCircle(w.sql, VIEWER, w.token);
    expect(out).toMatchObject({ ok: true, body: { role: "viewer", joined: false } });
    expect(w.state.members[VIEWER]).toBe("viewer");
    expect(w.state.uses).toBe(0); // no use spent, so the newcomer it was meant for still fits
    expect(w.writes()).toEqual([]);
    expect((await joinCircle(w.sql, STRANGER, w.token)).status).toBe(200);
  });

  it("loses a race for the last use cleanly", async () => {
    // The row said a use was left, but a parallel join spent it first: the guarded UPDATE decides.
    const w = inviteWorld({ role: "viewer", expiresAt: future, maxUses: 1 }, { race: true });
    const out = await joinCircle(w.sql, STRANGER, w.token);
    expect(out).toMatchObject({ ok: false, status: 410 });
    expect(w.state.members[STRANGER]).toBeUndefined();
    expect(w.writes().some((c) => c.text.startsWith("INSERT"))).toBe(false);
  });

  it("a removed member can't rejoin through a link made before they were removed", async () => {
    const w = inviteWorld({ role: "editor", expiresAt: future, maxUses: 5 });
    delete w.state.members[VIEWER]; // the owner removed them...
    w.state.removedSinceInvite.push(VIEWER); // ...after this link was made
    const out = await joinCircle(w.sql, VIEWER, w.token);
    expect(out).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    expect((out as { message: string }).message).toMatch(/removed you/);
    expect(w.state.members[VIEWER]).toBeUndefined();
    expect(w.state.uses).toBe(0);
    expect(w.writes()).toEqual([]);
    // Someone else can still use the same link.
    expect((await joinCircle(w.sql, STRANGER, w.token)).status).toBe(200);
  });

  it("a link made after the removal lets them back in (re-inviting is the owner's choice)", async () => {
    const w = inviteWorld({ role: "viewer", expiresAt: future, maxUses: 5 });
    delete w.state.members[VIEWER];
    const out = await joinCircle(w.sql, VIEWER, w.token);
    expect(out).toMatchObject({ ok: true, body: { role: "viewer", joined: true } });
  });

  it("the preview tells a removed member the link is closed to them", async () => {
    const db = world(ROLES, (t) =>
      t.includes("FROM circle_invites i JOIN study_circles c")
        ? [
            {
              circle_id: CIRCLE,
              role: "editor",
              expires_at: new Date(NOW.getTime() + DAY),
              uses: 0,
              max_uses: 5,
              now: NOW,
              name: "Calculus",
              owner_name: "Ada",
              member_count: 3,
              my_role: null,
              removed: true,
            },
          ]
        : undefined,
    );
    const out = await previewInvite(db.sql, STRANGER, "A".repeat(43));
    expect(out).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    const query = db.calls.find((c) => c.text.includes("FROM circle_invites i JOIN"))!;
    expect(query.text).toContain("r.removed_at >= i.created_at");
    expect(query.values).toContain(STRANGER);
  });

  it("a token that isn't on file is 404, and so is its preview", async () => {
    const w = inviteWorld({ role: "viewer", expiresAt: future, maxUses: 1 });
    expect((await joinCircle(w.sql, STRANGER, "B".repeat(43))).status).toBe(404);
    expect((await previewInvite(w.sql, STRANGER, "B".repeat(43))).status).toBe(404);
  });
});

describe("createInvite", () => {
  it("stores only the SHA-256 of a 32-byte token", async () => {
    const db = world();
    const out = await createInvite(db.sql, OWNER, CIRCLE, { role: "editor", days: 3, maxUses: 4 });
    if (!out.ok) throw new Error(out.message);
    const { token, id, path } = out.body;
    expect(isCircleToken(token)).toBe(true);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(path).toBe(`/circles/join/${token}`);
    const insert = db.writes().find((c) => c.text.startsWith("INSERT INTO circle_invites"))!;
    expect(insert.values[0]).toBe(hashInviteToken(token));
    expect(id).toBe(hashInviteToken(token));
    expect(JSON.stringify(insert.values)).not.toContain(token);
    expect(insert.values).toContain(3); // days
    expect(insert.values).toContain(4); // max uses
  });

  it("defaults to 7 days and 10 uses", async () => {
    const db = world();
    await createInvite(db.sql, OWNER, CIRCLE, { role: "viewer" });
    const insert = db.writes().find((c) => c.text.startsWith("INSERT INTO circle_invites"))!;
    expect(insert.values).toEqual(expect.arrayContaining([7, 10, "viewer", OWNER]));
  });

  it("caps open invites per circle", async () => {
    const db = world(ROLES, (t) =>
      t.startsWith("SELECT count(*)::int AS n FROM circle_invites") ? [{ n: 10 }] : undefined,
    );
    expect((await createInvite(db.sql, OWNER, CIRCLE, { role: "viewer" })).status).toBe(409);
  });
});

/* ---- Items and sharing from your library ---- */

describe("addItem", () => {
  it("copies from your library only what you own", async () => {
    for (const source of ["collection_item", "saved_source", "study_plan", "lesson"] as const) {
      const db = world(); // every library lookup finds nothing: not yours (or not there)
      const out = await addItem(db.sql, EDITOR, CIRCLE, { from: { source, id: ITEM } });
      expect(out).toMatchObject({ ok: false, status: 404 });
      const lookup = db.calls[2]!; // after the role check and the item count
      expect(lookup.values).toEqual(expect.arrayContaining([ITEM, EDITOR]));
      expect(lookup.text).toMatch(/(owner_id|user_id) = \$/);
      expect(db.writes()).toEqual([]);
    }
  });

  it("copies a saved source the caller owns, marked as from their library", async () => {
    const db = world(ROLES, (t) =>
      t.includes("FROM research_sources")
        ? [
            {
              title: "Structural recursion",
              url: "https://cs.uwaterloo.ca/recursion",
              summary: "Notes on recursion.",
              domain: "cs.uwaterloo.ca",
              resource_type: "article",
              relevance_reason: "Matches week 3",
            },
          ]
        : undefined,
    );
    const out = await addItem(db.sql, EDITOR, CIRCLE, {
      from: { source: "saved_source", id: ITEM },
    });
    expect(out.status).toBe(201);
    const insert = db.writes().find((c) => c.text.startsWith("INSERT INTO circle_items"))!;
    expect(insert.values).toEqual(
      expect.arrayContaining([
        "resource",
        "Structural recursion",
        "https://cs.uwaterloo.ca/recursion",
        EDITOR,
      ]),
    );
    expect(insert.values.find((v) => v !== null && typeof v === "object")).toMatchObject({
      copiedFrom: "saved_source",
    });
  });

  it("keeps the student's notes private when sharing a lesson", async () => {
    const db = world(ROLES, (t) =>
      t.includes("FROM librarian_tasks")
        ? [
            {
              lesson: {
                title: "Lists",
                description: "Recursion on lists",
                learningObjectives: ["Write a list template"],
                scenes: [{ title: "Cons" }, { title: "Empty" }],
              },
              lesson_sources: [
                { page: 1, title: "my-midterm-notes.pdf", url: "" },
                { page: 2, title: "HtDP", url: "https://htdp.org/2023-8-14/Book/" },
              ],
            },
          ]
        : undefined,
    );
    await addItem(db.sql, OWNER, CIRCLE, { from: { source: "lesson", id: ITEM } });
    const lookup = db.calls.find((c) => c.text.includes("FROM librarian_tasks"))!;
    expect(lookup.text).not.toContain("lesson_chunks"); // the notes' text is never read
    const insert = db.writes().find((c) => c.text.startsWith("INSERT INTO circle_items"))!;
    const payload = JSON.stringify(insert.values);
    expect(payload).not.toContain("my-midterm-notes");
    expect(payload).toContain("htdp.org");
    expect(insert.values.find((v) => v !== null && typeof v === "object")).toMatchObject({
      preview: { type: "lesson", scenes: ["Cons", "Empty"] },
    });
  });

  it("shares a saved lesson without the notes it was made from, or the sharer's place in it", async () => {
    const db = world(ROLES, (t) =>
      t.includes("FROM collection_items ci JOIN collections c")
        ? [
            {
              kind: "lesson",
              title: "Lists",
              url: null,
              summary: "Recursion on lists",
              payload: {
                key: "l-abc",
                subject: "CS135",
                scenes: 2,
                estimatedMinutes: 10,
                sourceName: "my-midterm-notes.pdf",
                progress: { scene: 1, completed: false },
                hasNotes: true,
                notesTrimmed: false,
                lesson: { title: "Lists", scenes: [{ title: "Cons" }, { title: "Empty" }] },
                chunks: [{ page: 1, text: "PRIVATE: my answers to question 4" }],
              },
            },
          ]
        : undefined,
    );
    const out = await addItem(db.sql, EDITOR, CIRCLE, {
      from: { source: "collection_item", id: ITEM },
    });
    expect(out.status).toBe(201);
    const insert = db.writes().find((c) => c.text.startsWith("INSERT INTO circle_items"))!;
    const stored = JSON.stringify(insert.values);
    expect(stored).not.toContain("PRIVATE: my answers");
    expect(stored).not.toContain("my-midterm-notes");
    expect(stored).not.toContain('"progress"');
    expect(insert.values.find((v) => v !== null && typeof v === "object")).toMatchObject({
      preview: { type: "lesson", scenes: ["Cons", "Empty"] },
      data: { lesson: { title: "Lists" } },
    });
  });

  it("shares a saved plan without the id of the sharer's own plan", () => {
    const copy = sharedCopy("plan", { planId: ITEM, goal: "Midterm", days: [] });
    expect(copy).toEqual({ goal: "Midterm", days: [] });
    expect(sharedCopy("note", { text: "Shared on purpose" })).toEqual({
      text: "Shared on purpose",
    });
  });

  it("only takes https links", async () => {
    const db = world();
    const out = await addItem(db.sql, EDITOR, CIRCLE, {
      kind: "resource",
      title: "Sneaky",
      url: "javascript:alert(1)",
    });
    expect(out.status).toBe(400);
    expect(httpsUrl("http://example.com")).toBeNull();
    expect(httpsUrl("https://user:pw@example.com")).toBeNull();
    expect(httpsUrl(" https://example.com/a b ")).toBe("https://example.com/a%20b");
  });

  it("caps items per circle", async () => {
    const db = world(ROLES, (t) =>
      t.startsWith("SELECT count(*)::int AS n FROM circle_items") ? [{ n: 300 }] : undefined,
    );
    expect((await addItem(db.sql, OWNER, CIRCLE, note)).status).toBe(409);
  });
});

describe("previews", () => {
  it("reads notes, lessons and plans from whatever shape a library item has", () => {
    expect(previewFromPayload("note", { text: "  hi  " })).toEqual({ type: "note", text: "hi" });
    expect(previewFromPayload("note", {})).toEqual({ type: "none" });
    expect(
      previewFromPayload("lesson", { lesson: { scenes: [{ title: "A" }], description: "d" } }),
    ).toMatchObject({ type: "lesson", scenes: ["A"], description: "d" });
    expect(
      previewFromPayload("plan", {
        days: [{ date: "2026-11-22", focus: "Lists", items: [{ title: "Read" }] }],
      }),
    ).toMatchObject({
      type: "plan",
      days: [{ date: "2026-11-22", focus: "Lists", items: ["Read"] }],
    });
    expect(previewFromPayload("resource", { anything: 1 })).toEqual({ type: "none" });
  });

  it("drops the full copy, never the preview, when it wouldn't fit", () => {
    const big = itemPayload({ type: "none" }, { text: "x".repeat(300_000) }, "collection_item");
    expect(big).toEqual({
      preview: { type: "none" },
      truncated: true,
      copiedFrom: "collection_item",
    });
  });
});

/* ---- Through the route ---- */

describe("/api/circles", () => {
  const ENV = {
    AUTH0_DOMAIN: "ovr-test.us.auth0.com",
    AUTH0_CLIENT_ID: "test-client",
    AUTH0_CLIENT_SECRET: "test-secret",
    AUTH0_SECRET: "a".repeat(64),
    APP_BASE_URL: "http://localhost:3100",
    LEARNER_SECRET: "b".repeat(64),
  };
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
  });
  afterEach(() => {
    for (const k of Object.keys(ENV)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
    dbBox.sql = null;
  });

  const SUBS: Record<string, string> = { [VIEWER]: "auth0|viewer", [STRANGER]: "auth0|stranger" };
  /** Signed in as `who` (a real SDK session cookie), against a fake database. */
  async function call(
    method: "GET" | "POST" | "DELETE",
    path: string[],
    { who, body, origin }: { who?: string; body?: unknown; origin?: string } = {},
  ) {
    const route = await import("@/app/api/circles/[...path]/route");
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (origin) headers.origin = origin;
    if (who) {
      const cookie = await generateSessionCookie(
        { user: { sub: SUBS[who]!, given_name: "Sam" } },
        { secret: ENV.AUTH0_SECRET },
      );
      headers.cookie = `__session=${cookie}`;
      dbBox.sql = world(ROLES, (t, v) =>
        t.includes("FROM learners WHERE auth0_sub =")
          ? [{ user_id: Object.keys(SUBS).find((id) => SUBS[id] === v[0]), display_name: "Sam" }]
          : t.includes("FROM circle_members m JOIN study_circles c")
            ? []
            : undefined,
      ).sql;
    } else dbBox.sql = world().sql;
    const request = new Request(`http://localhost:3100/api/circles/${path.join("/")}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await route[method](request, { params: Promise.resolve({ path }) });
    return { status: res.status, body: await res.json() };
  }

  it("is 503 auth_not_configured until the Auth0 keys are set", async () => {
    delete process.env.AUTH0_CLIENT_SECRET;
    const res = await call("GET", ["mine"]);
    expect(res).toMatchObject({ status: 503, body: { error: { code: "auth_not_configured" } } });
    expect((await call("POST", ["create"], { body: { name: "Calc" } })).status).toBe(503);
  });

  it("is 401 sign_in_required when signed out", async () => {
    const res = await call("GET", [CIRCLE]);
    expect(res).toMatchObject({ status: 401, body: { error: { code: "sign_in_required" } } });
  });

  it("refuses a viewer's add with the permission message", async () => {
    const res = await call("POST", [CIRCLE, "items"], { who: VIEWER, body: note });
    expect(res.status).toBe(403);
    expect(res.body.error).toEqual({ code: "forbidden", message: DENIED.add_item });
  });

  it("is 404 for someone outside the circle", async () => {
    expect((await call("GET", [CIRCLE], { who: STRANGER })).status).toBe(404);
    expect((await call("DELETE", [CIRCLE, "items", ITEM], { who: STRANGER })).status).toBe(404);
  });

  it("rejects bad input and changes sent from another site", async () => {
    expect(
      (await call("POST", [CIRCLE, "items"], { who: VIEWER, body: { kind: "x" } })).status,
    ).toBe(400);
    expect((await call("POST", ["join"], { who: VIEWER, body: { token: "../etc" } })).status).toBe(
      400,
    );
    const cross = await call("POST", [CIRCLE, "leave"], {
      who: VIEWER,
      origin: "https://evil.example",
    });
    expect(cross.status).toBe(403);
  });
});
