import type { LeaderboardKind } from "@ovr/shared";
import { formatRange } from "@/components/progress/format";
import type { HallBoard } from "@/lib/learning/hallBoards";
import { LIBRARY_TIME_ZONE } from "@/lib/learning/rules";
import type { Leaderboard, LeaderboardRow } from "@/lib/learning/types";

/*
 * The painted face of a hall leaderboard, in the cartoon style (components/ui/styles.ts): a cream
 * card with thick walnut outlines pinned to a green felt board, a tangerine title ribbon, medal
 * stickers for the top three and your own row in sun yellow. What it says is worked out by
 * `leaderboardFace` (pure, tested); `drawLeaderboardFace` paints it onto the board's canvas.
 *
 * The focus board adds a small "✓ 45 m at desk" under a row's focus time when part of it was seen
 * at the desk by that student's own opt-in face tracking (LeaderboardRow.verifiedMinutes). It's a
 * detail only: rows are ranked by focus time exactly as before, camera or not.
 */

/** The face canvas (the board's face has the same aspect: LEADERBOARD_STAND.face). */
export const FACE_W = 1024;
export const FACE_H = 1344;
/** Rows shown on a board. */
export const FACE_ROWS = 8;

export interface FaceRow {
  rank: number;
  name: string;
  value: string;
  /**
   * A small second line under the value: the XP board's active days, the focus board's verified
   * time (null without any).
   */
  detail: string | null;
  /** The detail is verified time (painted leaf green, like the site's "seen at desk" chips). */
  detailVerified: boolean;
  isMe: boolean;
  isDemo: boolean;
}

export interface FaceContent {
  title: string;
  subtitle: string;
  /** Column heading over the values. */
  valueLabel: string;
  rows: FaceRow[];
  /** Shown instead of rows while loading, when offline, or when no one's on the board yet. */
  notice: { tone: "loading" | "offline" | "empty"; title: string; body: string } | null;
  /** Under the rows: where you stand when you're not in them, else how the board is ranked. */
  footer: { text: string; you: boolean };
}

const COPY: Record<
  LeaderboardKind,
  { title: string; valueLabel: string; empty: string; rule: string; join: string }
> = {
  focus: {
    title: "Most time locked in",
    valueLabel: "Focus time",
    empty: "Finish a pomodoro to be first!",
    rule: "Ranked by pomodoro focus time, then XP",
    join: "Finish a pomodoro to join the board",
  },
  xp: {
    title: "Top learners",
    valueLabel: "XP",
    empty: "Finish a lesson or a pomodoro to be first!",
    rule: "XP from lessons, knowledge checks and focus",
    join: "Earn some XP to join the board",
  },
};

const NUMBER = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/** "3 h 25 m", "45 m", "2 h". */
export function formatFocus(minutes: number) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} m` : `${h} h`;
}

export const formatXp = (xp: number) => `${NUMBER.format(Math.max(0, Math.round(xp)))} XP`;

/** "✓ 45 m at desk": focus time seen at the desk, or null when there's none to show. */
export function formatVerified(minutes: number | undefined) {
  const m = Math.round(minutes ?? 0);
  return m > 0 ? `✓ ${formatFocus(m)} at desk` : null;
}
export const formatDays = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/** Demo learners are named "Demo · Mei": the board says "demo" with a tag instead. */
function nameOf(r: LeaderboardRow) {
  const name = r.isDemo ? r.displayName.replace(/^demo\s*·\s*/i, "") : r.displayName;
  return name.trim() || "Reader";
}

/** Your focus time for the footer, with what was seen at the desk when there is some. */
function youFocus(me: NonNullable<Leaderboard["me"]>) {
  const verified = Math.round(me.verifiedMinutes ?? 0);
  const focus = formatFocus(me.focusMinutes ?? 0);
  return verified > 0 ? `${focus} (✓ ${formatFocus(verified)})` : focus;
}

export function leaderboardFace(
  kind: LeaderboardKind,
  state: HallBoard,
  timeZone = LIBRARY_TIME_ZONE,
): FaceContent {
  const copy = COPY[kind];
  const base = { title: copy.title, valueLabel: copy.valueLabel, rows: [] as FaceRow[] };
  const rule = { text: copy.rule, you: false };
  if (state.status === "loading")
    return {
      ...base,
      subtitle: "This week",
      notice: { tone: "loading", title: "Loading the board…", body: "" },
      footer: rule,
    };
  if (state.status === "offline")
    return {
      ...base,
      subtitle: "This week",
      notice: {
        tone: "offline",
        title: "Leaderboard offline",
        body: "Check back in a little while.",
      },
      footer: rule,
    };
  const lb = state.board;
  const rows = lb.rows.slice(0, FACE_ROWS).map((r): FaceRow => {
    const detail = kind === "xp" ? formatDays(r.activeDays) : formatVerified(r.verifiedMinutes);
    return {
      rank: r.rank,
      name: nameOf(r),
      value: kind === "focus" ? formatFocus(r.focusMinutes) : formatXp(r.xp),
      detail,
      detailVerified: kind === "focus" && detail !== null,
      isMe: r.isMe,
      isDemo: r.isDemo,
    };
  });
  const me = lb.me;
  const footer =
    !me || rows.some((r) => r.isMe)
      ? rule
      : !me.optedIn
        ? { text: "You're hidden from leaderboards", you: true }
        : me.rank !== null
          ? {
              text: `You: #${me.rank} · ${kind === "focus" ? youFocus(me) : formatXp(me.xp)}`,
              you: true,
            }
          : { text: copy.join, you: true };
  return {
    ...base,
    subtitle: `This week · ${formatRange(lb.from, lb.to, timeZone)}`,
    rows,
    notice:
      rows.length === 0
        ? { tone: "empty", title: "No one yet this week.", body: copy.empty }
        : null,
    footer,
  };
}

/* ---- Painting ---- */

const C = {
  felt: "#29483a",
  card: "#fffefa",
  muted: "#ede9df",
  walnut: "#1f1a16",
  ink: "#5f6158",
  tangerine: "#e07a3f",
  tangerineDeep: "#b9612f",
  sun: "#f2cf7e",
  leaf: "#7fb27a",
  /** Leaf, deep enough to read as small text on the cream card and on sun yellow. */
  leafInk: "#3d6b39",
  brass: "#b18a50",
  gold: "#f4c443",
  silver: "#dfe3e6",
  bronze: "#e09a5f",
};
const MEDALS: Record<number, string> = { 1: C.gold, 2: C.silver, 3: C.bronze };

export interface FaceFonts {
  /** Fredoka, for titles, names and numbers. */
  display: string;
  /** Nunito, for reading text. */
  ui: string;
}

function cssFont(variable: string, fallback: string) {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

export function faceFonts(): FaceFonts {
  return {
    display: cssFont("--font-cartoon", "ui-rounded, system-ui, sans-serif"),
    ui: cssFont("--font-nunito", "ui-rounded, system-ui, sans-serif"),
  };
}

let fontsLoading: Promise<void> | null = null;

/**
 * A canvas doesn't redraw when a web font arrives, and the browser only fetches one once it's
 * asked for: ask for every weight the face uses, then redraw when this resolves.
 */
export function loadFaceFonts(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return Promise.resolve();
  if (!fontsLoading) {
    const f = faceFonts();
    fontsLoading = Promise.all(
      [
        `700 64px ${f.display}`,
        `600 46px ${f.display}`,
        `800 34px ${f.ui}`,
        `700 26px ${f.ui}`,
      ].map((font) => document.fonts.load(font).catch(() => [])),
    ).then(
      () => document.fonts.ready.then(() => undefined),
      () => undefined,
    );
  }
  return fontsLoading;
}

type Ctx = CanvasRenderingContext2D;

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  c.roundRect(x, y, w, h, r);
}

/** A flat shape with a walnut outline and a hard "sticker" shadow under it. */
function sticker(
  c: Ctx,
  path: () => void,
  fill: string,
  { line = 8, drop = 8 }: { line?: number; drop?: number } = {},
) {
  if (drop) {
    c.save();
    c.translate(0, drop);
    path();
    c.fillStyle = C.walnut;
    c.fill();
    c.restore();
  }
  path();
  c.fillStyle = fill;
  c.fill();
  if (line) {
    c.lineWidth = line;
    c.strokeStyle = C.walnut;
    c.lineJoin = "round";
    c.stroke();
  }
}

/** Shortens `text` with an ellipsis until it fits `max` pixels. */
function fit(c: Ctx, text: string, max: number) {
  if (c.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && c.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

function wrap(c: Ctx, text: string, max: number) {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    const next = line ? `${line} ${word}` : word;
    if (line && c.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Right-aligned text whose digits all take the same width, so the columns line up. */
function drawTabular(c: Ctx, text: string, right: number, y: number) {
  const digit = Math.max(...[..."0123456789"].map((d) => c.measureText(d).width));
  const align = c.textAlign;
  c.textAlign = "center";
  let x = right;
  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i]!;
    const w = /\d/.test(ch) ? digit : c.measureText(ch).width;
    c.fillText(ch, x - w / 2, y);
    x -= w;
  }
  c.textAlign = align;
  return right - x;
}

function tabularWidth(c: Ctx, text: string) {
  const digit = Math.max(...[..."0123456789"].map((d) => c.measureText(d).width));
  return [...text].reduce((w, ch) => w + (/\d/.test(ch) ? digit : c.measureText(ch).width), 0);
}

/** A small rounded tag after a name ("You", "demo"); returns its width. */
function pill(c: Ctx, text: string, x: number, cy: number, you: boolean, fonts: FaceFonts) {
  c.font = you ? `600 27px ${fonts.display}` : `800 22px ${fonts.ui}`;
  const w = c.measureText(text).width + (you ? 30 : 24);
  const h = you ? 42 : 36;
  sticker(c, () => roundRect(c, x, cy - h / 2, w, h, h / 2), you ? C.walnut : C.muted, {
    line: you ? 0 : 3,
    drop: you ? 3 : 0,
  });
  c.fillStyle = you ? C.card : C.ink;
  c.textAlign = "center";
  c.fillText(text, x + w / 2, cy + 1);
  return w;
}

function star(c: Ctx, cx: number, cy: number, r: number) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.48 : r;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i) c.lineTo(x, y);
    else c.moveTo(x, y);
  }
  c.closePath();
}

function drawRibbon(c: Ctx, title: string, cy: number, fonts: FaceFonts) {
  let size = 66;
  c.font = `700 ${size}px ${fonts.display}`;
  while (size > 40 && c.measureText(title).width > 700) {
    size -= 2;
    c.font = `700 ${size}px ${fonts.display}`;
  }
  const w = Math.min(860, c.measureText(title).width + 130);
  const h = 116;
  const x = FACE_W / 2 - w / 2;
  // The ribbon's notched tails, tucked behind each end.
  for (const side of [-1, 1]) {
    const ex = side < 0 ? x + 28 : x + w - 28;
    const tx = ex + side * 70;
    sticker(
      c,
      () => {
        c.beginPath();
        c.moveTo(ex, cy - 22);
        c.lineTo(tx, cy - 22);
        c.lineTo(tx - side * 24, cy + 14);
        c.lineTo(tx, cy + 50);
        c.lineTo(ex, cy + 50);
        c.closePath();
      },
      C.tangerineDeep,
      { line: 7, drop: 6 },
    );
  }
  sticker(c, () => roundRect(c, x, cy - h / 2, w, h, h / 2), C.tangerine, { line: 8, drop: 8 });
  c.fillStyle = C.walnut;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.fillText(title, FACE_W / 2, cy + 3);
}

function drawNotice(c: Ctx, notice: NonNullable<FaceContent["notice"]>, fonts: FaceFonts) {
  const cy = 640;
  if (notice.tone === "empty") {
    sticker(c, () => star(c, FACE_W / 2, cy, 96), C.sun, { line: 9, drop: 9 });
  } else if (notice.tone === "offline") {
    sticker(
      c,
      () => {
        c.beginPath();
        c.arc(FACE_W / 2, cy, 82, 0, Math.PI * 2);
      },
      C.muted,
      { line: 9, drop: 9 },
    );
    c.font = `700 104px ${fonts.display}`;
    c.fillStyle = C.walnut;
    c.textAlign = "center";
    c.fillText("!", FACE_W / 2, cy + 6);
  } else {
    [C.sun, C.tangerine, C.leaf].forEach((fill, i) => {
      sticker(
        c,
        () => {
          c.beginPath();
          c.arc(FACE_W / 2 + (i - 1) * 96, cy, 30, 0, Math.PI * 2);
        },
        fill,
        { line: 7, drop: 6 },
      );
    });
  }
  c.textAlign = "center";
  c.fillStyle = C.walnut;
  c.font = `700 56px ${fonts.display}`;
  c.fillText(notice.title, FACE_W / 2, cy + 170);
  if (notice.body) {
    c.font = `800 38px ${fonts.ui}`;
    c.fillStyle = C.ink;
    wrap(c, notice.body, 720).forEach((line, i) => c.fillText(line, FACE_W / 2, cy + 240 + i * 50));
  }
}

/** Paints `face` over the whole canvas. */
export function drawLeaderboardFace(c: Ctx, face: FaceContent, fonts: FaceFonts = faceFonts()) {
  c.save();
  c.textBaseline = "middle";
  // Green felt, lightly flecked (the same flecks every time).
  c.fillStyle = C.felt;
  c.fillRect(0, 0, FACE_W, FACE_H);
  let seed = 7;
  c.fillStyle = "rgba(255, 255, 255, 0.05)";
  for (let i = 0; i < 1400; i++) {
    seed = (seed * 16807) % 2147483647;
    const x = (seed % 10000) / 10000;
    seed = (seed * 16807) % 2147483647;
    c.fillRect(x * FACE_W, ((seed % 10000) / 10000) * FACE_H, 3, 3);
  }

  // The card, pinned at its top corners.
  const card = { x: 52, y: 100, w: FACE_W - 104, h: FACE_H - 150 };
  sticker(c, () => roundRect(c, card.x, card.y, card.w, card.h, 46), C.card, {
    line: 11,
    drop: 14,
  });
  for (const px of [card.x + 52, card.x + card.w - 52]) {
    sticker(
      c,
      () => {
        c.beginPath();
        c.arc(px, card.y + 46, 17, 0, Math.PI * 2);
      },
      C.brass,
      { line: 5, drop: 4 },
    );
    c.fillStyle = "rgba(255, 255, 255, 0.55)";
    c.beginPath();
    c.arc(px - 5, card.y + 40, 5, 0, Math.PI * 2);
    c.fill();
  }

  drawRibbon(c, face.title, card.y + 2, fonts);
  c.textAlign = "center";
  c.fillStyle = C.ink;
  c.font = `800 35px ${fonts.ui}`;
  c.fillText(fit(c, face.subtitle, 800), FACE_W / 2, 222);

  if (face.notice) drawNotice(c, face.notice, fonts);
  else {
    const left = 100;
    const right = 924;
    const top = 330;
    const rowH = 106;
    // Column headings and a rule under them.
    c.font = `600 27px ${fonts.display}`;
    c.fillStyle = C.ink;
    c.textAlign = "center";
    c.fillText("Rank", 136, 290);
    c.textAlign = "left";
    c.fillText("Name", 206, 290);
    c.textAlign = "right";
    c.fillText(face.valueLabel, right - 6, 290);
    c.fillStyle = C.walnut;
    roundRect(c, left - 16, 314, right - left + 32, 5, 3);
    c.fill();

    face.rows.forEach((r, i) => {
      const cy = top + rowH * i + rowH / 2;
      if (r.isMe) {
        sticker(c, () => roundRect(c, left - 16, cy - 47, right - left + 32, 94, 26), C.sun, {
          line: 5,
          drop: 5,
        });
      } else if (i > 0 && !face.rows[i - 1]!.isMe) {
        c.fillStyle = "rgba(31, 26, 22, 0.12)";
        c.fillRect(left, top + rowH * i - 1, right - left, 3);
      }
      // Rank: a medal sticker for the top three.
      const medal = MEDALS[r.rank];
      if (medal) {
        sticker(
          c,
          () => {
            c.beginPath();
            c.arc(136, cy, 37, 0, Math.PI * 2);
          },
          medal,
          { line: 6, drop: 5 },
        );
      }
      c.textAlign = "center";
      c.fillStyle = medal || r.isMe ? C.walnut : C.ink;
      c.font = `${medal ? 700 : 600} ${r.rank > 99 ? 30 : 40}px ${fonts.display}`;
      c.fillText(String(r.rank), 136, cy + 2);

      // Value (and the small second line), right-aligned with even digits.
      c.font = `700 46px ${fonts.display}`;
      c.fillStyle = C.walnut;
      const valueY = r.detail ? cy - 13 : cy + 2;
      const valueW = tabularWidth(c, r.value);
      drawTabular(c, r.value, right - 6, valueY);
      let detailW = 0;
      if (r.detail) {
        c.font = `700 26px ${fonts.ui}`;
        c.fillStyle = r.detailVerified ? C.leafInk : r.isMe ? C.walnut : C.ink;
        detailW = tabularWidth(c, r.detail);
        drawTabular(c, r.detail, right - 6, cy + 29);
      }

      // Name, then the tags, in what's left.
      const tags = (r.isMe ? 96 : 0) + (r.isDemo ? 98 : 0);
      const nameMax = right - 6 - Math.max(valueW, detailW) - 36 - 206 - tags;
      c.font = `600 46px ${fonts.display}`;
      c.fillStyle = C.walnut;
      c.textAlign = "left";
      const name = fit(c, r.name, Math.max(80, nameMax));
      c.fillText(name, 206, cy + 2);
      let x = 206 + c.measureText(name).width + 16;
      if (r.isMe) x += pill(c, "You", x, cy, true, fonts) + 10;
      if (r.isDemo) pill(c, "demo", x, cy, false, fonts);
    });
  }

  // The footer: your standing (in walnut, on a sun pill) or how the board is ranked.
  const fy = card.y + card.h - 64;
  c.textAlign = "center";
  if (face.footer.you) {
    c.font = `700 34px ${fonts.display}`;
    const text = fit(c, face.footer.text, 760);
    const w = c.measureText(text).width + 56;
    sticker(c, () => roundRect(c, FACE_W / 2 - w / 2, fy - 30, w, 60, 30), C.sun, {
      line: 5,
      drop: 5,
    });
    c.fillStyle = C.walnut;
    c.fillText(text, FACE_W / 2, fy + 2);
  } else {
    c.font = `800 28px ${fonts.ui}`;
    c.fillStyle = C.ink;
    c.fillText(fit(c, face.footer.text, 780), FACE_W / 2, fy);
  }
  c.restore();
}
