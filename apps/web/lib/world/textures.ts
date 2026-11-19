import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import { SPAWN_POINTS, ZONES } from "@ovr/shared";
import { createRandom } from "@/lib/random";
import { PALETTE } from "./palette";

/**
 * Procedural textures drawn on canvases at runtime: floor planks, rugs, signage and the notice
 * boards. No image downloads, and everything stays editable in code.
 */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function cssFont(variable: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

export const displayFont = () => cssFont("--font-fraunces", "Georgia, serif");
export const uiFont = () => cssFont("--font-nunito", "system-ui, sans-serif");

/** Creates a texture and redraws it once web fonts finish loading, so signs never stick on a fallback font. */
export function canvasTexture(
  width: number,
  height: number,
  draw: Draw,
  opts: { repeat?: [number, number] } = {},
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  if (opts.repeat) {
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.repeat.set(...opts.repeat);
  }
  const paint = () => {
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height);
    texture.needsUpdate = true;
  };
  paint();
  void document.fonts?.ready.then(paint);
  return texture;
}

/** Warm oak planks running north–south. One tile covers 4 m × 4 m. */
export function drawFloor(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const rand = createRandom(99);
  const tones = ["#b98250", "#c08a58", "#ad7849", "#b67d4b", "#c3915e", "#a8744a"];
  const plankW = w / 22;
  for (let col = 0; col < 22; col++) {
    let y = -rand.range(0, h * 0.5);
    while (y < h) {
      const len = rand.range(h * 0.22, h * 0.5);
      const x = col * plankW;
      ctx.fillStyle = rand.pick(tones);
      ctx.fillRect(x, y, plankW, len);
      // Grain.
      ctx.globalAlpha = 0.12;
      ctx.strokeStyle = "#6e4a33";
      ctx.lineWidth = 1;
      for (let g = 0; g < 5; g++) {
        const gx = x + rand.range(3, plankW - 3);
        ctx.beginPath();
        ctx.moveTo(gx, y);
        ctx.bezierCurveTo(
          gx + rand.range(-4, 4),
          y + len * 0.3,
          gx + rand.range(-4, 4),
          y + len * 0.7,
          gx + rand.range(-3, 3),
          y + len,
        );
        ctx.stroke();
      }
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = "#5c3b28";
      ctx.fillRect(x, y + len - 1.5, plankW, 1.5);
      ctx.globalAlpha = 1;
      y += len;
    }
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = "#5c3b28";
    ctx.fillRect(col * plankW, 0, 1.5, h);
    ctx.globalAlpha = 1;
  }
}

/** A patterned rug: field colour, borders and a repeating diamond motif. */
export function drawRug(variant: "lounge" | "runner"): Draw {
  return (ctx, w, h) => {
    const field = variant === "lounge" ? "#8c4a3a" : "#7d3f37";
    const border = variant === "lounge" ? "#e3cfa6" : "#d9bf8f";
    const accent = variant === "lounge" ? "#3f5f5a" : "#34466a";
    ctx.fillStyle = field;
    ctx.fillRect(0, 0, w, h);
    const b = Math.min(w, h) * 0.07;
    ctx.strokeStyle = border;
    ctx.lineWidth = b * 0.35;
    ctx.strokeRect(b * 0.6, b * 0.6, w - b * 1.2, h - b * 1.2);
    ctx.lineWidth = b * 0.12;
    ctx.strokeStyle = accent;
    ctx.strokeRect(b * 1.3, b * 1.3, w - b * 2.6, h - b * 2.6);
    const step = Math.min(w, h) / (variant === "lounge" ? 5 : 3);
    for (let x = b * 2 + step / 2; x < w - b * 2; x += step) {
      for (let y = b * 2 + step / 2; y < h - b * 2; y += step) {
        ctx.fillStyle = border;
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.moveTo(x, y - step * 0.32);
        ctx.lineTo(x + step * 0.22, y);
        ctx.lineTo(x, y + step * 0.32);
        ctx.lineTo(x - step * 0.22, y);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.beginPath();
        ctx.arc(x, y, step * 0.07, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // Soft wear so it doesn't look printed.
    const rand = createRandom(7);
    ctx.globalAlpha = 0.05;
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = rand.chance(0.5) ? "#000" : "#fff";
      ctx.fillRect(rand.range(0, w), rand.range(0, h), rand.range(2, 8), rand.range(2, 8));
    }
    ctx.globalAlpha = 1;
  };
}

/** Hanging zone sign: walnut board, brass rule, cream lettering. */
export function drawZoneSign(title: string, subtitle: string): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = "#5c3b28";
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h * 0.12);
    ctx.fill();
    ctx.strokeStyle = PALETTE.brass;
    ctx.lineWidth = h * 0.035;
    ctx.beginPath();
    ctx.roundRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.08);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#f6ead2";
    ctx.font = `600 ${Math.round(h * 0.34)}px ${displayFont()}`;
    ctx.fillText(title, w / 2, h * 0.43);
    ctx.fillStyle = "#e0c58e";
    ctx.font = `700 ${Math.round(h * 0.13)}px ${uiFont()}`;
    ctx.fillText(subtitle.toUpperCase(), w / 2, h * 0.74);
  };
}

/** Small brass-edged subject plaque for shelf ends. */
export function drawPlaque(text: string): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = PALETTE.brass;
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, h * 0.15);
    ctx.fill();
    ctx.fillStyle = "#f3e7cc";
    ctx.beginPath();
    ctx.roundRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16, h * 0.1);
    ctx.fill();
    ctx.fillStyle = "#3a2a20";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(h * 0.42)}px ${displayFont()}`;
    ctx.fillText(text, w / 2, h * 0.53);
  };
}

/** Surface of an empty collaborative whiteboard: tells people how to use it. */
export function drawWhiteboardPlaceholder(tableNumber: number): Draw {
  return (ctx, w, h) => {
    ctx.fillStyle = "#f7f7f3";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#2f6fb3";
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.1, h * 0.75);
    ctx.bezierCurveTo(w * 0.2, h * 0.55, w * 0.3, h * 0.9, w * 0.42, h * 0.7);
    ctx.stroke();
    ctx.strokeStyle = "#c0392b";
    ctx.beginPath();
    ctx.arc(w * 0.82, h * 0.72, h * 0.08, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#2d2420";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `600 ${Math.round(h * 0.13)}px ${displayFont()}`;
    ctx.fillText(`Table ${tableNumber} whiteboard`, w / 2, h * 0.3);
    ctx.fillStyle = "#6b5d52";
    ctx.font = `700 ${Math.round(h * 0.06)}px ${uiFont()}`;
    ctx.fillText("PRESS E HERE TO DRAW", w / 2, h * 0.46);
    ctx.fillText("OR B FROM YOUR SEAT \u00b7 \u2728 ASK AI", w / 2, h * 0.54);
  };
}

/** Cork notice boards by the entrance: a welcome note and a map of the zones. */
export function drawNotice(kind: "welcome" | "map"): Draw {
  return (ctx, w, h) => {
    const rand = createRandom(kind === "map" ? 3 : 5);
    ctx.fillStyle = "#c79a64";
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 0.18;
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = rand.chance(0.5) ? "#7a5137" : "#e8c48e";
      ctx.fillRect(rand.range(0, w), rand.range(0, h), 2, 2);
    }
    ctx.globalAlpha = 1;
    const card = (
      x: number,
      y: number,
      cw: number,
      ch: number,
      rot: number,
      color: string,
      pin: string,
    ) => {
      ctx.save();
      ctx.translate(x + cw / 2, y + ch / 2);
      ctx.rotate(rot);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(-cw / 2 + 6, -ch / 2 + 8, cw, ch);
      ctx.fillStyle = color;
      ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
      ctx.fillStyle = pin;
      ctx.beginPath();
      ctx.arc(0, -ch / 2 + 16, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    };
    if (kind === "welcome") {
      card(w * 0.08, h * 0.08, w * 0.84, h * 0.5, -0.015, "#fbf6ea", "#c0392b");
      ctx.save();
      ctx.translate(w / 2, h * 0.33);
      ctx.rotate(-0.015);
      ctx.fillStyle = "#2d2420";
      ctx.textAlign = "center";
      ctx.font = `600 ${Math.round(h * 0.09)}px ${displayFont()}`;
      ctx.fillText("Welcome to OVR", 0, -h * 0.06);
      ctx.font = `600 ${Math.round(h * 0.042)}px ${uiFont()}`;
      ctx.fillStyle = "#5b4d44";
      ctx.fillText("Find a seat, settle in, study well.", 0, h * 0.03);
      ctx.fillText("Press E near a chair to sit down.", 0, h * 0.09);
      ctx.restore();
      card(w * 0.1, h * 0.64, w * 0.36, h * 0.28, 0.04, "#f6e2a8", "#2f6fb3");
      card(w * 0.54, h * 0.62, w * 0.36, h * 0.3, -0.03, "#dfe9d8", "#c99a45");
      ctx.fillStyle = "#3a2a20";
      ctx.font = `700 ${Math.round(h * 0.034)}px ${uiFont()}`;
      ctx.textAlign = "center";
      ctx.fillText("Quiet Study", w * 0.28, h * 0.77);
      ctx.fillText("is for focus", w * 0.28, h * 0.82);
      ctx.fillText("Collab tables", w * 0.72, h * 0.76);
      ctx.fillText("are for talking", w * 0.72, h * 0.81);
    } else {
      card(w * 0.07, h * 0.08, w * 0.86, h * 0.84, 0.01, "#fbf6ea", "#3f6b4a");
      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.rotate(0.01);
      ctx.fillStyle = "#2d2420";
      ctx.textAlign = "center";
      ctx.font = `600 ${Math.round(h * 0.07)}px ${displayFont()}`;
      ctx.fillText("Library map", 0, -h * 0.3);
      // Floor plan: x → right, north (windows) at the top.
      const mapW = w * 0.7;
      const mapH = mapW * 0.75;
      const ox = -mapW / 2;
      const oy = -h * 0.22;
      const colors: Record<string, string> = {
        stacks: "#c9a77a",
        collab: "#9fbf9a",
        hall: "#e6d6b8",
        quiet: "#a9c0d6",
        lounge: "#d9a48a",
      };
      for (const zone of ZONES) {
        const x = ox + ((zone.bounds.minX + 16) / 32) * mapW;
        const y = oy + ((zone.bounds.minZ + 12) / 24) * mapH;
        const zw = ((zone.bounds.maxX - zone.bounds.minX) / 32) * mapW;
        const zh = ((zone.bounds.maxZ - zone.bounds.minZ) / 24) * mapH;
        ctx.fillStyle = colors[zone.id] ?? "#ddd";
        ctx.fillRect(x + 2, y + 2, zw - 4, zh - 4);
        ctx.fillStyle = "#2d2420";
        ctx.font = `800 ${Math.round(h * 0.026)}px ${uiFont()}`;
        const words = zone.name.split(" ");
        words.forEach((word, i) =>
          ctx.fillText(word, x + zw / 2, y + zh / 2 + (i - (words.length - 1) / 2) * h * 0.032),
        );
      }
      ctx.fillStyle = "#c0392b";
      ctx.beginPath();
      ctx.arc(
        ox + mapW / 2,
        oy + ((SPAWN_POINTS[0]!.z + 12) / 24) * mapH,
        h * 0.014,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.font = `700 ${Math.round(h * 0.026)}px ${uiFont()}`;
      ctx.fillText("You are here", ox + mapW / 2, oy + mapH + h * 0.04);
      ctx.restore();
    }
  };
}

/** Old-fashioned globe: parchment oceans, sage continents. */
export function drawGlobe(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const rand = createRandom(12);
  ctx.fillStyle = "#e9dcbc";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(90,60,40,0.25)";
  ctx.lineWidth = 1.5;
  for (let i = 1; i < 12; i++) {
    ctx.beginPath();
    ctx.moveTo((i / 12) * w, 0);
    ctx.lineTo((i / 12) * w, h);
    ctx.stroke();
  }
  for (let i = 1; i < 6; i++) {
    ctx.beginPath();
    ctx.moveTo(0, (i / 6) * h);
    ctx.lineTo(w, (i / 6) * h);
    ctx.stroke();
  }
  for (let c = 0; c < 7; c++) {
    const cx = rand.range(0, w);
    const cy = rand.range(h * 0.2, h * 0.8);
    ctx.fillStyle = rand.pick(["#8fa58a", "#a3b38a", "#c9a77a"]);
    ctx.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = rand.range(30, 70);
      const x = cx + Math.cos(a) * r * 1.4;
      const y = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.fill();
  }
}
