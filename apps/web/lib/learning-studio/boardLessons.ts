"use client";

import { create } from "zustand";
import type { Chunk, Lesson } from "./schema";
import type { NarrationState } from "./useNarration";

/**
 * Lessons played on the library's rolling whiteboards. Putting a lesson on a board flips the board
 * over to its other face, where the lesson plays like a video. People near the board can join
 * (they hear the narration, see a live preview in the corner of the screen and can open it full
 * screen) or not. A board lesson moves on only while someone is joined; otherwise it waits on the
 * board, showing where it got to.
 *
 * Everything here is plain, serialisable data, so a later multiplayer phase can share `boards`
 * through the game server. For now it's all local to this browser.
 */

export interface BoardLesson {
  boardId: string;
  /** Where it came from: a saved lesson id (Learning Studio, in localStorage) or "sample". */
  sourceId: string;
  lesson: Lesson;
  /** The notes it was made from, for the AI teacher's answers. */
  chunks: Chunk[];
  /** The scene the lesson is on; it resumes here when someone joins. */
  sceneIndex: number;
  completed: boolean;
  /** When it was put on the board (ms). Identifies this run, e.g. for "Not now". */
  startedAt: number;
}

export interface BoardLessonStore {
  /** Lessons on boards, by board id (one per board). A board with a lesson is flipped over. */
  boards: Record<string, BoardLesson>;
  /** The board whose lesson this player has joined, if any. */
  joinedBoardId: string | null;
  /** The joined lesson is open full screen. */
  fullscreen: boolean;
  /** The lesson picker is open for this board. */
  pickerBoardId: string | null;
  /** Board id → `startedAt` of the run the player said "Not now" to (so the offer doesn't nag). */
  declined: Record<string, number>;
  /** The nearest board with a lesson within {@link JOIN_RANGE}, if any (kept by the player loop). */
  inRangeBoardId: string | null;

  /** Puts a lesson on a board (replacing any lesson already there) and closes the picker. */
  start: (
    boardId: string,
    entry: Pick<BoardLesson, "sourceId" | "lesson" | "chunks">,
    now?: number,
  ) => void;
  /** Takes the lesson off a board (it flips back). Anyone joined to it leaves. */
  end: (boardId: string) => void;
  join: (boardId: string) => void;
  /**
   * Leaves the joined lesson. A finished lesson is taken off its board as you leave; an unfinished
   * one waits there, and leaving counts as "Not now" to it (join again from the board, with J).
   */
  leave: () => void;
  /** "Not now" to the current run on a board. */
  decline: (boardId: string) => void;
  setFullscreen: (on: boolean) => void;
  openPicker: (boardId: string | null) => void;
  setProgress: (boardId: string, sceneIndex: number, completed: boolean) => void;
  setInRange: (boardId: string | null) => void;
  /** Clears everything (leaving the library). */
  reset: () => void;
}

const INITIAL = {
  boards: {},
  joinedBoardId: null,
  fullscreen: false,
  pickerBoardId: null,
  declined: {},
  inRangeBoardId: null,
} satisfies Partial<BoardLessonStore>;

const without = <T>(record: Record<string, T>, key: string) => {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
};

export const useBoardLessons = create<BoardLessonStore>()((set, get) => ({
  ...INITIAL,

  start: (boardId, entry, now = Date.now()) =>
    set((s) => {
      const leaving = s.joinedBoardId === boardId;
      return {
        boards: {
          ...s.boards,
          [boardId]: { ...entry, boardId, sceneIndex: 0, completed: false, startedAt: now },
        },
        // A new run on your board needs a fresh "join".
        joinedBoardId: leaving ? null : s.joinedBoardId,
        fullscreen: leaving ? false : s.fullscreen,
        declined: without(s.declined, boardId),
        pickerBoardId: null,
      };
    }),

  end: (boardId) =>
    set((s) => {
      const leaving = s.joinedBoardId === boardId;
      return {
        boards: without(s.boards, boardId),
        joinedBoardId: leaving ? null : s.joinedBoardId,
        fullscreen: leaving ? false : s.fullscreen,
        declined: without(s.declined, boardId),
      };
    }),

  join: (boardId) =>
    set((s) =>
      s.boards[boardId]
        ? { joinedBoardId: boardId, declined: without(s.declined, boardId), pickerBoardId: null }
        : {},
    ),

  leave: () => {
    const id = get().joinedBoardId;
    if (!id) return;
    const run = get().boards[id];
    if (!run || run.completed) {
      get().end(id);
      return;
    }
    // You chose to go, so the join card mustn't pop straight back up while you're still nearby.
    set((s) => ({
      joinedBoardId: null,
      fullscreen: false,
      declined: { ...s.declined, [id]: run.startedAt },
    }));
  },

  decline: (boardId) =>
    set((s) => {
      const run = s.boards[boardId];
      return run ? { declined: { ...s.declined, [boardId]: run.startedAt } } : {};
    }),

  setFullscreen: (on) => set((s) => ({ fullscreen: on && s.joinedBoardId !== null })),

  openPicker: (pickerBoardId) => set({ pickerBoardId }),

  setProgress: (boardId, sceneIndex, completed) =>
    set((s) => {
      const run = s.boards[boardId];
      if (!run || (run.sceneIndex === sceneIndex && run.completed === completed)) return {};
      return { boards: { ...s.boards, [boardId]: { ...run, sceneIndex, completed } } };
    }),

  setInRange: (inRangeBoardId) => {
    if (get().inRangeBoardId !== inRangeBoardId) set({ inRangeBoardId });
  },

  reset: () => set({ ...INITIAL }),
}));

/** Players within this distance (metres, same floor) of a board with a lesson are offered to join. */
export const JOIN_RANGE = 6;

/** "Table 3" style number from a board id such as "hall-t03". */
export const tableNumberOf = (boardId: string) => Number(/(\d+)$/.exec(boardId)?.[1] ?? 0);
export const boardName = (boardId: string) => `Table ${tableNumberOf(boardId)}'s board`;

/** Whether this player should be offered to join the lesson on `boardId` right now. */
export function shouldOfferJoin(s: BoardLessonStore, boardId: string | null): boolean {
  if (!boardId) return false;
  const run = s.boards[boardId];
  return !!run && s.joinedBoardId !== boardId && s.declined[boardId] !== run.startedAt;
}

/** The picker or the full-screen lesson is covering the library (game keys and mouse-look off). */
export function isLessonOverlayOpen() {
  const s = useBoardLessons.getState();
  return s.fullscreen || s.pickerBoardId !== null;
}

/**
 * The joined lesson's live playback, written by the lesson director (DOM side) whenever it
 * changes and read every frame by the board painter (3D side). Kept outside React state so the
 * painter never re-renders the scene.
 */
export interface LiveBoardFrame {
  boardId: string;
  /** Scene index. */
  index: number;
  /** The scene's narration playhead, 0–1 (drives the visual's step-by-step reveal). */
  progress: number;
  /** The sentence being spoken ("" between sentences). */
  caption: string;
  state: NarrationState;
  /** The knowledge check is waiting for an answer. */
  showQuestion: boolean;
  /** The last scene has ended and nothing is left to answer. */
  complete: boolean;
}

export const liveBoard: { frame: LiveBoardFrame | null; version: number } = {
  frame: null,
  version: 0,
};

/** Publishes the joined lesson's playback (null when nobody here is joined); bumps on change. */
export function publishLiveFrame(frame: LiveBoardFrame | null) {
  const prev = liveBoard.frame;
  const same =
    prev === frame ||
    (prev !== null &&
      frame !== null &&
      (Object.keys(frame) as (keyof LiveBoardFrame)[]).every((k) => prev[k] === frame[k]));
  if (same) return;
  liveBoard.frame = frame;
  liveBoard.version += 1;
}

/** Board screen canvas size: the rolling board's writing surface is 1.36 × 0.92 m. */
export const BOARD_SCREEN = { width: 1280, height: 866 } as const;

/** What the board's lesson face shows. */
export type BoardScreenView =
  | {
      kind: "standby";
      lesson: Lesson;
      tableNumber: number;
      sceneIndex: number;
      completed: boolean;
    }
  | {
      kind: "live";
      lesson: Lesson;
      tableNumber: number;
      frame: LiveBoardFrame;
    };

/**
 * The canvases the 3D painter draws each board's lesson face on (by board id). The corner
 * preview mirrors the joined board's canvas, redrawing whenever `paints` goes up.
 */
export interface BoardScreen {
  canvas: HTMLCanvasElement;
  paints: number;
}
export const boardScreens = new Map<string, BoardScreen>();
