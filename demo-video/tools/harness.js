// Injected into every document of a recording page (Page.addScriptToEvaluateOnNewDocument, and
// once into the current document). It never changes the app: it only
//   1. draws a visible arrow cursor that follows real (CDP) mouse events, with a click ripple,
//      hidden while the pointer is locked (mouse-look) or when hidden on purpose;
//   2. optionally shows pressed keys as keycaps (keycast) so viewers see "E", "P", "Enter";
//   3. remembers react-three-fiber roots as they are created, so tools can read the 3D camera
//      pose in the production build (which has no window.__ovr debug handle).
// Everything lives on window.__demo.
(() => {
  if (window.__demo) return;
  const demo = (window.__demo = {
    r3f: [], // { canvas, store } for each R3F <Canvas>
    cursorVisible: true,
    keycast: false,
    x: -100,
    y: -100,
  });

  // ---- 0. Pointer lock emulation. Headless Chrome refuses requestPointerLock, so the app would
  // fall back to drag-to-look with a "Hold the mouse button and drag" hint on screen. A real
  // desktop Chrome locks, so we emulate exactly what it does: requestPointerLock() succeeds and
  // fires "pointerlockchange" asynchronously, document.pointerLockElement reports the element,
  // exitPointerLock() releases it, and Esc is delivered to the page while still locked and then
  // releases the lock (the app ignores that Esc and opens its menu from the lock change, as in
  // Chrome). Mouse moves keep their real movementX/Y. Opt out with window.__demoOpts.lockShim=false.
  const opts = window.__demoOpts || {};
  if (opts.lockShim !== false) {
    let locked = null;
    const fire = () => document.dispatchEvent(new Event("pointerlockchange", { bubbles: true }));
    Object.defineProperty(Document.prototype, "pointerLockElement", {
      configurable: true,
      get() {
        if (locked && !locked.isConnected) locked = null;
        return locked;
      },
    });
    Element.prototype.requestPointerLock = function () {
      if (locked !== this) {
        locked = this;
        setTimeout(fire, 0);
      }
      return Promise.resolve();
    };
    Document.prototype.exitPointerLock = function () {
      if (locked) {
        locked = null;
        setTimeout(fire, 0);
      }
    };
    window.addEventListener(
      "keydown",
      (e) => {
        if (e.key === "Escape" && locked)
          setTimeout(() => {
            if (locked) {
              locked = null;
              fire();
            }
          }, 0);
      },
      true,
    );
    demo.lockShim = true;
  }
  // Tools set these right before a "recentre" mouse move under pointer lock, so the app never
  // sees that jump (the window capture listener runs before any app listener).
  demo.swallowMouse = false;
  demo.swallowPointer = false;
  window.addEventListener(
    "mousemove",
    (e) => {
      if (demo.swallowMouse) {
        demo.swallowMouse = false;
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  window.addEventListener(
    "pointermove",
    (e) => {
      if (demo.swallowPointer) {
        demo.swallowPointer = false;
        e.stopImmediatePropagation();
      }
    },
    true,
  );

  // ---- 3. R3F roots: R3F 9 keeps `_roots.set(canvas, { fiber, store, ... })` in a module Map.
  const origSet = Map.prototype.set;
  Map.prototype.set = function (k, v) {
    if (
      typeof k === "object" &&
      k !== null &&
      k instanceof HTMLCanvasElement &&
      v &&
      typeof v === "object" &&
      v.store &&
      typeof v.store.getState === "function" &&
      !demo.r3f.some((r) => r.canvas === k)
    ) {
      demo.r3f.push({ canvas: k, store: v.store, fiber: v.fiber });
    }
    return origSet.call(this, k, v);
  };

  /** The visible, connected R3F canvas with the largest area (the library or the studio). */
  demo.root = () => {
    let best = null;
    let bestArea = 0;
    for (const r of demo.r3f) {
      if (!r.canvas.isConnected) continue;
      const b = r.canvas.getBoundingClientRect();
      const a = b.width * b.height;
      if (a > bestArea) {
        best = r;
        bestArea = a;
      }
    }
    return best;
  };

  /**
   * Camera pose of the main 3D view: position (m), yaw (0 = looking north / -Z, + turns left,
   * same convention as the app's runtime.yaw), pitch (radians, + up), fov and frame rate estimate.
   */
  demo.pose = () => {
    const r = demo.root();
    if (!r) return null;
    const st = r.store.getState();
    const cam = st.camera;
    if (!cam) return null;
    cam.updateMatrixWorld?.();
    const e = cam.matrixWorld.elements;
    const fx = -e[8];
    const fy = -e[9];
    const fz = -e[10];
    return {
      x: +e[12].toFixed(3),
      y: +e[13].toFixed(3),
      z: +e[14].toFixed(3),
      yaw: +Math.atan2(-fx, -fz).toFixed(4),
      pitch: +Math.asin(Math.max(-1, Math.min(1, fy))).toFixed(4),
      fov: cam.fov,
      size: st.size ? [st.size.width, st.size.height] : null,
      dpr: st.viewport?.dpr,
    };
  };

  /**
   * The local player's avatar group (its position is the app's runtime.x/y/z, its rotation.y the
   * facing). Found once through the R3F fiber tree: the <Avatar> rendered by LocalPlayer is the
   * only one with both `headRef` and `faceHead` props. Returns { x, y, z, facing } or null (title screen: the
   * avatar is there too, standing at the spawn).
   */
  let playerGroup = null;
  demo.player = () => {
    const r = demo.root();
    if (!r || !r.fiber) return null;
    if (!playerGroup || !playerGroup.parent) {
      playerGroup = null;
      const stack = [r.fiber.current];
      let n = 0;
      while (stack.length && n++ < 200000) {
        const f = stack.pop();
        if (!f) continue;
        const pr = f.memoizedProps;
        if (
          pr &&
          typeof pr === "object" &&
          "headRef" in pr &&
          "faceHead" in pr &&
          "motion" in pr &&
          "config" in pr
        ) {
          for (let up = f.return; up; up = up.return) {
            // R3F 9 host fibers hold an Instance ({ object, ... }); older ones the object itself.
            const o = up.stateNode && (up.stateNode.object ?? up.stateNode);
            if (o && o.isObject3D && o.type === "Group") {
              playerGroup = o;
              break;
            }
          }
          if (playerGroup) break;
        }
        if (f.sibling) stack.push(f.sibling);
        if (f.child) stack.push(f.child);
      }
    }
    if (!playerGroup) return null;
    const p = playerGroup.position;
    return {
      x: +p.x.toFixed(3),
      y: +p.y.toFixed(3),
      z: +p.z.toFixed(3),
      facing: +playerGroup.rotation.y.toFixed(4),
      visible: playerGroup.visible,
    };
  };

  /** Projects a world point to CSS pixels in the main 3D view (null if behind the camera). */
  demo.project = (x, y, z) => {
    const r = demo.root();
    if (!r) return null;
    const { camera, size } = r.store.getState();
    const v = camera.position.clone().set(x, y, z).project(camera);
    if (v.z > 1) return null;
    const b = r.canvas.getBoundingClientRect();
    return { x: b.left + ((v.x + 1) / 2) * size.width, y: b.top + ((1 - v.y) / 2) * size.height };
  };

  /** Measures the page's real animation frame rate over `ms`. */
  demo.fps = (ms = 2000) =>
    new Promise((resolve) => {
      let n = 0;
      const t0 = performance.now();
      const tick = () => {
        n++;
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else resolve(+((n * 1000) / (performance.now() - t0)).toFixed(1));
      };
      requestAnimationFrame(tick);
    });

  // ---- 1. Cursor
  const ARROW =
    '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="36" viewBox="0 0 30 36">' +
    '<path d="M3 2.5 L3 28 L9.6 22.2 L14 32.5 L18.6 30.5 L14.3 20.4 L23 20.4 Z" fill="#ffffff" stroke="#1f1a16" stroke-width="2.4" stroke-linejoin="round"/>' +
    "</svg>";
  const css = `
#__demo_cursor{position:fixed;left:0;top:0;width:30px;height:36px;z-index:2147483647;pointer-events:none;
  transform:translate(-100px,-100px);will-change:transform;filter:drop-shadow(0 2px 2px rgba(0,0,0,.45));transition:opacity .15s}
#__demo_cursor .press{transform-origin:3px 2px;transition:transform .09s ease-out}
#__demo_cursor.down .press{transform:scale(.86)}
.__demo_ripple{position:fixed;z-index:2147483646;pointer-events:none;width:56px;height:56px;margin:-28px 0 0 -28px;border-radius:50%;
  border:4px solid #e07a3f;background:rgba(224,122,63,.22);box-shadow:0 0 0 2px rgba(31,26,22,.7),inset 0 0 0 2px rgba(255,255,255,.55);
  animation:__demo_rip .6s cubic-bezier(.2,.7,.3,1) forwards}
@keyframes __demo_rip{from{transform:scale(.2);opacity:1}60%{opacity:.9}to{transform:scale(1.3);opacity:0}}
#__demo_keys{position:fixed;left:50%;bottom:42px;transform:translateX(-50%);z-index:2147483645;pointer-events:none;display:flex;gap:10px}
.__demo_key{min-width:58px;height:58px;padding:0 16px;border-radius:14px;border:3px solid #1f1a16;background:#fbf3e4;color:#1f1a16;
  font:700 26px/52px ui-rounded,system-ui,sans-serif;text-align:center;box-shadow:0 5px 0 #1f1a16;animation:__demo_key .9s ease-out forwards}
@keyframes __demo_key{0%{transform:translateY(8px);opacity:0}12%{transform:none;opacity:1}75%{opacity:1}100%{opacity:0}}
`;
  let cursorEl = null;
  let keysEl = null;
  const ensure = () => {
    const root = document.documentElement;
    if (!root) return;
    if (!document.getElementById("__demo_style")) {
      const s = document.createElement("style");
      s.id = "__demo_style";
      s.textContent = css;
      (document.head || root).appendChild(s);
    }
    if (!cursorEl || !cursorEl.isConnected) {
      cursorEl = document.getElementById("__demo_cursor") || document.createElement("div");
      cursorEl.id = "__demo_cursor";
      cursorEl.innerHTML = `<div class="press">${ARROW}</div>`;
      // On <html>, outside <body>, so React hydration never touches it.
      root.appendChild(cursorEl);
    }
    if (!keysEl || !keysEl.isConnected) {
      keysEl = document.createElement("div");
      keysEl.id = "__demo_keys";
      root.appendChild(keysEl);
    }
    place();
  };
  const place = () => {
    if (!cursorEl) return;
    cursorEl.style.transform = `translate(${demo.x - 3}px, ${demo.y - 2}px)`;
    const hidden = !demo.cursorVisible || !!document.pointerLockElement || demo.x < 0;
    cursorEl.style.opacity = hidden ? "0" : "1";
  };
  demo.ensure = ensure;
  demo.setCursor = (visible) => {
    demo.cursorVisible = !!visible;
    ensure();
  };
  /** Moves the drawn cursor without a real mouse event (tools call this when jumping). */
  demo.moveCursor = (x, y) => {
    demo.x = x;
    demo.y = y;
    ensure();
  };
  const ripple = (x, y) => {
    const r = document.createElement("div");
    r.className = "__demo_ripple";
    r.style.left = x + "px";
    r.style.top = y + "px";
    document.documentElement.appendChild(r);
    setTimeout(() => r.remove(), 650);
  };
  demo.ripple = ripple;

  const onMove = (e) => {
    if (document.pointerLockElement) return;
    demo.x = e.clientX;
    demo.y = e.clientY;
    if (!cursorEl || !cursorEl.isConnected) ensure();
    else place();
  };
  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("pointermove", onMove, true);
  window.addEventListener(
    "mousedown",
    (e) => {
      if (document.pointerLockElement || !demo.cursorVisible) return;
      cursorEl?.classList.add("down");
      if (e.button === 0) ripple(e.clientX, e.clientY);
    },
    true,
  );
  window.addEventListener("mouseup", () => cursorEl?.classList.remove("down"), true);
  document.addEventListener("pointerlockchange", place, true);

  // ---- 2. Keycast (off by default; tools turn it on with page.keycast(true))
  const LABEL = {
    Enter: "Enter",
    Escape: "Esc",
    " ": "Space",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Shift: "Shift",
    Tab: "Tab",
  };
  let lastKey = "";
  let lastAt = 0;
  window.addEventListener(
    "keydown",
    (e) => {
      if (!demo.keycast) return;
      const t = e.target;
      // Never echo what is typed into a text box, only game keys.
      if (
        t &&
        (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) &&
        e.key !== "Enter" &&
        e.key !== "Escape"
      )
        return;
      const label = LABEL[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : null);
      if (!label) return;
      const now = performance.now();
      if (e.repeat || (label === lastKey && now - lastAt < 700)) return;
      lastKey = label;
      lastAt = now;
      ensure();
      const k = document.createElement("div");
      k.className = "__demo_key";
      k.textContent = label;
      keysEl.appendChild(k);
      while (keysEl.children.length > 4) keysEl.firstChild.remove();
      setTimeout(() => k.remove(), 950);
    },
    true,
  );

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", ensure, { once: true });
  else ensure();
  // Re-attach if something replaces <html>'s children.
  setInterval(() => {
    if (!cursorEl || !cursorEl.isConnected) ensure();
  }, 500);
})();
