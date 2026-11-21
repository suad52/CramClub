"use client";

import { SPEAK_MS, librarianPresence } from "./presence";

/**
 * The Librarian's voice: her replies spoken with ElevenLabs (through /api/librarian/speak, so
 * the key stays on the server), with her jaw following the audio's loudness. Without a key, or
 * when muted, she just mouths the reply as before. Only short lines are spoken, to spare credits.
 */

const MUTE_KEY = "ovr.librarian.muted";
/** Longest line she says aloud (characters): her first sentence or two. */
const MAX_SPOKEN = 320;

let current: HTMLAudioElement | null = null;
let context: AudioContext | null = null;
let frame = 0;
let generation = 0;
/** Turns false after the server says the voice isn't set up: no more requests this visit. */
let available = true;
const listeners = new Set<() => void>();

export function isMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Private mode: muting lasts for this visit only.
  }
  if (muted) stopSpeaking();
  for (const l of listeners) l();
}

export function subscribeMuted(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether her voice can be heard (false once the server says ElevenLabs isn't set up). */
export const voiceAvailable = () => available;

export function stopSpeaking() {
  generation++;
  current?.pause();
  current = null;
  cancelAnimationFrame(frame);
  librarianPresence.speaking = false;
  librarianPresence.mouth = 0;
}

/** The part of a reply worth saying aloud: whole sentences, up to MAX_SPOKEN characters. */
export function speakable(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentences = clean.match(/[^.!?]+[.!?]+["')\]]*\s*/g) ?? [clean];
  let out = "";
  for (const s of sentences) {
    if (out && (out + s).length > MAX_SPOKEN) break;
    out += s;
  }
  return out.trim().slice(0, MAX_SPOKEN);
}

/** Says `text` in her voice; resolves once it has started (or fallen back to mouthing it). */
export async function sayAloud(text: string) {
  const line = speakable(text);
  if (!line || !available || isMuted()) return;
  const mine = ++generation;
  current?.pause();
  try {
    const res = await fetch("/api/librarian/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: line }),
    });
    if (res.status === 503) available = false;
    if (!res.ok || mine !== generation || isMuted()) return;
    const { audio } = (await res.json()) as { audio: string };
    if (mine !== generation) return;
    const el = new Audio(`data:audio/mpeg;base64,${audio}`);
    current = el;
    followLoudness(el);
    el.onended = () => {
      if (current !== el) return;
      current = null;
      librarianPresence.speaking = false;
      librarianPresence.mouth = 0;
    };
    await el.play();
    librarianPresence.speaking = true;
    // While her voice plays, the voice drives her jaw (not the timed mouthing).
    librarianPresence.speakUntil = 0;
  } catch {
    // Autoplay blocked or a network hiccup: she still mouths the reply.
    librarianPresence.speaking = false;
  }
}

/** Reads the audio's loudness every frame into `librarianPresence.mouth`. */
function followLoudness(el: HTMLAudioElement) {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaElementSource(el).connect(analyser);
    analyser.connect(context.destination);
    const samples = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (current !== el) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      librarianPresence.mouth = Math.min(1, Math.sqrt(sum / samples.length) * 5);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  } catch {
    // No Web Audio: the jaw falls back to its timed movement.
    librarianPresence.speakUntil = performance.now() + SPEAK_MS;
  }
}
