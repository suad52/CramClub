import * as L from "./lib.mjs";
const { browser, page } = await L.connect();
try {
  await page.screenshot(`${L.HERE}/state.png`);
  console.log((await page.text()).slice(0, 600).replace(/\n+/g, " | "));
} finally {
  browser.disconnect();
}
