import { describe, expect, it } from "vitest";
import { SEATS } from "@ovr/shared";
import { LAMP_FADE_SECONDS, fadeOpacity, nearestTable, stepFade, tableCentres } from "./tableLamps";

describe("table lamps for lessons", () => {
  it("finds the middle of every study table from its seats", () => {
    const centres = tableCentres();
    const tables = new Set(SEATS.flatMap((s) => (s.tableId ? [s.tableId] : [])));
    expect(centres.size).toBe(tables.size);
    // The hall's twelve long tables, whose lamps fade for a lesson on their board.
    for (let n = 1; n <= 12; n++)
      expect(centres.has(`hall-t${String(n).padStart(2, "0")}`)).toBe(true);
  });

  it("puts a lamp on the table it stands on, and none when it's away from every table", () => {
    const centres = tableCentres();
    const t03 = centres.get("hall-t03")!;
    expect(nearestTable(t03.x + 0.4, t03.z - 0.3, centres)).toBe("hall-t03");
    expect(nearestTable(t03.x + 100, t03.z, centres)).toBeNull();
  });

  it("fades out over LAMP_FADE_SECONDS and back in, never past the ends", () => {
    let shown = 1;
    for (let i = 0; i < 10; i++) shown = stepFade(shown, 0, LAMP_FADE_SECONDS / 4);
    expect(shown).toBe(0);
    shown = stepFade(shown, 1, LAMP_FADE_SECONDS / 2);
    expect(shown).toBeCloseTo(0.5);
    shown = stepFade(shown, 1, LAMP_FADE_SECONDS);
    expect(shown).toBe(1);
  });

  it("eases the lamps' opacity: fully there at 1, gone at 0, halfway at 0.5", () => {
    expect(fadeOpacity(1)).toBe(1);
    expect(fadeOpacity(0)).toBe(0);
    expect(fadeOpacity(0.5)).toBeCloseTo(0.5);
    expect(fadeOpacity(0.1)).toBeLessThan(0.1);
  });
});
