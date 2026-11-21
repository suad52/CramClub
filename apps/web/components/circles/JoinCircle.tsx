"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { DotRow, StateCard } from "@/components/progress/ui";
import { IconUsers } from "@/components/ui/icons";
import { BTN, PANEL, RIBBON } from "@/components/ui/styles";
import type { InvitePreview, JoinResult } from "@/lib/circles/types";
import { AccountGate, SignInNotSetUp, SignInToContinue } from "./AccountGate";
import { type ApiError, asApiError, send } from "./api";
import { ROLE_LABEL, plural, shortDate } from "./format";
import { LoadingBlocks, Notice, RoleTag } from "./ui";

/**
 * /circles/join/:token: what the invite is for, and a button to accept it. Signed in only. Opening
 * the page changes nothing; joining is the button (and joining twice changes nothing either).
 */
export function JoinCircle({ token }: { token: string }) {
  const returnTo = `/circles/join/${token}`;
  return (
    <AccountGate returnTo={returnTo} invite>
      <Invite token={token} returnTo={returnTo} />
    </AccountGate>
  );
}

type Loaded = { token: string; preview?: InvitePreview; error?: ApiError };

function Invite({ token, returnTo }: { token: string; returnTo: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<ApiError | null>(null);

  useEffect(() => {
    let live = true;
    send<InvitePreview>("POST", "/api/circles/invites/preview", { token }).then(
      (preview) => live && setLoaded({ token, preview }),
      (err: unknown) => live && setLoaded({ token, error: asApiError(err) }),
    );
    return () => {
      live = false;
    };
  }, [token, attempt]);

  async function join() {
    setJoining(true);
    setJoinError(null);
    try {
      const out = await send<JoinResult>("POST", "/api/circles/join", { token });
      router.push(`/circles/${out.circleId}`);
    } catch (err) {
      setJoinError(asApiError(err));
      setJoining(false);
    }
  }

  const current = loaded?.token === token ? loaded : null;
  if (!current) return <LoadingBlocks label="Checking the invite" rows={1} />;
  const { preview, error } = current;

  if (error) {
    if (error.code === "auth_not_configured") return <SignInNotSetUp />;
    if (error.code === "sign_in_required") return <SignInToContinue returnTo={returnTo} invite />;
    // 403: the owner removed this person, so the link is closed to them (the message says so).
    if (error.status === 400 || error.status === 403 || error.status === 404)
      return (
        <StateCard
          tone="alert"
          title="This invite link doesn't work"
          action={
            <Link href="/circles" className={BTN.secondary}>
              Your circles
            </Link>
          }
        >
          {error.message}
        </StateCard>
      );
    return (
      <StateCard
        tone="alert"
        title="Couldn't check this invite"
        action={
          <button type="button" onClick={() => setAttempt((n) => n + 1)} className={BTN.secondary}>
            Try again
          </button>
        }
      >
        {error.message}
      </StateCard>
    );
  }

  if (!preview) return null;

  if (preview.status === "member")
    return (
      <StateCard
        title={`You're already in ${preview.circleName}`}
        action={
          <Link href={`/circles/${preview.circleId}`} className={BTN.primary}>
            Open the circle
          </Link>
        }
      >
        You&apos;re{" "}
        {preview.myRole === "owner"
          ? "its owner"
          : `${preview.myRole === "editor" ? "an editor" : "a viewer"}`}{" "}
        there. Following an invite again doesn&apos;t change your role.
      </StateCard>
    );

  if (preview.status !== "ok")
    return (
      <StateCard
        tone="alert"
        title={preview.status === "expired" ? "This invite has expired" : "This invite is used up"}
        action={
          <Link href="/circles" className={BTN.secondary}>
            Your circles
          </Link>
        }
      >
        {preview.status === "expired"
          ? `The link to ${preview.circleName} stopped working on ${shortDate(preview.expiresAt)}.`
          : `The link to ${preview.circleName} has been used as many times as it allows.`}{" "}
        Ask {preview.ownerName} for a new one.
      </StateCard>
    );

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
            className="title-pop grid h-14 w-14 -rotate-6 place-items-center rounded-full border-[3px] border-walnut bg-leaf text-walnut shadow-[0_4px_0_#1f1a16]"
          >
            <IconUsers size={26} strokeWidth={2.2} />
          </span>
          <h2 className="mt-5 font-display text-[28px] leading-tight font-bold break-words text-walnut">
            Join {preview.circleName}
          </h2>
          <DotRow className="mt-3" />
          <p className="mt-4 text-[15.5px] leading-6 font-medium text-ink-soft">
            <span className="font-semibold text-walnut">{preview.ownerName}</span> runs this Study
            Circle. {plural(preview.memberCount, "person", "people")}{" "}
            {preview.memberCount === 1 ? "is" : "are"} in it so far.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[14px] leading-5 font-semibold text-walnut">
            You&apos;ll join as <RoleTag role={preview.role} />
            <span className="font-medium text-ink-soft">
              {preview.role === "editor"
                ? "You'll be able to add things and remove them."
                : "You'll be able to read and open everything."}
            </span>
          </div>
          <p className="mt-2 text-[13px] leading-5 font-medium text-ink-soft">
            Members see each other&apos;s names and what&apos;s shared in the circle, never your
            personal library. This link works until {shortDate(preview.expiresAt)}.
          </p>
          {joinError && (
            <Notice tone="error" className="mt-5">
              {joinError.message}
            </Notice>
          )}
          <div className="mt-6 flex flex-wrap gap-3">
            <button type="button" onClick={join} disabled={joining} className={BTN.primary}>
              {joining ? "Joining…" : `Join as ${ROLE_LABEL[preview.role].toLowerCase()}`}
            </button>
            <Link href="/circles" className={BTN.secondary}>
              Not now
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
