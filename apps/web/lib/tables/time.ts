import { WARN_MINUTES } from "./types";

/**
 * How long is left on a table hold. Pure and safe for client code: pass `now` (a Date or epoch
 * ms) from the server's clock where you can (TablesView.serverTime plus `clockOffset`), so a
 * laptop whose clock is a few minutes out still shows the right time.
 */

type When = string | Date | null | undefined;
type Now = Date | number;

const at = (now: Now) => (typeof now === "number" ? now : now.getTime());

/** Milliseconds until `endsAt` (0 once it has passed, or for no time / a bad time). */
export function msLeft(endsAt: When, now: Now = Date.now()): number {
  if (!endsAt) return 0;
  const end = new Date(endsAt).getTime();
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - at(now));
}

/** Whole minutes left, rounded up (59 min 30 s is 60, 20 s is 1), 0 once the hold is over. */
export function minutesLeft(endsAt: When, now: Now = Date.now()): number {
  return Math.ceil(msLeft(endsAt, now) / 60_000);
}

/** Whether the hold is still running. */
export function isRunning(endsAt: When, now: Now = Date.now()): boolean {
  return msLeft(endsAt, now) > 0;
}

/** Whether the holder should see "time's nearly up": the last WARN_MINUTES, and not over yet. */
export function shouldWarn(endsAt: When, now: Now = Date.now()): boolean {
  const ms = msLeft(endsAt, now);
  return ms > 0 && ms <= WARN_MINUTES * 60_000;
}

/** "42 minutes", "1 minute", "less than a minute" (or "no time" once it's over), for calm copy. */
export function timeLeftText(endsAt: When, now: Now = Date.now()): string {
  const ms = msLeft(endsAt, now);
  if (ms <= 0) return "no time";
  if (ms < 60_000) return "less than a minute";
  const minutes = Math.ceil(ms / 60_000);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

/**
 * How far this device's clock is behind the server's, in ms (add it to Date.now()). Pass
 * TablesView.serverTime and when the response arrived; 0 if the time can't be read.
 */
export function clockOffset(serverTime: string, receivedAt: number = Date.now()): number {
  const server = new Date(serverTime).getTime();
  return Number.isNaN(server) ? 0 : server - receivedAt;
}
