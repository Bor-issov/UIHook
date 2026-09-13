import { constants } from "node:fs";
import { lstat, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileAccess } from "@uihook/git-engine";

export class ForbiddenPathError extends Error {
  override name = "ForbiddenPathError";
}

const SOURCE_EXTENSIONS = new Set([".tsx", ".jsx", ".ts", ".js", ".mjs", ".cjs", ".mts", ".cts", ".css", ".scss", ".mdx"]);
const DENIED_SEGMENTS = new Set(["node_modules", ".git", ".hg", ".svn", "dist", ".next", ".uihook"]);
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/**
 * Confines every file operation to the project root. Paths from the browser are untrusted: they are
 * validated lexically, restricted to source extensions, and checked again after resolving symlinks.
 */
export class Workspace implements FileAccess {
  private constructor(readonly root: string) {}

  static async open(root: string): Promise<Workspace> {
    return new Workspace(await realpath(path.resolve(root)));
  }

  /** Validates a project-relative path and returns its absolute location. */
  async resolve(file: string): Promise<string> {
    if (typeof file !== "string" || file.length === 0 || file.length > 1024 || file.includes("\0")) {
      throw new ForbiddenPathError("invalid path");
    }
    if (path.isAbsolute(file) || /^[a-zA-Z]:/.test(file) || file.includes("\\")) {
      throw new ForbiddenPathError("path must be project-relative and use forward slashes");
    }
    const segments = file.split("/");
    if (segments.some((s) => s === ".." || s === "." || s === "")) throw new ForbiddenPathError("path traversal is not allowed");
    if (segments.some((s) => DENIED_SEGMENTS.has(s) || s.startsWith("."))) {
      throw new ForbiddenPathError(`access to ${file} is not allowed`);
    }
    if (!SOURCE_EXTENSIONS.has(path.extname(file))) throw new ForbiddenPathError(`${path.extname(file) || "extensionless"} files are not editable`);

    const absolute = path.join(this.root, ...segments);
    this.assertInside(absolute);

    // Resolve symlinks on the deepest existing ancestor so links cannot escape the root.
    let probe = absolute;
    for (;;) {
      try {
        const real = await realpath(probe);
        this.assertInside(real);
        break;
      } catch (error) {
        if (error instanceof ForbiddenPathError) throw error;
        const parent = path.dirname(probe);
        if (parent === probe) throw new ForbiddenPathError("path resolution failed");
        probe = parent;
      }
    }
    return absolute;
  }

  async read(file: string): Promise<string | null> {
    const absolute = await this.resolve(file);
    try {
      const stat = await lstat(absolute);
      if (!stat.isFile()) throw new ForbiddenPathError(`${file} is not a regular file`);
      if (stat.size > MAX_FILE_BYTES) throw new ForbiddenPathError(`${file} is too large`);
      return await readFile(absolute, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async write(file: string, content: string): Promise<void> {
    const absolute = await this.resolve(file);
    if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new ForbiddenPathError(`${file} would be too large`);
    try {
      // O_NOFOLLOW: never write through a symlink swapped in after validation.
      const handle = await open(absolute, constants.O_WRONLY | constants.O_TRUNC | constants.O_NOFOLLOW);
      try {
        await handle.writeFile(content, "utf8");
      } finally {
        await handle.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await writeFile(absolute, content, { encoding: "utf8", flag: "wx" });
    }
  }

  async remove(file: string): Promise<void> {
    const absolute = await this.resolve(file);
    await rm(absolute, { force: true });
  }

  private assertInside(candidate: string) {
    const relative = path.relative(this.root, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new ForbiddenPathError("path escapes the project root");
  }
}
