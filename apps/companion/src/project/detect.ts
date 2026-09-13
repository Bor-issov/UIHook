import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { ProjectInfo } from "@uihook/protocol";

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Walks up from `start` to the nearest directory containing package.json. */
export async function findProjectRoot(start: string): Promise<string> {
  let dir = path.resolve(start);
  for (;;) {
    try {
      await access(path.join(dir, "package.json"));
      return dir;
    } catch {
      const parent = path.dirname(dir);
      if (parent === dir) throw new Error(`no package.json found above ${start}`);
      dir = parent;
    }
  }
}

export async function detectProject(root: string, hasGit: boolean): Promise<ProjectInfo> {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as PackageJson;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const framework = deps.next ? "next" : deps.vite ? "vite" : "unknown";
  return {
    name: pkg.name ?? path.basename(root),
    framework,
    tailwind: tailwindVersion(deps.tailwindcss),
    git: hasGit,
  };
}

function tailwindVersion(range: string | undefined): ProjectInfo["tailwind"] {
  if (!range) return null;
  const major = /(\d+)/.exec(range)?.[1];
  if (major === "3") return "v3";
  return "v4";
}
