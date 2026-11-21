import { learnerKey, newTicketId, signTicket } from "@ovr/shared";
import { describe, expect, it } from "vitest";
import type { GameServerConfig } from "./config";
import {
  PROOF_PER_CLIENT,
  WindowLimiter,
  clientAddress,
  createProofLimits,
  proofTicket,
} from "./proof";
import { TicketLedger } from "./rooms/rules";
import { admitTicket } from "./tickets";

const SECRET = "test-only-proof-secret";
const CONFIG: GameServerConfig = {
  ticketSecret: SECRET,
  allowedOrigins: new Set(["http://localhost:3100"]),
  webInternalUrl: null,
};

async function ticket(expIn = 120) {
  const key = await learnerKey(SECRET, `learner-${Math.random()}`);
  const exp = Math.floor(Date.now() / 1000) + expIn;
  return signTicket(SECRET, { key, name: "Ada", signedIn: false, exp, jti: newTicketId() });
}

describe("admitTicket", () => {
  it("lets a valid ticket in once, then calls it a replay", async () => {
    const ledger = new TicketLedger();
    const t = await ticket();
    expect(await admitTicket(SECRET, t, ledger)).toMatchObject({ ok: true });
    expect(await admitTicket(SECRET, t, ledger)).toEqual({ ok: false, reason: "ticket_replayed" });
  });

  it("names why a ticket is refused, without claiming it", async () => {
    const ledger = new TicketLedger();
    expect(await admitTicket(SECRET, await ticket(-5), ledger)).toEqual({
      ok: false,
      reason: "ticket_expired",
    });
    expect(await admitTicket(undefined, await ticket(), ledger)).toEqual({
      ok: false,
      reason: "ticket_missing_secret",
    });
    expect(await admitTicket(SECRET, "nonsense", ledger)).toMatchObject({ ok: false });
    expect(ledger.size).toBe(0);
  });
});

describe("WindowLimiter", () => {
  it("allows `limit` per window per key, then frees up as the window slides", () => {
    const l = new WindowLimiter(2, 1000);
    expect([l.take("a", 0), l.take("a", 10), l.take("a", 20)]).toEqual([true, true, false]);
    expect(l.take("b", 20)).toBe(true);
    expect(l.take("a", 1005)).toBe(true);
  });

  it("forgets quiet keys before refusing a new one when full", () => {
    const l = new WindowLimiter(1, 1000, 2);
    expect(l.take("a", 0) && l.take("b", 0)).toBe(true);
    expect(l.take("c", 10)).toBe(false); // both still in their window
    expect(l.take("c", 2000)).toBe(true); // a and b have gone quiet
  });
});

describe("proofTicket", () => {
  const headers = (h: Record<string, string> = {}) =>
    new Headers({ origin: "http://localhost:3100", ...h });

  it("answers accepted, then refused, for the same ticket", async () => {
    const limits = createProofLimits();
    const t = await ticket();
    expect(await proofTicket({ ticket: t }, headers(), CONFIG, limits)).toEqual({
      status: 200,
      body: { accepted: true },
    });
    expect(await proofTicket({ ticket: t }, headers(), CONFIG, limits)).toEqual({
      status: 200,
      body: { accepted: false, reason: "ticket_replayed" },
    });
  });

  it("checks the origin first and the body before the ticket", async () => {
    const limits = createProofLimits();
    const evil = headers({ origin: "https://evil.example" });
    expect((await proofTicket({ ticket: "x" }, evil, CONFIG, limits)).status).toBe(403);
    expect((await proofTicket(null, headers(), CONFIG, limits)).status).toBe(400);
    expect(
      (await proofTicket({ ticket: "x".repeat(2000) }, headers(), CONFIG, limits)).status,
    ).toBe(400);
    // No Origin header: not a browser, on to the ticket check (as for joining).
    expect((await proofTicket({ ticket: "x" }, new Headers(), CONFIG, limits)).status).toBe(200);
  });

  it("limits each address, keyed by the proxy's first hop", async () => {
    const limits = createProofLimits();
    const from = headers({ "x-forwarded-for": "203.0.113.9, 10.0.0.2" });
    expect(clientAddress(from)).toBe("203.0.113.9");
    expect(clientAddress(new Headers())).toBe("direct");
    for (let i = 0; i < PROOF_PER_CLIENT; i++)
      expect((await proofTicket({}, from, CONFIG, limits, 1000)).status).toBe(400);
    expect((await proofTicket({}, from, CONFIG, limits, 1000)).status).toBe(429);
    expect((await proofTicket({}, from, CONFIG, limits, 62_000)).status).toBe(400);
  });
});
