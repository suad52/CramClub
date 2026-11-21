"use client";

import { FOCUS } from "@/components/ui/styles";
import { useAccount } from "@/lib/auth/useAccount";
import type { ItemKind } from "@/lib/library/types";

/**
 * Small shared pieces of the personal library, in the cartoon look (components/ui/styles.ts;
 * gold standard: components/entry/TitleScreen.tsx).
 */

/** Where the library can be used from here: decided by GET /api/account (no tokens reach us). */
export type LibraryAccess = "loading" | "error" | "off" | "signed-out" | "signed-in";

export function useLibraryAccess(): LibraryAccess {
  const { status, account } = useAccount();
  if (status !== "ready") return status;
  if (!account.configured) return "off";
  return account.signedIn ? "signed-in" : "signed-out";
}

/** The hint for a library control while sign-in isn't set up on this server. */
export const OFF_HINT =
  "Sign-in isn't set up yet, so the private library is off. Everything else still works.";

/** A small control that can't be used right now: dashed outline, still focusable for its hint. */
export const OFF_SM = `inline-flex h-9 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-[12px] border-2 border-dashed border-walnut/45 bg-surface px-3 font-display text-[13.5px] font-semibold whitespace-nowrap text-ink-soft ${FOCUS}`;

/** An inline text link (tangerine underline), as in the Learning Studio. */
export const TEXT_LINK = `rounded-[6px] font-display font-semibold text-walnut underline decoration-tangerine decoration-[2.5px] underline-offset-[4px] transition-colors duration-150 hover:decoration-walnut ${FOCUS}`;

/** A padlock in the icon set's style (24px grid, 1.75 stroke, currentColor). */
export function IconLock({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  );
}

/** "Private": only you can see this (the words say it; the lock is decoration). */
export function PrivateBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Only you can see this"
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border-2 border-walnut bg-canvas px-2 py-px font-display text-[12px] leading-5 font-semibold text-walnut ${className}`}
    >
      <IconLock size={12} />
      Private
    </span>
  );
}

export const KIND_LABELS: Record<ItemKind, string> = {
  resource: "Link",
  lesson: "Lesson",
  plan: "Study plan",
  note: "Note",
};

export const KIND_TONES: Record<ItemKind, string> = {
  resource: "bg-sun",
  lesson: "bg-leaf",
  plan: "bg-tangerine",
  note: "bg-lamp",
};

/** A small label on a card's top edge, in a colour of its own. */
export const EDGE_TAG =
  "inline-flex items-center gap-1 rounded-full border-2 border-walnut px-2.5 py-px font-display text-[12px] font-semibold text-walnut shadow-[0_2px_0_#1f1a16]";

/** A cream sticker card for one saved thing. */
export const ITEM_CARD =
  "relative rounded-[20px] border-[2.5px] border-walnut bg-surface px-4 pt-5 pb-4 shadow-[0_4px_0_#1f1a16]";

/** A calm "nothing here yet" box. */
export const EMPTY =
  "rounded-[20px] border-2 border-dashed border-walnut/35 bg-canvas px-4 py-4 text-[15px] leading-6 font-medium text-ink-soft";

/** An inline error line under a control. */
export const ERROR_LINE = "text-[13px] leading-5 font-semibold text-danger";

/** A chunky progress bar (decorative: the words beside it say the same). */
export function ProgressBar({ value, className = "" }: { value: number; className?: string }) {
  const share = Math.min(1, Math.max(0, value));
  return (
    <span
      aria-hidden
      className={`block h-3.5 overflow-hidden rounded-full border-[2.5px] border-walnut bg-canvas ${className}`}
    >
      <span
        className={`block h-full rounded-full bg-leaf transition-[width] duration-500 ease-out motion-reduce:transition-none ${share > 0 && share < 1 ? "border-r-[2.5px] border-walnut" : ""}`}
        style={{ width: `${Math.round(share * 100)}%` }}
      />
    </span>
  );
}

/** A small spinner for buttons and status lines. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-4 w-4 shrink-0 rounded-full border-[2.5px] border-walnut/20 border-t-tangerine motion-safe:animate-spin ${className}`}
    />
  );
}

/** "21 Nov 2026". */
export function shortDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
