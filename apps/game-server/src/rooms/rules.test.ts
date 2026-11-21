import {
  ANCHORS,
  BUILDING,
  CHAT,
  type ChatLine,
  FENWICK_ID,
  FENWICK_NAME,
  GALLERY_Y,
  NAME_UNSAFE,
  NET,
  SEATS,
} from "@ovr/shared";
import { describe, expect, it } from "vitest";
import {
  AVATAR_MAX_CHARS,
  FENWICK_GLOBAL_PER_MINUTE,
  GHOST_RECHECK_MS,
  type GhostState,
  LIMITS,
  MOVE_BURST_M,
  RateLimiter,
  TicketLedger,
  acceptMove,
  asksSomething,
  cleanChatText,
  createLimiters,
  fenwickContext,
  ghostDecision,
  newTracker,
  readAvatar,
  readChat,
  readFace,
  readFenwickReply,
  readMove,
  readStatus,
  readTyping,
  remember,
  seatTooFar,
  waitsForAnswer,
} from "./rules";

const move = (x: number, z: number, y = 0) => ({
  x,
  y,
  z,
  ry: 0,
  movement: "walk" as const,
  speed: 3,
});

/** A tracker already placed at `at` (ms), with the budget it would have after standing still. */
function placed(at = 0) {
  const t = newTracker(at);
  t.placed = true;
  return t;
}

describe("rate limits", () => {
  it("allows a burst, then the steady rate, and drops the rest", () => {
    const limit = new RateLimiter(NET.MOVE_HZ, 4, 0);
    const burst = Array.from({ length: 10 }, () => limit.take(0));
    expect(burst.filter(Boolean)).toHaveLength(4);
    // One second at the contract rate always gets through (the refill has slack).
    let ok = 0;
    for (let i = 1; i <= NET.MOVE_HZ; i++) if (limit.take((i * 1000) / NET.MOVE_HZ)) ok++;
    expect(ok).toBe(NET.MOVE_HZ);
    // Twice the rate for a second loses about half.
    let fast = 0;
    for (let i = 1; i <= NET.MOVE_HZ * 2; i++)
      if (limit.take(1000 + (i * 500) / NET.MOVE_HZ)) fast++;
    expect(fast).toBeLessThan(NET.MOVE_HZ * 1.25 + 4 + 1);
  });
});

describe("moves", () => {
  it("accepts a first placement anywhere on a floor", () => {
    const t = newTracker(0);
    const out = acceptMove({ x: 0, y: 0, z: 6 }, t, move(-12, -9), 0);
    expect(out).toMatchObject({ x: -12, y: 0, z: -9, clamped: false });
    expect(t.placed).toBe(true);
  });

  it("cuts a move short when it beats the speed limit", () => {
    const t = placed(0);
    const out = acceptMove({ x: 0, y: 0, z: 0 }, t, move(20, 0), 10)!;
    expect(out.clamped).toBe(true);
    expect(out.x).toBeCloseTo(MOVE_BURST_M, 5);
    expect(out.z).toBe(0);
    // The budget is spent: right after, almost nothing more is allowed...
    const next = acceptMove(out, t, move(20, 0), 20)!;
    expect(next.x - out.x).toBeLessThan(0.1);
    // ...and it refills at NET.MAX_SPEED.
    const later = acceptMove(next, t, move(20, 0), 270)!;
    expect(later.x - next.x).toBeCloseTo(NET.MAX_SPEED * 0.25, 2);
  });

  it("lets a steady run through untouched", () => {
    const t = placed(0);
    let at = { x: -10, y: 0, z: 0 };
    for (let i = 1; i <= 24; i++) {
      const step = acceptMove(at, t, move(at.x + 5.4 / NET.MOVE_HZ, 0), (i * 1000) / NET.MOVE_HZ)!;
      expect(step.clamped).toBe(false);
      at = step;
    }
    expect(at.x).toBeCloseTo(-10 + 5.4 * 2, 5);
  });

  it("keeps players inside the building and on its floors", () => {
    // Far outside: pulled in to the building's edge, where there's no floor, so dropped.
    expect(acceptMove({ x: 0, y: 0, z: 0 }, newTracker(0), move(-500, 500), 0)).toBeNull();
    // Between the floor's edge and the outer wall: dropped too.
    expect(acceptMove({ x: 13.5, y: 0, z: 0 }, placed(0), move(14.5, 0), 0)).toBeNull();
    // A wild claim from inside is cut to the speed budget, and stays in.
    const out = acceptMove({ x: 0, y: 0, z: 0 }, placed(0), move(-500, 0), 0)!;
    expect(out.x).toBeCloseTo(-MOVE_BURST_M, 5);
    expect(out.x).toBeGreaterThan(BUILDING.minX);
  });

  it("changes floors only at a lift", () => {
    // Under the gallery, claiming to be up on it: kept on the ground floor.
    const t = placed(0);
    expect(acceptMove({ x: 0, y: 0, z: -8.5 }, t, move(0.1, -8.5, GALLERY_Y), 100)!.y).toBe(0);
    // At the lift, the same claim is believed.
    const lift = ANCHORS.find((a) => a.kind === "lift")!;
    const from = { x: lift.x, y: 0, z: lift.z };
    expect(acceptMove(from, placed(0), move(lift.x - 0.4, lift.z, GALLERY_Y), 100)!.y).toBe(
      GALLERY_Y,
    );
  });

  it("never reports a standing player as seated, and wraps the facing", () => {
    const out = acceptMove(
      { x: 0, y: 0, z: 0 },
      placed(0),
      { ...move(0, 0), movement: "sit", ry: 7, speed: 50 },
      100,
    )!;
    expect(out.movement).toBe("idle");
    expect(out.speed).toBe(NET.MAX_SPEED);
    expect(out.ry).toBeCloseTo(7 - 2 * Math.PI, 9);
  });

  it("reads only well-formed moves", () => {
    expect(readMove(move(1, 2))).toEqual(move(1, 2));
    for (const bad of [
      null,
      "move",
      { ...move(1, 2), x: Number.NaN },
      { ...move(1, 2), z: Infinity },
      { ...move(1, 2), y: "0" },
      { ...move(1, 2), movement: "fly" },
      { x: 1, y: 0, z: 0 },
    ])
      expect(readMove(bad)).toBeNull();
  });
});

describe("other messages", () => {
  it("clamps face values to their ranges and copies nothing else", () => {
    expect(
      readFace({
        headYaw: -2,
        headPitch: 0.3,
        headRoll: 5,
        eyeBlinkLeft: -1,
        eyeBlinkRight: 0.5,
        jawOpen: 9,
        smile: 0,
        browRaise: 1,
        landmarks: [1, 2, 3],
      }),
    ).toEqual({
      headYaw: -1,
      headPitch: 0.3,
      headRoll: 1,
      eyeBlinkLeft: 0,
      eyeBlinkRight: 0.5,
      jawOpen: 1,
      smile: 0,
      browRaise: 1,
    });
    expect(readFace(null)).toBeNull();
    expect(readFace({ headYaw: 0 })).toBeUndefined();
    expect(readFace("smile")).toBeUndefined();
  });

  it("accepts only known statuses", () => {
    expect(readStatus({ status: "focused" })).toBe("focused");
    expect(readStatus({ status: "asleep" })).toBeNull();
    expect(readStatus(null)).toBeNull();
  });

  it("sanitises avatars and refuses oversized or broken ones", () => {
    const stored = readAvatar({ avatar: JSON.stringify({ skin: "nope", extra: 1 }) })!;
    const parsed = JSON.parse(stored);
    expect(parsed.extra).toBeUndefined();
    expect(parsed.v).toBeGreaterThan(0);
    expect(readAvatar({ avatar: "{" })).toBeNull();
    expect(readAvatar({ avatar: "[]" })).toBeNull();
    expect(readAvatar({ avatar: " ".repeat(AVATAR_MAX_CHARS + 1) })).toBeNull();
    expect(readAvatar({ avatar: 42 })).toBeNull();
  });

  it("only seats players who are close enough, on the same floor", () => {
    const seat = SEATS[0]!;
    expect(seatTooFar(seat, { x: seat.x + 1.2, y: seat.y, z: seat.z })).toBe(false);
    expect(seatTooFar(seat, { x: seat.x + 2.5, y: seat.y, z: seat.z })).toBe(true);
    expect(seatTooFar(seat, { x: seat.x, y: seat.y + GALLERY_Y, z: seat.z })).toBe(true);
  });
});

describe("TicketLedger", () => {
  it("lets each ticket through once, until it would have expired anyway", () => {
    const ledger = new TicketLedger();
    expect(ledger.claim("a", 1000, 900)).toBe(true);
    expect(ledger.claim("a", 1000, 901)).toBe(false);
    expect(ledger.claim("b", 1000, 901)).toBe(true);
    // Long expired: forgotten at the next prune (a replay then fails verifyTicket's expiry).
    ledger.claim("c", 2000, 1100);
    expect(ledger.size).toBe(1);
  });

  it("refuses new tickets rather than forget live ones when full", () => {
    const ledger = new TicketLedger(2);
    expect(ledger.claim("a", 1000, 900)).toBe(true);
    expect(ledger.claim("b", 1000, 900)).toBe(true);
    expect(ledger.claim("c", 1000, 900)).toBe(false);
    expect(ledger.claim("a", 1000, 900)).toBe(false);
    // Once they expire there's room again.
    expect(ledger.claim("c", 2000, 1000)).toBe(true);
  });
});

const cp = (...points: number[]) => String.fromCodePoint(...points);
const ZWJ = cp(0x200d);

describe("chat lines", () => {
  it("trims, single-spaces and caps a line", () => {
    expect(cleanChatText("  hello \n\t  there \r\n ")).toBe("hello there");
    expect(cleanChatText(`a${cp(0xa0)}b${cp(0x2028)}c${cp(0x2029)}d`)).toBe("a b c d");
    const long = cleanChatText(`${"word ".repeat(100)}end`)!;
    expect(long.length).toBeLessThanOrEqual(CHAT.MAX_CHARS);
    expect(long).toBe(long.trim());
    expect(cleanChatText("x".repeat(500))).toBe("x".repeat(CHAT.MAX_CHARS));
    // An emoji straddling the cut goes whole, never half a surrogate pair.
    const straddle = cleanChatText(`${"a".repeat(CHAT.MAX_CHARS - 1)}${cp(0x1f600)}`)!;
    expect(straddle).toBe("a".repeat(CHAT.MAX_CHARS - 1));
    expect(cleanChatText(`${"a".repeat(CHAT.MAX_CHARS - 2)}${cp(0x1f600)}`)).toHaveLength(
      CHAT.MAX_CHARS,
    );
  });

  it("strips control and invisible characters that could disguise a line", () => {
    expect(cleanChatText(`${cp(0x202e)}olleh`)).toBe("olleh");
    expect(cleanChatText(`a${cp(0x200b)}b${cp(0xfeff)}c${cp(0x2066)}d${cp(0x2069)}`)).toBe("abcd");
    expect(cleanChatText(`a${cp(0)}b${cp(0x7f)}c${cp(0x85)}d${cp(0x1b)}[31m`)).toBe("abcd[31m");
    // Removing one between two spaces leaves one space.
    expect(cleanChatText(`a ${cp(0x200b)} b`)).toBe("a b");
    const messy = cleanChatText(`hi${cp(0x200e)} there${cp(0x0)}\n${cp(0x202d)}you`)!;
    expect(NAME_UNSAFE.test(messy)).toBe(false);
  });

  it("keeps emoji sequences, but no stray joiners", () => {
    const technologist = cp(0x1f469, 0x200d, 0x1f4bb);
    const family = cp(0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467);
    const toned = cp(0x1f469, 0x1f3fd, 0x200d, 0x1f4bb);
    const heartOnFire = cp(0x2764, 0xfe0f, 0x200d, 0x1f525);
    for (const emoji of [technologist, family, toned, heartOnFire])
      expect(cleanChatText(`study ${emoji} time`)).toBe(`study ${emoji} time`);
    expect(cleanChatText(`a${ZWJ}b`)).toBe("ab");
    expect(cleanChatText(`${cp(0x1f469)}${ZWJ}x`)).toBe(`${cp(0x1f469)}x`);
    expect(cleanChatText(`x${ZWJ}${cp(0x1f4bb)}`)).toBe(`x${cp(0x1f4bb)}`);
  });

  it("caps runs of combining marks and treats blank fillers as spaces", () => {
    // "Zalgo": a letter under 199 accents keeps 3 of them.
    const zalgo = cleanChatText(`a${"\u0301".repeat(199)} b`)!;
    expect(zalgo).toBe(`a${"\u0301".repeat(3)} b`);
    // Accents, keycaps and flags as people really type them survive.
    for (const kept of ["café", "e\u0301te\u0301", "1\ufe0f\u20e3 done", "Tiếng Việt", "नमस्ते"])
      expect(cleanChatText(kept)).toBe(kept);
    // Hangul fillers and the braille blank draw nothing: spaces, so a line of them is empty.
    expect(cleanChatText(`hi${cp(0x3164)}${cp(0x3164)}there`)).toBe("hi there");
    expect(cleanChatText(`a${cp(0x2800)}b${cp(0xffa0)}c${cp(0x115f)}d${cp(0x1160)}e`)).toBe(
      "a b c d e",
    );
    for (const blank of [
      cp(0x3164, 0x3164, 0x3164),
      cp(0x2800, 0x2800),
      `${cp(0xffa0)} ${cp(0x115f)}`,
      "\u0301\u0301\u0301\u0301",
      ` ${cp(0x034f)} `,
    ])
      expect(cleanChatText(blank)).toBeNull();
    expect(readChat({ text: cp(0x3164) })).toBeNull();
  });

  it("refuses empty lines and anything but text", () => {
    for (const junk of ["", "   ", "\n\t", cp(0x200b, 0x200b), cp(0x202e), 42, null, undefined, {}])
      expect(cleanChatText(junk)).toBeNull();
  });

  it("reads chat and typing messages", () => {
    expect(readChat({ text: "  hi  " })).toEqual({ text: "hi", fenwick: true });
    expect(readChat({ text: "hi", fenwick: false })).toEqual({ text: "hi", fenwick: false });
    // Only an explicit false turns her off.
    expect(readChat({ text: "hi", fenwick: "no" })).toEqual({ text: "hi", fenwick: true });
    for (const bad of [null, "hi", { text: "  " }, { text: 5 }, { fenwick: true }])
      expect(readChat(bad)).toBeNull();
    expect(readTyping({ on: true })).toBe(true);
    expect(readTyping({ on: false })).toBe(false);
    for (const bad of [null, {}, { on: "yes" }, { on: 1 }, true])
      expect(readTyping(bad)).toBeNull();
  });

  it("rate-limits chat and typing per the contract", () => {
    expect(LIMITS.chat).toEqual({ perSecond: CHAT.PER_SECOND, burst: CHAT.BURST });
    const { chat, typing } = createLimiters(0);
    const lines = Array.from({ length: CHAT.BURST + 3 }, () => chat.take(0));
    expect(lines.filter(Boolean)).toHaveLength(CHAT.BURST);
    // One more every 1 / PER_SECOND seconds (2 s).
    expect(chat.take(1000 / CHAT.PER_SECOND)).toBe(true);
    expect(chat.take(1000 / CHAT.PER_SECOND)).toBe(false);
    let typed = 0;
    for (let i = 1; i <= CHAT.TYPING_HZ * 10; i++)
      if (typing.take((i * 1000) / CHAT.TYPING_HZ)) typed++;
    expect(typed).toBe(CHAT.TYPING_HZ * 10);
  });

  it("reads her reply like any other line, or nothing", () => {
    expect(readFenwickReply({ reply: "  Try the\n Pomodoro   timer!  " })).toBe(
      "Try the Pomodoro timer!",
    );
    expect(readFenwickReply({ reply: "x".repeat(500) })).toHaveLength(CHAT.MAX_CHARS);
    for (const none of [{ reply: null }, { reply: "   " }, { reply: 7 }, {}, null, "hello", []])
      expect(readFenwickReply(none)).toBeNull();
  });

  it("keeps the latest CHAT.HISTORY lines and sends her the latest few, flagged", () => {
    const history: ChatLine[] = [];
    const line = (i: number, from: string): ChatLine => ({
      id: `c${i}`,
      from,
      name: from === FENWICK_ID ? FENWICK_NAME : from.toUpperCase(),
      text: `line ${i}`,
      at: i,
    });
    for (let i = 1; i <= CHAT.HISTORY + 5; i++)
      remember(history, line(i, i % 3 === 0 ? FENWICK_ID : i % 2 ? "ada" : "bo"));
    expect(history).toHaveLength(CHAT.HISTORY);
    expect(history[0]!.id).toBe("c6");
    expect(history.at(-1)!.id).toBe(`c${CHAT.HISTORY + 5}`);

    const context = fenwickContext(history, "ada");
    expect(context).toHaveLength(CHAT.FENWICK_CONTEXT_LINES);
    expect(context.at(-1)).toEqual({
      name: history.at(-1)!.name,
      text: history.at(-1)!.text,
      fenwick: history.at(-1)!.from === FENWICK_ID,
      asker: history.at(-1)!.from === "ada",
    });
    for (const [i, c] of context.entries()) {
      const source = history[history.length - CHAT.FENWICK_CONTEXT_LINES + i]!;
      expect(c.fenwick).toBe(source.from === FENWICK_ID);
      expect(c.asker).toBe(source.from === "ada");
      expect(Object.keys(c).sort()).toEqual(["asker", "fenwick", "name", "text"]);
    }
    expect(fenwickContext([], "ada")).toEqual([]);
  });
});

describe("a line that answers someone isn't waiting for an answer", () => {
  const AT = 100_000;
  it("starts a wait for a line out of the blue, or one that asks something", () => {
    expect(waitsForAnswer("good luck on midterms everyone", AT, null, false)).toBe(true);
    expect(waitsForAnswer("hi", AT, AT - CHAT.GHOST_MS, false)).toBe(true);
    expect(waitsForAnswer("hi", AT, AT - 60_000, false)).toBe(true);
    // A question waits even mid-conversation, and even when it also answers someone.
    expect(waitsForAnswer("mitochondria? are you sure", AT, AT - 3000, true)).toBe(true);
    expect(waitsForAnswer("how do I do integrals", AT, AT - 3000, true)).toBe(true);
  });

  it("doesn't for an answer: another learner's wait settled, or their line just before", () => {
    // B answers A's question 3 s later: B's line isn't waiting on anyone.
    expect(waitsForAnswer("mitochondria", AT, AT - 3000, true)).toBe(false);
    expect(waitsForAnswer("it makes energy for the cell, ATP!", AT, AT - 3000, false)).toBe(false);
    // A's wait was still open (B typed for 15 s): still an answer.
    expect(waitsForAnswer("upstairs, by the windows", AT, AT - 15_000, true)).toBe(false);
  });

  it("knows a question when it sees one", () => {
    for (const q of ["what's a derivative", "How do I focus", "anyone here?", "help", "is it 5?"])
      expect(asksSomething(q)).toBe(true);
    for (const a of ["mitochondria", "it's upstairs", "thanks!", "this is hard", "whatever lol"])
      expect(asksSomething(a)).toBe(false);
  });
});

describe("Ms. Fenwick answers when nobody else does", () => {
  const ASKED = 100_000;
  const base: GhostState = {
    askedAt: ASKED,
    otherLineAt: null,
    othersPresent: true,
    othersTyping: false,
    lastForAsker: null,
    roomRecent: [],
    globalRecent: [],
    inFlight: false,
  };
  const decide = (now: number, s: Partial<GhostState> = {}) =>
    ghostDecision({ ...base, ...s }, now);
  const LATEST = ASKED + CHAT.GHOST_MAX_MS;

  it("waits GHOST_MS when others are around, then answers", () => {
    expect(decide(ASKED)).toEqual({ action: "wait", until: ASKED + CHAT.GHOST_MS });
    expect(decide(ASKED + CHAT.GHOST_MS - 1)).toEqual({
      action: "wait",
      until: ASKED + CHAT.GHOST_MS,
    });
    expect(decide(ASKED + CHAT.GHOST_MS)).toEqual({ action: "answer" });
  });

  it("answers after only GHOST_ALONE_MS when nobody else is there", () => {
    const alone = { othersPresent: false };
    expect(decide(ASKED, alone)).toEqual({ action: "wait", until: ASKED + CHAT.GHOST_ALONE_MS });
    expect(decide(ASKED + CHAT.GHOST_ALONE_MS, alone)).toEqual({ action: "answer" });
    // Someone arriving before then gives them the full GHOST_MS to answer.
    expect(decide(ASKED + CHAT.GHOST_ALONE_MS)).toEqual({
      action: "wait",
      until: ASKED + CHAT.GHOST_MS,
    });
  });

  it("stays out of it once someone else has posted", () => {
    const answered = { action: "give_up", reason: "answered" };
    expect(decide(ASKED + 500, { otherLineAt: ASKED + 400 })).toEqual(answered);
    expect(decide(ASKED + CHAT.GHOST_MS, { otherLineAt: ASKED + 1 })).toEqual(answered);
    expect(decide(ASKED + CHAT.GHOST_MS, { otherLineAt: ASKED + 1, othersPresent: false })).toEqual(
      answered,
    );
    // A line from before theirs isn't an answer to it.
    expect(decide(ASKED + CHAT.GHOST_MS, { otherLineAt: ASKED - 2000 })).toEqual({
      action: "answer",
    });
    expect(decide(ASKED + CHAT.GHOST_MS, { otherLineAt: ASKED })).toEqual({ action: "answer" });
  });

  it("waits for someone who is typing, but never past GHOST_MAX_MS", () => {
    const typing = { othersTyping: true };
    expect(decide(ASKED + CHAT.GHOST_MS, typing)).toEqual({
      action: "wait",
      until: ASKED + CHAT.GHOST_MS + GHOST_RECHECK_MS,
    });
    expect(decide(LATEST - 300, typing)).toEqual({ action: "wait", until: LATEST });
    expect(decide(LATEST, typing)).toEqual({ action: "answer" });
    // They stopped typing without posting: she answers at the next look.
    expect(decide(ASKED + CHAT.GHOST_MS + GHOST_RECHECK_MS)).toEqual({ action: "answer" });
    // Typing before the time is up changes nothing yet.
    expect(decide(ASKED + 1000, typing)).toEqual({ action: "wait", until: ASKED + CHAT.GHOST_MS });
  });

  it("counts from the asker's newest line: one reply covers a burst", () => {
    expect(decide(ASKED + CHAT.GHOST_MS)).toEqual({ action: "answer" });
    const newer = ASKED + 6000;
    expect(decide(ASKED + CHAT.GHOST_MS, { askedAt: newer })).toEqual({
      action: "wait",
      until: newer + CHAT.GHOST_MS,
    });
    expect(decide(newer + CHAT.GHOST_MS, { askedAt: newer })).toEqual({ action: "answer" });
  });

  it("answers the same learner at most once per FENWICK_PLAYER_COOLDOWN_MS", () => {
    // Answered 5 s before this line: she waits out the cooldown, then answers.
    const recently = { lastForAsker: ASKED - 5000 };
    const free = ASKED - 5000 + CHAT.FENWICK_PLAYER_COOLDOWN_MS;
    expect(decide(ASKED + CHAT.GHOST_MS, recently)).toEqual({ action: "wait", until: free });
    expect(decide(free, recently)).toEqual({ action: "answer" });
    // Long ago: no effect.
    expect(decide(ASKED + CHAT.GHOST_MS, { lastForAsker: ASKED - 60_000 })).toEqual({
      action: "answer",
    });
    // Her last reply started after this line (they posted while she was writing): the cooldown
    // runs past GHOST_MAX_MS, so she lets this one go.
    expect(decide(ASKED + CHAT.GHOST_MS, { lastForAsker: ASKED + 1000 })).toEqual({
      action: "give_up",
      reason: "too_late",
    });
  });

  it("keeps a one-to-one going: only FENWICK_ALONE_COOLDOWN_MS between replies when alone", () => {
    // She took up "hi" at 3 s; a follow-up at 6 s is answered at 9 s (its GHOST_ALONE_MS), not 23 s.
    const alone = { othersPresent: false, lastForAsker: 3000 };
    expect(decide(6000, { ...alone, askedAt: 6000 })).toEqual({ action: "wait", until: 9000 });
    expect(decide(9000, { ...alone, askedAt: 6000 })).toEqual({ action: "answer" });
    // A follow-up straight after: the alone cooldown holds her back a little.
    const soon = { ...alone, askedAt: 3500 };
    expect(decide(6500, soon)).toEqual({
      action: "wait",
      until: 3000 + CHAT.FENWICK_ALONE_COOLDOWN_MS,
    });
    // With others there, the full cooldown.
    expect(decide(16_000, { lastForAsker: 3000, askedAt: 6000 })).toEqual({
      action: "wait",
      until: 3000 + CHAT.FENWICK_PLAYER_COOLDOWN_MS,
    });
  });

  it("answers at most FENWICK_GLOBAL_PER_MINUTE times a minute across every room", () => {
    const now = ASKED + CHAT.GHOST_MS;
    const many = (first: number, n = FENWICK_GLOBAL_PER_MINUTE) =>
      Array.from({ length: n }, (_, i) => first + i * 100);
    // Full, and nothing ages out before GHOST_MAX_MS: she lets this one go.
    expect(decide(now, { globalRecent: many(now - 30_000) })).toEqual({
      action: "give_up",
      reason: "too_late",
    });
    // Full, but the oldest ages out in a moment: she waits for it.
    expect(decide(now, { globalRecent: many(now - 59_000) })).toEqual({
      action: "wait",
      until: now + 1000,
    });
    // One short, or older than a minute: no limit.
    expect(
      decide(now, { globalRecent: many(now - 30_000, FENWICK_GLOBAL_PER_MINUTE - 1) }),
    ).toEqual({ action: "answer" });
    expect(
      decide(now, { globalRecent: many(now - 61_000 - 100 * FENWICK_GLOBAL_PER_MINUTE) }),
    ).toEqual({ action: "answer" });
  });

  it("answers at most FENWICK_ROOM_PER_MINUTE times a minute in one room", () => {
    const now = ASKED + CHAT.GHOST_MS;
    const spaced = (first: number) =>
      Array.from({ length: CHAT.FENWICK_ROOM_PER_MINUTE }, (_, i) => first + i * 1000);
    // A full minute's worth, the oldest about to age out: she waits for it.
    const soon = spaced(now - 58_000);
    expect(decide(now, { roomRecent: soon })).toEqual({ action: "wait", until: now + 2000 });
    expect(decide(now + 2000, { roomRecent: soon })).toEqual({ action: "answer" });
    // The oldest only ages out after GHOST_MAX_MS: too late for this line.
    expect(decide(now, { roomRecent: spaced(now - 20_000) })).toEqual({
      action: "give_up",
      reason: "too_late",
    });
    // One fewer, or older ones: no limit.
    expect(decide(now, { roomRecent: spaced(now - 20_000).slice(1) })).toEqual({
      action: "answer",
    });
    expect(decide(now, { roomRecent: [...spaced(now - 20_000).slice(1), now - 61_000] })).toEqual({
      action: "answer",
    });
  });

  it("never writes two replies to one asker at once", () => {
    const writing = { inFlight: true };
    expect(decide(ASKED + CHAT.GHOST_MS, writing)).toEqual({
      action: "wait",
      until: ASKED + CHAT.GHOST_MS + GHOST_RECHECK_MS,
    });
    expect(decide(LATEST - 500, writing)).toEqual({ action: "give_up", reason: "too_late" });
  });
});
