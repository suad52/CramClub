import { CanvasTexture, SRGBColorSpace } from "three";
import { type FaceFonts, faceFonts } from "@/lib/world/leaderboardFace";
import { type BubbleFace, wrapText } from "./format";

/*
 * The speech bubble over someone's head in the 3D library (components/world/ChatBubbles.tsx):
 * their latest chat line on a cream sticker with a walnut outline, a hard drop shadow and a tail
 * pointing down at them (the name tag's look, lib/net/nameTag.ts), or three dots while they're
 * typing. Drawn at the bottom of its canvas, so a sprite anchored at its bottom edge sits the
 * tail right over the name tag. Repainted only when what it shows changes.
 */

export const BUBBLE_PX = { w: 640, h: 300 } as const;

const C = {
  card: "#fffefa",
  walnut: "#1f1a16",
  dot: "#bcb3a3",
};

const LINE = 6;
const DROP = 7;
const TAIL_W = 36;
const TAIL_H = 24;
const FONT_PX = 38;
const LINE_H = 48;
const PAD_X = 28;
const PAD_Y = 16;
const MAX_LINES = 3;

type Ctx = CanvasRenderingContext2D;

/** A rounded box with a tail at the middle of its bottom edge, as one outline. */
function bubblePath(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  const cx = x + w / 2;
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(cx + TAIL_W / 2, y + h);
  c.lineTo(cx, y + h + TAIL_H);
  c.lineTo(cx - TAIL_W / 2, y + h);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

function sticker(c: Ctx, x: number, y: number, w: number, h: number, r: number) {
  c.save();
  c.translate(0, DROP);
  bubblePath(c, x, y, w, h, r);
  c.fillStyle = C.walnut;
  c.fill();
  c.restore();
  bubblePath(c, x, y, w, h, r);
  c.fillStyle = C.card;
  c.fill();
  c.lineWidth = LINE;
  c.lineJoin = "round";
  c.strokeStyle = C.walnut;
  c.stroke();
}

export function drawBubble(c: Ctx, face: BubbleFace, fonts: FaceFonts = faceFonts()) {
  const { w, h } = BUBBLE_PX;
  c.clearRect(0, 0, w, h);
  const bottom = h - DROP - TAIL_H - LINE;
  if (face.kind === "typing") {
    const bw = 172;
    const bh = 78;
    const x = (w - bw) / 2;
    const y = bottom - bh;
    sticker(c, x, y, bw, bh, bh / 2);
    for (let i = 0; i < 3; i++) {
      const on = i === face.dot;
      c.beginPath();
      c.arc(w / 2 + (i - 1) * 40, y + bh / 2 - (on ? 5 : 0), on ? 13 : 11, 0, Math.PI * 2);
      c.fillStyle = on ? C.walnut : C.dot;
      c.fill();
    }
    return;
  }
  c.font = `700 ${FONT_PX}px ${fonts.ui}`;
  const maxText = w - (PAD_X + LINE) * 2;
  const lines = wrapText((s) => c.measureText(s).width, face.text, maxText, MAX_LINES);
  const textW = Math.max(0, ...lines.map((l) => c.measureText(l).width));
  const bw = Math.max(TAIL_W + 64, Math.min(w - LINE * 2, textW + PAD_X * 2));
  const bh = lines.length * LINE_H + PAD_Y * 2;
  const x = (w - bw) / 2;
  const y = bottom - bh;
  sticker(c, x, y, bw, bh, Math.min(30, bh / 2));
  c.fillStyle = C.walnut;
  c.textAlign = "center";
  c.textBaseline = "middle";
  lines.forEach((line, i) => c.fillText(line, w / 2, y + PAD_Y + LINE_H * (i + 0.5) + 2));
}

/** A texture for one bubble (repainted in place). */
export function createBubbleTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = BUBBLE_PX.w;
  canvas.height = BUBBLE_PX.h;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function paintBubble(texture: CanvasTexture, face: BubbleFace) {
  const ctx = (texture.image as HTMLCanvasElement).getContext("2d");
  if (!ctx) return;
  drawBubble(ctx, face);
  texture.needsUpdate = true;
}
