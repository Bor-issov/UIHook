// Minimal Firefox Remote Debugging Protocol client (the protocol behind about:debugging and web-ext).
// Used to install the temporary add-on and to evaluate code inside the add-on's own documents,
// which WebDriver BiDi deliberately does not expose.
import net from "node:net";

export class FirefoxDevtools {
  #socket;
  #inbox = [];
  #waiters = [];
  #buffer = Buffer.alloc(0);
  #root;

  static async connect(port, timeoutMs = 20_000) {
    const client = new FirefoxDevtools();
    client.#socket = await connectWithRetry(port, timeoutMs);
    client.#socket.on("data", (chunk) => client.#onData(chunk));
    await client.#next((p) => p.from === "root" && p.applicationType);
    client.#send({ to: "root", type: "getRoot" });
    client.#root = await client.#next((p) => p.from === "root" && p.addonsActor);
    return client;
  }

  async installTemporaryAddon(addonPath) {
    const actor = this.#root.addonsActor;
    this.#send({ to: actor, type: "installTemporaryAddon", addonPath, openDevTools: false });
    const reply = await this.#next((p) => p.from === actor);
    if (reply.error) throw new Error(`Firefox refused temporary add-on: ${reply.error} ${reply.message ?? ""}`);
    return reply.addon;
  }

  /**
   * Evaluates an async function body inside an add-on document and returns its JSON result.
   * `urlPart` selects the document (e.g. "sidepanel.html"); defaults to the background page.
   */
  async evaluateInAddon(addonId, body, urlPart = "_generated_background_page.html") {
    const target = await this.#addonTarget(addonId, urlPart);
    const consoleActor = target.consoleActor;
    const text = `(async () => { ${body} })().then((value) => JSON.stringify({ ok: true, value }), (error) => JSON.stringify({ ok: false, error: String((error && error.stack) || error) }))`;
    this.#send({ to: consoleActor, type: "evaluateJSAsync", text, mapped: { await: true } });
    const { resultID } = await this.#next((p) => p.from === consoleActor && p.resultID && !p.type);
    const result = await this.#next((p) => p.from === consoleActor && p.type === "evaluationResult" && p.resultID === resultID, 60_000);
    if (result.exceptionMessage) throw new Error(`add-on evaluation threw: ${result.exceptionMessage}`);
    const raw = typeof result.result === "string" ? result.result : result.result?.initial;
    if (typeof raw !== "string") throw new Error(`unexpected evaluation result: ${JSON.stringify(result.result).slice(0, 200)}`);
    const parsed = JSON.parse(raw);
    if (!parsed.ok) throw new Error(`add-on evaluation failed: ${parsed.error}`);
    return parsed.value;
  }

  #targets = new Map();
  #watchers = new Map();

  /** Resolves a frame target (document) of an add-on through the watcher API used by about:debugging. */
  async #addonTarget(addonId, urlPart, timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const known = [...(this.#targets.get(addonId)?.values() ?? [])].find((t) => t.url?.includes(urlPart));
      if (known) return known;
      if (!this.#watchers.has(addonId)) await this.#watch(addonId);
      if (Date.now() > deadline) throw new Error(`no add-on document matching ${urlPart}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  async #watch(addonId) {
    this.#send({ to: "root", type: "listAddons" });
    const { addons } = await this.#next((p) => p.from === "root" && Array.isArray(p.addons));
    const descriptor = addons.find((a) => a.id === addonId);
    if (!descriptor) throw new Error(`add-on ${addonId} not installed`);
    this.#send({ to: descriptor.actor, type: "getWatcher" });
    const watcher = await this.#next((p) => p.from === descriptor.actor && p.actor);
    const targets = new Map();
    this.#targets.set(addonId, targets);
    this.#watchers.set(addonId, watcher.actor);
    this.#listeners.push((p) => {
      if (p.from !== watcher.actor) return false;
      if (p.type === "target-available-form") targets.set(p.target.actor, p.target);
      else if (p.type === "target-destroyed-form") targets.delete(p.target.actor);
      else return false;
      return true;
    });
    this.#send({ to: watcher.actor, type: "watchTargets", targetType: "frame" });
    await this.#next((p) => p.from === watcher.actor && !p.type);
  }

  #listeners = [];

  close() {
    this.#socket?.destroy();
  }

  #consoles = new Map();
  async #addonConsole(addonId) {
    if (this.#consoles.has(addonId)) return this.#consoles.get(addonId);
    this.#send({ to: "root", type: "listAddons" });
    const { addons } = await this.#next((p) => p.from === "root" && Array.isArray(p.addons));
    const descriptor = addons.find((a) => a.id === addonId);
    if (!descriptor) throw new Error(`add-on ${addonId} not installed`);
    this.#send({ to: descriptor.actor, type: "getTarget" });
    const { form } = await this.#next((p) => p.from === descriptor.actor && p.form);
    this.#consoles.set(addonId, form.consoleActor);
    return form.consoleActor;
  }

  #send(packet) {
    if (process.env.DEBUG_RDP) console.error(">>", JSON.stringify(packet).slice(0, 300));
    const body = Buffer.from(JSON.stringify(packet));
    this.#socket.write(`${body.length}:`);
    this.#socket.write(body);
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const colon = this.#buffer.indexOf(":");
      if (colon === -1) return;
      const length = Number(this.#buffer.subarray(0, colon).toString());
      if (this.#buffer.length < colon + 1 + length) return;
      const packet = JSON.parse(this.#buffer.subarray(colon + 1, colon + 1 + length).toString());
      if (process.env.DEBUG_RDP) console.error("<<", JSON.stringify(packet).slice(0, 400));
      this.#buffer = this.#buffer.subarray(colon + 1 + length);
      if (this.#listeners.some((listener) => listener(packet))) continue;
      const index = this.#waiters.findIndex((w) => w.match(packet));
      if (index >= 0) this.#waiters.splice(index, 1)[0].resolve(packet);
      else this.#inbox.push(packet);
    }
  }

  #next(match, timeoutMs = 20_000) {
    return new Promise((resolve, reject) => {
      const queued = this.#inbox.findIndex(match);
      if (queued >= 0) return resolve(this.#inbox.splice(queued, 1)[0]);
      const waiter = { match, resolve: (p) => (clearTimeout(timer), resolve(p)) };
      const timer = setTimeout(() => {
        this.#waiters.splice(this.#waiters.indexOf(waiter), 1);
        reject(new Error("Firefox RDP request timed out"));
      }, timeoutMs);
      this.#waiters.push(waiter);
    });
  }
}

async function connectWithRetry(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.connect(port, "127.0.0.1");
        socket.once("connect", () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (error) {
      if (Date.now() > deadline) throw new Error(`Firefox debugger server not reachable on ${port}: ${error.message}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}
