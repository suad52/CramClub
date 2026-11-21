import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Outcome,
  addItem,
  changeRole,
  createCircle,
  createInvite,
  deleteCircle,
  getCircle,
  joinCircle,
  leaveCircle,
  listCircles,
  markSeen,
  memberKey,
  previewInvite,
  removeItem,
  removeMember,
  shareable,
} from "./server";

/**
 * The Study Circles flow against a real Postgres (the SQL itself, which the unit tests fake).
 * Opt-in, because it writes: four throwaway learners (not on the leaderboard) and everything they
 * make, all deleted afterwards (learner rows cascade).
 *
 *   CIRCLES_LIVE_DB=1 DATABASE_URL=… pnpm --filter @ovr/web exec vitest run lib/circles/circles.live.test.ts
 */
const LIVE = process.env.CIRCLES_LIVE_DB === "1" && !!process.env.DATABASE_URL;

function body<T>(out: Outcome<T>): T {
  if (!out.ok) throw new Error(`${out.status} ${out.code}: ${out.message}`);
  return out.body;
}

describe.runIf(LIVE)("Study Circles on a real database", () => {
  let sql: postgres.Sql;
  const [ada, ben, cy, dee] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const task = randomUUID();
  const source = randomUUID();

  beforeAll(async () => {
    sql = postgres(process.env.DATABASE_URL!, { max: 3, onnotice: () => {} });
    for (const [id, name] of [
      [ada, "Ada (circle test)"],
      [ben, "Ben (circle test)"],
      [cy, "Cy (circle test)"],
      [dee, "Dee (circle test)"],
    ] as const)
      await sql`INSERT INTO learners (user_id, display_name, leaderboard_opt_in)
        VALUES (${id}, ${name}, false)`;
    // Something in Ada's private library: a saved source and a lesson from the Librarian.
    await sql`INSERT INTO librarian_tasks (id, user_id, task_type, status, user_request, topic,
        lesson, lesson_sources)
      VALUES (${task}, ${ada}, 'find_resources', 'completed', 'CS 135 recursion', 'Recursion',
        ${sql.json({
          title: "Recursion on lists",
          description: "Templates for lists",
          estimatedMinutes: 8,
          learningObjectives: ["Write the list template"],
          scenes: [{ title: "cons" }, { title: "empty" }],
        })},
        ${sql.json([
          { page: 1, title: "adas-private-notes.pdf", url: "" },
          { page: 2, title: "HtDP", url: "https://htdp.org/" },
        ])})`;
    await sql`INSERT INTO research_sources (id, task_id, user_id, title, url, domain, summary,
        saved, saved_at)
      VALUES (${source}, ${task}, ${ada}, 'Structural recursion', 'https://htdp.org/part-two',
        'htdp.org', 'Part two of HtDP', true, now())`;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM learners WHERE user_id IN ${sql([ada, ben, cy, dee])}`;
    await sql.end();
  }, 60_000);

  it("runs the whole role matrix end to end", async () => {
    const { id } = body(await createCircle(sql, ada, { name: "CS 135 midterm", description: "" }));
    expect(body(await getCircle(sql, ada, id)).myRole).toBe("owner");
    expect((await getCircle(sql, ben, id)).status).toBe(404); // not a member: not found

    // An editor invite with one use: Ben joins, joins again (no change), Cy can't use it.
    const editorLink = body(await createInvite(sql, ada, id, { role: "editor", maxUses: 1 }));
    expect(body(await previewInvite(sql, ben, editorLink.token))).toMatchObject({
      status: "ok",
      role: "editor",
      circleName: "CS 135 midterm",
      ownerName: "Ada (circle test)",
    });
    expect(body(await joinCircle(sql, ben, editorLink.token))).toMatchObject({
      role: "editor",
      joined: true,
    });
    expect(body(await joinCircle(sql, ben, editorLink.token)).joined).toBe(false);
    expect((await joinCircle(sql, cy, editorLink.token)).status).toBe(410);

    // Cy joins as a viewer; a later editor link doesn't promote them, and spends nothing.
    const viewerLink = body(await createInvite(sql, ada, id, { role: "viewer" }));
    expect(body(await joinCircle(sql, cy, viewerLink.token)).role).toBe("viewer");
    const another = body(await createInvite(sql, ada, id, { role: "editor", maxUses: 1 }));
    expect(body(await joinCircle(sql, cy, another.token))).toEqual({
      circleId: id,
      role: "viewer",
      joined: false,
    });
    expect(body(await previewInvite(sql, dee, another.token)).status).toBe("ok"); // still unused

    // Viewers read; editors add and remove; only the owner manages people.
    const note = { kind: "note" as const, title: "Practice set", text: "Q1 to Q5 from week 3." };
    expect((await addItem(sql, cy, id, note)).status).toBe(403);
    const { id: itemId } = body(await addItem(sql, ben, id, note));
    expect((await removeItem(sql, cy, id, itemId)).status).toBe(403);
    expect((await removeItem(sql, dee, id, itemId)).status).toBe(404);
    expect((await changeRole(sql, ben, id, memberKey(id, cy), "editor")).status).toBe(403);
    expect((await createInvite(sql, ben, id, { role: "editor" })).status).toBe(403);

    // "New since your last visit" counts Ben's note for Ada until she's seen it.
    expect((await listCircles(sql, ada)).find((c) => c.id === id)?.newSinceLastVisit).toBe(1);
    expect((await listCircles(sql, ben)).find((c) => c.id === id)?.newSinceLastVisit).toBe(0);
    const seen = body(await getCircle(sql, ada, id));
    expect(seen.items[0]).toMatchObject({
      title: "Practice set",
      isNew: true,
      addedByName: "Ben (circle test)",
    });
    body(await markSeen(sql, ada, id, new Date(seen.readAt)));
    expect((await listCircles(sql, ada)).find((c) => c.id === id)?.newSinceLastVisit).toBe(0);

    // Sharing from a library copies only what the caller owns.
    expect((await shareable(sql, ben)).length).toBe(0);
    expect((await shareable(sql, ada)).map((s) => s.source).sort()).toEqual([
      "lesson",
      "saved_source",
    ]);
    const steal = await addItem(sql, ben, id, { from: { source: "saved_source", id: source } });
    expect(steal.status).toBe(404);
    body(await addItem(sql, ada, id, { from: { source: "saved_source", id: source } }));
    body(await addItem(sql, ada, id, { from: { source: "lesson", id: task } }));
    const items = body(await getCircle(sql, cy, id)).items;
    expect(items.find((i) => i.kind === "lesson")).toMatchObject({
      fromLibrary: true,
      preview: { type: "lesson", scenes: ["cons", "empty"] },
    });
    const [stored] = await sql<{ payload: string }[]>`SELECT payload::text AS payload
      FROM circle_items WHERE circle_id = ${id} AND kind = 'lesson'`;
    expect(stored!.payload).not.toContain("adas-private-notes");

    // An expired link is refused.
    const old = body(await createInvite(sql, ada, id, { role: "viewer" }));
    await sql`UPDATE circle_invites SET expires_at = now() - interval '1 minute'
      WHERE token_hash = ${old.id}`;
    expect((await joinCircle(sql, dee, old.token)).status).toBe(410);

    // The owner promotes, removes, can't leave; members can.
    body(await changeRole(sql, ada, id, memberKey(id, cy), "editor"));
    expect((await addItem(sql, cy, id, note)).status).toBe(201);
    body(await removeMember(sql, ada, id, memberKey(id, cy)));
    expect((await getCircle(sql, cy, id)).status).toBe(404);
    // Removed: the links made before that (the viewer link still has uses) don't let Cy back in.
    expect((await previewInvite(sql, cy, viewerLink.token)).status).toBe(403);
    expect((await joinCircle(sql, cy, viewerLink.token)).status).toBe(403);
    expect((await getCircle(sql, cy, id)).status).toBe(404);
    // A link Ada makes afterwards does (re-inviting is her choice); then she removes Cy again.
    const again = body(await createInvite(sql, ada, id, { role: "viewer", maxUses: 1 }));
    expect(body(await joinCircle(sql, cy, again.token))).toMatchObject({ role: "viewer" });
    body(await removeMember(sql, ada, id, memberKey(id, cy)));
    expect((await joinCircle(sql, cy, viewerLink.token)).status).toBe(403);
    expect((await leaveCircle(sql, ada, id)).status).toBe(409);
    expect((await removeMember(sql, ada, id, memberKey(id, ada))).status).toBe(409);

    // Handing over: Ben becomes the owner, Ada an editor; then only Ben can delete it.
    body(await changeRole(sql, ada, id, memberKey(id, ben), "owner"));
    expect(body(await getCircle(sql, ada, id)).myRole).toBe("editor");
    expect((await deleteCircle(sql, ada, id)).status).toBe(403);
    body(await leaveCircle(sql, ada, id));
    body(await deleteCircle(sql, ben, id));
    expect((await getCircle(sql, ben, id)).status).toBe(404);
  }, 120_000);
});
