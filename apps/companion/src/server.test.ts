import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ClientMessage, ObservedBox, ServerMessage } from "@uihook/protocol";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startCompanion } from "./app.js";
import { silentLogger } from "./logger.js";

const ORIGIN = "chrome-extension://dkaiipifgcpinbcifdkfgilclkjdmkom";
const FIREFOX_ORIGIN = "moz-extension://9096d939-9e7f-4a10-b2e5-b2437dc0f17d";
const TOKEN = "test-token-0123456789abcdef";
const CARD = `export function Card() {\n  return (\n    <div className="flex p-6 gap-4">\n      <h2 className="text-lg">Budget</h2>\n    </div>\n  );\n}\n`;

const observed: ObservedBox = {
  paddingTop: 24, paddingRight: 24, paddingBottom: 24, paddingLeft: 24,
  marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
  rowGap: 16, columnGap: 16,
  borderTopLeftRadius: 0, borderTopRightRadius: 0, borderBottomRightRadius: 0, borderBottomLeftRadius: 0,
};

let root: string;
let port: number;
let close: () => Promise<void>;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "uihook-app-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo", devDependencies: { vite: "^8", tailwindcss: "^4" } }));
  writeFileSync(path.join(root, "src/Card.tsx"), CARD);
  const started = await startCompanion({ root, port: 0, token: TOKEN, allowedOrigins: [ORIGIN, FIREFOX_ORIGIN], logger: silentLogger });
  port = started.server.port;
  close = started.server.close;
});

afterAll(() => close());

class Client {
  private readonly queue: ServerMessage[] = [];
  private waiters: ((m: ServerMessage) => void)[] = [];
  private seq = 0;

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      const waiter = this.waiters.shift();
      if (waiter) waiter(message);
      else this.queue.push(message);
    });
  }

  static async connect(options: { origin?: string; host?: string } = {}) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
      origin: options.origin ?? ORIGIN,
      headers: options.host ? { host: options.host } : {},
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
      socket.once("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
    return new Client(socket);
  }

  /** Sends a request and waits for its reply, skipping unrelated broadcasts. */
  async request<T extends ClientMessage["type"]>(type: T, payload: Extract<ClientMessage, { type: T }>["payload"]): Promise<ServerMessage> {
    const id = `m${++this.seq}`;
    this.socket.send(JSON.stringify({ v: 1, id, type, payload }));
    for (;;) {
      const message = this.queue.shift() ?? (await new Promise<ServerMessage>((r) => this.waiters.push(r)));
      if ("replyTo" in message && message.replyTo === id) return message;
    }
  }

  closed() {
    return new Promise<number>((resolve) => this.socket.once("close", (code) => resolve(code)));
  }
}

async function authed() {
  const client = await Client.connect();
  const ready = await client.request("session.hello", { token: TOKEN, client: "test" });
  expect(ready.type).toBe("session.ready");
  return client;
}

const selection = {
  source: { file: "src/Card.tsx", line: 3, column: 5 },
  component: "Card",
  element: { tag: "div", classes: ["flex", "p-6", "gap-4"] },
  rect: { x: 0, y: 0, width: 400, height: 200 },
  styles: { paddingTop: "24px" },
  instanceCount: 1,
  ancestors: [],
  pageUrl: "http://localhost:5173/",
};

describe("connection security", () => {
  it("rejects foreign origins before the upgrade", async () => {
    await expect(Client.connect({ origin: "http://evil.example" })).rejects.toThrow("HTTP 403");
    await expect(Client.connect({ origin: "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })).rejects.toThrow("HTTP 403");
  });

  it("rejects Firefox origins that were not explicitly allowlisted", async () => {
    await expect(Client.connect({ origin: "moz-extension://00000000-0000-4000-8000-000000000000" })).rejects.toThrow("HTTP 403");
  });

  it("accepts an allowlisted Firefox extension origin", async () => {
    const client = await Client.connect({ origin: FIREFOX_ORIGIN });
    const ready = await client.request("session.hello", { token: TOKEN, client: "firefox" });
    expect(ready.type).toBe("session.ready");
    client.socket.close();
  });

  it("rejects non-loopback Host headers (DNS rebinding)", async () => {
    await expect(Client.connect({ host: `attacker.example:${port}` })).rejects.toThrow("HTTP 403");
  });

  it("closes connections that send a wrong token", async () => {
    const client = await Client.connect();
    const closed = client.closed();
    const reply = await client.request("session.hello", { token: "wrong-token-0123456789", client: "test" });
    expect(reply).toMatchObject({ type: "error", payload: { code: "unauthorized" } });
    expect(await closed).toBe(4401);
  });

  it("closes connections that skip authentication", async () => {
    const client = await Client.connect();
    const closed = client.closed();
    client.socket.send(JSON.stringify({ v: 1, id: "x", type: "history.list", payload: {} }));
    expect(await closed).toBe(4401);
  });

  it("refuses forbidden paths from page-supplied metadata", async () => {
    const client = await authed();
    const reply = await client.request("element.context.request", { selection: { ...selection, source: { file: "node_modules/x/index.js", line: 1, column: 1 } } });
    expect(reply).toMatchObject({ type: "error", payload: { code: "forbidden_path" } });
    client.socket.close();
  });
});

describe("visual edit loop", () => {
  it("context -> edit -> diff -> undo restores the source", async () => {
    const client = await authed();

    const context = await client.request("element.context.request", { selection });
    expect(context.type).toBe("element.context.response");
    if (context.type !== "element.context.response") return;
    expect(context.payload).toMatchObject({
      component: "Card",
      openingTag: `<div className="flex p-6 gap-4">`,
      className: { kind: "static", classes: ["flex", "p-6", "gap-4"] },
      styling: { tailwind: "v4" },
    });
    expect(context.payload.snippet.lines.join("\n")).toContain("Budget");

    const edit = await client.request("edit.visual.request", {
      source: selection.source,
      tag: "div",
      expectedHash: context.payload.hash,
      changes: [{ property: "padding", px: 16 }],
      observed,
    });
    expect(edit.type).toBe("edit.visual.result");
    if (edit.type !== "edit.visual.result" || edit.payload.status !== "applied") throw new Error(JSON.stringify(edit));
    expect(readFileSync(path.join(root, "src/Card.tsx"), "utf8")).toBe(CARD.replace("p-6", "p-4"));
    expect(edit.payload.session.instruction).toBe("<div> padding 24px -> 16px (p-6 -> p-4)");
    expect(edit.payload.session.files).toEqual([{ file: "src/Card.tsx", additions: 1, deletions: 1 }]);

    const stale = await client.request("edit.visual.request", {
      source: selection.source, tag: "div", expectedHash: context.payload.hash, changes: [{ property: "padding", px: 8 }], observed,
    });
    expect(stale).toMatchObject({ type: "error", payload: { code: "stale_source" } });

    const diff = await client.request("git.diff.request", { sessionId: edit.payload.session.id });
    expect(diff.type === "git.diff.response" && diff.payload.patch).toContain('+    <div className="flex p-4 gap-4">');

    const undo = await client.request("history.undo", { sessionId: edit.payload.session.id });
    expect(undo).toMatchObject({ type: "history.state", payload: { sessions: [{ status: "undone" }] } });
    expect(readFileSync(path.join(root, "src/Card.tsx"), "utf8")).toBe(CARD);
    client.socket.close();
  });

  it("routes unsupported edits to the agent without touching the file", async () => {
    const client = await authed();
    const context = await client.request("element.context.request", { selection });
    if (context.type !== "element.context.response") throw new Error("no context");
    const edit = await client.request("edit.visual.request", {
      source: selection.source, tag: "div", expectedHash: context.payload.hash, changes: [{ property: "padding", px: 16 }], observed: { ...observed, paddingTop: 40 },
    });
    expect(edit).toMatchObject({ type: "edit.visual.result", payload: { status: "unsupported", routeToAgent: true } });
    expect(readFileSync(path.join(root, "src/Card.tsx"), "utf8")).toBe(CARD);
    client.socket.close();
  });
});
