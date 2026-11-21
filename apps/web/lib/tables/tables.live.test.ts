import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { hashEmail } from "@/lib/auth/emailHash";
import { accountLearner } from "@/lib/learning/server/identity";
import {
  type Outcome,
  type Viewer,
  TABLE_IDS,
  claimTable,
  createTableInvite,
  inviteByEmail,
  joinTable,
  liveHolds,
  releaseTable,
  removeEmailInvite,
  sitAt,
  tablesView,
  updateTable,
} from "./server";

/**
 * Table holds against a real Postgres: the SQL itself, and the races the unit tests can only
 * fake (the exclusion constraints are what stop two people winning the same table). Opt-in,
 * because it writes: four throwaway learners (not on the leaderboard), a circle and their holds,
 * all deleted afterwards (learner rows cascade).
 *
 *   TABLES_LIVE_DB=1 DATABASE_URL=… pnpm --filter @ovr/web exec vitest run lib/tables/tables.live.test.ts
 */
const LIVE = process.env.TABLES_LIVE_DB === "1" && !!process.env.DATABASE_URL;

const me = (learnerId: string): Viewer => ({ learnerId, signedIn: true });

function body<T>(out: Outcome<T>): T {
  if (!out.ok) throw new Error(`${out.status} ${out.code}: ${out.message}`);
  return out.body;
}

describe.runIf(LIVE)("table holds on a real database", () => {
  let sql: postgres.Sql;
  const [ada, ben, cy, dee] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const circle = randomUUID();
  let free: string[] = [];

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!, { max: 6, onnotice: () => {} });
    for (const [id, name] of [
      [ada, "Ada (table test)"],
      [ben, "Ben (table test)"],
      [cy, "Cy (table test)"],
      [dee, "Dee (table test)"],
    ] as const)
      await sql`INSERT INTO learners (user_id, display_name, leaderboard_opt_in)
        VALUES (${id}, ${name}, false)`;
    await sql`INSERT INTO study_circles (id, name, owner_id) VALUES (${circle}, 'Table test circle', ${ada})`;
    await sql`INSERT INTO circle_members (circle_id, learner_id, role)
      VALUES (${circle}, ${ada}, 'owner'), (${circle}, ${cy}, 'viewer')`;
    // Tables nobody really holds right now, so the test never meets a real student's hold.
    const held = new Set((await liveHolds(sql, me(ada))).map((h) => h.table_id));
    free = TABLE_IDS.filter((t) => !held.has(t)).slice(-3);
    expect(free).toHaveLength(3);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM learners WHERE user_id IN ${sql([ada, ben, cy, dee])}`;
    await sql.end();
  });

  it("gives a free table to exactly one of four students claiming it at once", async () => {
    const [table] = free;
    const outs = await Promise.all(
      [ada, ben, cy, dee].map((who) =>
        claimTable(sql, me(who), table!, { visibility: "public" }, true),
      ),
    );
    expect(outs.map((o) => o.status).sort()).toEqual([201, 409, 409, 409]);
    for (const o of outs) if (!o.ok) expect(o.code).toBe("table_taken");
    const holds = await sql`SELECT holder_id FROM table_holds
      WHERE table_id = ${table!} AND released_at IS NULL AND ends_at > now()`;
    expect(holds).toHaveLength(1);
    const winner = [ada, ben, cy, dee][outs.findIndex((o) => o.ok)]!;
    body(await releaseTable(sql, me(winner), table!));
  });

  it("never lets one student hold two tables, even claiming both at once", async () => {
    const [, a, b] = free;
    const outs = await Promise.all([
      claimTable(sql, me(ben), a!, { visibility: "public" }, true),
      claimTable(sql, me(ben), b!, { visibility: "public" }, true),
    ]);
    expect(outs.map((o) => o.status).sort()).toEqual([201, 409]);
    expect(outs.find((o) => !o.ok)).toMatchObject({ code: "already_holding" });
    const mine = await sql`SELECT 1 FROM table_holds
      WHERE holder_id = ${ben} AND released_at IS NULL AND ends_at > now()`;
    expect(mine).toHaveLength(1);
    body(await releaseTable(sql, me(ben), outs[0]!.ok ? a! : b!));
  });

  it("keeps a private table to its holder, guests and circle, until its hour is up", async () => {
    const [table] = free;
    const claimed = body(
      await claimTable(sql, me(ada), table!, { visibility: "private", circleId: circle }, true),
    );
    expect(claimed).toMatchObject({ mine: true, visibility: "private", holderName: "Ada" });
    const minutes = (new Date(claimed.endsAt!).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(58);
    expect(minutes).toBeLessThanOrEqual(60.5);

    expect((await sitAt(sql, me(ben), table!)).status).toBe(403);
    expect((await sitAt(sql, me(dee), table!)).status).toBe(403);
    expect((await sitAt(sql, { learnerId: null, signedIn: false }, table!)).status).toBe(401);
    expect((await sitAt(sql, me(cy), table!)).body.status).toMatchObject({
      access: "circle",
      circleName: "Table test circle",
    });

    // An invite puts Dee on this hold's guest list.
    const invite = body(await createTableInvite(sql, me(ada), table!, "http://localhost", true));
    const token = invite.path.split("/").at(-1)!;
    expect(body(await joinTable(sql, dee, token)).status.access).toBe("guest");
    expect((await sitAt(sql, me(dee), table!)).status).toBe(200);
    const stored = await sql`SELECT token_hash FROM table_hold_invites WHERE created_by = ${ada}`;
    expect(stored.map((r) => r.token_hash)).not.toContain(token);

    // A stranger's view: who and until when, nothing else.
    const view = await tablesView(sql, me(ben), true);
    const seen = view.tables.find((t) => t.tableId === table)!;
    expect(seen).toMatchObject({ held: true, visibility: "private", canSit: false });
    expect(seen.circleName).toBeNull();

    // Ada can't use someone else's circle.
    const other = randomUUID();
    await sql`INSERT INTO study_circles (id, name, owner_id) VALUES (${other}, 'Not Ada''s', ${ben})`;
    await sql`INSERT INTO circle_members (circle_id, learner_id, role) VALUES (${other}, ${ben}, 'owner')`;
    expect((await updateTable(sql, me(ada), table!, { circleId: other }, true)).status).toBe(404);

    // The hour runs out: the table is free again, and the old link and guest list are spent.
    await sql`UPDATE table_holds SET starts_at = now() - interval '61 minutes',
        ends_at = now() - interval '1 minute'
      WHERE holder_id = ${ada} AND released_at IS NULL`;
    expect((await sitAt(sql, me(ben), table!)).body).toMatchObject({ ok: true, firstHere: true });
    expect((await joinTable(sql, dee, token)).status).toBe(410);
    body(await claimTable(sql, me(ben), table!, { visibility: "private" }, true));
    expect((await sitAt(sql, me(dee), table!)).status).toBe(403);
    expect((await sitAt(sql, me(ada), table!)).status).toBe(403);
    body(await releaseTable(sql, me(ben), table!));
    expect((await sitAt(sql, me(dee), table!)).body).toMatchObject({ ok: true, firstHere: true });
  });

  it("lets in an invited verified email for that hold only, and keeps only hashes", async () => {
    vi.stubEnv("EMAIL_HASH_SECRET", "f".repeat(64));
    try {
      const [, table] = free;
      const address = `ben-${ben.slice(0, 8)}@example.com`;
      const hash = hashEmail(address)!;
      // Ben signs in with that address, verified: his learner gets the hash, never the address.
      const learner = await accountLearner(
        sql,
        { sub: `test|${ben}`, name: null, emailHash: hash },
        ben,
      );
      expect(learner).toMatchObject({ id: ben, emailHash: hash });
      const [row] = await sql<{ email_hash: string }[]>`SELECT email_hash FROM learners
        WHERE user_id = ${ben}`;
      expect(row!.email_hash).toBe(hash);
      const benIn: Viewer = { learnerId: ben, signedIn: true, emailHash: hash };

      body(await claimTable(sql, me(ada), table!, { visibility: "private" }, true));
      expect((await sitAt(sql, benIn, table!)).status).toBe(403);
      const made = body(
        await inviteByEmail(sql, me(ada), table!, ` ${address.toUpperCase()}`, true),
      );
      expect(made.invite.masked).toBe("be•••@example.com");
      expect(body(await inviteByEmail(sql, me(ada), table!, address, true))).toEqual(made);
      const stored = await sql<{ email_hash: string; masked: string }[]>`SELECT email_hash, masked
        FROM table_hold_email_invites WHERE created_by = ${ada}`;
      expect(stored.map((r) => ({ ...r }))).toEqual([
        { email_hash: hash, masked: made.invite.masked },
      ]);

      expect((await sitAt(sql, benIn, table!)).body.status.access).toBe("email");
      expect((await sitAt(sql, { ...benIn, emailHash: null }, table!)).status).toBe(403);
      const view = await tablesView(sql, benIn, true);
      expect(view.invitedTo).toEqual([
        { tableId: table, holderName: "Ada", endsAt: expect.any(String) },
      ]);
      expect(view.tables.find((t) => t.tableId === table)!.emailInvites).toBeUndefined();
      expect((await tablesView(sql, me(ada), true)).mine?.emailInvites).toEqual([made.invite]);

      body(await removeEmailInvite(sql, me(ada), table!, made.invite.id));
      expect((await sitAt(sql, benIn, table!)).status).toBe(403);
      body(await inviteByEmail(sql, me(ada), table!, address, true));
      body(await releaseTable(sql, me(ada), table!));
      const left = await sql`SELECT 1 FROM table_hold_email_invites WHERE created_by = ${ada}`;
      expect(left).toHaveLength(0);
      expect((await sitAt(sql, benIn, table!)).body).toMatchObject({ ok: true, firstHere: true });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
