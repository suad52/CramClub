import { describe, expect, it } from "vitest";
import {
  NotesError,
  budgetParts,
  capNotes,
  charCount,
  checkCount,
  checkFile,
  cleanName,
  cleanText,
  cut,
  decodeText,
  fairShares,
  findLinks,
  isPdf,
  listJoin,
  notesLabel,
  notesParts,
  notesReply,
  pickForGaps,
  readLabel,
  readNotesFile,
  textPages,
} from "./notes";

const bytes = (s: string) => new TextEncoder().encode(s);
const thrown = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err as NotesError;
  }
  throw new Error("expected a NotesError");
};

describe("file checks", () => {
  it("accepts PDFs, .txt and .md files and nothing else", () => {
    expect(checkFile({ name: "Lecture 3.PDF", size: 10 })).toBe("pdf");
    expect(checkFile({ name: "notes.txt", size: 10 })).toBe("text");
    expect(checkFile({ name: "notes.md", size: 10 })).toBe("text");
    const docx = thrown(() => checkFile({ name: "notes.docx", size: 10 }));
    expect(docx.status).toBe(400);
    expect(docx.message).toContain("notes.docx isn't a PDF, .txt or .md file");
  });

  it("rejects empty files and files over 15 MB (413)", () => {
    expect(thrown(() => checkFile({ name: "a.txt", size: 0 })).message).toBe("a.txt is empty.");
    const big = thrown(() => checkFile({ name: "a.pdf", size: 15 * 1024 * 1024 + 1 }));
    expect(big.status).toBe(413);
    expect(big.code).toBe("too_large");
  });

  it("allows one to three files", () => {
    expect(() => checkCount(1)).not.toThrow();
    expect(() => checkCount(3)).not.toThrow();
    expect(thrown(() => checkCount(0)).status).toBe(400);
    expect(thrown(() => checkCount(4)).message).toContain("up to 3");
  });

  it("keeps only the file's own name", () => {
    expect(cleanName("C:\\Users\\me\\Week 3\\lecture3.pdf")).toBe("lecture3.pdf");
    expect(cleanName('../../etc/"week <3>".md')).toBe("week 3.md");
    expect(cleanName("  ")).toBe("notes");
    expect(cleanName("a".repeat(300) + ".txt").length).toBe(200);
  });

  it("spots real PDFs by their first bytes", () => {
    expect(isPdf(bytes("%PDF-1.7\n..."))).toBe(true);
    expect(isPdf(bytes("<html>"))).toBe(false);
    expect(isPdf(new Uint8Array())).toBe(false);
  });

  it("reads UTF-8 text and rejects anything else", () => {
    expect(decodeText(bytes("\uFEFFcafé notes"), "a.txt")).toBe("café notes");
    expect(thrown(() => decodeText(new Uint8Array([0xff, 0xfe, 0x41]), "a.txt")).message).toContain(
      "isn't UTF-8 text",
    );
    expect(thrown(() => decodeText(bytes("ab\u0000cd"), "a.txt")).message).toContain(
      "doesn't look like a text file",
    );
  });
});

describe("reading files", () => {
  const pdfPages = async () => ["Page one text", "", "Page three text"];

  it("reads a PDF through the extractor, keeping page numbers", async () => {
    const f = await readNotesFile({ name: "l.pdf", bytes: bytes("%PDF-1.4 ...") }, pdfPages);
    expect(f.pages).toEqual(["Page one text", "", "Page three text"]);
  });

  it("rejects a .pdf that isn't one, and passes on the extractor's own message", async () => {
    await expect(readNotesFile({ name: "l.pdf", bytes: bytes("hello") }, pdfPages)).rejects.toThrow(
      "l.pdf isn't a real PDF file.",
    );
    const scanned = async () => {
      throw Object.assign(new Error("This PDF has little or no selectable text."), {
        name: "StudioError",
      });
    };
    await expect(
      readNotesFile({ name: "scan.pdf", bytes: bytes("%PDF-1.4") }, scanned),
    ).rejects.toThrow("scan.pdf: This PDF has little or no selectable text.");
  });

  it("pages text files and never calls the PDF reader for them", async () => {
    const never = async () => {
      throw new Error("not a PDF");
    };
    const f = await readNotesFile(
      { name: "n.md", bytes: bytes("# Light reactions\n\nATP.") },
      never,
    );
    expect(f.pages).toEqual(["# Light reactions\n\nATP."]);
  });
});

describe("textPages", () => {
  it("keeps short text as one page and tidies line endings and blank runs", () => {
    expect(textPages("a\r\nb\n\n\n\n c  \n")).toEqual(["a\nb\n\n c"]);
    expect(textPages("   ")).toEqual([]);
  });

  it("splits long text at paragraph breaks, near the page size", () => {
    const para = (c: string) => `${c.repeat(1999)}.`;
    const pages = textPages([para("a"), para("b"), para("c")].join("\n\n"), 3000);
    expect(pages).toEqual([para("a"), para("b"), para("c")]);
  });

  it("falls back to sentences, then words, then a hard cut", () => {
    const sentences = Array.from({ length: 200 }, (_, i) => `Sentence ${i} here.`).join(" ");
    const pages = textPages(sentences, 1000);
    expect(pages.every((p) => p.length <= 1000 && p.endsWith("."))).toBe(true);
    expect(pages.join(" ")).toBe(sentences);
    expect(textPages("x".repeat(2500), 1000).map((p) => p.length)).toEqual([1000, 1000, 500]);
  });
});

describe("cleanText and cut", () => {
  it("removes characters Postgres or JSON can't hold", () => {
    expect(cleanText("a\u0000b\u0007c\td\ne")).toBe("ab c\td\ne");
    expect(cleanText("x\uD83Dy")).toBe("xy");
    expect(cleanText("ok 😀")).toBe("ok 😀");
  });

  it("never splits a surrogate pair", () => {
    expect(cut("ab😀cd", 3)).toBe("ab");
    expect(cut("ab😀cd", 4)).toBe("ab😀");
    expect(cut("short", 10)).toBe("short");
  });
});

describe("capNotes", () => {
  it("leaves uploads under the cap alone", () => {
    const files = [{ name: "a.txt", pages: ["abc"] }];
    expect(capNotes(files, 10)).toEqual({ files, truncated: false });
  });

  it("shares the cap fairly: a small file keeps everything", () => {
    const { files, truncated } = capNotes(
      [
        { name: "big.pdf", pages: ["x".repeat(600), "y".repeat(600)] },
        { name: "small.txt", pages: ["z".repeat(100)] },
      ],
      500,
    );
    expect(truncated).toBe(true);
    expect(files[1]!.pages).toEqual(["z".repeat(100)]);
    expect(files[0]!.pages).toEqual(["x".repeat(400)]);
    expect(files.reduce((n, f) => n + charCount(f.pages), 0)).toBe(500);
  });

  it("splits budgets fairly", () => {
    expect(fairShares([10, 100, 100], 110)).toEqual([10, 50, 50]);
    expect(fairShares([5, 5], 100)).toEqual([5, 5]);
  });
});

describe("findLinks", () => {
  it("finds http(s) links in order, without the sentence's punctuation", () => {
    const { links } = findLinks(
      "Read https://openstax.org/books/biology-2e/pages/8-2. Also (see https://khanacademy.org/science/photo), " +
        "and https://en.wikipedia.org/wiki/Photosystem_(biology); then [this](https://bio.libretexts.org/a/b).",
    );
    expect(links).toEqual([
      "https://openstax.org/books/biology-2e/pages/8-2",
      "https://khanacademy.org/science/photo",
      "https://en.wikipedia.org/wiki/Photosystem_(biology)",
      "https://bio.libretexts.org/a/b",
    ]);
  });

  it("drops duplicates, answer-sharing and social sites, and local or credentialed links", () => {
    const r = findLinks(
      [
        "https://www.nature.com/articles/x/",
        "https://nature.com/articles/x#fig1",
        "https://www.chegg.com/homework-help/q",
        "https://www.reddit.com/r/biology",
        "http://localhost:3000/a",
        "http://192.168.1.4/notes",
        "https://user:pw@example.edu/private",
        "ftp://files.example.edu/a",
      ].join("\n"),
    );
    expect(r.links).toEqual(["https://www.nature.com/articles/x/"]);
    expect(r.blocked).toBe(2);
    expect(r.found).toBe(1);
  });

  it("opens at most four but counts them all", () => {
    const text = Array.from({ length: 6 }, (_, i) => `https://site${i}.edu/p`).join(" ");
    const r = findLinks(text);
    expect(r.links).toHaveLength(4);
    expect(r.found).toBe(6);
  });
});

describe("notes in prompts", () => {
  const files = [
    { name: "lecture3.pdf", pages: ["a".repeat(100), "", "b".repeat(9000)] },
    { name: "extra.md", pages: ["c".repeat(100)] },
  ];

  it("cites PDF pages by number, splits long pages and skips empty ones", () => {
    const parts = notesParts(files);
    expect(parts.map(notesLabel)).toEqual([
      "Your notes: lecture3.pdf, p. 1",
      "Your notes: lecture3.pdf, p. 3 (1/3)",
      "Your notes: lecture3.pdf, p. 3 (2/3)",
      "Your notes: lecture3.pdf, p. 3 (3/3)",
      "Your notes: extra.md",
    ]);
    expect(parts.every((p) => p.text.length <= 3500)).toBe(true);
  });

  it("names a long text file's parts", () => {
    const parts = notesParts([{ name: "n.txt", pages: ["x".repeat(50), "y".repeat(50)] }]);
    expect(parts.map(notesLabel)).toEqual([
      "Your notes: n.txt, part 1",
      "Your notes: n.txt, part 2",
    ]);
  });

  it("fits a budget by trimming every part, in order", () => {
    const parts = notesParts(files);
    const { parts: kept, sampled } = budgetParts(parts, 5000);
    expect(sampled).toBe(false);
    expect(kept.map(notesLabel)).toEqual(parts.map(notesLabel));
    expect(kept.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(5000);
    expect(kept[0]!.text).toBe("a".repeat(100));
  });

  it("samples pages spread through long notes when trimming would leave too little", () => {
    const many = notesParts([
      { name: "long.pdf", pages: Array.from({ length: 40 }, (_, i) => `${i} `.repeat(400)) },
    ]);
    const { parts, sampled } = budgetParts(many, 5000);
    expect(sampled).toBe(true);
    expect(parts).toHaveLength(10);
    expect(parts[0]!.page).toBe(1);
    expect(parts.at(-1)!.page).toBe(40);
    expect(parts.map((p) => p.page)).toEqual([...parts.map((p) => p.page)].sort((a, b) => a - b));
    expect(parts.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(5000);
  });

  it("leaves notes under the budget untouched", () => {
    const parts = notesParts([{ name: "a.txt", pages: ["short notes here"] }]);
    expect(budgetParts(parts, 1000)).toEqual({ parts, sampled: false });
  });
});

describe("pickForGaps", () => {
  const texts = [
    "Overview of photosynthesis: light and the Calvin cycle.",
    "Cyclic electron flow returns electrons from ferredoxin; non-cyclic electron flow makes NADPH. Cyclic flow makes only ATP.",
    "Chemiosmosis: protons flow through ATP synthase.",
    "Photosynthesis photosynthesis photosynthesis photosynthesis photosynthesis photosynthesis.",
  ];

  it("puts the pages about the gaps first", () => {
    expect(pickForGaps(texts, ["cyclic and non-cyclic electron flow", "chemiosmosis"], 2)).toEqual([
      1, 2,
    ]);
  });

  it("keeps the original order when there are no gaps", () => {
    expect(pickForGaps(texts, [], 3)).toEqual([0, 1, 2]);
  });
});

describe("what she says", () => {
  it("joins lists in plain English", () => {
    expect(listJoin([])).toBe("");
    expect(listJoin(["A"])).toBe("A");
    expect(listJoin(["A", "B"])).toBe("A and B");
    expect(listJoin(["A", "B", "C"])).toBe("A, B and C");
  });

  it("says what the notes cover and what TinyFish will look up", () => {
    const outline = [{ heading: "Photosystem II" }, { heading: "Electron transport" }];
    expect(notesReply({ topic: "Light reactions", outline, gaps: ["chemiosmosis"] }, 2)).toBe(
      "Your notes cover “Photosystem II” and “Electron transport”. I'm having TinyFish open the 2 links in them and look for sources on chemiosmosis, where they're thin.",
    );
    expect(notesReply({ topic: "Light reactions", outline: [], gaps: [] }, 0)).toBe(
      "Your notes cover Light reactions. I'm having TinyFish find sources that take Light reactions further.",
    );
  });

  it("describes each uploaded file truthfully", () => {
    expect(readLabel({ name: "l.pdf", pages: ["a", "b"] })).toBe("Read l.pdf · 2 pages");
    expect(readLabel({ name: "n.txt", pages: ["one two", "three"] })).toBe("Read n.txt · 3 words");
  });
});
