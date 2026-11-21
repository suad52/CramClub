import { NOTES_LIMITS } from "../types";

/**
 * Uploaded notes, before and after they reach the database: checking files, turning PDFs and text
 * files into pages, finding the links in them, and fitting them into a prompt. Pure (the PDF reader
 * is passed in), so all of it is unit-tested. TinyFish never sees the file: Gemini reads the notes,
 * and what it finds there decides what TinyFish looks up on the web.
 */

export class NotesError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "bad_request",
  ) {
    super(message);
    this.name = "NotesError";
  }
}

/** One uploaded file as text: page N of a PDF is pages[N - 1] (empty if it had no text). */
export interface NotesText {
  name: string;
  pages: string[];
}

/** A text file is cut into "pages" of about this many characters. */
export const PAGE_CHARS = 3000;
/** Less text than this in the whole upload means there is nothing to study from. */
export const MIN_NOTES_CHARS = 200;
/** At most this much text is kept from one upload (shared fairly between its files). */
export const MAX_STORED_CHARS = 200_000;
/** Links from the notes that TinyFish opens. */
export const MAX_NOTE_LINKS = 4;

/* ---- Text ---- */

/** Cuts a string to at most `n` UTF-16 units without splitting a surrogate pair. */
export function cut(s: string, n: number) {
  if (s.length <= n) return s;
  const code = s.charCodeAt(n - 1);
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n);
}

/**
 * Removes what Postgres can't store or a prompt doesn't need: NUL and other control characters,
 * and lone surrogates (they break JSON).
 */
export function cleanText(s: string) {
  return s
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

/** Splits text into pages of about `size` characters, breaking at paragraphs, lines or sentences. */
export function textPages(text: string, size = PAGE_CHARS): string[] {
  let rest = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const pages: string[] = [];
  while (rest.length > size) {
    const window = rest.slice(0, size);
    let at = -1;
    for (const sep of ["\n\n", "\n", ". ", " "]) {
      const i = window.lastIndexOf(sep);
      if (i >= size * 0.6) {
        at = i + sep.length;
        break;
      }
    }
    const page = at > 0 ? rest.slice(0, at) : cut(rest, size);
    pages.push(page.trim());
    rest = rest.slice(page.length).trimStart();
  }
  if (rest) pages.push(rest);
  return pages.filter(Boolean);
}

export const charCount = (pages: readonly string[]) => pages.reduce((n, p) => n + p.length, 0);

/* ---- Files ---- */

/** The file's own name, without folders or control characters. */
export function cleanName(raw: string) {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const name = base
    .replace(/[\u0000-\u001F\u007F<>"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cut(name, 200) || "notes";
}

export type NotesKind = "pdf" | "text";

export const kindOf = (name: string): NotesKind | null => {
  const ext = /\.[^.]+$/.exec(name.toLowerCase())?.[0] ?? "";
  if (!(NOTES_LIMITS.extensions as readonly string[]).includes(ext)) return null;
  return ext === ".pdf" ? "pdf" : "text";
};

const MB = Math.round(NOTES_LIMITS.maxBytes / 1024 / 1024);

/** Checks how many files there are, before reading any. */
export function checkCount(n: number) {
  if (n < 1) throw new NotesError("Choose a file of notes to upload (PDF, .txt or .md).");
  if (n > NOTES_LIMITS.maxFiles)
    throw new NotesError(
      `That's ${n} files. Upload up to ${NOTES_LIMITS.maxFiles} at a time, or combine them first.`,
    );
}

/** Checks one file's type and size, before reading it. */
export function checkFile(f: { name: string; size: number }): NotesKind {
  const kind = kindOf(f.name);
  if (!kind)
    throw new NotesError(
      `${f.name} isn't a PDF, .txt or .md file. Save or export your notes as one of those.`,
    );
  if (f.size === 0) throw new NotesError(`${f.name} is empty.`);
  if (f.size > NOTES_LIMITS.maxBytes)
    throw new NotesError(`${f.name} is over ${MB} MB. Try a smaller file.`, 413, "too_large");
  return kind;
}

export const isPdf = (bytes: Uint8Array) =>
  bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";

/** A .txt or .md file as text. Rejects anything that isn't UTF-8 text. */
export function decodeText(bytes: Uint8Array, name: string) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new NotesError(`${name} isn't UTF-8 text. Save it as plain text (UTF-8) and try again.`);
  }
  if (text.includes("\u0000")) throw new NotesError(`${name} doesn't look like a text file.`);
  return text;
}

/**
 * Reads one uploaded file into pages. PDFs go through `readPdf` (the Learning Studio's
 * extractor, which rejects scanned, protected or broken PDFs with a clear message).
 */
export async function readNotesFile(
  f: { name: string; bytes: Uint8Array },
  readPdf: (bytes: Uint8Array) => Promise<string[]>,
): Promise<NotesText> {
  if (kindOf(f.name) === "pdf") {
    if (!isPdf(f.bytes)) throw new NotesError(`${f.name} isn't a real PDF file.`);
    let pages: string[];
    try {
      pages = await readPdf(f.bytes);
    } catch (err) {
      // The extractor's own messages (scanned, password-protected, too many pages) are for the student.
      if (err instanceof Error && err.name === "StudioError")
        throw new NotesError(`${f.name}: ${err.message}`);
      throw err;
    }
    return { name: f.name, pages: pages.map((p) => cleanText(p).trim()) };
  }
  return { name: f.name, pages: textPages(cleanText(decodeText(f.bytes, f.name))) };
}

/** Splits a budget fairly: small items keep everything, the rest share what's left evenly. */
export function fairShares(sizes: readonly number[], budget: number) {
  const out = sizes.map(() => 0);
  let left = budget;
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[a]! - sizes[b]!);
  order.forEach((i, k) => {
    out[i] = Math.min(sizes[i]!, Math.floor(left / (order.length - k)));
    left -= out[i]!;
  });
  return out;
}

function keepChars(pages: readonly string[], n: number) {
  const out: string[] = [];
  for (const p of pages) {
    if (n <= 0) break;
    out.push(cut(p, n));
    n -= p.length;
  }
  return out;
}

/** Caps an upload's text at `max` characters, shared fairly between the files (first pages kept). */
export function capNotes(files: readonly NotesText[], max = MAX_STORED_CHARS) {
  const sizes = files.map((f) => charCount(f.pages));
  if (sizes.reduce((a, b) => a + b, 0) <= max) return { files: [...files], truncated: false };
  const shares = fairShares(sizes, max);
  return {
    files: files.map((f, i) => ({ name: f.name, pages: keepChars(f.pages, shares[i]!) })),
    truncated: true,
  };
}

/* ---- Links ---- */

/** Sites that sell or share answers, and social media: never recommended as study sources. */
const BLOCKED =
  /(^|\.)(chegg|coursehero|studocu|brainly|quizlet|scribd|pinterest|quora|numerade|facebook|instagram|tiktok|twitter|x|linkedin|reddit|threads)\./;

export const isBlockedSite = (domain: string) => BLOCKED.test(`.${domain}`);

export const domainOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** One URL per page: no fragments, tracking parameters or trailing slashes. */
export function normalizeUrl(url: string) {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()])
      if (/^(utm_|fbclid|gclid|ref$)/.test(k)) u.searchParams.delete(k);
    u.hostname = u.hostname.replace(/^www\./, "");
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

const count = (s: string, c: string) => s.split(c).length - 1;

/** Sentence punctuation after a link isn't part of it; a closing bracket only when unbalanced. */
function trimLink(raw: string) {
  let u = raw;
  for (;;) {
    const last = u.at(-1) ?? "";
    if (/[.,;:!?*_~'"]/.test(last)) u = u.slice(0, -1);
    else if (last === ")" && count(u, "(") < count(u, ")")) u = u.slice(0, -1);
    else if (last === "]" && count(u, "[") < count(u, "]")) u = u.slice(0, -1);
    else return u;
  }
}

/**
 * The web links in the notes that TinyFish may open: http(s) only, in the order they appear, one
 * per page, without answer-sharing or social sites, local addresses or embedded passwords.
 * `found` counts the usable ones (some may be past `max`), `blocked` the ones skipped as blocked.
 */
export function findLinks(text: string, max = MAX_NOTE_LINKS) {
  const seen = new Set<string>();
  const links: string[] = [];
  let blocked = 0;
  for (const m of text.matchAll(/\bhttps?:\/\/[^\s<>"'`{}|\\^]+/gi)) {
    let u: URL;
    try {
      u = new URL(trimLink(m[0]));
    } catch {
      continue;
    }
    const host = u.hostname;
    if (
      u.username ||
      u.password ||
      !host.includes(".") ||
      /^[\d.]+$/.test(host) ||
      host.startsWith("[") ||
      /(^|\.)(localhost|local|internal)$/.test(host)
    )
      continue;
    const key = normalizeUrl(u.toString());
    if (seen.has(key)) continue;
    seen.add(key);
    if (isBlockedSite(domainOf(u.toString()))) blocked++;
    else links.push(u.toString());
  }
  return { links: links.slice(0, max), found: links.length, blocked };
}

/* ---- Notes in prompts ---- */

/** A piece of the notes, small enough for a prompt "page". */
export interface NotesPart {
  file: string;
  pdf: boolean;
  /** Page in the file (a PDF's real page; a text file's ~3000-character part). */
  page: number;
  pageCount: number;
  /** Long pages are split: part `part` of `parts`. */
  part: number;
  parts: number;
  text: string;
}

/** Every non-empty page of the notes, in order, with long pages split into parts. */
export function notesParts(files: readonly NotesText[], maxPart = PAGE_CHARS + 500): NotesPart[] {
  return files.flatMap((f) => {
    const pdf = kindOf(f.name) === "pdf";
    return f.pages.flatMap((p, i) => {
      const pieces = p.trim().length < 20 ? [] : p.length > maxPart ? textPages(p, maxPart) : [p];
      return pieces.map((text, j) => ({
        file: f.name,
        pdf,
        page: i + 1,
        pageCount: f.pages.length,
        part: j + 1,
        parts: pieces.length,
        text,
      }));
    });
  });
}

/** How a part is cited: "Your notes: lecture3.pdf, p. 4" (url "", since it isn't a link). */
export function notesLabel(p: NotesPart) {
  const where = p.pdf ? `, p. ${p.page}` : p.pageCount > 1 ? `, part ${p.page}` : "";
  return `Your notes: ${p.file}${where}${p.parts > 1 ? ` (${p.part}/${p.parts})` : ""}`;
}

/** The shortest a part gets before whole parts are left out instead. */
const MIN_PART_CHARS = 500;

/**
 * Fits the parts into `budget` characters, in order. If trimming every part would leave too
 * little of each, parts spread evenly through the notes are kept instead (`sampled`).
 */
export function budgetParts(parts: readonly NotesPart[], budget: number) {
  const total = parts.reduce((n, p) => n + p.text.length, 0);
  if (total <= budget) return { parts: [...parts], sampled: false };
  let keep = [...parts];
  if (budget / parts.length < MIN_PART_CHARS) {
    const k = Math.max(1, Math.floor(budget / MIN_PART_CHARS));
    const picks = new Set(
      Array.from({ length: k }, (_, j) =>
        k === 1 ? 0 : Math.round((j * (parts.length - 1)) / (k - 1)),
      ),
    );
    keep = parts.filter((_, i) => picks.has(i));
  }
  const shares = fairShares(
    keep.map((p) => p.text.length),
    budget,
  );
  return {
    parts: keep.map((p, i) => ({ ...p, text: cut(p.text, shares[i]!).trim() })),
    sampled: keep.length < parts.length,
  };
}

const STOP = new Set(
  "about after also and are between does from have how into its more not only over than that the their them then there these they this what when where which while with without".split(
    " ",
  ),
);

/**
 * The `n` texts that say most about the notes' gaps (by how often the gaps' words appear, each
 * capped so one repeated word can't win), best first; ties keep their order. Returns indexes.
 */
export function pickForGaps(texts: readonly string[], gaps: readonly string[], n: number) {
  const terms = [
    ...new Set(
      gaps
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9-]+/)
        .flatMap((w) => [w, ...w.split("-")])
        .filter((w) => w.length >= 4 && !STOP.has(w)),
    ),
  ];
  const score = (t: string) => {
    const words = t.toLowerCase().split(/[^a-z0-9-]+/);
    return terms.reduce((s, term) => s + Math.min(5, words.filter((w) => w === term).length), 0);
  };
  return texts
    .map((t, i) => ({ i, s: terms.length ? score(t) : 0 }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, n)
    .map(({ i }) => i);
}

/* ---- What the Librarian says ---- */

/** "A", "A and B", "A, B and C". */
export function listJoin(items: readonly string[]) {
  const xs = items.map((s) => s.trim()).filter(Boolean);
  return xs.length <= 2 ? xs.join(" and ") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`;
}

/** Her reply once Gemini has read the notes: what they cover and what TinyFish will look up. */
export function notesReply(
  a: { topic: string; outline: { heading: string }[]; gaps: string[] },
  links: number,
) {
  // Section headings keep their own capitals ("Krebs cycle"), so they're quoted, not run into the sentence.
  const covers =
    listJoin(
      a.outline
        .map((s) => s.heading.trim())
        .filter(Boolean)
        .slice(0, 3)
        .map((h) => `“${h}”`),
    ) || a.topic;
  const thin = listJoin(a.gaps.slice(0, 2));
  const open = links ? `open the ${links === 1 ? "link" : `${links} links`} in them and ` : "";
  const look = thin
    ? `look for sources on ${thin}, where they're thin`
    : `find sources that take ${a.topic} further`;
  return `Your notes cover ${covers}. I'll ${open}${look}.`;
}

/** The activity line for an uploaded file (its text was extracted when it was uploaded). */
export function readLabel(f: NotesText) {
  if (kindOf(f.name) === "pdf")
    return `Read ${f.name} · ${f.pages.length} ${f.pages.length === 1 ? "page" : "pages"}`;
  const words = f.pages.join(" ").split(/\s+/).filter(Boolean).length;
  return `Read ${f.name} · ${words.toLocaleString("en-US")} ${words === 1 ? "word" : "words"}`;
}
