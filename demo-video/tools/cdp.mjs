// Minimal Chrome DevTools Protocol client over Node's built-in WebSocket (Node 22+).
// One browser-level connection; pages are attached as flat sessions (Target.attachToTarget
// with flatten:true), so several pages (and browser contexts) share one socket.
//
//   const conn = await CDP.connect(port);
//   const r = await conn.send("Target.getTargets");
//   const sid = (await conn.send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
//   await conn.send("Runtime.evaluate", { expression: "1+1" }, sid);
//   conn.on("Page.screencastFrame", (params, sessionId) => { ... });

export class CDP {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 0;
    this.pending = new Map();
    this.listeners = new Map(); // method -> Set<fn(params, sessionId)>
    this.closed = false;
    ws.onmessage = (m) => this.#onMessage(m.data);
    ws.onclose = () => {
      this.closed = true;
      for (const { reject, method } of this.pending.values())
        reject(new Error(`CDP socket closed during ${method}`));
      this.pending.clear();
      this.#emit("__close", {}, undefined);
    };
  }

  static async connect(port = 9555, host = "127.0.0.1") {
    const deadline = Date.now() + 20000;
    let info;
    while (!info) {
      try {
        info = await (await fetch(`http://${host}:${port}/json/version`)).json();
      } catch (e) {
        if (Date.now() > deadline) throw new Error(`No Chrome on port ${port}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 200));
      }
    }
    const ws = new WebSocket(info.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      ws.onopen = res;
      ws.onerror = (e) => rej(new Error(`WebSocket error: ${e.message ?? e}`));
    });
    const c = new CDP(ws);
    c.version = info;
    c.port = port;
    return c;
  }

  #onMessage(data) {
    const msg = JSON.parse(typeof data === "string" ? data : Buffer.from(data).toString("utf8"));
    if (msg.id !== undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error)
        p.reject(
          new Error(
            `${p.method}: ${msg.error.message}${msg.error.data ? " " + msg.error.data : ""}`,
          ),
        );
      else p.resolve(msg.result);
    } else if (msg.method) {
      this.#emit(msg.method, msg.params, msg.sessionId);
    }
  }

  #emit(method, params, sessionId) {
    const set = this.listeners.get(method);
    if (set)
      for (const fn of [...set]) {
        try {
          fn(params, sessionId);
        } catch (e) {
          console.error(`listener for ${method} threw:`, e);
        }
      }
  }

  /** Sends a command; `sessionId` targets an attached page. Rejects after `timeoutMs`. */
  send(method, params = {}, sessionId, timeoutMs = 60000) {
    if (this.closed) return Promise.reject(new Error(`CDP closed (${method})`));
    const id = ++this.nextId;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.ws.send(JSON.stringify(msg));
    });
  }

  /** Subscribes to an event; returns an unsubscribe function. */
  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set());
    this.listeners.get(method).add(fn);
    return () => this.listeners.get(method)?.delete(fn);
  }

  /** Resolves with the first event matching `pred` (optionally for one session). */
  once(method, { sessionId, pred = () => true, timeoutMs = 30000 } = {}) {
    return new Promise((resolve, reject) => {
      const off = this.on(method, (params, sid) => {
        if (sessionId && sid !== sessionId) return;
        if (!pred(params)) return;
        off();
        clearTimeout(timer);
        resolve(params);
      });
      const timer = setTimeout(() => {
        off();
        reject(new Error(`Timed out waiting for ${method}`));
      }, timeoutMs);
    });
  }

  close() {
    try {
      this.ws.close();
    } catch {}
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
