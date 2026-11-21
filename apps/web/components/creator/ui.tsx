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
import { IconCheck } from "@/components/ui/icons";
import { FOCUS } from "@/components/ui/styles";
import type { IconId } from "./categories";

/**
 * Line icons for the category rail, drawn like the shared set in components/ui/icons.tsx (24px
 * grid, currentColor) with a slightly chunkier stroke to match the cartoon kit.
 */
export function Icon({ id, className = "h-5 w-5" }: { id: IconId; className?: string }) {
  const paths: Record<IconId, React.ReactNode> = {
    // Presets: a stack of ready-made looks.
    spark: <path d="M12 4.25 20 8.5l-8 4.25L4 8.5zM4 12.25l8 4.25 8-4.25M4 16l8 4.25L20 16" />,
    body: (
      <>
        <circle cx="12" cy="5" r="2.3" />
        <path d="M8 21l1.2-7.5L7 12.5 8.4 8.3h7.2l1.4 4.2-2.2 1 1.2 7.5M12 13.5V21" />
      </>
    ),
    skin: (
      <>
        <path d="M12 3.2c3.4 4.1 6 7.4 6 10.4a6 6 0 0 1-12 0c0-3 2.6-6.3 6-10.4z" />
        <path d="M9.2 14.2a3 3 0 0 0 2.6 2.6" />
      </>
    ),
    face: (
      <>
        <path d="M12 3.5c4.2 0 7 3.1 7 7.6 0 4.6-3.1 9.4-7 9.4s-7-4.8-7-9.4c0-4.5 2.8-7.6 7-7.6z" />
        <path d="M9.3 15.3c1.6 1.2 3.8 1.2 5.4 0M12 10.5v2.4" />
      </>
    ),
    eye: (
      <>
        <path d="M2.8 12s3.4-6 9.2-6 9.2 6 9.2 6-3.4 6-9.2 6-9.2-6-9.2-6z" />
        <circle cx="12" cy="12" r="2.8" />
      </>
    ),
    brow: (
      <path d="M3.5 11.5c2.2-2.6 5-3.4 7.6-2.2M20.5 11.5c-2.2-2.6-5-3.4-7.6-2.2M5.5 16c1.4-1 2.8-1 4.2 0M14.3 16c1.4-1 2.8-1 4.2 0" />
    ),
    mouth: <path d="M4 11c2.6 1.2 5.3 1.2 8 0 2.7 1.2 5.4 1.2 8 0M5 11.5c1.8 4.5 12.2 4.5 14 0" />,
    hair: (
      <path d="M5.5 15c-1.6-6.2 1.6-11 6.5-11s8.1 4.8 6.5 11M8 7.5c1.4 2.6 4.6 3.8 9 3.4M5.5 15c.8 2.6 1.6 4.3 2.8 5.5M18.5 15c-.8 2.6-1.6 4.3-2.8 5.5" />
    ),
    top: (
      <path d="M8.5 4.5L4 7.2l1.6 4.1 2.1-.9V20h8.6v-9.6l2.1.9L20 7.2l-4.5-2.7c-.6 1.6-1.9 2.4-3.5 2.4s-2.9-.8-3.5-2.4z" />
    ),
    bottom: <path d="M6.5 3.5h11l1.5 17h-4.4L12 9.5l-2.6 11H5z" />,
    shoe: (
      <path d="M3.5 16.5V9.5h4.2l1.6 2.6 5.7 1.5c2.7.7 5.5 1.6 5.5 2.9v.6c0 .8-.6 1.4-1.4 1.4H4.9c-.8 0-1.4-.6-1.4-1.4zM9.5 12.4l-1 1.8M12 13l-.9 1.6" />
    ),
    glasses: (
      <>
        <circle cx="7" cy="13.5" r="3.3" />
        <circle cx="17" cy="13.5" r="3.3" />
        <path d="M10.3 13c1.1-.8 2.3-.8 3.4 0M3.7 13L2.5 9.5M20.3 13l1.2-3.5" />
      </>
    ),
    star: <path d="M12 3.8l2.4 5 5.4.7-4 3.7 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.7 5.4-.7z" />,
    // Voice: a microphone with sound waves.
    voice: (
      <>
        <rect x="9.2" y="3.5" width="5.6" height="10" rx="2.8" />
        <path d="M6.2 11a5.8 5.8 0 0011.6 0M12 16.8v3.2M3.6 9v4M20.4 9v4" />
      </>
    ),
    // Head: a round portrait, like the face head's photo disc.
    head: (
      <>
        <circle cx="12" cy="12" r="8.6" />
        <circle cx="12" cy="10.2" r="2.7" />
        <path d="M7.1 18.3c1.1-2.4 2.9-3.7 4.9-3.7s3.8 1.3 4.9 3.7" />
      </>
    ),
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      {paths[id]}
    </svg>
  );
}

/** A section heading inside the options panel, with the current choice on the right. */
export function SectionTitle({
  children,
  aside,
}: {
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="font-display text-[15.5px] leading-5 font-semibold text-walnut">{children}</h3>
      {aside && (
        <span className="tabular truncate rounded-full border-2 border-walnut/20 bg-canvas px-2.5 py-0.5 font-display text-[12.5px] leading-4 font-semibold text-ink-soft">
          {aside}
        </span>
      )}
    </div>
  );
}

/** A small leaf-green check sticker for the selected tile or preset. */
export function SelectedMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`grid h-6 w-6 rotate-6 place-items-center rounded-full border-2 border-walnut bg-leaf text-walnut shadow-[0_2px_0_#1f1a16] ${className}`}
    >
      <IconCheck size={13} strokeWidth={3.25} />
    </span>
  );
}

/** Lift on hover, press down on click, sun yellow when chosen: shared by tiles and presets. */
export const PICK =
  "transition-[background-color,border-color,box-shadow,translate] duration-150 ease-out active:translate-y-px active:shadow-[0_1px_0_#1f1a16] motion-reduce:transition-none";
export const PICK_ON = "-translate-y-0.5 border-walnut bg-sun shadow-[0_4px_0_#1f1a16]";

/** A picture tile for one option, with the Blender-rendered thumbnail and its name under it. */
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
      className={`relative flex flex-col rounded-[16px] border-[2.5px] p-1.5 text-left ${PICK} ${FOCUS} ${selected ? PICK_ON : "border-walnut/20 bg-surface hover:-translate-y-0.5 hover:border-walnut hover:shadow-[0_3px_0_#1f1a16]"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local, pre-sized thumbnails */}
      <img
        src={src}
        alt=""
        width={224}
        height={224}
        loading="lazy"
        draggable={false}
        className="aspect-square w-full rounded-[11px] bg-canvas object-cover"
      />
      <span className="block truncate px-1 pt-1.5 pb-0.5 font-display text-[12.5px] leading-4 font-semibold text-walnut">
        {option.label}
      </span>
      {selected && <SelectedMark className="absolute -top-1.5 -right-1.5" />}
      {badge && (
        <span className="absolute top-2.5 left-2.5 -rotate-3 rounded-full border-2 border-walnut bg-surface px-1.5 py-px font-display text-[11px] leading-4 font-semibold text-walnut shadow-[0_2px_0_#1f1a16]">
          {badge.charAt(0).toUpperCase() + badge.slice(1)}
        </span>
      )}
    </button>
  );
}

/** Whether a check mark on this colour should be dark (light swatches) or light. */
function isLight(hex: string) {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  if (Number.isNaN(n)) return false;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

/**
 * Colour swatches: true circles, each named for screen readers and on hover, with the name of
 * the chosen (or hovered) colour shown in the section heading. Each has a walnut outline; the
 * chosen one gets a thicker one, lifts on a sticker shadow and shows a check.
 */
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
    <div className="flex flex-wrap gap-3 pb-1" role="radiogroup">
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
            className={`grid h-9 w-9 place-items-center rounded-full border-walnut transition-[border-width,box-shadow,translate,scale] duration-150 ease-out active:translate-y-px motion-reduce:transition-none ${FOCUS} ${selected ? "-translate-y-0.5 scale-110 border-[3px] shadow-[0_3px_0_#1f1a16]" : "border-2 hover:-translate-y-0.5 hover:shadow-[0_2px_0_#1f1a16]"}`}
            style={{ background: o.color }}
          >
            {selected && (
              <IconCheck
                size={16}
                strokeWidth={3.25}
                className={isLight(o.color) ? "text-walnut" : "text-surface"}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * A chunky range input: a walnut-outlined track and a sun-yellow knob with a sticker shadow.
 * Add a track fill: RANGE_TRACK (plain) or RANGE_TRACK_PLAYFUL (leaf to sun to tangerine).
 */
export const RANGE = `h-7 w-full cursor-pointer appearance-none rounded-full bg-transparent ${FOCUS} [&::-webkit-slider-runnable-track]:box-border [&::-webkit-slider-runnable-track]:h-3 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:border-2 [&::-webkit-slider-runnable-track]:border-walnut [&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:box-border [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-walnut [&::-webkit-slider-thumb]:bg-sun [&::-webkit-slider-thumb]:shadow-[0_3px_0_#1f1a16] [&::-moz-range-track]:box-border [&::-moz-range-track]:h-3 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:border-2 [&::-moz-range-track]:border-walnut [&::-moz-range-thumb]:box-border [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-[3px] [&::-moz-range-thumb]:border-walnut [&::-moz-range-thumb]:bg-sun [&::-moz-range-thumb]:shadow-[0_3px_0_#1f1a16]`;
export const RANGE_TRACK =
  "[&::-webkit-slider-runnable-track]:bg-canvas [&::-moz-range-track]:bg-canvas";
export const RANGE_TRACK_PLAYFUL =
  "[&::-webkit-slider-runnable-track]:bg-[linear-gradient(90deg,var(--color-leaf),var(--color-sun),var(--color-tangerine))] [&::-moz-range-track]:bg-[linear-gradient(90deg,var(--color-leaf),var(--color-sun),var(--color-tangerine))]";

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
        className={`${RANGE} ${RANGE_TRACK}`}
      />
      <div className="mt-1 flex items-center justify-between font-display text-xs font-medium text-ink-soft">
        <span>{left}</span>
        <button
          type="button"
          onClick={() => {
            onChange(0);
            onCommit();
          }}
          className={`inline-flex h-7 items-center rounded-[10px] border-2 border-walnut bg-surface px-2.5 font-display text-xs font-semibold text-walnut shadow-[0_2px_0_#1f1a16] transition-[background-color,box-shadow,translate] duration-150 ease-out hover:-translate-y-px hover:bg-sun active:translate-y-px active:shadow-none motion-reduce:transition-none ${FOCUS}`}
        >
          Centre
        </button>
        <span>{right}</span>
      </div>
    </div>
  );
}

/** A preset look: its hairstyle, name, a one-line description and its colours. */
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
      className={`flex w-full items-center gap-3 rounded-[20px] border-[2.5px] p-2.5 text-left ${PICK} ${FOCUS} ${active ? PICK_ON : "border-walnut bg-surface shadow-[0_3px_0_#1f1a16] hover:-translate-y-0.5 hover:bg-canvas hover:shadow-[0_4px_0_#1f1a16]"}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- local thumbnail */}
      <img
        src={`/avatars/thumbs/hair/${c.hair}.webp`}
        alt=""
        width={64}
        height={64}
        className="h-16 w-16 shrink-0 rounded-[14px] border-2 border-walnut bg-canvas object-cover"
      />
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[15.5px] leading-5 font-semibold text-walnut">
          {preset.label}
        </span>
        <span
          className={`mt-0.5 block text-xs leading-4 font-medium ${active ? "text-walnut/75" : "text-ink-soft"}`}
        >
          {preset.blurb}
        </span>
        <span className="mt-2 flex gap-1" aria-hidden>
          {strip.map((color, i) => (
            <span
              key={i}
              className="h-3.5 w-3.5 rounded-full border-2 border-walnut"
              style={{ background: color }}
            />
          ))}
        </span>
      </span>
      {active && <SelectedMark className="mr-1 self-start" />}
    </button>
  );
}

export function Keycap({ children }: { children: React.ReactNode }) {
  return <kbd className="kbd !h-6 !min-w-6 !px-1.5 !text-[11.5px]">{children}</kbd>;
}
