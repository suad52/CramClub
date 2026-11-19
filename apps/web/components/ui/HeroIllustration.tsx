import { createRandom } from "@/lib/random";

const BOOK_COLORS = [
  "#8c3f3a",
  "#3f5f4a",
  "#34466a",
  "#c99a45",
  "#e6d8bd",
  "#4f7f7a",
  "#7a4a6a",
  "#a5643f",
];

/** Deterministic row of book spines for one shelf. */
function books(seed: number, x0: number, x1: number, baseY: number) {
  const rand = createRandom(seed);
  const out: { x: number; y: number; w: number; h: number; c: string }[] = [];
  let x = x0;
  while (x < x1 - 6) {
    const w = rand.range(5, 10);
    if (x + w > x1) break;
    const h = rand.range(26, 38);
    out.push({ x, y: baseY - h, w, h, c: rand.pick(BOOK_COLORS) });
    x += w + (rand.chance(0.08) ? rand.range(4, 10) : 0.8);
  }
  return out;
}

function Shelf({ x, seed }: { x: number; seed: number }) {
  const levels = [92, 142, 192, 242, 292];
  return (
    <g>
      <rect x={x} y={52} width={120} height={262} rx={4} fill="#6e4a33" />
      <rect x={x + 6} y={58} width={108} height={250} fill="#4f3424" />
      {levels.map((y, i) => (
        <g key={y}>
          {books(seed + i, x + 8, x + 112, y).map((b, j) => (
            <rect key={j} x={b.x} y={b.y} width={b.w} height={b.h} rx={1} fill={b.c} />
          ))}
          <rect x={x + 4} y={y} width={112} height={6} fill="#8a5c3c" />
        </g>
      ))}
    </g>
  );
}

/** A cozy library vignette for the landing page: tall windows, shelves and a lamp-lit table. */
export function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 640 420"
      role="img"
      aria-label="Illustration of a warm library interior with tall windows, bookshelves and a lamp-lit table"
      className="h-auto w-full"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a9c9e2" />
          <stop offset="1" stopColor="#fbe7c6" />
        </linearGradient>
        <linearGradient id="beam" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff2cf" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff2cf" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="lampGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#ffd99a" stopOpacity="0.85" />
          <stop offset="1" stopColor="#ffd99a" stopOpacity="0" />
        </radialGradient>
        <clipPath id="frame">
          <rect width="640" height="420" rx="28" />
        </clipPath>
      </defs>
      <g clipPath="url(#frame)">
        <rect width="640" height="420" fill="#efe3cc" />
        {/* Wainscot and floor */}
        <rect y="300" width="640" height="40" fill="#8a5c3c" />
        <rect y="336" width="640" height="84" fill="#b98250" />
        {Array.from({ length: 9 }, (_, i) => (
          <rect
            key={i}
            x={i * 78 - 20}
            y="336"
            width="2"
            height="84"
            fill="#9a6a43"
            opacity="0.6"
          />
        ))}
        {/* Windows */}
        {[220, 340].map((x) => (
          <g key={x}>
            <path d={`M${x} 280 V110 a40 40 0 0 1 80 0 V280 Z`} fill="url(#sky)" />
            <path
              d={`M${x} 280 V110 a40 40 0 0 1 80 0 V280 Z`}
              fill="none"
              stroke="#6e4a33"
              strokeWidth="8"
            />
            <path d={`M${x + 40} 70 V280 M${x} 175 H${x + 80}`} stroke="#6e4a33" strokeWidth="4" />
            <path d={`M${x} 280 L${x - 40} 420 H${x + 60} L${x + 80} 280 Z`} fill="url(#beam)" />
          </g>
        ))}
        <Shelf x={40} seed={7} />
        <Shelf x={480} seed={19} />
        {/* Table, lamp and books */}
        <ellipse cx="320" cy="300" rx="90" ry="70" fill="url(#lampGlow)" />
        <rect x="200" y="318" width="240" height="14" rx="4" fill="#9a6a43" />
        <rect x="214" y="332" width="12" height="70" fill="#6e4a33" />
        <rect x="414" y="332" width="12" height="70" fill="#6e4a33" />
        <rect x="316" y="282" width="6" height="36" fill="#c9a35a" />
        <rect x="302" y="314" width="34" height="5" rx="2" fill="#c9a35a" />
        <path d="M290 288 Q319 262 348 288 Z" fill="#3f6b4a" />
        <rect x="236" y="306" width="44" height="7" rx="1.5" fill="#8c3f3a" />
        <rect x="240" y="299" width="38" height="7" rx="1.5" fill="#e6d8bd" />
        <rect
          x="372"
          y="300"
          width="36"
          height="18"
          rx="2"
          fill="#fbf7ef"
          transform="rotate(-6 390 309)"
        />
      </g>
    </svg>
  );
}
