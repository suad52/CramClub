// Proof of the toolchain, and a worked example for recording scripts:
//   10 s of the live title screen orbit (cursor drifts to "Enter the Library"), then the clip is
//   paused while we go in, then 5 s of walking down the Grand Reading Hall with mouse-look.
//   Output: clips/_test.mp4, frames/_test-*.png, and the capture stats.
// Run: node test-clip.mjs   (the main Chrome must have a saved character; see README)
import path from "node:path";
import { sleep } from "./cdp.mjs";
import { launchChrome } from "./launch.mjs";
import { startRecording, probe, extractFrames, CLIPS_DIR, FRAMES_DIR } from "./recorder.mjs";
import * as app from "./app.mjs";

const browser = await launchChrome("main");
const page = await browser.page();
try {
  // A fresh title screen (the page reloads; the learner cookie and character stay).
  await app.openSite(page);
  await page.waitForText("Cram", { timeout: 60000 });
  const hasCharacter = await page.exists("Enter the Library");
  if (!hasCharacter) (await app.seedCharacter(page, { name: "Alex" }), await app.openSite(page));
  await page.waitForText("Enter the Library");
  await sleep(2500); // let the title animation settle before rolling
  await page.placeMouse(1300, 820);

  const rec = await startRecording(page, "_test");
  console.log("title fps (rAF):", await page.fps(1500));
  await sleep(6000);
  await page.hover("Enter the Library"); // the cursor glides over; the orbit keeps going
  while (rec.elapsed < 10) await sleep(50);
  await rec.pause();

  // Not recorded: go in and capture the mouse.
  await page.click("Enter the Library");
  await page.waitForText("Go in");
  await sleep(600);
  await page.click("Go in");
  await app.waitPlaying(page);
  await sleep(2500);
  await app.lockLook(page);
  await page.keycast(true);
  await sleep(600);

  await rec.resume();
  const t0 = rec.elapsed;
  const walk = page.hold("w", 3400);
  await sleep(500);
  await page.turn(0.35, 0, { duration: 1400 }); // glance left while walking
  await walk;
  await page.turn(-0.35, 0, { duration: 900 });
  console.log("hall fps (rAF):", await page.fps(500));
  while (rec.elapsed < t0 + 5) await sleep(50);
  await page.keycast(false);
  const info = await rec.stop();
  console.log("recording:", JSON.stringify(info));

  const file = path.join(CLIPS_DIR, "_test.mp4");
  console.log("probe:", JSON.stringify(probe(file)));
  const frames = extractFrames(file, path.join(FRAMES_DIR, "_test"), [1.0, 8.6, 11.5, 14.4]);
  console.log("frames:", frames.join("\n  "));
  const logs = page.takeLogs().filter((l) => !l.includes("THREE.Clock"));
  if (logs.length) console.log("page console:", logs);
} finally {
  browser.disconnect();
}
