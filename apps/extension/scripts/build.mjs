import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import * as esbuild from "esbuild";
import { build as viteBuild } from "vite";
import { FIREFOX_ADDON_ID } from "../../../packages/protocol/src/extension-identity.ts";
import { buildManifest } from "../src/manifest.ts";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { values } = parseArgs({ options: { browser: { type: "string", default: "chrome" }, watch: { type: "boolean", default: false } } });
const browser = values.browser;
if (browser !== "chrome" && browser !== "firefox") throw new Error(`unsupported --browser ${browser}; expected chrome or firefox`);

const outdir = path.join(root, "dist", browser);
const watch = values.watch;
const platformHost = path.join(root, `src/platform/${browser}.ts`);

await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const { key } = JSON.parse(await readFile(path.join(root, "extension-key.json"), "utf8"));
const manifest = buildManifest({ browser, version: pkg.version, chromeKey: key, firefoxAddonId: FIREFOX_ADDON_ID });
await writeFile(path.join(outdir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

const scripts = {
  entryPoints: { content: "src/content/index.ts", background: "src/background/index.ts" },
  absWorkingDir: root,
  outdir,
  bundle: true,
  format: "iife",
  target: browser === "chrome" ? "chrome116" : "firefox142",
  conditions: ["@uihook/source"],
  alias: { "@uihook/platform-host": platformHost },
  define: { __UIHOOK_BROWSER__: JSON.stringify(browser) },
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
};

if (watch) await (await esbuild.context(scripts)).watch();
else await esbuild.build(scripts);

await viteBuild({
  configFile: path.join(root, "vite.sidepanel.config.ts"),
  resolve: { alias: { "@uihook/platform-host": platformHost } },
  define: { __UIHOOK_BROWSER__: JSON.stringify(browser) },
  build: { outDir: outdir, watch: watch ? {} : null, sourcemap: watch },
});

console.log(`\x1b[36m[v0.2] extension - ${browser} build written to ${path.relative(process.cwd(), outdir)}\x1b[0m`);
