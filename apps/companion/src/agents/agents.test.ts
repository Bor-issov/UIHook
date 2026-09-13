import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentRunEvent, CodingAgent, ProcessRunner, RunningProcess } from "@uihook/agent-sdk";
import type { ClientMessage, ObservedBox, ServerMessage } from "@uihook/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startCompanion } from "../app.js";
import { silentLogger } from "../logger.js";

const ORIGIN = "chrome-extension://dkaiipifgcpinbcifdkfgilclkjdmkom";
const TOKEN = "test-token-0123456789abcdef";
const ESC = String.fromCharCode(27);
const CARD = `export function Card() {\n  return (\n    <div className="flex p-6 gap-4">\n      <h2 className="text-lg">Budget</h2>\n    </div>\n  );\n}\n`;

const selection = {
  source: { file: "src/Card.tsx", line: 3, column: 5 },
  component: "Card",
  element: { tag: "div", classes: ["flex", "p-6", "gap-4"], text: "Budget" },
  rect: { x: 0, y: 0, width: 400, height: 200 },
  styles: { paddingTop: "24px" },
  instanceCount: 1,
  ancestors: [],
  pageUrl: "http://localhost:5173/",
};

/** Fake agent that edits files through plain fs, like a real CLI would. */
function fakeAgent(root: () => string, options: { auth?: "logged_in" | "logged_out"; gate?: Promise<void>; prompts?: string[] } = {}): CodingAgent {
  return {
    id: "fake",
    name: "Fake Agent",
    installHint: "n/a",
    loginMethod: { kind: "command", label: "Log in", display: "fake login" },
    loginCommand: { command: "fake", args: ["login"] },
    detect: async () => ({ installed: true, version: "1.0.0", auth: options.auth ?? "logged_in" }),
    async *run({ prompt, cwd, signal }): AsyncIterable<AgentRunEvent> {
      options.prompts?.push(prompt);
      yield { kind: "status", text: "thinking" };
      if (options.gate) await Promise.race([options.gate, new Promise((r) => signal.addEventListener("abort", r))]);
      expect(cwd).toBe(root());
      const file = path.join(cwd, "src/Card.tsx");
      writeFileSync(file, readFileSync(file, "utf8").replace("p-6 gap-4", "p-3 gap-2"));
      writeFileSync(path.join(cwd, "src/CardHeader.tsx"), "export const CardHeader = () => null;\n");
      yield { kind: "tool", name: "Edit", detail: "src/Card.tsx" };
      if (signal.aborted) return yield { kind: "done", ok: false, error: "cancelled" };
      yield { kind: "done", ok: true, summary: "Made the card denser." };
    },
  };
}

class Client {
  readonly messages: ServerMessage[] = [];
  private listeners: (() => void)[] = [];
  private seq = 0;

  constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      this.messages.push(JSON.parse(data.toString()) as ServerMessage);
      for (const listener of [...this.listeners]) listener();
    });
  }

  static async connect(port: number) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin: ORIGIN });
    await new Promise((resolve, reject) => socket.once("open", resolve).once("error", reject));
    const client = new Client(socket);
    await client.request("session.hello", { token: TOKEN, client: "test" });
    return client;
  }

  waitFor(predicate: (m: ServerMessage) => boolean, timeoutMs = 5000): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const found = this.messages.find(predicate);
        if (!found) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== check);
        resolve(found);
      };
      const timer = setTimeout(() => reject(new Error(`timeout; got ${this.messages.map((m) => m.type).join(",")}`)), timeoutMs);
      this.listeners.push(check);
      check();
    });
  }

  request<T extends ClientMessage["type"]>(type: T, payload: Extract<ClientMessage, { type: T }>["payload"]) {
    const id = `m${++this.seq}`;
    this.socket.send(JSON.stringify({ v: 1, id, type, payload }));
    return this.waitFor((m) => "replyTo" in m && m.replyTo === id);
  }
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(agentFactory: (root: () => string) => CodingAgent, processRunner?: ProcessRunner) {
  const root = mkdtempSync(path.join(tmpdir(), "uihook-agent-"));
  mkdirSync(path.join(root, "src"));
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "demo", devDependencies: { vite: "^8", tailwindcss: "^4" } }));
  writeFileSync(path.join(root, "src/Card.tsx"), CARD);
  writeFileSync(path.join(root, ".env"), "SECRET=1\n");
  let realRoot = root;
  const { server, services } = await startCompanion({
    root,
    port: 0,
    token: TOKEN,
    allowedOrigins: [ORIGIN],
    logger: silentLogger,
    agents: [agentFactory(() => realRoot)],
    ...(processRunner ? { processRunner } : {}),
  });
  realRoot = services.workspace.root;
  const client = await Client.connect(server.port);
  cleanups.push(() => server.close(), () => client.socket.close());
  return { root, client, services };
}

const zeroBox = Object.fromEntries(
  ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "marginTop", "marginRight", "marginBottom", "marginLeft", "rowGap", "columnGap", "borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"].map((k) => [k, 0]),
) as ObservedBox;

type Payload<T extends ServerMessage["type"]> = Extract<ServerMessage, { type: T }>["payload"];

describe("agent editing over the protocol", () => {
  it("lists agents with auth state", async () => {
    const { client } = await setup((root) => fakeAgent(root));
    const reply = await client.request("agent.list", {});
    expect(reply).toMatchObject({ type: "agent.list.response", payload: { agents: [{ id: "fake", installed: true, auth: "logged_in", login: { kind: "command" } }] } });
  });

  it("runs an agent with a structured task, records a session and undoes it", async () => {
    const prompts: string[] = [];
    const { root, client } = await setup((r) => fakeAgent(r, { prompts }));
    const accepted = await client.request("edit.agent.request", { agentId: "fake", instruction: "Make this card denser.", selection });
    expect(accepted.type).toBe("edit.agent.accepted");
    const { runId } = accepted.payload as Payload<"edit.agent.accepted">;

    const result = (await client.waitFor((m) => m.type === "edit.agent.result")).payload as Payload<"edit.agent.result">;
    expect(result).toMatchObject({ runId, agentId: "fake", status: "applied", summary: "Made the card denser." });
    expect(result.session!.files.map((f) => f.file)).toEqual(["src/Card.tsx", "src/CardHeader.tsx"]);
    const kinds = client.messages.filter((m) => m.type === "edit.agent.progress").map((m) => (m.payload as Payload<"edit.agent.progress">).event.kind);
    expect(kinds).toEqual(["status", "status", "status", "tool"]);
    expect(prompts[0]).toContain("## USER REQUEST\n\nMake this card denser.");
    expect(prompts[0]).toContain('<div className="flex p-6 gap-4">');

    const undo = await client.request("history.undo", { sessionId: result.session!.id });
    expect(undo.type).toBe("history.state");
    expect(readFileSync(path.join(root, "src/Card.tsx"), "utf8")).toBe(CARD);
    expect(() => readFileSync(path.join(root, "src/CardHeader.tsx"))).toThrow();
    expect(readFileSync(path.join(root, ".env"), "utf8")).toBe("SECRET=1\n");
  });

  it("rejects visual edits and second runs while an agent is running, and supports cancel", async () => {
    let release = () => undefined as void;
    const gate = new Promise<void>((r) => (release = r));
    const { client } = await setup((r) => fakeAgent(r, { gate }));
    const accepted = await client.request("edit.agent.request", { agentId: "fake", instruction: "x", selection });
    const { runId } = accepted.payload as Payload<"edit.agent.accepted">;
    await client.waitFor((m) => m.type === "edit.agent.progress" && (m.payload as Payload<"edit.agent.progress">).event.kind === "status" && "text" in (m.payload as Payload<"edit.agent.progress">).event && ((m.payload as Payload<"edit.agent.progress">).event as { text: string }).text === "thinking");

    const context = await client.request("element.context.request", { selection });
    const { hash } = context.payload as Payload<"element.context.response">;
    const visual = await client.request("edit.visual.request", { source: selection.source, tag: "div", expectedHash: hash, changes: [{ property: "padding", px: 8 }], observed: zeroBox });
    expect(visual).toMatchObject({ type: "error", payload: { code: "busy" } });
    expect(await client.request("edit.agent.request", { agentId: "fake", instruction: "y", selection })).toMatchObject({ type: "error", payload: { code: "busy" } });

    expect((await client.request("edit.agent.cancel", { runId })).type).toBe("ok");
    release();
    const result = await client.waitFor((m) => m.type === "edit.agent.result");
    expect(result.payload).toMatchObject({ status: "cancelled" });
  });

  it("refuses runs for logged-out or unknown agents", async () => {
    const { client } = await setup((r) => fakeAgent(r, { auth: "logged_out" }));
    expect(await client.request("edit.agent.request", { agentId: "fake", instruction: "x", selection })).toMatchObject({ type: "error", payload: { code: "agent_unavailable" } });
    expect(await client.request("edit.agent.request", { agentId: "nope", instruction: "x", selection })).toMatchObject({ type: "error", payload: { code: "agent_unavailable" } });
  });

  it("starts the provider login command and relays allowlisted URLs and completion", async () => {
    let loggedIn = false;
    const spawned: string[][] = [];
    const runner: ProcessRunner = {
      exec: async () => ({ code: 0, stdout: "", stderr: "" }),
      spawn(command, args): RunningProcess {
        spawned.push([command, ...args]);
        return {
          lines: (async function* () {
            yield { stream: "stdout" as const, line: `${ESC}[1mOpen https://claude.ai/oauth/authorize?code=abc to sign in${ESC}[0m` };
            yield { stream: "stdout" as const, line: "Or visit https://evil.example/phish" };
            loggedIn = true;
          })(),
          exit: Promise.resolve({ code: 0 }),
          write() {},
          kill() {},
        };
      },
    };
    const { client } = await setup((r) => ({ ...fakeAgent(r), detect: async () => ({ installed: true, auth: loggedIn ? "logged_in" : "logged_out" }) }), runner);
    const started = await client.request("agent.login.start", { agentId: "fake" });
    expect(started.type).toBe("agent.login.started");
    expect(spawned).toEqual([["fake", "login"]]);
    const done = await client.waitFor((m) => m.type === "agent.login.progress" && (m.payload as Payload<"agent.login.progress">).state !== "running");
    expect(done.payload).toMatchObject({ state: "succeeded", agents: [{ id: "fake", auth: "logged_in" }] });
    const progress = client.messages.filter((m) => m.type === "agent.login.progress").map((m) => m.payload as Payload<"agent.login.progress">);
    expect(progress[0]).toEqual({ agentId: "fake", state: "running", line: "Open https://claude.ai/oauth/authorize?code=abc to sign in", url: "https://claude.ai/oauth/authorize?code=abc" });
    expect(progress[1]!.url).toBeUndefined();
  });
});
