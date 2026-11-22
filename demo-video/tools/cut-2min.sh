#!/bin/sh
# Builds demo-video/demo.mp4: the 2-minute cut (about 1:50 + your ~8 s face-tracking insert).
# One or two key moments per feature, trimmed from the shot clips ("clip@start-end", seconds
# into that clip), hard cuts, re-encoded as one constant-30-fps H.264 file. Where each piece lands
# goes to frames/demo-2min-timeline.json; SCRIPT.md is timed to it. The full-length cut of
# every clip is tools/assemble-demo.sh (demo-long.mp4).   Run:  sh demo-video/tools/cut-2min.sh
set -e
TOOLS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$TOOLS")"
if [ ! -x "$TOOLS/bin/assemble" ] || [ "$TOOLS/assemble.swift" -nt "$TOOLS/bin/assemble" ]; then
  mkdir -p "$TOOLS/bin"
  swiftc -O -swift-version 5 "$TOOLS/assemble.swift" -o "$TOOLS/bin/assemble"
fi
mkdir -p "$ROOT/frames"
cd "$ROOT/clips"
"$TOOLS/bin/assemble" "$ROOT/demo.mp4" \
  00-title.mp4@0-4 \
  01-character.mp4@8.5-13.5 01-character.mp4@18-20.5 \
  02-device-check.mp4@1.5-6 02-device-check.mp4@9.8-12.3 \
  03-walk-in.mp4@6.5-12.8 \
  04-chat-fenwick.mp4@3-8.8 04-chat-fenwick.mp4@14.5-16.5 04-chat-fenwick.mp4@25.8-30.9 \
  05-table-hold.mp4@2.5-8.5 05-table-hold.mp4@12-15.5 \
  06-demo-entry.mp4@12-15.5 \
  07-shush.mp4@4.5-10.5 \
  08-librarian.mp4@11.8-14.8 08-librarian.mp4@21.5-25 08-librarian.mp4@53.5-58 \
  09-whiteboard-lesson.mp4@10-13.5 09-whiteboard-lesson.mp4@31-37.8 \
  10-studio-book.mp4@5.5-9 10-studio-book.mp4@16.5-19.5 \
  11-showed-up.mp4@13.6-18.5 \
  12-progress.mp4@5-9 12-progress.mp4@41-44 \
  13-proof.mp4@17-20 13-proof.mp4@33.5-36.3 13-proof.mp4@51.5-55 \
  14-outro.mp4@1-5.5 \
  --timeline "$ROOT/frames/demo-2min-timeline.json" "$@"
rm -f "$ROOT"/demo.mp4.sb-*
