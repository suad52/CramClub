import { describe, expect, it, vi } from "vitest";
import { useDevicePrefs } from "@/lib/devices/prefs";
import { isPointing, startFingerPen, toBoard } from "./fingerPen";

// Saved device choices live in localStorage, which plain Node doesn't have.
vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});

// The hand model never loads here, to check what happens to the camera when the pen can't start.
vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  HandLandmarker: {
    createFromOptions: async () => {
      throw new Error("model unavailable");
    },
  },
}));

/** A hand from wrist (0,0.9) up: `index` and `middle` say whether each finger is out. */
function hand(index: boolean, middle: boolean) {
  const pts = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9, z: 0 }));
  pts[6] = { x: 0.5, y: 0.6, z: 0 }; // index PIP
  pts[8] = { x: 0.5, y: index ? 0.3 : 0.7, z: 0 }; // index tip
  pts[10] = { x: 0.55, y: 0.62, z: 0 }; // middle PIP
  pts[12] = { x: 0.55, y: middle ? 0.32 : 0.72, z: 0 }; // middle tip
  return pts;
}

describe("finger pen", () => {
  it("draws only while pointing with one finger", () => {
    expect(isPointing(hand(true, false))).toBe(true);
    expect(isPointing(hand(true, true))).toBe(false); // two fingers: pen up
    expect(isPointing(hand(false, false))).toBe(false); // fist
  });

  it("maps the mirrored camera onto the board and clamps to its edges", () => {
    const mid = toBoard({ x: 0.5, y: 0.45 });
    expect(mid.x).toBeCloseTo(0.5);
    expect(mid.y).toBeCloseTo(0.5);
    const corner = toBoard({ x: 0.82, y: 0.15 }); // your left = the board's left
    expect(corner.x).toBeCloseTo(0);
    expect(corner.y).toBeCloseTo(0);
    expect(toBoard({ x: 0, y: 1 })).toEqual({ x: 1, y: 1 });
  });
});

describe("finger pen camera", () => {
  it("opens the student's camera, and closes it again when the pen can't start", async () => {
    const track = { readyState: "live", stop: () => (track.readyState = "ended") };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    vi.stubGlobal("document", {
      createElement: () => ({ play: async () => {}, pause: () => {}, srcObject: null }),
    });
    useDevicePrefs.setState({ cameraId: "cam-2" });
    await expect(startFingerPen(() => {})).rejects.toThrow("model unavailable");
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: expect.objectContaining({ deviceId: { exact: "cam-2" } }),
    });
    expect(track.readyState).toBe("ended");
  });
});
