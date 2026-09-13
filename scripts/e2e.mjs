// End-to-end check of the first vertical slice in a real Chromium with the unpacked extension:
// select element -> source location -> padding edit -> TSX changes -> HMR -> diff -> undo.
// Runs against a temporary copy of examples/react-vite-demo so the repository is never modified.
import { spawn } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const demo = path.join(repo, "examples/react-vite-demo");
const extensionDir = path.join(repo, "apps/extension/dist");
const { id: EXTENSION_ID } = JSON.parse(readFileSync(path.join(repo, "apps/extension/extension-key.json"), "utf8"));
const TOKEN = "e2e-token-0123456789abcdefghij";
const CARD = "src/components/budgets/BudgetCard.tsx";
const OVERVIEW = "src/components/budgets/BudgetOverview.tsx";
const artifacts = process.env.E2E_ARTIFACTS ?? mkdtempSync(path.join(tmpdir(), "uihook-e2e-artifacts-"));

const log = (msg) => console.log(`\x1b[36m[e2e]\x1b[0m ${msg}`);
const cleanups = [];

async function main() {
  // 1. Isolated project copy with its own git repository.
  const project = mkdtempSync(path.join(tmpdir(), "uihook-e2e-app-"));
  cleanups.push(() => rmSync(project, { recursive: true, force: true }));
  for (const entry of ["src", "index.html", "package.json", "tsconfig.json", "vite.config.ts"]) {
    cpSync(path.join(demo, entry), path.join(project, entry), { recursive: true });
  }
  symlinkSync(path.join(demo, "node_modules"), path.join(project, "node_modules"));
  await run("git", ["init", "-q"], project);
  const original = readFileSync(path.join(project, CARD), "utf8");

  // 2. Vite dev server (programmatic, ephemeral port).
  const { createServer } = await import(createRequire(path.join(demo, "package.json")).resolve("vite"));
  const vite = await createServer({
    root: project,
    configFile: path.join(project, "vite.config.ts"),
    server: { port: 0, host: "127.0.0.1" },
    logLevel: "warn",
  });
  await vite.listen();
  cleanups.push(() => vite.close());
  const appUrl = `http://127.0.0.1:${vite.httpServer.address().port}/`;
  log(`vite ready at ${appUrl}`);

  // 3. Companion as a real CLI process.
  const companion = spawn(
    path.join(repo, "node_modules/.bin/tsx"),
    ["--conditions=@uihook/source", "src/cli.ts", "--root", project, "--port", "0", "--json"],
    { cwd: path.join(repo, "apps/companion"), env: { ...process.env, UIHOOK_TOKEN: TOKEN } },
  );
  cleanups.push(() => companion.kill());
  const companionPort = await new Promise((resolve, reject) => {
    let buffer = "";
    companion.stdout.on("data", (chunk) => {
      buffer += chunk;
      const match = /"url":"ws:\/\/127\.0\.0\.1:(\d+)"/.exec(buffer);
      if (match) resolve(Number(match[1]));
    });
    companion.stderr.on("data", (chunk) => process.stderr.write(chunk));
    companion.on("exit", (code) => reject(new Error(`companion exited with ${code}: ${buffer}`)));
  });
  log(`companion ready on port ${companionPort}`);

  // 4. Chromium with the unpacked extension.
  const userDataDir = mkdtempSync(path.join(tmpdir(), "uihook-e2e-profile-"));
  cleanups.push(() => rmSync(userDataDir, { recursive: true, force: true }));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: process.env.HEADED !== "1",
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  cleanups.push(() => context.close());
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  assert(extensionId === EXTENSION_ID, `extension id ${extensionId} matches pinned key`);

  const app = await context.newPage();
  const pageErrors = [];
  app.on("pageerror", (error) => pageErrors.push(error.message));
  await app.goto(appUrl);
  const card = app.locator("article").first();
  await card.waitFor();
  assert((await card.getAttribute("data-uihook-src")) === `${CARD}:16:5`, "article carries injected source metadata");

  const tabId = await worker.evaluate(async (url) => (await chrome.tabs.query({ url: `${url}*` }))[0]?.id, appUrl);
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 1400 });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);

  // 5. Pair with the companion.
  await panel.getByLabel("Port").fill(String(companionPort));
  await panel.getByLabel("Token").fill(TOKEN);
  await panel.getByRole("button", { name: "Connect" }).click();
  await panel.getByTestId("connection").filter({ hasText: "react-vite-demo" }).waitFor();
  log("panel connected");

  // 6. Select the first budget card with trusted pointer input.
  await panel.getByRole("button", { name: "Start editing" }).click();
  await app.bringToFront();
  await clickAt(app, card, 10, 10);
  await panel.getByTestId("location").filter({ hasText: `${CARD}:16` }).waitFor();
  assert((await panel.getByTestId("padding").textContent()) === "24px", "panel shows computed padding 24px");
  assert((await panel.getByTestId("classes").textContent()).includes("p-6"), "panel shows source classes");
  log("selection resolved to source");

  // 7. Deterministic padding edit.
  const padding = panel.getByLabel("Padding", { exact: true });
  await padding.fill("16");
  await padding.press("Enter");
  await panel.getByTestId("notice").filter({ hasText: "p-6 -> p-4" }).waitFor();
  const edited = readFileSync(path.join(project, CARD), "utf8");
  assert(edited === original.replace("rounded-xl bg-charcoal-raised p-6", "rounded-xl bg-charcoal-raised p-4"), "TSX source changed exactly p-6 -> p-4");
  await app.waitForFunction(() => getComputedStyle(document.querySelector("article")).paddingTop === "16px", null, { timeout: 10_000 });
  assert(true, "HMR applied padding 16px in the page");
  await panel.getByTestId("padding").filter({ hasText: /^16px$/ }).waitFor({ timeout: 10_000 });
  assert(true, "panel refreshed selection after HMR");

  const diff = panel.getByTestId("diff");
  await diff.waitFor();
  const patch = await diff.textContent();
  assert(patch.includes('+    <article className={cn("flex flex-col gap-6 rounded-xl bg-charcoal-raised p-4"'), "diff shows the added line");
  assert(patch.includes('-    <article className={cn("flex flex-col gap-6 rounded-xl bg-charcoal-raised p-6"'), "diff shows the removed line");
  await app.screenshot({ path: path.join(artifacts, "app-edited.png") });
  await panel.screenshot({ path: path.join(artifacts, "panel-edited.png"), fullPage: true });

  // 8. Undo restores the source byte for byte.
  await panel.getByTestId("history-item").first().getByRole("button", { name: "Undo" }).click();
  await panel.locator('[data-testid="history-item"][data-status="undone"]').waitFor();
  assert(readFileSync(path.join(project, CARD), "utf8") === original, "undo restored the original source");
  await app.waitForFunction(() => getComputedStyle(document.querySelector("article")).paddingTop === "24px", null, { timeout: 10_000 });
  await panel.getByTestId("padding").filter({ hasText: /^24px$/ }).waitFor({ timeout: 10_000 });
  assert(true, "page and panel reflect the restored padding");

  // 9. Element without padding classes: a class is appended to the existing string.
  await panel.getByRole("button", { name: "Stop editing" }).click();
  await panel.getByRole("button", { name: "Start editing" }).click();
  await app.bringToFront();
  const grid = app.locator("section > div.grid");
  const gridBox = await grid.boundingBox();
  await clickAt(app, grid, gridBox.width - 2, 2);
  await panel.getByTestId("classes").filter({ hasText: "sm:grid-cols-2" }).waitFor();
  await padding.fill("12");
  await padding.press("Enter");
  await panel.getByTestId("notice").filter({ hasText: "+p-3" }).waitFor();
  assert(
    readFileSync(path.join(project, OVERVIEW), "utf8").includes('className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 p-3"'),
    "padding class appended to an element without padding",
  );
  await panel.screenshot({ path: path.join(artifacts, "panel-final.png"), fullPage: true });

  assert(pageErrors.length === 0, `no page errors ${pageErrors.join("; ")}`);
  log(`screenshots in ${artifacts}`);
}

async function clickAt(page, locator, dx, dy) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + dx - 2, box.y + dy - 2);
  await page.mouse.move(box.x + dx, box.y + dy);
  await page.mouse.click(box.x + dx, box.y + dy);
}

function assert(condition, message) {
  if (!condition) throw new Error(`assertion failed: ${message}`);
  console.log(`  \x1b[32mok\x1b[0m ${message}`);
}

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    spawn(cmd, args, { cwd, stdio: "ignore" }).on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} failed`))));
  });
}

try {
  await main();
  log("PASS");
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const cleanup of cleanups.reverse()) await Promise.resolve().then(cleanup).catch(() => undefined);
  process.exit(process.exitCode ?? 0);
}
