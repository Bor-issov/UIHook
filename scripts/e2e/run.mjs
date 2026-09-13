// Shared E2E suite. Usage: node scripts/e2e/run.mjs [--browser chromium|firefox|all] [--headed]
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { launchWithExtension } from "./browsers.mjs";
import { REPO, startEnvironment } from "./environment.mjs";
import { agentScenario, visualEditScenario } from "./scenario.mjs";

const { values } = parseArgs({ options: { browser: { type: "string", default: "all" }, headed: { type: "boolean", default: false } } });
const browsers = values.browser === "all" ? ["chromium", "firefox"] : [values.browser];
const artifacts = process.env.E2E_ARTIFACTS ?? mkdtempSync(path.join(tmpdir(), "uihook-e2e-artifacts-"));
const TOKEN = "e2e-token-0123456789abcdefghij";

const results = [];
for (const name of browsers) {
  const log = (msg) => console.log(`\x1b[36m[e2e:${name}]\x1b[0m ${msg}`);
  const assert = (condition, message) => {
    if (!condition) throw new Error(`assertion failed: ${message}`);
    console.log(`  \x1b[32mok\x1b[0m ${message}`);
  };
  let env;
  let browser;
  try {
    env = await startEnvironment({ token: TOKEN, companionEntry: path.join(REPO, "scripts/e2e/fake-agent-companion.ts") });
    log(`vite ${env.appUrl}, companion :${env.companionPort}`);
    browser = await launchWithExtension(name, path.join(REPO, "apps/extension"), { headless: !values.headed });
    log(`extension ${browser.extensionId} at ${browser.extensionOrigin}`);
    const { app, panel } = await visualEditScenario({ browser, env, token: TOKEN, artifacts, assert, log });
    await agentScenario({ browser, env, app, panel, assert, log });
    results.push([name, "PASS"]);
  } catch (error) {
    console.error(error);
    if (env) console.error(`[e2e:${name}] companion log tail:\n${env.companionLog.join("").split("\n").slice(-15).join("\n")}`);
    results.push([name, "FAIL"]);
  } finally {
    await browser?.close().catch(() => undefined);
    await env?.close();
  }
}

console.log(`\nartifacts: ${artifacts}`);
for (const [name, status] of results) console.log(`${status === "PASS" ? "\x1b[32m" : "\x1b[31m"}${status}\x1b[0m ${name}`);
process.exit(results.every(([, status]) => status === "PASS") ? 0 : 1);
