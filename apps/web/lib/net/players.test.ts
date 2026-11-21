import { describe, expect, it } from "vitest";
import { cleanRemoteName } from "./players";

describe("cleanRemoteName", () => {
  it("draws only visible text, at most 32 characters", () => {
    expect(cleanRemoteName("Ada")).toBe("Ada");
    expect(cleanRemoteName("  Guest\n4821 ")).toBe("Guest 4821");
    // Bidi overrides and zero-width characters can't disguise a name or blank the tag.
    expect(cleanRemoteName("‮1284 tseuG")).toBe("1284 tseuG");
    expect(cleanRemoteName("A​da⁦")).toBe("Ada");
    expect(cleanRemoteName("‍⁠")).toBe("Someone");
    expect(cleanRemoteName("x".repeat(80))).toHaveLength(32);
    expect(cleanRemoteName(42)).toBe("Someone");
  });
});
