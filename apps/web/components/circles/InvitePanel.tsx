"use client";

import { type FormEvent, useId, useRef, useState } from "react";
import { Segmented } from "@/components/progress/ui";
import { IconCheck, IconCopy, IconLink } from "@/components/ui/icons";
import { BTN, INPUT, PANEL } from "@/components/ui/styles";
import {
  CIRCLE_LIMITS,
  type CircleInvite,
  type InviteRole,
  type NewInvite,
} from "@/lib/circles/types";
import { type ApiError, asApiError, send } from "./api";
import { INVITE_ROLE_HINT, ROLE_LABEL, shortDate } from "./format";
import { ConfirmButton, Notice, RoleTag, SectionHeading, Select } from "./ui";

const ROLES = [
  { id: "viewer", label: "Viewer" },
  { id: "editor", label: "Editor" },
] as const;
const DAYS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
] as const;
const USES = [
  { value: "1", label: "1 person" },
  { value: "5", label: "5 people" },
  { value: "10", label: "10 people" },
  { value: "25", label: "25 people" },
] as const;

/**
 * Owner only: make an invite link (a role, how long it lasts, how many people can use it), copy
 * it, and revoke open ones. The link is shown once: the server keeps only a fingerprint of it.
 */
export function InvitePanel({
  circleId,
  invites,
  now,
  onChanged,
}: {
  circleId: string;
  invites: CircleInvite[];
  now: string;
  onChanged: () => void;
}) {
  const [role, setRole] = useState<InviteRole>("viewer");
  const [days, setDays] = useState<(typeof DAYS)[number]["value"]>("7");
  const [uses, setUses] = useState<(typeof USES)[number]["value"]>("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [made, setMade] = useState<{ url: string; invite: NewInvite } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const invite = await send<NewInvite>("POST", `/api/circles/${circleId}/invites`, {
        role,
        days: Number(days),
        maxUses: Number(uses),
      });
      setMade({ url: `${window.location.origin}${invite.path}`, invite });
      onChanged();
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    try {
      await send("DELETE", `/api/circles/${circleId}/invites/${id}`);
      if (made?.invite.id === id) setMade(null);
      onChanged();
    } catch (err) {
      setError(asApiError(err));
    }
  }

  return (
    <section aria-labelledby="circle-invite" className={`${PANEL} p-5 sm:p-6`}>
      <SectionHeading
        id="circle-invite"
        title="Invite people"
        sub="Anyone signed in who has the link can join, until it expires or runs out."
      />
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <p className="font-display text-[14px] font-semibold text-walnut">They join as</p>
          <Segmented
            label="Role for people who join"
            options={ROLES}
            value={role}
            onChange={setRole}
          />
          <p className="text-[13px] leading-5 font-medium text-ink-soft">
            {INVITE_ROLE_HINT[role]}.
          </p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Select label="Link lasts" value={days} options={DAYS} onChange={setDays} />
          <Select label="Can be used by" value={uses} options={USES} onChange={setUses} />
        </div>
        {error && <Notice tone="error">{error.message}</Notice>}
        <button type="submit" disabled={busy} className={`${BTN.primary} w-full`}>
          <IconLink size={18} strokeWidth={2.1} />
          {busy ? "Making a link…" : `Make ${ROLE_LABEL[role].toLowerCase()} invite link`}
        </button>
      </form>

      {made && <CopyBox url={made.url} invite={made.invite} />}

      {invites.length > 0 && (
        <div className="mt-6">
          <h3 className="font-display text-[15px] font-semibold text-walnut">Open invite links</h3>
          <ul className="mt-2 space-y-2.5">
            {invites.map((inv) => (
              <li
                key={inv.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-[16px] border-2 border-walnut/25 bg-canvas px-3 py-2.5"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <RoleTag role={inv.role} />
                  <span className="text-[13px] leading-5 font-semibold text-ink-soft">
                    Used {inv.uses} of {inv.maxUses} · until {shortDate(inv.expiresAt, now)}
                  </span>
                </span>
                <ConfirmButton
                  label="Revoke"
                  question="Revoke this link?"
                  confirmLabel="Revoke"
                  onConfirm={() => revoke(inv.id)}
                />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[12.5px] leading-5 font-medium text-ink-soft">
            Up to {CIRCLE_LIMITS.activeInvites} links can be open at once. Revoking one stops it
            working; people who already joined stay.
          </p>
        </div>
      )}
    </section>
  );
}

/** The new link, ready to copy, with what it allows. */
function CopyBox({ url, invite }: { url: string; invite: NewInvite }) {
  const [copied, setCopied] = useState<"yes" | "manual" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied("yes");
      setTimeout(() => setCopied(null), 2500);
    } catch {
      inputRef.current?.select();
      setCopied("manual");
    }
  }

  return (
    <div className="mt-5 rounded-[20px] border-[3px] border-walnut bg-sun/35 p-4 shadow-[0_4px_0_#1f1a16]">
      <label htmlFor={id} className="font-display text-[14.5px] font-semibold text-walnut">
        Your invite link
      </label>
      <div className="mt-2 flex flex-col items-start gap-2">
        <input
          ref={inputRef}
          id={id}
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className={`${INPUT} min-w-0 font-mono text-[13px]`}
        />
        <button type="button" onClick={copy} className={BTN.secondary}>
          {copied === "yes" ? <IconCheck size={18} strokeWidth={2.5} /> : <IconCopy size={18} />}
          {copied === "yes" ? "Copied" : "Copy link"}
        </button>
      </div>
      <p role="status" className="mt-2 text-[13px] leading-5 font-semibold text-walnut">
        {copied === "manual"
          ? "Couldn't copy automatically. The link is selected: press Ctrl+C (or Cmd+C) to copy it."
          : `Joins as ${ROLE_LABEL[invite.role].toLowerCase()} · ${invite.maxUses === 1 ? "1 person" : `up to ${invite.maxUses} people`} · until ${shortDate(invite.expiresAt)}.`}
      </p>
      <p className="mt-1 text-[12.5px] leading-5 font-medium text-walnut/80">
        This is the only time the link is shown: the library keeps just a fingerprint of it. Copy it
        now and send it to your group.
      </p>
    </div>
  );
}
