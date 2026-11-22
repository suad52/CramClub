// A recording-friendly wrapper around one CDP page session: navigation, evaluation, waiting,
// human-looking mouse and keyboard input (through real Input.dispatch* events, so the app sees
// trusted events), the injected cursor, camera-pose reads and screenshots.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sleep } from "./cdp.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = readFileSync(path.join(HERE, "harness.js"), "utf8");

// ---------------------------------------------------------------- keys
const NAMED = {
  Enter: { code: "Enter", key: "Enter", vk: 13, text: "\r" },
  Escape: { code: "Escape", key: "Escape", vk: 27 },
  Esc: { code: "Escape", key: "Escape", vk: 27 },
  Tab: { code: "Tab", key: "Tab", vk: 9 },
  Backspace: { code: "Backspace", key: "Backspace", vk: 8 },
  Delete: { code: "Delete", key: "Delete", vk: 46 },
  Space: { code: "Space", key: " ", vk: 32, text: " " },
  " ": { code: "Space", key: " ", vk: 32, text: " " },
  ArrowUp: { code: "ArrowUp", key: "ArrowUp", vk: 38 },
  ArrowDown: { code: "ArrowDown", key: "ArrowDown", vk: 40 },
  ArrowLeft: { code: "ArrowLeft", key: "ArrowLeft", vk: 37 },
  ArrowRight: { code: "ArrowRight", key: "ArrowRight", vk: 39 },
  Shift: { code: "ShiftLeft", key: "Shift", vk: 16, mod: 8 },
  Home: { code: "Home", key: "Home", vk: 36 },
  End: { code: "End", key: "End", vk: 35 },
  PageDown: { code: "PageDown", key: "PageDown", vk: 34 },
  PageUp: { code: "PageUp", key: "PageUp", vk: 33 },
};
// Printable characters: [code, shifted?, vk]
const PUNCT = {
  ".": ["Period", 0, 190],
  ",": ["Comma", 0, 188],
  "/": ["Slash", 0, 191],
  "?": ["Slash", 1, 191],
  "!": ["Digit1", 1, 49],
  "@": ["Digit2", 1, 50],
  "#": ["Digit3", 1, 51],
  $: ["Digit4", 1, 52],
  "%": ["Digit5", 1, 53],
  "&": ["Digit7", 1, 55],
  "*": ["Digit8", 1, 56],
  "(": ["Digit9", 1, 57],
  ")": ["Digit0", 1, 48],
  "-": ["Minus", 0, 189],
  _: ["Minus", 1, 189],
  "=": ["Equal", 0, 187],
  "+": ["Equal", 1, 187],
  ";": ["Semicolon", 0, 186],
  ":": ["Semicolon", 1, 186],
  "'": ["Quote", 0, 222],
  '"': ["Quote", 1, 222],
  "[": ["BracketLeft", 0, 219],
  "]": ["BracketRight", 0, 221],
};

/** CDP key event fields for a key name ("Enter", "e", "KeyE", "?", "Shift"...). */
export function keyDef(k) {
  if (NAMED[k]) return { ...NAMED[k] };
  if (/^Key[A-Z]$/.test(k)) k = k.slice(3).toLowerCase();
  if (/^Digit[0-9]$/.test(k)) k = k.slice(5);
  if (k.length === 1) {
    if (/[a-z]/.test(k))
      return { code: `Key${k.toUpperCase()}`, key: k, vk: k.toUpperCase().charCodeAt(0), text: k };
    if (/[A-Z]/.test(k)) return { code: `Key${k}`, key: k, vk: k.charCodeAt(0), text: k, mod: 8 };
    if (/[0-9]/.test(k)) return { code: `Digit${k}`, key: k, vk: k.charCodeAt(0), text: k };
    if (PUNCT[k]) {
      const [code, shift, vk] = PUNCT[k];
      return { code, key: k, vk, text: k, mod: shift ? 8 : 0 };
    }
    return { key: k, text: k, vk: 0, code: "" }; // other unicode: sent as text only
  }
  throw new Error(`Unknown key "${k}"`);
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const rand = (a, b) => a + Math.random() * (b - a);

export class Page {
  constructor(browser, targetId, sessionId, { lockShim = true } = {}) {
    this.browser = browser;
    this.harnessOpts = { lockShim };
    this.conn = browser.conn;
    this.targetId = targetId;
    this.sessionId = sessionId;
    this.mouse = { x: 960, y: 540, buttons: 0 };
    this.logs = [];
    this.lookSensitivity = 2.2 / 1000; // the app's default: radians per pixel
  }

  send(method, params = {}, timeoutMs) {
    return this.conn.send(method, params, this.sessionId, timeoutMs);
  }

  /** Subscribes to an event for this page only. */
  on(method, fn) {
    return this.conn.on(method, (params, sid) => {
      if (sid === this.sessionId) fn(params);
    });
  }

  async init() {
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Page.setLifecycleEventsEnabled", { enabled: true }).catch(() => {});
    // Pages in headless are always "focused" and "visible", so blur/visibility rules don't fire.
    await this.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    const source = `window.__demoOpts = ${JSON.stringify(this.harnessOpts)};\n${HARNESS}`;
    await this.send("Page.addScriptToEvaluateOnNewDocument", { source });
    await this.send("Runtime.evaluate", { expression: source }).catch(() => {});
    this.on("Runtime.consoleAPICalled", (p) => {
      if (p.type === "error" || p.type === "warning")
        this.logs.push(
          `${p.type}: ${p.args
            .map((a) => a.value ?? a.description ?? "")
            .join(" ")
            .slice(0, 400)}`,
        );
    });
    this.on("Runtime.exceptionThrown", (p) =>
      this.logs.push(
        `exception: ${(p.exceptionDetails.exception?.description ?? p.exceptionDetails.text).slice(0, 400)}`,
      ),
    );
    try {
      const m = await this.evaluate("window.__demo ? [__demo.x, __demo.y] : null");
      if (m && m[0] >= 0) this.mouse = { x: m[0], y: m[1], buttons: 0 };
    } catch {}
  }

  // ------------------------------------------------------------ navigation & JS
  /** Navigates and waits for the load event (plus `settle` ms). */
  async goto(url, { timeout = 45000, settle = 500 } = {}) {
    const loaded = this.conn.once("Page.loadEventFired", {
      sessionId: this.sessionId,
      timeoutMs: timeout,
    });
    const r = await this.send("Page.navigate", { url });
    if (r.errorText) throw new Error(`navigate ${url}: ${r.errorText}`);
    await loaded;
    await sleep(settle);
    await this.evaluate("window.__demo?.ensure?.(); true");
  }

  async reload({ timeout = 45000 } = {}) {
    const loaded = this.conn.once("Page.loadEventFired", {
      sessionId: this.sessionId,
      timeoutMs: timeout,
    });
    await this.send("Page.reload", {});
    await loaded;
  }

  url() {
    return this.evaluate("location.href");
  }

  /**
   * Evaluates an expression string, or a function with JSON-able args, in the page; awaits
   * promises and returns the value by value. Throws on page exceptions.
   */
  async evaluate(fnOrExpr, ...args) {
    const expression =
      typeof fnOrExpr === "function"
        ? `(${fnOrExpr.toString()})(...${JSON.stringify(args)})`
        : fnOrExpr;
    const r = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        `evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`,
      );
    return r.result.value;
  }

  /** Polls until the expression/function returns something truthy; returns it. */
  async waitFor(fnOrExpr, { timeout = 30000, interval = 250, args = [], message } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        last = await this.evaluate(fnOrExpr, ...args);
        if (last) return last;
      } catch (e) {
        last = e.message;
      }
      await sleep(interval);
    }
    throw new Error(
      `waitFor timed out after ${timeout} ms: ${message ?? String(fnOrExpr).slice(0, 160)} (last: ${JSON.stringify(last)?.slice(0, 200)})`,
    );
  }

  /** Waits until visible page text contains `text` (string or RegExp source with {regex:true}). */
  waitForText(text, { timeout = 30000, gone = false } = {}) {
    return this.waitFor(
      (t, gone) => {
        const has = document.body && document.body.innerText.includes(t);
        return gone ? !has : has;
      },
      { timeout, args: [text, gone], message: `${gone ? "text gone" : "text"} "${text}"` },
    );
  }

  /** Visible page text (for checks and logging). */
  text() {
    return this.evaluate("document.body ? document.body.innerText : ''");
  }

  // ------------------------------------------------------------ finding elements
  /**
   * Finds a visible element and returns its box and centre in CSS px.
   * `target`: "Visible text" | { text, exact, selector, role, label, placeholder, index, within, near }
   *   text        matches aria-label, innerText, value, title or placeholder (case-insensitive)
   *   exact       require the whole (trimmed) text to match
   *   selector    CSS selector (combined with text if both are given)
   *   role        "button" | "link" | "textbox" | any ARIA role / tag
   *   within      CSS selector of a container to search in
   *   index       pick the n-th match (default: the best one)
   * Interactive elements (button, a, input, [role=button]...) and smaller boxes win ties, and
   * elements actually hit at their centre (not covered by an overlay) are preferred.
   */
  async locate(target, { timeout = 15000 } = {}) {
    const t = typeof target === "string" ? { text: target } : target;
    return this.waitFor(
      (t) => {
        const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();
        const want = t.text != null ? norm(t.text) : null;
        const roleSel = {
          button: 'button, [role="button"], input[type="button"], input[type="submit"], summary',
          link: 'a[href], [role="link"]',
          textbox:
            'input:not([type]), input[type="text"], input[type="search"], input[type="email"], textarea, [contenteditable="true"], [role="textbox"]',
          checkbox: 'input[type="checkbox"], [role="checkbox"], [role="switch"]',
          tab: '[role="tab"]',
          option: '[role="option"], option',
          menuitem: '[role="menuitem"]',
        };
        let sel = t.selector || (t.role ? roleSel[t.role] || `[role="${t.role}"], ${t.role}` : "*");
        const root = t.within ? document.querySelector(t.within) : document;
        if (!root) return null;
        const interactive =
          'button, a[href], input, textarea, select, summary, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="option"], [role="checkbox"], [role="switch"], [tabindex]';
        const out = [];
        for (const el of root.querySelectorAll(sel)) {
          if (el.id && el.id.startsWith("__demo")) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.height < 2) continue;
          if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === "hidden" || cs.display === "none" || +cs.opacity === 0) continue;
          let score = 0;
          if (want != null) {
            const texts = [
              el.getAttribute("aria-label"),
              el.innerText,
              el.value,
              el.title,
              el.placeholder,
            ].map(norm);
            const hit = texts.find((s) => s && (t.exact ? s === want : s.includes(want)));
            if (!hit) continue;
            score += hit === want ? 100 : hit.startsWith(want) ? 60 : 30;
            score -= Math.min(30, (hit.length - want.length) / 4);
          }
          if (el.matches(interactive)) score += 40;
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const hitEl = document.elementFromPoint(
            Math.min(innerWidth - 1, Math.max(0, cx)),
            Math.min(innerHeight - 1, Math.max(0, cy)),
          );
          if (hitEl && (hitEl === el || el.contains(hitEl) || hitEl.contains(el))) score += 50;
          score -= Math.log10(r.width * r.height + 1) * 3;
          out.push({
            score,
            x: Math.round(cx),
            y: Math.round(cy),
            w: Math.round(r.width),
            h: Math.round(r.height),
            left: Math.round(r.left),
            top: Math.round(r.top),
            tag: el.tagName.toLowerCase(),
            text: (
              el.getAttribute("aria-label") ||
              el.innerText ||
              el.value ||
              el.placeholder ||
              ""
            )
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80),
          });
        }
        if (!out.length) return null;
        if (t.index != null) {
          // index counts in document order
          return out[t.index] ?? null;
        }
        out.sort((a, b) => b.score - a.score);
        return out[0];
      },
      { timeout, args: [t], message: `element ${JSON.stringify(t)}` },
    );
  }

  /** True if the target is currently visible (no waiting). */
  async exists(target) {
    try {
      await this.locate(target, { timeout: 1 });
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ mouse
  async #mouse(type, x, y, extra = {}) {
    await this.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      buttons: this.mouse.buttons,
      button: type === "mouseMoved" ? (this.mouse.buttons & 1 ? "left" : "none") : "left",
      ...extra,
    });
  }

  /**
   * Glides the mouse to (x, y) like a hand would: ease-in-out over `duration` ms (default
   * 400–700 ms by distance) along a slight arc, one real mouse event every ~16 ms.
   */
  async moveTo(x, y, { duration, arc = true } = {}) {
    // After pointer lock the real mouse may be elsewhere than the drawn cursor: start from the
    // drawn one so the cursor never jumps.
    const drawn = await this.evaluate(
      "window.__demo && !document.pointerLockElement && __demo.x >= 0 ? [__demo.x, __demo.y] : null",
    ).catch(() => null);
    if (drawn && Math.hypot(drawn[0] - this.mouse.x, drawn[1] - this.mouse.y) > 2) {
      this.mouse.x = drawn[0];
      this.mouse.y = drawn[1];
      await this.#mouse("mouseMoved", drawn[0], drawn[1]);
    }
    const x0 = this.mouse.x;
    const y0 = this.mouse.y;
    const dx = x - x0;
    const dy = y - y0;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) return;
    duration ??= Math.round(Math.min(700, Math.max(400, 330 + dist * 0.38)));
    const bend = arc ? rand(-0.09, 0.09) * Math.min(dist, 600) : 0;
    const nx = -dy / dist;
    const ny = dx / dist;
    const t0 = performance.now();
    for (;;) {
      const raw = Math.min(1, (performance.now() - t0) / duration);
      const e = easeInOut(raw);
      const off = Math.sin(Math.PI * e) * bend;
      const px = x0 + dx * e + nx * off;
      const py = y0 + dy * e + ny * off;
      this.mouse.x = px;
      this.mouse.y = py;
      await this.#mouse("mouseMoved", px, py);
      if (raw >= 1) break;
      await sleep(14);
    }
    this.mouse.x = x;
    this.mouse.y = y;
  }

  /** Moves to the target (text / options / {x,y}) and hovers there. Returns its box. */
  async hover(target, opts = {}) {
    const box =
      target &&
      typeof target === "object" &&
      "x" in target &&
      !("text" in target) &&
      !("selector" in target)
        ? target
        : await this.locate(target, opts);
    await this.moveTo(box.x + (opts.dx ?? 0), box.y + (opts.dy ?? 0), opts);
    return box;
  }

  /**
   * Glides to the target and clicks it (press 70–110 ms). `target` is visible text, a locate()
   * object, or { x, y }. Options: pause (ms before pressing, default 160), dx/dy offsets,
   * duration (glide ms), clickCount.
   */
  async click(target, opts = {}) {
    const box = await this.hover(target, opts);
    await sleep(opts.pause ?? rand(130, 200));
    await this.mouseDown();
    await sleep(rand(70, 110));
    await this.mouseUp({ clickCount: opts.clickCount ?? 1 });
    await sleep(opts.after ?? 120);
    return box;
  }

  async mouseDown({ clickCount = 1 } = {}) {
    this.mouse.buttons |= 1;
    await this.#mouse("mousePressed", this.mouse.x, this.mouse.y, { clickCount });
  }

  async mouseUp({ clickCount = 1 } = {}) {
    this.mouse.buttons &= ~1;
    await this.#mouse("mouseReleased", this.mouse.x, this.mouse.y, { clickCount });
  }

  async doubleClick(target, opts = {}) {
    await this.click(target, { ...opts, after: 40 });
    await this.mouseDown({ clickCount: 2 });
    await sleep(60);
    await this.mouseUp({ clickCount: 2 });
  }

  /**
   * Smooth wheel scroll at the mouse position (or opts.x/y, gliding there first): positive dy
   * scrolls down. Sends small deltas every ~16 ms over `duration` ms (eased), so long scrolls
   * (e.g. the /proof page) read smoothly on video.
   */
  async scroll(dy, { x, y, duration = 1200 } = {}) {
    if (x != null && y != null) await this.moveTo(x, y);
    const steps = Math.max(1, Math.round(duration / 16));
    let sent = 0;
    for (let i = 1; i <= steps; i++) {
      const want = dy * easeInOut(i / steps);
      const d = want - sent;
      sent = want;
      if (Math.abs(d) >= 0.5)
        await this.send("Input.dispatchMouseEvent", {
          type: "mouseWheel",
          x: this.mouse.x,
          y: this.mouse.y,
          deltaX: 0,
          deltaY: d,
        });
      await sleep(16);
    }
  }

  /** Sets files on an <input type=file> (CSS selector) without a file dialog. */
  async upload(selector, files) {
    const { root } = await this.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await this.send("DOM.querySelector", { nodeId: root.nodeId, selector });
    if (!nodeId) throw new Error(`upload: no element ${selector}`);
    await this.send("DOM.setFileInputFiles", { nodeId, files });
  }

  /** Is the pointer locked (mouse-look captured) right now? */
  pointerLocked() {
    return this.evaluate("!!document.pointerLockElement");
  }

  /**
   * Turns the 3D view smoothly by (dx, dy) mouse pixels over `duration` ms (eased). With pointer
   * lock (emulated, see harness.js) it sends relative mouse moves, recentring with moves the app
   * never sees, and the drawn cursor is hidden as in a real locked browser. Without lock it drags
   * on the 3D view (the app's drag-to-look fallback) with the drawn cursor hidden, then puts the
   * cursor back. 1 px = 2.2 mrad at the app's default sensitivity: turn(rad) converts for you.
   */
  async look(dx, dy = 0, { duration = 900 } = {}) {
    const locked = await this.pointerLocked();
    const start = { x: this.mouse.x, y: this.mouse.y };
    const ox = 960;
    const oy = 540;
    const recentre = async () => {
      if (locked)
        await this.evaluate("__demo.swallowMouse = true; __demo.swallowPointer = true; true");
      else await this.mouseUp();
      this.mouse.x = ox;
      this.mouse.y = oy;
      await this.#mouse("mouseMoved", ox, oy);
      if (!locked) await this.mouseDown();
    };
    if (!locked) {
      await this.evaluate("__demo.setCursor(false)");
      const p = await this.evaluate(() => {
        const ok = (x, y) => {
          const el = document.elementFromPoint(x, y);
          return el && (el.tagName === "CANVAS" || el.closest("[data-look-surface]"));
        };
        return ok(960, 540) || ok(960, 400);
      });
      if (!p) throw new Error("look(): no bare 3D view to drag on (a panel covers the scene?)");
      this.mouse.x = ox;
      this.mouse.y = oy;
      await this.#mouse("mouseMoved", ox, oy);
      await this.mouseDown();
    } else {
      await recentre();
    }
    let sx = 0;
    let sy = 0;
    const t0 = performance.now();
    for (;;) {
      const e = easeInOut(Math.min(1, (performance.now() - t0) / duration));
      const stepX = dx * e - sx;
      const stepY = dy * e - sy;
      sx += stepX;
      sy += stepY;
      const nx = this.mouse.x + stepX;
      const ny = this.mouse.y + stepY;
      if (nx < 40 || nx > 1880 || ny < 40 || ny > 1040) await recentre();
      this.mouse.x += stepX;
      this.mouse.y += stepY;
      await this.#mouse("mouseMoved", this.mouse.x, this.mouse.y);
      if (e >= 1) break;
      await sleep(14);
    }
    if (!locked) await this.mouseUp();
    // Put the mouse back where it was, unseen by the app's look handler.
    if (locked)
      await this.evaluate("__demo.swallowMouse = true; __demo.swallowPointer = true; true");
    this.mouse.x = start.x;
    this.mouse.y = start.y;
    await this.#mouse("mouseMoved", start.x, start.y);
    if (!locked) await this.evaluate("__demo.setCursor(true)");
  }

  /**
   * One relative mouse move of (dx, dy) px for continuous steering under pointer lock (no easing,
   * no waiting); recentres unseen near the screen edge. Use look()/turn() for single gestures.
   */
  async nudge(dx, dy = 0) {
    let nx = this.mouse.x + dx;
    let ny = this.mouse.y + dy;
    if (nx < 40 || nx > 1880 || ny < 40 || ny > 1040) {
      await this.evaluate("__demo.swallowMouse = true; __demo.swallowPointer = true; true");
      await this.#mouse("mouseMoved", 960, 540);
      nx = 960 + dx;
      ny = 540 + dy;
    }
    this.mouse.x = nx;
    this.mouse.y = ny;
    await this.#mouse("mouseMoved", nx, ny);
  }

  /** Turns the view by `yaw` radians (+ = left, like the app) and `pitch` radians (+ = up). */
  turn(yaw, pitch = 0, opts) {
    return this.look(-yaw / this.lookSensitivity, -pitch / this.lookSensitivity, opts);
  }

  /** The 3D camera pose (see harness.js): { x, y, z, yaw, pitch, fov }. */
  pose() {
    return this.evaluate("window.__demo?.pose?.() ?? null");
  }

  /** The local player's feet position and facing: { x, y, z, facing, visible } (see harness.js). */
  player() {
    return this.evaluate("window.__demo?.player?.() ?? null");
  }

  /**
   * Turns to face world point (x, z) (yaw only, plus optional absolute pitch). Uses the camera
   * pose, so it works in first and third person.
   */
  async face(x, z, { pitch, duration = 900 } = {}) {
    const p = await this.pose();
    if (!p) throw new Error("face(): no 3D camera");
    const want = Math.atan2(-(x - p.x), -(z - p.z));
    let d = want - p.yaw;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    await this.turn(d, pitch != null ? pitch - p.pitch : 0, { duration });
  }

  // ------------------------------------------------------------ keyboard
  async keyDown(k) {
    const d = keyDef(k);
    await this.send("Input.dispatchKeyEvent", {
      type: d.text ? "keyDown" : "rawKeyDown",
      key: d.key,
      code: d.code,
      windowsVirtualKeyCode: d.vk,
      nativeVirtualKeyCode: d.vk,
      text: d.text,
      unmodifiedText: d.text,
      modifiers: d.mod ?? 0,
    });
  }

  async keyUp(k) {
    const d = keyDef(k);
    await this.send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: d.key,
      code: d.code,
      windowsVirtualKeyCode: d.vk,
      nativeVirtualKeyCode: d.vk,
      // Like a real browser: Shift's own keyup has shiftKey false (the app waits for that).
      modifiers: d.key === "Shift" ? 0 : (d.mod ?? 0),
    });
  }

  /** Presses and releases a key ("Enter", "Escape", "e", "p", "?", "ArrowDown"...). */
  async press(k, { hold = 70, after = 80 } = {}) {
    const d = keyDef(k);
    if (d.mod === 8 && k !== "Shift") await this.keyDown("Shift");
    await this.keyDown(k);
    await sleep(hold);
    await this.keyUp(k);
    if (d.mod === 8 && k !== "Shift") await this.keyUp("Shift");
    await sleep(after);
  }

  /** Holds a key for `ms` (e.g. hold("w", 2500) walks forward 2.5 s). */
  async hold(k, ms) {
    await this.keyDown(k);
    await sleep(ms);
    await this.keyUp(k);
  }

  /** Holds several keys together (e.g. ["w", "a"] walks diagonally). */
  async holdKeys(keys, ms) {
    for (const k of keys) await this.keyDown(k);
    await sleep(ms);
    for (const k of [...keys].reverse()) await this.keyUp(k);
  }

  /**
   * Types text into whatever has focus, key by key with human-ish timing (default 45–120 ms per
   * key, a little longer after spaces and punctuation). Use `delay: [min,max]` to change it.
   */
  async type(text, { delay = [45, 120] } = {}) {
    for (const ch of text) {
      if (ch === "\n") {
        await this.press("Enter");
        continue;
      }
      const d = keyDef(ch);
      if (!d.code) {
        await this.send("Input.insertText", { text: ch });
      } else {
        if (d.mod === 8) await this.keyDown("Shift");
        await this.send("Input.dispatchKeyEvent", {
          type: "keyDown",
          key: d.key,
          code: d.code,
          windowsVirtualKeyCode: d.vk,
          nativeVirtualKeyCode: d.vk,
          text: d.text,
          unmodifiedText: d.text,
          modifiers: d.mod ?? 0,
        });
        await this.send("Input.dispatchKeyEvent", {
          type: "keyUp",
          key: d.key,
          code: d.code,
          windowsVirtualKeyCode: d.vk,
          nativeVirtualKeyCode: d.vk,
          modifiers: d.mod ?? 0,
        });
        if (d.mod === 8) await this.keyUp("Shift");
      }
      let ms = rand(delay[0], delay[1]);
      if (ch === " ") ms += rand(10, 50);
      if (/[,.?!]/.test(ch)) ms += rand(80, 180);
      await sleep(ms);
    }
  }

  // ------------------------------------------------------------ overlays & capture
  /** Shows or hides the drawn cursor. */
  cursor(visible) {
    return this.evaluate(`__demo.setCursor(${!!visible}); true`);
  }

  /** Turns the keycap overlay (shows pressed game keys at the bottom centre) on or off. */
  keycast(on) {
    return this.evaluate(`__demo.keycast = ${!!on}; true`);
  }

  /** Places the drawn cursor (and the real mouse) at (x, y) instantly, e.g. before a clip starts. */
  async placeMouse(x, y) {
    this.mouse.x = x;
    this.mouse.y = y;
    await this.#mouse("mouseMoved", x, y);
    await this.evaluate(`__demo.moveCursor(${x}, ${y}); true`);
  }

  /** Real requestAnimationFrame rate of the page over `ms`. */
  fps(ms = 2000) {
    return this.evaluate(`__demo.fps(${ms})`);
  }

  /** PNG screenshot of the viewport (CSS px = image px at DPR 1). */
  async screenshot(file) {
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from(r.data, "base64"));
    return file;
  }

  /** Sets localStorage keys for the page's current origin (values are JSON-stringified objects or strings). */
  setStorage(entries) {
    return this.evaluate((entries) => {
      for (const [k, v] of Object.entries(entries))
        localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
      return Object.keys(entries);
    }, entries);
  }

  getStorage(key) {
    return this.evaluate((k) => localStorage.getItem(k), key);
  }

  /** Console errors/warnings and page exceptions since the last call. */
  takeLogs() {
    const l = this.logs;
    this.logs = [];
    return l;
  }
}
