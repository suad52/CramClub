"use client";

import type { ChatLine } from "@ovr/shared";
import { useGameStore } from "@/lib/game/store";
import { librarianPresence } from "@/lib/librarian/presence";
import { sayAloud } from "@/lib/librarian/voice";
import { useChat } from "./store";

/*
 * Ms. Fenwick answering YOU in the library chat (the game server decided she should, and posted
 * her line to the whole room with `replyTo` = your sessionId): only your browser says it aloud,
 * in her voice (voice.ts sayAloud, which respects mute and mouths the line instead), so her lips
 * move with it, and she turns her head toward you for a moment (librarianPresence.shushUntil,
 * the same look her shush gives: components/world/Librarian.tsx). Everyone else just reads it.
 * With "Ms. Fenwick answers if nobody does" off, a reply that was already on its way is only shown.
 */

/** How long she keeps looking your way after answering you. */
export const LOOK_AT_ASKER_MS = 4500;

export function fenwickAnsweredMe(line: ChatLine) {
  const game = useGameStore.getState();
  // Talking with you in her panel already: that conversation keeps her voice (the line still
  // shows in the chat).
  if (game.librarianOpen || librarianPresence.open) return;
  if (!useChat.getState().fenwick) return;
  librarianPresence.shushUntil = performance.now() + LOOK_AT_ASKER_MS;
  void sayAloud(line.text);
}
