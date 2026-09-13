import type { EditorConfig } from "@uihook/ast-editor";
import type { EditHistory } from "@uihook/git-engine";
import type { ProjectInfo } from "@uihook/protocol";
import type { Logger } from "./logger.js";
import type { Workspace } from "./project/workspace.js";

/** Explicit dependencies shared by request handlers. No module-level state. */
export interface Services {
  project: ProjectInfo;
  workspace: Workspace;
  history: EditHistory;
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
