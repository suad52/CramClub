import { create } from "zustand";
import { INK_COLORS, PEN_SIZES, type BoardItem } from "./types";
import { loadBoard, saveBoard } from "./storage";

export type Tool = "pen" | "eraser" | "ask";

const HISTORY_LIMIT = 100;

interface WhiteboardStore {
  /** Board being edited (a collaborative table id), or null when closed. */
  openId: string | null;
  tool: Tool;
  color: string;
  size: number;
  items: BoardItem[];
  past: BoardItem[][];
  future: BoardItem[][];
  /** Bumped whenever a board changes, so its 3D surface can redraw. */
  versions: Record<string, number>;
  /** Last save failed (usually browser storage is full). */
  saveFailed: boolean;
  /** Set once AI handwriting is known to be unavailable this session (skip straight to the font). */
  handwritingBlocked: string | null;

  open: (id: string) => void;
  close: () => void;
  setTool: (tool: Tool) => void;
  setColor: (color: string) => void;
  setSize: (size: number) => void;
  /** Replaces the board contents as one undoable step. */
  commit: (items: BoardItem[]) => void;
  undo: () => void;
  redo: () => void;
  setHandwritingBlocked: (reason: string | null) => void;
}

export const useWhiteboardStore = create<WhiteboardStore>()((set, get) => {
  const persist = (items: BoardItem[]) => {
    const id = get().openId;
    if (!id) return;
    const ok = saveBoard(id, items);
    set((s) => ({ saveFailed: !ok, versions: { ...s.versions, [id]: (s.versions[id] ?? 0) + 1 } }));
  };
  return {
    openId: null,
    tool: "pen",
    color: INK_COLORS[0].color,
    size: PEN_SIZES[1].size,
    items: [],
    past: [],
    future: [],
    versions: {},
    saveFailed: false,
    handwritingBlocked: null,

    open: (id) =>
      set({
        openId: id,
        items: loadBoard(id),
        past: [],
        future: [],
        tool: "pen",
        saveFailed: false,
      }),
    close: () => set({ openId: null, items: [], past: [], future: [] }),
    setTool: (tool) => set({ tool }),
    setColor: (color) => set({ color, tool: "pen" }),
    setSize: (size) => set({ size, tool: "pen" }),
    commit: (items) => {
      set((s) => ({ items, past: [...s.past, s.items].slice(-HISTORY_LIMIT), future: [] }));
      persist(items);
    },
    undo: () => {
      const { past, items, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({ items: prev, past: past.slice(0, -1), future: [items, ...future] });
      persist(prev);
    },
    setHandwritingBlocked: (handwritingBlocked) => set({ handwritingBlocked }),
    redo: () => {
      const { past, items, future } = get();
      const next = future[0];
      if (!next) return;
      set({ items: next, past: [...past, items], future: future.slice(1) });
      persist(next);
    },
  };
});
