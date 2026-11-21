"use client";

import Link from "next/link";
import { type ReactNode, useId } from "react";
import { StateCard } from "@/components/progress/ui";
import { IconUser } from "@/components/ui/icons";
import { BTN, FOCUS } from "@/components/ui/styles";
import { loginHref } from "@/lib/auth/links";
import { refreshAccount, useAccount } from "@/lib/auth/useAccount";
import { LoadingBlocks } from "./ui";

/** A main button that can't be used yet: dashed, still focusable so its hint is read out. */
const BTN_OFF = `inline-flex h-11 shrink-0 cursor-not-allowed items-center gap-2 rounded-[14px] border-[3px] border-dashed border-walnut/45 bg-surface px-5 font-display text-[15px] font-semibold text-ink-soft ${FOCUS}`;

/** Sign-in isn't set up on this server (no Auth0 keys): say so calmly, and what still works. */
export function SignInNotSetUp() {
  const hintId = useId();
  return (
    <StateCard
      title="Sign-in isn't set up yet"
      action={
        <>
          <button type="button" aria-disabled="true" aria-describedby={hintId} className={BTN_OFF}>
            <IconUser size={18} />
            Sign-in isn&apos;t set up yet
          </button>
          <Link href="/" className={BTN.secondary}>
            Back to the library
          </Link>
        </>
      }
    >
      <span id={hintId}>
        Study Circles are shared with other students, so each person needs an account. Once this
        server&apos;s Auth0 keys are added (see docs/auth0.md), you can sign in and start one.
        Everything else in the library works as usual.
      </span>
    </StateCard>
  );
}

/** Signed out: what circles are, and the way in (Auth0's page, then back here). */
export function SignInToContinue({
  returnTo,
  invite = false,
}: {
  returnTo: string;
  invite?: boolean;
}) {
  return (
    <StateCard
      title={invite ? "Sign in to accept this invite" : "Sign in to use Study Circles"}
      action={
        <a href={loginHref(returnTo)} className={BTN.primary}>
          <IconUser size={18} />
          Sign in
        </a>
      }
    >
      {invite
        ? "Circles are tied to your account, so the library knows it's you who joined. You'll come straight back here afterwards."
        : "A circle is a shared shelf for a study group: links, notes, study plans and lessons, with roles for who can add. Sign in so the library knows which circles are yours."}
    </StateCard>
  );
}

/**
 * Shows `children` only to a signed-in student; otherwise the right state for why not. The server
 * checks again on every request: this only picks what to show.
 */
export function AccountGate({
  returnTo,
  invite = false,
  children,
}: {
  returnTo: string;
  invite?: boolean;
  children: ReactNode;
}) {
  const { status, account } = useAccount();
  if (status === "loading") return <LoadingBlocks label="Checking who's signed in" rows={2} />;
  if (status === "error")
    return (
      <StateCard
        tone="alert"
        title="Couldn't check sign-in"
        action={
          <button type="button" onClick={() => void refreshAccount()} className={BTN.secondary}>
            Try again
          </button>
        }
      >
        The library&apos;s server didn&apos;t answer. Check your connection and try again.
      </StateCard>
    );
  if (!account.configured) return <SignInNotSetUp />;
  if (!account.signedIn) return <SignInToContinue returnTo={returnTo} invite={invite} />;
  return <>{children}</>;
}
