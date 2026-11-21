"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { type Resource, useApi } from "@/components/progress/api";
import { StateCard } from "@/components/progress/ui";
import { IconChevronRight, IconPlus, IconUsers } from "@/components/ui/icons";
import { BODY, BTN, FOCUS, PANEL, PANEL_MUTED } from "@/components/ui/styles";
import { CIRCLE_LIMITS, CIRCLE_ROLES, type CircleSummary } from "@/lib/circles/types";
import { AccountGate, SignInNotSetUp, SignInToContinue } from "./AccountGate";
import { type ApiError, asApiError, isAuthError, send } from "./api";
import { ROLE_CAN, ROLE_LABEL, plural } from "./format";
import { LoadingBlocks, Notice, RoleTag, SectionHeading, TextArea, TextField } from "./ui";

/** /circles: your circles, with what's new in each, and a form to start one. */
export function CirclesHome() {
  return (
    <AccountGate returnTo="/circles">
      <Circles />
    </AccountGate>
  );
}

function Circles() {
  const list = useApi<{ circles: CircleSummary[] }>("/api/circles/mine");
  if (isAuthError(list.error))
    return list.error!.code === "auth_not_configured" ? (
      <SignInNotSetUp />
    ) : (
      <SignInToContinue returnTo="/circles" />
    );
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <section aria-labelledby="my-circles">
        <SectionHeading
          id="my-circles"
          title="Your circles"
          sub="Shared shelves you're part of. Only members can see inside."
        />
        <CircleList list={list} />
      </section>
      <div className="space-y-6">
        <CreateCircle />
        <RolesCard />
      </div>
    </div>
  );
}

function CircleList({ list }: { list: Resource<{ circles: CircleSummary[] }> }) {
  if (list.data === undefined && list.error)
    return (
      <StateCard
        tone="alert"
        title="Couldn't load your circles"
        action={
          <button type="button" onClick={list.reload} className={BTN.secondary}>
            Try again
          </button>
        }
      >
        {list.error.message}
      </StateCard>
    );
  if (list.data === undefined) return <LoadingBlocks label="Loading your circles" />;
  const circles = list.data.circles;
  if (circles.length === 0)
    return (
      <StateCard title="No circles yet">
        Start one for a class or an exam, then share an invite link with your study group. Got a
        link from someone? Open it to join their circle.
      </StateCard>
    );
  return (
    <ul className="space-y-4">
      {circles.map((c) => (
        <li key={c.id}>
          <CircleCard circle={c} />
        </li>
      ))}
    </ul>
  );
}

function CircleCard({ circle: c }: { circle: CircleSummary }) {
  return (
    <Link
      href={`/circles/${c.id}`}
      className={`${PANEL} group relative flex items-start gap-4 p-5 transition-transform duration-150 ease-out hover:-translate-y-0.5 motion-reduce:transition-none sm:p-6 ${FOCUS}`}
    >
      <span
        aria-hidden
        className="grid h-12 w-12 shrink-0 -rotate-3 place-items-center rounded-full border-[3px] border-walnut bg-leaf text-walnut shadow-[0_3px_0_#1f1a16]"
      >
        <IconUsers size={22} strokeWidth={2.1} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-display text-[19px] leading-6 font-semibold text-walnut">
            {c.name}
          </span>
          <RoleTag role={c.myRole} />
        </span>
        {c.description && (
          <span className={`${BODY} mt-1 line-clamp-2 block`}>{c.description}</span>
        )}
        <span className="mt-2 block text-[13.5px] leading-5 font-semibold text-ink-soft">
          {plural(c.memberCount, "member")} · {plural(c.itemCount, "thing")} shared
          {c.myRole !== "owner" && ` · run by ${c.ownerName}`}
        </span>
        {c.newSinceLastVisit > 0 && (
          <span className="mt-3 inline-flex items-center gap-1.5 rounded-full border-2 border-walnut bg-sun px-3 py-0.5 font-display text-[13px] font-semibold text-walnut shadow-[0_2px_0_#1f1a16]">
            {plural(c.newSinceLastVisit, "new thing")} since your last visit
          </span>
        )}
      </span>
      <IconChevronRight
        size={22}
        className="mt-3 text-ink-soft transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none"
      />
    </Link>
  );
}

function CreateCircle() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { id } = await send<{ id: string }>("POST", "/api/circles/create", {
        name: name.trim(),
        description: description.trim() || undefined,
      });
      router.push(`/circles/${id}`);
    } catch (err) {
      setError(asApiError(err));
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="start-circle" className={`${PANEL} p-5 sm:p-6`}>
      <SectionHeading
        id="start-circle"
        title="Start a circle"
        sub="You'll be its owner. Invite people once it's made."
      />
      <form onSubmit={submit} className="space-y-4">
        <TextField
          label="Name"
          value={name}
          onChange={setName}
          max={CIRCLE_LIMITS.nameLength}
          placeholder="CS 135 midterm group"
          required
        />
        <TextArea
          label="What it's for"
          value={description}
          onChange={setDescription}
          max={CIRCLE_LIMITS.descriptionLength}
          rows={3}
          placeholder="Practice problems and notes for the November midterm"
        />
        {error && <Notice tone="error">{error.message}</Notice>}
        <button type="submit" disabled={!name.trim() || busy} className={`${BTN.primary} w-full`}>
          <IconPlus size={18} strokeWidth={2.25} />
          {busy ? "Starting your circle…" : "Start circle"}
        </button>
      </form>
    </section>
  );
}

function RolesCard() {
  return (
    <section aria-labelledby="circle-roles" className={`${PANEL_MUTED} p-5`}>
      <h2 id="circle-roles" className="font-display text-[16px] font-semibold text-walnut">
        Who can do what
      </h2>
      <ul className="mt-3 space-y-2.5">
        {CIRCLE_ROLES.map((role) => (
          <li key={role} className="flex items-start gap-2.5">
            <span className="w-[4.5rem] shrink-0">
              <span className="sr-only">{ROLE_LABEL[role]}: </span>
              <span aria-hidden>
                <RoleTag role={role} />
              </span>
            </span>
            <span className="text-[13.5px] leading-5 font-medium text-ink-soft">
              {ROLE_CAN[role]}.
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[13px] leading-5 font-medium text-ink-soft">
        Things you share are copies: your own library stays private.
      </p>
    </section>
  );
}
