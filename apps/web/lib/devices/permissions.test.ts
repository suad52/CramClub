import { describe, expect, it } from "vitest";
import { mediaProblem, mediaSupport, problemText } from "./permissions";

describe("mediaSupport", () => {
  it("needs a secure page first, then getUserMedia", () => {
    expect(mediaSupport({ secure: true, getUserMedia: true })).toBe("ok");
    expect(mediaSupport({ secure: false, getUserMedia: true })).toBe("insecure");
    expect(mediaSupport({ secure: false, getUserMedia: false })).toBe("insecure");
    expect(mediaSupport({ secure: true, getUserMedia: false })).toBe("unsupported");
  });
});

describe("mediaProblem", () => {
  const named = (name: string) => Object.assign(new Error(name), { name });

  it("sorts getUserMedia errors by name", () => {
    expect(mediaProblem(named("NotAllowedError"))).toBe("denied");
    expect(mediaProblem(named("NotFoundError"))).toBe("missing");
    expect(mediaProblem(named("OverconstrainedError"))).toBe("missing");
    expect(mediaProblem(named("NotReadableError"))).toBe("busy");
    expect(mediaProblem(named("SecurityError"))).toBe("insecure");
    expect(mediaProblem(named("NotSupportedError"))).toBe("unsupported");
  });

  it("calls anything else (or nothing) other", () => {
    expect(mediaProblem(named("Weird"))).toBe("other");
    expect(mediaProblem(null)).toBe("other");
    expect(mediaProblem("nope")).toBe("other");
  });
});

describe("problemText", () => {
  it("tells a blocked student where to allow it, and never blames them", () => {
    const cam = problemText("denied", "camera");
    expect(cam).toContain("camera icon in the address bar");
    expect(cam).toContain("Try again");
    expect(problemText("denied", "mic")).toContain("microphone icon");
  });

  it("says every dead end still lets them go in", () => {
    for (const p of ["missing", "unsupported", "insecure", "other"] as const)
      for (const k of ["camera", "mic"] as const) expect(problemText(p, k)).toMatch(/go in/);
  });
});
