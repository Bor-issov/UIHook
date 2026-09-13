import type { PlatformHost } from "./types.js";

export const platform: PlatformHost = {
  browser: "chrome",
  panelName: "side panel",

  installPanelHost() {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => {
      console.error("[uihook] Chrome side panel failed to initialize:", error);
    });
  },

  async openPanel(tabId) {
    try {
      await chrome.sidePanel.open({ tabId });
    } catch (error) {
      throw new Error(`Chrome refused to open the side panel (${(error as Error).message}). Click the UIHook toolbar icon instead.`);
    }
  },
};
