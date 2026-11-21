import { NET, verifyTicket } from "@ovr/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CurrentUser } from "./currentUser";
import { firstNameOf, guestName, issueTicket } from "./gameTicket";

/**
 * Join tickets: what the web app signs is what the game server accepts (both use
 * packages/shared/src/net/ticket.ts, whose fixed vectors live in ticket.test.ts), names are first
 * names or stable guest names, and no learner id, email or Auth0 sub is put in a ticket.
 */

const SECRET = "test-only-ticket-secret";
const LEARNER = "0a000000-0000-4000-8000-0000000000aa";
const NOW = 1_800_000_000_000;

const signedIn = (displayName: string | null): CurrentUser => ({
  learnerId: LEARNER,
  signedIn: true,
  authSub: "google-oauth2|1234567890",
  displayName,
});
const guest = (learnerId: string | null): CurrentUser => ({
  learnerId,
  signedIn: false,
  authSub: null,
  displayName: learnerId ? "Reader 0a00" : null,
});

async function claimsOf(ticket: string) {
  const check = await verifyTicket(SECRET, ticket, NOW);
  if (!check.ok) throw new Error(check.reason);
  return check.claims;
}

describe("issueTicket", () => {
  it("signs a ticket the game server accepts, for about five minutes", async () => {
    const out = await issueTicket(SECRET, signedIn("Ada Lovelace"), NOW);
    expect(out).toMatchObject({ name: "Ada", signedIn: true });
    const claims = await claimsOf(out.ticket);
    expect(claims).toMatchObject({ name: "Ada", signedIn: true });
    expect(claims.exp).toBe(NOW / 1000 + NET.TICKET_TTL_S);
    expect(out.expiresAt).toBe(new Date(claims.exp * 1000).toISOString());
    expect((await verifyTicket(SECRET, out.ticket, (claims.exp + 1) * 1000)).ok).toBe(false);
    expect((await verifyTicket("another-secret", out.ticket, NOW)).ok).toBe(false);
  });

  it("keeps the learner id, email and Auth0 sub out of the ticket", async () => {
    const me = { ...signedIn("ada@example.com"), authSub: "auth0|ada" };
    const out = await issueTicket(SECRET, me, NOW);
    const decoded = Buffer.from(out.ticket.split(".")[0]!, "base64url").toString("utf8");
    for (const secretBit of [LEARNER, "ada@example.com", "auth0|ada", LEARNER.slice(0, 8)])
      expect(decoded).not.toContain(secretBit);
    expect(out.name).toBe("Reader");
  });

  it("gives one learner the same key (two tabs are one person) and others different ones", async () => {
    const a = await claimsOf((await issueTicket(SECRET, signedIn("Ada"), NOW)).ticket);
    const b = await claimsOf((await issueTicket(SECRET, guest(LEARNER), NOW)).ticket);
    const c = await claimsOf(
      (await issueTicket(SECRET, guest("11111111-1111-4111-8111-111111111111"), NOW)).ticket,
    );
    expect(a.key).toBe(b.key);
    expect(c.key).not.toBe(a.key);
  });

  it("names guests 'Guest NNNN', the same every time for the same learner", async () => {
    const one = await issueTicket(SECRET, guest(LEARNER), NOW);
    const again = await issueTicket(SECRET, guest(LEARNER), NOW + 60_000);
    expect(one.name).toMatch(/^Guest [1-9]\d{3}$/);
    expect(again.name).toBe(one.name);
    expect(one.signedIn).toBe(false);
  });

  it("still lets a visitor without a learner in, under a one-off key", async () => {
    const a = await claimsOf((await issueTicket(SECRET, guest(null), NOW)).ticket);
    const b = await claimsOf((await issueTicket(SECRET, guest(null), NOW)).ticket);
    expect(a.key).not.toBe(b.key);
    expect(a.name).toMatch(/^Guest \d{4}$/);
  });

  it("makes every ticket distinct, even two for one learner in the same instant", async () => {
    const a = await issueTicket(SECRET, signedIn("Ada"), NOW);
    const b = await issueTicket(SECRET, signedIn("Ada"), NOW);
    expect(a.ticket).not.toBe(b.ticket);
    const [ca, cb] = [await claimsOf(a.ticket), await claimsOf(b.ticket)];
    expect(ca.jti).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(ca.jti).not.toBe(cb.jti);
  });

  it("uses the Auth0 account as the key when there's no database", async () => {
    const me = { ...signedIn("Ada"), learnerId: null };
    const a = await claimsOf((await issueTicket(SECRET, me, NOW)).ticket);
    const b = await claimsOf((await issueTicket(SECRET, me, NOW)).ticket);
    expect(a.key).toBe(b.key);
  });
});

describe("names", () => {
  it("shows first names only, never an email, at most 32 characters", () => {
    expect(firstNameOf("Ada Lovelace")).toBe("Ada");
    expect(firstNameOf("  Grace\tHopper ")).toBe("Grace");
    expect(firstNameOf("ada@example.com")).toBe("Reader");
    expect(firstNameOf(null)).toBe("Reader");
    expect(firstNameOf("Reader 1a2b")).toBe("Reader");
    expect(firstNameOf("x".repeat(40))).toHaveLength(32);
    expect(firstNameOf("\u0007Bell")).toBe("Bell");
    // Bidi overrides and zero-width characters can't disguise a name.
    expect(firstNameOf("\u202eAda\u200b Lovelace")).toBe("Ada");
    expect(firstNameOf("\u2066\u200d")).toBe("Reader");
    expect(firstNameOf("😀".repeat(20)).length).toBeLessThanOrEqual(32);
  });

  it("numbers guests from 1000 to 9999", () => {
    for (const key of [
      "AAAAAAAAAAAAAAAAAAAAAA",
      "______________________",
      "bc-MCNpTg_xD0dnh_wd_U_",
    ])
      expect(guestName(key)).toMatch(/^Guest [1-9]\d{3}$/);
  });
});

/* ---- The route ---- */

const userBox = vi.hoisted(() => ({
  me: null as CurrentUser | null,
  created: null as CurrentUser | null,
}));
vi.mock("./currentUser", () => ({
  currentUser: async (_request: Request, opts?: { create?: boolean }) =>
    opts?.create && userBox.created ? userBox.created : userBox.me,
}));

describe("GET /api/net/ticket", () => {
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.GAME_TICKET_SECRET;
    process.env.GAME_TICKET_SECRET = SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.GAME_TICKET_SECRET;
    else process.env.GAME_TICKET_SECRET = saved;
    userBox.me = null;
    userBox.created = null;
  });
  const get = async (headers: Record<string, string> = {}) => {
    const { GET } = await import("@/app/api/net/ticket/route");
    return GET(new Request("http://localhost:3100/api/net/ticket", { headers }));
  };

  it("answers with a ticket, never cached", async () => {
    userBox.me = signedIn("Ada Lovelace");
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "name", "signedIn", "ticket"]);
    expect(body).toMatchObject({ name: "Ada", signedIn: true });
    expect((await verifyTicket(SECRET, body.ticket)).ok).toBe(true);
  });

  it("makes a first-time visitor a learner (and sets their cookie)", async () => {
    userBox.me = guest(null);
    userBox.created = { ...guest(LEARNER), setCookie: "ovr_learner=abc; Path=/" };
    const res = await get({ "x-forwarded-for": "203.0.113.9" });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("ovr_learner=");
    const body = (await res.json()) as { name: string; signedIn: boolean };
    expect(body.signedIn).toBe(false);
    expect(body.name).toBe((await issueTicket(SECRET, guest(LEARNER))).name);
  });

  it("says multiplayer isn't configured without GAME_TICKET_SECRET", async () => {
    delete process.env.GAME_TICKET_SECRET;
    userBox.me = signedIn("Ada");
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: { code: "multiplayer_not_configured" } });
  });

  it("refuses other sites", async () => {
    userBox.me = signedIn("Ada");
    const res = await get({ "sec-fetch-site": "cross-site", origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});
