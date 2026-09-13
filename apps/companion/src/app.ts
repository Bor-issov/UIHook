import { DEFAULT_EDITOR_CONFIG } from "@uihook/ast-editor";
import { EditHistory, GitClient } from "@uihook/git-engine";
import type { Logger } from "./logger.js";
import { detectProject, findProjectRoot } from "./project/detect.js";
import { Workspace } from "./project/workspace.js";
import { type RunningServer, type ServerOptions, startServer } from "./server.js";
import { Mutex, type Services } from "./services.js";

export interface CompanionOptions extends ServerOptions {
  root: string;
  logger: Logger;
}

export async function startCompanion(options: CompanionOptions): Promise<{ services: Services; server: RunningServer }> {
  const root = await findProjectRoot(options.root);
  const workspace = await Workspace.open(root);
  const git = await GitClient.detect(workspace.root);
  const project = await detectProject(workspace.root, git !== null);
  const services: Services = {
    project,
    workspace,
    history: new EditHistory(workspace, git),
    editor: { ...DEFAULT_EDITOR_CONFIG, tailwind: project.tailwind ?? DEFAULT_EDITOR_CONFIG.tailwind },
    logger: options.logger,
    mutex: new Mutex(),
  };
  const server = await startServer(services, options);
  return { services, server };
}
