"use client";

import { useState } from "react";
import { BTN_SM, PANEL } from "@/components/ui/styles";
import type { CircleMember, CircleRole } from "@/lib/circles/types";
import { type ApiError, asApiError, send } from "./api";
import { plural, timeAgo } from "./format";
import { ConfirmButton, Initial, Notice, RoleTag, SectionHeading, Select } from "./ui";

const ROLE_OPTIONS = [
  { value: "editor", label: "Editor" },
  { value: "viewer", label: "Viewer" },
] as const;

/**
 * Who's in the circle and their roles. The owner gets controls to change roles, hand the circle
 * over and remove people; the server refuses those for anyone else, whatever this shows.
 */
export function MembersPanel({
  circleId,
  members,
  myRole,
  now,
  onChanged,
}: {
  circleId: string;
  members: CircleMember[];
  myRole: CircleRole;
  now: string;
  onChanged: () => void;
}) {
  const [error, setError] = useState<ApiError | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const owner = myRole === "owner";

  async function act(key: string, method: "PATCH" | "DELETE", payload?: unknown) {
    setBusyKey(key);
    setError(null);
    try {
      await send(method, `/api/circles/${circleId}/members/${key}`, payload);
      onChanged();
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section aria-labelledby="circle-members" className={`${PANEL} p-5 sm:p-6`}>
      <SectionHeading
        id="circle-members"
        title="Members"
        sub={`${plural(members.length, "person", "people")} in this circle`}
      />
      {error && (
        <Notice tone="error" className="mb-3">
          {error.message}
        </Notice>
      )}
      <ul className="divide-y-2 divide-walnut/10">
        {members.map((m) => {
          const manageable = owner && !m.isMe && m.role !== "owner";
          return (
            <li key={m.key} className="py-3 first:pt-0 last:pb-0">
              <div className="flex items-center gap-3">
                <Initial name={m.displayName} me={m.isMe} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[15.5px] leading-5 font-semibold text-walnut">
                    {m.displayName}
                    {m.isMe && <span className="font-sans font-medium text-ink-soft"> (you)</span>}
                  </p>
                  <p className="text-[12.5px] leading-5 font-medium text-ink-soft">
                    {m.role === "owner" ? (
                      "Runs the circle"
                    ) : (
                      <>
                        Joined <time dateTime={m.joinedAt}>{timeAgo(m.joinedAt, now)}</time>
                      </>
                    )}
                  </p>
                </div>
                {manageable ? (
                  <Select
                    label={`Role for ${m.displayName}`}
                    hideLabel
                    value={m.role as "editor" | "viewer"}
                    options={ROLE_OPTIONS}
                    disabled={busyKey !== null}
                    onChange={(role) => void act(m.key, "PATCH", { role })}
                  />
                ) : (
                  <RoleTag role={m.role} />
                )}
              </div>
              {manageable && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-12">
                  <ConfirmButton
                    label="Remove"
                    question={`Remove ${m.displayName} from the circle?`}
                    confirmLabel="Remove"
                    disabled={busyKey !== null}
                    onConfirm={() => act(m.key, "DELETE")}
                  />
                  <HandOver
                    name={m.displayName}
                    disabled={busyKey !== null}
                    onConfirm={() => act(m.key, "PATCH", { role: "owner" })}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 text-[13px] leading-5 font-medium text-ink-soft">
        {owner
          ? "Editors can add and remove things. Viewers can read and open everything. Someone you remove can't come back through a link made before you removed them."
          : `You're ${myRole === "editor" ? "an editor, so you can add and remove things" : "a viewer, so you can read and open everything"}. The owner manages members.`}
      </p>
    </section>
  );
}

/** "Make owner", with its own question: it changes who runs the circle. */
function HandOver({
  name,
  disabled,
  onConfirm,
}: {
  name: string;
  disabled: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAsking(true)}
        className={BTN_SM.quiet}
      >
        Make owner
      </button>
    );
  return (
    <div
      role="group"
      aria-label={`Make ${name} the owner`}
      className="flex w-full flex-wrap items-center gap-2 rounded-[14px] border-2 border-dashed border-walnut/40 bg-canvas px-2.5 py-2"
    >
      <span className="text-[13.5px] leading-5 font-semibold text-walnut">
        Make {name} the owner? You&apos;ll become an editor.
      </span>
      <span className="flex gap-1.5">
        <button
          type="button"
          onClick={async () => {
            await onConfirm();
            setAsking(false);
          }}
          className={BTN_SM.primary}
        >
          Hand it over
        </button>
        <button type="button" onClick={() => setAsking(false)} className={BTN_SM.quiet}>
          Cancel
        </button>
      </span>
    </div>
  );
}
