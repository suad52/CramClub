"use client";

import { useEffect, useRef, useState } from "react";
import {
  ACCESSORIES,
  type AvatarConfig,
  BOTTOMS,
  CLOTH_COLORS,
  HAIR_COLORS,
  HAIR_STYLES,
  SHOES,
  TOPS,
  labelOf,
} from "@ovr/shared";
import { hashString } from "@ovr/shared";
import { IconArrowLeft, IconRefresh } from "@/components/ui/icons";
import { BTN, EYEBROW, LABEL, RIBBON, TITLE } from "@/components/ui/styles";
import { NAME_MAX, cleanName } from "@/lib/avatar/profile";

const ADJECTIVES = [
  "Quiet",
  "Sleepy",
  "Curious",
  "Cozy",
  "Bright",
  "Gentle",
  "Clever",
  "Midnight",
  "Sunny",
  "Wandering",
  "Patient",
  "Lucky",
];
const NOUNS = [
  "Owl",
  "Fox",
  "Fern",
  "Comet",
  "Otter",
  "Maple",
  "Inkwell",
  "Moth",
  "Sparrow",
  "Pebble",
  "Lantern",
  "Badger",
];

/** A friendly placeholder name, different on each press. */
export function suggestName(seed: number): string {
  const h = hashString(`name-${seed}`);
  return `${ADJECTIVES[h % ADJECTIVES.length]} ${NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length]}`;
}

/** The name field: the shared input look, written in the handwriting font, like a signature. */
const SIGNATURE_INPUT =
  "h-12 w-full min-w-0 flex-1 rounded-[14px] border-[3px] border-walnut bg-white px-3.5 pt-0.5 font-[family-name:var(--font-caveat)] text-[1.65rem] leading-none text-walnut shadow-[inset_0_3px_0_rgb(31_26_22/0.08)] outline-none placeholder:text-ink-soft focus-visible:ring-4 focus-visible:ring-sun";

/**
 * The last step of the studio: a tilted cream library card (like the title screen's member card,
 * with its tangerine ribbon and round stamp) holding the character's name and a summary of the
 * look, over a walnut scrim. Saving here is the only thing that overwrites the saved character.
 */
export function LibraryCard({
  config,
  initialName,
  confirmLabel,
  onBack,
  onConfirm,
}: {
  config: AvatarConfig;
  initialName: string;
  confirmLabel: string;
  onBack: () => void;
  onConfirm: (name: string) => void;
}) {
  const [name, setName] = useState(initialName);
  const [seed, setSeed] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const clean = cleanName(name);
  const summary: [string, string][] = [
    ["Hair", `${labelOf(HAIR_STYLES, config.hair)} · ${labelOf(HAIR_COLORS, config.hairColor)}`],
    ["Top", `${labelOf(TOPS, config.top)} · ${labelOf(CLOTH_COLORS, config.topColor)}`],
    ["Bottom", `${labelOf(BOTTOMS, config.bottom)} · ${labelOf(CLOTH_COLORS, config.bottomColor)}`],
    ["Shoes", `${labelOf(SHOES, config.shoes)} · ${labelOf(CLOTH_COLORS, config.shoesColor)}`],
    [
      "Extras",
      config.accessories.length
        ? config.accessories.map((a) => labelOf(ACCESSORIES, a)).join(", ")
        : "None",
    ],
  ];
  const today = new Date().toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div
      className="absolute inset-0 z-30 grid place-items-center overflow-y-auto bg-walnut/50 p-5 pt-8 transition-opacity duration-200 ease-out starting:opacity-0 motion-reduce:transition-none sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-title"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onConfirm(clean);
        }}
        className="title-pop relative w-full max-w-[30rem] -rotate-[1.5deg] rounded-[24px] border-[3px] border-walnut bg-[#fbf3e2] p-6 pt-8 text-walnut shadow-[0_9px_0_#1f1a16] sm:p-7 sm:pt-9"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-2.5 rounded-[16px] border-2 border-dashed border-walnut/25"
        />
        <p className={`${RIBBON} absolute -top-4 left-6`}>OVR library card</p>
        <span
          aria-hidden
          className="absolute -top-4 -right-4 grid h-14 w-14 rotate-12 place-items-center rounded-full border-[3px] border-walnut bg-sun font-display text-[0.95rem] font-bold text-walnut shadow-[0_4px_0_#1f1a16]"
        >
          OVR
        </span>
        <div className="relative flex items-start justify-between gap-4 pr-8">
          <div>
            <h2 id="card-title" className={TITLE}>
              Sign your card
            </h2>
            <span aria-hidden className="mt-2.5 flex items-center gap-2">
              <span className="h-2.5 w-16 rounded-full border-2 border-walnut bg-tangerine shadow-[0_2px_0_#1f1a16]" />
              <span className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-sun shadow-[0_2px_0_#1f1a16]" />
              <span className="h-2.5 w-2.5 rounded-full border-2 border-walnut bg-leaf shadow-[0_2px_0_#1f1a16]" />
            </span>
          </div>
          <p className={`${EYEBROW} shrink-0 pt-1 text-right leading-5`}>
            Issued
            <span className="tabular block font-semibold text-walnut">{today}</span>
          </p>
        </div>

        <label className="relative mt-6 block">
          <span className={LABEL}>Name others will see</span>
          <span className="mt-1.5 flex items-center gap-2">
            <input
              ref={input}
              value={name}
              maxLength={NAME_MAX + 4}
              onChange={(e) => setName(e.target.value)}
              placeholder={suggestName(seed)}
              className={SIGNATURE_INPUT}
              aria-describedby="name-hint"
            />
            <button
              type="button"
              onClick={() => {
                setName(suggestName(seed));
                setSeed((s) => s + 1);
              }}
              className={BTN.secondary}
              title="Suggest a name"
            >
              <IconRefresh size={16} strokeWidth={2.5} />
              Suggest
            </button>
          </span>
          <span
            id="name-hint"
            className="mt-1.5 block text-[13px] leading-5 font-medium text-ink-soft"
          >
            <span className="tabular">{NAME_MAX - clean.length}</span> characters left. You can
            change it any time.
          </span>
        </label>

        <dl className="relative mt-6 divide-y-2 divide-dashed divide-walnut/15 rounded-[18px] border-[2.5px] border-walnut bg-surface px-4 py-1 text-sm shadow-[0_3px_0_#1f1a16]">
          {summary.map(([k, v]) => (
            <div key={k} className="flex gap-4 py-2">
              <dt className="w-16 shrink-0 font-display font-semibold text-ink-soft">{k}</dt>
              <dd className="min-w-0 truncate font-semibold text-walnut">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="relative mt-7 flex flex-wrap items-center justify-between gap-3">
          <button type="button" onClick={onBack} className={`${BTN.quiet} -ml-3`}>
            <IconArrowLeft size={16} strokeWidth={2.5} />
            Back to studio
          </button>
          <button type="submit" disabled={!clean} className={BTN.primary}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
