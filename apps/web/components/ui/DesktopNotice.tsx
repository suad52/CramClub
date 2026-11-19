"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(hover: none) and (pointer: coarse)";

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** True on touch-only devices (phones, most tablets). False during server rendering. */
export function useIsTouchOnly() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}

/** Tells phone/tablet visitors the library needs a keyboard and mouse for now. */
export function DesktopNotice({ className = "" }: { className?: string }) {
  const touchOnly = useIsTouchOnly();
  if (!touchOnly) return null;
  return (
    <p
      role="note"
      className={`rounded-2xl border border-ember/30 bg-ember/10 px-4 py-3 text-sm text-ink ${className}`}
    >
      OVR is built for a computer with a keyboard and mouse. Phones and tablets aren&apos;t
      supported yet, so the library may be hard to move around in on this device.
    </p>
  );
}
