// Group B: 09-whiteboard-lesson (L -> lesson picker -> board flips -> full screen -> quiz wrong, hint, right).
//   DEMO_SITE=https://cramclub.study node rec09.mjs [--suffix -t2] [--lesson-json file]
//
// Re-shoot (review pass 2): from Table 1's first seat (hall-t01-c1) the desk lamp's shade sat in
// front of the middle of the board. Off camera this now sits at the next seat along the same side
// (hall-t01-c2, 1.3 m nearer the board) in first person and looks at the board: the lamp is then
// off to the lower left of the board and the board is half as wide again in frame.
// The lesson must be in this browser's Learning Studio (localStorage). The site moved to
// cramclub.study (sslip.io now redirects there), so the lesson Ms. Fenwick built on the old origin
// (prep09.mjs) was copied across with --lesson-json (a dump of the old origin's localStorage).
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import * as L from "./lib.mjs";
const sleep = T.sleep;
const argv = process.argv.slice(2);
const SUFFIX = argv.includes("--suffix") ? argv[argv.indexOf("--suffix") + 1] : "";
const { browser, page } = await L.connect();
const WRONG = "It directly phosphorylates ADP into ATP.";
const RIGHT = "It acts as the final electron acceptor to form water.";
let result = null;
const LESSON_JSON = argv.includes("--lesson-json") ? argv[argv.indexOf("--lesson-json") + 1] : null;
const SEAT = "hall-t01-c2";
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
  // ---- off camera: the lesson, the seat, first person, facing the board
  if (LESSON_JSON) {
    const { readFileSync } = await import("node:fs");
    const dump = JSON.parse(readFileSync(LESSON_JSON, "utf8"));
    const have = await page.getStorage("ovr.learning-studio.lessons.v1");
    if (!have || !have.includes("The Electron Transport Chain")) {
      await page.setStorage({
        "ovr.learning-studio.lessons.v1": dump["ovr.learning-studio.lessons.v1"],
      });
      L.log("lesson copied into this origin's Learning Studio");
    }
  }
  await dismiss(["Not yet", "Not now", "Got it"]);
  if (!(await page.pointerLocked())) {
    await T.app.lockLook(page);
    await sleep(600);
  }
  const me = await page.player();
  const seat = T.app.seatById(SEAT);
  if (!me || Math.hypot(me.x - seat.x, me.z - seat.z) > 0.3) {
    const r = await T.app.sitAt(page, SEAT);
    L.log("sat: " + JSON.stringify(r));
    await sleep(1500);
    await dismiss(["Not now"]);
  }
  const prefs = JSON.parse((await page.getStorage("ovr.preferences")) ?? "{}");
  if (prefs.state?.cameraMode !== "first-person") {
    await page.press("v");
    await sleep(1200);
  }
  if (!(await page.pointerLocked())) {
    await T.app.lockLook(page);
    await sleep(600);
  }
  await T.app.lookAt(page, -9.1, -2.3, { y: 1.36, duration: 600 });
  await sleep(1200);
  await page.screenshot(`${L.HERE}/pre09.png`);
  if (!(await page.pointerLocked())) {
    await page.placeMouse(960, 640);
    await T.app.lockLook(page);
    await sleep(1500);
  }
  let c = await L.clip(page, "09-whiteboard-lesson" + SUFFIX);
  await c.beat(
    "seated at Table 1 (first person) looking at Table 1's rolling whiteboard; HUD prompt 'L Play a lesson'",
  );
  await sleep(1600);
  await page.press("l");
  await page.waitForText("Play a lesson on the board", { timeout: 5000 });
  await c.beat(
    "L: 'Play a lesson on the board' picker (Table 1's board): Your lessons = The Electron Transport Chain (Biology · 5 scenes) + Sample: Cellular respiration, Make a new lesson",
  );
  await sleep(1200);
  const row = await page.locate({
    selector: "[data-picker-item]",
    text: "The Electron Transport Chain",
  });
  await page.hover({ x: row.left + 220, y: row.y });
  await sleep(1200);
  await page.click({ x: row.left + row.w - 48, y: row.y });
  await c.beat("click Play on 'The Electron Transport Chain'");
  await page.waitForText("is playing a lesson", { timeout: 15000 });
  await c.beat(
    "the rolling board flips over to the lesson's title card ('Walk up and press J to join'); offer card 'Table 1's board is playing a lesson — Join (J) / Not now (N)'",
  );
  await sleep(3000);
  await page.press("j");
  await c.beat("press J: joined");
  await page.waitForText("Scene 1 of 5", { timeout: 15000 });
  await c.beat(
    "corner preview 'The Electron Transport Chain · Scene 1 of 5 · Table 1'; the lesson plays on the 3D board",
  );
  await sleep(6000);
  await c.beat(
    "lesson playing on the 3D board (scene 1 visual), status pill on the corner preview",
  );
  await sleep(1500);
  await page.press("f");
  await page.waitForText("Back to the library", { timeout: 6000 }).catch(async () => {
    L.log("F did not open full screen; using the button");
    await L.shiftClick(page, { text: "Full screen", role: "button" });
    await page.waitForText("Back to the library", { timeout: 6000 });
  });
  await c.beat(
    "F: full-screen lesson player (scene 1 'Introduction to the Electron Transport Chain', captions as she narrates, scene bar, Sources)",
  );
  await sleep(4500);
  await page.click({ text: "Scene 3:", role: "button" });
  await c.beat("click scene 3 in the scene bar: 'The Role of Oxygen and Cyanide Toxicity'");
  await sleep(4500);
  await c.beat("CUT (recording paused while scene 3's narration plays to the knowledge check)");
  await c.pause();
  const tw = Date.now();
  await page.waitFor((t) => document.body.innerText.includes(t), {
    args: [RIGHT],
    timeout: 120000,
    message: "quiz question",
  });
  L.log(`question after ${((Date.now() - tw) / 1000).toFixed(1)} s of narration (cut)`);
  await sleep(400);
  await c.resume();
  await c.beat(
    "resume: Knowledge check — 'What is the primary function of oxygen in the electron transport chain?' with the 'Double-checked by Ms. Fenwick' badge and 4 options",
  );
  await sleep(3000);
  await page.click({ text: WRONG, role: "button" });
  await c.beat(`pick the wrong answer B '${WRONG}'`);
  await page.waitForText("One more try", { timeout: 5000 });
  await c.beat(
    "'Not quite. One more try.' + 'Hint: Think about what happens at the very end of Complex IV.' + Show the answer",
  );
  await sleep(3800);
  await page.click({ text: RIGHT, role: "button" });
  await c.beat(`pick the right answer A '${RIGHT}'`);
  await page.waitForText("second try", { timeout: 5000 });
  await sleep(300);
  const quoteLabel = await page.evaluate(
    () => (document.body.innerText.match(/From (the sources|your notes):/) || [""])[0],
  );
  await c.beat(
    `'Got it on the second try.' + explanation + '${quoteLabel} “Oxygen is the final electron acceptor. At Complex IV it takes the electrons and combines with protons to form water.”' + Continue`,
  );
  await sleep(5200);
  await page.click({ text: "Continue", role: "button" });
  await c.beat("click Continue: on to scene 4 'Chemiosmosis and ATP Synthase'");
  await sleep(2600);
  await page.click({ text: "Back to the library", role: "button" });
  await c.beat(
    "click 'Back to the library': the player shrinks back to the corner preview; the lesson keeps playing on the board",
  );
  await sleep(3800);
  result = await c.stop();
} catch (e) {
  console.error("ERR", e.stack);
  await page.screenshot(`${L.HERE}/err-09.png`).catch(() => {});
} finally {
  if (result) {
    try {
      const enc = L.encode(result);
      L.log(`${result.name}: ${JSON.stringify(enc.probe)}`);
      L.saveReport(result.name, { beats: result.beats, capture: result.info, probe: enc.probe });
    } catch (e) {
      console.error("encode", e.message);
    }
  }
  browser.disconnect();
}
