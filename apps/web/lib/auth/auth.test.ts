import { generateSessionCookie } from "@auth0/nextjs-auth0/testing";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  accountLearner,
  anonymousLearner,
  learnerCookieHeader,
} from "@/lib/learning/server/identity";
import { authConfigured, cleanDomain } from "./auth0";
import { requireUser } from "./currentUser";
import { hashEmail, maskEmail, normalizeEmail, verifiedEmailHash } from "./emailHash";
import { hashInviteToken, isInviteToken, newInviteToken } from "./inviteToken";
import { loginHref, safeReturnTo } from "./links";
import { profileName } from "./session";

/** The database the tests' requireUser sees (see the mock below). */
const dbBox = vi.hoisted(() => ({ sql: null as unknown }));
vi.mock("@/lib/learning/server/db", () => ({ db: () => dbBox.sql }));

type Call = { text: string; values: unknown[] };

/** A stand-in for the postgres.js tag: records each query and answers through `answer`. */
function fakeSql(answer: (text: string, values: unknown[]) => unknown[] | Error) {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("$").replace(/\s+/g, " ");
    calls.push({ text, values });
    const out = answer(text, values);
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
  }) as unknown as postgres.Sql;
  return { sql, calls };
}

const uniqueViolation = () => Object.assign(new Error("duplicate key"), { code: "23505" });
const SUB = "google-oauth2|1234567890";
const COOKIE_ID = "0b6f7a52-3d6c-4a8e-9a1e-2f4b5c6d7e8f";
const OTHER_ID = "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a";

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

const learnerCookie = (id: string) => learnerCookieHeader(id).split(";")[0]!;
const request = (cookie = "") =>
  new Request("http://localhost:3100/api/library", { headers: cookie ? { cookie } : {} });

describe("configuration", () => {
  it("needs every Auth0 key", () => {
    expect(authConfigured()).toBe(true);
    process.env.AUTH0_CLIENT_SECRET = " ";
    expect(authConfigured()).toBe(false);
  });

  it("accepts a domain pasted as a URL", () => {
    expect(cleanDomain("https://ovr.us.auth0.com/")).toBe("ovr.us.auth0.com");
  });
});

describe("accountLearner", () => {
  const identity = { sub: SUB, name: "Suad" };

  it("uses the learner already linked to the account and leaves the cookie's alone", async () => {
    const db = fakeSql((t) =>
      t.includes("WHERE auth0_sub =") ? [{ user_id: OTHER_ID, display_name: "Night owl" }] : [],
    );
    const me = await accountLearner(db.sql, identity, COOKIE_ID);
    expect(me).toMatchObject({ id: OTHER_ID, signedIn: true, authSub: SUB });
    expect(db.calls.some((c) => c.text.includes("UPDATE learners SET auth0_sub"))).toBe(false);
  });

  it("links the browser's unlinked learner on the first sign-in, so progress carries over", async () => {
    const db = fakeSql((t) =>
      t.includes("UPDATE learners SET auth0_sub")
        ? [{ user_id: COOKIE_ID, display_name: "Suad" }]
        : [],
    );
    const me = await accountLearner(db.sql, identity, COOKIE_ID);
    expect(me.id).toBe(COOKIE_ID);
    const link = db.calls.find((c) => c.text.includes("UPDATE learners SET auth0_sub"))!;
    expect(link.text).toContain("auth0_sub IS NULL"); // never takes over someone else's learner
    expect(link.values).toContain(SUB);
  });

  it("makes a new learner when the cookie's learner can't be linked", async () => {
    const db = fakeSql((t, v) =>
      t.includes("INSERT INTO learners") ? [{ user_id: v[0], display_name: "Suad" }] : [],
    );
    const me = await accountLearner(db.sql, identity, COOKIE_ID);
    expect(me.id).not.toBe(COOKIE_ID);
    expect(db.calls.at(-1)!.text).toContain("ON CONFLICT (auth0_sub) DO NOTHING");
  });

  it("settles a race between two first requests on the same row", async () => {
    let lookups = 0;
    const db = fakeSql((t) => {
      if (t.includes("WHERE auth0_sub ="))
        return lookups++ === 0 ? [] : [{ user_id: OTHER_ID, display_name: "Suad" }];
      if (t.includes("UPDATE learners SET auth0_sub")) return uniqueViolation();
      return [];
    });
    expect((await accountLearner(db.sql, identity, COOKIE_ID)).id).toBe(OTHER_ID);
  });

  it("replaces a placeholder name with the profile's", async () => {
    const db = fakeSql((t) =>
      t.includes("WHERE auth0_sub =") ? [{ user_id: OTHER_ID, display_name: "Reader 9d8c" }] : [],
    );
    expect((await accountLearner(db.sql, identity, null)).displayName).toBe("Suad");
    expect(db.calls.some((c) => c.text.startsWith("UPDATE learners SET display_name"))).toBe(true);
  });
});

describe("anonymousLearner", () => {
  it("keeps using an unlinked cookie learner", async () => {
    const db = fakeSql(() => [{ linked: false, display_name: "Reader 0b6f" }]);
    const me = await anonymousLearner(db.sql, request(learnerCookie(COOKIE_ID)), true);
    expect(me).toMatchObject({ id: COOKIE_ID, signedIn: false });
    expect(me?.setCookie).toBeUndefined();
  });

  it("never reaches an account's learner through the cookie alone (after signing out)", async () => {
    const db = fakeSql((t) => (t.includes("SELECT") ? [{ linked: true, display_name: "A" }] : []));
    expect(await anonymousLearner(db.sql, request(learnerCookie(COOKIE_ID)), false)).toBeNull();
    const fresh = await anonymousLearner(db.sql, request(learnerCookie(COOKIE_ID)), true);
    expect(fresh!.id).not.toBe(COOKIE_ID);
    expect(fresh!.setCookie).toContain(fresh!.id);
  });

  it("ignores a forged cookie", async () => {
    const db = fakeSql(() => []);
    expect(
      await anonymousLearner(db.sql, request(`ovr_learner=${COOKIE_ID}.forged`), false),
    ).toBeNull();
  });
});

describe("requireUser", () => {
  const session = (sub = SUB) =>
    generateSessionCookie(
      { user: { sub, name: "Suad K", given_name: "Suad" } },
      { secret: ENV.AUTH0_SECRET },
    );

  it("is 503 auth_not_configured until the Auth0 keys are set", async () => {
    delete process.env.AUTH0_DOMAIN;
    const res = (await requireUser(request())) as Response;
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("auth_not_configured");
  });

  it("is 401 sign_in_required without a session, even with a learner cookie", async () => {
    dbBox.sql = fakeSql(() => []).sql;
    const res = (await requireUser(request(learnerCookie(COOKIE_ID)))) as Response;
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("sign_in_required");
  });

  it("is 401 for a session cookie that doesn't decrypt", async () => {
    dbBox.sql = fakeSql(() => []).sql;
    const res = (await requireUser(request("__session=not-a-real-session"))) as Response;
    expect(res.status).toBe(401);
  });

  it("is 401 for a session sealed with another secret", async () => {
    dbBox.sql = fakeSql(() => []).sql;
    const forged = await generateSessionCookie({ user: { sub: SUB } }, { secret: "c".repeat(64) });
    const res = (await requireUser(request(`__session=${forged}`))) as Response;
    expect(res.status).toBe(401);
  });

  it("returns the account's learner for a verified session", async () => {
    const db = fakeSql((t, v) =>
      t.includes("WHERE auth0_sub =") && v[0] === SUB
        ? [{ user_id: OTHER_ID, display_name: "Suad" }]
        : [],
    );
    dbBox.sql = db.sql;
    const me = await requireUser(request(`__session=${await session()}`));
    expect(me).not.toBeInstanceOf(Response);
    expect(me).toMatchObject({ learnerId: OTHER_ID, signedIn: true, authSub: SUB });
  });
});

describe("profileName", () => {
  it("prefers the first name and skips email addresses", () => {
    expect(profileName({ given_name: "Suad", name: "Suad K" })).toBe("Suad");
    // The nickname of a password account is its email's local part: never used.
    expect(profileName({ name: "suad@example.com", nickname: "suad.k1987" })).toBeNull();
    expect(profileName({ name: "a@b.co" })).toBeNull();
    expect(profileName({ name: "x".repeat(50) })).toHaveLength(32);
  });

  it("publishes a first name only (it can show on the leaderboard), never a full name", () => {
    expect(profileName({ name: "Jane Q. Public", nickname: "jqpublic" })).toBe("Jane");
    expect(profileName({ nickname: "jqpublic" })).toBeNull();
  });
});

describe("links", () => {
  it("only returns to paths on this site", () => {
    expect(safeReturnTo("/progress")).toBe("/progress");
    expect(safeReturnTo("//evil.example")).toBe("/");
    expect(safeReturnTo("https://evil.example")).toBe("/");
    expect(safeReturnTo("/\\evil.example")).toBe("/");
    expect(loginHref("/librarian")).toBe("/auth/login?returnTo=%2Flibrarian");
    expect(loginHref("/")).toBe("/auth/login");
  });
});

describe("invite tokens", () => {
  it("stores only a hash of the token", () => {
    const { token, hash } = newInviteToken();
    expect(isInviteToken(token)).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(hashInviteToken(token));
    expect(hash).not.toContain(token);
    expect(isInviteToken("../../etc")).toBe(false);
  });
});

describe("email hashes", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("compare addresses trimmed and lowercased, as 64 hex characters, never the address", () => {
    expect(normalizeEmail("  Bi.Lal@Gmail.COM \n")).toBe("bi.lal@gmail.com");
    const hash = hashEmail("bi.lal@gmail.com")!;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashEmail("  Bi.Lal@Gmail.COM ")).toBe(hash);
    expect(hashEmail("bilal@gmail.com")).not.toBe(hash); // dots are the address's own business
    expect(hash).not.toContain("bi.lal");
    for (const bad of ["", "   ", "no-at-sign", `${"a".repeat(250)}@b.co`])
      expect(hashEmail(bad)).toBeNull();
  });

  it("are keyed: another secret gives another hash, and no secret gives none", () => {
    const derived = hashEmail("ada@example.com");
    vi.stubEnv("EMAIL_HASH_SECRET", "c".repeat(64));
    const own = hashEmail("ada@example.com");
    expect(own).toMatch(/^[0-9a-f]{64}$/);
    expect(own).not.toBe(derived);
    vi.stubEnv("EMAIL_HASH_SECRET", "d".repeat(64));
    expect(hashEmail("ada@example.com")).not.toBe(own);
    vi.stubEnv("EMAIL_HASH_SECRET", "");
    expect(hashEmail("ada@example.com")).toBe(derived); // back to the one from AUTH0_SECRET
    vi.stubEnv("AUTH0_SECRET", "");
    expect(hashEmail("ada@example.com")).toBeNull();
  });

  it("only come from an email Auth0 says is verified", () => {
    const hash = hashEmail("ada@example.com");
    expect(verifiedEmailHash({ email: "Ada@Example.com", email_verified: true })).toBe(hash);
    for (const user of [
      { email: "ada@example.com", email_verified: false },
      { email: "ada@example.com", email_verified: "true" },
      { email: "ada@example.com", email_verified: 1 },
      { email: "ada@example.com" },
      { email_verified: true },
      { email: ["ada@example.com"], email_verified: true },
      {},
    ])
      expect(verifiedEmailHash(user)).toBeNull();
  });

  it("fold only ASCII, so a look-alike address can't take someone's invites", () => {
    const kate = hashEmail("kate@x.com")!;
    // toLowerCase turns the Kelvin sign into a plain "k": compared that way, a verified
    // "Kate@x.com" would be Kate. Only ASCII letters and spaces are folded.
    expect("Kate@x.com".toLowerCase()).toBe("kate@x.com");
    expect(normalizeEmail("Kate@x.com")).toBe("Kate@x.com");
    expect(hashEmail("Kate@x.com")).not.toBe(kate);
    expect(verifiedEmailHash({ email: "Kate@x.com", email_verified: true })).not.toBe(kate);
    expect(verifiedEmailHash({ email: "KATE@X.COM", email_verified: true })).not.toBe(kate);
    // Nor do other spaces around it count as nothing.
    for (const odd of [" kate@x.com", "kate@x.com ", "﻿kate@x.com"])
      expect(hashEmail(odd)).not.toBe(kate);
    expect(verifiedEmailHash({ email: " KATE@X.com\t", email_verified: true })).toBe(kate);
  });

  it("ignore an EMAIL_HASH_SECRET too short to keep a guess out", () => {
    const derived = hashEmail("ada@example.com");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("EMAIL_HASH_SECRET", "hunter2");
    expect(hashEmail("ada@example.com")).toBe(derived);
    vi.stubEnv("EMAIL_HASH_SECRET", "e".repeat(32));
    expect(hashEmail("ada@example.com")).not.toBe(derived);
    // The warning names the variable, never its value.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("hunter2");
    warn.mockRestore();
  });

  it("are shown to the holder only masked", () => {
    expect(maskEmail("Bilal@Gmail.com")).toBe("bi•••@gmail.com");
    expect(maskEmail("ab@x.org")).toBe("a•••@x.org");
    expect(maskEmail("a@x.org")).toBe("a•••@x.org");
  });
});
