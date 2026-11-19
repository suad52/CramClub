"use client";

import {
  type AvatarPreset,
  type CatalogOption,
  type ColorOption,
  CLOTH_COLORS,
  HAIR_COLORS,
  SKIN_TONES,
  colorOf,
} from "@ovr/shared";
import type { IconId } from "./categories";

/** Small hand-drawn style line icons for the category rail (original artwork). */
export function Icon({ id, className = "h-5 w-5" }: { id: IconId; className?: string }) {
  const p = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  const paths: Record<IconId, React.ReactNode> = {
    spark: (
      <>
        <path {...p} d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
        <path {...p} d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
      </>
    ),
    body: (
      <>
        <circle {...p} cx="12" cy="5" r="2.3" />
        <path {...p} d="M8 21l1.2-7.5L7 12.5 8.4 8.3h7.2l1.4 4.2-2.2 1 1.2 7.5M12 13.5V21" />
      </>
    ),
    skin: (
      <>
        <path {...p} d="M12 3.2c3.4 4.1 6 7.4 6 10.4a6 6 0 0 1-12 0c0-3 2.6-6.3 6-10.4z" />
        <path {...p} d="M9.2 14.2a3 3 0 0 0 2.6 2.6" />
      </>
    ),
    face: (
      <>
        <path
          {...p}
          d="M12 3.5c4.2 0 7 3.1 7 7.6 0 4.6-3.1 9.4-7 9.4s-7-4.8-7-9.4c0-4.5 2.8-7.6 7-7.6z"
        />
        <path {...p} d="M9.3 15.3c1.6 1.2 3.8 1.2 5.4 0M12 10.5v2.4" />
      </>
    ),
    eye: (
      <>
        <path {...p} d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z" />
        <circle {...p} cx="12" cy="12" r="2.8" />
      </>
    ),
    brow: (
      <>
        <path {...p} d="M3.5 11.5c2.2-2.6 5-3.4 7.6-2.2M20.5 11.5c-2.2-2.6-5-3.4-7.6-2.2" />
        <path {...p} d="M5.5 16c1.4-1 2.8-1 4.2 0M14.3 16c1.4-1 2.8-1 4.2 0" />
      </>
    ),
    mouth: (
      <>
        <path {...p} d="M4 11c2.6 1.2 5.3 1.2 8 0 2.7 1.2 5.4 1.2 8 0" />
        <path {...p} d="M5 11.5c1.8 4.5 12.2 4.5 14 0" />
      </>
    ),
    hair: (
      <>
        <path {...p} d="M5.5 15c-1.6-6.2 1.6-11 6.5-11s8.1 4.8 6.5 11" />
        <path
          {...p}
          d="M8 7.5c1.4 2.6 4.6 3.8 9 3.4M5.5 15c.8 2.6 1.6 4.3 2.8 5.5M18.5 15c-.8 2.6-1.6 4.3-2.8 5.5"
        />
      </>
    ),
    top: (
      <path
        {...p}
        d="M8.5 4.5L4 7.2l1.6 4.1 2.1-.9V20h8.6v-9.6l2.1.9L20 7.2l-4.5-2.7c-.6 1.6-1.9 2.4-3.5 2.4s-2.9-.8-3.5-2.4z"
      />
    ),
    bottom: <path {...p} d="M6.5 3.5h11l1.5 17h-4.4L12 9.5l-2.6 11H5z" />,
    shoe: (
      <>
        <path
          {...p}
          d="M3.5 16.5V9.5h4.2l1.6 2.6 5.7 1.5c2.7.7 5.5 1.6 5.5 2.9v.6c0 .8-.6 1.4-1.4 1.4H4.9c-.8 0-1.4-.6-1.4-1.4z"
        />
        <path {...p} d="M9.5 12.4l-1 1.8M12 13l-.9 1.6" />
      </>
    ),
    glasses: (
      <>
        <circle {...p} cx="7" cy="13.5" r="3.3" />
        <circle {...p} cx="17" cy="13.5" r="3.3" />
        <path {...p} d="M10.3 13c1.1-.8 2.3-.8 3.4 0M3.7 13L2.5 9.5M20.3 13l1.2-3.5" />
      </>
    ),
    star: <path {...p} d="M12 3.8l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.7 5.4-.7z" />,
  };
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      {paths[id]}
    </svg>
  );
}

export function SectionTitle({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-2.5 flex items-baseline justify-between gap-3">
      <h3 className="text-[0.7rem] font-extrabold tracking-[0.14em] text-ink-soft uppercase">
        {children}
      </h3>
      {aside && <span className="truncate text-xs font-bold text-ink">{aside}</span>}
    </div>
  );
}

/** A picture tile for one option, with the Blender-rendered thumbnail. */
export function OptionTile({
  option,
  src,
  selected,
  onSelect,
  onHover,
  badge,
}: {
  option: CatalogOption;
  src: string;
  selected: boolean;
  onSelect: () => void;
  onHover: (on: boolean) => void;
  badge?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      className={`group relative overflow-hidden rounded-2xl bg-gradient-to-b from-[#f3e9d8] to-[#e6d6bd] text-left ring-2 transition duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember ${selected ? "shadow-[0_8px_20px_-8px_rgb(86_115_79/0.8)] ring-sage-dark" : "ring-transparent hover:-translate-y-0.5 hover:ring-wood/40 hover:shadow-md"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local, pre-sized thumbnails */}
      <img
        src={src}
        alt=""
        width={224}
        height={224}
        loading="lazy"
        draggable={false}
        className="aspect-square w-full object-cover transition duration-200 group-hover:scale-[1.04]"
      />
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#2d2420]/75 to-transparent px-2 pt-5 pb-1.5 text-[0.72rem] leading-tight font-extrabold text-cream">
        {option.label}
      </span>
      {selected && (
        <span
          className="absolute top-1.5 right-1.5 grid h-5 w-5 place-items-center rounded-full bg-sage-dark text-cream shadow"
          aria-hidden
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3">
            <path
              d="M3.5 8.5l3 3 6-7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      )}
      {badge && (
        <span className="absolute top-1.5 left-1.5 rounded-full bg-cream/90 px-1.5 py-0.5 text-[0.6rem] font-extrabold tracking-wide text-ink-soft uppercase">
          {badge}
        </span>
      )}
    </button>
  );
}

export function Swatches({
  options,
  value,
  onSelect,
  onHover,
}: {
  options: readonly ColorOption[];
  value: string;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={o.label}
            title={o.label}
            onClick={() => onSelect(o.id)}
            onMouseEnter={() => onHover(o.id)}
            onMouseLeave={() => onHover(null)}
            className={`relative h-8 w-8 rounded-full transition duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember ${selected ? "scale-110 ring-[3px] ring-ink ring-offset-2 ring-offset-cream" : "ring-1 ring-ink/15 hover:scale-110"}`}
            style={{
              background: `radial-gradient(circle at 32% 28%, rgb(255 255 255 / 0.45), transparent 42%), ${o.color}`,
            }}
          />
        );
      })}
    </div>
  );
}

export function Slider({
  value,
  onChange,
  onCommit,
  left,
  right,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  onCommit: () => void;
  left: string;
  right: string;
  label: string;
}) {
  return (
    <div>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        className="studio-range w-full"
      />
      <div className="mt-1 flex justify-between text-xs font-bold text-ink-soft">
        <span>{left}</span>
        <button
          type="button"
          onClick={() => {
            onChange(0);
            onCommit();
          }}
          className="rounded-full px-2 text-[0.68rem] font-extrabold tracking-wide uppercase hover:bg-ink/5"
        >
          Centre
        </button>
        <span>{right}</span>
      </div>
    </div>
  );
}

/** A preset card: palette strip, name and a one-line description. */
export function PresetCard({
  preset,
  onPick,
  active,
}: {
  preset: AvatarPreset;
  onPick: () => void;
  active: boolean;
}) {
  const c = preset.config;
  const strip = [
    colorOf(SKIN_TONES, c.skin),
    colorOf(HAIR_COLORS, c.hairColor),
    colorOf(CLOTH_COLORS, c.topColor),
    colorOf(CLOTH_COLORS, c.topAccent),
    colorOf(CLOTH_COLORS, c.bottomColor),
    colorOf(CLOTH_COLORS, c.shoesColor),
  ];
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`group flex w-full items-center gap-3 rounded-2xl bg-parchment p-2.5 text-left ring-2 transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember ${active ? "ring-sage-dark" : "ring-transparent hover:ring-wood/30"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local thumbnail */}
      <img
        src={`/avatars/thumbs/hair/${c.hair}.webp`}
        alt=""
        width={64}
        height={64}
        className="h-16 w-16 shrink-0 rounded-xl bg-[#ead9bf] object-cover"
      />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base font-semibold">{preset.label}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{preset.blurb}</span>
        <span className="mt-1.5 flex gap-1" aria-hidden>
          {strip.map((color, i) => (
            <span
              key={i}
              className="h-2.5 w-5 rounded-full ring-1 ring-ink/10"
              style={{ background: color }}
            />
          ))}
        </span>
      </span>
    </button>
  );
}

export function Keycap({ children }: { children: React.ReactNode }) {
  return <span className="kbd !h-5 !min-w-5 !px-1 !text-[0.65rem]">{children}</span>;
}
