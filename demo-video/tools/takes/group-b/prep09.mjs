// Off-camera prep for 09: a lesson Ms. Fenwick builds (in-request) from a notes file, saved to the Learning Studio.
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import * as L from "./lib.mjs";
import { fileURLToPath } from "node:url";
const sleep = T.sleep;
const { browser, page } = await L.connect();
// The lecture notes Ms. Fenwick builds the lesson from live next to this script.
const NOTES = fileURLToPath(
  new URL("./notes/Bio lecture notes - electron transport chain.txt", import.meta.url),
);
const dlg = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')]
      .map((e) => e.innerText)
      .join("\n---\n")
      .replace(/\n+/g, " | "),
  );
let n = 0;
const snap = (tag) => page.screenshot(`${L.HERE}/p09-${String(++n).padStart(2, "0")}-${tag}.png`);
try {
  const step = process.argv[2] ?? "start";
  if (step === "start") {
    await page.scroll(-4000, { x: 960, y: 840, duration: 600 });
    await sleep(500);
    await page.click({ text: "New request", role: "button" });
    await sleep(2500);
    await snap("new");
    await page.upload('[role="dialog"] input[type="file"]', [NOTES]);
    await sleep(1500);
    await snap("attached");
    L.log((await dlg()).slice(0, 1500));
  } else if (step === "lesson") {
    await page.click({ text: "Interactive lesson" });
    await sleep(800);
    await snap("outcome");
    await page.click({ text: "Study these notes", role: "button" });
    L.log("sent notes");
    let last = "";
    const t0 = Date.now();
    while (Date.now() - t0 < 600000) {
      const t = (await dlg()).slice(0, 500);
      if (t !== last) {
        L.log(t);
        last = t;
        await snap("s");
      }
      if (/Play lesson/.test(await dlg())) {
        L.log("READY");
        break;
      }
      if (/Start quick research/.test(t)) {
        await sleep(1000);
        await page.click({ text: "Start quick research", role: "button" });
        L.log("confirmed");
      }
      await sleep(2000);
    }
  }
} catch (e) {
  console.error("ERR", e.stack);
  await snap("err").catch(() => {});
} finally {
  browser.disconnect();
}
