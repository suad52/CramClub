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
| Cozy stylized library           | Done   | 32 × 24 m hall, five zones, ~10,700 books, sunlit windows, fire, lamps                                 |
| Five study zones                | Done   | Collaborative Tables, Quiet Study, Resource Stacks, Reading Lounge, Main Hall                          |
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

| Feature               | Status | Notes                                                                                                         |
| --------------------- | ------ | ------------------------------------------------------------------------------------------------------------- |
| Title screen          | Done   | Over the live library while the camera circles your character; ↑ ↓ Enter; member card with your name          |
| Swoop in              | Done   | "Enter the Library" flies the camera from the title shot into the third-person follow camera                  |
| Character Studio      | Done   | 13 categories, live 3D turntable, drag to turn, scroll to zoom, Front / Side / Back / Face views              |
| Blender-made parts    | Done   | 10 hairstyles, 6 tops, 4 bottoms, 3 shoes, 10 accessories, 4 eyes, 4 brows, 3 noses, 4 face shapes, 4 details |
| Colours               | Done   | 10 skin tones, 9 eye, 14 hair, 6 lip, 18 clothing colours, 3 metals; trims, laces and soles adapt             |
| Body sliders          | Done   | Build (slim ↔ broad morph that clothes follow) and height                                                     |
| Hover preview         | Done   | Hovering a tile or swatch tries it on; moving away puts it back                                               |
| Presets               | Done   | Cozy Reader, Night Owl, Campus Runner, Studio Artist, Minimal, Colorful                                       |
| Randomize             | Done   | Minimal ↔ Playful slider; coordinated outfits (one hero colour, neutrals around it); R key                    |
| Preview poses / faces | Done   | Idle, Wave, Sit (on a stool); Neutral, Smile, Wink, Wow, Sleepy                                               |
| Undo / Redo / Reset   | Done   | Ctrl+Z / Ctrl+Shift+Z; Reset returns to the saved look; leaving with changes asks first                       |
| Name + save           | Done   | "Sign your card" with name suggestions; saved locally (guests) and sanitized on load                          |
| Edit later            | Done   | Pause menu → Edit character; title screen → Character Studio                                                  |
| Hats over any hair    | Done   | Beanie and cap tuck the hair in with a clipping plane that follows the head                                   |

Still to do in Phase 2: display names above avatars (needs Phase 3 to matter), more zone
interactions and a fuller settings panel. The pipeline is documented in
[avatar-pipeline.md](avatar-pipeline.md).

## Early prototype: expression tracking (from Phase 4)

Built ahead of schedule as a single-player prototype. Other people can't see it until
multiplayer (Phase 3) can carry the values.

| Feature                    | Status | Notes                                                                                      |
| -------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Opt-in camera              | Done   | "Face" button → panel → Turn on camera; the camera is never requested before that          |
| On-device face analysis    | Done   | MediaPipe Face Landmarker in the browser, model self-hosted; video never leaves the device |
| Head, blinks, brows, mouth | Done   | Head turn/nod/tilt, each eye's blink, smile, mouth open, eyebrow raise                     |
| Calibration                | Done   | Learns your resting face in the first second; Recalibrate button                           |
| Smoothing                  | Done   | One Euro filter per value; the face relaxes back to idle if you leave the frame            |
| "Your avatar" face view    | Done   | Small front-on view of your avatar's face in the corner while tracking is on               |
| Camera-on indicator        | Done   | Pulsing red dot on the HUD button; Turn off camera stops the webcam completely             |
| Mirror option              | Done   | Off by default (your left eye = avatar's left eye); turn on for mirror-style               |
| Sync to other players      | Later  | Phase 3/4: send the eight values ~10×/s, never video or landmarks                          |

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

Verified against the real Gemini API (2026-11-19): reading and answering works with Gemini 4
Hydrogen (about 2–3 s; read "7 − 2 =" correctly 4/4 times). The answer is written right under the
question at the same size and in the question's ink colour. A **free-tier key can't use the image
model** (Google returns "limit: 0 … Free Tier"), so it falls back to the handwriting font. Copying
the student's actual handwriting needs billing turned on and hasn't been seen working yet.

## Coming next

| Phase | Features                                                                                  |
| ----- | ----------------------------------------------------------------------------------------- |
| 2     | Display name above avatars, settings panel, more zone interactions                        |
| 3     | Colyseus multiplayer: public rooms (cap 15), remote avatars, interpolation, server checks |
| 4     | Study status, LiveKit proximity voice, optional on-device expression tracking             |
| 5     | Shared whiteboards (tldraw + Yjs; check the tldraw licence first), Pomodoro               |
| 6     | AI teacher: PDF upload, grounded answers with page references, ElevenLabs read-aloud      |
| 7     | Resource bookshelves, polish, deployment                                                  |
