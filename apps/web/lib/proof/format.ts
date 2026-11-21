/**
 * Small display helpers for the /proof report, pure so they're tested on their own: Postgres
 * interval text ("00:10:00", "40 days", "1 day 02:00:00") in words, and byte sizes.
 */

const unit = (n: number, one: string) => `${n} ${n === 1 ? one : `${one}s`}`;

/** Postgres interval output → "10 minutes", "40 days", "12 weeks", "1 day 2 hours". */
export function formatInterval(text: string | null | undefined): string | null {
  const raw = text?.trim();
  if (!raw) return null;
  let days = 0;
  let seconds = 0;
  let rest = raw;
  const d = /(-?\d+)\s+days?/.exec(rest);
  if (d) {
    days = Number(d[1]);
    rest = rest.replace(d[0], "").trim();
  }
  const t = /^(-?\d+):(\d{2}):(\d{2})(?:\.\d+)?$/.exec(rest);
  if (t) seconds = Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]);
  else if (rest) return raw; // a form this doesn't know (months, years): as Postgres wrote it
  const parts: string[] = [];
  if (days) parts.push(days % 7 === 0 ? unit(days / 7, "week") : unit(days, "day"));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) parts.push(unit(h, "hour"));
  if (m) parts.push(unit(m, "minute"));
  if (s) parts.push(unit(s, "second"));
  return parts.length ? parts.join(" ") : "0 seconds";
}

/** 81920 → "80 KB", 1572864 → "1.5 MB". */
export function formatBytes(bytes: number): string {
  if (!(bytes >= 0)) return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${Number(v.toFixed(v < 10 ? 1 : 0))} ${units[i]}`;
}

/** "4 min 23 s", "45 s", "2 h 5 min". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return s % 60 ? `${m} min ${s % 60} s` : `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}
