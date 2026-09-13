import { createClaudeAgent } from "./adapters/claude.js";
import { createCodexAgent } from "./adapters/codex.js";
import { createGeminiAgent } from "./adapters/gemini.js";
import { nodeProcessRunner, type ProcessRunner } from "./process.js";
import type { CodingAgent } from "./types.js";

export type { AgentDetection, AgentDone, AgentRunEvent, AgentTask, CodingAgent, LoginCommand } from "./types.js";
export { agentEnvironment, nodeProcessRunner, type ExecResult, type ProcessLine, type ProcessRunner, type RunningProcess, type SpawnOptions } from "./process.js";
export { extractLoginUrls, clip } from "./urls.js";
export { claudeRunArgs, createClaudeAgent, parseClaudeEvent, CLAUDE_ALLOWED_TOOLS, CLAUDE_DENIED_TOOLS } from "./adapters/claude.js";
export { codexRunArgs, createCodexAgent, parseCodexEvent } from "./adapters/codex.js";
export { createGeminiAgent, detectGeminiAuth, geminiRunArgs, parseGeminiEvent } from "./adapters/gemini.js";

export function builtInAgents(runner: ProcessRunner = nodeProcessRunner): CodingAgent[] {
  return [createClaudeAgent(runner), createCodexAgent(runner), createGeminiAgent(runner)];
}
