// Cram Club–specific helpers on top of page.mjs: who the visitor is (localStorage only, the
// learner cookie is kept), getting into the library, mouse-look, steering to a point, sitting,
// and chatting. Shared by the recording scripts and bot.mjs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./cdp.mjs";
import { SITE } from "./launch.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLAN = JSON.parse(
  readFileSync(path.resolve(HERE, "../../packages/shared/src/world/library-plan.json"), "utf8"),
);
export { SITE };
/** Every seat in the library: { id, x, z, rotationY, tableId, zone, prompt }. */
export const SEATS = PLAN.seats;
export const SPAWN_POINTS = PLAN.spawnPoints;
export const seatById = (id) => SEATS.find((s) => s.id === id);

/** A point `back` metres behind a seat (away from its desk): where to stand before pressing E. */
export function seatApproach(id, back = 0.75) {
  const s = seatById(id);
  if (!s) throw new Error(`no seat ${id}`);
  // A seat's local front is +Z rotated by rotationY: front = (sin r, cos r).
  return {
    x: +(s.x - Math.sin(s.rotationY) * back).toFixed(3),
    z: +(s.z - Math.cos(s.rotationY) * back).toFixed(3),
  };
}

/** Preset looks (same fields as the Character Studio). The bot uses CAMPUS_RUNNER. */
export const LOOKS = {
  COZY_READER: {},
  CAMPUS_RUNNER: {
    skin: "golden",
    face: "heart",
    eyes: "almond",
    eyeColor: "hazel",
    brows: "arched",
    browColor: "espresso",
    mouth: "grin",
    hair: "ponytail",
    hairColor: "espresso",
    hairAccent: "white",
    top: "jacket",
    topColor: "tomato",
    topAccent: "cream",
    bottom: "shorts",
    bottomColor: "navy",
    shoes: "sneakers",
    shoesColor: "white",
    accessories: ["cap", "backpack"],
    accessoryColor: "navy",
    build: 0.3,
    height: 0.4,
  },
  NIGHT_OWL: {
    skin: "caramel",
    eyes: "sleepy",
    eyeColor: "dark",
    brows: "straight",
    browColor: "ink",
    mouth: "soft",
    hair: "crop",
    hairColor: "ink",
    top: "hoodie",
    topColor: "ink",
    topAccent: "charcoal",
    bottom: "chinos",
    bottomColor: "charcoal",
    shoes: "sneakers",
    shoesColor: "white",
    accessories: ["headphones"],
    accessoryColor: "teal",
    metal: "silver",
    build: -0.2,
  },
};

const DEFAULT_AVATAR = {
  v: 2,
  build: 0,
  height: 0,
  skin: "honey",
  face: "oval",
  eyes: "round",
  eyeColor: "brown",
  brows: "soft",
  browColor: "chestnut",
  mouth: "smile",
  lipColor: "natural",
  nose: "button",
  hair: "bob",
  hairColor: "chestnut",
  hairAccent: "tomato",
  top: "sweater",
  topColor: "sage",
  topAccent: "cream",
  bottom: "jeans",
  bottomColor: "denim",
  shoes: "sneakers",
  shoesColor: "white",
  accessories: ["glasses_round"],
  accessoryColor: "mustard",
  metal: "gold",
  details: [],
};

/** Opens the site (title screen) if the page isn't on it yet. */
export async function openSite(page, p = "/") {
  await page.goto(SITE + p);
}

async function onSite(page) {
  const href = await page.url().catch(() => "");
  if (!href.startsWith(SITE)) await openSite(page);
}

/**
 * Writes a saved character and preferences to localStorage (this browser only), so the title
 * screen offers "Enter the Library" and the controls guide doesn't pop up. Reload or goto after.
 *   name, look (patch over the default avatar), quality ("high" | "balanced" | "low"),
 *   cameraMode ("third-person" | "first-person"), guideSeen, camera ("off" | "on"), mic.
 */
export async function seedCharacter(
  page,
  {
    name = "Alex",
    look = {},
    quality = "high",
    cameraMode = "third-person",
    guideSeen = true,
    camera = "off",
    mic = "skipped",
    devicesDone = true,
  } = {},
) {
  await onSite(page);
  const now = Date.now();
  const entries = {
    "ovr.profile": {
      state: {
        displayName: name,
        avatar: { ...DEFAULT_AVATAR, ...look, v: 2 },
        savedAt: now,
        headMode: "chibi",
      },
      version: 3,
    },
    "ovr.preferences": {
      state: {
        cameraMode,
        settings: { mouseSensitivity: 2.2, invertY: false, quality },
        guideSeen,
      },
      version: 1,
    },
  };
  if (devicesDone)
    entries["ovr.devices"] = {
      state: { camera, mic, cameraId: null, micId: null, setupDoneAt: now },
      version: 1,
    };
  await page.setStorage(entries);
}

/**
 * Makes this browser a first-time visitor again for the UI ("Create your character", controls
 * guide, device check unanswered) by deleting the app's localStorage/sessionStorage. The learner
 * cookie is KEPT, so production doesn't get a new anonymous learner. Reload or goto after.
 */
export async function resetVisitor(page) {
  await onSite(page);
  return page.evaluate(() => {
    const gone = [];
    for (const k of Object.keys(localStorage))
      if (k.startsWith("ovr")) (localStorage.removeItem(k), gone.push(k));
    for (const k of Object.keys(sessionStorage))
      if (k.startsWith("ovr")) (sessionStorage.removeItem(k), gone.push(k));
    return gone;
  });
}

/** Waits until the library HUD is up and the player can move (phase "playing"). */
export async function waitPlaying(page, { timeout = 45000 } = {}) {
  await page.waitFor(
    () => {
      const t = document.body?.innerText ?? "";
      return /Menu\s*\n?\s*Esc/.test(t) && /Chat/.test(t) && !t.includes("Before you go in");
    },
    { timeout, message: "library HUD (phase playing)" },
  );
}

/**
 * From the title screen with a saved character: Enter the Library → Go in → playing. Closes the
 * controls guide if it opens. `click: false` uses the keyboard (Enter, Enter) instead.
 */
export async function enterLibrary(page, { click = true, timeout = 60000 } = {}) {
  await page.waitForText("Enter the Library", { timeout });
  await sleep(600);
  if (click) await page.click("Enter the Library");
  else await page.press("Enter");
  await page.waitForText("Go in", { timeout: 20000 });
  await sleep(700);
  if (click) await page.click("Go in");
  else await page.press("Enter");
  await waitPlaying(page, { timeout });
  await sleep(1500);
  if (await page.exists({ text: "Start exploring", role: "button" })) {
    await page.click({ text: "Start exploring", role: "button" });
    await sleep(500);
  }
}

/** Clicks the 3D view to capture the mouse for looking around (emulated pointer lock). */
export async function lockLook(page, { at = { x: 960, y: 640 } } = {}) {
  if (await page.pointerLocked()) return;
  await page.waitFor(() => !!document.querySelector("[data-look-surface]"), {
    timeout: 15000,
    message: "click-to-look layer",
  });
  await page.click(at);
  await page.waitFor("!!document.pointerLockElement", { timeout: 5000, message: "pointer lock" });
}

const wrap = (a) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};

/**
 * Walks the local player to (x, z) like a person would: holds W and steers with small mouse
 * moves (turns in place first if the target is behind). Returns { x, z, dist, stuck }.
 *   tol        stop within this many metres (default 0.45)
 *   maxTurn    steering rate, rad/s (default 2.2)
 *   timeout    give up after this many ms (default 25000)
 *   pitch      keep the camera at this pitch while walking (optional)
 */
export async function walkTo(
  page,
  x,
  z,
  { tol = 0.45, maxTurn = 2.2, timeout = 25000, pitch } = {},
) {
  await lockLook(page);
  const sens = page.lookSensitivity;
  const t0 = Date.now();
  let walking = false;
  let last = await page.player();
  let lastProgressAt = Date.now();
  let lastDist = Infinity;
  let stuck = false;
  try {
    for (let tick = 0; ; tick++) {
      const [pl, pose] = await page.evaluate("[__demo.player(), __demo.pose()]");
      if (!pl || !pose) throw new Error("walkTo: no player/camera (not in the library?)");
      last = pl;
      const dx = x - pl.x;
      const dz = z - pl.z;
      const dist = Math.hypot(dx, dz);
      if (dist <= tol) break;
      if (Date.now() - t0 > timeout) {
        stuck = true;
        break;
      }
      if (dist < lastDist - 0.05) {
        lastDist = dist;
        lastProgressAt = Date.now();
      } else if (walking && Date.now() - lastProgressAt > 1500) {
        stuck = true;
        break;
      }
      const err = wrap(Math.atan2(-dx, -dz) - pose.yaw);
      // Turn in place when the target is well off to the side, walk while steering otherwise.
      const wantWalk = Math.abs(err) < 0.9;
      if (wantWalk && !walking) {
        await page.keyDown("w");
        walking = true;
        lastProgressAt = Date.now();
      } else if (!wantWalk && walking) {
        await page.keyUp("w");
        walking = false;
      }
      const step = Math.max(-maxTurn * 0.016, Math.min(maxTurn * 0.016, err));
      const pitchStep = pitch != null ? Math.max(-0.02, Math.min(0.02, pitch - pose.pitch)) : 0;
      if (Math.abs(step) > 0.002 || Math.abs(pitchStep) > 0.002)
        await page.nudge(-step / sens, -pitchStep / sens);
      await sleep(16);
    }
  } finally {
    if (walking) await page.keyUp("w");
  }
  await sleep(250);
  const end = (await page.player()) ?? last;
  return { x: end.x, z: end.z, dist: +Math.hypot(x - end.x, z - end.z).toFixed(2), stuck };
}

// ---------------------------------------------------------------- route planning (ground floor)
// Mirrors packages/shared/src/world (library.ts, physics.ts, librarianDesk.ts, leaderboards.ts):
// the plan's colliders minus the removed globe, plus the code-built librarian desk and the two
// leaderboards, kept only if they block a standing body (y1 > 0.275 and y0 < 1.75).
const L = { x: 0, frontZ: -7.45, width: 3, deskDepth: 0.36 + 0.54 };
const EXTRA_COLLIDERS = [
  {
    kind: "box",
    id: "librarian_desk",
    x: 0,
    z: L.frontZ - L.deskDepth / 2,
    halfW: 1.5,
    halfD: L.deskDepth / 2,
    rotationY: 0,
    y0: 0,
    y1: 1.1,
  },
  { kind: "circle", id: "librarian_chair", x: 1.05, z: -8.95, radius: 0.28, y0: 0, y1: 1 },
  { kind: "circle", id: "librarian", x: 0, z: -8.6, radius: 0.25, y0: 0, y1: 1.6 },
  {
    kind: "box",
    id: "librarian_catalogue",
    x: -1.75,
    z: -9.3,
    halfW: 0.43,
    halfD: 0.225,
    rotationY: 0,
    y0: 0,
    y1: 1.2,
  },
  {
    kind: "box",
    id: "librarian_cart",
    x: 1.8,
    z: -8.9,
    halfW: 0.4,
    halfD: 0.2,
    rotationY: 0,
    y0: 0,
    y1: 0.95,
  },
  {
    kind: "box",
    id: "leaderboard_focus",
    x: -13.1,
    z: -1,
    halfW: 0.8,
    halfD: 0.26,
    rotationY: Math.PI / 2,
    y0: 0,
    y1: 2.22,
  },
  {
    kind: "box",
    id: "leaderboard_xp",
    x: 13.1,
    z: -1,
    halfW: 0.8,
    halfD: 0.26,
    rotationY: -Math.PI / 2,
    y0: 0,
    y1: 2.22,
  },
];
const GROUND_OBSTACLES = [
  ...PLAN.colliders.filter((c) => c.id !== "hall-globe"),
  ...EXTRA_COLLIDERS,
].filter((c) => c.y1 > PLAN.stepUp * 0.5 && c.y0 < 1.75);
const GROUND_FLOORS = PLAN.surfaces
  .filter((s) => s.kind === "flat" && Math.abs(s.y) < 0.01)
  .map((s) => s.rect);
const PLAYER_RADIUS = 0.32;

/** Distance from (x, z) to a collider's footprint (0 inside). */
function distTo(c, x, z) {
  if (c.kind === "circle") return Math.max(0, Math.hypot(x - c.x, z - c.z) - c.radius);
  const dx = x - c.x;
  const dz = z - c.z;
  const co = Math.cos(c.rotationY);
  const si = Math.sin(c.rotationY);
  const lx = dx * co - dz * si;
  const lz = dx * si + dz * co;
  return Math.hypot(Math.max(0, Math.abs(lx) - c.halfW), Math.max(0, Math.abs(lz) - c.halfD));
}

let GRID = null;
function grid(margin) {
  if (GRID && GRID.margin === margin) return GRID;
  const cell = 0.2;
  const minX = Math.min(...GROUND_FLOORS.map((r) => r.minX));
  const maxX = Math.max(...GROUND_FLOORS.map((r) => r.maxX));
  const minZ = Math.min(...GROUND_FLOORS.map((r) => r.minZ));
  const maxZ = Math.max(...GROUND_FLOORS.map((r) => r.maxZ));
  const w = Math.ceil((maxX - minX) / cell) + 1;
  const h = Math.ceil((maxZ - minZ) / cell) + 1;
  const free = new Uint8Array(w * h);
  const clear = PLAYER_RADIUS + margin;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const x = minX + i * cell;
      const z = minZ + j * cell;
      const onFloor = GROUND_FLOORS.some(
        (r) =>
          x >= r.minX + clear && x <= r.maxX - clear && z >= r.minZ + clear && z <= r.maxZ - clear,
      );
      free[j * w + i] = onFloor && !GROUND_OBSTACLES.some((c) => distTo(c, x, z) < clear) ? 1 : 0;
    }
  GRID = { cell, minX, minZ, w, h, free, margin };
  return GRID;
}

/** Is (x, z) walkable for a standing player (with `margin` m to spare)? */
export function walkable(x, z, margin = 0.12) {
  return (
    GROUND_OBSTACLES.every((c) => distTo(c, x, z) >= PLAYER_RADIUS + margin) &&
    GROUND_FLOORS.some((r) => x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ)
  );
}

/**
 * A short collision-free route on the ground floor from (x0, z0) to (x1, z1): A* on a 0.2 m grid
 * around the furniture (player radius + `margin`), then straightened by line of sight. Returns
 * waypoints [{ x, z }, ...] ending at the goal (or the nearest walkable point to it).
 */
export function planRoute(x0, z0, x1, z1, { margin = 0.12 } = {}) {
  const g = grid(margin);
  const idx = (x, z) => [Math.round((x - g.minX) / g.cell), Math.round((z - g.minZ) / g.cell)];
  const ok = (i, j) => i >= 0 && j >= 0 && i < g.w && j < g.h && g.free[j * g.w + i] === 1;
  const nearestFree = ([i, j]) => {
    if (ok(i, j)) return [i, j];
    for (let r = 1; r < 30; r++)
      for (let dj = -r; dj <= r; dj++)
        for (let di = -r; di <= r; di++)
          if ((Math.abs(di) === r || Math.abs(dj) === r) && ok(i + di, j + dj))
            return [i + di, j + dj];
    return null;
  };
  const s = nearestFree(idx(x0, z0));
  const t = nearestFree(idx(x1, z1));
  if (!s || !t) return [{ x: x1, z: z1 }];
  const key = (i, j) => j * g.w + i;
  const open = new Map([[key(...s), { i: s[0], j: s[1], gc: 0, f: 0, prev: null }]]);
  const closed = new Map();
  let found = null;
  while (open.size) {
    let best = null;
    for (const n of open.values()) if (!best || n.f < best.f) best = n;
    open.delete(key(best.i, best.j));
    closed.set(key(best.i, best.j), best);
    if (best.i === t[0] && best.j === t[1]) {
      found = best;
      break;
    }
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = best.i + di;
        const nj = best.j + dj;
        if (!ok(ni, nj) || closed.has(key(ni, nj))) continue;
        if (di && dj && (!ok(best.i + di, best.j) || !ok(best.i, best.j + dj))) continue;
        const gc = best.gc + (di && dj ? Math.SQRT2 : 1);
        const k = key(ni, nj);
        const ex = open.get(k);
        if (ex && ex.gc <= gc) continue;
        open.set(k, { i: ni, j: nj, gc, f: gc + Math.hypot(t[0] - ni, t[1] - nj), prev: best });
      }
  }
  if (!found) return [{ x: x1, z: z1 }];
  const cells = [];
  for (let n = found; n; n = n.prev) cells.unshift([n.i, n.j]);
  const pt = ([i, j]) => ({
    x: +(g.minX + i * g.cell).toFixed(2),
    z: +(g.minZ + j * g.cell).toFixed(2),
  });
  const sight = (a, b) => {
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * 2);
    for (let k = 0; k <= steps; k++) {
      const i = Math.round(a[0] + ((b[0] - a[0]) * k) / steps);
      const j = Math.round(a[1] + ((b[1] - a[1]) * k) / steps);
      if (!ok(i, j)) return false;
    }
    return true;
  };
  const out = [];
  let a = 0;
  while (a < cells.length - 1) {
    let b = cells.length - 1;
    while (b > a + 1 && !sight(cells[a], cells[b])) b--;
    out.push(pt(cells[b]));
    a = b;
  }
  // End exactly on the goal when it is itself walkable.
  if (out.length && walkable(x1, z1, 0.02)) out[out.length - 1] = { x: x1, z: z1 };
  return out.length ? out : [{ x: x1, z: z1 }];
}

/**
 * Walks to (x, z) along a planned route around tables and chairs (see planRoute), steering like
 * a person. Same options and result as walkTo, plus `route`.
 */
export async function goTo(page, x, z, opts = {}) {
  const p = await page.player();
  if (!p) throw new Error("goTo: no player (not in the library?)");
  const route = planRoute(p.x, p.z, x, z, opts);
  const r = await walkPath(page, route, opts);
  return { ...r, route };
}

/** Walks through several { x, z } points in turn (no stop between them). */
export async function walkPath(page, points, opts = {}) {
  let r;
  for (const [i, p] of points.entries()) {
    r = await walkTo(page, p.x, p.z, {
      ...opts,
      tol: i === points.length - 1 ? (opts.tol ?? 0.45) : (opts.passTol ?? 0.8),
    });
    if (r.stuck) return { ...r, at: i };
  }
  return r;
}

/** Turns the camera to look at world point (x, y?, z) from where the camera is. */
export async function lookAt(page, x, z, { y, duration = 1000 } = {}) {
  const pose = await page.pose();
  const yaw = Math.atan2(-(x - pose.x), -(z - pose.z));
  let dPitch = 0;
  if (y != null) {
    const h = Math.hypot(x - pose.x, z - pose.z);
    dPitch = Math.atan2(y - pose.y, h) - pose.pitch;
  }
  await page.turn(wrap(yaw - pose.yaw), dPitch, { duration });
}

/** Walks to a seat's approach point, faces it and presses E. Waits for "Stand up". */
export async function sitAt(page, seatId, opts = {}) {
  if (await isSeated(page)) await standUp(page);
  const a = seatApproach(seatId);
  const r = await goTo(page, a.x, a.z, { tol: 0.3, ...opts });
  const s = seatById(seatId);
  await lookAt(page, s.x, s.z, { duration: 500 });
  await sleep(300);
  return { ...r, ...(await sit(page)) };
}

/** Presses E to sit at the nearby seat and waits until seated ("Stand up" shows, or the player snapped to a seat). */
export async function sit(page, { timeout = 6000 } = {}) {
  const before = await page.player();
  await page.press("e");
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const t = await page.text();
    if (t.includes("Stand up") || t.includes("Hold this table") || t.includes("hold this table"))
      return { seated: true };
    const p = await page.player();
    if (
      p &&
      before &&
      Math.hypot(p.x - before.x, p.z - before.z) > 0.2 &&
      SEATS.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 0.15)
    )
      return { seated: true };
    await sleep(250);
  }
  return { seated: false };
}

/** True while seated (the HUD offers "Stand up", or a pomodoro keeps you in the seat). */
export async function isSeated(page) {
  const t = await page.text();
  if (t.includes("Stand up") || t.includes("Leave table")) return true;
  const p = await page.player();
  return !!p && SEATS.some((s) => Math.hypot(s.x - p.x, s.z - p.z) < 0.3);
}

/** Presses E to stand up from a seat. */
export async function standUp(page) {
  await page.press("e");
  await sleep(900);
}

/**
 * Says something in the library chat: Enter opens the chat box, the text is typed key by key
 * (others see "… is typing" and dots over your head), Enter sends. `close` (default true)
 * presses Esc after sending to give the keys back to the game.
 */
export async function say(
  page,
  text,
  { delay = [55, 130], close = true, pauseBeforeSend = 400 } = {},
) {
  await page.press("Enter");
  await page.waitFor(
    () => {
      const a = document.activeElement;
      return (
        a &&
        (a.tagName === "INPUT" || a.tagName === "TEXTAREA") &&
        !!a.closest('section[aria-label="Library chat"], [aria-label*="hat"]')
      );
    },
    { timeout: 5000, message: "chat box focused" },
  );
  await sleep(300);
  await page.type(text, { delay });
  await sleep(pauseBeforeSend);
  await page.press("Enter");
  if (close) {
    await sleep(500);
    const still = await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA");
    });
    if (still) await page.press("Escape");
  }
}

/** Chat lines currently shown in the chat panel (oldest first), as plain text. */
export function chatLines(page) {
  return page.evaluate(() => {
    const sec = document.querySelector('section[aria-label="Library chat"]');
    return sec
      ? [...sec.querySelectorAll("li")].map((li) => li.innerText.replace(/\s+/g, " ").trim())
      : [];
  });
}
