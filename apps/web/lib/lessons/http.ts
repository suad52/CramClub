/**
 * Small pure helpers for the cloud lessons API (app/api/lessons): byte ranges for streaming
 * narration from the local storage driver, and the scene number in an audio URL.
 */

export type ByteRange = { start: number; end: number };

/**
 * One `Range: bytes=…` request against a file of `size` bytes: the inclusive range to send, null
 * when there's no usable Range (send the whole file), or "unsatisfiable" (answer 416). Several
 * ranges in one header aren't supported (browsers' audio elements never ask for them): the first
 * is served.
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | "unsatisfiable" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (!a && !b) return null;
  if (size <= 0) return "unsatisfiable";
  let start: number;
  let end: number;
  if (!a) {
    // "bytes=-500": the last 500 bytes.
    const tail = Number(b);
    if (tail === 0) return "unsatisfiable";
    start = Math.max(0, size - tail);
    end = size - 1;
  } else {
    start = Number(a);
    end = b ? Math.min(Number(b), size - 1) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return "unsatisfiable";
  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/** A scene number from a URL segment ("0", "12"): a small whole number, or null. */
export function sceneParam(value: string | undefined): number | null {
  if (!value || !/^\d{1,3}$/.test(value)) return null;
  return Number(value);
}
