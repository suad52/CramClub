"use client";

import {
  getCameraStream,
  recalibrate,
  startTracking,
  stopTracking,
  useTrackingStore,
} from "@/lib/facial-tracking/tracker";

/** UI-facing access to expression tracking: status plus the actions to control it. */
export function useFaceTracking() {
  const status = useTrackingStore((s) => s.status);
  const error = useTrackingStore((s) => s.error);
  const calibration = useTrackingStore((s) => s.calibration);
  return {
    status,
    error,
    calibration,
    active: status !== "off" && status !== "error",
    start: startTracking,
    stop: stopTracking,
    recalibrate,
    getCameraStream,
  };
}
