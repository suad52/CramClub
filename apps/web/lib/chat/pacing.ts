import { CHAT } from "@ovr/shared";

/**
 * Pacing what the chat sends (pure: time comes in as `now`).
 *
 * TypingSignal: when to tell the room "I'm typing" (ClientMessages.typing). The server shows you typing for
 * CHAT.TYPING_IDLE_MS after your last "on", so while you keep typing this refreshes it every
 * TYPING_REFRESH_MS; it says "off" when you send the line, leave the box or empty it. It never
 * sends faster than CHAT.TYPING_HZ: an "on" that would is skipped (the next keystroke tries
 * again), so the server's rate limit never drops one. `send` returns whether the message went
 * out (false offline).
 *
 * LineBucket: the server's per-player chat limit (CHAT.PER_SECOND on average, CHAT.BURST in a
 * row), mirrored here so a line it would drop is never sent: the panel says "slow down" instead
 * of the line silently going nowhere.
 */

/** While still typing, "on" goes again this often (well inside CHAT.TYPING_IDLE_MS). */
export const TYPING_REFRESH_MS = 2000;

export class TypingSignal {
  private on = false;
  private lastSent = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly send: (on: boolean) => boolean,
    private readonly refreshMs: number = TYPING_REFRESH_MS,
    private readonly minGapMs: number = 1000 / CHAT.TYPING_HZ,
  ) {}

  /** Whether the room was last told "on". */
  get active() {
    return this.on;
  }

  /** The text box changed (a keystroke, a paste, a cut). */
  input(text: string, now: number) {
    if (!text.trim()) {
      this.stop(now);
      return;
    }
    if (this.on && now - this.lastSent < this.refreshMs) return;
    if (now - this.lastSent < this.minGapMs) return;
    if (!this.send(true)) {
      this.on = false;
      return;
    }
    this.on = true;
    this.lastSent = now;
  }

  /** The line was sent, the box lost focus, or it was emptied. */
  stop(now: number) {
    if (!this.on) return;
    this.on = false;
    this.lastSent = now;
    this.send(false);
  }

  /** The link dropped (the room forgets you were typing): start over. */
  reset() {
    this.on = false;
    this.lastSent = Number.NEGATIVE_INFINITY;
  }
}

/** A token bucket like the server's: `burst` lines in a row, refilling at `perSecond`. */
export class LineBucket {
  private tokens: number;
  private at = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly perSecond: number = CHAT.PER_SECOND,
    private readonly burst: number = CHAT.BURST,
  ) {
    this.tokens = burst;
  }

  private refill(now: number) {
    if (this.at !== Number.NEGATIVE_INFINITY)
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.perSecond);
    this.at = now;
  }

  /** Takes a token for a line, if there is one. */
  take(now: number) {
    this.refill(now);
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }

  /** How long until the next line may go (ms; 0 when it may now). */
  wait(now: number) {
    this.refill(now);
    return this.tokens >= 1 ? 0 : Math.ceil(((1 - this.tokens) / this.perSecond) * 1000);
  }
}
