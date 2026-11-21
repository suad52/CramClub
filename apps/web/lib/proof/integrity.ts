import type { IntegrityCheck, IntegrityDay, IntegrityReport } from "./types";

/**
 * The integrity check's arithmetic, kept pure so it's tested without a database. The SQL in
 * lib/proof/server.ts recomputes the last 7 days from raw rows (learning_events, xp_ledger) and
 * lines them up, group by group (learner × day, and subject for learning_daily), against what the
 * continuous aggregates hold. This module adds the groups up per check and per day, zero-fills the
 * window and decides what may be shown: window totals only when at least `minGroup` learners are
 * in them, like the community charts.
 *
 * Expect no drift: real-time aggregation answers the newest events from raw rows. Drift can only
 * come from rows written into an already-materialised day (a backfill, a seed), and the next
 * refresh of the aggregate corrects it, so the report says when that runs.
 */

export interface CheckDayRow {
  /** "YYYY-MM-DD", library time. */
  day: string;
  /** Groups compared that day (a group missing on one side still counts, as drifted). */
  groups: number;
  drifted: number;
  raw: Record<string, number>;
  aggregate: Record<string, number>;
}

export interface CheckRows {
  id: IntegrityCheck["id"];
  label: string;
  sides: IntegrityCheck["sides"];
  days: CheckDayRow[];
  /** Distinct learners in the window, on either side. */
  learners: number;
}

function addInto(into: Record<string, number>, from: Record<string, number>) {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + (Number(v) || 0);
}

function sameTotals(a: Record<string, number>, b: Record<string, number>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? 0) === (b[k] ?? 0));
}

/** One check over the window: its groups and drift, and its totals if they may be shown. */
export function summariseCheck(rows: CheckRows, minGroup: number): IntegrityCheck {
  const raw: Record<string, number> = {};
  const aggregate: Record<string, number> = {};
  let groups = 0;
  let drifted = 0;
  for (const d of rows.days) {
    groups += d.groups;
    drifted += d.drifted;
    addInto(raw, d.raw);
    addInto(aggregate, d.aggregate);
  }
  const show = rows.learners >= minGroup;
  return {
    id: rows.id,
    label: rows.label,
    sides: rows.sides,
    groups,
    drifted,
    raw: show ? raw : null,
    aggregate: show ? aggregate : null,
    ok: drifted === 0 && sameTotals(raw, aggregate),
  };
}

/** Every day of the window, oldest first, with all checks' groups and drift added up. */
export function integrityDays(window: readonly string[], checks: readonly CheckRows[]) {
  const byDay = new Map<string, IntegrityDay>(
    window.map((day) => [day, { day, groups: 0, drifted: 0 }]),
  );
  for (const check of checks)
    for (const d of check.days) {
      const into = byDay.get(d.day);
      if (!into) continue; // outside the window (a clock edge): not part of this check
      into.groups += d.groups;
      into.drifted += d.drifted;
    }
  return [...byDay.values()];
}

export function buildIntegrity(
  window: readonly string[],
  checks: readonly CheckRows[],
  opts: { minGroup: number; queryMs: number; nextRefreshAt: string | null },
): IntegrityReport {
  const inWindow = new Set(window);
  const scoped = checks.map((c) => ({ ...c, days: c.days.filter((d) => inWindow.has(d.day)) }));
  const summaries = scoped.map((c) => summariseCheck(c, opts.minGroup));
  return {
    from: window[0] ?? "",
    to: window[window.length - 1] ?? "",
    checks: summaries,
    days: integrityDays(window, scoped),
    ok: summaries.every((c) => c.ok),
    queryMs: opts.queryMs,
    nextRefreshAt: opts.nextRefreshAt,
  };
}
