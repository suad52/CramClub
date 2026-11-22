// Group B: 08-librarian (Menu -> The Librarian, ask, quick research, answer with sources).
//   node rec08.mjs [--suffix -t2]
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import * as L from "./lib.mjs";
const sleep = T.sleep;
const argv = process.argv.slice(2);
const SUFFIX = argv.includes("--suffix") ? argv[argv.indexOf("--suffix") + 1] : "";
const { browser, page } = await L.connect();
const dlg = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')].map((e) => e.innerText).join("\n---\n"),
  );
/** Wheel distance that brings the first element whose own text starts with `text` to the top of the dialog's scroll box. */
const dyTo = (text, pad = 14) =>
  page.evaluate(
    ({ text, pad }) => {
      const d = document.querySelector('[role="dialog"]');
      const box = [...d.querySelectorAll("*")].find(
        (e) =>
          e.scrollHeight > e.clientHeight + 40 && /auto|scroll/.test(getComputedStyle(e).overflowY),
      );
      if (!box) return null;
      const el = [...box.querySelectorAll("h2,h3,h4,p,span,div,li")].find(
        (e) => e.childElementCount <= 3 && (e.innerText || "").trim().startsWith(text),
      );
      if (!el) return null;
      return Math.round(el.getBoundingClientRect().top - box.getBoundingClientRect().top - pad);
    },
    { text, pad },
  );
let result = null;
try {
  await page.placeMouse(1500, 620);
  if (!(await page.pointerLocked())) L.log("note: not locked at start");
  let c = await L.clip(page, "08-librarian" + SUFFIX);
  await c.beat("seated at Table 1, desk view (clock READY 01:00), demo ribbon + controls");
  await sleep(1500);
  await page.press("Escape");
  await page.waitForText("The Librarian", { timeout: 5000 });
  await c.beat("Esc: the menu slides in (Learning: The Librarian / Learning Studio / My progress)");
  await sleep(1400);
  await page.click("The Librarian");
  await c.beat("click 'The Librarian': camera cuts to Ms. Fenwick at her desk, dialogue box opens");
  await page.waitFor(
    () => /Tell me what you're studying|What are you working on/.test(document.body.innerText),
    { timeout: 10000 },
  );
  await sleep(3200);
  await c.beat(
    "her greeting typed out, 6 ways to start + message box with upload and push-to-talk mic buttons",
  );
  await sleep(800);
  await page.click({ text: "What are you working on?", role: "textbox" });
  await sleep(300);
  await page.type("Explain the electron transport chain");
  await c.beat("typed 'Explain the electron transport chain'");
  await sleep(700);
  await page.click({ text: "Send", role: "button" });
  await c.beat("click Send ('Reading your message…')");
  await page.waitFor(() => /Start quick research/.test(document.body.innerText), {
    timeout: 30000,
  });
  await c.beat(
    "her reply starts typing: 'I will research the electron transport chain … Shall I begin?' + Start quick research / Start deep research / Not now",
  );
  await sleep(3200);
  await page.hover({ text: "Start quick research", role: "button" });
  await sleep(700);
  await page.click({ text: "Start quick research", role: "button" });
  const tConfirm = Date.now();
  await c.beat("click 'Start quick research' (About a minute)");
  await page.waitFor(() => /Searched/.test(document.body.innerText), { timeout: 20000 });
  await c.beat(
    "research card: 'Ms. Fenwick is researching the web' — first 'Searched “…” · 10 results' step",
  );
  await page
    .waitFor(() => /Reading \d+ pages/.test(document.body.innerText), { timeout: 20000 })
    .catch(() => L.log("no Reading step yet"));
  await c.beat("'Reading N pages: openstax.org, …' step (credible sources first)");
  const steps = await page.evaluate(() =>
    (document.body.innerText.match(/(Searched [^\n]*|Reading \d+ pages[^\n]*)/g) || []).join(
      " || ",
    ),
  );
  L.log("steps: " + steps);
  while (Date.now() - tConfirm < 15500) await sleep(100);
  await c.beat("CUT (recording paused while she reads the pages)");
  await c.pause();
  // ---- not recorded: wait for the answer (the demo's 'Saved example' shows after 25 s of waiting and goes when the answer lands)
  await page.waitFor(
    () =>
      /Build a study plan|Create interactive lesson|Retry/.test(document.body.innerText) &&
      !/Ms\. Fenwick is still working/.test(document.body.innerText),
    { timeout: 240000 },
  );
  const waited = ((Date.now() - tConfirm) / 1000).toFixed(1);
  L.log(`answer after ${waited}s from confirm`);
  const txt = await dlg();
  if (/Saved example/.test(txt) || /Something went wrong|Retry/.test(txt))
    L.log("WARN dialog: " + txt.slice(0, 400));
  await sleep(150);
  await c.resume();
  await c.beat(
    `resume: research finished (${waited} s after Start in real time); her line types: 'I found N good sources (…). Want a study plan or an interactive lesson from them?' + Build a study plan / Create interactive lesson`,
  );
  await sleep(4200);
  const line = await page.evaluate(
    () => (document.body.innerText.match(/I found [^\n]*/) || [""])[0],
  );
  L.log("her line: " + line);
  // scroll through the answer
  let dy = await dyTo("What she found", 6);
  L.log("dy what she found " + dy);
  await page.scroll(dy ?? 300, { x: 960, y: 840, duration: 1500 });
  await c.beat("scroll: 'What she found' — topic title + her answer paragraph");
  await sleep(3600);
  dy = await dyTo("Key ideas", 10);
  await page.scroll(dy ?? 300, { x: 960, y: 840, duration: 1300 });
  await c.beat(
    "scroll: 'Key ideas' tags (Cellular respiration, Oxidative phosphorylation, Proton gradient, ATP synthase …)",
  );
  await sleep(2800);
  dy = await dyTo("Sources", 6);
  await page.scroll(dy ?? 400, { x: 960, y: 840, duration: 1500 });
  await c.beat(
    "scroll: 'Sources' with its count badge; first source card (type tag, site, level, title, summary, 'Why this helps', Open source / Save / Add to collection)",
  );
  await sleep(3800);
  await page.scroll(330, { x: 960, y: 840, duration: 1400 });
  await c.beat("scroll: next source cards");
  await sleep(2600);
  await page.hover({ text: "Talk to Ms. Fenwick" });
  await c.beat("cursor on the push-to-talk mic button beside Send (talk to her out loud)");
  await sleep(2600);
  result = await c.stop();
} catch (e) {
  console.error("ERR", e.stack);
  await page.screenshot(`${L.HERE}/err-08.png`).catch(() => {});
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
