import type { Chunk } from "./schema";

/** Splits extracted pages into page-tagged chunks of about `size` characters (on paragraph/sentence breaks). */
export function chunkPages(pages: readonly string[], size = 1200): Chunk[] {
  const out: Chunk[] = [];
  pages.forEach((raw, i) => {
    const text = raw
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    let rest = text;
    while (rest.length > 0) {
      let cut = rest.length <= size ? rest.length : rest.lastIndexOf("\n", size);
      if (cut < size * 0.5) cut = rest.lastIndexOf(". ", size) + 1;
      if (cut < size * 0.5) cut = size;
      out.push({ page: i + 1, text: rest.slice(0, cut).trim() });
      rest = rest.slice(cut).trim();
    }
  });
  return out.filter((c) => c.text.length > 0);
}

const STOP = new Set(
  "a an and are as at be by can do does for from has have how i in is it its of on or that the this to was what when where which who why will with you your".split(
    " ",
  ),
);
const words = (s: string) =>
  s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/** The chunks most relevant to `query` (simple term overlap, good enough for one document). */
export function topChunks(chunks: readonly Chunk[], query: string, k = 6): Chunk[] {
  const q = new Set(words(query));
  if (q.size === 0) return chunks.slice(0, k);
  return chunks
    .map((c, i) => {
      const w = words(c.text);
      const hits = w.filter((x) => q.has(x)).length;
      // Covering more of the question's words matters most; frequency only breaks ties.
      const distinct = new Set(w.filter((x) => q.has(x))).size;
      return { c, i, score: distinct + (0.5 * hits) / Math.sqrt(w.length + 10) };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, k)
    .map((x) => x.c);
}

/** Caption timing: one segment per sentence, times in ms. */
export interface CaptionSegment {
  text: string;
  startMs: number;
  endMs: number;
}

export function splitSentences(text: string): string[] {
  return (text.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? [text])
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Estimated sentence timings when real alignment isn't available (about 15 characters a second). */
export function estimateCaptions(text: string, charsPerSecond = 15): CaptionSegment[] {
  let t = 0;
  return splitSentences(text).map((s) => {
    const d = Math.max(900, (s.length / charsPerSecond) * 1000);
    const seg = { text: s, startMs: t, endMs: t + d };
    t += d;
    return seg;
  });
}

/** Sentence captions from per-character timings (ElevenLabs "with timestamps" alignment). */
export function captionsFromAlignment(
  text: string,
  charStartsSec: readonly number[],
  charEndsSec: readonly number[],
): CaptionSegment[] {
  const out: CaptionSegment[] = [];
  let from = 0;
  for (const s of splitSentences(text)) {
    const at = text.indexOf(s, from);
    if (at < 0) continue;
    const end = at + s.length - 1;
    const start = charStartsSec[at];
    const stop = charEndsSec[Math.min(end, charEndsSec.length - 1)];
    if (start !== undefined && stop !== undefined) {
      out.push({ text: s, startMs: Math.round(start * 1000), endMs: Math.round(stop * 1000) });
    }
    from = end + 1;
  }
  return out;
}
