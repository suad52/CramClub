// Group B: the demo Chrome (fresh profile "demo" on :9557), same tab every run.
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
export * from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
export const HERE = T.WORK_DIR + "/takes/group-b";
export const PORT = 9557;
export async function connect() {
  const browser = await T.launchChrome("demo", { port: PORT, width: 1920, height: 1080 });
  const page = await browser.page();
  return { browser, page };
}
