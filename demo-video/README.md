# Cram Club demo video

The demo video for the GitHub page, recorded on the live site (https://149-248-61-2.sslip.io) and
assembled here, plus the script to voice it over. Start with **[SCRIPT.md](SCRIPT.md)**.

## What's in this folder

| Path                                                                  | What it is                                                                                                                                                                                                                                                                                                       | In git?                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `demo.mp4`                                                            | **The 2-minute cut (1:50.2)**: 27 trimmed pieces, one or two per feature (edit list: `tools/cut-2min.sh`), plus your ~8 s insert = about 1:58. 1920x1080, constant 30 fps, H.264, no audio, about 175 MB. Script: [SCRIPT.md](SCRIPT.md).                                                                        | No (too big)                  |
| `demo-long.mp4`                                                       | The full-length cut: all 15 clips untrimmed, 7:42.3, about 655 MB. Script: [SCRIPT-long.md](SCRIPT-long.md).                                                                                                                                                                                                     | No (too big)                  |
| `clips/NN-name.mp4`                                                   | One clip per shot (`00-title` … `14-outro`): the masters to edit from, same format. `_test.mp4` is the toolchain's proof clip, not part of the cut.                                                                                                                                                              | No                            |
| `frames/`                                                             | PNG frame checks for every clip (`NN-name-SS.SSs.png`) and `demo-timeline.json` (where each clip starts and ends in `demo.mp4`).                                                                                                                                                                                 | No                            |
| [`SCRIPT.md`](SCRIPT.md)                                              | The 2-minute voiceover script, timed to `demo.mp4`. [`SCRIPT-long.md`](SCRIPT-long.md) is the long one, timed to `demo-long.mp4`: on screen, purpose, line and optional caption for every beat; how to record your own face-tracking insert; editing notes; trims; a feature coverage checklist; a teleprompter. | Yes                           |
| [`STORYBOARD.md`](STORYBOARD.md)                                      | The shot list the clips were recorded from (source of truth for what each shot shows and why).                                                                                                                                                                                                                   | Yes                           |
| [`tools/`](tools/README.md)                                           | The recording toolchain: headless Chrome driven over DevTools (plain Node), encoded with macOS AVFoundation (Swift). No ffmpeg, no npm packages.                                                                                                                                                                 | Yes (`tools/bin/` is ignored) |
| `tools/takes/`                                                        | The exact scripts that recorded clips 00–14 (see below).                                                                                                                                                                                                                                                         | Yes                           |
| `tools/assemble.swift`, `tools/cut-2min.sh`, `tools/assemble-demo.sh` | Joins (and trims: `clip.mp4@start-end`) the clips: `cut-2min.sh` builds `demo.mp4`, `assemble-demo.sh` builds `demo-long.mp4`.                                                                                                                                                                                   | Yes                           |

`demo.mp4`, `clips/` and `frames/` are in the repo's `.gitignore`. To put the video on GitHub, export
your edited version and attach it to a GitHub Release (or upload it to YouTube) and link it from the
main README: a video dropped into a README or issue is limited to 10 MB on free plans (100 MB on paid).

## Rebuild the videos

`sh demo-video/tools/cut-2min.sh` rebuilds the 2-minute `demo.mp4` (about 20 s). The full-length `demo-long.mp4`:

```sh
sh demo-video/tools/assemble-demo.sh
```

About 50 seconds. It compiles `tools/bin/assemble` on first use, lays the 15 clips end to end on an
`AVMutableComposition`, re-encodes them as one H.264 stream (16 Mbit/s, BT.709, every frame stamped
k/30 s, so the file is one clean constant-30-fps segment), checks the frame count, and prints the
timeline (also saved to `frames/demo-timeline.json`). Add `--passthrough` for an instant lossless
join instead (the file then carries one edit-list entry per clip, which some players and editors
handle badly).

## Re-record one clip

Ground rules (the recordings followed these; keep them):

- Only the **live** site, never the local dev servers (they show a dev badge and lack keys).
- Only the recording Chrome's **fake** camera and microphone, never yours. Keep the camera **off**
  in recorded shots (the fake camera is a green test pattern). Your own camera belongs only in the
  insert you record yourself (steps in SCRIPT.md).
- The site moved to **https://cramclub.study** (the sslip.io link redirects there). Run takes with
  `DEMO_SITE=https://cramclub.study`: localStorage belongs to the origin, so a script that writes it
  on the old address writes to the wrong place.
- Play as a guest. Each Chrome profile holds one anonymous production learner (cookie); never pass
  `--fresh` or `--wipe` unless you mean to make a new one.
- The profiles live in the tools' work dir (`DEMO_WORK_DIR`; by default the scratchpad of the
  session that recorded them). If that folder is gone, the next launch makes a new anonymous
  learner on production: one per Chrome profile, nothing worse.

Steps:

1. `cd demo-video/tools` and read [tools/README.md](tools/README.md) (API, pointer-lock emulation,
   the hall's coordinates, gotchas).
2. Start the Chrome(s) the take needs (table below) and get the app into the starting state.
3. Run the take. Each writes `../clips/NN-name.mp4` (add `--suffix -t2` to write
   `NN-name-t2.mp4` beside it and compare, then rename it over the original).
4. Check it: `bin/encode probe ../clips/NN-name.mp4`, then
   `bin/encode frames ../clips/NN-name.mp4 ../frames/NN-name 1,5,10` and look at the PNGs.
5. `sh assemble-demo.sh`. If the clip's length changed, every SCRIPT.md time after it moves by the
   difference (the clip-local times in each row stay right); re-time the lines that sit on it.

| Clip(s) | Run (from `demo-video/tools`)                                                                                                                                                                   | Chrome                                               | Before running                                                                                                                                                                                                                                                                            |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00–05   | `node takes/group-a/take.mjs --stages 03` (any of `00,01,02,03,04,05`; `--dry` rehearses with screenshots instead of recording)                                                                 | `main` :9555 ("Alex") and `bot` :9556 ("Guest 2716") | `node launch.mjs start`, `node bot.mjs up`, then `node takes/group-a/botprep.mjs` (stands the bot at (-4.0, 4.5)). Stage 00 resets the visitor (the app's localStorage only) so the title says "Create your character".                                                                   |
| 06 + 07 | `DEMO_SITE=https://cramclub.study node takes/group-b/rec0607.mjs`                                                                                                                               | `demo` :9557                                         | Recorded in one process because the pomodoro needs the tab kept focused. Opens `/demo` itself; between 06 and 07 it leaves Table 1 off camera and starts a fresh pomodoro at Table 3 (nearest Ms. Fenwick).                                                                               |
| 08      | `node takes/group-b/rec08.mjs`                                                                                                                                                                  | `demo` :9557                                         | Seated at Table 1 in `/demo` (where 06/07 leave you).                                                                                                                                                                                                                                     |
| 09      | `node takes/group-b/prep09.mjs start`, then `node takes/group-b/prep09.mjs lesson`, then `DEMO_SITE=https://cramclub.study node takes/group-b/rec09.mjs`                                        | `demo` :9557                                         | Off camera, with Ms. Fenwick's panel open: prep attaches `takes/group-b/notes/…` and has her build the lesson (minutes). It was run step by step with checks between; read the script first. rec09 sits at Table 1's second seat (`hall-t01-c2`) so the desk lamp doesn't hide the board. |
| 10, 11  | `TAKE_CHROME=demo DEMO_SITE=https://cramclub.study node takes/group-c/session.mjs --only 10,11`                                                                                                 | `demo` :9557                                         | Shot in the same browser as 09, so 'Your lessons' lists 09's lesson. With `TAKE_CHROME=demo` the script opens `/demo` itself and sits at Table 6 (`hall-t06-c2`).                                                                                                                         |
| 12      | `node takes/group-c/prep.mjs`, then `node takes/group-c/session.mjs --only 12`                                                                                                                  | `c` :9558                                            | Prep opens `/demo`, goes in and sits; 12 was shot at Table 6 (`app.sitAt(page, "hall-t06-c2")`).                                                                                                                                                                                          |
| 13      | `node takes/group-c/rec13.mjs`                                                                                                                                                                  | `c` :9558                                            | Opens `/proof` itself.                                                                                                                                                                                                                                                                    |
| 14      | `TAKE_CHROME=demo DEMO_SITE=https://cramclub.study node takes/group-c/rec14.mjs --look takes/group-c/looks/clip01-studio-artist.json --url cramclub.study --spawn 0.8,5.9` (`--dry` to preview) | `demo` :9557                                         | Opens the title screen with clip 01's character (put back afterwards), reloads until the spawn point gives the open-floor shot, hides the title UI and injects the end card with page CSS only.                                                                                           |

For a brand-new shot, copy `tools/test-clip.mjs` (the worked example) and use the helpers in
`tools/app.mjs`. `node launch.mjs stop all` stops the `main`, `bot` and `c` Chromes and
`node launch.mjs stop demo` stops the `demo` one (profiles, and so the learners, are kept).

Nothing here changes the app: the takes only drive the live site like a visitor.
