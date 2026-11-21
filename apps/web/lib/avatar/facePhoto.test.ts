import { describe, expect, it, vi } from "vitest";
import { DEFAULT_AVATAR, resolveAvatar } from "@ovr/shared";
import { useDevicePrefs } from "@/lib/devices/prefs";
import {
  DEFAULT_HEAD,
  FACE_PHOTO_MAX_LENGTH,
  faceCrop,
  guideCrop,
  isChibiHeadPart,
  isFacePhoto,
  landmarkBox,
  openFaceCamera,
  sanitizeHead,
  showsFaceHead,
  videoCrop,
} from "./facePhoto";
import { sanitizeProfile } from "./profile";

// Saved device choices live in localStorage, which plain Node doesn't have.
vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});

const PHOTO = `data:image/jpeg;base64,${"A".repeat(400)}==`;

describe("head settings", () => {
  it("accepts only small JPEG data URLs as photos", () => {
    expect(isFacePhoto(PHOTO)).toBe(true);
    expect(isFacePhoto("data:image/png;base64,AAAA")).toBe(false);
    expect(isFacePhoto("https://example.com/me.jpg")).toBe(false);
    expect(isFacePhoto(`data:image/jpeg;base64,${"A".repeat(FACE_PHOTO_MAX_LENGTH)}`)).toBe(false);
    expect(isFacePhoto(`data:image/jpeg;base64,${"A".repeat(100)}"><script>`)).toBe(false);
    expect(isFacePhoto(42)).toBe(false);
  });

  it("sanitizes anything into valid settings", () => {
    expect(sanitizeHead(undefined)).toEqual(DEFAULT_HEAD);
    expect(sanitizeHead({ headMode: "robot", facePhoto: "nope", liveFace: "yes" })).toEqual(
      DEFAULT_HEAD,
    );
    expect(sanitizeHead({ headMode: "face", facePhoto: PHOTO, liveFace: true, extra: 1 })).toEqual({
      headMode: "face",
      facePhoto: PHOTO,
      liveFace: true,
    });
  });

  it("migrates a v2 profile (no head) to the chibi head", () => {
    const v2 = { displayName: "  Ada  ", avatar: DEFAULT_AVATAR, savedAt: 123 };
    expect(sanitizeProfile(v2)).toEqual({
      displayName: "Ada",
      avatar: DEFAULT_AVATAR,
      savedAt: 123,
      ...DEFAULT_HEAD,
    });
    expect(sanitizeProfile(null).headMode).toBe("chibi");
  });

  it("wears the face head only with something to show", () => {
    const face = { headMode: "face", facePhoto: null, liveFace: true } as const;
    expect(showsFaceHead(face)).toBe(false);
    expect(showsFaceHead(face, true)).toBe(true);
    expect(showsFaceHead({ ...face, liveFace: false }, true)).toBe(false);
    expect(showsFaceHead({ ...face, facePhoto: PHOTO })).toBe(true);
    expect(showsFaceHead({ ...DEFAULT_HEAD, facePhoto: PHOTO }, true)).toBe(false);
  });
});

describe("chibi head parts", () => {
  it("hides the head, face, hair and head-worn extras but keeps the body and neckwear", () => {
    const config = {
      ...DEFAULT_AVATAR,
      accessories: ["glasses_round", "beanie", "earrings", "scarf", "backpack"],
      details: ["freckles"],
    } as typeof DEFAULT_AVATAR;
    const visible = resolveAvatar(config).visible;
    const hidden = visible.filter(isChibiHeadPart);
    expect(hidden).toEqual(
      expect.arrayContaining([
        "Head_Base",
        "Mouth_Base",
        "Acc_GlassesRound",
        "Acc_Beanie",
        "Acc_Earrings",
        "Detail_Freckles",
      ]),
    );
    expect(hidden.some((n) => n.startsWith("Eyes_"))).toBe(true);
    expect(hidden.some((n) => n.startsWith("Hair_"))).toBe(true);
    for (const kept of ["Body_Neck", "Acc_Scarf", "Acc_Backpack"])
      expect(hidden).not.toContain(kept);
    expect(visible.filter((n) => n.startsWith("Top_") || n.startsWith("Shoes_"))).toHaveLength(2);
    expect(visible.filter((n) => n.startsWith("Top_")).some(isChibiHeadPart)).toBe(false);
  });
});

describe("face crops", () => {
  it("boxes landmarks in pixels", () => {
    const box = landmarkBox(
      [
        { x: 0.4, y: 0.3 },
        { x: 0.6, y: 0.7 },
        { x: 0.5, y: 0.5 },
      ],
      1000,
      500,
    );
    expect(box!.x).toBeCloseTo(400);
    expect(box!.y).toBeCloseTo(150);
    expect(box!.width).toBeCloseTo(200);
    expect(box!.height).toBeCloseTo(200);
    expect(landmarkBox([], 100, 100)).toBeNull();
  });

  it("crops a square around the face with margin, nudged up for the hair", () => {
    const c = faceCrop({ x: 400, y: 200, width: 100, height: 120 }, 1280, 720);
    expect(c.size).toBe(204);
    expect(c.x + c.size / 2).toBeCloseTo(450, 0);
    expect(c.y + c.size / 2).toBeLessThan(260);
  });

  it("keeps the crop inside the frame", () => {
    const edge = faceCrop({ x: 0, y: 0, width: 200, height: 200 }, 640, 480);
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
    const huge = faceCrop({ x: 100, y: 0, width: 400, height: 470 }, 640, 480);
    expect(huge.size).toBe(480);
    expect(huge.x + huge.size).toBeLessThanOrEqual(640);
    expect(huge.y).toBe(0);
  });

  it("falls back to the guide circle's square, centred", () => {
    const g = guideCrop(1280, 720, 0.5);
    expect(g).toEqual({ x: 460, y: 180, size: 360 });
  });

  it("shows the central square of a video, mirrored on request", () => {
    const plain = videoCrop(640, 480, 1);
    expect(plain.repeat[0]).toBeCloseTo(0.75);
    expect(plain.repeat[1]).toBe(1);
    expect(plain.offset[0]).toBeCloseTo(0.125);
    const mirrored = videoCrop(640, 480, 1, true);
    // u = offset + uv * repeat: 0 → right edge of the square, 1 → left edge.
    expect(mirrored.offset[0] + 0 * mirrored.repeat[0]).toBeCloseTo(0.875);
    expect(mirrored.offset[0] + 1 * mirrored.repeat[0]).toBeCloseTo(0.125);
    const unknown = videoCrop(0, 0);
    expect(unknown.repeat.every(Number.isFinite)).toBe(true);
  });
});

describe("face photo camera", () => {
  const live = () => {
    const track = { readyState: "live", stop: () => (track.readyState = "ended") };
    return {
      track,
      stream: { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream,
    };
  };

  it("reuses expression tracking's live camera without asking again", async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const shared = live();
    const cam = await openFaceCamera(shared.stream);
    expect(cam.stream).toBe(shared.stream);
    cam.release();
    expect(shared.track.readyState).toBe("live");
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("otherwise opens the student's camera, and release closes it", async () => {
    const own = live();
    const getUserMedia = vi.fn(async () => own.stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    useDevicePrefs.setState({ cameraId: "cam-2" });
    const cam = await openFaceCamera(null);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: expect.objectContaining({ facingMode: "user", deviceId: { exact: "cam-2" } }),
    });
    cam.release();
    expect(own.track.readyState).toBe("ended");
  });
});
