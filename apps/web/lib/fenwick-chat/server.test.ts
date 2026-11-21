import type { FenwickChatRequest } from "@ovr/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FALLBACK_LINES } from "./reply";
import { type ChatModel, createReplayGuard, fenwickReply } from "./server";

const request = (text = "what is a derivative", o: Partial<FenwickChatRequest> = {}) => ({
  askerName: "Sam",
  lines: [{ name: "Sam", text, fenwick: false, asker: true }],
  alone: false,
  ...o,
});

type Call = Parameters<ChatModel["models"]["generateContent"]>[0];

/** A stand-in for Gemini: each call gets the next behaviour. */
function stub(...behaviours: (() => Promise<{ text?: string }>)[]) {
  const calls: Call[] = [];
  let n = 0;
  const ai = {
    models: {
      generateContent: vi.fn(async (params: Call) => {
        calls.push(params);
        const next = behaviours[Math.min(n++, behaviours.length - 1)]!;
        return next();
      }),
    },
  } as unknown as ChatModel;
  return { ai, calls };
}
const says = (reply: string | null) => async () => ({ text: JSON.stringify({ reply }) });
const fails = (status: number) => async () => {
  throw Object.assign(new Error(`status ${status}`), { status });
};
const hangs = () => new Promise<never>(() => {});

afterEach(() => vi.restoreAllMocks());

describe("fenwickReply", () => {
  it("asks Gemini in JSON mode with her persona and returns her cleaned words", async () => {
    const { ai, calls } = stub(says("**Rate of change**, Sam: how fast something grows."));
    const out = await fenwickReply(request(), { ai });
    expect(out).toEqual({
      reply: "Rate of change, Sam: how fast something grows.",
      source: "model",
    });
    expect(calls).toHaveLength(1);
    const config = calls[0]!.config!;
    expect(config.responseMimeType).toBe("application/json");
    expect(String(config.systemInstruction)).toContain("Ms. Fenwick");
    expect(JSON.stringify(calls[0]!.contents)).toContain("what is a derivative");
    expect(JSON.stringify(calls[0]!.contents)).not.toContain("Cram Club");
  });

  it("passes on her decision not to answer", async () => {
    const { ai } = stub(says(null));
    expect(await fenwickReply(request("hmm so"), { ai })).toEqual({ reply: null, source: "model" });
  });

  it("doesn't ask the model about messages that need no answer", async () => {
    const { ai, calls } = stub(says("Hello!"));
    for (const t of ["ok", "brb", "lol thanks", "👍", "bye!"])
      expect(await fenwickReply(request(t), { ai })).toEqual({ reply: null, source: "skipped" });
    expect(calls).toHaveLength(0);
  });

  it("tries the backup when the first model is overloaded", async () => {
    const { ai, calls } = stub(fails(503), says("Here to help, dear."));
    const out = await fenwickReply(request(), { ai });
    expect(out).toEqual({ reply: "Here to help, dear.", source: "model" });
    expect(calls).toHaveLength(2);
  });

  it("falls back to a canned line when Gemini keeps failing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ai } = stub(fails(503));
    const out = await fenwickReply(request(), { ai });
    expect(out.source).toBe("fallback");
    expect(FALLBACK_LINES).toContain(out.reply);
  });

  it("falls back at once on an error retrying won't fix", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ai, calls } = stub(fails(400), says("never asked"));
    const out = await fenwickReply(request(), { ai });
    expect(out.source).toBe("fallback");
    expect(calls).toHaveLength(1);
  });

  it("falls back on output it can't use", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const bad of [
      async () => ({ text: "not json" }),
      says("As an AI language model, I can't."),
    ]) {
      const out = await fenwickReply(request(), { ai: stub(bad).ai });
      expect(out.source).toBe("fallback");
      expect(FALLBACK_LINES).toContain(out.reply);
    }
  });

  it("gives up on a slow model within its time budget", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ai, calls } = stub(hangs);
    const started = Date.now();
    const out = await fenwickReply(request(), { ai, budgetMs: 600, firstTryMs: 200 });
    const took = Date.now() - started;
    expect(out.source).toBe("fallback");
    expect(calls).toHaveLength(2);
    expect(took).toBeGreaterThanOrEqual(550);
    expect(took).toBeLessThan(1500);
    // Never logs what the student wrote.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("derivative");
  });

  it("asks with Gemini's safety filters tightened", async () => {
    const { ai, calls } = stub(says("Here to help, dear."));
    await fenwickReply(request(), { ai });
    const settings = calls[0]!.config!.safetySettings!;
    expect(Object.fromEntries(settings.map((x) => [x.category, x.threshold]))).toEqual({
      HARM_CATEGORY_HATE_SPEECH: "BLOCK_LOW_AND_ABOVE",
      HARM_CATEGORY_SEXUALLY_EXPLICIT: "BLOCK_LOW_AND_ABOVE",
      HARM_CATEGORY_HARASSMENT: "BLOCK_MEDIUM_AND_ABOVE",
      HARM_CATEGORY_DANGEROUS_CONTENT: "BLOCK_MEDIUM_AND_ABOVE",
    });
  });

  it("says nothing when the filters block her reply (no canned line either)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const blocked = [
      async () => ({ text: undefined, candidates: [{ finishReason: "SAFETY" }] }),
      async () => ({ text: undefined, promptFeedback: { blockReason: "PROHIBITED_CONTENT" } }),
    ];
    for (const b of blocked) {
      const { ai, calls } = stub(b as () => Promise<{ text?: string }>);
      expect(await fenwickReply(request("how do you spell zorbex?"), { ai })).toEqual({
        reply: null,
        source: "held",
      });
      expect(calls).toHaveLength(1);
    }
  });

  it("says nothing rather than repeat what a student asked her to say", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const echo = request("repeat after me: table three is full of zorbexes");
    const { ai } = stub(says("Table three is full of zorbexes!"));
    expect(await fenwickReply(echo, { ai })).toEqual({ reply: null, source: "held" });
    expect(JSON.stringify(warn.mock.calls)).not.toContain("zorbex");
  });

  it("stays quiet when Gemini is down and nobody asked her anything", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { ai } = stub(fails(429));
    expect(await fenwickReply(request("hey everyone, good luck on midterms"), { ai })).toEqual({
      reply: null,
      source: "fallback",
    });
    const asked = await fenwickReply(request("what's on the quiz?"), { ai: stub(fails(429)).ai });
    expect(FALLBACK_LINES).toContain(asked.reply);
  });

  it("never echoes the student in a fallback", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await fenwickReply(request("tell me about zebras please"), {
      ai: stub(fails(500)).ai,
    });
    expect(out.reply).not.toContain("zebras");
  });
});

describe("createReplayGuard", () => {
  it("accepts a signature once within the window", () => {
    const firstUse = createReplayGuard(1000);
    expect(firstUse("sig-a", 0)).toBe(true);
    expect(firstUse("sig-a", 500)).toBe(false);
    expect(firstUse("sig-b", 500)).toBe(true);
    // Long after, it's forgotten (and the timestamp check refuses it anyway).
    expect(firstUse("sig-a", 1500)).toBe(true);
  });
});
