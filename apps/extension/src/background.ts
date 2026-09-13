// Opening the side panel from the toolbar icon is the extension's entry point.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error: unknown) => console.error("[uihook] side panel", error));

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== "toggle-select" || tab?.id === undefined) return;
  await chrome.tabs.sendMessage(tab.id, { type: "panel.toggleMode" }).catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  // Only our own content scripts may ask to open the panel for their tab.
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined) return;
  if ((message as { type?: string }).type === "content.action" && (message as { action?: string }).action === "inspect") {
    chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => undefined);
  }
});
