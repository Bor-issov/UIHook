import { readFileSync } from "node:fs";
import path from "node:path";
import { CHROME_EXTENSION_ID, FIREFOX_ADDON_ID } from "@uihook/protocol";
import { describe, expect, it } from "vitest";
import { buildManifest, PANEL_PAGE } from "./manifest.js";

const keyFile = JSON.parse(readFileSync(path.join(import.meta.dirname, "../extension-key.json"), "utf8")) as { key: string; id: string };
const input = { version: "1.2.3", chromeKey: keyFile.key, firefoxAddonId: FIREFOX_ADDON_ID };

describe("buildManifest", () => {
  const chrome = buildManifest({ ...input, browser: "chrome" });
  const firefox = buildManifest({ ...input, browser: "firefox" });

  it("shares product surface across browsers", () => {
    for (const key of ["manifest_version", "name", "version", "host_permissions", "content_scripts", "action", "content_security_policy"]) {
      expect(firefox[key], key).toEqual(chrome[key]);
    }
    expect((firefox.commands as Record<string, unknown>)["toggle-select"]).toEqual((chrome.commands as Record<string, unknown>)["toggle-select"]);
  });

  it("keeps Chrome-only keys out of Firefox", () => {
    expect(chrome).toMatchObject({ key: keyFile.key, side_panel: { default_path: PANEL_PAGE }, background: { service_worker: "background.js" } });
    expect(chrome.permissions).toContain("sidePanel");
    for (const key of ["key", "side_panel", "minimum_chrome_version"]) expect(firefox, key).not.toHaveProperty(key);
    expect(firefox.permissions).not.toContain("sidePanel");
    expect(firefox.background).toEqual({ scripts: ["background.js"] });
  });

  it("keeps Firefox-only keys out of Chrome", () => {
    expect(firefox).toMatchObject({
      browser_specific_settings: { gecko: { id: FIREFOX_ADDON_ID } },
      sidebar_action: { default_panel: PANEL_PAGE },
    });
    for (const key of ["browser_specific_settings", "sidebar_action"]) expect(chrome, key).not.toHaveProperty(key);
    expect(chrome.commands).not.toHaveProperty("_execute_sidebar_action");
  });

  it("pins the Chrome extension ID the companion allowlists", async () => {
    const { createHash } = await import("node:crypto");
    const hex = createHash("sha256").update(Buffer.from(keyFile.key, "base64")).digest("hex").slice(0, 32);
    const id = [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join("");
    expect(id).toBe(keyFile.id);
    expect(id).toBe(CHROME_EXTENSION_ID);
  });
});
