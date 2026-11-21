import { create } from "zustand";
import type { MediaKind } from "./prefs";

/**
 * The cameras and microphones on this computer, for the setup step's pickers. Browsers hide
 * device ids and names until the page has been allowed to use that kind of device once, so the
 * lists fill in after the first camera or microphone opens (call refreshDevices() then). Labels
 * are shown, never stored.
 */

/** Just the MediaDeviceInfo fields used here (so the pure parts test without a browser). */
export type DeviceInfo = Pick<MediaDeviceInfo, "deviceId" | "groupId" | "kind" | "label">;

export interface DeviceOption {
  id: string;
  label: string;
}

const BROWSER_KIND: Record<MediaKind, MediaDeviceKind> = {
  camera: "videoinput",
  mic: "audioinput",
};

/** Chrome's stand-ins for "whatever the system uses", which repeat a real device. */
const PSEUDO_IDS = new Set(["default", "communications"]);

/** Drops the USB vendor:product suffix Chrome adds, e.g. "FaceTime HD Camera (05ac:8514)". */
export function cleanLabel(label: string): string {
  return label.replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, "").trim();
}

/**
 * The real devices of one kind, once each, in the browser's order. A device with no id yet
 * (before permission) is left out, so the list is empty until the browser shares it.
 */
export function deviceOptions(devices: readonly DeviceInfo[], kind: MediaKind): DeviceOption[] {
  const want = BROWSER_KIND[kind];
  const seen = new Set<string>();
  const out: DeviceOption[] = [];
  for (const d of devices) {
    if (d.kind !== want || !d.deviceId || PSEUDO_IDS.has(d.deviceId) || seen.has(d.deviceId))
      continue;
    seen.add(d.deviceId);
    const n = out.length + 1;
    out.push({
      id: d.deviceId,
      label: cleanLabel(d.label) || `${kind === "camera" ? "Camera" : "Microphone"} ${n}`,
    });
  }
  return out;
}

/** How many devices of this kind the browser admits to (before permission, ids are blank). */
export function deviceCount(devices: readonly DeviceInfo[], kind: MediaKind): number {
  const want = BROWSER_KIND[kind];
  return devices.filter((d) => d.kind === want && !PSEUDO_IDS.has(d.deviceId)).length;
}

/**
 * Which option a picker should show as chosen: the device that's open right now (Chrome reports
 * its "default" stand-in, matched to the real device by group), else the saved one, else the
 * first. Null when there's nothing to pick.
 */
export function selectedOption(
  devices: readonly DeviceInfo[],
  kind: MediaKind,
  openId: string | null,
  savedId: string | null,
): string | null {
  const options = deviceOptions(devices, kind);
  if (!options.length) return null;
  const has = (id: string | null) => !!id && options.some((o) => o.id === id);
  if (has(openId)) return openId;
  if (openId && PSEUDO_IDS.has(openId)) {
    const want = BROWSER_KIND[kind];
    const group = devices.find((d) => d.kind === want && d.deviceId === openId)?.groupId;
    const real = group
      ? devices.find((d) => d.kind === want && d.groupId === group && !PSEUDO_IDS.has(d.deviceId))
      : undefined;
    if (real && has(real.deviceId)) return real.deviceId;
  }
  if (has(savedId)) return savedId;
  return options[0]!.id;
}

interface DeviceListState {
  devices: DeviceInfo[];
  /** enumerateDevices has answered at least once. */
  listed: boolean;
}

export const useDeviceList = create<DeviceListState>(() => ({ devices: [], listed: false }));

/** Asks the browser for the current list (best effort: a failure keeps the last one). */
export async function refreshDevices(): Promise<void> {
  try {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
      useDeviceList.setState({ listed: true });
      return;
    }
    const list = await navigator.mediaDevices.enumerateDevices();
    useDeviceList.setState({
      listed: true,
      devices: list.map((d) => ({
        deviceId: d.deviceId,
        groupId: d.groupId,
        kind: d.kind,
        label: d.label,
      })),
    });
  } catch {
    useDeviceList.setState({ listed: true });
  }
}

let watchers = 0;
const onChange = () => void refreshDevices();

/**
 * Keeps useDeviceList current while anything shows a picker: lists once now, then again whenever
 * a device is plugged in or out. Returns the unwatch (the listener goes when the last one does).
 */
export function watchDevices(): () => void {
  void refreshDevices();
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (watchers++ === 0) md?.addEventListener?.("devicechange", onChange);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (--watchers === 0) md?.removeEventListener?.("devicechange", onChange);
  };
}
