"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import {
  IconBook,
  IconCalendar,
  IconCheck,
  IconGraduationCap,
  IconInfo,
  IconLink,
  IconWarning,
} from "@/components/ui/icons";
import { BTN_SM, FOCUS, INPUT, LABEL, TAG } from "@/components/ui/styles";
import type { CircleRole, ItemKind } from "@/lib/circles/types";
import { KIND_LABEL, ROLE_CAN, ROLE_LABEL } from "./format";

/**
 * Small shared pieces for the Study Circle screens, in the cartoon kit (components/ui/styles.ts):
 * flat colours, walnut outlines, sticker shadows. Text always says what a colour means.
 */

/** A small button for destructive actions (Remove, Leave, Delete). */
export const BTN_SM_DANGER = `${BTN_SM.secondary.replace("text-walnut", "text-danger").replace("hover:bg-canvas", "hover:bg-[#fbe9e5]")}`;

/** A one-line message: info (sun), success (leaf) or a problem (danger). */
export function Notice({
  tone = "info",
  children,
  className = "",
}: {
  tone?: "info" | "success" | "error";
  children: ReactNode;
  className?: string;
}) {
  const dot = {
    info: "bg-sun text-walnut",
    success: "bg-leaf text-walnut",
    error: "bg-[#fbe9e5] text-danger",
  }[tone];
  const Icon = tone === "error" ? IconWarning : tone === "success" ? IconCheck : IconInfo;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`flex items-start gap-2.5 rounded-[16px] border-2 border-walnut bg-surface px-3.5 py-2.5 text-[14px] leading-5 font-semibold text-walnut shadow-[0_3px_0_#1f1a16] ${className}`}
    >
      <span
        aria-hidden
        className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 border-walnut ${dot}`}
      >
        <Icon size={12} strokeWidth={2.5} />
      </span>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

const ROLE_TAG: Record<CircleRole, string> = {
  owner: TAG.brass,
  editor: TAG.forest,
  viewer: TAG.neutral,
};

/** A role as a sticker, with what it allows on hover. */
export function RoleTag({ role }: { role: CircleRole }) {
  return (
    <span title={ROLE_CAN[role]} className={`${ROLE_TAG[role]} shrink-0 leading-4`}>
      {ROLE_LABEL[role]}
    </span>
  );
}

const KIND_ICON: Record<ItemKind, typeof IconLink> = {
  resource: IconLink,
  lesson: IconGraduationCap,
  plan: IconCalendar,
  note: IconBook,
};
const KIND_COLOUR: Record<ItemKind, string> = {
  resource: "bg-sun",
  lesson: "bg-leaf",
  plan: "bg-tangerine",
  note: "bg-surface",
};

/** The round sticker an item's kind sits in (the label beside it says the kind in words). */
export function KindDot({ kind, size = 40 }: { kind: ItemKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return (
    <span
      aria-hidden
      title={KIND_LABEL[kind]}
      style={{ width: size, height: size }}
      className={`grid shrink-0 place-items-center rounded-full border-[2.5px] border-walnut text-walnut shadow-[0_3px_0_#1f1a16] ${KIND_COLOUR[kind]}`}
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={2.1} />
    </span>
  );
}

/** A member's initial in a round badge. */
export function Initial({ name, me = false }: { name: string; me?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 border-walnut font-display text-[15px] leading-none font-bold text-walnut uppercase ${me ? "bg-leaf" : "bg-surface"}`}
    >
      {name.trim().slice(0, 1) || "?"}
    </span>
  );
}

/**
 * A button that asks before it acts: the first press shows the question with a confirm and a
 * cancel button (focus moves to the confirm). Errors are the caller's to show.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel,
  onConfirm,
  disabled = false,
  icon,
}: {
  label: string;
  question: string;
  confirmLabel: string;
  onConfirm: () => Promise<unknown>;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);

  if (!asking)
    return (
      <button
        ref={openerRef}
        type="button"
        disabled={disabled}
        onClick={() => setAsking(true)}
        className={BTN_SM_DANGER}
      >
        {icon}
        {label}
      </button>
    );

  const cancel = () => {
    setAsking(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  };

  return (
    <div
      role="group"
      aria-labelledby={questionId}
      className="flex flex-wrap items-center gap-2 rounded-[14px] border-2 border-dashed border-walnut/40 bg-canvas px-2.5 py-2"
      onKeyDown={(e) => {
        if (e.key === "Escape") cancel();
      }}
    >
      <span id={questionId} className="text-[13.5px] leading-5 font-semibold text-walnut">
        {question}
      </span>
      <span className="flex gap-1.5">
        <button
          ref={confirmRef}
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
            } finally {
              setBusy(false);
              setAsking(false);
            }
          }}
          className={BTN_SM_DANGER}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
        <button type="button" disabled={busy} onClick={cancel} className={BTN_SM.quiet}>
          Cancel
        </button>
      </span>
    </div>
  );
}

/** A labelled text input, with a character count once it's near its limit. */
export function TextField({
  label,
  value,
  onChange,
  max,
  type = "text",
  placeholder,
  required = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  type?: "text" | "url";
  placeholder?: string;
  required?: boolean;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className={`${LABEL} block`}>
        {label}
        {!required && <span className="font-medium text-ink-soft"> (optional)</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        maxLength={max}
        required={required}
        placeholder={placeholder}
        aria-describedby={hint ? `${id}-hint` : undefined}
        onChange={(e) => onChange(e.target.value)}
        className={INPUT}
      />
      {hint && (
        <p id={`${id}-hint`} className="text-[13px] leading-5 font-medium text-ink-soft">
          {hint}
        </p>
      )}
    </div>
  );
}

/** A labelled textarea with a live character count. */
export function TextArea({
  label,
  value,
  onChange,
  max,
  rows = 4,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  rows?: number;
  placeholder?: string;
  required?: boolean;
}) {
  const id = useId();
  const near = value.length > max * 0.8;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className={LABEL}>
          {label}
          {!required && <span className="font-medium text-ink-soft"> (optional)</span>}
        </label>
        <span
          id={`${id}-count`}
          className={`tabular text-[12.5px] font-semibold ${near ? "text-walnut" : "text-ink-soft"}`}
        >
          {value.length.toLocaleString("en")} / {max.toLocaleString("en")}
        </span>
      </div>
      <textarea
        id={id}
        value={value}
        rows={rows}
        maxLength={max}
        required={required}
        placeholder={placeholder}
        aria-describedby={`${id}-count`}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT} h-auto resize-y py-2.5 leading-6`}
      />
    </div>
  );
}

/** A styled native select (keyboard and screen readers get the real thing). */
export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled = false,
  hideLabel = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  hideLabel?: boolean;
}) {
  const id = useId();
  return (
    <div className={hideLabel ? "" : "space-y-1.5"}>
      <label htmlFor={id} className={hideLabel ? "sr-only" : `${LABEL} block`}>
        {label}
      </label>
      <select
        id={id}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value as T)}
        className={`h-9 rounded-[12px] border-2 border-walnut bg-surface px-2.5 font-display text-[13.5px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16] disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A section's heading (h2), with an optional line under it and something on the right. */
export function SectionHeading({
  id,
  title,
  sub,
  aside,
}: {
  id?: string;
  title: string;
  sub?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h2 id={id} className="font-display text-[19px] leading-6 font-semibold text-walnut">
          {title}
        </h2>
        {sub && <p className="mt-0.5 text-[13.5px] leading-5 font-medium text-ink-soft">{sub}</p>}
      </div>
      {aside}
    </div>
  );
}

/** Placeholder shapes while a list loads. */
export function LoadingBlocks({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          aria-hidden
          className="h-24 rounded-[24px] border-[3px] border-walnut/15 bg-surface-muted motion-safe:animate-pulse"
        />
      ))}
    </div>
  );
}
