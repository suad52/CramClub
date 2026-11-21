import { describe, expect, it } from "vitest";
import { sourcesBlock } from "./gemini";
import { domainOf, normalizeUrl, rankHits, realValue } from "./tasks";

describe("normalizeUrl", () => {
  it("treats tracking parameters, fragments, www and trailing slashes as the same page", () => {
    expect(normalizeUrl("https://www.example.edu/cells/?utm_source=x&id=2#top")).toBe(
      normalizeUrl("https://example.edu/cells?id=2"),
    );
  });
});

describe("rankHits", () => {
  const hit = (url: string, position: number) => ({ url, position });

  it("puts credible educational sources first and drops answer mills", () => {
    const ranked = rankHits(
      [
        hit("https://randomblog.com/respiration", 1),
        hit("https://www.chegg.com/homework-help/q", 2),
        hit("https://openstax.org/books/biology/chapter-7", 3),
        hit("https://bio.libretexts.org/respiration", 4),
        hit("https://www.coursehero.com/file/1", 5),
        hit("https://www.facebook.com/groups/calc/posts/1", 6),
      ],
      8,
    ).map((h) => domainOf(h.url));
    expect(ranked.slice(0, 2).sort()).toEqual(["bio.libretexts.org", "openstax.org"]);
    expect(ranked).not.toContain("chegg.com");
    expect(ranked).not.toContain("coursehero.com");
    expect(ranked).not.toContain("facebook.com");
  });

  it("dedupes the same page and keeps at most two pages per site", () => {
    const ranked = rankHits(
      [
        hit("https://khanacademy.org/a", 1),
        hit("https://www.khanacademy.org/a/", 2),
        hit("https://khanacademy.org/b", 3),
        hit("https://khanacademy.org/c", 4),
      ],
      8,
    );
    expect(ranked.map((h) => h.url)).toEqual([
      "https://khanacademy.org/a",
      "https://khanacademy.org/b",
    ]);
  });
});

describe("sourcesBlock", () => {
  it("wraps fetched pages as numbered, labelled data and trims long pages", () => {
    const block = sourcesBlock(
      [
        {
          title: 'A "quoted" title',
          url: "https://x.edu",
          domain: "x.edu",
          text: "y".repeat(5000),
        },
      ],
      100,
    );
    expect(block).toContain(
      '<source number="1" title="A \'quoted\' title" site="x.edu" url="https://x.edu" read="full page">',
    );
    expect(block.length).toBeLessThan(300);
  });
});

describe("realValue", () => {
  it("treats a model's 'null' or 'unknown' as no value", () => {
    expect(realValue("null")).toBeNull();
    expect(realValue(" Unknown ")).toBeNull();
    expect(realValue(null)).toBeNull();
    expect(realValue("Introductory")).toBe("Introductory");
  });
});
