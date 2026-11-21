import { NET, wrapAngle } from "@ovr/shared";

/**
 * Remote players are drawn a little in the past (NET.INTERP_DELAY_MS) and glided between the
 * positions the server last sent, so 12 moves a second look like smooth walking. One buffer per
 * remote player: a fixed ring of preallocated samples, so a frame never allocates.
 */

/** One received position, stamped with the local clock (performance.now()) when it arrived. */
export interface NetSample {
  t: number;
  x: number;
  y: number;
  z: number;
  /** Body facing, radians. */
  ry: number;
  /** Ground speed m/s. */
  speed: number;
}

/** Moves arrive about this far apart while someone walks. */
export const MOVE_INTERVAL_MS = 1000 / NET.MOVE_HZ;
/**
 * A gap longer than this means the player stood still in between (nothing changed, so nothing
 * was sent). The last sample is then re-stamped to just before the new one, so the walk starts
 * from where they stood instead of leaping most of the way at once.
 */
export const HOLD_GAP_MS = MOVE_INTERVAL_MS * 3;
/** A jump this long (metres) between two samples is a teleport (the lift, a respawn): snap. */
export const SNAP_DISTANCE = 2.5;

const emptySample = (): NetSample => ({ t: 0, x: 0, y: 0, z: 0, ry: 0, speed: 0 });

function copySample(to: NetSample, from: NetSample) {
  to.t = from.t;
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.ry = from.ry;
  to.speed = from.speed;
}

export class SnapshotBuffer {
  private readonly ring: NetSample[];
  /** Index of the oldest sample. */
  private head = 0;
  private count = 0;

  constructor(readonly capacity = 12) {
    this.ring = Array.from({ length: Math.max(2, capacity) }, emptySample);
  }

  get size() {
    return this.count;
  }

  /** The i-th oldest sample (0 = oldest). */
  private at(i: number): NetSample {
    return this.ring[(this.head + i) % this.ring.length]!;
  }

  /** The newest sample, or null when empty. */
  latest(): NetSample | null {
    return this.count ? this.at(this.count - 1) : null;
  }

  clear() {
    this.head = 0;
    this.count = 0;
  }

  /** Appends a slot (dropping the oldest when full) and returns it to fill in. */
  private slot(): NetSample {
    if (this.count === this.ring.length) {
      this.head = (this.head + 1) % this.ring.length;
      this.count -= 1;
    }
    this.count += 1;
    return this.at(this.count - 1);
  }

  /** Adds a sample that arrived at local time `t`. */
  push(t: number, x: number, y: number, z: number, ry: number, speed: number) {
    const last = this.latest();
    if (last) {
      // Same instant (two updates in one patch): the newer values win.
      if (t <= last.t) {
        last.x = x;
        last.y = y;
        last.z = z;
        last.ry = ry;
        last.speed = speed;
        return;
      }
      const quiet = t - last.t > HOLD_GAP_MS;
      const dt = (quiet ? MOVE_INTERVAL_MS : t - last.t) / 1000;
      const jump = Math.hypot(x - last.x, y - last.y, z - last.z);
      if (jump > Math.max(SNAP_DISTANCE, NET.MAX_SPEED * dt * 1.5)) {
        this.clear();
      } else if (quiet) {
        const held = this.slot();
        copySample(held, this.at(this.count - 2));
        held.t = t - MOVE_INTERVAL_MS;
        held.speed = 0;
      }
    }
    const s = this.slot();
    s.t = t;
    s.x = x;
    s.y = y;
    s.z = z;
    s.ry = ry;
    s.speed = speed;
  }

  /**
   * Writes the interpolated state at local time `t` into `out` (no allocation). Before the oldest
   * sample it holds the oldest; past the newest it holds the newest (no guessing ahead). Samples
   * the render time has moved past are dropped, so the search stays a step or two.
   * Returns false when there's nothing to show yet.
   */
  sample(t: number, out: NetSample): boolean {
    if (!this.count) return false;
    // Keep exactly one sample at or before t (the start of the current segment).
    while (this.count > 2 && this.at(1).t <= t) {
      this.head = (this.head + 1) % this.ring.length;
      this.count -= 1;
    }
    const first = this.at(0);
    const last = this.at(this.count - 1);
    if (t <= first.t || this.count === 1) {
      copySample(out, first);
    } else if (t >= last.t) {
      copySample(out, last);
    } else {
      let i = 0;
      while (i < this.count - 2 && this.at(i + 1).t <= t) i += 1;
      const a = this.at(i);
      const b = this.at(i + 1);
      const k = (t - a.t) / (b.t - a.t);
      out.x = a.x + (b.x - a.x) * k;
      out.y = a.y + (b.y - a.y) * k;
      out.z = a.z + (b.z - a.z) * k;
      // The short way round: 170° to -170° turns 20°, not 340°.
      out.ry = wrapAngle(a.ry + wrapAngle(b.ry - a.ry) * k);
      out.speed = a.speed + (b.speed - a.speed) * k;
    }
    out.t = t;
    return true;
  }
}
