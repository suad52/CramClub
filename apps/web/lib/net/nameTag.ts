import { CanvasTexture, SRGBColorSpace } from "three";
import type { StudyStatus } from "@ovr/shared";
import { type FaceFonts, faceFonts } from "@/lib/world/leaderboardFace";

/*
 * The cartoon name tag over another player's head: a cream sticker with a walnut outline and a
 * hard drop shadow (the HUD's look), a study-status dot, then their first name. Guests get a
 * paler sticker and softer ink, so a signed-in name reads as the "real" one at a glance.
 */

export const TAG_PX = { w: 512, h: 136 } as const;

const C = {
  card: "#fffefa",
  guest: "#ede9df",
  walnut: "#1f1a16",
  inkSoft: "#5f6158",
};

export const STATUS_DOT: Record<StudyStatus, string> = {
  available: "#7fb27a",
  focused: "#e07a3f",
  collaborating: "#f2cf7e",
  away: "#bcb3a3",
};

export interface TagFace {
  name: string;
  status: StudyStatus;
  signedIn: boolean;
}

type Ctx = CanvasRenderingContext2D;

function fitName(c: Ctx, text: string, family: string, max: number) {
  let size = 58;
  c.font = `600 ${size}px ${family}`;
  while (size > 36 && c.measureText(text).width > max) {
    size -= 2;
    c.font = `600 ${size}px ${family}`;
  }
  if (c.measureText(text).width <= max) return text;
  let out = text;
  while (out.length > 1 && c.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

export function drawNameTag(c: Ctx, face: TagFace, fonts: FaceFonts = faceFonts()) {
  const { w, h } = TAG_PX;
  c.clearRect(0, 0, w, h);
  const line = 7;
  const drop = 7;
  const pillH = 92;
  const dot = 30;
  const padL = 26;
  const gap = 16;
  const padR = 32;
  const name = fitName(c, face.name, fonts.display, w - padL - dot - gap - padR - line * 2);
  const textW = c.measureText(name).width;
  const pillW = Math.min(w - line * 2, padL + dot + gap + textW + padR);
  const x = (w - pillW) / 2;
  const y = (h - pillH - drop) / 2;
  const pill = () => {
    c.beginPath();
    c.roundRect(x, y, pillW, pillH, pillH / 2);
  };
  // Hard sticker shadow, then the sticker.
  c.save();
  c.translate(0, drop);
  pill();
  c.fillStyle = C.walnut;
  c.fill();
  c.restore();
  pill();
  c.fillStyle = face.signedIn ? C.card : C.guest;
  c.fill();
  c.lineWidth = line;
  c.strokeStyle = C.walnut;
  c.lineJoin = "round";
  c.stroke();
  // Status dot.
  const cx = x + padL + dot / 2;
  const cy = y + pillH / 2;
  c.beginPath();
  c.arc(cx, cy, dot / 2, 0, Math.PI * 2);
  c.fillStyle = STATUS_DOT[face.status];
  c.fill();
  c.lineWidth = 5;
  c.stroke();
  // Name.
  c.fillStyle = face.signedIn ? C.walnut : C.inkSoft;
  c.textBaseline = "middle";
  c.textAlign = "left";
  c.fillText(name, cx + dot / 2 + gap, cy + 3);
}

/** A texture for one tag (repainted in place when the name, status or fonts change). */
export function createTagTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = TAG_PX.w;
  canvas.height = TAG_PX.h;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function paintTag(texture: CanvasTexture, face: TagFace) {
  const ctx = (texture.image as HTMLCanvasElement).getContext("2d");
  if (!ctx) return;
  drawNameTag(ctx, face);
  texture.needsUpdate = true;
}
