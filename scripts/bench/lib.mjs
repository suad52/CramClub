/**
 * Shared helpers for the measurement scripts in scripts/bench (see README.md there).
 *
 * The scripts run with plain `node` from anywhere. They borrow their dependencies from the
 * workspace packages instead of having their own package.json:
 *   - @colyseus/sdk from apps/web (the copy the browser bundles),
 *   - tsx from apps/game-server, to import the TypeScript source of @ovr/shared
 *     (packages/shared/src) and apps/web/lib/net/rate.ts exactly as the apps use them.
 * Nothing here reads an env file or a secret.
 */
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const WEB_DIR = join(ROOT, "apps/web");
export const GAME_DIR = join(ROOT, "apps/game-server");

export const webRequire = createRequire(join(WEB_DIR, "package.json"));
export const gameRequire = createRequire(join(GAME_DIR, "package.json"));

/** Imports a file by absolute path (bypasses package export maps). */
export const importFile = (path) => import(pathToFileURL(path).href);

/**
 * The directory of an installed package, found from one of the workspace apps. (Some export maps
 * hide `name/package.json`, so this walks up from the package's entry point instead.)
 */
export function packageDir(req, name) {
  let dir = dirname(req.resolve(name));
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, "utf8")).name === name)
      return dir;
    const up = dirname(dir);
    if (up === dir) throw new Error(`package ${name} not found`);
    dir = up;
  }
}

let tsImportFn = null;
/** Imports a TypeScript file through tsx (the same loader the game server's dev mode uses). */
export async function tsImport(path) {
  if (!tsImportFn) {
    const api = await importFile(join(packageDir(gameRequire, "tsx"), "dist/esm/api/index.mjs"));
    tsImportFn = api.tsImport;
  }
  return tsImportFn(pathToFileURL(path).href, import.meta.url);
}

/** @ovr/shared, from its TypeScript source (what both apps compile). */
export const loadShared = () => tsImport(join(ROOT, "packages/shared/src/index.ts"));

/** The Colyseus browser SDK, the same build the web app ships. */
export const loadSdk = () => importFile(webRequire.resolve("@colyseus/sdk"));

/** Nearest-rank percentile of an ascending array. */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / (sorted.length || 1);
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1] ?? null,
    mean: sorted.length ? mean : null,
  };
}

/** Where the numbers came from, for the write-up's caveat. */
export function machine() {
  const cpu = cpus();
  return {
    cpu: cpu[0]?.model ?? "unknown",
    cores: cpu.length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()}`,
    node: process.version,
  };
}

export const ms = (v) => (v === null || v === undefined ? "n/a" : `${v.toFixed(1)} ms`);
