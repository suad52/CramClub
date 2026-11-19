import { FACIAL_HEAD_LIMITS, type FacialParams } from "@ovr/shared";

/**
 * Pure maths that turns one MediaPipe Face Landmarker result into the eight values OVR uses.
 * Kept free of browser APIs so it can be unit-tested.
 */

export interface BlendshapeScore {
  categoryName: string;
  score: number;
}

/** One frame's measurements before calibration. Angles in radians. */
export interface RawFace {
  yaw: number;
  pitch: number;
  roll: number;
  blinkLeft: number;
  blinkRight: number;
  jawOpen: number;
  smile: number;
  browRaise: number;
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Head angles from MediaPipe's facial transformation matrix (4×4, column-major). Column 1 is
 * the face's up axis and column 2 points out of the face toward the camera. The camera looks
 * down -Z with +X to the right of the (unmirrored) image, which is the user's own left.
 */
export function headAnglesFromMatrix(
  data: ArrayLike<number>,
): Pick<RawFace, "yaw" | "pitch" | "roll"> | null {
  if (data.length < 16) return null;
  const ux = data[4]!;
  const uy = data[5]!;
  const fx = data[8]!;
  const fy = data[9]!;
  const fz = data[10]!;
  if (Math.hypot(fx, fy, fz) < 1e-6 || Math.hypot(ux, uy) < 1e-6) return null;
  return {
    yaw: Math.atan2(fx, fz),
    pitch: Math.atan2(fy, Math.hypot(fx, fz)),
    roll: Math.atan2(ux, uy),
  };
}

/** Picks the blendshapes OVR uses. Returns null when the result has no usable face. */
export function extractRawFace(
  blendshapes: readonly BlendshapeScore[] | undefined,
  matrix: ArrayLike<number> | undefined,
): RawFace | null {
  if (!blendshapes || blendshapes.length === 0) return null;
  const score = new Map(blendshapes.map((b) => [b.categoryName, b.score]));
  const s = (name: string) => score.get(name) ?? 0;
  const angles = (matrix && headAnglesFromMatrix(matrix)) ?? { yaw: 0, pitch: 0, roll: 0 };
  return {
    ...angles,
    blinkLeft: s("eyeBlinkLeft"),
    blinkRight: s("eyeBlinkRight"),
    jawOpen: s("jawOpen"),
    smile: (s("mouthSmileLeft") + s("mouthSmileRight")) / 2,
    browRaise: Math.max(s("browInnerUp"), (s("browOuterUpLeft") + s("browOuterUpRight")) / 2),
  };
}

/** Averages several frames into a resting-face baseline. */
export function averageFaces(samples: readonly RawFace[]): RawFace {
  const keys = [
    "yaw",
    "pitch",
    "roll",
    "blinkLeft",
    "blinkRight",
    "jawOpen",
    "smile",
    "browRaise",
  ] as const;
  const out = Object.fromEntries(keys.map((k) => [k, 0])) as unknown as RawFace;
  if (samples.length === 0) return out;
  for (const sample of samples) for (const k of keys) out[k] += sample[k] / samples.length;
  return out;
}

/** How far above the resting value each expression must move to count as "fully on". */
export const EXPRESSION_RANGE = { blink: 0.5, jawOpen: 0.45, smile: 0.55, browRaise: 0.4 } as const;

export interface MappingOptions {
  /** Mirror the avatar (like looking in a mirror): flips turn and tilt, swaps eyes. */
  mirror: boolean;
}

/** Converts a raw frame into calibrated, normalized {@link FacialParams}. */
export function toFacialParams(
  raw: RawFace,
  neutral: RawFace,
  { mirror }: MappingOptions,
): FacialParams {
  const rel = (v: number, n: number, range: number) => clamp((v - n) / range, 0, 1);
  const angle = (v: number, n: number, limit: number) => clamp((v - n) / limit, -1, 1);
  let headYaw = angle(raw.yaw, neutral.yaw, FACIAL_HEAD_LIMITS.yaw);
  let headRoll = angle(raw.roll, neutral.roll, FACIAL_HEAD_LIMITS.roll);
  let eyeBlinkLeft = rel(raw.blinkLeft, neutral.blinkLeft, EXPRESSION_RANGE.blink);
  let eyeBlinkRight = rel(raw.blinkRight, neutral.blinkRight, EXPRESSION_RANGE.blink);
  if (mirror) {
    headYaw = -headYaw;
    headRoll = -headRoll;
    [eyeBlinkLeft, eyeBlinkRight] = [eyeBlinkRight, eyeBlinkLeft];
  }
  return {
    headYaw,
    headPitch: angle(raw.pitch, neutral.pitch, FACIAL_HEAD_LIMITS.pitch),
    headRoll,
    eyeBlinkLeft,
    eyeBlinkRight,
    jawOpen: rel(raw.jawOpen, neutral.jawOpen, EXPRESSION_RANGE.jawOpen),
    smile: rel(raw.smile, neutral.smile, EXPRESSION_RANGE.smile),
    browRaise: rel(raw.browRaise, neutral.browRaise, EXPRESSION_RANGE.browRaise),
  };
}

/**
 * One Euro filter (Casiez et al., 2012): heavy smoothing while a value is still, light
 * smoothing while it moves fast. Removes webcam jitter without making blinks feel laggy.
 */
export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t: number | null = null;

  constructor(
    private readonly minCutoff = 1,
    private readonly beta = 0,
    private readonly dCutoff = 1,
  ) {}

  private static alpha(dt: number, cutoff: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  /** Filters a sample taken at `time` seconds. */
  filter(value: number, time: number): number {
    if (this.x === null || this.t === null) {
      this.x = value;
      this.t = time;
      return value;
    }
    const dt = Math.max(1e-3, time - this.t);
    this.t = time;
    const rawDx = (value - this.x) / dt;
    const aD = OneEuroFilter.alpha(dt, this.dCutoff);
    this.dx = aD * rawDx + (1 - aD) * this.dx;
    const a = OneEuroFilter.alpha(dt, this.minCutoff + this.beta * Math.abs(this.dx));
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }

  reset() {
    this.x = null;
    this.t = null;
    this.dx = 0;
  }
}

type Channel = keyof FacialParams;

/** One filter per channel, tuned so the head is steady and eyes/mouth stay quick. */
export class FaceSmoother {
  private readonly filters: Record<Channel, OneEuroFilter> = {
    headYaw: new OneEuroFilter(1.2, 1.5),
    headPitch: new OneEuroFilter(1.2, 1.5),
    headRoll: new OneEuroFilter(1.2, 1.5),
    eyeBlinkLeft: new OneEuroFilter(3, 8),
    eyeBlinkRight: new OneEuroFilter(3, 8),
    jawOpen: new OneEuroFilter(2.5, 4),
    smile: new OneEuroFilter(1.5, 2),
    browRaise: new OneEuroFilter(1.5, 2),
  };

  smooth(params: FacialParams, time: number): FacialParams {
    const out = {} as FacialParams;
    for (const key of Object.keys(this.filters) as Channel[]) {
      out[key] = this.filters[key].filter(params[key], time);
    }
    return out;
  }

  reset() {
    for (const f of Object.values(this.filters)) f.reset();
  }
}
