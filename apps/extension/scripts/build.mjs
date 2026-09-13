import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import { build as viteBuild } from "vite";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outdir = path.join(root, "dist");
const watch = process.argv.includes("--watch");

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

// The manifest `key` pins the unpacked extension ID the companion allowlists.
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const { key } = JSON.parse(await readFile(path.join(root, "extension-key.json"), "utf8"));
await writeFile(path.join(outdir, "manifest.json"), JSON.stringify({ ...manifest, key }, null, 2));

const scripts = {
  entryPoints: { content: "src/content/index.ts", background: "src/background.ts" },
  absWorkingDir: root,
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome116",
  conditions: ["@uihook/source"],
  sourcemap: "inline",
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(scripts);
  await ctx.watch();
} else {
  await esbuild.build(scripts);
}

await viteBuild({
  configFile: path.join(root, "vite.sidepanel.config.ts"),
  build: { watch: watch ? {} : null },
});

console.log(`[v0.1] extension - built to ${path.relative(process.cwd(), outdir) || "."}`);
