"use client";

import Link from "next/link";
import { useState } from "react";
import { DotRow, StateCard } from "@/components/progress/ui";
import { LoadingBlocks, Notice } from "@/components/circles/ui";
import { IconUser, IconUsers } from "@/components/ui/icons";
import { BTN, PANEL, RIBBON } from "@/components/ui/styles";
import { loginHref } from "@/lib/auth/links";
import { refreshAccount, useAccount } from "@/lib/auth/useAccount";
import { type ApiError, asApiError } from "@/components/circles/api";
import { HOLD_TEXT, clockTime, joinTable, tableName } from "@/lib/tables/client";
import type { TableStatus } from "@/lib/tables/types";

/**
 * /tables/join/:token: accept an invite to someone's private table. Signed in only (the guest
 * list is people, not links). Opening the page changes nothing; accepting is the button, and it
 * only puts you on that one hold's list: when its time is up, the link and the list are done.
 */
export function JoinTable({ token }: { token: string }) {
  const returnTo = `/tables/join/${token}`;
  const { status, account } = useAccount();
  if (status === "loading") return <LoadingBlocks label="Checking who's signed in" rows={1} />;
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
  if (!account.configured) return <NotSetUp />;
  if (!account.signedIn) return <SignIn returnTo={returnTo} />;
  return <Invite token={token} returnTo={returnTo} />;
}

function NotSetUp() {
  return (
    <StateCard
      title="Sign-in isn't set up yet"
      action={
        <Link href="/" className={BTN.secondary}>
          Back to the library
        </Link>
      }
    >
      Private tables let in the people their holder invites, so each person needs an account. Once
      this server&apos;s Auth0 keys are added (see docs/auth0.md), invite links work. Open tables
      work as usual.
    </StateCard>
  );
}

function SignIn({ returnTo }: { returnTo: string }) {
  return (
    <StateCard
      title="Sign in to accept this invite"
      action={
        <a href={loginHref(returnTo)} className={BTN.primary}>
          <IconUser size={18} />
          Sign in
        </a>
      }
    >
      A private table keeps a list of who may sit there, so the library needs to know it&apos;s you.
      You&apos;ll come straight back here afterwards.
    </StateCard>
  );
}

type Joined = { tableId: string; status: TableStatus };

function Invite({ token, returnTo }: { token: string; returnTo: string }) {
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState<Joined | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  async function accept() {
    setJoining(true);
    setError(null);
    try {
      setJoined(await joinTable(token));
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setJoining(false);
    }
  }

  if (error?.code === "auth_not_configured") return <NotSetUp />;
  if (error?.code === "sign_in_required") return <SignIn returnTo={returnTo} />;
  if (error && [400, 404, 410].includes(error.status))
    return (
      <StateCard
        tone="alert"
        title="This invite link doesn't work"
        action={
          <Link href="/" className={BTN.secondary}>
            Back to the library
          </Link>
        }
      >
        {error.message ||
          "It may have ended with the table's time, or the table was given up. Ask whoever invited you for a new link."}
      </StateCard>
    );

  if (joined) {
    const { status } = joined;
    const name = tableName(joined.tableId);
    const where = joined.tableId.startsWith("gallery") ? "up on the gallery" : "in the hall";
    const running = status.held && status.endsAt;
    const holder = status.holderName ?? "Its holder";
    const until = clockTime(status.endsAt);
    return (
      <StateCard
        title={running ? `You can sit at ${name}` : `${name} is open now`}
        live
        action={
          <Link href="/" className={BTN.primary}>
            Go to the library
          </Link>
        }
      >
        {!running
          ? `The hold has ended, so anyone can sit there. Find it ${where}.`
          : status.visibility === "private"
            ? `${holder}'s table is private until ${until}, and you're on the list. Find it ${where}.`
            : `${holder}'s table is open to everyone right now. You're on the list if they make it private again before ${until}. Find it ${where}.`}
      </StateCard>
    );
  }

  return (
    <div className="mx-auto max-w-xl pt-4">
      <div className={`${PANEL} relative px-6 pt-9 pb-7 sm:px-9`}>
        <span className={`${RIBBON} absolute -top-3.5 left-6`}>Invite</span>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-2.5 rounded-[16px] border-2 border-dashed border-walnut/20"
        />
        <div className="relative">
          <span
            aria-hidden
            className="title-pop grid h-14 w-14 -rotate-6 place-items-center rounded-full border-[3px] border-walnut bg-tangerine text-walnut shadow-[0_4px_0_#1f1a16]"
          >
            <IconUsers size={26} strokeWidth={2.2} />
          </span>
          <h2 className="mt-5 font-display text-[28px] leading-tight font-bold text-walnut">
            Join a private table
          </h2>
          <DotRow className="mt-3" />
          <p className="mt-4 text-[15.5px] leading-6 font-medium text-ink-soft">
            Someone is holding a table in the library and invited you to study there. Accept, and
            you can sit at it until their {HOLD_TEXT} is up.
          </p>
          <p className="mt-2 text-[13px] leading-5 font-medium text-ink-soft">
            Nobody else sees who&apos;s on a table&apos;s list. The link stops working when their
            time at the table ends.
          </p>
          {error && (
            <Notice tone="error" className="mt-5">
              {error.message}
            </Notice>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void accept()}
              disabled={joining}
              className={BTN.primary}
            >
              {joining ? "Accepting…" : "Accept invite"}
            </button>
            <Link href="/" className={BTN.secondary}>
              Not now
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
