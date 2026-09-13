import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { ProjectFileLister } from "@uihook/git-engine";
import type { Workspace } from "./workspace.js";

const run = promisify(execFile);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".uihook", ".turbo", "coverage", "out"]);

/**
 * Files an agent transaction snapshots: Git's view (tracked + untracked, respecting .gitignore) when
 * available, otherwise a filtered walk. Each path is re-validated by the project workspace policy.
 */
export function projectFileLister(workspace: Workspace, git: boolean): ProjectFileLister {
  return {
    async list() {
      const files = git ? await gitFiles(workspace.root) : await walk(workspace.root);
      const allowed: string[] = [];
      for (const file of files) {
        try {
          await workspace.resolve(file);
          allowed.push(file);
        } catch {
          // denied by policy (env files, build output, ...)
        }
      }
      return allowed;
    },
  };
}

async function gitFiles(root: string): Promise<string[]> {
  const { stdout } = await run("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "."], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  return stdout.split("\0").filter(Boolean);
}

async function walk(root: string, dir = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const relative = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) files.push(...(await walk(root, relative)));
    } else if (entry.isFile()) {
      files.push(relative);
    }
  }
  return files;
}
