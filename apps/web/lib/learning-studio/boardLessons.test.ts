import { beforeEach, describe, expect, it } from "vitest";
import {
  type LiveBoardFrame,
  boardName,
  isLessonOverlayOpen,
  liveBoard,
  publishLiveFrame,
  shouldOfferJoin,
  tableNumberOf,
  useBoardLessons,
} from "./boardLessons";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "./mockLesson";

const BOARD = "hall-t03";
const OTHER = "hall-t11";
const entry = { sourceId: "sample", lesson: SAMPLE_LESSON, chunks: SAMPLE_NOTES };
const store = () => useBoardLessons.getState();

const frame = (patch: Partial<LiveBoardFrame> = {}): LiveBoardFrame => ({
  boardId: BOARD,
  index: 0,
  progress: 0.25,
  caption: "Cells need energy.",
  state: "playing",
  showQuestion: false,
  complete: false,
  ...patch,
});

beforeEach(() => {
  store().reset();
  publishLiveFrame(null);
});

describe("board lessons", () => {
  it("names boards by their table", () => {
    expect(tableNumberOf("hall-t03")).toBe(3);
    expect(tableNumberOf("hall-t12")).toBe(12);
    expect(boardName("hall-t07")).toBe("Table 7's board");
  });

  it("starting a lesson puts it on the board from the first scene and closes the picker", () => {
    store().openPicker(BOARD);
    store().start(BOARD, entry, 1000);
    expect(store().boards[BOARD]).toMatchObject({
      boardId: BOARD,
      sourceId: "sample",
      sceneIndex: 0,
      completed: false,
      startedAt: 1000,
    });
    expect(store().pickerBoardId).toBeNull();
    expect(store().joinedBoardId).toBeNull();
  });

  it("a lesson saved from Ms. Fenwick brings its recorded narration to the board", () => {
    const audio = { 0: "/api/lessons/job-1/audio/0", 2: "/api/lessons/job-1/audio/2" };
    store().start(BOARD, { ...entry, sourceId: "saved-fenwick", audio }, 1000);
    expect(store().boards[BOARD]?.audio).toEqual(audio);
    // A lesson with nothing recorded is voiced as before.
    store().start(OTHER, entry, 1000);
    expect(store().boards[OTHER]?.audio).toBeUndefined();
  });

  it("joining only works on a board with a lesson", () => {
    store().join(BOARD);
    expect(store().joinedBoardId).toBeNull();
    store().start(BOARD, entry, 1000);
    store().join(BOARD);
    expect(store().joinedBoardId).toBe(BOARD);
  });

  it("replacing the lesson you're watching takes you out of it (the new run needs a new join)", () => {
    store().start(BOARD, entry, 1000);
    store().join(BOARD);
    store().setFullscreen(true);
    store().start(BOARD, { ...entry, sourceId: "saved-1" }, 2000);
    expect(store().joinedBoardId).toBeNull();
    expect(store().fullscreen).toBe(false);
    expect(store().boards[BOARD]).toMatchObject({ sourceId: "saved-1", startedAt: 2000 });
  });

  it("replacing another board's lesson leaves your own lesson alone", () => {
    store().start(BOARD, entry, 1000);
    store().start(OTHER, entry, 1000);
    store().join(BOARD);
    store().setFullscreen(true);
    store().start(OTHER, entry, 2000);
    expect(store().joinedBoardId).toBe(BOARD);
    expect(store().fullscreen).toBe(true);
  });

  it('"Not now" holds for that run only, and joining later still works', () => {
    store().start(BOARD, entry, 1000);
    expect(shouldOfferJoin(store(), BOARD)).toBe(true);
    store().decline(BOARD);
    expect(shouldOfferJoin(store(), BOARD)).toBe(false);
    expect(store().declined[BOARD]).toBe(1000);

    // A new lesson on the same board is offered again.
    store().start(BOARD, entry, 2000);
    expect(shouldOfferJoin(store(), BOARD)).toBe(true);

    store().decline(BOARD);
    store().join(BOARD);
    expect(store().joinedBoardId).toBe(BOARD);
    expect(store().declined[BOARD]).toBeUndefined();
    // You're in it, so it isn't offered.
    expect(shouldOfferJoin(store(), BOARD)).toBe(false);
  });

  it("offers nothing for an empty board or no board", () => {
    expect(shouldOfferJoin(store(), BOARD)).toBe(false);
    expect(shouldOfferJoin(store(), null)).toBe(false);
    store().decline(BOARD);
    expect(store().declined).toEqual({});
  });

  it("leaving an unfinished lesson keeps it waiting on the board where it got to", () => {
    store().start(BOARD, entry, 1000);
    store().join(BOARD);
    store().setProgress(BOARD, 2, false);
    store().setFullscreen(true);
    store().leave();
    expect(store().joinedBoardId).toBeNull();
    expect(store().fullscreen).toBe(false);
    expect(store().boards[BOARD]).toMatchObject({ sceneIndex: 2, completed: false });
  });

  it('leaving counts as "Not now", so the join card stays away but joining again still works', () => {
    store().start(BOARD, entry, 1000);
    store().join(BOARD);
    store().leave();
    expect(store().declined[BOARD]).toBe(1000);
    expect(shouldOfferJoin(store(), BOARD)).toBe(false);
    store().join(BOARD);
    expect(store().joinedBoardId).toBe(BOARD);
  });

  it("leaving a finished lesson takes it off the board", () => {
    store().start(BOARD, entry, 1000);
    store().join(BOARD);
    store().setProgress(BOARD, SAMPLE_LESSON.scenes.length - 1, true);
    store().leave();
    expect(store().joinedBoardId).toBeNull();
    expect(store().boards[BOARD]).toBeUndefined();
    expect(store().declined).toEqual({});
  });

  it("ending the lesson you're watching flips the board back and takes you out", () => {
    store().start(BOARD, entry, 1000);
    store().join(BOARD);
    store().setFullscreen(true);
    store().end(BOARD);
    expect(store().boards[BOARD]).toBeUndefined();
    expect(store().joinedBoardId).toBeNull();
    expect(store().fullscreen).toBe(false);
  });

  it("full screen needs a joined lesson", () => {
    store().setFullscreen(true);
    expect(store().fullscreen).toBe(false);
    store().start(BOARD, entry, 1000);
    store().join(BOARD);
    store().setFullscreen(true);
    expect(store().fullscreen).toBe(true);
    store().setFullscreen(false);
    expect(store().fullscreen).toBe(false);
  });

  it("progress updates only change state when something changed", () => {
    store().start(BOARD, entry, 1000);
    const before = store().boards;
    store().setProgress(BOARD, 0, false);
    expect(store().boards).toBe(before);
    store().setProgress(BOARD, 1, false);
    expect(store().boards).not.toBe(before);
    expect(store().boards[BOARD]!.sceneIndex).toBe(1);
    // A board without a lesson is ignored.
    const after = store().boards;
    store().setProgress(OTHER, 3, true);
    expect(store().boards).toBe(after);
  });

  it("keeps the in-range board without re-notifying for the same value", () => {
    let notified = 0;
    const unsubscribe = useBoardLessons.subscribe(() => notified++);
    store().setInRange(BOARD);
    store().setInRange(BOARD);
    store().setInRange(null);
    unsubscribe();
    expect(notified).toBe(2);
    expect(store().inRangeBoardId).toBeNull();
  });

  it("knows when the picker or a full-screen lesson covers the library", () => {
    expect(isLessonOverlayOpen()).toBe(false);
    store().openPicker(BOARD);
    expect(isLessonOverlayOpen()).toBe(true);
    store().openPicker(null);
    expect(isLessonOverlayOpen()).toBe(false);
    store().start(BOARD, entry, 1000);
    store().join(BOARD);
    expect(isLessonOverlayOpen()).toBe(false);
    store().setFullscreen(true);
    expect(isLessonOverlayOpen()).toBe(true);
  });

  it("reset clears everything", () => {
    store().start(BOARD, entry, 1000);
    store().join(BOARD);
    store().setInRange(BOARD);
    store().reset();
    expect(store()).toMatchObject({
      boards: {},
      joinedBoardId: null,
      fullscreen: false,
      pickerBoardId: null,
      declined: {},
      inRangeBoardId: null,
    });
  });
});

describe("live board frame", () => {
  it("bumps the version only when the frame actually changes", () => {
    const v0 = liveBoard.version;
    publishLiveFrame(frame());
    expect(liveBoard.version).toBe(v0 + 1);
    // An equal frame (a new object with the same values) isn't a change.
    publishLiveFrame(frame());
    expect(liveBoard.version).toBe(v0 + 1);
    publishLiveFrame(frame({ progress: 0.5 }));
    expect(liveBoard.version).toBe(v0 + 2);
    expect(liveBoard.frame?.progress).toBe(0.5);
    publishLiveFrame(frame({ progress: 0.5, showQuestion: true }));
    expect(liveBoard.version).toBe(v0 + 3);
  });

  it("clears when nobody here is joined, once", () => {
    publishLiveFrame(frame());
    const v = liveBoard.version;
    publishLiveFrame(null);
    expect(liveBoard.frame).toBeNull();
    expect(liveBoard.version).toBe(v + 1);
    publishLiveFrame(null);
    expect(liveBoard.version).toBe(v + 1);
  });
});
