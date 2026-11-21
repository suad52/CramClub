import { describe, expect, it } from "vitest";
import { speakable } from "./voice";

describe("speakable", () => {
  it("says whole sentences, up to about two of them", () => {
    const reply =
      "I found 9 good sources (from openstax.org, libretexts.org and wikipedia.org). Want a study plan or an interactive lesson from them? " +
      "x".repeat(400) +
      ".";
    expect(speakable(reply)).toBe(
      "I found 9 good sources (from openstax.org, libretexts.org and wikipedia.org). Want a study plan or an interactive lesson from them?",
    );
  });

  it("keeps short replies whole and never goes past the limit", () => {
    expect(speakable("  Shall I begin?  ")).toBe("Shall I begin?");
    expect(speakable("a".repeat(900)).length).toBeLessThanOrEqual(320);
  });
});
