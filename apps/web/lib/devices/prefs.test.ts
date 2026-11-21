import { beforeEach, describe, expect, it, vi } from "vitest";
import { openMedia, useDevicePrefs } from "./prefs";

// The store persists to localStorage, which plain Node doesn't have: an in-memory one stands in.
// (vi.hoisted runs before the imports above.)
const saved = vi.hoisted(() => {
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
  return data;
});

const named = (name: string) => Object.assign(new Error(name), { name });
const STREAM = { id: "stream" } as unknown as MediaStream;

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn(async () => STREAM);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  useDevicePrefs.setState({
    camera: null,
    mic: null,
    cameraId: null,
    micId: null,
    setupDoneAt: null,
  });
});

describe("openMedia", () => {
  it("asks for the default device when none is saved", async () => {
    const base = { facingMode: "user", width: { ideal: 640 } };
    await expect(openMedia("camera", base)).resolves.toBe(STREAM);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: base });
  });

  it("asks for the saved camera, and keeps it when it opens", async () => {
    useDevicePrefs.getState().setCameraId("cam-2");
    await expect(openMedia("camera", { facingMode: "user" })).resolves.toBe(STREAM);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: "user", deviceId: { exact: "cam-2" } },
    });
    expect(useDevicePrefs.getState().cameraId).toBe("cam-2");
  });

  it("falls back to the default camera and forgets a saved one that's gone", async () => {
    useDevicePrefs.getState().setCameraId("unplugged");
    getUserMedia.mockRejectedValueOnce(named("OverconstrainedError"));
    await expect(openMedia("camera", { facingMode: "user" })).resolves.toBe(STREAM);
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { facingMode: "user" },
    });
    expect(useDevicePrefs.getState().cameraId).toBeNull();
  });

  it("does the same for a saved microphone that isn't found", async () => {
    useDevicePrefs.getState().setMicId("old-mic");
    getUserMedia.mockRejectedValueOnce(named("NotFoundError"));
    const base = { echoCancellation: true };
    await expect(openMedia("mic", base)).resolves.toBe(STREAM);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: { echoCancellation: true, deviceId: { exact: "old-mic" } },
      video: false,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: base, video: false });
    expect(useDevicePrefs.getState().micId).toBeNull();
  });

  it("passes a blocked permission straight through and keeps the saved device", async () => {
    useDevicePrefs.getState().setCameraId("cam-2");
    getUserMedia.mockRejectedValueOnce(named("NotAllowedError"));
    await expect(openMedia("camera")).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(useDevicePrefs.getState().cameraId).toBe("cam-2");
  });

  it("passes a blocked permission through with no device saved, without retrying", async () => {
    getUserMedia.mockRejectedValueOnce(named("NotAllowedError"));
    await expect(openMedia("mic")).rejects.toMatchObject({ name: "NotAllowedError" });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("only touches the kind it opened", async () => {
    useDevicePrefs.setState({ cameraId: "cam-2", micId: "mic-2" });
    getUserMedia.mockRejectedValueOnce(named("OverconstrainedError"));
    await openMedia("mic");
    expect(useDevicePrefs.getState()).toMatchObject({ cameraId: "cam-2", micId: null });
  });

  it("says NotSupportedError where the browser can't share devices", async () => {
    vi.stubGlobal("navigator", {});
    await expect(openMedia("camera")).rejects.toMatchObject({ name: "NotSupportedError" });
  });
});

describe("device prefs", () => {
  it("remember only the choices and device ids", () => {
    const s = useDevicePrefs.getState();
    s.setCamera("on");
    s.setMic("ok");
    s.setCameraId("cam-2");
    s.markSetupDone();
    const stored = JSON.parse(saved.get("ovr.devices") ?? "{}") as { state: object };
    expect(Object.keys(stored.state).sort()).toEqual(
      ["camera", "cameraId", "mic", "micId", "setupDoneAt"].sort(),
    );
    expect(stored.state).toMatchObject({ camera: "on", mic: "ok", cameraId: "cam-2" });
  });
});
