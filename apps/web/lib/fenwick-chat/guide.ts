import { CONTROLS } from "@/lib/game/controls";

/**
 * What Ms. Fenwick knows about using Cram Club, for "how do I…" questions in the library chat.
 * Built from the same controls list as the in-game guide (lib/game/controls.ts) plus the menu and
 * the main features, so she points students at things that really exist instead of guessing.
 * Keep it short: it goes into every chat request's system instruction.
 */
const keys = CONTROLS.map((c) => `- ${c.keys.join(" / ")}: ${c.label}`).join("\n");

export const LIBRARY_GUIDE = `How Cram Club works (the only features and keys that exist; never invent others):
Keys:
${keys}
Pomodoros: sit at a table (walk up, press E), then press P or use the clock on your table. 25 minutes focus, 5 short break, 15 long break by default, adjustable in the clock's settings. Stay in the tab and at the table or it won't count. Each finished pomodoro earns XP.
Tables: sitting at a free table offers to hold it for an hour, open to everyone or private (signed in) with invite links, email invites or a Study Circle. B opens the table's whiteboard.
Learning: press E at your (the Librarian's) desk to ask about anything they're studying; you research it with sources, or build a study plan or narrated lesson from their notes (up to 3 PDFs or text files). Lessons play on the rolling whiteboards (L), with a short quiz.
Menu (Esc): The Librarian, Learning Studio, My progress (XP, streaks, weekly leaderboards), Camera and face (optional face tracking for "seen at desk" focus minutes; the camera image never leaves their computer), Your character (opens the Character Studio: hair, outfits, faces, colours), Your voice, View, Controls, Mouse and graphics, Sign in.
Chat: Enter opens it, Esc closes it. The switch under the chat turns off your answering when nobody else does.`;
