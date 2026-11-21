import { describe, expect, it, vi } from "vitest";
import { ttlCache } from "./cache";
import { formatBytes, formatDuration, formatInterval } from "./format";
import { type CheckRows, buildIntegrity, integrityDays, summariseCheck } from "./integrity";
import { runReplayTest } from "./replay";
import { describeSignedUrl, gameHttpUrl, unsignedUrl } from "./urls";

const WEEK = [
  "2026-11-15",
  "2026-11-16",
  "2026-11-17",
  "2026-11-18",
  "2026-11-19",
  "2026-11-20",
  "2026-11-21",
];

const check = (
  days: CheckRows["days"],
  learners = 6,
  id: CheckRows["id"] = "daily",
): CheckRows => ({
  id,
  label: "raw vs aggregate",
  sides: { raw: "Raw events", aggregate: "learning_daily" },
  days,
  learners,
});

const day = (d: string, raw: Record<string, number>, agg = raw, groups = 2, drifted = 0) => ({
  day: d,
  groups,
  drifted,
  raw,
  aggregate: agg,
});

describe("integrity check", () => {
  it("passes when every group matches, adding the window's totals up", () => {
    const c = summariseCheck(
      check([day(WEEK[0]!, { xp: 230, focus: 9000 }), day(WEEK[1]!, { xp: 255, focus: 18000 })]),
      3,
    );
    expect(c).toMatchObject({
      ok: true,
      groups: 4,
      drifted: 0,
      raw: { xp: 485, focus: 27000 },
      aggregate: { xp: 485, focus: 27000 },
    });
  });

  it("reports drift by group, and when totals disagree", () => {
    const drift = summariseCheck(check([day(WEEK[2]!, { xp: 100 }, { xp: 90 }, 3, 1)]), 3);
    expect(drift).toMatchObject({ ok: false, drifted: 1, raw: { xp: 100 }, aggregate: { xp: 90 } });
    // Even with no group flagged, different totals aren't "ok".
    expect(summariseCheck(check([day(WEEK[2]!, { xp: 1 }, { xp: 2 }, 1, 0)]), 3).ok).toBe(false);
  });

  it("hides the totals, never the verdict, when too few learners are in the window", () => {
    const c = summariseCheck(check([day(WEEK[0]!, { xp: 40 })], 2), 3);
    expect(c.raw).toBeNull();
    expect(c.aggregate).toBeNull();
    expect(c.ok).toBe(true);
  });

  it("zero-fills the window and adds the checks up per day", () => {
    const days = integrityDays(WEEK, [
      check([day(WEEK[1]!, { xp: 1 }, { xp: 1 }, 2, 0)]),
      check([day(WEEK[1]!, { xp: 1 }, { xp: 0 }, 1, 1), day("2026-11-01", { xp: 5 })], 6, "ledger"),
    ]);
    expect(days.map((d) => d.day)).toEqual(WEEK);
    expect(days[0]).toEqual({ day: WEEK[0], groups: 0, drifted: 0 });
    expect(days[1]).toEqual({ day: WEEK[1], groups: 3, drifted: 1 });
  });

  it("builds the report: window bounds, every check, one verdict", () => {
    const report = buildIntegrity(
      WEEK,
      [
        check([day(WEEK[6]!, { xp: 10 })]),
        check(
          [day(WEEK[6]!, { xp: 10 }), day("2026-10-01", { xp: 9 }, { xp: 1 }, 1, 1)],
          6,
          "ledger",
        ),
      ],
      { minGroup: 3, queryMs: 12, nextRefreshAt: "2026-11-21T18:44:00.000Z" },
    );
    expect(report).toMatchObject({ from: WEEK[0], to: WEEK[6], ok: true, queryMs: 12 });
    // A row from outside the window (a clock edge) is left out rather than counted as drift.
    expect(report.checks[1]).toMatchObject({ groups: 2, drifted: 0, raw: { xp: 10 } });
    expect(report.days).toHaveLength(7);
  });
});

describe("game server URL", () => {
  it("turns the WebSocket address into the HTTP one, keeping Caddy's /game prefix", () => {
    expect(gameHttpUrl("wss://203-0-113-7.sslip.io/game", "/proof/ticket")).toBe(
      "https://203-0-113-7.sslip.io/game/proof/ticket",
    );
    expect(gameHttpUrl("wss://cram.example/game/", "health")).toBe(
      "https://cram.example/game/health",
    );
    expect(gameHttpUrl("ws://localhost:2567", "/proof/ticket")).toBe(
      "http://localhost:2567/proof/ticket",
    );
  });

  it("is null when multiplayer isn't configured or the address is odd", () => {
    expect(gameHttpUrl(undefined, "/health")).toBeNull();
    expect(gameHttpUrl("  ", "/health")).toBeNull();
    expect(gameHttpUrl("not a url", "/health")).toBeNull();
    expect(gameHttpUrl("ftp://x.example", "/health")).toBeNull();
  });
});

describe("signed URL facts", () => {
  const signed =
    "https://ewr1.vultrobjects.com/my-bucket/lessons/0f6c/scene-0.mp3?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
    "&X-Amz-Credential=AKIAEXAMPLE%2F20261121%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20261121T183000Z" +
    "&X-Amz-Expires=60&X-Amz-Signature=deadbeef&X-Amz-SignedHeaders=host";

  it("keeps what the URL says about itself, and nothing reusable", () => {
    const facts = describeSignedUrl(signed);
    expect(facts).toEqual({
      host: "ewr1.vultrobjects.com",
      algorithm: "AWS4-HMAC-SHA256",
      expiresInSeconds: 60,
      signedAt: "2026-11-21T18:30:00.000Z",
    });
    const text = JSON.stringify(facts);
    for (const secretish of ["AKIA", "deadbeef", "my-bucket", "scene-0", "lessons/"])
      expect(text).not.toContain(secretish);
  });

  it("knows the same object without its signature, and refuses non-presigned URLs", () => {
    expect(unsignedUrl(signed)).toBe(
      "https://ewr1.vultrobjects.com/my-bucket/lessons/0f6c/scene-0.mp3",
    );
    expect(describeSignedUrl("https://ewr1.vultrobjects.com/b/k")).toBeNull();
    expect(describeSignedUrl("nope")).toBeNull();
  });
});

describe("ttlCache", () => {
  it("loads once per time-to-live, sharing a load in progress", async () => {
    let t = 0;
    const load = vi.fn(async () => t);
    const get = ttlCache(10_000, load, () => t);
    const [a, b] = await Promise.all([get(), get()]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(a.value).toBe(0);
    expect(b.value).toBe(0);
    t = 9_999;
    expect(await get()).toEqual({ value: 0, ageMs: 9_999 });
    t = 10_000;
    expect((await get()).value).toBe(10_000);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("doesn't keep a failure", async () => {
    let fail = true;
    const get = ttlCache(10_000, async () => {
      if (fail) throw new Error("db down");
      return "ok";
    });
    await expect(get()).rejects.toThrow("db down");
    fail = false;
    expect((await get()).value).toBe("ok");
  });
});

describe("proof formatting", () => {
  it("reads Postgres intervals as words", () => {
    expect(formatInterval("00:10:00")).toBe("10 minutes");
    expect(formatInterval("01:00:00")).toBe("1 hour");
    expect(formatInterval("12:00:00")).toBe("12 hours");
    expect(formatInterval("40 days")).toBe("40 days");
    expect(formatInterval("84 days")).toBe("12 weeks");
    expect(formatInterval("7 days")).toBe("1 week");
    expect(formatInterval("1 day 02:00:00")).toBe("1 day 2 hours");
    expect(formatInterval("1 mon")).toBe("1 mon");
    expect(formatInterval(null)).toBeNull();
  });

  it("sizes and durations", () => {
    expect(formatBytes(81920)).toBe("80 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatDuration(263)).toBe("4 min 23 s");
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(7500)).toBe("2 h 5 min");
  });
});

describe("ticket replay test", () => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  /** A web app that issues one ticket and a game server with a one-use ledger. */
  function fakeNetwork() {
    const used = new Set<string>();
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchFn = async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "/api/net/ticket")
        return json({ ticket: "t.sig", expiresAt: "2026-11-21T19:00:00.000Z", signedIn: true });
      const { ticket } = JSON.parse(String(init?.body)) as { ticket: string };
      if (used.has(ticket)) return json({ accepted: false, reason: "ticket_replayed" });
      used.add(ticket);
      return json({ accepted: true });
    };
    return { fetchFn, calls };
  }

  it("passes when the first use is accepted and the second refused as a replay", async () => {
    const { fetchFn, calls } = fakeNetwork();
    const url = "https://cram.example/game/proof/ticket";
    const result = await runReplayTest(fetchFn, url);
    expect(result).toEqual({
      status: "ran",
      expiresAt: "2026-11-21T19:00:00.000Z",
      signedIn: true,
      first: { kind: "answer", accepted: true },
      second: { kind: "answer", accepted: false, reason: "ticket_replayed" },
      passed: true,
    });
    // Both uses go to the game server's public path, without cookies.
    expect(calls.slice(1).map((c) => [c.url, c.init?.credentials])).toEqual([
      [url, "omit"],
      [url, "omit"],
    ]);
  });

  it("doesn't pass if a replay gets in, or the server can't be reached", async () => {
    const lax = async (url: string) =>
      url === "/api/net/ticket" ? json({ ticket: "t.sig" }) : json({ accepted: true });
    expect(await runReplayTest(lax, "https://x/proof/ticket")).toMatchObject({ passed: false });
    const down = async (url: string) => {
      if (url === "/api/net/ticket") return json({ ticket: "t.sig" });
      throw new TypeError("Failed to fetch");
    };
    expect(await runReplayTest(down, "https://x/proof/ticket")).toMatchObject({
      passed: false,
      first: { kind: "error", status: null, code: "unreachable" },
    });
  });

  it("says why when there's no ticket or no game server", async () => {
    const off = async () =>
      json(
        { error: { code: "multiplayer_not_configured", message: "Multiplayer isn't set up." } },
        503,
      );
    expect(await runReplayTest(off, "https://x/proof/ticket")).toEqual({
      status: "no_ticket",
      code: "multiplayer_not_configured",
      message: "Multiplayer isn't set up.",
    });
    expect(await runReplayTest(off, null)).toEqual({ status: "no_game_server" });
  });
});
