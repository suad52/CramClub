import { generateSessionCookie } from "@auth0/nextjs-auth0/testing";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST } from "@/app/api/me/[...path]/route";
import { SAMPLE_LESSON } from "@/lib/learning-studio/mockLesson";

/**
 * Ownership, end to end through the /api/me route: a real Auth0 session cookie (the SDK's own
 * test helper) → requireUser → the library's queries, against a stand-in database that behaves
 * like Postgres would for owner-scoped SQL. A query that names one of Ada's rows and also binds
 * Ben's learner id (an owner filter) finds nothing; one that names her row without any learner
 * id (an unscoped query, which would be a bug) finds it. So if a route forgot its owner check,
 * Ben would get her data and these tests would fail.
 */

const dbBox = vi.hoisted(() => ({ sql: null as unknown }));
vi.mock("@/lib/learning/server/db", () => ({ db: () => dbBox.sql }));

const ENV = {
  AUTH0_DOMAIN: "ovr-test.us.auth0.com",
  AUTH0_CLIENT_ID: "test-client",
  AUTH0_CLIENT_SECRET: "test-secret",
  AUTH0_SECRET: "a".repeat(64),
  APP_BASE_URL: "http://localhost:3100",
  LEARNER_SECRET: "b".repeat(64),
};
const saved: Record<string, string | undefined> = {};

const ADA = "a0000000-0000-4000-8000-00000000000a";
const BEN = "b0000000-0000-4000-8000-00000000000b";
const SUBS: Record<string, { user_id: string; display_name: string }> = {
  "auth0|ada": { user_id: ADA, display_name: "Ada" },
  "auth0|ben": { user_id: BEN, display_name: "Ben" },
};
const COLL_A = "c0000000-0000-4000-8000-0000000000a1";
const COLL_B = "c0000000-0000-4000-8000-0000000000b1";
const ITEM_A = "d0000000-0000-4000-8000-0000000000a1";
const SRC_A = "e0000000-0000-4000-8000-0000000000a1";
const PLAN_A = "f0000000-0000-4000-8000-0000000000a1";
const TASK_A = "90000000-0000-4000-8000-0000000000a1";
const ADA_IDS = [COLL_A, ITEM_A, SRC_A, PLAN_A, TASK_A];
const SECRET = "Ada's secret exam notes";

const when = new Date("2026-11-20T15:00:00Z");

type Table = "collections" | "collection_items" | "research_sources" | "study_plans";
interface Res {
  table: Table;
  id: string;
  owner: string;
  row: Record<string, unknown>;
}

function world(): Res[] {
  return [
    {
      table: "collections",
      id: COLL_A,
      owner: ADA,
      row: { id: COLL_A, name: "Ada's exam", created_at: when, updated_at: when, item_count: 1 },
    },
    {
      table: "collections",
      id: COLL_B,
      owner: BEN,
      row: { id: COLL_B, name: "Ben's shelf", created_at: when, updated_at: when, item_count: 0 },
    },
    {
      table: "collection_items",
      id: ITEM_A,
      owner: ADA,
      row: {
        id: ITEM_A,
        collection_id: COLL_A,
        collection_name: "Ada's exam",
        kind: "note",
        title: SECRET,
        url: null,
        summary: "",
        info: { text: "only for Ada" },
        payload: { text: "only for Ada" },
        created_at: when,
        updated_at: when,
      },
    },
    {
      table: "research_sources",
      id: SRC_A,
      owner: ADA,
      row: {
        id: SRC_A,
        task_id: TASK_A,
        title: "Ada's saved source",
        url: "https://a.example.edu/recursion",
        domain: "a.example.edu",
        summary: "",
        resource_type: "article",
        saved_at: when,
        topic: "recursion",
      },
    },
    {
      table: "study_plans",
      id: PLAN_A,
      owner: ADA,
      row: {
        id: PLAN_A,
        task_id: TASK_A,
        title: "Ada's plan",
        goal: "Pass",
        target_date: null,
        daily_minutes: 30,
        days: [],
      },
    },
  ];
}

interface Call {
  text: string;
  values: unknown[];
  write: boolean;
  /** Rows it found or changed. */
  rows: number;
}

/** The stand-in database (see the comment at the top). */
function fakeDb() {
  const store = world();
  const calls: Call[] = [];
  const learners = [ADA, BEN];

  const answer = (text: string, values: unknown[]): unknown[] => {
    if (text.includes("FROM learners WHERE auth0_sub")) {
      const hit = SUBS[values[0] as string];
      return hit ? [hit] : [];
    }
    if (text.includes("FROM learners WHERE user_id")) return [{ user_id: values[0] }];

    const who = values.find((v) => learners.includes(v as string)) as string | undefined;
    const named = store.filter((r) => values.includes(r.id));
    // Postgres with an owner filter: someone else's row matches nothing.
    if (who && named.some((r) => r.owner !== who)) return [];
    const pick = (table: Table) => named.find((r) => r.table === table);
    const mine = (table: Table) =>
      store.filter((r) => r.table === table && r.owner === who).map((r) => r.row);

    if (text.startsWith("INSERT INTO collections"))
      return [
        { id: values[0], name: values[2], created_at: when, updated_at: when, item_count: 0 },
      ];
    if (text.startsWith("INSERT INTO collection_items"))
      return [
        {
          id: values[0],
          collection_id: values[1],
          kind: values[2],
          title: values[3],
          url: values[4],
          summary: values[5],
          info: values[6],
          created_at: when,
          updated_at: when,
        },
      ];
    if (text.includes("bool_or(")) return [{ n: mine("collections").length, taken: false }];
    if (text.includes("lower(name) = lower(") && !text.includes("id <>")) {
      const name = String(values.find((v) => typeof v === "string" && !learners.includes(v)));
      return mine("collections").filter((c) => String(c.name).toLowerCase() === name.toLowerCase());
    }
    if (/collection_items|collections/.test(text) && text.includes("count(*)::int AS n"))
      return [{ n: 0 }];

    const item = pick("collection_items");
    if (/(UPDATE|DELETE FROM|FROM) collection_items/.test(text) && item) return [item.row];
    const collection = pick("collections");
    if (text.includes("FROM collection_items i JOIN collections c")) {
      if (collection)
        return store
          .filter((r) => r.table === "collection_items" && r.row.collection_id === collection.id)
          .map((r) => r.row);
      return store
        .filter((r) => r.table === "collection_items" && r.owner === who && r.row.kind === "lesson")
        .map((r) => r.row);
    }
    if (text.includes("FROM collection_items WHERE collection_id")) return [];
    if (/(UPDATE collections|DELETE FROM collections|FROM collections)/.test(text)) {
      if (collection) return [collection.row];
      return text.includes("WHERE c.owner_id") || text.includes("WHERE owner_id")
        ? mine("collections")
        : [];
    }
    if (/research_sources/.test(text)) {
      const source = pick("research_sources");
      if (source) return [source.row];
      return text.includes("AND s.saved") ? mine("research_sources") : [];
    }
    if (text.includes("FROM study_plans WHERE")) {
      const plan = pick("study_plans");
      return plan ? [plan.row] : [];
    }
    return [];
  };

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    const write = /^(INSERT|UPDATE|DELETE)\b/.test(text) && !text.includes("FROM learners");
    const rows = answer(text, values);
    calls.push({ text, values, write, rows: rows.length });
    return Promise.resolve(rows);
  }) as unknown as postgres.Sql;
  Object.assign(sql, {
    json: (v: unknown) => v,
    begin: (fn: (tx: unknown) => unknown) => Promise.resolve().then(() => fn(sql)),
  });
  return { sql, calls };
}

let db: ReturnType<typeof fakeDb>;

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  db = fakeDb();
  dbBox.sql = db.sql;
});
afterEach(() => {
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  dbBox.sql = null;
});

const session = (sub: string) =>
  generateSessionCookie({ user: { sub, given_name: sub.slice(6) } }, { secret: ENV.AUTH0_SECRET });

type Method = "GET" | "POST" | "PATCH" | "DELETE";
const HANDLERS = { GET, POST, PATCH, DELETE };

async function call(
  who: "auth0|ada" | "auth0|ben" | null,
  method: Method,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const cookie = who ? `__session=${await session(who)}` : "";
  const request = new Request(`http://localhost:3100/api/me/${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  const res = await HANDLERS[method](request, {
    params: Promise.resolve({ path: path.split("/") }),
  });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) as Record<string, unknown> };
}

/**
 * Every query Ben's requests ran that named one of Ada's rows also bound Ben's id (an owner
 * filter), found nothing, and nothing was inserted with her ids.
 */
function expectScopedToBen() {
  for (const c of db.calls) {
    if (!c.values.some((v) => ADA_IDS.includes(v as string))) continue;
    expect(c.values, c.text).toContain(BEN);
    expect(c.rows, c.text).toBe(0);
    expect(c.text.startsWith("INSERT"), c.text).toBe(false);
  }
}

describe("another student's library", () => {
  const attempts: [string, Method, string, unknown?][] = [
    ["read her collection", "GET", `collections/${COLL_A}`],
    ["rename it", "PATCH", `collections/${COLL_A}`, { name: "Mine now" }],
    ["delete it", "DELETE", `collections/${COLL_A}`],
    ["add to it", "POST", `collections/${COLL_A}/items`, { kind: "note", title: "x", text: "y" }],
    ["read her item", "GET", `collections/${COLL_A}/items/${ITEM_A}`],
    ["read her item through his own collection", "GET", `collections/${COLL_B}/items/${ITEM_A}`],
    ["edit her item", "PATCH", `collections/${COLL_B}/items/${ITEM_A}`, { title: "Mine" }],
    ["edit it in place", "PATCH", `collections/${COLL_A}/items/${ITEM_A}`, { text: "gone" }],
    ["delete her item", "DELETE", `collections/${COLL_A}/items/${ITEM_A}`],
    [
      "copy her source into his collection",
      "POST",
      `collections/${COLL_B}/items`,
      { kind: "resource", sourceId: SRC_A },
    ],
    [
      "copy her plan into his collection",
      "POST",
      `collections/${COLL_B}/items`,
      { kind: "plan", planId: PLAN_A },
    ],
    ["save her plan", "POST", "plans", { planId: PLAN_A }],
    ["unsave her source", "DELETE", `saved/${SRC_A}`],
  ];

  it.each(attempts)("can't %s (404, nothing leaked or changed)", async (_, method, path, body) => {
    const res = await call("auth0|ben", method, path, body);
    expect(res.status).toBe(404);
    expect((res.json.error as { code: string }).code).toBe("not_found");
    expect(res.text).not.toContain(SECRET);
    expect(res.text).not.toContain("Ada");
    expectScopedToBen();
  });

  it("doesn't show her things in his library view", async () => {
    const res = await call("auth0|ben", "GET", "library");
    expect(res.status).toBe(200);
    for (const id of ADA_IDS) expect(res.text).not.toContain(id);
    expect(res.text).not.toContain(SECRET);
    expect(res.text).not.toContain("Ada's");
    expect(res.json).toMatchObject({ displayName: "Ben" });
  });

  it("can't make a collection for her by naming her as the owner", async () => {
    const res = await call("auth0|ben", "POST", "collections", {
      name: "Planted",
      owner_id: ADA,
      ownerId: ADA,
    });
    expect(res.status).toBe(201);
    const insert = db.calls.find((c) => c.text.startsWith("INSERT INTO collections"))!;
    expect(insert.values).toContain(BEN);
    expect(insert.values).not.toContain(ADA);
  });
});

describe("the owner", () => {
  it("can read, add to and edit her own collection", async () => {
    const read = await call("auth0|ada", "GET", `collections/${COLL_A}`);
    expect(read.status).toBe(200);
    expect(read.text).toContain(SECRET);

    const added = await call("auth0|ada", "POST", `collections/${COLL_A}/items`, {
      kind: "note",
      title: "Base cases",
      text: "Start with the empty list.",
    });
    expect(added.status).toBe(201);
    const insert = db.calls.find((c) => c.text.startsWith("INSERT INTO collection_items"))!;
    expect(insert.values).toContain(ADA); // added_by is the session's learner

    const edited = await call("auth0|ada", "PATCH", `collections/${COLL_A}/items/${ITEM_A}`, {
      title: "Renamed",
    });
    expect(edited.status).toBe(200);

    const unsaved = await call("auth0|ada", "DELETE", `saved/${SRC_A}`);
    expect(unsaved.status).toBe(200);
  });

  it("can save her own source and plan", async () => {
    const source = await call("auth0|ada", "POST", `collections/${COLL_A}/items`, {
      kind: "resource",
      sourceId: SRC_A,
    });
    expect(source.status).toBe(201);
    expect(source.json).toMatchObject({ added: true, item: { kind: "resource" } });
    const plan = await call("auth0|ada", "POST", "plans", { planId: PLAN_A });
    expect(plan.status).toBe(201);
    expect(plan.json).toMatchObject({ collection: { name: "My study plans" } });
  });

  it("saves a Learning Studio lesson into My lessons", async () => {
    const res = await call("auth0|ada", "POST", "lessons", {
      lesson: SAMPLE_LESSON,
      chunks: [{ page: 1, text: "Glycolysis happens in the cytoplasm." }],
      sourceName: "bio.pdf",
      progress: { scene: 1, completed: false },
    });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({
      collection: { name: "My lessons" },
      item: { kind: "lesson", lesson: { scenes: SAMPLE_LESSON.scenes.length, hasNotes: true } },
    });
  });
});

describe("requests the library refuses", () => {
  it("is 503 auth_not_configured until sign-in is set up", async () => {
    delete process.env.AUTH0_CLIENT_SECRET;
    const res = await call(null, "GET", "library");
    expect(res.status).toBe(503);
    expect(res.json).toMatchObject({ error: { code: "auth_not_configured" } });
    expect(db.calls).toHaveLength(0);
  });

  it("is 401 sign_in_required without a session", async () => {
    const res = await call(null, "GET", "library");
    expect(res.status).toBe(401);
    expect(res.json).toMatchObject({ error: { code: "sign_in_required" } });
  });

  it("is 401 for a session sealed with another secret", async () => {
    const forged = await generateSessionCookie(
      { user: { sub: "auth0|ada" } },
      { secret: "c".repeat(64) },
    );
    const res = await call(null, "GET", "library", undefined, { cookie: `__session=${forged}` });
    expect(res.status).toBe(401);
  });

  it("wants JSON for writes", async () => {
    const res = await call("auth0|ada", "POST", "collections", undefined, {
      "content-type": "text/plain",
    });
    expect(res.status).toBe(415);
  });

  it("refuses bodies over the cap", async () => {
    const res = await call("auth0|ada", "POST", "lessons", "x".repeat(700_000));
    expect(res.status).toBe(413);
  });

  it("refuses links that aren't https", async () => {
    const res = await call("auth0|ada", "POST", `collections/${COLL_A}/items`, {
      kind: "resource",
      title: "Old page",
      url: "http://example.edu/page",
    });
    expect(res.status).toBe(422);
    expect(res.json).toMatchObject({ error: { code: "not_https" } });
  });

  it("refuses a lesson that isn't a lesson", async () => {
    const res = await call("auth0|ada", "POST", "lessons", { lesson: { title: "x" } });
    expect(res.status).toBe(400);
  });

  it("answers 404 for ids that aren't ids", async () => {
    const res = await call("auth0|ada", "GET", "collections/1%20OR%201=1");
    expect(res.status).toBe(404);
    expect(db.calls.some((c) => c.text.includes("collections c WHERE c.id"))).toBe(false);
  });
});
