"use client";

import { useEffect, useRef, useState } from "react";
import { FOCUS } from "@/components/progress/ui";
import { stopSpeaking } from "@/lib/librarian/voice";

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
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg ring-1 transition disabled:opacity-50 ${
          recording
            ? "animate-pulse bg-red-600 text-white ring-red-700"
            : "bg-white/70 text-ink ring-ink/15 hover:bg-white"
        } ${FOCUS}`}
      >
        <span aria-hidden>{state === "transcribing" ? "…" : recording ? "■" : "🎤"}</span>
      </button>
      {(recording || state === "transcribing" || error) && (
        <p
          role="status"
          className="absolute bottom-12 left-0 w-64 rounded-xl bg-ink/90 px-3 py-2 text-xs font-bold text-cream shadow-lg"
        >
          {recording
            ? "Listening… tap ■ when you're done."
            : state === "transcribing"
              ? "Working out what you said…"
              : error}
        </p>
      )}
    </div>
  );
}
