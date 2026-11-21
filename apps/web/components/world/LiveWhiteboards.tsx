"use client";

import { useEffect, useMemo } from "react";
import { CanvasTexture, SRGBColorSpace } from "three";
import { WHITEBOARDS } from "@/lib/game/actions";
import { drawWhiteboardPlaceholder } from "@/lib/whiteboard/placeholder";
import { ImageCache, loadHandFont, renderRegion } from "@/lib/whiteboard/render";
import { loadBoard } from "@/lib/whiteboard/storage";
import { useWhiteboardStore } from "@/lib/whiteboard/store";

/** The wall whiteboard from the plan: 2.0 x 1.25 m, bottom edge 0.85 m up, 6 cm deep. */
const BOARD = { width: 2.0, height: 1.25, bottom: 0.85, depth: 0.06, frame: 0.07 };

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

/**
 * A table's whiteboard drawing as a texture, repainted whenever someone draws on it. Shown on
 * the wall boards here and on both faces of the rolling boards (BoardPanels).
 */
export function useBoardDrawingTexture(boardId: string) {
  const tableNumber = Number(/(\d+)$/.exec(boardId)?.[1] ?? 0);
  const version = useWhiteboardStore((s) => s.versions[boardId] ?? 0);
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 600;
    const t = new CanvasTexture(canvas);
    t.colorSpace = SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  useEffect(() => () => texture.dispose(), [texture]);
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
  return texture;
}

type WallBoard = (typeof WHITEBOARDS)[number] & {
  wall: NonNullable<(typeof WHITEBOARDS)[number]["wall"]>;
};

/** One table's wall whiteboard, showing whatever has been drawn on it. */
function LiveBoard({ board }: { board: WallBoard }) {
  const { boardId, wall } = board;
  const texture = useBoardDrawingTexture(boardId);
  const w = BOARD.width - BOARD.frame * 2;
  const h = BOARD.height - BOARD.frame * 2;
  return (
    <group position={[wall.x, 0, wall.z]} rotation-y={wall.rotationY}>
      {/* Just proud of the modelled board's writing surface. */}
      <mesh position={[0, BOARD.bottom + BOARD.height / 2, BOARD.depth + 0.004]}>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial map={texture} roughness={0.3} />
      </mesh>
    </group>
  );
}

/** The wall-hung whiteboards. The rolling ones turn over for lessons, so BoardPanels draws them. */
export function LiveWhiteboards() {
  return (
    <>
      {WHITEBOARDS.map((b) =>
        b.wall && !b.wall.mobile ? (
          <LiveBoard key={b.boardId} board={{ ...b, wall: b.wall }} />
        ) : null,
      )}
    </>
  );
}
