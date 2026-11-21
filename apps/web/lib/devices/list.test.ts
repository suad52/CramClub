import { describe, expect, it } from "vitest";
import { type DeviceInfo, cleanLabel, deviceCount, deviceOptions, selectedOption } from "./list";

const dev = (
  kind: MediaDeviceKind,
  deviceId: string,
  label = "",
  groupId = deviceId,
): DeviceInfo => ({
  kind,
  deviceId,
  label,
  groupId,
});

// What Chrome lists once the page may use both: a "default" stand-in repeating a real mic.
const CHROME: DeviceInfo[] = [
  dev("audioinput", "default", "Default - MacBook Pro Microphone (Built-in)", "g-mac"),
  dev("audioinput", "mic-mac", "MacBook Pro Microphone (Built-in)", "g-mac"),
  dev("audioinput", "mic-usb", "Yeti Stereo Microphone (046d:0ab7)", "g-yeti"),
  dev("videoinput", "cam-mac", "FaceTime HD Camera (05ac:8514)", "g-cam"),
  dev("audiooutput", "default", "Default - MacBook Pro Speakers", "g-spk"),
];

describe("cleanLabel", () => {
  it("drops Chrome's USB id suffix", () => {
    expect(cleanLabel("FaceTime HD Camera (05ac:8514)")).toBe("FaceTime HD Camera");
    expect(cleanLabel("  Studio Display Camera ")).toBe("Studio Display Camera");
    expect(cleanLabel("Mic (USB Audio)")).toBe("Mic (USB Audio)");
  });
});

describe("deviceOptions", () => {
  it("lists real devices of one kind once each, without the default stand-in", () => {
    expect(deviceOptions(CHROME, "mic")).toEqual([
      { id: "mic-mac", label: "MacBook Pro Microphone (Built-in)" },
      { id: "mic-usb", label: "Yeti Stereo Microphone" },
    ]);
    expect(deviceOptions(CHROME, "camera")).toEqual([
      { id: "cam-mac", label: "FaceTime HD Camera" },
    ]);
  });

  it("is empty before permission (blank ids) and names unnamed devices", () => {
    const before = [dev("videoinput", ""), dev("audioinput", "")];
    expect(deviceOptions(before, "camera")).toEqual([]);
    expect(deviceCount(before, "camera")).toBe(1);
    expect(deviceCount([], "mic")).toBe(0);
    expect(deviceOptions([dev("videoinput", "a"), dev("videoinput", "b")], "camera")).toEqual([
      { id: "a", label: "Camera 1" },
      { id: "b", label: "Camera 2" },
    ]);
  });

  it("skips repeats and Windows' communications stand-in", () => {
    const list = [
      dev("audioinput", "communications", "Communications - Headset"),
      dev("audioinput", "x", "Headset"),
      dev("audioinput", "x", "Headset"),
    ];
    expect(deviceOptions(list, "mic")).toEqual([{ id: "x", label: "Headset" }]);
  });
});

describe("selectedOption", () => {
  it("shows the open device, matching Chrome's default stand-in by group", () => {
    expect(selectedOption(CHROME, "mic", "mic-usb", null)).toBe("mic-usb");
    expect(selectedOption(CHROME, "mic", "default", "mic-usb")).toBe("mic-mac");
  });

  it("falls back to the saved device, then the first", () => {
    expect(selectedOption(CHROME, "mic", null, "mic-usb")).toBe("mic-usb");
    expect(selectedOption(CHROME, "mic", "gone", "also-gone")).toBe("mic-mac");
    expect(selectedOption([], "camera", null, null)).toBeNull();
  });
});
