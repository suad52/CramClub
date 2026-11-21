import { INTERNAL_SIGNATURE_HEADER, INTERNAL_TIMESTAMP_HEADER, signInternal } from "@ovr/shared";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const generateContent = vi.fn();
vi.mock("@/lib/ai/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/gemini")>();
  return {
    ...actual,
    getGemini: vi.fn(() => {
      if (!process.env.GEMINI_API_KEY) throw new actual.AiNotConfiguredError();
      return { models: { generateContent } };
    }),
  };
});

const { POST } = await import("./route");

const SECRET = "test-secret-for-the-internal-route";
const saved = { ticket: process.env.GAME_TICKET_SECRET, gemini: process.env.GEMINI_API_KEY };
afterAll(() => {
  process.env.GAME_TICKET_SECRET = saved.ticket;
  process.env.GEMINI_API_KEY = saved.gemini;
  if (saved.ticket === undefined) delete process.env.GAME_TICKET_SECRET;
  if (saved.gemini === undefined) delete process.env.GEMINI_API_KEY;
});

let n = 0;
/** A distinct, valid request body (each signature is accepted once). */
const body = (o: Record<string, unknown> = {}) =>
  JSON.stringify({
    askerName: "Sam",
    lines: [{ name: "Sam", text: `what is a derivative (${++n})`, fenwick: false, asker: true }],
    alone: false,
    ...o,
  });

async function signed(raw: string, o: { at?: number; secret?: string; signature?: string } = {}) {
  const at = o.at ?? Date.now();
  const signature = o.signature ?? (await signInternal(o.secret ?? SECRET, at, raw));
  return new Request("http://localhost/api/internal/fenwick-chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INTERNAL_SIGNATURE_HEADER]: signature,
      [INTERNAL_TIMESTAMP_HEADER]: String(at),
    },
    body: raw,
  });
}
const says = (reply: string | null) => ({ text: JSON.stringify({ reply }) });

beforeEach(() => {
  process.env.GAME_TICKET_SECRET = SECRET;
  process.env.GEMINI_API_KEY = "test-key";
  generateContent.mockReset();
  generateContent.mockResolvedValue(says("A derivative is a rate of change, Sam."));
});

describe("POST /api/internal/fenwick-chat", () => {
  it("answers a signed request", async () => {
    const res = await POST(await signed(body()));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ reply: "A derivative is a rate of change, Sam." });
  });

  it("returns null when the message needs no answer", async () => {
    generateContent.mockResolvedValue(says(null));
    const res = await POST(await signed(body()));
    expect(await res.json()).toEqual({ reply: null });
    const brb = body({ lines: [{ name: "Sam", text: "brb", fenwick: false, asker: true }] });
    expect(await (await POST(await signed(brb))).json()).toEqual({ reply: null });
  });

  it("answers with a canned line when Gemini fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    generateContent.mockRejectedValue(Object.assign(new Error("down"), { status: 503 }));
    const res = await POST(await signed(body()));
    expect(res.status).toBe(200);
    const { reply } = (await res.json()) as { reply: string };
    expect(reply).toMatch(/dear/);
    expect(reply).not.toContain("derivative");
  });

  describe("signature", () => {
    it("is required", async () => {
      const req = new Request("http://localhost/api/internal/fenwick-chat", {
        method: "POST",
        body: body(),
      });
      const res = await POST(req);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: { code: "unauthorized" } });
      expect(generateContent).not.toHaveBeenCalled();
    });

    it("must be made with the shared secret", async () => {
      const res = await POST(await signed(body(), { secret: "someone-elses-secret" }));
      expect(res.status).toBe(401);
    });

    it("must cover the exact body", async () => {
      const raw = body();
      const req = await signed(raw);
      const tampered = new Request(req.url, {
        method: "POST",
        headers: req.headers,
        body: raw.replace("Sam", "Eve"),
      });
      expect((await POST(tampered)).status).toBe(401);
    });

    it("must be fresh", async () => {
      const stale = await signed(body(), { at: Date.now() - 5 * 60_000 });
      expect((await POST(stale)).status).toBe(401);
      const future = await signed(body(), { at: Date.now() + 5 * 60_000 });
      expect((await POST(future)).status).toBe(401);
    });

    it("works once", async () => {
      const raw = body();
      const at = Date.now();
      expect((await POST(await signed(raw, { at }))).status).toBe(200);
      expect((await POST(await signed(raw, { at }))).status).toBe(401);
    });

    it("is checked before the body is read as JSON", async () => {
      const res = await POST(await signed("not json", { signature: "bogus" }));
      expect(res.status).toBe(401);
    });
  });

  it("refuses a bad body once signed", async () => {
    for (const raw of [
      "not json",
      body({ askerName: "" }),
      body({ lines: [] }),
      body({ lines: [{ name: "Sam", text: "x".repeat(201), fenwick: false, asker: true }] }),
      body({ alone: "yes" }),
    ]) {
      const res = await POST(await signed(raw));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: "bad_request" } });
    }
    expect(generateContent).not.toHaveBeenCalled();
  });

  it("refuses an oversized body without reading it all", async () => {
    const raw = body({ padding: "x".repeat(20_000) });
    expect((await POST(await signed(raw))).status).toBe(413);
  });

  it("says when it isn't configured", async () => {
    delete process.env.GAME_TICKET_SECRET;
    const noSecret = await POST(await signed(body()));
    expect(noSecret.status).toBe(503);
    expect(await noSecret.json()).toEqual({ error: { code: "not_configured" } });

    process.env.GAME_TICKET_SECRET = SECRET;
    delete process.env.GEMINI_API_KEY;
    const noGemini = await POST(await signed(body()));
    expect(noGemini.status).toBe(503);
    expect(await noGemini.json()).toEqual({ error: { code: "not_configured" } });
  });
});
