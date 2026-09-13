// Launches Chromium or Firefox with the built UIHook extension and returns a browser-neutral driver:
//   app:   the localhost page (real, trusted pointer input)
//   panel: the shared panel UI, opened as an extension tab bound to the app tab
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import puppeteer from "puppeteer-core";
import { FirefoxDevtools } from "./firefox-rdp.mjs";
import { panelDriver } from "./panel-dom.mjs";
import { firefoxExecutable } from "./test-browsers.mjs";

const IDENTITY = readFileSync(new URL("../../packages/protocol/src/extension-identity.ts", import.meta.url), "utf8");
const constant = (name) => new RegExp(`${name} = "([^"]+)"`).exec(IDENTITY)[1];
export const CHROME_EXTENSION_ID = constant("CHROME_EXTENSION_ID");
export const FIREFOX_ADDON_ID = constant("FIREFOX_ADDON_ID");
export const FIREFOX_DEV_UUID = constant("FIREFOX_DEV_UUID");

const VIEWPORT = { width: 1280, height: 900 };

export async function launchWithExtension(name, extensionRoot, { headless = true } = {}) {
  const profile = mkdtempSync(path.join(tmpdir(), `uihook-e2e-${name}-`));
  const removeProfile = () => rmSync(profile, { recursive: true, force: true });
  return name === "chromium" ? launchChromium(extensionRoot, profile, removeProfile, headless) : launchFirefox(extensionRoot, profile, removeProfile, headless);
}

async function launchChromium(extensionRoot, profile, removeProfile, headless) {
  const extensionDir = path.join(extensionRoot, "dist/chrome");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless,
    viewport: VIEWPORT,
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  const id = new URL(worker.url()).host;
  const base = `chrome-extension://${id}`;
  let panelPage;

  return {
    name: "chromium",
    extensionOrigin: base,
    extensionId: id,
    async openApp(url) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      return playwrightApp(page, errors);
    },
    evaluateInBackground: (body) => worker.evaluate(`(async () => { ${body} })()`),
    /** Registered host surface for the shared panel UI. */
    panelHost: () => worker.evaluate(async () => ({ kind: "side_panel", ...(await chrome.sidePanel.getOptions({})) })),
    async openPanel(tabId) {
      panelPage = await context.newPage();
      await panelPage.setViewportSize({ width: 380, height: 1400 });
      await panelPage.goto(`${base}/sidepanel.html?tabId=${tabId}`);
      return panelDriver((body) => panelPage.evaluate(`(async () => { ${body} })()`));
    },
    screenshotPanel: (file) => panelPage.screenshot({ path: file, fullPage: true }),
    close: async () => (await context.close(), removeProfile()),
  };
}

async function launchFirefox(extensionRoot, profile, removeProfile, headless) {
  const extensionDir = path.join(extensionRoot, "dist/firefox");
  const debuggerPort = await freePort();
  const browser = await puppeteer.launch({
    browser: "firefox",
    executablePath: await firefoxExecutable(),
    headless,
    userDataDir: profile,
    defaultViewport: VIEWPORT,
    args: ["-start-debugger-server", String(debuggerPort)],
    extraPrefsFirefox: {
      "devtools.debugger.remote-enabled": true,
      "devtools.debugger.prompt-connection": false,
      "devtools.chrome.enabled": true,
      // Pin the internal UUID so the extension origin matches the companion's default allowlist.
      "extensions.webextensions.uuids": JSON.stringify({ [FIREFOX_ADDON_ID]: FIREFOX_DEV_UUID }),
    },
  });
  const devtools = await FirefoxDevtools.connect(debuggerPort);
  const addon = await devtools.installTemporaryAddon(extensionDir);
  const background = (body) => devtools.evaluateInAddon(FIREFOX_ADDON_ID, body);

  return {
    name: "firefox",
    extensionOrigin: await background("return location.origin;"),
    extensionId: addon.id,
    async openApp(url) {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(url);
      return puppeteerApp(page, errors);
    },
    evaluateInBackground: background,
    panelHost: () => background(`return { kind: "sidebar_action", path: await browser.sidebarAction.getPanel({}) };`),
    async openPanel(tabId) {
      // WebDriver BiDi refuses moz-extension:// navigation, so the extension opens its own tab.
      await background(`await browser.tabs.create({ url: browser.runtime.getURL("sidepanel.html?tabId=${tabId}"), active: false }); return true;`);
      return panelDriver((body) => devtools.evaluateInAddon(FIREFOX_ADDON_ID, body, `sidepanel.html?tabId=${tabId}`));
    },
    screenshotPanel: async () => undefined,
    close: async () => {
      devtools.close();
      await browser.close();
      removeProfile();
    },
  };
}

function playwrightApp(page, errors) {
  return {
    errors,
    front: () => page.bringToFront(),
    attr: (selector, name) => page.locator(selector).first().getAttribute(name),
    box: (selector) => page.locator(selector).first().boundingBox(),
    move: (x, y) => page.mouse.move(x, y),
    click: (x, y) => page.mouse.click(x, y),
    waitForFunction: (fn, arg, timeout = 10_000) => page.waitForFunction(fn, arg, { timeout }),
    waitForSelector: (selector) => page.locator(selector).first().waitFor(),
    screenshot: (file) => page.screenshot({ path: file }),
  };
}

function puppeteerApp(page, errors) {
  return {
    errors,
    front: () => page.bringToFront(),
    attr: (selector, name) => page.$eval(selector, (el, n) => el.getAttribute(n), name),
    box: async (selector) => (await page.$(selector)).boundingBox(),
    move: (x, y) => page.mouse.move(x, y),
    click: (x, y) => page.mouse.click(x, y),
    waitForFunction: (fn, arg, timeout = 10_000) => page.waitForFunction(fn, { timeout }, arg),
    waitForSelector: (selector) => page.waitForSelector(selector),
    screenshot: (file) => page.screenshot({ path: file }),
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}
