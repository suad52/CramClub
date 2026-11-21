"use client";

import type { ReactNode } from "react";
import type { Visual } from "@/lib/learning-studio/schema";

/**
 * Renders a validated lesson visual. Each (type, templateId) maps to a component in REGISTRY;
 * `progress` (0–1, the narration's playhead) reveals steps and labels in time with the voice.
 * Anything unknown falls back to a plain summary card instead of breaking the lesson.
 */

interface VisualProps {
  visual: Visual;
  /** How many of the visual's items are revealed so far. */
  shown: number;
}

const ITEM = "transition-all duration-500 motion-reduce:transition-none";
const reveal = (i: number, shown: number) =>
  i < shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 motion-reduce:translate-y-0";

function Title({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <h3 className="mb-4 text-center font-display text-xl font-semibold text-ink sm:text-2xl">
      {children}
    </h3>
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
              stroke="#9a6a43"
              strokeWidth={2}
              strokeDasharray="5 5"
              className={ITEM}
              opacity={i < shown ? 0.6 : 0}
            />
          );
        })}
      </svg>
      <div className="absolute top-1/2 left-1/2 grid size-32 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-wood p-3 text-center font-display text-base font-semibold text-cream shadow-lg">
        {visual.title}
      </div>
      {labels.map((label, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return (
          <div
            key={label}
            className={`${ITEM} ${reveal(i, shown)} absolute w-36 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-cream px-3 py-2 text-center text-sm font-bold text-ink shadow ring-1 ring-ink/10`}
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
          className={`${ITEM} ${reveal(i, shown)} rounded-xl bg-cream p-4 text-center font-bold text-ink shadow ring-1 ring-ink/10`}
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
        <li key={s.label} className={`${ITEM} ${reveal(i, shown)} flex flex-1 items-center gap-2`}>
          <div
            className={`flex-1 rounded-xl p-3 text-center shadow ring-1 ${i === shown - 1 ? "bg-lamp ring-ember/50" : "bg-cream ring-ink/10"}`}
          >
            <div className="font-bold text-ink">{s.label}</div>
            {s.description && <div className="mt-1 text-xs text-ink-soft">{s.description}</div>}
          </div>
          {i < steps.length - 1 && (
            <span aria-hidden className="text-xl text-wood sm:rotate-0">
              →
            </span>
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
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="#9a6a43" />
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
              stroke="#9a6a43"
              strokeWidth={3}
              markerEnd="url(#cycle-arrow)"
              className={ITEM}
              opacity={i < shown ? 0.8 : 0.15}
            />
          );
        })}
      </svg>
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center font-display text-lg font-semibold text-ink-soft">
        ↻
      </div>
      {steps.map((s, i) => {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        return (
          <div
            key={s.label}
            className={`${ITEM} ${reveal(i, shown)} absolute w-32 -translate-x-1/2 -translate-y-1/2 rounded-xl p-2 text-center text-sm font-bold shadow ring-1 ${i === shown - 1 ? "bg-lamp ring-ember/50" : "bg-cream ring-ink/10"}`}
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
    <ol className="relative mx-auto max-w-xl border-l-4 border-wood/40 pl-6">
      {(visual.steps ?? []).map((s, i) => (
        <li key={s.label} className={`${ITEM} ${reveal(i, shown)} relative mb-5 last:mb-0`}>
          <span className="absolute top-1 -left-[34px] size-4 rounded-full border-4 border-cream bg-wood shadow" />
          <div className="font-bold text-ink">{s.label}</div>
          {s.description && <div className="text-sm text-ink-soft">{s.description}</div>}
        </li>
      ))}
    </ol>
  );
}

function Comparison({ visual, shown }: VisualProps) {
  const [left, right] = visual.columns ?? ["", ""];
  return (
    <table className="mx-auto w-full max-w-xl overflow-hidden rounded-xl bg-cream text-left shadow ring-1 ring-ink/10">
      <thead className="bg-wood text-cream">
        <tr>
          <th className="px-4 py-2">{left}</th>
          <th className="px-4 py-2">{right}</th>
        </tr>
      </thead>
      <tbody>
        {(visual.labels ?? []).map((row, i) => {
          const [a, b = ""] = row.split("|").map((x) => x.trim());
          return (
            <tr key={row} className={`${ITEM} ${reveal(i, shown)} border-t border-ink/10`}>
              <td className="px-4 py-2 font-bold text-ink">{a}</td>
              <td className="px-4 py-2 text-ink-soft">{b}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
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
          fill="#e9dcc4"
          stroke="#9a6a43"
          strokeWidth="2"
        />
        {labels.map((_, i) => {
          const x = 30 + (i + 0.5) * (340 / labels.length);
          return (
            <g key={i} className={ITEM} opacity={i < shown ? 1 : 0.15}>
              <circle cx={x} cy={60} r={14} fill={i === shown - 1 ? "#ffd99a" : "#9a6a43"} />
              <text
                x={x}
                y={65}
                textAnchor="middle"
                fontSize="13"
                fontWeight="700"
                fill={i === shown - 1 ? "#2d2420" : "#fbf7ef"}
              >
                {i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        {labels.map((label, i) => (
          <li
            key={label}
            className={`${ITEM} ${reveal(i, shown)} flex items-start gap-2 text-sm text-ink`}
          >
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-wood text-xs font-bold text-cream">
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
      <div className="rounded-2xl bg-cream px-6 py-8 font-display text-2xl text-ink shadow ring-1 ring-ink/10 sm:text-3xl">
        {visual.expression}
      </div>
      {visual.explanation && <p className="mt-4 text-ink-soft">{visual.explanation}</p>}
    </div>
  );
}

function Description({ visual }: VisualProps) {
  return (
    <figure className="mx-auto max-w-xl rounded-2xl bg-cream p-6 text-center shadow ring-1 ring-ink/10">
      <div aria-hidden className="mb-3 text-4xl">
        🖼️
      </div>
      <figcaption className="text-ink-soft">{visual.altText}</figcaption>
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
      <div className="mx-auto max-w-xl rounded-2xl bg-cream p-6 text-center text-ink-soft shadow">
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
