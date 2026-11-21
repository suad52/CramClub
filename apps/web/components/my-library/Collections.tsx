"use client";

import { useId, useState } from "react";
import { asApiError, useApi } from "@/components/progress/api";
import { IconBook, IconLink, IconPlus, IconTrash, IconWarning } from "@/components/ui/icons";
import { BTN, BTN_SM, FOCUS, INPUT, LABEL, PANEL } from "@/components/ui/styles";
import {
  addItem,
  createCollection,
  deleteCollection,
  removeItem,
  renameCollection,
} from "@/lib/library/client";
import {
  LIBRARY_LIMITS,
  type CollectionSummary,
  type CollectionView,
  type LibraryItem,
} from "@/lib/library/types";
import { CardSkeleton, ItemCard } from "./Items";
import { EMPTY, ERROR_LINE, PrivateBadge, Spinner, shortDate } from "./parts";

/** The Collections tab: your collections down the side, the open one beside them. */

const FIELD = `${INPUT} mt-1.5`;

/** Makes a collection. */
function NewCollectionForm({ onMade }: { onMade: (c: CollectionSummary) => void }) {
  const uid = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const clean = name.replace(/\s+/g, " ").trim();
        if (!clean) return setError("Give it a name first.");
        setBusy(true);
        setError(null);
        createCollection(clean).then(
          (made) => {
            setBusy(false);
            setName("");
            onMade(made);
          },
          (err: unknown) => {
            setBusy(false);
            setError(asApiError(err).message);
          },
        );
      }}
    >
      <label htmlFor={uid} className="block min-w-0 flex-1 basis-[14rem]">
        <span className={LABEL}>New collection</span>
        <input
          id={uid}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={LIBRARY_LIMITS.collectionName}
          placeholder="For example, CS 135 midterm"
          className={FIELD}
        />
      </label>
      <button type="submit" className={BTN.secondary} disabled={busy}>
        {busy ? <Spinner /> : <IconPlus size={18} strokeWidth={2.25} />}
        Create
      </button>
      {error && (
        <p role="alert" className={`basis-full ${ERROR_LINE}`}>
          {error}
        </p>
      )}
    </form>
  );
}

type Adding = "link" | "note" | null;

/** "Add a link" and "Add a note" for the open collection. */
function AddForms({ collectionId, onAdded }: { collectionId: string; onAdded: () => void }) {
  const uid = useId();
  const [adding, setAdding] = useState<Adding>(null);
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = (which: Adding) => {
    setAdding(adding === which ? null : which);
    setError(null);
  };

  const submit = () => {
    setError(null);
    if (!title.trim()) return setError("Give it a title.");
    if (adding === "link" && !/^https:\/\//i.test(url.trim()))
      return setError("Links need a full web address that starts with https://");
    if (adding === "note" && !text.trim()) return setError("Write something in the note.");
    setBusy(true);
    const item =
      adding === "link"
        ? { kind: "resource" as const, title: title.trim(), url: url.trim() }
        : { kind: "note" as const, title: title.trim(), text };
    addItem(collectionId, item).then(
      (r) => {
        setBusy(false);
        if (!r.added) return setError("That link is already in this collection.");
        setTitle("");
        setUrl("");
        setText("");
        setAdding(null);
        onAdded();
      },
      (err: unknown) => {
        setBusy(false);
        setError(asApiError(err).message);
      },
    );
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={BTN_SM.secondary}
          aria-expanded={adding === "link"}
          aria-controls={`${uid}-form`}
          onClick={() => open("link")}
        >
          <IconLink size={16} />
          Add a link
        </button>
        <button
          type="button"
          className={BTN_SM.secondary}
          aria-expanded={adding === "note"}
          aria-controls={`${uid}-form`}
          onClick={() => open("note")}
        >
          <IconBook size={16} />
          Add a note
        </button>
      </div>
      {adding && (
        <form
          id={`${uid}-form`}
          className="mt-3 space-y-3 rounded-[18px] border-2 border-walnut/25 bg-canvas p-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <label className="block">
            <span className={LABEL}>Title</span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={LIBRARY_LIMITS.title}
              placeholder={
                adding === "link"
                  ? "For example, Racket docs: lists"
                  : "For example, Recursion tips"
              }
              className={FIELD}
            />
          </label>
          {adding === "link" ? (
            <label className="block">
              <span className={LABEL}>Web address</span>
              <input
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                maxLength={LIBRARY_LIMITS.url}
                placeholder="https://"
                className={FIELD}
              />
            </label>
          ) : (
            <label className="block">
              <span className={LABEL}>Note</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={LIBRARY_LIMITS.noteText}
                rows={5}
                className={`${INPUT} mt-1.5 h-auto py-2.5 leading-6`}
              />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={BTN_SM.primary} disabled={busy}>
              {busy && <Spinner />}
              {adding === "link" ? "Add link" : "Add note"}
            </button>
            <button
              type="button"
              className={BTN_SM.quiet}
              disabled={busy}
              onClick={() => setAdding(null)}
            >
              Cancel
            </button>
            {error && (
              <span role="alert" className={ERROR_LINE}>
                {error}
              </span>
            )}
          </div>
        </form>
      )}
      {!adding && error && (
        <p role="alert" className={`mt-2 ${ERROR_LINE}`}>
          {error}
        </p>
      )}
    </div>
  );
}

/** The open collection: its name (rename, delete), ways to add, and what's in it. */
function CollectionDetail({
  summary,
  onChanged,
  onPlay,
}: {
  summary: CollectionSummary;
  onChanged: () => void;
  onPlay: (item: LibraryItem) => void;
}) {
  const uid = useId();
  const { data, error, loading, reload } = useApi<CollectionView>(
    `/api/me/collections/${encodeURIComponent(summary.id)}`,
  );
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(summary.name);
  const [busy, setBusy] = useState<"rename" | "delete" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const changed = () => {
    reload();
    onChanged();
  };
  const shownName = data?.collection.name ?? summary.name;
  const count = data?.items.length ?? summary.itemCount;

  return (
    <section aria-labelledby={`${uid}-name`} className={`${PANEL} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <PrivateBadge />
            <span className="font-display text-[13px] font-medium text-ink-soft">
              <span className="tabular">{count}</span> {count === 1 ? "thing" : "things"} · made{" "}
              {shortDate(summary.createdAt)}
            </span>
          </p>
          {renaming ? (
            <form
              className="mt-2 flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const clean = name.replace(/\s+/g, " ").trim();
                if (!clean) return setProblem("A collection needs a name.");
                setBusy("rename");
                setProblem(null);
                renameCollection(summary.id, clean).then(
                  () => {
                    setBusy(null);
                    setRenaming(false);
                    changed();
                  },
                  (err: unknown) => {
                    setBusy(null);
                    setProblem(asApiError(err).message);
                  },
                );
              }}
            >
              <label htmlFor={`${uid}-rename`} className="sr-only">
                Collection name
              </label>
              <input
                id={`${uid}-rename`}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={LIBRARY_LIMITS.collectionName}
                className={`${INPUT} h-10 max-w-[20rem]`}
              />
              <button type="submit" className={BTN_SM.primary} disabled={busy !== null}>
                {busy === "rename" && <Spinner />}
                Save name
              </button>
              <button
                type="button"
                className={BTN_SM.quiet}
                onClick={() => {
                  setRenaming(false);
                  setName(shownName);
                }}
              >
                Cancel
              </button>
            </form>
          ) : (
            <h3
              id={`${uid}-name`}
              className="mt-2 font-display text-[24px] leading-tight font-bold break-words text-walnut"
            >
              {shownName}
            </h3>
          )}
        </div>
        {!renaming && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={BTN_SM.quiet}
              onClick={() => {
                setName(shownName);
                setRenaming(true);
                setProblem(null);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className={`${BTN_SM.quiet} text-danger`}
              disabled={busy !== null}
              onClick={() => {
                const what = count === 1 ? "the 1 thing" : `the ${count} things`;
                if (
                  !window.confirm(`Delete "${shownName}" and ${what} in it? This can't be undone.`)
                )
                  return;
                setBusy("delete");
                setProblem(null);
                deleteCollection(summary.id).then(
                  () => {
                    setBusy(null);
                    onChanged();
                  },
                  (err: unknown) => {
                    setBusy(null);
                    setProblem(asApiError(err).message);
                  },
                );
              }}
            >
              {busy === "delete" ? <Spinner /> : <IconTrash size={16} />}
              Delete
            </button>
          </div>
        )}
      </div>
      {problem && (
        <p role="alert" className={`mt-2 ${ERROR_LINE}`}>
          {problem}
        </p>
      )}

      <div className="mt-5 border-t-2 border-dashed border-walnut/15 pt-5">
        <AddForms collectionId={summary.id} onAdded={changed} />
      </div>

      <div className="mt-6">
        {error && !data ? (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-3 rounded-[16px] border-[2.5px] border-walnut bg-[#fbe9e5] px-4 py-3 text-[14px] font-semibold text-walnut"
          >
            <IconWarning size={18} className="text-danger" />
            {error.status === 404 ? "This collection isn't there any more." : error.message}
            <button type="button" className={BTN_SM.secondary} onClick={reload}>
              Try again
            </button>
          </div>
        ) : !data && loading ? (
          <div className="space-y-6" role="status" aria-label="Loading the collection">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : data && data.items.length === 0 ? (
          <p className={EMPTY}>
            Nothing in here yet. Add a link or a note above, or use Add to collection on a source in
            the Librarian.
          </p>
        ) : (
          <ul className="space-y-6">
            {data?.items.map((item) => (
              <li key={item.id}>
                <ItemCard
                  item={item}
                  onPlay={onPlay}
                  onChanged={changed}
                  onRemove={() => removeItem(item.collectionId, item.id).then(changed)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const PICK = `flex w-full items-center gap-3 rounded-[16px] border-[2.5px] border-walnut px-3.5 py-3 text-left text-walnut shadow-[0_3px_0_#1f1a16] transition-[background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px active:translate-y-[2px] active:shadow-[0_1px_0_#1f1a16] motion-reduce:transition-none ${FOCUS}`;

export function CollectionsTab({
  collections,
  onChanged,
  onPlay,
}: {
  collections: CollectionSummary[];
  onChanged: () => void;
  onPlay: (item: LibraryItem) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const current = collections.find((c) => c.id === picked) ?? collections[0] ?? null;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)] lg:items-start">
      <div className="space-y-5">
        <NewCollectionForm
          onMade={(c) => {
            setPicked(c.id);
            onChanged();
          }}
        />
        {collections.length === 0 ? (
          <p className={EMPTY}>
            No collections yet. Make one for a course or an exam, then add sources, lessons, plans
            and notes to it.
          </p>
        ) : (
          <ul className="space-y-2.5" aria-label="Your collections">
            {collections.map((c) => {
              const on = c.id === current?.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    aria-current={on ? "true" : undefined}
                    onClick={() => setPicked(c.id)}
                    className={`${PICK} ${on ? "bg-sun" : "bg-surface hover:bg-canvas"}`}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-[16px] font-semibold">
                        {c.name}
                      </span>
                      <span className="block text-[13px] font-medium text-ink-soft">
                        <span className="tabular">{c.itemCount}</span>{" "}
                        {c.itemCount === 1 ? "thing" : "things"} · private
                      </span>
                    </span>
                    {on && <span className="sr-only">(open)</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {current && (
        <CollectionDetail
          key={current.id}
          summary={current}
          onChanged={onChanged}
          onPlay={onPlay}
        />
      )}
    </div>
  );
}
