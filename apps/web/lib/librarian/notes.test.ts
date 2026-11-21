import { describe, expect, it } from "vitest";
import {
  EMPTY_NOTES,
  addNotesFiles,
  formatSize,
  lessonSourcesLine,
  minutesLabel,
  notesDeclined,
  notesForm,
  notesMessage,
  notesMessageProblem,
  notesTurn,
} from "./notes";
import { NOTES_LIMITS } from "./types";

const file = (name: string, size = 2048) => ({ name, size });

describe("addNotesFiles", () => {
  it("adds PDFs, .txt and .md files, whatever the case of the extension", () => {
    const out = addNotesFiles([], [file("lecture3.pdf"), file("week1.TXT"), file("ch2.md")]);
    expect(out.files.map((f) => f.name)).toEqual(["lecture3.pdf", "week1.TXT", "ch2.md"]);
    expect(out.problems).toEqual([]);
  });

  it("leaves out other kinds of file, and says why", () => {
    const out = addNotesFiles([], [file("slides.pptx"), file("README")]);
    expect(out.files).toEqual([]);
    expect(out.problems).toHaveLength(2);
    expect(out.problems[0]).toContain("“slides.pptx” isn't a PDF, .txt or .md file");
  });

  it("leaves out files that are too big or empty", () => {
    const big = file("scan.pdf", NOTES_LIMITS.maxBytes + 1);
    const out = addNotesFiles([], [big, file("blank.txt", 0)]);
    expect(out.files).toEqual([]);
    expect(out.problems[0]).toBe("“scan.pdf” is 15.1 MB. Each file can be up to 15 MB.");
    expect(out.problems[1]).toBe("“blank.txt” is empty.");
  });

  it("accepts a file exactly at the size limit", () => {
    const out = addNotesFiles([], [file("max.pdf", NOTES_LIMITS.maxBytes)]);
    expect(out.files).toHaveLength(1);
  });

  it("doesn't add the same file twice", () => {
    const a = file("a.pdf");
    const out = addNotesFiles([a], [file("a.pdf")]);
    expect(out.files).toEqual([a]);
    expect(out.problems).toEqual(["“a.pdf” is already added."]);
  });

  it("stops at the file limit and names what was left out", () => {
    const out = addNotesFiles([file("a.pdf"), file("b.pdf")], [file("c.pdf"), file("d.pdf")]);
    expect(out.files.map((f) => f.name)).toEqual(["a.pdf", "b.pdf", "c.pdf"]);
    expect(out.problems).toEqual([
      "She reads up to 3 files at a time, so “d.pdf” wasn't added. Remove one to make room.",
    ]);
    const many = addNotesFiles(
      [],
      ["1", "2", "3", "4", "5"].map((n) => file(`${n}.md`)),
    );
    expect(many.problems[0]).toContain("so 2 files weren't added");
  });
});

describe("notesForm", () => {
  const files = [new File(["notes"], "lecture3.pdf", { type: "application/pdf" })];

  it("sends the fields the endpoint reads", () => {
    const form = notesForm(
      { ...EMPTY_NOTES, files, outcome: "both", examDate: "2026-12-03", minutesPerDay: 45 },
      "  Midterm on Friday  ",
    );
    expect(form.getAll("files")).toHaveLength(1);
    expect((form.get("files") as File).name).toBe("lecture3.pdf");
    expect(form.get("message")).toBe("Midterm on Friday");
    expect(form.get("outcome")).toBe("both");
    expect(form.get("examDate")).toBe("2026-12-03");
    expect(form.get("minutesPerDay")).toBe("45");
  });

  it("leaves out what wasn't set, and the plan's details for a lesson only", () => {
    const empty = notesForm({ ...EMPTY_NOTES, files, outcome: "plan" }, " ");
    expect(empty.has("message")).toBe(false);
    expect(empty.has("examDate")).toBe(false);
    expect(empty.has("minutesPerDay")).toBe(false);
    const lesson = notesForm(
      { ...EMPTY_NOTES, files, outcome: "lesson", examDate: "2026-12-03", minutesPerDay: 30 },
      "",
    );
    expect(lesson.get("outcome")).toBe("lesson");
    expect(lesson.has("examDate")).toBe(false);
    expect(lesson.has("minutesPerDay")).toBe(false);
  });
});

describe("words", () => {
  it("says what the student shared", () => {
    expect(notesTurn(1, "")).toBe("Shared 1 file of notes");
    expect(notesTurn(3, " weak on recursion ")).toBe("Shared 3 files of notes\nweak on recursion");
  });

  it("leaves out the server's stand-in request when there was no message", () => {
    const names = ["a.pdf", "b.md"];
    expect(notesMessage("Study from my notes: a.pdf, b.md", names)).toBe("");
    expect(notesMessage("Midterm on Friday", names)).toBe("Midterm on Friday");
  });

  it("formats sizes and study time", () => {
    expect(formatSize(500)).toBe("1 KB");
    expect(formatSize(2.44 * 1024 * 1024)).toBe("2.4 MB");
    expect(minutesLabel(45)).toBe("45 min");
    expect(minutesLabel(60)).toBe("1 hour");
    expect(minutesLabel(90)).toBe("1.5 hours");
  });

  it("says where a lesson came from", () => {
    const notes = { url: "" };
    const web = { url: "https://example.org" };
    expect(lessonSourcesLine([web, web])).toBe("from 2 sources");
    expect(lessonSourcesLine([notes, notes])).toBe("from your notes");
    expect(lessonSourcesLine([notes, web])).toBe("from your notes and 1 web source");
    expect(lessonSourcesLine([])).toBe("");
  });

  it("says when a message is too long to go with the notes, instead of cutting it", () => {
    expect(notesMessageProblem("  midterm on Friday  ")).toBeNull();
    expect(notesMessageProblem(`  ${"a".repeat(1000)}  `)).toBeNull();
    expect(notesMessageProblem("a".repeat(1240))).toBe(
      "Your message is 1,240 characters. With notes, keep it to 1,000 or fewer.",
    );
  });
});

describe("notesDeclined", () => {
  const task = {
    type: "study_from_notes" as const,
    status: "completed" as const,
    plan: null,
    lesson: null,
  };

  it("is a finished notes request with neither a plan nor a lesson", () => {
    expect(notesDeclined(task)).toBe(true);
  });

  it("isn't one that's still going, has a plan or lesson, or isn't from notes", () => {
    expect(notesDeclined({ ...task, status: "reading_notes" })).toBe(false);
    expect(notesDeclined({ ...task, plan: {} as never })).toBe(false);
    expect(notesDeclined({ ...task, lesson: {} as never })).toBe(false);
    expect(notesDeclined({ ...task, type: "research_topic" })).toBe(false);
  });
});
