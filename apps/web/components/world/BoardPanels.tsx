"use client";

import { useGLTF } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { type RefObject, useEffect, useRef, useState } from "react";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DynamicDrawUsage,
  type Group,
  InstancedMesh,
  Matrix4,
  type Object3D,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
} from "three";
import { WHITEBOARDS } from "@/lib/game/actions";
import { runtime } from "@/lib/game/runtime";
import { playBoardFlip } from "@/lib/game/sfx";
import {
  BOARD_SCREEN,
  type BoardLesson,
  type BoardScreen,
  type BoardScreenView,
  boardScreens,
  liveBoard,
  tableNumberOf,
  useBoardLessons,
} from "@/lib/learning-studio/boardLessons";
import {
  type BoardScreenMemory,
  createBoardScreenMemory,
  paintBoardScreen,
} from "@/lib/learning-studio/boardScreen";
import {
  BOARD_PANEL,
  FLIP_SECONDS,
  type FlipPose,
  edgeOnAngle,
  flipPose,
  splitPanelTriangles,
} from "@/lib/world/boardPanel";
import { LIBRARY_URL } from "./LibraryModel";
import { useBoardDrawingTexture } from "./LiveWhiteboards";

/**
 * The rolling whiteboards. A board with a lesson on it turns over: its modelled panel lifts off
 * the pins, swings round and settles, and the lesson shows on the face that comes up. The rest of
 * the time both faces show the table's drawing.
 */

type Wall = NonNullable<(typeof WHITEBOARDS)[number]["wall"]>;
interface MobileBoard {
  boardId: string;
  wall: Wall;
}

/** The rolling boards. Per-board state below is kept in arrays in this order. */
const MOBILE_BOARDS: MobileBoard[] = WHITEBOARDS.flatMap((b) =>
  b.wall?.mobile ? [{ boardId: b.boardId, wall: b.wall }] : [],
);

/** Each board's frame (origin on the floor at its centre, x along it, z through it) → world. */
const BOARD_FRAMES = MOBILE_BOARDS.map(({ wall }) =>
  new Matrix4().makeRotationY(wall.rotationY).setPosition(wall.x, 0, wall.z),
);
/** World → each board's frame. */
const FROM_WORLD = BOARD_FRAMES.map((m) => m.clone().invert());
/** The camera in a board's frame (reused every frame). */
const EYE = new Vector3();

/** The pictures sit just proud of the modelled writing faces. */
const FACE_Z = BOARD_PANEL.face + 0.003;
const FACES = [1, -1] as const;
/** The back face's picture turned round to face out. */
const DRAWING_ROTATION: Record<1 | -1, [number, number, number]> = {
  1: [0, 0, 0],
  [-1]: [0, Math.PI, 0],
};
/** Lesson pictures are also upside down, so they read the right way up once the panel turns. */
const LESSON_ROTATION: Record<1 | -1, [number, number, number]> = {
  1: [0, 0, Math.PI],
  [-1]: [0, Math.PI, Math.PI],
};

/** Longest step a flip takes in one frame, so a hitch or a paused canvas doesn't skip it. */
const MAX_STEP = 1 / 15;
/** Flip sounds fade with distance and are silent beyond this (metres). */
const SOUND_RANGE = 15;
/** Lesson faces repaint at most ~20 times a second. */
const MIN_PAINT_MS = 48;

interface Flip extends FlipPose {
  /** 0 showing the drawing … 1 turned over to the lesson. */
  t: number;
}

/** Moves each board's flip toward whether it has a lesson, with a sound as it starts and lands. */
function stepFlips(flips: Flip[], dt: number) {
  if (dt <= 0) return;
  const { boards } = useBoardLessons.getState();
  for (let i = 0; i < flips.length; i++) {
    const f = flips[i]!;
    const { boardId, wall } = MOBILE_BOARDS[i]!;
    const target = boards[boardId] ? 1 : 0;
    if (f.t === target) continue;
    const resting = f.t === 0 || f.t === 1;
    const step = dt / FLIP_SECONDS;
    f.t = target > f.t ? Math.min(target, f.t + step) : Math.max(target, f.t - step);
    flipPose(f.t, f);
    if (resting || f.t === target) {
      const distance = Math.hypot(wall.x - runtime.x, runtime.y, wall.z - runtime.z);
      playBoardFlip(resting ? "start" : "end", Math.max(0, 1 - distance / SOUND_RANGE) ** 2);
    }
  }
}

/** One primitive of the board model, split into a swinging copy and what stays on the stand. */
interface PanelMesh {
  source: InstancedMesh;
  /** The source's own geometry, put back on cleanup. */
  original: BufferGeometry;
  /** The source's stand-only geometry, or null when all of it swings (the source is hidden). */
  rest: BufferGeometry | null;
  sourceVisible: boolean;
  panel: InstancedMesh;
  /** Board index → instance index. */
  instances: Int16Array;
  /** Per board: board frame → mesh space, and the untouched instance in its board's frame. */
  fromBoard: Matrix4[];
  toBoard: Matrix4[];
}

interface PanelRig {
  meshes: PanelMesh[];
  /** The flip each board's instances were last posed at. */
  posedAt: Float64Array;
}

/**
 * Which board each instance of `mesh` is (as an index into MOBILE_BOARDS), or null when its
 * instances aren't the rolling boards.
 */
function matchBoards(mesh: InstancedMesh): Int16Array | null {
  if (mesh.count !== MOBILE_BOARDS.length) return null;
  const m = new Matrix4();
  const p = new Vector3();
  const boards = new Int16Array(mesh.count);
  const taken = new Set<number>();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, m);
    p.setFromMatrixPosition(m.premultiply(mesh.matrixWorld));
    const b = MOBILE_BOARDS.findIndex(
      ({ wall }, j) =>
        !taken.has(j) && Math.abs(wall.x - p.x) < 0.05 && Math.abs(wall.z - p.z) < 0.05,
    );
    if (b < 0) return null;
    taken.add(b);
    boards[i] = b;
  }
  return boards;
}

/** A geometry drawing `index` from `source`'s vertex data, which it shares rather than copies. */
function sharing(source: BufferGeometry, index: Uint16Array | Uint32Array) {
  const g = new BufferGeometry();
  for (const [name, attribute] of Object.entries(source.attributes))
    g.setAttribute(name, attribute);
  g.setIndex(new BufferAttribute(index, 1));
  return g;
}

/**
 * Frees a geometry made by `sharing`: just its index. Disposing a geometry frees its attributes'
 * GPU buffers too, and those belong to the library model, so they're detached first.
 */
function release(g: BufferGeometry) {
  for (const name of Object.keys(g.attributes)) g.deleteAttribute(name);
  g.dispose();
}

/**
 * Finds the rolling boards in the library model (one GPU-instanced mesh per material, an instance
 * per board) and moves each one's panel triangles into a sibling instanced mesh that can swing.
 */
function buildPanelRig(scene: Object3D): PanelRig {
  scene.updateWorldMatrix(true, true);
  const found: { source: InstancedMesh; boards: Int16Array }[] = [];
  scene.traverse((o) => {
    const mesh = o as InstancedMesh;
    if (!mesh.isInstancedMesh) return;
    const boards = matchBoards(mesh);
    if (boards) found.push({ source: mesh, boards });
  });

  const meshes: PanelMesh[] = [];
  const instance = new Matrix4();
  const toLocal = new Matrix4();
  const v = new Vector3();
  for (const { source, boards } of found) {
    const original = source.geometry;
    const position = original.getAttribute("position");
    if (!original.index || !position || !source.parent) continue;
    // Every instance is the same board, so the split worked out on the first serves them all.
    source.getMatrixAt(0, instance);
    toLocal
      .copy(BOARD_FRAMES[boards[0]!]!)
      .invert()
      .multiply(source.matrixWorld)
      .multiply(instance);
    const { panel, rest } = splitPanelTriangles({
      index: original.index.array,
      vertexCount: position.count,
      material: Array.isArray(source.material) ? "" : source.material.name,
      position: (i, out) => {
        v.fromBufferAttribute(position, i).applyMatrix4(toLocal);
        out.x = v.x;
        out.y = v.y;
        out.z = v.z;
      },
    });
    if (panel.length === 0) continue;

    const swinging = new InstancedMesh(sharing(original, panel), source.material, source.count);
    swinging.name = `BoardPanel_${meshes.length}`;
    swinging.instanceMatrix.array.set(source.instanceMatrix.array);
    swinging.instanceMatrix.setUsage(DynamicDrawUsage);
    swinging.position.copy(source.position);
    swinging.quaternion.copy(source.quaternion);
    swinging.scale.copy(source.scale);
    swinging.castShadow = source.castShadow;
    swinging.receiveShadow = source.receiveShadow;
    swinging.frustumCulled = source.frustumCulled;
    // Computed once: the boards' own bounds already cover the panel's small swing.
    swinging.computeBoundingSphere();
    source.parent.add(swinging);

    const entry: PanelMesh = {
      source,
      original,
      rest: rest.length > 0 ? sharing(original, rest) : null,
      sourceVisible: source.visible,
      panel: swinging,
      instances: new Int16Array(MOBILE_BOARDS.length),
      fromBoard: [],
      toBoard: [],
    };
    if (entry.rest) source.geometry = entry.rest;
    else source.visible = false;
    const meshToWorld = source.matrixWorld;
    const worldToMesh = meshToWorld.clone().invert();
    for (let i = 0; i < source.count; i++) {
      const b = boards[i]!;
      const frame = BOARD_FRAMES[b]!;
      source.getMatrixAt(i, instance);
      entry.instances[b] = i;
      entry.fromBoard[b] = worldToMesh.clone().multiply(frame);
      entry.toBoard[b] = frame.clone().invert().multiply(meshToWorld).multiply(instance);
    }
    meshes.push(entry);
  }
  return { meshes, posedAt: new Float64Array(MOBILE_BOARDS.length).fill(NaN) };
}

/** Puts the library model back as it was. */
function disposePanelRig(rig: PanelRig) {
  for (const m of rig.meshes) {
    m.panel.removeFromParent();
    release(m.panel.geometry);
    m.panel.dispose();
    if (m.rest) {
      m.source.geometry = m.original;
      release(m.rest);
    }
    m.source.visible = m.sourceVisible;
  }
}

const POSE = new Matrix4();
const POSED = new Matrix4();

/** Poses the panels of the boards whose flip moved since last time. */
function posePanels(rig: PanelRig, flips: Flip[]) {
  const pivot = BOARD_PANEL.pivotY;
  for (let b = 0; b < flips.length; b++) {
    const f = flips[b]!;
    if (rig.posedAt[b] === f.t) continue;
    rig.posedAt[b] = f.t;
    // Turn about the pivot axis raised by the lift: T(0, pivot + lift, 0) · Rx(angle) · T(0, -pivot, 0).
    POSE.makeRotationX(f.angle).setPosition(
      0,
      pivot + f.lift - pivot * Math.cos(f.angle),
      -pivot * Math.sin(f.angle),
    );
    for (const m of rig.meshes) {
      POSED.multiplyMatrices(m.fromBoard[b]!, POSE).multiply(m.toBoard[b]!);
      m.panel.setMatrixAt(m.instances[b]!, POSED);
      m.panel.instanceMatrix.needsUpdate = true;
    }
  }
}

/** A board's lesson face: the canvas the painter draws on, and what it last drew. */
interface LessonScreen {
  /** Registered in `boardScreens` for the corner preview to mirror. */
  entry: BoardScreen;
  ctx: CanvasRenderingContext2D;
  texture: CanvasTexture;
  memory: BoardScreenMemory;
  run: BoardLesson | null;
  live: boolean;
  version: number;
  animating: boolean;
  paintedAt: number;
}

function createLessonScreen(): LessonScreen {
  const canvas = document.createElement("canvas");
  canvas.width = BOARD_SCREEN.width;
  canvas.height = BOARD_SCREEN.height;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return {
    entry: { canvas, paints: 0 },
    ctx: canvas.getContext("2d")!,
    texture,
    memory: createBoardScreenMemory(),
    run: null,
    live: false,
    version: -1,
    animating: false,
    paintedAt: -Infinity,
  };
}

function registerLessonScreen(boardId: string, screen: LessonScreen) {
  boardScreens.set(boardId, screen.entry);
  return () => {
    if (boardScreens.get(boardId) === screen.entry) boardScreens.delete(boardId);
    screen.texture.dispose();
  };
}

/**
 * Paints the lesson face when what it shows has changed (the joined lesson's playback, or where
 * a waiting lesson got to) or while the painter is mid-animation.
 */
function paintLessonScreen(boardId: string, screen: LessonScreen, now: number) {
  const s = useBoardLessons.getState();
  const run = s.boards[boardId];
  // Once the lesson is taken off, the face keeps its last picture while the board turns back.
  if (!run) return;
  const frame = liveBoard.frame;
  const live = s.joinedBoardId === boardId && frame?.boardId === boardId;
  const changed =
    run !== screen.run || live !== screen.live || (live && liveBoard.version !== screen.version);
  if (!(changed || screen.animating) || now - screen.paintedAt < MIN_PAINT_MS) return;
  const tableNumber = tableNumberOf(boardId);
  const view: BoardScreenView =
    live && frame
      ? { kind: "live", lesson: run.lesson, tableNumber, frame }
      : {
          kind: "standby",
          lesson: run.lesson,
          tableNumber,
          sceneIndex: run.sceneIndex,
          completed: run.completed,
        };
  screen.animating = paintBoardScreen(screen.ctx, view, screen.memory, now).animating;
  screen.run = run;
  screen.live = live;
  screen.version = liveBoard.version;
  screen.paintedAt = now;
  screen.texture.needsUpdate = true;
  screen.entry.paints += 1;
}

/** Both lesson pictures of a board, alive from when it gets a lesson until it has turned back. */
function LessonFaces({ boardId, plane }: { boardId: string; plane: PlaneGeometry }) {
  const [screen] = useState(createLessonScreen);
  useEffect(() => registerLessonScreen(boardId, screen), [boardId, screen]);
  useFrame(() => paintLessonScreen(boardId, screen, performance.now()));
  return FACES.map((side) => (
    <mesh key={side} geometry={plane} position-z={side * FACE_Z} rotation={LESSON_ROTATION[side]}>
      {/* A touch of glow keeps the lesson readable in the hall's warm, low light. */}
      <meshStandardMaterial
        map={screen.texture}
        emissiveMap={screen.texture}
        emissive="#ffffff"
        emissiveIntensity={0.2}
        roughness={0.4}
      />
    </mesh>
  ));
}

/** One rolling board's pictures, carried on a pivot that follows the modelled panel. */
function BoardFaces({
  board,
  index,
  flips,
  plane,
}: {
  board: MobileBoard;
  index: number;
  flips: RefObject<Flip[]>;
  plane: PlaneGeometry;
}) {
  const { boardId, wall } = board;
  const drawingTexture = useBoardDrawingTexture(boardId);
  const pivot = useRef<Group>(null);
  const drawing = useRef<Group>(null);
  const lesson = useRef<Group>(null);
  const hasLesson = useBoardLessons((s) => s.boards[boardId] !== undefined);
  // The lesson face outlasts the lesson until the board has turned back over.
  const [showLesson, setShowLesson] = useState(hasLesson);
  if (hasLesson && !showLesson) setShowLesson(true);

  // After the camera rig (priority -1), so this sees where the camera is this frame.
  useFrame(({ camera }) => {
    const f = flips.current[index]!;
    const axisY = BOARD_PANEL.pivotY + f.lift;
    const p = pivot.current;
    if (p) {
      p.position.y = axisY;
      p.rotation.x = f.angle;
    }
    // Swap pictures as the panel passes edge-on to the camera, where neither face can be seen
    // (the camera has no parent, so its position is in world space). At rest the angle is 0 or π,
    // which this always puts on the drawing's side or the lesson's.
    EYE.copy(camera.position).applyMatrix4(FROM_WORLD[index]!);
    const over = f.angle > edgeOnAngle(EYE.y - axisY, EYE.z);
    if (drawing.current) drawing.current.visible = !over;
    if (lesson.current) lesson.current.visible = over;
    if (showLesson && f.t === 0 && !useBoardLessons.getState().boards[boardId]) {
      setShowLesson(false);
    }
  });

  return (
    <group position={[wall.x, 0, wall.z]} rotation-y={wall.rotationY}>
      <group ref={pivot} position-y={BOARD_PANEL.pivotY}>
        <group ref={drawing}>
          {FACES.map((side) => (
            <mesh
              key={side}
              geometry={plane}
              position-z={side * FACE_Z}
              rotation={DRAWING_ROTATION[side]}
            >
              <meshStandardMaterial map={drawingTexture} roughness={0.3} />
            </mesh>
          ))}
        </group>
        <group ref={lesson} visible={false}>
          {showLesson && <LessonFaces boardId={boardId} plane={plane} />}
        </group>
      </group>
    </group>
  );
}

export function BoardPanels() {
  const { scene } = useGLTF(LIBRARY_URL);
  const flips = useRef<Flip[]>(MOBILE_BOARDS.map(() => ({ t: 0, angle: 0, lift: 0 })));
  const rig = useRef<PanelRig | null>(null);
  const [plane] = useState(
    () => new PlaneGeometry(BOARD_PANEL.surfaceWidth, BOARD_PANEL.surfaceHeight),
  );
  useEffect(() => () => plane.dispose(), [plane]);

  useEffect(() => {
    const built = buildPanelRig(scene);
    if (built.meshes.length === 0 && process.env.NODE_ENV !== "production") {
      console.warn("BoardPanels: rolling whiteboard panels not found in the library model");
    }
    rig.current = built;
    return () => {
      rig.current = null;
      disposePanelRig(built);
    };
  }, [scene]);

  // Runs before the faces' frame callbacks (priority 0), so pictures and panel move together.
  useFrame((_, dt) => {
    stepFlips(flips.current, Math.min(dt, MAX_STEP));
    if (rig.current) posePanels(rig.current, flips.current);
  }, -1);

  return MOBILE_BOARDS.map((board, i) => (
    <BoardFaces key={board.boardId} board={board} index={i} flips={flips} plane={plane} />
  ));
}
