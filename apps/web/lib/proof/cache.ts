/**
 * A one-value cache with a time-to-live, for the /proof report: however many judges reload the
 * page, the database, the bucket and the signing run at most once per `ttlMs` per server process.
 * Callers arriving while a load is running share it. A failed load isn't kept.
 */
export function ttlCache<T>(ttlMs: number, load: () => Promise<T>, now: () => number = Date.now) {
  let kept: { at: number; value: T } | null = null;
  let pending: Promise<T> | null = null;
  return async function get(): Promise<{ value: T; ageMs: number }> {
    const t = now();
    if (kept && t - kept.at < ttlMs) return { value: kept.value, ageMs: t - kept.at };
    pending ??= load().then(
      (value) => {
        kept = { at: now(), value };
        pending = null;
        return value;
      },
      (error: unknown) => {
        pending = null;
        throw error;
      },
    );
    const value = await pending;
    return { value, ageMs: 0 };
  };
}
