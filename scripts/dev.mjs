// One-command development loop.
//   pnpm dev:chrome   pnpm dev:firefox
// Starts: extension watch build + companion + demo app (reused if already running) + browser.
// Flags: --no-launch  --root <project dir>  --app-url <url>
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { parseArgs } from "node:util";

const REPO = path.resolve(import.meta.dirname, "..");
const { values } = parseArgs({
  options: {
    browser: { type: "string" },
    launch: { type: "boolean", default: true },
    "no-launch": { type: "boolean", default: false },
    root: { type: "string", default: path.join(REPO, "examples/react-vite-demo") },
    "app-url": { type: "string", default: "http://localhost:5173/" },
  },
});
const browser = values.browser;
if (browser !== "chrome" && browser !== "firefox") fail("usage: node scripts/dev.mjs --browser chrome|firefox");
const launch = values.launch && !values["no-launch"];
const COLORS = { extension: 35, companion: 36, demo: 33, browser: 32, dev: 34 };
const children = [];

const say = (tag, line) => process.stdout.write(`\x1b[${COLORS[tag]}m[${tag}]\x1b[0m ${line}\n`);
function fail(message) {
  console.error(`\x1b[31m[dev] ${message}\x1b[0m`);
  process.exit(1);
}

function run(tag, command, args, options = {}) {
  const child = spawn(command, args, { cwd: REPO, env: { ...process.env, FORCE_COLOR: "1", ...options.env }, stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  for (const stream of [child.stdout, child.stderr]) {
    let buffer = "";
    stream.on("data", (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        say(tag, line);
        options.onLine?.(line);
      }
    });
  }
  child.on("exit", (code) => code && code !== 143 && say(tag, `exited with code ${code}`));
  child.on("error", (error) => say(tag, `\x1b[31mfailed to start ${command}: ${error.message}\x1b[0m`));
  return child;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1");
    socket.once("connect", () => (socket.destroy(), resolve(true)));
    socket.once("error", () => resolve(false));
  });
}

// Stable per-checkout dev token so the extension only needs pairing once per browser profile.
function devToken() {
  const dir = path.join(REPO, ".uihook");
  const file = path.join(dir, "dev-token");
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, `${randomBytes(24).toString("base64url")}\n`, { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

const shutdown = () => {
  for (const child of children) child.kill("SIGTERM");
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => children.forEach((child) => child.kill("SIGTERM")));

say("dev", `[v0.2] dev:${browser} - starting`);

if (!existsSync(path.join(REPO, "packages/instrument/dist/vite.js"))) {
  say("dev", "building workspace packages (first run)");
  if (spawnSync("pnpm", ["build:packages"], { cwd: REPO, stdio: "inherit" }).status !== 0) fail("package build failed");
}

const token = devToken();
run("companion", path.join(REPO, "node_modules/.bin/tsx"), ["--conditions=@uihook/source", "apps/companion/src/cli.ts", "--root", values.root], {
  env: { UIHOOK_TOKEN: token },
});

const appPort = Number(new URL(values["app-url"]).port || 80);
if (await portInUse(appPort)) say("demo", `${values["app-url"]} already running; reusing it`);
else if (values.root === path.join(REPO, "examples/react-vite-demo")) run("demo", "pnpm", ["--filter", "react-vite-demo", "dev"]);
else say("demo", `nothing on ${values["app-url"]}; start your app's dev server`);

let launched = false;
run("extension", "node", ["apps/extension/scripts/build.mjs", "--browser", browser, "--watch"], {
  onLine: (line) => {
    if (launched || !line.includes("build written")) return;
    launched = true;
    printPairing();
    if (launch) void launchBrowser();
  },
});

function printPairing() {
  const dist = path.join("apps/extension/dist", browser);
  say("dev", `extension build: ${dist}`);
  say("dev", `pair the panel with port 4317 and token ${token}  (stored in .uihook/dev-token)`);
  if (!launch) {
    say("dev", browser === "chrome"
      ? `load it: chrome://extensions > Developer mode > Load unpacked > ${dist}`
      : `load it: about:debugging#/runtime/this-firefox > Load Temporary Add-on > ${dist}/manifest.json`);
  }
}

async function launchBrowser() {
  mkdirSync(path.join(REPO, ".uihook/profiles"), { recursive: true });
  if (browser === "chrome") {
    const { chromium } = await import("playwright");
    const dist = path.join(REPO, "apps/extension/dist/chrome");
    const context = await chromium.launchPersistentContext(path.join(REPO, ".uihook/profiles/chrome"), {
      channel: "chromium",
      headless: false,
      viewport: null,
      args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(values["app-url"]).catch(() => say("browser", `could not open ${values["app-url"]} yet; reload when the app is up`));
    say("browser", "Chromium launched with UIHook. Click the toolbar icon to open the side panel. After rebuilds, reload the extension in chrome://extensions.");
    context.on("close", () => say("browser", "Chromium closed"));
    return;
  }

  const { firefoxExecutable } = await import("./e2e/test-browsers.mjs");
  const system = spawnSync("which", ["firefox"], { encoding: "utf8" }).stdout.trim();
  const binary = process.env.UIHOOK_FIREFOX ?? (system || (await firefoxExecutable()));
  const { firefoxUuidPreference } = await import("../packages/protocol/src/extension-identity.ts");
  run("browser", path.join(REPO, "apps/extension/node_modules/.bin/web-ext"), [
    "run",
    "--source-dir", "apps/extension/dist/firefox",
    "--firefox", binary,
    "--firefox-profile", path.join(REPO, ".uihook/profiles/firefox"),
    "--profile-create-if-missing",
    "--keep-profile-changes",
    "--start-url", values["app-url"],
    // Pin the extension UUID so the companion's default allowlist accepts this Firefox profile.
    "--pref", `extensions.webextensions.uuids=${firefoxUuidPreference()}`,
  ]);
  say("browser", `Firefox (${binary}) launching with UIHook; web-ext reloads the add-on on every rebuild. Open the sidebar with the toolbar button or Alt+Shift+U.`);
}
