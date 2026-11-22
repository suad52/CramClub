// Group B: 06-demo-entry + 07-shush in ONE process (the tab must stay "focused" for the pomodoro).
//   DEMO_SITE=https://cramclub.study node rec0607.mjs [--suffix -r2]
//
// Re-shoot (review pass 2):
// - 06: after 'Start pomodoro' the demo Controls panel is folded away (its 'Controls ^' toggle on
//   the ribbon, Shift held) and the desk view tilts up ~6 degrees, so Theo's head is never behind
//   the panel.
// - 07: off camera you leave Table 1 (Leave table -> Leave anyway: the 06 pomodoro ends, no XP),
//   sit at Table 3's north-west seat (hall-t03-c1, ~3.3 m from Ms. Fenwick's desk; Theo follows
//   and sits across), and start a fresh 1-minute pomodoro with P. On camera: the desk view, a
//   look over to her desk, Shift -> Controls -> Shush me -> Controls, her caption next to her,
//   then back to the desk.
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import * as L from "./lib.mjs";
const sleep = T.sleep;
const argv = process.argv.slice(2);
const SUFFIX = argv.includes("--suffix") ? argv[argv.indexOf("--suffix") + 1] : "";
const { browser, page } = await L.connect();
const results = [];
const text = async () => (await page.text()).replace(/\n+/g, " | ");
/** Shift-clicks the first of these buttons that is on screen (off camera). */
async function dismiss(labels) {
  for (const t of labels) {
    if (await page.exists({ text: t, role: "button" })) {
      await L.shiftClick(page, { text: t, role: "button" });
      await sleep(700);
      return t;
    }
  }
  return null;
}
try {
  // Arrive in third person (my rehearsal toggled first person).
  const prefs = JSON.parse((await page.getStorage("ovr.preferences")) ?? "{}");
  if (prefs.state) {
    prefs.state.cameraMode = "third-person";
    await page.setStorage({ "ovr.preferences": prefs });
  }
  // Today's pomodoro count starts at 0, as on a first visit (rehearsals rang some): 06/07 read
  // "0 done today" and 07's pomodoro rings to "1 done today", which is where 08 picks up.
  const pomo = JSON.parse((await page.getStorage("ovr.pomodoro")) ?? "null");
  if (pomo?.state?.today) {
    pomo.state.today.count = 0;
    await page.setStorage({ "ovr.pomodoro": pomo });
  }
  await page.goto(T.SITE + "/demo");
  await page.waitForText("Before you go in", { timeout: 60000 });
  await page.locate({ text: "Go in", role: "button" }, { timeout: 30000 });
  await sleep(3000);
  await L.silenceTTS(page);
  await page.placeMouse(1180, 700);
  await sleep(300);
  L.log("on device check: " + (await page.url()));

  // ---------------------------------------------------------------- 06
  let c = await L.clip(page, "06-demo-entry" + SUFFIX);
  await c.beat(
    "/demo opened: 'Before you go in' camera + mic check, 'Demo mode' ribbon top centre (Sign in, Exit demo); camera off",
  );
  await sleep(1800);
  await page.hover({ text: "Demo mode", exact: true });
  await c.beat("cursor rests on the 'Demo mode' ribbon");
  await sleep(1600);
  await page.click({ text: "Go in", role: "button" });
  await c.beat("click 'Go in'");
  await page.waitForText("You're the first here", { timeout: 25000 });
  await c.beat(
    "already seated at Table 1 (third person, over the shoulder); demo controls open under the ribbon; 'You're the first here' hold card",
  );
  await sleep(2600);
  await page.click({ text: "Not now", role: "button" });
  await c.beat("click 'Not now' on the hold card (the mouse is captured: cursor hides)");
  const locked = await L.waitLocked(page, 3000);
  await sleep(500);
  if (locked) {
    await page.turn(0.3, 0.1, { duration: 1500 });
    await c.beat("camera eases left: Theo (demo) seated across the table, name tag 'Theo (demo)'");
  } else L.log("WARN not locked after Not now");
  await sleep(2300);
  await page.keyDown("Shift");
  await c.beat("hold Shift: cursor back");
  await sleep(500);
  // Locate the fold toggle first, so it can be clicked the moment the pomodoro starts: the view
  // drops to the desk ~0.3 s after the click, and the open controls would sit over Theo's head.
  const fold = await page.locate({ text: "Controls", role: "button" });
  await page.click("Start pomodoro");
  await c.beat("click 'Start pomodoro' (demo control: 1-minute pomodoro)");
  await page.click(fold, { duration: 200, pause: 30, after: 60 });
  await c.beat("click 'Controls' on the ribbon: the demo controls fold away");
  await sleep(250);
  await page.keyUp("Shift");
  await page.waitForText("Focus time", { timeout: 8000 });
  await sleep(500);
  await page.turn(0, 0.1, { duration: 700 });
  await c.beat(
    "focus desk view (first person), tilted up a touch: Theo's whole face across the table, walnut LED desk clock counting down from 1:00, timer card 'Focus · pomodoro 1 of 2'",
  );
  await sleep(3400);
  results.push(await c.stop());

  // ---------------------------------------------------------------- between (not recorded): Table 1 -> Table 3
  await L.shiftClick(page, { text: "Leave table", role: "button" });
  await sleep(900);
  await page.click({ text: "Leave anyway", role: "button" });
  await sleep(1500);
  await dismiss(["Got it", "Not now"]);
  if (!(await page.pointerLocked())) {
    await T.app.lockLook(page);
    await sleep(600);
  }
  const sat = await T.app.sitAt(page, "hall-t03-c1");
  L.log("sat at Table 3: " + JSON.stringify(sat));
  await sleep(1800);
  await dismiss(["Not now"]);
  if (!(await page.pointerLocked())) {
    await T.app.lockLook(page);
    await sleep(600);
  }
  await sleep(800);
  await page.press("p");
  await page.waitForText("Focus time", { timeout: 8000 });
  await sleep(800);
  await page.turn(0, 0.1, { duration: 500 });
  await sleep(1600);
  await page.screenshot(`${L.HERE}/pre07.png`);
  L.log("pre-07: " + (await text()).slice(0, 400));

  // ---------------------------------------------------------------- 07
  const desk = await page.pose();
  c = await L.clip(page, "07-shush" + SUFFIX);
  await c.beat(
    "mid-pomodoro desk view at Table 3: Theo across, the desk clock ~0:57, the LIBRARIAN sign top left",
  );
  await sleep(1300);
  // Aim at her desk, then a touch right and up: she sits left of centre, clear of the demo
  // controls (x 730-1190) while they're open, level with her caption card; Theo on the right.
  await T.app.lookAt(page, 0, -7.45, { duration: 1100 });
  await page.turn(-0.09, 0.15, { duration: 400 });
  await c.beat(
    "you look away, over to Ms. Fenwick at her desk (left of frame, ~3 m away), Theo on the right",
  );
  await sleep(500);
  await page.keyDown("Shift");
  await sleep(350);
  await page.click({ text: "Controls", role: "button" });
  await c.beat("Shift held: click 'Controls' (the demo controls fold open)");
  await sleep(250);
  await page.click("Shush me");
  await c.beat("click 'Shush me'");
  await sleep(250);
  await page.click({ text: "Controls", role: "button" });
  await c.beat("click 'Controls' again: folded away");
  await sleep(200);
  await page.keyUp("Shift");
  await page.waitForText("Ms. Fenwick", { timeout: 5000 });
  const cap = await page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/Ms\. Fenwick\s*\n\s*([“"][^”"]*[”"])/);
    return m ? m[1] : "";
  });
  await c.beat(`caption card under the timer, right beside her: 'Ms. Fenwick ${cap}'`);
  await L.waitLocked(page, 3000);
  await sleep(4600);
  await page.turn(desk.yaw - (await page.pose()).yaw, desk.pitch - (await page.pose()).pitch, {
    duration: 1400,
  });
  await c.beat("back to the desk: clock still running, Theo across");
  await sleep(2200);
  results.push(await c.stop());

  // ---------------------------------------------------------------- after: let the pomodoro ring (not recorded)
  L.log("waiting for the pomodoro to ring (tab stays focused while connected)");
  await page.waitForText("You showed up", { timeout: 70000 });
  await sleep(1500);
  await page.screenshot(`${L.HERE}/after-showedup.png`);
  L.log(
    "rang: " +
      (await page.evaluate(() => {
        const t = document.body.innerText;
        const i = t.indexOf("You showed up");
        return t.slice(i - 40, i + 400).replace(/\n+/g, " | ");
      })),
  );
  await L.shiftClick(page, { text: "Enjoy the break", role: "button" });
  await page.waitForText("Break's over", { timeout: 40000 });
  await sleep(800);
  await page.screenshot(`${L.HERE}/after-break.png`);
  await dismiss(["Not yet", "Not now"]);
  await sleep(1000);
  await page.screenshot(`${L.HERE}/after-idle.png`);
  L.log("idle again");
} catch (e) {
  console.error("ERR", e.stack);
  await page.screenshot(`${L.HERE}/err-0607.png`).catch(() => {});
} finally {
  for (const r of results) {
    try {
      const enc = L.encode(r);
      L.log(`${r.name}: ${JSON.stringify(enc.probe)}`);
      L.saveReport(r.name, { beats: r.beats, capture: r.info, probe: enc.probe });
    } catch (e) {
      console.error("encode", r.name, e.message);
    }
  }
  browser.disconnect();
}
