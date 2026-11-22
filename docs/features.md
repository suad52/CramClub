# Feature status

What works today, what is a labelled placeholder, and what is still to come. Updated at the end
of every phase.

## Phase 0: Foundation ✅

- pnpm monorepo: `apps/web`, `apps/game-server`, `packages/shared`, `packages/config`
- TypeScript everywhere, ESLint, Prettier, Vitest, `.env.example` with placeholders only
- Web app and game server both start locally; the shared package imports work in both

## Phase 1: 3D library prototype ✅

| Feature                         | Status | Notes                                                                                                  |
| ------------------------------- | ------ | ------------------------------------------------------------------------------------------------------ |
| Landing page + Enter Library    | Done   | Feature list marks later phases "Coming soon"                                                          |
| Cozy stylized library           | Done   | 28 × 18 m Grand Reading Hall (12.6 m ceiling), ~27,800 books, arched windows, lamps                    |
| Two zones                       | Done   | Grand Reading Hall (12 long tables) and the Upper Gallery (3 desks, reached by the lift)               |
| WASD / arrow movement           | Done   | Camera-relative; R toggles walking faster; hold Shift to free the mouse; can't pass walls or furniture |
| Third-person camera             | Done   | Over-the-shoulder, scroll zoom, pulls in instead of clipping through shelves                           |
| First-person camera + toggle    | Done   | V or the HUD button; smooth zoom between modes; own body hidden in first person                        |
| Avatar with idle / walk / sit   | Done   | Modular Blender kit (see Phase 2 below) with procedural animation                                      |
| Sit / stand                     | Done   | 51 seats; E or the on-screen prompt; any move key also stands you up                                   |
| Interaction prompts + highlight | Done   | "E Study at table" etc., with a glowing ring on the floor                                              |
| Loading, errors, pause menu     | Done   | No-WebGL message, GPU-reset message, phone/tablet notice, settings persist locally                     |
| Graphics quality                | Done   | High / Balanced / Low (Low drops post-processing and minor lamps)                                      |

### Clearly labelled placeholders

- **Whiteboards** at the four collaborative tables say "Shared drawing arrives in a later
  update". They become interactive in Phase 5.
- **"Solo preview"** badge in the HUD: you're alone in the library until Phase 3.

## Phase 2 (part one): title screen + Character Studio ✅

| Feature                     | Status | Notes                                                                                                                                                                                                                                                                              |
| --------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Title screen                | Done   | Over the live library while the camera circles your character; ↑ ↓ Enter; member card with your name                                                                                                                                                                               |
| Swoop in                    | Done   | "Enter the Library" flies the camera from the title shot into the third-person follow camera                                                                                                                                                                                       |
| Camera and microphone check | Done   | "Before you go in", every time you enter: camera on/off with a mirrored preview and face status, microphone test with a live level meter (10 s max, nothing sent), device pickers, a test sound; remembered, so Enter goes straight in; Esc → Camera and microphone in the library |
| Character Studio            | Done   | 13 categories, live 3D turntable, drag to turn, scroll to zoom, Front / Side / Back / Face views                                                                                                                                                                                   |
| Blender-made parts          | Done   | 10 hairstyles, 6 tops, 4 bottoms, 3 shoes, 10 accessories, 4 eyes, 4 brows, 3 noses, 4 face shapes, 4 details                                                                                                                                                                      |
| Colours                     | Done   | 10 skin tones, 9 eye, 14 hair, 6 lip, 18 clothing colours, 3 metals; trims, laces and soles adapt                                                                                                                                                                                  |
| Body sliders                | Done   | Build (slim ↔ broad morph that clothes follow) and height                                                                                                                                                                                                                          |
| Hover preview               | Done   | Hovering a tile or swatch tries it on; moving away puts it back                                                                                                                                                                                                                    |
| Presets                     | Done   | Cozy Reader, Night Owl, Campus Runner, Studio Artist, Minimal, Colorful                                                                                                                                                                                                            |
| Randomize                   | Done   | Minimal ↔ Playful slider; coordinated outfits (one hero colour, neutrals around it); R key                                                                                                                                                                                         |
| Preview poses / faces       | Done   | Idle, Wave, Sit (on a stool); Neutral, Smile, Wink, Wow, Sleepy                                                                                                                                                                                                                    |
| Undo / Redo / Reset         | Done   | Ctrl+Z / Ctrl+Shift+Z; Reset returns to the saved look; leaving with changes asks first                                                                                                                                                                                            |
| Name + save                 | Done   | "Sign your card" with name suggestions; saved locally (guests) and sanitized on load                                                                                                                                                                                               |
| Edit later                  | Done   | Pause menu → Edit character; title screen → Character Studio                                                                                                                                                                                                                       |
| Hats over any hair          | Done   | Beanie and cap tuck the hair in with a clipping plane that follows the head                                                                                                                                                                                                        |

Still to do in Phase 2: display names above avatars (needs Phase 3 to matter), more zone
interactions and a fuller settings panel. The pipeline is documented in
[avatar-pipeline.md](avatar-pipeline.md).

## Early prototype: expression tracking (from Phase 4)

Built ahead of schedule as a single-player prototype. Other people can't see it until
multiplayer (Phase 3) can carry the values.

| Feature                    | Status | Notes                                                                                                                                                                                                                                                                          |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Opt-in camera              | Done   | "Turn camera on" on the "Before you go in" check, the "Face" panel or the menu; the camera is never requested before that                                                                                                                                                      |
| On-device face analysis    | Done   | MediaPipe Face Landmarker in the browser, model self-hosted; video never leaves the device                                                                                                                                                                                     |
| Head, blinks, brows, mouth | Done   | Head turn/nod/tilt, each eye's blink, smile, mouth open, eyebrow raise                                                                                                                                                                                                         |
| Calibration                | Done   | Learns your resting face in the first second; Recalibrate button                                                                                                                                                                                                               |
| Smoothing                  | Done   | One Euro filter per value; the face relaxes back to idle if you leave the frame                                                                                                                                                                                                |
| "Your avatar" face view    | Done   | Small front-on view of your avatar's face in the corner while tracking is on                                                                                                                                                                                                   |
| Camera-on indicator        | Done   | Pulsing red dot on the HUD button; Turn off camera stops the webcam completely                                                                                                                                                                                                 |
| Mirror option              | Done   | Off by default (your left eye = avatar's left eye); turn on for mirror-style                                                                                                                                                                                                   |
| Look around with your head | Done   | On by default: turning your head turns the view (~1.8× your turn, small moves ignored); the mouse takes priority (moving it pauses head look; it resumes once the mouse rests, from wherever your head is); toggle in the Face panel                                           |
| Draw with your finger      | Done   | Whiteboard "Finger" toggle: MediaPipe hand tracking follows your index fingertip (on-device); point with one finger to draw, open your hand or show two fingers to lift the pen; reuses the face camera if on; model from NEXT_PUBLIC_HAND_MODEL_URL or Google's MediaPipe CDN |
| Sync to other players      | Later  | Phase 3/4: send the eight values ~10×/s, never video or landmarks                                                                                                                                                                                                              |

Verified so far: the maths has unit tests (head-angle signs, calibration, smoothing). The
model and wasm load and run in the browser, and the avatar's face responds correctly to
injected values. **Not yet verified with a real face on camera.**

## AI whiteboard (built early, single-player)

Every collaborative table's whiteboard works now: walk up and press **E**, or press **B** while
sitting at that table.

| Feature                    | Status | Notes                                                                                         |
| -------------------------- | ------ | --------------------------------------------------------------------------------------------- |
| Draw and write             | Done   | Smooth pressure-aware pen (4 colours, 3 sizes), eraser, undo/redo, clear                      |
| Saved per table            | Done   | Kept in this browser; shown on the 3D whiteboard in the room                                  |
| Ask AI                     | Done   | Box a question → Gemini reads and answers it                                                  |
| Answer in your handwriting | Done   | Image model writes it right next to the question, in your pen colour and size (needs billing) |
| Free fallback              | Done   | Without billing: same place and colour, in a handwriting font                                 |
| Answer card                | Done   | Shows what the AI read, the full answer, a copy button and "AI can make mistakes"             |
| Shared with the table      | Later  | Phase 5: Yjs so everyone at the table sees the same board                                     |
| Lessons on the board       | Done   | L at a rolling board: it flips over to play a Studio lesson, J joins (learning-studio.md)     |

Verified against the real Gemini API (2026-11-19): reading and answering works with Gemini 4
Hydrogen (about 2–3 s; read "7 − 2 =" correctly 4/4 times). The answer is written right under the
question at the same size and in the question's ink colour. A **free-tier key can't use the image
model** (Google returns "limit: 0 … Free Tier"), so it falls back to the handwriting font. Copying
the student's actual handwriting needs billing turned on and hasn't been seen working yet.

## Table timer: Pomodoro (built early from Phase 5, single-player)

Sit at any table and a little LED desk clock appears in front of you. Press **P** to start a
25-minute pomodoro. Full guide: [table-timer.md](table-timer.md).

| Feature               | Status | Notes                                                                                                |
| --------------------- | ------ | ---------------------------------------------------------------------------------------------------- |
| Clock on the table    | Done   | Pops up when you sit, away from the lamp; mm:ss, phase, progress, set dots; red/green; alarm buzz    |
| Timer card            | Done   | Top left: phase, time left, progress, the set's tomatoes, today's count, your task                   |
| Pomodoro rules        | Done   | 25 / 5 / 15 min, long break every 4th; breaks start by themselves; no pause; interrupted = void      |
| Adjustable            | Done   | Gear: focus 5–90 min, both breaks, long-break interval, strict, ticking, full screen                 |
| Stay at the table     | Done   | Moving and E don't stand you up mid-pomodoro; Leave table asks, then gives the pomodoro up           |
| Stay in the tab       | Done   | Full screen (Esc held in Chrome/Edge), close/reload asks, new-tab buttons wait, title calls you back |
| Strict / gentle       | Done   | Strict: away over 10 s voids it, shorter is a warning. Gentle: the timer waits for you               |
| Sounds                | Done   | Start beeps, optional tick, alarm-clock beeps (WebAudio, no files)                                   |
| Saved                 | Done   | Settings, task and today's count in this browser; a running pomodoro never survives a reload         |
| Shared with the table | Later  | Phase 5: others at the table see your clock and phase                                                |

Verified so far: the rules have unit tests (whole sets, today's count across midnight, strict and
gentle leaving, the 10 s grace, settings limits), as do the seat lock and the clock's spot at all
75 seats (checked against the shipped model's props). A web page can't stop anyone switching tabs,
so leaving is detected and costs the pomodoro instead. Checked by hand in a WebGL browser on
2026-11-20: sitting, the desk view, P, the seat lock, a 3 s and a 12 s tab switch, the alarm into a
break, Leave table (full screen and pointer lock can't be tested headless).

## Learning analytics on Tiger Data (Hack Western 13)

Your progress, a weekly leaderboard and community trends from real, server-validated learning
activity stored in Tiger Data. Full guide: [learning-analytics.md](learning-analytics.md).

| Feature          | Status | Notes                                                                                     |
| ---------------- | ------ | ----------------------------------------------------------------------------------------- |
| Event pipeline   | Done   | Pomodoros, lessons, knowledge checks; server-timed, server-graded, idempotent XP ledger   |
| My Progress      | Done   | Totals, streaks, 30-day chart, week vs week, subjects (mastery estimate), private history |
| Leaderboard      | Done   | Weekly/monthly XP, deterministic ties, opt-out, no titles or ids exposed                  |
| Community        | Done   | Subjects this week, hour-of-day rhythm, 30-day trend; aggregated, groups < 3 hidden       |
| Tiger Data       | Done   | Hypertable, continuous aggregate with real-time aggregation, columnstore after 30 days    |
| Accounts         | Done   | Auth0 sign-in (optional); anonymous learners link on first sign-in. See auth0.md          |
| Group challenges | Later  | Needs multiplayer                                                                         |

Verified 2026-11-20 against the live Tiger Cloud service: `pnpm --filter web db:smoke` (11 checks:
early/late sessions refused, no overlap, XP once, answer keys fixed, forged cookie, privacy), and a
pomodoro started and finished in the real library showing up on the dashboard and leaderboard.

## Library chat and Ms. Fenwick (Hack Western 13)

A room-wide text chat in the live library, and the librarian stepping in when nobody answers.
Contract: `packages/shared/src/net/protocol.ts` (CHAT) and `internal.ts`.

| Feature              | Status | Notes                                                                                                   |
| -------------------- | ------ | ------------------------------------------------------------------------------------------------------- |
| Room chat            | Done   | Enter opens it; first names; cleaned, capped at 200 characters and rate-limited by the game server      |
| Typing indicator     | Done   | "… is typing" in the panel and dots over the avatar; off within 5 s of the last keystroke               |
| Late joiners         | Done   | The room's last 30 lines on joining, and what was missed after a reconnect; memory only, never stored   |
| Ms. Fenwick steps in | Done   | Nobody answered you in 10 s (3 s alone): she replies to the room, your browser says it in her voice     |
| Not for answers      | Done   | A line answering someone (no question back), "ok" / "brb" / "thanks", or a switched-off asker: no reply |
| Limits               | Done   | Once per 20 s per student (5 s alone), 6 a minute per room, 30 a minute per game server, 60 on the web  |
| Safety               | Done   | Tightened Gemini filters; a reply repeating a student's words is held back; no browser can post as her  |

Verified with `pnpm --filter @ovr/game-server test` (real sockets, a stand-in web route) and
`node scripts/e2e/chat-fenwick.mjs` (real game server, web app and Gemini).

## Coming next

| Phase | Features                                                                                  |
| ----- | ----------------------------------------------------------------------------------------- |
| 2     | Display name above avatars, settings panel, more zone interactions                        |
| 3     | Colyseus multiplayer: public rooms (cap 15), remote avatars, interpolation, server checks |
| 4     | Study status, LiveKit proximity voice, optional on-device expression tracking             |
| 5     | Shared whiteboards (tldraw + Yjs; check the tldraw licence first), shared Pomodoro        |
| 6     | AI teacher: PDF upload, grounded answers with page references, ElevenLabs read-aloud      |
| 7     | Resource bookshelves, polish, deployment                                                  |
