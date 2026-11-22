import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { librarianPresence } from "./presence";
import {
  MAX_SPOKEN,
  isSpeaking,
  pickBackupVoice,
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

describe("pickBackupVoice", () => {
  const voice = (name: string, lang: string) => ({ name, lang });

  it("borrows a British woman's voice when the browser has one", () => {
    const voices = [
      voice("Samantha", "en-US"),
      voice("Daniel", "en-GB"),
      voice("Kate", "en-GB"),
      voice("Google UK English Male", "en-GB"),
    ];
    expect(pickBackupVoice(voices)?.name).toBe("Kate");
    expect(pickBackupVoice([...voices, voice("Google UK English Female", "en-GB")])?.name).toBe(
      "Google UK English Female",
    );
  });

  it("else any British voice, else any English one, else none", () => {
    expect(pickBackupVoice([voice("Samantha", "en-US"), voice("Daniel", "en-GB")])?.name).toBe(
      "Daniel",
    );
    expect(pickBackupVoice([voice("Thomas", "fr-FR"), voice("Samantha", "en_US")])?.name).toBe(
      "Samantha",
    );
    expect(pickBackupVoice([voice("Thomas", "fr-FR")])).toBeNull();
    expect(pickBackupVoice([])).toBeNull();
  });
});

/** Stands in for the browser's own speech (Web Speech API). */
class FakeUtterance {
  voice: { name: string; lang: string } | null = null;
  lang = "";
  rate = 1;
  pitch = 1;
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public text: string) {}
}

function fakeSpeech() {
  return {
    speaking: false,
    pending: false,
    said: [] as FakeUtterance[],
    cancels: 0,
    speak(u: FakeUtterance) {
      this.said.push(u);
    },
    cancel() {
      this.cancels++;
    },
    getVoices: () => [
      { name: "Daniel", lang: "en-GB" },
      { name: "Kate", lang: "en-GB" },
    ],
  };
}

describe("her backup voice", () => {
  let speech: ReturnType<typeof fakeSpeech>;
  let elevenLabs: { ok: boolean; status: number };

  beforeEach(() => {
    speech = fakeSpeech();
    elevenLabs = { ok: false, status: 401 }; // out of credits
    FakeAudio.made = [];
    vi.stubGlobal("speechSynthesis", speech);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("requestAnimationFrame", () => 0);
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
    vi.stubGlobal("fetch", async () => ({
      ...elevenLabs,
      json: async () => ({ audio: "AAAA", alignment: null }),
    }));
  });
  afterEach(() => {
    stopSpeaking();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("says the line in the browser's voice when ElevenLabs refuses it (out of credits)", async () => {
    await sayAloud("Shh. There you are, dear. Let's not wander off again.");
    expect(speech.said.map((u) => u.text)).toEqual([
      "Shh. There you are, dear. Let's not wander off again.",
    ]);
    expect(speech.said[0]!.voice?.name).toBe("Kate");
    // Her mouth moves while it talks, and the whole text shows.
    expect(librarianPresence.speakUntil).toBeGreaterThan(performance.now());
    expect(revealedChars("Shh. There you are, dear. Let's not wander off again.")).toBeNull();
    // Done: her mouth stops.
    speech.said[0]!.onend?.();
    expect(librarianPresence.speakUntil).toBe(0);
  });

  it("says it in the browser's voice when the browser blocks her audio", async () => {
    elevenLabs = { ok: true, status: 200 };
    vi.stubGlobal(
      "Audio",
      class extends FakeAudio {
        override play() {
          return Promise.reject(new Error("NotAllowedError"));
        }
      },
    );
    await sayAloud("Eyes on the book, please, dear.");
    expect(speech.said.map((u) => u.text)).toEqual(["Eyes on the book, please, dear."]);
  });

  it("uses ElevenLabs when it works, never the backup", async () => {
    elevenLabs = { ok: true, status: 200 };
    await sayAloud("Mm-hm. I see you, dear. Page, please.");
    expect(FakeAudio.made).toHaveLength(1);
    expect(speech.said).toEqual([]);
  });

  it("stays silent when muted (she only mouths it)", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "1", setItem: () => {} });
    await sayAloud("Psst. Your desk misses you, dear.");
    expect(speech.said).toEqual([]);
    expect(librarianPresence.speakUntil).toBeGreaterThan(performance.now());
  });

  it("never talks over the browser saying something else, like a lesson's narration", async () => {
    // Well after any line of hers was cut off (so "speaking" can't be her own line ending).
    const later = performance.now() + 60_000;
    vi.spyOn(performance, "now").mockImplementation(() => later);
    speech.speaking = true;
    await sayAloud("Shh. Back to it.");
    expect(speech.said).toEqual([]);
    expect(speech.cancels).toBe(0);
    // She mouths it instead.
    expect(librarianPresence.speakUntil).toBeGreaterThan(performance.now());
    stopSpeaking();
    expect(speech.cancels).toBe(0);
  });

  it("a newer line cuts off her backup line; asking for the same line again changes nothing", async () => {
    await sayAloud("Shh. Back to it.");
    await sayAloud("Shh. Back to it.");
    expect(speech.said).toHaveLength(1);
    // The browser still reports her first line as speaking just after she cancels it.
    speech.speaking = true;
    await sayAloud("Welcome back, dear. The book kept your place. Shh, now.");
    expect(speech.cancels).toBe(1);
    expect(speech.said.map((u) => u.text)).toEqual([
      "Shh. Back to it.",
      "Welcome back, dear. The book kept your place. Shh, now.",
    ]);
    // A late "done" from the cut-off line doesn't stop her mouth on the new one.
    speech.said[0]!.onerror?.();
    expect(librarianPresence.speakUntil).toBeGreaterThan(performance.now());
  });
});
