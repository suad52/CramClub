"use client";

import { useEffect, useState } from "react";
import { IconChevronDown } from "@/components/ui/icons";
import { BTN_SM } from "@/components/ui/styles";
import {
  formatMinutes,
  formatMinutesTick,
  formatNumber,
  formatTick,
  niceMinutesScale,
  niceScale,
} from "./format";

/*
 * Small hand-drawn charts for the progress dashboard: plain SVG, no chart library, in the cartoon
 * look. Marks follow one spec: chunky columns (at most 24px wide, rounded tops) with a walnut
 * outline, sitting on one thick walnut baseline; faint dashed gridlines; ink-soft labels (the
 * mark carries the colour, never the label). Every chart shows one measure at a time in one flat
 * fill; the outline, not the fill, is what separates a mark from the cream card behind it.
 */

const WALNUT = "var(--color-walnut)";

export const SERIES = {
  xp: "var(--color-sun)",
  focus: "var(--color-leaf)",
  lessons: "var(--color-tangerine)",
  learners: "var(--color-sun)",
} as const;

/** The one highlight colour, used for a single point at a time. */
const HIGHLIGHT = "var(--color-tangerine)";

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
  const r = Math.min(6, w / 2, h);
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

const M = { top: 22, right: 6, bottom: 28, left: 40 };

/**
 * Columns over time (or hour of day) with a hover tooltip, a title per column, a direct label on
 * the tallest column, and the numbers behind a "Show the numbers" disclosure. Hidden (null) slots
 * get a short grey dash.
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
  // Thin columns (30 days on a phone) get a thinner outline, so some fill still shows.
  const outline = barW >= 10 ? 2.5 : barW >= 5 ? 1.5 : 1;
  const y = (v: number) => M.top + plotH - (v / top) * plotH;
  const cx = (i: number) => M.left + band * i + band / 2;
  const tickLabel = (n: number) => (minutes ? formatMinutesTick(n) : formatTick(n, top));
  const hovered = hover === null ? undefined : bars[hover];
  // The tallest column (the first, on a tie) carries its own value, so the peak reads at a glance.
  const peak = max > 0 ? values.indexOf(max) : -1;

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
                {/* The zero line is the thick baseline, drawn after the columns. */}
                {t !== 0 && (
                  <line
                    x1={M.left}
                    x2={width - M.right}
                    y1={y(t)}
                    y2={y(t)}
                    stroke={WALNUT}
                    strokeOpacity={0.14}
                    strokeWidth={1.5}
                    strokeDasharray="4 5"
                    strokeLinecap="round"
                  />
                )}
                <text
                  x={M.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  fontSize={12}
                  fontWeight={600}
                  fill="var(--color-ink-soft)"
                  className="tabular font-display"
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
                      y={y(0) - 6}
                      width={barW}
                      height={3}
                      rx={1.5}
                      fill={WALNUT}
                      fillOpacity={0.45}
                    />
                  ) : v > 0 ? (
                    <path
                      d={columnPath(x, y(v), barW, y(0) - y(v))}
                      fill={color}
                      stroke={WALNUT}
                      strokeWidth={outline}
                      strokeLinejoin="round"
                      opacity={dim ? 0.35 : 1}
                      className="transition-opacity duration-150 motion-reduce:transition-none"
                    />
                  ) : null}
                  {i === peak && v !== null && hover === null && (
                    <text
                      x={tx}
                      y={y(v) - 7}
                      textAnchor={anchor}
                      fontSize={13}
                      fontWeight={700}
                      fill={WALNUT}
                      className="tabular font-display"
                      pointerEvents="none"
                      aria-hidden
                    >
                      {formatValue(v)}
                    </text>
                  )}
                  {b.tick && (
                    <text
                      x={tx}
                      y={height - 7}
                      textAnchor={anchor}
                      fontSize={12}
                      fontWeight={600}
                      fill="var(--color-ink-soft)"
                      className="font-display"
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
            {/* The thick baseline every column stands on, drawn over their feet. */}
            <line
              x1={M.left}
              x2={width - M.right}
              y1={y(0)}
              y2={y(0)}
              stroke={WALNUT}
              strokeWidth={3}
              strokeLinecap="round"
              pointerEvents="none"
            />
          </svg>
        )}
        {emptyNote && max === 0 && (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center">
            <span className="inline-block -rotate-2 rounded-full border-2 border-walnut bg-surface px-3 py-1 font-display text-sm font-semibold text-walnut shadow-[0_3px_0_#1f1a16]">
              {emptyNote}
            </span>
          </p>
        )}
        {hovered && hover !== null && (
          <div
            aria-hidden
            className="pointer-events-none absolute z-10 w-max max-w-52 -translate-x-1/2 -translate-y-full rounded-[12px] border-2 border-black/80 bg-walnut px-3 py-2 font-display text-xs leading-5 text-walnut-text shadow-[0_3px_0_rgb(0_0_0/0.45)]"
            style={{
              // Centred over the column, but kept inside the chart (half of max-w-52 is 104px).
              left: Math.min(
                Math.max(cx(hover), Math.min(104, width / 2)),
                Math.max(width / 2, width - 104),
              ),
              top: y(hovered.value ?? 0) - 8,
            }}
          >
            <p className="font-semibold">{hovered.label}</p>
            <p className="tabular font-medium text-walnut-muted">{hovered.detail}</p>
          </div>
        )}
      </div>
      <details className="group mt-3 text-[13px]">
        <summary
          className={`${BTN_SM.quiet} -ml-2.5 cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
        >
          Show the numbers
          <IconChevronDown
            size={16}
            strokeWidth={2.5}
            className="transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="mt-2 max-h-56 overflow-y-auto rounded-[16px] border-2 border-walnut bg-surface">
          <table className="w-full text-left">
            <thead className="sticky top-0 bg-sun font-display text-walnut shadow-[0_2px_0_#1f1a16]">
              <tr>
                <th scope="col" className="px-3 py-2 font-semibold">
                  When
                </th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">
                  {unit}
                </th>
                <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">
                  Details
                </th>
              </tr>
            </thead>
            <tbody className="tabular font-medium text-walnut">
              {bars.map((b, i) => (
                <tr key={b.key} className={i > 0 ? "border-t-2 border-walnut/10" : ""}>
                  <th scope="row" className="px-3 py-1.5 font-display font-semibold">
                    {b.label}
                  </th>
                  <td className="px-3 py-1.5 text-right font-display font-semibold">
                    {b.value === null ? "Hidden" : formatValue(b.value)}
                  </td>
                  <td className="hidden px-3 py-1.5 text-ink-soft sm:table-cell">{b.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A tiny outlined trend line (oldest first) with a tangerine dot on the latest value. */
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
  const pad = 5;
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
          <line
            x1={pad}
            x2={width - pad}
            y1={height - pad}
            y2={height - pad}
            stroke={WALNUT}
            strokeOpacity={0.18}
            strokeWidth={2}
            strokeLinecap="round"
          />
          {/* A walnut line under a thinner coloured one: an outlined, cartoon stroke. */}
          <polyline
            points={line}
            fill="none"
            stroke={WALNUT}
            strokeWidth={5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <polyline
            points={line}
            fill="none"
            stroke={color}
            strokeWidth={2.25}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </>
      )}
      {last && (
        <circle cx={last[0]} cy={last[1]} r={4} fill={HIGHLIGHT} stroke={WALNUT} strokeWidth={2} />
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
    <ul className="space-y-4">
      {items.map((item) => {
        const share = item.value / max;
        return (
          <li key={item.key}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="min-w-0 truncate font-display text-[15px] font-semibold text-walnut">
                {item.label}
              </span>
              <span className="tabular shrink-0 text-[13px] font-medium text-ink-soft">
                {item.detail}
              </span>
            </div>
            <ChunkyBar share={share} color={color} className="mt-1.5" />
          </li>
        );
      })}
    </ul>
  );
}

/**
 * A chunky rounded track with a walnut outline and a flat fill (0 to 1). Decorative: the words
 * beside it, or the progressbar around it, say the number.
 */
export function ChunkyBar({
  share,
  color,
  className = "",
}: {
  share: number;
  color: string;
  className?: string;
}) {
  const pct = Math.min(1, Math.max(0, share)) * 100;
  return (
    <div
      aria-hidden
      className={`h-4 overflow-hidden rounded-full border-2 border-walnut bg-canvas ${className}`}
    >
      <div
        className={`h-full rounded-full ${pct > 0 && pct < 100 ? "border-r-2 border-walnut" : ""}`}
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}
