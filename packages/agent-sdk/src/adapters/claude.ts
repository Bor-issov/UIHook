import type { AgentEvent } from "@uihook/protocol";
import { nodeProcessRunner, type ProcessRunner } from "../process.js";
import type { AgentRunEvent, CodingAgent } from "../types.js";
import { clip } from "../urls.js";
import { streamJsonl, text, versionOf } from "./shared.js";

/** File tools only. Shell and network tools are denied so page-derived context cannot trigger commands. */
export const CLAUDE_ALLOWED_TOOLS = ["Read", "Edit", "MultiEdit", "Write", "Glob", "Grep", "LS"];
export const CLAUDE_DENIED_TOOLS = ["Bash", "WebFetch", "WebSearch", "Task", "NotebookEdit"];

export function claudeRunArgs(): string[] {
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--permission-mode", "acceptEdits",
    "--allowedTools", CLAUDE_ALLOWED_TOOLS.join(","),
    "--disallowedTools", CLAUDE_DENIED_TOOLS.join(","),
  ];
}

export function parseClaudeEvent(value: Record<string, unknown>, state: { summary?: string; error?: string; ok?: boolean }): AgentRunEvent[] {
  switch (value.type) {
    case "system":
      return value.subtype === "init" ? [{ kind: "status", text: `Claude session started${text(value.model) ? ` (${value.model})` : ""}` }] : [];
    case "assistant": {
      const content = ((value.message as { content?: unknown[] } | undefined)?.content ?? []) as Record<string, unknown>[];
      const events: AgentEvent[] = [];
      for (const block of content) {
        if (block.type === "text" && text(block.text)?.trim()) events.push({ kind: "message", text: clip(block.text as string, 8000) });
        if (block.type === "tool_use") {
          const input = (block.input ?? {}) as Record<string, unknown>;
          const detail = text(input.file_path) ?? text(input.path) ?? text(input.pattern);
          events.push({ kind: "tool", name: clip(text(block.name) ?? "tool", 200), ...(detail ? { detail: clip(detail, 1000) } : {}) });
        }
      }
      return events;
    }
    case "result": {
      state.ok = value.subtype === "success" && value.is_error !== true;
      const result = text(value.result);
      if (state.ok) state.summary = result;
      else state.error = result ?? `Claude run ended with ${String(value.subtype)}`;
      return [];
    }
    default:
      return [];
  }
}

export function createClaudeAgent(runner: ProcessRunner = nodeProcessRunner): CodingAgent {
  return {
    id: "claude",
    name: "Claude Code",
    installHint: "npm install -g @anthropic-ai/claude-code",
    loginMethod: { kind: "command", label: "Log in with Claude", display: "claude auth login" },
    loginCommand: { command: "claude", args: ["auth", "login"] },

    async detect() {
      const version = await runner.exec("claude", ["--version"]);
      if (version.spawnError || version.code !== 0) return { installed: false, auth: "unknown" };
      const status = await runner.exec("claude", ["auth", "status", "--json"]);
      const base = { installed: true, ...(versionOf(version.stdout) ? { version: versionOf(version.stdout)! } : {}) };
      try {
        const parsed = JSON.parse(status.stdout) as { loggedIn?: boolean; authMethod?: string };
        if (parsed.loggedIn === true) return { ...base, auth: "logged_in", ...(parsed.authMethod ? { authDetail: parsed.authMethod } : {}) };
        if (parsed.loggedIn === false) return { ...base, auth: "logged_out" };
      } catch {
        // fall through
      }
      return { ...base, auth: "unknown", authDetail: clip(status.stderr || status.stdout || "auth status unavailable", 200) };
    },

    run({ prompt, cwd, signal }) {
      const proc = runner.spawn("claude", claudeRunArgs(), { cwd, stdin: prompt, signal });
      return streamJsonl(proc, parseClaudeEvent, signal);
    },
  };
}
