import type { ShushReason } from "./shush";

/**
 * What Ms. Fenwick says (pure, so it's testable): her shushes, in character (a kindly strict
 * librarian, never cruel), and the one-line encouragement on the "You showed up" card. Each line
 * comes with and without the student's first name; `{name}` is filled in. No line shames anyone,
 * and none mentions a camera or a score: she just noticed, the way a librarian would.
 */

type Line = readonly [named: string, plain: string];

/** Their face has been missing or turned away for a while, mid-pomodoro. */
export const DRIFT_LINES: readonly Line[] = [
  ["Shh. {name}, the page is down here, dear.", "Shh. The page is down here, dear."],
  ["{name}, eyes on the book, please. It won't read itself.", "Eyes on the book, please, dear."],
  [
    "Ahem. {name}, the ceiling has nothing to teach you, dear.",
    "Ahem. The ceiling has nothing to teach you, dear.",
  ],
  [
    "Shh, {name}. Back to it. I'll keep the hall quiet if you keep your eyes down.",
    "Shh. Back to it. I'll keep the hall quiet if you keep your eyes down.",
  ],
  [
    "{name}, dear. Wherever you've wandered off to, the chapter is right here.",
    "Wherever you've wandered off to, dear, the chapter is right here.",
  ],
  ["Psst. {name}. Your desk misses you.", "Psst. Your desk misses you, dear."],
  [
    "Shh. The clock's still running, {name}. Back to the page.",
    "Shh. The clock's still running, dear. Back to the page.",
  ],
  [
    "{name}. Just this one pomodoro, dear. You can daydream at the break.",
    "Just this one pomodoro, dear. You can daydream at the break.",
  ],
  ["Mm-hm. I see you, {name}. Page, please.", "Mm-hm. I see you, dear. Page, please."],
  [
    "Shh, {name}. The whole hall is rooting for you. Quietly.",
    "Shh. The whole hall is rooting for you, dear. Quietly.",
  ],
];

/** They came back to the tab just in time (a near miss). */
export const BACK_LINES: readonly Line[] = [
  [
    "There you are, {name}. Let's not wander off again, dear.",
    "There you are. Let's not wander off again, dear.",
  ],
  [
    "Welcome back, {name}. The book kept your place. Shh, now.",
    "Welcome back, dear. The book kept your place. Shh, now.",
  ],
  [
    "{name}, that was close, dear. Settle in. Eyes on the page.",
    "That was close, dear. Settle in. Eyes on the page.",
  ],
  [
    "Ah, {name}. The other tab can wait. Your pomodoro can't.",
    "Ah. The other tab can wait, dear. Your pomodoro can't.",
  ],
  ["Back already? Good, {name}. Stay with me now.", "Back already? Good. Stay with me now, dear."],
];

/** A name as it would appear on a name tag that isn't really a name. */
const NOT_A_NAME = /^(guest \d+|reader|someone)$/i;

/**
 * The first name she calls the student by: the name the library shows above their head (from
 * their join ticket, as the HUD's "Others see you as …" does), unless that's a guest number; else
 * their character's name. Null when there's nothing friendly to call them.
 */
export function studentFirstName(netName: string | null | undefined, profileName: string) {
  const first = (s: string | null | undefined) => (s ?? "").trim().split(/\s+/)[0] ?? "";
  const net = (netName ?? "").trim();
  if (net && !NOT_A_NAME.test(net)) return first(net).slice(0, 20) || null;
  const whole = profileName.trim().replace(/\s+/g, " ");
  if (!whole || NOT_A_NAME.test(whole)) return null;
  return first(whole).slice(0, 20) || null;
}

function fill([named, plain]: Line, name: string | null) {
  return name ? named.replaceAll("{name}", name) : plain;
}

/**
 * A shush for `reason`. `pick` (0 ≤ pick < 1) chooses the line; `avoid` is the last one she said,
 * so she never says the same thing twice running.
 */
export function shushLine(
  reason: ShushReason,
  name: string | null,
  pick: number,
  avoid: string | null = null,
) {
  const lines = reason === "back" ? BACK_LINES : DRIFT_LINES;
  const n = lines.length;
  const p = Number.isFinite(pick) ? Math.min(Math.max(pick, 0), 0.999999) : 0;
  let i = Math.floor(p * n);
  const line = fill(lines[i]!, name);
  if (line !== avoid) return line;
  i = (i + 1) % n;
  return fill(lines[i]!, name);
}

export interface RecapMood {
  /** Seen at the desk (%), or null with the camera off. */
  percent: number | null;
  /** People who studied nearby. */
  companions: number;
  /** Pomodoros done in this set (this one included). */
  count: number;
  long: boolean;
}

/** Warm notes for any pomodoro: showing up is the point. */
const ALWAYS = [
  "Showing up is the hardest part, and you did it.",
  "One more pomodoro in the book. Well done, dear.",
  "That's how it's done: one quiet stretch at a time.",
  "Lovely work. Your future self says thank you.",
];

/** The note on the "You showed up" card, from her: forgiving, never a scold. */
export function encouragement(mood: RecapMood, pick: number) {
  const p = Number.isFinite(pick) ? Math.min(Math.max(pick, 0), 0.999999) : 0;
  if (mood.long) return "A whole set! Go and stretch your legs properly. You've earned it.";
  if (mood.companions > 0 && p < 0.5)
    return mood.companions === 1
      ? "You kept each other going. That's what the library is for."
      : "Look at you all, keeping each other going. That's what the library is for.";
  if (mood.percent !== null && mood.percent >= 85 && p < 0.75)
    return "Locked in from start to finish. I hardly had to look up.";
  if (mood.count >= 3 && p < 0.9) return `That's ${mood.count} in a row. Steady does it.`;
  return ALWAYS[Math.floor(p * ALWAYS.length)]!;
}
