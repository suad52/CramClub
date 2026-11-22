// Everything in one import for recording scripts:
//   import { launchChrome, startRecording, recordClip, probe, extractFrames, app, Bot, sleep } from "./index.mjs";
export { CDP, sleep } from "./cdp.mjs";
export { launchChrome, connectChrome, stopChrome, SITE, WORK_DIR, PROFILES } from "./launch.mjs";
export { Page, keyDef } from "./page.mjs";
export {
  startRecording,
  recordClip,
  probe,
  extractFrames,
  ensureEncoder,
  CLIPS_DIR,
  FRAMES_DIR,
} from "./recorder.mjs";
export { Bot } from "./bot.mjs";
export * as app from "./app.mjs";
