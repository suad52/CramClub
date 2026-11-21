"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CaptionSegment,
  captionsFromAlignment,
  estimateCaptions,
  fitCaptions,
  splitSentences,
} from "./text";

/**
 * Narration for one scene. Uses ElevenLabs audio (via /api/learning-studio/tts, with real
 * character timings for captions) when the server has a key; otherwise the browser's own voice,
 * spoken a sentence at a time so captions and visuals stay in step. A scene whose narration is
 * already stored (a cloud lesson's MP3, served by /api/lessons/:id/audio/:scene) plays that file
 * instead, so reopening a lesson never asks for the speech again; if the file can't be played,
 * the browser's voice reads the scene. Never starts on its own: the player calls play() from a
 * click, as browsers require.
 */
export type NarrationState = "idle" | "loading" | "playing" | "paused" | "ended";
export type NarrationMode = "elevenlabs" | "browser" | "text";

interface Clip {
  url: string;
  captions: CaptionSegment[];
  /** A stored file (no character timings: the estimated captions are fitted to its length). */
  stored?: boolean;
}
const clips = new Map<string, Promise<Clip | null>>();
/** Set once the server says TTS isn't configured, so we stop asking. */
let ttsUnavailable = false;

function fetchClip(text: string): Promise<Clip | null> {
  if (ttsUnavailable) return Promise.resolve(null);
  let p = clips.get(text);
  if (!p) {
    p = fetch("/api/learning-studio/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 503) ttsUnavailable = true;
          return null;
        }
        const data = (await res.json()) as {
          audio: string;
          alignment?: { starts: number[]; ends: number[] } | null;
        };
        const blob = await (await fetch(`data:audio/mpeg;base64,${data.audio}`)).blob();
        return {
          url: URL.createObjectURL(blob),
          captions: data.alignment
            ? captionsFromAlignment(text, data.alignment.starts, data.alignment.ends)
            : [],
        };
      })
      .catch(() => null);
    clips.set(text, p);
  }
  return p;
}

export function useNarration(
  text: string,
  opts: { rate: number; volume: number },
  /** This scene's stored narration, if it has one: played as is, never synthesized again. */
  storedUrl?: string | null,
) {
  const [state, setState] = useState<NarrationState>("idle");
  const [progress, setProgress] = useState(0);
  const [caption, setCaption] = useState("");
  const [mode, setMode] = useState<NarrationMode>("browser");
  const audio = useRef<HTMLAudioElement | null>(null);
  const captions = useRef<CaptionSegment[]>([]);
  const sentence = useRef(0);
  const run = useRef(0); // bumps on every new text/restart so stale callbacks are ignored
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  // A new scene resets the visible state (React's "adjust state when a prop changes" pattern).
  const [forText, setForText] = useState(text);
  if (forText !== text) {
    setForText(text);
    setState("idle");
    setProgress(0);
    setCaption("");
  }

  const stop = useCallback(() => {
    run.current++;
    audio.current?.pause();
    audio.current = null;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }, []);

  // A new scene: stop whatever was playing and reset the timings.
  useEffect(() => {
    stop();
    sentence.current = 0;
    captions.current = estimateCaptions(text);
    return stop;
  }, [text, stop]);

  // Live rate/volume changes.
  useEffect(() => {
    if (audio.current) {
      audio.current.playbackRate = opts.rate;
      audio.current.volume = opts.volume;
    }
  }, [opts.rate, opts.volume]);

  /** Speaks the narration a sentence at a time from `start` (each sentence is its caption). */
  const speakFrom = useCallback(
    (start: number, id: number) => {
      const sentences = splitSentences(text);
      const speak = (index: number) => {
        if (index >= sentences.length) {
          setState("ended");
          setProgress(1);
          return;
        }
        sentence.current = index;
        setCaption(sentences[index]!);
        setProgress(index / sentences.length);
        const u = new SpeechSynthesisUtterance(sentences[index]);
        u.rate = optsRef.current.rate;
        u.volume = optsRef.current.volume;
        u.onboundary = (e) => {
          if (run.current !== id) return;
          setProgress(
            (index + Math.min(1, e.charIndex / Math.max(1, sentences[index]!.length))) /
              sentences.length,
          );
        };
        u.onend = () => {
          if (run.current === id) speak(index + 1);
        };
        speechSynthesis.speak(u);
      };
      speak(start);
    },
    [text],
  );

  const playAudio = useCallback((clip: Clip, id: number, from = 0, onFail?: () => void) => {
    const el = new Audio(clip.url);
    el.playbackRate = optsRef.current.rate;
    el.volume = optsRef.current.volume;
    el.currentTime = from;
    audio.current = el;
    if (clip.captions.length) captions.current = clip.captions;
    else if (clip.stored)
      el.onloadedmetadata = () => {
        if (run.current === id)
          captions.current = fitCaptions(captions.current, el.duration * 1000);
      };
    if (onFail)
      el.onerror = () => {
        if (run.current === id) onFail();
      };
    el.ontimeupdate = () => {
      if (run.current !== id || !el.duration) return;
      const ms = el.currentTime * 1000;
      setProgress(el.currentTime / el.duration);
      const seg =
        captions.current.find((c) => ms >= c.startMs && ms < c.endMs) ??
        captions.current.findLast((c) => ms >= c.startMs);
      setCaption(seg?.text ?? "");
    };
    el.onended = () => {
      if (run.current === id) {
        setState("ended");
        setProgress(1);
      }
    };
    // A late answer from a run that has since stopped (a new scene, say) must not set its state.
    void el.play().then(
      () => {
        if (run.current === id) setState("playing");
      },
      () => {
        if (run.current === id) setState("paused");
      },
    );
  }, []);

  /** Starts the scene's narration from the beginning. */
  const start = useCallback(async () => {
    stop();
    const id = ++run.current;
    setState("loading");
    if (storedUrl) {
      setMode("elevenlabs");
      playAudio({ url: storedUrl, captions: [], stored: true }, id, 0, () => {
        // The stored file is missing or can't be decoded: read the scene in the browser's voice
        // rather than paying for the speech again. (A new run id, so the failed play() is ignored.)
        const next = ++run.current;
        audio.current = null;
        if (typeof speechSynthesis === "undefined") {
          setMode("text");
          setCaption(text);
          setProgress(1);
          setState("ended");
          return;
        }
        setMode("browser");
        setState("playing");
        speakFrom(0, next);
      });
      return;
    }
    const clip = await fetchClip(text);
    if (run.current !== id) return;
    if (clip) {
      setMode("elevenlabs");
      playAudio(clip, id);
      return;
    }
    if (typeof speechSynthesis === "undefined") {
      // No voice available: show the text, reveal the visual and let the student read.
      setMode("text");
      setCaption(text);
      setProgress(1);
      setState("ended");
      return;
    }
    setMode("browser");
    setState("playing");
    speakFrom(0, id);
  }, [text, storedUrl, playAudio, speakFrom, stop]);

  const play = useCallback(async () => {
    if (state !== "paused") return start();
    if (audio.current) {
      await audio.current.play();
    } else if (typeof speechSynthesis !== "undefined") {
      // Resuming mid-sentence is unreliable across browsers: replay the current sentence.
      speechSynthesis.cancel();
      speakFrom(sentence.current, ++run.current);
    }
    setState("playing");
  }, [state, start, speakFrom]);

  const pause = useCallback(() => {
    if (state === "loading" && !audio.current) {
      // The AI voice's clip is still on its way and nothing has been heard yet: drop it, so play()
      // starts the scene afresh instead of "resuming" it in the browser's voice.
      run.current++;
      setState("idle");
      return;
    }
    if (audio.current) audio.current.pause();
    else if (typeof speechSynthesis !== "undefined") {
      run.current++; // ignore the cancelled utterance's end event
      speechSynthesis.cancel();
    }
    setState("paused");
  }, [state]);

  const restart = useCallback(() => {
    sentence.current = 0;
    setProgress(0);
    void start();
  }, [start]);

  return { state, progress, caption, mode, play, pause, restart, stop };
}
