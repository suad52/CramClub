"use client";

import type { ReactNode } from "react";
import { IconArrowRight, IconRefresh } from "@/components/ui/icons";
import { BODY, BODY_L, TITLE } from "@/components/ui/styles";
import type { Visual } from "@/lib/learning-studio/schema";

/**
 * Renders a validated lesson visual. Each (type, templateId) maps to a component in REGISTRY;
 * `progress` (0–1, the narration's playhead) reveals steps and labels in time with the voice.
 * Anything unknown falls back to a plain summary card instead of breaking the lesson.
 *
 * Drawn in the library's cartoon style: chunky walnut outlines, hard sticker shadows, flat bright
 * fills (sun, leaf, tangerine) with walnut text, and a sun-yellow card for the step the teacher is
 * talking about right now.
 */

interface VisualProps {
  visual: Visual;
  /** How many of the visual's items are revealed so far. */
  shown: number;
}

const ITEM = "transition-all duration-500 motion-reduce:transition-none";
const reveal = (i: number, shown: number) =>
  i < shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 motion-reduce:translate-y-0";

/** A card on the slide; `current` marks the step being narrated (sun yellow, a deeper shadow). */
const card = (current = false) =>
  `rounded-[16px] border-[3px] border-walnut text-walnut ${current ? "bg-sun shadow-[0_6px_0_#1f1a16]" : "bg-surface shadow-[0_4px_0_#1f1a16]"}`;

/** Flat bright fills for items that are all equal (walnut text keeps AA contrast on each). */
const FILLS = ["bg-sun", "bg-leaf", "bg-tangerine"] as const;
const fill = (i: number) => FILLS[i % FILLS.length]!;
/** An equal item on the slide, in its own bright colour. */
const tile = (i: number) =>
  `rounded-[16px] border-[3px] border-walnut text-walnut shadow-[0_4px_0_#1f1a16] ${fill(i)}`;

/** A picture that couldn't be drawn (24px grid, 1.75 stroke, like the shared icon set). */
function ImageGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={32}
      height={32}
      fill="none"
      stroke="currentColor"
      strokeWidth={2.25}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      className="mx-auto shrink-0"
    >
      <rect x="3.75" y="5.25" width="16.5" height="13.5" rx="1.75" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4.25 17.25 9.5 13l3.5 3 2.75-2.25 4 3.5" />
    </svg>
  );
}

function Title({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="mb-7 flex flex-col items-center gap-2.5">
      <h3 className={`${TITLE} text-center`}>{children}</h3>
      {/* The title screen's little dot row under the heading. */}
      <span aria-hidden className="flex items-center gap-1.5">
        <span className="h-2.5 w-14 rounded-full border-2 border-walnut bg-tangerine" />
        <span className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-sun" />
        <span className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-leaf" />
      </span>
    </div>
  );
}

function ConceptHub({ visual, shown }: VisualProps) {
  const labels = visual.labels ?? [];
  const n = labels.length;
  return (
    <div className="relative mx-auto aspect-[4/3] w-full max-w-xl">
      <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" aria-hidden>
        {labels.map((_, i) => {
          const a = (i / n) * Math.PI * 2 - Math.PI / 2;
          return (
            <line
              key={i}
              x1={200}
              y1={150}
              x2={200 + Math.cos(a) * 140}
              y2={150 + Math.sin(a) * 105}
              strokeWidth={3}
              strokeLinecap="round"
              strokeDasharray="1 8"
              className={`${ITEM} stroke-walnut`}
              opacity={i < shown ? 1 : 0}
            />
          );
        })}
      </svg>
      <div className="absolute top-1/2 left-1/2 grid size-32 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-walnut bg-sun p-3 text-center font-display text-base leading-snug font-bold text-walnut shadow-[0_5px_0_#1f1a16]">
        {visual.title}
      </div>
      {labels.map((label, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return (
          <div
            key={label}
            className={`${ITEM} ${reveal(i, shown)} ${tile(i + 1)} absolute w-36 -translate-x-1/2 -translate-y-1/2 px-3 py-2 text-center font-display text-sm leading-5 font-semibold`}
            style={{ left: `${50 + Math.cos(a) * 35}%`, top: `${50 + Math.sin(a) * 35}%` }}
          >
            {label}
          </div>
        );
      })}
    </div>
  );
}

function ConceptGrid({ visual, shown }: VisualProps) {
  return (
    <div className="mx-auto grid max-w-2xl grid-cols-2 gap-3 sm:grid-cols-3">
      {(visual.labels ?? []).map((label, i) => (
        <div
          key={label}
          className={`${ITEM} ${reveal(i, shown)} ${tile(i)} p-4 text-center font-display text-[16px] leading-6 font-semibold`}
        >
          {label}
        </div>
      ))}
    </div>
  );
}

function ProcessFlow({ visual, shown }: VisualProps) {
  const steps = visual.steps ?? [];
  return (
    <ol className="mx-auto flex max-w-3xl flex-col items-stretch gap-2 sm:flex-row sm:items-center">
      {steps.map((s, i) => (
        <li
          key={s.label}
          className={`${ITEM} ${reveal(i, shown)} flex flex-1 flex-col items-center gap-2 sm:flex-row`}
        >
          <div className={`${card(i === shown - 1)} w-full flex-1 p-3 text-center`}>
            <div className="font-display text-[16px] leading-6 font-semibold">{s.label}</div>
            {s.description && (
              <div
                className={`mt-1 text-[13px] leading-5 font-medium ${i === shown - 1 ? "text-walnut" : "text-ink-soft"}`}
              >
                {s.description}
              </div>
            )}
          </div>
          {i < steps.length - 1 && (
            <IconArrowRight
              size={20}
              strokeWidth={2.75}
              className="rotate-90 text-walnut sm:rotate-0"
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function ProcessCycle({ visual, shown }: VisualProps) {
  const steps = visual.steps ?? [];
  const n = steps.length;
  return (
    <div className="relative mx-auto aspect-square w-full max-w-md">
      <svg viewBox="0 0 300 300" className="absolute inset-0 h-full w-full" aria-hidden>
        <defs>
          <marker
            id="cycle-arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="4"
            markerHeight="4"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" className="fill-walnut" />
          </marker>
        </defs>
        {steps.map((_, i) => {
          const a0 = (i / n) * Math.PI * 2 - Math.PI / 2 + 0.35;
          const a1 = ((i + 1) / n) * Math.PI * 2 - Math.PI / 2 - 0.35;
          const p = (a: number) => `${150 + Math.cos(a) * 105},${150 + Math.sin(a) * 105}`;
          return (
            <path
              key={i}
              d={`M${p(a0)} A105,105 0 0,1 ${p(a1)}`}
              fill="none"
              strokeWidth={3}
              strokeLinecap="round"
              markerEnd="url(#cycle-arrow)"
              className={`${ITEM} stroke-walnut`}
              opacity={i < shown ? 0.8 : 0.15}
            />
          );
        })}
      </svg>
      <div className="absolute top-1/2 left-1/2 grid size-14 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[3px] border-walnut bg-leaf text-walnut shadow-[0_4px_0_#1f1a16]">
        <IconRefresh size={26} strokeWidth={2.5} />
      </div>
      {steps.map((s, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return (
          <div
            key={s.label}
            className={`${ITEM} ${reveal(i, shown)} ${card(i === shown - 1)} absolute w-32 -translate-x-1/2 -translate-y-1/2 p-2 text-center font-display text-sm leading-5 font-semibold`}
            style={{ left: `${50 + Math.cos(a) * 35}%`, top: `${50 + Math.sin(a) * 35}%` }}
          >
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

function ProcessTimeline({ visual, shown }: VisualProps) {
  return (
    <ol className="relative mx-auto max-w-xl border-l-[3px] border-walnut pl-6">
      {(visual.steps ?? []).map((s, i) => (
        <li key={s.label} className={`${ITEM} ${reveal(i, shown)} relative mb-6 last:mb-0`}>
          <span
            aria-hidden
            className={`absolute top-1 -left-[34px] size-4 rounded-full border-[3px] border-walnut ring-4 ring-surface ${fill(i)}`}
          />
          <div className="font-display text-[16px] leading-6 font-semibold text-walnut">
            {s.label}
          </div>
          {s.description && <div className={BODY}>{s.description}</div>}
        </li>
      ))}
    </ol>
  );
}

function Comparison({ visual, shown }: VisualProps) {
  const [left, right] = visual.columns ?? ["", ""];
  return (
    <div className="mx-auto w-full max-w-xl overflow-hidden rounded-[20px] border-[3px] border-walnut bg-surface shadow-[0_5px_0_#1f1a16]">
      <table className="w-full text-left text-[15px] leading-6">
        <thead className="font-display text-walnut">
          <tr>
            <th className="w-1/2 border-b-[3px] border-walnut bg-sun px-4 py-2.5 text-[15px] font-bold">
              {left}
            </th>
            <th className="w-1/2 border-b-[3px] border-l-[3px] border-walnut bg-leaf px-4 py-2.5 text-[15px] font-bold">
              {right}
            </th>
          </tr>
        </thead>
        <tbody>
          {(visual.labels ?? []).map((row, i) => {
            const [a, b = ""] = row.split("|").map((x) => x.trim());
            return (
              <tr
                key={row}
                className={`${ITEM} ${reveal(i, shown)} border-t-2 border-dashed border-walnut/15 first:border-t-0`}
              >
                <td className="px-4 py-2.5 align-top font-display font-semibold text-walnut">
                  {a}
                </td>
                <td className="border-l-[3px] border-walnut/15 px-4 py-2.5 align-top font-medium text-ink-soft">
                  {b}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LabeledDiagram({ visual, shown }: VisualProps) {
  const labels = visual.labels ?? [];
  return (
    <div className="mx-auto max-w-2xl">
      <svg viewBox="0 0 400 120" className="w-full" aria-hidden>
        <rect
          x="10"
          y="40"
          width="380"
          height="40"
          rx="20"
          strokeWidth="3"
          className="fill-canvas stroke-walnut"
        />
        {labels.map((_, i) => {
          const x = 30 + (i + 0.5) * (340 / labels.length);
          const current = i === shown - 1;
          return (
            <g key={i} className={ITEM} opacity={i < shown ? 1 : 0.15}>
              {/* A sticker shadow under each numbered dot. */}
              <circle cx={x} cy={63} r={14} className="fill-walnut" />
              <circle
                cx={x}
                cy={60}
                r={14}
                strokeWidth={3}
                className={`stroke-walnut ${current ? "fill-sun" : "fill-surface"}`}
              />
              <text
                x={x}
                y={65}
                textAnchor="middle"
                fontSize="13"
                fontWeight="700"
                className="tabular fill-walnut font-display"
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <ol className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
        {labels.map((label, i) => (
          <li
            key={label}
            className={`${ITEM} ${reveal(i, shown)} flex items-start gap-2.5 text-[15px] leading-6 font-semibold text-walnut`}
          >
            <span
              className={`tabular -mt-px grid size-7 shrink-0 place-items-center rounded-full border-2 border-walnut font-display text-xs font-bold text-walnut ${i === shown - 1 ? "bg-sun shadow-[0_2px_0_#1f1a16]" : "bg-surface"}`}
            >
              {i + 1}
            </span>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Equation({ visual }: VisualProps) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <div className="rounded-[20px] border-[3px] border-walnut bg-surface px-6 py-8 font-display text-2xl font-semibold text-walnut shadow-[0_5px_0_#1f1a16] sm:text-3xl">
        {visual.expression}
      </div>
      {visual.explanation && <p className={`mt-4 ${BODY_L}`}>{visual.explanation}</p>}
    </div>
  );
}

function Description({ visual }: VisualProps) {
  return (
    <figure className="mx-auto max-w-xl rounded-[20px] border-[3px] border-walnut bg-surface p-6 text-center shadow-[0_5px_0_#1f1a16]">
      <div className="mx-auto mb-4 grid size-14 -rotate-6 place-items-center rounded-[16px] border-[3px] border-walnut bg-sun text-walnut shadow-[0_4px_0_#1f1a16]">
        <ImageGlyph />
      </div>
      <figcaption className={BODY}>{visual.altText}</figcaption>
    </figure>
  );
}

const REGISTRY: Record<string, (p: VisualProps) => ReactNode> = {
  "concept/hub": ConceptHub,
  "concept/grid": ConceptGrid,
  "process/flow": ProcessFlow,
  "process/cycle": ProcessCycle,
  "process/timeline": ProcessTimeline,
  "comparison/two-column": Comparison,
  "diagram/labeled": LabeledDiagram,
  "equation/equation": Equation,
  "image/description": Description,
};

/** How many items a visual reveals over its scene. */
export function itemCount(visual: Visual): number {
  return Math.max(1, visual.steps?.length ?? visual.labels?.length ?? 1);
}

export function VisualRenderer({ visual, progress }: { visual: Visual; progress: number }) {
  const Render = REGISTRY[`${visual.type}/${visual.templateId}`];
  const n = itemCount(visual);
  // Reveal everything by 85% of the narration, one item at a time.
  const shown = Math.min(n, Math.floor((progress / 0.85) * n) + 1);
  if (!Render) {
    if (process.env.NODE_ENV !== "production")
      console.warn("[learning-studio] no visual for", visual.type, visual.templateId);
    return (
      <div
        className={`mx-auto max-w-xl rounded-[20px] border-[3px] border-walnut bg-surface p-6 text-center shadow-[0_5px_0_#1f1a16] ${BODY}`}
      >
        {visual.title ?? "This scene has no picture yet: follow along with the narration."}
      </div>
    );
  }
  return (
    <div>
      <Title>
        {visual.type === "concept" && visual.templateId === "hub" ? null : visual.title}
      </Title>
      {Render({ visual, shown })}
    </div>
  );
}
