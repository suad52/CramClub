// Into /demo: device check (camera off) -> Go in -> Not now on the hold card. Leaves it seated.
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import * as L from "./lib.mjs";
const sleep = T.sleep;
const { browser, page } = await L.connect();
try {
  await page.goto(T.SITE + "/demo");
  await page.waitForText("Before you go in", { timeout: 60000 });
  await page.locate({ text: "Go in", role: "button" }, { timeout: 30000 });
  await sleep(2500);
  await L.silenceTTS(page);
  await page.screenshot(`${L.HERE}/p-device.png`);
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 1500)));
  await page.click({ text: "Go in", role: "button" });
  await page
    .waitForText("You're the first here", { timeout: 25000 })
    .catch((e) => console.log("no hold card", e.message));
  await sleep(2000);
  await page.screenshot(`${L.HERE}/p-in.png`);
  if (await page.exists({ text: "Not now", role: "button" }))
    await page.click({ text: "Not now", role: "button" });
  await sleep(1500);
  await page.screenshot(`${L.HERE}/p-seated.png`);
  console.log("locked", await page.pointerLocked());
  console.log(await page.evaluate(() => document.body.innerText.slice(0, 2500)));
} catch (e) {
  console.error("ERR", e.stack);
  await page.screenshot(`${L.HERE}/err-prep.png`).catch(() => {});
} finally {
  browser.disconnect();
}
