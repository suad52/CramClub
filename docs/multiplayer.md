# Multiplayer

Two people in the library see each other live: avatars walking, sitting and facing, with name
tags, and a seat someone is in is taken for everyone else. The wire contract is
`packages/shared/src/net/protocol.ts`; this page is how the two servers implement it.

```
browser ──GET /api/net/ticket──▶ web app (Next)      signs { key, name, signedIn, exp, jti }
browser ──joinOrCreate("library", { ticket })──▶ game server (Colyseus, :2567)
          ◀── state.players (MapSchema, keyed by sessionId) + "seat" / "seat_denied" / "face"
```

## Running it

Both apps read the same `GAME_TICKET_SECRET` (any long random string; never commit it).

| File                    | Variables                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `apps/web/.env.local`   | `GAME_TICKET_SECRET`, `NEXT_PUBLIC_GAME_SERVER_URL=ws://localhost:2567`                |
| `apps/game-server/.env` | `GAME_TICKET_SECRET`, `GAME_SERVER_PORT=2567`, `ALLOWED_ORIGINS=http://localhost:3100` |

```sh
pnpm dev:server   # game server (tsx watch, loads apps/game-server/.env)
pnpm dev:web      # web app; open the library in two tabs or two browsers
```

Without `GAME_TICKET_SECRET` the ticket route answers 503 `multiplayer_not_configured` (the
client stays in solo mode) and the game server refuses every join. `ALLOWED_ORIGINS` must list
every origin the site is opened on (`http://localhost:3100` and `http://127.0.0.1:3100` differ),
comma-separated; in production, the site's own origin.

Ms. Fenwick answers in the library chat only when the game server can reach the web app:
`WEB_INTERNAL_URL` in `apps/game-server/.env` (default `http://localhost:3100`; Docker Compose sets
`http://web:3100`). It signs each request for her words with `GAME_TICKET_SECRET`
(`packages/shared/src/net/internal.ts` → `POST /api/internal/fenwick-chat`); not a URL, or no
secret, and she stays quiet in the chat. With `pnpm dev:web` running,
`node scripts/e2e/chat-fenwick.mjs` checks the whole chat path (its own game server on :2598, real
sockets, real replies; the header lists the scenarios).

## Tickets (apps/web `GET /api/net/ticket`)

- Answers `{ ticket, expiresAt, name, signedIn }`, `cache-control: private, no-store`. 403 from
  another site, 429 over 30 a minute.
- Who it's for comes from `currentUser` (verified Auth0 session, else the signed anonymous learner
  cookie). A first-time visitor is made an anonymous learner there (30 per address per 10
  minutes; past that, or without a database, they get a one-off key and can still join).
- `key` is `HMAC(GAME_TICKET_SECRET, learner id)`, cut to 22 base64url characters: stable per
  learner, so two tabs are recognisably one person, and the id never leaves the web app.
  Signed in without a database, the Auth0 account stands in for the learner id.
- `name`: a signed-in student's first name (`Reader` if all we have is an email or the
  placeholder name); everyone else is `Guest NNNN`, the number fixed by their key. Control,
  separator and invisible format characters (bidi overrides, zero-width joiners) are stripped
  here, refused in a ticket, and stripped again before a client draws a name tag.
- `jti`: 16 random base64url characters, so every ticket is distinct (two tabs asking in the same
  second included) and can be used once. Optional in `TicketClaims` (the one addition to the
  contract); the web app always sets it.
- Format: `base64url(JSON claims) + "." + base64url(HMAC-SHA256)`, valid for `NET.TICKET_TTL_S`.
  Signing and checking live in `packages/shared/src/net/ticket.ts` (Web Crypto only, so it runs
  in Node and Next alike; it holds no secret). `ticket.test.ts` pins fixed vectors, cross-checked
  against `node:crypto`.

## The room (apps/game-server `LibraryRoom`)

**Joining.** The static `onAuth` runs during matchmaking, before a seat is reserved: it refuses a
browser `Origin` not in `ALLOWED_ORIGINS`, then anything but a valid ticket (signature compared in
constant time; expired, tampered, or too-far-future tickets fail; a missing secret fails
everything). Each ticket works once (`ticket_replayed` after; `TicketLedger` in `rules.ts` keeps
used signatures until they'd have expired, in-process, so several server processes would need a
shared store). Errors read `ticket_expired`, `ticket_bad_signature`, `origin_not_allowed`, … The
WebSocket upgrade checks `Origin` too (`beforeUpgrade`, 403), and matchmaking only answers CORS
for allowed origins. A request with no `Origin` (not a browser) still needs a valid ticket.
Matchmaking exposes `joinOrCreate`, `join`, `joinById` and `reconnect` only: nobody may `create`
rooms of their own.

**Tabs.** No dedupe: each tab is its own player, but one key may hold at most 3 sessions in a room
(`too_many_sessions`). Rooms hold 15 (`MAX_PLAYERS_PER_ROOM`); matchmaking opens another.

**State.** `state.players: MapSchema<Player>` keyed by sessionId, with exactly the `NetPlayer`
fields (name, signedIn, avatar JSON, x/y/z, ry, movement, speed, seatId, status, face). Ticket
keys and learner ids are never in it. New players start at a spawn point with avatar `""` until
their client sends one.

**Messages.** Each is rate-limited per client with a token bucket (contract rate plus 25% slack,
small bursts); extras are dropped. Over 60 messages in a second, an unknown message type, or a
frame over the transport's 4 KB limit disconnects the client, and such a client is not held for
reconnection: they're gone for everyone at once, and their seat is free.

| Message  | Limit                       | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                |
| -------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `move`   | 12/s, burst 4               | finite numbers, known movement; inside `BUILDING`, on a walk surface; floors change only by a step or at a lift; distance covered limited by `NET.MAX_SPEED` (a 4 m burst budget refilling at 8 m/s; beyond it the move is cut short along its direction); `sit` from a standing player becomes `idle`; ignored while seated. The first move after joining may place the player anywhere on a floor (a client that rejoins mid-walk). |
| `sit`    | 2/s, burst 3 (with `stand`) | seat id from `SEATS` (`unknown_seat`), free (`taken`; first come), within 2 m and on the same floor (`too_far`). The player snaps to the seat; the server answers `seat`.                                                                                                                                                                                                                                                             |
| `stand`  | shares `sit`'s              | frees the seat; the player moves to `findStandPoint(seat)`, as the client does.                                                                                                                                                                                                                                                                                                                                                       |
| `face`   | 8/s, burst 3                | `null` or all eight `FacialParams`, clamped (head angles to [-1, 1], the rest to [0, 1]); relayed as `{ from, params }` to everyone but the sender, never stored. A face silent for 3 s is switched off.                                                                                                                                                                                                                              |
| `status` | 1/s, burst 3                | one of `STUDY_STATUSES`.                                                                                                                                                                                                                                                                                                                                                                                                              |
| `avatar` | 0.5/s, burst 2              | at most 2048 characters of JSON, stored as `JSON.stringify(sanitizeAvatarConfig(…))`.                                                                                                                                                                                                                                                                                                                                                 |

Leaving frees the seat. A dropped connection (not one the server threw out) keeps its player and
seat for `NET.RECONNECT_S` (`allowReconnection`); the SDK reconnects by itself.

**Table holds.** The game server enforces only that a seat has one person. Whether someone may
sit at a held table is still decided by the web app (`POST /api/tables/:tableId/sit`), which the
client asks before it sends `sit`. A modified client could skip that; closing it needs a signed
seat pass from the web app, which the contract doesn't carry yet.

## Tests

- `packages/shared/src/net/ticket.test.ts`: vectors, good / expired / tampered / wrong secret /
  missing secret / junk, unsafe name characters, ticket ids.
- `apps/game-server/src/rooms/rules.test.ts`: rate limits, speed clamp, floors and lifts, face
  clamping, avatars, seat reach.
- `apps/game-server/src/server.test.ts`: a real server and `@colyseus/sdk` clients: ticket and
  origin refusals, two players seeing each other, seat exclusivity, rate limiting, the speed
  clamp, face relay skipping the sender, reconnection keeping the seat, the per-key tab cap, the
  15-player cap, one use per ticket (racing joins included), flooders / unknown types / oversized
  frames thrown out without a reconnection hold, no `create`.
- `apps/web/lib/auth/gameTicket.test.ts`: names, keys, nothing private in the ticket, the route.
