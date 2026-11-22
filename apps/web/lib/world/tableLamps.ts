import { SEATS, type Seat } from "@ovr/shared";

/**
 * The table lamps step aside for a lesson: while a table's board has a lesson on it, the brass
 * lamps on that table fade out (they stood between the seats and the board), and when the lesson
 * ends they fade back in. This is the pure part: which table each lamp belongs to, and the fade.
 * components/world/TableLamps.tsx does the drawing.
 */

/** How long a table's lamps take to fade out as a lesson starts on its board (and back in). */
export const LAMP_FADE_SECONDS = 0.6;
/** A lamp further than this from a table's middle isn't that table's (metres). */
export const LAMP_REACH = 3;

/** Each table's middle on the floor: the mean of its seats (they sit along both of its sides). */
export function tableCentres(
  seats: readonly Seat[] = SEATS,
): Map<string, { x: number; z: number }> {
  const sums = new Map<string, { x: number; z: number; n: number }>();
  for (const s of seats) {
    if (!s.tableId) continue;
    const sum = sums.get(s.tableId) ?? { x: 0, z: 0, n: 0 };
    sum.x += s.x;
    sum.z += s.z;
    sum.n++;
    sums.set(s.tableId, sum);
  }
  return new Map([...sums].map(([id, s]) => [id, { x: s.x / s.n, z: s.z / s.n }]));
}

/** The table a lamp at (x, z) stands on, or null when none is within `reach`. */
export function nearestTable(
  x: number,
  z: number,
  centres: ReadonlyMap<string, { x: number; z: number }>,
  reach = LAMP_REACH,
): string | null {
  let best: string | null = null;
  let bestDistance = reach;
  for (const [id, c] of centres) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d < bestDistance) {
      bestDistance = d;
      best = id;
    }
  }
  return best;
}

/** Moves a fade (1 lamps showing … 0 gone) toward `target` by one frame's worth. */
export function stepFade(shown: number, target: 0 | 1, dt: number): number {
  const step = Math.max(0, dt) / LAMP_FADE_SECONDS;
  return target > shown ? Math.min(1, shown + step) : Math.max(0, shown - step);
}

/** The lamps' opacity for a fade value: eased, so they slip away rather than blink. */
export function fadeOpacity(shown: number): number {
  const t = Math.min(1, Math.max(0, shown));
  return t * t * (3 - 2 * t);
}
