import { beforeEach, describe, expect, it } from "vitest";
import { emptyTally } from "./presence";
import { focusPresence, focusSession, showSessionXp } from "./session";
import { type FocusRecap, useFocusStore } from "./store";

const recap = (at: number): FocusRecap => ({
  at,
  preview: null,
  count: 1,
  long: false,
  minutes: 25,
  presence: undefined,
  percent: null,
  companions: [],
  xp: undefined,
  pick: 0,
});

beforeEach(() => {
  focusSession.tally = emptyTally();
  useFocusStore.setState({ recap: null, recapShown: false });
});

describe("focusPresence", () => {
  it("is the tally as session-complete's presence, capped at the pomodoro's length", () => {
    expect(focusPresence(1500)).toBeUndefined();
    focusSession.tally = { ...emptyTally(), cameraMs: 1_600_000, seenMs: 1_200_400 };
    expect(focusPresence(1500)).toEqual({ cameraSeconds: 1500, seenSeconds: 1200 });
  });
});

describe("showSessionXp", () => {
  it("puts the XP on the card for that pomodoro, and says whether the card is up", () => {
    useFocusStore.setState({ recap: recap(42), recapShown: true });
    expect(showSessionXp(42, 25)).toBe(true);
    expect(useFocusStore.getState().recap?.xp).toBe(25);
  });

  it("leaves a toast to say it when the card has gone", () => {
    useFocusStore.setState({ recap: recap(42), recapShown: false });
    expect(showSessionXp(42, 25)).toBe(false);
  });

  it("ignores an answer for another pomodoro", () => {
    useFocusStore.setState({ recap: recap(42), recapShown: true });
    expect(showSessionXp(41, 25)).toBe(false);
    expect(useFocusStore.getState().recap?.xp).toBeUndefined();
    useFocusStore.setState({ recap: null });
    expect(showSessionXp(42, 25)).toBe(false);
  });
});
