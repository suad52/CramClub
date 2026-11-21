"use client";

import { useSyncExternalStore } from "react";
import { IconInfo } from "@/components/ui/icons";

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
      className={`flex gap-3 rounded-[18px] border-[3px] border-walnut bg-canvas px-4 py-3 text-sm leading-6 font-medium text-ink-soft shadow-[0_4px_0_#1f1a16] ${className}`}
    >
      <span
        aria-hidden
        className="mt-0.5 grid h-7 w-7 shrink-0 -rotate-6 place-items-center rounded-full border-2 border-walnut bg-sun text-walnut shadow-[0_2px_0_#1f1a16]"
      >
        <IconInfo size={16} strokeWidth={2.5} />
      </span>
      <span>
        <strong className="font-display font-semibold text-walnut">
          OVR is built for a computer with a keyboard and mouse.
        </strong>{" "}
        Phones and tablets aren&apos;t supported yet, so the library may be hard to move around in
        on this device.
      </span>
    </p>
  );
}
