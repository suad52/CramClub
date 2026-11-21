import { describe, expect, it } from "vitest";
import { localDay, mentionsDate, mentionsStudyTime, stepMinutes } from "./planDetails";

describe("mentionsDate", () => {
  it.each([
    "My chemistry exam is on 2026-12-03",
    "exam on 12/3",
    "final on Dec 3rd",
    "it's on the 3rd of December",
    "the quiz is next Friday",
    "test tomorrow!",
    "the midterm is in two weeks",
    "exam in 10 days",
    "by the end of the month",
  ])("finds a date in %j", (text) => expect(mentionsDate(text)).toBe(true));

  it.each([
    "Help me study for an upcoming exam",
    "Explain how the sun produces energy",
    "I can do 1.5 hours a day",
    "Research satellites and the solar system",
    "I may need help with derivatives",
  ])("finds no date in %j", (text) => expect(mentionsDate(text)).toBe(false));
});

describe("mentionsStudyTime", () => {
  it.each(["30 minutes a day", "I have 45 min", "1.5 hours", "2h each evening", "about an hour"])(
    "finds study time in %j",
    (text) => expect(mentionsStudyTime(text)).toBe(true),
  );

  it.each(["Build a study plan", "exam on Friday", "Explain the 2nd law of thermodynamics"])(
    "finds no study time in %j",
    (text) => expect(mentionsStudyTime(text)).toBe(false),
  );
});

describe("stepMinutes", () => {
  it("steps by 15 minutes between 10 and 600", () => {
    expect(stepMinutes(10, 1)).toBe(15);
    expect(stepMinutes(15, 1)).toBe(30);
    expect(stepMinutes(30, -1)).toBe(15);
    expect(stepMinutes(15, -1)).toBe(10);
    expect(stepMinutes(10, -1)).toBe(10);
    expect(stepMinutes(600, 1)).toBe(600);
  });
});

describe("localDay", () => {
  it("formats a local calendar day for a date input", () => {
    expect(localDay(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
