"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hashString } from "@ovr/shared";
import { IconBoard, IconClose, IconCopy, IconTrash, IconWarning } from "@/components/ui/icons";
import { BTN, BTN_SM, DIVIDER, FOCUS, HUD_CHIP, ICON_BTN, PANEL } from "@/components/ui/styles";
import {
  AskAiError,
  type Solution,
  handwriteSolution,
  solveSelection,
} from "@/lib/whiteboard/askAi";
import {
  dominantInkColor,
  estimateLineHeight,
  hitsItem,
  itemsInRect,
  planAnswerArea,
  rectFromPoints,
} from "@/lib/whiteboard/geometry";
import { ImageCache, drawItems, loadHandFont, strokePath } from "@/lib/whiteboard/render";
import { layoutStrokes, loadStrokeFont, measureLine } from "@/lib/whiteboard/strokeFont";
import { type WritingSchedule, frameAt, scheduleWriting } from "@/lib/whiteboard/writer";
import { type Tool, useWhiteboardStore } from "@/lib/whiteboard/store";
import { type FingerSample, startFingerPen } from "@/lib/whiteboard/fingerPen";
import {
  BOARD_H,
  BOARD_W,
  type BoardItem,
  INK_COLORS,
  PEN_SIZES,
  type Point,
  type Rect,
  type StrokeItem,
  newId,
} from "@/lib/whiteboard/types";

type AiState =
  | { status: "idle" }
  | { status: "reading" }
  | { status: "writing"; area: Rect }
  | { status: "done"; solution: Solution; note?: string }
  | { status: "error"; message: string };

const ERASER_RADIUS = 14;

/** Drawn like the shared icon set (24px grid, currentColor, hidden from readers), a bit bolder. */
function LineIcon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="shrink-0"
    >
      <path d={d} />
    </svg>
  );
}

const TOOL_ICONS: Record<Tool, string> = {
  // A pencil.
  pen: "M4.75 19.25l.9-3.9L15.6 5.4a1.9 1.9 0 012.7 0l.3.3a1.9 1.9 0 010 2.7L8.65 18.35zM13.75 7.25l3 3",
  // A block eraser on its edge.
  eraser:
    "M9 19.25h10.25M5.45 13.55l8.1-8.1a1.9 1.9 0 012.7 0l2.3 2.3a1.9 1.9 0 010 2.7l-7.4 7.4a3 3 0 01-2.12.88H8.6a1.9 1.9 0 01-1.35-.55l-1.8-1.8a1.9 1.9 0 010-2.83zM9.25 9.75l5 5",
  // A selection box with a question in it.
  ask: "M4.75 8.25v-3.5h3.5M15.75 4.75h3.5v3.5M19.25 15.75v3.5h-3.5M8.25 19.25h-3.5v-3.5M10.1 10.1a1.95 1.95 0 113 1.65c-.6.38-1.1.8-1.1 1.5M12 15.4v.1",
};
const UNDO_ICON = "M9 5.75 4.75 10 9 14.25M4.75 10h9.5a5 5 0 010 10H12";
const REDO_ICON = "M15 5.75 19.25 10 15 14.25M19.25 10h-9.5a5 5 0 000 10H12";

/** A segmented group of tool buttons: a chunky outlined tray, the chosen one a sun key. */
const SEGMENTED = "flex items-center gap-1 rounded-[14px] border-2 border-walnut bg-canvas p-1";
/** A small walnut keycap for the Esc hints. */
const KBD_SM = "kbd !h-5 !min-w-5 !px-1 !text-[0.68rem]";

/** A small spinner for "working on it" (still under reduced motion). */
function Spinner() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      focusable="false"
      className="h-4 w-4 shrink-0 text-sun motion-safe:animate-spin"
    >
      <circle
        cx="12"
        cy="12"
        r="8.25"
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.3}
        strokeWidth={3}
      />
      <path
        d="M20.25 12A8.25 8.25 0 0012 3.75"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A pointing hand, for drawing with your finger. */
const FINGER_ICON =
  "M9.5 11V4.75a1.5 1.5 0 013 0V10m0 0V9a1.5 1.5 0 013 0v2m0-.5a1.5 1.5 0 013 0v3.25a6.5 6.5 0 01-6.5 6.5h-.6a5.5 5.5 0 01-4.6-2.5L5 15.25a1.5 1.5 0 012.45-1.7L9.5 15";

function ToolButton({
  active,
  label,
  onClick,
  children,
  disabled,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex h-9 min-w-9 shrink-0 items-center justify-center gap-1.5 border-2 px-2.5 font-display text-[13.5px] font-semibold whitespace-nowrap transition-[background-color,color,transform,box-shadow] duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none ${FOCUS} ${
        active
          ? "rounded-[10px] border-walnut bg-sun text-walnut shadow-[0_2px_0_#1f1a16]"
          : active === false
            ? "rounded-[10px] border-transparent text-ink-soft enabled:hover:bg-surface enabled:hover:text-walnut"
            : "rounded-[12px] border-walnut bg-surface text-walnut shadow-[0_3px_0_#1f1a16] enabled:hover:-translate-y-px enabled:hover:bg-canvas enabled:active:translate-y-[2px] enabled:active:shadow-[0_1px_0_#1f1a16]"
      }`}
    >
      {children}
    </button>
  );
}

function Board({ id }: { id: string }) {
  const items = useWhiteboardStore((s) => s.items);
  const tool = useWhiteboardStore((s) => s.tool);
  const color = useWhiteboardStore((s) => s.color);
  const size = useWhiteboardStore((s) => s.size);
  const canUndo = useWhiteboardStore((s) => s.past.length > 0);
  const canRedo = useWhiteboardStore((s) => s.future.length > 0);
  const saveFailed = useWhiteboardStore((s) => s.saveFailed);
  const { setTool, setColor, setSize, commit, undo, redo } = useWhiteboardStore.getState();

  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [cssSize, setCssSize] = useState({ w: 800, h: 500 });
  const live = useRef<StrokeItem | null>(null);
  const erasing = useRef<Set<string>>(new Set());
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<Rect | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [ai, setAi] = useState<AiState>({ status: "idle" });
  /** Drawing with your finger through the webcam (lib/whiteboard/fingerPen.ts). */
  const [finger, setFinger] = useState<"off" | "starting" | "on" | "error">("off");
  const [tip, setTip] = useState<FingerSample | null>(null);
  const fingerStop = useRef<(() => void) | null>(null);
  const fingerStroke = useRef(false);
  const previewBox = useRef<HTMLDivElement>(null);
  const penNow = useRef({ color, size, busy: false });
  const abort = useRef<AbortController | null>(null);
  /** The answer currently being written out stroke by stroke, if any. */
  const writer = useRef<{
    items: StrokeItem[];
    schedule: WritingSchedule;
    startedAt: number;
    frame: number;
    resolve: () => void;
  } | null>(null);
  const [writingOut, setWritingOut] = useState(false);
  const [, bump] = useState(0);
  const images = useMemo(() => new ImageCache(() => bump((n) => n + 1)), []);
  const busy = ai.status === "reading" || ai.status === "writing";

  // Redraw once the handwriting font for AI answers has downloaded.
  useEffect(() => {
    let live = true;
    void loadHandFont().then(() => live && bump((n) => n + 1));
    return () => {
      live = false;
    };
  }, []);

  // Fit a 16:10 board inside the available space.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect;
      // Never bigger than the space available, so it can't slide under the toolbar in short windows.
      const w = Math.max(120, Math.min(width, (height * BOARD_W) / BOARD_H));
      setCssSize({ w, h: (w * BOARD_H) / BOARD_W });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const draw = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(cssSize.w * dpr);
    const ph = Math.round(cssSize.h * dpr);
    if (el.width !== pw || el.height !== ph) {
      el.width = pw;
      el.height = ph;
    }
    const ctx = el.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, pw, ph);
    const s = pw / BOARD_W;
    ctx.setTransform(s, 0, 0, s, 0, 0);
    const visible =
      erasing.current.size > 0 ? items.filter((i) => !erasing.current.has(i.id)) : items;
    drawItems(ctx, visible, images);
    if (live.current) {
      ctx.fillStyle = live.current.color;
      ctx.fill(strokePath(live.current, true));
    }
    const w = writer.current;
    if (w) {
      const f = frameAt(w.schedule, (performance.now() - w.startedAt) / 1000);
      for (let i = 0; i < f.done; i++) {
        ctx.fillStyle = w.items[i]!.color;
        ctx.fill(strokePath(w.items[i]!));
      }
      const current = w.items[f.done];
      if (current && f.partial.length > 0) {
        ctx.fillStyle = current.color;
        ctx.fill(strokePath({ ...current, points: f.partial }, true));
      }
      if (f.tip) {
        // A little pen tip so it reads as someone writing.
        const r = Math.max(5, (current ?? w.items[0]!).size * 0.9);
        ctx.beginPath();
        ctx.arc(f.tip[0], f.tip[1], r, 0, Math.PI * 2);
        ctx.fillStyle = (current ?? w.items[0]!).color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.stroke();
      }
    }
    const box = ai.status === "writing" && !w ? ai.area : selection;
    if (box) {
      ctx.save();
      ctx.setLineDash([12, 8]);
      ctx.lineWidth = 3;
      // Tangerine while the AI writes, walnut for your own selection (the cartoon palette).
      ctx.strokeStyle = ai.status === "writing" ? "#e07a3f" : "#1f1a16";
      ctx.fillStyle = ai.status === "writing" ? "rgba(224,122,63,0.12)" : "rgba(242,207,126,0.22)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
    if (tool === "eraser" && cursor) {
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, ERASER_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(37,41,35,0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }, [ai, cssSize, cursor, images, items, selection, tool]);

  useEffect(() => {
    draw();
  });
  // The animation loop calls whatever the latest draw function is.
  const drawRef = useRef(draw);
  useEffect(() => {
    penNow.current = { color, size, busy };
  });
  useEffect(() => () => fingerStop.current?.(), []);
  useEffect(() => {
    drawRef.current = draw;
  });

  /** Puts the written-out strokes on the board for real (one undo step) and ends the animation. */
  const finishWriting = useCallback(() => {
    const w = writer.current;
    if (!w) return;
    cancelAnimationFrame(w.frame);
    writer.current = null;
    setWritingOut(false);
    useWhiteboardStore.getState().commit([...useWhiteboardStore.getState().items, ...w.items]);
    w.resolve();
  }, []);

  /** Animates `items` onto the board following `schedule`; resolves once they're on the board. */
  const writeOut = useCallback(
    (items: StrokeItem[], schedule: WritingSchedule) =>
      new Promise<void>((resolve) => {
        const tick = () => {
          const w = writer.current;
          if (!w) return;
          drawRef.current();
          if ((performance.now() - w.startedAt) / 1000 >= schedule.duration) finishWriting();
          else w.frame = requestAnimationFrame(tick);
        };
        writer.current = { items, schedule, startedAt: performance.now(), frame: 0, resolve };
        setWritingOut(true);
        writer.current.frame = requestAnimationFrame(tick);
      }),
    [finishWriting],
  );

  /** Done / Esc: if an answer is mid-writing, finish it first so nothing is lost. */
  const closeBoard = useCallback(() => {
    finishWriting();
    useWhiteboardStore.getState().close();
  }, [finishWriting]);

  /** One camera frame: the fingertip moves the cursor; pointing draws, anything else lifts the pen. */
  const onFinger = useCallback((s: FingerSample | null) => {
    setTip(s);
    const { color: c, size: sz, busy: b } = penNow.current;
    if (s?.drawing && !b) {
      const pt: Point = [s.x * BOARD_W, s.y * BOARD_H, 0.5];
      const cur = live.current;
      if (!fingerStroke.current || !cur) {
        fingerStroke.current = true;
        live.current = {
          kind: "stroke",
          id: newId(),
          points: [pt],
          color: c,
          size: sz,
          pressure: false,
        };
      } else {
        const last = cur.points[cur.points.length - 1]!;
        // Ignore tiny jitter so a held finger doesn't scribble.
        if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) < 2) return;
        live.current = { ...cur, points: [...cur.points, pt] };
      }
      drawRef.current();
    } else if (fingerStroke.current) {
      fingerStroke.current = false;
      const stroke = live.current;
      live.current = null;
      if (stroke && stroke.points.length > 1) {
        const store = useWhiteboardStore.getState();
        store.commit([...store.items, stroke]);
      }
      drawRef.current();
    }
  }, []);

  const toggleFinger = async () => {
    if (fingerStop.current || finger === "starting") {
      fingerStop.current?.();
      fingerStop.current = null;
      setFinger("off");
      setTip(null);
      return;
    }
    setFinger("starting");
    try {
      const { stop, video } = await startFingerPen(onFinger);
      fingerStop.current = stop;
      video.className = "h-full w-full -scale-x-100 object-cover";
      previewBox.current?.replaceChildren(video);
      setFinger("on");
    } catch {
      setFinger("error");
    }
  };

  const toBoard = (e: React.PointerEvent): { x: number; y: number } => {
    const rect = canvas.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * BOARD_W,
      y: ((e.clientY - rect.top) / rect.height) * BOARD_H,
    };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toBoard(e);
    if (tool === "pen") {
      const pressure = e.pointerType === "pen";
      live.current = {
        kind: "stroke",
        id: newId(),
        points: [[p.x, p.y, pressure ? e.pressure : 0.5]],
        color,
        size,
        pressure,
      };
    } else if (tool === "eraser") {
      erasing.current = new Set(
        items.filter((i) => hitsItem(i, p.x, p.y, ERASER_RADIUS)).map((i) => i.id),
      );
    } else {
      dragStart.current = p;
      setSelection(null);
      if (ai.status !== "idle") setAi({ status: "idle" });
    }
    draw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = toBoard(e);
    if (tool === "eraser") setCursor(p);
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    if (tool === "pen" && live.current) {
      // Coalesced events give smooth curves on fast strokes.
      const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
      const rect = canvas.current!.getBoundingClientRect();
      const pts: Point[] = events.map((ev) => [
        ((ev.clientX - rect.left) / rect.width) * BOARD_W,
        ((ev.clientY - rect.top) / rect.height) * BOARD_H,
        live.current!.pressure ? ev.pressure : 0.5,
      ]);
      live.current = { ...live.current, points: [...live.current.points, ...pts] };
      draw();
    } else if (tool === "eraser") {
      for (const i of items) if (hitsItem(i, p.x, p.y, ERASER_RADIUS)) erasing.current.add(i.id);
      draw();
    } else if (tool === "ask" && dragStart.current) {
      setSelection(rectFromPoints(dragStart.current.x, dragStart.current.y, p.x, p.y));
    }
  };

  const onPointerUp = () => {
    if (tool === "pen" && live.current) {
      const stroke = live.current;
      live.current = null;
      commit([...items, stroke]);
    } else if (tool === "eraser" && erasing.current.size > 0) {
      const gone = erasing.current;
      erasing.current = new Set();
      commit(items.filter((i) => !gone.has(i.id)));
    } else if (tool === "ask") {
      dragStart.current = null;
      setSelection((sel) => (sel && sel.w > 24 && sel.h > 16 ? sel : null));
    }
  };

  const askAi = async () => {
    if (!selection) return;
    const sel = selection;
    const controller = new AbortController();
    abort.current = controller;
    setAi({ status: "reading" });
    try {
      const board = useWhiteboardStore.getState().items;
      const solution = await solveSelection(board, images, sel, controller.signal);
      if (!solution.readable) {
        setAi({
          status: "error",
          message: solution.answer || "I couldn't find a question to answer in that box.",
        });
        return;
      }
      const inQuestion = itemsInRect(board, sel);
      const lineHeight = estimateLineHeight(inQuestion);
      // Answer in the colour and pen size the question was written with, not the current pen.
      const ink = dominantInkColor(inQuestion) ?? color;
      const penSizes = inQuestion
        .filter((i): i is StrokeItem => i.kind === "stroke")
        .map((i) => i.size)
        .sort((a, b) => a - b);
      const penSize = penSizes[Math.floor(penSizes.length / 2)] ?? size;
      // The single-line font measures the answer and writes it out stroke by stroke.
      const font = await loadStrokeFont().catch(() => null);
      const measure = font
        ? (line: string, lh: number) => measureLine(font, line, { lineHeight: lh, seed: 0 })
        : undefined;
      const plan = planAnswerArea(sel, solution.lines, lineHeight, board, measure);
      setAi({ status: "writing", area: plan.rect });
      setSelection(null);

      // 1. With billing on, Gemini writes the answer in the student's own handwriting.
      let image: BoardItem | null = null;
      let note: string | undefined;
      const fallback = font
        ? "The board's pen wrote it out instead."
        : "Written in a handwriting font instead.";
      const blocked = useWhiteboardStore.getState().handwritingBlocked;
      if (!blocked) {
        try {
          const written = await handwriteSolution(
            { items: board, images, selection: sel, plan, lines: solution.lines, inkColor: ink },
            controller.signal,
          );
          if (written) {
            image = {
              kind: "image",
              id: newId(),
              ...written.rect,
              src: written.src,
              alt: solution.answer,
            };
          } else {
            note = `The AI's handwriting didn't come out clearly. ${fallback}`;
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") throw err;
          const message =
            err instanceof AskAiError ? err.message : "AI handwriting didn't work this time.";
          if (
            err instanceof AskAiError &&
            (err.code === "handwriting_unavailable" || err.code === "not_configured") &&
            /billing|turned off/i.test(message)
          ) {
            useWhiteboardStore.getState().setHandwritingBlocked(message);
          }
          note = `${message} ${fallback}`;
        }
      } else {
        note = `${blocked} ${fallback}`;
      }
      if (image) {
        commit([...useWhiteboardStore.getState().items, image]);
        setAi({ status: "done", solution, note });
        return;
      }

      // 2. Otherwise the board writes the answer out with real pen strokes.
      if (font) {
        abort.current = null; // Esc now skips to the end instead of cancelling.
        const strokes = layoutStrokes(font, solution.lines, plan.rect, {
          lineHeight: plan.lineHeight,
          // Same answer, same wobbles; different answers look different.
          seed: hashString(
            `${solution.answer}|${Math.round(plan.rect.x)}|${Math.round(plan.rect.y)}`,
          ),
        });
        const items: StrokeItem[] = strokes.map((st) => ({
          kind: "stroke",
          id: newId(),
          points: st.points,
          color: ink,
          size: penSize,
          pressure: false,
        }));
        await writeOut(items, scheduleWriting(strokes, plan.lineHeight));
        setAi({ status: "done", solution, note });
        return;
      }

      // 3. Last resort (the stroke font couldn't load): a typed handwriting font.
      const text: BoardItem = {
        kind: "text",
        id: newId(),
        ...plan.rect,
        lines: solution.lines,
        color: ink,
        lineHeight: plan.lineHeight,
      };
      commit([...useWhiteboardStore.getState().items, text]);
      setAi({ status: "done", solution, note });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setAi({ status: "idle" });
        return;
      }
      setAi({
        status: "error",
        message: err instanceof Error ? err.message : "Something went wrong.",
      });
    } finally {
      abort.current = null;
    }
  };

  // Keyboard: Esc cancels a selection or closes; Cmd/Ctrl+Z undoes, with Shift (or Ctrl+Y) redoes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (writer.current) finishWriting();
        else if (abort.current) abort.current.abort();
        else if (selection) setSelection(null);
        else closeBoard();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closeBoard, finishWriting, redo, selection, undo]);

  useEffect(() => () => abort.current?.abort(), []);

  const tableNumber = Number(/(\d+)$/.exec(id)?.[1] ?? 0);
  const hint =
    tool === "pen"
      ? "Write or draw anything."
      : tool === "eraser"
        ? "Drag over anything to erase it."
        : "Drag a box around your question, then press Ask AI. This sends that part of the board to Google Gemini.";

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-[24px] border-[3px] border-walnut bg-canvas shadow-[0_6px_0_#1f1a16]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b-[3px] border-walnut bg-surface px-4 py-2.5">
        <span
          aria-hidden
          className="grid h-9 w-9 shrink-0 -rotate-6 place-items-center rounded-[12px] border-2 border-walnut bg-sun text-walnut shadow-[0_3px_0_#1f1a16]"
        >
          <IconBoard size={20} strokeWidth={2.25} />
        </span>
        <h2
          id="board-title"
          className="mr-1 font-display text-[21px] leading-7 font-bold text-walnut"
        >
          Table {tableNumber} whiteboard
        </h2>
        <div className="flex items-center" role="group" aria-label="Pen colour">
          {INK_COLORS.map((c) => {
            const on = tool === "pen" && color === c.color;
            return (
              <button
                key={c.id}
                type="button"
                title={c.label}
                aria-label={`${c.label} pen`}
                aria-pressed={on}
                onClick={() => setColor(c.color)}
                className={`group grid h-10 w-10 place-items-center rounded-full transition-colors duration-150 hover:bg-canvas ${FOCUS}`}
              >
                <span
                  aria-hidden
                  className={`h-6 w-6 rounded-full border-2 border-walnut transition-[box-shadow,transform] duration-150 motion-reduce:transition-none ${
                    on
                      ? "scale-110 ring-[3px] ring-walnut ring-offset-2 ring-offset-surface"
                      : "shadow-[0_2px_0_#1f1a16] group-hover:-translate-y-px"
                  }`}
                  style={{ background: c.color }}
                />
              </button>
            );
          })}
        </div>
        <div className={SEGMENTED} role="group" aria-label="Pen size">
          {PEN_SIZES.map((p) => (
            <ToolButton
              key={p.id}
              label={`${p.label} pen`}
              active={tool === "pen" && size === p.size}
              onClick={() => setSize(p.size)}
            >
              <span
                className="rounded-full bg-current"
                style={{ width: p.size + 2, height: p.size + 2 }}
              />
            </ToolButton>
          ))}
        </div>
        <div className={SEGMENTED} role="group" aria-label="Tools">
          {(
            [
              ["pen", "Pen"],
              ["eraser", "Eraser"],
              ["ask", "Ask AI"],
            ] as [Tool, string][]
          ).map(([t, label]) => (
            <ToolButton
              key={t}
              label={label}
              active={tool === t}
              onClick={() => setTool(t)}
              disabled={busy}
            >
              <LineIcon d={TOOL_ICONS[t]} />
              {label}
            </ToolButton>
          ))}
        </div>
        <ToolButton
          label={
            finger === "on" ? "Stop drawing with your finger" : "Draw with your finger (camera)"
          }
          active={finger === "on"}
          onClick={() => void toggleFinger()}
          disabled={busy}
        >
          <LineIcon d={FINGER_ICON} />
          {finger === "starting" ? "Starting…" : "Finger"}
        </ToolButton>
        <span className="h-7 w-[3px] rounded-full bg-walnut/15" aria-hidden />
        <div className="flex items-center gap-1.5">
          <ToolButton label="Undo (Ctrl/⌘ Z)" onClick={undo} disabled={!canUndo || busy}>
            <LineIcon d={UNDO_ICON} />
          </ToolButton>
          <ToolButton label="Redo (Shift Ctrl/⌘ Z)" onClick={redo} disabled={!canRedo || busy}>
            <LineIcon d={REDO_ICON} />
          </ToolButton>
          <ToolButton
            label="Clear board"
            onClick={() => commit([])}
            disabled={items.length === 0 || busy}
          >
            <IconTrash size={18} strokeWidth={2.25} />
            Clear
          </ToolButton>
        </div>
        <button type="button" onClick={closeBoard} className={`${BTN.secondary} ml-auto`}>
          Done <kbd className={KBD_SM}>Esc</kbd>
        </button>
      </header>

      <div
        ref={wrap}
        className="relative flex min-h-0 flex-1 items-center justify-center p-4 sm:p-6"
      >
        <div className="relative" style={{ width: cssSize.w, height: cssSize.h }}>
          <canvas
            ref={canvas}
            aria-label="Whiteboard. Draw with the mouse or a pen."
            role="img"
            // A ring, not a border, so the drawing surface keeps exactly the board's size.
            className={`h-full w-full touch-none rounded-[16px] bg-white shadow-[0_8px_0_#1f1a16] ring-[3px] ring-walnut ${
              tool === "ask"
                ? "cursor-crosshair"
                : tool === "eraser"
                  ? "cursor-none"
                  : "cursor-crosshair"
            }`}
            style={{ width: cssSize.w, height: cssSize.h }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setCursor(null)}
          />
          {finger === "on" && tip && (
            <span
              aria-hidden
              className={`pointer-events-none absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-walnut transition-[background-color,transform] duration-100 ${tip.drawing ? "scale-75" : "scale-100 bg-white/60"}`}
              style={{
                left: `${tip.x * 100}%`,
                top: `${tip.y * 100}%`,
                backgroundColor: tip.drawing ? color : undefined,
              }}
            />
          )}
          <div
            className={`absolute right-3 bottom-3 overflow-hidden rounded-[14px] border-[3px] border-walnut bg-walnut shadow-[0_4px_0_#1f1a16] ${finger === "on" ? "h-[90px] w-[120px]" : "hidden"}`}
          >
            <div ref={previewBox} className="h-full w-full" />
          </div>
          {(finger === "on" || finger === "error") && (
            <p
              role="status"
              className="absolute bottom-3 left-3 rounded-full border-2 border-walnut bg-surface px-3 py-1 font-display text-[13px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16]"
            >
              {finger === "error"
                ? "Couldn't start the camera. Allow it in the browser and try again."
                : tip
                  ? tip.drawing
                    ? "Drawing: open your hand to lift the pen"
                    : "Point with one finger to draw"
                  : "Show your hand to the camera"}
            </p>
          )}
          {selection && tool === "ask" && ai.status === "idle" && (
            <div
              className="absolute flex gap-1.5 rounded-[16px] border-[3px] border-walnut bg-surface p-1.5 shadow-[0_4px_0_#1f1a16]"
              style={{
                left: `${((selection.x + selection.w) / BOARD_W) * 100}%`,
                top: `${((selection.y + selection.h) / BOARD_H) * 100}%`,
                transform: "translate(-100%, 8px)",
              }}
            >
              <button type="button" onClick={() => setSelection(null)} className={BTN_SM.secondary}>
                Cancel
              </button>
              <button type="button" onClick={() => void askAi()} className={BTN_SM.primary}>
                <LineIcon d={TOOL_ICONS.ask} size={16} />
                Ask AI
              </button>
            </div>
          )}
          {busy && (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
              <span
                className={`${HUD_CHIP} flex items-center gap-2.5 py-1.5 pr-1.5 pl-3.5 text-[13.5px] font-semibold`}
              >
                <Spinner />
                {ai.status === "reading"
                  ? "Reading your question…"
                  : writingOut
                    ? "Writing the answer…"
                    : "Working out the answer…"}
                {writingOut ? (
                  <button
                    type="button"
                    onClick={finishWriting}
                    className={`pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-full border-2 border-black/80 bg-walnut-key px-2.5 text-xs font-semibold shadow-[0_2px_0_rgb(0_0_0/0.55)] transition-[background-color,transform,box-shadow] duration-150 hover:bg-[#4a423b] active:translate-y-[2px] active:shadow-none motion-reduce:transition-none ${FOCUS}`}
                  >
                    Skip <kbd className={`${KBD_SM} kbd-dark`}>Esc</kbd>
                  </button>
                ) : (
                  <span className="flex items-center gap-1.5 pr-1.5 text-xs font-medium text-walnut-muted">
                    <kbd className={`${KBD_SM} kbd-dark`}>Esc</kbd> to cancel
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      <footer
        className={`flex flex-wrap items-center justify-between gap-3 border-t-2 border-dashed ${DIVIDER} px-4 py-2.5`}
      >
        <p className="text-[13px] leading-5 font-medium text-ink-soft">{hint}</p>
        {saveFailed && (
          <p className="flex items-center gap-1.5 rounded-full border-2 border-danger bg-surface px-3 py-1 font-display text-xs font-semibold text-walnut shadow-[0_2px_0_#a9504a]">
            <IconWarning size={16} strokeWidth={2.25} className="text-danger" />
            Couldn&apos;t save: this browser&apos;s storage is full.
          </p>
        )}
      </footer>

      {(ai.status === "done" || ai.status === "error") && (
        <aside
          aria-live="polite"
          className={`${PANEL} title-pop absolute right-6 bottom-16 max-h-[45%] w-80 max-w-[calc(100%-3rem)] overflow-y-auto p-4 text-sm leading-6 text-walnut`}
        >
          <div className="flex items-start justify-between gap-3">
            {ai.status === "error" ? (
              <h3 className="flex items-center gap-2 font-display text-[19px] leading-7 font-bold">
                <IconWarning size={18} strokeWidth={2.25} className="text-danger" />
                Couldn&apos;t answer
              </h3>
            ) : (
              <p className="pt-1 text-[14px] leading-5 font-medium text-ink-soft">
                <span className="font-display font-semibold text-walnut">Read:</span>{" "}
                {ai.solution.question || "your selection"}
              </p>
            )}
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setAi({ status: "idle" })}
              className={`${ICON_BTN} -mt-1.5 -mr-2`}
            >
              <IconClose size={18} />
            </button>
          </div>
          {ai.status === "error" ? (
            <p className="mt-1 font-medium text-ink-soft">{ai.message}</p>
          ) : (
            <>
              <p className="mt-2.5 rounded-[14px] border-2 border-walnut bg-sun/35 px-3.5 py-2.5 text-[15px] font-semibold whitespace-pre-line">
                {ai.solution.answer || ai.solution.lines.join("\n")}
              </p>
              <div className="mt-2.5 flex justify-end">
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard?.writeText(
                      ai.solution.answer || ai.solution.lines.join("\n"),
                    )
                  }
                  className={`${BTN_SM.quiet} -mr-1`}
                >
                  <IconCopy size={16} />
                  Copy
                </button>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}

/** Full-screen whiteboard for the collaborative table the player opened. */
export function WhiteboardPanel() {
  const openId = useWhiteboardStore((s) => s.openId);
  if (!openId) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="board-title"
      className="absolute inset-0 z-30 bg-walnut/50 p-4 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none sm:p-6"
    >
      <Board key={openId} id={openId} />
    </div>
  );
}
