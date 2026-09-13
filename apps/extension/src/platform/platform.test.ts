import { afterEach, describe, expect, it, vi } from "vitest";

type Globals = { chrome?: unknown; browser?: unknown };
const g = globalThis as Globals;

afterEach(() => {
  delete g.chrome;
  delete g.browser;
  vi.resetModules();
});

describe("ext namespace", () => {
  it("prefers the promise-based `browser` namespace when present (Firefox)", async () => {
    g.chrome = { tag: "chrome" };
    g.browser = { tag: "browser" };
    const { ext } = await import("./ext.js");
    expect(ext).toBe(g.browser);
  });

  it("falls back to `chrome` (Chrome)", async () => {
    g.chrome = { tag: "chrome" };
    const { ext } = await import("./ext.js");
    expect(ext).toBe(g.chrome);
  });
});

describe("Chrome platform host", () => {
  it("opens the side panel on action click and per tab", async () => {
    const setPanelBehavior = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn().mockResolvedValue(undefined);
    g.chrome = { sidePanel: { setPanelBehavior, open } };
    const { platform } = await import("./chrome.js");
    platform.installPanelHost();
    expect(setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
    await platform.openPanel(7);
    expect(open).toHaveBeenCalledWith({ tabId: 7 });
    expect(platform.panelName).toBe("side panel");
  });

  it("surfaces a user-facing error when Chrome refuses", async () => {
    g.chrome = { sidePanel: { setPanelBehavior: vi.fn().mockResolvedValue(undefined), open: vi.fn().mockRejectedValue(new Error("user gesture required")) } };
    const { platform } = await import("./chrome.js");
    await expect(platform.openPanel(1)).rejects.toThrow(/Chrome refused to open the side panel \(user gesture required\)/);
  });
});

describe("Firefox platform host", () => {
  it("toggles the sidebar from the toolbar action", async () => {
    let onClick: (() => void) | undefined;
    const toggle = vi.fn().mockResolvedValue(undefined);
    g.browser = { action: { onClicked: { addListener: (fn: () => void) => (onClick = fn) } }, sidebarAction: { toggle, open: vi.fn() } };
    const { platform } = await import("./firefox.js");
    platform.installPanelHost();
    onClick!();
    expect(toggle).toHaveBeenCalledOnce();
    expect(platform.panelName).toBe("sidebar");
  });

  it("explains that Firefox blocks opening the sidebar without a user action", async () => {
    g.browser = { sidebarAction: { toggle: vi.fn(), open: vi.fn().mockRejectedValue(new Error("sidebarAction.open may only be called from a user input handler")) } };
    const { platform } = await import("./firefox.js");
    await expect(platform.openPanel(1)).rejects.toThrow(/Use the UIHook toolbar button or Alt\+Shift\+U/);
  });

  it("fails visibly when sidebarAction is missing", async () => {
    g.browser = {};
    const { platform } = await import("./firefox.js");
    await expect(platform.openPanel(1)).rejects.toThrow(/Firefox sidebar failed to initialize/);
  });
});
