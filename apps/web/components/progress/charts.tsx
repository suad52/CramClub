"use client";

import { useEffect, useState } from "react";
import {
  formatMinutes,
  formatMinutesTick,
  formatNumber,
  formatTick,
  niceMinutesScale,
  niceScale,
} from "./format";

/*
 * Small hand-drawn charts for the progress dashboard: plain SVG, no chart library. Marks follow
 * one spec: columns at most 24px wide with a 4px rounded top on a single baseline, hairline
 * gridlines, ink-coloured text (the mark carries the colour, never the label).
 */

export const SERIES = {
  xp: "var(--color-wood)",
  focus: "var(--color-sage)",
  lessons: "var(--color-ember)",
  learners: "var(--color-wood-dark)",
} as const;

/** Width of an element as it lays out (0 until measured). */
function useWidth<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}

/** A column with a rounded top and a square foot on the baseline. */
function columnPath(x: number, y: number, w: number, h: number) {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export interface Bar {
  key: string;
  /** Full name of the slot, for the tooltip and the table ("Thu, Nov 20", "3 pm"). */
  label: string;
  /** Axis label under the slot, or "" for none. */
  tick: string;
  /** null: hidden (too few learners to show). */
  value: number | null;
  /** The tooltip's second line. */
  detail: string;
}

const M = { top: 10, right: 6, bottom: 24, left: 38 };

/**
 * Columns over time (or hour of day) with a hover tooltip, a title per column, and the numbers
 * behind a "Show the numbers" disclosure. Hidden (null) slots get a short grey dash.
 */
export function BarChart({
  bars,
  color,
  summary,
  unit,
  scale = "count",
  height = 180,
  emptyNote,
}: {
  bars: Bar[];
  color: string;
  /** What the chart shows, for screen readers ("XP per day, last 30 days: …"). */
  summary: string;
  /** Column heading for the table ("XP"). */
  unit: string;
  /** Plain counts, or minutes (axis in 15m / 1h steps, values as "3h 42m"). */
  scale?: "count" | "minutes";
  height?: number;
  /** Shown over the plot when every value is zero. */
  emptyNote?: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const values = bars.map((b) => b.value ?? 0);
  const max = Math.max(0, ...values);
  const minutes = scale === "minutes";
  const { top, ticks } = minutes ? niceMinutesScale(max) : niceScale(max);
  const formatValue = minutes ? formatMinutes : formatNumber;
  const plotW = Math.max(0, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;
  const band = bars.length ? plotW / bars.length : 0;
  const barW = Math.max(2, Math.min(24, band * 0.7));
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const cx = (i: number) => M.left + band * i + band / 2;
  const tickLabel = (n: number) => (minutes ? formatMinutesTick(n) : formatTick(n, top));
  const hovered = hover === null ? undefined : bars[hover];

  return (
    <figure className="m-0">
      <div ref={ref} className="relative" style={{ height }}>
        {width > 0 && (
          <svg
            width={width}
            height={height}
            role="img"
            aria-label={summary}
            className="block overflow-visible"
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={M.left}
                  x2={width - M.right}
                  y1={y(t)}
                  y2={y(t)}
                  stroke="var(--color-ink)"
                  strokeOpacity={t === 0 ? 0.22 : 0.08}
                  shapeRendering="crispEdges"
                />
                <text
                  x={M.left - 6}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={11}
                  fill="var(--color-ink-soft)"
                  className="tabular-nums"
                >
                  {tickLabel(t)}
                </text>
              </g>
            ))}
            {bars.map((b, i) => {
              const x = cx(i) - barW / 2;
              const anchor = cx(i) < M.left + 16 ? "start" : cx(i) > width - 22 ? "end" : "middle";
              const tx = anchor === "start" ? x : anchor === "end" ? x + barW : cx(i);
              const v = b.value;
              const dim = hover !== null && hover !== i;
              return (
                <g key={b.key}>
                  <title>{`${b.label}: ${b.detail}`}</title>
                  {v === null ? (
                    <rect
                      x={x}
                      y={y(0) - 3}
                      width={barW}
                      height={2}
                      rx={1}
                      fill="var(--color-ink)"
                      fillOpacity={0.25}
                    />
                  ) : v > 0 ? (
                    <path
                      d={columnPath(x, y(v), barW, y(0) - y(v))}
                      fill={color}
                      opacity={dim ? 0.45 : 1}
                    />
                  ) : null}
                  {b.tick && (
                    <text
                      x={tx}
                      y={height - 6}
                      textAnchor={anchor}
                      fontSize={11}
                      fill="var(--color-ink-soft)"
                    >
                      {b.tick}
                    </text>
                  )}
                  {/* Hit target: the whole slot, taller and wider than the column. */}
                  <rect
                    x={M.left + band * i}
                    y={M.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    onPointerEnter={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>
        )}
        {emptyNote && max === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm font-bold text-ink-soft">
            {emptyNote}
          </p>
        )}
        {hovered && hover !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 w-max max-w-52 -translate-x-1/2 -translate-y-full rounded-xl bg-ink px-3 py-2 text-xs text-cream shadow-lg"
            style={{
              // Centred over the column, but kept inside the chart (half of max-w-52 is 104px).
              left: Math.min(
                Math.max(cx(hover), Math.min(104, width / 2)),
                Math.max(width / 2, width - 104),
              ),
              top: y(hovered.value ?? 0) - 8,
            }}
          >
            <p className="font-extrabold">{hovered.label}</p>
            <p className="text-cream/85">{hovered.detail}</p>
          </div>
        )}
      </div>
      <details className="mt-2 text-xs">
        <summary className="w-max cursor-pointer rounded font-bold text-ink-soft hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember">
          Show the numbers
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl ring-1 ring-ink/10">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-cream text-ink-soft">
              <tr>
                <th scope="col" className="px-3 py-1.5 font-extrabold">
                  When
                </th>
                <th scope="col" className="px-3 py-1.5 text-right font-extrabold">
                  {unit}
                </th>
                <th scope="col" className="hidden px-3 py-1.5 font-extrabold sm:table-cell">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {bars.map((b) => (
                <tr key={b.key} className="border-t border-ink/5">
                  <th scope="row" className="px-3 py-1 font-bold">
                    {b.label}
                  </th>
                  <td className="px-3 py-1 text-right">
                    {b.value === null ? "Hidden" : formatValue(b.value)}
                  </td>
                  <td className="hidden px-3 py-1 text-ink-soft sm:table-cell">{b.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A tiny trend line (oldest first) with a dot on the latest value. */
export function Sparkline({
  values,
  label,
  color = SERIES.lessons,
  width = 88,
  height = 28,
}: {
  values: readonly number[];
  label: string;
  color?: string;
  width?: number;
  height?: number;
}) {
  const pad = 4;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const pts = values.map(
    (v, i) => [pad + step * i, height - pad - (v / max) * (height - pad * 2)] as const,
  );
  const line = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="shrink-0">
      {pts.length > 1 && (
        <>
          <polygon
            points={`${pad},${height - pad} ${line} ${width - pad},${height - pad}`}
            fill={color}
            fillOpacity={0.12}
          />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
      {last && (
        <circle
          cx={last[0]}
          cy={last[1]}
          r={3.5}
          fill={color}
          stroke="var(--color-cream)"
          strokeWidth={2}
        />
      )}
    </svg>
  );
}

/** Horizontal bars for a ranked list (plain HTML: the labels need room to wrap). */
export function BarList({
  items,
  color,
}: {
  items: { key: string; label: string; value: number; detail: string }[];
  color: string;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-bold">{item.label}</span>
            <span className="shrink-0 text-xs text-ink-soft tabular-nums">{item.detail}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-ink/[0.06]" aria-hidden>
            <div
              className="h-2 rounded-full"
              style={{ width: `${(item.value / max) * 100}%`, background: color }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
