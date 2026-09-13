import type { PlatformHost } from "./types.js";

interface FirefoxSidebarAction {
  open(): Promise<void>;
  toggle(): Promise<void>;
}

function sidebarAction(): FirefoxSidebarAction {
  const api = (globalThis as { browser?: { sidebarAction?: FirefoxSidebarAction } }).browser?.sidebarAction;
  if (!api) throw new Error("Firefox sidebar failed to initialize: browser.sidebarAction is unavailable. Check sidebar_action in manifest.json.");
  return api;
}

export const platform: PlatformHost = {
  browser: "firefox",
  panelName: "sidebar",

  installPanelHost() {
    // The action click is a user gesture, which Firefox requires for sidebarAction.open/toggle.
    browser.action.onClicked.addListener(() => {
      sidebarAction().toggle().catch((error: unknown) => console.error("[uihook] Firefox sidebar failed to open:", error));
    });
  },

  async openPanel() {
    try {
      await sidebarAction().open();
    } catch (error) {
      // Firefox only allows opening the sidebar from a user action handled by the extension itself;
      // clicks relayed from a content script do not count.
      throw new Error(`Firefox blocked opening the sidebar from the page (${(error as Error).message}). Use the UIHook toolbar button or Alt+Shift+U.`);
    }
  },
};

declare const browser: typeof chrome;
