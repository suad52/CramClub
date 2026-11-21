import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDevicePrefs } from "@/lib/devices/prefs";
import {
  getCameraStream,
  startTracking,
  stopTracking,
  turnCameraOff,
  turnCameraOn,
  useTrackingStore,
} from "./tracker";

/**
 * The tracker against a fake browser: getUserMedia hands out fake streams when a test says so,
 * the face model loads instantly (or when a test says so) and no frame is ever analysed. What
 * matters here is which cameras end up running, and what gets remembered.
 */

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}

const fake = vi.hoisted(() => {
  const data = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  });
  return {
    /** Each face model made: whether it was closed. */
    models: [] as { closed: boolean }[],
    /** When set, the next face model waits for this. */
    modelGate: null as Promise<void> | null,
  };
});

vi.mock("@mediapipe/tasks-vision", () => ({
  FilesetResolver: { forVisionTasks: async () => ({}) },
  FaceLandmarker: {
    createFromOptions: async () => {
      const gate = fake.modelGate;
      fake.modelGate = null;
      if (gate) await gate;
      const model = { closed: false };
      fake.models.push(model);
      return {
        close: () => (model.closed = true),
        detectForVideo: () => ({ faceBlendshapes: [], facialTransformationMatrixes: [] }),
      };
    },
  },
}));

interface FakeStream extends MediaStream {
  live: () => boolean;
}
function fakeStream(): FakeStream {
  const track = { readyState: "live", stop: () => (track.readyState = "ended") };
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track],
    live: () => track.readyState === "live",
  } as unknown as FakeStream;
}

const named = (name: string) => Object.assign(new Error(name), { name });
const flush = () => new Promise((r) => setTimeout(r, 0));

let asks: Deferred<MediaStream>[];
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  asks = [];
  fake.models = [];
  getUserMedia = vi.fn(() => {
    const d = deferred<MediaStream>();
    asks.push(d);
    return d.promise;
  });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("document", {
    createElement: () => ({ play: async () => {}, pause: () => {}, srcObject: null }),
  });
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  useDevicePrefs.setState({ camera: null, mic: null, cameraId: null, micId: null });
});

afterEach(() => stopTracking());

describe("expression tracking camera", () => {
  it("opens the camera the student picked", async () => {
    useDevicePrefs.getState().setCameraId("cam-2");
    const on = startTracking();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: expect.objectContaining({ facingMode: "user", deviceId: { exact: "cam-2" } }),
    });
    const cam = fakeStream();
    asks[0]!.resolve(cam);
    await on;
    expect(getCameraStream()).toBe(cam);
    expect(useTrackingStore.getState().status).toBe("calibrating");
  });

  it("a quick on, off, on leaves exactly one camera running, and off stops it", async () => {
    const first = startTracking();
    stopTracking();
    const second = startTracking();
    expect(asks).toHaveLength(2);
    const a = fakeStream();
    const b = fakeStream();
    // The first camera arrives after it was already switched off.
    asks[0]!.resolve(a);
    asks[1]!.resolve(b);
    await Promise.all([first, second]);
    expect(a.live()).toBe(false);
    expect(b.live()).toBe(true);
    expect(getCameraStream()).toBe(b);
    expect(fake.models.filter((m) => !m.closed)).toHaveLength(1);

    stopTracking();
    expect(b.live()).toBe(false);
    expect(getCameraStream()).toBeNull();
    expect(fake.models.every((m) => m.closed)).toBe(true);
    expect(useTrackingStore.getState().status).toBe("off");
  });

  it("switching off while the face model loads closes the camera and the model", async () => {
    let openGate!: () => void;
    fake.modelGate = new Promise<void>((r) => (openGate = r));
    const on = startTracking();
    const cam = fakeStream();
    asks[0]!.resolve(cam);
    await flush();
    expect(getCameraStream()).toBe(cam); // the preview can already show it
    stopTracking();
    expect(cam.live()).toBe(false);
    openGate();
    await on;
    expect(fake.models).toHaveLength(1);
    expect(fake.models[0]!.closed).toBe(true);
    expect(useTrackingStore.getState().status).toBe("off");
  });

  it("a start that fails late doesn't break a newer one", async () => {
    const first = startTracking();
    stopTracking();
    const second = startTracking();
    asks[0]!.reject(named("NotReadableError"));
    const b = fakeStream();
    asks[1]!.resolve(b);
    await Promise.all([first, second]);
    expect(useTrackingStore.getState()).toMatchObject({ status: "calibrating", error: null });
    expect(b.live()).toBe(true);
  });

  it("explains a blocked camera and leaves nothing running", async () => {
    const on = startTracking();
    asks[0]!.reject(named("NotAllowedError"));
    await on;
    expect(useTrackingStore.getState().status).toBe("error");
    expect(useTrackingStore.getState().error).toMatch(/blocked/);
    expect(getCameraStream()).toBeNull();
  });
});

describe("remembering the camera choice", () => {
  it("turning the camera on from the world remembers on, once it works", async () => {
    const on = turnCameraOn();
    expect(useDevicePrefs.getState().camera).toBeNull();
    asks[0]!.resolve(fakeStream());
    await on;
    expect(useDevicePrefs.getState().camera).toBe("on");
  });

  it("turning it off from the world remembers off", async () => {
    useDevicePrefs.getState().setCamera("on");
    const on = startTracking();
    const cam = fakeStream();
    asks[0]!.resolve(cam);
    await on;
    turnCameraOff();
    expect(cam.live()).toBe(false);
    expect(useDevicePrefs.getState().camera).toBe("off");
  });

  it("a blocked camera remembers nothing", async () => {
    useDevicePrefs.getState().setCamera("off");
    const on = turnCameraOn();
    asks[0]!.reject(named("NotAllowedError"));
    await on;
    expect(useTrackingStore.getState().status).toBe("error");
    expect(useDevicePrefs.getState().camera).toBe("off");
  });

  it("switched off before it finished starting: remembers off, not on", async () => {
    const on = turnCameraOn();
    turnCameraOff();
    asks[0]!.resolve(fakeStream());
    await on;
    expect(useDevicePrefs.getState().camera).toBe("off");
  });

  it("leaving the library (stopTracking) keeps the saved choice", async () => {
    useDevicePrefs.getState().setCamera("on");
    const on = startTracking();
    asks[0]!.resolve(fakeStream());
    await on;
    stopTracking();
    expect(useDevicePrefs.getState().camera).toBe("on");
  });
});
