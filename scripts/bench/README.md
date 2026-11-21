# Benchmarks

Two small measurement scripts. They run with plain `node` (no install of their own: they borrow
`@colyseus/sdk` from `apps/web` and `tsx` from `apps/game-server`, so run `pnpm install` once).
Neither reads an env file, a secret, a camera or the network beyond `127.0.0.1`.

```bash
node scripts/bench/face-payload.mjs            # bytes on the wire for face tracking vs webcam video
node scripts/bench/latency.mjs --samples 300   # move / face latency through a real game server
```

Add `--json` to either for machine-readable output. `latency.mjs` takes `--port` (default 2599)
if that port is busy.

## What each one measures

| Script             | Exact                                                                                                                                                              | Estimated / assumed                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `face-payload.mjs` | Message size from the real `@colyseus/sdk` `Room.send` and the server's encoder; send-rate rules from the client's own `ChangeSender` (`apps/web/lib/net/rate.ts`) | Synthetic (seeded) face traces; WebSocket + TLS 1.3 + TCP/IPv4 overhead per message; webcam bitrates from Zoom's 1:1 figures |
| `latency.mjs`      | Time from client A's `send` to client B's callback, through `apps/game-server` started on a spare port with a throwaway ticket secret                              | Local loopback only: no internet distance                                                                                    |

## Results (2026-11-21)

Machine: Apple M5, 10 cores, 24 GB, macOS (Darwin 25.6), Node 26.13. Raw output in
[`results/`](results).

**Face tracking on the wire** (`face-payload.mjs`):

| Scenario        | Messages/s | Payload kbit/s | Wire kbit/s (est.) | 720p video is |
| --------------- | ---------: | -------------: | -----------------: | ------------: |
| Sitting still   |        1.0 |            1.3 |                1.9 |         620 × |
| Reading notes   |        1.4 |            1.7 |                2.6 |         459 × |
| Talking, moving |        6.9 |            8.9 |               13.4 |          90 × |
| Worst case      |        8.0 |           10.2 |               15.5 |          77 × |

One `face` message is 160 bytes (about 242 on the wire), the relay to each other player is 184
bytes, and turning tracking off is one 7-byte message. A whole 25-minute pomodoro at the worst
case is about 1.9 MB of face numbers, against about 225 MB of 720p video.

**Multiplayer latency, local loopback** (`latency.mjs --samples 300`, 0 of 300 lost each):

| Path                                  |     p50 |     p95 |     p99 |     max |
| ------------------------------------- | ------: | ------: | ------: | ------: |
| Move → other player's state           | 15.4 ms | 50.7 ms | 51.5 ms | 52.0 ms |
| Face → other player (relayed at once) | 0.64 ms | 0.92 ms | 1.03 ms | 12.3 ms |

Moves wait for the next Colyseus state patch (every 50 ms), so they spread between 0 and 50 ms;
faces are relayed straight away. Remote avatars are also drawn 120 ms in the past on purpose
(`NET.INTERP_DELAY_MS`, for smooth movement), so a move is on the other screen about 135 ms (p50)
/ 171 ms (p95) after the key press, **before** adding the real network distance between the two
students and the server. The server booted in 212 ms.

**Caveat:** these are loopback numbers on one laptop. They show the server's own handling and the
patch interval, not internet round trips. Production latency from a browser to the Vultr server
has not been measured yet.
