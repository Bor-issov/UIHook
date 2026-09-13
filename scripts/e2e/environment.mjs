// Browser-neutral test environment: temp copy of the demo app, Vite dev server, companion CLI.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

export const REPO = path.resolve(import.meta.dirname, "../..");
const DEMO = path.join(REPO, "examples/react-vite-demo");

export async function startEnvironment({ token, companionEntry = "src/cli.ts", companionArgs = [] }) {
  const cleanups = [];
  const project = mkdtempSync(path.join(tmpdir(), "uihook-e2e-app-"));
  cleanups.push(() => rmSync(project, { recursive: true, force: true }));
  for (const entry of ["src", "index.html", "package.json", "tsconfig.json", "vite.config.ts"]) {
    cpSync(path.join(DEMO, entry), path.join(project, entry), { recursive: true });
  }
  symlinkSync(path.join(DEMO, "node_modules"), path.join(project, "node_modules"));
  await run("git", ["init", "-q"], project);

  const { createServer } = await import(createRequire(path.join(DEMO, "package.json")).resolve("vite"));
  const vite = await createServer({ root: project, configFile: path.join(project, "vite.config.ts"), server: { port: 0, host: "127.0.0.1" }, logLevel: "warn" });
  await vite.listen();
  cleanups.push(() => vite.close());
  const appUrl = `http://127.0.0.1:${vite.httpServer.address().port}/`;

  const companion = spawn(path.join(REPO, "node_modules/.bin/tsx"), ["--conditions=@uihook/source", companionEntry, "--root", project, "--port", "0", "--json", ...companionArgs], {
    cwd: path.join(REPO, "apps/companion"),
    env: { ...process.env, UIHOOK_TOKEN: token },
  });
  const companionLog = [];
  cleanups.push(() => companion.kill());
  const companionPort = await new Promise((resolve, reject) => {
    let buffer = "";
    companion.stdout.on("data", (chunk) => {
      buffer += chunk;
      companionLog.push(String(chunk));
      const match = /"url":"ws:\/\/127\.0\.0\.1:(\d+)"/.exec(buffer);
      if (match) resolve(Number(match[1]));
    });
    companion.stderr.on("data", (chunk) => process.stderr.write(chunk));
    companion.on("exit", (code) => reject(new Error(`companion exited with ${code}: ${buffer}`)));
  });

  return {
    project,
    appUrl,
    companionPort,
    companionLog,
    read: (file) => readFileSync(path.join(project, file), "utf8"),
    close: async () => {
      for (const cleanup of cleanups.reverse()) await Promise.resolve().then(cleanup).catch(() => undefined);
    },
  };
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    spawn(cmd, args, { cwd, stdio: "ignore" }).on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} failed`))));
  });
}
