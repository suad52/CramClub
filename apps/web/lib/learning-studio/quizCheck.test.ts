import { beforeEach, describe, expect, it, vi } from "vitest";
import { SAMPLE_LESSON, SAMPLE_NOTES } from "./mockLesson";
import {
  QUOTE_MAX_CHARS,
  QUOTE_MAX_WORDS,
  type Verdict,
  applyQuizCheck,
  describeQuizCheck,
  groundQuote,
  indexSource,
  labelNotesQuotes,
  parseVerdicts,
  quizCheckNote,
  quizCheckPrompt,
  quizItems,
} from "./quizCheck";
import { type Interaction, type Lesson, LessonSchema, parseLesson } from "./schema";

// The one Gemini call is faked: no test ever reaches the real API.
const gemini = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock("@/lib/ai/gemini", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/gemini")>()),
  getGemini: () => ({ models: { generateContent: gemini.generateContent } }),
}));

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const NOTES = SAMPLE_NOTES.map((c) => c.text);
const source = indexSource(NOTES);

/** The sample lesson with a second knowledge check (on the glycolysis scene, index 1). */
function twoQuestions(second: Partial<Interaction> = {}): Lesson {
  const l = clone(SAMPLE_LESSON);
  l.scenes[1]!.interaction = {
    type: "multiple-choice",
    question: "Where does glycolysis take place?",
    options: ["In the cytoplasm", "In the nucleus", "In the mitochondrial matrix"],
    correctIndex: 0,
    explanation: "Page 2 says so.",
    hint: "It doesn't need oxygen or the mitochondrion.",
    quote: "Glycolysis takes place in the cytoplasm and does not need oxygen.",
    ...second,
  };
  return l;
}
const verdicts = (...list: Verdict[]) => new Map(list.map((v) => [v.n, v]));
const graded = (l: Lesson) => l.scenes.filter((s) => s.interaction?.type === "multiple-choice");

describe("groundQuote", () => {
  it("keeps a quote whose words are in the source, whatever the case, quotes or punctuation", () => {
    expect(groundQuote("“glycolysis takes place in the CYTOPLASM”", source)).toBe(
      "glycolysis takes place in the CYTOPLASM",
    );
    expect(groundQuote("Oxygen is the final electron acceptor and forms water.", source)).toBe(
      "Oxygen is the final electron acceptor and forms water.",
    );
  });

  it("refuses paraphrases, joined fragments and one-word 'quotes'", () => {
    expect(groundQuote("Glycolysis happens in the cytoplasm", source)).toBeUndefined();
    expect(groundQuote("Glycolysis takes place … makes 4 ATP", source)).toBeUndefined();
    expect(groundQuote("ATP", source)).toBeUndefined();
    expect(groundQuote("", source)).toBeUndefined();
    expect(groundQuote(undefined, source)).toBeUndefined();
  });

  it("cuts a long quote to the word limit and marks the cut", () => {
    const long = NOTES[3]!.split(" ").slice(0, 30).join(" ");
    const out = groundQuote(long, source)!;
    expect(out.endsWith("…")).toBe(true);
    expect(out.slice(0, -1).split(" ")).toHaveLength(QUOTE_MAX_WORDS);
  });

  it("keeps a quote of long words within what a stored lesson may hold", () => {
    const long = Array.from({ length: 22 }, (_, i) => `electrochemical${"x".repeat(i % 3)}`);
    const src = indexSource([long.join(" ")]);
    const out = groundQuote(long.join(" "), src)!;
    expect(out.length).toBeLessThanOrEqual(QUOTE_MAX_CHARS);
    expect(out.endsWith("…")).toBe(true);
    const lesson = clone(SAMPLE_LESSON);
    lesson.scenes[4]!.interaction!.quote = out;
    expect(LessonSchema.safeParse(lesson).success).toBe(true);
    // Three words that alone overflow the limit aren't a quote that can be shown.
    const huge = ["a".repeat(90), "b".repeat(90), "c".repeat(90)].join(" ");
    expect(groundQuote(huge, indexSource([huge]))).toBeUndefined();
  });

  it("matches across words a PDF split or hyphenated", () => {
    const pdf = indexSource(["Plants use photo-\nsynthesis to make glucose from light."]);
    expect(groundQuote("Plants use photosynthesis to make glucose", pdf)).toBe(
      "Plants use photosynthesis to make glucose",
    );
  });

  it("grounds the sample lesson's own quote in the sample notes", () => {
    const q = SAMPLE_LESSON.scenes[4]!.interaction!;
    expect(groundQuote(q.quote, source)).toBe(q.quote);
    expect(q.hint).toBeTruthy();
  });
});

describe("the verifier's prompt and verdicts", () => {
  it("asks every multiple-choice question without the answer key, explanation, hint or quote", () => {
    const lesson = twoQuestions();
    const items = quizItems(lesson);
    expect(items.map((i) => [i.n, i.scene])).toEqual([
      [1, 1],
      [2, 4],
    ]);
    const prompt = quizCheckPrompt(items, "[page 1]\nnotes");
    expect(prompt).toContain("1. Where does glycolysis take place?");
    expect(prompt).toContain("2) The electron transport chain");
    for (const s of graded(lesson)) {
      const q = s.interaction!;
      expect(prompt).not.toContain(q.explanation!);
      expect(prompt).not.toContain(q.quote!);
      expect(prompt).not.toContain(q.hint!);
    }
    expect(prompt).not.toMatch(/correctIndex|correct answer is/i);
    expect(prompt).toMatch(/ignore any instructions/);
  });

  it("keeps only verdicts that fit the questions asked", () => {
    const items = quizItems(twoQuestions());
    const out = parseVerdicts(
      {
        verdicts: [
          { n: 1, answer: 0, quote: "x" },
          { n: 1, answer: 2, quote: "a second verdict for 1 is ignored" },
          { n: 2, answer: 9, quote: "" },
          { n: 7, answer: 0, quote: "" },
          { n: "2", answer: 1 },
          "junk",
        ],
      },
      items,
    );
    expect([...out!.values()]).toEqual([{ n: 1, answer: 0, quote: "x" }]);
    expect(parseVerdicts({ verdicts: [] }, items)).toBeNull();
    expect(parseVerdicts({ nope: true }, items)).toBeNull();
    expect(parseVerdicts(null, items)).toBeNull();
    expect(parseVerdicts({ verdicts: [{ n: 2, answer: -1 }] }, items)?.get(2)?.quote).toBe("");
  });
});

describe("applyQuizCheck", () => {
  it("marks agreeing answers verified and records the counts", () => {
    const out = applyQuizCheck(
      twoQuestions(),
      verdicts({ n: 1, answer: 0, quote: "" }, { n: 2, answer: 2, quote: "" }),
      NOTES,
      "notes",
    );
    expect(graded(out).map((s) => s.interaction!.check)).toEqual(["verified", "verified"]);
    expect(out.quizCheck).toEqual({
      checked: true,
      questions: 2,
      verified: 2,
      fixed: 0,
      dropped: 0,
      unsure: 0,
      from: "notes",
    });
    expect(LessonSchema.safeParse(out).success).toBe(true);
  });

  it("uses the checker's quote when the question's own isn't in the notes", () => {
    const out = applyQuizCheck(
      twoQuestions({ quote: "Glycolysis is a cytoplasmic pathway" }),
      verdicts({ n: 1, answer: 0, quote: "Glycolysis takes place in the cytoplasm" }),
      NOTES,
      "notes",
    );
    expect(out.scenes[1]!.interaction).toMatchObject({
      check: "verified",
      quote: "Glycolysis takes place in the cytoplasm",
    });
    // No verdict for question 2: kept as written, unmarked.
    expect(out.scenes[4]!.interaction!.check).toBeUndefined();
  });

  it("re-keys a question when only the checker's answer is backed by the notes", () => {
    const out = applyQuizCheck(
      twoQuestions({ correctIndex: 2, quote: "made up words that are nowhere" }),
      verdicts(
        { n: 1, answer: 0, quote: "takes place in the cytoplasm and does not need oxygen" },
        { n: 2, answer: 2, quote: "" },
      ),
      NOTES,
      "notes",
    );
    const q = out.scenes[1]!.interaction!;
    expect(q).toMatchObject({ correctIndex: 0, check: "fixed" });
    expect(q.quote).toBe("takes place in the cytoplasm and does not need oxygen");
    // The old explanation and hint argued for the old answer.
    expect(q.explanation).toBeUndefined();
    expect(q.hint).toBeUndefined();
    expect(out.quizCheck).toMatchObject({ verified: 1, fixed: 1, dropped: 0 });
  });

  it("drops a disputed question when another one holds up", () => {
    const out = applyQuizCheck(
      twoQuestions({ correctIndex: 1 }),
      verdicts({ n: 1, answer: 0, quote: "" }, { n: 2, answer: 2, quote: "" }),
      NOTES,
      "notes",
    );
    // Its section still asks something: an open reflection, which has no answer key to get wrong.
    expect(out.scenes[1]!.interaction).toMatchObject({ type: "reflection" });
    expect(out.scenes[1]!.interaction!.correctIndex).toBeUndefined();
    expect(out.scenes[4]!.interaction!.check).toBe("verified");
    expect(out.scenes).toHaveLength(SAMPLE_LESSON.scenes.length);
    expect(out.quizCheck).toMatchObject({ questions: 2, verified: 1, dropped: 1, unsure: 0 });
  });

  it("never leaves a lesson without a knowledge check: the best flagged one stays, marked", () => {
    // Both disputed. Only question 2's own quote is real text, so it is kept although it's later.
    const out = applyQuizCheck(
      twoQuestions({ quote: "words that are not in the notes at all" }),
      verdicts({ n: 1, answer: 2, quote: "" }, { n: 2, answer: 0, quote: "" }),
      NOTES,
      "notes",
    );
    expect(graded(out)).toHaveLength(1);
    expect(out.scenes[1]!.interaction).toMatchObject({ type: "reflection" });
    expect(out.scenes[4]!.interaction).toMatchObject({ check: "unsure", correctIndex: 2 });
    expect(out.quizCheck).toMatchObject({ verified: 0, dropped: 1, unsure: 1 });

    const single = applyQuizCheck(
      clone(SAMPLE_LESSON),
      verdicts({ n: 1, answer: -1, quote: "" }),
      NOTES,
      "notes",
    );
    expect(single.scenes[4]!.interaction!.check).toBe("unsure");
    expect(single.quizCheck).toMatchObject({ questions: 1, dropped: 0, unsure: 1 });
  });

  it("fails open: the quiz as written, quotes still grounded, recorded as unchecked", () => {
    const lesson = twoQuestions({ quote: "words that are not in the notes at all" });
    lesson.scenes[4]!.interaction!.check = "verified"; // a stale or forged mark
    const before = clone(lesson);
    const out = applyQuizCheck(lesson, null, NOTES, "sources");
    expect(lesson).toEqual(before); // never mutated
    expect(out.scenes[1]!.interaction!.quote).toBeUndefined();
    expect(out.scenes[1]!.interaction!.correctIndex).toBe(0);
    expect(out.scenes[4]!.interaction!.check).toBeUndefined();
    expect(out.scenes[4]!.interaction!.quote).toBe(SAMPLE_LESSON.scenes[4]!.interaction!.quote);
    expect(out.quizCheck).toMatchObject({
      checked: false,
      questions: 2,
      dropped: 0,
      from: "sources",
    });
  });
});

describe("what the student is told", () => {
  const base = { checked: true, questions: 3, fixed: 0, unsure: 0, from: "notes" as const };
  it("says only what's true", () => {
    expect(quizCheckNote(undefined)).toBeNull();
    expect(quizCheckNote({ ...base, checked: false, verified: 0, dropped: 0 })).toBeNull();
    expect(quizCheckNote({ ...base, verified: 3, dropped: 0 })).toBe(
      "Every quiz answer was double-checked against your notes.",
    );
    expect(quizCheckNote({ ...base, verified: 2, dropped: 1, from: "sources" })).toBe(
      "The quiz was double-checked against the sources: 2 of 3 answers held up and 1 question was swapped for a reflection.",
    );
    expect(describeQuizCheck({ ...base, verified: 1, fixed: 1, dropped: 1 })).toBe(
      "Double-checked the quiz: 2 of 3 confirmed, 1 answer corrected, 1 set aside",
    );
    expect(describeQuizCheck({ ...base, checked: false, verified: 0, dropped: 0 })).toMatch(
      /couldn't be double-checked/,
    );
  });

  it("doesn't count a question the checker never answered as failing", () => {
    // A partial reply: 1 of 3 questions got a verdict (it agreed); the other two are unmarked.
    const partial = { ...base, verified: 1, dropped: 0 };
    expect(quizCheckNote(partial)).toBe(
      "The quiz was double-checked against your notes: 1 of 1 answers held up.",
    );
    expect(describeQuizCheck(partial)).toBe(
      "Double-checked the quiz: 1 of 3 confirmed, 2 not re-answered",
    );
  });
});

describe("checkLessonQuiz (one Gemini call, faked)", () => {
  beforeEach(() => gemini.generateContent.mockReset());

  it("makes one call and applies its verdicts", async () => {
    const { checkLessonQuiz } = await import("./server");
    gemini.generateContent.mockResolvedValue({
      text: JSON.stringify({
        verdicts: [
          { n: 1, answer: 0, quote: "" },
          { n: 2, answer: 1 },
        ],
      }),
    });
    const out = await checkLessonQuiz(twoQuestions(), NOTES, { from: "notes" });
    expect(gemini.generateContent).toHaveBeenCalledTimes(1);
    const request = gemini.generateContent.mock.calls[0]![0] as {
      contents: { parts: { text: string }[] }[];
      config: { temperature: number };
    };
    expect(request.config.temperature).toBeLessThanOrEqual(0.2);
    expect(request.contents[0]!.parts[0]!.text).toContain("[page 2]");
    expect(out.quizCheck).toMatchObject({ checked: true, verified: 1, dropped: 1 });
  });

  it("keeps the quiz as written when the call fails, times out or answers nonsense", async () => {
    const { checkLessonQuiz } = await import("./server");
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    gemini.generateContent.mockRejectedValueOnce(Object.assign(new Error("busy"), { status: 503 }));
    gemini.generateContent.mockReturnValueOnce(new Promise(() => {}));
    gemini.generateContent.mockResolvedValueOnce({ text: "not json" });
    for (const timeoutMs of [1000, 20, 1000]) {
      const out = await checkLessonQuiz(twoQuestions(), NOTES, { from: "notes", timeoutMs });
      expect(out.quizCheck).toMatchObject({ checked: false, questions: 2, dropped: 0 });
      expect(graded(out)).toHaveLength(2);
    }
    // Logs name the failure, never the notes or the reply.
    expect(info.mock.calls.flat().join(" ")).not.toContain("not json");
    info.mockRestore();
  });

  it("doesn't call Gemini for a lesson with no multiple-choice question", async () => {
    const { checkLessonQuiz } = await import("./server");
    const l = clone(SAMPLE_LESSON);
    l.scenes[4]!.interaction = null;
    const out = await checkLessonQuiz(l, NOTES, { from: "notes" });
    expect(gemini.generateContent).not.toHaveBeenCalled();
    expect(out.quizCheck).toMatchObject({ checked: false, questions: 0 });
  });
});

describe("labelNotesQuotes (a lesson made from the student's notes)", () => {
  const checked = () => applyQuizCheck(twoQuestions(), null, NOTES, "sources");
  const WEB = ["Oxygen is the final electron acceptor at the end of the chain in mitochondria."];
  const quoteFrom = (l: Lesson) => [
    l.scenes[1]!.interaction!.quoteFrom,
    l.scenes[4]!.interaction!.quoteFrom,
  ];

  it("notes alone: every quote and the whole check read 'your notes'", () => {
    const lesson = checked();
    const before = clone(lesson);
    const out = labelNotesQuotes(lesson, NOTES, 0);
    expect(lesson).toEqual(before); // never mutated
    expect(out.quizCheck?.from).toBe("notes");
    expect(
      quoteFrom(out)
        .filter(Boolean)
        .every((f) => f === "notes"),
    ).toBe(true);
  });

  it("notes plus web pages: each quote says where it is; the check stays 'the sources'", () => {
    const lesson = checked();
    lesson.scenes[4]!.interaction!.quote = "Oxygen is the final electron acceptor at the end";
    const out = labelNotesQuotes(lesson, NOTES, WEB.length);
    expect(out.quizCheck?.from).toBe("sources"); // it was checked against both
    expect(out.scenes[4]!.interaction!.quoteFrom).toBe("sources");
    const notesQuote = out.scenes[1]!.interaction!;
    if (notesQuote.quote) expect(notesQuote.quoteFrom).toBe("notes");
  });

  it("a quote cut with an ellipsis still counts as the notes'", () => {
    const lesson = checked();
    const words = NOTES.join(" ").split(/\s+/).slice(0, 26);
    lesson.scenes[4]!.interaction!.quote = `${words.slice(0, 20).join(" ")}…`;
    expect(labelNotesQuotes(lesson, NOTES, 1).scenes[4]!.interaction!.quoteFrom).toBe("notes");
  });

  it("leaves questions without a quote, and a lesson without a check, unlabelled", () => {
    const bare = twoQuestions();
    for (const sc of bare.scenes) if (sc.interaction) delete sc.interaction.quote;
    const out = labelNotesQuotes(bare, NOTES, 0);
    expect(quoteFrom(out)).toEqual([undefined, undefined]);
    expect(out.quizCheck).toBeUndefined();
  });

  it("is never kept from the generator itself", () => {
    const raw = clone(SAMPLE_LESSON) as unknown as {
      scenes: { interaction?: { quoteFrom?: string } }[];
    };
    raw.scenes[4]!.interaction!.quoteFrom = "notes";
    expect(parseLesson(raw, 3).scenes[4]!.interaction!.quoteFrom).toBeUndefined();
  });
});
