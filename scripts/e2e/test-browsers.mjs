// Resolves browser binaries for automated tests. Chromium comes from Playwright; Firefox is stock
// Firefox (Playwright's patched Firefox cannot drive extension documents).
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Browser, computeExecutablePath, detectBrowserPlatform, install, resolveBuildId } from "@puppeteer/browsers";

export const BROWSER_CACHE = process.env.UIHOOK_BROWSER_CACHE ?? path.join(os.homedir(), ".cache", "uihook-browsers");

export async function firefoxExecutable({ installIfMissing = true } = {}) {
  if (process.env.UIHOOK_FIREFOX) {
    if (!existsSync(process.env.UIHOOK_FIREFOX)) throw new Error(`UIHOOK_FIREFOX does not exist: ${process.env.UIHOOK_FIREFOX}`);
    return process.env.UIHOOK_FIREFOX;
  }
  const platform = detectBrowserPlatform();
  const buildId = await resolveBuildId(Browser.FIREFOX, platform, "stable");
  const executablePath = computeExecutablePath({ browser: Browser.FIREFOX, buildId, cacheDir: BROWSER_CACHE, platform });
  if (existsSync(executablePath)) return executablePath;
  if (!installIfMissing) throw new Error(`Firefox ${buildId} is not installed; run pnpm e2e:setup`);
  console.log(`[e2e] downloading Firefox ${buildId} to ${BROWSER_CACHE}`);
  await install({ browser: Browser.FIREFOX, buildId, cacheDir: BROWSER_CACHE, platform });
  return executablePath;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(`firefox: ${await firefoxExecutable()}`);
}
