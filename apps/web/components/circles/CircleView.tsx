"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { DotRow, StateCard } from "@/components/progress/ui";
import { IconArrowLeft, IconInfo, IconLeave, IconTrash } from "@/components/ui/icons";
import { BODY_L, BTN, BTN_SM, DISPLAY_L, PANEL, PANEL_MUTED } from "@/components/ui/styles";
import type { CircleDetail } from "@/lib/circles/types";
import { AccountGate, SignInNotSetUp, SignInToContinue } from "./AccountGate";
import { AddToCircle } from "./AddToCircle";
import { type ApiError, asApiError, send, useCircle } from "./api";
import { Badge } from "./CirclesShell";
import { plural } from "./format";
import { InvitePanel } from "./InvitePanel";
import { ItemCard } from "./ItemCard";
import { MembersPanel } from "./MembersPanel";
import { ConfirmButton, LoadingBlocks, Notice, RoleTag, SectionHeading } from "./ui";

/** /circles/:id: a circle's shared things, its members and (for the owner) its invites. */
export function CircleView({ id }: { id: string }) {
  return (
    <AccountGate returnTo={`/circles/${id}`}>
      <Circle id={id} />
    </AccountGate>
  );
}

function BackLink() {
  return (
    <Link href="/circles" className={`${BTN_SM.quiet} -ml-2.5`}>
      <IconArrowLeft size={16} />
      All circles
    </Link>
  );
}

function Circle({ id }: { id: string }) {
  const circle = useCircle(id);
  const { data, error } = circle;

  if (!data) {
    if (error?.code === "auth_not_configured") return <SignInNotSetUp />;
    if (error?.code === "sign_in_required") return <SignInToContinue returnTo={`/circles/${id}`} />;
    if (error?.status === 404)
      return (
        <div className="space-y-6">
          <BackLink />
          <StateCard
            title="This circle isn't one of yours"
            action={
              <Link href="/circles" className={BTN.secondary}>
                Your circles
              </Link>
            }
          >
            Either it doesn&apos;t exist, or you&apos;re not a member. If someone invited you, open
            the invite link they sent.
          </StateCard>
        </div>
      );
    if (error)
      return (
        <StateCard
          tone="alert"
          title="Couldn't open this circle"
          action={
            <button type="button" onClick={circle.reload} className={BTN.secondary}>
              Try again
            </button>
          }
        >
          {error.message}
        </StateCard>
      );
    return <LoadingBlocks label="Opening the circle" />;
  }

  return (
    <CircleBody
      data={data}
      firstNew={circle.firstNew}
      newIds={circle.newIds}
      reloadError={error}
      reload={circle.reload}
    />
  );
}

function CircleBody({
  data,
  firstNew,
  newIds,
  reloadError,
  reload,
}: {
  data: CircleDetail;
  firstNew: number;
  newIds: string[];
  reloadError: ApiError | undefined;
  reload: () => void;
}) {
  const router = useRouter();
  const [actionError, setActionError] = useState<ApiError | null>(null);
  const canEdit = data.myRole === "owner" || data.myRole === "editor";
  const owner = data.myRole === "owner";

  async function removeItem(itemId: string) {
    setActionError(null);
    try {
      await send("DELETE", `/api/circles/${data.id}/items/${itemId}`);
      reload();
    } catch (err) {
      setActionError(asApiError(err));
    }
  }

  async function leaveOrDelete() {
    setActionError(null);
    try {
      if (owner) await send("DELETE", `/api/circles/${data.id}`);
      else await send("POST", `/api/circles/${data.id}/leave`);
      router.push("/circles");
    } catch (err) {
      setActionError(asApiError(err));
    }
  }

  return (
    <div>
      <BackLink />
      <div className="mt-4">
        <Badge>Study Circle</Badge>
      </div>
      <h1 className={`${DISPLAY_L} mt-5 break-words`}>{data.name}</h1>
      <DotRow className="mt-4" />
      {data.description && (
        <p className={`${BODY_L} mt-4 max-w-[60ch] break-words`}>{data.description}</p>
      )}
      <p className="mt-4 flex flex-wrap items-center gap-2 text-[14px] leading-5 font-semibold text-ink-soft">
        <span>You&apos;re</span>
        <RoleTag role={data.myRole} />
        <span>
          · {plural(data.members.length, "member")} · {plural(data.items.length, "thing")} shared
        </span>
      </p>

      {firstNew > 0 && (
        <div
          role="status"
          className="mt-6 flex max-w-3xl items-start gap-3 rounded-[20px] border-[3px] border-walnut bg-sun px-4 py-3.5 shadow-[0_4px_0_#1f1a16]"
        >
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 border-walnut bg-surface text-walnut"
          >
            <IconInfo size={16} strokeWidth={2.4} />
          </span>
          <p className="font-display text-[16px] leading-6 font-semibold text-walnut">
            Welcome back to {data.name}. Your group added {plural(firstNew, "new thing")} since your
            last visit.
          </p>
        </div>
      )}

      {(reloadError || actionError) && (
        <Notice tone="error" className="mt-6 max-w-3xl">
          {(actionError ?? reloadError)!.message}
        </Notice>
      )}

      <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {canEdit ? (
            <AddToCircle circleId={data.id} onAdded={reload} />
          ) : (
            <div className={`${PANEL_MUTED} flex items-start gap-3 px-4 py-3.5`}>
              <span
                aria-hidden
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 border-walnut bg-sun text-walnut"
              >
                <IconInfo size={14} strokeWidth={2.5} />
              </span>
              <p className="text-[14px] leading-5 font-medium text-walnut">
                You&apos;re a viewer here: you can read and open everything. To add things, ask the
                owner to make you an editor.
              </p>
            </div>
          )}

          <section aria-labelledby="circle-items">
            <SectionHeading
              id="circle-items"
              title="Shared in this circle"
              sub={
                data.items.length
                  ? `${plural(data.items.length, "thing")}, newest first. Only members can see them.`
                  : "Only members can see what's shared here."
              }
            />
            {data.items.length === 0 ? (
              <StateCard title="Nothing shared yet">
                {canEdit
                  ? "Add a link or a note above, or share something from your library."
                  : "When editors add links, notes, plans or lessons, they'll show up here."}
              </StateCard>
            ) : (
              <ul className="space-y-4">
                {data.items.map((item) => (
                  <li key={item.id}>
                    <ItemCard
                      item={item}
                      isNew={item.isNew || newIds.includes(item.id)}
                      now={data.readAt}
                      canRemove={canEdit}
                      onRemove={() => removeItem(item.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <MembersPanel
            circleId={data.id}
            members={data.members}
            myRole={data.myRole}
            now={data.readAt}
            onChanged={reload}
          />
          {owner && data.invites && (
            <InvitePanel
              circleId={data.id}
              invites={data.invites}
              now={data.readAt}
              onChanged={reload}
            />
          )}
          <section aria-labelledby="circle-leave" className={`${PANEL} p-5 sm:p-6`}>
            <h2 id="circle-leave" className="font-display text-[17px] font-semibold text-walnut">
              {owner ? "Delete this circle" : "Leave this circle"}
            </h2>
            <p className="mt-1 text-[13.5px] leading-5 font-medium text-ink-soft">
              {owner
                ? "Removes the circle, everything shared in it and its invite links, for everyone. Your own library isn't touched. To keep it going without you, make another member the owner instead."
                : "You'll lose access to what's shared here. Things you added stay for the group, and an invite link can bring you back."}
            </p>
            <div className="mt-3">
              <ConfirmButton
                label={owner ? "Delete circle" : "Leave circle"}
                icon={owner ? <IconTrash size={15} /> : <IconLeave size={15} />}
                question={
                  owner
                    ? `Delete ${data.name} for everyone? This can't be undone.`
                    : `Leave ${data.name}?`
                }
                confirmLabel={owner ? "Delete it" : "Leave"}
                onConfirm={leaveOrDelete}
              />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
