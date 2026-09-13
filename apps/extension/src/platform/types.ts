import type { TargetBrowser } from "../manifest.js";

/**
 * The only browser-specific surface: how the panel UI is hosted and opened.
 * Everything else (messaging, storage, tabs, content script, panel UI) is shared.
 */
export interface PlatformHost {
  browser: TargetBrowser;
  /** Human name of the host surface, used in UI copy and errors. */
  panelName: "side panel" | "sidebar";
  /** Background bootstrap: wire the toolbar action to the panel. */
  installPanelHost(): void;
  /** Opens the panel for a tab. Rejects with a user-facing message when the browser refuses. */
  openPanel(tabId: number): Promise<void>;
}

declare global {
  /** Replaced at build time. */
  const __UIHOOK_BROWSER__: TargetBrowser;
}
