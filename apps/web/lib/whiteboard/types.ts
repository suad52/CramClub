/** Logical board size. The 3D whiteboard surface has the same 16:10 shape. */
export const BOARD_W = 1600;
export const BOARD_H = 1000;

/** x, y in board units; pressure 0…1. */
export type Point = [x: number, y: number, pressure: number];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface StrokeItem {
  kind: "stroke";
  id: string;
  points: Point[];
  color: string;
  size: number;
  /** True when the points carry real pen pressure (stylus); mouse strokes simulate it. */
  pressure: boolean;
}

/** AI handwriting, kept as a transparent image placed on the board. */
export interface ImageItem {
  kind: "image";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  src: string;
  /** The answer in plain text, for accessibility and copying. */
  alt: string;
}

/** AI answer drawn in a handwriting font (used when AI handwriting isn't available). */
export interface TextItem {
  kind: "text";
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
  color: string;
  lineHeight: number;
}

export type BoardItem = StrokeItem | ImageItem | TextItem;

export const INK_COLORS = [
  { id: "black", label: "Black", color: "#2d2420" },
  { id: "blue", label: "Blue", color: "#2f6fb3" },
  { id: "red", label: "Red", color: "#c0392b" },
  { id: "green", label: "Green", color: "#2e7d4f" },
] as const;

export const PEN_SIZES = [
  { id: "fine", label: "Fine", size: 4 },
  { id: "medium", label: "Medium", size: 7 },
  { id: "bold", label: "Bold", size: 12 },
] as const;

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
