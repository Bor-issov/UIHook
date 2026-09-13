import type { AgentAuthState, AgentEvent, AgentLoginMethod } from "@uihook/protocol";

export interface AgentDetection {
  installed: boolean;
  version?: string;
  auth: AgentAuthState;
  authDetail?: string;
}

export interface AgentTask {
  prompt: string;
  /** Project root; the agent must not work outside it. */
  cwd: string;
  signal: AbortSignal;
}

/** Terminal event of a run. Everything before it is progress. */
export interface AgentDone {
  kind: "done";
  ok: boolean;
  summary?: string;
  error?: string;
}

export type AgentRunEvent = AgentEvent | AgentDone;

export interface LoginCommand {
  command: string;
  args: string[];
}

/**
 * A local coding agent CLI. Adapters never handle credentials: they ask the provider's CLI for its
 * auth state and start the provider's own login flow.
 */
export interface CodingAgent {
  id: string;
  name: string;
  installHint: string;
  loginMethod: AgentLoginMethod;
  /** Present when `loginMethod.kind === "command"`. */
  loginCommand?: LoginCommand;
  detect(): Promise<AgentDetection>;
  run(task: AgentTask): AsyncIterable<AgentRunEvent>;
}
