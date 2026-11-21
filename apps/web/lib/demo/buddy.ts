"use client";

import { AVATAR_PRESETS, DEFAULT_AVATAR, SEATS } from "@ovr/shared";
import { remoteLive, removeRemote, takenSeats, upsertRemote } from "@/lib/net/players";
import { DEMO_BUDDY } from "./settings";

/*
 * Theo (demo): the judge demo's study buddy, so the body-doubling card and the table have someone
 * in them. He lives ONLY in this browser's list of other players (lib/net/players.ts), which the
 * renderer, the seat checks and the focus loop read: nothing ever sends that list anywhere, so he
 * never reaches the game server, Tiger Data or a leaderboard. His name says he's a demo.
 */

const AVATAR = JSON.stringify(
  AVATAR_PRESETS.find((p) => p.id === "night_owl")?.config ?? DEFAULT_AVATAR,
);
const seatsById = new Map(SEATS.map((s) => [s.id, s]));

/** The seat Theo is in, or null when he isn't here. */
let seatId: string | null = null;

export const buddySeat = () => seatId;

/** Theo sits down in `id` (or moves there). */
export function seatBuddy(id: string) {
  const seat = seatsById.get(id);
  if (!seat) return;
  seatId = id;
  upsertRemote(
    DEMO_BUDDY.id,
    {
      name: DEMO_BUDDY.name,
      signedIn: false,
      avatar: AVATAR,
      x: seat.x,
      y: seat.y,
      z: seat.z,
      ry: seat.rotationY,
      movement: "sit",
      speed: 0,
      seatId: id,
      status: "focused",
      face: false,
      // He never chats (the chat is the real room's only): no typing dots over his head.
      typing: false,
    },
    performance.now(),
  );
}

/** Theo goes (demo mode off, or the library closing). */
export function removeBuddy() {
  seatId = null;
  removeRemote(DEMO_BUDDY.id);
}

/**
 * Puts Theo back if the list of players was cleared (the room dropped and rejoined). Returns
 * false when a real player now sits in his seat, so the caller can find him another.
 */
export function keepBuddy(): boolean {
  if (!seatId) return true;
  const owner = takenSeats().get(seatId);
  if (owner && owner !== DEMO_BUDDY.id) return false;
  if (!remoteLive.has(DEMO_BUDDY.id) || !owner) seatBuddy(seatId);
  return true;
}
