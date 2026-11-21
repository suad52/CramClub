/**
 * Shared control styles: the cartoon look (tokens in app/globals.css). Gold standard:
 * components/entry/TitleScreen.tsx. Use these instead of feature-local classes so every screen
 * looks and behaves the same.
 *
 * Rules: flat colours, thick walnut outlines (3px on cards and buttons, 2px on small bits), hard
 * "sticker" shadows (0 4px 0 walnut) instead of soft blurs, chunky radii (14-16px controls,
 * 24px panels), Fredoka (font-display) for titles, buttons and labels, Nunito (font-sans) for
 * reading text. Sun yellow is the main action; tangerine, leaf and forest are accents. Buttons
 * press down when clicked. Sentence case; no emoji as icons.
 */

export const FOCUS =
  "outline-none focus-visible:ring-4 focus-visible:ring-sun focus-visible:ring-offset-2 focus-visible:ring-offset-walnut";

const BASE = `inline-flex shrink-0 items-center justify-center gap-2 rounded-[14px] border-[3px] border-walnut font-display font-semibold whitespace-nowrap shadow-[0_4px_0_#1f1a16] transition-[background-color,color,box-shadow,transform] duration-150 ease-out hover:-translate-y-px active:translate-y-[3px] active:shadow-[0_1px_0_#1f1a16] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:translate-y-0 disabled:active:shadow-[0_4px_0_#1f1a16] motion-reduce:transition-none ${FOCUS}`;

/** Buttons, medium size (44px tall). */
export const BTN = {
  /** The single main action on a screen or panel. */
  primary: `${BASE} h-11 bg-sun px-5 text-[15px] text-walnut hover:bg-[#f6d98f]`,
  /** Alternatives next to a primary action. */
  secondary: `${BASE} h-11 bg-surface px-5 text-[15px] text-walnut hover:bg-canvas`,
  /** Low-emphasis actions inside content (no outline until hovered). */
  quiet: `inline-flex shrink-0 items-center justify-center gap-2 rounded-[14px] border-[3px] border-transparent h-11 px-3 font-display text-[15px] font-semibold whitespace-nowrap text-walnut transition-colors duration-150 hover:border-walnut hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`,
  /** Destructive or "give up" actions, used rarely. */
  danger: `${BASE} h-11 bg-surface px-5 text-[15px] text-danger hover:bg-[#fbe9e5]`,
} as const;

/** Buttons, small size (36px tall), for dense lists and toolbars. */
export const BTN_SM = {
  primary: `${BASE} h-9 rounded-[12px] border-2 bg-sun px-3.5 text-[13.5px] text-walnut shadow-[0_3px_0_#1f1a16] hover:bg-[#f6d98f]`,
  secondary: `${BASE} h-9 rounded-[12px] border-2 bg-surface px-3.5 text-[13.5px] text-walnut shadow-[0_3px_0_#1f1a16] hover:bg-canvas`,
  quiet: `inline-flex shrink-0 items-center justify-center gap-1.5 rounded-[12px] border-2 border-transparent h-9 px-2.5 font-display text-[13.5px] font-semibold whitespace-nowrap text-walnut transition-colors duration-150 hover:border-walnut hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS}`,
} as const;

/** A square icon-only button: always pass an aria-label. */
export const ICON_BTN = `${BASE} h-10 w-10 rounded-[12px] border-2 bg-surface text-walnut shadow-[0_3px_0_#1f1a16] hover:bg-canvas`;

/** Content surfaces: a cream card with a walnut outline and a sticker shadow. */
export const PANEL =
  "rounded-[24px] border-[3px] border-walnut bg-surface shadow-[0_6px_0_#1f1a16]";
export const PANEL_MUTED = "rounded-[20px] border-2 border-walnut/25 bg-canvas";
export const DIVIDER = "border-walnut/15";

/** Small labels for type, status or subject (text always says what it means). */
export const TAG = {
  neutral:
    "inline-flex items-center rounded-full border-2 border-walnut bg-surface px-2.5 py-0.5 font-display text-xs font-semibold text-walnut",
  forest:
    "inline-flex items-center rounded-full border-2 border-walnut bg-leaf px-2.5 py-0.5 font-display text-xs font-semibold text-walnut",
  brass:
    "inline-flex items-center rounded-full border-2 border-walnut bg-sun px-2.5 py-0.5 font-display text-xs font-semibold text-walnut",
} as const;

/** Inputs. */
export const INPUT = `h-11 w-full rounded-[14px] border-[3px] border-walnut bg-white px-3.5 text-[15px] font-semibold text-walnut placeholder:font-medium placeholder:text-ink-soft shadow-[inset_0_3px_0_rgb(31_26_22/0.08)] outline-none focus-visible:ring-4 focus-visible:ring-sun`;
export const LABEL = "font-display text-[14px] font-semibold text-walnut";

/** Typography helpers (Fredoka for titles and labels, Nunito for reading). */
export const DISPLAY_XL =
  "font-display text-[46px] font-bold leading-[1.02] tracking-[-0.01em] text-walnut sm:text-[68px]";
export const DISPLAY_L =
  "font-display text-[34px] font-bold leading-[1.08] tracking-[-0.005em] text-walnut sm:text-[46px]";
export const TITLE = "font-display text-[26px] font-bold leading-tight text-walnut sm:text-[30px]";
export const HEADING = "font-display text-[19px] font-semibold text-walnut";
export const EYEBROW = "font-display text-[13.5px] font-semibold text-ink-soft";
export const BODY_L = "text-[17px] font-medium leading-7 text-ink-soft";
export const BODY = "text-[15px] font-medium leading-6 text-ink-soft";

/** Page layout: one content width everywhere. */
export const PAGE = "mx-auto w-full max-w-[1200px] px-4 sm:px-8";

/* ---- Over the 3D library ---- */

/** Chips and panels drawn over the scene: dark walnut stickers with a black outline. */
export const HUD_CHIP =
  "rounded-[16px] border-[3px] border-black/80 bg-walnut/80 font-display text-walnut-text shadow-[0_4px_0_rgb(0_0_0/0.55)]";
export const HUD_BTN = `${HUD_CHIP} inline-flex items-center gap-2.5 px-3.5 py-2 text-[14px] font-semibold transition-[background-color,transform,box-shadow] duration-150 hover:-translate-y-px hover:bg-walnut/90 active:translate-y-[3px] active:shadow-[0_1px_0_rgb(0_0_0/0.55)] outline-none focus-visible:ring-4 focus-visible:ring-sun motion-reduce:transition-none`;
export const HUD_MUTED = "text-walnut-muted";

/** A ribbon label that sits on a card's top edge (like the title screen's "Member card"). */
export const RIBBON =
  "inline-flex items-center rounded-full border-[2.5px] border-walnut bg-tangerine px-3 py-0.5 font-display text-[13px] font-semibold text-walnut shadow-[0_3px_0_#1f1a16]";
