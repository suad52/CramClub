"use client";

import { usePathname } from "next/navigation";
import { useId } from "react";
import { IconLeave, IconUser } from "@/components/ui/icons";
import { BTN_SM, FOCUS } from "@/components/ui/styles";
import { LOGOUT_HREF, loginHref } from "@/lib/auth/links";
import { useAccount } from "@/lib/auth/useAccount";

/** A chip that can't be used right now: dashed outline, still focusable so its hint is heard. */
const CHIP_OFF = `inline-flex h-9 shrink-0 cursor-not-allowed items-center gap-1.5 rounded-[12px] border-2 border-dashed border-walnut/45 bg-surface px-3 font-display text-[13.5px] font-semibold whitespace-nowrap text-ink-soft ${FOCUS}`;

/**
 * The header's account control. Signed out: "Sign in" (Auth0's page, then back here). Signed in:
 * an initial badge with the name and "Sign out". While sign-in isn't set up it says so, disabled.
 */
export function AccountChip() {
  const { status, account } = useAccount();
  const pathname = usePathname();
  const hintId = useId();

  if (status === "loading")
    return (
      <span
        aria-hidden
        className="h-9 w-[86px] shrink-0 animate-pulse rounded-[12px] border-2 border-walnut/15 bg-canvas motion-reduce:animate-none"
      />
    );

  if (status === "error" || !account.configured) {
    const hint =
      status === "error"
        ? "Couldn't check sign-in. Refresh the page to try again."
        : "Sign-in isn't set up on this server yet. Your progress stays in this browser.";
    return (
      <>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={hintId}
          title={hint}
          className={CHIP_OFF}
        >
          <IconUser size={16} />
          {status === "error" ? (
            "Sign in"
          ) : (
            <>
              <span className="xl:hidden">Sign in</span>
              <span className="hidden xl:inline">Sign-in isn&apos;t set up yet</span>
            </>
          )}
        </button>
        <span id={hintId} className="sr-only">
          {hint}
        </span>
      </>
    );
  }

  if (!account.signedIn)
    return (
      <a href={loginHref(pathname)} className={BTN_SM.secondary}>
        <IconUser size={16} />
        Sign in
      </a>
    );

  const name = account.displayName ?? "Reader";
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span
        title={`Signed in as ${name}`}
        className="inline-flex h-9 items-center gap-2 rounded-full border-2 border-walnut bg-leaf py-0.5 pr-1 pl-1 font-display text-[13.5px] font-semibold text-walnut xl:pr-3"
      >
        <span
          aria-hidden
          className="grid h-7 w-7 place-items-center rounded-full border-2 border-walnut bg-surface text-[13px] leading-none font-bold uppercase"
        >
          {name.slice(0, 1)}
        </span>
        <span className="sr-only">Signed in as </span>
        <span className="sr-only max-w-[10rem] truncate xl:not-sr-only">{name}</span>
      </span>
      <a href={LOGOUT_HREF} className={BTN_SM.quiet}>
        <IconLeave size={16} />
        <span className="sr-only sm:not-sr-only">Sign out</span>
      </a>
    </div>
  );
}
