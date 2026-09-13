import { clip, extractLoginUrls, type ProcessRunner, type RunningProcess } from "@uihook/agent-sdk";
import { RequestError } from "../errors.js";
import type { Hub } from "../hub.js";
import type { Logger } from "../logger.js";
import type { AgentRegistry } from "./registry.js";

const LOGIN_TIMEOUT_MS = 10 * 60_000;
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
/** CSI sequences (colors, cursor) and OSC sequences (terminal hyperlinks, titles). */
const ANSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]|${ESC}\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)`, "g");

/**
 * Runs a provider's own login command (fixed argv from the adapter, never from the client) and relays
 * its output. The companion never sees credentials: the CLI stores them in its usual location.
 */
export class LoginManager {
  private readonly active = new Map<string, RunningProcess>();

  constructor(
    private readonly registry: AgentRegistry,
    private readonly runner: ProcessRunner,
    private readonly hub: Hub,
    private readonly logger: Logger,
  ) {}

  start(agentId: string): string {
    const agent = this.registry.get(agentId);
    if (!agent.loginCommand || agent.loginMethod.kind !== "command") {
      throw new RequestError("bad_request", `${agent.name} login is manual: ${agent.loginMethod.kind === "manual" ? agent.loginMethod.instructions : ""}`);
    }
    if (this.active.has(agentId)) return `${agent.name} login already in progress`;

    const { command, args } = agent.loginCommand;
    const proc = this.runner.spawn(command, args, { interactive: true });
    this.active.set(agentId, proc);
    this.logger.info("agent.login.start", { agent: agentId, command: [command, ...args].join(" ") });
    const timer = setTimeout(() => proc.kill(), LOGIN_TIMEOUT_MS);

    void (async () => {
      for await (const { line } of proc.lines) {
        const clean = line.replace(ANSI, "").trim();
        if (!clean) continue;
        const [url] = extractLoginUrls(clean);
        this.hub.broadcast("agent.login.progress", { agentId, state: "running", line: clip(clean, 2000), ...(url ? { url } : {}) });
      }
      const { code, spawnError } = await proc.exit;
      clearTimeout(timer);
      const cancelled = this.active.get(agentId) !== proc;
      if (!cancelled) this.active.delete(agentId);
      this.registry.invalidate();
      const agents = await this.registry.list({ fresh: true });
      const loggedIn = agents.find((a) => a.id === agentId)?.auth === "logged_in";
      const state = cancelled ? "cancelled" : loggedIn ? "succeeded" : "failed";
      this.logger.info("agent.login.end", { agent: agentId, code, state, ...(spawnError ? { spawnError } : {}) });
      this.hub.broadcast("agent.login.progress", {
        agentId,
        state,
        agents,
        ...(state === "failed" ? { line: spawnError ? `could not start ${command}: ${spawnError}` : `login exited with code ${code}` } : {}),
      });
    })();

    return `Started \`${[command, ...args].join(" ")}\`. Complete the sign-in in your browser.`;
  }

  /** Forwards a line (e.g. an authorization code the CLI asks for) to the running login process. */
  input(agentId: string, text: string) {
    const proc = this.active.get(agentId);
    if (!proc) throw new RequestError("bad_request", "no login in progress");
    proc.write(text.replace(/[\r\n]+/g, " ").trim());
  }

  cancel(agentId: string) {
    const proc = this.active.get(agentId);
    if (!proc) return;
    this.active.delete(agentId);
    proc.kill();
  }

  dispose() {
    for (const proc of this.active.values()) proc.kill();
    this.active.clear();
  }
}
