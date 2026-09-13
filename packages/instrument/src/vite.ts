import path from "node:path";
import type { Plugin } from "vite";
import { instrumentJsx } from "./instrument.js";

export interface UIHookViteOptions {
  /** Directory source paths are made relative to. Defaults to Vite's `root`. Must match the companion root. */
  root?: string;
  /** Additional exclusion test on the absolute module id. node_modules is always excluded. */
  exclude?: (id: string) => boolean;
}

const JSX_FILE = /\.[jt]sx$/;

/**
 * Development-only source metadata injection. `apply: "serve"` guarantees the plugin is never
 * part of a production build, and the mode check covers `vite --mode production` dev servers.
 */
export function uihook(options: UIHookViteOptions = {}): Plugin {
  let root = "";
  let enabled = false;

  return {
    name: "uihook:instrument",
    enforce: "pre",
    apply: "serve",
    configResolved(config) {
      root = path.resolve(options.root ?? config.root);
      enabled = config.command === "serve" && !config.isProduction;
    },
    transform(code, id) {
      if (!enabled) return null;
      const file = id.split("?", 1)[0]!;
      if (!JSX_FILE.test(file) || file.includes("/node_modules/") || options.exclude?.(file)) return null;

      const relative = path.relative(root, file);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return null;

      const result = instrumentJsx(code, { file: relative.split(path.sep).join("/") });
      return result ? { code: result.code, map: result.map } : null;
    },
  };
}

export default uihook;
