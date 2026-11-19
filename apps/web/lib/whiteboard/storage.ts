import type { BoardItem } from "./types";

/**
 * Boards are saved in this browser for now (one per collaborative table). Phase 5 moves them to
 * a shared Yjs document so everyone at the table sees the same board.
 */
const key = (id: string) => `ovr.board.${id}`;

function isItem(v: unknown): v is BoardItem {
  const k = (v as { kind?: unknown })?.kind;
  return k === "stroke" || k === "image" || k === "text";
}

export function loadBoard(id: string): BoardItem[] {
  try {
    const raw = localStorage.getItem(key(id));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

/** Returns false when the browser refuses (for example, storage is full). */
export function saveBoard(id: string, items: readonly BoardItem[]): boolean {
  try {
    if (items.length === 0) localStorage.removeItem(key(id));
    else localStorage.setItem(key(id), JSON.stringify(items));
    return true;
  } catch {
    return false;
  }
}
