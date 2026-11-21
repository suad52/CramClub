"use client";

import { usePomodoro } from "@/lib/game/pomodoro";
import type { Lesson, Scene } from "@/lib/learning-studio/schema";

/**
 * The browser's side of learning analytics: it reports what happened (a pomodoro started or
 * rang, a lesson finished, which option was picked) and the server decides what counts and what
 * it's worth. Nothing here sends XP or durations it could make up. Failures are silent: studying
 * must never break because the progress database is unreachable.
 */

/** Fired on window when the server awards XP: `{ xp, label }`, for the "+25 XP" toast. */
export const XP_EVENT = "ovr:xp";

async function post(action: string, body: unknown): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`/api/learning/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      keepalive: true,
    });
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function announce(result: Record<string, unknown> | null, label: string) {
  const xp = typeof result?.xp === "number" ? result.xp : 0;
  if (xp > 0) window.dispatchEvent(new CustomEvent(XP_EVENT, { detail: { xp, label } }));
}

export function saveProfile(profile: { displayName?: string; leaderboardOptIn?: boolean }) {
  return post("profile", profile);
}

/* ---- Lessons ---- */

/** A stable id for a lesson, from its content (lessons live in the browser, with no server id). */
export function lessonKey(lesson: Lesson) {
  const text = [
    lesson.title,
    lesson.subject,
    ...lesson.scenes.map((s) => `${s.id}:${s.title}`),
  ].join("|");
  // Two FNV-1a passes with different seeds: 64 bits, plenty for one student's lessons.
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 13);
  }
  return `l-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

const started = new Map<string, Promise<unknown>>();
const finished = new Set<string>();

/** Registers a lesson the first time it plays in this page (its answer key included). */
export function trackLessonStarted(lesson: Lesson) {
  const id = lessonKey(lesson);
  let pending = started.get(id);
  if (!pending) {
    const answerKey: Record<string, number> = {};
    for (const s of lesson.scenes)
      if (s.interaction?.type === "multiple-choice" && s.interaction.correctIndex !== undefined)
        answerKey[s.id] = s.interaction.correctIndex;
    pending = post("lesson-start", {
      lessonId: id,
      title: lesson.title,
      subject: lesson.subject,
      sceneCount: lesson.scenes.length,
      answerKey,
    });
    started.set(id, pending);
  }
  return pending;
}

export async function trackLessonCompleted(lesson: Lesson) {
  const id = lessonKey(lesson);
  if (finished.has(id)) return;
  finished.add(id);
  await trackLessonStarted(lesson);
  announce(await post("lesson-complete", { lessonId: id }), "Lesson completed");
}

/** The option picked in a scene's knowledge check (multiple choice only). */
export async function trackQuizAnswer(lesson: Lesson, scene: Scene, picked: number) {
  if (scene.interaction?.type !== "multiple-choice") return;
  await trackLessonStarted(lesson);
  const result = await post("quiz", { lessonId: lessonKey(lesson), quizId: scene.id, picked });
  announce(result, result?.correct ? "Knowledge check — first try!" : "Knowledge check");
}

/* ---- Focus sessions (the table timer) ---- */

/**
 * Mirrors the table timer's pomodoros to the server: start when focus starts, complete when it
 * rings, abandon when it's given up. The server times the session with its own clock. Returns
 * an unsubscribe.
 */
export function trackPomodoros() {
  let session: Promise<string | null> | null = null;
  return usePomodoro.subscribe((s, prev) => {
    if (s.phase === "focus" && prev.phase !== "focus") {
      session = post("session-start", { plannedMinutes: s.settings.focusMinutes }).then((r) =>
        typeof r?.sessionId === "string" ? r.sessionId : null,
      );
      return;
    }
    if (prev.phase !== "focus" || s.phase === "focus" || !session) return;
    const rang = s.notice?.kind === "focusDone";
    const pending = session;
    session = null;
    void pending.then(async (sessionId) => {
      if (!sessionId) return;
      if (rang) announce(await post("session-complete", { sessionId }), "Pomodoro completed");
      else await post("session-abandon", { sessionId });
    });
  });
}
