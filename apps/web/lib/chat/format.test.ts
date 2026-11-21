import { describe, expect, it } from "vitest";
import { CHAT, type ChatLine, FENWICK_ID, FENWICK_NAME } from "@ovr/shared";
import {
  BUBBLE_CHARS,
  BUBBLE_MS,
  CHAT_KEEP,
  DOT_STEP_MS,
  GROUP_GAP_MS,
  appendLine,
  bubbleFace,
  mergeLines,
  bubbleText,
  charsLeft,
  chatItems,
  cleanChatText,
  parseChatLine,
  parseHistory,
  shortName,
  typingLabel,
  wrapText,
} from "./format";

const line = (over: Partial<ChatLine> = {}): ChatLine => ({
  id: "c1",
  from: "s1",
  name: "Theo",
  text: "hi",
  at: 1000,
  ...over,
});

describe("cleanChatText", () => {
  it("collapses whitespace and drops control and invisible format characters", () => {
    expect(cleanChatText("  hello\n\tthere  ")).toBe("hello there");
    expect(cleanChatText("a‮b​c\u0007d")).toBe("abcd");
  });
  it("keeps the emoji joiner", () => {
    const technologist = "\u{1F469}‍\u{1F4BB}";
    expect(cleanChatText(`hi ${technologist}`)).toBe(`hi ${technologist}`);
  });
  it("cuts to the limit without splitting a surrogate pair", () => {
    expect(cleanChatText("x".repeat(500))).toHaveLength(CHAT.MAX_CHARS);
    const cut = cleanChatText(`${"x".repeat(CHAT.MAX_CHARS - 1)}\u{1F600}`);
    expect(cut).toBe("x".repeat(CHAT.MAX_CHARS - 1));
  });
  it("is empty for anything but a string", () => {
    expect(cleanChatText(42)).toBe("");
    expect(cleanChatText(null)).toBe("");
  });
  it("caps stacked accents and blanks out filler letters, like the server", () => {
    expect(cleanChatText(`a${"\u0301".repeat(199)}`)).toBe(`a${"\u0301".repeat(3)}`);
    expect(cleanChatText("1\ufe0f\u20e3 café")).toBe("1\ufe0f\u20e3 café");
    expect(cleanChatText("hi\u3164\u3164there")).toBe("hi there");
    for (const blank of ["\u3164\u3164", "\u2800", "\u0301\u0301", "\uffa0 \u115f"])
      expect(cleanChatText(blank)).toBe("");
    expect(parseChatLine({ id: "c9", from: "abc", name: "Ana", text: "\u3164", at: 5 })).toBeNull();
  });
});

describe("parseChatLine", () => {
  it("reads a player's line", () => {
    expect(parseChatLine({ id: "c4", from: "abc", name: "Ana", text: " yo ", at: 5 })).toEqual({
      id: "c4",
      from: "abc",
      name: "Ana",
      text: "yo",
      at: 5,
    });
  });
  it("always names Ms. Fenwick herself and keeps whom she answers", () => {
    const l = parseChatLine({
      id: "c5",
      from: FENWICK_ID,
      name: "Bob",
      text: "Hi!",
      at: 1,
      replyTo: "s9",
    });
    expect(l?.name).toBe(FENWICK_NAME);
    expect(l?.replyTo).toBe("s9");
  });
  it("ignores replyTo on a player's line", () => {
    expect(
      parseChatLine({ id: "c6", from: "s1", name: "A", text: "x", replyTo: "s2" })?.replyTo,
    ).toBe(undefined);
  });
  it("refuses lines that aren't", () => {
    expect(parseChatLine(null)).toBeNull();
    expect(parseChatLine({ id: "c1", from: "s1", text: "   " })).toBeNull();
    expect(parseChatLine({ id: 3, from: "s1", text: "x" })).toBeNull();
    expect(parseChatLine({ id: "c1", from: "", text: "x" })).toBeNull();
  });
  it("cleans a bad name and a missing time", () => {
    const l = parseChatLine({ id: "c1", from: "s1", name: "‮", text: "x" });
    expect(l?.name).toBe("Someone");
    expect(l?.at).toBe(0);
  });
});

describe("parseHistory / appendLine", () => {
  it("keeps valid lines once each, oldest first, the newest CHAT_KEEP", () => {
    const raw = { lines: [line({ id: "a" }), { nope: 1 }, line({ id: "a" }), line({ id: "b" })] };
    expect(parseHistory(raw).map((l) => l.id)).toEqual(["a", "b"]);
    const many = { lines: Array.from({ length: 80 }, (_, i) => line({ id: `c${i}` })) };
    const kept = parseHistory(many);
    expect(kept).toHaveLength(CHAT_KEEP);
    expect(kept.at(-1)?.id).toBe("c79");
    expect(parseHistory({})).toEqual([]);
  });
  it("appends a new line, drops a repeat, keeps the newest", () => {
    const lines = [line({ id: "a" })];
    expect(appendLine(lines, line({ id: "a" }))).toBeNull();
    expect(appendLine(lines, line({ id: "b" }))?.map((l) => l.id)).toEqual(["a", "b"]);
    const full = Array.from({ length: CHAT_KEEP }, (_, i) => line({ id: `c${i}` }));
    const next = appendLine(full, line({ id: "new" }))!;
    expect(next).toHaveLength(CHAT_KEEP);
    expect(next[0]?.id).toBe("c1");
    expect(next.at(-1)?.id).toBe("new");
  });
});

describe("mergeLines", () => {
  it("adds what was said while the link was down, in the room's order, once each", () => {
    const shown = [line({ id: "c1", at: 10 }), line({ id: "c4", at: 40 })];
    const history = [
      line({ id: "c1", at: 10 }),
      line({ id: "c2", at: 20 }),
      line({ id: "c3", at: 30, from: FENWICK_ID, name: FENWICK_NAME, replyTo: "s1" }),
      line({ id: "c4", at: 40 }),
    ];
    const { lines, added } = mergeLines(shown, history);
    expect(lines.map((l) => l.id)).toEqual(["c1", "c2", "c3", "c4"]);
    expect(added.map((l) => l.id)).toEqual(["c2", "c3"]);
    // Same time: the room's numbering decides.
    const tie = mergeLines([line({ id: "c12", at: 5 })], [line({ id: "c11", at: 5 })]);
    expect(tie.lines.map((l) => l.id)).toEqual(["c11", "c12"]);
    expect(mergeLines(shown, [])).toEqual({ lines: shown, added: [] });
  });
  it("keeps the newest CHAT_KEEP", () => {
    const shown = Array.from({ length: CHAT_KEEP }, (_, i) => line({ id: `c${i}`, at: i }));
    const { lines } = mergeLines(shown, [line({ id: "c999", at: 9999 })]);
    expect(lines).toHaveLength(CHAT_KEEP);
    expect(lines.at(-1)!.id).toBe("c999");
  });
});

describe("names", () => {
  it("shows first names, a guest's whole name, and hers", () => {
    expect(shortName("Theo Park")).toBe("Theo");
    expect(shortName("Guest 4821")).toBe("Guest 4821");
    expect(shortName(FENWICK_NAME)).toBe(FENWICK_NAME);
    expect(shortName("")).toBe("Someone");
  });
  it("says who's typing", () => {
    expect(typingLabel([], false)).toBeNull();
    expect(typingLabel(["Theo"], false)).toBe("Theo is typing…");
    expect(typingLabel(["Theo", "Ana"], false)).toBe("2 people are typing…");
    expect(typingLabel([], true)).toBe("Ms. Fenwick is typing…");
    expect(typingLabel(["Theo"], true)).toBe("Ms. Fenwick and Theo are typing…");
    expect(typingLabel(["Theo", "Ana"], true)).toBe("Ms. Fenwick and 2 others are typing…");
  });
});

describe("chatItems", () => {
  it("marks yours, hers and others', and groups runs from one sender", () => {
    const items = chatItems(
      [
        line({ id: "1", from: "me", name: "Sam", at: 0 }),
        line({ id: "2", from: "me", name: "Sam", at: 1000 }),
        line({ id: "3", from: "s2", name: "Theo Park", at: 2000 }),
        line({ id: "4", from: "s2", name: "Theo Park", at: 2000 + GROUP_GAP_MS }),
        line({ id: "5", from: FENWICK_ID, name: FENWICK_NAME, at: 3e6, replyTo: "s2" }),
        line({ id: "6", from: FENWICK_ID, name: FENWICK_NAME, at: 3e6 + 1, replyTo: "me" }),
      ],
      "me",
    );
    expect(items.map((i) => i.kind)).toEqual([
      "mine",
      "mine",
      "other",
      "other",
      "fenwick",
      "fenwick",
    ]);
    expect(items.map((i) => i.head)).toEqual([true, false, true, true, true, true]);
    expect(items[0]?.who).toBe("You");
    expect(items[2]?.who).toBe("Theo");
    expect(items[4]?.to).toBe("Theo");
    expect(items[5]?.to).toBe("you");
  });
  it("finds whom she answered among the players when their line is gone", () => {
    const items = chatItems(
      [line({ id: "9", from: FENWICK_ID, name: FENWICK_NAME, replyTo: "s7" })],
      "me",
      (id) => (id === "s7" ? "Ana Lee" : undefined),
    );
    expect(items[0]?.to).toBe("Ana");
    const unknown = chatItems([line({ id: "9", from: FENWICK_ID, replyTo: "gone" })], "me");
    expect(unknown[0]?.to).toBeNull();
  });
  it("without a session, nothing is yours", () => {
    expect(chatItems([line()], null)[0]?.kind).toBe("other");
  });
});

describe("charsLeft / bubbleText", () => {
  it("shows the counter only near the limit", () => {
    expect(charsLeft("hi")).toBeNull();
    expect(charsLeft("x".repeat(CHAT.MAX_CHARS - 30))).toBe(30);
    expect(charsLeft("x".repeat(CHAT.MAX_CHARS))).toBe(0);
  });
  it("cuts a long line at a word, with an ellipsis", () => {
    expect(bubbleText("short and sweet")).toBe("short and sweet");
    const long = "word ".repeat(40);
    const cut = bubbleText(long);
    expect(cut.length).toBeLessThanOrEqual(BUBBLE_CHARS + 1);
    expect(cut.endsWith("word…")).toBe(true);
    expect(bubbleText("x".repeat(200))).toBe(`${"x".repeat(BUBBLE_CHARS)}…`);
  });
});

describe("wrapText", () => {
  const measure = (s: string) => s.length * 10;
  it("wraps between words", () => {
    expect(wrapText(measure, "one two three four", 100, 3)).toEqual(["one two", "three four"]);
  });
  it("breaks a word too long for a line", () => {
    expect(wrapText(measure, "abcdefghijklmnop", 50, 4)).toEqual(["abcde", "fghij", "klmno", "p"]);
  });
  it("ends the last line with … when it doesn't all fit", () => {
    const lines = wrapText(measure, "aaa bbb ccc ddd eee fff", 70, 2);
    expect(lines).toHaveLength(2);
    expect(lines[1]!.endsWith("…")).toBe(true);
    for (const l of lines) expect(measure(l)).toBeLessThanOrEqual(70);
  });
  it("is empty for empty text", () => {
    expect(wrapText(measure, "", 100, 3)).toEqual([]);
  });
});

describe("bubbleFace", () => {
  it("shows a fresh line, then typing dots, then nothing", () => {
    const src = { text: "hello", at: 1000, typing: true };
    expect(bubbleFace(src, 1500)).toMatchObject({ kind: "line", text: "hello" });
    expect(bubbleFace(src, 1000 + BUBBLE_MS)?.kind).toBe("typing");
    expect(bubbleFace({ ...src, typing: false }, 1000 + BUBBLE_MS)).toBeNull();
    expect(bubbleFace(undefined, 0)).toBeNull();
  });
  it("steps the dots, and reuses the face until the picture changes", () => {
    const src = { text: "", at: Number.NEGATIVE_INFINITY, typing: true };
    const cache = { face: null };
    const a = bubbleFace(src, 0, cache);
    expect(bubbleFace(src, DOT_STEP_MS - 1, cache)).toBe(a);
    const b = bubbleFace(src, DOT_STEP_MS, cache);
    expect(b).not.toBe(a);
    expect(b?.key).not.toBe(a?.key);
    const line = { text: "hey", at: 10, typing: false };
    const first = bubbleFace(line, 20, cache);
    expect(bubbleFace(line, 30, cache)).toBe(first);
  });
});
