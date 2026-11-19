"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hashString } from "@ovr/shared";
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
      className={`flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-xl px-2.5 text-sm font-bold transition disabled:opacity-35 ${
        active ? "bg-ink text-cream" : "text-ink hover:bg-ink/8"
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
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = ai.status === "writing" ? "#c8743f" : "#6f8f6a";
      ctx.fillStyle = ai.status === "writing" ? "rgba(200,116,63,0.08)" : "rgba(111,143,106,0.08)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.strokeRect(box.x, box.y, box.w, box.h);
      ctx.restore();
    }
    if (tool === "eraser" && cursor) {
      ctx.beginPath();
      ctx.arc(cursor.x, cursor.y, ERASER_RADIUS, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(45,36,32,0.5)";
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

  const tableNumber = id.split("-").pop();
  const hint =
    tool === "pen"
      ? "Write or draw anything."
      : tool === "eraser"
        ? "Drag over anything to erase it."
        : "Drag a box around your question, then press Ask AI. This sends that part of the board to Google Gemini.";

  return (
    <div className="flex h-full flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2 rounded-2xl bg-cream px-3 py-2 shadow-md ring-1 ring-ink/10">
        <h2 id="board-title" className="mr-2 font-display text-lg font-semibold">
          Table {tableNumber} whiteboard
        </h2>
        <div className="flex items-center gap-1" role="group" aria-label="Pen colour">
          {INK_COLORS.map((c) => (
            <button
              key={c.id}
              type="button"
              title={c.label}
              aria-label={`${c.label} pen`}
              aria-pressed={tool === "pen" && color === c.color}
              onClick={() => setColor(c.color)}
              className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-cream transition ${
                tool === "pen" && color === c.color
                  ? "ring-ink"
                  : "ring-transparent hover:ring-ink/30"
              }`}
              style={{ background: c.color }}
            />
          ))}
        </div>
        <div className="flex items-center gap-0.5" role="group" aria-label="Pen size">
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
        <span className="mx-1 h-6 w-px bg-ink/15" aria-hidden />
        {(
          [
            ["pen", "Pen", "✏️"],
            ["eraser", "Eraser", "🧽"],
            ["ask", "Ask AI", "✨ Ask AI"],
          ] as [Tool, string, string][]
        ).map(([t, label, icon]) => (
          <ToolButton
            key={t}
            label={label}
            active={tool === t}
            onClick={() => setTool(t)}
            disabled={busy}
          >
            {icon}
          </ToolButton>
        ))}
        <span className="mx-1 h-6 w-px bg-ink/15" aria-hidden />
        <ToolButton label="Undo (Ctrl/⌘ Z)" onClick={undo} disabled={!canUndo || busy}>
          ↶
        </ToolButton>
        <ToolButton label="Redo (Shift Ctrl/⌘ Z)" onClick={redo} disabled={!canRedo || busy}>
          ↷
        </ToolButton>
        <ToolButton
          label="Clear board"
          onClick={() => commit([])}
          disabled={items.length === 0 || busy}
        >
          Clear
        </ToolButton>
        <button
          type="button"
          onClick={closeBoard}
          className="ml-auto flex h-9 items-center gap-2 rounded-xl bg-ink px-3 text-sm font-bold text-cream hover:bg-wood-dark"
        >
          Done{" "}
          <span className="kbd !h-5 !min-w-5 !border-cream/20 !bg-cream/15 !text-[0.65rem] !text-cream">
            Esc
          </span>
        </button>
      </header>

      <div ref={wrap} className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative" style={{ width: cssSize.w, height: cssSize.h }}>
          <canvas
            ref={canvas}
            aria-label="Whiteboard. Draw with the mouse or a pen."
            role="img"
            className={`h-full w-full touch-none rounded-2xl bg-white shadow-[0_20px_50px_-20px_rgb(20_12_6/0.6)] ring-8 ring-[#b8bcc0] ${
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
          {selection && tool === "ask" && ai.status === "idle" && (
            <div
              className="absolute flex gap-1.5"
              style={{
                left: `${((selection.x + selection.w) / BOARD_W) * 100}%`,
                top: `${((selection.y + selection.h) / BOARD_H) * 100}%`,
                transform: "translate(-100%, 8px)",
              }}
            >
              <button
                type="button"
                onClick={() => setSelection(null)}
                className="rounded-full bg-cream px-3 py-1.5 text-sm font-bold text-ink shadow ring-1 ring-ink/15"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void askAi()}
                className="rounded-full bg-sage-dark px-4 py-1.5 text-sm font-bold text-cream shadow"
              >
                ✨ Ask AI
              </button>
            </div>
          )}
          {busy && (
            <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
              <span className="flex items-center gap-3 rounded-full bg-ink/85 py-2 pr-2 pl-4 text-sm font-bold text-cream shadow-lg">
                {ai.status === "reading"
                  ? "Reading your question…"
                  : writingOut
                    ? "Writing the answer…"
                    : "Working out the answer…"}
                {writingOut ? (
                  <button
                    type="button"
                    onClick={finishWriting}
                    className="pointer-events-auto rounded-full bg-cream/15 px-3 py-1 text-xs hover:bg-cream/25"
                  >
                    Skip <span className="opacity-70">(Esc)</span>
                  </button>
                ) : (
                  <span className="pr-2 opacity-70">(Esc to cancel)</span>
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      <footer className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-cream/85">{hint}</p>
        {saveFailed && (
          <p className="rounded-full bg-red-50 px-3 py-1 text-xs font-bold text-red-800">
            Couldn&apos;t save: this browser&apos;s storage is full.
          </p>
        )}
      </footer>

      {(ai.status === "done" || ai.status === "error") && (
        <aside
          aria-live="polite"
          className="absolute right-6 bottom-14 max-h-[45%] max-w-xs overflow-y-auto rounded-2xl bg-cream/95 p-3.5 text-sm text-ink shadow-xl ring-1 ring-ink/10 backdrop-blur"
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-display text-base font-semibold">
              {ai.status === "done" ? "AI answer" : "Couldn't answer"}
            </h3>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => setAi({ status: "idle" })}
              className="-mt-1 -mr-1 rounded-full px-2 text-lg leading-none text-ink-soft hover:bg-ink/5"
            >
              ×
            </button>
          </div>
          {ai.status === "error" ? (
            <p className="mt-1 text-ink-soft">{ai.message}</p>
          ) : (
            <>
              {ai.solution.question && (
                <p className="mt-1 text-xs text-ink-soft">
                  <span className="font-bold">Read:</span> {ai.solution.question}
                </p>
              )}
              <p className="mt-2 whitespace-pre-line">
                {ai.solution.answer || ai.solution.lines.join("\n")}
              </p>
              {ai.note && <p className="mt-2 text-xs text-ember">{ai.note}</p>}
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-ink-soft">
                <span>AI can make mistakes. Check important answers.</span>
                <button
                  type="button"
                  onClick={() =>
                    void navigator.clipboard?.writeText(
                      ai.solution.answer || ai.solution.lines.join("\n"),
                    )
                  }
                  className="rounded-full px-2.5 py-1 font-bold text-ink hover:bg-ink/5"
                >
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
      className="absolute inset-0 z-30 bg-ink/70 p-4 backdrop-blur-[3px] sm:p-6"
    >
      <Board key={openId} id={openId} />
    </div>
  );
}
