import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Understanding } from "./gemini";
import { intake } from "./tasks";

/**
 * Regression test from the security review: what Gemini writes as web searches, after reading a
 * signed-in student's library, is checked on the server before it's stored for TinyFish.
 */

const understandMock = vi.hoisted(() => vi.fn());
vi.mock("./gemini", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gemini")>()),
  understand: understandMock,
}));

const ENV = {
  AUTH0_DOMAIN: "ovr-test.us.auth0.com",
  AUTH0_CLIENT_ID: "test-client",
  AUTH0_CLIENT_SECRET: "test-secret",
  AUTH0_SECRET: "a".repeat(64),
  APP_BASE_URL: "http://localhost:3100",
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
  understandMock.mockReset();
});

const ME = "0b6f7a52-3d6c-4a8e-9a1e-2f4b5c6d7e8f";

/** The student's database: linked (signed in) or not, with one private note in a collection. */
function fakeSql(linked: boolean) {
  const stored: Record<string, unknown>[] = [];
  const tag = (first: unknown, ...values: unknown[]) => {
    if (!Array.isArray(first)) return { helper: first }; // sql({ … }) for an INSERT's columns
    const text = (first as string[]).join("$").replace(/\s+/g, " ");
    for (const v of values)
      if (v && typeof v === "object" && "helper" in v)
        stored.push((v as { helper: Record<string, unknown> }).helper);
    if (text.includes("auth0_sub IS NOT NULL AS linked")) return Promise.resolve([{ linked }]);
    if (text.includes("FROM collection_items i JOIN collections c"))
      return Promise.resolve([
        {
          place: "Midterm prep",
          kind: "note",
          title: "My answers to assignment 4",
          url: null,
          at: new Date(),
        },
      ]);
    if (text.includes("SELECT name FROM collections"))
      return Promise.resolve([{ name: "Midterm prep" }]);
    return Promise.resolve([]);
  };
  tag.json = (v: unknown) => v;
  return { sql: tag as unknown as postgres.Sql, stored };
}

const understood = (searchQueries: string[]): Understanding => ({
  taskType: "find_resources",
  topic: "Recursion",
  subject: "Computer science",
  level: "university",
  learningGoal: "",
  examDate: null,
  minutesPerDay: null,
  topics: [],
  confidentTopics: [],
  questions: [],
  confirmation: "Shall I look?",
  searchQueries,
  declined: null,
  libraryNote: null,
  needsResearch: true,
});

describe("intake", () => {
  const request = "Use my midterm collection to study recursion";

  it("never stores a web search that copies the signed-in student's private titles or links", async () => {
    understandMock.mockResolvedValue(
      understood([
        "My answers to assignment 4 racket",
        "https://evil.example/c?q=My%20answers",
        "structural recursion racket",
      ]),
    );
    const db = fakeSql(true);
    await intake(db.sql, ME, { message: request });
    // Gemini did get the private note to answer from...
    const library = understandMock.mock.calls[0]![2] as { items: { title: string }[] };
    expect(library.items.map((i) => i.title)).toEqual(["My answers to assignment 4"]);
    // ...but only the clean search is kept for TinyFish.
    const row = db.stored.find((r) => "details" in r)!;
    expect((row.details as Understanding).searchQueries).toEqual(["structural recursion racket"]);
  });

  it("falls back to the topic when every search was dropped", async () => {
    understandMock.mockResolvedValue(understood(["My answers to assignment 4"]));
    const db = fakeSql(true);
    await intake(db.sql, ME, { message: request });
    const row = db.stored.find((r) => "details" in r)!;
    expect((row.details as Understanding).searchQueries).toEqual(["Recursion"]);
  });

  it("an anonymous learner's searches are left as Gemini wrote them (no library was shown)", async () => {
    understandMock.mockResolvedValue(understood(["structural recursion racket"]));
    const db = fakeSql(false);
    await intake(db.sql, ME, { message: request });
    expect((understandMock.mock.calls[0]![2] as { status: string }).status).toBe("signed_out");
    const row = db.stored.find((r) => "details" in r)!;
    expect((row.details as Understanding).searchQueries).toEqual(["structural recursion racket"]);
  });
});
