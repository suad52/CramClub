import { describe, expect, it } from "vitest";
import { NET } from "./protocol";
import {
  constantTimeEqual,
  fromBase64Url,
  learnerKey,
  newTicketId,
  parseTicketClaims,
  signTicket,
  toBase64Url,
  verifyTicket,
} from "./ticket";

/**
 * Fixed vectors, cross-checked against node:crypto's createHmac(...).digest("base64url"): the web
 * app signs and the game server verifies with this one module, and these pin its output so a
 * change to the format can't slip by one side unnoticed.
 */
const SECRET = "test-vector-secret-not-a-real-one";
const LEARNER = "3f1c2a4e-1111-4222-8333-944455556666";
const KEY = "bc-MCNpTg_xD0dnh_wd_U_";
const EXP = 1_900_000_000;
const TICKET =
  "eyJrZXkiOiJiYy1NQ05wVGdfeEQwZG5oX3dkX1VfIiwibmFtZSI6IkFkYSIsInNpZ25lZEluIjp0cnVlLCJleHAiOjE5MDAwMDAwMDB9" +
  ".FVEW64gNBl1bUzQ2_bddQnxr6R7AEi2wojOmOeLV2Zw";
const BEFORE_EXP = (EXP - 60) * 1000;

describe("join tickets", () => {
  it("derives the learner key and signs the ticket the same way every time", async () => {
    expect(await learnerKey(SECRET, LEARNER)).toBe(KEY);
    expect(await signTicket(SECRET, { key: KEY, name: "Ada", signedIn: true, exp: EXP })).toBe(
      TICKET,
    );
  });

  it("accepts a good ticket and returns its claims", async () => {
    expect(await verifyTicket(SECRET, TICKET, BEFORE_EXP)).toEqual({
      ok: true,
      claims: { key: KEY, name: "Ada", signedIn: true, exp: EXP },
    });
  });

  it("refuses an expired ticket", async () => {
    expect(await verifyTicket(SECRET, TICKET, EXP * 1000)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("refuses a ticket that expires further ahead than a fresh one could", async () => {
    const far = await signTicket(SECRET, { key: KEY, name: "Ada", signedIn: true, exp: EXP });
    const now = (EXP - NET.TICKET_TTL_S - 3600) * 1000;
    expect(await verifyTicket(SECRET, far, now)).toEqual({ ok: false, reason: "invalid_claims" });
  });

  it("refuses a tampered payload, a tampered signature and another secret", async () => {
    const [payload, signature] = TICKET.split(".") as [string, string];
    const mallory = await signTicket("any", {
      key: KEY,
      name: "Mallory",
      signedIn: true,
      exp: EXP,
    });
    const renamed = mallory.split(".")[0];
    expect(await verifyTicket(SECRET, `${renamed}.${signature}`, BEFORE_EXP)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    const flipped = (signature[0] === "A" ? "B" : "A") + signature.slice(1);
    expect(await verifyTicket(SECRET, `${payload}.${flipped}`, BEFORE_EXP)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(await verifyTicket("another-secret", TICKET, BEFORE_EXP)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("refuses everything when the secret is missing", async () => {
    expect(await verifyTicket(undefined, TICKET, BEFORE_EXP)).toEqual({
      ok: false,
      reason: "missing_secret",
    });
    expect(await verifyTicket("", TICKET, BEFORE_EXP)).toEqual({
      ok: false,
      reason: "missing_secret",
    });
    await expect(
      signTicket("", { key: KEY, name: "Ada", signedIn: true, exp: EXP }),
    ).rejects.toThrow();
  });

  it("refuses junk", async () => {
    for (const junk of [undefined, 42, "", "abc", "a.b.c", `${TICKET}.x`, "x".repeat(5000)])
      expect((await verifyTicket(SECRET, junk, BEFORE_EXP)).ok).toBe(false);
  });

  it("only signs well-formed claims", async () => {
    expect(parseTicketClaims({ key: KEY, name: "  Ada ", signedIn: false, exp: EXP })).toEqual({
      key: KEY,
      name: "Ada",
      signedIn: false,
      exp: EXP,
    });
    for (const bad of [
      { key: "short", name: "Ada", signedIn: true, exp: EXP },
      { key: KEY, name: "", signedIn: true, exp: EXP },
      { key: KEY, name: "x".repeat(33), signedIn: true, exp: EXP },
      { key: KEY, name: "Ada\nBob", signedIn: true, exp: EXP },
      { key: KEY, name: "Ada", signedIn: "yes", exp: EXP },
      { key: KEY, name: "Ada", signedIn: true, exp: 1.5 },
      // Invisible or direction-flipping characters could disguise a name.
      { key: KEY, name: "\u202eAda", signedIn: true, exp: EXP },
      { key: KEY, name: "Ada\u200b", signedIn: true, exp: EXP },
      { key: KEY, name: "Guest\u2066 1234", signedIn: true, exp: EXP },
      { key: KEY, name: "Ada", signedIn: true, exp: EXP, jti: "short" },
      { key: KEY, name: "Ada", signedIn: true, exp: EXP, jti: 42 },
    ]) {
      expect(parseTicketClaims(bad)).toBeNull();
      await expect(signTicket(SECRET, bad as never)).rejects.toThrow();
    }
  });

  it("carries a ticket id when there is one, so equal claims still make distinct tickets", async () => {
    const a = newTicketId();
    const b = newTicketId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(a).not.toBe(b);
    const one = await signTicket(SECRET, {
      key: KEY,
      name: "Ada",
      signedIn: true,
      exp: EXP,
      jti: a,
    });
    const two = await signTicket(SECRET, {
      key: KEY,
      name: "Ada",
      signedIn: true,
      exp: EXP,
      jti: b,
    });
    expect(one).not.toBe(two);
    expect(await verifyTicket(SECRET, one, BEFORE_EXP)).toEqual({
      ok: true,
      claims: { key: KEY, name: "Ada", signedIn: true, exp: EXP, jti: a },
    });
  });

  it("round-trips base64url and compares strings fully", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 31, 32, 33]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
    }
    expect(fromBase64Url("a+b/")).toBeNull();
    expect(fromBase64Url("abcde")).toBeNull();
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });
});
