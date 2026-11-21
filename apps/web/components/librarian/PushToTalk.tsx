"use client";

import { useEffect, useRef, useState } from "react";
import { IconMic, IconStop } from "@/components/ui/icons";
import { stopSpeaking } from "@/lib/librarian/voice";
import { SQUARE_BTN } from "./parts";

/** Longest recording (ms): a question, not a lecture. */
const MAX_MS = 30_000;

type State = "idle" | "recording" | "transcribing";

/**
 * Talk to the Librarian: tap to start, tap to stop. The recording goes to the server, which asks
 * ElevenLabs Speech to Text what you said; the words land in the message box for you to check and
 * send. The microphone is only on while recording (the browser asks the first time).
 */
export function PushToTalk({
  onText,
  disabled,
}: {
  onText: (text: string) => void;
  disabled: boolean;
}) {
  const [state, setState] = useState<State>("idle");
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      const r = recorder.current;
      if (r && r.state !== "inactive") r.stop();
    },
    [],
  );

  async function transcribe(blob: Blob) {
    setState("transcribing");
    try {
      const form = new FormData();
      form.append("audio", blob, "speech.webm");
      const res = await fetch("/api/librarian/listen", { method: "POST", body: form });
      const json = (await res.json().catch(() => null)) as {
        text?: string;
        error?: { message?: string };
      } | null;
      if (!res.ok) setError(json?.error?.message ?? "She couldn't hear that. Try again?");
      else if (!json?.text?.trim())
        setError("She didn't catch any words. Try again, a little closer?");
      else onText(json.text.trim());
    } catch {
      setError("She couldn't hear that. Check your connection and try again.");
    } finally {
      setState("idle");
    }
  }

  async function start() {
    setError(null);
    stopSpeaking();
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("Your microphone is blocked. Allow it in the browser to talk to her.");
      return;
    }
    const type = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((t) =>
      MediaRecorder.isTypeSupported(t),
    );
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    r.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      if (timer.current) clearTimeout(timer.current);
      recorder.current = null;
      const blob = new Blob(chunks, { type: r.mimeType || "audio/webm" });
      if (blob.size > 1000) void transcribe(blob);
      else setState("idle");
    };
    recorder.current = r;
    r.start();
    setState("recording");
    timer.current = setTimeout(() => r.state !== "inactive" && r.stop(), MAX_MS);
  }

  const stop = () => {
    const r = recorder.current;
    if (r && r.state !== "inactive") r.stop();
  };

  const recording = state === "recording";
  return (
    <div className="relative flex items-center">
      <button
        type="button"
        onClick={() => (recording ? stop() : void start())}
        disabled={disabled || state === "transcribing"}
        aria-pressed={recording}
        aria-label={recording ? "Stop and send what you said" : "Talk to Ms. Fenwick"}
        title={recording ? "Tap to stop" : "Tap to talk (tap again to stop)"}
        className={`${SQUARE_BTN} ${
          recording
            ? "bg-danger text-surface hover:bg-[#b65a53]"
            : "bg-surface text-walnut hover:bg-canvas disabled:hover:bg-surface"
        }`}
      >
        {recording ? (
          <IconStop size={18} strokeWidth={2.25} />
        ) : (
          <IconMic size={19} strokeWidth={2.25} />
        )}
      </button>
      {(recording || state === "transcribing" || error) && (
        <p
          role="status"
          // A dark sticker bubble above the mic, its tail pointing down at it.
          className="absolute right-0 bottom-[3.75rem] z-10 flex w-64 items-start gap-2 rounded-[14px] border-[2.5px] border-black/80 bg-walnut px-3 py-2 font-display text-[13px] leading-5 font-medium text-walnut-text shadow-[0_4px_0_rgb(0_0_0/0.45)]"
        >
          <span
            aria-hidden
            className="absolute right-3.5 -bottom-[7px] h-3 w-3 rotate-45 border-r-[2.5px] border-b-[2.5px] border-black/80 bg-walnut"
          />
          {recording && (
            <span
              className="mt-1 h-3 w-3 shrink-0 rounded-full border-2 border-black/60 bg-tangerine"
              aria-hidden
            />
          )}
          <span>
            {recording
              ? "Listening. Tap the stop button when you're done."
              : state === "transcribing"
                ? "Working out what you said…"
                : error}
          </span>
        </p>
      )}
    </div>
  );
}
