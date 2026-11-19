import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { type AvatarConfig, DEFAULT_AVATAR, sanitizeAvatarConfig } from "@ovr/shared";

export const NAME_MAX = 20;

/** Trims, collapses spaces and strips control characters from a display name. */
export function cleanName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NAME_MAX);
}

interface ProfileStore {
  displayName: string;
  avatar: AvatarConfig;
  /** When the character was last saved; null until the first save. */
  savedAt: number | null;
  save: (displayName: string, avatar: AvatarConfig) => void;
}

/**
 * The player's character. Guests keep it in localStorage (accounts come later); it is
 * sanitized on load so an old or hand-edited save can never break the avatar.
 */
export const useProfileStore = create<ProfileStore>()(
  persist(
    (set) => ({
      displayName: "",
      avatar: DEFAULT_AVATAR,
      savedAt: null,
      save: (displayName, avatar) =>
        set({
          displayName: cleanName(displayName),
          avatar: sanitizeAvatarConfig(avatar),
          savedAt: Date.now(),
        }),
    }),
    {
      name: "ovr.profile",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ displayName: s.displayName, avatar: s.avatar, savedAt: s.savedAt }),
      migrate: (persisted) => persisted as ProfileStore,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ProfileStore>;
        return {
          ...current,
          displayName: typeof p.displayName === "string" ? cleanName(p.displayName) : "",
          avatar: sanitizeAvatarConfig(p.avatar),
          savedAt: typeof p.savedAt === "number" ? p.savedAt : null,
        };
      },
    },
  ),
);
