import type { AvatarConfig } from "../avatar/catalog";

/** A player's self-declared study status. Labels are user-facing; ids are the wire format. */
export type StudyStatus = "available" | "focused" | "collaborating" | "away";

export const STUDY_STATUSES: readonly StudyStatus[] = [
  "available",
  "focused",
  "collaborating",
  "away",
];

export const STUDY_STATUS_LABELS: Record<StudyStatus, string> = {
  available: "Open to talk",
  focused: "Locked in",
  collaborating: "Looking to collaborate",
  away: "Away",
};

export type CameraMode = "first-person" | "third-person";

/** Movement/animation state shared with other players. */
export type MovementState = "idle" | "walk" | "run" | "sit";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * Reduced expression-tracking values. Head angles are in [-1, 1], as a fraction of
 * {@link FACIAL_HEAD_LIMITS}; everything else is in [0, 1], relative to the user's calibrated
 * resting face. Raw webcam frames and landmark streams are never sent anywhere.
 */
export interface FacialParams {
  /** Positive = head turned toward the user's own left. */
  headYaw: number;
  /** Positive = looking up. */
  headPitch: number;
  /** Positive = head tilted toward the user's own left shoulder. */
  headRoll: number;
  eyeBlinkLeft: number;
  eyeBlinkRight: number;
  jawOpen: number;
  smile: number;
  browRaise: number;
}

/** Logical shape of a player as seen by other clients. The Colyseus schema mirrors this in Phase 3. */
export interface PlayerSnapshot {
  sessionId: string;
  userId: string;
  displayName: string;
  position: Vec3;
  rotationY: number;
  movement: MovementState;
  /** Seat id while seated, otherwise null. */
  seatId: string | null;
  status: StudyStatus;
  avatarConfig: AvatarConfig;
  facial?: FacialParams;
}
