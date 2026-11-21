/**
 * The library's keyboard controls: one list for the in-game controls guide (Overlays.tsx, "?")
 * and for Ms. Fenwick's chat replies (lib/fenwick-chat/guide.ts), so what she tells a student
 * always matches the keys that actually work. Plain data: safe to import on the server.
 */
export const CONTROLS: readonly { keys: readonly string[]; label: string }[] = [
  { keys: ["W", "A", "S", "D"], label: "Walk (arrow keys work too)" },
  { keys: ["Mouse"], label: "Look around" },
  { keys: ["Shift"], label: "Hold to free the cursor and click buttons" },
  { keys: ["R"], label: "Walk faster, on or off" },
  { keys: ["E"], label: "Use desk or stand up · speak with the Librarian at her desk" },
  { keys: ["B"], label: "Open your table's whiteboard" },
  { keys: ["L"], label: "Play a lesson on a whiteboard" },
  { keys: ["J", "N"], label: "Join a lesson, or not now" },
  { keys: ["F"], label: "Lesson full screen" },
  { keys: ["P"], label: "Start a pomodoro (at a desk)" },
  { keys: ["V"], label: "Switch between first and third person" },
  { keys: ["Scroll"], label: "Zoom the third-person camera" },
  { keys: ["Enter"], label: "Chat with everyone in the library" },
  { keys: ["Esc"], label: "Open the menu" },
  { keys: ["?"], label: "Show these controls" },
];
