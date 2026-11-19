import { describe, expect, it, vi } from "vitest";
import {
  type GeminiLike,
  HandwritingUnavailableError,
  IMAGE_MODEL,
  TEXT_FALLBACK_MODEL,
  TEXT_MODEL,
  handwriteAnswer,
  handwritingPrompt,
  parseSolution,
  solveWhiteboard,
  wrapLines,
} from "./gemini";

function fakeClient(opts: { text?: string; interaction?: unknown; interactionError?: unknown }) {
  const generateContent = vi.fn(async () => ({ text: opts.text }));
  const create = vi.fn(async () => {
    if (opts.interactionError) throw opts.interactionError;
    return opts.interaction;
  });
  const client = { models: { generateContent }, interactions: { create } } as unknown as GeminiLike;
  return { client, generateContent, create };
}

describe("wrapLines", () => {
  it("wraps long lines on word boundaries and caps the count", () => {
    const out = wrapLines(["the quick brown fox jumps over the lazy dog again and again"], 20);
    expect(out.every((l) => l.length <= 20)).toBe(true);
    expect(out.join(" ")).toBe("the quick brown fox jumps over the lazy dog again and again");
    expect(wrapLines(Array.from({ length: 20 }, () => "x")).length).toBe(10);
  });
});

describe("parseSolution", () => {
  it("accepts the model's JSON", () => {
    const s = parseSolution(
      JSON.stringify({ readable: true, question: "2x = 8", answer: "x = 4", lines: ["x = 4"] }),
    );
    expect(s).toEqual({ readable: true, question: "2x = 8", answer: "x = 4", lines: ["x = 4"] });
  });

  it("builds lines from the answer when the model leaves them out", () => {
    const s = parseSolution(
      JSON.stringify({ readable: true, question: "", answer: "Paris", lines: [] }),
    );
    expect(s.lines).toEqual(["Paris"]);
  });

  it("reports unreadable boards", () => {
    expect(
      parseSolution(JSON.stringify({ readable: false, question: "", answer: "", lines: [] }))
        .readable,
    ).toBe(false);
  });
});

describe("solveWhiteboard", () => {
  it("sends the image to the text model and asks for JSON", async () => {
    const { client, generateContent } = fakeClient({
      text: JSON.stringify({ readable: true, question: "1+1", answer: "2", lines: ["1 + 1 = 2"] }),
    });
    const s = await solveWhiteboard("QUJD", client);
    expect(s.lines).toEqual(["1 + 1 = 2"]);
    const request = (generateContent.mock.calls[0] as unknown[])[0] as {
      model: string;
      contents: { parts: { inlineData?: { mimeType: string; data: string } }[] }[];
      config: { responseMimeType: string };
    };
    expect(request.model).toBe(TEXT_MODEL);
    expect(request.contents[0]!.parts[1]!.inlineData).toEqual({
      mimeType: "image/png",
      data: "QUJD",
    });
    expect(request.config.responseMimeType).toBe("application/json");
  });
});

describe("solveWhiteboard fallback", () => {
  it("retries on the backup model when the main one is overloaded", async () => {
    const ok = {
      text: JSON.stringify({ readable: true, question: "q", answer: "a", lines: ["a"] }),
    };
    const generateContent = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("Deadline expired"), { status: 504 }))
      .mockResolvedValueOnce(ok);
    const client = {
      models: { generateContent },
      interactions: { create: vi.fn() },
    } as unknown as GeminiLike;
    const s = await solveWhiteboard("QUJD", client);
    expect(s.answer).toBe("a");
    const models = generateContent.mock.calls.map((c) => (c[0] as { model: string }).model);
    expect(models).toEqual([TEXT_MODEL, TEXT_FALLBACK_MODEL]);
  });

  it("doesn't retry real errors such as a bad key", async () => {
    const generateContent = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("API key not valid"), { status: 400 }));
    const client = {
      models: { generateContent },
      interactions: { create: vi.fn() },
    } as unknown as GeminiLike;
    await expect(solveWhiteboard("QUJD", client)).rejects.toThrow("API key not valid");
    expect(generateContent).toHaveBeenCalledTimes(1);
  });
});

describe("handwriteAnswer", () => {
  const input = {
    pngBase64: "QUJD",
    lines: ["x = 4"],
    placement: "below" as const,
    inkHex: "#2f6fb3",
    aspectRatio: "4:3",
  };

  it("asks the image model for an image and returns it", async () => {
    const { client, create } = fakeClient({
      interaction: { output_image: { data: "SU1H", mime_type: "image/png" } },
    });
    expect(await handwriteAnswer(input, client)).toEqual({ data: "SU1H", mimeType: "image/png" });
    const request = (create.mock.calls[0] as unknown[])[0] as {
      model: string;
      store: boolean;
      response_format: { type: string; aspect_ratio: string };
    };
    expect(request.model).toBe(IMAGE_MODEL);
    expect(request.store).toBe(false);
    expect(request.response_format).toMatchObject({ type: "image", aspect_ratio: "4:3" });
  });

  it("reports billing/permission failures with their status", async () => {
    const { client } = fakeClient({
      interactionError: Object.assign(new Error("billing required"), { status: 403 }),
    });
    await expect(handwriteAnswer(input, client)).rejects.toMatchObject({
      name: "HandwritingUnavailableError",
      status: 403,
    });
  });

  it("treats an answer without an image as unavailable", async () => {
    const { client } = fakeClient({ interaction: { output_text: "sorry" } });
    await expect(handwriteAnswer(input, client)).rejects.toBeInstanceOf(
      HandwritingUnavailableError,
    );
  });

  it("tells the model exactly what to write, where, and in which colour", () => {
    const p = handwritingPrompt(["x = 4", "check: 2·4 = 8"], "right", "#c0392b");
    expect(p).toContain('"x = 4"');
    expect(p).toContain('"check: 2·4 = 8"');
    expect(p).toContain("right-hand side");
    expect(p).toContain("#c0392b");
  });
});
