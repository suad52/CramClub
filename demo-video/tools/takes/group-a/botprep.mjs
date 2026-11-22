import { Bot, app, sleep } from "/Users/suad/Documents/GitHub/OVR/demo-video/tools/index.mjs";
import { wrap } from "./helpers.mjs";
const bot = await Bot.connect();
const p = bot.page;
try {
  if (await app.isSeated(p)) {
    await app.standUp(p);
    await sleep(800);
  }
  await app.lockLook(p);
  const r = await bot.walkTo(-4.0, 4.5, { tol: 0.25 });
  const pose = await p.pose();
  await p.turn(wrap(0 - pose.yaw), 0, { duration: 500 });
  await sleep(500);
  // Peek at the chat history (opening the panel sends nothing), then close it.
  await p.press("Enter");
  await sleep(800);
  const lines = await app.chatLines(p);
  await p.press("Escape");
  await sleep(400);
  await app.lockLook(p);
  console.log(
    JSON.stringify({
      r,
      player: await p.player(),
      lines,
      text: (await p.text()).slice(0, 120).replace(/\n/g, " | "),
    }),
  );
} finally {
  bot.disconnect();
  process.exit(0);
}
