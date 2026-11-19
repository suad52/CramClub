// Copies runtime assets from node_modules into public/ so the browser loads them from our own
// origin instead of a CDN. Runs as part of `dev` and `build`; the output is git-ignored.
//  - MediaPipe's WebAssembly runtime (expression tracking)
//  - EMS Tech, a single-line handwriting font (SIL OFL) for writing out AI answers
import { cpSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const publicDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

// These packages don't export package.json, so resolve their entry file and walk from there.
const mediapipe = dirname(require.resolve("@mediapipe/tasks-vision"));
const wasmOut = join(publicDir, "mediapipe", "wasm");
mkdirSync(wasmOut, { recursive: true });
for (const file of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) {
  cpSync(join(mediapipe, "wasm", file), join(wasmOut, file));
}

const hershey = join(dirname(require.resolve("hersheytext")), "..");
const fontsOut = join(publicDir, "fonts");
mkdirSync(fontsOut, { recursive: true });
// The SVG keeps its metadata header with the font's credits and licence.
cpSync(join(hershey, "svg_fonts", "EMSTech.svg"), join(fontsOut, "ems-tech.svg"));

console.log(`Assets copied to ${publicDir}`);
