"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useRef, useState } from "react";
import { asApiError } from "@/components/progress/api";
import { IconCheck, IconClose, IconPlus } from "@/components/ui/icons";
import { BTN_SM, INPUT } from "@/components/ui/styles";
import { loginHref } from "@/lib/auth/links";
import {
  type NewItemInput,
  addItem,
  createCollection,
  listCollections,
} from "@/lib/library/client";
import { LIBRARY_LIMITS, type CollectionSummary } from "@/lib/library/types";
import {
  ERROR_LINE,
  IconLock,
  OFF_HINT,
  OFF_SM,
  Spinner,
  TEXT_LINK,
  useLibraryAccess,
} from "./parts";

type Load =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "ready"; collections: CollectionSummary[] }
  | { state: "error"; message: string };

type Outcome = { tone: "done" | "error"; text: string } | null;

/**
 * "Add to collection": opens a small shelf under the card's buttons listing your collections
 * (and a way to start a new one). Signed out, it explains and offers sign-in; without sign-in set
 * up on this server it's switched off with a hint. The server checks the collection and the
 * thing being added are both yours.
 */
export function AddToCollection({
  item,
  what = "this",
}: {
  /** What to add. For a Librarian source, its id: the server copies the rest from your row. */
  item: NewItemInput;
  /** How the shelf refers to the thing ("this source"). */
  what?: string;
}) {
  const access = useLibraryAccess();
  const pathname = usePathname();
  const uid = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ state: "idle" });
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [outcome, setOutcome] = useState<Outcome>(null);

  if (access === "off" || access === "error") {
    const hint = access === "off" ? OFF_HINT : "Couldn't check sign-in. Refresh to try again.";
    return (
      <>
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={`${uid}-hint`}
          title={hint}
          className={OFF_SM}
        >
          <IconLock size={14} />
          Add to collection
        </button>
        <span id={`${uid}-hint`} className="sr-only">
          {hint}
        </span>
      </>
    );
  }

  const fetchCollections = () => {
    setLoad({ state: "loading" });
    listCollections().then(
      (r) => setLoad({ state: "ready", collections: r.collections }),
      (err: unknown) => setLoad({ state: "error", message: asApiError(err).message }),
    );
  };

  const toggle = () => {
    const next = !open;
    setOpen(next);
    setOutcome(null);
    if (next && access === "signed-in" && load.state !== "ready") fetchCollections();
  };

  const close = () => {
    setOpen(false);
    toggleRef.current?.focus();
  };

  const addTo = (collection: { id: string; name: string }) => {
    setBusy(collection.id);
    setOutcome(null);
    addItem(collection.id, item).then(
      (r) => {
        setBusy(null);
        setOutcome({
          tone: "done",
          text: r.added
            ? `Added to ${r.collection.name}.`
            : `It's already in ${r.collection.name}.`,
        });
        if (r.added)
          setLoad((l) =>
            l.state === "ready"
              ? {
                  state: "ready",
                  collections: l.collections.map((c) =>
                    c.id === collection.id ? { ...c, itemCount: c.itemCount + 1 } : c,
                  ),
                }
              : l,
          );
      },
      (err: unknown) => {
        setBusy(null);
        setOutcome({ tone: "error", text: asApiError(err).message });
      },
    );
  };

  const createAndAdd = () => {
    const clean = name.replace(/\s+/g, " ").trim();
    if (!clean) return;
    setBusy("new");
    setOutcome(null);
    createCollection(clean).then(
      (made) => {
        setName("");
        setLoad((l) =>
          l.state === "ready" ? { state: "ready", collections: [made, ...l.collections] } : l,
        );
        addTo(made);
      },
      (err: unknown) => {
        setBusy(null);
        setOutcome({ tone: "error", text: asApiError(err).message });
      },
    );
  };

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        onClick={toggle}
        disabled={access === "loading"}
        aria-expanded={open}
        aria-controls={`${uid}-shelf`}
        className={BTN_SM.quiet}
      >
        <IconPlus size={16} strokeWidth={2.25} />
        Add to collection
      </button>
      {open && (
        <div
          id={`${uid}-shelf`}
          role="group"
          aria-label={`Add ${what} to a collection`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
          className="order-last basis-full rounded-[16px] border-2 border-walnut bg-canvas px-3.5 py-3 text-walnut"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
              <IconLock size={14} />
              Your collections
              <span className="font-sans text-[13px] font-medium text-ink-soft">
                · only you can see them
              </span>
            </p>
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className={`${BTN_SM.quiet} -mt-1.5 -mr-2 h-8 w-8 px-0`}
            >
              <IconClose size={16} strokeWidth={2.25} />
            </button>
          </div>

          {access === "signed-out" ? (
            <div className="mt-1.5">
              <p className="text-[14px] leading-6 font-medium text-ink-soft">
                Collections live in your private library. Sign in to keep {what} in one, on any
                computer.
              </p>
              <a href={loginHref(pathname)} className={`${BTN_SM.primary} mt-2.5`}>
                Sign in
              </a>
            </div>
          ) : load.state === "loading" || load.state === "idle" ? (
            <p role="status" className="mt-2 flex items-center gap-2 text-[14px] font-medium">
              <Spinner />
              Opening your collections…
            </p>
          ) : load.state === "error" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <p role="alert" className={ERROR_LINE}>
                {load.message}
              </p>
              <button type="button" onClick={fetchCollections} className={BTN_SM.secondary}>
                Try again
              </button>
            </div>
          ) : (
            <>
              {load.collections.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-2" aria-label="Add it to">
                  {load.collections.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => addTo(c)}
                        disabled={busy !== null}
                        className={`${BTN_SM.secondary} max-w-[16rem]`}
                      >
                        {busy === c.id ? <Spinner /> : <IconPlus size={15} strokeWidth={2.25} />}
                        <span className="truncate">{c.name}</span>
                        <span className="tabular text-[12px] font-medium text-ink-soft">
                          {c.itemCount}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-[14px] leading-6 font-medium text-ink-soft">
                  No collections yet. Name one for a course or an exam, and {what} goes straight in.
                </p>
              )}
              <form
                className="mt-3 flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  createAndAdd();
                }}
              >
                <label htmlFor={`${uid}-name`} className="sr-only">
                  New collection name
                </label>
                <input
                  id={`${uid}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={LIBRARY_LIMITS.collectionName}
                  placeholder="New collection, e.g. CS 135 midterm"
                  className={`${INPUT} h-9 max-w-[18rem] min-w-0 flex-1 rounded-[12px] border-2 text-[14px]`}
                />
                <button
                  type="submit"
                  disabled={busy !== null || !name.trim()}
                  className={BTN_SM.primary}
                >
                  {busy === "new" ? <Spinner /> : null}
                  Create and add
                </button>
              </form>
            </>
          )}

          {outcome && (
            <p
              role={outcome.tone === "error" ? "alert" : "status"}
              className={
                outcome.tone === "error"
                  ? `mt-2.5 ${ERROR_LINE}`
                  : "mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[14px] font-semibold"
              }
            >
              {outcome.tone === "done" && <IconCheck size={16} strokeWidth={2.75} />}
              {outcome.text}
              {outcome.tone === "done" && (
                <Link href="/my-library?tab=collections" className={`${TEXT_LINK} text-[13.5px]`}>
                  Open my library
                </Link>
              )}
            </p>
          )}
        </div>
      )}
    </>
  );
}
