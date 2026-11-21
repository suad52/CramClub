import { generateSessionCookie } from "@auth0/nextjs-auth0/testing";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashEmail } from "@/lib/auth/emailHash";
import { hashInviteToken } from "@/lib/auth/inviteToken";
import { learnerCookieHeader } from "@/lib/learning/server/identity";
import {
  type HoldRow,
  MESSAGES,
  TABLE_IDS,
  TABLE_LIMITS,
  type Viewer,
  claimTable,
  createTableInvite,
  decideAccess,
  firstName,
  inviteByEmail,
  isTableId,
  isTableToken,
  joinTable,
  releaseTable,
  removeEmailInvite,
  sitAt,
  tableLabel,
  tableStatus,
  tablesView,
  updateTable,
} from "./server";
import { HOLD_MINUTES, type TableVisibility } from "./types";

/** The database the route's currentUser sees (see the route tests at the end). */
const dbBox = vi.hoisted(() => ({ sql: null as unknown }));
vi.mock("@/lib/learning/server/db", () => ({ db: () => dbBox.sql }));

const ADA = "0a000000-0000-4000-8000-000000000001"; // holds tables
const BEN = "0b000000-0000-4000-8000-000000000002"; // a stranger
const CY = "0c000000-0000-4000-8000-000000000003"; // in Ada's circle
const DEE = "0d000000-0000-4000-8000-000000000004"; // a guest
const EVE = "0e000000-0000-4000-8000-000000000005"; // signed up with only an email for a name
const FAY = "0f000000-0000-4000-8000-000000000006"; // tries lots of invite links
const GUS = "01000000-0000-4000-8000-000000000007"; // a returning signed-out visitor
const HAL = "02000000-0000-4000-8000-000000000008"; // invites lots of people by email
const CIRCLE = "11111111-1111-4111-8111-111111111111";
const OTHER_CIRCLE = "22222222-2222-4222-8222-222222222222";
const NAMES: Record<string, string> = {
  [ADA]: "Ada Lovelace",
  [BEN]: "Ben",
  [CY]: "Cy",
  [DEE]: "Dee",
  [EVE]: "eve.smith@example.com",
};
const MIN = 60_000;

const signedIn = (learnerId: string): Viewer => ({ learnerId, signedIn: true });
const anonymous = (learnerId: string | null): Viewer => ({ learnerId, signedIn: false });

/* ---- A small stand-in for the database ---- */

interface FakeHold {
  id: string;
  table_id: string;
  holder: string;
  visibility: TableVisibility;
  circle: string | null;
  ends_at: Date;
  released: boolean;
  guests: Set<string>;
}

interface FakeInvite {
  hash: string;
  hold: string;
  expires_at: Date;
}

interface FakeEmailInvite {
  id: string;
  hold: string;
  hash: string;
  masked: string;
}

type Call = { text: string; values: unknown[] };

/**
 * postgres.js, faked: it records every query and answers the ones lib/tables/server.ts sends from
 * a little state (holds, their guests, invites and circle members), the way Postgres would. The
 * SQL itself is checked against a real database in tables.live.test.ts.
 */
function world(
  init: {
    holds?: (Partial<FakeHold> & { table_id: string; holder: string })[];
    circles?: Record<string, { name: string; members: string[] }>;
    invites?: FakeInvite[];
    emailInvites?: FakeEmailInvite[];
    /** Learners' stored email hashes (learners.email_hash). */
    emails?: Record<string, string>;
    /** Runs before the hold INSERT (throw to play the database refusing it). */
    insertHold?: (values: unknown[], holds: FakeHold[]) => void;
  } = {},
) {
  const calls: Call[] = [];
  let n = 0;
  const holds: FakeHold[] = (init.holds ?? []).map((h) => ({
    id: h.id ?? `hold-${++n}`,
    visibility: "public",
    circle: null,
    ends_at: new Date(Date.now() + 30 * MIN),
    released: false,
    guests: new Set(),
    ...h,
  }));
  const circles = init.circles ?? { [CIRCLE]: { name: "Calc crew", members: [ADA, CY] } };
  const invites: FakeInvite[] = [...(init.invites ?? [])];
  const emailInvites: FakeEmailInvite[] = [...(init.emailInvites ?? [])];
  const emails = new Map<string, string | null>(Object.entries(init.emails ?? {}));
  const live = (h: FakeHold) => !h.released && h.ends_at.getTime() > Date.now();
  const member = (circle: string | null, who: string | null) =>
    !!circle && !!who && !!circles[circle]?.members.includes(who);

  const row = (h: FakeHold, me: string | null, email: string | null): HoldRow => ({
    id: h.id,
    table_id: h.table_id,
    visibility: h.visibility,
    ends_at: h.ends_at,
    now: new Date(),
    holder_name: NAMES[h.holder] ?? "Reader 1a2b",
    circle_name: h.circle ? (circles[h.circle]?.name ?? null) : null,
    mine: h.holder === me,
    guest: !!me && h.guests.has(me),
    in_circle: member(h.circle, me) && member(h.circle, h.holder),
    email_invited: !!email && emailInvites.some((e) => e.hold === h.id && e.hash === email),
    email_invites:
      h.holder === me
        ? emailInvites.filter((e) => e.hold === h.id).map(({ id, masked }) => ({ id, masked }))
        : null,
  });

  const answer = (text: string, v: unknown[]): unknown[] => {
    if (text.startsWith("SELECT h.id, h.table_id")) {
      const [me, , , email, , table] = v as (string | null)[];
      return holds
        .filter((h) => live(h) && (!table || h.table_id === table))
        .map((h) => row(h, me!, email!));
    }
    if (text.startsWith("SELECT 1 AS ok FROM circle_members"))
      return member(v[0] as string, v[1] as string) ? [{ ok: 1 }] : [];
    if (text.startsWith("INSERT INTO table_holds")) {
      init.insertHold?.(v, holds);
      const [id, table_id, holder, visibility, circle, minutes] = v as [
        string,
        string,
        string,
        TableVisibility,
        string | null,
        number,
      ];
      holds.push({
        id,
        table_id,
        holder,
        visibility,
        circle,
        ends_at: new Date(Date.now() + minutes * MIN),
        released: false,
        guests: new Set(),
      });
      return [];
    }
    if (text.startsWith("SELECT id, visibility, circle_id, ends_at FROM table_holds")) {
      const h = holds.find((x) => live(x) && x.table_id === v[0] && x.holder === v[1]);
      return h
        ? [{ id: h.id, visibility: h.visibility, circle_id: h.circle, ends_at: h.ends_at }]
        : [];
    }
    if (text.startsWith("UPDATE table_holds SET visibility")) {
      const h = holds.find((x) => x.id === v[2])!;
      h.visibility = v[0] as TableVisibility;
      h.circle = v[1] as string | null;
      return [];
    }
    if (text.startsWith("UPDATE table_holds SET released_at")) {
      const h = holds.find((x) => live(x) && x.table_id === v[0] && x.holder === v[1]);
      if (!h) return [];
      h.released = true;
      return [{ id: h.id }];
    }
    if (text.startsWith("DELETE FROM table_hold_invites WHERE hold_id")) {
      for (let i = invites.length - 1; i >= 0; i--)
        if (invites[i]!.hold === v[0]) invites.splice(i, 1);
      return [];
    }
    if (text.startsWith("SELECT count(*)::int AS n FROM table_hold_invites"))
      return [{ n: invites.filter((i) => i.hold === v[0]).length }];
    if (text.startsWith("INSERT INTO table_hold_invites")) {
      const [hash, hold, , expires_at] = v as [string, string, string, Date];
      invites.push({ hash, hold, expires_at });
      return [{ expires_at }];
    }
    if (text.startsWith("SELECT i.hold_id, h.table_id")) {
      const [me, hash] = v as [string, string];
      const inv = invites.find((i) => i.hash === hash);
      const h = inv && holds.find((x) => x.id === inv.hold);
      if (!inv || !h) return [];
      return [
        {
          hold_id: h.id,
          table_id: h.table_id,
          mine: h.holder === me,
          live: inv.expires_at.getTime() > Date.now() && live(h),
        },
      ];
    }
    if (text.startsWith("SELECT count(*)::int AS n FROM table_hold_guests"))
      return [{ n: holds.find((x) => x.id === v[0])?.guests.size ?? 0 }];
    if (text.startsWith("SELECT 1 FROM table_hold_guests"))
      return holds.find((x) => x.id === v[0])?.guests.has(v[1] as string) ? [{}] : [];
    if (text.startsWith("INSERT INTO table_hold_guests")) {
      holds.find((x) => x.id === v[0])!.guests.add(v[1] as string);
      return [];
    }
    if (text.includes("FROM learners WHERE auth0_sub =")) {
      const id = SUB_TO_ID[v[0] as string]!;
      return [{ user_id: id, display_name: "Sam", email_hash: emails.get(id) ?? null }];
    }
    if (text.startsWith("UPDATE learners SET email_hash = NULL WHERE email_hash =")) {
      for (const [id, hash] of emails) if (hash === v[0] && id !== v[1]) emails.set(id, null);
      return [];
    }
    if (text.startsWith("UPDATE learners SET email_hash =")) {
      emails.set(v[1] as string, v[0] as string | null);
      return [];
    }
    if (text.startsWith("SELECT count(*)::int AS n, coalesce(bool_or(email_hash =")) {
      const list = emailInvites.filter((e) => e.hold === v[1]);
      return [{ n: list.length, already: list.some((e) => e.hash === v[0]) }];
    }
    if (text.startsWith("INSERT INTO table_hold_email_invites")) {
      const [id, hold, hash, masked] = v as string[];
      const had = emailInvites.find((e) => e.hold === hold && e.hash === hash);
      if (had) had.masked = masked!;
      else emailInvites.push({ id: id!, hold: hold!, hash: hash!, masked: masked! });
      const out = had ?? emailInvites.at(-1)!;
      return [{ id: out.id, masked: out.masked }];
    }
    if (text.startsWith("DELETE FROM table_hold_email_invites WHERE id =")) {
      const at = emailInvites.findIndex((e) => e.id === v[0] && e.hold === v[1]);
      return at < 0 ? [] : emailInvites.splice(at, 1).map(({ id }) => ({ id }));
    }
    if (text.startsWith("DELETE FROM table_hold_email_invites WHERE hold_id =")) {
      for (let i = emailInvites.length - 1; i >= 0; i--)
        if (emailInvites[i]!.hold === v[0]) emailInvites.splice(i, 1);
      return [];
    }
    // anonymousLearner reading a cookie's learner: account learners are linked (so their
    // cookie alone is nobody), GUS is a returning visitor, anyone else has no row.
    if (text.startsWith("SELECT auth0_sub IS NOT NULL AS linked")) {
      if (Object.values(SUB_TO_ID).includes(v[0] as string))
        return [{ linked: true, display_name: NAMES[v[0] as string] ?? "Sam" }];
      return v[0] === GUS ? [{ linked: false, display_name: "Reader 0100" }] : [];
    }
    return [];
  };

  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    calls.push({ text, values });
    try {
      return Promise.resolve(answer(text, values));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  tag.begin = async (fn: (tx: unknown) => unknown) => fn(tag);
  tag.json = (v: unknown) => v;
  return {
    sql: tag as unknown as postgres.Sql,
    calls,
    holds,
    invites,
    emailInvites,
    emails,
    // The abandoned-hold sweep (housekeeping: gives up tables whose holder left) isn't counted.
    writes: () =>
      calls.filter(
        (c) => /^(INSERT|UPDATE|DELETE)/.test(c.text) && !c.text.includes("last_seen_at <"),
      ),
    sweeps: () => calls.filter((c) => c.text.includes("last_seen_at <")),
  };
}

const SUB_TO_ID: Record<string, string> = {
  "auth0|ada": ADA,
  "auth0|ben": BEN,
  "auth0|cy": CY,
  "auth0|dee": DEE,
  "auth0|fay": FAY,
  "auth0|hal": HAL,
};

/** A private table 3 held by Ada for her circle, with Dee on the guest list. */
const privateTable = () =>
  world({
    holds: [
      {
        id: "hold-ada",
        table_id: "hall-t03",
        holder: ADA,
        visibility: "private",
        circle: CIRCLE,
        guests: new Set([DEE]),
      },
    ],
  });

/* ---- The tables ---- */

describe("the tables", () => {
  it("are the 15 tableIds on the library's seats", () => {
    expect(TABLE_IDS).toHaveLength(15);
    for (let i = 1; i <= 12; i++)
      expect(TABLE_IDS).toContain(`hall-t${String(i).padStart(2, "0")}`);
    for (let i = 1; i <= 3; i++) expect(TABLE_IDS).toContain(`gallery-desk-${i}`);
    expect(isTableId("hall-t07")).toBe(true);
    for (const bad of ["hall-t13", "HALL-T01", "../hall-t01", "", null, 3])
      expect(isTableId(bad)).toBe(false);
  });

  it("have calm names", () => {
    expect(tableLabel("hall-t03")).toBe("table 3");
    expect(tableLabel("gallery-desk-2")).toBe("gallery desk 2");
  });

  it("only ever show a first name, never an email", () => {
    expect(firstName("Ada Lovelace")).toBe("Ada");
    expect(firstName("  Ben   ")).toBe("Ben");
    expect(firstName("Reader 1a2b")).toBe("Reader");
    expect(firstName("ada@example.com")).toBe("Someone");
    expect(firstName("")).toBe("Someone");
    expect(firstName(null)).toBe("Someone");
  });
});

/* ---- Who may sit ---- */

describe("decideAccess", () => {
  const hold = (visibility: TableVisibility, flags: Partial<HoldRow> = {}) => ({
    visibility,
    mine: false,
    guest: false,
    in_circle: false,
    ...flags,
  });

  it("lets anyone sit at a free or public table", () => {
    expect(decideAccess(null, anonymous(null))).toBe("free");
    expect(decideAccess(null, signedIn(BEN))).toBe("free");
    expect(decideAccess(hold("public"), anonymous(null))).toBe("public");
    expect(decideAccess(hold("public"), anonymous(BEN))).toBe("public");
    expect(decideAccess(hold("public"), signedIn(BEN))).toBe("public");
    expect(decideAccess(hold("public", { mine: true }), anonymous(ADA))).toBe("holder");
  });

  it("lets only the holder, guests and circle members sit at a private table", () => {
    expect(decideAccess(hold("private", { mine: true }), signedIn(ADA))).toBe("holder");
    expect(decideAccess(hold("private", { guest: true }), signedIn(DEE))).toBe("guest");
    expect(decideAccess(hold("private", { in_circle: true }), signedIn(CY))).toBe("circle");
    expect(decideAccess(hold("private"), signedIn(BEN))).toBeNull();
  });

  it("lets in a student whose verified email the holder invited", () => {
    const invited = hold("private", { email_invited: true });
    expect(decideAccess(invited, { ...signedIn(BEN), emailHash: "e".repeat(64) })).toBe("email");
    expect(decideAccess(invited, signedIn(BEN))).toBeNull(); // no verified email this time
    expect(decideAccess(invited, { ...anonymous(BEN), emailHash: "e".repeat(64) })).toBeNull();
    expect(decideAccess(hold("public", { email_invited: true }), anonymous(null))).toBe("public");
  });

  it("needs a verified sign-in for anything private", () => {
    expect(decideAccess(hold("private"), anonymous(null))).toBeNull();
    expect(decideAccess(hold("private", { guest: true }), anonymous(DEE))).toBeNull();
    expect(decideAccess(hold("private", { in_circle: true }), anonymous(CY))).toBeNull();
    expect(decideAccess(hold("private", { mine: true }), anonymous(ADA))).toBeNull();
    expect(
      decideAccess(hold("private", { guest: true }), { learnerId: null, signedIn: true }),
    ).toBeNull();
  });
});

describe("tableStatus", () => {
  const row = (over: Partial<HoldRow> = {}): HoldRow => ({
    id: "hold-1",
    table_id: "hall-t03",
    visibility: "private",
    ends_at: new Date("2026-11-21T16:00:00Z"),
    now: new Date("2026-11-21T15:20:00Z"),
    holder_name: "Ada Lovelace",
    circle_name: "Calc crew",
    mine: false,
    guest: false,
    in_circle: false,
    ...over,
  });

  it("tells a stranger only who, how and until when", () => {
    const status = tableStatus("hall-t03", row(), signedIn(BEN));
    expect(status).toEqual({
      tableId: "hall-t03",
      held: true,
      visibility: "private",
      holderName: "Ada",
      endsAt: "2026-11-21T16:00:00.000Z",
      canSit: false,
      mine: false,
      access: null,
      circleName: null, // the circle is only named to students it lets in
    });
    // No ids, guest lists or anything else ever leave the server.
    expect(JSON.stringify(status)).not.toMatch(/hold-1|Lovelace|guest"|learner|[0-9a-f]{8}-/);
  });

  it("names the circle to the holder and to students the table lets in", () => {
    expect(tableStatus("hall-t03", row({ mine: true }), signedIn(ADA))).toMatchObject({
      mine: true,
      access: "holder",
      canSit: true,
      circleName: "Calc crew",
    });
    expect(tableStatus("hall-t03", row({ guest: true }), signedIn(DEE)).circleName).toBe(
      "Calc crew",
    );
    expect(tableStatus("hall-t03", row({ in_circle: true }), signedIn(CY)).access).toBe("circle");
    expect(
      tableStatus("hall-t03", row({ visibility: "public" }), signedIn(BEN)).circleName,
    ).toBeNull();
  });

  it("is free and open when nobody holds it", () => {
    expect(tableStatus("hall-t01", null, anonymous(null))).toEqual({
      tableId: "hall-t01",
      held: false,
      visibility: null,
      holderName: null,
      endsAt: null,
      canSit: true,
      mine: false,
      access: "free",
      circleName: null,
    });
  });
});

describe("tablesView", () => {
  it("lists every table, and the one the student holds", async () => {
    const db = privateTable();
    const view = await tablesView(db.sql, signedIn(ADA), true);
    expect(view.tables).toHaveLength(15);
    expect(view.mine).toMatchObject({ tableId: "hall-t03", mine: true, visibility: "private" });
    expect(view).toMatchObject({ signedIn: true, privateAvailable: true });
    expect(new Date(view.serverTime).getTime()).not.toBeNaN();
    const stranger = await tablesView(db.sql, anonymous(null), false);
    expect(stranger.mine).toBeNull();
    expect(stranger.tables.find((t) => t.tableId === "hall-t03")).toMatchObject({
      held: true,
      canSit: false,
      holderName: "Ada",
    });
    expect(stranger.tables.filter((t) => t.canSit)).toHaveLength(14);
  });

  it("reads only live holds, by the database's clock, with the viewer's own id", async () => {
    const db = world();
    await tablesView(db.sql, signedIn(BEN), true);
    const read = db.calls[0]!;
    expect(read.text).toContain("WHERE h.released_at IS NULL AND h.ends_at > now()");
    expect(read.values.slice(0, 3)).toEqual([BEN, BEN, BEN]);
    // The circle counts only while the holder is still in it too.
    expect(read.text).toContain("o.learner_id = h.holder_id");
  });
});

describe("sitAt", () => {
  it("says yes at a free table, and offers it to the first sitter", async () => {
    const out = await sitAt(world().sql, anonymous(null), "hall-t01");
    expect(out).toMatchObject({ status: 200, body: { ok: true, firstHere: true } });
    expect(out.body.status.access).toBe("free");
  });

  it("doesn't offer a second table to someone already holding one", async () => {
    const db = world({ holds: [{ table_id: "hall-t05", holder: BEN }] });
    const out = await sitAt(db.sql, signedIn(BEN), "hall-t01");
    expect(out.body).toMatchObject({ ok: true, firstHere: false });
  });

  it("lets anyone sit at a public table", async () => {
    const db = world({ holds: [{ table_id: "hall-t02", holder: ADA }] });
    const out = await sitAt(db.sql, anonymous(null), "hall-t02");
    expect(out.body).toMatchObject({ ok: true, firstHere: false, status: { access: "public" } });
  });

  it("turns a stranger away from a private table, saying who has it and for how long", async () => {
    const db = privateTable();
    const out = await sitAt(db.sql, signedIn(BEN), "hall-t03");
    expect(out.status).toBe(403);
    expect(out.body).toMatchObject({ ok: false, reason: "private" });
    expect(!out.body.ok && out.body.message).toMatch(
      /^This table is private\. Ada has it for another (29|30) minutes, so ask them for an invite link/,
    );
    expect(db.writes()).toEqual([]);
  });

  it("asks a signed-out student to sign in", async () => {
    const out = await sitAt(privateTable().sql, anonymous(DEE), "hall-t03");
    expect(out.status).toBe(401);
    expect(out.body).toMatchObject({ ok: false, reason: "sign_in_required" });
    expect(!out.body.ok && out.body.message).toContain("If they invited you, sign in");
  });

  it("lets in the holder, a guest and a circle member", async () => {
    const db = privateTable();
    for (const [who, access] of [
      [ADA, "holder"],
      [DEE, "guest"],
      [CY, "circle"],
    ] as const) {
      const out = await sitAt(db.sql, signedIn(who), "hall-t03");
      expect(out.status).toBe(200);
      expect(out.body.status).toMatchObject({ canSit: true, access, circleName: "Calc crew" });
    }
  });

  it("stops letting the circle in once the holder has left it", async () => {
    const db = world({
      holds: [{ table_id: "hall-t03", holder: ADA, visibility: "private", circle: CIRCLE }],
      circles: { [CIRCLE]: { name: "Calc crew", members: [CY] } },
    });
    expect((await sitAt(db.sql, signedIn(CY), "hall-t03")).status).toBe(403);
  });

  it("treats a hold that has run out as a free table", async () => {
    const db = world({
      holds: [
        {
          table_id: "hall-t03",
          holder: ADA,
          visibility: "private",
          ends_at: new Date(Date.now() - 1000),
        },
      ],
    });
    const out = await sitAt(db.sql, signedIn(BEN), "hall-t03");
    expect(out.body).toMatchObject({ ok: true, firstHere: true, status: { held: false } });
  });
});

/* ---- Holding a table ---- */

describe("claimTable", () => {
  it("holds a free table for HOLD_MINUTES, public for anyone (signed in or not)", async () => {
    const db = world();
    const out = await claimTable(
      db.sql,
      anonymous(BEN),
      "hall-t01",
      { visibility: "public" },
      true,
    );
    expect(out).toMatchObject({ ok: true, status: 201 });
    const insert = db.writes().find((c) => c.text.startsWith("INSERT INTO table_holds"))!;
    expect(insert.text).toContain("now() + make_interval(mins => $::int)");
    expect(insert.values.slice(1)).toEqual(["hall-t01", BEN, "public", null, HOLD_MINUTES]);
    if (!out.ok) throw new Error();
    expect(out.body).toMatchObject({ mine: true, access: "holder", holderName: "Ben" });
    const minutes = (new Date(out.body.endsAt!).getTime() - Date.now()) / MIN;
    expect(minutes).toBeGreaterThan(59);
    expect(minutes).toBeLessThanOrEqual(60);
  });

  it("holds it private for a signed-in student, with their own circle", async () => {
    const db = world();
    const out = await claimTable(
      db.sql,
      signedIn(ADA),
      "hall-t04",
      { visibility: "private", circleId: CIRCLE },
      true,
    );
    expect(out).toMatchObject({
      ok: true,
      status: 201,
      body: { visibility: "private", circleName: "Calc crew" },
    });
    // Membership was checked with Ada's own id, under a share lock.
    const check = db.calls.find((c) => c.text.startsWith("SELECT 1 AS ok FROM circle_members"))!;
    expect(check.values).toEqual([CIRCLE, ADA]);
    expect(check.text).toMatch(/FOR SHARE$/);
  });

  it("needs a sign-in, and sign-in set up, to go private", async () => {
    const db = world();
    const out = await claimTable(
      db.sql,
      anonymous(BEN),
      "hall-t01",
      { visibility: "private" },
      true,
    );
    expect(out).toMatchObject({ ok: false, status: 401, code: "sign_in_required" });
    const off = await claimTable(
      db.sql,
      signedIn(BEN),
      "hall-t01",
      { visibility: "private" },
      false,
    );
    expect(off).toMatchObject({ ok: false, status: 503, code: "auth_not_configured" });
    const circle = await claimTable(
      db.sql,
      anonymous(BEN),
      "hall-t01",
      { visibility: "public", circleId: CIRCLE },
      true,
    );
    expect(circle.status).toBe(401);
    expect(db.calls).toEqual([]);
  });

  it("won't use a circle the student isn't in", async () => {
    const db = world();
    const out = await claimTable(
      db.sql,
      signedIn(BEN),
      "hall-t01",
      { visibility: "private", circleId: CIRCLE },
      true,
    );
    expect(out).toMatchObject({ status: 404, message: MESSAGES.notInCircle });
    const other = await claimTable(
      db.sql,
      signedIn(ADA),
      "hall-t01",
      { visibility: "private", circleId: OTHER_CIRCLE },
      true,
    );
    expect(other.status).toBe(404);
    expect(db.writes()).toEqual([]);
  });

  it("is 409 table_taken when someone holds it, saying who and for how long", async () => {
    const db = privateTable();
    const out = await claimTable(db.sql, signedIn(BEN), "hall-t03", { visibility: "public" }, true);
    expect(out).toMatchObject({ ok: false, status: 409, code: "table_taken" });
    expect(!out.ok && out.message).toMatch(/^Ada is holding table 3 for another (29|30) minutes\./);
    expect(db.writes()).toEqual([]);
  });

  it("holds one table per student at a time", async () => {
    const db = world({ holds: [{ table_id: "hall-t05", holder: BEN }] });
    const out = await claimTable(db.sql, signedIn(BEN), "hall-t01", { visibility: "public" }, true);
    expect(out).toMatchObject({ ok: false, status: 409, code: "already_holding" });
    expect(!out.ok && out.message).toContain("You're already holding table 5");
    expect(db.writes()).toEqual([]);
  });

  it("holding your own table again changes nothing", async () => {
    const db = privateTable();
    const out = await claimTable(db.sql, signedIn(ADA), "hall-t03", { visibility: "public" }, true);
    expect(out).toMatchObject({ ok: true, status: 200, body: { visibility: "private" } });
    expect(db.writes()).toEqual([]);
  });

  it("lets the free table go to whoever the database lets in first", async () => {
    // Ben and Cy both see table 1 free; Cy's insert commits first, so the exclusion constraint
    // refuses Ben's. Ben hears that Cy is there, not an error.
    const state = world({
      insertHold: (values, holds) => {
        if (values[2] !== BEN) return;
        holds.push({
          id: "hold-cy",
          table_id: "hall-t01",
          holder: CY,
          visibility: "public",
          circle: null,
          ends_at: new Date(Date.now() + HOLD_MINUTES * MIN),
          released: false,
          guests: new Set(),
        });
        throw Object.assign(new Error("conflicting key value violates exclusion constraint"), {
          code: "23P01",
          constraint_name: "table_holds_one_per_table",
        });
      },
    });
    const out = await claimTable(
      state.sql,
      signedIn(BEN),
      "hall-t01",
      { visibility: "public" },
      true,
    );
    expect(out).toMatchObject({ ok: false, status: 409, code: "table_taken" });
    expect(!out.ok && out.message).toMatch(/^Cy is holding table 1/);
    expect(state.holds.filter((h) => h.table_id === "hall-t01").map((h) => h.holder)).toEqual([CY]);
  });

  it("takes turns per table, then per student, before checking", async () => {
    const db = world();
    await claimTable(db.sql, signedIn(BEN), "hall-t01", { visibility: "public" }, true);
    const [first, second, check] = db.calls;
    expect(first!.text).toBe("SELECT pg_advisory_xact_lock($::int, hashtext($))");
    expect(first!.values).toEqual([7301, "hall-t01"]);
    expect(second!.values).toEqual([7302, BEN]);
    expect(check!.text).toMatch(/^SELECT h\.id, h\.table_id/);
  });

  it("treats a deadlock between two claims as a lost race", async () => {
    const db = world({
      insertHold: (values, holds) => {
        holds.push({
          id: "hold-cy",
          table_id: "hall-t02",
          holder: BEN,
          visibility: "public",
          circle: null,
          ends_at: new Date(Date.now() + HOLD_MINUTES * MIN),
          released: false,
          guests: new Set(),
        });
        throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
      },
    });
    const out = await claimTable(db.sql, signedIn(BEN), "hall-t01", { visibility: "public" }, true);
    expect(out).toMatchObject({ ok: false, status: 409, code: "already_holding" });
  });

  it("passes on database errors that aren't a lost race", async () => {
    const db = world({
      insertHold: () => {
        throw Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
      },
    });
    await expect(
      claimTable(db.sql, signedIn(BEN), "hall-t01", { visibility: "public" }, true),
    ).rejects.toThrow("connection reset");
  });

  it("tidies away holds that ended over a day ago after a claim", async () => {
    const db = world();
    await claimTable(db.sql, signedIn(BEN), "hall-t01", { visibility: "public" }, true);
    expect(db.calls.at(-1)!.text).toContain(
      "DELETE FROM table_holds WHERE ends_at < now() - interval '1 day'",
    );
  });
});

describe("updateTable", () => {
  it("lets only the holder change a hold (404 for anyone else)", async () => {
    const db = privateTable();
    for (const viewer of [signedIn(BEN), signedIn(DEE), signedIn(CY), anonymous(null)]) {
      const out = await updateTable(db.sql, viewer, "hall-t03", { visibility: "public" }, true);
      expect(out).toMatchObject({ ok: false, status: 404, message: MESSAGES.notHolding });
    }
    expect(db.writes()).toEqual([]);
  });

  it("switches public and private, and picks or clears the circle", async () => {
    const db = world({ holds: [{ table_id: "hall-t02", holder: ADA }] });
    const priv = await updateTable(
      db.sql,
      signedIn(ADA),
      "hall-t02",
      { visibility: "private", circleId: CIRCLE },
      true,
    );
    expect(priv).toMatchObject({
      ok: true,
      body: { visibility: "private", circleName: "Calc crew", mine: true },
    });
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t02")).status).toBe(403);
    expect((await sitAt(db.sql, signedIn(CY), "hall-t02")).status).toBe(200);
    const cleared = await updateTable(db.sql, signedIn(ADA), "hall-t02", { circleId: null }, true);
    expect(cleared).toMatchObject({ ok: true, body: { visibility: "private", circleName: null } });
    expect((await sitAt(db.sql, signedIn(CY), "hall-t02")).status).toBe(403);
    const pub = await updateTable(
      db.sql,
      signedIn(ADA),
      "hall-t02",
      { visibility: "public" },
      true,
    );
    expect(pub).toMatchObject({ ok: true, body: { visibility: "public" } });
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t02")).status).toBe(200);
    // The hold row was locked for each change.
    expect(db.calls.find((c) => c.text.startsWith("SELECT id, visibility"))!.text).toMatch(
      /FOR UPDATE$/,
    );
  });

  it("needs a sign-in to go private, and a circle the holder is in", async () => {
    const db = world({ holds: [{ table_id: "hall-t02", holder: BEN }] });
    const out = await updateTable(
      db.sql,
      anonymous(BEN),
      "hall-t02",
      { visibility: "private" },
      true,
    );
    expect(out).toMatchObject({ status: 401, code: "sign_in_required" });
    const off = await updateTable(
      db.sql,
      signedIn(BEN),
      "hall-t02",
      { visibility: "private" },
      false,
    );
    expect(off).toMatchObject({ status: 503, code: "auth_not_configured" });
    const circle = await updateTable(db.sql, signedIn(BEN), "hall-t02", { circleId: CIRCLE }, true);
    expect(circle).toMatchObject({ status: 404, message: MESSAGES.notInCircle });
    expect(db.writes()).toEqual([]);
    // An anonymous holder can still keep their table public.
    const pub = await updateTable(
      db.sql,
      anonymous(BEN),
      "hall-t02",
      { visibility: "public" },
      true,
    );
    expect(pub.ok).toBe(true);
  });
});

describe("releaseTable", () => {
  it("lets the holder give the table up early, and its links stop working", async () => {
    const db = privateTable();
    db.invites.push({ hash: "f".repeat(64), hold: "hold-ada", expires_at: db.holds[0]!.ends_at });
    expect((await releaseTable(db.sql, signedIn(BEN), "hall-t03")).status).toBe(404);
    expect(db.invites).toHaveLength(1);
    expect(await releaseTable(db.sql, signedIn(ADA), "hall-t03")).toMatchObject({
      ok: true,
      body: { ok: true },
    });
    expect(db.invites).toEqual([]);
    const sit = await sitAt(db.sql, signedIn(BEN), "hall-t03");
    expect(sit.body).toMatchObject({ ok: true, firstHere: true });
    expect((await releaseTable(db.sql, signedIn(ADA), "hall-t03")).status).toBe(404);
  });
});

/* ---- Invite links ---- */

describe("createTableInvite", () => {
  it("makes a 32-byte link for this hold, keeping only its hash, until the hold ends", async () => {
    const db = privateTable();
    const out = await createTableInvite(
      db.sql,
      signedIn(ADA),
      "hall-t03",
      "http://localhost:3100/",
      true,
    );
    if (!out.ok) throw new Error(out.message);
    expect(out.status).toBe(201);
    const token = out.body.path.replace("/tables/join/", "");
    expect(isTableToken(token)).toBe(true);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(out.body.link).toBe(`http://localhost:3100/tables/join/${token}`);
    expect(out.body.expiresAt).toBe(db.holds[0]!.ends_at.toISOString());
    expect(db.invites).toEqual([
      { hash: hashInviteToken(token), hold: "hold-ada", expires_at: db.holds[0]!.ends_at },
    ]);
    expect(JSON.stringify(db.calls)).not.toContain(token);
  });

  it("is the private holder's alone", async () => {
    const db = privateTable();
    expect((await createTableInvite(db.sql, signedIn(DEE), "hall-t03", "", true)).status).toBe(404);
    expect((await createTableInvite(db.sql, anonymous(ADA), "hall-t03", "", true)).status).toBe(
      401,
    );
    expect((await createTableInvite(db.sql, signedIn(ADA), "hall-t03", "", false)).status).toBe(
      503,
    );
    const pub = world({ holds: [{ table_id: "hall-t02", holder: ADA }] });
    const out = await createTableInvite(pub.sql, signedIn(ADA), "hall-t02", "", true);
    expect(out).toMatchObject({ status: 409, message: MESSAGES.inviteNeedsPrivate });
    expect(db.invites).toEqual([]);
    expect(pub.invites).toEqual([]);
  });

  it("caps open links per hold", async () => {
    const db = privateTable();
    for (let i = 0; i < TABLE_LIMITS.invitesPerHold; i++)
      db.invites.push({ hash: String(i), hold: "hold-ada", expires_at: db.holds[0]!.ends_at });
    const out = await createTableInvite(db.sql, signedIn(ADA), "hall-t03", "", true);
    expect(out).toMatchObject({ status: 409, code: "limit_reached" });
  });
});

describe("joinTable", () => {
  async function withLink(db = privateTable()) {
    const out = await createTableInvite(db.sql, signedIn(ADA), "hall-t03", "", true);
    if (!out.ok) throw new Error(out.message);
    return { db, token: out.body.path.split("/").at(-1)! };
  }

  it("adds a signed-in student to that hold's guest list, and lets them sit", async () => {
    const { db, token } = await withLink();
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t03")).status).toBe(403);
    const out = await joinTable(db.sql, BEN, token);
    expect(out).toMatchObject({
      ok: true,
      body: { tableId: "hall-t03", status: { canSit: true, access: "guest" } },
    });
    expect(db.holds[0]!.guests.has(BEN)).toBe(true);
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t03")).status).toBe(200);
    // Looked up by hash only, with the hold locked against a release or another join at once.
    const lookup = db.calls.find((c) => c.text.startsWith("SELECT i.hold_id"))!;
    expect(lookup.values).toEqual([BEN, hashInviteToken(token)]);
    expect(lookup.text).toMatch(/FOR NO KEY UPDATE OF h$/);
  });

  it("lasts only as long as the hold: a new hold at the same table starts with no guests", async () => {
    const { db, token } = await withLink();
    await joinTable(db.sql, BEN, token);
    await releaseTable(db.sql, signedIn(ADA), "hall-t03");
    await claimTable(db.sql, signedIn(ADA), "hall-t03", { visibility: "private" }, true);
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t03")).status).toBe(403);
    expect(await joinTable(db.sql, BEN, token)).toMatchObject({ status: 404 });
  });

  it("is 410 once the hold is over, and 404 for a link that never was", async () => {
    const { db, token } = await withLink();
    db.holds[0]!.ends_at = new Date(Date.now() - 1000);
    expect(await joinTable(db.sql, BEN, token)).toMatchObject({
      status: 410,
      message: MESSAGES.linkOver,
    });
    expect(await joinTable(db.sql, BEN, "A".repeat(43))).toMatchObject({
      status: 404,
      message: MESSAGES.linkMissing,
    });
    expect(db.holds[0]!.guests.has(BEN)).toBe(false);
  });

  it("changes nothing for the holder or someone already on the list", async () => {
    const { db, token } = await withLink();
    expect((await joinTable(db.sql, ADA, token)).ok).toBe(true);
    expect(db.holds[0]!.guests.has(ADA)).toBe(false);
    expect((await joinTable(db.sql, DEE, token)).ok).toBe(true);
    expect(db.holds[0]!.guests.size).toBe(1);
  });

  it("caps guests per hold", async () => {
    const { db, token } = await withLink();
    for (let i = 0; i < TABLE_LIMITS.guestsPerHold; i++) db.holds[0]!.guests.add(`g${i}`);
    expect(await joinTable(db.sql, BEN, token)).toMatchObject({
      status: 409,
      code: "limit_reached",
    });
  });
});

/* ---- Attempts to get round the rules ---- */

describe("a hold under attack", () => {
  const PAST = () => new Date(Date.now() - 1000);

  it("lets a removed circle member go at once, with no trace of the circle left", async () => {
    const circles = { [CIRCLE]: { name: "Calc crew", members: [ADA, CY] } };
    const db = world({
      holds: [{ table_id: "hall-t03", holder: ADA, visibility: "private", circle: CIRCLE }],
      circles,
    });
    expect((await sitAt(db.sql, signedIn(CY), "hall-t03")).status).toBe(200);
    circles[CIRCLE]!.members = [ADA];
    const out = await sitAt(db.sql, signedIn(CY), "hall-t03");
    expect(out.status).toBe(403);
    expect(out.body.status).toMatchObject({ canSit: false, access: null, circleName: null });
    const view = await tablesView(db.sql, signedIn(CY), true);
    expect(view.tables.find((t) => t.tableId === "hall-t03")).toMatchObject({
      canSit: false,
      circleName: null,
    });
  });

  it("never lets a hold that has run out block anyone, let anyone in, or be changed", async () => {
    const token = "B".repeat(43);
    const hash = hashInviteToken(token);
    const db = world({
      holds: [
        {
          id: "hold-old",
          table_id: "hall-t03",
          holder: ADA,
          visibility: "private",
          circle: CIRCLE,
          guests: new Set([DEE]),
          ends_at: PAST(),
        },
      ],
      invites: [{ hash, hold: "hold-old", expires_at: PAST() }],
    });
    // Free for everyone, and the old guest and circle member are nobody special.
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t03")).body).toMatchObject({
      ok: true,
      firstHere: true,
    });
    for (const who of [DEE, CY])
      expect((await sitAt(db.sql, signedIn(who), "hall-t03")).body.status).toMatchObject({
        held: false,
        access: "free",
        circleName: null,
      });
    // Its holder can't change it, make links for it, or give it up: it's over.
    expect(
      (await updateTable(db.sql, signedIn(ADA), "hall-t03", { circleId: null }, true)).status,
    ).toBe(404);
    expect((await createTableInvite(db.sql, signedIn(ADA), "hall-t03", "", true)).status).toBe(404);
    expect((await releaseTable(db.sql, signedIn(ADA), "hall-t03")).status).toBe(404);
    // Its link is spent, and adds nobody.
    expect(await joinTable(db.sql, BEN, token)).toMatchObject({ status: 410, code: "gone" });
    expect(db.holds[0]!.guests.has(BEN)).toBe(false);
    // It doesn't count as Ada's one table, or keep the table from the next student.
    expect(
      (await claimTable(db.sql, signedIn(ADA), "hall-t05", { visibility: "public" }, true)).status,
    ).toBe(201);
    expect(
      (await claimTable(db.sql, signedIn(BEN), "hall-t03", { visibility: "private" }, true)).status,
    ).toBe(201);
    // ...whose new hold the old link doesn't open either.
    expect(await joinTable(db.sql, DEE, token)).toMatchObject({ status: 410 });
    expect((await sitAt(db.sql, signedIn(DEE), "hall-t03")).status).toBe(403);
  });

  it("opens only the hold a link was made for: not another table, not a later hold", async () => {
    const db = world({
      holds: [
        { id: "hold-ada", table_id: "hall-t03", holder: ADA, visibility: "private" },
        { id: "hold-cy", table_id: "hall-t07", holder: CY, visibility: "private" },
      ],
    });
    const made = await createTableInvite(db.sql, signedIn(ADA), "hall-t03", "", true);
    if (!made.ok) throw new Error(made.message);
    const token = made.body.path.split("/").at(-1)!;
    expect(await joinTable(db.sql, BEN, token)).toMatchObject({ body: { tableId: "hall-t03" } });
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t03")).status).toBe(200);
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t07")).status).toBe(403);
    // Ada's hour runs out and she holds the table again: a new hold, a new (empty) list.
    db.holds[0]!.ends_at = PAST();
    expect(
      (await claimTable(db.sql, signedIn(ADA), "hall-t03", { visibility: "private" }, true)).status,
    ).toBe(201);
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t03")).status).toBe(403);
    expect(await joinTable(db.sql, BEN, token)).toMatchObject({ status: 410 });
    expect((await sitAt(db.sql, signedIn(BEN), "hall-t03")).status).toBe(403);
  });

  it("lets nobody but the holder give a table up or change it", async () => {
    const db = privateTable();
    for (const viewer of [
      signedIn(BEN),
      signedIn(DEE),
      signedIn(CY),
      anonymous(BEN),
      anonymous(null),
    ]) {
      expect((await releaseTable(db.sql, viewer, "hall-t03")).status).toBe(404);
      for (const patch of [
        { visibility: "public" as const },
        { circleId: null },
        { circleId: OTHER_CIRCLE },
      ])
        expect((await updateTable(db.sql, viewer, "hall-t03", patch, true)).ok).toBe(false);
      expect((await createTableInvite(db.sql, viewer, "hall-t03", "", true)).ok).toBe(false);
    }
    // Nothing but releases that matched no hold (the holder_id check), and the hold is as it was.
    expect(
      db.writes().filter((w) => !w.text.startsWith("UPDATE table_holds SET released_at")),
    ).toEqual([]);
    expect(db.holds[0]).toMatchObject({ released: false, visibility: "private", circle: CIRCLE });
  });
});

/* ---- Through the route ---- */

/* ---- Email invites ---- */

describe("email invites", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH0_SECRET", "a".repeat(64));
    vi.stubEnv("EMAIL_HASH_SECRET", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  const BEN_EMAIL = "ben@example.com";
  const benHash = () => hashEmail(BEN_EMAIL)!;
  /** Ben, signed in, with his verified email (or without one). */
  const ben = (verified = true): Viewer => ({
    learnerId: BEN,
    signedIn: true,
    emailHash: verified ? benHash() : null,
  });
  /** Ada invites `email` to her private table 3. */
  async function invite(db: ReturnType<typeof world>, email = BEN_EMAIL) {
    const out = await inviteByEmail(db.sql, signedIn(ADA), "hall-t03", email, true);
    if (!out.ok) throw new Error(out.message);
    return out.body.invite;
  }

  it("keeps only a keyed hash and a masked address, never the address", async () => {
    const db = privateTable();
    const out = await inviteByEmail(db.sql, signedIn(ADA), "hall-t03", "  Ben@Example.COM ", true);
    expect(out).toMatchObject({
      ok: true,
      status: 201,
      body: { invite: { masked: "be•••@example.com" } },
    });
    expect(db.emailInvites).toEqual([
      { id: expect.any(String), hold: "hold-ada", hash: benHash(), masked: "be•••@example.com" },
    ]);
    expect(JSON.stringify(db.calls).toLowerCase()).not.toContain(BEN_EMAIL);
  });

  it("answers the same whether or not anyone has that address, without looking", async () => {
    const db = world({
      holds: [{ id: "hold-ada", table_id: "hall-t03", holder: ADA, visibility: "private" }],
      emails: { [BEN]: benHash() },
    });
    const runs = [];
    for (const email of [BEN_EMAIL, "nobody-here@example.com"]) {
      const from = db.calls.length;
      const out = await inviteByEmail(db.sql, signedIn(ADA), "hall-t03", email, true);
      if (!out.ok) throw new Error(out.message);
      runs.push({
        status: out.status,
        keys: Object.keys(out.body.invite).sort(),
        // The same queries in the same order, and none of them goes near learners.
        queries: db.calls.slice(from).map((c) => c.text),
      });
    }
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]!.status).toBe(201);
    expect(runs[0]!.keys).toEqual(["id", "masked"]);
    for (const text of runs[0]!.queries) expect(text).not.toMatch(/learners/);
  });

  it("lets in the signed-in student whose verified email was invited, for that hold only", async () => {
    const db = privateTable();
    expect((await sitAt(db.sql, ben(), "hall-t03")).status).toBe(403);
    await invite(db);
    expect(await sitAt(db.sql, ben(), "hall-t03")).toMatchObject({
      status: 200,
      body: { ok: true, status: { canSit: true, access: "email", circleName: "Calc crew" } },
    });
    // Without a verified email, signed out, or someone else's address: still no.
    expect((await sitAt(db.sql, ben(false), "hall-t03")).status).toBe(403);
    expect(
      (await sitAt(db.sql, { ...anonymous(BEN), emailHash: benHash() }, "hall-t03")).status,
    ).toBe(401);
    const fay = { ...signedIn(FAY), emailHash: hashEmail("fay@example.com") };
    expect((await sitAt(db.sql, fay, "hall-t03")).status).toBe(403);
    // Giving the table up ends the invite with the hold: Ada's next hold starts with none.
    expect((await releaseTable(db.sql, signedIn(ADA), "hall-t03")).ok).toBe(true);
    expect(db.emailInvites).toEqual([]);
    const again = await claimTable(
      db.sql,
      signedIn(ADA),
      "hall-t03",
      { visibility: "private" },
      true,
    );
    expect(again.status).toBe(201);
    expect((await sitAt(db.sql, ben(), "hall-t03")).status).toBe(403);
  });

  it("opens only the hold it was made for, and none that has run out", async () => {
    const db = world({
      holds: [
        { id: "hold-ada", table_id: "hall-t03", holder: ADA, visibility: "private" },
        { id: "hold-cy", table_id: "hall-t04", holder: CY, visibility: "private" },
        {
          id: "hold-dee",
          table_id: "hall-t05",
          holder: DEE,
          visibility: "private",
          ends_at: new Date(Date.now() - 1000),
        },
      ],
      emailInvites: [
        { id: "e-cy", hold: "hold-cy", hash: benHash(), masked: "be•••@example.com" },
        { id: "e-dee", hold: "hold-dee", hash: benHash(), masked: "be•••@example.com" },
      ],
    });
    expect((await sitAt(db.sql, ben(), "hall-t03")).status).toBe(403);
    expect((await sitAt(db.sql, ben(), "hall-t04")).body.status.access).toBe("email");
    expect((await sitAt(db.sql, ben(), "hall-t05")).body.status.access).toBe("free");
    const view = await tablesView(db.sql, ben(), true);
    expect(view.invitedTo).toEqual([
      { tableId: "hall-t04", holderName: "Cy", endsAt: db.holds[1]!.ends_at.toISOString() },
    ]);
    // Ada can't take back an invite to Cy's table through her own.
    expect((await removeEmailInvite(db.sql, signedIn(ADA), "hall-t03", "e-cy")).status).toBe(404);
    expect(db.emailInvites).toHaveLength(2);
  });

  it("shows the holder their invites, masked, and the invited student only who, where and until when", async () => {
    const db = privateTable();
    const made = await invite(db);
    const holder = await tablesView(db.sql, signedIn(ADA), true);
    expect(holder.mine?.emailInvites).toEqual([{ id: made.id, masked: "be•••@example.com" }]);
    expect(holder.invitedTo).toEqual([]);
    const view = await tablesView(db.sql, ben(), true);
    expect(view).toMatchObject({
      emailVerified: true,
      invitedTo: [
        { tableId: "hall-t03", holderName: "Ada", endsAt: db.holds[0]!.ends_at.toISOString() },
      ],
    });
    expect(view.tables.find((t) => t.tableId === "hall-t03")).toMatchObject({
      canSit: true,
      access: "email",
    });
    for (const who of [ben(), ben(false), signedIn(DEE), signedIn(CY), anonymous(null)]) {
      const text = JSON.stringify(await tablesView(db.sql, who, true));
      for (const secret of ["emailInvites", "@", benHash(), made.id])
        expect(text).not.toContain(secret);
    }
    expect(await tablesView(db.sql, ben(false), true)).toMatchObject({
      emailVerified: false,
      invitedTo: [],
    });
    // A public table needs no invite, so it isn't one to tell Ben about (until it's private again).
    await updateTable(db.sql, signedIn(ADA), "hall-t03", { visibility: "public" }, true);
    expect((await tablesView(db.sql, ben(), true)).invitedTo).toEqual([]);
    await updateTable(db.sql, signedIn(ADA), "hall-t03", { visibility: "private" }, true);
    expect((await tablesView(db.sql, ben(), true)).invitedTo).toHaveLength(1);
  });

  it("is the private holder's alone", async () => {
    const db = privateTable();
    const ask = (viewer: Viewer, available = true) =>
      inviteByEmail(db.sql, viewer, "hall-t03", BEN_EMAIL, available);
    expect((await ask(signedIn(DEE))).status).toBe(404); // a guest can't invite
    expect((await ask(ben())).status).toBe(404);
    expect((await ask(anonymous(ADA))).status).toBe(401);
    expect((await ask(signedIn(ADA), false)).status).toBe(503);
    const pub = world({ holds: [{ table_id: "hall-t02", holder: ADA }] });
    expect(await inviteByEmail(pub.sql, signedIn(ADA), "hall-t02", BEN_EMAIL, true)).toMatchObject({
      status: 409,
      message: MESSAGES.emailNeedsPrivate,
    });
    expect(db.emailInvites).toEqual([]);
    expect(pub.emailInvites).toEqual([]);
  });

  it("caps invites per hold, and the same address again is the same invite", async () => {
    const db = privateTable();
    const first = await invite(db, "Ben@Example.com");
    expect(await invite(db, " ben@example.com")).toEqual(first);
    for (let i = 1; i < TABLE_LIMITS.emailInvitesPerHold; i++)
      await invite(db, `friend${i}@example.com`);
    expect(db.emailInvites).toHaveLength(TABLE_LIMITS.emailInvitesPerHold);
    const over = await inviteByEmail(db.sql, signedIn(ADA), "hall-t03", "one@example.com", true);
    expect(over).toMatchObject({ status: 409, code: "limit_reached" });
    expect(await invite(db, BEN_EMAIL)).toEqual(first); // already on the list: still fine
    expect(db.emailInvites).toHaveLength(TABLE_LIMITS.emailInvitesPerHold);
  });

  it("lets only the holder take an invite back, and it stops at once", async () => {
    const db = privateTable();
    const made = await invite(db);
    expect((await sitAt(db.sql, ben(), "hall-t03")).status).toBe(200);
    expect((await removeEmailInvite(db.sql, ben(), "hall-t03", made.id)).status).toBe(404);
    expect((await removeEmailInvite(db.sql, signedIn(DEE), "hall-t03", made.id)).status).toBe(404);
    expect((await removeEmailInvite(db.sql, anonymous(ADA), "hall-t03", made.id)).status).toBe(401);
    expect(db.emailInvites).toHaveLength(1);
    expect(await removeEmailInvite(db.sql, signedIn(ADA), "hall-t03", made.id)).toMatchObject({
      ok: true,
      body: { ok: true },
    });
    expect(db.emailInvites).toEqual([]);
    expect((await sitAt(db.sql, ben(), "hall-t03")).status).toBe(403);
    expect(await removeEmailInvite(db.sql, signedIn(ADA), "hall-t03", made.id)).toMatchObject({
      status: 404,
      message: MESSAGES.emailInviteGone,
    });
  });
});

describe("/api/tables", () => {
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

  const SUBS = Object.fromEntries(Object.entries(SUB_TO_ID).map(([sub, id]) => [id, sub]));

  /** Signed in as `who` (a real SDK session cookie) or signed out, against `db`. */
  async function call(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string[],
    {
      who,
      claims = {},
      body,
      origin,
      db = world(),
      type = "application/json",
      headers: extra = {},
    }: {
      who?: string;
      /** More ID-token claims in the session (email, email_verified). */
      claims?: Record<string, unknown>;
      body?: unknown;
      origin?: string;
      db?: ReturnType<typeof world>;
      type?: string;
      /** More request headers; a `cookie` here is sent alongside the session's. */
      headers?: Record<string, string>;
    } = {},
  ) {
    const route = await import("@/app/api/tables/[[...path]]/route");
    const { cookie: moreCookies, ...rest } = extra;
    const headers: Record<string, string> = { "content-type": type, ...rest };
    if (origin) headers.origin = origin;
    const cookies = moreCookies ? [moreCookies] : [];
    if (who) {
      const cookie = await generateSessionCookie(
        { user: { sub: SUBS[who]!, given_name: "Sam", ...claims } },
        { secret: ENV.AUTH0_SECRET },
      );
      cookies.unshift(`__session=${cookie}`);
    }
    if (cookies.length) headers.cookie = cookies.join("; ");
    dbBox.sql = db.sql;
    const request = new Request(`http://localhost:3100/api/tables/${path.join("/")}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const res = await route[method](request, {
      params: Promise.resolve({ path: path.length ? path : undefined }),
    });
    return { status: res.status, body: await res.json(), cookie: res.headers.get("set-cookie") };
  }

  it("shows every table to anyone, without making them a learner", async () => {
    const db = privateTable();
    const res = await call("GET", [], { db });
    expect(res.status).toBe(200);
    expect(res.body.tables).toHaveLength(15);
    expect(res.body).toMatchObject({ signedIn: false, privateAvailable: true, mine: null });
    expect(res.cookie).toBeNull();
    expect(db.writes()).toEqual([]);
  });

  it("says private tables are off until the Auth0 keys are set", async () => {
    delete process.env.AUTH0_CLIENT_SECRET;
    expect((await call("GET", [])).body.privateAvailable).toBe(false);
    const res = await call("POST", ["hall-t01", "claim"], { body: { visibility: "private" } });
    expect(res).toMatchObject({ status: 503, body: { error: { code: "auth_not_configured" } } });
    // A public table still works without sign-in.
    const pub = await call("POST", ["hall-t01", "claim"], { body: { visibility: "public" } });
    expect(pub.status).toBe(201);
  });

  it("lets a signed-out student hold a public table (and gives them a learner cookie)", async () => {
    const db = world();
    const res = await call("POST", ["hall-t01", "claim"], { db, body: { visibility: "public" } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tableId: "hall-t01", mine: true, visibility: "public" });
    expect(res.cookie).toMatch(/^ovr_learner=/);
  });

  it("asks a signed-out student to sign in for a private table", async () => {
    const db = world();
    const res = await call("POST", ["hall-t01", "claim"], { db, body: { visibility: "private" } });
    expect(res).toMatchObject({ status: 401, body: { error: { code: "sign_in_required" } } });
    expect(res.cookie).toBeNull();
    expect(db.writes()).toEqual([]);
  });

  it("answers a refused sit with the SitResult and a 403 table_private", async () => {
    const res = await call("POST", ["hall-t03", "sit"], { who: BEN, db: privateTable() });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({
      ok: false,
      reason: "private",
      status: { tableId: "hall-t03", holderName: "Ada", canSit: false },
      error: { code: "table_private" },
    });
    expect(res.body.error.message).toContain("Ada has it for another");
    const guest = await call("POST", ["hall-t03", "sit"], { who: DEE, db: privateTable() });
    expect(guest).toMatchObject({ status: 200, body: { ok: true, status: { access: "guest" } } });
  });

  it("lets a signed-in student hold a private table, invite, and a guest join", async () => {
    const db = world();
    const claim = await call("POST", ["hall-t06", "claim"], {
      who: ADA,
      db,
      body: { visibility: "private", circleId: CIRCLE },
    });
    expect(claim).toMatchObject({ status: 201, body: { visibility: "private", mine: true } });
    const invite = await call("POST", ["hall-t06", "invite"], { who: ADA, db });
    expect(invite.status).toBe(201);
    expect(invite.body.link).toBe(`http://localhost:3100${invite.body.path}`);
    const token = invite.body.path.split("/").at(-1);
    expect((await call("POST", ["join"], { db, body: { token } })).status).toBe(401);
    const join = await call("POST", ["join"], { who: BEN, db, body: { token } });
    expect(join).toMatchObject({
      status: 200,
      body: { tableId: "hall-t06", status: { access: "guest" } },
    });
    const patch = await call("PATCH", ["hall-t06"], {
      who: BEN,
      db,
      body: { visibility: "public" },
    });
    expect(patch.status).toBe(404); // a guest can't change the table
    const release = await call("POST", ["hall-t06", "release"], { who: ADA, db });
    expect(release).toMatchObject({ status: 200, body: { ok: true } });
  });

  it("refuses unknown tables, bad bodies and changes sent from another site", async () => {
    expect((await call("POST", ["hall-t99", "sit"])).status).toBe(404);
    expect((await call("POST", ["hall-t01", "dance"])).status).toBe(404);
    expect((await call("POST", [])).status).toBe(404);
    expect(
      (await call("POST", ["hall-t01", "claim"], { body: { visibility: "secret" } })).status,
    ).toBe(400);
    expect((await call("PATCH", ["hall-t01"], { who: ADA, body: {} })).status).toBe(400);
    expect((await call("POST", ["join"], { who: BEN, body: { token: "../etc" } })).status).toBe(
      400,
    );
    const plain = await call("POST", ["hall-t01", "claim"], {
      body: { visibility: "public" },
      type: "text/plain",
    });
    expect(plain.status).toBe(415);
    const db = world();
    const cross = await call("POST", ["hall-t01", "claim"], {
      who: ADA,
      db,
      body: { visibility: "public" },
      origin: "https://evil.example",
    });
    expect(cross).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
    expect(db.calls).toEqual([]);
  });

  it("never tells anyone a guest list, an id, an email or a full name", async () => {
    const db = world({
      holds: [
        {
          id: "hold-ada",
          table_id: "hall-t03",
          holder: ADA,
          visibility: "private",
          circle: CIRCLE,
          guests: new Set([DEE]),
        },
        { id: "hold-eve", table_id: "hall-t04", holder: EVE },
      ],
    });
    const secrets = [
      "hold-ada",
      "hold-eve",
      ADA,
      BEN,
      CY,
      DEE,
      EVE,
      CIRCLE,
      "Lovelace",
      "@",
      "eve.smith",
    ];
    for (const who of [undefined, BEN, CY, DEE]) {
      const view = await call("GET", [], { who, db });
      expect(view.status).toBe(200);
      const sit = await call("POST", ["hall-t03", "sit"], { who, db });
      for (const text of [JSON.stringify(view.body), JSON.stringify(sit.body)])
        for (const secret of secrets) expect(text).not.toContain(secret);
      const t04 = view.body.tables.find((t: { tableId: string }) => t.tableId === "hall-t04");
      expect(t04.holderName).toBe("Someone");
      const t03 = view.body.tables.find((t: { tableId: string }) => t.tableId === "hall-t03");
      expect(t03.holderName).toBe("Ada");
      // The circle's name only reaches students it lets in.
      expect(t03.circleName).toBe(who === CY || who === DEE ? "Calc crew" : null);
    }
  });

  it("decides who's asking from the session alone, never the request", async () => {
    const db = privateTable();
    // Ben claims to be Dee, or to be on the list, in the body and headers.
    const forged = await call("POST", ["hall-t03", "sit"], {
      who: BEN,
      db,
      body: { learnerId: DEE, holdId: "hold-ada", access: "guest", signedIn: true },
      headers: { "x-learner-id": DEE, "x-user-id": DEE },
    });
    expect(forged).toMatchObject({ status: 403, body: { ok: false, reason: "private" } });
    // A learner cookie with a made-up signature, and the real (linked) cookie of Ada's learner
    // without her Auth0 session, are both nobody: no sitting, changing, inviting or giving up.
    for (const cookie of [`ovr_learner=${ADA}.forged`, learnerCookieHeader(ADA).split(";")[0]!]) {
      const headers = { cookie };
      expect((await call("POST", ["hall-t03", "sit"], { db, headers })).status).toBe(401);
      expect(
        (await call("PATCH", ["hall-t03"], { db, headers, body: { visibility: "public" } })).status,
      ).toBe(404);
      expect((await call("POST", ["hall-t03", "release"], { db, headers })).status).toBe(404);
      expect((await call("POST", ["hall-t03", "invite"], { db, headers })).status).toBe(401);
    }
    // Ben can't give up or change Ada's table either, and hold ids name nothing.
    expect((await call("POST", ["hall-t03", "release"], { who: BEN, db })).status).toBe(404);
    expect((await call("POST", ["hold-ada", "sit"], { who: BEN, db })).status).toBe(404);
    expect((await call("POST", ["hall-t03", "sit", "hold-ada"], { who: BEN, db })).status).toBe(
      404,
    );
    // Ben's release matched no hold of his; nothing else was written, and Ada's hold is as it was.
    expect(
      db.writes().filter((w) => !w.text.startsWith("UPDATE table_holds SET released_at")),
    ).toEqual([]);
    expect(db.holds[0]).toMatchObject({ released: false, visibility: "private" });
  });

  it("won't let anyone use a Study Circle they aren't in, through the route", async () => {
    const db = world({ holds: [{ table_id: "hall-t02", holder: BEN }] });
    const claim = await call("POST", ["hall-t06", "claim"], {
      who: DEE,
      db,
      body: { visibility: "private", circleId: CIRCLE },
    });
    expect(claim).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    const patch = await call("PATCH", ["hall-t02"], { who: BEN, db, body: { circleId: CIRCLE } });
    expect(patch).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    // Signed out, a circle (like private) needs a sign-in first, and makes no learner.
    const anon = await call("POST", ["hall-t06", "claim"], {
      db,
      body: { visibility: "public", circleId: CIRCLE },
    });
    expect(anon).toMatchObject({ status: 401, cookie: null });
    expect(db.writes()).toEqual([]);
  });

  it("refuses every change sent from another site or a sandboxed page", async () => {
    const changes: ["POST" | "PATCH" | "DELETE", string[], unknown][] = [
      ["POST", ["hall-t03", "email-invites"], { email: "ben@example.com" }],
      ["DELETE", ["hall-t03", "email-invites", CIRCLE], undefined],
      ["POST", ["hall-t03", "sit"], undefined],
      ["POST", ["hall-t03", "claim"], { visibility: "public" }],
      ["PATCH", ["hall-t03"], { visibility: "public" }],
      ["POST", ["hall-t03", "invite"], undefined],
      ["POST", ["hall-t03", "release"], undefined],
      ["POST", ["join"], { token: "A".repeat(43) }],
    ];
    const from: Record<string, string>[] = [
      { "sec-fetch-site": "cross-site" },
      { origin: "null" },
      { origin: "http://localhost:3000" }, // another port: another origin
      { "sec-fetch-site": "same-site" }, // a sibling subdomain with no Origin
    ];
    for (const [method, path, body] of changes)
      for (const headers of from) {
        const db = privateTable();
        const res = await call(method, path, { who: ADA, db, body, headers });
        expect(res).toMatchObject({ status: 403, body: { error: { code: "forbidden" } } });
        expect(db.calls).toEqual([]);
      }
  });

  it("slows anyone trying lots of invite links, and a guess adds nobody", async () => {
    const db = privateTable();
    for (let i = 0; i < 20; i++) {
      const res = await call("POST", ["join"], {
        who: FAY,
        db,
        body: { token: `${String(i).padStart(2, "0")}${"A".repeat(41)}` },
      });
      expect(res).toMatchObject({ status: 404, body: { error: { code: "not_found" } } });
    }
    const more = await call("POST", ["join"], { who: FAY, db, body: { token: "C".repeat(43) } });
    expect(more).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
    expect(db.writes()).toEqual([]);
  });

  it("caps new signed-out learners per address, but not signed-in or returning students", async () => {
    const headers = { "x-forwarded-for": "203.0.113.9" };
    const db = world();
    const made = () => db.writes().filter((w) => w.text.startsWith("INSERT INTO learners")).length;
    for (let i = 0; i < 30; i++) {
      const res = await call("POST", [TABLE_IDS[i % TABLE_IDS.length]!, "claim"], {
        db,
        headers,
        body: { visibility: "public" },
      });
      expect([201, 409]).toContain(res.status);
    }
    expect(made()).toBe(30);
    const next = await call("POST", ["hall-t01", "claim"], {
      db,
      headers,
      body: { visibility: "public" },
    });
    expect(next).toMatchObject({ status: 429, cookie: null });
    expect(made()).toBe(30); // refused before anyone was made
    // The same address, signed in or with a learner already: their claims go ahead.
    const ada = await call("POST", ["hall-t01", "claim"], {
      who: ADA,
      db: world(),
      headers,
      body: { visibility: "public" },
    });
    expect(ada.status).toBe(201);
    const back = world();
    const gus = await call("POST", ["hall-t02", "claim"], {
      db: back,
      headers: { ...headers, cookie: learnerCookieHeader(GUS).split(";")[0]! },
      body: { visibility: "public" },
    });
    expect(gus).toMatchObject({ status: 201, body: { mine: true }, cookie: null });
    expect(back.writes().filter((w) => w.text.startsWith("INSERT INTO learners"))).toEqual([]);
  });

  it("lets the holder invite by email, and lets the student in once signed in verified", async () => {
    const db = world();
    const claim = await call("POST", ["hall-t06", "claim"], {
      who: ADA,
      db,
      body: { visibility: "private" },
    });
    expect(claim.status).toBe(201);
    const added = await call("POST", ["hall-t06", "email-invites"], {
      who: ADA,
      db,
      body: { email: "  Ben@Example.com " },
    });
    expect(added).toMatchObject({ status: 201, body: { invite: { masked: "be•••@example.com" } } });
    expect(Object.keys(added.body)).toEqual(["invite"]);
    expect((await call("GET", [], { who: ADA, db })).body.mine.emailInvites).toEqual([
      added.body.invite,
    ]);
    const verified = { email: "ben@example.com", email_verified: true };
    const view = await call("GET", [], { who: BEN, db, claims: verified });
    expect(view.body).toMatchObject({
      emailVerified: true,
      invitedTo: [{ tableId: "hall-t06", holderName: "Ada" }],
    });
    expect(JSON.stringify(view.body)).not.toContain("emailInvites");
    expect(
      await call("POST", ["hall-t06", "sit"], { who: BEN, db, claims: verified }),
    ).toMatchObject({ status: 200, body: { ok: true, status: { access: "email" } } });
    expect(db.emails.get(BEN)).toBe(hashEmail("ben@example.com")); // only the hash, on his learner
    // Unverified, a session from before OVR asked for the email, or an address sent in the
    // request instead: not let in, and told there's no verified email.
    for (const claims of [{ email: "ben@example.com", email_verified: false }, {}]) {
      const sit = await call("POST", ["hall-t06", "sit"], {
        who: BEN,
        db,
        claims,
        body: { email: "ben@example.com", emailHash: hashEmail("ben@example.com") },
        headers: { "x-email": "ben@example.com" },
      });
      expect(sit.status).toBe(403);
      const again = await call("GET", [], { who: BEN, db, claims });
      expect(again.body).toMatchObject({ emailVerified: false, invitedTo: [] });
    }
    const gone = await call("DELETE", ["hall-t06", "email-invites", added.body.invite.id], {
      who: ADA,
      db,
    });
    expect(gone).toMatchObject({ status: 200, body: { ok: true } });
    expect(
      (await call("POST", ["hall-t06", "sit"], { who: BEN, db, claims: verified })).status,
    ).toBe(403);
  });

  it("doesn't let a look-alike verified address use someone's email invite", async () => {
    const db = world({ holds: [{ table_id: "hall-t06", holder: ADA, visibility: "private" }] });
    const added = await call("POST", ["hall-t06", "email-invites"], {
      who: ADA,
      db,
      body: { email: "Ken@Example.com" },
    });
    expect(added.status).toBe(201);
    // Fay's provider verified "Ken@example.com" (a Kelvin sign, which toLowerCase makes "k").
    const lookAlike = { email: "Ken@example.com", email_verified: true };
    const sit = await call("POST", ["hall-t06", "sit"], { who: FAY, db, claims: lookAlike });
    expect(sit.status).toBe(403);
    expect((await call("GET", [], { who: FAY, db, claims: lookAlike })).body.invitedTo).toEqual([]);
    // The real Ken gets in.
    const ken = { email: "ken@example.com", email_verified: true };
    expect((await call("POST", ["hall-t06", "sit"], { who: BEN, db, claims: ken })).status).toBe(
      200,
    );
  });

  it("answers an email invite the same whether or not anyone has that address", async () => {
    const db = world({ holds: [{ table_id: "hall-t06", holder: ADA, visibility: "private" }] });
    // Ben has an account with this verified address; nobody has the other one.
    await call("GET", [], {
      who: BEN,
      db,
      claims: { email: "ben@example.com", email_verified: true },
    });
    expect(db.emails.get(BEN)).toBe(hashEmail("ben@example.com"));
    const answers = [];
    for (const email of ["ben@example.com", "nobody@example.com"]) {
      const from = db.calls.length;
      const res = await call("POST", ["hall-t06", "email-invites"], {
        who: ADA,
        db,
        body: { email },
      });
      const calls = db.calls.slice(from);
      answers.push({
        status: res.status,
        keys: Object.keys(res.body.invite).sort(),
        queries: calls.map((c) => c.text),
      });
      // The hash only ever goes to the invites table: nothing looks for an account with it.
      for (const c of calls)
        if (c.values.includes(hashEmail(email)))
          expect(c.text).toContain("table_hold_email_invites");
    }
    expect(answers[0]).toEqual(answers[1]);
    expect(answers[0]).toMatchObject({ status: 201, keys: ["id", "masked"] });
  });

  it("checks email invites: an address, the holder's own table, and not from another site", async () => {
    const db = privateTable();
    const post = (body: unknown, who: string | null = ADA) =>
      call("POST", ["hall-t03", "email-invites"], { who: who ?? undefined, db, body });
    for (const email of ["", "not an email", "ben@", `${"a".repeat(250)}@example.com`, 42, null])
      expect((await post({ email })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ email: "ben@example.com" }, null)).status).toBe(401); // signed out
    expect((await post({ email: "ben@example.com" }, BEN)).status).toBe(404);
    expect((await call("GET", ["hall-t03", "email-invites"], { who: ADA, db })).status).toBe(404);
    for (const path of [
      ["email-invites", "not-a-uuid"],
      ["email-invites"],
      ["email-invites", CIRCLE],
    ])
      expect((await call("DELETE", ["hall-t03", ...path], { who: ADA, db })).status).toBe(404);
    expect((await call("DELETE", ["hall-t03"], { who: ADA, db })).status).toBe(404);
    expect(db.emailInvites).toEqual([]);
  });

  it("slows a holder adding lots of email invites", async () => {
    const db = world({ holds: [{ table_id: "hall-t08", holder: HAL, visibility: "private" }] });
    for (let i = 0; i < 30; i++) {
      const res = await call("POST", ["hall-t08", "email-invites"], {
        who: HAL,
        db,
        body: { email: `friend${i % TABLE_LIMITS.emailInvitesPerHold}@example.com` },
      });
      expect(res.status).toBe(201);
    }
    const more = await call("POST", ["hall-t08", "email-invites"], {
      who: HAL,
      db,
      body: { email: "late@example.com" },
    });
    expect(more).toMatchObject({ status: 429, body: { error: { code: "rate_limited" } } });
    expect(db.emailInvites).toHaveLength(TABLE_LIMITS.emailInvitesPerHold);
  });
});
