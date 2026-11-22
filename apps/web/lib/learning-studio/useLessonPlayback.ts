"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { withEveryCheckpoint } from "./checkpoints";
import type { Lesson, Scene } from "./schema";
import { type NarrationMode, type NarrationState, useNarration } from "./useNarration";
import { trackLessonCompleted, trackLessonStarted } from "@/lib/learning/client";

/**
 * Everything about playing a lesson except how it looks: the scene, the narration, speed, volume,
 * captions and answered questions. It lives apart from the player UI so one playback can drive
 * several views at once (a whiteboard in the library, its corner preview and the full-screen
 * player) and switching between them never restarts the lesson.
 */
export interface LessonPlayback {
  lesson: Lesson;
  index: number;
  scene: Scene;
  last: boolean;
  /** The lesson has been started at least once. */
  started: boolean;
  rate: number;
  setRate: (r: number) => void;
  volume: number;
  setVolume: (v: number) => void;
  captionsOn: boolean;
  setCaptionsOn: (on: boolean | ((prev: boolean) => boolean)) => void;
  questionDone: Record<string, boolean>;
  /** The scene has a knowledge check, its narration has ended and it isn't answered yet. */
  showQuestion: boolean;
  /** Marks the current scene's knowledge check answered. */
  completeQuestion: () => void;
  narration: {
    state: NarrationState;
    progress: number;
    caption: string;
    mode: NarrationMode;
    play(): Promise<void>;
    pause(): void;
    restart(): void;
    stop(): void;
  };
  /** The narration is playing or loading. */
  playing: boolean;
  /** The last scene has ended and nothing is left to answer. */
  complete: boolean;
  /** Moves to a scene (clamped); keeps playing if the lesson was playing. */
  go: (to: number) => void;
  /** Start, pause, resume or replay. */
  toggle: () => void;
}

/**
 * Plays `lesson`. A different lesson needs a fresh playback, so key the caller by lesson.
 * `autoStart` begins speaking on mount; browsers only allow that soon after a click or key press,
 * so use it right after one (like pressing Join). `audio` maps scene indexes to stored narration
 * (a cloud lesson's MP3s): those scenes play the file instead of asking for new speech.
 */
export function useLessonPlayback(
  given: Lesson,
  {
    startScene = 0,
    autoStart = false,
    onProgress,
    audio,
  }: {
    startScene?: number;
    autoStart?: boolean;
    onProgress?: (scene: number, completed: boolean) => void;
    audio?: Readonly<Record<number, string>>;
  } = {},
): LessonPlayback {
  // Every section asks something before the next, lessons made before that rule included.
  const lesson = useMemo(() => withEveryCheckpoint(given), [given]);
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(startScene, lesson.scenes.length - 1)),
  );
  const [rate, setRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [captionsOn, setCaptionsOn] = useState(true);
  const [questionDone, setQuestionDone] = useState<Record<string, boolean>>({});
  const scene = lesson.scenes[index]!;
  const narration = useNarration(scene.narration, { rate, volume }, audio?.[index] ?? null);
  const last = index === lesson.scenes.length - 1;
  const playing = narration.state === "playing" || narration.state === "loading";
  const showQuestion =
    !!scene.interaction && narration.state === "ended" && !questionDone[scene.id];
  const complete =
    last && narration.state === "ended" && (!scene.interaction || !!questionDone[scene.id]);

  // Latches the first time any narration starts, however it was started (toggle, autoStart or
  // narration.play() directly), so `started` always means what it says.
  const [started, setStarted] = useState(() => autoStart);
  if (!started && narration.state !== "idle") setStarted(true);

  // Learning analytics: the server registers the lesson when it first plays and decides whether
  // a completion counts (lib/learning). Each is sent once per lesson per page.
  useEffect(() => {
    if (started) void trackLessonStarted(lesson);
  }, [started, lesson]);
  useEffect(() => {
    if (complete) void trackLessonCompleted(lesson);
  }, [complete, lesson]);

  // Kept in a ref so callers can pass an inline callback without re-reporting on every render.
  const onProgressRef = useRef(onProgress);
  useEffect(() => {
    onProgressRef.current = onProgress;
  });

  const go = useCallback(
    (to: number) => {
      const next = Math.max(0, Math.min(lesson.scenes.length - 1, to));
      if (next === index) return;
      setIndex(next);
      onProgressRef.current?.(next, false);
    },
    [index, lesson.scenes.length],
  );

  // Moving to a new scene keeps playing if the lesson was playing. This must run before the
  // effect below records the new scene's (idle) state.
  const autoplay = useRef(false);
  useEffect(() => {
    if (autoplay.current) void narration.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on scene change
  }, [index]);
  useEffect(() => {
    autoplay.current = playing;
  }, [playing]);

  // autoStart speaks once on mount. StrictMode's second run is harmless: every play() stops the
  // one before it (useNarration bumps its run id), so only one voice is ever heard.
  useEffect(() => {
    if (autoStart) void narration.play();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  useEffect(() => {
    if (complete) onProgressRef.current?.(index, true);
  }, [complete, index]);

  const completeQuestion = useCallback(
    () => setQuestionDone((d) => ({ ...d, [scene.id]: true })),
    [scene.id],
  );

  const toggle = useCallback(() => {
    if (playing) narration.pause();
    else if (narration.state === "ended") narration.restart();
    else void narration.play();
  }, [playing, narration]);

  return {
    lesson,
    index,
    scene,
    last,
    started,
    rate,
    setRate,
    volume,
    setVolume,
    captionsOn,
    setCaptionsOn,
    questionDone,
    showQuestion,
    completeQuestion,
    narration,
    playing,
    complete,
    go,
    toggle,
  };
}
