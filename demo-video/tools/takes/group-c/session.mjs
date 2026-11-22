// 10-studio-book, 11-showed-up, 12-progress in ONE process (the pomodoro needs the tab kept focused).
//   node session.mjs [--only 10,11,12] [--suffix -t2]
//
// Review pass 2 re-shot 10 and 11 in group B's demo Chrome, right after 09:
//   TAKE_CHROME=demo DEMO_SITE=https://cramclub.study node session.mjs --only 10,11
// - Off camera first: leave 09's board lesson (it waits on Table 1's board), walk to Table 6
//   (hall-t06-c2; Theo follows), third person, demo controls folded away.
// - 10: 'Your lessons' now lists 09's lesson (The Electron Transport Chain, with its place) above
//   the sample, so the line about saved lessons matches the screen.
// - 11: the demo controls stay folded during the desk view (and the view tilts up a touch), so
//   Theo's face is never behind them; they open only for 'Start pomodoro' and 'Finish now'.
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import * as L from "./lib.mjs";
const sleep = T.sleep;
const argv = process.argv.slice(2);
const SUFFIX = argv.includes("--suffix") ? argv[argv.indexOf("--suffix") + 1] : "";
const ONLY = argv.includes("--only")
  ? argv[argv.indexOf("--only") + 1].split(",")
  : ["10", "11", "12"];
const { browser, page } = await L.connect();
const results = [];
const shot = (n) => page.screenshot(`${L.HERE}/s-${n}.png`).catch(() => {});

/** Centre of the first visible element matching a test (run in the page). */
async function at(fnSrc, arg) {
  return page.waitFor(
    new Function(
      "arg",
      `const els = [...document.querySelectorAll("button,[role=button],a,[role=tab]")].filter(e => { const r = e.getBoundingClientRect(); return r.width > 2 && r.height > 2 && getComputedStyle(e).visibility !== "hidden"; });
      const test = ${fnSrc};
      const el = els.find(e => test((e.innerText || "").replace(/\\s+/g, " ").trim(), e, arg));
      if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };`,
    ),
    { timeout: 10000, args: [arg], message: "element " + fnSrc },
  );
}

/** Back to a clean seated view: no menu, book, progress or cards; mouse captured. */
async function clean() {
  for (let i = 0; i < 4; i++) {
    if (await page.exists({ text: "Back to the library (close my progress)" })) {
      await page.click({ text: "Back to the library (close my progress)" });
      await sleep(900);
      continue;
    }
    if (await page.exists({ text: "Close the book" })) {
      await page.click("Close the book");
      await sleep(900);
      continue;
    }
    if (await page.exists({ text: "Resume", role: "button" })) {
      await page.click({ text: "Resume", role: "button" });
      await sleep(900);
      continue;
    }
    if (await page.exists({ text: "Not now", role: "button" })) {
      await L.shiftClick(page, { text: "Not now", role: "button" });
      await sleep(900);
      continue;
    }
    if (await page.exists({ text: "Not yet", exact: true, role: "button" })) {
      await L.shiftClick(page, { text: "Not yet", exact: true, role: "button" });
      await sleep(900);
      continue;
    }
    break;
  }
  if (!(await page.pointerLocked())) {
    try {
      await T.app.lockLook(page);
    } catch (e) {
      console.log("lockLook", e.message);
    }
  }
  await sleep(800);
}

/** Smoothly scrolls an inner scroller (the element under the mouse) by dy, waits a beat. */
async function wheel(dy, ms) {
  await page.scroll(dy, { duration: ms ?? Math.max(1200, Math.abs(dy) * 3) });
  await sleep(300);
}
async function scrollerState() {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find((e) => {
      const s = getComputedStyle(e);
      return (
        /(auto|scroll)/.test(s.overflowY) &&
        e.scrollHeight > e.clientHeight + 10 &&
        e.getBoundingClientRect().width > 600
      );
    });
    return el
      ? { top: Math.round(el.scrollTop), max: el.scrollHeight - el.clientHeight }
      : { top: 0, max: 0 };
  });
}

const SEAT = "hall-t06-c2";
/** Opens or folds the demo controls (Shift must already be held). */
async function controls(open, fast = false) {
  const isOpen = await page.evaluate(
    () =>
      document.querySelector('[aria-controls="demo-controls"]')?.getAttribute("aria-expanded") ===
      "true",
  );
  if (isOpen === open) return;
  await page.click(
    { text: "Controls", role: "button" },
    fast ? { duration: 200, pause: 30, after: 60 } : {},
  );
  if (!fast) await sleep(250);
}
try {
  await L.silenceTTS(page);
  if (process.env.TAKE_CHROME === "demo") {
    // ---- off camera: a fresh /demo entry (as the c Chrome had: today's count 0, pomodoro 1 of 2;
    // 07 rang one in this browser), then Table 6, third person, controls folded
    const pomo = JSON.parse((await page.getStorage("ovr.pomodoro")) ?? "null");
    if (pomo?.state?.today) {
      pomo.state.today.count = 0;
      await page.setStorage({ "ovr.pomodoro": pomo });
    }
    const prefs0 = JSON.parse((await page.getStorage("ovr.preferences")) ?? "{}");
    if (prefs0.state) {
      prefs0.state.cameraMode = "third-person";
      await page.setStorage({ "ovr.preferences": prefs0 });
    }
    await page.goto(T.SITE + "/demo");
    await page.waitForText("Before you go in", { timeout: 60000 });
    await page.locate({ text: "Go in", role: "button" }, { timeout: 30000 });
    await sleep(2500);
    await L.silenceTTS(page);
    await page.click({ text: "Go in", role: "button" });
    await page
      .waitForText("You're the first here", { timeout: 25000 })
      .catch(() => L.log("no hold card"));
    await sleep(1500);
    if (await page.exists({ text: "Not now", role: "button" }))
      await page.click({ text: "Not now", role: "button" });
    await sleep(1200);
    await clean();
    const me = await page.player();
    const seat = T.app.seatById(SEAT);
    if (!me || Math.hypot(me.x - seat.x, me.z - seat.z) > 0.3) {
      const r = await T.app.sitAt(page, SEAT);
      L.log("sat: " + JSON.stringify(r));
      await sleep(1500);
    }
    await clean();
    const prefs = JSON.parse((await page.getStorage("ovr.preferences")) ?? "{}");
    if (prefs.state?.cameraMode !== "third-person") {
      await page.press("v");
      await sleep(1200);
    }
    await page.keyDown("Shift");
    await sleep(350);
    await controls(false);
    await page.keyUp("Shift");
    await sleep(600);
    // Face across the table, Theo in view (as the c Chrome's original 10 opened).
    await T.app.lookAt(page, 9.72, -4.6, { duration: 600 });
    await sleep(1200);
  }
  await clean();
  await shot("start");

  // ------------------------------------------------------------------ 10
  if (ONLY.includes("10")) {
    // The book remembers its page: leave it on "Your lessons" so the first flip is visible.
    const c = await L.clip(page, "10-studio-book" + SUFFIX);
    await c.beat(
      "seated at Table 6 in /demo (third person), Theo (demo) across the table, table timer card on the left",
    );
    await sleep(1600);
    await page.press("Escape");
    await c.beat(
      "Esc: the menu slides in (Learning: The Librarian / Learning Studio / My progress)",
    );
    await sleep(1400);
    await page.hover("Learning Studio");
    await sleep(900);
    await page.click("Learning Studio");
    await c.beat("click 'Learning Studio' ('Opens a book')");
    await page.waitForText("Close the book", { timeout: 8000 });
    await sleep(400);
    await c.beat(
      "the book opens over the library: left page 'Turn your notes into a lesson' with the CONTENTS (1 New lesson, 2 Your lessons); ribbon tabs on the book's edge",
    );
    await sleep(1200);
    const contentsNew = await at(`(t) => /^New lesson ?1/.test(t)`);
    await page.hover(contentsNew, { dx: -40 });
    await c.beat("cursor on the contents page");
    await sleep(1400);
    await page.click(contentsNew, { dx: -40 });
    await c.beat("click 'New lesson' in the contents: the page flips");
    await sleep(900);
    await c.beat(
      "New lesson page: 'Choose a PDF of your notes' (up to 15 MB), title, Length (Short 3–4 scenes), Level (High school), privacy note, Create lesson",
    );
    await sleep(600);
    await page.hover("Choose a PDF of your notes");
    await c.beat("cursor on 'Choose a PDF of your notes'");
    await sleep(2200);
    await page.hover({ text: "Create lesson", role: "button" });
    await sleep(1200);
    const contentsLessons = await at(`(t) => /^Your lessons ?2/.test(t)`);
    await page.click(contentsLessons, { dx: -40 });
    await c.beat("click 'Your lessons' in the contents: the page flips");
    await sleep(900);
    const yl = await page.evaluate(() => {
      const t = document.body.innerText;
      const i = t.indexOf("Saved in this browser");
      return i < 0 ? "" : t.slice(i, i + 260).replace(/\n+/g, " | ");
    });
    await c.beat(`Your lessons: ${yl}`);
    await sleep(1800);
    await page.click({ text: "Try it", role: "button" });
    await c.beat("click 'Try it' on the sample lesson");
    await page.waitForText("Back to the book", { timeout: 8000 });
    await sleep(300);
    await c.beat(
      "the sample lesson fills the whole spread: 'Cellular respiration · Scene 1 of 6', Sources / Transcript / Ask Ms. Fenwick, 'Start the lesson'",
    );
    await sleep(2000);
    await page.click("Start the lesson");
    await c.beat("click 'Start the lesson'");
    await page.moveTo(1240, 620, { duration: 800 });
    await c.beat(
      "the lesson plays: the diagram builds (Glucose in → Cellular respiration → Oxygen in → ATP out), captions under it, 6-scene progress bar",
    );
    await sleep(7500);
    await page.click("Back to the book");
    await c.beat("click 'Back to the book': back on Your lessons");
    await sleep(2000);
    await page.click("Close the book");
    await c.beat("click 'Close the book': the book closes, the menu is back");
    await sleep(1300);
    await page.click({ text: "Resume", role: "button" });
    await c.beat("click 'Resume': back to the library");
    await sleep(1500);
    results.push(await c.stop());
    await clean();
  }

  // ------------------------------------------------------------------ 11
  if (ONLY.includes("11")) {
    // Off camera: the demo controls open (they were folded for 10), facing Theo.
    await page.keyDown("Shift");
    await sleep(350);
    await controls(true);
    await page.keyUp("Shift");
    await L.waitLocked(page, 3000);
    await sleep(800);
    const c = await L.clip(page, "11-showed-up" + SUFFIX);
    await c.beat(
      "seated at Table 6 with Theo (demo); table timer 1:00, demo controls under the ribbon",
    );
    await sleep(1500);
    await page.keyDown("Shift");
    await c.beat("hold Shift: cursor back");
    await sleep(450);
    await page.click("Start pomodoro");
    await c.beat("click 'Start pomodoro' (demo: a 1-minute pomodoro)");
    // Fold straight away: the view drops to the desk ~0.3 s after the click (Theo's head).
    await controls(false, true);
    await c.beat("click 'Controls': the demo controls fold away");
    await page.keyUp("Shift");
    await page.waitForText("Focus time", { timeout: 8000 }).catch(() => {});
    await sleep(400);
    await page.turn(0, 0.12, { duration: 700 });
    await c.beat(
      "focus desk view (first person), tilted up a touch: Theo's face across the table; the walnut LED desk clock counts down from 1:00",
    );
    await sleep(3000);
    await c.pause();
    L.log("paused: waiting for the last seconds");
    // Resume ~3 s before the real finish unlocks.
    const t0 = Date.now();
    while (Date.now() - t0 < 75000) {
      // Seconds until 'Finish now' unlocks: from the demo key's hint, or (controls folded) the timer card.
      const s = await page.evaluate(() => {
        const t = document.body.innerText;
        const m = t.match(/counts for real in (\d+) s/);
        if (m) return +m[1];
        const f = t.match(/Focus time\s*\n+\s*(\d+):(\d\d)/);
        return f ? +f[1] * 60 + +f[2] - 10 : t.includes("Finish now") ? 0 : null;
      });
      if (s != null && s <= 4) break;
      await sleep(200);
    }
    await c.resume();
    await c.beat("CUT (recording paused ~45 s while the pomodoro ran): the clock is near 0:14");
    await sleep(500);
    await page.keyDown("Shift");
    await sleep(400);
    await controls(true);
    await c.beat("Shift held: click 'Controls' (the demo controls open again)");
    await page.hover("Finish (preview)").catch(() => {});
    await c.beat("cursor on the demo key 'Finish (preview)'");
    await page.waitForText("Finish now", { timeout: 15000 });
    await c.beat("at 10 s left the key turns into 'Finish now' (it now counts for real)");
    await sleep(1400);
    await page.click("Finish now");
    await c.beat("click 'Finish now'");
    await page.waitForText("You showed up", { timeout: 15000 });
    await sleep(300);
    await controls(false);
    await c.beat("click 'Controls': folded away again");
    await sleep(300);
    const card = await page.evaluate(() => {
      const t = document.body.innerText;
      const i = t.indexOf("You showed up");
      return t.slice(i, i + 400).replace(/\n+/g, " | ");
    });
    await c.beat(`'You showed up' card: ${card.slice(0, 260)}`);
    await sleep(1200);
    await page.hover({ text: "XP earned" }).catch(() => {});
    await c.beat("cursor on '+10 XP earned'");
    await sleep(2000);
    await page.hover({ text: "alongside" }).catch(() => {});
    await c.beat("cursor on 'You studied alongside …'");
    await sleep(2600);
    await page.keyUp("Shift");
    results.push(await c.stop());
    await shot("after11");
    L.log("card: " + card);
    // Not recorded: through the break.
    try {
      await L.shiftClick(page, { text: "Enjoy the break", role: "button" });
    } catch (e) {
      L.log("no Enjoy the break " + e.message);
    }
    await page
      .waitForText("Break's over", { timeout: 40000 })
      .catch(() => L.log("no Break's over"));
    await sleep(800);
    await shot("break");
    if (await page.exists({ text: "Not now", role: "button" }))
      await L.shiftClick(page, { text: "Not now", role: "button" });
    await sleep(1000);
    await clean();
  }

  // ------------------------------------------------------------------ 12
  if (ONLY.includes("12")) {
    const c = await L.clip(page, "12-progress" + SUFFIX);
    await c.beat("seated at Table 6, library view");
    await sleep(1400);
    await page.press("Escape");
    await c.beat("Esc: the menu");
    await sleep(1300);
    await page.click("My progress");
    await c.beat("click 'My progress'");
    await page.waitForText("How XP works", { timeout: 15000 }).catch(() => {});
    await sleep(800);
    const ov = await page.evaluate(() => {
      const el =
        document
          .querySelector('[aria-label="My progress sections"]')
          ?.closest("section,div[role=dialog]") ?? document.body;
      return el.innerText.slice(0, 700).replace(/\n+/g, " | ");
    });
    await c.beat(`My progress opens on Overview: ${ov.slice(0, 240)}`);
    await sleep(1500);
    try {
      await page.hover({ text: "XP this week" }, { dy: 30 });
      await c.beat("cursor on the 'XP this week: 10' tile");
      await sleep(1600);
    } catch {}
    try {
      await page.hover({ text: "Current streak" }, { dy: 30 });
      await c.beat("cursor on the 'Current streak: 1 day' tile (Longest 1 day)");
      await sleep(2000);
    } catch {}
    await page.moveTo(1250, 640, { duration: 700 });
    let st = await scrollerState();
    let n = 0;
    while (st.top < st.max - 4 && n++ < 8) {
      await wheel(Math.min(380, st.max - st.top));
      st = await scrollerState();
      await c.beat(`Overview scrolled to ${st.top}/${st.max}`);
      await sleep(1700);
    }
    try {
      await page.hover({ text: "a rest day" });
      await c.beat("cursor on 'Streaks forgive one missed day in any 7: a rest day'");
      await sleep(2000);
    } catch {}
    for (const tab of ["Leaderboard", "Community"]) {
      await page.click({ text: tab, exact: true });
      await c.beat(`click the '${tab}' tab`);
      await sleep(2200);
      const txt = await page.evaluate(() => {
        const el = [...document.querySelectorAll("*")].find((e) => {
          const s = getComputedStyle(e);
          return /(auto|scroll)/.test(s.overflowY) && e.getBoundingClientRect().width > 600;
        });
        return (el?.innerText ?? "").slice(0, 300).replace(/\n+/g, " | ");
      });
      await c.beat(`${tab}: ${txt.slice(0, 220)}`);
      await page.moveTo(1250, 660, { duration: 600 });
      await sleep(1200);
      st = await scrollerState();
      n = 0;
      while (st.top < st.max - 4 && n++ < 10) {
        await wheel(Math.min(380, st.max - st.top));
        st = await scrollerState();
        await c.beat(`${tab} scrolled to ${st.top}/${st.max}`);
        await sleep(1800);
      }
    }
    await page.click({ text: "Back to the library (close my progress)" });
    await c.beat("click 'Back to the library': progress closes");
    await sleep(1500);
    results.push(await c.stop());
  }
} catch (e) {
  console.error("ERR", e.stack);
  await shot("err");
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
