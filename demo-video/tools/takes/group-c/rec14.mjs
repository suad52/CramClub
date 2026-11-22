// 14-outro: title-screen orbit, title UI hidden, injected end card.
//   node rec14.mjs [--dry] [--suffix -t2] [--look file.json] [--url host]
//
// Review pass 2 re-shot it in group B's demo Chrome (TAKE_CHROME=demo, see lib.mjs) with
// --look (the character made in clip 01: Studio Artist, lavender space buns; the saved
// 'ovr.profile' JSON), so the title screen's orbit shows "you" instead of the default character.
// The look is only put in localStorage for the take and the browser's own one is put back after.
// --url sets the address on the end card (cramclub.study since the site moved there; the old
// 149-248-61-2.sslip.io link redirects to it).
// The title shot frames your character where you spawn, one of six points by the entrance picked
// at random on each load; --spawn x,z reloads (up to 8 times) until it's that one. 0.8,5.9 gives
// the open floor by the stacks (as in the first 14). Demo mode (this tab's sessionStorage) is
// turned off first so its ribbon isn't on the title screen.
import * as T from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import * as L from "./lib.mjs";
const sleep = T.sleep;
const DRY = process.argv.includes("--dry");
const SUFFIX = process.argv.includes("--suffix")
  ? process.argv[process.argv.indexOf("--suffix") + 1]
  : "";
const LOOK = process.argv.includes("--look")
  ? process.argv[process.argv.indexOf("--look") + 1]
  : null;
const SPAWN = process.argv.includes("--spawn")
  ? process.argv[process.argv.indexOf("--spawn") + 1].split(",").map(Number)
  : null;
const URL_TEXT = process.argv.includes("--url")
  ? process.argv[process.argv.indexOf("--url") + 1]
  : "149-248-61-2.sslip.io";
const { browser, page } = await L.connect();
const results = [];
const CARD = `(() => {
  document.getElementById("__endcard")?.remove();
  document.getElementById("__endcard_css")?.remove();
  const css = document.createElement("style");
  css.id = "__endcard_css";
  css.textContent = \`
    .z-30.absolute.inset-0 { opacity: 0 !important; transition: none !important; }
    #__endcard_wrap { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; display: flex; align-items: center; justify-content: flex-start; padding-left: 168px; }
    #__endcard_shade { position: fixed; inset: 0; z-index: 2147482999; pointer-events: none; background: radial-gradient(ellipse at 30% 50%, rgba(20,14,10,.55), rgba(20,14,10,.12) 55%, rgba(20,14,10,0) 75%); opacity: 0; transition: opacity 1.4s ease; }
    #__endcard_shade.on { opacity: 1; }
    #__endcard { background: #fbf4e6; border: 5px solid #1f1a16; border-radius: 30px; box-shadow: 12px 12px 0 #1f1a16; padding: 46px 60px 50px 56px; color: #1f1a16; transform: translateY(26px) rotate(-1.6deg) scale(.96); opacity: 0; transition: opacity .9s ease, transform 1.1s cubic-bezier(.2,1.3,.4,1); min-width: 640px; }
    #__endcard.on { opacity: 1; transform: translateY(0) rotate(-1.6deg) scale(1); }
    #__endcard .t { font-family: Fredoka, "Fredoka Fallback", Nunito, sans-serif; font-weight: 700; font-size: 112px; line-height: .95; letter-spacing: -1px; margin: 0; }
    #__endcard .bar { display: flex; gap: 10px; align-items: center; margin: 22px 0 30px; }
    #__endcard .bar i { display: block; height: 14px; border-radius: 99px; border: 3px solid #1f1a16; }
    #__endcard .row { display: flex; align-items: center; gap: 18px; font-family: Nunito, "Nunito Fallback", sans-serif; font-weight: 800; font-size: 38px; margin-top: 16px; }
    #__endcard .ic { width: 58px; height: 58px; border-radius: 16px; border: 4px solid #1f1a16; box-shadow: 4px 4px 0 #1f1a16; display: grid; place-items: center; flex: none; }
    #__endcard .ic svg { width: 30px; height: 30px; }
  \`;
  document.head.appendChild(css);
  const shade = document.createElement("div"); shade.id = "__endcard_shade";
  const wrap = document.createElement("div"); wrap.id = "__endcard_wrap";
  wrap.innerHTML = \`<div id="__endcard">
    <h1 class="t">Cram Club</h1>
    <div class="bar"><i style="width:120px;background:#e2794b"></i><i style="width:14px;background:#f0c65a"></i><i style="width:14px;background:#86b77d"></i></div>
    <div class="row"><span class="ic" style="background:#f0c65a"><svg viewBox="0 0 24 24" fill="none" stroke="#1f1a16" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/></svg></span>__URL__</div>
    <div class="row"><span class="ic" style="background:#86b77d"><svg viewBox="0 0 24 24" fill="none" stroke="#1f1a16" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/></svg></span>github.com/suad52/CramClub</div>
  </div>\`;
  document.body.appendChild(shade);
  document.body.appendChild(wrap);
  return true;
})()`;
let savedProfile = null;
try {
  if (!(await page.evaluate(() => location.href)).startsWith(T.SITE)) {
    await page.goto(T.SITE + "/");
    await page.waitForText("Cram", { timeout: 60000 });
  }
  if (LOOK) {
    const { readFileSync } = await import("node:fs");
    savedProfile = await page.getStorage("ovr.profile");
    await page.setStorage({ "ovr.profile": readFileSync(LOOK, "utf8").trim() });
  }
  await page.evaluate(() => sessionStorage.removeItem("ovr.demo"));
  for (let i = 0; i < 8; i++) {
    await page.goto(T.SITE + "/");
    await page.waitForText("Cram", { timeout: 60000 });
    await sleep(1500);
    const p = await page.player();
    L.log(`title spawn ${p.x.toFixed(1)},${p.z.toFixed(1)}`);
    if (!SPAWN || Math.hypot(p.x - SPAWN[0], p.z - SPAWN[1]) < 0.2) break;
  }
  await page.cursor(false);
  await page.evaluate(CARD.replace("__URL__", URL_TEXT));
  await sleep(2500); // title UI hidden, orbit running, card not shown yet
  if (DRY) {
    await page.screenshot(`${L.HERE}/outro-dry-nocard.png`);
    await page.evaluate(
      `document.getElementById("__endcard").classList.add("on"); document.getElementById("__endcard_shade").classList.add("on");`,
    );
    await sleep(1800);
    await page.screenshot(`${L.HERE}/outro-dry.png`);
  } else {
    const c = await L.clip(page, "14-outro" + SUFFIX);
    await c.beat(
      "wide shot: the title-screen camera slowly orbits the Grand Reading Hall (title UI hidden, no cursor)",
    );
    await sleep(1400);
    await page.evaluate(
      `document.getElementById("__endcard").classList.add("on"); document.getElementById("__endcard_shade").classList.add("on");`,
    );
    await c.beat(
      `end card eases in (cream card, walnut border, chunky shadow): 'Cram Club' / ${URL_TEXT} / github.com/suad52/CramClub`,
    );
    await sleep(1200);
    await c.beat("end card fully in; holds while the camera keeps orbiting");
    await sleep(6600);
    await c.beat("end");
    results.push(await c.stop());
  }
} catch (e) {
  console.error("ERR", e.stack);
  await page.screenshot(`${L.HERE}/err-14.png`).catch(() => {});
} finally {
  if (LOOK && savedProfile)
    await page
      .setStorage({ "ovr.profile": savedProfile })
      .catch((e) => console.error("restore profile", e.message));
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
