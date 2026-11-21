/** What an empty collaborative whiteboard shows in the 3D library: a hint to start drawing. */

type Draw = (ctx: CanvasRenderingContext2D, w: number, h: number) => void;

function cssFont(variable: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
  return v ? `${v}, ${fallback}` : fallback;
}

export const displayFont = () => cssFont("--font-fraunces", "Georgia, serif");
export const uiFont = () => cssFont("--font-nunito", "system-ui, sans-serif");

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
    ctx.fillText("OR B FROM YOUR SEAT · ASK THE LIBRARIAN", w / 2, h * 0.54);
  };
}
