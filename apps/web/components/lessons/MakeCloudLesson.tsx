"use client";

import { useEffect, useId, useState } from "react";
import { asApiError } from "@/components/progress/api";
import { IconChevronDown, IconInfo, IconSend, IconWarning } from "@/components/ui/icons";
import { BTN, INPUT, LABEL, PANEL } from "@/components/ui/styles";
import { Spinner } from "@/components/my-library/parts";
import type { LessonJobView } from "@/lib/jobs/types";
import {
  LENGTHS,
  LEVELS,
  type LessonLength,
  type Level,
  SCENE_COUNT,
} from "@/lib/learning-studio/schema";
import { type Health, getHealth, makeCloudLesson, workerOnline } from "@/lib/lessons/client";

const LEVEL_LABELS: Record<Level, string> = {
  beginner: "Beginner",
  "high-school": "High school",
  university: "University",
  advanced: "Advanced",
};

const LENGTH_NAMES: Record<LessonLength, string> = {
  short: "Short",
  standard: "Standard",
  detailed: "Detailed",
};

const SELECT = `${INPUT} cursor-pointer appearance-none pr-10 disabled:cursor-not-allowed disabled:opacity-60`;

function SelectField({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative mt-1.5 block">
      {children}
      <IconChevronDown
        size={18}
        strokeWidth={2.5}
        className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-walnut"
      />
    </span>
  );
}

/** Re-checks the worker this often while the form is on screen. */
const HEALTH_MS = 30_000;

/**
 * "Make a cloud lesson": a topic, a level and a length go to the queue (POST /api/lessons); the
 * worker on the Vultr server researches it with TinyFish, writes it with Gemini, records it with
 * ElevenLabs and stores the files, while the student does something else.
 */
export function MakeCloudLesson({ onCreated }: { onCreated: (job: LessonJobView) => void }) {
  const uid = useId();
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<Level>("high-school");
  const [length, setLength] = useState<LessonLength>("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null | undefined>(undefined);

  useEffect(() => {
    const ctrl = new AbortController();
    const check = () =>
      void getHealth(ctrl.signal).then((h) => !ctrl.signal.aborted && setHealth(h));
    check();
    const timer = setInterval(check, HEALTH_MS);
    return () => {
      clearInterval(timer);
      ctrl.abort();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = topic.trim();
    if (t.length < 3) {
      setError("Give the lesson a topic of at least 3 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const job = await makeCloudLesson({ topic: t, level, length });
      setTopic("");
      onCreated(job);
    } catch (err) {
      setError(asApiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const online = workerOnline(health ?? null);

  return (
    <form
      onSubmit={(e) => void submit(e)}
      aria-labelledby={`${uid}-title`}
      className={`${PANEL} relative max-w-[820px] p-5 pt-7 sm:p-6 sm:pt-8`}
    >
      <p
        id={`${uid}-title`}
        className="absolute -top-3.5 left-5 inline-flex -rotate-1 items-center rounded-full border-[2.5px] border-walnut bg-tangerine px-3.5 py-0.5 font-display text-[14px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16]"
      >
        Make a cloud lesson
      </p>
      <p className="text-[14.5px] leading-6 font-medium text-ink-soft">
        Name a topic and Ms. Fenwick does the rest: she researches it, writes the lesson and quiz,
        records the narration, and saves it all here. You don&apos;t need to keep this page open.
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-[1fr_auto_auto]">
        <label className="block">
          <span className={LABEL}>Topic</span>
          <input
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            maxLength={200}
            disabled={busy}
            required
            placeholder="For example, modular arithmetic"
            className={`${INPUT} mt-1.5 disabled:opacity-60`}
          />
        </label>
        <label className="block">
          <span className={LABEL}>Level</span>
          <SelectField>
            <select
              value={level}
              onChange={(e) => setLevel(e.target.value as Level)}
              disabled={busy}
              className={SELECT}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {LEVEL_LABELS[l]}
                </option>
              ))}
            </select>
          </SelectField>
        </label>
        <label className="block">
          <span className={LABEL}>Length</span>
          <SelectField>
            <select
              value={length}
              onChange={(e) => setLength(e.target.value as LessonLength)}
              disabled={busy}
              className={SELECT}
            >
              {LENGTHS.map((l) => (
                <option key={l} value={l}>
                  {LENGTH_NAMES[l]} · {SCENE_COUNT[l][0]}–{SCENE_COUNT[l][1]} scenes
                </option>
              ))}
            </select>
          </SelectField>
        </label>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
        <button type="submit" className={BTN.primary} disabled={busy}>
          {busy ? <Spinner /> : <IconSend size={18} strokeWidth={2.25} />}
          {busy ? "Queuing…" : "Make it in the cloud"}
        </button>
        {health !== undefined && (
          <p
            role="status"
            className="flex items-center gap-2 text-[13px] leading-5 font-medium text-ink-soft"
          >
            <span
              aria-hidden
              className={`h-2.5 w-2.5 rounded-full border-2 border-walnut ${online ? "bg-leaf" : "bg-surface"}`}
            />
            {online
              ? "The cloud worker is online."
              : "The cloud worker is offline right now: your lesson waits in the queue and starts when it's back."}
          </p>
        )}
      </div>

      {error && (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2.5 rounded-[16px] border-[3px] border-walnut bg-[#fbe9e5] px-3.5 py-3 text-sm leading-5 font-semibold text-walnut shadow-[0_3px_0_#1f1a16]"
        >
          <IconWarning size={18} strokeWidth={2.25} className="mt-px text-danger" />
          <span>{error}</span>
        </p>
      )}
      <p className="mt-4 flex gap-2 text-[12.5px] leading-5 font-medium text-ink-soft">
        <IconInfo size={16} strokeWidth={2.25} className="mt-px text-walnut" />
        <span>
          Lessons can contain mistakes: each one lists the sources it was built from. Only you (and
          Study Circles you share it with) can open it.
        </span>
      </p>
    </form>
  );
}
