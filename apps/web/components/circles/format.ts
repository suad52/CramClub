import type { CircleRole, InviteRole, ItemKind } from "@/lib/circles/types";

/** Words for roles and kinds, shared by every circle screen. Sentence case. */
export const ROLE_LABEL: Record<CircleRole, string> = {
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

/** What each role can do, in one short line. */
export const ROLE_CAN: Record<CircleRole, string> = {
  owner: "Runs the circle: invites people, sets roles, adds and removes things",
  editor: "Can add things to the circle and remove them",
  viewer: "Can read and open everything, but not change it",
};

export const INVITE_ROLE_HINT: Record<InviteRole, string> = {
  editor: "They can add and remove things",
  viewer: "They can read and open everything",
};

export const KIND_LABEL: Record<ItemKind, string> = {
  resource: "Link",
  lesson: "Lesson",
  plan: "Study plan",
  note: "Note",
};

/** "1 member", "3 members". */
export function plural(n: number, one: string, many = `${one}s`) {
  return `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
}

/** How long ago `iso` was, measured from `now` (an ISO time from the server, so renders are pure). */
export function timeAgo(iso: string, now: string) {
  const seconds = Math.max(0, (Date.parse(now) - Date.parse(iso)) / 1000);
  if (!Number.isFinite(seconds) || seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${plural(minutes, "minute")} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${plural(hours, "hour")} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return shortDate(iso);
}

/** "Nov 28" (with the year when it isn't this one, by `now`). */
export function shortDate(iso: string, now?: string) {
  const d = new Date(iso);
  const sameYear = !now || new Date(now).getFullYear() === d.getFullYear();
  return d.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** A calendar day from a plan ("2026-11-22" → "Sun, Nov 22"), read as a date, not a time. */
export function planDay(date: string) {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" });
}

/** The site a link goes to, without "www.". */
export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
