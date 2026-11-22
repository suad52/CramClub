// Recording group A: 00-title, 01-character, 02-device-check, 03-walk-in, 04-chat-fenwick,
// 05-table-hold, as one continuous run on the live site (each shot its own clip).
//   node take.mjs [--stages 00,01,02,03,04,05] [--dry] [--suffix -t2]
// --dry rehearses without recording (screenshots at beats into ./dry/).
// The bot must already be in the library, standing at (-4.0, 4.5) (see README in this folder).
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import { faceFrom } from "./helpers.mjs";

const { launchChrome, app, sleep, Bot, startRecording, probe, extractFrames } = T;
const ENCODER = "/Users/suad/Documents/GitHub/OVR/demo-video/tools/bin/encode";
const CLIPS = "/Users/suad/Documents/GitHub/OVR/demo-video/clips";
const FRAMES = "/Users/suad/Documents/GitHub/OVR/demo-video/frames";
// Scratch output (dry-run screenshots, report.json) goes under the tools' work dir.
const HERE = path.join(T.WORK_DIR, "takes", "group-a");
mkdirSync(HERE, { recursive: true });

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 ? argv[i + 1] : d;
};
const DRY = argv.includes("--dry");
const STAGES = flag("stages", "00,01,02,03,04,05").split(",");
const SUFFIX = flag("suffix", "");
const BOT_SEAT = "hall-t03-c4";
const MY_SEAT = "hall-t04-c1";
const CHAT_SPOT = { x: 0, z: -2.6 };
const CHAT_LOOK = { x: 1.1, z: -7.5 };

const browser = await launchChrome("main");
const page = await browser.page();
const bot = await Bot.connect();
const T0 = Date.now();
const log = (m) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}] ${m}`);
const pending = [];
const report = {};

// ------------------------------------------------------------------ clip plumbing
async function clip(name) {
  const beats = [];
  report[name] = { beats };
  if (DRY) {
    const t0 = Date.now();
    mkdirSync(path.join(HERE, "dry"), { recursive: true });
    let n = 0;
    return {
      name,
      get elapsed() {
        return (Date.now() - t0) / 1000;
      },
      async beat(text, snap = true) {
        const t = +((Date.now() - t0) / 1000).toFixed(2);
        beats.push([t, text]);
        log(`${name} ${t.toFixed(2)}s  ${text}`);
        if (snap)
          await page
            .screenshot(path.join(HERE, "dry", `${name}-${String(++n).padStart(2, "0")}.png`))
            .catch(() => {});
      },
      async pause() {},
      async resume() {},
      async end() {
        report[name].seconds = this.elapsed;
      },
    };
  }
  const rec = await startRecording(page, name + SUFFIX);
  return {
    name,
    get elapsed() {
      return rec.elapsed;
    },
    async beat(text) {
      const t = +rec.elapsed.toFixed(2);
      beats.push([t, text]);
      log(`${name} ${t.toFixed(2)}s  ${text}`);
    },
    pause: () => rec.pause(),
    resume: () => rec.resume(),
    async end() {
      const info = await rec.stop({ encode: false });
      report[name].capture = info;
      pending.push({ name, info, out: rec.out });
    },
  };
}

async function holdUntil(c, t) {
  while (c.elapsed < t) await sleep(20);
}

function encodeAll() {
  for (const p of pending) {
    const res = execFileSync(
      ENCODER,
      ["encode", p.info.rawDir, p.out, "--fps", "30", "--bitrate", "16000000"],
      {
        encoding: "utf8",
        maxBuffer: 1 << 20,
      },
    );
    report[p.name].encoded = JSON.parse(res.trim().split("\n").pop());
    rmSync(p.info.rawDir, { recursive: true, force: true });
    report[p.name].probe = probe(p.out);
    report[p.name].file = p.out;
    log(`encoded ${p.out} ${JSON.stringify(report[p.name].probe)}`);
  }
}

// ------------------------------------------------------------------ shots
async function s00() {
  await app.resetVisitor(page);
  await app.openSite(page);
  await page.waitForText("Create your character", { timeout: 60000 });
  await sleep(3500); // pop-in animations settle, orbit running
  await page.placeMouse(1150, 900);
  const c = await clip("00-title");
  await c.beat(
    "title screen: orbit of the library, 'Cram Club', tagline, 'Create your character', 'No card yet'",
  );
  await sleep(5200);
  await c.beat("cursor starts gliding to 'Create your character'", false);
  await page.hover("Create your character");
  await c.beat("cursor resting on 'Create your character' (button highlighted)");
  await holdUntil(c, 9.0);
  await c.end();
}

async function s01() {
  const c = await clip("01-character");
  await c.beat("title, cursor on 'Create your character'", false);
  await sleep(350);
  await page.click("Create your character");
  await c.beat("click 'Create your character'");
  await page.waitForText("Character Studio", { timeout: 20000 });
  await page.waitFor(() => !document.body.innerText.includes("Loading the wardrobe"), {
    timeout: 30000,
  });
  await c.beat("Character Studio open (Step 1 of 2 · Your look), Presets panel");
  await sleep(1300);
  await page.click("Night Owl");
  await c.beat("preset 'Night Owl' (hoodie, headphones)");
  await sleep(1800);
  await page.click("Colorful");
  await c.beat("preset 'Colorful' (mint twists, lime tee)");
  await sleep(1800);
  await page.click("Studio Artist");
  await c.beat("preset 'Studio Artist' (space buns, cardigan)");
  await sleep(2000);
  await page.click({ text: "Wave", exact: true });
  await c.beat("Pose: Wave");
  await sleep(1100);
  await page.click({ text: "Smile", exact: true });
  await c.beat("Expression: Smile");
  await sleep(1900);
  await page.click({ text: "Hair", exact: true, within: 'nav[aria-label="Categories"]' });
  await c.beat("category Hair (camera frames the head)");
  await sleep(1600);
  await page.click("Lavender");
  await c.beat("hair colour Lavender");
  await sleep(2300);
  await page.click("Continue");
  await c.beat("click Continue");
  await page.waitForText("Sign your card");
  await c.beat("'Sign your card' (suggested name as placeholder, outfit summary)");
  await sleep(1700);
  await page.type("Alex", { delay: [120, 180] });
  await c.beat("typed name 'Alex'");
  await sleep(1000);
  await page.click("Enter the library");
  await c.beat("click 'Enter the library'");
  await sleep(250);
  await c.end();
}

async function s02() {
  const c = await clip("02-device-check");
  await page.waitForText("Before you go in");
  await c.beat("'Before you go in' device check pops in (camera panel left, microphone right)");
  await sleep(1900);
  await page.hover("The video is analysed on this computer");
  await c.beat(
    "cursor on camera privacy line 'The video is analysed on this computer and never leaves it.'",
  );
  await sleep(2300);
  await page.click("Keep it off");
  await c.beat("click 'Keep it off' (camera stays off)");
  await sleep(1300);
  await page.hover("Your voice is only sent while");
  await c.beat(
    "cursor on mic privacy line 'Your voice is only sent while you're talking to her...'",
  );
  await sleep(2000);
  await page.click("Test microphone");
  await c.beat("click 'Test microphone' (Listening, level meter moves)");
  await page.waitForText("Sounds good", { timeout: 12000 });
  await c.beat("'Sounds good'");
  await sleep(2800);
  await page.click("Play a test sound");
  await c.beat("click 'Play a test sound' (link becomes 'Play it again')");
  await sleep(1600);
  await page.click("Go in");
  await c.beat("click 'Go in'");
  await sleep(150);
  await c.end();
}

async function s03() {
  const c = await clip("03-walk-in");
  await c.beat("swoop into the Grand Reading Hall begins", false);
  await app.waitPlaying(page);
  await c.beat(
    "HUD up: 'Grand Reading Hall' zone chip, '2 here', Chat, WASD hints; 'Click to look around'",
  );
  await sleep(2000);
  await app.lockLook(page);
  await c.beat("click to look around (mouse captured)");
  await sleep(300);
  const botWalk = bot.sitAt(BOT_SEAT);
  await c.beat("other student (Guest) starts walking up the west side aisle", false);
  await sleep(1000);
  await app.goTo(page, 0, 1.8, { tol: 0.35 });
  await c.beat("walking up the centre aisle between the long tables");
  await page.turn(0.45, 0, { duration: 1100 });
  await c.beat("glance left toward the other student");
  await sleep(300);
  await app.goTo(page, CHAT_SPOT.x, CHAT_SPOT.z, { tol: 0.2 });
  await c.beat("reached the cross aisle near Ms. Fenwick's desk");
  const r = await botWalk;
  log(`bot sat: ${JSON.stringify(r)}`);
  await faceFrom(page, CHAT_LOOK.x, CHAT_LOOK.z, { pitch: -0.2, duration: 900 });
  await c.beat("framing: other student seated at Table 3 (left), Ms. Fenwick at her desk");
  await sleep(2600);
  await c.end();
}

async function s04() {
  const c = await clip("04-chat-fenwick");
  await c.beat(
    "standing in the aisle; other student seated at Table 3, Ms. Fenwick at her desk",
    false,
  );
  await sleep(1300);
  await page.press("Enter");
  await c.beat("Enter: library chat opens (bottom left)");
  await sleep(1300);
  const botSay = bot.say("anyone else cramming bio tonight?");
  await sleep(700);
  await c.beat("other student typing: dots over their head + 'Guest … is typing…' in chat");
  await botSay;
  await c.beat(
    "other student's line appears in chat + speech bubble: 'anyone else cramming bio tonight?'",
  );
  await sleep(2000);
  await c.beat("you start typing", false);
  await page.type("same! any tips for remembering the Krebs cycle?", { delay: [55, 125] });
  await sleep(450);
  await page.press("Enter");
  await c.beat(
    "your line sent: 'same! any tips for remembering the Krebs cycle?' (bubble over your head)",
  );
  const sent = Date.now();
  let typingSeen = false;
  while (Date.now() - sent < 40000) {
    const t = await page.text();
    if (!typingSeen && /Ms\. Fenwick is typing/i.test(t)) {
      typingSeen = true;
      await c.beat("'Ms. Fenwick is typing…' (dots over her)", false);
    }
    const lines = await app.chatLines(page);
    if (lines.some((l) => /Fenwick/.test(l))) {
      await c.beat(
        `Ms. Fenwick's reply in chat (to you) + bubble over her desk: ${lines.find((l) => /Fenwick/.test(l))}`,
      );
      break;
    }
    await sleep(80);
  }
  report["04-chat-fenwick"].waitedMs = Date.now() - sent;
  await sleep(4500);
  await c.beat("hold on the reply", false);
  await c.end();
}

async function s05() {
  // Not recorded: close the chat and capture the mouse again.
  await page.press("Escape");
  await sleep(600);
  await app.lockLook(page);
  await sleep(500);
  const c = await clip("05-table-hold");
  await c.beat("standing in the aisle (chat closed)", false);
  await sleep(700);
  await c.beat("walk to a free chair at Table 4 (across the aisle from the other student)", false);
  const r = await app.sitAt(page, MY_SEAT);
  log(`sat: ${JSON.stringify(r)}`);
  await c.beat(
    "E: seated; cream card 'You're the first here · Hold this table for 1 hour?' + Table timer card",
  );
  await sleep(2800);
  await page.keyDown("Shift");
  await c.beat("hold Shift: mouse free");
  await sleep(500);
  await page.click("Open to everyone");
  await c.beat(
    "click 'Open to everyone': table held (walnut 'Your table · Open · Table 4' panel top right, ~60:00)",
  );
  await sleep(700);
  await page.keyUp("Shift");
  await sleep(2300);
  await c.beat("hold on the timer card: '1 person is studying near you' + held-table panel");
  await sleep(1500);
  await page.press("p");
  await c.beat(
    "P: focus starts, first-person desk view, walnut LED desk clock 25:00 counting down",
  );
  await sleep(4500);
  await c.beat("hold on the desk clock", false);
  await c.end();
}

async function cleanupTable() {
  // Not recorded: leave the table (the pomodoro is abandoned) and give the table back.
  for (let i = 0; i < 6; i++) {
    const t = await page.text();
    await page.keyDown("Shift");
    await sleep(300);
    try {
      if (t.includes("Give it up and leave")) await page.click("Give it up and leave");
      else if (t.includes("Leave anyway")) await page.click("Leave anyway");
      else if (t.includes("Leave table")) await page.click({ text: "Leave table", role: "button" });
      else if (t.includes("Give up table")) await page.click("Give up table");
      else if (t.includes("Give it up")) await page.click({ text: "Give it up", exact: true });
      else break;
    } catch (e) {
      log("cleanup: " + e.message);
    }
    await sleep(500);
    await page.keyUp("Shift");
    await sleep(1200);
  }
  const t = await page.text();
  log(`after cleanup: seated=${await app.isSeated(page)} holding=${/Your table/.test(t)}`);
}

// ------------------------------------------------------------------ run
const run = { "00": s00, "01": s01, "02": s02, "03": s03, "04": s04, "05": s05 };
try {
  for (const s of STAGES) {
    log(`stage ${s}`);
    await run[s]();
  }
  if (STAGES.includes("05") && !argv.includes("--keep-table")) await cleanupTable();
} catch (e) {
  log("ERROR " + e.stack);
  // Stop any clip still recording so nothing is left half-open.
} finally {
  const logs = page.takeLogs().filter((l) => !l.includes("THREE.Clock"));
  if (logs.length) report._console = logs.slice(-20);
  if (!DRY) encodeAll();
  writeFileSync(
    path.join(HERE, `report${DRY ? "-dry" : ""}${SUFFIX}.json`),
    JSON.stringify(report, null, 1),
  );
  console.log(JSON.stringify(report, null, 1));
  bot.disconnect();
  browser.disconnect();
  process.exit(0);
}
