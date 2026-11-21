import { generateSessionCookie } from "@auth0/nextjs-auth0/testing";
import { NextRequest } from "next/server";
import type postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanAuthUrl } from "./links";
import { crossOriginWrite } from "./sameOrigin";

/**
 * Regression tests from the security review: cross-origin writes (CSRF) on every endpoint a
 * cookie authenticates, and the parameters /auth/login and /auth/logout pass on to Auth0.
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

const ME = "0a000000-0000-4000-8000-0000000000aa";
const SOME_ID = "11111111-1111-4111-8111-111111111111";

/** A database that knows one account (auth0|ada → ME) and records every query. */
function fakeDb() {
  const calls: string[] = [];
  const tag = (strings: TemplateStringsArray) => {
    const text = strings.join("$").replace(/\s+/g, " ").trim();
    calls.push(text);
    if (text.includes("FROM learners WHERE auth0_sub ="))
      return Promise.resolve([{ user_id: ME, display_name: "Ada" }]);
    return Promise.resolve([]);
  };
  tag.begin = (fn: (tx: unknown) => unknown) => Promise.resolve(fn(tag));
  tag.json = (v: unknown) => v;
  const sql = tag as unknown as postgres.Sql;
  dbBox.sql = sql;
  return { sql, calls };
}

const session = async () =>
  `__session=${await generateSessionCookie(
    { user: { sub: "auth0|ada", given_name: "Ada" } },
    { secret: ENV.AUTH0_SECRET },
  )}`;

const EVIL = "https://evil.example";

describe("crossOriginWrite", () => {
  const req = (headers: Record<string, string>, url = "http://localhost:3100/api/me/x") =>
    new Request(url, { method: "POST", headers });

  it("lets this site's own pages, and non-browsers, through", () => {
    expect(crossOriginWrite(req({ origin: "http://localhost:3100" }))).toBe(false);
    expect(
      crossOriginWrite(req({ origin: "http://localhost:3100", "sec-fetch-site": "same-origin" })),
    ).toBe(false);
    expect(crossOriginWrite(req({}))).toBe(false); // curl, a server, a test: still needs a session
  });

  it("refuses another site, another port on the same host, and opaque origins", () => {
    expect(crossOriginWrite(req({ origin: EVIL }))).toBe(true);
    expect(crossOriginWrite(req({ origin: "http://localhost:5173" }))).toBe(true);
    expect(crossOriginWrite(req({ origin: "null" }))).toBe(true);
    expect(crossOriginWrite(req({ "sec-fetch-site": "cross-site" }))).toBe(true);
    expect(crossOriginWrite(req({ "sec-fetch-site": "same-site" }))).toBe(true);
  });

  it("accepts the host the browser used, even when next dev reports another", () => {
    // Opened at 127.0.0.1:3100: next dev still says request.url is localhost:3100.
    const viaIp = req({ origin: "http://127.0.0.1:3100", host: "127.0.0.1:3100" });
    expect(crossOriginWrite(viaIp)).toBe(false);
    const evilWithOurHost = req({ origin: EVIL, host: "127.0.0.1:3100" });
    expect(crossOriginWrite(evilWithOurHost)).toBe(true);
  });

  it("accepts APP_BASE_URL's origin when a proxy hands the app another host", () => {
    const behindProxy = req({ origin: "http://localhost:3100" }, "http://10.0.0.7:8080/api/me/x");
    expect(crossOriginWrite(behindProxy)).toBe(false);
  });
});

describe("cookie-authenticated writes refuse other sites (CSRF)", () => {
  type Route = Record<string, (r: Request, c: { params: Promise<unknown> }) => Promise<Response>>;

  async function send(
    route: Route,
    method: string,
    url: string,
    params: unknown,
    headers: Record<string, string>,
    body?: BodyInit,
  ) {
    const request = new Request(url, { method, headers, body });
    const res = await route[method]!(request, { params: Promise.resolve(params) });
    return { status: res.status, json: (await res.json()) as { error?: { code: string } } };
  }

  it("/api/me: a signed-in student's DELETE from another site changes nothing", async () => {
    const db = fakeDb();
    const route = (await import("@/app/api/me/[...path]/route")) as unknown as Route;
    const path = { path: ["collections", SOME_ID] };
    const url = `http://localhost:3100/api/me/collections/${SOME_ID}`;
    const cookie = await session();
    const cross = await send(route, "DELETE", url, path, { cookie, origin: EVIL });
    expect(cross).toMatchObject({ status: 403, json: { error: { code: "forbidden" } } });
    expect(db.calls).toEqual([]); // refused before the session or the database were touched
    const own = await send(route, "DELETE", url, path, { cookie, origin: "http://localhost:3100" });
    expect(own.status).toBe(404); // reached the owner-scoped delete (nothing of theirs by that id)
    expect(db.calls.some((t) => t.startsWith("DELETE FROM collections"))).toBe(true);
  });

  it("/api/circles: a body has to be JSON, so a plain form can't post one", async () => {
    fakeDb();
    const route = (await import("@/app/api/circles/[...path]/route")) as unknown as Route;
    const res = await send(
      route,
      "POST",
      "http://localhost:3100/api/circles/join",
      { path: ["join"] },
      { cookie: await session(), "content-type": "text/plain" },
      JSON.stringify({ token: "A".repeat(43) }),
    );
    expect(res).toMatchObject({ status: 415, json: { error: { code: "bad_content_type" } } });
    const cross = await send(
      route,
      "POST",
      "http://localhost:3100/api/circles/join",
      { path: ["join"] },
      { cookie: await session(), "content-type": "application/json", origin: EVIL },
      JSON.stringify({ token: "A".repeat(43) }),
    );
    expect(cross.status).toBe(403);
  });

  it("/api/librarian: research, saves and note uploads can't be started from another site", async () => {
    const db = fakeDb();
    const route = (await import("@/app/api/librarian/[...path]/route")) as unknown as Route;
    const cookie = await session();
    for (const [path, body, headers] of [
      [["tasks"], JSON.stringify({ message: "Find CS135 resources" }), { origin: EVIL }],
      [["resources", SOME_ID], JSON.stringify({ saved: true }), { origin: EVIL }],
      [["notes"], new FormData(), { "sec-fetch-site": "cross-site" }],
    ] as const) {
      const res = await send(
        route,
        "POST",
        `http://localhost:3100/api/librarian/${path.join("/")}`,
        { path },
        { cookie, ...headers },
        body,
      );
      expect(res.status).toBe(403);
    }
    expect(db.calls).toEqual([]);
  });

  it("/api/learning: XP and focus sessions can't be recorded from another site", async () => {
    const db = fakeDb();
    const route = (await import("@/app/api/learning/[action]/route")) as unknown as Route;
    const res = await send(
      route,
      "POST",
      "http://localhost:3100/api/learning/session-start",
      { action: "session-start" },
      { cookie: await session(), origin: EVIL, "content-type": "application/json" },
      JSON.stringify({ plannedMinutes: 25 }),
    );
    expect(res.status).toBe(403);
    expect(db.calls).toEqual([]);
  });
});

describe("cleanAuthUrl", () => {
  const at = (path: string) => new URL(path, "http://localhost:3100");
  const cleaned = (path: string) => {
    const out = cleanAuthUrl(at(path));
    return out ? out.pathname + out.search : null;
  };

  it("leaves OVR's own sign-in and sign-out links alone", () => {
    expect(cleaned("/auth/login")).toBeNull();
    expect(cleaned("/auth/login?returnTo=%2Fmy-library")).toBeNull();
    expect(cleaned("/auth/login?returnTo=%2Fcircles%2Fjoin%2Fabc&screen_hint=signup")).toBeNull();
    expect(cleaned("/auth/logout")).toBeNull();
    expect(cleaned("/auth/callback?code=x&state=y")).toBeNull(); // the SDK checks those itself
  });

  it("drops anything a crafted link could forward to Auth0's /authorize", () => {
    expect(
      cleaned(
        "/auth/login?scope=openid%20profile%20email%20offline_access&audience=https%3A%2F%2Fapi&prompt=none&connection=evil",
      ),
    ).toBe("/auth/login");
    expect(cleaned("/auth/login?returnTo=%2Fprogress&scope=email")).toBe(
      "/auth/login?returnTo=%2Fprogress",
    );
  });

  it("cleans the trailing-slash spellings the SDK also answers", () => {
    expect(cleaned("/auth/login/?scope=openid%20offline_access&prompt=none")).toBe("/auth/login");
    expect(cleaned("/auth/login/?returnTo=%2Fprogress&audience=x")).toBe(
      "/auth/login?returnTo=%2Fprogress",
    );
    expect(cleaned("/auth/logout/?returnTo=https%3A%2F%2Fevil.example")).toBe("/auth/logout");
    expect(cleaned("/auth/login/")).toBeNull(); // nothing to drop
  });

  it("never keeps a returnTo that leaves the site", () => {
    expect(cleaned("/auth/login?returnTo=https%3A%2F%2Fevil.example")).toBe("/auth/login");
    expect(cleaned("/auth/login?returnTo=%2F%2Fevil.example")).toBe("/auth/login");
    expect(cleaned("/auth/login?returnTo=%2F%5Cevil.example")).toBe("/auth/login");
    expect(cleaned("/auth/logout?returnTo=https%3A%2F%2Fevil.example&federated")).toBe(
      "/auth/logout",
    );
  });
});

describe("proxy", () => {
  const visit = async (path: string) => {
    const { proxy } = await import("@/proxy");
    return proxy(new NextRequest(new URL(path, "http://localhost:3100")));
  };

  it("redirects a doctored sign-in or sign-out link to the clean one before the SDK sees it", async () => {
    const login = await visit(
      "/auth/login?scope=openid%20email%20offline_access&returnTo=%2Fcircles",
    );
    expect(login.status).toBe(307);
    expect(login.headers.get("location")).toBe(
      "http://localhost:3100/auth/login?returnTo=%2Fcircles",
    );
    const logout = await visit("/auth/logout?returnTo=https%3A%2F%2Fevil.example");
    expect(logout.headers.get("location")).toBe("http://localhost:3100/auth/logout");
  });

  it("still says sign-in isn't set up when the keys are missing", async () => {
    delete process.env.AUTH0_CLIENT_SECRET;
    const res = await visit("/auth/login?scope=email");
    expect(res.status).toBe(503);
  });
});

describe("account linking on a shared computer (Student A, then Student B)", () => {
  /** A learners table that applies the guarded link the way Postgres would. */
  function learnersTable() {
    const rows = new Map<
      string,
      { sub: string | null; name: string; demo: boolean; email?: string | null }
    >();
    const tag = (strings: TemplateStringsArray, ...v: unknown[]) => {
      const text = strings.join("$").replace(/\s+/g, " ").trim();
      const out = (r: unknown[]) => Promise.resolve(r);
      const row = (id: string) => ({
        user_id: id,
        display_name: rows.get(id)!.name,
        email_hash: rows.get(id)!.email ?? null,
      });
      if (
        text.startsWith("SELECT user_id, display_name, email_hash FROM learners WHERE auth0_sub =")
      )
        return out([...rows].filter(([, r]) => r.sub === v[0]).map(([id]) => row(id)));
      // The email hash is unique: the latest verified sign-in takes it from anyone else.
      if (text.startsWith("UPDATE learners SET email_hash = NULL WHERE email_hash =")) {
        for (const [id, r] of rows) if (r.email === v[0] && id !== v[1]) r.email = null;
        return out([]);
      }
      if (text.startsWith("UPDATE learners SET email_hash =")) {
        const [hash, id] = v as [string | null, string];
        if (hash && [...rows].some(([other, r]) => other !== id && r.email === hash))
          return Promise.reject(Object.assign(new Error("duplicate key"), { code: "23505" }));
        rows.get(id)!.email = hash;
        return out([]);
      }
      if (text.startsWith("UPDATE learners SET auth0_sub")) {
        const [sub, , , id] = v as string[];
        const r = rows.get(id!);
        if (!r || r.sub !== null || r.demo) return out([]); // WHERE auth0_sub IS NULL AND NOT is_demo
        r.sub = sub!;
        return out([row(id!)]);
      }
      if (text.startsWith("INSERT INTO learners (user_id, display_name, auth0_sub)")) {
        const [id, name, sub] = v as string[];
        rows.set(id!, { sub: sub!, name: name!, demo: false });
        return out([row(id!)]);
      }
      if (text.startsWith("SELECT auth0_sub IS NOT NULL AS linked")) {
        const r = rows.get(v[0] as string);
        return out(r ? [{ linked: r.sub !== null, display_name: r.name }] : []);
      }
      if (text.startsWith("INSERT INTO learners (user_id, display_name) VALUES")) {
        rows.set(v[0] as string, { sub: null, name: String(v[1]), demo: false });
        return out([]);
      }
      return out([]);
    };
    dbBox.sql = tag as unknown as postgres.Sql;
    return { sql: tag as unknown as postgres.Sql, rows };
  }

  const as = async (sub: string, email: Record<string, unknown> = {}) =>
    `__session=${await generateSessionCookie({ user: { sub, given_name: sub.slice(6), ...email } }, { secret: ENV.AUTH0_SECRET })}`;
  const req = (...cookies: string[]) =>
    new Request("http://localhost:3100/api/me/library", {
      headers: { cookie: cookies.join("; ") },
    });

  it("B never gets A's learner, whether or not A signed out, and the cookie alone gets nothing", async () => {
    const identity = await import("@/lib/learning/server/identity");
    const { currentUser, requireUser } = await import("./currentUser");
    const db = learnersTable();
    // A studies anonymously on the lab computer, then signs in: that learner becomes A's.
    const anon = await identity.anonymousLearner(db.sql, req(), true);
    const browser = anon!.setCookie!.split(";")[0]!;
    const a = (await requireUser(req(browser, await as("auth0|alice")))) as { learnerId: string };
    expect(a.learnerId).toBe(anon!.id);
    // A signs out. The browser still has the old learner cookie: alone, it reaches nothing of A's.
    const signedOut = await currentUser(req(browser));
    expect(signedOut.learnerId).toBeNull();
    // B signs in on the same browser for the first time: a fresh learner, never A's.
    const b = (await requireUser(req(browser, await as("auth0|bobby")))) as { learnerId: string };
    expect(b.learnerId).not.toBe(a.learnerId);
    expect(db.rows.get(a.learnerId)!.sub).toBe("auth0|alice");
    // And A signing in again still gets A's own learner (nothing was merged either way).
    const again = (await requireUser(req(browser, await as("auth0|alice")))) as {
      learnerId: string;
    };
    expect(again.learnerId).toBe(a.learnerId);
  });

  it("an account that already has a learner never adopts (merges) the browser's anonymous one", async () => {
    const identity = await import("@/lib/learning/server/identity");
    const { requireUser } = await import("./currentUser");
    const db = learnersTable();
    const first = await identity.anonymousLearner(db.sql, req(), true);
    const alice = (await requireUser(
      req(first!.setCookie!.split(";")[0]!, await as("auth0|alice")),
    )) as { learnerId: string };
    // Later, on another browser with someone else's anonymous progress, Alice signs in.
    const other = await identity.anonymousLearner(db.sql, req(), true);
    const there = (await requireUser(
      req(other!.setCookie!.split(";")[0]!, await as("auth0|alice")),
    )) as { learnerId: string };
    expect(there.learnerId).toBe(alice.learnerId);
    expect(db.rows.get(other!.id)!.sub).toBeNull(); // left alone, still anonymous
  });

  it("keeps only a keyed hash of a verified email, and drops it when the email isn't verified", async () => {
    const { hashEmail } = await import("./emailHash");
    const { currentUser } = await import("./currentUser");
    const db = learnersTable();
    const address = "Alice.Smith@Example.com";
    const verified = { email: address, email_verified: true };
    const me = await currentUser(req(await as("auth0|alice", verified)));
    const hash = hashEmail(address)!;
    expect(me.emailHash).toBe(hash);
    expect(db.rows.get(me.learnerId!)!.email).toBe(hash);
    // Nothing that reached the database carries the address, in any case.
    const stored = JSON.stringify([...db.rows.values()]);
    expect(stored.toLowerCase()).not.toContain("alice.smith");
    // Unverified (or a string "true", or no email claim at all): no hash, and the old one goes.
    for (const claims of [
      { email: address, email_verified: false },
      { email: address, email_verified: "true" },
      { email: address },
      {},
    ]) {
      const again = await currentUser(req(await as("auth0|alice", verified)));
      expect(again.emailHash).toBe(hash);
      const unverified = await currentUser(req(await as("auth0|alice", claims)));
      expect(unverified.emailHash).toBeNull();
      expect(db.rows.get(me.learnerId!)!.email).toBeNull();
    }
  });

  it("gives a verified address to the latest account that signed in with it", async () => {
    const { hashEmail } = await import("./emailHash");
    const { currentUser } = await import("./currentUser");
    const db = learnersTable();
    const verified = { email: "shared@example.com", email_verified: true };
    const a = await currentUser(req(await as("auth0|alice", verified)));
    const b = await currentUser(req(await as("auth0|bobby", verified)));
    expect(b.emailHash).toBe(hashEmail("shared@example.com"));
    expect(db.rows.get(b.learnerId!)!.email).toBe(b.emailHash);
    expect(db.rows.get(a.learnerId!)!.email).toBeNull();
  });
});
