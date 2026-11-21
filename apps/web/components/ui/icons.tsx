import type { ReactNode, SVGProps } from "react";

/**
 * The redesign's icon set: plain line icons drawn on a 24px grid with a 1.75 stroke in
 * `currentColor`, so they take the colour of the text beside them. Use these instead of emoji or
 * text glyphs (☰ × ↗ 🎓 📈 📚 👁) so every screen shares one icon style.
 *
 * Icons are decorative by default (hidden from screen readers): the button or link around them
 * carries the words. Pass `title` only when an icon stands alone and has to say something itself.
 */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  /** Width and height in px. */
  size?: number | string;
  /** Accessible name, for an icon that means something on its own. */
  title?: string;
};

function Svg({
  size = 20,
  title,
  className,
  children,
  ...rest
}: IconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={`shrink-0 ${className ?? ""}`}
      {...rest}
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/* ---- Navigation and actions ---- */

export function IconMenu(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Svg>
  );
}

export function IconClose(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </Svg>
  );
}

export function IconChevronRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9.5 6l6 6-6 6" />
    </Svg>
  );
}

export function IconChevronDown(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 9.5l6 6 6-6" />
    </Svg>
  );
}

/** Opens somewhere else (a new tab or an outside source). */
export function IconArrowUpRight(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 17L17 7M8.5 7H17v8.5" />
    </Svg>
  );
}

export function IconCheck(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function IconSearch(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.25" />
      <path d="M15.6 15.6l4.15 4.15" />
    </Svg>
  );
}

/** Leaving the library (a door with an arrow out). */
export function IconLeave(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 4.75H6.75a2 2 0 00-2 2v10.5a2 2 0 002 2h6.75" />
      <path d="M10 12h10.25M17 8.75L20.25 12 17 15.25" />
    </Svg>
  );
}

/* ---- Learning ---- */

/** The library and the AI Librarian (an open book). */
export function IconBook(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 6.6C10.5 5.35 8.4 4.75 3.75 4.75v13.5c4.65 0 6.75.6 8.25 1.85 1.5-1.25 3.6-1.85 8.25-1.85V4.75c-4.65 0-6.75.6-8.25 1.85z" />
      <path d="M12 6.6v13.5" />
    </Svg>
  );
}

/** Saving a source or resource. */
export function IconBookmark(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 4.75h10v15l-5-3.5-5 3.5v-15z" />
    </Svg>
  );
}

/** The Learning Studio and lessons (a mortarboard). */
export function IconGraduationCap(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.75 9.5L12 5l9.25 4.5L12 14 2.75 9.5z" />
      <path d="M6.5 11.6v4.15c0 1.55 2.45 3 5.5 3s5.5-1.45 5.5-3V11.6M21.25 9.5v5" />
    </Svg>
  );
}

/** Playing a lesson or narration. */
export function IconPlay(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5.75v12.5L18.25 12 8 5.75z" />
    </Svg>
  );
}

/** My progress (a rising line on axes). */
export function IconChart(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 4.75v14.5h16" />
      <path d="M7.75 15l3.5-4 3 2.5 4.75-5.75" />
    </Svg>
  );
}

/** Focus sessions and timers. */
export function IconClock(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M12 7.75V12l2.75 1.75" />
    </Svg>
  );
}

/* ---- You ---- */

/** Your character or profile. */
export function IconUser(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.25" r="3.75" />
      <path d="M4.75 19.75c.85-3.55 3.75-5.6 7.25-5.6s6.4 2.05 7.25 5.6" />
    </Svg>
  );
}

/** Expression tracking (a face). */
export function IconFace(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M9.25 10v.5M14.75 10v.5M9.25 14.75h5.5" />
    </Svg>
  );
}

/** The camera (expression tracking's video). */
export function IconCamera(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2" />
      <path d="M15.5 10.4l5-2.9v9l-5-2.9" />
    </Svg>
  );
}

/** First-person view. */
export function IconEye(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.75 12S6 5.75 12 5.75 21.25 12 21.25 12 18 18.25 12 18.25 2.75 12 2.75 12z" />
      <circle cx="12" cy="12" r="2.75" />
    </Svg>
  );
}

/** Keys and controls. */
export function IconKeyboard(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="2.75" y="6" width="18.5" height="12" rx="2" />
      <path d="M6.75 10h.01M10.25 10h.01M13.75 10h.01M17.25 10h.01M8 14h8" />
    </Svg>
  );
}

/** Settings such as mouse and graphics (two sliders). */
export function IconSliders(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7.5h8.5M17.5 7.5H20M4 16.5h2.5M11.5 16.5H20" />
      <circle cx="15" cy="7.5" r="2.25" />
      <circle cx="9" cy="16.5" r="2.25" />
    </Svg>
  );
}

export function IconHelp(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.25" />
      <path d="M9.75 9.6a2.35 2.35 0 114.1 1.6c-.75.7-1.85 1.15-1.85 2.3v.25M12 16.75h.01" />
    </Svg>
  );
}

/** Voice: speaking with the Librarian. */
export function IconMic(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="9" y="3.75" width="6" height="10.5" rx="3" />
      <path d="M5.75 11.25a6.25 6.25 0 0012.5 0M12 17.5v2.75" />
    </Svg>
  );
}

/* ---- Added for milestone 2 (Librarian, progress, timer, lessons, studio) ---- */

function icon(paths: ReactNode) {
  return function Icon(props: IconProps) {
    return <Svg {...props}>{paths}</Svg>;
  };
}

/** Send a message. */
export const IconSend = icon(<path d="M4.5 12h13.75M13 6.25 18.75 12 13 17.75" />);
/** Stop (recording, speaking, a run). */
export const IconStop = icon(<rect x="6.5" y="6.5" width="11" height="11" rx="2" />);
/** Pause. */
export const IconPause = icon(<path d="M9 6v12M15 6v12" />);
/** Start again / retry. */
export const IconRefresh = icon(
  <path d="M19.25 12a7.25 7.25 0 11-2.12-5.13M19.25 4.75v4.5h-4.5" />,
);
/** Upload a file. */
export const IconUpload = icon(
  <path d="M12 15.5V4.75M7.25 9.5 12 4.75l4.75 4.75M4.75 15v4.25h14.5V15" />,
);
/** Download / save a file. */
export const IconDownload = icon(
  <path d="M12 4.75V15.5M7.25 10.75 12 15.5l4.75-4.75M4.75 15v4.25h14.5V15" />,
);
/** A document or source. */
export const IconFile = icon(
  <path d="M13.25 3.75H7.5a1.75 1.75 0 00-1.75 1.75v13a1.75 1.75 0 001.75 1.75h9a1.75 1.75 0 001.75-1.75V8.75zM13.25 3.75v5h5M9 13h6M9 16.25h4" />,
);
/** Delete. */
export const IconTrash = icon(
  <path d="M4.75 7h14.5M9.75 7V4.75h4.5V7M6.75 7l.75 12.25h9L17.25 7M10.25 10.75v5M13.75 10.75v5" />,
);
/** Add / new. */
export const IconPlus = icon(<path d="M12 5v14M5 12h14" />);
/** Sound on. */
export const IconVolume = icon(
  <path d="M4.75 9.75v4.5h3.5l4.5 3.75V6l-4.5 3.75zM16 9.25a4 4 0 010 5.5M18.5 6.75a7.5 7.5 0 010 10.5" />,
);
/** Sound off (muted). */
export const IconVolumeOff = icon(
  <path d="M4.75 9.75v4.5h3.5l4.5 3.75V6l-4.5 3.75zM16.25 9.75l4.5 4.5M20.75 9.75l-4.5 4.5" />,
);
/** A web link / source URL. */
export const IconLink = icon(
  <path d="M10.25 13.75a3.5 3.5 0 005 0l3-3a3.54 3.54 0 00-5-5l-1 1M13.75 10.25a3.5 3.5 0 00-5 0l-3 3a3.54 3.54 0 005 5l1-1" />,
);
/** Back. */
export const IconArrowLeft = icon(<path d="M19.25 12H5.5M11 6.25 5.25 12 11 17.75" />);
/** Next / forward. */
export const IconArrowRight = icon(<path d="M4.75 12H18.5M13 6.25 18.75 12 13 17.75" />);
/** Previous (chevron). */
export const IconChevronLeft = icon(<path d="M14.5 6.25 8.75 12l5.75 5.75" />);
/** Something needs attention. */
export const IconWarning = icon(<path d="M12 4.25 3.75 19h16.5zM12 10v4M12 16.75v.25" />);
/** More information. */
export const IconInfo = icon(
  <>
    <circle cx="12" cy="12" r="8.25" />
    <path d="M12 11v5.25M12 7.75v.25" />
  </>,
);
/** A date or schedule (study plans). */
export const IconCalendar = icon(
  <path d="M5.75 6.25h12.5a1 1 0 011 1v11a1 1 0 01-1 1H5.75a1 1 0 01-1-1v-11a1 1 0 011-1zM4.75 10.25h14.5M8.5 4.25v3.5M15.5 4.25v3.5" />,
);
/** A list of tasks. */
export const IconList = icon(
  <path d="M9.25 7h10M9.25 12h10M9.25 17h10M4.75 7h.5M4.75 12h.5M4.75 17h.5" />,
);
/** Ranking / leaderboard. */
export const IconTrophy = icon(
  <path d="M7.75 4.75h8.5v5a4.25 4.25 0 01-8.5 0zM7.75 6.75h-3c0 2.5 1.25 4 3.25 4.25M16.25 6.75h3c0 2.5-1.25 4-3.25 4.25M12 14v3.5M8.75 19.25h6.5" />,
);
/** A streak. */
export const IconFlame = icon(
  <path d="M12 20.25c3.6 0 6.25-2.4 6.25-5.9 0-3.85-3.1-5.6-3.9-9.6-1.95 1.3-3.1 3.2-3.1 5.25-1.15-.6-1.85-1.75-1.95-3-2.1 1.85-3.55 4.4-3.55 7.35 0 3.5 2.65 5.9 6.25 5.9z" />,
);
/** People / community. */
export const IconUsers = icon(
  <>
    <circle cx="9" cy="8.75" r="3" />
    <path d="M3.75 19.25c.6-3.05 2.65-4.75 5.25-4.75s4.65 1.7 5.25 4.75M15.25 6a3 3 0 010 5.75M17 14.75c1.65.55 2.85 2 3.25 4.5" />
  </>,
);
/** Copy. */
export const IconCopy = icon(<path d="M9.25 9.25h9.5v10h-9.5zM14.75 9.25V4.75h-10v10h4.5" />);
/** A lesson on the board / presenting. */
export const IconBoard = icon(
  <path d="M3.75 5.25h16.5M5 5.25v9.5h14v-9.5M12 14.75v4.5M8.5 19.25 12 16.75l3.5 2.5" />,
);
/** Settings. */
export const IconSettings = icon(
  <>
    <circle cx="12" cy="12" r="2.75" />
    <path d="M12 3.75v2.5M12 17.75v2.5M3.75 12h2.5M17.75 12h2.5M6.17 6.17l1.77 1.77M16.06 16.06l1.77 1.77M6.17 17.83l1.77-1.77M16.06 7.94l1.77-1.77" />
  </>,
);
/** Up (keyboard hints). */
export const IconArrowUp = icon(<path d="M12 19.25V5.5M6.25 11 12 5.25 17.75 11" />);
/** Down (keyboard hints). */
export const IconArrowDown = icon(<path d="M12 4.75V18.5M6.25 13 12 18.75 17.75 13" />);
