import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface GitFileState {
  /** Two-letter porcelain v1 status, e.g. " M", "??". */
  code: string;
}

/**
 * Thin wrapper over the git CLI. Arguments are always passed as arrays (no shell), and paths are
 * reported relative to the project root rather than the repository top level.
 */
export class GitClient {
  private constructor(
    readonly projectRoot: string,
    readonly topLevel: string,
  ) {}

  static async detect(projectRoot: string): Promise<GitClient | null> {
    try {
      const { stdout } = await run("git", ["rev-parse", "--show-toplevel"], { cwd: projectRoot });
      return new GitClient(path.resolve(projectRoot), stdout.trim());
    } catch {
      return null;
    }
  }

  async head(): Promise<string | null> {
    try {
      const { stdout } = await this.git(["rev-parse", "--verify", "HEAD"]);
      return stdout.trim();
    } catch {
      return null;
    }
  }

  /** Status of files under the project root, keyed by project-relative path. */
  async status(): Promise<Map<string, GitFileState>> {
    const { stdout } = await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
    const result = new Map<string, GitFileState>();
    const entries = stdout.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      if (entry.length < 4) continue;
      const code = entry.slice(0, 2);
      const file = this.toProjectPath(entry.slice(3));
      // Renames and copies are followed by the original path as a separate entry.
      if (code[0] === "R" || code[0] === "C") i++;
      if (file) result.set(file, { code });
    }
    return result;
  }

  private toProjectPath(repoPath: string): string | null {
    const relative = path.relative(this.projectRoot, path.join(this.topLevel, repoPath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
    return relative.split(path.sep).join("/");
  }

  private git(args: string[]) {
    return run("git", args, { cwd: this.projectRoot, maxBuffer: 32 * 1024 * 1024 });
  }
}
