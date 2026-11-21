import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_SPOKEN,
  isSpeaking,
  revealedChars,
  sayAloud,
  speakable,
  stopSpeaking,
  voiceParts,
} from "./voice";

describe("speakable", () => {
  it("says whole sentences, up to the limit", () => {
    const reply =
      "I found 9 good sources (from openstax.org, libretexts.org and wikipedia.org). Want a study plan or an interactive lesson from them? " +
      "x".repeat(MAX_SPOKEN) +
      ".";
    expect(speakable(reply)).toBe(
      "I found 9 good sources (from openstax.org, libretexts.org and wikipedia.org). Want a study plan or an interactive lesson from them?",
    );
  });

  it("says a normal reply whole, including a last sentence with no full stop", () => {
    const reply =
      "Here's your plan for the week. It covers limits, derivatives and the chain rule, with a short review each evening and a practice set on Friday. " +
      "Tick things off as you go, and I can turn any item into an interactive lesson";
    expect(speakable(reply)).toBe(reply);
  });

  it("keeps short replies whole and never goes past the limit", () => {
    expect(speakable("  Shall I begin?  ")).toBe("Shall I begin?");
    expect(speakable("a".repeat(900)).length).toBeLessThanOrEqual(MAX_SPOKEN);
    const words = speakable("word ".repeat(200));
    expect(words.length).toBeLessThanOrEqual(MAX_SPOKEN);
    expect(words.endsWith("word")).toBe(true);
  });
});

describe("voiceParts", () => {
  it("splits a long line at sentence ends into requests the endpoint takes", () => {
    const line = speakable(
      Array.from({ length: 9 }, (_, i) => `This is sentence number ${i + 1} of the reply.`).join(
        " ",
      ) + " And one more to finish it off nicely, with a little extra so it runs long enough.",
    );
    const parts = voiceParts(line);
    expect(parts.length).toBe(2);
    for (const p of parts) {
      expect(p.text.length).toBeLessThanOrEqual(400);
      expect(line.slice(p.offset).startsWith(p.text)).toBe(true);
      expect(p.text).toMatch(/[.!?]$/);
    }
    expect(parts.map((p) => p.text).join(" ")).toBe(line);
  });

  it("keeps a short line in one part", () => {
    expect(voiceParts("Hello there.")).toEqual([{ text: "Hello there.", offset: 0 }]);
  });
});

/** Stands in for the browser: the speak endpoint, audio elements and animation frames. */
class FakeAudio {
  static made: FakeAudio[] = [];
  currentTime = 0;
  duration = Number.NaN;
  ended = false;
  paused = true;
  onended: (() => void) | null = null;
  constructor(public src: string) {
    FakeAudio.made.push(this);
  }
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

describe("revealedChars", () => {
  beforeEach(() => {
    FakeAudio.made = [];
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    // Each character starts 0.1 s after the one before.
    vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
      const { text } = JSON.parse(init.body) as { text: string };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          audio: "AAAA",
          alignment: { starts: [...text].map((_, i) => i * 0.1) },
        }),
      };
    });
  });
  afterEach(() => {
    stopSpeaking();
    vi.unstubAllGlobals();
  });

  it("follows her voice through the line, then lets the whole text show", async () => {
    const text = "Hello there.\n\nShall we   begin?";
    expect(revealedChars(text)).toBeNull();
    const started = sayAloud(text);
    // Her voice is on its way: nothing shows yet.
    expect(revealedChars(text)).toBe(0);
    expect(isSpeaking()).toBe(false);
    await started;
    expect(isSpeaking()).toBe(true);
    const audio = FakeAudio.made[0]!;
    audio.currentTime = 0.47;
    expect(text.slice(0, revealedChars(text)!)).toBe("Hello ");
    audio.currentTime = 1.17;
    expect(text.slice(0, revealedChars(text)!)).toBe("Hello there.\n\n");
    // Another message isn't the one she's saying.
    expect(revealedChars("Something else.")).toBeNull();
    audio.ended = true;
    expect(revealedChars(text)).toBe(text.length);
    audio.onended?.();
    expect(revealedChars(text)).toBeNull();
    expect(isSpeaking()).toBe(false);
  });

  it("cuts off the line she's saying when a newer one comes", async () => {
    await sayAloud("First line.");
    const first = FakeAudio.made[0]!;
    const next = sayAloud("Second line.");
    expect(first.paused).toBe(true);
    expect(revealedChars("First line.")).toBeNull();
    expect(revealedChars("Second line.")).toBe(0);
    await next;
    expect(isSpeaking()).toBe(true);
    expect(FakeAudio.made[1]!.paused).toBe(false);
  });

  it("says a long line in parts, the text following each in turn", async () => {
    const text =
      Array.from({ length: 9 }, (_, i) => `This is sentence number ${i + 1} of the reply.`).join(
        " ",
      ) + " And one more to finish it off nicely, with a little extra so it runs long enough.";
    await sayAloud(text);
    const [one] = FakeAudio.made;
    const first = voiceParts(speakable(text))[0]!;
    one!.ended = true;
    expect(revealedChars(text)).toBe(first.text.length);
    one!.onended?.();
    // Between parts the text waits at the end of the first.
    expect(revealedChars(text)).toBe(first.text.length + 1);
    await vi.waitFor(() => expect(FakeAudio.made[1]?.paused).toBe(false));
    const two = FakeAudio.made[1]!;
    two.currentTime = 0.24;
    expect(revealedChars(text)).toBe(first.text.length + 1 + 3);
    two.ended = true;
    expect(revealedChars(text)).toBe(text.length);
    two.onended?.();
    expect(revealedChars(text)).toBeNull();
  });
});
