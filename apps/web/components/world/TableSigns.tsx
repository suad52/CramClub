"use client";

import { useEffect, useMemo, useState } from "react";
import { CanvasTexture, Color, MeshStandardMaterial, SRGBColorSpace } from "three";
import { PLACED_ITEMS, type PlacedItem } from "@ovr/shared";
import { TABLE_IDS, tableName, useTables } from "@/lib/tables/client";
import { minutesLeft } from "@/lib/tables/time";
import type { TableStatus } from "@/lib/tables/types";
import { type FaceFonts, faceFonts, loadFaceFonts } from "@/lib/world/leaderboardFace";

/*
 * A little tent card on every held table, like the "reserved" cards in a real library: cream
 * card, walnut outline, a tangerine "Private" or leaf "Open" sticker, the holder's first name and
 * (private) the minutes left, on a walnut foot with a brass ridge. Only held tables have one; it
 * reads the same store as the table cards (lib/tables/client.ts), so it's never more than a poll
 * behind, and repaints only when what it says changes.
 *
 * Where it stands: a hall table's middle (between its two lamps, clear of the books and the
 * desk clock), facing both long sides; a gallery desk's level pen ledge at the back, facing the
 * reader and the hall.
 */

/** The card, in metres: each leaf of the tent, and how far it leans from upright. */
const W = 0.28;
const H = 0.17;
const LEAN = 0.32;
const T = 0.004;
const FOOT_H = 0.012;
/** The painted face (same aspect as a leaf). */
const FACE_W = 600;
const FACE_H = Math.round((FACE_W * H) / W);

interface Spot {
  item: PlacedItem;
  /** In the table's own frame. */
  x: number;
  y: number;
  z: number;
  /** The tent's ridge runs along local z unless turned (gallery desks: along their width). */
  turn: number;
  scale: number;
}

const SPOTS = new Map<string, Spot>();
for (const tableId of TABLE_IDS) {
  const item = PLACED_ITEMS.find((i) => i.id === tableId);
  if (!item) continue;
  if (item.kind === "gallery_desk")
    // The pen ledge (0.76 m) behind the sloped board; +z is the reader's side.
    SPOTS.set(tableId, { item, x: 0.38, y: 0.76, z: -0.235, turn: Math.PI / 2, scale: 0.85 });
  else SPOTS.set(tableId, { item, x: 0, y: 0.76, z: 0, turn: 0, scale: 1 });
}

/* ---- The face ---- */

const C = {
  card: "#fffefa",
  walnut: "#1f1a16",
  ink: "#5f6158",
  tangerine: "#e07a3f",
  leaf: "#7fb27a",
};

interface SignFace {
  private: boolean;
  table: string;
  name: string;
  line: string;
}

export function signFace(t: TableStatus, minutes: number): SignFace {
  const who = t.holderName?.trim() || "Someone";
  const isPrivate = t.visibility === "private";
  return {
    private: isPrivate,
    table: tableName(t.tableId),
    name: isPrivate ? who : `${who}'s table`,
    line: isPrivate ? `${minutes} min` : "Everyone welcome",
  };
}

type Ctx = CanvasRenderingContext2D;

function fitFont(c: Ctx, text: string, weight: number, size: number, family: string, max: number) {
  let s = size;
  c.font = `${weight} ${s}px ${family}`;
  while (s > 28 && c.measureText(text).width > max) {
    s -= 2;
    c.font = `${weight} ${s}px ${family}`;
  }
  if (c.measureText(text).width <= max) return text;
  let out = text;
  while (out.length > 1 && c.measureText(`${out}…`).width > max) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

/** A flat shape with a walnut outline and a hard sticker shadow under it. */
function sticker(c: Ctx, path: () => void, fill: string, line = 7, drop = 6) {
  c.save();
  c.translate(0, drop);
  path();
  c.fillStyle = C.walnut;
  c.fill();
  c.restore();
  path();
  c.fillStyle = fill;
  c.fill();
  c.lineWidth = line;
  c.strokeStyle = C.walnut;
  c.lineJoin = "round";
  c.stroke();
}

function drawLock(c: Ctx, x: number, cy: number, s: number) {
  c.save();
  c.strokeStyle = C.walnut;
  c.lineWidth = s * 0.16;
  c.lineCap = "round";
  c.beginPath();
  c.arc(x + s / 2, cy - s * 0.1, s * 0.27, Math.PI, 0);
  c.lineTo(x + s * 0.77, cy + s * 0.05);
  c.moveTo(x + s * 0.23, cy + s * 0.05);
  c.lineTo(x + s * 0.23, cy - s * 0.1);
  c.stroke();
  c.fillStyle = C.walnut;
  c.beginPath();
  c.roundRect(x + s * 0.08, cy + s * 0.02, s * 0.84, s * 0.56, s * 0.12);
  c.fill();
  c.restore();
}

export function drawSignFace(c: Ctx, f: SignFace, fonts: FaceFonts = faceFonts()) {
  const w = FACE_W;
  const h = FACE_H;
  c.save();
  c.textBaseline = "middle";
  c.fillStyle = C.card;
  c.fillRect(0, 0, w, h);
  // A walnut border just inside the edge, and a dashed stitch inside that (the cards' look).
  c.lineWidth = 14;
  c.strokeStyle = C.walnut;
  c.beginPath();
  c.roundRect(10, 10, w - 20, h - 20, 30);
  c.stroke();
  c.setLineDash([14, 12]);
  c.lineWidth = 4;
  c.strokeStyle = "rgba(31, 26, 22, 0.2)";
  c.beginPath();
  c.roundRect(30, 30, w - 60, h - 60, 18);
  c.stroke();
  c.setLineDash([]);

  // The sticker: "Private" (tangerine, with a padlock) or "Open" (leaf).
  const label = f.private ? "Private" : "Open";
  c.font = `600 44px ${fonts.display}`;
  const lock = f.private ? 40 : 0;
  const pillW = c.measureText(label).width + 56 + (lock ? lock + 10 : 0);
  const pillH = 70;
  const px = 52;
  const py = 54;
  sticker(
    c,
    () => {
      c.beginPath();
      c.roundRect(px, py, pillW, pillH, pillH / 2);
    },
    f.private ? C.tangerine : C.leaf,
  );
  if (lock) drawLock(c, px + 26, py + pillH / 2 - lock * 0.22, lock);
  c.fillStyle = C.walnut;
  c.textAlign = "left";
  c.fillText(label, px + 28 + (lock ? lock + 10 : 0), py + pillH / 2 + 2);

  // The table's name, small, across from the sticker.
  c.textAlign = "right";
  c.fillStyle = C.ink;
  c.fillText(
    fitFont(c, f.table, 800, 34, fonts.ui, w - pillW - px * 2 - 24),
    w - 56,
    py + pillH / 2 + 2,
  );

  // Who holds it, big; then the minutes left (private) or a welcome (open).
  c.textAlign = "left";
  c.fillStyle = C.walnut;
  c.fillText(fitFont(c, f.name, 700, 86, fonts.display, w - 112), 54, 196);
  c.fillStyle = C.ink;
  c.fillText(fitFont(c, f.line, 800, 44, fonts.ui, w - 112), 56, 270);
  c.restore();
}

function paintSign(texture: CanvasTexture, face: SignFace) {
  drawSignFace((texture.image as HTMLCanvasElement).getContext("2d")!, face);
  texture.needsUpdate = true;
}

/* ---- The tent ---- */

function useSharedMaterials() {
  const m = useMemo(
    () => ({
      card: new MeshStandardMaterial({ color: "#f4efe2", roughness: 0.85 }),
      foot: new MeshStandardMaterial({ color: "#3a2416", roughness: 0.55 }),
      brass: new MeshStandardMaterial({ color: "#b38a4e", metalness: 0.85, roughness: 0.32 }),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const mat of Object.values(m)) mat.dispose();
    },
    [m],
  );
  return m;
}

type Shared = ReturnType<typeof useSharedMaterials>;

function useFaceMaterial(face: SignFace) {
  const key = JSON.stringify(face);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = FACE_W;
    canvas.height = FACE_H;
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        map: texture,
        // A little of its own light so it reads in the hall's shade, without glowing.
        emissiveMap: texture,
        emissive: new Color("#ffffff"),
        emissiveIntensity: 0.3,
        roughness: 0.85,
      }),
    [texture],
  );
  useEffect(
    () => () => {
      material.dispose();
      texture.dispose();
    },
    [material, texture],
  );
  useEffect(() => {
    let live = true;
    const f = JSON.parse(key) as SignFace;
    paintSign(texture, f);
    void loadFaceFonts().then(() => live && paintSign(texture, f));
    return () => {
      live = false;
    };
  }, [key, texture]);
  return material;
}

function Sign({ spot, face, m }: { spot: Spot; face: SignFace; m: Shared }) {
  const material = useFaceMaterial(face);
  const { item } = spot;
  const sx = (H / 2) * Math.sin(LEAN);
  const cy = FOOT_H + (H / 2) * Math.cos(LEAN);
  const ridgeY = FOOT_H + H * Math.cos(LEAN);
  const footD = 2 * H * Math.sin(LEAN) + 0.03;
  return (
    <group position={[item.x, item.y, item.z]} rotation-y={item.rotationY}>
      <group position={[spot.x, spot.y, spot.z]} rotation-y={spot.turn} scale={spot.scale}>
        {/* The walnut foot, with the two leaves leaning together on it. */}
        <mesh position={[0, FOOT_H / 2, 0]} material={m.foot} castShadow receiveShadow>
          <boxGeometry args={[footD, FOOT_H, W + 0.03]} />
        </mesh>
        {[1, -1].map((s) => (
          <group key={s} position={[s * sx, cy, 0]} rotation-z={s * LEAN}>
            <mesh material={m.card} castShadow receiveShadow>
              <boxGeometry args={[T, H, W]} />
            </mesh>
            <mesh
              position={[s * (T / 2 + 0.0006), 0, 0]}
              rotation-y={(s * Math.PI) / 2}
              material={material}
            >
              <planeGeometry args={[W - 0.004, H - 0.004]} />
            </mesh>
          </group>
        ))}
        {/* A brass ridge clip along the top, with a bead at each end. */}
        <mesh position={[0, ridgeY, 0]} rotation-x={Math.PI / 2} material={m.brass} castShadow>
          <cylinderGeometry args={[0.0075, 0.0075, W + 0.012, 12]} />
        </mesh>
        {[-1, 1].map((e) => (
          <mesh key={e} position={[0, ridgeY, e * (W / 2 + 0.008)]} material={m.brass}>
            <sphereGeometry args={[0.011, 12, 8]} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

/** Every held table's tent card. Minutes tick on a slow clock (they only show whole minutes). */
export function TableSigns() {
  const tables = useTables((s) => s.view?.tables);
  const offset = useTables((s) => s.offsetMs);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const m = useSharedMaterials();
  if (!tables) return null;
  return (
    <>
      {tables.map((t) => {
        const spot = SPOTS.get(t.tableId);
        const minutes = minutesLeft(t.endsAt, now + offset);
        if (!spot || !t.held || minutes <= 0) return null;
        return <Sign key={t.tableId} spot={spot} face={signFace(t, minutes)} m={m} />;
      })}
    </>
  );
}
