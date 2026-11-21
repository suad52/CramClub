/** The library page's tabs (shared by the server page, which reads ?tab=, and the client). */
export const TABS = [
  { id: "saved", label: "Saved" },
  { id: "collections", label: "Collections" },
  { id: "lessons", label: "Lessons" },
  { id: "history", label: "History" },
] as const;

export type TabId = (typeof TABS)[number]["id"];

export function parseTab(value: unknown): TabId {
  const v = Array.isArray(value) ? value[0] : value;
  return TABS.some((t) => t.id === v) ? (v as TabId) : "saved";
}
