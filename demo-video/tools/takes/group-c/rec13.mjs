// 13-proof: /proof, readings loaded, slow scroll through every card.
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import * as L from "./lib.mjs";
const sleep = T.sleep;
const SUFFIX = process.argv.includes("--suffix")
  ? process.argv[process.argv.indexOf("--suffix") + 1]
  : "";
const { browser, page } = await L.connect();
const results = [];
async function scrollToY(y, ms) {
  const cur = await page.evaluate("scrollY");
  const max = await page.evaluate("document.scrollingElement.scrollHeight - innerHeight");
  const d = Math.min(y, max) - cur;
  await page.scroll(d, { duration: ms ?? Math.max(1300, Math.abs(d) * 2.6) });
  await sleep(350);
}
async function headY(text) {
  return page.evaluate((t) => {
    const h = [...document.querySelectorAll("h1,h2,h3")].find((e) => e.innerText.startsWith(t));
    return h ? Math.round(h.getBoundingClientRect().top + scrollY) : null;
  }, text);
}
try {
  await page.goto(T.SITE + "/proof");
  await page.waitForText("Passed: the replayed ticket was refused", { timeout: 60000 });
  await page.waitForText("No drift", { timeout: 30000 });
  await sleep(1500);
  await page.evaluate("window.scrollTo(0,0)");
  await page.placeMouse(1640, 700);
  await sleep(800);
  const c = await L.clip(page, "13-proof" + SUFFIX);
  await c.beat(
    "/proof loaded: 'How Cram Club works', 'For the judges', every number read live (Vultr · Tiger Data · Auth0 · ElevenLabs · Gemini · TinyFish chips, 'Read at … · Read again')",
  );
  await sleep(3000);
  await scrollToY((await headY("One Vultr server")) - 110);
  await c.beat(
    "Vultr card: one Vultr server runs the whole library: Caddy (HTTPS), Next.js web app, Colyseus game server ('Answering, up to 15 a room'), Worker, each with a live green check",
  );
  await page.moveTo(1080, 880 - 460 + 110, { duration: 700 }).catch(() => {});
  await sleep(2600);
  await scrollToY((await headY("Lesson queue")) - 110);
  await c.beat(
    "Lesson queue (a Postgres table, FOR UPDATE SKIP LOCKED) + last finished lesson job with its checkpoints (8 TinyFish sources, lesson stored, narration 3 of 3)",
  );
  await sleep(2600);
  await scrollToY((await headY("Object storage")) - 110);
  await c.beat(
    "Object storage: private Vultr bucket, live ping; a signed URL made just now (AWS4-HMAC-SHA256, 60 s)",
  );
  await sleep(900);
  try {
    await page.hover("206 Partial Content");
  } catch {}
  await c.beat("cursor on 'With the signature: 206 Partial Content'");
  await sleep(1200);
  try {
    await page.hover("403 Forbidden");
  } catch {}
  await c.beat("cursor on 'Without it: 403 Forbidden (the bucket is private)'");
  await sleep(1800);
  await scrollToY((await headY("The study record is a TimescaleDB")) - 110);
  await c.beat(
    "Tiger Data: the study record is a TimescaleDB time series: learning_events hypertable (chunks, columnstore), events in the last 24 hours",
  );
  await sleep(2800);
  await scrollToY((await headY("Continuous aggregates")) - 60);
  await c.beat(
    "Continuous aggregates: focus_presence_daily / _weekly (hierarchical) / learning_daily, real-time, refresh runs with 0 failures",
  );
  await sleep(2600);
  await scrollToY((await headY("Integrity check")) - 110);
  await c.beat("Integrity check: aggregates recomputed from raw rows");
  await sleep(500);
  try {
    await page.hover({ text: "No drift", exact: true });
  } catch {}
  await c.beat(
    "cursor on 'No drift'; three comparisons all 'Equal' (events vs learning_daily, pomodoros vs focus_presence_daily, XP ledger vs learning_events)",
  );
  await sleep(2600);
  await scrollToY((await headY("Verified focus, per week")) - 110);
  await c.beat("Verified focus, per week");
  await sleep(2400);
  await scrollToY((await headY("Rules the database enforces")) - 110);
  await c.beat(
    "Rules the database enforces itself: unique / check / exclusion constraints (each reward paid once, one running pomodoro, no overlapping table holds, email kept only as an HMAC)",
  );
  await sleep(3000);
  await scrollToY(99999);
  await c.beat(
    "bottom: Auth0 (checked on every request and on the live connection; 'You, right now: Not signed in', 'Auth0 on this copy: Configured') + live test: replay a join ticket",
  );
  await sleep(1200);
  try {
    await page.hover("Accepted");
  } catch {}
  await c.beat("cursor on step 2: '1st use at the game server: Accepted'");
  await sleep(1300);
  try {
    await page.hover("Refused (replayed)");
  } catch {}
  await c.beat(
    "cursor on step 3: '2nd use of the same ticket: Refused (replayed)' — 'Passed: the replayed ticket was refused.'",
  );
  await sleep(2200);
  await page.moveTo(1180, 860, { duration: 900 });
  await c.beat(
    "services card: ElevenLabs, Gemini and TinyFish, with what the server has on record",
  );
  await sleep(2800);
  results.push(await c.stop());
} catch (e) {
  console.error("ERR", e.stack);
  await page.screenshot(`${L.HERE}/err-13.png`).catch(() => {});
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
