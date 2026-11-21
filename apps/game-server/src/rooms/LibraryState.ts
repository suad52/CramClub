import { type SchemaType, schema, t } from "@colyseus/schema";
import type { MovementState, NetPlayer, StudyStatus } from "@ovr/shared";

/**
 * One player as everyone sees them: exactly the fields of {@link NetPlayer} (packages/shared
 * net/protocol.ts). Ticket keys, learner ids and emails are never stored here.
 */
export const Player = schema(
  {
    name: t.string(),
    signedIn: t.boolean(),
    avatar: t.string(),
    x: t.float32(),
    y: t.float32(),
    z: t.float32(),
    ry: t.float32(),
    movement: t.string<MovementState>().default("idle"),
    speed: t.float32(),
    seatId: t.string(),
    status: t.string<StudyStatus>().default("available"),
    face: t.boolean(),
    typing: t.boolean(),
  },
  "Player",
);
export type Player = SchemaType<typeof Player>;

/** The room's synchronized state: `players`, keyed by sessionId. */
export const LibraryState = schema(
  {
    players: t.map(Player),
  },
  "LibraryState",
);
export type LibraryState = SchemaType<typeof LibraryState>;

// The schema must carry every NetPlayer field, with the same types.
type Fields = Pick<Player, keyof NetPlayer>;
const _sameShape: [Fields, NetPlayer] extends [NetPlayer, Fields] ? true : never = true;
