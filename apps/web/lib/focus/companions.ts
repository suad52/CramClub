/**
 * Body doubling, the pure half: who studied at your table or near it during a pomodoro, for the
 * "You showed up" card and the timer's "studying near you" line. Only real players in the room
 * count (lib/net/players.ts: remote players, never you, never anything made up), by the name
 * their name tag shows (a first name, or "Guest 4821"). Seated only: sitting down is studying,
 * walking past isn't.
 */

/** The parts of a seat (packages/shared world/library.ts `Seat`) this needs. */
export interface SeatSpot {
  id: string;
  x: number;
  y: number;
  z: number;
  tableId: string | null;
}

/** Seats this close (m, on the same floor) count as nearby even at another table. */
export const NEARBY_M = 4.5;
/** Seats more than this apart in height (m) are on different floors. */
const FLOOR_GAP_M = 1.5;
/** Someone counts as having studied with you after this long nearby during the pomodoro. */
export const COMPANION_MIN_MS = 60_000;
/** The card names at most this many people. */
export const COMPANIONS_SHOWN = 3;

/** Whether `theirs` is at your table or close to your seat. */
export function isNearby(mine: SeatSpot, theirs: SeatSpot) {
  if (mine.id === theirs.id) return false;
  if (mine.tableId && mine.tableId === theirs.tableId) return true;
  if (Math.abs(mine.y - theirs.y) > FLOOR_GAP_M) return false;
  return Math.hypot(mine.x - theirs.x, mine.z - theirs.z) <= NEARBY_M;
}

export interface Neighbour {
  /** The server's sessionId for them (never an account id). */
  id: string;
  name: string;
}

/** Remote players → the seated ones near you (none while you aren't seated). */
export function neighboursOf(
  mine: SeatSpot | null | undefined,
  others: Iterable<{ id: string; name: string; seat: SeatSpot | null | undefined }>,
): Neighbour[] {
  if (!mine) return [];
  const out: Neighbour[] = [];
  for (const o of others)
    if (o.seat && isNearby(mine, o.seat)) out.push({ id: o.id, name: o.name });
  return out;
}

/** Time each neighbour has spent near you this pomodoro (ms), by id. */
export type CompanionLog = ReadonlyMap<string, { name: string; ms: number }>;

/** Credits `stepMs` to everyone near you now (their latest name wins). */
export function addCompanionTime(
  log: CompanionLog,
  near: readonly Neighbour[],
  stepMs: number,
): CompanionLog {
  if (near.length === 0 || !(stepMs > 0)) return log;
  const next = new Map(log);
  for (const n of near) next.set(n.id, { name: n.name, ms: (log.get(n.id)?.ms ?? 0) + stepMs });
  return next;
}

/** Who studied with you: the longest-staying first, each name once. */
export function companionNames(log: CompanionLog, minMs = COMPANION_MIN_MS) {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const { name } of [...log.values()]
    .filter((c) => c.ms >= minMs)
    .sort((a, b) => b.ms - a.ms)) {
    if (seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/** "Maya", "Maya and Theo", "Maya, Theo and Sam", "Maya, Theo, Sam and 2 others". */
export function listNames(names: readonly string[], shown = COMPANIONS_SHOWN) {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length <= shown) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  const rest = names.length - shown;
  return `${names.slice(0, shown).join(", ")} and ${rest} ${rest === 1 ? "other" : "others"}`;
}
