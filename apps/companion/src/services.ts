import type { EditorConfig } from "@uihook/ast-editor";
import type { ProcessRunner } from "@uihook/agent-sdk";
import type { EditHistory, GitClient, ProjectFileLister } from "@uihook/git-engine";
import type { ProjectInfo } from "@uihook/protocol";
import type { Logger } from "./logger.js";
import type { LoginManager } from "./agents/login.js";
import type { AgentRegistry } from "./agents/registry.js";
import type { AgentRunManager } from "./agents/runs.js";
import type { Hub } from "./hub.js";
import type { Workspace } from "./project/workspace.js";

/** Explicit dependencies shared by request handlers. No module-level state. */
export interface Services {
  project: ProjectInfo;
  /** Browser-facing file access (source policy). */
  workspace: Workspace;
  /** Companion-internal file access used by edit history (project policy). */
  projectWorkspace: Workspace;
  projectFiles: ProjectFileLister;
  git: GitClient | null;
  history: EditHistory;
  hub: Hub;
  processRunner: ProcessRunner;
  registry: AgentRegistry;
  logins: LoginManager;
  runs: AgentRunManager;
  editor: EditorConfig;
  logger: Logger;
  /** Serialises source mutations so concurrent requests cannot interleave writes. */
  mutex: Mutex;
}

export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
