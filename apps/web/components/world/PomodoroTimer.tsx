"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import {
  type Camera,
  CanvasTexture,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  type Scene,
  Shape,
  Vector3,
  type WebGLRenderer,
  WebGLRenderTarget,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { getSeat } from "@/lib/game/actions";
import {
  type PomodoroPhase,
  type PomodoroState,
  phaseProgress,
  remainingMs,
  usePomodoro,
} from "@/lib/game/pomodoro";
import { type Quality, useGameStore } from "@/lib/game/store";
import { useFocusStore } from "@/lib/focus/store";
import { type TimerSpot, timerSpot } from "@/lib/world/tableTimer";

/*
 * The Pomodoro timer on the table: a little walnut desk clock with an LED display, which pops up
 * in front of you when you sit down. It shows the time left in the current phase (the focus length
 * while you get ready), what the phase is, how far through it you are and the pomodoros done in
 * this set. While you focus with your own face tracking on, a small meter sits beside the phase:
 * a green dot while it sees you at the desk and how much of this pomodoro it has (lib/focus/; only
 * on-device face numbers, never video). Built procedurally (no model file).
 *
 * In metres: origin on the table under its middle, the display facing +Z.
 */

/** The body's width (left–right), the rounding on its edges, and its side profile (z toward you). */
const WIDTH = 0.088;
const BEVEL = 0.003;
const PROFILE: readonly (readonly [number, number])[] = [
  [-0.02, 0],
  [0.02, 0],
  [0.008, 0.05],
  [-0.016, 0.05],
];
const HEIGHT = 0.05 + 2 * BEVEL;
/** The front leans back so you read it from above: how far its normal tilts up from +Z. */
const LEAN = Math.atan2(0.02 - 0.008, 0.05);

/** The display's canvas, and its size on the clock's face. */
const CANVAS_W = 512;
const CANVAS_H = 250;
const DISPLAY_W = 0.074;
const DISPLAY_H = (DISPLAY_W * CANVAS_H) / CANVAS_W;

/* ---- The model ---- */

/** A polygon with its corners rounded off (radius `r`). */
function roundedShape(points: readonly (readonly [number, number])[], r: number) {
  const shape = new Shape();
  const n = points.length;
  points.forEach(([cx, cy], i) => {
    const [px, py] = points[(i + n - 1) % n]!;
    const [nx, ny] = points[(i + 1) % n]!;
    const toPrev = Math.hypot(px - cx, py - cy);
    const toNext = Math.hypot(nx - cx, ny - cy);
    const ax = cx + ((px - cx) / toPrev) * r;
    const ay = cy + ((py - cy) / toPrev) * r;
    if (i === 0) shape.moveTo(ax, ay);
    else shape.lineTo(ax, ay);
    shape.quadraticCurveTo(cx, cy, cx + ((nx - cx) / toNext) * r, cy + ((ny - cy) / toNext) * r);
  });
  shape.closePath();
  return shape;
}

function bodyGeometry() {
  const geometry = new ExtrudeGeometry(roundedShape(PROFILE, 0.004), {
    depth: WIDTH,
    bevelEnabled: true,
    bevelThickness: BEVEL,
    bevelSize: BEVEL,
    bevelSegments: 3,
    curveSegments: 4,
  });
  // Extruded along z: turn it so the profile's x runs toward you (+Z) and the width along X,
  // centred, with the rounded bottom resting on the table.
  geometry.rotateY(-Math.PI / 2);
  geometry.translate(WIDTH / 2, BEVEL, 0);
  return geometry;
}

/** A soft dark patch under it, so it sits on the table even without shadows. */
function contactTexture() {
  const S = 128;
  const canvas = document.createElement("canvas");
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(22, 11, 4, 0.55)");
  g.addColorStop(0.5, "rgba(22, 11, 4, 0.3)");
  g.addColorStop(1, "rgba(22, 11, 4, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/* ---- The display ---- */

/** LED colours: amber while you get ready, red for focus, green for a break. */
const COLOURS = ["#ffb23d", "#ff4a2e", "#3ee483", "#3ee483"] as const;
/** The "seen at desk" dot, lit while the camera sees you. */
const SEEN_COLOUR = "#3ee483";
const LABELS = ["READY", "FOCUS", "BREAK", "LONG BREAK"] as const;
type Mode = 0 | 1 | 2 | 3;
const modeOf = (phase: PomodoroPhase): Mode =>
  phase === "focus" ? 1 : phase === "shortBreak" ? 2 : phase === "longBreak" ? 3 : 0;

/** Seven-segment digits as bit masks of segments a–g (a = 1 … g = 64). */
const DIGIT_SEGMENTS = [63, 6, 91, 79, 102, 109, 125, 7, 127, 111] as const;
/** A digit cell: width, height, stroke, and where the four digits and the colon go. */
const DW = 84;
const DH = 132;
const DT = 15;
const DY = 70;
const DIGIT_X = [53, 155, 273, 375] as const;
const COLON_X = 256;
/** Segments a–g as lines across the cell. */
const SEGMENT_LINES = [
  [DT / 2, DT / 2, DW - DT / 2, DT / 2],
  [DW - DT / 2, DT / 2, DW - DT / 2, DH / 2],
  [DW - DT / 2, DH / 2, DW - DT / 2, DH - DT / 2],
  [DT / 2, DH - DT / 2, DW - DT / 2, DH - DT / 2],
  [DT / 2, DH / 2, DT / 2, DH - DT / 2],
  [DT / 2, DT / 2, DT / 2, DH / 2],
  [DT / 2, DH / 2, DW - DT / 2, DH / 2],
] as const;

/** One segment: a long hexagon from (x1, y1) to (x2, y2), with a hairline gap at each end. */
function segment(c: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const h = DT / 2;
  const g = 3;
  c.beginPath();
  c.moveTo(x1 + ux * g, y1 + uy * g);
  c.lineTo(x1 + ux * (g + h) - uy * h, y1 + uy * (g + h) + ux * h);
  c.lineTo(x2 - ux * (g + h) - uy * h, y2 - uy * (g + h) + ux * h);
  c.lineTo(x2 - ux * g, y2 - uy * g);
  c.lineTo(x2 - ux * (g + h) + uy * h, y2 - uy * (g + h) - ux * h);
  c.lineTo(x1 + ux * (g + h) + uy * h, y1 + uy * (g + h) - ux * h);
  c.closePath();
  c.fill();
}

/** What the display shows; it's repainted only when one of these changes. */
interface DisplayView {
  /** Seconds to show as mm:ss, or -1 for every segment lit (the start-up flash). */
  secs: number;
  digitsOn: boolean;
  colon: boolean;
  mode: Mode;
  paused: boolean;
  ringing: boolean;
  /** Pomodoros done in this set, and the set's size. */
  done: number;
  every: number;
  /** Progress through the phase, in thousandths. */
  progress: number;
  /** Seen at the desk this pomodoro (%); -1 hides the meter, -2 shows it before there's a figure. */
  seen: number;
  /** The camera sees you at the desk right now. */
  seenNow: boolean;
}

function paintDisplay(c: CanvasRenderingContext2D, v: DisplayView) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.shadowBlur = 0;
  c.globalAlpha = 1;
  // A smoked-glass panel.
  const panel = c.createLinearGradient(0, 0, 0, CANVAS_H);
  panel.addColorStop(0, "#140e0b");
  panel.addColorStop(1, "#050303");
  c.fillStyle = panel;
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const lit = COLOURS[v.mode];
  c.fillStyle = lit;
  c.shadowColor = lit;
  c.shadowBlur = 10;
  c.font = "700 26px ui-monospace, Menlo, Consolas, monospace";
  c.textBaseline = "middle";
  const label = v.ringing ? "TIME'S UP" : v.paused ? "PAUSED" : LABELS[v.mode];
  c.fillText(label, 30, 36);
  if (v.seen !== -1) {
    // The focus meter: a dot (green while it sees you) and the share of the pomodoro so far.
    const x = 30 + c.measureText(label).width + 30;
    const dot = v.seenNow ? SEEN_COLOUR : lit;
    c.save();
    c.fillStyle = dot;
    c.shadowColor = dot;
    c.globalAlpha = v.seenNow ? 1 : 0.3;
    c.beginPath();
    c.arc(x, 36, 8, 0, Math.PI * 2);
    c.fill();
    c.restore();
    c.font = "700 22px ui-monospace, Menlo, Consolas, monospace";
    c.fillText(v.seen >= 0 ? `${v.seen}%` : "--%", x + 16, 37);
  }
  for (let i = 0; i < v.every; i++) {
    c.globalAlpha = i < v.done ? 1 : 0.15;
    c.beginPath();
    c.arc(CANVAS_W - 34 - (v.every - 1 - i) * 24, 36, 7, 0, Math.PI * 2);
    c.fill();
  }

  // The digits, slanted a little like a real LED clock's, over the faint unlit segments.
  const mm = Math.floor(v.secs / 60);
  const ss = v.secs % 60;
  const digits =
    v.secs < 0 ? [8, 8, 8, 8] : [Math.floor(mm / 10) % 10, mm % 10, Math.floor(ss / 10), ss % 10];
  c.setTransform(1, 0, -0.08, 1, 0.08 * (DY + DH), 0);
  digits.forEach((digit, i) => {
    const mask = DIGIT_SEGMENTS[digit]!;
    SEGMENT_LINES.forEach(([x1, y1, x2, y2], bit) => {
      const on = v.digitsOn && (mask & (1 << bit)) !== 0;
      c.globalAlpha = on ? 1 : 0.07;
      c.shadowBlur = on ? 18 : 0;
      const x = DIGIT_X[i]!;
      segment(c, x + x1, DY + y1, x + x2, DY + y2);
    });
  });
  c.globalAlpha = v.digitsOn && v.colon ? 1 : 0.07;
  c.shadowBlur = c.globalAlpha === 1 ? 18 : 0;
  for (const y of [DY + DH * 0.3, DY + DH * 0.7]) {
    c.beginPath();
    c.arc(COLON_X, y, 8, 0, Math.PI * 2);
    c.fill();
  }
  c.setTransform(1, 0, 0, 1, 0, 0);

  // How far through the phase.
  c.shadowBlur = 0;
  c.globalAlpha = 0.15;
  c.fillRect(30, 222, CANVAS_W - 60, 8);
  c.globalAlpha = 1;
  c.shadowBlur = 8;
  c.fillRect(30, 222, ((CANVAS_W - 60) * v.progress) / 1000, 8);

  // A sheen across the glass.
  c.shadowBlur = 0;
  const sheen = c.createLinearGradient(0, 0, CANVAS_W * 0.7, CANVAS_H);
  sheen.addColorStop(0, "rgba(255, 240, 225, 0.08)");
  sheen.addColorStop(0.5, "rgba(255, 240, 225, 0)");
  c.fillStyle = sheen;
  c.fillRect(0, 0, CANVAS_W, CANVAS_H);
}

/* ---- The rig: the model and its animation state ---- */

interface TimerRig {
  /** Placed at the seat's spot by the component. */
  root: Group;
  /** Scales it in and out. */
  pop: Group;
  /** Buzzes on the table while the alarm goes. */
  jiggle: Group;
  contact: MeshBasicMaterial;
  screen: CanvasRenderingContext2D;
  screenTexture: CanvasTexture;
  /** Meshes that cast and take shadows (when the quality setting has them). */
  solids: Mesh[];
  resources: { dispose: () => void }[];
  /** Whether it's out on the table, how long since it last came or went, and its size then. */
  seated: boolean;
  age: number;
  from: number;
  scale: number;
  /** The timer state it last saw. */
  phase: PomodoroPhase;
  rings: number;
  /** Seconds into the start-up flash or the alarm; -1 when not. */
  start: number;
  ring: number;
  /** The phase that just ended, while the alarm goes. */
  ringMode: Mode;
  view: DisplayView;
  painted: boolean;
}

function buildTimerRig(): TimerRig {
  const walnut = new MeshPhysicalMaterial({
    color: "#5a3722",
    roughness: 0.42,
    clearcoat: 0.35,
    clearcoatRoughness: 0.35,
  });
  const button = new MeshPhysicalMaterial({ color: "#2b211b", roughness: 0.5, metalness: 0.2 });
  const bodyGeo = bodyGeometry();
  const buttonGeo = new RoundedBoxGeometry(0.034, 0.005, 0.01, 2, 0.002);
  const body = new Mesh(bodyGeo, walnut);
  // The snooze bar on top.
  const snooze = new Mesh(buttonGeo, button);
  snooze.position.set(0, HEIGHT + 0.0015, -0.004);

  const canvas = document.createElement("canvas");
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const screen = canvas.getContext("2d")!;
  const screenTexture = new CanvasTexture(canvas);
  screenTexture.colorSpace = SRGBColorSpace;
  screenTexture.anisotropy = 4;
  const screenMat = new MeshBasicMaterial({ map: screenTexture, toneMapped: false });
  const screenGeo = new PlaneGeometry(DISPLAY_W, DISPLAY_H);
  const display = new Mesh(screenGeo, screenMat);
  // On the middle of the leaning front face, just proud of it.
  const out = BEVEL + 0.0008;
  display.position.set(
    0,
    0.025 + BEVEL + Math.sin(LEAN) * out,
    (0.02 + 0.008) / 2 + Math.cos(LEAN) * out,
  );
  display.rotation.x = -LEAN;

  const shadowPrint = contactTexture();
  const contact = new MeshBasicMaterial({
    map: shadowPrint,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const contactGeo = new PlaneGeometry(0.13, 0.075);
  const patch = new Mesh(contactGeo, contact);
  patch.rotation.x = -Math.PI / 2;
  patch.position.y = 0.0008;
  patch.renderOrder = -1;

  const jiggle = new Group();
  jiggle.add(body, snooze, display);
  const pop = new Group();
  pop.add(jiggle, patch);
  const root = new Group();
  root.name = "PomodoroTimer";
  root.add(pop);
  root.visible = false;
  pop.scale.setScalar(1e-4);

  return {
    root,
    pop,
    jiggle,
    contact,
    screen,
    screenTexture,
    solids: [body, snooze],
    resources: [
      walnut,
      button,
      bodyGeo,
      buttonGeo,
      screenTexture,
      screenMat,
      screenGeo,
      shadowPrint,
      contact,
      contactGeo,
    ],
    seated: false,
    age: 0,
    from: 0,
    scale: 0,
    phase: "idle",
    rings: 0,
    start: -1,
    ring: -1,
    ringMode: 0,
    view: {
      secs: 0,
      digitsOn: true,
      colon: true,
      mode: 0,
      paused: false,
      ringing: false,
      done: 0,
      every: 4,
      progress: 0,
      seen: -1,
      seenNow: false,
    },
    painted: false,
  };
}

function disposeTimerRig(rig: TimerRig) {
  for (const r of rig.resources) r.dispose();
}

function setTimerShadows(rig: TimerRig, on: boolean) {
  for (const m of rig.solids) {
    m.castShadow = on;
    m.receiveShadow = on;
  }
}

/**
 * Compiles the timer's shaders without drawing it (hidden or not: compiling walks every object).
 * Three builds a program for where it draws, and through the post-processing composer (every
 * quality but low) the scene is drawn into a render target, with no tone mapping and linear
 * output, so one is bound for the compile too, or it would build programs the real draw never
 * uses. The compile itself happens straight away; the promise only waits for the driver.
 */
function precompileTimer(
  rig: TimerRig,
  gl: WebGLRenderer,
  camera: Camera,
  scene: Scene,
  viaComposer: boolean,
) {
  const target = viaComposer ? new WebGLRenderTarget(1, 1) : null;
  const previous = gl.getRenderTarget();
  gl.setRenderTarget(target);
  void gl.compileAsync(rig.root, camera, scene).catch(() => {});
  gl.setRenderTarget(previous);
  target?.dispose();
}

const POP_IN_SECONDS = 0.35;
const POP_OUT_SECONDS = 0.25;
/** Every segment lights for a moment when a pomodoro starts, as a clock does when it's set. */
const START_SECONDS = 0.35;
const RING_SECONDS = 2.2;
/** A frame this long after the last means drawing was paused (a hidden tab, a full-screen lesson). */
const PAUSED_SECONDS = 1;

/** Up to a little past 1 and back: a springy pop. */
function easeOutBack(x: number) {
  const c1 = 2.2;
  return 1 + (c1 + 1) * (x - 1) ** 3 + c1 * (x - 1) ** 2;
}

/** Takes the timer state as it is now, with nothing left over to flash or ring. */
function settleTimer(rig: TimerRig, s: PomodoroState) {
  rig.phase = s.phase;
  rig.rings = s.rings;
  rig.start = -1;
  rig.ring = -1;
  rig.jiggle.position.y = 0;
  rig.jiggle.rotation.set(0, 0, 0);
  rig.contact.opacity = 1;
  rig.painted = false;
}

/** Repaints the display if what it should show has changed (about once a second). */
function updateDisplay(rig: TimerRig, s: PomodoroState) {
  const now = Date.now();
  const left = remainingMs(s, now);
  const ringing = rig.ring >= 0;
  const paused = !ringing && s.phase !== "idle" && s.pausedRemaining !== null;
  const running = s.phase !== "idle" && !paused;
  const every = s.settings.longBreakEvery;
  // Blinks: the colon each second while it runs, the digits while it's paused or the alarm goes.
  const digitsOn = ringing
    ? Math.floor(rig.ring / 0.22) % 2 === 0
    : paused
      ? Math.floor(now / 600) % 2 === 0
      : true;
  const secs = rig.start >= 0 ? -1 : ringing ? 0 : Math.ceil(left / 1000);
  const colon = !running || ringing || rig.start >= 0 || left % 1000 >= 500;
  const mode = ringing ? rig.ringMode : modeOf(s.phase);
  const done = s.phase === "longBreak" ? every : Math.min(s.inSet, every - 1);
  const progress = ringing ? 1000 : Math.round(phaseProgress(s, now) * 1000);
  const focus = useFocusStore.getState();
  const meter = !ringing && rig.start < 0 && s.phase === "focus" && focus.cameraOn;
  const seen = meter ? (focus.percent ?? -2) : -1;
  const seenNow = meter && focus.seenNow;

  const v = rig.view;
  if (
    rig.painted &&
    v.secs === secs &&
    v.digitsOn === digitsOn &&
    v.colon === colon &&
    v.mode === mode &&
    v.paused === paused &&
    v.ringing === ringing &&
    v.done === done &&
    v.every === every &&
    v.progress === progress &&
    v.seen === seen &&
    v.seenNow === seenNow
  )
    return;
  v.secs = secs;
  v.digitsOn = digitsOn;
  v.colon = colon;
  v.mode = mode;
  v.paused = paused;
  v.ringing = ringing;
  v.done = done;
  v.every = every;
  v.progress = progress;
  v.seen = seen;
  v.seenNow = seenNow;
  paintDisplay(rig.screen, v);
  rig.screenTexture.needsUpdate = true;
  rig.painted = true;
}

/** Moves the timer on a frame: popping in or out, the start-up flash, the alarm, the display. */
function stepTimer(rig: TimerRig, seated: boolean, rawDt: number) {
  const dt = Math.min(rawDt, 0.1);
  if (seated !== rig.seated) {
    rig.seated = seated;
    rig.age = 0;
    rig.from = rig.scale;
    // Out it comes showing the time now, with nothing left over from while it was away.
    if (seated) settleTimer(rig, usePomodoro.getState());
  }
  if (!seated && rig.scale === 0) return;
  rig.age += dt;
  rig.scale = seated
    ? easeOutBack(Math.min(1, rig.age / POP_IN_SECONDS))
    : rig.from * (1 - Math.min(1, rig.age / POP_OUT_SECONDS) ** 3);
  rig.pop.scale.setScalar(Math.max(rig.scale, 1e-4));
  rig.root.visible = rig.scale > 0;

  const s = usePomodoro.getState();
  // Whatever started or rang while drawing was paused is old news (the alarm sounded on time): a
  // flash or a buzz now would be late and silent.
  if (rawDt > PAUSED_SECONDS) settleTimer(rig, s);
  if (s.phase === "focus" && rig.phase !== "focus") rig.start = 0;
  if (s.rings !== rig.rings) {
    rig.ring = 0;
    rig.ringMode = modeOf(rig.phase);
  }
  rig.phase = s.phase;
  rig.rings = s.rings;
  if (rig.start >= 0) {
    rig.start += dt;
    if (rig.start >= START_SECONDS) rig.start = -1;
  }

  if (rig.ring >= 0) {
    rig.ring += dt;
    const t = rig.ring;
    const j = rig.jiggle;
    if (t >= RING_SECONDS) {
      rig.ring = -1;
      j.position.y = 0;
      j.rotation.set(0, 0, 0);
      rig.contact.opacity = 1;
    } else {
      // The alarm buzzes it against the table: a fast rattle with little hops, in bursts that
      // match the beeps.
      const burst = Math.floor(t / 0.13) % 2 === 0 ? 1 : 0.25;
      const strength = burst * Math.min(1, t / 0.04) * Math.min(1, (RING_SECONDS - t) / 0.3);
      const hop = 0.0012 * strength * Math.abs(Math.sin(t * Math.PI * 18));
      const tau = Math.PI * 2;
      j.position.y = hop;
      j.rotation.set(
        0.012 * strength * Math.sin(t * tau * 29 + 1.1),
        0.016 * strength * Math.sin(t * tau * 17 + 0.4),
        0.02 * strength * Math.sin(t * tau * 23),
      );
      rig.contact.opacity = 1 - hop * 200;
    }
  }
  updateDisplay(rig, s);
}

/** Each seat's spot, worked out the first time someone sits there. */
const spots = new Map<string, TimerSpot | null>();
function spotFor(seatId: string | null) {
  if (!seatId) return null;
  let spot = spots.get(seatId);
  if (spot === undefined) {
    const seat = getSeat(seatId);
    spot = seat ? timerSpot(seat) : null;
    spots.set(seatId, spot);
  }
  return spot;
}

const UP = new Vector3(0, 1, 0);

/**
 * The desk clock in front of whoever is seated: pops up when you sit, shrinks away when you
 * stand. It reads the Pomodoro store every frame (no React renders for the clock) and repaints its
 * display only when what it shows changes. The model is built once and kept between sittings
 * (hidden, so it costs nothing to draw) rather than rebuilt, so its shaders are compiled once.
 */
export function PomodoroTimer({ quality }: { quality: Quality }) {
  const spot = useGameStore((s) => spotFor(s.seatId));
  const [rig] = useState(buildTimerRig);
  // It shrinks away where it stood.
  const [last, setLast] = useState(spot);
  if (spot && spot !== last) setLast(spot);
  const placed = spot ?? last;
  const pose = useMemo(() => {
    if (!placed) return null;
    const { normal: n } = placed;
    const quaternion = new Quaternion()
      .setFromUnitVectors(UP, new Vector3(n.x, n.y, n.z))
      .multiply(new Quaternion().setFromAxisAngle(UP, placed.rotationY));
    return { position: new Vector3(placed.x, placed.y, placed.z), quaternion };
  }, [placed]);

  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => () => disposeTimerRig(rig), [rig]);
  useEffect(() => {
    setTimerShadows(rig, quality !== "low");
    // Compile its shaders now, in the background, so sitting down the first time doesn't stutter.
    precompileTimer(rig, gl, camera, scene, quality !== "low");
  }, [rig, quality, gl, camera, scene]);

  const seated = spot !== null;
  useFrame((_, dt) => stepTimer(rig, seated, dt));

  return (
    <group position={pose?.position} quaternion={pose?.quaternion}>
      <primitive object={rig.root} />
    </group>
  );
}
