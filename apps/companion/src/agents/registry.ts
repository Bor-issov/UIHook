import type { CodingAgent } from "@uihook/agent-sdk";
import type { AgentInfo } from "@uihook/protocol";
import { RequestError } from "../errors.js";

const CACHE_MS = 5_000;

export class AgentRegistry {
  private cache: { at: number; agents: AgentInfo[] } | null = null;

  constructor(private readonly agents: readonly CodingAgent[]) {}

  get(id: string): CodingAgent {
    const agent = this.agents.find((a) => a.id === id);
    if (!agent) throw new RequestError("agent_unavailable", `unknown agent ${id}`);
    return agent;
  }

  async list({ fresh = false } = {}): Promise<AgentInfo[]> {
    if (!fresh && this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.agents;
    const agents = await Promise.all(this.agents.map((agent) => this.describe(agent)));
    this.cache = { at: Date.now(), agents };
    return agents;
  }

  async info(id: string, options?: { fresh?: boolean }): Promise<AgentInfo> {
    const info = (await this.list(options)).find((a) => a.id === id);
    if (!info) throw new RequestError("agent_unavailable", `unknown agent ${id}`);
    return info;
  }

  invalidate() {
    this.cache = null;
  }

  private async describe(agent: CodingAgent): Promise<AgentInfo> {
    const detection = await agent.detect().catch((error: unknown) => ({ installed: false, auth: "unknown" as const, authDetail: `detection failed: ${(error as Error).message}` }));
    return {
      id: agent.id,
      name: agent.name,
      installed: detection.installed,
      ...("version" in detection && detection.version ? { version: detection.version } : {}),
      ...(detection.installed ? {} : { installHint: agent.installHint }),
      auth: detection.auth,
      ...(detection.authDetail ? { authDetail: detection.authDetail } : {}),
      login: agent.loginMethod,
    };
  }
}
