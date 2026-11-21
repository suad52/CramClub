import { describe, expect, it } from "vitest";
import { SEATS } from "@ovr/shared";
import {
  COMPANION_MIN_MS,
  NEARBY_M,
  type SeatSpot,
  addCompanionTime,
  companionNames,
  isNearby,
  listNames,
  neighboursOf,
} from "./companions";

const seat = (
  id: string,
  x: number,
  z: number,
  tableId: string | null = null,
  y = 0,
): SeatSpot => ({
  id,
  x,
  y,
  z,
  tableId,
});

describe("isNearby", () => {
  const mine = seat("a", 0, 0, "t1");

  it("counts anyone at your table, however long it is", () => {
    expect(isNearby(mine, seat("b", 0, 3.9, "t1"))).toBe(true);
  });

  it("counts close seats at other tables, on the same floor only", () => {
    expect(isNearby(mine, seat("c", NEARBY_M - 0.1, 0, "t2"))).toBe(true);
    expect(isNearby(mine, seat("d", NEARBY_M + 0.1, 0, "t2"))).toBe(false);
    expect(isNearby(mine, seat("e", 1, 0, "t3", 4.6))).toBe(false);
  });

  it("never counts your own seat", () => {
    expect(isNearby(mine, mine)).toBe(false);
  });

  it("works on the real library's seats: a table's own seats are near each other", () => {
    const byTable = new Map<string, SeatSpot[]>();
    for (const s of SEATS)
      if (s.tableId) byTable.set(s.tableId, [...(byTable.get(s.tableId) ?? []), s]);
    const table = [...byTable.values()].find((list) => list.length >= 2);
    expect(table).toBeDefined();
    expect(isNearby(table![0]!, table![1]!)).toBe(true);
  });
});

describe("neighboursOf", () => {
  const mine = seat("a", 0, 0, "t1");
  const others = [
    { id: "p1", name: "Maya", seat: seat("b", 1, 0, "t1") },
    { id: "p2", name: "Theo", seat: undefined },
    { id: "p3", name: "Sam", seat: seat("c", 30, 0, "t9") },
  ];

  it("lists the seated players near you, and nobody while you're standing", () => {
    expect(neighboursOf(mine, others)).toEqual([{ id: "p1", name: "Maya" }]);
    expect(neighboursOf(null, others)).toEqual([]);
  });
});

describe("companion log", () => {
  it("names those who stayed at least a minute, longest first, each once", () => {
    let log = addCompanionTime(new Map(), [{ id: "p1", name: "Maya" }], 40_000);
    log = addCompanionTime(
      log,
      [
        { id: "p1", name: "Maya" },
        { id: "p2", name: "Theo" },
      ],
      30_000,
    );
    log = addCompanionTime(log, [{ id: "p2", name: "Theo" }], 50_000);
    log = addCompanionTime(log, [{ id: "p3", name: "Sam" }], 10_000);
    // A second tab of the same person (same name) is said once.
    log = addCompanionTime(log, [{ id: "p4", name: "Maya" }], COMPANION_MIN_MS);
    expect(companionNames(log)).toEqual(["Theo", "Maya"]);
  });

  it("leaves the log alone when there's nobody or no time", () => {
    const log = new Map([["p1", { name: "Maya", ms: 5 }]]);
    expect(addCompanionTime(log, [], 1000)).toBe(log);
    expect(addCompanionTime(log, [{ id: "p1", name: "Maya" }], 0)).toBe(log);
  });
});

describe("listNames", () => {
  it("reads like a sentence", () => {
    expect(listNames([])).toBe("");
    expect(listNames(["Maya"])).toBe("Maya");
    expect(listNames(["Maya", "Theo"])).toBe("Maya and Theo");
    expect(listNames(["Maya", "Theo", "Sam"])).toBe("Maya, Theo and Sam");
    expect(listNames(["Maya", "Theo", "Sam", "Ana"])).toBe("Maya, Theo, Sam and 1 other");
    expect(listNames(["Maya", "Theo", "Sam", "Ana", "Jo"])).toBe("Maya, Theo, Sam and 2 others");
  });
});
