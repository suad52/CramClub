import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type AvatarConfig, DEFAULT_AVATAR, sanitizeAvatarConfig } from "@ovr/shared";
import { DEFAULT_HEAD, type HeadSettings, sanitizeHead } from "./facePhoto";

export const NAME_MAX = 20;

/** Trims, collapses spaces and strips control characters from a display name. */
export function cleanName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

interface ProfileStore extends HeadSettings {
  displayName: string;
  avatar: AvatarConfig;
  /** When the character was last saved; null until the first save. */
  savedAt: number | null;
  save: (displayName: string, avatar: AvatarConfig) => void;
  /** Chibi head or "my real face" (and its photo); see lib/avatar/facePhoto.ts. */
  setHead: (head: HeadSettings) => void;
}

/** What the profile keeps in localStorage. */
type SavedProfile = Pick<ProfileStore, "displayName" | "avatar" | "savedAt" | keyof HeadSettings>;

/** Any saved profile (any version, or garbage) as a valid one. */
export function sanitizeProfile(v: unknown): SavedProfile {
  const p = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof SavedProfile, unknown>>;
  return {
    displayName: typeof p.displayName === "string" ? cleanName(p.displayName) : "",
    avatar: sanitizeAvatarConfig(p.avatar),
    savedAt: typeof p.savedAt === "number" && Number.isFinite(p.savedAt) ? p.savedAt : null,
    ...sanitizeHead(p),
  };
}

/**
 * The player's character. Guests keep it in localStorage (accounts come later); it is
 * sanitized on load so an old or hand-edited save can never break the avatar. The face photo
 * (if any) is a ~256px JPEG that never leaves this browser.
 */
export const useProfileStore = create<ProfileStore>()(
  persist(
    (set) => ({
      displayName: "",
      avatar: DEFAULT_AVATAR,
      savedAt: null,
      ...DEFAULT_HEAD,
      save: (displayName, avatar) =>
        set({
          displayName: cleanName(displayName),
          avatar: sanitizeAvatarConfig(avatar),
          savedAt: Date.now(),
        }),
      setHead: (head) => set(sanitizeHead(head)),
    }),
    {
      name: "ovr.profile",
      // v3 added the head (chibi or real face); older saves get the chibi head.
      version: 3,
      storage: createJSONStorage(() => localStorage),
      partialize: (s): SavedProfile => ({
        displayName: s.displayName,
        avatar: s.avatar,
        savedAt: s.savedAt,
        headMode: s.headMode,
        facePhoto: s.facePhoto,
        liveFace: s.liveFace,
      }),
      migrate: (persisted) => sanitizeProfile(persisted) as ProfileStore,
      merge: (persisted, current) => ({ ...current, ...sanitizeProfile(persisted) }),
    },
  ),
);
