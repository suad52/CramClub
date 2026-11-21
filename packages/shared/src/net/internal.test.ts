import { describe, expect, it } from "vitest";
import {
  type FenwickChatRequest,
  INTERNAL_MAX_SKEW_MS,
  signInternal,
  verifyInternal,
} from "./internal";

/**
 * A fixed vector, cross-checked against node:crypto's
 * createHmac("sha256", SECRET).update(`ovr-internal.v1.${TS}.${BODY}`).digest("base64url"): the
 * game server signs and the web app verifies with this one module, and this pins its output.
 */
const SECRET = "test-vector-secret-not-a-real-one";
const TS = 1_900_000_000_000;
const REQUEST: FenwickChatRequest = {
  askerName: "Ada",
  lines: [{ name: "Ada", text: "hi", fenwick: false, asker: true }],
  alone: true,
};
const BODY = JSON.stringify(REQUEST);
const SIGNATURE = "uvy-nItaRLQW_PHXmLK-QegW6hSbWzuu1C6vyCA3qpI";

describe("internal requests", () => {
  it("signs the same way every time", async () => {
    expect(await signInternal(SECRET, TS, BODY)).toBe(SIGNATURE);
  });

  it("accepts a good request within the clock skew", async () => {
    expect(await verifyInternal(SECRET, SIGNATURE, String(TS), BODY, TS)).toEqual({ ok: true });
    for (const now of [TS + INTERNAL_MAX_SKEW_MS, TS - INTERNAL_MAX_SKEW_MS])
      expect(await verifyInternal(SECRET, SIGNATURE, String(TS), BODY, now)).toEqual({ ok: true });
  });

  it("refuses a tampered body, timestamp or signature, and another secret", async () => {
    const bad = { ok: false, reason: "bad_signature" };
    const altered = JSON.stringify({ ...REQUEST, askerName: "Mallory" });
    expect(await verifyInternal(SECRET, SIGNATURE, String(TS), altered, TS)).toEqual(bad);
    expect(await verifyInternal(SECRET, SIGNATURE, String(TS + 1), BODY, TS)).toEqual(bad);
    const flipped = (SIGNATURE[0] === "A" ? "B" : "A") + SIGNATURE.slice(1);
    expect(await verifyInternal(SECRET, flipped, String(TS), BODY, TS)).toEqual(bad);
    expect(await verifyInternal(SECRET, SIGNATURE.slice(0, -1), String(TS), BODY, TS)).toEqual(bad);
    expect(await verifyInternal("another-secret", SIGNATURE, String(TS), BODY, TS)).toEqual(bad);
  });

  it("refuses a stale (or far-future) request, even one signed correctly", async () => {
    const stale = { ok: false, reason: "stale" };
    expect(
      await verifyInternal(SECRET, SIGNATURE, String(TS), BODY, TS + INTERNAL_MAX_SKEW_MS + 1),
    ).toEqual(stale);
    expect(
      await verifyInternal(SECRET, SIGNATURE, String(TS), BODY, TS - INTERNAL_MAX_SKEW_MS - 1),
    ).toEqual(stale);
  });

  it("refuses everything without a secret, and missing or junk headers", async () => {
    for (const secret of [undefined, ""])
      expect(await verifyInternal(secret, SIGNATURE, String(TS), BODY, TS)).toEqual({
        ok: false,
        reason: "missing_secret",
      });
    for (const [signature, timestamp] of [
      [null, String(TS)],
      [SIGNATURE, null],
      [undefined, undefined],
      ["", String(TS)],
      [SIGNATURE, "12a"],
      [SIGNATURE, "-5"],
      [SIGNATURE, "1.5"],
      [SIGNATURE, "1".repeat(17)],
    ] as const)
      expect(await verifyInternal(SECRET, signature, timestamp, BODY, TS)).toEqual({
        ok: false,
        reason: "missing_headers",
      });
  });
});
