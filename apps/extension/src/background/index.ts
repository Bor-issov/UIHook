import { platform } from "../platform/index.js";
import { ext } from "../platform/ext.js";

platform.installPanelHost();

ext.commands.onCommand.addListener((command, tab) => {
  if (command !== "toggle-select" || tab?.id === undefined) return;
  ext.tabs.sendMessage(tab.id, { type: "panel.toggleMode" }).catch((error: unknown) => {
    console.warn(`[uihook] Content script could not access tab ${tab.id} (${tab.url ?? "unknown url"}):`, error);
  });
});

ext.runtime.onMessage.addListener((message: unknown, sender) => {
  // Only our own content scripts may ask to open the panel for their tab.
  if (sender.id !== ext.runtime.id || sender.tab?.id === undefined) return;
  if ((message as { type?: string }).type !== "content.action" || (message as { action?: string }).action !== "inspect") return;
  const tabId = sender.tab.id;
  platform.openPanel(tabId).catch((error: unknown) => {
    const text = (error as Error).message;
    console.warn("[uihook]", text);
    ext.tabs.sendMessage(tabId, { type: "panel.notify", text }).catch(() => undefined);
  });
});
