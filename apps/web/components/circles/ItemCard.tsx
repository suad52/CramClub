"use client";

import { useState } from "react";
import { IconArrowUpRight, IconTrash } from "@/components/ui/icons";
import { BODY, FOCUS, PANEL, PANEL_MUTED, TAG } from "@/components/ui/styles";
import type { CircleItem, ItemPreview } from "@/lib/circles/types";
import { KIND_LABEL, hostOf, planDay, plural, timeAgo } from "./format";
import { ConfirmButton, KindDot } from "./ui";

/**
 * One shared thing in a circle: what it is, who added it and when, and its preview. Everything
 * here was written by a member, so it's shown as plain text (React escapes it) and links open in
 * a new tab without a referrer.
 */
export function ItemCard({
  item,
  isNew,
  now,
  canRemove,
  onRemove,
}: {
  item: CircleItem;
  isNew: boolean;
  /** The server's time for this view (keeps rendering pure). */
  now: string;
  canRemove: boolean;
  onRemove: () => Promise<unknown>;
}) {
  const host = item.url ? hostOf(item.url) : "";
  return (
    <article
      aria-labelledby={`item-${item.id}`}
      className={`${PANEL} relative p-4 sm:p-5 ${isNew ? "ring-4 ring-sun/70" : ""}`}
    >
      <div className="flex items-start gap-3.5">
        <KindDot kind={item.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`${TAG.neutral} leading-4`}>{KIND_LABEL[item.kind]}</span>
            <span
              className={`${TAG.forest} leading-4`}
              title="Everyone in this circle can see this"
            >
              Shared
            </span>
            {isNew && (
              <span className={`${TAG.brass} leading-4`} title="Added since your last visit">
                New
              </span>
            )}
          </div>
          <h3
            id={`item-${item.id}`}
            className="mt-2 font-display text-[17px] leading-6 font-semibold break-words text-walnut"
          >
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                referrerPolicy="no-referrer"
                className={`inline rounded-[6px] underline decoration-walnut/30 decoration-2 underline-offset-4 hover:decoration-walnut ${FOCUS}`}
              >
                {item.title}
                <IconArrowUpRight size={16} className="ml-1 inline align-[-2px]" />
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : (
              item.title
            )}
          </h3>
          {host && <p className="text-[13px] leading-5 font-semibold text-ink-soft">{host}</p>}
          {item.summary && <p className={`${BODY} mt-1.5 break-words`}>{item.summary}</p>}
          <Preview preview={item.preview} />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <p className="text-[13px] leading-5 font-medium text-ink-soft">
              Added by{" "}
              <span className="font-semibold text-walnut">
                {item.addedByMe ? "you" : item.addedByName}
              </span>
              {item.fromLibrary && (item.addedByMe ? " from your library" : " from their library")}{" "}
              · <time dateTime={item.createdAt}>{timeAgo(item.createdAt, now)}</time>
            </p>
            {canRemove && (
              <ConfirmButton
                label="Remove"
                icon={<IconTrash size={15} />}
                question="Remove it for everyone?"
                confirmLabel="Remove"
                onConfirm={onRemove}
              />
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

function Preview({ preview }: { preview: ItemPreview }) {
  if (preview.type === "note") return <NoteText text={preview.text} />;
  if (preview.type === "plan") {
    if (!preview.days.length && !preview.goal) return null;
    return (
      <details className={`${PANEL_MUTED} group mt-3 px-4 py-3`}>
        <summary
          className={`cursor-pointer rounded-[8px] font-display text-[14px] font-semibold text-walnut ${FOCUS}`}
        >
          See the plan ({plural(preview.days.length, "day")}
          {preview.dailyMinutes ? `, about ${preview.dailyMinutes} minutes a day` : ""})
        </summary>
        {preview.goal && (
          <p className="mt-2 text-[14px] leading-6 font-medium text-ink-soft">{preview.goal}</p>
        )}
        <ol className="mt-2 space-y-2.5">
          {preview.days.map((d, i) => (
            <li key={`${d.date}-${i}`} className="text-[14px] leading-5">
              <p className="font-display font-semibold text-walnut">
                {d.date ? planDay(d.date) : `Day ${i + 1}`}
                {d.focus && (
                  <span className="font-sans font-medium text-ink-soft"> · {d.focus}</span>
                )}
              </p>
              {d.items.length > 0 && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 font-medium text-ink-soft">
                  {d.items.map((t, j) => (
                    <li key={j}>{t}</li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </details>
    );
  }
  if (preview.type === "lesson") {
    if (!preview.objectives.length && !preview.scenes.length) return null;
    return (
      <details className={`${PANEL_MUTED} mt-3 px-4 py-3`}>
        <summary
          className={`cursor-pointer rounded-[8px] font-display text-[14px] font-semibold text-walnut ${FOCUS}`}
        >
          What it covers ({plural(preview.scenes.length, "scene")}
          {preview.minutes ? `, about ${preview.minutes} minutes` : ""})
        </summary>
        {preview.objectives.length > 0 && (
          <>
            <p className="mt-2 font-display text-[13.5px] font-semibold text-walnut">
              You&apos;ll be able to
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[14px] leading-5 font-medium text-ink-soft">
              {preview.objectives.map((o, i) => (
                <li key={i}>{o}</li>
              ))}
            </ul>
          </>
        )}
        {preview.scenes.length > 0 && (
          <>
            <p className="mt-3 font-display text-[13.5px] font-semibold text-walnut">Scenes</p>
            <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-[14px] leading-5 font-medium text-ink-soft">
              {preview.scenes.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </>
        )}
      </details>
    );
  }
  return null;
}

/** A note's text: the first few lines, with the rest a click away. */
function NoteText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 360 || text.split("\n").length > 6;
  return (
    <div className={`${PANEL_MUTED} mt-3 px-4 py-3`}>
      <p
        className={`text-[14.5px] leading-6 font-medium break-words whitespace-pre-wrap text-ink ${long && !open ? "line-clamp-6" : ""}`}
      >
        {text}
      </p>
      {long && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={`mt-1.5 rounded-[8px] font-display text-[13.5px] font-semibold text-walnut underline decoration-walnut/30 decoration-2 underline-offset-4 hover:decoration-walnut ${FOCUS}`}
        >
          {open ? "Show less" : "Show the whole note"}
        </button>
      )}
    </div>
  );
}
