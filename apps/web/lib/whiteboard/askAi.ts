import { type AnswerPlan, union } from "./geometry";
import { chooseAspectRatio, extractInk, inkCoverage } from "./ink";
import { type ImageCache, renderRegion } from "./render";
import type { BoardItem, Rect } from "./types";

/** Client side of "Ask AI": snapshots board regions and talks to the /api/ai/whiteboard routes. */

export interface Solution {
  readable: boolean;
  question: string;
  answer: string;
  lines: string[];
}

export class AskAiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AskAiError";
  }
}

/** The server gives up on Gemini before this, so it only catches a stuck connection. */
const REQUEST_TIMEOUT_MS = 90_000;

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") {
      throw new AskAiError(
        "timeout",
        "The librarian took too long to answer. Try again in a moment.",
      );
    }
    if ((err as Error).name === "AbortError") throw err;
    throw new AskAiError(
      "network",
      "Couldn't reach the server. Check your connection and try again.",
    );
  }
  const data = (await res.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  if (!res.ok) {
    throw new AskAiError(
      data?.error?.code ?? "ai_error",
      data?.error?.message ?? "Something went wrong.",
    );
  }
  return data as T;
}

/** Renders a board region to a PNG data URL whose longest side is at most `maxPx`. */
async function snapshot(
  items: readonly BoardItem[],
  images: ImageCache,
  region: Rect,
  maxPx = 1024,
): Promise<{ dataUrl: string; scale: number; width: number; height: number }> {
  await images.ready(items);
  const scale = Math.min(maxPx / region.w, maxPx / region.h, 2);
  const width = Math.max(1, Math.round(region.w * scale));
  const height = Math.max(1, Math.round(region.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  renderRegion(canvas.getContext("2d")!, items, images, region, width, height);
  return { dataUrl: canvas.toDataURL("image/png"), scale, width, height };
}

const pad = (r: Rect, p: number): Rect => ({
  x: r.x - p,
  y: r.y - p,
  w: r.w + 2 * p,
  h: r.h + 2 * p,
});

/** Step 1: read the question inside `selection` and get an answer. */
export async function solveSelection(
  items: readonly BoardItem[],
  images: ImageCache,
  selection: Rect,
  signal?: AbortSignal,
): Promise<Solution> {
  const shot = await snapshot(items, images, pad(selection, 12), 1024);
  return postJson<Solution>("/api/ai/whiteboard/solve", { image: shot.dataUrl }, signal);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new AskAiError("ai_error", "The handwriting image couldn't be read."));
    img.src = src;
  });
}

/**
 * Step 2: send the question plus a blank answer area to the image model, which writes the answer
 * in the student's handwriting. Only the new ink inside the answer area is kept, recoloured to the
 * student's pen colour on a transparent background, so it sits on the board like real writing.
 * Returns null if the model didn't write anything usable.
 */
export async function handwriteSolution(
  args: {
    items: readonly BoardItem[];
    images: ImageCache;
    selection: Rect;
    plan: AnswerPlan;
    lines: readonly string[];
    inkColor: string;
  },
  signal?: AbortSignal,
): Promise<{ src: string; rect: Rect } | null> {
  const { items, images, selection, plan, lines, inkColor } = args;
  const content = pad(union(selection, plan.rect), 16);
  // Grow the region (never crop) to an aspect ratio the image model supports.
  const fit = chooseAspectRatio(content.w, content.h);
  const region: Rect = { x: content.x, y: content.y, w: fit.width, h: fit.height };
  const shot = await snapshot(items, images, region, 1024);

  const { image } = await postJson<{ image: string }>(
    "/api/ai/whiteboard/handwrite",
    { image: shot.dataUrl, lines, placement: plan.placement, inkColor, aspectRatio: fit.ratio },
    signal,
  );

  // Bring the model's image back to the exact size we sent, then lift out the answer's ink.
  const generated = await loadImage(image);
  const canvas = document.createElement("canvas");
  canvas.width = shot.width;
  canvas.height = shot.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(generated, 0, 0, shot.width, shot.height);
  const pixels = ctx.getImageData(0, 0, shot.width, shot.height);
  const area = {
    x: (plan.rect.x - region.x) * shot.scale,
    y: (plan.rect.y - region.y) * shot.scale,
    w: plan.rect.w * shot.scale,
    h: plan.rect.h * shot.scale,
  };
  const ink = extractInk(
    { data: pixels.data, width: shot.width, height: shot.height },
    area,
    inkColor,
  );
  if (inkCoverage(ink, shot.width, area) < 0.002) return null;

  ctx.putImageData(new ImageData(ink, shot.width, shot.height), 0, 0);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(area.w));
  out.height = Math.max(1, Math.round(area.h));
  out
    .getContext("2d")!
    .drawImage(canvas, area.x, area.y, area.w, area.h, 0, 0, out.width, out.height);
  return { src: out.toDataURL("image/png"), rect: plan.rect };
}
