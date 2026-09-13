import { type ContentToPanel, ContentToPanel as ContentToPanelSchema, type PanelToContent } from "@uihook/protocol";

export interface ContentState {
  active: boolean;
  selecting: boolean;
  hasSelection: boolean;
}

/** Tab the panel is bound to. `?tabId=` exists for automated tests that open the panel as a page. */
export async function resolveTargetTab(): Promise<number | null> {
  const override = new URLSearchParams(location.search).get("tabId");
  if (override && /^\d+$/.test(override)) return Number(override);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id ?? null;
}

export async function sendToTab(tabId: number, message: PanelToContent): Promise<ContentState | null> {
  try {
    return ((await chrome.tabs.sendMessage(tabId, message)) as ContentState | undefined) ?? null;
  } catch {
    // No content script: not a localhost page, or the page was opened before the extension loaded.
    return null;
  }
}

/** Subscribes to validated content script messages from one tab. */
export function onContentMessage(getTabId: () => number | null, handler: (message: ContentToPanel) => void): () => void {
  const listener = (raw: unknown, sender: chrome.runtime.MessageSender) => {
    if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || sender.tab.id !== getTabId()) return;
    const parsed = ContentToPanelSchema.safeParse(raw);
    if (parsed.success) handler(parsed.data);
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
