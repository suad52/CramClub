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
import { NAME_MAX, cleanName } from "@/lib/avatar/profile";
import { hashString } from "@ovr/shared";

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

/**
 * The last step of the studio: a library membership card with the character's name and a
 * summary of the look. Saving here is the only thing that overwrites the saved character.
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
      className="absolute inset-0 z-30 grid place-items-center bg-ink/40 p-6 backdrop-blur-[3px] studio-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="card-title"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onConfirm(clean);
        }}
        className="studio-card-in relative w-full max-w-[30rem] rotate-[-1.2deg] rounded-[1.6rem] bg-[#fbf3e2] p-7 text-ink shadow-[0_40px_90px_-25px_rgb(20_12_6/0.75)] ring-1 ring-ink/10"
      >
        <div
          className="pointer-events-none absolute inset-3 rounded-[1.2rem] border-2 border-dashed border-wood/25"
          aria-hidden
        />
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-extrabold tracking-[0.22em] text-wood uppercase">
              OVR Library · Member card
            </p>
            <h2 id="card-title" className="mt-1 font-display text-3xl font-semibold">
              Sign your card
            </h2>
          </div>
          <div
            className="grid h-16 w-16 shrink-0 rotate-12 place-items-center rounded-full border-[3px] border-ember/70 text-center text-[0.55rem] leading-tight font-extrabold tracking-wider text-ember/80 uppercase"
            aria-hidden
          >
            Issued
            <br />
            {today}
          </div>
        </div>

        <label className="mt-6 block">
          <span className="text-xs font-extrabold tracking-wide text-ink-soft uppercase">
            Name others will see
          </span>
          <div className="mt-1 flex items-end gap-2 border-b-2 border-ink/25 focus-within:border-wood">
            <input
              ref={input}
              value={name}
              maxLength={NAME_MAX + 4}
              onChange={(e) => setName(e.target.value)}
              placeholder={suggestName(seed)}
              className="min-w-0 flex-1 bg-transparent pb-1 font-[family-name:var(--font-caveat)] text-4xl leading-none text-ink outline-none placeholder:text-ink/25"
              aria-describedby="name-hint"
            />
            <button
              type="button"
              onClick={() => {
                setName(suggestName(seed));
                setSeed((s) => s + 1);
              }}
              className="mb-1.5 rounded-full px-2.5 py-1 text-xs font-extrabold text-wood hover:bg-wood/10"
              title="Suggest a name"
            >
              Suggest
            </button>
          </div>
          <span id="name-hint" className="mt-1 block text-xs text-ink-soft">
            {NAME_MAX - clean.length} characters left. You can change it any time.
          </span>
        </label>

        <dl className="mt-5 space-y-1.5 text-sm">
          {summary.map(([k, v]) => (
            <div key={k} className="flex gap-3 border-b border-ink/10 pb-1.5">
              <dt className="w-16 shrink-0 font-extrabold text-ink-soft">{k}</dt>
              <dd className="truncate font-bold">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-7 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onBack}
            className="rounded-full px-4 py-2.5 text-sm font-bold text-ink-soft hover:bg-ink/5 hover:text-ink"
          >
            Back to studio
          </button>
          <button
            type="submit"
            disabled={!clean}
            className="rounded-full bg-sage-dark px-6 py-3 text-base font-extrabold text-cream shadow-[0_10px_24px_-10px_rgb(86_115_79/0.9)] transition hover:bg-[#46623f] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ember"
          >
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
