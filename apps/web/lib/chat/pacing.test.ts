import { describe, expect, it } from "vitest";
import { CHAT } from "@ovr/shared";
import { LineBucket, TYPING_REFRESH_MS, TypingSignal } from "./pacing";

function signal(ok = true) {
  const sent: boolean[] = [];
  const s = new TypingSignal((on) => {
    sent.push(on);
    return ok;
  });
  return { s, sent };
}

describe("TypingSignal", () => {
  it("says on once the box has text, and off when it's emptied", () => {
    const { s, sent } = signal();
    s.input("", 0);
    expect(sent).toEqual([]);
    s.input("h", 0);
    s.input("hi", 100);
    expect(sent).toEqual([true]);
    s.input("", 700);
    expect(sent).toEqual([true, false]);
    expect(s.active).toBe(false);
  });
  it("refreshes while you keep typing, not more often", () => {
    const { s, sent } = signal();
    for (let t = 0; t <= TYPING_REFRESH_MS * 2; t += 100) s.input(`x${t}`, t);
    expect(sent).toEqual([true, true, true]);
  });
  it("stops on send or leaving the box, once", () => {
    const { s, sent } = signal();
    s.input("hey", 0);
    s.stop(10);
    s.stop(20);
    expect(sent).toEqual([true, false]);
  });
  it("never goes faster than the server's typing rate: a skipped on is tried again", () => {
    const { s, sent } = signal();
    s.input("a", 0);
    s.input("", 50);
    s.input("b", 100);
    expect(sent).toEqual([true, false]);
    s.input("bc", 50 + 1000 / CHAT.TYPING_HZ);
    expect(sent).toEqual([true, false, true]);
  });
  it("whitespace alone isn't typing", () => {
    const { s, sent } = signal();
    s.input("   ", 0);
    expect(sent).toEqual([]);
  });
  it("offline, nothing counts as said", () => {
    const { s } = signal(false);
    s.input("hi", 0);
    expect(s.active).toBe(false);
  });
  it("after a reset, the next keystroke says on straight away", () => {
    const { s, sent } = signal();
    s.input("hi", 0);
    s.reset();
    s.input("hi!", 10);
    expect(sent).toEqual([true, true]);
  });
});

describe("LineBucket", () => {
  it("lets a burst through, then one line per refill", () => {
    const b = new LineBucket(0.5, 4);
    for (let i = 0; i < 4; i++) expect(b.take(0)).toBe(true);
    expect(b.take(0)).toBe(false);
    expect(b.wait(0)).toBe(2000);
    expect(b.take(1999)).toBe(false);
    expect(b.take(2000)).toBe(true);
    expect(b.wait(2000)).toBeGreaterThan(0);
  });
  it("refills to the burst at most", () => {
    const b = new LineBucket(0.5, 4);
    b.take(0);
    expect(b.wait(1e9)).toBe(0);
    let n = 0;
    while (b.take(1e9)) n += 1;
    expect(n).toBe(4);
  });
  it("defaults to the contract's limits", () => {
    const b = new LineBucket();
    let n = 0;
    while (b.take(0)) n += 1;
    expect(n).toBe(CHAT.BURST);
  });
});
