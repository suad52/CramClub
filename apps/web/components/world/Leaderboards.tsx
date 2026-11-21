"use client";

import { useEffect, useMemo } from "react";
import {
  CanvasTexture,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Shape,
} from "three";
import { LEADERBOARDS, LEADERBOARD_STAND as S, type LeaderboardSpot } from "@ovr/shared";
import { type HallBoard, useHallBoards, useHallBoardsLive } from "@/lib/learning/hallBoards";
import {
  FACE_H,
  FACE_W,
  type FaceContent,
  drawLeaderboardFace,
  faceFonts,
  leaderboardFace,
  loadFaceFonts,
} from "@/lib/world/leaderboardFace";

/*
 * The hall's two leaderboards: sturdy walnut notice boards on two feet, each with a brass
 * "Leaderboard" plaque on an arched crest and two little picture lamps over a painted face that
 * shows this week's top eight (lib/world/leaderboardFace.ts). One ranks focus time, the other XP;
 * the focus board notes under a row how much of it was seen at the desk ("✓ 45 m at desk"), for
 * students who turned their own face tracking on, without changing the order.
 * Layout and collision live in @ovr/shared (leaderboards.ts).
 *
 * In a board's frame (metres): origin on the floor under its middle, the face looking along +Z.
 */

const POST = 0.09;
const POST_X = S.width / 2 - POST / 2;
/** Between the posts. */
const INNER = S.width - POST * 2;
const FOOT_H = 0.08;
const BUN = 0.02;
const CAP_Y = 1.995;
const CAP_H = 0.05;
const FRAME_D = 0.05;
const FACE = S.face;
const FACE_Y = FACE.bottom + FACE.height / 2;
/** Just proud of the backing board (whose front is at 0.025), well back inside the frame. */
const FACE_Z = 0.032;
const RAIL = 0.09;
const STILE = (INNER - FACE.width) / 2;
const BACK_Y0 = FACE.bottom - RAIL;
const BACK_H = CAP_Y - BACK_Y0;
const LAMP_X = 0.52;

/** "LEADERBOARD" in walnut on a brass plate. */
function paintPlaque(texture: CanvasTexture) {
  const canvas = texture.image as HTMLCanvasElement;
  const c = canvas.getContext("2d")!;
  const { width: w, height: h } = canvas;
  c.fillStyle = "#c39b58";
  c.fillRect(0, 0, w, h);
  c.strokeStyle = "#6e5026";
  c.lineWidth = h * 0.07;
  c.strokeRect(h * 0.1, h * 0.1, w - h * 0.2, h - h * 0.2);
  c.fillStyle = "#2a1d10";
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.font = `700 ${Math.round(h * 0.52)}px ${faceFonts().display}`;
  c.letterSpacing = `${Math.round(h * 0.07)}px`;
  c.fillText("LEADERBOARD", w / 2, h * 0.54);
  texture.needsUpdate = true;
}

function paintFace(texture: CanvasTexture, face: FaceContent) {
  drawLeaderboardFace((texture.image as HTMLCanvasElement).getContext("2d")!, face);
  texture.needsUpdate = true;
}

function canvasTexture(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** The crest over the cap rail: a low arch, in the board's frame (base on y = 0). */
function crestGeometry() {
  const half = 0.42;
  const shape = new Shape();
  shape.moveTo(-half, 0);
  shape.lineTo(half, 0);
  shape.lineTo(half, 0.11);
  shape.quadraticCurveTo(0, 0.23, -half, 0.11);
  shape.closePath();
  const g = new ExtrudeGeometry(shape, {
    depth: 0.04,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 2,
    curveSegments: 16,
  });
  g.translate(0, 0, -0.02);
  return g;
}

function useMaterials() {
  const m = useMemo(() => {
    const plaqueTexture = canvasTexture(512, 76);
    return {
      wood: new MeshStandardMaterial({ color: "#5a3620", roughness: 0.5 }),
      panel: new MeshStandardMaterial({ color: "#3a2416", roughness: 0.6 }),
      dark: new MeshStandardMaterial({ color: "#2c1a10", roughness: 0.55 }),
      brass: new MeshStandardMaterial({ color: "#b38a4e", metalness: 0.85, roughness: 0.32 }),
      shade: new MeshStandardMaterial({
        color: "#b38a4e",
        metalness: 0.85,
        roughness: 0.32,
        side: DoubleSide,
      }),
      glow: new MeshBasicMaterial({ color: new Color("#ffe2a8"), toneMapped: false }),
      plaque: new MeshStandardMaterial({ map: plaqueTexture, metalness: 0.55, roughness: 0.38 }),
      plaqueTexture,
      crest: crestGeometry(),
    };
  }, []);
  useEffect(() => {
    let live = true;
    paintPlaque(m.plaqueTexture);
    void loadFaceFonts().then(() => live && paintPlaque(m.plaqueTexture));
    return () => {
      live = false;
    };
  }, [m]);
  useEffect(
    () => () => {
      for (const v of Object.values(m)) (v as Material | CanvasTexture | ExtrudeGeometry).dispose();
    },
    [m],
  );
  return m;
}

type Materials = ReturnType<typeof useMaterials>;
type Vec3 = [number, number, number];

function Box({
  size,
  at,
  material,
  shadow = true,
}: {
  size: Vec3;
  at: Vec3;
  material: Material;
  shadow?: boolean;
}) {
  return (
    <mesh position={at} material={material} castShadow={shadow} receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

/** The painted face, repainted when what it shows changes (and once the fonts arrive). */
function useFace(kind: LeaderboardSpot["kind"], state: HallBoard) {
  const key = useMemo(() => JSON.stringify(leaderboardFace(kind, state)), [kind, state]);
  const texture = useMemo(() => canvasTexture(FACE_W, FACE_H), []);
  const material = useMemo(
    () =>
      new MeshStandardMaterial({
        map: texture,
        // A little of its own light, as if from the lamps above it: it stays readable in the
        // shade under the gallery without glowing.
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
    const face = JSON.parse(key) as FaceContent;
    paintFace(texture, face);
    void loadFaceFonts().then(() => live && paintFace(texture, face));
    return () => {
      live = false;
    };
  }, [key, texture]);
  return material;
}

/** A little brass picture lamp on the cap rail, its shade tipped down at the face. */
function Lamp({ x, m }: { x: number; m: Materials }) {
  const top = CAP_Y + CAP_H;
  return (
    <group position={[x, top, 0]}>
      <mesh position={[0, 0.03, 0.03]} material={m.brass}>
        <cylinderGeometry args={[0.008, 0.012, 0.06, 8]} />
      </mesh>
      <mesh position={[0, 0.058, 0.13]} rotation={[Math.PI / 2, 0, 0]} material={m.brass}>
        <cylinderGeometry args={[0.007, 0.007, 0.2, 8]} />
      </mesh>
      <group position={[0, 0.045, 0.24]} rotation={[0.6, 0, 0]}>
        <mesh material={m.shade} castShadow>
          <cylinderGeometry args={[0.022, 0.058, 0.085, 18, 1, true]} />
        </mesh>
        <mesh position={[0, 0.043, 0]} material={m.brass}>
          <cylinderGeometry args={[0.022, 0.022, 0.004, 18]} />
        </mesh>
        <mesh position={[0, -0.02, 0]} material={m.glow}>
          <sphereGeometry args={[0.024, 14, 10]} />
        </mesh>
      </group>
    </group>
  );
}

function Stand({ spot, state, m }: { spot: LeaderboardSpot; state: HallBoard; m: Materials }) {
  const face = useFace(spot.kind, state);
  const top = CAP_Y + CAP_H;
  return (
    <group position={[spot.x, 0, spot.z]} rotation-y={spot.rotationY}>
      {/* Two feet with rounded ends, on little bun feet, and a post rising from each. */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * POST_X, 0, 0]}>
          <Box
            size={[0.12, FOOT_H, S.footDepth - FOOT_H]}
            at={[0, BUN + FOOT_H / 2, 0]}
            material={m.dark}
          />
          {[-1, 1].map((e) => (
            <group key={e}>
              <mesh
                position={[0, BUN + FOOT_H / 2, (e * (S.footDepth - FOOT_H)) / 2]}
                rotation={[0, 0, Math.PI / 2]}
                material={m.dark}
                castShadow
              >
                <cylinderGeometry args={[FOOT_H / 2, FOOT_H / 2, 0.12, 16]} />
              </mesh>
              <mesh position={[0, BUN / 2, e * (S.footDepth / 2 - 0.07)]} material={m.dark}>
                <cylinderGeometry args={[0.035, 0.03, BUN, 12]} />
              </mesh>
            </group>
          ))}
          <Box
            size={[POST, CAP_Y - BUN - FOOT_H, POST]}
            at={[0, (CAP_Y + BUN + FOOT_H) / 2, 0]}
            material={m.wood}
          />
          {/* Brass finials over the posts. */}
          <mesh position={[0, top + 0.012, 0]} material={m.dark}>
            <cylinderGeometry args={[0.03, 0.036, 0.024, 14]} />
          </mesh>
          <mesh position={[0, top + 0.058, 0]} material={m.brass} castShadow>
            <sphereGeometry args={[0.04, 16, 12]} />
          </mesh>
        </group>
      ))}

      {/* A stretcher low between the posts, the backing board, and the frame round the face. */}
      <Box size={[INNER, 0.06, 0.05]} at={[0, 0.17, 0]} material={m.wood} />
      <Box size={[INNER, BACK_H, 0.05]} at={[0, BACK_Y0 + BACK_H / 2, 0]} material={m.panel} />
      {[FACE.bottom - RAIL / 2, FACE.bottom + FACE.height + RAIL / 2].map((y) => (
        <Box key={y} size={[INNER, RAIL, FRAME_D]} at={[0, y, 0.035]} material={m.wood} />
      ))}
      {[-1, 1].map((s) => (
        <Box
          key={s}
          size={[STILE, FACE.height, FRAME_D]}
          at={[s * (FACE.width / 2 + STILE / 2), FACE_Y, 0.035]}
          material={m.wood}
        />
      ))}
      {/* A gilt bead just inside the frame. */}
      {[FACE.bottom, FACE.bottom + FACE.height].map((y) => (
        <Box
          key={y}
          size={[FACE.width + 0.016, 0.016, 0.012]}
          at={[0, y, 0.064]}
          material={m.brass}
          shadow={false}
        />
      ))}
      {[-1, 1].map((s) => (
        <Box
          key={s}
          size={[0.016, FACE.height, 0.012]}
          at={[(s * FACE.width) / 2, FACE_Y, 0.064]}
          material={m.brass}
          shadow={false}
        />
      ))}
      <mesh position={[0, FACE_Y, FACE_Z]} material={face} receiveShadow>
        <planeGeometry args={[FACE.width, FACE.height]} />
      </mesh>

      {/* The cap rail, the arched crest with its plaque, and the two lamps. */}
      <Box size={[S.width + 0.06, CAP_H, 0.14]} at={[0, CAP_Y + CAP_H / 2, 0]} material={m.dark} />
      <mesh position={[0, top, 0]} geometry={m.crest} material={m.wood} castShadow />
      <Box size={[0.6, 0.085, 0.012]} at={[0, top + 0.072, 0.03]} material={m.brass} />
      <mesh position={[0, top + 0.072, 0.0365]} material={m.plaque}>
        <planeGeometry args={[0.58, 0.078]} />
      </mesh>
      {[-1, 1].map((s) => (
        <Lamp key={s} x={s * LAMP_X} m={m} />
      ))}
    </group>
  );
}

export function Leaderboards() {
  useHallBoardsLive();
  const boards = useHallBoards((s) => s.boards);
  const m = useMaterials();
  return (
    <>
      {LEADERBOARDS.map((spot) => (
        <Stand key={spot.id} spot={spot} state={boards[spot.kind]} m={m} />
      ))}
    </>
  );
}
