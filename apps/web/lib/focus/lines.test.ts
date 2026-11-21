import { describe, expect, it } from "vitest";
import { BACK_LINES, DRIFT_LINES, encouragement, shushLine, studentFirstName } from "./lines";

describe("her lines", () => {
  it("has about ten ways to shush a drifter and a few for coming back", () => {
    expect(DRIFT_LINES.length).toBeGreaterThanOrEqual(10);
    expect(BACK_LINES.length).toBeGreaterThanOrEqual(4);
  });

  it("every line has its name slot in the named version only, and never says AI", () => {
    for (const [named, plain] of [...DRIFT_LINES, ...BACK_LINES]) {
      expect(named).toContain("{name}");
      expect(plain).not.toContain("{name}");
      for (const line of [named, plain]) {
        expect(line).not.toMatch(/\bAI\b|camera|webcam/i);
        expect(line.length).toBeLessThan(110);
      }
    }
  });

  it("starts with the classic", () => {
    expect(shushLine("drifted", "Maya", 0)).toBe("Shh. Maya, the page is down here, dear.");
    expect(shushLine("drifted", null, 0)).toBe("Shh. The page is down here, dear.");
  });

  it("fills in the name, and never says the same line twice running", () => {
    for (let i = 0; i < 40; i++) {
      const pick = i / 40;
      const first = shushLine("drifted", "Theo", pick);
      expect(first).toContain("Theo");
      expect(shushLine("drifted", "Theo", pick, first)).not.toBe(first);
      expect(shushLine("back", "Theo", pick)).toContain("Theo");
    }
  });

  it("copes with a pick out of range", () => {
    expect(shushLine("back", "Sam", 1)).toContain("Sam");
    expect(shushLine("back", "Sam", -3)).toContain("Sam");
    expect(shushLine("back", "Sam", Number.NaN)).toContain("Sam");
  });
});

describe("studentFirstName", () => {
  it("uses the name over your head, first name only", () => {
    expect(studentFirstName("Maya", "Captain Maya")).toBe("Maya");
    expect(studentFirstName("Maya Lin", "")).toBe("Maya");
  });

  it("falls back to the character's name for guests and placeholders", () => {
    expect(studentFirstName("Guest 4821", "Theo the Great")).toBe("Theo");
    expect(studentFirstName("Reader", "Sam")).toBe("Sam");
    expect(studentFirstName(null, "  Ana  ")).toBe("Ana");
  });

  it("is null when there's nothing friendly to call you", () => {
    expect(studentFirstName("Guest 4821", "")).toBeNull();
    expect(studentFirstName(null, "   ")).toBeNull();
    expect(studentFirstName(undefined, "Guest 12")).toBeNull();
  });
});

describe("encouragement", () => {
  const mood = { percent: null, companions: 0, count: 1, long: false };

  it("is always a kind line, whatever happened", () => {
    for (let i = 0; i < 20; i++) {
      for (const m of [
        mood,
        { ...mood, percent: 12 },
        { ...mood, percent: 97 },
        { ...mood, companions: 2 },
        { ...mood, count: 3 },
        { ...mood, long: true },
      ]) {
        const line = encouragement(m, i / 20);
        expect(line.length).toBeGreaterThan(10);
        expect(line).not.toMatch(/only|didn't|failed|lazy|should have|\d+%/i);
      }
    }
  });

  it("notices a whole set, company, and a pomodoro spent locked in", () => {
    expect(encouragement({ ...mood, long: true }, 0)).toMatch(/whole set/i);
    expect(encouragement({ ...mood, companions: 1 }, 0)).toMatch(/each other/);
    expect(encouragement({ ...mood, percent: 95 }, 0)).toMatch(/locked in/i);
    expect(encouragement({ ...mood, count: 3 }, 0)).toMatch(/3 in a row/);
  });
});
