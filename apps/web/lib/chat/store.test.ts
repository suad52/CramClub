import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChatLine, FENWICK_ID, FENWICK_NAME } from "@ovr/shared";

vi.hoisted(() => {
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, String(value)),
      removeItem: (key: string) => void items.delete(key),
    },
  });
});

const {
  catchUpHistory,
  chatLive,
  clearChatPresence,
  focusChat,
  forgetPlayer,
  receiveLine,
  resetChat,
  setChatOpen,
  setFenwickAnswers,
  setFenwickTyping,
  setHistory,
  setPlayerTyping,
  useChat,
} = await import("./store");

const line = (over: Partial<ChatLine> = {}): ChatLine => ({
  id: "c1",
  from: "s2",
  name: "Theo",
  text: "hi",
  at: 1,
  ...over,
});

beforeEach(() => {
  resetChat();
  useChat.setState({ draft: "", fenwick: true });
});
afterEach(() => vi.useRealTimers());

describe("chat store", () => {
  it("counts lines from others while it's closed, not yours, not when open", () => {
    receiveLine(line({ id: "a" }), "me", 10);
    receiveLine(line({ id: "b", from: "me", name: "Sam" }), "me", 11);
    expect(useChat.getState().unread).toBe(1);
    setChatOpen(true);
    expect(useChat.getState().unread).toBe(0);
    receiveLine(line({ id: "c" }), "me", 12);
    expect(useChat.getState().unread).toBe(0);
    expect(useChat.getState().lines.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
  it("ignores a repeated line", () => {
    expect(receiveLine(line({ id: "a" }), "me")).toBe(true);
    expect(receiveLine(line({ id: "a" }), "me")).toBe(false);
    expect(useChat.getState().lines).toHaveLength(1);
  });
  it("puts their line in their bubble and ends their typing", () => {
    setPlayerTyping("s2", true);
    expect(useChat.getState().typing).toEqual(["s2"]);
    receiveLine(line({ id: "a", text: "hello" }), "me", 500);
    expect(useChat.getState().typing).toEqual([]);
    expect(chatLive.players.get("s2")).toEqual({ text: "hello", at: 500, typing: false });
  });
  it("never gives you a bubble of your own", () => {
    receiveLine(line({ id: "a", from: "me" }), "me", 5);
    expect(chatLive.players.has("me")).toBe(false);
  });
  it("tracks who's typing, once each, in order", () => {
    setPlayerTyping("a", true);
    setPlayerTyping("b", true);
    setPlayerTyping("a", true);
    expect(useChat.getState().typing).toEqual(["a", "b"]);
    setPlayerTyping("a", false);
    expect(useChat.getState().typing).toEqual(["b"]);
    forgetPlayer("b");
    expect(useChat.getState().typing).toEqual([]);
    expect(chatLive.players.has("b")).toBe(false);
  });
  it("knows whom Ms. Fenwick is writing to, and her line ends it", () => {
    setFenwickTyping(true, "me");
    setFenwickTyping(true, "s2");
    expect(useChat.getState().fenwickTyping).toEqual(["me", "s2"]);
    expect(chatLive.fenwick.typing).toBe(true);
    receiveLine(
      line({ id: "f", from: FENWICK_ID, name: FENWICK_NAME, text: "Hello!", replyTo: "me" }),
      "me",
      900,
    );
    expect(useChat.getState().fenwickTyping).toEqual(["s2"]);
    expect(chatLive.fenwick.text).toBe("Hello!");
    expect(chatLive.fenwick.at).toBe(900);
    setFenwickTyping(false, "s2");
    expect(chatLive.fenwick.typing).toBe(false);
  });
  it("stops her typing if the off never comes", () => {
    vi.useFakeTimers();
    setFenwickTyping(true, "me");
    vi.advanceTimersByTime(60_000);
    expect(useChat.getState().fenwickTyping).toEqual([]);
  });
  it("history replaces the lines without counting them", () => {
    receiveLine(line({ id: "old" }), "me");
    setHistory([line({ id: "h1" }), line({ id: "h2" })]);
    expect(useChat.getState().lines.map((l) => l.id)).toEqual(["h1", "h2"]);
    expect(useChat.getState().unread).toBe(1);
  });
  it("after a reconnect, history only adds what was missed (counted, but no bubbles)", () => {
    receiveLine(line({ id: "c1", at: 1 }), "me");
    receiveLine(line({ id: "c2", at: 2, from: "me", name: "Me" }), "me");
    const unread = useChat.getState().unread;
    const before = chatLive.players.get("s2")?.text;
    catchUpHistory(
      [
        line({ id: "c1", at: 1 }),
        line({ id: "c2", at: 2, from: "me", name: "Me" }),
        line({ id: "c3", at: 3, text: "missed you" }),
        line({ id: "c4", at: 4, from: "me", name: "Me", text: "my other tab" }),
      ],
      "me",
    );
    expect(useChat.getState().lines.map((l) => l.id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(useChat.getState().unread).toBe(unread + 1);
    expect(chatLive.players.get("s2")?.text).toBe(before);
    // Nothing new: nothing changes.
    const lines = useChat.getState().lines;
    catchUpHistory([line({ id: "c3", at: 3 })], "me");
    expect(useChat.getState().lines).toBe(lines);
  });
  it("a dropped link clears who's typing; leaving clears the lines", () => {
    setPlayerTyping("a", true);
    setFenwickTyping(true, "me");
    receiveLine(line({ id: "x" }), "me");
    clearChatPresence();
    expect(useChat.getState().typing).toEqual([]);
    expect(useChat.getState().fenwickTyping).toEqual([]);
    expect(useChat.getState().lines).toHaveLength(1);
    resetChat();
    expect(useChat.getState().lines).toEqual([]);
    expect(useChat.getState().unread).toBe(0);
  });
  it("focusChat opens it and asks for the cursor", () => {
    const before = useChat.getState().focusNonce;
    focusChat();
    expect(useChat.getState().open).toBe(true);
    expect(useChat.getState().focusNonce).toBe(before + 1);
  });
  it("remembers the Ms. Fenwick switch in this browser", () => {
    setFenwickAnswers(false);
    expect(useChat.getState().fenwick).toBe(false);
    expect(localStorage.getItem("ovr.chat.fenwick")).toBe("0");
    setFenwickAnswers(true);
    expect(localStorage.getItem("ovr.chat.fenwick")).toBe("1");
  });
});
