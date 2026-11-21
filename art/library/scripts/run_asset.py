"""
Runs one asset module's `preview(out_dir)` in a clean scene (headless Blender).

    /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python-exit-code 1 \
        --python art/library/scripts/run_asset.py -- --module table_set --out /tmp/prev [--func preview]
"""

import importlib
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import lib_core  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return args[args.index(name) + 1] if name in args else default


module = importlib.import_module(arg("--module"))
out = os.path.abspath(arg("--out", "/tmp/ovr_preview"))
os.makedirs(out, exist_ok=True)
lib_core.reset_scene()
getattr(module, arg("--func", "preview"))(out)
print("PREVIEW_DONE", out)
