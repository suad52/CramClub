import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/gemini")>();
  return { ...actual, solveWhiteboard: vi.fn(), handwriteAnswer: vi.fn() };
});

const gemini = await import("@/lib/ai/gemini");
const solve = await import("./solve/route");
const handwrite = await import("./handwrite/route");

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const post = (body: unknown, ip = "1.2.3.4") =>
  new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

describe("POST /api/ai/whiteboard/solve", () => {
  it("rejects requests without a PNG", async () => {
    const res = await solve.POST(post({ image: "data:image/jpeg;base64,AAAA" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("says when the AI isn't configured", async () => {
    vi.mocked(gemini.solveWhiteboard).mockImplementation(async () => {
      throw new gemini.AiNotConfiguredError();
    });
    const res = await solve.POST(post({ image: PNG }, "10.0.0.1"));
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("not_configured");
  });

  it("returns the solution", async () => {
    vi.mocked(gemini.solveWhiteboard).mockResolvedValue({
      readable: true,
      question: "q",
      answer: "a",
      lines: ["a"],
    });
    const res = await solve.POST(post({ image: PNG }, "10.0.0.2"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ answer: "a", lines: ["a"] });
  });

  it("rate-limits a single client", async () => {
    vi.mocked(gemini.solveWhiteboard).mockResolvedValue({
      readable: true,
      question: "",
      answer: "a",
      lines: ["a"],
    });
    const statuses: number[] = [];
    for (let i = 0; i < 22; i++)
      statuses.push((await solve.POST(post({ image: PNG }, "10.9.9.9"))).status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe("POST /api/ai/whiteboard/handwrite", () => {
  const valid = {
    image: PNG,
    lines: ["x = 4"],
    placement: "below",
    inkColor: "#2d2420",
    aspectRatio: "4:3",
  };

  it("validates the request", async () => {
    for (const bad of [
      { ...valid, lines: [] },
      { ...valid, placement: "middle" },
      { ...valid, inkColor: "red" },
      { ...valid, aspectRatio: "7:5" },
    ]) {
      expect((await handwrite.POST(post(bad, "20.0.0.1"))).status).toBe(400);
    }
  });

  it("returns the image as a data URL", async () => {
    vi.mocked(gemini.handwriteAnswer).mockResolvedValue({ data: "SU1H", mimeType: "image/png" });
    const res = await handwrite.POST(post(valid, "20.0.0.2"));
    expect(await res.json()).toEqual({ image: "data:image/png;base64,SU1H" });
  });

  it("explains billing problems so the board can fall back to a font", async () => {
    vi.mocked(gemini.handwriteAnswer).mockRejectedValue(
      new gemini.HandwritingUnavailableError("no billing", 403),
    );
    const res = await handwrite.POST(post(valid, "20.0.0.3"));
    const body = await res.json();
    expect(body.error.code).toBe("handwriting_unavailable");
    expect(body.error.message).toMatch(/billing/);
  });
});
