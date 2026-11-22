# Demo recording tools

Plain Node (`.mjs`, built-in `WebSocket`/`fetch`, Node 22+; tested on Node 26) driving a headless
Google Chrome over the DevTools protocol, plus one Swift file that encodes with AVFoundation. No
npm packages, no ffmpeg, no Homebrew.

Clips land in `../clips/NN-name.mp4` (1920x1080, constant 30 fps, H.264 High, ~16 Mbit/s, no
audio track). Frame checks go in `../frames/`.

| File            | What it is                                                                                           |
| --------------- | ---------------------------------------------------------------------------------------------------- |
| `launch.mjs`    | Starts/reuses the headless Chromes (`main` :9555 recorded, `bot` :9556), gives you `Page` objects.   |
| `page.mjs`      | `Page`: goto, evaluate, waits, find by text, gliding mouse + click ripple, typing, keys, mouse-look. |
| `harness.js`    | Injected into every document: drawn cursor + ripple, keycast, pointer-lock emulation, 3D pose reads. |
| `recorder.mjs`  | Screencast → JPEG frames + timestamps → `bin/encode` → MP4. Pause/resume, probe, frame extraction.   |
| `encode.swift`  | `bin/encode encode\|probe\|frames` (AVFoundation). Built automatically on first use.                 |
| `app.mjs`       | Cram Club helpers: visitor state, enter the library, lock the look, route planning, sit, chat.       |
| `bot.mjs`       | The "other student": a second real client in its own Chrome, as a module or a CLI.                   |
| `index.mjs`     | Re-exports everything.                                                                               |
| `test-clip.mjs` | The proof run (title orbit 10 s + 5 s walk): a worked example of a recording script.                 |

## Measured (Apple M5, Chrome 158, live site)

- WebGL: **ANGLE Metal on the real GPU** (new headless uses it by default; no SwiftShader). The 3D
  library renders exactly like desktop Chrome.
- rAF: 56–60 fps on the title orbit, 52–60 fps walking in the hall with the bot client running.
- Screencast capture at JPEG q90, everyNthFrame 1: **47–60 fps** (`_test.mp4`: 899 frames in 15 s
  = 59.8 fps, longest gap 67 ms). Nothing needed tuning; graphics stay on "high".
- Output: exactly 30 fps CFR; frames are picked by browser timestamp, so motion is real-time
  (15.06 s of wall clock → 452 frames / 15.067 s). 451 of 452 output frames were distinct.
- Encoding takes ~0.3 s per second of video. A 15 s clip is ~30 MB. Raw JPEGs (~300 KB each,
  ~15 MB/s) go to the work dir and are deleted after encoding.

## Quick start

```sh
cd demo-video/tools
node launch.mjs start          # main Chrome (reused if running): exactly 1920x1080 @ DPR 1
node bot.mjs up                # the other student enters the library (own Chrome, not recorded)
node test-clip.mjs             # proof: clips/_test.mp4 + frames/_test-*.png
node launch.mjs status | stop all
```

A recording script:

```js
import { launchChrome, startRecording, probe, extractFrames, app, Bot, sleep } from "./index.mjs";

const browser = await launchChrome("main");
const page = await browser.page();          // the same tab every run
try {
  await app.openSite(page);                 // live site title screen
  await page.waitForText("Enter the Library");
  await page.placeMouse(1300, 820);          // where the drawn cursor starts
  const rec = await startRecording(page, "03-walk-in");
  await page.click("Enter the Library");     // glides 400–700 ms, ripple, real click
  ...
  await rec.pause();                         // cut: skip a slow bit
  ...
  await rec.resume();
  const info = await rec.stop();             // encodes clips/03-walk-in.mp4
  console.log(info);                         // { seconds, captured, captureFps, maxGapMs, encoded }
  console.log(probe(info.file));
  extractFrames(info.file, "../frames/03-walk-in", [1, 4, 8]);   // then LOOK at them
} finally {
  browser.disconnect();                      // ALWAYS: an open socket keeps node running
}
```

## Ground rules baked in

- **Only the live site** (`SITE` = `https://149-248-61-2.sslip.io`, override with `DEMO_SITE`).
- **Fake media only**: `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`. The
  mic is Chrome's beeping test tone (the device check's meter moves), the camera a green test
  pattern: keep the camera OFF in recorded shots. The mic picker shows the device name
  **"Fake Audio Input 1"** (see Gotchas).
- `--mute-audio`: nothing plays on the Mac's speakers. Narration, Ms. Fenwick's voice and sounds
  still run (and fire their events) silently; the user records the voiceover.
- **Two learners on production, no more.** Each Chrome profile has a learner cookie (made on
  first entry): `main` (character "Alex") and `bot` (shown to others as **"Guest 2716"**). Never
  use `--fresh`/`--wipe` unless you mean to create a new production learner. For the "fresh
  visitor" shot use `app.resetVisitor(page)` (clears the app's localStorage only).
- Profiles, state files and raw frames live in `WORK_DIR` (the session scratchpad,
  `.../scratchpad/demo-rec`, override with `DEMO_WORK_DIR`), never in the repo.
- Never drive the same Chrome from two scripts at once. The bot is a separate Chrome, so a
  recording script can run bot commands concurrently (module API) or you can call the bot CLI
  between recordings.

## Pointer lock (read this)

Headless Chrome **refuses** `requestPointerLock`. Without help the app falls back to
drag-to-look and shows a "Hold the mouse button and drag to look around" chip plus a focus
outline, which a real desktop user never sees. `harness.js` therefore **emulates pointer lock**
the way desktop Chrome behaves (default on; `browser.page({ lockShim: false })` to turn off):

- `requestPointerLock()` succeeds and fires `pointerlockchange` asynchronously;
  `document.pointerLockElement` reports the canvas; `exitPointerLock()` releases it.
- **Esc** is delivered to the page while still locked, then the lock is released, exactly like
  Chrome, so the app opens its menu from the lock change (tested: Esc → menu, Resume → locked).
- While locked the drawn cursor is hidden (as the OS hides it). Mouse moves keep real
  `movementX/Y`, so `page.look()/turn()` rotate the camera precisely (2.2 mrad per px at the
  default sensitivity; measured 0.660 rad for 300 px, expected 0.660).
- After entering, the app shows a "Click to look around" sticker until the first click:
  `app.lockLook(page)` clicks the view at (960, 640) (that click is visible, with a ripple, as a
  real user would do it). Do it before rolling if you don't want it in the shot.
- **Clicking while locked**: in real Chrome clicks go to the locked canvas; in the emulation they
  hit whatever element is under the (hidden) mouse. To use HUD buttons do what a user does:
  **Esc** (menu, cursor appears where the lock began) or **hold Shift** (`page.keyDown("Shift")`
  ... `page.keyUp("Shift")`: the app frees the cursor, then re-locks).

## API

### launch.mjs

- `launchChrome(name = "main", { fresh })` → `Browser`. Starts Chrome detached (it outlives the
  script) unless already up. Viewport is verified/fixed to exactly 1920x1080 at DPR 1 (`bot`:
  1280x720). Flags: GPU (ANGLE Metal), fake media, autoplay without gesture, mute, no background
  throttling, mock keychain (no macOS keychain prompt).
- `browser.page({ lockShim })` → the main tab (remembered by id, so every script gets the same
  tab and session; stray blank tabs are closed).
- `browser.newContext()` → id of an isolated browser context (own cookies/storage) in the same
  Chrome; `browser.newPage({ contextId, width, height })`. (The bot uses a separate Chrome process
  instead, so its learner survives Chrome restarts.)
- `browser.disconnect()`; `stopChrome(name, { wipe })`; CLI `start|stop|status|gpu`.

### Page (page.mjs)

Navigation and JS

- `goto(url)` (waits for load), `reload()`, `url()`, `evaluate(exprOrFn, ...args)` (awaits
  promises, returns by value), `waitFor(exprOrFn, { timeout, interval, args })`,
  `waitForText(text, { timeout, gone })`, `text()`, `exists(target)`, `takeLogs()` (console
  errors/warnings + exceptions; the THREE.Clock deprecation warning is normal),
  `setStorage({ key: value })`, `getStorage(key)`, `screenshot(file)`, `fps(ms)` (real rAF rate).
- `upload(selector, [files])` sets files on an `<input type=file>` (no dialog).

Finding things: `locate(target)` → `{ x, y, w, h, left, top, tag, text }` (centre in CSS px).
`target` is visible text (`"Go in"`) or `{ text, exact, selector, role, within, index }`: text
matches aria-label, innerText, value, title or placeholder, case-insensitive; interactive
elements, exact matches, elements actually hit at their centre (not covered) and smaller boxes
win. Waits up to 15 s.

Mouse (all real `Input.dispatchMouseEvent`, so the app sees trusted events)

- `click(target, { dx, dy, pause, duration })`: glides there (ease-in-out, slight arc, 400–700 ms
  by distance, a move every ~16 ms), pauses ~150 ms, presses ~90 ms. Ripple drawn on press.
- `hover(target)`, `moveTo(x, y, { duration })`, `mouseDown()`, `mouseUp()`, `doubleClick()`,
  `placeMouse(x, y)` (instant, e.g. before a clip starts).
- `scroll(dy, { x, y, duration })`: smooth wheel scroll (small deltas every 16 ms, eased).
- `look(dx, dy, { duration })` (px, eased), `turn(yawRad, pitchRad, { duration })` (+yaw =
  left, +pitch = up), `nudge(dx, dy)` (one step, for steering loops), `pointerLocked()`.
- `cursor(false|true)` hides/shows the drawn cursor (e.g. for pure walking shots).

Keyboard

- `press(key)` ("Enter", "Escape", "e", "p", "?", "ArrowDown", "Space", ...), `keyDown(key)`,
  `keyUp(key)`, `hold(key, ms)` (e.g. `hold("w", 2500)` walks ~7 m; walking is ~3 m/s), `holdKeys(["w","a"], ms)`.
- `type(text, { delay: [45, 120] })`: key by key with human-ish gaps (longer after spaces and
  punctuation). Works for chat and the Librarian's box; others see "is typing".
- `keycast(true)`: shows pressed game keys as keycaps at the bottom centre (E, P, Enter, Esc, W...;
  never what's typed into text boxes). Off by default; the user can decide if they want it.

3D reads (production has no `window.__ovr`; these come from the R3F root the harness captures)

- `pose()` → camera `{ x, y, z, yaw, pitch, fov }` (yaw 0 = looking north/-Z, the app's convention).
- `player()` → the local avatar's feet `{ x, y, z, facing, visible }` (the app's `runtime.x/z`).
- `face(x, z)` turns the camera toward a world point.

### app.mjs (Cram Club)

- `openSite(page, path = "/")`; `SITE`.
- `seedCharacter(page, { name, look, quality, cameraMode, guideSeen, camera, mic })`: saved
  character + prefs in localStorage so the title offers "Enter the Library". `LOOKS` has
  `COZY_READER` (default), `CAMPUS_RUNNER` (the bot), `NIGHT_OWL`.
- `resetVisitor(page)`: first-time visitor again ("Create your character", controls guide,
  unanswered device check) **without** a new learner (cookie kept). Reload/goto after.
- `enterLibrary(page, { click })`: title → Enter the Library → Go in → playing (closes the
  controls guide if it appears). `waitPlaying(page)`.
- `lockLook(page)`: click to capture the mouse (see Pointer lock).
- `goTo(page, x, z)`: walks there **around the furniture** (A* on a 0.2 m grid built from
  `packages/shared/src/world/library-plan.json` + the code-built librarian desk and leaderboards),
  holding W and steering with the mouse like a person. Returns `{ x, z, dist, stuck, route }`.
  `walkTo` is the straight-line version; `walkPath(points)`; `planRoute(x0, z0, x1, z1)`;
  `walkable(x, z)`. Options: `tol`, `maxTurn` (rad/s, default 2.2), `pitch` (hold camera pitch).
- `lookAt(page, x, z, { y })`: camera toward a world point.
- `SEATS`, `seatById(id)`, `seatApproach(id)`, `sitAt(page, seatId)` (stands up first if seated,
  routes behind the chair, faces it, presses E), `sit(page)`, `isSeated(page)`, `standUp(page)`.
- `say(page, text, { close })`: Enter, types key by key, Enter (Esc after, unless `close:false`).
  `chatLines(page)`: lines in the open chat panel.

Hall layout (metres; +x east, +z south toward the entrance; the floor is x -14..14, z -10..8):
spawn ≈ (0, 5.6–6.6) facing north. Two rows of six long tables: north row t01–t06 (seats z -5.9,
-4.6, -3.3), south row t07–t12 (seats z 1.3, 2.6, 3.9); table centres x = -9.1, -5.7, -2.3, 2.3,
5.7, 9.1 (t01/t07 westmost). Seat ids `hall-tNN-c1..c6` (c1–c3 on the west side facing east,
c4–c6 on the east side facing west). Clear aisles: centre x ≈ 0 (spawn → librarian), cross aisle
z ≈ -1, side aisles x ≈ ±4.0 and ±7.4. Whiteboards stand at z -2.3 (north row) and 0.3 (south
row). Ms. Fenwick's desk: front at z -7.45, x -1.5..1.5; stand at about (0, -6.6) to talk (E).
Leaderboards on the west/east walls at z -1.

### Bot (bot.mjs)

The bot is a real client: it joins the same Colyseus room, shows its name tag, typing dots,
speech bubbles and counts in "2 here".

```js
const bot = await Bot.up();                   // or Bot.connect() if it's already in
await bot.sitAt("hall-t09-c1");               // seated at Table 9, west side
const p = bot.say("anyone else cramming bio tonight?");  // ~3–4 s of typing, then sent
await rec ... ; await p;
await bot.typeFor("hmm", 4000);              // typing indicator only, never sent
await bot.walkTo(x, z); bot.where(); bot.standUp(); bot.lookAt(x, z); bot.key("e");
await bot.leave();                            // title screen: leaves the room
bot.disconnect();
```

CLI: `node bot.mjs up | where | walk x z | sit hall-t09-c1 | stand | say "..." |
typing "..." ms | key w 1500 | turn rad | shot file.png | leave | stop`.

Both Chromes were stopped after testing (profiles and learner cookies kept). `node bot.mjs up`
brings the bot back in at the spawn; `node bot.mjs sit hall-t09-c1` seats it at Table 9, visible
on the left when the main player walks north up the centre aisle from the spawn (as in
`_test.mp4`). Walking to Ms. Fenwick's desk: `goTo(page, 0, -6.6)` (verified: "Speak with the
Librarian" appears).

### recorder.mjs and encode

- `startRecording(page, name, { quality = 90, out, keepRaw, fps = 30, bitrate })` → `rec`.
  `rec.pause()` / `rec.resume()` cut out a stretch (the clip jumps from the last frame to the
  next), `rec.elapsed` (video seconds so far), `rec.stop()` → stats + encodes.
- `recordClip(page, name, async (rec) => {...}, { lead, tail })`.
- `probe(file)` → `{ duration, fps, frames, keyframes, width, height, codec, audioTracks }`
  (frames are counted by reading every sample with AVAssetReader).
- `extractFrames(file, prefix, [seconds])` → PNGs `prefix-SS.SSs.png` (exact-time AVAssetImageGenerator).
- CLI: `bin/encode encode <rawDir> <out.mp4> [--fps 30]`, `bin/encode probe <mp4>`,
  `bin/encode frames <mp4> <prefix> 1,2.5,4`. Rebuild: `swiftc -O encode.swift -o bin/encode`.

How timing works: every screencast frame carries Chrome's own timestamp; output frame k shows the
newest captured frame at or before k/30 s (+ half a frame). A still page sends no frames, which is
fine (the last one is held). Real-time speed is preserved even if capture stutters.

## Gotchas found while building this

- `--window-size` in new headless includes ~87 px of invisible chrome; `fitViewport` corrects the
  window so `innerWidth x innerHeight` is exactly 1920x1080 (checked on every attach).
- Chrome can start with two blank tabs, and target order isn't stable: always get the page via
  `browser.page()` (it remembers the tab).
- Scripts must `browser.disconnect()` (or `process.exit()`), otherwise node never exits.
- The harness is installed for new documents of a connection and into the current one. If a page
  was loaded by an older run, `goto`/`reload` it to get the current harness.
- Device check (clip 02): the mic picker shows Chrome's fake device name **"Fake Audio Input 1"**,
  and a camera list would say "fake". It's the only "fake" text the fake devices put on screen;
  frame it out or accept it, but don't use a real device.
- A straight `walkTo` stops (`stuck: true`) at tables and chairs; use `goTo`. Third-person walking
  camera trails ~3.6 m behind (scroll zooms, `V` switches to first person).
- `isSeated` reads "Stand up"/"Leave table" in the HUD; the seated avatar eases onto the chair
  over ~0.5 s.
- Nothing in the app had to change. No app bugs found in the paths exercised (title, character
  seeding, device check, entering, walking, look, menu, multiplayer presence, chat bubble, sitting).
