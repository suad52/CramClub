"use client";

import { SPEAK_MS, librarianPresence } from "./presence";

/**
 * The Librarian's voice: every line she says, spoken with ElevenLabs (through /api/librarian/speak,
 * so the key stays on the server). Her jaw follows the audio's loudness, and the line's text can
 * be revealed in step with her words (`revealedChars`, from the per-character timings the endpoint
 * returns). A newer line cuts off the one she's saying. Without a key, or when muted, she mouths
 * the line instead.
 *
 * She says up to MAX_SPOKEN characters of a line (whole sentences), so a huge reply doesn't burn
 * credits. The endpoint takes at most PART_MAX characters a request, so a longer line is said in
 * parts, the next one fetched while she says the one before.
 */

const MUTE_KEY = "ovr.librarian.muted";
/** Longest stretch of a line she says aloud (characters): whole sentences from its start. */
export const MAX_SPOKEN = 600;
/** The most /api/librarian/speak takes in one request. */
const PART_MAX = 400;
/** How long fetching her voice may take before she gives up and just mouths the line. */
const START_TIMEOUT_MS = 7000;
/** The text runs this far (s) ahead of her voice, so it never trails behind it. */
const TEXT_LEAD = 0.06;
/** Her pace (characters a second), for when the endpoint sends no timings. */
const CHARS_PER_SECOND = 15;
/** With no voice she mouths a line about as fast as the dialogue box types it out (~45 a second). */
const MOUTH_MS_PER_CHAR = 24;

interface Clip {
  el: HTMLAudioElement;
  /** When each character of the part starts (s), from ElevenLabs; null if it sent none. */
  starts: number[] | null;
  /** Disconnects it from the loudness meter. */
  release: () => void;
}

interface Part {
  /** What's sent: a stretch of whole sentences of the line. */
  text: string;
  /** Where it starts in the line. */
  offset: number;
  audio: Promise<Clip | null> | null;
}

interface Utterance {
  /** The message text exactly as given, its whitespace-collapsed form, and clean → text indices. */
  text: string;
  clean: string;
  toText: number[];
  /** What she says aloud (a prefix of `clean`), in parts. */
  line: string;
  parts: Part[];
  /** Her voice has started (until then the line's text stays hidden). */
  started: boolean;
  /** Characters of `clean` said in the parts that have finished. */
  said: number;
  /** The part playing now (null between parts and before she starts). */
  clip: Clip | null;
  index: number;
  ctrl: AbortController;
}

/** The line she's saying, or about to say once her voice arrives. */
let utterance: Utterance | null = null;
let context: AudioContext | null = null;
let frame = 0;
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

/** Whether her voice is saying a line right now (from its first word until its last part ends). */
export function isSpeaking() {
  return !!utterance?.started;
}

/**
 * While her voice is saying exactly this message `text`: how many of its characters should show
 * now, in step with her words (all of it by the time she finishes, even when she only said the
 * first part of a long one). 0 while her voice for it is on its way (she starts within a few
 * seconds, or gives up). null when this isn't the line she's saying: not asked for, finished,
 * stopped, muted or no voice, so show it all.
 */
export function revealedChars(text: string): number | null {
  const u = utterance;
  if (!u) return null;
  let toText = u.toText;
  if (text !== u.text) {
    if (text.length < u.clean.length) return null;
    const other = normalize(text);
    if (other.clean !== u.clean) return null;
    toText = other.toText;
  }
  if (!u.started) return 0;
  let said = u.said;
  const clip = u.clip;
  if (clip) {
    const part = u.parts[u.index]!;
    const n = part.text.length;
    const t = clip.el.currentTime + TEXT_LEAD;
    let k: number;
    if (clip.el.ended) k = n;
    else if (clip.starts?.length)
      k = Math.round((countUpTo(clip.starts, t) * n) / clip.starts.length);
    else if (Number.isFinite(clip.el.duration) && clip.el.duration > 0)
      k = Math.round((n * t) / clip.el.duration);
    else k = Math.round(t * CHARS_PER_SECOND);
    k = Math.min(n, k);
    // The last word of her last part: the rest of the text shows with it.
    if (k >= n && u.index === u.parts.length - 1) return text.length;
    said = part.offset + k;
  }
  if (said >= u.clean.length) return text.length;
  let shown = toText[said]!;
  // Never split a surrogate pair.
  const code = text.charCodeAt(shown - 1);
  if (code >= 0xd800 && code <= 0xdbff) shown++;
  return shown;
}

/** Stops whatever she's saying (or about to say), voice and mouthing alike. */
export function stopSpeaking() {
  const u = utterance;
  utterance = null;
  if (u) {
    u.ctrl.abort();
    u.clip?.el.pause();
    // The part playing, and any fetched ahead that she never got to.
    for (const p of u.parts) void p.audio?.then((c) => c?.release());
  }
  cancelAnimationFrame(frame);
  librarianPresence.speaking = false;
  librarianPresence.mouth = 0;
  librarianPresence.speakUntil = 0;
}

/** Collapses whitespace like `speakable` does, remembering where each kept character came from. */
function normalize(text: string) {
  let clean = "";
  const toText: number[] = [];
  let gap = -1;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i]!)) {
      if (gap < 0) gap = i;
      continue;
    }
    if (gap >= 0 && clean) {
      clean += " ";
      toText.push(gap);
    }
    gap = -1;
    clean += text[i];
    toText.push(i);
  }
  return { clean, toText };
}

/** Sentences, each with the space after it. A full stop inside "openstax.org" doesn't end one. */
function sentences(text: string) {
  return text.match(/.*?[.!?]+["')\]]*(?:\s+|$)|.+$/gs) ?? [];
}

/** The first `max` characters or fewer, cut at a space when there's one in the second half. */
function cutAtWord(text: string, max: number) {
  if (text.length <= max) return text;
  const space = text.slice(0, max + 1).lastIndexOf(" ");
  return text.slice(0, space > max / 2 ? space : max);
}

/** The part of a reply she says aloud: whole sentences, up to MAX_SPOKEN characters. */
export function speakable(text: string) {
  const clean = text.replace(/\s+/g, " ").trim();
  let out = "";
  for (const s of sentences(clean)) {
    if ((out + s).trimEnd().length > MAX_SPOKEN) {
      if (!out) out = cutAtWord(s, MAX_SPOKEN);
      break;
    }
    out += s;
  }
  return out.trim();
}

/** Splits what she says into requests the endpoint takes (≤ PART_MAX), at sentence ends. */
export function voiceParts(line: string) {
  const parts: { text: string; offset: number }[] = [];
  let start = 0;
  while (start < line.length) {
    let end = start;
    for (const s of sentences(line.slice(start))) {
      if (end > start && end - start + s.trimEnd().length > PART_MAX) break;
      end += s.length;
    }
    // One sentence longer than a request: break it at a word.
    if (line.slice(start, end).trimEnd().length > PART_MAX)
      end = start + cutAtWord(line.slice(start), PART_MAX).length;
    parts.push({ text: line.slice(start, end).trim(), offset: start });
    start = end;
    while (line[start] === " ") start++;
  }
  return parts;
}

/** How many of the (ascending) times are at or before `t`. */
function countUpTo(times: number[], t: number) {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid]! <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** She mouths a line she can't say aloud, for about as long as it would take (within limits). */
function mouth(line: string) {
  librarianPresence.speakUntil =
    performance.now() + Math.min(6000, Math.max(SPEAK_MS, line.length * MOUTH_MS_PER_CHAR));
}

/**
 * Says `text` in her voice, cutting off any line she's saying. Resolves once she has started (or
 * fallen back to mouthing it). Asking for the line she's already saying changes nothing.
 */
export async function sayAloud(text: string) {
  if (utterance && utterance.text === text) return;
  stopSpeaking();
  const { clean, toText } = normalize(text);
  const line = speakable(clean);
  if (!line) return;
  if (!available || isMuted()) return mouth(line);
  const u: Utterance = {
    text,
    clean,
    toText,
    line,
    parts: voiceParts(line).map((p) => ({ ...p, audio: null })),
    started: false,
    said: 0,
    clip: null,
    index: 0,
    ctrl: new AbortController(),
  };
  utterance = u;
  const timeout = setTimeout(() => {
    if (utterance !== u || u.started) return;
    stopSpeaking();
    mouth(line);
  }, START_TIMEOUT_MS);
  try {
    await play(u, 0);
  } finally {
    clearTimeout(timeout);
  }
}

/** Plays part `i` of the line (fetching it if it isn't already on its way), then the next. */
async function play(u: Utterance, i: number) {
  const part = u.parts[i]!;
  part.audio ??= fetchClip(part.text, u.ctrl.signal);
  const clip = await part.audio;
  if (utterance !== u) {
    clip?.release();
    return;
  }
  if (!clip) {
    // No voice for this part: she mouths the line if she hadn't started it, and the text shows.
    stopSpeaking();
    if (i === 0) mouth(u.line);
    return;
  }
  const next = u.parts[i + 1];
  if (next) next.audio ??= fetchClip(next.text, u.ctrl.signal);
  u.index = i;
  u.clip = clip;
  clip.el.onended = () => {
    if (utterance !== u || u.clip !== clip) return;
    clip.release();
    u.clip = null;
    if (!next) return finish(u);
    u.said = next.offset;
    void play(u, i + 1);
  };
  try {
    await clip.el.play();
  } catch {
    // Autoplay blocked: she mouths the line and the text shows.
    if (utterance !== u) return;
    stopSpeaking();
    mouth(u.line);
    return;
  }
  if (utterance !== u) return;
  u.started = true;
  librarianPresence.speaking = true;
  // While her voice plays, the voice drives her jaw (not the timed mouthing).
  librarianPresence.speakUntil = 0;
  followLoudness(u, clip);
}

/** She finished the line. */
function finish(u: Utterance) {
  if (utterance !== u) return;
  utterance = null;
  cancelAnimationFrame(frame);
  librarianPresence.speaking = false;
  librarianPresence.mouth = 0;
}

/** Her voice for one part of a line, with its character timings; null if it couldn't be had. */
async function fetchClip(text: string, signal: AbortSignal): Promise<Clip | null> {
  try {
    const res = await fetch("/api/librarian/speak", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
      signal,
    });
    if (res.status === 503) available = false;
    if (!res.ok) return null;
    const data = (await res.json()) as {
      audio?: string;
      alignment?: { starts?: number[] } | null;
    };
    if (!data.audio || signal.aborted) return null;
    const el = new Audio(`data:audio/mpeg;base64,${data.audio}`);
    const starts = Array.isArray(data.alignment?.starts) ? data.alignment.starts : null;
    return { el, starts, release: route(el) };
  } catch {
    return null;
  }
}

/** Analysers for the clips routed through Web Audio, to read their loudness. */
const meters = new WeakMap<HTMLAudioElement, AnalyserNode>();

/**
 * Sends the clip through an analyser so her jaw can follow it. Only when Web Audio is running: a
 * clip routed into a suspended context would be silent, so then it plays directly instead.
 */
function route(el: HTMLAudioElement) {
  try {
    context ??= new AudioContext();
    if (context.state === "suspended") void context.resume();
    if (context.state !== "running") return () => {};
    const source = context.createMediaElementSource(el);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    analyser.connect(context.destination);
    meters.set(el, analyser);
    return () => {
      source.disconnect();
      analyser.disconnect();
      meters.delete(el);
    };
  } catch {
    return () => {};
  }
}

/** Reads the clip's loudness every frame into `librarianPresence.mouth`. */
function followLoudness(u: Utterance, clip: Clip) {
  const analyser = meters.get(clip.el);
  const samples = analyser ? new Uint8Array(analyser.fftSize) : null;
  const tick = () => {
    if (utterance !== u || u.clip !== clip) return;
    if (analyser && samples) {
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const v of samples) sum += ((v - 128) / 128) ** 2;
      librarianPresence.mouth = Math.min(1, Math.sqrt(sum / samples.length) * 5);
    } else {
      // Not metered: open and close on the letters she's saying (from the timings), else a flutter.
      const t = clip.el.currentTime;
      const at = clip.starts ? countUpTo(clip.starts, t) - 1 : -1;
      const ch = at >= 0 ? (u.parts[u.index]?.text[at] ?? " ") : "a";
      const voiced = /[a-z0-9]/i.test(ch);
      librarianPresence.mouth = voiced ? 0.35 + 0.3 * Math.abs(Math.sin(t * 11)) : 0.05;
    }
    frame = requestAnimationFrame(tick);
  };
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(tick);
}
