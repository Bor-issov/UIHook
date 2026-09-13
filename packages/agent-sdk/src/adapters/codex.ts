import { nodeProcessRunner, type ProcessRunner } from "../process.js";
import type { AgentRunEvent, CodingAgent } from "../types.js";
import { clip } from "../urls.js";
import { streamJsonl, text, versionOf } from "./shared.js";

/** workspace-write: edits confined to the project, shell commands sandboxed without network. */
export function codexRunArgs(cwd: string): string[] {
  return ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "--color", "never", "-C", cwd, "-"];
}

export function parseCodexEvent(value: Record<string, unknown>, state: { summary?: string; error?: string; ok?: boolean }): AgentRunEvent[] {
  switch (value.type) {
    case "thread.started":
      return [{ kind: "status", text: "Codex session started" }];
    case "item.started":
    case "item.completed": {
      const item = (value.item ?? {}) as Record<string, unknown>;
      if (item.type === "agent_message" && value.type === "item.completed" && text(item.text)?.trim()) {
        state.summary = item.text as string;
        return [{ kind: "message", text: clip(item.text as string, 8000) }];
      }
      if (item.type === "command_execution" && value.type === "item.started") {
        return [{ kind: "tool", name: "shell", detail: clip(text(item.command) ?? "", 1000) }];
      }
      if (item.type === "file_change" && value.type === "item.completed") {
        const changes = Array.isArray(item.changes) ? (item.changes as Record<string, unknown>[]).map((c) => text(c.path)).filter(Boolean) : [];
        return [{ kind: "tool", name: "edit", detail: clip(changes.join(", "), 1000) }];
      }
      return [];
    }
    case "turn.completed":
      state.ok ??= true;
      return [];
    case "turn.failed":
    case "error": {
      state.ok = false;
      const error = (value.error ?? {}) as Record<string, unknown>;
      state.error = text(error.message) ?? text(value.message) ?? "Codex run failed";
      return [{ kind: "log", text: clip(state.error, 2000) }];
    }
    default:
      return [];
  }
}

export function createCodexAgent(runner: ProcessRunner = nodeProcessRunner): CodingAgent {
  return {
    id: "codex",
    name: "Codex",
    installHint: "npm install -g @openai/codex",
    loginMethod: { kind: "command", label: "Log in with ChatGPT", display: "codex login" },
    loginCommand: { command: "codex", args: ["login"] },

    async detect() {
      const version = await runner.exec("codex", ["--version"]);
      if (version.spawnError || version.code !== 0) return { installed: false, auth: "unknown" };
      const base = { installed: true, ...(versionOf(version.stdout) ? { version: versionOf(version.stdout)! } : {}) };
      const status = await runner.exec("codex", ["login", "status"]);
      const output = `${status.stdout}\n${status.stderr}`.trim();
      if (status.code === 0 && /logged in/i.test(output) && !/not logged in/i.test(output)) {
        return { ...base, auth: "logged_in", authDetail: clip(output.split("\n")[0]!, 200) };
      }
      if (/not logged in/i.test(output) || status.code === 1) return { ...base, auth: "logged_out" };
      return { ...base, auth: "unknown", authDetail: clip(output || "login status unavailable", 200) };
    },

    run({ prompt, cwd, signal }) {
      const proc = runner.spawn("codex", codexRunArgs(cwd), { cwd, stdin: prompt, signal });
      return streamJsonl(proc, parseCodexEvent, signal);
    },
  };
}
