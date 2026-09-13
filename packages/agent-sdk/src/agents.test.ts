import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  type AgentRunEvent,
  agentEnvironment,
  createClaudeAgent,
  createCodexAgent,
  createGeminiAgent,
  detectGeminiAuth,
  type ExecResult,
  extractLoginUrls,
  nodeProcessRunner,
  type ProcessRunner,
  type RunningProcess,
} from "./index.js";

/** Fake runner: canned exec results and a scripted JSONL process. */
function fakeRunner(exec: Record<string, Partial<ExecResult>>, stdout: string[] = [], exitCode = 0) {
  const calls: { command: string; args: string[]; stdin?: string; cwd?: string }[] = [];
  const runner: ProcessRunner = {
    async exec(command, args) {
      const key = [command, ...args].join(" ");
      const result = exec[key];
      if (!result) return { code: null, stdout: "", stderr: "", spawnError: "ENOENT" };
      return { code: 0, stdout: "", stderr: "", ...result };
    },
    spawn(command, args, options = {}) {
      calls.push({ command, args, ...(options.stdin !== undefined ? { stdin: options.stdin } : {}), ...(options.cwd ? { cwd: options.cwd } : {}) });
      const proc: RunningProcess = {
        lines: (async function* () {
          for (const line of stdout) yield { stream: "stdout" as const, line };
        })(),
        exit: Promise.resolve({ code: exitCode }),
        write() {},
        kill() {},
      };
      return proc;
    },
  };
  return { runner, calls };
}

async function collect(iterable: AsyncIterable<AgentRunEvent>) {
  const events: AgentRunEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

const signal = new AbortController().signal;

describe("Claude adapter", () => {
  it("detects install and auth via `claude auth status --json`", async () => {
    const { runner } = fakeRunner({ "claude --version": { stdout: "2.1.270 (Claude Code)" }, "claude auth status --json": { stdout: '{"loggedIn": true, "authMethod": "claude.ai"}' } });
    expect(await createClaudeAgent(runner).detect()).toEqual({ installed: true, version: "2.1.270", auth: "logged_in", authDetail: "claude.ai" });
    const out = fakeRunner({ "claude --version": { stdout: "2.1.270" }, "claude auth status --json": { code: 1, stdout: '{"loggedIn": false}' } });
    expect((await createClaudeAgent(out.runner).detect()).auth).toBe("logged_out");
    expect(await createClaudeAgent(fakeRunner({}).runner).detect()).toEqual({ installed: false, auth: "unknown" });
  });

  it("runs headless with file tools only and maps stream-json events", async () => {
    const lines = [
      '{"type":"system","subtype":"hook_started"}',
      '{"type":"system","subtype":"init","model":"claude-opus-5"}',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Tightening the card."},{"type":"tool_use","name":"Edit","input":{"file_path":"src/Card.tsx"}}]}}',
      "not json",
      '{"type":"result","subtype":"success","is_error":false,"result":"Done: reduced padding."}',
    ];
    const { runner, calls } = fakeRunner({}, lines);
    const events = await collect(createClaudeAgent(runner).run({ prompt: "TASK", cwd: "/p", signal }));
    expect(events).toEqual([
      { kind: "status", text: "Claude session started (claude-opus-5)" },
      { kind: "message", text: "Tightening the card." },
      { kind: "tool", name: "Edit", detail: "src/Card.tsx" },
      { kind: "log", text: "not json" },
      { kind: "done", ok: true, summary: "Done: reduced padding." },
    ]);
    expect(calls[0]).toMatchObject({ command: "claude", stdin: "TASK", cwd: "/p" });
    const args = calls[0]!.args.join(" ");
    expect(args).toContain("--permission-mode acceptEdits");
    expect(args).toMatch(/--disallowedTools \S*Bash/);
    expect(args).not.toMatch(/bypassPermissions|dangerously/);
  });

  it("reports error results as failed runs", async () => {
    const { runner } = fakeRunner({}, ['{"type":"result","subtype":"error_max_turns","is_error":true,"result":"hit max turns"}'], 1);
    expect((await collect(createClaudeAgent(runner).run({ prompt: "x", cwd: "/p", signal }))).at(-1)).toEqual({ kind: "done", ok: false, error: "hit max turns" });
  });
});

describe("Codex adapter", () => {
  it("detects login status", async () => {
    const yes = fakeRunner({ "codex --version": { stdout: "codex-cli 0.153.2" }, "codex login status": { stdout: "Logged in using ChatGPT" } });
    expect(await createCodexAgent(yes.runner).detect()).toEqual({ installed: true, version: "0.153.2", auth: "logged_in", authDetail: "Logged in using ChatGPT" });
    const no = fakeRunner({ "codex --version": { stdout: "codex-cli 0.153.2" }, "codex login status": { code: 1, stdout: "Not logged in" } });
    expect((await createCodexAgent(no.runner).detect()).auth).toBe("logged_out");
  });

  it("runs sandboxed exec and maps JSONL items", async () => {
    const lines = [
      '{"type":"thread.started","thread_id":"t"}',
      '{"type":"turn.started"}',
      '{"type":"item.started","item":{"type":"command_execution","command":"rg padding src"}}',
      '{"type":"item.completed","item":{"type":"file_change","changes":[{"path":"src/Card.tsx"}]}}',
      '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Updated the card."}}',
      '{"type":"turn.completed","usage":{}}',
    ];
    const { runner, calls } = fakeRunner({}, lines);
    const events = await collect(createCodexAgent(runner).run({ prompt: "TASK", cwd: "/p", signal }));
    expect(events).toEqual([
      { kind: "status", text: "Codex session started" },
      { kind: "tool", name: "shell", detail: "rg padding src" },
      { kind: "tool", name: "edit", detail: "src/Card.tsx" },
      { kind: "message", text: "Updated the card." },
      { kind: "done", ok: true, summary: "Updated the card." },
    ]);
    expect(calls[0]!.args).toEqual(["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "--color", "never", "-C", "/p", "-"]);
    expect(calls[0]!.stdin).toBe("TASK");
  });

  it("fails on turn.failed", async () => {
    const { runner } = fakeRunner({}, ['{"type":"turn.failed","error":{"message":"usage limit reached"}}']);
    expect((await collect(createCodexAgent(runner).run({ prompt: "x", cwd: "/p", signal }))).at(-1)).toMatchObject({ kind: "done", ok: false, error: "usage limit reached" });
  });
});

describe("Gemini adapter", () => {
  it("detects auth from environment or ~/.gemini without reading credentials", () => {
    const home = mkdtempSync(path.join(tmpdir(), "gemini-home-"));
    expect(detectGeminiAuth({ home, env: {} }).auth).toBe("logged_out");
    expect(detectGeminiAuth({ home, env: { GEMINI_API_KEY: "k" } })).toEqual({ auth: "logged_in", authDetail: "API key from environment" });
    mkdirSync(path.join(home, ".gemini"));
    writeFileSync(path.join(home, ".gemini/settings.json"), JSON.stringify({ security: { auth: { selectedType: "oauth-personal" } } }));
    expect(detectGeminiAuth({ home, env: {} }).auth).toBe("logged_out");
    writeFileSync(path.join(home, ".gemini/oauth_creds.json"), "{}");
    expect(detectGeminiAuth({ home, env: {} })).toEqual({ auth: "logged_in", authDetail: "Login with Google" });
  });

  it("uses manual login and maps stream-json events", async () => {
    const lines = [
      '{"type":"init","model":"gemini-3-pro"}',
      '{"type":"tool_use","tool_name":"replace","parameters":{"file_path":"src/Card.tsx"}}',
      '{"type":"message","role":"assistant","content":"Done."}',
      '{"type":"result","status":"success","stats":{}}',
    ];
    const { runner, calls } = fakeRunner({}, lines);
    const agent = createGeminiAgent(runner, { home: "/nonexistent", env: {} });
    expect(agent.loginMethod.kind).toBe("manual");
    expect(agent.loginCommand).toBeUndefined();
    const events = await collect(agent.run({ prompt: "TASK", cwd: "/p", signal }));
    expect(events.at(-1)).toEqual({ kind: "done", ok: true, summary: "Done." });
    expect(events[1]).toEqual({ kind: "tool", name: "replace", detail: "src/Card.tsx" });
    expect(calls[0]!.args).toEqual(["--output-format", "stream-json", "--approval-mode", "auto_edit", "-p", "TASK"]);
  });
});

describe("login URL allowlist", () => {
  it("surfaces only https provider URLs", () => {
    expect(extractLoginUrls("Open https://claude.ai/oauth/authorize?code=true&x=1 to continue")).toEqual(["https://claude.ai/oauth/authorize?code=true&x=1"]);
    expect(extractLoginUrls("visit https://auth.openai.com/oauth/authorize?client_id=a")).toHaveLength(1);
    expect(extractLoginUrls("http://claude.ai/x https://evil.example/claude.ai https://claude.ai.evil.com/")).toEqual([]);
  });
});

describe("node process runner", () => {
  it("strips companion secrets from agent environments", () => {
    expect(agentEnvironment({ UIHOOK_TOKEN: "secret", HOME: "/h", PATH: "/bin" })).toEqual({ HOME: "/h", PATH: "/bin" });
  });

  it("streams stdout lines, feeds stdin and does not leak UIHOOK_ variables", async () => {
    process.env.UIHOOK_TOKEN = "must-not-leak";
    const script = 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.stringify({got:s,token:process.env.UIHOOK_TOKEN??null}));console.error("warn")})';
    const proc = nodeProcessRunner.spawn(process.execPath, ["-e", script], { stdin: "hello" });
    const lines = [];
    for await (const line of proc.lines) lines.push(line);
    delete process.env.UIHOOK_TOKEN;
    expect(lines).toContainEqual({ stream: "stdout", line: '{"got":"hello","token":null}' });
    expect(lines).toContainEqual({ stream: "stderr", line: "warn" });
    expect((await proc.exit).code).toBe(0);
  });

  it("kills the process on abort", async () => {
    const controller = new AbortController();
    const proc = nodeProcessRunner.spawn(process.execPath, ["-e", "setInterval(() => console.log('tick'), 50)"], { signal: controller.signal });
    setTimeout(() => controller.abort(), 150);
    for await (const _ of proc.lines) void _;
    expect((await proc.exit).code).not.toBe(0);
  });

  it("reports missing binaries", async () => {
    const result = await nodeProcessRunner.exec("uihook-definitely-not-installed", []);
    expect(result.spawnError).toBeTruthy();
  });
});
