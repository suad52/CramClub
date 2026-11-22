// node run.mjs "<js body using page, browser, T, sleep>"  -- quick one-off driver
import * as C from "./conn.mjs";
const { browser, page } = await C.connect();
const sleep = C.sleep;
try {
  const body = process.argv[2];
  const fn = new Function("page", "browser", "T", "sleep", `return (async () => { ${body} })();`);
  const r = await fn(page, browser, C, sleep);
  if (r !== undefined) console.log(typeof r === "string" ? r : JSON.stringify(r, null, 1));
} catch (e) {
  console.error("ERR", e.message);
} finally {
  browser.disconnect();
}
