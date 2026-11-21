import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "@/lib/learning-studio/mockLesson";
import {
  LibraryError,
  addItem,
  createCollection,
  deleteCollection,
  getCollection,
  getItem,
  libraryView,
  listCollections,
  removeItem,
  renameCollection,
  saveLesson,
  savePlan,
  unsaveSource,
  updateItem,
} from "./server";

/**
 * The same ownership rules against the real database (Tiger Data), so the SQL itself is checked,
 * not just a stand-in. Opt in: `LIBRARY_DB_TEST=1 pnpm vitest run lib/library/server.db.test.ts`
 * from apps/web (it reads DATABASE_URL from .env.local and never prints it). It makes two
 * throwaway learners and deletes them, and everything they own, at the end.
 */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = new URL("../../.env.local", import.meta.url);
  if (!existsSync(file)) return "";
  const line = readFileSync(file, "utf8")
    .split("\n")
    .find((l) => l.startsWith("DATABASE_URL="));
  return line
    ? line
        .slice("DATABASE_URL=".length)
        .trim()
        .replace(/^"(.*)"$/, "$1")
    : "";
}

const enabled = process.env.LIBRARY_DB_TEST === "1" && !!databaseUrl();

describe.skipIf(!enabled)("personal library on the real database", { timeout: 60_000 }, () => {
  let sql: postgres.Sql;
  const ada = randomUUID();
  const ben = randomUUID();
  const task = randomUUID();
  const source = randomUUID();
  const httpSource = randomUUID();
  const plan = randomUUID();
  let adaShelf = "";
  let adaNote = "";

  beforeAll(async () => {
    sql = postgres(databaseUrl(), { max: 3, onnotice: () => {} });
    await sql`INSERT INTO learners (user_id, display_name, leaderboard_opt_in)
      VALUES (${ada}, 'Library test A', false), (${ben}, 'Library test B', false)`;
    await sql`INSERT INTO librarian_tasks (id, user_id, task_type, status, user_request, topic)
      VALUES (${task}, ${ada}, 'research_topic', 'completed', 'library test', 'Recursion')`;
    await sql`INSERT INTO research_sources (id, task_id, user_id, title, url, domain, summary, saved, saved_at)
      VALUES (${source}, ${task}, ${ada}, 'Ada source', 'https://example.edu/recursion', 'example.edu', 'About recursion', true, now()),
             (${httpSource}, ${task}, ${ada}, 'Old source', 'http://example.edu/old', 'example.edu', '', false, NULL)`;
    await sql`INSERT INTO study_plans (id, user_id, task_id, title, goal, start_date, daily_minutes)
      VALUES (${plan}, ${ada}, ${task}, 'Ada plan', 'Learn recursion', current_date, 30)`;
    await sql`INSERT INTO study_plan_items (id, study_plan_id, user_id, scheduled_date, activity_type, title, estimated_minutes, status)
      VALUES (${randomUUID()}, ${plan}, ${ada}, current_date, 'read', 'Read chapter 1', 20, 'done'),
             (${randomUUID()}, ${plan}, ${ada}, current_date + 1, 'practice', 'Practice', 30, 'todo')`;
  }, 60_000);

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM learners WHERE user_id IN (${ada}, ${ben})`;
    await sql.end();
  }, 60_000);

  it("lets the owner build a library", async () => {
    const shelf = await createCollection(sql, ada, "CS 135 midterm");
    adaShelf = shelf.id;
    await expect(createCollection(sql, ada, "cs 135 MIDTERM")).rejects.toMatchObject({
      status: 409,
      code: "duplicate",
    });

    const note = await addItem(sql, ada, shelf.id, {
      kind: "note",
      title: "Tips",
      text: "Base case first",
    });
    adaNote = note!.item.id;
    expect(note).toMatchObject({ added: true, item: { kind: "note", note: "Base case first" } });

    const res = await addItem(sql, ada, shelf.id, { kind: "resource", sourceId: source });
    expect(res).toMatchObject({ added: true, item: { url: "https://example.edu/recursion" } });
    const again = await addItem(sql, ada, shelf.id, { kind: "resource", sourceId: source });
    expect(again?.added).toBe(false);
    await expect(
      addItem(sql, ada, shelf.id, { kind: "resource", sourceId: httpSource }),
    ).rejects.toMatchObject({ status: 422 });

    const p = await savePlan(sql, ada, plan);
    expect(p).toMatchObject({
      collection: { name: "My study plans" },
      item: { plan: { total: 2, done: 1, live: true } },
    });

    const lesson = await saveLesson(sql, ada, {
      lesson: SAMPLE_LESSON,
      chunks: SAMPLE_NOTES,
      sourceName: "bio.pdf",
      progress: { scene: 1, completed: false },
    });
    expect(lesson.added).toBe(true);
    const relesson = await saveLesson(sql, ada, { lesson: SAMPLE_LESSON });
    expect(relesson.added).toBe(false);
    expect(relesson.item.lesson?.progress.scene).toBe(1); // re-saving keeps the place

    const detail = await getItem(sql, ada, lesson.collection.id, lesson.item.id);
    expect(detail?.lesson?.lesson.title).toBe(SAMPLE_LESSON.title);
    expect(detail?.lesson?.chunks).toHaveLength(SAMPLE_NOTES.length);
    const moved = await updateItem(sql, ada, lesson.collection.id, lesson.item.id, {
      progress: { scene: 2, completed: false },
    });
    expect(moved?.lesson?.progress.scene).toBe(2);

    const view = await libraryView(sql, ada, "Ada");
    expect(view.saved.map((s) => s.id)).toContain(source);
    expect(view.collections.map((c) => c.name).sort()).toEqual(
      ["CS 135 midterm", "My lessons", "My study plans"].sort(),
    );
    expect(view.lessons).toHaveLength(1);
    expect(view.continue.some((c) => c.kind === "lesson")).toBe(true);
    expect(view.continue.some((c) => c.kind === "plan_item")).toBe(true);
    expect(view.lastTopic).toBe("Recursion");

    const shown = await getCollection(sql, ada, shelf.id);
    expect(shown?.items).toHaveLength(2);
    expect(await renameCollection(sql, ada, shelf.id, "CS 135 final")).toMatchObject({
      name: "CS 135 final",
      itemCount: 2,
    });
  });

  it("gives another student nothing of hers", async () => {
    expect(await getCollection(sql, ben, adaShelf)).toBeNull();
    expect(await renameCollection(sql, ben, adaShelf, "Mine")).toBeNull();
    expect(await deleteCollection(sql, ben, adaShelf)).toBe(false);
    expect(await addItem(sql, ben, adaShelf, { kind: "note", title: "x", text: "y" })).toBeNull();
    expect(await getItem(sql, ben, adaShelf, adaNote)).toBeNull();
    expect(await updateItem(sql, ben, adaShelf, adaNote, { title: "Mine" })).toBeNull();
    expect(await removeItem(sql, ben, adaShelf, adaNote)).toBe(false);
    expect(await savePlan(sql, ben, plan)).toBeNull();
    expect(await unsaveSource(sql, ben, source)).toBe(false);

    // Through his own collection: her item isn't in it, her source and plan aren't his.
    const own = await createCollection(sql, ben, "Ben shelf");
    expect(await getItem(sql, ben, own.id, adaNote)).toBeNull();
    expect(await updateItem(sql, ben, own.id, adaNote, { title: "Mine" })).toBeNull();
    for (const input of [
      { kind: "resource" as const, sourceId: source },
      { kind: "plan" as const, planId: plan },
    ]) {
      const err = await addItem(sql, ben, own.id, input).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(LibraryError);
      expect((err as LibraryError).status).toBe(404);
    }

    const view = await libraryView(sql, ben, "Ben");
    expect(view.saved).toHaveLength(0);
    expect(view.collections.map((c) => c.name)).toEqual(["Ben shelf"]);
    expect(view.lessons).toHaveLength(0);
    expect(view.history.tasks).toHaveLength(0);
    expect(view.continue).toHaveLength(0);
    expect(await listCollections(sql, ben)).toHaveLength(1);

    // And hers is untouched.
    const [still] = await sql`SELECT title FROM collection_items WHERE id = ${adaNote}`;
    expect(still?.title).toBe("Tips");
  });

  it("lets the owner tidy up", async () => {
    expect(await removeItem(sql, ada, adaShelf, adaNote)).toBe(true);
    expect(await unsaveSource(sql, ada, source)).toBe(true);
    expect(await deleteCollection(sql, ada, adaShelf)).toBe(true);
    const [left] = await sql`SELECT count(*)::int AS n FROM collection_items i
      JOIN collections c ON c.id = i.collection_id WHERE c.id = ${adaShelf}`;
    expect(left?.n).toBe(0);
  });
});
