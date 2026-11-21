"use client";

import type { ReactNode } from "react";
import { IconChevronDown, IconInfo, IconWarning } from "@/components/ui/icons";
import { FOCUS } from "@/components/ui/styles";
import type { DeviceOption } from "@/lib/devices/list";

/**
 * Pieces shared by the camera and microphone checks (components/devices/CameraCheck.tsx and
 * MicCheck.tsx), in the cartoon kit: a cream card with a walnut outline and a dashed inner line
 * like the member card, small status pills, a device picker and the notes under a check.
 */

/** One check: an icon badge, a title, a status pill on the right, then its content. */
export function CheckCard({
  id,
  icon,
  title,
  status,
  children,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  status: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="relative flex min-h-0 min-w-0 flex-col rounded-[24px] border-[3px] border-walnut bg-[#fbf3e2] p-5 text-walnut shadow-[0_7px_0_#1f1a16]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-2 rounded-[17px] border-2 border-dashed border-walnut/20"
      />
      <header className="relative flex items-center gap-3">
        <span
          aria-hidden
          className="grid h-11 w-11 shrink-0 -rotate-6 place-items-center rounded-[14px] border-[2.5px] border-walnut bg-sun text-walnut shadow-[0_3px_0_#1f1a16]"
        >
          {icon}
        </span>
        <h2 id={`${id}-title`} className="font-display text-[22px] leading-tight font-bold">
          {title}
        </h2>
        <span className="ml-auto">{status}</span>
      </header>
      <div className="relative mt-3 flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

export type PillTone = "live" | "good" | "plain" | "muted";

const PILL_TONE: Record<PillTone, string> = {
  live: "bg-surface",
  good: "bg-leaf",
  plain: "bg-sun",
  muted: "bg-canvas text-ink-soft",
};

/** A short state label ("On", "Sounds good", "Skipped"). The live one has the red "in use" dot. */
export function Pill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border-2 border-walnut px-2.5 py-0.5 font-display text-[12.5px] font-semibold whitespace-nowrap text-walnut shadow-[0_2px_0_#1f1a16] ${PILL_TONE[tone]}`}
    >
      {tone === "live" && (
        <span
          aria-hidden
          className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-walnut bg-red-500"
        />
      )}
      {children}
    </span>
  );
}

/** What the device is for, then the plain privacy line under it. */
export function Purpose({ children, privacy }: { children: ReactNode; privacy: ReactNode }) {
  return (
    <>
      <p className="text-[14.5px] leading-[1.35rem] font-medium text-ink-soft">{children}</p>
      <p className="mt-2 flex gap-2 rounded-[14px] border-2 border-walnut/20 bg-surface px-2.5 py-1.5 text-[12.5px] leading-[1.1rem] font-semibold text-walnut">
        <IconInfo size={16} strokeWidth={2.25} className="mt-px shrink-0" />
        <span>{privacy}</span>
      </p>
    </>
  );
}

/** Choose between devices of one kind (shown only when there is more than one). */
export function DevicePicker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: DeviceOption[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <label className="relative flex min-w-0 flex-1 items-center" title={label}>
      <span className="sr-only">{label}</span>
      <select
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        className={`h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-[12px] border-2 border-walnut bg-white pr-8 pl-3 font-display text-[13.5px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16] ${FOCUS}`}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <IconChevronDown
        size={16}
        strokeWidth={2.5}
        aria-hidden
        className="pointer-events-none absolute right-2.5 text-walnut"
      />
    </label>
  );
}

/** Something stopped a device: one friendly line (going in always still works). */
export function ProblemNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex gap-2 rounded-[14px] border-2 border-walnut bg-[#fde6d8] px-3 py-2 text-[13px] leading-5 font-semibold text-walnut">
      <IconWarning size={17} strokeWidth={2.5} className="mt-px shrink-0 text-danger" />
      <span>{children}</span>
    </p>
  );
}

/** The live area of a check (camera preview, microphone meter): one height for both cards. */
export const STAGE =
  "relative h-[clamp(8.5rem,24vh,13rem)] w-full shrink-0 overflow-hidden rounded-[18px] border-[3px] border-walnut";
