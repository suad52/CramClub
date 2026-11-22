// The "other student": a second, real Cram Club client in its own headless Chrome process
// (profile "bot", port 9556, 1280x720, low graphics), so it has its own cookie (its own guest
// learner, shown to others as "Guest NNNN") and its own localStorage. It is never recorded.
//
// Module (from a recording script, can run concurrently with the recording):
//   import { Bot } from "./bot.mjs";
//   const bot = await Bot.up();                       // start Chrome if needed, enter the library
//   await bot.walkTo(-3.2, 2.5);                      // steer there (holds W, mouse-look)
//   await bot.sitAt("hall-t02-c4");                   // walk behind that chair, face it, press E
//   await bot.say("anyone else cramming bio tonight?");   // Enter, type key by key, Enter
//   await bot.typeFor("hmm let me think", 4000);      // shows "is typing…" for 4 s, then clears
//   bot.disconnect();                                  // the bot stays in the library
//
// CLI (each command connects, acts, disconnects; the bot keeps its place between commands):
//   node bot.mjs up [--name Maya] [--look CAMPUS_RUNNER]   start + enter the library
//   node bot.mjs where                                       position / seat / camera
//   node bot.mjs walk <x> <z>                                walk to a point
//   node bot.mjs sit <seatId>                                e.g. hall-t02-c4 (see app.mjs SEATS)
//   node bot.mjs stand
//   node bot.mjs say "<text>"
//   node bot.mjs typing "<text>" <ms>                        typing indicator only, never sent
//   node bot.mjs key <key> [holdMs]                          e.g. key w 1500, key e
//   node bot.mjs turn <radians>
//   node bot.mjs shot <file.png>                             the bot's own view (debugging)
//   node bot.mjs leave                                       back to the title (leaves the room)
//   node bot.mjs stop                                        close the bot's Chrome (keeps its profile)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./cdp.mjs";
import { launchChrome, connectChrome, stopChrome, PROFILES } from "./launch.mjs";
import * as app from "./app.mjs";

export class Bot {
  constructor(browser, page) {
    this.browser = browser;
    this.page = page;
  }

  /** Connects to the bot Chrome (starting it if needed) without changing what it is doing. */
  static async connect() {
    const browser = await launchChrome("bot");
    const page = await browser.page();
    return new Bot(browser, page);
  }

  /**
   * Starts the bot (if needed) and makes sure it is in the library: seeds its character the
   * first time (so it skips the Character Studio and the guide), then Enter the Library → Go in.
   */
  static async up({ name = "Maya", look = app.LOOKS.CAMPUS_RUNNER, quality = "low" } = {}) {
    const bot = await Bot.connect();
    await bot.enter({ name, look, quality });
    return bot;
  }

  async inLibrary() {
    const href = await this.page.url().catch(() => "");
    if (!href.startsWith(app.SITE)) return false;
    return this.page.evaluate(
      () => /Menu\s*\n?\s*Esc/.test(document.body?.innerText ?? "") && !!window.__demo?.player?.(),
    );
  }

  async enter({ name = "Maya", look = app.LOOKS.CAMPUS_RUNNER, quality = "low" } = {}) {
    if (await this.inLibrary()) return this;
    const p = this.page;
    const saved = (await p.url().catch(() => "")).startsWith(app.SITE)
      ? await p.getStorage("ovr.profile")
      : null;
    if (!saved) await app.seedCharacter(p, { name, look, quality });
    await app.openSite(p);
    await app.enterLibrary(p, { click: false });
    await app.lockLook(p);
    return this;
  }

  where() {
    return this.page.evaluate(() => ({
      player: window.__demo?.player?.(),
      camera: window.__demo?.pose?.(),
      text: (document.body?.innerText ?? "").slice(0, 300).replace(/\s*\n\s*/g, " | "),
    }));
  }

  /** Walks to (x, z) around the furniture (planned route). */
  walkTo(x, z, opts) {
    return app.goTo(this.page, x, z, opts);
  }

  walkPath(points, opts) {
    return app.walkPath(this.page, points, opts);
  }

  sitAt(seatId, opts) {
    return app.sitAt(this.page, seatId, opts);
  }

  standUp() {
    return app.standUp(this.page);
  }

  turn(yaw, pitch = 0, opts) {
    return this.page.turn(yaw, pitch, opts);
  }

  lookAt(x, z, opts) {
    return app.lookAt(this.page, x, z, opts);
  }

  say(text, opts) {
    return app.say(this.page, text, opts);
  }

  /** Types into the chat box for `ms` without sending (others see "… is typing"), then clears it. */
  async typeFor(text, ms = 3000) {
    const p = this.page;
    await p.press("Enter");
    await sleep(300);
    const t0 = Date.now();
    await p.type(text);
    const left = ms - (Date.now() - t0);
    if (left > 0) await sleep(left);
    await p.evaluate(() => {
      const a = document.activeElement;
      if (a && "value" in a) {
        const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(a), "value").set;
        set.call(a, "");
        a.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await p.press("Escape");
  }

  key(k, holdMs) {
    return holdMs ? this.page.hold(k, holdMs) : this.page.press(k);
  }

  /** Back to the title screen: the bot leaves the multiplayer room (Chrome keeps running). */
  async leave() {
    await app.openSite(this.page);
  }

  disconnect() {
    this.browser.disconnect();
  }

  static stop() {
    return stopChrome("bot");
  }
}

// ---------------------------------------------------------------- CLI
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const [cmd = "where", ...rest] = process.argv.slice(2);
  const flag = (n, d) => {
    const i = rest.indexOf(`--${n}`);
    return i >= 0 ? rest[i + 1] : d;
  };
  if (cmd === "stop") {
    await Bot.stop();
    console.log("bot Chrome stopped (profile kept)");
    process.exit(0);
  }
  const bot =
    cmd === "up"
      ? await Bot.up({ name: flag("name", "Maya"), look: app.LOOKS[flag("look", "CAMPUS_RUNNER")] })
      : await Bot.connect();
  try {
    const out = await (async () => {
      switch (cmd) {
        case "up":
          return bot.where();
        case "where":
          return bot.where();
        case "walk":
          return bot.walkTo(Number(rest[0]), Number(rest[1]));
        case "sit":
          return bot.sitAt(rest[0]);
        case "stand":
          return bot.standUp();
        case "say":
          return bot.say(rest[0]);
        case "typing":
          return bot.typeFor(rest[0], Number(rest[1] ?? 3000));
        case "key":
          return bot.key(rest[0], rest[1] ? Number(rest[1]) : undefined);
        case "turn":
          return bot.turn(Number(rest[0]), Number(rest[1] ?? 0));
        case "shot":
          return bot.page.screenshot(rest[0]);
        case "leave":
          return bot.leave();
        default:
          throw new Error(`unknown command ${cmd}`);
      }
    })();
    if (out !== undefined) console.log(JSON.stringify(out));
  } finally {
    bot.disconnect();
  }
  process.exit(0);
}

export { PROFILES };
