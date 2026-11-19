import { createRandom } from "@/lib/random";
import type { Point } from "./types";

/**
 * Single-line ("engraving") fonts: every letter is a pen path rather than a filled outline, so an
 * answer can be written out stroke by stroke like real handwriting.
 *
 * OVR uses EMS Tech (SIL Open Font License; by Sheldon B. Michaels and Windell H. Oskay, derived
 * from Kimberly Geswein's "Architects Daughter"), shipped as an SVG font by the `hersheytext`
 * package and copied to /fonts/ems-tech.svg by scripts/copy-assets.mjs.
 */

type Polyline = [number, number][];

export interface StrokeGlyph {
  /** Horizontal advance, in font units. */
  adv: number;
  /** Pen paths in font units, y up from the baseline, in drawing order. */
  strokes: Polyline[];
}

export interface StrokeFont {
  unitsPerEm: number;
  capHeight: number;
  xHeight: number;
  defaultAdv: number;
  glyphs: Map<string, StrokeGlyph>;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n =
        code[1] === "x" || code[1] === "X"
          ? parseInt(code.slice(2), 16)
          : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];

/** Parses SVG path data made of M/L/C commands (absolute or relative) into polylines. */
export function parsePath(d: string, curveSteps = 8): Polyline[] {
  const tokens = d.match(/[MLCmlc]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const paths: Polyline[] = [];
  let current: Polyline | null = null;
  let cmd = "M";
  let x = 0;
  let y = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[MLCmlc]/.test(t)) {
      cmd = t;
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (cmd === "M" || cmd === "m") {
      x = ox + num();
      y = oy + num();
      current = [[x, y]];
      paths.push(current);
      cmd = rel ? "l" : "L"; // extra pairs after M are line-tos
    } else if (cmd === "L" || cmd === "l") {
      x = ox + num();
      y = oy + num();
      if (!current) paths.push((current = []));
      current.push([x, y]);
    } else {
      const c1x = ox + num();
      const c1y = oy + num();
      const c2x = ox + num();
      const c2y = oy + num();
      const ex = ox + num();
      const ey = oy + num();
      if (!current) paths.push((current = [[x, y]]));
      for (let s = 1; s <= curveSteps; s++) {
        const u = s / curveSteps;
        const a = (1 - u) ** 3;
        const b = 3 * (1 - u) ** 2 * u;
        const c = 3 * (1 - u) * u ** 2;
        const e = u ** 3;
        current.push([a * x + b * c1x + c * c2x + e * ex, a * y + b * c1y + c * c2y + e * ey]);
      }
      x = ex;
      y = ey;
    }
  }
  return paths.filter((p) => p.length > 0);
}

/** Symbols EMS Tech lacks, drawn in the same spirit (font units, cap height ≈ 500). */
function extraGlyphs(): Record<string, StrokeGlyph> {
  return {
    "√": {
      adv: 520,
      strokes: [
        [
          [40, 260],
          [110, 300],
          [200, 20],
          [300, 640],
          [520, 640],
        ],
      ],
    },
    π: {
      adv: 470,
      strokes: [
        [
          [40, 300],
          [440, 310],
        ],
        [
          [150, 305],
          [130, 0],
        ],
        [
          [330, 305],
          [350, 60],
          [400, 0],
        ],
      ],
    },
    "−": {
      adv: 420,
      strokes: [
        [
          [60, 250],
          [370, 255],
        ],
      ],
    },
    "→": {
      adv: 560,
      strokes: [
        [
          [40, 250],
          [500, 255],
        ],
        [
          [380, 360],
          [505, 255],
          [385, 150],
        ],
      ],
    },
    "←": {
      adv: 560,
      strokes: [
        [
          [520, 250],
          [60, 255],
        ],
        [
          [180, 360],
          [55, 255],
          [175, 150],
        ],
      ],
    },
    "≈": {
      adv: 460,
      strokes: [
        [
          [50, 300],
          [140, 350],
          [230, 300],
          [320, 260],
          [410, 310],
        ],
        [
          [50, 170],
          [140, 220],
          [230, 170],
          [320, 130],
          [410, 180],
        ],
      ],
    },
    "≤": {
      adv: 440,
      strokes: [
        [
          [380, 470],
          [70, 330],
          [380, 190],
        ],
        [
          [70, 90],
          [385, 90],
        ],
      ],
    },
    "≥": {
      adv: 440,
      strokes: [
        [
          [70, 470],
          [380, 330],
          [70, 190],
        ],
        [
          [70, 90],
          [385, 90],
        ],
      ],
    },
    "≠": {
      adv: 440,
      strokes: [
        [
          [60, 310],
          [380, 315],
        ],
        [
          [60, 190],
          [380, 195],
        ],
        [
          [300, 420],
          [140, 80],
        ],
      ],
    },
    "∞": {
      adv: 620,
      strokes: [
        [
          [310, 250],
          [230, 340],
          [110, 350],
          [50, 250],
          [110, 150],
          [230, 160],
          [310, 250],
          [390, 340],
          [510, 350],
          [570, 250],
          [510, 150],
          [390, 160],
          [310, 250],
        ],
      ],
    },
  };
}

/** Parses an SVG font (as shipped with hersheytext) into stroke glyphs. */
export function parseSvgFont(svg: string): StrokeFont {
  const face = /<font-face[^>]*>/.exec(svg)?.[0] ?? "";
  const font = /<font\s[^>]*>/.exec(svg)?.[0] ?? "";
  const glyphs = new Map<string, StrokeGlyph>();
  for (const [tag] of svg.matchAll(/<glyph\s[^>]*\/?>/g)) {
    const unicode = attr(tag, "unicode");
    if (unicode === undefined) continue;
    const ch = decodeEntities(unicode);
    const adv = Number(attr(tag, "horiz-adv-x") ?? attr(font, "horiz-adv-x") ?? 500);
    const d = attr(tag, "d");
    glyphs.set(ch, { adv, strokes: d ? parsePath(d) : [] });
  }
  for (const [ch, g] of Object.entries(extraGlyphs())) if (!glyphs.has(ch)) glyphs.set(ch, g);
  // The declared metrics don't always match the drawn letters (EMS Tech says 500, but its
  // capitals reach ~680), so measure the real heights from "H" and "x" when they exist.
  const top = (ch: string) => {
    const ys =
      glyphs
        .get(ch)
        ?.strokes.flat()
        .map(([, y]) => y) ?? [];
    return ys.length > 0 ? Math.max(...ys) : undefined;
  };
  return {
    unitsPerEm: Number(attr(face, "units-per-em") ?? 1000),
    capHeight: top("H") ?? Number(attr(face, "cap-height") ?? 500),
    xHeight: top("x") ?? Number(attr(face, "x-height") ?? 300),
    defaultAdv: Number(attr(font, "horiz-adv-x") ?? 400),
    glyphs,
  };
}

/** Characters the font lacks, swapped for close equivalents it has. */
const SUBSTITUTES: Record<string, string> = { "∙": "·", "⋅": "·", "‘": "'", "’": "'", " ": " " };

function glyphFor(font: StrokeFont, ch: string): StrokeGlyph | undefined {
  return (
    font.glyphs.get(ch) ??
    font.glyphs.get(SUBSTITUTES[ch] ?? "") ??
    font.glyphs.get(ch.normalize("NFD")[0] ?? "")
  );
}

/** How the writing should look: capital height and line spacing follow the user's handwriting. */
export interface WritingStyle {
  /** Line height used to plan the answer area (≈ 1.3 × the height of capitals and digits). */
  lineHeight: number;
  /** Seed for the small wobbles that keep it from looking typeset. */
  seed: number;
}

const capHeightOf = (style: WritingStyle) => style.lineHeight / 1.3;

/** Width of one line of text in board units, before any squeezing. */
export function measureLine(font: StrokeFont, line: string, style: WritingStyle): number {
  const s = capHeightOf(style) / font.capHeight;
  let w = 0;
  for (const ch of line) w += (glyphFor(font, ch)?.adv ?? font.defaultAdv * 0.6) * s;
  return w;
}

/** Re-samples a polyline so points are about `spacing` apart (smooth ink, even animation). */
function resample(points: [number, number][], spacing: number): [number, number][] {
  if (points.length < 2) return points;
  const out: [number, number][] = [points[0]!];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [ax, ay] = points[i - 1]!;
    const [bx, by] = points[i]!;
    const len = Math.hypot(bx - ax, by - ay);
    let t = spacing - carry;
    while (t <= len) {
      out.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]);
      t += spacing;
    }
    carry = len - (t - spacing);
  }
  const last = points[points.length - 1]!;
  const end = out[out.length - 1]!;
  if (end[0] !== last[0] || end[1] !== last[1]) out.push(last);
  return out;
}

export interface WrittenStroke {
  points: Point[];
  /** Index of the line this stroke belongs to (for pauses between lines). */
  line: number;
  /** True for the first stroke of a word (for pauses between words). */
  wordStart: boolean;
}

/**
 * Lays out lines of text as pen strokes inside `area` (board units), in writing order: line by
 * line, letter by letter, each letter's strokes in the font's order. Lines that are too wide are
 * squeezed horizontally to fit. Small seeded wobbles in baseline, size and slant make it read as
 * handwriting rather than type.
 */
export function layoutStrokes(
  font: StrokeFont,
  lines: readonly string[],
  area: { x: number; y: number; w: number },
  style: WritingStyle,
): WrittenStroke[] {
  const rand = createRandom(style.seed);
  const capH = capHeightOf(style);
  const s = capH / font.capHeight;
  const out: WrittenStroke[] = [];
  const pad = style.lineHeight * 0.2;
  lines.forEach((line, li) => {
    const natural = measureLine(font, line, style);
    const squeeze = Math.min(1, (area.w - 2 * pad) / Math.max(1, natural));
    const baseline = area.y + style.lineHeight * 0.25 + capH + li * style.lineHeight * 1.2;
    let x = area.x + pad;
    let wordStart = true;
    for (const ch of line) {
      const glyph = glyphFor(font, ch);
      const adv = (glyph?.adv ?? font.defaultAdv * 0.6) * s * squeeze;
      if (ch === " " || !glyph) {
        x += adv;
        wordStart = true;
        continue;
      }
      // Per-letter wobble: a touch of size, lift and slant variation.
      const k = s * (1 + rand.range(-0.04, 0.04));
      const lift = rand.range(-0.035, 0.035) * capH;
      const slant = rand.range(-0.03, 0.04);
      glyph.strokes.forEach((stroke, si) => {
        const pts = stroke.map(([gx, gy]): [number, number] => {
          const px = x + (gx * k + gy * k * slant) * squeeze;
          const py = baseline - gy * k + lift;
          return [px, py];
        });
        const dense = resample(pts, Math.max(1.5, capH / 40));
        out.push({
          points: dense.map(([px, py]) => [
            px + rand.range(-0.4, 0.4),
            py + rand.range(-0.4, 0.4),
            0.5,
          ]),
          line: li,
          wordStart: wordStart && si === 0,
        });
      });
      wordStart = false;
      x += adv;
    }
  });
  return out;
}

let cached: Promise<StrokeFont> | null = null;

/** Loads EMS Tech once (browser only). */
export function loadStrokeFont(url = "/fonts/ems-tech.svg"): Promise<StrokeFont> {
  cached ??= fetch(url)
    .then((r) => {
      if (!r.ok) throw new Error(`Couldn't load the handwriting font (${r.status})`);
      return r.text();
    })
    .then(parseSvgFont)
    .catch((err) => {
      cached = null;
      throw err;
    });
  return cached;
}
