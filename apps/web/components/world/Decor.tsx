"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  CanvasTexture,
  type Group,
  type Mesh,
  MeshStandardMaterial,
  type PointLight,
  SRGBColorSpace,
  type Texture,
} from "three";
import { FURNITURE, FURNITURE_SPECS, type FurnitureItem, ROOM } from "@ovr/shared";
import { ImageCache, loadHandFont, renderRegion } from "@/lib/whiteboard/render";
import { loadBoard } from "@/lib/whiteboard/storage";
import { useWhiteboardStore } from "@/lib/whiteboard/store";
import { PALETTE } from "@/lib/world/palette";
import {
  canvasTexture,
  drawGlobe,
  drawNotice,
  drawPlaque,
  drawRug,
  drawWhiteboardPlaceholder,
  drawZoneSign,
} from "@/lib/world/textures";

/** Disposes textures when the component that created them unmounts. */
function useDisposeTextures(value: Texture | readonly Texture[]) {
  useEffect(
    () => () => {
      for (const t of Array.isArray(value) ? value : [value]) t.dispose();
    },
    [value],
  );
}

/** A board with the same texture on both faces, so it reads correctly from either side. */
function DoubleSidedBoard({
  texture,
  width,
  height,
  depth = 0.05,
  edge = PALETTE.walnutDark,
}: {
  texture: Texture;
  width: number;
  height: number;
  depth?: number;
  edge?: string;
}) {
  const materials = useMemo(() => {
    const side = new MeshStandardMaterial({ color: edge, roughness: 0.8 });
    const face = new MeshStandardMaterial({ map: texture, roughness: 0.75 });
    return [side, side, side, side, face, face];
  }, [texture, edge]);
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return (
    <mesh material={materials} castShadow>
      <boxGeometry args={[width, height, depth]} />
    </mesh>
  );
}

interface ZoneSignSpec {
  title: string;
  subtitle: string;
  position: [number, number, number];
  rotationY: number;
}

const ZONE_SIGNS: ZoneSignSpec[] = [
  {
    title: "Collaborative Tables",
    subtitle: "Study together · talk freely",
    position: [0, 3.9, 0.9],
    rotationY: 0,
  },
  {
    title: "Resource Stacks",
    subtitle: "Shelves by subject",
    position: [-6.9, 3.6, -0.9],
    rotationY: Math.PI / 2,
  },
  {
    title: "Quiet Study",
    subtitle: "Heads down · voices low",
    position: [6.9, 3.6, -6.5],
    rotationY: -Math.PI / 2,
  },
  {
    title: "Reading Lounge",
    subtitle: "Sofas · the fire · a chat",
    position: [6.9, 3.6, 7.5],
    rotationY: -Math.PI / 2,
  },
];

function HangingSign({ spec }: { spec: ZoneSignSpec }) {
  const w = 2.6;
  const h = 0.72;
  const texture = useMemo(
    () => canvasTexture(1040, 288, drawZoneSign(spec.title, spec.subtitle)),
    [spec.title, spec.subtitle],
  );
  useDisposeTextures(texture);
  const chain = ROOM.height - (spec.position[1] + h / 2);
  return (
    <group position={spec.position} rotation-y={spec.rotationY}>
      <DoubleSidedBoard texture={texture} width={w} height={h} />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (w / 2 - 0.2), h / 2 + chain / 2, 0]}>
          <cylinderGeometry args={[0.008, 0.008, chain, 5]} />
          <meshStandardMaterial color={PALETTE.iron} />
        </mesh>
      ))}
    </group>
  );
}

/** Subject plaques at the aisle end of each shelf run, plus a header board on top. */
function SubjectSigns() {
  const runs = useMemo(() => {
    const bySubject = new Map<string, FurnitureItem[]>();
    for (const f of FURNITURE) {
      if (f.kind !== "shelfRow" || !f.subject) continue;
      bySubject.set(f.subject, [...(bySubject.get(f.subject) ?? []), f]);
    }
    return [...bySubject.entries()].map(([subject, items]) => {
      const half = (items[0]!.width ?? FURNITURE_SPECS.shelfRow.width) / 2;
      const minZ = Math.min(...items.map((i) => i.z)) - half;
      const maxZ = Math.max(...items.map((i) => i.z)) + half;
      const towardAisle = maxZ < -0.9;
      return {
        subject,
        x: items[0]!.x,
        endZ: towardAisle ? maxZ + 0.006 : minZ - 0.006,
        facing: towardAisle ? 0 : Math.PI,
        midZ: (minZ + maxZ) / 2,
      };
    });
  }, []);
  const textures = useMemo(
    () => runs.map((r) => canvasTexture(560, 176, drawPlaque(r.subject))),
    [runs],
  );
  useDisposeTextures(textures);
  return (
    <>
      {runs.map((r, i) => (
        <group key={r.subject}>
          <mesh position={[r.x, 1.95, r.endZ]} rotation-y={r.facing}>
            <planeGeometry args={[0.7, 0.22]} />
            <meshStandardMaterial
              map={textures[i]}
              roughness={0.5}
              metalness={0.1}
              polygonOffset
              polygonOffsetFactor={-2}
            />
          </mesh>
          <group
            position={[r.x, FURNITURE_SPECS.shelfRow.height + 0.17, r.midZ]}
            rotation-y={Math.PI / 2}
          >
            <DoubleSidedBoard
              texture={textures[i]!}
              width={1.3}
              height={0.32}
              depth={0.04}
              edge={PALETTE.brass}
            />
          </group>
        </group>
      ))}
    </>
  );
}

/** Draws a board's saved contents (or the "press E" placeholder) onto its 3D surface texture. */
function paintBoardTexture(
  texture: CanvasTexture,
  boardId: string,
  tableNumber: number,
  images: ImageCache,
) {
  const canvas = texture.image as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  const items = loadBoard(boardId);
  if (items.length === 0) drawWhiteboardPlaceholder(tableNumber)(ctx, canvas.width, canvas.height);
  else renderRegion(ctx, items, images, undefined, canvas.width, canvas.height);
  texture.needsUpdate = true;
}

function createBoardTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 640;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** One collaborative whiteboard in the room, showing whatever is drawn on it. */
function WhiteboardSurface({ item }: { item: FurnitureItem }) {
  const boardId = item.tableId ?? item.id;
  const tableNumber = Number(boardId.split("-").pop() ?? 0);
  const version = useWhiteboardStore((s) => s.versions[boardId] ?? 0);
  const texture = useMemo(() => createBoardTexture(), []);
  useDisposeTextures(texture);
  useEffect(() => {
    let live = true;
    const images = new ImageCache(
      () => live && paintBoardTexture(texture, boardId, tableNumber, images),
    );
    paintBoardTexture(texture, boardId, tableNumber, images);
    void Promise.all([document.fonts?.ready, loadHandFont()]).then(
      () => live && paintBoardTexture(texture, boardId, tableNumber, images),
    );
    return () => {
      live = false;
    };
  }, [boardId, tableNumber, texture, version]);
  return (
    <group position={[item.x, 0, item.z]} rotation-y={item.rotationY}>
      {/* Mobile boards are double-sided, so the board reads from either side. */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, 1.35, side * 0.0265]} rotation-y={side === 1 ? 0 : Math.PI}>
          <planeGeometry args={[1.56, 0.98]} />
          <meshStandardMaterial map={texture} roughness={0.25} />
        </mesh>
      ))}
    </group>
  );
}

function Whiteboards() {
  const boards = useMemo(() => FURNITURE.filter((f) => f.kind === "whiteboard"), []);
  return (
    <>
      {boards.map((b) => (
        <WhiteboardSurface key={b.id} item={b} />
      ))}
    </>
  );
}

function NoticeBoards() {
  const boards = useMemo(() => FURNITURE.filter((f) => f.kind === "noticeBoard"), []);
  const textures = useMemo(
    () =>
      boards.map((b) => canvasTexture(900, 640, drawNotice(b.label === "map" ? "map" : "welcome"))),
    [boards],
  );
  useDisposeTextures(textures);
  return (
    <>
      {boards.map((b, i) => (
        <group key={b.id} position={[b.x, 0, b.z]} rotation-y={b.rotationY}>
          <mesh position={[0, 1.65, 0]} castShadow receiveShadow>
            <boxGeometry args={[1.7, 1.22, 0.06]} />
            <meshStandardMaterial color={PALETTE.walnut} roughness={0.8} />
          </mesh>
          <mesh position={[0, 1.65, 0.031]} receiveShadow>
            <planeGeometry args={[1.56, 1.08]} />
            <meshStandardMaterial map={textures[i]} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </>
  );
}

function CirculationSign() {
  const desk = FURNITURE.find((f) => f.kind === "circulationDesk");
  const texture = useMemo(() => canvasTexture(560, 176, drawPlaque("Circulation")), []);
  useDisposeTextures(texture);
  if (!desk) return null;
  return (
    <group position={[desk.x, 0, desk.z]} rotation-y={desk.rotationY}>
      <mesh position={[0, 0.82, 0.468]}>
        <planeGeometry args={[0.9, 0.28]} />
        <meshStandardMaterial map={texture} roughness={0.5} metalness={0.1} />
      </mesh>
    </group>
  );
}

function Rugs() {
  const rugs = useMemo(() => FURNITURE.filter((f) => f.kind === "rug"), []);
  const textures = useMemo(
    () =>
      rugs.map((r) => {
        const w = r.width ?? FURNITURE_SPECS.rug.width;
        const d = r.depth ?? FURNITURE_SPECS.rug.depth;
        return canvasTexture(
          Math.round(w * 220),
          Math.round(d * 220),
          drawRug(r.label === "runner" ? "runner" : "lounge"),
        );
      }),
    [rugs],
  );
  useDisposeTextures(textures);
  return (
    <>
      {rugs.map((r, i) => (
        <mesh
          key={r.id}
          position={[r.x, 0.006 + i * 0.001, r.z]}
          rotation={[-Math.PI / 2, 0, r.rotationY]}
          receiveShadow
        >
          <planeGeometry
            args={[r.width ?? FURNITURE_SPECS.rug.width, r.depth ?? FURNITURE_SPECS.rug.depth]}
          />
          <meshStandardMaterial map={textures[i]} roughness={0.95} />
        </mesh>
      ))}
    </>
  );
}

function Globe() {
  const item = FURNITURE.find((f) => f.kind === "globe");
  const texture = useMemo(() => canvasTexture(1024, 512, drawGlobe), []);
  useDisposeTextures(texture);
  const sphere = useRef<Mesh>(null);
  useFrame((_, dt) => {
    if (sphere.current) sphere.current.rotation.y += dt * 0.08;
  });
  if (!item) return null;
  return (
    <group position={[item.x, 0, item.z]} rotation-y={item.rotationY}>
      <group position={[0, 0.95, 0]} rotation-z={0.4}>
        <mesh ref={sphere} castShadow>
          <sphereGeometry args={[0.33, 32, 20]} />
          <meshStandardMaterial map={texture} roughness={0.55} />
        </mesh>
      </group>
    </group>
  );
}

/** Animated fire: a few glowing flames that flicker, plus a warm light that breathes with them. */
function Fire() {
  const item = FURNITURE.find((f) => f.kind === "fireplace");
  const flames = useRef<Group>(null);
  const light = useRef<PointLight>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    flames.current?.children.forEach((child, i) => {
      const s = 0.85 + Math.sin(t * (7 + i * 1.7) + i) * 0.12 + Math.sin(t * 13.3 + i * 2.1) * 0.06;
      child.scale.set(1, s, 1);
    });
    if (light.current)
      light.current.intensity = 5.5 + Math.sin(t * 9.1) * 0.8 + Math.sin(t * 15.7) * 0.5;
  });
  if (!item) return null;
  // Linear RGB above 1 so the bloom pass makes the flames glow.
  const flameSpecs: [number, number, number, [number, number, number]][] = [
    [-0.18, 0.32, 0.12, [1.5, 0.32, 0.03]],
    [0.0, 0.42, 0.15, [1.6, 0.55, 0.06]],
    [0.18, 0.3, 0.11, [1.4, 0.28, 0.02]],
    [0.06, 0.24, 0.08, [1.7, 1.0, 0.25]],
  ];
  return (
    <group position={[item.x, 0, item.z]} rotation-y={item.rotationY}>
      <group ref={flames} position={[0, 0.16, 0.02]}>
        {flameSpecs.map(([x, h, r, c], i) => (
          <mesh key={i} position={[x, h / 2, 0]}>
            <coneGeometry args={[r, h, 7]} />
            <meshBasicMaterial color={c} toneMapped={false} transparent opacity={0.92} />
          </mesh>
        ))}
      </group>
      <pointLight
        ref={light}
        position={[0, 0.7, 0.8]}
        color="#ff9a4a"
        intensity={5.5}
        distance={9}
        decay={2}
      />
    </group>
  );
}

export function Decor() {
  return (
    <>
      {ZONE_SIGNS.map((s) => (
        <HangingSign key={s.title} spec={s} />
      ))}
      <SubjectSigns />
      <Whiteboards />
      <NoticeBoards />
      <CirculationSign />
      <Rugs />
      <Globe />
      <Fire />
    </>
  );
}
