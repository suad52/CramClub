"use client";

import { useId, useRef, useState } from "react";
import {
  IconPause,
  IconPlay,
  IconRefresh,
  IconVolume,
  IconVolumeOff,
  IconWarning,
} from "@/components/ui/icons";
import { BTN_SM, FOCUS } from "@/components/ui/styles";
import { Spinner } from "@/components/my-library/parts";

/** "1:05" (or "1:02:05" for an hour or more). */
export function clock(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Spoken form for the seek slider: "1 minute 5 seconds". */
function spoken(seconds: number) {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(s / 60);
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  parts.push(`${s % 60} second${s % 60 === 1 ? "" : "s"}`);
  return parts.join(" ");
}

const RANGE = `h-6 cursor-pointer rounded-full accent-tangerine disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`;
const PLAY_BTN = `inline-grid h-11 w-11 shrink-0 place-items-center rounded-full border-[3px] border-walnut bg-sun text-walnut shadow-[0_3px_0_#1f1a16] transition-[background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:bg-[#f6d98f] active:translate-y-[2px] active:shadow-[0_1px_0_#1f1a16] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${FOCUS}`;
const MUTE_BTN = `inline-grid h-9 w-9 shrink-0 place-items-center rounded-[12px] border-2 border-transparent text-walnut transition-colors duration-150 hover:border-walnut hover:bg-canvas ${FOCUS}`;

type Status = "idle" | "loading" | "ready" | "error";

/**
 * A small narration player in the cartoon look: play and pause, a seek slider, volume and mute,
 * the current time and the length, with loading and error states. Every control is a real button
 * or slider, so it all works from the keyboard (Tab between them, Space or Enter on the buttons,
 * the arrow keys on the sliders). Nothing loads until it's played (`preload="none"`), so a page of
 * scenes doesn't fetch every clip; `knownDuration` (from the job) shows the length beforehand.
 * Key it by `src` so another clip starts fresh.
 */
export function AudioPlayer({
  src,
  label,
  knownDuration = null,
  className = "",
}: {
  src: string;
  /** What this is, for screen readers ("Narration for scene 2: Mitosis"). */
  label: string;
  knownDuration?: number | null;
  className?: string;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const uid = useId();
  const [status, setStatus] = useState<Status>("idle");
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState<number | null>(knownDuration);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  // Bumped by "Try again": a fresh request (and, on Vultr, a freshly signed URL).
  const [attempt, setAttempt] = useState(0);
  const url = attempt ? `${src}${src.includes("?") ? "&" : "?"}retry=${attempt}` : src;

  const toggle = async () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) {
      el.pause();
      return;
    }
    if (el.readyState < 3) setStatus("loading");
    try {
      await el.play();
    } catch (err) {
      // Refused (no user gesture) is just "not playing"; a broken file also fires `error`.
      if ((err as Error).name !== "NotAllowedError" && (err as Error).name !== "AbortError")
        setStatus("error");
    }
  };

  const seek = (to: number) => {
    const el = audio.current;
    if (!el || !Number.isFinite(to)) return;
    el.currentTime = to;
    setCurrent(to);
  };

  const retry = () => {
    setStatus("idle");
    setPlaying(false);
    setCurrent(0);
    setAttempt((n) => n + 1);
  };

  const total = duration ?? 0;
  const failed = status === "error";

  return (
    <div
      role="group"
      aria-labelledby={`${uid}-label`}
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] border-[2.5px] border-walnut bg-surface px-3 py-2.5 shadow-[0_3px_0_#1f1a16] ${className}`}
    >
      <span id={`${uid}-label`} className="sr-only">
        {label}
      </span>
      <audio
        ref={audio}
        src={url}
        preload="none"
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d)) setDuration(d);
        }}
        onWaiting={() => setStatus("loading")}
        onCanPlay={() => setStatus((s) => (s === "error" ? s : "ready"))}
        onPlaying={() => setStatus("ready")}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onError={() => {
          setStatus("error");
          setPlaying(false);
        }}
      />

      {failed ? (
        <p
          role="alert"
          className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 text-[13.5px] leading-5 font-semibold text-walnut"
        >
          <IconWarning size={18} strokeWidth={2.25} className="text-danger" />
          <span className="min-w-0 flex-1">Couldn&apos;t load this narration.</span>
          <button type="button" className={BTN_SM.secondary} onClick={retry}>
            <IconRefresh size={15} strokeWidth={2.25} />
            Try again
          </button>
        </p>
      ) : (
        <>
          <button
            type="button"
            className={PLAY_BTN}
            onClick={() => void toggle()}
            aria-label={playing ? "Pause narration" : "Play narration"}
            title={playing ? "Pause" : "Play"}
          >
            {status === "loading" ? (
              <Spinner className="!h-5 !w-5" />
            ) : playing ? (
              <IconPause size={18} strokeWidth={2.5} />
            ) : (
              <IconPlay size={18} strokeWidth={2.5} />
            )}
          </button>
          {status === "loading" && (
            <span role="status" className="sr-only">
              Loading the narration
            </span>
          )}

          <div className="flex min-w-[180px] flex-1 items-center gap-2.5">
            <span className="tabular w-11 shrink-0 text-right font-display text-[13px] font-semibold text-walnut">
              {clock(current)}
            </span>
            <input
              type="range"
              min={0}
              max={total || 1}
              step={1}
              value={Math.min(current, total || 1)}
              disabled={!total}
              onChange={(e) => seek(Number(e.target.value))}
              aria-label="Seek"
              aria-valuetext={`${spoken(current)} of ${spoken(total)}`}
              className={`${RANGE} min-w-0 flex-1`}
            />
            <span className="tabular w-11 shrink-0 font-display text-[13px] font-semibold text-ink-soft">
              {duration === null ? "–:––" : clock(total)}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              className={MUTE_BTN}
              onClick={() => {
                const next = !muted;
                setMuted(next);
                if (audio.current) audio.current.muted = next;
              }}
              aria-pressed={muted}
              aria-label={muted ? "Unmute" : "Mute"}
              title={muted ? "Unmute" : "Mute"}
            >
              {muted || volume === 0 ? <IconVolumeOff size={18} /> : <IconVolume size={18} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                setVolume(v);
                setMuted(false);
                if (audio.current) {
                  audio.current.volume = v;
                  audio.current.muted = false;
                }
              }}
              aria-label="Volume"
              aria-valuetext={`${Math.round((muted ? 0 : volume) * 100)}%`}
              className={`${RANGE} w-20`}
            />
          </div>
        </>
      )}
    </div>
  );
}
