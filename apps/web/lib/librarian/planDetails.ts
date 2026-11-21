/**
 * Before asking for a study plan: did the student's request already say when the exam is, and
 * how long they can study each day? If not, the panel asks (a date and a minutes stepper) rather
 * than letting the plan guess. Deliberately generous: a false "yes" only means the Librarian works
 * it out from the request; a false "no" means one extra, pre-filled question.
 */

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_PATTERNS = [
  /\b\d{4}-\d{1,2}-\d{1,2}\b/, // 2026-12-03
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/, // 12/3, 12/3/2026
  /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/, // 3.12.2026 (not "1.5 hours")
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`, "i"), // Dec 3rd
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTHS})\\b`, "i"), // 3rd of December
  /\b(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b/i, // on Friday (not "the sun")
  /\b(?:today|tonight|tomorrow|(?:next|this) (?:week|month)|end of (?:the )?(?:week|month))\b/i,
  /\bin\s+(?:a|an|one|two|three|four|five|six|\d+)\s+(?:days?|weeks?|months?)\b/i,
];

const TIME_PATTERNS = [
  /\b\d+(?:\.\d+)?\s*(?:-\s*\d+\s*)?(?:m|mins?|minutes?|h|hrs?|hours?)\b/i, // 45 min, 1.5 hours
  /\b(?:an?|one|two|three|half an?)\s+hours?\b/i, // an hour, half an hour
];

/** The request mentions a day or date (an exam on Friday, in two weeks, 2026-12-03). */
export const mentionsDate = (text: string) => DATE_PATTERNS.some((p) => p.test(text));

/** The request mentions an amount of study time (30 minutes a day, an hour, 2h). */
export const mentionsStudyTime = (text: string) => TIME_PATTERNS.some((p) => p.test(text));

/** Today in the viewer's time zone, as "YYYY-MM-DD" (what a date input reads and writes). */
export function localDay(date = new Date()) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** Minutes a day the stepper offers (the server accepts 10–600). */
export const MINUTES_LIMITS = { min: 10, max: 600, step: 15, initial: 30 } as const;

/** One step of the minutes stepper: 10 → 15 → 30 → 45 …, and back down the same way. */
export function stepMinutes(value: number, direction: 1 | -1) {
  const { min, max, step } = MINUTES_LIMITS;
  const next =
    direction > 0 ? Math.floor(value / step) * step + step : Math.ceil(value / step) * step - step;
  return Math.min(max, Math.max(min, next));
}
