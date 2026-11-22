// Launches (or reuses) a headless Chrome for recording, and wraps its targets as Page objects.
//
// Module:
//   import { launchChrome, connectChrome, stopChrome } from "./launch.mjs";
//   const browser = await launchChrome();              // "main" Chrome on :9555, 1920x1080 viewport
//   const page = await browser.page();                 // the main tab (created if missing)
//   const ctx = await browser.newContext();            // isolated storage in the same Chrome
//   const other = await browser.newPage({ contextId: ctx, width: 1280, height: 720 });
//   browser.disconnect();                              // Chrome keeps running for the next script
//   await stopChrome("main");                          // kill it and (with wipe) delete its profile
//
// CLI:
//   node launch.mjs start [main|bot] [--fresh]   start detached Chrome (reused if already up)
//   node launch.mjs status                        list running demo Chromes
//   node launch.mjs stop [main|bot|all] [--wipe]  kill it; --wipe deletes the temp profile too
//   node launch.mjs gpu                            print the WebGL renderer of the main Chrome
//
// Extra Chrome flags (only when this call actually starts Chrome; a running one is reused as is):
//   launchChrome("demo", { extraArgs: ["--use-file-for-fake-video-capture=/abs/selfie.y4m"] })
//   DEMO_EXTRA_ARGS='--use-file-for-fake-video-capture=/abs/selfie.y4m' node launch.mjs start demo
// DEMO_EXTRA_ARGS is split on whitespace, or parsed as JSON when it starts with "[". Unset = the
// usual flags, nothing added. Stop the Chrome first (stop <name>, no --wipe) to change its flags.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CDP, sleep } from "./cdp.mjs";
import { Page } from "./page.mjs";

export const CHROME_BIN =
  process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const SITE = process.env.DEMO_SITE ?? "https://149-248-61-2.sslip.io";
/** Where temp profiles, state files and raw frames live (outside the repo). */
export const WORK_DIR =
  process.env.DEMO_WORK_DIR ??
  "/private/tmp/claude-501/-Users-suad/51a671f4-4cde-4bf3-89ff-25f9aca8f7f0/scratchpad/demo-rec";

/** Named Chrome instances: the recorded one and the "other student" bot. */
export const PROFILES = {
  main: { port: 9555, width: 1920, height: 1080 },
  bot: { port: 9556, width: 1280, height: 720 },
  // Recorder C (shots 10-14), runs alongside the others; 9557 is taken by the "demo" Chrome.
  c: { port: 9558, width: 1920, height: 1080 },
  // Group B's /demo Chrome (takes/group-b, TAKE_CHROME=demo in group-c): its own learner.
  demo: { port: 9557, width: 1920, height: 1080 },
};

/** Extra Chrome flags from DEMO_EXTRA_ARGS (whitespace-separated, or a JSON array). */
export function envExtraArgs(v = process.env.DEMO_EXTRA_ARGS) {
  if (!v || !v.trim()) return [];
  const t = v.trim();
  if (t.startsWith("[")) return JSON.parse(t).map(String);
  return t.split(/\s+/);
}

const stateFile = (name) => path.join(WORK_DIR, `${name}.chrome.json`);

function readState(name) {
  try {
    return JSON.parse(readFileSync(stateFile(name), "utf8"));
  } catch {
    return null;
  }
}

async function portAlive(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return r.ok;
  } catch {
    return false;
  }
}

export function chromeArgs({ port, profileDir, width, height, extraArgs = [] }) {
  return [
    "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    // Headless "new" keeps ~87 px of invisible window chrome: launch taller, then fitViewport()
    // corrects the window so window.innerWidth x innerHeight is exactly width x height.
    `--window-size=${width},${height + 87}`,
    "--force-device-scale-factor=1",
    "--hide-scrollbars",
    // GPU: new headless on Apple silicon already uses ANGLE Metal; these keep it from falling
    // back to SwiftShader on a blocklisted driver.
    "--use-angle=metal",
    "--ignore-gpu-blocklist",
    "--enable-gpu-rasterization",
    // Never the real camera / mic: Chrome's fake devices (green test pattern + beeping tone),
    // with the permission prompt auto-accepted.
    "--use-fake-device-for-media-stream",
    "--use-fake-ui-for-media-stream",
    "--autoplay-policy=no-user-gesture-required",
    // Silent: nothing plays through the Mac's speakers (media still runs and fires its events).
    "--mute-audio",
    // Keep timers and rAF at full speed even though there is no visible window.
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=Translate,MediaRouter,OptimizationHints,CalculateNativeWinOcclusion",
    // No macOS keychain prompt for a fresh profile.
    "--use-mock-keychain",
    "--password-store=basic",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--disable-extensions",
    "--disable-component-update",
    "--metrics-recording-only",
    ...extraArgs,
    "about:blank",
  ];
}

/**
 * Starts the named Chrome detached (it outlives this script) unless one is already listening on
 * its port, then connects. `fresh` wipes the profile first (new learner, empty localStorage).
 * `extraArgs` (default: DEMO_EXTRA_ARGS, else none) are added to the flags when Chrome is started.
 */
export async function launchChrome(
  name = "main",
  { fresh = false, port, width, height, extraArgs } = {},
) {
  const base = PROFILES[name] ?? PROFILES.main;
  port ??= base.port;
  width ??= base.width;
  height ??= base.height;
  extraArgs ??= envExtraArgs();
  mkdirSync(WORK_DIR, { recursive: true });
  const profileDir = path.join(WORK_DIR, `profile-${name}`);
  if (fresh) {
    await stopChrome(name, { wipe: true });
  }
  if (!(await portAlive(port))) {
    mkdirSync(profileDir, { recursive: true });
    const child = spawn(CHROME_BIN, chromeArgs({ port, profileDir, width, height, extraArgs }), {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    writeFileSync(
      stateFile(name),
      JSON.stringify(
        {
          name,
          pid: child.pid,
          port,
          profileDir,
          width,
          height,
          extraArgs,
          startedAt: Date.now(),
        },
        null,
        1,
      ),
    );
    const deadline = Date.now() + 20000;
    while (!(await portAlive(port))) {
      if (Date.now() > deadline) throw new Error(`Chrome "${name}" did not start on :${port}`);
      await sleep(150);
    }
  }
  const browser = await connectChrome(port, { width, height, name });
  return browser;
}

export async function connectChrome(port = PROFILES.main.port, { width, height, name } = {}) {
  const conn = await CDP.connect(port);
  return new Browser(conn, { width, height, name });
}

/** Kills a named Chrome (by its state file pid, then by port). `wipe` deletes its profile. */
export async function stopChrome(name = "main", { wipe = false } = {}) {
  const st = readState(name);
  const port = st?.port ?? PROFILES[name]?.port;
  if (port && (await portAlive(port))) {
    try {
      const c = await CDP.connect(port);
      await c.send("Browser.close").catch(() => {});
      c.close();
    } catch {}
    for (let i = 0; i < 30 && (await portAlive(port)); i++) await sleep(100);
  }
  if (st?.pid) {
    try {
      process.kill(st.pid, 0);
      process.kill(st.pid, "SIGTERM");
    } catch {}
  }
  if (existsSync(stateFile(name))) unlinkSync(stateFile(name));
  const memo = path.join(WORK_DIR, `${name}.page`);
  if (existsSync(memo)) unlinkSync(memo);
  if (wipe) {
    await sleep(300);
    rmSync(st?.profileDir ?? path.join(WORK_DIR, `profile-${name}`), {
      recursive: true,
      force: true,
    });
  }
}

export class Browser {
  constructor(conn, { width = 1920, height = 1080, name = "main" } = {}) {
    this.conn = conn;
    this.width = width;
    this.height = height;
    this.name = name;
    this.attached = new Map(); // targetId -> Page
  }

  async targets() {
    return (await this.conn.send("Target.getTargets")).targetInfos;
  }

  /**
   * The main tab of this Chrome, as a Page. The same tab every time (its id is remembered in
   * WORK_DIR/<name>.page), so separate scripts drive one continuous session; stray blank tabs in
   * the default context are closed. Created if there is none.
   */
  async page({ width = this.width, height = this.height, lockShim = true } = {}) {
    const isolated = new Set(await this.contexts());
    const pages = (await this.targets()).filter(
      (x) =>
        x.type === "page" && !isolated.has(x.browserContextId) && !x.url.startsWith("devtools:"),
    );
    const memo = path.join(WORK_DIR, `${this.name}.page`);
    let remembered = null;
    try {
      remembered = readFileSync(memo, "utf8").trim();
    } catch {}
    let t =
      pages.find((x) => x.targetId === remembered) ??
      pages.find((x) => /^https?:/.test(x.url)) ??
      pages[0];
    const targetId = t
      ? t.targetId
      : (await this.conn.send("Target.createTarget", { url: "about:blank" })).targetId;
    for (const x of pages)
      if (x.targetId !== targetId && (x.url === "about:blank" || x.url === ""))
        await this.conn.send("Target.closeTarget", { targetId: x.targetId }).catch(() => {});
    mkdirSync(WORK_DIR, { recursive: true });
    writeFileSync(memo, targetId);
    return this.#attach(targetId, { width, height, lockShim });
  }

  /** A new isolated browser context (own cookies, localStorage, IndexedDB), lives until Chrome exits. */
  async newContext() {
    const { browserContextId } = await this.conn.send("Target.createBrowserContext", {
      disposeOnDetach: false,
    });
    return browserContextId;
  }

  async contexts() {
    return (await this.conn.send("Target.getBrowserContexts")).browserContextIds;
  }

  /** Opens a new tab (in `contextId` if given) and attaches to it. */
  async newPage({
    contextId,
    url = "about:blank",
    width = this.width,
    height = this.height,
    lockShim = true,
  } = {}) {
    const { targetId } = await this.conn.send("Target.createTarget", {
      url,
      ...(contextId ? { browserContextId: contextId, newWindow: true } : {}),
    });
    return this.#attach(targetId, { width, height, lockShim });
  }

  /** Attaches to an existing page target by id. */
  async attach(targetId, opts = {}) {
    return this.#attach(targetId, { width: this.width, height: this.height, ...opts });
  }

  async #attach(targetId, { width, height, lockShim = true }) {
    if (this.attached.has(targetId)) return this.attached.get(targetId);
    const { sessionId } = await this.conn.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const page = new Page(this, targetId, sessionId, { lockShim });
    this.attached.set(targetId, page);
    await page.init();
    await this.fitViewport(page, width, height);
    return page;
  }

  /**
   * Resizes the page's window so its viewport is exactly width x height CSS px at DPR 1. Falls back
   * to Emulation.setDeviceMetricsOverride (per connection) if the window can't be resized.
   */
  async fitViewport(page, width = this.width, height = this.height) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const v = await page.evaluate("({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })");
      if (v.w === width && v.h === height && v.dpr === 1) return v;
      try {
        const { windowId, bounds } = await this.conn.send("Browser.getWindowForTarget", {
          targetId: page.targetId,
        });
        await this.conn.send("Browser.setWindowBounds", {
          windowId,
          bounds: { width: bounds.width + (width - v.w), height: bounds.height + (height - v.h) },
        });
        await sleep(250);
      } catch {
        break;
      }
    }
    const v = await page.evaluate("({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })");
    if (v.w !== width || v.h !== height || v.dpr !== 1) {
      await page.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      page.emulatedViewport = true;
    }
    return page.evaluate("({ w: innerWidth, h: innerHeight, dpr: devicePixelRatio })");
  }

  /** Closes this script's connection; Chrome (and its tabs) keep running. */
  disconnect() {
    this.conn.close();
  }
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [cmd = "status", nameArg, ...rest] = process.argv.slice(2);
  const flags = new Set([nameArg, ...rest].filter((a) => a?.startsWith("--")));
  const name = nameArg && !nameArg.startsWith("--") ? nameArg : "main";
  if (cmd === "start") {
    const b = await launchChrome(name, { fresh: flags.has("--fresh") });
    const p = await b.page();
    console.log(
      JSON.stringify({
        name,
        port: b.conn.port,
        viewport: await p.evaluate("[innerWidth, innerHeight, devicePixelRatio]"),
        chrome: b.conn.version.Browser,
      }),
    );
    b.disconnect();
  } else if (cmd === "stop") {
    const names = name === "all" ? Object.keys(PROFILES) : [name];
    for (const n of names) await stopChrome(n, { wipe: flags.has("--wipe") });
    console.log("stopped", names.join(", "));
  } else if (cmd === "status") {
    for (const [n, p] of Object.entries(PROFILES))
      console.log(
        n,
        `:${p.port}`,
        (await portAlive(p.port)) ? "running" : "stopped",
        readState(n)?.profileDir ?? "",
        readState(n)?.extraArgs?.length ? readState(n).extraArgs.join(" ") : "",
      );
  } else if (cmd === "gpu") {
    const b = await connectChrome(PROFILES[name]?.port ?? 9555);
    const p = await b.page();
    console.log(
      await p.evaluate(
        `(() => { const g = document.createElement('canvas').getContext('webgl2'); if (!g) return 'NO WEBGL2'; const d = g.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER); })()`,
      ),
    );
    b.disconnect();
  } else {
    console.log("usage: node launch.mjs start|stop|status|gpu [main|bot|all] [--fresh|--wipe]");
  }
}
