"use client";

import { type FormEvent, useState } from "react";
import { useApi } from "@/components/progress/api";
import { Segmented } from "@/components/progress/ui";
import { IconPlus } from "@/components/ui/icons";
import { BTN, BTN_SM, PANEL, PANEL_MUTED } from "@/components/ui/styles";
import { CIRCLE_LIMITS, type ShareableItem } from "@/lib/circles/types";
import { type ApiError, asApiError, send } from "./api";
import { KIND_LABEL } from "./format";
import { KindDot, LoadingBlocks, Notice, SectionHeading, TextArea, TextField } from "./ui";

type Tab = "link" | "note" | "library";
const TABS = [
  { id: "link", label: "Link" },
  { id: "note", label: "Note" },
  { id: "library", label: "From my library" },
] as const;

/**
 * Editors and the owner: add a link or a note, or copy something from your own library. The
 * server checks the role again (and that a library item is yours) before anything is saved.
 */
export function AddToCircle({ circleId, onAdded }: { circleId: string; onAdded: () => void }) {
  const [tab, setTab] = useState<Tab>("link");
  return (
    <section aria-labelledby="add-to-circle" className={`${PANEL} p-5 sm:p-6`}>
      <SectionHeading
        id="add-to-circle"
        title="Add to the circle"
        sub="Everyone in the circle will see it, with your name on it."
        aside={<Segmented label="What to add" options={TABS} value={tab} onChange={setTab} />}
      />
      {tab === "link" && <LinkForm circleId={circleId} onAdded={onAdded} />}
      {tab === "note" && <NoteForm circleId={circleId} onAdded={onAdded} />}
      {tab === "library" && <FromLibrary circleId={circleId} onAdded={onAdded} />}
    </section>
  );
}

function useAdd(circleId: string, onAdded: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  async function add(payload: unknown, title: string) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await send("POST", `/api/circles/${circleId}/items`, payload);
      setDone(`Added “${title}” to the circle.`);
      onAdded();
      return true;
    } catch (err) {
      setError(asApiError(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, done, add };
}

function Feedback({ error, done }: { error: ApiError | null; done: string | null }) {
  if (error) return <Notice tone="error">{error.message}</Notice>;
  if (done) return <Notice tone="success">{done}</Notice>;
  return null;
}

function LinkForm({ circleId, onAdded }: { circleId: string; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [summary, setSummary] = useState("");
  const { busy, error, done, add } = useAdd(circleId, onAdded);
  const ready = title.trim() && url.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    const added = await add(
      {
        kind: "resource",
        title: title.trim(),
        url: url.trim(),
        summary: summary.trim() || undefined,
      },
      title.trim(),
    );
    if (added) {
      setTitle("");
      setUrl("");
      setSummary("");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Title"
          value={title}
          onChange={setTitle}
          max={CIRCLE_LIMITS.titleLength}
          placeholder="How to Design Programs, part 2"
          required
        />
        <TextField
          label="Link"
          type="url"
          value={url}
          onChange={setUrl}
          max={2048}
          placeholder="https://"
          hint="Secure links only (https://)."
          required
        />
      </div>
      <TextArea
        label="Why it helps"
        value={summary}
        onChange={setSummary}
        max={CIRCLE_LIMITS.summaryLength}
        rows={2}
        placeholder="The clearest walkthrough of list templates I've found"
      />
      <Feedback error={error} done={done} />
      <button type="submit" disabled={!ready || busy} className={BTN.primary}>
        <IconPlus size={18} strokeWidth={2.25} />
        {busy ? "Adding…" : "Add link"}
      </button>
    </form>
  );
}

function NoteForm({ circleId, onAdded }: { circleId: string; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const { busy, error, done, add } = useAdd(circleId, onAdded);
  const ready = title.trim() && text.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready || busy) return;
    if (await add({ kind: "note", title: title.trim(), text: text.trim() }, title.trim())) {
      setTitle("");
      setText("");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <TextField
        label="Title"
        value={title}
        onChange={setTitle}
        max={CIRCLE_LIMITS.titleLength}
        placeholder="Week 3 practice answers"
        required
      />
      <TextArea
        label="Note"
        value={text}
        onChange={setText}
        max={CIRCLE_LIMITS.noteLength}
        rows={5}
        placeholder="What the group should know"
        required
      />
      <Feedback error={error} done={done} />
      <button type="submit" disabled={!ready || busy} className={BTN.primary}>
        <IconPlus size={18} strokeWidth={2.25} />
        {busy ? "Adding…" : "Add note"}
      </button>
    </form>
  );
}

function FromLibrary({ circleId, onAdded }: { circleId: string; onAdded: () => void }) {
  const library = useApi<{ items: ShareableItem[] }>("/api/circles/shareable");
  const { busy, error, done, add } = useAdd(circleId, onAdded);
  const [pending, setPending] = useState<string | null>(null);

  if (library.data === undefined && library.error)
    return (
      <div className="space-y-3">
        <Notice tone="error">{library.error.message}</Notice>
        <button type="button" onClick={library.reload} className={BTN_SM.secondary}>
          Try again
        </button>
      </div>
    );
  if (library.data === undefined) return <LoadingBlocks label="Loading your library" rows={2} />;
  const items = library.data.items;

  return (
    <div className="space-y-4">
      <p className="text-[14px] leading-5 font-medium text-ink-soft">
        Sharing makes a copy for the circle. Your library stays private, and changes to your copy
        later won&apos;t show up here.
      </p>
      <Feedback error={error} done={done} />
      {items.length === 0 ? (
        <div className={`${PANEL_MUTED} px-4 py-5 text-center`}>
          <p className="font-display text-[16px] font-semibold text-walnut">
            Nothing in your library yet
          </p>
          <p className="mx-auto mt-1 max-w-[44ch] text-[14px] leading-5 font-medium text-ink-soft">
            Save sources from the Librarian, or have her make you a study plan or a lesson, and
            they&apos;ll show up here to share.
          </p>
        </div>
      ) : (
        <ul className="max-h-[26rem] divide-y-2 divide-walnut/10 overflow-y-auto rounded-[18px] border-2 border-walnut/25 bg-canvas px-3">
          {items.map((it) => {
            const key = `${it.source}:${it.id}`;
            return (
              <li key={key} className="flex items-center gap-3 py-3">
                <KindDot kind={it.kind} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-display text-[15px] leading-5 font-semibold text-walnut">
                    {it.title}
                  </p>
                  <p className="truncate text-[13px] leading-5 font-medium text-ink-soft">
                    {KIND_LABEL[it.kind]} · {it.from}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Share “${it.title}” with the circle`}
                  onClick={async () => {
                    setPending(key);
                    await add({ from: { source: it.source, id: it.id } }, it.title);
                    setPending(null);
                  }}
                  className={BTN_SM.secondary}
                >
                  {pending === key ? "Sharing…" : "Share"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
