#!/bin/sh
# Rebuilds demo-video/demo-long.mp4 (the full-length cut) from the 15 shot clips in storyboard order (hard cuts, nothing
# trimmed), re-encoded as one constant-30-fps H.264 file, and writes where each clip starts in
# frames/demo-long-timeline.json. Run from anywhere:  sh demo-video/tools/assemble-demo.sh
# (Builds tools/bin/assemble from assemble.swift on first use; needs only macOS + swiftc.)
set -e
TOOLS="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(dirname "$TOOLS")"
if [ ! -x "$TOOLS/bin/assemble" ] || [ "$TOOLS/assemble.swift" -nt "$TOOLS/bin/assemble" ]; then
  mkdir -p "$TOOLS/bin"
  swiftc -O -swift-version 5 "$TOOLS/assemble.swift" -o "$TOOLS/bin/assemble"
fi
mkdir -p "$ROOT/frames"
cd "$ROOT/clips"
"$TOOLS/bin/assemble" "$ROOT/demo-long.mp4" \
  00-title.mp4 01-character.mp4 02-device-check.mp4 03-walk-in.mp4 04-chat-fenwick.mp4 \
  05-table-hold.mp4 06-demo-entry.mp4 07-shush.mp4 08-librarian.mp4 09-whiteboard-lesson.mp4 \
  10-studio-book.mp4 11-showed-up.mp4 12-progress.mp4 13-proof.mp4 14-outro.mp4 \
  --timeline "$ROOT/frames/demo-long-timeline.json" "$@"
# A sandboxed shell can leave the writer's pre-fast-start copy behind as demo-long.mp4.sb-*: drop it.
rm -f "$ROOT"/demo-long.mp4.sb-*
