import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { nodeProcessRunner, type ProcessRunner } from "../process.js";
import type { AgentDetection, AgentRunEvent, CodingAgent } from "../types.js";
import { clip } from "../urls.js";
import { streamJsonl, text, versionOf } from "./shared.js";

/** auto_edit: file edits are approved, shell tools are not available in non-interactive runs. */
export function geminiRunArgs(prompt: string): string[] {
  return ["--output-format", "stream-json", "--approval-mode", "auto_edit", "-p", prompt];
}

export function parseGeminiEvent(value: Record<string, unknown>, state: { summary?: string; error?: string; ok?: boolean }): AgentRunEvent[] {
  switch (value.type) {
    case "init":
      return [{ kind: "status", text: `Gemini session started${text(value.model) ? ` (${value.model})` : ""}` }];
    case "message": {
      const content = text(value.content) ?? text(value.text);
      if (!content?.trim() || (value.role && value.role !== "assistant" && value.role !== "model")) return [];
      state.summary = content;
      return [{ kind: "message", text: clip(content, 8000) }];
    }
    case "tool_use": {
      const params = (value.parameters ?? {}) as Record<string, unknown>;
      const detail = text(params.file_path) ?? text(params.absolute_path) ?? text(params.path);
      return [{ kind: "tool", name: clip(text(value.tool_name) ?? "tool", 200), ...(detail ? { detail: clip(detail, 1000) } : {}) }];
    }
    case "error":
      return [{ kind: "log", text: clip(`${text(value.severity) ?? "error"}: ${text(value.message) ?? ""}`, 2000) }];
    case "result": {
      state.ok = value.status === "success";
      if (!state.ok) state.error = text((value.error as Record<string, unknown> | undefined)?.message) ?? "Gemini run failed";
      return [];
    }
    default:
      return [];
  }
}

export interface GeminiEnvironment {
  home: string;
  env: NodeJS.ProcessEnv;
}

/** Reads only whether credentials exist, never their contents. */
export function detectGeminiAuth({ home, env }: GeminiEnvironment): Pick<AgentDetection, "auth" | "authDetail"> {
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) return { auth: "logged_in", authDetail: "API key from environment" };
  const dir = path.join(home, ".gemini");
  let selected: string | undefined;
  try {
    const settings = JSON.parse(readFileSync(path.join(dir, "settings.json"), "utf8")) as { security?: { auth?: { selectedType?: string } }; selectedAuthType?: string };
    selected = settings.security?.auth?.selectedType ?? settings.selectedAuthType;
  } catch {
    // no settings yet
  }
  if (selected === "oauth-personal") {
    return existsSync(path.join(dir, "oauth_creds.json")) ? { auth: "logged_in", authDetail: "Login with Google" } : { auth: "logged_out", authDetail: "Google login expired or missing" };
  }
  if (selected === "vertex-ai" || selected === "compute-default-credentials") return { auth: "unknown", authDetail: `configured for ${selected}` };
  if (selected === "gemini-api-key") return { auth: "logged_out", authDetail: "GEMINI_API_KEY is not set in the companion environment" };
  return { auth: "logged_out" };
}

export function createGeminiAgent(runner: ProcessRunner = nodeProcessRunner, environment: GeminiEnvironment = { home: os.homedir(), env: process.env }): CodingAgent {
  return {
    id: "gemini",
    name: "Gemini CLI",
    installHint: "npm install -g @google/gemini-cli",
    loginMethod: {
      kind: "manual",
      instructions: "Run `gemini` in a terminal, choose \"Login with Google\" and finish in the browser, then check again. Alternatively start the companion with GEMINI_API_KEY set.",
    },

    async detect() {
      const version = await runner.exec("gemini", ["--version"]);
      if (version.spawnError || version.code !== 0) return { installed: false, auth: "unknown" };
      return { installed: true, ...(versionOf(version.stdout) ? { version: versionOf(version.stdout)! } : {}), ...detectGeminiAuth(environment) };
    },

    run({ prompt, cwd, signal }) {
      const proc = runner.spawn("gemini", geminiRunArgs(prompt), { cwd, signal });
      return streamJsonl(proc, parseGeminiEvent, signal);
    },
  };
}
