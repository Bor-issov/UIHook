import { builtInAgents, type CodingAgent, nodeProcessRunner, type ProcessRunner } from "@uihook/agent-sdk";
import { DEFAULT_EDITOR_CONFIG } from "@uihook/ast-editor";
import { EditHistory, GitClient } from "@uihook/git-engine";
import { LoginManager } from "./agents/login.js";
import { AgentRegistry } from "./agents/registry.js";
import { AgentRunManager } from "./agents/runs.js";
import { Hub } from "./hub.js";
import type { Logger } from "./logger.js";
import { detectProject, findProjectRoot } from "./project/detect.js";
import { projectFileLister } from "./project/files.js";
import { Workspace } from "./project/workspace.js";
import { type RunningServer, type ServerOptions, startServer } from "./server.js";
import { Mutex, type Services } from "./services.js";

export interface CompanionOptions extends ServerOptions {
  root: string;
  logger: Logger;
  /** Agent adapters; defaults to Claude Code, Codex and Gemini CLI. */
  agents?: CodingAgent[];
  processRunner?: ProcessRunner;
}

export async function startCompanion(options: CompanionOptions): Promise<{ services: Services; server: RunningServer }> {
  const root = await findProjectRoot(options.root);
  const workspace = await Workspace.open(root, "source");
  const projectWorkspace = await Workspace.open(root, "project");
  const git = await GitClient.detect(workspace.root);
  const project = await detectProject(workspace.root, git !== null);
  const processRunner = options.processRunner ?? nodeProcessRunner;
  const hub = new Hub();
  const registry = new AgentRegistry(options.agents ?? builtInAgents(processRunner));

  const partial: Omit<Services, "logins" | "runs"> = {
    project,
    workspace,
    projectWorkspace,
    projectFiles: projectFileLister(projectWorkspace, git !== null),
    git,
    history: new EditHistory(projectWorkspace, git),
    editor: { ...DEFAULT_EDITOR_CONFIG, tailwind: project.tailwind ?? DEFAULT_EDITOR_CONFIG.tailwind },
    logger: options.logger,
    mutex: new Mutex(),
    hub,
    processRunner,
    registry,
  };
  const services = partial as Services;
  services.logins = new LoginManager(registry, processRunner, hub, options.logger);
  services.runs = new AgentRunManager(services);

  const server = await startServer(services, options);
  return {
    services,
    server: {
      port: server.port,
      close: async () => {
        services.logins.dispose();
        services.runs.dispose();
        await services.runs.whenIdle();
        await server.close();
      },
    },
  };
}
